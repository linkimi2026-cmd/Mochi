#!/usr/bin/env node
/**
 * [Mochi 2026-09-11] WO-7 实机自验：在真实 Electron + 真实 DSH 运行时上跑
 * 「首启弹框 → 选教师 → 重启 → 切换到教室 → 重启」整条链路，并在每一步截图。
 *
 * 隔离方式：临时 HOME / TMPDIR / DSH_HOME，并把角色文件落在临时的
 * `--user-data-dir` 里，绝不触碰用户真实的 Mochi home 或
 * `~/Library/Application Support/Mochi` 中的角色设置与数据。
 *
 * 首启角色框与「切换本机角色」确认框都是原生对话框，无法用 DOM 点击。
 * `app.whenReady()` 会在任何调试器连接之前就弹出角色框，因此补丁必须在主进程
 * 入口之前生效：这里用 `scripts/wo7-dialog-injector.cjs` 作为 Electron 入口，
 * 它先替换 `dialog.showMessageBox` 再 require 真正的产品入口。替身把每次调用
 * 的参数追加写入日志文件，测试进程读取日志断言文案；返回值由响应文件控制，
 * 等价于用户点了对应按钮。窗口画面仍走真实渲染并截图存证。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const artifactsDir = join(workspaceRoot, "artifacts", "wo7");
const runtimeResources = join(desktopRoot, "resources", "mochi-web");
const workspaceSkills = join(workspaceRoot, "skills");
const injectorPath = join(desktopRoot, "scripts", "wo7-dialog-injector.cjs");
const mainEntry = join(desktopRoot, "dist-electron", "main.js");
const electronBin = createRequire(join(desktopRoot, "package.json"))("electron");
const root = mkdtempSync(join(tmpdir(), "mochi-wo7-e2e-"));
const userData = join(root, "user-data");
const dshHome = join(root, "dsh-home");
const dialogLog = join(root, "dialogs.jsonl");
const responseFile = join(root, "dialog-response.txt");
const logPath = join(artifactsDir, "e2e-log.txt");
const timeoutMs = 120_000;
const launched = new Set();
let logText = "";

function log(line) {
  logText += `${line}\n`;
  console.log(line);
}

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
    await wait(200);
  }
  throw new Error(`${description} timed out${lastError ? `: ${String(lastError)}` : ""}`);
}

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function collectOutput(child) {
  let output = "";
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-64_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return () => output;
}

function readDialogs() {
  if (!existsSync(dialogLog)) return [];
  return readFileSync(dialogLog, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line).options);
}

function setDialogResponse(index) {
  writeFileSync(responseFile, String(index), "utf8");
}

function resetDialogs() {
  writeFileSync(dialogLog, "", "utf8");
}

function roleFiles() {
  if (!existsSync(userData)) return [];
  return readdirSync(userData).filter((name) => name.startsWith("mochi-launch"));
}

function readRoleFile(name) {
  return JSON.parse(readFileSync(join(userData, name), "utf8"));
}

function launch(debugPort) {
  const args = [injectorPath, "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${userData}`];
  if (debugPort !== undefined) args.push(`--remote-debugging-port=${debugPort}`);
  const child = spawn(electronBin, args, {
    cwd: desktopRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      TMPDIR: join(root, "tmp"),
      DSH_HOME: dshHome,
      MOCHI_WORKSPACE_ROOT: workspaceRoot,
      MOCHI_RUNTIME_RESOURCES: runtimeResources,
      MOCHI_SKILLS_DIR: workspaceSkills,
      MOCHI_WO7_DIALOG_LOG: dialogLog,
      MOCHI_WO7_DIALOG_RESPONSE: responseFile,
      MOCHI_WO7_MAIN_ENTRY: mainEntry,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const handle = { child, output: collectOutput(child), debugPort };
  launched.add(handle);
  return handle;
}

async function targets(port, type) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error("DevTools endpoint unavailable");
  const list = await response.json();
  return list.filter((target) => target.type === type && target.webSocketDebuggerUrl);
}

async function pageTarget(port) {
  const pages = await targets(port, "page");
  return pages.at(-1) ?? null;
}

async function capture(port, filePath) {
  const page = await pageTarget(port);
  if (!page) return false;
  const result = await new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("screenshot timed out"));
    }, 25_000);
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("screenshot socket failed"));
    }, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message.result);
    });
  });
  const data = result?.data;
  if (typeof data !== "string" || data.length === 0) return false;
  writeFileSync(filePath, Buffer.from(data, "base64"));
  return true;
}

async function terminate(handle) {
  const child = handle?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), wait(8_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

/** 等待一个页面出现，并让首帧渲染稳定。 */
async function waitForWindow(debugPort, label) {
  await waitFor(async () => (await pageTarget(debugPort)) !== null, label);
  await wait(2_500);
}

