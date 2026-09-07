"use strict";

const { existsSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");

const WORKSPACE_ROOT = resolve(__dirname, "..");
const CANONICAL_CAMPUS_DIRECTORY = "联动计划";
const LEGACY_CAMPUS_DIRECTORY = "campus.nosync";

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function resolveFromWorkspace(workspaceRoot, value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("校园路径环境变量不能为空。");
  if (value.includes("\0")) throw new Error("校园路径不能包含空字节。");
  return resolve(workspaceRoot, value);
}

function resolveWorkspaceRoot({ workspaceRoot, env = process.env } = {}) {
  return resolve(workspaceRoot ?? env.MOCHI_WORKSPACE_ROOT ?? WORKSPACE_ROOT);
}

function isCampusSourceRoot(path) {
  return isDirectory(path) && isDirectory(join(path, "src")) && isFile(join(path, "package.json"));
}

function isCampusStaticRoot(path) {
  return isDirectory(path) && isFile(join(path, "assets", "embed.js"));
}

/**
 * Source precedence is deliberate: an explicit override must be valid rather
 * than silently falling back. In development, the canonical sibling repository
 * wins; the old copy stays a compatibility fallback for existing checkouts.
 */
function resolveCampusSource({ workspaceRoot, env = process.env } = {}) {
  const workspace = resolveWorkspaceRoot({ workspaceRoot, env });
  if (env.MOCHI_CAMPUS_SOURCE_ROOT) {
    const root = resolveFromWorkspace(workspace, env.MOCHI_CAMPUS_SOURCE_ROOT);
    if (!isCampusSourceRoot(root)) {
      throw new Error(`MOCHI_CAMPUS_SOURCE_ROOT 不是可用的校园源码根目录：${root}`);
    }
    return { root, kind: "explicit" };
  }

  const canonical = resolve(workspace, "..", CANONICAL_CAMPUS_DIRECTORY);
  if (isCampusSourceRoot(canonical)) return { root: canonical, kind: "canonical" };

  const legacy = join(workspace, LEGACY_CAMPUS_DIRECTORY);
  if (isCampusSourceRoot(legacy)) return { root: legacy, kind: "legacy" };

  throw new Error(
    `未找到校园源码：请设置 MOCHI_CAMPUS_SOURCE_ROOT，或提供 ${canonical}（canonical）/ ${legacy}（legacy）。`,
  );
}

/**
 * Static serving can run from packaged resources without the campus source
 * checkout. Only if no explicit or packaged static tree is available do we
 * consult the development source resolver.
 */
function resolveCampusStaticRoot({ workspaceRoot, env = process.env, packagedStaticRoot, sourceRoot } = {}) {
  const workspace = resolveWorkspaceRoot({ workspaceRoot, env });
  if (env.MOCHI_CAMPUS_STATIC_ROOT) {
    const root = resolveFromWorkspace(workspace, env.MOCHI_CAMPUS_STATIC_ROOT);
    if (!isCampusStaticRoot(root)) {
      throw new Error(`MOCHI_CAMPUS_STATIC_ROOT 不是含 assets/embed.js 的校园静态目录：${root}`);
    }
    return { root, kind: "explicit" };
  }

  if (packagedStaticRoot) {
    const root = resolveFromWorkspace(workspace, packagedStaticRoot);
    if (isCampusStaticRoot(root)) return { root, kind: "packaged" };
  }

  const developmentSource = sourceRoot ? { root: resolve(workspace, sourceRoot), kind: "provided" } : resolveCampusSource({ workspaceRoot: workspace, env });
  const root = join(developmentSource.root, "mochi-dist", "client");
  if (!isCampusStaticRoot(root)) {
    throw new Error(`校园静态产物不存在或缺少 assets/embed.js：${root}；请运行 pnpm run build:mochi。`);
  }
  return { root, kind: `source:${developmentSource.kind}` };
}

function resolveCampusPaths({ workspaceRoot, env = process.env } = {}) {
  const workspace = resolveWorkspaceRoot({ workspaceRoot, env });
  const source = resolveCampusSource({ workspaceRoot: workspace, env });
  const stateDir = env.MOCHI_CAMPUS_STATE_DIR
    ? resolveFromWorkspace(workspace, env.MOCHI_CAMPUS_STATE_DIR)
    : join(workspace, LEGACY_CAMPUS_DIRECTORY, ".wrangler", "state");
  const staticRoot = resolveCampusStaticRoot({ workspaceRoot: workspace, env, sourceRoot: source.root });

  return Object.freeze({
    workspaceRoot: workspace,
    sourceRoot: source.root,
    sourceKind: source.kind,
    stateDir,
    // This is always the exact static client directory containing assets/embed.js.
    staticRoot: staticRoot.root,
    staticKind: staticRoot.kind,
  });
}

function readArgumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 需要一个值。`);
  return value;
}

function runCli(argv = process.argv.slice(2)) {
  const field = readArgumentValue(argv, "--field");
  if (!field) throw new Error("需要 --field source|source-kind|state|static|workspace。");
  const workspaceRoot = readArgumentValue(argv, "--workspace-root");
  const packagedStaticRoot = readArgumentValue(argv, "--packaged-static-root");
  const paths = field === "static"
    ? { staticRoot: resolveCampusStaticRoot({ workspaceRoot, packagedStaticRoot }).root }
    : resolveCampusPaths({ workspaceRoot });
  const output = {
    source: paths.sourceRoot,
    "source-kind": paths.sourceKind,
    state: paths.stateDir,
    static: paths.staticRoot,
    workspace: paths.workspaceRoot,
  }[field];
  if (!output) throw new Error(`未知校园路径字段：${field}`);
  process.stdout.write(`${output}\n`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CANONICAL_CAMPUS_DIRECTORY,
  LEGACY_CAMPUS_DIRECTORY,
  WORKSPACE_ROOT,
  isCampusStaticRoot,
  isCampusSourceRoot,
  resolveCampusPaths,
  resolveCampusSource,
  resolveCampusStaticRoot,
  resolveWorkspaceRoot,
  runCli,
};
