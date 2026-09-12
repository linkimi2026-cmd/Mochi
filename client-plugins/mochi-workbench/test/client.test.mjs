import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

class FakeFile {
  constructor(parts, name, options = {}) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
    this.lastModified = options.lastModified;
  }
}

function loadClient(overrides = {}) {
  const factories = new Map();
  const sandbox = {
    Array,
    AbortController,
    Error,
    File: FakeFile,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    Uint8Array,
    console,
    window: {
      __ModuleLoader__: {
        load(entry) {
          factories.set(entry.id, entry.factory);
        },
      },
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "mochi-workbench/client.js" });
  const factory = factories.get("mochi-workbench");
  assert.ok(factory, "browser plugin registered with ModuleLoader");
  return factory((name) => {
    if (name === "react") return overrides.react || {};
    if (name === "jxl-brand") return overrides.mochiBrand || {};
    throw new Error(`unexpected module request: ${name}`);
  });
}

// 只实现组件树真正用到的那几个 Hook：本插件的组件在测试里被直接调用
// （不做 reconciliation），所以返回快照即可，不需要重渲染调度。
function fakeReact() {
  return {
    Fragment: Symbol("MochiFragment"),
    createElement(type, props, ...children) {
      return { type, props: props || {}, children };
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
    useEffect() {},
    useState(initial) {
      return [typeof initial === "function" ? initial() : initial, () => {}];
    },
    useRef(value) {
      return { current: value };
    },
  };
}

// 走一遍 apply()，拿到会话头动作条目注册的组件。
function applyForHeaderAction(api, ctx = {}) {
  const registrations = [];
  const disposers = [];
  const scoped = {
    ...ctx,
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    sessions: {
      list: { getSnapshot: () => ({ current: null }), subscribe: () => () => {} },
      scope() { throw new Error("not needed by apply"); },
    },
    slots: {
      inject(name, iteratorFactory) {
        for (const entry of iteratorFactory()) registrations.push({ name, entry });
      },
      register(options, component) { return { options, component }; },
    },
  };
  api.apply(scoped);
  assert.deepEqual(registrations.map((entry) => entry.name), ["conversation.session.header.actions"]);
  return { registration: registrations[0].entry, dispose: () => disposers.reverse().forEach((dispose) => dispose()) };
}

function imageArtifact(api) {
  const file = { name: "lesson-page.png", type: "image/png", size: 1024 };
  return api.__test.buildLocalImageArtifact(file, "a".repeat(64), 1200, 600, "blob:original");
}

function readySelection(api) {
  const artifact = imageArtifact(api);
  const target = {
    dataset: {
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
      artifactPage: "1",
    },
    getBoundingClientRect() {
      return { left: 100, top: 50, width: 400, height: 200 };
    },
  };
  const selection = api.__test.selectionFromPreview(target, { x: 140, y: 70 }, { x: 300, y: 150 }, artifact);
  const sourceRect = api.__test.selectionPixelRect(selection);
  return Object.freeze({
    ...selection,
    crop: Object.freeze({
      phase: "ready",
      mimeType: "image/png",
      bytes: 2048,
      sha256: "b".repeat(64),
      width: sourceRect.width,
      height: sourceRect.height,
      sourceRect,
      blob: { local: true },
      objectUrl: "blob:crop",
    }),
  });
}

test("local image selection binds normalized and source-pixel geometry to a SHA-256 artifact", () => {
  const api = loadClient();
  const artifact = imageArtifact(api);
  assert.equal(api.__test.isSupportedImageFile({ type: "image/png", size: 1024 }), true);
  assert.equal(api.__test.isSupportedImageFile({ type: "image/gif", size: 1024 }), false);
  assert.match(api.__test.imageFileError({ type: "image/gif", size: 1024 }), /仅支持/);
  assert.match(api.__test.imageFileError({ type: "image/png", size: api.__test.MAX_IMAGE_BYTES + 1 }), /15 MB/);

  const selection = readySelection(api);
  assert.equal(JSON.stringify(selection.bounds), JSON.stringify({ left: 0.1, top: 0.1, width: 0.4, height: 0.4 }));
  assert.equal(JSON.stringify(selection.crop.sourceRect), JSON.stringify({ left: 120, top: 60, width: 480, height: 240 }));
  assert.equal(selection.artifactId, `local-image-sha256-${"a".repeat(64)}`);
  assert.equal(selection.version, `sha256-${"a".repeat(64)}`);

  const output = api.__test.cropOutputSize({ width: 6000, height: 6000 });
  assert.ok(output.width * output.height <= api.__test.MAX_CROP_PIXELS);

  const mismatched = api.__test.selectionFromPreview({
    dataset: { artifactId: "other", artifactVersion: artifact.version, artifactPage: "1" },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
  }, { x: 1, y: 1 }, { x: 80, y: 80 }, artifact);
  assert.equal(mismatched, null, "a selection cannot claim an unrelated image version");
});

test("selection context preserves draft, records local crop provenance, and never implies OCR", () => {
  const api = loadClient();
  const selection = readySelection(api);
  assert.equal(api.__test.canAttachSelection(selection), true);
  const context = api.__test.selectionContextText(selection, "拟定讲解提纲", true);
  assert.match(context, /原文件 SHA-256：a{64}/);
  assert.match(context, /原图裁剪像素：x=120/);
  assert.match(context, /原生草稿附件/);
  assert.match(context, /未进行文字读取或 OCR/);
  const draft = api.__test.appendSelectionToDraft("已有草稿  ", selection, "拟定讲解提纲", true);
  assert.match(draft, /^已有草稿  \n\n【教师工作台框选上下文】/);
  assert.match(draft, /教师指令：拟定讲解提纲/);
});

test("Office editor requires both engine and callback bridge, and the URL contract stays pinned", () => {
  const api = loadClient();
  const offlineBridge = { ok: true, engine: { origin: "http://127.0.0.1:18080", online: true, callbackReachable: false }, demoIds: ["teacher-document-demo"] };
  assert.equal(api.__test.isOfficeHealth(offlineBridge), true);
  assert.equal(api.__test.canOpenOfficeEditor(offlineBridge), false);
  const ready = { ...offlineBridge, engine: { ...offlineBridge.engine, callbackReachable: true } };
  assert.equal(api.__test.canOpenOfficeEditor(ready), true);
  const config = {
    engineOrigin: "http://127.0.0.1:18080",
    scriptUrl: "http://127.0.0.1:18080/web-apps/apps/api/documents/api.js",
    config: {
      token: "opaque",
      documentType: "text",
      document: { url: "http://host.lima.internal:18100/content", key: "sha256-key", fileType: "docx", title: "lesson.docx" },
      editorConfig: { callbackUrl: "http://host.lima.internal:18100/callback" },
    },
  };
  assert.equal(api.__test.isOfficeEditorConfig(config), true);
  assert.equal(api.__test.isOfficeEditorConfig({ ...config, scriptUrl: "https://elsewhere.example/web-apps/apps/api/documents/api.js" }), false);
  assert.equal(api.__test.isSafeWebUrl("https://school.example/lesson"), "https://school.example/lesson");
  assert.equal(api.__test.isSafeWebUrl("http://127.0.0.1:8787/api/health"), "http://127.0.0.1:8787/api/health");
  assert.equal(api.__test.isSafeWebUrl("file:///private/lesson.html"), null);
  assert.equal(api.__test.isSafeWebUrl("javascript:alert(1)"), null);
  assert.equal(api.__test.isSafeWebUrl("http://public.example/"), null);
});

test("official composer attachment path adds the crop to the original session without submitting", () => {
  const api = loadClient();
  const selection = readySelection(api);
  let current = "session-a";
  let draft = "已有草稿";
  const created = [];
  const released = [];
  const added = [];
  const removed = [];
  const input = {
    state: { getSnapshot: () => ({ draft }) },
    setDraft(next) { draft = next; },
    addImages(ids) { added.push(...ids); return true; },
    removeImage(id) { removed.push(id); },
  };
  const sessionContext = {
    conversation: {
      input: { for(scope) { assert.equal(scope, sessionContext); return input; } },
      createDraftImages(files) {
        created.push(...files);
        return [{ id: "draft-image-1" }];
      },
      releaseDraftImages(attachments) { released.push(...attachments); },
    },
  };
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ current }), subscribe: () => () => {} },
      scope(id) { assert.equal(id, "session-a"); return sessionContext; },
    },
  };
  api.__test.ensureWorkbenchSession("session-a");
  api.__test.setWorkbenchState({ selection });
  const result = api.__test.createComposerDraftBridge(ctx)(selection, "请概括");
  assert.equal(result.ok, true);
  assert.equal(created.length, 1);
  assert.ok(created[0] instanceof FakeFile);
  assert.deepEqual(added, ["draft-image-1"]);
  assert.deepEqual(released, []);
  assert.deepEqual(removed, []);
  assert.match(draft, /^已有草稿\n\n【教师工作台框选上下文】/);
  assert.match(draft, /原生草稿附件/);
  assert.equal(Array.from(api.__test.getWorkbenchSnapshot().selection.delivery.attachmentIds).join(","), "draft-image-1");

  const retry = api.__test.createComposerDraftBridge(ctx)(api.__test.getWorkbenchSnapshot().selection, "再次点击");
  assert.equal(retry.ok, false);
  assert.equal(created.length, 1, "a second click cannot duplicate the attachment");

  current = "session-b";
  const switched = api.__test.createComposerDraftBridge(ctx)(api.__test.getWorkbenchSnapshot().selection, "不应写入");
  assert.equal(switched.ok, false);
  assert.equal(created.length, 1, "session mismatch occurs before image registration");
});

