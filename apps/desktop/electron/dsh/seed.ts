import {
  closeSync,
  existsSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Notification } from "electron";
import type { MochiRuntimeRole } from "./profile";

/**
 * 首启模型种子（MOCHI-WIN-PACK-01 WO-3）。
 *
 * 打包资源里带有构建期生成的种子（`<resourceRoot>/seeds/`，由
 * `scripts/seed-packaging-keys.cjs` 从本地密钥文件或 CI Secrets 渲染）。
 * 首启（teacher 角色、每次宿主启动前幂等执行）把种子补齐进运行时 home：
 *
 *   - `.credentials.yaml`：缺失的 refs 以 0600 原子写入；已有值一律不动。
 *   - `settings.yaml`：完全没有模型配置时写入默认模型链；已有配置不覆盖。
 *
 * 种子也缺 key（CI 未配 Secrets）时不阻塞启动，只给一次中文系统提示并
 * 指向设置页；聊天内的报错文案属 llm 插件层，见工单 patch-request。
 */

const SEEDS_DIRNAME = "seeds";
const CREDENTIALS_FILENAME = ".credentials.yaml";
const SETTINGS_FILENAME = "settings.yaml";
const SEEDABLE_CREDENTIAL_REFS = Object.freeze(["MIMO_API_KEY", "MOCHI_AIAAA_API_KEY"]);
// `deepseek-v4.1-flash-expires-on-0910` 名字自带 9/10 过期，禁止进入默认链。
const FORBIDDEN_MODEL_SUBSTRING = "expires-on-";

export type MochiSeedStatus = "seeded" | "partial" | "absent" | "disabled";

export type MochiSeedSummary = {
  status: MochiSeedStatus;
  credentialRefsInserted: string[];
  credentialRefsPresent: string[];
  settingsAction: "written" | "appended" | "kept" | "absent";
};

type CredentialsSeed = { schemaVersion: 1; refs: Record<string, string> };
/**
 * 一个 pi-ai 路由的模型条目。`contextWindow` / `maxTokens` 是**能力事实**，不是偏好：
 * `mochi-aiaaa` 不在 pi-ai 内置目录里，缺了它们就会落到 pi-ai 的兜底
 * （262,144 / 32,768），既低估真实能力又不符合网关行为。见
 * docs/gateway-aiaaa-verified-facts.md 与 core.patch.yml 的 session-title-llm 覆盖。
 */
type SettingsSeedModel = {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  input: string[];
};
type SettingsSeed = {
  schemaVersion: 1;
  agentDefaultModel: { provider: string; model: string };
  visionProvider: {
    settingsNamespace: string;
    providerId: string;
    displayName: string;
    apiKeyEnv: string;
    api: string;
    baseURL: string;
    models: SettingsSeedModel[];
  };
};

let missingKeyNoticeShown = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

function readCredentialsSeed(resourceRoot: string): CredentialsSeed | null {
  const value = readJsonFile(join(resourceRoot, SEEDS_DIRNAME, "credentials-seed.json"));
  if (value === undefined) return null;
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.refs)) {
    throw new Error("credentials-seed.json 格式无效");
  }
  const refs: Record<string, string> = {};
  for (const [key, ref] of Object.entries(value.refs)) {
    if (!SEEDABLE_CREDENTIAL_REFS.includes(key)) continue;
    if (typeof ref !== "string" || ref.length === 0) throw new Error(`credentials-seed.json 的 ${key} 为空`);
    refs[key] = ref;
  }
  return { schemaVersion: 1, refs };
}

