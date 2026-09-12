"use strict";

const {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { dirname, isAbsolute, join, relative, resolve, sep } = require("node:path");

const MANIFEST_FILENAME = "runtime-profile.json";
const SKILLS_TOKEN = "__MOCHI_SKILLS_DIR_JSON__";
const AGENT_PRESETS_CONFIG_TOKEN = "__MOCHI_AGENT_PRESETS_CONFIG_JSON__";
const MANAGED_PATCH_BEGIN = "# >>> Mochi managed runtime profile >>>";
const MANAGED_PATCH_END = "# <<< Mochi managed runtime profile <<<";
const ROLE_MARKER_FILENAME = ".mochi-runtime-role.json";
const SERVICE_DEFAULT_KEYS = new Set(["campusApiUrl", "searxngEndpoint"]);
const RUNTIME_ROLES = new Set(["teacher", "classroom"]);
/**
 * [Mochi patch 2026-09-12] 教师端预设选择器只保留“创造模式”。
 *
 * 上游 agent-presets 的 roots 只接受 { path, trust }，没有逐条排除能力（见
 * @deepseek-ai/dsh-agent-presets README.zh.md），而底座包自带 standard / ptc /
 * minimal / cordis 四个编程向预设。生成器因此把底座预设目录过滤成一个只含
 * 白名单的可见根，落在 profile home 下，再把它作为 system root 交给
 * agent-presets；被排除的预设既不落盘也不出现在教师的选择器里。
 *
 * 幂等：逐文件按字节比较，重复生成不重写、不报错，且保留 cordis 的全部文件
 * （preset.yml / agent.cordis.yml / skills/**）。
 */
const VISIBLE_INSTALLED_PRESETS = Object.freeze(["cordis"]);
const PRESETS_VISIBLE_DIRNAME = "presets-visible";
const PRESET_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 Mochi 运行时配置 ${path}: ${error.message}`);
  }
}

function parseServiceEndpoint(value, label, { originOnly = false } = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Mochi serviceDefaults.${label} 必须是 HTTP(S) URL 或 null`);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`Mochi serviceDefaults.${label} 必须是 HTTP(S) URL 或 null`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error(`Mochi serviceDefaults.${label} 必须是不含凭据的 HTTP(S) URL`);
  }
  if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
    throw new Error(`Mochi serviceDefaults.${label} 必须是无路径、查询或片段的服务 Origin`);
  }
  return originOnly ? url.origin : url.toString();
}

function readServiceDefaultsFromManifest(manifest) {
  const source = manifest.serviceDefaults;
  if (source === undefined) {
    return { campusApiUrl: undefined, searxngEndpoint: undefined };
  }
  if (!isRecord(source)) {
    throw new Error("Mochi serviceDefaults 必须是对象");
  }
  if (Object.keys(source).some((key) => !SERVICE_DEFAULT_KEYS.has(key))) {
    throw new Error("Mochi serviceDefaults 包含未知字段");
  }
  return {
    campusApiUrl: parseServiceEndpoint(source.campusApiUrl, "campusApiUrl", { originOnly: true }),
    searxngEndpoint: parseServiceEndpoint(source.searxngEndpoint, "searxngEndpoint"),
  };
}

function readRuntimeProfileManifest(resourceRoot) {
  const manifest = readJson(join(resourceRoot, MANIFEST_FILENAME));
  if (!isRecord(manifest) || !Number.isInteger(manifest.schemaVersion) || !isRecord(manifest.profiles) || !isRecord(manifest.plugins)) {
    throw new Error("Mochi runtime-profile.json 格式无效");
  }
  readServiceDefaultsFromManifest(manifest);
  readRoleProfiles(manifest);
  return manifest;
}

