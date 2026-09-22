export type ArrivalEvent = {
  key: string;
  stopKey: string;
  vehicleId: string;
  tripId: string;
  stopSequence: number;
};

export type ArrivalSnapshot = { generatedAt: number; arrivals: ArrivalEvent[] };
export const POLL_INTERVAL_MS = 10_000;
// Ask for the next snapshot this long before the queued phrase runs out, so
// the reply is normally back and the next phrase chained onto the grid before
// the last bar ends. Polls never come closer together than MIN_POLL_MS, and
// fall back to the feed's own cadence while nothing is queued.
export const FETCH_LEAD_MS = 3_000;
export const MIN_POLL_MS = 4_000;
export function nextPollDelay(remainingSeconds: number) {
  if (remainingSeconds <= 0) return POLL_INTERVAL_MS;
  return Math.max(
    MIN_POLL_MS,
    Math.round(remainingSeconds * 1000) - FETCH_LEAD_MS,
  );
}

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
