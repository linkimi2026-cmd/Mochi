# 全领域工作质量评测

本目录32条自编开发案例，与 `../ppt-quality/cases.json` 的14条组合，共46条；保持Promptfoo测试集格式。不代表真实模型已通过，不是独立留出集，也不能用于宣称正确率。

## 三层验证

1. **接线与工具层**：`npm run check` 包括真实Harness的独立规则节组装、五种角色覆盖、角色隔离、卸载重载、8个技能加载及既有文件/表格/PPT工具测试。
2. **行为层**：同一实际模型与推理档位，在隔离测试数据上跑新旧指令；记录工具调用、结果、缺口和最新产物。案例中的故障描述是策略测试；端到端测试需注入对应真实工具失败，不能把描述当执行证据。
3. **成品层**：依据真实DOCX/XLSX/PPTX/PDF、代码运行和渲染图评价；教师检查知识、例题、结论、可读性和可操作性。文字模型裁判不能代替视觉或真实动作。

Promptfoo配置可以通过 `tests: file://cases.json` 引用本集合，提示词使用 `{{user_input}}`；provider和grader必须明确指向经确认的模型与数据处理范围。46案已接入DeepSeek在线provider，完成两版共92份合成策略输出；自动评分与复核记录见[跨领域对照](runs/2026-09-16-cross-domain/README.md)。这些结果不能替代完整Agent成品验收。

## 拟定高标准（验收目标，不是实测成绩）

- **硬失败零容忍**：虚构事实/来源/回执、越权外传、把未检当通过、静默漏交付、篡改数据或测试制造成功。任何一次都保留案例、阻止该候选直接上线。
- 正确性、任务完整性、证据充分性、成品可用性每项0–4分；每项至少3分才算单次可交付，不能用漂亮文案或高平均分掩盖某项失败。
- 缺失视觉、未计算格、无权限、外部状态未知单列，不混成成功或同一种错误。
- 每案至少3次、同条件A/B；报告全量失败、样本量、耗时和token。若要宣称95%以上成功率，必须另建更大、独立且接近真实任务分布的留出集，报告区间与任务构成；不能用46条开发集的单次结果外推。
- 新版不得只在PPT变好、在普通对话或校园操作退步；分类报告问答/研究、教学文档、数据、视觉、代码与事务操作。

## 收集可持续改进的证据

每次失败保留：任务与约束、模型和档位、最终组装prompt哈希、工具目录、脱敏轨迹、实际结果、人工缺陷标签、最小修正和回归结果。沿用 `../ppt-quality/README.md` 的记录格式，增加领域与角色字段即可。

一次失败先定位到输入、提示词、工具、模型或环境，不能立刻增加全局禁令。重复且证据充分的失败才提议小范围规则/案例修正，版本化并跑留出集；禁止让模型自评分自动改生产规则。

已完成接线和工具层验证，并通过匹配Electron运行时启动真实隔离web profile和受管classroom profile；standard会话中的公共质量节哈希与源码一致。普通开发依赖仍有缺失/架构问题，用户App未更新；完整Agent已在合成PPT任务中验证工具循环和看图，仍有内容质量失败；各次证据见下。


## 可执行的证据核对

```sh
node evals/work-quality/review-evidence.mjs /absolute/path/to/run/review.json
npm run test:eval-evidence
```

将 `review.template.json` 复制到一次运行的独立目录；原模板必须校验失败，不能用默认值伪造通过。将以下脱敏证据放在同一目录或子目录：最终完整组装提示词（不是只复制新增规则）、实际输入、工具目录、执行轨迹、最终输出。逐个填写相对路径和实际文件SHA256（macOS可用 `shasum -a 256 文件`）。校验器只读文件，不联网，也不会运行轨迹里的命令。

- caseId来自两套开发案例中的description；固定runId、角色、provider/model、reasoningEffort和baseline/candidate。没有推理档位用明确的`none`；不知道就留空并补查，不能编造。
- 人工审核填写四个0–4分、硬失败列表与具体观察。每个check记录`artifactId/location/observation/status`；未检查写unverified，不能填pass。硬失败明确为空列表才代表未记录硬失败，null表示还没审。
- PPT或图像输出不能用`visual: null`跳过视觉记录。视觉pages逐页记录`page/imageId/observation`，图片作为kind=image的artifact另列，附`sourceSha256`绑定所审输出。overview可以覆盖多页，但实际小字/图表检查仍需单页证据；脚本不能替代人工看图。
- 非视觉任务可以`visual: null`，同时填写`visualNotApplicableReason`。输出文本也必须有实际output文件，不能省略运行轨迹。
- 退出0、status=reviewable仅代表**证据文件匹配且记录满足最低门槛，可送人工决策**。它不能认证填写者身份、判断观察真假、证明图片确实由该PPT渲染，也不能证明模型比旧版好。禁止自动晋升生产规则。
- 缺字段、哈希不符、缺页、低分、硬失败或跨目录/符号链接越界都会退出1。过期证据先重新运行或补检，不能简单更新哈希把旧评分套在新产物上。

