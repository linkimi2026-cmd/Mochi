# MOCHI-P5-MEM-03c · 记忆插件补全：memory_clear 一键清空

> 派发对象：GLM 5.3 flash 实现代理 · 监制：WorkBuddy（只审计不编码）
> 前置：MEM-03/03b 已验收 PASS（8 组测试监制亲自复跑全绿）。
> 依据：第二阶段/README.md 完成判据「老师能……一键清空这些记忆」；总体方案第 13 章「批量处理必须先经老师确认」。

## 边界（冻结，越界即打回）

**只允许修改两个文件**：`plugins/mochi-memory/index.mjs`、`plugins/mochi-memory/test.mjs`。
**绝对禁止**：改 world-state.mjs / mem-store.mjs / test-worldstate.mjs / test-memstore.mjs / package.json / symlink；触碰其他目录；npm install；重启服务；git 操作。⚠️ 另一个 WorkBuddy 正在并行改打包链路与 runtime-profile.json。
**落盘核验**（新纪律，mem03b 实测目录会被并行进程/iCloud 改写）：交付前用 `sed -n` 或 `stat` 复核你的改动确实在磁盘上，grep 结果与磁盘字节不一致时以磁盘为准并重写。

## 新增工具：mochi.memory_clear

契约照 MEM-03 的 register 模式。无参数（或忽略入参）。

描述（冻结，措辞即纪律）：
'清空 Mochi 长期记忆库里的全部记忆（一键清空）。这是批量删除操作：执行前必须先向主人复述"将删除全部 N 条记忆（含 X 条 pinned 免疫记忆）"，获得主人明确同意后才可执行，绝不擅自执行。清空是不可逆的，但审计日志会保留每条记忆的快照备查。'

execute：
- 先 `store.stats()` 拿当前条数与 pinned 数
- `store.listAll({ includeInvalid: true })` 取全部行，逐行 `store.forget(id)`（forget 已留审计快照；pinned 行同样清掉——「一键清空」语义就是全部，描述里已向主人明示 X 条 pinned）
- 返回预消化中文：`{ 已清空: true, 删除条数: N, 其中pinned: X, 说明: '全部记忆已清空，审计日志保留每条快照备查。' }`；空库时 `{ 已清空: true, 删除条数: 0, 说明: '记忆库本来就是空的。' }`

决策记录（验收以此为准，不要再问）：**不接 approval 审批闸**——与 MEM-03「本地低风险读写不走审批闸」保持一致；防误清靠两层：①描述里的复述确认纪律（模型侧）②forget 快照可恢复（数据侧）。

## 测试（test.mjs 追加，已有八组只改①的期望值 5→6，其余不动）

⑨ clear 链路：写入 3 条（含 1 条 pinned）→ clear → 断言返回 删除条数=3、其中pinned=1 → list 返回空库说明 → stats 全 0 → events 审计里有 forget 快照
⑩ 空库 clear：直接 clear → 断言 删除条数=0 且带「本来就是空的」说明

运行（监制会亲自复跑）：
`cd /Users/a1379/Documents/Mochi/plugins/mochi-memory && /Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node test.mjs`

## 交付

两个文件 + 测试全绿 + 落盘核验说明。汇报：改动清单、测试输出末尾、偏差（应为零）。200 字内。卡死两轮就汇报现状。
