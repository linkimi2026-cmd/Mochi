#!/usr/bin/env node
/**
 * 重算 `.github/windows-native-package-inputs.json` 里每个文件的 sha256 与字节数，
 * 并把打包白名单（prepare-mochi-resources.cjs 的 PLUGINS）里新出现的插件源文件登记进去。
 *
 * 为什么必须重算：私有 CI 构建会逐条校验哈希，任何一条对不上就直接拒绝出包
 * ——「改一行源码就白跑一整轮 Windows CI」。所以每次动到快照清单内的文件，
 * 都要在这里重算并累加 expectedFileBytes。
 *
 * 用法：
 *   node scripts/reconcile-snapshot-manifest.mjs            # 只报告差异
 *   node scripts/reconcile-snapshot-manifest.mjs --write     # 落盘
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const MANIFEST = join(repoRoot, ".github", "windows-native-package-inputs.json");
const RESOURCE_SCRIPT = join(repoRoot, "apps", "desktop", "scripts", "prepare-mochi-resources.cjs");

/** 从打包白名单源码里反解出 [{ id, source, files }]。 */
function readPluginWhitelist() {
  const source = readFileSync(RESOURCE_SCRIPT, "utf8");
  const anchor = source.indexOf("const PLUGINS = Object.freeze([");
  if (anchor < 0) throw new Error("找不到 PLUGINS 白名单");
  const start = source.indexOf("[", anchor);
  let depth = 0;
  let end = -1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    } else if (char === "`" || char === '"' || char === "'") {
      // 跳过字符串字面量，避免把里面的括号当结构。
      const quote = char;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") index += 1;
        index += 1;
      }
    }
  }
  if (end < 0) throw new Error("PLUGINS 数组没有正常闭合");

  const body = source.slice(start + 1, end);
  const entries = [];
  let objectDepth = 0;
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "{") objectDepth += 1;
    if (objectDepth > 0) current += char;
    if (char === "}") {
      objectDepth -= 1;
      if (objectDepth === 0) {
        entries.push(current);
        current = "";
      }
    }
  }

  return entries.map((chunk) => {
    const id = /id:\s*"([^"]+)"/.exec(chunk)?.[1];
    const source_ = /source:\s*"([^"]+)"/.exec(chunk)?.[1];
    const filesBlock = /files:\s*\[([^\]]*)\]/.exec(chunk)?.[1] ?? "";
    const files = [...filesBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    if (!id || !source_ || files.length === 0) throw new Error(`PLUGINS 条目解析失败：${chunk.slice(0, 120)}`);
    return { id, source: source_, files };
  });
}

