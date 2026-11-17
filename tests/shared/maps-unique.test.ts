import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { migrateState } from "../../src/shared/migrate.ts";
import { defaultMapId, playerMapId, viewFor } from "../../src/shared/permissions.ts";
import { applyIntent, emptyState, newToken, type ReducerContext, type StateIntent } from "../../src/shared/reducer.ts";
import type { TableState } from "../../src/shared/types.ts";
import { validateClientMessage } from "../../src/shared/validate.ts";

let n = 0;
const ctx: ReducerContext = { newId: () => `id${++n}`, getImage: () => undefined };
function run(...intents: StateIntent[]): TableState {
  n = 0;
  let s = emptyState();
  for (const i of intents) {
    const r = applyIntent(s, i, ctx);
    if (!r.ok) assert.fail(`${i.type}: ${r.error}`);
    s = r.state;
  }
  return s;
}

describe("default map", () => {
  test("the owner chooses where players start; deleting it falls back to the first map", () => {
    let s = run(
      { type: "map.create", name: "Tavern" }, // id1
      { type: "map.create", name: "Dungeon" }, // id2
      { type: "map.create", name: "Castle" }, // id3
    );
    assert.equal(defaultMapId(s), "id1", "the first map until one is chosen");
    const r = applyIntent(s, { type: "map.setDefault", mapId: "id3" }, ctx);
    assert.ok(r.ok);
    s = r.state;
    assert.equal(s.defaultMapId, "id3");
    assert.equal(playerMapId(s, "New Player"), "id3");
    const del = applyIntent(s, { type: "map.delete", mapId: "id3" }, ctx);
    assert.ok(del.ok);
    assert.equal(del.state.defaultMapId, null);
    assert.equal(playerMapId(del.state, "New Player"), "id1");
    const bad = applyIntent(s, { type: "map.setDefault", mapId: "nope" }, ctx);
    assert.equal(!bad.ok && bad.code, "not_found");
    assert.ok(validateClientMessage({ type: "map.setDefault", mapId: "m1" }).ok);
  });

  test("players do not see which map is the default", () => {
    const s = run({ type: "map.create", name: "Tavern" }, { type: "map.create", name: "Dungeon" }, { type: "map.setDefault", mapId: "id2" });
    const view = viewFor(s, { name: "Jane Doe", role: "player" });
    assert.equal(view.defaultMapId, null);
    assert.deepEqual(view.maps.map((m) => m.name), ["Dungeon"]);
  });
});

describe("per-player maps", () => {
  test("players see the first map until the owner sends them elsewhere", () => {
    const s = run(
      { type: "map.create", name: "Tavern" }, // id1
      { type: "map.create", name: "Dungeon" }, // id2
      { type: "player.setMap", player: "Jane Doe", mapId: "id2" },
    );
    assert.equal(playerMapId(s, "John Doe"), "id1");
    assert.equal(playerMapId(s, "  JANE doe"), "id2");
    assert.equal(playerMapId(emptyState(), "Jane Doe"), null);
  });

  test("an assignment to a map that no longer exists falls back to the first map", () => {
    const s = run({ type: "map.create", name: "Tavern" });
    s.playerMaps["jane doe"] = { name: "Jane Doe", mapId: "gone" };
    assert.equal(playerMapId(s, "Jane Doe"), "id1");
  });
});

