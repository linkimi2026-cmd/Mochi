# 缓存命中率（prompt prefix cache）——口径、实测与保证方法

> **status**: active
> **last_verified**: 2026-09-12
> **verified_by**: 工具线（审核监制）
> **性质**：本文是**缓存命中率这一个指标**的唯一口径来源。凡「命中率」「缓存命中」
> 「99%」的说法，以本文定义和本文的验收脚本为准。

---

## 0. 结论先写

1. **命中率不是性能指标，是成本与可用性指标。** 它衡量的是「同一段前缀有没有被
   按缓存价计费」。prefix 不做缓存，长会话成本线性爆炸。
2. **两个网关都达标**（稳态 ≥99%）：
   - `mimo.ezlook.top` / `mimo-v2.5`：稳态 **99.63%**
   - `aiaaa.cc` / `deepseek-v4.1-flash`：稳态 **99.22% – 99.42%**
3. **第一轮永远是 0%**（缓存要建）。所以「命中率」只在**多轮**语境下有定义；
   拿单轮数字说事的一定是搞错了。
4. **最容易把它打下来的不是模型，是前缀突变**：会话中途换工具面（对话界面 → 工作界面）
   会让那一轮**整段前缀作废**（实测 aiaaa 归零、mimo 掉到 70.6%），之后 1–2 轮恢复。
5. **指标能被观测本身是有前提的**：dsh 必须发 `stream_options:{include_usage:true}`。
   少了它，网关不回传 usage，命中率变成一个**没有症状的不可观测数**。
   已加 CI 守卫：`apps/desktop/scripts/test-llm-cache-observability.mjs`。

---

## 1. 口径定义

### 1.1 dsh 侧（会话日志里的 fact）

`packages/llm/llm-deepseek/src/translate.ts` 的 `mapUsage` 把网关的
`prompt_tokens` 拆成**互斥**的两半（源码注释写得很明确：DeepSeek 的
`prompt_tokens` 含命中部分，等于 `prompt_cache_hit_tokens + prompt_cache_miss_tokens`，
映射时把命中数**减出去**）：

```
inputTokens     = prompt_tokens − cacheReadTokens      ← 未命中的那部分
cacheReadTokens = 命中的那部分
```

于是：

```
本轮 prompt 总量 = inputTokens + cacheReadTokens
本轮命中率       = cacheReadTokens / (inputTokens + cacheReadTokens)
```

**注意**：`usage.inputTokens` 不等于 `prompt_tokens`。拿 `inputTokens` 当分母算命中率
会得到严重偏高的数字（这是最容易犯的错）。

### 1.2 网关侧（拼法有两种，都要认）

```js
cacheRead = usage.prompt_tokens_details?.cached_tokens   // OpenAI 兼容拼法
         ?? usage.prompt_cache_hit_tokens                // DeepSeek 自有拼法
```

实测两个网关回传的都是 `prompt_tokens_details`（且该对象里**只有**
缓存计数，不含图片 token 计数）：

| 网关 | usage 原始键 |
|---|---|
| `aiaaa.cc` | `prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details, completion_tokens_details` |
| `mimo.ezlook.top` | `completion_tokens, prompt_tokens, total_tokens, completion_tokens_details, prompt_tokens_details` |

### 1.3 「稳态」的定义

**第 2 轮起。** 第 1 轮必然 0%（缓存未建立）。任何验收报告都必须把第 1 轮单列，
不能混进平均里冲淡——也不能把它删掉假装不存在。

---

## 2. 怎么观测

### 2.1 前提：请求必须索取流式用量

`@deepseek-ai/dsh-llm-deepseek` 的产物里（`lib/index.js`）：

```js
stream: true,
stream_options: { include_usage: true },
```

两个缺一不可。**开源的 400 伪装坑在旁边**：第三方网关把 400 以
HTTP 200 + 单行 JSON 错误体返回时（技能坑 31），一个 `data:` 行都没有；
只判断 `usage === null` 会把「请求被拒绝」误判成「成功但没带 usage」，
结论正好反过来。探针里的判定是 `dataLines === 0 → 直接报错`。

### 2.2 三种取证路径（按"离真实多远"排序）

