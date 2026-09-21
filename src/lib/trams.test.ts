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
import { createArrivalTracker, isArrivalSnapshot } from "./arrivals";
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

describe("arrival transitions", () => {
  test("silently primes, suppresses repeated snapshots and repeated records", () => {
    const tracker = createArrivalTracker();
    expect(tracker.consume(snapshot())).toEqual([]);
    expect(tracker.consume(snapshot([valid, valid], now + 10_000))).toEqual([]);
    expect(tracker.consume(snapshot([], now + 20_000))).toEqual([]);
    expect(tracker.consume(snapshot([valid], now + 30_000))).toEqual([]);
  });
  test("changing platform ID does not replay; advancing sequence does", () => {
    const tracker = createArrivalTracker();
    tracker.consume(snapshot());
    const otherPlatform = { ...valid, stopId: theatre.gtfsStopIds[1] };
    expect(tracker.consume(snapshot([otherPlatform], now + 10_000))).toEqual(
      [],
    );
    const next = { ...otherPlatform, currentStopSequence: 6 };
    expect(tracker.consume(snapshot([next], now + 20_000))).toHaveLength(1);
    expect(tracker.consume(snapshot([next], now + 30_000))).toHaveLength(0);
  });
  test("distinct trams at the same stop stay separate; duplicate entities don't", () => {
    const tracker = createArrivalTracker();
    tracker.consume(snapshot([]));
    const another = { ...valid, vehicle: { id: "tram-2" } };
    const events = tracker.consume(
      snapshot([valid, valid, another], now + 10_000),
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.stopKey)).toEqual([theatre.key, theatre.key]);
    expect(events[0].key).not.toBe(events[1].key);
  });
  test("new trip, same tram and sequence, is a new arrival", () => {
    const tracker = createArrivalTracker();
    tracker.consume(snapshot());
    expect(
      tracker.consume(
        snapshot([{ ...valid, trip: { tripId: "new-trip" } }], now + 10_000),
      ),
    ).toHaveLength(1);
  });
  test("visibility resume and recovery silently re-prime", () => {
    const tracker = createArrivalTracker();
    tracker.consume(snapshot());
    tracker.primeNext();
    const next = { ...valid, currentStopSequence: 8 };
    expect(tracker.consume(snapshot([next], now + 60_000))).toEqual([]);
    expect(tracker.consume(snapshot([next], now + 70_000))).toEqual([]);
    expect(
      tracker.consume(
        snapshot([{ ...next, currentStopSequence: 9 }], now + 80_000),
      ),
    ).toHaveLength(1);
  });
  test("ignores snapshots arriving out of order", () => {
    const tracker = createArrivalTracker();
    tracker.consume(snapshot());
    expect(
      tracker.consume(
        snapshot([{ ...valid, currentStopSequence: 2 }], now - 10_000),
      ),
    ).toEqual([]);
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
  test("100 BPM eighth notes, at most four staggered arrivals each", () => {
    const times = batchTimes(37, 10.123);
    expect(BEAT).toBe(0.3);
    expect(times[0]).toBeCloseTo(10.2);
    expect(times[1] - times[0]).toBeCloseTo(0.035);
    const beats = new Map<number, number>();
    for (const time of times) {
      const beat = Math.floor((time + 1e-8) / BEAT);
      beats.set(beat, (beats.get(beat) ?? 0) + 1);
    }
    expect(Math.max(...beats.values())).toBe(4);
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
    for (const requested of batchTimes(40, 0)) {
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
