import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { handleKeyDown } from "../../src/client/keyboard.ts";
import type { GridSettings } from "../../src/shared/types.ts";
import { installDom, pointer, type Dom } from "../helpers/dom.ts";
import { mount, sampleTable, type Mounted } from "../helpers/ui.ts";

let dom: Dom;
let ui: Mounted;

before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(() => ui?.unmount());

function mountWith(grid: Partial<GridSettings> = {}, tokenSize: number | null = 1, options = {}): Mounted {
  const table = sampleTable();
  Object.assign(table.maps[0]!.grid, grid);
  table.tokens[0]!.size = tokenSize;
  return mount({ table }, options);
}

const svg = () => ui.$("svg[data-testid=map]");
const tool = (name: string) => ui.$(`[data-testid=toolbar] .tool-${name}`).click();
const click = (x: number, y: number, init: { altKey?: boolean } = {}) => {
  pointer(svg(), "pointerdown", { clientX: x, clientY: y, ...init });
  pointer(svg(), "pointerup", { clientX: x, clientY: y, ...init });
};
const escape = () =>
  handleKeyDown(ui.app, { key: "Escape", shiftKey: false, target: document.body, preventDefault() {} });

describe("UI: token sizes", () => {
  test("a small token is drawn centred in its cell", () => {
    ui = mountWith({}, 0.5);
    const token = svg().querySelector('[data-token-id="tok1"]')!;
    assert.equal(token.getAttribute("transform"), "translate(112.5 162.5)");
    assert.equal(token.getAttribute("data-size"), "0.5");
  });

  test("a token without a size follows the map default", () => {
    ui = mountWith({ defaultTokenSize: 2 }, null);
    assert.equal(svg().querySelector('[data-token-id="tok1"]')!.getAttribute("data-size"), "2");
  });

  test("the sheet offers the map default and fractional sizes", () => {
    ui = mountWith({ defaultTokenSize: 0.5 }, 1);
    ui.app.select({ kind: "token", id: "tok1" });
    const select = ui.$("select[name=size]") as HTMLSelectElement;
    assert.equal(select.options[0]!.textContent, "Map default (½ cell (Tiny))");
    for (const value of ["0.5", "default"]) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    assert.deepEqual(ui.sent, [
      { type: "token.update", tokenId: "tok1", changes: { size: 0.5 } },
      { type: "token.update", tokenId: "tok1", changes: { size: null } },
    ]);
  });

  test("the grid panel sets the default token size", () => {
    ui = mountWith();
    const select = ui.$("select[name=defaultTokenSize]") as HTMLSelectElement;
    assert.ok(![...select.options].some((o) => o.value === "default"), "no 'map default' choice for the default itself");
    select.value = "0.25";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(ui.sent, [{ type: "map.setGrid", mapId: "map1", grid: { defaultTokenSize: 0.25 } }]);
  });

  test("editing the height makes cells non-square; the width of non-square cells changes alone", () => {
    ui = mountWith({ cellWidth: 60, cellHeight: 40 });
    const width = ui.$("input[name=cellWidth]") as HTMLInputElement;
    width.value = "61";
    width.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(ui.sent, [{ type: "map.setGrid", mapId: "map1", grid: { cellWidth: 61 } }]);
  });
});

describe("UI: ruler", () => {
  test("drag anywhere to measure, without snapping and without sending anything", () => {
    ui = mountWith();
    tool("ruler");
    assert.match(ui.$("[data-testid=tool-hint]").textContent ?? "", /Drag anywhere/);
    // Start on top of the token: the ruler measures, it does not drag the token.
    pointer(svg().querySelector('[data-token-id="tok1"] ellipse')!, "pointerdown", { clientX: 107, clientY: 160 });
    pointer(svg(), "pointermove", { clientX: 137, clientY: 200 }); // 30 x 40 px = 50 px = 1 cell
    pointer(svg(), "pointerup", { clientX: 137, clientY: 200 });
    const label = ui.$("[data-testid=ruler] .ruler-label").textContent;
    assert.equal(label, "5 ft (1 cells)");
    assert.deepEqual(ui.sent, []);
    escape();
    assert.equal(ui.root.querySelector("[data-testid=ruler]"), null);
    assert.equal(ui.store.get().tool, "select");
  });

  test("measures in feet per cell with non-square cells, at any zoom", () => {
    ui = mountWith({ cellWidth: 60, cellHeight: 40, feetPerCell: 10 });
    ui.app.setView("map1", { x: 0, y: 0, zoom: 2 });
    tool("ruler");
    pointer(svg(), "pointerdown", { clientX: 0, clientY: 0 });
    pointer(svg(), "pointermove", { clientX: 0, clientY: 160 }); // 80 map px = 2 cells high
    assert.equal(ui.$("[data-testid=ruler] .ruler-label").textContent, "20 ft (2 cells)");
  });

  test("middle-button drag still pans with the ruler", () => {
    ui = mountWith();
    tool("ruler");
    pointer(svg(), "pointerdown", { clientX: 10, clientY: 10, button: 1 });
    pointer(svg(), "pointermove", { clientX: 30, clientY: 15 });
    pointer(svg(), "pointerup", { clientX: 30, clientY: 15 });
    assert.deepEqual(ui.store.get().views.map1, { x: 20, y: 5, zoom: 1 });
    assert.equal(ui.store.get().ruler, null);
  });
});