test("official slots remain additive: only the session header action is claimed, no second view", () => {
  const api = loadClient();
  const registrations = [];
  const tabDescriptors = [];
  const disposers = [];
  const injectCalls = [];
  const bindingCalls = [];
  const chatActivity = {
    getSnapshot() { return { legacy: { runningCalls: [] } }; },
    subscribe() { return () => {}; },
  };
  const ctx = {
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    inject(dependencies, callback) {
      const names = Array.from(dependencies);
      injectCalls.push(names);
      assert.equal(names.every((name) => ctx[name] !== undefined), true);
      const dispose = callback(ctx);
      if (typeof dispose === "function") disposers.push(dispose);
      return {};
    },
    sessions: {
      list: { getSnapshot: () => ({ current: null }), subscribe: () => () => {} },
      scope() { throw new Error("not needed by apply"); },
    },
    uiConversation: {
      binding(sessionId) {
        bindingCalls.push(sessionId);
        return {
          target(view) {
            assert.equal(view, "chat");
            return chatActivity;
          },
        };
      },
    },
    slots: {
      inject(name, iteratorFactory) {
        for (const entry of iteratorFactory()) registrations.push({ name, entry });
      },
      register(options, component) { return { options, component }; },
    },
    betterSidebar: {
      registerTab(descriptor) {
        tabDescriptors.push(descriptor);
        return () => {};
      },
    },
  };
  api.apply(ctx);
  // 教师端只有一个官方会话视图（chat）。本插件不再注册 conversation.view：
  // 官方槽按 `only: active.id` 一次只渲染一个 view，注册第二个视图正是
  // 「点工作后只看到面板、看不到对话」的根因。
  assert.deepEqual(registrations.map((entry) => entry.name), ["conversation.session.header.actions"]);
  assert.equal(registrations.some((entry) => entry.name === "conversation.view"), false, "no second conversation view is registered");
  assert.equal(registrations.some((entry) => entry.name === "details"), false);
  assert.equal(tabDescriptors.length, 0, "the workbench no longer registers a sidebar tab");
  const headerAction = registrations[0].entry;
  assert.equal(headerAction.options.id, "mochi-workbench-toggle");
  assert.equal(headerAction.options.order, 30);
  const injected = headerAction.options.inject("session-a");
  assert.equal(injected.hooks.chatActivity, chatActivity);
  assert.deepEqual(bindingCalls, ["session-a"]);
  assert.ok(api.inject.includes("conversation"));
  assert.ok(api.inject.includes("uiConversation"));
  assert.equal(api.inject.includes("betterSidebar"), false);
  assert.deepEqual(injectCalls, [], "no cross-plugin injections remain (better-sidebar entry removed)");
  disposers.reverse().forEach((dispose) => dispose());
});

