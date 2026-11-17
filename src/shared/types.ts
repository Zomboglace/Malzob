/**
 * Core data model shared by the server and the client.
 *
 * Everything here is plain JSON-serialisable data: the whole table state is
 * persisted as-is to `data/state.json` and sent as-is over the WebSocket.
 */

/** The six D&D abilities, in sheet order. */
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];
export type AbilityScores = Record<Ability, number>;

export interface HitPoints {
  current: number;
  max: number;
  temp: number;
}

/** A D&D 5e stat sheet. Tokens and templates each own an independent copy. */
export interface StatSheet {
  name: string;
  ac: number;
  hp: HitPoints;
  /** Walking speed in feet. */
  speed: number;
  abilities: AbilityScores;
  proficiencyBonus: number;
  initiativeBonus: number;
  /** Values from the CONDITIONS list (see stats.ts). */
  conditions: string[];
  notes: string;
}

/** Metadata of an uploaded image, stored on the server by content hash. */
export interface ImageRef {
  /** sha256 of the file content, hex. */
  hash: string;
  ext: ImageExt;
  width: number;
  height: number;
}
export type ImageExt = "png" | "jpg" | "webp";

export interface GridSettings {
  /** Size of one square cell in map (image) pixels. May be fractional (sub-pixel). */
  cellSize: number;
  /** Horizontal / vertical offset of the grid origin, in map pixels. May be fractional. */
  offsetX: number;
  offsetY: number;
  /** Distance represented by one cell (5 ft in standard 5e). */
  feetPerCell: number;
  /**
   * Each cell is split into `subdivisions` x `subdivisions` sub-cells that
   * tokens snap to (1 = no split, 2 = 4 sub-cells per cell, ...).
   */
  subdivisions: number;
  cols: number;
  rows: number;
  /** CSS colour, `#rrggbb`. */
  color: string;
  /** 0..1 */
  opacity: number;
  visible: boolean;
}

export interface TableMap {
  id: string;
  name: string;
  background: ImageRef | null;
  /** Natural size of the map in pixels (the image size, or a default). */
  width: number;
  height: number;
  grid: GridSettings;
}

export interface Token {
  id: string;
  mapId: string;
  /** Template this token was created from, if any (informational only). */
  templateId: string | null;
  /**
   * Top-left cell occupied by the token, in cells. Fractional when the grid is
   * subdivided (e.g. 2.5 = half-way through the third column with 2 subdivisions).
   */
  col: number;
  row: number;
  /** Footprint in cells: 1 = 1x1, 2 = 2x2, ... */
  size: number;
  color: string;
  image: ImageRef | null;
  /** The token's own stat sheet; `stats.name` is the token's name. */
  stats: StatSheet;
}

export interface TokenTemplate {
  id: string;
  size: number;
  color: string;
  image: ImageRef | null;
  stats: StatSheet;
}

/** The authoritative, persisted state of the table. */
export interface TableState {
  /** Bumped on every accepted change. */
  rev: number;
  activeMapId: string | null;
  maps: TableMap[];
  tokens: Token[];
  templates: TokenTemplate[];
}

/** A connected client. Not persisted. */
export interface User {
  id: string;
  name: string;
}
