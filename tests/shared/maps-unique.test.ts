import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { migrateState } from "../../src/shared/migrate.ts";
import { playerMapId } from "../../src/shared/permissions.ts";
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

  test("template edits still do not change tokens already placed, even unique ones", () => {
    let s = setup(true);
    const r = applyIntent(s, { type: "template.update", templateId: "id2", changes: { stats: { ac: 20 } } }, ctx);
    assert.ok(r.ok);
    s = r.state;
    assert.equal(s.tokens[0]!.stats.ac, 10);
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
  test("the single active map is dropped; templates become non-unique", () => {
    const old = { rev: 9, activeMapId: "m1", maps: [], tokens: [], templates: [{ id: "t", size: null, color: "#000000", image: null, stats: {}, control: { players: [], everyone: false } }] };
    const s = migrateState(old as unknown as TableState);
    assert.equal("activeMapId" in s, false);
    assert.deepEqual(s.playerMaps, {});
    assert.equal(s.templates[0]!.unique, false);
  });
});
