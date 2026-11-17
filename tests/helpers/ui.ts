/** Mounts the real App with a real store/controller and a fake `send`. */
import { h, render } from "preact";
import { createController, type Controller } from "../../src/client/controller.ts";
import { initialClientState, Store, type ClientState } from "../../src/client/store.ts";
import { App } from "../../src/client/ui/App.tsx";
import type { ClientMessage } from "../../src/shared/protocol.ts";
import { defaultGrid } from "../../src/shared/grid.ts";
import { defaultStats } from "../../src/shared/stats.ts";
import type { TableState, User } from "../../src/shared/types.ts";

export const OWNER_USER: User = { id: "u1", name: "Jane Doe", role: "owner" };
export const PLAYER_USER: User = { id: "u2", name: "John Doe", role: "player" };

/** A small table: one 10x8 map with 50px cells, a Goblin template, one token. */
export function sampleTable(): TableState {
  const grid = { ...defaultGrid(), cellWidth: 50, cellHeight: 50, cols: 10, rows: 8 };
  const goblin = defaultStats("Goblin");
  goblin.hp = { current: 7, max: 7, temp: 0 };
  const token = defaultStats("Goblin 1");
  token.hp = { current: 5, max: 10, temp: 0 };
  token.abilities.str = 15;
  token.abilities.dex = 8;
  return {
    rev: 3,
    playerMaps: {},
    maps: [{ id: "map1", name: "Cave", background: null, width: 500, height: 400, grid }],
    templates: [{ id: "tpl1", size: 1, color: "#00aa00", image: null, stats: goblin, control: { players: [], everyone: false }, unique: false }],
    tokens: [
      {
        id: "tok1",
        mapId: "map1",
        templateId: "tpl1",
        col: 2,
        row: 3,
        size: 1,
        color: "#00aa00",
        image: null,
        stats: token,
        control: { players: [], everyone: false },
      },
    ],
  };
}

export interface Mounted {
  root: HTMLElement;
  app: Controller;
  store: Store;
  sent: ClientMessage[];
  joined: string[];
  $(selector: string): HTMLElement;
  $$(selector: string): HTMLElement[];
  unmount(): void;
}

export function mount(partial: Partial<ClientState> = {}, options: { pingDurationMs?: number; rulerIntervalMs?: number } = {}): Mounted {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const store = new Store({
    ...initialClientState(),
    connection: "open",
    name: "Jane Doe",
    me: OWNER_USER,
    users: [OWNER_USER, PLAYER_USER],
    uploadToken: "test-upload-token",
    table: sampleTable(),
    ...partial,
  });
  const sent: ClientMessage[] = [];
  const joined: string[] = [];
  const app = createController({
    store,
    send: (m) => {
      sent.push(m);
      return true;
    },
    uploader: async () => {
      throw new Error("no uploads in this test");
    },
    onJoin: (n) => joined.push(n),
    ...options,
  });
  const draw = () => render(h(App, { app, state: store.get() }), root);
  const unsubscribe = store.subscribe(draw);
  draw();
  return {
    root,
    app,
    store,
    sent,
    joined,
    $(selector) {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`no element matches ${selector}`);
      return el;
    },
    $$(selector) {
      return [...root.querySelectorAll<HTMLElement>(selector)];
    },
    unmount() {
      unsubscribe();
      render(null, root);
      root.remove();
    },
  };
}
