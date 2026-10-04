# 缓存命中率（prompt prefix cache）——口径、实测与保证方法

> **status**: active
> **last_verified**: 2026-09-25
> **verified_by**: Codex（真实网关探针）
> **性质**：本文是**缓存命中率这一个指标**的唯一口径来源。凡「命中率」「缓存命中」
> 「99%」的说法，以本文定义和本文的验收脚本为准。

2026-09-25 补充：`tools/verify-cache-hit.mjs` 现要求每轮同时有非负整数 `inputTokens` 与 `cacheReadTokens`，且和为安全整数，才计入分母。稳态轮只缺 `inputTokens` 时，过去会被补零并可能误报 100%；现在显示 n/a、退出码 2。缺失/非法输入、有效输入和多帧拒绝回归 5/5 通过。此修复仅防止错误验收，不表示模型前缀或供应商缓存率有新提升。

2026-09-25 请求形状补充：`mochi-modes` 在 DSH 已过滤的当轮工具声明中，将实际存在的日常对话工具按固定顺序置前；工作工具仍只在获批工作态出现。教师端隔离 Electron 的脚本化 SSE 网关回归比较了同一自然语言课件任务的聊天请求与“允许一次”后的工作请求，聊天态所有工具名及每个实际发送的完整 tool JSON 的 SHA256 逐项等于工作态工具数组前缀；PPTX 实际生成、回读及预览也通过。本机开发插件依赖路径连续三次出现 `WEB_HOST_TIMEOUT`，将该回归的插件和 DSH 依赖指向本轮已核对的 Mac 包资源后 16.6 秒通过；原因尚未隔离，不能直接归咎于 iCloud。它证明共享 schema 前缀，不证明整份请求或 system 消息相同，更没有真实供应商的缓存 token 与费用读数。历史 13→96 数量仍是 2026-09-24 当时抓包，不把它当作本轮重新计数。

## 2026-09-24 · 当前教师对话→工作模式的真实工具面

在全新隔离 `DSH_HOME` 中运行当前 `mochi-web` / `lesson-planning`，将 fixture MiMo Key 仅指向本机 SSE 假网关；同一会话先发一轮普通对话，再执行 `/mochi-work` 发一轮工作请求。临时脚本 `/tmp/mochi-chat-work-shape-20260924.mjs` 从本机网关内存读取请求，仅输出模型、消息数、工具名和 system 哈希，没有保存请求头、Key 或学生信息。进程正常退出，Web 端口为 `53360`。这是 2026-09-24 当前工作区的实跑证据；`/tmp` 脚本和临时 profile 可能被系统清理。

| 阶段 | 模型 | 消息数 | 工具数 | system 消息 JSON SHA256 |
| --- | --- | ---: | ---: | --- |
| 教师对话 | `mimo-v2.5` | 3 | **13** | `d7a3235711943253704ba1a0b5e7b533d07606962aaf287ace365d982baca262` |
| 同会话切到工作 | `mimo-v2.5` | 6 | **96** | `14567e5f851e5d53be8491374c13cc189117c02e8b7d5cd49b5fc39db0e7632` |

两份 system 消息的 JSON 从开头共享 7,405 字符，随后内容分叉。对话工具包括 `mochi_call_student`、`mochi_lan_pair_classroom`、`mochi_lan_reply_student_request` 等 13 项；工作模式在保留这些工具之外增加课件、文档、校园查询等工具，达到 96 项。**已确认：** 当前请求形态是 13→96，旧的 1→89 只代表当时版本，不能继续称为当前工具面。**未验证：** 供应商实际缓存 token、该切换的收费影响、真实教师长会话和不同模型；本机假网关不提供这些证据。不为追求工具数而删去用户需要的对话办事能力。

## 2026-09-24 · 新会话 Web 地址前缀稳定化已接入

`plugins/mochi-hello/index.mjs` 现通过已安装 DSH `system-prompt/assemble` 钩子，只将 `app:web-surface` 段内 `http://127.0.0.1:<启动端口>` 改成固定的 `DSH_WEB_URL` 使用说明；原段中的页面、构建和刷新边界说明保留。`dsh-web-app` 的 `surfaceContext` 仍启用，其 `shellEnv` 注册未被修改，工作模式可在执行时读取实时 URL。默认对话模式无 shell 工具，不应声称能在该模式直接核验 URL。若未来上游改了 URL 格式，本钩子会保留原段，此时需重新审查缓存稳定性。

