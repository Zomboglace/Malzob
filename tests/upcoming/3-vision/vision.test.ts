/** Part 3 — shared vision and fog logic (src/shared/vision.ts). See docs/spec-3-vision.md. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LIGHT_PRESETS } from "../../../src/shared/light.ts";
import {
  bestSeen,
  DEFAULT_VISION,
  footprintCells,
  isPlayerToken,
  memoryKey,
  playerVision,
  previewVision,
  remapFog,
  seeCell,
  tokenVisibleTo,
  updateFog,
  visibleCells,
} from "../../../src/shared/vision.ts";
import { wall } from "../1-walls/helpers.ts";
import { addToken, keys, visionTable } from "./helpers.ts";

const john = { name: "John Doe", role: "player" as const };
const see = (table: ReturnType<typeof visionTable>, tokenIndex = 0) =>
  visibleCells(table.maps[0]!, table.walls, table.tokens, table.tokens[tokenIndex]!);

describe("vision: how a cell is seen", () => {
  test("defaults are those of a D&D human", () => {
    assert.deepEqual(DEFAULT_VISION, { darkvision: 0, range: null });
  });

  test("light, darkness, darkvision and range", () => {
    const human = { darkvision: 0, range: null };
    const elf = { darkvision: 60, range: null };
    assert.equal(seeCell("bright", 500, human), "bright");
    assert.equal(seeCell("dim", 500, human), "dim");
    assert.equal(seeCell("dark", 0, human), null, "no darkvision: darkness is invisible, even next to you");
    assert.equal(seeCell("dark", 60, elf), "darkvision");
    assert.equal(seeCell("dark", 61, elf), null);
    assert.equal(seeCell("dim", 30, elf), "bright", "dim light looks bright within darkvision");
    assert.equal(seeCell("dim", 90, elf), "dim");
    assert.equal(seeCell("bright", 26, { darkvision: 0, range: 25 }), null, "beyond the sight range");
    assert.equal(seeCell("bright", 25, { darkvision: 0, range: 25 }), "bright");
  });

  test("the better way of seeing wins", () => {
    assert.equal(bestSeen("dim", "bright"), "bright");
    assert.equal(bestSeen("darkvision", "dim"), "dim");
    assert.equal(bestSeen(undefined, "darkvision"), "darkvision");
    assert.equal(bestSeen(undefined, undefined), undefined);
  });
});

describe("vision: what a token sees", () => {
  test("a torch in the dark, with a wall: lit cells in sight only", () => {
    const table = visionTable({ light: LIGHT_PRESETS.torch, walls: [wall([5, 0], [5, 8])] });
    const v = see(table);
    assert.equal(v["1,3"], "bright", "its own cell");
    assert.equal(v["3,3"], "bright", "2 cells away");
    assert.equal(v["0,0"], "bright", "3.16 cells away");
    assert.equal(v["4,7"], "dim", "5 cells away: in the torch's dim ring");
    assert.equal(v["6,3"], undefined, "behind the wall");
    assert.equal(Object.keys(v).length, 40, "the 5 x 8 cells on its side of the wall");
  });

  test("lit areas are visible through darkness; darkness only with darkvision", () => {
    const table = visionTable({ vision: { darkvision: 30 }, areas: { "9,3": "bright", "8,4": "dim", "3,3": "dim" } });
    const v = see(table);
    assert.equal(v["1,3"], "darkvision");
    assert.equal(v["4,3"], "darkvision", "3 cells = 15 ft");
    assert.equal(v["7,3"], "darkvision", "6 cells = 30 ft");
    assert.equal(v["8,3"], undefined, "7 cells: dark and beyond darkvision");
    assert.equal(v["9,3"], "bright", "a lit cell far away in the dark");
    assert.equal(v["8,4"], "dim", "a dim cell beyond darkvision");
    assert.equal(v["3,3"], "bright", "a dim cell within darkvision looks bright");
  });

  test("without light or darkvision a token only sees its own footprint", () => {
    assert.deepEqual(see(visionTable()), { "1,3": "dim" });
    const big = visionTable();
    big.tokens[0]!.size = 2;
    assert.deepEqual(see(big), { "1,3": "dim", "2,3": "dim", "1,4": "dim", "2,4": "dim" });
  });

  test("the sight range limits what is seen, even in bright light", () => {
    const v = see(visionTable({ base: "bright", vision: { range: 15 } }));
    assert.equal(v["4,3"], "bright", "3 cells = 15 ft");
    assert.equal(v["5,3"], undefined, "4 cells");
  });

  test("see-through walls and open doors do not block sight; closed doors do", () => {
    const seen = (walls: ReturnType<typeof wall>[]) => see(visionTable({ base: "bright", walls }))["7,3"];
    assert.equal(seen([wall([5, 0], [5, 8], "seeThrough")]), "bright");
    const door = (open: boolean) => [wall([5, 0], [5, 3]), wall([5, 3], [5, 4], "door", open), wall([5, 4], [5, 8])];
    assert.equal(seen(door(false)), undefined);
    assert.equal(seen(door(true)), "bright");
  });

  test("split cells: everything is per sub-cell", () => {
    const table = visionTable({ base: "bright", vision: { range: 5 } }); // 1 cell
    table.maps[0]!.grid.subdivisions = 2;
    const v = see(table);
    assert.ok(["2,6", "3,6", "2,7", "3,7"].every((k) => v[k] === "bright"), "its footprint");
    assert.equal(v["4,7"], "bright", "centre (2.25, 3.75): 0.79 cell");
    assert.equal(v["5,7"], undefined, "centre (2.75, 3.75): 1.27 cells");
  });
});

describe("vision: footprints and visible tokens", () => {
  test("footprint cells follow the size and the split", () => {
    const table = visionTable({ at: [2, 3] });
    const grid = table.maps[0]!.grid;
    const hero = table.tokens[0]!;
    assert.deepEqual(new Set(footprintCells(hero, grid)), new Set(["2,3"]));
    assert.deepEqual(new Set(footprintCells({ ...hero, size: 2 }, grid)), new Set(["2,3", "3,3", "2,4", "3,4"]));
    assert.deepEqual(new Set(footprintCells({ ...hero, size: 0.5 }, grid)), new Set(["2,3"]), "small tokens occupy one step");
    assert.deepEqual(new Set(footprintCells(hero, { ...grid, subdivisions: 2 })), new Set(["4,6", "5,6", "4,7", "5,7"]));
  });

  test("a token is visible if any of its cells is", () => {
    const table = visionTable();
    const grid = table.maps[0]!.grid;
    const orc = addToken(table, "orc", 5, 2, { size: 2 });
    assert.equal(tokenVisibleTo(orc, { "6,3": "dim" }, grid), true);
    assert.equal(tokenVisibleTo(orc, { "7,3": "bright" }, grid), false);
  });
});

describe("vision: fog of war", () => {
  test("memory keys: shared by the copies of a template", () => {
    const table = visionTable();
    assert.equal(memoryKey(table.tokens[0]!), "template:tpl1");
    assert.equal(memoryKey(addToken(table, "loner", 0, 0)), "token:loner");
    assert.equal(isPlayerToken(table.tokens[0]!), true);
    assert.equal(isPlayerToken(table.tokens[1]!), false);
    assert.equal(isPlayerToken({ ...table.tokens[1]!, control: { players: [], everyone: true } }), true);
  });

  test("updateFog records what player tokens see, sorted, without changing its input", () => {
    const table = visionTable({ light: LIGHT_PRESETS.candle }); // 1 cell bright, 2 cells in all
    addToken(table, "goblin", 7, 7, { light: LIGHT_PRESETS.torch }); // an owner token: no fog of its own
    const before = structuredClone(table);
    const after = updateFog(table);
    assert.deepEqual(table, before, "pure");
    const explored = after.fog["template:tpl1"]!["map1"]!;
    assert.deepEqual(new Set(explored), keys(see(after)));
    const sorted = [...explored].sort((a, b) => {
      const [ai, aj] = a.split(",").map(Number) as [number, number];
      const [bi, bj] = b.split(",").map(Number) as [number, number];
      return aj - bj || ai - bi;
    });
    assert.deepEqual(explored, sorted);
    assert.equal(after.fog["token:goblin"], undefined);
  });

  test("explored areas accumulate as tokens move, and copies of a template share them", () => {
    let table = updateFog(visionTable({ light: LIGHT_PRESETS.candle, at: [1, 1] }));
    assert.ok(table.fog["template:tpl1"]!["map1"]!.includes("1,1"));
    table.tokens[0]!.row = 6;
    table = updateFog(table);
    const explored = new Set(table.fog["template:tpl1"]!["map1"]);
    assert.ok(explored.has("1,1") && explored.has("1,6"), "old and new areas");

    // A second copy of the template, far away, shares the memory.
    addToken(table, "twin", 8, 1, { templateId: "tpl1", control: { players: ["John Doe"], everyone: false }, light: LIGHT_PRESETS.candle });
    table = updateFog(table);
    const shared = new Set(table.fog["template:tpl1"]!["map1"]);
    assert.ok(shared.has("8,1") && shared.has("1,1"));
  });

  test("remapping explored areas when the grid changes", () => {
    const g = (cols: number, rows: number, subdivisions: number) => ({ cols, rows, subdivisions });
    assert.deepEqual(remapFog(["0,0"], g(2, 2, 1), g(2, 2, 2)), ["0,0", "1,0", "0,1", "1,1"]);
    assert.deepEqual(remapFog(["1,1"], g(2, 2, 2), g(2, 2, 1)), ["0,0"]);
    assert.deepEqual(remapFog(["1,0"], g(1, 1, 2), g(1, 1, 3)), ["1,0", "2,0", "1,1", "2,1"], "by overlap");
    assert.deepEqual(remapFog(["0,0", "5,0"], g(6, 1, 1), g(2, 1, 1)), ["0,0"], "outside the smaller grid");
  });
});

describe("vision: what a player sees", () => {
  test("the combination of their tokens, with explored areas", () => {
    let table = visionTable({ light: LIGHT_PRESETS.candle, at: [1, 1] });
    addToken(table, "second", 8, 6, { control: { players: ["John Doe"], everyone: false }, vision: { darkvision: 10, range: null } });
    table = updateFog(table);
    table.tokens[0]!.row = 4; // moved, fog not updated yet: 1,0 was explored, is not seen any more (4 cells away)
    const pv = playerVision(table, john);
    assert.equal(pv.mapId, "map1");
    assert.equal(pv.visible["1,4"], "bright");
    assert.equal(pv.visible["8,6"], "darkvision", "the second token's own cell");
    assert.equal(pv.visible["9,6"], "darkvision", "within its 10 ft darkvision");
    assert.equal(pv.visible["1,0"], undefined);
    assert.ok(pv.explored.includes("1,0"), "remembered");
    assert.ok(pv.explored.includes("9,6"), "what is seen now is explored too");
  });

  test("a player with no token sees nothing", () => {
    const table = visionTable({ base: "bright" });
    assert.deepEqual(playerVision(table, { name: "Mary Major", role: "player" }), { mapId: "map1", visible: {}, explored: [] });
  });

  test("the owner's preview of one token", () => {
    const table = updateFog(visionTable({ light: LIGHT_PRESETS.candle, at: [1, 1] }));
    table.tokens[0]!.row = 6;
    const pv = previewVision(table, "tok1");
    assert.equal(pv.mapId, "map1");
    assert.equal(pv.visible["1,6"], "bright");
    assert.equal(pv.visible["1,1"], undefined);
    assert.ok(pv.explored.includes("1,1") && pv.explored.includes("1,6"));
  });
});
