import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

function loadClient(reactOverrides = {}, globals = {}) {
  const factories = new Map();
  const react = {
    createElement(type, props, children) { return { type, props, children }; },
    useEffect() {},
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
    useRef(initial) { return { current: initial }; },
    ...reactOverrides,
  };
  const sandbox = {
    Array,
    AbortController,
    Error,
    Map,
    Object,
    Promise,
    URL,
    Set,
    String,
    Symbol,
    setTimeout,
    clearTimeout,
    console,
    window: {
      __ModuleLoader__: {
        load(entry) { factories.set(entry.id, entry.factory); },
      },
    },
    ...globals,
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
  assert.equal(catalog.piAiVersion, "0.87.1");
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

test("MiMo card stores fixture keys through the native credential remote without echoing them", async () => {
  const api = loadClient();
  const calls = [];
  const key = "fixture-classroom-key-2026";
  const saved = await api.__test.saveMimoCredential({
    settings: { describe: async () => ({ ok: true, value: { namespaces: [{ ns: "mochi-llm-mimo", value: { apiKeyEnv: "MIMO_API_KEY" } }] } }) },
    credentials: {
      describe: async () => ({ ok: true, value: { MIMO_API_KEY: { configured: false, writable: true } } }),
      set: async (...args) => { calls.push(args); return { ok: true }; },
    },
  }, ` ${key} `);
  assert.deepEqual(json(saved), { kind: "saved" });
  assert.deepEqual(json(calls), [["MIMO_API_KEY", key]]);
  assert.equal(JSON.stringify(saved).includes(key), false);
  assert.match(api.__test.validateCredentialInput("MIMO_API_KEY=fixture"), /只粘贴密钥/);
  assert.match(api.__test.validateCredentialInput("'fixture-key'"), /只粘贴密钥/);
  assert.deepEqual(json(await api.__test.saveMimoCredential({
    settings: { describe: async () => ({ ok: true, value: { namespaces: [{ ns: "mochi-llm-mimo", value: { apiKeyEnv: "MIMO_API_KEY" } }] } }) },
    credentials: { describe: async () => ({ ok: true, value: { MIMO_API_KEY: { configured: false, writable: true } } }), set: async () => ({ ok: false }) },
  }, key)), {
    kind: "refused", message: "密钥未能保存，请检查教室配置是否可写后重试。",
  });
});

test("MiMo connection test uses only the authenticated fixed doctor route and maps bounded result codes", async () => {
  const api = loadClient();
  const call = [];
  const result = (code, status = "unavailable") => ({
    version: "mochi-doctor-model-check/v1", scope: "mochi-mimo",
    "model-service": { status, code, durationMs: 4 },
    credentials: { status: "not-checked", code: "NOT_CHECKED", durationMs: 4 },
  });
  const fetchImpl = async (...args) => {
    call.push(args);
    return { ok: true, status: 200, json: async () => result("OK", "ok") };
  };
  assert.deepEqual(json(await api.__test.testMimoConnection(fetchImpl)), { kind: "success", message: "MiMo 连接测试成功。" });
  assert.equal(call[0][0], "/api/mochi-doctor/check-model");
  assert.deepEqual(json(call[0][1]), {
    method: "POST", credentials: "same-origin", redirect: "manual",
    headers: { "content-type": "application/json" }, body: "{}", signal: {},
  });
  const map = async (code) => api.__test.testMimoConnection(async () => ({ ok: true, status: 200, json: async () => result(code) }));
  assert.match((await map("MISSING_CREDENTIAL")).message, /尚未配置/);
  assert.match((await map("AUTH_FAILED")).message, /服务未接受此密钥/);
  assert.match((await map("ACCOUNT_UNAVAILABLE")).message, /额度/);
  assert.match((await map("UPSTREAM_UNAVAILABLE")).message, /上游/);
  assert.match((await map("PROVIDER_UNAVAILABLE")).message, /本机.*配置/);
  assert.match((await map("NO_MODEL")).message, /模型目录/);
  assert.match((await map("TIMEOUT")).message, /超时/);
  assert.match((await api.__test.testMimoConnection(async () => ({ ok: false, status: 409, json: async () => result("CHECK_IN_PROGRESS") }))).message, /正在进行/);
  assert.match((await api.__test.testMimoConnection(async () => ({ status: 401, ok: false, json: async () => ({ secret: "must not show" }) }))).message, /登录/);
  assert.match((await api.__test.testMimoConnection(async () => { throw new TypeError("sensitive provider text"); })).message, /网络/);
  const malformed = await api.__test.testMimoConnection(async () => ({ ok: true, status: 200, json: async () => ({ version: "bad", body: "sensitive" }) }));
  assert.match(malformed.message, /无法识别/);
  assert.equal(JSON.stringify(malformed).includes("sensitive"), false);
});

test("MiMo card presents test action and cost/scope disclosure, disabled before a saved key", () => {
  const api = loadClient();
  const card = api.__test.MimoCredentialCard({ ctx: { remote: {} }, keyConfigured: false });
  const buttons = [];
  const texts = [];
  walkElement(card, (element) => {
    if (element.type === "button") buttons.push(element);
    if (typeof element.children === "string") texts.push(element.children);
  });
  const testButton = buttons.find((button) => button.children === "测试 MiMo 连接");
  assert.ok(testButton);
  assert.equal(testButton.props.disabled, true);
  assert.match(texts.join(" "), /可能产生少量费用/);
  assert.match(texts.join(" "), /首个目录模型/);
  const setDefault = buttons.find((button) => button.children === "设为新对话默认模型");
  assert.ok(setDefault);
  assert.equal(setDefault.props.disabled, true);
  assert.match(texts.join(" "), /当前会话模型可能不同/);
});

test("MiMo card distinguishes an existing session route from the new-conversation default", () => {
  const api = loadClient();
  const calls = [];
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ current: "existing-classroom-session" }) } },
    modelDirectories: { directoryFor(sessionId) {
      calls.push(sessionId);
      return { store: { getSnapshot: () => ({ current: { provider: "deepseek-official", model: "deepseek-v4-flash" }, routable: true }) } };
    } },
    remote: {},
  };
  const model = api.__test.activeSessionModel(ctx);
  assert.deepEqual(json(model), { kind: "ready", provider: "deepseek-official", model: "deepseek-v4-flash", routable: true });
  assert.deepEqual(calls, ["existing-classroom-session"]);
  const guidance = api.__test.activeSessionGuidance(model, true);
  assert.match(guidance, /此处保存的 MiMo Key 不用于该会话/);
  assert.match(guidance, /输入框旁的模型菜单显式切换/);
  const card = api.__test.MimoCredentialCard({ ctx, keyConfigured: true });
  const texts = [];
  walkElement(card, (element) => { if (typeof element.children === "string") texts.push(element.children); });
  assert.match(texts.join(" "), /deepseek-official \/ deepseek-v4-flash/);
  assert.equal(api.__test.activeSessionGuidance({ kind: "ready", provider: "mochi-mimo", model: "mimo-v2.5", routable: true }, false).includes("尚未配置 MiMo Key"), true);
  assert.match(api.__test.activeSessionGuidance({ kind: "ready", provider: "mochi-mimo", model: "mimo-v2.5", routable: false }, true), /路由目前不可用/);
});

