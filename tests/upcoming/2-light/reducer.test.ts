/** Part 2 — light in the state: reducer, validation, permissions, players' view, migration. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { migrateState } from "../../../src/shared/migrate.ts";
import { checkPermission, viewFor } from "../../../src/shared/permissions.ts";
import { applyIntent, emptyState, type ReducerContext, type StateIntent } from "../../../src/shared/reducer.ts";
import type { TableState } from "../../../src/shared/types.ts";
import { validateClientMessage } from "../../../src/shared/validate.ts";
import { litTable } from "./helpers.ts";

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

describe("light: reducer", () => {
  test("new maps are fully bright; new tokens and templates carry no light", () => {
    const s = run(
      { type: "map.create", name: "Cave" },
      { type: "template.create", name: "Goblin" },
      { type: "token.create", mapId: "id1", col: 0, row: 0 },
    );
    assert.deepEqual(s.maps[0]!.light, { base: "bright", areas: {} });
    assert.equal(s.templates[0]!.light, null);
    assert.equal(s.tokens[0]!.light, null);
  });

  test("set the base level; paint and erase sub-cells; cells outside the grid are ignored", () => {
    const s = run(
      { type: "map.create", name: "Cave" }, // 20 x 15 cells
      { type: "light.setBase", mapId: "id1", level: "dark" },
      { type: "light.paint", mapId: "id1", cells: [[3, 4], [4, 4], [19, 14], [20, 0], [0, 15]], level: "dim" },
      { type: "light.paint", mapId: "id1", cells: [[4, 4]], level: null },
      { type: "light.paint", mapId: "id1", cells: [[5, 5]], level: "dark" },
    );
    assert.deepEqual(s.maps[0]!.light, { base: "dark", areas: { "3,4": "dim", "19,14": "dim", "5,5": "dark" } }, "a level equal to the base is still stored");
  });

  test("changing the cell split remaps the painted areas", () => {
    const s = run(
      { type: "map.create", name: "Cave" },
      { type: "light.setBase", mapId: "id1", level: "dim" },
      { type: "light.paint", mapId: "id1", cells: [[0, 0]], level: "dark" },
      { type: "map.setGrid", mapId: "id1", grid: { subdivisions: 2 } },
    );
    assert.deepEqual(s.maps[0]!.light.areas, { "0,0": "dark", "1,0": "dark", "0,1": "dark", "1,1": "dark" });
  });

  test("fewer columns or rows drop the painted areas outside", () => {
    const s = run(
      { type: "map.create", name: "Cave" },
      { type: "light.paint", mapId: "id1", cells: [[1, 1], [10, 1], [1, 10]], level: "dark" },
      { type: "map.setGrid", mapId: "id1", grid: { cols: 5, rows: 5 } },
    );
    assert.deepEqual(s.maps[0]!.light.areas, { "1,1": "dark" });
  });

  test("token light: set, copied from templates, shared by unique templates, removed", () => {
    let s = run(
      { type: "map.create", name: "Cave" }, // id1
      { type: "template.create", name: "Guard" }, // id2
      { type: "template.update", templateId: "id2", changes: { light: { bright: 20, dim: 20 } } },
      { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" }, // id3
    );
    assert.deepEqual(s.tokens[0]!.light, { bright: 20, dim: 20 });
    const step = (i: StateIntent) => {
      const r = applyIntent(s, i, ctx);
      if (!r.ok) assert.fail(r.error);
      s = r.state;
    };
    step({ type: "template.update", templateId: "id2", changes: { unique: true } });
    step({ type: "token.create", mapId: "id1", col: 2, row: 0, templateId: "id2" }); // id4
    step({ type: "token.update", tokenId: "id4", changes: { light: { bright: 30, dim: 30 } } });
    assert.deepEqual(s.templates[0]!.light, { bright: 30, dim: 30 });
    assert.deepEqual(s.tokens[0]!.light, { bright: 30, dim: 30 }, "linked copy");
    step({ type: "token.update", tokenId: "id3", changes: { light: null } });
    assert.deepEqual(s.tokens.map((t) => t.light), [null, null]);
  });
});

describe("light: validation", () => {
  const ok = (m: unknown) => assert.ok(validateClientMessage(m).ok, JSON.stringify(m));
  const bad = (m: unknown) => assert.equal(validateClientMessage(m).ok, false, JSON.stringify(m));

  test("messages", () => {
    ok({ type: "light.setBase", mapId: "m1", level: "dim" });
    ok({ type: "light.paint", mapId: "m1", cells: [[0, 0], [3, 7]], level: "bright" });
    ok({ type: "light.paint", mapId: "m1", cells: [], level: null });
    ok({ type: "token.update", tokenId: "t1", changes: { light: { bright: 12.5, dim: 0 } } });
    ok({ type: "template.update", templateId: "t1", changes: { light: null } });
    bad({ type: "light.setBase", mapId: "m1", level: "twilight" });
    bad({ type: "light.paint", mapId: "m1", cells: [[0.5, 0]], level: "dim" });
    bad({ type: "light.paint", mapId: "m1", cells: [[-1, 0]], level: "dim" });
    bad({ type: "light.paint", mapId: "m1", cells: [[0]], level: "dim" });
    bad({ type: "light.paint", mapId: "m1", cells: Array.from({ length: 10_001 }, () => [0, 0]), level: "dim" });
    bad({ type: "light.paint", mapId: "m1", cells: [[0, 0]] });
    bad({ type: "token.update", tokenId: "t1", changes: { light: { bright: -1, dim: 0 } } });
    bad({ type: "token.update", tokenId: "t1", changes: { light: { bright: 10 } } });
    bad({ type: "token.update", tokenId: "t1", changes: { light: { bright: 10, dim: 10, color: "#ffaa00" } } });
  });
});

describe("light: permissions and what players receive", () => {
  const owner = { name: "Game Master", role: "owner" as const };
  const john = { name: "John Doe", role: "player" as const };
  const table = litTable({ base: "dim", areas: { "1,1": "dark" } });
  table.tokens[0]!.control = { players: ["John Doe"], everyone: false };

  test("only the owner paints light and gives lights to tokens", () => {
    const ownerOnly: StateIntent[] = [
      { type: "light.setBase", mapId: "map1", level: "dark" },
      { type: "light.paint", mapId: "map1", cells: [[0, 0]], level: "bright" },
      { type: "token.update", tokenId: "tok1", changes: { light: { bright: 20, dim: 20 } } },
      { type: "token.update", tokenId: "tok1", changes: { stats: { ac: 12 }, light: null } },
    ];
    for (const intent of ownerOnly) {
      assert.equal(checkPermission(owner, intent, table), null, intent.type);
      assert.notEqual(checkPermission(john, intent, table), null, `${intent.type} by a player`);
    }
    assert.equal(checkPermission(john, { type: "token.update", tokenId: "tok1", changes: { stats: { ac: 12 } } }, table), null, "the rest of their token is still theirs");
  });

  test("players receive their map without the painted areas", () => {
    assert.deepEqual(viewFor(table, john).maps[0]!.light, { base: "dim", areas: {} });
    assert.deepEqual(viewFor(table, owner).maps[0]!.light, { base: "dim", areas: { "1,1": "dark" } });
  });
});

describe("light: migration", () => {
  test("older maps are fully bright; older tokens and templates have no light", () => {
    const old = litTable() as unknown as {
      maps: Array<Record<string, unknown>>;
      tokens: Array<Record<string, unknown>>;
      templates: Array<Record<string, unknown>>;
    };
    delete old.maps[0]!.light;
    delete old.tokens[0]!.light;
    delete old.templates[0]!.light;
    const s = migrateState(old as unknown as TableState);
    assert.deepEqual(s.maps[0]!.light, { base: "bright", areas: {} });
    assert.equal(s.tokens[0]!.light, null);
    assert.equal(s.templates[0]!.light, null);
  });
});
