import { expect, test } from "bun:test";
import { INITIAL, resizeView, zoomView } from "./map-view";

test("map fits desktop width or mobile height and can zoom out to show the whole network", () => {
  for (const [aspect, fit] of [
    [16 / 9, "width"],
    [375 / 812, "height"],
  ] as const) {
    const view = resizeView(INITIAL, aspect, fit);
    expect(view[fit]).toBeCloseTo(INITIAL[fit]);
    expect(view.width / view.height).toBeCloseTo(aspect);
    const center = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    expect(center.x).toBeCloseTo(INITIAL.x + INITIAL.width / 2);
    expect(center.y).toBe(INITIAL.y + INITIAL.height / 2);
    const out = zoomView(view, 100, center);
    expect(out.width).toBeGreaterThanOrEqual(INITIAL.width);
    expect(out.height).toBeGreaterThanOrEqual(INITIAL.height);
    expect(out.y + out.height / 2).toBeCloseTo(center.y);
    const inside = zoomView(view, 0.001, center);
    expect(inside.width).toBe(INITIAL.width / 8);
    expect(inside.width / inside.height).toBeCloseTo(aspect);
    const resized = resizeView(inside, aspect * 1.1, fit);
    expect(resized[fit]).toBeCloseTo(inside[fit]);
  }
});
