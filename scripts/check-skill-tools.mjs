#!/usr/bin/env node
// 技能/文档层工具名守卫。
//
// 为什么需要它：`apps/desktop/scripts/test-package-resources.mjs` 的两层守卫
//   * assertModelFacingToolNames()      —— 只对「已暂存插件重放注册面」得到的工具名断言
//   * assertNoDottedToolNameLiterals()  —— 只遍历 stageRoot/plugins 的源码
// 都不扫 `skills/`。于是 `skills/class-meeting-prep/SKILL.md` 的 `jxl.*` 长时间漏网
// （2026-09-12 实测）。本脚本补上这一段。
//
// 规则（只读；进程退出码 1 表示 R1 命中）：
//   R1 工具名写成点号形态（`jxl.*` / `ppt.create`）——会让模型网关整轮 400 拒收。
//   R2 工具名拼错 / 引用了已改名或用不存在的工具。
//
// 只检查「工具名前缀」开头的 token，避免误伤第三方插件文档里的自有 API 名
// （如 dsh-better-sidebar README 的 `fs.read` / `ctx.effect`）与事件名（`approval.request`）。
//
// 用法：
//   node scripts/check-skill-tools.mjs
//   node scripts/check-skill-tools.mjs --json

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, '..');
const asJson = process.argv.includes('--json');

const MODEL_FACING_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

/** Mochi 工具名的前缀域。点号检查只在这个集合内生效。 */
const TOOL_PREFIXES = [
  'jxl', 'mochi', 'campus', 'file', 'doc', 'pdf', 'ppt',
  'spreadsheet', 'sheet', 'image', 'diagram', 'teaching',
  'calendar', 'task', 'reminder', 'message', 'browser',
];

const BACKTICK = /`([a-z][a-z0-9_.\-]*)`/g;
const PREFIX_RE = new RegExp(`^(${TOOL_PREFIXES.join('|')})([_.])`);
const DOTTED_RE = new RegExp(`^(${TOOL_PREFIXES.join('|')})\\.[a-z][a-z0-9_.\\-]*$`);
const UNDERSCORE_RE = new RegExp(`^(${TOOL_PREFIXES.join('|')})_[a-z][a-z0-9_\\-]*$`);
/** 看着像文件名/版本号而不是工具名的 token，跳过。 */
const LOOKS_LIKE_FILE = /\.(md|mjs|cjs|js|ts|tsx|json|ya?ml|yml|sh|ps1|txt|tgz|lock|html|css|png|jpe?g|svg|webp|ttf|otf|woff2?|pptx?|docx?|xlsx?|csv|tsv|pdf|sqlite|sql|log|map|nosync|v\d+)$/i;
/**
 * 行内抑制标记：该行是**故意展示错误写法**的对照/命名反例。
 * 例：`docs/mochi-naming-convention.md` 用 `mochi.ppt_create` 演示「不要这样写」。
 */
const SUPPRESS = /<!--\s*allow-dotted-tool-name\s*-->/;

/** 1) 测试文件里人工复核过的期望工具名（真值）。 */
function namesFromTestFile() {
  const file = join(workspaceRoot, 'apps', 'desktop', 'scripts', 'test-package-resources.mjs');
  const names = new Set();
  if (!existsSync(file)) return names;
  const re = /assertPluginToolRegistration\(\s*"([^"]+)"\s*,\s*modules\[[^\]]+\]\s*,\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = re.exec(readFileSync(file, 'utf8'))) !== null) {
    for (const t of m[2].matchAll(/"([^"]+)"/g)) names.add(t[1]);
  }
  return names;
}

