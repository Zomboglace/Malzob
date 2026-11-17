/** Part 3 — fog in the reducer, permissions, validation, what players receive, migration. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LIGHT_PRESETS } from "../../../src/shared/light.ts";
import { migrateState } from "../../../src/shared/migrate.ts";
import { checkPermission, viewFor } from "../../../src/shared/permissions.ts";
import { applyIntent, emptyState, type ReducerContext, type StateIntent } from "../../../src/shared/reducer.ts";
import type { TableState } from "../../../src/shared/types.ts";
import { validateClientMessage } from "../../../src/shared/validate.ts";
import { updateFog } from "../../../src/shared/vision.ts";
import { wall } from "../1-walls/helpers.ts";
import { addToken, visionTable } from "./helpers.ts";

let n = 0;
const ctx: ReducerContext = { newId: () => `id${++n}`, getImage: () => undefined };
const owner = { name: "Game Master", role: "owner" as const };
const john = { name: "John Doe", role: "player" as const };

function apply(state: TableState, ...intents: StateIntent[]): TableState {
  let s = state;
  for (const i of intents) {
    const r = applyIntent(s, i, ctx);
    if (!r.ok) assert.fail(`${i.type}: ${r.error}`);
    s = r.state;
  }
  return s;
}

describe("vision: reducer", () => {
  test("new tokens and templates see like humans; the fog starts empty", () => {
    n = 0;
    const s = apply(emptyState(), { type: "map.create", name: "Cave" }, { type: "template.create", name: "Elf" }, { type: "token.create", mapId: "id1", col: 0, row: 0 });
    assert.deepEqual(s.tokens[0]!.vision, { darkvision: 0, range: null });
    assert.deepEqual(s.templates[0]!.vision, { darkvision: 0, range: null });
    assert.deepEqual(emptyState().fog, {});
  });

  test("every change updates the fog with what player tokens see", () => {
    const start = visionTable({ light: LIGHT_PRESETS.candle, at: [1, 1] });
    const s = apply(start, { type: "token.move", tokenId: "tok1", col: 1, row: 6 });
    const explored = new Set(s.fog["template:tpl1"]!["map1"]);
    assert.ok(explored.has("1,6"), "after the move");
    assert.ok(!explored.has("1,1"), "the start was never recorded: fog is updated after each intent, not before");
  });

  test("vision settings: set by the owner, copied from templates, shared by unique templates", () => {
    n = 0;
    let s = apply(
      emptyState(),
      { type: "map.create", name: "Cave" }, // id1
      { type: "template.create", name: "Elf" }, // id2
      { type: "template.update", templateId: "id2", changes: { vision: { darkvision: 60 } } },
      { type: "token.create", mapId: "id1", col: 0, row: 0, templateId: "id2" }, // id3
    );
    assert.deepEqual(s.tokens[0]!.vision, { darkvision: 60, range: null });
    s = apply(s, { type: "token.update", tokenId: "id3", changes: { vision: { range: 120 } } });
    assert.deepEqual(s.tokens[0]!.vision, { darkvision: 60, range: 120 });
    assert.deepEqual(s.templates[0]!.vision, { darkvision: 60, range: null }, "not unique: the template keeps its own");
    s = apply(s, { type: "template.update", templateId: "id2", changes: { unique: true } }, { type: "token.update", tokenId: "id3", changes: { vision: { range: 90 } } });
    assert.deepEqual(s.templates[0]!.vision, { darkvision: 60, range: 90 }, "unique: the template follows its token");
  });

  test("the owner resets the fog of one map, or of everything", () => {
    let s = updateFog(visionTable({ light: LIGHT_PRESETS.candle, at: [1, 1] }));
    s.fog["template:tpl1"]!["other-map"] = ["0,0"];
    s = apply(s, { type: "token.move", tokenId: "tok1", col: 1, row: 6 });
    assert.ok(s.fog["template:tpl1"]!["map1"]!.includes("1,1"));

    s = apply(s, { type: "fog.reset", mapId: "map1" });
    const map1 = new Set(s.fog["template:tpl1"]!["map1"]);
    assert.ok(!map1.has("1,1"), "forgotten");
    assert.ok(map1.has("1,6"), "what is seen right now is explored again at once");
    assert.deepEqual(s.fog["template:tpl1"]!["other-map"], ["0,0"], "other maps untouched");

    s = apply(s, { type: "fog.reset" });
    assert.equal(s.fog["template:tpl1"]!["other-map"], undefined);
  });

  test("changing the cell split remaps the fog", () => {
    let s = updateFog(visionTable({ light: LIGHT_PRESETS.candle, at: [1, 1] }));
    s = apply(s, { type: "token.move", tokenId: "tok1", col: 1, row: 6 });
    s = apply(s, { type: "map.setGrid", mapId: "map1", grid: { subdivisions: 2 } });
    const explored = new Set(s.fog["template:tpl1"]!["map1"]);
    assert.ok(["2,2", "3,2", "2,3", "3,3"].every((k) => explored.has(k)), "old cell (1, 1) is now 4 explored sub-cells");
  });

  test("deleting a map deletes its fog", () => {
    let s = updateFog(visionTable({ light: LIGHT_PRESETS.candle }));
    s = { ...s, maps: [...s.maps, { ...structuredClone(s.maps[0]!), id: "map2", name: "Spare" }] };
    s = apply(s, { type: "map.delete", mapId: "map1" });
    assert.equal(s.fog["template:tpl1"]?.["map1"], undefined);
  });
});

describe("vision: validation and permissions", () => {
  test("messages", () => {
    const ok = (m: unknown) => assert.ok(validateClientMessage(m).ok, JSON.stringify(m));
    const bad = (m: unknown) => assert.equal(validateClientMessage(m).ok, false, JSON.stringify(m));
    ok({ type: "fog.reset" });
    ok({ type: "fog.reset", mapId: "m1" });
    ok({ type: "token.update", tokenId: "t", changes: { vision: { darkvision: 60 } } });
    ok({ type: "token.update", tokenId: "t", changes: { vision: { range: null } } });
    ok({ type: "template.update", templateId: "t", changes: { vision: { darkvision: 0, range: 300.5 } } });
    bad({ type: "fog.reset", mapId: "" });
    bad({ type: "token.update", tokenId: "t", changes: { vision: { darkvision: -5 } } });
    bad({ type: "token.update", tokenId: "t", changes: { vision: { range: "far" } } });
    bad({ type: "token.update", tokenId: "t", changes: { vision: { blindsight: 10 } } });
  });

  test("only the owner resets the fog and sets how tokens see", () => {
    const table = visionTable();
    for (const intent of [
      { type: "fog.reset" },
      { type: "fog.reset", mapId: "map1" },
      { type: "token.update", tokenId: "tok1", changes: { vision: { darkvision: 120 } } },
    ] as StateIntent[]) {
      assert.equal(checkPermission(owner, intent, table), null, intent.type);
      assert.notEqual(checkPermission(john, intent, table), null, `${intent.type} by a player`);
    }
  });
});

describe("vision: what players receive", () => {
  // Dark map, wall on col 5. John's hero at (1, 3) with a torch.
  function scene() {
    const table = visionTable({ light: LIGHT_PRESETS.torch, walls: [wall([5, 0], [5, 8])] });
    addToken(table, "goblin", 3, 3); // lit by the torch, in sight
    addToken(table, "orc", 7, 3); // behind the wall
    addToken(table, "shade", 4, 7, { mapId: "map1" }); // in the torch's dim ring
    return updateFog(table);
  }

  test("only the tokens they control or see; nothing else, not even redacted", () => {
    const view = viewFor(scene(), john);
    assert.deepEqual(view.tokens.map((t) => t.id).sort(), ["goblin", "shade", "tok1"]);
    assert.equal(view.tokens.find((t) => t.id === "goblin")!.redacted, true, "seen but not controlled: redacted");
    assert.equal(view.tokens.find((t) => t.id === "tok1")!.redacted, undefined);
  });

  test("their vision, and no fog, walls or painted light", () => {
    const view = viewFor(scene(), john);
    assert.equal(view.vision!.mapId, "map1");
    assert.equal(view.vision!.visible["3,3"], "bright");
    assert.equal(view.vision!.visible["4,7"], "dim");
    assert.equal(view.vision!.visible["7,3"], undefined);
    assert.ok(view.vision!.explored.includes("3,3"));
    assert.deepEqual(view.fog, {});
    assert.deepEqual(view.walls, []);
  });

  test("a token out of sight disappears from their view", () => {
    const table = scene();
    table.tokens.find((t) => t.id === "goblin")!.col = 8;
    assert.ok(!viewFor(table, john).tokens.some((t) => t.id === "goblin"));
  });

  test("a player with no token receives no tokens at all, even in bright light", () => {
    const table = scene();
    table.maps[0]!.light.base = "bright";
    const view = viewFor(table, { name: "Mary Major", role: "player" });
    assert.deepEqual(view.tokens, []);
    assert.deepEqual(view.vision, { mapId: "map1", visible: {}, explored: [] });
  });

  test("the owner receives everything, with the fog and without a vision", () => {
    const table = scene();
    const view = viewFor(table, owner);
    assert.equal(view.tokens.length, 4);
    assert.ok(view.fog["template:tpl1"]);
    assert.equal(view.vision, undefined);
  });
});

describe("vision: migration", () => {
  test("older saves get an empty fog and human vision", () => {
    const old = visionTable() as unknown as { fog?: unknown; tokens: Array<Record<string, unknown>>; templates: Array<Record<string, unknown>> };
    delete old.fog;
    delete old.tokens[0]!.vision;
    delete old.templates[0]!.vision;
    const s = migrateState(old as unknown as TableState);
    assert.deepEqual(s.fog, {});
    assert.deepEqual(s.tokens[0]!.vision, { darkvision: 0, range: null });
    assert.deepEqual(s.templates[0]!.vision, { darkvision: 0, range: null });
  });
});
