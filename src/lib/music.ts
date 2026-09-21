import { POLL_INTERVAL_MS } from "./arrivals";

export const ROOTS = [
  "C",
  "C♯",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];
export const SCALES = {
  "Major pentatonic": [0, 2, 4, 7, 9],
  "Minor pentatonic": [0, 3, 5, 7, 10],
  Major: [0, 2, 4, 5, 7, 9, 11],
  "Natural minor": [0, 2, 3, 5, 7, 8, 10],
};
export type ScaleName = keyof typeof SCALES;
export function pitch(step: number, root: number, scale: ScaleName) {
  const intervals = SCALES[scale];
  const midi =
    48 +
    root +
    intervals[step % intervals.length] +
    12 * Math.floor(step / intervals.length);
  return {
    frequency: 440 * 2 ** ((midi - 69) / 12),
    name: `${ROOTS[midi % 12]}${Math.floor(midi / 12) - 1}`,
  };
}

export const BEAT = 60 / 100 / 2;
export const NOTE_LENGTH = 0.24;
export function nextBeat(time: number) {
  return Math.ceil(time / BEAT) * BEAT;
}

// Fill almost the whole polling interval. Leave a subdivision for the note tail
// and grid alignment; unusually large snapshots extend rather than drop notes.
export function batchTimes(count: number, now: number): number[] {
  const first = nextBeat(now + 0.045);
  const subdivisions = Math.max(
    Math.floor(POLL_INTERVAL_MS / 1000 / BEAT) - 1,
    Math.ceil(count / 4),
  );
  const times: number[] = [];
  for (let beat = 0; beat < subdivisions; beat++) {
    const notes =
      Math.ceil(((beat + 1) * count) / subdivisions) -
      Math.ceil((beat * count) / subdivisions);
    for (let note = 0; note < notes; note++) {
      times.push(first + beat * BEAT + (note * BEAT) / notes);
    }
  }
  return times;
}

export type Reservation = { start: number; end: number; live: boolean };

// Check the entire note, including voices already scheduled to start later.
export function availableTime(
  voices: Reservation[],
  requested: number,
  live: boolean,
) {
  let time = requested;
  for (;;) {
    const overlapping = voices.filter(
      (v) => v.end > time && v.start < time + NOTE_LENGTH,
    );
    const conflict = [time, ...overlapping.map((v) => v.start)]
      .sort((a, b) => a - b)
      .find(
        (at) =>
          at >= time &&
          overlapping.filter((v) => v.start <= at && v.end > at).length >= 8,
      );
    const subdivision = Math.floor((time + 1e-8) / BEAT);
    const fullBeat =
      live &&
      voices.filter(
        (v) => v.live && Math.floor((v.start + 1e-8) / BEAT) === subdivision,
      ).length >= 4;
    if (conflict === undefined && !fullBeat) return time;
    const next =
      conflict === undefined
        ? time
        : Math.min(
            ...overlapping
              .filter((v) => v.start <= conflict && v.end > conflict)
              .map((v) => v.end),
          );
    time = live ? nextBeat(Math.max(time, next) + 0.001) : next + 0.001;
  }
}
