/** Part 2 — light in the owner's UI: map light, light tool, token lights. */
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import type { GridSettings, LightLevel, TokenLight } from "../../../src/shared/types.ts";
import { changeValue, installDom, pointer, type Dom } from "../../helpers/dom.ts";
import { mount, PLAYER_USER, type Mounted } from "../../helpers/ui.ts";
import { litTable } from "./helpers.ts";

let dom: Dom;
let ui: Mounted;
before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(() => ui?.unmount());

function mountLight(options: { areas?: Record<string, LightLevel>; grid?: Partial<GridSettings>; tokenLight?: TokenLight | null; player?: boolean } = {}): Mounted {
  const table = litTable({ base: "dark", areas: options.areas ?? {}, tokenLight: options.tokenLight ?? null });
  Object.assign(table.maps[0]!.grid, options.grid ?? {});
  if (options.player) {
    table.templates = [];
    table.maps[0]!.light.areas = {};
    table.tokens[0]!.control = { players: [PLAYER_USER.name], everyone: false };
    return mount({ table, me: PLAYER_USER, name: PLAYER_USER.name });
  }
  return mount({ table });
}

const svg = () => ui.$("svg[data-testid=map]");
const select = (sel: string, value: string) => {
  const el = ui.$(sel) as HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("UI: map light", () => {
  test("the grid settings set the map's light level", () => {
    ui = mountLight();
    assert.equal((ui.$("select[name=mapLight]") as HTMLSelectElement).value, "dark");
    select("select[name=mapLight]", "dim");
    assert.deepEqual(ui.sent, [{ type: "light.setBase", mapId: "map1", level: "dim" }]);
  });
});

describe("UI: light tool", () => {
  test("only the owner has it; it has a level choice", () => {
    ui = mountLight();
    ui.$("[data-testid=toolbar] .tool-light").click();
    assert.equal(ui.store.get().tool, "light");
    const level = ui.$("[data-testid=light-options] select[name=lightLevel]") as HTMLSelectElement;
    assert.deepEqual([...level.options].map((o) => o.value), ["bright", "dim", "dark", "erase"]);
    assert.equal(level.value, "bright");
    ui.unmount();
    ui = mountLight({ player: true });
    assert.equal(ui.root.querySelector("[data-testid=toolbar] .tool-light"), null);
  });

  test("a stroke paints every sub-cell it crosses, sent once at the end", () => {
    ui = mountLight();
    ui.$("[data-testid=toolbar] .tool-light").click();
    select("select[name=lightLevel]", "dim");
    pointer(svg(), "pointerdown", { clientX: 110, clientY: 160 }); // cell (2, 3)
    pointer(svg(), "pointermove", { clientX: 130, clientY: 170 }); // still (2, 3)
    pointer(svg(), "pointermove", { clientX: 160, clientY: 170 }); // (3, 3)
    pointer(svg(), "pointermove", { clientX: 160, clientY: 210 }); // (3, 4)
    assert.deepEqual(ui.sent, [], "nothing is sent during the stroke");
    assert.equal(ui.$$("rect.light-area.is-pending").length, 3);
    pointer(svg(), "pointerup", { clientX: 160, clientY: 210 });
    assert.deepEqual(ui.sent, [{ type: "light.paint", mapId: "map1", cells: [[2, 3], [3, 3], [3, 4]], level: "dim" }]);
  });

  test("painting follows the cell split; erasing sends null; outside the grid is ignored", () => {
    ui = mountLight({ grid: { subdivisions: 2 } });
    ui.$("[data-testid=toolbar] .tool-light").click();
    select("select[name=lightLevel]", "erase");
    pointer(svg(), "pointerdown", { clientX: 130, clientY: 160 }); // sub-cell (5, 6)
    pointer(svg(), "pointermove", { clientX: 900, clientY: 160 }); // outside the 10-cell grid
    pointer(svg(), "pointerup", { clientX: 900, clientY: 160 });
    assert.deepEqual(ui.sent, [{ type: "light.paint", mapId: "map1", cells: [[5, 6]], level: null }]);
  });

  test("the middle button still pans", () => {
    ui = mountLight();
    ui.$("[data-testid=toolbar] .tool-light").click();
    pointer(svg(), "pointerdown", { clientX: 100, clientY: 100, button: 1 });
    pointer(svg(), "pointermove", { clientX: 130, clientY: 110 });
    pointer(svg(), "pointerup", { clientX: 130, clientY: 110 });
    assert.deepEqual(ui.sent, []);
    assert.deepEqual(ui.store.get().views.map1, { x: 30, y: 10, zoom: 1 });
  });

  test("painted areas are shown while the tool is active only", () => {
    ui = mountLight({ areas: { "1,1": "bright", "4,2": "dim" } });
    assert.equal(ui.root.querySelector("rect.light-area"), null);
    ui.$("[data-testid=toolbar] .tool-light").click();
    const rects = ui.$$("rect.light-area");
    assert.deepEqual(rects.map((r) => [r.getAttribute("data-cell"), r.getAttribute("data-level")]).sort(), [["1,1", "bright"], ["4,2", "dim"]]);
    const r = ui.$('rect.light-area[data-cell="4,2"]');
    assert.deepEqual(["x", "y", "width", "height"].map((a) => r.getAttribute(a)), ["200", "100", "50", "50"]);
  });
});

describe("UI: token and template lights (owner)", () => {
  const openSheet = (kind: "token" | "template" = "token") => ui.app.select(kind === "token" ? { kind, id: "tok1" } : { kind, id: "tpl1" });

  test("the preset reflects the current light", () => {
    for (const [light, expected] of [[null, "none"], [{ bright: 20, dim: 20 }, "torch"], [{ bright: 30, dim: 30 }, "lantern"], [{ bright: 5, dim: 5 }, "candle"], [{ bright: 15, dim: 5 }, "custom"]] as const) {
      ui = mountLight({ tokenLight: light });
      openSheet();
      assert.equal((ui.$("select[name=lightPreset]") as HTMLSelectElement).value, expected, JSON.stringify(light));
      ui.unmount();
    }
    ui = mountLight();
  });

  test("choosing a preset or none", () => {
    ui = mountLight();
    openSheet();
    select("select[name=lightPreset]", "torch");
    select("select[name=lightPreset]", "none");
    assert.deepEqual(ui.sent, [
      { type: "token.update", tokenId: "tok1", changes: { light: { bright: 20, dim: 20 } } },
      { type: "token.update", tokenId: "tok1", changes: { light: null } },
    ]);
  });

  test("custom radii", () => {
    ui = mountLight({ tokenLight: { bright: 20, dim: 20 } });
    openSheet();
    select("select[name=lightPreset]", "custom");
    assert.deepEqual(ui.sent, [], "choosing custom sends nothing");
    assert.equal((ui.$("input[name=lightBright]") as HTMLInputElement).value, "20");
    changeValue(ui.$("input[name=lightBright]") as HTMLInputElement, "12.5");
    assert.deepEqual(ui.sent, [{ type: "token.update", tokenId: "tok1", changes: { light: { bright: 12.5, dim: 20 } } }]);
  });

  test("templates have the same light setting", () => {
    ui = mountLight();
    openSheet("template");
    select("select[name=lightPreset]", "candle");
    assert.deepEqual(ui.sent, [{ type: "template.update", templateId: "tpl1", changes: { light: { bright: 5, dim: 5 } } }]);
  });

  test("players do not see the light setting, even for their own token", () => {
    ui = mountLight({ player: true });
    openSheet();
    assert.ok(ui.root.querySelector("[data-testid=stat-sheet]"));
    assert.equal(ui.root.querySelector("select[name=lightPreset]"), null);
  });
});
