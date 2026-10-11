/**
 * Nitro bundles `@electric-sql/pglite` into the Vercel function, but PGLite
 * still loads `pglite.data`, `pglite.wasm`, and `initdb.wasm` via
 * `new URL("./…", import.meta.url)` next to that chunk. Copy them beside the
 * bundled module so production preview and deploy can open the database.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = ["pglite.data", "pglite.wasm", "initdb.wasm"];
const sourceDir = join(root, "node_modules/@electric-sql/pglite/dist");
const libsDir = join(root, ".vercel/output/functions/__server.func/_libs");

if (!existsSync(libsDir)) {
  console.error("[pglite-assets] no Nitro function output; run vite build first");
  process.exit(1);
}

const bundled = readdirSync(libsDir).find((name) => name.startsWith("electric-sql__pglite"));
if (!bundled) {
  console.error("[pglite-assets] bundled pglite chunk not found");
  process.exit(1);
}

mkdirSync(libsDir, { recursive: true });
for (const name of assets) {
  const from = join(sourceDir, name);
  if (!existsSync(from)) {
    console.error(`[pglite-assets] missing ${from}`);
    process.exit(1);
  }
  copyFileSync(from, join(libsDir, name));
}
console.log(`[pglite-assets] copied ${assets.join(", ")} next to ${bundled}`);
