import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell, type IpcMainInvokeEvent } from "electron";
import {
  createDesktopDoctorConfig,
  createDoctorWindowController,
  installDoctorMenu,
  type DoctorWindowController,
} from "./dsh/doctor-window";
// [Mochi 2026-09-11] WO-7 角色解析/写入收敛到 launch-role 模块。
import {
  adoptLegacyLaunchRole,
  LAUNCH_ROLE_ARG_PREFIX,
  launchRoleLabel,
  persistLaunchRole,
  resolveLaunchRole as resolveRecordedLaunchRole,
  resolveRequestedRole,
  type MochiRuntimeRole,
} from "./dsh/launch-role";
import { resolveMochiServiceDefaults } from "./dsh/profile";
import { IPC, type LanAttentionKind } from "./dsh/protocol";
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
// [Mochi 2026-09-11] WO-7 同一台机器可以同时保留教师端与教室端入口：角色
// 声明按角色分文件，Electron 的 userData 目录也按角色隔离。userData 里放着
// 单实例锁（SingletonLock）与会话缓存，共用一份会导致「先起教师端、再双击
// 教室端快捷方式」被第二实例逻辑并进教师端窗口。隔离后两个角色各自单实例，
// 且与「同角色单实例」的原语义完全一致。DshWebHost 的 env 会过滤所有
// ELECTRON_* 变量，所以这个隔离不会渗进 Harness 子进程。
const ROLE_USER_DATA_DIR_SUFFIX: Record<MochiRuntimeRole, string> = {
  teacher: "",
  classroom: "-classroom",
};
const LAN_ATTENTION_THROTTLE_MS = 3_000;

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
let runtimeRole: MochiRuntimeRole | null = null;
let roleSwitchedTo: MochiRuntimeRole | null = null;
let lanAttentionInstalled = false;
let lastLanAttentionAt = 0;

/**
 * [Mochi 2026-09-11] WO-7 每个角色一个 Electron userData 目录。教师端沿用
 * 历史上的 `Mochi`（兼容旧 mochi-launch.json 与既有缓存），教室端用
 * `Mochi-classroom`，互不抢占单实例锁。
 *
 * 例外：命令行显式给了 `--user-data-dir`（测试夹具、调试运行）时不再派生，
 * 否则测试会绕过自己的临时目录去抢真实用户目录的单实例锁。
 */
function hasExplicitUserDataDir(argv: readonly string[]): boolean {
  return argv.some((value) => value === "--user-data-dir" || value.startsWith("--user-data-dir="));
}

function roleUserDataDir(role: MochiRuntimeRole): string {
  if (hasExplicitUserDataDir(process.argv)) return app.getPath("userData");
  return `${app.getPath("appData")}/${app.getName()}${ROLE_USER_DATA_DIR_SUFFIX[role]}`;
}

function applyRoleUserDataPath(role: MochiRuntimeRole): void {
  app.setPath("userData", roleUserDataDir(role));
}

// [Mochi 2026-09-11] WO-7 隔离前的旧 userData 目录仍然持有角色文件，提出来
// 供迁移与「切换本机角色」读写。只在真的用了角色专属目录（也就是没有显式
// `--user-data-dir`）时才算旧目录，否则测试/调试实例会把真实用户目录里的
// 角色误认成自己的，跳过首启询问。
function legacyUserDataDirs(): string[] {
  if (hasExplicitUserDataDir(process.argv)) return [];
  return [`${app.getPath("appData")}/${app.getName()}`];
}

function currentUserDataDir(): string {
  return app.getPath("userData");
}

// [Mochi 2026-09-11] WO-7 迁移只做读取与补写，不移动旧文件；失败不影响启动。
function migrateLaunchRoleFiles(): void {
  for (const directory of legacyUserDataDirs()) {
    try {
      adoptLegacyLaunchRole(directory);
    } catch {
      // 旧布局迁移失败时保留旧文件，resolveRecordedLaunchRole 仍能识别它。
    }
  }
}

