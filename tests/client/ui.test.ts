import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { changeValue, installDom, pointer, wheel, type Dom } from "../helpers/dom.ts";
import { mount, type Mounted } from "../helpers/ui.ts";

let dom: Dom;
let ui: Mounted;

before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(() => ui?.unmount());

/** Screen centre of a cell for the default view (zoom 1, no pan, 50px cells). */
const centre = (col: number, row: number) => ({ clientX: col * 50 + 25, clientY: row * 50 + 25 });

describe("UI: joining", () => {
  test("the join form asks for a display name", () => {
    ui = mount({ name: null, table: null });
    const input = ui.$("input[name=displayName]") as HTMLInputElement;
    input.value = "  Jane Doe ";
    ui.$("form[data-testid=join]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    assert.deepEqual(ui.joined, ["Jane Doe"]);
    assert.equal(ui.store.get().name, "Jane Doe");
    assert.ok(ui.root.querySelector(".app"));
  });

  test("connected users and the connection status are shown", () => {
    ui = mount();
    assert.deepEqual(ui.$$("[data-testid=users] li").map((li) => li.textContent), ["Jane Doe (GM)", "John Doe"]);
    assert.equal(ui.$("[data-testid=status]").textContent, "Connected");
    ui.store.update({ connection: "closed" });
    assert.match(ui.$("[data-testid=status]").textContent ?? "", /Disconnected/);
  });
});

describe("UI: map rendering", () => {
  test("draws the grid and tokens in SVG", () => {
    ui = mount();
    const svg = ui.$("svg[data-testid=map]");
    const grid = svg.querySelector("path.grid")!;
    // 11 vertical + 9 horizontal lines for a 10x8 grid.
    assert.equal((grid.getAttribute("d")!.match(/M/g) ?? []).length, 20);
    const token = svg.querySelector('[data-token-id="tok1"]')!;
    assert.equal(token.getAttribute("transform"), "translate(100 150)");
    assert.equal(token.querySelector(".token-label")!.textContent, "Goblin 1");
    // HP bar: 5/10 -> half of the inner width.
    const bg = Number(token.querySelector(".hp-bar-bg")!.getAttribute("width"));
    const fill = Number(token.querySelector(".hp-bar-fill")!.getAttribute("width"));
    assert.ok(Math.abs(fill - bg / 2) < 1e-9);
  });

  test("hiding the grid removes it", () => {
    ui = mount();
    const table = structuredClone(ui.store.get().table!);
    table.maps[0]!.grid.visible = false;
    ui.store.update({ table });
    assert.equal(ui.root.querySelector("path.grid"), null);
  });

  test("an empty table invites to create a map", () => {
    ui = mount({ table: { rev: 0, activeMapId: null, maps: [], tokens: [], templates: [] } });
    assert.match(ui.$(".empty").textContent ?? "", /No map yet/);
  });
});

describe("UI: map interactions", () => {
  test("dragging a token sends snapped moves and shows the drag locally", () => {
    ui = mount();
    const svg = ui.$("svg[data-testid=map]");
    const circle = svg.querySelector('[data-token-id="tok1"] ellipse')!;
    pointer(circle, "pointerdown", centre(2, 3));
    pointer(svg, "pointermove", { clientX: 160, clientY: 175 }); // still over cell (3,3)
    pointer(svg, "pointermove", centre(6, 5));
    assert.deepEqual(ui.sent, [
      { type: "token.move", tokenId: "tok1", col: 3, row: 3 },
      { type: "token.move", tokenId: "tok1", col: 6, row: 5 },
    ]);
    assert.equal(svg.querySelector('[data-token-id="tok1"]')!.getAttribute("transform"), "translate(300 250)");
    pointer(svg, "pointerup", centre(6, 5));
    assert.equal(ui.store.get().drag, null);
    assert.equal(ui.store.get().selection, null, "a drag is not a click");
  });

  test("dragging outside the grid clamps the token", () => {
    ui = mount();
    const svg = ui.$("svg[data-testid=map]");
    pointer(svg.querySelector('[data-token-id="tok1"] ellipse')!, "pointerdown", centre(2, 3));
    pointer(svg, "pointermove", { clientX: 5000, clientY: -5000 });
    assert.deepEqual(ui.sent.at(-1), { type: "token.move", tokenId: "tok1", col: 9, row: 0 });
  });

  test("dragging empty space pans, the wheel zooms (local only)", () => {
    ui = mount();
    const svg = ui.$("svg[data-testid=map]");
    pointer(svg, "pointerdown", { clientX: 10, clientY: 10 });
    pointer(svg, "pointermove", { clientX: 40, clientY: 30 });
    pointer(svg, "pointerup", { clientX: 40, clientY: 30 });
    assert.equal(ui.$("g.viewport").getAttribute("transform"), "translate(30 20) scale(1)");

    wheel(svg, { deltaY: -500, clientX: 30, clientY: 20 });
    const view = ui.store.get().views.map1!;
    assert.ok(view.zoom > 1);
    // Zoom is anchored on the cursor, which sits on the map origin here.
    assert.ok(Math.abs(view.x - 30) < 1e-9 && Math.abs(view.y - 20) < 1e-9);
    assert.deepEqual(ui.sent, [], "pan and zoom are never sent to the server");
  });

  test("placing a template creates a token in the clicked cell", () => {
    ui = mount();
    ui.$('[data-template-id="tpl1"] .template-place').click();
    assert.deepEqual(ui.store.get().placing, { templateId: "tpl1" });
    pointer(ui.$("svg[data-testid=map]"), "pointerdown", centre(7, 1));
    assert.deepEqual(ui.sent, [{ type: "token.create", mapId: "map1", col: 7, row: 1, templateId: "tpl1" }]);
    assert.equal(ui.store.get().placing, null);
  });

  test("placing a blank token", () => {
    ui = mount();
    ui.$(".place-blank").click();
    pointer(ui.$("svg[data-testid=map]"), "pointerdown", centre(0, 0));
    assert.deepEqual(ui.sent, [{ type: "token.create", mapId: "map1", col: 0, row: 0 }]);
  });
});

describe("UI: stat sheet", () => {
  function openTokenSheet(): HTMLElement {
    const svg = ui.$("svg[data-testid=map]");
    pointer(svg.querySelector('[data-token-id="tok1"] ellipse')!, "pointerdown", centre(2, 3));
    pointer(svg, "pointerup", centre(2, 3));
    return ui.$("[data-testid=stat-sheet]");
  }

  test("clicking a token opens its sheet with automatic modifiers", () => {
    ui = mount();
    const sheet = openTokenSheet();
    assert.equal(sheet.dataset.kind, "token");
    assert.equal((sheet.querySelector("input[name=name]") as HTMLInputElement).value, "Goblin 1");
    assert.equal((sheet.querySelector("input[name=hpCurrent]") as HTMLInputElement).value, "5");
    assert.equal(sheet.querySelector('[data-ability="str"] .modifier')!.textContent, "+2");
    assert.equal(sheet.querySelector('[data-ability="dex"] .modifier')!.textContent, "-1");
    assert.equal(sheet.querySelector('[data-ability="con"] .modifier')!.textContent, "+0");
  });

  test("editing fields sends small patches", () => {
    ui = mount();
    const sheet = openTokenSheet();
    changeValue(sheet.querySelector("input[name=hpCurrent]") as HTMLInputElement, "2");
    changeValue(sheet.querySelector("input[name=ability-wis]") as HTMLInputElement, "14");
    changeValue(sheet.querySelector("textarea[name=notes]") as HTMLTextAreaElement, "Carries a rusty key");
    (sheet.querySelector("input[name=condition-prone]") as HTMLInputElement).click();
    assert.deepEqual(ui.sent, [
      { type: "token.update", tokenId: "tok1", changes: { stats: { hp: { current: 2 } } } },
      { type: "token.update", tokenId: "tok1", changes: { stats: { abilities: { wis: 14 } } } },
      { type: "token.update", tokenId: "tok1", changes: { stats: { notes: "Carries a rusty key" } } },
      { type: "token.update", tokenId: "tok1", changes: { stats: { conditions: ["prone"] } } },
    ]);
  });

  test("invalid numbers are reverted instead of sent", () => {
    ui = mount();
    const input = openTokenSheet().querySelector("input[name=ac]") as HTMLInputElement;
    changeValue(input, "abc");
    assert.deepEqual(ui.sent, []);
    assert.equal(input.value, "10");
  });

  test("a field being edited is not overwritten by incoming updates", () => {
    ui = mount();
    const sheet = openTokenSheet();
    const name = sheet.querySelector("input[name=name]") as HTMLInputElement;
    const hp = sheet.querySelector("input[name=hpCurrent]") as HTMLInputElement;
    name.focus();
    name.value = "Goblin ch";
    const table = structuredClone(ui.store.get().table!);
    table.tokens[0]!.stats.name = "Renamed elsewhere";
    table.tokens[0]!.stats.hp.current = 1;
    ui.app.handleServerMessage({ type: "state", state: table });
    assert.equal(name.value, "Goblin ch", "focused field keeps the user's text");
    assert.equal(hp.value, "1", "other fields update live");
  });

  test("token actions: duplicate, save as template, delete", () => {
    ui = mount();
    const sheet = openTokenSheet();
    (sheet.querySelector(".token-duplicate") as HTMLElement).click();
    (sheet.querySelector(".token-to-template") as HTMLElement).click();
    (sheet.querySelector(".token-delete") as HTMLElement).click();
    assert.deepEqual(ui.sent, [
      { type: "token.duplicate", tokenId: "tok1" },
      { type: "template.create", name: "Goblin 1", fromTokenId: "tok1" },
      { type: "token.delete", tokenId: "tok1" },
    ]);
  });

  test("templates open their own sheet and send template.update", () => {
    ui = mount();
    ui.$('[data-template-id="tpl1"] .template-open').click();
    const sheet = ui.$("[data-testid=stat-sheet]");
    assert.equal(sheet.dataset.kind, "template");
    changeValue(sheet.querySelector("input[name=hpMax]") as HTMLInputElement, "12");
    const size = sheet.querySelector("select[name=size]") as HTMLSelectElement;
    size.value = "2";
    size.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(ui.sent, [
      { type: "template.update", templateId: "tpl1", changes: { stats: { hp: { max: 12 } } } },
      { type: "template.update", templateId: "tpl1", changes: { size: 2 } },
    ]);
  });

  test("the sheet closes when its token is deleted by someone else", () => {
    ui = mount();
    openTokenSheet();
    const table = structuredClone(ui.store.get().table!);
    table.tokens = [];
    ui.app.handleServerMessage({ type: "state", state: table });
    assert.equal(ui.root.querySelector("[data-testid=stat-sheet]"), null);
  });
});

describe("UI: maps and templates panels", () => {
  test("create, activate, delete maps and edit the grid", () => {
    ui = mount();
    const panel = ui.$("[data-testid=maps-panel]");
    (panel.querySelector("input[name=mapName]") as HTMLInputElement).value = "Forest";
    panel.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    (panel.querySelector('[data-map-id="map1"] .map-activate') as HTMLElement).click();
    changeValue(panel.querySelector("input[name=cellWidth]") as HTMLInputElement, "64");
    changeValue(panel.querySelector("input[name=activeMapName]") as HTMLInputElement, "Big cave");
    (panel.querySelector("input[name=gridVisible]") as HTMLInputElement).click();
    (panel.querySelector('[data-map-id="map1"] .map-delete') as HTMLElement).click();
    assert.deepEqual(ui.sent, [
      { type: "map.create", name: "Forest" },
      { type: "map.activate", mapId: "map1" },
      { type: "map.setGrid", mapId: "map1", grid: { cellWidth: 64, cellHeight: 64 } },
      { type: "map.rename", mapId: "map1", name: "Big cave" },
      { type: "map.setGrid", mapId: "map1", grid: { visible: false } },
      { type: "map.delete", mapId: "map1" },
    ]);
  });

  test("create a template", () => {
    ui = mount();
    const panel = ui.$("[data-testid=templates-panel]");
    (panel.querySelector("input[name=templateName]") as HTMLInputElement).value = "Orc";
    panel.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    assert.deepEqual(ui.sent, [{ type: "template.create", name: "Orc" }]);
  });

  test("server errors are shown as a notice", () => {
    ui = mount();
    ui.app.handleServerMessage({ type: "error", code: "invalid", message: "bad", ref: "token.move" });
    assert.match(ui.$("[data-testid=notice]").textContent ?? "", /token\.move: bad/);
  });
});
