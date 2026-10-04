import { installMicrophonePermissions } from "./dsh/microphone-permissions";
import { CLASSROOM_STARTUP_ARG, createClassroomStartup } from "./dsh/classroom-startup";
import { isPetPalette, type PetPaletteId } from "./dsh/pet-palettes.generated";
import { verifyTeacherIdentity } from "./dsh/role-verification";
import { PAPER_WINDOW_CSS } from "./dsh/window-theme";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, Notification, shell, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent, type NativeImage } from "electron";
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
  launchRolePathFor,
  persistLaunchRole,
  resolveLaunchRole as resolveRecordedLaunchRole,
  resolveRequestedRole,
  type MochiRuntimeRole,
} from "./dsh/launch-role";
import { resolveMochiServiceDefaults } from "./dsh/profile";
import { IPC, type LanAttentionKind, type RailAction, type RailSnapshot, type RailSurface, type RailSyncHealth } from "./dsh/protocol";
import { createMochiRail, type MochiRailHandle } from "./dsh/rail";
import { classroomRailSnapshot, newAttentionPayloads, railSnapshotSignature, teacherRailSnapshot } from "./dsh/rail-model";
import { createRailPositionStore } from "./dsh/rail-store";
import { destroyMochiTray, initializeMochiTray, type MochiTrayHandle } from "./dsh/tray";
import { createClassroomCallObserver } from "./dsh/voice-call";
import { prepareClassroomVoice, speakClassroomCall, speakVoiceReply, registerLanSpeechActivity } from "./dsh/voice-synthesis";
import { createVoiceReply, isVoiceRequestId } from "./dsh/voice-reply";
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
  | "WEB_HOST_PROFILE_PREPARATION_FAILED"
  | "WEB_HOST_RUNTIME_MISSING"
  | "WEB_HOST_TIMEOUT"
  | "WEB_HOST_EXITED"
  | "WEB_HOST_START_FAILED";

interface StartupDiagnostic {
  code: StartupDiagnosticCode;
  stage: "web-host";
}

let mainWindow: BrowserWindow | null = null;
let pendingRailFocusMessageId: string | null = null;
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
let automaticClassroomLaunch = process.argv.includes(CLASSROOM_STARTUP_ARG);
let classroomStartup: ReturnType<typeof createClassroomStartup> | undefined;
let roleSwitchedTo: MochiRuntimeRole | null = null;
let lanAttentionInstalled = false;
let lastLanAttentionAt = 0;
// [Mochi 2026-09-18] 常驻条：教师端一条待办横条、教室端一块名单常驻屏。
// 两块屏都由本进程持有，页面只把原始 LAN 快照推上来，派生在本进程做一次。
let mochiRail: MochiRailHandle | null = null;
let uiSoundEnabled = false;
let petPalette: PetPaletteId = "caramel";
let railBridgeInstalled = false;
let railVisible = true;
let classroomCallObserver: ReturnType<typeof createClassroomCallObserver> | null = null;
/**
 * 上一份派生结果。弹窗只对「这一份里新出现的行」触发，所以必须记住上一份；
 * 它同时提供了「首次拿到快照不弹窗」的依据——否则每次启动都会把历史待办全弹一遍。
 */
let railLastSnapshot: RailSnapshot | null = null;
/** 上一份内容指纹；也包含隐藏预约 ID，以便可见行不变时仍能提醒。 */
let railLastSignature = "";
let railSyncHealth: RailSyncHealth = { status: "waiting" };
let railSyncTimeout: ReturnType<typeof setTimeout> | null = null;
const RAIL_SYNC_TIMEOUT_MS = 20_000;
const RAIL_SEEN_TIMEOUT_MS = 12_000;
const pendingRailSeen = new Map<string, {
  popupId: string;
  senderId: number;
  rail: MochiRailHandle;
  timer: ReturnType<typeof setTimeout>;
}>();

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
  const requested = requestedRole();
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
  return resolveRequestedRole(process.argv, process.env) ?? (automaticClassroomLaunch ? "classroom" : null);
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

