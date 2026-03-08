import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const ensureDir = async (path) => {
  await mkdir(path, { recursive: true });
};

await ensureDir(resolve(root, "dist/background"));
await ensureDir(resolve(root, "dist/content"));
await ensureDir(resolve(root, "dist/popup"));

await build({
  entryPoints: [resolve(root, "src/background/service-worker.ts")],
  outfile: resolve(root, "dist/background/service-worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120"
});

await build({
  entryPoints: [resolve(root, "src/content/chatgpt/index.ts")],
  outfile: resolve(root, "dist/content/chatgpt.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120"
});

await build({
  entryPoints: [resolve(root, "src/popup/popup.ts")],
  outfile: resolve(root, "dist/popup/popup.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120"
});

await cp(resolve(root, "src/popup/popup.html"), resolve(root, "dist/popup/popup.html"));
await cp(resolve(root, "src/popup/popup.css"), resolve(root, "dist/popup/popup.css"));
