import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// Sandboxed Electron preloads may require Electron built-ins, but cannot load
// arbitrary local CommonJS siblings. Keep these fixed literals in the preload;
// main owns the same closed IPC contract in dsh/protocol.ts.
const LAN_ATTENTION_IPC = "mochi:lan:attention";
const RAIL_LAN_STATE_IPC = "mochi:rail:lan-state";
const RAIL_SYNC_HEALTH_IPC = "mochi:rail:sync-health";
const RAIL_FOCUS_MESSAGE_IPC = "mochi:rail:focus-message";
const RAIL_TAKE_FOCUS_MESSAGE_IPC = "mochi:rail:take-focus-message";
const RAIL_MARK_SEEN_REQUEST_IPC = "mochi:rail:mark-seen-request";
const RAIL_MARK_SEEN_RESULT_IPC = "mochi:rail:mark-seen-result";
type LanAttentionKind = "incoming-message" | "pairing-request";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RAW_MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;

type MarkSeenReply = { status?: unknown; messageId?: unknown; message?: unknown };

async function acknowledgeLanMessage(requestId: string, messageId: string): Promise<void> {
  let ok = false;
  let message = "无法确认已读";
  try {
    const isolatedFetch = (globalThis as typeof globalThis & {
      fetch?: (input: string, init: Record<string, unknown>) => Promise<{ ok: boolean; json(): Promise<MarkSeenReply> }>;
    }).fetch;
    if (!isolatedFetch) throw new Error("fetch unavailable");
    const response = await isolatedFetch("/api/mochi-lan/message-seen", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId }),
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) throw new Error("请求失败");
    const body = await response.json();
    if (body.status !== "ACKNOWLEDGED" || body.messageId !== messageId) throw new Error("回执不匹配");
    ok = true;
    message = "已确认";
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") message = "请求超时";
  }
  ipcRenderer.send(RAIL_MARK_SEEN_RESULT_IPC, { requestId, ok, message });
}

function isLanAttentionKind(value: unknown): value is LanAttentionKind {
  return value === "incoming-message" || value === "pairing-request";
}

contextBridge.exposeInMainWorld("mochiLanDesktop", Object.freeze({
  attention(kind: unknown): Promise<boolean> {
    if (!isLanAttentionKind(kind)) return Promise.resolve(false);
    return ipcRenderer.invoke(LAN_ATTENTION_IPC, kind).then((accepted) => accepted === true, () => false);
  },
}));

contextBridge.exposeInMainWorld("mochiClassroomDesktop", Object.freeze({
  getStartup: () => ipcRenderer.invoke("mochi:classroom:startup-get"),
  setStartup(enabled: unknown) {
    if (typeof enabled !== "boolean") return Promise.reject(new Error("无效的启动设置"));
    return ipcRenderer.invoke("mochi:classroom:startup-set", enabled);
  },
  wake: () => ipcRenderer.invoke("mochi:classroom:wake"),
  listeningReady: () => ipcRenderer.invoke("mochi:classroom:listening-ready"),
  letterReady: (letter: unknown) => ipcRenderer.invoke("mochi:classroom:letter-ready", letter),
  reminderReady: (paper: unknown) => ipcRenderer.invoke('mochi:classroom:reminder-ready', paper),
  onOpenReminder: (callback: () => void) => {
    let active = true;
    const pull = () => { void ipcRenderer.invoke('mochi:classroom:take-reminder').then(pending => {
      if (active && pending === true) callback();
    }).catch(() => {}); };
    ipcRenderer.on('mochi:classroom:open-reminder', pull);
    pull();
    return () => { active = false; ipcRenderer.removeListener('mochi:classroom:open-reminder', pull); };
  },
  onOpenLetter(listener: unknown) {
    if (typeof listener !== 'function') return () => {};
    let active = true;
    const pull = () => { void ipcRenderer.invoke('mochi:classroom:take-letter').then(id => {
      if (active && typeof id === 'string' && UUID_PATTERN.test(id)) listener(id);
    }, () => {}); };
    ipcRenderer.on('mochi:classroom:open-letter', pull);
    pull();
    return () => { active = false; ipcRenderer.removeListener('mochi:classroom:open-letter', pull); };
  },
  onAudioActivity(listener: unknown) {
    if (typeof listener !== 'function') return () => {};
    let active = true, revision = -1;
    const accept = (value: unknown) => {
      if (!active || !value || typeof value !== 'object') return;
      const next = value as { busy?: unknown; revision?: unknown };
      if (typeof next.busy !== 'boolean' || typeof next.revision !== 'number'
        || !Number.isSafeInteger(next.revision) || next.revision <= revision) return;
      revision = next.revision;
      listener({ reason: 'tts', busy: next.busy });
    };
    const forward = (_event: IpcRendererEvent, value: unknown) => accept(value);
    ipcRenderer.on('mochi:audio-busy', forward);
    void ipcRenderer.invoke('mochi:audio-status').then(accept, () => {});
    return () => { active = false; ipcRenderer.removeListener('mochi:audio-busy', forward); };
  },
}));