function installClassroomDesktopBridge(): void {
  registerLanSpeechActivity(busy => {
    lanAudioActivity = { busy, revision: lanAudioActivity.revision + 1 };
    if (runtimeRole !== 'classroom' || !mainWindow || mainWindow.isDestroyed()
      || mainWindow.webContents.isDestroyed() || !isHarnessUrl(mainWindow.webContents.getURL())) return;
    mainWindow.webContents.send('mochi:audio-busy', lanAudioActivity);
  });
  const allowed = (event: IpcMainInvokeEvent) => runtimeRole === "classroom" && isCurrentHarnessMainFrame(event);
  ipcMain.handle('mochi:audio-status', event => allowed(event) ? lanAudioActivity : null);
  ipcMain.handle("mochi:classroom:startup-get", event => {
    if (!allowed(event)) throw new Error("课堂启动设置不可用");
    return classroomStartup?.get() ?? { supported: false, enabled: false, needsApproval: false };
  });
  ipcMain.handle("mochi:classroom:startup-set", (event, enabled: unknown) => {
    if (!allowed(event) || typeof enabled !== "boolean") throw new Error("课堂启动设置不可用");
    return classroomStartup?.set(enabled) ?? { supported: false, enabled: false, needsApproval: false };
  });
  ipcMain.handle("mochi:classroom:wake", event => {
    if (!allowed(event)) return false;
    setDesktopRailVisible(true);
    focusOrRestoreMainWindow();
    return true;
  });
  ipcMain.handle("mochi:classroom:listening-ready", event => {
    if (!allowed(event)) return false;
    if (automaticClassroomLaunch && mainWindow && !mainWindow.isDestroyed() && hasLiveMochiTray()) {
      automaticClassroomLaunch = false;
      mainWindow.hide();
    }
    return true;
  });
  ipcMain.handle("mochi:classroom:letter-ready", (event, value: unknown) => {
    if (!allowed(event) || !value || typeof value !== 'object') return false;
    const letter = value as Record<string, unknown>;
    if (!isVoiceRequestId(letter.id) || typeof letter.body !== 'string' || letter.body.length > 100000
      || typeof letter.endedAt !== 'number' || !Number.isFinite(letter.endedAt)
      || letter.endedAt < 0 || letter.endedAt > 8.64e15) return false;
    return mochiRail?.attention({ id: `classroom-letter:${letter.id}`, kind: 'request',
      title: 'Mochi 把作业记好啦', subject: '一封课堂作业小信',
      detail: letter.body.length > 235 ? `${letter.body.slice(0,235)}…` : letter.body,
      at: new Date(letter.endedAt).toISOString() }) ?? false;
  });
  ipcMain.handle("mochi:classroom:take-letter", event => {
    if (!allowed(event)) return null;
    const id = pendingClassroomLetter;
    pendingClassroomLetter = null;
    return id;
  });
  ipcMain.handle('mochi:classroom:reminder-ready', (event, value: unknown) => {
    if (!allowed(event) || !value || typeof value !== 'object') return false;
    const paper = value as Record<string, unknown>;
    if (!isVoiceRequestId(paper.id) || typeof paper.title !== 'string' || paper.title.length > 120
      || typeof paper.body !== 'string' || paper.body.length > 10000 || typeof paper.at !== 'number'
      || !Number.isFinite(paper.at) || paper.at < 0 || paper.at > 8.64e15) return false;
    return mochiRail?.attention({ id: `classroom-reminder:${paper.id}`, kind: 'request',
      title: paper.title, subject: 'Mochi 的课堂日历', detail: paper.body.slice(0, 240),
      at: new Date(paper.at).toISOString() }) ?? false;
  });
  ipcMain.handle('mochi:classroom:take-reminder', event => {
    if (!allowed(event)) return false;
    const pending = pendingClassroomReminder;
    pendingClassroomReminder = false;
    return pending;
  });
  ipcMain.handle("mochi:voice-chat:speak", (event, request: unknown) => {
    if (!isCurrentHarnessMainFrame(event)) return { ok: false, error: '当前页面不可朗读' };
    return voiceReply.speak(request);
  });
  ipcMain.handle('mochi:voice-chat:state', event => {
    if (!isCurrentHarnessMainFrame(event)) return { enabled: false, error: '当前页面不可设置朗读' };
    return voiceReply.getState();
  });
  ipcMain.handle('mochi:voice-chat:set-enabled', (event, enabled: unknown) => {
    if (!isCurrentHarnessMainFrame(event)) return { enabled: false, error: '当前页面不可设置朗读' };
    return voiceReply.setEnabled(enabled);
  });
  ipcMain.handle("mochi:voice-chat:stop", (event, request: unknown) => {
    if (!isCurrentHarnessMainFrame(event)) return { ok: false };
    return voiceReply.stop(request);
  });
}

