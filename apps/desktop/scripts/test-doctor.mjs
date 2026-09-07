#!/usr/bin/env node
/**
 * Runs the main-process Doctor module only against disposable local files and
 * loopback HTTP fixtures. No user home, stored credential, model provider, or
 * campus endpoint is read during this test.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const source = join(desktopRoot, "electron", "dsh", "doctor.ts");
const compiled = join(desktopRoot, "dist-electron", "dsh", "doctor.js");
const root = mkdtempSync(join(tmpdir(), "mochi-doctor-test-"));
const syntheticKey = "synthetic-doctor-key";
const queryOnlySecret = "fixture-query-secret";
const serviceSockets = new Set();
const proxySockets = new Set();
let service = null;
let proxy = null;

function resultFor(run, id) {
  const result = run.checks.find((check) => check.id === id);
  assert.ok(result, `missing doctor result: ${id}`);
  return result;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(20);
  }
  throw new Error(`${description} timed out`);
}

async function closeServer(server, sockets) {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

try {
  assert.equal(existsSync(compiled), true, "doctor test requires npm run build first");
  assert.ok(
    statSync(compiled).mtimeMs >= statSync(source).mtimeMs,
    "doctor test requires a current compiled module; run npm run build first",
  );
  const { DOCTOR_CHECK_IDS, createRedactedDoctorReport, runDoctor } = createRequire(import.meta.url)(compiled);
  let proxyHit = false;
  let credentialProbeHit = false;

  service = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    if (path === "/slow") return;
    if (path === "/credentials") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.once("end", () => {
        let payload = null;
        try { payload = JSON.parse(body); } catch { /* fixture rejects malformed body below */ }
        credentialProbeHit = request.method === "POST"
          && payload?.model === "fixture-model"
          && payload?.max_tokens === 1
          && payload?.stream === false
          && payload?.messages?.[0]?.content === "Mochi Doctor connectivity probe.";
        response.statusCode = request.headers.authorization === `Bearer ${syntheticKey}` ? 200 : 401;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          id: "fixture-chat-completion",
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }));
      });
      return;
    }
    if (path === "/credentials-invalid") {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (path === "/credentials-redirect") {
      response.statusCode = 302;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        id: "fixture-chat-completion",
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }));
      return;
    }
    if (path === "/search-degraded") {
      response.statusCode = 503;
      response.end();
      return;
    }
    if (path === "/model") {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (path === "/campus" || path === "/search-good") {
      response.statusCode = 200;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  service.on("connection", (socket) => {
    serviceSockets.add(socket);
    socket.once("close", () => serviceSockets.delete(socket));
  });

  proxy = createServer((request, response) => {
    proxyHit = request.method === "HEAD" && request.url === "http://proxy-target.invalid/health";
    response.statusCode = proxyHit ? 200 : 502;
    response.end();
  });
  proxy.on("connection", (socket) => {
    proxySockets.add(socket);
    socket.once("close", () => proxySockets.delete(socket));
  });

  service.listen(0, "127.0.0.1");
  proxy.listen(0, "127.0.0.1");
  await Promise.all([once(service, "listening"), once(proxy, "listening")]);
  const serviceAddress = service.address();
  const proxyAddress = proxy.address();
  assert.ok(serviceAddress && typeof serviceAddress !== "string");
  assert.ok(proxyAddress && typeof proxyAddress !== "string");
  const serviceRoot = `http://127.0.0.1:${serviceAddress.port}`;
  const proxyRoot = `http://127.0.0.1:${proxyAddress.port}`;

  const baseConfig = () => ({
    runtime: {
      platform: "darwin",
      systemVersion: "13.2.1",
      arch: process.arch,
      expectedArchitecture: process.arch,
    },
    storage: { path: join(root, "home") },
    modelService: { url: `${serviceRoot}/model?token=${queryOnlySecret}` },
    credentials: { url: `${serviceRoot}/credentials?token=${queryOnlySecret}`, apiKey: syntheticKey, model: "fixture-model" },
    campusService: { url: `${serviceRoot}/campus` },
    searchEndpoints: [
      { url: `${serviceRoot}/search-degraded` },
      { url: `${serviceRoot}/search-good` },
    ],
    proxy: { proxyUrl: proxyRoot, targetUrl: "http://proxy-target.invalid/health" },
    diagnosticEvents: [{ stage: "web-host", code: "WEB_HOST_TIMEOUT" }],
  });

  const successful = await runDoctor(baseConfig());
  assert.equal(successful.checks.length, DOCTOR_CHECK_IDS.length, "the fixed eleven-item checklist must remain complete");
  for (const id of ["system-version", "architecture", "disk-space", "home-writable", "loopback", "model-service", "credentials", "campus-service", "search-endpoint", "proxy"]) {
    assert.equal(resultFor(successful, id).status, "pass", `${id} must pass against its actual loopback fixture`);
  }
  assert.equal(resultFor(successful, "system-time").status, "unavailable", "no trusted HTTPS Date reference must not fake a time pass");
  assert.equal(proxyHit, true, "proxy probe must receive the actual absolute-form request");
  assert.equal(credentialProbeHit, true, "credential validation must send the fixed low-output chat POST");

  const report = createRedactedDoctorReport(successful);
  const parsedReport = JSON.parse(report);
  assert.deepEqual(Object.keys(parsedReport).sort(), ["checks", "format", "overallStatus", "recentDiagnostics", "totalDurationMs"]);
  assert.equal(parsedReport.recentDiagnostics[0].code, "WEB_HOST_TIMEOUT");
  for (const secret of [syntheticKey, queryOnlySecret, root, serviceRoot, proxyRoot]) {
    assert.equal(report.includes(secret), false, "redacted report must exclude fixture secrets, paths, and endpoints");
  }
  for (const check of parsedReport.checks) {
    assert.deepEqual(Object.keys(check).sort(), ["action", "durationMs", "id", "label", "message", "status"]);
  }

  const invalidCredentials = await runDoctor({
    ...baseConfig(),
    credentials: { url: `${serviceRoot}/credentials`, apiKey: "wrong-test-key", model: "fixture-model" },
  });
  assert.equal(resultFor(invalidCredentials, "credentials").status, "fail", "an explicit rejected credential must fail");
  assert.equal(createRedactedDoctorReport(invalidCredentials).includes("wrong-test-key"), false);

  const unrecognizedChatResponse = await runDoctor({
    ...baseConfig(),
    credentials: { url: `${serviceRoot}/credentials-invalid`, apiKey: syntheticKey, model: "fixture-model" },
  });
  assert.equal(resultFor(unrecognizedChatResponse, "credentials").status, "warn", "a public or non-chat 2xx response must not pass credential validation");

  const redirectedCredentials = await runDoctor({
    ...baseConfig(),
    credentials: { url: `${serviceRoot}/credentials-redirect`, apiKey: syntheticKey, model: "fixture-model" },
  });
  assert.equal(resultFor(redirectedCredentials, "credentials").status, "warn", "a redirect must not pass credential validation");

  const timedOut = await runDoctor({
    ...baseConfig(),
    totalBudgetMs: 25,
    modelService: { url: `${serviceRoot}/slow`, method: "GET" },
  });
  assert.equal(resultFor(timedOut, "model-service").status, "warn", "the five-second budget mechanism must downgrade unfinished work to warning");
  assert.ok(timedOut.totalDurationMs < 1_000, "a shortened test budget must cancel promptly");
  await waitFor(() => serviceSockets.size === 0, "timed-out request socket cleanup");

  const cancellation = new AbortController();
  const cancelledRun = runDoctor({
    ...baseConfig(),
    modelService: { url: `${serviceRoot}/slow`, method: "GET" },
  }, cancellation.signal);
  setTimeout(() => cancellation.abort(), 25);
  const cancelled = await cancelledRun;
  assert.equal(resultFor(cancelled, "model-service").status, "unavailable", "external cancellation must not claim a result");
  await waitFor(() => serviceSockets.size === 0, "cancelled request socket cleanup");

  console.log("[test-doctor] PASS: eleven checks, loopback probes, timeout/cancel cleanup, and redacted report whitelist are stable.");
} finally {
  if (service !== null) await closeServer(service, serviceSockets);
  if (proxy !== null) await closeServer(proxy, proxySockets);
  rmSync(root, { recursive: true, force: true });
}
