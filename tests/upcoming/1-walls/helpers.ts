/** Fixtures shared by the walls tests (and by parts 2 and 3). */
import type { Cell } from "../../../src/shared/grid.ts";
import type { TableState, Wall, WallKind } from "../../../src/shared/types.ts";
import { sampleTable } from "../../helpers/ui.ts";

let seq = 0;

/** A wall on map1 (the sample table's map: 10 x 8 cells of 50 px). */
export function wall(from: [number, number], to: [number, number], kind: WallKind = "wall", open = false, mapId = "map1"): Wall {
  return { id: `w${++seq}`, mapId, from: { col: from[0], row: from[1] }, to: { col: to[0], row: to[1] }, kind, open };
}

/** The sample table (map1 10 x 8 cells of 50 px, token tok1 at (2, 3)) with walls. */
export function tableWithWalls(walls: Wall[]): TableState {
  return { ...sampleTable(), walls };
}

export const cell = (col: number, row: number): Cell => ({ col, row });
