/**
 * Entry point used by `npm start`. Configuration comes from environment
 * variables:
 *   PORT      port to listen on (default 3000)
 *   HOST      interface to bind (default: all interfaces)
 *   DATA_DIR  where state.json and uploaded images live (default ./data)
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./app.ts";

// This file is bundled to build/server/main.js; the client is in build/public.
const here = dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[malzob] invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

const server = await startServer({
  port,
  ...(process.env.HOST ? { host: process.env.HOST } : {}),
  dataDir: resolve(process.env.DATA_DIR ?? "data"),
  publicDir: join(here, "..", "public"),
});

console.log(`[malzob] table ready at ${server.url}`);

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
