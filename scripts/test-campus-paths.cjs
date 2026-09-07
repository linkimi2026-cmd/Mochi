"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveCampusPaths, resolveCampusStaticRoot } = require("./campus-paths.cjs");

function makeCampusRoot(path) {
  mkdirSync(join(path, "src"), { recursive: true });
  writeFileSync(join(path, "package.json"), "{}\n");
  mkdirSync(join(path, "mochi-dist", "client", "assets"), { recursive: true });
  writeFileSync(join(path, "mochi-dist", "client", "assets", "embed.js"), "export {};\n");
}

function makeStaticRoot(path) {
  mkdirSync(join(path, "assets"), { recursive: true });
  writeFileSync(join(path, "assets", "embed.js"), "export {};\n");
}

const root = mkdtempSync(join(tmpdir(), "mochi-campus-paths-test-"));
try {
  const workspace = join(root, "Mochi");
  const canonical = join(root, "联动计划");
  const legacy = join(workspace, "campus.nosync");
  const explicit = join(workspace, "custom-campus");
  const staticInput = join(workspace, "static-input");
  const packaged = join(root, "Resources", "mochi", "campus.nosync", "dist", "client");
  makeCampusRoot(canonical);
  makeCampusRoot(legacy);
  makeCampusRoot(explicit);
  makeStaticRoot(staticInput);
  makeStaticRoot(packaged);

  const defaults = resolveCampusPaths({ workspaceRoot: workspace, env: {} });
  assert.equal(defaults.sourceRoot, canonical);
  assert.equal(defaults.sourceKind, "canonical");
  assert.equal(defaults.staticRoot, join(canonical, "mochi-dist", "client"));
  assert.equal(defaults.stateDir, join(legacy, ".wrangler", "state"));

  const overridden = resolveCampusPaths({
    workspaceRoot: workspace,
    env: {
      MOCHI_CAMPUS_SOURCE_ROOT: "custom-campus",
      MOCHI_CAMPUS_STATIC_ROOT: "static-input",
      MOCHI_CAMPUS_STATE_DIR: "runtime-state",
    },
  });
  assert.equal(overridden.sourceRoot, explicit);
  assert.equal(overridden.sourceKind, "explicit");
  assert.equal(overridden.staticRoot, join(workspace, "static-input"));
  assert.equal(overridden.stateDir, join(workspace, "runtime-state"));

  const packagedStatic = resolveCampusStaticRoot({ workspaceRoot: workspace, env: {}, packagedStaticRoot: packaged });
  assert.equal(packagedStatic.root, packaged);
  assert.equal(packagedStatic.kind, "packaged");

  const explicitStatic = resolveCampusStaticRoot({
    workspaceRoot: workspace,
    env: { MOCHI_CAMPUS_STATIC_ROOT: packaged },
  });
  assert.equal(explicitStatic.root, packaged);
  assert.equal(explicitStatic.kind, "explicit");

  assert.throws(
    () => resolveCampusPaths({ workspaceRoot: workspace, env: { MOCHI_CAMPUS_SOURCE_ROOT: "missing" } }),
    /MOCHI_CAMPUS_SOURCE_ROOT/,
  );

  const cli = spawnSync(process.execPath, [join(__dirname, "campus-paths.cjs"), "--field", "state", "--workspace-root", workspace], {
    encoding: "utf8",
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), resolve(join(legacy, ".wrangler", "state")));

  rmSync(canonical, { recursive: true, force: true });
  const fallback = resolveCampusPaths({ workspaceRoot: workspace, env: {} });
  assert.equal(fallback.sourceRoot, legacy);
  assert.equal(fallback.sourceKind, "legacy");

  rmSync(legacy, { recursive: true, force: true });
  const staticWithoutSource = resolveCampusStaticRoot({ workspaceRoot: workspace, env: {}, packagedStaticRoot: packaged });
  assert.equal(staticWithoutSource.root, packaged);
  assert.equal(staticWithoutSource.kind, "packaged");

  console.log("campus path resolver tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