test("workbench renders without better-sidebar and ignores a late-arriving provider", () => {
  const api = loadClient();
  const registrations = [];
  const disposers = [];
  const ctx = {
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    sessions: {
      list: { getSnapshot: () => ({ current: null }), subscribe: () => () => {} },
      scope() { throw new Error("not needed by apply"); },
    },
    uiConversation: {
      binding() { throw new Error("not needed before the header action is used"); },
    },
    slots: {
      inject(name, iteratorFactory) {
        for (const entry of iteratorFactory()) registrations.push({ name, entry });
      },
      register(options, component) { return { options, component }; },
    },
  };

  api.apply(ctx);
  assert.deepEqual(registrations.map((entry) => entry.name), ["conversation.session.header.actions"]);
  assert.equal(ctx.betterSidebar, undefined, "apply never requests the sidebar");
  disposers.reverse().forEach((dispose) => dispose());
});

test("attachment registration releases the crop when the original session changes or input is busy", () => {
  for (const mode of ["switch", "busy"]) {
    const api = loadClient();
    const selection = readySelection(api);
    let current = "session-a";
    let draft = "保留草稿";
    const released = [];
    const input = {
      state: { getSnapshot: () => ({ draft }) },
      setDraft(next) { draft = next; },
      addImages() { return mode === "busy" ? false : true; },
      removeImage() {},
    };
    const sessionContext = {
      conversation: {
        input: { for() { return input; } },
        createDraftImages() {
          if (mode === "switch") current = "session-b";
          return [{ id: `draft-${mode}` }];
        },
        releaseDraftImages(attachments) { released.push(...attachments); },
      },
    };
    const ctx = {
      sessions: {
        list: { getSnapshot: () => ({ current }), subscribe: () => () => {} },
        scope() { return sessionContext; },
      },
    };
    api.__test.ensureWorkbenchSession("session-a");
    api.__test.setWorkbenchState({ selection });
    const outcome = api.__test.createComposerDraftBridge(ctx)(selection, "不应投递");
    assert.equal(outcome.ok, false, mode);
    assert.equal(released.length, 1, `${mode} releases the registered attachment`);
    assert.equal(draft, "保留草稿", `${mode} preserves the original draft`);
  }
});