test("MiMo effective service address shows only the configured origin for mochi-mimo", async () => {
  const api = loadClient();
  const read = (baseURL) => api.__test.mimoServiceOrigin({ namespaces: [
    { ns: "other", value: { baseURL: "https://wrong.example" } },
    { ns: "mochi-llm-mimo", value: { baseURL } },
  ] });
  assert.equal(read("https://user:password@mimo.example:8443/v1/chat?token=secret#fragment"), "https://mimo.example:8443");
  assert.equal(read("file:///etc/passwd"), undefined);
  assert.equal(read("not a URL"), undefined);
  assert.equal(read(undefined), undefined);
  assert.equal(await api.__test.readMimoServiceOrigin({ settings: { describe: async () => ({ ok: false, error: { message: "private detail" } }) } }), undefined);
  assert.equal(await api.__test.readMimoServiceOrigin({ settings: { describe: async () => { throw new Error("private detail"); } } }), undefined);
});

test("MiMo refresh reads the current effective address and configured credential reference", async () => {
  const api = loadClient();
  let baseURL = "https://first.example/v1";
  let ref = "FIRST_MIMO_KEY";
  const remote = {
    settings: { describe: async () => ({ ok: true, value: { namespaces: [
      { ns: "other", value: { baseURL: "https://wrong.example" } },
      { ns: "mochi-llm-mimo", value: { baseURL, apiKeyEnv: ref } },
    ] } }) },
    credentials: { describe: async ([name]) => ({ ok: true, value: { [name]: { configured: name === "SECOND_MIMO_KEY" } } }) },
  };
  assert.deepEqual(json(await api.__test.readMimoCardState(remote)), {
    serviceOrigin: "https://first.example", configured: false, defaultWritable: false,
  });
  baseURL = "https://second.example:8443/v1";
  ref = "SECOND_MIMO_KEY";
  assert.deepEqual(json(await api.__test.readMimoCardState(remote)), {
    serviceOrigin: "https://second.example:8443", configured: true, defaultWritable: false,
  });
  assert.equal(JSON.stringify(await api.__test.readMimoCardState(remote)).includes("KEY"), false);
});