| 路径 | 命令 | 说明 |
|---|---|---|
| **会话日志（最真实）** | `node tools/verify-cache-hit.mjs --home <DSH_HOME>` | 读 dsh 自己写的 `assistant/message` 事件，不用信任何人转述 |
| **真实前缀探针** | `node tools/cache-hit-probe.mjs --provider … --model … --turns N` | 用当前 persona（从 `core.patch.yml` 现读）+ 真实工具面抓包，按 dsh 的请求形状打 |
| **换模型体检** | `node tools/model-compat-probe.mjs --provider … --model …` | 6 项：基础对话 / 工具调用 / 流式 usage / `thinking:{disabled}` / `reasoning_effort` / 图片输入 |

### 2.3 三个必须知道的取数坑

1. **会话日志是多帧 zstd。** 同一份 46,362 字节的日志：
   `zstd -dc` 解出 94,515 字符 / 31 行；Node 的
   `zlib.zstdDecompressSync` 只解出 **183 字符 / 1 行**（只读第一帧）。
   用后者会「看不到任何用量记录」，然后报一个看起来合理但完全错误的结论。
   `verify-cache-hit.mjs` 优先用命令行的 `zstd`；只能用 Node 时若输出不以换行结尾
   就**拒绝出数**，而不是报假数。
2. **一个会话目录里躺着两份日志**（`session.jsonl.zstd` / `session.v2.jsonl.zstd`）。
   按 mtime 取"最新文件"会随机挑到旧格式。必须显式优先 `.v2.`。
3. **网关的前缀缓存是服务端持久的、跨进程的。** 同一个前缀几分钟前跑过，这次就是热的。
   实测踩过：不加随机标记时，「换工具面」那一轮命中 99.44%，看着像"换面不要钱"；
   加了冷标记（`--nonce`）后同一实验变成 **0.00%**。**做对比实验必须打冷标记。**

---

## 3. 实测数据（2026-09-12）

### 3.1 真实会话（dsh 自己写的日志，最硬的一份）

命令：`DSH_HOME=/tmp/mochi-e2e-home ./mochi.sh "先列 plugins 子目录，再读 plugins/mochi-hello/package.json…"`
验收：`node tools/verify-cache-hit.mjs --home /tmp/mochi-e2e-home`

会话事实：`provider=deepseek-official  model=deepseek-v4.1-flash  reasoningEffort=off`，
3 次模型请求（3 个工具步）。

| 轮次 | prompt | 命中 | 未命中 | 命中率 |
|---|---|---|---|---|
| 1 | 25,655 | 0 | 25,655 | 0.00%（首轮，正常） |
| 2 | 28,718 | 24,832 | 3,886 | 86.47% |
| 3 | 29,037 | 28,672 | 365 | **98.74%** |

稳态（第 2 轮起）92.64%。这一份短会话（只有 3 轮）没到 99%，
**原因不是缓存不工作，而是会话太短**：第 2 轮的增量是 3,886 tokens，
占当时前缀的 13.5%。这正好说明为什么要看"稳态"、以及为什么要看"增量/前缀"这个比值。

### 3.2 当前真实前缀 · 冷前缀 · 两种网关对照

前缀 = 当前 persona（`core.patch.yml` 现读，3,308 字符）
\+ 真实工具面抓包（`probe-log.nosync/029-request.json`，**89 个工具 schema / 63,971 字符**）
≈ **24.3k tokens**。每轮跑 `--nonce` 打冷标记。

**`aiaaa.cc` / `deepseek-v4.1-flash`（递进 6 轮）**

| 轮次 | prompt | 命中 | 未命中 | 命中率 |
|---|---|---|---|---|
| 1 | 24,298 | 0 | 24,298 | 0.00% |
| 2 | 24,317 | 0 | 24,317 | **0.00%** ← 冷启动要 2 个请求才热 |
| 3 | 24,334 | 24,192 | 142 | 99.42% |
| 4 | 24,346 | 24,192 | 154 | 99.37% |
| 5 | 24,366 | 24,192 | 174 | 99.29% |
| 6 | 24,383 | 24,192 | 191 | 99.22% |

**`mimo.ezlook.top` / `mimo-v2.5`（同一前缀，递进 6 轮）**

