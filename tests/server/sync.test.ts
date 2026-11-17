import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { RunningServer } from "../../src/server/app.ts";
import { PING_INTERVAL_MS } from "../../src/server/table.ts";
import { PROTOCOL_VERSION } from "../../src/shared/protocol.ts";
import { makeTempDir, startTestServer, TestClient } from "../helpers/server.ts";

describe("server: live sync between two clients", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  let server: RunningServer;
  let alice: TestClient;
  let bob: TestClient;

  before(async () => {
    tmp = makeTempDir();
    server = await startTestServer(tmp.dir);
    alice = (await TestClient.join(server, "Jane Doe")).client;
    bob = (await TestClient.join(server, "John Doe")).client;
  });

  after(async () => {
    await alice.close();
    await bob.close();
    await server.close();
    tmp.remove();
  });

  test("both clients see the connected users", async () => {
    const users = await alice.next("users", (m) => m.users.length === 2);
    assert.deepEqual(users.users.map((u) => u.name).sort(), ["Jane Doe", "John Doe"]);
  });

  test("a map created by one client is broadcast to the other", async () => {
    alice.send({ type: "map.create", name: "Goblin cave" });
    const [a, b] = await Promise.all([alice.next("state"), bob.next("state")]);
    assert.deepEqual(a.state, b.state);
    assert.equal(b.state.maps[0]!.name, "Goblin cave");
    assert.equal(b.state.activeMapId, b.state.maps[0]!.id);
  });

  test("templates, token placement and moves are seen by everyone", async () => {
    alice.send({ type: "template.create", name: "Goblin" });
    const tplState = (await bob.next("state")).state;
    await alice.next("state");
    const mapId = tplState.maps[0]!.id;
    const templateId = tplState.templates[0]!.id;

    bob.send({ type: "token.create", mapId, col: 2, row: 3, templateId });
    const placed = (await alice.next("state")).state;
    await bob.next("state");
    const token = placed.tokens[0]!;
    assert.equal(token.stats.name, "Goblin");
    assert.deepEqual([token.col, token.row], [2, 3]);

    alice.send({ type: "token.move", tokenId: token.id, col: 7, row: 1 });
    const moved = (await bob.next("state")).state;
    await alice.next("state");
    assert.deepEqual([moved.tokens[0]!.col, moved.tokens[0]!.row], [7, 1]);
  });

  test("stat sheet edits sync live", async () => {
    const tokenId = server.table.getState().tokens[0]!.id;
    bob.send({ type: "token.update", tokenId, changes: { stats: { hp: { current: 3 }, conditions: ["poisoned"] } } });
    const s = (await alice.next("state")).state;
    await bob.next("state");
    assert.equal(s.tokens[0]!.stats.hp.current, 3);
    assert.deepEqual(s.tokens[0]!.stats.conditions, ["poisoned"]);
  });

  test("a renamed user is broadcast", async () => {
    bob.send({ type: "user.rename", name: "Goblin 1" });
    const users = await alice.next("users", (m) => m.users.some((u) => u.name === "Goblin 1"));
    assert.equal(users.users.length, 2);
  });

  test("a client leaving is removed from the user list", async () => {
    const { client: carol } = await TestClient.join(server, "Carol Doe");
    await alice.next("users", (m) => m.users.length === 3);
    await carol.close();
    const users = await alice.next("users", (m) => m.users.length === 2);
    assert.ok(!users.users.some((u) => u.name === "Carol Doe"));
  });

  test("pings are relayed to everyone with the sender, and never stored", async () => {
    const mapId = server.table.getState().maps[0]!.id;
    const rev = server.table.getState().rev;
    await new Promise((r) => setTimeout(r, PING_INTERVAL_MS));
    alice.send({ type: "ping", mapId, x: 120.5, y: 64 });
    const [a, b] = await Promise.all([alice.next("ping"), bob.next("ping")]);
    assert.deepEqual(a, b);
    assert.deepEqual([b.mapId, b.x, b.y, b.user.name], [mapId, 120.5, 64, "Jane Doe"]);
    assert.equal(server.table.getState().rev, rev, "a ping does not change the state");

    // Pings on unknown maps are rejected; pings faster than the limit are dropped.
    alice.send({ type: "ping", mapId: "nope", x: 0, y: 0 });
    assert.equal((await alice.next("error")).code, "not_found");
    alice.send({ type: "ping", mapId, x: 1, y: 1 });
    alice.send({ type: "ping", mapId, x: 2, y: 2 });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!bob.messages.some((m) => m.type === "ping" && m.x === 2), "the burst is limited");
  });

  test("rulers are relayed to the others, shown to newcomers, and removed when their owner leaves", async () => {
    const mapId = server.table.getState().maps[0]!.id;
    const line = { mapId, from: { x: 1, y: 2 }, to: { x: 300.25, y: 40 } };
    bob.send({ type: "ruler", ruler: line });
    const seen = await alice.next("ruler");
    assert.deepEqual(seen.ruler, line);
    assert.equal(seen.user.name, "Goblin 1");
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!bob.messages.some((m) => m.type === "ruler"), "the sender is not echoed");

    // A newcomer gets the rulers currently shown, right after welcome.
    const { client: carol } = await TestClient.join(server, "Carol Doe");
    assert.deepEqual((await carol.next("ruler")).ruler, line);

    // Unknown map: rejected.
    bob.send({ type: "ruler", ruler: { ...line, mapId: "nope" } });
    assert.equal((await bob.next("error")).code, "not_found");

    // Bob leaves: his ruler disappears for the others.
    const { client: dave } = await TestClient.join(server, "Dave Doe");
    await dave.next("ruler");
    await carol.close();
    await bob.close();
    const gone = await dave.next("ruler", (m) => m.ruler === null);
    assert.equal(gone.user.name, "Goblin 1");
    await dave.close();
    bob = (await TestClient.join(server, "John Doe")).client;
  });

  test("a reconnecting client resyncs with the full state", async () => {
    const { welcome } = await TestClient.join(server, "Jane Doe");
    assert.deepEqual(welcome.state, server.table.getState());
    assert.equal(welcome.protocol, PROTOCOL_VERSION);
    assert.equal(welcome.you.name, "Jane Doe");
  });
});
