import { isPetPalette, type PetPaletteId } from "./pet-palettes.generated";
import { BrowserWindow, screen } from "electron";
import { IPC, type RailAction, type RailAttentionPayload, type RailRow, type RailSnapshot, type RailSurface, type RailSyncHealth, type RailTone } from "./protocol";
import { popupPageHtml, railPageHtml } from "./rail-pages";
import { advanceRailSpring, isRailSpringSettled, type RailSpringValue } from "./rail-spring";

/**
 * [Mochi 2026-09-18] 常驻条（悬浮窗）控制器。
 *
 * 职责边界：
 * - 只负责「窗口 + 形状校验 + 位置记忆 + 弹窗排队」，不访问网络、不读业务数据、不认识学生。
 * - 数据由已认证的 Harness 页面算好后经 IPC 推给主进程，主进程整份替换下发。
 * - 刻意不做增量合并：两端各持有一份会被覆盖的快照，就不存在第二个事实源。
 *
 * 两块屏共用这一个控制器，差别只由 surface 决定：
 *   teacher-rail     教师私有小横条（学生预约待办）；floating 层级，不压全屏演示
 *   classroom-board  教室端常驻屏（喊谁做什么 + 过关名单）；screen-saver 层级，要在最上面
 */

/** 常驻条尺寸。横条形态：宽度固定，高度随内容在上下限之间自适应。 */
const RAIL_WIDTH = 336;
const RAIL_MIN_HEIGHT = 128;
const RAIL_MAX_HEIGHT = 472;
const PET_SIZE = 96;
const PET_MIN_SIZE = 72;
const PET_MAX_SIZE = 160;

/** 喊人弹窗尺寸。比常驻条大，因为它是瞬态强提醒。 */
const POPUP_WIDTH = 552;
const POPUP_HEIGHT = 280;

/** 首次启动时的默认边距；之后一律用记住的位置。 */
const DEFAULT_MARGIN_RIGHT = 24;
const DEFAULT_MARGIN_TOP = 96;

/** 同一 id 的弹窗冷却，避免轮询重复推送导致反复弹。 */
const POPUP_DEDUPE_MS = 15_000;

/** 字段上限。推送方虽在 Harness 侧，主进程仍不信任任何 renderer，一律裁剪。 */
const LIMITS = Object.freeze({
  id: 160,
  heading: 60,
  detail: 80,
  name: 80,
  meta: 80,
  note: 240,
  context: 240,
  badge: 24,
  at: 40,
  rows: 50,
});

const TONES: readonly RailTone[] = ["neutral", "attention", "ok", "bad"];
const SURFACES: readonly RailSurface[] = ["teacher-rail", "classroom-board"];
const ATTENTION_KINDS: readonly RailAttentionPayload["kind"][] = ["call", "request", "pairing"];

export interface RailPosition {
  x: number;
  y: number;
}

/**
 * 位置持久化。由调用方提供实现（主进程写 userData 下的 JSON），
 * 本模块因此不需要知道任何路径规则；测试里换成内存实现即可。
 */
export interface RailPositionStore {
  load(surface: RailSurface): RailPosition | null;
  save(surface: RailSurface, position: RailPosition): void;
  loadPetSize?(surface: RailSurface): number | null;
  savePetSize?(surface: RailSurface, size: number): void;
  loadVisible?(surface: RailSurface): boolean | null;
  saveVisible?(surface: RailSurface, visible: boolean): void;
}

export interface MochiRailOptions {
  surface: RailSurface;
  /** 绝对路径，指向编译后的 rail-preload.js（由调用方解析，本模块不碰路径）。 */
  preload: string;
  store: RailPositionStore;
  /** 需要主进程处理的动作（打开主窗口等）。sync/acknowledge 由本模块内部消化。 */
  onAction(action: RailAction): void;
  /** 常驻条窗口意外销毁时的通知；主进程据此决定是否重建。 */
  onClosed?(): void;
}

