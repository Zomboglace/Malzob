/**
 * Entry point used by `npm start`. Configuration comes from environment
 * variables:
 *   PORT      port to listen on (default 3000)
 *   HOST      interface to bind (default: all interfaces)
 *   DATA_DIR  where state.json and uploaded images live (default ./data)
 *   MALZOB_OWNER_USERNAME, MALZOB_OWNER_PASSWORD
 *             owner credentials to use instead of asking (headless setups)
 *
 * On the first start (no owner account yet) it asks for the owner username
 * and password. With `--reset-owner` (npm run reset) it only asks for new
 * owner credentials, then exits; maps and tokens are kept.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./app.ts";
import { OwnerStore } from "./owner.ts";
import { ensureOwner } from "./setup.ts";

// This file is bundled to build/server/main.js; the client is in build/public.
const here = dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[malzob] invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

const dataDir = resolve(process.env.DATA_DIR ?? "data");
const reset = process.argv.includes("--reset-owner");
if (!(await ensureOwner(new OwnerStore(dataDir), reset))) process.exit(1);
if (reset) {
  console.log("[malzob] Owner account reset; existing owner sessions are signed out. Start the table with: npm start");
  process.exit(0);
}

const server = await startServer({
  port,
  ...(process.env.HOST ? { host: process.env.HOST } : {}),
  dataDir,
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
