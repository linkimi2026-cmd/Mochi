"use strict";

/**
 * Assemble the non-asar Mochi runtime tree used by Electron Builder.
 *
 * The profile provisioner links plugins from `resources/mochi/plugins`, so
 * external plugins cannot rely on `app.asar/node_modules` resolution. This
 * script creates one self-contained resource root before every package build.
 * It deliberately copies only the dedicated Mochi browser build
 * (`mochi-dist/client`), not
 * the campus Worker, local D1 data, credentials, or source node_modules.
 * When campus source changes, run `pnpm run build:mochi` first. This step
 * checks that a build exists but does not claim an existing artifact is fresh.
 */

const {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { createRequire } = require("node:module");
const { tmpdir } = require("node:os");
const { basename, dirname, join, relative, resolve, sep } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(desktopRoot, "..", "..");
const { resolveCampusStaticRoot } = require(join(workspaceRoot, "scripts", "campus-paths.cjs"));
const STAGING_DIRECTORY_NAME = ".mochi-package-resources-v1.nosync";
const STAGING_MARKER_NAME = ".mochi-package-resource-marker";
const STAGING_MARKER_CONTENT = "mochi-package-resources-v1\n";
const DEFAULT_OUTPUT_ROOT = join(desktopRoot, STAGING_DIRECTORY_NAME);
const SIDEBAR_PACKAGE_ROOT = join(workspaceRoot, "plugins", "dsh-better-sidebar");

const PLUGINS = Object.freeze([
  { id: "mochi-hello", source: "plugins/mochi-hello", files: ["index.mjs", "package.json"] },
  { id: "mochi-dispatch", source: "plugins/mochi-dispatch", files: ["index.mjs", "store.mjs", "state-machine.mjs", "package.json"] },
  { id: "mochi-campus", source: "plugins/mochi-campus", files: ["index.mjs", "connection.mjs", "package.json"] },
  { id: "mochi-approval", source: "apps/desktop/electron/dsh/mochi-approval", files: ["index.mjs", "package.json"] },
  { id: "jxl-theme", source: "client-plugins/jxl-theme", files: ["index.mjs", "client.js", "package.json"], directories: ["assets"] },
  { id: "jxl-brand", source: "client-plugins/jxl-brand", files: ["index.mjs", "client.js", "package.json"] },
  { id: "jxl-campus", source: "client-plugins/jxl-campus", files: ["index.mjs", "client.js", "static-root.mjs", "package.json"] },
  { id: "mochi-workbench", source: "client-plugins/mochi-workbench", files: ["index.mjs", "client.js", "package.json"] },
  { id: "mochi-model-presets", source: "client-plugins/mochi-model-presets", files: ["index.mjs", "client.js", "package.json"] },
  { id: "mochi-web-search", source: "plugins/mochi-web-search", files: ["index.mjs", "package.json"] },
  { id: "mochi-llm-mimo", source: "plugins/mochi-llm-mimo", files: ["index.mjs", "package.json"] },
  // dsh-better-sidebar is the only bundled plugin carrying its own
  // `dsh.bundle.patch`: the cordis.patch.yml below is what actually mounts the
  // plugin row (id `better-sidebar`). Shipping the built lib/ without it would
  // stage a plugin that never loads. Its lib/*.js entries are prebundled except
  // for `ws` (see PLUGIN_RUNTIME_MODULES); node-pty resolves lazily behind a
  // try/catch in ensureSpawnHelper, so it is deliberately not staged here.
  {
    id: "dsh-better-sidebar",
    source: "plugins/dsh-better-sidebar",
    files: ["package.json", "dsh.plugin.json", "cordis.patch.yml"],
    directories: ["lib"],
  },
]);

// This is the reviewed ESM import closure for the staged Mochi plugins under
// the pinned Harness version. It is intentionally JavaScript-only: native app
// dependencies stay under Electron Builder's normal asarUnpack/rebuild path,
// rather than being copied from the build machine into plugin resources.
const PLUGIN_RUNTIME_MODULES = Object.freeze([
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/cordis",
  "@deepseek-ai/schemastery",
  "@deepseek-ai/dsh-scope",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-util-values",
  "@deepseek-ai/dsh-brand",
  "@deepseek-ai/dsh-typert-protocol",
  "@deepseek-ai/dsh-util-crypto",
  "@deepseek-ai/dsh-timeout",
  "@deepseek-ai/cosmokit",
  "@standard-schema/spec",
  "zod",
  "ws",
  "@deepseek-ai/dsh-settings",
  "@deepseek-ai/dsh-subagent",
  "@deepseek-ai/dsh-llm-deepseek",
  "@deepseek-ai/dsh-anonymous-user-id",
  // The published 0.1.2-rc.1 metadata omits several static imports present in
  // dsh-llm-deepseek/lib/index.js. Package the actual ESM closure so the
  // external Mochi plugin does not fall back to a development node_modules.
  "@deepseek-ai/dsh-atomic-write",
  "@deepseek-ai/dsh-attachment",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-home-paths",
  "@deepseek-ai/dsh-launch-environment",
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-util-time",
  "eventsource-parser",
  // dsh-better-sidebar's server entry imports the unscoped package pair from
  // its pinned, already-installed plugin dependency graph.
  "schemastery",
  "cosmokit",
]);

// When updating @deepseek-ai/dsh, update this reviewed entry closure and its
// versions together, then run `npm run test:package-resources` with Node 22.
// A version mismatch is intentionally a hard failure instead of silently
// reusing a closure that may no longer match the published ESM imports.
const PLUGIN_RUNTIME_VERSIONS = Object.freeze({
  "@deepseek-ai/dsh-tools": "0.1.3-alpha.1",
  "@deepseek-ai/cordis": "4.0.2",
  "@deepseek-ai/schemastery": "3.18.2",
  "@deepseek-ai/dsh-scope": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-llm": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-util-values": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-brand": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-typert-protocol": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-util-crypto": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-timeout": "0.1.3-alpha.1",
  "@deepseek-ai/cosmokit": "1.8.3",
  "@standard-schema/spec": "1.1.0",
  zod: "4.5.4",
  // Required by dsh-better-sidebar's server entry (WebSocket / WebSocketServer
  // for the terminal and editor transports).
  ws: "8.21.3",
  // Statically imported by dsh-better-sidebar/lib/index.js.
  "@deepseek-ai/dsh-settings": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-subagent": "0.1.3-alpha.1",
  // Statically imported by plugins/mochi-llm-mimo/index.mjs.
  "@deepseek-ai/dsh-llm-deepseek": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-anonymous-user-id": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-atomic-write": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-attachment": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-credentials": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-home-paths": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-launch-environment": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-agent": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-session": "0.1.3-alpha.1",
  "@deepseek-ai/dsh-util-time": "0.1.3-alpha.1",
  "eventsource-parser": "3.1.1",
  schemastery: "3.18.0",
  cosmokit: "1.8.1",
});

function requiredPath(path, label) {
  if (!existsSync(path)) throw new Error(`${label}不存在：${path}`);
  return path;
}

function runtimeModuleRoot(packageName) {
  const desktopPackageRoot = join(desktopRoot, "node_modules", ...packageName.split("/"));
  if (existsSync(join(desktopPackageRoot, "package.json"))) return desktopPackageRoot;

  const sidebarRequire = createRequire(join(SIDEBAR_PACKAGE_ROOT, "package.json"));
  if (packageName === "schemastery") {
    return dirname(sidebarRequire.resolve("schemastery/package.json"));
  }
  if (packageName === "cosmokit") {
    const schemasteryManifest = sidebarRequire.resolve("schemastery/package.json");
    return dirname(createRequire(schemasteryManifest).resolve("cosmokit/package.json"));
  }
  throw new Error(`Mochi 运行时模块不存在：${packageName}`);
}

function requiredCampusBuildPath(path, label, campusStaticRoot) {
  if (!existsSync(path)) {
    throw new Error(`${label}不存在：${path}。请先生成完整的校园 \`mochi-dist/client\`，或将 MOCHI_CAMPUS_STATIC_ROOT 指向完整静态产物（当前：${campusStaticRoot}）；桌面打包只复用该静态产物。`);
  }
  return path;
}

function copyFile(source, destination) {
  requiredPath(source, "Mochi 打包文件");
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { dereference: true });
}

