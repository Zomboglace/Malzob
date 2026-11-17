import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clampToGrid,
  defaultGrid,
  footprint,
  gridFromCells,
  pixelToCell,
  cellToPixel,
  rulerDistance,
  snapToGrid,
  tokenRect,
  tokenSize,
} from "../../src/shared/grid.ts";
import { migrateState } from "../../src/shared/migrate.ts";
import { applyIntent, emptyState, type ReducerContext, type StateIntent } from "../../src/shared/reducer.ts";
import type { TableState } from "../../src/shared/types.ts";
import { validateClientMessage } from "../../src/shared/validate.ts";

const grid = { ...defaultGrid(), cellWidth: 50, cellHeight: 50, cols: 10, rows: 8 };

describe("token sizes", () => {
  test("a token without its own size follows the map default", () => {
    assert.equal(tokenSize({ size: null }, { defaultTokenSize: 0.5 }), 0.5);
    assert.equal(tokenSize({ size: 2 }, { defaultTokenSize: 0.5 }), 2);
  });

  test("tokens smaller than a (sub-)cell occupy one step and are drawn centred in it", () => {
    assert.equal(footprint(0.5, grid), 1);
    assert.equal(footprint(0.5, { subdivisions: 2 }), 0.5);
    assert.deepEqual(tokenRect({ col: 2, row: 3 }, 0.5, grid), { x: 112.5, y: 162.5, width: 25, height: 25 });
    // With cells split in 2, a half-cell token fills its sub-cell exactly.
    assert.deepEqual(tokenRect({ col: 2.5, row: 3 }, 0.5, { ...grid, subdivisions: 2 }), { x: 125, y: 150, width: 25, height: 25 });
  });

  test("small tokens snap to the (sub-)cell under their centre", () => {
    const split = { ...grid, subdivisions: 2 };
    // Pointer in the bottom-right quarter of cell (2,3).
    assert.deepEqual(snapToGrid(140, 190, split, 0.5), { col: 2.5, row: 3.5 });
    assert.deepEqual(snapToGrid(140, 190, grid, 0.5), { col: 2, row: 3 });
  });

  test("fractional sizes larger than a step stay on steps and inside the grid", () => {
    assert.deepEqual(clampToGrid({ col: 99, row: 99 }, grid, 1.5), { col: 8, row: 6 });
    assert.deepEqual(clampToGrid({ col: 99, row: 99 }, { ...grid, subdivisions: 2 }, 1.5), { col: 8.5, row: 6.5 });
  });
});

describe("non-square cells", () => {
  const g = { ...grid, cellWidth: 60, cellHeight: 40, offsetX: 5, offsetY: 2 };
  test("pixel <-> cell uses the width horizontally and the height vertically", () => {
    assert.deepEqual(cellToPixel({ col: 2, row: 3 }, g), { x: 125, y: 122 });
    assert.deepEqual(pixelToCell(125 + 30, 122 + 20, g), { col: 2, row: 3 });
    assert.deepEqual(tokenRect({ col: 1, row: 1 }, 2, g), { x: 65, y: 42, width: 120, height: 80 });
  });
});

describe("ruler", () => {
  test("measures straight lines anywhere, in cells and feet", () => {
    assert.deepEqual(rulerDistance({ x: 0, y: 0 }, { x: 150, y: 0 }, grid), { cells: 3, feet: 15 });
    const d = rulerDistance({ x: 7, y: 3 }, { x: 37, y: 43 }, grid); // 30 x 40 px = 50 px = 1 cell
    assert.equal(d.cells, 1);
    assert.equal(d.feet, 5);
  });

  test("respects non-square cells and feet per cell", () => {
    const g = { ...grid, cellWidth: 60, cellHeight: 40, feetPerCell: 10 };
    assert.deepEqual(rulerDistance({ x: 0, y: 0 }, { x: 0, y: 80 }, g), { cells: 2, feet: 20 });
    assert.deepEqual(rulerDistance({ x: 0, y: 0 }, { x: 180, y: 160 }, g), { cells: 5, feet: 50 });
  });
});

describe("grid from two marked cells", () => {
  // Helper: a cell marked by two opposite corners.
  const cell = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y: y + h }] as [{ x: number; y: number }, { x: number; y: number }];

  test("exact clicks give the exact grid, in any click order", () => {
    // Grid: 50 x 40 px cells, offset (10, 5). Cell (1,2) and cell (17,11).
    const expected = { cellWidth: 50, cellHeight: 40, offsetX: 10, offsetY: 5, span: { cols: 16, rows: 9 } };
    assert.deepEqual(gridFromCells(cell(60, 85, 50, 40), cell(860, 445, 50, 40)), expected);
    const reversed: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 910, y: 485 }, { x: 860, y: 445 }];
    assert.deepEqual(gridFromCells(reversed, cell(60, 85, 50, 40)), expected);
  });

  test("averages out click errors: far-apart cells give a precise size", () => {
    // True grid: 70.4 px cells, offset 0. Clicks are off by up to 2 px.
    const a: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 71.4, y: 69.4 }, { x: 139.8, y: 142.8 }]; // cell (1,1)
    const b: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 1268.2, y: 916.2 }, { x: 1339.2, y: 984.6 }]; // cell (18,13)
    const fit = gridFromCells(a, b)!;
    assert.deepEqual(fit.span, { cols: 17, rows: 12 });
    // One cell alone would say ~68.4 x 73.4; the fit is within 0.1 px.
    assert.ok(Math.abs(fit.cellWidth - 70.4) < 0.1, `width ${fit.cellWidth}`);
    assert.ok(Math.abs(fit.cellHeight - 70.4) < 0.1, `height ${fit.cellHeight}`);
    const offsetError = (o: number, size: number) => Math.min(o, size - o);
    assert.ok(offsetError(fit.offsetX, fit.cellWidth) < 1.5, `offsetX ${fit.offsetX}`);
    assert.ok(offsetError(fit.offsetY, fit.cellHeight) < 1.5, `offsetY ${fit.offsetY}`);
  });

  test("radically different cells still give a reasonable grid", () => {
    const fit = gridFromCells(cell(0, 0, 50, 50), cell(300, 300, 100, 100))!;
    assert.ok(fit.cellWidth > 50 && fit.cellWidth < 100, `width ${fit.cellWidth}`);
    assert.equal(fit.cellWidth, fit.cellHeight);
  });

  test("two cells in the same column or row: that axis uses the average size", () => {
    const fit = gridFromCells(cell(100, 0, 50, 40), cell(100, 400, 52, 40))!;
    assert.equal(fit.cellWidth, 51);
    assert.equal(fit.span.cols, 0);
    assert.equal(fit.cellHeight, 40);
  });

  test("a cell marked with clicks too close together is rejected", () => {
    assert.equal(gridFromCells(cell(10, 20, 2, 40), cell(500, 500, 50, 40)), null);
  });
});