function readRoleProfiles(manifest) {
  const roles = manifest.roleProfiles;
  if (!isRecord(roles) || Object.keys(roles).some((role) => !RUNTIME_ROLES.has(role))) {
    throw new Error("Mochi roleProfiles 格式无效");
  }
  for (const role of RUNTIME_ROLES) {
    const config = roles[role];
    if (!isRecord(config) || typeof config.defaultPreset !== "string" || !isRecord(config.managedPreset)
      || typeof config.includeInstalledPresetRoot !== "boolean" || typeof config.includeUserPresetRoot !== "boolean") {
      throw new Error(`Mochi ${role} 角色配置无效`);
    }
    const managed = config.managedPreset;
    const sourceKeys = ["workspacePath", "resourcePath", "profilePath"].filter((key) => typeof managed[key] === "string");
    const workspaceConfigured = typeof managed.workspacePath === "string" && typeof managed.resourcePath === "string";
    const profileConfigured = typeof managed.profilePath === "string";
    if (sourceKeys.length !== (workspaceConfigured ? 2 : 1) || (workspaceConfigured === profileConfigured)) {
      throw new Error(`Mochi ${role} 角色预设路径无效`);
    }
    if (config.profilePlugins !== undefined) {
      if (!isRecord(config.profilePlugins)) throw new Error(`Mochi ${role} 角色插件白名单无效`);
      for (const [profileName, pluginNames] of Object.entries(config.profilePlugins)) {
        if (!Array.isArray(pluginNames) || pluginNames.length === 0
          || pluginNames.some((name) => typeof name !== "string")
          || new Set(pluginNames).size !== pluginNames.length) {
          throw new Error(`Mochi ${role} 的 ${profileName} 插件白名单无效`);
        }
      }
    }
  }
  return roles;
}

function readServiceDefaults(resourceRoot) {
  return readServiceDefaultsFromManifest(readRuntimeProfileManifest(resolve(resourceRoot)));
}

function resolveServiceDefaults(options) {
  if (!isRecord(options) || typeof options.resourceRoot !== "string") {
    throw new Error("Mochi service defaults 参数无效");
  }
  const environment = options.environment ?? process.env;
  if (!isRecord(environment)) {
    throw new Error("Mochi service defaults 环境无效");
  }
  const configured = readServiceDefaults(options.resourceRoot);
  const campusOverride = parseServiceEndpoint(environment.MOCHI_CAMPUS_API_URL, "campusApiUrl", { originOnly: true });
  const searchOverride = parseServiceEndpoint(environment.MOCHI_SEARXNG_ENDPOINT, "searxngEndpoint");
  return {
    campusApiUrl: campusOverride ?? configured.campusApiUrl,
    searxngEndpoint: searchOverride ?? configured.searxngEndpoint,
  };
}

