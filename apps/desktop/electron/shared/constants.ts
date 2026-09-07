/**
 * 共享业务常量（前端与 Worker 共用）
 *
 * 用于校验输入与渲染下拉选项。修改一处即可全站生效，
 * 避免原先 categories/statuses 在 worker/routes/core.ts 与 src/types.ts 各定义一份的漂移风险。
 */

/** 健康事件分类 */
export const CATEGORY_OPTIONS = [
  "身体不适",
  "轻微外伤",
  "运动不适",
  "情绪关怀",
  "常规测量",
  "其他情况",
] as const;

/** 紧急程度（顺序即排序权重，越靠前越紧急） */
export const URGENCY_OPTIONS = ["普通", "需关注", "紧急"] as const;

/** 处理措施 */
export const MEASURE_OPTIONS = [
  "初步检查",
  "休息观察",
  "基础处理",
  "联系教师",
  "联系家长",
  "建议就医",
] as const;

/** 事件状态流转选项 */
export const STATUS_OPTIONS = [
  "检查中",
  "留观中",
  "已通知教师",
  "已通知家长",
  "准备返班",
  "已返班",
  "家长接走",
  "转诊",
  "记录结束",
] as const;

/** 教师快捷回复模板（消息中心使用） */
export const QUICK_REPLIES = [
  "已知悉",
  "正在联系家长",
  "家长正在赶来",
  "请继续留观",
  "请允许学生返班",
  "请电话联系我",
] as const;

/** 终结性状态：到达这些状态后事件视为结束并写入 ended_at */
export const TERMINAL_STATUSES = ["已返班", "家长接走", "转诊", "记录结束"] as const;