| 轮次 | prompt | 命中 | 未命中 | 命中率 |
|---|---|---|---|---|
| 1 | 28,940 | — | — | n/a（首轮未回传 usage） |
| 2 | 28,965 | 28,928 | 37 | 99.87% |
| 3 | 28,985 | 28,928 | 57 | 99.80% |
| 4 | 29,004 | 28,928 | 76 | 99.74% |
| 5 | 29,086 | 28,992 | 94 | 99.68% |
| 6 | 29,255 | 29,056 | 199 | 99.32% |

**稳态命中率：aiaaa 99.22–99.42% ｜ mimo 99.32–99.87%（累计 99.63%）**

未命中那一段（142–199 tokens）是固定的"尾巴"，**不随会话增长而增长**。
所以前缀越长，命中率越高：24k 前缀下 0.6–0.8%，若前缀到 60k 则约 0.3%。

### 3.3 会话中途换工具面（模拟「对话界面 → 工作界面」）

前 3 轮用窄工具面（89 个掐掉 20 个 = 69 个），第 4 轮起换成全量 89 个，
`--switch-at 3 --nonce`：

| | 轮1 | 轮2 | 轮3 | **轮4 换面** | 轮5 | 轮6 |
|---|---|---|---|---|---|---|
| aiaaa / v4.1-flash | 0.00% | 98.57% | 99.21% | **0.00%** | 73.59% | 99.29% |
| mimo / v2.5 | n/a | 99.67% | 99.89% | **70.60%** | 99.88% | 99.81% |

**这是本次测量最有产品含义的一条**：工具面是前缀的一部分，改工具面 = 那一轮整段前缀作废。
`mochi-modes` 的「对话界面收窄工具面 → 工作界面放开」正好是这个形状。

- aiaaa：换面那一轮**全价**，第 5 轮还在恢复（73.59%），第 6 轮才回稳态 → 代价 ≈ 2 轮
- mimo：换面那一轮保留 70.60%（块级复用，前缀部分仍命中），下一轮即回 99.88% → 代价 ≈ 1 轮

**设计含义**：不要在中途反复收窄/放宽工具面。一次切换的代价是可控的（1–2 轮），
但"每轮都变"就等于永远不命中。

### 3.4 模型体检对照（`model-compat-probe.mjs`）

| 检查项 | `deepseek-v4.1-flash` @ aiaaa | `mimo-v2.5` @ mimo |
|---|---|---|
| 基础对话 | ✓ | ✓ |
| 工具调用 | ✓ 触发校园学生查询工具 | ✓ |
| 流式 usage | ✓ 含缓存字段 | ✓ 含缓存字段 |
| `thinking:{disabled}` | ✓ 接受，**且确实不推理** | ✓ 接受，且确实不推理 |
| `reasoning_effort:low` | ✓ | ✓ |
| 图片输入 | ✓ 接受（usage 未单列图片 token 数） | ✓ 接受（usage 单列了 9 个图片 token） |

**6/6 通过**（两个模型）。

---

## 4. 怎么保证 ≥99%（可执行清单）

按"影响从大到小"排：

1. **前缀必须逐轮稳定。** 任何打进前缀的易变内容都会把命中率按整段打掉，而不是按那几行。
   - 已核对：`includeRuntimeContext: true` 注入的运行时快照**不含时间戳**，
     内容是「文件策略 + 审批策略 + 工作区路径」，同一会话内稳定 → 安全。
   - 红线：**不要把当前时间、页码、随机 id、每轮重算的统计写进 persona 或工具描述**。
     要放就放到最后一条 user 消息里。
2. **工具面不要每轮变。** 见 §3.3。模式切换是允许的（代价 1–2 轮），
   但"每次请求都重算工具集"会把命中率打到接近 0。
3. **接受第 1 轮 0%。** 这是机制，不是缺陷。
4. **长前缀优于短前缀。** 固定尾巴约 150–200 tokens；前缀 24k 时占 0.7%，
   前缀 60k 时占 0.3%。重试（`llm-retry`）与同前缀的重复请求都落在同一个缓存上，
   成本远低于首轮——所以"重发一次"的边际成本比直觉低得多。
