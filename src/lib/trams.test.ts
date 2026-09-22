import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Gtfs from "gtfs-realtime-bindings";
import { GET } from "@/app/api/arrivals/route";
import {
  buildStopIndex,
  mapStops,
  ROLES,
  type Role,
  stopKeyByPlatform,
  stops,
  stopsByKey,
} from "@/data/network";
import {
  createSnapshotTracker,
  FETCH_LEAD_MS,
  isArrivalSnapshot,
  MIN_POLL_MS,
  nextPollDelay,
  POLL_INTERVAL_MS,
} from "./arrivals";
import { createAudioEngine } from "./audio";
import { decodeArrivals, fetchArrivals } from "./feed";
import {
  arrange,
  arrangeTimes,
  availableTime,
  BEAT,
  batchTimes,
  GHOST_LEVEL,
  MAX_VOICES,
  NOTE_LENGTH,
  pitch,
  type Reservation,
  ROLE_LENGTH,
  ROOTS,
  SCALES,
  STEP_CAPACITY,
  STEPS_PER_BAR,
} from "./music";

const now = 1_790_000_000_000;

test("traced stop markers are native, unscaled SVG circles", () => {
  const svg = readFileSync(
    new URL("../../public/tram-network.svg", import.meta.url),
    "utf8",
  );
  const markers = svg.match(/<g id="stop-markers"[^>]*>([\s\S]*?)<\/g>/)?.[1];
  assert(markers);
  const circles = [...markers.matchAll(/<circle\b([^>]*)\/>/g)];
  expect(circles).toHaveLength(476);
  const zusColors: string[] = [];
  for (const [, attributes] of circles) {
    expect(attributes).toContain('r="3.1"');
    expect(attributes).toMatch(/stroke="#[\da-f]{6}"/);
    expect(attributes).not.toContain("transform");
    const x = Number(attributes.match(/cx="([\d.]+)"/)?.[1]);
    const y = Number(attributes.match(/cy="([\d.]+)"/)?.[1]);
    expect(x > 0 && x < 1778 && y > 0 && y < 1408).toBe(true);
    if (x > 308 && x < 336 && y > 1097 && y < 1125) {
      zusColors.push(attributes.match(/stroke="([^"]+)"/)?.[1] ?? "");
      expect(x - y).toBeCloseTo(-788.851, 3);
    }
  }
  expect(zusColors.sort()).toEqual(
    ["#ffcb00", "#abd39d", "#28bc92", "#1470e0", "#364a74"].sort(),
  );
  expect(svg.match(/clip-path="url\(#zus-original-markers\)"/g)).toHaveLength(
    5,
  );
});

test("tunnels share a continuous outer stroke with their solid approaches", () => {
  const svg = readFileSync(
    new URL("../../public/tram-network.svg", import.meta.url),
    "utf8",
  );
  const tunnels = svg.match(/<g id="tunnel-lines"[^>]*>([\s\S]*?)<\/g>/)?.[1];
  assert(tunnels);
  const paths = [...tunnels.matchAll(/<path\b([^>]*)\/>/g)];
  expect(paths).toHaveLength(14); // Four northern and three southern lanes.
  for (let i = 0; i < paths.length; i += 2) {
    const outer = paths[i][1];
    const inner = paths[i + 1][1];
    const outline = outer.match(/d="([^"]+)"/)?.[1];
    const centerline = inner.match(/d="([^"]+)"/)?.[1];
    assert(outline && centerline);
    expect(centerline).toMatch(/[CQ]/);
    expect(outline).toContain(centerline.replace(/^M/, "L"));
    expect(outline.endsWith(centerline.slice(1))).toBe(false);
    expect(outer).toContain('stroke-width="4.2"');
    expect(inner).toContain('stroke="#241f31" stroke-width="1.2"');
    if (i < 8) {
      expect(outer).toContain('clip-path="url(#tunnel-crossings)"');
      expect(inner).toContain('clip-path="url(#tunnel-crossings)"');
    }
  }
  expect(svg).toContain('<clipPath id="tunnel-crossings">');
  expect(svg).toContain("M621 378H628V469H621Z");
  expect(svg.match(/clip-path="url\(#tunnel-south-surface\)"/g)).toHaveLength(
    3,
  );
  expect(svg).toContain('clip-rule="evenodd"');
});

