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
 *     mochi:rail:snapshot    RailSnapshot                    常驻条整份快照（教师/教室各自一块屏）
 *     mochi:rail:attention   RailAttentionPayload            请求弹一次喊人弹窗
 *   main → renderer
 *     mochi:event:stream     DshStreamEvent                 dsh 事件流（状态/思考/工具/文本/最终回答）
 *     mochi:approval:request ApprovalRequest               需要用户确认的工具（Batch 2 后半段由 answerer IPC 化触发）
 *   main → 常驻条窗口
 *     mochi:rail:apply       RailSnapshot                    下发当前快照
 *     mochi:rail:popup       RailAttentionPayload            下发弹窗内容
 *   常驻条窗口 → main
 *     mochi:rail:action      RailAction                      用户动作（打开/隐藏/知道了/同步）
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

/* ───────────────────────── 常驻条（悬浮窗）契约 ───────────────────────── */

/**
 * [Mochi 2026-09-18] 两块常驻显示各自一个 surface：
 *   teacher-rail     教师私有小横条——学生预约待办（学生 → 老师）
 *   classroom-board  教室端常驻屏——老师喊谁做什么 + 谁过关/谁不过关（老师 → 学生）
 *
 * 数据分工：已认证的 Harness 页面只把**原始 LAN 快照**推给主进程，派生（哪些行、
 * 哪些要弹窗）全部在主进程的 dsh/rail-model.ts 里做一次。这样做的原因是两端
 * 都要看到同一份判断——「什么算新待办」「什么值得弹窗」如果页面算一遍、主进程
 * 再算一遍，迟早会不一致，而那种不一致只会在演示时被看见。
 */
export type RailSurface = 'teacher-rail' | 'classroom-board';

/** 一行的色调。仅用于视觉，不含任何业务判断。 */
export type RailTone = 'neutral' | 'attention' | 'ok' | 'bad';

/**
 * 常驻条里的一行。两种 surface 共用同一形状，由页面按 surface 决定渲染细节：
 * 教师端更关心 note（预约了什么）；教室端更关心 badge（过关/不过关）。
 * 所有字段都是短字符串，长度由主进程按下面的上限裁剪。
 */
export interface RailRow {
  /** 稳定去重键（例如 messageId）。同一 id 重复推送不会重复计数。 */
  id: string;
  /** 排序号，1 起。由推送方按自己的业务顺序排好。 */
  seq: number;
  /** 主标题：学生姓名 / 名单姓名。 */
  name: string;
  /** 副信息：班级 · 类型 之类的短标签。 */
  meta: string;
  /** 详情：预约内容 / 不过关原因。 */
  note: string;
  /** 状态徽标文案：待处理 / 已看到 / 不过关 …。 */
  badge: string;
  tone: RailTone;
  /** 到达或变更时间（ISO 字符串，仅用于显示与排序稳定性）。 */
  at: string;
}

/** 一次完整推送。整份替换，主进程不做增量合并，避免出现两个事实源。 */
export interface RailSnapshot {
  surface: RailSurface;
  /** 条头大标题，例如「学生预约」。 */
  heading: string;
  /** 条头副标题，例如「3 条待处理」。 */
  detail: string;
  /** 本次推送时间（ISO）。 */
  updatedAt: string;
  rows: RailRow[];
}

/**
 * 喊人弹窗的一次性内容。刻意与 RailRow 分开：弹窗是瞬态强提醒，需要的是
 * 「谁 + 干什么」两行大字，不是列表。
 */
export interface RailAttentionPayload {
  /** 去重键；同一 id 在冷却期内只弹一次。 */
  id: string;
  kind: 'call' | 'request' | 'pairing';
  /** 弹窗标题，例如「有人喊你」。 */
  title: string;
  /** 弹窗主行，例如「张小明 · 高一（3）班」。 */
  subject: string;
  /** 弹窗副行，例如「预约讲题 · 第 3 题」。 */
  detail: string;
  at: string;
}

/** 常驻条窗口给主进程的动作。 */
export type RailAction =
  /** 点某一行的「处理」：把主窗口拉起来并聚焦该条。 */
  | { type: 'open'; id: string }
  /** 临时隐藏常驻条（托盘菜单可恢复）。 */
  | { type: 'hide' }
  /** 弹窗上的「我知道了」。 */
  | { type: 'acknowledge'; id: string }
  /** 列出自己当前的期望快照（窗口首帧后主动拉一次）。 */
  | { type: 'sync' };

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
  /** renderer → main：推一份**原始 LAN 快照**（就是 /api/mochi-lan/state 的响应体）。 */
  railLanState: 'mochi:rail:lan-state',
  /** main → 常驻条窗口：下发当前快照。 */
  railApply: 'mochi:rail:apply',
  /** main → 常驻条窗口：弹窗内容。 */
  railPopup: 'mochi:rail:popup',
  /** 常驻条窗口 → main：用户动作。 */
  railAction: 'mochi:rail:action',
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
