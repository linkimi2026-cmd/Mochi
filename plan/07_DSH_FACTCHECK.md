# dsh 事实核查报告（07_DSH_FACTCHECK）

> 核查员：dsh 事实核查员 ｜ 项目：嘉行联 · Mochi
> 核查日期：2026-09-04
> 信息源优先级：本地源码（最高） → GitHub/npm（交叉验证） → 官方文档

---

## 0. 先说最重要的三件事（请先读）

1. **版本不一致，且本地快照比 npm 发布版更新。**
   - 本地源码快照版本：`0.1.3-alpha.1`（见 `package.json` 第 3 行 `@deepseek-ai/dsh-root`）。
   - npm 最新发布版：`@deepseek-ai/dsh@0.1.2-rc.1`（2026-09-03 发布，见 https://www.npmjs.com/package/@deepseek-ai/dsh）。
   - **结论：你手上的本地源码来自 `master` HEAD，比项目锁定的 `0.1.2-rc.1` 还要新。** 本报告的证据以本地 `0.1.3-alpha.1` 为主；凡是 rc.1 之后才出现的行为，我都标注了。Mochi 若 `npm i @deepseek-ai/dsh@0.1.2-rc.1` 锁定，会拿到**比我描述更旧**的代码。

2. **官方定性：dsh 是“实验性开发者预览”，未做安全审计，不可视为生产软件。**
   - 出处：`SAFETY.zh.md` 第 7 行「Mochi Harness 是实验性的开发者预览软件……不得视为安全或可用于生产环境的软件」；第 13 行「沙箱、审批提示与权限控制可以降低风险，但不保证隔离，也不能保证防止损害」。
   - 这正是 Q5/Q6 的关键约束：**审批/权限是“降低风险的便利闸门”，不是安全边界。** Mochi 不能把 dsh 的 approval 当硬隔离来依赖。

3. **破坏性变更是真实发生过的，不是吓唬。** rc.1 的 release notes 本身就列了多条 breaking change（见 Q9）。所以 Q9 结论：风险高，必须锁版本。

---

## A. 桌面 APP 集成（Q1–Q4）

### Q1. `dsh --profile sdk` 的 JSON-RPC 通道怎么用？

**结论（确定）：** `dsh --profile sdk` 在 **stdio 上跑 newline-delimited JSON-RPC 2.0**。客户端规范类型共 **3 个请求 + 4 个通知**；官方提供了 TypeScript 客户端（`@deepseek-ai/dsh-sdk-client`），可直接 spawn 子进程驱动。

**证据：**

- 启动命令：`dsh --profile sdk`（见 `packages/bundle/sdk-app/README.md`；npm 页 `Entry modes` 表也确认 `dsh --profile sdk` = Serve SDK clients over JSON-RPC stdio）。
- 传输与消息类型清单（`packages/sdk/protocol/README.md`）：
  - client→server 请求：`initialize`（`InitializeParams→InitializeResult`）、`session/prompt`（`SessionPromptParams→SessionPromptResult`，返回入队回执 `messageId`）、`shutdown`（无参→`{}`）。
  - server→client 通知：`session.event`、`session.status`（整体 `running`/`idle`）、`subagent.started`、`subagent.finished`（仅 in-process 子进程）。
  - 帧规则：`id+method`=请求，`id`=响应，`method`=通知；非法行忽略；无 handler 回 `-32601`，handler 抛错回 `-32603`。
- TypeScript 客户端最小示例（`packages/sdk/client/README.md`）：

  ```ts
  import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
  import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

  await using harness = new DeepSeekHarness({
    profile: 'sdk',
    patches: ['./automation.cordis.yml'],
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: ReasoningEffortId('max'),
    maxTokens: 49_152,
  })
  const result = await harness.run('say hi')
  console.log(result.finalResponse)   // { sessionId, finalResponse, events, notifications }
  ```
  - 底层 `HarnessClient` 提供 `start()/initialize()/prompt()/request()/close()` 与 `subscribe(filter?)`/`subscribeSessionTree(id)`。
  - 源码：`packages/sdk/client/src/api.ts`、`packages/sdk/client/src/client.ts`、`packages/sdk/protocol/src/transport.ts`、`packages/sdk/protocol/src/types.ts`。