test("An open turn opens Work mode once; manual Chat holds through turn end; idle manual Work is consumed by the next turn", () => {
  const api = loadClient();
  assert.equal(api.__test.chatActivityIsRunning({ legacy: { runningCalls: [] } }), false);
  assert.equal(api.__test.chatActivityIsRunning({ legacy: { runningCalls: [{ id: "tool-1" }] } }), true);
  assert.equal(api.__test.chatActivityIsRunning({ legacy: { responseText: "token" } }), false);
  assert.equal(api.__test.chatActivityIsRunning({ runningCalls: [{ id: "not-the-chat-target" }] }), false);
  assert.equal(api.__test.openChatTurnKey({ timeline: { turns: new Map([[7, { turn: 7, status: "open" }]]) } }), "turn:7");
  assert.equal(api.__test.openChatTurnKey({ timeline: { turns: new Map([[7, { turn: 7, status: "closed" }]]) } }), null);

  const idleTurn = { turnKey: "turn:7", manual: false, workAuto: false };
  assert.equal(api.__test.shouldAutoSwitchToWork(idleTurn, "turn:7"), true);
  assert.equal(api.__test.shouldAutoSwitchToWork(null, "turn:7"), false);

  const sentinelSelection = Object.freeze({ artifactId: "same-session-artifact" });
  api.__test.ensureWorkbenchSession("session-a");
  api.__test.setWorkbenchState({ selection: sentinelSelection });
  const before = api.__test.getWorkbenchSnapshot();
  api.__test.clearChatWorkRunState("session-a");
  // turn 打开 = agent 运行：自动进工作模式（展开工作台面板，会话视图仍是 chat）。
  assert.equal(api.__test.advanceChatWorkRunState("session-a", "turn:7"), "work");
  assert.equal(api.__test.advanceChatWorkRunState("session-a", "turn:7"), false, "later updates in the same turn do not reopen Work");
  assert.equal(api.__test.getWorkbenchSnapshot().visible, false, "the turn decision is state only — the capsule applies it");
  api.__test.setWorkbenchVisible(true);
  assert.equal(api.__test.getWorkbenchSnapshot().visible, true);
  // 教师手动回对话模式：模式切换走官方 selectView 缝（见下一个用例）。
  assert.equal(api.__test.selectChatWorkMode("session-a", "turn:7", "chat"), true);
  assert.equal(api.__test.getWorkbenchSnapshot().visible, false);
  assert.equal(api.__test.advanceChatWorkRunState("session-a", null), false, "manual turn/end does not auto-return");
  assert.equal(api.__test.advanceChatWorkRunState("session-a", "turn:8"), "work", "a new turn returns to automatic Work");
  assert.equal(api.__test.advanceChatWorkRunState("session-a", null), "chat", "turn end hands the surface back to Chat after an automatic Work turn");
  assert.equal(api.__test.advanceChatWorkRunState("session-a", null), false, "the auto-return happens once per turn");
  // 空闲时手动进工作：下一个回合教师已接管，回合结束不回拉。
  api.__test.clearChatWorkRunState("session-a");
  assert.equal(api.__test.selectChatWorkMode("session-a", null, "work"), true, "idle manual Work opens the panel");
  assert.equal(api.__test.advanceChatWorkRunState("session-a", "turn:9"), false, "manual idle Work suppresses the auto switch");
  assert.equal(api.__test.advanceChatWorkRunState("session-a", null), false, "turn end does not yank the teacher back");
  const after = api.__test.getWorkbenchSnapshot();
  assert.equal(after.sessionId, before.sessionId);
  assert.equal(after.selection, sentinelSelection, "mode switching leaves the same-session artifact untouched");
});

