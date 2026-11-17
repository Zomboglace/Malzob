/**
 * The state reducer: applies one validated intent to the table state.
 *
 * Pure: no I/O, no clock, no randomness. Ids and image lookups are injected
 * through `ReducerContext`, so the reducer is fully testable and can run on
 * the server (authoritative) or, later, on a client (optimistic updates).
 */
import { clampToGrid, defaultGrid, gridDimensionsFor } from "./grid.ts";
import type { AppearancePatch, ClientMessage, ErrorCode } from "./protocol.ts";
import { applyStatsPatch, cloneStats, defaultStats } from "./stats.ts";
import type { ImageRef, TableMap, TableState, Token, TokenTemplate } from "./types.ts";

/** Messages handled by the reducer (session messages are handled by the server). */
export type StateIntent = Exclude<ClientMessage, { type: "hello" } | { type: "user.rename" }>;

export interface ReducerContext {
  newId(): string;
  /** Looks up an uploaded image by hash; undefined if the server does not have it. */
  getImage(hash: string): ImageRef | undefined;
}

export type ReducerResult = { ok: true; state: TableState } | { ok: false; code: ErrorCode; error: string };

export const DEFAULT_TOKEN_COLOR = "#c0392b";

export function emptyState(): TableState {
  return { rev: 0, activeMapId: null, maps: [], tokens: [], templates: [] };
}

class Rejected extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  const item = list.find((x) => x.id === id);
  if (!item) throw new Rejected("not_found", `${what} ${id} not found`);
  return item;
}

function image(ctx: ReducerContext, hash: string | null): ImageRef | null {
  if (hash === null) return null;
  const ref = ctx.getImage(hash);
  if (!ref) throw new Rejected("not_found", `image ${hash} not found`);
  return ref;
}

/** Keeps every token of a map inside its grid (after a grid or size change). */
function clampTokens(state: TableState, map: TableMap): void {
  for (const t of state.tokens) {
    if (t.mapId !== map.id) continue;
    const c = clampToGrid(t, map.grid, t.size);
    t.col = c.col;
    t.row = c.row;
  }
}

function applyAppearance(target: Token | TokenTemplate, changes: AppearancePatch, ctx: ReducerContext): void {
  if (changes.size !== undefined) target.size = changes.size;
  if (changes.color !== undefined) target.color = changes.color;
  if (changes.image !== undefined) target.image = image(ctx, changes.image);
  if (changes.stats) target.stats = applyStatsPatch(target.stats, changes.stats);
}

/** Applies an intent. Never mutates `state`; returns a new state or an error. */
export function applyIntent(state: TableState, intent: StateIntent, ctx: ReducerContext): ReducerResult {
  const s = structuredClone(state);
  try {
    reduce(s, intent, ctx);
  } catch (err) {
    if (err instanceof Rejected) return { ok: false, code: err.code, error: err.message };
    throw err;
  }
  s.rev = state.rev + 1;
  return { ok: true, state: s };
}

