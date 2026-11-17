/**
 * Local pan & zoom of the map. Pure maths, not shared with other clients.
 *
 * A view maps map pixels to screen pixels: screen = map * zoom + (x, y).
 */
export interface View {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const DEFAULT_VIEW: View = { x: 0, y: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToMap(view: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom };
}

export function mapToScreen(view: View, mx: number, my: number): { x: number; y: number } {
  return { x: mx * view.zoom + view.x, y: my * view.zoom + view.y };
}

/** Zooms by `factor` keeping the map point under the screen point (sx, sy) fixed. */
export function zoomAt(view: View, factor: number, sx: number, sy: number): View {
  const zoom = clampZoom(view.zoom * factor);
  const anchor = screenToMap(view, sx, sy);
  return { zoom, x: sx - anchor.x * zoom, y: sy - anchor.y * zoom };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** Zoom factor for one wheel event (deltaY > 0 = zoom out). */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015);
}
