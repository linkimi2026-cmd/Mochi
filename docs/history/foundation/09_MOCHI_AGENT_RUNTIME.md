# 09 · Mochi Agent 运行时（MOCHI_AGENT_RUNTIME）

## 1. Mochi 的定义

Mochi 是教师的工作 Agent：理解用户想完成什么 → 自己能做就做 → 需要工具用 Tools →
需要学校系统用 Plugin → 自己做不了找其他 Mochi → 需要授权请主人确认 → 交付真实结果。
核心理念：**Think · Act · Collaborate · Deliver。**

## 2. 人格层（mochi-persona 插件）

- 经 `ctx.systemPrompt` 注册提示词片段：身份（嘉行联的 Mochi）、语气（亲切、简洁、教师口语兼容）、
  行为准则（工具返回事实→由模型转述；不假装做了没做的事；需要确认时先问）。
- 人格**不承担策略**：AUTO/CONFIRM/DENY 由 mochi-approval answerer 决定；人格只决定"怎么说"。
- 理解教师口语："我们班""刚才那个""没回来的""还是昨天那个格式""你帮我弄一下""今天乱不乱"——
  由模型解析指代，不靠关键词表。

## 3. Work 质量循环（不许 prompt→generate→END）

```
PLAN → CREATE → INSPECT → CRITIQUE → EDIT → VERIFY → DELIVER
```
- 例："做个十页班会 PPT" → 规划大纲 → `ppt.create` → `ppt.inspect`（发现第 6 页文字过多）→
  `ppt.edit_slide` → 复检 → 交付 Artifact。
- 实现载体：mochi-tools 家族每个 create/edit 工具配对 inspect 工具；技能层（`21`）写明
  "先 inspect 再交付"为默认工作法；`guard/repeat-tool-reminder` 兜底失控循环。

## 4. 事件 → Mochi 情绪（Orb 驱动）

| dsh 事件 | mood |
|---|---|
| turn/start、step/start | thinking |
| assistant/live-chunk 流式 | speaking |
| tool/result（成功）、turn/end 交付 | success |
| approval/request（CONFIRM 档） | alert |
| 空闲 | idle |
| listening（composer 聚焦） | listening |

实现：Electron 主进程订阅 session 事件（web 通道 WS 或 sdk sidecar `session.event`）→
映射 `{mood,text}` → IPC → Orb `setMood()`。文案由人格统一，不出现"本地规则"黑话。

## 5. Chat 与 Work 二分

- Chat：讨论/思考/写作/头脑风暴/改表达——纯模型，不挂工具。
- Work：真正运行 Harness——Tools/Skills/Plugins/A2A/Artifacts/Sandbox/Subagent。
- 同一运行时，两种入口（`25`）；Work 页展示任务/步骤/Tool Calls/Approval/Artifacts/Agent 状态。

## 6. 会话与上下文

- 会话日志是唯一事实源（官方不变量）；fork/resume 用官方能力。
- 长会话靠官方 compaction；Mochi 层补充 Working Memory（`20`）。
- CONTEXT BELONGS TO MOCHI：换 Chat Provider/Work Model 不丢上下文（`10`/`25`）。