function copyDirectory(source, destination, filter) {
  requiredPath(source, "Mochi 打包目录");
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: filter ?? (() => true),
  });
}

function isForbiddenCampusArtifact(path) {
  const name = basename(path);
  return name === ".dev.vars" || name.startsWith(".dev.vars.") || name.endsWith(".map");
}

function assertNoForbiddenCampusArtifacts(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      assertNoForbiddenCampusArtifacts(path);
      continue;
    }
    if (isForbiddenCampusArtifact(path)) {
      throw new Error(`校园静态构建含不应打包的文件：${path}`);
    }
  }
}

function assertNoSymlinks(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Mochi 资源不能引用工作区链接：${path}`);
    if (stat.isDirectory()) assertNoSymlinks(path);
  }
}

function canonicalPath(path) {
  const missing = [];
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error(`无法解析 Mochi 打包路径：${path}`);
    missing.unshift(basename(current));
    current = parent;
  }
  return resolve(realpathSync(current), ...missing);
}

function isWithin(path, ancestor) {
  const rel = relative(ancestor, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function assertPathHasNoSymlinksBelow(rawAnchor, rawPath, label) {
  const relativePath = relative(rawAnchor, rawPath);
  if (!isWithin(rawPath, rawAnchor)) {
    throw new Error(`${label}不在受管父目录内：${rawPath}`);
  }

  let current = rawAnchor;
  for (const part of relativePath ? relativePath.split(sep) : []) {
    current = join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label}不能经过符号链接：${current}`);
    }
  }

  if (lstatSync(rawAnchor).isSymbolicLink()) {
    throw new Error(`${label}的受管父目录不能是符号链接：${rawAnchor}`);
  }
}

