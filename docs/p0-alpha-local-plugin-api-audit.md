# MOCHI-P0-ALPHA — 本地插件 API 兼容预检

**状态：只读静态预检，未放行集成。** 本报告只覆盖 runtime profile 实际选择的 `dsh-better-sidebar`、`mochi-campus` 与 `mochi-dispatch`，用于把下一张兼容票收窄到已观测的本地类型/API 边界。它不改变任何插件、依赖、锁、profile、构建或 UI，也不构成 alpha 桌面启动、Electron、模型调用或真实校园网验证。

## 范围与固定输入

| 输入 | 已确认事实 |
| --- | --- |
| runtime profile | `apps/desktop/resources/mochi-web/runtime-profile.json` SHA-256 `29dd65aeb1278a9e9ac3dd8ed09be5105e0632b75f72954bc69cc1dbd16ba6e9` 实际指向 `plugins/dsh-better-sidebar`、`plugins/mochi-campus`、`plugins/mochi-dispatch`。 |
| 固定上游 | `mochi-harness-src.nosync/mochi-harness` HEAD 为 `d347e703908d0406b7a7ef80e3a0e594d86b2215`，版本 `0.1.3-alpha.1`；本次读取时 `git status --short` 无输出。 |
| 三个插件 manifest | SHA-256 分别为 sidebar `b7f5a3561156970c7d7c9054999257b847f1bcd0934532b541433c59e6696bf5`、campus `65f113a89fc2db0bd75ca482566adc8d731c035869909f3ee17fd88cb52b4e1a`、dispatch `a6eb315fc7e573206fae84b17a3fc803bf994ba2880b85a87a22c436c0d624d9`。 |
| 版本门槛 | 既有 [p0-alpha-plugin-version-contracts.md](../artifacts/architect-audit/p0-alpha-plugin-version-contracts.md) 已确认 15 条本地插件版本边不接受 `0.1.3-alpha.1`：sidebar 13 条、campus 1 条、dispatch 1 条。它们仍是独立的安装/解析前提，不能被本报告的 API 结果替代。 |

## 复用依据

