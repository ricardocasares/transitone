import { ROLES, type Role } from "@/data/network";

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
// How long each voice holds one of the voice slots. Percussion is short, so a
// busy hi-hat stop never crowds out melodic notes.
export const ROLE_LENGTH: Record<Role, number> = {
  kick: 0.2,
  snare: 0.14,
  hihat: 0.05,
  bass: NOTE_LENGTH,
  lead: NOTE_LENGTH,
};
// Eighth-note grid in 4/4: a bar is eight steps.
export const STEPS_PER_BAR = 8;
// How many notes of one role may share a step. Two identical drum hits at the
// same instant are only one louder hit, so percussion and bass spread out
// instead; leads stack into a chord.
export const STEP_CAPACITY: Record<Role, number> = {
  kick: 1,
  snare: 1,
  hihat: 1,
  bass: 1,
  lead: 3,
};
// Voices sounding at once, counting manual notes and future reservations. A
// full step is at most seven voices (kick, snare, hi-hat, bass and a three-note
// lead chord), which leaves room for manual previews on top.
export const MAX_VOICES = 16;
export function nextBeat(time: number) {
  return Math.ceil(time / BEAT) * BEAT;
}

// Four bars sit just inside the feed's ten-second update cadence, so chained
// phrases stay fresh. A snapshot with more notes of one role than its steps
// can hold extends the phrase by whole bars rather than dropping notes.
export const PHRASE_BARS = 4;
export function phraseLength(roles: Role[]) {
  const counts = new Map<Role, number>();
  for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1);
  const needed = Math.max(
    0,
    ...[...counts].map(([role, count]) =>
      Math.ceil(count / STEP_CAPACITY[role]),
    ),
  );
  return (
    Math.max(PHRASE_BARS, Math.ceil(needed / STEPS_PER_BAR)) * STEPS_PER_BAR
  );
}

// Each role lists where in the bar it would rather land, best first; later
// tiers only take spill-over.
const PLACEMENT: Record<Role, number[][]> = {
  kick: [
    [0, 4],
    [2, 6],
    [1, 3, 5, 7],
  ],
  snare: [
    [2, 6],
    [1, 3, 5, 7],
    [0, 4],
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
// Snares accent the backbeat; anywhere else they play as ghost notes, so a loop
// full of laid-over trams adds texture rather than a snare on every eighth.
export const GHOST_LEVEL = 0.3;
export function accent(role: Role, step: number) {
  return role === "snare" && !PLACEMENT.snare[0].includes(step % STEPS_PER_BAR)
    ? GHOST_LEVEL
    : 1;
}
export type Placement = { time: number; level: number };

// Arrange one snapshot on the grid like a step sequencer: every note in a step
// starts at the same instant, so a kick, its bass note and a hi-hat hit
// together instead of one after another. Each role spreads its notes evenly
// over its preferred steps across the whole phrase (four kicks land on the
// four downbeats) and spills to the next preference only when those steps are
// taken. Capacity is per role, so roles never push each other off a step and
// kick and bass share a beat rather than avoiding each other.
export function arrange(roles: Role[], now: number): Placement[] {
  const first = nextBeat(now + 0.045);
  const steps = phraseLength(roles);
  const all = Array.from({ length: steps }, (_, index) => index);
  const placements = new Array<Placement>(roles.length);
  for (const role of ROLES) {
    const notes = roles.flatMap((r, index) => (r === role ? [index] : []));
    const taken = new Array<number>(steps).fill(0);
    const tiers = [
      ...PLACEMENT[role].map((tier) =>
        all.filter((index) => tier.includes(index % STEPS_PER_BAR)),
      ),
      all,
    ];
    notes.forEach((note, i) => {
      for (const tier of tiers) {
        const target = Math.floor((i * tier.length) / notes.length);
        // Walk forward (wrapping) from the even-spread target to the next open step.
        const open = tier
          .map((_, step) => tier[(target + step) % tier.length])
          .find((index) => taken[index] < STEP_CAPACITY[role]);
        if (open !== undefined) {
          taken[open]++;
          placements[note] = {
            time: first + open * BEAT,
            level: accent(role, open),
          };
          return;
        }
      }
    });
  }
  return placements;
}
export function arrangeTimes(roles: Role[], now: number): number[] {
  return arrange(roles, now).map((placement) => placement.time);
}

export function batchTimes(count: number, now: number): number[] {
  return arrangeTimes(
    Array.from({ length: count }, () => "lead"),
    now,
  );
}

export type Reservation = { start: number; end: number };

// First time at or after `requested` where the whole note fits under the voice
// cap, counting voices already scheduled to start later. Live notes keep to
// the grid when they have to wait; manual previews start as soon as a voice
// frees up. Step capacity itself is settled by arrangeTimes.
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
          overlapping.filter((v) => v.start <= at && v.end > at).length >=
            MAX_VOICES,
      );
    if (conflict === undefined) return time;
    const next = Math.min(
      ...overlapping
        .filter((v) => v.start <= conflict && v.end > conflict)
        .map((v) => v.end),
    );
    time = live ? nextBeat(next + 0.001) : next + 0.001;
  }
}
