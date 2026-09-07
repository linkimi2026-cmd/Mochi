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

function loadClient() {
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
    if (name === "react" || name === "jxl-brand") return {};
    throw new Error(`unexpected module request: ${name}`);
  });
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
  api.__test.openWorkbench("session-a");
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

test("official slots remain additive and no details slot is claimed", () => {
  const api = loadClient();
  const registrations = [];
  const tabDescriptors = [];
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
  // 合并后：工作台不再占用 shell.overlay，唯一槽位是会话头按钮；
  // 面板本体经 betterSidebar.registerTab 注册为侧边栏 tab（single + 首位 order）。
  assert.deepEqual(registrations.map((entry) => entry.name), ["conversation.session.header.actions"]);
  assert.equal(registrations.some((entry) => entry.name === "details"), false);
  assert.equal(tabDescriptors.length, 1);
  assert.equal(tabDescriptors[0].id, "mochi-workbench:panel");
  assert.equal(tabDescriptors[0].single, true);
  assert.ok(tabDescriptors[0].order < 10, "teacher workbench precedes builtin tabs");
  assert.ok(api.inject.includes("conversation"));
  assert.ok(api.inject.includes("betterSidebar"));
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
    api.__test.openWorkbench("session-a");
    api.__test.setWorkbenchState({ selection });
    const outcome = api.__test.createComposerDraftBridge(ctx)(selection, "不应投递");
    assert.equal(outcome.ok, false, mode);
    assert.equal(released.length, 1, `${mode} releases the registered attachment`);
    assert.equal(draft, "保留草稿", `${mode} preserves the original draft`);
  }
});
