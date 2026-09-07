# 09 · Mochi 模型切换系统设计（一等公民）

> 读者是审核官。凡 dsh 能力描述，一律附**源码出处**（`文件:行号` + 关键片段）。无源码支撑处标 `TO_BE_RESOLVED_BY_CODEX`，不编造 API 名 / 配置字段 / 路径。
> 现实约束贯穿全文：**高中生 / 26 天 / 零付费 / 比赛现场不能翻车 → 稳定优先；模型切换是一等公民，不是硬编码。**
> 配套文档：本设计与 `08_DESKTOP_APP_ARCHITECTURE.md` 的 `DemoHarnessClient`、双模型兜底、凭据存储保持一致。

---

## 0. 结论速览（先给拍板结论）

| 项 | 结论 |
|---|---|
| dsh 原生切换能力 | 模型是 **per-request 的 `provider`+`model`**（`llm/types.ts:407`）；默认来自 `agent-default-model` 设置（`core/agent-default-model/src/index.ts:90`）；**SDK 通道的 model 在 `initialize` 时定死为进程级**（`sdk/server/src/server.ts:162-166,282-287`）。 |
| 加自定义 provider | **0 行代码、1 个 YAML 条目**：写 `llm-pi-ai.providers`（通用多厂商适配器，源码 `llm/llm-pi-ai/src/index.ts`）。仅"全新私有协议"才需写 `LlmAdapter` 插件。 |
| Mochi 切换交互 | 设置面板 / 球旁常驻 chip 的**模型选择器**（picker），列出全部可用模型 + 人话档位 + 免费/额度提示；点击即切。对标 Codex `/model`（`developer-commands` 文档已查实）。 |
| 切换作用域 | **全局默认**（持久化，下次启动生效）+ **当前会话**（本次对话生效，下条消息起用新模型）。手动 > 自动。 |
| 切模型代价 | SDK 约束下 = **重建 dsh harness**（dispose + 用新 `provider`/`model` 重新 `initialize`）。正在进行的 turn 被中止，已收 transcript 保留在 Mochi UI，新模型用于下一条。 |
| 教师傻瓜式 | 默认**不出现**模型选择；Mochi 自动选（标准档）。高级用户/评委在设置里一键展开"模型与密钥"。 |
| 三档路由 | simple→更快档 / complex→标准档 / tool-heavy→更强档，全部基于**实测 100% 工具调用率**的免费模型。手动覆盖优先。 |
| 双模型热备（纠正 08） | 主 `glm-4-flash`；限流 429/1305 时轮换 `glm-4.5-air` → `glm-5.3-flash`（三者均免费且 100% 工具调用）。**`glm-4.7-flash` 限流更狠（22%），不当备份**（实测表）。 |
| 凭据安全 | key **绝不进 LLM**。存 `DSH_HOME/.credentials.yaml`（0600），按 `apiKeyEnv` 的 env 名寻址；主进程边界持有，renderer 只见掩码。可选升级系统钥匙串。 |

---

## 1. dsh 原生模型层机制（实测源码结论）

### 1.1 provider 路由 + 适配器注册

- dsh 用**字符串路由键**（如 `'deepseek-official'`）区分厂商；一个适配器可注册多个路由：`ctx.llm.registerAdapter(providers: string[], adapter)`（`packages/llm/llm/src/index.ts:384`）。
- 适配器抽象类 `LlmAdapter`（`packages/llm/llm/src/index.ts:197`）：必须实现 `stream(options)`，可选 `providerInfo` / `listModels` / `resolveModel` / `prepareCall`。`options.provider` 选路由，`options.model` 选模型（`types.ts:407-443`）。
- 已装载的 provider 包（实测 `packages/llm/`）：
  - `llm-deepseek` → 注册路由 `'deepseek-official'`，直连 OpenAI 兼容网关，自带 Files API / thinking / 图像（`llm/llm-deepseek/src/index.ts:90,471,476`）。
  - `llm-pi-ai` → **通用多厂商适配器**，把任意 `openai-completions` / `openai-responses` / `anthropic-messages` 端点变成路由（实测 `llm/llm-pi-ai/src/index.ts` + `provider.ts:47`）。
  - 另有 `deepseek-llm-api-extensions` / `llm-retry` / `token-meter`（能力增强，非 provider）。

### 1.2 模型选择的三层

