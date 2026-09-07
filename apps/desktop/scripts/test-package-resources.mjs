#!/usr/bin/env node
/**
 * Package-resource integration test. It stages the same directory Electron
 * Builder copies as `extraResources`, provisions real DSH profiles against it,
 * imports each manifest plugin with Node 22, and serves key static assets.
 * No server, campus API, user DSH home, database, or credential is touched.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { finished } from "node:stream/promises";
import { Writable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const requireFromHere = createRequire(import.meta.url);
const {
  PLUGINS,
  PLUGIN_RUNTIME_MODULES,
  PLUGIN_RUNTIME_VERSIONS,
  STAGING_DIRECTORY_NAME,
  STAGING_MARKER_NAME,
  STAGING_MARKER_CONTENT,
  stageMochiResources,
} = requireFromHere(join(scriptDir, "prepare-mochi-resources.cjs"));

class CaptureResponse extends Writable {
  constructor() {
    super();
    this.statusCode = undefined;
    this.headers = {};
    this.chunks = [];
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return this;
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}

function allFiles(root) {
  const entries = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) entries.push(...allFiles(path));
    else entries.push(path);
  }
  return entries;
}

function assertNoSymlinks(root) {
  for (const path of allFiles(root)) {
    assert.equal(lstatSync(path).isSymbolicLink(), false, `staged resource still links outside package: ${path}`);
  }
}

function createRouteContext() {
  const routes = [];
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route);
        return () => undefined;
      },
    },
    effect(callback) {
      return callback();
    },
    on() {},
    logger: { debug() {}, info() {} },
  };
  return { ctx, routes };
}

async function requestRoute(route, url) {
  const response = new CaptureResponse();
  const done = finished(response);
  route.handler({ method: "GET", url, headers: {} }, response);
  await done;
  return { statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(response.chunks) };
}

function assertStaticTree(staticRoot) {
  for (const path of allFiles(staticRoot)) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    assert.notEqual(base, ".dev.vars", `secret-like campus build file was staged: ${path}`);
    assert.equal(base.startsWith(".dev.vars."), false, `secret-like campus build file was staged: ${path}`);
    assert.equal(base.endsWith(".map"), false, `source map was staged: ${path}`);
  }
}

function pluginEntrypoint(pluginRoot, pluginId) {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  const main = manifest.main ?? "index.mjs";
  assert.equal(typeof main, "string", `${pluginId} package.json must declare a string main entry`);
  const entry = resolve(pluginRoot, main);
  const pathFromPlugin = relative(pluginRoot, entry);
  assert.equal(
    pathFromPlugin === "" || pathFromPlugin === ".." || pathFromPlugin.startsWith(`..${sep}`) || isAbsolute(pathFromPlugin),
    false,
    `${pluginId} main entry escapes its package root`,
  );
  assert.equal(existsSync(entry), true, `${pluginId} main entry was not staged: ${main}`);
  return entry;
}

const MIMO_ADAPTER_RUNTIME_MODULES = [
  "@deepseek-ai/dsh-llm-deepseek",
  "@deepseek-ai/dsh-atomic-write",
  "@deepseek-ai/dsh-attachment",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-home-paths",
  "@deepseek-ai/dsh-launch-environment",
  "eventsource-parser",
];

const temporaryRoot = mkdtempSync(join(tmpdir(), "mochi-package-resources-test-"));
const unmarkedTemporaryRoot = mkdtempSync(join(tmpdir(), "mochi-package-resources-test-unmarked-"));
const symlinkTemporaryRoot = mkdtempSync(join(tmpdir(), "mochi-package-resources-test-symlink-"));
const symlinkTargetTemporaryRoot = mkdtempSync(join(tmpdir(), "mochi-package-resources-test-target-"));
const parentSymlinkTargetTemporaryRoot = mkdtempSync(join(tmpdir(), "mochi-package-resources-test-parent-target-"));
const explicitStaticTemporaryRoot = mkdtempSync(join(tmpdir(), "mochi-package-resources-test-explicit-static-"));
const symlinkedParent = join(tmpdir(), `mochi-package-resources-test-parent-link-${process.pid}-${Date.now()}`);
try {
  const unmarkedStageRoot = join(unmarkedTemporaryRoot, STAGING_DIRECTORY_NAME);
  mkdirSync(unmarkedStageRoot);
  writeFileSync(join(unmarkedStageRoot, "must-remain.txt"), "unmanaged\n");
  assert.throws(() => stageMochiResources({ outputRoot: unmarkedStageRoot }), /缺少受管标记/);
  assert.equal(existsSync(join(unmarkedStageRoot, "must-remain.txt")), true, "unmanaged staging directory was changed");
  const campusPackage = join(workspaceRoot, "campus.nosync", "package.json");
  assert.throws(() => stageMochiResources({ outputRoot: join(workspaceRoot, "campus.nosync", STAGING_DIRECTORY_NAME) }), /拒绝非专用|不能覆盖输入资源/);
  assert.equal(existsSync(campusPackage), true, "input source was touched by staging validation");

  const symlinkTarget = join(symlinkTargetTemporaryRoot, STAGING_DIRECTORY_NAME);
  mkdirSync(symlinkTarget);
  writeFileSync(join(symlinkTarget, ".mochi-package-resource-marker"), "mochi-package-resources-v1\n");
  writeFileSync(join(symlinkTarget, "must-remain.txt"), "target\n");
  const symlinkOutput = join(symlinkTemporaryRoot, STAGING_DIRECTORY_NAME);
  symlinkSync(symlinkTarget, symlinkOutput, "dir");
  assert.throws(() => stageMochiResources({ outputRoot: symlinkOutput }), /符号链接/);
  assert.equal(existsSync(join(symlinkTarget, "must-remain.txt")), true, "symlink target was changed by staging validation");

  symlinkSync(parentSymlinkTargetTemporaryRoot, symlinkedParent, "dir");
  assert.throws(() => stageMochiResources({ outputRoot: join(symlinkedParent, STAGING_DIRECTORY_NAME) }), /符号链接/);

  const stageRoot = join(temporaryRoot, STAGING_DIRECTORY_NAME);
  const homeDir = join(temporaryRoot, "dsh-home");
  const staged = stageMochiResources({ outputRoot: stageRoot });

  // A release job receives only the reviewed static artifact. It must not need
  // a canonical source checkout merely because the normal development resolver
  // happens to find one on a contributor's machine.
  const explicitClientRoot = join(explicitStaticTemporaryRoot, "client");
  const explicitAssets = join(explicitClientRoot, "assets");
  mkdirSync(explicitAssets, { recursive: true });
  writeFileSync(join(explicitAssets, "embed.js"), "export const releaseArtifact = true;\n");
  writeFileSync(join(explicitAssets, "style.css"), ".release-artifact { color: #123456; }\n");
  writeFileSync(join(explicitAssets, "jxl-campus-watercolor-v1.webp"), "release-artifact-image\n");
  const explicitStageRoot = join(explicitStaticTemporaryRoot, STAGING_DIRECTORY_NAME);
  stageMochiResources({
    outputRoot: explicitStageRoot,
    env: {
      ...process.env,
      MOCHI_CAMPUS_STATIC_ROOT: explicitClientRoot,
      // Deliberately invalid: this proves static packaging does not resolve a
      // source checkout when an explicit reviewed static client is supplied.
      MOCHI_CAMPUS_SOURCE_ROOT: join(explicitStaticTemporaryRoot, "missing-campus-source"),
    },
  });
  assert.equal(
    readFileSync(join(explicitStageRoot, "campus.nosync", "dist", "client", "assets", "embed.js"), "utf8"),
    "export const releaseArtifact = true;\n",
    "explicit static release input was not used",
  );

  const desktopPackage = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
  const profileManifest = JSON.parse(readFileSync(join(stageRoot, "profile", "runtime-profile.json"), "utf8"));
  const stagedIntegrity = JSON.parse(readFileSync(join(stageRoot, "package-integrity.json"), "utf8"));

  assert.equal(desktopPackage.build.beforePack, "./scripts/prepare-mochi-resources.cjs");
  assert.deepEqual(desktopPackage.build.extraResources, [{ from: STAGING_DIRECTORY_NAME, to: "mochi" }]);
  assert.equal(desktopPackage.dependencies["better-sqlite3"], undefined, "legacy migration database must not be a production dependency");
  assert.equal(desktopPackage.devDependencies["better-sqlite3"], "^11.10.0", "legacy migration database remains available to its test");
  assert.equal(desktopPackage.build.asarUnpack.includes("node_modules/better-sqlite3/**/*"), false, "legacy migration database must not be shipped in app.asar.unpacked");
  assert.deepEqual(staged.plugins, PLUGINS.map(({ id }) => id));
  assert.deepEqual(stagedIntegrity.plugins, PLUGINS.map(({ id }) => id));
  assert.deepEqual(stagedIntegrity.runtimeModules, PLUGIN_RUNTIME_MODULES);
  assert.deepEqual(stagedIntegrity.runtimeModuleVersions, PLUGIN_RUNTIME_VERSIONS);
  assert.equal(readFileSync(join(stageRoot, STAGING_MARKER_NAME), "utf8"), STAGING_MARKER_CONTENT, "packaged static-root marker is missing");

  const profilePluginIds = new Set(Object.values(profileManifest.profiles).flatMap((profile) => profile.plugins));
  assert.deepEqual([...profilePluginIds].sort(), PLUGINS.map(({ id }) => id).sort());
  assert.equal(profilePluginIds.size, 12, "runtime profile must require exactly twelve bundled plugins");
  for (const plugin of PLUGINS) {
    for (const file of plugin.files) {
      assert.equal(existsSync(join(stageRoot, "plugins", plugin.id, file)), true, `${plugin.id}/${file} was not staged`);
    }
  }
  for (const packageName of PLUGIN_RUNTIME_MODULES) {
    assert.equal(existsSync(join(stageRoot, "node_modules", ...packageName.split("/"), "package.json")), true, `${packageName} was not staged`);
  }
  for (const packageName of MIMO_ADAPTER_RUNTIME_MODULES) {
    assert.equal(PLUGIN_RUNTIME_MODULES.includes(packageName), true, `${packageName} is required by the staged MIMO adapter`);
    assert.equal(existsSync(join(stageRoot, "node_modules", ...packageName.split("/"), "package.json")), true, `${packageName} was not staged for the MIMO adapter`);
  }
  assertNoSymlinks(join(stageRoot, "plugins"));
  assertStaticTree(join(stageRoot, "campus.nosync", "dist", "client"));
  for (const file of [
    "assets/embed.js",
    "assets/style.css",
    "assets/jxl-campus-watercolor-v1.webp",
    "assets/jxl-campus-watercolor-v1.png",
  ]) {
    assert.equal(existsSync(join(stageRoot, "campus.nosync", "dist", "client", file)), true, `campus client asset missing: ${file}`);
  }
  for (const file of [
    "assets/mochi-loading.json",
    "assets/brand/jiaxing-jellyfish-v1.png",
    "assets/campus/jxl-campus-watercolor-v1.webp",
  ]) {
    assert.equal(existsSync(join(stageRoot, "plugins", "jxl-theme", file)), true, `theme asset missing: ${file}`);
  }

  const runtime = requireFromHere(join(stageRoot, "profile", "runtime-profile.cjs"));
  const provisioned = runtime.provisionMochiProfiles({
    homeDir,
    resourceRoot: join(stageRoot, "profile"),
    skillsDir: join(stageRoot, "skills"),
    pluginRoot: join(stageRoot, "plugins"),
  });
  assert.deepEqual(provisioned.profiles.sort(), ["headless", "mochi", "mochi-web"]);
  for (const [profileName, profile] of Object.entries(profileManifest.profiles)) {
    for (const pluginId of profile.plugins) {
      const link = join(homeDir, "profiles", profileName, "node_modules", pluginId);
      assert.equal(lstatSync(link).isSymbolicLink(), true, `${profileName}/${pluginId} was not provisioned as a link`);
      assert.ok(realpathSync(link).startsWith(realpathSync(join(stageRoot, "plugins"))), `${profileName}/${pluginId} points outside staged resources`);
    }
  }

  const resolutionProbe = join(stageRoot, "plugins", "mochi-campus", "package-resolution.mjs");
  writeFileSync(resolutionProbe, "console.log(import.meta.resolve('@deepseek-ai/dsh-tools'))\n");
  const resolution = spawnSync(process.execPath, [resolutionProbe], {
    cwd: temporaryRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      HOME: temporaryRoot,
      DSH_HOME: homeDir,
      NODE_PATH: "",
    },
  });
  assert.equal(resolution.status, 0, resolution.stderr);
  assert.equal(
    resolution.stdout.trim(),
    pathToFileURL(realpathSync(join(stageRoot, "node_modules", "@deepseek-ai", "dsh-tools", "lib", "index.js"))).href,
    "external plugin resolved dsh-tools from outside packaged resources",
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("package resource test must not make a network request");
  };
  const modules = {};
  try {
    const stagedMimoAdapter = await import(pathToFileURL(join(stageRoot, "node_modules", "@deepseek-ai", "dsh-llm-deepseek", "lib", "index.js")).href);
    assert.equal(typeof stagedMimoAdapter.DeepSeekAdapter, "function", "staged MIMO adapter entry did not load");
    for (const plugin of PLUGINS) {
      modules[plugin.id] = await import(pathToFileURL(pluginEntrypoint(join(stageRoot, "plugins", plugin.id), plugin.id)).href);
      assert.equal(modules[plugin.id].name, plugin.id, `${plugin.id} did not expose its plugin name`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(profileManifest.profiles["mochi-web"].plugins.includes("dsh-better-sidebar"), "mochi-web profile omitted dsh-better-sidebar");
  assert.equal(typeof modules["dsh-better-sidebar"].apply, "function", "dsh-better-sidebar did not expose its real server entry");
  assert.match(
    readFileSync(join(stageRoot, "plugins", "dsh-better-sidebar", "cordis.patch.yml"), "utf8"),
    /id: better-sidebar[\s\S]+name: 'dsh-better-sidebar'/,
    "dsh-better-sidebar bundle mount was not staged",
  );

  const campusRoutes = createRouteContext();
  modules["jxl-campus"].apply(campusRoutes.ctx);
  const campusStatic = campusRoutes.routes.find((route) => route.path === "/campus");
  const legacyCampusStatic = campusRoutes.routes.find((route) => route.path === "/assets/campus");
  assert.ok(campusStatic && legacyCampusStatic, "jxl-campus did not register both static routes");
  const embed = await requestRoute(campusStatic, "/campus/assets/embed.js");
  assert.equal(embed.statusCode, 200);
  assert.match(String(embed.headers["content-type"]), /text\/javascript/);
  assert.ok(embed.body.length > 100, "campus embed bundle is empty");
  const watercolor = await requestRoute(campusStatic, "/campus/assets/jxl-campus-watercolor-v1.webp");
  assert.equal(watercolor.statusCode, 200);
  assert.equal(watercolor.headers["content-type"], "image/webp");
  assert.ok(watercolor.body.length > 100, "campus watercolor illustration is empty");
  const campusScene = await requestRoute(legacyCampusStatic, "/assets/campus/painterly/runtime/v2/teaching-building-exterior-v2.webp");
  assert.equal(campusScene.statusCode, 200);
  assert.equal(campusScene.headers["content-type"], "image/webp");
  assert.ok(campusScene.body.length > 100, "campus scene illustration is empty");

  const themeRoutes = createRouteContext();
  modules["jxl-theme"].apply(themeRoutes.ctx);
  const themeStatic = themeRoutes.routes.find((route) => route.path === "/jxl-assets");
  assert.ok(themeStatic, "jxl-theme did not register the asset route");
  const logo = await requestRoute(themeStatic, "/jxl-assets/brand/jiaxing-jellyfish-v1.png");
  assert.equal(logo.statusCode, 200);
  assert.equal(logo.headers["content-type"], "image/png");
  assert.ok(logo.body.length > 100, "Mochi brand illustration is empty");

  console.log(`package resource test passed: ${PLUGINS.length} plugins, ${PLUGIN_RUNTIME_MODULES.length} runtime modules, staged static client assets`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
  rmSync(unmarkedTemporaryRoot, { recursive: true, force: true });
  rmSync(symlinkTemporaryRoot, { recursive: true, force: true });
  rmSync(symlinkTargetTemporaryRoot, { recursive: true, force: true });
  rmSync(symlinkedParent, { recursive: true, force: true });
  rmSync(parentSymlinkTargetTemporaryRoot, { recursive: true, force: true });
  rmSync(explicitStaticTemporaryRoot, { recursive: true, force: true });
}
