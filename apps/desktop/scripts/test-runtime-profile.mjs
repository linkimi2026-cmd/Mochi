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
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    plugins: ["mochi-hello", "mochi-dispatch", "mochi-campus", "mochi-web-search", "mochi-llm-mimo"],
  },
  mochi: {
    bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"],
    plugins: ["mochi-hello", "mochi-dispatch", "mochi-campus", "mochi-web-search", "mochi-llm-mimo", "mochi-approval"],
  },
  "mochi-web": {
    bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
    plugins: ["mochi-hello", "mochi-dispatch", "mochi-campus", "mochi-web-search", "mochi-llm-mimo", "jxl-theme", "jxl-brand", "jxl-campus", "mochi-workbench", "mochi-model-presets", "dsh-better-sidebar"],
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
      reasoningEfforts: ["off", "low", "medium", "high"],
    },
    {
      id: "mimo-v2.5-pro",
      contextWindow: 131072,
      maxTokens: 8192,
      reasoningEfforts: ["off", "low", "medium", "high"],
    },
  ],
};

const runtimeProfile = JSON.parse(readFileSync(join(resourceRoot, "runtime-profile.json"), "utf8"));
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
  await assertMimoPluginApply();

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
    }
  }

  console.log("[test-runtime-profile] PASS: clean home generated all profiles, preserved user state, and parsed each official composition.");
} finally {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
}