| 层 | 机制 | 源码 |
|---|---|---|
| per-request | `GenerateOptions.provider` + `GenerateOptions.model`（每次调用都带） | `llm/types.ts:407` |
| 全局默认 | `agent-default-model` 插件：`ctx.agentDefaultModel.currentSelection()` 返回 `{provider,model,reasoningEffort?}`；`saveSelection()` 写设置 | `core/agent-default-model/src/index.ts:90,100` |
| 可配置目录 | `ctx.llm.registerConfigurableProviders([{provider, displayName, settingsNs, settingsPath, declared?}])` 让配置面能增删厂商 | `llm/index.ts:478`；类型 `llm/types.ts:218` |

- dsh 自身 web/CLI 的"模型切换" = 写 `agent-default-model` 设置段（web Models 页写入，`deepseek/index.ts:448` 注释证实 "the web Models page writes it"）。**dsh 无 per-turn、per-session 的模型覆盖 API**——模型只在"每次请求"或"全局默认"两层存在。

### 1.3 SDK 通道的模型传递（已核实用户引述的"SDK 初始化请求"原话）

- `InitializeParams` 确含 `provider` / `model` / `reasoningEffort?` / `maxTokens?` / `cwd`（`packages/sdk/protocol/src/types.ts:16-27`）。原话"Provider/model and workspace cwd arrive through the SDK initialization request"**属实**。
- **但**：SDK server 把 `provider`/`model` 存为**进程级**字段（`server.ts:77-80,162-166`），并在 `createSession` 时写入每个 SDK agent 的 `agentOptions`（`server.ts:282-287`）。`session/prompt` **只带 `sessionId` + `contentBlocks`，不带模型**（`protocol/types.ts:36`）。
- **结论**：走 `dsh --profile sdk`/`mochi` 时，**模型在 `initialize` 时定死，整个进程内所有会话共享同一模型；切换模型必须 `shutdown` + 重新 `initialize`（或重建 `DeepSeekHarness`）**。这是 Mochi 切换设计的硬约束，下文据此设计。

### 1.4 设置热加载（改配置不必重启）

- `llm-deepseek` 与 `llm-pi-ai` 都通过 `ctx.inject(['settings'], settingsCtx => settingsCtx.settings.installSection(ctx, NS, Config, config, {setSource, onChange}))` 安装设置段；`onChange` 里重解析连接事实 / 重注册路由（`deepseek/index.ts:490-497`；`pi-ai/index.ts:296-331`）。
- 即：**改 `settings.yaml` 的 `baseURL`/`models`/`key` 指向，下一次请求即生效，无需重启进程**（注释原文 `deepseek/index.ts:5-10`）。但 provider 路由集合变化（新增厂商）需 `ensureRegistrationFacts()` 重注册——热加载会触发，但为规避时序，Mochi 统一用"写设置 + 重建 harness"保证一致。

### 1.5 凭据来源（绝不让 LLM 看到 key）

- 凭据接缝 `ctx.credentials`：抽象服务，方法 `resolve(ref)` / `set(ref, value)` / `unset` / `describe` / `readRecord` / `listRecords`（`packages/credentials/credentials/src/index.ts:170-257`）。
- 来源分层：本地 provider 用 `env` / `file` / `project-env` / `user-env`（`credentials/types.ts:121` 注释原文）。`ref` 是 POSIX 环境变量名（`credentialRef`，如 `DEEPSEEK_API_KEY`）。
- 适配器解析 key：`ctx.credentials.resolve(ref)` 命中则返回；否则回退进程环境（`launchEnvironmentOf(ctx).get(ref)`）；都没有 → 抛 `MISSING_CREDENTIAL`（`deepseek/index.ts:430-451`；`pi-ai/index.ts:169-192`）。**key 在快照内解析，绝不以明文进日志/UI**（`llm/index.ts:144-159` `assertUsableApiKey` 注释）。
- 写入：`ctx.credentials.set(ref, value)` 写进 provider 托管的可写源（即 `.credentials.yaml`，0600）。Mochi 主进程直接写该文件即可（Mochi 持有 `DSH_HOME`）。

### 1.6 自定义 provider 的原生扩展点（用户最看重）

