/** Browser entry point: wires the store, the connection, the controller and the UI. */
import { render } from "preact";
import { WS_PATH } from "../shared/protocol.ts";
import { Connection, type SocketLike, socketUrl } from "./connection.ts";
import { createController } from "./controller.ts";
import { handleKeyDown } from "./keyboard.ts";
import { initialClientState, Store } from "./store.ts";
import { App } from "./ui/App.tsx";
import { createUploader } from "./upload.ts";

const NAME_KEY = "malzob.name";
const SIDEBAR_KEY = "malzob.sidebarCollapsed";

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the value is just not remembered.
  }
}

const store = new Store({ ...initialClientState(), sidebarCollapsed: load(SIDEBAR_KEY) === "1" });
// Remember whether the sidebar is collapsed in this browser.
store.subscribe((s) => save(SIDEBAR_KEY, s.sidebarCollapsed ? "1" : "0"));

const connection = new Connection({
  url: socketUrl(location, WS_PATH),
  // The DOM WebSocket has richer handler types than SocketLike; the shapes match at runtime.
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  getName: () => store.get().name ?? "Anonymous",
  onStatus: (connection) => store.update({ connection }),
  onMessage: (msg) => app.handleServerMessage(msg),
});

const app = createController({
  store,
  send: (msg) => connection.send(msg),
  uploader: createUploader(),
  onJoin: (name) => {
    save(NAME_KEY, name);
    connection.start();
  },
});

const root = document.getElementById("app")!;
const draw = () => render(<App app={app} state={store.get()} />, root);
store.subscribe(draw);
draw();

// Pre-fill the join form with the last name used in this browser.
const previous = load(NAME_KEY);
const input = root.querySelector<HTMLInputElement>("input[name=displayName]");
if (previous && input) input.value = previous;

// Arrow keys move the selected token; Escape leaves the tool / cancels placing / closes the sheet.
addEventListener("keydown", (e) => handleKeyDown(app, e));
