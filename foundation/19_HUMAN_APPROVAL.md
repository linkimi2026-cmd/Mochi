# 19 · 人审（HUMAN_APPROVAL）

## 1. 三档与实现映射

| 档 | 实现 | 事实依据 |
|---|---|---|
| AUTO | answerer 直接返回 `'allowed-once'` | 官方无 `auto` 策略，AUTO 是**我们的 answerer 行为** |
| CONFIRM | answerer 不决策 → 官方 `ui-approval` 卡（web 通道） | 卡片可展示关联工具明细 |
| DENY | answerer 返回 `'rejected'` | 确定性拒绝 |

- 契约：`ctx.waterfall('approval/request', (req, next) => …)`；返回**字符串枚举**
  `allowed-once | rejected | cancelled | unavailable`（R-B1 实测：返回对象→fail-closed）。
- answerer 只见 toolName/reason/callId（官方 payload 无参数）→ 分级按工具名（`11` §4）。
- `never` = 确定性拒绝，**不是自动通过**（P1-2 教训）；现场演示用 `ask`，录屏脚本用
  `demo-auto-approver`（waterfall 对 CONFIRM 返 `'allowed-once'`）。

## 2. 审批事件留痕

官方每次审批写 `approval/asked` + `approval/decided` 会话事件对；Mochi 不重复造审计。

## 3. 限制的如实呈现（给评委/给用户）

- 仅 one-shot grant（无"本次会话记住"）；仅在 open turn 内有效。
- 演示时如遇 SDK 通道：审批不下发（dead capability）→ 演示脚本走 web 通道或 demo-auto-approver。

## 4. 确认卡必须具体（不许"是否确认？"）

```
Mochi 准备：
  把《数学月考试卷.pdf》发送给：林老师
  用途：教学备课
  [发送]  [取消]
```
- CONFIRM 卡文案模板：动作对象 + 接收方 + 用途 + 后果一句话；由任务域提供字段，人格组稿。
- 学生放行类确认卡需显示：学生、目的地、当前状态（OUTBOUND→…），与联动计划 Movement 卡语汇一致。
