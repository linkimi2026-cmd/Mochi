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
const compiledPages = join(desktopRoot, "dist-electron", "dsh", "rail-pages.js");
const { railPageHtml } = require(compiledPages);
const { advanceRailSpring, isRailSpringSettled } = require(join(desktopRoot, "dist-electron", "dsh", "rail-spring.js"));

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

  setBounds(patch, animate = false) {
    Object.assign(this.bounds, patch);
    if (animate) this.emit("resized");
  }

  getPosition() {
    return [this.bounds.x, this.bounds.y];
  }

  getSize() {
    return [this.bounds.width, this.bounds.height];
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

const primaryDisplay = { workArea: { x: 0, y: 25, width: 1920, height: 1055 } };
let connectedDisplays = [primaryDisplay];
const fakeScreen = {
  getPrimaryDisplay() {
    return primaryDisplay;
  },
  getAllDisplays() {
    return connectedDisplays;
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
  normalizeRailSyncHealth,
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

{
  let value = { position: 76, velocity: 0 };
  let previous = value.position;
  let monotonic = true;
  for (let frame = 0; frame < 120 && !isRailSpringSettled(value, 336); frame += 1) {
    value = advanceRailSpring(value, 336, 1 / 60);
    monotonic &&= value.position >= previous;
    previous = value.position;
  }
  ok(monotonic, "a rest-to-rest critically damped move does not bounce");
  ok(isRailSpringSettled(value, 336), "a rest-to-rest spring settles without a wall-clock dependency");
  ok(value.position <= 336, "a rest-to-rest critically damped move does not overshoot its target");

  const moving = advanceRailSpring({ position: 76, velocity: 0 }, 336, 0.032);
  ok(moving.velocity > 0, "an expanding rail has positive width velocity");
  const firstReverseFrame = advanceRailSpring(moving, 76, 1 / 60);
  ok(firstReverseFrame.position > moving.position, "retargeting carries current velocity through the reversal");
  ok(firstReverseFrame.velocity > 0 && firstReverseFrame.velocity < moving.velocity,
    "reversal brakes the existing velocity instead of resetting it");

  let reversed = firstReverseFrame;
  let previousVelocitySign = Math.sign(reversed.velocity);
  let directionChanges = 0;
  for (let frame = 0; frame < 180 && !isRailSpringSettled(reversed, 76); frame += 1) {
    reversed = advanceRailSpring(reversed, 76, 1 / 60);
    const velocitySign = Math.sign(reversed.velocity);
    if (velocitySign !== 0 && velocitySign !== previousVelocitySign) directionChanges += 1;
    if (velocitySign !== 0) previousVelocitySign = velocitySign;
  }
  equal(directionChanges, 1, "an interrupted spring turns once, then settles without oscillation");
  ok(isRailSpringSettled(reversed, 76), "an interrupted spring reaches its new target");
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
  return { id, kind: "call", title: "学生呼叫", subject, detail: "预约讲题：第 3 题", at: "2026-09-18T13:00:00.000Z" };
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
  actionRequiredCount: 80,
  rows: Array.from({ length: 80 }, (_value, index) => ({ id: `r${index}` })),
});
equal(capped.rows.length, 50, "行数必须被夹到上限 50");
equal(capped.actionRequiredCount, 80, "裁剪可见行不应裁剪真实待处理总数");
equal(normalizeRailSnapshot({ surface: "classroom-board", totalRowCount: 64, rows: capped.rows }).totalRowCount, 64, "教室结果总数独立于可见行上限");

equal(normalizeRailAttention({ id: "", kind: "call" }), null, "缺 id 的弹窗必须被拒绝");
equal(normalizeRailAttention({ id: "x", kind: "nope" }), null, "未知 kind 的弹窗必须被拒绝");
equal(normalizeRailAttention(attention("x", "s")).kind, "call", "合法弹窗必须通过");

deepEqual(normalizeRailAction({ type: "hide" }), { type: "hide" }, "hide 必须通过");
deepEqual(normalizeRailAction({ type: "sync" }), { type: "sync" }, "sync 必须通过");
deepEqual(normalizeRailAction({ type: "toggle" }), { type: "toggle" }, "teacher pet toggle 必须通过");
deepEqual(normalizeRailAction({ type: "open" }), { type: "open" }, "通用打开动作可以不带 id");
equal(normalizeRailAction({ type: "open", id: "m1" }).id, "m1", "带 id 的 open 必须通过");
equal(normalizeRailAction({ type: "evil" }), null, "未知动作必须被拒绝");
equal(normalizeRailAction(null), null, "null 动作必须被拒绝");
deepEqual(normalizeRailSyncHealth({ status: "waiting" }), { status: "waiting" }, "首次同步前有明确状态");
equal(normalizeRailSyncHealth({ status: "live" }), null, "已同步状态必须带主进程记录的成功时间");
equal(normalizeRailSyncHealth({ status: "stale", lastSuccessAt: "not a date" }), null, "无效时间不得进入桌宠");

{
  const teacherPage = railPageHtml("teacher-rail");
  const boardPage = railPageHtml("classroom-board");
  ok(teacherPage.includes("MochiMotion.mountMotion") && teacherPage.includes("data-engine"), "compact pet uses the shared live bloub engine");
  ok(teacherPage.includes("viewBox='24 10 72 54'") && teacherPage.includes("fill='#4A3826'"), "compact pet includes Mochi's own laptop");
  ok(teacherPage.includes("pet-breathe") && teacherPage.includes("pet-alert") && teacherPage.includes("pet-blink"), "pet includes idle, attention and blink motion");
  ok(teacherPage.includes("prefers-reduced-motion:reduce"), "reduced motion disables pet loops");
  ok(teacherPage.includes("prefers-reduced-transparency:reduce"), "reduced transparency makes the panel solid");
  equal(boardPage.includes("id='toggle'"), false, "classroom board does not inherit the compact pet toggle");
}

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
connectedDisplays = [primaryDisplay, { workArea: { x: 1920, y: 0, width: 1280, height: 900 } }];
deepEqual(
  clampPositionToDisplays({ x: 3188, y: 850 }, RAIL_WINDOW.width, RAIL_WINDOW.maxHeight),
  { x: 2864, y: 428 },
  "部分悬出副屏的窗口应完整夹回副屏工作区",
);
connectedDisplays = [primaryDisplay];

/* ───────────────────────── 2. 窗口形态 ───────────────────────── */

{
  const { rail } = makeRail();
  rail.setVisible(true);
  const window = railWindows()[0];
  ok(window !== undefined, "setVisible(true) 必须创建常驻条窗口");
  equal(window.options.width, RAIL_WINDOW.petSize, "教师端首次以桌宠尺寸出现");
  equal(window.options.frame, false, "常驻条必须无边框");
  equal(window.options.skipTaskbar, true, "常驻条必须不进任务栏");
  equal(window.options.resizable, false, "常驻条必须不可缩放");
  equal(window.visible, true, "常驻条必须可见");
  equal(window.alwaysOnTop, true, "常驻条必须置顶");
  equal(window.alwaysOnTopLevel, "floating", "教师条必须用 floating 层级，不压全屏演示");
  equal(window.options.webPreferences.sandbox, true, "常驻条页面必须在沙箱里");
  equal(window.options.webPreferences.contextIsolation, true, "常驻条必须开启上下文隔离");
  equal(window.options.transparent, true, "教师桌宠使用透明悬浮窗");
  ok(window.url.startsWith("data:text/html"), "常驻条页面必须是自包含 data: URL");
  equal(window.webContents.sent.filter((entry) => entry.channel === "mochi:rail:apply").length, 0, "没有快照时不应伪造待办内容");
  deepEqual(window.webContents.last("mochi:rail:health"), { status: "waiting" }, "没有快照时仍明确提示尚未同步");
  // Renderer-provided presentation fields must be ignored; sync only reads main state.
  rail.dispatch({ type: "sync", expanded: true });
  deepEqual(window.webContents.last("mochi:rail:apply"), { type: "state", expanded: false, petSize: 96 }, "没有业务快照时 sync 仍须下发主进程展开态");
  equal(window.bounds.width, RAIL_WINDOW.petSize, "renderer 不能借 sync payload 展开原生窗口");
  const compactX = window.bounds.x;
  rail.dispatch({ type: "toggle" });
  equal(window.bounds.width, RAIL_WINDOW.width, "展开后呈现待办面板宽度");
  rail.dispatch({ type: "sync" });
  equal(window.webContents.last("mochi:rail:apply").expanded, true, "展开动作后页面状态由主进程回推");
  equal(window.bounds.x + window.bounds.width, compactX + RAIL_WINDOW.petSize, "展开时固定右缘");
  rail.dispatch({ type: "toggle" });
  equal(window.bounds.width, RAIL_WINDOW.petSize, "再次点击收回桌宠");
  rail.dispose();
}

{
  const { rail } = makeRail("classroom-board");
  rail.setVisible(true);
  const window = railWindows()[0];
  equal(window.options.transparent, false, "教室板保持不透明以便全班阅读");
  equal(window.alwaysOnTopLevel, "screen-saver", "教室屏必须用 screen-saver 层级，要压在全屏之上");
  equal(window.workspaces, 1, "教室屏必须在所有工作区可见");
  rail.dispose();
}

// 首帧比用户关闭更晚到达时，不得把已隐藏的桌宠重新唤醒。
{
  const { rail } = makeRail();
  rail.setVisible(true);
  const window = railWindows()[0];
  rail.dispatch({ type: "hide" });
  window.emit("ready-to-show");
  equal(window.visible, false, "迟到的首帧不得覆盖用户隐藏");
  rail.syncHealth({ status: "live", lastSuccessAt: new Date().toISOString() });
  rail.dispatch({ type: "sync" });
  equal(window.visible, false, "同步健康与页面重载不得唤醒桌宠");
  rail.setVisible(true);
  equal(window.visible, true, "显式托盘操作可恢复桌宠");
  rail.dispatch({ type: "resize", size: 999 });
  equal(window.bounds.width, 160, "缩放不超过上限");
  rail.dispatch({ type: "resize", size: 1 });
  equal(window.bounds.width, 72, "缩放不低于下限");
  equal(window.bounds.height, 72, "缩放保持正方形");
  equal(rail.dispatch({ type: "resize", size: NaN }), false, "非法尺寸被拒绝");
  rail.dispatch({ type: "toggle", reducedMotion: true });
  equal(rail.dispatch({ type: "resize", size: 100 }), false, "待办面板不能被桌宠缩放动作改变");

  window.emit("close", { preventDefault() {} });
  equal(window.visible, false, "原生关闭同样隐藏桌宠");
  rail.dispose();
}

/* ───────────────────────── 3. 快照：整份替换 + 串屏防护 ───────────────────────── */

{
  const { rail } = makeRail();
  equal(rail.apply(snapshot()), true, "合法快照必须被应用");
  const window = railWindows()[0];
  rail.dispatch({ type: "toggle" });
  rail.dispatch({ type: "sync" });
  const pushed = window.webContents.last("mochi:rail:apply");
  equal(pushed.rows.length, 2, "快照必须整份下发");
  equal(pushed.expanded, true, "快照同步同时携带主进程展开态");
  equal(pushed.heading, "学生预约", "标题必须下发");
  equal(window.bounds.height, 148 + 2 * 112, "展开面板需为预约时间、页头页脚和每行卡片预留完整高度");

  const firstSuccess = "2026-09-24T07:00:00.000Z";
  const newerSuccess = "2026-09-24T07:00:03.000Z";
  equal(rail.syncHealth({ status: "live", lastSuccessAt: firstSuccess }), true, "成功轮询可标记快照为新鲜");
  const sentHealth = window.webContents.sent.filter((entry) => entry.channel === "mochi:rail:health").length;
  equal(rail.syncHealth({ status: "live", lastSuccessAt: newerSuccess }), true, "无内容变化的成功轮询仍刷新最后成功时间");
  equal(window.webContents.sent.filter((entry) => entry.channel === "mochi:rail:health").length, sentHealth, "正常心跳不应每 3 秒重绘桌宠");
  equal(rail.syncHealth({ status: "stale", lastSuccessAt: newerSuccess }), true, "失败轮询必须标记旧快照");
  deepEqual(window.webContents.last("mochi:rail:health"), { status: "stale", lastSuccessAt: newerSuccess }, "旧数据提示保留最近一次成功时间");
  equal(window.webContents.last("mochi:rail:apply").rows.length, 2, "同步中断不能清空待办");
  rail.dispatch({ type: "sync" });
  deepEqual(window.webContents.last("mochi:rail:health"), { status: "stale", lastSuccessAt: newerSuccess }, "页面重载仍能取回旧数据标记");
  equal(rail.syncHealth({ status: "live", lastSuccessAt: "2026-09-24T07:00:06.000Z" }), true, "恢复后撤销旧数据标记");
  equal(window.webContents.last("mochi:rail:health").status, "live", "恢复状态下发给桌宠");

  // 串屏：教室端快照不能进教师条，且必须整份拒绝、保留上一份。
  equal(rail.apply(snapshot({ surface: "classroom-board" })), false, "跨 surface 的推送必须被拒绝");
  const afterCross = window.webContents.last("mochi:rail:apply");
  equal(afterCross.heading, "学生预约", "被拒绝的推送不能改变已下发内容");
  equal(afterCross.rows.length, 2, "被拒绝的推送不能清空已有行");

  equal(rail.apply({ surface: "teacher-rail", rows: "nope" }), false, "畸形快照必须被拒绝");
  equal(rail.apply(undefined), false, "undefined 快照必须被拒绝");

  // 空列表也必须能下发（老师处理完最后一件事）。
  equal(rail.apply(snapshot({ rows: [], heading: "学生预约", detail: "暂无待处理" })), true, "空列表快照必须被接受");
  equal(window.bounds.height, 148, "空列表保留纸面页头页脚所需高度");
  equal(window.webContents.last("mochi:rail:apply").rows.length, 0, "空列表必须如实下发");

  // 隐藏期间来了新内容，重新显示时高度必须跟着新内容走——否则老师会看到被裁掉
  // 下半截的列表，而且没有任何提示。
  rail.setVisible(false);
  equal(window.visible, false, "隐藏后窗口不可见");
  rail.apply(snapshot({ rows: Array.from({ length: 4 }, (_value, index) => ({ id: `h${index}`, name: `学生${index}` })) }));
  equal(window.bounds.height, RAIL_WINDOW.maxHeight, "隐藏期间的高度必须已经按新内容更新并受上限约束");
  rail.setVisible(true);
  equal(window.bounds.height, RAIL_WINDOW.maxHeight, "重新显示后高度必须与新内容一致");
  rail.dispose();
}

{
  // 高度不得超过上限。
  const { rail } = makeRail();
  rail.apply(snapshot({
    rows: Array.from({ length: 50 }, (_value, index) => ({ id: `r${index}`, name: `学生${index}` })),
  }));
  rail.dispatch({ type: "toggle" });
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
  equal(rail.dispatch({ type: "acknowledge", id: "a1" }), false, "无真实收件 ID 的弹窗不得确认或关闭");
  equal(popupWindows().length, 1, "拒绝无收件 ID 的确认后仍显示当前提醒");
  rail.dispatch({ type: "dismiss", id: "a1" });
  equal(popup.webContents.last("mochi:rail:popup").subject, "李小红 · 高一（3）班", "确认后必须轮换到下一条");
  equal(popupWindows().length, 1, "轮换必须复用同一个窗口");
  deepEqual(actions, [], "关闭提醒不得转发收件确认");

  // 确认第二条 → 队列排空，窗口关闭。
  rail.dispatch({ type: "dismiss", id: "b2" });
  equal(popupWindows().length, 0, "队列排空后弹窗必须关闭");
  equal(actions.length, 0, "关闭提醒不发起收件确认");

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

{
  const actions = [];
  const { rail } = makeRail("teacher-rail", memoryStore(), (action) => actions.push(action));
  rail.attention({ ...attention("real-popup", "李明"), receiptMessageId: "raw.message-1" });
  equal(rail.dispatch({ type: "acknowledge", id: "real-popup" }), true, "真实收件允许确认动作");
  deepEqual(actions, [{ type: "acknowledge", id: "real-popup", receiptMessageId: "raw.message-1" }], "宿主收到真实 messageId");
  equal(popupWindows().length, 1, "确认 pending 时弹窗不提前关闭");
  equal(rail.feedback("real-popup", false, "relay failed"), true, "失败反馈送达当前弹窗");
  equal(popupWindows()[0].webContents.last("mochi:rail:receipt-feedback").message, "relay failed", "失败反馈含错误文案");
  equal(rail.dispatch({ type: "dismiss", id: "real-popup" }), true, "确认成功后宿主可 dismiss");
  equal(popupWindows().length, 0, "成功结果关闭弹窗");
  rail.dispose();
}

{
  const actions = [];
  const { rail } = makeRail("teacher-rail", memoryStore(), (action) => actions.push(action));
  rail.setVisible(true);
  rail.attention({ ...attention("pending", "李明"), receiptMessageId: "inbox.pending" });
  rail.attention(attention("queued", "王芳"));
  equal(rail.dispatch({ type: "acknowledge", id: "pending", receiptMessageId: "inbox.pending" }), true, "当前弹窗只签收一次");

  rail.setVisible(false);
  equal(popupWindows().length, 0, "显式隐藏必须关闭当前弹窗");
  equal(rail.dispatch({ type: "sync" }), true, "隐藏期间页面 sync 仍应被接受");
  equal(popupWindows().length, 0, "隐藏期间 sync 不得重新弹出提醒");
  rail.attention(attention("arrived-hidden", "赵敏"));
  equal(popupWindows().length, 0, "隐藏期间到达的新提醒只进入队列");

  rail.setVisible(true);
  equal(popupWindows().length, 1, "重新显示必须恢复一个队首弹窗");
  equal(popupWindows()[0].webContents.last("mochi:rail:popup").id, "pending", "恢复时保留原队首与签收状态");
  equal(actions.length, 1, "隐藏和恢复不得重复发送签收动作");
  rail.dispatch({ type: "dismiss", id: "pending" });
  equal(popupWindows()[0].webContents.last("mochi:rail:popup").id, "queued", "恢复后仍按原顺序轮换队列");
  rail.dispatch({ type: "hide" });
  equal(popupWindows().length, 0, "页面 hide 也必须关闭提醒");
  rail.dispatch({ type: "sync" });
  equal(popupWindows().length, 0, "页面 hide 后的 sync 不得绕过隐藏态");
  rail.setVisible(true);
  equal(popupWindows()[0].webContents.last("mochi:rail:popup").id, "queued", "托盘恢复后弹出剩余队首");
  equal(actions.filter((action) => action.type === "acknowledge").length, 1, "页面 hide 与托盘恢复不得重复签收");
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
  equal(rail.dispatch({ type: "drag-move", x: 300, y: 300 }), true, "未按下的移动不会移动桌宠");
  equal(window.getBounds().x, origin.x, "悬停不移动窗口");
  rail.dispatch({ type: "drag-start", x: 300, y: 300 });
  rail.dispatch({ type: "drag-move", x: 260, y: 340 });
  rail.dispatch({ type: "drag-end" });
  rail.dispatch({ type: "drag-move", x: 500, y: 500 });
  ok(store.saves.length >= 1, "拖动后位置必须保存");
  equal(store.saves[0].surface, "teacher-rail", "落盘必须带 surface");
  deepEqual(store.saves[0].position, { x: origin.x - 40 + RAIL_WINDOW.petSize - RAIL_WINDOW.width, y: origin.y + 40 }, "桌宠落盘时归一为展开面板坐标");

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

    store.savePetSize("teacher-rail", 132);
    store.saveVisible("teacher-rail", false);
    store.saveVisible("classroom-board", true);
    store.save("teacher-rail", { x: 110, y: 210 });
    const restoredVisibility = createRailPositionStore(filePath);
    equal(restoredVisibility.loadVisible("teacher-rail"), false, "重启后教师桌宠保持隐藏");
    equal(restoredVisibility.loadVisible("classroom-board"), true, "教师隐藏不影响教室端");
    deepEqual(restoredVisibility.load("teacher-rail"), { x: 110, y: 210 }, "位置更新保留可见性");
    const restarted = makeRail("teacher-rail", restoredVisibility);
    restarted.rail.syncHealth({ status: "live", lastSuccessAt: new Date().toISOString() });
    const hiddenWindow = railWindows()[0];
    equal(hiddenWindow.bounds.width, 132, "跨重启保留桌宠尺寸");
    hiddenWindow.emit("ready-to-show");
    equal(hiddenWindow.visible, false, "重启首帧保持已保存的隐藏状态");
    restarted.rail.setVisible(true);
    equal(createRailPositionStore(filePath).loadVisible("teacher-rail"), true, "显式恢复同样持久化");
    restarted.rail.dispose();

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
