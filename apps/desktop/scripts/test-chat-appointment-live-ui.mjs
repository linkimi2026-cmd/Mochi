#!/usr/bin/env node
/** Exercise a complete fixture appointment flow through two isolated Electron/DSH pages. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { MochiLanService } from "../../../plugins/mochi-lan/lan-service.mjs";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const { chromium } = requireFromDesktop("playwright");
const electronBin = requireFromDesktop("electron");
const { renderSettingsDefaults } = requireFromDesktop("./scripts/seed-packaging-keys.cjs");
const resourceSource = join(desktopRoot, "resources", "mochi-web");
const root = mkdtempSync(join(tmpdir(), "mochi-chat-appointment-live-ui-"));
const schoolId = "demo-school";
const classId = "class-01";
const teacherName = "示例班主任";
const classroomName = "高一（示例班）教室";
const studentName = "示例同学";
const appointmentSlot = "周五放学后 16:30";
const appointmentBody = "希望预约老师进行数学错题答疑。";
let teacherPairPrompt = "";
const classroomPairPrompt = "请查看教室是否收到同校教师发来的配对请求；如果有，请为该请求发起接受，并告诉我配对结果。";
const studentPrompt = `请帮我预约${appointmentSlot}的数学答疑，我叫${studentName}，想讨论最近的错题。`;
const teacherPrompt = "请查看教室刚发来的学生预约；如果希望时间是周五放学后 16:30，就按学生申请的原时间确认，并告诉我已经回复。";
const fixtureKeys = {
  teacher: "fixture-teacher-model-key-never-real",
  classroom: "fixture-classroom-model-key-never-real",
};
const callIds = {
  teacherPair: "call_fixture_teacher_pair_classroom",
  classroomPairStatus: "call_fixture_classroom_pair_status",
  classroomPairDecide: "call_fixture_classroom_decide_pairing",
  studentSend: "call_fixture_student_send_appointment",
  teacherRead: "call_fixture_teacher_read_requests",
  teacherReply: "call_fixture_teacher_reply_appointment",
};
const roleSetups = {};
const roleApps = {};
const requests = [];
const gatewayErrors = [];
let gateway;
let setupTeacher;
let setupClassroom;
let studentRequestId = "";
let teacherReadRequestId = "";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (value) => Object.values(fixtureKeys).reduce((text, key) => text.split(key).join("[fixture credential redacted]"), String(value));
// Match the DSH host's 90-second readiness limit; don't let the test outwait the product.
const DSH_RENDERER_TIMEOUT_MS = 90_000;

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

function parseToolValue(content) {
  let value = content;
  for (let depth = 0; depth < 4; depth += 1) {
    if (Array.isArray(value)) {
      value = value.map((item) => typeof item?.text === "string" ? item.text : "").join("\n");
      continue;
    }
    if (typeof value !== "string") return value;
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function toolNames(payload) {
  return Array.isArray(payload.tools) ? payload.tools.map((tool) => tool.function?.name).filter(Boolean) : [];
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

function requestRole(messages) {
  const scenario = requestScenario(messages);
  if (scenario === "student-appointment" || scenario === "classroom-pairing") return "classroom";
  if (scenario === "teacher-appointment" || scenario === "teacher-pairing") return "teacher";
  return "other";
}

function requestScenario(messages) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const prompt = contentText(message.content);
    if (prompt.includes(teacherPairPrompt)) return "teacher-pairing";
    if (prompt.includes(classroomPairPrompt)) return "classroom-pairing";
    if (prompt.includes(studentPrompt)) return "student-appointment";
    if (prompt.includes(teacherPrompt)) return "teacher-appointment";
  }
  return "other";
}

async function respondToModel(payload, incoming) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const role = requestRole(messages);
  const scenario = requestScenario(messages);
  const names = toolNames(payload);
  const authorizationMatchesFixture = role !== "other" && incoming.headers.authorization === `Bearer ${fixtureKeys[role]}`;
  requests.push({
    role,
    scenario,
    model: payload.model ?? "",
    tools: names,
    authorizationMatchesFixture,
    hasTeacherPairResult: Boolean(toolResult(messages, callIds.teacherPair)),
    hasClassroomPairStatusResult: Boolean(toolResult(messages, callIds.classroomPairStatus)),
    hasClassroomPairDecideResult: Boolean(toolResult(messages, callIds.classroomPairDecide)),
    hasStudentSendResult: Boolean(toolResult(messages, callIds.studentSend)),
    hasTeacherReadResult: Boolean(toolResult(messages, callIds.teacherRead)),
    hasTeacherReplyResult: Boolean(toolResult(messages, callIds.teacherReply)),
  });

  if (scenario === "teacher-pairing" && names.includes("mochi_lan_pair_classroom")) {
    const result = toolResult(messages, callIds.teacherPair);
    if (!result) {
      return toolCallStream(callIds.teacherPair, "mochi_lan_pair_classroom", {
        host: "127.0.0.1",
        port: roleSetups.classroom.port,
      });
    }
    const value = parseToolValue(result.content);
    assert.equal(value?.status, "pending", "teacher pairing tool continuation must report a pending classroom decision");
    return textStream("已向同校教室发起配对请求，正在等待教室端确认。");
  }

  if (scenario === "classroom-pairing" && names.includes("mochi_lan_status")) {
    const decision = toolResult(messages, callIds.classroomPairDecide);
    if (decision) return textStream("已接受教师的配对请求，双方设备现在已配对。");
    const status = toolResult(messages, callIds.classroomPairStatus);
    if (!status) return toolCallStream(callIds.classroomPairStatus, "mochi_lan_status", {});

    const state = parseToolValue(status.content);
    assert.equal(state?.configured, true, "classroom status tool must return the configured real fixture identity");
    assert.equal(state?.lockedRole, "classroom");
    assert.equal(state?.peers?.length, 0, "status must run before classroom pairing is accepted");
    const pending = Array.isArray(state?.pendingPairings) ? state.pendingPairings : [];
    assert.equal(pending.length, 1, "classroom status must expose exactly the signed incoming pairing request");
    assert.equal(pending[0].peer.role, "teacher");
    assert.equal(pending[0].peer.schoolId, schoolId);
    assert.ok(pending[0].requestId);
    return toolCallStream(callIds.classroomPairDecide, "mochi_lan_decide_pairing", {
      requestId: pending[0].requestId,
      action: "accept",
    });
  }

  if (role === "classroom" && names.includes("mochi_lan_send_student_request")) {
    const sent = toolResult(messages, callIds.studentSend);
    if (!sent) {
      return toolCallStream(callIds.studentSend, "mochi_lan_send_student_request", {
        teacherEndpointId: roleSetups.teacher.identity.endpointId,
        student: studentName,
        kind: "appointment",
        topic: "数学错题答疑",
        slot: appointmentSlot,
        body: appointmentBody,
      });
    }
    return textStream("已将预约请求发送给老师，正在等待老师确认。");
  }

  if (role === "teacher" && names.includes("mochi_lan_pending_requests")) {
    const replied = toolResult(messages, callIds.teacherReply);
    if (replied) return textStream("已确认示例同学的数学答疑预约，时间为周五放学后 16:30。\n\n回复已发送到教室：可以，按你申请的时间见面，一起看数学错题。\n\n这是演示数据；投递确认不代表学生已经阅读。");
    const read = toolResult(messages, callIds.teacherRead);
    if (!read) return toolCallStream(callIds.teacherRead, "mochi_lan_pending_requests", {});

    const value = parseToolValue(read.content);
    const candidates = Array.isArray(value?.requests) ? value.requests : [];
    const row = candidates.find((item) => item.request?.kind === "appointment" && item.request?.slot === appointmentSlot);
    assert.ok(row, "teacher model continuation must receive the real pending appointment and its requested slot");
    assert.equal(row.messageId, studentRequestId, "teacher read tool must return the classroom's original request ID");
    teacherReadRequestId = row.messageId;
    return toolCallStream(callIds.teacherReply, "mochi_lan_reply_student_request", {
      replyToMessageId: row.messageId,
      decision: "confirmed",
      body: "可以，按你申请的时间见面，一起看数学错题。",
    });
  }

  return textStream("数学答疑预约 · 演示");
}

async function startGateway() {
  gateway = createServer(async (incoming, response) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      // `respondToModel` is deliberately the only fake dependency: both role-specific
      // Mochi LAN services and their signed HTTP messages remain the real implementation.
      const body = await respondToModel(payload, incoming);
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

async function prepareFixtureServices(teacherHome, classroomHome) {
  const teacherSetupRoot = join(root, "lan-setup-teacher");
  const classroomSetupRoot = join(root, "lan-setup-classroom");
  setupTeacher = new MochiLanService({
    dataRoot: teacherSetupRoot, bindHost: "127.0.0.1", port: 0,
    discoveryEnabled: false, lockedRole: "teacher",
    identity: { schoolId, displayName: teacherName },
  });
  setupClassroom = new MochiLanService({
    dataRoot: classroomSetupRoot, bindHost: "127.0.0.1", port: 0,
    discoveryEnabled: false, lockedRole: "classroom",
    identity: { schoolId, classId, displayName: classroomName },
  });
  const [teacherState, classroomState] = await Promise.all([setupTeacher.start(), setupClassroom.start()]);
  assert.equal(teacherState.peers.length, 0, "fixture teacher must start unpaired");
  assert.equal(classroomState.peers.length, 0, "fixture classroom must start unpaired");
  assert.equal(classroomState.pendingPairings.length, 0, "fixture classroom must start without incoming pairing requests");

  roleSetups.teacher = { home: teacherHome, serviceRoot: teacherSetupRoot, port: teacherState.http.port, identity: teacherState.identity };
  roleSetups.classroom = { home: classroomHome, serviceRoot: classroomSetupRoot, port: classroomState.http.port, identity: classroomState.identity };
  teacherPairPrompt = `请在本地 Mochi 网络中向同校教室发起配对，教室服务地址是 127.0.0.1:${classroomState.http.port}。请告知我是否已发送待确认请求。`;
  await Promise.all([setupTeacher.stop(), setupClassroom.stop()]);
  setupTeacher = null;
  setupClassroom = null;
}

function prepareResources(role, origin, lanPort) {
  const destination = join(root, `resources-${role}`);
  assert.equal(existsSync(resourceSource), true);
  cpSync(resourceSource, destination, {
    recursive: true,
    filter(source) {
      const path = relative(resourceSource, source).replaceAll("\\", "/");
      return path !== "seeds" && !path.startsWith("seeds/");
    },
  });
  const profilePath = join(destination, "runtime-profile.cjs");
  let runtimeProfile = readFileSync(profilePath, "utf8");
  const lanConfig = 'dataRoot: join(homeDir, "mochi-lan"), lockedRole: role';
  assert.equal(runtimeProfile.split(lanConfig).length - 1, 1, `${role} runtime profile LAN config shape changed`);
  runtimeProfile = runtimeProfile.replace(lanConfig, `${lanConfig}, bindHost: "127.0.0.1", port: ${lanPort}, discoveryEnabled: false`);
  writeFileSync(profilePath, runtimeProfile);

  if (role === "teacher") {
    const seeds = join(destination, "seeds");
    mkdirSync(seeds, { recursive: true });
    const settings = renderSettingsDefaults();
    settings.visionProvider.baseURL = `${origin}/v1`;
    writeFileSync(join(seeds, "settings-defaults.json"), `${JSON.stringify(settings, null, 2)}\n`);
    assert.equal(existsSync(join(seeds, "credentials-seed.json")), false);
  } else {
    const profileJsonPath = join(destination, "runtime-profile.json");
    const profile = JSON.parse(readFileSync(profileJsonPath, "utf8"));
    const mimo = profile.plugins?.["mochi-llm-mimo"]?.initialConfig;
    assert.ok(mimo, "classroom runtime profile must include the existing MiMo model plugin");
    mimo.baseURL = `${origin}/v1`;
    writeFileSync(profileJsonPath, `${JSON.stringify(profile, null, 2)}\n`);
  }
  return destination;
}

function prepareRoleHome(role, resources) {
  const setup = roleSetups[role];
  const runtimeProfile = createRequire(join(resources, "runtime-profile.cjs"))(join(resources, "runtime-profile.cjs"));
  runtimeProfile.provisionMochiProfiles({
    homeDir: setup.home,
    resourceRoot: resources,
    skillsDir: join(dirname(dirname(desktopRoot)), "skills"),
    workspaceRoot: process.env.MOCHI_WORKSPACE_ROOT ?? dirname(dirname(desktopRoot)),
    runtimeNodeModulesRoot: join(desktopRoot, "node_modules"),
    role,
  });
  // The profile provisioner creates and locks the role marker before fixture
  // LAN state is copied into the exact MochiLanService dataRoot location.
  const targetLanRoot = join(setup.home, "mochi-lan", "mochi-lan");
  mkdirSync(dirname(targetLanRoot), { recursive: true });
  cpSync(join(setup.serviceRoot, "mochi-lan"), targetLanRoot, { recursive: true });
}

function startElectron(role, resources) {
  const home = roleSetups[role].home;
  const dshHome = home;
  const userData = join(home, "electron-user-data");
  const workspace = join(home, "workspace");
  for (const name of ["home", "tmp", "config", "electron-user-data", "workspace"]) {
    mkdirSync(join(home, name), { recursive: true });
  }
  const debugPortPromise = freePort();
  return debugPortPromise.then((debugPort) => {
    const child = spawn(electronBin, [".", "--no-sandbox", "--disable-gpu", `--user-data-dir=${userData}`, `--remote-debugging-port=${debugPort}`], {
      cwd: desktopRoot,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: join(home, "home"),
        TMPDIR: join(home, "tmp"), TMP: join(home, "tmp"), TEMP: join(home, "tmp"),
        XDG_CONFIG_HOME: join(home, "config"),
        DSH_HOME: dshHome,
        DSH_TELEMETRY_DISABLED: "1",
        MOCHI_RUNTIME_ROLE: role,
        MOCHI_DIRECTORY_PICKER: "browse",
        MOCHI_RUNTIME_RESOURCES: resources,
        MOCHI_WORKSPACE_ROOT: process.env.MOCHI_WORKSPACE_ROOT,
        MOCHI_CAMPUS_STATIC_ROOT: process.env.MOCHI_CAMPUS_STATIC_ROOT,
        MOCHI_NO_SANDBOX: "1",
        MOCHI_LAN_DISCOVERY: "0",
        ...(role === "teacher" ? { MOCHI_AIAAA_API_KEY: fixtureKeys.teacher } : { MIMO_API_KEY: fixtureKeys.classroom }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const app = { role, child, debugPort, browser: null, page: null, output: "", dshHome, workspace };
    const append = (chunk) => { app.output = redact(`${app.output}${chunk.toString()}`.slice(-16_384)); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    roleApps[role] = app;
    return app;
  });
}

async function connectPage(app) {
  app.browser = await waitFor(async () => {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${app.debugPort}`); } catch { return false; }
  }, `${app.role} Electron CDP endpoint`);
  const renderer = await waitFor(() => {
    const page = app.browser.contexts().flatMap((context) => context.pages())
      .find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url()));
    if (page) return { page };

    const startupError = app.output.match(/\[mochi\] Web Host 启动失败 \(([^)]+)\)/u)?.[1];
    if (startupError) return { failure: `Web Host startup failed (${startupError})` };
    if (app.child.exitCode !== null || app.child.signalCode !== null) {
      return { failure: `Electron exited (code=${String(app.child.exitCode)}, signal=${String(app.child.signalCode)})` };
    }
    return false;
  }, `${app.role} DSH renderer`, DSH_RENDERER_TIMEOUT_MS);
  if (renderer.failure) throw new Error(`${app.role} ${renderer.failure}`);
  app.page = renderer.page;
  if (process.env.MOCHI_DEMO_EVIDENCE_DIR) await app.page.setViewportSize({width:1440,height:1050});
  app.page.on("console", (message) => { app.output = redact(`${app.output}\n[renderer] ${message.text()}`.slice(-16_384)); });
  app.page.on("pageerror", (error) => { app.output = redact(`${app.output}\n[pageerror] ${error.message}`.slice(-16_384)); });
}

function concisePageUrl(value) {
  if (value.startsWith("data:")) return "data:[startup page]";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 240);
  } catch {
    return value.slice(0, 160);
  }
}

async function acceptFirstRun(app) {
  await app.page.getByRole("button", { name: "继续", exact: true }).waitFor({ state: "visible" });
  await app.page.getByRole("button", { name: "继续", exact: true }).click();
  const deferModelSetup = app.page.getByRole("button", { name: "稍后配置", exact: true });
  if (await deferModelSetup.isVisible().catch(() => false)) await deferModelSetup.click();
}

async function openWorkspace(app) {
  const page = app.page;
  await page.getByRole("button", { name: "选择工作区", exact: true }).click();
  await page.getByRole("heading", { name: "选择工作区目录", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "编辑路径", exact: true }).click();
  const input = page.getByRole("textbox", { name: "编辑路径", exact: true });
  await input.fill(app.workspace);
  await input.press("Enter");
  await page.getByRole("button", { name: "编辑路径", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await page.getByRole("heading", { name: "选择工作区目录", exact: true }).waitFor({ state: "hidden" });
  await waitFor(async () => !(await page.locator("body").innerText()).includes("选择一个工作区开始"), `${app.role} workspace activation`);
}

async function sendPrompt(app, prompt, { newSession = true } = {}) {
  if (newSession) await app.page.getByRole("button", { name: "新建会话", exact: true }).last().click();
  const composer = app.page.locator('[data-composer-input="true"]').filter({ visible: true }).last();
  await composer.waitFor({ state: "visible" });
  await composer.fill(prompt);
  const send = app.page.getByRole("button", { name: "发送消息", exact: true });
  await waitFor(() => send.isEnabled(), `${app.role} message composer readiness`);
  await send.click();
}

async function readLanState(app) {
  return app.page.evaluate(async () => {
    const response = await fetch("/api/mochi-lan/state", { credentials: "same-origin" });
    return { status: response.status, state: await response.json() };
  });
}

async function verifyNoCredentialEcho(app) {
  const pageText = await app.page.locator("body").innerText();
  const pageHtml = await app.page.locator("body").evaluate((element) => element.innerHTML);
  assert.equal(fixtureKeys[app.role] && pageText.includes(fixtureKeys[app.role]), false, `${app.role} UI must not echo its fixture key`);
  assert.equal(pageHtml.includes(fixtureKeys[app.role]), false, `${app.role} HTML must not serialize its fixture key`);
  assert.equal(app.output.includes(fixtureKeys[app.role]), false, `${app.role} logs must not echo its fixture key`);
}

async function stopElectron(app) {
  if (!app) return;
  if (app.browser) await Promise.race([app.browser.close().catch(() => {}), pause(2_000)]);
  if (app.child && app.child.exitCode === null && app.child.signalCode === null) {
    app.child.kill("SIGTERM");
    await Promise.race([once(app.child, "exit"), pause(5_000)]);
    if (app.child.exitCode === null && app.child.signalCode === null) app.child.kill("SIGKILL");
  }
}

async function captureDemo(app, name) {
  const directory = process.env.MOCHI_DEMO_EVIDENCE_DIR;
  if (!directory) return;
  mkdirSync(directory, {recursive:true});
  await app.page.screenshot({path:join(directory,name+".png")});
}

async function run() {
  assert.equal(existsSync(electronBin), true, "installed Electron binary is required");
  const gatewayOrigin = await startGateway();
  const teacherHome = join(root, "teacher");
  const classroomHome = join(root, "classroom");
  mkdirSync(teacherHome, { recursive: true });
  mkdirSync(classroomHome, { recursive: true });
  await prepareFixtureServices(teacherHome, classroomHome);

  const teacherResources = prepareResources("teacher", gatewayOrigin, roleSetups.teacher.port);
  const classroomResources = prepareResources("classroom", gatewayOrigin, roleSetups.classroom.port);
  prepareRoleHome("teacher", teacherResources);
  prepareRoleHome("classroom", classroomResources);
  // Start one cold DSH host at a time so the two role runtimes don't compete
  // for startup resources. Both remain separate, real Electron processes.
  const teacherApp = await startElectron("teacher", teacherResources);
  await connectPage(teacherApp);
  const classroomApp = await startElectron("classroom", classroomResources);
  await connectPage(classroomApp);
  await Promise.all([acceptFirstRun(teacherApp), acceptFirstRun(classroomApp)]);

  const [teacherState, classroomState] = await Promise.all([readLanState(teacherApp), readLanState(classroomApp)]);
  assert.equal(teacherState.status, 200);
  assert.equal(classroomState.status, 200);
  assert.equal(teacherState.state.identity.endpointId, roleSetups.teacher.identity.endpointId);
  assert.equal(classroomState.state.identity.endpointId, roleSetups.classroom.identity.endpointId);
  assert.equal(teacherState.state.http.port, roleSetups.teacher.port);
  assert.equal(classroomState.state.http.port, roleSetups.classroom.port);
  assert.equal(teacherState.state.peers.length, 0, "teacher Electron service must begin unpaired");
  assert.equal(classroomState.state.peers.length, 0, "classroom Electron service must begin unpaired");
  assert.equal(classroomState.state.pendingPairings.length, 0, "classroom Electron service must begin without a pending pairing request");

  await Promise.all([openWorkspace(teacherApp), openWorkspace(classroomApp)]);

  // The pairing request and acceptance must be driven by role-specific chat tool calls
  // in the real Electron renderers, with the real service approval cards clicked.
  await sendPrompt(teacherApp, teacherPairPrompt);
  const teacherPairCall = await waitFor(() => requests.find((item) => item.scenario === "teacher-pairing" && item.tools.includes("mochi_lan_pair_classroom")) || false, "teacher natural-language pairing tool request");
  assert.equal(teacherPairCall.model, "deepseek-v4.1-flash");
  assert.equal(teacherPairCall.authorizationMatchesFixture, true);
  assert.ok(teacherPairCall.tools.includes("mochi_lan_pair_classroom"));
  assert.equal(teacherPairCall.tools.some((name) => /^(?:bash|pwsh|file_read|file_write|web_search)$/u.test(name)), false, "teacher chat must keep broad work tools behind Work mode");

  const teacherPairApproval = teacherApp.page.locator("[data-approval-key]").last();
  await teacherPairApproval.waitFor({ state: "visible" });
  const teacherPairApprovalText = await teacherPairApproval.innerText();
  assert.match(teacherPairApprovalText, /将向教室/u);
  assert.match(teacherPairApprovalText, /指纹/u);
  await teacherPairApproval.getByRole("button", { name: "允许一次", exact: true }).click();

  const teacherPairContinuation = await waitFor(() => requests.find((item) => item.scenario === "teacher-pairing" && item.hasTeacherPairResult) || false, "teacher pairing tool result continuation");
  assert.equal(teacherPairContinuation.authorizationMatchesFixture, true);
  const classroomPendingPairing = await waitFor(async () => {
    const current = await readLanState(classroomApp);
    const pending = current.state.pendingPairings[0];
    return pending ? { current, pending } : false;
  }, "signed pairing request reaching the classroom Electron service");
  assert.equal(classroomPendingPairing.current.state.peers.length, 0, "teacher request must remain pending until classroom user approval");
  assert.equal(classroomPendingPairing.pending.peer.endpointId, roleSetups.teacher.identity.endpointId);
  assert.equal(classroomPendingPairing.pending.peer.fingerprint, roleSetups.teacher.identity.fingerprint);

  await sendPrompt(classroomApp, classroomPairPrompt);
  const classroomStatusCall = await waitFor(() => requests.find((item) => item.scenario === "classroom-pairing" && item.hasClassroomPairStatusResult) || false, "classroom status tool result with the pending teacher request");
  assert.equal(classroomStatusCall.model, "mimo-v2.5");
  assert.equal(classroomStatusCall.authorizationMatchesFixture, true);
  assert.ok(classroomStatusCall.tools.includes("mochi_lan_status"));
  const classroomDecideCall = await waitFor(() => requests.find((item) => item.scenario === "classroom-pairing" && item.hasClassroomPairStatusResult && item.tools.includes("mochi_lan_decide_pairing")) || false, "classroom natural-language pairing decision tool request");
  assert.equal(classroomDecideCall.authorizationMatchesFixture, true);
  assert.ok(classroomDecideCall.hasClassroomPairStatusResult, "classroom decision must follow a real LAN status tool result");

  const classroomPairApproval = classroomApp.page.locator("[data-approval-key]").last();
  await classroomPairApproval.waitFor({ state: "visible" });
  const classroomPairApprovalText = await classroomPairApproval.innerText();
  assert.match(classroomPairApprovalText, /接受教师/u);
  assert.match(classroomPairApprovalText, new RegExp(classroomPendingPairing.pending.requestId));
  await classroomPairApproval.getByRole("button", { name: "允许一次", exact: true }).click();

  const classroomPairContinuation = await waitFor(() => requests.find((item) => item.scenario === "classroom-pairing" && item.hasClassroomPairDecideResult) || false, "classroom pairing decision result continuation");
  assert.equal(classroomPairContinuation.authorizationMatchesFixture, true);
  const pairedStates = await waitFor(async () => {
    const [teacher, classroom] = await Promise.all([readLanState(teacherApp), readLanState(classroomApp)]);
    return teacher.state.peers.length === 1 && classroom.state.peers.length === 1 ? { teacher, classroom } : false;
  }, "both Electron LAN services completing classroom-approved pairing");
  assert.equal(pairedStates.teacher.state.peers[0].endpointId, roleSetups.classroom.identity.endpointId);
  assert.equal(pairedStates.classroom.state.peers[0].endpointId, roleSetups.teacher.identity.endpointId);
  assert.equal(pairedStates.teacher.state.peers[0].fingerprint, pairedStates.classroom.state.identity.fingerprint);
  assert.equal(pairedStates.classroom.state.peers[0].fingerprint, pairedStates.teacher.state.identity.fingerprint);
  await waitFor(async () => (await classroomApp.page.locator("body").innerText()).includes("已接受教师的配对请求，双方设备现在已配对。"), "classroom pairing chat completion after approval");

  await sendPrompt(classroomApp, studentPrompt, { newSession: false });
  const studentRequestCall = await waitFor(() => requests.find((item) => item.role === "classroom" && item.tools.includes("mochi_lan_send_student_request")) || false, "classroom appointment tool request");
  assert.equal(studentRequestCall.model, "mimo-v2.5");
  assert.equal(studentRequestCall.authorizationMatchesFixture, true);
  assert.ok(studentRequestCall.tools.includes("mochi_lan_send_student_request"));
  assert.equal(studentRequestCall.tools.some((name) => /^(?:bash|pwsh|file_read|file_write|web_search)$/u.test(name)), false, "classroom chat must keep broad work tools behind Work mode");

  const studentApproval = classroomApp.page.locator("[data-approval-key]").last();
  await studentApproval.waitFor({ state: "visible" });
  const studentApprovalText = await studentApproval.innerText();
  assert.ok(studentApprovalText.includes(teacherName));
  assert.match(studentApprovalText, new RegExp(appointmentSlot));
  assert.match(studentApprovalText, new RegExp(appointmentBody));
  await studentApproval.getByRole("button", { name: "允许一次", exact: true }).click();
  const classroomSendResult = await waitFor(async () => {
    const current = await readLanState(classroomApp);
    const row = current.state.outbox.find((item) => item.contentType === "REQUEST" && item.request?.slot === appointmentSlot);
    return row?.delivery === "ACKNOWLEDGED" ? { current, row } : false;
  }, "signed LAN delivery receipt for the approved appointment");
  studentRequestId = classroomSendResult.row.messageId;
  assert.ok(studentRequestId);
  assert.equal(classroomSendResult.row.request.kind, "appointment");
  assert.equal(classroomSendResult.row.request.student, studentName);
  assert.equal(classroomSendResult.row.request.slot, appointmentSlot);
  assert.equal(classroomSendResult.row.body, appointmentBody);
  const receivedRequest = await waitFor(async () => {
    const current = await readLanState(teacherApp);
    const row = current.state.inbox.find((item) => item.messageId === studentRequestId && item.contentType === "REQUEST");
    return row ? { current, row } : false;
  }, "teacher Electron service receiving the signed student appointment");
  assert.equal(receivedRequest.row.from.endpointId, roleSetups.classroom.identity.endpointId);
  assert.equal(receivedRequest.row.from.fingerprint, roleSetups.classroom.identity.fingerprint);
  assert.equal(receivedRequest.row.request.slot, appointmentSlot);
  assert.equal(gatewayErrors.length, 0, `model gateway errors: ${gatewayErrors.join("\n")}`);

  await sendPrompt(teacherApp, teacherPrompt, { newSession: false });
  const teacherReadCall = await waitFor(() => requests.find((item) => item.role === "teacher" && item.tools.includes("mochi_lan_pending_requests")) || false, "teacher natural-language request read");
  assert.equal(teacherReadCall.model, "deepseek-v4.1-flash");
  assert.equal(teacherReadCall.authorizationMatchesFixture, true);
  assert.ok(teacherReadCall.tools.includes("mochi_lan_reply_student_request"));
  await waitFor(() => teacherReadRequestId === studentRequestId, "teacher model parsing the actual pending request tool result");
  assert.equal(teacherReadRequestId, studentRequestId, "the scripted model must derive the reply target from the real pending-request tool result");

  const teacherApproval = teacherApp.page.locator("[data-approval-key]").last();
  await teacherApproval.waitFor({ state: "visible" });
  const teacherApprovalText = await teacherApproval.innerText();
  assert.match(teacherApprovalText, new RegExp(studentRequestId));
  assert.match(teacherApprovalText, new RegExp(appointmentSlot));
  assert.match(teacherApprovalText, new RegExp(appointmentBody));
  assert.match(teacherApprovalText, /confirmed|确认/u);
  await captureDemo(teacherApp, "01-预约回复-发送前确认-完整窗口");
  await teacherApproval.getByRole("button", { name: "允许一次", exact: true }).click();

  const teacherReplyToolRequest = await waitFor(() => requests.find((item) => item.role === "teacher" && item.hasTeacherReplyResult) || false, "teacher approved reply model continuation");
  assert.equal(teacherReplyToolRequest.authorizationMatchesFixture, true);
  const classroomResponse = await waitFor(async () => {
    const current = await readLanState(classroomApp);
    const row = current.state.inbox.find((item) => item.response?.replyToMessageId === studentRequestId);
    return row ? { current, row } : false;
  }, "classroom receiving the signed decision linked to its original request");
  assert.equal(classroomResponse.row.from.endpointId, roleSetups.teacher.identity.endpointId);
  assert.equal(classroomResponse.row.from.fingerprint, roleSetups.teacher.identity.fingerprint);
  assert.equal(classroomResponse.row.response.replyToMessageId, studentRequestId);
  assert.equal(classroomResponse.row.response.decision, "confirmed");
  assert.equal(classroomResponse.row.response.slot, appointmentSlot);
  assert.equal(classroomResponse.row.body, "可以，按你申请的时间见面，一起看数学错题。");
  const classroomOutbox = classroomResponse.current.state.outbox.find((item) => item.messageId === studentRequestId);
  assert.equal(classroomOutbox.request.slot, appointmentSlot, "signed classroom result must retain the original requested slot");

  await teacherApp.page.getByText("这是演示数据；投递确认不代表学生已经阅读。", {exact:false}).waitFor();
  await pause(1200);
  await captureDemo(teacherApp, "02-预约回复-已发送-完整窗口");
  await teacherApp.page.locator('button[aria-label^="教室连接"]').click();
  await pause(500);
  await captureDemo(teacherApp, "03-教室消息-完整窗口");
  if (!await classroomApp.page.getByRole("dialog", {name:"教室消息"}).isVisible()) await classroomApp.page.locator('button[aria-label^="教室连接"]').click();
  const lanPanel = classroomApp.page.getByRole("dialog", { name: "教室消息" });
  await lanPanel.getByText("我的请求进度", { exact: true }).waitFor({ state: "visible" });
  await lanPanel.getByRole("button", { name: "刷新", exact: true }).click();
  const panelText = await waitFor(async () => {
    const current = await lanPanel.innerText();
    return current.includes(appointmentBody) && current.includes(`确认时间：${appointmentSlot}`) ? current : false;
  }, "classroom request progress panel showing the signed decision and original slot");
  assert.match(panelText, /老师已确认/u);

  await Promise.all([verifyNoCredentialEcho(teacherApp), verifyNoCredentialEcho(classroomApp)]);
  assert.equal(gatewayErrors.length, 0, `model gateway errors: ${gatewayErrors.join("\n")}`);
  console.log(JSON.stringify({
    result: "PASS",
    isolatedElectronRoles: ["classroom", "teacher"],
    scriptedModelCalls: requests.filter((item) => item.role !== "other").length,
    modelBehavior: "deterministic fixture SSE responses; natural-language understanding is not evaluated",
    teacherChatRequestedPairing: true,
    classroomChatAcceptedPairing: true,
    bothElectronPeersPaired: true,
    studentAppointmentSentAfterApproval: true,
    signedLanDeliveryAcknowledged: true,
    teacherReadOriginalRequestAndSlot: true,
    teacherReplySentAfterApproval: true,
    classroomReceivedSignedDecisionForOriginalRequest: true,
    confirmedSlot: appointmentSlot,
    credentialEcho: false,
  }));
}

try {
  await run();
} catch (error) {
  const appState = {};
  for (const [role, app] of Object.entries(roleApps)) {
    appState[role] = app?.page
      ? redact((await app.page.locator("body").innerText().catch(() => "")).slice(0, 2_000))
      : app?.browser
        ? JSON.stringify(await Promise.all(app.browser.contexts().flatMap((context) => context.pages()).map(async (page) => ({
          url: concisePageUrl(page.url()),
          title: await page.title().catch(() => ""),
          body: redact((await page.locator("body").innerText().catch(() => "")).slice(0, 1_000)),
        }))))
        : "renderer unavailable";
  }
  console.error(`[test-chat-appointment-live-ui] FAIL: ${redact(error?.stack ?? error)}\nUI state: ${JSON.stringify(appState)}\nRequests: ${JSON.stringify(requests)}\nGateway errors: ${gatewayErrors.map(redact).join("\n")}\nElectron output: ${Object.entries(roleApps).map(([role, app]) => `${role}: ${redact(app.output.slice(-2_000))}`).join("\n")}`);
  process.exitCode = 1;
} finally {
  await Promise.all(Object.values(roleApps).map(stopElectron));
  if (setupTeacher) await setupTeacher.stop().catch(() => {});
  if (setupClassroom) await setupClassroom.stop().catch(() => {});
  if (gateway?.listening) await new Promise((resolve) => gateway.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
