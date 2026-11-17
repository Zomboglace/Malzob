import type { GridSettings } from "./types.ts";

/** One grid cell is 5 feet. */
export const FEET_PER_CELL = 5;
export const DEFAULT_CELL_SIZE = 70;
/** Size of a map that has no background image yet. */
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 15;

export function defaultGrid(width?: number, height?: number, cellSize = DEFAULT_CELL_SIZE): GridSettings {
  const { cols, rows } =
    width && height ? gridDimensionsFor(width, height, cellSize, 0, 0) : { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
  return {
    cellSize,
    offsetX: 0,
    offsetY: 0,
    cols,
    rows,
    color: "#000000",
    opacity: 0.35,
    visible: true,
  };
}

/** Number of whole cells that fit in an image, given a cell size and offset. */
export function gridDimensionsFor(
  width: number,
  height: number,
  cellSize: number,
  offsetX: number,
  offsetY: number,
): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor((width - offsetX) / cellSize)),
    rows: Math.max(1, Math.floor((height - offsetY) / cellSize)),
  };
}

export interface Cell {
  col: number;
  row: number;
}

/**
 * Cell under a map-pixel position (no clamping). For tokens larger than 1x1,
 * pass the token size so the position is treated as the token's centre.
 */
export function pixelToCell(x: number, y: number, grid: GridSettings, size = 1): Cell {
  const half = (size * grid.cellSize) / 2;
  return {
    col: Math.round((x - grid.offsetX - half) / grid.cellSize),
    row: Math.round((y - grid.offsetY - half) / grid.cellSize),
  };
}

/** Top-left map-pixel position of a cell. */
export function cellToPixel(cell: Cell, grid: GridSettings): { x: number; y: number } {
  return {
    x: grid.offsetX + cell.col * grid.cellSize,
    y: grid.offsetY + cell.row * grid.cellSize,
  };
}

/** Clamps a token of `size` cells so that it stays fully inside the grid. */
export function clampToGrid(cell: Cell, grid: GridSettings, size = 1): Cell {
  const maxCol = Math.max(0, grid.cols - size);
  const maxRow = Math.max(0, grid.rows - size);
  return {
    col: Math.min(maxCol, Math.max(0, Math.round(cell.col))),
    row: Math.min(maxRow, Math.max(0, Math.round(cell.row))),
  };
}

/** Pixel position -> snapped and clamped cell. */
export function snapToGrid(x: number, y: number, grid: GridSettings, size = 1): Cell {
  return clampToGrid(pixelToCell(x, y, grid, size), grid, size);
}

/** Distance in feet between two cells (5e default: diagonals cost 5 ft). */
export function cellDistanceFeet(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) * FEET_PER_CELL;
}