- Python 也有对等的 SDK 客户端（`python/README.md`），讲同一套协议。

**对 Mochi 的影响：** 桌面 APP 的「主进程 spawn `dsh --profile sdk` 子进程」这条路完全成立，客户端代码骨架官方已给好。但要注意下面 Q5 的致命约束：这条 stdio 通道**目前没有审批请求**（server→client 请求是 dead capability），所以纯 SDK 通道驱动时，human approval 拉不起来。

---

### Q2. 除了 stdio JSON-RPC，还有别的驱动方式吗？

**结论（确定）：** 有，**第二条是 Web/API 通道（HTTP + WebSocket）**，由 `dsh --profile web` 暴露。还有第三条 ACP stdio（`dsh --profile acp`，给自动化客户端）。`api/` 那一组（gateway / session-controller / settings-controller / workspace-controller）就是给 **Web 前端用的 Host 端 Remote 服务**，不是给外部独立进程直接用的独立 HTTP 服务。

**证据：**

- 通道清单（npm `Entry modes` 表）：
  - `dsh --profile web` → 浏览器 GUI（HTTP + WebSocket 升级）。
  - `dsh --profile sdk` / `sdk-minimal` → SDK stdio JSON-RPC。
  - `dsh --profile acp` → ACP stdio，服务自动化客户端。
  - `dsh --profile headless "job"` → 一次性跑完退出。
- Web 通道技术：`packages/api/gateway/README.md` 描述 `TypertGatewayService`（`ctx.typertGateway`），客户端走 `ctx.remote`，连接 open `/api` 的 FetchHandler，**并开一个 `/api/remote.mux` WebSocket** 用于多路 Remote 流（心跳 2s）。即「HTTP 一元调用 + WebSocket 流」双通道。
- Webserver 本身（`packages/host/webserver/README.md`）：`node:http` 服务，支持 `registerUpgrade`（WebSocket 升级路由），`host` 只接受 `127.0.0.1` 或 `0.0.0.0`（默认 loopback，**绑定 `0.0.0.0` 需显式且服务器无 TLS/认证/同源策略**）。
- `api/` 各 controller 是 Web 前端的 Host 侧 Remote 贡献（`packages/api/remotes/README.md` 把 Commands/credentials/settings/Session/Workspace 等能力选出来 forward 给客户端）。**它们不是独立对外 REST 服务的“别的驱动方式”，而是 web 通道的内部实现。**

**对 Mochi 的影响：** 桌面架构有两个可选项：
- 方案 X（推荐）：Electron 主进程 spawn `dsh --profile web`，前端用 dsh 自带的 Web SPA（见 Q4），通过 `file://` + IPC bridge 通信（`packages/host/webserver/README.md` 明说「Electron loads dist over `file://` and carries fetch over an IPC bridge」）。这条路**自带审批 UI**。
- 方案 Y：Electron 主进程 spawn `dsh --profile sdk`，自己用 TS SDK 客户端写 UI。这条路**没有审批 UI，须自实现 answerer（见 Q5/Q6）**。

---

### Q3. dsh runtime 怎么随桌面 APP 分发？原生依赖？Node ≥22.19？

**结论（确定）：** dsh 以 **npm 包 `@deepseek-ai/dsh` 分发**，运行时是一个 Node 应用（不是静态二进制）。原生依赖**只有 Linux 的 `landlock-run`（沙箱）走预编译 per-platform 包**，macOS 用 Seatbelt、Windows 用 ACL（无额外原生 addon）。Node 引擎要求 `^22.19.0 || >=24.0.0`（`package.json` `engines`）。官方**无专门 Electron 打包指南**，但有「profile + bundle 分层」的分发模型，理论上可整包塞进 Electron 的额外 Node 子进程。

**证据：**

