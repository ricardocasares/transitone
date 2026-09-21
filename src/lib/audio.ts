import { ROLES, type Role, stopsByKey } from "@/data/network";
import {
  arrangeTimes,
  availableTime,
  pitch,
  ROLE_LENGTH,
  type ScaleName,
} from "./music";

type Voice = {
  stopKey: string;
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
  gain: GainNode;
  start: number;
  end: number;
  live: boolean;
};
// Per-role bus levels into the shared compressor.
const BUS_LEVEL: Record<Role, number> = {
  kick: 0.9,
  snare: 0.55,
  hihat: 0.35,
  bass: 0.8,
  lead: 1,
};
export function createAudioEngine(
  onPlay: (stopKey: string, note: string) => void,
) {
  let context: AudioContext | undefined;
  let compressor: DynamicsCompressorNode;
  let buses: Record<Role, GainNode>;
  let noise: AudioBuffer;
  let root = 0;
  let scale: ScaleName = "Major pentatonic";
  let queueEnd = 0;
  let voices: Voice[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();

  async function unlock() {
    if (!context) {
      // iOS routes Web Audio as "ambient" by default, so the ringer silent
      // switch mutes it. Ask for the playback category where supported.
      const session = (
        navigator as Navigator & { audioSession?: { type: string } }
      ).audioSession;
      if (session) session.type = "playback";
      context = new AudioContext({ latencyHint: "interactive" });
      const master = context.createGain();
      compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      master.gain.value = 0.65; // Full app volume, retaining the mix’s gain staging.
      compressor.connect(master).connect(context.destination);
      const ctx = context;
      buses = Object.fromEntries(
        ROLES.map((role) => {
          const bus = ctx.createGain();
          bus.gain.value = BUS_LEVEL[role];
          bus.connect(compressor);
          return [role, bus];
        }),
      ) as Record<Role, GainNode>;
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") throw new Error("Audio could not start");
  }

  function noiseSource(ctx: AudioContext) {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    return source;
  }
  function tone(ctx: AudioContext, type: OscillatorType, frequency: number) {
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    return oscillator;
  }
  // Each voice's envelope ends exactly at its ROLE_LENGTH reservation.
  function build(
    ctx: AudioContext,
    role: Role,
    step: number,
    time: number,
    gain: GainNode,
  ): { source: AudioScheduledSourceNode; nodes: AudioNode[]; name: string } {
    const g = gain.gain;
    const end = time + ROLE_LENGTH[role];
    switch (role) {
      case "kick": {
        const source = tone(ctx, "sine", 150);
        source.frequency.setValueAtTime(150, time);
        source.frequency.exponentialRampToValueAtTime(42, time + 0.06);
        g.setValueAtTime(0, time);
        g.linearRampToValueAtTime(0.9, time + 0.004);
        g.exponentialRampToValueAtTime(0.001, end - 0.01);
        g.linearRampToValueAtTime(0, end);
        source.connect(gain);
        return { source, nodes: [source], name: "Kick" };
      }
      case "snare": {
        const source = noiseSource(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 1800;
        filter.Q.value = 0.8;
        g.setValueAtTime(0, time);
        g.linearRampToValueAtTime(0.5, time + 0.003);
        g.exponentialRampToValueAtTime(0.001, end - 0.01);
        g.linearRampToValueAtTime(0, end);
        source.connect(filter).connect(gain);
        return { source, nodes: [source, filter], name: "Snare" };
      }
      case "hihat": {
        const source = noiseSource(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 7000;
        g.setValueAtTime(0, time);
        g.linearRampToValueAtTime(0.35, time + 0.002);
        g.exponentialRampToValueAtTime(0.001, end - 0.005);
        g.linearRampToValueAtTime(0, end);
        source.connect(filter).connect(gain);
        return { source, nodes: [source, filter], name: "Hi-hat" };
      }
      case "bass": {
        const note = pitch(step, root, scale, -12);
        const source = tone(ctx, "triangle", note.frequency);
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = Math.min(note.frequency * 4, 900);
        g.setValueAtTime(0, time);
        g.linearRampToValueAtTime(0.32, time + 0.01);
        g.exponentialRampToValueAtTime(0.001, end - 0.02);
        g.linearRampToValueAtTime(0, end);
        source.connect(filter).connect(gain);
        return { source, nodes: [source, filter], name: note.name };
      }
      case "lead": {
        const note = pitch(step, root, scale);
        const source = tone(ctx, "triangle", note.frequency);
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = Math.min(note.frequency * 3, 5000);
        g.setValueAtTime(0, time);
        g.linearRampToValueAtTime(0.14, time + 0.014);
        g.exponentialRampToValueAtTime(0.001, end - 0.02);
        g.linearRampToValueAtTime(0, end);
        source.connect(filter).connect(gain);
        return { source, nodes: [source, filter], name: note.name };
      }
    }
  }

  function playStop(stopKey: string, requestedTime?: number) {
    const stop = stopsByKey.get(stopKey);
    if (!context || context.state !== "running" || !stop) return;
    const now = context.currentTime;
    voices = voices.filter((voice) => voice.end > now);
    const live = requestedTime !== undefined;
    const time = availableTime(
      voices,
      Math.max(requestedTime ?? now + 0.012, now + 0.012),
      live,
      ROLE_LENGTH[stop.role],
    );
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    pan.pan.value = Math.max(-0.7, Math.min(0.7, (stop.x - 870) / 1000));
    const { source, nodes, name } = build(
      context,
      stop.role,
      stop.noteStep,
      time,
      gain,
    );
    gain.connect(pan).connect(buses[stop.role]);
    const voice = {
      stopKey,
      source,
      nodes: [...nodes, gain, pan],
      gain,
      start: time,
      end: time + ROLE_LENGTH[stop.role],
      live,
    };
    voices.push(voice);
    source.start(time);
    source.stop(voice.end);
    source.onended = () => {
      for (const node of voice.nodes) node.disconnect();
      voices = voices.filter((item) => item !== voice);
    };
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        onPlay(stopKey, name);
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
      voice.source.stop(now + 0.02);
    }
    voices = [];
    queueEnd = 0;
  }

  return {
    unlock,
    playStop,
    playSnapshot(keys: string[]) {
      if (!context || context.state !== "running") return;
      const times = arrangeTimes(
        keys.map((key) => stopsByKey.get(key)?.role ?? "lead"),
        Math.max(context.currentTime, queueEnd),
      );
      keys.forEach((key, index) => {
        queueEnd = Math.max(queueEnd, playStop(key, times[index]) ?? 0);
      });
    },
    tune(nextRoot: number, nextScale: ScaleName) {
      const pending = voices.filter(
        (voice) => voice.live && voice.start > (context?.currentTime ?? 0),
      );
      clear();
      // Drums are untuned, but the whole phrase is rebuilt to keep one path.
      root = nextRoot;
      scale = nextScale;
      // Keep the remaining phrase in place when its tuning changes.
      for (const voice of pending) {
        queueEnd = Math.max(
          queueEnd,
          playStop(voice.stopKey, voice.start) ?? 0,
        );
      }
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
