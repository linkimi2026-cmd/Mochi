# 05 · Harness 插件地图（HARNESS_PLUGIN_MAP）

> 每个 Mochi 插件必须挂在官方记录的扩展点上（`docs/architecture.zh.md` "新行为的归属位置"）。
> 命名前缀 `mochi-`；全部为 Cordis 插件，经 profile 的 cordis.patch.yml / bundle 挂载。

## 1. 运行时插件（server 侧）

| 插件 | 挂载点（ctx/事件） | 职责 | P 级 |
|---|---|---|---|
| `mochi-persona` | 系统提示片段（`ctx.systemPrompt`） | Mochi 人格：Think/Act/Collaborate/Deliver、教师口语理解、不许本地规则说话 | P0 |
| `mochi-approval` | `ctx.waterfall('approval/request', …)` answerer | 三档分类：只读→`allowed-once`；CONFIRM→委派（Web 审批卡）；越权名单→`rejected`。**返回字符串枚举** | P0 |
| `mochi-jiaxinglian` | `ctx.tools` 注册 `jxl.*` 工具 | Organization Plugin：学生/流动/医务/消息/异常/统计查询与动作；scope 按角色 | P0(读)/P1(写) |
| `mochi-artifacts` | `ctx.tools` + 本地 `.artifacts` store | Artifact 注册/版本/预览/导出；artifact 作为任务输入（`13`） | P1 |
| `mochi-tools-ppt/doc/xlsx/pdf/file/calendar-task/comm` | `ctx.tools` | 教师办公工具族 38 个 P0（`12`，权威清单=plan/01 §1.2） | P1 |
| `mochi-memory` | 会话事件 + 本地 sqlite | Conversation/Working Memory + Teacher Profile；scope/TTL/隐私边界（`20`） | P1 |
| `mochi-relay` | `ctx.tools`（mochi.ask/mochi.find/mochi.respond） | 传话网络：语义对齐联动计划 Relay（人决定应答）；v1 单机模拟 | P1 |
| `mochi-dispatch` | 任务域 + `mochi_tasks` 表 | Mochi Dispatch v1：ASK/REQUEST/FIND/APPROVE 状态机（`14`/`15`） | P1 |
| `mochi-registry` | 结构化 capability registry | Agent Discovery：capability → agent 映射（`16`） | P2 |
| `mochi-chat-bridge` | client + 捕获适配器 | Browser Chat Bridge / Handoff Compiler（`24`/`25`） | P3 |
| `mochi-companion` | Secure Channel 协议 | 本地文件/桌面 App 执行边界（`26`） | P4（先桩） |

## 2. Profile 家族

| Profile | bundle | 用途 |
|---|---|---|
| `mochi` | `dsh-headless` + Mochi 插件 | CLI 单次验证（已存在） |
| `mochi-sdk` | `dsh-sdk-app` + Mochi 插件 | sidecar 长驻 JSON-RPC（已存在） |
| `mochi-web` | `dsh-web-app` + Mochi 插件 | **新增**：主交互 GUI（Electron WebView 加载官方 SPA） |

每个 profile：`cordis.patch.yml` 只做 ①挂载 Mochi 插件 ②遥测 `mode: DISABLED` ③权限预设
`workspace-write` ④glm-4-flash 经 `baseURL` 指向 OpenAI 兼容网关。不改其他条目。

## 3. 已验证的挂载事实（不要重新发明）

- 自定义插件挂载已跑通：`[Mochi] hello plugin loaded!`、`campus_query_student` 注册成功（AGENT_COMMS.md）。
- 审批 answerer 已跑通：`ctx.waterfall` + 返回 `'allowed-once'` 字符串（R-B1 实测）。
- 遥测关闭已实测：`mode: DISABLED` + 环境变量双保险（R-B2 实测）。
- headless 包挂 jsonrpc-server **不生效**；sidecar 必须走 sdk 入口（R-B3 实测）。

## 4. 禁止事项

- 禁止在插件里 `import` Harness 内核内部模块路径（只走官方 ctx 键与事件契约）。
- 禁止用插件绕过 `tools/pre-execute` 把关或审批瀑布。
- 禁止把 UI 逻辑放进 runtime 插件（UI 只在 client 插件/Electron 层）。
- 插件间通信只走事件与显式服务，不做 `mochi-core` 跨插件私有 import（列入 `33` 待闭合）。