describe("unique templates", () => {
  const setup = (unique: boolean) =>
    run(
      { type: "map.create", name: "Cave" }, // id1
      { type: "template.create", name: "Strahd" }, // id2
      { type: "template.update", templateId: "id2", changes: { unique, stats: { hp: { current: 90, max: 90 } } } },
      { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" }, // id3
      { type: "token.update", tokenId: "id3", changes: { stats: { hp: { current: 40 }, conditions: ["frightened"], notes: "Fled north" }, size: 2, color: "#550000" } },
      { type: "token.move", tokenId: "id3", col: 5, row: 5 },
    );

  test("edits to a token of a unique template also update the template", () => {
    const s = setup(true);
    const tpl = s.templates[0]!;
    assert.equal(tpl.unique, true);
    assert.deepEqual(tpl.stats.hp, { current: 40, max: 90, temp: 0 });
    assert.deepEqual(tpl.stats.conditions, ["frightened"]);
    assert.equal(tpl.stats.notes, "Fled north");
    assert.deepEqual([tpl.size, tpl.color], [2, "#550000"]);
    // Placing it again starts from the updated values.
    const r = applyIntent(s, { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" }, ctx);
    assert.ok(r.ok);
    assert.equal(r.state.tokens[1]!.stats.hp.current, 40);
  });

  test("normal templates are not affected by their tokens", () => {
    const tpl = setup(false).templates[0]!;
    assert.equal(tpl.unique, false);
    assert.equal(tpl.stats.hp.current, 90);
    assert.equal(tpl.size, null);
  });

  test("all tokens of a unique template are linked, on every map; positions stay their own", () => {
    let s = setup(true); // token id3 on map id1
    const more = (intents: StateIntent[]) => {
      for (const i of intents) {
        const r = applyIntent(s, i, ctx);
        if (!r.ok) assert.fail(r.error);
        s = r.state;
      }
    };
    more([
      { type: "map.create", name: "Castle" }, // id4
      { type: "token.create", mapId: "id4", col: 1, row: 1, templateId: "id2" }, // id5, starts from the template
      { type: "token.update", tokenId: "id5", changes: { stats: { hp: { current: 12 } }, control: { players: ["Jane Doe"] } } },
    ]);
    const [a, b] = s.tokens;
    assert.equal(a!.stats.hp.current, 12, "the token on the other map changed too");
    assert.equal(b!.stats.hp.current, 12);
    assert.equal(s.templates[0]!.stats.hp.current, 12);
    assert.deepEqual(a!.control.players, ["Jane Doe"]);
    assert.deepEqual([a!.col, a!.row, b!.col, b!.row], [5, 5, 1, 1]);

    // Editing the template edits its tokens too; sizes are re-clamped on each map.
    more([{ type: "template.update", templateId: "id2", changes: { stats: { ac: 20 }, size: 3 } }]);
    assert.deepEqual(s.tokens.map((t) => [t.stats.ac, t.size]), [[20, 3], [20, 3]]);
  });

  test("normal templates never change placed tokens, and their tokens are independent", () => {
    let s = setup(false);
    const r1 = applyIntent(s, { type: "template.update", templateId: "id2", changes: { stats: { ac: 20 } } }, ctx);
    assert.ok(r1.ok);
    s = r1.state;
    assert.equal(s.tokens[0]!.stats.ac, 10);
    const r2 = applyIntent(s, { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" }, ctx);
    assert.ok(r2.ok);
    const r3 = applyIntent(r2.state, { type: "token.update", tokenId: r2.state.tokens[1]!.id, changes: { stats: { ac: 1 } } }, ctx);
    assert.ok(r3.ok);
    assert.deepEqual(r3.state.tokens.map((t) => t.stats.ac), [10, 1]);
  });

  test("ticking 'unique' alone does not overwrite existing tokens", () => {
    const s = setup(false);
    const r = applyIntent(s, { type: "template.update", templateId: "id2", changes: { unique: true } }, ctx);
    assert.ok(r.ok);
    assert.equal(r.state.tokens[0]!.stats.hp.current, 40);
    assert.equal(r.state.templates[0]!.stats.hp.current, 90);
  });

  test("newToken copies a template independently (the hook for future placement rules)", () => {
    const s = setup(true);
    const tpl = s.templates[0]!;
    const token = newToken(tpl, ctx, "unused");
    token.stats.hp.current = 1;
    token.control.players.push("Someone");
    assert.equal(tpl.stats.hp.current, 40);
    assert.deepEqual(tpl.control.players, []);
    assert.equal(newToken(null, ctx, "Token 7").stats.name, "Token 7");
  });

  test("'unique' is only accepted on templates", () => {
    assert.ok(validateClientMessage({ type: "template.update", templateId: "t", changes: { unique: true } }).ok);
    assert.equal(validateClientMessage({ type: "template.update", templateId: "t", changes: { unique: "yes" } }).ok, false);
    assert.equal(validateClientMessage({ type: "token.update", tokenId: "t", changes: { unique: true } }).ok, false);
    assert.ok(validateClientMessage({ type: "player.setMap", player: "Jane Doe", mapId: "m1" }).ok);
    assert.equal(validateClientMessage({ type: "player.setMap", player: "", mapId: "m1" }).ok, false);
    assert.equal(validateClientMessage({ type: "map.activate", mapId: "m1" }).ok, false, "removed in protocol 6");
  });
});

describe("migration to version 6", () => {
  test("the single active map is dropped; templates become non-unique; no default map chosen", () => {
    const old = { rev: 9, activeMapId: "m1", maps: [], tokens: [], templates: [{ id: "t", size: null, color: "#000000", image: null, stats: {}, control: { players: [], everyone: false } }] };
    const s = migrateState(old as unknown as TableState);
    assert.equal("activeMapId" in s, false);
    assert.deepEqual(s.playerMaps, {});
    assert.equal(s.templates[0]!.unique, false);
    assert.equal(s.defaultMapId, null);
  });
});
