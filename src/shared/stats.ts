import { ABILITIES, type StatSheet } from "./types.ts";

/** The standard D&D 5e conditions. */
export const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export function isCondition(value: string): value is Condition {
  return (CONDITIONS as readonly string[]).includes(value);
}

export const ABILITY_LABELS: Record<(typeof ABILITIES)[number], string> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

/** 5e ability modifier: floor((score - 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Formats a modifier with an explicit sign: +2, +0, -1. */
export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function defaultStats(name = "Unnamed"): StatSheet {
  return {
    name,
    ac: 10,
    hp: { current: 10, max: 10, temp: 0 },
    speed: 30,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    initiativeBonus: 0,
    conditions: [],
    notes: "",
  };
}

/** Deep, independent copy of a stat sheet. */
export function cloneStats(stats: StatSheet): StatSheet {
  return structuredClone(stats);
}

/** A partial update of a stat sheet; nested `hp` and `abilities` are partial too. */
export interface StatsPatch {
  name?: string;
  ac?: number;
  hp?: Partial<StatSheet["hp"]>;
  speed?: number;
  abilities?: Partial<StatSheet["abilities"]>;
  proficiencyBonus?: number;
  initiativeBonus?: number;
  conditions?: string[];
  notes?: string;
}

/** Returns a new sheet with the patch applied. Does not mutate its inputs. */
export function applyStatsPatch(stats: StatSheet, patch: StatsPatch): StatSheet {
  const next = cloneStats(stats);
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.ac !== undefined) next.ac = patch.ac;
  if (patch.speed !== undefined) next.speed = patch.speed;
  if (patch.proficiencyBonus !== undefined) next.proficiencyBonus = patch.proficiencyBonus;
  if (patch.initiativeBonus !== undefined) next.initiativeBonus = patch.initiativeBonus;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.conditions !== undefined) next.conditions = [...new Set(patch.conditions)];
  if (patch.hp) Object.assign(next.hp, patch.hp);
  if (patch.abilities) Object.assign(next.abilities, patch.abilities);
  return next;
}

/** Fraction of HP left, 0..1, used for the HP bar. */
export function hpRatio(hp: StatSheet["hp"]): number {
  if (hp.max <= 0) return 0;
  return Math.min(1, Math.max(0, hp.current / hp.max));
}
