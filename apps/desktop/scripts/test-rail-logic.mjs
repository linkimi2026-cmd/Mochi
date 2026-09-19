#!/usr/bin/env node
/**
 * 常驻条与位置记忆的逻辑测试。
 *
 * 为什么需要这一层：真实 Electron 二进制在部分开发机上并未安装（下载体积大、
 * 常被裁剪），而 scripts/test-rail-runtime.mjs 必须在真 Electron 里跑。这个文件
 * 用一个注入的 Electron 替身驱动同一个已编译模块，覆盖窗口参数、IPC 消息、
 * 弹窗排队去重、动作分发、位置落盘与损坏恢复——不依赖图形环境，随时可跑。
 *
 * 替身只替换第三方运行时，不替换被测模块本身：窗口参数、发送的载荷、调用顺序
 * 全部是被测代码真实产生的。
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const compiledRail = join(desktopRoot, "dist-electron", "dsh", "rail.js");
const compiledStore = join(desktopRoot, "dist-electron", "dsh", "rail-store.js");

/* ───────────────────────── Electron 替身 ───────────────────────── */

class FakeWebContents extends EventEmitter {
  constructor(owner) {
    super();
    this.owner = owner;
    this.sent = [];
    this.destroyed = false;
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }

  isDestroyed() {
    return this.destroyed;
  }

  getURL() {
    return this.owner.url;
  }

  last(channel) {
    const matching = this.sent.filter((entry) => entry.channel === channel);
    return matching.length === 0 ? null : matching[matching.length - 1].payload;
  }
}

class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.url = "";
    this.destroyed = false;
    this.visible = false;
    this.alwaysOnTop = false;
    this.alwaysOnTopLevel = null;
    this.workspaces = 0;
    this.bounds = {
      x: typeof options.x === "number" ? options.x : 0,
      y: typeof options.y === "number" ? options.y : 0,
      width: options.width,
      height: options.height,
    };
    this.webContents = new FakeWebContents(this);
    FakeBrowserWindow.instances.push(this);
  }

  setAlwaysOnTop(value, level) {
    this.alwaysOnTop = value === true;
    this.alwaysOnTopLevel = level ?? null;
  }

  setVisibleOnAllWorkspaces() {
    this.workspaces += 1;
  }

  loadURL(url) {
    this.url = url;
    return Promise.resolve();
  }

  showInactive() {
    this.visible = true;
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isVisible() {
    return this.visible;
  }

  isAlwaysOnTop() {
    return this.alwaysOnTop;
  }

  getBounds() {
    return { ...this.bounds };
  }

  setBounds(patch) {
    Object.assign(this.bounds, patch);
  }

  getPosition() {
    return [this.bounds.x, this.bounds.y];
  }

  setPosition(x, y) {
    this.bounds.x = x;
    this.bounds.y = y;
    this.emit("moved");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.emit("closed");
  }

  isRail() {
    return this.url.includes("teacher-rail") || this.url.includes("classroom-board");
  }

  isPopup() {
    return this.url.includes("popup");
  }
}

const fakeScreen = {
  getPrimaryDisplay() {
    return { workArea: { x: 0, y: 25, width: 1920, height: 1055 } };
  },
  getAllDisplays() {
    return [fakeScreen.getPrimaryDisplay()];
  },
};

const fakeElectron = { BrowserWindow: FakeBrowserWindow, screen: fakeScreen };

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") return fakeElectron;
  return originalLoad.call(this, request, parent, isMain);
};

const {
  createMochiRail,
  normalizeRailAction,
  normalizeRailAttention,
  normalizeRailSnapshot,
  clampPositionToDisplays,
  RAIL_WINDOW,
} = require(compiledRail);
const { createRailPositionStore } = require(compiledStore);

/* ───────────────────────── 断言辅助 ───────────────────────── */

let checks = 0;
function ok(value, message) {
  assert.ok(value, message);
  checks += 1;
}
function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  checks += 1;
}
function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks += 1;
}

function memoryStore() {
  const positions = new Map();
  const saves = [];
  return {
    saves,
    load: (surface) => positions.get(surface) ?? null,
    save: (surface, position) => {
      saves.push({ surface, position });
      positions.set(surface, position);
    },
  };
}

function railWindows() {
  return FakeBrowserWindow.instances.filter((window) => window.isRail() && !window.destroyed);
}

function popupWindows() {
  return FakeBrowserWindow.instances.filter((window) => window.isPopup() && !window.destroyed);
}

function makeRail(surface = "teacher-rail", store = memoryStore(), onAction = () => {}, onClosed = () => {}) {
  return { rail: createMochiRail({ surface, preload: "/dev/null/rail-preload.js", store, onAction, onClosed }), store };
}

