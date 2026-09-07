# MOCHI-P5-MEM-02 · 记忆第二步：SQLite 衰减记忆层

> 派发对象：GLM 5.3 flash 实现代理 · 监制：WorkBuddy（只审计不编码）
> 依据：Mochi-总体方案.md 第 38–40 章（SimpleMem 式衰减 + Zep 双时态 + MIRIX pinned 免疫 + A-MEM 引用率护栏）
> 边界：**只允许新建/修改两个文件**：`plugins/mochi-memory/mem-store.mjs`、`plugins/mochi-memory/test-memstore.mjs`。禁止动其他任何文件；禁止 npm install；禁止重启 3090/8787 服务；禁止提交 git。

## 目标

实现长期记忆的 SQLite 存储层：五层记忆中的「个人偏好 / 历史工作 / 组织知识」三层落库，
带衰减、双时态冲突消解、pinned 免疫区、引用率护栏和敏感写入护栏。
**纯存储层，不注册工具**（工具注册是 MEM-03 的事）。

## 数据根与模式（冻结）

- 模块：`plugins/mochi-memory/mem-store.mjs`（ESM，零 npm 依赖，`node:sqlite` 的 DatabaseSync）
- DB：`$DSH_HOME/memory/mochi-memories.sqlite`（fallback `~/.mochi-home`）
- **严格照抄 `plugins/mochi-dispatch/store.mjs` 的打开模式**：`defaultDbPath()` / `openStore()`（mkdirSync + WAL + busy_timeout=3000）/ `createStore(db)` 返回 prepared-statement 门面；schema 用 `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 做可加字段迁移。先读它再动手。

## Schema（冻结）

```sql
CREATE TABLE IF NOT EXISTS mochi_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_id TEXT NOT NULL DEFAULT 'global',     -- 作用域预留（按班级/按教师本期未拍板，默认全局单库）
  kind TEXT NOT NULL CHECK (kind IN ('preference','task_fact','org_knowledge','convention')),
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,           -- MIRIX 免疫区：不参与衰减
  importance REAL NOT NULL DEFAULT 0.5,        -- 0..1，写入时给
  strength REAL NOT NULL DEFAULT 1.0,          -- 当前强度；召回命中 +1，封顶 5
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at TEXT,
  valid_at TEXT NOT NULL,                      -- 双时态：事实生效时间
  invalid_at TEXT,                             -- 矛盾时被取代：置位不删除
  created_at TEXT NOT NULL,
  expired_at TEXT,                             -- 衰减低于阈值由系统置位（非删除）
  superseded_by INTEGER,                       -- 取代链 → 新记忆 id
  source TEXT NOT NULL DEFAULT '',             -- user_statement / repeated / explicit_request
  source_task_ids TEXT NOT NULL DEFAULT ''     -- 证据引用（逗号分隔 task id）
);
CREATE TABLE IF NOT EXISTS mochi_memory_events (   -- append-only 审计
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER,
  action TEXT NOT NULL,     -- note/recall/forget/supersede/pin/decay/inject
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mochi_memory_injections (  -- 引用率护栏数据源
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  memory_ids TEXT NOT NULL DEFAULT '',     -- JSON 数组
  injected_count INTEGER NOT NULL DEFAULT 0,
  top_k INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS mochi_memories_fts USING fts5(content, summary, tokenize='trigram');
```

FTS 与主表一致性：note/supersede 新行 INSERT 进 FTS；forget 时 `DELETE FROM mochi_memories_fts WHERE rowid=?`。

## 衰减与召回（冻结参数，常量导出便于测试注入）

- `DECAY_AFTER_DAYS=30` `DECAY_FACTOR=0.05` `MIN_IMPORTANCE=0.15` `STRENGTH_CAP=5` `DEFAULT_TOP_K=8` `TIGHTENED_TOP_K=5`
- 有效分：`ageDays = (now - COALESCE(last_recalled_at, created_at)) / 86400000`；
  `ageDays ≤ 30` → effective = importance；
  超过后每满 30 天 importance × (1-0.05) 线性递减；
  `effective < 0.15` 且 pinned=0 且 expired_at IS NULL → 置 `expired_at`（decay 事件进审计），recall 不再返回。
- 召回命中（该记忆进入某次 recall 的返回集）：`strength=min(strength+1, 5)`、`recall_count+1`、`last_recalled_at=now`（计时归零）。

## API（冻结）

```js
export function defaultDbPath(dshHome = process.env.DSH_HOME): string
export function openStore(dbPath = defaultDbPath()): DatabaseSync
export function createStore(db = openStore(), params = {}): {
  db,
  note({kind, content, summary?, importance?, scopeId?, source?, sourceTaskIds?, pinned?}): {id}  // 敏感护栏见下
  recall(query, {topK?, scopeId?}): {memories: [...], topK, tightened: boolean}
  forget(id): {forgotten: true, snapshot}
  supersede(oldId, newFields): {oldId, newId}          // 事务：旧行 superseded_by+invalid_at，新行 note
  pin(id, pinned: boolean): void
  listAll({scopeId?, includeInvalid?}): rows           -- Memory UI 预留
  stats(): {total, active, pinned, expired, invalid}
  decaySweep(nowMs?): {expiredIds: number[]}           -- 供定时/启动调用，幂等
}
```

## 召回规则（冻结）

1. `query` 去空白后 **长度 ≥3** → FTS5 `MATCH`（trigram，中文子串可用）；**<3** → `content LIKE '%q%' OR summary LIKE '%q%'` 降级。
   （监制已实测 node 22.22 的 node:sqlite：FTS5 可用、trigram 可用、unicode61 对中文无效、trigram 对 <3 字符查询返回空——必须走降级分支。）
2. 只取 `invalid_at IS NULL AND expired_at IS NULL`（可选 scopeId 过滤）。
3. 排序分：`effective_importance × (pinned ? 2 : 1) × 1/(1+daysSinceLastRecall)`，取 topK。
4. **引用率护栏**：读最近 20 条 `mochi_memory_injections`，若其中 `injected_count>0` 的比例 < 20%，本轮回 topK 收紧 8→5 且返回 `tightened:true`。每次 recall 写一条 injections 行（含实际注入数）。
5. 返回的记忆附带 `为什么Mochi知道这个` 字段：`来源（source 中文映射）+ 创建时间 + 召回次数`——方案第 38 章「可检查可纠正」的最小载体。

## 敏感写入护栏（方案第 38 章：成绩明细/医疗/密码/令牌/私人文件全文不进长期记忆）

`note()` 与 `supersede()` 的新内容统一过正则（命中即抛错，消息以『【未写入】敏感内容不进入长期记忆』开头并说明命中类别）：
`密码|password|passwd|token|api[_-]?key|secret|密钥|身份证|成绩.{0,8}(单|明细|排名)|病历|医疗|诊断`

## 测试（test-memstore.mjs，风格同 MEM-01）

必须覆盖：
① note/recall 基本链路（中文长查询走 FTS、2 字查询走 LIKE 降级——各断言命中）
② 敏感护栏六类关键词全抛错
③ supersede 双时态：旧行 invalid_at 置位、recall 不返回旧行、listAll({includeInvalid:true}) 可见
④ 衰减：注入时钟（params 允许传 nowProvider/decay 参数）造 60 天未召回的低 importance 记忆 → decaySweep 置 expired；pinned 同行不置
⑤ 召回命中：strength+1 封顶 5、last_recalled_at 刷新
⑥ 引用率护栏：连写 20 条 injected_count=0 的 injections → 下一次 recall 返回 tightened:true 且 topK=5
⑦ forget：主表+FTS 同步删除、审计行保留快照
⑧ FTS 一致性：supersede 后旧内容 MATCH 不到

运行：`cd /Users/a1379/Documents/Mochi/plugins/mochi-memory && /Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node test-memstore.mjs`
（node:sqlite 的 ExperimentalWarning 属预期，忽略。）

## 交付

两个文件 + 测试全绿。汇报：文件清单、测试输出末尾、与 ticket 的偏差（应为零）。
