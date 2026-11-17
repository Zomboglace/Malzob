/**
 * Structural validation of client messages. The server never trusts the
 * client: every incoming message goes through `parseClientMessage` before it
 * reaches the state reducer. Reference checks (does this map exist?) are done
 * later, by the reducer.
 */
import type { AppearancePatch, ClientMessage, RulerLine } from "./protocol.ts";
import { isCondition, type StatsPatch } from "./stats.ts";
import { ABILITIES, type GridSettings } from "./types.ts";

export const LIMITS = {
  nameLength: 80,
  notesLength: 20_000,
  idLength: 64,
  tokenSize: { min: 0.1, max: 10 },
  cellSize: { min: 4, max: 1000 },
  /** Ping coordinates, in map pixels. */
  point: { min: -1_000_000, max: 1_000_000 },
  offset: { min: -10_000, max: 10_000 },
  feetPerCell: { min: 0.1, max: 1000 },
  subdivisions: { min: 1, max: 10 },
  /** Decimals kept for sub-pixel grid values and fractional positions. */
  decimals: 4,
  gridCells: { min: 1, max: 500 },
  score: { min: 0, max: 50 },
  stat: { min: -1000, max: 100_000 },
  bonus: { min: -50, max: 50 },
} as const;

export type ValidationResult = { ok: true; message: ClientMessage } | { ok: false; error: string };

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new Invalid(message);
}

function obj(value: unknown, path: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${path} must be an object`);
  return value as Obj;
}

/** Rejects unknown keys so typos and injected fields are caught early. */
function onlyKeys(o: Obj, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) fail(`${path}.${key} is not allowed`);
  }
}

function str(o: Obj, key: string, max: number, path: string): string {
  const v = o[key];
  if (typeof v !== "string") fail(`${path}.${key} must be a string`);
  if (v.length > max) fail(`${path}.${key} is too long (max ${max})`);
  return v;
}

function name(o: Obj, key: string, path: string): string {
  const v = str(o, key, LIMITS.nameLength, path).trim();
  if (v.length === 0) fail(`${path}.${key} must not be empty`);
  return v;
}

function id(o: Obj, key: string, path: string): string {
  const v = str(o, key, LIMITS.idLength, path);
  if (!/^[A-Za-z0-9_-]+$/.test(v)) fail(`${path}.${key} is not a valid id`);
  return v;
}

function int(o: Obj, key: string, range: { min: number; max: number }, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v)) fail(`${path}.${key} must be an integer`);
  if (v < range.min || v > range.max) fail(`${path}.${key} must be between ${range.min} and ${range.max}`);
  return v;
}

/** A finite number in range, rounded to `decimals` places. */
function num(o: Obj, key: string, range: { min: number; max: number }, path: string, decimals: number = LIMITS.decimals): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${path}.${key} must be a number`);
  if (v < range.min || v > range.max) fail(`${path}.${key} must be between ${range.min} and ${range.max}`);
  return Number(v.toFixed(decimals));
}

function color(o: Obj, key: string, path: string): string {
  const v = str(o, key, 7, path);
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) fail(`${path}.${key} must be a #rrggbb colour`);
  return v.toLowerCase();
}

function imageHash(o: Obj, key: string, path: string): string | null {
  const v = o[key];
  if (v === null) return null;
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) fail(`${path}.${key} must be an image hash or null`);
  return v;
}

/** Copies `key` from `o` to `out` through `read` if it is present. */
function opt<T>(o: Obj, out: Obj, key: string, read: () => T): void {
  if (o[key] !== undefined) out[key] = read();
}

