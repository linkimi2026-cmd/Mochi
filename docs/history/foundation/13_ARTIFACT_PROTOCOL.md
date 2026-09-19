# 13 · Artifact 协议（ARTIFACT_PROTOCOL）

## 1. 定义

所有真实工作成果统一为 Artifact：presentation / document / spreadsheet / pdf / image / file /
structured-data / link。

## 2. Contract（字段）

```
id · type · name · mimeType · owner · organization · sourceTask · version
createdAt · updatedAt · permissions · preview · availableOperations
deliveryState · sharingState
```

## 3. v1 裁决（R3，维持）

- **本地 store 是唯一事实源**：`<workspaceRoot>/.artifacts/` + 版本链（plan/01 §5.3 修订后）。
  绝对路径在单机 v1 合法。
- `mochi_artifacts`/HMAC Grant/跨主体共享链**降为未来规范**，v1 不实现；
  跨主体共享 = 本地复制 + CONFIRM 确认卡。
- 像素级预览（soffice）已砍：preview = 结构化概览（inspect 输出）+ 系统默认应用打开。

## 4. 操作集

CREATE / READ / EDIT / VERSION / PREVIEW / EXPORT（+ P4: SHARE）。
- Artifact 可作为另一任务的输入：Excel→Word 报告、嘉行联统计→PPT、A2A 返回 PDF→PPT 工具。
- 嘉行联导出（统计 CSV 等）落 Artifact，供办公工具族消费。

## 5. UI 呈现

- `mochi.artifact` keyed chat node（`06` §2）：名称/类型/版本/预览摘要/可用操作按钮。
- Artifacts 库页：按任务/时间/类型检索；与官方附件/缩略图能力对接。
- Work→Chat→Work 循环（`25` §4）靠 Artifact id 引用，不重传文件。
