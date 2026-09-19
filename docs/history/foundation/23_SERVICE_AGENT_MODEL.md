# 23 · 服务 Agent 模型（SERVICE_AGENT_MODEL）

## 1. 域模型

Agent 类型由 Registry 的 capability 集描述，而非代码里的类型分支：

```
AgentRole ≈ { capabilities[], accepts[], ownerType: teacher|student|service }
```

- 服务型 Agent：IT（it_support/projector/classroom_device/campus_network）、Medical
  （medical_arrival/observation/return_ready）、Dorm、Academic Affairs、Resource。
- 第一版只实现：教师 Mochi（真）+ IT/医务（单机模拟扮演）。其余为协议预留。

## 2. 服务 Agent 的特殊性

- 无"主人闲聊"人格负担：面向任务（REQUEST→处理→状态返回）。
- 输出事实化：`{status:"accepted", eta:"…"} 或 {status:"declined", reason:"…"}`，
  由请求方 Mochi 转述。
- 医务 Agent 输出受隐私边界约束（`20` §2）；不输出诊断性内容（红线：不做疾病预警/风险评分）。

## 3. 不做的事（红线继承）

不做硬件、不做心理测评、不做生物识别、不做 GPS；预警只能是流程异常（如流动超时未确认）。
