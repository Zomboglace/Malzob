/** Fixtures for the vision tests. */
import type { LightLevel, TableState, Token, TokenLight, TokenVision, Wall } from "../../../src/shared/types.ts";
import { litTable } from "../2-light/helpers.ts";

/**
 * The sample table (map1: 10 x 8 cells of 50 px, 5 ft per cell, no split),
 * dark by default, where tok1 ("Goblin 1", from template tpl1) is the hero:
 * at `at`, controlled by John Doe, with the given light and vision.
 */
export function visionTable(
  options: {
    at?: [number, number];
    base?: LightLevel;
    areas?: Record<string, LightLevel>;
    walls?: Wall[];
    light?: TokenLight | null;
    vision?: Partial<TokenVision>;
  } = {},
): TableState {
  const table = litTable({ base: options.base ?? "dark", areas: options.areas ?? {}, walls: options.walls ?? [], tokenLight: options.light ?? null });
  const hero = table.tokens[0]!;
  [hero.col, hero.row] = options.at ?? [1, 3];
  hero.control = { players: ["John Doe"], everyone: false };
  hero.vision = { darkvision: 0, range: null, ...options.vision };
  table.fog = {};
  return table;
}

/** Adds an owner token (no control, no template) to map1. */
export function addToken(table: TableState, id: string, col: number, row: number, extra: Partial<Token> = {}): Token {
  const token: Token = {
    ...structuredClone(table.tokens[0]!),
    id,
    templateId: null,
    col,
    row,
    light: null,
    control: { players: [], everyone: false },
    vision: { darkvision: 0, range: null },
    ...extra,
  };
  token.stats.name = id;
  table.tokens.push(token);
  return token;
}

export const keys = (record: Record<string, unknown>) => new Set(Object.keys(record));