/** 2) 插件源码静态字面量（覆盖 campus / dispatch 等不走重放的插件）。 */
function namesFromPluginSources() {
  const names = new Set();
  for (const root of ['plugins', 'client-plugins']) {
    const abs = join(workspaceRoot, root);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const dir = join(abs, entry);
      if (!statSync(dir).isDirectory() || entry === 'node_modules') continue;
      const walk = (d, depth) => {
        if (depth > 2) return;
        for (const e of readdirSync(d)) {
          if (['node_modules', 'test', 'docs', 'lib', 'dist', 'assets', '.git'].includes(e)) continue;
          const fp = join(d, e);
          if (statSync(fp).isDirectory()) { walk(fp, depth + 1); continue; }
          if (!/\.(mjs|cjs|js)$/.test(e)) continue;
          const src = readFileSync(fp, 'utf8');
          for (const mm of src.matchAll(/register\(\s*'([a-z][a-z0-9_-]+)'/g)) names.add(mm[1]);
          for (const mm of src.matchAll(/defineTool\(\s*\{\s*name:\s*'([a-z][a-z0-9_-]+)'/g)) names.add(mm[1]);
          for (const mm of src.matchAll(/^\s*name:\s*'([a-z][a-z0-9_-]+)',?\s*$/gm)) names.add(mm[1]);
        }
      };
      try { walk(dir, 0); } catch { /* 不可读则跳过 */ }
    }
  }
  return names;
}

function collectMarkdown(dir, acc = [], depth = 0) {
  if (!existsSync(dir) || depth > 3) return acc;
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'lib', 'vendor', 'release'].includes(e)) continue;
    const fp = join(dir, e);
    if (statSync(fp).isDirectory()) collectMarkdown(fp, acc, depth + 1);
    else if (/\.md$/.test(e)) acc.push(fp);
  }
  return acc;
}

const known = new Set([...namesFromTestFile(), ...namesFromPluginSources()]);

// 只扫 Mochi 自己的技能与现行文档；排除：
//   * 第三方插件（dsh-better-sidebar）的文档 —— 描述它自己的 API，不适用模型可见工具名口径
//   * docs/reference/ —— 第三方系统提示词语料（含大量别的产品的工具名）
//   * docs/tasks/ —— 历史工单，保留了当时（含点号）的原始口径，属 L3 历史证据
const scanRoots = [
  join(workspaceRoot, 'skills'),
];
const docsRoot = join(workspaceRoot, 'docs');
if (existsSync(docsRoot)) {
  for (const e of readdirSync(docsRoot)) {
    if (e === 'reference' || e === 'tasks' || e === 'history') continue;
    const fp = join(docsRoot, e);
    if (statSync(fp).isDirectory()) scanRoots.push(fp);
    else if (/\.md$/.test(e)) scanRoots.push(fp);
  }
}

const files = [...new Set(scanRoots.flatMap((r) => (statSync(r).isDirectory() ? collectMarkdown(r) : [r])))];
const dotted = [];
const unknown = [];

for (const file of files) {
  const rel = relative(workspaceRoot, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (SUPPRESS.test(line)) return;
    for (const m of line.matchAll(BACKTICK)) {
      const token = m[1];
      if (!PREFIX_RE.test(token)) continue;
      if (LOOKS_LIKE_FILE.test(token)) continue;
      if (token.split('.').length > 2) continue;
      if (DOTTED_RE.test(token)) { dotted.push({ file: rel, line: i + 1, token }); continue; }
      if (UNDERSCORE_RE.test(token) && !MODEL_FACING_TOOL_NAME.test(token)) {
        dotted.push({ file: rel, line: i + 1, token });
        continue;
      }
      if (UNDERSCORE_RE.test(token) && !known.has(token)) {
        unknown.push({ file: rel, line: i + 1, token });
      }
    }
  });
}

const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((x) => {
    const k = `${x.file}:${x.line}:${x.token}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const dottedOut = dedupe(dotted);
const unknownOut = dedupe(unknown);

if (asJson) {
  console.log(JSON.stringify({
    scannedFiles: files.length,
    knownToolNames: known.size,
    dotted: dottedOut,
    unknown: unknownOut,
  }, null, 2));
} else {
  console.log(`扫描 ${files.length} 份 markdown；已知工具名 ${known.size} 个。`);
  if (dottedOut.length) {
    console.log(`\n❌ R1 点号工具名（会让模型网关整轮 400 拒收）：${dottedOut.length} 处`);
    for (const d of dottedOut) console.log(`   ${d.file}:${d.line}  \`${d.token}\``);
  }
  if (unknownOut.length) {
    console.log(`\n⚠️  R2 疑似引用了不存在的工具名：${unknownOut.length} 处`);
    for (const d of unknownOut) console.log(`   ${d.file}:${d.line}  \`${d.token}\``);
  }
  if (!dottedOut.length && !unknownOut.length) console.log('\n✅ 无点号工具名，无未知工具名。');
}

process.exit(dottedOut.length ? 1 : 0);
