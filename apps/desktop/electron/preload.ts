import { contextBridge, ipcRenderer } from "electron";
import type { ApprovalRequest, DshStreamEvent, MochiBridge } from "./dsh";

/**
 * 预加载脚本：renderer 与主进程之间唯一的桥。
 *
 * 只暴露最小必要的白名单方法（类型见 MochiBridge），不开 nodeIntegration。
 * Batch 2（前半段）：在 Batch 0 的 ping 基础上，加上
 *   sendPrompt / cancelPrompt / onStream / onApprovalRequest / respondApproval，
 * 全部走 mochi:* 命名空间（见 dsh/protocol.ts 的 IPC 常量）。
 */

const bridge: MochiBridge = {
  ping: () => ipcRenderer.invoke("mochi:ping"),

  sendPrompt: (text: string) =>
    ipcRenderer.invoke("mochi:prompt:send", { text }) as Promise<{ promptId: string }>,

  cancelPrompt: (promptId: string) =>
    ipcRenderer.invoke("mochi:prompt:cancel", { promptId }) as Promise<void>,

  respondApproval: (requestId: string, decision: "allow" | "reject") =>
    ipcRenderer.invoke("mochi:approval:respond", { requestId, decision }) as Promise<void>,

  onStream: (cb: (event: DshStreamEvent) => void) => {
    const listener = (_event: unknown, event: DshStreamEvent) => cb(event);
    ipcRenderer.on("mochi:event:stream", listener);
    return () => ipcRenderer.removeListener("mochi:event:stream", listener);
  },

  onApprovalRequest: (cb: (request: ApprovalRequest) => void) => {
    const listener = (_event: unknown, request: ApprovalRequest) => cb(request);
    ipcRenderer.on("mochi:approval:request", listener);
    return () => ipcRenderer.removeListener("mochi:approval:request", listener);
  },
};

contextBridge.exposeInMainWorld("mochi", bridge);
