/**
 * The controller is the only object the UI talks to. It turns UI actions
 * into intents for the server or into local state changes, and folds server
 * messages into the client store. The UI never touches the socket directly,
 * which keeps components easy to test with a fake `send`.
 */
import type { ClientMessage, RulerLine, ServerMessage } from "../shared/protocol.ts";
import type { ImageRef, TableState } from "../shared/types.ts";
import type { Calibration, Placing, Selection, Store, Tool } from "./store.ts";
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
  /** Updates your ruler; it is sent to the others (throttled). */
  setRuler(ruler: RulerLine | null): void;
  setCalibration(calibration: Calibration | null): void;
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
  /** Minimum delay between two ruler updates sent to the server (ms). */
  rulerIntervalMs?: number;
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

export function createController({
  store,
  send,
  uploader,
  onJoin,
  pingDurationMs = 1900,
  rulerIntervalMs = 50,
}: ControllerDeps): Controller {
  let pingSeq = 0;

  // Ruler updates are sent at most every `rulerIntervalMs`; the last one is
  // always sent (trailing), so the others end up seeing the final position.
  let rulerSentAt = 0;
  let rulerTimer: ReturnType<typeof setTimeout> | null = null;
  const sendRuler = () => {
    rulerTimer = null;
    rulerSentAt = Date.now();
    send({ type: "ruler", ruler: store.get().ruler });
  };
  const scheduleRuler = () => {
    if (rulerTimer) return;
    const wait = rulerSentAt + rulerIntervalMs - Date.now();
    if (wait <= 0) sendRuler();
    else rulerTimer = setTimeout(sendRuler, wait);
  };

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
      const hadRuler = store.get().ruler !== null;
      store.update({ tool, ruler: null, calibration: null, placing: null });
      if (hadRuler) scheduleRuler();
    },
    setRuler(ruler) {
      store.update({ ruler });
      scheduleRuler();
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
          // remoteRulers is reset: the server sends the current ones right after welcome.
          store.update((s) => ({
            me: msg.you,
            table: msg.state,
            users: msg.users,
            remoteRulers: {},
            ...pruneLocal(msg.state, s.selection, s.placing),
          }));
          return;
        case "state":
          store.update((s) => ({
            table: msg.state,
            ...pruneLocal(msg.state, s.selection, s.placing),
            drag: s.drag && msg.state.tokens.some((t) => t.id === s.drag!.tokenId) ? s.drag : null,
          }));
          return;
        case "users":
          store.update((s) => ({
            users: msg.users,
            // Drop the rulers of users who left.
            remoteRulers: Object.fromEntries(Object.entries(s.remoteRulers).filter(([id]) => msg.users.some((u) => u.id === id))),
          }));
          return;
        case "ruler":
          store.update((s) => {
            const remoteRulers = { ...s.remoteRulers };
            if (msg.ruler) remoteRulers[msg.user.id] = { ...msg.ruler, name: msg.user.name, color: userColor(msg.user.id) };
            else delete remoteRulers[msg.user.id];
            return { remoteRulers };
          });
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