let pendingClassroomLetter: string | null = null;
let pendingClassroomReminder = false;
let lanAudioActivity = { busy: false, revision: 0 };
const voiceReply = createVoiceReply((text, signal) => speakVoiceReply(app.getPath('userData'), text, signal),
  () => runtimeRole ? join(app.getPath('userData'), `mochi-reply-audio-${runtimeRole}.json`) : null);

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

/* ───────────────────────── 常驻条（悬浮窗） ───────────────────────── */

/**
 * [Mochi 2026-09-18] 角色决定这一端有哪块屏：
 *   教师端 → teacher-rail（学生预约待办横条）
 *   教室端 → classroom-board（老师喊谁做什么 + 过关名单）
 * 一块进程只服务一块屏，所以这里是一个纯映射，不是开关。
 */
function railSurfaceForRole(role: MochiRuntimeRole): RailSurface {
  return role === "classroom" ? "classroom-board" : "teacher-rail";
}

/**
 * 常驻条窗口是唯一允许发 railAction 的来源。判据是「不是主窗口 + 页面是 data: URL」，
 * 而不是「窗口 id 在白名单里」——后者会在窗口重建后失效。
 */
function isRailWindowSender(event: IpcMainEvent): boolean {
  const sender = event.sender;
  if (event.senderFrame !== sender.mainFrame) return false;
  if (mainWindow !== null && !mainWindow.isDestroyed() && sender === mainWindow.webContents) return false;
  const window = BrowserWindow.fromWebContents(sender);
  if (window === null || window === mainWindow) return false;
  return sender.getURL().startsWith("data:text/html");
}

/**
 * 已认证 Harness 页面推来的原始 LAN 快照 → 常驻条。
 *
 * 派生放在主进程而不是页面里：两块屏共用同一份判断——「什么算新待办」「什么值得
 * 弹窗」只有一处实现。页面因此不需要懂业务，只负责把已认证的数据递过来；而页面
 * 与主进程各算一遍，迟早会不一致，那种不一致只会在演示时被看见。
 *
 * 原始快照是不可信输入：所有裁剪与类型判断都在 dsh/rail-model.ts 里，
 * 这里只负责选面、去抖、算差集。
 */
function applyLanStateToRail(lanState: unknown): void {
  if (runtimeRole === "classroom") {
    // The signed LAN snapshot arrives even when the rail window is temporarily absent.
    // A persisted baseline and message-ID ledger prevent announcing old calls on restart.
    void classroomCallObserver?.observe(lanState).catch((error: unknown) => {
      console.warn("[mochi] 教室叫号观察失败：", error instanceof Error ? error.message : "unknown");
    });
  }
  const rail = mochiRail;
  if (rail === null || runtimeRole === null) return;
  const inbox = lanState !== null && typeof lanState === "object" && !Array.isArray(lanState)
    ? (lanState as Record<string, unknown>).inbox : null;
  const receipted = new Set<string>();
  if (Array.isArray(inbox)) {
    for (const row of inbox) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
      const item = row as Record<string, unknown>;
      if (item.seenReceipt === "ACKNOWLEDGED" && typeof item.messageId === "string"
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(item.messageId)) receipted.add(item.messageId);
    }
  }
  // A manual confirmation in the main LAN panel may not change the board's
  // visible rows. Reconcile queued reminders before the snapshot signature exit.
  rail.dismissReceipted([...receipted]);
  const surface = railSurfaceForRole(runtimeRole);
  const now = new Date().toISOString();
  const next = surface === "classroom-board"
    ? classroomRailSnapshot(lanState, now)
    : teacherRailSnapshot(lanState, now);

  const signature = railSnapshotSignature(next);
  if (signature === railLastSignature) return;

  // 差集必须在替换上一份之前算：它要的是「上一份」与「这一份」的差。
  const attention = newAttentionPayloads(surface, railLastSnapshot, next);
  railLastSnapshot = next;
  railLastSignature = signature;

  rail.apply(next);
  for (const payload of attention) {
    if (!payload.receiptMessageId || !receipted.has(payload.receiptMessageId)) rail.attention(payload);
  }
}