test("MiMo default selection is an explicit revision-fenced native settings write", async () => {
  const api = loadClient();
  const calls = [];
  let defaultValue = { provider: "zai", model: "glm-4.5" };
  const remote = {
    settings: {
      describe: async () => ({ ok: true, value: { writable: true, namespaces: [
        { ns: "mochi-llm-mimo", value: { apiKeyEnv: "MIMO_API_KEY" } },
        { ns: "agent-default-model", value: defaultValue, revision: 29 },
      ] } }),
      mutate: async (...args) => { calls.push(args); return { ok: true }; },
    },
    credentials: { describe: async () => ({ ok: true, value: { MIMO_API_KEY: { configured: true } } }) },
  };
  assert.deepEqual(json(await api.__test.setMimoDefaultModel(remote)), { kind: "saved" });
  assert.deepEqual(json(calls), [["agent-default-model", [
    { op: "set", path: ["provider"], value: "mochi-mimo" },
    { op: "set", path: ["model"], value: "mimo-v2.5" },
    { op: "unset", path: ["reasoningEffort"] },
  ], 29]]);
  defaultValue = { provider: "mochi-mimo", model: "mimo-v2.5" };
  assert.deepEqual(json(await api.__test.setMimoDefaultModel(remote)), { kind: "already" });
  assert.equal(calls.length, 1, "an already-current default is not rewritten");
  const missingKey = await api.__test.setMimoDefaultModel({ ...remote, credentials: { describe: async () => ({ ok: true, value: { MIMO_API_KEY: { configured: false } } }) } });
  assert.equal(missingKey.kind, "refused");
  assert.match(missingKey.message, /先保存/);
  assert.equal(calls.length, 1);
  const conflict = await api.__test.setMimoDefaultModel({ ...remote, settings: {
    ...remote.settings,
    describe: async () => ({ ok: true, value: { writable: true, namespaces: [
      { ns: "mochi-llm-mimo", value: {} }, { ns: "agent-default-model", value: { provider: "zai", model: "glm-4.5" }, revision: 30 },
    ] } }),
    mutate: async (...args) => { calls.push(args); return { ok: false, error: { code: "settings/conflict" } }; },
  } });
  assert.equal(conflict.kind, "refused");
  assert.match(conflict.message, /刷新/);
});

