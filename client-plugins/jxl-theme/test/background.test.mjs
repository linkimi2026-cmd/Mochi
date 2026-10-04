import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import {
  apply,
  BACKGROUND_FIELD,
  BACKGROUND_TOOL_NAME,
  CAMPUS_BACKGROUNDS,
  DEFAULT_BACKGROUND,
  SETTINGS_NAMESPACE,
  ThemeSettingsSchema,
} from "../index.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(ROOT, "..");
const ASSET_ROOT = join(PLUGIN_ROOT, "assets", "campus");

function harness() {
  const subscriptions = new Map();
  const tools = new Map();
  const effects = [];
  let route;
  let routeDisposed = false;
  let settingsDispose;
  let settingsScope;
  const ctx = {
    webServer: {
      register(definition) {
        route = definition;
        return () => { routeDisposed = true; };
      },
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    on(event, listener) {
      subscriptions.set(event, listener);
    },
    inject(services, listener) {
      assert.deepEqual(services, ["settings"]);
      subscriptions.set("inject:settings", listener);
    },
    effect(effect) {
      effects.push(effect());
    },
    logger: { info() {} },
  };
  apply(ctx);
  const mountSettings = (initial = DEFAULT_BACKGROUND) => {
    let value = { [BACKGROUND_FIELD]: initial };
    let updates = 0;
    settingsScope = {
      get: () => structuredClone(value),
      async update(patch) {
        updates += 1;
        value = { ...value, ...structuredClone(patch) };
      },
    };
    settingsDispose = subscriptions.get("inject:settings")({ inject(services, callback) {
      assert.deepEqual(services, ["tools"]);
      const dispose = callback(ctx);
      return { dispose };
    }, settings: {
      register(namespace, schema) {
        assert.equal(namespace, SETTINGS_NAMESPACE);
        assert.equal(schema, ThemeSettingsSchema);
        return settingsScope;
      },
    } });
    return {
      current: () => structuredClone(value),
      updateCount: () => updates,
    };
  };
  return {
    ctx,
    tools,
    mountSettings,
    route: () => route,
    indexInject: () => subscriptions.get("webserver/index-inject"),
    dispose() {
      settingsDispose?.();
      for (const dispose of effects.reverse()) dispose?.();
    },
    get routeDisposed() { return routeDisposed; },
  };
}

function responseRecorder() {
  return {
    status: undefined,
    headers: undefined,
    ended: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

test("background assets match the checked local manifest", () => {
  const manifest = JSON.parse(readFileSync(join(ASSET_ROOT, "background-manifest.json"), "utf8"));
  assert.equal(manifest.realCampusDepiction, false);
  assert.deepEqual(manifest.backgrounds.map((entry) => entry.id), Object.keys(CAMPUS_BACKGROUNDS));
  for (const entry of manifest.backgrounds) {
    if (!entry.asset) continue;
    const bytes = readFileSync(join(ASSET_ROOT, entry.asset));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash, entry.sha256, `${entry.id} local SHA-256`);
    if (entry.sourceSha256) assert.equal(hash, entry.sourceSha256, `${entry.id} source copy SHA-256`);
  }
});

test("Mochi's natural-language tool only stores an approved background enum", async () => {
  const app = harness();
  const settings = app.mountSettings("watercolor");
  const tool = app.tools.get(BACKGROUND_TOOL_NAME);
  assert.ok(tool);
  assert.deepEqual(tool.parameters.properties.background.enum, Object.keys(CAMPUS_BACKGROUNDS));
  assert.match(tool.description, /米白纸面/);

  const result = await tool.execute({ background: "paper" });
  assert.deepEqual(result, {
    success: true,
    background: "paper",
    label: CAMPUS_BACKGROUNDS["paper"].label,
    message: "已把当前 Mochi 背景切换为「米白纸面」。",
  });
  assert.deepEqual(settings.current(), { campusBackground: "paper" });
  assert.equal(settings.updateCount(), 1);

  await tool.execute({ background: "paper" });
  assert.equal(settings.updateCount(), 1, "repeating the current choice should not write settings again");
  await assert.rejects(tool.execute({ background: "https://example.com/bg.webp" }), /one of/);
  assert.equal(settings.updateCount(), 1);
  app.dispose();
  assert.equal(app.tools.has(BACKGROUND_TOOL_NAME), false, "tool registration follows the settings owner lifecycle");
});

test("teacher and classroom instances keep independent background settings", async () => {
  const teacher = harness();
  const classroom = harness();
  const teacherSettings = teacher.mountSettings("watercolor");
  const classroomSettings = classroom.mountSettings("campus-route");

  await teacher.tools.get(BACKGROUND_TOOL_NAME).execute({ background: "paper" });
  assert.deepEqual(teacherSettings.current(), { campusBackground: "paper" });
  assert.deepEqual(classroomSettings.current(), { campusBackground: "campus-route" });
  assert.equal(classroomSettings.updateCount(), 0);
  teacher.dispose();
  classroom.dispose();
});

test("first paint bootstraps a checked setting and static routes reject traversal", () => {
  const app = harness();
  app.mountSettings("campus-route");
  const injected = [];
  app.indexInject()(injected);
  assert.ok(injected.some((row) => row.text?.includes('dataset.jxlCampusBackground="paper"')));

  const bad = responseRecorder();
  app.route().handler({ method: "HEAD", url: "/jxl-assets/%2e%2e%2fpackage.json" }, bad);
  assert.equal(bad.status, 404);
  assert.equal(bad.ended, true);

  const mark = responseRecorder();
  app.route().handler({ method: "HEAD", url: "/jxl-assets/icons/icon.svg" }, mark);
  assert.equal(mark.status, 200);
  assert.equal(mark.headers["content-type"], "image/svg+xml");

  const notAllowed = responseRecorder();
  app.route().handler({ method: "POST", url: "/jxl-assets/campus/jxl-campus-watercolor-v1.webp" }, notAllowed);
  assert.equal(notAllowed.status, 405);
  app.dispose();
  assert.equal(app.routeDisposed, true);
});

test("built browser plugin reacts to live settings commits without adding a picker", () => {
  execFileSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "build-client.mjs")]);
  const source = readFileSync(join(PLUGIN_ROOT, "client.js"), "utf8");
  let plugin;
  let snapshot = { value: { campusBackground: "watercolor" } };
  const listeners = new Set();
  const styleValues = new Map();
  const html = {
    dataset: {},
    style: { setProperty(name, value) { styleValues.set(name, value); } },
  };
  const document = {
    title: "",
    documentElement: html,
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ rel: "", href: "", textContent: "" }),
    querySelector: () => ({ href: "" }),
  };
  class Observer {
    observe() {}
    disconnect() {}
  }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ factory }) { plugin = factory(() => ({})); },
      },
      addEventListener() {},
    },
    document,
    MutationObserver: Observer,
    console,
  };
  vm.runInNewContext(source, sandbox);
  assert.equal(JSON.stringify(plugin.inject), JSON.stringify(["remote"]));

  const effectCleanups = [];
  let boundNamespace;
  const ctx = {
    inject(services, callback) {
      if (services[0] === "settingsScope") callback(this);
    },
    settingsScope: {
      bind({ namespace }) {
        boundNamespace = namespace;
        return {
          getSnapshot: () => snapshot,
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        };
      },
    },
    effect(effect) { effectCleanups.push(effect()); },
  };
  plugin.apply(ctx);
  assert.equal(boundNamespace, "jxl-theme");
  assert.equal(html.dataset.jxlCampusBackground, "paper");
  assert.equal(styleValues.get("--jxl-campus-background-image"), 'none');
  assert.equal(source.includes("createElement('select')"), false);
  assert.equal(source.includes("createElement('input')"), false);

  snapshot = { value: { campusBackground: "campus-route" } };
  for (const listener of listeners) listener();
  assert.equal(html.dataset.jxlCampusBackground, "paper");
  assert.equal(styleValues.get("--jxl-campus-background-image"), 'none');
  for (const cleanup of effectCleanups.reverse()) cleanup?.();
  assert.equal(listeners.size, 0);
});
