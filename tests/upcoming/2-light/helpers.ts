/** Fixtures for the light tests (and part 3). */
import type { LightLevel, TableState, TokenLight, Wall } from "../../../src/shared/types.ts";
import { sampleTable } from "../../helpers/ui.ts";

/**
 * The sample table (map1: 10 x 8 cells of 50 px, 5 ft per cell, no split;
 * token tok1 at (2, 3)), with a base light level, painted areas, walls, and
 * tok1's light.
 */
export function litTable(options: { base?: LightLevel; areas?: Record<string, LightLevel>; walls?: Wall[]; tokenLight?: TokenLight | null } = {}): TableState {
  const table: TableState = { ...sampleTable(), walls: options.walls ?? [] };
  table.maps[0]!.light = { base: options.base ?? "dark", areas: options.areas ?? {} };
  table.tokens[0]!.light = options.tokenLight ?? null;
  return table;
}

/** Moves tok1 (keeps it on map1). */
export function placeToken(table: TableState, col: number, row: number): TableState {
  table.tokens[0]!.col = col;
  table.tokens[0]!.row = row;
  return table;
}
