"use strict";
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { createRequire } = require("node:module");

function usesDeclarativePresets(nodeModules) {
  return Boolean(nodeModules && !existsSync(join(nodeModules, "@deepseek-ai/dsh-agent-presets/package.json"))
    && existsSync(join(nodeModules, "@deepseek-ai/dsh-agent-preset/package.json")));
}

function migratePresetPlugins(text, nodeModules) {
  const yaml = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"))("yaml");
  const doc = yaml.parseDocument(text);
  if (doc.errors.length || !yaml.isSeq(doc.contents)) throw new Error("无法迁移预设插件列表");
  for (const row of doc.contents.items) {
    if (!yaml.isMap(row) || row.get("name") !== "@deepseek-ai/dsh-persona") continue;
    const config = row.get("config", true);
    if (!yaml.isMap(config)) throw new Error("预设 persona 缺少配置");
    if (config.has("text")) {
      if (config.has("prefix")) throw new Error("预设 persona 新旧字段冲突");
      const source = config.get("text", true);
      if (!yaml.isScalar(source) || typeof source.value !== "string") throw new Error("预设 persona text 必须是文本");
      config.set("prefix", source);
      config.delete("text");
    }
    if (typeof config.get("prefix") !== "string") throw new Error("预设 persona 缺少 prefix");
  }
  return String(doc).trimEnd();
}

/** Translate product-owned lists; leave tagged platform conditions for Cordis to evaluate. */
function renderDeclarativePresets({ nodeModules, root, defaultPreset, role, homeDir }) {
  const yaml = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"))("js-yaml");
  // Old user presets carry a separate trust boundary. Do not silently elevate them.
  const userRoot = join(homeDir, ".agent-presets");
  if (role === "teacher" && existsSync(userRoot) && readdirSync(userRoot).length) {
    throw new Error("升级前需迁移自定义 Agent 预设；原 .agent-presets 保持不变");
  }
  const rows = [`- id: agent-preset-registry\n  config:\n    default: ${JSON.stringify(defaultPreset)}`];
  if (role === "teacher") {
    const ast = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"))("yaml");
    for (const [index, id] of ["standard", "minimal", "ptc", "cordis"].entries()) {
      const source = ast.parseDocument(readFileSync(join(nodeModules, "@deepseek-ai/dsh-web-app/presets", `${id}.patch.yml`), "utf8"));
      if (source.errors.length) throw new Error(`官方预设 ${id} 无法解析`);
      const config = source.contents.items[0].get("insert", true).items[0].get("config", true).clone();
      config.set("name", id === "standard" ? "通用" : `历史 · ${id}（高级）`);
      config.set("description", id === "standard" ? "日常与校园工作的通用入口，全部已安装工具与协作能力可用；具体操作仍按权限确认。" : "保留旧会话和高级预设的能力与ID。");
      config.set("order", id === "standard" ? 0 : 100 + index);
      if (id === "standard") for (const plugin of config.get("plugins", true).items) {
        if (plugin.get("name") === "@deepseek-ai/dsh-persona") plugin.get("config", true).set("prefix", "我是 Mochi，校园与日常工作伙伴。按用户目标使用当前可用工具与团队协作能力，如实核对身份、来源、工具结果和权限；需要用户确认的操作继续明确确认。");
      }
      rows.push(`- id: preset-${id}\n  config:\n${String(config).trimEnd().split("\n").map(line => `    ${line}`).join("\n")}`);
    }
  }
  if (role === "classroom") {
    for (const id of ["standard", "minimal", "ptc", "cordis"]) rows.push(`- id: preset-${id}\n  disabled: true`);
  }
  const presets = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set();
  for (const entry of presets) {
    const id = entry.name;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`无效预设目录：${id}`);
    const directory = join(root, id);
    const metadata = yaml.load(readFileSync(join(directory, "preset.yml"), "utf8"));
    if (!metadata || typeof metadata.name !== "string" || typeof metadata.description !== "string" || !Number.isFinite(metadata.order)) throw new Error(`无效预设元数据：${id}`);
    const plugins = migratePresetPlugins(readFileSync(join(directory, "agent.cordis.yml"), "utf8"), nodeModules);
    if (!plugins.trim()) throw new Error(`空预设：${id}`);
    rows.push(`- insert:\n    - id: mochi-preset-${id}\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: ${JSON.stringify(id)}\n        name: ${JSON.stringify(metadata.name)}\n        description: ${JSON.stringify(metadata.description)}\n        order: ${metadata.order}\n        plugins:\n${plugins.split("\n").map(line => `          ${line}`).join("\n")}`);
    ids.add(id);
  }
  if (!ids.has(defaultPreset) && !(role === "teacher" && defaultPreset === "standard")) throw new Error(`默认预设不存在：${defaultPreset}`);
  return rows.join("\n\n") + "\n";
}
module.exports = { usesDeclarativePresets, renderDeclarativePresets, migratePresetPlugins };
