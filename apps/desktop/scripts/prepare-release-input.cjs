"use strict";

/**
 * Create a reviewed, local-only campus static input for desktop installers.
 *
 * The desktop package deliberately contains a browser client snapshot, never
 * the campus Worker, D1 state, user credentials, or a source checkout. The
 * manifest records the canonical source revision and its dirty state so a
 * release reviewer can tell exactly which static input was packaged.
 */

const {
  cpSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const { basename, dirname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(desktopRoot, "..", "..");
const {
  resolveCampusSource,
  resolveCampusStaticRoot,
} = require(join(workspaceRoot, "scripts", "campus-paths.cjs"));

const RELEASE_INPUT_DIRECTORY_NAME = ".mochi-release-staging.nosync";
const RELEASE_INPUT_MARKER_NAME = ".mochi-release-input-marker";
const RELEASE_INPUT_MARKER_CONTENT = "mochi-release-input-v1\n";
const RELEASE_MANIFEST_NAME = "campus-release-input.json";
const RELEASE_STATIC_RELATIVE_PATH = join("campus-static", "client");
const DEFAULT_RELEASE_INPUT_ROOT = join(desktopRoot, RELEASE_INPUT_DIRECTORY_NAME);
const REQUIRED_STATIC_ASSETS = Object.freeze([
  join("assets", "embed.js"),
  join("assets", "style.css"),
  join("assets", "jxl-campus-watercolor-v1.webp"),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function isWithin(path, ancestor) {
  const rel = relative(ancestor, path);
  // Windows 跨盘符时 relative 返回绝对路径，必然不属于包含关系。
  if (isAbsolute(rel)) return false;
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function isForbiddenCampusArtifact(path) {
  const name = basename(path);
  return name === ".dev.vars" || name.startsWith(".dev.vars.") || name.endsWith(".map");
}

function assertSafeStaticRoot(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`校园静态输入不是目录：${root}`);
  }
  if (lstatSync(root).isSymbolicLink()) {
    throw new Error(`校园静态输入不能是符号链接：${root}`);
  }
}

function staticInventory(staticRoot) {
  const root = resolve(staticRoot);
  assertSafeStaticRoot(root);
  const files = [];

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`校园静态输入不能包含符号链接：${path}`);
      if (stat.isDirectory()) {
        visit(path);
        continue;
      }
      if (!stat.isFile()) throw new Error(`校园静态输入包含非普通文件：${path}`);
      if (isForbiddenCampusArtifact(path)) throw new Error(`校园静态输入包含不应发布的文件：${path}`);
      const pathRelativeToRoot = relative(root, path);
      if (!pathRelativeToRoot || !isWithin(path, root)) throw new Error(`校园静态输入路径越界：${path}`);
      files.push({ path: pathRelativeToRoot.split(sep).join("/"), size: stat.size, sha256: sha256File(path) });
    }
  }

  visit(root);
  const knownPaths = new Set(files.map(({ path }) => path));
  for (const asset of REQUIRED_STATIC_ASSETS) {
    const normalized = asset.split(sep).join("/");
    if (!knownPaths.has(normalized)) {
      throw new Error(`校园静态输入缺少必须资源：${normalized}（输入：${root}）`);
    }
  }
  return files;
}

function temporaryAnchors(env = process.env) {
  // CI runners expose RUNNER_TEMP on a different volume than the Node temp
  // directory (windows-2022: D:\a\_temp vs C:\Users\...\Temp). Both are
  // runner-managed scratch space, so both may host a reviewed staging tree.
  const anchors = new Set([resolve(tmpdir())]);
  const runnerTemp = env.RUNNER_TEMP ?? env.TEMP ?? env.TMP;
  if (typeof runnerTemp === "string" && runnerTemp.trim() !== "") {
    const resolved = resolve(runnerTemp);
    if (existsSync(resolved)) anchors.add(realpathSync(resolved));
  }
  return [...anchors];
}

function outputAnchor(rawOutput, env = process.env) {
  if (rawOutput === DEFAULT_RELEASE_INPUT_ROOT) {
    return { rawAnchor: desktopRoot, realAnchor: realpathSync(desktopRoot) };
  }
  const parent = dirname(rawOutput);
  const isDedicatedStagingName = basename(rawOutput) === RELEASE_INPUT_DIRECTORY_NAME
    && basename(parent).startsWith("mochi-release-input-test-");
  if (isDedicatedStagingName) {
    for (const anchor of temporaryAnchors(env)) {
      if (isWithin(parent, anchor)) {
        return { rawAnchor: anchor, realAnchor: realpathSync(anchor) };
      }
    }
  }
  throw new Error(`拒绝非专用的桌面发布输入目录：${rawOutput}`);
}

