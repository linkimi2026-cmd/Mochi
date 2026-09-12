#!/usr/bin/env node
/**
 * 反解「私有出包分支上需要重建的插件依赖链接」。
 *
 * 为什么需要它
 * ------------
 * Windows 出包在私有仓库里跑，输入之一是 `mochi-source/` 快照 —— 一份**逐字节
 * 白名单**：清单（`.github/windows-native-package-inputs.json`）列了什么就只允许
 * 有什么，多一个文件、少一个文件、或者出现 reparse point（符号链接）都会被 CI 拒绝。
 *
 * 但开发机上 `plugins/<id>/node_modules/<pkg>` 是指向 `apps/desktop/node_modules`
 * 的相对**符号链接**，这类链接进不了快照。于是 CI 必须在
 * 「Install and verify desktop runtime closure」这一步用**目录联接（junction）**
 * 把它们重建出来 —— 而重建清单是**硬编码在 workflow 里的**。
 *
 * 于是就有了这个坑：**改了插件依赖，却忘了更新那份硬编码清单**。后果不是报个警告，
 * 而是 `npm run test:package-resources` 在 `import` 每个被暂存插件入口时解析不到
 * 依赖直接失败 —— 整轮出包白跑。
 *
 * 本脚本把那份清单**算出来**：以 `prepare-mochi-resources.cjs` 的 `PLUGINS`
 * 白名单为准，取每个被暂存插件在 `node_modules/` 下**真实存在**的依赖，再与
 * `apps/desktop/node_modules` 求交（只有桌面端真的提供了的包才可能成为链接目标）。
 *
 * 用法
 * ----
 *   node tools/derive-plugin-links.mjs              # 打印清单 + 差异报告
 *   node tools/derive-plugin-links.mjs --powershell # 只输出可直接粘进 workflow 的块
 *
 * 平台专属包会被剔除（`@napi-rs/canvas-darwin-arm64`、`@esbuild/win32-x64` …）。
 * 原因：它们由目标包**自身**的 realpath 去解析 —— 例如 `@napi-rs/canvas` 会从
 * `apps/desktop/node_modules/@napi-rs/canvas` 旁边找它自己那条平台依赖，所以不需要
 * 插件级链接。把它们列进清单反而有害：开发机是 macOS，桌面端装的是 darwin 版，
 * 到了 windows runner 上这个目标不存在，旧写法直接 `throw` 就会误杀整轮出包。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO = path.resolve(import.meta.dirname, "..");
const PREPARE_SCRIPT = path.join(REPO, "apps/desktop/scripts/prepare-mochi-resources.cjs");
const DESKTOP_NODE_MODULES = path.join(REPO, "apps/desktop/node_modules");

/** 平台专属二进制的命名特征：出现在包名任意一段即视为平台专属。 */
const PLATFORM_SPECIFIC = /(?:^|[/-])(darwin|win32|windows|linux|android|freebsd|openbsd|sunos|musl|arm64|x64|ia32|armv7l)(?:[/-]|$)/i;

function readPlugins() {
  const source = fs.readFileSync(PREPARE_SCRIPT, "utf8");
  // 单行与跨行两种写法都吃：{ id: "x", source: "y" }
  const entries = [...source.matchAll(/id:\s*"([^"]+)"\s*,\s*source:\s*"([^"]+)"/gs)];
  if (entries.length === 0) {
    throw new Error(`没有从 ${path.relative(REPO, PREPARE_SCRIPT)} 解析出任何 PLUGINS 条目`);
  }
  return entries.map((m) => ({ id: m[1], source: m[2] }));
}

/** 列出某个插件 node_modules 下的直接依赖（含 @scope/name 一层）。 */
function listPluginDependencies(source) {
  const modules = path.join(REPO, source, "node_modules");
  if (!fs.existsSync(modules)) return [];
  const names = [];
  for (const entry of fs.readdirSync(modules)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      const scope = path.join(modules, entry);
      if (!fs.statSync(scope).isDirectory()) continue;
      for (const sub of fs.readdirSync(scope)) names.push(`${entry}/${sub}`);
    } else {
      names.push(entry);
    }
  }
  return names;
}

function main() {
  const onlyPowerShell = process.argv.includes("--powershell");
  const plugins = readPlugins();

  if (!fs.existsSync(DESKTOP_NODE_MODULES)) {
    throw new Error(
      `找不到 ${path.relative(REPO, DESKTOP_NODE_MODULES)}：先在本机（开发机）装齐 apps/desktop 依赖再跑本脚本。`,
    );
  }

  const rows = [];
  const report = [];

  for (const { id, source } of plugins) {
    const names = listPluginDependencies(source);
    const provided = [];
    const platformSkipped = [];
    const absent = [];

    for (const name of names) {
      if (!fs.existsSync(path.join(DESKTOP_NODE_MODULES, name))) {
        absent.push(name);
        continue;
      }
      if (PLATFORM_SPECIFIC.test(name)) platformSkipped.push(name);
      else provided.push(name);
    }

    provided.sort();
    for (const name of provided) {
      rows.push({ id, link: `${source}/node_modules/${name}`, target: name });
    }
    report.push({ id, source, links: provided.length, platformSkipped, absent });
  }

  if (onlyPowerShell) {
    console.log("          $pluginLinks = @(");
    rows.forEach((row, index) => {
      const tail = index === rows.length - 1 ? "" : ",";
      console.log(`            @("${row.link}", "${row.target}")${tail}`);
    });
    console.log("          )");
    return;
  }

  console.log(`PLUGINS 白名单：${plugins.length} 个插件`);
  console.log("");
  console.log("每个插件的链接情况：");
  for (const row of report) {
    console.log(
      `  ${row.id.padEnd(22)} ${String(row.links).padStart(3)} 条链接` +
        (row.platformSkipped.length ? `，剔除平台专属 ${row.platformSkipped.length}` : "") +
        (row.absent.length ? `，桌面端没有 ${row.absent.length}` : ""),
    );
    for (const name of row.platformSkipped) console.log(`        剔除: ${name}`);
    for (const name of row.absent) console.log(`        桌面端无: ${name}`);
  }

  console.log("");
  console.log(`合计 ${rows.length} 条需要重建的链接。`);
  console.log("");
  console.log("把下面整块替换进私有出包分支 workflow 的 $pluginLinks：");
  console.log("");
  console.log("          $pluginLinks = @(");
  rows.forEach((row, index) => {
    const tail = index === rows.length - 1 ? "" : ",";
    console.log(`            @("${row.link}", "${row.target}")${tail}`);
  });
  console.log("          )");
  console.log("");
  console.log(
    "⚠️ 替换后请一并核对 workflow 里的 $requiredLinks（经验证必需的硬失败子集）" +
      "是否仍然都被覆盖 —— 缺一条会在 CI 上直接失败。",
  );
}

main();
