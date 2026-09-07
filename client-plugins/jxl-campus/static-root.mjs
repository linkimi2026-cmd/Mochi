/**
 * Resolve the campus browser bundle without conflating development source with
 * packaged resources. A packaged plugin has no campus source checkout, so it
 * may only use the adjacent static tree when the resource-root marker proves
 * Electron Builder copied the managed Mochi resource tree.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_RESOURCE_MARKER = ".mochi-package-resource-marker";
export const PACKAGE_RESOURCE_MARKER_CONTENT = "mochi-package-resources-v1";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

export function isCampusStaticRoot(path) {
  return isDirectory(path) && isFile(join(path, "assets", "embed.js"));
}

function resolveConfiguredPath(workspaceRoot, value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} 不能为空。`);
  }
  if (value.includes("\0")) throw new Error(`${name} 不能包含空字节。`);
  return resolve(workspaceRoot, value);
}

function hasPackageResourceMarker(markerPath) {
  return isFile(markerPath)
    && readFileSync(markerPath, "utf8").trim() === PACKAGE_RESOURCE_MARKER_CONTENT;
}

/**
 * Precedence is intentionally narrow:
 * 1. an explicit static client directory;
 * 2. a marker-proven Electron resource tree;
 * 3. the shared development resolver, which chooses canonical source first.
 *
 * The old campus.nosync/dist/client directory is never a development fallback:
 * it is only valid under a packaged resource marker, preventing a stale copy
 * from shadowing the canonical source build.
 */
export function resolveCampusStaticRoot({
  env = process.env,
  pluginDirectory = MODULE_DIRECTORY,
  workspaceRoot = resolve(pluginDirectory, "..", ".."),
  sourceResolverPath = join(workspaceRoot, "scripts", "campus-paths.cjs"),
} = {}) {
  const workspace = resolve(workspaceRoot);
  const configuredStatic = env.MOCHI_CAMPUS_STATIC_ROOT;
  if (configuredStatic) {
    const root = resolveConfiguredPath(workspace, configuredStatic, "MOCHI_CAMPUS_STATIC_ROOT");
    if (!isCampusStaticRoot(root)) {
      throw new Error(`MOCHI_CAMPUS_STATIC_ROOT 不是含 assets/embed.js 的校园静态目录：${root}`);
    }
    return { root, kind: "explicit" };
  }

  const markerPath = join(workspace, PACKAGE_RESOURCE_MARKER);
  const packagedStaticRoot = join(workspace, "campus.nosync", "dist", "client");
  if (hasPackageResourceMarker(markerPath)) {
    if (!isCampusStaticRoot(packagedStaticRoot)) {
      throw new Error(`Mochi 打包资源缺少校园静态产物：${packagedStaticRoot}`);
    }
    return { root: packagedStaticRoot, kind: "packaged" };
  }

  if (!isFile(sourceResolverPath)) {
    throw new Error(
      `未找到受管 Mochi 打包资源或开发路径解析器：${sourceResolverPath}。请设置 MOCHI_CAMPUS_STATIC_ROOT。`,
    );
  }
  const require = createRequire(import.meta.url);
  const resolver = require(sourceResolverPath);
  if (typeof resolver.resolveCampusStaticRoot !== "function") {
    throw new Error(`校园路径解析器未导出 resolveCampusStaticRoot：${sourceResolverPath}`);
  }
  return resolver.resolveCampusStaticRoot({ workspaceRoot: workspace, env });
}
