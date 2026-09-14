# 27 · 失败与恢复（FAILURE_RECOVERY）

## 1. 错误码总表（工具/任务统一使用）

| 域 | 错误码 |
|---|---|
| 模型 | `MODEL_TIMEOUT` `MODEL_UNAVAILABLE` |
| 工具 | `TOOL_TIMEOUT` `TOOL_FAILED` |
| 授权 | `AUTH_REQUIRED` `PERMISSION_DENIED` `TOKEN_EXPIRED` |
| 网络 | `AGENT_OFFLINE` `AGENT_NOT_FOUND` `NETWORK_ERROR` |
| A2A | `APPROVAL_DECLINED` `TASK_EXPIRED` `DUPLICATE_TASK` |
| Artifact | `ARTIFACT_NOT_FOUND` `ARTIFACT_TOO_LARGE` |
| 系统 | `DATABASE_ERROR` `USER_CANCELLED` |
| Chat Bridge | `PROVIDER_ADAPTER_FAILED` `CHAT_CAPTURE_FAILED` `CONTEXT_TOO_LARGE` |

## 2. 处置策略

| 类别 | 策略 |
|---|---|
| `MODEL_*` | 一次自动重试 → 提示换模型（Settings→Models 一等公民）；演示模式兜底 |
| `TOOL_*` | 幂等操作自动重试一次；非幂等上抛模型组织语言说明 |
| `AUTH_REQUIRED` | 返回给 UI："连接嘉行联"；模型转述"需要先连接校园系统" |
| `PERMISSION_DENIED` | 如实转述，禁止变体重试绕过 |
| `AGENT_OFFLINE/NOT_FOUND` | Discovery 降级：如实告知没有可用 Mochi |
| `APPROVAL_DECLINED` | 终态；任务置 DECLINED，不自动重发 |
| `CONTEXT_TOO_LARGE` | Handoff Compiler 摘要重试一次；仍超限则请用户缩小范围 |
| `DUPLICATE_TASK` | 命中幂等键 → 返回原任务（见 `28`） |
| `USER_CANCELLED` | 立即停止，清理 pending 状态 |

## 3. 原则

- 模型**永远得到结构化错误事实**（error.code + retryable），由模型决定组织什么话；
- 失败不静默吞；关键失败写会话事件（审计）；
- 演示环境预案：`demo-auto-approver` + 断网演示模式（plan/08 §5.5）双保险。
