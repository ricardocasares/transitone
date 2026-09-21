"use client";

import {
  forwardRef,
  memo,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { mapStops, stopsByKey } from "@/data/network";
import { INITIAL, resizeView, type View, zoomView } from "@/lib/map-view";

type Point = { x: number; y: number };
export type MapHandle = { pulse: (key: string) => void };

const labelLines: Record<string, string[]> = {
  "Dworzec Towarowy": ["Dworzec", "Towarowy"],
  "Dworzec Główny Tunel": ["Dworzec", "Główny", "Tunel"],
  "Dworzec Główny Zachód": ["Dworzec", "Główny", "Zachód"],
  "Plac Wszystkich Świętych": ["Plac", "Wszystkich", "Świętych"],
  "Plac Bohaterów Getta": ["Plac Bohaterów", "Getta"],
  "Cmentarz Podgórski": ["Cmentarz", "Podgórski"],
  "Dworzec Płaszów Estakada": ["Dworzec Płaszów", "Estakada"],
  "Sanktuarium Bożego Miłosierdzia": ["Sanktuarium", "Bożego", "Miłosierdzia"],
  "Plac Centralny": ["Plac", "Centralny"],
  "Zajezdnia Nowa Huta": ["Zajezdnia", "NOWA HUTA"],
  "św. Gertrudy": ["św.", "Gertrudy"],
};

const TramMap = memo(
  forwardRef<
    MapHandle,
    { network: ReactNode; onPreview: (key: string) => void }
  >(function TramMap({ network, onPreview }, ref) {
    const svg = useRef<SVGSVGElement>(null);
    const view = useRef(INITIAL);
    const pointers = useRef(new Map<number, Point>());
    const dragged = useRef(false);
    const start = useRef<Point | null>(null);
    const frame = useRef<number | null>(null);

    function apply(next: View) {
      view.current = next;
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const v = view.current;
        svg.current?.setAttribute(
          "viewBox",
          `${v.x} ${v.y} ${v.width} ${v.height}`,
        );
      });
    }

    function point(client: Point): Point {
      const matrix = svg.current?.getScreenCTM();
      if (!matrix) return client;
      return new DOMPoint(client.x, client.y).matrixTransform(matrix.inverse());
    }

    function zoomAt(factor: number, anchor: Point) {
      apply(zoomView(view.current, factor, anchor));
    }

    useImperativeHandle(
      ref,
      () => ({
        pulse(key) {
          const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          for (const node of svg.current?.querySelectorAll<SVGGElement>(
            `[data-stop-key="${key}"]`,
          ) ?? []) {
            const ring = node.querySelector<SVGCircleElement>(".stop-pulse");
            if (ring) {
              for (const animation of ring.getAnimations()) animation.cancel();
              ring.animate(
                reduced
                  ? [{ opacity: 1 }, { opacity: 0 }]
                  : [
                      { opacity: 0.95, transform: "scale(0.5)" },
                      { opacity: 0, transform: "scale(3.3)" },
                    ],
                {
                  duration: reduced ? 500 : 1100,
                  easing: "cubic-bezier(.2,.7,.2,1)",
                },
              );
            }
            node
              .querySelector("text")
              ?.animate([{ fill: "#e5ffd8" }, { fill: "#d2cddb" }], {
                duration: 1100,
              });
          }
        },
      }),
      [],
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: viewport functions only read stable refs
    useEffect(() => {
      const element = svg.current;
      if (!element) return;
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0)
          apply(
            resizeView(
              view.current,
              width / height,
              width <= 760 ? "height" : "width",
            ),
          );
      });
      observer.observe(element);
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        zoomAt(
          Math.exp(Math.max(-200, Math.min(200, event.deltaY)) * 0.002),
          point({ x: event.clientX, y: event.clientY }),
        );
      };
      element.addEventListener("wheel", wheel, { passive: false });
      return () => {
        observer.disconnect();
        element.removeEventListener("wheel", wheel);
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      };
    }, []);

    return (
      <div className="map-stage">
        <svg
          ref={svg}
          className="network-map"
          viewBox={`${INITIAL.x} ${INITIAL.y} ${INITIAL.width} ${INITIAL.height}`}
          aria-label="Interactive Kraków tram network. Select a stop to hear its note."
          onPointerDown={(event) => {
            if (event.button !== 0 && event.pointerType === "mouse") return;
            pointers.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });
            if (pointers.current.size === 1) {
              start.current = { x: event.clientX, y: event.clientY };
              dragged.current = false;
            } else dragged.current = true;
          }}
          onPointerMove={(event) => {
            const previous = pointers.current.get(event.pointerId);
            if (!previous) return;
            const current = { x: event.clientX, y: event.clientY };
            if (
              start.current &&
              Math.hypot(
                current.x - start.current.x,
                current.y - start.current.y,
              ) > 5
            ) {
              dragged.current = true;
              svg.current?.setPointerCapture(event.pointerId);
            }
            if (!dragged.current) return;
            const other = [...pointers.current.entries()].find(
              ([id]) => id !== event.pointerId,
            )?.[1];
            if (other) {
              const oldDistance = Math.hypot(
                previous.x - other.x,
                previous.y - other.y,
              );
              const newDistance = Math.hypot(
                current.x - other.x,
                current.y - other.y,
              );
              const oldMid = point({
                x: (previous.x + other.x) / 2,
                y: (previous.y + other.y) / 2,
              });
              const newMid = point({
                x: (current.x + other.x) / 2,
                y: (current.y + other.y) / 2,
              });
              if (newDistance > 5 && oldDistance > 5)
                zoomAt(oldDistance / newDistance, oldMid);
              apply({
                ...view.current,
                x: view.current.x + oldMid.x - newMid.x,
                y: view.current.y + oldMid.y - newMid.y,
              });
            } else {
              const before = point(previous);
              const after = point(current);
              apply({
                ...view.current,
                x: view.current.x + before.x - after.x,
                y: view.current.y + before.y - after.y,
              });
            }
            pointers.current.set(event.pointerId, current);
          }}
          onPointerUp={(event) => {
            pointers.current.delete(event.pointerId);
          }}
          onPointerCancel={(event) => {
            pointers.current.delete(event.pointerId);
            dragged.current = true;
          }}
          onLostPointerCapture={(event) => {
            // Ignore implicit capture transferring from a stop to the root SVG.
            if (event.target === svg.current)
              pointers.current.delete(event.pointerId);
          }}
          onPointerLeave={(event) => {
            if (!svg.current?.hasPointerCapture(event.pointerId))
              pointers.current.delete(event.pointerId);
          }}
        >
          <title>Kraków tram network</title>
          <desc>
            Each named stop is an instrument. All directions and platforms play
            the same note. Drag to pan; scroll or pinch to zoom.
          </desc>
          {network}
          {mapStops.map((stop) => (
            // biome-ignore lint/a11y/useSemanticElements: native HTML buttons cannot be placed inside SVG; keyboard activation is provided
            <g
              key={`${stop.key}-${stop.x}`}
              className={`map-stop${stop.hub ? " interchange" : ""}`}
              data-stop-key={stop.key}
              role="button"
              tabIndex={0}
              aria-label={`Play ${stop.label}`}
              onFocus={(event) => {
                if (!event.currentTarget.matches(":focus-visible")) return;
                const v = view.current;
                if (
                  stop.x < v.x + 25 ||
                  stop.x > v.x + v.width - 25 ||
                  stop.y < v.y + 25 ||
                  stop.y > v.y + v.height - 25
                ) {
                  apply({
                    ...v,
                    x: stop.x - v.width / 2,
                    y: stop.y - v.height / 2,
                  });
                }
              }}
              onClick={(event) => {
                if (event.detail === 0 || !dragged.current) onPreview(stop.key);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPreview(stop.key);
                }
              }}
            >
              <title>
                {`${stop.label} · ${stopsByKey.get(stop.key)?.gtfsStopIds.length || "No current"} platforms`}
              </title>
              <circle
                className="stop-pulse"
                cx={stop.x}
                cy={stop.y}
                r={12}
                style={{ transformOrigin: `${stop.x}px ${stop.y}px` }}
              />
              <circle className="stop-focus" cx={stop.x} cy={stop.y} r={11} />
              <circle
                className="stop-hit"
                cx={stop.x}
                cy={stop.y}
                r={stop.hub ? 30 : 20}
              />
              <text
                x={stop.labelX}
                y={stop.labelY}
                textAnchor={stop.anchor}
                transform={
                  stop.angle
                    ? `rotate(${stop.angle},${stop.labelX},${stop.labelY})`
                    : undefined
                }
              >
                {(labelLines[stop.label] ?? [stop.label]).map((line, index) => (
                  <tspan key={line} x={stop.labelX} dy={index ? 11.5 : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  }),
);

export default TramMap;
