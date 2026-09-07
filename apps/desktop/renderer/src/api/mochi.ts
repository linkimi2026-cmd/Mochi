import type { StreamEvent, ApprovalRequest } from "./types";

/**
 * Mochi 与 dsh 运行时的通信桥。
 *
 * 这是 Batch 1 的**最小占位实现**：所有方法都是 no-op，UI 已按接口对接完毕。
 * Agent B 在 Batch 2 会**直接覆盖**整个 `mochi` 对象（从 `window.mochi` 或
 * dsh SDK 真正接出 sendPrompt / onStream / onApprovalRequest 等），
 * 前端无需改动即可跑通。
 */
export interface MochiBridge {
  /** 把老师的输入发给 dsh，开始一轮 turn。 */
  sendPrompt(text: string): Promise<void>;
  /** 订阅 dsh 的流式事件；返回取消订阅函数。 */
  onStream(cb: (event: StreamEvent) => void): () => void;
  /** 订阅需要老师确认的工具请求；返回取消订阅函数。 */
  onApprovalRequest(cb: (req: ApprovalRequest) => void): () => void;
  /** 老师对确认请求做出决定。 */
  respondApproval(reqId: string, allowed: boolean): Promise<void>;
  /** 取消某一轮 prompt（如老师点停止）。 */
  cancelPrompt(promptId: string): Promise<void>;
}

export const mochi: MochiBridge = {
  sendPrompt: async () => console.warn("[mochi stub] sendPrompt 未接：等待 Agent B 接 dsh"),
  onStream: () => () => {},
  onApprovalRequest: () => () => {},
  respondApproval: async () => {},
  cancelPrompt: async () => {},
};