function reduce(s: TableState, m: StateIntent, ctx: ReducerContext): void {
  switch (m.type) {
    case "map.create": {
      const grid = defaultGrid();
      const map: TableMap = {
        id: ctx.newId(),
        name: m.name,
        background: null,
        width: grid.cols * grid.cellSize,
        height: grid.rows * grid.cellSize,
        grid,
      };
      s.maps.push(map);
      if (s.activeMapId === null) s.activeMapId = map.id;
      return;
    }
    case "map.rename":
      find(s.maps, m.mapId, "map").name = m.name;
      return;
    case "map.delete": {
      find(s.maps, m.mapId, "map");
      s.maps = s.maps.filter((x) => x.id !== m.mapId);
      s.tokens = s.tokens.filter((t) => t.mapId !== m.mapId);
      if (s.activeMapId === m.mapId) s.activeMapId = s.maps[0]?.id ?? null;
      return;
    }
    case "map.activate":
      s.activeMapId = find(s.maps, m.mapId, "map").id;
      return;
    case "map.setBackground": {
      const map = find(s.maps, m.mapId, "map");
      const bg = image(ctx, m.image);
      map.background = bg;
      if (bg) {
        map.width = bg.width;
        map.height = bg.height;
        Object.assign(map.grid, gridDimensionsFor(bg.width, bg.height, map.grid.cellSize, map.grid.offsetX, map.grid.offsetY));
      } else {
        map.width = map.grid.cols * map.grid.cellSize;
        map.height = map.grid.rows * map.grid.cellSize;
      }
      clampTokens(s, map);
      return;
    }
    case "map.setGrid": {
      const map = find(s.maps, m.mapId, "map");
      const g = m.grid;
      Object.assign(map.grid, g);
      const geometryChanged = g.cellSize !== undefined || g.offsetX !== undefined || g.offsetY !== undefined;
      if (geometryChanged && g.cols === undefined && g.rows === undefined && map.background) {
        // Keep the grid covering the image when the cell size or offset changes.
        Object.assign(map.grid, gridDimensionsFor(map.width, map.height, map.grid.cellSize, map.grid.offsetX, map.grid.offsetY));
      }
      if (!map.background) {
        map.width = map.grid.offsetX + map.grid.cols * map.grid.cellSize;
        map.height = map.grid.offsetY + map.grid.rows * map.grid.cellSize;
      }
      clampTokens(s, map);
      return;
    }
    case "token.create": {
      const map = find(s.maps, m.mapId, "map");
      const tpl = m.templateId ? find(s.templates, m.templateId, "template") : null;
      const size = tpl?.size ?? 1;
      const cell = clampToGrid({ col: m.col, row: m.row }, map.grid, size);
      s.tokens.push({
        id: ctx.newId(),
        mapId: map.id,
        templateId: tpl?.id ?? null,
        ...cell,
        size,
        color: tpl?.color ?? DEFAULT_TOKEN_COLOR,
        image: tpl?.image ? { ...tpl.image } : null,
        stats: tpl ? cloneStats(tpl.stats) : defaultStats(`Token ${s.tokens.length + 1}`),
      });
      return;
    }
    case "token.move": {
      const token = find(s.tokens, m.tokenId, "token");
      const map = find(s.maps, token.mapId, "map");
      Object.assign(token, clampToGrid({ col: m.col, row: m.row }, map.grid, token.size));
      return;
    }
    case "token.update": {
      const token = find(s.tokens, m.tokenId, "token");
      applyAppearance(token, m.changes, ctx);
      const map = find(s.maps, token.mapId, "map");
      Object.assign(token, clampToGrid(token, map.grid, token.size));
      return;
    }
    case "token.duplicate": {
      const token = find(s.tokens, m.tokenId, "token");
      const map = find(s.maps, token.mapId, "map");
      const copy: Token = structuredClone(token);
      copy.id = ctx.newId();
      Object.assign(copy, clampToGrid({ col: token.col + token.size, row: token.row }, map.grid, token.size));
      s.tokens.push(copy);
      return;
    }
    case "token.delete":
      find(s.tokens, m.tokenId, "token");
      s.tokens = s.tokens.filter((t) => t.id !== m.tokenId);
      return;
    case "template.create": {
      const src = m.fromTokenId ? find(s.tokens, m.fromTokenId, "token") : null;
      const stats = src ? cloneStats(src.stats) : defaultStats(m.name);
      stats.name = m.name;
      s.templates.push({
        id: ctx.newId(),
        size: src?.size ?? 1,
        color: src?.color ?? DEFAULT_TOKEN_COLOR,
        image: src?.image ? { ...src.image } : null,
        stats,
      });
      return;
    }
    case "template.update":
      applyAppearance(find(s.templates, m.templateId, "template"), m.changes, ctx);
      return;
    case "template.delete":
      find(s.templates, m.templateId, "template");
      s.templates = s.templates.filter((t) => t.id !== m.templateId);
      for (const t of s.tokens) if (t.templateId === m.templateId) t.templateId = null;
      return;
    default: {
      const never: never = m;
      throw new Rejected("invalid", `unhandled intent ${JSON.stringify(never)}`);
    }
  }
}
