import { app, BrowserWindow, clipboard, shell } from "electron";
import {
  createDesktopDoctorConfig,
  createDoctorWindowController,
  installDoctorMenu,
  type DoctorWindowController,
} from "./dsh/doctor-window";
import { resolveMochiServiceDefaults } from "./dsh/profile";
import { destroyMochiTray, initializeMochiTray, type MochiTrayHandle } from "./dsh/tray";
import { DshWebHost } from "./dsh/web-host";

/**
 * Mochi 桌面端主进程。
 *
 * 职责边界（与 08_DESKTOP_APP_ARCHITECTURE.md 一致）：
 * 桌面壳直接承载与浏览器版相同的 mochi-web SPA。网页端拥有的会话、设置、
 * 模型、插件、技能、审批、工作区和工具 UI 因此不会在桌面端形成第二套实现。
 */

// 校园数据不出校：dsh 遥测默认上报 harness-telemetry.deepseeksvc.com，必须关。
// 出处：dsh 源码 profile-boot.ts:78-104
process.env.DSH_TELEMETRY_DISABLED = "1";

const STARTUP_RETRY_URL = "mochi-startup://retry";
const STARTUP_COPY_DIAGNOSTIC_URL = "mochi-startup://copy-diagnostic";

type StartupStage = "starting" | "stopping" | "restoring";
type StartupDiagnosticCode =
  | "WEB_HOST_RUNTIME_MISSING"
  | "WEB_HOST_TIMEOUT"
  | "WEB_HOST_EXITED"
  | "WEB_HOST_START_FAILED";

interface StartupDiagnostic {
  code: StartupDiagnosticCode;
  stage: "web-host";
}

let mainWindow: BrowserWindow | null = null;
let webHost: DshWebHost | null = null;
let failedWebHost: DshWebHost | null = null;
let failedWebHostStop: Promise<void> | null = null;
let harnessOrigin: string | null = null;
let readyUrl: string | null = null;
let startupPromise: Promise<void> | null = null;
let retryPromise: Promise<void> | null = null;
let permittedLocalPageUrl: string | null = null;
let activeDiagnosticPageUrl: string | null = null;
let lastStartupDiagnostic: StartupDiagnostic | null = null;
let doctorWindow: DoctorWindowController | null = null;
let mochiTray: MochiTrayHandle | null = null;
let trayInitializationPromise: Promise<void> | null = null;
let trayRestartPromise: Promise<void> | null = null;
const hostsStoppingForTrayRestart = new Set<DshWebHost>();
let automaticRecoveryUsed = false;
let appIsQuitting = false;
let quitStopPromise: Promise<void> | null = null;
let quitStopComplete = false;

function isLiveWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed();
}

function isHarnessUrl(url: string): boolean {
  try {
    return harnessOrigin !== null && new URL(url).origin === harnessOrigin;
  } catch {
    return false;
  }
}

function openExternalIfAllowed(url: string): void {
  try {
    const parsed = new URL(url);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      void shell.openExternal(parsed.toString());
    }
  } catch {
    // 无效 URL 只阻止导航，不能交给系统外部处理器。
  }
}