function snapshot(overrides = {}) {
  return {
    surface: "teacher-rail",
    heading: "学生预约",
    detail: "2 条待处理",
    updatedAt: "2026-09-18T13:00:00.000Z",
    rows: [
      { id: "m1", seq: 1, name: "张小明", meta: "高一（3）班 · 预约", note: "预约讲题：第 3 题", badge: "待处理", tone: "attention", at: "2026-09-18T12:58:00.000Z" },
      { id: "m2", seq: 2, name: "李小红", meta: "高一（3）班 · 提问", note: "问作业第 8 题", badge: "待处理", tone: "attention", at: "2026-09-18T12:59:00.000Z" },
    ],
    ...overrides,
  };
}

function attention(id, subject) {
  return { id, kind: "call", title: "有人喊你", subject, detail: "预约讲题：第 3 题", at: "2026-09-18T13:00:00.000Z" };
}

/* ───────────────────────── 1. 纯校验函数 ───────────────────────── */

equal(normalizeRailSnapshot(null), null, "null 快照必须被拒绝");
equal(normalizeRailSnapshot({ surface: "nope", rows: [] }), null, "未知 surface 必须被拒绝");
equal(normalizeRailSnapshot({ surface: "teacher-rail", rows: "x" }), null, "rows 非数组必须整份拒绝");
equal(normalizeRailSnapshot(snapshot(), "classroom-board"), null, "跨 surface 必须被拒绝");

const normalized = normalizeRailSnapshot({
  surface: "teacher-rail",
  heading: "  标题里带\u0007控制字符  ",
  detail: "d".repeat(200),
  updatedAt: "t",
  rows: [
    { name: "缺 id" },
    { id: "a", name: " 张三 ", tone: "weird" },
    { id: "b", name: "李四", seq: 999999 },
  ],
});
equal(normalized.rows.length, 2, "缺 id 的行必须被丢弃");
equal(normalized.rows[0].name, "张三", "名称两端空白必须被裁掉");
equal(normalized.rows[0].tone, "neutral", "未知 tone 必须回退 neutral");
equal(normalized.rows[0].seq, 1, "缺省 seq 必须按序补 1 起");
equal(normalized.rows[1].seq, 9999, "越界 seq 必须被夹到上限");
equal(normalized.heading.includes("\u0007"), false, "控制字符必须被剔除");
equal(normalized.detail.length, 80, "detail 必须被截断到上限");

const capped = normalizeRailSnapshot({
  surface: "teacher-rail",
  rows: Array.from({ length: 80 }, (_value, index) => ({ id: `r${index}` })),
});
equal(capped.rows.length, 50, "行数必须被夹到上限 50");

equal(normalizeRailAttention({ id: "", kind: "call" }), null, "缺 id 的弹窗必须被拒绝");
equal(normalizeRailAttention({ id: "x", kind: "nope" }), null, "未知 kind 的弹窗必须被拒绝");
equal(normalizeRailAttention(attention("x", "s")).kind, "call", "合法弹窗必须通过");

deepEqual(normalizeRailAction({ type: "hide" }), { type: "hide" }, "hide 必须通过");
deepEqual(normalizeRailAction({ type: "sync" }), { type: "sync" }, "sync 必须通过");
equal(normalizeRailAction({ type: "open" }), null, "缺 id 的 open 必须被拒绝");
equal(normalizeRailAction({ type: "open", id: "m1" }).id, "m1", "带 id 的 open 必须通过");
equal(normalizeRailAction({ type: "evil" }), null, "未知动作必须被拒绝");
equal(normalizeRailAction(null), null, "null 动作必须被拒绝");

// 位置夹取：全部屏幕之外必须回到主屏内。
deepEqual(
  clampPositionToDisplays({ x: 9000, y: 9000 }, RAIL_WINDOW.width, RAIL_WINDOW.maxHeight),
  { x: 1920 - RAIL_WINDOW.width, y: 25 + 1055 - RAIL_WINDOW.maxHeight },
  "屏幕外的位置必须被夹回主屏可见范围",
);
deepEqual(
  clampPositionToDisplays({ x: 100, y: 100 }, RAIL_WINDOW.width, RAIL_WINDOW.maxHeight),
  { x: 100, y: 100 },
  "屏幕内的位置必须原样保留",
);

/* ───────────────────────── 2. 窗口形态 ───────────────────────── */

