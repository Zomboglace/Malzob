import type { GridSettings } from "./types.ts";

/** Standard 5e: one grid cell is 5 feet. Editable per map (`feetPerCell`). */
export const DEFAULT_FEET_PER_CELL = 5;
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
    feetPerCell: DEFAULT_FEET_PER_CELL,
    subdivisions: 1,
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
  // The epsilon avoids losing a column to floating-point error (e.g. 700 / 70.0000001).
  return {
    cols: Math.max(1, Math.floor((width - offsetX) / cellSize + 1e-9)),
    rows: Math.max(1, Math.floor((height - offsetY) / cellSize + 1e-9)),
  };
}

/** A position in cells; fractional when the grid is subdivided. */
export interface Cell {
  col: number;
  row: number;
}

/** Smallest movement allowed on this grid, in cells (1 / subdivisions). */
export function snapStep(grid: Pick<GridSettings, "subdivisions">): number {
  return 1 / Math.max(1, grid.subdivisions);
}

/** Rounds a value in cells to the nearest sub-cell of the grid. */
export function roundToStep(value: number, grid: Pick<GridSettings, "subdivisions">): number {
  const s = Math.max(1, grid.subdivisions);
  // toFixed removes float noise such as 2.3000000000000003.
  return Number((Math.round(value * s) / s).toFixed(6));
}

/**
 * Snapped (not clamped) position for a token whose centre is at the given
 * map-pixel position. `size` is the token footprint in cells.
 */
export function pixelToCell(x: number, y: number, grid: GridSettings, size = 1): Cell {
  const half = (size * grid.cellSize) / 2;
  return {
    col: roundToStep((x - grid.offsetX - half) / grid.cellSize, grid),
    row: roundToStep((y - grid.offsetY - half) / grid.cellSize, grid),
  };
}

/** Top-left map-pixel position of a (possibly fractional) cell position. */
export function cellToPixel(cell: Cell, grid: GridSettings): { x: number; y: number } {
  return {
    x: grid.offsetX + cell.col * grid.cellSize,
    y: grid.offsetY + cell.row * grid.cellSize,
  };
}

/** Snaps to the grid's sub-cells and keeps a token of `size` cells fully inside the grid. */
export function clampToGrid(cell: Cell, grid: GridSettings, size = 1): Cell {
  const maxCol = Math.max(0, grid.cols - size);
  const maxRow = Math.max(0, grid.rows - size);
  return {
    col: Math.min(maxCol, Math.max(0, roundToStep(cell.col, grid))),
    row: Math.min(maxRow, Math.max(0, roundToStep(cell.row, grid))),
  };
}

/** Pixel position -> snapped and clamped position. */
export function snapToGrid(x: number, y: number, grid: GridSettings, size = 1): Cell {
  return clampToGrid(pixelToCell(x, y, grid, size), grid, size);
}

/** Moves a position by (dx, dy) steps of `step` cells, snapped and clamped. */
export function moveBy(cell: Cell, dx: number, dy: number, step: number, grid: GridSettings, size = 1): Cell {
  return clampToGrid({ col: cell.col + dx * step, row: cell.row + dy * step }, grid, size);
}

/** Distance in feet between two positions (5e default rule: diagonals cost the same as straight moves). */
export function cellDistanceFeet(a: Cell, b: Cell, feetPerCell = DEFAULT_FEET_PER_CELL): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) * feetPerCell;
}

/** Feet covered by one sub-cell. */
export function subCellFeet(grid: Pick<GridSettings, "feetPerCell" | "subdivisions">): number {
  return grid.feetPerCell / Math.max(1, grid.subdivisions);
}