function requireDirectory(path, label) {
  if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label}不存在或不是目录：${path}`);
  }
}

function writeIfChanged(path, content) {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

function replaceOne(template, token, value, templatePath) {
  const count = template.split(token).length - 1;
  if (count !== 1) {
    throw new Error(`模板 ${templatePath} 必须恰好包含一个 ${token}`);
  }
  return template.replace(token, value);
}

function renderPluginEntries(pluginNames) {
  return pluginNames.map((name) => `    - id: ${name}\n      name: ${name}`).join("\n");
}

/**
 * [Mochi patch 2026-09-11] 目录选择器交互钉死（win32 → browse）。
 *
 * 上游 `dsh-web-app` 的 `directory-picker` 行是自适应的：darwin/win32 一律
 * 选 `native`，只有 bind 非回环/SSh/无显示会话时才落到 `browse`。而 win32 的
 * `native` 走的是 koffi + COM 子进程（`dsh-host-directory-picker-native` 里
 * spawn 一个 `lib/worker.cjs` 子进程跑 `IFileOpenDialog`）。真机（Windows 安装
 * 包）上该子进程未回报就退出，宿主只能抛
 * `directory picker failed: win32 folder dialog worker exited before reporting a result`，
 * 教师因此完全无法选择工作区。
 *
 * 上游在同一处注释里明确给出了替代做法（"Mount -native or -browse directly in
 * an overlay to pin the interaction."）：与其在真机上赌 koffi/COM 子进程，
 * 不如把 win32 钉到 `browse` —— 应用内目录浏览器，宿主侧只做列目录/建目录，
 * 零原生依赖，且两个包本来就是 `dsh-web-app` 的既有依赖。
 *
 * 开关：`MOCHI_DIRECTORY_PICKER=auto|browse|native`
 *  - 未设置/auto：win32 → browse，其余平台保持上游自适应（darwin 仍是原生对话框）；
 *  - browse：强制钉死 browse（任何平台都可用来复现/验证）；
 *  - native：不钉死，完全交回上游自适应。
 */
function resolveDirectoryPickerPin(environment = process.env, platform = process.platform) {
  const requested = typeof environment.MOCHI_DIRECTORY_PICKER === "string"
    ? environment.MOCHI_DIRECTORY_PICKER.trim().toLowerCase()
    : "";
  if (requested === "browse") return true;
  if (requested === "native" || requested === "auto") return false;
  if (requested !== "") {
    throw new Error(`MOCHI_DIRECTORY_PICKER 只能是 auto、browse 或 native（收到 ${requested}）`);
  }
  return platform === "win32";
}

function renderDirectoryPickerPin() {
  return [
    "# [Mochi patch] 钉死目录选择器为 browse 交互（见 runtime-profile.cjs 注释）。",
    "- id: directory-picker",
    "  disabled: true",
    "",
    "- insert:",
    "    - id: directory-picker-browse",
    "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
    "    - id: directory-picker-browse-surface",
    "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'",
  ].join("\n");
}

function renderInitialConfigEntry(pluginName, config) {
  const configJson = JSON.stringify(config);
  if (configJson === undefined) throw new Error(`Mochi plugin ${pluginName} 的首次配置无法序列化`);
  return `- insert:\n    - id: ${pluginName}\n      name: ${pluginName}\n      config: ${configJson}`;
}

function renderPatch(resourceRoot, profile, skillsDir, existingPluginIds = new Set(), agentPresetsConfig, profileName) {
  const templates = profile.templates;
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error("Mochi profile 缺少模板列表");
  }
  const template = templates
    .map((relativePath) => {
      if (typeof relativePath !== "string") throw new Error("Mochi profile 模板路径必须是字符串");
      const templatePath = resolve(resourceRoot, relativePath);
      if (!templatePath.startsWith(`${resolve(resourceRoot)}${sep}`)) {
        throw new Error(`Mochi profile 模板越过资源根目录：${relativePath}`);
      }
      return { templatePath, content: readFileSync(templatePath, "utf8") };
    })
    .map(({ templatePath, content }) => {
      let rendered = content.includes(SKILLS_TOKEN)
        ? replaceOne(content, SKILLS_TOKEN, JSON.stringify(skillsDir), templatePath)
        : content;
      if (rendered.includes(AGENT_PRESETS_CONFIG_TOKEN)) {
        if (!isRecord(agentPresetsConfig)) {
          throw new Error(`模板 ${templatePath} 需要受管 agent preset 配置`);
        }
        rendered = replaceOne(rendered, AGENT_PRESETS_CONFIG_TOKEN, JSON.stringify(agentPresetsConfig), templatePath);
      }
      return rendered;
    })
    .join("\n\n");

  if (!template.includes(JSON.stringify(skillsDir))) {
    throw new Error("Mochi profile 模板未提供 skills 路径占位符");
  }

  const pluginNames = profile.plugins;
  if (!Array.isArray(pluginNames) || pluginNames.length === 0 || pluginNames.some((name) => typeof name !== "string")) {
    throw new Error("Mochi profile 缺少插件列表");
  }
  const missingPlugins = pluginNames.filter((name) => !existingPluginIds.has(name));
  const pluginPatch = missingPlugins.length === 0
    ? ""
    : `\n\n- insert:\n${renderPluginEntries(missingPlugins)}`;
  // 目录选择器钉死只对 web 形态有意义：picker 交互本身由 dsh-web-app bundle 装载。
  const pickerPatch = profileName === "mochi-web" && resolveDirectoryPickerPin()
    ? `\n\n${renderDirectoryPickerPin()}`
    : "";
  return `${template.trimEnd()}${pluginPatch}${pickerPatch}\n`;
}

function splitManagedPatch(path) {
  if (!existsSync(path)) return { before: "", after: "" };
  const content = readFileSync(path, "utf8");
  const begin = content.indexOf(MANAGED_PATCH_BEGIN);
  const end = content.indexOf(MANAGED_PATCH_END);
  if (begin === -1 && end === -1) return { before: content, after: "" };
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`Mochi profile 受管区块标记不完整：${path}`);
  }
  return {
    before: content.slice(0, begin),
    after: content.slice(end + MANAGED_PATCH_END.length),
  };
}

function collectPluginIds(...parts) {
  const ids = new Set();
  for (const part of parts) {
    for (const match of part.matchAll(/^\s*-\s+id:\s*(?:(["'])([A-Za-z0-9_-]+)\1|([A-Za-z0-9_-]+))\s*(?:#.*)?$/gm)) {
      ids.add(match[2] ?? match[3]);
    }
  }
  return ids;
}

function normalizeEmptyPatchDocument(content) {
  // A bare `[]` is a complete YAML document, so appending list rows after it
  // would be invalid. Only remove an otherwise empty sequence; comments stay.
  const lines = content.split(/\r?\n/);
  const documentLines = lines.filter((line) => !/^\s*(?:#.*)?$/.test(line));
  if (documentLines.length !== 1 || !/^\s*\[\]\s*(?:#.*)?$/.test(documentLines[0])) return content;
  return lines.map((line) => {
    const match = line.match(/^(\s*)\[\]\s*(#.*)?$/);
    return match ? `${match[1]}${match[2] ?? ""}` : line;
  }).join("\n");
}

function seedInitialConfigEntries(existingPatch, profile, plugins, runtimeInitialConfigs = {}) {
  const existingPluginIds = collectPluginIds(existingPatch.before, existingPatch.after);
  const entries = [];
  for (const pluginName of profile.plugins ?? []) {
    if (typeof pluginName !== "string") continue;
    const plugin = plugins[pluginName];
    const initialConfig = Object.hasOwn(runtimeInitialConfigs, pluginName)
      ? runtimeInitialConfigs[pluginName]
      : plugin?.initialConfig;
    if (initialConfig === undefined) continue;
    if (!isRecord(plugin) || !isRecord(initialConfig)) {
      throw new Error(`Mochi plugin ${pluginName} 的首次配置必须是对象`);
    }
    // A hand-authored entry is the user's source of truth. Do not fill in or
    // replace its config, even when it is incomplete for this plugin.
    if (!existingPluginIds.has(pluginName)) {
      entries.push(renderInitialConfigEntry(pluginName, initialConfig));
    }
  }
  if (entries.length === 0) return existingPatch;

  // Configurable plugins live outside the regenerated block, so an existing
  // user config remains intact and collectPluginIds suppresses the plain row.
  const before = normalizeEmptyPatchDocument(existingPatch.before);
  return {
    before: `${before.trimEnd()}${before.trim() ? "\n\n" : ""}${entries.join("\n\n")}\n`,
    after: existingPatch.after,
  };
}

function composeManagedPatch(existing, managedPatch) {
  const parts = [];
  const before = normalizeEmptyPatchDocument(existing.before);
  const after = normalizeEmptyPatchDocument(existing.after);
  if (before.trim()) parts.push(before.trimEnd());
  parts.push(`${MANAGED_PATCH_BEGIN}\n${managedPatch.trimEnd()}\n${MANAGED_PATCH_END}`);
  if (after.trim()) parts.push(after.trimStart());
  return `${parts.join("\n\n")}\n`;
}

function sameTarget(link, target) {
  try {
    return realpathSync(link) === realpathSync(target);
  } catch {
    return false;
  }
}

function ensurePluginLink(target, link) {
  validatePluginLink(target, link);
  mkdirSync(dirname(link), { recursive: true });
  let linkExists = existsSync(link);
  if (!linkExists) {
    try {
      lstatSync(link);
      linkExists = true;
    } catch {
      linkExists = false;
    }
  }
  if (linkExists) {
    const stat = lstatSync(link);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Mochi profile 插件路径已存在且不是链接：${link}`);
    }
    if (sameTarget(link, target)) return false;
    unlinkSync(link);
  }
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  return true;
}

