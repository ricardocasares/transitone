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
  stopKeyByPlatform,
  stops,
  stopsByKey,
} from "@/data/network";
import {
  createSnapshotTracker,
  isArrivalSnapshot,
  POLL_INTERVAL_MS,
} from "./arrivals";
import { createAudioEngine } from "./audio";
import { decodeArrivals, fetchArrivals } from "./feed";
import {
  availableTime,
  BEAT,
  batchTimes,
  NOTE_LENGTH,
  pitch,
  type Reservation,
  ROOTS,
  SCALES,
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
        "ruby",
        "scripts/refresh-stops.rb",
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
    expect(salwator[0].gtfsStopIds).toEqual(salwator[1].gtfsStopIds);
  });
});

describe("snapshot replay", () => {
  test("silently primes, then replays unchanged vehicles on every poll", () => {
    const tracker = createSnapshotTracker();
    expect(tracker.consume(snapshot())).toEqual([]);
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
  test("visibility resume and recovery silently re-prime", () => {
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
    expect(times[1] - times[0]).toBeCloseTo(0.15);
    expect(times[times.length - 1] - times[0]).toBeGreaterThan(9);
    expect(times[times.length - 1] + NOTE_LENGTH - 10.123).toBeLessThan(
      POLL_INTERVAL_MS / 1000,
    );
    expect(times.every((time, i) => i === 0 || time > times[i - 1])).toBe(true);
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
  test("large snapshots keep every note and at most four notes per subdivision", () => {
    const times = batchTimes(150, 0);
    expect(times).toHaveLength(150);
    const beats = new Map<number, number>();
    for (const time of times) {
      const beat = Math.floor((time + 1e-8) / BEAT);
      beats.set(beat, (beats.get(beat) ?? 0) + 1);
    }
    expect(Math.max(...beats.values())).toBe(4);
    expect(times.at(-1)).toBeGreaterThan(10);
  });
  test("manual previews are immediate and unquantized in normal playback", () => {
    const voices = batchTimes(40, 0).map((start) => ({
      start,
      end: start + NOTE_LENGTH,
      live: true,
    }));
    expect(availableTime(voices, 0.337, false)).toBe(0.337);
  });
  test("dense live and manual bursts never exceed eight overlapping voices or four live notes per subdivision", () => {
    const voices: Reservation[] = [];
    for (const requested of batchTimes(128, 0)) {
      const start = availableTime(voices, requested, true);
      voices.push({ start, end: start + NOTE_LENGTH, live: true });
    }
    for (let i = 0; i < 30; i++) {
      const start = availableTime(voices, 0.337 + i * 0.003, false);
      voices.push({ start, end: start + NOTE_LENGTH, live: false });
    }
    for (const v of voices) {
      expect(
        voices.filter((other) => other.start <= v.start && other.end > v.start)
          .length,
      ).toBeLessThanOrEqual(8);
      const beat = Math.floor((v.start + 1e-8) / BEAT);
      expect(
        voices.filter(
          (other) =>
            other.live && Math.floor((other.start + 1e-8) / BEAT) === beat,
        ).length,
      ).toBeLessThanOrEqual(4);
    }
  });
});

test("audio replays full snapshots, preserves pending notes when retuning, and clears on mute", async () => {
  function param() {
    return {
      value: 0,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
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
      pan: param(),
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
    destination = node();
    createGain = node;
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
  const engine = createAudioEngine(() => {});
  try {
    expect(contexts).toBe(0);
    await engine.unlock();
    await engine.unlock();
    expect(contexts).toBe(1);
    const keys = Array.from({ length: 62 }, () => theatre.key);
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
    engine.playStop(theatre.key);
    expect(oscillators[oscillators.length - 1].startTime).toBeCloseTo(
      clock + 0.012,
    );
    const beforeMute = oscillators.length;
    engine.setMuted(true);
    engine.playSnapshot(keys);
    expect(oscillators).toHaveLength(beforeMute);
    expect(oscillators[oscillators.length - 1].stopTime).toBeCloseTo(
      clock + 0.02,
    );
  } finally {
    await engine.close();
    globalThis.AudioContext = original;
  }
});
