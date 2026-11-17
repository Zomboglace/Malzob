/** Part 2 — light on a real server. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { RunningServer } from "../../../src/server/app.ts";
import { makeTempDir, startTestServer, TestClient } from "../../helpers/server.ts";

describe("server: light", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  let server: RunningServer;
  let gm: TestClient;
  let jane: TestClient;
  let mapId: string;

  beforeEach(async () => {
    tmp = makeTempDir();
    server = await startTestServer(tmp.dir);
    gm = (await TestClient.joinOwner(server)).client;
    mapId = (await gm.apply({ type: "map.create", name: "Crypt" })).maps[0]!.id;
    jane = (await TestClient.join(server, "Jane Doe")).client;
  });

  afterEach(async () => {
    await jane.close();
    await gm.close();
    await server.close();
    tmp.remove();
  });

  test("the owner sets the light; players do not receive the painted areas", async () => {
    await gm.apply({ type: "light.setBase", mapId, level: "dark" });
    gm.send({ type: "light.paint", mapId, cells: [[2, 2], [3, 2]], level: "bright" });
    const [ownerView, janeView] = await Promise.all([gm.next("state"), jane.next("state", (m) => m.state.maps[0]!.light.base === "dark")]);
    assert.deepEqual(ownerView.state.maps[0]!.light, { base: "dark", areas: { "2,2": "bright", "3,2": "bright" } });
    assert.deepEqual(janeView.state.maps[0]!.light, { base: "dark", areas: {} });
  });

  test("players cannot change the light, nor give a light to their token", async () => {
    const s = await gm.apply({ type: "token.create", mapId, col: 1, row: 1 });
    const tokenId = s.tokens[0]!.id;
    await gm.apply({ type: "token.update", tokenId, changes: { control: { players: ["Jane Doe"] } } });
    for (const msg of [
      { type: "light.setBase", mapId, level: "bright" },
      { type: "light.paint", mapId, cells: [[0, 0]], level: "bright" },
      { type: "token.update", tokenId, changes: { light: { bright: 60, dim: 60 } } },
    ]) {
      jane.send(msg);
      assert.equal((await jane.next("error")).code, "forbidden", msg.type);
    }
    // The owner can.
    const lit = await gm.apply({ type: "token.update", tokenId, changes: { light: { bright: 20, dim: 20 } } });
    assert.deepEqual(lit.tokens[0]!.light, { bright: 20, dim: 20 });
  });

  test("light survives a restart", async () => {
    await gm.apply({ type: "light.setBase", mapId, level: "dim" });
    await gm.apply({ type: "light.paint", mapId, cells: [[5, 5]], level: "dark" });
    await jane.close();
    await gm.close();
    await server.close();
    server = await startTestServer(tmp.dir);
    const joined = await TestClient.joinOwner(server);
    gm = joined.client;
    jane = (await TestClient.join(server, "Jane Doe")).client;
    assert.deepEqual(joined.welcome.state.maps[0]!.light, { base: "dim", areas: { "5,5": "dark" } });
  });
});
