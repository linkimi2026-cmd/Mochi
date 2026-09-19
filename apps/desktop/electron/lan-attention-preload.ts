import { contextBridge, ipcRenderer } from "electron";

// Sandboxed Electron preloads may require Electron built-ins, but cannot load
// arbitrary local CommonJS siblings. Keep these fixed literals in the preload;
// main owns the same closed IPC contract in dsh/protocol.ts.
const LAN_ATTENTION_IPC = "mochi:lan:attention";
const RAIL_LAN_STATE_IPC = "mochi:rail:lan-state";
type LanAttentionKind = "incoming-message" | "pairing-request";

function isLanAttentionKind(value: unknown): value is LanAttentionKind {
  return value === "incoming-message" || value === "pairing-request";
}

contextBridge.exposeInMainWorld("mochiLanDesktop", Object.freeze({
  attention(kind: unknown): Promise<boolean> {
    if (!isLanAttentionKind(kind)) return Promise.resolve(false);
    return ipcRenderer.invoke(LAN_ATTENTION_IPC, kind).then((accepted) => accepted === true, () => false);
  },
}));

/**
 * 常驻条数据桥。
 *
 * 页面只能推「原始 LAN 快照」——就是 /api/mochi-lan/state 的响应体，它不做任何
 * 业务判断。哪些行要显示、哪些要弹窗由主进程的 dsh/rail-model.ts 决定；页面若也能
 * 决定，就会出现两处判断而只在一处被修好的情况。
 *
 * 这里只做「必须是普通对象」这一层最粗的闸，真正的裁剪在 rail-model 与 rail 里，
 * 因为那两处都有测试。用 send 而不是 invoke：推送是单向通知，页面不需要等结果，
 * 也不该因为主进程还没建好常驻条而被阻塞。
 */
contextBridge.exposeInMainWorld("mochiRailDesktop", Object.freeze({
  pushLanState(state: unknown): boolean {
    if (state === null || typeof state !== "object") return false;
    ipcRenderer.send(RAIL_LAN_STATE_IPC, state);
    return true;
  },
}));
