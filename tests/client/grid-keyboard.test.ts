import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { handleKeyDown, type KeyLike } from "../../src/client/keyboard.ts";
import { parseNumber } from "../../src/client/ui/fields.tsx";
import type { GridSettings } from "../../src/shared/types.ts";
import { changeValue, installDom, pointer, type Dom } from "../helpers/dom.ts";
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

/** Mounts the sample table with grid overrides and the token selected. */
function mountWithGrid(grid: Partial<GridSettings>, select = true): Mounted {
  const table = sampleTable();
  Object.assign(table.maps[0]!.grid, grid);
  return mount({ table, selection: select ? { kind: "token", id: "tok1" } : null });
}

function key(k: string, opts: Partial<KeyLike> = {}): KeyLike & { prevented: boolean } {
  const e = {
    key: k,
    shiftKey: false,
    target: document.body,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
    ...opts,
  };
  return e;
}

describe("number parsing", () => {
  test("accepts dot and comma decimals, rejects junk", () => {
    assert.equal(parseNumber("70.5", 4), 70.5);
    assert.equal(parseNumber("70,5", 4), 70.5);
    assert.equal(parseNumber(" -3.125 ", 2), -3.13);
    assert.equal(parseNumber("12", 0), 12);
    assert.equal(parseNumber("12.5", 0), undefined);
    assert.equal(parseNumber("12px", 2), undefined);
    assert.equal(parseNumber("", 2), undefined);
  });
});

describe("UI: grid settings", () => {
  test("cell size and offsets accept sub-pixel values (dot or comma)", () => {
    ui = mountWithGrid({}, false);
    changeValue(ui.$("input[name=cellSize]") as HTMLInputElement, "70,25");
    changeValue(ui.$("input[name=offsetX]") as HTMLInputElement, "3.5");
    changeValue(ui.$("input[name=offsetY]") as HTMLInputElement, "-0.75");
    assert.deepEqual(ui.sent, [
      { type: "map.setGrid", mapId: "map1", grid: { cellSize: 70.25 } },
      { type: "map.setGrid", mapId: "map1", grid: { offsetX: 3.5 } },
      { type: "map.setGrid", mapId: "map1", grid: { offsetY: -0.75 } },
    ]);
  });

  test("feet per cell is editable and shown in the hint", () => {
    ui = mountWithGrid({ feetPerCell: 10, subdivisions: 2 }, false);
    assert.match(ui.$("[data-testid=grid-hint]").textContent ?? "", /1 cell = 10 ft · 1 sub-cell = 5 ft/);
    changeValue(ui.$("input[name=feetPerCell]") as HTMLInputElement, "1,5");
    assert.deepEqual(ui.sent, [{ type: "map.setGrid", mapId: "map1", grid: { feetPerCell: 1.5 } }]);
  });

  test("splitting cells from the select sends the subdivision", () => {
    ui = mountWithGrid({}, false);
    const select = ui.$("select[name=subdivisions]") as HTMLSelectElement;
    assert.deepEqual([...select.options].map((o) => o.textContent), [
      "No split",
      "2 × 2 (4 sub-cells)",
      "3 × 3 (9 sub-cells)",
      "4 × 4 (16 sub-cells)",
      "5 × 5 (25 sub-cells)",
    ]);
    select.value = "2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(ui.sent, [{ type: "map.setGrid", mapId: "map1", grid: { subdivisions: 2 } }]);
  });

  test("a split grid draws dashed sub-cell lines", () => {
    ui = mountWithGrid({ subdivisions: 1 }, false);
    assert.equal(ui.root.querySelector("path.grid-sub"), null);
    ui.unmount();
    ui = mountWithGrid({ subdivisions: 2 }, false);
    const sub = ui.$("path.grid-sub");
    // 10x8 grid split in 2: 10 inner vertical + 8 inner horizontal lines.
    assert.equal((sub.getAttribute("d")!.match(/M/g) ?? []).length, 18);
    assert.equal(sub.getAttribute("stroke-dasharray"), "3 3");
  });

  test("dragging on a split grid moves by sub-cells", () => {
    ui = mountWithGrid({ subdivisions: 2 }, false);
    const svg = ui.$("svg[data-testid=map]");
    // Token (2,3) on 50px cells: centre at (125, 175). Drag 25px right = half a cell.
    pointer(svg.querySelector('[data-token-id="tok1"] circle')!, "pointerdown", { clientX: 125, clientY: 175 });
    pointer(svg, "pointermove", { clientX: 150, clientY: 175 });
    assert.deepEqual(ui.sent, [{ type: "token.move", tokenId: "tok1", col: 2.5, row: 3 }]);
    assert.equal(svg.querySelector('[data-token-id="tok1"]')!.getAttribute("transform"), "translate(125 150)");
  });
});