- 分发单元：npm 页「The `dsh` command is the sole supported Node application launcher」；bundles 从 dsh 安装里解析：`@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-headless`、`dsh-sdk-app`、`dsh-sdk-minimal`、`dsh-acp-app`（`apps/cli/README` 经 npm 页引用）。即装 `@deepseek-ai/dsh` 会带这些 bundle 子包。
- 引擎要求：`package.json` 第 8–11 行 `"engines": { "node": "^22.19.0 || >=24.0.0" }`。
- 原生依赖：`native/landlock-run/README.md` —— `@deepseek-ai/node-addon-landlock-run`，仅 `linux-x64` / `linux-arm64`（Landlock 是 Linux 内核特性），**其他平台故意不发包**，探测到 `unusable` 时 fail-closed（即不强制沙箱）。macOS/Windows 的沙箱后端见 `packages/sandbox/README.md`：`sandbox-local` 用 Linux(bwrap→Landlock) / **macOS Seatbelt** / Windows restricted token；Windows 写限制另由 `sandbox-windows-acl` 提供。**Seatbelt 是 macOS 内置框架，无需额外编译产物。**
- 前端产物：web-app 的前端是构建好的 SPA，发布包应带 dist（`packages/bundle/web-app/README.md` 说源码 checkout 要先 `pnpm run build`，但发布 npm 包带预构建 dist，否则启动会提示 build hint）。
- Electron/Node 版本坑：rc.1 release notes 提到「Fix startup failures and broken HMR on Node.js 24.0–24.11.1」——说明 Node 24 早期小版本有启动问题，需避开。

**对 Mochi 的影响（关键）：**
- **别用 Electron 自带的 Node 跑 dsh。** Electron 内置 Node 版本往往 < 22.19。正确做法：在 Electron 里把 dsh 当作**独立子进程**，用你额外打包的 **Node ≥ 22.19**（或 Electron 版本足够新、其内置 Node ≥ 22.19）来 spawn `dsh`。SDK 设计本就是「spawn 子进程」（见 Q1），天然解耦。
- 体积：本地无 `node_modules`（未 install），无法给精确体积；但依赖含 `@earendil-works/pi-ai`（多 provider 适配库）等，体量不轻。建议比赛前实测 `npm i @deepseek-ai/dsh` 安装体积并评估 Electron `extraResources` 打包。
- 原生模块只在 Linux 需要；macOS/Windows 无原生 addon，打包更省心，但意味着**这两端的 OS 级沙箱隔离较弱**（Seatbelt 仅在 macOS 有，且官方声明“不保证隔离”）。

---

### Q4. 自定义 UI 接 dsh，官方推荐路径到底是什么？

**结论（确定）：** 官方**没有“自定义前端”独立文档**。唯一成型的参考前端是 **`dsh --profile web` 自带的 Web SPA**（`packages/bundle/web-app` + `packages/client/*` 这套 React-free 的 Cordis client 包）。官方给 Electron 的暗示路径是：**把该 SPA 的 dist 用 `file://` 加载，fetch 走 IPC bridge**（见 `packages/host/webserver/README.md`）。想完全自写 UI，就走 TS SDK 客户端（见 Q1），但那等于离开官方前端、自己重建审批/会话/设置等全部 UI。

**证据：**

- web-app bundle：`packages/bundle/web-app/README.md`，启动即开浏览器 GUI（对话、模型/设置管理、会话历史），token 启动 URL 做鉴权。
- 前端构成：`packages/host/frontend-static/README.md`（SPA dist 服务）、`packages/client/*`（UI 包，含 `ui-approval`、`ui-conversation`、`ui-settings-*` 等，React-free）。
- Electron 路径原文：`packages/host/webserver/README.md` 末段「Electron loads dist over `file://` and carries fetch over an IPC bridge」。
- 配置组合：`packages/bundle/web-app/cordis.patch.yml` 是 web 专用 patch；`bundle/base` 是共享核心。即「base bundle + web patch + 前端」三层。
- 未查到任何 `custom frontend` / `custom UI` 指南（已在 `docs`、`packages/host` 全量 grep，无命中）。

**对 Mochi 的影响：** 对高中生比赛项目，**最稳路径 = 方案 X（Q2）**：Electron 里 spawn `dsh --profile web`，直接复用官方 SPA（含审批 UI、会话、设置、模型选择）。只在「外观/品牌」层做轻量定制（前端是 React-free 的 Cordis client 包，可 fork 改样式，但成本高）。**不要从零自写 UI**——会丢失审批 UI 且重复造轮子。

---

## B. Human Approval 与权限（Q5–Q6）

### Q5. `interaction/user-approval` 的完整机制？能否自定义展示内容？

