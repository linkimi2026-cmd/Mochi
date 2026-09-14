# 16 · Agent 发现（AGENT_DISCOVERY）

## 1. 原则

不做 `if 卷子 → 数学老师`。第一版 = **结构化 Capability Registry + 模型语义判断**。
不上向量库、不上复杂检索（P4 再议）。

## 2. Registry 条目

```jsonc
{
  "agentId": "mochi.zhou",
  "owner": "周老师",
  "role": "SUBJECT_TEACHER",
  "capabilities": ["mathematics", "exam_materials", "teaching_files"],
  "accepts": ["FIND", "ASK", "REQUEST"],
  "autoShare": ["public_materials"],   // 无需审批的域
  "online": true
}
```

示例：信息中心 Mochi = `it_support / projector / classroom_device / campus_network`；
医务 Mochi = `medical_arrival / observation / return_ready`。

## 3. 匹配流程

1. 任务域标签（taskType + 意图关键词由**模型**抽取，非规则表）。
2. Registry 结构化过滤（capability ∈ 需求域、accepts ⊇ taskType、online）。
3. 模型在候选中做语义排序与最终选择（把 registry 摘要给模型，由模型判断"找周老师最合适"）。
4. 未命中 → 如实告知"校园里没有能做这件事的 Mochi"，不硬派。

## 4. v1 实现

- Registry 存本地 sqlite（`mochi_agents` 表，规范保留），单机模拟下含 2–3 个假想 Agent
  （周老师/信息中心/医务），由第二 profile 扮演。
- Registry 更新暂为手工配置（教师无需理解，出厂预配——`21`/`41` 节精神）。
