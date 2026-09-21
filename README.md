# Kraków Tram Tones

A playable SVG tram network. Every logical stop has one sound, shared by all its platforms and directions. Each live snapshot of stopped trams becomes a musical phrase, using only ZTP’s official tram feed; no simulated vehicles or GPS inference.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000. Tap a stop for an immediate preview, or choose **Start listening** for live music. The first feed snapshot is silent. Drag, scroll, pinch, or use the zoom buttons to explore; Tab then Enter/Space plays a focused stop. A skip link reaches the sound controls without tabbing through the whole network.

```sh
bun test
bun run lint
bun run build
bun run start
```

Production requires Node 22+ (or Bun) and outbound HTTPS to `gtfs.ztp.krakow.pl`. No database, credentials, remote fonts, or audio files are needed. Tests also use Ruby, `zip`, and `unzip` to verify the actual schedule-import script.

## Stops and live data

- `src/data/network.ts` contains the reference map’s names, positions, explicit aliases and stable note steps. `src/data/gtfs-stops.json` groups every row in the official tram `stops.txt` by its exact trimmed `stop_name`. Each platform ID is checked for unique ownership.
- The checked-in mapping was generated on **21 September 2026**. Teatr Słowackiego has four IDs, all mapped to one sound. Stops missing from the active schedule, including Teatr Bagatela in this snapshot, remain visible and manually playable. New stops not present in the supplied diagram are not invented on the map.
- `GET /api/arrivals` fetches `VehiclePositions_T.pb` with an eight-second timeout, decodes protobuf, validates fresh complete `STOPPED_AT` records, and resolves platform IDs to logical stops. Upstream failure returns HTTP 502 with `{ "error": "feed_unavailable" }`.
- The browser polls approximately every ten seconds and replays the **entire snapshot**, including vehicles already heard on a previous poll. A tram that remains at a platform sounds again in the next phrase. Duplicate records within one snapshot are deduplicated by `(vehicleId, tripId, stopSequence)`; separate trams at the same logical stop remain separate notes. Out-of-order snapshots are ignored; an unchanged timestamp is replayable while the feed is still fresh. Hidden tabs stop polling and clear scheduled audio; startup, visibility resume and feed recovery silently prime the next snapshot.
- A ten-second sampled feed cannot guarantee detection of a stop served entirely between snapshots. This app does not infer missed arrivals.

Regenerate the mapping when the schedule changes, then rebuild/redeploy:

```sh
bun run refresh:stops
# Or use an already downloaded official ZIP:
ruby scripts/refresh-stops.rb /path/to/GTFS_KRK_T.zip
```

The importer needs Ruby’s standard library, `curl`, and `unzip`. Unknown names are not fuzzy-matched. Review explicit aliases when ZTP renames stops. In particular, the reference’s **Borek Fałęcki I → Solvay** and **Solvay → Kościuszkowców** are separate places ([official rename notice](https://www.krakow.pl/aktualnosci/284127%2C26%2Ckomunikat%2Cnowa_trasa_linii_513__zmiany_nazw_przystankow.html)). Centralna maps to Gałczyńskiego ([ZTP notice](https://ztp.krakow.pl/kmk/komunikaty/1012-2024)).

## Audio and v2 boundary

Native Web Audio uses one gesture-unlocked context, filtered triangle voices with attack/release ramps, map-based stereo positioning, smoothed master gain, and a compressor. Default tuning is C major pentatonic. Four scale choices and all twelve roots are available.

Each snapshot is spread across approximately 9.6 seconds on a 100 BPM grid. Notes within each eighth-note subdivision are evenly spaced (typically two notes, 150 ms apart), not squeezed into a short burst. Every valid vehicle record in the phrase plays once, with at most four notes per subdivision. Unusually large snapshots extend the phrase rather than dropping notes; subsequent phrases queue behind them. The eight-voice limit includes manual notes and future reservations. Extreme manual bursts wait for a voice rather than clipping or cutting an existing note. This is a musical replay of **trams currently stopped**, not an instant one-off arrival alert; a note may play roughly ten seconds after its snapshot was received.

Every trigger reaches `playStop(stopKey)` in `src/lib/audio.ts`. That is the replacement point for per-stop samples in v2. Sample assignment UI, sample loading, persistence, buses, and route planning are intentionally not implemented.

## Artwork

`public/tram-network.svg` is a true vector trace of the supplied PNG’s tram inks, not an embedded raster. Stop labels and accessible interactive groups are rendered in the inline SVG by `src/components/tram-map.tsx`. Railways, legends, route-number discs, branding, river, and non-stop annotations are removed. **Zajezdnia Nowa Huta remains because it is a named passenger tram stop**, not a depot symbol.

The development-only `scripts/trace-map.py` regenerates the vector from the original 3780 × 2992 reference, using Pillow, NumPy, and VTracer. Stop dots use native circles; the seven hollow tunnel lanes use measured Bézier centerlines with uniform strokes and crossing gaps instead of raster-traced edges. None of those packages or the source PNG is needed at runtime. The trace was checked against an aligned temporary source underlay; the raster is not shipped.

## Verification

Automated tests cover the CSV importer, platform ownership, whole-snapshot replay, within-snapshot deduplication, silent priming, invalid feeds, real timeout expiry, HTTP failure/recovery, scale pitches and scheduling limits. Lint, TypeScript and the production build pass.

Browser checks covered actual live arrivals, stop-dot clicks, Enter/Space previews, root/scale changes, mute, drag, wheel zoom, reset, and desktop (1440 × 900) and mobile-size (390 × 844) layouts without horizontal overflow. Physical multi-touch gestures and subjective sound quality still need a real-device listening check; viewport resizing is not a substitute for those.
