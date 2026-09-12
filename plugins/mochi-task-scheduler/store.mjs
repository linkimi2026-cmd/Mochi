// Mochi 定时任务本机存储（SQLite，参考 mochi-dispatch/store.mjs 的数据根与事务写法）。
//
// 数据根约定：DSH_HOME（或 ~/.mochi-home）下的 scheduler/mochi-schedules.sqlite。
// 表：
//   mochi_schedules              —— 一条定时任务一行，重启后仍在
//   mochi_schedule_runs          —— 每次到点触发的实际结果（送达 / 待送达 / 失败）
//   mochi_schedule_notifications —— kind=notify 到点产出的通知记录
//
// 事实边界：这些表只证明"本机写入了什么、调度器实际做了什么"，
// 不证明老师看到了提醒，也不证明应用关闭期间执行过任何东西。
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mochi_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('remind','notify')),
  frequency TEXT NOT NULL CHECK (frequency IN ('once','daily','weekly','weekdays')),
  -- 本地钟表时间 'HH:MM'（Asia/Shanghai），不是绝对时刻。
  time_of_day TEXT NOT NULL,
  -- 仅 weekly 使用：1=周一 … 7=周日。
  weekday INTEGER,
  -- 仅 once 使用：'YYYY-MM-DD'。
  local_date TEXT,
  time_zone TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('scheduled','fired','cancelled')),
  -- 创建这条任务时所在的会话/Agent；决定 remind 到点能否回到那个会话。
  session_id TEXT,
  agent_id TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  -- 绝对时刻（ISO UTC）。一次性任务触发后置空。
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mochi_schedules_due ON mochi_schedules (state, next_run_at);

CREATE TABLE IF NOT EXISTS mochi_schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  planned_at TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('delivered','pending','failed')),
  channel TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  -- 同一计划时刻只留一行：待送达会每轮重试，但不会刷爆这张表。
  UNIQUE (schedule_id, planned_at)
);
CREATE INDEX IF NOT EXISTS idx_mochi_schedule_runs_schedule ON mochi_schedule_runs (schedule_id, id DESC);

CREATE TABLE IF NOT EXISTS mochi_schedule_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mochi_schedule_notifications_schedule ON mochi_schedule_notifications (schedule_id, id DESC);
`;

export function defaultDbPath(dshHome = process.env.DSH_HOME) {
  const home = dshHome || join(process.env.HOME || '/tmp', '.mochi-home');
  return join(home, 'scheduler', 'mochi-schedules.sqlite');
}

export function openScheduleDb(dbPath = defaultDbPath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  return db;
}

const nowIso = () => new Date().toISOString();

function requirePositiveInt(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label}无效。`);
  return id;
}

