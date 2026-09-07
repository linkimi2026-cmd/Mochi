#!/usr/bin/env node
/**
 * Exercises the desktop host lifecycle against a disposable loopback sidecar.
 * It keeps all state in a temporary home and never starts DSH, a model, or a
 * remote service.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const compiledMain = join(desktopRoot, "dist-electron", "main.js");
const compiledHost = join(desktopRoot, "dist-electron", "dsh", "web-host.js");
const sourceMain = join(desktopRoot, "electron", "main.ts");
const sourceHost = join(desktopRoot, "electron", "dsh", "web-host.ts");
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
const root = mkdtempSync(join(tmpdir(), "mochi-host-lifecycle-"));
const invocationCwd = join(root, "external-invoker");
const managedHome = join(root, "managed-dsh-home");
const fakeDshPath = join(root, "fake-dsh.cjs");
const timeoutMs = 20_000;
const lifecycle = {
  statePath: join(root, "lifecycle-start-count.txt"),
  pidPath: join(root, "lifecycle-sidecar.pid"),
  cwdPath: join(root, "lifecycle-child-cwd.txt"),
  userData: join(root, "lifecycle-user-data"),
};
const smoke = {
  statePath: join(root, "smoke-start-count.txt"),
  pidPath: join(root, "smoke-sidecar.pid"),
  cwdPath: join(root, "smoke-child-cwd.txt"),
  userData: join(root, "smoke-user-data"),
};
let primary = null;
let secondary = null;
let smokeProcess = null;

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
    await wait(100);
  }
  throw new Error(`${description} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

function readCounter(path) {
  return existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
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

function fixtureEnv(paths, { smokeMode = false, ignoreTerm = false } = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    DSH_HOME: managedHome,
    MOCHI_DSH_BIN: fakeDshPath,
    MOCHI_DSH_NODE: process.execPath,
    MOCHI_TEST_DSH_STATE: paths.statePath,
    MOCHI_TEST_DSH_PID: paths.pidPath,
    MOCHI_TEST_DSH_CWD: paths.cwdPath,
    MOCHI_WORKSPACE_ROOT: workspaceRoot,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    ...(smokeMode ? { MOCHI_DESKTOP_SMOKE: "1", MOCHI_TEST_DSH_FIRST_READY: "1" } : {}),
    ...(ignoreTerm ? { MOCHI_TEST_DSH_IGNORE_TERM: "1" } : {}),
  };
}

function launchElectron({ debugPort, paths, secondaryInstance = false, smokeMode = false, ignoreTerm = false }) {
  const args = [desktopRoot, "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${paths.userData}`];
  if (debugPort !== undefined) args.push(`--remote-debugging-port=${debugPort}`);
  const child = spawn(electronBin, args, {
    // Exercise Finder-like arbitrary invocation cwd while keeping the app path
    // explicit. The DSH child must not inherit this directory.
    cwd: invocationCwd,
    env: fixtureEnv(paths, { smokeMode, ignoreTerm }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, output: collectOutput(child), secondaryInstance };
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

async function terminate(processHandle) {
  if (!processHandle || processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) return;
  processHandle.child.kill("SIGTERM");
  try {
    await Promise.race([once(processHandle.child, "exit"), wait(5_000)]);
  } finally {
    if (processHandle.child.exitCode === null && processHandle.child.signalCode === null) {
      processHandle.child.kill("SIGKILL");
    }
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function stopRecordedSidecar(path) {
  if (!existsSync(path)) return;
  const pid = Number(readFileSync(path, "utf8"));
  if (!Number.isInteger(pid) || pid <= 1 || !isPidAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  await waitFor(() => !isPidAlive(pid), `sidecar ${pid} cleanup`, 5_000);
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
  return await new Promise((resolvePromise, reject) => {
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
      socket.send(JSON.stringify({ id: 1, method, params }));
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
      resolvePromise(message.result?.result?.value);
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

async function currentPageState(debugPort) {
  return await evaluate(debugPort, "({ url: location.href, text: document.body.innerText })");
}

async function crashSidecar(url) {
  const response = await fetch(new URL("/crash", url));
  assert.equal(response.status, 204, "fixture must accept the controlled crash trigger");
}

function sidecarFixture() {
  return `
const { createServer } = require("node:http");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const statePath = process.env.MOCHI_TEST_DSH_STATE;
const pidPath = process.env.MOCHI_TEST_DSH_PID;
const cwdPath = process.env.MOCHI_TEST_DSH_CWD;
if (!statePath || !pidPath || !cwdPath) throw new Error("missing lifecycle fixture state");
mkdirSync(dirname(statePath), { recursive: true });
const count = existsSync(statePath) ? Number(readFileSync(statePath, "utf8")) : 0;
writeFileSync(statePath, String(count + 1));
writeFileSync(cwdPath, process.cwd());
writeFileSync(join(process.cwd(), ".mochi-sidecar-fixture-state"), process.cwd());
if (count === 0 && process.env.MOCHI_TEST_DSH_FIRST_READY !== "1") {
  process.exitCode = 23;
} else {
  writeFileSync(pidPath, String(process.pid));
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/crash") {
      response.writeHead(204);
      response.end();
      server.close(() => process.exit(23));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>fixture</title><p>fixture-ready-" + (count + 1) + "</p>");
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    console.log("dsh web: http://127.0.0.1:" + address.port);
  });
  if (process.env.MOCHI_TEST_DSH_IGNORE_TERM === "1") {
    process.on("SIGTERM", () => {});
  } else {
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
  }
}
`;
}

try {
  assert.equal(existsSync(electronBin), true, "Electron lifecycle test requires the installed desktop binary");
  for (const [compiled, source] of [[compiledMain, sourceMain], [compiledHost, sourceHost]]) {
    assert.equal(existsSync(compiled), true, `${compiled} requires npm run build`);
    assert.ok(statSync(compiled).mtimeMs >= statSync(source).mtimeMs, `${compiled} must be newer than ${source}`);
  }
  for (const directory of [
    join(root, "home"),
    join(root, "tmp"),
    managedHome,
    invocationCwd,
    lifecycle.userData,
    smoke.userData,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(join(invocationCwd, ".env"), "MOCHI_EXTERNAL_CWD_MARKER=1\n");
  writeFileSync(join(invocationCwd, "caller-sentinel.txt"), "unchanged\n");
  writeFileSync(fakeDshPath, sidecarFixture());

  const debugPort = await freePort();
  primary = launchElectron({ debugPort, paths: lifecycle });

  await waitFor(async () => {
    const state = await currentPageState(debugPort);
    return state?.text?.includes("WEB_HOST_EXITED") ? state : null;
  }, "initial startup failure diagnostic");
  assert.equal(readCounter(lifecycle.statePath), 1, "the initial failed host starts exactly once");

  const retried = await evaluate(debugPort, "(() => { const button = document.getElementById('retry'); if (!button) return false; button.click(); return true; })()");
  assert.equal(retried, true, "the existing trusted diagnostic retry remains available");
  const firstReady = await waitFor(async () => {
    const state = await currentPageState(debugPort);
    return state?.url?.startsWith("http://127.0.0.1:") && state.text.includes("fixture-ready-2") ? state : null;
  }, "manual retry readiness");
  assert.equal(readCounter(lifecycle.statePath), 2, "manual retry starts one ready replacement");

  const expectedManagedHome = realpathSync(managedHome);
  assert.equal(readFileSync(lifecycle.cwdPath, "utf8"), expectedManagedHome, "sidecar cwd must be the managed DSH home");
  assert.equal(readFileSync(join(managedHome, ".mochi-sidecar-fixture-state"), "utf8"), expectedManagedHome);
  assert.equal(existsSync(join(invocationCwd, ".mochi-sidecar-fixture-state")), false, "arbitrary caller cwd must not receive sidecar state");
  assert.equal(readFileSync(join(invocationCwd, "caller-sentinel.txt"), "utf8"), "unchanged\n", "caller directory remains untouched");

  if (process.platform === "darwin") {
    await debugCommand(debugPort, "Page.close");
    await waitFor(async () => (await pageTargets(debugPort)).length === 0, "primary window close");
    await waitFor(() => primary.child.exitCode === null && primary.child.signalCode === null, "macOS main process after window close");
  }

  await crashSidecar(firstReady.url);
  await waitFor(() => readCounter(lifecycle.statePath) === 3, "one automatic recovery host");

  let recovered;
  if (process.platform === "darwin") {
    secondary = launchElectron({ paths: lifecycle, secondaryInstance: true });
    const secondaryExit = await waitForExit(secondary.child, "second Electron instance");
    assert.equal(secondaryExit, 0, `second instance output:\n${secondary.output()}`);
    recovered = await waitFor(async () => {
      const state = await currentPageState(debugPort);
      return state?.url?.startsWith("http://127.0.0.1:") && state.text.includes("fixture-ready-3") ? state : null;
    }, "recovered ready URL after reopening the primary window");
  } else {
    recovered = await waitFor(async () => {
      const state = await currentPageState(debugPort);
      return state?.url?.startsWith("http://127.0.0.1:") && state.text.includes("fixture-ready-3") ? state : null;
    }, "recovered ready URL");
  }
  assert.notEqual(recovered.url, firstReady.url, "automatic recovery must use the replacement host URL");

  await crashSidecar(recovered.url);
  await waitFor(async () => {
    const state = await currentPageState(debugPort);
    return state?.text?.includes("WEB_HOST_EXITED") ? state : null;
  }, "bounded recovery failure diagnostic");
  await wait(700);
  assert.equal(readCounter(lifecycle.statePath), 3, "a second unexpected exit must not start an unbounded recovery loop");

  const manuallyRecovered = await evaluate(debugPort, "(() => { const button = document.getElementById('retry'); if (!button) return false; button.click(); return true; })()");
  assert.equal(manuallyRecovered, true, "manual retry remains available after the bounded recovery diagnostic");
  await waitFor(async () => {
    const state = await currentPageState(debugPort);
    return state?.url?.startsWith("http://127.0.0.1:") && state.text.includes("fixture-ready-4") ? state : null;
  }, "manual recovery after bounded automatic attempt");
  assert.equal(readCounter(lifecycle.statePath), 4, "manual retry may start the next host after the automatic budget is exhausted");

  await terminate(primary);
  primary = null;
  await stopRecordedSidecar(lifecycle.pidPath);

  const activeQuitStartedAt = Date.now();
  smokeProcess = launchElectron({ paths: smoke, smokeMode: true, ignoreTerm: true });
  const smokeExit = await waitForExit(smokeProcess.child, "smoke Electron instance");
  assert.equal(smokeExit, 0, `smoke output:\n${smokeProcess.output()}`);
  assert.match(smokeProcess.output(), /MOCHI_DESKTOP_SMOKE_OK/, "existing active app quit path must complete after host readiness");
  assert.ok(Date.now() - activeQuitStartedAt >= 4_500, "active quit waits for the bounded SIGKILL fallback when the sidecar ignores SIGTERM");
  assert.equal(readCounter(smoke.statePath), 1, "active app quit starts exactly one sidecar");
  await waitFor(() => {
    if (!existsSync(smoke.pidPath)) return false;
    return !isPidAlive(Number(readFileSync(smoke.pidPath, "utf8")));
  }, "sidecar stop during active app quit", 5_000);
  await wait(700);
  assert.equal(readCounter(smoke.statePath), 1, "active app quit must not schedule a replacement sidecar");

  console.log("[test-host-lifecycle-runtime] PASS: managed cwd, bounded ready-exit recovery, manual retry, macOS window restoration, and active quit cleanup are stable.");
} finally {
  await terminate(secondary);
  await terminate(primary);
  await terminate(smokeProcess);
  await stopRecordedSidecar(lifecycle.pidPath);
  await stopRecordedSidecar(smoke.pidPath);
  rmSync(root, { recursive: true, force: true });
}
