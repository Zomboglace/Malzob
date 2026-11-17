/**
 * Who may do what, and what each user is allowed to see. Pure; used by the
 * server to enforce permissions and filter the state it sends, and by the
 * client to show only the controls a user can use.
 */
import type { StateIntent } from "./reducer.ts";
import { defaultStats } from "./stats.ts";
import type { Role, TableState, Token, TokenControl, User } from "./types.ts";

export const NO_CONTROL: TokenControl = { players: [], everyone: false };

/** Display names are compared trimmed and case-insensitively. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

type Who = Pick<User, "name" | "role">;

/** Can this user move and edit this token? */
export function canControl(user: Who | null, token: Pick<Token, "control">): boolean {
  if (!user) return false;
  return user.role === "owner" || token.control.everyone || token.control.players.some((p) => sameName(p, user.name));
}

export function isOwner(user: { role: Role } | null): boolean {
  return user?.role === "owner";
}

/**
 * Returns null if the user may apply this intent, otherwise the reason.
 * References to missing entities are left to the reducer (not_found).
 */
export function checkPermission(user: Who, intent: StateIntent, state: TableState): string | null {
  if (user.role === "owner") return null;
  switch (intent.type) {
    case "token.move":
    case "token.update": {
      const token = state.tokens.find((t) => t.id === intent.tokenId);
      if (!token) return null;
      if (token.mapId !== state.activeMapId || !canControl(user, token)) return "you do not control this token";
      if (intent.type === "token.update" && intent.changes.control) return "only the owner can change who controls a token";
      return null;
    }
    default:
      return "only the owner can do that";
  }
}

/** A token as seen by a player who does not control it: name only. */
export function redactToken(token: Token): Token {
  const stats = { ...defaultStats(token.stats.name), ac: 0, speed: 0, proficiencyBonus: 0 };
  stats.hp = { current: 0, max: 0, temp: 0 };
  return { ...token, stats, control: NO_CONTROL, redacted: true };
}

/**
 * The part of the state a user may see. The owner sees everything; a player
 * sees only the active map and its tokens, with the stats of the tokens they
 * do not control hidden, and no templates.
 */
export function viewFor(state: TableState, user: Who): TableState {
  if (user.role === "owner") return state;
  const map = state.maps.find((m) => m.id === state.activeMapId);
  return {
    rev: state.rev,
    activeMapId: map ? map.id : null,
    maps: map ? [map] : [],
    tokens: state.tokens.filter((t) => t.mapId === map?.id).map((t) => (canControl(user, t) ? t : redactToken(t))),
    templates: [],
  };
}
