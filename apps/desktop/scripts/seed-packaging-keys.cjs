"use strict";

/**
 * Build-time packaging key seeding (MOCHI-WIN-PACK-01 WO-3).
 *
 * Reads the local uncommitted key file `secrets/packaging-keys.local.yaml`
 * (or, on CI, GitHub Secrets injected environment variables) and renders the
 * first-run seed files consumed by the Electron main process into
 * `resources/mochi-web/seeds/`:
 *
 *   - credentials-seed.json    refs to merge into `<home>/.credentials.yaml`
 *   - settings-defaults.json   default model chain for `settings.yaml`
 *
 * Key values only ever live in the gitignored secrets file / CI environment
 * and the generated gitignored seeds directory — never in tracked files,
 * logs, or reports. When neither source is available the build proceeds with
 * a warning (the packaged app falls back to the settings-page path), so CI
 * without secrets does not break.
 */

const { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, fchmodSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(desktopRoot, "..", "..");
const SECRETS_FILENAME = "secrets/packaging-keys.local.yaml";
const SEEDS_DIRNAME = "apps/desktop/resources/mochi-web/seeds";

// 2026-09-12 用户拍板：出厂默认对话模型 = mochi-aiaaa / deepseek-v4.1-flash。
// 依据（同日实测）：aiaaa 端点多轮探针稳态缓存命中 99.22%、89 个工具 schema 全量下发工具调用正常；
// 图片输入两次实测（1x1 红/蓝 PNG）均被接受且能区分颜色系——所以默认模型直接声明 image 模态，
// 看图不回退。内核对带图消息只校验「当前模型」的 inputModalities（dsh-api-session-controller
// prompt()，无自动切模型兜底），默认模型必须自己带 image。MiMo 降为备选（教室端仍用 MiMo）。
// 下面的 AUTHORITATIVE_PROVIDERS.aiaaa.defaultModel 即出厂默认；切换默认只改这张表，seeds 构建期重渲染。

// ── aiaaa 网关的模型能力事实（2026-09-18 实测，见 docs/gateway-aiaaa-verified-facts.md）──
// 为什么必须在这里显式声明：`mochi-aiaaa` 不是 pi-ai 内置目录里的 provider，
// 所以 llm-pi-ai 的 resolveRouteModels 拿不到任何 catalog 基线，未声明的字段一律落到
// pi-ai 的兜底（contextWindow 262,144 / maxTokens 32,768），既不是模型的真实能力，
// 也不反映网关行为。实测结论：
//   · 上下文：811,622 prompt token 实测通过；约 1.53M token 被 400
//     `Input token exceed the limit` 拒绝。取 1,000,000 —— 与 pi-ai 内置 deepseek
//     目录、以及 llm-deepseek 的 DEFAULT_CONTEXT_WINDOW 三处一致。
//   · 输出上界：网关不校验 max_tokens（2,000,000 亦被接受，且不挤占上下文预算：
//     387,977 prompt + max_tokens 384,000 仍 200）。取 llm-deepseek 对 DeepSeek 的
//     惯例值 256,000，而非 pi-ai 的 32,768 兜底。这个方向是安全侧：声明它等于让
//     未自带配额的请求默认拿到大预算，而本网关的思考后端会先吃掉一部分输出配额
//     （小配额会直接产出空正文，见 core.patch.yml 的 session-title-llm 覆盖）。
const AIAAA_CONTEXT_WINDOW = 1_000_000;
const AIAAA_MAX_TOKENS = 256_000;

// MOCHI-WIN-PACK-01 WO-3 Provider 实参表（权威）。key 值来自密钥源，本表只持有引用名与端点。
const AUTHORITATIVE_PROVIDERS = Object.freeze([
  {
    providerId: "mochi-mimo",
    baseURL: "https://mimo.ezlook.top/v1",
    apiKeyEnv: "MIMO_API_KEY",
    role: "备选对话模型（教室端主力）",
    defaultModel: { id: "mimo-v2.5", name: "MiMo v2.5" },
    seedEnvVar: "MOCHI_SEED_MIMO_API_KEY",
  },
  {
    providerId: "mochi-aiaaa",
    baseURL: "https://aiaaa.cc/v1",
    apiKeyEnv: "MOCHI_AIAAA_API_KEY",
    role: "出厂默认对话 + 视觉模型",
    defaultModel: {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      contextWindow: AIAAA_CONTEXT_WINDOW,
      maxTokens: AIAAA_MAX_TOKENS,
    },
    visionModel: {
      id: "deepseek-v4-flash-vision-exp",
      name: "DeepSeek Expert Visual",
      contextWindow: AIAAA_CONTEXT_WINDOW,
      maxTokens: AIAAA_MAX_TOKENS,
    },
    seedEnvVar: "MOCHI_SEED_MOCHI_AIAAA_API_KEY",
  },
]);

// `deepseek-v4.1-flash-expires-on-0910` 名字自带 9/10 过期，禁用——不进任何种子。
const FORBIDDEN_MODEL_SUBSTRING = "expires-on-";

function isPlainScalar(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Minimal reader for the fixed secrets-file schema (two levels of 2-space
 * nested maps over scalar values). Anything else is a loud failure so a typo
 * can never silently drop a key from the installer.
 */
function parseSecretsFile(text) {
  const result = { providers: {}, credentialsRefs: {} };
  let section = null;
  let provider = null;
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/\t/g, "  ");
    if (line.trim().length === 0 || line.trim().startsWith("#")) continue;
    if (/^\S/.test(line)) {
      const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!match || match[2].trim().length > 0) throw new Error(`secrets 文件第 ${index + 1} 行格式无效（顶层键必须映射到嵌套块）`);
      if (match[1] === "providers" || match[1] === "credentialsRefs") {
        section = match[1];
        provider = null;
      } else {
        throw new Error(`secrets 文件第 ${index + 1} 行含未知顶层键：${match[1]}`);
      }
      continue;
    }
    if (section === null) throw new Error(`secrets 文件第 ${index + 1} 行缩进无效`);
    if (section === "credentialsRefs") {
      const match = line.match(/^ {2}([A-Za-z][A-Za-z0-9_-]*):\s*(\S.*)$/);
      if (!match) throw new Error(`secrets 文件第 ${index + 1} 行 credentialsRefs 条目无效`);
      result.credentialsRefs[match[1]] = match[2].trim();
      continue;
    }
    // providers: two nesting levels
    if (/^ {2}\S/.test(line)) {
      const match = line.match(/^ {2}([A-Za-z][A-Za-z0-9_-]*):\s*$/);
      if (!match) throw new Error(`secrets 文件第 ${index + 1} 行 provider 名无效`);
      provider = match[1];
      result.providers[provider] = {};
      continue;
    }
    const match = line.match(/^ {4}([A-Za-z][A-Za-z0-9_-]*):\s*(\S.*)$/);
    if (!match || provider === null) throw new Error(`secrets 文件第 ${index + 1} 行 provider 字段无效`);
    result.providers[provider][match[1]] = match[2].trim();
  }
  return result;
}

