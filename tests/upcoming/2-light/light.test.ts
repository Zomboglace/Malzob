/** Part 2 — shared light logic (src/shared/light.ts). See docs/spec-2-light.md. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  brighter,
  computeLight,
  LIGHT_LEVELS,
  LIGHT_PRESETS,
  parseSubCellKey,
  remapLightAreas,
  subCellCenter,
  subCellKey,
  tokenCenter,
} from "../../../src/shared/light.ts";
import { wall } from "../1-walls/helpers.ts";
import { litTable, placeToken } from "./helpers.ts";

const torch = LIGHT_PRESETS.torch;

describe("light: basics", () => {
  test("levels, presets, keys and centres", () => {
    assert.deepEqual(LIGHT_LEVELS, ["dark", "dim", "bright"]);
    assert.equal(brighter("dark", "dim"), "dim");
    assert.equal(brighter("bright", "dim"), "bright");
    assert.equal(brighter("dark", "dark"), "dark");
    assert.deepEqual(LIGHT_PRESETS, { torch: { bright: 20, dim: 20 }, lantern: { bright: 30, dim: 30 }, candle: { bright: 5, dim: 5 } });
    assert.equal(subCellKey(3, 12), "3,12");
    assert.deepEqual(parseSubCellKey("3,12"), [3, 12]);
    assert.deepEqual(subCellCenter(3, 1, 2), { col: 1.75, row: 0.75 });
  });

  test("a token's centre is the centre of its footprint", () => {
    const table = litTable();
    const grid = table.maps[0]!.grid;
    assert.deepEqual(tokenCenter(table.tokens[0]!, grid), { col: 2.5, row: 3.5 });
    assert.deepEqual(tokenCenter({ ...table.tokens[0]!, size: 2 }, grid), { col: 3, row: 4 });
    assert.deepEqual(tokenCenter({ ...table.tokens[0]!, size: 0.5 }, grid), { col: 2.5, row: 3.5 }, "a small token is centred in its cell");
  });
});

describe("light: remapping painted areas when the grid changes", () => {
  const grid = (cols: number, rows: number, subdivisions: number) => ({ cols, rows, subdivisions });

  test("fewer sub-cells: the level found most wins, the brighter on a tie; base counts", () => {
    const areas = { "0,0": "dark", "1,0": "dark", "0,1": "bright", "1,1": "bright", "2,0": "dark" } as const;
    // Cell (0,0): 2 dark + 2 bright -> tie -> bright. Cell (1,0): 1 dark + 3 base (dim) -> dim = base -> not stored.
    assert.deepEqual(remapLightAreas(areas, "dim", grid(2, 1, 2), grid(2, 1, 1)), { "0,0": "bright" });
  });

  test("more sub-cells: each keeps the level of the cell it is in", () => {
    assert.deepEqual(remapLightAreas({ "0,0": "dark" }, "bright", grid(2, 1, 1), grid(2, 1, 2)), {
      "0,0": "dark",
      "1,0": "dark",
      "0,1": "dark",
      "1,1": "dark",
    });
  });

  test("non-multiples are weighted by area", () => {
    // 2 -> 3 on one cell; old sub-cell (0,0) = [0, 1/2]^2 is bright, the rest is base (dark).
    const r = remapLightAreas({ "0,0": "bright" }, "dark", grid(1, 1, 2), grid(1, 1, 3));
    assert.equal(r["0,0"], "bright", "[0, 1/3]^2 lies inside the bright sub-cell");
    assert.equal(r["1,0"], "bright", "half bright, half dark by area: tie -> bright");
    assert.equal(r["1,1"], undefined, "1/4 bright, 3/4 dark -> dark = base");
    assert.equal(r["2,2"], undefined);
  });

  test("sub-cells outside a smaller grid are dropped", () => {
    assert.deepEqual(remapLightAreas({ "1,0": "dim", "3,0": "dim", "0,5": "dim" }, "dark", grid(4, 6, 1), grid(2, 2, 1)), { "1,0": "dim" });
  });
});

describe("light: computing the light of a map", () => {
  // Torch on tok1 at (1, 3): centre (1.5, 3.5). 20 ft bright = 4 cells, +20 ft dim = 8 cells.
  const torchAt = (options: Parameters<typeof litTable>[0] = {}) => placeToken(litTable({ tokenLight: torch, ...options }), 1, 3);
  const levels = (table: ReturnType<typeof litTable>) => computeLight(table.maps[0]!, table.walls, table.tokens);

  test("size of the result and base level", () => {
    const l = levels(litTable({ base: "dim" }));
    assert.equal(l.length, 8);
    assert.equal(l[0]!.length, 10);
    assert.ok(l.every((row) => row.every((v) => v === "dim")));
  });

  test("painted areas", () => {
    const l = levels(litTable({ base: "dark", areas: { "2,2": "bright", "3,2": "dim" } }));
    assert.equal(l[2]![2], "bright");
    assert.equal(l[2]![3], "dim");
    assert.equal(l[2]![4], "dark");
  });

  test("a torch: bright up to 20 ft, dim up to 40 ft, measured between centres", () => {
    const l = levels(torchAt());
    assert.equal(l[3]![1], "bright", "its own cell");
    assert.equal(l[3]![5], "bright", "4 cells = 20 ft");
    assert.equal(l[3]![6], "dim", "5 cells");
    assert.equal(l[4]![5], "dim", "4.12 cells");
    assert.equal(l[3]![9], "dim", "8 cells = 40 ft");
    assert.equal(l[0]![9], "dark", "8.54 cells");
  });

  test("walls block light; see-through walls and open doors do not", () => {
    assert.equal(levels(torchAt({ walls: [wall([4, 0], [4, 8])] }))[3]![5], "dark");
    assert.equal(levels(torchAt({ walls: [wall([4, 0], [4, 8])] }))[3]![3], "bright", "same side as the torch");
    assert.equal(levels(torchAt({ walls: [wall([4, 0], [4, 8], "seeThrough")] }))[3]![5], "bright");
    const door = (open: boolean) => [wall([4, 0], [4, 3]), wall([4, 3], [4, 4], "door", open), wall([4, 4], [4, 8])];
    assert.equal(levels(torchAt({ walls: door(false) }))[3]![5], "dark");
    assert.equal(levels(torchAt({ walls: door(true) }))[3]![5], "bright");
  });

  test("the brightest of painted level and lights wins", () => {
    const l = levels(torchAt({ areas: { "6,3": "bright", "2,3": "dark" } }));
    assert.equal(l[3]![6], "bright", "painted bright beats the torch's dim");
    assert.equal(l[3]![2], "bright", "the torch beats painted dark");
  });

  test("tokens and walls of other maps are ignored", () => {
    const table = torchAt();
    table.tokens[0]!.mapId = "elsewhere";
    assert.equal(levels(table)[3]![1], "dark");
    const walled = torchAt({ walls: [wall([4, 0], [4, 8], "wall", false, "elsewhere")] });
    assert.equal(levels(walled)[3]![5], "bright");
  });

  test("distances use feet per cell, and cells (not pixels) on both axes", () => {
    const table = torchAt();
    table.maps[0]!.grid.feetPerCell = 10; // torch: 2 cells bright, 4 cells total
    const l = levels(table);
    assert.deepEqual([l[3]![3], l[3]![4], l[3]![5], l[3]![6]], ["bright", "dim", "dim", "dark"]);
    const wide = torchAt();
    Object.assign(wide.maps[0]!.grid, { cellWidth: 100, cellHeight: 50 });
    assert.deepEqual(levels(wide), levels(torchAt()), "non-square cells measure in cells");
  });

  test("split cells: light is computed per sub-cell", () => {
    const table = torchAt();
    table.maps[0]!.grid.subdivisions = 2;
    const l = levels(table);
    assert.equal(l.length, 16);
    assert.equal(l[0]!.length, 20);
    assert.equal(l[7]![3], "bright", "the token's sub-cell");
    assert.equal(l[7]![10], "bright", "centre (5.25, 3.75): 3.76 cells");
    assert.equal(l[7]![11], "dim", "centre (5.75, 3.75): 4.26 cells");
    assert.equal(l[7]![19], "dark", "centre (9.75, 3.75): 8.25 cells");
  });
});
