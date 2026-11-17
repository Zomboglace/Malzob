import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clampToGrid,
  defaultGrid,
  footprint,
  gridFromCorners,
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

describe("grid from two clicked corners", () => {
  test("derives cell size and offset, whatever the click order", () => {
    const expected = { cellWidth: 50.5, cellHeight: 49.25, offsetX: 23.5, offsetY: 11 };
    assert.deepEqual(gridFromCorners({ x: 124.5, y: 60.25 }, { x: 175, y: 109.5 }), expected);
    assert.deepEqual(gridFromCorners({ x: 175, y: 109.5 }, { x: 124.5, y: 60.25 }), expected);
    assert.deepEqual(gridFromCorners({ x: 175, y: 60.25 }, { x: 124.5, y: 109.5 }), expected);
  });

  test("supports non-square cells and rejects clicks that are too close", () => {
    assert.deepEqual(gridFromCorners({ x: 10, y: 20 }, { x: 90, y: 60 }), { cellWidth: 80, cellHeight: 40, offsetX: 10, offsetY: 20 });
    assert.equal(gridFromCorners({ x: 10, y: 20 }, { x: 12, y: 60 }), null);
  });

  test("a corner on a whole number of cells gives a zero offset", () => {
    assert.deepEqual(gridFromCorners({ x: 140, y: 70 }, { x: 210, y: 140 }), { cellWidth: 70, cellHeight: 70, offsetX: 0, offsetY: 0 });
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