- **首选（OpenAI 兼容 / Anthropic / Responses）**：`llm-pi-ai` 通用适配器。在 `settings.yaml` 的 `llm-pi-ai.providers` 下加一个条目即可，无需写代码（详见 §3）。支持协议表 `'openai-completions' | 'openai-responses' | 'anthropic-messages'`（`llm-llm-pi-ai/src/provider.ts:47-51`）。
- **最低层（全新私有协议）**：实现 `@deepseek-ai/dsh-llm` 的 `LlmAdapter` 抽象类（`llm/index.ts:197`），调用 `ctx.llm.registerAdapter([provider], adapter)`，可选 `ctx.llm.registerConfigurableProviders([...])`。这是 dsh 真正的"自定义适配器"扩展点。

### 1.7 dsh 没有 `/model` 命令（命令系统事实）

- dsh 有命令系统 `@deepseek-ai/dsh-commands`（`CommandInvocation` / `CommandResult`），插件 `inject: ['commands', ...]`；已存在命令：`/goal`、`/plan`、`/compact`、`/experimental`、`/status`（实测 `goal/command-goal/src/index.ts:7,13` + Codex 文档对照）。
- **无 `/model` 命令**。若将来要在 dsh 自己的 REPL 里加 `/model`，做法是写一个 `command-model` 插件实现 `commands` 接口并调用 `ctx.agentDefaultModel.saveSelection(...)`。但 Mochi 是桌面 APP、经 SDK 驱动，**模型切换是 Mochi UI 层职责**，不应依赖 dsh REPL 命令。

---

## 2. Mochi 模型切换系统设计（对标 Codex `/model`）

### 2.1 Codex `/model` 实测行为（WebSearch 已查实）

| Codex 行为 | 来源 |
|---|---|
| `/model` 在 TUI 内弹 picker，列出完整目录；选后**对本次会话余下部分生效**，对话上下文保留 | `developers.openai.com/codex/developer-commands`（"Set the active model with /model … Codex confirms the new model in the transcript"） |
| picker 同时设 reasoning level（low/medium/high） | 同上 + `ima.qq.com` 截图说明 |
| `/status` 显示当前 model / 审批策略 / 剩余上下文 | `developer-commands` |
| 启动即指定：`codex -m <model>` / `--model`；持久默认写 `config.toml` 的 `model =` | `claw.aguidetocloud.com/openai/codex-cli/models` |
| 切换 mid-session 上下文向前带，新模型可基于前文继续 | `getmaxim.ai` "The /model command … instant mid-session switch. The conversation context carries forward" |

### 2.2 Mochi 的切换交互（首选方案）

- **入口**：renderer 设置面板「模型与密钥」卡片（圆角矩形，符合视觉红线）+ 球旁**常驻模型 chip**（显示当前模型人话名，点击展开 picker）。二者调同一 `ipc.switchModel(selection)`。
- **picker 内容**（每个模型一行）：人话名（如"标准 · 智谱 GLM-4-Flash"）+ 厂商 + 免费/付费标 + 工具调用率/健康度 + 容量（contextWindow）。参考 Codex picker 同时列模型+reasoning level。
- **切换动作**：`switchModel` → 主进程写 Mochi 持久选择（SQLite）+ 重建 `DeepSeekHarness`（`provider`/`model`/`reasoningEffort` 用新值）→ `initialize` 成功 → UI 把 chip 改成新名、toast「已切换至 X」。
- **当前模型可见性**：球旁 chip 常显；设置面板高亮当前；`/status` 类比用 Mochi 自己的状态栏（顶部细条）显示"当前：标准 · GLM-4-Flash · 免费"。

### 2.3 切换作用域（四段式）

**首选方案：双作用域（全局默认 + 当前会话）**
- **理由**：教师/评委既要"这次对话用强模型"，也要"以后默认都用它"。Codex 也是"本次会话生效 + config.toml 持久默认"双轨。
- **全局默认**：存 Mochi SQLite `user.defaultModel`；下次启动 / 新建会话用它；同时回写 dsh `agent-default-model` 段（保证 dsh 自身面一致）。
- **当前会话**：本次对话绑定一个 model；新建对话可选"沿用默认"或"本次指定"。
- **备选方案**：仅全局默认（实现简单，但评委想临时试评委自带 key 时不便）→ 不采用。
- **切换条件**：若 26 天内 picker 联动重建 harness 出稳定性问题，先降级为"仅全局默认 + 重启生效"，但首版按双作用域做。

### 2.4 切换后正在进行的任务（SDK 约束下的处理）

