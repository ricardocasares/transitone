#!/usr/bin/env bun
// Build-time importer: groups the official tram stops.txt by exact stop name.
// Self-contained (ZIP + CSV parsing inline) so the deploy image needs only Bun.
//
//   bun scripts/refresh-stops.ts [GTFS_KRK_T.zip] [output.json]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const FEED = "https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip";
const DEFAULT_OUTPUT = resolve(import.meta.dir, "../src/data/gtfs-stops.json");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function download(): Promise<Uint8Array> {
  const response = await fetch(FEED, {
    headers: { "user-agent": "KrakowTramTones/1.0" },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  }).catch((error: unknown) => fail(`GTFS download failed: ${String(error)}`));
  if (!response.ok) fail(`GTFS download failed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// Minimal ZIP reader: walk the central directory, inflate one entry.
function readZipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const ascii = (offset: number, length: number) =>
    new TextDecoder().decode(zip.subarray(offset, offset + length));
  // End-of-central-directory record sits within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (ascii(offset + 46, nameLength) === name) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) return null;
      const dataStart =
        localOffset +
        30 +
        view.getUint16(localOffset + 26, true) +
        view.getUint16(localOffset + 28, true);
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) return new Uint8Array(inflateRawSync(data));
      fail(`Unsupported ZIP compression method ${method} for ${name}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

// RFC 4180 CSV: quoted fields may contain commas, newlines and doubled quotes.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...records] = rows;
  if (!header) return [];
  return records.map((values) =>
    Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""])),
  );
}

const zip = process.argv[2]
  ? new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer())
  : await download();
const stops = readZipEntry(zip, "stops.txt");
if (!stops) fail("Cannot read stops.txt");

const groups = new Map<string, Set<string>>();
for (const row of parseCsv(
  new TextDecoder().decode(stops).replace(/^\uFEFF/, ""),
)) {
  const name = row.stop_name?.trim();
  const id = row.stop_id;
  if (name === undefined || id === undefined)
    fail("stops.txt lacks stop_name/stop_id");
  const ids = groups.get(name) ?? new Set<string>();
  ids.add(id);
  groups.set(name, ids);
}

const mapping = Object.fromEntries(
  [...groups]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, ids]) => [name, [...ids].sort()]),
);
if (
  groups.size === 0 ||
  Object.entries(mapping).some(
    ([name, ids]) => name === "" || ids.some((id) => id === ""),
  )
) {
  fail("Invalid or empty stop mapping");
}

const output = process.argv[3] ?? DEFAULT_OUTPUT;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(mapping, null, 2)}\n`);
const total = Object.values(mapping).reduce((sum, ids) => sum + ids.length, 0);
console.log(
  `Wrote ${groups.size} named stops / ${total} platform IDs to ${output}`,
);
