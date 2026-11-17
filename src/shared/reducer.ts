/**
 * The state reducer: applies one validated intent to the table state.
 *
 * Pure: no I/O, no clock, no randomness. Ids and image lookups are injected
 * through `ReducerContext`, so the reducer is fully testable and can run on
 * the server (authoritative) or, later, on a client (optimistic updates).
 */
import { clampToGrid, defaultGrid, gridDimensionsFor, tokenSize } from "./grid.ts";
import type { AppearancePatch, ClientMessage, ErrorCode } from "./protocol.ts";
import { NO_CONTROL, playerKey, sameName } from "./permissions.ts";
import { applyStatsPatch, cloneStats, defaultStats } from "./stats.ts";
import type { ImageRef, TableMap, TableState, Token, TokenTemplate } from "./types.ts";

/** Messages that change the state (session and ephemeral messages are handled by the server). */
export type StateIntent = Exclude<
  ClientMessage,
  { type: "hello" } | { type: "user.rename" } | { type: "ping" } | { type: "ruler" }
>;

export interface ReducerContext {
  newId(): string;
  /** Looks up an uploaded image by hash; undefined if the server does not have it. */
  getImage(hash: string): ImageRef | undefined;
}

export type ReducerResult = { ok: true; state: TableState } | { ok: false; code: ErrorCode; error: string };

export const DEFAULT_TOKEN_COLOR = "#c0392b";

/**
 * Applies `changes` to every token placed from a unique template (except
 * `skip`, already updated), keeping each one inside its map's grid.
 */
function updateLinkedTokens(s: TableState, template: TokenTemplate, changes: AppearancePatch, ctx: ReducerContext, skip?: Token): void {
  if (Object.keys(changes).length === 0) return;
  for (const other of s.tokens) {
    if (other === skip || other.templateId !== template.id) continue;
    applyAppearance(other, changes, ctx);
    const map = s.maps.find((x) => x.id === other.mapId);
    if (map) Object.assign(other, clampToGrid(other, map.grid, tokenSize(other, map.grid)));
  }
}

/**
 * A new token, from a template (an independent copy of its stats, size,
 * colour, image and control) or blank. Its map and position are set by the
 * caller.
 *
 * This is the one place where placed tokens get their starting values: a
 * future "randomize ranges on placement" feature belongs here (with a random
 * source added to ReducerContext so the reducer stays testable).
 */
export function newToken(tpl: TokenTemplate | null, ctx: ReducerContext, blankName: string): Token {
  return {
    id: ctx.newId(),
    mapId: "",
    templateId: tpl?.id ?? null,
    col: 0,
    row: 0,
    size: tpl ? tpl.size : null,
    color: tpl?.color ?? DEFAULT_TOKEN_COLOR,
    image: tpl?.image ? { ...tpl.image } : null,
    stats: tpl ? cloneStats(tpl.stats) : defaultStats(blankName),
    control: structuredClone(tpl?.control ?? NO_CONTROL),
  };
}

/** Columns and rows that fit in the map's background image with its current cell size and offset. */
function dimensionsFromImage(map: TableMap): { cols: number; rows: number } {
  const g = map.grid;
  return gridDimensionsFor(map.width, map.height, g.cellWidth, g.cellHeight, g.offsetX, g.offsetY);
}

export function emptyState(): TableState {
  return { rev: 0, maps: [], tokens: [], templates: [], playerMaps: {}, defaultMapId: null };
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
    const c = clampToGrid(t, map.grid, tokenSize(t, map.grid));
    t.col = c.col;
    t.row = c.row;
  }
}

