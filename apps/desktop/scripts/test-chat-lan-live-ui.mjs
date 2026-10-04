#!/usr/bin/env node
/** Exercise a real DSH tool call, approval, and signed Mochi LAN pairing request in Electron. */
import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { LAN_STATE_FILENAME, MochiLanService } from "../../../plugins/mochi-lan/lan-service.mjs";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const { renderSettingsDefaults } = requireFromDesktop("./scripts/seed-packaging-keys.cjs");
const { chromium } = requireFromDesktop("playwright");
const electronBin = requireFromDesktop("electron");
const resourceSource = join(desktopRoot, "resources", "mochi-web");
const root = mkdtempSync(join(tmpdir(), "mochi-teacher-model-live-ui-"));
const fixtureResources = join(root, "resources");
const fixtureWorkspace = join(root, "workspace");
const dshHome = join(root, "dsh-teacher");
const userData = join(root, "electron-user-data");
const fixtureKey = "fixture-teacher-aiaaa-key-never-real";
const fixtureSchool = "fixture-school-live-ui";
const fixtureClass = "fixture-class-live-ui";
const pairingPrompt = "请在我的本地 Mochi 网络里，向 127.0.0.1 上的教室发起配对，并告诉我是否已发送待确认请求。";
const pairCallId = "call_mochi_lan_pair_fixture";
const requests = [];
let gateway;
let electron;
let browser;
let page;
let classroom;
let classroomHome;
let classroomSnapshot;
let output = "";
let gatewayFailure = "";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (value) => String(value).split(fixtureKey).join("[fixture credential redacted]");

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await pause(150);
  }
  throw new Error(`${label} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function startGateway() {
  gateway = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const tools = Array.isArray(payload.tools) ? payload.tools.map((tool) => tool.function?.name).filter(Boolean) : [];
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const hasPairingPrompt = messages.some((message) => message.role === "user"
        && typeof message.content === "string" && message.content.includes(pairingPrompt));
      const toolResult = messages.find((message) => message.role === "tool" && message.tool_call_id === pairCallId);
      const record = {
        path: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
        model: payload.model ?? "",
        tools,
        modeText: JSON.stringify(messages.filter(message => message.role === "system")).match(/当前会话模式：[^(（"\n]+/u)?.[0] ?? "",
        authorizationMatchesFixture: request.headers.authorization === `Bearer ${fixtureKey}`,
        hasPairingPrompt,
        hasPairToolResult: Boolean(toolResult),
        toolResult: typeof toolResult?.content === "string" ? toolResult.content : "",
        assistantToolCall: messages.find((message) => message.role === "assistant" && message.tool_calls?.some((call) => call.id === pairCallId))?.tool_calls?.find((call) => call.id === pairCallId),
      };
      requests.push(record);
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (hasPairingPrompt && !toolResult) {
        const args = JSON.stringify({ host: "127.0.0.1", port: classroomSnapshot.http.port });
        response.end([
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: pairCallId, type: "function", function: { name: "mochi_lan_pair_classroom", arguments: args } }] }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""));
        return;
      }
      const finalText = hasPairingPrompt && toolResult
        ? "已向同校教室发起配对请求，当前等待教室端确认。"
        : "fixture";
      response.end([
        'data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n',
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: finalText } }] })}\n\n`,
        'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""));
    } catch (error) {
      gatewayFailure = redact(error?.stack ?? error);
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "fixture gateway failure" }));
    }
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  return `http://127.0.0.1:${gateway.address().port}`;
}

