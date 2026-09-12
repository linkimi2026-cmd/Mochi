# 11 · 工具契约（TOOL_CONTRACT）

> ⚠️ **本文件已归档（archived）· 2026-09-12 标注**
>
> **status**: archived　**last_verified**: 2026-09-12　**verified_by**: 工具线
>
> **§3 的命名口径 `<domain>.<action>` 已作废（点号工具名）。**
> 铁律：**模型可见工具名必须匹配 `^[a-zA-Z0-9_-]+$`**——**点号会让模型网关整轮 400 拒收**
> （2026-09-12 真实事故：`file.search` 这一类名字导致整轮对话被拒）。
> 现行实现一律用下划线：`jxl_query`、`mochi_ask`、`mochi_ppt_create`、`file_search`。
> 校验已在 `plugins/mochi-files/index.mjs:30`、`plugins/mochi-visuals/plugin.mjs:30` 处硬编码为运行时断言。
> §2 的返回包络仍是有效设计目标；§4 的权限分级仍成立。
> 现行工具清单见 `docs/agent-integration-handbook.md`。

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

- 命名：~~`<domain>.<action>`（`jxl.movement_list`、`ppt.create`、`mochi.ask`）~~ ⛔ **已作废**
  → **现行口径：`^[a-zA-Z0-9_-]+$`，用下划线**（`jxl_movement_request_list`、`mochi_ppt_create`、`mochi_ask`）。
  点号会被模型网关整轮 400 拒收。详见本文件头部横幅。
- 注册：`ctx.tools`（官方工具注册表）；schema 进系统提示组装（官方机制，不手拼 prompt）。
- 数量：~~P0 = 38~~ ⛔ 已作废（该数字属 `plan/01_TOOLCHAIN.md` 的早期口径）。
  **现行真值 = `apps/desktop/scripts/prepare-mochi-resources.cjs` 的 `PLUGINS` 数组**（当前 26 个插件），
  工具名全表见 `docs/agent-integration-handbook.md`。

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