function applyAppearance(target: Token | TokenTemplate, changes: AppearancePatch, ctx: ReducerContext): void {
  if (changes.size !== undefined) target.size = changes.size;
  if (changes.color !== undefined) target.color = changes.color;
  if (changes.image !== undefined) target.image = image(ctx, changes.image);
  if (changes.stats) target.stats = applyStatsPatch(target.stats, changes.stats);
  if (changes.control) {
    const players = changes.control.players ?? target.control.players;
    target.control = {
      everyone: changes.control.everyone ?? target.control.everyone,
      // Trimmed, without duplicates (names are case-insensitive).
      players: players.map((p) => p.trim()).filter((p, i, all) => all.findIndex((q) => sameName(p, q)) === i),
    };
  }
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
        width: grid.cols * grid.cellWidth,
        height: grid.rows * grid.cellHeight,
        grid,
      };
      s.maps.push(map);
      return;
    }
    case "map.rename":
      find(s.maps, m.mapId, "map").name = m.name;
      return;
    case "map.delete": {
      find(s.maps, m.mapId, "map");
      s.maps = s.maps.filter((x) => x.id !== m.mapId);
      s.tokens = s.tokens.filter((t) => t.mapId !== m.mapId);
      // Players who were on this map go back to the default map; if it was the
      // default, the first map becomes the default again.
      for (const [key, pm] of Object.entries(s.playerMaps)) if (pm.mapId === m.mapId) delete s.playerMaps[key];
      if (s.defaultMapId === m.mapId) s.defaultMapId = null;
      return;
    }
    case "map.setDefault":
      s.defaultMapId = find(s.maps, m.mapId, "map").id;
      return;
    case "player.setMap": {
      const map = find(s.maps, m.mapId, "map");
      s.playerMaps[playerKey(m.player)] = { name: m.player.trim(), mapId: map.id };
      return;
    }
    case "map.setBackground": {
      const map = find(s.maps, m.mapId, "map");
      const bg = image(ctx, m.image);
      map.background = bg;
      if (bg) {
        map.width = bg.width;
        map.height = bg.height;
        Object.assign(map.grid, dimensionsFromImage(map));
      } else {
        map.width = map.grid.cols * map.grid.cellWidth;
        map.height = map.grid.rows * map.grid.cellHeight;
      }
      clampTokens(s, map);
      return;
    }
    case "map.setGrid": {
      const map = find(s.maps, m.mapId, "map");
      const g = m.grid;
      Object.assign(map.grid, g);
      const geometryChanged =
        g.cellWidth !== undefined || g.cellHeight !== undefined || g.offsetX !== undefined || g.offsetY !== undefined;
      if (geometryChanged && g.cols === undefined && g.rows === undefined && map.background) {
        // Keep the grid covering the image when the cell size or offset changes.
        Object.assign(map.grid, dimensionsFromImage(map));
      }
      if (!map.background) {
        map.width = map.grid.offsetX + map.grid.cols * map.grid.cellWidth;
        map.height = map.grid.offsetY + map.grid.rows * map.grid.cellHeight;
      }
      clampTokens(s, map);
      return;
    }
    case "token.create": {
      const map = find(s.maps, m.mapId, "map");
      const tpl = m.templateId ? find(s.templates, m.templateId, "template") : null;
      const token = newToken(tpl, ctx, `Token ${s.tokens.length + 1}`);
      Object.assign(token, { mapId: map.id }, clampToGrid({ col: m.col, row: m.row }, map.grid, tokenSize(token, map.grid)));
      s.tokens.push(token);
      return;
    }
    case "token.move": {
      const token = find(s.tokens, m.tokenId, "token");
      const map = find(s.maps, token.mapId, "map");
      Object.assign(token, clampToGrid({ col: m.col, row: m.row }, map.grid, tokenSize(token, map.grid)));
      return;
    }
    case "token.update": {
      const token = find(s.tokens, m.tokenId, "token");
      applyAppearance(token, m.changes, ctx);
      const map = find(s.maps, token.mapId, "map");
      Object.assign(token, clampToGrid(token, map.grid, tokenSize(token, map.grid)));
      // A unique template and all its tokens are linked: the edit applies to all of them.
      const template = token.templateId ? s.templates.find((t) => t.id === token.templateId) : undefined;
      if (template?.unique) {
        applyAppearance(template, m.changes, ctx);
        updateLinkedTokens(s, template, m.changes, ctx, token);
      }
      return;
    }
    case "token.duplicate": {
      const token = find(s.tokens, m.tokenId, "token");
      const map = find(s.maps, token.mapId, "map");
      const copy: Token = structuredClone(token);
      copy.id = ctx.newId();
      const size = tokenSize(token, map.grid);
      Object.assign(copy, clampToGrid({ col: token.col + size, row: token.row }, map.grid, size));
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
        size: src ? src.size : null,
        color: src?.color ?? DEFAULT_TOKEN_COLOR,
        image: src?.image ? { ...src.image } : null,
        stats,
        control: structuredClone(src?.control ?? NO_CONTROL),
        unique: false,
      });
      return;
    }
    case "template.update": {
      const template = find(s.templates, m.templateId, "template");
      const { unique, ...changes } = m.changes;
      applyAppearance(template, changes, ctx);
      if (unique !== undefined) template.unique = unique;
      // Editing a unique template edits all its tokens too (other templates never change placed tokens).
      if (template.unique) updateLinkedTokens(s, template, changes, ctx);
      return;
    }
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
