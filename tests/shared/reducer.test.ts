import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyIntent, emptyState, type ReducerContext, type StateIntent } from "../../src/shared/reducer.ts";
import type { ImageRef, TableState } from "../../src/shared/types.ts";

const IMAGE: ImageRef = { hash: "a".repeat(64), ext: "png", width: 1400, height: 700 };

function context(): ReducerContext {
  let n = 0;
  return { newId: () => `id${++n}`, getImage: (h) => (h === IMAGE.hash ? IMAGE : undefined) };
}

/** Applies intents in order, failing the test on any rejection. */
function run(ctx: ReducerContext, ...intents: StateIntent[]): TableState {
  let state = emptyState();
  for (const intent of intents) {
    const r = applyIntent(state, intent, ctx);
    if (!r.ok) assert.fail(`${intent.type} rejected: ${r.error}`);
    state = r.state;
  }
  return state;
}

describe("reducer: maps", () => {
  test("maps are created in order; rev increases", () => {
    const s = run(context(), { type: "map.create", name: "Cave" }, { type: "map.create", name: "Forest" });
    assert.deepEqual(s.maps.map((m) => m.name), ["Cave", "Forest"]);
    assert.equal(s.rev, 2);
  });

  test("rename, send players to maps, delete (which also deletes the map's tokens)", () => {
    const ctx = context();
    let s = run(ctx, { type: "map.create", name: "Cave" }, { type: "map.create", name: "Forest" });
    s = must(applyIntent(s, { type: "token.create", mapId: "id1", col: 0, row: 0 }, ctx));
    s = must(applyIntent(s, { type: "map.rename", mapId: "id2", name: "Dark forest" }, ctx));
    s = must(applyIntent(s, { type: "player.setMap", player: " Jane Doe ", mapId: "id1" }, ctx));
    s = must(applyIntent(s, { type: "player.setMap", player: "JOHN DOE", mapId: "id2" }, ctx));
    assert.equal(s.maps[1]!.name, "Dark forest");
    assert.deepEqual(s.playerMaps, { "jane doe": { name: "Jane Doe", mapId: "id1" }, "john doe": { name: "JOHN DOE", mapId: "id2" } });
    s = must(applyIntent(s, { type: "map.delete", mapId: "id1" }, ctx));
    assert.deepEqual(s.maps.map((m) => m.id), ["id2"]);
    assert.equal(s.tokens.length, 0);
    assert.deepEqual(Object.keys(s.playerMaps), ["john doe"], "players of a deleted map go back to the first map");
    const bad = applyIntent(s, { type: "player.setMap", player: "Jane Doe", mapId: "nope" }, ctx);
    assert.equal(!bad.ok && bad.code, "not_found");
  });

  test("background sets the natural size and derives the grid", () => {
    const s = run(context(), { type: "map.create", name: "Cave" }, { type: "map.setBackground", mapId: "id1", image: IMAGE.hash });
    const map = s.maps[0]!;
    assert.deepEqual(map.background, IMAGE);
    assert.equal(map.width, 1400);
    assert.equal(map.height, 700);
    assert.equal(map.grid.cols, 20);
    assert.equal(map.grid.rows, 10);
  });

  test("unknown image hashes are rejected", () => {
    const ctx = context();
    const s = run(ctx, { type: "map.create", name: "Cave" });
    const r = applyIntent(s, { type: "map.setBackground", mapId: "id1", image: "b".repeat(64) }, ctx);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "not_found");
  });

  test("grid changes re-derive the size from the image and clamp tokens", () => {
    const ctx = context();
    const s = run(
      ctx,
      { type: "map.create", name: "Cave" },
      { type: "map.setBackground", mapId: "id1", image: IMAGE.hash },
      { type: "token.create", mapId: "id1", col: 19, row: 9 },
      { type: "map.setGrid", mapId: "id1", grid: { cellWidth: 140, cellHeight: 140, offsetX: 0, color: "#ff0000", opacity: 0.5, visible: false } },
    );
    const g = s.maps[0]!.grid;
    assert.deepEqual([g.cols, g.rows, g.color, g.opacity, g.visible], [10, 5, "#ff0000", 0.5, false]);
    assert.deepEqual([s.tokens[0]!.col, s.tokens[0]!.row], [9, 4]);
  });

  test("feet per cell and grid splits are map settings", () => {
    const ctx = context();
    let s = run(ctx, { type: "map.create", name: "Cave" }, { type: "token.create", mapId: "id1", col: 3, row: 3 });
    s = must(applyIntent(s, { type: "map.setGrid", mapId: "id1", grid: { feetPerCell: 10, subdivisions: 2 } }, ctx));
    assert.equal(s.maps[0]!.grid.feetPerCell, 10);
    s = must(applyIntent(s, { type: "token.move", tokenId: "id2", col: 4.3, row: 2.7 }, ctx));
    assert.deepEqual([s.tokens[0]!.col, s.tokens[0]!.row], [4.5, 2.5]);
    // Going back to whole cells re-snaps tokens that sat on sub-cells.
    s = must(applyIntent(s, { type: "map.setGrid", mapId: "id1", grid: { subdivisions: 1 } }, ctx));
    assert.ok(Number.isInteger(s.tokens[0]!.col) && Number.isInteger(s.tokens[0]!.row));
  });

  test("without a split, fractional moves snap to whole cells", () => {
    const ctx = context();
    let s = run(ctx, { type: "map.create", name: "Cave" }, { type: "token.create", mapId: "id1", col: 1.4, row: 1.6 });
    assert.deepEqual([s.tokens[0]!.col, s.tokens[0]!.row], [1, 2]);
    s = must(applyIntent(s, { type: "map.setGrid", mapId: "id1", grid: { cellWidth: 70.5, offsetX: 0.25 } }, ctx));
    assert.equal(s.maps[0]!.grid.cellWidth, 70.5);
  });

  test("references to missing maps are rejected without changing the state", () => {
    const state = emptyState();
    const r = applyIntent(state, { type: "map.rename", mapId: "nope", name: "X" }, context());
    assert.deepEqual(r, { ok: false, code: "not_found", error: "map nope not found" });
    assert.equal(state.rev, 0);
  });
});