test("mode switching uses the official selectView seam and keeps the conversation on the chat view", () => {
  const api = loadClient();
  // 模式状态只有四个字段，初始即对话模式（面板收起）。
  assert.deepEqual(Object.keys(api.__test.getWorkbenchSnapshot()).sort(), ["message", "selection", "sessionId", "visible"]);
  assert.equal(api.__test.getWorkbenchSnapshot().visible, false);
  const views = [];
  const props = {
    sessionId: "session-a",
    selectedView: "chat",
    selectView(view) { views.push(view); },
  };
  api.__test.ensureWorkbenchSession("session-a");
  api.__test.clearChatWorkRunState("session-a");

  // 工作模式：官方 selected view 仍是 chat（对话必须可见、可输入），面板展开。
  assert.equal(api.__test.DEFAULT_CONVERSATION_VIEW, "chat");
  assert.equal(api.__test.chooseWorkbenchMode(props, "session-a", null, "work"), true);
  assert.deepEqual(views, ["chat"], "the official selectView seam keeps the chat view active");
  assert.equal(api.__test.getWorkbenchSnapshot().visible, true);

  // 对话模式：同一个官方视图，面板收起。
  assert.equal(api.__test.chooseWorkbenchMode(props, "session-a", null, "chat"), true);
  assert.deepEqual(views, ["chat", "chat"]);
  assert.equal(api.__test.getWorkbenchSnapshot().visible, false);

  // 非法模式不产生任何视图调用，也不改面板状态。
  assert.equal(api.__test.chooseWorkbenchMode(props, "session-a", null, "elsewhere"), false);
  assert.deepEqual(views, ["chat", "chat"]);
  assert.equal(api.__test.getWorkbenchSnapshot().visible, false);

  // 官方缝缺席时不再有 DOM relay 兜底：面板照常开合，但没有幻影视图切换。
  assert.equal(api.__test.chooseWorkbenchMode({ sessionId: "session-a" }, "session-a", null, "work"), true);
  assert.deepEqual(views, ["chat", "chat"], "a missing seam cannot fake a view switch");
  assert.equal(api.__test.getWorkbenchSnapshot().visible, true);
  assert.equal(api.__test.relaySelectView, undefined, "the DOM relay is deleted, not kept as a second mechanism");
  assert.equal(api.__test.nativeViewTablist, undefined);
  assert.equal(api.__test.nativeViewButton, undefined);
  assert.equal(api.__test.currentNativeViewMode, undefined);
  assert.equal(api.__test.selectChatWorkView, undefined);
  // 源码层反向证据：不再查询或点击宿主 tablist。
  assert.equal(source.includes('querySelectorAll("header'), false);
  assert.equal(source.includes("button[role='tab']"), false);
});

