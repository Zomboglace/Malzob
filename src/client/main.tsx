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
/** Owner session token, kept per browser tab (sessionStorage). */
const SESSION_KEY = "malzob.session";

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

function load(key: string, kind: "local" | "session" = "local"): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function save(key: string, value: string | null, kind: "local" | "session" = "local"): void {
  try {
    if (value === null) storage(kind)?.removeItem(key);
    else storage(kind)?.setItem(key, value);
  } catch {
    // Storage unavailable: the value is just not remembered.
  }
}

// The owner's password is kept in memory only until the server answers with
// a session token; reconnections and reloads then use the token.
let password: string | undefined;

const store = new Store({ ...initialClientState(), sidebarCollapsed: load(SIDEBAR_KEY) === "1" });
// Remember whether the sidebar is collapsed in this browser.
store.subscribe((s) => save(SIDEBAR_KEY, s.sidebarCollapsed ? "1" : "0"));

const connection = new Connection({
  url: socketUrl(location, WS_PATH),
  // The DOM WebSocket has richer handler types than SocketLike; the shapes match at runtime.
  createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  getHello: () => {
    const name = store.get().name ?? "Anonymous";
    const session = load(SESSION_KEY, "session");
    if (password !== undefined) return { type: "hello", name, password };
    if (session) return { type: "hello", name, session };
    return { type: "hello", name };
  },
  onStatus: (connection) => store.update({ connection }),
  onMessage: (msg) => app.handleServerMessage(msg),
});

const app = createController({
  store,
  send: (msg) => connection.send(msg),
  uploader: createUploader(),
  onJoin: (name, typedPassword) => {
    save(NAME_KEY, name);
    if (typedPassword) {
      password = typedPassword;
      save(SESSION_KEY, null, "session");
    }
    connection.start();
  },
  onSession: (session) => {
    save(SESSION_KEY, session, "session");
    password = undefined;
  },
  onAuthFailed: () => {
    connection.stop();
    password = undefined;
    save(SESSION_KEY, null, "session");
  },
});

const root = document.getElementById("app")!;
const draw = () => render(<App app={app} state={store.get()} />, root);
store.subscribe(draw);
draw();

// Pre-fill the join form with the last name used in this browser; an owner
// with a session in this tab (page reload) is logged back in directly.
const previous = load(NAME_KEY);
const input = root.querySelector<HTMLInputElement>("input[name=displayName]");
if (previous && input) input.value = previous;
if (previous && load(SESSION_KEY, "session")) app.join(previous);

// Arrow keys move the selected token; Escape leaves the tool / cancels placing / closes the sheet.
addEventListener("keydown", (e) => handleKeyDown(app, e));