function readSettingsSeed(resourceRoot: string): SettingsSeed | null {
  const value = readJsonFile(join(resourceRoot, SEEDS_DIRNAME, "settings-defaults.json"));
  if (value === undefined) return null;
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("settings-defaults.json 格式无效");
  const agentDefaultModel = value.agentDefaultModel;
  const vision = value.visionProvider;
  if (!isRecord(agentDefaultModel) || typeof agentDefaultModel.provider !== "string" || typeof agentDefaultModel.model !== "string") {
    throw new Error("settings-defaults.json 的 agentDefaultModel 无效");
  }
  if (!isRecord(vision)
    || typeof vision.settingsNamespace !== "string"
    || typeof vision.providerId !== "string"
    || typeof vision.displayName !== "string"
    || typeof vision.apiKeyEnv !== "string"
    || typeof vision.api !== "string"
    || typeof vision.baseURL !== "string"
    || !Array.isArray(vision.models)) {
    throw new Error("settings-defaults.json 的 visionProvider 无效");
  }
  for (const model of vision.models) {
    if (!isRecord(model) || typeof model.id !== "string" || typeof model.name !== "string" || !Array.isArray(model.input)) {
      throw new Error("settings-defaults.json 的视觉模型条目无效");
    }
    if (model.id.includes(FORBIDDEN_MODEL_SUBSTRING)) {
      throw new Error(`视觉模型 ${model.id} 带过期标记，禁止进入默认链`);
    }
    // 能力事实必须齐全且为正整数：缺了它们插件不会报错，只会静默退到 pi-ai 的
    // 兜底容量，而那正是要避免的「看起来配好了」。所以在这里 fail loud。
    for (const field of ["contextWindow", "maxTokens"] as const) {
      const value = model[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`settings-defaults.json 的视觉模型 ${model.id} 的 ${field} 必须是正整数`);
      }
    }
  }
  return {
    schemaVersion: 1,
    agentDefaultModel: { provider: agentDefaultModel.provider, model: agentDefaultModel.model },
    visionProvider: {
      settingsNamespace: vision.settingsNamespace,
      providerId: vision.providerId,
      displayName: vision.displayName,
      apiKeyEnv: vision.apiKeyEnv,
      api: vision.api,
      baseURL: vision.baseURL,
      models: vision.models.map((model) => ({
        id: String(model.id),
        name: String(model.name),
        contextWindow: Number(model.contextWindow),
        maxTokens: Number(model.maxTokens),
        input: (model.input as unknown[]).map((entry: unknown) => String(entry)),
      })),
    },
  };
}

