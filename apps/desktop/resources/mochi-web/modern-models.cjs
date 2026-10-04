"use strict";
const { createRequire } = require("node:module");
const { isDeepStrictEqual } = require("node:util");
const { join } = require("node:path");
const PROVIDER = "mochi-mimo";
const FIELDS = new Set(["apiKeyEnv", "baseURL", "reasoningEffort", "models", "headers", "retryPolicy"]);
const LEGACY_EFFORTS = ["off", "low", "medium", "high", "max"];
const MODEL_FIELDS = new Set(["id", "name", "contextWindow", "maxTokens", "inputModalities", "reasoningEfforts"]);

function migrateMimoConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("MiMo 配置必须是对象");
  for (const key of Object.keys(config)) if (!FIELDS.has(key)) throw new Error(`MiMo 配置字段尚未迁移：${key}`);
  if (!Array.isArray(config.models) || !config.models.length) throw new Error("MiMo 迁移需要保留显式模型目录");
  const models = config.models.map(model => {
    for (const key of Object.keys(model)) if (!MODEL_FIELDS.has(key)) throw new Error(`MiMo 模型字段尚未迁移：${key}`);
    const { inputModalities, reasoningEfforts, ...rest } = model;
    const levels = reasoningEfforts?.length ? reasoningEfforts : LEGACY_EFFORTS;
    return { ...rest, ...(inputModalities ? { input: inputModalities } : {}),
      reasoningEfforts: levels.every(level => level === "off") ? false : Object.fromEntries(levels.map(level => [level, level === "off" ? null : level])) };
  });
  const { reasoningEffort, ...rest } = config;
  return { providers: { [PROVIDER]: {
    ...rest, models, displayName: "MiMo", api: "openai-completions",
    compat: { thinkingFormat: "deepseek", maxTokensField: "max_tokens" },
    ...(reasoningEffort ? { reasoning: reasoningEffort } : {}),
  } } };
}

