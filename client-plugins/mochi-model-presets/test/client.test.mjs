import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

function loadClient() {
  const factories = new Map();
  const react = {
    createElement(type, props, children) { return { type, props, children }; },
    useEffect() {},
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
  };
  const sandbox = {
    Array,
    Error,
    Map,
    Object,
    Promise,
    Set,
    String,
    Symbol,
    console,
    window: {
      __ModuleLoader__: {
        load(entry) { factories.set(entry.id, entry.factory); },
      },
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "mochi-model-presets/client.js" });
  const factory = factories.get("mochi-model-presets");
  assert.ok(factory, "browser plugin registers with ModuleLoader");
  return factory((name) => {
    if (name === "react") return react;
    throw new Error(`unexpected module request: ${name}`);
  });
}

function settingsView(providers = {}, revision = 7, writable = true) {
  return {
    ok: true,
    value: {
      writable,
      namespaces: [{ ns: "llm-pi-ai", value: { providers }, revision }],
    },
  };
}

/** Values crossing the VM boundary have another Realm's prototypes. */
function json(value) {
  return JSON.parse(JSON.stringify(value));
}

function walkElement(node, visit) {
  if (Array.isArray(node)) {
    node.forEach((child) => walkElement(child, visit));
    return;
  }
  if (!node || typeof node !== "object") return;
  visit(node);
  walkElement(node.children, visit);
}

