import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { migrateState } from "../../src/shared/migrate.ts";
import { canControl, checkPermission, redactToken, sameName, viewFor } from "../../src/shared/permissions.ts";
import { applyIntent, emptyState, type ReducerContext, type StateIntent } from "../../src/shared/reducer.ts";
import type { TableState } from "../../src/shared/types.ts";
import { validateClientMessage } from "../../src/shared/validate.ts";
import { sampleTable } from "../helpers/ui.ts";

const owner = { name: "Game Master", role: "owner" as const };
const john = { name: "John Doe", role: "player" as const };
const jane = { name: "Jane Doe", role: "player" as const };

function table(): TableState {
  const t = sampleTable();
  t.maps.push({ ...structuredClone(t.maps[0]!), id: "map2", name: "Secret lair" });
  t.tokens[0]!.control = { players: ["JOHN DOE "], everyone: false };
  t.tokens.push({ ...structuredClone(t.tokens[0]!), id: "tok2", control: { players: [], everyone: false } });
  t.tokens.push({ ...structuredClone(t.tokens[0]!), id: "tok3", control: { players: [], everyone: true } });
  t.tokens.push({ ...structuredClone(t.tokens[0]!), id: "tok4", mapId: "map2" });
  return t;
}

describe("permissions", () => {
  test("names match trimmed and case-insensitively", () => {
    assert.ok(sameName(" John Doe", "john doe"));
    assert.ok(!sameName("John", "John Doe"));
  });

  test("who controls a token", () => {
    const t = table();
    const [mine, theirs, anyone] = t.tokens;
    assert.ok(canControl(owner, theirs!), "the owner controls everything");
    assert.ok(canControl(john, mine!));
    assert.ok(!canControl(jane, mine!));
    assert.ok(!canControl(john, theirs!));
    assert.ok(canControl(jane, anyone!), "'any player' tokens");
    assert.ok(!canControl(null, anyone!));
  });

  test("players may only move and edit tokens they control, on the active map", () => {
    const t = table();
    const allowed = (user: typeof john, intent: StateIntent) => checkPermission(user, intent, t) === null;
    assert.ok(allowed(john, { type: "token.move", tokenId: "tok1", col: 1, row: 1 }));
    assert.ok(allowed(john, { type: "token.update", tokenId: "tok1", changes: { stats: { hp: { current: 1 } }, size: 2, color: "#ffffff" } }));
    assert.ok(allowed(jane, { type: "token.move", tokenId: "tok3", col: 1, row: 1 }));
    assert.ok(!allowed(jane, { type: "token.move", tokenId: "tok1", col: 1, row: 1 }));
    assert.ok(!allowed(john, { type: "token.move", tokenId: "tok4", col: 1, row: 1 }), "not on the active map");
    assert.ok(!allowed(john, { type: "token.update", tokenId: "tok1", changes: { control: { everyone: true } } }));
    for (const intent of [
      { type: "token.delete", tokenId: "tok1" },
      { type: "token.duplicate", tokenId: "tok1" },
      { type: "template.create", name: "Mine", fromTokenId: "tok1" },
      { type: "template.update", templateId: "tpl1", changes: { size: 2 } },
      { type: "token.create", mapId: "map1", col: 0, row: 0 },
      { type: "map.activate", mapId: "map2" },
      { type: "map.setGrid", mapId: "map1", grid: { visible: false } },
      { type: "map.create", name: "Mine" },
    ] as StateIntent[]) {
      assert.ok(!allowed(john, intent), intent.type);
      assert.ok(checkPermission(owner, intent, t) === null, `owner: ${intent.type}`);
    }
  });

  test("a player sees only the active map, no templates, and only their tokens' stats", () => {
    const t = table();
    const view = viewFor(t, john);
    assert.deepEqual(view.maps.map((m) => m.id), ["map1"]);
    assert.deepEqual(view.templates, []);
    assert.deepEqual(view.tokens.map((x) => x.id), ["tok1", "tok2", "tok3"]);
    assert.equal(view.tokens[0]!.stats.hp.current, 5);
    assert.equal(view.tokens[1]!.redacted, true);
    assert.equal(view.tokens[1]!.stats.name, "Goblin 1");
    assert.equal(view.tokens[1]!.stats.hp.max, 0);
    assert.equal(view.tokens[1]!.stats.notes, "");
    assert.equal(view.tokens[2]!.redacted, undefined, "'any player' tokens are fully visible");
    assert.equal(viewFor(t, owner), t);
    assert.deepEqual(viewFor({ ...t, activeMapId: null }, john).maps, []);
  });

  test("redaction keeps position and look, hides the sheet and the control list", () => {
    const t = table();
    t.tokens[0]!.stats.notes = "Secret plan";
    const r = redactToken(t.tokens[0]!);
    assert.deepEqual([r.col, r.row, r.color, r.size], [2, 3, "#00aa00", 1]);
    assert.equal(r.stats.notes, "");
    assert.deepEqual(r.control, { players: [], everyone: false });
  });
});