describe("reducer: sizes", () => {
  let n = 0;
  const ctx: ReducerContext = { newId: () => `id${++n}`, getImage: () => undefined };
  function run(...intents: StateIntent[]): TableState {
    n = 0;
    let s = emptyState();
    for (const i of intents) {
      const r = applyIntent(s, i, ctx);
      if (!r.ok) assert.fail(r.error);
      s = r.state;
    }
    return s;
  }

  test("new tokens and templates follow the map default until given a size", () => {
    const s = run(
      { type: "map.create", name: "Cave" }, // id1
      { type: "template.create", name: "Rat" }, // id2
      { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" }, // id3
      { type: "token.create", mapId: "id1", col: 5, row: 5 }, // id4
      { type: "token.update", tokenId: "id4", changes: { size: 0.5 } },
    );
    assert.equal(s.templates[0]!.size, null);
    assert.equal(s.tokens[0]!.size, null);
    assert.equal(s.tokens[1]!.size, 0.5);
  });

  test("a bigger map default re-clamps tokens that follow it", () => {
    const s = run(
      { type: "map.create", name: "Cave" },
      { type: "token.create", mapId: "id1", col: 19, row: 14 },
      { type: "map.setGrid", mapId: "id1", grid: { defaultTokenSize: 2 } },
    );
    assert.deepEqual([s.tokens[0]!.col, s.tokens[0]!.row], [18, 13]);
  });

  test("a size can be reset to the map default", () => {
    const s = run(
      { type: "map.create", name: "Cave" },
      { type: "token.create", mapId: "id1", col: 0, row: 0 },
      { type: "token.update", tokenId: "id2", changes: { size: 3 } },
      { type: "token.update", tokenId: "id2", changes: { size: null } },
    );
    assert.equal(s.tokens[0]!.size, null);
  });
});

describe("validation and migration", () => {
  test("ping, nullable sizes and the new grid fields", () => {
    assert.ok(validateClientMessage({ type: "ping", mapId: "m1", x: 12.345, y: -3 }).ok);
    assert.equal(validateClientMessage({ type: "ping", mapId: "m1", x: "1", y: 0 }).ok, false);
    assert.equal(validateClientMessage({ type: "ping", mapId: "m1", x: 1 }).ok, false);
    assert.ok(validateClientMessage({ type: "token.update", tokenId: "t", changes: { size: null } }).ok);
    assert.ok(validateClientMessage({ type: "template.update", templateId: "t", changes: { size: 0.25 } }).ok);
    assert.ok(validateClientMessage({ type: "map.setGrid", mapId: "m", grid: { defaultTokenSize: 0.5, cellWidth: 60, cellHeight: 40 } }).ok);
    assert.equal(validateClientMessage({ type: "map.setGrid", mapId: "m", grid: { defaultTokenSize: 0 } }).ok, false);
    assert.ok(validateClientMessage({ type: "ruler", ruler: { mapId: "m", from: { x: 0, y: 0 }, to: { x: 1.5, y: 2 } } }).ok);
    assert.ok(validateClientMessage({ type: "ruler", ruler: null }).ok);
    assert.equal(validateClientMessage({ type: "ruler" }).ok, false);
    assert.equal(validateClientMessage({ type: "ruler", ruler: { mapId: "m", from: { x: 0 }, to: { x: 1, y: 2 } } }).ok, false);
    assert.equal(validateClientMessage({ type: "ruler", ruler: { mapId: "m", from: { x: 0, y: 0, z: 1 }, to: { x: 1, y: 2 } } }).ok, false);
  });

  test("old square-cell grids are migrated to width/height", () => {
    const old = {
      ...emptyState(),
      maps: [{ id: "m", name: "Old", background: null, width: 700, height: 700, grid: { cellSize: 70, cols: 10, rows: 10 } }],
    } as unknown as TableState;
    const g = migrateState(old).maps[0]!.grid;
    assert.equal(g.cellWidth, 70);
    assert.equal(g.cellHeight, 70);
    assert.equal(g.defaultTokenSize, 1);
    assert.equal("cellSize" in g, false);
  });
});
