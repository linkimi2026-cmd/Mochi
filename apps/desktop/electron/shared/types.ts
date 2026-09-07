/**
 * 共享类型定义（前端与 Worker 共用，避免字段漂移）
 *
 * 仅放置纯类型与不依赖任何运行时环境（DOM / WebWorker / Node）的常量。
 * 业务响应类型（如 EventItem、Student）仍由各端按需定义。
 */

/** 角色：校医 / 班主任 / 任课教师 / 年级负责人 / 系统管理员 */
export type Role = "NURSE" | "DORM_STAFF" | "HEAD_TEACHER" | "SUBJECT_TEACHER" | "GRADE_ADMIN" | "ADMIN";

/**
 * 已认证用户的最小身份信息。
 * 前端 `User` 与 Worker `AuthUser` 均以此为基线，确保两端字段一致。
 */
export type AuthUser = {
  id: number;
  username: string;
  name: string;
  role: Role;
  gradeScope: string | null;
  mustChangePassword: boolean;
  identityVerifiedAt: string | null;
  notificationOnboardingStatus: "complete" | "skipped" | null;
  notificationDeviceReady: boolean;
};

/** 角色到中文文案的统一映射（前后端共用，单一来源） */
export const ROLE_LABELS: Record<Role, string> = {
  NURSE: "校医",
  DORM_STAFF: "宿舍工作人员",
  HEAD_TEACHER: "班主任",
  SUBJECT_TEACHER: "任课教师",
  GRADE_ADMIN: "年级负责人",
  ADMIN: "系统管理员",
};