- **事实**：SDK 模型进程级定死（`server.ts:162-166`）。重建 harness 会丢 dsh 进程内会话。
- **处理**：
  1. 若当前有 in-flight turn：主进程 `harness.close()`（或 `shutdown`）中止它，UI 提示「模型切换中，上一条已中断」。
  2. 已流式收到的 transcript **留在 Mochi renderer**（Mochi 自己缓存事件流），不丢。
  3. 新 harness `initialize` 完成，新 model 用于**下一条用户消息**。
  4. 不自动重发上一条——避免重复执行工具/副作用；由用户决定重发。
- **为什么不做 per-turn 多进程路由**：维持多个 dsh sidecar 保活成本过高，超出 26 天高中生项目承受；且 Codex 自身也是会话级切换，非逐 turn。明确记录为 dsh SDK 限制，非 Mochi 缺陷。

### 2.5 与 Codex 对比

| 维度 | Codex `/model` | Mochi 模型切换 |
|---|---|---|
| 触发 | TUI `/model` + picker | 设置面板 + 球旁 chip picker |
|---|---|---|
| 生效范围 | 本次会话余下 | 当前会话（下条起）+ 全局默认可选 |
|---|---|---|
| 上下文 | 向前带 | transcript 留 Mochi，新会话续聊 |
|---|---|---|
| 当前可见 | `/status` + footer | 常驻 chip + 状态条 |
|---|---|---|
| 持久默认 | `config.toml model=` | SQLite `user.defaultModel` + 回写 dsh |
|---|---|---|
| 加厂商 | `~/.codex/config.toml` + base_url | `llm-pi-ai.providers`（YAML，0 代码） |
|---|---|---|
| 限流兜底 | 无内建 | 双模型热备（§6） |

---

## 3. 自定义 provider 接入规范（"加入自定义就可以了"）

### 3.1 provider 注册表（两层，单一事实源）

- **实现层（dsh 读）**：`DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers`（OpenAI 兼容/Anthropic/Responses）与 `llm-deepseek.models`（deepseek 路由的模型清单）。这是 dsh 实际加载的注册表。
- **呈现层（Mochi 读，仅 UI 用）**：`DSH_HOME/mochi-models.json`，键 `provider/model` → `{ tier: 'faster'|'standard'|'stronger', free: bool, costHint: string, humanName: string }`。dsh 设置不携带"档位/费用"元数据，故 Mochi 补一层。
- **同步**：Mochi 增删厂商时，先改 `settings.yaml`（`llm-pi-ai.providers`）再改 `mochi-models.json`，然后重建 harness。Mochi 的 picker 由这两层合并生成。

### 3.2 最小示例：加一个 OpenAI 兼容厂商（DeepSeek 官方 / Kimi / 通义 / Ollama）

**只加 1 个 YAML 条目，0 行代码。** 以 Kimi 为例（`settings.yaml`）：

```yaml
llm-pi-ai:
  providers:
    kimi:                       # provider 路由键（自定义，全局唯一）
      displayName: Kimi 月之暗面
      api: openai-completions   # 协议：OpenAI 兼容 chat/completions
      baseURL: https://api.moonshot.cn/v1
      apiKeyEnv: KIMI_API_KEY   # 凭据按此 env 名寻址
      models:
        - id: moonshot-v1-8k    # 线模型 id（网关接受的值）
          name: Kimi 8K
          contextWindow: 128000
```

- DeepSeek 官方：`api: openai-completions` + `baseURL: https://api.deepseek.com` + `apiKeyEnv: DEEPSEEK_API_KEY`，`models: [{id: deepseek-chat}, {id: deepseek-reasoner}]`。
- 通义千问：`baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1` + `apiKeyEnv: QWEN_API_KEY`，`models: [{id: qwen-plus}]`。
- 本地 Ollama：`baseURL: http://localhost:11434/v1` + `apiKeyEnv: OLLAMA_KEY`（本地可任意/空），`models: [{id: qwen2.5}]`。
- 机理：`llm-pi-ai` 把每条 `providers` 变成路由，热加载即注册（`pi-ai/index.ts:121-141,271-294`）；`openai-completions` 协议见 `provider.ts:47-51`。

### 3.3 非 OpenAI 兼容（Claude 原生 / Gemini）

