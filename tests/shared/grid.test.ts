import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cellDistanceFeet,
  cellToPixel,
  moveBy,
  roundToStep,
  subCellFeet,
  clampToGrid,
  defaultGrid,
  gridDimensionsFor,
  pixelToCell,
  snapToGrid,
} from "../../src/shared/grid.ts";

const grid = { ...defaultGrid(), cellWidth: 50, cellHeight: 50, offsetX: 10, offsetY: 20, cols: 10, rows: 8 };

describe("grid", () => {
  test("default grid derives columns and rows from the image size", () => {
    const g = defaultGrid(1400, 1050, 70);
    assert.equal(g.cols, 20);
    assert.equal(g.rows, 15);
    assert.equal(g.visible, true);
  });

  test("dimensions account for the offset and never go below 1", () => {
    assert.deepEqual(gridDimensionsFor(1000, 500, 100, 100, 50, 0), { cols: 9, rows: 5 });
    assert.deepEqual(gridDimensionsFor(10, 10, 100, 100, 0, 0), { cols: 1, rows: 1 });
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

  test("1 cell = 5 ft by default, diagonals count as one cell", () => {
    assert.equal(defaultGrid().feetPerCell, 5);
    assert.equal(cellDistanceFeet({ col: 0, row: 0 }, { col: 3, row: 1 }), 15);
    assert.equal(cellDistanceFeet({ col: 2, row: 2 }, { col: 2, row: 2 }), 0);
  });

  test("feet per cell is configurable", () => {
    assert.equal(cellDistanceFeet({ col: 0, row: 0 }, { col: 3, row: 1 }, 10), 30);
    assert.equal(cellDistanceFeet({ col: 0, row: 0 }, { col: 1.5, row: 0 }, 5), 7.5);
    assert.equal(subCellFeet({ feetPerCell: 5, subdivisions: 2 }), 2.5);
  });

  test("sub-pixel cell sizes and offsets", () => {
    const g = { ...grid, cellWidth: 70.5, cellHeight: 70.5, offsetX: 3.25, offsetY: 0.5 };
    assert.deepEqual(cellToPixel({ col: 2, row: 1 }, g), { x: 144.25, y: 71 });
    assert.deepEqual(pixelToCell(144.25 + 35, 71 + 35, g), { col: 2, row: 1 });
    // No column lost to float error: 7 cells of 100.1 px in 700.7 px.
    assert.deepEqual(gridDimensionsFor(700.7, 300.3, 100.1, 100.1, 0, 0), { cols: 7, rows: 3 });
  });

  test("split cells: positions snap to sub-cells", () => {
    const split = { ...grid, subdivisions: 2 }; // 50px cells -> 25px sub-cells
    assert.equal(roundToStep(2.3, split), 2.5);
    assert.equal(roundToStep(2.2, split), 2);
    assert.equal(roundToStep(1 / 3, { subdivisions: 3 }), 0.333333);
    // Centre of a 1x1 token dropped 25px right of cell (2,3)'s centre -> col 2.5.
    const c = cellToPixel({ col: 2, row: 3 }, split);
    assert.deepEqual(pixelToCell(c.x + 25 + 25, c.y + 25, split), { col: 2.5, row: 3 });
    // Clamping still keeps the whole token inside, on a sub-cell.
    assert.deepEqual(clampToGrid({ col: 8.74, row: -0.2 }, split, 2), { col: 8, row: 0 });
    assert.deepEqual(clampToGrid({ col: 7.74, row: 5.26 }, split, 2), { col: 7.5, row: 5.5 });
  });

  test("moveBy moves by steps and clamps", () => {
    const split = { ...grid, subdivisions: 4 };
    assert.deepEqual(moveBy({ col: 0, row: 0 }, 1, 0, 0.25, split), { col: 0.25, row: 0 });
    assert.deepEqual(moveBy({ col: 0.25, row: 0 }, -1, -1, 1, split), { col: 0, row: 0 });
    assert.deepEqual(moveBy({ col: 9, row: 7 }, 1, 1, 0.25, split), { col: 9, row: 7 });
  });
});
