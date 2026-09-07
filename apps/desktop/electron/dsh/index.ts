/**
 * Mochi · dsh 通信桥汇总（Batch 2 前半段）
 *
 * 导出：
 *   - protocol  全部 IPC 类型 + 通道名
 *   - harness   sidecar 生命周期 + JSON-RPC 客户端
 *   - attachIpcHandlers(ipcMain)  把 5 个通道注册进 Electron IPC
 *
 * 渲染进程只通过这些 IPC 通道与 dsh 说话（命名空间 mochi:*）。
 * 事件流（main → renderer）的转发在 main.ts 里订阅 onDshStream 后
 * 用 webContents.send(IPC.eventStream, event) 推送——本文件只负责
 * 注册 renderer → main 的请求处理。
 */

import { randomUUID } from 'node:crypto';
import type { IpcMain } from 'electron';
import { IPC, type ApprovalResponse, type PromptSend } from './protocol';
import { getSidecar } from './harness';

export * from './protocol';
export * from './harness';

/**
 * 把通信桥的 renderer → main 通道注册到 Electron IPC。
 * 必须在 app.whenReady() 之后调用（ipcMain 已就绪）。
 */
export function attachIpcHandlers(ipcMain: IpcMain): void {
  // 自检测（沿用 Batch 0）
  ipcMain.handle(IPC.ping, async () => {
    const { app } = await import('electron');
    return { ok: true, version: app.getVersion(), platform: process.platform };
  });

  // 投 prompt
  ipcMain.handle(IPC.promptSend, async (_event, payload: PromptSend) => {
    const sidecar = getSidecar();
    if (!sidecar) {
      throw new Error('dsh sidecar 未启动');
    }
    const promptId = payload.promptId ?? randomUUID();
    await sidecar.sendPrompt(payload.text);
    return { promptId };
  });

  // 取消 prompt（SDK 通道暂无 mid-turn cancel，见 07 Q1；此处占位）
  ipcMain.handle(IPC.promptCancel, async () => {
    const sidecar = getSidecar();
    if (!sidecar) return;
    await sidecar.cancelPrompt();
  });

  // 用户对确认卡的答复。
  // Batch 2 前半段：审批由进程内 mochi-approval answerer 自动放行，
  // 这条通道暂不触发；后半段 answerer IPC 化后，这里把决策回灌给 answerer。
  ipcMain.handle(IPC.approvalRespond, async (_event, payload: ApprovalResponse) => {
    console.log('[mochi] 收到审批答复', payload.requestId, payload.decision, '（前半段 answerer 自动放行，此答复暂未回灌）');
  });
}
