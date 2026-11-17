import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GRID_CHUNK, visibleGridPaths } from "../../src/client/gridRender.ts";
import { defaultGrid } from "../../src/shared/grid.ts";

const lines = (d: string) => (d.match(/M/g) ?? []).length;
// A big, finely split grid: 200 x 150 cells of 70 px, split 5 x 5.
const grid = { ...defaultGrid(), cols: 200, rows: 150, subdivisions: 5 };

describe("grid rendering", () => {
  test("zoomed in, only the lines near the view are drawn", () => {
    const zoom = 8;
    const view = { x0: 7000, y0: 3500, x1: 7000 + 1920 / zoom, y1: 3500 + 1080 / zoom }; // ~3.4 x 1.9 cells
    const { main, sub } = visibleGridPaths(grid, view, zoom);
    assert.ok(lines(main) <= 2 * (GRID_CHUNK * 2 + 1), `main lines: ${lines(main)}`);
    assert.ok(lines(sub) > 0 && lines(sub) < 200, `sub lines: ${lines(sub)}`);
    // The whole grid would be 351 main lines and 1400 sub-lines.
  });

  test("small pans reuse the same paths (no rebuild)", () => {
    const a = visibleGridPaths(grid, { x0: 7000, y0: 3500, x1: 7240, y1: 3635 }, 8);
    const b = visibleGridPaths(grid, { x0: 7010, y0: 3505, x1: 7250, y1: 3640 }, 8);
    assert.equal(a, b);
  });

  test("zoomed out, sub-cell lines too close together are left out", () => {
    const zoomedOut = visibleGridPaths(grid, { x0: 0, y0: 0, x1: 14000, y1: 10500 }, 0.1);
    assert.equal(zoomedOut.sub, "");
    assert.equal(lines(zoomedOut.main), 201 + 151);
  });

  test("lines are clipped to the grid and nothing is drawn far outside it", () => {
    const outside = visibleGridPaths(grid, { x0: -5000, y0: -5000, x1: -4000, y1: -4000 }, 1);
    assert.deepEqual(outside, { main: "", sub: "" });
  });
});