export interface MochiRailHandle {
  surface: RailSurface;
  /** 整份替换当前快照。形状不合法时整份丢弃并保留上一份，绝不半应用。 */
  apply(snapshot: unknown): boolean;
  /** Report whether the preserved snapshot still reflects a healthy LAN poll. */
  syncHealth(health: unknown): boolean;
  /** 请求弹一次喊人弹窗。同 id 冷却期内/已在队列中时忽略。 */
  attention(payload: unknown): boolean;
  /** 常驻条窗口里的动作（含内部消化的 sync/acknowledge）。 */
  dispatch(action: unknown): boolean;
  /** Deliver asynchronous receipt feedback to the current popup. */
  feedback(id: string, ok: boolean, message?: string): boolean;
  /** Remove reminders whose original inbox message has a confirmed signed receipt. */
  dismissReceipted(messageIds: readonly string[]): number;
  setSoundEnabled(enabled: boolean): void;
  setPetPalette(palette: string): void;
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  dispose(): void;
}

function clampText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  // 控制字符会让窗口内容、日志和后续展示变脏，直接剔除而不是转义。
  // 用 \p{Cc}（Unicode 控制类）而不是枚举区间：它同时覆盖 C0、DEL 与 C1
  // （U+0080–U+009F）。C1 同样是不可见控制字符，留着一样会污染展示；
  // 原来的 [\u0000-\u001f\u007f] 漏了这一段。写枚举区间还会命中 Biome 的
  // lint/suspicious/noControlCharactersInRegex（正则里出现控制字符转义）。
  return value.replace(/\p{Cc}/gu, " ").normalize("NFC").trim().slice(0, maximum);
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return minimum;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 只接受白名单字段的一行；缺 id 的行直接丢弃（去重键不可缺）。 */
function normalizeRow(value: unknown, index: number): RailRow | null {
  if (!plain(value)) return null;
  const id = clampText(value.id, LIMITS.id);
  if (id === "") return null;
  const popupDetail = typeof value.popupDetail === "string" ? clampText(value.popupDetail, LIMITS.note) : undefined;
  return {
    id,
    seq: safeInteger(value.seq, 1, 9999) || index + 1,
    name: clampText(value.name, LIMITS.name),
    meta: clampText(value.meta, LIMITS.meta),
    note: clampText(value.note, LIMITS.note),
    ...(popupDetail === undefined ? {} : { popupDetail }),
    ...(value.popupComplete === true && value.popupDetail === popupDetail && popupDetail
      ? { popupComplete: true } : {}),
    ...(value.context === undefined ? {} : { context: clampText(value.context, LIMITS.context) }),
    badge: clampText(value.badge, LIMITS.badge),
    ...(typeof value.actionRequired === "boolean" ? { actionRequired: value.actionRequired } : {}),
    tone: isOneOf(value.tone, TONES) ? value.tone : "neutral",
    at: clampText(value.at, LIMITS.at),
  };
}

/**
 * 快照校验。返回 null 表示整份不合法——调用方必须保留上一份而不是应用半份。
 * `expected` 用于拒绝串屏：教室端不可能收到教师端的数据。
 */
export function normalizeRailSnapshot(value: unknown, expected?: RailSurface): RailSnapshot | null {
  if (!plain(value)) return null;
  const surface = value.surface;
  if (!isOneOf(surface, SURFACES)) return null;
  if (expected !== undefined && surface !== expected) return null;
  // rows 缺省等于「空」，但 rows 给了却不是数组必须整份拒绝：否则一次畸形推送
  // 会把老师的待办条静默清空，老师看到的「没有待办」并不是真的没有。
  const rawRows = value.rows;
  if (rawRows !== undefined && !Array.isArray(rawRows)) return null;
  const list = Array.isArray(rawRows) ? rawRows : [];
  const rows: RailRow[] = [];
  for (const [index, candidate] of list.slice(0, LIMITS.rows).entries()) {
    const row = normalizeRow(candidate, index);
    if (row !== null) rows.push(row);
  }
  return {
    surface,
    ...(value.actionRequiredCount === undefined ? {} : { actionRequiredCount: safeInteger(value.actionRequiredCount, 0, 9999) }),
    ...(value.totalRowCount === undefined ? {} : { totalRowCount: safeInteger(value.totalRowCount, 0, 9999) }),
    heading: clampText(value.heading, LIMITS.heading),
    detail: clampText(value.detail, LIMITS.detail),
    updatedAt: clampText(value.updatedAt, LIMITS.at),
    rows,
  };
}

