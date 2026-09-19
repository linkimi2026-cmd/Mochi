# aiaaa 网关实测事实（Mochi 出厂默认模型链）

> **status**: active
> **last_verified**: 2026-09-19
> **verified_by**: Mochi（对 `https://aiaaa.cc/v1` 的只读 HTTP 探针，非流式与流式两套路径；2026-09-19 追加「输出配额落点」复核与余额复测；未通过桌面应用端到端复跑）

本文记录 `mochi-aiaaa` 这条出厂默认模型链背后的**第三方网关行为事实**。它回答的是“这个网关实际怎么表现”，
不是“Mochi 想要它怎么表现”。凡属推断的条目都显式标注，不写成已确认。

`mochi-aiaaa` 的注册方式说明见本文末「注册链路」一节——它**不是**由某个插件在代码里注册的。

## 探测方法

- 直接对 `https://aiaaa.cc/v1/chat/completions` 发请求，凭据来自构建期种子 `MOCHI_AIAAA_API_KEY`。
- 关键结论都在**流式**路径上复测过（Mochi 实际经由 `ctx.llm.stream()` 调用），因为非流式与流式的
  后端选择是独立的，只在一条路径上结论不成立。
- 视觉判定使用自生成的**有效** 96×96 纯色 PNG（红 / 蓝）与「无图」三组对照。
  注意：早期曾用 1×1 或损坏的 base64 图片做判定，那种探针**无效**——模型会对着坏图给出
  貌似合理的颜色答案（实测三个模型对同一张坏图都答「黑色」）。

## 模型清单（`GET /v1/models`，权威）

| 模型 id | 视觉（收图） | 备注 |
|---|---|---|
| `deepseek-v4.1-flash` | ✅ 是 | Mochi 出厂默认对话模型 |
| `deepseek-v4-flash-0731` | ✅ 是 | 日期快照版 |
| `deepseek-v4-flash-vision-exp` | ✅ 是 | 出厂声明的视觉模型 |
| `deepseek-v4-pro-0813` | ❌ **否** | 带图直接 400 `当前模型不支持该能力：vision` |

`/v1/models` 不返回任何能力元数据（无 context window、无模态、无定价）；`GET /v1/models/{id}` 同样为空壳。
**唯一可靠的能力来源是实测。**

### 视觉判定的证据

| 输入 | 模型 | 回答 |
|---|---|---|
| 纯红图 | `deepseek-v4.1-flash` | 红色 |
| 纯蓝图 | `deepseek-v4.1-flash` | 蓝色 |
| 无图 | `deepseek-v4.1-flash` | 无法确定 |
| 纯红图 | `deepseek-v4-pro-0813` | HTTP 400 `当前模型不支持该能力：vision` |

蓝图与无图两组对照说明模型**真的在看图**，不是从问题文本里编答案。

> pi-ai 内置的 `deepseek` 目录把 `deepseek-v4-flash` 标为 `input: ["text"]`（纯文本）。
> 那是 `api.deepseek.com` 的事实，**不适用于本网关**：本网关的 flash 系列收图。
> 所以种子为默认模型声明 `input: [text, image]` 是正确的，不要照抄内置目录把它降成纯文本。

## 思考档位不可控（重要）

该网关对同一模型**非确定性地**路由到「会思考」与「不思考」两类后端。命中会思考的后端时，
响应先产出 `reasoning_content`，正文在思考之后才出现。

实测（同一题目、只改档位）：

| 传入字段 | 结果 |
|---|---|
| 不给任何思考字段 | 正文 |
| `reasoning_effort: none` / `minimal` / `low` / `medium` / `high` / `off` / `max` | **与「不给字段」逐字节相同的正文** |
| `thinking: {type: "disabled"}` | 同上，未被尊重 |
| `enable_thinking: false` | 同上，未被尊重 |

八种取值返回完全一致的正文 ⇒ **客户端无法关闭或调节该网关的思考**。

这正是 dsh 的 `llm-pi-ai` 适配器所预期的情形。其 `reasoningInfo()` 注释原文：
“a provider whose own default is to think would keep thinking with `off` selected.
Omitting `reasoning` entirely is the seam's way of saying the capability is unavailable.”

因此本路由**刻意不声明 `reasoningEfforts`**：声明了就会在界面上提供一个做不到的开关
（“看起来生效”），而不声明则等价于「本模型不提供档位调节」，这与网关事实一致。
模型会被解析为 `reasoning: false`，同时 pi-ai 也不会向网关发送任何思考参数。

注意 `resolveReasoningLevel()` 对**显式传入**且不被支持的档位会抛
`UNSUPPORTED_REASONING_ERROR` / `UNSUPPORTED_REASONING_EFFORT`。所以任何地方都不要给
本路由的模型传 `reasoningEffort`；`off` 是被支持的（它只是「省略」），因此传 `off` 安全。

## 输出配额与思考耦合（本次最严重的发现）

