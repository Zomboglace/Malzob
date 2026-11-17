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
  return playerKey(a) === playerKey(b);
}

/** Key of a player in `TableState.playerMaps`. */
export function playerKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The map a player sees: the one the owner sent them to, or the first map.
 * null when there is no map at all.
 */
export function playerMapId(state: TableState, name: string): string | null {
  const assigned = state.playerMaps[playerKey(name)];
  if (assigned && state.maps.some((m) => m.id === assigned.mapId)) return assigned.mapId;
  return state.maps[0]?.id ?? null;
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
      if (token.mapId !== playerMapId(state, user.name) || !canControl(user, token)) return "you do not control this token";
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
 * sees only their map and its tokens, with the stats of the tokens they do
 * not control hidden, no templates, and no other player's map assignment.
 */
export function viewFor(state: TableState, user: Who): TableState {
  if (user.role === "owner") return state;
  const mapId = playerMapId(state, user.name);
  const map = state.maps.find((m) => m.id === mapId);
  return {
    rev: state.rev,
    maps: map ? [map] : [],
    tokens: state.tokens.filter((t) => t.mapId === map?.id).map((t) => (canControl(user, t) ? t : redactToken(t))),
    templates: [],
    playerMaps: {},
  };
}
