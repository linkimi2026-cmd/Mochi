#!/usr/bin/env node
/**
 * Covers the packaged-Dsh launch boundary without starting a web server.
 * The compiled host must choose builder's physical DSH entrypoint before the
 * app.asar copy and must expose the loader only for Electron run-as-Node.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const source = join(desktopRoot, "electron", "dsh", "web-host.ts");
const compiled = join(desktopRoot, "dist-electron", "dsh", "web-host.js");

if (!existsSync(compiled) || statSync(compiled).mtimeMs < statSync(source).mtimeMs) {
  throw new Error("web-host 测试需要最新编译输出；请先运行 npm run build");
}

const { buildDshArgs, managedPlaywrightBrowsersPath, managedRuntimeNodeModulesPath, resolveDshBin } = createRequire(import.meta.url)(compiled);
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
const originalDshBin = process.env.MOCHI_DSH_BIN;
const root = mkdtempSync(join(tmpdir(), "mochi-web-host-runtime-"));

function setResourcesPath(value) {
  Object.defineProperty(process, "resourcesPath", { configurable: true, value });
}

try {
  const unpacked = join(root, "app.asar.unpacked", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  mkdirSync(dirname(unpacked), { recursive: true });
  writeFileSync(unpacked, "// fixture only\n");
  setResourcesPath(root);

  assert.equal(
    managedPlaywrightBrowsersPath(true, "/unused-app", root),
    join(root, "mochi", "playwright", "browsers"),
    "packaged DSH must use the physical managed Playwright browser resource",
  );
  assert.equal(
    managedPlaywrightBrowsersPath(false, "/workspace/app", root),
    "/workspace/app/.mochi-package-resources-v1.nosync/playwright/browsers",
    "development DSH must use the staged browser resource instead of a user cache",
  );
  assert.equal(
    managedRuntimeNodeModulesPath(true, "/unused-app", root),
    join(root, "app.asar.unpacked", "node_modules"),
    "packaged shell automation must resolve Node modules from builder's physical unpacked tree",
  );
  assert.equal(
    managedRuntimeNodeModulesPath(false, "/workspace/app", root),
    "/workspace/app/node_modules",
    "development shell automation must resolve from the desktop runtime dependency tree",
  );

  delete process.env.MOCHI_DSH_BIN;
  assert.equal(resolveDshBin(), unpacked, "packaged launch must prefer the physical DSH entrypoint");
  assert.deepEqual(
    buildDshArgs("/fixture/dsh/bin.js", "0", true),
    ["--expose-internals", "/fixture/dsh/bin.js", "--profile", "mochi-web", "--port", "0", "--no-open"],
  );
  assert.deepEqual(
    buildDshArgs("/fixture/dsh/bin.js", "4317", false),
    ["/fixture/dsh/bin.js", "--profile", "mochi-web", "--port", "4317", "--no-open"],
    "an explicit external Node retains its existing launch contract",
  );

  const custom = join(root, "custom-dsh.js");
  writeFileSync(custom, "// fixture only\n");
  process.env.MOCHI_DSH_BIN = custom;
  assert.equal(resolveDshBin(), custom, "MOCHI_DSH_BIN must continue to override the bundled entrypoint");

  console.log("[test-web-host-runtime] PASS: packaged DSH entrypoint and launch arguments are stable.");
} finally {
  if (originalDshBin === undefined) delete process.env.MOCHI_DSH_BIN;
  else process.env.MOCHI_DSH_BIN = originalDshBin;
  if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
  else delete process.resourcesPath;
  rmSync(root, { recursive: true, force: true });
}