function assertNoSymlinkPath(rawAnchor, rawPath, label) {
  if (!isWithin(rawPath, rawAnchor)) throw new Error(`${label}不在受管目录内：${rawPath}`);
  if (lstatSync(rawAnchor).isSymbolicLink()) throw new Error(`${label}的受管目录不能是符号链接：${rawAnchor}`);
  const parts = relative(rawAnchor, rawPath).split(sep).filter(Boolean);
  let current = rawAnchor;
  for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) throw new Error(`${label}不能经过符号链接：${current}`);
  }
}

function canonicalOutputPath(rawOutput, rawAnchor, realAnchor) {
  const ancestor = rawOutput;
  const missing = [];
  let existing = ancestor;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) throw new Error(`无法解析桌面发布输入目录：${rawOutput}`);
    missing.unshift(basename(existing));
    existing = parent;
  }
  const resolvedOutput = resolve(realpathSync(existing), ...missing);
  const expected = resolve(realAnchor, relative(rawAnchor, rawOutput));
  if (resolvedOutput !== expected) throw new Error(`桌面发布输入目录不能通过符号链接改变位置：${rawOutput}`);
  return resolvedOutput;
}

function assertSafeOutputRoot(outputRoot, inputs, env = process.env) {
  const rawOutput = resolve(outputRoot);
  const { rawAnchor, realAnchor } = outputAnchor(rawOutput, env);
  assertNoSymlinkPath(rawAnchor, rawOutput, "桌面发布输入目录");
  const output = canonicalOutputPath(rawOutput, rawAnchor, realAnchor);
  for (const input of inputs) {
    const canonicalInput = realpathSync(input);
    if (isWithin(output, canonicalInput) || isWithin(canonicalInput, output)) {
      throw new Error(`桌面发布输入目录不能覆盖输入：${output}`);
    }
  }
  if (!existsSync(output)) return output;
  const stat = lstatSync(output);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`桌面发布输入目录必须是普通目录：${output}`);
  const marker = join(output, RELEASE_INPUT_MARKER_NAME);
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== RELEASE_INPUT_MARKER_CONTENT) {
    throw new Error(`拒绝清理缺少受管标记的桌面发布输入目录：${output}`);
  }
  return output;
}

function runGit(sourceRoot, args) {
  const result = spawnSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`无法读取校园源码的 Git 元数据：${(result.stderr || result.stdout || "git failed").trim()}`);
  }
  return result.stdout;
}

function sourceMetadata(source) {
  const head = runGit(source.root, ["rev-parse", "HEAD"]).trim();
  const status = runGit(source.root, ["status", "--porcelain=v1", "--untracked-files=normal"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
  const sourcePackage = JSON.parse(readFileSync(join(source.root, "package.json"), "utf8"));
  return {
    kind: source.kind,
    // Do not place an absolute workstation path in a release artifact.
    relativeRoot: relative(workspaceRoot, source.root).split(sep).join("/"),
    git: { head, dirty: status.length > 0, changes: status },
    packageVersion: typeof sourcePackage.version === "string" ? sourcePackage.version : null,
  };
}

function desktopMetadata() {
  const desktopPackage = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
  return {
    name: desktopPackage.name,
    version: desktopPackage.version,
    appId: desktopPackage.build?.appId ?? null,
  };
}

function workingRootFor(output) {
  const working = mkdtempSync(join(dirname(output), ".mochi-release-input-staging-"));
  chmodSync(working, 0o700);
  writeFileSync(join(working, RELEASE_INPUT_MARKER_NAME), RELEASE_INPUT_MARKER_CONTENT, { mode: 0o600 });
  return working;
}

function buildManifest({ source, inventory }) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    desktop: desktopMetadata(),
    source,
    static: {
      relativeRoot: RELEASE_STATIC_RELATIVE_PATH.split(sep).join("/"),
      files: inventory,
      fileCount: inventory.length,
      totalBytes: inventory.reduce((total, file) => total + file.size, 0),
    },
  };
}