/** Preserve unrelated YAML nodes, comments and tagged expressions without evaluating them. */
function migrateMimoPatch(text, nodeModules) {
  if (!text.includes("mochi-llm-mimo")) return text;
  const yaml = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"))("yaml");
  const doc = yaml.parseDocument(text);
  if (doc.errors.length) throw new Error("MiMo 迁移无法解析现有配置；原文件未修改");
  let changed = false;
  let mimo;
  let legacyModels;
  let existing = {};
  const markers = [];
  let destinationRow;
  function visit(sequence) {
    if (!yaml.isSeq(sequence)) return;
    for (const row of sequence.items) {
      if (!yaml.isMap(row)) continue;
      visit(row.get("insert", true));
      if (row.get("id") === "llm-pi-ai" && row.get("config", true)) { existing = row.get("config", true).toJSON(); destinationRow = row; }
      if (row.get("id") !== "mochi-llm-mimo") continue;
      if (row.get("disabled") === true) {
        const config = row.get("config", true);
        if (config && row.get("name") !== "@deepseek-ai/dsh-llm-pi-ai") markers.push(config.toJSON());
        continue;
      }
      const config = row.get("config", true);
      if (!config) throw new Error("MiMo 迁移缺少完整配置；原文件未修改");
      legacyModels = row.get("name") === "@deepseek-ai/dsh-llm-pi-ai" ? undefined : config.toJSON().models;
      mimo = row.get("name") === "@deepseek-ai/dsh-llm-pi-ai" ? config.toJSON() : migrateMimoConfig(config.toJSON());
      // Keep the source row as a disabled migration marker, preserving its original values.
      row.set("disabled", true);
      changed = true;
    }
  }
  visit(doc.contents);
  if (!changed && destinationRow && existing.providers?.[PROVIDER]) {
    const route = existing.providers[PROVIDER];
    for (const marker of markers) {
      let expected;
      try { expected = migrateMimoConfig(marker).providers[PROVIDER]; } catch { continue; }
      const implicit = new Set(marker.models.filter(model => !model.reasoningEfforts?.length).map(model => model.id));
      const normalize = value => ({ ...value, models: value.models?.map(model => {
        if (!implicit.has(model.id)) return model;
        const { reasoningEfforts, ...rest } = model; return rest;
      }) });
      if (JSON.stringify(normalize(route)) !== JSON.stringify(normalize(expected))) continue;
      const models = destinationRow.get("config", true).get("providers", true).get(PROVIDER, true).get("models", true);
      for (const model of models.items) {
        if (implicit.has(model.get("id")) && !model.has("reasoningEfforts")) {
          model.set("reasoningEfforts", expected.models.find(old => old.id === model.get("id")).reasoningEfforts);
        }
      }
    }
  }
  if (changed) {
    let route = mimo.providers[PROVIDER];
    const destinationRoute = existing.providers?.[PROVIDER];
    if (destinationRoute && legacyModels) {
      // Only legacy models without an explicit list inherit the old adapter defaults.
      // Preserve any explicit modern capability, including false and narrower levels.
      const implicit = new Set(legacyModels.filter(model => !model.reasoningEfforts?.length).map(model => model.id));
      const normalize = value => ({ ...value, models: value.models?.map(model => {
        if (!implicit.has(model.id)) return model;
        const { reasoningEfforts, ...rest } = model; return rest;
      }) });
      if (JSON.stringify(normalize(destinationRoute)) === JSON.stringify(normalize(route))) {
        route = { ...route, models: route.models.map(model => {
          const previous = destinationRoute.models.find(x => x.id === model.id);
          return implicit.has(model.id) && Object.hasOwn(previous, "reasoningEfforts") ? { ...model, reasoningEfforts: previous.reasoningEfforts } : model;
        }) };
      }
    }
    if (destinationRoute && JSON.stringify(destinationRoute) !== JSON.stringify(route)) {
      const before = JSON.parse(JSON.stringify(route));
      for (const model of before.models) if (legacyModels?.some(old => old.id === model.id && !old.reasoningEfforts?.length)
        && !Object.hasOwn(destinationRoute.models?.find(x => x.id === model.id) ?? {}, "reasoningEfforts")) delete model.reasoningEfforts;
      if (JSON.stringify(destinationRoute) !== JSON.stringify(before)) throw new Error("MiMo 新旧提供方配置冲突；原文件未修改");
    }
    const destination = { id: "llm-pi-ai", name: "@deepseek-ai/dsh-llm-pi-ai", config: {
      ...existing, providers: { ...existing.providers, [PROVIDER]: route },
    } };
    return String(yaml.parseDocument(String(doc) + "\n" + yaml.stringify([destination]))).replace(/\n\n(# <<< Mochi managed runtime profile <<<)/, "\n$1");
  }
  return String(doc);
}
/** A providers dict is replaced as a whole by a later config row in rc.2.
 * Consolidate disjoint declarations before import/start; never choose between conflicts.
 */
function consolidatePiAiPatch(text, nodeModules) {
  if (!text.includes("llm-pi-ai")) return text;
  const yaml = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"))("yaml");
  const doc = yaml.parseDocument(text, { logLevel: "silent" });
  if (doc.errors.length) throw new Error("pi-ai 配置无法解析；原文件未修改");
  const rows = [];
  function visit(sequence) {
    if (!yaml.isSeq(sequence)) return;
    for (const row of sequence.items) {
      if (!yaml.isMap(row)) continue;
      visit(row.get("insert", true));
      const config = row.get("config", true);
      if (row.get("id") === "llm-pi-ai" && row.get("disabled") !== true && yaml.isMap(config) && config.has("providers")) rows.push(row);
    }
  }
  visit(doc.contents);
  if (rows.length < 2) return text;
  const merged = doc.createNode({});
  const values = new Map();
  for (const row of rows) {
    const providers = row.get("config", true).get("providers", true);
    if (!yaml.isMap(providers)) throw new Error("pi-ai 提供方配置无法无损合并；原文件未修改");
    for (const pair of providers.items) {
      const id = pair.key.value, value = pair.value.toJSON();
      if (values.has(id) && !isDeepStrictEqual(values.get(id), value)) throw new Error(`pi-ai 提供方配置冲突：${id}；原文件未修改`);
      values.set(id, value);
      if (!merged.has(id)) merged.set(pair.key.clone(), pair.value.clone());
    }
  }
  for (const row of rows.slice(0, -1)) {
    const config = row.get("config", true); config.delete("providers");
    if (!config.items.length) row.delete("config");
  }
  rows.at(-1).get("config", true).set("providers", merged);
  return String(doc);
}
module.exports = { migrateMimoConfig, migrateMimoPatch, consolidatePiAiPatch };
