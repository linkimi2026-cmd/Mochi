---
name: weekly-class-report
description: 为班主任生成每周班级运行报告、数据表和可交付文档；用户说班级周报、周总结或数据汇报时使用。
whenToUse: 用户需要汇总一周学生流动、医务、宿舍、通知处理或班级事务，并输出表格或 Word 报告时使用。
user-invocable: true
---

# 班级周报

## 工作法

1. 先确认班级和统计周期；未提供周期时默认最近完整教学周，并在结果里写明日期范围。
2. 调用 `jxl.student_query`、`jxl.clinic_status`、`jxl.dorm_status` 和 `jxl.message` 获取必要事实。只统计工具实际返回的数据。
3. 用 `spreadsheet.create` 建原始数据表，用 `spreadsheet.formula` 生成计数与比例，再用 `spreadsheet.read` 复核公式结果。
4. 生成“本周概览、需跟进事项、已完成动作、下周建议”四段摘要；推测和建议必须与确认事实分开。
5. 用 `doc.create` 生成周报，用 `doc.read` 复核结构和关键数字；必要时用 `doc.edit` 修订。
6. 分别用 `spreadsheet.export` 和 `doc.export` 交付附件，返回文件路径和统计口径。

## 教师体验

- 老师只需说“做高一（1）班这周周报”，其余参数由现有数据和默认口径补齐。
- 结果含 `dataMode: demo` 时，所有导出文件标题与回复都要标“演示数据”。
- 不自动发送周报；需要发送时另走 `message.draft` / `message.send`，发送前确认。

## 能力缺口

缺少数据、表格或文档工具时，完成可验证的部分并列出缺口；不得声称已生成不存在的附件。
