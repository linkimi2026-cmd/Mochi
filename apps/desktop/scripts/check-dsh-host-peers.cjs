"use strict";

/**
 * Verifies the DeepSeek peer contracts at electron-builder's actual target
 * paths. The projection contains only selected package manifests, so Node
 * cannot satisfy a peer from the development installation by accident.
 */

const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { findPackageJSON } = require("node:module");
const { tmpdir } = require("node:os");
const { dirname, isAbsolute, join, relative, resolve, sep } = require("node:path");
const { pathToFileURL } = require("node:url");
const semver = require("semver");
const { Platform } = require("app-builder-lib/out/core");
const {
  getFileMatchers,
  getNodeModuleFileMatcher,
} = require("app-builder-lib/out/fileMatcher");
const {
  computeNodeModuleFileSets,
  getDestinationPath,
} = require("app-builder-lib/out/util/appFileCopier");
const { createLazyProductionDeps } = require("app-builder-lib/out/util/packageDependencies");

const DEEPSEEK_NAMESPACE = "@deepseek-ai/";
const TYPE_DECLARATION_NAMESPACE = "@types/";
const desktopRoot = resolve(__dirname, "..");

function readPackageManifest(directory) {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function isWithin(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (
    !isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(".." + sep)
  );
}

function nativeBuildPlatform() {
  if (process.platform === "darwin") return Platform.MAC;
  if (process.platform === "win32") return Platform.WINDOWS;
  throw new Error(
    "dsh-host-peers 仅在 macOS 或 Windows 原生打包 runner 上检查目标布局；当前平台为 " +
    process.platform + "。",
  );
}

async function loadProductionDependencies(root = desktopRoot) {
  return createLazyProductionDeps(root, null, true).value;
}

function createBuilderProjectionPackager(root, buildConfig, productionDependencies, platform) {
  const applicationManifest = readPackageManifest(root);
  const dependencyInfo = { value: Promise.resolve(productionDependencies) };
  return {
    platform,
    config: buildConfig,
    info: {
      appInfo: { type: applicationManifest.type ?? "commonjs" },
      config: buildConfig,
      debugLogger: {
        isEnabled: false,
        add() {},
      },
      getNodeDependencyInfo() {
        return dependencyInfo;
      },
    },
  };
}

function assertAsarUnpackCoverage(root, targetManifests, buildConfig, platformBuildOptions) {
  const asarSetting = platformBuildOptions.asar ?? buildConfig.asar;
  if (asarSetting === false) return 0;

  const outputDirectory = resolve(root, buildConfig.directories?.output ?? "dist");
  const unpackMatchers = getFileMatchers(buildConfig, "asarUnpack", root, {
    macroExpander: (value) => value,
    customBuildOptions: platformBuildOptions,
    defaultSrc: root,
    globalOutDir: outputDirectory,
  });
  const unpackFilter = unpackMatchers == null ? null : unpackMatchers[0].createFilter();
  if (unpackFilter == null) {
    throw new Error("asar is enabled but build.asarUnpack does not cover node modules.");
  }

  for (const target of targetManifests) {
    if (!unpackFilter(target.sourceManifest, statSync(target.sourceManifest))) {
      throw new Error(
        "build.asarUnpack does not place this selected target manifest in app.asar.unpacked: " +
        target.sourceManifest,
      );
    }
  }
  return targetManifests.length;
}

async function computeBuilderTargetFileSets({
  root = desktopRoot,
  productionDependencies,
  targetRoot,
} = {}) {
  if (targetRoot == null) {
    throw new Error("computeBuilderTargetFileSets requires an existing targetRoot.");
  }

  const actualRoot = realpathSync(root);
  const actualTargetRoot = realpathSync(targetRoot);
  const dependencyTree = productionDependencies ?? await loadProductionDependencies(actualRoot);
  const buildConfig = readPackageManifest(actualRoot).build ?? {};
  const platform = nativeBuildPlatform();
  const platformBuildOptions = buildConfig[platform.buildConfigurationKey] ?? {};
  const packager = createBuilderProjectionPackager(
    actualRoot,
    buildConfig,
    dependencyTree,
    platform,
  );
  const matcher = getNodeModuleFileMatcher(
    actualRoot,
    actualTargetRoot,
    (value) => value,
    platformBuildOptions,
    packager.info,
  );
  const fileSets = await computeNodeModuleFileSets(packager, matcher);
  const targetManifests = [];

  for (const fileSet of fileSets) {
    const sourceManifest = join(fileSet.src, "package.json");
    if (!fileSet.files.includes(sourceManifest)) {
      throw new Error(
        "electron-builder selected a node module without its package manifest: " + fileSet.src,
      );
    }
    const targetManifest = resolve(getDestinationPath(sourceManifest, fileSet));
    if (!isWithin(actualTargetRoot, targetManifest)) {
      throw new Error(
        "electron-builder mapped a package manifest outside the target projection: " + targetManifest,
      );
    }
    targetManifests.push({
      sourceManifest: realpathSync(sourceManifest),
      targetManifest,
    });
  }
  const unpackedTargetManifestCount = assertAsarUnpackCoverage(
    actualRoot,
    targetManifests,
    buildConfig,
    platformBuildOptions,
  );

  return {
    buildPlatform: platform.name,
    fileSets,
    targetManifests,
    unpackedTargetManifestCount,
  };
}

function materializeTargetManifests(targetRoot, targetManifests) {
  const actualTargetRoot = realpathSync(targetRoot);
  const targetPackages = [];

  for (const target of targetManifests) {
    const targetManifest = resolve(target.targetManifest);
    if (!isWithin(actualTargetRoot, targetManifest)) {
      throw new Error("Refusing to materialize a manifest outside the projection: " + targetManifest);
    }
    mkdirSync(dirname(targetManifest), { recursive: true });
    writeFileSync(targetManifest, readFileSync(target.sourceManifest));
    const actualTargetManifest = realpathSync(targetManifest);
    if (!isWithin(actualTargetRoot, actualTargetManifest)) {
      throw new Error("A materialized manifest resolved outside the projection: " + actualTargetManifest);
    }
    targetPackages.push({
      sourceManifest: target.sourceManifest,
      manifestPath: actualTargetManifest,
      directory: dirname(actualTargetManifest),
    });
  }

  return {
    projectionRoot: actualTargetRoot,
    targetPackages,
  };
}

function targetLabel(projectionRoot, manifestPath) {
  return relative(projectionRoot, manifestPath).split(sep).join("/");
}

function createRequirement({
  importerManifest,
  importerManifestPath,
  projectionRoot,
  packageName,
  range,
  dependencyKind,
}) {
  const requirement = {
    importer: importerManifest.name,
    importerTarget: targetLabel(projectionRoot, importerManifestPath),
    importerManifestPath,
    packageName,
    range,
    dependencyKind,
  };
  if (dependencyKind === "peer") {
    requirement.peerName = packageName;
  } else {
    requirement.dependencyName = packageName;
  }
  return requirement;
}

function inspectRequiredTargetPackage({
  projectionRoot,
  selectedTargetManifests,
  requirement,
}) {
  if (
    typeof requirement.range !== "string" ||
    semver.validRange(requirement.range) == null
  ) {
    return {
      ...requirement,
      kind: "unsupported-range",
    };
  }

  let resolvedManifest;
  try {
    const manifestPath = findPackageJSON(
      requirement.packageName,
      pathToFileURL(requirement.importerManifestPath),
    );
    if (manifestPath == null) {
      return {
        ...requirement,
        kind: "unresolvable",
        detail: "ERR_MODULE_NOT_FOUND",
      };
    }
    resolvedManifest = realpathSync(manifestPath);
  } catch (error) {
    return {
      ...requirement,
      kind: "unresolvable",
      detail: error.code ?? error.message,
    };
  }

  if (!isWithin(projectionRoot, resolvedManifest)) {
    return {
      ...requirement,
      kind: "outside-projection",
      resolvedManifest,
    };
  }
  if (!selectedTargetManifests.has(resolvedManifest)) {
    return {
      ...requirement,
      kind: "not-selected",
      resolvedManifest,
    };
  }

  const resolvedManifestData = JSON.parse(readFileSync(resolvedManifest, "utf8"));
  if (!semver.satisfies(resolvedManifestData.version, requirement.range)) {
    return {
      ...requirement,
      kind: "range-mismatch",
      version: resolvedManifestData.version,
      resolvedManifest,
    };
  }
  return null;
}

function formatProblem(problem) {
  const location = problem.importer + " (" + problem.importerTarget + ")";
  const requirementKind = problem.dependencyKind === "peer" ? "peer" : "dependency";
  const context = location + " requires " + requirementKind + " " +
    problem.packageName + "@" + problem.range;
  if (problem.kind === "unresolvable") {
    return context + ": Node cannot resolve its package manifest (" + problem.detail + ").";
  }
  if (problem.kind === "outside-projection") {
    return context + ": resolves outside the selected target projection at " + problem.resolvedManifest + ".";
  }
  if (problem.kind === "not-selected") {
    return context + ": resolves to " + problem.resolvedManifest + ", but electron-builder did not select that target manifest.";
  }
  if (problem.kind === "unsupported-range") {
    return context + ": declares a non-semver range and requires review.";
  }
  return context + ": selected version " + problem.version + " does not satisfy the declared range.";
}

function inspectTargetDshHostPeers({ projectionRoot, targetPackages }) {
  const actualProjectionRoot = realpathSync(projectionRoot);
  const selectedTargetManifests = new Set();
  const requiredDependencies = [];
  const optionalDependencies = [];
  const typeDependencies = [];
  const requiredPeers = [];
  const optionalPeers = [];
  const problems = [];

  for (const targetPackage of targetPackages) {
    const actualManifestPath = realpathSync(targetPackage.manifestPath);
    if (!isWithin(actualProjectionRoot, actualManifestPath)) {
      throw new Error("A target package manifest is outside the projection: " + actualManifestPath);
    }
    selectedTargetManifests.add(actualManifestPath);
  }

  for (const targetPackage of targetPackages) {
    const importerManifestPath = realpathSync(targetPackage.manifestPath);
    const importerManifest = JSON.parse(readFileSync(importerManifestPath, "utf8"));

    const optionalDependencyNames = new Set(
      Object.keys(importerManifest.optionalDependencies ?? {}),
    );
    const ordinaryDependencies = new Map([
      ...Object.entries(importerManifest.dependencies ?? {}),
      ...Object.entries(importerManifest.optionalDependencies ?? {}),
    ]);
    for (const [dependencyName, range] of ordinaryDependencies) {
      const dependency = createRequirement({
        importerManifest,
        importerManifestPath,
        projectionRoot: actualProjectionRoot,
        packageName: dependencyName,
        range,
        dependencyKind: "dependency",
      });
      if (optionalDependencyNames.has(dependencyName)) {
        optionalDependencies.push(dependency);
        continue;
      }
      if (dependencyName.startsWith(TYPE_DECLARATION_NAMESPACE)) {
        typeDependencies.push(dependency);
        continue;
      }

      requiredDependencies.push(dependency);
      const problem = inspectRequiredTargetPackage({
        projectionRoot: actualProjectionRoot,
        selectedTargetManifests,
        requirement: dependency,
      });
      if (problem != null) problems.push(problem);
    }

    for (const [peerName, range] of Object.entries(importerManifest.peerDependencies ?? {})) {
      if (!peerName.startsWith(DEEPSEEK_NAMESPACE)) continue;

      const peer = createRequirement({
        importerManifest,
        importerManifestPath,
        projectionRoot: actualProjectionRoot,
        packageName: peerName,
        range,
        dependencyKind: "peer",
      });
      if (importerManifest.peerDependenciesMeta?.[peerName]?.optional === true) {
        optionalPeers.push(peer);
        continue;
      }

      requiredPeers.push(peer);
      const problem = inspectRequiredTargetPackage({
        projectionRoot: actualProjectionRoot,
        selectedTargetManifests,
        requirement: peer,
      });
      if (problem != null) problems.push(problem);
    }
  }

  return {
    targetManifestCount: selectedTargetManifests.size,
    targetPackageCount: targetPackages.length,
    requiredDependencies,
    optionalDependencies,
    typeDependencies,
    requiredPeers,
    optionalPeers,
    problems,
  };
}

function assertTargetDshHostPeers(options) {
  const report = inspectTargetDshHostPeers(options);
  if (report.problems.length > 0) {
    const error = new Error([
      "dsh-host-deps 检查失败：普通运行依赖或 DeepSeek 必需 peer 未被打包目标布局完整提供。",
      ...report.problems.map((problem) => "- " + formatProblem(problem)),
    ].join("\n"));
    error.code = "MOCHI_DSH_HOST_PEERS";
    error.report = report;
    throw error;
  }
  return report;
}

async function inspectDshHostPeers({ root = desktopRoot, productionDependencies } = {}) {
  const projectionRoot = mkdtempSync(join(tmpdir(), "mochi-dsh-host-peers-target-"));
  try {
    const targetMapping = await computeBuilderTargetFileSets({
      root,
      productionDependencies,
      targetRoot: projectionRoot,
    });
    const projection = materializeTargetManifests(
      projectionRoot,
      targetMapping.targetManifests,
    );
    return {
      ...inspectTargetDshHostPeers(projection),
      buildPlatform: targetMapping.buildPlatform,
      builderFileSetCount: targetMapping.fileSets.length,
      unpackedTargetManifestCount: targetMapping.unpackedTargetManifestCount,
    };
  } finally {
    rmSync(projectionRoot, { recursive: true, force: true });
  }
}

async function assertDshHostPeers(options) {
  const report = await inspectDshHostPeers(options);
  if (report.problems.length > 0) {
    const error = new Error([
      "dsh-host-deps 检查失败：普通运行依赖或 DeepSeek 必需 peer 未被打包目标布局完整提供。",
      ...report.problems.map((problem) => "- " + formatProblem(problem)),
    ].join("\n"));
    error.code = "MOCHI_DSH_HOST_PEERS";
    error.report = report;
    throw error;
  }
  return report;
}

if (require.main === module) {
  assertDshHostPeers()
    .then((report) => {
      process.stdout.write(
        "[dsh-host-peers] PASS: " +
        report.targetPackageCount + " target package entries (" +
        report.targetManifestCount + " manifests), " +
        report.unpackedTargetManifestCount + " asar-unpacked manifests, " +
        report.requiredDependencies.length + " required ordinary dependency edges, " +
        report.optionalDependencies.length + " optional ordinary dependency edges, " +
        report.typeDependencies.length + " @types declaration edges excluded by builder, " +
        report.requiredPeers.length + " required DeepSeek peer edges, " +
        report.optionalPeers.length + " optional DeepSeek peer edges.\n",
      );
    })
    .catch((error) => {
      process.stderr.write("[dsh-host-peers] " + error.message + "\\n");
      process.exitCode = 1;
    });
}

module.exports = {
  DEEPSEEK_NAMESPACE,
  assertDshHostPeers,
  assertTargetDshHostPeers,
  computeBuilderTargetFileSets,
  inspectDshHostPeers,
  inspectTargetDshHostPeers,
  loadProductionDependencies,
  materializeTargetManifests,
};