describe("UI: ping", () => {
  test("the ping tool and Alt+click send a ping in map coordinates", () => {
    ui = mountWith();
    ui.app.setView("map1", { x: 100, y: 50, zoom: 2 });
    tool("ping");
    click(300, 250);
    ui.app.setTool("select");
    click(100, 50, { altKey: true });
    assert.deepEqual(ui.sent, [
      { type: "ping", mapId: "map1", x: 100, y: 100 },
      { type: "ping", mapId: "map1", x: 0, y: 0 },
    ]);
  });

  test("a ping from the server shows an expanding circle that goes away", async () => {
    ui = mountWith({}, 1, { pingDurationMs: 30 });
    ui.app.handleServerMessage({ type: "ping", mapId: "map1", x: 40, y: 60, user: { id: "u2", name: "John Doe" } });
    const ping = ui.$("[data-testid=ping]");
    assert.equal(ping.getAttribute("transform"), "translate(40 60)");
    assert.equal(ping.querySelector(".ping-label")!.textContent, "John Doe");
    assert.equal(ping.querySelectorAll(".ping-ring").length, 2);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(ui.root.querySelector("[data-testid=ping]"), null);
  });

  test("pings on another map are not shown", () => {
    ui = mountWith();
    ui.app.handleServerMessage({ type: "ping", mapId: "other", x: 1, y: 1, user: { id: "u2", name: "John Doe" } });
    assert.equal(ui.root.querySelector("[data-testid=ping]"), null);
  });
});

describe("UI: grid from two clicks", () => {
  test("two clicks on opposite corners of one cell set size and offset", () => {
    ui = mountWith();
    ui.$(".calibrate-start").click();
    assert.equal(ui.store.get().tool, "calibrate");
    click(10, 20);
    assert.match(ui.$("[data-testid=tool-hint]").textContent ?? "", /opposite corner/);
    pointer(svg(), "pointermove", { clientX: 50, clientY: 60 });
    assert.ok(ui.root.querySelector("[data-testid=calibration] .calibration-cell"));
    click(90, 60);
    assert.deepEqual(ui.sent, [{ type: "map.setGrid", mapId: "map1", grid: { cellWidth: 80, cellHeight: 40, offsetX: 10, offsetY: 20 } }]);
    assert.equal(ui.store.get().tool, "select");
  });

  test("works zoomed in with sub-pixel precision; panning between clicks is allowed", () => {
    ui = mountWith();
    ui.app.setView("map1", { x: -400, y: -400, zoom: 4 });
    tool("calibrate");
    click(0, 0); // map (100, 100)
    // Pan by dragging: not a click.
    pointer(svg(), "pointerdown", { clientX: 300, clientY: 300 });
    pointer(svg(), "pointermove", { clientX: 200, clientY: 200 });
    pointer(svg(), "pointerup", { clientX: 200, clientY: 200 });
    assert.deepEqual(ui.sent, []);
    // The view moved by (-100, -100); map (150.5, 150) is now at screen (102, 100).
    click(102, 100);
    assert.deepEqual(ui.sent, [{ type: "map.setGrid", mapId: "map1", grid: { cellWidth: 50.5, cellHeight: 50, offsetX: 49.5, offsetY: 0 } }]);
  });

  test("clicks too close together are refused with a notice", () => {
    ui = mountWith();
    tool("calibrate");
    click(10, 10);
    click(12, 40);
    assert.deepEqual(ui.sent, []);
    assert.match(ui.$("[data-testid=notice]").textContent ?? "", /too close/);
    assert.equal(ui.store.get().tool, "calibrate", "you can try again");
  });
});

describe("UI: sidebar", () => {
  test("can be hidden and shown again", () => {
    ui = mountWith();
    ui.$(".sidebar-toggle").click();
    assert.ok(ui.$("[data-testid=sidebar]").classList.contains("is-collapsed"));
    assert.equal(ui.root.querySelector("[data-testid=maps-panel]"), null);
    ui.$(".sidebar-toggle").click();
    assert.ok(ui.root.querySelector("[data-testid=maps-panel]"));
  });
});
