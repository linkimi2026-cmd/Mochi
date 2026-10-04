import { createHash } from 'node:crypto';
import { openScheduleDb, createScheduleStore } from '../mochi-task-scheduler/store.mjs';
import { createScheduler } from '../mochi-task-scheduler/scheduler.mjs';
import { nextOccurrence, zonedParts, zonedInstant } from '../mochi-task-scheduler/schedule-time.mjs';
import { validateTimetable, reminderTime, TIME_ZONE } from './timetable.mjs';

export class ClassroomPlanner {
  constructor(path, { now = Date.now, tickMs = 30_000 } = {}) {
    this.now = now;
    this.store = createScheduleStore(openScheduleDb(path));
    this.db = this.store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS classroom_plan (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, paused INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS classroom_reminders (lesson_id TEXT PRIMARY KEY, schedule_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS classroom_papers (id TEXT PRIMARY KEY, schedule_id INTEGER NOT NULL, planned_at TEXT NOT NULL, created_at INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, queued_at INTEGER, UNIQUE(schedule_id,planned_at));`);
    this.scheduler = createScheduler({ store: this.store, timeZone: TIME_ZONE, now, tickMs, deliver: (row, meta) => this.deliver(row, meta) });
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  snapshot() {
    const saved = this.db.prepare('SELECT * FROM classroom_plan WHERE id=1').get();
    const plan = saved ? JSON.parse(saved.payload) : null;
    const rows = this.db.prepare(`SELECT r.lesson_id, s.next_run_at, s.state FROM classroom_reminders r JOIN mochi_schedules s ON s.id=r.schedule_id`).all();
    const papers = this.db.prepare('SELECT * FROM classroom_papers ORDER BY created_at DESC LIMIT 40').all();
    return { plan, revision: saved?.revision ?? 0, paused: !!saved?.paused, rows, papers, running: this.scheduler.pendingTimer, timeZone: TIME_ZONE };
  }
  save(input, expectedRevision) {
    const candidate = validateTimetable(input);
    if (candidate.issues.length) return { saved: false, candidate };
    const { draftLessons, issues, ...plan } = candidate;
    this.transaction(() => {
      const current = this.snapshot();
      if (expectedRevision !== current.revision) throw new Error('课表已被更新，请重新打开后再保存。');
      const same = JSON.stringify(current.plan) === JSON.stringify(plan);
      if (same && !current.paused) return;
      this.cancelRows();
      this.db.prepare('INSERT INTO classroom_plan VALUES(1, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, paused=0, payload=excluded.payload').run(current.revision + 1, JSON.stringify(plan));
      this.arm(plan);
    });
    this.scheduler.refresh();
    return { saved: true, state: this.snapshot() };
  }
  cancelRows() {
    for (const row of this.db.prepare('SELECT schedule_id FROM classroom_reminders').all()) this.store.cancelSchedule(row.schedule_id);
    this.db.prepare('DELETE FROM classroom_reminders').run();
  }
  arm(plan) {
    for (const lesson of plan.lessons) {
      const timing = reminderTime(lesson, plan.leadMinutes);
      const { nextRunAt } = nextOccurrence({ frequency: 'weekly', ...timing }, this.now(), TIME_ZONE);
      const row = this.store.createSchedule({ title: `${lesson.subject}快开始啦`, kind: 'notify', frequency: 'weekly', timeOfDay: timing.time, weekday: timing.weekday,
        timeZone: TIME_ZONE, nextRunAt, note: JSON.stringify(lesson) });
      this.db.prepare('INSERT INTO classroom_reminders VALUES(?,?)').run(lesson.id, row.id);
    }
  }
  setPaused(paused, expectedRevision) {
    if (typeof paused !== 'boolean') throw new Error('暂停状态无效。');
    this.transaction(() => {
      const state = this.snapshot();
      if (expectedRevision !== state.revision) throw new Error('课表已被更新，请刷新后再试。');
      if (!state.plan || state.paused === paused) return;
      this.cancelRows();
      this.db.prepare('UPDATE classroom_plan SET paused=?, revision=revision+1 WHERE id=1').run(Number(paused));
      if (!paused) this.arm(state.plan);
    });
    this.scheduler.refresh();
    return this.snapshot();
  }
  deliver(row, { plannedAt, firedAt }) {
    const state = this.snapshot();
    if (state.paused || !state.rows.some(item => item.lesson_id === JSON.parse(row.note).id)) return { outcome: 'delivered', channel: 'cancelled', detail: '课表已暂停或该节课已移除。' };
    const lesson = JSON.parse(row.note), local = zonedParts(firedAt, TIME_ZONE);
    const timing = reminderTime(lesson, state.plan.leadMinutes), [hour, minute] = timing.time.split(':').map(Number);
    const latest = zonedInstant(local.year,local.month,local.day,hour,minute,TIME_ZONE);
    // A restart after the lesson ended never replays an obsolete school bell.
    if (local.weekday !== timing.weekday || firedAt < latest || firedAt - latest > 15 * 60_000) return { outcome: 'delivered', channel: 'expired', detail: '错过的上课提醒已跳过，保留下一节。' };
    plannedAt = new Date(latest).toISOString();
    const digest = createHash('sha256').update(`${row.id}|${plannedAt}`).digest('hex');
    const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
    const body = `${state.plan.className ? `${state.plan.className}，` : ''}课本准备好了吗？\n${lesson.start}–${lesson.end} · ${lesson.subject}\nMochi 陪大家一起开始这一节。`;
    this.db.prepare('INSERT OR IGNORE INTO classroom_papers (id,schedule_id,planned_at,created_at,title,body) VALUES(?,?,?,?,?,?)').run(id,row.id,plannedAt,firedAt,'下一节的小提醒',body);
    this.db.prepare('DELETE FROM classroom_papers WHERE id NOT IN (SELECT id FROM classroom_papers ORDER BY created_at DESC LIMIT 200)').run();
    return { outcome: 'delivered', channel: 'paper-outbox', detail: '提醒已保存到本机纸条待展示队列；不代表已经显示或已读。' };
  }
  acknowledgeQueue(id) {
    if (typeof id !== 'string' || id.length > 50) throw new Error('提醒 ID 无效。');
    this.db.prepare('UPDATE classroom_papers SET queued_at=COALESCE(queued_at,?) WHERE id=?').run(this.now(), id);
    return this.snapshot();
  }
  start() { this.scheduler.start(); }
  async close() { await this.scheduler.stop(); this.db.close(); }
}