**在任何低于思考长度的输出配额下，本网关会返回空正文**：`finish_reason: length`，
`content` 为空字符串，全部配额消耗在 `reasoning_tokens` 上。

实测（同一简单任务，非流式）：

| `max_tokens` | `content` |
|---|---|
| 16 | **空** |
| 64 | **空** |
| 256 | **空** |
| 1024 | 有正文（`reasoning_tokens: 348`） |

思考长度随任务规模增长，且**会自行收敛**（不会无限膨胀）：

| 任务 | 思考用量 | 结论 |
|---|---|---|
| 标题生成（两条中文短消息） | 约 220–260 token | `cap=1024`、`cap=4096` 各 2/2 成功 |
| 60 行会话记录摘要 | 2831 token | `cap=8192` 成功；`cap=2048` **空正文** |
| 240 行会话记录摘要 | — | 未测（余额耗尽，见下） |

**由此推出对 Mochi 的实际影响：**

1. **会话标题**（`session-title-llm`）：base bundle 给的 `maxOutputTokens: 64` 落在空正文区间。
   实测流式 6 次中 1 次、非流式 5 次中 2 次为空；插件随即抛
   `session-title-llm: title output reached maxOutputTokens`，表现为会话列表大面积无标题。
   → 已在 `apps/desktop/resources/mochi-web/patches/core.patch.yml` 覆盖为 `2048`。
2. **压缩摘要**（`compaction-basic`）：默认 `maxTokens: 8192`，对 60 行输入余量仅约 2.9 倍。
   空摘要不会静默丢历史——`summarizer.ts` 会抛
   `summarization produced no text summary content`——但压缩一旦失败，长会话就撞上下文墙。
   → 已覆盖为 `16384`，但**必须落在 preset 里**：`dsh-web-app` 已把宿主面的
   `compaction-basic` 行置为 `disabled: true`（它只把读取 token meter 的后端留在宿主面），
   而 dsh 的行补丁只整体替换 `config`、不碰 `disabled`，所以写进
   `patches/core.patch.yml` 是一行**不生效的死配置**（2026-09-19 用 `--dump-config`
   看到该行 `disabled: true` 才证实）。真实位置是各 preset 自己的压缩组，已同步：
   `client-plugins/teacher-agent-presets/{lesson-planning,materials-assessment,grade-analysis,classroom-coordination}/agent.cordis.yml`
   与 `apps/desktop/resources/mochi-web/classroom-agent-presets/classroom/agent.cordis.yml`。
   守卫：`apps/desktop/scripts/test-compaction.mjs` 断言 `maxTokens >= 16384`。
   已知缺口：上游 `cordis` preset（教师端「创造模式」）的 `compaction-basic` 无 `config`，
   仍吃默认 8192；覆盖它需走 vendored 包补丁，暂未做。
3. **一般原则**：任何辅助 LLM 调用的输出配额都必须**显著高于**该任务的思考预算。
   给小配额（几十到几百 token）的调用在本网关不可用。

## 上下文上限（已确认事实 + 合理推测）

**已确认事实**（实测，`max_tokens` 固定小值以免干扰）：

| 提示规模 | 结果 |
|---|---|
| 383,617 prompt token | 200 |
| 563,169 prompt token | 200 |
| 687,609 prompt token | 200 |
| **811,622 prompt token** | **200** |
| 约 1.53M prompt token | **400 `Input token exceed the limit`** |

**合理推测**：真实上限为 **1,000,000 token**。依据三条独立事实一致：
(a) 811,622 通过、约 1.53M 被拒，区间包含 1M；
(b) pi-ai 内置 `deepseek` 目录记载 V4 系列 `contextWindow: 1000000`；
(c) dsh 自家 `llm-deepseek` 的 `DEFAULT_CONTEXT_WINDOW = 1_000_000`。

**为什么必须显式声明**：`mochi-aiaaa` 不在 pi-ai 内置目录里，`resolveRouteModels` 拿不到任何
catalog 基线，未声明字段一律落到 **pi-ai 的兜底 262,144**，比真实能力**低报约 3.8 倍**——
长对话会被过早压缩。已确认：不声明时 `Config()` 解析出的 provider 级兜底正是
`contextWindow: 262144` / `maxTokens: 32768`。

## 输出上界

`max_tokens` **不被网关校验**：384,000 与 2,000,000 均被接受（不报错、不裁剪）。
且 `max_tokens` **不挤占上下文预算**：387,977 prompt + `max_tokens: 384000` 仍 200。

种子取 **256,000**，与 dsh 自家 `llm-deepseek` 的 `DEFAULT_MAX_TOKENS = 256_000` 一致，
而不是 pi-ai 的 32,768 兜底。方向上这是安全侧：声明的 `maxTokens` 会成为
**未自带配额的请求的默认输出上限**，在本网关（思考先吃配额）大预算才不会误伤。

## 提示词缓存（已确认事实）

同一长前缀连发三次，`usage.prompt_tokens_details.cached_tokens`：

