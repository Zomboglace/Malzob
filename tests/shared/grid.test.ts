import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cellDistanceFeet,
  cellToPixel,
  clampToGrid,
  defaultGrid,
  gridDimensionsFor,
  pixelToCell,
  snapToGrid,
} from "../../src/shared/grid.ts";

const grid = { ...defaultGrid(), cellSize: 50, offsetX: 10, offsetY: 20, cols: 10, rows: 8 };

describe("grid", () => {
  test("default grid derives columns and rows from the image size", () => {
    const g = defaultGrid(1400, 1050, 70);
    assert.equal(g.cols, 20);
    assert.equal(g.rows, 15);
    assert.equal(g.visible, true);
  });

  test("dimensions account for the offset and never go below 1", () => {
    assert.deepEqual(gridDimensionsFor(1000, 500, 100, 50, 0), { cols: 9, rows: 5 });
    assert.deepEqual(gridDimensionsFor(10, 10, 100, 0, 0), { cols: 1, rows: 1 });
  });

  test("cell <-> pixel round trip with offset", () => {
    assert.deepEqual(cellToPixel({ col: 2, row: 3 }, grid), { x: 110, y: 170 });
    // Any point inside the cell maps back to it.
    assert.deepEqual(pixelToCell(110 + 25, 170 + 25, grid), { col: 2, row: 3 });
    assert.deepEqual(pixelToCell(110 + 1, 170 + 49, grid), { col: 2, row: 3 });
  });

  test("large tokens snap by their centre", () => {
    // A 2x2 token whose centre is on the corner between cells (3,3) and (4,4).
    const corner = cellToPixel({ col: 4, row: 4 }, grid);
    assert.deepEqual(pixelToCell(corner.x, corner.y, grid, 2), { col: 3, row: 3 });
  });

  test("clamp keeps tokens of every size inside the grid", () => {
    assert.deepEqual(clampToGrid({ col: -5, row: 99 }, grid), { col: 0, row: 7 });
    assert.deepEqual(clampToGrid({ col: 9, row: 7 }, grid, 3), { col: 7, row: 5 });
    assert.deepEqual(clampToGrid({ col: 0, row: 0 }, { ...grid, cols: 1, rows: 1 }, 3), { col: 0, row: 0 });
  });

  test("snapToGrid snaps and clamps", () => {
    assert.deepEqual(snapToGrid(-1000, -1000, grid), { col: 0, row: 0 });
    assert.deepEqual(snapToGrid(10_000, 10_000, grid), { col: 9, row: 7 });
  });

  test("1 cell = 5 ft, diagonals count as one cell", () => {
    assert.equal(cellDistanceFeet({ col: 0, row: 0 }, { col: 3, row: 1 }), 15);
    assert.equal(cellDistanceFeet({ col: 2, row: 2 }, { col: 2, row: 2 }), 0);
  });
});
