/**
 * The controller is the only object the UI talks to. It turns UI actions
 * into intents for the server or into local state changes, and folds server
 * messages into the client store. The UI never touches the socket directly,
 * which keeps components easy to test with a fake `send`.
 */
import type { Point } from "../shared/grid.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import type { ImageRef, TableState } from "../shared/types.ts";
import type { Placing, Selection, Store, Tool } from "./store.ts";
import type { Uploader } from "./upload.ts";
import type { View } from "./view.ts";

export interface Controller {
  readonly store: Store;
  /** Sends an intent to the server. */
  send(msg: ClientMessage): void;
  /** Called by the join form with the chosen display name. */
  join(name: string): void;
  select(selection: Selection | null): void;
  setPlacing(placing: Placing | null): void;
  setView(mapId: string, view: View): void;
  setDrag(drag: { tokenId: string; col: number; row: number } | null): void;
  notify(message: string | null): void;
  /** Switches tool; clears the ruler, calibration and placing. */
  setTool(tool: Tool): void;
  setRuler(ruler: { mapId: string; from: Point; to: Point } | null): void;
  setCalibration(calibration: { mapId: string; first: Point | null; hover: Point | null } | null): void;
  toggleSidebar(): void;
  /** Uploads an image; returns null (and shows a notice) on failure. */
  upload(file: Blob): Promise<ImageRef | null>;
  handleServerMessage(msg: ServerMessage): void;
}

export interface ControllerDeps {
  store: Store;
  /** Returns false if the message could not be sent (disconnected). */
  send(msg: ClientMessage): boolean;
  uploader: Uploader;
  /** Called once a name has been chosen (main.ts opens the connection here). */
  onJoin?(name: string): void;
  /** How long a ping stays on screen (ms). */
  pingDurationMs?: number;
}

/** A stable, readable colour for a user, derived from their id. */
export function userColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 85%, 55%)`;
}

/** Drops local references to things that no longer exist on the server. */
function pruneLocal(table: TableState, selection: Selection | null, placing: Placing | null) {
  const exists = (s: Selection) =>
    s.kind === "token" ? table.tokens.some((t) => t.id === s.id) : table.templates.some((t) => t.id === s.id);
  const placingOk = !placing || "blank" in placing || table.templates.some((t) => t.id === placing.templateId);
  return {
    selection: selection && exists(selection) ? selection : null,
    placing: placingOk ? placing : null,
  };
}

export function createController({ store, send, uploader, onJoin, pingDurationMs = 1900 }: ControllerDeps): Controller {
  let pingSeq = 0;
  return {
    store,
    send(msg) {
      if (!send(msg)) store.update({ notice: "Not connected to the server; change not sent." });
    },
    join(name) {
      store.update({ name });
      onJoin?.(name);
    },
    select(selection) {
      store.update({ selection });
    },
    setPlacing(placing) {
      store.update({ placing });
    },
    setView(mapId, view) {
      store.update((s) => ({ views: { ...s.views, [mapId]: view } }));
    },
    setDrag(drag) {
      store.update({ drag });
    },
    notify(notice) {
      store.update({ notice });
    },
    setTool(tool) {
      store.update({ tool, ruler: null, calibration: null, placing: null });
    },
    setRuler(ruler) {
      store.update({ ruler });
    },
    setCalibration(calibration) {
      store.update({ calibration });
    },
    toggleSidebar() {
      store.update((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
    },
    async upload(file) {
      try {
        return await uploader(file);
      } catch (err) {
        store.update({ notice: (err as Error).message });
        return null;
      }
    },
    handleServerMessage(msg) {
      switch (msg.type) {
        case "welcome":
          store.update((s) => ({ me: msg.you, table: msg.state, users: msg.users, ...pruneLocal(msg.state, s.selection, s.placing) }));
          return;
        case "state":
          store.update((s) => ({
            table: msg.state,
            ...pruneLocal(msg.state, s.selection, s.placing),
            drag: s.drag && msg.state.tokens.some((t) => t.id === s.drag!.tokenId) ? s.drag : null,
          }));
          return;
        case "users":
          store.update({ users: msg.users });
          return;
        case "ping": {
          const ping = { id: ++pingSeq, mapId: msg.mapId, x: msg.x, y: msg.y, color: userColor(msg.user.id), name: msg.user.name };
          store.update((s) => ({ pings: [...s.pings, ping] }));
          setTimeout(() => store.update((s) => ({ pings: s.pings.filter((p) => p.id !== ping.id) })), pingDurationMs);
          return;
        }
        case "error":
          store.update({ notice: `Server rejected ${msg.ref ?? "a message"}: ${msg.message}` });
          return;
      }
    },
  };
}
