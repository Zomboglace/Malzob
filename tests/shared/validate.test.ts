import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateClientMessage } from "../../src/shared/validate.ts";

function ok(value: unknown) {
  const r = validateClientMessage(value);
  if (!r.ok) assert.fail(`expected valid, got: ${r.error}`);
  return r.message;
}

function bad(value: unknown, match?: RegExp) {
  const r = validateClientMessage(value);
  assert.equal(r.ok, false, `expected invalid: ${JSON.stringify(value)}`);
  if (match && !r.ok) assert.match(r.error, match);
}

describe("validateClientMessage", () => {
  test("accepts well-formed messages and trims names", () => {
    assert.deepEqual(ok({ type: "hello", name: "  Jane Doe " }), { type: "hello", name: "Jane Doe" });
    ok({ type: "map.create", name: "Cave" });
    ok({ type: "map.setBackground", mapId: "m1", image: null });
    ok({ type: "map.setBackground", mapId: "m1", image: "0".repeat(64) });
    ok({ type: "map.setGrid", mapId: "m1", grid: { cellWidth: 50, cellHeight: 49.5, opacity: 0.5, visible: false, color: "#AABBCC" } });
    ok({ type: "token.create", mapId: "m1", col: 1, row: 2, templateId: "t1" });
    ok({ type: "token.move", tokenId: "t1", col: 3, row: 4 });
    ok({
      type: "token.update",
      tokenId: "t1",
      changes: { size: 2, image: null, stats: { hp: { current: -2 }, abilities: { str: 18 }, conditions: ["prone"], notes: "x" } },
    });
    ok({ type: "template.create", name: "Goblin", fromTokenId: "t1" });
  });

  test("accepts sub-pixel grid values, fractional positions and grid splits", () => {
    const grid = ok({ type: "map.setGrid", mapId: "m1", grid: { cellWidth: 70.123456, offsetX: -3.25, feetPerCell: 2.5, subdivisions: 2 } });
    assert.deepEqual(grid, { type: "map.setGrid", mapId: "m1", grid: { cellWidth: 70.1235, offsetX: -3.25, feetPerCell: 2.5, subdivisions: 2 } });
    assert.deepEqual(ok({ type: "token.move", tokenId: "t1", col: 2.5, row: 0.25 }), { type: "token.move", tokenId: "t1", col: 2.5, row: 0.25 });
  });

  test("normalises colours to lower case", () => {
    const m = ok({ type: "map.setGrid", mapId: "m1", grid: { color: "#AABBCC" } });
    assert.deepEqual(m, { type: "map.setGrid", mapId: "m1", grid: { color: "#aabbcc" } });
  });

  test("rejects malformed messages", () => {
    bad(null, /object/);
    bad([], /object/);
    bad({ type: "nope" }, /unknown message type/);
    bad({ type: "hello" }, /name/);
    bad({ type: "hello", name: "   " }, /empty/);
    bad({ type: "hello", name: "x".repeat(81) }, /too long/);
    bad({ type: "hello", name: "Jane Doe", admin: true }, /not allowed/);
    bad({ type: "map.rename", mapId: "../etc", name: "x" }, /valid id/);
    bad({ type: "token.move", tokenId: "t1", col: Number.NaN, row: 0 }, /number/);
    bad({ type: "token.move", tokenId: "t1", col: "1", row: 0 }, /number/);
    bad({ type: "token.update", tokenId: "t1", changes: { size: "2" } }, /number/);
    bad({ type: "token.update", tokenId: "t1", changes: { size: 0.05 } }, /between/);
    bad({ type: "map.setGrid", mapId: "m1", grid: { subdivisions: 0 } }, /between/);
    bad({ type: "map.setGrid", mapId: "m1", grid: { subdivisions: 1.5 } }, /integer/);
    bad({ type: "map.setGrid", mapId: "m1", grid: { feetPerCell: 0 } }, /between/);
    bad({ type: "map.setGrid", mapId: "m1", grid: { offsetX: Number.POSITIVE_INFINITY } }, /number/);
    bad({ type: "token.update", tokenId: "t1", changes: { size: 0 } }, /between/);
    bad({ type: "token.update", tokenId: "t1", changes: { size: 11 } }, /between/);
    bad({ type: "token.update", tokenId: "t1", changes: { color: "red" } }, /colour/);
    bad({ type: "token.update", tokenId: "t1", changes: { image: "../../secret" } }, /image hash/);
    bad({ type: "token.update", tokenId: "t1", changes: { stats: { conditions: ["sleepy"] } } }, /unknown condition/);
    bad({ type: "token.update", tokenId: "t1", changes: { stats: { abilities: { luck: 3 } } } }, /not allowed/);
    bad({ type: "token.update", tokenId: "t1", changes: { stats: { abilities: { str: 99 } } } }, /between/);
    bad({ type: "token.update", tokenId: "t1", changes: { stats: { hp: { current: Number.NaN } } } }, /integer/);
    bad({ type: "map.setGrid", mapId: "m1", grid: { opacity: 2 } }, /opacity/);
    bad({ type: "map.setGrid", mapId: "m1", grid: { cellHeight: 3.9 } }, /between/);
    bad({ type: "map.setGrid", mapId: "m1", grid: { cellSize: 50 } }, /not allowed/);
    bad({ type: "map.setGrid", mapId: "m1", grid: { visible: "yes" } }, /boolean/);
  });
});
