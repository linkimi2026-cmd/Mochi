# MOCHI-P5-MEM-01 · 记忆第一步：world-state.md + events JSONL

> 派发对象：GLM 5.3 flash 实现代理 · 监制：WorkBuddy（只审计不编码）
> 依据：Mochi-总体方案.md 第 38–40 章（第一步 1-2 天：纯文件，AI 每次读 ≤200 行 + events append-only）
> 边界：**只允许新建/修改两个文件**：`plugins/mochi-memory/world-state.mjs`、`plugins/mochi-memory/test-worldstate.mjs`。禁止动其他任何文件；禁止 npm install；禁止重启 3090/8787 服务；禁止提交 git。

## 目标

实现 Mochi 记忆系统第一步的纯文件层：工作状态快照（world-state.md）+ 原始事件流（events/*.jsonl）。
这是「当前任务」层记忆的载体：待办、近 24h 变更、已知约定，AI 每次对话可读。

## 文件与数据布局（冻结）

- 模块：`plugins/mochi-memory/world-state.mjs`（ESM，零 npm 依赖，只用 node:fs/node:path）
- 数据根（与 mochi-dispatch 的 `defaultDbPath` 同模式）：
  - `$DSH_HOME/memory/world-state.md`（DSH_HOME 未设时 fallback `~/.mochi-home`）
  - `$DSH_HOME/memory/events/YYYY-MM-DD.jsonl`（append-only，一天一个文件）

## API（冻结，MEM-03 整合代理将按此消费）

```js
export function defaultMemoryHome(dshHome = process.env.DSH_HOME): string
export function openWorldState(homeDir = defaultMemoryHome()): {
  homeDir: string,
  readWorldState(): string,                          // 全文；文件不存在时先写骨架再返回
  replaceSection(section: 'todos'|'changes'|'conventions', lines: string[]): void,
  appendTodo(text: string): void,                    // 进「待办」段
  completeTodo(text: string): boolean,               // 按文本匹配移除，返回是否命中
  appendChange(text: string): void,                  // 进「近 24h 变更」段，自动带 ISO 时间戳前缀
  setConvention(text: string): void,                 // 进「已知约定」段（同文本去重）
  appendEvent(event: {kind: string, summary: string, refs?: string[], actor?: string}): void,
  readEvents(opts?: {date?: string, limit?: number}): object[],  // 缺省读今天，limit 默认 100
}
```

## 硬规则

1. **world-state.md 骨架**（缺文件/缺段落时自动补齐，容错坏文件）：
   ```
   # Mochi 工作状态
   > 本文件由 mochi-memory 维护，≤200 行；历史变更滚动到 events/*.jsonl，不丢记录。

   ## 待办
   ## 近 24h 变更
   ## 已知约定
   ```
2. **200 行硬上限**：追加变更后超过 200 行时，把「近 24h 变更」段最老的条目逐条滚出，
   每滚一条先 `appendEvent({kind:'change-archive', summary: 该条目})` 再删行——**绝不静默丢历史**。
3. **原子写**：所有写文件走 tmp + rename（同目录 `.tmp-` 前缀），防半写。
4. **events JSONL**：一行一个 JSON 对象 `{ts, kind, summary, refs, actor}`，ts 由模块补 ISO 时间；
   只追加，绝不重写/删除已有行。
5. 中文注释、无 emoji、无 `console.log` 噪音（测试文件除外）。

## 测试（test-worldstate.mjs，照 `plugins/mochi-dispatch/test.mjs` 风格：console.log 分组 + node:assert/strict + mkdtempSync 隔离）

必须覆盖：
① 骨架生成与幂等（重复 open 不重复写骨架）
② 段落替换/追加/完成待办
③ 200 行滚动：造超限，断言最老条目进了 events 且文件 ≤200 行
④ events 追加 + 按日期读取 + limit
⑤ 坏文件容错（手写一个缺段落的 world-state.md，open 后段落补齐且原有内容不丢）
⑥ 原子写不留 `.tmp-` 残留

运行方式（监制会亲自复跑）：
`cd /Users/a1379/Documents/Mochi/plugins/mochi-memory && /Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node test-worldstate.mjs`

## 交付

两个文件 + 测试全绿。在汇报里给出：文件清单、测试输出末尾、API 与 ticket 的偏差（应为零）。
