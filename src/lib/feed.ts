import Gtfs from "gtfs-realtime-bindings";
import { stopKeyByPlatform } from "@/data/network";
import type { ArrivalEvent, ArrivalSnapshot } from "./arrivals";

const { FeedMessage, VehiclePosition } = Gtfs.transit_realtime;
export const FEED_URL = "https://gtfs.ztp.krakow.pl/VehiclePositions_T.pb";

export function decodeArrivals(
  bytes: Uint8Array,
  now = Date.now(),
): ArrivalSnapshot {
  if (!bytes.length) throw new Error("Empty feed");
  const feed = FeedMessage.decode(bytes);
  const generatedAt = Number(feed.header.timestamp) * 1000;
  if (
    !Number.isFinite(generatedAt) ||
    generatedAt <= 0 ||
    now - generatedAt > 60000 ||
    generatedAt > now + 60000
  ) {
    throw new Error("Stale or invalid feed timestamp");
  }
  if (feed.header.incrementality === 1)
    throw new Error("Differential feeds are unsupported");
  const arrivals: ArrivalEvent[] = [];
  for (const entity of feed.entity) {
    const vehicle = entity.vehicle;
    if (
      !vehicle ||
      entity.isDeleted ||
      vehicle.currentStatus !== VehiclePosition.VehicleStopStatus.STOPPED_AT
    )
      continue;
    const vehicleId = vehicle.vehicle?.id;
    const tripId = vehicle.trip?.tripId;
    const sequence = vehicle.currentStopSequence;
    const stopKey = vehicle.stopId
      ? stopKeyByPlatform.get(vehicle.stopId)
      : undefined;
    // Protobuf defaults are inherited; require the actual event fields on the wire.
    if (
      !vehicleId ||
      !tripId ||
      !stopKey ||
      !Object.hasOwn(vehicle, "currentStatus") ||
      !Object.hasOwn(vehicle, "currentStopSequence") ||
      typeof sequence !== "number" ||
      !Number.isInteger(sequence) ||
      sequence < 0
    )
      continue;
    if (
      Object.hasOwn(vehicle, "timestamp") &&
      Math.abs(now - Number(vehicle.timestamp) * 1000) > 60000
    )
      continue;
    arrivals.push({
      key: JSON.stringify([vehicleId, tripId, sequence]),
      stopKey,
      vehicleId,
      tripId,
      stopSequence: sequence,
    });
  }
  return { generatedAt, arrivals };
}

export async function fetchArrivals(
  fetcher: typeof fetch = fetch,
): Promise<ArrivalSnapshot> {
  const response = await fetcher(FEED_URL, {
    cache: "no-store",
    headers: {
      "User-Agent": "KrakowTramTones/1.0",
      Accept: "application/octet-stream",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Tram feed returned ${response.status}`);
  return decodeArrivals(new Uint8Array(await response.arrayBuffer()));
}
