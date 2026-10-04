import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
// The production controller bundle is evaluated unchanged. Only host services,
// React rendering and its observable transport are fixture implementations.
const store = { createSnapshotStore(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    set(value) { snapshot = value; for (const listener of listeners) listener(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
} };

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const officialSource = readFileSync(new URL("../../../apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const ids = ["standard", "lesson-planning", "materials-assessment", "grade-analysis", "classroom-coordination"];
const roster = [...ids, "minimal", "ptc", "cordis"].map(id => ({ id, name: id, description: `description ${id}`, isDefault: id === "standard" }));

function reactStub() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useEffect() {}, useLayoutEffect() {},
    useState: value => [value, () => {}], useRef: current => ({ current }), useId: () => "scene",
  };
}

function load() {
  const factories = new Map();
  const react = reactStub();
  const context = vm.createContext({ Promise, Error, console, setTimeout, clearTimeout, window: { __ModuleLoader__: { load: entry => factories.set(entry.id, entry.factory) } } });
  vm.runInContext(officialSource, context);
  vm.runInContext(source, context);
  const official = factories.get("@deepseek-ai/dsh-client-ui-agent-preset")((name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" };
    if (name === "@deepseek-ai/dsh-client-store") return store;
    if (name === "@deepseek-ai/dsh-client-ui-primitives") return new Proxy({}, { get: (_, key) => key });
    throw new Error(`Unexpected official dependency ${name}`);
  });
  const api = factories.get("mochi-modes-client")((name) => {
    if (name === "react") return react;
    if (name === "@deepseek-ai/dsh-client-ui-agent-preset") return official;
    throw new Error(`Unexpected dependency ${name}`);
  });
  return { api, official };
}

function harness(rows = roster) {
  const registrations = [];
  const effects = [];
  const listeners = new Map();
  const bindings = new Map();
  const selections = [];
  const settingsWrites = [];
  const namespaces = [];
  let presets = rows.map(row => ({ ...row }));
  let reject = false;
  const sessionList = store.createSnapshotStore({ byId: {} });
  function listen(name, callback) {
    const callbacks = listeners.get(name) || new Set();
    listeners.set(name, callbacks);
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  }
  const ctx = {
    effect(callback) {
      const result = callback();
      const items = typeof result === "function" ? [result] : result ? [...result] : [];
      let active = true;
      const dispose = async () => { if (!active) return; active = false; for (const item of items.reverse()) await item(); };
      effects.push(dispose);
      return dispose;
    },
    inject(_services, callback) { callback(ctx); return { dispose: async () => {} }; },
    on: listen,
    remote: {
      $on: listen,
      agentPresets: {
        list: async () => ({ ok: true, value: { presets } }),
        read: async id => ({ ok: true, value: { name: id, content: "[]" } }),
        select: async (sessionId, id) => {
          selections.push([sessionId, id]);
          if (reject) return { ok: false, error: { message: "session locked", details: { reason: "场景已锁定" } } };
          const byId = sessionList.getSnapshot().byId;
          sessionList.set({ byId: { ...byId, [sessionId]: { ...byId[sessionId], projectionValues: { agentPreset: id } } } });
          return { ok: true, value: id };
        },
      },
      settings: {
        describe: async () => ({ ok: true, value: { writable: true, namespaces: [{ ns: "agent-preset-registry", value: { selectedDefault: presets.find(row => row.isDefault)?.id }, revision: 7 }] } }),
        update: async (namespace, patch, revision) => {
        settingsWrites.push([namespace, patch, revision]);
        presets = presets.map(row => ({ ...row, isDefault: row.id === patch.selectedDefault }));
        return { ok: true };
      } },
    },
    locale: { register(ns) { namespaces.push(ns); return () => {}; }, bind: () => key => key },
    configForms: { developerTools: { enabled: { getSnapshot: () => false, subscribe: () => () => {} } } },
    sessions: {
      list: sessionList,
      binding: id => bindings.get(id),
      retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
    },
    slots: {
      register(options, component) {
        const entry = { options, component };
        registrations.push(entry);
        return () => { const index = registrations.indexOf(entry); if (index !== -1) registrations.splice(index, 1); };
      },
      inject(_name, callback) { return ctx.effect(callback); },
    },
    uiWorkspace: { startSession() {} },
  };
  function session(id, preset = "standard", blank = true, retained = true) {
    const summary = { id, blank, retainedBy: { mainView: retained ? 1 : 0 }, projectionValues: { agentPreset: preset } };
    if (!bindings.has(id)) bindings.set(id, { sessionId: id, ctx });
    sessionList.set({ byId: { ...sessionList.getSnapshot().byId, [id]: summary } });
    return summary;
  }
  return { ctx, session, registrations, selections, settingsWrites, namespaces, emit: name => { for (const callback of [...(listeners.get(name) || [])]) callback(); }, reject: () => { reject = true; }, dispose: async () => { for (const stop of effects.reverse()) await stop(); } };
}

function seatProps(h, sessionId) {
  const entry = h.registrations.find(row => row.options.name === "conversation.hero.agentPreset");
  return { entry, props: entry.options.inject(sessionId) };
}

function renderSeat(entry, props, sessionId) {
  return entry.component({
    sessionId, ...props, t: key => key,
    useDeveloperTools: select => select(props.hooks.developerTools.getSnapshot()),
    useAgentPresetSeat: select => select(props.hooks.agentPresetSeat.getSnapshot()),
    useSessionRetainInfo: select => select({ retainedBy: { mainView: 1 } }),
  });
}

test("actual official bundle: teacher slots filter five scenes, enable picker without developer tools", async () => {
  const { api } = load();
  const h = harness();
  api.__test.installScenePicker(h.ctx);
  await tick();
  assert.deepEqual(h.registrations.map(row => [row.options.name, row.options.priority]), [
    ["conversation.hero.agentPreset", -20], ["conversation.session.header.actions", -20], ["settings.section", -20],
  ]);
  const { entry, props } = seatProps(h);
  await props.load();
  assert.deepEqual(Array.from(props.hooks.agentPresetSeat.getSnapshot().options, row => row.id), ids);
  assert.equal(h.ctx.configForms.developerTools.enabled.getSnapshot(), false);
  assert.ok(renderSeat(entry, props), "official seat visible with private enabled store");
  assert.deepEqual(h.namespaces, ["mochi.scenes"]);
  assert.equal((await h.ctx.remote.agentPresets.list()).value.presets.length, 8, "original roster untouched");
  await h.dispose();
  assert.equal(h.registrations.length, 0);
});

test("actual official bundle: unbound choice lands on the next retained blank session exactly once", async () => {
  const { api } = load();
  const h = harness();
  api.__test.installScenePicker(h.ctx);
  await tick();
  const { props } = seatProps(h);
  await props.load();
  await props.select("lesson-planning");
  assert.equal(h.selections.length, 0, "unbound choice only stages");
  h.session("new");
  const bound = seatProps(h, "new").props;
  await bound.load();
  await tick();
  assert.deepEqual(h.selections, [["new", "lesson-planning"]]);
  assert.equal(h.ctx.sessions.list.getSnapshot().byId.new.projectionValues.agentPreset, "lesson-planning");
  await bound.load();
  assert.equal(h.selections.length, 1);
  await h.dispose();
});

test("actual official bundle: blank selection persists; refusal restores actual identity; running history stays locked", async () => {
  const { api } = load();
  const h = harness();
  h.session("blank");
  api.__test.installScenePicker(h.ctx);
  await tick();
  const blank = seatProps(h, "blank").props;
  await blank.load();
  await blank.select("grade-analysis");
  assert.equal(h.ctx.sessions.list.getSnapshot().byId.blank.projectionValues.agentPreset, "grade-analysis");
  h.reject();
  assert.equal(await blank.select("materials-assessment"), "场景已锁定");
  assert.equal(blank.hooks.agentPresetSeat.getSnapshot().current, "grade-analysis");
  h.session("old", "ptc", false);
  const history = seatProps(h, "old").props;
  await history.load();
  await history.select("standard");
  assert.equal(h.selections.length, 2, "started sessions are never selected remotely");
  const header = h.registrations.find(row => row.options.name === "conversation.session.header.actions");
  const label = header.component({ sessionId: "old", useSessions: select => select(h.ctx.sessions.list.getSnapshot()) });
  assert.equal(label.children[0], "历史场景 · ptc");
  await history.load();
  assert.equal(history.hooks.agentPresetSeat.getSnapshot().current, "ptc");
  await h.dispose();
});

test("actual official bundle: settings use official default namespace and sync the retained blank session", async () => {
  const { api } = load();
  const h = harness();
  h.session("blank");
  api.__test.installScenePicker(h.ctx);
  await tick();
  const entry = h.registrations.find(row => row.options.name === "settings.section");
  const props = entry.options.inject();
  await props.load();
  assert.deepEqual(Array.from(props.hooks.agentPresetSection.getSnapshot().rows, row => row.id), ids);
  await props.makeDefault("classroom-coordination");
  assert.equal(h.settingsWrites[0][0], "agent-preset-registry");
  assert.equal(h.settingsWrites[0][1].selectedDefault, "classroom-coordination");
  assert.equal(h.ctx.sessions.list.getSnapshot().byId.blank.projectionValues.agentPreset, "classroom-coordination");
  await h.dispose();
});

test("classroom roster is never shadowed; delayed discovery cannot register after disposal", async () => {
  const { api } = load();
  const h = harness([{ id: "classroom", name: "教室" }]);
  api.__test.installScenePicker(h.ctx);
  await tick();
  assert.equal(h.registrations.length, 0);
  await h.dispose();
  const delayed = harness();
  let resolve;
  delayed.ctx.remote.agentPresets.list = () => new Promise(done => { resolve = done; });
  api.__test.installScenePicker(delayed.ctx);
  await tick();
  await delayed.dispose();
  resolve({ ok: true, value: { presets: roster } });
  await tick();
  assert.equal(delayed.registrations.length, 0);
});


test("connection reset retries discovery after unavailable roster and never mounts duplicate official slots", async () => {
  const { api } = load();
  const h = harness();
  const originalList = h.ctx.remote.agentPresets.list;
  let ready = false;
  h.ctx.remote.agentPresets.list = () => ready ? originalList() : Promise.resolve({ ok: false, error: { code: "gateway/invocation-unavailable", message: "not ready" } });
  api.__test.installScenePicker(h.ctx);
  await tick();
  assert.equal(h.registrations.length, 0);
  ready = true;
  h.emit("connection/reset");
  await tick();
  assert.equal(h.registrations.length, 3);
  h.emit("connection/reset");
  await tick();
  assert.equal(h.registrations.length, 3);
  await h.dispose();
  h.emit("connection/reset");
  await tick();
  assert.equal(h.registrations.length, 0);
});


test("legacy saved default migrates with revision CAS before filtered slots mount, preserving historical sessions", async () => {
  const { api } = load();
  for (const legacy of ["minimal", "ptc", "cordis"]) {
    const h = harness(roster.map(row => ({ ...row, isDefault: row.id === legacy })));
    h.session("history", legacy, false);
    api.__test.installScenePicker(h.ctx);
    await tick();
    assert.equal(h.registrations.length, 3);
    assert.equal(h.settingsWrites.length, 1);
    assert.equal(h.settingsWrites[0][1].selectedDefault, "standard");
    assert.equal(h.settingsWrites[0][2], 7);
    assert.equal(h.ctx.sessions.list.getSnapshot().byId.history.projectionValues.agentPreset, legacy);
    assert.equal(h.selections.length, 0);
    const { props } = seatProps(h);
    await props.load();
    assert.equal(props.hooks.agentPresetSeat.getSnapshot().current, "standard");
    await h.dispose();
  }
});

test("migration refusal exposes an error instead of pretending General succeeded; retry can recover", async () => {
  const { api } = load();
  const h = harness(roster.map(row => ({ ...row, isDefault: row.id === "ptc" })));
  const update = h.ctx.remote.settings.update;
  h.ctx.remote.settings.update = async () => ({ ok: false, error: { message: "settings revision conflict" } });
  api.__test.installScenePicker(h.ctx);
  await tick();
  const failed = h.registrations.find(row => row.options.name === "conversation.hero.agentPreset");
  const notice = failed.component({});
  assert.equal(notice.props.role, "alert");
  assert.match(notice.children[0].children[0], /settings revision conflict/);
  assert.equal((await h.ctx.remote.agentPresets.list()).value.presets.find(row => row.isDefault).id, "ptc");
  h.ctx.remote.settings.update = update;
  notice.children[1].props.onClick();
  await tick();
  assert.equal(h.registrations.length, 3);
  const { props } = seatProps(h);
  await props.load();
  assert.equal(props.hooks.agentPresetSeat.getSnapshot().current, "standard");
  await h.dispose();
});

test("existing supported defaults are never rewritten during discovery", async () => {
  const { api } = load();
  for (const id of ids) {
    const h = harness(roster.map(row => ({ ...row, isDefault: row.id === id })));
    api.__test.installScenePicker(h.ctx);
    await tick();
    assert.equal(h.settingsWrites.length, 0);
    const { props } = seatProps(h);
    await props.load();
    assert.equal(props.hooks.agentPresetSeat.getSnapshot().current, id);
    await h.dispose();
  }
});
