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
const { createHash } = require("node:crypto");
const { createRequire, isBuiltin } = require("node:module");
const { tmpdir } = require("node:os");
const { basename, dirname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(desktopRoot, "..", "..");
const { resolveCampusStaticRoot } = require(join(workspaceRoot, "scripts", "campus-paths.cjs"));
const STAGING_DIRECTORY_NAME = ".mochi-package-resources-v1.nosync";
const STAGING_MARKER_NAME = ".mochi-package-resource-marker";
const STAGING_MARKER_CONTENT = "mochi-package-resources-v1\n";
const DEFAULT_OUTPUT_ROOT = join(desktopRoot, STAGING_DIRECTORY_NAME);
const SIDEBAR_PACKAGE_ROOT = join(workspaceRoot, "plugins", "dsh-better-sidebar");
const TEACHER_PRESET_SOURCE_ROOT = join(workspaceRoot, "client-plugins", "teacher-agent-presets");
const KNOWLEDGE_IMPORTER_SOURCE = join(workspaceRoot, "plugins", "mochi-knowledge", "scripts", "install-textbook-snapshot.mjs");
const TEACHER_PRESET_IDS = Object.freeze([
  "lesson-planning",
  "materials-assessment",
  "grade-analysis",
  "classroom-coordination",
]);
const PLAYWRIGHT_BROWSER_RESOURCE_ENV = "MOCHI_PLAYWRIGHT_BROWSER_RESOURCE_ROOT";
const PLAYWRIGHT_VERSION = "1.55.0";
const PLAYWRIGHT_CHROMIUM_REVISION = "1187";
const PLAYWRIGHT_CHROMIUM_VERSION = "140.0.7339.16";

/**
 * 浏览器资源根**允许出现的顶层条目**，一个不多一个不少。
 *
 * 为什么必须校验（2026-09-19 实测）：`stageMochiResources` 对资源根走的是
 * **无过滤的整目录拷贝**（`copyDirectory(sourceRoot, …/playwright)`）。本机曾经把
 * 一个「hold 目录」放在资源根**里面**再传进去，于是那一轮把整个 hold 又拷了一份
 * 进包；下一轮再从这份已膨胀的资源里取 hold —— **每打一次包就多嵌一层**。
 * 出事时 `.mochi-package-resources-v1.nosync/playwright` 里嵌着
 * `mochi-pw-hold-20260912`（1.0 GB），安装包从 733 MB 涨到 1.18 GB，
 * 而**没有任何一步报错**：除了体积和装包时间，症状完全沉默。
 *
 * CI 侧是在 `RUNNER_TEMP` 里现建一个干净目录（`browsers/` + 四个声明文件），
 * 所以这条严格校验对 CI 恒成立。
 */
const PLAYWRIGHT_BROWSER_RESOURCE_ENTRIES = Object.freeze([
  "LICENSE",
  "browsers",
  "credits.html",
  "credits.txt",
  "metadata.json",
]);

/**
 * 随包**运行时载荷**的排除规则 —— 只管打包，**不删磁盘上的任何文件**。
 * 覆盖面 = `resources/mochi/node_modules`（逐包复制）、插件的整目录拷贝（如
 * `dsh-better-sidebar/lib`）、以及 electron-builder 那条 `app.asar.unpacked` 路径
 * （后者由 `apps/desktop/package.json` 的 `build.files` 负向模式管）。
 *
 * 为什么必须排除（2026-09-12 用 7za 对已出 Windows 包逐文件称重）：
 * 老师反馈「点了安装向导之后慢得离谱」。根因不是包大，而是**安装要往磁盘上
 * 新建 41,150 个文件**：Windows Defender 实时防护逐个扫描新建文件（每个 10~50ms），
 * 累计就是十几分钟。本机实测（M 系列芯片）把这 41,150 个文件完整解开要 28.5 秒，
 * 老师的笔记本 CPU 更弱，只会更久。**慢的是文件数，不是体积。**
 *
 * 下面两类文件运行时永远不会被加载：
 *   - `*.map`                           源码映射，只有 DevTools / 调试器读
 *   - `*.d.ts` / `*.d.mts` / `*.d.cts`  TypeScript 类型声明，编译期产物
 * 实测合计 12,775 个文件 / 235.5MB 原始 / 41.9MB 压缩，占全包文件数的 31.0%
 * （另有 `dsh-better-sidebar/lib` 的 6 个 `.map`，30.9MB 原始 / 6.9MB 压缩）。
 *
 * 明确**不排除**的：`LICENSE` / `NOTICE` / `README`（合规与溯源文件）、
 * `test`/`demo`/`docs` 目录（全包合计才 ~900 个文件，不值得为它冒
 * 「误伤某个库的运行时代码」的风险 —— 这条是量出来的，不是猜的）。
 *
 * ⚠️ 改这里必须同步改 `apps/desktop/package.json` 的 `build.files` 负向模式，
 * 规则必须完全一致；`test-installer-config.mjs` 会断言两边没有漂移，
 * 并断言这些模式在 electron-builder 的 `getNodeModuleFileMatcher` 上**真的生效**。
 */
const PACKAGED_RUNTIME_PAYLOAD_EXCLUDED_FILE = /(?:\.map|\.d\.ts|\.d\.mts|\.d\.cts)$/i;

/** `cpSync` 的 filter 回调签名是 `(source, destination)`。 */
function isExcludedFromPackagedRuntimePayload(source) {
  return PACKAGED_RUNTIME_PAYLOAD_EXCLUDED_FILE.test(String(source));
}

function packagedRuntimePayloadFilter() {
  return (source) => !isExcludedFromPackagedRuntimePayload(source);
}

const PLUGINS = Object.freeze([
  { id: "mochi-hello", source: "plugins/mochi-hello", files: ["index.mjs", "doctor.mjs", "work-quality.mjs", "work-quality.md", "package.json"] },
  { id: "mochi-dispatch", source: "plugins/mochi-dispatch", files: ["index.mjs", "lan-transport.mjs", "store.mjs", "state-machine.mjs", "package.json"] },
  { id: "mochi-campus", source: "plugins/mochi-campus", files: ["index.mjs", "connection.mjs", "package.json"] },
  { id: "mochi-approval", source: "apps/desktop/electron/dsh/mochi-approval", files: ["index.mjs", "package.json"] },
  { id: "jxl-theme", source: "client-plugins/jxl-theme", files: ["index.mjs", "client.js", "package.json"], directories: ["assets"] },
  { id: "jxl-brand", source: "client-plugins/jxl-brand", files: ["index.mjs", "client.js", "package.json"] },
  { id: "jxl-campus", source: "client-plugins/jxl-campus", files: ["index.mjs", "client.js", "static-root.mjs", "package.json"] },
  { id: "mochi-model-presets", source: "client-plugins/mochi-model-presets", files: ["index.mjs", "client.js", "package.json"] },
  {
    id: "mochi-lan",
    source: "plugins/mochi-lan",
    files: ["index.mjs", "host-bridge.mjs", "lan-service.mjs", "package.json"],
  },
  {
    id: "mochi-lan-client",
    source: "client-plugins/mochi-lan",
    files: ["index.mjs", "client.js", "package.json"],
  },
  { id: "mochi-web-search", source: "plugins/mochi-web-search", files: ["index.mjs", "package.json"] },
  { id: "mochi-knowledge", source: "plugins/mochi-knowledge", files: ["index.mjs", "knowledge-store.mjs", "knowledge-host-bridge.mjs", "knowledge-page-image.mjs", "package.json"] },
  { id: "mochi-llm-mimo", source: "plugins/mochi-llm-mimo", files: ["index.mjs", "package.json"] },
  // Teacher productivity plugins registered in runtime-profile.json on
  // 2026-09-07. `plugin.mjs` is the package `main` for the two dsh-tools
  // plugins rewritten as dispatch plugins; `index.mjs` is still imported by
  // them, so both entries ship.
  {
    id: "mochi-grades",
    source: "plugins/mochi-grades",
    files: ["index.mjs", "plugin.mjs", "sheet-read.mjs", "package.json"],
  },
  {
    id: "mochi-presentations",
    source: "plugins/mochi-presentations",
    files: ["index.mjs", "plugin.mjs", "render.mjs", "process-layout.mjs", "package.json"],
    // 设计规范：模型在生成课件前必须读到，缺了它就只能凭"感觉"排版。
    directories: ["references"],
  },
  {
    id: "mochi-documents",
    source: "plugins/mochi-documents",
    files: ["index.mjs", "document-io.mjs", "plugin.mjs", "package.json"],
  },
  // 文件与表格：老师日常最常用的两族工具。白名单外的源文件不会被暂存。
  {
    id: "mochi-files",
    source: "plugins/mochi-files",
    files: ["index.mjs", "handlers.mjs", "paths.mjs", "package.json"],
  },
  {
    id: "mochi-sheets",
    source: "plugins/mochi-sheets",
    files: [
      "index.mjs",
      "paths.mjs",
      "address.mjs",
      "sheet-read.mjs",
      "sheet-write.mjs",
      "formula.mjs",
      "recalc.mjs",
      "tools.mjs",
      "package.json",
    ],
  },
  // 图片编辑与自动绘制：复用运行时闭包内已有的 @napi-rs/canvas，零新增依赖。
  {
    id: "mochi-visuals",
    source: "plugins/mochi-visuals",
    files: [
      "plugin.mjs",
      "tools.mjs",
      "paths.mjs",
      "image-meta.mjs",
      "image-ops.mjs",
      "diagram.mjs",
      "raster.mjs",
      "fonts.mjs",
      "textbook.mjs",
      "package.json",
    ],
  },
  // 对话界面 / 工作界面：默认收窄工具面省 token，老师确认后解禁。
  {
    id: "mochi-modes",
    source: "plugins/mochi-modes",
    files: ["index.mjs", "modes.mjs", "package.json"],
  },
  {
    id: "mochi-modes-client",
    source: "client-plugins/mochi-modes",
    files: ["index.mjs", "client.js", "package.json"],
  },
  {
    id: "mochi-modeling",
    source: "plugins/mochi-modeling",
    files: ["index.mjs", "conic.mjs", "verify.mjs", "package.json"],
    // JSXGraph is vendored locally on purpose: the generated teaching models
    // must render with zero external network access.
    directories: ["assets"],
  },
  {
    id: "mochi-memory",
    source: "plugins/mochi-memory",
    files: ["index.mjs", "active-context.mjs", "world-state.mjs", "mem-store.mjs", "package.json"],
  },
  // 定时任务：本机 SQLite 持久化 + 进程内定时器。全部源码文件必须在 files
  // 里逐个列出——白名单之外的源文件不会被暂存，安装包里就是缺文件的插件。
  {
    id: "mochi-task-scheduler",
    source: "plugins/mochi-task-scheduler",
    files: ["index.mjs", "store.mjs", "scheduler.mjs", "schedule-time.mjs", "tools.mjs", "package.json"],
  },
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

// These packages are imported by the teacher-production plugins and the
// knowledge-page renderer. Their ordinary dependency trees are copied from
// the reviewed desktop install below; keeping only these roots explicit
// avoids broad node_modules staging.
const ADDITIONAL_RUNTIME_ENTRY_VERSIONS = Object.freeze({
  exceljs: "4.4.0",
  pptxgenjs: "4.0.1",
  "@mochi/pdf-layout": "0.1.0",
  jszip: "3.10.1",
  docx: "9.7.1",
  // Knowledge-page rendering stays inside the same staged physical dependency tree.
  "pdfjs-dist": "6.3.289",
  "@napi-rs/canvas": "1.0.8",
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

/**
 * 反向守卫：排除规则一旦失效（cpSync 的 filter 被改掉、或有人换回复制方式），
 * 那 12,775 个文件会静默回到安装包里 —— 体积和文件数悄悄涨回去，没有任何报错。
 * 所以复制完必须回读确认，而不是相信 filter 一定生效。
 */
function assertNoExcludedRuntimePayloadFiles(root) {
  let leaked = 0;
  let sample = "";
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (isExcludedFromPackagedRuntimePayload(path)) {
        leaked += 1;
        if (!sample) sample = path;
      }
    }
  };
  walk(root);
  if (leaked > 0) {
    throw new Error(
      `随包运行时载荷里仍有 ${leaked} 个不应打包的文件（例：${sample}）。`
      + "排除规则没有生效，安装包文件数会白涨回 4 万，装机会重新变慢。",
    );
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function playwrightBrowserResourceRoot(env) {
  const requested = env[PLAYWRIGHT_BROWSER_RESOURCE_ENV];
  if (typeof requested !== "string" || !requested) {
    throw new Error(`打包必须设置 ${PLAYWRIGHT_BROWSER_RESOURCE_ENV} 指向已审核的 Playwright 浏览器资源。`);
  }
  if (!isAbsolute(requested)) throw new Error(`${PLAYWRIGHT_BROWSER_RESOURCE_ENV} 必须是绝对路径。`);
  const root = resolve(requested);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error(`Playwright 浏览器资源根目录不可用：${root}`);
  }
  assertBrowserResourceLayout(root);
  return root;
}

/**
 * Reject a browser resource root that carries anything but the declared payload.
 *
 * The copy that follows is unfiltered, so an extra entry is not a warning —
 * it is dead weight in every installer built from this root, and nesting
 * accumulates once a bloated root is held and passed in again.
 */
function assertBrowserResourceLayout(sourceRoot) {
  const unexpected = readdirSync(sourceRoot).filter(
    (entry) => !PLAYWRIGHT_BROWSER_RESOURCE_ENTRIES.includes(entry),
  );
  if (unexpected.length === 0) return;
  const sample = unexpected.slice(0, 3).join("、");
  throw new Error(
    `Playwright 浏览器资源根只允许 ${PLAYWRIGHT_BROWSER_RESOURCE_ENTRIES.join("、")}，`
    + `但发现 ${unexpected.length} 个多余条目（例：${sample}）：${sourceRoot}。`
    + "打包对该目录走无过滤的整目录拷贝，多余条目会被原样打进安装包，"
    + "显著增大体积与安装时间且不会报错；请把资源放到一个干净目录后再指向它。",
  );
}

function requiredRegularFile(path, label) {
  requiredPath(path, label);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label}必须是普通文件：${path}`);
  return path;
}

function playwrightCoreMetadata() {
  const packagePath = requiredRegularFile(join(desktopRoot, "node_modules", "playwright-core", "package.json"), "Playwright Core 清单");
  const packageManifest = JSON.parse(readFileSync(packagePath, "utf8"));
  if (packageManifest.version !== PLAYWRIGHT_VERSION) {
    throw new Error(`Playwright Core 版本为 ${packageManifest.version}，预期 ${PLAYWRIGHT_VERSION}。`);
  }
  const browsersPath = requiredRegularFile(join(desktopRoot, "node_modules", "playwright-core", "browsers.json"), "Playwright 浏览器清单");
  const browsers = JSON.parse(readFileSync(browsersPath, "utf8")).browsers;
  const chromium = Array.isArray(browsers) ? browsers.find((entry) => entry?.name === "chromium") : undefined;
  const headless = Array.isArray(browsers) ? browsers.find((entry) => entry?.name === "chromium-headless-shell") : undefined;
  for (const entry of [chromium, headless]) {
    if (entry?.revision !== PLAYWRIGHT_CHROMIUM_REVISION || entry?.browserVersion !== PLAYWRIGHT_CHROMIUM_VERSION) {
      throw new Error(`Playwright 浏览器清单不匹配 Chromium ${PLAYWRIGHT_CHROMIUM_REVISION}/${PLAYWRIGHT_CHROMIUM_VERSION}。`);
    }
  }
}

function readPlaywrightBrowserResource(env) {
  const sourceRoot = playwrightBrowserResourceRoot(env);
  playwrightCoreMetadata();
  const metadataPath = requiredRegularFile(join(sourceRoot, "metadata.json"), "Playwright 浏览器元数据");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (
    metadata?.schemaVersion !== 1
    || metadata.playwrightVersion !== PLAYWRIGHT_VERSION
    || metadata.chromiumRevision !== PLAYWRIGHT_CHROMIUM_REVISION
    || metadata.chromiumVersion !== PLAYWRIGHT_CHROMIUM_VERSION
    || typeof metadata.browserExecutable !== "string"
    || !/^[a-f0-9]{64}$/.test(metadata.browserExecutableSha256 ?? "")
  ) {
    throw new Error("Playwright 浏览器元数据版本或可执行文件哈希无效。");
  }

  const browserRoot = requiredPath(join(sourceRoot, "browsers"), "Playwright 浏览器目录");
  const executable = resolve(browserRoot, metadata.browserExecutable);
  if (!isWithin(executable, browserRoot) || executable === browserRoot) {
    throw new Error("Playwright 浏览器可执行文件路径越出受管浏览器目录。");
  }
  requiredRegularFile(executable, "Playwright Chromium 可执行文件");
  if (sha256File(executable) !== metadata.browserExecutableSha256) {
    throw new Error("Playwright Chromium 可执行文件哈希与元数据不一致。");
  }
  for (const directory of [
    `chromium-${PLAYWRIGHT_CHROMIUM_REVISION}`,
    `chromium_headless_shell-${PLAYWRIGHT_CHROMIUM_REVISION}`,
    "ffmpeg-1011",
  ]) {
    requiredRegularFile(join(browserRoot, directory, "INSTALLATION_COMPLETE"), `Playwright ${directory} 安装标记`);
  }
  for (const [file, field] of [["LICENSE", "licenseSha256"], ["credits.html", "creditsHtmlSha256"], ["credits.txt", "creditsTextSha256"]]) {
    const path = requiredRegularFile(join(sourceRoot, file), `Playwright ${file}`);
    if (!/^[a-f0-9]{64}$/.test(metadata[field] ?? "") || sha256File(path) !== metadata[field]) {
      throw new Error(`Playwright ${file} 哈希与元数据不一致。`);
    }
  }
  return { sourceRoot, metadata };
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
  // Windows 跨盘符时 relative 返回绝对路径，必然不属于包含关系。
  if (isAbsolute(rel)) return false;
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function packageRootFromResolution(packageName, importerRoot) {
  const resolved = createRequire(join(importerRoot, "package.json")).resolve(packageName);
  if (isBuiltin(packageName) || isBuiltin(resolved)) return null;

  let current = dirname(resolved);
  while (true) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === packageName) return realpathSync(current);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`无法从 ${importerRoot} 定位运行时包 ${packageName}`);
}

function collectAdditionalRuntimeModules() {
  const desktopNodeModulesRoot = realpathSync(requiredPath(join(desktopRoot, "node_modules"), "桌面运行时 node_modules"));
  const pending = Object.entries(ADDITIONAL_RUNTIME_ENTRY_VERSIONS).map(([packageName, expectedVersion]) => ({
    packageName,
    importerRoot: desktopRoot,
    expectedVersion,
  }));
  const modules = new Map();

  while (pending.length) {
    const { packageName, importerRoot, expectedVersion } = pending.pop();
    // Builder excludes declaration-only packages, and Node resolves these
    // names to builtins even if an upstream manifest redundantly lists them.
    if (packageName.startsWith("@types/") || isBuiltin(packageName)) continue;

    const sourceRoot = packageRootFromResolution(packageName, importerRoot);
    if (!sourceRoot) continue;
    if (!isWithin(sourceRoot, desktopNodeModulesRoot)) {
      throw new Error(`Mochi 附加运行时包不能逃出桌面 node_modules：${packageName} -> ${sourceRoot}`);
    }
    const targetRelative = relative(desktopNodeModulesRoot, sourceRoot);
    if (!targetRelative || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
      throw new Error(`Mochi 附加运行时包目标路径不受管：${packageName} -> ${sourceRoot}`);
    }

    const manifest = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"));
    if (manifest.name !== packageName) {
      throw new Error(`Mochi 附加运行时包名称不匹配：期望 ${packageName}，实际 ${manifest.name}`);
    }
    if (expectedVersion && manifest.version !== expectedVersion) {
      throw new Error(`Mochi 附加运行时包 ${packageName} 版本为 ${manifest.version}，预期 ${expectedVersion}`);
    }

    const existing = modules.get(targetRelative);
    if (existing) {
      if (existing.sourceRoot !== sourceRoot) {
        throw new Error(`Mochi 附加运行时包目标冲突：${targetRelative}`);
      }
      continue;
    }
    modules.set(targetRelative, { packageName, sourceRoot, targetRelative, version: manifest.version });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      pending.push({ packageName: dependency, importerRoot: sourceRoot });
    }
    // Optional native packages are selected by npm for the current platform.
    // Copy only installed selections; unavailable foreign-platform entries stay optional.
    for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
      try {
        packageRootFromResolution(dependency, sourceRoot);
        pending.push({ packageName: dependency, importerRoot: sourceRoot });
      } catch {
        // A missing optional dependency is expected on another platform.
      }
    }
  }

  return [...modules.values()].sort((left, right) => left.targetRelative.localeCompare(right.targetRelative));
}

function assertRuntimeModuleTargetCompatibility(additionalRuntimeModules) {
  const existingModules = PLUGIN_RUNTIME_MODULES.map((packageName) => ({
    packageName,
    sourceRoot: realpathSync(runtimeModuleRoot(packageName)),
    targetRelative: join(...packageName.split("/")),
  }));
  for (const additionalModule of additionalRuntimeModules) {
    for (const existingModule of existingModules) {
      const sameTarget = additionalModule.targetRelative === existingModule.targetRelative;
      const nestedTarget = additionalModule.targetRelative.startsWith(`${existingModule.targetRelative}${sep}`)
        || existingModule.targetRelative.startsWith(`${additionalModule.targetRelative}${sep}`);
      if ((sameTarget || nestedTarget) && additionalModule.sourceRoot !== existingModule.sourceRoot) {
        throw new Error(`Mochi 附加运行时包与既有闭包目标冲突：${additionalModule.targetRelative} <-> ${existingModule.targetRelative}`);
      }
    }
  }
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
    TEACHER_PRESET_SOURCE_ROOT,
    KNOWLEDGE_IMPORTER_SOURCE,
    playwrightBrowserResourceRoot(env),
    ...PLUGINS.map((plugin) => join(workspaceRoot, plugin.source)),
    ...PLUGIN_RUNTIME_MODULES.map(runtimeModuleRoot),
    ...collectAdditionalRuntimeModules().map(({ sourceRoot }) => sourceRoot),
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
  const additionalRuntimeModules = collectAdditionalRuntimeModules();
  const playwrightBrowserResource = readPlaywrightBrowserResource(env);
  assertRuntimeModuleTargetCompatibility(additionalRuntimeModules);

  requiredCampusBuildPath(join(campusClientSource, "assets", "embed.js"), "校园嵌入入口", campusClientSource);
  requiredCampusBuildPath(join(campusClientSource, "assets", "style.css"), "校园嵌入样式", campusClientSource);
  requiredCampusBuildPath(join(campusClientSource, "assets", "jxl-campus-watercolor-v1.webp"), "校园水彩插画", campusClientSource);
  assertNoForbiddenCampusArtifacts(campusClientSource);
  assertRuntimeModuleVersions();

  const working = createWorkingRoot(output);
  try {
    copyDirectory(profileSource, join(working, "profile"));
    copyDirectory(skillsSource, join(working, "skills"));
    copyDirectory(playwrightBrowserResource.sourceRoot, join(working, "playwright"));
    copyDirectory(campusClientSource, join(working, "campus.nosync", "dist", "client"));
    for (const presetId of TEACHER_PRESET_IDS) {
      const presetRoot = join(TEACHER_PRESET_SOURCE_ROOT, presetId);
      requiredPath(join(presetRoot, "preset.yml"), "教师预设元数据");
      requiredPath(join(presetRoot, "agent.cordis.yml"), "教师预设组合");
      copyDirectory(presetRoot, join(working, "teacher-agent-presets", presetId));
    }
    copyFile(KNOWLEDGE_IMPORTER_SOURCE, join(working, "knowledge-import", "install-textbook-snapshot.mjs"));

    for (const plugin of PLUGINS) {
      const sourceRoot = join(workspaceRoot, plugin.source);
      const targetRoot = join(working, "plugins", plugin.id);
      for (const file of plugin.files) copyFile(join(sourceRoot, file), join(targetRoot, file));
      for (const directory of plugin.directories ?? []) {
        copyDirectory(join(sourceRoot, directory), join(targetRoot, directory), packagedRuntimePayloadFilter());
      }
    }

    for (const packageName of PLUGIN_RUNTIME_MODULES) {
      copyDirectory(
        runtimeModuleRoot(packageName),
        join(working, "node_modules", ...packageName.split("/")),
        packagedRuntimePayloadFilter(),
      );
    }
    for (const { sourceRoot, targetRelative } of additionalRuntimeModules) {
      copyDirectory(sourceRoot, join(working, "node_modules", targetRelative), packagedRuntimePayloadFilter());
    }
    // 整棵树回读，不只是 node_modules：插件的整目录拷贝也必须被同一条规则覆盖。
    assertNoExcludedRuntimePayloadFiles(working);

    assertNoSymlinks(working);
    writeFileSync(
      join(working, "package-integrity.json"),
      `${JSON.stringify({ schemaVersion: 1, plugins: PLUGINS.map(({ id }) => id), teacherPresetIds: TEACHER_PRESET_IDS, knowledgeImporter: { relativePath: "knowledge-import/install-textbook-snapshot.mjs", sha256: sha256File(KNOWLEDGE_IMPORTER_SOURCE) }, runtimeModules: PLUGIN_RUNTIME_MODULES, runtimeModuleVersions: PLUGIN_RUNTIME_VERSIONS, additionalRuntimeModules: additionalRuntimeModules.map(({ packageName, targetRelative, version }) => ({ packageName, targetRelative, version })), playwrightBrowser: playwrightBrowserResource.metadata }, null, 2)}\n`,
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
exports.ADDITIONAL_RUNTIME_ENTRY_VERSIONS = ADDITIONAL_RUNTIME_ENTRY_VERSIONS;
exports.PLAYWRIGHT_BROWSER_RESOURCE_ENV = PLAYWRIGHT_BROWSER_RESOURCE_ENV;
exports.PLAYWRIGHT_BROWSER_RESOURCE_ENTRIES = PLAYWRIGHT_BROWSER_RESOURCE_ENTRIES;
exports.assertBrowserResourceLayout = assertBrowserResourceLayout;
exports.PACKAGED_RUNTIME_PAYLOAD_EXCLUDED_FILE = PACKAGED_RUNTIME_PAYLOAD_EXCLUDED_FILE;
exports.isExcludedFromPackagedRuntimePayload = isExcludedFromPackagedRuntimePayload;
exports.TEACHER_PRESET_IDS = TEACHER_PRESET_IDS;
exports.collectAdditionalRuntimeModules = collectAdditionalRuntimeModules;
exports.STAGING_DIRECTORY_NAME = STAGING_DIRECTORY_NAME;
exports.STAGING_MARKER_NAME = STAGING_MARKER_NAME;
exports.STAGING_MARKER_CONTENT = STAGING_MARKER_CONTENT;
exports.default = beforePack;
exports.stageMochiResources = stageMochiResources;
