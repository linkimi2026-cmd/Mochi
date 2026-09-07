#!/usr/bin/env node
/**
 * Exercises the Electron main-process startup controller against a disposable
 * loopback sidecar. The fixture exits once, then becomes ready, so this covers
 * the user-visible retry path without a DSH install, remote model, or real
 * Mochi home. A second Electron invocation shares the temporary user-data
 * directory and must focus/reopen the primary window without starting another
 * sidecar.
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
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const compiledMain = join(desktopRoot, "dist-electron", "main.js");
const sourceMain = join(desktopRoot, "electron", "main.ts");
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
const root = mkdtempSync(join(tmpdir(), "mochi-startup-runtime-"));
const statePath = join(root, "sidecar-start-count.txt");
const pidPath = join(root, "sidecar.pid");
const fakeDshPath = join(root, "fake-dsh.cjs");
const userData = join(root, "user-data");
const timeoutMs = 20_000;
let primary = null;
let secondary = null;

function readCounter() {
  return existsSync(statePath) ? Number(readFileSync(statePath, "utf8")) : 0;
}

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
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
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

function fixtureEnv() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    DSH_HOME: join(root, "dsh-home"),
    MOCHI_DSH_BIN: fakeDshPath,
    MOCHI_DSH_NODE: process.execPath,
    MOCHI_TEST_DSH_STATE: statePath,
    MOCHI_TEST_DSH_PID: pidPath,
    MOCHI_WORKSPACE_ROOT: workspaceRoot,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
}

function launchElectron({ debugPort, secondary = false }) {
  const args = [".", "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${userData}`];
  if (debugPort !== undefined) args.push(`--remote-debugging-port=${debugPort}`);
  const child = spawn(electronBin, args, {
    cwd: desktopRoot,
    env: fixtureEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectOutput(child);
  return { child, output, secondary };
}

async function waitForExit(child, description) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  return await Promise.race([
    once(child, "exit").then(([code]) => code),
    wait(timeoutMs).then(() => {
      throw new Error(`${description} did not exit`);
    }),
  ]);
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await Promise.race([once(child, "exit"), wait(5_000)]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

async function pageTargets(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  assert.equal(response.ok, true, "Chrome DevTools endpoint must be available");
  const targets = await response.json();
  return targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
}

async function currentPage(debugPort) {
  const pages = await pageTargets(debugPort);
  assert.ok(pages.length > 0, "Electron must expose a BrowserWindow page target");
  return pages.at(-1);
}

async function debugCommand(debugPort, method, params = {}) {
  const page = await currentPage(debugPort);
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Chrome DevTools evaluation timed out"));
    }, 5_000);
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Chrome DevTools connection failed"));
    }, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method,
        params,
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) {
        reject(new Error(`Chrome DevTools protocol error: ${message.error.message}`));
        return;
      }
      if (message.result?.exceptionDetails) {
        reject(new Error(`page evaluation failed: ${message.result.exceptionDetails.text}`));
        return;
      }
      resolve(message.result?.result?.value);
    });
  });
}

async function evaluate(debugPort, expression) {
  return await debugCommand(debugPort, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
}

function sidecarFixture() {
  return `
const { createServer } = require("node:http");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const statePath = ${JSON.stringify(statePath)};
const pidPath = ${JSON.stringify(pidPath)};
const count = existsSync(statePath) ? Number(readFileSync(statePath, "utf8")) : 0;
writeFileSync(statePath, String(count + 1));
if (count === 0) {
  process.exitCode = 23;
} else {
  writeFileSync(pidPath, String(process.pid));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>fixture</title><p>fixture-ready</p>");
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    console.log(\`dsh web: http://127.0.0.1:\${address.port}\`);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
`;
}

try {
  assert.equal(existsSync(electronBin), true, "Electron test requires the installed desktop binary");
  assert.equal(existsSync(compiledMain), true, "startup test requires npm run build first");
  assert.ok(
    statSync(compiledMain).mtimeMs >= statSync(sourceMain).mtimeMs,
    "startup test requires a current compiled main process; run npm run build first",
  );
  for (const directory of [join(root, "home"), join(root, "tmp"), join(root, "dsh-home"), userData]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(fakeDshPath, sidecarFixture());

  const debugPort = await freePort();
  primary = launchElectron({ debugPort });

  await waitFor(async () => {
    const text = await evaluate(debugPort, "document.body.innerText");
    return typeof text === "string" && text.includes("WEB_HOST_EXITED") ? text : null;
  }, "startup failure diagnostic");
  assert.equal(readCounter(), 1, "the first startup must create exactly one failed sidecar");

  const clicked = await evaluate(debugPort, "(() => { const button = document.getElementById('retry'); if (!button) return false; button.click(); return true; })()");
  assert.equal(clicked, true, "the trusted local diagnostic page must expose retry");

  const readyPage = await waitFor(async () => {
    const page = await evaluate(debugPort, "({ url: location.href, text: document.body.innerText })");
    return page?.url?.startsWith("http://127.0.0.1:") && page.text.includes("fixture-ready") ? page : null;
  }, "retry sidecar readiness");
  assert.equal(readCounter(), 2, "retry must start one replacement sidecar after the failed one");
  assert.ok(readyPage.url.startsWith("http://127.0.0.1:"));

  await debugCommand(debugPort, "Page.close");
  await waitFor(async () => (await pageTargets(debugPort)).length === 0, "primary BrowserWindow close");
  await waitFor(async () => primary.child.exitCode === null && primary.child.signalCode === null, "primary process after window close");

  secondary = launchElectron({});
  const secondaryExit = await waitForExit(secondary.child, "second Electron instance");
  assert.equal(secondaryExit, 0, `second instance output:\n${secondary.output()}`);

  await waitFor(async () => {
    const page = await evaluate(debugPort, "({ url: location.href, text: document.body.innerText })");
    return page?.url?.startsWith("http://127.0.0.1:") && page.text.includes("fixture-ready") ? page : null;
  }, "ready URL restoration after second-instance");
  assert.equal(readCounter(), 2, "second-instance must not create a second DSH sidecar");

  console.log("[test-startup-runtime] PASS: Electron retry, ready-URL restoration, and single-instance reuse are stable.");
  await terminate(primary.child);
} finally {
  if (secondary !== null) await terminate(secondary.child);
  if (primary !== null) await terminate(primary.child);
  if (existsSync(pidPath)) {
    const pid = Number(readFileSync(pidPath, "utf8"));
    if (Number.isInteger(pid) && pid > 1) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // The fixture exits with the desktop process in the normal path.
      }
    }
  }
  rmSync(root, { recursive: true, force: true });
}
