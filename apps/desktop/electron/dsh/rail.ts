import { BrowserWindow, screen } from "electron";
import { IPC, type RailAction, type RailAttentionPayload, type RailRow, type RailSnapshot, type RailSurface, type RailTone } from "./protocol";
import { popupPageHtml, railPageHtml } from "./rail-pages";

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
const RAIL_MIN_HEIGHT = 88;
const RAIL_MAX_HEIGHT = 472;

/** 喊人弹窗尺寸。比常驻条大，因为它是瞬态强提醒。 */
const POPUP_WIDTH = 448;
const POPUP_HEIGHT = 248;

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
  /** 请求弹一次喊人弹窗。同 id 冷却期内/已在队列中时忽略。 */
  attention(payload: unknown): boolean;
  /** 常驻条窗口里的动作（含内部消化的 sync/acknowledge）。 */
  dispatch(action: unknown): boolean;
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
  return {
    id,
    seq: safeInteger(value.seq, 1, 9999) || index + 1,
    name: clampText(value.name, LIMITS.name),
    meta: clampText(value.meta, LIMITS.meta),
    note: clampText(value.note, LIMITS.note),
    badge: clampText(value.badge, LIMITS.badge),
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
  return {
    id,
    kind,
    title: clampText(value.title, LIMITS.heading),
    subject: clampText(value.subject, LIMITS.name),
    detail: clampText(value.detail, LIMITS.note),
    at: clampText(value.at, LIMITS.at),
  };
}

export function normalizeRailAction(value: unknown): RailAction | null {
  if (!plain(value)) return null;
  const type = value.type;
  if (type === "hide" || type === "sync") return { type };
  if (type === "open" || type === "acknowledge") {
    const id = clampText(value.id, LIMITS.id);
    if (id === "") return null;
    return { type, id };
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
  const fits = screen.getAllDisplays().some((display) => {
    const { x, y, width: displayWidth, height: displayHeight } = display.workArea;
    return position.x + width > x && position.x < x + displayWidth
      && position.y + height > y && position.y < y + displayHeight;
  });
  if (fits) return position;

  const { workArea } = screen.getPrimaryDisplay();
  const maximumX = Math.max(workArea.x, workArea.x + workArea.width - width);
  const maximumY = Math.max(workArea.y, workArea.y + workArea.height - height);
  return {
    x: Math.min(Math.max(position.x, workArea.x), maximumX),
    y: Math.min(Math.max(position.y, workArea.y), maximumY),
  };
}

function railHeightFor(rowCount: number): number {
  return Math.min(RAIL_MAX_HEIGHT, Math.max(RAIL_MIN_HEIGHT, 64 + rowCount * 52));
}

export function createMochiRail(options: MochiRailOptions): MochiRailHandle {
  const { surface, preload, store } = options;
  const isBoard = surface === "classroom-board";
  let railWindow: BrowserWindow | null = null;
  let popupWindow: BrowserWindow | null = null;
  let snapshot: RailSnapshot | null = null;
  let queue: RailAttentionPayload[] = [];
  let openPopupId: string | null = null;
  let openPopupAt = 0;
  let disposed = false;

  function rememberPosition(window: BrowserWindow): void {
    if (disposed || window.isDestroyed()) return;
    const [x, y] = window.getPosition();
    store.save(surface, { x, y });
  }

  function createRailWindow(): BrowserWindow {
    const remembered = store.load(surface) ?? defaultRailPosition(surface);
    const position = clampPositionToDisplays(remembered, RAIL_WIDTH, RAIL_MAX_HEIGHT);
    const window = new BrowserWindow({
      ...position,
      width: RAIL_WIDTH,
      height: railHeightFor(snapshot?.rows.length ?? 0),
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      frame: false,
      // 常驻条不是「又一个窗口」：不进任务栏。
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      // 深绿画布与 calm-tokens 的 --sage-800 一致，避免拖动/重建时白闪。
      backgroundColor: "#2a3931",
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
      // 常驻条只能被显式 dispose，或从托盘/快捷键隐藏——不能点一下就没了。
      if (disposed) return;
      event.preventDefault();
      window.hide();
    });
    window.on("moved", () => rememberPosition(window));
    window.on("closed", () => {
      if (railWindow === window) railWindow = null;
      if (!disposed) options.onClosed?.();
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(railPageHtml(surface))}`);
    window.once("ready-to-show", () => {
      if (disposed || window.isDestroyed()) return;
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
    send(window, IPC.railApply, current);
    // 高度无条件跟行数走，不看当前是否可见：隐藏期间来了新内容、随后重新显示时，
    // 若高度只在可见时才更新，老师会看到被裁掉下半截的列表。
    if (!window.isDestroyed()) window.setBounds({ height: railHeightFor(current.rows.length) });
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
      hasShadow: true,
      backgroundColor: "#2a3931",
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
    if (disposed) return;
    const next = currentPopup();
    if (next === null) return;
    const window = popupWindow !== null && !popupWindow.isDestroyed() ? popupWindow : createPopupWindow();
    popupWindow = window;
    openPopupId = next.id;
    openPopupAt = Date.now();
    if (window.isDestroyed()) return;
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
    apply(value: unknown): boolean {
      if (disposed) return false;
      const normalized = normalizeRailSnapshot(value, surface);
      if (normalized === null) return false;
      snapshot = normalized;
      pushSnapshot(normalized);
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
      // sync 用页面自己的首帧来拉状态：页面可能在快照之后才加载完成，
      // 靠「main 主动推」会撞上加载时序，靠「页面主动要」就没有这个竞态。
      if (normalized.type === "sync") {
        if (snapshot !== null) pushSnapshot(snapshot);
        syncPopup();
        return true;
      }
      if (normalized.type === "acknowledge") {
        if (currentPopup()?.id === normalized.id) dismissPopup();
        options.onAction(normalized);
        return true;
      }
      if (normalized.type === "hide") {
        if (railWindow !== null && !railWindow.isDestroyed()) railWindow.hide();
        closePopupWindow();
        options.onAction(normalized);
        return true;
      }
      options.onAction(normalized);
      return true;
    },
    setVisible(visible: boolean): void {
      if (disposed) return;
      if (!visible) {
        if (railWindow !== null && !railWindow.isDestroyed()) railWindow.hide();
        closePopupWindow();
        return;
      }
      const window = ensureRailWindow();
      if (snapshot !== null) pushSnapshot(snapshot);
      if (!window.isDestroyed()) window.showInactive();
    },
    isVisible(): boolean {
      return railWindow !== null && !railWindow.isDestroyed() && railWindow.isVisible();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
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
  minHeight: RAIL_MIN_HEIGHT,
  maxHeight: RAIL_MAX_HEIGHT,
  popupWidth: POPUP_WIDTH,
  popupHeight: POPUP_HEIGHT,
});