function reportRailSyncHealth(ok: boolean): void {
  if (railSyncTimeout !== null) clearTimeout(railSyncTimeout);
  railSyncTimeout = null;
  if (ok) {
    railSyncHealth = { status: "live", lastSuccessAt: new Date().toISOString() };
    railSyncTimeout = setTimeout(() => {
      railSyncTimeout = null;
      if (appIsQuitting) return;
      railSyncHealth = { status: "stale", lastSuccessAt: railSyncHealth.lastSuccessAt };
      mochiRail?.syncHealth(railSyncHealth);
    }, RAIL_SYNC_TIMEOUT_MS);
  } else {
    railSyncHealth = { status: "stale", ...(railSyncHealth.lastSuccessAt ? { lastSuccessAt: railSyncHealth.lastSuccessAt } : {}) };
  }
  mochiRail?.syncHealth(railSyncHealth);
}

function installRailBridge(): void {
  if (railBridgeInstalled) return;
  railBridgeInstalled = true;
  ipcMain.on(IPC.petPalette, (event, palette: unknown) => {
    if (!isCurrentHarnessMainFrame(event) || !isPetPalette(palette)) return;
    petPalette = palette;
    mochiRail?.setPetPalette(palette);
  });
  ipcMain.on(IPC.uiSound, (event, enabled: unknown) => {
    if (!isCurrentHarnessMainFrame(event) || typeof enabled !== "boolean") return;
    uiSoundEnabled = enabled;
    mochiRail?.setSoundEnabled(enabled);
  });
  ipcMain.on(IPC.appearance, (event, preference: unknown) => {
    if (!isCurrentHarnessMainFrame(event)) return;
    if (preference !== "light" && preference !== "dark" && preference !== "system") return;
    nativeTheme.themeSource = preference;
  });

  // Harness 页面 → 主进程。页面只被允许推「原始 LAN 快照」，不认识常驻条的形状。
  ipcMain.on(IPC.railLanState, (event, lanState: unknown) => {
    if (!isCurrentHarnessMainFrame(event)) return;
    applyLanStateToRail(lanState);
  });
  ipcMain.on(IPC.railSyncHealth, (event, ok: unknown) => {
    if (!isCurrentHarnessMainFrame(event) || typeof ok !== "boolean") return;
    reportRailSyncHealth(ok);
  });
  // 常驻条窗口 → 主进程。
  ipcMain.on(IPC.railAction, (event, action: unknown) => {
    if (!isRailWindowSender(event)) return;
    mochiRail?.dispatch(action);
  });
  ipcMain.handle(IPC.railTakeFocusMessage, (event) => {
    if (!isCurrentHarnessMainFrame(event)) return null;
    const messageId = pendingRailFocusMessageId;
    pendingRailFocusMessageId = null;
    return messageId;
  });
  ipcMain.on(IPC.railMarkSeenResult, (event, value: unknown) => {
    if (!isCurrentHarnessMainFrame(event) || value === null || typeof value !== "object") return;
    const result = value as Record<string, unknown>;
    if (typeof result.requestId !== "string" || typeof result.ok !== "boolean") return;
    const pending = pendingRailSeen.get(result.requestId);
    if (!pending || pending.senderId !== event.sender.id) return;
    pendingRailSeen.delete(result.requestId);
    clearTimeout(pending.timer);
    if (mochiRail !== pending.rail) return;
    if (result.ok) {
      pending.rail.dispatch({ type: "dismiss", id: pending.popupId });
      return;
    }
    const message = typeof result.message === "string" ? result.message.slice(0, 120) : "";
    pending.rail.feedback(pending.popupId, false, message || "发送已看到回执失败，请重试。");
  });
}

