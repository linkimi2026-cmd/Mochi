# Mochi 全领域质量标准与提示词加载（更新于2026-09-16）

## 当前结论

本轮将PPT局部改进扩展到问答、研究、教学、文档、表格、视觉、代码/交互及校园操作，并修正了一个已证实的生效问题：**固定版本的角色persona会覆盖全局persona**。

公共标准现在由 `plugins/mochi-hello/work-quality.md` 统一维护，通过独立 `mochi:work-quality` section 注入。角色只维护职责和专门约束，通用质量规则不会再随普通persona覆盖丢失。提示词提升的是行为约束，不是模型权重；已有DeepSeek提示片段对照与真实PPT工具闭环，证明部分能力接线可用；尚不能证明全领域成功率、审美分数或达到旗舰模型水平。

## 自动压缩补充修复

后续定位出自定义角色缺少压缩能力：web-app关闭宿主backend，Mochi五个角色又未挂载。现按官方standard结构补齐独立自动压缩组，并加入科学建模先检索GitHub的任务流程。具体配置、生效边界与验证见[自动压缩说明](context-compaction.md)。前文144项是上一轮验证记录，本次新增7项自动压缩回归。

## 为什么上一轮只改core不够

已安装 `@deepseek-ai/dsh-persona@0.1.3-alpha.1` 的apply使用与全局相同的 `PERSONA_SECTION`。`dsh-system-prompt`按scope合并同名section，预设优先覆盖全局。此前的配置测试仅证明YAML可解析，不能证明合成给模型的最终文本保留通用规则。

本轮没有采用最新上游README的personaPrefix/personaSuffix字段：当前本地版本还不支持该契约。直接跟最新文档改配置会造成无效接入风险。

### 当前链路

```text
core.patch.yml：默认身份（可以被角色替换）
角色agent.cordis.yml：备课/成绩/资料试卷/协同/教室职责
mochi-hello/work-quality.md：独立公共规则节（普通persona替换后仍保留）
当前工具schema与宿主权限：实际能力和操作边界
按需技能与references：任务具体流程
```

`mochi-hello`已在受管角色profile中挂载，复用原插件的注册与生命周期，不新建第二套Harness。规则读取失败会明确导致插件加载失败，不静默当成空文本。打包files名单包含两个新资源，npm pack dry-run已核实。

这不是安全沙箱：可信配置若使用complete persona仍可覆盖整个prompt；第三方插件也能改变组合。因此不能宣称提示词“绝对不可绕过”。管理的五个角色测试明确禁止complete覆盖，实际权限继续由宿主执行。

## 更高标准具体落在哪里

| 领域 | 验收要求 |
| --- | --- |
| 所有任务 | 请求逐项覆盖；有可做的必要步骤就继续，不停在计划或反复请求开工 |
| 问答与研究 | 原文、观点、计算、推测分清；变化信息和陌生名称先查；来源直接支持结论 |
| 文档与试卷 | 回读实际内容；独立解题、查多解、评分点、题号和总分；新Word要配最新PDF |
| 表格与成绩 | 样本、分母、缺失、异常、单位和舍入明确；缓存不等于复算；重要数字交叉核对 |
| PPT与视觉 | 主动看真实图像；全局/细节/修改页按需检查；无法查看则明确未检 |
| 代码与交互 | 接口与失败路径核对，编译不替代行为测试；截图不替代交互；不删测试制造通过 |
| 消息与设备 | 提交、送达、已读分开；超时先查状态，不盲目重发；角色权限不随提示词扩大 |
| 长任务 | 保存最新产物、依据、任务ID和未完成项；恢复先查状态，不重复不确定写入 |
| 纠错 | 有证据才改，复验最新版；同因连续失败换方法；不限制用户后续提出新修改 |
| 表达 | 结果清楚、必要依据完整；默认办公格式不覆盖用户明确的Markdown/源码/HTML请求 |

强约束只用于真实性、授权、关键正确性和验收证据；篇幅、风格与制作顺序保留任务适配空间。避免“所有任务都强制长思考”“无论如何必须成功”这种诱导拖延或虚报的指令。

## 用户指定材料与社区实践

