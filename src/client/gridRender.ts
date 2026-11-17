/**
 * Grid lines to draw for the visible part of the map.
 *
 * Drawing every line of a large, finely split grid makes panning slow,
 * especially zoomed in (thousands of long dashed lines, mostly off-screen).
 * So only the lines in view are built, in chunks of cells: while panning, the
 * same chunk range (and so the same path strings, cached) is reused until the
 * view crosses a chunk boundary. Sub-cell lines are left out when they would
 * be too close together on screen to be useful.
 */
import type { GridSettings } from "../shared/types.ts";

/** The visible area, in map pixels. */
export interface MapRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Lines are built for whole chunks of this many cells. */
export const GRID_CHUNK = 8;
/** Sub-cell lines are hidden when sub-cells are smaller than this on screen (px). */
export const MIN_SUB_CELL_SCREEN_PX = 6;

export interface GridPaths {
  main: string;
  sub: string;
}

function range(lo: number, hi: number, origin: number, size: number, count: number): [number, number] {
  const first = Math.floor(((lo - origin) / size) / GRID_CHUNK) * GRID_CHUNK;
  const last = Math.ceil(((hi - origin) / size) / GRID_CHUNK) * GRID_CHUNK;
  return [Math.max(0, Math.min(count, first)), Math.max(0, Math.min(count, last))];
}

let cacheKey = "";
let cacheValue: GridPaths = { main: "", sub: "" };

/** Main and sub-cell line paths covering `view` (at screen scale `zoom`). */
export function visibleGridPaths(grid: GridSettings, view: MapRect, zoom: number): GridPaths {
  const { cellWidth: w, cellHeight: h, offsetX: ox, offsetY: oy, cols, rows } = grid;
  const [c0, c1] = range(view.x0, view.x1, ox, w, cols);
  const [r0, r1] = range(view.y0, view.y1, oy, h, rows);
  const n = Math.max(1, grid.subdivisions);
  const showSub = n > 1 && Math.min(w, h) / n * zoom >= MIN_SUB_CELL_SCREEN_PX;

  const key = [w, h, ox, oy, cols, rows, n, c0, c1, r0, r1, showSub].join(",");
  if (key === cacheKey) return cacheValue;

  const main: string[] = [];
  const sub: string[] = [];
  if (c1 > c0 && r1 > r0) {
    const top = oy + r0 * h;
    const bottom = oy + r1 * h;
    const left = ox + c0 * w;
    const right = ox + c1 * w;
    for (let i = c0; i <= c1; i++) main.push(`M${ox + i * w} ${top}V${bottom}`);
    for (let j = r0; j <= r1; j++) main.push(`M${left} ${oy + j * h}H${right}`);
    if (showSub) {
      for (let i = c0 * n; i < c1 * n; i++) if (i % n !== 0) sub.push(`M${ox + (i * w) / n} ${top}V${bottom}`);
      for (let j = r0 * n; j < r1 * n; j++) if (j % n !== 0) sub.push(`M${left} ${oy + (j * h) / n}H${right}`);
    }
  }
  cacheKey = key;
  cacheValue = { main: main.join(""), sub: sub.join("") };
  return cacheValue;
}