describe("keyboard", () => {
  test("arrow keys move the selected token one cell", () => {
    ui = mountWithGrid({});
    const e = key("ArrowRight");
    assert.equal(handleKeyDown(ui.app, e), true);
    assert.equal(e.prevented, true, "the page must not scroll");
    handleKeyDown(ui.app, key("ArrowUp"));
    assert.deepEqual(ui.sent, [
      { type: "token.move", tokenId: "tok1", col: 3, row: 3 },
      { type: "token.move", tokenId: "tok1", col: 2, row: 2 },
    ]);
  });

  test("on a split grid arrows move one sub-cell, Shift+arrow one cell", () => {
    ui = mountWithGrid({ subdivisions: 4 });
    handleKeyDown(ui.app, key("ArrowLeft"));
    handleKeyDown(ui.app, key("ArrowDown", { shiftKey: true }));
    assert.deepEqual(ui.sent, [
      { type: "token.move", tokenId: "tok1", col: 1.75, row: 3 },
      { type: "token.move", tokenId: "tok1", col: 2, row: 4 },
    ]);
  });

  test("moves stop at the grid edge", () => {
    ui = mountWithGrid({});
    const table = structuredClone(ui.store.get().table!);
    table.tokens[0]!.col = 0;
    ui.store.update({ table });
    assert.equal(handleKeyDown(ui.app, key("ArrowLeft")), true);
    assert.deepEqual(ui.sent, []);
  });

  test("keys are ignored while typing in a field or with nothing selected", () => {
    ui = mountWithGrid({});
    const input = ui.$("input[name=hpCurrent]");
    assert.equal(handleKeyDown(ui.app, key("ArrowRight", { target: input })), false);
    assert.equal(handleKeyDown(ui.app, key("ArrowRight", { ctrlKey: true })), false);
    ui.app.select(null);
    assert.equal(handleKeyDown(ui.app, key("ArrowRight")), false);
    assert.deepEqual(ui.sent, []);
  });

  test("a token clicked on the map can then be moved with the keyboard", () => {
    ui = mountWithGrid({}, false);
    const svg = ui.$("svg[data-testid=map]");
    pointer(svg.querySelector('[data-token-id="tok1"] circle')!, "pointerdown", { clientX: 125, clientY: 175 });
    pointer(svg, "pointerup", { clientX: 125, clientY: 175 });
    handleKeyDown(ui.app, key("ArrowDown"));
    assert.deepEqual(ui.sent, [{ type: "token.move", tokenId: "tok1", col: 2, row: 4 }]);
  });

  test("Escape cancels placing, then closes the sheet", () => {
    ui = mountWithGrid({});
    ui.app.setPlacing({ blank: true });
    handleKeyDown(ui.app, key("Escape"));
    assert.equal(ui.store.get().placing, null);
    assert.ok(ui.store.get().selection);
    handleKeyDown(ui.app, key("Escape"));
    assert.equal(ui.store.get().selection, null);
  });
});
