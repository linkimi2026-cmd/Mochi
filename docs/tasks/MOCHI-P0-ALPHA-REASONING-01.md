# MOCHI-P0-ALPHA-REASONING-01

P0 §6固定alpha源码集成兼容项，唯一实现者Lagrange/p0_baseline_inventory/terra-max；root架构与独立审计。状态待执行。保持当前rc回滚和原BUILD01构建源冻结。

目标：在锁定d347e703908d0406b7a7ef80e3a0e594d86b2215源码的隔离副本中，补齐现有mochi-llm-mimo明确声明的模型档位能力，保留旧wrapper及runtime-profile的配置入口，形成可审查、可重放的最小源码diff，替代rc只改lib且声明不一致的方式。不是重写LLM传输，也不改用户UI/Chat×Work。

复用判断见reuse-audit和p0-alpha-patch-composition-api.md。完整官方Harness/DeepSeekAdapter继续采用；已实际检索并测试的官方PiAI协议PASS，但迁移需处理before/after旧insert、整体config替换、另一个settings namespace、无中文档位配置seam。当前选择在已有adapter扩展明确模型能力声明，维护面限单个包，避免不必要的配置迁移。不得把PiAI描述为协议不兼容或未找到现成方案。

输入已核：现有runtime-profile声明MiMo low默认，模型off/low/medium/high，不含max；固定alpha丢弃reasoningEfforts且serializer拒绝medium。alpha translate已正确保留tool identity，不重复补。旧rc全局medium暴露不是供应商实际支持证明，不能凭此把所有未声明模型都宣称支持medium。

允许写：自己新唯一外部完整源码副本（采用已有普通copy工具、无原树hardlink；copy后核符号链接内部）；其中仅 packages/llm/llm-deepseek/src/{index,adapter,serialize,types}.ts 及该包必要的现有tests与新回归fixtures；artifacts/architect-audit/alpha-reasoning/<timestamp>/中的精确diff/哈希/命令/测试证据。可只读复用原BUILD01已装依赖，禁止改原source/node_modules、clean clone、desktop、plugin、runtime-profile、共享docs或真实home。你不是唯一工作者，Maxwell独立做RUNTIME01，原257tarball全部只读。

语义要求：
- 公开源码类型、schema和resolver一致支持模型reasoningEfforts列表；复制/去重，非空列表保留顺序，空列表遵循已确认旧行为视作未声明。拒绝无效档位，不宽松吞掉拼写错误。不要照搬旧.d.ts不一致。
- MiMo显式off/low/medium/high目录按声明发布，保留关闭/低/中/高/极高名称；配置默认low保留，默认不在声明集合时按旧有确定规则回落到声明最后一项。实际请求的最终effort不在模型集合时在任何HTTP之前拒绝。
- medium经明确模型能力声明后可用，wire保持reasoning_effort:medium与thinking enabled；off发thinking disabled且不发reasoning_effort=off。low/high/max既有wire语义保留，system/扩展/凭据/取消/工具流不改。
- 对未声明reasoningEfforts的普通DeepSeek模型，保留alpha原有off/low/high/max能力集合及medium拒绝，不能无证据扩大全局供应商能力。需从配置到adapter再到serializer一致实现这个边界；不要只扩schema或只改目录。
- 共用adapter上deepseek-official和mochi-mimo遵守各自声明，不把MiMo白名单套给GLM；当前GLM实际端点档位未核验。旧harness.ts的off不等于当前web-host配置事实。

验证：复用该包现有serialize/adapter/dynamic-config tests，新增或调整语义明确的case。现有medium拒绝用例仍应验证未声明能力的默认路径；新增明确声明medium的正例，不能删除负例或简单全部改PASS。验证每模型目录/默认回落/max HTTP前拒绝、normal文本/medium/off wire、配置动态更新last-good snapshot、声明无效值、两route独立性、既有tool identity/abort不回归。使用本地loopback/fixture与独立env-i HOME，无模型联网。执行前先核官方测试命令/runner及实际源码被测入口，不让self-package import偷用旧lib。生成类型需由官方构建，不手改lib/types；本票先完成源码测试与diff，完整official build/pack待root审计授权后再做。

不安装/升级依赖，不修改锁，不跑整仓无关suite，不重build/pack原树。若这四源文件不足、现有公开接口无法表达显式声明边界、需要新增配置字段/跨包改动，先给最小证据返回root，不自行扩大。

交付具体diff（绑定四文件基线hash和固定commit）、测试真实命令/exits/测试数、隔离副本路径、源/生产未变证据，说明旧行为中有依据保留与不保留的部分。最小patch应可在干净固定源上apply --check，不提交git或集成生产。长命令即报告句柄，失败定位后按边界修复，不由root接管编码。

### 语义勘误（实施前root核实）

原“复制/去重”措辞不准确；root亲读冻结rc lib/index.js:1950起，非空reasoningEfforts若有重复即抛错，之后复制数组，不静默去重。本票明确采用严格拒绝重复，保持合法列表原顺序和复制语义，空列表仍视未声明。执行者先前只读报告“去重”需相应更正。此为证据校正，不需要用户重复裁定；增加重复拒绝回归用例。

### 独立审计返修 · 2026-09-07

状态返修，CHANGES REQUIRED：root 源码审计发现，执行者无修改探针确认 thinking=disabled + reasoningEfforts=[low,medium] 被接受且目录发布 off-only，但实际 off 请求 UNSUPPORTED_REASONING_EFFORT、apiKeyCalls=0。有效配置不应宣告无法执行的默认值。

架构裁定：禁用思考是部署限制，只能收窄能力；不得以忽略显式模型声明方式增加 off。resolver 应拒绝 disabled 与非空声明不含 off 的矛盾配置，包含 model id。空/未声明保留原 off-only；含 off 的合法声明在 disabled 下 off wire 成功、其他档位在 HTTP 前拒绝。动态错误更新保持 last-good。原四 src/tests 所有权不变，执行者补回归和文案“high 默认档”的不准确描述。另待核新全局 medium 默认与未声明模型目录/请求一致性，未放行官方 build/pack。

补充裁定：全局 reasoningEffort=medium 与未声明模型同存时，沿用现有目录 high 默认，将 direct stream 有效默认同样规范到 high；未声明显式 medium 请求仍拒绝，明确支持 medium 的模型仍可默认 medium。目录与 transport 共用有效默认 helper，避免新增计算规则。执行者自测修订版 233 PASS；root 发现动态 removes-off 用例仅检查 off-only 目录，旧缺陷也能通过，要求追加错误更新后实际 loopback 请求仍成功/disabled/no reasoning_effort，尚待最终复验。

### 最终独立验收

状态已验收，PASS 限固定外部源码补丁。root session57467 在全新 env-i HOME 独立跑三 spec，233 PASS/exit0，七文件 before/after SHA 相同；亲读最终返修源与 last-good 真实 wire 测试。最终 patch c3e0b4a96e91c79ad49a13f7ddddcb4c7ab792cf419edca5d6db830612e4015c，root 在 clean 固定 clone git apply --check --whitespace=error exit0，在实际副本反向 --check exit0，逐文件当前 SHA 与独立被测输入及 hashes.json 一致。锁未变。执行者 tsc --noEmit exit0，增量 tsbuildinfo 生成后已恢复原字节，源范围恰七文件。

两项行为缺陷和测试假通过缺口均关闭。证据 alpha-reasoning/20260906T213310Z/{RESULT.md,hashes.json,alpha-reasoning.patch} 与 independent-reasoning01。不是生产集成或模型端点验收；后续官方构建与打包按 ALPHA-PATCHED-BUILD01 单独执行。
