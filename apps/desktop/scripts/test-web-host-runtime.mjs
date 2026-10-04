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
const originalModules = process.env.MOCHI_RUNTIME_NODE_MODULES;
const root = mkdtempSync(join(tmpdir(), "mochi-web-host-runtime-"));

function setResourcesPath(value) {
  Object.defineProperty(process, "resourcesPath", { configurable: true, value });
}

try {
  delete process.env.MOCHI_RUNTIME_NODE_MODULES;
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
  const modern = join(root,"mochi","node_modules"), core = join(modern,"@deepseek-ai","dsh");
  mkdirSync(join(core,"lib"),{recursive:true});
  writeFileSync(join(core,"lib","bin.js"),"// modern fixture\n");
  writeFileSync(join(core,"package.json"),JSON.stringify({version:"0.2.0-rc.2"}));
  writeFileSync(join(root,"mochi","package-integrity.json"),JSON.stringify({modernRuntime:{coreVersion:"0.2.0-rc.2"}}));
  assert.equal(resolveDshBin(),join(core,"lib","bin.js"));
  assert.equal(managedRuntimeNodeModulesPath(true,"/unused",root),modern,"profile and launch share the same modern physical tree");
  writeFileSync(join(core,"package.json"),JSON.stringify({version:"0.1.3-alpha.1"}));
  assert.throws(()=>resolveDshBin(),/版本不一致/,"a broken modern release must not silently start the old core");
  writeFileSync(join(core,"package.json"),JSON.stringify({version:"0.2.0-rc.2"}));
  process.env.MOCHI_RUNTIME_NODE_MODULES=modern;
  assert.equal(managedRuntimeNodeModulesPath(false,"/unused",root),modern);
  assert.equal(resolveDshBin(),join(core,"lib","bin.js"));
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

  const require = createRequire(import.meta.url);
  const profile = require(join(desktopRoot, "dist-electron", "dsh", "profile.js"));
  const originalPrepare = profile.prepareDshHome;
  const originalDefaults = profile.resolveMochiServiceDefaults;
  const cause = new Error("private configuration detail");
  try {
    profile.resolveMochiServiceDefaults = () => ({});
    profile.prepareDshHome = () => { throw cause; };
    await assert.rejects(new (require(compiled).DshWebHost)("teacher").start(), error => {
      assert.equal(error.code, "WEB_HOST_PROFILE_PREPARATION_FAILED");
      assert.equal(error.cause, cause);
      assert.equal(error.message.includes("private configuration detail"), false);
      return true;
    });
  } finally {
    profile.prepareDshHome = originalPrepare;
    profile.resolveMochiServiceDefaults = originalDefaults;
  }

  console.log("[test-web-host-runtime] PASS: packaged DSH entrypoint and launch arguments are stable.");
} finally {
  if (originalDshBin === undefined) delete process.env.MOCHI_DSH_BIN;
  else process.env.MOCHI_DSH_BIN = originalDshBin;
  if (originalModules === undefined) delete process.env.MOCHI_RUNTIME_NODE_MODULES;
  else process.env.MOCHI_RUNTIME_NODE_MODULES = originalModules;
  if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
  else delete process.resourcesPath;
  rmSync(root, { recursive: true, force: true });
}