function outputAnchor(rawOutput) {
  if (rawOutput === DEFAULT_OUTPUT_ROOT) {
    return { rawAnchor: desktopRoot, realAnchor: realpathSync(desktopRoot) };
  }

  // Keep the raw temporary-directory spelling for the lexical boundary, then
  // compare its resolved counterpart below. On macOS this safely permits the
  // /var to /private/var alias without permitting a link under that boundary.
  const rawTemporaryRoot = resolve(tmpdir());
  const parent = dirname(rawOutput);
  if (
    basename(rawOutput) === STAGING_DIRECTORY_NAME
    && isWithin(parent, rawTemporaryRoot)
    && basename(parent).startsWith("mochi-package-resources-test-")
  ) {
    return { rawAnchor: rawTemporaryRoot, realAnchor: realpathSync(rawTemporaryRoot) };
  }
  throw new Error(`拒绝非专用的 Mochi 打包目录：${rawOutput}`);
}

function sourceRoots(env = process.env) {
  const { root: staticRoot } = resolveCampusStaticRoot({ workspaceRoot, env });
  return [
    join(desktopRoot, "resources", "mochi-web"),
    join(workspaceRoot, "skills"),
    staticRoot,
    ...PLUGINS.map((plugin) => join(workspaceRoot, plugin.source)),
    ...PLUGIN_RUNTIME_MODULES.map(runtimeModuleRoot),
  ].map((path) => canonicalPath(path));
}

