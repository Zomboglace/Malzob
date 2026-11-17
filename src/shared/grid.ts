/**
 * Grid maths. Positions and sizes are in cells; pixels are map (image)
 * pixels. Cells may be non-square (`cellWidth` != `cellHeight`) and split
 * into `subdivisions` x `subdivisions` sub-cells that tokens snap to.
 */
import type { GridSettings, Token } from "./types.ts";

/** Standard 5e: one grid cell is 5 feet. Editable per map (`feetPerCell`). */
export const DEFAULT_FEET_PER_CELL = 5;
export const DEFAULT_CELL_SIZE = 70;
/** Size of a map that has no background image yet. */
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 15;
/** Smallest cell side accepted, in pixels (also the validation minimum). */
export const MIN_CELL_PX = 4;

export function defaultGrid(width?: number, height?: number, cellSize = DEFAULT_CELL_SIZE): GridSettings {
  const { cols, rows } =
    width && height ? gridDimensionsFor(width, height, cellSize, cellSize, 0, 0) : { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
  return {
    cellWidth: cellSize,
    cellHeight: cellSize,
    offsetX: 0,
    offsetY: 0,
    feetPerCell: DEFAULT_FEET_PER_CELL,
    subdivisions: 1,
    defaultTokenSize: 1,
    cols,
    rows,
    color: "#000000",
    opacity: 0.35,
    visible: true,
  };
}

/** Number of whole cells that fit in an image, given the cell size and offset. */
export function gridDimensionsFor(
  width: number,
  height: number,
  cellWidth: number,
  cellHeight: number,
  offsetX: number,
  offsetY: number,
): { cols: number; rows: number } {
  // The epsilon avoids losing a column to floating-point error (e.g. 700 / 70.0000001).
  return {
    cols: Math.max(1, Math.floor((width - offsetX) / cellWidth + 1e-9)),
    rows: Math.max(1, Math.floor((height - offsetY) / cellHeight + 1e-9)),
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

/** Removes float noise such as 2.3000000000000003. */
function tidy(n: number): number {
  return Number(n.toFixed(6));
}

/** Rounds a value in cells to the nearest sub-cell of the grid. */
export function roundToStep(value: number, grid: Pick<GridSettings, "subdivisions">): number {
  const s = Math.max(1, grid.subdivisions);
  return tidy(Math.round(value * s) / s);
}

function floorToStep(value: number, grid: Pick<GridSettings, "subdivisions">): number {
  const s = Math.max(1, grid.subdivisions);
  return tidy(Math.floor(value * s + 1e-9) / s);
}

/** Effective size of a token in cells: its own size, or the map default. */
export function tokenSize(token: Pick<Token, "size">, grid: Pick<GridSettings, "defaultTokenSize">): number {
  return token.size ?? grid.defaultTokenSize;
}

/**
 * Space a token occupies for snapping, in cells: its size, but at least one
 * step. A token smaller than a (sub-)cell is drawn centred in that (sub-)cell.
 */
export function footprint(size: number, grid: Pick<GridSettings, "subdivisions">): number {
  return Math.max(size, snapStep(grid));
}

/**
 * Snapped (not clamped) position for a token of `size` cells whose centre
 * is at the given map-pixel position.
 */
export function pixelToCell(x: number, y: number, grid: GridSettings, size = 1): Cell {
  const f = footprint(size, grid);
  return {
    col: roundToStep((x - grid.offsetX) / grid.cellWidth - f / 2, grid),
    row: roundToStep((y - grid.offsetY) / grid.cellHeight - f / 2, grid),
  };
}

/** Top-left map-pixel position of a (possibly fractional) cell position. */
export function cellToPixel(cell: Cell, grid: GridSettings): { x: number; y: number } {
  return {
    x: grid.offsetX + cell.col * grid.cellWidth,
    y: grid.offsetY + cell.row * grid.cellHeight,
  };
}

/** Map-pixel rectangle in which a token of `size` cells at `cell` is drawn. */
export function tokenRect(cell: Cell, size: number, grid: GridSettings): { x: number; y: number; width: number; height: number } {
  const origin = cellToPixel(cell, grid);
  const inset = (footprint(size, grid) - size) / 2;
  return {
    x: origin.x + inset * grid.cellWidth,
    y: origin.y + inset * grid.cellHeight,
    width: size * grid.cellWidth,
    height: size * grid.cellHeight,
  };
}

/** Snaps to the grid's sub-cells and keeps a token of `size` cells fully inside the grid. */
export function clampToGrid(cell: Cell, grid: GridSettings, size = 1): Cell {
  const f = footprint(size, grid);
  const maxCol = Math.max(0, floorToStep(grid.cols - f, grid));
  const maxRow = Math.max(0, floorToStep(grid.rows - f, grid));
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

export interface Point {
  x: number;
  y: number;
}

/**
 * Straight-line (ruler) distance between two map-pixel points, ignoring the
 * grid lines. Horizontal and vertical pixels are converted with the cell
 * width and height, so non-square cells measure correctly.
 */
export function rulerDistance(a: Point, b: Point, grid: GridSettings): { cells: number; feet: number } {
  const cells = Math.hypot((b.x - a.x) / grid.cellWidth, (b.y - a.y) / grid.cellHeight);
  return { cells, feet: cells * grid.feetPerCell };
}

/**
 * Grid geometry from two opposite corners of one cell, clicked on the map:
 * the cell size is the distance between the clicks on each axis, and the
 * offset puts a grid line on the clicked corners. Returns null if the cell
 * would be smaller than MIN_CELL_PX on either axis.
 */
export function gridFromCorners(
  a: Point,
  b: Point,
): Pick<GridSettings, "cellWidth" | "cellHeight" | "offsetX" | "offsetY"> | null {
  const cellWidth = Math.abs(b.x - a.x);
  const cellHeight = Math.abs(b.y - a.y);
  if (cellWidth < MIN_CELL_PX || cellHeight < MIN_CELL_PX) return null;
  const r = (v: number) => Number(v.toFixed(4));
  // Offset in [0, cell): a corner at 0.99999 cells is treated as 0.
  const mod = (v: number, m: number) => {
    const o = ((v % m) + m) % m;
    return m - o < 1e-6 ? 0 : o;
  };
  return {
    cellWidth: r(cellWidth),
    cellHeight: r(cellHeight),
    offsetX: r(mod(Math.min(a.x, b.x), cellWidth)),
    offsetY: r(mod(Math.min(a.y, b.y), cellHeight)),
  };
}