function startupStagePage(stage: StartupStage): string {
  const text = {
    starting: "正在启动本地服务…",
    stopping: "正在停止上一次本地服务…",
    restoring: "正在恢复本地工作区…",
  }[stage];
  const html = `<!doctype html><meta charset="utf-8"><title>Mochi</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#45584e;color:#f1f4ee;font:16px/1.6 system-ui}.card{max-width:440px;padding:32px;border:1px solid #ffffff24;border-radius:24px;background:#2a3931;box-shadow:0 18px 56px #111a14aa}h1{margin:0 0 8px;font-size:23px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:10px;background:#d9973e}</style><main class="card"><h1><span class="dot"></span>Mochi</h1><p>${text}</p><p>本地服务就绪后会自动打开工作区。</p></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function diagnosticFor(error: unknown): StartupDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("找不到 @deepseek-ai/dsh")) {
    return { stage: "web-host", code: "WEB_HOST_RUNTIME_MISSING" };
  }
  if (message.includes("内未就绪")) {
    return { stage: "web-host", code: "WEB_HOST_TIMEOUT" };
  }
  if (message.includes("Mochi Web Host 已退出")) {
    return { stage: "web-host", code: "WEB_HOST_EXITED" };
  }
  return { stage: "web-host", code: "WEB_HOST_START_FAILED" };
}

function diagnosticText(diagnostic: StartupDiagnostic): string {
  return [
    "Mochi 启动诊断",
    `阶段: ${diagnostic.stage}`,
    `代码: ${diagnostic.code}`,
    "建议: 检查 DSH 运行时和 mochi-web profile，然后重新尝试。",
  ].join("\n");
}

function errorPage(diagnostic: StartupDiagnostic, copied = false): string {
  const copyStatus = copied ? "<p class=\"copied\">诊断已复制。</p>" : "";
  const html = `<!doctype html><meta charset="utf-8"><title>Mochi 启动失败</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1b211e;color:#e7ebe7;font:16px/1.6 system-ui}.card{max-width:640px;padding:32px;border:1px solid #ffffff1a;border-radius:24px;background:#242c28}h1{font-size:22px;margin-top:0}code{color:#d9973e}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}button{border:0;border-radius:12px;padding:10px 15px;background:#d9973e;color:#1b211e;font:inherit;font-weight:600;cursor:pointer}.secondary{background:#ffffff14;color:#e7ebe7}.copied{color:#b9d9b7}</style><main class="card"><h1>Mochi 暂时没有启动</h1><p>本地服务未能就绪。此页面不会显示原始日志、学生内容或凭据。</p><p>诊断代码：<code>${diagnostic.code}</code></p>${copyStatus}<div class="actions"><button id="retry" type="button">重新尝试</button><button id="copy" class="secondary" type="button">复制诊断</button></div></main><script>document.getElementById("retry").addEventListener("click",()=>{location.href="${STARTUP_RETRY_URL}"});document.getElementById("copy").addEventListener("click",()=>{location.href="${STARTUP_COPY_DIAGNOSTIC_URL}"});</script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function loadLocalPage(window: BrowserWindow, page: string): Promise<void> {
  if (!isLiveWindow(window)) return;
  activeDiagnosticPageUrl = null;
  permittedLocalPageUrl = page;
  try {
    await window.loadURL(page);
  } catch {
    console.error("[mochi] 本地启动页面加载失败");
  } finally {
    if (permittedLocalPageUrl === page) permittedLocalPageUrl = null;
  }
}

async function showStartupStage(window: BrowserWindow, stage: StartupStage): Promise<void> {
  await loadLocalPage(window, startupStagePage(stage));
}

async function showStartupFailure(window: BrowserWindow, diagnostic: StartupDiagnostic, copied = false): Promise<void> {
  if (!isLiveWindow(window)) return;
  const page = errorPage(diagnostic, copied);
  await loadLocalPage(window, page);
  if (isLiveWindow(window)) activeDiagnosticPageUrl = window.webContents.getURL();
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function hasLiveMochiTray(): boolean {
  return mochiTray !== null && !mochiTray.tray.isDestroyed();
}

function destroyDesktopTray(): void {
  destroyMochiTray();
  mochiTray = null;
}

function clearReadyWorkspace(): void {
  readyUrl = null;
  harnessOrigin = null;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: "Mochi",
    backgroundColor: "#45584e", // 深绿画布，与 calm-tokens 的 --sage-800 一致，避免启动白闪
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  // 首个 data: 启动页就绪即显示，不再等待 sidecar 先完成。
  window.once("ready-to-show", () => {
    if (isLiveWindow(window)) window.show();
  });

  // 站外链接交给系统浏览器；Harness 本地同源导航留在窗口内。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isHarnessUrl(url)) openExternalIfAllowed(url);
    return { action: isHarnessUrl(url) ? "allow" : "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url === permittedLocalPageUrl) return;
    const isTrustedDiagnosticPage = activeDiagnosticPageUrl !== null
      && window.webContents.getURL() === activeDiagnosticPageUrl;
    if (isTrustedDiagnosticPage && url === STARTUP_RETRY_URL) {
      event.preventDefault();
      void retryStartup(window);
      return;
    }
    if (isTrustedDiagnosticPage && url === STARTUP_COPY_DIAGNOSTIC_URL) {
      event.preventDefault();
      copyDiagnostic(window);
      return;
    }
    if (isHarnessUrl(url)) return;
    event.preventDefault();
    openExternalIfAllowed(url);
  });

  window.on("close", (event) => {
    if (process.platform === "win32" && !appIsQuitting && hasLiveMochiTray()) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    activeDiagnosticPageUrl = null;
  });
  return window;
}

