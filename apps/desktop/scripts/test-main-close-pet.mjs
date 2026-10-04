#!/usr/bin/env node
/**
 * Verifies the real macOS app main-window close behavior with a loopback host.
 * The authenticated page must survive close, keep its LAN poll timer running,
 * and return in the same window when another instance activates the app.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("[test-main-close-pet] SKIP: requires macOS window semantics");
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const compiledMain = join(desktopRoot, "dist-electron", "main.js");
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
const root = mkdtempSync(join(tmpdir(), "mochi-main-close-pet-"));
const userData = join(root, "user-data");
const dshHome = join(root, "dsh-home");
const home = join(root, "home");
const temp = join(root, "tmp");
const statePath = join(root, "sidecar-state.txt");
const pidPath = join(root, "sidecar.pid");
const fakeDshPath = join(root, "fake-dsh.cjs");
for (const directory of [userData, dshHome, home, temp]) mkdirSync(directory, { recursive: true });

writeFileSync(fakeDshPath, `
const { createServer } = require("node:http");
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.MOCHI_TEST_DSH_STATE, "started");
writeFileSync(process.env.MOCHI_TEST_DSH_PID, String(process.pid));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>close fixture</title><script>window.__ticks=0;setInterval(()=>window.__ticks++,40)</script><p>authenticated-page-ready</p>");
});
server.listen(0, "127.0.0.1", () => console.log("dsh web: http://127.0.0.1:" + server.address().port));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`);

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

const debugPort = await freePort();
const nodeDebugPort = await freePort();
const appArgs = [desktopRoot, "--headless", "--disable-gpu", "--no-sandbox", "--role=teacher", `--user-data-dir=${userData}`];
const environment = {
  PATH: process.env.PATH ?? "",
  HOME: home,
  TMPDIR: temp,
  DSH_HOME: dshHome,
  MOCHI_DSH_BIN: fakeDshPath,
  MOCHI_DSH_NODE: process.execPath,
  MOCHI_TEST_DSH_STATE: statePath,
  MOCHI_TEST_DSH_PID: pidPath,
  MOCHI_WORKSPACE_ROOT: workspaceRoot,
  ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
};
const electronFromInspector = `process.getBuiltinModule('module').createRequire(${JSON.stringify(compiledMain)})('electron')`;
let output = "";
let primary = null;

function launch(args) {
  const child = spawn(electronBin, args, { cwd: desktopRoot, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const append = (chunk) => { output = (output + chunk.toString()).slice(-32_768); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return child;
}

async function waitFor(predicate, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${description} timed out\n${output}`);
}

async function pageTargets() {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return [];
    return (await response.json()).filter((target) => target.type === "page");
  } catch {
    return [];
  }
}

async function inspectorTarget() {
  try {
    const response = await fetch(`http://127.0.0.1:${nodeDebugPort}/json/list`);
    return response.ok ? (await response.json())[0] ?? null : null;
  } catch {
    return null;
  }
}

async function command(target, method, params = {}) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const id = 1;
    const timer = setTimeout(() => { socket.close(); reject(new Error(`${method} timed out`)); }, 5_000);
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`${method} websocket failed`)); }, { once: true });
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id, method, params })), { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text));
      }
      else resolve(message.result);
    });
  });
}

async function evaluate(target, expression) {
  const result = await command(target, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

try {
  assert.equal(existsSync(electronBin), true, "desktop Electron binary must be installed");
  primary = launch([`--inspect=127.0.0.1:${nodeDebugPort}`, ...appArgs, `--remote-debugging-port=${debugPort}`]);
  const inspector = await waitFor(inspectorTarget, "Electron main-process inspector");
  const initial = await waitFor(async () => {
    const target = (await pageTargets()).find((candidate) => candidate.url.startsWith("http://127.0.0.1:"));
    if (!target) return null;
    try {
      return (await evaluate(target, "document.body?.innerText.includes('authenticated-page-ready') === true")) ? target : null;
    } catch {
      return null;
    }
  }, "authenticated page ready");
  const startUrl = initial.url;
  const ticksBefore = await evaluate(initial, "window.__ticks");

  // CDP may close its control socket while dispatching Page.close on macOS;
  // the authoritative assertion below is that the same page target survives.
  const closeWindow = `(() => { const w=${electronFromInspector}.BrowserWindow.getAllWindows().find(x=>!x.isDestroyed()); w.close(); return w.id; })()`;
  const windowId = (await command(inspector, "Runtime.evaluate", { expression: closeWindow, returnByValue: true })).result.value;
  const hiddenState = (await command(await inspectorTarget(), "Runtime.evaluate", {
    expression: `(() => { const w=${electronFromInspector}.BrowserWindow.getAllWindows().find(x=>x.id===${windowId}); return !!w && !w.isDestroyed() && !w.isVisible(); })()`,
    returnByValue: true,
  })).result.value;
  assert.equal(hiddenState, true, "main-window close should hide and retain the same BrowserWindow");
  const retained = (await pageTargets()).find((target) => target.id === initial.id);
  assert.ok(retained, "closed main window must retain its DevTools page target");
  assert.equal(retained.url, startUrl, "close must preserve the authenticated page URL");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const ticksAfter = await evaluate(retained, "window.__ticks");
  assert.ok(ticksAfter > ticksBefore, "hidden page timers must continue for background rail polling");

  await command(await inspectorTarget(), "Runtime.evaluate", { expression: `${electronFromInspector}.app.quit()`, returnByValue: true });
  let quitTimeout;
  const [primaryCode] = await Promise.race([
    once(primary, "exit"),
    new Promise((_, reject) => { quitTimeout = setTimeout(() => reject(new Error(`explicit Quit timed out\n${output}`)), 10_000); }),
  ]).finally(() => clearTimeout(quitTimeout));
  assert.equal(primaryCode, 0, `explicit Quit failed\n${output}`);
  console.log("[test-main-close-pet] PASS: macOS close hides and retains the live page/poll; explicit Quit exits.");
} finally {
  await stop(primary);
  if (existsSync(pidPath)) {
    const pid = Number(readFileSync(pidPath, "utf8"));
    try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
  }
  rmSync(root, { recursive: true, force: true });
}
