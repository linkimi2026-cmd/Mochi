# 12 · 教师办公工具链（TEACHER_PRODUCTIVITY_TOOLS）

> 权威数量清单 = `Mochi/plan/01_TOOLCHAIN.md` §1.2（38 个 P0，修订官裁定）。本文定义族与质量循环。

## 1. 工具族与 P0 成员

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
