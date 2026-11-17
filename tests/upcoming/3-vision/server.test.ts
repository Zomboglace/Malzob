/** Part 3 — vision and fog of war on a real server: players only receive what they can see. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { RunningServer } from "../../../src/server/app.ts";
import type { TableState } from "../../../src/shared/types.ts";
import { makeTempDir, startTestServer, TestClient } from "../../helpers/server.ts";

const ids = (s: TableState) => s.tokens.map((t) => t.stats.name).sort();

describe("server: vision and fog of war", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  let server: RunningServer;
  let gm: TestClient;
  let jane: TestClient;
  let mapId: string;
  const tokenIds: Record<string, string> = {};

  /** Creates a named token at (col, row) and returns its id. */
  async function place(name: string, col: number, row: number): Promise<string> {
    const s = await gm.apply({ type: "token.create", mapId, col, row });
    const id = s.tokens.at(-1)!.id;
    await gm.apply({ type: "token.update", tokenId: id, changes: { stats: { name } } });
    tokenIds[name] = id;
    return id;
  }

  beforeEach(async () => {
    tmp = makeTempDir();
    server = await startTestServer(tmp.dir);
    gm = (await TestClient.joinOwner(server)).client;
    // A dark 10 x 8 map, a wall on col 5.
    mapId = (await gm.apply({ type: "map.create", name: "Crypt" })).maps[0]!.id;
    await gm.apply({ type: "map.setGrid", mapId, grid: { cols: 10, rows: 8 } });
    await gm.apply({ type: "light.setBase", mapId, level: "dark" });
    await gm.apply({ type: "wall.create", mapId, from: { col: 5, row: 0 }, to: { col: 5, row: 8 } });
    // Jane's hero with a torch at (1, 3); a goblin in the light; an orc behind the wall.
    const hero = await place("Hero", 1, 3);
    await gm.apply({ type: "token.update", tokenId: hero, changes: { control: { players: ["Jane Doe"] }, light: { bright: 20, dim: 20 } } });
    await place("Goblin", 3, 3);
    await place("Orc", 7, 3);
    jane = (await TestClient.join(server, "Jane Doe")).client;
  });

  afterEach(async () => {
    await jane.close();
    await gm.close();
    await server.close();
    tmp.remove();
  });

  test("a player receives only the tokens their tokens see", async () => {
    const { client, welcome } = await TestClient.join(server, "Jane Doe");
    assert.deepEqual(ids(welcome.state), ["Goblin", "Hero"]);
    assert.equal(welcome.state.vision!.visible["3,3"], "bright");
    assert.equal(welcome.state.vision!.visible["7,3"], undefined);
    await client.close();
  });

  test("tokens appear and disappear as they enter and leave sight", async () => {
    gm.send({ type: "token.move", tokenId: tokenIds.Goblin!, col: 8, row: 3, via: "drag" });
    assert.deepEqual(ids((await jane.next("state")).state), ["Hero"], "the goblin went behind the wall");
    gm.send({ type: "token.move", tokenId: tokenIds.Orc!, col: 2, row: 5, via: "drag" });
    assert.deepEqual(ids((await jane.next("state")).state), ["Hero", "Orc"], "the orc came into the light");
  });

  test("explored areas are remembered, survive a restart, and the owner can reset them", async () => {
    // Swap the torch for a candle (2 cells of light), then walk down.
    await gm.apply({ type: "token.update", tokenId: tokenIds.Hero!, changes: { light: { bright: 5, dim: 5 } } });
    jane.send({ type: "token.move", tokenId: tokenIds.Hero!, col: 1, row: 7, via: "keyboard" });
    const after = (await jane.next("state", (m) => m.state.tokens.some((t) => t.stats.name === "Hero" && t.row === 7))).state;
    assert.equal(after.vision!.visible["1,1"], undefined, "too far for the candle");
    assert.ok(after.vision!.explored.includes("1,1"), "seen earlier with the torch");

    await jane.close();
    await gm.close();
    await server.close();
    server = await startTestServer(tmp.dir);
    gm = (await TestClient.joinOwner(server)).client;
    const back = await TestClient.join(server, "Jane Doe");
    jane = back.client;
    assert.ok(back.welcome.state.vision!.explored.includes("1,1"), "still explored after a restart");

    gm.send({ type: "fog.reset" });
    const reset = (await jane.next("state")).state;
    assert.ok(!reset.vision!.explored.includes("1,1"));
    assert.deepEqual(new Set(reset.vision!.explored), new Set(Object.keys(reset.vision!.visible)), "only what is seen now");
  });

  test("players cannot reset the fog or change how their token sees", async () => {
    jane.send({ type: "fog.reset" });
    assert.equal((await jane.next("error")).code, "forbidden");
    jane.send({ type: "token.update", tokenId: tokenIds.Hero!, changes: { vision: { darkvision: 120 } } });
    assert.equal((await jane.next("error")).code, "forbidden");
  });

  test("a player without tokens receives none, and sees nothing", async () => {
    await gm.apply({ type: "light.setBase", mapId, level: "bright" });
    const { client, welcome } = await TestClient.join(server, "Mary Major");
    assert.deepEqual(welcome.state.tokens, []);
    assert.deepEqual(welcome.state.vision!.visible, {});
    await client.close();
  });

  test("the owner receives every token and the fog", async () => {
    const { client, welcome } = await TestClient.joinOwner(server);
    assert.deepEqual(ids(welcome.state), ["Goblin", "Hero", "Orc"]);
    assert.ok(Object.keys(welcome.state.fog).length > 0);
    assert.equal(welcome.state.vision, undefined);
    await client.close();
  });
});