describe("reducer: tokens and templates", () => {
  function withMapAndTemplate(ctx: ReducerContext) {
    return run(
      ctx,
      { type: "map.create", name: "Cave" }, // id1
      { type: "template.create", name: "Goblin" }, // id2
      { type: "template.update", templateId: "id2", changes: { size: 2, color: "#00ff00", stats: { hp: { current: 7, max: 7 }, ac: 15 } } },
    );
  }

  test("tokens snap and clamp on create and move", () => {
    const ctx = context();
    let s = run(ctx, { type: "map.create", name: "Cave" }, { type: "token.create", mapId: "id1", col: 500, row: -3 });
    assert.deepEqual([s.tokens[0]!.col, s.tokens[0]!.row], [19, 0]);
    s = must(applyIntent(s, { type: "token.move", tokenId: "id2", col: 4, row: 5 }, ctx));
    assert.deepEqual([s.tokens[0]!.col, s.tokens[0]!.row], [4, 5]);
  });

  test("placing a template copies its stats into an independent token", () => {
    const ctx = context();
    let s = withMapAndTemplate(ctx);
    s = must(applyIntent(s, { type: "token.create", mapId: "id1", col: 1, row: 1, templateId: "id2" }, ctx));
    s = must(applyIntent(s, { type: "token.create", mapId: "id1", col: 5, row: 1, templateId: "id2" }, ctx));
    const [a, b] = s.tokens;
    assert.equal(a!.stats.name, "Goblin");
    assert.equal(a!.size, 2);
    assert.equal(a!.stats.ac, 15);
    assert.equal(a!.templateId, "id2");

    // Editing a token changes neither the template nor the other token.
    s = must(applyIntent(s, { type: "token.update", tokenId: a!.id, changes: { stats: { hp: { current: 1 }, name: "Goblin 1" } } }, ctx));
    assert.equal(s.tokens[0]!.stats.hp.current, 1);
    assert.equal(s.tokens[1]!.stats.hp.current, 7);
    assert.equal(s.templates[0]!.stats.hp.current, 7);
    assert.equal(s.templates[0]!.stats.name, "Goblin");

    // Editing the template does not change tokens already placed.
    s = must(applyIntent(s, { type: "template.update", templateId: "id2", changes: { stats: { ac: 18 } } }, ctx));
    assert.equal(s.templates[0]!.stats.ac, 18);
    assert.equal(s.tokens[0]!.stats.ac, 15);
    assert.equal(s.tokens[1]!.stats.ac, 15);
    assert.notEqual(b, undefined);
  });

  test("duplicating a token copies its current stats", () => {
    const ctx = context();
    let s = withMapAndTemplate(ctx);
    s = must(applyIntent(s, { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" }, ctx));
    const id = s.tokens[0]!.id;
    s = must(applyIntent(s, { type: "token.update", tokenId: id, changes: { stats: { hp: { current: 3 }, conditions: ["prone"] } } }, ctx));
    s = must(applyIntent(s, { type: "token.duplicate", tokenId: id }, ctx));
    const copy = s.tokens[1]!;
    assert.notEqual(copy.id, id);
    assert.equal(copy.stats.hp.current, 3);
    assert.deepEqual(copy.stats.conditions, ["prone"]);
    assert.deepEqual([copy.col, copy.row], [2, 0]);
    s = must(applyIntent(s, { type: "token.update", tokenId: copy.id, changes: { stats: { hp: { current: 6 } } } }, ctx));
    assert.equal(s.tokens[0]!.stats.hp.current, 3);
  });

  test("resizing re-clamps; delete removes", () => {
    const ctx = context();
    let s = run(ctx, { type: "map.create", name: "Cave" }, { type: "token.create", mapId: "id1", col: 19, row: 14 });
    s = must(applyIntent(s, { type: "token.update", tokenId: "id2", changes: { size: 3 } }, ctx));
    assert.deepEqual([s.tokens[0]!.col, s.tokens[0]!.row, s.tokens[0]!.size], [17, 12, 3]);
    s = must(applyIntent(s, { type: "token.delete", tokenId: "id2" }, ctx));
    assert.equal(s.tokens.length, 0);
  });

  test("a template can be made from a token; deleting it detaches tokens", () => {
    const ctx = context();
    let s = withMapAndTemplate(ctx);
    s = must(applyIntent(s, { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" }, ctx));
    const tokenId = s.tokens[0]!.id;
    s = must(applyIntent(s, { type: "template.create", name: "Goblin boss", fromTokenId: tokenId }, ctx));
    assert.equal(s.templates[1]!.stats.name, "Goblin boss");
    assert.equal(s.templates[1]!.stats.ac, 15);
    assert.equal(s.tokens[0]!.stats.name, "Goblin");
    s = must(applyIntent(s, { type: "template.delete", templateId: "id2" }, ctx));
    assert.equal(s.templates.length, 1);
    assert.equal(s.tokens[0]!.templateId, null);
  });
});

function must(r: ReturnType<typeof applyIntent>): TableState {
  if (!r.ok) assert.fail(r.error);
  return r.state;
}