**结论（确定，含重大限制）：**
- 机制：敏感工具在**回合内（open turn）**调用 `ctx.approval.request(req)` → 走 `approval/request` 瀑布 answerer → 返回 `allowed-once` / `rejected` / `cancelled` / `unavailable`（fail-closed）。会话级策略 `ask`（默认，委派 answerer）/ `never`（确定性拒绝）。
- **能显示“具体内容”吗？分两层看，结论不一致：**
  - **内置 Web 审批 UI（`packages/client/ui-approval`）确实能展示“关联的工具明细”**——它「optionally renders correlated Tool detail」并把决定回传给等待的 Host 请求。底层是因为工具调用（含参数）已写入 session 日志，UI 可 correlate。所以**在 web 通道下，用户能看到 Agent 准备做什么（工具名+参数）并选 allow-once / reject**。
  - **但审批请求的 payload 本身不带工具参数。** `packages/interaction/user-approval/README.md` 明确写：「The request carries no tool arguments — an answerer sees the tool name, reason, and optional call id」。即**你写的自定义 answerer（程序侧）只能看到 工具名 + reason + callId，看不到参数**。
  - 所以「必须显示 Agent 准备做什么」在 web UI 里可行（靠 UI correlate 日志），但**想用程序自动判断“越权”则拿不到参数**，只能按工具名判断。

**证据：**

- `packages/interaction/user-approval/README.md`：answerer 是 `approval/request` 瀑布监听器；`policy: ask|never`；「The request carries no tool arguments」；「No built-in answerer —— headless 或未完整组合时 resolve `unavailable` 并 fail-closed」；「Only one-shot grants exist —— 无 allow-always、无记忆规则、无撤销」；「Requests are valid only inside an open turn」。
- `packages/client/ui-approval/README.md`：「Browser approval presentation over the Agent-scoped Remote Event waterfall…… optionally renders correlated Tool detail…… returns the user's decision」；限制「panel exposes transient decisions only —— allow-once and reject」。
- `packages/interaction/tool-ask-user/README.md`：另有 `ask_user_question` 工具（模型主动向人提问，走 Remote Events 由 Web client 回答），与 approval 是两回事。

**对 Mochi 的影响（直说风险）：**
- ✅ “显示 Agent 准备做什么 + 让用户确认/拒绝”：用 `dsh --profile web` + 内置 `ui-approval` 即可满足，**不用自己造**。
- ⚠️ 若走纯 SDK 自写 UI（方案 Y）：**审批请求目前根本不下发到 SDK 通道**（见 Q1 协议：server→client 请求是 dead capability，协议 README 写「Server→client requests are a dead capability … Python SDK's responder surface exists for future approval flows」）。即**方案 Y 下 human approval 暂时拉不起来**，必须自写 in-process answerer + 自定义通道把决定送回 UI，工程量很大。
- ⚠️ approval 只给 allow-once，无“本次会话内记住”/“按参数放行”。Mochi 要的「只读 AUTO、危险 CONFIRM、越权 DENY」需要自写 answerer（见 Q6），且越权只能按工具名判断（无参数）。

---

### Q6. 工具级权限控制怎么做？能针对单个工具设“需审批”吗？

**结论（确定）：** dsh **没有声明式的“每工具 AUTO/CONFIRM/DENY 策略表”**。现有机制是：
1. 会话级两旋钮：`sandbox mode`（workspace-write / danger-full-access）+ `approval policy`（ask / never），由 `permission-presets` 打包成预设（`workspace-write` = workspace-write+ask；`danger-full-access` = danger-full-access+never）。
2. 任何“敏感工具”自己调用 `ctx.approval.request()` 进入审批瀑布；**你想对单个工具做精细策略，唯一正路是写一个自定义 `approval/request` answerer**（瀑布监听器），按工具名返回 allow/reject。
3. `guard/` 家族**不是权限系统**——它是 loop-hygiene（重复工具调用提醒 `repeat-tool-reminder` + 工具超时 `timeout-policy`）。`hooks/` 是兼容 Claude Code / Codex 的外部 hook 导入，也不是工具级策略引擎。

**证据：**

