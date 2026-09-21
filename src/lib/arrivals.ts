export type ArrivalEvent = {
  key: string;
  stopKey: string;
  vehicleId: string;
  tripId: string;
  stopSequence: number;
};

export type ArrivalSnapshot = { generatedAt: number; arrivals: ArrivalEvent[] };

export function createArrivalTracker() {
  const seen = new Map<string, number>();
  let primed = false;
  let latest = 0;
  return {
    primeNext() {
      primed = false;
    },
    consume(snapshot: ArrivalSnapshot): ArrivalEvent[] {
      if (snapshot.generatedAt <= latest && primed) return [];
      latest = Math.max(latest, snapshot.generatedAt);
      const next: ArrivalEvent[] = [];
      for (const arrival of snapshot.arrivals) {
        if (primed && !seen.has(arrival.key)) next.push(arrival);
        seen.set(arrival.key, snapshot.generatedAt);
      }
      primed = true;
      for (const [key, timestamp] of seen) {
        if (
          snapshot.generatedAt - timestamp > 6 * 60 * 60 * 1000 ||
          seen.size > 10000
        )
          seen.delete(key);
      }
      return next;
    },
  };
}

export function isArrivalSnapshot(value: unknown): value is ArrivalSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ArrivalSnapshot>;
  return (
    typeof snapshot.generatedAt === "number" &&
    Number.isFinite(snapshot.generatedAt) &&
    snapshot.generatedAt > 0 &&
    Array.isArray(snapshot.arrivals) &&
    snapshot.arrivals.every(
      (event) =>
        event &&
        typeof event.key === "string" &&
        typeof event.stopKey === "string" &&
        typeof event.vehicleId === "string" &&
        typeof event.tripId === "string" &&
        !!event.vehicleId &&
        !!event.tripId &&
        !!event.stopKey &&
        Number.isInteger(event.stopSequence) &&
        event.stopSequence >= 0 &&
        event.key ===
          JSON.stringify([event.vehicleId, event.tripId, event.stopSequence]),
    )
  );
}
