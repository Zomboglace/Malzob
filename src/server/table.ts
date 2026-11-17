/**
 * The table hub: owns the authoritative state and the list of connected
 * clients. Each incoming message is decoded, validated, applied through the
 * shared reducer, persisted, and the result is broadcast to every client.
 */
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ClientMessage, ErrorCode, ServerMessage } from "../shared/protocol.ts";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import { applyIntent, type ReducerContext } from "../shared/reducer.ts";
import type { TableState, User } from "../shared/types.ts";
import { validateClientMessage } from "../shared/validate.ts";
import type { ImageStore } from "./images.ts";
import type { StateStore } from "./store.ts";

interface Client {
  socket: WebSocket;
  /** null until the client has sent `hello`. */
  user: User | null;
}

export class Table {
  private state: TableState;
  private readonly clients = new Map<WebSocket, Client>();
  private readonly ctx: ReducerContext;

  constructor(
    private readonly store: StateStore,
    images: ImageStore,
  ) {
    this.state = store.load();
    this.ctx = { newId: () => randomUUID(), getImage: (hash) => images.get(hash) };
  }

  getState(): TableState {
    return this.state;
  }

  connect(socket: WebSocket): void {
    this.clients.set(socket, { socket, user: null });
    socket.on("message", (data, isBinary) => {
      if (isBinary) return this.sendError(socket, "invalid", "binary messages are not supported");
      this.receive(socket, data.toString());
    });
    socket.on("close", () => {
      const client = this.clients.get(socket);
      this.clients.delete(socket);
      if (client?.user) this.broadcastUsers();
    });
    // `ws` has already started a clean close (e.g. code 1009 for an oversized
    // frame) when it emits "error". Do not terminate() here: destroying the
    // TCP socket while the peer is still sending makes some systems (Windows)
    // reset the connection, and the client never sees the close code.
    socket.on("error", (err) => {
      if (process.env.MALZOB_DEBUG) console.warn("[malzob] socket error:", err.message);
    });
  }

  /** Handles one raw text frame from a client. */
  receive(socket: WebSocket, raw: string): void {
    const client = this.clients.get(socket);
    if (!client) return;

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return this.sendError(socket, "bad_json", "message is not valid JSON");
    }
    const result = validateClientMessage(decoded);
    if (!result.ok) return this.sendError(socket, "invalid", result.error, typeOf(decoded));
    this.handle(client, result.message);
  }

  private handle(client: Client, msg: ClientMessage): void {
    if (msg.type === "hello") {
      client.user = { id: client.user?.id ?? randomUUID(), name: msg.name };
      this.send(client.socket, {
        type: "welcome",
        protocol: PROTOCOL_VERSION,
        you: client.user,
        state: this.state,
        users: this.users(),
      });
      this.broadcastUsers();
      return;
    }
    if (!client.user) return this.sendError(client.socket, "not_ready", "send hello first", msg.type);
    if (msg.type === "user.rename") {
      client.user.name = msg.name;
      this.broadcastUsers();
      return;
    }

    const result = applyIntent(this.state, msg, this.ctx);
    if (!result.ok) return this.sendError(client.socket, result.code, result.error, msg.type);
    this.state = result.state;
    this.store.save(this.state);
    this.broadcast({ type: "state", state: this.state });
  }

  users(): User[] {
    return [...this.clients.values()].flatMap((c) => (c.user ? [c.user] : []));
  }

  closeAll(): void {
    for (const socket of this.clients.keys()) socket.terminate();
    this.clients.clear();
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  private sendError(socket: WebSocket, code: ErrorCode, message: string, ref?: string): void {
    this.send(socket, ref ? { type: "error", code, message, ref } : { type: "error", code, message });
  }

  /** Sends to every client that has said hello. */
  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      if (c.user && c.socket.readyState === c.socket.OPEN) c.socket.send(data);
    }
  }

  private broadcastUsers(): void {
    this.broadcast({ type: "users", users: this.users() });
  }
}

function typeOf(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string") {
    return (value as { type: string }).type.slice(0, 40);
  }
  return undefined;
}
