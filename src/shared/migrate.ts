/**
 * Brings a saved state up to date with the current model, filling in fields
 * added after it was written. Pure; used when the server loads state.json.
 *
 * When you add a field to the model, give it a default here so that existing
 * tables keep loading.
 */
import { defaultGrid } from "./grid.ts";
import { NO_CONTROL } from "./permissions.ts";
import { emptyState } from "./reducer.ts";
import type { GridSettings, TableState } from "./types.ts";

/** A grid as saved by version 1 or 2 (square cells). */
type LegacyGrid = Partial<GridSettings> & { cellSize?: number };

function migrateGrid(saved: LegacyGrid): GridSettings {
  const { cellSize, ...rest } = saved;
  const grid = { ...defaultGrid(), ...rest };
  if (cellSize !== undefined) {
    grid.cellWidth = saved.cellWidth ?? cellSize;
    grid.cellHeight = saved.cellHeight ?? cellSize;
  }
  return grid;
}

export function migrateState(raw: TableState): TableState {
  const state: TableState = { ...emptyState(), ...raw };
  state.maps = state.maps.map((map) => ({ ...map, grid: migrateGrid(map.grid as LegacyGrid) }));
  // Version 5: tokens and templates gained `control` (who may use them).
  state.tokens = state.tokens.map((t) => ({ ...t, control: t.control ?? structuredClone(NO_CONTROL) }));
  state.templates = state.templates.map((t) => ({ ...t, control: t.control ?? structuredClone(NO_CONTROL) }));
  // Version 6: per-player maps replace the single active map; templates can be unique.
  delete (state as TableState & { activeMapId?: unknown }).activeMapId;
  state.playerMaps = state.playerMaps ?? {};
  state.templates = state.templates.map((t) => ({ ...t, unique: t.unique ?? false }));
  // Version 7: a chosen default map (null = the first map).
  state.defaultMapId = state.defaultMapId ?? null;
  return state;
}