| 次序 | prompt_tokens | cached_tokens |
|---|---|---|
| 第 1 次 | 4,015 | 0 |
| 第 2 次 | 4,015 | **3,968** |
| 第 3 次 | 4,015 | **3,968** |

⇒ 本网关**确实做提示词缓存**并在 usage 里如实上报（稳态约 98.8%）。
这意味着 Mochi 的缓存命中率观测指标（`docs/cache-hit-rate.md`）在这条路由上**有效**，不是空转。

## 工具调用与流式

- **工具调用正常**：`finish_reason: tool_calls`，`tool_calls[].function.arguments` 是合法 JSON，
  中文参数正确（实测 `{"class_name": "高2025级10班"}`）。
- **多轮工具历史不带 `reasoning_content` 也能通过**：说明该网关**不需要**
  `requiresReasoningContentOnAssistantMessages` 那类回灌。
- **流式可用**，且 `stream_options.include_usage` 返回 usage。
- 流式响应体带 Azure 形态的 `content_filter_results`（hate / self_harm / sexual / violence /
  jailbreak / profanity）字段 ⇒ **合理推测**：网关底层是 Azure OpenAI，因此
  `compat.thinkingFormat` 不必按 DeepSeek 原生协议声明。

## 错误形状（与标准 OpenAI 不同，影响错误分类）

| 场景 | HTTP | 响应体 |
|---|---|---|
| 未授权模型 | **404** | `{"code":"model_not_found","message":"Model \"…\" is not available for this group","type":"invalid_request_error"}` |
| 不支持视觉 | 400 | `{"message":"当前模型不支持该能力：vision","type":"invalid_request_error"}` |
| 缺配额 | 403 | `{"error":{"message":"insufficient balance","type":"billing_error"}}` |
| 提示超长 | 400 | `{"message":"Input token exceed the limit (request id: …)","type":"invalid_request_error"}` |

注意 **404/400 的多数错误体是顶层 `{code,message,type}`，而非标准的 `{"error":{…}}`**；
只有 403 计费错误走标准 `error` 包装。

`llm-pi-ai` 的 `classifyPiAiError()`（`stream.ts`）是按**消息文本里出现的状态码**分类的，
因此在本网关上有两处具体错配：

| 网关返回 | 会被归为 | 应为 | 后果 |
|---|---|---|---|
| `403 insufficient balance` | **AUTH**（`/\b(?:401\|403)\b/` 命中） | 计费/配额类 | 余额不足被当成认证失败，可能把老师引向「去设置页改密钥」，而真正要做的是充值或换模型 |
| `404 model_not_found` | 落到默认类别 | INVALID_REQUEST | 具体原因（模型名不认识）只在原始报文里，不在分类码里 |

修复需要改 vendored 的 `llm-pi-ai` 源码（`packages/llm/llm-pi-ai/src/stream.ts`）并重打 tgz，
属于跨包改动；当前**未修**，仅记录事实。

## 未完成 / 待办

- **`aiaaa.cc` 账户余额已耗尽**：本文的探针本身消耗掉了余额，探针末尾与事后复测均得到
  403 `insufficient balance`。**这意味着当前出厂默认模型链不可用**，是「每个安装包里的模型
  必须可用」这条要求的直接阻塞项。`mimo.ezlook.top` 仍正常（200）。恢复方式：充值、
  把出厂默认切到 MiMo、或补一条兜底路由。
- `deepseek-v4-flash-0731` 与 `deepseek-v4-pro-0813` 的**上下文上限未实测**，因此暂未加入
  出厂模型目录。补测后再决定是否开放给教师的模型选择器。
- 摘要侧只测到 60 行输入；240 行的余量未验证（受余额限制）。
- 错误文案的适配缺口（上一节）未修。

## 注册链路（为什么“搜不到 mochi-aiaaa 的注册者”）

`mochi-aiaaa` **不由任何插件在代码里注册**。链路是：

1. base bundle 挂载 `llm-pi-ai`（`@deepseek-ai/dsh-llm-pi-ai`），**休眠姿态**——零路由，
   直到设置文档里出现 `llm-pi-ai:` 段；
2. 首启种子（`apps/desktop/electron/dsh/seed.ts`，内容来自
   `apps/desktop/scripts/seed-packaging-keys.cjs`）把 `llm-pi-ai.providers.mochi-aiaaa`
   写进 `$DSH_HOME/settings.yaml`；
3. `agent-default-model.provider = mochi-aiaaa` 指向该路由。

所以在源码里 grep `mochi-aiaaa` 只会命中种子生成器与文档，这是**正常**的，不代表缺注册者。

## 相关文档

- [运行事实](RUNTIME-FACTS.md) — 启动、配置、插件接线
- [缓存命中率](cache-hit-rate.md) — 本文的缓存结论对其适用性给出依据
- [文档治理](DOC-AUTHORITY.md) — 本文在文档树中的位置
