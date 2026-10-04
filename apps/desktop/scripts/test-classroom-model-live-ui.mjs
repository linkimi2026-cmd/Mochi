#!/usr/bin/env node
/**
 * Opens an isolated classroom Electron app and verifies first-run chat-led LAN
 * setup guidance and the MiMo Models card through the real renderer UI. The fake gateway and
 * fixture credential are local to a disposable DSH_HOME and never use provider
 * credentials inherited from the developer shell.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
const resourceSource = join(desktopRoot, "resources", "mochi-web");
const fixtureDeepSeekKey = "fixture-classroom-deepseek-a-key-never-real";
const fixtureKey = "fixture-classroom-mimo-b-key-never-real";
const timeoutMs = 90_000;
const root = mkdtempSync(join(tmpdir(), "mochi-classroom-live-ui-"));
const fixtureResources = join(root, "resources");
const fixtureWorkspace = join(root, "workspace");
const dshHome = join(root, "dsh-classroom");
const userData = join(root, "electron-user-data");
const debugPort = await freePort();
const fakeRequests = [];
let fakeServer;
let electron;
let browser;
let output = "";
let initialOutput = "";
const requestCounts = new Map();
const requestFailures = [];
let page;
let doctorResponse = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string", "debug server must expose a port");
  server.close();
  await once(server, "close");
  return address.port;
}

async function waitFor(predicate, description, timeout = timeoutMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw new Error(`${description} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

function safe(value) {
  return [fixtureDeepSeekKey, fixtureKey].reduce(
    (result, key) => result.split(key).join("[fixture credential redacted]"),
    String(value),
  );
}

function collectOutput(child) {
  const append = (chunk) => {
    const message = safe(chunk.toString());
    initialOutput = `${initialOutput}${message}`.slice(0, 8_192);
    output = `${output}${message}`.slice(-32_768);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), wait(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function connectMainPage(chromium) {
  await waitFor(async () => {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
      return browser;
    } catch {
      return false;
    }
  }, "Electron CDP endpoint");
  return await waitFor(() => {
    const candidate = browser.contexts().flatMap((context) => context.pages())
      .find((item) => /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url()));
    if (candidate) return candidate;
    return false;
  }, "classroom main renderer");
}

function prepareFixtureResources() {
  assert.equal(existsSync(resourceSource), true, "Mochi runtime resources must exist");
  cpSync(resourceSource, fixtureResources, { recursive: true });
  const profilePath = join(fixtureResources, "runtime-profile.json");
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const mimo = profile.plugins?.["mochi-llm-mimo"]?.initialConfig;
  assert.ok(mimo, "fixture runtime profile must contain mochi-llm-mimo initialConfig");
  mimo.baseURL = "http://127.0.0.1:0/v1";
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  const corePatchPath = join(fixtureResources, "patches", "core.patch.yml");
  const corePatch = readFileSync(corePatchPath, "utf8");
  const defaultModel = "  config:\n    provider: mochi-mimo\n    model: mimo-v2.5";
  assert.ok(corePatch.includes(defaultModel), "fixture profile must start with the classroom MiMo default");
  writeFileSync(corePatchPath, corePatch.replace(defaultModel, "  config:\n    provider: deepseek-official\n    model: deepseek-v4-flash"));
  return profilePath;
}

function patchFixtureEndpoint(profilePath, origin) {
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  profile.plugins["mochi-llm-mimo"].initialConfig.baseURL = `${origin}/v1`;
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
}

async function startFakeGateway() {
  fakeServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let model = "";
    try {
      model = JSON.parse(Buffer.concat(chunks).toString("utf8")).model ?? "";
    } catch {
      // Record malformed calls too, without retaining request content.
    }
    fakeRequests.push({
      method: request.method,
      path: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      authorizationMatchesDeepSeekFixture: request.headers.authorization === `Bearer ${fixtureDeepSeekKey}`,
      authorizationMatchesMiMoFixture: request.headers.authorization === `Bearer ${fixtureKey}`,
      model,
    });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end([
      'data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"fixture"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ].join(""));
  });
  fakeServer.listen(0, "127.0.0.1");
  await once(fakeServer, "listening");
  const address = fakeServer.address();
  assert.ok(address && typeof address !== "string", "fake gateway must expose a port");
  return `http://127.0.0.1:${address.port}`;
}

async function waitForModel(label, description) {
  await waitFor(async () => {
    const selector = page.locator('button[aria-label^="选择模型"]').filter({ visible: true }).last();
    return (await selector.count()) > 0 && (await selector.getAttribute("aria-label"))?.includes(label);
  }, description);
}

async function renameActiveSession(title) {
  const active = page.locator('[role="treeitem"][aria-selected="true"]').last();
  await active.waitFor({ state: "visible" });
  await active.hover();
  await active.getByRole("button", { name: /会话“.*”的操作/ }).click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "重命名会话" });
  const nameInput = dialog.getByRole("textbox", { name: "会话名称", exact: true });
  await nameInput.fill(title);
  await dialog.getByRole("button", { name: "重命名", exact: true }).click();
  await waitFor(() => page.getByRole("treeitem").filter({ hasText: title }).count(), "renamed session row");
}

async function reopenSession(title, modelLabel) {
  await page.getByRole("button", { name: "新建会话", exact: true }).last().click();
  await page.locator('[data-composer-input="true"][contenteditable="true"]').filter({ visible: true }).last().waitFor({ state: "visible" });
  const session = page.getByRole("treeitem").filter({ hasText: title });
  await session.waitFor({ state: "visible" });
  await session.click();
  await waitForModel(modelLabel, "reopened session model selection");
}

async function run() {
  assert.equal(existsSync(electronBin), true, "installed Electron binary is required");
  const profilePath = prepareFixtureResources();
  const origin = await startFakeGateway();
  patchFixtureEndpoint(profilePath, origin);
  for (const directory of ["home", "tmp", "config"]) mkdirSync(join(root, directory), { recursive: true });
  mkdirSync(dshHome, { recursive: true });
  mkdirSync(userData, { recursive: true });
  mkdirSync(fixtureWorkspace, { recursive: true });

  const minimalEnv = {
    PATH: process.env.PATH ?? "",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    TMP: join(root, "tmp"),
    TEMP: join(root, "tmp"),
    XDG_CONFIG_HOME: join(root, "config"),
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: "1",
    DEEPSEEK_BASE_URL: `${origin}/v1`,
    MOCHI_RUNTIME_ROLE: "classroom",
    MOCHI_DIRECTORY_PICKER: "browse",
    MOCHI_RUNTIME_RESOURCES: fixtureResources,
    MOCHI_NO_SANDBOX: "1",
  };
  electron = spawn(electronBin, [
    ".",
    "--no-sandbox",
    "--disable-gpu",
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${debugPort}`,
  ], { cwd: desktopRoot, env: minimalEnv, stdio: ["ignore", "pipe", "pipe"] });
  collectOutput(electron);

  const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
  const { chromium } = requireFromDesktop("playwright");
  page = await connectMainPage(chromium);
  page.on("console", (message) => {
    output = safe(`${output}\n[renderer:${message.type()}] ${message.text()}`.slice(-32_768));
  });
  page.on("pageerror", (error) => {
    output = safe(`${output}\n[renderer-error] ${error.message}`.slice(-32_768));
  });
  page.on("request", (request) => {
    try {
      const path = new URL(request.url()).pathname;
      requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
    } catch {}
  });
  page.on("requestfailed", (request) => {
    try {
      requestFailures.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText });
      if (requestFailures.length > 20) requestFailures.shift();
    } catch {}
  });
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname !== "/api/mochi-doctor/check-model") return;
    doctorResponse = { status: response.status(), body: safe(await response.text().catch(() => "")) };
  });

  // Accept the actual first-run disclosure and defer the unrelated DeepSeek key.
  await page.getByRole("button", { name: "继续", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "稍后配置", exact: true }).click();

  // Identity is now configured by chatting with Mochi. The LAN panel remains
  // read-only and guides that first conversation; this fixture does not ask its
  // offline fake model to perform a real identity write.
  await page.locator('button[aria-label^="教室连接"]').click();
  const lanPanel = page.getByRole("dialog", { name: "教室连接" });
  await lanPanel.getByText("直接发消息，就能处理日常事情").waitFor({ state: "visible" });
  assert.equal(await lanPanel.locator("input, textarea, select").count(), 0, "LAN panel must not duplicate the chat input");
  assert.match(await lanPanel.innerText(), /教室身份设置.*告诉 Mochi|本机教室身份设置/, "the classroom must have chat-led first-use guidance");
  if (process.env.MOCHI_LAN_CHAT_SCREENSHOT) {
    mkdirSync(dirname(process.env.MOCHI_LAN_CHAT_SCREENSHOT), { recursive: true });
    await lanPanel.screenshot({ path: process.env.MOCHI_LAN_CHAT_SCREENSHOT });
  }
  await lanPanel.getByRole("button", { name: "关闭教室连接状态" }).click();

  // Save model A's isolated fixture key first; model B remains unconfigured
  // until the existing session has completed its first turn.
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型", exact: true }).click();
  const deepSeekKeyInputA = page.locator('input[type="password"]').filter({ visible: true }).first();
  await deepSeekKeyInputA.waitFor({ state: "visible" });
  await deepSeekKeyInputA.fill(fixtureDeepSeekKey);
  const deepSeekRowA = deepSeekKeyInputA.locator("xpath=ancestor::*[.//button[normalize-space()='保存']][1]");
  await deepSeekRowA.getByRole("button", { name: "保存", exact: true }).click();
  await waitFor(() => {
    const path = join(dshHome, ".credentials.yaml");
    return existsSync(path) && readFileSync(path, "utf8").includes("DEEPSEEK_API_KEY:");
  }, "saved classroom model A fixture credential");
  assert.equal(readFileSync(join(dshHome, ".credentials.yaml"), "utf8").includes(fixtureDeepSeekKey), true, "model A fixture credential must be saved through the native editor");
  await page.getByRole("button", { name: "关闭", exact: true }).first().click();

  // The native macOS picker is not capturable through renderer CDP. This
  // disposable run pins the already-supported browse surface, whose normal UI
  // lets the test operator enter the temporary workspace path.
  let workspacePickerResult = "not reached";
  let firstSessionRequest = null;
  let sessionRequest = null;
  let connectionProbe = null;
  const sessionTitle = "教室模型切换持久化回归会话";
  const workspacePicker = page.getByRole("button", { name: "选择工作区", exact: true });
  assert.ok(await workspacePicker.count(), "first-run workspace picker must be available");
  if (await workspacePicker.count()) {
    await workspacePicker.click({ timeout: 5_000 });
    await page.getByRole("heading", { name: "选择工作区目录", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "编辑路径", exact: true }).click();
    const pathInput = page.getByRole("textbox", { name: "编辑路径", exact: true });
    await pathInput.fill(fixtureWorkspace);
    await pathInput.press("Enter");
    await page.getByRole("button", { name: "编辑路径", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "打开", exact: true }).click();
    workspacePickerResult = "temporary workspace opened through the in-app directory browser";
    await page.getByRole("heading", { name: "选择工作区目录", exact: true }).waitFor({ state: "hidden", timeout: 15_000 });
    await waitFor(async () => !(await page.locator("body").innerText()).includes("选择工作区开始"), "workspace activation");

    await page.getByRole("button", { name: "新建会话", exact: true }).last().click();
    await wait(1_000);
    const starters = page.getByRole("button", { name: /^填入聊天框：/ });
    await starters.first().waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(await starters.count(), 3, "a blank conversation should show three chat-first examples");
    if (process.env.MOCHI_CHAT_SCREENSHOT) {
      mkdirSync(dirname(process.env.MOCHI_CHAT_SCREENSHOT), { recursive: true });
      await page.screenshot({ path: process.env.MOCHI_CHAT_SCREENSHOT });
    }
    await starters.first().click();
    const suggestedDraft = page.locator('[data-composer-input="true"]').filter({ visible: true }).last();
    assert.match(await suggestedDraft.innerText(), /整理这节课的重点/, "starter must fill the native composer draft");
    await suggestedDraft.fill("Isolated classroom model A routing check.");
    const beforeFirstTurn = fakeRequests.length;
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    firstSessionRequest = await waitFor(() => fakeRequests.slice(beforeFirstTurn).find((request) => request.path === "/v1/chat/completions") || false, "existing-session model A request", 25_000);
    assert.equal(firstSessionRequest.method, "POST");
    assert.equal(firstSessionRequest.model, "deepseek-v4-flash");
    assert.equal(firstSessionRequest.authorizationMatchesDeepSeekFixture, true, "model A must use only the disposable DeepSeek fixture key");
    await page.getByText("fixture", { exact: true }).last().waitFor({ state: "visible" });
    await renameActiveSession(sessionTitle);

    // Only after the A turn exists, save B's MiMo fixture key through the
    // native classroom Models editor and probe the same local fake endpoint.
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    const secretInput = page.locator('input[aria-label="MiMo API Key"]');
    await secretInput.waitFor({ state: "visible" });
    await secretInput.fill(fixtureKey);
    await page.getByRole("button", { name: "保存 MiMo API Key", exact: true }).click();
    const saveFeedback = await waitFor(async () => {
      const text = await page.locator("body").innerText();
      return /MiMo API Key 已保存在本机凭据库中|密钥未能保存/.test(text) ? text : false;
    }, "saved MiMo B credential status", 20_000);
    assert.match(saveFeedback, /MiMo API Key 已保存在本机凭据库中/, "B fixture credential must save through the real UI");
    const beforeConnectionProbe = fakeRequests.length;
    await page.getByRole("button", { name: "测试 MiMo 连接", exact: true }).click();
    await waitFor(async () => {
      const text = await page.locator("body").innerText();
      return /MiMo 连接测试成功|模型服务已响应|已通过最小验证/.test(text) ? text : false;
    }, "MiMo connection result", 35_000);
    connectionProbe = await waitFor(() => fakeRequests.slice(beforeConnectionProbe).find((request) => request.path === "/v1/chat/completions") || false, "MiMo B connection probe", 25_000);
    assert.equal(connectionProbe.authorizationMatchesMiMoFixture, true, "MiMo probe must use the just-saved B credential");

    const defaultAction = page.getByRole("button", { name: /设为新对话默认模型|设为默认模型/, exact: false });
    if (await defaultAction.count()) {
      await defaultAction.first().click();
      await waitFor(async () => /当前新对话默认模型：\s*mochi-mimo\s*\/\s*mimo-v2\.5/.test(await page.locator("body").innerText()), "MiMo new-conversation default");
    } else {
      assert.match(await page.locator("body").innerText(), /已是新对话默认模型/, "MiMo should be the new-conversation default");
    }

    await page.getByRole("button", { name: "关闭", exact: true }).first().click();
    const modelControl = page.locator('button[aria-label^="选择模型"]').filter({ visible: true }).last();
    await modelControl.click();
    await page.getByRole("menuitem", { name: /^模型/ }).click();
    const modelOption = page.getByRole("menuitemradio", { name: /^mimo-v2\.5$/i });
    await modelOption.waitFor({ state: "visible" });
    await modelOption.click();
    await waitForModel("mimo-v2.5", "B model shown for existing classroom session");

    const composerB = page.locator('[data-composer-input="true"]').filter({ visible: true }).last();
    const beforeSecondTurn = fakeRequests.length;
    await composerB.fill("Isolated classroom model B routing check in the same session.");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    sessionRequest = await waitFor(() => fakeRequests.slice(beforeSecondTurn).find((request) => request.path === "/v1/chat/completions" && request.model === "mimo-v2.5") || false, "existing-session model B request", 25_000);
    assert.equal(sessionRequest.authorizationMatchesMiMoFixture, true, "model B request must use the just-saved MiMo fixture key");
    await page.getByText("fixture", { exact: true }).last().waitFor({ state: "visible" });

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await waitFor(async () => {
      const text = await page.locator("body").innerText();
      return text.includes("当前会话模型：mochi-mimo / mimo-v2.5") ? text : false;
    }, "current-session model guidance");
    const finalText = await page.locator("body").innerText();
    const finalHtml = await page.locator("body").evaluate((element) => element.innerHTML);
    assert.equal([fixtureDeepSeekKey, fixtureKey].some((key) => finalText.includes(key)), false, "the current-session UI must not echo fixture credentials");
    assert.equal([fixtureDeepSeekKey, fixtureKey].some((key) => finalHtml.includes(key)), false, "the current-session DOM must not serialize fixture credentials");
    assert.equal([fixtureDeepSeekKey, fixtureKey].some((key) => output.includes(key)), false, "current-session Electron and renderer output must not echo fixture credentials");
    await page.getByRole("button", { name: "关闭", exact: true }).first().click();
    await reopenSession(sessionTitle, "mimo-v2.5");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await waitFor(async () => (await page.locator("body").innerText()).includes("当前会话模型：mochi-mimo / mimo-v2.5"), "persisted B model after reopening classroom session");
    workspacePickerResult = "workspace selected; model A turn created, then model B switched and reopened in the same session";
  }

  console.log(JSON.stringify({
    result: "PASS",
    firstRun: "accepted disclosure and deferred unrelated provider setup",
    lanIdentity: "first-use chat guidance visible; no identity form in the LAN panel",
    models: "saved MiMo B fixture credential and completed its connection probe after the existing session's DeepSeek A turn",
    gateway: { method: connectionProbe.method, path: connectionProbe.path, model: connectionProbe.model, authorizationMatchesMiMoFixture: connectionProbe.authorizationMatchesMiMoFixture },
    modelARequest: { method: firstSessionRequest.method, path: firstSessionRequest.path, model: firstSessionRequest.model, authorizationMatchesDeepSeekFixture: firstSessionRequest.authorizationMatchesDeepSeekFixture },
    modelBRequest: { method: sessionRequest.method, path: sessionRequest.path, model: sessionRequest.model, authorizationMatchesMiMoFixture: sessionRequest.authorizationMatchesMiMoFixture },
    credentialEcho: "absent from rendered text, HTML serialization, and process/renderer output",
    newConversationDefault: "mochi-mimo / mimo-v2.5",
    workspaceOptions: "real session model menu switched the existing session from DeepSeek to MiMo",
    workspacePickerResult,
    currentSessionModel: "mochi-mimo / mimo-v2.5",
    currentSessionGuidance: "verified after reopening the renamed existing session",
  }));
}

try {
  await run();
} catch (error) {
  const safeError = safe(error?.stack ?? error);
  const safeBody = page ? safe((await page.locator("body").innerText().catch(() => "")).slice(0, 2_000)) : "renderer not available";
  const gatewayEvidence = fakeRequests.map(({ method, path, authorizationMatchesDeepSeekFixture, authorizationMatchesMiMoFixture, model }) => ({ method, path, authorizationMatchesDeepSeekFixture, authorizationMatchesMiMoFixture, model }));
  console.error(`[test-classroom-model-live-ui] FAIL: ${safeError}\nUI state:\n${safeBody}\nDoctor response:\n${safe(JSON.stringify(doctorResponse))}\nFake gateway requests:\n${JSON.stringify(gatewayEvidence)}\nRequest counts:\n${JSON.stringify([...requestCounts].sort((a, b) => b[1] - a[1]).slice(0, 20))}\nRequest failures:\n${JSON.stringify(requestFailures)}\nInitial Electron output:\n${safe(initialOutput)}\nRecent Electron output:\n${safe(output.slice(-5_000))}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await stopChild(electron);
  if (fakeServer?.listening) await new Promise((resolve) => fakeServer.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