function validatePluginLink(target, link) {
  requireDirectory(target, "Mochi 插件");
  try {
    const stat = lstatSync(link);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Mochi profile 插件路径已存在且不是链接：${link}`);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
}

function readExistingManifest(path) {
  if (!existsSync(path)) return {};
  const current = readJson(path);
  if (!isRecord(current)) throw new Error(`Mochi profile manifest 必须是对象：${path}`);
  return current;
}

function renderProfileManifest(current, name, profile, pluginTargets, schemaVersion) {
  const currentDependencies = isRecord(current.dependencies) ? current.dependencies : {};
  const currentDsh = isRecord(current.dsh) ? current.dsh : {};
  const currentProfile = isRecord(currentDsh.profile) ? currentDsh.profile : {};
  const managedBundles = profile.bundles;
  const userBundles = Array.isArray(currentProfile.bundles)
    ? currentProfile.bundles.filter((bundle) => typeof bundle === "string" && !managedBundles.includes(bundle))
    : [];
  const dependencies = { ...currentDependencies };
  for (const [pluginName, target] of Object.entries(pluginTargets)) {
    dependencies[pluginName] = `link:${target}`;
  }
  return {
    ...current,
    name: `dsh-profile-${name}`,
    private: true,
    dependencies,
    dsh: {
      ...currentDsh,
      profile: {
        ...currentProfile,
        bundles: [...managedBundles, ...userBundles],
        patchReload: "startup",
      },
    },
    mochiRuntime: {
      schemaVersion,
      source: "apps/desktop/resources/mochi-web/runtime-profile.json",
    },
  };
}

function resolvePluginTarget(pluginName, plugin, options) {
  if (!isRecord(plugin)) throw new Error(`Mochi plugin ${pluginName} 缺少路径配置`);
  if (options.pluginRoot) {
    if (typeof plugin.resourcePath !== "string") throw new Error(`Mochi plugin ${pluginName} 缺少资源路径`);
    return resolve(options.pluginRoot, plugin.resourcePath);
  }
  if (!options.workspaceRoot) throw new Error(`Mochi plugin ${pluginName} 需要 workspaceRoot`);
  if (typeof plugin.workspacePath !== "string") throw new Error(`Mochi plugin ${pluginName} 缺少工作区路径`);
  return resolve(options.workspaceRoot, plugin.workspacePath);
}

function resolveRuntimeRole(role) {
  if (role === undefined) return "teacher";
  if (!RUNTIME_ROLES.has(role)) throw new Error("Mochi 启动角色必须是 teacher 或 classroom");
  return role;
}

function profileForRole(manifest, profileName, profile, role) {
  const defaultPluginNames = profile.plugins;
  if (!Array.isArray(defaultPluginNames) || defaultPluginNames.some((name) => typeof name !== "string")) {
    throw new Error(`Mochi profile ${profileName} 缺少插件列表`);
  }
  const roleConfig = readRoleProfiles(manifest)[role];
  const configured = roleConfig.profilePlugins;
  if (configured === undefined) return profile;
  const pluginNames = configured[profileName];
  if (!Array.isArray(pluginNames)) {
    throw new Error(`Mochi ${role} 角色缺少 ${profileName} 插件白名单`);
  }
  const allowed = new Set(defaultPluginNames);
  if (pluginNames.some((name) => typeof name !== "string" || !allowed.has(name))) {
    throw new Error(`Mochi ${role} 角色 ${profileName} 插件白名单越过默认受管插件`);
  }
  return { ...profile, plugins: pluginNames };
}

function isWithin(path, root) {
  const rel = relative(root, path);
  // Windows 跨盘符时 relative 返回绝对路径，必然不属于包含关系。
  if (isAbsolute(rel)) return false;
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function resolveRolePresetRoot(roleConfig, { resourceRoot, workspaceRoot, pluginRoot }) {
  const managed = roleConfig.managedPreset;
  if (typeof managed.profilePath === "string") {
    const root = resolve(resourceRoot, managed.profilePath);
    if (!isWithin(root, resourceRoot)) throw new Error("Mochi 课堂预设目录越过 profile 资源根目录");
    requireDirectory(root, "Mochi 课堂预设目录");
    return root;
  }
  if (pluginRoot) {
    const root = resolve(dirname(pluginRoot), managed.resourcePath);
    requireDirectory(root, "Mochi 教师预设目录");
    return root;
  }
  const root = resolve(workspaceRoot, managed.workspacePath);
  requireDirectory(root, "Mochi 教师预设目录");
  return root;
}

function resolveInstalledPresetRoot({ runtimeNodeModulesRoot, workspaceRoot }) {
  if (!runtimeNodeModulesRoot && !workspaceRoot) {
    throw new Error("Mochi 打包 profile 必须提供运行时 node_modules 根目录");
  }
  const nodeModulesRoot = runtimeNodeModulesRoot
    ? resolve(runtimeNodeModulesRoot)
    : resolve(workspaceRoot, "apps", "desktop", "node_modules");
  requireDirectory(nodeModulesRoot, "Mochi 运行时 node_modules");
  const packageRoot = join(nodeModulesRoot, "@deepseek-ai", "dsh-agent-presets");
  const manifest = readJson(join(packageRoot, "package.json"));
  if (manifest.name !== "@deepseek-ai/dsh-agent-presets") {
    throw new Error("Mochi 运行时 agent-presets 包无效");
  }
  const presetsRoot = join(packageRoot, "presets");
  requireDirectory(presetsRoot, "Mochi 官方 agent preset 目录");
  return presetsRoot;
}

function copyPresetFileIfChanged(source, target, updated, relativePath) {
  const content = readFileSync(source);
  if (existsSync(target) && readFileSync(target).equals(content)) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  updated.push(relativePath);
}

function copyPresetTreeIfChanged(sourceDir, targetDir, updated, relativeDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    const relativePath = join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      copyPresetTreeIfChanged(source, target, updated, relativePath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Mochi 官方预设含有不支持的条目：${source}`);
    }
    copyPresetFileIfChanged(source, target, updated, relativePath);
  }
}