describe("token control in the reducer, validation and migration", () => {
  let n = 0;
  const ctx: ReducerContext = { newId: () => `id${++n}`, getImage: () => undefined };
  const run = (...intents: StateIntent[]) => {
    n = 0;
    let s = emptyState();
    for (const i of intents) {
      const r = applyIntent(s, i, ctx);
      if (!r.ok) assert.fail(r.error);
      s = r.state;
    }
    return s;
  };

  test("control is set on templates and copied to tokens; names are de-duplicated", () => {
    const s = run(
      { type: "map.create", name: "Cave" },
      { type: "template.create", name: "Hero" },
      { type: "template.update", templateId: "id2", changes: { control: { players: ["John Doe", " john doe", "Jane Doe"] } } },
      { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" },
      { type: "token.update", tokenId: "id3", changes: { control: { everyone: true } } },
      { type: "token.duplicate", tokenId: "id3" },
    );
    assert.deepEqual(s.templates[0]!.control, { players: ["John Doe", "Jane Doe"], everyone: false });
    assert.deepEqual(s.tokens[0]!.control, { players: ["John Doe", "Jane Doe"], everyone: true });
    assert.deepEqual(s.tokens[1]!.control, s.tokens[0]!.control);
    assert.notEqual(s.tokens[1]!.control, s.tokens[0]!.control, "independent copies");
  });

  test("validation of hello credentials and control", () => {
    assert.ok(validateClientMessage({ type: "hello", name: "Game Master", password: "x" }).ok);
    assert.ok(validateClientMessage({ type: "hello", name: "Game Master", session: "1.abc" }).ok);
    assert.equal(validateClientMessage({ type: "hello", name: "x", password: 12 }).ok, false);
    assert.equal(validateClientMessage({ type: "hello", name: "x", role: "owner" }).ok, false, "a client cannot claim a role");
    assert.ok(validateClientMessage({ type: "token.update", tokenId: "t", changes: { control: { players: ["A"], everyone: false } } }).ok);
    assert.equal(validateClientMessage({ type: "token.update", tokenId: "t", changes: { control: { players: [""] } } }).ok, false);
    assert.equal(validateClientMessage({ type: "token.update", tokenId: "t", changes: { control: { everyone: "yes" } } }).ok, false);
    assert.equal(validateClientMessage({ type: "token.update", tokenId: "t", changes: { control: { players: Array(51).fill("A") } } }).ok, false);
  });

  test("older saves get an empty control on tokens and templates", () => {
    const old = sampleTable() as unknown as { tokens: Array<Record<string, unknown>>; templates: Array<Record<string, unknown>> };
    delete old.tokens[0]!.control;
    delete old.templates[0]!.control;
    const s = migrateState(old as unknown as TableState);
    assert.deepEqual(s.tokens[0]!.control, { players: [], everyone: false });
    assert.deepEqual(s.templates[0]!.control, { players: [], everyone: false });
  });
});