- `packages/interaction/permission-presets/README.md`：预设表把 sandbox mode + approval policy 打包；「Only two mechanism knobs are bundled」；「`custom` is derived-only」；「preset table is process-level」。
- `packages/interaction/user-approval/README.md`：answerer 瀑布契约；可写终端 answerer 决定 allow/reject/cancel。`agent-scoped` 监听器只收该 agent 的请求。
- `packages/guard/README.md`：仅 `repeat-tool-reminder` + `timeout-policy`，「ship enabled in dsh base bundle」。
- `packages/hooks/README.md`（组）：子包 `hooks-claude-code` / `hooks-codex` / `hook-protocol` —— 导入外部 hook，非策略引擎。

**对 Mochi 的影响（实现方案）：** Mochi 的三档策略**可行但需自己写一个小 answerer 插件**：
- 只读工具（如 fs 读、搜索）：answerer 直接返回 `allowed-once`（自动放行）。
- 危险工具（发消息、删文件）：answerer 不自动决定，交给内置 `ui-approval` 弹窗让用户 CONFIRM/REJECT。
- 越权工具（不在白名单的工具名）：answerer 返回 `rejected`（DENY）。
- 限制：分类维度只有**工具名**（无参数），所以“按参数越权”做不了；且 answerer 跑在 runtime 内，须经 Cordis 插件开发（有门槛，但官方 answerer 契约清晰）。

---

## C. A2A 与多 Agent（Q7–Q8）

### Q7. `subagent-acp` 的“automation-only”限制在哪？需要对方人类批准行不行？

**结论（确定）：** `subagent-acp` 是**全进程隔离的自动化后端**，每个委派 spawn 一个全新子进程跑 ACP agent；其**子进程的审批提示由配置自动回答**（`permission: allow | reject`），**绝不把人类拉进循环**。所以「需要对方人类批准」用 ACP 不行——只能 `reject`（自动拒绝）或 `allow`（自动放行首个选项）。

**证据：**

- `packages/subagent/subagent-acp/README.md`：「permission prompts are auto-answered by configuration, so no human is needed」「The parent receives only the child's final answer or a safe error —— no intermediate messages or tool traffic crosses the boundary」。
- 配置项 `permission: reject`（默认）| `allow`；「Only committed `agent_message_chunk` text is collected」；「No optional start-time capabilities」（不支持 agentOptions / persona / toolFilter / 结构化输出 / 深度上限，会直接 reject）。
- `packages/subagent/tool-subagent/README.md`：ACP / Codex / Claude Code 后端**拒绝** `agentOptions`（即子 agent 的模型选择等），只有 in-process 与 DSH SDK 后端支持。

**对 Mochi 的影响：** 若 Mochi 的多 agent 需要“对方人类批准”，不能用 `subagent-acp`（它自动化、无人在环）。要在环内审批，应让子 agent 走 **in-process 后端**（`subagent-spawn-in-process` / `subagent-fork-in-process`），共享父 runtime 的 approval answerer（即父会话的 `ui-approval` 弹窗）。或者用 `tool-subagent` 的 `continuable` 模式做后台可对话子 agent。

---

### Q8. dsh 有没有原生“跨设备/跨进程 Agent 间通信”？mcp 是 client 还是 server？

**结论（确定）：**
- **跨进程 Agent 通信**：有，靠 **ACP**（Agent Client Protocol）`dsh --profile acp` 服务自动化客户端，或 `subagent-acp` 委派。但这是**自动化、无人在环**（见 Q7），且只支持本地 workspace（`cwd` 同机），**不支持远程 workspace**。
- **跨设备/原生消息总线**：**没有**。官方无跨设备 Agent 通信原语。
- **MCP**：dsh **只做 MCP client**（`packages/mcp/mcp-client`），把外部 MCP server 的工具当原生工具用；**不做 MCP server**（不能把 dsh 暴露成 MCP server）。MCP 只桥接 Tools，不桥 Resources/Prompts。

**证据：**

- `packages/mcp/README.md`：「attaches an external server … its tools are available to the model as native tools」「Only the Tools capability is bridged: MCP resources and prompts are not supported」。
- `packages/subagent/subagent-acp/README.md`：「Local workspaces only —— remote workspace mapping is not designed」。
- npm `Entry modes`：`dsh --profile acp` = Serve automation clients over ACP stdio。

