/**
 * Wires everything together: HTTP routes, the WebSocket endpoint, the image
 * store, the persisted state. Used by main.ts and by the tests.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { WS_PATH } from "../shared/protocol.ts";
import { createRequestHandler } from "./http.ts";
import { ImageStore } from "./images.ts";
import { OwnerStore } from "./owner.ts";
import { StateStore } from "./store.ts";
import { Table } from "./table.ts";

/** Largest accepted WebSocket frame. Images go through HTTP, not the socket. */
export const MAX_WS_MESSAGE_BYTES = 256 * 1024;

export interface ServerOptions {
  /** 0 picks a free port. */
  port: number;
  host?: string;
  dataDir: string;
  publicDir: string;
  /** Delay before state is written to disk (ms). */
  saveDelayMs?: number;
  /**
   * Owner credentials to create if no owner account exists yet (used by tests
   * and headless setups; main.ts asks interactively instead).
   */
  owner?: { username: string; password: string };
}

export interface RunningServer {
  url: string;
  port: number;
  table: Table;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const images = new ImageStore(options.dataDir);
  const store = new StateStore(options.dataDir, options.saveDelayMs);
  const owner = new OwnerStore(options.dataDir);
  if (!owner.exists && options.owner) owner.set(options.owner.username, options.owner.password);
  if (!owner.exists) throw new Error("No owner account: set one up first (npm start asks for it).");
  const table = new Table(store, images, owner);

  const http = createServer(
    createRequestHandler({ publicDir: options.publicDir, images, isUploadAllowed: (token) => table.isUploadAllowed(token) }),
  );
  const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: MAX_WS_MESSAGE_BYTES });
  wss.on("connection", (socket) => table.connect(socket));

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, options.host, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  const shownHost = !options.host || options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;

  return {
    url: `http://${shownHost}:${port}`,
    port,
    table,
    async close() {
      table.closeAll();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      store.flush();
    },
  };
}
