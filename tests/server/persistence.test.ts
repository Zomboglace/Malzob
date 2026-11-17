import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ImageRef } from "../../src/shared/types.ts";
import { fakePng } from "../helpers/images.ts";
import { makeTempDir, startTestServer, TestClient } from "../helpers/server.ts";

describe("server: persistence", () => {
  let tmp: ReturnType<typeof makeTempDir>;

  beforeEach(() => {
    tmp = makeTempDir();
  });
  afterEach(() => tmp.remove());

  test("state survives a server restart", async () => {
    const server1 = await startTestServer(tmp.dir);
    const { client } = await TestClient.joinOwner(server1);
    const s1 = await client.apply({ type: "map.create", name: "Cave" });
    const mapId = s1.maps[0]!.id;
    await client.apply({ type: "template.create", name: "Goblin" });
    const s3 = await client.apply({ type: "token.create", mapId, col: 4, row: 2 });
    await client.apply({ type: "token.update", tokenId: s3.tokens[0]!.id, changes: { stats: { notes: "Has a key" } } });
    const before = server1.table.getState();
    await client.close();
    await server1.close();

    const saved = JSON.parse(readFileSync(join(tmp.dir, "state.json"), "utf8"));
    assert.deepEqual(saved, before);

    const server2 = await startTestServer(tmp.dir);
    const { client: again, welcome } = await TestClient.joinOwner(server2);
    assert.deepEqual(welcome.state, before);
    assert.equal(welcome.state.tokens[0]!.stats.notes, "Has a key");
    await again.close();
    await server2.close();
  });

  test("uploaded images are stored by hash and survive a restart", async () => {
    const server1 = await startTestServer(tmp.dir);
    const { client, welcome } = await TestClient.joinOwner(server1);
    const headers = { "Content-Type": "image/png", "X-Malzob-Upload": welcome.uploadToken };
    const png = fakePng(1400, 700);
    const res = await fetch(`${server1.url}/api/images`, { method: "POST", headers, body: png });
    assert.equal(res.status, 201);
    const ref = (await res.json()) as ImageRef;
    assert.match(ref.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual([ref.ext, ref.width, ref.height], ["png", 1400, 700]);

    // Same bytes -> same hash.
    const res2 = await fetch(`${server1.url}/api/images`, { method: "POST", headers, body: png });
    assert.equal(((await res2.json()) as ImageRef).hash, ref.hash);

    const s = await client.apply({ type: "map.create", name: "Cave" });
    const withBg = await client.apply({ type: "map.setBackground", mapId: s.maps[0]!.id, image: ref.hash });
    assert.deepEqual([withBg.maps[0]!.width, withBg.maps[0]!.height, withBg.maps[0]!.grid.cols, withBg.maps[0]!.grid.rows], [1400, 700, 20, 10]);
    await client.close();
    await server1.close();

    const server2 = await startTestServer(tmp.dir);
    const img = await fetch(`${server2.url}/images/${ref.hash}.png`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.deepEqual(new Uint8Array(await img.arrayBuffer()), png);
    // The image is still known to the reducer after the restart.
    const { client: c2 } = await TestClient.joinOwner(server2);
    const again = await c2.apply({ type: "map.setBackground", mapId: s.maps[0]!.id, image: ref.hash });
    assert.equal(again.maps[0]!.background?.hash, ref.hash);
    await c2.close();
    await server2.close();
  });

  test("states saved by an older version are migrated (new grid fields get defaults)", async () => {
    const grid = { cellSize: 70, offsetX: 0, offsetY: 0, cols: 20, rows: 15, color: "#000000", opacity: 0.35, visible: true };
    const old = {
      rev: 4,
      activeMapId: "m1",
      maps: [{ id: "m1", name: "Old cave", background: null, width: 1400, height: 1050, grid }],
      tokens: [],
      templates: [],
    };
    writeFileSync(join(tmp.dir, "state.json"), JSON.stringify(old));
    const server = await startTestServer(tmp.dir);
    const map = server.table.getState().maps[0]!;
    assert.equal(map.name, "Old cave");
    assert.equal(map.grid.feetPerCell, 5);
    assert.equal(map.grid.subdivisions, 1);
    assert.deepEqual([map.grid.cellWidth, map.grid.cellHeight, map.grid.defaultTokenSize], [70, 70, 1]);
    await server.close();
  });

  test("a corrupt state file is moved aside and the server starts empty", async () => {
    writeFileSync(join(tmp.dir, "state.json"), "{ broken");
    const warn = console.warn;
    console.warn = () => {};
    try {
      const server = await startTestServer(tmp.dir);
      assert.equal(server.table.getState().maps.length, 0);
      await server.close();
    } finally {
      console.warn = warn;
    }
  });
});