- **Anthropic Fable 5.1**：已核对[官方公开system prompt](https://platform.claude.com/docs/en/release-notes/system-prompts/claude-fable-5-1)和[官方提示指南](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1)。参考任务范围、落实已授权动作与变化信息检索，不迁移产品身份、特定工具或全部产品政策。
- **GPT-5.6 Sol**：阅读用户指定的[GitHub快照](https://github.com/asgeirtj/system_prompts_leaks/blob/b55f7e37b71f076eb3228faa836954b6610046fe/OpenAI/gpt-5.6-sol.md)。它主要包含ChatGPT工具和界面协议；“GitHub公开”不等于OpenAI正式开源。仅研究，不复制工具名、隐藏标记或身份。
- **DeepSeek Harness**：使用[官方组装机制](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/docs/subsystems/system-prompt.md)，并以本地安装源码确认实际兼容性。
- **社区手册**：确认技能可被发现/读取与执行成功是不同事情；社区经验要回到实际工具/轨迹验证。[仓库](https://github.com/sandbaseai/deepseek-harness-handbook/tree/425dd255f9be22c97b2273cd0c38b3951aecddc3)
- **Bayesian-Agent**：参考已验证轨迹与SOP改进思路；不安装其自演化层，不把论文结果外推为Mochi提升率。[仓库](https://github.com/DataArcTech/Bayesian-Agent/tree/4b69b4ed02d166c8d1673ea67e2ac836ac377896)

许可证、维护状态、搜索失败分类和具体取舍见 [reuse-audit.md](reuse-audit.md)。未增加生产依赖、未升级内核或模型、未复制外部整份提示词。

## 当前验证状态

| 要求 | 已有证据 | 尚未证明的部分 |
| --- | --- | --- |
| 所有角色都收到公共规则 | 5个角色真实SystemPrompt组装、隔离、卸载重载；完整standard会话规则哈希匹配 | 不是不可绕过的安全沙箱 |
| 能发现并读取技能 | 目标Harness实际加载8个技能及引用路径 | 加载不等于在所有任务中正确执行 |
| 主动检查真实PPT | DeepSeek Flash自主调用create、inspect、overview/page，返回真实PNG附件 | 不能由单一水循环任务外推所有视觉产物 |
| 根据观察修订 | 13步复测中指出第3页问题、定页修订、重渲最新版；未改页XML一致 | 修改方案本身可能不够好，仍需独立审阅 |
| 有合适工具表达关系 | 9主题、9版式，新增原生可编辑process/newProcess；8步模型复测自主选用并检查循环箭头 | 图片、任意坐标、字号、动画仍无专用参数 |
| 通用真实性和准确性 | DeepSeek片段探针覆盖分母、空结果、未检状态、交付一致性；32通用+14PPT案例 | 无完整46案工具任务成功率，尚无独立留出集 |
| 经验与评测可审阅 | 只读证据校验器、真实轨迹、输入/prompt哈希和产物；测试模板默认未执行 | 不认证评分者身份，不自动晋升或训练权重 |
| 传输和角色边界 | 当前适配器工具/图片传输回归，隔离classroom角色验证 | 用户已安装App未更新、未做生产环境验收 |

### 已运行的检查

`npm run check`最近完整运行通过：131核心+6提示词+5证据+2适配器=144项，0失败/跳过。最终交付前再次运行全套check仍为144项全部通过；46条案例格式与唯一ID核对、git diff --check通过。原生运行时通过校验的临时Electron39.8.10/x64、Koffi和Canvas执行；没有修改用户的正常开发依赖或App。

### 模型证据与失败

用户明确要求全部模型测试使用DeepSeek，后续执行和裁判均遵守，早期MiMo记录排除。具体输入、模型、用量和停止状态保留在各运行目录：

- [策略片段对照](../evals/work-quality/runs/2026-09-15-deepseek-policy)：Flash/Pro各3题、新旧各1次；不是完整角色prompt。平均分正确、未知状态更明确，但Flash仍有“只返回路径→已生成”的过度表述。
- [首轮完整Agent失败](../evals/work-quality/runs/2026-09-15-deepseek-agent-first/README.md)：16次请求后预算停止，渲染依赖失败后错误使用讲义PDF；不能把idle算成功。
- [完整Agent修订复测](../evals/work-quality/runs/2026-09-16-deepseek-agent-retest/README.md)：13次请求完成生成、看图、修改、复验；审美仍有明显不足，工具错误照常记录。
- [原生流程图复测](../evals/work-quality/runs/2026-09-16-deepseek-process/README.md)：8次请求完成，无工具错误，自主选流程图。图示已独立查看，仍有科学简化和交付说明失实；DeepSeek Pro审稿一次预算耗尽、一次漏检，证明裁判也需复核。
- [跨领域交付一致性](../evals/work-quality/runs/2026-09-16-delivery-consistency/README.md)：4次片段响应均正确描述实际工作表与未复算状态；基线也正确，不能声称新规则显著提高成绩。

以上均为开发案例和有限样本。请求数从13到8同时伴随工具、技能、环境变化且每条件只有一次，不构成速度提升或因果效果证明。46案Promptfoo策略对照已完成92份输出、无调用错误；初评旧45/46、新46/46，补齐原题重评变为旧46/46、新45/46。冲突rubric与裁判漏检导致分数不可用于证明提升；定向复核发现新版交付状态和检查范围表述问题，见[完整记录](../evals/work-quality/runs/2026-09-16-cross-domain/README.md)。已澄清4条开发rubric，原成绩保留且不套用于新标准。

### 持续改进与维护成本

维护一个短公共规则文件，领域方法按需读取；保留真实失败、最小修正和回归。规则晋升依据独立证据，不能由done、待办勾选或模型自评触发。权重训练与生产自动演化均未启用。正式独立任务评测应覆盖问答/研究、文档、试卷、表格、视觉、代码/交互及操作状态，逐类报告硬失败和样本量，不能只挑PPT展示。

## 维护入口

- 通用规则与注册：`plugins/mochi-hello/work-quality.md`、`work-quality.mjs`、`index.mjs`。
- 专项方法：`skills/mochi/references/output-checks.md`及8个技能；PPT使用`classroom-deck`。
- 角色差异：`client-plugins/teacher-agent-presets/*/agent.cordis.yml`与教室预设。
- PPT工具：`plugins/mochi-presentations/plugin.mjs`、`render.mjs`、`process-layout.mjs`。
- 本地回归：`npm run check`；付费模型探针需要显式运行`probe-policy-live.mjs`或`probe-agent-live.mjs --run /absolute/new-directory`，不会由check自动调用。
- 复用依据：[reuse-audit.md](reuse-audit.md)；Yan来源核验与采纳取舍：[yan-agent-research.md](yan-agent-research.md)；开发案例和门槛：[评测协议](../evals/work-quality/README.md)。

旧诊断[提示词报告](prompt-quality.md)中的“core是唯一公共提示入口”已由独立section修正。用户已运行的App和旧安装包尚未载入全部修改；开发模式需受管重启并新建会话，独立安装包需重建资源。不能用本地源码通过来宣称生产更新完成。
