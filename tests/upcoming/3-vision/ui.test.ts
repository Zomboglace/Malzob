/** Part 3 — vision in the UI: fog layers for players, the owner's preview, vision settings, fog reset. */
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { cellsPath } from "../../../src/client/fogRender.ts";
import { LIGHT_PRESETS } from "../../../src/shared/light.ts";
import type { PlayerVision, SeenAs, TableState } from "../../../src/shared/types.ts";
import { updateFog } from "../../../src/shared/vision.ts";
import { changeValue, installDom, type Dom } from "../../helpers/dom.ts";
import { mount, PLAYER_USER, type Mounted } from "../../helpers/ui.ts";
import { addToken, visionTable } from "./helpers.ts";

let dom: Dom;
let ui: Mounted;
before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(() => ui?.unmount());

/** Every sub-cell key of the sample map (10 x 8, no split). */
const ALL = Array.from({ length: 8 }, (_, j) => Array.from({ length: 10 }, (_, i) => `${i},${j}`)).flat();
const d = (sel: string) => ui.$(sel).getAttribute("d");

/** Does a path made by cellsPath cover the point (x, y)? */
function covers(path: string | null, x: number, y: number): boolean {
  for (const m of (path ?? "").matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+Z/g)) {
    const [x0, y0, x1, y1] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
    if (x >= x0 && x < x1 && y >= y0 && y < y1) return true;
  }
  return false;
}

/** A player's view as the server would send it: their hero only, and a vision. */
function mountPlayer(vision: PlayerVision | undefined, background = false): Mounted {
  const table = visionTable();
  table.templates = [];
  table.fog = {};
  if (vision) table.vision = vision;
  if (background) table.maps[0]!.background = { hash: "a".repeat(64), ext: "png", width: 500, height: 400 };
  return mount({ table, me: PLAYER_USER, name: PLAYER_USER.name });
}

describe("cellsPath", () => {
  test("rows top to bottom, runs of consecutive cells merged", () => {
    const grid = visionTable().maps[0]!.grid; // 50 px cells
    assert.equal(cellsPath(["5,3", "0,0", "3,3", "2,3"], grid), "M0 0H50V50H0Z" + "M100 150H200V200H100Z" + "M250 150H300V200H250Z");
    assert.equal(cellsPath([], grid), "");
  });

  test("follows the split, the cell size and the offset", () => {
    const grid = { ...visionTable().maps[0]!.grid, subdivisions: 3, cellWidth: 60, cellHeight: 40, offsetX: 5, offsetY: 3 };
    assert.equal(cellsPath(["1,0"], grid), "M25 3H45V16.33H25Z");
  });
});

describe("UI: what a player sees", () => {
  const visible: Record<string, SeenAs> = { "2,3": "bright", "3,3": "dim", "4,3": "darkvision" };
  const explored = ["1,3", "2,3", "3,3", "4,3"];

  test("unexplored is black, explored is greyed, dim and darkvision are darkened", () => {
    ui = mountPlayer({ mapId: "map1", visible, explored });
    assert.equal(d("path.fog-unexplored"), cellsPath(ALL.filter((k) => !explored.includes(k)), visionTable().maps[0]!.grid));
    assert.equal(d("path.fog-explored"), "M50 150H100V200H50Z");
    assert.equal(d("path.vision-dim"), "M150 150H250V200H150Z");
    assert.equal(d("clipPath#darkvision-clip path.vision-darkvision"), "M200 150H250V200H200Z");
    assert.equal(ui.root.querySelector("image.map-background-darkvision"), null, "no background image to grey out");
  });

  test("darkvision greys out a copy of the background", () => {
    ui = mountPlayer({ mapId: "map1", visible, explored }, true);
    const copy = ui.$("image.map-background-darkvision");
    assert.equal(copy.getAttribute("clip-path"), "url(#darkvision-clip)");
  });

  test("with no vision (no tokens), the whole map is black", () => {
    ui = mountPlayer({ mapId: "map1", visible: {}, explored: [] });
    assert.equal(d("path.fog-unexplored"), cellsPath(ALL, visionTable().maps[0]!.grid));
    ui.unmount();
    ui = mountPlayer(undefined);
    assert.equal(d("path.fog-unexplored"), cellsPath(ALL, visionTable().maps[0]!.grid));
  });

  test("the owner sees no fog", () => {
    const table = visionTable();
    ui = mount({ table });
    assert.equal(ui.root.querySelector("path.fog-unexplored"), null);
    assert.equal(ui.root.querySelector("path.fog-explored"), null);
  });

  test("players have no vision settings in their token's sheet", () => {
    ui = mountPlayer({ mapId: "map1", visible, explored });
    ui.app.select({ kind: "token", id: "tok1" });
    assert.ok(ui.root.querySelector("[data-testid=stat-sheet]"));
    assert.equal(ui.root.querySelector("input[name=darkvision]"), null);
    assert.equal(ui.root.querySelector("input[name=sightRange]"), null);
    assert.equal(ui.root.querySelector("button.vision-preview"), null);
  });
});

