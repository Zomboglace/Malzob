/** Part 1 — walls in the UI: the owner's walls tool, doors, rendering, moves with `via`. */
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { handleKeyDown } from "../../../src/client/keyboard.ts";
import type { ClientState } from "../../../src/client/store.ts";
import type { GridSettings, Wall } from "../../../src/shared/types.ts";
import { installDom, pointer, type Dom } from "../../helpers/dom.ts";
import { mount, PLAYER_USER, type Mounted } from "../../helpers/ui.ts";
import { tableWithWalls, wall } from "./helpers.ts";

let dom: Dom;
let ui: Mounted;
before(() => {
  dom = installDom();
});
after(async () => {
  await dom.close();
});
afterEach(() => ui?.unmount());

// The sample map: 10 x 8 cells of 50 px, no offset, zoom 1: screen pixel = map pixel = 50 x cell.
function mountWalls(walls: Wall[] = [], options: { grid?: Partial<GridSettings>; player?: boolean; state?: Partial<ClientState> } = {}): Mounted {
  const table = tableWithWalls(walls);
  Object.assign(table.maps[0]!.grid, options.grid ?? {});
  if (options.player) {
    table.templates = [];
    table.walls = [];
    table.tokens[0]!.control = { players: [PLAYER_USER.name], everyone: false };
  }
  return mount({ table, ...(options.player ? { me: PLAYER_USER, name: PLAYER_USER.name } : {}), ...options.state });
}

