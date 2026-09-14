# 01 · Mochi Harness 真实能力审计（HARNESS_REALITY_AUDIT）

> 信息源：官方仓库源码 `dsh-v0.1.3-alpha.1`（commit d347e7039）+ `docs/` 官方文档 + 各包 README。
> 每条断言带仓库内路径。标注 ⚠️ 的为官方明示限制。仓库根：`Mochi/mochi-harness-src.nosync/mochi-harness/`。

## 1. 内核与组装模型

- **Cordis 一切皆插件**：模型适配器、工具注册表、会话日志、agent loop 本身全是插件；
  无特权内核，扩展 = 把插件挂到别的插件旁边，注册是可逆副作用（`docs/architecture.zh.md`）。
- **Profile / Bundle / Patch 三层组装**：profile 列 bundle 叠加顺序 + 自带 `cordis.patch.yml`；
  patch 按 `id` 定位条目**整体替换** config（不深合并），可 `insert` 新条目，支持 `!!js` 插值
  （`packages/boot/app-boot/README.md`）。`dsh --profile web --dump-config` 可打印生效配置树。
- **Bundle 清单**（`packages/bundle/README.md`）：`base`（模型+全工具+持久会话+默认策略）、
  `web-app`（浏览器 GUI）、`headless`（一次性运行）、`acp-app`（自动化 stdio）、
  `sdk-app`（SDK JSON-RPC stdio）、`sdk-minimal`（精简独立树）。

## 2. 运行能力清单（由哪个包提供）

