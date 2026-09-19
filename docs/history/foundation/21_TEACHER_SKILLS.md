# 21 · 教师技能（TEACHER_SKILLS）

> Skill = 完成某项教师工作的**工作方法**（官方 skill 机制：catalog + `skill` 工具 + `/name` 直调），
> 不是关键词→固定回答。P0 = 5 个（修订官裁定）。

## 1. P0 技能

> ⛔ **工具名口径已更新（2026-09-12）**：原文的「工具名以 `plan/01 §1.2` 为唯一权威」**已作废**
> ——`plan/` 整目录是历史规划（见 `docs/DOC-AUTHORITY.md` §4），其 38 工具点号清单同样作废。
> **现行真值 = `apps/desktop/scripts/prepare-mochi-resources.cjs` 的 `PLUGINS`（26 个插件）**，
> 工具名一律 `^[a-zA-Z0-9_-]+$`（下划线，禁点号）。
> 下表左列的 `jxl.movement_list` 等**点号形态只作历史追溯**；对应现行名为
> `jxl_movement_request_list` / `jxl_clinic_status` 等，全表见 `docs/agent-integration-handbook.md` §6。

| Skill | 方法要点 | 主要工具 |
|---|---|---|
| `teacher-daily-brief` | 晨间摘要：先查流动/医务/异常 → 汇总成一屏事实 → 可选导出 | `jxl.movement_list` `jxl.clinic_now` `jxl.overdue_list` |
| `class-meeting-prep` | 班会备课：目标→大纲→PPT→自检改稿（质量循环） | `ppt.create/inspect/edit_slide` `jxl.analytics_summary` |
| `student-follow-up` | 学生跟进：查档案+近期流动 → 起草跟进话术（发送走 CONFIRM） | `jxl.student_get` `jxl.movement_list` `message.draft` |
| `teaching-material-find` | 找材料：本地→Artifact 库→Discovery→FIND（`14` §4 全流程） | `file.search` `mochi.find` |
| `weekly-class-report` | 周报：统计→图表→Word/导出（Artifact 链） | `jxl.movement_stats` `spreadsheet.*` `doc.*` |

P1 候选（不承诺）：`movement-follow-up`、`schedule-coordination`、`classroom-support`、
`document-preparation`、`teacher-message`。

## 2. 形态要求

- 每个 skill = 一个目录（SKILL.md + 方法说明），经官方 skill provider 挂载；
  模型经 `skill` 工具加载全文后按方法执行；老师可 `/class-meeting-prep` 直调。
- Skill 文本写"工作法"（先查什么、按什么顺序、何时必须停下问人），不写死话术。
- 新增工具必须过指令 B 检验（`12` §3）。

## 3. 出厂预配

老师零配置：skills 随包安装、jxl 插件预挂、模型预配 glm-4-flash、审批预设 workspace-write。
老师不需要懂 MCP/Skill/System Prompt（用户核心诉求）。
