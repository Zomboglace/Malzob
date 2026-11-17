/**
 * Test helpers: start a real server on a free port in a temporary data
 * directory, and connect real WebSocket clients to it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../../src/shared/protocol.ts";
import { startServer, type RunningServer } from "../../src/server/app.ts";

export const PUBLIC_DIR = join(process.cwd(), "build", "public");

/** Fake owner credentials used by the test servers. */
export const OWNER = { username: "Game Master", password: "fake-test-password" };

export function makeTempDir(): { dir: string; remove(): void } {
  const dir = mkdtempSync(join(tmpdir(), "malzob-test-"));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function startTestServer(dataDir: string): Promise<RunningServer> {
  return startServer({ port: 0, host: "127.0.0.1", dataDir, publicDir: PUBLIC_DIR, saveDelayMs: 5, owner: OWNER });
}

type Msg<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

/** A WebSocket client that records every message and lets tests await them. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  /** Socket-level errors (e.g. ECONNRESET); recorded so they never crash the test run. */
  readonly errors: Error[] = [];
  private cursor = 0;
  private waiters: Array<() => void> = [];

  private constructor(readonly socket: WebSocket) {
    socket.on("error", (err) => this.errors.push(err));
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static async connect(server: RunningServer): Promise<TestClient> {
    const socket = new WebSocket(`${server.url.replace("http", "ws")}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return new TestClient(socket);
  }

  /** Connects and says hello as a player; resolves with the welcome message. */
  static async join(server: RunningServer, name: string): Promise<{ client: TestClient; welcome: Msg<"welcome"> }> {
    const client = await TestClient.connect(server);
    client.send({ type: "hello", name });
    const welcome = await client.next("welcome");
    return { client, welcome };
  }

  /** Connects and logs in as the owner. */
  static async joinOwner(server: RunningServer): Promise<{ client: TestClient; welcome: Msg<"welcome"> }> {
    const client = await TestClient.connect(server);
    client.send({ type: "hello", name: OWNER.username, password: OWNER.password });
    const welcome = await client.next("welcome");
    return { client, welcome };
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.socket.send(JSON.stringify(msg));
  }

  sendRaw(data: string): void {
    this.socket.send(data);
  }

  /** Waits for the next unread message of the given type (skipping others). */
  async next<T extends ServerMessage["type"]>(type: T, predicate: (m: Msg<T>) => boolean = () => true, timeoutMs = 2000): Promise<Msg<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.cursor < this.messages.length) {
        const m = this.messages[this.cursor++]!;
        if (m.type === type && predicate(m as Msg<T>)) return m as Msg<T>;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for "${type}"`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  /** Skips unread messages, sends an intent and waits for the resulting state broadcast. */
  async apply(msg: ClientMessage): Promise<Msg<"state">["state"]> {
    this.cursor = this.messages.length;
    this.send(msg);
    return (await this.next("state")).state;
  }

  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }
}
