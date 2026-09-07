# 22 · 学生 Agent 模型（STUDENT_AGENT_MODEL）

## 1. 原则

同一个 Runtime；差别只在 Identity / Scope / Available Tools / Permissions。
域模型**不写死 TeacherAgentOnly**（`23`）。

## 2. 学生侧场景（P3，协议预留）

- 学生 Mochi 是受控角色：默认工具集 = 通用学习辅助（文件/资料检索/写作），**无**校园写权限、
  无其他学生数据、无管理面。
- 不批准自己：`jxl.movement_approve` 不在学生工具白名单（DENY 档）。

## 3. 医务放行流（Golden Demo D）

```
学生："我身体不舒服，想去医务室。"
→ Student Mochi 创建 Movement Request（APPROVE 原语）
→ Agent Discovery 找到当前负责教师 Mochi（班主任/值班）
→ 教师侧 CONFIRM 卡（学生/目的地/时间）→ 教师点击批准
→ 嘉行联 Movement（createMovement = 教师放行，approved_by 记录）
→ 状态机 OUTBOUND →（到达确认）→ RETURNING →（返班确认）→ CLOSED
```

- 学生端不落地前，本流程可在演示中以"教师代发起 + 学生机仅展示"模拟；状态机不动。

## 4. 其他学生派发（协议预留，P3+）

- 找卷子 → FIND（走同 `14` 协议）。
- 投影仪坏了 → Discovery→IT Agent→REQUEST。
- 问老师时间 → 只返回允许公开的 availability（隐私边界）。
