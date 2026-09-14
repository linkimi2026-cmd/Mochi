# 31 · 金演示（GOLDEN_DEMOS）

> 每条标注：v1 状态（真实/单机模拟/预留）与依赖。

## Demo A · 传话（真实，PRESERVE）
"帮我问问系统管理员明天能不能用多媒体教室。" → 自己 Mochi → 对方 Mochi → **对方主人**点"可以" →
accepted 回话返回。
依赖：联动计划 Relay 语义；v1 在 Mochi 侧以单机模拟复刻（双 profile + mochi_relay_messages 表）。

## Demo B · 找卷子（单机模拟）
"帮我找周老师上次月考的数学卷子。" → 本地搜 → Discovery → FIND → 对方搜 → **对方 Approval**
（具体确认卡）→ PDF Artifact 返回。
依赖：file.search、mochi-registry、mochi-dispatch、Artifact store。

## Demo C · 换课（单机模拟）
"帮我问张老师周五第三节能不能换课。" → ASK → 对方批准 → 回话。
第一版**不偷偷修改正式课表**（只达成口头约定；落课表是 P4）。

## Demo D · 学生医务放行（预留/演示模拟）
学生："我身体不舒服想去医务室。" → Student Mochi → 教师审批 → 嘉行联 Movement（OUTBOUND→…→CLOSED）。
依赖：`22` §3；学生端 P3，演示可用教师代发起。

## Demo E · 投影仪报修（预留/演示模拟）
学生："投影仪打不开。" → Discovery → IT Agent → REQUEST → 处理状态返回。

## Demo F · Chat→Work 全链（P3，评委记忆点）
"明天班会想讲迟到问题，但别做成批评大会。" → 外部免费 Chat 讨论 → "做成 10 页 PPT" → 交给 Mochi →
Bridge 捕获 → Handoff Capsule → `ppt.create` + 嘉行联匿名统计 → inspect → edit → PPT Artifact。
兜底：Selected Text Handoff 永远可用。

## Demo G · 失败fallback链（单机模拟）
"帮我找那份函数卷子，找不到就问周老师。" → Own Tools 失败 → A2A → Artifact →
"顺便做成明天讲评用的 PPT。" → ppt.create(artifact)。

## 演示纪律

- 全部 Demo 断网可跑（演示模式 + demo-auto-approver 预案）；
- CONFIRM 演示必须展示具体确认卡（`19` §4），不许"是否确认？"；
- 每场 Demo 的 Trajectory 可回放（评委追问时的杀手锏）。