**已确认：** 本机已安装 `SystemPrompt` 的实际组装探针在端口 `50001` 与 `60002` 下得到相同的 `app:web-surface` 文本；`plugins/mochi-hello/test-shell-env.mjs` 验证钩子保留原页面规则并移除端口。下面的两次完整教师新会话抓包进一步证明了本次场景中首轮 `{model,messages,tools}` 逐项稳定。**未验证：** 真实网关相对旧版本的命中率或费用提升、历史会话和主动读取 URL 后的缓存效果。下节临时 URL 后移实验是实施前证据，其“未接入”只表示当时的状态；本节记录的是后来实际接入的**不把端口写进模型消息**方案。不得将原临时变体的 87.18% 当成本方案收益。

两次分别从全新临时 `DSH_HOME` 启动当前教师 `mochi-web` / `lesson-planning`，切到 `/mochi-work`，用同一条合成的四年级水循环课件标题请求触发首轮。`MIMO_API_KEY` 仅是 fixture 字符串，MiMo `baseURL` 在临时 profile 中改指每次独立启动的本机假网关；抓包只保存 `{model,messages,tools}`，不保存请求头或 Key。临时 runner 基于 `/tmp/mochi-capture-teacher-prefix.mjs`，加入真实 `DSH_WEB_URL` 端口核验，脚本与两份抓包均只在 `/tmp`，未写入产品代码。两次进程均退出 `0`，Web 服务端口 `59086 → 59209`，假网关端口 `59065 → 59195`。

| 当前方案首轮字段 | A、B 实测 |
| --- | --- |
| `model` | 都是 `mimo-v2.5`，相同 |
| `messages[0]` system | 都是 9,697 字符；消息 JSON SHA256 `166ddb49e55dcab95ef73ecb1cf64cccf7db508116301d6e5adf04e077ae87c4`，相同 |
| `messages[1]` user | 都是 27 字符；消息 JSON SHA256 `8c336674b3daf6a0c0fb64c8a73af70fd89e5cdba1d18bade956a45a016ad60a`，相同 |
| `messages[2]` user | 都是 469 字符；消息 JSON SHA256 `2652dd07109c477f77147f20717abe8e82e936db34e3580aee004f65fabca287`，相同 |
| `messages[3]` user | 都是 1,437 字符；消息 JSON SHA256 `435f395a6f14cb7ad4050bbf7bdbeab96c8d37995e28c92c19aca2ce9280db34`，相同 |
| 整个 `messages` 数组 | 序列化长度 11,897 字符；SHA256 `58d7f9ccd3e0f8cbec621b2582d302c06e6aa2bb32c0e1a3103d91c0730cd9f1`，相同 |
| `tools` 数组 | 89 个 schema，顺序及全部字段逐项相同；序列化长度 63,381 字符；SHA256 `1e2eee829bf5dff53cf568545c391624af88fedf295467da9dd6c9020597d2a3` |
| 整份白名单抓包 | 两份文件均为 SHA256 `9dd931fcaf3b3c9e2227e92192cae95f4beb32aba977b0cdea3f372c24d587ca`；`DSH_WEB_URL` 指引仍在 system 中，两个实际端口均不在模型消息中 |

复核命令：`node /tmp/mochi-capture-teacher-postchange.mjs /tmp/mochi-cache-postchange.wltSon/teacher-a2.json`、同命令输出 `teacher-b2.json`，再运行 `node /tmp/mochi-compare-postchange.mjs /tmp/mochi-cache-postchange.wltSon/teacher-a2.json /tmp/mochi-cache-postchange.wltSon/teacher-b2.json`。本机临时证据路径 `/tmp/mochi-cache-postchange.wltSon/` 可被系统清理；上述哈希和字段长度记录当次结果。**已确认：** 在这个固定合成任务、当前教师工作模式及两次独立冷启动下，完整首轮模型请求前缀稳定，且实时 Web URL 仍在 shell 环境中。**未验证：** 供应商实际缓存 token、账单成本、不同任务/角色、工作区变动、历史会话或真实长会话；相同 JSON 不等于供应商一定命中缓存。

