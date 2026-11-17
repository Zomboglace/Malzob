// @ts-check
/**
 * Builds the app with esbuild:
 *   src/client/main.tsx -> build/public/app.js  (+ public/* copied as-is)
 *   src/server/main.ts  -> build/server/main.js (npm packages stay external)
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build");

export async function buildAll() {
  rmSync(join(out, "public"), { recursive: true, force: true });
  rmSync(join(out, "server"), { recursive: true, force: true });
  mkdirSync(join(out, "public"), { recursive: true });
  cpSync(join(root, "public"), join(out, "public"), { recursive: true });

  await build({
    entryPoints: [join(root, "src/client/main.tsx")],
    outfile: join(out, "public/app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "preact",
    sourcemap: true,
    minify: true,
    logLevel: "warning",
  });

  await build({
    entryPoints: [join(root, "src/server/main.ts")],
    outfile: join(out, "server/main.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "external",
    sourcemap: true,
    logLevel: "warning",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildAll();
  console.log("[malzob] build complete");
}
