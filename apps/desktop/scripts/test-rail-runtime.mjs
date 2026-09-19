#!/usr/bin/env node
/**
 * 在真实 Electron 主进程里跑常驻条模块，验证：
 *   1. 窗口形态（无边框 / 置顶 / 不进任务栏 / 宽度固定 / 高度跟行数）
 *   2. 快照整份替换 + 串屏防护 + 非法行丢弃
 *   3. 喊人弹窗：真窗口、去重、排队、点「我知道了」轮换到下一条
 *   4. 页面 → preload → 主进程的动作通道（open / hide / acknowledge）
 *   5. 拖走之后位置被记住
 *   6. dispose 之后窗口真的没了，且不触发「异常关闭」回调
 *
 * 只使用临时 Electron profile，不启动 DSH 宿主、不读 Mochi 数据、不联网。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const sourceRail = join(desktopRoot, "electron", "dsh", "rail.ts");
const sourcePages = join(desktopRoot, "electron", "dsh", "rail-pages.ts");
const sourcePreload = join(desktopRoot, "electron", "rail-preload.ts");
const compiledRail = join(desktopRoot, "dist-electron", "dsh", "rail.js");
const compiledPreload = join(desktopRoot, "dist-electron", "rail-preload.js");
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
const root = mkdtempSync(join(tmpdir(), "mochi-rail-runtime-"));
const fixturePath = join(root, "fixture.cjs");
const resultPath = join(root, "result.json");
const timeoutMs = 20_000;
let child = null;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitFor(predicate, description, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await wait(25);
  }
  throw new Error(`${description} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

function collectOutput(processHandle) {
  let output = "";
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-32_768);
  };
  processHandle.stdout.on("data", append);
  processHandle.stderr.on("data", append);
  return () => output;
}

async function terminate(processHandle) {
  if (processHandle === null || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  processHandle.kill("SIGTERM");
  await Promise.race([once(processHandle, "exit"), wait(5_000)]);
  if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill("SIGKILL");
}

function fixture() {
  // 注意：本夹具里只用双引号，避免与外层模板字符串冲突。
  return `
const assert = require("node:assert/strict");
const { app, BrowserWindow, ipcMain } = require("electron");
const { writeFileSync } = require("node:fs");
const { createMochiRail } = require(${JSON.stringify(compiledRail)});
const resultPath = ${JSON.stringify(resultPath)};
const IPC_ACTION = "mochi:rail:action";

const positions = new Map();
const saves = [];
const actions = [];
let closedCount = 0;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitFor(predicate, description, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await wait(20);
  }
  throw new Error(description + " timed out");
}

function liveWindows() {
  return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
}

function findByUrlFragment(fragment) {
  return liveWindows().find((window) => window.webContents.getURL().indexOf(fragment) !== -1) || null;
}

function popups() {
  return liveWindows().filter((window) => window.webContents.getURL().indexOf("popup") !== -1);
}

function readRailDom(window) {
  return window.webContents.executeJavaScript(
    "(function(){"
    + "var rows=document.querySelectorAll('.row');"
    + "return {rows:rows.length,"
    + "heading:document.getElementById('heading').textContent,"
    + "count:document.getElementById('count').textContent,"
    + "firstName:rows.length?rows[0].querySelector('.name').textContent:'',"
    + "firstTone:rows.length?rows[0].dataset.tone:''};})()",
  );
}

function readPopupDom(window) {
  return window.webContents.executeJavaScript(
    "(function(){return {title:document.getElementById('p-title').textContent,"
    + "subject:document.getElementById('p-subject').textContent,"
    + "detail:document.getElementById('p-detail').textContent};})()",
  );
}

function click(window, selector) {
  return window.webContents.executeJavaScript(
    "document.querySelector(" + JSON.stringify(selector) + ").click(); true",
  );
}

function row(id, name, tone) {
  return {
    id: id,
    seq: 0,
    name: name,
    meta: "高一（3）班 · 预约",
    note: "预约讲题：第 3 题",
    badge: "待处理",
    tone: tone || "attention",
    at: new Date().toISOString(),
  };
}

async function run() {
  app.on("window-all-closed", (event) => event.preventDefault());

  const rail = createMochiRail({
    surface: "teacher-rail",
    preload: ${JSON.stringify(compiledPreload)},
    store: {
      load: (surface) => positions.get(surface) || null,
      save: (surface, position) => { saves.push({ surface: surface, position: position }); positions.set(surface, position); },
    },
    onAction: (action) => { actions.push(action); },
    onClosed: () => { closedCount += 1; },
  });
  ipcMain.on(IPC_ACTION, (_event, action) => { rail.dispatch(action); });

  // ── 1. 窗口形态 ────────────────────────────────────────────────
  rail.setVisible(true);
  await waitFor(() => findByUrlFragment("teacher-rail") !== null, "rail window");
  const railWindow = findByUrlFragment("teacher-rail");
  const initialBounds = railWindow.getBounds();
  assert.equal(initialBounds.width, 336, "rail width must be fixed");
  assert.equal(railWindow.isAlwaysOnTop(), true, "rail must stay above normal windows");
  assert.equal(railWindow.isVisible(), true, "rail must be visible after setVisible(true)");
  assert.equal(railWindow.isResizable(), false, "rail must not be user-resizable");

  // ── 2. 快照整份替换 ────────────────────────────────────────────
  const applied = rail.apply({
    surface: "teacher-rail",
    heading: "学生预约",
    detail: "2 条待处理",
    updatedAt: new Date().toISOString(),
    rows: [row("m1", "张小明", "attention"), row("m2", "李小红", "attention")],
  });
  assert.equal(applied, true, "a well-formed snapshot must be applied");
  await waitFor(async () => (await readRailDom(railWindow)).rows === 2, "two rail rows");
  const dom = await readRailDom(railWindow);
  assert.equal(dom.heading, "学生预约");
  assert.equal(dom.count, "2");
  assert.equal(dom.firstName, "张小明");
  assert.equal(dom.firstTone, "attention");
  const grownBounds = railWindow.getBounds();
  assert.ok(grownBounds.height > initialBounds.height, "rail must grow with its row count");

  // 串屏：教室端的快照不能进教师条，且必须整份拒绝、保留上一份。
  const crossed = rail.apply({
    surface: "classroom-board",
    heading: "本课名单",
    detail: "不该出现",
    updatedAt: new Date().toISOString(),
    rows: [],
  });
  assert.equal(crossed, false, "a rail must reject another surface's snapshot");
  const afterCross = await readRailDom(railWindow);
  assert.equal(afterCross.heading, "学生预约", "a rejected snapshot must not change the rail");
  assert.equal(afterCross.rows, 2, "a rejected snapshot must not clear existing rows");

  // 非法输入整份丢弃。
  assert.equal(rail.apply(null), false);
  assert.equal(rail.apply({ surface: "teacher-rail", rows: "nope" }), false);
  assert.equal(rail.apply({ surface: "nope", rows: [] }), false);
  const afterGarbage = await readRailDom(railWindow);
  assert.equal(afterGarbage.rows, 2, "garbage must not disturb the current snapshot");

  // 非法行（缺 id）丢弃；越界 tone 归一为 neutral；seq 缺省按序补。
  rail.apply({
    surface: "teacher-rail",
    heading: "学生预约",
    detail: "1 条待处理",
    updatedAt: new Date().toISOString(),
    rows: [{ name: "没有 id 的行" }, { id: "m3", name: "王大力", tone: "not-a-tone" }],
  });
  await waitFor(async () => (await readRailDom(railWindow)).rows === 1, "one surviving row");
  const normalized = await readRailDom(railWindow);
  assert.equal(normalized.firstName, "王大力");
  assert.equal(normalized.firstTone, "neutral", "an unknown tone must fall back to neutral");

  // ── 3. 喊人弹窗 ────────────────────────────────────────────────
  const firstPayload = {
    id: "call-a1",
    kind: "call",
    title: "有人喊你",
    subject: "张小明 · 高一（3）班",
    detail: "预约讲题：第 3 题",
    at: new Date().toISOString(),
  };
  assert.equal(rail.attention(firstPayload), true, "a valid attention payload must queue");
  await waitFor(() => popups().length === 1, "popup window");
  const popup = popups()[0];
  await waitFor(async () => (await readPopupDom(popup)).subject !== "", "popup content");
  const popupDom = await readPopupDom(popup);
  assert.equal(popupDom.title, "有人喊你");
  assert.equal(popupDom.subject, "张小明 · 高一（3）班");
  assert.equal(popupDom.detail, "预约讲题：第 3 题");
  assert.equal(popup.isAlwaysOnTop(), true, "popup must stay above normal windows");

  // 去重：同一条重复推送不再弹。
  assert.equal(rail.attention(firstPayload), false, "the same attention id must not queue twice");
  assert.equal(rail.attention({ id: "", kind: "call" }), false, "an attention payload without id must be rejected");
  assert.equal(rail.attention({ id: "call-x", kind: "nope" }), false, "an unknown attention kind must be rejected");
  await wait(200);
  assert.equal(popups().length, 1, "rejected payloads must not open extra windows");

  // 排队：第二条在第一条未确认前不抢窗口，只入队。
  const secondPayload = {
    id: "call-b2",
    kind: "request",
    title: "有人喊你",
    subject: "李小红 · 高一（3）班",
    detail: "交作业：第 8 题订正",
    at: new Date().toISOString(),
  };
  assert.equal(rail.attention(secondPayload), true);
  await wait(200);
  assert.equal(popups().length, 1, "a queued popup must not open a second window");
  assert.equal((await readPopupDom(popups()[0])).subject, "张小明 · 高一（3）班", "the first popup stays until acknowledged");

  // 点「我知道了」：提交动作 + 轮换到下一条。这条同时验证页面 → preload → 主进程的动作通道。
  await click(popup, "#p-ack");
  await waitFor(() => actions.some((action) => action.type === "acknowledge" && action.id === "call-a1"), "acknowledge action");
  await waitFor(async () => (await readPopupDom(popups()[0])).subject === "李小红 · 高一（3）班", "second popup content");
  assert.equal(popups().length, 1, "acknowledging must reuse the same popup window");

  // 关闭第二条。
  await click(popups()[0], "#p-ack");
  await waitFor(() => actions.some((action) => action.type === "acknowledge" && action.id === "call-b2"), "second acknowledge");
  await waitFor(() => popups().length === 0, "popup closes after the queue drains");

  // ── 4. 点行 → 打开；点隐藏 → 收起 ──────────────────────────────
  await click(railWindow, ".row");
  await waitFor(() => actions.some((action) => action.type === "open" && action.id === "m3"), "row click action");

  await click(railWindow, "#hide");
  await waitFor(() => actions.some((action) => action.type === "hide"), "hide action");
  await waitFor(() => railWindow.isVisible() === false, "rail hides");
  assert.equal(actions.some((action) => action.type === "sync"), false, "sync must be consumed by the rail module, not forwarded");

  rail.setVisible(true);
  await waitFor(() => railWindow.isVisible() === true, "rail shows again");
  const restored = await readRailDom(railWindow);
  assert.equal(restored.rows, 1, "showing again must re-apply the retained snapshot");

  // ── 5. 位置记忆 ────────────────────────────────────────────────
  const moved = railWindow.getBounds();
  railWindow.setPosition(moved.x - 40, moved.y + 40);
  await waitFor(() => saves.length > 0, "position save");
  const last = saves[saves.length - 1];
  assert.equal(last.surface, "teacher-rail");
  assert.equal(last.position.x, moved.x - 40);
  assert.equal(last.position.y, moved.y + 40);

  // ── 6. dispose ─────────────────────────────────────────────────
  rail.dispose();
  await waitFor(() => liveWindows().length === 0, "all rail windows destroyed");
  assert.equal(closedCount, 0, "an explicit dispose must not look like an unexpected close");

  writeFileSync(resultPath, JSON.stringify({
    initialWidth: initialBounds.width,
    grownHeight: grownBounds.height,
    initialHeight: initialBounds.height,
    saves: saves.length,
  }));
}

app.whenReady().then(run).then(
  () => app.exit(0),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.destroy();
    }
    app.exit(1);
  },
);
`;
}

try {
  assert.equal(existsSync(electronBin), true, "Rail runtime test requires the installed Electron binary");
  assert.equal(existsSync(compiledRail), true, "Rail runtime test requires npm run build first");
  assert.equal(existsSync(compiledPreload), true, "Rail runtime test requires the compiled rail preload");
  for (const source of [sourceRail, sourcePages, sourcePreload]) {
    assert.ok(
      statSync(compiledRail).mtimeMs >= statSync(source).mtimeMs,
      `Rail runtime test requires a current compiled rail module; run npm run build first (${source})`,
    );
  }
  writeFileSync(fixturePath, fixture());
  child = spawn(
    electronBin,
    [fixturePath, "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${join(root, "electron-user-data")}`],
    {
      cwd: desktopRoot,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: join(root, "home"),
        TMPDIR: join(root, "tmp"),
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = collectOutput(child);
  await waitFor(() => {
    if (existsSync(resultPath)) return true;
    if (child !== null && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Rail fixture exited before writing a result: ${output()}`);
    }
    return false;
  }, "rail runtime result");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(result.initialWidth, 336);
  assert.ok(result.grownHeight > result.initialHeight, "rail must grow with content");
  assert.ok(result.saves > 0, "a moved rail must persist its position");
  await waitFor(async () => child === null || child.exitCode !== null, "fixture exit");
  console.log(`[test-rail-runtime] PASS: 窗口形态、整份替换、串屏防护、弹窗去重与排队、动作通道、位置记忆、dispose 均已验证（位置落盘 ${result.saves} 次）。`);
} catch (error) {
  console.error(`[test-rail-runtime] FAIL: ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await terminate(child);
  rmSync(root, { recursive: true, force: true });
}
