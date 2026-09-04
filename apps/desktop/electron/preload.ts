import { contextBridge, ipcRenderer } from "electron";

/**
 * 预加载脚本：renderer 与主进程之间唯一的桥。
 *
 * 只暴露最小必要的白名单方法，不开 nodeIntegration。
 * 后续 dsh 事件流、审批确认卡都从这里过（Batch 2）。
 */

export type MochiBridge = {
  ping: () => Promise<{ ok: boolean; version: string; platform: string }>;
};

const bridge: MochiBridge = {
  ping: () => ipcRenderer.invoke("mochi:ping"),
};

contextBridge.exposeInMainWorld("mochi", bridge);