| 能力 | 提供者 | ctx 键 / 工具 |
|---|---|---|
| 会话日志（仅追加事件流） | `packages/core/session` | `ctx.sessions`；事件含 turn/step/user/assistant/tool/* |
| 系统提示组装 | `packages/core/system-prompt` | `ctx.systemPrompt` |
| 工具注册与把关执行 | `packages/core/tools` | `ctx.tools`；waterfall `tools/pre-execute→execute→post-execute` |
| Agent 接口与循环 | `packages/core/agent`+`agent-loop` | `ctx.agents` / `ctx.agentLoop` |
| 模型适配 | `packages/llm/llm`+`llm-deepseek`+`llm-pi-ai` | `ctx.llm`；`ctx.llm.registerAdapter` |
| 文件 | `packages/fs` → `dsh-tool-fs` | `read/write/edit/read_image`、`str_replace_editor`、`glob/grep` |
| Shell/终端 | `packages/shell`/`subprocess`/`terminal` | `bash`/`pwsh`（含 persistent PTY、terminal_* 六件） |
| Web 搜索/抓取 | `packages/web/*` | `ctx.web`；`web_search`/`web_fetch`（exa/perplexity/deepseek 后端） |
| 子代理 | `packages/subagent/*` | in-process、fork、ACP、Codex、Claude Code、DSH-SDK 六种 provider |
| 任务/目标/计划 | `packages/todo`/`goal`/`plan` | `todo_write`、`create/get/update_goal`、`exit_plan_mode` |
| 后台作业 | `packages/jobs` | `ctx.jobs`；`job_list/job_output/job_kill` |
| 定时提醒 | `packages/schedule` | `schedule_create/list/delete`（session-local，间隔≥300s） |
| 技能 | `packages/skill/*` | skill catalog + `skill` 工具 + 用户 `/name` 直调 |
| 会话查询 | `packages/session-query` | `session_search/trace/event_read/event_search/event_trace` |
| 审批 | `packages/interaction/user-approval` | `ctx.approval.request` → `approval/request` waterfall |
| 权限预设 | `packages/interaction/permission-presets` | `workspace-write` / `danger-full-access` 两预设 |
| 沙箱 | `packages/sandbox/*` | `read-only`/`workspace-write`/`danger-full-access`（macOS Seatbelt） |
| 持久化会话 | `packages/session/session-persistence-jsonl` | JSONL 后端，支持 resume |
| 上下文压缩 | `packages/compaction/*` | compaction-basic / tool-result-pruner / command-compact |
| 循环卫生 | `packages/guard/*` | repeat-tool-reminder + timeout-policy（base 默认启用） |
| MCP | `packages/mcp/mcp-client` | 仅 client；仅桥接 Tools ⚠️ 不桥 Resources/Prompts |
| 遥测 | `packages/session/session-telemetry-otel` | 默认 `mode: DISABLED`，不出网（07 factcheck Q11） |

工具总量：约 24 个工具包、60+ 模型可见工具名（`docs/tool-catalog.md`）。

## 3. 审批契约（最关键 API，全部源码核实过）

- 路径：`packages/interaction/user-approval/src/index.ts:273` 用 `ctx.waterfall('approval/request', …)`；
  监听器契约 `@mode waterfall`，必须返回字符串枚举
  **`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`**（`types.ts:32`；返回对象会被归一为
  `unavailable` → fail-closed，上轮 Batch 2 踩过并已修正）。
- 会话策略仅两档：`ask`（默认，委派 answerer）/ `never`（确定性拒绝）。**没有 `auto` 预设**。
- ⚠️ 审批 payload **不带工具参数**（仅 agent/toolName/callId/reason/signal）→ 程序侧只能按工具名判定。
- ⚠️ 仅 one-shot grant；仅 open turn 内有效；无内置 answerer（headless 下 fail-closed）。
- Web 通道的 `packages/client/ui-approval` 可展示关联工具明细并回传决定（CONFIRM 弹窗免费拿）。
- ⚠️ SDK stdio 通道**不下发审批请求**（`packages/sdk/protocol/README.md`："Server→client requests
  are a dead capability"）→ 纯 SDK 驱动的 UI 拉不起人审。

## 4. 事件与扩展点（改动的第一决定）

- 三个事件域：会话事件（持久事实）、`agent/*`（活跃 Agent，观察/拦截进行中工作）、
  能力事件（`fs/*`、`tools/*`、`telemetry/*` 挂策略/适配器）。
- waterfall 事件：`agent/pre-step`、`agent/request`、`llm/stream`、`tools/*`；serial：`agent/turn-stopping`。
- 新模型可见输入 = 新增会话事件（`SessionEventMap`）；"模型可见即已记录"是不变量。
- 官方扩展映射表见 `docs/architecture.zh.md` "新行为的归属位置"（添加工具/模型/UI/命令/job 的正路）。

## 5. Web UI 与客户端插件树（皮肤迁移的落点）

- 客户端本身是 **Cordis 插件树**：`packages/client/web`（boot kernel）→ 逐个激活 client 插件 →
  `packages/client/ui-renderer` 挂载 React 应用（唯一 `renderSlot('root')`）。
- **Slot 系统**（`packages/client/ui-slots`）：`single`/`list`/`keyed`/`chain` 四种；
  真实 slot 名（grep 实证）：`root`、`conversation.view`、`conversation.chat.node`（keyed：
  user/assistant-step/tool/context/compaction/turn-error）、`conversation.composer`（chain）、
  `conversation.composer.dock`、`conversation.input.overlay`、`conversation.input.dock`、
  `conversation.hero.workspace`、`sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.workspaces`、
  `settings.general.item`、`settings.plugins.tab`。
- **样式体系**（`docs/web-styling.md`）：CSS 变量令牌 `--dsw-*`（`packages/client/ui-theme/src/styles/`）
  + 语义别名 + CSS Modules；**禁止字面色值、禁止 Tailwind、禁止组件库**；light/dark 由 ui-theme 拥有；
  0.5px hairline、superellipse 圆角、elevation shadow（`--dsw-elevation-panel/prominent/soft`）。
- Web UI 已有能力（`docs/user/guide/index.md`）：会话视图、模型/设置管理（Settings→Models 即时生效）、
  workspace 选择、审批确认卡、Trajectory（turn 级事件账本+检查器+搜索+分页）、插件管理页
  （`ui-settings-plugins`、`ui-settings-plugin-inventory`）、附件/上传/缩略图、Schedule 只读目录、
  plan/goal/subagent/workflow 的 UI 包。

## 6. 官方明示的硬限制（不可当作可修的 bug）

| # | 限制 | 出处 |
|---|---|---|
| L1 | Developer Preview，破坏性变更已实锤（rc.1 notes 多条） | `SAFETY.zh.md`、release notes |
| L2 | 审批不是安全边界，是"降低风险的便利闸门" | `SAFETY.zh.md:13` |
| L3 | 无跨设备/跨进程 Agent 原生通信总线 | `packages/mcp/README.md`、`subagent-acp/README.md` |
| L4 | `subagent-acp` 自动化无人环（permission 自动答） | `subagent-acp/README.md` |
| L5 | webserver 无 TLS/认证/同源策略，**只能绑 127.0.0.1** | `packages/host/webserver/README.md` |
| L6 | pi-ai 多 provider 一串限制（catalog 不自动刷新等） | `llm-pi-ai/README.md` |
| L7 | 官方 Developer Preview 期间不接受外部 PR | `CONTRIBUTING.md` |

## 7. 处置矩阵（哪些动、哪些不动）

| 处置 | 对象 |
|---|---|
| **原样保留（不可重写）** | Cordis 内核、agent loop、session 日志与持久化、审批 waterfall、sandbox、tools 执行流水线、ui-renderer/slots、ui-approval/ui-trajectory/ui-settings-* |
| **通过配置替换** | 模型 provider（glm-4-flash 等，经 `baseURL`/pi-ai）、permission preset、遥测开关、workspace |
| **通过插件扩展** | 嘉行联 org plugin（jxl.* 工具）、办公工具族（ppt/doc/xlsx/pdf）、审批 answerer、memory 插件、relay/dispatch 插件、skill 包 |
| **通过 client 插件/slot 扩展 UI** | 品牌位（sidebar.brand.*）、教师工作台页、chat node 渲染、settings 页签 |
| **通过 CSS 令牌桥换肤** | 全部 `--dsw-*` 语义别名 → 映射嘉行联 calm-tokens（见 `08`） |
| **禁止** | fork 内核改源码、绕过审批瀑布、把 UI 做成自绘聊天页、删除高级能力（Trajectory/Session/Plugins）后假装存在 |