function prepareResources(origin) {
  assert.equal(existsSync(resourceSource), true);
  cpSync(resourceSource, fixtureResources, {
    recursive: true,
    filter(source) {
      const path = relative(resourceSource, source).replaceAll("\\", "/");
      return path !== "seeds" && !path.startsWith("seeds/");
    },
  });
  const seeds = join(fixtureResources, "seeds");
  mkdirSync(seeds, { recursive: true });
  const settings = renderSettingsDefaults();
  settings.visionProvider.baseURL = `${origin}/v1`;
  writeFileSync(join(seeds, "settings-defaults.json"), `${JSON.stringify(settings, null, 2)}\n`);
  assert.equal(existsSync(join(seeds, "credentials-seed.json")), false);

  // The teacher's real plugin gets an ephemeral HTTP port and no UDP beacon
  // during this isolated pairing test; production resources stay untouched.
  const runtimeProfilePath = join(fixtureResources, "runtime-profile.cjs");
  let runtimeProfile = readFileSync(runtimeProfilePath, "utf8");
  const lanConfig = 'dataRoot: join(homeDir, "mochi-lan"), lockedRole: role';
  assert.equal(runtimeProfile.split(lanConfig).length - 1, 1, "runtime profile LAN config shape changed");
  runtimeProfile = runtimeProfile.replace(lanConfig, `${lanConfig}, port: 0, discoveryEnabled: false`);
  writeFileSync(runtimeProfilePath, runtimeProfile);
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value));
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  assert.equal(typeof value, "object");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function fingerprint(publicKey) {
  return `sha256:${createHash("sha256").update(canonical(publicKey)).digest("hex").slice(0, 32)}`;
}

async function connectPage(port) {
  browser = await waitFor(async () => {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { return false; }
  }, "Electron CDP endpoint");
  return await waitFor(() => browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url())) || false, "teacher renderer");
}

