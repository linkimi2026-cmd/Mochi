#!/usr/bin/env node
/** Exercise the teacher's native Models credential editor in an isolated Electron app. */
import assert from "node:assert/strict";
import { checkPaperAppearance } from "./paper-ui-checks.mjs";
import { checkHostSurfaces } from "./paper-host-surfaces.mjs";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const root = mkdtempSync(join(tmpdir(), "mochi-teacher-model-live-ui-"));
const fixtureResources = join(root, "resources");
const fixtureWorkspace = join(root, "workspace");
const dshHome = join(root, "dsh-teacher");
const userData = join(root, "electron-user-data");
const fixtureKey = "fixture-teacher-aiaaa-a-key-never-real";
const fixtureMiMoKey = "fixture-teacher-mimo-b-key-never-real";
const requests = [];
let gateway;
let electron;
let browser;
let page;
let output = "";
let sidebarRequested = false;
let sidebarReceipt = false;
let sidebarFileRequested = false;
let sidebarFileReceipt = false;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (value) => [fixtureKey, fixtureMiMoKey].reduce(
  (result, key) => result.split(key).join("[fixture credential redacted]"),
  String(value),
);

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
    if (request.url === '/sidebar-fixture') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="zh"><title>课件预览验收</title><body><h1>墨契侧边栏交付验收</h1><p>此页面来自隔离验收服务。</p></body></html>');
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let model = "";
    let tools = [];
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (process.env.MOCHI_SIDEBAR_LIVE === '1') {
        sidebarReceipt ||= (payload.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === 'sidebar_fixture_open');
        sidebarFileReceipt ||= (payload.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === 'sidebar_fixture_file');
      }
      model = payload.model ?? "";
      tools = Array.isArray(payload.tools) ? payload.tools.map((tool) => tool.function?.name).filter(Boolean) : [];
    } catch {}
    requests.push({
      path: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      model,
      tools,
      authorizationMatchesAiaaaFixture: request.headers.authorization === `Bearer ${fixtureKey}`,
      authorizationMatchesMiMoFixture: request.headers.authorization === `Bearer ${fixtureMiMoKey}`,
    });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.flushHeaders();
    if (process.env.MOCHI_SIDEBAR_LIVE === '1' && !sidebarRequested && tools.includes('sidebar_open')) {
      sidebarRequested = true;
      const args = JSON.stringify({ target: `http://127.0.0.1:${gateway.address().port}/sidebar-fixture`, title: '课件预览验收' });
      response.write(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'sidebar_fixture_open',type:'function',function:{name:'sidebar_open',arguments:args}}]},finish_reason:null}]})}\n\n`);
      response.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    if (process.env.MOCHI_SIDEBAR_LIVE === '1' && model === 'mimo-v2.5' && !sidebarFileRequested && tools.includes('sidebar_open')) {
      sidebarFileRequested = true;
      const args = JSON.stringify({ target: join(fixtureWorkspace, 'lesson-delivery.txt'), title: '课件说明验收' });
      response.write(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'sidebar_fixture_file',type:'function',function:{name:'sidebar_open',arguments:args}}]},finish_reason:null}]})}\n\n`);
      response.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    if (process.env.MOCHI_BLOUB_LIVE === '1') await pause(1_600);
    response.write('data: {"choices":[{"delta":{"role":"assistant","content":"演示内容已准备好，请在右侧查看。"}}]}\n\n');
    if (process.env.MOCHI_BLOUB_LIVE === '1') await pause(1_600);
    response.end('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
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
  const profilePath = join(fixtureResources, "runtime-profile.json");
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const mimo = profile.plugins?.["mochi-llm-mimo"]?.initialConfig;
  assert.ok(mimo, "fixture runtime profile must contain mochi-llm-mimo initialConfig");
  mimo.baseURL = `${origin}/v1`;
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  assert.equal(existsSync(join(seeds, "credentials-seed.json")), false);
}