contextBridge.exposeInMainWorld('mochiVoiceChatDesktop', Object.freeze({
  getState: () => ipcRenderer.invoke('mochi:voice-chat:state'),
  setEnabled: (enabled: unknown) => ipcRenderer.invoke('mochi:voice-chat:set-enabled', enabled),
  speak: (request: unknown) => ipcRenderer.invoke('mochi:voice-chat:speak', request),
  stop: (request: unknown) => ipcRenderer.invoke('mochi:voice-chat:stop', request),
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
  setPetPalette(palette: unknown): boolean {
    if (typeof palette !== "string" || palette.length > 32) return false;
    ipcRenderer.send("mochi:pet-palette", palette);
    return true;
  },
  setSoundEnabled(enabled: unknown): boolean {
    if (typeof enabled !== "boolean") return false;
    ipcRenderer.send("mochi:ui-sound", enabled);
    return true;
  },
  setAppearance(preference: unknown): boolean {
    if (preference !== "light" && preference !== "dark" && preference !== "system") return false;
    ipcRenderer.send("mochi:appearance", preference);
    return true;
  },
  pushLanState(state: unknown): boolean {
    if (state === null || typeof state !== "object") return false;
    ipcRenderer.send(RAIL_LAN_STATE_IPC, state);
    return true;
  },
  reportSyncHealth(ok: unknown): boolean {
    if (typeof ok !== "boolean") return false;
    ipcRenderer.send(RAIL_SYNC_HEALTH_IPC, ok);
    return true;
  },
  onFocusMessage(listener: unknown): () => void {
    if (typeof listener !== "function") return () => {};
    let active = true;
    const pull = () => {
      void ipcRenderer.invoke(RAIL_TAKE_FOCUS_MESSAGE_IPC).then((value: unknown) => {
        if (active && typeof value === "string" && value.length > 0 && value.length <= 160) listener(value);
      }, () => {});
    };
    const forward = () => pull();
    ipcRenderer.on(RAIL_FOCUS_MESSAGE_IPC, forward);
    pull();
    return () => {
      active = false;
      ipcRenderer.removeListener(RAIL_FOCUS_MESSAGE_IPC, forward);
    };
  },
}));

// This listener exists only in the isolated preload world. The page cannot
// subscribe to requests or manufacture the main-process result IPC payload.
ipcRenderer.on(RAIL_MARK_SEEN_REQUEST_IPC, (_event: IpcRendererEvent, value: unknown) => {
  if (value === null || typeof value !== "object") return;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !UUID_PATTERN.test(request.requestId)
    || typeof request.messageId !== "string" || !RAW_MESSAGE_ID_PATTERN.test(request.messageId)) return;
  void acknowledgeLanMessage(request.requestId, request.messageId);
});
