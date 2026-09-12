/**
 * Mochi · Electron ↔ dsh 通信桥协议层（Batch 2 前半段）
 *
 * 职责：定义 renderer ↔ main 之间所有 IPC 消息的形状。
 * 命名空间统一 `mochi:*`（见 {@link IPC}）。
 * 本文件是纯类型 + 常量，无任何运行时依赖，main 与 preload 都能安全 import。
 *
 * 通道总览：
 *   renderer → main
 *     mochi:prompt:send      { text }                      投一个用户 prompt
 *     mochi:prompt:cancel    { promptId }                  取消（SDK 通道暂无 mid-turn cancel，占位）
 *     mochi:approval:respond { requestId, decision }       用户对确认卡的答复
 *     mochi:lan:attention    LanAttentionKind               已认证 LAN 页面请求本机提醒
 *   main → renderer
 *     mochi:event:stream     DshStreamEvent                 dsh 事件流（状态/思考/工具/文本/最终回答）
 *     mochi:approval:request ApprovalRequest               需要用户确认的工具（Batch 2 后半段由 answerer IPC 化触发）
 */

/** ExpressiveOrb 的情绪枚举（与 08 §4.2 一致，给事件流做 mood 映射参考）。 */
export type OrbMood =
  | 'idle'
  | 'thinking'
  | 'listening'
  | 'speaking'
  | 'success'
  | 'alert';

/* ───────────────────────── renderer → main ───────────────────────── */

/** 用户投一个 prompt。promptId 可选，主进程会补一个。 */
export interface PromptSend {
  text: string;
  promptId?: string;
}

/** 取消某个 prompt（按 promptId）。 */
export interface PromptCancel {
  promptId: string;
}

/* ───────────────────────── main → renderer：事件流 ───────────────────────── */

/** dsh 整体 agent 状态切换（running / idle）。 */
export interface StreamStatus {
  kind: 'status';
  status: 'idle' | 'running';
}

/** 模型推理 / 工具执行中（映射到 Orb `thinking`）。 */
export interface StreamThinking {
  kind: 'thinking';
  text?: string;
}

/** 工具被调用（映射到 Orb 保持 thinking，UI 可展示工具名）。 */
export interface StreamTool {
  kind: 'tool';
  toolName: string;
  args?: unknown;
}

/** 流式文本片段（映射到 Orb `speaking`）。 */
export interface StreamText {
  kind: 'text';
  text: string;
}

/** 最终回答（一轮结束）。 */
export interface StreamFinal {
  kind: 'final';
  text: string;
}

/** 出错（映射到 Orb `alert`）。 */
export interface StreamError {
  kind: 'error';
  message: string;
}

/** 事件流 discriminated union。 */
export type DshStreamEvent =
  | StreamStatus
  | StreamThinking
  | StreamTool
  | StreamText
  | StreamFinal
  | StreamError;

/* ───────────────────────── main → renderer：审批请求 ───────────────────────── */

/**
 * 需要用户确认的工具。Batch 2 后半段由 mochi-approval answerer 经 IPC 推过来；
 * 前半段 answerer 自动放行，本结构仅作接口占位。
 * 字段遵循 11 §5.4 / 08 §5.4 的「确认卡必须展示准备做什么」。
 */
export interface ApprovalRequest {
  requestId: string;
  /** 触发审批的工具名（answerer 只能拿到工具名 + reason，无参数，见 07 Q5）。 */
  toolName: string;
  /** 工具方给出的可读理由。 */
  reason?: string;
  /** 工具调用的 call id（若有）。 */
  callId?: string;
  /** 给确认卡渲染用的结构化字段。 */
  actionLabel?: string;
  target?: string;
  reversible?: boolean;
}

/* ───────────────────────── renderer → main：审批答复 ───────────────────────── */

export interface ApprovalResponse {
  requestId: string;
  decision: 'allow' | 'reject';
}

/** The renderer can request attention only for these fixed, content-free LAN events. */
export type LanAttentionKind = 'incoming-message' | 'pairing-request';

/* ───────────────────────── IPC 通道名（命名空间 mochi:*） ───────────────────────── */

export const IPC = {
  /** renderer → main：ping 自检测。 */
  ping: 'mochi:ping',
  /** renderer → main：投 prompt。 */
  promptSend: 'mochi:prompt:send',
  /** renderer → main：取消 prompt。 */
  promptCancel: 'mochi:prompt:cancel',
  /** main → renderer：dsh 事件流。 */
  eventStream: 'mochi:event:stream',
  /** main → renderer：审批请求（确认卡）。 */
  approvalRequest: 'mochi:approval:request',
  /** renderer → main：审批答复。 */
  approvalRespond: 'mochi:approval:respond',
  /** renderer → main：已认证 LAN 页面请求固定本机提醒。 */
  lanAttention: 'mochi:lan:attention',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/* ───────────────────────── preload 暴露给 renderer 的桥类型 ───────────────────────── */

/**
 * renderer 经 contextBridge 拿到的 `window.mochi` 形状。
 * 在 preload.ts 里实现，renderer 只用这个类型。
 */
export interface MochiBridge {
  ping(): Promise<{ ok: boolean; version: string; platform: string }>;
  /** 投一个 prompt，返回本次的 promptId。 */
  sendPrompt(text: string): Promise<{ promptId: string }>;
  /** 取消一个 prompt。 */
  cancelPrompt(promptId: string): Promise<void>;
  /** 用户对确认卡的答复。 */
  respondApproval(requestId: string, decision: 'allow' | 'reject'): Promise<void>;
  /** 订阅 dsh 事件流，返回取消订阅函数。 */
  onStream(cb: (event: DshStreamEvent) => void): () => void;
  /** 订阅审批请求（确认卡），返回取消订阅函数。 */
  onApprovalRequest(cb: (request: ApprovalRequest) => void): () => void;
}