---

## 2026-09-24 · 跨启动前缀差异与未接入的稳定化试验

在不同时间用两个全新临时 `DSH_HOME` 启动同一教师 `mochi-web`/`lesson-planning` 工作会话，fixture Key 仅发往本机假网关。网关只白名单保存 `{model,messages,tools}`，不保存请求头或 Key。原始抓包为忽略目录中的 `036-teacher-work-request.json`（SHA256 `80fe8dff4be0dd5c05a2f74442ad157020b5676cd441fdc8a75e95e56aa261c2`）和 `037-teacher-work-request.json`（`98112a43500d8fdf93e40fc04854bd1836b39d1251fad1d2aa7564598c1df449`）。两次的 model、按顺序排列的 89 个工具 schema 和后 3 条 user 消息逐项相同；唯一变化在首条 system 消息第 3 行的本机 Web GUI 端口（62909 → 53982）。因此 9,542 字符 system 只共享前 433 字符，完整 `messages` JSON 只共享前 464 字符。已安装 DSH `dsh-web-app@0.1.3-alpha.1` 的 `app:web-surface` 段把启动时端口写在 system 前段；桌面 `DshWebHost` 默认请求随机端口。端口在同一进程内稳定，跨启动变化会使消息前缀很早分叉。

仅在 `/tmp` 临时 runner 中试用已安装 DSH `system-prompt/assemble` waterfall：把该 URL 从 system 段挪到后续 runtime-context 消息，保留 `DSH_WEB_URL` 的实时 shell 环境值，未改产品运行代码或 vendor。两次新隔离抓包 `038-teacher-work-stable-probe.json`（SHA256 `3309d8e87246e0e9c0f26879d8dc3882cd4de0b533d03eb4fe924561edb8c030`）与 `039-teacher-work-stable-probe.json`（`71acc93f12b95c69710f16a44e8a6b4b9e5fca97948882fbf6638a91505451c8`）的 model、89 个工具和整条 9,574 字符 system 均相同，完整 `messages` JSON 共享前 10,349 字符；实时 URL 只在后续 runtime context 中变化，并与同次运行的 `DSH_WEB_URL` 一致。这证明组装结构可后移，但动态 context 仍出现在后续消息中，且在请求 JSON 的 `tools` 字段之前；无法单凭字符数推算供应商内部缓存 token 的收益。

随后只对 MiMo 做 4 次有限真实网关探针：原始抓包一对、临时变体一对，各对首尾使用同一新增随机 system 标记，跨对标记不同；每次只发首轮请求，终端只保留用量与输入 SHA256。加标记的请求副本在临时目录运行后删除，下面哈希用于辨认当次输入，无法仅凭保留的原抓包复算。`无计数`表示探针没有可用缓存字段，不能视为 0% 命中。

| 组别 | 第 1 次 | 第 2 次 | 两次输入 SHA256 |
| --- | --- | --- | --- |
| 原始跨启动 | 无计数 | 无计数 | `735fada842d0397e97af9cdbdb453aa1d1a28e9be4d0d15e6bb79b7cedc4ba61`、`5b19a36d1185ee76a53b5ebd0d2d4b4a3fe7f8382004177c15bc88c76617b8de` |
| URL 后移的临时变体 | 无计数 | 28,672 / 32,889 = 87.18% | `893640fb49662ed4a2148c6e36f8e0300564524606ecc1755a069bd53d34`、`0bb4c4bb0a4f9c843f2ba4977f46186865f27422dfbf0b3623b3dad06d676433` |

**已确认：** 早期随机端口是这两次真实教师首轮前缀的唯一可见差异；临时变体让整条 system 跨启动一致，并保留了实时 URL。**未验证：** 原始组第二次的缓存命中率、变体相对原始组的收益、重复冷启动分布和实际账单成本。原始组缺少可比计数，变体单次 87.18% 不能证明优化有效。当前不接入生产 prompt 改写，也不为缓存固定桌面端口；继续按真实会话的稳态用量判定是否值得增加这层维护。

---

## 2026-09-24 · 教师首轮完整消息/工具前缀重放

