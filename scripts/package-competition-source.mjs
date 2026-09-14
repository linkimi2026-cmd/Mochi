#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(repoRoot, "release", "submission");
const requestedName = process.argv[2];
if (requestedName === "--help" || requestedName === "-h") {
  process.stdout.write("用法：node scripts/package-competition-source.mjs [不含路径的 .zip 文件名]\n");
  process.exit(0);
}
const archiveName = requestedName ?? "Mochi-参赛源码包-2026-09-14.zip";
const archivePath = resolve(releaseDir, archiveName);
const maxArchiveBytes = 500_000_000;
const packageRootName = archiveName.replace(/\.zip$/i, "");

const excludedRoots = new Set([
  "artifacts",
  "foundation",
  "promo",
  "release",
  "secrets",
  "参赛PPT",
]);
const excludedExact = new Set([
  "WORKLOG.md",
  "mochi-harness-source.zip",
  "Mochi_宣传片制作经验与动作施工规范_V5.docx",
  "Mochi_提示词V1.3_英文教师版与接入说明.docx",
]);
const excludedSegments = new Set([
  ".git",
  ".workbuddy",
  ".workbuddy-ai",
  "node_modules",
  "node_modules.broken",
  "dist",
  "dist-electron",
  "release",
  "artifacts",
]);
const excludedDocPrefixes = [
  "docs/assets/",
  "docs/history/",
  "docs/reference/",
  "docs/research/",
  "docs/tasks/",
];
const sensitivePathPatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)secrets?(\/|$)/i,
  /credentials-seed\.json$/i,
  /private[-_]?key/i,
];
const sensitiveContentPatterns = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "demo password", pattern: /(?:Xiaoyi|Bzr|Renke|Sushe|Nianji|Admin|Tester)#2026/i },
];
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
  ".ps1", ".py", ".sh", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : (result.stderr || result.stdout || "");
    throw new Error(`${command} ${args.join(" ")} 失败：${output.trim()}`);
  }
  return result.stdout;
}