async function openWorkspace() {
  await page.getByRole("button", { name: "选择工作区", exact: true }).click();
  await page.getByRole("heading", { name: "选择工作区目录", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "编辑路径", exact: true }).click();
  const input = page.getByRole("textbox", { name: "编辑路径", exact: true });
  await input.fill(fixtureWorkspace);
  await input.press("Enter");
  await page.getByRole("button", { name: "编辑路径", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await page.getByRole("heading", { name: "选择工作区目录", exact: true }).waitFor({ state: "hidden" });
  await waitFor(async () => !(await page.locator("body").innerText()).includes("选择一个工作区开始"), "workspace activation");
}

async function run() {
  assert.equal(existsSync(electronBin), true);
  classroomHome = join(root, "fixture-classroom-home");
  classroom = new MochiLanService({
    dataRoot: classroomHome,
    bindHost: "127.0.0.1",
    port: 0,
    discoveryEnabled: false,
    lockedRole: "classroom",
    identity: { schoolId: fixtureSchool, classId: fixtureClass, displayName: "Fixture Classroom" },
  });
  classroomSnapshot = await classroom.start();
  const origin = await startGateway();
  prepareResources(origin);
  for (const name of ["home", "tmp", "config"]) mkdirSync(join(root, name), { recursive: true });
  for (const name of [dshHome, userData, fixtureWorkspace]) mkdirSync(name, { recursive: true });
  const debugPort = await freePort();
  electron = spawn(electronBin, [".", "--no-sandbox", "--disable-gpu", `--user-data-dir=${userData}`, `--remote-debugging-port=${debugPort}`], {
    cwd: desktopRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
      XDG_CONFIG_HOME: join(root, "config"), DSH_HOME: dshHome,
      MOCHI_LAN_IDENTITY: JSON.stringify({ schoolId: fixtureSchool, displayName: "Fixture Teacher" }),
      DSH_TELEMETRY_DISABLED: "1", MOCHI_RUNTIME_ROLE: "teacher",
      MOCHI_DIRECTORY_PICKER: "browse", MOCHI_RUNTIME_RESOURCES: fixtureResources,
      MOCHI_NO_SANDBOX: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [electron.stdout, electron.stderr]) stream.on("data", (chunk) => {
    output = redact((output + chunk.toString()).slice(-16_384));
  });
  page = await connectPage(debugPort);
  page.on("console", (message) => { output = redact(`${output}\n[renderer] ${message.text()}`.slice(-16_384)); });
  page.on("pageerror", (error) => { output = redact(`${output}\n[pageerror] ${error.message}`.slice(-16_384)); });

  await page.getByRole("button", { name: "继续", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "稍后配置", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型", exact: true }).click();

  const edit = page.getByRole("button", { name: "编辑 DeepSeek（内置） (mochi-aiaaa)", exact: true });
  await edit.waitFor({ state: "visible" });
  await edit.click();
  const row = edit.locator("xpath=ancestor::li[1]");
  const keyInput = row.locator('input[type="password"][aria-label="API 密钥"]');
  await keyInput.waitFor({ state: "visible" });
  await keyInput.fill(fixtureKey);
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await waitFor(() => {
    const path = join(dshHome, ".credentials.yaml");
    return existsSync(path) && readFileSync(path, "utf8").includes("MOCHI_AIAAA_API_KEY:");
  }, "saved teacher model credential");
  const saved = readFileSync(join(dshHome, ".credentials.yaml"), "utf8");
  assert.match(saved, /MOCHI_AIAAA_API_KEY:/);
  assert.equal(saved.includes(fixtureKey), true, "native editor must persist the fixture credential");

  await page.getByRole("button", { name: "关闭", exact: true }).first().click();
  await openWorkspace();
  await page.getByRole("button", { name: "新建会话", exact: true }).last().click();
  // Match the proven teacher live-UI fixture: DSH can mount the composer before
  // its contenteditable state is toggled, so target the stable test attribute.
  const composer = page.locator('[data-composer-input="true"]').filter({ visible: true }).last();
  await composer.waitFor({ state: "visible" });
  const modeToggle = page.locator('.mochi-modes-toggle:visible');
  await modeToggle.waitFor({ state: 'visible' });
  await modeToggle.getByRole('button', { name: '工作', exact: true }).click();
  await waitFor(async () => (await modeToggle.getAttribute('data-mode')) === 'work', 'work selected before first prompt');
  await composer.fill('验证工作模式，不执行任何操作。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const workRequest = await waitFor(() => requests.find(request => request.modeText.includes('工作模式')), 'host injects confirmed work mode');
  assert.ok(workRequest.tools.some(name => /^(?:bash|pwsh|file_read|file_write)$/u.test(name)), 'work request exposes actual work tools');
  await page.getByText('fixture', { exact: true }).last().waitFor();
  await modeToggle.getByRole('button', { name: '对话', exact: true }).click();
  await waitFor(async () => (await modeToggle.getAttribute('data-mode')) === 'chat', 'return to chat mode');
  await composer.fill(pairingPrompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const routed = await waitFor(() => requests.find((request) => request.path === "/v1/chat/completions" && request.hasPairingPrompt && !request.hasPairToolResult) || false, "teacher chat model request");
  assert.equal(routed.model, "deepseek-v4.1-flash");
  assert.match(routed.modeText, /当前会话模式：对话模式/u);
  assert.ok(routed.tools.includes("mochi_lan_pair_classroom"), "teacher chat must offer the pairing tool without switching menus");
  assert.equal(routed.tools.some((name) => /^(?:bash|pwsh|file_read|file_write|web_search)$/u.test(name)), false, "teacher chat must keep broad work tools behind Work mode");
  assert.equal(routed.authorizationMatchesFixture, true);

  const approval = page.locator("[data-approval-key]").last();
  await approval.waitFor({ state: "visible" });
  const approvalText = await approval.innerText();
  assert.match(approvalText, /将向教室/u);
  assert.match(approvalText, /指纹/u);
  await approval.getByRole("button", { name: "允许一次", exact: true }).click();

  const completed = await waitFor(() => requests.find((request) => request.path === "/v1/chat/completions" && request.hasPairingPrompt && request.hasPairToolResult) || false, "model continuation with LAN tool result");
  assert.equal(completed.authorizationMatchesFixture, true);
  assert.equal(completed.assistantToolCall?.function?.name, "mochi_lan_pair_classroom");
  assert.equal(completed.assistantToolCall?.id, pairCallId);
  assert.match(completed.toolResult, /"status":"pending"/u);
  assert.equal(gatewayFailure, "");

  const pending = await waitFor(() => classroom.snapshot().pendingPairings[0] || false, "signed classroom pairing request");
  assert.equal(pending.peer.role, "teacher");
  assert.equal(pending.peer.schoolId, fixtureSchool);
  assert.equal(pending.peer.fingerprint, fingerprint(classroom.snapshot().pendingPairings[0].peer.publicKey ?? JSON.parse(readFileSync(join(classroomHome, LAN_STATE_FILENAME), "utf8")).pendingIncoming[pending.requestId].publicKey));
  const classroomState = JSON.parse(readFileSync(join(classroomHome, LAN_STATE_FILENAME), "utf8"));
  const storedPending = classroomState.pendingIncoming[pending.requestId];
  assert.ok(storedPending, "verified pair request must be durably stored on the classroom service");
  assert.equal(storedPending.peer.fingerprint, pending.peer.fingerprint);
  assert.deepEqual(createPublicKey({ key: classroomState.identity.privateKey, format: "jwk" }).export({ format: "jwk" }), classroomState.identity.publicKey);
  assert.equal(classroomState.identity.fingerprint, fingerprint(classroomState.identity.publicKey));

  const teacherStateResponse = await page.evaluate(async () => {
    const response = await fetch("/api/mochi-lan/state", { credentials: "same-origin" });
    return { status: response.status, state: await response.json() };
  });
  assert.equal(teacherStateResponse.status, 200, "LAN state should be available through the authenticated desktop route");
  assert.equal(teacherStateResponse.state.identity.role, "teacher");
  assert.equal(teacherStateResponse.state.identity.fingerprint, storedPending.peer.fingerprint);
  await waitFor(async () => (await page.locator("body").innerText()).includes("等待教室端确认"), "chat completion after approved pairing request");
  assert.equal((await page.locator("body").innerText()).includes(fixtureKey), false);
  assert.equal((await page.locator("body").evaluate((element) => element.innerHTML)).includes(fixtureKey), false);
  assert.equal(output.includes(fixtureKey), false);
  const beforeSwitchBack = requests.length;
  await modeToggle.getByRole('button', { name: '工作', exact: true }).click();
  await waitFor(async () => (await modeToggle.getAttribute('data-mode')) === 'work', 'chat to work after a completed conversation');
  await composer.fill('再次验证工作模式，不执行任何操作。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const switchedBack = await waitFor(() => requests.slice(beforeSwitchBack).find(request => request.modeText.includes('工作模式')), 'model sees work mode after chatting');
  assert.ok(switchedBack.tools.some(name => /^(?:bash|pwsh|file_read|file_write)$/u.test(name)));

  console.log(JSON.stringify({ result: "PASS", modeBeforeFirstPrompt: true, chatWorkPromptAndToolsConsistent: true, role: "teacher", provider: "mochi-aiaaa", model: routed.model, modelToolCall: "mochi_lan_pair_classroom", approvalClicked: true, signedPairRequestStoredByClassroom: true, authenticatedTeacherLanState: true, classroomAcceptanceStillRequired: true, credentialEcho: false }));
}

try {
  await run();
} catch (error) {
  const body = page ? redact((await page.locator("body").innerText().catch(() => "")).slice(0, 3_000)) : "renderer unavailable";
  console.error(`[test-chat-lan-live-ui] FAIL: ${redact(error?.stack ?? error)}\nUI state:\n${body}\nRequests:\n${JSON.stringify(requests.map((request) => ({ ...request, toolResult: request.toolResult.slice(0, 1_000) })))}\nGateway error:\n${redact(gatewayFailure)}\nElectron output:\n${redact(output.slice(-3_000))}`);
  process.exitCode = 1;
} finally {
  if (browser) await Promise.race([browser.close().catch(() => {}), pause(3_000)]);
  if (electron && electron.exitCode === null && electron.signalCode === null) {
    electron.kill("SIGTERM");
    await Promise.race([once(electron, "exit"), pause(5_000)]);
    if (electron.exitCode === null && electron.signalCode === null) electron.kill("SIGKILL");
  }
  if (gateway?.listening) await new Promise((resolve) => gateway.close(resolve));
  if (classroom) await classroom.stop().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