/**
 * Materialize the filtered installed-preset root: only the whitelisted presets
 * are copied, with their complete file tree, into a runtime-visible directory.
 * @returns relative paths of files written on this run (empty when unchanged).
 */
function materializeVisiblePresetRoot(installedRoot, visibleRoot) {
  const updated = [];
  for (const presetName of VISIBLE_INSTALLED_PRESETS) {
    if (!PRESET_NAME_PATTERN.test(presetName)) throw new Error(`Mochi 可见预设名无效：${presetName}`);
    const source = join(installedRoot, presetName);
    requireDirectory(source, `Mochi 官方预设 ${presetName}`);
    copyPresetTreeIfChanged(source, join(visibleRoot, presetName), updated, join(PRESETS_VISIBLE_DIRNAME, presetName));
  }
  return updated;
}

function agentPresetsConfig(manifest, role, options) {
  const roleConfig = readRoleProfiles(manifest)[role];
  const roots = [{ path: resolveRolePresetRoot(roleConfig, options), trust: "system" }];
  if (roleConfig.includeInstalledPresetRoot) {
    if (typeof options.visiblePresetRoot !== "string" || options.visiblePresetRoot === "") {
      throw new Error("Mochi 教师角色缺少过滤后的可见预设根");
    }
    roots.push({ path: options.visiblePresetRoot, trust: "system" });
  }
  return {
    default: roleConfig.defaultPreset,
    roots,
    includeShippedRoot: false,
    includeUserRoot: roleConfig.includeUserPresetRoot,
  };
}

