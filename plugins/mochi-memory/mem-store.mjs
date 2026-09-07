// Mochi 长期记忆存储层（工单 MOCHI-P5-MEM-02）。
// 五层记忆中的「个人偏好 / 历史工作 / 组织知识」三层落库：
// SimpleMem 式衰减 + 双时态冲突消解（supersede 置位不删除）
// + MIRIX pinned 免疫区 + 引用率护栏 + 敏感写入护栏。
// 纯存储层，不注册工具（工具注册是 MEM-03 的事）。
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 冻结参数（工单 MOCHI-P5-MEM-02），导出便于测试注入对照。
export const DECAY_AFTER_DAYS = 30;
export const DECAY_FACTOR = 0.05;
export const MIN_IMPORTANCE = 0.15;
export const STRENGTH_CAP = 5;
export const DEFAULT_TOP_K = 8;
export const TIGHTENED_TOP_K = 5;

// 引用率护栏：读最近 20 条 injections，injected_count>0 的比例 < 20% 则本轮回 topK 收紧。
const CITATION_WINDOW = 20;
const CITATION_MIN_RATIO = 0.2;

const KINDS = new Set(['preference', 'task_fact', 'org_knowledge', 'convention']);
// 「为什么Mochi知道这个」的来源中文映射（方案第 38 章：可检查可纠正）。
const SOURCE_LABELS = {
  user_statement: '用户陈述',
  repeated: '多次重复',
  explicit_request: '明确要求',
};

const SCHEMA = `
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
`;

// 敏感写入护栏（方案第 38 章）：成绩明细/医疗/密码/令牌/身份证等不进长期记忆。
// 与工单正则 `密码|password|passwd|token|api[_-]?key|secret|密钥|身份证|成绩.{0,8}(单|明细|排名)|病历|医疗|诊断`
// 等价，按类别拆开以便报错时说明命中类别。
const SENSITIVE_RULES = [
  ['密码/口令/令牌/密钥类', /密码|password|passwd|token|api[_-]?key|secret|密钥/i],
  ['身份证件信息', /身份证/],
  ['成绩单/成绩明细/成绩排名', /成绩.{0,8}(单|明细|排名)/],
  ['病历/医疗/诊断信息', /病历|医疗|诊断/],
];

// 命中即抛错，消息以『【未写入】敏感内容不进入长期记忆』开头并说明命中类别。
function assertNotSensitive(text) {
  const value = String(text ?? '');
  for (const [label, pattern] of SENSITIVE_RULES) {
    if (pattern.test(value)) {
      throw new Error(`【未写入】敏感内容不进入长期记忆：命中${label}。`);
    }
  }
}

// 与 mochi-dispatch/store.mjs 相同的模式：CREATE TABLE IF NOT EXISTS 建表，
// 再用 PRAGMA table_info 做可加字段迁移（老库缺列时补列，不改动已有数据）。
const MEMORY_COLUMNS = [
  ['scope_id', "TEXT NOT NULL DEFAULT 'global'"],
  ['kind', "TEXT NOT NULL DEFAULT 'preference'"],
  ['content', "TEXT NOT NULL DEFAULT ''"],
  ['summary', "TEXT NOT NULL DEFAULT ''"],
  ['pinned', 'INTEGER NOT NULL DEFAULT 0'],
  ['importance', 'REAL NOT NULL DEFAULT 0.5'],
  ['strength', 'REAL NOT NULL DEFAULT 1.0'],
  ['recall_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_recalled_at', 'TEXT'],
  ['valid_at', "TEXT NOT NULL DEFAULT ''"],
  ['invalid_at', 'TEXT'],
  ['created_at', "TEXT NOT NULL DEFAULT ''"],
  ['expired_at', 'TEXT'],
  ['superseded_by', 'INTEGER'],
  ['source', "TEXT NOT NULL DEFAULT ''"],
  ['source_task_ids', "TEXT NOT NULL DEFAULT ''"],
];

function ensureSchema(db) {
  db.exec(SCHEMA);
  const columns = new Set(db.prepare('PRAGMA table_info(mochi_memories)').all().map((column) => column.name));
  for (const [name, ddl] of MEMORY_COLUMNS) {
    if (!columns.has(name)) db.exec(`ALTER TABLE mochi_memories ADD COLUMN ${name} ${ddl}`);
  }
}

export function defaultDbPath(dshHome = process.env.DSH_HOME) {
  const home = dshHome || join(process.env.HOME || '/tmp', '.mochi-home');
  return join(home, 'memory', 'mochi-memories.sqlite');
}

