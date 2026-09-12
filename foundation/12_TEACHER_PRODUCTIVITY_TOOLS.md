# 12 · 教师办公工具链（TEACHER_PRODUCTIVITY_TOOLS）

> ⛔ **§1 的工具名整表已作废（点号形态）· 2026-09-12 标注**
>
> **status**: archived　**last_verified**: 2026-09-12　**verified_by**: 工具线
>
> §1 原表的 `ppt.create` / `doc.create` / `spreadsheet.create` / `file.search` / `jxl.*` 等
> **点号工具名全部作废**——点号会让模型网关整轮 400 拒收。§2 之后的实现要点仍有参考价值。
> 现行真值表（源码实测）：

| 族 | 现行工具名（`^[a-zA-Z0-9_-]+$`） | 插件 |
|---|---|---|
| PRESENTATION | `mochi_ppt_create` `mochi_ppt_revise` `ppt_inspect` | `mochi-presentations` |
| DOCUMENT | `doc_create` `doc_read` `doc_edit` `doc_export`（+ 别名 `mochi_document_create`） | `mochi-documents` |
| PDF | `pdf_read` | `mochi-documents` |
| SPREADSHEET | `spreadsheet_create` `spreadsheet_read` `spreadsheet_formula` `spreadsheet_export` | `mochi-sheets` |
| FILES | `file_search` `file_read` `file_copy` `file_move` `file_rename` `file_create_folder`（**无删除工具**） | `mochi-files` |
| GRADES | `mochi_grade_analyze` | `mochi-grades` |
| CALENDAR/TASK | `mochi_schedule_create` `mochi_schedule_list` `mochi_schedule_cancel` | `mochi-task-scheduler` |
| COMMUNICATION | `mochi_notify_classroom` `mochi_send_classroom_file`（CONFIRM 档） | `mochi-dispatch` |
| JIAXINGLIAN | `jxl_query` `jxl_campus_status` `jxl_clinic_status` `jxl_dorm_status` `jxl_movement_*` `jxl_medical_event_*` `jxl_student_card` `jxl_analytics` … 共 26 个 | `mochi-campus` |
| VISUALS | `image_find` `image_edit` `diagram_draw` `teaching_image_match` | `mochi-visuals` |
| KNOWLEDGE | `mochi_knowledge_search` `mochi_knowledge_page` `mochi_knowledge_page_image` | `mochi-knowledge` |
| MEMORY | `mochi_memory_note` `mochi_memory_recall` `mochi_memory_list` `mochi_memory_forget` `mochi_memory_clear` `mochi_memory_world` | `mochi-memory` |
| MODELING | `mochi_model_create` | `mochi-modeling` |

> 全表（含参数与边界）见 `docs/agent-integration-handbook.md` §6。
> ⛔ 原文「权威数量清单 = `plan/01_TOOLCHAIN.md` §1.2（38 个 P0）」亦已作废；
> 现行真值 = `prepare-mochi-resources.cjs` 的 `PLUGINS`（当前 26 个插件）。

---

## 1. 工具族与 P0 成员（⛔ 历史原文，点号形态已作废，保留供追溯）

| 族 | 工具（P0） |
|---|---|
| PRESENTATION | `ppt.create` `ppt.inspect` `ppt.edit_slide` `ppt.add_slide` `ppt.remove_slide` `ppt.reorder` `ppt.apply_theme` `ppt.export` |
| DOCUMENT | `doc.create` `doc.inspect` `doc.edit` `doc.format` `doc.export` |
| SPREADSHEET | `spreadsheet.create` `spreadsheet.read` `spreadsheet.write` `spreadsheet.formula` `spreadsheet.chart` `spreadsheet.analyze` `spreadsheet.export` |
| PDF | `pdf.read` `pdf.create` `pdf.merge` `pdf.extract` `pdf.export` |
| FILES | `file.search` `file.read` `file.create_folder` `file.rename` `file.copy` `file.move` `file.organize` |
| CALENDAR/TASK | `calendar.search` `calendar.create` `task.create` `task.update` `reminder.create`（reminder 映射官方 `schedule_create`，≥300s 限制如实告知） |
| COMMUNICATION | `message.draft` `message.send`（CONFIRM 档） |
| JIAXINGLIAN | `jxl.*`：学生/流动/医务/宿舍/消息/异常/统计（读 AUTO；写 CONFIRM） |
| BROWSER | P1 桩：`browser.search/open/navigate/extract/fill/download`（优先结构化 API，最后才 GUI） |

## 2. 实现要点

- 文档族库选型遵循 plan/01（jszip MIT / mammoth 复核等 License 审计在 Batch 6）。
- 每个生成工具配 `inspect`：结构化概览（页数/字数/图表/越界项），供质量循环（`09` §3）。
- `ppt.apply_theme` 使用嘉行联派生主题（calm-tokens 派生，非新设计）。
- Artifact 集成：所有 create/edit/export 产出登记进 Artifact store（`13`）。

## 3. 老师检验（指令 B）

每新增工具必答：老师可见复杂度是否过高？是否要老师写 prompt/配参数？
默认值应让老师一句话说目标即可（"帮我弄一下"级别）。

## 4. 不做的事（砍刀清单）

60+ 工具超集（P1 偷渡已砍）、soffice 像素级预览、跨主体共享链、真实跨网络 A2A——
全部记录在 12_REVISION_LOG 砍刀清单，比赛窗口内不捞回。