test("a session switch returns the teacher to chat mode and clears the previous selection", () => {
  const api = loadClient();
  api.__test.ensureWorkbenchSession("session-a");
  api.__test.setWorkbenchState({ selection: readySelection(api) });
  api.__test.setWorkbenchVisible(true);
  api.__test.ensureWorkbenchSession("session-a");
  assert.equal(api.__test.getWorkbenchSnapshot().visible, true, "the same session keeps mode and artifact");
  api.__test.ensureWorkbenchSession("session-b");
  const next = api.__test.getWorkbenchSnapshot();
  assert.equal(next.sessionId, "session-b");
  assert.equal(next.visible, false, "a different session opens in chat mode");
  assert.equal(next.selection, null, "the previous session's selection is released");
  assert.equal(api.__test.workbenchContextIsCurrent("session-a"), false);
  assert.equal(api.__test.workbenchContextIsCurrent("session-b"), true);
});

test("the workbench panel toggle renders on the chat view and drives the official selectView seam", () => {
  const react = fakeReact();
  const api = loadClient({ react });
  const views = [];
  const { registration, dispose } = applyForHeaderAction(api);
  const HeaderAction = registration.component;
  const props = {
    sessionId: "session-a",
    selectedView: "chat",
    selectView(view) { views.push(view); },
  };

  // 面板收起：只有开关，没有面板 —— 教师看到的就是对话本身。
  api.__test.ensureWorkbenchSession("session-a");
  const chatMode = HeaderAction(props);
  assert.equal(chatMode.type, "div");
  assert.equal(chatMode.props.className, "mochi-workbench__header-actions");
  assert.equal(chatMode.children[1], null, "collapsed panel renders no workbench panel");

  const Toggle = chatMode.children[0].type;
  const capsule = Toggle(props);
  assert.equal(capsule.children.length, 2);
  // 标签必须是「工作台面板」语义：模式（对话 / 工作）已交给 mochi-modes 插件。
  assert.deepEqual(capsule.children.map((child) => child.children[0]), ["收起面板", "展开面板"]);
  assert.equal(capsule.props["aria-label"], "教师工作台面板");
  assert.equal(capsule.children[0].props["aria-pressed"], true, "collapsed is the pressed option while the panel is closed");
  assert.equal(capsule.children[1].props["aria-pressed"], false);

  // 点「展开面板」：走官方 selectView 缝把会话留在 chat，面板作为覆盖层出现。
  capsule.children[1].props.onClick();
  assert.deepEqual(views, ["chat"], "the toggle switches through the official selectView seam");
  const expanded = HeaderAction(props);
  assert.equal(expanded.children[0].type, Toggle, "the toggle stays mounted while the panel is open");
  const panel = expanded.children[1];
  assert.equal(typeof panel.type, "function", "an expanded panel mounts the workbench panel");
  const renderedPanel = panel.type(panel.props);
  assert.equal(renderedPanel.type, "aside");
  assert.equal(renderedPanel.props.className, "mochi-workbench-panel");
  assert.equal(renderedPanel.props["aria-label"], "教师工作台");
  assert.equal(Toggle(props).children[1].props["aria-pressed"], true, "expanded is the pressed option while the panel is open");

  // 点「收起面板」：面板收起，会话视图依旧钉在官方 chat。
  Toggle(props).children[0].props.onClick();
  assert.deepEqual(views, ["chat", "chat"], "both directions stay on the single chat view");
  assert.equal(HeaderAction(props).children[1], null, "collapsing removes the panel again");
  dispose();
});

