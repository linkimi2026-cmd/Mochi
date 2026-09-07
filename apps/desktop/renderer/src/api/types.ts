import type { ExpressiveOrbMood } from "../components/ExpressiveOrb";

/**
 * dsh 流式事件（占位结构，Agent B 在 Batch 2 接真实协议时补全字段）。
 *
 * UI 侧只关心「该切到哪个球的表情」这一信号，故每个事件都映射到一种 mood。
 * Agent B 可直接扩展联合成员的字段，只要保留 `type` 判别即可，UI 不用改。
 */
export type StreamEvent =
  | { type: "thinking" } // 模型推理 / 工具调用中
  | { type: "tool_call"; label?: string } // 正在调用某个工具（同样归 thinking）
  | { type: "speaking" } // 开始流式输出文字
  | { type: "token"; text: string } // 流式文字片段（UI 累积进气泡）
  | { type: "success" } // 任务完成
  | { type: "alert"; reason?: string } // 需要人确认 / 出错
  | { type: "error"; message: string }; // 运行期错误

/** 把事件翻译成球要切到的 mood。集中在此，方便与 Agent B 对齐语义。 */
export function moodForEvent(ev: StreamEvent): ExpressiveOrbMood {
  switch (ev.type) {
    case "thinking":
    case "tool_call":
      return "thinking";
    case "speaking":
    case "token":
      return "speaking";
    case "success":
      return "success";
    case "alert":
    case "error":
      return "alert";
    default:
      return "idle";
  }
}

/** 等待老师确认的工具调用请求（占位结构，Agent B 补全字段）。 */
export interface ApprovalRequest {
  reqId: string;
  toolName?: string;
  /** 必须写清「我要做什么」，对应 SKILL.md 的确认三档。 */
  reason?: string;
}