function readLocalSecrets() {
  const path = join(workspaceRoot, SECRETS_FILENAME);
  if (!existsSync(path)) return null;
  const parsed = parseSecretsFile(readFileSync(path, "utf8"));
  const refs = {};
  for (const entry of AUTHORITATIVE_PROVIDERS) {
    const declared = parsed.providers[entry.providerId];
    if (declared !== undefined) {
      if (declared.apiKeyEnv !== entry.apiKeyEnv || declared.baseURL !== entry.baseURL) {
        throw new Error(`secrets 文件 provider ${entry.providerId} 与 WO-3 权威实参表不一致；请对照 docs/tasks/MOCHI-WIN-PACK-01.md`);
      }
      if (declared.defaultModel.includes(FORBIDDEN_MODEL_SUBSTRING)) {
        throw new Error(`secrets 文件 provider ${entry.providerId} 的默认模型带过期标记，禁止打包`);
      }
    }
    const value = parsed.credentialsRefs[entry.apiKeyEnv];
    if (isPlainScalar(value)) refs[entry.apiKeyEnv] = value;
  }
  return refs;
}

function readEnvironmentSecrets(env = process.env) {
  const refs = {};
  for (const entry of AUTHORITATIVE_PROVIDERS) {
    const value = env[entry.seedEnvVar];
    if (isPlainScalar(value)) refs[entry.apiKeyEnv] = value.trim();
  }
  return refs;
}

