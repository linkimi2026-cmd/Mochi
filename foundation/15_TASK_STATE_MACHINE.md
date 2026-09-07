# 15 · 任务状态机（TASK_STATE_MACHINE）

## 1. MochiTask 字段

```
id · organizationId · fromAgent · toAgent · taskType(ASK|REQUEST|FIND|APPROVE)
status · request{goal, context, attachments[]} · result{answer?, artifactGrant?}
requiresApproval · createdAt · updatedAt · completedAt · expiredAt
idempotencyKey · correlationId
```

## 2. 状态集（最小起步，防 Architecture Vanity）

```
CREATED → DISPATCHING → DELIVERED → WORKING
   WORKING → INPUT_REQUIRED → (用户补输入) → WORKING
   WORKING → APPROVAL_REQUIRED → (批准) → WORKING | (拒绝) → DECLINED
   WORKING → COMPLETED（result 落地）
   任意非终态 → EXPIRED / CANCELLED / FAILED
```

- 与联动计划 Relay 状态映射：`DELIVERED ≡ pending`、`COMPLETED ≡ accepted(+reply)`、`DECLINED ≡ declined`。
- v1 落地只启用：CREATED/DISPATCHING/DELIVERED/COMPLETED/DECLINED/FAILED/EXPIRED（7 态）；
  INPUT_REQUIRED/APPROVAL_REQUIRED/CANCELLED 字段预留、UI 预留，实现随 Golden Demo 需要。
- 终态不可逆；所有迁移带 `WHERE status=?` 条件更新（幂等，`28`）。

## 3. 前端呈现（6 态卡，plan/03 §7.1 R6）

`PENDING_SEND / RUNNING / INPUT_REQUIRED / APPROVAL_REQUIRED / COMPLETED / TERMINATED`
——派生自上方状态集，传话卡六态样式沿用嘉行联 Relay 卡（AssistantPage.css 324 行语汇）。

## 4. 过期与清理

- `expiredAt` 默认 24h（ASK）/ 72h（FIND）；到期由本地 cron 扫描置 EXPIRED 并通知发起方。
- 不做跨机时钟依赖；单机模拟以本地时钟为准。