function handleRailAction(action: RailAction): void {
  if (action.type === "acknowledge") {
    const rail = mochiRail;
    const target = mainWindow;
    if (typeof action.receiptMessageId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(action.receiptMessageId)) return;
    if (!rail || !target || target.isDestroyed() || target.webContents.isDestroyed()
      || !isHarnessUrl(target.webContents.getURL())) {
      rail?.feedback(action.id, false, "Mochi 页面尚未就绪，请打开后重试。");
      return;
    }
    if ([...pendingRailSeen.values()].some((item) => item.popupId === action.id && item.rail === rail)) return;
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      const pending = pendingRailSeen.get(requestId);
      if (!pending) return;
      pendingRailSeen.delete(requestId);
      if (mochiRail === pending.rail) pending.rail.feedback(pending.popupId, false, "确认超时，请重试或打开 Mochi 查看。");
    }, RAIL_SEEN_TIMEOUT_MS);
    pendingRailSeen.set(requestId, { popupId: action.id, senderId: target.webContents.id, rail, timer });
    try {
      target.webContents.send(IPC.railMarkSeenRequest, { requestId, messageId: action.receiptMessageId });
    } catch {
      clearTimeout(timer);
      pendingRailSeen.delete(requestId);
      rail.feedback(action.id, false, "Mochi 页面暂时不可用，请重试。");
    }
    return;
  }
  if (action.type === "open") {
    if (runtimeRole === 'classroom' && action.id?.startsWith('classroom-reminder:')) {
      if (!isVoiceRequestId(action.id.slice('classroom-reminder:'.length))) return;
      pendingClassroomReminder = true;
      focusOrRestoreMainWindow();
      mainWindow?.webContents.send('mochi:classroom:open-reminder');
      return;
    }
    if (runtimeRole === 'classroom' && action.id?.startsWith('classroom-letter:')) {
      const id = action.id.slice('classroom-letter:'.length);
      if (!isVoiceRequestId(id)) return;
      pendingClassroomLetter = id;
      focusOrRestoreMainWindow();
      mainWindow?.webContents.send('mochi:classroom:open-letter');
      return;
    }
    // 主进程只转交待办 id；已认证 Harness 页面决定如何展示和处理。
    if (action.id) pendingRailFocusMessageId = action.id;
    focusOrRestoreMainWindow();
    if (action.id && mainWindow !== null && !mainWindow.isDestroyed()) {
      const target = mainWindow;
      if (!target.webContents.isDestroyed()) target.webContents.send(IPC.railFocusMessage);
    }
    return;
  }
  if (action.type === "hide") railVisible = false;
}

/** 常驻条被意外销毁时的有限次重建。无限重建会把一次崩溃放大成循环崩溃。 */
const RAIL_MAX_REBUILDS = 3;
let railRebuilds = 0;

/**
 * 独立的读写函数，而不是在 initializeDesktopRail 里直接 `mochiRail.setVisible`：
 * 那个函数开头有 `mochiRail !== null` 的提前返回，TS 会把这个收窄带进同一作用域的
 * 闭包里，导致闭包内的 `mochiRail` 被当成 never。
 */
function setDesktopRailVisible(visible: boolean): void {
  mochiRail?.setVisible(visible);
}

function rebuildDesktopRail(): void {
  if (appIsQuitting || railRebuilds >= RAIL_MAX_REBUILDS) {
    if (!appIsQuitting) console.error("[mochi] 待办条多次异常关闭，已停止自动重建");
    return;
  }
  railRebuilds += 1;
  initializeDesktopRail();
  setDesktopRailVisible(railVisible);
}

function initializeDesktopRail(): void {
  if (mochiRail !== null || appIsQuitting || runtimeRole === null) return;
  const store = createRailPositionStore(join(app.getPath("userData"), "mochi-rail-positions.json"));
  railVisible = store.loadVisible?.(railSurfaceForRole(runtimeRole)) ?? railVisible;
  mochiRail = createMochiRail({
    surface: railSurfaceForRole(runtimeRole),
    preload: join(__dirname, "rail-preload.js"),
    store,
    onAction: handleRailAction,
    onClosed: () => {
      mochiRail = null;
      rebuildDesktopRail();
    },
  });
  // 窗口是在「数据可能早就到了」之后才建的（托盘重新显示、崩溃重建），
  // 而 applyLanStateToRail 会因为内容没变而提前返回。这里补推一次，
  // 否则重建出来的窗口会一直空着，直到数据下一次变化。
  mochiRail.setSoundEnabled(uiSoundEnabled);
  mochiRail.setPetPalette(petPalette);
  if (railLastSnapshot !== null) mochiRail.apply(railLastSnapshot);
  mochiRail.syncHealth(railSyncHealth);
  setDesktopRailVisible(railVisible);
}

function disposeDesktopRail(): void {
  const rail = mochiRail;
  mochiRail = null;
  if (rail !== null) rail.dispose();
}

function toggleDesktopRail(): void {
  railVisible = !railVisible;
  if (mochiRail === null) {
    railRebuilds = 0;
    if (railVisible) initializeDesktopRail();
    return;
  }
  setDesktopRailVisible(railVisible);
}

