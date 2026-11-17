import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readImageInfo } from "../../src/shared/imageInfo.ts";
import {
  abilityModifier,
  applyStatsPatch,
  CONDITIONS,
  cloneStats,
  defaultStats,
  formatModifier,
  hpRatio,
} from "../../src/shared/stats.ts";
import { fakeJpeg, fakePng, fakeWebp } from "../helpers/images.ts";

describe("D&D stats", () => {
  test("ability modifier is floor((score - 10) / 2)", () => {
    const expected: Array<[number, number]> = [[1, -5], [3, -4], [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [15, 2], [20, 5], [30, 10]];
    for (const [score, mod] of expected) assert.equal(abilityModifier(score), mod, `score ${score}`);
  });

  test("modifiers are shown with a sign", () => {
    assert.equal(formatModifier(2), "+2");
    assert.equal(formatModifier(0), "+0");
    assert.equal(formatModifier(-1), "-1");
  });

  test("the standard 5e conditions are listed", () => {
    assert.equal(CONDITIONS.length, 15);
    assert.ok(CONDITIONS.includes("prone"));
    assert.ok(CONDITIONS.includes("exhaustion"));
  });

  test("cloneStats produces an independent copy", () => {
    const a = defaultStats("Goblin 1");
    const b = cloneStats(a);
    b.hp.current = 1;
    b.abilities.str = 18;
    b.conditions.push("prone");
    assert.equal(a.hp.current, 10);
    assert.equal(a.abilities.str, 10);
    assert.deepEqual(a.conditions, []);
  });

  test("applyStatsPatch merges nested fields without mutating the input", () => {
    const a = defaultStats("Jane Doe");
    const b = applyStatsPatch(a, { hp: { current: 4 }, abilities: { dex: 16 }, conditions: ["prone", "prone"], notes: "Hi" });
    assert.deepEqual(b.hp, { current: 4, max: 10, temp: 0 });
    assert.equal(b.abilities.dex, 16);
    assert.equal(b.abilities.str, 10);
    assert.deepEqual(b.conditions, ["prone"]);
    assert.equal(b.notes, "Hi");
    assert.equal(a.hp.current, 10);
  });

  test("hpRatio is clamped to 0..1", () => {
    assert.equal(hpRatio({ current: 5, max: 10, temp: 0 }), 0.5);
    assert.equal(hpRatio({ current: -3, max: 10, temp: 0 }), 0);
    assert.equal(hpRatio({ current: 15, max: 10, temp: 0 }), 1);
    assert.equal(hpRatio({ current: 5, max: 0, temp: 0 }), 0);
  });
});

describe("image info", () => {
  test("reads PNG, JPEG and WebP sizes", () => {
    assert.deepEqual(readImageInfo(fakePng(1400, 1050)), { ext: "png", width: 1400, height: 1050 });
    assert.deepEqual(readImageInfo(fakeJpeg(800, 600)), { ext: "jpg", width: 800, height: 600 });
    assert.deepEqual(readImageInfo(fakeWebp(2000, 1500)), { ext: "webp", width: 2000, height: 1500 });
  });

  test("rejects other data", () => {
    assert.equal(readImageInfo(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
    assert.equal(readImageInfo(new Uint8Array([0x89, 0x50])), null);
    assert.equal(readImageInfo(fakePng(0, 10)), null);
  });
});
