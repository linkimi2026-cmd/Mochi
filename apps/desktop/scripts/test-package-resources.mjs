#!/usr/bin/env node
/**
 * Package-resource integration test. It stages the same directory Electron
 * Builder copies as `extraResources`, provisions real DSH profiles against it,
 * imports each manifest plugin with Node 22, and serves key static assets.
 * No server, campus API, user DSH home, database, or credential is touched.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  ADDITIONAL_RUNTIME_ENTRY_VERSIONS,
  PLAYWRIGHT_BROWSER_RESOURCE_ENV,
  TEACHER_PRESET_IDS,
  collectAdditionalRuntimeModules,
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

function createToolRegistrationContext() {
  const tools = [];
  const ctx = {
    tools: {
      register(tool) {
        tools.push(tool);
        return () => undefined;
      },
      // mochi-modes 在 apply 期就要拿 schemas/restrict 建控制器。根 ctx 上的
      // restrict 官方就是会抛（必须用 agent.ctx），这里照实保留这个语义。
      schemas() {
        return [];
      },
      restrict() {
        throw new Error("tools.restrict() requires a scoped context (agent.ctx)");
      },
    },
    logger: { debug() {}, info() {}, warn() {} },
    on() {
      return () => undefined;
    },
    effect(callback) {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => undefined;
    },
    get() {
      return undefined;
    },
    // mochi-modes 用 ctx.inject 挂命令与 session 投影；这里只保证 apply 不炸，
    // 注册面的细节由插件自己的单测覆盖。
    inject(_services, callback) {
      callback({
        commands: { register() { return () => undefined; } },
        sessionProjections: { register() { return () => undefined; } },
      });
    },
  };
  return { ctx, tools };
}

/**
 * 模型网关只接受 `^[a-zA-Z0-9_-]+$` 的工具名（2026-09-12 实测：带点的
 * `mochi.xxx` / `jxl.xxx` 会被网关以 400 invalid_request_error 直接拒收，整轮会话
 * 都发不出去）。这里在打包期把注册面钉死，任何新工具用了点号/空格/中文都会红。
 */
const MODEL_FACING_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

function assertModelFacingToolNames(toolNames, label) {
  for (const toolName of toolNames) {
    assert.match(
      toolName,
      MODEL_FACING_TOOL_NAME,
      `${label} 注册了网关无法接受的工具名 ${JSON.stringify(toolName)}；`
        + "模型可见的工具名只能由字母、数字、下划线、连字符组成（用 mochi_ppt_create，不要用 mochi.ppt_create）。",
    );
  }
}

function assertPluginToolRegistration(pluginId, plugin, expectedToolNames, applyArguments = []) {
  assert.equal(typeof plugin.apply, "function", `${pluginId} did not expose an apply function`);
  const { ctx, tools } = createToolRegistrationContext();
  plugin.apply(ctx, ...applyArguments);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    expectedToolNames,
    `${pluginId} did not register its expected tools against the staged DSH runtime`,
  );
  assertModelFacingToolNames(tools.map((tool) => tool.name), pluginId);
}

function assertKnowledgeToolRegistration(plugin) {
  assert.equal(typeof plugin.apply, "function", "mochi-knowledge did not expose an apply function");
  const { ctx, tools } = createToolRegistrationContext();
  ctx.inject = (services, callback) => {
    if (Array.isArray(services) && services.length === 1 && services[0] === "attachments") callback(ctx);
  };
  plugin.apply(ctx, {});
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["mochi_knowledge_search", "mochi_knowledge_page", "mochi_knowledge_page_image"].sort(),
    "mochi-knowledge did not register its staged read-only tool surface",
  );
  assertModelFacingToolNames(tools.map((tool) => tool.name), "mochi-knowledge");
}

/**
 * 上面两个断言只覆盖被显式列举的插件。mochi-campus / mochi-dispatch 的注册面依赖
 * 连接与存储桩，不便在这里重放，所以再补一道源码级扫描：任何以 jxl./mochi./message.
 * 开头、带点的字符串字面量都是网关拒收的名字（静态注册与循环里的别名数组一网打尽）。
 */