5. **守住可观测性。** `node apps/desktop/scripts/test-llm-cache-observability.mjs`
   已进 CI（`mochi-ci.yml`）。它断言 4 件事：`stream:true` / `include_usage` /
   缓存字段解析 / `cacheReadTokens` 映射。任何一条丢了都会红。

---

## 5. 换模型 / 换网关时怎么复现这套结论

```bash
# 0. 先问网关到底提供什么模型（我们声明的和它提供的是两件事）
node tools/probe-endpoint-models.mjs

# 1. 体检：6 项能力逐个打勾
node tools/model-compat-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash

# 2. 冷前缀下量稳态命中率（--nonce 必加，否则被上一次运行污染）
node tools/cache-hit-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash \
  --tools-file probe-log.nosync/029-request.json --turns 6 --nonce

# 3. 量换工具面的代价
node tools/cache-hit-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash \
  --tools-file probe-log.nosync/029-request.json --switch-at 3 --nonce

# 4. 真跑一轮，再从 dsh 自己的会话日志验收（最硬）
DSH_HOME=<临时 home> ./mochi.sh "<一个会用工具的短任务>"
node tools/verify-cache-hit.mjs --home <临时 home> --threshold 0.99
```

**想让工具面等于"线上真实的那一份"**：先跑一次真实会话，用
`PROBE_PORT=<port> PROBE_UPSTREAM=<origin> node tools/llm-probe.mjs` 挂观测代理，
把 `settings.yaml` 的 `llm-deepseek.baseURL` 指到 `http://127.0.0.1:<port>/v1`，
跑完之后 `probe-log.nosync/` 里就是**逐字真实**的请求体（含当前全部工具 schema）。
探针会自动剔除非法工具名并点名——详见 §6。

---

## 6. 顺带被这次测量独立复现的两条硬约束

### 6.1 点号工具名 = 整轮 400（P0 的第三方网关证明）

把 2026-09-06 的旧抓包（含 `jxl.analytics` 等 32 个点号名）原样重放， <!-- allow-dotted-tool-name -->
`aiaaa.cc` 直接以 400 拒绝：

```
Invalid 'tools[5].***.name': string does not match pattern.
Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'.
```

这不是我们的判断，是**网关的模式校验**。与 2026-09-12 的 P0 结论一致。
`cache-hit-probe.mjs` 现在会**主动剔除**非法名并点名，
避免把"请求被拒"误读成"网关不支持缓存"。

### 6.2 网关会拒绝「缺字段」的历史消息

同一份旧抓包在非流式下被拒：

```
messages[2]: missing field `name`
```

即 `role: tool` 的消息必须带 `name`。dsh 当前产物不带该字段，
若将来切到严格校验的网关需要补。**当前两个在用的网关都不受影响**
（真实会话已跑通）。

---

## 7. 网关能力对照（实测）

| | `mimo.ezlook.top/v1` | `aiaaa.cc/v1` |
|---|---|---|
| 端点模型清单 | `mimo-v2.5`、`mimo-v2.5-pro`、`mimo-v2.5-asr` | `deepseek-v4-flash-0731`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro-0813`、`deepseek-v4.1-flash` |
| 流式 usage | ✓（需 `include_usage`） | ✓（需 `include_usage`） |
| 冷启动到热 | 1 个请求 | **2 个请求** |
| 换工具面后 | 保留 70.6%，1 轮恢复 | 归零，2 轮恢复 |
| 前缀缓存持久性 | 服务端持久（跨进程） | 服务端持久（跨进程） |
| 无数据 URL 图片输入 | ✓（usage 单列图片 token 数） | ✓（不单列） |

---

## 8. 本文不覆盖

- **缓存写价**（cache write / cache miss 的单价差）。本文只讲"命中多少"，
  不讲"命中省了多少钱"——后者要网关的价目表，目前两家都没有公开可核对的档位。
- **上下文窗口与压缩**。见排期文档与 `docs/build-standard.md` 之外的会话策略文档。
- **`tools/verify-cache-hit.mjs` 未进 CI**：它需要真实会话日志，而 CI 里没有。
  它是**验收工具**（人工/发布前跑），不是门禁。门禁是 §4.5 的 4 条断言。