async function loadReadyWorkspace(window: BrowserWindow, url: string, stage: StartupStage): Promise<void> {
  try {
    await showStartupStage(window, stage);
    if (!isLiveWindow(window)) return;
    await window.loadURL(url);
  } catch (error) {
    await reportStartupFailure(error, webHost);
  }
}

async function reportStartupFailure(error: unknown, host: DshWebHost | null): Promise<void> {
  const diagnostic = diagnosticFor(error);
  if (webHost === host) webHost = null;
  if (host !== null) {
    failedWebHost = host;
    failedWebHostStop = host.stop();
  }
  clearReadyWorkspace();
  lastStartupDiagnostic = diagnostic;
  console.error(`[mochi] Web Host 启动失败 (${diagnostic.code})`);

  if (process.env.MOCHI_DESKTOP_SMOKE === "1") {
    appIsQuitting = true;
    destroyDesktopTray();
    console.error("MOCHI_DESKTOP_SMOKE_FAILED");
    app.exit(1);
    return;
  }
  if (mainWindow !== null && isLiveWindow(mainWindow)) {
    await showStartupFailure(mainWindow, diagnostic);
  }
}

async function recoverReadyHostExit(host: DshWebHost, error: Error): Promise<void> {
  if (appIsQuitting || trayRestartPromise !== null || webHost !== host || readyUrl === null) return;

  // DshWebHost emits after the child `exit` event, so a replacement can only
  // begin after the previous OS process has actually ended.
  webHost = null;
  clearReadyWorkspace();
  if (automaticRecoveryUsed) {
    await reportStartupFailure(error, host);
    return;
  }

  automaticRecoveryUsed = true;
  if (trayRestartPromise !== null) return;
  await startStartup();
}

function startStartup(): Promise<void> {
  if (startupPromise !== null) return startupPromise;

  const host = new DshWebHost();
  webHost = host;
  failedWebHost = null;
  failedWebHostStop = null;
  lastStartupDiagnostic = null;
  let producedReadyUrl = false;
  let readyForRecovery = false;
  let queuedReadyExit: Error | null = null;
  host.once("exit", (error: Error) => {
    if (hostsStoppingForTrayRestart.has(host)) return;
    if (!producedReadyUrl) return;
    if (!readyForRecovery || startupPromise !== null) {
      queuedReadyExit = error;
      return;
    }
    void recoverReadyHostExit(host, error);
  });
  const task = (async () => {
    try {
      if (mainWindow !== null && isLiveWindow(mainWindow)) {
        await showStartupStage(mainWindow, "starting");
      }
      if (appIsQuitting || webHost !== host) return;
      const url = await host.start();
      if (webHost !== host) return;
      producedReadyUrl = true;
      readyUrl = url;
      harnessOrigin = new URL(url).origin;
      if (mainWindow !== null && isLiveWindow(mainWindow)) {
        await mainWindow.loadURL(url);
      }
      readyForRecovery = true;
      if (process.env.MOCHI_DESKTOP_SMOKE === "1") {
        console.log(`MOCHI_DESKTOP_SMOKE_OK ${harnessOrigin}`);
        app.quit();
      }
    } catch (error) {
      if (hostsStoppingForTrayRestart.has(host)) return;
      await reportStartupFailure(error, host);
    }
  })();
  let run: Promise<void>;
  run = task.finally(() => {
    if (startupPromise === run) startupPromise = null;
  });
  startupPromise = run;
  void run.then(
    () => {
      if (readyForRecovery && queuedReadyExit !== null) {
        const error = queuedReadyExit;
        queuedReadyExit = null;
        void recoverReadyHostExit(host, error);
      }
    },
    () => {},
  );
  return run;
}