{
  const { rail } = makeRail();
  rail.setVisible(true);
  const window = railWindows()[0];
  ok(window !== undefined, "setVisible(true) 必须创建常驻条窗口");
  equal(window.options.width, RAIL_WINDOW.width, "常驻条宽度必须固定");
  equal(window.options.frame, false, "常驻条必须无边框");
  equal(window.options.skipTaskbar, true, "常驻条必须不进任务栏");
  equal(window.options.resizable, false, "常驻条必须不可缩放");
  equal(window.visible, true, "常驻条必须可见");
  equal(window.alwaysOnTop, true, "常驻条必须置顶");
  equal(window.alwaysOnTopLevel, "floating", "教师条必须用 floating 层级，不压全屏演示");
  equal(window.options.webPreferences.sandbox, true, "常驻条页面必须在沙箱里");
  equal(window.options.webPreferences.contextIsolation, true, "常驻条必须开启上下文隔离");
  ok(window.url.startsWith("data:text/html"), "常驻条页面必须是自包含 data: URL");
  equal(window.webContents.sent.length, 0, "没有快照时不应发送任何内容");
  rail.dispose();
}

{
  const { rail } = makeRail("classroom-board");
  rail.setVisible(true);
  const window = railWindows()[0];
  equal(window.alwaysOnTopLevel, "screen-saver", "教室屏必须用 screen-saver 层级，要压在全屏之上");
  equal(window.workspaces, 1, "教室屏必须在所有工作区可见");
  rail.dispose();
}

/* ───────────────────────── 3. 快照：整份替换 + 串屏防护 ───────────────────────── */

{
  const { rail } = makeRail();
  equal(rail.apply(snapshot()), true, "合法快照必须被应用");
  const window = railWindows()[0];
  const pushed = window.webContents.last("mochi:rail:apply");
  equal(pushed.rows.length, 2, "快照必须整份下发");
  equal(pushed.heading, "学生预约", "标题必须下发");
  equal(window.bounds.height, 64 + 2 * 52, "高度必须按行数增长");

  // 串屏：教室端快照不能进教师条，且必须整份拒绝、保留上一份。
  equal(rail.apply(snapshot({ surface: "classroom-board" })), false, "跨 surface 的推送必须被拒绝");
  const afterCross = window.webContents.last("mochi:rail:apply");
  equal(afterCross.heading, "学生预约", "被拒绝的推送不能改变已下发内容");
  equal(afterCross.rows.length, 2, "被拒绝的推送不能清空已有行");

  equal(rail.apply({ surface: "teacher-rail", rows: "nope" }), false, "畸形快照必须被拒绝");
  equal(rail.apply(undefined), false, "undefined 快照必须被拒绝");

  // 空列表也必须能下发（老师处理完最后一件事）。
  equal(rail.apply(snapshot({ rows: [], heading: "学生预约", detail: "暂无待处理" })), true, "空列表快照必须被接受");
  equal(window.bounds.height, RAIL_WINDOW.minHeight, "空列表必须收回到最小高度");
  equal(window.webContents.last("mochi:rail:apply").rows.length, 0, "空列表必须如实下发");

  // 隐藏期间来了新内容，重新显示时高度必须跟着新内容走——否则老师会看到被裁掉
  // 下半截的列表，而且没有任何提示。
  rail.setVisible(false);
  equal(window.visible, false, "隐藏后窗口不可见");
  rail.apply(snapshot({ rows: Array.from({ length: 4 }, (_value, index) => ({ id: `h${index}`, name: `学生${index}` })) }));
  equal(window.bounds.height, 64 + 4 * 52, "隐藏期间的高度必须已经按新内容更新");
  rail.setVisible(true);
  equal(window.bounds.height, 64 + 4 * 52, "重新显示后高度必须与新内容一致");
  rail.dispose();
}

{
  // 高度不得超过上限。
  const { rail } = makeRail();
  rail.apply(snapshot({
    rows: Array.from({ length: 50 }, (_value, index) => ({ id: `r${index}`, name: `学生${index}` })),
  }));
  equal(railWindows()[0].bounds.height, RAIL_WINDOW.maxHeight, "高度必须被夹在上限");
  rail.dispose();
}

/* ───────────────────────── 4. 弹窗：真窗口 / 去重 / 排队 / 轮换 ───────────────────────── */