describe("UI: the owner's tools", () => {
  /** Owner's state: hero (John's) with a candle at (1, 1), then moved to (1, 6); a goblin far away. */
  function ownerTable(): TableState {
    let table = updateFog(visionTable({ light: LIGHT_PRESETS.candle, at: [1, 1] }));
    table.tokens[0]!.row = 6;
    table = updateFog(table);
    addToken(table, "goblin", 8, 1);
    return table;
  }

  test("preview what a token sees and has seen", () => {
    ui = mount({ table: ownerTable() });
    assert.equal(ui.$$("svg .token").length, 2);
    ui.app.select({ kind: "token", id: "tok1" });
    ui.$("button.vision-preview").click();
    assert.match(ui.$("[data-testid=preview-banner]").textContent ?? "", /Goblin 1/);
    assert.equal(ui.store.get().viewMapId, "map1");
    assert.deepEqual(ui.$$("svg .token").map((t) => t.getAttribute("data-token-id")), ["tok1"], "the goblin is out of its sight");
    assert.ok(covers(d("path.fog-explored"), 75, 75), "cell (1, 1): explored before, not seen now");
    assert.ok(!covers(d("path.fog-explored"), 75, 325), "cell (1, 6): seen now");
    assert.ok(ui.root.querySelector("path.fog-unexplored"));

    ui.$("[data-testid=preview-banner] button.preview-exit").click();
    assert.equal(ui.root.querySelector("[data-testid=preview-banner]"), null);
    assert.equal(ui.root.querySelector("path.fog-unexplored"), null);
    assert.equal(ui.$$("svg .token").length, 2);
  });

  test("vision settings in the token and template sheets", () => {
    const table = ownerTable();
    table.tokens[0]!.vision = { darkvision: 0, range: 60 };
    ui = mount({ table });
    ui.app.select({ kind: "token", id: "tok1" });
    assert.equal((ui.$("input[name=sightRange]") as HTMLInputElement).value, "60");
    changeValue(ui.$("input[name=darkvision]") as HTMLInputElement, "60");
    changeValue(ui.$("input[name=sightRange]") as HTMLInputElement, "");
    ui.app.select({ kind: "template", id: "tpl1" });
    changeValue(ui.$("input[name=sightRange]") as HTMLInputElement, "120");
    assert.deepEqual(ui.sent, [
      { type: "token.update", tokenId: "tok1", changes: { vision: { darkvision: 60 } } },
      { type: "token.update", tokenId: "tok1", changes: { vision: { range: null } } },
      { type: "template.update", templateId: "tpl1", changes: { vision: { range: 120 } } },
    ]);
  });

  test("reset the fog of war of this map or of everything", () => {
    ui = mount({ table: ownerTable() });
    ui.$("button.fog-reset-map").click();
    ui.$("button.fog-reset-all").click();
    assert.deepEqual(ui.sent, [{ type: "fog.reset", mapId: "map1" }, { type: "fog.reset" }]);
  });
});
