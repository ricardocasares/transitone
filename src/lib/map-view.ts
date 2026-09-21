export const INITIAL = { x: 90, y: 75, width: 1590, height: 1200 };
export type View = typeof INITIAL;
type Point = { x: number; y: number };

export function resizeView(view: View, aspect: number): View {
  const height = view.width / aspect;
  return { ...view, y: view.y + (view.height - height) / 2, height };
}

export function zoomView(view: View, factor: number, anchor: Point): View {
  const maxWidth = Math.max(
    INITIAL.width,
    (INITIAL.height * view.width) / view.height,
  );
  const width = Math.max(
    INITIAL.width / 8,
    Math.min(maxWidth, view.width * factor),
  );
  const ratio = width / view.width;
  return {
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
    width,
    height: view.height * ratio,
  };
}
