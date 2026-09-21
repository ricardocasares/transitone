"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { stops, stopsByKey } from "@/data/network";
import {
  createSnapshotTracker,
  isArrivalSnapshot,
  POLL_INTERVAL_MS,
} from "@/lib/arrivals";
import { type AudioEngine, createAudioEngine } from "@/lib/audio";
import { ROOTS, SCALES, type ScaleName } from "@/lib/music";
import TramMap, { type MapHandle } from "./tram-map";

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6l5 4V5Z" />
      {muted ? (
        <path d="m16 9 6 6m0-6-6 6" />
      ) : (
        <>
          <path d="M15 8a6 6 0 0 1 0 8" />
          <path d="M18 5a10 10 0 0 1 0 14" />
        </>
      )}
    </svg>
  );
}

export default function TramApp({ network }: { network: ReactNode }) {
  const map = useRef<MapHandle>(null);
  const engine = useRef<AudioEngine | null>(null);
  const playing = useRef(false);
  const tracker = useRef(createSnapshotTracker());
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [root, setRoot] = useState(0);
  const [scale, setScale] = useState<ScaleName>("Major pentatonic");
  const [volume, setVolume] = useState(0.55);
  const [status, setStatus] = useState<
    "connecting" | "live" | "retrying" | "paused"
  >("connecting");
  const [updated, setUpdated] = useState<number | null>(null);
  const [recent, setRecent] = useState<{
    label: string;
    note: string;
    id: number;
  } | null>(null);
  const [error, setError] = useState("");

  const getEngine = useCallback(() => {
    if (!engine.current)
      engine.current = createAudioEngine((key, note) => {
        map.current?.pulse(key);
        const stop = stopsByKey.get(key);
        if (stop) setRecent({ label: stop.label, note, id: performance.now() });
      });
    return engine.current;
  }, []);

  useEffect(() => {
    getEngine().tune(root, scale);
  }, [root, scale, getEngine]);
  useEffect(() => {
    getEngine().setVolume(volume);
  }, [volume, getEngine]);
  useEffect(() => {
    getEngine().setMuted(muted);
  }, [muted, getEngine]);

  useEffect(() => {
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
        setStatus("live");
        setUpdated(snapshot.generatedAt);
        if (playing.current)
          engine.current?.playSnapshot(arrivals.map((event) => event.stopKey));
      } catch {
        if (!disposed && current === generation && !document.hidden) {
          setStatus("retrying");
          tracker.current.primeNext();
        }
      } finally {
        clearTimeout(timeout);
        if (!disposed && current === generation && !document.hidden)
          timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }
    function visibility() {
      ++generation;
      clearTimeout(timer);
      request?.abort();
      engine.current?.clear();
      tracker.current.primeNext();
      if (document.hidden) setStatus("paused");
      else {
        setStatus("connecting");
        if (playing.current) {
          void engine.current?.unlock().catch(() => {
            if (disposed) return;
            playing.current = false;
            setListening(false);
            setError("Tap Start listening to resume audio.");
          });
        }
        void poll();
      }
    }
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      ++generation;
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", visibility);
      void engine.current?.close();
      engine.current = null;
    };
  }, []);

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

  const statusLabel = {
    connecting: "Connecting",
    live: "Live from Kraków",
    retrying: "Reconnecting",
    paused: "Updates paused",
  }[status];
  return (
    <main className="instrument">
      <a className="skip-link" href="#sound-controls">
        Skip to sound controls
      </a>
      <header className="app-header">
        <div className="identity">
          <svg
            className="brand-mark"
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M8 4v14c0 4 3 7 7 7h9M15 4v12c0 1.1.9 2 2 2h7M22 4v7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle
              cx="8"
              cy="8"
              r="2.5"
              fill="var(--surface)"
              stroke="currentColor"
            />
            <circle
              cx="15"
              cy="8"
              r="2.5"
              fill="var(--surface)"
              stroke="currentColor"
            />
            <circle
              cx="22"
              cy="8"
              r="2.5"
              fill="var(--surface)"
              stroke="currentColor"
            />
          </svg>
          <div>
            <h1>
              Kraków <span>Tram Tones</span>
            </h1>
            <p>A city in motion. A melody in the making.</p>
          </div>
        </div>
        <output
          className={`feed-state ${status}`}
          title={
            updated
              ? `Last feed: ${new Date(updated).toLocaleTimeString("en-GB", { timeZone: "Europe/Warsaw" })} Warsaw time`
              : undefined
          }
        >
          <span className="status-dot" />
          {statusLabel}
        </output>
      </header>
      <TramMap ref={map} network={network} onPreview={preview} />
      <footer className="console" id="sound-controls" tabIndex={-1}>
        <div className="transport">
          <button
            type="button"
            className={`listen-button ${listening ? "listening" : ""}`}
            aria-pressed={listening}
            onClick={toggleListening}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              {listening ? (
                <path d="M5 4h3v12H5zm7 0h3v12h-3z" />
              ) : (
                <path d="m6 3 11 7-11 7V3Z" />
              )}
            </svg>
            {listening ? "Pause listening" : "Start listening"}
          </button>
          <span className="transport-caption">
            {listening ? "Let the city compose" : "Or tap a stop to play"}
          </span>
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
        <div className="volume-control">
          <button
            type="button"
            className="icon-button"
            aria-label={muted ? "Unmute sound" : "Mute sound"}
            aria-pressed={muted}
            onClick={() => setMuted(!muted)}
          >
            <SoundIcon muted={muted || volume === 0} />
          </button>
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ "--level": `${volume * 100}%` } as CSSProperties}
          />
        </div>
        <div className="now-playing">
          <span className="eyebrow">
            {recent ? "LAST NOTE" : "READY TO PLAY"}
          </span>
          {recent ? (
            <div className="recent-note" key={recent.id}>
              <span className="note-chip">{recent.note}</span>
              <span>{recent.label}</span>
            </div>
          ) : (
            <div className="ready-text">
              {stops.length} stops. One instrument.
            </div>
          )}
        </div>
        {error && (
          <p className="audio-error" role="alert">
            {error}
          </p>
        )}
      </footer>
      <div className="micro-footer">
        <span>Snapshot replay · 100 BPM</span>
        <a href="https://gtfs.ztp.krakow.pl/" target="_blank" rel="noreferrer">
          Live data by ZTP Kraków <span aria-hidden="true">↗</span>
        </a>
      </div>
    </main>
  );
}
