"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Role, stops, stopsByKey } from "@/data/network";
import {
  createSnapshotTracker,
  isArrivalSnapshot,
  nextPollDelay,
  POLL_INTERVAL_MS,
} from "@/lib/arrivals";
import { type AudioEngine, createAudioEngine } from "@/lib/audio";
import { ROOTS, SCALES, type ScaleName } from "@/lib/music";
import TramMap, { type MapHandle } from "./tram-map";

export default function TramApp({ network }: { network: ReactNode }) {
  const map = useRef<MapHandle>(null);
  const engine = useRef<AudioEngine | null>(null);
  const playing = useRef(false);
  const tracker = useRef(createSnapshotTracker());
  const [listening, setListening] = useState(false);
  const [root, setRoot] = useState(0);
  const [scale, setScale] = useState<ScaleName>("Major pentatonic");
  const [recent, setRecent] = useState<{
    label: string;
    note: string;
    role: Role;
    id: number;
  } | null>(null);
  const [error, setError] = useState("");

  const getEngine = useCallback(() => {
    if (!engine.current)
      engine.current = createAudioEngine((key, note) => {
        map.current?.pulse(key);
        const stop = stopsByKey.get(key);
        if (stop)
          setRecent({
            label: stop.label,
            note,
            role: stop.role,
            id: performance.now(),
          });
      });
    return engine.current;
  }, []);

  useEffect(() => {
    getEngine().tune(root, scale);
  }, [root, scale, getEngine]);

  useEffect(
    () => () => {
      void engine.current?.close();
      engine.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!listening) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    let disposed = false;
    let generation = 0;
    async function poll() {
      if (disposed || document.hidden) return;
      const current = ++generation;
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      let delay = POLL_INTERVAL_MS;
      try {
        const response = await fetch("/api/arrivals", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Feed unavailable");
        const snapshot: unknown = await response.json();
        if (
          !isArrivalSnapshot(snapshot) ||
          Date.now() - snapshot.generatedAt > 60000
        )
          throw new Error("Invalid snapshot");
        if (disposed || current !== generation || document.hidden) return;
        const arrivals = tracker.current.consume(snapshot);
        if (playing.current)
          engine.current?.playSnapshot(arrivals.map((event) => event.stopKey));
        // Ask again before the queued phrase runs out, so the next phrase
        // chains onto the grid without a gap.
        delay = nextPollDelay(engine.current?.remaining() ?? 0);
      } catch {
        if (!disposed && current === generation && !document.hidden) {
          tracker.current.primeNext();
        }
      } finally {
        clearTimeout(timeout);
        if (!disposed && current === generation && !document.hidden)
          timer = setTimeout(poll, delay);
      }
    }
    // Coming back to the tab, or to the window with a suspended audio context:
    // resume it and play the current snapshot straight away. A browser can
    // refuse to resume audio outside a gesture (iOS does), so keep listening
    // and let the next tap or key press finish the job.
    function gesture() {
      void revive();
    }
    function armGesture(on: boolean) {
      for (const type of ["pointerdown", "keydown"] as const) {
        document.removeEventListener(type, gesture);
        if (on) document.addEventListener(type, gesture, { once: true });
      }
    }
    async function revive() {
      armGesture(false);
      if (disposed || !playing.current) return;
      try {
        await engine.current?.unlock();
      } catch {
        if (disposed) return;
        setError("Tap anywhere to resume audio.");
        armGesture(true);
        return;
      }
      if (disposed) return;
      setError("");
      ++generation;
      clearTimeout(timer);
      request?.abort();
      void poll();
    }
    function visibility() {
      ++generation;
      clearTimeout(timer);
      request?.abort();
      engine.current?.clear();
      if (!document.hidden) void revive();
    }
    function focus() {
      if (playing.current && !engine.current?.running()) void revive();
    }
    void poll();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    return () => {
      disposed = true;
      ++generation;
      clearTimeout(timer);
      request?.abort();
      armGesture(false);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", focus);
    };
  }, [listening]);

  const preview = useCallback(
    async (key: string) => {
      try {
        const audio = getEngine();
        await audio.unlock();
        setError("");
        audio.playStop(key);
      } catch {
        setError("Sound couldn’t start. Tap again to enable audio.");
      }
    },
    [getEngine],
  );

  async function toggleListening() {
    if (playing.current) {
      playing.current = false;
      setListening(false);
      engine.current?.clear();
      return;
    }
    try {
      await getEngine().unlock();
      playing.current = true;
      setListening(true);
      setError("");
    } catch {
      setError("Sound couldn’t start. Tap again to enable audio.");
    }
  }

  return (
    <main className="instrument">
      <a className="skip-link" href="#sound-controls">
        Skip to sound controls
      </a>
      <TramMap ref={map} network={network} onPreview={preview} />
      <div className="bottom-ui">
        <footer className="console" id="sound-controls" tabIndex={-1}>
          <div className="transport">
            <button
              type="button"
              className={`listen-button ${listening ? "listening" : ""}`}
              aria-pressed={listening}
              aria-label={listening ? "Pause listening" : "Start listening"}
              onClick={toggleListening}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                {listening ? (
                  <path d="M5 4h3v12H5zm7 0h3v12h-3z" />
                ) : (
                  <path d="m6 3 11 7-11 7V3Z" />
                )}
              </svg>
              <span>{listening ? "Pause listening" : "Start listening"}</span>
            </button>
          </div>
          <div className="tuning-controls">
            <label className="control root-control">
              <span>KEY</span>
              <select
                value={root}
                onChange={(e) => setRoot(Number(e.target.value))}
              >
                {ROOTS.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="control scale-control">
              <span>SCALE</span>
              <select
                value={scale}
                onChange={(e) => setScale(e.target.value as ScaleName)}
              >
                {Object.keys(SCALES).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="now-playing">
            <span className="eyebrow">
              {recent ? "LAST NOTE" : "READY TO PLAY"}
            </span>
            {recent ? (
              <div className="recent-note" key={recent.id}>
                <span className="note-chip" data-role={recent.role}>
                  {recent.note}
                </span>
                <span>{recent.label}</span>
              </div>
            ) : (
              <div className="ready-text">
                {stops.length} stops. Five voices.
              </div>
            )}
          </div>
          {error && (
            <p className="audio-error" role="alert">
              {error}
            </p>
          )}
        </footer>
      </div>
    </main>
  );
}