test("catalog presentation is generated from the pinned pi-ai runtime without a second model-id list", () => {
  const api = loadClient();
  const catalog = api.__test.PRESET_CATALOG;
  assert.equal(catalog.piAiVersion, "0.84.4");
  assert.equal(catalog.presets.length, 5);
  assert.deepEqual(json(catalog.presets.map((preset) => preset.route)), [
    "zai", "zai-coding-cn", "moonshotai-cn", "minimax-cn", "deepseek",
  ]);
  for (const preset of catalog.presets) {
    assert.ok(preset.modelCount > 0, `${preset.route} has installed catalog models`);
    assert.match(preset.endpoint, /^https:\/\//, `${preset.route} endpoint is catalog-derived`);
    assert.ok(["openai-completions", "anthropic-messages"].includes(preset.protocol));
    assert.equal(Object.hasOwn(preset, "models"), false, "the UI does not carry a model-id list");
    assert.match(preset.official.url, /^https:\/\//, `${preset.route} has an official source`);
  }
  const zai = catalog.presets.find((preset) => preset.route === "zai");
  const zaiCn = catalog.presets.find((preset) => preset.route === "zai-coding-cn");
  const moonshot = catalog.presets.find((preset) => preset.route === "moonshotai-cn");
  assert.match(zai.label, /Coding Plan/);
  assert.match(zaiCn.label, /Coding Plan/);
  assert.notEqual(zai.endpoint, zaiCn.endpoint, "international and China Coding Plan endpoints remain distinct");
  assert.equal(moonshot.credentialRef, "MOONSHOT_API_KEY", "credential references come from the installed provider source");
  assert.match(catalog.notices[0].endpoint, /\/api\/paas\/v4$/);
  assert.match(catalog.notices[0].body, /不同/);
});

test("an explicit preset click writes only an empty catalog profile through the official revision fence", async () => {
  const api = loadClient();
  const calls = [];
  const remote = {
    settings: {
      describe: async () => settingsView({}, 41),
      mutate: async (...args) => {
        calls.push(args);
        return { ok: true, value: { ns: "llm-pi-ai", value: { providers: { zai: {} } }, revision: 42 } };
      },
    },
  };
  const outcome = await api.__test.addPreset(remote, "zai");
  assert.deepEqual(json(outcome), { kind: "added" });
  assert.deepEqual(json(calls), [[
    "llm-pi-ai",
    [{ op: "set", path: ["providers", "zai"], value: {} }],
    41,
  ]]);
  assert.equal("credentials" in remote, false, "the preset never receives or writes a key");
  assert.equal("llm" in remote, false, "the preset does not send a model request");
  assert.equal("session" in remote, false, "the preset does not change the active session model");
});

test("existing, read-only, conflicted, and unknown preset paths never overwrite a profile", async () => {
  const api = loadClient();
  let mutateCalls = 0;
  const existing = await api.__test.addPreset({
    settings: {
      describe: async () => settingsView({ zai: { baseURL: "https://kept.example" } }, 4),
      mutate: async () => { mutateCalls += 1; return { ok: true }; },
    },
  }, "zai");
  assert.deepEqual(json(existing), { kind: "already" });
  assert.equal(mutateCalls, 0);

  const readonly = await api.__test.addPreset({
    settings: {
      describe: async () => settingsView({}, 4, false),
      mutate: async () => { mutateCalls += 1; return { ok: true }; },
    },
  }, "zai");
  assert.equal(readonly.kind, "refused");
  assert.match(readonly.message, /只读/);
  assert.equal(mutateCalls, 0);

  const conflict = await api.__test.addPreset({
    settings: {
      describe: async () => settingsView({}, 4),
      mutate: async () => ({ ok: false, error: { code: "settings/conflict" } }),
    },
  }, "zai");
  assert.equal(conflict.kind, "refused");
  assert.match(conflict.message, /刷新/);

  const unknown = await api.__test.addPreset({ settings: {} }, "not-a-route");
  assert.equal(unknown.kind, "refused");
  assert.match(unknown.message, /未识别/);
});

test("status reports configuration and stored-key state without falsely claiming an online connection", async () => {
  const api = loadClient();
  const snapshot = await api.__test.readPresetSnapshot({
    settings: { describe: async () => settingsView({ zai: { apiKeyEnv: "ZAI_API_KEY" }, deepseek: {} }) },
    credentials: {
      describe: async (refs) => ({
        ok: true,
        value: Object.fromEntries(refs.map((ref) => [ref, { configured: ref === "ZAI_API_KEY" }])),
      }),
    },
  });
  const zai = snapshot.entries.find((entry) => entry.route === "zai");
  const deepseek = snapshot.entries.find((entry) => entry.route === "deepseek");
  assert.equal(zai.configured, true);
  assert.equal(zai.keyState, "stored");
  assert.match(api.__test.statusText(zai, snapshot), /尚未实测连接/);
  assert.equal(deepseek.configured, true);
  assert.equal(deepseek.keyState, "missing");
  assert.match(api.__test.statusText(deepseek, snapshot), /待在原生卡片填写/);
});

test("teacher-facing cards keep connection mechanics behind an explicit disclosure", () => {
  const api = loadClient();
  const footer = api.__test.PresetFooter({ ctx: { remote: {} } });
  const details = [];
  const summaries = [];
  walkElement(footer, (element) => {
    if (element.type === "details") details.push(element);
    if (element.type === "summary") summaries.push(element.children);
  });
  assert.equal(details.length, api.__test.PRESET_CATALOG.presets.length + api.__test.PRESET_CATALOG.notices.length);
  assert.deepEqual(json(summaries), Array(details.length).fill("连接详情"));

  const providerHint = api.__test.ProviderCardHint({
    provider: { provider: "zai" },
    configured: true,
    keyConfigured: false,
  });
  const hintDetails = [];
  walkElement(providerHint, (element) => {
    if (element.type === "details") hintDetails.push(element);
  });
  assert.equal(hintDetails.length, 1, "native provider-card hint also avoids repeating endpoint details inline");
});

test("the contribution uses only additive official Models slots", () => {
  const api = loadClient();
  const registrations = [];
  const injected = [];
  const ctx = {
    slots: {
      inject(name, callback) {
        injected.push(name);
        callback();
      },
      register(options, component) {
        registrations.push({ options, component });
        return { options, component };
      },
    },
  };
  api.apply(ctx);
  assert.deepEqual(injected, ["settings.models.footer", "settings.models.provider-card"]);
  assert.deepEqual(registrations.map((entry) => entry.options.name), [
    "settings.models.footer", "settings.models.provider-card",
  ]);
  assert.equal(registrations[0].options.id, "mochi-model-presets");
  assert.equal(registrations[1].options.key, "llm-pi-ai");
  assert.equal(api.inject.includes("remote.settings"), true);
  assert.equal(api.inject.includes("remote.credentials"), true);
  assert.equal(api.inject.includes("remote.llm"), false, "no misleading catalog probe is registered as a connection test");
});