在隔离教师 `mochi-web`/`lesson-planning` 会话中切到工作模式，使用合成的“四年级水循环课件标题”请求和假 Key 向本机假网关发送一次真实 DSH 请求。只把 `{model,messages,tools}` 白名单写入忽略目录 `probe-log.nosync/036-teacher-work-request.json`（SHA256 `80fe8dff4be0dd5c05a2f74442ad157020b5676cd441fdc8a75e95e56aa261c2`），不保存请求头或 Key。首轮含 1 条 9,542 字符的 system 消息、3 条 user 消息、89 个工具 schema；与下节只有 197 字符宿主 persona 的探针明显不同。用 `--request-file` 重放完整消息和工具，`--nonce` 在第一条 system 前插入随机标记，随后追加 5 轮合成对话。标记使消息前缀唯一，但 MiMo 首轮未回传 usage，无法证实网关没有复用消息前面的工具块。请求的其他参数由探针统一设置，故这是**真实首轮消息/工具前缀 + 合成延续**，不是逐字段原请求或真实长会话。

命令：`node tools/cache-hit-probe.mjs --provider mochi-mimo --request-file probe-log.nosync/036-teacher-work-request.json --turns 6 --nonce`；aiaaa 对照加 `--provider mochi-aiaaa --model deepseek-v4.1-flash`，其余相同。

| 网关 | 第 1 轮 | 第 2–6 轮 | 第 2–6 轮累计 |
| --- | --- | --- | --- |
| MiMo / mimo-v2.5 | usage 未返回 | 99.67%、99.79%、99.92%、99.85%、99.78% | **99.80%**（164,608 / 164,935） |
| aiaaa / deepseek-v4.1-flash | 0% | 99.49%、0%、99.83%、14.62%、98.87% | **62.61%**（87,680 / 140,039） |

**已确认：** MiMo 在这一次完整首轮前缀重放后保持高命中；aiaaa 即使消息/工具前缀稳定，第 3 和第 5 轮仍明显失去缓存，不能承诺它的稳态命中率。**合理推测：** 网关后端路由或缓存状态变化可能参与了波动；本次没有网关内部日志，不能确定原因。**未验证：** 真实教师长会话、多次冷启动的分布、当前 13→96 工具切换在供应商端的缓存命中与费用、每家网关的实际账单成本以及升级前后同输入提升幅度；早期 1→89 本机请求形态见下节，当时结果不能代替当前版本。

---

## 2026-09-24 · 当前教师工作模式工具面实测

在独立临时 `DSH_HOME` 启动当时的教师 `mochi-web` profile，选择 `lesson-planning` 并用 `/mochi-work` 进入工作模式；本机假网关于 2026-09-24 02:00:29（北京时间）收到真实 `chat/completions` 请求。仅保留脱敏的 `tools` 数组及 profile/模式/时间，写入本机忽略目录 `probe-log.nosync/035-request.json`（SHA256 `1b18e54a9484b315a6774c710dc76914f4972d8cf2bf342127515db2ff971c00`）：89 个 schema、JSON 紧凑长度 62,474 字符，含 `mochi_call_student`、`mochi_register_verdicts` 等当时工具。抓包不含消息或 Key。以下两次重放了这份**当时的真实工具面**，但 system 消息仅取 `core.patch.yml` 的 197 字符宿主 persona，后续对话是探针合成的；教师角色的课件 persona、运行时上下文和完整消息未进入重放。因此这不是完整教师请求前缀的实测，也不代表当前 96 项工具面。命令为 `node tools/cache-hit-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash --tools-file probe-log.nosync/035-request.json --turns 6 --nonce`，以及把 provider/model 换成 `mochi-mimo`/`mimo-v2.5`。

| 网关 | 第 1 轮 | 第 2 轮 | 第 3–6 轮 | 第 2–6 轮累计 |
| --- | --- | --- | --- | --- |
| aiaaa / deepseek-v4.1-flash | 0% | 0% | 99.51%、99.45%、99.93%、99.86% | **79.78%**（92,928 / 116,485） |
| mimo / mimo-v2.5 | 命中字段未返回 | 99.89% | 99.82%、99.75%、99.85%、99.78% | **99.82%**（139,968 / 140,223） |

