#!/usr/bin/env node
/**
 * Release-input contract test. It uses a throwaway Git source and tiny static
 * tree; it never reads a developer's campus checkout, D1 data, or credentials.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const releaseInput = createRequire(import.meta.url)(join(scriptDir, "prepare-release-input.cjs"));
const root = mkdtempSync(join(tmpdir(), "mochi-release-input-test-"));
const source = join(root, "campus-source");
const staticRoot = join(source, "mochi-dist", "client");
const outputRoot = join(root, releaseInput.RELEASE_INPUT_DIRECTORY_NAME);

function runGit(args) {
  const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

try {
  mkdirSync(join(source, "src"), { recursive: true });
  mkdirSync(join(staticRoot, "assets"), { recursive: true });
  writeFileSync(join(source, "package.json"), `${JSON.stringify({ name: "campus-fixture", version: "7.2.1" })}\n`);
  writeFileSync(join(source, "src", "main.ts"), "export const campus = true;\n");
  writeFileSync(join(staticRoot, "assets", "embed.js"), "export const embedded = true;\n");
  writeFileSync(join(staticRoot, "assets", "style.css"), ".campus { color: #14532d; }\n");
  writeFileSync(join(staticRoot, "assets", "jxl-campus-watercolor-v1.webp"), "fixture-webp\n");
  writeFileSync(join(staticRoot, "assets", "illustration.png"), "fixture-png\n");
  runGit(["init", "-q"]);
  runGit(["add", "."]);
  runGit(["-c", "user.name=Release Fixture", "-c", "user.email=release-fixture@example.invalid", "commit", "-qm", "fixture"]);
  writeFileSync(join(source, "src", "main.ts"), "export const campus = 'dirty';\n");

  const prepared = releaseInput.prepareReleaseInput({
    outputRoot,
    campusStaticRoot: staticRoot,
    env: {
      PATH: process.env.PATH,
      MOCHI_CAMPUS_SOURCE_ROOT: source,
    },
  });
  assert.equal(existsSync(prepared.staticRoot), true);
  assert.equal(existsSync(prepared.manifestPath), true);
  const manifest = JSON.parse(readFileSync(prepared.manifestPath, "utf8"));
  assert.equal(manifest.desktop.version, "0.1.0");
  assert.equal(manifest.source.kind, "explicit");
  assert.equal(manifest.source.packageVersion, "7.2.1");
  assert.equal(manifest.source.git.dirty, true, "dirty canonical source must be recorded, not hidden");
  assert.ok(manifest.source.git.changes.some((entry) => entry.path === "src/main.ts"));
  assert.equal(manifest.static.relativeRoot, "campus-static/client");
  assert.equal(manifest.static.fileCount, 4);
  assert.equal(manifest.static.files.some((entry) => entry.path === "assets/embed.js"), true);
  assert.deepEqual(
    releaseInput.verifyReleaseInput({ inputRoot: outputRoot, expectedManifestSha256: prepared.manifestSha256 }).manifest.static.files,
    manifest.static.files,
  );

  writeFileSync(join(prepared.staticRoot, "assets", "embed.js"), "mutated after review\n");
  assert.throws(
    () => releaseInput.verifyReleaseInput({ inputRoot: outputRoot }),
    /静态文件与清单哈希不一致/,
  );

  const unmanaged = join(root, "unmanaged", releaseInput.RELEASE_INPUT_DIRECTORY_NAME);
  mkdirSync(unmanaged, { recursive: true });
  writeFileSync(join(unmanaged, "must-remain.txt"), "unmanaged\n");
  assert.throws(
    () => releaseInput.prepareReleaseInput({ outputRoot: unmanaged, campusStaticRoot: staticRoot, env: { PATH: process.env.PATH, MOCHI_CAMPUS_SOURCE_ROOT: source } }),
    /拒绝非专用|缺少受管标记/,
  );
  assert.equal(existsSync(join(unmanaged, "must-remain.txt")), true, "unmanaged directory was changed");

  console.log("[test-release-input] PASS: audited static snapshot records source revision/dirty state and rejects tampering/unmanaged outputs.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
