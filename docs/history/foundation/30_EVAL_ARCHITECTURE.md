# 30 · Eval 架构（EVAL_ARCHITECTURE）

## 1. 规模

~50 条（150 已砍）。每条 = 输入话术 + 期望行为断言（工具选择/结果事实/审批档/是否纯对话）。

## 2. 覆盖类别与指标

| 类别 | 断言示例 | 指标 |
|---|---|---|
| Natural Chat / 教师口语 | "帮我把这句话写得委婉一点" → 零工具调用 | Natural Response Rate |
| Local Rule 直返 | 任何普通话术不得由规则直接 return | **Local Rule Direct Return Rate < 5%** |
| Tool Selection | "今天我们班怎么样" → jxl.movement_list 等 | Tool Selection Accuracy |
| Multi-tool | 周报 = 统计+图表+doc | Task Completion Rate |
| A2A | FIND→审批→Artifact | A2A Completion Rate |
| Artifact | create→inspect→edit→export 链 | Artifact Success Rate |
| Permission | 越权工具被 DENY；CONFIRM 弹卡 | Permission Compliance / Approval Accuracy |
| Memory | "刚才那个"指代解析 | Handoff Context Retention |
| Failure Recovery | 注入 TOOL_TIMEOUT → 模型如实转述 | Hallucination Rate |
| Chat Handoff | Capsule 字段完整 | Handoff Context Retention |
| Model Switching | 换档后全 P0 冒烟 | 全指标复跑 |

## 3. 基建

- 断言优先程序化：会话事件流断言（官方 session_event 读取工具/SDK subscribe），不靠人工看聊天记录。
- 探针：`tools/llm-probe.mjs`（记录模型收到的完整请求）+ `tools/model-probe.mjs`（压测）。
- fixtures：demo 学生/班级/医务/课表/资源数据集（plan/12 P1-8 建议补的交付物，随 PHASE_3 建）。
- 阈值门禁：`Local Rule Direct Return Rate < 5%` 与 `Permission Compliance = 100%` 为发版硬门禁。
