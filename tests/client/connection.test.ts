import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Connection, socketUrl, type SocketLike } from "../../src/client/connection.ts";
import { createController } from "../../src/client/controller.ts";
import { Store } from "../../src/client/store.ts";
import type { ServerMessage } from "../../src/shared/protocol.ts";
import { clampZoom, mapToScreen, panBy, screenToMap, zoomAt } from "../../src/client/view.ts";
import { startServer } from "../../src/server/app.ts";
import { makeTempDir, OWNER, PUBLIC_DIR, startTestServer } from "../helpers/server.ts";

/** A controllable fake socket. */
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("view maths", () => {
  test("screen <-> map round trip", () => {
    const v = { x: 30, y: -10, zoom: 2 };
    const m = screenToMap(v, 130, 90);
    assert.deepEqual(m, { x: 50, y: 50 });
    assert.deepEqual(mapToScreen(v, m.x, m.y), { x: 130, y: 90 });
  });

  test("zoom keeps the point under the cursor fixed and is clamped", () => {
    const v = zoomAt({ x: 0, y: 0, zoom: 1 }, 2, 100, 50);
    assert.deepEqual(screenToMap(v, 100, 50), { x: 100, y: 50 });
    assert.equal(clampZoom(100), 8);
    assert.equal(clampZoom(0), 0.1);
    assert.deepEqual(panBy(v, 5, 6), { ...v, x: v.x + 5, y: v.y + 6 });
  });

  test("socket URL follows the page protocol", () => {
    assert.equal(socketUrl({ protocol: "http:", host: "localhost:3000" }, "/ws"), "ws://localhost:3000/ws");
    assert.equal(socketUrl({ protocol: "https:", host: "vtt.example" }, "/ws"), "wss://vtt.example/ws");
  });
});

describe("connection", () => {
  test("says hello on open and reconnects with backoff after a drop", async () => {
    FakeSocket.all = [];
    const statuses: string[] = [];
    const conn = new Connection({
      url: "ws://test/ws",
      createSocket: (u) => new FakeSocket(u),
      getHello: () => ({ type: "hello", name: "Jane Doe" }),
      onStatus: (s) => statuses.push(s),
      onMessage: () => {},
      minDelayMs: 5,
      maxDelayMs: 20,
    });
    conn.start();
    assert.equal(conn.send({ type: "map.create", name: "x" }), false, "nothing is sent before open");
    FakeSocket.all[0]!.open();
    assert.deepEqual(JSON.parse(FakeSocket.all[0]!.sent[0]!), { type: "hello", name: "Jane Doe" });
    assert.equal(conn.send({ type: "map.create", name: "x" }), true);

    FakeSocket.all[0]!.close();
    assert.equal(statuses.at(-1), "closed");
    await wait(30);
    assert.equal(FakeSocket.all.length, 2, "a new socket was opened");
    FakeSocket.all[1]!.open();
    assert.deepEqual(JSON.parse(FakeSocket.all[1]!.sent[0]!), { type: "hello", name: "Jane Doe" });
    conn.stop();
    await wait(30);
    assert.equal(FakeSocket.all.length, 2, "no reconnection after stop()");
    assert.deepEqual(statuses.slice(0, 4), ["connecting", "open", "closed", "connecting"]);
  });

  test("backoff grows exponentially and is capped", () => {
    const conn = new Connection({
      url: "",
      createSocket: (u) => new FakeSocket(u),
      getHello: () => ({ type: "hello", name: "x" }),
      onStatus: () => {},
      onMessage: () => {},
      minDelayMs: 100,
      maxDelayMs: 1000,
    });
    const delays = [1, 2, 3, 4, 5, 6].map((n) => {
      (conn as unknown as { attempts: number }).attempts = n;
      return conn.nextDelay();
    });
    assert.deepEqual(delays, [100, 200, 400, 800, 1000, 1000]);
  });

  test("end to end: the client resyncs from a real server after it restarts", async () => {
    const tmp = makeTempDir();
    let server = await startTestServer(tmp.dir);
    const port = server.port;
    const store = new Store();
    // Declared first because the controller and the connection reference each other.
    let conn: Connection | undefined;
    const app = createController({ store, send: (m) => conn?.send(m) ?? false, uploader: async () => assert.fail() });
    const messages: ServerMessage[] = [];
    const connection = new Connection({
      url: `ws://127.0.0.1:${port}/ws`,
      createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
      getHello: () => ({ type: "hello", name: OWNER.username, password: OWNER.password }),
      onStatus: (connection) => store.update({ connection }),
      onMessage: (m) => {
        messages.push(m);
        app.handleServerMessage(m);
      },
      minDelayMs: 20,
      maxDelayMs: 50,
    });
    conn = connection;
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++) await wait(10);
      assert.ok(cond(), "condition not reached in time");
    };

    try {
      connection.start();
      await until(() => store.get().table !== null);
      app.send({ type: "map.create", name: "Cave" });
      await until(() => store.get().table?.maps.length === 1);

      await server.close();
      await until(() => store.get().connection !== "open");
      server = await startServer({ port, host: "127.0.0.1", dataDir: tmp.dir, publicDir: PUBLIC_DIR, saveDelayMs: 5, owner: OWNER });
      await until(() => store.get().connection === "open" && messages.filter((m) => m.type === "welcome").length === 2);
      assert.equal(store.get().table?.maps[0]?.name, "Cave");
      assert.equal(store.get().users.length, 1);
    } finally {
      connection.stop();
      await server.close();
      tmp.remove();
    }
  });
});