**对 Mochi 的影响（直说）：** 如果 Mochi 的设计是“多台设备/多个 dsh 实例互相派活 + 需要人类在对方侧批准”，**dsh 原生不支持，必须自建**：
- 选项 a：把对方 dsh 跑成 `dsh --profile acp`，Mochi 自己写 ACP client 去派活（但对方审批只能 auto-allow/auto-reject，人类不在环）。
- 选项 b：用 MCP —— 把对方能力包装成 MCP server，本机 dsh 当 client 调用（仍同机/同网络，无人在环审批）。
- 选项 c（若真要跨设备 + 人类批准）：在对方侧也跑 `dsh --profile web`，通过 web 通道的 `ui-approval` 让对方人类批准——但这等于两套 Web 实例，需要 Mochi 自己做编排/发现层。**这是比赛里最该降级或简化的部分。**

---

## D. 稳定性与风险（Q9–Q12）

### Q9. Developer Preview 的 breaking change 风险多大？官方生产表态？

**结论（确定，高风险）：** 风险**高且已被证实**。官方明确定性为“实验性、未安全审计、非生产软件”（`SAFETY.zh.md`）。rc.1 的 release notes 本身就有多条破坏性变更。**强烈建议锁死版本 + 比赛前冻结不动。**

**证据（rc.1 release notes 实锤的 breaking change）：**

- 「Complete the migration from the legacy ApiProxy interface to the `@Remote` gateway and remove ApiProxy」—— API 层重写的破坏性变更。
- 「Remove the optional SQLite Session persistence backend」—— 会话持久化后端被删（旧数据不删，但要用旧版导出）。
- 「Replace `Session.events` with on-demand read APIs: `seq`, `eventAt()`, and `snapshotEvents()`」—— 会话读取 API 破坏性变更。
- 「Improve SQLite read, write, and fork performance … the storage format is incompatible」—— 存储格式不兼容。
- 「Fix an issue where upgrading from `0.1.1-rc.2` or `0.1.2-alpha.3` could prevent the app from starting or make session titles disappear」—— 升级会搞挂启动/丢数据。
- 「Fix startup failures and broken HMR on Node.js 24.0–24.11.1」—— Node 版本敏感。
- 开发者预览声明（`README.zh.md` 第 13 行）：「未来将出现破坏兼容性的变更」；官方**不接受外部 PR**（Developer Preview 期间，见 `CONTRIBUTING.md` 与 README 社区说明）。

**对 Mochi 的影响：** 26 天比赛窗口内**不要升级 dsh**。锁 `0.1.2-rc.1`（或你本地 `0.1.3-alpha.1` 的某次 commit），把所有依赖钉死，记录 `pnpm-lock.yaml` 哈希。把“dsh 可能变”写进风险页。

---

### Q10. 已知重大 bug / 限制？Known Limitations 在哪？

**结论（确定）：** dsh **没有集中式 “Known Limitations” 文档**，限制分散在每个包的 README 末尾 `Known Limitations and Deferred Work` 一节。按你关心的维度汇总如下（均为官方原文）：

**证据与汇总：**

- **稳定性 / 升级**：见 Q9（rc.1 升级可致启动失败、丢会话标题、存储格式不兼容）。
- **会话 / 上下文压缩**：有 compaction 能力（`packages/compaction/*`：`compaction-basic`、`compaction-tool-result-pruner`、`command-compact`），但**无集中“已知限制”章节**；长会话靠 compaction，具体行为需实测。
- **SDK 通道限制（影响桌面方案 Y）**：
  - `packages/sdk/protocol/README.md`：「No protocol-version negotiation」「No cancel or session-close methods」「Server→client requests are a dead capability（审批流是 future work）」。
  - `packages/sdk/client/README.md`：「No mid-turn cancel」「No per-prompt result」「Client→server notifications and server→client requests are unimplemented」。
- **审批限制（影响 Q5/Q6）**：`packages/interaction/user-approval/README.md`：「请求不带工具参数」「仅 one-shot grant」「仅 open turn 内有效」「无内置 answerer」。
- **子 agent 限制**：`packages/subagent/subagent-acp/README.md`：「fresh process per run（无池化）」「Local workspaces only」「No optional start-time capabilities」「permission auto-answered」。
- **多 provider / 本地模型**：`packages/llm/llm-pi-ai/README.md` 列出一长串限制（catalog 不自动刷新、设置层不能删 provider、Anthropic 发现最多 1000 模型、路由单协议等）。
- **遥测 / 数据出域**：见 Q11（默认 DISABLED，但导出模式会带完整事件数据，需自挂脱敏规则）。
- **Webserver**：`packages/host/webserver/README.md`「No server-wide TLS, authentication, or origin policy」—— 绑非 loopback 即暴露无保护路由。

