# 第二阶段 —— 记忆系统

> 建立时间：2026-09-06 15:0x
> 前置：**1.5 阶段全部收口后才开工**（尤其第 5 步双击验收通过）。
> 调研基础：`./记忆系统调研_2026-09-06.md`（完整报告，同目录；论文机制 + 开源横评，已交叉核实）

## ⚠️ 待确认

这个文件夹是按「第二个任务 = 记忆系统」建的。如果指的是别的事，说一声我改名换内容。

---

## 为什么是它

`Mochi-方案总纲.md` 全文搜「记忆 / memory」**零命中** —— 记忆层是空白。
但 `mochi_tasks` 表已经是事件流雏形（`from_user_id` / `to_peer_name` / `goal` / `status` / `created_at` / `completed_at`）。

缺的是把事件压缩成「当前世界状态」的那层。

**不是图。** Archify 画的是拓扑（谁连谁，静态）；AI 的记忆要的是事件流（发生了什么，动态）。
拿平面图当值班日志，是数据结构错配。

## 三个待决（问过，还没回）

| # | 问题 | 选项 |
|---|---|---|
| Q1 | 第一版记什么 | ① 老师**当前待办**（明早简报能直接念出来）② **系统自身结构**（AI 知道 Mochi 有哪些能力） |
| Q2 | 技术栈 | ① 引 **Python 子进程**跑 SimpleMem ② 纯 Node，照它思路写 **TS 版约 300 行** |
| Q3 | 作用域 `scope_id` | 按班级 / 按教师 / 全局单库 |

## 落地两步

### 第一步：`world-state.md`（1–2 天，纯文件零依赖）

```
world-state.md     ← AI 每次醒来只读这一个文件，200 行封顶
  待办：3 条外出申请待批（张三/李四/王五）
  近 24h：已批 2 条、拒 1 条、转医务室 1 条
  已知约定：外出申请必须老师批，AI 不代批

events/*.jsonl     ← append-only 原始事件，只追加不改
```

### 第二步：SQLite 衰减 + 冲突消解（3–5 天）

**先不上向量。** SQLite FTS5 对 glm-4-flash 这个量级够用且零依赖，真需要时再上 sqlite-vec。

```sql
CREATE TABLE mochi_memories (
  id              INTEGER PRIMARY KEY,
  scope_id        TEXT    NOT NULL,          -- Q3 决定
  content         TEXT    NOT NULL,
  kind            TEXT    NOT NULL,          -- fact | episode | preference
  pinned          INTEGER DEFAULT 0,         -- 免疫清单，永不衰减（MIRIX Knowledge Vault）
  strength        REAL    DEFAULT 1.0,       -- R = exp(-t/S)（MemoryBank）
  recall_count    INTEGER DEFAULT 0,         -- S，每次被引用 +1
  last_recalled_at TEXT,
  valid_at        TEXT,                      -- 双时态（Zep）
  invalid_at      TEXT,                      -- 置位 = 被取代，行保留不删
  superseded_by   INTEGER,                   -- 取代链（SimpleMem）
  source_task_ids TEXT,                      -- JSON，证据引用（Generative Agents）
  created_at      TEXT    NOT NULL
);
-- 另：mochi_memory_events（append-only 审计）
--     mochi_memory_injections（引用率护栏数据源）
--     FTS5 虚表
```

## 四条不能违反的硬规则

1. **引用率护栏**：连续 20 次对话引用率 < 20% → 判定上下文污染，收紧 top-k。
   A-MEM 消融实验：无链接无演化 F1 **9.65**，不做记忆的基线是 **25.02** —— 记忆做得糙会**拖垮**模型。
2. **不删只取代**：新信息推翻旧记忆时置 `invalid_at`，保留原行可溯源（"张三销假"）。
3. **免疫清单**：安全规则、老师显式要求记住的事，`pinned=1` 永不衰减。
4. **隐私红线**：记任务不记人、记结果不记轨迹；老师能打开看 AI 记了啥、能一键清空、本地存储不上云。

## 完成判据

> 关掉 Mochi 再打开，它能说出「上次你批了张三的外出申请，还有两条没批」，
> 并且老师能在设置页看到、修改、清空这些记忆。
