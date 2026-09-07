#!/usr/bin/env node
/**
 * Build the browser ModuleLoader contribution from the pinned pi-ai catalog.
 *
 * The UI carries presentation metadata only. Endpoint, protocol, provider
 * name, model count, and pi-ai version are read from the exact runtime package
 * staged by the desktop app; no second list of model ids is maintained here.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const pluginDirectory = dirname(scriptDirectory);
const workspaceDirectory = dirname(dirname(pluginDirectory));
const templatePath = join(pluginDirectory, "src", "client.template.js");
const outputPath = join(pluginDirectory, "client.js");
const piDirectory = join(workspaceDirectory, "apps", "desktop", "node_modules", "@earendil-works", "pi-ai");
const PLACEHOLDER = "/* __MOCHI_MODEL_PRESET_CATALOG__ */";

/** The only hand-curated data: human-facing labels and their official docs. */
const curatedProviders = Object.freeze([
  {
    route: "zai",
    label: "Z.AI GLM Coding Plan（国际）",
    summary: "GLM Coding Plan 的国际 OpenAI Chat Completions 端点。",
    official: {
      title: "Z.AI GLM Coding Plan 快速开始",
      url: "https://docs.z.ai/devpack/quick-start",
    },
  },
  {
    route: "zai-coding-cn",
    label: "智谱 GLM Coding Plan（中国区）",
    summary: "GLM Coding Plan 中国区的 OpenAI Chat Completions 端点。",
    official: {
      title: "智谱 GLM Coding Plan 快速开始",
      url: "https://docs.bigmodel.cn/cn/coding-plan/quick-start",
    },
  },
  {
    route: "moonshotai-cn",
    label: "Kimi API（月之暗面）",
    summary: "Kimi 的 OpenAI Chat Completions 目录路线。",
    official: {
      title: "Kimi API 获取密钥与调用方式",
      url: "https://platform.kimi.com/docs/get-api-key",
    },
  },
  {
    route: "minimax-cn",
    label: "MiniMax API",
    summary: "MiniMax 的 Anthropic Messages 目录路线。",
    official: {
      title: "MiniMax Anthropic API 文档",
      url: "https://platform.minimaxi.com/document/Anthropic_API",
    },
  },
  {
    route: "deepseek",
    label: "DeepSeek 官方 API",
    summary: "DeepSeek 的 OpenAI Chat Completions 目录路线。",
    official: {
      title: "DeepSeek API 文档",
      url: "https://api-docs.deepseek.com/",
    },
  },
]);

function requireFact(condition, message) {
  if (!condition) throw new Error(`[mochi-model-presets] ${message}`);
}

function protocolLabel(protocol) {
  if (protocol === "openai-completions") return "OpenAI Chat Completions";
  if (protocol === "anthropic-messages") return "Anthropic Messages";
  return protocol;
}

function apiFromProviderSource(source, route) {
  requireFact(source.includes(`id: \"${route}\"`), `provider source does not identify route ${route}`);
  const name = /name:\s*\"([^\"]+)\"/.exec(source)?.[1];
  const baseUrl = /baseUrl:\s*\"([^\"]+)\"/.exec(source)?.[1];
  const credentialRef = /envApiKeyAuth\(\s*\"[^\"]+\"\s*,\s*\[\s*\"([^\"]+)\"\s*\]\s*\)/.exec(source)?.[1];
  const api = source.includes("openAICompletionsApi()")
    ? "openai-completions"
    : source.includes("anthropicMessagesApi()")
      ? "anthropic-messages"
      : undefined;
  requireFact(
    name !== undefined && baseUrl !== undefined && credentialRef !== undefined && api !== undefined,
    `could not read provider facts for ${route}`,
  );
  return { name, baseUrl, credentialRef, api };
}

async function catalogEntry(definition) {
  const [providerSource, catalogSource] = await Promise.all([
    readFile(join(piDirectory, "dist", "providers", `${definition.route}.js`), "utf8"),
    readFile(join(piDirectory, "dist", "providers", "data", `${definition.route}.json`), "utf8"),
  ]);
  const provider = apiFromProviderSource(providerSource, definition.route);
  const grouped = JSON.parse(catalogSource);
  const groups = Object.entries(grouped);
  requireFact(groups.length === 1, `${definition.route} has ${groups.length} catalog protocols, expected one`);
  const [catalogProtocol, group] = groups[0];
  requireFact(catalogProtocol === provider.api, `${definition.route} protocol differs between source and model catalog`);
  const models = Object.values(group);
  requireFact(models.length > 0, `${definition.route} has no installed catalog models`);
  const endpoints = new Set(models.map((model) => model?.baseUrl));
  requireFact(endpoints.size === 1 && endpoints.has(provider.baseUrl), `${definition.route} endpoint differs between source and model catalog`);
  return Object.freeze({
    route: definition.route,
    label: definition.label,
    summary: definition.summary,
    official: definition.official,
    providerName: provider.name,
    protocol: provider.api,
    protocolLabel: protocolLabel(provider.api),
    endpoint: provider.baseUrl,
    modelCount: models.length,
    credentialRef: provider.credentialRef,
  });
}

async function buildCatalog() {
  const packageJson = JSON.parse(await readFile(join(piDirectory, "package.json"), "utf8"));
  requireFact(typeof packageJson.version === "string" && packageJson.version.length > 0, "pi-ai package has no version");
  const presets = await Promise.all(curatedProviders.map(catalogEntry));
  return Object.freeze({
    piAiVersion: packageJson.version,
    source: "@earendil-works/pi-ai installed runtime catalog",
    presets,
    notices: [
      {
        title: "智谱普通 API 与 Coding Plan 分开",
        endpoint: "https://api.z.ai/api/paas/v4",
        official: {
          title: "Z.AI 普通 API 快速开始",
          url: "https://docs.z.ai/guides/overview/quick-start",
        },
        body: "普通 API 的地址与上方 GLM Coding Plan 路线不同。当前本机 pi-ai 目录只提供 Coding Plan 的 zai 与 zai-coding-cn 路线；本卡不会把普通 API 密钥改填到 Coding Plan 端点。",
      },
    ],
  });
}

const [template, catalog] = await Promise.all([readFile(templatePath, "utf8"), buildCatalog()]);
requireFact(template.includes(PLACEHOLDER), "client template is missing the catalog placeholder");
const browserSource = template.replace(PLACEHOLDER, JSON.stringify(catalog, null, 2));
const client = `window.__ModuleLoader__.load({\n`
  + `\tid: \"mochi-model-presets\",\n`
  + `\tfactory: (require) => {\n`
  + `\t\tvar module = { exports: {} };\n`
  + `\t\tvar exports = module.exports;\n`
  + `\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: \"Module\" });\n`
  + browserSource.split("\n").map((line) => `\t\t${line}`).join("\n")
  + `\n\t\treturn module.exports;\n`
  + `\t}\n`
  + `});\n`;

await writeFile(outputPath, client, "utf8");
console.log(`[mochi-model-presets] client.js built from pi-ai ${catalog.piAiVersion}; ${catalog.presets.length} catalog routes`);