**对 Mochi 的影响：** 比赛 Demo 前把上面几条逐一实测：长会话会不会 OOM、审批弹窗时机、compaction 后上下文是否丢失、SDK 取消是否卡死。最该防的是**升级破坏**和**Webserver 勿绑 0.0.0.0**。

---

### Q11. 离线能力与本地运行？遥测怎么关干净？

**结论（确定）：** dsh **除调 LLM 外可完全离线**。遥测**默认就是关闭的**（`session-telemetry-otel` 默认 `mode: DISABLED`），只要不挂该插件/不开 FULL 就不出网。没有发现 license check / update check（已 grep 全仓，仅在 `llm` 适配层有“强制匿名用户归因头”发往 LLM provider）。

**证据：**

- `packages/session/session-telemetry-otel/README.md`：「`DISABLED`（the default）constructs nothing and shares nothing」「Uploading modes compose the OTel JS SDK … `mode: FULL` hands every record to the OTel SDK immediately」。即**默认不出任何遥测**。要开必须显式 `mode: FULL` + 给 `exporter.url`。
- `packages/session/session-telemetry/README.md`：「ships no rules」「with no listener mounted, records reach the backend exactly as captured」—— 默认不挂后端=无遥测。
- 归因头：`packages/llm/llm-deepseek/README.md` 提及「Mandatory app attribution headers」「the stable anonymous user id outside model input」—— 即**每次 LLM 请求都带一个匿名 user id 给 DeepSeek**（非本地校验，是归因头）。这是唯一“默认出网但非遥测”的东西。
- grep 全仓 `telemetry|otel|license|updateCheck|analytics`：命中都在 `session-telemetry*` 与归因相关，无 license/update 校验逻辑。

**对 Mochi 的影响：** 离线比赛环境可行（断网只影响 LLM 调用，需自备可达的 endpoint，如本地 vLLM/Ollama 经 pi-ai 网关，见 Q12）。**遥测关法**：不安装/不挂载 `session-telemetry-otel`，或在配置里确保 `mode: DISABLED`（默认即如此）。若要绝对干净，可在构建里排除该包。注意：匿名归因头仍会随 LLM 请求发出——若比赛要求零外联，需自托管 LLM 网关并确认该头不含敏感信息（官方说它不含凭据）。

---

### Q12. 模型适配器扩展点？能否自定义 provider / 三档路由？

**结论（确定）：**
- **内置 provider**：`deepseek-official`（`dsh-llm-deepseek`，支持 `baseURL` 指向 OpenAI 兼容网关）+ `pi-ai` 多 provider 适配（`dsh-llm-pi-ai`，支持 openai-completions / openai-responses / anthropic-messages 及**手声明网关**）。
- **接本地模型 / 自建网关**：可行，用 `llm-pi-ai` 声明一个 `api: openai-completions` + `baseURL` 指向你的本地 server（Ollama/vLLM/LM Studio 都行）。官方 Web 表单「Add a custom provider」就是干这个（`docs/user/guide/providers.md`）。
- **自定义 provider 插件**：扩展点是 `ctx.llm` 服务——写一个 Cordis 插件注册 adapter（`packages/llm/llm/README.md` 的 `ctx.llm`）。没有“拖一个 YAML 就能加 provider”的 SDK，但 pi-ai 的 hand-declared gateway 已覆盖绝大多数 OpenAI 兼容场景，无需写代码。
- **三档路由（simple/complex/tool-heavy）**：**不是内置功能**。根 agent 没有路由器。可近似实现：用 `tool-subagent` 的 `continuable`/模型选择把不同难度的子任务派给不同模型（`packages/subagent/tool-subagent/README.md` 支持 `modelSelectionSettings`）；或在自定义 provider adapter 里按请求特征路由（需写代码）。

**证据：**