try {
  mkdirSync(artifactsDir, { recursive: true });
  for (const directory of [userData, join(root, "home"), join(root, "tmp"), dshHome]) {
    mkdirSync(directory, { recursive: true });
  }
  assert.equal(existsSync(electronBin), true, "WO-7 E2E requires the installed Electron binary");
  assert.equal(existsSync(mainEntry), true, "run npm run build first");
  assert.equal(existsSync(injectorPath), true, "the dialog injector must exist");

  log("== WO-7 实机自验开始 ==");
  log(`临时 userData: ${userData}`);
  log(`角色文件（启动前）: ${JSON.stringify(roleFiles())}`);

  // ── 阶段 1：全新机首启 → 中文角色选择框，选「教师办公电脑」 ─────────────
  resetDialogs();
  setDialogResponse(0); // 「教师办公电脑」
  const debugPort1 = await freePort();
  log("[阶段1] 启动实例（全新 userData，无角色文件）");
  const first = launch(debugPort1);
  await waitForWindow(debugPort1, "首启角色对话框与教师端窗口");

  const firstDialog = await waitFor(() => {
    const dialogs = readDialogs();
    return dialogs.find((dialog) => dialog.title === "设置 Mochi 本机角色") ?? null;
  }, "首启角色选择框");
  log(`[阶段1] 标题: ${firstDialog.title}`);
  log(`[阶段1] 按钮: ${JSON.stringify(firstDialog.buttons)}`);
  log(`[阶段1] defaultId=${firstDialog.defaultId} cancelId=${firstDialog.cancelId} noLink=${firstDialog.noLink}`);
  log(`[阶段1] 详情: ${firstDialog.detail}`);
  assert.deepEqual(firstDialog.buttons, ["教师办公电脑", "教室一体机", "退出"], "首启框必须是两个选项 + 退出");
  assert.equal(firstDialog.defaultId, 0, "教师办公电脑必须默认高亮");
  assert.equal(firstDialog.cancelId, 2, "取消等价于退出");
  assert.match(firstDialog.detail, /只影响默认启动角色/, "详情必须写明只影响默认角色");
  assert.match(firstDialog.detail, /托盘菜单里切换/, "详情必须写明之后可切换");
  assert.match(firstDialog.detail, /互相隔离/, "详情必须写明两套数据互相隔离");
  assert.match(firstDialog.detail, /不读取教师密钥、记忆、会话/, "详情必须写明教室端不读教师数据");

  await waitFor(() => Promise.resolve(roleFiles().includes("mochi-launch-teacher.json")), "写入教师角色文件");
  log(`[阶段1] 角色文件（选教师后）: ${JSON.stringify(roleFiles())}`);
  log(`[阶段1] 内容: ${JSON.stringify(readRoleFile("mochi-launch-teacher.json"))}`);
  const shot1 = await capture(debugPort1, join(artifactsDir, "01-first-run-teacher.png"));
  log(`[阶段1] 截图 01-first-run-teacher.png -> ${shot1}`);
  await terminate(first);

  // ── 阶段 2：重启 → 不再询问，直接进教师端 ─────────────────────────────
  resetDialogs();
  setDialogResponse(0);
  const debugPort2 = await freePort();
  log("[阶段2] 重启：应直接以教师端启动且不再询问角色");
  const second = launch(debugPort2);
  await waitForWindow(debugPort2, "教师端窗口（第二次启动）");
  const prompts = readDialogs().filter((dialog) => dialog.title === "设置 Mochi 本机角色");
  log(`[阶段2] 重启后角色询问次数: ${prompts.length}（应为 0）`);
  assert.equal(prompts.length, 0, "已记录角色时不得再次询问");
  const shot2 = await capture(debugPort2, join(artifactsDir, "02-restart-teacher.png"));
  log(`[阶段2] 截图 02-restart-teacher.png -> ${shot2}`);
  await terminate(second);

  // ── 阶段 3：切换本机角色（等价于点击托盘「切换本机角色：教室一体机」）──────
  // 托盘菜单项的存在性、中文文案与「当前角色置灰」由
  // `scripts/test-tray-runtime.mjs` 与 `scripts/test-tray-integration-runtime.mjs`
  // 在真实 Electron Tray 上断言；主进程的切换流程（中文确认框 → 写角色文件 →
  // 重启）由 `scripts/wo7-switch-e2e.mjs` 驱动。这里只承接切换后的状态。
  resetDialogs();
  setDialogResponse(0);
  const debugPort3 = await freePort();
  log("[阶段3] 启动教师端，并执行「切换本机角色」");
  const third = launch(debugPort3);
  await waitForWindow(debugPort3, "教师端窗口（第三次启动）");
  const shot3 = await capture(debugPort3, join(artifactsDir, "03-before-switch-teacher.png"));
  log(`[阶段3] 截图 03-before-switch-teacher.png（切换前，教师端）-> ${shot3}`);
  await terminate(third);

  // 切换动作本身：通过已编译的角色模块写入教室端声明（与主进程切换回调同一路径）。
  const roles = createRequire(join(desktopRoot, "package.json"))(join(desktopRoot, "dist-electron", "dsh", "launch-role.js"));
  roles.persistLaunchRole(userData, "classroom");
  await waitFor(() => Promise.resolve(roleFiles().includes("mochi-launch-classroom.json")), "写入教室端角色文件");
  log(`[阶段3] 角色文件（切换后）: ${JSON.stringify(roleFiles())}`);
  assert.equal(roleFiles().includes("mochi-launch-teacher.json"), true, "切换不得删除另一个角色的入口");
  assert.equal(readRoleFile("mochi-launch-classroom.json").role, "classroom");

  // ── 阶段 4：以教室端重启 → 生效，且教师端入口仍在 ──────────────────────
  resetDialogs();
  setDialogResponse(0);
  const debugPort4 = await freePort();
  log("[阶段4] 重启：应以教室端启动，且教师端入口仍在");
  const fourth = launch(debugPort4);
  await waitForWindow(debugPort4, "教室端窗口");
  const promptsAfterSwitch = readDialogs().filter((dialog) => dialog.title === "设置 Mochi 本机角色");
  log(`[阶段4] 切换后重启的角色询问次数: ${promptsAfterSwitch.length}（应为 0）`);
  assert.equal(promptsAfterSwitch.length, 0, "切换后不得再次询问");
  log(`[阶段4] 生效角色文件: ${JSON.stringify(readRoleFile("mochi-launch-classroom.json"))}`);
  assert.deepEqual(roleFiles().sort(), ["mochi-launch-classroom.json", "mochi-launch-teacher.json"]);
  const shot4 = await capture(debugPort4, join(artifactsDir, "04-restart-classroom.png"));
  log(`[阶段4] 截图 04-restart-classroom.png -> ${shot4}`);
  await terminate(fourth);

  writeFileSync(logPath, logText);
  log("== WO-7 实机自验通过 ==");
  log(`日志: ${logPath}`);
} catch (error) {
  log(`FAILED: ${error && error.stack ? error.stack : String(error)}`);
  try {
    writeFileSync(logPath, logText);
  } catch {
    // 日志写入失败不应掩盖原始错误。
  }
  process.exitCode = 1;
} finally {
  for (const handle of launched) await terminate(handle);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    // 受限环境可能拒绝批量删除；系统会回收临时目录。
  }
}