export function openStore(dbPath = defaultDbPath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 3000;');
  ensureSchema(db);
  return db;
}

const iso = (ms) => new Date(ms).toISOString();

function requireMemoryId(id, label = '记忆 ID') {
  const value = Number(id);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} 无效。`);
  return value;
}

export function createStore(db = openStore(), params = {}) {
  ensureSchema(db);
  // 可注入参数：测试用 nowProvider 造衰减，不必真的等 30 天。
  const p = {
    nowProvider: params.nowProvider || (() => Date.now()),
    decayAfterDays: params.decayAfterDays ?? DECAY_AFTER_DAYS,
    decayFactor: params.decayFactor ?? DECAY_FACTOR,
    minImportance: params.minImportance ?? MIN_IMPORTANCE,
    strengthCap: params.strengthCap ?? STRENGTH_CAP,
    defaultTopK: params.defaultTopK ?? DEFAULT_TOP_K,
    tightenedTopK: params.tightenedTopK ?? TIGHTENED_TOP_K,
  };

  const getStmt = db.prepare('SELECT * FROM mochi_memories WHERE id = ?');
  const insertStmt = db.prepare(`INSERT INTO mochi_memories
    (scope_id, kind, content, summary, pinned, importance, valid_at, created_at, source, source_task_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertFtsStmt = db.prepare('INSERT INTO mochi_memories_fts(rowid, content, summary) VALUES (?, ?, ?)');
  const deleteFtsStmt = db.prepare('DELETE FROM mochi_memories_fts WHERE rowid = ?');
  const insertEventStmt = db.prepare('INSERT INTO mochi_memory_events (memory_id, action, detail, created_at) VALUES (?, ?, ?, ?)');
  const insertInjectionStmt = db.prepare('INSERT INTO mochi_memory_injections (query, memory_ids, injected_count, top_k, created_at) VALUES (?, ?, ?, ?, ?)');
  const lastInjectionsStmt = db.prepare('SELECT injected_count FROM mochi_memory_injections ORDER BY id DESC LIMIT ?');
  const hitStmt = db.prepare('UPDATE mochi_memories SET strength = ?, recall_count = recall_count + 1, last_recalled_at = ? WHERE id = ?');

  function insertEvent(memoryId, action, detail, at) {
    insertEventStmt.run(memoryId, action, String(detail || ''), at);
  }

  // 衰减有效分：ageDays 以「最近召回时间，没有则创建时间」起算；
  // 不超过 DECAY_AFTER_DAYS 不衰减，之后每满一个周期 importance × (1-DECAY_FACTOR)。
  function effectiveImportance(row, nowMs) {
    const refMs = Date.parse(row.last_recalled_at || row.created_at);
    const ageDays = (nowMs - refMs) / 86400000;
    if (!(ageDays > p.decayAfterDays)) return row.importance;
    const steps = Math.floor(ageDays / p.decayAfterDays);
    return row.importance * Math.pow(1 - p.decayFactor, steps);
  }

  function normalizeSourceTaskIds(raw) {
    if (Array.isArray(raw)) return raw.map(String).join(',');
    return String(raw || '');
  }

  // 写入一行新记忆（含 FTS 同步与 note 审计），note 与 supersede 共用。
  function insertMemory({ kind, content, summary = '', importance, scopeId = 'global', source = '', sourceTaskIds = '', pinned = false }, at) {
    if (!KINDS.has(kind)) throw new Error(`未知记忆类型：${kind}（允许 preference/task_fact/org_knowledge/convention）。`);
    if (!String(content ?? '').trim()) throw new Error('记忆内容不能为空。');
    const rawImportance = importance === undefined ? 0.5 : Number(importance);
    const clamped = Number.isFinite(rawImportance) ? Math.min(1, Math.max(0, rawImportance)) : 0.5;
    const info = insertStmt.run(String(scopeId || 'global'), kind, String(content), String(summary || ''),
      pinned ? 1 : 0, clamped, at, at, String(source || ''), normalizeSourceTaskIds(sourceTaskIds));
    const id = Number(info.lastInsertRowid);
    insertFtsStmt.run(id, String(content), String(summary || ''));
    insertEvent(id, 'note', `${kind}：${String(content).slice(0, 80)}`, at);
    return id;
  }

  function inImmediateTransaction(run) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* BEGIN 失败时没有事务需要回滚。 */ }
      throw error;
    }
  }

  // 引用率护栏：最近 CITATION_WINDOW 次 inject 里 injected_count>0 的比例低于阈值则收紧。
  function shouldTighten() {
    const rows = lastInjectionsStmt.all(CITATION_WINDOW);
    if (!rows.length) return false;
    const used = rows.filter((row) => Number(row.injected_count) > 0).length;
    return used / rows.length < CITATION_MIN_RATIO;
  }

  return {
    db,
    // 写入一条记忆。敏感护栏命中即抛错，内容与摘要都不过闸。
    note(input) {
      assertNotSensitive(input.content);
      assertNotSensitive(input.summary);
      const at = iso(p.nowProvider());
      return { id: insertMemory(input, at) };
    },

    // 召回：query 去空白后长度 ≥3 走 FTS5 MATCH（trigram 中文子串可用），
    // <3 走 LIKE 降级（trigram 对 <3 字符查询返回空）。每次 recall 都写一条 injections 行。
    recall(query, { topK, scopeId } = {}) {
      const nowMs = p.nowProvider();
      const at = iso(nowMs);
      const q = String(query ?? '').trim();
      const tightened = shouldTighten();
      const effectiveTopK = Math.max(1, Math.min(100, Number(topK) || (tightened ? p.tightenedTopK : p.defaultTopK)));
      if (!q) {
        insertInjectionStmt.run(q, '[]', 0, effectiveTopK, at);
        return { memories: [], topK: effectiveTopK, tightened };
      }
      const scopeClause = scopeId ? ' AND m.scope_id = ?' : '';
      const scopeArgs = scopeId ? [String(scopeId)] : [];
      let rows;
      if ([...q].length >= 3) {
        // trigram 短语查询：双引号包裹并转义内部引号，避免用户输入破坏 MATCH 语法。
        const match = `"${q.replace(/"/g, '""')}"`;
        rows = db.prepare(`SELECT m.* FROM mochi_memories m
          JOIN mochi_memories_fts f ON f.rowid = m.id
          WHERE mochi_memories_fts MATCH ? AND m.invalid_at IS NULL AND m.expired_at IS NULL${scopeClause}`)
          .all(match, ...scopeArgs);
      } else {
        const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
        rows = db.prepare(`SELECT m.* FROM mochi_memories m
          WHERE (m.content LIKE ? ESCAPE '\\' OR m.summary LIKE ? ESCAPE '\\')
            AND m.invalid_at IS NULL AND m.expired_at IS NULL${scopeClause}`)
          .all(like, like, ...scopeArgs);
      }
      // 排序分：有效分 × (pinned ? 2 : 1) × 1/(1+距上次召回天数)。
      const scored = rows.map((row) => {
        const effective = effectiveImportance(row, nowMs);
        const refMs = Date.parse(row.last_recalled_at || row.created_at);
        const daysSince = Math.max(0, (nowMs - refMs) / 86400000);
        return { row, effective, score: effective * (row.pinned ? 2 : 1) / (1 + daysSince) };
      }).sort((a, b) => b.score - a.score).slice(0, effectiveTopK);
      const memories = scored.map(({ row, effective }) => {
        // 召回命中：strength+1 封顶、recall_count+1、last_recalled_at 归零重计。
        const strength = Math.min(Number(row.strength) + 1, p.strengthCap);
        hitStmt.run(strength, at, row.id);
        row.strength = strength;
        row.recall_count = Number(row.recall_count) + 1;
        row.last_recalled_at = at;
        insertEvent(row.id, 'recall', `查询「${q}」命中`, at);
        const sourceLabel = SOURCE_LABELS[row.source] || '未注明来源';
        return {
          ...row,
          effective_importance: effective,
          '为什么Mochi知道这个': `来源：${sourceLabel}；创建于 ${row.created_at}；已被召回 ${row.recall_count} 次`,
        };
      });
      const ids = memories.map((row) => row.id);
      insertInjectionStmt.run(q, JSON.stringify(ids), ids.length, effectiveTopK, at);
      insertEvent(null, 'inject', JSON.stringify({ query: q, injected: ids.length, topK: effectiveTopK, tightened }), at);
      return { memories, topK: effectiveTopK, tightened };
    },

    // 双时态冲突消解：旧行 superseded_by+invalid_at 置位（不删除），新行走 note 全流程。
    supersede(oldId, newFields) {
      const id = requireMemoryId(oldId, '被取代的记忆 ID');
      assertNotSensitive(newFields.content);
      assertNotSensitive(newFields.summary);
      const old = getStmt.get(id);
      if (!old) throw new Error(`记忆 #${id} 不存在。`);
      if (old.invalid_at) throw new Error(`记忆 #${id} 已被取代，不能再次取代。`);
      return inImmediateTransaction(() => {
        const at = iso(p.nowProvider());
        // 未覆盖的语义字段从旧行继承（蛇形列名映射回入参驼峰名），内容已过敏感护栏。
        const newId = insertMemory({
          kind: newFields.kind ?? old.kind,
          content: newFields.content,
          summary: newFields.summary ?? old.summary,
          importance: newFields.importance ?? old.importance,
          scopeId: newFields.scopeId ?? old.scope_id,
          source: newFields.source ?? old.source,
          sourceTaskIds: newFields.sourceTaskIds ?? old.source_task_ids,
          pinned: newFields.pinned ?? Boolean(old.pinned),
        }, at);
        db.prepare('UPDATE mochi_memories SET superseded_by = ?, invalid_at = ? WHERE id = ?').run(newId, at, id);
        deleteFtsStmt.run(id); // FTS 一致性：旧内容不再可被 MATCH。
        insertEvent(id, 'supersede', `被新记忆 #${newId} 取代`, at);
        return { oldId: id, newId };
      });
    },

    // forget：主表+FTS 同步删除，审计行保留完整快照（置位/留痕，不静默消失）。
    forget(id) {
      const memoryId = requireMemoryId(id);
      const row = getStmt.get(memoryId);
      if (!row) throw new Error(`记忆 #${memoryId} 不存在。`);
      const at = iso(p.nowProvider());
      db.prepare('DELETE FROM mochi_memories WHERE id = ?').run(memoryId);
      deleteFtsStmt.run(memoryId);
      insertEvent(memoryId, 'forget', JSON.stringify(row), at);
      return { forgotten: true, snapshot: row };
    },

    // MIRIX 免疫区开关：pinned=true 的记忆不参与衰减。
    pin(id, pinned) {
      const memoryId = requireMemoryId(id);
      const row = getStmt.get(memoryId);
      if (!row) throw new Error(`记忆 #${memoryId} 不存在。`);
      const flag = pinned ? 1 : 0;
      db.prepare('UPDATE mochi_memories SET pinned = ? WHERE id = ?').run(flag, memoryId);
      insertEvent(memoryId, 'pin', `pinned=${flag}`, iso(p.nowProvider()));
    },

    // Memory UI 预留：默认隐藏已取代（invalid_at 置位）的行，includeInvalid 时可见。
    listAll({ scopeId, includeInvalid } = {}) {
      const clauses = [];
      const args = [];
      if (!includeInvalid) clauses.push('invalid_at IS NULL');
      if (scopeId) { clauses.push('scope_id = ?'); args.push(String(scopeId)); }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      return db.prepare(`SELECT * FROM mochi_memories${where} ORDER BY id DESC`).all(...args);
    },

    stats() {
      const one = (sql) => Number(db.prepare(sql).get().c);
      return {
        total: one('SELECT COUNT(*) AS c FROM mochi_memories'),
        active: one('SELECT COUNT(*) AS c FROM mochi_memories WHERE invalid_at IS NULL AND expired_at IS NULL'),
        pinned: one('SELECT COUNT(*) AS c FROM mochi_memories WHERE pinned = 1 AND invalid_at IS NULL AND expired_at IS NULL'),
        expired: one('SELECT COUNT(*) AS c FROM mochi_memories WHERE expired_at IS NOT NULL'),
        invalid: one('SELECT COUNT(*) AS c FROM mochi_memories WHERE invalid_at IS NOT NULL'),
      };
    },

    // 衰减扫描：供定时/启动调用，幂等。低于阈值且非 pinned 且未过期的行置 expired_at（非删除）。
    decaySweep(nowMs = p.nowProvider()) {
      const at = iso(nowMs);
      const rows = db.prepare('SELECT * FROM mochi_memories WHERE expired_at IS NULL').all();
      const expireStmt = db.prepare('UPDATE mochi_memories SET expired_at = ? WHERE id = ? AND expired_at IS NULL');
      const expiredIds = [];
      for (const row of rows) {
        if (row.pinned) continue; // 免疫区不衰减。
        if (effectiveImportance(row, nowMs) < p.minImportance) {
          const info = expireStmt.run(at, row.id);
          if (info.changes === 1) {
            insertEvent(row.id, 'decay', `有效分低于 ${p.minImportance}，置 expired_at`, at);
            expiredIds.push(row.id);
          }
        }
      }
      return expiredIds;
    },
  };
}
