import { contextBridge, ipcRenderer } from "electron";

// Sandboxed Electron preloads may require Electron built-ins, but cannot load
// arbitrary local CommonJS siblings. Keep this fixed literal in the preload;
// main owns the same closed IPC contract in dsh/protocol.ts.
const LAN_ATTENTION_IPC = "mochi:lan:attention";
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