function assertNoForbiddenModel(models) {
  for (const model of models) {
    if (String(model.id).includes(FORBIDDEN_MODEL_SUBSTRING)) {
      throw new Error(`模型 ${model.id} 带过期标记，禁止进入默认模型链`);
    }
  }
}

function renderSettingsDefaults() {
  const [mimo, aiaaa] = AUTHORITATIVE_PROVIDERS;
  // aiaaa 的 provider 目录 = 对话默认（deepseek-v4.1-flash，图片输入 2026-09-12 实测通过）
  // + 专用视觉模型（deepseek-v4-flash-vision-exp）。两个都声明 image 模态。
  // settings-defaults.json 的 visionProvider 键名沿用历史（内部生成物，seed.ts 原样渲染），
  // 语义已扩展为「aiaaa provider 完整目录：默认对话 + 视觉」。
  const providerModels = [
    {
      id: aiaaa.defaultModel.id,
      name: aiaaa.defaultModel.name,
      contextWindow: aiaaa.defaultModel.contextWindow,
      maxTokens: aiaaa.defaultModel.maxTokens,
      input: ["text", "image"],
    },
    {
      id: aiaaa.visionModel.id,
      name: aiaaa.visionModel.name,
      contextWindow: aiaaa.visionModel.contextWindow,
      maxTokens: aiaaa.visionModel.maxTokens,
      input: ["text", "image"],
    },
  ];
  assertNoForbiddenModel([mimo.defaultModel, ...providerModels]);
  return {
    schemaVersion: 1,
    agentDefaultModel: {
      provider: aiaaa.providerId,
      model: aiaaa.defaultModel.id,
    },
    visionProvider: {
      settingsNamespace: "llm-pi-ai",
      providerId: aiaaa.providerId,
      displayName: "DeepSeek（内置）",
      apiKeyEnv: aiaaa.apiKeyEnv,
      api: "openai-completions",
      baseURL: aiaaa.baseURL,
      models: providerModels,
    },
  };
}

/** Atomic write with owner-only permissions; the seed files carry key values. */
function writeSeedFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    const handle = openSync(temporary, "wx", 0o600);
    try {
      fchmodSync(handle, 0o600);
      writeFileSync(handle, content, "utf8");
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // nothing to clean up
    }
    throw error;
  }
}

/**
 * Build both seed documents. Returns null when no key source is available
 * (caller warns and skips). Never throws on a missing source; throws on a
 * malformed one.
 */
function buildPackagingSeeds({ env = process.env, secretsPath = join(workspaceRoot, SECRETS_FILENAME) } = {}) {
  let refs = null;
  if (existsSync(secretsPath)) {
    refs = readLocalSecrets();
  } else {
    refs = readEnvironmentSecrets(env);
  }
  const available = Object.keys(refs);
  if (available.length === 0) return null;
  return {
    credentialsSeed: { schemaVersion: 1, refs },
    settingsDefaults: renderSettingsDefaults(),
    embeddedRefs: available,
  };
}

function writePackagingSeeds(options = {}) {
  const seeds = buildPackagingSeeds(options);
  const seedsDir = join(workspaceRoot, SEEDS_DIRNAME);
  if (seeds === null) return null;
  writeSeedFile(join(seedsDir, "credentials-seed.json"), `${JSON.stringify(seeds.credentialsSeed, null, 2)}\n`);
  writeSeedFile(join(seedsDir, "settings-defaults.json"), `${JSON.stringify(seeds.settingsDefaults, null, 2)}\n`);
  return seeds;
}

if (require.main === module) {
  try {
    const seeds = writePackagingSeeds();
    if (seeds === null) {
      console.warn(`[mochi] 未找到打包密钥源（${SECRETS_FILENAME} 或 MOCHI_SEED_* 环境变量）；跳过首启种子生成，安装包将在设置页引导教师自行配置。`);
    } else {
      console.log(`[mochi] 已生成首启种子（引用名：${seeds.embeddedRefs.join("、")}），位于 ${SEEDS_DIRNAME}/`);
    }
  } catch (error) {
    console.error(`[mochi] 打包种子生成失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  AUTHORITATIVE_PROVIDERS,
  FORBIDDEN_MODEL_SUBSTRING,
  SECRETS_FILENAME,
  SEEDS_DIRNAME,
  buildPackagingSeeds,
  parseSecretsFile,
  renderSettingsDefaults,
  writePackagingSeeds,
};
