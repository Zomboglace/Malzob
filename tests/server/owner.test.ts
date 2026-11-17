import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { startServer } from "../../src/server/app.ts";
import { OwnerStore, SESSION_TTL_MS } from "../../src/server/owner.ts";
import { ensureOwner } from "../../src/server/setup.ts";
import { makeTempDir, OWNER, PUBLIC_DIR, startTestServer, TestClient } from "../helpers/server.ts";

describe("owner account", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => tmp.remove());

  test("the password is stored hashed, and checked", () => {
    const store = new OwnerStore(tmp.dir);
    assert.equal(store.exists, false);
    store.set(" Game Master ", "correct horse");
    const file = readFileSync(join(tmp.dir, "owner.json"), "utf8");
    assert.ok(!file.includes("correct horse"), "never in clear text");
    const again = new OwnerStore(tmp.dir);
    assert.equal(again.username, "Game Master");
    assert.ok(again.checkPassword("correct horse"));
    assert.ok(!again.checkPassword("correct horsE"));
    assert.ok(again.isOwnerName("game master"));
    assert.throws(() => again.set("x", ""), /must not be empty/);
    again.set("Game Master", "a");
    assert.ok(again.checkPassword("a"), "short passwords are allowed");
    assert.throws(() => again.set("  ", "long enough"), /empty/);
  });

  test("sessions are signed, expire, and are invalidated by a reset", () => {
    const store = new OwnerStore(tmp.dir);
    store.set("Game Master", "correct horse");
    const now = Date.now();
    const session = store.issueSession(now);
    assert.ok(store.checkSession(session, now + 1000));
    assert.ok(!store.checkSession(session, now + SESSION_TTL_MS + 1), "expired");
    const [expires] = session.split(".");
    assert.ok(!store.checkSession(`${Number(expires) + 1}.${session.split(".")[1]}`, now), "tampered expiry");
    assert.ok(!store.checkSession("garbage", now));
    store.set("Game Master", "another password");
    assert.ok(!store.checkSession(session, now + 1000), "reset signs everyone out");
  });

  test("setup takes credentials from the environment when there is no terminal", async () => {
    const store = new OwnerStore(tmp.dir);
    const saved = { ...process.env };
    const log = console.log;
    const error = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      delete process.env.MALZOB_OWNER_USERNAME;
      delete process.env.MALZOB_OWNER_PASSWORD;
      assert.equal(await ensureOwner(store, false), false, "no terminal, no variables: refuse");
      process.env.MALZOB_OWNER_USERNAME = "Game Master";
      process.env.MALZOB_OWNER_PASSWORD = "";
      assert.equal(await ensureOwner(store, false), false, "no password: refused (asks for a terminal)");
      process.env.MALZOB_OWNER_PASSWORD = "long enough password";
      assert.equal(await ensureOwner(store, false), true);
      assert.ok(store.checkPassword("long enough password"));
    } finally {
      process.env = saved;
      console.log = log;
      console.error = error;
    }
  });

  test("the server refuses to start without an owner account", async () => {
    await assert.rejects(startServer({ port: 0, host: "127.0.0.1", dataDir: tmp.dir, publicDir: PUBLIC_DIR }), /No owner account/);
  });

  test("npm run reset (--reset-owner) replaces the owner, keeps the table", async () => {
    const server = await startTestServer(tmp.dir);
    const { client } = await TestClient.joinOwner(server);
    await client.apply({ type: "map.create", name: "Kept map" });
    await client.close();
    await server.close();

    const result = spawnSync(process.execPath, ["build/server/main.js", "--reset-owner"], {
      env: { ...process.env, DATA_DIR: tmp.dir, MALZOB_OWNER_USERNAME: "New Master", MALZOB_OWNER_PASSWORD: "new fake password" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Owner account reset/);
    const store = new OwnerStore(tmp.dir);
    assert.equal(store.username, "New Master");
    assert.ok(store.checkPassword("new fake password"));
    assert.ok(!store.checkPassword(OWNER.password));
    assert.match(readFileSync(join(tmp.dir, "state.json"), "utf8"), /Kept map/);
  });
});