async function connectPage(port) {
  browser = await waitFor(async () => {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { return false; }
  }, "Electron CDP endpoint");
  return await waitFor(() => browser.contexts().flatMap((context) => context.pages())
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
  await dialog.getByRole("textbox", { name: "会话名称", exact: true }).fill(title);
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
  assert.equal(existsSync(electronBin), true);
  const origin = await startGateway();
  prepareResources(origin);
  for (const name of ["home", "tmp", "config"]) mkdirSync(join(root, name), { recursive: true });
  for (const name of [dshHome, userData, fixtureWorkspace]) mkdirSync(name, { recursive: true });
  writeFileSync(join(fixtureWorkspace, 'lesson-delivery.txt'), '墨契课件文件交付验收\n这是隔离测试生成的文件。\n');
  if (process.env.MOCHI_SIDEBAR_FULL === '1') {
    execFileSync('git', ['init', fixtureWorkspace]);
    execFileSync('git', ['-C', fixtureWorkspace, 'add', 'lesson-delivery.txt']);
    execFileSync('git', ['-C', fixtureWorkspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial isolated lesson']);
  }
  const debugPort = await freePort();
  electron = spawn(electronBin, [".", "--no-sandbox", "--disable-gpu", `--user-data-dir=${userData}`, `--remote-debugging-port=${debugPort}`], {
    cwd: desktopRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
      XDG_CONFIG_HOME: join(root, "config"), DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: "1", MOCHI_RUNTIME_ROLE: "teacher",
      MOCHI_DIRECTORY_PICKER: "browse", MOCHI_RUNTIME_RESOURCES: fixtureResources,
      MOCHI_NO_SANDBOX: "1",
      ...(process.env.MOCHI_CAMPUS_STATIC_ROOT ? { MOCHI_CAMPUS_STATIC_ROOT: process.env.MOCHI_CAMPUS_STATIC_ROOT } : {}),
      ...(process.env.MOCHI_WORKSPACE_ROOT ? { MOCHI_WORKSPACE_ROOT: process.env.MOCHI_WORKSPACE_ROOT } : {}),
      ...(process.env.MOCHI_DSH_NODE ? { MOCHI_DSH_NODE: process.env.MOCHI_DSH_NODE } : {}),
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
  const composer = page.locator('[data-composer-input="true"][contenteditable="true"]').filter({ visible: true }).last();
  await composer.waitFor({ state: "visible" });
  await checkPaperAppearance(page, 'live-workspace');
  if (process.env.MOCHI_PAPER_SURFACES === '1') await checkHostSurfaces(page, process.env.MOCHI_PAPER_EVIDENCE_DIR);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button',{name:'奶油米白',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.mochiPetPalette==='cream');
  assert.ok(await page.locator('.jxl-pet-colors').evaluate(n=>[...n.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height<60)), 'palette names stay horizontal');
  if(process.env.MOCHI_PAPER_EVIDENCE_DIR)await page.screenshot({path:join(process.env.MOCHI_PAPER_EVIDENCE_DIR,'live-pet-color-picker.png')});
  await page.getByRole('button', { name: '关闭界面音效', exact: true }).click();
  await page.getByRole('button', { name: '开启界面音效', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '开启界面音效', exact: true }).waitFor();
  assert.equal(await page.getByRole('button',{name:'奶油米白',exact:true}).getAttribute('aria-pressed'),'true','palette survives real Host reload');
  for(const [label,id] of [['鼠尾草绿','sage'],['雾桃奶茶','peach'],['经典焦糖','caramel']]){
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.waitForFunction(id=>document.documentElement.dataset.mochiPetPalette===id,id);
  }
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click();
  await page.evaluate(() => {
    window.paperFeedCount = 0;
    new MutationObserver(records => {
      window.paperFeedCount += records.filter(record => record.attributeName === 'data-jxl-feeding' && record.target.hasAttribute('data-jxl-feeding')).length;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-jxl-feeding'] });
  });
  const sessionTitle = "课件预览与整理（演示）";
  const beforeModelA = requests.length;
  await composer.fill("请在右侧打开课件预览网页。");
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await waitFor(async () => await send.isEnabled() && await send.evaluate(node => getComputedStyle(node).backgroundColor) === 'rgb(168, 64, 50)', 'enabled vermilion send key');
  if (process.env.MOCHI_PAPER_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MOCHI_PAPER_EVIDENCE_DIR,'live-red-send.png')});
  await send.click();
  const routed = await waitFor(() => requests.slice(beforeModelA).find((request) => request.path === "/v1/chat/completions" && request.model === "deepseek-v4.1-flash") || false, "existing-session model A request");
  assert.equal(routed.model, "deepseek-v4.1-flash");
  if (process.env.MOCHI_BLOUB_LIVE === '1') {
    const pending = page.locator('[data-jxl-mochi-pending] [data-engine="bloub"]');
    await pending.waitFor({state:'visible'});
    assert.equal(await pending.getAttribute('data-state'),'thinking');
    assert.equal(await page.locator('[data-composer-seat] [data-jxl-mochi-pending]').count(), 0);
    assert.equal(await page.locator('[data-chat-flow] [data-jxl-mochi-pending]').count(), 1);
    assert.ok((await pending.boundingBox()).width >= 48, 'waiting character must be legible');
    if (process.env.MOCHI_PAPER_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MOCHI_PAPER_EVIDENCE_DIR,'live-chat-thinking.png')});
    const replying = page.locator('[data-jxl-avatar-state="typing"] [data-engine="bloub"]');
    await replying.waitFor({state:'visible'});
    assert.equal(await replying.getAttribute('data-state'),'typing');
    if (process.env.MOCHI_PAPER_EVIDENCE_DIR) await page.screenshot({path:join(process.env.MOCHI_PAPER_EVIDENCE_DIR,'live-chat-replying.png')});
    const completed = page.locator('[data-jxl-avatar-state="celebrate"] [data-engine="bloub"]');
    await completed.waitFor({state:'visible'});
    assert.equal(await page.locator('[data-jxl-mochi-pending]').count(),0,'finished turn clears pending character');
  }

  for (const name of ["mochi_lan_status", "mochi_lan_pending_requests", "mochi_lan_reply_student_request", "mochi_notify_classroom", "mochi_call_student", "mochi_register_verdicts", "mochi_set_campus_background", "jxl_query", "jxl_campus_status", "jxl_message", "sidebar_open"]) {
    assert.ok(routed.tools.includes(name), `teacher chat must offer ${name} without switching menus`);
  }
  assert.equal(routed.tools.some((name) => /^(?:bash|pwsh|file_read|file_write|web_search)$/u.test(name)), false, "teacher chat must keep broad work tools behind Work mode");
  assert.equal(routed.authorizationMatchesAiaaaFixture, true, "model A must use its saved, disposable mochi-aiaaa credential");
  await page.getByText("演示内容已准备好，请在右侧查看。", { exact: true }).last().waitFor({ state: "visible" });
  await waitFor(() => page.evaluate(() => window.paperFeedCount > 0), 'real DSH send activates paper feedback', 3000);
  if (process.env.MOCHI_SIDEBAR_LIVE === '1') {
    await waitFor(() => sidebarReceipt, 'sidebar tool result returned to model');
    await page.locator('[data-dsh-better-sidebar] [class*="tabTitle"]').filter({ hasText: /^文件$/ }).waitFor({ state: 'visible' });
    const preview = page.frameLocator('iframe').getByRole('heading', { name: '墨契侧边栏交付验收', exact: true });
    await preview.waitFor({ state: 'visible', timeout: 15_000 });
    if (process.env.MOCHI_PAPER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MOCHI_PAPER_EVIDENCE_DIR, 'live-sidebar-delivery.png') });
  }
  await renameActiveSession(sessionTitle);

  // Save a second provider only after the old session has made its A request.
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "模型", exact: true }).click();
  const mimoKeyInput = page.locator('input[aria-label="MiMo API Key"]');
  await mimoKeyInput.waitFor({ state: "visible" });
  await mimoKeyInput.fill(fixtureMiMoKey);
  await page.getByRole("button", { name: "保存 MiMo API Key", exact: true }).click();
  await waitFor(() => {
    const path = join(dshHome, ".credentials.yaml");
    return existsSync(path) && readFileSync(path, "utf8").includes("MIMO_API_KEY:");
  }, "saved teacher model B credential");
  const credentials = readFileSync(join(dshHome, ".credentials.yaml"), "utf8");
  assert.match(credentials, /MIMO_API_KEY:/);
  assert.equal(credentials.includes(fixtureMiMoKey), true, "native editor must persist the fixture B credential");

  await page.getByRole("button", { name: "关闭", exact: true }).first().click();
  const modelControl = page.locator('button[aria-label^="选择模型"]').filter({ visible: true }).last();
  await modelControl.click();
  await page.getByRole("menuitem", { name: /^模型/ }).click();
  const modelOption = page.getByRole("menuitemradio", { name: /^mimo-v2\.5$/i });
  await modelOption.waitFor({ state: "visible" });
  await modelOption.click();
  await waitForModel("mimo-v2.5", "B model shown in existing teacher session");

  const composerB = page.locator('[data-composer-input="true"][contenteditable="true"]').filter({ visible: true }).last();
  const beforeModelB = requests.length;
  await composerB.fill("请把课件说明也打开，我想补充课堂要点。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const routedB = await waitFor(() => requests.slice(beforeModelB).find((request) => request.path === "/v1/chat/completions" && request.model === "mimo-v2.5") || false, "existing-session model B request");
  assert.equal(routedB.authorizationMatchesMiMoFixture, true, "model B request must use the just-saved MiMo fixture key");
  await page.getByText("演示内容已准备好，请在右侧查看。", { exact: true }).last().waitFor({ state: "visible" });
  await waitForModel("mimo-v2.5", "B model remains visible after its response");
  if (process.env.MOCHI_SIDEBAR_LIVE === '1') {
    await waitFor(() => sidebarFileReceipt, 'sidebar file tool result returned to model');
    await page.locator('.cm-content').filter({ hasText: '墨契课件文件交付验收' }).waitFor({ state: 'visible', timeout: 15_000 });
    if (process.env.MOCHI_PAPER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MOCHI_PAPER_EVIDENCE_DIR, 'live-sidebar-file-delivery.png') });
    const editor = page.locator('.cm-content').filter({ hasText: '墨契课件文件交付验收' });
    await editor.fill('墨契课件文件交付验收：已补充课堂要点。');
    await page.locator('[data-dsh-better-sidebar] button[title^="保存"]').click();
    await waitFor(() => readFileSync(join(fixtureWorkspace, 'lesson-delivery.txt'), 'utf8').includes('已补充课堂要点'), 'sidebar edit saved to actual file');
    if (process.env.MOCHI_SIDEBAR_FULL === '1') {
      const fileTab = page.locator('[data-dsh-better-sidebar] [draggable][title="课件说明验收"]');
      await fileTab.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '移动到自由窗口', exact: true }).click();
      const floating = page.locator('[data-dsh-float-window]');
      await floating.waitFor({ state: 'visible' });
      if (process.env.MOCHI_PAPER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MOCHI_PAPER_EVIDENCE_DIR, 'live-sidebar-floating.png') });
      await floating.locator('[class*="floatTitle"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: '回到侧边栏', exact: true }).click();
      await floating.waitFor({ state: 'detached' });
      await fileTab.waitFor({ state: 'visible' });
    }
    await page.locator('[data-dsh-better-sidebar] [draggable][title="课件说明验收"]').getByRole('button', { name: '关闭', exact: true }).click();
    await page.frameLocator('iframe').getByRole('heading', { name: '墨契侧边栏交付验收', exact: true }).waitFor({ state: 'visible' });
    await page.locator('[data-dsh-better-sidebar] [draggable][title="课件预览验收"]').getByRole('button', { name: '关闭', exact: true }).click();
    if (process.env.MOCHI_SIDEBAR_FULL === '1') {
      const side = page.locator('[data-dsh-better-sidebar]');
      await side.getByRole('button', { name: '新建标签页', exact: true }).click();
      await page.getByRole('menuitem', { name: '终端', exact: true }).click();
      const terminal = side.locator('.xterm-helper-textarea');
      await terminal.waitFor({ state: 'attached' });
      await terminal.focus();
      await page.keyboard.insertText("printf 'terminal verified\\n' > sidebar-terminal-check.txt");
      await page.keyboard.press('Enter');
      await waitFor(() => existsSync(join(fixtureWorkspace, 'sidebar-terminal-check.txt')), 'sidebar terminal executes in session workspace');
      assert.equal(readFileSync(join(fixtureWorkspace, 'sidebar-terminal-check.txt'), 'utf8').trim(), 'terminal verified');
      if (process.env.MOCHI_PAPER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MOCHI_PAPER_EVIDENCE_DIR, 'live-sidebar-terminal.png') });
      await side.locator('[draggable][class*="tabActive"]').getByRole('button', { name: '关闭', exact: true }).click();
      await side.getByRole('button', { name: '新建标签页', exact: true }).click();
      await page.getByRole('menuitem', { name: '文件变动', exact: true }).click();
      await side.getByRole('button', { name: 'Git', exact: true }).click();
      await side.getByText('lesson-delivery.txt', { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible' });
      if (process.env.MOCHI_PAPER_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MOCHI_PAPER_EVIDENCE_DIR, 'live-sidebar-git.png') });
      await side.locator('[draggable]').filter({ hasText: '文件变动' }).getByRole('button', { name: '关闭', exact: true }).click();
    }
    await page.locator('[data-dsh-better-sidebar] [class*="tabTitle"]').filter({ hasText: /^文件$/ }).waitFor({ state: 'visible' });
  }

  const visibleText = await page.locator("body").innerText();
  const visibleHtml = await page.locator("body").evaluate((element) => element.innerHTML);
  assert.equal([fixtureKey, fixtureMiMoKey].some((key) => visibleText.includes(key)), false, "teacher UI must not echo fixture credentials");
  assert.equal([fixtureKey, fixtureMiMoKey].some((key) => visibleHtml.includes(key)), false, "teacher DOM must not serialize fixture credentials");
  assert.equal([fixtureKey, fixtureMiMoKey].some((key) => output.includes(key)), false, "Electron and renderer output must not echo fixture credentials");

  await reopenSession(sessionTitle, "mimo-v2.5");
  assert.equal((await page.locator('[role="treeitem"][aria-selected="true"]').last().innerText()).includes(sessionTitle), true, "the named existing teacher session must be selected again");
  console.log(JSON.stringify({
    result: "PASS",
    role: "teacher",
    modelARequest: { model: routed.model, authorizationMatchesAiaaaFixture: routed.authorizationMatchesAiaaaFixture },
    modelBRequest: { model: routedB.model, authorizationMatchesMiMoFixture: routedB.authorizationMatchesMiMoFixture },
    credentialSavedThroughNativeCards: true,
    reopenedSessionShowsModelB: true,
    credentialEcho: false,
    ...(process.env.MOCHI_SIDEBAR_FULL === "1" ? { floatingDockVerified: true, terminalExecutionVerified: true, gitChangesVisible: true } : {}),
    ...(process.env.MOCHI_SIDEBAR_LIVE === "1" ? { sidebarToolResultReturned: sidebarReceipt, sidebarPreviewVisible: true, sidebarFileResultReturned: sidebarFileReceipt, sidebarFileVisible: true, sidebarFileEditedAndSaved: true, sidebarCloseRestoresPreviousTab: true } : {}),
  }));
}

try {
  await run();
} catch (error) {
  const body = page ? redact((await page.locator("body").innerText().catch(() => "")).slice(0, 3_000)) : "renderer unavailable";
  console.error(`[test-teacher-model-live-ui] FAIL: ${redact(error?.stack ?? error)}\nUI state:\n${body}\nRequests:\n${JSON.stringify(requests)}\nElectron output:\n${redact(output.slice(-3_000))}`);
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
