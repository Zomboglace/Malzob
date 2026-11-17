// @ts-check
/**
 * Test runner: builds the app (the server tests serve the real client), then
 * compiles test files with esbuild and runs them with the built-in node:test
 * runner.
 *
 *   node scripts/test.mjs                 every tests/**\/*.test.ts(x), except tests/upcoming
 *   node scripts/test.mjs <dir>           only the tests in <dir> (e.g. tests/upcoming/1-walls);
 *                                         that folder is also type-checked first
 *
 * Other arguments are passed to `node --test`, e.g.
 * `npm test -- --test-name-pattern=grid`.
 *
 * tests/upcoming holds the tests of features that are not implemented yet
 * (see docs/spec-*.md); `npm test` does not run them.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAll } from "./build.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(root, "tests");
const upcomingDir = join(testsDir, "upcoming");
const outdir = join(root, "build/tests");

/** @param {string} dir @param {boolean} skipUpcoming @returns {string[]} */
function findTests(dir, skipUpcoming) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return skipUpcoming && p === upcomingDir ? [] : findTests(p, skipUpcoming);
    return /\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const args = process.argv.slice(2);
const dirs = args.filter((a) => !a.startsWith("-") && existsSync(resolve(root, a)) && statSync(resolve(root, a)).isDirectory());
const nodeArgs = args.filter((a) => !dirs.includes(a));

if (dirs.length > 0) {
  // Type-check the selected folders together with the sources.
  mkdirSync(join(root, "build"), { recursive: true });
  const config = join(root, "build", "tsconfig.selected.json");
  writeFileSync(
    config,
    JSON.stringify({
      extends: "../tsconfig.json",
      include: ["../src", "../tests/helpers", ...dirs.map((d) => relative(join(root, "build"), resolve(root, d)))],
      exclude: [],
    }),
  );
  const tsc = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit", cwd: root });
  if (tsc.status !== 0) {
    console.error("[malzob] type errors in the selected tests or sources (see above)");
    process.exit(tsc.status ?? 1);
  }
}

await buildAll();
rmSync(outdir, { recursive: true, force: true });
const entries = dirs.length > 0 ? dirs.flatMap((d) => findTests(resolve(root, d), false)) : findTests(testsDir, true);
await build({
  entryPoints: entries,
  outdir,
  outbase: testsDir,
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

const files = entries.map((e) => join(outdir, relative(testsDir, e)).replace(/\.tsx?$/, ".mjs"));
// A failing server test may leave a socket open: --test-force-exit ends the run
// anyway, and --test-timeout fails a stuck test instead of waiting forever.
const runner = ["--enable-source-maps", "--test", "--test-force-exit", "--test-timeout=30000"];
const result = spawnSync(process.execPath, [...runner, ...nodeArgs, ...files], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
