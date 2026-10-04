"use strict";
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createRequire } = require("node:module");

/** Select the installed candidate; never exempt an incompatible old sidebar. */
function resolveModernSidebar(nodeModules) {
  const target = join(nodeModules, "dsh-better-sidebar");
  let sidebar;
  try { sidebar = JSON.parse(readFileSync(join(target, "package.json"), "utf8")); }
  catch { throw new Error("新版教师内核需要安装兼容的 dsh-better-sidebar，原依赖未修改"); }
  if (sidebar.name !== "dsh-better-sidebar") throw new Error("新版侧栏包身份无效");
  const require = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"));
  const semver = require("semver");
  const runtime = JSON.parse(readFileSync(join(nodeModules, "@deepseek-ai/dsh/package.json"), "utf8"));
  const cordis = JSON.parse(readFileSync(join(nodeModules, "@deepseek-ai/cordis/package.json"), "utf8"));
  for (const [name, range] of Object.entries(sidebar.peerDependencies ?? {})) {
    const version = name === "@deepseek-ai/cordis" ? cordis.version
      : name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-") ? runtime.version : undefined;
    if (version && !semver.satisfies(version, range, { includePrerelease: true })) {
      throw new Error(`新版侧栏 ${sidebar.version} 与 ${name}@${version} 不兼容`);
    }
  }
  return target;
}
module.exports = { resolveModernSidebar };

/** Preserve old preferences for upstream's complete import; seed only a new home. */
function renderModernSidebarDefaults(existing, homeDir, nodeModules) {
  const yaml = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"))("yaml");
  let configured = false;
  function visit(sequence) {
    if (!yaml.isSeq(sequence)) return;
    for (const row of sequence.items) {
      if (!yaml.isMap(row)) continue;
      visit(row.get("insert", true));
      if (row.get("id") === "dsh-better-sidebar" && row.get("disabled") !== true) {
        throw new Error("新版侧栏需迁移用户手写 dsh-better-sidebar 行至官方 better-sidebar；原参数未修改");
      }
      if (row.get("id") === "better-sidebar") configured = true;
    }
  }
  for (const text of [existing.before, existing.after]) {
    const doc = yaml.parseDocument(text);
    if (doc.errors.length) throw new Error("新版侧栏无法解析用户配置；原文件未修改");
    visit(doc.contents);
  }
  if (configured) return "";
  for (const filename of ["settings.yaml", "settings.yaml.imported"]) {
    const path = join(homeDir, filename);
    if (!existsSync(path)) continue;
    const doc = yaml.parseDocument(readFileSync(path, "utf8"));
    if (doc.errors.length || (doc.contents !== null && !yaml.isMap(doc.contents))) throw new Error("原侧栏设置格式无效；原文件未修改");
    if (doc.has("dsh-better-sidebar")) return "";
  }
  return "\n- id: better-sidebar\n  config:\n    agentOpenTools: true\n";
}
module.exports.renderModernSidebarDefaults = renderModernSidebarDefaults;