**首选：Claude 用 `anthropic-messages` 协议（原生，0 代码）**
```yaml
llm-pi-ai:
  providers:
    claude:
      displayName: Claude (Anthropic)
      api: anthropic-messages      # pi-ai 内置协议，原生支持
      baseURL: https://api.anthropic.com
      apiKeyEnv: ANTHROPIC_API_KEY
      models:
        - id: claude-sonnet-4-5
          contextWindow: 200000
```
- `anthropic-messages` 在 `provider.ts:47-51` 协议表内，可用。

**Gemini（四段式）**
- **首选**：走 Gemini 的 OpenAI 兼容端点（`base_url` + `api: openai-completions`），同 §3.2 模式。理由：pi-ai 协议表**没有** `gemini` 协议（`provider.ts:47-51` 仅 `openai-completions/openai-responses/anthropic-messages`），原生 Gemini 协议不在内置范围。
- **备选**：真要原生 Gemini 协议 → 写新 `LlmAdapter` 插件（§1.6 最低层扩展点），成本远高于 YAML。
- **切换条件**：仅当评委坚持"原生 Gemini 协议而非兼容端点"且兼容端点不满足时才写插件；否则一律兼容端点。

**写新适配器插件（仅全新私有协议）**：实现 `LlmAdapter`（`llm/index.ts:197`），`ctx.llm.registerAdapter(['my-provider'], adapter)`，可选 `registerConfigurableProviders`。这是 dsh 真扩展点，但**普通加厂商不需要**。

### 3.4 凭据安全存储（绝不进 LLM）

- **首选**：Mochi 主进程写 `DSH_HOME/.credentials.yaml`（0600），键为 `apiKeyEnv` 指定的 env 名（如 `KIMI_API_KEY: <key>`）。dsh 凭据接缝 `resolve(ref)` 读它（`credentials/index.ts:170`）；renderer 只见掩码 `****`。理由：沿用 dsh 约定（08 文档 §6.3 已定），主进程是唯一信任边界。
- **备选/增强**：用系统钥匙串（`keytar` → Mac Keychain / Win Credential Manager），启动时不落盘明文；但 `keytar` 需原生编译，列为"有空再做"，首版用 0600 文件 + 掩码，UI 明确告知"本地明文"。
- **绝不做**：key 不进 renderer、不进 Mochi SQLite 明文、不进任何 prompt/日志。dsh 的 `assertUsableApiKey` 已保证 key 不进日志（`llm/index.ts:144-159`）。
- **切换条件**：若比赛机器预置且评委自带 key 仅当场用，首版 0600 文件足够；若做长期多用户分发再上钥匙串。

---

## 4. 教师傻瓜式体验（"提前配置好，AI 智能判断后直接可用"）

### 4.1 默认不让老师选模型

- 首启默认 `agent-default-model` = `deepseek-official` / `glm-4-flash`（免费、100% 工具调用、当前在用）。老师**看不到模型选择器**，只看到球和工作流。
- Mochi 自动选：新会话按三档路由（§5）选模型；老师无感。

### 4.2 人话档位（老师视角）

- picker / 设置里**不显示** `glm-4-flash` 这种型号，显示人话：
  - **更快**（轻量快速，简单任务）→ `glm-4-flash`（免费）
  - **标准**（默认主力，多数任务）→ `glm-4.5-air`（免费）〔注：当前在用是 4-flash，默认档位可保留 4-flash；4.5-air 作为"标准/更强"候选，见 §5〕
  - **更强**（复杂/难任务）→ `glm-5.3-flash`（免费）
- 映射 + 免费/付费标 + 容量来自 `mochi-models.json`（§3.1）。评委/信息老师可在同一面板展开"高级"看到真实 `provider/model` 与自定义厂商。

### 4.3 没配 key 的首启动引导（不报错）

- 首启若 `agent-default-model` 指向的路由无 key：dsh 抛 `MISSING_CREDENTIAL`（`deepseek/index.ts:446`）。Mochi **拦截该错误**，不报错崩，而是：
  1. 免费档（智谱 GLM）已内置 baseURL + 试用额度 → 直接可用，零配置。
  2. 若连免费网关也不通（断网）→ 自动进演示模式（§6.2），并提示"联网后可用真实模型"。
  3. 想用自己 key 的评委：设置面板「模型与密钥」填 provider + key，提交即写 `.credentials.yaml`，无需重启（热加载 + 重建 harness）。

---

## 5. 三档路由（自动 + 手动覆盖）

### 5.1 关系：手动 > 自动