/**
 * 常驻条窗口存在时 `window-all-closed` 不会再触发，所以「关掉主窗口要不要退出」
 * 必须在这里补回原来的语义：非 macOS、且没有可用托盘时，关掉主窗口仍然是退出
 * 应用，而不是留下一条孤零零的悬浮条和一个半死的进程。
 */
function quitIfMainWindowWasLastSurface(): void {
  if (appIsQuitting || process.platform === "darwin" || hasLiveMochiTray()) return;
  disposeDesktopRail();
  app.quit();
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
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mochi</title><style>${PAPER_WINDOW_CSS}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper-canvas);color:var(--paper-ink);font:16px/1.6 system-ui}.card{box-sizing:border-box;width:min(440px,calc(100% - 40px));padding:32px;border:1px solid var(--paper-line);border-radius:24px;background:var(--paper-surface);box-shadow:0 6px 24px #51422b0d}h1{margin:0 0 8px;font-size:23px;line-height:1.25;letter-spacing:-.02em}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:10px;background:var(--paper-accent)}p{margin:10px 0}.hint{color:var(--paper-muted);font-size:14px}</style><main class="card" aria-labelledby="startup-title" aria-busy="true"><h1 id="startup-title"><span class="dot" aria-hidden="true"></span>Mochi</h1><p role="status" aria-live="polite" aria-atomic="true">${text}</p><p class="hint">服务就绪后会自动打开工作区，无需重复点击。</p></main></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function diagnosticFor(error: unknown): StartupDiagnostic {
  if (error instanceof Error && "code" in error && error.code === "WEB_HOST_PROFILE_PREPARATION_FAILED") {
    return { stage: "web-host", code: "WEB_HOST_PROFILE_PREPARATION_FAILED" };
  }
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
  const guidance: Record<string, string[]> = {
    WEB_HOST_PROFILE_PREPARATION_FAILED: ["旧配置升级准备未完成。", "原设置已保留，请勿删除配置目录。修复兼容问题后点“重新尝试”；仍失败时复制诊断供排查。"],
    WEB_HOST_RUNTIME_MISSING: ["本地运行组件缺失，工作界面无法打开。", "请使用完整安装包重新安装 Mochi；保留原设置和历史，不要删除用户数据。"],
    WEB_HOST_TIMEOUT: ["本地服务未能在等待时间内就绪。", "请点“重新尝试”。仍失败时复制诊断，便于继续排查。"],
    WEB_HOST_EXITED: ["本地服务在打开工作界面前退出。", "请点“重新尝试”。仍失败时复制诊断，便于继续排查。"],
  };
  const [reason, action] = guidance[diagnostic.code] ?? ["本地服务未能启动，工作界面暂时无法打开。", "请点“重新尝试”。仍失败时复制诊断；环境诊断位于“帮助”菜单。"];
  return ["Mochi 启动诊断", `阶段: ${diagnostic.stage}`, `代码: ${diagnostic.code}`, `原因: ${reason}`, `建议: ${action}`].join("\n");
}

