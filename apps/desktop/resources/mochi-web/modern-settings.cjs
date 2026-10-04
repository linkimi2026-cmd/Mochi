"use strict";
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createRequire } = require("node:module");
const { migrateMimoConfig } = require("./modern-models.cjs");

const SECTIONS = {
  "ui-theme": ["ui-theme", "dsh-client-ui-theme"],
  locale: ["locale", "dsh-client-locale"],
  "ui-chat": ["ui-chat", "dsh-client-ui-chat"],
  "ui-conversation": ["ui-conversation", "dsh-client-ui-conversation"],
  "ui-onboarding": ["ui-onboarding", "dsh-client-ui-settings-general"],
  "ui-settings-general": ["ui-settings-general", "dsh-client-ui-settings-general"],
  "ui-developer-tools": ["ui-developer-tools", "dsh-client-ui-settings"],
  "ui-settings": ["ui-settings", "dsh-client-ui-settings"],
  "agent-default-model": ["agent-default-model", "dsh-agent-default-model"],
  "agent-loop": ["agent-loop", "dsh-agent-loop"],
  permission: ["permission", "dsh-permission-presets"],
  "web-search-deepseek": ["web-search-deepseek", "dsh-web-search-deepseek"],
  "llm-deepseek": ["llm-deepseek", "dsh-llm-deepseek-api-key"],
  "llm-pi-ai": ["llm-pi-ai", "dsh-llm-pi-ai"],
  "dsh-better-sidebar": ["dsh-better-sidebar", "dsh-better-sidebar"],
};
const DEEPSEEK_ROUTE = "deepseek-official";
const OFFICIAL_ENDPOINTS = new Set(["https://api.deepseek.com", "https://api.deepseek.com/", "https://api.deepseek.com/v1", "https://api.deepseek.com/anthropic"]);
const LEGACY_EFFORTS = ["off", "low", "medium", "high", "max"];
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function checkFields(section, value, schema, volatileOnly = false) {
  if (!record(value)) throw new Error(`旧设置 ${section} 必须为对象；原文件未修改`);
  for (const key of Object.keys(value)) if (!Object.hasOwn(schema.dict ?? {}, key)) {
    throw new Error(`旧设置 ${section}.${key} 尚未迁移；原文件未修改`);
  }
  if (volatileOnly) for (const key of Object.keys(value)) if (schema.dict[key].meta.volatile !== true) {
    throw new Error(`旧设置 ${section}.${key} 需要独立配置迁移；原文件未修改`);
  }
  try { schema(value); } catch { throw new Error(`旧设置 ${section} 未通过新版 schema；原文件未修改`); }
}

/** The installed alpha adapter spoke Chat Completions, including on custom URLs. */
function migrateDeepSeekGateway(values, z, piAi) {
  const modelSchema = z.object({ id: z.string().required(), name: z.string(), description: z.string(),
    contextWindow: z.number().step(1).min(1), maxTokens: z.number().step(1).min(1),
    inputModalities: z.array(z.union(["text", "image"])).min(1).default(["text"]), reasoningEfforts: z.array(z.union(LEGACY_EFFORTS)) });
  checkFields("llm-deepseek", values, z.object({ apiKeyEnv: z.string(), baseURL: z.string().required(),
    thinking: z.union(["enabled", "disabled"]), reasoningEffort: z.union(LEGACY_EFFORTS),
    models: z.array(modelSchema).min(1).required(), maxTokens: z.number().step(1).min(1),
    defaultContextWindow: z.number().step(1).min(1), streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE),
    retryPolicy: piAi.Config.dict.providers.inner.dict.retryPolicy }));
  let endpoint;
  try { endpoint = new URL(values.baseURL); } catch { throw new Error("旧 DeepSeek 网关地址无效；原文件未修改"); }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error("旧 DeepSeek 网关地址无效；原文件未修改");
  if (values.thinking === "disabled" && values.reasoningEffort && values.reasoningEffort !== "off") throw new Error("旧 DeepSeek 思考开关与档位冲突；原文件未修改");
  const seen = new Set();
  const models = values.models.map(model => {
    checkFields("llm-deepseek.models", model, modelSchema);
    if (!model.id || seen.has(model.id)) throw new Error("旧 DeepSeek 模型 id 为空或重复；原文件未修改");
    seen.add(model.id);
    const { inputModalities, reasoningEfforts, ...rest } = model;
    const levels = reasoningEfforts?.length ? reasoningEfforts : LEGACY_EFFORTS;
    if (new Set(levels).size !== levels.length || (values.thinking === "disabled" && !levels.includes("off"))) throw new Error("旧 DeepSeek 模型档位冲突；原文件未修改");
    return { ...rest, input: inputModalities ?? ["text"],
      reasoningEfforts: levels.every(level => level === "off") ? false : Object.fromEntries(levels.map(level => [level, level === "off" ? null : level])),
      maxTokens: model.maxTokens ?? values.maxTokens ?? 256000, contextWindow: model.contextWindow ?? values.defaultContextWindow ?? 1000000 };
  });
  const route = { api: "openai-completions", displayName: "DeepSeek", baseURL: values.baseURL,
    apiKeyEnv: values.apiKeyEnv ?? "DEEPSEEK_API_KEY", models,
    reasoning: values.reasoningEffort ?? (values.thinking === "disabled" ? "off" : "high"),
    compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: "max_tokens", thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true },
    ...(values.streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs: values.streamIdleTimeoutMs }),
    ...(values.retryPolicy === undefined ? {} : { retryPolicy: values.retryPolicy }) };
  // Validate the profile itself: Config's volatile wrapper is not a plain-value parser.
  try { piAi.Config.dict.providers.inner(route); } catch { throw new Error("旧 DeepSeek 网关未通过新版 provider schema；原文件未修改"); }
  return route;
}