test("MiMo card does not refetch its descriptor when read results trigger React rerenders", async () => {
  const hookState = [];
  let hookIndex = 0;
  let renderCount = 0;
  let scheduled = false;
  let loopCutoff = false;
  let settingsDescribeCalls = 0;
  let credentialDescribeCalls = 0;
  const listeners = new Map();
  const remoteService = {
    $on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); },
    settings: { describe: async () => {
      settingsDescribeCalls += 1;
      return { ok: true, value: { writable: true, namespaces: [
        { ns: "mochi-llm-mimo", value: { baseURL: "https://mimo.example/v1", apiKeyEnv: "MIMO_API_KEY" } },
        { ns: "agent-default-model", value: { provider: "deepseek-official", model: "deepseek-v4-flash" }, revision: 4 },
      ] } };
    } },
    credentials: { describe: async ([name]) => {
      credentialDescribeCalls += 1;
      return { ok: true, value: { [name]: { configured: false } } };
    } },
  };
  const ctx = {
    // Cordis returns a new traceable service proxy on each property read.
    get remote() { return new Proxy(remoteService, {}); },
  };
  const requestRender = () => {
    if (scheduled || renderCount >= 12) {
      if (renderCount >= 12) loopCutoff = true;
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (renderCount < 12) render();
      else loopCutoff = true;
    });
  };
  const api = loadClient({
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hookState)) hookState[index] = typeof initial === "function" ? initial() : initial;
      return [hookState[index], (next) => {
        const value = typeof next === "function" ? next(hookState[index]) : next;
        if (!Object.is(hookState[index], value)) { hookState[index] = value; requestRender(); }
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in hookState)) hookState[index] = { current: initial };
      return hookState[index];
    },
    useEffect(effect, deps) {
      const index = hookIndex++;
      const previous = hookState[index];
      const changed = !previous || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]));
      if (!changed) return;
      previous?.cleanup?.();
      hookState[index] = { deps: [...deps], cleanup: effect() };
    },
  });
  function render() {
    renderCount += 1;
    hookIndex = 0;
    return api.__test.MimoCredentialCard({ ctx, keyConfigured: false });
  }
  async function settle() {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }

  render();
  await settle();
  assert.equal(loopCutoff, false, "descriptor state updates must not create a render/effect loop");
  assert.equal(settingsDescribeCalls, 1, "opening the card should describe settings once");
  assert.equal(credentialDescribeCalls, 1, "opening the card should describe credentials once");

  listeners.get("settings/document-updated")();
  await settle();
  assert.equal(loopCutoff, false);
  assert.equal(settingsDescribeCalls, 2, "one pushed settings invalidation should trigger one refresh");
  assert.equal(credentialDescribeCalls, 2, "one pushed settings invalidation should trigger one credential refresh");

  for (const hook of hookState) hook?.cleanup?.();
});

test("MiMo card clears stale configured state on read failure and reconciles saves against a changed ref", async () => {
  const hookState = [];
  let hookIndex = 0;
  let effectStarted = false;
  let refresh;
  const api = loadClient({
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hookState)) hookState[index] = typeof initial === "function" ? initial() : initial;
      return [hookState[index], (value) => { hookState[index] = typeof value === "function" ? value(hookState[index]) : value; }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in hookState)) hookState[index] = { current: initial };
      return hookState[index];
    },
    useEffect(effect) {
      if (!effectStarted) { effectStarted = true; refresh = effect(); }
    },
  });
  let baseURL = "https://first.example/v1";
  let ref = "FIRST_MIMO_KEY";
  let readable = true;
  let releaseSave;
  const listeners = new Map();
  const remote = {
    $on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); },
    settings: { describe: async () => readable ? ({ ok: true, value: { namespaces: [
      { ns: "mochi-llm-mimo", value: { baseURL, apiKeyEnv: ref } },
    ] } }) : ({ ok: false }) },
    credentials: {
      describe: async ([name]) => ({ ok: true, value: { [name]: { configured: name === "FIRST_MIMO_KEY" } } }),
      set: async () => new Promise((resolve) => { releaseSave = resolve; }),
    },
  };
  const render = () => {
    hookIndex = 0;
    return api.__test.MimoCredentialCard({ ctx: { remote }, keyConfigured: true });
  };
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  let card = render();
  await settle();
  card = render();
  const findTestButton = (node) => {
    let found;
    walkElement(node, (element) => { if (element.type === "button" && element.children === "测试 MiMo 连接") found = element; });
    return found;
  };
  assert.equal(findTestButton(card).props.disabled, false);

  readable = false;
  listeners.get("settings/document-updated")();
  await settle();
  card = render();
  assert.equal(findTestButton(card).props.disabled, true);
  const stateMessages = [];
  walkElement(card, (element) => { if (element.props?.role === "status") stateMessages.push(element.children); });
  assert.ok(stateMessages.includes("配置状态暂不可读"));

  readable = true;
  listeners.get("settings/document-updated")();
  await settle();
  card = render();
  const input = [];
  walkElement(card, (element) => { if (element.type === "input") input.push(element); });
  input[0].props.onChange({ target: { value: "fixture-key" } });
  card = render();
  let saveButton;
  walkElement(card, (element) => { if (element.type === "button" && element.children === "保存 MiMo API Key") saveButton = element; });
  const saving = saveButton.props.onClick();
  await settle();
  ref = "SECOND_MIMO_KEY";
  baseURL = "https://second.example/v1";
  listeners.get("settings/document-updated")();
  await settle();
  releaseSave({ ok: true });
  await saving;
  await settle();
  card = render();
  assert.equal(findTestButton(card).props.disabled, true, "saved old ref cannot mark the new configured ref ready");
  const endpointLabels = [];
  walkElement(card, (element) => { if (element.props?.className === "mochi-model-provider-hint__endpoint") endpointLabels.push(element.children); });
  assert.match(endpointLabels[0], /https:\/\/second\.example/);
  refresh?.();
});