- `packages/llm/README.md`：`llm-deepseek`（deepseek-official）、`llm-pi-ai`（多 provider + 手声明网关）、`llm`（ctx.llm 中立服务）、`llm-retry`、`token-meter`。
- `packages/llm/llm-deepseek/README.md`：`baseURL` 可选，默认 `https://api.deepseek.com`，`$DEEPSEEK_BASE_URL` 优先；支持 OpenAI 兼容网关。
- `packages/llm/llm-pi-ai/README.md`：`providers` 字典，手声明 `api: openai-completions` + `baseURL` + `models` 即可接任意 OpenAI 兼容网关；`compat` 开关修正请求形状。
- `docs/user/guide/providers.md`：「Add a custom provider … API protocol must be … openai-completions / openai-responses / anthropic-messages」。
- `packages/subagent/tool-subagent/README.md`：`modelSelectionSettings`、`agentOptions`、`persona`、`toolFilter`、`maxDepth`—— 子 agent 可选模型/路由。

**对 Mochi 的影响：** 本地模型 / 三档路由**完全可做**：用 pi-ai 网关指向本地 LLM 服务即可零代码接本地模型；三档路由建议用「主 agent + 按难度 `tool-subagent` 派发到不同模型」实现，比自写 router 稳。注意 pi-ai 对网关请求形状的 compat 调校较多（developer role、maxTokens 字段等，见 providers.md 排错表），本地网关要对照调。

---

## 引用 URL / 文件清单

**本地源码（最高优先级，路径前缀 `/Users/a1379/Documents/Mochi/mochi-harness-src.nosync/mochi-harness-master/`）**
- `package.json`（版本 `0.1.3-alpha.1`、engines Node ≥22.19）
- `README.zh.md`、`SAFETY.zh.md`
- `packages/sdk/protocol/README.md`、`packages/sdk/client/README.md`、`packages/sdk/client/src/{api,client}.ts`
- `packages/bundle/sdk-app/README.md`、`packages/bundle/web-app/README.md`
- `packages/host/webserver/README.md`、`packages/host/frontend-static/README.md`
- `packages/api/gateway/README.md`、`packages/api/remotes/README.md`
- `packages/interaction/user-approval/README.md`、`packages/interaction/permission-presets/README.md`、`packages/interaction/tool-ask-user/README.md`、`packages/client/ui-approval/README.md`
- `packages/guard/README.md`、`packages/hooks/README.md`
- `packages/mcp/README.md`、`packages/subagent/subagent-acp/README.md`、`packages/subagent/tool-subagent/README.md`
- `packages/llm/README.md`、`packages/llm/llm-deepseek/README.md`、`packages/llm/llm-pi-ai/README.md`
- `packages/session/session-telemetry/README.md`、`packages/session/session-telemetry-otel/README.md`
- `packages/sandbox/README.md`、`native/landlock-run/README.md`
- `docs/user/guide/providers.md`

**GitHub / npm（交叉验证）**
- 最新发布：`https://github.com/deepseek-ai/mochi-harness/releases` —— 最新 `v0.1.2-rc.1`（2026-09-03），含多条 breaking change 与 SAFETY 更新。
- npm 包：`https://www.npmjs.com/package/@deepseek-ai/dsh` —— `0.1.2-rc.1`，profile 清单，bundles 解析顺序。
- 仓库：`https://github.com/deepseek-ai/mochi-harness`
- 文档站：`https://mochi-harness.github.io/mochi-harness/`

**本地 vs GitHub 差异（必读）**
- 本地快照 `0.1.3-alpha.1`（master HEAD）**比** npm 发布 `0.1.2-rc.1` **新**。本报告证据多来自更新的 master；若 Mochi 锁 `0.1.2-rc.1`，部分行为可能略有出入，但 Q9 列出的 breaking change 均属 rc.1 本身，确定性高。

---

## 一句话总评（给比赛用）

dsh 能圆 Mochi 的桌面 APP + Human Approval 核心需求，但**前提是走 `dsh --profile web` + Electron 嵌入官方 SPA（自带审批 UI）**，而不是从零自写 UI；**审批只给“allow-once / reject”且程序侧看不到工具参数**，所以“越权 DENY”只能按工具名做；**A2A 跨设备 + 对方人类批准 dsh 原生不支持，必须自建或降级**；最大风险是 **Developer Preview 的破坏性变更 + 官方声明“不保证隔离/非生产软件”**——比赛窗口内务必锁版本、勿升级、勿把 dsh 当安全边界。