describe("server: logging in", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => tmp.remove());

  test("the owner logs in with the password, then with the session token", async () => {
    const server = await startTestServer(tmp.dir);
    const { client, welcome } = await TestClient.joinOwner(server);
    assert.equal(welcome.you.role, "owner");
    assert.ok(welcome.session);
    const again = await TestClient.connect(server);
    again.send({ type: "hello", name: "game master", session: welcome.session });
    const w2 = await again.next("welcome");
    assert.deepEqual([w2.you.role, w2.you.name], ["owner", "Game Master"]);
    await client.close();
    await again.close();
    await server.close();
  });

  test("wrong passwords, the owner's name without a password, and passwords for other names are refused", async () => {
    const server = await startTestServer(tmp.dir);
    const tries: Array<[Record<string, unknown>, RegExp]> = [
      [{ type: "hello", name: OWNER.username, password: "wrong password" }, /wrong password/],
      [{ type: "hello", name: "GAME MASTER" }, /reserved/],
      [{ type: "hello", name: "Jane Doe", password: OWNER.password }, /unknown owner username/],
      [{ type: "hello", name: OWNER.username, session: "1.forged" }, /wrong password/],
    ];
    for (const [hello, reason] of tries) {
      const c = await TestClient.connect(server);
      c.send(hello);
      const err = await c.next("error");
      assert.equal(err.code, "auth_failed");
      assert.match(err.message, reason);
      c.send({ type: "map.create", name: "Sneaky" });
      assert.equal((await c.next("error")).code, "not_ready", "still not joined");
      await c.close();
    }
    assert.equal(server.table.users().length, 0);
    await server.close();
  });

  test("wrong passwords are just refused; there is no lockout", async () => {
    const server = await startTestServer(tmp.dir);
    const c = await TestClient.connect(server);
    for (let i = 0; i < 10; i++) {
      c.send({ type: "hello", name: OWNER.username, password: `wrong ${i}` });
      assert.equal((await c.next("error")).code, "auth_failed");
    }
    c.send({ type: "hello", name: OWNER.username, password: OWNER.password });
    assert.equal((await c.next("welcome")).you.role, "owner");
    await c.close();
    await server.close();
  });
});

describe("server: players", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => tmp.remove());

  test("players cannot configure the table; owner actions are refused with 'forbidden'", async () => {
    const server = await startTestServer(tmp.dir);
    const { client: gm } = await TestClient.joinOwner(server);
    const s = await gm.apply({ type: "map.create", name: "Cave" });
    const mapId = s.maps[0]!.id;
    const withToken = await gm.apply({ type: "token.create", mapId, col: 0, row: 0 });
    const tokenId = withToken.tokens[0]!.id;
    await gm.apply({ type: "token.update", tokenId, changes: { control: { players: ["Jane Doe"] } } });
    const { client: jane } = await TestClient.join(server, "Jane Doe");
    const rev = server.table.getState().rev;

    for (const msg of [
      { type: "map.create", name: "Mine" },
      { type: "map.activate", mapId },
      { type: "map.setGrid", mapId, grid: { visible: false } },
      { type: "token.create", mapId, col: 1, row: 1 },
      { type: "token.delete", tokenId },
      { type: "token.duplicate", tokenId },
      { type: "template.create", name: "Mine", fromTokenId: tokenId },
      { type: "token.update", tokenId, changes: { control: { everyone: true } } },
      { type: "user.rename", name: "game master" },
    ]) {
      jane.send(msg);
      const err = await jane.next("error");
      assert.equal(err.code, "forbidden", msg.type);
    }
    assert.equal(server.table.getState().rev, rev, "nothing changed");

    // What she may do: move and fully edit her token.
    const moved = await jane.apply({ type: "token.move", tokenId, col: 3, row: 2 });
    assert.deepEqual([moved.tokens[0]!.col, moved.tokens[0]!.row], [3, 2]);
    const edited = await jane.apply({ type: "token.update", tokenId, changes: { size: 2, color: "#123456", stats: { name: "Jane's hero", ac: 17 } } });
    assert.deepEqual([edited.tokens[0]!.size, edited.tokens[0]!.color, edited.tokens[0]!.stats.ac], [2, "#123456", 17]);

    // Renaming changes which tokens a player controls.
    jane.send({ type: "user.rename", name: "Someone Else" });
    const after = await jane.next("state");
    assert.equal(after.state.tokens[0]!.redacted, true);
    await gm.close();
    await jane.close();
    await server.close();
  });

  test("players follow the map the owner shows", async () => {
    const server = await startTestServer(tmp.dir);
    const { client: gm } = await TestClient.joinOwner(server);
    await gm.apply({ type: "map.create", name: "Tavern" });
    const s = await gm.apply({ type: "map.create", name: "Dungeon" });
    const { client: jane, welcome } = await TestClient.join(server, "Jane Doe");
    assert.deepEqual(welcome.state.maps.map((m) => m.name), ["Tavern"]);
    gm.send({ type: "map.activate", mapId: s.maps[1]!.id });
    const view = (await jane.next("state")).state;
    assert.deepEqual(view.maps.map((m) => m.name), ["Dungeon"]);
    assert.equal(view.activeMapId, s.maps[1]!.id);
    await gm.close();
    await jane.close();
    await server.close();
  });
});
