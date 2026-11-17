import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { RunningServer } from "../../src/server/app.ts";
import { MAX_IMAGE_BYTES } from "../../src/server/images.ts";
import { fakeJpeg, fakePng, fakeWebp } from "../helpers/images.ts";
import { makeTempDir, startTestServer } from "../helpers/server.ts";

describe("server: HTTP", () => {
  let tmp: ReturnType<typeof makeTempDir>;
  let server: RunningServer;

  before(async () => {
    tmp = makeTempDir();
    server = await startTestServer(tmp.dir);
  });
  after(async () => {
    await server.close();
    tmp.remove();
  });

  const upload = (body: Uint8Array<ArrayBuffer>, type: string) =>
    fetch(`${server.url}/api/images`, { method: "POST", headers: { "Content-Type": type }, body });

  test("serves the built client", async () => {
    const index = await fetch(`${server.url}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /<div id="app">/);
    const js = await fetch(`${server.url}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/);
  });

  test("does not serve files outside the public directory", async () => {
    for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/images/../state.json"]) {
      const res = await fetch(`${server.url}${path}`);
      assert.equal(res.status, 404, path);
    }
  });

  test("accepts PNG, JPEG and WebP uploads", async () => {
    for (const [bytes, type, ext] of [
      [fakePng(10, 10), "image/png", "png"],
      [fakeJpeg(20, 10), "image/jpeg", "jpg"],
      [fakeWebp(30, 10), "image/webp", "webp"],
    ] as const) {
      const res = await upload(bytes, type);
      assert.equal(res.status, 201, type);
      assert.equal(((await res.json()) as { ext: string }).ext, ext);
    }
  });

  test("rejects other content types, fake images and oversized files", async () => {
    assert.equal((await upload(new TextEncoder().encode("<svg/>"), "image/svg+xml")).status, 415);
    assert.equal((await upload(new TextEncoder().encode("not an image"), "image/png")).status, 400);
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    huge.set(fakePng(10, 10));
    assert.equal((await upload(huge, "image/png")).status, 413);
    assert.equal((await fetch(`${server.url}/api/images`)).status, 405);
  });

  test("unknown images are 404", async () => {
    assert.equal((await fetch(`${server.url}/images/${"f".repeat(64)}.png`)).status, 404);
    assert.equal((await fetch(`${server.url}/images/whatever.png`)).status, 404);
  });
});
