#!/usr/bin/env node
/**
 * 在真实 Electron 主进程里跑常驻条模块，验证：
 *   1. 窗口形态（无边框 / 置顶 / 不进任务栏 / 宠物展开 / 高度跟行数）
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const sourceRail = join(desktopRoot, "electron", "dsh", "rail.ts");
const sourcePages = join(desktopRoot, "electron", "dsh", "rail-pages.ts");
const sourcePreload = join(desktopRoot, "electron", "rail-preload.ts");
const compiledRail = join(desktopRoot, "dist-electron", "dsh", "rail.js");
const compiledModel = join(desktopRoot, "dist-electron", "dsh", "rail-model.js");
const compiledPreload = join(desktopRoot, "dist-electron", "rail-preload.js");
// Resolving the package returns Electron's real executable on each platform;
// the npm .bin shim is a shell script on macOS/Linux and a .cmd file on Windows.
const electronBin = require("electron");
const root = mkdtempSync(join(tmpdir(), "mochi-rail-runtime-"));
const screenshotRootOverride = process.env.MOCHI_RAIL_SCREENSHOT_ROOT?.trim();
const visualRoot = screenshotRootOverride
  ? resolve(screenshotRootOverride)
  : mkdtempSync(join(tmpdir(), "mochi-rail-visual-"));
if (screenshotRootOverride) mkdirSync(visualRoot, { recursive: true });
const screenshotNames = ["teacher-pet.png", "teacher-todo.png", "classroom-board-top.png", "classroom-board-overflow.png"];
const petScreenshot = join(visualRoot, "teacher-pet.png");
const expandedScreenshot = join(visualRoot, "teacher-todo.png");
const boardTopScreenshot = join(visualRoot, "classroom-board-top.png");
const boardOverflowScreenshot = join(visualRoot, "classroom-board-overflow.png");
const fixturePath = join(root, "fixture.cjs");
const resultPath = join(root, "result.json");
// The complete native suite includes multiple windows and six captures.
// Keep each interaction at its existing 8s bound; give Windows CI time for the whole suite.
const timeoutMs = 120_000;
let child = null;
let childOutput = () => "";

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
      if (error?.fatal) throw error;
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
const { once } = require("node:events");
const { app, BrowserWindow, ipcMain, nativeTheme } = require("electron");
nativeTheme.themeSource = "light";
console.log("[rail-fixture] process ready");
const { readFileSync, writeFileSync } = require("node:fs");
const { createMochiRail } = require(${JSON.stringify(compiledRail)});
const { classroomRailSnapshot, teacherRailSnapshot, newAttentionPayloads } = require(${JSON.stringify(compiledModel)});
const resultPath = ${JSON.stringify(resultPath)};
const petScreenshot = ${JSON.stringify(petScreenshot)};
const expandedScreenshot = ${JSON.stringify(expandedScreenshot)};
const boardTopScreenshot = ${JSON.stringify(boardTopScreenshot)};
const boardOverflowScreenshot = ${JSON.stringify(boardOverflowScreenshot)};
const IPC_ACTION = "mochi:rail:action";

const positions = new Map();
const saves = [];
const actions = [];
let closedCount = 0;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitFor(predicate, description, timeoutMs) {
  console.log("[rail-fixture] wait " + description);
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
  return execute(window,
    "(function(){"
    + "var rows=document.querySelectorAll('#list .row');"
    + "return {rows:rows.length,expanded:document.body.dataset.expanded,viewportWidth:innerWidth,"
    + "heading:document.getElementById('heading').textContent,"
    + "count:document.getElementById('count').textContent,"
    + "countHidden:document.getElementById('count').hidden,"
    + "toggleLabel:document.getElementById('toggle').getAttribute('aria-label'),"
    + "syncStatus:document.body.dataset.sync,"
    + "syncLabel:document.getElementById('updated').textContent,"
    + "staleDot:getComputedStyle(document.getElementById('toggle'),'::after').content,"
    + "toggleCount:document.getElementById('toggle').dataset.count,"
    + "toggleBadge:document.getElementById('pet-count').textContent,"
    + "toggleBadgeDisplay:getComputedStyle(document.getElementById('pet-count-group')).display,"
    + "petAttention:document.getElementById('toggle').dataset.attention,"
    + "petPulse:document.getElementById('toggle').dataset.pulse,"
    + "petGlyphAnimation:getComputedStyle(document.querySelector('.pet__glyph')).animationName,"
    + "petBodyFill:getComputedStyle(document.querySelector('.expressive-orb__body')).fill,"
    + "petHasLaptop:document.querySelector('.pet__laptop rect').getAttribute('fill')==='#4A3826',"
    + "petEyesInFace:(function(){var e=document.querySelector('.expressive-orb__face').getBoundingClientRect(),o=document.querySelector('.pet__orb').getBoundingClientRect();return e.left>o.left&&e.right<o.right&&e.top>o.top&&e.bottom<o.bottom})(),"
    + "toggleRect:(function(){var r=document.getElementById('toggle').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,cx:r.left+r.width/2,cy:r.top+r.height/2}})(),"
    + "petRect:(function(){var r=document.querySelector('.pet').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})(),"
    + "bodyColor:getComputedStyle(document.body).color,"
    + "shellBackground:getComputedStyle(document.querySelector('.shell')).backgroundColor,"
    + "shellBackdrop:getComputedStyle(document.querySelector('.shell')).backdropFilter,"
    + "firstName:rows.length?rows[0].querySelector('.name').textContent:'',"
    + "contextVisible:rows.length?!!rows[0].querySelector('.context')&&rows[0].querySelector('.context').textContent.indexOf('学生希望：')===0:false,"
    + "firstTone:rows.length?rows[0].dataset.tone:'',"
    + "firstRowHeight:rows.length?rows[0].getBoundingClientRect().height:0,"
    + "visibleRows:Array.prototype.filter.call(rows,function(row){var r=row.getBoundingClientRect(),l=document.getElementById('list').getBoundingClientRect();return r.top>=l.top&&r.bottom<=l.bottom}).length};})()",
  );
}

function readPopupDom(window) {
  return execute(window,
    "(function(){return {title:document.getElementById('p-title').textContent,"
    + "subject:document.getElementById('p-subject').textContent,"
    + "detail:document.getElementById('p-detail').textContent,"
    + "feedback:document.getElementById('p-feedback').textContent,"
    + "buttonText:document.getElementById('p-ack').textContent,"
    + "buttonDisabled:document.getElementById('p-ack').disabled};})()",
  );
}

function readBoardDom(window) {
  return execute(window,
    "(function(){var rows=document.querySelectorAll('.row'),list=document.getElementById('list'),last=rows[rows.length-1];"
    + "var f=rows[0].getBoundingClientRect(),b=last.getBoundingClientRect(),l=list.getBoundingClientRect();"
    + "return {surface:document.body.dataset.surface,expanded:document.body.dataset.expanded,"
    + "count:document.getElementById('count').textContent,detail:document.getElementById('detail').textContent,"
    + "rows:rows.length,first:rows[0].querySelector('.name').textContent,penultimate:rows[rows.length-2].querySelector('.name').textContent,"
    + "last:last.querySelector('.name').textContent,lastBadge:last.querySelector('.badge').textContent,"
    + "lastLabel:last.getAttribute('aria-label'),firstInView:f.top>=l.top&&f.bottom<=l.bottom,"
    + "lastInView:b.top>=l.top&&b.bottom<=l.bottom,scrollTop:list.scrollTop};})()",
  );
}

async function waitForPaint(window) {
  window.show();
  window.focus();
  return bounded(execute(window,
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  ), "animation frame " + window.getTitle());
}

function execute(window, source) {
  return bounded(window.webContents.executeJavaScript(source), "renderer " + source.slice(0, 100));
}

async function bounded(operation, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " did not finish in 8 seconds")), 8000);
    })]);
  } finally { clearTimeout(timer); }
}

async function capture(window, path) {
  console.log("[rail-fixture] capture " + path);
  window.show();
  window.focus();
  const image = await bounded(window.webContents.capturePage(undefined, { stayAwake: true }), "capture " + path);
  writeFileSync(path, image.toPNG());
}

async function click(window, selector) {
  if (selector !== "#p-ack" && selector !== "#hide") {
    return execute(window, "document.querySelector(" + JSON.stringify(selector) + ").click(); true");
  }
  const point = await execute(window,
    "(function(){var node=document.querySelector(" + JSON.stringify(selector) + ");if(!node)throw new Error('missing click target');var box=node.getBoundingClientRect();return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};})()",
  );
  window.show();
  window.focus();
  clickAt(window, point.x, point.y);
}

function clickAt(window, x, y) {
  window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

function row(id, name, tone) {
  return {
    id: id,
    seq: 0,
    name: name,
    meta: "高一（3）班 · 预约",
    note: "预约讲题：第 3 题",
    context: "学生希望：第八节晚自习",
    badge: "待处理",
    actionRequired: true,
    tone: tone || "attention",
    at: new Date().toISOString(),
  };
}

async function run() {
  console.log("[rail-fixture] app ready");
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
  let activeRail = rail;
  ipcMain.on(IPC_ACTION, (_event, action) => { activeRail.dispatch(action); });

  // ── 1. 窗口形态 ────────────────────────────────────────────────
  rail.setVisible(true);
  await waitFor(() => findByUrlFragment("teacher-rail") !== null, "rail window");
  const railWindow = findByUrlFragment("teacher-rail");
  const initialBounds = railWindow.getBounds();
  assert.equal(initialBounds.width, 96, "teacher rail starts as a compact pet");
  assert.equal(railWindow.isAlwaysOnTop(), true, "rail must stay above normal windows");
  await waitFor(() => railWindow.isVisible() === true, "rail must be visible after setVisible(true)");
  assert.equal(railWindow.isResizable(), false, "rail must not be user-resizable");
  await waitFor(async () => (await readRailDom(railWindow)).toggleLabel === "展开 Mochi 待办，尚未同步", "accessible pet toggle before the first poll");
  const compactSurface = await execute(railWindow, "({shell:getComputedStyle(document.querySelector('.shell')).backgroundColor,border:getComputedStyle(document.querySelector('.shell')).borderTopWidth,toggle:getComputedStyle(document.querySelector('#toggle')).backgroundColor})");
  assert.equal(compactSurface.shell, "rgba(0, 0, 0, 0)", "compact pet has no background panel");
  assert.equal(compactSurface.border, "0px", "compact pet has no frame");
  assert.equal(compactSurface.toggle, "rgba(0, 0, 0, 0)", "compact pet button remains transparent");
  const resizeBox = await execute(railWindow, "(function(){var e=document.querySelector('#pet-resize');var r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,text:e.textContent,background:getComputedStyle(e).backgroundColor}})()");
  assert.equal(resizeBox.text, "", "resize corner has no visible label or handle");
  assert.equal(resizeBox.background, "rgba(0, 0, 0, 0)", "resize corner remains transparent");
  railWindow.focus();
  railWindow.webContents.sendInputEvent({type:"mouseDown",x:resizeBox.x,y:resizeBox.y,globalX:initialBounds.x+resizeBox.x,globalY:initialBounds.y+resizeBox.y,button:"left",clickCount:1});
  await wait(40);
  railWindow.webContents.sendInputEvent({type:"mouseMove",x:resizeBox.x+4,y:resizeBox.y+4,globalX:initialBounds.x+resizeBox.x+4,globalY:initialBounds.y+resizeBox.y+4,modifiers:["leftButtonDown"],movementX:4,movementY:4});
  await waitFor(() => railWindow.getBounds().width > 96, "native corner drag resizes pet through preload");
  railWindow.webContents.sendInputEvent({type:"mouseUp",x:resizeBox.x+4,y:resizeBox.y+4,button:"left",clickCount:1});
  assert.equal((await readRailDom(railWindow)).expanded, "false", "resize does not open the pending panel");
  rail.dispatch({type:"resize",size:96});
  await waitFor(() => railWindow.getBounds().width === 96, "restore test size");
  await waitFor(async () => {
    const dom = await readRailDom(railWindow);
    return dom.toggleRect.left === 0 && dom.toggleRect.right === 96;
  }, "renderer catches up with restored native size");
  const initialDom = await readRailDom(railWindow);
  assert.equal(initialDom.expanded, "false", "compact layout is selected in the body markup");
  assert.equal(initialDom.toggleRect.left, 0, "compact pet button begins at the transparent window edge");
  assert.equal(initialDom.toggleRect.right, initialBounds.width, "compact pet button fills the transparent window");
  assert.ok(initialDom.petRect.left >= 0 && initialDom.petRect.right <= initialBounds.width,
    "the vector pet stays inside the transparent window at its native size");
  assert.equal((await readRailDom(railWindow)).petGlyphAnimation, "none", "idle laptop glyphs stay static in Chromium");
  await execute(railWindow, "window.__dragTrace=[];['pointerdown','pointermove','pointerup','click','lostpointercapture'].forEach(type=>document.addEventListener(type,e=>window.__dragTrace.push({type,x:e.screenX,y:e.screenY,id:e.pointerId,buttons:e.buttons})))");
  railWindow.focus();
  railWindow.webContents.sendInputEvent({ type: "mouseDown", x: 36, y: 36, globalX: initialBounds.x + 36, globalY: initialBounds.y + 36, button: "left", clickCount: 1 });
  await wait(40);
  railWindow.webContents.sendInputEvent({ type: "mouseMove", x: 8, y: 56, globalX: initialBounds.x + 8, globalY: initialBounds.y + 56, modifiers: ["leftButtonDown"], movementX: -28, movementY: 20 });
  await wait(80);
  railWindow.webContents.sendInputEvent({ type: "mouseUp", x: 36, y: 36, globalX: initialBounds.x + 8, globalY: initialBounds.y + 56, button: "left", clickCount: 1 });
  await waitFor(() => railWindow.getBounds().x !== initialBounds.x, "dragging the pet itself moves its native window");
  assert.equal((await readRailDom(railWindow)).expanded, "false", "drag release must not expand the pet: " + JSON.stringify(await execute(railWindow, "window.__dragTrace")));
  railWindow.setPosition(initialBounds.x, initialBounds.y);
  const applied = rail.apply({
    surface: "teacher-rail",
    heading: "学生预约",
    detail: "2 条待处理",
    updatedAt: new Date().toISOString(),
    rows: [row("m1", "张小明", "attention"), row("m2", "李小红", "attention")],
  });
  assert.equal(applied, true, "a well-formed snapshot must be applied");
  await waitFor(async () => (await readRailDom(railWindow)).rows === 2, "two rail rows");
  await waitFor(async () => (await readRailDom(railWindow)).contextVisible === true, "appointment context is visible");
  rail.syncHealth({ status: "live", lastSuccessAt: new Date().toISOString() });
  await waitFor(async () => (await readRailDom(railWindow)).syncStatus === "live", "successful poll clears the waiting state");
  assert.equal((await readRailDom(railWindow)).syncLabel, "已同步", "live rail does not imply the content changed this minute");
  const lastSuccessAt = new Date().toISOString();
  rail.syncHealth({ status: "stale", lastSuccessAt });
  await waitFor(async () => (await readRailDom(railWindow)).syncStatus === "stale", "failed poll marks preserved rows stale");
  const staleDom = await readRailDom(railWindow);
  assert.equal(staleDom.rows, 2, "offline state preserves the actionable rows");
  assert.match(staleDom.toggleLabel, /同步中断，待办可能不是最新/u, "collapsed pet announces stale state");
  assert.match(staleDom.syncLabel, /同步中断/u, "expanded footer will disclose interrupted sync");
  assert.notEqual(staleDom.staleDot, "none", "collapsed pet gets a static warning dot");
  rail.syncHealth({ status: "live", lastSuccessAt: new Date().toISOString() });
  await waitFor(async () => (await readRailDom(railWindow)).syncStatus === "live", "recovery removes stale state");
  assert.doesNotMatch((await readRailDom(railWindow)).toggleLabel, /同步中断/u, "recovery removes stale accessible label");
  const compactDom = await readRailDom(railWindow);
  assert.equal(compactDom.toggleCount, "2", "compact pet signals pending requests");
  assert.equal(compactDom.toggleBadge, "2", "pending count badge is rendered on the compact pet");
  assert.equal(compactDom.toggleBadgeDisplay, "block", "pending badge is visible in compact mode");
  assert.equal(compactDom.petAttention, "true", "pending requests keep the unread signal visible");
  assert.equal(compactDom.petPulse, "false", "an existing queue does not shake the pet on first render");
  assert.equal(compactDom.petGlyphAnimation, "none", "laptop glyphs stay static while requests are pending");
  assert.equal(compactDom.petBodyFill, "rgb(160, 106, 50)", "compact pet uses Mochi's caramel body color");
  assert.equal(compactDom.petHasLaptop, true, "compact pet renders Mochi's laptop");
  assert.equal(compactDom.petEyesInFace, true, "animated eyes remain positioned on the orb's face");
  railWindow.show();
  railWindow.focus();
  railWindow.webContents.debugger.attach("1.3");
  try {
    await railWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await waitFor(async () => !(await execute(railWindow, "matchMedia('(prefers-reduced-motion: reduce)').matches")), "normal motion preference applies");
    assert.equal(await execute(railWindow, "document.querySelector('.pet__orb').dataset.engine"), "bloub", "native pet uses the shared engine");
    const moving = await execute(railWindow, "document.querySelector('.pet__orb').innerHTML");
    await waitFor(async () => (await execute(railWindow, "document.querySelector('.pet__orb').innerHTML")) !== moving, "the native engine advances");
    await railWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await waitFor(async () => await execute(railWindow, "matchMedia('(prefers-reduced-motion: reduce)').matches"), "reduced motion preference applies");
    const reducedMotion = await execute(railWindow, "['.pet__orb','.expressive-orb__face','.pet__laptop','.pet__glyph'].map(function(selector){return getComputedStyle(document.querySelector(selector)).animationName})");
    assert.deepEqual(reducedMotion, ["none", "none", "none", "none"], "reduced motion stops all pet loops in Chromium");
    await waitFor(async () => (await execute(railWindow, "document.querySelector('.pet__orb').dataset.motionPaused")) === "true", "engine observes reduced motion");
    const frozen = await execute(railWindow, "document.querySelector('.pet__orb').innerHTML");
    await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal(await execute(railWindow, "document.querySelector('.pet__orb').innerHTML"), frozen, "reduced motion freezes SVG geometry");
    await railWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await waitFor(async () => !(await execute(railWindow, "matchMedia('(prefers-reduced-motion: reduce)').matches")), "normal motion returns before the arrival pulse");
    rail.apply({ surface: "teacher-rail", heading: "学生预约", detail: "3 条待处理", updatedAt: new Date().toISOString(), rows: [row("m1", "张小明"), row("m2", "李小红"), row("m3", "王同学")] });
    await waitFor(async () => (await readRailDom(railWindow)).rows === 3, "new request appears in rail");
    assert.equal((await readRailDom(railWindow)).petPulse, "true", "a newly arriving request triggers one pet pulse");
    assert.equal(await execute(railWindow, "document.querySelector('.pet__orb').dataset.state"), "alert", "new requests replay the real attention sequence");
  } finally {
    await railWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
    railWindow.webContents.debugger.detach();
  }
  rail.apply({ surface: "teacher-rail", heading: "学生预约", detail: "2 条待处理", updatedAt: new Date().toISOString(), rows: [row("m1", "张小明"), row("m2", "李小红")] });
  await waitFor(async () => (await readRailDom(railWindow)).rows === 2, "request removal returns to baseline");
  assert.equal((await readRailDom(railWindow)).petPulse, "false", "an unchanged queue does not repeat the pulse");
  await wait(60);
  // Content-only fixture evidence: capturePage does not include the Windows
  // desktop compositor, so these PNGs cannot prove DWM transparency.
  await capture(railWindow, petScreenshot);
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32" });
  const fixedRightEdge = initialBounds.x + initialBounds.width;
  const originalSetBounds = railWindow.setBounds;
  const nativeSetBounds = originalSetBounds.bind(railWindow);
  const boundsRequests = [];
  railWindow.setBounds = (bounds, animate) => {
    boundsRequests.push({ ...bounds });
    return nativeSetBounds(bounds, animate);
  };
  try {
    await click(railWindow, "#toggle");
    await waitFor(() => railWindow.getBounds().width === 336 && railWindow.getBounds().height === 372, "expanded teacher rail");
    const expandedToggle = (await readRailDom(railWindow)).toggleRect;
    const originalPetX = 336 - initialBounds.width / 2;
    assert.ok(Math.abs(expandedToggle.cx - originalPetX) <= 2, "expanded toggle stays under the compact pet's original physical x coordinate: " + JSON.stringify({expandedToggle,originalPetX,styles:await execute(railWindow, "({size:getComputedStyle(document.documentElement).getPropertyValue('--pet-size'),padding:getComputedStyle(document.querySelector('header')).paddingInlineEnd})")}));
    assert.ok(Math.abs(expandedToggle.cx - (336 - initialBounds.width / 2)) <= 2, "expanded toggle sits at the compact pet's physical click position");
    clickAt(railWindow, originalPetX, expandedToggle.cy);
    await waitFor(() => railWindow.getBounds().width === 96, "physical click at the compact pet position collapses the rail");
    await click(railWindow, "#toggle");
    await waitFor(() => railWindow.getBounds().width === 336 && railWindow.getBounds().height === 372, "expanded rail after physical continuity click");
    rail.dispatch({ type: "toggle" });
    await waitFor(() => railWindow.getBounds().width < 336, "collapse starts before its reversal");
    await wait(24);
    const widthAtReversal = railWindow.getBounds().width;
    assert.ok(widthAtReversal > 96 && widthAtReversal < 336, "reversal begins while the rail is still moving");
    const firstReversalRequest = boundsRequests.length;
    rail.dispatch({ type: "toggle" });
    await waitFor(() => boundsRequests.length > firstReversalRequest, "retargeted spring produces its next native frame");
    assert.ok(boundsRequests[firstReversalRequest].width <= widthAtReversal,
      "the first frame after reversal carries collapse velocity instead of snapping direction");
    await waitFor(() => railWindow.getBounds().width === 336 && railWindow.getBounds().height === 372, "reversed expansion settles");
    assert.equal(railWindow.getBounds().x + railWindow.getBounds().width, fixedRightEdge, "rapid reversal keeps the same right edge");
    rail.dispatch({ type: "toggle", reducedMotion: true });
    assert.equal(railWindow.getBounds().width, 96, "reduced motion applies collapse immediately");
    rail.dispatch({ type: "toggle", reducedMotion: true });
    assert.equal(railWindow.getBounds().width, 336, "reduced motion applies expansion immediately");
    assert.equal(railWindow.getBounds().x + railWindow.getBounds().width, fixedRightEdge,
      "reduced-motion toggles keep the anchored right edge");
  } finally {
    railWindow.setBounds = originalSetBounds;
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
  const reloadFinished = once(railWindow.webContents, "did-finish-load");
  railWindow.webContents.reload();
  await reloadFinished;
  await waitFor(async () => (await readRailDom(railWindow)).toggleLabel === "收起 Mochi 待办，2 条待处理", "reload restores expanded teacher rail");
  assert.equal(railWindow.getBounds().width, 336, "reload preserves expanded native bounds");
  assert.equal((await readRailDom(railWindow)).visibleRows, 2, "reload keeps expanded list visible");
  await click(railWindow, "#toggle");
  await waitFor(() => railWindow.getBounds().width === 96, "first click after reload collapses main and page together");
  await click(railWindow, "#toggle");
  await waitFor(() => railWindow.getBounds().width === 336, "rail reopens after reload regression");
  await waitFor(async () => (await readRailDom(railWindow)).shellBackground === "rgb(246, 243, 236)",
    "opaque teacher shell finishes its color transition");
  rail.setSoundEnabled(true);
  await waitFor(async () => await execute(railWindow, "document.body.dataset.uiSound === 'on'"), "native sound enabled");
  rail.setSoundEnabled(false);
  await waitFor(async () => await execute(railWindow, "document.body.dataset.uiSound === 'off'"), "native sound muted");
  await capture(railWindow, expandedScreenshot);
  nativeTheme.themeSource = "dark";
  await waitFor(async () => (await readRailDom(railWindow)).shellBackground === "rgb(36, 35, 32)", "dark teacher paper");
  await capture(railWindow, expandedScreenshot.replace("teacher-todo", "teacher-todo-dark"));
  nativeTheme.themeSource = "light";
  await waitFor(async () => (await readRailDom(railWindow)).shellBackground === "rgb(246, 243, 236)", "return to light paper");


  // ── 2. 快照整份替换 ────────────────────────────────────────────
  const dom = await readRailDom(railWindow);
  assert.equal(dom.heading, "学生预约");
  assert.equal(dom.count, "2");
  assert.equal(dom.firstName, "张小明");
  assert.equal(dom.firstTone, "attention");
  assert.equal(dom.bodyColor, "rgb(52, 51, 47)", "ink text color resolves from the palette");
  assert.equal(dom.shellBackground, "rgb(246, 243, 236)", "teacher shell uses an opaque ivory surface");
  assert.equal(dom.shellBackdrop, "none", "teacher shell has no plastic-looking blur");
  assert.ok(dom.firstRowHeight > 0, "expanded todo rows are visibly laid out");
  assert.equal(dom.visibleRows, 2, "expanded panel shows both sample todos without clipping");
  const grownBounds = railWindow.getBounds();
  assert.ok(grownBounds.height > initialBounds.height, "rail must grow with its row count");

  const crowdedRows = Array.from({ length: 49 }, (_value, index) => row('crowded-' + index, '学生' + index))
    .concat([{ ...row("overflow", "另有 11 条学生请求"), actionRequired: false }]);
  rail.apply({
    surface: "teacher-rail", heading: "待办 · 60 位学生", detail: "共 60 条", actionRequiredCount: 60,
    rows: crowdedRows,
  });
  await waitFor(async () => (await readRailDom(railWindow)).count === "60", "full pending count after visible row cap");
  assert.equal((await readRailDom(railWindow)).toggleCount, "9+", "visual badge caps at nine plus");
  assert.equal((await readRailDom(railWindow)).toggleLabel, "收起 Mochi 待办，60 条待处理", "accessible count keeps the real total");
  await click(railWindow, "#toggle");
  await waitFor(async () => (await readRailDom(railWindow)).toggleLabel === "展开 Mochi 待办，60 条待处理", "collapse keeps full accessible count");
  rail.apply({ surface: "teacher-rail", heading: "待办 · 61 位学生", detail: "共 61 条", actionRequiredCount: 61, rows: crowdedRows });
  await waitFor(async () => (await readRailDom(railWindow)).toggleLabel === "展开 Mochi 待办，61 条待处理", "hidden pending count reaches the compact pet");
  assert.equal((await readRailDom(railWindow)).petPulse, "true", "an arrival beyond the row cap still pulses the compact pet once");
  await click(railWindow, "#toggle");
  rail.apply({ surface: "teacher-rail", heading: "学生预约", detail: "2 条待处理", actionRequiredCount: 2,
    rows: [row("m1", "张小明", "attention"), row("m2", "李小红", "attention")] });
  await waitFor(async () => (await readRailDom(railWindow)).count === "2", "original fixture restored");

  railWindow.webContents.debugger.attach("1.3");
  try {
    await railWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
    await wait(100);
    const highContrast = await execute(railWindow, "({matches:matchMedia('(prefers-contrast: more)').matches,shell:getComputedStyle(document.querySelector('.shell')).backgroundColor,blur:getComputedStyle(document.querySelector('.shell')).backdropFilter,toggle:getComputedStyle(document.querySelector('#toggle')).backgroundColor})");
    assert.equal(highContrast.matches, true, "Chromium media emulation enables high contrast");
    assert.equal(highContrast.shell, "rgb(246, 243, 236)", "high contrast uses a solid teacher shell");
    assert.equal(highContrast.blur, "none", "high contrast removes translucent shell blur");
    assert.equal(highContrast.toggle, "rgb(246, 243, 236)", "expanded high-contrast toggle uses a solid control fill");
    await click(railWindow, "#toggle");
    await waitFor(async () => (await readRailDom(railWindow)).toggleLabel.startsWith("展开"), "collapsed high-contrast pet");
    const compactContrast = await execute(railWindow, "({shell:getComputedStyle(document.querySelector('.shell')).backgroundColor,border:getComputedStyle(document.querySelector('.shell')).borderTopWidth,toggle:getComputedStyle(document.querySelector('#toggle')).backgroundColor,blur:getComputedStyle(document.querySelector('#toggle')).backdropFilter})");
    assert.equal(compactContrast.shell, "rgba(0, 0, 0, 0)", "collapsed high-contrast pet stays frameless");
    assert.equal(compactContrast.border, "0px", "collapsed high-contrast pet has no border");
    assert.equal(compactContrast.toggle, "rgba(0, 0, 0, 0)", "collapsed high-contrast toggle stays transparent");
    assert.equal(compactContrast.blur, "none", "collapsed high-contrast toggle has no blur");
    await click(railWindow, "#toggle");
    await waitFor(async () => (await readRailDom(railWindow)).toggleLabel.startsWith("收起"), "return to expanded rail after contrast test");
  } finally {
    await railWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
    railWindow.webContents.debugger.detach();
  }

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
  await waitFor(() => railWindow.getBounds().width === 336, "no-count rail reaches expanded native width");
  await waitFor(async () => {
    const dom = await readRailDom(railWindow);
    return dom.expanded === "true" && dom.viewportWidth === 336;
  }, "no-count rail reaches expanded renderer width");
  const normalized = await readRailDom(railWindow);
  assert.equal(normalized.firstName, "王大力");
  assert.equal(normalized.firstTone, "neutral", "an unknown tone must fall back to neutral");
  assert.equal(normalized.toggleCount, "", "the expanded header layout also works without a pending-count badge");
  assert.equal(normalized.petAttention, "false", "idle pet leaves attention motion when no action is pending");
  assert.equal(normalized.count, "0", "historical rows do not inflate the pending pill");
  assert.equal(normalized.countHidden, true, "the pending pill is hidden when only historical rows remain");
  const noCountBounds = railWindow.getBounds();
  assert.ok(Math.abs(normalized.toggleRect.cx - (336 - initialBounds.width / 2)) <= 2,
    "without a count, the toggle remains at the compact pet's physical x coordinate: " + JSON.stringify({ bounds: noCountBounds, expanded: normalized.expanded, viewportWidth: normalized.viewportWidth, toggleRect: normalized.toggleRect }));
  assert.ok(Math.abs(noCountBounds.x + normalized.toggleRect.cx - (fixedRightEdge - initialBounds.width / 2)) <= 2,
    "without a count, the toggle keeps its screen position: " + JSON.stringify({ bounds: noCountBounds, toggleRect: normalized.toggleRect, fixedRightEdge }));
  clickAt(railWindow, 336 - initialBounds.width / 2, normalized.toggleRect.cy);
  await waitFor(() => railWindow.getBounds().width === 96, "physical click collapses the rail without a count badge");
  await click(railWindow, "#toggle");
  await waitFor(() => railWindow.getBounds().width === 336, "rail re-expands after no-count coordinate click");

  // 用真实 Tab 键聚焦行；快照刷新后，同一行仍在时保留焦点与滚动位置。
  const focusRows = [{ id: "m3", name: "王大力", note: "学习记录已归档", badge: "已完成", actionRequired: false, tone: "neutral" }].concat(
    Array.from({ length: 16 }, (_unused, index) => ({ id: "history-" + index, name: "历史记录 " + index, note: "学习记录已归档", badge: "已完成", actionRequired: false, tone: "neutral" })),
  );
  rail.apply({ surface: "teacher-rail", heading: "待办 · 暂无", detail: "没有待处理事项", updatedAt: new Date().toISOString(), rows: focusRows });
  let focusLayout;
  try {
    await waitFor(async () => {
      focusLayout = await execute(railWindow, "({expanded:document.body.dataset.expanded,rows:document.querySelectorAll('#list .row').length,scrollable:document.getElementById('list').scrollHeight-document.getElementById('list').clientHeight})");
      return focusLayout.expanded === "true" && focusLayout.rows === 17 && focusLayout.scrollable >= 48 && railWindow.getBounds().height === 472;
    }, "scrollable focus fixture has settled");
  } catch (error) {
    throw new Error(String(error) + ": " + JSON.stringify({ layout: focusLayout, bounds: railWindow.getBounds() }));
  }
  await execute(railWindow, "document.getElementById('toggle').focus(); true");
  railWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
  railWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
  railWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "TAB" });
  railWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "TAB" });
  await waitFor(async () => (await execute(railWindow, "document.activeElement.classList.contains('row')")) === true, "keyboard focus reaches a todo row");
  await execute(railWindow, "document.getElementById('list').scrollTop = 24; true");
  assert.equal(await execute(railWindow, "document.getElementById('list').scrollTop"), 24,
    "focus fixture has enough content to scroll before refresh");
  rail.apply({
    surface: "teacher-rail",
    heading: "待办 · 已刷新",
    detail: "已同步",
    updatedAt: new Date().toISOString(),
    rows: focusRows,
  });
  await waitFor(async () => await execute(railWindow, "document.activeElement.dataset.id") === "m3",
    "snapshot refresh preserves keyboard row focus");
  const restoredScroll = await execute(railWindow, "document.getElementById('list').scrollTop");
  assert.equal(restoredScroll, 24, "snapshot refresh preserves list scroll");
  rail.apply({ surface: "teacher-rail", heading: "待办 · 暂无", detail: "只有历史记录",
    rows: Array.from({ length: 16 }, (_unused, index) => ({ id: "history-" + index, name: "历史记录 " + index, actionRequired: false, tone: "neutral" })) });
  await waitFor(async () => (await execute(railWindow, "document.activeElement.id")) === "toggle", "removed row returns focus to toggle");
  rail.apply({ surface: "teacher-rail", heading: "待办 · 暂无", detail: "没有待处理事项",
    rows: [{ id: "m3", name: "王大力", actionRequired: false, tone: "neutral" }].concat(
      Array.from({ length: 16 }, (_unused, index) => ({ id: "history-" + index, name: "历史记录 " + index, actionRequired: false, tone: "neutral" })) ) });
  await waitFor(async () => (await readRailDom(railWindow)).rows === 17, "focus fixture restored");
  await execute(railWindow, "document.querySelector('.row').focus(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true");
  await waitFor(() => railWindow.getBounds().width === 96, "Escape collapses teacher rail");
  assert.equal(await execute(railWindow, "document.activeElement.id"), "toggle", "Escape restores focus to pet toggle");
  await click(railWindow, "#toggle");
  await waitFor(() => railWindow.getBounds().width === 336, "rail reopens after Escape");

  // ── 3. 喊人弹窗 ────────────────────────────────────────────────
  const firstPayload = {
    id: "call-a1",
    kind: "call",
    title: "叮咚，Mochi 来送信啦～",
    subject: "张小明 · 高一（3）班",
    detail: "预约讲题：第 3 题",
    receiptMessageId: "message.raw-1",
    at: new Date().toISOString(),
  };
  assert.equal(rail.attention(firstPayload), true, "a valid attention payload must queue");
  await waitFor(() => popups().length === 1, "popup window");
  const popup = popups()[0];
  await waitFor(async () => (await readPopupDom(popup)).subject !== "", "popup content");
  const popupDom = await readPopupDom(popup);
  assert.equal(popupDom.title, "叮咚，Mochi 来送信啦～");
  assert.equal(popupDom.subject, "张小明 · 高一（3）班");
  assert.equal(popupDom.detail, "预约讲题：第 3 题");
  assert.equal(popup.isAlwaysOnTop(), true, "popup must stay above normal windows");
  await new Promise(resolve => setTimeout(resolve, 450));
  await capture(popup, expandedScreenshot.replace("teacher-todo", "notification"));
  const bubbleGeometry = await execute(popup, "({pet:document.querySelector('.popup-pet').getBoundingClientRect().toJSON(),bubble:document.querySelector('.pop').getBoundingClientRect().toJSON(),avatar:!!document.querySelector('.popup-pet .expressive-orb__body'),duration:remaining})");
  assert.equal(bubbleGeometry.avatar, true, "notification reuses the Mochi pet avatar");
  assert.ok(bubbleGeometry.pet.right <= bubbleGeometry.bubble.left, "pet must remain visible beside bubble");
  assert.ok(bubbleGeometry.duration > 29000 && bubbleGeometry.duration <= 30000, "30 second lifetime");
  await execute(popup, "document.body.dispatchEvent(new MouseEvent('mouseenter')); true");
  assert.equal(await execute(popup, "hideTimer === null"), true, "hover pauses dismissal");



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
    title: "叮咚，Mochi 来送信啦～",
    subject: "李小红 · 高一（3）班",
    detail: "交作业：第 8 题订正",
    at: new Date().toISOString(),
  };
  assert.equal(rail.attention(secondPayload), true);
  await wait(200);
  assert.equal(popups().length, 1, "a queued popup must not open a second window");
  assert.equal((await readPopupDom(popups()[0])).subject, "张小明 · 高一（3）班", "the first popup stays until acknowledged");

  // 真实 receipt 点击会等待异步结果；失败反馈留在原弹窗并允许重试。
  await click(popup, "#p-ack");
  await waitFor(() => actions.some((action) => action.type === "acknowledge" && action.id === "call-a1" && action.receiptMessageId === "message.raw-1"), "acknowledge action");
  assert.equal(popups().length, 1, "pending receipt must keep popup open");
  assert.equal(rail.feedback("call-a1", false, "暂时无法确认，请重试。"), true);
  await waitFor(async () => (await readPopupDom(popup)).feedback === "暂时无法确认，请重试。", "receipt error feedback");
  assert.equal((await readPopupDom(popup)).buttonDisabled, false, "failure re-enables retry");
  await click(popup, "#p-ack");
  await waitFor(() => actions.filter((action) => action.type === "acknowledge" && action.id === "call-a1").length === 2, "receipt retry");
  assert.equal(rail.dispatch({ type: "dismiss", id: "call-a1" }), true, "successful relay dismisses current popup");
  await waitFor(async () => (await readPopupDom(popups()[0])).subject === "李小红 · 高一（3）班", "second popup content");
  assert.equal(popups().length, 1, "acknowledging must reuse the same popup window");

  rail.setPetPalette("cream");
  await waitFor(async () => await execute(popups()[0], "document.documentElement.dataset.mochiPetPalette === 'cream'"), "popup adopts pet palette");
  assert.equal(await execute(railWindow, "document.documentElement.dataset.mochiPetPalette"), "cream", "rail adopts same palette");
  assert.equal(await execute(popups()[0], "getComputedStyle(document.querySelector('.expressive-orb__body')).fill"), "rgb(223, 205, 170)");
  rail.setPetPalette("untrusted-color");
  assert.equal(await execute(railWindow, "document.documentElement.dataset.mochiPetPalette"), "cream", "unknown palette is ignored");
  rail.setPetPalette("caramel");

  // 无 receipt 的提醒只关闭，不向宿主请求收件确认。
  await click(popups()[0], "#p-ack");
  await waitFor(() => popups().length === 0, "popup closes after the queue drains");
  assert.equal(actions.some((action) => action.type === "acknowledge" && action.id === "call-b2"), false, "no receipt popup must not request acknowledgment");

  rail.attention({ id: "escape-popup", kind: "call", title: "提醒", subject: "Escape", detail: "关闭", at: new Date().toISOString() });
  await waitFor(() => popups().length === 1, "escape popup");
  const escapeWindow = popups()[0];
  await execute(escapeWindow, "document.readyState");
  escapeWindow.focus();
  escapeWindow.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  escapeWindow.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(() => popups().length === 0, "Escape closes popup");
  assert.equal(actions.some((action) => action.type === "acknowledge" && action.id === "escape-popup"), false, "Escape must not request receipt acknowledgment");
  rail.attention({ id: "timed-letter", kind: "call", title: "Mochi 小纸条", subject: "计时检查", detail: "收起不会签收", receiptMessageId: "timed-letter", at: new Date().toISOString() });
  await waitFor(() => popups().length === 1, "timed bubble");
  const timedPopup = popups()[0];
  await waitFor(async () => (await readPopupDom(timedPopup)).subject === "计时检查", "timed bubble content");
  timedPopup.webContents.sendInputEvent({type:"mouseMove",x:160,y:80});
  await waitFor(async () => await execute(timedPopup, "hideTimer === null"), "hover pauses actual timer");
  await wait(1000);
  assert.equal(popups().length,1,"hover keeps bubble visible");
  timedPopup.webContents.sendInputEvent({type:"mouseLeave",x:-1,y:-1});
  await waitFor(async () => await execute(timedPopup, "hideTimer !== null"), "leaving resumes actual timer");
  await waitFor(() => popups().length === 0, "30 seconds automatically folds bubble", 32000);
  assert.equal(actions.some(action => action.type === "acknowledge" && action.id === "timed-letter"), false, "timeout never sends seen receipt");


  // 主面板已人工确认的签名回执会随原始 LAN 快照撤销旧提醒。
  rail.attention({ id: "seen-elsewhere", kind: "call", title: "提醒", subject: "已在主面板查看", detail: "无需重复回执", receiptMessageId: "message.raw-3", at: new Date().toISOString() });
  await waitFor(() => popups().length === 1, "seen-elsewhere popup");
  assert.equal(rail.dismissReceipted(["another-message"]), 0, "unrelated receipt leaves popup intact");
  assert.equal(rail.dismissReceipted(["message.raw-3"]), 1, "confirmed original receipt removes stale popup");
  await waitFor(() => popups().length === 0, "stale popup closes");
  assert.equal(actions.some((action) => action.type === "acknowledge" && action.id === "seen-elsewhere"), false, "reconciliation must not send a second receipt");

  // 可直接签收的学生请求必须在固定弹窗里完整显示原话，不能被按钮盖住。
  const fullRequestDetail = "学生原话：" + "请老师解释这道题的第二步。".repeat(3);
  rail.attention({ id: "full-request", kind: "request", title: "新的学生请求", subject: "李明", detail: fullRequestDetail, receiptMessageId: "message.raw-4", at: new Date().toISOString() });
  await waitFor(() => popups().length === 1, "full request popup");
  const fullRequestPopup = popups()[0];
  await waitFor(async () => (await readPopupDom(fullRequestPopup)).detail === fullRequestDetail, "full request text");
  assert.equal((await readPopupDom(fullRequestPopup)).buttonText, "我已看到", "fully visible request can offer direct receipt");
  const requestGeometry = await execute(fullRequestPopup,
    "(() => { const detail = document.getElementById('p-detail').getBoundingClientRect();"
    + " const title = document.getElementById('p-title').getBoundingClientRect();"
    + " const body = document.querySelector('.pop__body').getBoundingClientRect();"
    + " const actions = document.querySelector('.pop__actions').getBoundingClientRect();"
    + " return { detailBottom: detail.bottom, titleTop:title.top, bodyTop:body.top, actionsTop: actions.top }; })()",
  );
  assert.ok(requestGeometry.detailBottom <= requestGeometry.actionsTop - 4, "request original text must not be hidden behind actions");
  assert.ok(requestGeometry.titleTop >= requestGeometry.bodyTop - 1, "request title must not clip behind the popup bar");
  rail.dispatch({ type: "dismiss", id: "full-request" });
  await waitFor(() => popups().length === 0, "full request popup closes");

  const requestTeacher = { endpointId: "teacher-1", role: "teacher", schoolId: "jxl", displayName: "王老师", fingerprint: "sha256:teacher-1" };
  const requestClassroom = { endpointId: "classroom-1", role: "classroom", schoolId: "jxl", classId: "g1-3", displayName: "高一3班教室端", fingerprint: "sha256:classroom-1" };
  const requestBase = { identity: requestTeacher, peers: [requestClassroom], inbox: [], outbox: [] };
  const requestNote = "题".repeat(65);
  const requestNew = teacherRailSnapshot({ ...requestBase, inbox: [{ messageId: "request-65", from: requestClassroom, recipient: requestTeacher,
    body: requestNote, request: { student: "李明", kind: "appointment", topic: "二次函数综合应用", slot: "第八节晚自习" }, receivedAt: new Date().toISOString() }] }, new Date().toISOString());
  const requestPayload = newAttentionPayloads("teacher-rail", teacherRailSnapshot(requestBase, new Date().toISOString()), requestNew)[0];
  assert.equal(requestPayload.receiptMessageId, "request-65", "model permits complete 65-character note with compact popup body");
  assert.equal(requestPayload.detail, "学生原话：" + requestNote, "model preserves the original note without a space-consuming summary");
  rail.attention(requestPayload);
  await waitFor(() => popups().length === 1, "model-generated request popup");
  const modelRequestPopup = popups()[0];
  await waitFor(async () => (await readPopupDom(modelRequestPopup)).detail === requestPayload.detail, "model request text rendered");
  const modelRequestGeometry = await execute(modelRequestPopup, "({body:document.querySelector('.pop__body').getBoundingClientRect().bottom,detail:document.getElementById('p-detail').getBoundingClientRect().bottom,actions:document.querySelector('.pop__actions').getBoundingClientRect().top})");
  assert.ok(modelRequestGeometry.detail <= modelRequestGeometry.body && modelRequestGeometry.body <= modelRequestGeometry.actions - 3, "model-generated direct receipt text is fully above actions");
  assert.equal((await readPopupDom(modelRequestPopup)).buttonText, "我已看到", "fitting model-generated request offers receipt");
  rail.dispatch({ type: "dismiss", id: "request-65" });
  await waitFor(() => popups().length === 0, "model request popup closes");

  const classroomBase = { identity: requestClassroom, peers: [requestTeacher], inbox: [] };
  const verdictNew = classroomRailSnapshot({ ...classroomBase, inbox: [{
    messageId: "verdict-full", from: requestTeacher, recipient: requestClassroom,
    body: "第 5 单元听写已登记。",
    directive: { item: "第 5 单元听写", verdicts: [{ student: "李明", action: "fail", note: "th 发音需重听第 2 段。" }] },
    receivedAt: new Date().toISOString(),
  }] }, new Date().toISOString());
  const verdictPayload = newAttentionPayloads("classroom-board",
    classroomRailSnapshot(classroomBase, new Date().toISOString()), verdictNew)[0];
  assert.equal(verdictPayload.title, "未过关提醒", "verdict popup must name the actual action");
  assert.equal(verdictPayload.receiptMessageId, "verdict-full", "complete single verdict can request receipt");
  rail.attention(verdictPayload);
  await waitFor(() => popups().length === 1, "verdict popup");
  const verdictPopup = popups()[0];
  await waitFor(async () => {
    const dom = await readPopupDom(verdictPopup);
    assert.equal(dom.detail, verdictPayload.detail, "full verdict rendered");
    return true;
  }, "full verdict rendered");
  assert.equal((await readPopupDom(verdictPopup)).buttonText, "我已看到", "complete verdict fits before direct receipt");
  rail.dispatch({ type: "dismiss", id: "verdict-full" });
  await waitFor(() => popups().length === 0, "verdict popup closes");

  // 即使上游误附回执，真实排版放不下时按钮也不得发送“已看到”。
  const oversizedDetail = "学生原话：" + "这道题需要老师帮我说明原理".repeat(12) + " · 班级：高一3班 · 学生希望：第八节晚自习";
  rail.attention({ id: "overflow-request", kind: "request", title: "新的学生请求", subject: "李明".repeat(20),
    detail: oversizedDetail, receiptMessageId: "message.raw-overflow", at: new Date().toISOString() });
  await waitFor(() => popups().length === 1, "overflow request popup");
  const overflowRequest = popups()[0];
  await waitFor(async () => (await readPopupDom(overflowRequest)).detail === oversizedDetail, "overflow request text");
  const overflowGeometry = await execute(overflowRequest, "({bodyBottom:document.querySelector('.pop__body').getBoundingClientRect().bottom,actionsTop:document.querySelector('.pop__actions').getBoundingClientRect().top,scrollable:document.querySelector('.pop__body').scrollHeight>document.querySelector('.pop__body').clientHeight,scrollHeight:document.querySelector('.pop__body').scrollHeight,clientHeight:document.querySelector('.pop__body').clientHeight,detailBottom:document.getElementById('p-detail').getBoundingClientRect().bottom})");
  assert.equal((await readPopupDom(overflowRequest)).buttonText, "关闭提醒", "clipped request cannot offer direct receipt: " + JSON.stringify(overflowGeometry));
  assert.ok(overflowGeometry.bodyBottom <= overflowGeometry.actionsTop - 3 && overflowGeometry.scrollable, "long content scrolls inside body and stays above buttons");
  await click(overflowRequest, "#p-ack");
  await waitFor(() => popups().length === 0, "overflow reminder closes");
  assert.equal(actions.some((action) => action.type === "acknowledge" && action.id === "overflow-request"), false, "clipped request must not send receipt");

  // ── 4. 点行 → 打开；点隐藏 → 收起 ──────────────────────────────
  await click(railWindow, ".row");
  await waitFor(() => actions.some((action) => action.type === "open" && action.id === "m3"), "row click action");
  await execute(railWindow, "document.querySelector('.row').focus(); true");
  for (const keyCode of ["Return", "Space"]) {
    const before = actions.filter((action) => action.type === "open" && action.id === "m3").length;
    railWindow.webContents.sendInputEvent({ type: "keyDown", keyCode });
    railWindow.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await waitFor(() => actions.filter((action) => action.type === "open" && action.id === "m3").length === before + 1,
      "row " + keyCode + " keyboard action");
  }

  await click(railWindow, "#hide");
  await waitFor(() => actions.some((action) => action.type === "hide"), "hide action");
  await waitFor(() => railWindow.isVisible() === false, "rail hides");
  assert.equal(actions.some((action) => action.type === "sync"), false, "sync must be consumed by the rail module, not forwarded");

  rail.setVisible(true);
  await waitFor(() => railWindow.isVisible() === true, "rail shows again");
  const restored = await readRailDom(railWindow);
  assert.equal(restored.rows, 17, "showing again must re-apply the retained snapshot");

  // ── 5. 位置记忆 ────────────────────────────────────────────────
  const moved = railWindow.getBounds();
  const expectedPosition = { x: moved.x - 40, y: moved.y + 40 };
  const saveCountBeforeMove = saves.length;
  railWindow.setPosition(expectedPosition.x, expectedPosition.y);
  await waitFor(() => {
    const bounds = railWindow.getBounds();
    return bounds.x === expectedPosition.x && bounds.y === expectedPosition.y;
  }, "native window reaches the requested position");
  // On Windows setPosition does not enter Electron's native interactive-move
  // loop, so it does not emit moved. Exercise the registered save handler
  // explicitly; this is not a simulated user drag.
  railWindow.emit("moved");
  await waitFor(() => saves.length > saveCountBeforeMove && saves.slice(saveCountBeforeMove).some((entry) =>
    entry.position.x === expectedPosition.x && entry.position.y === expectedPosition.y), "position save for this move");
  const last = saves[saves.length - 1];
  assert.equal(last.surface, "teacher-rail");
  assert.equal(last.position.x, expectedPosition.x);
  assert.equal(last.position.y, expectedPosition.y);

  // ── 6. dispose ─────────────────────────────────────────────────
  rail.dispose();
  await waitFor(() => liveWindows().length === 0, "all rail windows destroyed");
  assert.equal(closedCount, 0, "an explicit dispose must not look like an unexpected close");

  // ── 7. 64 人听写名单：教室常驻板只容纳 50 行，末行须能打开完整名册 ──
  const board = createMochiRail({
    surface: "classroom-board",
    preload: ${JSON.stringify(compiledPreload)},
    store: { load: () => null, save: () => {} },
    onAction: (action) => { actions.push(action); },
  });
  activeRail = board;
  board.setVisible(true);
  await waitFor(() => findByUrlFragment("classroom-board") !== null, "classroom board window");
  const boardWindow = findByUrlFragment("classroom-board");
  const verdicts = Array.from({ length: 64 }, (_, index) => ({
    student: "学生" + (index + 1), action: "fail", note: "补第 " + (index + 1) + " 题",
  }));
  const classroomIdentity = { endpointId: "classroom-1", role: "classroom", schoolId: "jxl", classId: "g1-3", displayName: "高一3班教室端", fingerprint: "sha256:classroom-1" };
  const teacherIdentity = { endpointId: "teacher-1", role: "teacher", schoolId: "jxl", displayName: "王老师", fingerprint: "sha256:teacher-1" };
  const boardSnapshot = classroomRailSnapshot({ identity: classroomIdentity, peers: [teacherIdentity], inbox: [{
    messageId: "roster-64", from: teacherIdentity, recipient: classroomIdentity, body: "听写结果",
    directive: { item: "第 5 单元听写", verdicts }, receivedAt: new Date().toISOString(),
  }] }, new Date().toISOString());
  assert.equal(board.apply(boardSnapshot), true, "64-person model snapshot reaches real Electron board");
  await waitFor(async () => (await readBoardDom(boardWindow)).rows === 50, "bounded classroom rows");
  const boardTop = await readBoardDom(boardWindow);
  assert.equal(boardTop.expanded, "true", "classroom board is always expanded");
  assert.equal(boardTop.count, "64", "board count shows all results, while list stays bounded");
  assert.equal(boardTop.first, "学生1");
  assert.equal(boardTop.penultimate, "学生49");
  assert.equal(boardTop.last, "另有 15 条结果");
  assert.equal(boardTop.lastBadge, "查看完整名单");
  assert.ok(boardTop.detail.includes("共 64 条 · 其余 15 条"));
  await execute(boardWindow, "document.getElementById('list').scrollTop=0; true");
  await waitFor(async () => {
    const state = await readBoardDom(boardWindow);
    return state.scrollTop === 0 && state.firstInView && !state.lastInView;
  }, "classroom roster starts at its first visible row");
  await waitForPaint(boardWindow);
  await capture(boardWindow, boardTopScreenshot);

  await execute(boardWindow, "var list=document.getElementById('list');list.scrollTop=list.scrollHeight; true");
  await waitFor(async () => {
    const state = await readBoardDom(boardWindow);
    return state.lastInView && !state.firstInView;
  }, "overflow entry visible after scroll");
  const boardBottom = await readBoardDom(boardWindow);
  assert.ok(boardBottom.scrollTop > 0, "full roster is scrollable");
  assert.ok(boardBottom.lastLabel.includes("另有 15 条结果"), "overflow entry is keyboard-readable");
  await waitForPaint(boardWindow);
  await capture(boardWindow, boardOverflowScreenshot);
  assert.notDeepEqual(readFileSync(boardOverflowScreenshot), readFileSync(boardTopScreenshot),
    "top and overflow screenshots must show distinct scroll positions");
  await click(boardWindow, ".row:last-child");
  await waitFor(() => actions.some((action) => action.type === "open" && action.id === "roster-64#49"), "overflow focus action");
  board.dispose();
  await waitFor(() => liveWindows().length === 0, "classroom board destroyed");

  writeFileSync(resultPath, JSON.stringify({
    initialWidth: initialBounds.width,
    grownHeight: grownBounds.height,
    initialHeight: initialBounds.height,
    saves: saves.length,
    petScreenshot,
    expandedScreenshot,
    boardTopScreenshot,
    boardOverflowScreenshot,
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
  assert.equal(typeof electronBin, "string", "Rail runtime test requires the installed Electron executable");
  assert.equal(existsSync(electronBin), true, `Rail runtime test requires the Electron executable (${electronBin})`);
  assert.equal(existsSync(compiledRail), true, "Rail runtime test requires npm run build first");
  assert.equal(existsSync(compiledModel), true, "Rail runtime test requires the compiled rail model");
  assert.equal(existsSync(compiledPreload), true, "Rail runtime test requires the compiled rail preload");
  for (const source of [sourceRail, sourcePages, sourcePreload]) {
    assert.ok(
      statSync(compiledRail).mtimeMs >= statSync(source).mtimeMs,
      `Rail runtime test requires a current compiled rail module; run npm run build first (${source})`,
    );
  }
  writeFileSync(fixturePath, fixture());
  const electronHome = join(root, "home");
  const electronTmp = join(root, "tmp");
  mkdirSync(electronHome, { recursive: true });
  mkdirSync(electronTmp, { recursive: true });
  const electronEnv = {
    PATH: process.env.PATH ?? "",
    HOME: electronHome,
    TMPDIR: electronTmp,
    TMP: electronTmp,
    TEMP: electronTmp,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
  // Keep the Windows loader/runtime variables needed by Electron without
  // forwarding unrelated host variables such as model credentials.
  for (const name of ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "PROCESSOR_ARCHITECTURE"]) {
    if (process.env[name]) electronEnv[name] = process.env[name];
  }
  if (process.platform === "win32") {
    electronEnv.USERPROFILE = electronHome;
    electronEnv.APPDATA = join(electronHome, "AppData", "Roaming");
    electronEnv.LOCALAPPDATA = join(electronHome, "AppData", "Local");
    mkdirSync(electronEnv.APPDATA, { recursive: true });
    mkdirSync(electronEnv.LOCALAPPDATA, { recursive: true });
  }
  child = spawn(
    electronBin,
    [fixturePath, "--disable-gpu", "--no-sandbox", `--user-data-dir=${join(root, "electron-user-data")}`],
    {
      cwd: desktopRoot,
      env: electronEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  childOutput = collectOutput(child);
  await waitFor(() => {
    if (existsSync(resultPath)) return true;
    if (child !== null && (child.exitCode !== null || child.signalCode !== null)) {
      throw Object.assign(new Error(`Rail fixture exited before writing a result: ${childOutput()}`), { fatal: true });
    }
    return false;
  }, "rail runtime result");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(result.initialWidth, 96);
  assert.ok(result.grownHeight > result.initialHeight, "rail must grow with content");
  assert.ok(result.saves > 0, "a moved rail must persist its position");
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const name of screenshotNames) {
    const screenshotPath = join(visualRoot, name);
    assert.equal(existsSync(screenshotPath), true, `rail screenshot is missing: ${name}`);
    const screenshot = readFileSync(screenshotPath);
    assert.ok(screenshot.length > pngSignature.length, `rail screenshot is empty: ${name}`);
    assert.deepEqual(screenshot.subarray(0, pngSignature.length), pngSignature, `rail screenshot is not PNG: ${name}`);
  }
  await waitFor(async () => child === null || child.exitCode !== null, "fixture exit");
  console.log(`[test-rail-runtime] PASS: 桌宠窗口、弹窗、动作通道和 64 人教室名单溢出入口均已验证（位置落盘 ${result.saves} 次）。内容截图：${screenshotNames.map((name) => join(visualRoot, name)).join(" ")}`);
} catch (error) {
  console.error(`[test-rail-runtime] FAIL: ${error && error.message ? error.message : String(error)}\n${childOutput()}`);
  process.exitCode = 1;
} finally {
  await terminate(child);
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
