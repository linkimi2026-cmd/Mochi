#!/usr/bin/env node
/**
 * Exercises the frozen native Tray module through the real Mochi main process.
 * Each case uses a temporary home and a loopback sidecar; it does not start
 * DSH, contact remote services, or read user credentials or sessions.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const runtimeResources = join(desktopRoot, "resources", "mochi-web");
const workspaceSkills = join(workspaceRoot, "skills");
const sourceMain = join(desktopRoot, "electron", "main.ts");
const sourceHost = join(desktopRoot, "electron", "dsh", "web-host.ts");
const sourceTray = join(desktopRoot, "electron", "dsh", "tray.ts");
const compiledMain = join(desktopRoot, "dist-electron", "main.js");
const compiledHost = join(desktopRoot, "dist-electron", "dsh", "web-host.js");
const compiledTray = join(desktopRoot, "dist-electron", "dsh", "tray.js");
const electronBin = createRequire(import.meta.url)("electron");
const root = mkdtempSync(join(tmpdir(), "mochi-tray-integration-"));
const fakeDshPath = join(root, "fake-dsh.cjs");
const timeoutMs = 20_000;
const launched = new Set();

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitFor(predicate, description, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(50);
  }
  throw new Error(`${description} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

function collectOutput(child) {
  let output = "";
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-32_768);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return () => output;
}

function readCount(path) {
  return existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function stopSidecarPid(path) {
  if (!existsSync(path)) return;
  const pid = Number(readFileSync(path, "utf8"));
  if (!Number.isInteger(pid) || pid <= 1 || !isPidAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  try {
    await waitFor(() => !isPidAlive(pid), `sidecar ${pid} graceful cleanup`, 1_000);
    return;
  } catch {
    if (!isPidAlive(pid)) return;
  }
  process.kill(pid, "SIGKILL");
  await waitFor(() => !isPidAlive(pid), `sidecar ${pid} forced cleanup`, 5_000);
}

async function terminate(handle) {
  const pid = handle?.child?.pid;
  if (!Number.isInteger(pid) || pid <= 1 || !isPidAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([once(handle.child, "exit"), wait(1_000)]);
  if (isPidAlive(pid)) {
    process.kill(pid, "SIGKILL");
    await waitFor(() => !isPidAlive(pid), `Electron fixture ${pid} cleanup`, 5_000);
  }
}

async function waitForExit(handle, description) {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null) return handle.child.exitCode;
  return await Promise.race([
    once(handle.child, "exit").then(([code]) => code),
    wait(timeoutMs).then(() => {
      throw new Error(`${description} did not exit`);
    }),
  ]);
}

function sidecarFixture() {
  return `
const { createServer } = require("node:http");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const statePath = process.env.MOCHI_TEST_TRAY_STATE;
const pidDirectory = process.env.MOCHI_TEST_TRAY_PID_DIRECTORY;
const urlDirectory = process.env.MOCHI_TEST_TRAY_URL_DIRECTORY;
const termDirectory = process.env.MOCHI_TEST_TRAY_TERM_DIRECTORY;
if (!statePath || !pidDirectory || !urlDirectory || !termDirectory) throw new Error("missing tray integration fixture paths");
mkdirSync(pidDirectory, { recursive: true });
mkdirSync(urlDirectory, { recursive: true });
mkdirSync(termDirectory, { recursive: true });
const count = existsSync(statePath) ? Number(readFileSync(statePath, "utf8")) : 0;
const next = count + 1;
writeFileSync(statePath, String(next));
writeFileSync(join(pidDirectory, String(next) + ".txt"), String(process.pid));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>Mochi Tray Fixture</title><p>tray-sidecar-" + next + "</p>");
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const url = "http://127.0.0.1:" + address.port;
  writeFileSync(join(urlDirectory, String(next) + ".txt"), url);
  console.log("dsh web: " + url);
});
process.on("SIGTERM", () => {
  writeFileSync(join(termDirectory, String(next) + ".txt"), "SIGTERM");
  if (process.env.MOCHI_TEST_TRAY_IGNORE_TERM_FIRST === "1" && next === 1) return;
  server.close(() => process.exit(0));
});
`;
}

function createCase(name, mode) {
  const caseRoot = join(root, name);
  const testCase = {
    name,
    mode,
    caseRoot,
    fixturePath: join(caseRoot, "fixture.cjs"),
    resultPath: join(caseRoot, "result.json"),
    userData: join(caseRoot, "user-data"),
    dshHome: join(caseRoot, "dsh-home"),
    statePath: join(caseRoot, "start-count.txt"),
    pidDirectory: join(caseRoot, "pids"),
    urlDirectory: join(caseRoot, "urls"),
    termDirectory: join(caseRoot, "terms"),
  };
  for (const directory of [caseRoot, testCase.userData, testCase.dshHome, testCase.pidDirectory, testCase.urlDirectory, testCase.termDirectory]) {
    mkdirSync(directory, { recursive: true });
  }
  return testCase;
}

function fixtureSource(testCase) {
  return `
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { initializeMochiTray } = require(${JSON.stringify(compiledTray)});
const mode = ${JSON.stringify(testCase.mode)};
const resultPath = ${JSON.stringify(testCase.resultPath)};
const statePath = ${JSON.stringify(testCase.statePath)};
const pidDirectory = ${JSON.stringify(testCase.pidDirectory)};
const urlDirectory = ${JSON.stringify(testCase.urlDirectory)};
const termDirectory = ${JSON.stringify(testCase.termDirectory)};

if (mode === "win32" || mode === "icon-failure") {
  Object.defineProperty(process, "platform", { value: "win32" });
}
if (mode === "icon-failure") {
  Object.defineProperty(app, "getFileIcon", {
    value: async () => {
      throw new Error("synthetic icon lookup failure");
    },
  });
}

require(${JSON.stringify(compiledMain)});

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitFor(predicate, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(30);
  }
  throw new Error(description + " timed out");
}

function count() {
  return existsSync(statePath) ? Number(readFileSync(statePath, "utf8")) : 0;
}

function readPid(index) {
  return Number(readFileSync(require("node:path").join(pidDirectory, String(index) + ".txt"), "utf8"));
}

function readUrl(index) {
  return readFileSync(require("node:path").join(urlDirectory, String(index) + ".txt"), "utf8");
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

function currentMainWindow() {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

async function acquireMainTray() {
  await waitFor(() => count() === 1 && existsSync(require("node:path").join(urlDirectory, "1.txt")), "initial loopback sidecar");
  // Main registered its app.whenReady callback first. The icon lookup is
  // asynchronous, so wait briefly before asking the frozen singleton for its
  // existing handle. If the main integration did not initialize it, the
  // fallback callbacks below make the behavior assertions fail.
  await wait(500);
  const icon = await app.getFileIcon(process.execPath, { size: "normal" });
  assert.equal(icon.isEmpty(), false, "the application icon used by main must be non-empty");
  const fallback = { open: 0, restart: 0, quit: 0 };
  const handle = initializeMochiTray({
    icon,
    open: () => { fallback.open += 1; },
    restart: () => { fallback.restart += 1; },
    quit: () => { fallback.quit += 1; },
  });
  return { handle, fallback };
}

async function runIntegration() {
  const { handle, fallback } = await acquireMainTray();
  const openItem = handle.menu.getMenuItemById("mochi-tray-open");
  const restartItem = handle.menu.getMenuItemById("mochi-tray-restart");
  const quitItem = handle.menu.getMenuItemById("mochi-tray-quit");
  assert.equal(typeof openItem && typeof openItem.click, "function", "main tray must expose open");
  assert.equal(typeof restartItem && typeof restartItem.click, "function", "main tray must expose restart");
  assert.equal(typeof quitItem && typeof quitItem.click, "function", "main tray must expose quit");

  const firstWindow = currentMainWindow();
  assert.ok(firstWindow && firstWindow.isVisible(), "main startup must show a visible window");
  firstWindow.close();
  if (mode === "win32") {
    await waitFor(() => !firstWindow.isDestroyed() && !firstWindow.isVisible(), "controlled Windows close-to-tray hide");
  } else {
    await waitFor(() => BrowserWindow.getAllWindows().length === 0, "macOS main-window close");
  }

  openItem.click();
  await waitFor(() => {
    const window = currentMainWindow();
    return fallback.open === 0 && window && window.isVisible();
  }, "tray open restore");

  const oldPid = readPid(1);
  const oldUrl = readUrl(1);
  restartItem.click();
  restartItem.click();
  await waitFor(() => count() === 2 && existsSync(require("node:path").join(urlDirectory, "2.txt")), "single controlled tray restart");
  const newPid = readPid(2);
  const newUrl = readUrl(2);
  assert.notEqual(newPid, oldPid, "tray restart must create a distinct host process");
  await waitFor(() => !isAlive(oldPid), "old host exit before replacement readiness");
  assert.notEqual(new URL(newUrl).origin, new URL(oldUrl).origin, "tray restart must produce a new ready URL");
  await waitFor(() => {
    const window = currentMainWindow();
    return fallback.restart === 0
      && window
      && new URL(window.webContents.getURL()).origin === new URL(newUrl).origin;
  }, "new ready URL in the restored window");
  await wait(300);
  assert.equal(count(), 2, "double tray restart must not create a second concurrent replacement");

  quitItem.click();
  assert.equal(handle.tray.isDestroyed(), true, "tray quit must destroy the native Tray before shutdown");
  writeFileSync(resultPath, JSON.stringify({
    mode,
    fallback,
    oldPid,
    newPid,
    restartCount: count(),
    trayDestroyedBeforeExit: handle.tray.isDestroyed(),
    closeBehavior: mode === "win32" ? "hidden" : "closed-and-restored",
  }));
}

async function runIconFailure() {
  await waitFor(() => {
    const window = currentMainWindow();
    return window && window.isVisible();
  }, "visible window after icon lookup failure");
  await wait(300);
  const window = currentMainWindow();
  assert.ok(window && window.isVisible(), "failed tray creation must retain a visible window");
  let closed = false;
  window.once("closed", () => {
    closed = true;
    writeFileSync(resultPath, JSON.stringify({ mode, closed }));
  });
  window.close();
  await waitFor(() => closed, "Windows failure fallback close");
}

async function runRestartThenQuit() {
  const { handle, fallback } = await acquireMainTray();
  const restartItem = handle.menu.getMenuItemById("mochi-tray-restart");
  const quitItem = handle.menu.getMenuItemById("mochi-tray-quit");
  assert.equal(typeof restartItem && typeof restartItem.click, "function", "main tray must expose restart");
  assert.equal(typeof quitItem && typeof quitItem.click, "function", "main tray must expose quit");

  restartItem.click();
  await waitFor(
    () => existsSync(require("node:path").join(termDirectory, "1.txt")),
    "restart must request the first host stop before quit",
  );
  assert.equal(count(), 1, "replacement must wait for the original host to stop");

  const quitRequestedAt = Date.now();
  quitItem.click();
  assert.equal(handle.tray.isDestroyed(), true, "tray quit must destroy the native Tray before shutdown");
  writeFileSync(resultPath, JSON.stringify({
    mode,
    fallback,
    restartCountBeforeExit: count(),
    quitRequestedAt,
    trayDestroyedBeforeExit: handle.tray.isDestroyed(),
  }));
}

app.whenReady().then(
  () => mode === "icon-failure"
    ? runIconFailure()
    : mode === "restart-quit"
      ? runRestartThenQuit()
      : runIntegration(),
).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
`;
}

function fixtureEnvironment(testCase) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: join(testCase.caseRoot, "home"),
    TMPDIR: join(testCase.caseRoot, "tmp"),
    DSH_HOME: testCase.dshHome,
    MOCHI_DSH_BIN: fakeDshPath,
    MOCHI_DSH_NODE: process.execPath,
    MOCHI_TEST_TRAY_STATE: testCase.statePath,
    MOCHI_TEST_TRAY_PID_DIRECTORY: testCase.pidDirectory,
    MOCHI_TEST_TRAY_URL_DIRECTORY: testCase.urlDirectory,
    MOCHI_TEST_TRAY_TERM_DIRECTORY: testCase.termDirectory,
    MOCHI_WORKSPACE_ROOT: workspaceRoot,
    // The direct fixture is not an Electron app bundle. Point profile
    // provisioning at the same checked-in runtime resources and skills that
    // the desktop entry uses, rather than deriving them from fixture.cjs.
    MOCHI_RUNTIME_RESOURCES: runtimeResources,
    MOCHI_SKILLS_DIR: workspaceSkills,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    ...(testCase.mode === "restart-quit" ? { MOCHI_TEST_TRAY_IGNORE_TERM_FIRST: "1" } : {}),
  };
}

async function stopAllSidecars(testCase) {
  for (let index = 1; index <= readCount(testCase.statePath); index += 1) {
    await stopSidecarPid(join(testCase.pidDirectory, `${index}.txt`));
  }
}

async function runCase(testCase) {
  writeFileSync(testCase.fixturePath, fixtureSource(testCase));
  const child = spawn(electronBin, [testCase.fixturePath, "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${testCase.userData}`], {
    cwd: desktopRoot,
    env: fixtureEnvironment(testCase),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const handle = { child, output: collectOutput(child), testCase };
  launched.add(handle);
  try {
    await waitFor(() => {
      if (existsSync(testCase.resultPath)) return true;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`fixture exited before writing a result: ${handle.output()}`);
      }
      return false;
    }, `${testCase.name} result`);
    const result = JSON.parse(readFileSync(testCase.resultPath, "utf8"));
    const exitCode = await waitForExit(handle, `${testCase.name} Electron fixture`);
    assert.equal(exitCode, 0, `${testCase.name} fixture failed: ${handle.output()}`);
    if (testCase.mode === "icon-failure") {
      assert.equal(result.closed, true, "failed tray initialization must preserve the normal Windows close/quit route");
      assert.match(handle.output(), /托盘不可用/);
      assert.doesNotMatch(handle.output(), /synthetic icon lookup failure/);
    } else {
      assert.equal(result.fallback.open, 0, "main integration, not the fixture fallback, must own tray open");
      assert.equal(result.fallback.restart, 0, "main integration, not the fixture fallback, must own tray restart");
      assert.equal(result.trayDestroyedBeforeExit, true);
      if (testCase.mode === "restart-quit") {
        assert.equal(result.restartCountBeforeExit, 1, "quit during restart must not start a replacement host");
        assert.ok(
          Date.now() - result.quitRequestedAt >= 4_500,
          `quit must wait for the restart host stop, elapsed=${Date.now() - result.quitRequestedAt}ms`,
        );
      } else {
        assert.equal(result.restartCount, 2);
      }
    }
    await waitFor(async () => {
      for (let index = 1; index <= readCount(testCase.statePath); index += 1) {
        const pidPath = join(testCase.pidDirectory, `${index}.txt`);
        if (existsSync(pidPath) && isPidAlive(Number(readFileSync(pidPath, "utf8")))) return false;
      }
      return true;
    }, `${testCase.name} sidecar cleanup`, 5_000);
    return result;
  } finally {
    launched.delete(handle);
    await terminate(handle);
    await stopAllSidecars(testCase);
  }
}

try {
  assert.equal(existsSync(electronBin), true, "tray integration test requires the installed Electron binary");
  for (const [compiled, source] of [
    [compiledMain, sourceMain],
    [compiledHost, sourceHost],
    [compiledTray, sourceTray],
  ]) {
    assert.equal(existsSync(compiled), true, `${compiled} requires npm run build`);
    assert.ok(statSync(compiled).mtimeMs >= statSync(source).mtimeMs, `${compiled} must be newer than ${source}`);
  }
  writeFileSync(fakeDshPath, sidecarFixture());

  const macResult = await runCase(createCase("macos", "macos"));
  const windowsResult = await runCase(createCase("windows-branch", "win32"));
  await runCase(createCase("icon-failure", "icon-failure"));
  await runCase(createCase("restart-quit", "restart-quit"));

  assert.equal(macResult.closeBehavior, "closed-and-restored");
  assert.equal(windowsResult.closeBehavior, "hidden");
  console.log("[test-tray-integration-runtime] PASS: real main-process tray open, controlled restart, quit cleanup, macOS restore, simulated Windows hide, and icon-failure fallback are stable.");
} finally {
  for (const handle of launched) {
    await terminate(handle);
    await stopAllSidecars(handle.testCase);
  }
  // 受限环境里的批量删除守卫可能拒绝清理临时目录；这不影响断言结果。
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    // 系统回收 /var/folders 下的临时目录。
  }
}
