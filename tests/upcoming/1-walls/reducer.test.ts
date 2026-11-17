/** Part 1 — walls in the state: reducer, validation, permissions, players' view, migration. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { migrateState } from "../../../src/shared/migrate.ts";
import { checkPermission, viewFor } from "../../../src/shared/permissions.ts";
import { applyIntent, emptyState, type ReducerContext, type StateIntent } from "../../../src/shared/reducer.ts";
import type { TableState } from "../../../src/shared/types.ts";
import { validateClientMessage } from "../../../src/shared/validate.ts";
import { tableWithWalls, wall } from "./helpers.ts";

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

function refused(state: TableState, intent: StateIntent) {
  const r = applyIntent(state, intent, ctx);
  assert.equal(r.ok, false, `${intent.type} should be refused`);
  return r.ok ? null : r;
}

describe("walls: reducer", () => {
  test("an empty state has no walls", () => {
    assert.deepEqual(emptyState().walls, []);
  });

  test("create a wall (default kind 'wall', closed) with fractional end points", () => {
    const s = run(
      { type: "map.create", name: "Cave" }, // id1: 20 x 15 cells
      { type: "wall.create", mapId: "id1", from: { col: 2, row: 3.25 }, to: { col: 6.5, row: 3.25 } }, // id2
    );
    assert.deepEqual(s.walls, [{ id: "id2", mapId: "id1", from: { col: 2, row: 3.25 }, to: { col: 6.5, row: 3.25 }, kind: "wall", open: false }]);
  });

  test("end points are clamped into the grid and rounded to 6 decimals", () => {
    const s = run(
      { type: "map.create", name: "Cave" },
      { type: "wall.create", mapId: "id1", from: { col: -3, row: 2.1234567 }, to: { col: 99, row: 99 }, kind: "seeThrough" },
    );
    assert.deepEqual(s.walls[0]!.from, { col: 0, row: 2.123457 });
    assert.deepEqual(s.walls[0]!.to, { col: 20, row: 15 });
    assert.equal(s.walls[0]!.kind, "seeThrough");
  });

  test("zero-length walls are refused, also after clamping; unknown maps too", () => {
    const s = run({ type: "map.create", name: "Cave" });
    assert.equal(refused(s, { type: "wall.create", mapId: "id1", from: { col: 1, row: 1 }, to: { col: 1, row: 1 } })?.code, "invalid");
    assert.equal(refused(s, { type: "wall.create", mapId: "id1", from: { col: -5, row: 1 }, to: { col: -2, row: 1 } })?.code, "invalid");
    assert.equal(refused(s, { type: "wall.create", mapId: "nope", from: { col: 1, row: 1 }, to: { col: 2, row: 1 } })?.code, "not_found");
  });

  test("update, open/close doors, delete", () => {
    let s = run(
      { type: "map.create", name: "Cave" },
      { type: "wall.create", mapId: "id1", from: { col: 1, row: 1 }, to: { col: 2, row: 1 }, kind: "door" }, // id2
    );
    const step = (i: StateIntent) => {
      const r = applyIntent(s, i, ctx);
      if (!r.ok) assert.fail(r.error);
      s = r.state;
    };
    step({ type: "door.setOpen", wallId: "id2", open: true });
    assert.equal(s.walls[0]!.open, true);
    step({ type: "wall.update", wallId: "id2", changes: { to: { col: 3, row: 1 } } });
    assert.deepEqual(s.walls[0]!.to, { col: 3, row: 1 });
    assert.equal(s.walls[0]!.open, true, "still an open door");
    step({ type: "wall.update", wallId: "id2", changes: { kind: "wall" } });
    assert.deepEqual([s.walls[0]!.kind, s.walls[0]!.open], ["wall", false], "no longer a door: not open");
    assert.equal(refused(s, { type: "door.setOpen", wallId: "id2", open: true })?.code, "invalid", "only doors open");
    step({ type: "wall.delete", wallId: "id2" });
    assert.deepEqual(s.walls, []);
    assert.equal(refused(s, { type: "wall.delete", wallId: "id2" })?.code, "not_found");
  });

  test("deleting a map deletes its walls", () => {
    const s = run(
      { type: "map.create", name: "Cave" }, // id1
      { type: "map.create", name: "Forest" }, // id2
      { type: "wall.create", mapId: "id1", from: { col: 1, row: 1 }, to: { col: 2, row: 1 } },
      { type: "wall.create", mapId: "id2", from: { col: 1, row: 1 }, to: { col: 2, row: 1 } },
      { type: "map.delete", mapId: "id1" },
    );
    assert.deepEqual(s.walls.map((w) => w.mapId), ["id2"]);
  });

  test("token.move itself never checks walls (the server does, with isMoveBlocked)", () => {
    const s = run(
      { type: "map.create", name: "Cave" },
      { type: "token.create", mapId: "id1", col: 2, row: 3 }, // id2
      { type: "wall.create", mapId: "id1", from: { col: 4, row: 0 }, to: { col: 4, row: 15 } },
      { type: "token.move", tokenId: "id2", col: 6, row: 3, via: "drag" },
    );
    assert.deepEqual([s.tokens[0]!.col, s.tokens[0]!.row], [6, 3]);
  });
});

describe("walls: validation", () => {
  const ok = (m: unknown) => assert.ok(validateClientMessage(m).ok, JSON.stringify(m));
  const bad = (m: unknown) => assert.equal(validateClientMessage(m).ok, false, JSON.stringify(m));

  test("messages", () => {
    ok({ type: "wall.create", mapId: "m1", from: { col: 0, row: 0.5 }, to: { col: 3.25, row: 0.5 } });
    ok({ type: "wall.create", mapId: "m1", from: { col: 0, row: 0 }, to: { col: 1, row: 0 }, kind: "door" });
    ok({ type: "wall.update", wallId: "w1", changes: { kind: "seeThrough" } });
    ok({ type: "wall.update", wallId: "w1", changes: {} });
    ok({ type: "wall.delete", wallId: "w1" });
    ok({ type: "door.setOpen", wallId: "w1", open: false });
    ok({ type: "token.move", tokenId: "t1", col: 1, row: 1, via: "drag" });
    ok({ type: "token.move", tokenId: "t1", col: 1, row: 1, via: "keyboard" });
    bad({ type: "wall.create", mapId: "m1", from: { col: 0 }, to: { col: 1, row: 0 } });
    bad({ type: "wall.create", mapId: "m1", from: { col: 0, row: 0, z: 1 }, to: { col: 1, row: 0 } });
    bad({ type: "wall.create", mapId: "m1", from: { col: "0", row: 0 }, to: { col: 1, row: 0 } });
    bad({ type: "wall.create", mapId: "m1", from: { col: Number.NaN, row: 0 }, to: { col: 1, row: 0 } });
    bad({ type: "wall.create", mapId: "m1", from: { col: 0, row: 0 }, to: { col: 1, row: 0 }, kind: "window" });
    bad({ type: "wall.update", wallId: "w1", changes: { open: true } });
    bad({ type: "door.setOpen", wallId: "w1", open: "yes" });
    bad({ type: "token.move", tokenId: "t1", col: 1, row: 1, via: "teleport" });
  });
});

describe("walls: permissions and what players receive", () => {
  const table = tableWithWalls([wall([4, 0], [4, 8]), wall([5, 5], [6, 5], "door")]);
  const owner = { name: "Game Master", role: "owner" as const };
  const player = { name: "John Doe", role: "player" as const };

  test("only the owner edits walls and opens doors", () => {
    const intents: StateIntent[] = [
      { type: "wall.create", mapId: "map1", from: { col: 0, row: 0 }, to: { col: 1, row: 0 } },
      { type: "wall.update", wallId: table.walls[0]!.id, changes: { kind: "door" } },
      { type: "wall.delete", wallId: table.walls[0]!.id },
      { type: "door.setOpen", wallId: table.walls[1]!.id, open: true },
    ];
    for (const intent of intents) {
      assert.equal(checkPermission(owner, intent, table), null, intent.type);
      assert.notEqual(checkPermission(player, intent, table), null, intent.type);
    }
  });

  test("players never receive walls or doors; the owner receives them all", () => {
    assert.deepEqual(viewFor(table, player).walls, []);
    assert.equal(viewFor(table, owner).walls.length, 2);
  });
});

describe("walls: migration", () => {
  test("older saves get an empty wall list", () => {
    const old = { ...emptyState() } as Partial<TableState>;
    delete old.walls;
    assert.deepEqual(migrateState(old as TableState).walls, []);
  });
});