test("every stop label clears its route marker", () => {
  for (const stop of mapStops)
    expect(
      Math.hypot(stop.labelX - stop.x, stop.labelY - stop.y),
    ).toBeGreaterThanOrEqual(20 - 1e-6);
});

test("diagonal stop labels have stable coordinates for SVG hydration", () => {
  const stop = mapStops.find((stop) => stop.key === "bienczycka");
  expect(stop?.labelX).toBe(1215.857864);
  expect(stop?.labelY).toBe(444.857864);
});

const theatre = stopsByKey.get("teatr-slowackiego");
assert(theatre);
const valid: Gtfs.transit_realtime.IVehiclePosition = {
  vehicle: { id: "tram-1" },
  trip: { tripId: "trip-1" },
  currentStopSequence: 5,
  currentStatus: 1,
  stopId: theatre.gtfsStopIds[0],
};

function wire(
  vehicles: Gtfs.transit_realtime.IVehiclePosition[] = [valid],
  timestamp = now / 1000,
  incrementality = 0,
) {
  return Gtfs.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0", timestamp, incrementality },
    entity: vehicles.map((vehicle, i) => ({ id: String(i), vehicle })),
  }).finish();
}
function snapshot(vehicles = [valid], time = now) {
  return decodeArrivals(wire(vehicles, time / 1000), time);
}

