export type ArrivalEvent = {
  key: string;
  stopKey: string;
  vehicleId: string;
  tripId: string;
  stopSequence: number;
};

export type ArrivalSnapshot = { generatedAt: number; arrivals: ArrivalEvent[] };
export const POLL_INTERVAL_MS = 10_000;

export function createSnapshotTracker() {
  let primed = true;
  let latest = 0;
  return {
    primeNext() {
      primed = false;
    },
    consume(snapshot: ArrivalSnapshot): ArrivalEvent[] {
      if (snapshot.generatedAt < latest) return [];
      latest = snapshot.generatedAt;
      const shouldPlay = primed;
      primed = true;
      // Replay vehicles on every poll, but not duplicate entities within a poll.
      return shouldPlay
        ? [
            ...new Map(
              snapshot.arrivals.map((event) => [event.key, event]),
            ).values(),
          ]
        : [];
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
