/**
 * WebSocket connection to the server with automatic reconnection.
 * After every (re)connection it sends `hello` again; the server answers with
 * `welcome` and the full state, so the client resyncs without extra logic.
 */
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import type { ConnectionStatus } from "./store.ts";

/** The subset of the browser WebSocket API we use (also satisfied by Node's). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface ConnectionOptions {
  url: string;
  createSocket: SocketFactory;
  onMessage(msg: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
  /** Called on each open; returns the `hello` message to send (name, and owner credentials). */
  getHello(): Extract<ClientMessage, { type: "hello" }>;
  minDelayMs?: number;
  maxDelayMs?: number;
}

const OPEN = 1;

export class Connection {
  private socket: SocketLike | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly options: ConnectionOptions) {}

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === OPEN;
  }

  /** Sends an intent. Returns false (and drops it) while disconnected. */
  send(msg: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  /** Delay before the next reconnection attempt: exponential, capped. */
  nextDelay(): number {
    const min = this.options.minDelayMs ?? 500;
    const max = this.options.maxDelayMs ?? 5000;
    return Math.min(max, min * 2 ** Math.max(0, this.attempts - 1));
  }

  private open(): void {
    this.options.onStatus("connecting");
    const socket = this.options.createSocket(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.options.onStatus("open");
      socket.send(JSON.stringify(this.options.getHello()));
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        this.options.onMessage(JSON.parse(ev.data) as ServerMessage);
      } catch (err) {
        console.error("[malzob] bad server message", err);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.options.onStatus("closed");
      if (this.stopped) return;
      this.attempts++;
      this.timer = setTimeout(() => this.open(), this.nextDelay());
    };
  }
}

/** ws:// or wss:// URL of the server for a page location. */
export function socketUrl(location: { protocol: string; host: string }, path: string): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
}
