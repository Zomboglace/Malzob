/**
 * Plain node:http routes:
 *   GET  /                 -> the built client (public/index.html, app.js, ...)
 *   GET  /images/<file>    -> an uploaded image
 *   POST /api/images       -> upload an image (raw body), returns its ImageRef
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { IMAGE_MIME } from "../shared/imageInfo.ts";
import { type ImageStore, MAX_IMAGE_BYTES } from "./images.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": IMAGE_MIME.png,
  ".jpg": IMAGE_MIME.jpg,
  ".webp": IMAGE_MIME.webp,
};

const UPLOAD_TYPES = new Set(Object.values(IMAGE_MIME));

export interface HttpOptions {
  publicDir: string;
  images: ImageStore;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, file: string, cache: string): void {
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

/** Reads a request body, failing with null if it exceeds `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createRequestHandler({ publicDir, images }: HttpOptions) {
  const root = normalize(publicDir);

  async function upload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
    if (!UPLOAD_TYPES.has(type)) return json(res, 415, { error: "Only PNG, JPEG and WebP images are accepted" });
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_IMAGE_BYTES) return json(res, 413, { error: `Image larger than ${MAX_IMAGE_BYTES} bytes` });
    const body = await readBody(req, MAX_IMAGE_BYTES);
    if (!body) return json(res, 413, { error: `Image larger than ${MAX_IMAGE_BYTES} bytes` });
    const ref = images.add(body);
    if (!ref) return json(res, 400, { error: "Not a valid PNG, JPEG or WebP image" });
    json(res, 201, ref);
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = decodeURIComponent(url.pathname);

      if (path === "/api/images") {
        if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
        return await upload(req, res);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });

      if (path.startsWith("/images/")) {
        const file = images.pathFor(path.slice("/images/".length));
        if (!file) return json(res, 404, { error: "Not found" });
        return sendFile(res, file, "public, max-age=31536000, immutable");
      }

      // Static client files. Normalise and make sure we never leave publicDir.
      const file = normalize(join(root, path === "/" ? "index.html" : path));
      if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
        return json(res, 404, { error: "Not found" });
      }
      sendFile(res, file, "no-cache");
    } catch (err) {
      console.error("[malzob] http error", err);
      if (!res.headersSent) json(res, 500, { error: "Internal error" });
      else res.end();
    }
  };
}
