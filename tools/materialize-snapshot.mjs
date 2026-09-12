#!/usr/bin/env node
/**
 * 把 Mochi 仓库按 `.github/windows-native-package-inputs.json` 逐文件物化成
 * 私有出包分支（`linkimi2026-cmd/jyl-campus-health`）要的 `mochi-source/` 快照。
 *
 * 用法：
 *   node tools/materialize-snapshot.mjs <目标目录>
 *   node tools/materialize-snapshot.mjs /tmp/jyl-health/mochi-source
 *
 * 铁律：快照里只能有「清单里的文件 + 清单自身」，**一个多余文件都不能有**。
 * CI 的 `Verify approved Mochi source snapshot` 会：
 *   路径安全 → 逐个 sha256 → 字节数 → **反向遍历整棵树、清单外文件直接失败**
 *   → 出现 reparse point（符号链接）直接失败。
 * 所以合法文件数恒等于 **清单条目数 + 1**（`+1` 是清单自身，唯一豁免哈希的文件）。
 *
 * 本脚本做三重自证（任何一条不过就退出码 1，不落盘成功结论）：
 *   1. 逐个文件拷贝后**立刻回算** sha256 + 字节数并与清单比对；
 *   2. **反向核对**：walk 整棵树，任何不在「清单 ∪ {清单}」里的文件都报错；
 *   3. 全树扫一遍**符号链接**。
 *
 * 前置（否则 CI 哈希必挂）：私有仓 `.gitattributes` 必须是 `* -text`（行尾不转换）、无 LFS。
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_REL = ".github/windows-native-package-inputs.json";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** 与 CI 相同的路径安全检查：拒绝反斜杠、盘符、`..`、绝对路径。 */
function isUnsafeRelative(value) {
  return (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\\")
    || value.includes(":")
    || value.startsWith("/")
    || value === "." || value === ".."
    || value.startsWith("../") || value.endsWith("/..") || value.includes("/../")
  );
}

/** 递归列出目录下所有条目（相对目标根的 POSIX 路径 + 是否符号链接）。 */
function walk(root, prefix = "") {
  const files = [];
  const links = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      links.push(rel);
      continue;
    }
    if (entry.isDirectory()) {
      const nested = walk(full, rel);
      files.push(...nested.files);
      links.push(...nested.links);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return { files, links };
}

function main() {
  const dest = process.argv[2];
  if (!dest) fail("用法：node tools/materialize-snapshot.mjs <目标目录>");

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const manifestPath = join(repoRoot, MANIFEST_REL);
  if (!existsSync(manifestPath)) fail(`找不到清单：${manifestPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const files = manifest.files;
  const expectedCount = Number(manifest.verification.expectedFileCount);
  const expectedBytes = Number(manifest.verification.expectedFileBytes);
  if (files.length !== expectedCount) {
    fail(`清单自相矛盾：files=${files.length} 但 expectedFileCount=${expectedCount}`);
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  const bad = [];
  let total = 0;
  for (const entry of files) {
    const rel = entry.path;
    if (isUnsafeRelative(rel)) { bad.push([rel, "unsafe path"]); continue; }
    const src = join(repoRoot, rel);
    if (!existsSync(src)) { bad.push([rel, "source missing"]); continue; }
    const stat = statSync(src);
    if (stat.isSymbolicLink()) { bad.push([rel, "source is a symlink"]); continue; }
    if (!stat.isFile()) { bad.push([rel, "source is not a regular file"]); continue; }

    const dst = join(dest, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);

    const size = statSync(dst).size;
    if (size !== Number(entry.bytes)) { bad.push([rel, `bytes ${size} != ${entry.bytes}`]); continue; }
    const digest = sha256(dst);
    if (digest !== entry.sha256) { bad.push([rel, `sha256 ${digest.slice(0, 16)} != ${entry.sha256.slice(0, 16)}`]); continue; }
    total += size;
  }

  if (bad.length > 0) {
    process.stderr.write("物化失败：\n");
    for (const [rel, why] of bad.slice(0, 20)) process.stderr.write(`   ${rel} -> ${why}\n`);
    fail(`共 ${bad.length} 个文件有问题`);
  }

  // 清单自身（CI 唯一豁免哈希的文件）
  const manifestDst = join(dest, MANIFEST_REL);
  mkdirSync(dirname(manifestDst), { recursive: true });
  copyFileSync(manifestPath, manifestDst);

  if (total !== expectedBytes) fail(`字节总和不符：${total} != ${expectedBytes}`);

  const { files: onDisk, links } = walk(dest);
  const allowed = new Set([...files.map((entry) => entry.path), MANIFEST_REL]);
  const extra = [...onDisk].filter((p) => !allowed.has(p)).sort();
  const missing = [...allowed].filter((p) => !onDisk.includes(p)).sort();

  const pad = (label, value) => process.stdout.write(`${label}${" ".repeat(Math.max(1, 16 - label.length))}: ${value}\n`);
  pad("清单条目", files.length);
  pad("快照实际文件", `${onDisk.length}  (期望 ${files.length + 1})`);
  pad("清单声明字节", expectedBytes);
  pad("快照实际字节", total);
  pad("多余文件", `${extra.length} ${JSON.stringify(extra.slice(0, 5))}`);
  pad("缺失文件", `${missing.length} ${JSON.stringify(missing.slice(0, 5))}`);
  pad("符号链接", `${links.length} ${JSON.stringify(links.slice(0, 5))}`);

  if (extra.length || missing.length || onDisk.length !== files.length + 1) {
    fail("快照与清单不完全一致，拒绝继续");
  }
  if (links.length > 0) fail("快照含符号链接，CI 会拒绝");

  process.stdout.write(`\nOK：${relative(process.cwd(), dest).split(sep).join("/")} 快照与清单逐字节一致\n`);
}

main();
