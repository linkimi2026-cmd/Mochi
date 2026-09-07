#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const requireFromHere = createRequire(import.meta.url);
const checker = requireFromHere(join(scriptDir, "check-dsh-host-peers.cjs"));

function withoutPackage(nodes, packageName) {
  return nodes
    .filter((node) => node.name !== packageName)
    .map((node) => ({
      ...node,
      conflictDependency: node.conflictDependency
        ? withoutPackage(node.conflictDependency, packageName)
        : undefined,
    }));
}

function writePackage(directory, manifest) {
  mkdirSync(directory, { recursive: true });
  const manifestPath = join(directory, "package.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

function targetPackage(root, packagePath, manifest) {
  const manifestPath = writePackage(join(root, packagePath), manifest);
  return {
    manifestPath,
    directory: dirname(manifestPath),
  };
}

function targetManifestIsSelected(targetMapping, targetRoot, packagePath) {
  return targetMapping.targetManifests.some(
    (target) => target.targetManifest === join(targetRoot, packagePath, "package.json"),
  );
}

const productionDependencies = await checker.loadProductionDependencies(desktopRoot);
const report = await checker.assertDshHostPeers({
  root: desktopRoot,
  productionDependencies,
});

assert.ok(report.targetPackageCount > 0, "the real builder collector must select production package targets");
assert.equal(
  report.unpackedTargetManifestCount,
  report.targetPackageCount,
  "every selected production manifest must match the configured asarUnpack rule",
);
assert.ok(
  report.requiredDependencies.length > 0,
  "the report must inspect ordinary runtime dependencies as well as DeepSeek peers",
);
assert.ok(
  report.typeDependencies.some((dependency) => dependency.dependencyName === "@types/node"),
  "the report must classify builder-skipped @types declarations separately from runtime dependencies",
);
assert.ok(
  report.optionalPeers.some((peer) => peer.peerName === "@deepseek-ai/cordis-plugin-hmr"),
  "the report must retain optional peer classification",
);

const actualProjection = mkdtempSync(join(tmpdir(), "mochi-dsh-host-peers-mapping-"));
try {
  const targetMapping = await checker.computeBuilderTargetFileSets({
    root: desktopRoot,
    productionDependencies,
    targetRoot: actualProjection,
  });
  const actualProjectionRoot = realpathSync(actualProjection);
  assert.equal(
    targetMapping.unpackedTargetManifestCount,
    targetMapping.targetManifests.length,
    "the real builder asarUnpack matcher must cover every selected manifest",
  );
  assert.ok(
    targetManifestIsSelected(
      targetMapping,
      actualProjectionRoot,
      join("node_modules", "@deepseek-ai", "dsh-sandbox"),
    ),
    "the actual builder target layout must include the root sandbox importer",
  );
  assert.ok(
    targetManifestIsSelected(
      targetMapping,
      actualProjectionRoot,
      join("node_modules", "@deepseek-ai", "dsh-llm"),
    ),
    "the host declaration must produce a root target for dsh-llm",
  );
  assert.ok(
    targetManifestIsSelected(
      targetMapping,
      actualProjectionRoot,
      join("node_modules", "@deepseek-ai", "dsh-deque"),
    ),
    "the ordinary api-gateway dependency must produce a root target for dsh-deque",
  );
  assert.ok(
    targetManifestIsSelected(
      targetMapping,
      actualProjectionRoot,
      join("node_modules", "@deepseek-ai", "dsh-shell"),
    ),
    "the actual builder target layout must include the root shell importer",
  );
} finally {
  rmSync(actualProjection, { recursive: true, force: true });
}

const missingGroupReport = await checker.inspectDshHostPeers({
  root: desktopRoot,
  productionDependencies: withoutPackage(
    productionDependencies,
    "@deepseek-ai/cordis-plugin-group",
  ),
});
assert.ok(
  missingGroupReport.problems.some(
    (problem) =>
      problem.importer === "@deepseek-ai/dsh-app-boot" &&
      problem.peerName === "@deepseek-ai/cordis-plugin-group" &&
      problem.kind === "unresolvable",
  ),
  "removing a required peer from the collector fixture must fail at its isolated target importer",
);

const peerFixture = mkdtempSync(join(tmpdir(), "mochi-dsh-host-peers-fixture-"));
try {
  const sourceRoot = join(peerFixture, "source");
  const sourceImporterManifest = writePackage(
    join(sourceRoot, "node_modules", "@deepseek-ai", "fixture-importer"),
    {
      name: "@deepseek-ai/fixture-importer",
      version: "0.1.2-rc.1",
      peerDependencies: { "@deepseek-ai/fixture-peer": "^0.1.2-rc.1" },
    },
  );
  const sourcePeerManifest = writePackage(
    join(sourceRoot, "node_modules", "@deepseek-ai", "fixture-peer"),
    { name: "@deepseek-ai/fixture-peer", version: "0.1.2-rc.1" },
  );
  const sourceRequire = createRequire(sourceImporterManifest);
  assert.equal(
    realpathSync(sourceRequire.resolve("@deepseek-ai/fixture-peer/package.json")),
    realpathSync(sourcePeerManifest),
    "the source development layout must be able to resolve the fixture peer",
  );

  const siblingTargetRoot = join(peerFixture, "bundle-sibling");
  mkdirSync(siblingTargetRoot, { recursive: true });
  const siblingImporter = targetPackage(
    siblingTargetRoot,
    join("node_modules", "@deepseek-ai", "fixture-importer"),
    {
      name: "@deepseek-ai/fixture-importer",
      version: "0.1.2-rc.1",
      peerDependencies: { "@deepseek-ai/fixture-peer": "^0.1.2-rc.1" },
    },
  );
  const siblingDsh = targetPackage(
    siblingTargetRoot,
    join("node_modules", "@deepseek-ai", "fixture-dsh"),
    { name: "@deepseek-ai/fixture-dsh", version: "0.1.2-rc.1" },
  );
  const nestedPeer = targetPackage(
    siblingTargetRoot,
    join(
      "node_modules",
      "@deepseek-ai",
      "fixture-dsh",
      "node_modules",
      "@deepseek-ai",
      "fixture-peer",
    ),
    { name: "@deepseek-ai/fixture-peer", version: "0.1.2-rc.1" },
  );
  const siblingTargetPackages = [siblingImporter, siblingDsh, nestedPeer];

  assert.throws(
    () =>
      checker.assertTargetDshHostPeers({
        projectionRoot: siblingTargetRoot,
        targetPackages: siblingTargetPackages,
      }),
    (error) => {
      assert.equal(error.code, "MOCHI_DSH_HOST_PEERS");
      assert.match(error.message, /fixture-importer.*fixture-peer/);
      assert.match(error.message, /Node cannot resolve/);
      return true;
    },
    "a source-resolvable peer nested under a sibling dsh target must fail in the actual target layout",
  );

  const rootPeer = targetPackage(
    siblingTargetRoot,
    join("node_modules", "@deepseek-ai", "fixture-peer"),
    { name: "@deepseek-ai/fixture-peer", version: "0.1.2-rc.1" },
  );
  siblingTargetPackages.push(rootPeer);
  assert.doesNotThrow(
    () =>
      checker.assertTargetDshHostPeers({
        projectionRoot: siblingTargetRoot,
        targetPackages: siblingTargetPackages,
      }),
    "the same root host target must satisfy the peer",
  );

  writePackage(rootPeer.directory, {
    name: "@deepseek-ai/fixture-peer",
    version: "0.1.3-alpha.1",
  });
  assert.throws(
    () =>
      checker.assertTargetDshHostPeers({
        projectionRoot: siblingTargetRoot,
        targetPackages: siblingTargetPackages,
      }),
    (error) => {
      assert.equal(error.code, "MOCHI_DSH_HOST_PEERS");
      assert.match(error.message, /selected version 0\.1\.3-alpha\.1 does not satisfy/);
      return true;
    },
    "standard semver must not accept a prerelease outside the rc peer range",
  );

  const optionalTargetRoot = join(peerFixture, "bundle-optional");
  mkdirSync(optionalTargetRoot, { recursive: true });
  const optionalImporter = targetPackage(
    optionalTargetRoot,
    join("node_modules", "@deepseek-ai", "fixture-optional-importer"),
    {
      name: "@deepseek-ai/fixture-optional-importer",
      version: "0.1.2-rc.1",
      peerDependencies: { "@deepseek-ai/fixture-optional-platform": "^0.1.2-rc.1" },
      peerDependenciesMeta: {
        "@deepseek-ai/fixture-optional-platform": { optional: true },
      },
    },
  );
  assert.doesNotThrow(
    () =>
      checker.assertTargetDshHostPeers({
        projectionRoot: optionalTargetRoot,
        targetPackages: [optionalImporter],
      }),
    "a missing optional platform peer must not be reported as required",
  );

  const ordinaryTargetRoot = join(peerFixture, "bundle-ordinary");
  mkdirSync(ordinaryTargetRoot, { recursive: true });
  const ordinaryImporter = targetPackage(
    ordinaryTargetRoot,
    join("node_modules", "@deepseek-ai", "fixture-ordinary-importer"),
    {
      name: "@deepseek-ai/fixture-ordinary-importer",
      version: "0.1.2-rc.1",
      dependencies: {
        "@deepseek-ai/fixture-ordinary-dependency": "^0.1.2-rc.1",
        "fixture-exports-dependency": "^1.0.0",
        "@types/fixture-types": "^1.0.0",
      },
      optionalDependencies: {
        "fixture-optional-platform": "^1.0.0",
      },
    },
  );
  const ordinarySibling = targetPackage(
    ordinaryTargetRoot,
    join("node_modules", "@deepseek-ai", "fixture-ordinary-sibling"),
    { name: "@deepseek-ai/fixture-ordinary-sibling", version: "0.1.2-rc.1" },
  );
  const nestedOrdinaryDependency = targetPackage(
    ordinaryTargetRoot,
    join(
      "node_modules",
      "@deepseek-ai",
      "fixture-ordinary-sibling",
      "node_modules",
      "@deepseek-ai",
      "fixture-ordinary-dependency",
    ),
    { name: "@deepseek-ai/fixture-ordinary-dependency", version: "0.1.2-rc.1" },
  );
  const exportsOnlyDependency = targetPackage(
    ordinaryTargetRoot,
    join("node_modules", "fixture-exports-dependency"),
    {
      name: "fixture-exports-dependency",
      version: "1.0.0",
      exports: "./missing-entry.js",
    },
  );
  const ordinaryTargetPackages = [
    ordinaryImporter,
    ordinarySibling,
    nestedOrdinaryDependency,
    exportsOnlyDependency,
  ];
  const nestedOrdinaryReport = checker.inspectTargetDshHostPeers({
    projectionRoot: ordinaryTargetRoot,
    targetPackages: ordinaryTargetPackages,
  });
  assert.ok(
    nestedOrdinaryReport.problems.some(
      (problem) =>
        problem.dependencyKind === "dependency" &&
        problem.importer === "@deepseek-ai/fixture-ordinary-importer" &&
        problem.dependencyName === "@deepseek-ai/fixture-ordinary-dependency" &&
        problem.kind === "unresolvable",
    ),
    "an ordinary dependency nested under a sibling target must fail in the target layout",
  );
  assert.ok(
    nestedOrdinaryReport.typeDependencies.some(
      (dependency) => dependency.dependencyName === "@types/fixture-types",
    ),
    "@types declarations must be classified separately from ordinary runtime dependencies",
  );
  assert.ok(
    nestedOrdinaryReport.optionalDependencies.some(
      (dependency) => dependency.dependencyName === "fixture-optional-platform",
    ),
    "optional ordinary dependencies must remain optional",
  );
  assert.equal(
    nestedOrdinaryReport.problems.some(
      (problem) => problem.dependencyName === "fixture-exports-dependency",
    ),
    false,
    "findPackageJSON must locate a manifest even when package exports omit package.json and its entry is absent",
  );

  const rootOrdinaryDependency = targetPackage(
    ordinaryTargetRoot,
    join("node_modules", "@deepseek-ai", "fixture-ordinary-dependency"),
    { name: "@deepseek-ai/fixture-ordinary-dependency", version: "0.1.2-rc.1" },
  );
  ordinaryTargetPackages.push(rootOrdinaryDependency);
  assert.doesNotThrow(
    () =>
      checker.assertTargetDshHostPeers({
        projectionRoot: ordinaryTargetRoot,
        targetPackages: ordinaryTargetPackages,
      }),
    "the same root target must satisfy an ordinary dependency while optional and @types edges remain excluded",
  );

  const nonDeepMissingImporter = targetPackage(
    ordinaryTargetRoot,
    join("node_modules", "fixture-nondeep-importer"),
    {
      name: "fixture-nondeep-importer",
      version: "1.0.0",
      dependencies: { "fixture-nondeep-missing": "^1.0.0" },
    },
  );
  ordinaryTargetPackages.push(nonDeepMissingImporter);
  assert.throws(
    () =>
      checker.assertTargetDshHostPeers({
        projectionRoot: ordinaryTargetRoot,
        targetPackages: ordinaryTargetPackages,
      }),
    (error) => {
      assert.equal(error.code, "MOCHI_DSH_HOST_PEERS");
      assert.match(error.message, /fixture-nondeep-importer.*fixture-nondeep-missing/);
      return true;
    },
    "a missing non-DeepSeek ordinary dependency must fail",
  );
} finally {
  rmSync(peerFixture, { recursive: true, force: true });
}

console.log(
  "[test-dsh-host-peers] PASS: real builder targets are asar-unpacked; ordinary and peer sibling dependencies fail, root dependencies pass, optional and @types edges stay classified, exports-only manifests resolve, and prereleases keep standard semver behavior.",
);
