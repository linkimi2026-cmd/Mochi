#!/usr/bin/env node
/**
 * Proves that a clean DSH_HOME can be provisioned twice from the versioned
 * Mochi runtime source. The test uses only a temporary home and `--dump-config`;
 * it never starts the web server or reads a developer's credentials.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const resourceRoot = join(desktopRoot, "resources", "mochi-web");
const skillsDir = join(workspaceRoot, "skills");
const runtime = createRequire(import.meta.url)(join(resourceRoot, "runtime-profile.cjs"));
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const dshBin = process.env.MOCHI_DSH_BIN ?? requireFromDesktop.resolve("@deepseek-ai/dsh/lib/bin.js");
const nodeBin = process.env.MOCHI_DSH_NODE ?? process.execPath;

const expectedProfiles = {
  headless: {
    bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"],
    plugins: ["mochi-hello", "mochi-dispatch", "mochi-campus", "mochi-web-search", "mochi-knowledge", "mochi-llm-mimo", "mochi-grades", "mochi-presentations", "mochi-documents", "mochi-files", "mochi-sheets", "mochi-visuals", "mochi-modeling", "mochi-memory", "mochi-task-scheduler"],
  },
  mochi: {
    bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"],
    plugins: ["mochi-hello", "mochi-dispatch", "mochi-campus", "mochi-web-search", "mochi-knowledge", "mochi-llm-mimo", "mochi-grades", "mochi-presentations", "mochi-documents", "mochi-files", "mochi-sheets", "mochi-visuals", "mochi-modeling", "mochi-memory", "mochi-task-scheduler", "mochi-modes", "mochi-approval"],
  },
  "mochi-web": {
    bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
    plugins: ["mochi-hello", "mochi-dispatch", "mochi-campus", "mochi-web-search", "mochi-knowledge", "mochi-llm-mimo", "mochi-grades", "mochi-presentations", "mochi-documents", "mochi-files", "mochi-sheets", "mochi-visuals", "mochi-modeling", "mochi-memory", "mochi-task-scheduler", "mochi-modes", "mochi-modes-client", "jxl-theme", "jxl-brand", "jxl-campus", "mochi-workbench", "mochi-model-presets", "dsh-better-sidebar", "mochi-lan", "mochi-lan-client"],
  },
};

const expectedMimoInitialConfig = {
  apiKeyEnv: "MIMO_API_KEY",
  baseURL: "https://mimo.ezlook.top/v1",
  reasoningEffort: "low",
  models: [
    {
      id: "mimo-v2.5",
      contextWindow: 131072,
      maxTokens: 8192,
      // inputModalities 必须显式声明图像：底座只在该路由声明了图像输入时
      // 才注册 `read_image`（见 @deepseek-ai/dsh-tool-fs 的路由闸）。
      // 少了它，「让 Mochi 看一眼自己渲出来的 PPT 截图」这类自查能力直接不存在。
      inputModalities: ["text", "image"],
      reasoningEfforts: ["off", "low", "medium", "high"],
    },
    {
      id: "mimo-v2.5-pro",
      contextWindow: 131072,
      maxTokens: 8192,
      inputModalities: ["text", "image"],
      reasoningEfforts: ["off", "low", "medium", "high"],
    },
  ],
};

const runtimeProfile = JSON.parse(readFileSync(join(resourceRoot, "runtime-profile.json"), "utf8"));
for (const [name, expected] of Object.entries(expectedProfiles)) {
  assert.deepEqual(runtimeProfile.profiles?.[name]?.bundles, expected.bundles, `${name} bundles must remain versioned with the runtime profile`);
  assert.deepEqual(runtimeProfile.profiles?.[name]?.plugins, expected.plugins, `${name} plugin whitelist must remain versioned with the runtime profile`);
}
const expectedServiceDefaults = { campusApiUrl: null, searxngEndpoint: null };
assert.deepEqual(runtimeProfile.serviceDefaults, expectedServiceDefaults, "service defaults must be versioned with the runtime profile");
assert.deepEqual(
  runtime.readServiceDefaults(resourceRoot),
  { campusApiUrl: undefined, searxngEndpoint: undefined },
  "null service defaults must remain unconfigured",
);
assert.deepEqual(
  runtime.resolveServiceDefaults({ resourceRoot, environment: {} }),
  { campusApiUrl: undefined, searxngEndpoint: undefined },
  "an empty environment must not invent a loopback or cloud service default",
);
const mimoInitialConfig = runtimeProfile.plugins?.["mochi-llm-mimo"]?.initialConfig;
assert.deepEqual(mimoInitialConfig, expectedMimoInitialConfig, "MIMO initial config must stay versioned with the runtime profile");
assert.equal(Object.hasOwn(mimoInitialConfig, "thinking"), false, "MIMO must not globally lock all requests to thinking: disabled");

function assertNoInlineCredential(value, path = "initialConfig") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoInlineCredential(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assert.doesNotMatch(key, /^(?:apiKey|token|secret|password)$/i, `${path}.${key} must be a credential reference, not a value`);
      assertNoInlineCredential(entry, `${path}.${key}`);
    }
  }
}

assertNoInlineCredential(mimoInitialConfig);

const mergedBundles = runtime.renderProfileManifest(
  { dsh: { profile: { bundles: ["custom-user-bundle", "@deepseek-ai/dsh-base"], userField: "retained" } } },
  "headless",
  expectedProfiles.headless,
  {},
  1,
).dsh.profile.bundles;
assert.deepEqual(mergedBundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "custom-user-bundle"]);

for (const source of [
  join(resourceRoot, "runtime-profile.json"),
  join(resourceRoot, "runtime-profile.cjs"),
  join(resourceRoot, "patches", "core.patch.yml"),
  join(resourceRoot, "patches", "headless.patch.yml"),
  join(resourceRoot, "patches", "web.patch.yml"),
]) {
  assert.doesNotMatch(readFileSync(source, "utf8"), /\/Users\/a1379\//, `${source} contains a machine-specific path`);
}

// [Mochi patch] 教师端只有「对话 / 工作」两个模式：官方原始轨迹面（trajectory）
// 必须关闭，聊天视图必须保留为默认模式。两处都锁死，任一回归都会让本测试失败。
const webPatchTemplate = readFileSync(join(resourceRoot, "patches", "web.patch.yml"), "utf8");
assert.match(
  webPatchTemplate,
  /- id: ui-trajectory\n\s+name: '@deepseek-ai\/dsh-client-ui-trajectory'\n\s+disabled: true/,
  "the teacher web overlay must disable the raw trajectory view",
);

function redact(value) {
  return value.replace(/token=[^\s]+/gi, "token=[redacted]");
}

function dumpProfile(home, name) {
  const result = spawnSync(nodeBin, [dshBin, "--profile", name, "--dump-config"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      HOME: home,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: "1",
      NO_COLOR: "1",
    },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, `${name} --dump-config failed\n${redact(output)}`);
  return output;
}

function configuredRow(dump, id) {
  const start = dump.indexOf(`- id: ${id}`);
  assert.notEqual(start, -1, `runtime config omitted ${id}`);
  const end = dump.indexOf("\n- id:", start + 1);
  return dump.slice(start, end === -1 ? undefined : end);
}

function pluginRowCount(patch, id) {
  return [...patch.matchAll(new RegExp(`^\\s*-\\s+id:\\s*(?:["']${id}["']|${id})\\s*(?:#.*)?$`, "gm"))].length;
}

// [Mochi patch] 教师端预设选择器只保留“创造模式”。下面这组断言锁死：
// 生成器把底座预设目录过滤成 home 下的 presets-visible/，只含白名单预设，
// 且 cordis 的全部文件逐字节保留。
const installedPresetsRoot = join(desktopRoot, "node_modules", "@deepseek-ai", "dsh-agent-presets", "presets");
const VISIBLE_PRESET_ROOT_NAME = "presets-visible";
const EXCLUDED_INSTALLED_PRESETS = ["standard", "ptc", "minimal"];

function agentPresetsConfigFromPatch(patch) {
  const match = patch.match(/^- id: agent-presets\n\s+config: (.+)$/m);
  assert.ok(match, "the mochi-web patch must expand the agent-presets config");
  return JSON.parse(match[1]);
}

function relativeFiles(root, current = root, found = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) relativeFiles(root, path, found);
    else found.push(relative(root, path));
  }
  return found.sort();
}

function assertVisiblePresetRoot(home) {
  const visibleRoot = join(home, VISIBLE_PRESET_ROOT_NAME);
  assert.deepEqual(
    readdirSync(visibleRoot).sort(),
    ["cordis"],
    "the teacher-visible preset root must expose exactly the creative preset",
  );
  const sourceRoot = join(installedPresetsRoot, "cordis");
  const targetRoot = join(visibleRoot, "cordis");
  const files = relativeFiles(sourceRoot);
  assert.ok(files.includes("preset.yml"), "the creative preset must carry its preset.yml");
  assert.ok(files.includes("agent.cordis.yml"), "the creative preset must carry its agent composition");
  assert.deepEqual(relativeFiles(targetRoot), files, "the filtered preset must keep every cordis file");
  for (const relativePath of files) {
    assert.ok(
      readFileSync(join(targetRoot, relativePath)).equals(readFileSync(join(sourceRoot, relativePath))),
      `${VISIBLE_PRESET_ROOT_NAME}/cordis/${relativePath} changed while filtering`,
    );
  }
  for (const excluded of EXCLUDED_INSTALLED_PRESETS) {
    assert.equal(existsSync(join(visibleRoot, excluded)), false, `${excluded} must not be visible to teachers`);
  }
  const config = agentPresetsConfigFromPatch(readFileSync(join(home, "profiles", "mochi-web", "cordis.patch.yml"), "utf8"));
  assert.equal(config.default, "lesson-planning");
  assert.equal(config.roots.length, 2, "teacher presets must combine the managed root and the filtered installed root");
  assert.equal(config.roots[1].path, visibleRoot, "the installed preset root must be the filtered visible root");
  assert.equal(config.roots[1].trust, "system");
  for (const root of config.roots) {
    assert.equal(
      root.path.includes(join("@deepseek-ai", "dsh-agent-presets", "presets")),
      false,
      "the raw installed preset directory must never be exposed to the teacher",
    );
  }
}

function assertMimoConfig(dump, expectedConfig = expectedMimoInitialConfig) {
  const row = configuredRow(dump, "mochi-llm-mimo");
  assert.match(row, /name: mochi-llm-mimo/);
  assert.match(row, new RegExp(`apiKeyEnv: ${expectedConfig.apiKeyEnv}`));
  assert.ok(row.includes(`baseURL: ${expectedConfig.baseURL}`), "MIMO base URL changed");
  assert.match(row, new RegExp(`reasoningEffort: (?:["']${expectedConfig.reasoningEffort}["']|${expectedConfig.reasoningEffort})`));
  for (const model of expectedConfig.models) {
    assert.match(row, new RegExp(`id: ${model.id}`));
    assert.match(row, new RegExp(`contextWindow: ${model.contextWindow}`));
    assert.match(row, new RegExp(`maxTokens: ${model.maxTokens}`));
    for (const effort of model.reasoningEfforts) assert.match(row, new RegExp(`- (?:["']${effort}["']|${effort})`));
  }
  assert.doesNotMatch(row, /- max\s*$/m, "MIMO model catalog must not advertise an unsupported max effort");
}

async function assertMimoPluginApply() {
  const mimo = await import(pathToFileURL(join(workspaceRoot, "plugins", "mochi-llm-mimo", "index.mjs")).href);
  const registeredProviders = [];
  let adapter;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  process.env.MIMO_API_KEY = "";
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("MIMO runtime-profile test must not reach the network");
  };
  try {
    mimo.apply({
      get: () => undefined,
      llm: {
        registerConfigurableProviders: (providers) => registeredProviders.push(...providers),
        registerAdapter: (_providers, candidate) => { adapter = candidate; },
      },
      logger: { info() {} },
    }, mimoInitialConfig);

    assert.deepEqual(registeredProviders, [{ provider: "mochi-mimo", displayName: "MiMo", settingsNs: "mochi-llm-mimo", settingsPath: [] }]);
    assert.ok(adapter, "MIMO apply did not register an adapter");
    assert.deepEqual((await adapter.listModels("mochi-mimo")).map((model) => model.id), ["mimo-v2.5", "mimo-v2.5-pro"]);
    await assert.rejects(
      () => adapter.stream({ provider: "mochi-mimo", model: "mimo-v2.5", messages: [], reasoningEffort: "low" }).next(),
      (error) => error?.code === "MISSING_CREDENTIAL",
      "a missing credential must fail closed only when a real model request is attempted",
    );
    assert.equal(fetchCalls, 0, "missing credential must stop the request before any network call");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const home = mkdtempSync(join(tmpdir(), "mochi-runtime-profile-"));
try {
  const serviceResourceRoot = join(home, "service-defaults-resource");
  cpSync(resourceRoot, serviceResourceRoot, { recursive: true });
  const serviceManifestPath = join(serviceResourceRoot, "runtime-profile.json");
  const serviceManifest = JSON.parse(readFileSync(serviceManifestPath, "utf8"));
  serviceManifest.serviceDefaults = {
    campusApiUrl: "https://campus.example.test",
    searxngEndpoint: "https://search.example.test/search",
  };
  writeFileSync(serviceManifestPath, `${JSON.stringify(serviceManifest, null, 2)}\n`);
  assert.deepEqual(
    runtime.readServiceDefaults(serviceResourceRoot),
    serviceManifest.serviceDefaults,
    "versioned HTTP(S) defaults must be readable without a user home",
  );
  assert.deepEqual(
    runtime.resolveServiceDefaults({
      resourceRoot: serviceResourceRoot,
      environment: {
        MOCHI_CAMPUS_API_URL: "http://127.0.0.1:8787",
        MOCHI_SEARXNG_ENDPOINT: "http://localhost:8888/search",
      },
    }),
    {
      campusApiUrl: "http://127.0.0.1:8787",
      searxngEndpoint: "http://localhost:8888/search",
    },
    "explicit controlled environment values must override versioned defaults",
  );

  const legacyServiceManifest = JSON.parse(readFileSync(serviceManifestPath, "utf8"));
  delete legacyServiceManifest.serviceDefaults;
  writeFileSync(serviceManifestPath, `${JSON.stringify(legacyServiceManifest, null, 2)}\n`);
  assert.deepEqual(
    runtime.readServiceDefaults(serviceResourceRoot),
    { campusApiUrl: undefined, searxngEndpoint: undefined },
    "a legacy manifest without serviceDefaults must remain compatible and unconfigured",
  );

  function assertServiceDefaultsRejected(defaults, environment, expectedMessage, hiddenText) {
    const rejectedManifest = JSON.parse(readFileSync(join(resourceRoot, "runtime-profile.json"), "utf8"));
    rejectedManifest.serviceDefaults = defaults;
    writeFileSync(serviceManifestPath, `${JSON.stringify(rejectedManifest, null, 2)}\n`);
    assert.throws(
      () => runtime.resolveServiceDefaults({ resourceRoot: serviceResourceRoot, environment }),
      (error) => {
        assert.match(error.message, expectedMessage);
        assert.doesNotMatch(error.message, new RegExp(hiddenText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
      "invalid service input must fail without echoing the source value",
    );
  }

  assertServiceDefaultsRejected(
    { campusApiUrl: "ftp://protocol-invalid.example.test", searxngEndpoint: null },
    {},
    /campusApiUrl.*HTTP\(S\)/,
    "ftp://protocol-invalid.example.test",
  );
  assertServiceDefaultsRejected(
    { campusApiUrl: "https://campus.example.test", searxngEndpoint: null, unexpected: "ignored-value" },
    {},
    /未知字段/,
    "ignored-value",
  );
  assertServiceDefaultsRejected(
    { campusApiUrl: "https://campus.example.test", searxngEndpoint: null },
    { MOCHI_SEARXNG_ENDPOINT: "https://fixture-user:fixture-secret@search.example.test/search" },
    /searxngEndpoint.*不含凭据/,
    "fixture-secret",
  );

  const invalidDefaultsResourceRoot = join(home, "invalid-service-defaults-resource");
  const invalidDefaultsHome = join(home, "invalid-service-defaults-home");
  cpSync(resourceRoot, invalidDefaultsResourceRoot, { recursive: true });
  const invalidDefaultsManifestPath = join(invalidDefaultsResourceRoot, "runtime-profile.json");
  const invalidDefaultsManifest = JSON.parse(readFileSync(invalidDefaultsManifestPath, "utf8"));
  invalidDefaultsManifest.serviceDefaults = { campusApiUrl: "https://campus.example.test/not-an-origin", searxngEndpoint: null };
  writeFileSync(invalidDefaultsManifestPath, `${JSON.stringify(invalidDefaultsManifest, null, 2)}\n`);
  assert.throws(
    () => runtime.provisionMochiProfiles({ homeDir: invalidDefaultsHome, resourceRoot: invalidDefaultsResourceRoot, workspaceRoot, skillsDir }),
    /campusApiUrl.*服务 Origin/,
  );
  assert.equal(existsSync(join(invalidDefaultsHome, "profiles", "headless", "cordis.patch.yml")), false, "invalid service defaults must not write a partial profile");

  const cleanHome = join(home, "clean-install");
  const cleanOptions = { homeDir: cleanHome, resourceRoot, workspaceRoot, skillsDir };
  const cleanFirst = runtime.provisionMochiProfiles(cleanOptions);
  assert.deepEqual(cleanFirst.profiles, Object.keys(expectedProfiles));
  const cleanPatches = Object.fromEntries(Object.keys(expectedProfiles).map((name) => [
    name,
    readFileSync(join(cleanHome, "profiles", name, "cordis.patch.yml"), "utf8"),
  ]));
  const cleanSecond = runtime.provisionMochiProfiles(cleanOptions);
  assert.deepEqual(cleanSecond.updated, [], "a second clean-home provision must be byte-idempotent");
  for (const [name, patch] of Object.entries(cleanPatches)) {
    const current = readFileSync(join(cleanHome, "profiles", name, "cordis.patch.yml"), "utf8");
    assert.equal(current, patch, `${name} changed on its second clean-home provision`);
    assert.equal(pluginRowCount(current, "mochi-llm-mimo"), 1, `${name} must contain one MIMO entry`);
    assert.ok(current.includes(`config: ${JSON.stringify(expectedMimoInitialConfig)}`), `${name} omitted the versioned MIMO config`);
    assertMimoConfig(dumpProfile(cleanHome, name));
  }
  assertVisiblePresetRoot(cleanHome);
  // 负向对照：过滤必须真的把非白名单预设挡在外面，而不是“目录恰好为空”。
  assert.equal(existsSync(join(cleanHome, VISIBLE_PRESET_ROOT_NAME, "cordis", "preset.yml")), true);
  await assertMimoPluginApply();

  // [Mochi patch] The win32 directory picker is pinned to the browse interaction
  // (the koffi/COM child process never reports back on a real Windows install).
  // MOCHI_DIRECTORY_PICKER forces the choice so both settings are provable here.
  const pinHome = join(home, "directory-picker-pin");
  const pinOptions = { homeDir: pinHome, resourceRoot, workspaceRoot, skillsDir };
  const previousPickerSetting = process.env.MOCHI_DIRECTORY_PICKER;
  try {
    delete process.env.MOCHI_DIRECTORY_PICKER;
    runtime.provisionMochiProfiles(pinOptions);
    const unpinned = readFileSync(join(pinHome, "profiles", "mochi-web", "cordis.patch.yml"), "utf8");
    if (process.platform === "win32") {
      assert.match(unpinned, /- id: directory-picker\n\s+disabled: true/, "win32 must disable the adaptive picker row by default");
      assert.match(unpinned, /name: '@deepseek-ai\/dsh-host-directory-picker-browse'/, "win32 must mount the browse backend by default");
    } else {
      assert.doesNotMatch(unpinned, /directory-picker-browse/, "only win32 pins the browse interaction by default");
    }

    process.env.MOCHI_DIRECTORY_PICKER = "browse";
    runtime.provisionMochiProfiles(pinOptions);
    const pinned = readFileSync(join(pinHome, "profiles", "mochi-web", "cordis.patch.yml"), "utf8");
    assert.match(pinned, /- id: directory-picker\n\s+disabled: true/, "the pinned profile must disable the adaptive picker row");
    assert.match(pinned, /name: '@deepseek-ai\/dsh-host-directory-picker-browse'/, "the pinned profile must mount the browse backend");
    assert.match(pinned, /name: '@deepseek-ai\/dsh-client-ui-directory-picker-browse'/, "the pinned profile must mount the browse surface");
    for (const name of ["headless", "mochi"]) {
      assert.doesNotMatch(
        readFileSync(join(pinHome, "profiles", name, "cordis.patch.yml"), "utf8"),
        /directory-picker-browse/,
        `${name} has no web bundle and must not carry the picker pin`,
      );
    }
    const pinnedDump = dumpProfile(pinHome, "mochi-web");
    assert.match(configuredRow(pinnedDump, "directory-picker"), /disabled: true/, "the composed tree must disable the adaptive picker row");
    assert.equal(configuredRow(pinnedDump, "directory-picker-browse").includes("dsh-host-directory-picker-browse"), true);
    assert.equal(configuredRow(pinnedDump, "directory-picker-browse-surface").includes("dsh-client-ui-directory-picker-browse"), true);

    process.env.MOCHI_DIRECTORY_PICKER = "native";
    runtime.provisionMochiProfiles(pinOptions);
    assert.doesNotMatch(
      readFileSync(join(pinHome, "profiles", "mochi-web", "cordis.patch.yml"), "utf8"),
      /directory-picker-browse/,
      "MOCHI_DIRECTORY_PICKER=native must hand the picker back to the adaptive row",
    );

    process.env.MOCHI_DIRECTORY_PICKER = "bogus";
    assert.throws(() => runtime.provisionMochiProfiles(pinOptions), /MOCHI_DIRECTORY_PICKER/);
  } finally {
    if (previousPickerSetting === undefined) delete process.env.MOCHI_DIRECTORY_PICKER;
    else process.env.MOCHI_DIRECTORY_PICKER = previousPickerSetting;
  }

  const migrationHome = join(home, "managed-migration");
  const migrationPatchPath = join(migrationHome, "profiles", "mochi", "cordis.patch.yml");
  mkdirSync(dirname(migrationPatchPath), { recursive: true });
  writeFileSync(migrationPatchPath, `${runtime.MANAGED_PATCH_BEGIN}\n- insert:\n    - id: mochi-llm-mimo\n      name: mochi-llm-mimo\n${runtime.MANAGED_PATCH_END}\n`);
  const migrationOptions = { homeDir: migrationHome, resourceRoot, workspaceRoot, skillsDir };
  runtime.provisionMochiProfiles(migrationOptions);
  const migratedPatch = readFileSync(migrationPatchPath, "utf8");
  const migratedManaged = migratedPatch.slice(migratedPatch.indexOf(runtime.MANAGED_PATCH_BEGIN), migratedPatch.indexOf(runtime.MANAGED_PATCH_END));
  assert.equal(pluginRowCount(migratedPatch, "mochi-llm-mimo"), 1, "an old managed MIMO row must migrate without duplication");
  assert.ok(migratedPatch.includes(`config: ${JSON.stringify(expectedMimoInitialConfig)}`), "an old managed MIMO row must gain the required initial config");
  assert.doesNotMatch(migratedManaged, /id: mochi-llm-mimo/, "a migrated MIMO row must leave the managed block");
  assert.deepEqual(runtime.provisionMochiProfiles(migrationOptions).updated, [], "a migrated profile must be idempotent");

  const userPatch = join(home, "cordis.patch.yml");
  const sessionFile = join(home, "sessions", "existing-session.json");
  const legacyProfileDir = join(home, "profiles", "headless");
  const legacyProfilePatch = join(legacyProfileDir, "cordis.patch.yml");
  const legacyProfileManifest = join(legacyProfileDir, "package.json");
  const manualMimoConfig = {
    apiKeyEnv: "USER_MIMO_API_KEY",
    baseURL: "https://manual.example.test/v1",
    reasoningEffort: "off",
    models: [{ id: "manual-mimo", contextWindow: 4096, maxTokens: 1024, reasoningEfforts: ["off"] }],
  };
  const manualMimoEntry = `    - id: "mochi-llm-mimo" # manual endpoint and catalog
      name: mochi-llm-mimo
      config:
        apiKeyEnv: ${manualMimoConfig.apiKeyEnv}
        baseURL: ${manualMimoConfig.baseURL}
        reasoningEffort: ${manualMimoConfig.reasoningEffort}
        models:
          - id: manual-mimo
            contextWindow: 4096
            maxTokens: 1024
            reasoningEfforts:
              - off`;
  mkdirSync(dirname(sessionFile), { recursive: true });
  mkdirSync(legacyProfileDir, { recursive: true });
  writeFileSync(userPatch, "[]\n");
  writeFileSync(sessionFile, '{"keep":"session"}\n');
  writeFileSync(legacyProfilePatch, `# personal profile content remains outside Mochi's managed block.\n- insert:\n    - id: 'mochi-hello' # legacy quote and comment\n      name: mochi-hello\n    - id: "mochi-campus" # legacy quote and comment\n      name: mochi-campus\n${manualMimoEntry}\n`);
  writeFileSync(legacyProfileManifest, `${JSON.stringify({
    scripts: { "user-task": "echo retained" },
    dependencies: { "user-plugin": "file:../user-plugin" },
    dsh: { profile: { userField: "retained" } },
  }, null, 2)}\n`);
  const emptyProfileDir = join(home, "profiles", "mochi");
  mkdirSync(emptyProfileDir, { recursive: true });
  writeFileSync(join(emptyProfileDir, "cordis.patch.yml"), "[]\n");

  const options = { homeDir: home, resourceRoot, workspaceRoot, skillsDir };
  const first = runtime.provisionMochiProfiles(options);
  assert.deepEqual(first.profiles, Object.keys(expectedProfiles));
  const second = runtime.provisionMochiProfiles(options);
  assert.deepEqual(second.updated, [], "a second provision must be idempotent");
  assertVisiblePresetRoot(home);

  assert.equal(readFileSync(userPatch, "utf8"), "[]\n", "home-level user patch changed");
  assert.equal(readFileSync(sessionFile, "utf8"), '{"keep":"session"}\n', "existing session changed");
  assert.equal(existsSync(join(home, ".credentials.yaml")), false, "provisioner created credentials");
  assert.equal(existsSync(join(home, ".credentials.yaml.lock")), false, "provisioner created a credential lock");
  const preservedLegacyPatch = readFileSync(legacyProfilePatch, "utf8");
  assert.match(preservedLegacyPatch, /personal profile content remains outside/);
  assert.match(preservedLegacyPatch, /Mochi managed runtime profile/);
  assert.ok(preservedLegacyPatch.includes(manualMimoEntry), "manual MIMO endpoint, models, and config changed");
  assert.equal(pluginRowCount(preservedLegacyPatch, "mochi-llm-mimo"), 1, "manual MIMO config gained a duplicate generated row");
  assert.doesNotMatch(readFileSync(join(emptyProfileDir, "cordis.patch.yml"), "utf8"), /^\s*\[\]/);

  const invalidResourceRoot = join(home, "invalid-runtime-resource");
  const invalidHome = join(home, "invalid-runtime-home");
  cpSync(resourceRoot, invalidResourceRoot, { recursive: true });
  const invalidManifestPath = join(invalidResourceRoot, "runtime-profile.json");
  const invalidManifest = JSON.parse(readFileSync(invalidManifestPath, "utf8"));
  invalidManifest.plugins["mochi-dispatch"].workspacePath = "plugins/not-present";
  writeFileSync(invalidManifestPath, `${JSON.stringify(invalidManifest, null, 2)}\n`);
  assert.throws(
    () => runtime.provisionMochiProfiles({ homeDir: invalidHome, resourceRoot: invalidResourceRoot, workspaceRoot, skillsDir }),
    /Mochi 插件不存在或不是目录/,
  );
  assert.equal(existsSync(join(invalidHome, "profiles", "headless", "cordis.patch.yml")), false, "invalid runtime wrote a partial profile");

  for (const [name, expected] of Object.entries(expectedProfiles)) {
    const profileDir = join(home, "profiles", name);
    const patch = readFileSync(join(profileDir, "cordis.patch.yml"), "utf8");
    const profileManifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));

    assert.match(patch, /id: skill-filesystem[\s\S]{0,280}disabled: false/);
    assert.ok(patch.includes(JSON.stringify(skillsDir)), `${name} uses an unexpected skills path`);
    assert.deepEqual(profileManifest.dsh.profile.bundles, expected.bundles);
    assert.equal(profileManifest.mochiRuntime.schemaVersion, 1);

    if (name === "headless") {
      assert.equal(profileManifest.scripts["user-task"], "echo retained");
      assert.equal(profileManifest.dependencies["user-plugin"], "file:../user-plugin");
      assert.equal(profileManifest.dsh.profile.userField, "retained");
      const managed = patch.slice(patch.indexOf(runtime.MANAGED_PATCH_BEGIN), patch.indexOf(runtime.MANAGED_PATCH_END));
      assert.doesNotMatch(managed, /id: mochi-hello/);
      assert.doesNotMatch(managed, /id: mochi-campus/);
      assert.match(managed, /id: mochi-dispatch/);
    }

    const configuredPluginIds = runtime.collectPluginIds(patch);
    for (const plugin of expected.plugins) {
      const link = join(profileDir, "node_modules", plugin);
      assert.equal(lstatSync(link).isSymbolicLink(), true, `${name}/${plugin} is not a link`);
      assert.ok(realpathSync(link).startsWith(workspaceRoot), `${name}/${plugin} points outside the workspace`);
      assert.ok(configuredPluginIds.has(plugin), `${name} patch omitted ${plugin}`);
    }
    assert.equal(pluginRowCount(patch, "mochi-llm-mimo"), 1, `${name} must keep exactly one MIMO entry`);

    const dump = dumpProfile(home, name);
    assert.match(dump, /id: skill-filesystem[\s\S]{0,300}disabled: false/);
    assert.ok(dump.includes(skillsDir), `${name} dump omitted the Mochi skills directory`);
    for (const plugin of expected.plugins) assert.match(dump, new RegExp(`id: ${plugin}`));
    assertMimoConfig(dump, name === "headless" ? manualMimoConfig : expectedMimoInitialConfig);

    if (name === "mochi-web") {
      for (const [id, packageName] of [
        ["goal-round-driver", "@deepseek-ai/dsh-goal-round-driver"],
        ["session-stats", "@deepseek-ai/dsh-session-stats"],
        ["session-log-download", "@deepseek-ai/dsh-session-log-export"],
      ]) {
        const row = configuredRow(dump, id);
        assert.match(row, new RegExp(`name: ['\"]${packageName}['\"]`));
        assert.doesNotMatch(row, /^\s*disabled:\s*true\s*$/m, `${id} must retain its official web capability`);
      }
      const trajectoryRow = configuredRow(dump, "ui-trajectory");
      assert.match(trajectoryRow, /name: ['"]@deepseek-ai\/dsh-client-ui-trajectory['"]/);
      assert.match(trajectoryRow, /^\s*disabled:\s*true\s*$/m, "the teacher composition must not mount the raw trajectory view");
      const chatRow = configuredRow(dump, "ui-chat");
      assert.match(chatRow, /name: ['"]@deepseek-ai\/dsh-client-ui-chat['"]/);
      assert.doesNotMatch(chatRow, /^\s*disabled:\s*true\s*$/m, "the chat view must stay mounted as the default mode");
    }
  }

  console.log("[test-runtime-profile] PASS: clean home generated all profiles, preserved user state, and parsed each official composition.");
} finally {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
}