- **手动选择优先**：用户/评委在 picker 选了模型 → 该会话锁死该模型，自动路由不干预。
- **未手动选 → 自动路由**：Mochi 按任务分类选档（轻启发式：消息长度/是否含附件/是否明确要求"深度"/工具密集度），映射到更快/标准/更强。
- 自动路由是"默认智能"，手动是"覆盖"。二者不冲突：手动即覆盖自动。

### 5.2 三档映射（基于实测表）

| 档 | 触发 | 模型（免费，实测工具调用率） |
|---|---|---|
| 更快（simple） | 简单问答/格式化/短任务 | `glm-4-flash`（100%） |
| 标准（complex，默认） | 多数办公任务 | `glm-4.5-air`（100%）〔或保留 `glm-4-flash` 为默认〕 |
| 更强（tool-heavy / 难） | 复杂推理/多工具链 | `glm-5.3-flash`（100%） |

- 实测表：4-flash / 4.5-air / 5.3-flash 均 **100% 工具调用、免费**；4.7-flash 仅 22%（限流 code 1305）。故三档只用前三者。

### 5.3 健康度 / 限流感知（路由不盲选）

- 路由不只看档位，还看**健康度**：某模型近 N turn 出现 429/1305 → 该档临时降级到同档次另一免费模型，并提示"X 限流，已切 Y"。
- 这就把"双模型热备"下沉为路由的健康度维度：免费三模型互为热备，不依赖 4.7-flash。

---

## 6. 比赛演示兜底（与 08 一致并纠正）

### 6.1 双模型热备（纠正 08 的错误假设）

- **纠正**：08 文档 §7.2 把 `glm-4.7-flash` 当兜底，但实测其工具调用率仅 22%、限流 code 1305——**它比主模型更易限流，不宜作备份**。
- **首选**：主 `glm-4-flash`；遇 429/1305 → 轮换 `glm-4.5-air` → `glm-5.3-flash`（三者免费且 100% 工具调用，互为热备）。理由：实测数据；免费无成本。
- 机制：Mochi 主进程监听 SDK 事件/prompt 结果的 `RATE_LIMIT`/`QUOTA_EXCEEDED` 错误码（`llm/index.ts` 错误码体系，`deepseek/index.ts:332-343` `httpErrorCode` 映射），中止当前 turn → 重建 harness 用备用模型 → 提示"限流，已切 X"→ 用户重发（或 Mochi 在单 turn 重试时自动重发上一条，因无副作用风险由 Mochi 决策）。
- **备选**：若三个免费全限流 → 转演示模式（§6.2）或提示"模型暂不可用，稍后重试"，不静默卡死。
- **切换条件**：评委自带付费 key（DeepSeek/智谱/其他）时，热备池加入该付费模型，优先级按"免费优先、付费兜底"。

### 6.2 演示模式（与 08 §7.3 一致）

- `DemoHarnessClient` 实现与真实 `HarnessClient` **同接口**（`start/initialize/prompt/subscribe/close` + `subscribeSessionTree`，见 08 §2.1、§7.3）。
- 触发：网络错 / LLM 连续失败 / 手动开。模型切换 UI 在演示模式下禁用（演示用预录模型），但 picker 仍可"退出演示切真实"。
- 预录 fixture 覆盖 3–5 个教师场景（同 08 §7.3），球的 `thinking/speaking/success` 动画与真实态一致。

### 6.3 评委自带 key 的切换流程

1. 评委在设置「模型与密钥」选厂商（或 Mochi 预设 DeepSeek/智谱/其他）+ 填 key。
2. Mochi 写 `.credentials.yaml`（`apiKeyEnv` 对应名）+ 若厂商未注册则写 `llm-pi-ai.providers` 条目。
3. 重建 harness，`initialize(provider=评委厂商, model=评委选的模型)`。
4. 热备池加入该模型（§6.1）。评委当场体验"自己的 key + Mochi 工作流"。
5. 演示结束恢复默认免费档（不残留他人 key 在 UI 提示，但 key 文件保留，由评委自行清除）。

---

## 7. 落地清单