function errorPage(diagnostic: StartupDiagnostic, copied = false): string {
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
  const guidance = diagnosticText(diagnostic).split("\n").slice(3);
  const copyStatus = copied ? '<p class="copied" role="status" aria-live="polite">诊断已复制，可粘贴给协助排查的人。</p>' : '';
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mochi 启动失败</title><style>${PAPER_WINDOW_CSS}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper-canvas);color:var(--paper-ink);font:16px/1.6 system-ui}.card{box-sizing:border-box;width:min(640px,calc(100% - 40px));margin:24px 0;padding:32px;border:1px solid var(--paper-line);border-radius:24px;background:var(--paper-surface)}h1{font-size:24px;line-height:1.25;letter-spacing:-.02em;margin:0 0 16px}p{margin:10px 0}.privacy,.diagnostic{color:var(--paper-muted);font-size:14px}code{overflow-wrap:anywhere}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}button{border:0;border-radius:12px;min-height:44px;padding:10px 15px;background:var(--paper-accent);color:#1b211e;font:inherit;font-weight:600;cursor:pointer}.secondary{background:var(--paper-recess);color:var(--paper-ink)}.copied{color:var(--paper-success)}button:disabled{cursor:wait}.actions:focus-within{isolation:isolate}@media(max-width:500px){.card{padding:24px}.actions button{flex:1}}</style><main class="card" aria-labelledby="failure-title" aria-describedby="failure-guidance"><h1 id="failure-title" tabindex="-1">Mochi 的工作界面暂时没能打开</h1><div id="failure-guidance">${guidance.map(line => `<p>${escapeHtml(line.replace(/^(原因|建议): /, ""))}</p>`).join("")}</div><p class="diagnostic">诊断代码：<code>${escapeHtml(diagnostic.code)}</code></p><p class="privacy">诊断包含错误代码和恢复建议，不含密钥或聊天内容。</p>${copyStatus}<div class="actions" aria-busy="false"><button id="retry" type="button">重新尝试</button><button id="copy" class="secondary" type="button">复制诊断</button></div></main><script>
    const actions=document.querySelector('.actions');
    const go=(target,button,label)=>{if(actions.getAttribute('aria-busy')==='true')return;actions.setAttribute('aria-busy','true');document.querySelectorAll('button').forEach(item=>item.disabled=true);button.textContent=label;location.href=target};
    document.getElementById('retry').addEventListener('click',event=>go(${JSON.stringify(STARTUP_RETRY_URL)},event.currentTarget,'正在重新启动…'));
    document.getElementById('copy').addEventListener('click',event=>go(${JSON.stringify(STARTUP_COPY_DIAGNOSTIC_URL)},event.currentTarget,'正在复制…'));
    ${copied ? "document.getElementById('copy').focus({preventScroll:true});" : "document.getElementById('failure-title').focus({preventScroll:true});"}
    </script></html>`;
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
  let closeRequestedBeforeReady = false;
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: "Mochi",
    ...(process.platform === "win32" && !app.isPackaged ? { icon: join(app.getAppPath(), "build", "icon.ico") } : {}),
    backgroundColor: "#f6f3ec", // 与纸白工作台一致，避免启动时深绿闪屏
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The 3-second LAN state poll lives in the authenticated renderer and
      // feeds the detached desktop rail. Keep that cadence while the main
      // window is hidden (macOS close or Windows tray); this also keeps the
      // hidden renderer drawing, so it trades some idle power for timely pets.
      backgroundThrottling: false,
      preload: join(__dirname, "lan-attention-preload.js"),
    },
  });
  mainWindow = window;
  installMicrophonePermissions(window.webContents.session,
    () => mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined,
    isHarnessUrl,
    {
      granted: kind => process.platform !== "darwin" || systemPreferences.getMediaAccessStatus(kind) === "granted",
      request: kind => process.platform === "darwin" ? systemPreferences.askForMediaAccess(kind) : Promise.resolve(true),
    });

  // 首个 data: 启动页就绪即显示，不再等待 sidecar 先完成。
  window.once("ready-to-show", () => {
    if (isLiveWindow(window) && !closeRequestedBeforeReady) window.show();
  });

  // 站外链接交给系统浏览器；Harness 本地同源导航留在窗口内。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isHarnessUrl(url)) openExternalIfAllowed(url);
    return { action: isHarnessUrl(url) ? "allow" : "deny" };
  });
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) voiceReply.stopAll();
  });
  window.webContents.on('render-process-gone', () => voiceReply.stopAll());
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
    // macOS convention is to keep the app and its authenticated workspace alive
    // when the last window closes. The hidden WebContents continues receiving
    // LAN updates for the desktop rail; Dock activation / a second instance can
    // reveal this same page without reloading it. Explicit app.quit() still
    // proceeds because before-quit sets appIsQuitting first.
    if (process.platform === "darwin" && !appIsQuitting) {
      closeRequestedBeforeReady = true;
      event.preventDefault();
      window.hide();
      return;
    }
    if (process.platform === "win32" && !appIsQuitting && hasLiveMochiTray()) {
      closeRequestedBeforeReady = true;
      event.preventDefault();
      window.hide();
    }
  });

  window.on("closed", () => {
    voiceReply.stopAll();
    if (mainWindow === window) mainWindow = null;
    activeDiagnosticPageUrl = null;
    quitIfMainWindowWasLastSurface();
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
      + (current === "classroom" && role === "teacher" ? "重启后需登录班主任校园账号验证身份；取消或验证失败将留在教室端。" : `切换后 Mochi 会立即重启，并以「${targetLabel}」重新启动本地服务。`),
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

async function loadDesktopTrayIcon(): Promise<NativeImage> {
  const directory = app.isPackaged ? join(process.resourcesPath, "icons") : join(app.getAppPath(), "build");
  if (process.platform === "darwin") {
    const icon = nativeImage.createFromBuffer(readFileSync(join(directory, "MochiTemplate.png")));
    icon.addRepresentation({
      scaleFactor: 2,
      dataURL: `data:image/png;base64,${readFileSync(join(directory, "MochiTemplate@2x.png")).toString("base64")}`,
    });
    if (icon.isEmpty()) throw new Error("Mochi 菜单栏图标资源不可用");
    icon.setTemplateImage(true);
    return icon;
  }
  const icon = nativeImage.createFromPath(join(directory, "icon.ico"));
  if (icon.isEmpty()) throw new Error("Mochi 托盘图标资源不可用");
  return icon;
}

function initializeDesktopTray(): void {
  if (trayInitializationPromise !== null || appIsQuitting) return;
  const run = (async () => {
    try {
      const icon = await loadDesktopTrayIcon();
      if (appIsQuitting) return;
      mochiTray = initializeMochiTray({
        icon,
        currentRoleLabel: runtimeRole === null ? "未设置" : launchRoleLabel(runtimeRole),
        open: focusOrRestoreMainWindow,
        toggleRail: toggleDesktopRail,
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
// macOS login items do not accept startup arguments; resolve the classroom role
// before selecting its single-instance directory.
if (process.platform === "darwin" && app.isPackaged) {
  try { automaticClassroomLaunch ||= app.getLoginItemSettings().wasOpenedAtLogin; } catch { /* ordinary launch */ }
}

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
      void switchLaunchRole(incomingRole);
      return;
    }
    if (app.isReady()) focusOrRestoreMainWindow();
    else app.once("ready", () => focusOrRestoreMainWindow());
  });

  app.whenReady().then(async () => {
    try {
      if (process.platform === "darwin" && !app.isPackaged) {
        app.dock?.setIcon(join(app.getAppPath(), "build", "icon.png"));
      }
      let selectedRole = await resolveLaunchRole();
      if (selectedRole === "teacher" && [currentUserDataDir(), roleUserDataDir("classroom"), ...legacyUserDataDirs()]
        .some(directory => existsSync(launchRolePathFor(directory, "classroom")))) {
        const verified = await verifyTeacherIdentity(resolveMochiServiceDefaults().campusApiUrl);
        if (!verified) {
          // Reacquire the classroom single-instance lock before opening its runtime.
          roleSwitchedTo = "classroom";
          relaunchForRoleSwitch();
          return;
        }
      }
      if (selectedRole === null) {
        app.quit();
        return;
      }
      runtimeRole = selectedRole;
      // [Mochi 2026-09-11] WO-7 角色由存量文件/首启对话框决定时也要落到
      // 角色专属 userData 目录，保证下次启动的单实例锁落在同一处。
      applyRoleUserDataPath(selectedRole);
      if (selectedRole === "classroom") {
        persistLaunchRole(currentUserDataDir(), "classroom");
        const dataPath = app.getPath("userData");
        classroomStartup = createClassroomStartup(app, {
          platform: process.platform,
          packaged: app.isPackaged && process.env.MOCHI_DESKTOP_SMOKE !== "1" && !hasExplicitUserDataDir(process.argv),
          dataPath,
          executable: process.execPath,
        });
        try { classroomStartup.initialize(); } catch (error) { console.warn("[Mochi] 无法注册课堂开机启动", error); }
        classroomCallObserver = createClassroomCallObserver(join(dataPath, "voice-call-delivery.json"),
          ({ text, messageId }) => speakClassroomCall(dataPath, text, messageId));
        // The packaged-app smoke verifies startup; the native voice smoke tests
        // the optional download separately. Avoid fetching 164 MB into its temp profile.
        if (process.env.MOCHI_DESKTOP_SMOKE !== "1") prepareClassroomVoice(dataPath);
      }
      installLanAttentionBridge();
      installClassroomDesktopBridge();
      installRailBridge();
      initializeDoctorWindow();
      openWindowForCurrentState();
      initializeDesktopRail();
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
    voiceReply.stopAll();
    disposeDesktopRail();
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
