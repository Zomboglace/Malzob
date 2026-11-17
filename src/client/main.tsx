/** Browser entry point: wires the store, the connection, the controller and the UI. */
import { render } from "preact";
import { WS_PATH } from "../shared/protocol.ts";
import { Connection, type SocketLike, socketUrl } from "./connection.ts";
import { createController } from "./controller.ts";
import { handleKeyDown } from "./keyboard.ts";
import { Store } from "./store.ts";
import { App } from "./ui/App.tsx";
import { createUploader } from "./upload.ts";

const NAME_KEY = "malzob.name";

function savedName(): string | null {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

const store = new Store();

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
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Storage unavailable: the name is just not remembered.
    }
    connection.start();
  },
});

const root = document.getElementById("app")!;
const draw = () => render(<App app={app} state={store.get()} />, root);
store.subscribe(draw);
draw();

// Pre-fill the join form with the last name used in this browser.
const previous = savedName();
const input = root.querySelector<HTMLInputElement>("input[name=displayName]");
if (previous && input) input.value = previous;

// Arrow keys move the selected token; Escape cancels placing / closes the sheet.
addEventListener("keydown", (e) => handleKeyDown(app, e));