async function retryStartup(window: BrowserWindow): Promise<void> {
  if (retryPromise !== null || trayRestartPromise !== null) return;
  const previousStartup = startupPromise;
  const previousStop = failedWebHostStop;
  const run = (async () => {
    if (previousStartup !== null) await previousStartup;
    if (appIsQuitting || trayRestartPromise !== null || webHost !== null || !isLiveWindow(window)) return;
    await showStartupStage(window, "stopping");
    if (previousStop !== null) {
      await previousStop;
    }
    if (appIsQuitting || trayRestartPromise !== null || webHost !== null || !isLiveWindow(window)) return;
    failedWebHost = null;
    failedWebHostStop = null;
    automaticRecoveryUsed = false;
    await startStartup();
  })();
  retryPromise = run;
  void run.then(
    () => {
      if (retryPromise === run) retryPromise = null;
    },
    () => {
      if (retryPromise === run) retryPromise = null;
    },
  );
  return run;
}

function copyDiagnostic(window: BrowserWindow): void {
  const diagnostic = lastStartupDiagnostic;
  if (diagnostic === null || !isLiveWindow(window)) return;
  clipboard.writeText(diagnosticText(diagnostic));
  void showStartupFailure(window, diagnostic, true);
}

function openWindowForCurrentState(): void {
  if (mainWindow !== null && isLiveWindow(mainWindow)) {
    focusWindow(mainWindow);
    return;
  }
  const window = createWindow();
  if (trayRestartPromise !== null) {
    void showStartupStage(window, "stopping");
    return;
  }
  if (readyUrl !== null) {
    void loadReadyWorkspace(window, readyUrl, "restoring");
    return;
  }
  if (lastStartupDiagnostic !== null) {
    void showStartupFailure(window, lastStartupDiagnostic);
    return;
  }
  if (startupPromise !== null) {
    void showStartupStage(window, "starting");
    return;
  }
  void startStartup();
}

function focusOrRestoreMainWindow(): void {
  if (mainWindow !== null && isLiveWindow(mainWindow)) {
    focusWindow(mainWindow);
    return;
  }
  openWindowForCurrentState();
}

function restartHostFromTray(): Promise<void> {
  if (trayRestartPromise !== null) return trayRestartPromise;

  const activeHost = webHost;
  const pendingStartup = startupPromise;
  const pendingRetry = retryPromise;
  const pendingFailureStop = failedWebHostStop;
  let activeStop: Promise<void> | null = null;
  let run: Promise<void>;
  run = (async () => {
    if (appIsQuitting) return;

    // Detach the old host before awaiting a window operation. This suppresses
    // the ready-exit recovery path and prevents an in-flight initial start
    // from attaching its old URL after the user chose a manual restart.
    if (activeHost !== null) {
      hostsStoppingForTrayRestart.add(activeHost);
      if (webHost === activeHost) webHost = null;
      clearReadyWorkspace();
      activeStop = activeHost.stop();
    } else {
      clearReadyWorkspace();
    }

    const window = mainWindow !== null && isLiveWindow(mainWindow)
      ? mainWindow
      : createWindow();
    focusWindow(window);
    await showStartupStage(window, "stopping");

    const pending = [activeStop, pendingStartup, pendingRetry, pendingFailureStop]
      .filter((value): value is Promise<void> => value !== null);
    await Promise.allSettled(pending);
    if (activeHost !== null) hostsStoppingForTrayRestart.delete(activeHost);
    if (appIsQuitting) return;

    failedWebHost = null;
    failedWebHostStop = null;
    automaticRecoveryUsed = false;
    await startStartup();
  })();
  trayRestartPromise = run;
  void run.then(
    () => {
      if (trayRestartPromise === run) trayRestartPromise = null;
    },
    () => {
      if (trayRestartPromise === run) trayRestartPromise = null;
    },
  );
  return run;
}

