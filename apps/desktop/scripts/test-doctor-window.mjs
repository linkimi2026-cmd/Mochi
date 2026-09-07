#!/usr/bin/env node
/**
 * Opens the native Doctor BrowserWindow against a disposable loopback service.
 * It verifies the menu seam, rerun action, copy/save redaction, and cancellation
 * on window close without starting DSH or contacting a real provider.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const sourceWindow = join(desktopRoot, "electron", "dsh", "doctor-window.ts");
const sourceDoctor = join(desktopRoot, "electron", "dsh", "doctor.ts");
const compiledWindow = join(desktopRoot, "dist-electron", "dsh", "doctor-window.js");
const compiledDoctor = join(desktopRoot, "dist-electron", "dsh", "doctor.js");
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
const root = mkdtempSync(join(tmpdir(), "mochi-doctor-window-"));
const fixturePath = join(root, "fixture.cjs");
const reportPath = join(root, "saved-report.json");
const copiedPath = join(root, "copied-report.json");
const runCountPath = join(root, "run-count.txt");
const abortedPath = join(root, "close-aborted.txt");
const menuPath = join(root, "menu-installed.txt");
const syntheticKey = "doctor-window-synthetic-key";
const querySecret = "doctor-window-query-secret";
const timeoutMs = 20_000;
let child = null;
let probeServer = null;

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
    await wait(100);
  }
  throw new Error(`${description} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string", "debug server must expose a TCP port");
  server.close();
  await once(server, "close");
  return address.port;
}

function collectOutput(process) {
  let output = "";
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-32_768);
  };
  process.stdout.on("data", append);
  process.stderr.on("data", append);
  return () => output;
}

async function terminate(process) {
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  process.kill("SIGTERM");
  try {
    await Promise.race([once(process, "exit"), wait(5_000)]);
  } finally {
    if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL");
  }
}

async function doctorTarget(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  assert.equal(response.ok, true, "Chrome DevTools endpoint must be available");
  const targets = await response.json();
  const target = targets.find((candidate) => candidate.type === "page" && candidate.title === "Mochi 环境诊断" && candidate.webSocketDebuggerUrl);
  assert.ok(target, "Doctor BrowserWindow target must be available");
  return target;
}

async function evaluate(debugPort, expression) {
  const target = await doctorTarget(debugPort);
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Doctor BrowserWindow evaluation timed out"));
    }, 5_000);
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Doctor BrowserWindow CDP connection failed"));
    }, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(`Doctor BrowserWindow evaluation failed: ${message.error?.message ?? message.result.exceptionDetails.text}`));
        return;
      }
      resolve(message.result?.result?.value);
    });
  });
}

function clickButton(debugPort, id) {
  return evaluate(debugPort, `(() => { const button = document.getElementById(${JSON.stringify(id)}); if (!button || button.disabled) return false; button.click(); return true; })()`);
}

function fixture(origin) {
  return `
const { app, Menu, clipboard } = require("electron");
const { createDoctorWindowController, createDesktopDoctorConfig, installDoctorMenu } = require(${JSON.stringify(compiledWindow)});
const { runDoctor } = require(${JSON.stringify(compiledDoctor)});
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const root = ${JSON.stringify(root)};
const reportPath = ${JSON.stringify(reportPath)};
const copiedPath = ${JSON.stringify(copiedPath)};
const runCountPath = ${JSON.stringify(runCountPath)};
const abortedPath = ${JSON.stringify(abortedPath)};
const menuPath = ${JSON.stringify(menuPath)};
const syntheticKey = ${JSON.stringify(syntheticKey)};
const querySecret = ${JSON.stringify(querySecret)};
const origin = ${JSON.stringify(origin)};
let runs = 0;
(async () => {
  try {
    app.setName("Mochi");
    await app.whenReady();
    const controller = createDoctorWindowController({
      createConfig: () => createDesktopDoctorConfig({
        storagePath: join(root, "user-data"),
        campusOrigin: origin + "/?token=" + querySecret,
        searxngEndpoint: origin + "/search?token=" + querySecret,
        diagnosticEvents: [{ stage: "web-host", code: "WEB_HOST_EXITED" }],
      }),
      dependencies: {
        run: async (config, signal) => {
          runs += 1;
          writeFileSync(runCountPath, String(runs));
          if (runs === 1) return await runDoctor(config, signal);
          return await new Promise((resolve) => {
            const finish = () => {
              writeFileSync(abortedPath, "aborted");
              resolve({ overallStatus: "unavailable", totalDurationMs: 0, checks: [], recentDiagnostics: [] });
            };
            if (signal?.aborted) finish();
            else signal?.addEventListener("abort", finish, { once: true });
          });
        },
        chooseSavePath: async () => reportPath,
        writeClipboard: (text) => {
          writeFileSync(copiedPath, text);
          clipboard.writeText(text);
        },
      },
    });
    installDoctorMenu(controller);
    const menu = Menu.getApplicationMenu();
    if (!menu?.getMenuItemById("mochi-doctor-open")) throw new Error("Doctor menu item was not installed");
    if (!menu.items.some((item) => item.role?.toLowerCase() === "editmenu")) throw new Error("Doctor menu must preserve the standard edit menu");
    writeFileSync(menuPath, "installed");
    controller.open();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
})();
`;
}

try {
  assert.equal(existsSync(electronBin), true, "Doctor BrowserWindow test requires the installed Electron binary");
  for (const [compiled, source] of [[compiledWindow, sourceWindow], [compiledDoctor, sourceDoctor]]) {
    assert.equal(existsSync(compiled), true, `Doctor BrowserWindow test requires ${compiled}; run npm run build first`);
    assert.ok(statSync(compiled).mtimeMs >= statSync(source).mtimeMs, `Doctor BrowserWindow test requires current ${compiled}; run npm run build first`);
  }
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  mkdirSync(join(root, "user-data"), { recursive: true });
  probeServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const isCampusHealth = request.method === "GET" && url.pathname === "/api/health" && url.search === "";
    const isSearxSearch = request.method === "GET" && url.pathname === "/search" && url.searchParams.get("q") === "Mochi Doctor";
    if (!isCampusHealth && !isSearxSearch) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json", date: new Date().toUTCString() });
    response.end(JSON.stringify({ ok: true }));
  });
  probeServer.listen(0, "127.0.0.1");
  await once(probeServer, "listening");
  const address = probeServer.address();
  assert.ok(address && typeof address !== "string", "Doctor fixture service must have a TCP port");
  const origin = `http://127.0.0.1:${address.port}`;
  writeFileSync(fixturePath, fixture(origin));
  const debugPort = await freePort();
  child = spawn(electronBin, [fixturePath, "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${join(root, "electron-user-data")}`, `--remote-debugging-port=${debugPort}`], {
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

  await waitFor(() => existsSync(menuPath), "native Doctor menu installation");
  const initial = await waitFor(async () => {
    const state = await evaluate(debugPort, "({ count: document.querySelectorAll('[data-check-id]').length, text: document.body.innerText, running: document.getElementById('doctor-rerun')?.disabled === true })");
    return state?.count === 11 && state.running === false ? state : null;
  }, "initial Doctor result");
  assert.match(initial.text, /模型密钥有效性/);
  assert.match(initial.text, /未检测/);
  assert.match(initial.text, /模型密钥仍由 DSH 凭据服务管理/);
  assert.equal(readFileSync(runCountPath, "utf8"), "1", "Doctor window must run its initial check once");
  assert.equal(await evaluate(debugPort, "document.querySelector('[data-check-id=\"campus-service\"] .status')?.textContent"), "通过", "Doctor must probe the verified GET /api/health route instead of a root SPA response");

  assert.equal(await clickButton(debugPort, "doctor-copy"), true, "Doctor page must expose the copy action");
  await waitFor(() => existsSync(copiedPath), "copied redacted report");
  await waitFor(async () => {
    const text = await evaluate(debugPort, "document.body.innerText");
    return typeof text === "string" && text.includes("脱敏报告已复制。") ? text : null;
  }, "copied report render");
  const copied = readFileSync(copiedPath, "utf8");
  assert.match(copied, /"format": "mochi-doctor\/v1"/);
  assert.equal(JSON.parse(copied).checks.length, 11, "copied report must retain all eleven checks");

  assert.equal(await clickButton(debugPort, "doctor-save"), true, "Doctor page must expose the save action");
  await waitFor(() => existsSync(reportPath), "saved redacted report");
  await waitFor(async () => {
    const text = await evaluate(debugPort, "document.body.innerText");
    return typeof text === "string" && text.includes("脱敏报告已保存。") ? text : null;
  }, "saved report render");
  const saved = readFileSync(reportPath, "utf8");
  assert.equal(saved, copied, "copy and save must use the same redacted report representation");
  for (const forbidden of [syntheticKey, querySecret, root, origin]) {
    assert.equal(saved.includes(forbidden), false, `exported report must not contain ${forbidden}`);
  }

  assert.equal(await clickButton(debugPort, "doctor-rerun"), true, "Doctor page must expose the rerun action");
  await waitFor(() => existsSync(runCountPath) && readFileSync(runCountPath, "utf8") === "2", "Doctor rerun start");
  await waitFor(async () => {
    const state = await evaluate(debugPort, "({ text: document.body.innerText, running: document.getElementById('doctor-rerun')?.disabled === true })");
    return state?.running === true && state.text.includes("正在进行环境检测") ? state : null;
  }, "Doctor rerun UI");

  const target = await doctorTarget(debugPort);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    let closeRequested = false;
    const timer = setTimeout(() => reject(new Error("Doctor BrowserWindow close connection timed out")), 5_000);
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      if (closeRequested) resolve();
      else reject(new Error("Doctor BrowserWindow close connection failed"));
    }, { once: true });
    socket.addEventListener("open", () => {
      closeRequested = true;
      socket.send(JSON.stringify({ id: 1, method: "Page.close" }));
    }, { once: true });
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      if (closeRequested) resolve();
      else reject(new Error("Doctor BrowserWindow close connection closed before the request"));
    }, { once: true });
  });
  await waitFor(() => existsSync(abortedPath), "Doctor close cancellation");
  console.log("[test-doctor-window] PASS: native menu/window rerun, copy/save redaction, and close cancellation are stable.");
  await terminate(child);
  child = null;
  await new Promise((resolve) => probeServer.close(resolve));
  probeServer = null;
} finally {
  await terminate(child);
  if (probeServer && probeServer.listening) await new Promise((resolve) => probeServer.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
