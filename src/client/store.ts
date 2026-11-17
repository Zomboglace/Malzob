/**
 * Client-side state: the last table state received from the server plus
 * purely local UI state (selection, pan/zoom, drag in progress...).
 * A tiny observable; the UI re-renders on every change.
 */
import type { TableState, User } from "../shared/types.ts";
import type { View } from "./view.ts";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

export type Selection = { kind: "token"; id: string } | { kind: "template"; id: string };

/** What a click on the map will place: a template id, or a blank token. */
export type Placing = { templateId: string } | { blank: true };

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
  /** Last error to show to the user. */
  notice: string | null;
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
    notice: null,
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
