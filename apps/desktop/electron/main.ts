import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Mochi 桌面端主进程。
 *
 * 职责边界（与 08_DESKTOP_APP_ARCHITECTURE.md 一致）：
 *   主进程   —— 窗口、dsh sidecar 生命周期、本地数据、系统能力
 *   renderer —— React UI + ExpressiveOrb，只通过 preload 暴露的 IPC 说话
 *
 * Batch 0 只做「窗口 + 球」。dsh sidecar 在 Batch 2 接入，
 * 这里的 spawn/事件转发接口先留好形状，不实现。
 */

// 校园数据不出校：dsh 遥测默认上报 harness-telemetry.deepseeksvc.com，必须关。
// 出处：dsh 源码 profile-boot.ts:78-104
process.env.DSH_TELEMETRY_DISABLED = "1";

const IS_DEV = !app.isPackaged;
const VITE_DEV_URL = "http://127.0.0.1:5178";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: "Mochi",
    backgroundColor: "#45584e", // 深绿画布，与 calm-tokens 的 --sage-800 一致，避免启动白闪
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 窗口就绪后再显示，规避首帧白屏
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (IS_DEV) {
    void mainWindow.loadURL(VITE_DEV_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "..", "dist", "renderer", "index.html"));
  }

  // 外部链接交给系统浏览器，不要在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * 启动自检：确认真的跑在 Electron 主进程里。
 *
 * 如果宿主环境泄漏了 `ELECTRON_RUN_AS_NODE=1`（从 IDE 集成终端或另一个
 * Electron 应用里启动时很常见），Electron 会退化成纯 Node 运行：
 * `require("electron")` 返回 Node 的内置模块集合而不是 Electron API，
 * 症状是下面访问 `app.isPackaged` 时报 "Cannot read properties of undefined"。
 *
 * 没有这道检查的话，那个报错和 Electron 本身坏了长得一模一样，极难定位。
 */
if (process.type !== "browser") {
  console.error(
    `[mochi] 主进程没有运行在 Electron 环境中（process.type=${String(process.type)}）。\n` +
      `        多半是环境变量 ELECTRON_RUN_AS_NODE 泄漏导致的，启动前清掉它：\n` +
      `          unset ELECTRON_RUN_AS_NODE\n` +
      `        若通过 npm run dev 启动，dev.mjs 已经自动清理，此提示不应出现。`,
  );
  process.exit(1);
}

// 用户数据目录要叫 Mochi，而不是 package.json 的 name（mochi-desktop）。
// 必须在 app ready 之前设置，否则 Electron 已经按默认名建好目录了。
app.setName("Mochi");

app.whenReady().then(() => {
  createWindow();

  // Batch 2 才真正生效：dsh 未随包分发时 startDsh 内部会跳过并打印警告
  startDsh();

  app.on("activate", () => {
    // macOS：点击 dock 图标且无窗口时重建
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // macOS 保持常驻，其他平台退出
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopDsh();
});

/* ------------------------------------------------------------------ *
 * dsh sidecar —— Batch 2 接入，此处仅占位
 * ------------------------------------------------------------------ */

let dshProcess: ChildProcessWithoutNullStreams | null = null;

function resolveDshEntry(): string | null {
  const candidate = join(app.getAppPath(), "..", "dsh", "node_modules", ".bin", "dsh");
  return existsSync(candidate) ? candidate : null;
}

function startDsh(): void {
  if (dshProcess) return;
  const entry = resolveDshEntry();
  if (!entry) {
    console.warn("[mochi] dsh sidecar 未随包分发，跳过（Batch 2 接入）");
    return;
  }
  dshProcess = spawn(process.execPath, [entry, "--profile", "mochi"], {
    env: { ...process.env, DSH_TELEMETRY_DISABLED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  dshProcess.on("exit", (code) => {
    console.warn(`[mochi] dsh sidecar 退出，code=${code}`);
    dshProcess = null;
  });
}

function stopDsh(): void {
  if (!dshProcess) return;
  dshProcess.kill("SIGTERM");
  dshProcess = null;
}

/* ------------------------------------------------------------------ *
 * IPC —— renderer 只通过这些通道说话
 * ------------------------------------------------------------------ */

ipcMain.handle("mochi:ping", async () => {
  return { ok: true, version: app.getVersion(), platform: process.platform };
});