function normalizePath(value) {
  return value.split(sep).join("/").replace(/^\.\//, "");
}

function shouldInclude(file) {
  const normalized = normalizePath(file);
  const segments = normalized.split("/");
  if (!normalized || excludedExact.has(normalized)) return false;
  if (excludedRoots.has(segments[0])) return false;
  if (segments.some((segment) => excludedSegments.has(segment) || segment.endsWith(".nosync"))) return false;
  if (segments.some((segment) => segment.startsWith(".mochi-") || segment.startsWith(".promo-"))) return false;
  if (excludedDocPrefixes.some((prefix) => normalized.startsWith(prefix))) return false;
  if (sensitivePathPatterns.some((pattern) => pattern.test(normalized))) return false;
  if (normalized === ".DS_Store" || normalized.endsWith("/.DS_Store")) return false;
  return true;
}

function hashFile(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function extensionOf(file) {
  const index = file.lastIndexOf(".");
  return index === -1 ? "" : file.slice(index).toLowerCase();
}

function assertNoSensitiveContent(source, relativePath) {
  if (!textExtensions.has(extensionOf(relativePath))) return;
  if (statSync(source).size > 5 * 1024 * 1024) return;
  const text = readFileSync(source, "utf8");
  for (const rule of sensitiveContentPatterns) {
    if (rule.pattern.test(text)) throw new Error(`敏感信息扫描命中 ${rule.name}：${relativePath}`);
  }
}

if (!archiveName.endsWith(".zip") || basename(archivePath) !== archiveName) {
  throw new Error("输出名称必须是不含路径的 .zip 文件名");
}
if (existsSync(archivePath)) throw new Error(`源码包已存在，为避免覆盖请改用新文件名：${archivePath}`);

const listing = run("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "buffer" });
const candidates = listing.toString("utf8").split("\0").filter(Boolean);
const files = [...new Set(candidates)]
  .filter(shouldInclude)
  .filter((file) => existsSync(join(repoRoot, file)))
  .sort((a, b) => a.localeCompare(b, "zh-CN"));

const temporaryRoot = mkdtempSync(join(tmpdir(), "mochi-source-package-"));
const stagedRoot = join(temporaryRoot, packageRootName);
mkdirSync(stagedRoot, { recursive: true });

try {
  const manifestFiles = [];
  for (const file of files) {
    const source = join(repoRoot, file);
    const info = lstatSync(source);
    if (info.isSymbolicLink()) throw new Error(`源码包拒绝符号链接：${file}`);
    if (!info.isFile()) continue;
    assertNoSensitiveContent(source, file);
    const destination = join(stagedRoot, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    manifestFiles.push({ path: file, bytes: info.size, sha256: await hashFile(source) });
  }

  const sourceBytes = manifestFiles.reduce((sum, item) => sum + item.bytes, 0);
  const packageReadme = [
    "# Mochi 参赛源码包",
    "",
    "阅读顺序：README.md → Mochi-总体方案.md → docs/PROJECT-STATUS.md → docs/PROJECT-HISTORY.md → 参赛材料/作品说明.md。",
    "",
    "本包不含安装器、宣传片工程、PPT 工程、运行数据、缓存、历史证据和任何密钥。联动计划是独立校园业务项目，本包仅包含 Mochi 的接入层；开源检索与复用决定见 docs/reuse-audit.md。",
    "专项审计文档中指向 artifacts、.nosync 上游检出和历史目录的路径只用于原工作区追溯；这些目标不随包，也不是源码构建输入。",
    "",
    `文件数：${manifestFiles.length}`,
    `解压后源码字节：${sourceBytes}`,
    "逐文件校验：SOURCE-MANIFEST.json",
    "",
  ].join("\n");
  writeFileSync(join(stagedRoot, "00-参赛源码包说明.md"), packageReadme);
  writeFileSync(join(stagedRoot, "SOURCE-MANIFEST.json"), `${JSON.stringify({
    schemaVersion: "mochi-competition-source.v1",
    generatedAt: new Date().toISOString(),
    sourceBytes,
    fileCount: manifestFiles.length,
    excluded: ["installers", "promo", "presentation", "runtime-data", "cache", "secrets", "history"],
    files: manifestFiles,
  }, null, 2)}\n`);

  mkdirSync(releaseDir, { recursive: true });
  const zipScript = [
    "import os, sys, zipfile",
    "root, output = sys.argv[1], sys.argv[2]",
    "parent = os.path.dirname(root)",
    "with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:",
    "    for base, dirs, files in os.walk(root):",
    "        dirs.sort()",
    "        files.sort()",
    "        for name in files:",
    "            source = os.path.join(base, name)",
    "            archive.write(source, os.path.relpath(source, parent))",
  ].join("\n");
  run("/usr/bin/python3", ["-c", zipScript, stagedRoot, archivePath]);
  run("/usr/bin/unzip", ["-t", archivePath]);

  const archiveBytes = statSync(archivePath).size;
  if (archiveBytes >= maxArchiveBytes) {
    throw new Error(`源码包 ${archiveBytes} B 超过 500 MB 限制`);
  }
  const archiveSha256 = await hashFile(archivePath);
  writeFileSync(`${archivePath}.sha256`, `${archiveSha256}  ${basename(archivePath)}\n`);
  writeFileSync(`${archivePath}.summary.json`, `${JSON.stringify({
    archive: relative(repoRoot, archivePath),
    archiveBytes,
    archiveSha256,
    sourceBytes,
    fileCount: manifestFiles.length,
    limitBytes: maxArchiveBytes,
    passedSizeLimit: true,
    passedArchiveTest: true,
    passedSensitiveContentScan: true,
  }, null, 2)}\n`);
  writeFileSync(join(releaseDir, "README.md"), [
    "# Mochi 参赛提交产物",
    "",
    `- 源码包：${basename(archivePath)}`,
    `- 大小：${archiveBytes} B（限制 ${maxArchiveBytes} B）`,
    `- SHA-256：${archiveSha256}`,
    `- 文件数：${manifestFiles.length}`,
    "- 校验：ZIP 完整性、敏感信息扫描、逐文件清单和大小上限均通过。",
    "- 安装器：本轮未重建；继续使用 docs/DELIVERY-LEDGER.md 登记的现有原生构建。",
    "- PPT：新版四分钟答辩已完成，在项目根目录的完整交付包 06-答辩PPT 中单独提供，不在源码包内。",
    "",
  ].join("\n"));
  process.stdout.write(`${JSON.stringify({ archivePath, archiveBytes, archiveSha256, sourceBytes, fileCount: manifestFiles.length }, null, 2)}\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
