# 17 · 嘉行联 Organization Plugin（JIAXINGLIAN_ORG_PLUGIN）

## 1. 定位

嘉行联 = Organization Plugin（`mochi-jiaxinglian`）。未连接时 Mochi 一切通用能力照常
（聊天/写作/文件/PPT/Word/Excel/PDF/浏览器/通用 Work），只是**拿不到校园私有数据**。

## 2. Capability 面（首版读为主）

| 域 | 工具（AUTO 读） | 写/动作（CONFIRM） |
|---|---|---|
| 学生 | `jxl.student_search` `jxl.student_get` | — |
| 流动 | `jxl.movement_list` `jxl.movement_get` `jxl.movement_stats` | `jxl.movement_approve` `jxl.movement_confirm`（对应官方状态机迁移） |
| 医务 | `jxl.clinic_now` `jxl.health_events` | — |
| 宿舍 | `jxl.dorm_overview` `jxl.dorm_incidents` | — |
| 消息 | `jxl.message_inbox` | `jxl.message_send` |
| 异常 | `jxl.overdue_list` | — |
| 统计 | `jxl.analytics_summary`（导出落 Artifact） | — |

## 3. AUTH_REQUIRED 流程

1. Agent 调 `jxl.*` → 插件无有效会话 → 返回 `{status:"error", error:{code:"AUTH_REQUIRED"}}`。
2. UI（jxl-settings / 插件页）显示"**连接嘉行联**"按钮 → 打开独立认证视图。
3. 认证在**插件层**完成（用户名密码只进 Worker `/auth`，永不经模型、不落 agent 可见上下文）。
4. 成功后插件持有会话凭据（主进程/凭据层），给 Agent 的只有：
   `Identity / Role / Scope / Capabilities / Available Tools`。

## 4. Scope 模型（映射联动计划 permissions.ts，服务端为权威）

| 角色 | Scope |
|---|---|
| HEAD_TEACHER | 本班学生与本班流动/事件 |
| SUBJECT_TEACHER | 当前任教班级学生（teacher_class_roles） |
| NURSE | 医务全量（含到访确认） |
| GRADE_ADMIN | 年级范围 |
| DORM_STAFF / ADMIN | 按联动计划现状（DORM 空/ADMIN 管理面） |

- 插件侧 scope 只做**预过滤**（减少无关数据进模型）；真实授权由 Worker API 再查（ PRESERVE 原则）。
- 医务保密备注：管理员不可读的，模型同样不可读（继承 PRIVACY_AND_SECURITY 基线）。

## 5. 数据最小化

- 查询结果按"回答所需最小集"裁剪（如名单只返回姓名+状态，不返回整行）。
- 学生敏感字段进模型前脱敏；锁屏负载脱敏规则沿用。
- 全部 jxl 调用写审计（沿用 audit_logs 语义；本地 demo 记本地审计表）。