export function normalizeRailAttention(value: unknown): RailAttentionPayload | null {
  if (!plain(value)) return null;
  const id = clampText(value.id, LIMITS.id);
  if (id === "") return null;
  const kind = value.kind;
  if (!isOneOf(kind, ATTENTION_KINDS)) return null;
  const receiptMessageId = value.receiptMessageId;
  const receiptEligible = typeof receiptMessageId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(receiptMessageId);
  return {
    id,
    kind,
    title: clampText(value.title, LIMITS.heading),
    subject: clampText(value.subject, LIMITS.name),
    detail: clampText(value.detail, LIMITS.note),
    ...(receiptEligible ? { receiptMessageId } : {}),
    at: clampText(value.at, LIMITS.at),
  };
}

export function normalizeRailSyncHealth(value: unknown): RailSyncHealth | null {
  if (!plain(value) || !isOneOf(value.status, ["waiting", "live", "stale"] as const)) return null;
  const status = value.status as RailSyncHealth["status"];
  if (value.lastSuccessAt === undefined) return status === "live" ? null : { status };
  if (typeof value.lastSuccessAt !== "string" || value.lastSuccessAt.length > LIMITS.at
    || !Number.isFinite(Date.parse(value.lastSuccessAt))) return null;
  return { status, lastSuccessAt: value.lastSuccessAt };
}

export function normalizeRailAction(value: unknown): RailAction | null {
  if (!plain(value)) return null;
  const type = value.type;
  if (type === "hide" || type === "sync" || type === "drag-end") return { type };
  if (type === "drag-start" || type === "drag-move") {
    if (typeof value.x !== "number" || typeof value.y !== "number" || !Number.isFinite(value.x) || !Number.isFinite(value.y)
      || Math.abs(value.x) >= 100000 || Math.abs(value.y) >= 100000) return null;
    return { type, x: value.x, y: value.y };
  }
  if (type === "resize") {
    if (typeof value.size !== "number" || !Number.isFinite(value.size)) return null;
    return { type, size: Math.max(PET_MIN_SIZE, Math.min(PET_MAX_SIZE, Math.round(value.size))) };
  }
  if (type === "toggle") {
    if (value.reducedMotion !== undefined && typeof value.reducedMotion !== "boolean") return null;
    return { type, ...(value.reducedMotion === undefined ? {} : { reducedMotion: value.reducedMotion }) };
  }
  if (type === "open") {
    if (value.id === undefined) return { type };
    return { type, id: clampText(value.id, LIMITS.id) };
  }
  if (type === "acknowledge") {
    const id = clampText(value.id, LIMITS.id);
    if (id === "") return null;
    const receiptMessageId = value.receiptMessageId;
    if (receiptMessageId !== undefined && (typeof receiptMessageId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(receiptMessageId))) return null;
    return { type, id, ...(typeof receiptMessageId === "string" ? { receiptMessageId } : {}) };
  }
  if (type === "dismiss") {
    const id = clampText(value.id, LIMITS.id);
    return id === "" ? null : { type, id };
  }
  return null;
}

/** 默认落点：主显示器工作区右缘、靠上。拖走之后就按记住的位置。 */
export function defaultRailPosition(surface: RailSurface): RailPosition {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - RAIL_WIDTH - DEFAULT_MARGIN_RIGHT,
    y: workArea.y + (surface === "classroom-board" ? DEFAULT_MARGIN_TOP * 2 : DEFAULT_MARGIN_TOP),
  };
}

/**
 * 把记住的位置夹回某个显示器可见范围内。老师拔掉外接屏、改分辨率或改缩放之后，
 * 原坐标可能落在所有屏幕之外——那样悬浮条会「消失」，所以每次创建都要夹一次。
 */