### 7.1 要改 / 新建的文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `DSH_HOME/settings.yaml` | 改 | 加 `llm-pi-ai` 段 + `providers`；`agent-default-model` 默认 `glm-4-flash`；`llm-deepseek` 指向智谱（沿用现有） |
| `DSH_HOME/mochi-models.json` | 新建 | 人话档位/免费/容量元数据，键 `provider/model` |
| `apps/desktop/src/main/modelSwitch.ts` | 新建 | Mochi 模型切换编排：读注册表、写设置、重建 harness、限流热备 |
| `apps/desktop/src/main/credentialVault.ts` | 改（08 已有） | 写 `.credentials.yaml`，按 `apiKeyEnv` 名寻址 |
| `apps/desktop/src/preload/api.ts` | 改 | 暴露 `switchModel` / `listModels` / `setProvider` / `getStatus` 白名单 IPC |
| `apps/desktop/src/renderer/ModelPicker.tsx` | 新建 | 模型选择器（圆角、人话档位、免费标、健康度） |
| `apps/desktop/src/renderer/ModelChip.tsx` | 新建 | 球旁常驻当前模型 chip |
| `apps/desktop/src/renderer/SettingsModels.tsx` | 新建/改 | 「模型与密钥」卡片（含自定义厂商表单、首启动引导） |
| Mochi `mochi` profile（cordis.patch.yml） | 改 | **必须挂载 `@deepseek-ai/dsh-llm-pi-ai` 插件**（08 原 profile 只提 `llm-deepseek`，自定义厂商需 pi-ai） |

### 7.2 完整配置示例（粘贴即可跑）

`DSH_HOME/settings.yaml`：

```yaml
# —— 默认模型（agent-default-model 命名空间）——
agent-default-model:
  provider: deepseek-official
  model: glm-4-flash
  reasoningEffort: off

# —— deepseek-official 路由：baseURL 重定向到智谱 OpenAI 兼容网关 ——
llm-deepseek:
  apiKeyEnv: ZHIPU_API_KEY
  baseURL: https://open.bigmodel.cn/api/paas/v4
  thinking: disabled
  reasoningEffort: off
  models:
    - id: glm-4-flash
      name: 智谱 GLM-4-Flash
      description: 免费 · 快 · 工具调用稳定（当前默认）
    - id: glm-4.5-air
      name: 智谱 GLM-4.5-Air
      description: 免费 · 强
    - id: glm-5.3-flash
      name: 智谱 GLM-5.3-Flash
      description: 免费 · 最强
    - id: glm-4.7-flash
      name: 智谱 GLM-4.7-Flash
      description: 免费 · 限流频繁（不作备份）

# —— 自定义 provider 注册表（通用多厂商适配器，0 代码）——
llm-pi-ai:
  providers:
    deepseek-official-2:
      displayName: DeepSeek 官方
      api: openai-completions
      baseURL: https://api.deepseek.com
      apiKeyEnv: DEEPSEEK_API_KEY
      models:
        - id: deepseek-chat
          name: DeepSeek-V3
          contextWindow: 64000
        - id: deepseek-reasoner
          name: DeepSeek-R1
          contextWindow: 64000
    kimi:
      displayName: Kimi 月之暗面
      api: openai-completions
      baseURL: https://api.moonshot.cn/v1
      apiKeyEnv: KIMI_API_KEY
      models:
        - id: moonshot-v1-8k
          name: Kimi 8K
          contextWindow: 128000
    qwen:
      displayName: 通义千问
      api: openai-completions
      baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
      apiKeyEnv: QWEN_API_KEY
      models:
        - id: qwen-plus
          name: 通义千问 Plus
    ollama:
      displayName: 本地 Ollama
      api: openai-completions
      baseURL: http://localhost:11434/v1
      apiKeyEnv: OLLAMA_KEY
      models:
        - id: qwen2.5
          name: 本地 Qwen2.5
    claude:
      displayName: Claude (Anthropic)
      api: anthropic-messages
      baseURL: https://api.anthropic.com
      apiKeyEnv: ANTHROPIC_API_KEY
      models:
        - id: claude-sonnet-4-5
          contextWindow: 200000
```

`DSH_HOME/mochi-models.json`（呈现层，仅 UI）：

