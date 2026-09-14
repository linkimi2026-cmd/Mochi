#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  linkSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedName = process.argv[2];
if (requestedName === "--help" || requestedName === "-h") {
  process.stdout.write("用法：node scripts/assemble-competition-delivery.mjs [不含路径的输出目录名]\n");
  process.exit(0);
}
const outputName = requestedName ?? "01-Mochi-参赛交付包-2026-09-14";
const outputRoot = resolve(repoRoot, outputName);

if (basename(outputRoot) !== outputName || existsSync(outputRoot)) {
  throw new Error(`交付目录名称无效或已存在：${outputRoot}`);
}

const entries = [
  ["06-答辩PPT", "Mochi_四分钟答辩_内嵌视频.pptx", "参赛PPT/Mochi四分钟答辩/output/Mochi_四分钟答辩_内嵌视频.pptx", "presentation", "render-verified"],
  ["06-答辩PPT", "讲稿与播放说明.md", "参赛PPT/Mochi四分钟答辩/讲稿与播放说明.md", "speaker-notes", "rehearsal-target"],
  ["01-源码", "Mochi-参赛源码包-2026-09-14.zip", "release/submission/Mochi-参赛源码包-2026-09-14.zip", "source", "verified"],
  ["01-源码", "Mochi-参赛源码包-2026-09-14.zip.sha256", "release/submission/Mochi-参赛源码包-2026-09-14.zip.sha256", "checksum", "verified"],
  ["01-源码", "Mochi-参赛源码包-2026-09-14.zip.summary.json", "release/submission/Mochi-参赛源码包-2026-09-14.zip.summary.json", "evidence", "verified"],
  ["02-Windows-x64", "mochi-windows-x64-34728914066.zip", "release/2026-09-13-windows/mochi-windows-x64-34728914066.zip", "installer", "user-tested"],
  ["03-macOS", "Mochi-0.1.0-mac-arm64.dmg", "apps/desktop/release/Mochi-0.1.0-mac-arm64.dmg", "installer", "build-verified"],
  ["03-macOS", "Mochi-0.1.0-mac-x64.dmg", "apps/desktop/release/Mochi-0.1.0-mac-x64.dmg", "installer", "build-verified"],
  ["04-宣传片", "Mochi_80秒_2K120帧_V5.mp4", "promo/output/Mochi_80秒_2K120帧_V5.mp4", "video", "user-selected"],
];

function sha256(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function materialize(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  try {
    linkSync(source, destination);
    return "hardlink";
  } catch (error) {
    if (statSync(source).size > 100_000_000) {
      throw new Error(`大文件硬链接失败，为避免额外占用磁盘未自动复制：${source}；${error.message}`);
    }
    copyFileSync(source, destination);
    return "copy";
  }
}

mkdirSync(outputRoot, { recursive: false });
copyFileSync(join(repoRoot, "docs", "QUICK-START.md"), join(outputRoot, "00-快速开始.md"));

const manifest = [];
for (const [folder, name, sourceName, kind, evidence] of entries) {
  const source = join(repoRoot, sourceName);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`缺少交付资源：${sourceName}`);
  const destination = join(outputRoot, folder, name);
  const materializedAs = materialize(source, destination);
  manifest.push({
    kind,
    evidence,
    source: sourceName,
    destination: relative(outputRoot, destination),
    bytes: statSync(destination).size,
    sha256: await sha256(destination),
    materializedAs,
  });
}

const checksumDir = join(outputRoot, "05-校验");
mkdirSync(checksumDir, { recursive: true });
writeFileSync(join(checksumDir, "SHA256SUMS.txt"), `${manifest
  .map((item) => `${item.sha256}  ${item.destination}`)
  .join("\n")}\n`);
writeFileSync(join(checksumDir, "delivery-manifest.json"), `${JSON.stringify({
  schemaVersion: "mochi-competition-delivery.v1",
  generatedAt: new Date().toISOString(),
  logicalBytes: manifest.reduce((sum, item) => sum + item.bytes, 0),
  installerRebuilt: false,
  presentationIncluded: true,
  selectedVideo: "Mochi_80秒_2K120帧_V5.mp4",
  resources: manifest,
}, null, 2)}\n`);

const logicalBytes = manifest.reduce((sum, item) => sum + item.bytes, 0);
writeFileSync(join(outputRoot, "README.md"), [
  "# Mochi 参赛交付包",
  "",
  "请先阅读 `00-快速开始.md`，再按电脑系统选择安装包。",
  "",
  "- `01-源码/`：小于 500 MB 的评委源码 ZIP 与校验结果。",
  "- `02-Windows-x64/`：Windows 安装归档，解压后运行其中的 EXE。",
  "- `03-macOS/`：Apple 芯片和 Intel 两个 DMG。",
  "- `04-宣传片/`：当前参赛选用的 80 秒 2K120 版。",
  "- `05-校验/`：全部交付文件的 SHA-256 与机器清单。",
  "- `06-答辩PPT/`：四分钟答辩 PPT（内嵌80秒视频）与讲稿、WPS播放说明。",
  "",
  `逻辑总大小：${logicalBytes} B。该目录包含三个安装交付，整体超过 500 MB；源码 ZIP 单独满足 500 MB 限制。`,
  "大文件在本机以硬链接汇集，不重复占用磁盘；复制本目录时会得到完整文件。",
  "",
].join("\n"));

process.stdout.write(`${JSON.stringify({ outputRoot, logicalBytes, resources: manifest.length }, null, 2)}\n`);