function assertSafeOutputRoot(outputRoot, env = process.env) {
  const rawOutput = resolve(outputRoot);
  const { rawAnchor, realAnchor } = outputAnchor(rawOutput);
  assertPathHasNoSymlinksBelow(rawAnchor, rawOutput, "Mochi 打包目录");

  const output = canonicalPath(rawOutput);
  const expectedCanonicalOutput = resolve(realAnchor, relative(rawAnchor, rawOutput));
  if (output !== expectedCanonicalOutput) {
    throw new Error(`Mochi 打包目录不能通过符号链接改变位置：${rawOutput}`);
  }
  for (const input of sourceRoots(env)) {
    if (isWithin(output, input) || isWithin(input, output)) {
      throw new Error(`Mochi 打包目录不能覆盖输入资源：${output}`);
    }
  }
  if (!existsSync(output)) return output;
  const stat = lstatSync(output);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Mochi 打包目录必须是受管普通目录：${output}`);
  }
  const markerPath = join(output, STAGING_MARKER_NAME);
  if (!existsSync(markerPath) || readFileSync(markerPath, "utf8") !== STAGING_MARKER_CONTENT) {
    throw new Error(`拒绝清理缺少受管标记的 Mochi 打包目录：${output}`);
  }
  return output;
}

function assertRuntimeModuleVersions() {
  for (const packageName of PLUGIN_RUNTIME_MODULES) {
    const packagePath = join(runtimeModuleRoot(packageName), "package.json");
    const actual = JSON.parse(readFileSync(requiredPath(packagePath, "Mochi 运行时模块"), "utf8")).version;
    const expected = PLUGIN_RUNTIME_VERSIONS[packageName];
    if (actual !== expected) {
      throw new Error(`Mochi 运行时模块 ${packageName} 版本为 ${actual}，预期 ${expected}；请审查并更新资源闭包。`);
    }
  }
}

function createWorkingRoot(output) {
  const root = mkdtempSync(join(dirname(output), ".mochi-package-resources-staging-"));
  writeFileSync(join(root, STAGING_MARKER_NAME), STAGING_MARKER_CONTENT);
  return root;
}

function stageMochiResources({ outputRoot = DEFAULT_OUTPUT_ROOT, env = process.env } = {}) {
  const rawOutput = resolve(outputRoot);
  const output = assertSafeOutputRoot(rawOutput, env);
  const profileSource = join(desktopRoot, "resources", "mochi-web");
  const skillsSource = join(workspaceRoot, "skills");
  // Packaging only needs the already-built static client. Resolving it directly
  // lets a native CI runner consume a reviewed release artifact without also
  // cloning the canonical Worker/source repository or its local state.
  const campusStatic = resolveCampusStaticRoot({ workspaceRoot, env });
  const campusClientSource = campusStatic.root;

  requiredCampusBuildPath(join(campusClientSource, "assets", "embed.js"), "校园嵌入入口", campusClientSource);
  requiredCampusBuildPath(join(campusClientSource, "assets", "style.css"), "校园嵌入样式", campusClientSource);
  requiredCampusBuildPath(join(campusClientSource, "assets", "jxl-campus-watercolor-v1.webp"), "校园水彩插画", campusClientSource);
  assertNoForbiddenCampusArtifacts(campusClientSource);
  assertRuntimeModuleVersions();

  const working = createWorkingRoot(output);
  try {
    copyDirectory(profileSource, join(working, "profile"));
    copyDirectory(skillsSource, join(working, "skills"));
    copyDirectory(campusClientSource, join(working, "campus.nosync", "dist", "client"));

    for (const plugin of PLUGINS) {
      const sourceRoot = join(workspaceRoot, plugin.source);
      const targetRoot = join(working, "plugins", plugin.id);
      for (const file of plugin.files) copyFile(join(sourceRoot, file), join(targetRoot, file));
      for (const directory of plugin.directories ?? []) {
        copyDirectory(join(sourceRoot, directory), join(targetRoot, directory));
      }
    }

    for (const packageName of PLUGIN_RUNTIME_MODULES) {
      copyDirectory(
        runtimeModuleRoot(packageName),
        join(working, "node_modules", ...packageName.split("/")),
      );
    }

    assertNoSymlinks(working);
    writeFileSync(
      join(working, "package-integrity.json"),
      `${JSON.stringify({ schemaVersion: 1, plugins: PLUGINS.map(({ id }) => id), runtimeModules: PLUGIN_RUNTIME_MODULES, runtimeModuleVersions: PLUGIN_RUNTIME_VERSIONS }, null, 2)}\n`,
    );

    // The old tree is only removed after every input has been validated and a
    // complete replacement exists. Recheck the marker immediately before the
    // destructive step so a path swap cannot target an arbitrary directory.
    assertSafeOutputRoot(rawOutput, env);
    if (existsSync(output)) rmSync(output, { recursive: true, force: true });
    renameSync(working, output);
    return { outputRoot: output, plugins: PLUGINS.map(({ id }) => id), runtimeModules: [...PLUGIN_RUNTIME_MODULES] };
  } catch (error) {
    rmSync(working, { recursive: true, force: true });
    throw error;
  }
}

async function beforePack() {
  stageMochiResources();
}

if (require.main === module) {
  try {
    const result = stageMochiResources();
    console.log(`[mochi] 已准备 ${result.plugins.length} 个插件、${result.runtimeModules.length} 个运行时模块资源`);
  } catch (error) {
    console.error(`[mochi] 无法准备打包资源：${error.message}`);
    process.exitCode = 1;
  }
}

exports.DEFAULT_OUTPUT_ROOT = DEFAULT_OUTPUT_ROOT;
exports.PLUGINS = PLUGINS;
exports.PLUGIN_RUNTIME_MODULES = PLUGIN_RUNTIME_MODULES;
exports.PLUGIN_RUNTIME_VERSIONS = PLUGIN_RUNTIME_VERSIONS;
exports.STAGING_DIRECTORY_NAME = STAGING_DIRECTORY_NAME;
exports.STAGING_MARKER_NAME = STAGING_MARKER_NAME;
exports.STAGING_MARKER_CONTENT = STAGING_MARKER_CONTENT;
exports.default = beforePack;
exports.stageMochiResources = stageMochiResources;