export function createScheduleStore(db = openScheduleDb()) {
  const insertSchedule = db.prepare(`INSERT INTO mochi_schedules
    (title, kind, frequency, time_of_day, weekday, local_date, time_zone, note, state,
     session_id, agent_id, run_count, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, 0, ?, ?, ?)`);
  const selectById = db.prepare('SELECT * FROM mochi_schedules WHERE id = ?');
  const selectAll = db.prepare(`SELECT * FROM mochi_schedules
    WHERE state <> 'cancelled' ORDER BY (next_run_at IS NULL), next_run_at ASC, id ASC LIMIT 200`);
  const selectAllWithCancelled = db.prepare('SELECT * FROM mochi_schedules ORDER BY id DESC LIMIT 200');
  const selectDue = db.prepare(`SELECT * FROM mochi_schedules
    WHERE state = 'scheduled' AND next_run_at IS NOT NULL AND next_run_at <= ?
    ORDER BY next_run_at ASC, id ASC LIMIT 50`);
  const selectNextWake = db.prepare(`SELECT MIN(next_run_at) AS next_wake FROM mochi_schedules
    WHERE state = 'scheduled' AND next_run_at IS NOT NULL`);
  const cancelStmt = db.prepare(`UPDATE mochi_schedules
    SET state = 'cancelled', next_run_at = NULL, cancelled_at = ?, updated_at = ?
    WHERE id = ? AND state = 'scheduled'`);
  // 同一 (schedule_id, planned_at) 只保留一行：先"待送达"后"已送达"时是更新而不是插新行，
  // 反复重试也不会刷爆这张表。
  const insertRun = db.prepare(`INSERT INTO mochi_schedule_runs
    (schedule_id, planned_at, fired_at, outcome, channel, detail) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (schedule_id, planned_at) DO UPDATE SET
      fired_at = excluded.fired_at,
      outcome = excluded.outcome,
      channel = excluded.channel,
      detail = excluded.detail`);
  const recordDelivered = db.prepare(`UPDATE mochi_schedules
    SET run_count = run_count + 1, last_run_at = ?, next_run_at = ?, state = ?, updated_at = ?
    WHERE id = ? AND state = 'scheduled'`);
  const insertNotification = db.prepare(`INSERT INTO mochi_schedule_notifications
    (schedule_id, title, note, created_at) VALUES (?, ?, ?, ?)`);
  const selectNotifications = db.prepare(`SELECT * FROM mochi_schedule_notifications
    WHERE schedule_id = ? ORDER BY id DESC LIMIT 50`);
  const selectRuns = db.prepare('SELECT * FROM mochi_schedule_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT 50');

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

  return {
    db,
    /** 新建一条定时任务；返回库里真实的那一行（不是回显入参）。 */
    createSchedule({ title, kind, frequency, timeOfDay, weekday = null, localDate = null, timeZone, note = '', nextRunAt, sessionId = null, agentId = null }) {
      const created = nowIso();
      const info = insertSchedule.run(
        title, kind, frequency, timeOfDay, weekday, localDate, timeZone, note,
        sessionId, agentId, new Date(nextRunAt).toISOString(), created, created,
      );
      return selectById.get(Number(info.lastInsertRowid));
    },
    getSchedule: (id) => selectById.get(requirePositiveInt(id, '定时任务 ID')) || null,
    listSchedules: ({ includeCancelled = false } = {}) => (includeCancelled ? selectAllWithCancelled : selectAll).all(),
    /** 到点（含逾期）且仍处于 scheduled 的任务。 */
    dueSchedules: (atMs = Date.now()) => selectDue.all(new Date(atMs).toISOString()),
    nextWakeAt: () => {
      const row = selectNextWake.get();
      return row?.next_wake ?? null;
    },
    /**
     * 记录一次成功送达，并推进/结束这条任务。
     * nextRunAt 为 null 表示不再触发（一次性任务已触发）。
     */
    recordDelivered({ scheduleId, plannedAt, firedAt = Date.now(), channel, detail = '', nextRunAt = null }) {
      const id = requirePositiveInt(scheduleId, '定时任务 ID');
      const fired = new Date(firedAt).toISOString();
      return inImmediateTransaction(() => {
        insertRun.run(id, plannedAt, fired, 'delivered', channel, detail);
        const nextState = nextRunAt === null ? 'fired' : 'scheduled';
        recordDelivered.run(fired, nextRunAt === null ? null : new Date(nextRunAt).toISOString(), nextState, fired, id);
        return selectById.get(id) || null;
      });
    },
    /** 记录一次未送达的尝试（同一计划时刻只记一行，可反复重试）。 */
    recordAttempt({ scheduleId, plannedAt, firedAt = Date.now(), outcome, channel, detail = '' }) {
      const id = requirePositiveInt(scheduleId, '定时任务 ID');
      insertRun.run(id, plannedAt, new Date(firedAt).toISOString(), outcome, channel, detail);
      return selectById.get(id) || null;
    },
    addNotification({ scheduleId, title, note = '', createdAt = Date.now() }) {
      const id = requirePositiveInt(scheduleId, '定时任务 ID');
      insertNotification.run(id, title, note, new Date(createdAt).toISOString());
      return selectById.get(id) || null;
    },
    listNotifications: (scheduleId) => selectNotifications.all(requirePositiveInt(scheduleId, '定时任务 ID')),
    listRuns: (scheduleId) => selectRuns.all(requirePositiveInt(scheduleId, '定时任务 ID')),
    /**
     * 取消一条任务。
     * @returns {{schedule: object, cancelled: boolean, alreadyCancelled: boolean}}
     */
    cancelSchedule(scheduleId) {
      const id = requirePositiveInt(scheduleId, '定时任务 ID');
      const current = selectById.get(id);
      if (!current) return { schedule: null, cancelled: false, alreadyCancelled: false, found: false };
      if (current.state === 'cancelled') return { schedule: current, cancelled: false, alreadyCancelled: true, found: true };
      if (current.state === 'fired') return { schedule: current, cancelled: false, alreadyCancelled: false, found: true, fired: true };
      const at = nowIso();
      const info = cancelStmt.run(at, at, id);
      return { schedule: selectById.get(id), cancelled: info.changes === 1, alreadyCancelled: false, found: true };
    },
  };
}