{
  const actions = [];
  const { rail } = makeRail("teacher-rail", memoryStore(), (action) => actions.push(action));

  equal(rail.attention(attention("a1", "张小明 · 高一（3）班")), true, "合法弹窗必须入队");
  equal(popupWindows().length, 1, "弹窗必须是真窗口");
  const popup = popupWindows()[0];
  equal(popup.alwaysOnTop, true, "弹窗必须置顶");
  equal(popup.alwaysOnTopLevel, "screen-saver", "弹窗必须能压在全屏之上");
  equal(popup.visible, true, "弹窗必须可见");
  equal(popup.options.frame, false, "弹窗必须无边框");
  const firstPayload = popup.webContents.last("mochi:rail:popup");
  equal(firstPayload.subject, "张小明 · 高一（3）班", "弹窗内容必须下发");

  // 去重与拒绝。
  equal(rail.attention(attention("a1", "张小明 · 高一（3）班")), false, "同 id 重复推送不得重复入队");
  equal(rail.attention({ id: "", kind: "call" }), false, "缺 id 必须被拒绝");
  equal(rail.attention(null), false, "null 必须被拒绝");
  equal(popupWindows().length, 1, "被拒绝的推送不得多开窗口");

  // 排队：第二条不抢当前窗口。
  equal(rail.attention(attention("b2", "李小红 · 高一（3）班")), true, "第二条必须入队");
  equal(popupWindows().length, 1, "排队时不得开第二个弹窗");
  equal(popup.webContents.last("mochi:rail:popup").subject, "张小明 · 高一（3）班", "未确认前内容不得被抢走");

  // 确认第一条 → 轮换到第二条，复用同一个窗口。
  rail.dispatch({ type: "acknowledge", id: "a1" });
  equal(popup.webContents.last("mochi:rail:popup").subject, "李小红 · 高一（3）班", "确认后必须轮换到下一条");
  equal(popupWindows().length, 1, "轮换必须复用同一个窗口");
  deepEqual(actions, [{ type: "acknowledge", id: "a1" }], "确认动作必须转发给宿主");

  // 确认第二条 → 队列排空，窗口关闭。
  rail.dispatch({ type: "acknowledge", id: "b2" });
  equal(popupWindows().length, 0, "队列排空后弹窗必须关闭");
  equal(actions.length, 2, "第二次确认必须被转发");

  // 队列排空后再来一条：必须重新开一个弹窗（不能复用已销毁的那个）。
  equal(rail.attention(attention("c3", "王大力 · 高一（3）班")), true, "排空后的新弹窗必须能入队");
  equal(popupWindows().length, 1, "排空后必须重新开一个弹窗");
  const reopened = popupWindows()[0];
  equal(reopened.webContents.last("mochi:rail:popup").subject, "王大力 · 高一（3）班", "重开的弹窗内容必须下发");

  // 不匹配的 id 不得误关当前弹窗，也不得改变内容。
  rail.dispatch({ type: "acknowledge", id: "not-this-one" });
  equal(popupWindows().length, 1, "id 不匹配的确认不得关闭弹窗");
  equal(reopened.webContents.last("mochi:rail:popup").subject, "王大力 · 高一（3）班", "id 不匹配的确认不得改变内容");
  rail.dispose();
}

/* ───────────────────────── 5. 动作分发 ───────────────────────── */

{
  const actions = [];
  const { rail } = makeRail("teacher-rail", memoryStore(), (action) => actions.push(action));
  rail.apply(snapshot());
  const window = railWindows()[0];

  // sync 由模块内部消化，不转发给宿主。
  equal(rail.dispatch({ type: "sync" }), true, "sync 必须被接受");
  deepEqual(actions, [], "sync 不得转发给宿主");
  equal(window.webContents.last("mochi:rail:apply").rows.length, 2, "sync 必须重发当前快照");

  equal(rail.dispatch({ type: "open", id: "m1" }), true, "open 必须被接受");
  deepEqual(actions, [{ type: "open", id: "m1" }], "open 必须转发给宿主");

  equal(rail.dispatch({ type: "hide" }), true, "hide 必须被接受");
  equal(window.visible, false, "hide 必须真的把窗口收起来");
  deepEqual(actions[1], { type: "hide" }, "hide 必须转发给宿主");

  equal(rail.dispatch({ type: "evil" }), false, "未知动作必须被拒绝");
  equal(rail.dispatch("hide"), false, "字符串动作必须被拒绝");
  equal(actions.length, 2, "被拒绝的动作不得转发");

  // 重新显示必须重发最近一份快照（页面可能是新加载的）。
  rail.setVisible(true);
  equal(window.visible, true, "重新显示必须让窗口可见");
  equal(window.webContents.last("mochi:rail:apply").rows.length, 2, "重新显示必须重发快照");
  rail.dispose();
}

/* ───────────────────────── 6. 位置记忆 ───────────────────────── */

