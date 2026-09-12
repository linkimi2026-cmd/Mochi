#!/usr/bin/env node
/**
 * Verify the Windows packaging source snapshot against its manifest.
 *
 * The manifest `.github/windows-native-package-inputs.json` is the exact
 * white-list of files that may be copied into the private packaging branch.
 * Every entry records the file's sha256 and byte length. The private CI build
 * hash-checks each entry and refuses to build on any mismatch, so a stale
 * manifest silently blocks the release instead of failing loudly here.
 *
 * This script re-computes the same facts locally and prints every file whose
 * bytes or hash drifted, plus the running byte total the manifest declares.
 *
 * Usage:
 *   node scripts/check-snapshot-manifest.mjs            # report only, exit 0
 *   node scripts/check-snapshot-manifest.mjs --fail      # exit 1 on drift
 *   node scripts/check-snapshot-manifest.mjs --manifest <path>
 *
 * Default behaviour is report-only on purpose: at the time of writing five
 * entries are stale because of uncommitted edits by other people. The manifest
 * owner must re-hash those files (see docs/build-standard.md). Flip the CI step
 * to `--fail` once the manifest is reconciled.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const DEFAULT_MANIFEST = ".github/windows-native-package-inputs.json";

function parseArgs(argv) {
  const options = { failOnDrift: false, manifest: DEFAULT_MANIFEST };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fail") {
      options.failOnDrift = true;
    } else if (arg === "--manifest") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--manifest 需要一个相对仓库根的路径");
      }
      options.manifest = argv[index];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`无法识别的参数：${arg}`);
    }
  }
  return options;
}

function formatDelta(actual, expected) {
  const delta = actual - expected;
  if (delta === 0) return "±0";
  return delta > 0 ? `+${delta}` : String(delta);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "用法：node scripts/check-snapshot-manifest.mjs [--fail] [--manifest <path>]\n",
    );
    return 0;
  }

  const manifestPath = resolve(repoRoot, options.manifest);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    process.stderr.write(`[snapshot] 无法读取清单 ${options.manifest}：${error.message}\n`);
    return 1;
  }

  const entries = Array.isArray(manifest.files) ? manifest.files : null;
  if (!entries) {
    process.stderr.write(`[snapshot] 清单缺少 files 数组：${options.manifest}\n`);
    return 1;
  }

  const declaredCount = Number(manifest.verification?.expectedFileCount);
  const declaredBytes = Number(manifest.verification?.expectedFileBytes);

  process.stdout.write(`[snapshot] 清单：${options.manifest}\n`);
  process.stdout.write(`[snapshot] 条目：${entries.length}（清单声明 ${declaredCount}）\n`);

  const drifted = [];
  const missing = [];
  let actualTotal = 0;

  for (const entry of entries) {
    const relative = String(entry?.path ?? "");
    if (!relative) {
      drifted.push({ path: "(缺失 path 字段)", reason: "清单条目没有 path" });
      continue;
    }

    const absolute = join(repoRoot, relative);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      missing.push(relative);
      continue;
    }
    if (!stat.isFile()) {
      drifted.push({ path: relative, reason: "不是普通文件" });
      continue;
    }

    const data = readFileSync(absolute);
    actualTotal += data.length;
    const actualBytes = data.length;
    const actualHash = createHash("sha256").update(data).digest("hex");
    const expectedBytes = Number(entry.bytes);
    const expectedHash = String(entry.sha256 ?? "");

    if (actualBytes !== expectedBytes || actualHash !== expectedHash) {
      drifted.push({
        path: relative,
        expectedBytes,
        actualBytes,
        expectedHash,
        actualHash,
      });
    }
  }

  if (drifted.length > 0) {
    process.stdout.write(`\n[snapshot] 字节或哈希不一致：${drifted.length} 个\n`);
    for (const item of drifted) {
      if (item.reason) {
        process.stdout.write(`  - ${item.path}：${item.reason}\n`);
        continue;
      }
      process.stdout.write(`  - ${item.path}\n`);
      process.stdout.write(
        `      字节：期望 ${item.expectedBytes}，实际 ${item.actualBytes}（${formatDelta(
          item.actualBytes,
          item.expectedBytes,
        )}）\n`,
      );
      process.stdout.write(
        `      sha256：期望 ${item.expectedHash.slice(0, 16)}…，实际 ${item.actualHash.slice(0, 16)}…\n`,
      );
    }
  }

  if (missing.length > 0) {
    process.stdout.write(`\n[snapshot] 清单登记但磁盘缺失：${missing.length} 个\n`);
    for (const relative of missing) {
      process.stdout.write(`  - ${relative}\n`);
    }
  }

  process.stdout.write("\n[snapshot] 汇总\n");
  process.stdout.write(`  清单声明总字节：${declaredBytes}\n`);
  process.stdout.write(`  磁盘实际总字节：${actualTotal}\n`);
  process.stdout.write(`  字节差：${formatDelta(actualTotal, declaredBytes)}\n`);
  process.stdout.write(`  不一致：${drifted.length} 个，缺失：${missing.length} 个\n`);

  const failed =
    drifted.length > 0 ||
    missing.length > 0 ||
    actualTotal !== declaredBytes ||
    entries.length !== declaredCount;

  if (!failed) {
    process.stdout.write("[snapshot] OK：清单与磁盘完全一致\n");
    return 0;
  }

  process.stdout.write(
    options.failOnDrift
      ? "[snapshot] FAIL：存在不一致（--fail 已启用，退出码 1）\n"
      : "[snapshot] DRIFT：存在不一致（当前为报告模式，退出码 0；加 --fail 可阻断）\n",
  );
  return options.failOnDrift ? 1 : 0;
}

process.exitCode = main();