test("MiMo credential card follows the current configured apiKeyEnv and refuses unsafe or unreadable refs", async () => {
  const api = loadClient();
  const writes = [];
  const remote = (ref) => ({
    settings: { describe: async () => ({ ok: true, value: { namespaces: [{ ns: "mochi-llm-mimo", value: { apiKeyEnv: ref } }] } }) },
    credentials: {
      describe: async () => ({ ok: true, value: { [ref]: { configured: false, writable: true } } }),
      set: async (...args) => { writes.push(args); return { ok: true }; },
    },
  });
  assert.deepEqual(json(await api.__test.saveMimoCredential(remote("CLASSROOM_MIMO_KEY"), "fixture-key")), { kind: "saved" });
  assert.deepEqual(json(writes), [["CLASSROOM_MIMO_KEY", "fixture-key"]]);
  assert.match((await api.__test.saveMimoCredential(remote("BAD-REF"), "fixture-key")).message, /引用名无效/);
  assert.equal(writes.length, 1, "invalid refs never write a credential");
  assert.match((await api.__test.saveMimoCredential({ settings: { describe: async () => ({ ok: false }) }, credentials: remote("MIMO_API_KEY").credentials }, "fixture-key")).message, /无法读取/);
  assert.equal(writes.length, 1, "failed settings reads never guess the default ref");
  assert.match((await api.__test.saveMimoCredential({
    settings: remote("MIMO_API_KEY").settings,
    credentials: {
      describe: async () => ({ ok: true, value: { MIMO_API_KEY: { configured: true, source: "env", writable: false } } }),
      set: async (...args) => { writes.push(args); return { ok: true }; },
    },
  }, "fixture-key")).message, /启动环境变量/);
  assert.equal(writes.length, 1, "an inherited environment key blocks misleading file writes");
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

test("the contribution preserves Models slots and adds the official composer slot", () => {
  const api = loadClient();
  const registrations = [];
  const injected = [];
  const ctx = {
    slots: {
      entries() { return []; },
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
  assert.deepEqual(injected, ["conversation.input.model", "conversation.input.right", "settings.models.footer", "settings.models.provider-card", "settings.models.provider-card"]);
  assert.deepEqual(registrations.map((entry) => entry.options.name), [
    "conversation.input.right", "settings.models.footer", "settings.models.provider-card", "settings.models.provider-card",
  ]);
  assert.equal(registrations[0].options.id, "mochi-reasoning");
  assert.equal(registrations[1].options.id, "mochi-model-presets");
  assert.equal(registrations[2].options.key, "llm-pi-ai");
  assert.equal(registrations[3].options.key, "mochi-llm-mimo");
  assert.equal(registrations[0].options.inject("fixture-session").sessionId, "fixture-session");
  assert.equal(api.inject.includes("remote.settings"), true);
  assert.equal(api.inject.includes("remote.credentials"), true);
  assert.equal(api.inject.includes("sessions"), true);
  assert.equal(api.inject.includes("modelDirectories"), true);
  assert.equal(api.inject.includes("remote.llm"), false, "no misleading catalog probe is registered as a connection test");
});

test("the public native picker entry is reused and its display cannot contradict automatic effort", () => {
  const api=loadClient(),snapshot={current:{provider:"p",model:"m",reasoningEffort:"medium"},retainedEffort:"Medium",pending:null,groups:[{id:"p",models:[{id:"m",name:"Model",reasoning:{efforts:[{id:"low"}]}}]}]},store={getSnapshot:()=>snapshot,subscribe:fn=>()=>{}},registrations=[];
  const native={component:()=>null,locale:"model",inject:id=>({directory:store,load:()=>{},select:()=>{},available:true})};
  api.apply({slots:{entries:()=>[native],inject:(_,fn)=>fn(),register:(options,component)=>registrations.push({options,component})}});
  const replacement=registrations.find(x=>x.options.name==="conversation.input.model");assert.equal(replacement.options.priority,-20);assert.equal(replacement.options.inject("session").nativeComponent,native.component);
  const projected=api.__test.modelOnlyDirectory(store);assert.equal(projected.getSnapshot(),projected.getSnapshot(),"useSyncExternalStore snapshot stays stable");assert.equal(projected.getSnapshot().current.reasoningEffort,undefined);assert.equal(projected.getSnapshot().retainedEffort,undefined);assert.equal(projected.getSnapshot().groups[0].models[0].reasoning,undefined);
  assert.equal(snapshot.current.reasoningEffort,"medium");assert.ok(snapshot.groups[0].models[0].reasoning,"shared native data is never mutated");assert.equal(projected.getSnapshot().groups[0].models[0].name,"Model");
});

test("real rc.2 SlotCore late native registration is shadowed and replacement disposes without recursion", async () => {
  const { SlotCore } = await import("../../../apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js");
  const core = new SlotCore(), api = loadClient(), effects = [];
  core.register({name:"root", children:{"conversation.input.model":{kind:"single",scope:"session"}}}, () => null);
  api.apply({slots:{
    entries:name=>core.entries(name), subscribe:(name,fn)=>core.subscribe(name,fn),
    inject:(name,fn)=>{if(name==="conversation.input.model")effects.push(fn());},
    register:(options,component)=>core.register(options,component),
  }});
  assert.equal(core.entries("conversation.input.model").length,0,"declaration precedes native contribution");
  const native = () => null, replacement = () => null;
  const removeNative=core.register({name:"conversation.input.model",locale:"model",inject:id=>({sessionId:id})},native);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(core.entries("conversation.input.model")[0].component,api.__test.NativeModelControl);
  assert.equal(core.entries("conversation.input.model")[0].inject("session").nativeComponent,native);
  assert.equal(core.entries("conversation.input.model").length,2);
  removeNative();
  const removeReplacement=core.register({name:"conversation.input.model",locale:"model",inject:id=>({sessionId:id})},replacement);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(core.entries("conversation.input.model")[0].inject("session").nativeComponent,replacement);
  assert.equal(core.entries("conversation.input.model").length,2,"own registration cannot wrap itself");
  effects[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(core.entries("conversation.input.model").length,1,"plugin disposal removes the shadow");
  removeReplacement();
});

test("a native directory refresh during manual save cannot leave reasoning controls permanently busy", async () => {
  const values=[],refs=[],effects=[];let stateIndex=0,refIndex=0,effectIndex=0,refresh,resolvePost,postCount=0;
  let snapshot={mode:"auto",current:{effort:"low"},efforts:[{id:"low"},{id:"medium"}]};
  const api=loadClient({
    useState(initial){const index=stateIndex++;if(!(index in values))values[index]=initial;return [values[index],value=>values[index]=value];},
    useRef(initial){const index=refIndex++;return refs[index]??= {current:initial};},
    useEffect(fn){if(effectIndex++===0&&!effects.length)effects.push(fn);},
  },{
    document:{addEventListener(){},removeEventListener(){}},
    fetch:async (_url,options)=> options.method==="POST" ? (++postCount,new Promise(resolve=>resolvePost=()=>resolve({ok:true,json:async()=>snapshot}))) : {ok:true,json:async()=>snapshot},
  });
  const ctx={modelDirectories:{directoryFor:()=>({store:{subscribe:fn=>{refresh=fn;return()=>{};}}})}};
  const render=()=>{stateIndex=refIndex=effectIndex=0;return api.__test.ReasoningControl({ctx,sessionId:"session"});};
  const buttons=node=>{const result=[];walkElement(node,x=>{if(x.type==="button")result.push(x);});return result;};
  render();const dispose=effects[0]();await new Promise(resolve=>setImmediate(resolve));
  buttons(render()).find(x=>x.props.key==="medium").props.onClick();
  assert.ok(buttons(render()).every(x=>x.props.disabled));
  snapshot={...snapshot,mode:"manual",current:{effort:"medium"}};refresh();
  await new Promise(resolve=>setImmediate(resolve));resolvePost();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(buttons(render()).every(x=>!x.props.disabled),"GET refresh generation must not suppress mutation finally");
  buttons(render()).find(x=>x.props.key==="auto").props.onClick();
  snapshot={...snapshot,mode:"auto"};refresh();await new Promise(resolve=>setImmediate(resolve));resolvePost();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(postCount,2);assert.equal(render().children[0].children,"思考·自动");
  assert.ok(buttons(render()).every(x=>!x.props.disabled));dispose();
});

test("actual pinned ModelSelect receives the display store and retains its native trigger action", () => {
  let factory,native,loads=0;
  const jsx=(type,props)=>({type,props,children:props.children});
  const react={useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),useState:value=>[value,()=>{}],useRef:value=>({current:value}),useId:()=>"model",useMemo:fn=>fn(),useEffect(){},useLayoutEffect(){}};
  vm.runInNewContext(readFileSync(new URL("../../../apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js",import.meta.url),"utf8"),{window:{__ModuleLoader__:{load:entry=>factory=entry.factory}}});
  const official=factory(name=>{
    if(name==="react")return react;
    if(name==="react/jsx-runtime")return {jsx,jsxs:jsx};
    if(name==="@deepseek-ai/cordis")return {Service:class {}};
    if(name==="@deepseek-ai/dsh-client-ui-primitives")return {rankByName:items=>items};
    return {};
  });
  const snapshot={current:{provider:"mochi-mimo",model:"mimo-v2.5",reasoningEffort:"low"},retainedEffort:"Low",pending:null,status:"ready",failures:[],groups:[{id:"mochi-mimo",name:"MiMo",models:[{id:"mimo-v2.5",name:"mimo-v2.5",reasoning:{efforts:[{id:"low",name:"Low"}]}}]}]},store={subscribe:()=>()=>{},getSnapshot:()=>snapshot};
  const select=()=>{};
  const ctx={effect:fn=>fn(),plugin(){},locale:{register(){},bind:()=>()=>{}},sessions:{subagentAddress:()=>undefined},modelDirectories:{directoryFor:()=>({store,load:()=>{loads++;return Promise.resolve();},select})},slots:{inject:(_name,fn)=>fn(),register:(options,component)=>native={options,component}},inject:(dependencies,fn)=>{if(dependencies[0]==="slots")fn(ctx);}};
  official.apply(ctx);
  const api=loadClient(),originalProps=native.options.inject("session"),wrapped=api.__test.NativeModelControl({nativeComponent:native.component,...originalProps,t:(key,values)=>key+JSON.stringify(values??{})});
  assert.equal(wrapped.props.select,originalProps.select);
  const tree=wrapped.type(wrapped.props),trigger=tree.children[0];
  assert.equal(trigger.props.title,"mimo-v2.5");
  assert.equal(trigger.props["aria-label"],'trigger.aria{"model":"mimo-v2.5"}');
  trigger.props.onClick();assert.equal(loads,1,"original picker click still loads its native directory");
  assert.equal(snapshot.retainedEffort,"Low");assert.equal(snapshot.current.reasoningEffort,"low");
});
