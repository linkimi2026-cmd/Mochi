#!/usr/bin/env node
/** Exercise one natural-language teacher request through real DSH tools and the PDF viewer. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const { renderSettingsDefaults } = requireFromDesktop("./scripts/seed-packaging-keys.cjs");
const { chromium } = requireFromDesktop("playwright");
const electronBin = requireFromDesktop("electron");
const resourceSource = join(desktopRoot, "resources", "mochi-web");
const packagedResources = process.env.MOCHI_TEST_PACKAGED_RESOURCES;
const root = realpathSync(mkdtempSync(join(tmpdir(), "mochi-presentation-chat-live-ui-")));
const fixtureResources = join(root, "resources");
const fixtureWorkspace = join(root, "workspace");
const dshHome = join(root, "dsh-teacher");
const userData = join(root, "electron-user-data");
const fixtureKey = "fixture-teacher-presentation-chat-key-never-real";
const userPrompt = "请帮我准备一份七年级科学课件，讲清一滴水如何经历蒸发、凝结和降水，最后给学生一个能在教室里完成的观察任务。";
const callIds = {
  create: "call_fixture_teacher_ppt_create",
  inspect: "call_fixture_teacher_ppt_inspect",
};
const requests = [];
const gatewayErrors = [];
let gateway;
let electron;
let browser;
let page;
let output = "";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (value) => String(value).split(fixtureKey).join("[fixture credential redacted]");

async function waitFor(predicate, label, timeoutMs = 45_000) {
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

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item?.text === "string" ? item.text : "").join("\n");
  return "";
}

function parseToolResult(message) {
  let value = contentText(message?.content);
  for (let depth = 0; depth < 4 && typeof value === "string"; depth += 1) {
    try { value = JSON.parse(value); } catch { return value; }
  }
  return value;
}

function toolNames(payload) {
  return Array.isArray(payload.tools) ? payload.tools.map((tool) => tool.function?.name).filter(Boolean) : [];
}

function toolSchemaHashes(payload) {
  return Array.isArray(payload.tools) ? payload.tools.map((tool) => createHash("sha256")
    .update(JSON.stringify(tool))
    .digest("hex")) : [];
}

function hasUserPrompt(messages) {
  return messages.some((message) => message.role === "user" && contentText(message.content).includes(userPrompt));
}

function toolResult(messages, id) {
  return messages.find((message) => message.role === "tool" && message.tool_call_id === id);
}

function textStream(text) {
  return [
    'data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n',
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");
}

function toolCallStream(id, name, args) {
  return [
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
}

function naturalLanguageSlides() {
  // This deterministic payload stands in for model reasoning: the test proves
  // only this scripted path, not real-model semantics or subject-matter accuracy.
  return [
    { layout: "cover", heading: "一滴水的旅行", bullets: ["认识蒸发、凝结和降水"] },
    {
      layout: "title-process",
      heading: "水在自然界中的变化",
      bullets: [],
      process: { steps: [
        { label: "蒸发", detail: "太阳加热水面，液态水变成水蒸气。" },
        { label: "凝结", detail: "水蒸气上升遇冷，聚成小水滴。" },
        { label: "降水", detail: "小水滴聚集后落回地面。" },
      ] },
    },
    { layout: "title-body", heading: "做一次教室观察", bullets: ["在透明杯中放入少量温水并盖上冷盖。", "观察盖子内侧的小水滴，画下变化并说出证据。"] },
  ];
}

async function handleModelRequest(payload, incoming) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const names = toolNames(payload);
  const createResult = toolResult(messages, callIds.create);
  const inspectResult = toolResult(messages, callIds.inspect);
  const record = {
    path: new URL(incoming.url ?? "/", "http://127.0.0.1").pathname,
    model: payload.model ?? "",
    tools: names,
    toolSchemaHashes: toolSchemaHashes(payload),
    authorizationMatchesFixture: incoming.headers.authorization === `Bearer ${fixtureKey}`,
    hasNaturalLanguageRequest: hasUserPrompt(messages),
    hasCreateResult: Boolean(createResult),
    hasInspectResult: Boolean(inspectResult),
  };
  requests.push(record);
  if (record.path !== "/v1/chat/completions" || !record.hasNaturalLanguageRequest) return textStream("fixture");
  // Some session-title or metadata calls carry the same user turn without tools.
  if (names.length === 0) return textStream("fixture");

  if (!createResult) {
    assert.ok(names.includes("mochi_ppt_create"), "teacher session must expose the real presentation tool");
    assert.ok(names.includes("ppt_inspect"), "teacher session must expose the real PPTX inspector");
    return toolCallStream(callIds.create, "mochi_ppt_create", {
      title: "一滴水的旅行：认识水循环",
      theme: "field",
      teachingPlan: {
        objectives: [{ id: "water-cycle", statement: "用观察证据说明蒸发、凝结和降水的关系" }],
        slideMappings: [
          { slideId: "slide-2", objectiveIds: ["water-cycle"], role: "过程解释" },
          {
            slideId: "slide-3",
            objectiveIds: ["water-cycle"],
            role: "观察与理解检查",
            studentAction: "观察冷盖内侧的小水滴并画下变化",
            understandingCheck: "能指出一条观察证据并解释凝结现象",
          },
        ],
      },
      slides: naturalLanguageSlides(),
      outputDirectory: join(fixtureWorkspace, "水循环自然语言课件"),
    });
  }

  if (!inspectResult) {
    const created = parseToolResult(createResult);
    assert.equal(created?.tool, "mochi_ppt_create", "DSH must return the actual presentation tool result to the model");
    assert.equal(created?.["完成"], true);
    assert.equal(created?.["教学覆盖"]?.status, "mapped", "natural-language chat should pass a declared goal and check through the real tool");
    assert.deepEqual(created?.["教学覆盖"]?.unmappedSlideIds, ["slide-1"], "the cover does not need a forced classroom action");
    assert.ok(created?.["产物"]?.pptx, "actual create result must include the emitted PPTX path");
    record.createResult = created;
    record.pptxPathFromToolResult = created["产物"].pptx;
    assert.ok(names.includes("ppt_inspect"));
    return toolCallStream(callIds.inspect, "ppt_inspect", { path: created["产物"].pptx });
  }

  const inspected = parseToolResult(inspectResult);
  assert.equal(inspected?.tool, "ppt_inspect", "DSH must return the actual inspector result to the model");
  assert.equal(inspected?.["文件"]?.真pptx, true, "the generated file must be recognized as a real PPTX");
  assert.equal(inspected?.页数, 3, "the generated deck should contain the three fixture-authored slides");
  record.inspectedSlideCount = inspected["页数"];
  return textStream("已根据你的自然语言需求生成三页水循环课件，并通过 PPTX 结构检查；可以打开预览继续核对画面。");
}

async function startGateway() {
  gateway = createServer(async (incoming, response) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const body = await handleModelRequest(payload, incoming);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(body);
    } catch (error) {
      gatewayErrors.push(redact(error?.stack ?? error));
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "fixture gateway failure" }));
    }
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  return `http://127.0.0.1:${gateway.address().port}`;
}

function prepareResources(origin) {
  assert.equal(existsSync(resourceSource), true, "teacher runtime resource tree is required");
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
  assert.equal(existsSync(join(seeds, "credentials-seed.json")), false, "test must not import packaged credentials");

  // Isolate the teacher's LAN listener as well as its DSH home and workspace.
  const runtimeProfilePath = join(fixtureResources, "runtime-profile.cjs");
  let runtimeProfile = readFileSync(runtimeProfilePath, "utf8");
  const lanConfig = 'dataRoot: join(homeDir, "mochi-lan"), lockedRole: role';
  assert.equal(runtimeProfile.split(lanConfig).length - 1, 1, "teacher runtime profile LAN config shape changed");
  runtimeProfile = runtimeProfile.replace(lanConfig, `${lanConfig}, bindHost: "127.0.0.1", port: 0, discoveryEnabled: false`);
  writeFileSync(runtimeProfilePath, runtimeProfile);
}

async function connectPage(port) {
  browser = await waitFor(async () => {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { return false; }
  }, "Electron CDP endpoint");
  return waitFor(() => browser.contexts().flatMap((context) => context.pages())
    .find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url())) || false, "teacher renderer", 110_000);
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
  assert.equal(existsSync(electronBin), true, "installed Electron binary is required");
  const origin = await startGateway();
  prepareResources(origin);
  for (const name of ["home", "tmp", "config"]) mkdirSync(join(root, name), { recursive: true });
  for (const path of [dshHome, userData, fixtureWorkspace]) mkdirSync(path, { recursive: true });
  const debugPort = await freePort();
  electron = spawn(electronBin, [".", "--no-sandbox", "--disable-gpu", `--user-data-dir=${userData}`, `--remote-debugging-port=${debugPort}`], {
    cwd: desktopRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
      XDG_CONFIG_HOME: join(root, "config"), DSH_HOME: dshHome,
      DEEPSEEK_BASE_URL: `${origin}/v1`,
      DSH_TELEMETRY_DISABLED: "1", MOCHI_RUNTIME_ROLE: "teacher",
      MOCHI_DIRECTORY_PICKER: "browse", MOCHI_RUNTIME_RESOURCES: fixtureResources,
      MOCHI_NO_SANDBOX: "1", MOCHI_LAN_DISCOVERY: "0",
      ...(packagedResources ? {
        MOCHI_PLUGIN_ROOT: join(packagedResources, "mochi", "plugins"),
        MOCHI_RUNTIME_NODE_MODULES: join(packagedResources, "app.asar.unpacked", "node_modules"),
        MOCHI_DSH_BIN: join(packagedResources, "app.asar.unpacked", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      } : {}),
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
  await row.locator('input[type="password"][aria-label="API 密钥"]').fill(fixtureKey);
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await waitFor(() => {
    const path = join(dshHome, ".credentials.yaml");
    return existsSync(path) && readFileSync(path, "utf8").includes("MOCHI_AIAAA_API_KEY:");
  }, "saved isolated fixture model credential");
  assert.equal(readFileSync(join(dshHome, ".credentials.yaml"), "utf8").includes(fixtureKey), true);

  await page.getByRole("button", { name: "关闭", exact: true }).first().click();
  await openWorkspace();
  await page.getByRole("button", { name: "新建会话", exact: true }).last().click();
  const composer = page.locator('[data-composer-input="true"]').filter({ visible: true }).last();
  await composer.waitFor({ state: "visible" });
  await composer.fill(userPrompt);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();

  const firstRequest = await waitFor(() => requests.find((request) => request.hasNaturalLanguageRequest && !request.hasCreateResult) || false, "natural-language teacher model request");
  assert.equal(firstRequest.path, "/v1/chat/completions");
  assert.equal(firstRequest.model, "deepseek-v4.1-flash");
  assert.equal(firstRequest.authorizationMatchesFixture, true);
  assert.equal(firstRequest.tools.includes("mochi_request_work_mode"), false, "removed mode-switch tool must not return");
  assert.ok(firstRequest.tools.includes("mochi_ppt_create"), "teacher task can use the real presentation tool immediately");
  assert.doesNotMatch(userPrompt, /第\s*\d+\s*页|slides\s*[:=]|\{\s*"/iu, "user input must stay natural language, without a page-by-page outline");

  const inspectedToolRequest = await waitFor(() => requests.find((request) => request.hasNaturalLanguageRequest && request.hasCreateResult && !request.hasInspectResult) || false, "model continuation receiving the executed PPTX result");
  assert.equal(inspectedToolRequest.authorizationMatchesFixture, true);
  assert.deepEqual(inspectedToolRequest.tools, firstRequest.tools, "tool catalog stays stable without a mode transition");
  assert.deepEqual(inspectedToolRequest.toolSchemaHashes, firstRequest.toolSchemaHashes, "full tool schemas stay unchanged");
  const finalRequest = await waitFor(() => requests.find((request) => request.hasNaturalLanguageRequest && request.hasInspectResult) || false, "model continuation receiving the real PPTX inspection");
  assert.equal(finalRequest.inspectedSlideCount, 3, "the final model request must follow a real three-slide inspection result");
  assert.equal(gatewayErrors.length, 0, `fixture SSE gateway errors: ${gatewayErrors.join("\n")}`);

  const finalResponse = "已根据你的自然语言需求生成三页水循环课件，并通过 PPTX 结构检查；可以打开预览继续核对画面。";
  await page.getByText(finalResponse, { exact: true }).waitFor({ state: "visible" });
  await page.getByText("2 次工具调用", { exact: true }).click();
  const toolCard = page.locator('.mochi-presentation-tool-card[data-tool="mochi_ppt_create"][data-state="ready"]').last();
  await toolCard.waitFor({ state: "visible" });
  const cardButtons = await toolCard.getByRole("button").allTextContents();
  assert.deepEqual(cardButtons, ["打开课件预览 PDF", "获取可编辑 PPTX"]);
  await waitFor(() => requests.find((request) => request.pptxPathFromToolResult) || false, "PPTX path from executed tool result");
  const createToolMessage = requests.find((request) => request.pptxPathFromToolResult);
  const pptxPath = createToolMessage.pptxPathFromToolResult;
  const createResult = createToolMessage.createResult;
  assert.ok(pptxPath.startsWith(fixtureWorkspace));
  assert.equal(existsSync(pptxPath), true, "the real plugin tool must create a file in the isolated workspace");
  assert.equal(readFileSync(pptxPath).subarray(0, 2).toString("ascii"), "PK", "created output must be a ZIP-based PPTX package");
  assert.ok(createResult["产物"].previewPdf, "create result must include the LibreOffice-derived preview PDF");
  const previewPdfPath = createResult["产物"].previewPdf;
  assert.equal(existsSync(previewPdfPath), true);
  assert.equal(readFileSync(previewPdfPath).subarray(0, 4).toString("ascii"), "%PDF");
  assert.equal(createResult["完成"], true);

  // The gateway receives the genuine ppt_inspect result from DSH before it returns
  // the final text. Assert the inspection request and actual file bytes above, then
  // open the generated PDF through the visible result card and the real host viewer.
  const inspectCallRequest = requests.find((request) => request.hasCreateResult && !request.hasInspectResult);
  assert.ok(inspectCallRequest?.tools.includes("ppt_inspect"));
  const openPreview = toolCard.getByRole("button", { name: "打开课件预览 PDF", exact: true });
  await openPreview.click();
  const pdfFrame = page.locator('iframe[src^="blob:"]').last();
  await pdfFrame.waitFor({ state: "visible" });
  assert.match(await pdfFrame.getAttribute("title") ?? "", /presentation-preview\.pdf|水循环/u);

  const bodyText = await page.locator("body").innerText();
  assert.ok(bodyText.includes(userPrompt), "the isolated teacher session should retain the submitted natural-language request");
  assert.equal(bodyText.includes(fixtureKey), false, "fixture model credential must not be echoed into the UI");
  assert.equal(output.includes(fixtureKey), false, "fixture model credential must not be echoed into process output");

  console.log(JSON.stringify({
    result: "PASS",
    role: "teacher",
    userInput: "one natural-language request; no per-slide outline",
    approvals: [],
    executedTool: "mochi_ppt_create",
    pptxExists: true,
    pptxInspected: true,
    slideCount: 3,
    previewPdfExists: true,
    previewOpenedInHostViewer: true,
    credentialEcho: false,
    limitation: "scripted fixture path only; does not establish real-model semantics or subject-matter accuracy",
  }));
}

try {
  await run();
} catch (error) {
  const body = page ? redact((await page.locator("body").innerText().catch(() => "")).slice(0, 3_000)) : "renderer unavailable";
  const pages = browser ? await Promise.all(browser.contexts().flatMap((context) => context.pages()).map(async (candidate) => ({
    url: candidate.url().slice(0, 160),
    body: redact((await candidate.locator("body").innerText().catch(() => "")).slice(0, 1_000)),
  }))) : [];
  console.error(`[test-presentation-chat-live-ui] FAIL: ${redact(error?.stack ?? error)}\nUI state:\n${body}\nPages:\n${JSON.stringify(pages)}\nRequests:\n${JSON.stringify(requests)}\nGateway errors:\n${gatewayErrors.join("\n")}\nElectron output:\n${redact(output.slice(-3_000))}`);
  process.exitCode = 1;
} finally {
  if (browser) await Promise.race([browser.close().catch(() => {}), pause(3_000)]);
  if (electron && electron.exitCode === null && electron.signalCode === null) {
    electron.kill("SIGTERM");
    await Promise.race([once(electron, "exit"), pause(5_000)]);
    if (electron.exitCode === null && electron.signalCode === null) electron.kill("SIGKILL");
  }
  if (gateway?.listening) await new Promise((resolve) => gateway.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
