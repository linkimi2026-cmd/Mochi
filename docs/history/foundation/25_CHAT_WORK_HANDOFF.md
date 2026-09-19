# 25 · Chat↔Work 交接（CHAT_WORK_HANDOFF）

## 1. 用户体验铁律

**不允许复制粘贴。** 老师："就这个思路，做成 PPT。" → 交给 Mochi → Work 自动接棒。
支持双向循环：Work 产出 PPT → 老师回 Chat 讨论"第三页太严肃了" → "按刚才说的改" →
Work 拿现有 Artifact → `ppt.edit_slide`（不重做）。

## 2. Handoff Compiler

输入 ChatTranscript → 输出 **Work Handoff Capsule**：

```
Goal · Context · Decisions · Constraints · Deliverables
Attachments · RelevantMessages · UnresolvedQuestions · Source
```

- 例：Goal=制作班会 PPT；Decisions=不做批评式表达/从实际情境切入；Constraints=约 10 页/学生匿名；
  Deliverables=PPTX。
- 编译由模型完成（一次性 Work 会话任务）；超长输入先按节摘要，保留 Decisions/Constraints 全文。
- Capsule 作为会话事件写入（模型可见即已记录），随后 Work 循环消费。

## 3. 隐私与确认

- 默认不采集；只有用户点"交给 Mochi"才读取。
- 发送前必须 **Preview**：将带入多少消息、哪些附件、来源是哪次会话 → 用户 Confirm。

## 4. 上下文归属

CONTEXT BELONGS TO MOCHI：Transcript/Capsule/Artifact/用户上下文都在 Mochi 层；
Chat Provider A→B、Work Model C 任意换，工作连续性不散（与 `10` 互为印证）。