本轮没有选择或接入新框架，沿用 [reuse-audit.md](reuse-audit.md#L130) 已实际执行的 GitHub 搜索：`GitHub DeepSeek Harness desktop agent framework build official release pack source`。已采用的完整框架是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，固定为上述 MIT 源提交；社区 `cloud-1104/deepseek-harness-desktop` 仅为检索命中，未用于本预检。该来源只提供待比对的固定源码，README 或同名导入均不作为兼容证据。

## 方法和可复核性

### 已实际执行的静态检查

检查使用已有 `plugins/dsh-better-sidebar/node_modules/typescript/lib/typescript.js` 的 Compiler API，并以 `node <<'NODE'` 运行内存中的脚本；没有落地脚本文件。两次均递归读取 sidebar `src/` 下 153 个 `.ts`、`.tsx`、`.d.ts` 根文件，读取现有 `tsconfig.json`，以 `noEmit: true` 创建 `ts.Program`，再只统计路径位于 `plugins/dsh-better-sidebar/src/` 的诊断。没有调用 `tsc`、pnpm、install、build、测试脚本或生成 `tsbuildinfo`。

| 比对 | 实际解析方式 | sidebar 生产源码诊断 |
| --- | --- | --- |
| 当前 RC 基线 | 仅使用插件现有 node_modules 的普通 module resolution | **0** |
| 固定 alpha 源映射 | 将下表的直接包名映射至 `d347e7039` 的 `src/index.ts`（`ui-settings/client` 映射至其 `src/client/index.ts`） | **5** |

alpha 源中的 `ui-primitives` 是 React/TSX 源码。为让其已读的 `Input`、`Button` 等声明得到正常上下文类型，alpha 映射检查额外只读加入其 `css-modules.d.ts`，并把 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`clsx` 映射到 sidebar 已有的声明文件。这消除了不完整源码图造成的 6 个 `event` 隐式 `any` 噪音；这些附加映射不代表生产依赖方案。

| 模块 specifier | 固定 alpha 源入口 |
| --- | --- |
| `@deepseek-ai/dsh-agent` | `packages/core/agent/src/index.ts` |
| `@deepseek-ai/dsh-client-locale` | `packages/client/locale/src/index.ts` |
| `@deepseek-ai/dsh-client-ui-conversation` | `packages/client/ui-conversation/src/index.ts` |
| `@deepseek-ai/dsh-client-ui-primitives` | `packages/client/ui-primitives/src/index.ts` |
| `@deepseek-ai/dsh-client-ui-settings` | `packages/client/ui-settings/src/index.ts` |
| `@deepseek-ai/dsh-client-ui-settings/client` | `packages/client/ui-settings/src/client/index.ts` |
| `@deepseek-ai/dsh-client-ui-slots` | `packages/client/ui-slots/src/index.ts` |
| `@deepseek-ai/dsh-host-webserver` | `packages/host/webserver/src/index.ts` |
| `@deepseek-ai/dsh-invariants` | `packages/runtime-diagnostics/invariants/src/index.ts` |
| `@deepseek-ai/dsh-llm` | `packages/llm/llm/src/index.ts` |
| `@deepseek-ai/dsh-session` | `packages/core/session/src/index.ts` |
| `@deepseek-ai/dsh-settings` | `packages/settings/settings/src/index.ts` |
| `@deepseek-ai/dsh-subagent` | `packages/subagent/subagent/src/index.ts` |
| `@deepseek-ai/dsh-tools` | `packages/core/tools/src/index.ts` |
| `@deepseek-ai/cordis` | `vendor/cordis/src/index.ts` |

这不是官方 packed `.d.ts` consumer 编译：固定源码树不含已构建的 `lib/types`，也未在本票安装/打包 alpha consumer。因此这 5 条是**固定源映射下的静态 API/类型边界证据**，不是已确认的发布产物编译失败或运行失败。

## 已确认的直接调用面

### mochi-campus 与 mochi-dispatch

两插件各只有一个 DeepSeek 导入：`defineTool`（campus [index.mjs](../plugins/mochi-campus/index.mjs#L1)、dispatch [index.mjs](../plugins/mochi-dispatch/index.mjs#L7)）。它们分别通过第 146 行和第 62 行的 `register` 包装调用，传入 `name`、`description`、原生 parameter schema、`output: { schema, render }` 与 async/Promise 返回的 `execute`。

固定 alpha 的 [`DefineToolOptions`](../mochi-harness-src.nosync/mochi-harness/packages/core/tools/src/schema.ts#L483) 要求的正是这些字段，[`defineTool`](../mochi-harness-src.nosync/mochi-harness/packages/core/tools/src/schema.ts#L545) 会把 parameter/value schema 规范化；同一固定源码的 [web search 工具](../mochi-harness-src.nosync/mochi-harness/packages/web/tool-web/src/search.ts#L323) 使用同样的 raw schema 与双参数 `render` 形式。

**已确认结论：** 没有发现 `defineTool` 导出缺失或这两个插件已使用参数/输出形状的直接不兼容。两插件是 JavaScript，故这不是它们的运行行为验证；HTTP、数据库、审批与 tool 执行结果均未运行。

### dsh-better-sidebar 的导入和调用

对 sidebar 153 个生产源码根文件做 AST 导入清点，并在固定 alpha 源映射的 TypeScript checker 中查询每个 module export，结果如下：

| 实际导入 | 已读调用/用途 | 固定 alpha 源结果 |
| --- | --- | --- |
| `dsh-tools`: `defineTool`、`ToolRunContext` | [`tools.ts`](../plugins/dsh-better-sidebar/src/tools.ts#L94)、[`agent-opens.ts`](../plugins/dsh-better-sidebar/src/agent-opens.ts#L204) | 两个导出存在；这些 `defineTool` 调用未产生直接参数诊断。 |
| `dsh-llm`: `createUserMessage`、`ContentBlock`、`UserMessage` | [`sidechat-routes.ts`](../plugins/dsh-better-sidebar/src/sidechat-routes.ts#L136) 与第 153 行 | 三个导出存在；alpha [`createUserMessage`](../mochi-harness-src.nosync/mochi-harness/packages/llm/llm/src/message.ts#L194) 接受该处使用的 `content` 与 `source` 输入。 |
| `dsh-agent`: `Agent`、`AgentSetup`、`CreateAgentOptions`、`ResumeAgentOptions` | Side Chat 创建/恢复路径 | 四个导出存在，源映射检查没有在这些 call site 报参数诊断。 |
| `dsh-subagent`: `snapshotSubagentDescriptor` | [`sidechat-routes.ts`](../plugins/dsh-better-sidebar/src/sidechat-routes.ts#L227) | 导出存在；固定 alpha continuable descriptor 接受 `mode`、`provider`、`label`、可选 `agentProvider`/`agentModel`。 |
| `dsh-session`: `SessionEvent`、`SessionId` | Side Chat seed 与 session 快照消费 | 导出存在；其事件实际类型引出下节的边界问题。 |
| `dsh-settings`: `SettingsConflictError` | [`index.ts`](../plugins/dsh-better-sidebar/src/index.ts#L586) 的 `instanceof` | 导出存在，class 仍保留该错误类型。 |
| `dsh-client-ui-primitives` | 50 个实际 value/type 名称，来自 27 个源码文件 | 50 个均能在固定 alpha 的 export map 中解析；[`index.ts`](../mochi-harness-src.nosync/mochi-harness/packages/client/ui-primitives/src/index.ts#L1) 仍 re-export primitives 和 icons。UI 视觉/交互未测试。 |
| `dsh-client-ui-slots`: `PropsRuntime`；`dsh-client-ui-settings/client` 空 type import；`cordis`: `Context` | UI props 与本地 `Context` 定义 | 入口/子路径均存在；`Context` 的 host/client 服务合并是下节问题的来源。 |

`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-host-webserver`、`dsh-invariants` 是 sidebar 的 manifest peer 边，但本次生产源码没有从它们直接 import 符号。因此不能仅凭 manifest 或同名包声称其 API 兼容或不兼容。`schemastery` 是普通 unscoped 依赖供应问题，已在既有版本契约报告中限定为常规 dependency resolution，不在本报告中被称为 alpha 全局缺包。

## 固定源映射下的 5 条类型/API 边界诊断

| 位置 | 诊断 | 已确认原因 | 结论边界 |
| --- | --- | --- | --- |
| [`SideChatView.tsx:635`](../plugins/dsh-better-sidebar/src/client/SideChatView.tsx#L635)、[`:639`](../plugins/dsh-better-sidebar/src/client/SideChatView.tsx#L639) | `Session` 不能传给 `binding`/`open` 的 `string` 参数 | sidebar 的 [`Context = CordisContext & SidebarContextShape`](../plugins/dsh-better-sidebar/src/context-types.ts#L574) 把本地 client mirror 与 alpha `dsh-session` 对 Cordis 的 `sessions: SessionStore` augmentation 放入同一类型图；此时 `fork` 选到 host [`SessionStore.fork(...): Session`](../mochi-harness-src.nosync/mochi-harness/packages/core/session/src/index.ts#L1176)。 | 这是 **Context 类型面冲突**。固定 alpha 的实际 client [`ISessions.fork(...): Promise<SessionId>`](../mochi-harness-src.nosync/mochi-harness/packages/api/session-controller/src/client/contract/sessions.ts#L97) 仍返回 session id，故不能写成“alpha 改变了 SideChat fork 运行行为”。 |
| [`index.ts:499`](../plugins/dsh-better-sidebar/src/index.ts#L499) | `readonly SessionEvent[]` 不可赋给 `readonly SidebarSessionEvent[]` | 本地镜像把 `data` 固定成 `Record<string, unknown>`（[`context-types.ts:186`](../plugins/dsh-better-sidebar/src/context-types.ts#L186)），而固定 alpha [`SessionEvent`](../mochi-harness-src.nosync/mochi-harness/packages/core/session/src/types.ts#L447) 是按 `SessionEventMap[K]` 的 union；例如 `user/message` 是 `UserMessage`。 | 必须在共享事件边界作显式适配或重审镜像类型，不能把该 union 当作任意 record。 |
| [`jobs-routes.ts:215`](../plugins/dsh-better-sidebar/src/jobs-routes.ts#L215) | `SessionEvent` 不能传给 `traceOf(SidebarSessionEvent)` | 同一 `data` 结构不满足。 | 与前项同一根因。 |
| [`subagent-live-route.ts:80`](../plugins/dsh-better-sidebar/src/subagent-live-route.ts#L80) | `readonly SessionEvent[]` 不能传给 `lastActivity(readonly SidebarSessionEvent[])` | 同一 `data` 结构不满足。 | 与前项同一根因。 |

当前 RC 基线的插件源诊断为 0；alpha 源映射为上表 5 条。另一方面，现有 RC `dsh-session` 声明也定义 `SessionEvent.data` 为 `SessionEventMap[K]`，所以本票**不能确认这是 alpha 版本语义变化**；它可能是当前解析图没有同时暴露 host/client Cordis augmentation 与本地 structural mirror 的既有类型债务。只有真实隔离 alpha packed consumer 的 `.d.ts` 编译才能确认该结论是否在发布产物中复现。

## 下一张兼容票的最小范围

这是需要主控作出的局部类型边界选择，不是本票要实现的架构决定：

1. 将 sidebar host `SessionStore` 与 client `ISessions` 的使用面在本地共享 `context-types.ts` 边界明确分开，避免 `CordisContext` 交集让 client SideChat 的 `fork` 被静态选为 host `SessionStore.fork`。范围可停在共用 context/facade 与两个调用点，不需要改 SideChat UI 行为。
2. 为真实 `SessionEvent` 建立显式、可验证的 sidebar event 适配/消费契约，或收窄三处消费者的输入类型；必须逐类处理 `data`，不能用无边界 cast 把 `SessionEvent` 当作 `Record<string, unknown>`。
3. 上述两项完成前，15 条 manifest range mismatch 仍需在隔离 alpha consumer 中解决和验证；15 条不是 15 处源码手改清单。

现有可复用验证命令（**本票未执行**，应只在隔离 alpha consumer 已准备好后运行）为：

```sh
pnpm --dir plugins/dsh-better-sidebar typecheck
pnpm --dir plugins/dsh-better-sidebar check:consumer-types
pnpm --dir plugins/dsh-better-sidebar test
(cd plugins/mochi-campus && node test.mjs)
(cd plugins/mochi-dispatch && node test.mjs)
```

这些命令仍不足以验证 desktop/Electron、HTTP/模型、Windows 或校园网；它们只应作为修改后插件类型与单元行为的第一层验证。

## 未验证事项

- 未编译/安装固定 alpha 的官方 packed `.d.ts` consumer，未启动 profile，也未运行任何插件 test、build 或 pnpm 命令。
- 未验证 `dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-host-webserver`、`dsh-invariants` 的运行 API，因为本地 sidebar 生产源码没有直接符号调用。
- 没有从“导出存在”推导 React UI、Side Chat、tool、网络、Electron 或模型行为兼容。
