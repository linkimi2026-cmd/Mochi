# MOCHI-P5-MEM-03b · 记忆插件补漏：source 参数 + memory_list 工具

> ⚠️ **工具名与状态口径更正（2026-09-12 补加，正文一字未删）**
> - 本文写作时的工具名为**点号形态**（如 `mochi.xxx`）<!-- allow-dotted-tool-name -->，该形态已于 2026-09-12 因模型网关 400 事故**全面禁用**；现行注册名一律下划线（如 `mochi_memory_note` / `mochi_ppt_create` / `mochi_grade_analyze`）。以源码为准，见 `docs/mochi-naming-convention.md` §5。
> - 本文中的插件计数与 PASS 结论均为**写作时点**成立，可能已被后续改动推翻。现状以 `docs/DELIVERY-LEDGER.md` 与源码为准。

> 派发对象：GLM 5.3 flash 实现代理 · 监制：WorkBuddy（只审计不编码）
> 前置：MEM-03 已验收 PASS（监制 2026-09-07 亲自复跑 test.mjs 全绿、逐行核对 index.mjs 与工单契约）。
> 来源：MEM-03 验收两个发现项——① memory_note 未暴露 source 参数，recall 的「为什么Mochi知道这个」永远显示"未注明来源"（方案第 38 章"可检查可纠正"落空一半）；② 无列表工具，老师无法查看"AI 记了我什么"（第二阶段完成判据"可查看"落空）。

## 边界（冻结，越界即打回）

**只允许修改两个文件**：`plugins/mochi-memory/index.mjs`、`plugins/mochi-memory/test.mjs`。
**绝对禁止**：改 world-state.mjs / mem-store.mjs / test-worldstate.mjs / test-memstore.mjs / package.json / symlink；触碰其他目录；npm install；重启服务；git 操作。⚠️ 另一个 WorkBuddy 正在并行改打包链路。

## 修改一：memory_note 加 source 参数

在 `mochi.memory_note` 的 parameters 里加：

```js
source: { type: 'string', enum: ['user_statement', 'repeated', 'explicit_request'], description: '记忆来源：user_statement=主人陈述 / repeated=多次重复 / explicit_request=主人明确要求记住。尽量给；不给的话 recall 里会显示"未注明来源"。' },
```

execute 里透传：`store.note({ kind, content, summary, importance, source: args.source ? String(args.source) : undefined, ... })`。
（mem-store.note 已接受 source 字段，不动 mem-store.mjs。）

## 修改二：新增 mochi.memory_list 工具

契约照 MEM-03 的 register 模式。描述：'列出 Mochi 长期记忆库里的全部记忆和统计（主人问"你记了我什么""让我看看你记住了哪些"时使用）。返回每条记忆的 ID、类型、内容、来源、创建时间、被召回次数和是否 pinned。要如实完整展示，方便主人检查和纠正。'

参数：`scopeId?`（string）、`includeInvalid?`（boolean，默认 false）。

execute：
- 调 `store.listAll({ scopeId, includeInvalid })` + `store.stats()`
- 每行组装与 recall 同款的中文来源标签。**注意：mem-store 的 SOURCE_LABELS 是模块私有不可导入**，在 index.mjs 里自己写一份映射：`user_statement→用户陈述 / repeated→多次重复 / explicit_request→明确要求 / 其他→未注明来源`
- 返回预消化中文摘要：`{ 统计: { 总数, 已激活, 免疫, 已归档, 已取代 }, 记忆列表: [{ 记忆ID, 类型, 内容, pinned, 来源, 创建时间, 被召回次数 }], ...(空库时加 说明: '记忆库还是空的。') }`
- 来源字段与 recall 的「为什么Mochi知道这个」保持同格式：`来源：X；创建于 Y；已被召回 Z 次`

## 测试（test.mjs 追加，不动已有六组）

⑦ note 带 `source: 'repeated'` → recall 返回的「为什么Mochi知道这个」含「多次重复」
⑧ memory_list 返回统计与列表 → 断言总数正确、列表含刚写入的条目；forget 后再 list 该条目消失

运行（监制会亲自复跑）：
`cd /Users/a1379/Documents/Mochi/plugins/mochi-memory && /Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node test.mjs`

## 交付

两个文件 + 测试全绿。汇报：改动清单、测试输出末尾、偏差（应为零）。200 字内。卡死两轮就汇报现状。