function recordedLaunchRole(): MochiRuntimeRole | null {
  const requested = resolveRequestedRole(process.argv, process.env);
  if (requested !== null) return requested;
  const directory = currentUserDataDir();
  const recorded = resolveRecordedLaunchRole(directory);
  if (recorded !== null) return recorded;
  for (const legacy of legacyUserDataDirs()) {
    if (legacy === directory) continue;
    const fromLegacy = resolveRecordedLaunchRole(legacy);
    if (fromLegacy !== null) {
      // 老机器第一次升到分文件布局：把识别到的角色补写到当前目录。
      try {
        persistLaunchRole(directory, fromLegacy);
      } catch {
        // 补写失败也能用本次识别结果启动。
      }
      return fromLegacy;
    }
  }
  return null;
}

function requestedRole(): MochiRuntimeRole | null {
  return resolveRequestedRole(process.argv, process.env);
}

async function resolveLaunchRole(): Promise<MochiRuntimeRole | null> {
  migrateLaunchRoleFiles();
  const existing = recordedLaunchRole();
  if (existing !== null) return existing;

  const choice = await dialog.showMessageBox({
    type: "question",
    title: "设置 Mochi 本机角色",
    message: "这台设备用于教师办公电脑还是教室一体机？",
    detail:
      "本机选择只影响默认启动角色，之后可以在托盘菜单里切换；两套数据互相隔离，教室端不读取教师密钥、记忆、会话。",
    buttons: ["教师办公电脑", "教室一体机", "退出"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (choice.response === 2) return null;
  const role: MochiRuntimeRole = choice.response === 0 ? "teacher" : "classroom";
  persistLaunchRole(currentUserDataDir(), role);
  return role;
}

async function reportLaunchRoleFailure(): Promise<void> {
  console.error("[mochi] 本机角色信息无法使用");
  await dialog.showMessageBox({
    type: "error",
    title: "Mochi 无法启动",
    message: "无法读取本机角色设置。",
    detail: "请联系管理员恢复本机角色设置后重试。此操作不会修改现有数据。",
    buttons: ["退出"],
    noLink: true,
  });
}

function isLiveWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed();
}

function isLanAttentionKind(value: unknown): value is LanAttentionKind {
  return value === "incoming-message" || value === "pairing-request";
}

function isCurrentHarnessMainFrame(event: IpcMainInvokeEvent): boolean {
  const window = mainWindow;
  return window !== null
    && isLiveWindow(window)
    && event.sender === window.webContents
    && event.senderFrame === event.sender.mainFrame
    && isHarnessUrl(event.sender.getURL());
}

function lanAttentionCopy(kind: LanAttentionKind): { title: string; body: string } {
  return kind === "incoming-message"
    ? { title: "Mochi 教室连接", body: "收到新的教师通知，请在应用中人工确认已看到。" }
    : { title: "Mochi 教室连接", body: "收到新的配对申请，请在应用中核对后人工处理。" };
}

function showLanAttention(kind: LanAttentionKind): void {
  const window = mainWindow;
  if (window === null || !isLiveWindow(window)) return;
  const now = Date.now();
  if (now - lastLanAttentionAt < LAN_ATTENTION_THROTTLE_MS) return;
  lastLanAttentionAt = now;

  const wasBackgrounded = window.isMinimized() || !window.isVisible();
  focusWindow(window);
  if (!wasBackgrounded || !Notification.isSupported()) return;

  const notification = new Notification(lanAttentionCopy(kind));
  notification.once("click", () => {
    if (mainWindow !== null && isLiveWindow(mainWindow)) focusWindow(mainWindow);
  });
  notification.show();
}

function installLanAttentionBridge(): void {
  if (lanAttentionInstalled) return;
  lanAttentionInstalled = true;
  ipcMain.handle(IPC.lanAttention, (event, kind: unknown) => {
    if (!isLanAttentionKind(kind) || !isCurrentHarnessMainFrame(event)) return false;
    showLanAttention(kind);
    return true;
  });
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
      preload: join(__dirname, "lan-attention-preload.js"),
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
  if (runtimeRole === null) return Promise.reject(new Error("Mochi 启动角色尚未设置"));

  const host = new DshWebHost(runtimeRole);
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
  if (runtimeRole === null) return;
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

/**
 * [Mochi 2026-09-11] WO-7 切换本机角色：只在桌面壳层做（网页设置拿不到这条
 * 路径）。流程是「中文确认 → 改写角色声明 → 重启应用」，数据一律不动：两套
 * home 各自独立，切回来内容原样还在。
 */
async function switchLaunchRole(role: MochiRuntimeRole): Promise<void> {
  const current = runtimeRole;
  const fromLabel = current === null ? "未知" : launchRoleLabel(current);
  const targetLabel = launchRoleLabel(role);
  const confirmation = await dialog.showMessageBox({
    type: "question",
    title: "切换本机角色",
    message: `要把这台设备切换到「${targetLabel}」吗？`,
    detail:
      `当前角色：${fromLabel}。\n`
      + "切换只影响下次启动的角色，不会删除任何数据；"
      + "教师端与教室端使用互相隔离的数据目录，切回原角色后内容仍在。\n"
      + `切换后 Mochi 会立即重启，并以「${targetLabel}」重新启动本地服务。`,
    buttons: ["切换并重启", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (confirmation.response !== 0) return;

  try {
    persistLaunchRole(currentUserDataDir(), role);
  } catch {
    await dialog.showMessageBox({
      type: "error",
      title: "切换失败",
      message: "无法写入本机角色设置。",
      detail: "Mochi 仍以原角色继续运行，现有数据未受影响。请检查本机磁盘权限后重试。",
      buttons: ["知道了"],
      noLink: true,
    });
    return;
  }

  // 切换必须重启才生效：当前进程已经带着旧角色的 home 与 Harness 子进程在跑。
  roleSwitchedTo = role;
  console.log(`[mochi] 本机角色已切换为 ${targetLabel}，准备重启`);
  relaunchForRoleSwitch();
}

function relaunchForRoleSwitch(): void {
  const targetRole = roleSwitchedTo;
  if (targetRole === null) return;
  appIsQuitting = true;
  destroyDesktopTray();
  // 目标角色文件已经落盘，所以重启后不会再次弹首启对话框。
  const args = process.argv.slice(1).filter((value) => !value.startsWith(LAUNCH_ROLE_ARG_PREFIX));
  app.relaunch({ args: [...args, `${LAUNCH_ROLE_ARG_PREFIX}${targetRole}`] });
  app.exit(0);
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
        currentRoleLabel: runtimeRole === null ? "未设置" : launchRoleLabel(runtimeRole),
        open: focusOrRestoreMainWindow,
        restart: restartHostFromTray,
        switchRole: switchLaunchRole,
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

// [Mochi 2026-09-11] WO-7 单实例锁按角色隔离。锁与缓存都位于 userData，
// 因此必须在 requestSingleInstanceLock() 之前决定目录：教师端沿用 `Mochi`
// （老机器的锁文件与缓存原地不动），教室端用 `Mochi-classroom`。这也是
// 「同角色单实例、不同角色各自单实例」这条语义的实现方式——不引入第二个
// 进程常驻，也不改 DSH 的两套 home 命名。
const explicitRole = requestedRole();
if (explicitRole !== null) applyRoleUserDataPath(explicitRole);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // 同一个 userData 目录意味着同一角色：第二个实例只把已有窗口带到前台。
    // 例外是显式带了另一个 `--role=` 的启动（角色切换后的 relaunch），
    // 此时当前进程自己重启到新角色目录。
    const incomingRole = resolveRequestedRole(argv, {});
    if (incomingRole !== null && incomingRole !== runtimeRole) {
      roleSwitchedTo ??= incomingRole;
      relaunchForRoleSwitch();
      return;
    }
    if (app.isReady()) focusOrRestoreMainWindow();
    else app.once("ready", () => focusOrRestoreMainWindow());
  });

  app.whenReady().then(async () => {
    try {
      const selectedRole = await resolveLaunchRole();
      if (selectedRole === null) {
        app.quit();
        return;
      }
      runtimeRole = selectedRole;
      // [Mochi 2026-09-11] WO-7 角色由存量文件/首启对话框决定时也要落到
      // 角色专属 userData 目录，保证下次启动的单实例锁落在同一处。
      applyRoleUserDataPath(selectedRole);
      installLanAttentionBridge();
      initializeDoctorWindow();
      openWindowForCurrentState();
      initializeDesktopTray();
    } catch {
      await reportLaunchRoleFailure();
      app.quit();
    }
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
