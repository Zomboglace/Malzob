/**
 * Client-side state: the last table state received from the server plus
 * purely local UI state (selection, pan/zoom, drag in progress...).
 * A tiny observable; the UI re-renders on every change.
 */
import type { MarkedCell, Point } from "../shared/grid.ts";
import { defaultMapId } from "../shared/permissions.ts";
import type { RulerLine } from "../shared/protocol.ts";
import type { TableMap, TableState, User } from "../shared/types.ts";
import type { View } from "./view.ts";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

export type Selection = { kind: "token"; id: string } | { kind: "template"; id: string };

/** What a click on the map will place: a template id, or a blank token. */
export type Placing = { templateId: string } | { blank: true };

/**
 * Active map tool:
 *  - select:    click tokens, drag them, drag empty space to pan
 *  - ruler:     drag anywhere to measure
 *  - ping:      click to show everyone a spot
 *  - calibrate: mark two cells far apart (two opposite corners each) to set the grid
 */
export type Tool = "select" | "ruler" | "ping" | "calibrate";

/** A ping being displayed (removed after its animation). */
export interface ActivePing {
  id: number;
  mapId: string;
  x: number;
  y: number;
  color: string;
  name: string;
}

/** Grid setup in progress: cells already marked, first corner of the current one, pointer position. */
export interface Calibration {
  mapId: string;
  cells: MarkedCell[];
  first: Point | null;
  hover: Point | null;
}

/** Another user's measurement, as shown on this client. */
export interface RemoteRuler extends RulerLine {
  name: string;
  color: string;
}

export interface ClientState {
  connection: ConnectionStatus;
  /** Display name chosen on arrival; null until the join form is submitted. */
  name: string | null;
  me: User | null;
  table: TableState | null;
  users: User[];
  selection: Selection | null;
  placing: Placing | null;
  /** Pan & zoom per map id. */
  views: Record<string, View>;
  /** Token being dragged and the cell it is currently over. */
  drag: { tokenId: string; col: number; row: number } | null;
  tool: Tool;
  /** Your current measurement, in map pixels (also shown to the others). */
  ruler: RulerLine | null;
  /** The other users' measurements, by user id. */
  remoteRulers: Record<string, RemoteRuler>;
  calibration: Calibration | null;
  pings: ActivePing[];
  sidebarCollapsed: boolean;
  /** Last error to show to the user. */
  notice: string | null;
  /** Authorises image uploads; from `welcome`. */
  uploadToken: string | null;
  /** The map the owner is looking at (local; players see the map they were sent to). */
  viewMapId: string | null;
}

/**
 * The map shown on this client: for the owner, the map they chose to look at
 * (or the default map); for a player, the only map the server sends them.
 */
export function currentMap(state: ClientState): TableMap | null {
  const table = state.table;
  if (!table) return null;
  const startId = defaultMapId(table);
  return table.maps.find((m) => m.id === state.viewMapId) ?? table.maps.find((m) => m.id === startId) ?? null;
}

export function initialClientState(): ClientState {
  return {
    connection: "idle",
    name: null,
    me: null,
    table: null,
    users: [],
    selection: null,
    placing: null,
    views: {},
    drag: null,
    tool: "select",
    ruler: null,
    remoteRulers: {},
    calibration: null,
    pings: [],
    sidebarCollapsed: false,
    notice: null,
    uploadToken: null,
    viewMapId: null,
  };
}

type Listener = (state: ClientState) => void;

export class Store {
  private state: ClientState;
  private readonly listeners = new Set<Listener>();

  constructor(initial: ClientState = initialClientState()) {
    this.state = initial;
  }

  get(): ClientState {
    return this.state;
  }

  update(change: Partial<ClientState> | ((s: ClientState) => Partial<ClientState>)): void {
    const partial = typeof change === "function" ? change(this.state) : change;
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