**已确认：** 在“当前教师工作模式工具面 + 简化宿主 persona + 合成对话”这一探针中，MiMo 第 2 轮起达到 99%；aiaaa 仍需要两轮建缓存，第 2–6 轮不达 99%。**未验证：** 完整教师请求前缀、长时间真实桌面会话、不同班级/课件任务、其他角色/模型、模式反复切换后的整体命中率，也没有同输入对照证明本次升级提高了命中率。`cache-hit-probe.mjs` 已修正首轮 usage 缺失时误删第 2 轮的汇总问题；本节比例以逐轮命中/总 prompt 直接复核。

---

## 2026-09-24 · 历史工具面在当前网关上的复测

使用 2026-09-12 保存的 `probe-log.nosync/034-request.json`（89 个工具 schema）与 2026-09-24 的 persona（197 字符），各以 `--turns 6 --nonce` 建冷前缀递进测试。命令分别为 `node tools/cache-hit-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash --tools-file probe-log.nosync/034-request.json --turns 6 --nonce` 与同参数的 `mochi-mimo / mimo-v2.5`。这份抓包**不含本轮新增工具**，不能代表当前完整桌面前缀；它只验证了两个网关在这组固定工具面上的行为。

| 网关 | 第 1 轮 | 第 2 轮 | 第 3–6 轮 | 第 2–6 轮累计 |
| --- | --- | --- | --- | --- |
| aiaaa / deepseek-v4.1-flash | 0% | 0% | 99.38%、99.89%、99.82%、99.75% | **79.80%** |
| mimo / mimo-v2.5 | usage 未返回 | 99.70% | 99.62%、99.79%、99.67%、99.83% | **99.73%** |

**已确认：** 两家在这份固定历史工具面上、缓存建成后都保持高命中；aiaaa 冷启动需要两次请求，按本文“第 2 轮起”的稳态口径没有达到 99%。Mimo 的第 2–6 轮达到 99.73%。当前教师工作模式工具面的补测见上节；真实桌面长会话、切换工具面、长期波动和成本变化仍需同输入对照。没有为追求比例增加预热调用，也没有自动替老师切换模型。

---

## 0. 结论先写

1. **命中率不是性能指标，是成本与可用性指标。** 它衡量的是「同一段前缀有没有被
   按缓存价计费」。prefix 不做缓存，长会话成本线性爆炸。
2. **首轮完整教师消息/工具前缀的合成延续中，只有 MiMo 在第 2–6 轮达到 99%。** MiMo 累计 99.80%；aiaaa 累计 62.61%，且中途有归零和低命中。真实长会话尚未验收。
3. **冷前缀首轮不能作为热缓存证据**（缓存要建，且部分网关首轮不回传 usage）。所以「命中率」必须说明轮次口径；
   拿单轮数字说事会误导。
4. **工具面变化可能降低前缀复用。** 旧的 69→89 工具模拟切换中，aiaaa 换面轮归零，MiMo 仍命中 70.6%；当前本机请求实测为对话 13 个、工作 96 个工具，供应商端切换成本尚未实测。
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

本仓库的 `node tools/verify-cache-hit.mjs` 区分**字段缺失**与**明确回传 0 命中**：缺少 `cacheReadTokens` 的轮次显示 `n/a`，不计入可观测子集；只要稳态任一轮缺计数，整体阈值验收也记为不可判定并退出码 2。子集百分比仅供排查，不能宣称整段会话达标。验收还必须完整读取压缩日志中的所有帧；缺少 `zstd` CLI 时退出码 2，不计算命中率。`npm run test:cache-probe` 覆盖用量和阈值行为、缺失计数，以及缺少 CLI 时的多帧拒绝。

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
| **首轮消息/工具重放** | `node tools/cache-hit-probe.mjs --provider … --request-file <隔离假网关白名单抓包> --turns N --nonce` | 保留首轮真实 system、运行时上下文、user 消息和工具；其后用合成对话。请求其他参数由探针设置 |
| **工具面探针** | `node tools/cache-hit-probe.mjs --provider … --model … --tools-file <本轮抓包> --turns N --nonce` | 用宿主 persona（从 `core.patch.yml` 现读）+ 本轮实际请求里的工具面 + 合成对话；缺少角色 persona 与完整消息。默认抓包还可能过时 |
| **换模型体检** | `node tools/model-compat-probe.mjs --provider … --model …` | 6 项：基础对话 / 工具调用 / 流式 usage / `thinking:{disabled}` / `reasoning_effort` / 图片输入 |

