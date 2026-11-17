/** Part 1 — shared wall geometry (src/shared/walls.ts). See docs/spec-1-walls.md. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  blocksMovement,
  blocksSight,
  canMove,
  isMoveBlocked,
  lineBlocked,
  MAX_WALL_PRECISION,
  MOVE_TOLERANCE,
  snapWallPoint,
  wallAt,
} from "../../../src/shared/walls.ts";
import { cell, tableWithWalls, wall } from "./helpers.ts";

const owner = { name: "Game Master", role: "owner" as const };
const player = { name: "John Doe", role: "player" as const };

describe("walls: snapping points", () => {
  test("rounds to the chosen precision, independent of the map's cell split", () => {
    assert.equal(MAX_WALL_PRECISION, 10);
    assert.deepEqual(snapWallPoint(cell(2.37, 3.81), 1), cell(2, 4));
    assert.deepEqual(snapWallPoint(cell(2.37, 3.81), 4), cell(2.25, 3.75));
    assert.deepEqual(snapWallPoint(cell(2.37, 3.81), 10), cell(2.4, 3.8));
    assert.deepEqual(snapWallPoint(cell(2.37, 3.81), 3), cell(2.333333, 3.666667));
  });
});

describe("walls: what blocks what", () => {
  test("kinds", () => {
    assert.equal(MOVE_TOLERANCE, 0.1);
    assert.equal(blocksMovement(wall([0, 0], [1, 0], "wall")), true);
    assert.equal(blocksMovement(wall([0, 0], [1, 0], "seeThrough")), true);
    assert.equal(blocksMovement(wall([0, 0], [1, 0], "door", false)), true);
    assert.equal(blocksMovement(wall([0, 0], [1, 0], "door", true)), false);
    assert.equal(blocksSight(wall([0, 0], [1, 0], "wall")), true);
    assert.equal(blocksSight(wall([0, 0], [1, 0], "seeThrough")), false);
    assert.equal(blocksSight(wall([0, 0], [1, 0], "door", false)), true);
    assert.equal(blocksSight(wall([0, 0], [1, 0], "door", true)), false);
  });
});

describe("walls: line of sight", () => {
  const vertical = wall([5, 0], [5, 8]);

  test("a wall across the line blocks it", () => {
    assert.equal(lineBlocked(cell(0.5, 0.5), cell(8.5, 0.5), [vertical]), true);
    assert.equal(lineBlocked(cell(0.5, 0.5), cell(4.5, 7.5), [vertical]), false);
    assert.equal(lineBlocked(cell(8.5, 0.5), cell(0.5, 0.5), [vertical]), true, "in both directions");
  });

  test("see-through walls and open doors do not block sight; a custom rule can be passed", () => {
    assert.equal(lineBlocked(cell(0.5, 0.5), cell(8.5, 0.5), [wall([5, 0], [5, 8], "seeThrough")]), false);
    assert.equal(lineBlocked(cell(0.5, 0.5), cell(8.5, 0.5), [wall([5, 0], [5, 8], "door", true)]), false);
    assert.equal(lineBlocked(cell(0.5, 0.5), cell(8.5, 0.5), [wall([5, 0], [5, 8], "door", false)]), true);
    assert.equal(lineBlocked(cell(0.5, 0.5), cell(8.5, 0.5), [wall([5, 0], [5, 8], "seeThrough")], blocksMovement), true);
  });

  test("the end points are excluded: a point lying on a wall is not hidden by it", () => {
    assert.equal(lineBlocked(cell(0.5, 0.5), cell(5, 0.5), [vertical]), false);
    assert.equal(lineBlocked(cell(5, 0.5), cell(8.5, 0.5), [vertical]), false);
  });

  test("touching a wall's end, or running along it, counts as blocked", () => {
    assert.equal(lineBlocked(cell(0, 8), cell(10, 8), [vertical]), true, "passes through the wall's end point (5, 8)");
    assert.equal(lineBlocked(cell(5, 1), cell(5, 9), [vertical]), true, "collinear overlap");
    assert.equal(lineBlocked(cell(0.5, 8.5), cell(9.5, 8.5), [vertical]), false, "passes below the wall");
  });

  test("diagonal and off-grid walls", () => {
    const diagonal = wall([2.25, 2.25], [4.75, 4.75]);
    assert.equal(lineBlocked(cell(0.5, 4.5), cell(6.5, 2.5), [diagonal]), true);
    assert.equal(lineBlocked(cell(0.5, 0.5), cell(6.5, 0.5), [diagonal]), false);
  });
});

describe("walls: can a token fit through?", () => {
  const lineWithGap = (gapFrom: number, gapTo: number) => [wall([0, 5], [gapFrom, 5]), wall([gapTo, 5], [10, 5])];

  test("a wall on a grid line blocks crossing it, but not moving up to it", () => {
    const walls = [wall([5, 0], [5, 8])];
    assert.equal(canMove(cell(3, 3), cell(4, 3), 1, walls), true);
    assert.equal(canMove(cell(4, 3), cell(5, 3), 1, walls), false);
    assert.equal(canMove(cell(4, 2), cell(5, 3), 1, walls), false, "diagonally");
    assert.equal(canMove(cell(6, 3), cell(7, 3), 1, walls), true, "on the other side");
    assert.equal(canMove(cell(4, 3), cell(4, 3), 1, walls), true, "not moving");
  });

  test("the whole token must fit through a gap", () => {
    const walls = lineWithGap(4, 5); // 1-cell gap between cols 4 and 5
    assert.equal(canMove(cell(4, 4), cell(4, 5), 1, walls), true);
    assert.equal(canMove(cell(4, 4), cell(4, 6), 1, walls), true, "a long move through the gap");
    assert.equal(canMove(cell(3, 4), cell(3, 5), 1, walls), false, "beside the gap");
    assert.equal(canMove(cell(3, 3), cell(3, 5), 2, walls), false, "a 2x2 token does not fit");
    assert.equal(canMove(cell(3, 3), cell(3, 5), 2, lineWithGap(3, 5)), true, "it does through a 2-cell gap");
    assert.equal(canMove(cell(1, 4), cell(4, 6), 1, walls), false, "a diagonal move that cuts through the wall");
  });

  test("leniency for walls that are not exactly on the grid", () => {
    assert.equal(canMove(cell(4, 4), cell(4, 5), 1, lineWithGap(4.05, 4.95)), true, "a 0.9-cell gap still lets a 1x1 token through");
    assert.equal(canMove(cell(4, 4), cell(4, 5), 1, lineWithGap(4.2, 5)), false, "0.2 cell too narrow");
    assert.equal(canMove(cell(4, 3), cell(4, 5), 1, lineWithGap(4.05, 4.95)), true);
    assert.equal(canMove(cell(4, 3), cell(4, 5), 1, lineWithGap(4.05, 4.95), 0), false, "without tolerance");
  });

  test("small tokens fit through small gaps", () => {
    const walls = lineWithGap(4, 4.5); // half-cell gap
    assert.equal(canMove(cell(4, 4.5), cell(4, 5), 0.5, walls), true);
    assert.equal(canMove(cell(4, 4), cell(4, 5), 1, walls), false);
  });

  test("open doors let tokens through; closed doors and see-through walls do not", () => {
    const withDoor = (open: boolean, kind: "door" | "seeThrough" = "door") => [...lineWithGap(4, 5), wall([4, 5], [5, 5], kind, open)];
    assert.equal(canMove(cell(4, 4), cell(4, 5), 1, withDoor(true)), true);
    assert.equal(canMove(cell(4, 4), cell(4, 5), 1, withDoor(false)), false);
    assert.equal(canMove(cell(4, 4), cell(4, 5), 1, withDoor(false, "seeThrough")), false);
  });

  test("a token a wall was drawn over can always move away", () => {
    const walls = [wall([4.5, 0], [4.5, 8])]; // through the token at (4, 3)
    assert.equal(canMove(cell(4, 3), cell(3, 3), 1, walls), true);
  });
});

describe("walls: nearest wall", () => {
  test("finds the nearest wall within the distance", () => {
    const a = wall([2, 2], [6, 2]);
    const b = wall([2, 3], [6, 3]);
    assert.equal(wallAt(cell(4, 2.2), [a, b], 0.25), a);
    assert.equal(wallAt(cell(4, 2.8), [a, b], 0.25), b);
    assert.equal(wallAt(cell(4, 2.5), [a, b], 0.25), null, "0.5 away from both");
    assert.equal(wallAt(cell(7, 2), [a, b], 0.25), null, "beyond the end");
    assert.equal(wallAt(cell(6.2, 2), [a, b], 0.25), a, "near the end point");
  });
});

describe("walls: movement rules", () => {
  // tok1 is at (2, 3); a wall on col 4 blocks it from going right past col 3.
  const table = tableWithWalls([wall([4, 0], [4, 8])]);
  const move = (col: number, via?: "drag" | "keyboard") => ({ type: "token.move" as const, tokenId: "tok1", col, row: 3, ...(via ? { via } : {}) });

  test("players are blocked with the mouse and the keyboard", () => {
    assert.equal(isMoveBlocked(table, player, move(3, "drag")), false);
    assert.equal(isMoveBlocked(table, player, move(5, "drag")), true);
    assert.equal(isMoveBlocked(table, player, move(5, "keyboard")), true);
  });

  test("the owner goes through walls with the mouse, not with the keyboard", () => {
    assert.equal(isMoveBlocked(table, owner, move(5, "drag")), false);
    assert.equal(isMoveBlocked(table, owner, move(5, "keyboard")), true);
    assert.equal(isMoveBlocked(table, owner, move(5)), true, "no `via` means keyboard");
  });

  test("the target is clamped first; walls of other maps are ignored", () => {
    assert.equal(isMoveBlocked(table, player, move(-50, "drag")), false, "clamped to col 0: away from the wall");
    const other = tableWithWalls([wall([4, 0], [4, 8], "wall", false, "elsewhere")]);
    assert.equal(isMoveBlocked(other, player, move(5, "drag")), false);
  });
});
