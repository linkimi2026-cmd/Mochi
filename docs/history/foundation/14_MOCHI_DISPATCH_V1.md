# 14 · Mochi Dispatch v1（MOCHI_DISPATCH_V1）

## 1. 已跑通基线（PRESERVE，不许退化）

联动计划 Relay（E2E 已验证两个场景：传话 + 找卷子）：
- 老师对自己 Mochi 说目标 → Mochi 组织**正文**（服务端组稿，body 截 200 字）→ 投递对方收件箱 →
  **对方主人决定应答**（accept + 预填回话 / decline）→ 回话返回原 Mochi → 原老师看到。
- 语义铁律：Mochi 不能代替主人应答；`respond` 只有收件人本人能改 pending 行。
- v1 必须保持这套语义，即使载体从 Worker API 换成单机模拟。

## 2. Dispatch 原语（v1 四个）

`ASK`（问一句话，等回话）· `REQUEST`（请求做事，等批准/结果）· `FIND`（找资源，等 Artifact Grant）·
`APPROVE`（对入站请求的应答动作）。
SHARE/SCHEDULE/RESERVE/ASSIGN/COLLABORATE → P4；不继续堆关键词，抽象进 Task Domain（`15`）。

## 3. v1 载体：单机模拟（R2 裁决维持）

- 不建独立协调服务器。第二个 Mochi / Resource Agent 用**本地第二个 profile/进程**扮演；
  `mochi_tasks` 等表结构按规范建在本地 sqlite。
- human approval 在发起方侧由桌面审批卡渲染；**不走 `subagent-acp`**（自动化无人环，官方事实）。
- 跨网络真 A2A：留作答辩"下一步"，协议字段按可跨网设计（organizationId/fromAgent/toAgent）。

## 4. 流程（FIND 金演示，`31` Demo B/G）

```
请求方 Mochi
  → 本地授权资源搜索（file.search / artifact store）
  → 未中 → Agent Discovery（mochi-registry）→ 找到周老师 Mochi
  → 创建 FIND Task（状态机 §15）→ 对方 Mochi 在其主人授权范围内搜索
  → 命中"数学月考试卷.pdf" → 非自动共享 → 请求周老师 Approval（具体确认卡）
  → 允许 → Artifact Grant（v1=本地复制+登记）→ 文件回请求方 Artifact store
  → 原老师得到 PDF；后续"顺便做成讲评 PPT"→ ppt.create(artifact 引用)
```

## 5. 与官方机制的关系

- Dispatch 任务在官方 `ctx.jobs`/会话事件之上实现（任务事实进会话日志）；
- 不用 MCP server（dsh 只做 MCP client）；不用 ACP 做人审环节（L4）。
