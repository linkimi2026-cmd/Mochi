# PPT 质量评测 v1

## 本轮交付与边界

`cases.json` 是14条自编的开发回归案例，使用 Promptfoo 的 `description / vars / assert` 格式。它们不是用户历史记录，也不是已经通过的模型测试。技能中的5组正反例是上下文示范，不会改变模型权重。

该 JSON 可由 Promptfoo 配置通过 `tests: file://cases.json` 加载；prompt 使用 `{{user_input}}`。需按实际部署提供 provider 与 grader。未提供示例模型 ID 或自动发送请求，以免测错模型或把教师数据发到默认外部裁判。未运行 Promptfoo 模型评分。

**文本测评只能验证策略表述，不能证明工具真的调用，更不能证明画面好看。** 端到端必须在 Mochi 的真实会话中执行，保存实际工具轨迹与最新 PPTX/PNG。

## 执行协议

1. 固定同一模型与版本、推理档位、工具列表、输入素材、字体和 LibreOffice 版本。记录实际生效 persona/skill 哈希，不能只写 Git 提交。
2. 基线使用修改前提示词，候选使用当前提示词；相同案例各跑3次，独立会话，使用不同的新输出目录，保持授权与用户数据一致。不要将全部评分标准注入被测模型。
3. 工具失败场景只能用隔离测试环境或明确的策略模拟，标记 `simulation`；不能把模拟回执计成真实调用成功。
4. 新课件轨迹检查 `create → inspect → render overview → 必要的page`；有缺陷才 `revise → render最新版本`。证据以 tool call/result 和附件为准，不能对自然语言“我检查过”做关键词通过。
5. 审阅者实际打开 PNG，以匿名 A/B 顺序评审；至少一位教师判断内容和教学用途。可以增加视觉模型裁判，但不能让生成模型的自评分成为唯一依据。
6. 分别记录失败样本与通过样本，不丢弃超时、错误或不支持视觉的运行。报告均值、每项通过率、有效样本数和失败原因；14条开发集不足以证明普遍提升。

## 评分表（本项目拟定，待教师校准）

| 维度 | 权重 | 观察证据 |
| --- | --- | --- |
| 内容与任务匹配 | 30 | 事实、页数、目标、推导、引用和来源 |
| 视觉层级与可读性 | 30 | 实际单页渲染的标题、正文、图表标签、对齐、裁切 |
| 叙事与整体一致性 | 20 | 全册推进、模板一致性、内容与布局的匹配 |
| 复核与纠错行为 | 20 | 真实看图覆盖、缺陷定位、最小修正、最新产物复验 |

每项0–4分：0=缺失/严重失效，1=大幅返工，2=可用但明显缺陷，3=满足任务，4=明显优于合格且有具体证据。总分为各项分数/4乘权重。

任何伪造数据、假称看图、缺页、关键文字不可读、越权操作均单列硬失败，总分再高也不能判为可交付。未看图片时视觉分填 `null`，不得填满分或当0分混进审美均值。

同时记录总耗时、输入/输出token、工具调用数、修订数、失败重试数。接口未提供费用或token就记 `null`，不估成实测值。建议候选上线门槛为硬失败不增加、视觉与任务分提高、延迟增幅可接受；具体阈值待样本校准，不把建议冒充实测结论。

## 每次运行记录

```json
{
  "caseId": "targeted-fix",
  "variant": "candidate",
  "run": 1,
  "status": "not_run",
  "simulation": false,
  "model": null,
  "reasoningEffort": null,
  "promptHash": null,
  "tracePath": null,
  "pptxPath": null,
  "imagePaths": [],
  "visualCoverage": [],
  "defects": [],
  "hardFailures": [],
  "scores": {"content": null, "visual": null, "coherence": null, "verification": null},
  "latencyMs": null,
  "inputTokens": null,
  "outputTokens": null,
  "reviewer": null
}
```

## 后续案例库

按课堂讲解、探究练习、数据分析、短答辩各收集5–10份经教师认可、具有复用许可的真实样稿作为起点。保留PPTX、渲染图、页级功能、设计理由与失败对照；不要只收漂亮截图或只写风格词。

按完整课件/课程主题划分开发与独立留出集，同一模板的近重复页不要跨集合。当前14条公开开发用例不能当独立测试集，也不把隐藏评测答案放入技能。样稿按任务检索1–2组即可，不把所有图片每次塞进提示词。

资料参考：[Promptfoo配置](https://github.com/promptfoo/promptfoo/blob/29a15d1edb256c789d0035ce3f36ad7cf91db6bb/site/docs/configuration/guide.md)、[PPTAgent](https://github.com/icip-cas/PPTAgent/tree/2419d30b134a71486523e95ded60b32489fd3c61)。本目录不引入新运行依赖。