function disableLegacyDeepSeek(patch, nodeModules, defaultModel, gatewayRoute) {
  const yaml = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"))("yaml");
  const doc = yaml.parseDocument(patch, { logLevel: "silent" });
  if (doc.errors.length || !yaml.isSeq(doc.contents)) throw new Error("DeepSeek 迁移无法解析 profile patch；原文件未修改");
  const disabled = doc.contents.items.some(row => yaml.isMap(row) && row.get("id") === "llm-deepseek" && row.get("disabled") === true);
  // Keep migrated selection outside the block regenerated by Mochi. Upstream
  // edits the owning patch row in place; a managed row would be reset next boot.
  return patch + (disabled ? "" : "\n# Legacy custom DeepSeek gateway is owned by llm-pi-ai after migration.\n- id: llm-deepseek\n  disabled: true\n")
    + (gatewayRoute ? "\n" + yaml.stringify([{ id: "llm-pi-ai", config: { providers: { [DEEPSEEK_ROUTE]: gatewayRoute } } }]) : "")
    + (defaultModel ? "\n# Preserve the legacy default selection across managed profile regeneration.\n" + yaml.stringify([{ id: "agent-default-model", config: defaultModel }]) : "");
}

/** Validate before provisioning; let upstream import unchanged supported sections. */
function planLegacySettings({ homeDir, nodeModules, manifest, themeRoot, role }) {
  const path = join(homeDir, "settings.yaml");
  if (!existsSync(path)) return undefined;
  const require = createRequire(join(nodeModules, "@deepseek-ai/dsh/package.json"));
  const yaml = require("yaml");
  const source = readFileSync(path, "utf8");
  const doc = yaml.parseDocument(source);
  if (doc.errors.length || (doc.contents !== null && !yaml.isMap(doc.contents))) throw new Error("旧设置文档格式无效；原文件未修改");
  const schemastery = require("@deepseek-ai/schemastery");
  const z = schemastery.default ?? schemastery;
  const palettes = JSON.parse(readFileSync(join(themeRoot, "assets/mochi-palettes.json"), "utf8"));
  let changed = false;
  let disableDeepSeek = false;
  const sections = doc.toJS() ?? {};
  for (const [section, values] of Object.entries(sections)) {
    if (section === "agent-presets") {
      if (role !== "teacher") throw new Error("教室旧设置包含教师预设选择；原文件未修改");
      checkFields(section, values, z.object({ default: z.string().required() }));
      if (!["lesson-planning", "materials-assessment", "grade-analysis", "classroom-coordination", "standard", "minimal", "ptc", "cordis"].includes(values.default)) {
        throw new Error("旧设置选择了尚未迁移的自定义预设；原文件未修改");
      }
      if (doc.has("agent-preset-registry")) throw new Error("新旧 Agent 默认预设设置冲突；原文件未修改");
      doc.set("agent-preset-registry", { selectedDefault: values.default });
      doc.delete(section); changed = true; continue;
    }
    if (section === "mochi-llm-mimo") {
      if (!record(values)) throw new Error("旧 MiMo 设置必须为对象；原文件未修改");
      const config = migrateMimoConfig({ ...manifest.plugins[section].initialConfig, ...values });
      const existing = doc.toJS()["llm-pi-ai"] ?? {};
      if (existing.providers?.["mochi-mimo"] && JSON.stringify(existing.providers["mochi-mimo"]) !== JSON.stringify(config.providers["mochi-mimo"])) {
        throw new Error("新旧 MiMo 提供方设置冲突；原文件未修改");
      }
      const merged = { ...existing, providers: { ...existing.providers, ...config.providers } };
      checkFields("llm-pi-ai", merged, require("@deepseek-ai/dsh-llm-pi-ai").Config);
      doc.set("llm-pi-ai", merged); doc.delete(section); changed = true; continue;
    }
    if (section === "jxl-theme") {
      checkFields(section, values, z.object({ uiSound: z.boolean(), petPalette: z.union(palettes.map(x => x.id)),
        campusBackground: z.union(["paper", "watercolor", "campus-route", "ginkgo-walkway"]) }));
      continue;
    }
    if (section === "llm-deepseek" && record(values) && values.baseURL && !OFFICIAL_ENDPOINTS.has(values.baseURL)) {
      const piAi = require("@deepseek-ai/dsh-llm-pi-ai");
      const route = migrateDeepSeekGateway(values, z, piAi);
      const existing = doc.toJS()["llm-pi-ai"] ?? {};
      if (existing.providers?.[DEEPSEEK_ROUTE] && !require("node:util").isDeepStrictEqual(existing.providers[DEEPSEEK_ROUTE], route)) {
        throw new Error("新旧 DeepSeek 提供方设置冲突；原文件未修改");
      }
      doc.set("llm-pi-ai", { ...existing, providers: { ...existing.providers, [DEEPSEEK_ROUTE]: route } });
      doc.delete(section); changed = true; disableDeepSeek = true; continue;
    }
    if (section === "agent-preset-registry") {
      checkFields(section, values, z.object({ selectedDefault: z.string() }));
      continue;
    }
    if (section === "dsh-better-sidebar" && record(values) && Object.hasOwn(values, "workspaceFence")) {
      if (values.workspaceFence !== false) throw new Error("旧侧栏 workspaceFence 防护不能由新版保留；原文件未修改");
      // Upstream 0.23 removed this restriction. False already allowed access
      // outside the workspace; removing it changes no existing restriction.
      doc.deleteIn([section, "workspaceFence"]); changed = true;
    }
    let target = SECTIONS[section];
    if (section === "shell") target = ["shell", process.platform === "win32" ? "dsh-pwsh-sandbox" : "dsh-bash-sandbox"];
    if (!target) throw new Error(`旧设置 ${section} 尚未确认可迁移；原文件未修改`);
    const module = require(target[1].startsWith("dsh-better") ? target[1] : "@deepseek-ai/" + target[1]);
    checkFields(section, doc.toJS()[section], module.Config ?? module.default?.Config, true);
    if (section === "llm-deepseek" && values.baseURL && values.baseURL !== "https://api.deepseek.com/anthropic") {
      doc.setIn([section, "baseURL"], "https://api.deepseek.com/anthropic"); changed = true;
    }
  }
  if (!changed) return undefined;
  const backupPath = join(homeDir, ".mochi-settings-legacy.yaml");
  if (existsSync(backupPath) && readFileSync(backupPath, "utf8") !== source) throw new Error("旧设置备份已存在不同内容；原文件未修改");
  return { path, backupPath, source, content: String(doc), disableDeepSeek,
    gatewayRoute: disableDeepSeek ? doc.toJS()["llm-pi-ai"].providers[DEEPSEEK_ROUTE] : undefined,
    defaultModel: disableDeepSeek && sections["agent-default-model"]?.provider === DEEPSEEK_ROUTE ? sections["agent-default-model"] : undefined };
}
module.exports = { planLegacySettings, disableLegacyDeepSeek };
