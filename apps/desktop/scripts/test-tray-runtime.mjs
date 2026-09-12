#!/usr/bin/env node
/**
 * Runs the isolated Tray module in a real Electron main process. It uses only
 * a temporary Electron profile and the running application's file icon; it
 * does not start a DSH host, read a Mochi home, or contact a network service.
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
const sourceTray = join(desktopRoot, "electron", "dsh", "tray.ts");
const compiledTray = join(desktopRoot, "dist-electron", "dsh", "tray.js");
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
const root = mkdtempSync(join(tmpdir(), "mochi-tray-runtime-"));
const fixturePath = join(root, "fixture.cjs");
const resultPath = join(root, "result.json");
const timeoutMs = 10_000;
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

async function waitForExit(processHandle, description) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return processHandle.exitCode;
  return await Promise.race([
    once(processHandle, "exit").then(([code]) => code),
    wait(timeoutMs).then(() => {
      throw new Error(`${description} did not exit`);
    }),
  ]);
}

async function terminate(processHandle) {
  if (processHandle === null || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  processHandle.kill("SIGTERM");
  await Promise.race([once(processHandle, "exit"), wait(5_000)]);
  if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill("SIGKILL");
}

function fixture() {
  return `
const assert = require("node:assert/strict");
const { app, BrowserWindow, nativeImage } = require("electron");
const { initializeMochiTray, destroyMochiTray } = require(${JSON.stringify(compiledTray)});
const { writeFileSync } = require("node:fs");
const resultPath = ${JSON.stringify(resultPath)};
let window = null;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(20);
  }
  throw new Error(description + " timed out");
}

async function run() {
  app.on("window-all-closed", (event) => event.preventDefault());
  const icon = await app.getFileIcon(process.execPath, { size: "normal" });
  assert.equal(icon.isEmpty(), false, "the running application's icon must be usable by Tray");
  const iconSize = icon.getSize();
  assert.ok(iconSize.width > 0 && iconSize.height > 0, "the running application's icon must have dimensions");

  window = new BrowserWindow({ show: false, width: 320, height: 240 });
  await window.loadURL("data:text/html;charset=utf-8,<title>Mochi Tray Fixture</title>");
  window.show();
  await waitFor(() => window !== null && window.isVisible(), "fixture window show");

  assert.throws(() => initializeMochiTray({
    icon: nativeImage.createEmpty(),
    open: () => {},
    restart: () => {},
    switchRole: () => {},
    quit: () => {},
  }), /non-empty application icon/);
  assert.equal(window.isDestroyed(), false, "a tray initialization failure must not destroy the visible app window");
  assert.equal(window.isVisible(), true, "a tray initialization failure must preserve the visible app route");
  window.hide();
  assert.equal(window.isVisible(), false, "fixture window must begin hidden for restore coverage");

  let openCalls = 0;
  let restartCalls = 0;
  let quitCalls = 0;
  let releaseRestart = null;
  const switchRoleCalls = [];
  const callbacks = {
    open: () => {
      openCalls += 1;
      if (window !== null && !window.isDestroyed()) {
        if (!window.isVisible()) window.show();
        window.focus();
      }
    },
    restart: () => new Promise((resolve) => {
      restartCalls += 1;
      releaseRestart = resolve;
    }),
    // [Mochi 2026-09-11] WO-7 托盘新增「切换本机角色」；这里只记录调用，
    // 真实切换流程（确认框 + 重启）由主进程集成测试覆盖。
    switchRole: (role) => {
      switchRoleCalls.push(role);
    },
    quit: () => {
      quitCalls += 1;
      if (window !== null && !window.isDestroyed()) window.destroy();
    },
  };
  const first = initializeMochiTray({ icon, currentRoleLabel: "教师办公电脑", ...callbacks });
  const second = initializeMochiTray({ icon, currentRoleLabel: "教师办公电脑", ...callbacks });
  assert.strictEqual(second, first, "repeated initialization must retain one Tray handle");
  assert.equal(first.tray.isDestroyed(), false, "a real Electron Tray must be created");
  assert.deepEqual(first.menu.items.map((item) => item.label).filter(Boolean), [
    "打开",
    "当前角色：教师办公电脑",
    "切换本机角色：教师办公电脑",
    "切换本机角色：教室一体机",
    "重启内核",
    "退出",
  ]);

  // 当前角色对应的菜单项必须置灰，另一个角色必须可点——否则「切换」会切到
  // 自己身上并触发一次无意义的重启。
  const roleStatus = first.menu.getMenuItemById("mochi-tray-role-status");
  const switchTeacher = first.menu.getMenuItemById("mochi-tray-switch-teacher");
  const switchClassroom = first.menu.getMenuItemById("mochi-tray-switch-classroom");
  assert.equal(roleStatus.enabled, false, "the current role must be a disabled status row");
  assert.equal(switchTeacher.enabled, false, "the current role must not be switchable to itself");
  assert.equal(switchClassroom.enabled, true, "the other role must stay switchable");
  assert.equal(typeof switchClassroom.click, "function", "Tray must expose a role switch callback");
  switchClassroom.click();
  await waitFor(() => switchRoleCalls.length === 1, "tray switch-role callback");
  assert.deepEqual(switchRoleCalls, ["classroom"], "the switch callback must receive the target role");

  const openItem = first.menu.getMenuItemById("mochi-tray-open");
  assert.equal(typeof openItem?.click, "function", "Tray must expose an open menu callback");
  openItem.click();
  await waitFor(() => openCalls === 1 && window !== null && window.isVisible(), "tray open callback restore");

  const restartItem = first.menu.getMenuItemById("mochi-tray-restart");
  assert.equal(typeof restartItem?.click, "function", "Tray must expose a restart menu callback");
  restartItem.click();
  restartItem.click();
  await waitFor(() => restartCalls === 1, "single controlled restart");
  assert.equal(typeof releaseRestart, "function", "controlled restart must expose one completion");
  releaseRestart();
  await wait(0);
  await wait(0);
  restartItem.click();
  await waitFor(() => restartCalls === 2, "restart unlock after completion");
  releaseRestart();
  await wait(0);

  const quitItem = first.menu.getMenuItemById("mochi-tray-quit");
  assert.equal(typeof quitItem?.click, "function", "Tray must expose a quit menu callback");
  quitItem.click();
  await waitFor(() => quitCalls === 1, "tray quit callback");
  assert.equal(first.tray.isDestroyed(), true, "quit must destroy the native Tray before application shutdown");
  assert.equal(window.isDestroyed(), true, "quit callback must remain able to close the app window");

  writeFileSync(resultPath, JSON.stringify({
    iconEmpty: icon.isEmpty(),
    iconSize,
    openCalls,
    restartCalls,
    switchRoleCalls,
    quitCalls,
    repeatedInitialization: first === second,
    trayDestroyed: first.tray.isDestroyed(),
  }));
}

app.whenReady().then(run).then(
  () => app.exit(0),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    destroyMochiTray();
    if (window !== null && !window.isDestroyed()) window.destroy();
    app.exit(1);
  },
);
`;
}

try {
  assert.equal(existsSync(electronBin), true, "Tray runtime test requires the installed Electron binary");
  assert.equal(existsSync(compiledTray), true, "Tray runtime test requires npm run build first");
  assert.ok(
    statSync(compiledTray).mtimeMs >= statSync(sourceTray).mtimeMs,
    "Tray runtime test requires a current compiled tray module; run npm run build first",
  );
  writeFileSync(fixturePath, fixture());
  child = spawn(electronBin, [fixturePath, "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${join(root, "electron-user-data")}`], {
    cwd: desktopRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      TMPDIR: join(root, "tmp"),
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectOutput(child);
  await waitFor(() => {
    if (existsSync(resultPath)) return true;
    if (child !== null && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Tray fixture exited before writing a result: ${output()}`);
    }
    return false;
  }, "native Tray result");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(result.iconEmpty, false);
  assert.equal(result.openCalls, 1);
  assert.equal(result.restartCalls, 2);
  assert.deepEqual(result.switchRoleCalls, ["classroom"], "the role switch callback must be wired exactly once");
  assert.equal(result.quitCalls, 1);
  assert.equal(result.repeatedInitialization, true);
  assert.equal(result.trayDestroyed, true);
  assert.ok(result.iconSize.width > 0 && result.iconSize.height > 0, "native tray icon dimensions must be positive");
  const exitCode = await waitForExit(child, "Tray fixture");
  assert.equal(exitCode, 0, `Tray fixture failed: ${output()}`);
  child = null;
  console.log("[test-tray-runtime] PASS: native icon, Tray menu callbacks, restart debounce, quit cleanup, and visible-window recovery are stable.");
} finally {
  await terminate(child);
  rmSync(root, { recursive: true, force: true });
}