const svg = () => ui.$("svg[data-testid=map]");
const click = (x: number, y: number) => {
  pointer(svg(), "pointerdown", { clientX: x, clientY: y });
  pointer(svg(), "pointerup", { clientX: x, clientY: y });
};
const key = (k: string) => handleKeyDown(ui.app, { key: k, shiftKey: false, target: document.body, preventDefault() {} });
const choose = (name: string, value: string) => {
  const select = ui.$(`[data-testid=wall-options] select[name=${name}]`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("UI: walls tool", () => {
  test("only the owner has it; its options appear while it is active", () => {
    ui = mountWalls();
    assert.equal(ui.root.querySelector("[data-testid=wall-options]"), null);
    ui.$("[data-testid=toolbar] .tool-walls").click();
    assert.equal(ui.store.get().tool, "walls");
    const options = ui.$("[data-testid=wall-options]");
    assert.deepEqual([...(options.querySelector("select[name=wallKind]") as HTMLSelectElement).options].map((o) => o.value), ["wall", "seeThrough", "door"]);
    assert.deepEqual([...(options.querySelector("select[name=wallPrecision]") as HTMLSelectElement).options].map((o) => o.value), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    assert.deepEqual([...(options.querySelector("select[name=wallMode]") as HTMLSelectElement).options].map((o) => o.value), ["draw", "erase"]);
    ui.unmount();
    ui = mountWalls([], { player: true });
    assert.equal(ui.root.querySelector("[data-testid=toolbar] .tool-walls"), null);
  });

  test("the precision defaults to the map's cell split", () => {
    ui = mountWalls([], { grid: { subdivisions: 2 } });
    ui.$("[data-testid=toolbar] .tool-walls").click();
    assert.equal((ui.$("select[name=wallPrecision]") as HTMLSelectElement).value, "2");
  });

  test("clicks draw a chain of walls, snapped to the precision; Escape ends the chain, then leaves the tool", () => {
    ui = mountWalls();
    ui.$("[data-testid=toolbar] .tool-walls").click();
    click(110, 160); // (2.2, 3.2) -> (2, 3)
    assert.deepEqual(ui.sent, [], "the first click only starts the chain");
    click(310, 160); // (6.2, 3.2) -> (6, 3)
    click(310, 340); // (6.2, 6.8) -> (6, 7)
    assert.deepEqual(ui.sent, [
      { type: "wall.create", mapId: "map1", from: { col: 2, row: 3 }, to: { col: 6, row: 3 }, kind: "wall" },
      { type: "wall.create", mapId: "map1", from: { col: 6, row: 3 }, to: { col: 6, row: 7 }, kind: "wall" },
    ]);
    key("Escape");
    assert.equal(ui.store.get().tool, "walls", "the first Escape only ends the chain");
    click(110, 60);
    assert.equal(ui.sent.length, 2, "a new chain starts");
    key("Escape");
    key("Escape");
    assert.equal(ui.store.get().tool, "select");
  });

  test("precision and kind: a door at quarter-cell precision", () => {
    ui = mountWalls();
    ui.$("[data-testid=toolbar] .tool-walls").click();
    choose("wallPrecision", "4");
    choose("wallKind", "door");
    click(110, 160); // (2.2, 3.2) -> (2.25, 3.25)
    click(212, 160); // (4.24, 3.2) -> (4.25, 3.25)
    assert.deepEqual(ui.sent, [{ type: "wall.create", mapId: "map1", from: { col: 2.25, row: 3.25 }, to: { col: 4.25, row: 3.25 }, kind: "door" }]);
  });

  test("clicking the same point twice draws nothing; dragging pans instead of adding a point", () => {
    ui = mountWalls();
    ui.$("[data-testid=toolbar] .tool-walls").click();
    click(110, 160);
    click(105, 155); // snaps to the same point (2, 3)
    pointer(svg(), "pointerdown", { clientX: 300, clientY: 300 });
    pointer(svg(), "pointermove", { clientX: 340, clientY: 320 });
    pointer(svg(), "pointerup", { clientX: 340, clientY: 320 });
    assert.deepEqual(ui.sent, []);
    assert.deepEqual(ui.store.get().views.map1, { x: 40, y: 20, zoom: 1 });
  });

  test("a preview line follows the pointer while a chain is started", () => {
    ui = mountWalls();
    ui.$("[data-testid=toolbar] .tool-walls").click();
    assert.equal(ui.root.querySelector("line.wall-preview"), null);
    click(110, 160);
    pointer(svg(), "pointermove", { clientX: 260, clientY: 160 });
    assert.ok(ui.root.querySelector("line.wall-preview"));
  });

  test("erase mode deletes the wall near the click", () => {
    const w = wall([2, 2], [6, 2]);
    ui = mountWalls([w]);
    ui.$("[data-testid=toolbar] .tool-walls").click();
    choose("wallMode", "erase");
    click(200, 140); // (4, 2.8): too far
    click(200, 105); // (4, 2.1)
    assert.deepEqual(ui.sent, [{ type: "wall.delete", wallId: w.id }]);
  });
});

describe("UI: walls and doors on the map", () => {
  test("the owner sees every wall, with its kind; doors show when open", () => {
    const walls = [wall([2, 2], [6, 2]), wall([6, 2], [6, 7], "seeThrough"), wall([2, 7], [3, 7], "door", true)];
    ui = mountWalls(walls);
    const lines = ui.$$("g.walls line.wall");
    assert.equal(lines.length, 3);
    assert.deepEqual(["x1", "y1", "x2", "y2"].map((a) => lines[0]!.getAttribute(a)), ["100", "100", "300", "100"]);
    assert.ok(lines[0]!.classList.contains("wall-wall"));
    assert.ok(lines[1]!.classList.contains("wall-seeThrough"));
    assert.ok(lines[2]!.classList.contains("wall-door") && lines[2]!.classList.contains("is-open"));
    assert.equal(lines[2]!.getAttribute("data-wall-id"), walls[2]!.id);
  });

  test("walls follow the grid's cell size and offset", () => {
    ui = mountWalls([wall([1, 1], [2, 1.5])], { grid: { cellWidth: 60, cellHeight: 40, offsetX: 5, offsetY: 3 } });
    const line = ui.$("g.walls line.wall");
    assert.deepEqual(["x1", "y1", "x2", "y2"].map((a) => line.getAttribute(a)), ["65", "43", "125", "63"]);
  });

  test("the owner opens and closes doors by clicking them", () => {
    const door = wall([5, 5], [6, 5], "door");
    ui = mountWalls([door]);
    click(275, 252); // (5.5, 5.04)
    assert.deepEqual(ui.sent, [{ type: "door.setOpen", wallId: door.id, open: true }]);
  });

  test("a click on a token selects the token, not a door under it", () => {
    ui = mountWalls([wall([2, 3.5], [3, 3.5], "door")]);
    pointer(svg().querySelector('[data-token-id="tok1"] ellipse')!, "pointerdown", { clientX: 125, clientY: 175 });
    pointer(svg(), "pointerup", { clientX: 125, clientY: 175 });
    assert.deepEqual(ui.sent, []);
    assert.deepEqual(ui.store.get().selection, { kind: "token", id: "tok1" });
  });
});

describe("UI: moving tokens with walls", () => {
  const wallOnCol4 = () => [wall([4, 0], [4, 8])];
  const dragTo = (x: number) => pointer(svg(), "pointermove", { clientX: x, clientY: 175 });

  test("moves say how they were made", () => {
    ui = mountWalls();
    pointer(svg().querySelector('[data-token-id="tok1"] ellipse')!, "pointerdown", { clientX: 125, clientY: 175 });
    dragTo(175);
    pointer(svg(), "pointerup", { clientX: 175, clientY: 175 });
    ui.app.select({ kind: "token", id: "tok1" });
    key("ArrowDown");
    assert.deepEqual(ui.sent, [
      { type: "token.move", tokenId: "tok1", col: 3, row: 3, via: "drag" },
      { type: "token.move", tokenId: "tok1", col: 2, row: 4, via: "keyboard" },
    ]);
  });

  test("players have no walls: the server refuses, and the client quietly puts the token back", () => {
    ui = mountWalls(wallOnCol4(), { player: true });
    assert.deepEqual(ui.store.get().table!.walls, []);
    pointer(svg().querySelector('[data-token-id="tok1"] ellipse')!, "pointerdown", { clientX: 125, clientY: 175 });
    dragTo(225); // col 4, through the wall the player does not know about
    assert.deepEqual(ui.sent, [{ type: "token.move", tokenId: "tok1", col: 4, row: 3, via: "drag" }]);
    ui.app.handleServerMessage({ type: "error", code: "blocked", message: "a wall is in the way", ref: "token.move" });
    assert.equal(ui.root.querySelector("[data-testid=notice]"), null, "no notice for a blocked move");
    assert.equal(ui.store.get().drag, null);
    assert.equal(svg().querySelector('[data-token-id="tok1"]')!.getAttribute("transform"), "translate(100 150)", "back at its last known position");
  });

  test("the owner drags tokens through walls", () => {
    ui = mountWalls(wallOnCol4());
    pointer(svg().querySelector('[data-token-id="tok1"] ellipse')!, "pointerdown", { clientX: 125, clientY: 175 });
    dragTo(275);
    assert.deepEqual(ui.sent, [{ type: "token.move", tokenId: "tok1", col: 5, row: 3, via: "drag" }]);
  });

  test("arrow keys do not move a token through a wall, for the owner too", () => {
    ui = mountWalls(wallOnCol4());
    ui.store.update((s) => {
      const table = structuredClone(s.table!);
      table.tokens[0]!.col = 3;
      return { table };
    });
    ui.app.select({ kind: "token", id: "tok1" });
    key("ArrowRight");
    assert.deepEqual(ui.sent, []);
    key("ArrowLeft");
    assert.deepEqual(ui.sent, [{ type: "token.move", tokenId: "tok1", col: 2, row: 3, via: "keyboard" }]);
  });
});