function readRoleMarker(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Mochi 启动角色元数据不是普通文件");
  const marker = readJson(path);
  if (!isRecord(marker) || marker.schemaVersion !== 1 || !RUNTIME_ROLES.has(marker.role)) {
    throw new Error("Mochi 启动角色元数据无效");
  }
  return marker.role;
}

function prepareRoleMarker(homeDir, role) {
  const path = join(homeDir, ROLE_MARKER_FILENAME);
  if (existsSync(path)) {
    const existingRole = readRoleMarker(path);
    if (existingRole !== role) throw new Error(`Mochi 运行目录已绑定 ${existingRole} 角色，不能作为 ${role} 启动`);
    return { path, write: false };
  }
  if (existsSync(homeDir)) {
    const stat = lstatSync(homeDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Mochi 运行目录不是普通目录");
    if (role === "classroom" && readdirSync(homeDir).length > 0) {
      throw new Error("教室启动角色不能复用已有未绑定的 Mochi 运行目录");
    }
  }
  return { path, write: true };
}

function provisionMochiProfiles(options) {
  if (!isRecord(options)) throw new Error("Mochi runtime 参数无效");
  const homeDir = resolve(options.homeDir);
  const resourceRoot = resolve(options.resourceRoot);
  const skillsDir = resolve(options.skillsDir);
  const workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;
  const pluginRoot = options.pluginRoot ? resolve(options.pluginRoot) : undefined;
  const runtimeNodeModulesRoot = options.runtimeNodeModulesRoot ? resolve(options.runtimeNodeModulesRoot) : undefined;
  const role = resolveRuntimeRole(options.role);
  requireDirectory(resourceRoot, "Mochi runtime 资源目录");
  requireDirectory(skillsDir, "Mochi skills 目录");
  if (!pluginRoot) requireDirectory(workspaceRoot, "Mochi 工作区");

  const manifest = readRuntimeProfileManifest(resourceRoot);
  const roleMarker = prepareRoleMarker(homeDir, role);
  const roleConfig = readRoleProfiles(manifest)[role];
  // 过滤后的可见预设根：路径在规划阶段确定，落盘放在全部校验通过之后，
  // 避免任何半成品写入（与 profile 写入同样的原子性要求）。
  const installedPresetRoot = roleConfig.includeInstalledPresetRoot ? resolveInstalledPresetRoot(options) : undefined;
  const visiblePresetRoot = installedPresetRoot === undefined ? undefined : join(homeDir, PRESETS_VISIBLE_DIRNAME);

  const plans = [];
  for (const [name, configuredProfile] of Object.entries(manifest.profiles)) {
    if (!isRecord(configuredProfile) || !Array.isArray(configuredProfile.bundles)) throw new Error(`Mochi profile ${name} 格式无效`);
    const profile = profileForRole(manifest, name, configuredProfile, role);
    const profileDir = join(homeDir, "profiles", name);
    const pluginTargets = {};
    for (const pluginName of profile.plugins ?? []) {
      if (typeof pluginName !== "string") throw new Error(`Mochi profile ${name} 含有无效插件名`);
      pluginTargets[pluginName] = resolvePluginTarget(pluginName, manifest.plugins[pluginName], { workspaceRoot, pluginRoot });
    }

    const patchPath = join(profileDir, "cordis.patch.yml");
    const existingPatch = splitManagedPatch(patchPath);
    const initialConfigs = name === "mochi-web" && profile.plugins.includes("mochi-lan")
      ? { "mochi-lan": { dataRoot: join(homeDir, "mochi-lan"), lockedRole: role } }
      : {};
    const seededPatch = seedInitialConfigEntries(existingPatch, profile, manifest.plugins, initialConfigs);
    const managedPatch = renderPatch(
      resourceRoot,
      profile,
      skillsDir,
      collectPluginIds(seededPatch.before, seededPatch.after),
      name === "mochi-web"
        ? agentPresetsConfig(manifest, role, { resourceRoot, workspaceRoot, pluginRoot, runtimeNodeModulesRoot, visiblePresetRoot })
        : undefined,
      name,
    );
    const patch = composeManagedPatch(seededPatch, managedPatch);

    const manifestPath = join(profileDir, "package.json");
    const profileManifest = renderProfileManifest(readExistingManifest(manifestPath), name, profile, pluginTargets, manifest.schemaVersion);
    for (const [pluginName, target] of Object.entries(pluginTargets)) {
      validatePluginLink(target, join(profileDir, "node_modules", pluginName));
    }
    plans.push({ name, patchPath, patch, manifestPath, profileManifest, pluginTargets, profileDir });
  }

  const updated = [];
  if (installedPresetRoot !== undefined) {
    for (const relativePath of materializeVisiblePresetRoot(installedPresetRoot, visiblePresetRoot)) {
      updated.push(relativePath);
    }
  }
  for (const plan of plans) {
    const { name, patchPath, patch, manifestPath, profileManifest, pluginTargets, profileDir } = plan;
    if (writeIfChanged(patchPath, patch)) updated.push(join("profiles", name, "cordis.patch.yml"));
    if (writeIfChanged(manifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`)) updated.push(join("profiles", name, "package.json"));
    for (const [pluginName, target] of Object.entries(pluginTargets)) {
      if (ensurePluginLink(target, join(profileDir, "node_modules", pluginName))) {
        updated.push(join("profiles", name, "node_modules", pluginName));
      }
    }
  }

  if (roleMarker.write) {
    writeIfChanged(roleMarker.path, `${JSON.stringify({ schemaVersion: 1, role }, null, 2)}\n`);
    updated.push(ROLE_MARKER_FILENAME);
  }

  return { homeDir, role, updated, profiles: Object.keys(manifest.profiles) };
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = {
      "--home": "homeDir",
      "--resources": "resourceRoot",
      "--skills": "skillsDir",
      "--workspace": "workspaceRoot",
      "--plugin-root": "pluginRoot",
      "--runtime-node-modules-root": "runtimeNodeModulesRoot",
      "--role": "role",
    }[flag];
    if (!key || index + 1 >= argv.length) throw new Error(`未知或不完整的参数：${flag}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  for (const key of ["homeDir", "resourceRoot", "skillsDir"]) {
    if (!options[key]) throw new Error(`缺少参数：${key}`);
  }
  if (!options.workspaceRoot && !options.pluginRoot) {
    throw new Error("必须提供 --workspace 或 --plugin-root");
  }
  return options;
}

if (require.main === module) {
  try {
    const result = provisionMochiProfiles(parseCli(process.argv.slice(2)));
    if (result.updated.length > 0) console.log(`[mochi] 已同步 runtime profile：${result.updated.join(", ")}`);
  } catch (error) {
    console.error(`[mochi] 无法准备 runtime profile：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  MANAGED_PATCH_BEGIN,
  MANAGED_PATCH_END,
  collectPluginIds,
  composeManagedPatch,
  normalizeEmptyPatchDocument,
  parseCli,
  provisionMochiProfiles,
  readServiceDefaults,
  renderPatch,
  renderProfileManifest,
  resolveServiceDefaults,
  resolvePluginTarget,
  splitManagedPatch,
  validatePluginLink,
};