{
  const store = memoryStore();
  const { rail } = makeRail("teacher-rail", store);
  rail.setVisible(true);
  const window = railWindows()[0];
  const origin = window.getBounds();
  window.setPosition(origin.x - 40, origin.y + 40);
  equal(store.saves.length, 1, "拖动后必须落盘一次");
  equal(store.saves[0].surface, "teacher-rail", "落盘必须带 surface");
  deepEqual(store.saves[0].position, { x: origin.x - 40, y: origin.y + 40 }, "落盘坐标必须与拖动一致");

  // 关掉再建：必须用记住的位置，而不是默认位置。
  rail.dispose();
  const again = makeRail("teacher-rail", store);
  again.rail.setVisible(true);
  const restored = railWindows()[0];
  deepEqual(
    { x: restored.getBounds().x, y: restored.getBounds().y },
    { x: origin.x - 40, y: origin.y + 40 },
    "重建必须回到记住的位置",
  );
  again.rail.dispose();
}

/* ───────────────────────── 7. dispose 与异常关闭 ───────────────────────── */

{
  let closed = 0;
  const { rail } = makeRail("teacher-rail", memoryStore(), () => {}, () => { closed += 1; });
  rail.setVisible(true);
  const window = railWindows()[0];

  // 页面里的关闭必须被拦成隐藏。
  window.emit("close", { preventDefault: () => { window.prevented = true; } });
  equal(window.prevented, true, "常驻条的关闭必须被拦截");
  equal(window.destroyed, false, "被拦截的关闭不得销毁窗口");

  rail.dispose();
  equal(window.destroyed, true, "dispose 必须真正销毁窗口");
  equal(closed, 0, "显式 dispose 不得被当成异常关闭");

  // 意外销毁必须通知宿主，供主进程决定是否重建。
  let unexpected = 0;
  const second = makeRail("teacher-rail", memoryStore(), () => {}, () => { unexpected += 1; });
  second.rail.setVisible(true);
  railWindows()[0].destroy();
  equal(unexpected, 1, "意外销毁必须通知宿主");
  second.rail.dispose();
}

/* ───────────────────────── 8. 位置落盘的真实文件 ───────────────────────── */

{
  const directory = mkdtempSync(join(tmpdir(), "mochi-rail-store-"));
  const filePath = join(directory, "nested", "mochi-rail-positions.json");
  try {
    const store = createRailPositionStore(filePath);
    equal(store.load("teacher-rail"), null, "首次读取必须无记忆");
    store.save("teacher-rail", { x: 100, y: 200 });
    store.save("classroom-board", { x: 300, y: 400 });
    deepEqual(store.load("teacher-rail"), { x: 100, y: 200 }, "同一会话内必须读回");
    deepEqual(store.load("classroom-board"), { x: 300, y: 400 }, "两个 surface 必须互不覆盖");

    const reopened = createRailPositionStore(filePath);
    deepEqual(reopened.load("teacher-rail"), { x: 100, y: 200 }, "跨实例必须读回教师条位置");
    deepEqual(reopened.load("classroom-board"), { x: 300, y: 400 }, "跨实例必须读回教室屏位置");
    equal(readFileSync(filePath, "utf8").endsWith("\n"), true, "落盘必须是完整的一行 JSON");

    // 损坏文件必须降级为「无记忆」而不是抛错。
    writeFileSync(filePath, "{ 这不是 JSON", "utf8");
    equal(createRailPositionStore(filePath).load("teacher-rail"), null, "损坏文件必须降级为无记忆");

    // 越界/非法坐标必须被拒绝。
    writeFileSync(filePath, JSON.stringify({ version: 1, positions: { "teacher-rail": { x: "left", y: 1 } } }), "utf8");
    equal(createRailPositionStore(filePath).load("teacher-rail"), null, "非数字坐标必须被拒绝");
    writeFileSync(filePath, JSON.stringify({ version: 1, positions: { "teacher-rail": { x: 1e9, y: 0 } } }), "utf8");
    equal(createRailPositionStore(filePath).load("teacher-rail"), null, "越界坐标必须被拒绝");

    // 同坐标重复保存不应反复写盘。
    rmSync(filePath, { force: true });
    const once = createRailPositionStore(filePath);
    once.save("teacher-rail", { x: 5, y: 6 });
    const firstWrite = readFileSync(filePath, "utf8");
    once.save("teacher-rail", { x: 5, y: 6 });
    equal(readFileSync(filePath, "utf8"), firstWrite, "同坐标重复保存不应改动文件");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

Module._load = originalLoad;
console.log(`[test-rail-logic] PASS: ${checks} 项断言通过（窗口形态、串屏防护、弹窗去重排队、动作分发、位置记忆、文件损坏恢复）。`);