describe("one logical stop, every platform", () => {
  test("stops.txt rows group by the exact canonical name, including quoted CSV", () => {
    const dir = mkdtempSync(join(tmpdir(), "tram-test-"));
    try {
      writeFileSync(
        join(dir, "stops.txt"),
        'stop_id,stop_name,stop_lat,stop_lon\na,"Teatr Słowackiego",50,20\nb,"Teatr Słowackiego",50,20\nc,"Example, tram stop",50,20\n',
      );
      expect(
        Bun.spawnSync(["zip", "-q", "stops.zip", "stops.txt"], { cwd: dir })
          .exitCode,
      ).toBe(0);
      const output = join(dir, "result.json");
      const result = Bun.spawnSync([
        "bun",
        "scripts/refresh-stops.ts",
        join(dir, "stops.zip"),
        output,
      ]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({
        "Example, tram stop": ["c"],
        "Teatr Słowackiego": ["a", "b"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("all four Teatr Słowackiego platforms resolve to the same node and note", () => {
    expect(theatre.gtfsStopIds).toHaveLength(4);
    for (const id of theatre.gtfsStopIds) {
      expect(stopKeyByPlatform.get(id)).toBe(theatre.key);
      expect(stopsByKey.get(stopKeyByPlatform.get(id) ?? "")?.noteStep).toBe(
        theatre.noteStep,
      );
    }
  });
  test("each configured platform belongs to exactly one logical stop", () => {
    const ids = stops.flatMap((s) => s.gtfsStopIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stopKeyByPlatform.size).toBe(ids.length);
    expect(() =>
      buildStopIndex([
        { key: "a", gtfsStopIds: ["1"] },
        { key: "b", gtfsStopIds: ["1"] },
      ]),
    ).toThrow("two stops");
  });
  test("historical labels use explicit aliases, not substring matching", () => {
    expect(stopsByKey.get("solvay")?.gtfsNames).toEqual(["Kościuszkowców"]);
    expect(stopsByKey.get("borek-falecki-i")?.gtfsNames).toEqual(["Solvay"]);
    expect(stopsByKey.get("centralna")?.gtfsNames).toEqual(["Gałczyńskiego"]);
    expect(stopsByKey.get("teatr-bagatela")?.label).toBe("Teatr Bagatela");
    expect(stopKeyByPlatform.get("made-up-platform")).toBeUndefined();
  });
  test("duplicate visual labels for Salwator share one sound", () => {
    const salwator = mapStops.filter((s) => s.key === "salwator");
    expect(salwator).toHaveLength(2);
    expect(salwator[0].noteStep).toBe(salwator[1].noteStep);
    expect(salwator[0].role).toBe(salwator[1].role);
    expect(salwator[0].gtfsStopIds).toEqual(salwator[1].gtfsStopIds);
  });
  test("roles follow the network: hubs kick, line ends snare, the rest fill", () => {
    for (const stop of stops) {
      if (stop.hub) expect(stop.role).toBe("kick");
      else expect(stop.role).not.toBe("kick");
    }
    expect(stopsByKey.get("teatr-slowackiego")?.role).toBe("kick");
    expect(stopsByKey.get("czerwone-maki")?.role).toBe("snare");
    expect(stopsByKey.get("pleszow")?.role).toBe("snare");
    // Dworzec Towarowy is both; the interchange wins.
    expect(stopsByKey.get("dworzec-towarowy")?.role).toBe("kick");
    const counts = new Map<string, number>();
    for (const stop of stops)
      counts.set(stop.role, (counts.get(stop.role) ?? 0) + 1);
    for (const role of ["kick", "snare", "hihat", "bass", "lead"])
      expect(counts.get(role) ?? 0).toBeGreaterThan(0);
    // Melody stays the majority so phrases keep a tonal centre.
    expect(counts.get("lead") ?? 0).toBeGreaterThan(stops.length / 3);
  });
});

describe("snapshot replay", () => {
  test("plays immediately, then replays unchanged vehicles on every poll", () => {
    const tracker = createSnapshotTracker();
    expect(tracker.consume(snapshot([valid, valid]))).toHaveLength(1);
    expect(
      tracker.consume(snapshot([valid, valid], now + 10_000)),
    ).toHaveLength(1);
    expect(tracker.consume(snapshot([], now + 20_000))).toEqual([]);
    expect(tracker.consume(snapshot([valid], now + 30_000))).toHaveLength(1);
  });
  test("an unchanged but still-fresh feed timestamp is replayable", () => {
    const tracker = createSnapshotTracker();
    tracker.consume(snapshot());
    expect(tracker.consume(snapshot())).toHaveLength(1);
    expect(tracker.consume(snapshot())).toHaveLength(1);
  });
  test("platform changes still resolve to one stop, without duplicates inside the phrase", () => {
    const tracker = createSnapshotTracker();
    tracker.consume(snapshot());
    const otherPlatform = { ...valid, stopId: theatre.gtfsStopIds[1] };
    const events = tracker.consume(
      snapshot([valid, otherPlatform], now + 10_000),
    );
    expect(events).toHaveLength(1);
    expect(events[0].stopKey).toBe(theatre.key);
    const next = { ...otherPlatform, currentStopSequence: 6 };
    expect(tracker.consume(snapshot([next], now + 20_000))).toHaveLength(1);
    expect(tracker.consume(snapshot([next], now + 30_000))).toHaveLength(1);
  });
  test("distinct trams at the same stop stay separate; duplicate entities don't", () => {
    const tracker = createSnapshotTracker();
    tracker.consume(snapshot([]));
    const another = { ...valid, vehicle: { id: "tram-2" } };
    const events = tracker.consume(
      snapshot([valid, valid, another], now + 10_000),
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.stopKey)).toEqual([theatre.key, theatre.key]);
    expect(events[0].key).not.toBe(events[1].key);
  });
  test("a new trip is included with the rest of the snapshot", () => {
    const tracker = createSnapshotTracker();
    tracker.consume(snapshot());
    expect(
      tracker.consume(
        snapshot(
          [valid, { ...valid, trip: { tripId: "new-trip" } }],
          now + 10_000,
        ),
      ),
    ).toHaveLength(2);
  });
  test("feed recovery silently re-primes the tracker", () => {
    const tracker = createSnapshotTracker();
    tracker.consume(snapshot());
    tracker.primeNext();
    const next = { ...valid, currentStopSequence: 8 };
    expect(tracker.consume(snapshot([next], now + 60_000))).toEqual([]);
    expect(tracker.consume(snapshot([next], now + 70_000))).toHaveLength(1);
    expect(
      tracker.consume(
        snapshot([{ ...next, currentStopSequence: 9 }], now + 80_000),
      ),
    ).toHaveLength(1);
  });
  test("ignores snapshots arriving out of order", () => {
    const tracker = createSnapshotTracker();
    tracker.consume(snapshot());
    expect(
      tracker.consume(
        snapshot([{ ...valid, currentStopSequence: 2 }], now - 10_000),
      ),
    ).toEqual([]);
    tracker.primeNext();
    expect(tracker.consume(snapshot([valid], now - 10_000))).toEqual([]);
    expect(tracker.consume(snapshot([valid], now + 10_000))).toEqual([]);
    expect(tracker.consume(snapshot([valid], now + 20_000))).toHaveLength(1);
  });
  test("the next poll is due before the queued phrase runs out", () => {
    expect(nextPollDelay(0)).toBe(POLL_INTERVAL_MS);
    expect(nextPollDelay(9.6)).toBe(9600 - FETCH_LEAD_MS);
    expect(nextPollDelay(19.3)).toBe(19300 - FETCH_LEAD_MS);
    expect(nextPollDelay(1)).toBe(MIN_POLL_MS);
  });
});

describe("realtime validation", () => {
  test("API responds with uncached 502 on upstream failure, then recovers", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(null, { status: 503 })) as unknown as typeof fetch;
      const failed = await GET();
      expect(failed.status).toBe(502);
      expect(failed.headers.get("Cache-Control")).toBe("no-store");
      expect(await failed.json()).toEqual({ error: "feed_unavailable" });
      globalThis.fetch = (async () =>
        new Response(
          new Uint8Array(wire([valid], Math.floor(Date.now() / 1000))),
        )) as unknown as typeof fetch;
      const recovered = await GET();
      expect(recovered.status).toBe(200);
      expect(isArrivalSnapshot(await recovered.json())).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
  test("emits the exact documented event shape", () => {
    expect(snapshot().arrivals).toEqual([
      {
        key: '["tram-1","trip-1",5]',
        stopKey: theatre.key,
        vehicleId: "tram-1",
        tripId: "trip-1",
        stopSequence: 5,
      },
    ]);
  });
  test("skips incomplete, unknown, non-stopped, and stale vehicle records", () => {
    const bad: Gtfs.transit_realtime.IVehiclePosition[] = [
      {},
      { ...valid, vehicle: {} },
      { ...valid, trip: {} },
      { ...valid, currentStopSequence: undefined },
      { ...valid, currentStatus: undefined },
      { ...valid, currentStatus: 0 },
      { ...valid, currentStatus: 2 },
      { ...valid, stopId: undefined },
      { ...valid, stopId: "unknown" },
      { ...valid, timestamp: now / 1000 - 61 },
      { ...valid, timestamp: now / 1000 + 61 },
    ];
    expect(snapshot([...bad, valid]).arrivals).toHaveLength(1);
  });
  test("deleted entities and non-vehicle entities do not produce events", () => {
    const bytes = Gtfs.transit_realtime.FeedMessage.encode({
      header: { gtfsRealtimeVersion: "2.0", timestamp: now / 1000 },
      entity: [{ id: "a", isDeleted: true, vehicle: valid }, { id: "b" }],
    }).finish();
    expect(decodeArrivals(bytes, now).arrivals).toEqual([]);
  });
  test("rejects empty protobuf, corrupted bytes, stale headers and differential feeds", () => {
    expect(() => decodeArrivals(new Uint8Array(), now)).toThrow("Empty feed");
    expect(() =>
      decodeArrivals(new Uint8Array([255, 255, 255]), now),
    ).toThrow();
    expect(() => decodeArrivals(wire([], 0), now)).toThrow("timestamp");
    expect(() => decodeArrivals(wire([], now / 1000 - 61), now)).toThrow(
      "timestamp",
    );
    expect(() => decodeArrivals(wire([], now / 1000 + 61), now)).toThrow(
      "timestamp",
    );
    expect(() => decodeArrivals(wire([], now / 1000, 1), now)).toThrow(
      "Differential",
    );
    expect(snapshot([]).arrivals).toEqual([]);
  });
  test("validates the browser boundary", () => {
    expect(isArrivalSnapshot(snapshot())).toBe(true);
    for (const value of [
      null,
      {},
      { generatedAt: NaN, arrivals: [] },
      { generatedAt: now, arrivals: [{}] },
      {
        ...snapshot(),
        arrivals: [{ ...snapshot().arrivals[0], key: "wrong" }],
      },
    ]) {
      expect(isArrivalSnapshot(value)).toBe(false);
    }
  });
  test("upstream HTTP and decode failures propagate to the route's 502 handler", async () => {
    const respond = (response: Response) =>
      (async () => response) as unknown as typeof fetch;
    await expect(
      fetchArrivals(respond(new Response("Unavailable", { status: 503 }))),
    ).rejects.toThrow("503");
    await expect(
      fetchArrivals(respond(new Response(new Uint8Array()))),
    ).rejects.toThrow("Empty feed");
    await expect(
      fetchArrivals(respond(new Response(new Uint8Array([255])))),
    ).rejects.toThrow();
    const fresh = wire([valid], Math.floor(Date.now() / 1000));
    expect(
      (await fetchArrivals(respond(new Response(new Uint8Array(fresh)))))
        .arrivals,
    ).toHaveLength(1);
  });
  test("upstream requests really abort after eight seconds", async () => {
    const blocked = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        expect(init?.cache).toBe("no-store");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      })) as unknown as typeof fetch;
    await expect(fetchArrivals(blocked)).rejects.toThrow();
  }, 10_000);
});

describe("musical scheduling", () => {
  test("bass voices sit one octave below the lead", () => {
    const lead = pitch(3, 2, "Major");
    const bass = pitch(3, 2, "Major", -12);
    expect(lead.frequency / bass.frequency).toBeCloseTo(2);
    expect(bass.name).toBe("G2");
    expect(lead.name).toBe("G3");
  });
  test("all roots and scales transpose cleanly", () => {
    expect(ROOTS).toHaveLength(12);
    expect(pitch(0, 0, "Major pentatonic").name).toBe("C3");
    expect(pitch(5, 0, "Major pentatonic").name).toBe("C4");
    expect(pitch(0, 9, "Major").frequency).toBe(220);
    for (const scale of Object.keys(SCALES) as (keyof typeof SCALES)[]) {
      for (let root = 0; root < 12; root++) {
        const notes = Array.from(
          { length: 16 },
          (_, i) => pitch(i, root, scale).frequency,
        );
        expect(
          notes.every((f, i) => f > 0 && (i === 0 || f > notes[i - 1])),
        ).toBe(true);
      }
    }
  });
  test("a full snapshot spans the polling interval rather than a short burst", () => {
    const times = batchTimes(62, 10.123);
    expect(BEAT).toBe(0.3);
    expect(times).toHaveLength(62);
    expect(times[0]).toBeCloseTo(10.2);
    // Sixty-two leads over thirty-two steps: most steps carry a two-note chord.
    expect(times[1]).toBe(times[0]);
    expect(times[2] - times[0]).toBeCloseTo(BEAT);
    expect(times[times.length - 1] - times[0]).toBeGreaterThan(9);
    expect(times[times.length - 1] + NOTE_LENGTH - 10.123).toBeLessThan(
      POLL_INTERVAL_MS / 1000,
    );
    expect(times.every((time, i) => i === 0 || time >= times[i - 1])).toBe(
      true,
    );
    for (const time of times) {
      const step = (time - times[0]) / BEAT;
      expect(Math.abs(step - Math.round(step))).toBeLessThan(1e-6);
    }
  });
  test("sparse, empty and single-stop snapshots have no invented notes", () => {
    expect(batchTimes(0, 0)).toEqual([]);
    expect(batchTimes(1, 0)).toEqual([0.3]);
    for (const count of [13, 17, 37]) {
      const times = batchTimes(count, 0);
      expect(times).toHaveLength(count);
      expect(times[times.length - 1] - times[0]).toBeGreaterThan(8.5);
    }
  });
  test("large snapshots keep every note, chord at most three leads, and extend by whole bars", () => {
    const times = batchTimes(150, 0);
    expect(times).toHaveLength(150);
    const steps = new Map<number, number>();
    for (const time of times) {
      const step = Math.round((time - times[0]) / BEAT);
      steps.set(step, (steps.get(step) ?? 0) + 1);
    }
    expect(Math.max(...steps.values())).toBe(STEP_CAPACITY.lead);
    // 150 leads need 50 steps, so the phrase grows to seven whole bars.
    expect(Math.max(...steps.keys()) + 1).toBe(7 * STEPS_PER_BAR);
    expect(times.at(-1)).toBeGreaterThan(10);
  });
  function grid(roles: Role[], times: number[]) {
    const first = Math.ceil(0.045 / BEAT) * BEAT;
    const beats: Role[][] = [];
    times.forEach((time, i) => {
      const beat = Math.floor((time - first) / BEAT + 1e-6);
      beats[beat] ??= [];
      beats[beat].push(roles[i]);
    });
    return beats;
  }
  const kit = (pattern: string) =>
    [...pattern].map(
      (c) =>
        ({ k: "kick", s: "snare", b: "bass", h: "hihat", l: "lead" })[
          c
        ] as Role,
    );
  test("the rhythm section lands on its beats and spreads across the bars", () => {
    const roles = kit("kkkkssssbbbbhhhhhhhhllllllllllll");
    const times = arrangeTimes(roles, 0);
    const beats = grid(roles, times);
    // Four kicks and four basses share the downbeat of each of the four bars.
    for (const bar of [0, 8, 16, 24]) {
      expect(beats[bar]).toContain("kick");
      expect(beats[bar]).toContain("bass");
      // Snares answer on beat two of each bar.
      expect(beats[bar + 2]).toContain("snare");
    }
    // They hit together: each kick and its bass start at the same instant.
    expect(times.filter((_, i) => roles[i] === "kick")).toEqual(
      times.filter((_, i) => roles[i] === "bass"),
    );
    // Hi-hats only sit on the off-beats while there is room there.
    expect(beats.flat().filter((role) => role === "hihat")).toHaveLength(8);
    for (const [index, beat] of beats.entries())
      if (beat?.includes("hihat")) expect(index % 2).toBe(1);
  });
  test("arrangement keeps every note, honours per-role capacity, and extends by whole bars", () => {
    const roles = kit("k".repeat(40) + "s".repeat(30) + "l".repeat(100));
    const times = arrangeTimes(roles, 0);
    expect(times).toHaveLength(170);
    expect(times.every((t) => Number.isFinite(t))).toBe(true);
    const beats = grid(roles, times);
    // Forty kicks need forty steps: five bars, one kick on every step.
    expect(beats.length).toBe(5 * STEPS_PER_BAR);
    for (const index of beats.keys())
      for (const role of ROLES)
        expect(
          (beats[index] ?? []).filter((r) => r === role).length,
        ).toBeLessThanOrEqual(STEP_CAPACITY[role]);
    // Spill-over: forty kicks exceed the downbeats, so some land elsewhere,
    // but the downbeats are all taken first.
    for (const index of beats.keys())
      if (index % 8 === 0) expect(beats[index]).toContain("kick");
    // An all-lead phrase is the classic even spread.
    expect(arrangeTimes(kit("llll"), 10)).toEqual(batchTimes(4, 10));
  });
  test("percussion holds a voice slot only as long as it sounds", () => {
    expect(ROLE_LENGTH.hihat).toBeLessThan(ROLE_LENGTH.kick);
    expect(ROLE_LENGTH.lead).toBe(NOTE_LENGTH);
    // A full house of hi-hats clears before a lead where leads would not.
    const hats: Reservation[] = Array.from({ length: MAX_VOICES }, () => ({
      start: 1,
      end: 1 + ROLE_LENGTH.hihat,
    }));
    expect(availableTime(hats, 1 + ROLE_LENGTH.hihat, false)).toBeCloseTo(
      1 + ROLE_LENGTH.hihat,
    );
    expect(availableTime(hats, 1, false, ROLE_LENGTH.lead)).toBeGreaterThan(1);
  });
  test("manual previews are immediate and unquantized in normal playback", () => {
    const voices = batchTimes(40, 0).map((start) => ({
      start,
      end: start + NOTE_LENGTH,
    }));
    expect(availableTime(voices, 0.337, false)).toBe(0.337);
  });
  test("notes on one step start together and drums never double up", () => {
    // A kick, its bass and a lead share the downbeat; the hi-hat answers off-beat.
    const times = arrangeTimes(kit("kbhl"), 0);
    expect(times[0]).toBe(0.3);
    expect(times[1]).toBe(times[0]);
    expect(times[3]).toBe(times[0]);
    expect(times[2]).toBeCloseTo(times[0] + BEAT);
    // Ten kicks overflow the eight downbeats onto other beats, never stacking.
    expect(new Set(arrangeTimes(kit("k".repeat(10)), 0)).size).toBe(10);
    // Sixty-four leads make a two-note chord on every step of the four bars.
    const counts = new Map<number, number>();
    for (const time of arrangeTimes(kit("l".repeat(64)), 0))
      counts.set(time, (counts.get(time) ?? 0) + 1);
    expect(counts.size).toBe(4 * STEPS_PER_BAR);
    expect([...counts.values()].every((count) => count === 2)).toBe(true);
  });
  test("snares accent the backbeat and overflow into off-beat ghost notes", () => {
    // Trams lay over at loops, so termini can outnumber everything else.
    const placements = arrange(kit("s".repeat(12)), 0);
    const step = (time: number) => Math.round((time - 0.3) / BEAT);
    const accented = placements.filter((p) => p.level === 1);
    const ghosts = placements.filter((p) => p.level === GHOST_LEVEL);
    expect(accented).toHaveLength(8);
    expect(ghosts).toHaveLength(4);
    for (const p of accented) expect([2, 6]).toContain(step(p.time) % 8);
    for (const p of ghosts) expect(step(p.time) % 2).toBe(1);
    // Downbeats stay the kick's until even the off-beats are full.
    const steps = arrange(kit("s".repeat(26)), 0).map((p) => step(p.time) % 8);
    expect(steps.filter((s) => s === 0 || s === 4)).toHaveLength(2);
    expect(arrangeTimes(kit("ss"), 0)).toEqual(
      arrange(kit("ss"), 0).map((p) => p.time),
    );
  });
  test("a full step's voices start together and manual bursts wait for a free voice", () => {
    const roles = kit(
      "k".repeat(8) +
        "s".repeat(8) +
        "b".repeat(8) +
        "h".repeat(16) +
        "l".repeat(96),
    );
    const arranged = arrangeTimes(roles, 0);
    const voices: Reservation[] = [];
    arranged.forEach((requested, i) => {
      const length = ROLE_LENGTH[roles[i]];
      const start = availableTime(voices, requested, true, length);
      // Nothing in a snapshot is pushed off its step by its neighbours.
      expect(start).toBe(requested);
      voices.push({ start, end: start + length });
    });
    // The first downbeat carries a kick, a bass and a three-note chord at once.
    expect(voices.filter((v) => v.start === arranged[0])).toHaveLength(5);
    for (let i = 0; i < 30; i++) {
      const requested = 0.337 + i * 0.003;
      const start = availableTime(voices, requested, false);
      expect(start).toBeGreaterThanOrEqual(requested);
      voices.push({ start, end: start + NOTE_LENGTH });
    }
    for (const v of voices)
      expect(
        voices.filter((other) => other.start <= v.start && other.end > v.start)
          .length,
      ).toBeLessThanOrEqual(MAX_VOICES);
  });
});

test("audio plays at full volume, preserves pending notes when retuning, and clears on pause", async () => {
  function param() {
    return {
      value: 0,
      peak: 0,
      setValueAtTime() {},
      linearRampToValueAtTime(value: number) {
        this.peak = Math.max(this.peak, value);
      },
      exponentialRampToValueAtTime() {},
      setTargetAtTime() {},
      cancelAndHoldAtTime() {},
    };
  }
  function node() {
    return {
      connect<T>(target: T) {
        return target;
      },
      disconnect() {},
      type: "",
      gain: param(),
      frequency: param(),
      Q: param(),
      pan: param(),
      buffer: null,
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
      startTime: -1,
      stopTime: -1,
      start(time: number) {
        this.startTime = time;
      },
      stop(time: number) {
        this.stopTime = time;
      },
    };
  }
  const oscillators: ReturnType<typeof node>[] = [];
  const noises: ReturnType<typeof node>[] = [];
  const gains: ReturnType<typeof node>[] = [];
  let clock = 10;
  let contexts = 0;
  const original = globalThis.AudioContext;
  globalThis.AudioContext = class {
    constructor() {
      contexts++;
    }
    get currentTime() {
      return clock;
    }
    state = "running";
    sampleRate = 48000;
    destination = node();
    createBuffer(_channels: number, length: number) {
      return { getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
      const source = node();
      noises.push(source);
      return source;
    }
    createGain() {
      const gain = node();
      gains.push(gain);
      return gain;
    }
    createBiquadFilter = node;
    createStereoPanner = node;
    createDynamicsCompressor = node;
    createOscillator() {
      const oscillator = node();
      oscillators.push(oscillator);
      return oscillator;
    }
    async close() {
      this.state = "closed";
    }
  } as unknown as typeof AudioContext;
  const lead = stops.find((stop) => stop.role === "lead");
  assert(lead);
  const engine = createAudioEngine(() => {});
  try {
    expect(contexts).toBe(0);
    expect(engine.running()).toBe(false);
    await engine.unlock();
    await engine.unlock();
    expect(contexts).toBe(1);
    expect(engine.running()).toBe(true);
    expect(gains[0].gain.value).toBe(0.65);
    const keys = Array.from({ length: 62 }, () => lead.key);
    engine.playSnapshot(keys);
    expect(oscillators).toHaveLength(62);
    expect(oscillators.map((o) => o.startTime)).toEqual(batchTimes(62, clock));
    const oldFrequency = oscillators[0].frequency.value;
    clock = 11;
    const pending = oscillators
      .filter((o) => o.startTime > clock)
      .map((o) => o.startTime);
    engine.tune(2, "Major pentatonic");
    expect(oscillators.slice(62).map((o) => o.startTime)).toEqual(pending);
    expect(oscillators[62].frequency.value / oldFrequency).toBeCloseTo(
      2 ** (2 / 12),
    );
    clock = 20;
    const before = oscillators.length;
    engine.playSnapshot(keys);
    expect(oscillators.length - before).toBe(62);
    // The next phrase chains onto the bar after this one, and the app can ask
    // how much queued music is left.
    expect(engine.remaining()).toBeCloseTo(20.1 + 32 * BEAT - clock);
    engine.playSnapshot(keys);
    expect(oscillators[before + 62].startTime).toBeCloseTo(20.1 + 32 * BEAT);
    expect(engine.remaining()).toBeCloseTo(20.1 + 64 * BEAT - clock);
    engine.playStop(lead.key);
    expect(oscillators[oscillators.length - 1].startTime).toBeCloseTo(
      clock + 0.012,
    );
    engine.clear();
    expect(oscillators[oscillators.length - 1].stopTime).toBeCloseTo(
      clock + 0.02,
    );
    expect(engine.remaining()).toBe(0);
    // Drums: the kick is a pitched-down sine, hats and snares are noise.
    expect(noises).toHaveLength(0);
    engine.playStop(theatre.key);
    expect(oscillators[oscillators.length - 1].frequency.value).toBe(150);
    const hihat = stops.find((stop) => stop.role === "hihat");
    assert(hihat);
    engine.playStop(hihat.key);
    expect(noises).toHaveLength(1);
    expect(noises[0].startTime).toBeCloseTo(clock + 0.012);
    // A snapshot's kick and bass share the downbeat at the same instant.
    const bass = stops.find((stop) => stop.role === "bass");
    assert(bass);
    engine.clear();
    const count = oscillators.length;
    engine.playSnapshot([theatre.key, bass.key]);
    expect(oscillators.length - count).toBe(2);
    expect(oscillators[count + 1].startTime).toBe(oscillators[count].startTime);
    expect(oscillators[count].startTime).toBeCloseTo(clock + 0.1);
    // Overflow snares are ghost notes: the same voice at a fraction of the level.
    const snare = stops.find((stop) => stop.role === "snare");
    assert(snare);
    engine.clear();
    const gainCount = gains.length;
    engine.playSnapshot(Array.from({ length: 12 }, () => snare.key));
    const peaks = gains.slice(gainCount).map((gain) => gain.gain.peak);
    expect(peaks).toHaveLength(12);
    expect(peaks.filter((peak) => peak === 0.5)).toHaveLength(8);
    expect(peaks.filter((peak) => peak === 0.5 * GHOST_LEVEL)).toHaveLength(4);
    // Retuning keeps ghost notes ghosted.
    clock = 20.5;
    const retuned = gains.length;
    engine.tune(3, "Major");
    expect(
      gains
        .slice(retuned)
        .filter((gain) => gain.gain.peak === 0.5 * GHOST_LEVEL).length,
    ).toBeGreaterThan(0);
  } finally {
    await engine.close();
    globalThis.AudioContext = original;
  }
});
