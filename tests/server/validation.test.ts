import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { RunningServer } from "../../src/server/app.ts";
import { makeTempDir, startTestServer, TestClient } from "../helpers/server.ts";

describe("server: invalid messages are rejected", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  let server: RunningServer;
  let client: TestClient;
  let observer: TestClient;

  before(async () => {
    tmp = makeTempDir();
    server = await startTestServer(tmp.dir);
    client = (await TestClient.join(server, "Jane Doe")).client;
    observer = (await TestClient.join(server, "John Doe")).client;
  });

  after(async () => {
    await client.close();
    await observer.close();
    await server.close();
    tmp.remove();
  });

  test("intents before hello are refused", async () => {
    const anon = await TestClient.connect(server);
    anon.send({ type: "map.create", name: "Sneaky" });
    const err = await anon.next("error");
    assert.equal(err.code, "not_ready");
    assert.equal(server.table.getState().maps.length, 0);
    await anon.close();
  });

  test("bad JSON, unknown types and bad fields get an error and change nothing", async () => {
    const rev = server.table.getState().rev;
    client.sendRaw("{not json");
    assert.equal((await client.next("error")).code, "bad_json");

    client.send({ type: "map.delete-everything" });
    assert.equal((await client.next("error")).code, "invalid");

    client.send({ type: "map.create", name: "" });
    const err = await client.next("error");
    assert.equal(err.code, "invalid");
    assert.equal(err.ref, "map.create");

    client.send({ type: "map.create", name: "Cave", extra: "field" });
    assert.equal((await client.next("error")).code, "invalid");

    assert.equal(server.table.getState().rev, rev);
  });

  test("references to unknown entities are refused", async () => {
    client.send({ type: "token.move", tokenId: "does-not-exist", col: 1, row: 1 });
    const err = await client.next("error");
    assert.equal(err.code, "not_found");
    assert.equal(err.ref, "token.move");
  });

  test("errors go only to the sender, not to other clients", async () => {
    client.send({ type: "map.create", name: "Valid map" });
    const s = await observer.next("state");
    assert.equal(s.state.maps.length, 1);
    // The observer received no error for any of the bad messages above.
    assert.ok(!observer.messages.some((m) => m.type === "error"));
  });

  test("tokens cannot be moved outside the grid", async () => {
    const mapId = server.table.getState().maps[0]!.id;
    const s1 = await client.apply({ type: "token.create", mapId, col: 0, row: 0 });
    const tokenId = s1.tokens[0]!.id;
    const s2 = await client.apply({ type: "token.move", tokenId, col: 99_999, row: -99_999 });
    const grid = s2.maps[0]!.grid;
    assert.deepEqual([s2.tokens[0]!.col, s2.tokens[0]!.row], [grid.cols - 1, 0]);
  });

  test("oversized frames close the connection", async () => {
    const big = await TestClient.connect(server);
    const closed = new Promise<number>((resolve) => big.socket.once("close", (code) => resolve(code)));
    big.sendRaw(JSON.stringify({ type: "hello", name: "x".repeat(300 * 1024) }));
    assert.equal(await closed, 1009, `close code (socket errors: ${big.errors.map((e) => e.message).join(", ") || "none"})`);
    // The server is unaffected and still serves the other clients.
    assert.equal(server.table.users().length, 2);
  });
});
