import { contextBridge, ipcRenderer } from "electron";

// 沙箱化 Electron preload 不能 require 本地 CommonJS 兄弟模块，所以通道名与
// 动作形状在这里必须是字面量。主进程侧同一份契约在 dsh/protocol.ts 的 IPC 常量
// 与 normalizeRailAction() 里；改这里就要改那里，两侧都留了同样的注释。
const IPC_RAIL_APPLY = "mochi:rail:apply";
const IPC_RAIL_HEALTH = "mochi:rail:health";
const IPC_RAIL_POPUP = "mochi:rail:popup";
const IPC_RAIL_ACTION = "mochi:rail:action";
const IPC_RAIL_RECEIPT_FEEDBACK = "mochi:rail:receipt-feedback";

type RailActionInput = { type: string; id?: string; reducedMotion?: boolean; x?: number; y?: number; size?: number };

/** 页面只能发白名单动作，且 id 必须是字符串——preload 是第一道形状闸。 */
function isRailAction(value: unknown): value is RailActionInput {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as RailActionInput).type;
  if (type === "hide" || type === "sync" || type === "drag-end") return true;
  if (type === "drag-start" || type === "drag-move") {
    const point = value as RailActionInput;
    return Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x!) < 100000 && Math.abs(point.y!) < 100000;
  }
  if (type === "resize") {
    const size = (value as RailActionInput).size;
    return typeof size === "number" && Number.isFinite(size);
  }
  if (type === "toggle") {
    const reducedMotion = (value as RailActionInput).reducedMotion;
    return reducedMotion === undefined || typeof reducedMotion === "boolean";
  }
  if (type === "open") {
    const id = (value as RailActionInput).id;
    return id === undefined || typeof id === "string";
  }
  if (type === "dismiss") return typeof (value as RailActionInput).id === "string";
  if (type !== "acknowledge") return false;
  return typeof (value as RailActionInput).id === "string";
}

function subscribe(channel: string, callback: unknown): boolean {
  if (typeof callback !== "function") return false;
  ipcRenderer.on(channel, (_event, payload: unknown) => {
    // 监听器里的异常不能冒泡回主进程的 send 调用栈。
    try {
      (callback as (value: unknown) => void)(payload);
    } catch {
      // 页面渲染失败只影响它自己，主进程继续按原状态工作。
    }
  });
  return true;
}

contextBridge.exposeInMainWorld("mochiRail", Object.freeze({
  /** 页面 → 主进程：用户动作。主进程会再用 normalizeRailAction 校验一次。 */
  act(action: unknown): void {
    if (!isRailAction(action)) return;
    ipcRenderer.send(IPC_RAIL_ACTION, action);
  },
  /** 主进程 → 页面：常驻条快照。 */
  onSnapshot(callback: unknown): boolean {
    return subscribe(IPC_RAIL_APPLY, callback);
  },
  onPetPalette(callback: unknown): boolean {
    return subscribe("mochi:pet-palette", callback);
  },
  onSoundPreference(callback: unknown): boolean {
    return subscribe("mochi:ui-sound", callback);
  },
  onHealth(callback: unknown): boolean {
    return subscribe(IPC_RAIL_HEALTH, callback);
  },
  /** 主进程 → 页面：弹窗内容。 */
  onPopup(callback: unknown): boolean {
    return subscribe(IPC_RAIL_POPUP, callback);
  },
  /** 主进程 → 页面：异步收件确认结果。 */
  onReceiptFeedback(callback: unknown): boolean {
    return subscribe(IPC_RAIL_RECEIPT_FEEDBACK, callback);
  },
}));