```json
{
  "deepseek-official/glm-4-flash":  { "tier": "faster",  "free": true,  "costHint": "免费", "humanName": "更快 · 智谱 GLM-4-Flash" },
  "deepseek-official/glm-4.5-air":  { "tier": "standard","free": true,  "costHint": "免费", "humanName": "标准 · 智谱 GLM-4.5-Air" },
  "deepseek-official/glm-5.3-flash": { "tier": "stronger","free": true, "costHint": "免费", "humanName": "更强 · 智谱 GLM-5.3-Flash" },
  "deepseek-official-2/deepseek-chat":   { "tier": "standard", "free": false, "costHint": "DeepSeek 计费", "humanName": "标准 · DeepSeek-V3" },
  "kimi/moonshot-v1-8k":           { "tier": "standard", "free": false, "costHint": "Kimi 计费", "humanName": "标准 · Kimi" },
  "qwen/qwen-plus":                 { "tier": "standard", "free": false, "costHint": "通义计费", "humanName": "标准 · 通义千问" },
  "ollama/qwen2.5":                { "tier": "faster",  "free": true,  "costHint": "本机", "humanName": "更快 · 本地 Ollama" },
  "claude/claude-sonnet-4-5":       { "tier": "stronger", "free": false, "costHint": "Anthropic 计费", "humanName": "更强 · Claude" }
}
```

### 7.3 UI 位置（在球的哪个交互里）

- **球旁常驻 chip**：`ModelChip.tsx` 贴在 `ExpressiveOrb` 下方/旁，显示当前模型人话名（如"标准 · GLM"），点击展开 picker。符合"有字的地方都加圆角矩形"红线。
- **设置面板**：「模型与密钥」卡片（圆角矩形）含：当前模型、档位选择（更快/标准/更强 大按钮）、高级展开（真实 `provider/model`、自定义厂商表单、key 输入）、首启动引导引导条。
- **状态条**：顶部细条显示"当前：X · 免费/计费 · 健康度"，对标 Codex `/status`。

### 7.4 验收标准

1. **切换是一等公民**：设置面板 + 球旁 chip 均可切；切后 chip/状态条立即更新；picker 列出 `settings.yaml` + `mochi-models.json` 全部模型。
2. **加自定义厂商 = 0 代码**：在 `llm-pi-ai.providers` 加一个 OpenAI 兼容条目（如 Kimi），重建 harness 后 picker 出现该厂商并可切成功（用真实 key 跑通一轮）。
3. **凭据安全**：key 仅存 `.credentials.yaml`（0600）/ 主进程；renderer 网络面板/日志搜不到明文 key；`apiKeyEnv` 名与文件键一致。
4. **教师傻瓜式**：首启零配置可用免费 GLM；老师视角只见"更快/标准/更强"，不见型号；断网自动演示模式不报错崩。
5. **三档路由**：不手动选时，简单/复杂/难任务分别落更快/标准/更强；手动选覆盖自动。
6. **演示兜底**：主模型 429 → 自动轮换 4.5-air/5.3-flash 并重试；全限流 → 演示模式；评委自带 key 流程跑通且赛后可恢复默认。
7. **dsh 协议零编造**：本文件所有 dsh API（`registerAdapter`/`registerConfigurableProviders`/`agentDefaultModel.currentSelection`/`saveSelection`/`InitializeParams`/`ctx.credentials.*`/`llm-pi-ai` 协议表）均附源码 `文件:行号`；无 `TO_BE_RESOLVED_BY_CODEX` 残留于 dsh 能力描述。

---

## 8. 风险与最大不确定性（给审核官挑刺）

1. **dsh SDK 模型进程级定死**（`server.ts:162-166`）：切换必重建 harness，in-flight turn 中止。已据此设计，非缺陷；但若评委要求"切换不丢当前 turn"，需多 sidecar，超预算，明确放弃。
2. **`llm-pi-ai` 必须进 profile**：08 原 profile 只挂 `llm-deepseek`，自定义厂商需补挂 `llm-pi-ai`（§7.1）。漏挂则自定义厂商 `hasAdapterFor` 失败、`initialize` 抛 "no adapter registered"（同 `server.ts:150-153`）。
3. **Gemini 无原生协议**：只能走 OpenAI 兼容端点（§3.3），真原生需写插件——已标注。
4. **dsh Developer Preview 锁版本**：`llm-pi-ai` / `agent-default-model` / `InitializeParams` 字段以 v0.1.2-rc.1 源码为准，正式版变动则按新源码校正（同 08 §9.1）。
5. **热加载时序**：新增厂商后若不等热加载即 `initialize`，可能 "no adapter"；Mochi 统一用"写设置 + 重建 harness"规避，已在 §1.4/§3.1 写明。
6. **`glm-4.7-flash` 误用**：已纠正 08 的备份假设（§6.1），热备只用 4-flash/4.5-air/5.3-flash。
