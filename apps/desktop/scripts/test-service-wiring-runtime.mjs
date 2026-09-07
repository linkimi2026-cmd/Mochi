#!/usr/bin/env node
/**
 * Verifies that the versioned non-secret service defaults travel through the
 * real Electron startup path into a disposable loopback sidecar, and that the
 * Doctor mapping reads the same compiled resolver. No real service, credential,
 * campus session, or user runtime home is used.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cpSync,
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
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const sourceResources = join(desktopRoot, "resources", "mochi-web");
const compiledMain = join(desktopRoot, "dist-electron", "main.js");
const compiledHost = join(desktopRoot, "dist-electron", "dsh", "web-host.js");
const compiledProfile = join(desktopRoot, "dist-electron", "dsh", "profile.js");
const compiledDoctorWindow = join(desktopRoot, "dist-electron", "dsh", "doctor-window.js");
const sourceMain = join(desktopRoot, "electron", "main.ts");
const sourceHost = join(desktopRoot, "electron", "dsh", "web-host.ts");
const sourceProfile = join(desktopRoot, "electron", "dsh", "profile.ts");
const sourceDoctorWindow = join(desktopRoot, "electron", "dsh", "doctor-window.ts");
// Use Electron's binary directly. The package-manager CLI shim forwards only
// SIGTERM and can exit before a macOS Electron child that ignores that signal,
// leaving an orphaned fixture after an intentionally failed startup.
const electronBin = createRequire(import.meta.url)("electron");
const root = mkdtempSync(join(tmpdir(), "mochi-service-wiring-"));
const fakeDshPath = join(root, "fake-dsh.cjs");
const timeoutMs = 20_000;
const applications = new Set();

const profileDefaults = {
  campusApiUrl: "https://campus.default.test/",
  searxngEndpoint: "https://search.default.test/api",
};
const profileDefaultExpectations = {
  campusApiUrl: "https://campus.default.test",
  searxngEndpoint: "https://search.default.test/api",
};
const overrideInputs = {
  campusApiUrl: "https://campus.override.test/",
  searxngEndpoint: "https://search.override.test/v1/search",
};
const overrideExpectations = {
  campusApiUrl: "https://campus.override.test",
  searxngEndpoint: "https://search.override.test/v1/search",
};
const absentExpectations = {
  campusApiUrl: undefined,
  searxngEndpoint: undefined,
};
const invalidValue = "https://synthetic-user:synthetic-secret@invalid.service.test";

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

function sidecarFixture() {
  return `
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const observationPath = process.env.MOCHI_TEST_SERVICE_OBSERVATION;
const pidPath = process.env.MOCHI_TEST_SERVICE_PID;
if (!observationPath || !pidPath) throw new Error("missing service wiring fixture paths");
const campusPresent = Object.hasOwn(process.env, "MOCHI_CAMPUS_API_URL");
const searchPresent = Object.hasOwn(process.env, "MOCHI_SEARXNG_ENDPOINT");
const expectedCampusPresent = process.env.MOCHI_TEST_EXPECT_CAMPUS_PRESENT === "1";
const expectedSearchPresent = process.env.MOCHI_TEST_EXPECT_SEARCH_PRESENT === "1";
const observation = {
  campusPresent,
  searchPresent,
  campusMatches: expectedCampusPresent
    ? campusPresent && process.env.MOCHI_CAMPUS_API_URL === process.env.MOCHI_TEST_EXPECT_CAMPUS
    : !campusPresent,
  searchMatches: expectedSearchPresent
    ? searchPresent && process.env.MOCHI_SEARXNG_ENDPOINT === process.env.MOCHI_TEST_EXPECT_SEARCH
    : !searchPresent,
};
mkdirSync(dirname(observationPath), { recursive: true });
writeFileSync(observationPath, JSON.stringify(observation));
writeFileSync(pidPath, String(process.pid));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>fixture</title><p>service-wiring-ready</p>");
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  console.log("dsh web: http://127.0.0.1:" + address.port);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;
}

function createControlledResourceRoot(name, serviceDefaults) {
  const resourceRoot = join(root, name);
  cpSync(sourceResources, resourceRoot, { recursive: true });
  const manifestPath = join(resourceRoot, "runtime-profile.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.serviceDefaults = serviceDefaults;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return resourceRoot;
}

function createCase(name, resourceRoot, expected, overrides = {}) {
  const caseRoot = join(root, name);
  const paths = {
    caseRoot,
    resourceRoot,
    dshHome: join(caseRoot, "dsh-home"),
    userData: join(caseRoot, "user-data"),
    observationPath: join(caseRoot, "sidecar-observation.json"),
    pidPath: join(caseRoot, "sidecar.pid"),
    expected,
    overrides,
  };
  for (const directory of [caseRoot, paths.dshHome, paths.userData]) {
    mkdirSync(directory, { recursive: true });
  }
  return paths;
}

function fixtureEnv(testCase) {
  const expectedEnv = {};
  if (testCase.expected.campusApiUrl !== undefined) {
    expectedEnv.MOCHI_TEST_EXPECT_CAMPUS_PRESENT = "1";
    expectedEnv.MOCHI_TEST_EXPECT_CAMPUS = testCase.expected.campusApiUrl;
  }
  if (testCase.expected.searxngEndpoint !== undefined) {
    expectedEnv.MOCHI_TEST_EXPECT_SEARCH_PRESENT = "1";
    expectedEnv.MOCHI_TEST_EXPECT_SEARCH = testCase.expected.searxngEndpoint;
  }
  const serviceOverrides = {};
  if (testCase.overrides.campusApiUrl !== undefined) {
    serviceOverrides.MOCHI_CAMPUS_API_URL = testCase.overrides.campusApiUrl;
  }
  if (testCase.overrides.searxngEndpoint !== undefined) {
    serviceOverrides.MOCHI_SEARXNG_ENDPOINT = testCase.overrides.searxngEndpoint;
  }
  return {
    PATH: process.env.PATH ?? "",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    DSH_HOME: testCase.dshHome,
    MOCHI_DSH_BIN: fakeDshPath,
    MOCHI_DSH_NODE: process.execPath,
    MOCHI_RUNTIME_RESOURCES: testCase.resourceRoot,
    MOCHI_TEST_SERVICE_OBSERVATION: testCase.observationPath,
    MOCHI_TEST_SERVICE_PID: testCase.pidPath,
    MOCHI_WORKSPACE_ROOT: workspaceRoot,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    ...expectedEnv,
    ...serviceOverrides,
  };
}

function launchElectron(testCase, debugPort) {
  const args = [desktopRoot, "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${testCase.userData}`];
  if (debugPort !== undefined) args.push(`--remote-debugging-port=${debugPort}`);
  const child = spawn(electronBin, args, {
    cwd: desktopRoot,
    env: fixtureEnv(testCase),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const handle = { child, output: collectOutput(child), testCase };
  applications.add(handle);
  return handle;
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

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function stopRecordedSidecar(pidPath) {
  if (!existsSync(pidPath)) return;
  const pid = Number(readFileSync(pidPath, "utf8"));
  if (!Number.isInteger(pid) || pid <= 1 || !isPidAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  await waitFor(() => !isPidAlive(pid), `fixture sidecar ${pid} cleanup`, 5_000);
}

async function pageText(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  assert.equal(response.ok, true, "Chrome DevTools endpoint must be available");
  const targets = await response.json();
  const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
  assert.ok(target, "Electron must expose a BrowserWindow page target");
  return await new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
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
        method: "Runtime.evaluate",
        params: { expression: "document.body.innerText", returnByValue: true },
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error("Chrome DevTools page evaluation failed"));
        return;
      }
      resolvePromise(message.result?.result?.value);
    });
  });
}

async function assertSidecarInjection(testCase) {
  const app = launchElectron(testCase);
  try {
    const observation = await waitFor(() => {
      if (!existsSync(testCase.observationPath)) return null;
      return JSON.parse(readFileSync(testCase.observationPath, "utf8"));
    }, `${testCase.caseRoot} sidecar observation`);
    assert.equal(observation.campusMatches, true, "sidecar campus environment must equal the resolved value or stay absent");
    assert.equal(observation.searchMatches, true, "sidecar search environment must equal the resolved value or stay absent");
    assert.equal(
      observation.campusPresent,
      testCase.expected.campusApiUrl !== undefined,
      "sidecar campus variable presence must follow resolved configuration",
    );
    assert.equal(
      observation.searchPresent,
      testCase.expected.searxngEndpoint !== undefined,
      "sidecar search variable presence must follow resolved configuration",
    );
  } finally {
    await terminate(app);
    applications.delete(app);
    await stopRecordedSidecar(testCase.pidPath);
  }
}

function withRuntimeResources(resourceRoot, run) {
  const previous = process.env.MOCHI_RUNTIME_RESOURCES;
  process.env.MOCHI_RUNTIME_RESOURCES = resourceRoot;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.MOCHI_RUNTIME_RESOURCES;
    else process.env.MOCHI_RUNTIME_RESOURCES = previous;
  }
}

function assertDoctorMapping(resolveMochiServiceDefaults, createDesktopDoctorConfig, resourceRoot, environment, expected) {
  const resolved = withRuntimeResources(resourceRoot, () => resolveMochiServiceDefaults(environment));
  assert.deepEqual(resolved, expected, "Doctor must receive the same resolver output as the sidecar");
  const config = createDesktopDoctorConfig({
    storagePath: join(root, "doctor-storage"),
    campusOrigin: resolved.campusApiUrl,
    searxngEndpoint: resolved.searxngEndpoint,
  });
  if (expected.campusApiUrl === undefined) {
    assert.equal(config.campusService, undefined, "an absent campus value remains unavailable to Doctor");
  } else {
    const campus = new URL(config.campusService?.url ?? "");
    assert.equal(campus.origin, expected.campusApiUrl);
    assert.equal(campus.pathname, "/api/health");
    assert.equal(campus.search, "");
  }
  if (expected.searxngEndpoint === undefined) {
    assert.deepEqual(config.searchEndpoints, undefined, "an absent search value remains unavailable to Doctor");
  } else {
    const search = new URL(config.searchEndpoints?.[0]?.url ?? "");
    const endpoint = new URL(expected.searxngEndpoint);
    assert.equal(search.origin, endpoint.origin);
    assert.equal(search.pathname, endpoint.pathname);
    assert.equal(search.searchParams.get("q"), "Mochi Doctor");
    assert.equal(search.searchParams.get("format"), "json");
    assert.equal(search.searchParams.get("language"), "zh-CN");
  }
}

try {
  assert.equal(existsSync(electronBin), true, "service wiring test requires the installed Electron binary");
  for (const [compiled, source] of [
    [compiledMain, sourceMain],
    [compiledHost, sourceHost],
    [compiledProfile, sourceProfile],
    [compiledDoctorWindow, sourceDoctorWindow],
  ]) {
    assert.equal(existsSync(compiled), true, `${compiled} requires npm run build`);
    assert.ok(statSync(compiled).mtimeMs >= statSync(source).mtimeMs, `${compiled} must be newer than ${source}`);
  }
  for (const directory of [join(root, "home"), join(root, "tmp")]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(fakeDshPath, sidecarFixture());

  const defaultsRoot = createControlledResourceRoot("runtime-defaults", profileDefaults);
  const absentRoot = createControlledResourceRoot("runtime-absent", { campusApiUrl: null, searxngEndpoint: null });
  const defaultCase = createCase("profile-defaults", defaultsRoot, profileDefaultExpectations);
  const overrideCase = createCase("environment-overrides", defaultsRoot, overrideExpectations, overrideInputs);
  const absentCase = createCase("unconfigured-services", absentRoot, absentExpectations);

  await assertSidecarInjection(defaultCase);
  await assertSidecarInjection(overrideCase);
  await assertSidecarInjection(absentCase);

  const requireFromTest = createRequire(import.meta.url);
  const { resolveMochiServiceDefaults } = requireFromTest(compiledProfile);
  const { createDesktopDoctorConfig } = requireFromTest(compiledDoctorWindow);
  assertDoctorMapping(resolveMochiServiceDefaults, createDesktopDoctorConfig, defaultsRoot, {}, profileDefaultExpectations);
  assertDoctorMapping(resolveMochiServiceDefaults, createDesktopDoctorConfig, defaultsRoot, {
    MOCHI_CAMPUS_API_URL: overrideInputs.campusApiUrl,
    MOCHI_SEARXNG_ENDPOINT: overrideInputs.searxngEndpoint,
  }, overrideExpectations);
  assertDoctorMapping(resolveMochiServiceDefaults, createDesktopDoctorConfig, absentRoot, {}, absentExpectations);

  const mainSource = readFileSync(sourceMain, "utf8");
  assert.match(mainSource, /const serviceDefaults = resolveMochiServiceDefaults\(\);/);
  assert.match(mainSource, /campusOrigin:\s*serviceDefaults\.campusApiUrl/);
  assert.match(mainSource, /searxngEndpoint:\s*serviceDefaults\.searxngEndpoint/);
  assert.doesNotMatch(mainSource, /campusOrigin:\s*process\.env\.MOCHI_CAMPUS_API_URL/);
  assert.doesNotMatch(mainSource, /searxngEndpoint:\s*process\.env\.MOCHI_SEARXNG_ENDPOINT/);

  const invalidCase = createCase("invalid-override", defaultsRoot, {}, { campusApiUrl: invalidValue });
  const invalidDebugPort = await freePort();
  const invalidApp = launchElectron(invalidCase, invalidDebugPort);
  try {
    const page = await waitFor(async () => {
      const text = await pageText(invalidDebugPort);
      return typeof text === "string" && text.includes("WEB_HOST_START_FAILED") ? text : null;
    }, "controlled invalid service configuration diagnostic");
    assert.doesNotMatch(page, new RegExp(invalidValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "startup page must not expose the invalid raw value");
    assert.equal(existsSync(invalidCase.observationPath), false, "invalid defaults must reject before spawning the sidecar");
    assert.doesNotMatch(invalidApp.output(), new RegExp(invalidValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "main-process output must not expose the invalid raw value");
  } finally {
    await terminate(invalidApp);
    applications.delete(invalidApp);
    await stopRecordedSidecar(invalidCase.pidPath);
  }

  console.log("[test-service-wiring-runtime] PASS: versioned defaults, explicit overrides, absent values, Doctor mapping, and redacted invalid configuration are wired through the real desktop host.");
} finally {
  for (const app of applications) {
    await terminate(app);
    await stopRecordedSidecar(app.testCase.pidPath);
  }
  rmSync(root, { recursive: true, force: true });
}
