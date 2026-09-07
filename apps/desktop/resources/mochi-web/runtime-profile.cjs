"use strict";

const {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join, resolve, sep } = require("node:path");

const MANIFEST_FILENAME = "runtime-profile.json";
const SKILLS_TOKEN = "__MOCHI_SKILLS_DIR_JSON__";
const MANAGED_PATCH_BEGIN = "# >>> Mochi managed runtime profile >>>";
const MANAGED_PATCH_END = "# <<< Mochi managed runtime profile <<<";
const SERVICE_DEFAULT_KEYS = new Set(["campusApiUrl", "searxngEndpoint"]);

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
  return manifest;
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

function renderInitialConfigEntry(pluginName, config) {
  const configJson = JSON.stringify(config);
  if (configJson === undefined) throw new Error(`Mochi plugin ${pluginName} 的首次配置无法序列化`);
  return `- insert:\n    - id: ${pluginName}\n      name: ${pluginName}\n      config: ${configJson}`;
}

function renderPatch(resourceRoot, profile, skillsDir, existingPluginIds = new Set()) {
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
    .map(({ templatePath, content }) =>
      content.includes(SKILLS_TOKEN)
        ? replaceOne(content, SKILLS_TOKEN, JSON.stringify(skillsDir), templatePath)
        : content,
    )
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
  return `${template.trimEnd()}${pluginPatch}\n`;
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

function seedInitialConfigEntries(existingPatch, profile, plugins) {
  const existingPluginIds = collectPluginIds(existingPatch.before, existingPatch.after);
  const entries = [];
  for (const pluginName of profile.plugins ?? []) {
    if (typeof pluginName !== "string") continue;
    const plugin = plugins[pluginName];
    if (!isRecord(plugin) || !Object.hasOwn(plugin, "initialConfig")) continue;
    if (!isRecord(plugin.initialConfig)) {
      throw new Error(`Mochi plugin ${pluginName} 的首次配置必须是对象`);
    }
    // A hand-authored entry is the user's source of truth. Do not fill in or
    // replace its config, even when it is incomplete for this plugin.
    if (!existingPluginIds.has(pluginName)) {
      entries.push(renderInitialConfigEntry(pluginName, plugin.initialConfig));
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

function provisionMochiProfiles(options) {
  if (!isRecord(options)) throw new Error("Mochi runtime 参数无效");
  const homeDir = resolve(options.homeDir);
  const resourceRoot = resolve(options.resourceRoot);
  const skillsDir = resolve(options.skillsDir);
  const workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;
  const pluginRoot = options.pluginRoot ? resolve(options.pluginRoot) : undefined;
  requireDirectory(resourceRoot, "Mochi runtime 资源目录");
  requireDirectory(skillsDir, "Mochi skills 目录");
  if (!pluginRoot) requireDirectory(workspaceRoot, "Mochi 工作区");

  const manifest = readRuntimeProfileManifest(resourceRoot);

  const plans = [];
  for (const [name, profile] of Object.entries(manifest.profiles)) {
    if (!isRecord(profile) || !Array.isArray(profile.bundles)) throw new Error(`Mochi profile ${name} 格式无效`);
    const profileDir = join(homeDir, "profiles", name);
    const pluginTargets = {};
    for (const pluginName of profile.plugins ?? []) {
      if (typeof pluginName !== "string") throw new Error(`Mochi profile ${name} 含有无效插件名`);
      pluginTargets[pluginName] = resolvePluginTarget(pluginName, manifest.plugins[pluginName], { workspaceRoot, pluginRoot });
    }

    const patchPath = join(profileDir, "cordis.patch.yml");
    const existingPatch = splitManagedPatch(patchPath);
    const seededPatch = seedInitialConfigEntries(existingPatch, profile, manifest.plugins);
    const managedPatch = renderPatch(resourceRoot, profile, skillsDir, collectPluginIds(seededPatch.before, seededPatch.after));
    const patch = composeManagedPatch(seededPatch, managedPatch);

    const manifestPath = join(profileDir, "package.json");
    const profileManifest = renderProfileManifest(readExistingManifest(manifestPath), name, profile, pluginTargets, manifest.schemaVersion);
    for (const [pluginName, target] of Object.entries(pluginTargets)) {
      validatePluginLink(target, join(profileDir, "node_modules", pluginName));
    }
    plans.push({ name, patchPath, patch, manifestPath, profileManifest, pluginTargets, profileDir });
  }

  const updated = [];
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

  return { homeDir, updated, profiles: Object.keys(manifest.profiles) };
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