const DOTTED_TOOL_NAME_LITERAL = /["'`]((?:jxl|mochi|message)\.[a-zA-Z][a-zA-Z0-9_]*)["'`]/g;

function assertNoDottedToolNameLiterals(stagedPluginRoot) {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
        continue;
      }
      if (!/\.(?:mjs|js|cjs|ts)$/.test(entry.name)) continue;
      // 逐行剥掉行尾注释，避免「注释里提到旧名」触发误报。
      const source = readFileSync(full, "utf8")
        .split("\n")
        .map((line) => line.replace(/\s\/\/.*$/, ""))
        .join("\n");
      for (const match of source.matchAll(DOTTED_TOOL_NAME_LITERAL)) {
        offenders.push(`${relative(stagedPluginRoot, full)}: ${match[1]}`);
      }
    }
  };
  walk(stagedPluginRoot);
  assert.deepEqual(
    offenders,
    [],
    "插件里存在带点的工具名（模型网关只接受 [a-zA-Z0-9_-]）：\n  " + offenders.join("\n  "),
  );
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createPlaywrightBrowserResource(root) {
  const browserRoot = join(root, "browsers");
  const executableRelative = join("chromium-1187", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
  const executable = join(browserRoot, executableRelative);
  for (const marker of [
    join(browserRoot, "chromium-1187", "INSTALLATION_COMPLETE"),
    join(browserRoot, "chromium_headless_shell-1187", "INSTALLATION_COMPLETE"),
    join(browserRoot, "ffmpeg-1011", "INSTALLATION_COMPLETE"),
  ]) {
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "");
  }
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, "chromium fixture\n");
  const files = {
    LICENSE: "BSD-3-Clause fixture\n",
    "credits.html": "<html>credits fixture</html>\n",
    "credits.txt": "credits fixture\n",
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  const metadata = {
    schemaVersion: 1,
    playwrightVersion: "1.55.0",
    chromiumRevision: "1187",
    chromiumVersion: "140.0.7339.16",
    browserExecutable: executableRelative.split(sep).join("/"),
    browserExecutableSha256: sha256(readFileSync(executable)),
    licenseSha256: sha256(readFileSync(join(root, "LICENSE"))),
    creditsHtmlSha256: sha256(readFileSync(join(root, "credits.html"))),
    creditsTextSha256: sha256(readFileSync(join(root, "credits.txt"))),
  };
  writeFileSync(join(root, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
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

const EXPECTED_BUNDLED_PLUGIN_COUNT = 26;
const CRITICAL_PLUGIN_ENTRYPOINTS = Object.freeze({
  "mochi-grades": "plugin.mjs",
  "mochi-memory": "index.mjs",
  "mochi-knowledge": "index.mjs",
  "mochi-documents": "plugin.mjs",
  "mochi-task-scheduler": "index.mjs",
  "mochi-files": "index.mjs",
  "mochi-sheets": "index.mjs",
  "mochi-visuals": "plugin.mjs",
  "mochi-modes": "index.mjs",
  "mochi-modes-client": "index.mjs",
});

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
const playwrightBrowserTemporaryRoot = mkdtempSync(join(tmpdir(), "mochi-package-resources-test-playwright-"));
const symlinkedParent = join(tmpdir(), `mochi-package-resources-test-parent-link-${process.pid}-${Date.now()}`);
try {
  const playwrightBrowserMetadata = createPlaywrightBrowserResource(playwrightBrowserTemporaryRoot);
  const stageEnvironment = { ...process.env, [PLAYWRIGHT_BROWSER_RESOURCE_ENV]: playwrightBrowserTemporaryRoot };
  const unmarkedStageRoot = join(unmarkedTemporaryRoot, STAGING_DIRECTORY_NAME);
  mkdirSync(unmarkedStageRoot);
  writeFileSync(join(unmarkedStageRoot, "must-remain.txt"), "unmanaged\n");
  assert.throws(() => stageMochiResources({ outputRoot: unmarkedStageRoot, env: stageEnvironment }), /缺少受管标记/);
  assert.equal(existsSync(join(unmarkedStageRoot, "must-remain.txt")), true, "unmanaged staging directory was changed");
  const campusPackage = join(workspaceRoot, "campus.nosync", "package.json");
  // campus.nosync 只存在于开发机（本地 campus clone），CI 快照不含此目录；
  // 守卫的拒绝语义与存在性无关，存在时才追加「未被改动」校验。
  const campusExisted = existsSync(campusPackage);
  assert.throws(() => stageMochiResources({ outputRoot: join(workspaceRoot, "campus.nosync", STAGING_DIRECTORY_NAME), env: stageEnvironment }), /拒绝非专用|不能覆盖输入资源/);
  if (campusExisted) assert.equal(existsSync(campusPackage), true, "input source was touched by staging validation");

  const symlinkTarget = join(symlinkTargetTemporaryRoot, STAGING_DIRECTORY_NAME);
  mkdirSync(symlinkTarget);
  writeFileSync(join(symlinkTarget, ".mochi-package-resource-marker"), "mochi-package-resources-v1\n");
  writeFileSync(join(symlinkTarget, "must-remain.txt"), "target\n");
  const symlinkOutput = join(symlinkTemporaryRoot, STAGING_DIRECTORY_NAME);
  symlinkSync(symlinkTarget, symlinkOutput, "dir");
  assert.throws(() => stageMochiResources({ outputRoot: symlinkOutput, env: stageEnvironment }), /符号链接/);
  assert.equal(existsSync(join(symlinkTarget, "must-remain.txt")), true, "symlink target was changed by staging validation");

  symlinkSync(parentSymlinkTargetTemporaryRoot, symlinkedParent, "dir");
  assert.throws(() => stageMochiResources({ outputRoot: join(symlinkedParent, STAGING_DIRECTORY_NAME), env: stageEnvironment }), /符号链接/);

  const stageRoot = join(temporaryRoot, STAGING_DIRECTORY_NAME);
  const homeDir = join(temporaryRoot, "dsh-home");
  const staged = stageMochiResources({ outputRoot: stageRoot, env: stageEnvironment });

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
      ...stageEnvironment,
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
  const expectedAdditionalRuntimeModules = collectAdditionalRuntimeModules().map(({ packageName, targetRelative, version }) => ({ packageName, targetRelative, version }));
  assert.deepEqual(stagedIntegrity.additionalRuntimeModules, expectedAdditionalRuntimeModules);
  assert.deepEqual(stagedIntegrity.playwrightBrowser, playwrightBrowserMetadata, "Playwright browser metadata must be recorded with package resources");
  assert.ok(expectedAdditionalRuntimeModules.length >= Object.keys(ADDITIONAL_RUNTIME_ENTRY_VERSIONS).length, "additional runtime closure omitted an entry package");
  assert.equal(readFileSync(join(stageRoot, STAGING_MARKER_NAME), "utf8"), STAGING_MARKER_CONTENT, "packaged static-root marker is missing");
  assert.equal(existsSync(join(stageRoot, "playwright", "browsers", "chromium-1187", "INSTALLATION_COMPLETE")), true, "staged Chromium resource is missing");
  assert.equal(existsSync(join(stageRoot, "playwright", "LICENSE")), true, "staged Chromium license is missing");
  const knowledgeImporterSource = join(workspaceRoot, "plugins", "mochi-knowledge", "scripts", "install-textbook-snapshot.mjs");
  const knowledgeImporterTarget = join(stageRoot, "knowledge-import", "install-textbook-snapshot.mjs");
  assert.equal(existsSync(knowledgeImporterTarget), true, "private textbook importer is missing from packaged resources");
  assert.deepEqual(
    stagedIntegrity.knowledgeImporter,
    {
      relativePath: "knowledge-import/install-textbook-snapshot.mjs",
      sha256: createHash("sha256").update(readFileSync(knowledgeImporterSource)).digest("hex"),
    },
    "private textbook importer integrity must identify the staged script",
  );
  assert.equal(
    readFileSync(knowledgeImporterTarget, "utf8"),
    readFileSync(knowledgeImporterSource, "utf8"),
    "private textbook importer must be copied byte-for-byte",
  );

  const profilePluginIds = new Set(Object.values(profileManifest.profiles).flatMap((profile) => profile.plugins));
  assert.equal(PLUGINS.length, EXPECTED_BUNDLED_PLUGIN_COUNT, `packaged plugin whitelist must contain all ${EXPECTED_BUNDLED_PLUGIN_COUNT} runtime plugins`);
  assert.deepEqual([...profilePluginIds].sort(), PLUGINS.map(({ id }) => id).sort());
  assert.equal(profilePluginIds.size, EXPECTED_BUNDLED_PLUGIN_COUNT, `runtime profile must require exactly ${EXPECTED_BUNDLED_PLUGIN_COUNT} bundled plugins`);
  for (const plugin of PLUGINS) {
    for (const file of plugin.files) {
      assert.equal(existsSync(join(stageRoot, "plugins", plugin.id, file)), true, `${plugin.id}/${file} was not staged`);
    }
  }
  for (const packageName of PLUGIN_RUNTIME_MODULES) {
    assert.equal(existsSync(join(stageRoot, "node_modules", ...packageName.split("/"), "package.json")), true, `${packageName} was not staged`);
  }
  for (const { packageName, targetRelative, version } of expectedAdditionalRuntimeModules) {
    const manifestPath = join(stageRoot, "node_modules", targetRelative, "package.json");
    assert.equal(existsSync(manifestPath), true, `${packageName} was not staged at ${targetRelative}`);
    assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).version, version, `${packageName} staged a different version`);
  }
  for (const packageName of MIMO_ADAPTER_RUNTIME_MODULES) {
    assert.equal(PLUGIN_RUNTIME_MODULES.includes(packageName), true, `${packageName} is required by the staged MIMO adapter`);
    assert.equal(existsSync(join(stageRoot, "node_modules", ...packageName.split("/"), "package.json")), true, `${packageName} was not staged for the MIMO adapter`);
  }
  assertNoSymlinks(join(stageRoot, "plugins"));
  assertNoSymlinks(join(stageRoot, "teacher-agent-presets"));
  assert.deepEqual(stagedIntegrity.teacherPresetIds, TEACHER_PRESET_IDS, "teacher preset roster must be recorded in package integrity");
  for (const presetId of TEACHER_PRESET_IDS) {
    const presetRoot = join(stageRoot, "teacher-agent-presets", presetId);
    assert.equal(existsSync(join(presetRoot, "preset.yml")), true, `${presetId} metadata was not staged`);
    assert.equal(existsSync(join(presetRoot, "agent.cordis.yml")), true, `${presetId} composition was not staged`);
  }
  assert.equal(existsSync(join(stageRoot, "teacher-agent-presets", "test")), false, "teacher preset tests must not be discoverable as a packaged preset");
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
    runtimeNodeModulesRoot: join(desktopRoot, "node_modules"),
    role: "teacher",
  });
  assert.deepEqual(provisioned.profiles.sort(), ["headless", "mochi", "mochi-web"]);
  assert.equal(provisioned.role, "teacher");
  assert.equal(JSON.parse(readFileSync(join(homeDir, ".mochi-runtime-role.json"), "utf8")).role, "teacher");
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

  const knowledgeResolutionProbe = join(stageRoot, "plugins", "mochi-knowledge", "package-resolution.mjs");
  writeFileSync(
    knowledgeResolutionProbe,
    "console.log(JSON.stringify([import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'), import.meta.resolve('@napi-rs/canvas')]))\n",
  );
  const knowledgeResolution = spawnSync(process.execPath, [knowledgeResolutionProbe], {
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
  assert.equal(knowledgeResolution.status, 0, knowledgeResolution.stderr);
  assert.deepEqual(
    JSON.parse(knowledgeResolution.stdout),
    [
      pathToFileURL(realpathSync(join(stageRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"))).href,
      pathToFileURL(realpathSync(join(stageRoot, "node_modules", "@napi-rs", "canvas", "index.js"))).href,
    ],
    "mochi-knowledge resolved renderer dependencies from outside packaged resources",
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
      const pluginRoot = join(stageRoot, "plugins", plugin.id);
      const entrypoint = pluginEntrypoint(pluginRoot, plugin.id);
      const expectedEntrypoint = CRITICAL_PLUGIN_ENTRYPOINTS[plugin.id];
      if (expectedEntrypoint) {
        assert.equal(relative(pluginRoot, entrypoint), expectedEntrypoint, `${plugin.id} must import its staged runtime entrypoint`);
      }
      modules[plugin.id] = await import(pathToFileURL(entrypoint).href);
      assert.equal(modules[plugin.id].name, plugin.id, `${plugin.id} did not expose its plugin name`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(profileManifest.profiles["mochi-web"].plugins.includes("dsh-better-sidebar"), "mochi-web profile omitted dsh-better-sidebar");
  assert.ok(profileManifest.profiles["mochi-web"].plugins.includes("mochi-lan"), "mochi-web profile omitted LAN host");
  assert.ok(profileManifest.profiles["mochi-web"].plugins.includes("mochi-lan-client"), "mochi-web profile omitted LAN client");
  assert.equal(typeof modules["mochi-lan"].apply, "function", "mochi-lan did not expose its host entry");
  assert.equal(typeof modules["mochi-lan-client"].apply, "function", "mochi-lan-client did not expose its client entry");
  const stagedLanClient = JSON.parse(readFileSync(join(stageRoot, "plugins", "mochi-lan-client", "package.json"), "utf8"));
  assert.equal(stagedLanClient.dsh.client.platform, "web", "LAN client package lost its web entry metadata");
  assert.equal(existsSync(join(stageRoot, "plugins", "mochi-lan-client", "client.js")), true, "LAN client browser entry was not staged");
  const teacherPatch = readFileSync(join(homeDir, "profiles", "mochi-web", "cordis.patch.yml"), "utf8");
  assert.ok(teacherPatch.includes(JSON.stringify(join(stageRoot, "teacher-agent-presets"))), "teacher profile omitted its staged preset root");
  // 2026-09-12 用户裁定：教师端只保留「创造模式」。底座自带的 标准/PTC/极简 三项
  // 是编程向预设，不能出现在老师的预设选择器里。上游 roots 没有逐条排除能力，
  // 所以生成器改落一份只含 cordis 的可见根，root 指向它而不是原始安装目录。
  const visiblePresetRoot = join(homeDir, "presets-visible");
  assert.ok(teacherPatch.includes(JSON.stringify(visiblePresetRoot)), "teacher profile omitted the filtered visible preset root");
  assert.equal(
    teacherPatch.includes(JSON.stringify(join(desktopRoot, "node_modules", "@deepseek-ai", "dsh-agent-presets", "presets"))),
    false,
    "teacher profile must not point at the raw installed preset root (it would re-expose 标准/PTC/极简)",
  );
  assert.equal(existsSync(join(visiblePresetRoot, "cordis", "preset.yml")), true, "创造模式 preset was not materialized into the visible preset root");
  for (const hidden of ["standard", "ptc", "minimal"]) {
    assert.equal(existsSync(join(visiblePresetRoot, hidden)), false, `hidden coding preset ${hidden} leaked into the teacher-visible preset root`);
  }
  assert.equal(typeof modules["dsh-better-sidebar"].apply, "function", "dsh-better-sidebar did not expose its real server entry");
  assert.match(
    readFileSync(join(stageRoot, "plugins", "dsh-better-sidebar", "cordis.patch.yml"), "utf8"),
    /id: better-sidebar[\s\S]+name: 'dsh-better-sidebar'/,
    "dsh-better-sidebar bundle mount was not staged",
  );

  assertPluginToolRegistration("mochi-grades", modules["mochi-grades"], ["mochi_grade_analyze"]);
  assertPluginToolRegistration("mochi-modeling", modules["mochi-modeling"], ["mochi_model_create"]);
  assertPluginToolRegistration(
    "mochi-memory",
    modules["mochi-memory"],
    [
      "mochi_memory_note",
      "mochi_memory_recall",
      "mochi_memory_forget",
      "mochi_memory_list",
      "mochi_memory_world",
      "mochi_memory_clear",
    ],
    [{}, {}],
  );
  assertPluginToolRegistration(
    "mochi-presentations",
    modules["mochi-presentations"],
    ["mochi_ppt_create", "mochi_ppt_revise", "ppt_inspect", "mochi_ppt_render"],
  );
  assertPluginToolRegistration(
    "mochi-documents",
    modules["mochi-documents"],
    ["mochi_document_create", "doc_create", "doc_read", "doc_edit", "doc_export", "pdf_read"],
  );
  assertPluginToolRegistration(
    "mochi-files",
    modules["mochi-files"],
    ["file_search", "file_read", "file_copy", "file_move", "file_rename", "file_create_folder"],
  );
  assertPluginToolRegistration(
    "mochi-sheets",
    modules["mochi-sheets"],
    ["spreadsheet_read", "spreadsheet_create", "spreadsheet_export", "spreadsheet_formula"],
  );
  assertPluginToolRegistration(
    "mochi-visuals",
    modules["mochi-visuals"],
    ["image_find", "image_edit", "diagram_draw", "teaching_image_match"],
  );
  assertPluginToolRegistration("mochi-modes", modules["mochi-modes"], ["mochi_request_work_mode"]);
  // 客户端半边不注册工具，但必须能在打包产物里被解析到（否则模式开关永远不出现）。
  assertPluginToolRegistration("mochi-modes-client", modules["mochi-modes-client"], []);
  assertKnowledgeToolRegistration(modules["mochi-knowledge"]);
  // 覆盖 mochi-campus / mochi-dispatch 等未在此重放注册面的插件。
  assertNoDottedToolNameLiterals(join(stageRoot, "plugins"));

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

  console.log(`package resource test passed: ${PLUGINS.length} plugins, ${PLUGIN_RUNTIME_MODULES.length} DSH modules, ${expectedAdditionalRuntimeModules.length} additional modules, staged static client assets`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
  rmSync(unmarkedTemporaryRoot, { recursive: true, force: true });
  rmSync(symlinkTemporaryRoot, { recursive: true, force: true });
  rmSync(symlinkTargetTemporaryRoot, { recursive: true, force: true });
  rmSync(symlinkedParent, { recursive: true, force: true });
  rmSync(parentSymlinkTargetTemporaryRoot, { recursive: true, force: true });
  rmSync(explicitStaticTemporaryRoot, { recursive: true, force: true });
  rmSync(playwrightBrowserTemporaryRoot, { recursive: true, force: true });
}