### 2.3 三个必须知道的取数坑

1. **会话日志是多帧 zstd。** 同一份 46,362 字节的日志：
   `zstd -dc` 解出 94,515 字符 / 31 行；Node 的
   `zlib.zstdDecompressSync` 只解出 **183 字符 / 1 行**（只读第一帧）。
   不能用输出是否以换行结尾来检测截断：测试复现了第一帧末尾恰好有换行时，
   Node 只解第一帧会报告 **99%**，而完整三轮日志的稳态命中率实际为 **49.5%**。
   因此 `verify-cache-hit.mjs` 只接受 `zstd -dc` 的全帧解码；找不到 CLI 时退出码 2，
   不计算命中率。验收环境请安装 zstd（macOS 可用 `brew install zstd`）。
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

### 3.2 历史工具面探针 · 冷前缀 · 两种网关对照

当次探针前缀 = 当时的宿主 persona（`core.patch.yml`，3,308 字符）
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
固定未命中尾巴在更长前缀中所占**比例**会变小；这不等于总费用下降，不能为了提高百分比添加无用提示词。

### 3.3 会话中途换工具面（模拟「对话界面 → 工作界面」）

前 3 轮用窄工具面（89 个掐掉 20 个 = 69 个），第 4 轮起换成全量 89 个，
`--switch-at 3 --nonce`：

| | 轮1 | 轮2 | 轮3 | **轮4 换面** | 轮5 | 轮6 |
|---|---|---|---|---|---|---|
| aiaaa / v4.1-flash | 0.00% | 98.57% | 99.21% | **0.00%** | 73.59% | 99.29% |
| mimo / v2.5 | n/a | 99.67% | 99.89% | **70.60%** | 99.88% | 99.81% |

**这是 69→89 工具的模拟切换，不是实际对话→工作路径。** 当时版本的 `mochi-modes` 对话模式只保留 `mochi_request_work_mode` 这 1 个工具；当时工作工具面为 89 个。当前 13→96 见本文开头。工具面属于请求前缀的一部分，但是否整段失效取决于网关和具体前缀，本实验中 MiMo 换面轮仍复用了 70.60%。

- aiaaa：换面那一轮**全价**，第 5 轮还在恢复（73.59%），第 6 轮才回稳态 → 代价 ≈ 2 轮
- mimo：换面那一轮保留 70.60%（块级复用，前缀部分仍命中），下一轮即回 99.88% → 代价 ≈ 1 轮

**设计含义**：保持同一模式内工具面稳定；当前 13→96 模式切换的供应商缓存成本须另测，不能把上述 1–2 轮当成产品保证。

### 3.3a 实际聊天→工作路径的请求形态（本机假网关）

两个全新隔离教师会话使用 fixture Key 和本机假网关：A 在第一轮前执行 `/mochi-work`；B 先在聊天模式发送一轮，再在同一会话执行 `/mochi-work` 并发送相同工作请求。A 的首个工作请求为 4 条消息、89 个工具；B 的聊天请求为 3 条消息、1 个工具，切换后的工作请求为 6 条消息、89 个工具。两份工作请求的 system 文本完全一致（各 9,697 字符），89 个工具 schema 逐字节一致（序列化 63,461 字符，SHA256 均为 `6727244116af5ba2e00604bcb007f6d592d244d61ed46293a8209077d27a1c37`）；B 保留前一轮聊天历史，因此消息列表不等同于 A。聊天态 system 比工作态短 345 字符，不能把它视为完整相同前缀。

首轮抓包曾把一个中文标点误记成 `��`：临时抓包器逐块把 Buffer 当 UTF-8 字符串拼接，恰好截断多字节字符。改为先拼 Buffer 再解码并重新捕获后，该差异消失；产品源码和工具 schema 无需因该乱码改动。本实验只证明当时版本的本机请求形态，假网关没有供应商缓存计数，**不能推导当时 1→89 或当前 13→96 切换的命中率或费用**。

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