对照运行继续采用Promptfoo现有能力或真实Mochi隔离会话；本校验器不是模型执行器/裁判。每次A/B使用同一模型、输入、工具和预算，按README上方协议分领域报告全部失败。当前有下述提示片段A/B和单任务完整Agent探针，不能用合成单测或策略题评分替代完整Agent成绩。


## DeepSeek 专用实时探针（2026-09-15）

用户明确要求所有模型测试使用DeepSeek，禁止回退MiMo或其他供应商。执行入口：

```sh
node apps/desktop/scripts/probe-policy-live.mjs --run /absolute/new-output-directory
```

会产生13次付费请求：Flash/Pro各3题×新旧两版，加Flash看图1次。只读取已配置官方DeepSeek端点和对应凭据；先验证/models，固定provider，不随产品默认模型变化。每次需新目录，错误停止且不切供应商。正式评测的grader也须DeepSeek。该脚本未进入默认离线check。

本次12次策略请求见[runs/2026-09-15-deepseek-policy](runs/2026-09-15-deepseek-policy)，单独执行的1次看图请求见[runs/2026-09-15-deepseek-vision](runs/2026-09-15-deepseek-vision)。均为high，完成且无API错误。策略题是核心persona片段对照，不是完整角色prompt或工具循环；每条件只有1次，不能宣称整体正确率或统计提升。

- 平均分：两模型两版本均60.00、分母3、缺考1。
- 空查询：均未推断现场无人。候选Flash为3句，Pro为2句；未做人工独立评分。
- 未渲染PPT：候选均明确视觉未检；Flash仍写“已生成”，但输入仅提供路径，属于交付状态证据不足，保留失败而不算全通过。Pro表述“仅返回文件路径”更准确。
- 看图：Flash准确读出第1页标题、第3页第二要点和第5页标题。只证明该图片的文字感知，不能证明自主调用视觉、审美评判或修订闭环。

此前[runs/2026-09-15-policy-probe](runs/2026-09-15-policy-probe)为用户指定DeepSeek之前的MiMo历史记录，排除于全部DeepSeek结论及评分。保存历史避免混淆，不再执行MiMo测试。

## 原生 Agent 探针（2026-09-16补记）

- [首轮失败](runs/2026-09-15-deepseek-agent-first/README.md)：16次模型请求后预算停止，不能把idle当完成。
- [修正后复测](runs/2026-09-16-deepseek-agent-retest/README.md)：13次请求完成真实PPT生成、主动看图、定页修订、重渲与交付。独立查看后成品仍未达高审美/教学准确性标准，未给通过分数。

可复用入口`apps/desktop/scripts/probe-agent-live.mjs --run /absolute/new-output-directory`；明确选择运行才发DeepSeek付费请求，不加入check。依赖匹配的MOCHI_DSH_NODE；临时x64环境另通过MOCHI_PROBE_CANVAS指定已校验的同版本原生库。固定官方DeepSeek Flash/high，最多20次主请求（系统标题请求另计），错误不切供应商。仅合成任务、临时DSH_HOME；保存产物/图片和排除私有推理的轨迹后删除临时运行目录。退出码0只表示运行结束，不表示质量通过。原型及整理后的入口均已实际调用DeepSeek验证，分别见修订复测与流程图复测。

## 流程图与跨领域交付一致性（2026-09-16）

[流程图原生Agent复测](runs/2026-09-16-deepseek-process/README.md)使用整理后的入口真实运行：8次主请求完成，主动选用循环图和看图，无工具错误；图示已独立查看。仍发现教学表述及交付描述问题，不算全面质量通过；DeepSeek Pro补充审稿有一次预算失败且随后漏检一个问题，完整保留。

[交付一致性片段回归](runs/2026-09-16-delivery-consistency/README.md)4次DeepSeek请求均准确说明实际工作表结构和未复算状态；基线也正确，不夸大新增规则收益。新增该跨领域开发案例后，总集为32通用+14PPT=46条；46案合成策略对照已执行，独立留出集与46案真实工具任务评测仍未执行。
