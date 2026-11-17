// @ts-check
/**
 * Test runner: builds the app (the server tests serve the real client), then
 * compiles every tests/**\/*.test.ts(x) with esbuild and runs them with the
 * built-in node:test runner. Extra arguments are passed to `node --test`,
 * e.g. `npm test -- --test-name-pattern=grid`.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "./build.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "build/tests");

/** @param {string} dir @returns {string[]} */
function findTests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return findTests(p);
    return /\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

await buildAll();
rmSync(outdir, { recursive: true, force: true });
const entries = findTests(join(root, "tests"));
await build({
  entryPoints: entries,
  outdir,
  outbase: join(root, "tests"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  jsx: "automatic",
  jsxImportSource: "preact",
  outExtension: { ".js": ".mjs" },
  sourcemap: "inline",
  logLevel: "warning",
});

const files = entries.map((e) => join(outdir, relative(join(root, "tests"), e)).replace(/\.tsx?$/, ".mjs"));
const result = spawnSync(process.execPath, ["--enable-source-maps", "--test", ...process.argv.slice(2), ...files], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