function statsPatch(value: unknown, path: string): StatsPatch {
  const o = obj(value, path);
  onlyKeys(o, ["name", "ac", "hp", "speed", "abilities", "proficiencyBonus", "initiativeBonus", "conditions", "notes"], path);
  const out: Obj = {};
  opt(o, out, "name", () => name(o, "name", path));
  opt(o, out, "ac", () => int(o, "ac", LIMITS.stat, path));
  opt(o, out, "speed", () => int(o, "speed", LIMITS.stat, path));
  opt(o, out, "proficiencyBonus", () => int(o, "proficiencyBonus", LIMITS.bonus, path));
  opt(o, out, "initiativeBonus", () => int(o, "initiativeBonus", LIMITS.bonus, path));
  opt(o, out, "notes", () => str(o, "notes", LIMITS.notesLength, path));
  opt(o, out, "hp", () => {
    const hp = obj(o.hp, `${path}.hp`);
    onlyKeys(hp, ["current", "max", "temp"], `${path}.hp`);
    const r: Obj = {};
    for (const k of ["current", "max", "temp"]) opt(hp, r, k, () => int(hp, k, LIMITS.stat, `${path}.hp`));
    return r;
  });
  opt(o, out, "abilities", () => {
    const ab = obj(o.abilities, `${path}.abilities`);
    onlyKeys(ab, ABILITIES, `${path}.abilities`);
    const r: Obj = {};
    for (const k of ABILITIES) opt(ab, r, k, () => int(ab, k, LIMITS.score, `${path}.abilities`));
    return r;
  });
  opt(o, out, "conditions", () => {
    const list = o.conditions;
    if (!Array.isArray(list)) fail(`${path}.conditions must be an array`);
    for (const c of list) {
      if (typeof c !== "string" || !isCondition(c)) fail(`${path}.conditions contains an unknown condition`);
    }
    return list as string[];
  });
  return out as StatsPatch;
}

function appearancePatch(value: unknown, path: string): AppearancePatch {
  const o = obj(value, path);
  onlyKeys(o, ["size", "color", "image", "stats"], path);
  const out: Obj = {};
  opt(o, out, "size", () => (o.size === null ? null : num(o, "size", LIMITS.tokenSize, path)));
  opt(o, out, "color", () => color(o, "color", path));
  opt(o, out, "image", () => imageHash(o, "image", path));
  opt(o, out, "stats", () => statsPatch(o.stats, `${path}.stats`));
  return out as AppearancePatch;
}

function gridPatch(value: unknown, path: string): Partial<GridSettings> {
  const o = obj(value, path);
  const keys = [
    "cellWidth", "cellHeight", "offsetX", "offsetY", "feetPerCell", "subdivisions",
    "defaultTokenSize", "cols", "rows", "color", "opacity", "visible",
  ];
  onlyKeys(o, keys, path);
  const out: Obj = {};
  opt(o, out, "cellWidth", () => num(o, "cellWidth", LIMITS.cellSize, path));
  opt(o, out, "cellHeight", () => num(o, "cellHeight", LIMITS.cellSize, path));
  opt(o, out, "defaultTokenSize", () => num(o, "defaultTokenSize", LIMITS.tokenSize, path));
  opt(o, out, "offsetX", () => num(o, "offsetX", LIMITS.offset, path));
  opt(o, out, "offsetY", () => num(o, "offsetY", LIMITS.offset, path));
  opt(o, out, "feetPerCell", () => num(o, "feetPerCell", LIMITS.feetPerCell, path));
  opt(o, out, "subdivisions", () => int(o, "subdivisions", LIMITS.subdivisions, path));
  opt(o, out, "cols", () => int(o, "cols", LIMITS.gridCells, path));
  opt(o, out, "rows", () => int(o, "rows", LIMITS.gridCells, path));
  opt(o, out, "color", () => color(o, "color", path));
  opt(o, out, "opacity", () => {
    const v = o.opacity;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) fail(`${path}.opacity must be between 0 and 1`);
    return v;
  });
  opt(o, out, "visible", () => {
    if (typeof o.visible !== "boolean") fail(`${path}.visible must be a boolean`);
    return o.visible;
  });
  return out as Partial<GridSettings>;
}