function escapeRegExp(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** refs 条目固定两空格缩进；records 的 scope/id 与更深层 env 不会撞同名。 */
function credentialRefPresent(text: string, key: string): boolean {
  return new RegExp(`^  ${escapeRegExp(key)}: \\S`, "m").test(text);
}

/**
 * 把缺失的 refs 合并进 version 1 凭据文档（纯文本操作，保注释保格式）。
 * 仅接受内核写入的受控形状；未识别的形状原样返回并报告未写入。
 */
function mergeCredentialRefs(text: string, refs: Record<string, string>): { text: string; inserted: string[]; rejected: string[] } {
  const missing = Object.keys(refs).filter((key) => !credentialRefPresent(text, key));
  if (missing.length === 0) return { text, inserted: [], rejected: [] };
  const entries = missing.map((key) => `  ${key}: ${refs[key]}`);
  const lines = text.split("\n");
  const refsLineIndex = lines.findIndex((line) => /^refs:/.test(line));
  if (refsLineIndex === -1) {
    const trimmed = text.replace(/\s+$/, "");
    if (trimmed.length > 0 && !/^version:/.test(trimmed)) {
      return { text, inserted: [], rejected: missing };
    }
    const block = trimmed.length === 0
      ? `version: 1\nrefs:\n${entries.join("\n")}\n`
      : `${trimmed}\nrefs:\n${entries.join("\n")}\n`;
    return { text: block, inserted: missing, rejected: [] };
  }
  if (/^refs:\s*(?:#.*)?$/.test(lines[refsLineIndex])) {
    lines.splice(refsLineIndex + 1, 0, ...entries);
    return { text: lines.join("\n"), inserted: missing, rejected: [] };
  }
  if (/^refs:\s*\{\}\s*(?:#.*)?$/.test(lines[refsLineIndex])) {
    lines.splice(refsLineIndex, 1, "refs:", ...entries);
    return { text: lines.join("\n"), inserted: missing, rejected: [] };
  }
  return { text, inserted: [], rejected: missing };
}

/** 0600 原子写入；credentials 文档任何 group/other 位都会被内核拒绝加载。 */
function writeCredentialsDocument(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = openSync(temporary, "wx", 0o600);
  try {
    fchmodSync(handle, 0o600);
    writeFileSync(handle, content, "utf8");
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, path);
}

function renderSettingsSeedDocument(seed: SettingsSeed, header: string): string {
  const vision = seed.visionProvider;
  const modelLines = vision.models.map((model) => {
    const inputLines = model.input.map((entry) => `            - ${entry}`).join("\n");
    return `        - id: ${model.id}\n          name: ${model.name}`
      + `\n          contextWindow: ${model.contextWindow}\n          maxTokens: ${model.maxTokens}`
      + `\n          input:\n${inputLines}`;
  }).join("\n");
  return `${header}agent-default-model:\n  provider: ${seed.agentDefaultModel.provider}\n  model: ${seed.agentDefaultModel.model}\n${vision.settingsNamespace}:\n  providers:\n    ${vision.providerId}:\n      displayName: ${vision.displayName}\n      apiKeyEnv: ${vision.apiKeyEnv}\n      api: ${vision.api}\n      baseURL: ${vision.baseURL}\n      models:\n${modelLines}\n`;
}

function hasModelConfig(text: string): boolean {
  return /^agent-default-model:/m.test(text) || /^llm-pi-ai:/m.test(text);
}

/**
 * 首启种子主入口。幂等：已有凭据值与已有模型配置永远不覆盖。
 * 抛错由调用方（prepareDshHome）兜底成日志，不阻塞宿主启动。
 */
export function seedRuntimeHome(options: { homeDir: string; resourceRoot: string; role: MochiRuntimeRole }): MochiSeedSummary {
  const { homeDir, resourceRoot, role } = options;
  if (role !== "teacher") {
    // 教室端独立数据目录，不读教师密钥（与首启角色选择对话框口径一致）。
    return { status: "disabled", credentialRefsInserted: [], credentialRefsPresent: [], settingsAction: "absent" };
  }

  const credentialsSeed = readCredentialsSeed(resourceRoot);
  const settingsSeed = readSettingsSeed(resourceRoot);

  const credentialsPath = join(homeDir, CREDENTIALS_FILENAME);
  const existingCredentials = existsSync(credentialsPath) ? readFileSync(credentialsPath, "utf8") : "";
  const inserted: string[] = [];
  const rejected: string[] = [];
  let credentialsText = existingCredentials;
  if (credentialsSeed !== null) {
    const merge = mergeCredentialRefs(existingCredentials, credentialsSeed.refs);
    if (merge.text !== existingCredentials) writeCredentialsDocument(credentialsPath, merge.text);
    inserted.push(...merge.inserted);
    rejected.push(...merge.rejected);
    if (rejected.length > 0) {
      console.error(`[mochi] 凭据文档形状未识别，以下引用名未写入种子：${rejected.join("、")}`);
    }
    credentialsText = merge.text;
  }

  let settingsAction: MochiSeedSummary["settingsAction"] = "absent";
  const settingsPath = join(homeDir, SETTINGS_FILENAME);
  const existingSettings = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "";
  if (settingsSeed !== null) {
    if (existingSettings.trim().length === 0) {
      const document = renderSettingsSeedDocument(settingsSeed, "# Mochi 默认模型链（安装包内置种子，可在设置页修改）\n");
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, document, "utf8");
      settingsAction = "written";
    } else if (!hasModelConfig(existingSettings)) {
      const document = renderSettingsSeedDocument(settingsSeed, "\n# Mochi 默认模型链（安装包内置种子，可在设置页修改）\n");
      writeFileSync(settingsPath, `${existingSettings.replace(/\s+$/, "")}\n${document}`, "utf8");
      settingsAction = "appended";
    } else {
      settingsAction = "kept";
    }
  }

  const credentialsRefsPresent = SEEDABLE_CREDENTIAL_REFS.filter((key) => credentialRefPresent(credentialsText, key));
  if (credentialsRefsPresent.length === 0) {
    notifyMissingKeysOnce();
  }

  const status: MochiSeedStatus = credentialsSeed === null
    ? "absent"
    : rejected.length === 0 && credentialsRefsPresent.length === SEEDABLE_CREDENTIAL_REFS.length
      ? "seeded"
      : "partial";
  return { status, credentialRefsInserted: inserted, credentialRefsPresent: credentialsRefsPresent, settingsAction };
}

/** 种子也缺 key 时的一次性中文兜底提示；指向设置页，不弹英文、不白屏。 */
function notifyMissingKeysOnce(): void {
  if (missingKeyNoticeShown) return;
  if (process.env.MOCHI_DESKTOP_SMOKE === "1") return;
  missingKeyNoticeShown = true;
  console.error("[mochi] 未检测到可用的模型密钥种子；对话功能需要先在设置页配置模型服务。");
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: "Mochi 需要配置模型密钥",
      body: "未检测到内置模型密钥，对话功能暂时不可用。请打开 Mochi 的设置页配置模型服务后重试。",
      silent: true,
    });
    notification.show();
  }
}
