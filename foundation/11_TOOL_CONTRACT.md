# 11 · 工具契约（TOOL_CONTRACT）

## 1. 铁律

**TOOLS RETURN FACTS. MOCHI SPEAKS.** 工具返回结构化事实，永远不返回聊天话术。

## 2. 统一返回包络（structured facts）

```jsonc
{
  "status": "ok | error",            // 机器可判
  "data": { ... },                   // 领域事实（查询结果/写入回执）
  "artifact"?: { "id": "…", "type": "presentation|document|…", "path": "…" },
  "metadata"?: { "source": "jiaxinglian", "scope": "own-class", "queriedAt": "…" },
  "warnings"?: ["…"],                // 非致命事实（部分数据缺失等）
  "availableOperations"?: ["ppt.edit_slide", "artifact.export"],  // 下一步可做
  "error"?: { "code": "AUTH_REQUIRED | PERMISSION_DENIED | …", "message": "…", "retryable": false }
}
```
- `render` 面向模型：JSON 事实；人看的呈现由 UI/人格负责。
- 错误码全量见 `27_FAILURE_RECOVERY.md`；`AUTH_REQUIRED` → 前端显示"连接嘉行联"。

## 3. 命名与注册

- 命名：`<domain>.<action>`（`jxl.movement_list`、`ppt.create`、`mochi.ask`）。
- 注册：`ctx.tools`（官方工具注册表）；schema 进系统提示组装（官方机制，不手拼 prompt）。
- 数量：P0 = 38（唯一权威清单 = `Mochi/plan/01_TOOLCHAIN.md` §1.2；已由修订官裁定）。

## 4. 权限分级（answerer 按工具名判定——官方 payload 无参数）

| 档 | 工具族 | 行为 |
|---|---|---|
| AUTO | 一切只读：jxl.*_list/_get/_search、file.search/read、doc.inspect、分析类 | answerer 直接 `'allowed-once'` |
| CONFIRM | 发消息、放行学生、改正式记录、共享文件、导出提交外部、高影响操作 | answerer 不决策 → Web 审批卡（具体确认文案见 `19` §4） |
| DENY | 白名单外工具、明确禁止操作 | answerer 返回 `'rejected'` |

## 5. 工程要求

- 幂等：所有写操作接受 `idempotencyKey`（`28`）。
- 超时：声明时限，配 `guard/timeout-policy`（官方机制）。
- 重试：仅幂等写与只读可自动重试；其余失败上抛给模型处理。
- 工具不维护第二套状态机；校园状态机以联动计划 worker 为唯一权威（PRESERVE）。