export function clampPositionToDisplays(position: RailPosition, width: number, height: number): RailPosition {
  const displays = screen.getAllDisplays();
  const fits = displays.some((display) => {
    const { x, y, width: displayWidth, height: displayHeight } = display.workArea;
    return position.x >= x && position.y >= y
      && position.x + width <= x + displayWidth
      && position.y + height <= y + displayHeight;
  });
  if (fits) return position;

  // Keep a partly visible rail fully reachable: choose the display with greatest overlap,
  // then clamp inside its work area. This also repairs positions after monitor removal.
  const area = (display: Electron.Display) => {
    const left = Math.max(position.x, display.workArea.x);
    const top = Math.max(position.y, display.workArea.y);
    const right = Math.min(position.x + width, display.workArea.x + display.workArea.width);
    const bottom = Math.min(position.y + height, display.workArea.y + display.workArea.height);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  };
  const target = [...displays].sort((left, right) => area(right) - area(left))[0] ?? screen.getPrimaryDisplay();
  const { workArea } = target;
  const maximumX = Math.max(workArea.x, workArea.x + workArea.width - width);
  const maximumY = Math.max(workArea.y, workArea.y + workArea.height - height);
  return {
    x: Math.min(Math.max(position.x, workArea.x), maximumX),
    y: Math.min(Math.max(position.y, workArea.y), maximumY),
  };
}

function railHeightFor(rowCount: number, board = false): number {
  // Header, footer, list padding, and the actual card line-height all count. The board
  // uses larger type and spacing, so it gets a roomier row budget before scrolling.
  const height = board ? 120 + rowCount * 76 : 148 + rowCount * 112;
  return Math.min(RAIL_MAX_HEIGHT, Math.max(RAIL_MIN_HEIGHT, height));
}