function quitFromTray(): void {
  if (appIsQuitting) return;
  appIsQuitting = true;
  destroyDesktopTray();
  app.quit();
}

function initializeDesktopTray(): void {
  if (trayInitializationPromise !== null || appIsQuitting) return;
  const run = (async () => {
    try {
      const icon = await app.getFileIcon(process.execPath, { size: "normal" });
      if (appIsQuitting) return;
      mochiTray = initializeMochiTray({
        icon,
        open: focusOrRestoreMainWindow,
        restart: restartHostFromTray,
        quit: quitFromTray,
      });
    } catch {
      // A missing platform icon must leave the normal visible-window and quit
      // path intact. Do not surface filesystem paths from the icon lookup.
      if (!appIsQuitting) console.error("[mochi] 托盘不可用，窗口仍可正常使用和退出");
    }
  })();
  trayInitializationPromise = run;
}

function initializeDoctorWindow(): void {
  if (doctorWindow !== null) return;
  doctorWindow = createDoctorWindowController({
    createConfig: () => {
      const serviceDefaults = resolveMochiServiceDefaults();
      return createDesktopDoctorConfig({
        storagePath: app.getPath("userData"),
        campusOrigin: serviceDefaults.campusApiUrl,
        searxngEndpoint: serviceDefaults.searxngEndpoint,
        ...(lastStartupDiagnostic === null ? {} : { diagnosticEvents: [lastStartupDiagnostic] }),
      });
    },
  });
  installDoctorMenu(doctorWindow);
}

/**
 * 启动自检：确认真的跑在 Electron 主进程里。
 * 若宿主环境泄漏了 ELECTRON_RUN_AS_NODE，Electron 会退化成纯 Node。
 */
if (process.type !== "browser") {
  console.error(
    `[mochi] 主进程没有运行在 Electron 环境中（process.type=${String(process.type)}）。\n` +
      `        多半是环境变量 ELECTRON_RUN_AS_NODE 泄漏导致的，启动前清掉它。`,
  );
  process.exit(1);
}

// 用户数据目录要叫 Mochi，而不是 package.json 的 name（mochi-desktop）。
app.setName("Mochi");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) focusOrRestoreMainWindow();
    else app.once("ready", () => focusOrRestoreMainWindow());
  });

  app.whenReady().then(() => {
    initializeDoctorWindow();
    openWindowForCurrentState();
    initializeDesktopTray();
  });

  app.on("activate", () => {
    focusOrRestoreMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    appIsQuitting = true;
    destroyDesktopTray();
    doctorWindow?.cancel();
    if (quitStopPromise !== null) {
      if (!quitStopComplete) event.preventDefault();
      return;
    }

    const hosts = new Set<DshWebHost>();
    if (webHost !== null) hosts.add(webHost);
    if (failedWebHost !== null) hosts.add(failedWebHost);
    // A tray restart detaches its old host from `webHost` while its bounded
    // stop is pending. Keep that host in the same quit barrier so an immediate
    // quit cannot leave a SIGTERM-ignoring child behind.
    for (const host of hostsStoppingForTrayRestart) hosts.add(host);
    const stops = [...hosts].map((host) => host.stop());
    webHost = null;
    failedWebHost = null;
    failedWebHostStop = null;
    if (stops.length === 0) return;

    event.preventDefault();
    quitStopPromise = Promise.all(stops).then(() => {
      quitStopComplete = true;
      app.quit();
    });
  });
}
