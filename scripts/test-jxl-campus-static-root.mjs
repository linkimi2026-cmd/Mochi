import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCampusStaticRoot } from "../client-plugins/jxl-campus/static-root.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceResolverPath = join(workspaceRoot, "scripts", "campus-paths.cjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "jxl-campus-static-root-"));

function writeFile(path, contents = "x") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function writeCampusSource(root) {
  writeFile(join(root, "package.json"), "{}\n");
  mkdirSync(join(root, "src"), { recursive: true });
}

function writeStaticClient(root) {
  writeFile(join(root, "assets", "embed.js"), "export {};\n");
}

try {
  const developmentWorkspace = join(temporaryRoot, "Mochi");
  const canonicalSource = join(temporaryRoot, "联动计划");
  const legacySource = join(developmentWorkspace, "campus.nosync");
  const pluginDirectory = join(developmentWorkspace, "client-plugins", "jxl-campus");
  mkdirSync(pluginDirectory, { recursive: true });
  writeCampusSource(canonicalSource);
  writeCampusSource(legacySource);
  const canonicalStatic = join(canonicalSource, "mochi-dist", "client");
  const staleLegacyStatic = join(legacySource, "dist", "client");
  writeStaticClient(canonicalStatic);
  writeStaticClient(staleLegacyStatic);

  const development = resolveCampusStaticRoot({
    env: {},
    workspaceRoot: developmentWorkspace,
    pluginDirectory,
    sourceResolverPath,
  });
  assert.deepEqual(development, { root: canonicalStatic, kind: "source:canonical" });
  assert.notEqual(development.root, staleLegacyStatic, "legacy dist/client shadowed canonical Mochi output");

  const explicitStatic = join(temporaryRoot, "explicit", "client");
  writeStaticClient(explicitStatic);
  assert.deepEqual(resolveCampusStaticRoot({
    env: { MOCHI_CAMPUS_STATIC_ROOT: explicitStatic },
    workspaceRoot: developmentWorkspace,
    pluginDirectory,
    sourceResolverPath,
  }), { root: explicitStatic, kind: "explicit" });
  assert.throws(() => resolveCampusStaticRoot({
    env: { MOCHI_CAMPUS_STATIC_ROOT: join(temporaryRoot, "missing") },
    workspaceRoot: developmentWorkspace,
    pluginDirectory,
    sourceResolverPath,
  }), /MOCHI_CAMPUS_STATIC_ROOT/);

  const packagedRoot = join(temporaryRoot, "Mochi.app", "Contents", "Resources", "mochi");
  const packagedPluginDirectory = join(packagedRoot, "plugins", "jxl-campus");
  const packagedStatic = join(packagedRoot, "campus.nosync", "dist", "client");
  mkdirSync(packagedPluginDirectory, { recursive: true });
  writeStaticClient(packagedStatic);
  writeFile(join(packagedRoot, ".mochi-package-resource-marker"), "mochi-package-resources-v1\n");
  assert.deepEqual(resolveCampusStaticRoot({
    env: {},
    workspaceRoot: packagedRoot,
    pluginDirectory: packagedPluginDirectory,
    sourceResolverPath: join(packagedRoot, "scripts", "campus-paths.cjs"),
  }), { root: packagedStatic, kind: "packaged" });

  const unmarkedRoot = join(temporaryRoot, "unmarked", "mochi");
  const unmarkedPluginDirectory = join(unmarkedRoot, "plugins", "jxl-campus");
  mkdirSync(unmarkedPluginDirectory, { recursive: true });
  writeStaticClient(join(unmarkedRoot, "campus.nosync", "dist", "client"));
  assert.throws(() => resolveCampusStaticRoot({
    env: {},
    workspaceRoot: unmarkedRoot,
    pluginDirectory: unmarkedPluginDirectory,
    sourceResolverPath: join(unmarkedRoot, "scripts", "campus-paths.cjs"),
  }), /未找到受管 Mochi 打包资源或开发路径解析器/);

  console.log("jxl-campus static root test passed: explicit, marked packaged, and canonical development precedence");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
