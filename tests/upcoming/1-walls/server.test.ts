/** Part 1 — walls on a real server with an owner and a player. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { RunningServer } from "../../../src/server/app.ts";
import { makeTempDir, startTestServer, TestClient } from "../../helpers/server.ts";

describe("server: walls and doors", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  let server: RunningServer;
  let gm: TestClient;
  let jane: TestClient;
  let mapId: string;
  let tokenId: string;

  beforeEach(async () => {
    tmp = makeTempDir();
    server = await startTestServer(tmp.dir);
    gm = (await TestClient.joinOwner(server)).client;
    // Map of 20 x 15 cells; Jane's token at (2, 3); a wall on col 4.
    mapId = (await gm.apply({ type: "map.create", name: "Cave" })).maps[0]!.id;
    const s = await gm.apply({ type: "token.create", mapId, col: 2, row: 3 });
    tokenId = s.tokens[0]!.id;
    await gm.apply({ type: "token.update", tokenId, changes: { control: { players: ["Jane Doe"] } } });
    await gm.apply({ type: "wall.create", mapId, from: { col: 4, row: 0 }, to: { col: 4, row: 15 } });
    jane = (await TestClient.join(server, "Jane Doe")).client;
  });

  afterEach(async () => {
    await jane.close();
    await gm.close();
    await server.close();
    tmp.remove();
  });

  test("the owner receives the walls; players never do", async () => {
    assert.equal(server.table.getState().walls.length, 1);
    const view = (await TestClient.join(server, "Someone Else")).welcome.state;
    assert.deepEqual(view.walls, []);
    gm.send({ type: "wall.create", mapId, from: { col: 0, row: 10 }, to: { col: 3, row: 10 }, kind: "door" });
    const [ownerState, janeState] = await Promise.all([gm.next("state"), jane.next("state")]);
    assert.equal(ownerState.state.walls.length, 2);
    assert.deepEqual(janeState.state.walls, []);
  });

  test("players cannot draw walls or open doors", async () => {
    jane.send({ type: "wall.create", mapId, from: { col: 0, row: 0 }, to: { col: 1, row: 0 } });
    assert.equal((await jane.next("error")).code, "forbidden");
    const doorId = (await gm.apply({ type: "wall.create", mapId, from: { col: 0, row: 6 }, to: { col: 1, row: 6 }, kind: "door" })).walls[1]!.id;
    jane.send({ type: "door.setOpen", wallId: doorId, open: true });
    assert.equal((await jane.next("error")).code, "forbidden");
  });

  test("a player's move through a wall is refused, with the mouse or the keyboard", async () => {
    const ok = await jane.apply({ type: "token.move", tokenId, col: 3, row: 3, via: "drag" });
    assert.deepEqual([ok.tokens[0]!.col, ok.tokens[0]!.row], [3, 3]);
    for (const via of ["drag", "keyboard"] as const) {
      jane.send({ type: "token.move", tokenId, col: 5, row: 3, via });
      const err = await jane.next("error");
      assert.equal(err.code, "blocked", via);
      assert.equal(err.ref, "token.move");
    }
    assert.equal(server.table.getState().tokens[0]!.col, 3, "the token did not move");
  });

  test("the owner goes through walls with the mouse, but not with the keyboard", async () => {
    gm.send({ type: "token.move", tokenId, col: 5, row: 3, via: "keyboard" });
    assert.equal((await gm.next("error")).code, "blocked");
    const s = await gm.apply({ type: "token.move", tokenId, col: 6, row: 3, via: "drag" });
    assert.equal(s.tokens[0]!.col, 6);
  });

  test("an open door lets tokens through; closing it blocks them again", async () => {
    // Replace the wall by a wall with a door between rows 3 and 4.
    const wallId = server.table.getState().walls[0]!.id;
    await gm.apply({ type: "wall.update", wallId, changes: { to: { col: 4, row: 3 } } });
    await gm.apply({ type: "wall.create", mapId, from: { col: 4, row: 4 }, to: { col: 4, row: 15 } });
    const doorId = (await gm.apply({ type: "wall.create", mapId, from: { col: 4, row: 3 }, to: { col: 4, row: 4 }, kind: "door" })).walls[2]!.id;
    await jane.apply({ type: "token.move", tokenId, col: 3, row: 3, via: "drag" });

    jane.send({ type: "token.move", tokenId, col: 4, row: 3, via: "drag" });
    assert.equal((await jane.next("error")).code, "blocked", "closed door");

    await gm.apply({ type: "door.setOpen", wallId: doorId, open: true });
    const through = await jane.apply({ type: "token.move", tokenId, col: 4, row: 3, via: "drag" });
    assert.equal(through.tokens[0]!.col, 4);
    await gm.apply({ type: "door.setOpen", wallId: doorId, open: false });
    jane.send({ type: "token.move", tokenId, col: 3, row: 3, via: "keyboard" });
    assert.equal((await jane.next("error")).code, "blocked", "cannot come back through the closed door");
  });

  test("walls survive a restart", async () => {
    await jane.close();
    await gm.close();
    await server.close();
    server = await startTestServer(tmp.dir);
    const { client, welcome } = await TestClient.joinOwner(server);
    gm = client;
    jane = (await TestClient.join(server, "Jane Doe")).client;
    assert.equal(welcome.state.walls.length, 1);
    assert.deepEqual(welcome.state.walls[0]!.from, { col: 4, row: 0 });
  });
});
