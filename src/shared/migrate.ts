/**
 * Brings a saved state up to date with the current model, filling in fields
 * added after it was written. Pure; used when the server loads state.json.
 *
 * When you add a field to the model, give it a default here so that existing
 * tables keep loading.
 */
import { defaultGrid } from "./grid.ts";
import { emptyState } from "./reducer.ts";
import type { TableState } from "./types.ts";

export function migrateState(raw: TableState): TableState {
  const state: TableState = { ...emptyState(), ...raw };
  state.maps = state.maps.map((map) => ({ ...map, grid: { ...defaultGrid(), ...map.grid } }));
  return state;
}