export function createMochiRail(options: MochiRailOptions): MochiRailHandle {
  const { surface, preload, store } = options;
  const isBoard = surface === "classroom-board";
  let petSize = Math.max(PET_MIN_SIZE, Math.min(PET_MAX_SIZE, store.loadPetSize?.(surface) ?? PET_SIZE));
  let railWindow: BrowserWindow | null = null;
  let popupWindow: BrowserWindow | null = null;
  let soundEnabled = false;
  let petPalette: PetPaletteId = "caramel";
  let snapshot: RailSnapshot | null = null;
  let health: RailSyncHealth = { status: "waiting" };
  let queue: RailAttentionPayload[] = [];
  let openPopupId: string | null = null;
  let openPopupAt = 0;
  let visibleRequested = store.loadVisible?.(surface) ?? true;
  let popupSuppressed = !visibleRequested;
  let disposed = false;
  let expanded = isBoard;
  let petDrag: { pointerX: number; pointerY: number; x: number; y: number } | null = null;
  let boundsAnimationTimer: ReturnType<typeof setTimeout> | null = null;
  let boundsAnimationGeneration = 0;
  let reducedMotionPreference = false;
  let boundsSpring: {
    width: RailSpringValue;
    height: RailSpringValue;
    targetWidth: number;
    targetHeight: number;
    right: number;
    y: number;
    lastStepAt: number;
  } | null = null;

  function rememberVisibility(visible: boolean): void {
    visibleRequested = visible;
    popupSuppressed = !visible;
    if (!visible) petDrag = null;
    store.saveVisible?.(surface, visible);
  }

  function rememberPosition(window: BrowserWindow): void {
    if (disposed || window.isDestroyed()) return;
    const [x, y] = window.getPosition();
    // The persisted teacher coordinate represents the expanded panel. A collapsed pet
    // stays pinned to that panel's right edge, so toggling never drifts across sessions.
    store.save(surface, { x: isBoard || expanded ? x : x + petSize - RAIL_WIDTH, y });
  }

  function createRailWindow(): BrowserWindow {
    const remembered = store.load(surface) ?? defaultRailPosition(surface);
    const savedPosition = clampPositionToDisplays(remembered, RAIL_WIDTH, RAIL_MAX_HEIGHT);
    const initialWidth = isBoard || expanded ? RAIL_WIDTH : petSize;
    const position = { ...savedPosition, x: savedPosition.x + RAIL_WIDTH - initialWidth };
    const window = new BrowserWindow({
      ...position,
      width: initialWidth,
      height: isBoard || expanded ? railHeightFor(snapshot?.rows.length ?? 0, isBoard) : petSize,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      frame: false,
      transparent: !isBoard,
      // 常驻条不是「又一个窗口」：不进任务栏。
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      // 深绿画布与 calm-tokens 的 --sage-800 一致，避免拖动/重建时白闪。
      backgroundColor: isBoard ? "#f6f3ec" : "#00000000",
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload,
      },
    });

    // macOS 上 screen-saver 层级才能浮在全屏应用之上；Windows 忽略层级参数但仍会置顶。
    // 教师条用 floating：老师的全屏演示不该被自己那条待办挡住。
    applyTopLevel(window, isBoard);
    window.on("close", (event) => {
      // 原生关闭与页面关闭采用同一隐藏语义。
      if (disposed) return;
      event.preventDefault();
      rememberVisibility(false);
      window.hide();
      closePopupWindow();
      options.onAction({ type: "hide" });
    });
    window.on("moved", () => {
      if (boundsSpring !== null && process.platform !== "darwin") {
        const { x, y, width } = window.getBounds();
        // A drag during expansion moves the spring's anchor with the user's pointer.
        const wasUserMovement = x + width !== boundsSpring.right || y !== boundsSpring.y;
        boundsSpring.right = x + width;
        boundsSpring.y = y;
        if (wasUserMovement) rememberPosition(window);
        return;
      }
      rememberPosition(window);
    });
    window.on("closed", () => {
      if (railWindow === window) railWindow = null;
      if (!disposed) options.onClosed?.();
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(railPageHtml(surface))}`);
    window.once("ready-to-show", () => {
      if (disposed || window.isDestroyed() || !visibleRequested) return;
      // showInactive：出现但不抢老师正在打字的焦点。
      window.showInactive();
    });
    return window;
  }

  function applyTopLevel(window: BrowserWindow, board: boolean): void {
    window.setAlwaysOnTop(true, board ? "screen-saver" : "floating");
    try {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: board });
    } catch {
      // Windows 上该 API 无效；置顶能力仍由 setAlwaysOnTop 保证。
    }
  }

  function ensureRailWindow(): BrowserWindow {
    if (railWindow !== null && !railWindow.isDestroyed()) return railWindow;
    railWindow = createRailWindow();
    return railWindow;
  }

  function send(window: BrowserWindow | null, channel: string, payload: unknown): void {
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(channel, payload);
  }

  function pushSnapshot(current: RailSnapshot): void {
    const window = ensureRailWindow();
    // Presentation state is owned by the main process, independently of business
    // data. A renderer reload may lose its DOM state while the native window stays
    // expanded, so every snapshot also restores the authoritative state.
    send(window, IPC.railApply, { ...current, expanded, petSize });
    // 高度无条件跟行数走，不看当前是否可见：隐藏期间来了新内容、随后重新显示时，
    // 若高度只在可见时才更新，老师会看到被裁掉下半截的列表。
    if (!window.isDestroyed() && (isBoard || expanded)) {
      if (boundsAnimationTimer !== null) animateRailBounds(window, railHeightFor(current.rows.length, isBoard), reducedMotionPreference);
      else window.setBounds({ height: railHeightFor(current.rows.length, isBoard) });
    }
  }

  function pushHealth(): void {
    send(ensureRailWindow(), IPC.railHealth, health);
  }

  function syncExpandedState(): void {
    if (railWindow === null || railWindow.isDestroyed()) return;
    // There may not be a business snapshot yet. Still restore the page state on its
    // startup sync so a reload cannot collapse the page while keeping a wide window.
    send(railWindow, IPC.railApply, { type: "state", expanded, petSize });
  }

  function animateRailBounds(window: BrowserWindow, height: number, reducedMotion: boolean): void {
    const from = window.getBounds();
    const targetWidth = expanded ? RAIL_WIDTH : petSize;
    const right = from.x + from.width;
    const to = { x: right - targetWidth, y: from.y, width: targetWidth, height };

    if (!reducedMotion && process.platform !== "darwin" && boundsSpring !== null
      && boundsSpring.targetWidth === targetWidth && boundsSpring.targetHeight === height) return;
    if (boundsSpring === null && from.width === targetWidth && from.height === height) return;

    if (boundsAnimationTimer !== null) clearTimeout(boundsAnimationTimer);
    boundsAnimationTimer = null;
    const generation = ++boundsAnimationGeneration;
    if (reducedMotion) {
      boundsSpring = null;
      window.setBounds(to);
      rememberPosition(window);
      return;
    }
    if (process.platform === "darwin") {
      boundsSpring = null;
      window.once("resized", () => {
        if (generation === boundsAnimationGeneration) rememberPosition(window);
      });
      window.setBounds(to, true);
      return;
    }

    // Electron's native animate option is macOS-only. Windows and Linux use a native
    // bounds spring that can be retargeted with the current presentation and velocity.
    const now = performance.now();
    if (boundsSpring === null) {
      boundsSpring = {
        width: { position: from.width, velocity: 0 },
        height: { position: from.height, velocity: 0 },
        targetWidth,
        targetHeight: height,
        right,
        y: from.y,
        lastStepAt: now,
      };
    } else {
      const elapsed = Math.max(0, (now - boundsSpring.lastStepAt) / 1000);
      boundsSpring.width = advanceRailSpring(boundsSpring.width, boundsSpring.targetWidth, elapsed);
      boundsSpring.height = advanceRailSpring(boundsSpring.height, boundsSpring.targetHeight, elapsed);
      boundsSpring.targetWidth = targetWidth;
      boundsSpring.targetHeight = height;
      boundsSpring.right = right;
      boundsSpring.y = from.y;
      boundsSpring.lastStepAt = now;
    }

    const frame = (): void => {
      boundsAnimationTimer = null;
      if (disposed || window.isDestroyed() || generation !== boundsAnimationGeneration || boundsSpring === null) {
        boundsSpring = null;
        return;
      }
      const activeSpring = boundsSpring;
      const frameAt = performance.now();
      const elapsed = Math.max(0, (frameAt - activeSpring.lastStepAt) / 1000);
      activeSpring.width = advanceRailSpring(activeSpring.width, activeSpring.targetWidth, elapsed);
      activeSpring.height = advanceRailSpring(activeSpring.height, activeSpring.targetHeight, elapsed);
      activeSpring.lastStepAt = frameAt;

      const settled = isRailSpringSettled(activeSpring.width, activeSpring.targetWidth)
        && isRailSpringSettled(activeSpring.height, activeSpring.targetHeight);
      if (settled) {
        activeSpring.width = { position: activeSpring.targetWidth, velocity: 0 };
        activeSpring.height = { position: activeSpring.targetHeight, velocity: 0 };
      }
      const width = Math.round(activeSpring.width.position);
      const frameHeight = Math.round(activeSpring.height.position);
      const nextBounds = { x: activeSpring.right - width, y: activeSpring.y, width, height: frameHeight };
      const current = window.getBounds();
      if (current.x !== nextBounds.x || current.y !== nextBounds.y
        || current.width !== nextBounds.width || current.height !== nextBounds.height) {
        window.setBounds(nextBounds);
      }

      if (settled) {
        boundsAnimationTimer = null;
        boundsSpring = null;
        rememberPosition(window);
        return;
      }
      boundsAnimationTimer = setTimeout(frame, 16);
    };
    frame();
  }

  function toggleExpanded(reducedMotion: boolean): void {
    if (isBoard || railWindow === null || railWindow.isDestroyed()) return;
    expanded = !expanded;
    reducedMotionPreference = reducedMotion;
    animateRailBounds(railWindow, expanded ? railHeightFor(snapshot?.rows.length ?? 0) : petSize, reducedMotion);
  }

  function createPopupWindow(): BrowserWindow {
    const { workArea } = screen.getPrimaryDisplay();
    const window = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      x: Math.max(workArea.x, workArea.x + workArea.width - POPUP_WIDTH - DEFAULT_MARGIN_RIGHT),
      y: workArea.y + DEFAULT_MARGIN_TOP,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      transparent: true,
      backgroundColor: "#00000000",
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload,
      },
    });
    applyTopLevel(window, true);
    window.on("closed", () => {
      if (popupWindow === window) popupWindow = null;
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(popupPageHtml())}`);
    return window;
  }

  function currentPopup(): RailAttentionPayload | null {
    return queue[0] ?? null;
  }

  function syncPopup(): void {
    if (disposed || popupSuppressed) return;
    const next = currentPopup();
    if (next === null) return;
    const window = popupWindow !== null && !popupWindow.isDestroyed() ? popupWindow : createPopupWindow();
    popupWindow = window;
    openPopupId = next.id;
    openPopupAt = Date.now();
    if (window.isDestroyed()) return;
    send(window, IPC.uiSound, soundEnabled);
    send(window, IPC.petPalette, petPalette);
    send(window, IPC.railPopup, next);
    if (!window.isVisible()) window.showInactive();
  }

  function closePopupWindow(): void {
    const window = popupWindow;
    popupWindow = null;
    openPopupId = null;
    if (window !== null && !window.isDestroyed()) window.destroy();
  }

  function dismissPopup(): void {
    queue = queue.slice(1);
    if (currentPopup() === null) {
      closePopupWindow();
      return;
    }
    syncPopup();
  }

  return {
    surface,
    setPetPalette(palette: string): void {
      if (disposed || !isPetPalette(palette)) return;
      petPalette = palette;
      send(railWindow, IPC.petPalette, petPalette);
      send(popupWindow, IPC.petPalette, petPalette);
    },
    setSoundEnabled(enabled: boolean): void {
      if (disposed) return;
      soundEnabled = enabled === true;
      send(railWindow, IPC.uiSound, soundEnabled);
      send(popupWindow, IPC.uiSound, soundEnabled);
    },
    apply(value: unknown): boolean {
      if (disposed) return false;
      const normalized = normalizeRailSnapshot(value, surface);
      if (normalized === null) return false;
      snapshot = normalized;
      pushSnapshot(normalized);
      return true;
    },
    syncHealth(value: unknown): boolean {
      if (disposed) return false;
      const next = normalizeRailSyncHealth(value);
      if (next === null) return false;
      const changed = next.status !== health.status
        || (next.status === "stale" && next.lastSuccessAt !== health.lastSuccessAt);
      health = next;
      if (changed) pushHealth();
      return true;
    },
    attention(value: unknown): boolean {
      if (disposed) return false;
      const normalized = normalizeRailAttention(value);
      if (normalized === null) return false;
      if (openPopupId === normalized.id && Date.now() - openPopupAt < POPUP_DEDUPE_MS) return false;
      if (queue.some((item) => item.id === normalized.id)) return false;
      queue = [...queue, normalized];
      if (currentPopup()?.id === normalized.id) syncPopup();
      return true;
    },
    dispatch(action: unknown): boolean {
      if (disposed) return false;
      const normalized = normalizeRailAction(action);
      if (normalized === null) return false;
      // 页面首帧主动拉取：保留加载时序安全，并恢复没有快照时也必须一致的
      // 主进程展开态。renderer 只能请求 sync，不能把自己的 expanded 值写回 main。
      if (normalized.type === "sync") {
        send(railWindow, IPC.petPalette, petPalette);
        send(popupWindow, IPC.petPalette, petPalette);
        send(railWindow, IPC.uiSound, soundEnabled);
        send(popupWindow, IPC.uiSound, soundEnabled);
        if (snapshot !== null) pushSnapshot(snapshot);
        else syncExpandedState();
        pushHealth();
        syncPopup();
        return true;
      }
      if (normalized.type === "resize") {
        const window = railWindow;
        if (isBoard || expanded || window === null || window.isDestroyed()) return false;
        petSize = normalized.size;
        const [x, y] = window.getPosition();
        const position = clampPositionToDisplays({ x, y }, petSize, petSize);
        window.setBounds({ ...position, width: petSize, height: petSize });
        store.savePetSize?.(surface, petSize);
        rememberPosition(window);
        syncExpandedState();
        return true;
      }
      if (normalized.type === "drag-end") { petDrag = null; return true; }
      if (normalized.type === "drag-start" || normalized.type === "drag-move") {
        const window = railWindow;
        if (isBoard || expanded || window === null || window.isDestroyed()) return false;
        if (normalized.type === "drag-start") {
          const [x, y] = window.getPosition();
          petDrag = { pointerX: normalized.x, pointerY: normalized.y, x, y };
        } else if (petDrag) {
          const position = clampPositionToDisplays({ x: Math.round(petDrag.x + normalized.x - petDrag.pointerX), y: Math.round(petDrag.y + normalized.y - petDrag.pointerY) }, petSize, petSize);
          window.setPosition(position.x, position.y);
          rememberPosition(window);
        }
        return true;
      }
      if (normalized.type === "toggle") {
        toggleExpanded(normalized.reducedMotion ?? false);
        return true;
      }
      if (normalized.type === "acknowledge") {
        const current = currentPopup();
        if (current?.id !== normalized.id || !current.receiptMessageId
          || (normalized.receiptMessageId !== undefined && normalized.receiptMessageId !== current.receiptMessageId)) return false;
        options.onAction({ type: "acknowledge", id: current.id, receiptMessageId: current.receiptMessageId });
        return true;
      }
      if (normalized.type === "dismiss") {
        if (currentPopup()?.id !== normalized.id) return false;
        dismissPopup();
        return true;
      }
      if (normalized.type === "hide") {
        rememberVisibility(false);
        if (railWindow !== null && !railWindow.isDestroyed()) railWindow.hide();
        closePopupWindow();
        options.onAction(normalized);
        return true;
      }
      options.onAction(normalized);
      return true;
    },
    feedback(id: string, ok: boolean, message = ""): boolean {
      if (disposed || typeof id !== "string" || openPopupId !== id || currentPopup()?.id !== id) return false;
      const window = popupWindow;
      if (window === null || window.isDestroyed()) return false;
      send(window, IPC.railReceiptFeedback, { id, ok, message: clampText(message, 240) });
      return true;
    },
    dismissReceipted(messageIds: readonly string[]): number {
      if (disposed || !Array.isArray(messageIds) || messageIds.length === 0 || queue.length === 0) return 0;
      const confirmed = new Set(messageIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 120));
      const previousId = currentPopup()?.id;
      const count = queue.length;
      queue = queue.filter((item) => !item.receiptMessageId || !confirmed.has(item.receiptMessageId));
      if (previousId !== currentPopup()?.id) {
        if (currentPopup() === null) closePopupWindow();
        else syncPopup();
      }
      return count - queue.length;
    },
    setVisible(visible: boolean): void {
      if (disposed) return;
      if (!visible) {
        rememberVisibility(false);
        if (railWindow !== null && !railWindow.isDestroyed()) railWindow.hide();
        closePopupWindow();
        return;
      }
      rememberVisibility(true);
      const window = ensureRailWindow();
      if (snapshot !== null) pushSnapshot(snapshot);
      pushHealth();
      if (!window.isDestroyed()) window.showInactive();
      syncPopup();
    },
    isVisible(): boolean {
      return railWindow !== null && !railWindow.isDestroyed() && railWindow.isVisible();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (boundsAnimationTimer !== null) clearTimeout(boundsAnimationTimer);
      boundsAnimationTimer = null;
      boundsSpring = null;
      queue = [];
      closePopupWindow();
      const window = railWindow;
      railWindow = null;
      if (window !== null && !window.isDestroyed()) window.destroy();
    },
  };
}

export const RAIL_WINDOW = Object.freeze({
  width: RAIL_WIDTH,
  petSize: PET_SIZE,
  minHeight: RAIL_MIN_HEIGHT,
  maxHeight: RAIL_MAX_HEIGHT,
  popupWidth: POPUP_WIDTH,
  popupHeight: POPUP_HEIGHT,
});
