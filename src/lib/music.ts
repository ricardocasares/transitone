import type { Role } from "@/data/network";
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
export function pitch(
  step: number,
  root: number,
  scale: ScaleName,
  offset = 0,
) {
  const intervals = SCALES[scale];
  const midi =
    48 +
    offset +
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
// How long each voice holds one of the eight slots. Percussion is short, so a
// busy hi-hat stop never crowds out melodic notes.
export const ROLE_LENGTH: Record<Role, number> = {
  kick: 0.2,
  snare: 0.14,
  hihat: 0.05,
  bass: NOTE_LENGTH,
  lead: NOTE_LENGTH,
};
export const NOTES_PER_BEAT = 4;
export function nextBeat(time: number) {
  return Math.ceil(time / BEAT) * BEAT;
}

// Fill almost the whole polling interval. Leave a subdivision for the note tail
// and grid alignment; unusually large snapshots extend rather than drop notes.
export function phraseLength(count: number) {
  return Math.max(
    Math.floor(POLL_INTERVAL_MS / 1000 / BEAT) - 1,
    Math.ceil(count / NOTES_PER_BEAT),
  );
}

// Eighth-note grid in 4/4: a bar is eight subdivisions. Each role lists where it
// would rather land, best first; later tiers only take spill-over.
const PLACEMENT: Record<Role, number[][]> = {
  kick: [
    [0, 4],
    [2, 6],
    [1, 3, 5, 7],
  ],
  snare: [
    [2, 6],
    [0, 4],
    [1, 3, 5, 7],
  ],
  bass: [
    [0, 4],
    [2, 6],
    [1, 3, 5, 7],
  ],
  hihat: [
    [1, 3, 5, 7],
    [0, 2, 4, 6],
  ],
  lead: [[0, 1, 2, 3, 4, 5, 6, 7]],
};
const ORDER: Role[] = ["kick", "snare", "bass", "hihat", "lead"];

// Arrange one snapshot on the grid. Each role spreads its notes evenly over its
// preferred beats across the whole phrase (four kicks land on four downbeats),
// so kick and bass share a beat rather than avoiding each other. Every note is
// kept, at most NOTES_PER_BEAT per subdivision, evenly spaced inside it.
export function arrangeTimes(roles: Role[], now: number): number[] {
  const first = nextBeat(now + 0.045);
  const subdivisions = phraseLength(roles.length);
  const slots: number[][] = Array.from({ length: subdivisions }, () => []);
  const all = slots.map((_, index) => index);
  const hasRoom = (index: number) => slots[index].length < NOTES_PER_BEAT;
  for (const role of ORDER) {
    const notes = roles.flatMap((r, index) => (r === role ? [index] : []));
    const tiers = [
      ...PLACEMENT[role].map((tier) =>
        all.filter((index) => tier.includes(index % 8)),
      ),
      all,
    ];
    notes.forEach((note, i) => {
      for (const tier of tiers) {
        const target = Math.floor((i * tier.length) / notes.length);
        // Walk forward (wrapping) from the even-spread target to the next open beat.
        const open = tier
          .map((_, step) => tier[(target + step) % tier.length])
          .find(hasRoom);
        if (open !== undefined) {
          slots[open].push(note);
          return;
        }
      }
    });
  }
  const times = new Array<number>(roles.length);
  slots.forEach((notes, beat) => {
    notes.forEach((note, i) => {
      times[note] = first + beat * BEAT + (i * BEAT) / notes.length;
    });
  });
  return times;
}

export function batchTimes(count: number, now: number): number[] {
  return arrangeTimes(
    Array.from({ length: count }, () => "lead"),
    now,
  );
}

export type Reservation = { start: number; end: number; live: boolean };

// Check the entire note, including voices already scheduled to start later.
export function availableTime(
  voices: Reservation[],
  requested: number,
  live: boolean,
  length = NOTE_LENGTH,
) {
  let time = requested;
  for (;;) {
    const overlapping = voices.filter(
      (v) => v.end > time && v.start < time + length,
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
      ).length >= NOTES_PER_BEAT;
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