## 4. 怎么维护稳定命中（可执行清单）

按"影响从大到小"排：

1. **前缀应逐轮稳定。** 易变内容可能让部分缓存块失效；实际失效范围取决于网关，不能假定总是整段归零。
   - 已核对：`includeRuntimeContext: true` 注入的运行时快照**不含时间戳**，
     内容是「文件策略 + 审批策略 + 工作区路径」，同一会话内稳定 → 安全。
   - 红线：**不要把当前时间、页码、随机 id、每轮重算的统计写进 persona 或工具描述**。
     要放就放到最后一条 user 消息里。
2. **工具面不要无故每轮变。** 见 §3.3 和 §3.3a；历史 1→89 与当前 13→96 的本机请求形态已有证据，当前供应商缓存成本仍待实测。
3. **接受第 1 轮 0%。** 这是机制，不是缺陷。
4. **同时看命中比例和绝对 token 费用。** 历史探针中的未命中尾巴约 150–200 tokens；拉长前缀只会让尾巴的占比变小，未必节省费用。重复请求是否便宜还取决于该网关的缓存计费规则。
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

# 2. 在隔离假网关抓取完整首轮 {model,messages,tools} 后重放；--nonce 建新冷前缀
node tools/cache-hit-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash \
  --request-file probe-log.nosync/036-teacher-work-request.json --turns 6 --nonce

# 3. 仅作历史对照：量 69→89 工具模拟切换（不代表实际 1→89）
node tools/cache-hit-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash \
  --tools-file probe-log.nosync/029-request.json --switch-at 3 --nonce

# 4. 真跑一轮，再从 dsh 自己的会话日志验收（最硬）
DSH_HOME=<临时 home> ./mochi.sh "<一个会用工具的短任务>"
node tools/verify-cache-hit.mjs --home <临时 home> --threshold 0.99
```

**想抓当前工具面**：在隔离 `DSH_HOME` 中用假 Key 接本机假网关，只白名单保存 `tools`。现有 `tools/llm-probe.mjs` 会把请求头写进摘要，其中可能包含 Authorization；不得用它记录真实 Key 的请求。工具面抓包也不等于完整请求前缀，教师角色消息和运行时上下文须另行核对。

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

## 7. 网关能力对照（历史实测与本轮补测）

模型清单和图片能力来自先前的点测，可能随网关更新；缓存行为以本文顶部 2026-09-24 完整消息/工具前缀重放为较新的证据。

| | `mimo.ezlook.top/v1` | `aiaaa.cc/v1` |
|---|---|---|
| 端点模型清单 | `mimo-v2.5`、`mimo-v2.5-pro`、`mimo-v2.5-asr` | `deepseek-v4-flash-0731`、`deepseek-v4-flash-vision-exp`、`deepseek-v4-pro-0813`、`deepseek-v4.1-flash` |
| 流式 usage | ✓（需 `include_usage`） | ✓（需 `include_usage`） |
| 冷启动到热 | 本轮第 2–6 轮连续高命中 | 本轮第 2 轮虽高命中，第 3、5 轮又明显失去缓存；不能给固定轮数 |
| 换工具面后 | 旧 69→89 模拟中保留 70.6%；当前 13→96 仅有本机请求形态证据 | 旧 69→89 模拟中归零；当前 13→96 的供应商缓存未测 |
| 前缀缓存持久性 | 曾观察到跨进程复用 | 曾观察到跨进程复用，本轮同一探针仍有间歇失效 |
| 无数据 URL 图片输入 | ✓（usage 单列图片 token 数） | ✓（不单列） |

---

## 8. 本文不覆盖

- **缓存写价**（cache write / cache miss 的单价差）。本文只讲"命中多少"，
  不讲"命中省了多少钱"——后者要网关的价目表，目前两家都没有公开可核对的档位。
- **上下文窗口与压缩**。见排期文档与 `docs/build-standard.md` 之外的会话策略文档。
- **`tools/verify-cache-hit.mjs` 未进 CI**：它需要真实会话日志，而 CI 里没有。
  它是**验收工具**（人工/发布前跑），不是门禁。门禁是 §4.5 的 4 条断言。