function prepareReleaseInput({ outputRoot = DEFAULT_RELEASE_INPUT_ROOT, campusStaticRoot, env = process.env } = {}) {
  const resolvedEnv = { ...env };
  if (campusStaticRoot !== undefined) resolvedEnv.MOCHI_CAMPUS_STATIC_ROOT = campusStaticRoot;
  const source = resolveCampusSource({ workspaceRoot, env: resolvedEnv });
  const staticInput = resolveCampusStaticRoot({ workspaceRoot, env: resolvedEnv });
  const inventory = staticInventory(staticInput.root);
  const output = assertSafeOutputRoot(outputRoot, [source.root, staticInput.root], resolvedEnv);
  const manifest = buildManifest({ source: sourceMetadata(source), inventory });
  const working = workingRootFor(output);
  try {
    const staticOutput = join(working, RELEASE_STATIC_RELATIVE_PATH);
    mkdirSync(dirname(staticOutput), { recursive: true, mode: 0o700 });
    cpSync(staticInput.root, staticOutput, { recursive: true, dereference: false });
    // Re-read the copied tree before publishing it; no success marker is
    // returned until the copy has exactly the hashes that were audited.
    const copiedInventory = staticInventory(staticOutput);
    if (JSON.stringify(copiedInventory) !== JSON.stringify(inventory)) {
      throw new Error("桌面发布输入复制后的静态文件校验不一致。");
    }
    const manifestPath = join(working, RELEASE_MANIFEST_NAME);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    assertSafeOutputRoot(outputRoot, [source.root, staticInput.root], resolvedEnv);
    if (existsSync(output)) rmSync(output, { recursive: true, force: true });
    renameSync(working, output);
    chmodSync(output, 0o700);
    return {
      outputRoot: output,
      staticRoot: join(output, RELEASE_STATIC_RELATIVE_PATH),
      manifestPath: join(output, RELEASE_MANIFEST_NAME),
      manifestSha256: sha256File(join(output, RELEASE_MANIFEST_NAME)),
      source: manifest.source,
      static: manifest.static,
    };
  } catch (error) {
    rmSync(working, { recursive: true, force: true });
    throw error;
  }
}

function assertManifestFileShape(file) {
  if (!file || typeof file.path !== "string" || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.sha256 !== "string") {
    throw new Error("发布输入清单含无效文件记录。");
  }
  if (!file.path || isAbsolute(file.path) || file.path.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new Error("发布输入清单含不安全文件记录。");
  }
}

function verifyReleaseInput({ inputRoot = DEFAULT_RELEASE_INPUT_ROOT, expectedManifestSha256 } = {}) {
  const root = resolve(inputRoot);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error(`桌面发布输入目录不可用：${root}`);
  }
  const marker = join(root, RELEASE_INPUT_MARKER_NAME);
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== RELEASE_INPUT_MARKER_CONTENT) {
    throw new Error(`桌面发布输入缺少受管标记：${root}`);
  }
  const manifestPath = join(root, RELEASE_MANIFEST_NAME);
  if (!existsSync(manifestPath)) throw new Error(`桌面发布输入缺少清单：${manifestPath}`);
  const manifestSha256 = sha256File(manifestPath);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256) {
    throw new Error(`桌面发布输入清单哈希不匹配：期望 ${expectedManifestSha256}，实际 ${manifestSha256}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.schemaVersion !== 1 || !manifest.static || manifest.static.relativeRoot !== RELEASE_STATIC_RELATIVE_PATH.split(sep).join("/")) {
    throw new Error("桌面发布输入清单版本或静态根目录不受支持。");
  }
  if (!Array.isArray(manifest.static.files)) throw new Error("桌面发布输入清单缺少静态文件列表。");
  for (const file of manifest.static.files) assertManifestFileShape(file);
  const staticRoot = join(root, RELEASE_STATIC_RELATIVE_PATH);
  const actual = staticInventory(staticRoot);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.static.files)) {
    throw new Error("桌面发布输入静态文件与清单哈希不一致。");
  }
  return { inputRoot: root, staticRoot, manifest, manifestPath, manifestSha256 };
}

function readCliValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 需要一个值。`);
  return value;
}

function runCli(argv = process.argv.slice(2)) {
  const campusStaticRoot = readCliValue(argv, "--campus-static-root");
  if (argv.some((argument) => argument !== "--campus-static-root" && argument !== campusStaticRoot)) {
    throw new Error("仅支持 --campus-static-root <client-directory>。发布输入始终写入受管本地目录。");
  }
  const result = prepareReleaseInput({ campusStaticRoot });
  process.stdout.write(`${JSON.stringify({ outputRoot: result.outputRoot, staticRoot: result.staticRoot, manifestSha256: result.manifestSha256, source: { kind: result.source.kind, git: { head: result.source.git.head, dirty: result.source.git.dirty } }, static: { fileCount: result.static.fileCount, totalBytes: result.static.totalBytes } })}\n`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`[mochi] 无法准备桌面发布输入：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_RELEASE_INPUT_ROOT,
  RELEASE_INPUT_DIRECTORY_NAME,
  RELEASE_INPUT_MARKER_CONTENT,
  RELEASE_INPUT_MARKER_NAME,
  RELEASE_MANIFEST_NAME,
  RELEASE_STATIC_RELATIVE_PATH,
  REQUIRED_STATIC_ASSETS,
  prepareReleaseInput,
  sha256File,
  staticInventory,
  verifyReleaseInput,
};
