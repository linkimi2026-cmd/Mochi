#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
const preloadPath = join(desktopRoot, "dist-electron", "lan-attention-preload.js");
const tempRoot = mkdtempSync(join(tmpdir(), "mochi-rail-seen-"));
const fixturePath = join(tempRoot, "fixture.cjs");
const resultPath = join(tempRoot, "result.json");

const fixture = `
const assert = require("node:assert/strict");
const http = require("node:http");
const { app, BrowserWindow, ipcMain } = require("electron");
const { writeFileSync } = require("node:fs");
const preloadPath = ${JSON.stringify(preloadPath)};
const resultPath = ${JSON.stringify(resultPath)};
const requestChannel = "mochi:rail:mark-seen-request";
const resultChannel = "mochi:rail:mark-seen-result";
const healthChannel = "mochi:rail:sync-health";
const requests = [];
const results = [];
const health = [];
const appearances = [];
const sounds = [];
let server;

function waitFor(predicate, description) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error(description + " timed out"));
      setTimeout(poll, 20);
    };
    poll();
  });
}

app.whenReady().then(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "mochi_session=fixture-session; HttpOnly; SameSite=Lax" });
      res.end("<!doctype html><script>window.fixtureReady=true</script>");
      return;
    }
    if (req.url === "/api/mochi-lan/message-seen" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        requests.push({ cookie: req.headers.cookie || "", body: JSON.parse(body) });
        const parsed = JSON.parse(body);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        if (parsed.messageId === "mismatch-id") res.end(JSON.stringify({ status: "ACKNOWLEDGED", messageId: "different-id" }));
        else res.end(JSON.stringify({ status: "ACKNOWLEDGED", messageId: parsed.messageId }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  ipcMain.on(resultChannel, (event, value) => {
    assert.equal(event.sender.id, window.webContents.id);
    results.push(value);
  });
  ipcMain.on(healthChannel, (event, value) => {
    assert.equal(event.sender.id, window.webContents.id);
    health.push(value);
  });
  ipcMain.on("mochi:ui-sound", (_, value) => sounds.push(value));
  ipcMain.on("mochi:appearance", (_, value) => appearances.push(value));
  await window.loadURL("http://127.0.0.1:" + address.port + "/");
  const exposed = await window.webContents.executeJavaScript("Object.keys(window.mochiRailDesktop).sort()");
  assert.deepEqual(exposed, ["onFocusMessage", "pushLanState", "reportSyncHealth", "setAppearance", "setSoundEnabled"]);
  const appearanceCalls = await window.webContents.executeJavaScript("['invalid','light','dark','system'].map(value => window.mochiRailDesktop.setAppearance(value))");
  assert.deepEqual(appearanceCalls, [false,true,true,true]);
  await waitFor(() => appearances.length === 3, "appearance preferences");
  assert.deepEqual(appearances, ['light','dark','system']);
  const soundCalls = await window.webContents.executeJavaScript("['invalid',true,false].map(value => window.mochiRailDesktop.setSoundEnabled(value))");
  assert.deepEqual(soundCalls, [false,true,true]);
  await waitFor(() => sounds.length === 2, "sound preferences");
  assert.deepEqual(sounds, [true,false]);
  const healthCalls = await window.webContents.executeJavaScript("[window.mochiRailDesktop.reportSyncHealth('bad'),window.mochiRailDesktop.reportSyncHealth(true),window.mochiRailDesktop.reportSyncHealth(false)]");
  assert.deepEqual(healthCalls, [false, true, true], "preload exposes only a boolean health signal");
  await waitFor(() => health.length === 2, "both health transitions");
  assert.deepEqual(health, [true, false], "main receives no renderer-provided timestamp or error text");
  const pageForge = await window.webContents.executeJavaScript(
    "({complete:typeof window.mochiRailDesktop.completeMarkSeen," +
    "subscribe:typeof window.mochiRailDesktop.onMarkSeen," +
    "ipc:typeof window.ipcRenderer})"
  );
  assert.deepEqual(pageForge, { complete: "undefined", subscribe: "undefined", ipc: "undefined" });

  window.webContents.send(requestChannel, { requestId: "forged", messageId: "ignored" });
  const ids = ["m-123", "mismatch-id"];
  for (let index = 0; index < ids.length; index += 1) {
    const requestId = index === 0 ? "123e4567-e89b-42d3-a456-426614174000" : "123e4567-e89b-42d3-a456-426614174001";
    window.webContents.send(requestChannel, { requestId, messageId: ids[index] });
  }
  await waitFor(() => results.length === 2, "both private receipt results");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(results, [
    { requestId: "123e4567-e89b-42d3-a456-426614174000", ok: true, message: "已确认" },
    { requestId: "123e4567-e89b-42d3-a456-426614174001", ok: false, message: "无法确认已读" },
  ]);
  assert.deepEqual(requests, [
    { cookie: "mochi_session=fixture-session", body: { messageId: "m-123" } },
    { cookie: "mochi_session=fixture-session", body: { messageId: "mismatch-id" } },
  ]);
  writeFileSync(resultPath, JSON.stringify({ electron: process.versions.electron, results, requests }));
  window.destroy();
  server.close();
  app.quit();
}).catch((error) => {
  console.error(error);
  if (server) server.close();
  app.exit(1);
});
`;

let child;
let output = "";
try {
  writeFileSync(fixturePath, fixture);
  child = spawn(electronBin, [fixturePath], {
    cwd: desktopRoot,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-16_384); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-16_384); });
  const exit = await once(child, "exit");
  assert.equal(exit[0], 0, `Electron fixture failed:\n${output}`);
  const { electron, results } = await import("node:fs").then(({ readFileSync }) => JSON.parse(readFileSync(resultPath, "utf8")));
  assert.match(electron, /^39\./);
  assert.equal(results.length, 2);
  console.log(`rail preload seen fixture passed (Electron ${electron})`);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
