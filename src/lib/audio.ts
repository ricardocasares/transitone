import { stopsByKey } from "@/data/network";
import {
  availableTime,
  batchTimes,
  NOTE_LENGTH,
  pitch,
  type ScaleName,
} from "./music";

type Voice = {
  oscillator: OscillatorNode;
  gain: GainNode;
  start: number;
  end: number;
  live: boolean;
};
export function createAudioEngine(
  onPlay: (stopKey: string, note: string) => void,
) {
  let context: AudioContext | undefined;
  let master: GainNode;
  let compressor: DynamicsCompressorNode;
  let volume = 0.55;
  let root = 0;
  let scale: ScaleName = "Major pentatonic";
  let muted = false;
  let queueEnd = 0;
  let voices: Voice[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();

  async function unlock() {
    if (!context) {
      context = new AudioContext({ latencyHint: "interactive" });
      master = context.createGain();
      compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      master.gain.value = muted ? 0 : volume * 0.65;
      compressor.connect(master).connect(context.destination);
    }
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") throw new Error("Audio could not start");
  }

  function playStop(stopKey: string, requestedTime?: number) {
    const stop = stopsByKey.get(stopKey);
    if (!context || context.state !== "running" || !stop || muted) return;
    const now = context.currentTime;
    voices = voices.filter((voice) => voice.end > now);
    const live = requestedTime !== undefined;
    const time = availableTime(
      voices,
      Math.max(requestedTime ?? now + 0.012, now + 0.012),
      live,
    );
    const note = pitch(stop.noteStep, root, scale);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const pan = context.createStereoPanner();
    oscillator.type = "triangle";
    oscillator.frequency.value = note.frequency;
    filter.type = "lowpass";
    filter.frequency.value = Math.min(note.frequency * 3, 5000);
    pan.pan.value = Math.max(-0.7, Math.min(0.7, (stop.x - 870) / 1000));
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.14, time + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.001, time + NOTE_LENGTH - 0.02);
    gain.gain.linearRampToValueAtTime(0, time + NOTE_LENGTH);
    oscillator.connect(filter).connect(gain).connect(pan).connect(compressor);
    const voice = {
      oscillator,
      gain,
      start: time,
      end: time + NOTE_LENGTH,
      live,
    };
    voices.push(voice);
    oscillator.start(time);
    oscillator.stop(voice.end);
    oscillator.onended = () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
      pan.disconnect();
      voices = voices.filter((item) => item !== voice);
    };
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        if (!muted) onPlay(stopKey, note.name);
      },
      Math.max(0, (time - context.currentTime) * 1000),
    );
    timers.add(timer);
    return time;
  }

  function clear() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (!context) return;
    const now = context.currentTime;
    for (const voice of voices) {
      voice.gain.gain.cancelAndHoldAtTime(now);
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.015);
      voice.oscillator.stop(now + 0.02);
    }
    voices = [];
    queueEnd = 0;
  }

  return {
    unlock,
    playStop,
    playArrivals(keys: string[]) {
      if (!context || context.state !== "running" || muted) return;
      const times = batchTimes(
        keys.length,
        Math.max(context.currentTime, queueEnd),
      );
      keys.forEach((key, index) => {
        queueEnd = Math.max(queueEnd, playStop(key, times[index]) ?? 0);
      });
    },
    tune(nextRoot: number, nextScale: ScaleName) {
      clear();
      root = nextRoot;
      scale = nextScale;
    },
    setVolume(next: number) {
      volume = next;
      if (context)
        master.gain.setTargetAtTime(
          muted ? 0 : volume * 0.65,
          context.currentTime,
          0.02,
        );
    },
    setMuted(next: boolean) {
      muted = next;
      if (next) clear();
      if (context)
        master.gain.setTargetAtTime(
          next ? 0 : volume * 0.65,
          context.currentTime,
          0.015,
        );
    },
    clear,
    async close() {
      clear();
      await context?.close();
      context = undefined;
    },
  };
}
export type AudioEngine = ReturnType<typeof createAudioEngine>;