function hashFile(absolute) {
  const data = readFileSync(absolute);
  return { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

function main() {
  const write = process.argv.includes("--write");
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const entries = manifest.files;
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  const whitelist = readPluginWhitelist();
  const expected = new Map();
  for (const plugin of whitelist) {
    for (const file of plugin.files) {
      const relative = `${plugin.source}/${file}`;
      expected.set(relative, `staged-plugin:${plugin.id}`);
    }
  }

  const added = [];
  for (const [relative, category] of expected) {
    if (byPath.has(relative)) continue;
    const absolute = join(repoRoot, relative);
    const { bytes, sha256 } = hashFile(absolute);
    entries.push({ path: relative, sha256, bytes, categories: [category] });
    byPath.set(relative, entries[entries.length - 1]);
    added.push({ relative, bytes, category });
  }

  // ── vendor/local-plugins/*.tgz：跟着 package.json 的 file: 依赖走 ─────────────
  //
  // 这段是 2026-09-12 补的，起因是一次真实的出包失败：`@mochi/pdf-layout` 的源码修好了，
  // 但 `vendor/local-plugins/` 里的 tarball 还是旧的（旧内容哈希名），而本脚本原先**只管
  // 重算已登记条目的哈希**，压根不管 tarball 的**改名换新**。结果：新 tgz 登记不进去、
  // 旧条目报「登记但磁盘缺失」，`check-snapshot-manifest --fail` 直接失败，
  // 而失败原因看起来跟业务改动毫无关系。
  //
  // 判定口径：**`apps/desktop/package.json` 里被 `file:` 依赖引用到的 tgz = 出包真正消费的集合**。
  //   - 被引用但清单里没有  → 登记（新打的包）
  //   - 清单里有、已不再被引用、且磁盘上也没有 → 删除（重打包留下的旧条目）
  //   - 清单里有、已不再被引用、但磁盘上还在   → 保留 + 提醒（可能是别人正在换版本）
  const vendorDir = join(repoRoot, "vendor", "local-plugins");
  const referencedTarballs = new Set();
  const desktopManifestPath = join(repoRoot, "apps", "desktop", "package.json");
  const desktopManifest = JSON.parse(readFileSync(desktopManifestPath, "utf8"));
  for (const value of Object.values(desktopManifest.dependencies ?? {})) {
    if (typeof value !== "string" || !value.startsWith("file:")) continue;
    const target = resolve(dirname(desktopManifestPath), value.slice("file:".length));
    if (dirname(target) !== vendorDir) continue;
    referencedTarballs.add(target);
  }

  const vendoredAdded = [];
  for (const absolute of [...referencedTarballs].sort()) {
    const relative = absolute.slice(repoRoot.length + 1);
    if (byPath.has(relative)) continue;
    const { bytes, sha256 } = hashFile(absolute);
    entries.push({ path: relative, sha256, bytes, categories: ["vendored-tarball"] });
    byPath.set(relative, entries[entries.length - 1]);
    vendoredAdded.push({ relative, bytes });
  }

  const staleTarballs = [];
  const droppedTarballs = [];
  for (const entry of [...entries]) {
    if (!entry.path.startsWith("vendor/local-plugins/")) continue;
    if (referencedTarballs.has(join(repoRoot, entry.path))) continue;
    if (existsSync(join(repoRoot, entry.path))) {
      staleTarballs.push(entry.path);
      continue;
    }
    droppedTarballs.push(entry.path);
    entries.splice(entries.indexOf(entry), 1);
    byPath.delete(entry.path);
  }

  // 白名单之外的 staged-plugin 条目：可能是别人正在做的插件，只报告不删。
  const orphans = entries
    .filter((entry) => (entry.categories ?? []).some((category) => category.startsWith("staged-plugin:")))
    .filter((entry) => !expected.has(entry.path))
    .map((entry) => entry.path);

  const refreshed = [];
  const missing = [];
  let total = 0;
  for (const entry of entries) {
    const absolute = join(repoRoot, entry.path);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      missing.push(entry.path);
      continue;
    }
    if (!stat.isFile()) {
      missing.push(entry.path);
      continue;
    }
    const { bytes, sha256 } = hashFile(absolute);
    total += bytes;
    if (entry.bytes !== bytes || entry.sha256 !== sha256) {
      refreshed.push({ path: entry.path, from: entry.bytes, to: bytes });
    }
    entry.bytes = bytes;
    entry.sha256 = sha256;
    if (!Array.isArray(entry.categories) || entry.categories.length === 0) {
      entry.categories = ["desktop-source"];
    }
  }

  manifest.verification.expectedFileCount = entries.length;
  manifest.verification.expectedFileBytes = total;

  process.stdout.write(`[manifest] 新增登记 ${added.length} 个\n`);
  for (const item of added) process.stdout.write(`  + ${item.relative} (${item.bytes} B, ${item.category})\n`);
  if (vendoredAdded.length > 0) {
    process.stdout.write(`[manifest] 新登记 vendored tarball ${vendoredAdded.length} 个（来自 apps/desktop/package.json 的 file: 依赖）\n`);
    for (const item of vendoredAdded) process.stdout.write(`  + ${item.relative} (${item.bytes} B)\n`);
  }
  if (droppedTarballs.length > 0) {
    process.stdout.write(`[manifest] 移除已不再引用、且磁盘上也不存在的 vendored tarball 条目 ${droppedTarballs.length} 个\n`);
    for (const path of droppedTarballs) process.stdout.write(`  - ${path}\n`);
  }
  if (staleTarballs.length > 0) {
    process.stdout.write(`[manifest] vendored tarball 条目已不再被 package.json 引用，但磁盘上仍在 ${staleTarballs.length} 个（保留，仅提醒）\n`);
    for (const path of staleTarballs) process.stdout.write(`  ? ${path}\n`);
  }
  process.stdout.write(`[manifest] 重算哈希 ${refreshed.length} 个\n`);
  for (const item of refreshed) process.stdout.write(`  ~ ${item.path}  ${item.from} -> ${item.to}\n`);
  if (orphans.length > 0) {
    process.stdout.write(`[manifest] 白名单外但已登记的 staged-plugin 条目 ${orphans.length} 个（保留，仅提醒）\n`);
    for (const path of orphans) process.stdout.write(`  ? ${path}\n`);
  }
  if (missing.length > 0) {
    process.stdout.write(`[manifest] 清单登记但磁盘缺失 ${missing.length} 个\n`);
    for (const path of missing) process.stdout.write(`  ! ${path}\n`);
  }
  process.stdout.write(
    `[manifest] 条目 ${entries.length}，总字节 ${total}\n`,
  );

  if (write) {
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`[manifest] 已写入 ${MANIFEST}\n`);
  } else {
    process.stdout.write("[manifest] 未写入（加 --write 落盘）\n");
  }
  return missing.length > 0 ? 1 : 0;
}

process.exitCode = main();
