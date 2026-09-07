# 28 · 幂等与竞态（IDEMPOTENCY_AND_RACE）

## 1. 必须幂等的场景

用户连点两次发送 · 卡片重复扫描 · Agent 重试 · 网络重试 · 双方同时确认 · A2A 重试 · 工具重试。
后果红线：不重复发消息、不重复放行、不重复建任务、不重复共享 Artifact。

## 2. 机制

| 场景 | 机制 |
|---|---|
| 写工具 | 必带 `idempotencyKey`；服务/插件侧以键去重，命中返回原结果（不报错） |
| 任务创建 | `correlationId` 唯一约束；重复创建返回 `DUPLICATE_TASK`+原任务引用 |
| Relay 应答 | 沿用联动计划语义：`UPDATE … WHERE status='pending'` 条件更新，二次应答不命中 |
| Movement | 沿用官方乐观锁 `WHERE id=? AND status=? AND version=?` + `idempotencyKey`（PRESERVE） |
| UI 发送 | 发送后 composer 短暂锁存；WS 重连重放由会话事件序号去重 |
| Artifact | 写入以 `sourceTask+version` 命名，重试覆盖同版本而非新建 |

## 3. 竞态原则

- 状态迁移全部条件更新（先查后改视为禁止）；
- 单机模拟内两 profile 并发：本地 sqlite WAL + 条件更新足够，不引入分布式锁；
- 所有条件更新失败返回结构化 `error.code`（如 `STATE_CONFLICT`），不抛裸异常给模型。