/** Token positions are in cells (fractional on subdivided grids); the reducer snaps and clamps them. */
const CELL = { min: -100_000, max: 100_000 };

function point(value: unknown, path: string): { x: number; y: number } {
  const o = obj(value, path);
  onlyKeys(o, ["x", "y"], path);
  return { x: num(o, "x", LIMITS.point, path, 2), y: num(o, "y", LIMITS.point, path, 2) };
}

function rulerLine(value: unknown, path: string): RulerLine | null {
  if (value === null) return null;
  const o = obj(value, path);
  onlyKeys(o, ["mapId", "from", "to"], path);
  return { mapId: id(o, "mapId", path), from: point(o.from, `${path}.from`), to: point(o.to, `${path}.to`) };
}

/** Validates one decoded message. Returns a clean, typed copy on success. */
export function validateClientMessage(value: unknown): ValidationResult {
  try {
    return { ok: true, message: validate(value) };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}

function validate(value: unknown): ClientMessage {
  const m = obj(value, "message");
  const type = m.type;
  const p = typeof type === "string" ? type : "message";
  const keys = (...k: string[]) => onlyKeys(m, ["type", ...k], p);

  switch (type) {
    case "hello":
    case "user.rename":
      keys("name");
      return { type, name: name(m, "name", p) };
    case "map.create":
      keys("name");
      return { type, name: name(m, "name", p) };
    case "map.rename":
      keys("mapId", "name");
      return { type, mapId: id(m, "mapId", p), name: name(m, "name", p) };
    case "map.delete":
    case "map.activate":
      keys("mapId");
      return { type, mapId: id(m, "mapId", p) };
    case "map.setBackground":
      keys("mapId", "image");
      return { type, mapId: id(m, "mapId", p), image: imageHash(m, "image", p) };
    case "map.setGrid":
      keys("mapId", "grid");
      return { type, mapId: id(m, "mapId", p), grid: gridPatch(m.grid, `${p}.grid`) };
    case "token.create": {
      keys("mapId", "col", "row", "templateId");
      const msg: ClientMessage = { type, mapId: id(m, "mapId", p), col: num(m, "col", CELL, p, 6), row: num(m, "row", CELL, p, 6) };
      if (m.templateId !== undefined) msg.templateId = id(m, "templateId", p);
      return msg;
    }
    case "token.move":
      keys("tokenId", "col", "row");
      return { type, tokenId: id(m, "tokenId", p), col: num(m, "col", CELL, p, 6), row: num(m, "row", CELL, p, 6) };
    case "token.update":
      keys("tokenId", "changes");
      return { type, tokenId: id(m, "tokenId", p), changes: appearancePatch(m.changes, `${p}.changes`) };
    case "token.duplicate":
    case "token.delete":
      keys("tokenId");
      return { type, tokenId: id(m, "tokenId", p) };
    case "template.create": {
      keys("name", "fromTokenId");
      const msg: ClientMessage = { type, name: name(m, "name", p) };
      if (m.fromTokenId !== undefined) msg.fromTokenId = id(m, "fromTokenId", p);
      return msg;
    }
    case "template.update":
      keys("templateId", "changes");
      return { type, templateId: id(m, "templateId", p), changes: appearancePatch(m.changes, `${p}.changes`) };
    case "template.delete":
      keys("templateId");
      return { type, templateId: id(m, "templateId", p) };
    case "ping":
      keys("mapId", "x", "y");
      return { type, mapId: id(m, "mapId", p), x: num(m, "x", LIMITS.point, p, 2), y: num(m, "y", LIMITS.point, p, 2) };
    case "ruler":
      keys("ruler");
      if (!("ruler" in m)) fail(`${p}.ruler is required (null to remove)`);
      return { type, ruler: rulerLine(m.ruler, `${p}.ruler`) };
    default:
      return fail(`unknown message type ${JSON.stringify(type)}`);
  }
}
