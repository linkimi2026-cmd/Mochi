// mochi-modes 客户端测试：读宿主投影显示模式、经官方命令通道直接切换（不弹窗）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

function loadClient(overrides = {}) {
  const factories = new Map();
  const sandbox = {
    Array, Boolean, Error, Map, Math, Number, Object, Promise, Set, String, console,
    window: {
      __ModuleLoader__: {
        load(entry) { factories.set(entry.id, entry.factory); },
      },
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "mochi-modes-client/client.js" });
  const factory = factories.get("mochi-modes-client");
  assert.ok(factory, "browser plugin registered with ModuleLoader");
  return factory((name) => {
    if (name === "react") return overrides.react || {};
    throw new Error(`unexpected module request: ${name}`);
  });
}

// 只实现组件真正用到的 Hook；useState 带一个跨渲染的槽位，好断言错误态渲染。
function fakeReact() {
  const slots = [];
  let cursor = 0;
  return {
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
    __reset() { cursor = 0; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useEffect() {},
    useRef(value) { return { current: value }; },
  };
}

function applyForHeaderAction(api, remote) {
  const registrations = [];
  const disposers = [];
  const ctx = {
    remote,
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    slots: {
      inject(name, iteratorFactory) {
        for (const entry of iteratorFactory()) registrations.push({ name, entry });
      },
      register(options, component) { return { options, component }; },
    },
  };
  api.apply(ctx);
  return { registrations, dispose: () => disposers.reverse().forEach((dispose) => dispose()) };
}

function renderToggle(react, component, props) {
  react.__reset();
  return component(props);
}

// vm 里造出来的对象来自另一个 realm，原型不同；比较前先拍平成纯数据。
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test("只注册会话头动作条目；模式胶囊排在官方缝上", () => {
  const api = loadClient();
  const { registrations, dispose } = applyForHeaderAction(api, { commands: { execute: async () => ({ ok: true, value: {} }) } });
  assert.deepEqual(registrations.map((entry) => entry.name), ["conversation.session.header.actions"]);
  const headerAction = registrations[0].entry;
  assert.equal(headerAction.options.id, "mochi-modes-toggle");
  assert.equal(headerAction.options.order, 20);
  assert.equal(headerAction.options.name, api.__test.HEADER_SLOT);
  assert.ok(api.inject.includes("remote"));
  assert.ok(api.inject.includes("remote.commands"));
  // inject 给出的是绑定了当前会话的 switchMode，不是把 ctx 泄进组件。
  const injected = headerAction.options.inject("session-a");
  assert.equal(typeof injected.switchMode, "function");
  dispose();
});

test("投影缺席或会话缺失时不渲染任何东西 —— 不用客户端乐观状态假冒模式", () => {
  const react = fakeReact();
  const api = loadClient({ react });
  const Toggle = api.__test.ModeToggle;
  const switchMode = async () => ({ ok: true });

  assert.equal(renderToggle(react, Toggle, { sessionId: "session-a", switchMode }), null, "没有 useProjection 就不渲染");
  assert.equal(renderToggle(react, Toggle, { sessionId: "session-a", useProjection: () => undefined, switchMode }), null, "投影没值就不渲染");
  assert.equal(renderToggle(react, Toggle, { sessionId: "session-a", useProjection: () => ({ mode: "nonsense" }), switchMode }), null, "非法模式不猜");
  assert.equal(renderToggle(react, Toggle, { sessionId: null, useProjection: () => ({ mode: "chat" }), switchMode }), null, "没有会话不渲染");
});

test("模式来自宿主投影：对话模式下「对话」高亮，工作模式下「工作」高亮", () => {
  const react = fakeReact();
  const api = loadClient({ react });
  const Toggle = api.__test.ModeToggle;
  const switchMode = async () => ({ ok: true });

  const chat = renderToggle(react, Toggle, { sessionId: "s", useProjection: () => ({ mode: "chat", pending: false }), switchMode });
  assert.equal(chat.props["data-mode"], "chat");
  assert.equal(chat.props["data-pending"], "false");
  assert.deepEqual(chat.children.slice(0, 2).map((c) => c.children[0]), ["对话", "工作"]);
  assert.equal(chat.children[0].props["aria-pressed"], true);
  assert.equal(chat.children[1].props["aria-pressed"], false);

  const work = renderToggle(react, Toggle, { sessionId: "s", useProjection: () => ({ mode: "work", pending: false }), switchMode });
  assert.equal(work.props["data-mode"], "work");
  assert.equal(work.children[0].props["aria-pressed"], false);
  assert.equal(work.children[1].props["aria-pressed"], true);

  const pending = renderToggle(react, Toggle, { sessionId: "s", useProjection: () => ({ mode: "chat", pending: true }), switchMode });
  assert.equal(pending.props["data-pending"], "true", "切换未生效时挂 pending 标记");
});

test("模式条带当前界面说明：对话时「只聊天，不干活」，工作时「全量工具，正在干活」", () => {
  const react = fakeReact();
  const api = loadClient({ react });
  const Toggle = api.__test.ModeToggle;
  const switchMode = async () => ({ ok: true });

  const chat = renderToggle(react, Toggle, { sessionId: "s", useProjection: () => ({ mode: "chat", pending: false }), switchMode });
  const chatHint = chat.children[3];
  assert.equal(chatHint.props.className, "mochi-modes-toggle__hint");
  assert.equal(chatHint.props["data-mode"], "chat");
  assert.equal(chatHint.children[0], "只聊天，不干活");
  assert.equal(api.__test.MODE_HINTS.chat, "只聊天，不干活");

  const work = renderToggle(react, Toggle, { sessionId: "s", useProjection: () => ({ mode: "work", pending: false }), switchMode });
  const workHint = work.children[3];
  assert.equal(workHint.props["data-mode"], "work");
  assert.equal(workHint.children[0], "全量工具，正在干活");
  assert.equal(api.__test.MODE_HINTS.work, "全量工具，正在干活");

  // 两个按钮仍是「对话 / 工作」，说明小字不影响按钮次序。
  assert.deepEqual(chat.children.slice(0, 2).map((c) => c.children[0]), ["对话", "工作"]);
  // 出错时状态位仍在说明小字之前（老师先看到错误）。
  assert.equal(chat.children[2], null);
});

test("点「工作」= 直接切，不弹窗：只走一次官方命令，且是 /mochi-work", async () => {
  const react = fakeReact();
  const api = loadClient({ react });
  const Toggle = api.__test.ModeToggle;
  const calls = [];
  const remote = { commands: { execute(sessionId, line, attachments) { calls.push({ sessionId, line, attachments }); return Promise.resolve({ ok: true, value: { result: { kind: "success" } } }); } } };
  const switchMode = api.__test.createModeSwitcher(remote);

  const view = renderToggle(react, Toggle, { sessionId: "s", useProjection: () => ({ mode: "chat", pending: false }), switchMode });
  assert.equal(view.children[1].props["data-mode"], "work");
  const outcome = await switchMode("s", view.children[1].props["data-mode"]);
  assert.deepEqual(plain(outcome), { ok: true, line: "/mochi-work" });
  assert.deepEqual(plain(calls), [{ sessionId: "s", line: api.__test.WORK_COMMAND_LINE, attachments: [] }]);
  // 反向：点「对话」走 /mochi-chat。
  await switchMode("s", "chat");
  assert.equal(calls.at(-1).line, api.__test.CHAT_COMMAND_LINE);
});

test("已处于目标模式时点击是空操作（不重复发命令）", () => {
  const react = fakeReact();
  const api = loadClient({ react });
  const Toggle = api.__test.ModeToggle;
  const calls = [];
  const switchMode = async (target) => { calls.push(target); return { ok: true }; };
  const view = renderToggle(react, Toggle, { sessionId: "s", useProjection: () => ({ mode: "work", pending: false }), switchMode });
  view.children[1].props.onClick(); // 已经在 work
  assert.deepEqual(calls, [], "重复点当前模式不发命令");
  view.children[0].props.onClick(); // 切到 chat
  assert.deepEqual(calls, ["chat"]);
});

test("命令通道缺失或宿主拒绝时如实报错，绝不假装切换成功", async () => {
  const api = loadClient();
  const { createModeSwitcher, ModeToggle } = api.__test;

  assert.deepEqual(plain(await createModeSwitcher(undefined)("s", "work")), {
    ok: false, message: "当前客户端没有可用的命令通道，无法切换模式。",
  });
  assert.deepEqual(plain(await createModeSwitcher({ commands: { execute: async () => ({ ok: false, error: { code: "REFUSED", message: "拒绝" } }) } })("s", "work")), {
    ok: false, message: "拒绝",
  });
  assert.deepEqual(plain(await createModeSwitcher({ commands: { execute: async () => ({ ok: true, value: undefined }) } })("s", "work")), {
    ok: false, message: "宿主不认识命令 /mochi-work",
  });
  assert.deepEqual(plain(await createModeSwitcher({ commands: { execute: async () => { throw new Error("网络断了"); } } })("s", "work")), {
    ok: false, message: "网络断了",
  });
  assert.deepEqual(plain(await createModeSwitcher({ commands: { execute: async () => ({ ok: true }) } })("s", "elsewhere")), {
    ok: false, message: "未知模式：elsewhere",
  });
  assert.deepEqual(plain(await createModeSwitcher({ commands: { execute: async () => ({ ok: true }) } })("", "work")), {
    ok: false, message: "当前没有会话，无法切换模式。",
  });

  // 组件把失败渲染成可见的错误文案，而不是静默成功。
  const react = fakeReact();
  const failing = loadClient({ react });
  const view = renderToggle(react, failing.__test.ModeToggle, {
    sessionId: "s",
    useProjection: () => ({ mode: "chat", pending: false }),
    switchMode: () => Promise.resolve({ ok: false, message: "命令被宿主拒绝" }),
  });
  view.children[1].props.onClick();
  await Promise.resolve();
  await Promise.resolve();
  const after = renderToggle(react, failing.__test.ModeToggle, {
    sessionId: "s",
    useProjection: () => ({ mode: "chat", pending: false }),
    switchMode: () => Promise.resolve({ ok: false, message: "命令被宿主拒绝" }),
  });
  assert.equal(after.children[2].props.role, "status");
  assert.equal(after.children[2].children[0], "命令被宿主拒绝");
});

test("源码层反向证据：手动切换不经过任何审批/弹窗通道", () => {
  assert.equal(source.includes("approval"), false, "客户端不注册审批通道，手动切换不弹窗");
  assert.equal(source.includes("window.confirm"), false);
  assert.equal(source.includes("alert("), false);
  assert.match(source, /remote\.commands/);
});
