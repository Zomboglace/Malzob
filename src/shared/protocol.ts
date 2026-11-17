/**
 * WebSocket protocol. Every message is a JSON object with a `type` field.
 * See docs/protocol.md for a description and an example of each message.
 *
 * Clients send *intents* (ClientMessage). The server validates them, applies
 * them to the authoritative state and broadcasts the result (ServerMessage).
 */
import type { StatsPatch } from "./stats.ts";
import type { Point } from "./grid.ts";
import type { GridSettings, TableState, TokenControl, User } from "./types.ts";

/** A measurement on a map, in map pixels. */
export interface RulerLine {
  mapId: string;
  from: Point;
  to: Point;
}

/**
 * 2: fractional grid values and token positions, feetPerCell, subdivisions.
 * 3: cellWidth/cellHeight (replace cellSize), defaultTokenSize, nullable and
 *    fractional token sizes, ping.
 * 4: shared ruler.
 * 5: owner login and roles, token control, per-user state, upload tokens.
 */
export const PROTOCOL_VERSION = 5;
export const WS_PATH = "/ws";

/** Appearance fields shared by token and template updates. */
export interface AppearancePatch {
  /** Size in cells (may be fractional), or null to follow the map's default token size. */
  size?: number | null;
  color?: string;
  /** Hash of an uploaded image, or null to remove the image. */
  image?: string | null;
  stats?: StatsPatch;
  /** Who besides the owner may use the token (owner only). */
  control?: Partial<TokenControl>;
}

export type ClientMessage =
  // Session
  /**
   * Join the table. Players send a name only. The owner sends the owner
   * username with the password, or with a session token from a previous
   * `welcome` (used to reconnect without the password).
   */
  | { type: "hello"; name: string; password?: string; session?: string }
  | { type: "user.rename"; name: string }
  // Maps
  | { type: "map.create"; name: string }
  | { type: "map.rename"; mapId: string; name: string }
  | { type: "map.delete"; mapId: string }
  | { type: "map.activate"; mapId: string }
  | { type: "map.setBackground"; mapId: string; image: string | null }
  | { type: "map.setGrid"; mapId: string; grid: Partial<GridSettings> }
  // Tokens
  | {
      type: "token.create";
      mapId: string;
      col: number;
      row: number;
      /** Create from a template (copies its stats), or a blank token if omitted. */
      templateId?: string;
    }
  | { type: "token.move"; tokenId: string; col: number; row: number }
  | { type: "token.update"; tokenId: string; changes: AppearancePatch }
  | { type: "token.duplicate"; tokenId: string }
  | { type: "token.delete"; tokenId: string }
  // Templates
  | { type: "template.create"; name: string; fromTokenId?: string }
  | { type: "template.update"; templateId: string; changes: AppearancePatch }
  | { type: "template.delete"; templateId: string }
  // Ephemeral (not stored): point at a spot of a map, in map pixels.
  | { type: "ping"; mapId: string; x: number; y: number }
  // Ephemeral: show your current measurement to the others, or null to remove it.
  | { type: "ruler"; ruler: RulerLine | null };

export type ClientMessageType = ClientMessage["type"];

export type ErrorCode = "bad_json" | "invalid" | "not_found" | "not_ready" | "forbidden" | "auth_failed";

export type ServerMessage =
  /**
   * Sent once after `hello`: who you are, the state you may see, the users.
   * `uploadToken` authorises image uploads for this connection. `session`
   * (owner only) lets the client reconnect without the password.
   */
  | {
      type: "welcome";
      protocol: number;
      you: User;
      state: TableState;
      users: User[];
      uploadToken: string;
      session?: string;
    }
  /** Sent to everyone after any accepted change (each user gets the part they may see). */
  | { type: "state"; state: TableState }
  /** Sent to everyone when someone joins, leaves or renames. */
  | { type: "users"; users: User[] }
  /** Sent to everyone (sender included) when someone pings a spot of a map. */
  | { type: "ping"; mapId: string; x: number; y: number; user: User }
  /**
   * Sent to the other clients when someone measures (null = their ruler is
   * gone). Also sent to a client right after `welcome` for each ruler shown.
   */
  | { type: "ruler"; user: User; ruler: RulerLine | null }
  /** Sent only to the client whose message was rejected. */
  | { type: "error"; code: ErrorCode; message: string; ref?: string };