test("the workbench only shows in the work interface: hidden in chat mode, rendered when the projection is missing", () => {
  const react = fakeReact();
  const api = loadClient({ react });
  const { registration, dispose } = applyForHeaderAction(api);
  const HeaderAction = registration.component;
  const base = { sessionId: "session-a", selectedView: "chat", selectView() {} };

  // 对话界面：整块不渲染 —— 既没有工作台入口按钮，也没有面板。
  assert.equal(HeaderAction({ ...base, useProjection: () => ({ mode: "chat", pending: false }) }), null);

  // 工作界面：入口按钮照旧出现（面板默认收起）。
  const work = HeaderAction({ ...base, useProjection: () => ({ mode: "work", pending: false }) });
  assert.equal(work.type, "div");
  assert.equal(work.props["data-mochi-mode"], "work");
  assert.equal(typeof work.children[0].type, "function", "the workbench entry stays mounted in work mode");
  assert.equal(work.children[1], null, "the panel is collapsed until the teacher opens it");

  // 投影缺失 / 非法值：安全降级为照常渲染，绝不静默丢掉工作台。
  const degraded = HeaderAction(base);
  assert.equal(degraded.type, "div");
  assert.equal(degraded.props["data-mochi-mode"], "unknown");
  assert.equal(typeof degraded.children[0].type, "function");

  assert.equal(api.__test.MOCHI_MODES_KEY, "mochiModes");
  assert.equal(api.__test.workbenchModeFromProjection({ mode: "chat" }), "chat");
  assert.equal(api.__test.workbenchModeFromProjection({ mode: "work" }), "work");
  assert.equal(api.__test.workbenchModeFromProjection({ mode: "nonsense" }), null);
  assert.equal(api.__test.workbenchModeFromProjection(undefined), null);
  assert.equal(api.__test.workbenchShowsForMode("chat"), false);
  assert.equal(api.__test.workbenchShowsForMode("work"), true);
  assert.equal(api.__test.workbenchShowsForMode(null), true, "missing projection renders the workbench");
  dispose();
});

test("the workbench source no longer claims the 对话/工作 mode semantics", () => {
  // 语义交接的反向证据：工作台不再出现「会话模式 / 对话 / 工作」这些模式字样。
  assert.equal(source.includes('"aria-label": "会话模式"'), false);
  assert.equal(source.includes('"对话"'), false);
  assert.equal(source.includes('"工作"'), false);
  assert.match(source, /"收起面板"/);
  assert.match(source, /"展开面板"/);
  // 面板功能本身一字未动。
  assert.match(source, /mochi-workbench-panel/);
  assert.match(source, /data-view": "work"/);
});
