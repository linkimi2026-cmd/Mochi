// 存储层单测：真实 SQLite 文件、重开后仍在、取消、逾期查询、通知与运行记录。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createScheduleStore, openScheduleDb } from '../store.mjs';

function makeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'mochi-task-scheduler-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const BASE = {
  title: '打开今天的课件',
  kind: 'notify',
  frequency: 'daily',
  timeOfDay: '07:50',
  timeZone: 'Asia/Shanghai',
  note: '',
};

test('创建后持久化：关掉再重开同一个文件，任务还在且字段一致', (t) => {
  const dbPath = join(makeRoot(t), 'scheduler', 'mochi-schedules.sqlite');
  const nextRunAt = Date.now() + 3600_000;

  const first = openScheduleDb(dbPath);
  const created = createScheduleStore(first).createSchedule({ ...BASE, nextRunAt, sessionId: 'session-a', agentId: 'session-a' });
  assert.equal(created.title, BASE.title);
  assert.equal(created.frequency, 'daily');
  assert.equal(created.state, 'scheduled');
  assert.equal(created.run_count, 0);
  assert.equal(created.session_id, 'session-a');
  assert.equal(created.next_run_at, new Date(nextRunAt).toISOString());
  assert.ok(created.id > 0);
  first.close();

  // 另一个进程/另一次启动：重新打开同一个文件。
  const second = openScheduleDb(dbPath);
  const store = createScheduleStore(second);
  const rows = store.listSchedules();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, created.id);
  assert.equal(rows[0].title, '打开今天的课件');
  assert.equal(rows[0].time_of_day, '07:50');
  assert.equal(rows[0].next_run_at, new Date(nextRunAt).toISOString());
  assert.equal(store.getSchedule(created.id).session_id, 'session-a');
  second.close();
});

test('到点查询只返回 scheduled 且 next_run_at 已到的任务', (t) => {
  const store = createScheduleStore(openScheduleDb(join(makeRoot(t), 's.db')));
  const now = Date.now();
  const due = store.createSchedule({ ...BASE, title: '已到点', nextRunAt: now - 60_000 });
  const future = store.createSchedule({ ...BASE, title: '还没到', nextRunAt: now + 60_000 });
  const cancelled = store.createSchedule({ ...BASE, title: '已取消', nextRunAt: now - 60_000 });
  store.cancelSchedule(cancelled.id);

  const found = store.dueSchedules(now).map((row) => row.id);
  assert.deepEqual(found, [due.id]);
  assert.equal(store.nextWakeAt() !== null, true);
  assert.ok(future.id > 0);
});

test('取消：写入 cancelled、之后查不到，重复取消安全，已触发的一次性任务不可取消', (t) => {
  const store = createScheduleStore(openScheduleDb(join(makeRoot(t), 's.db')));
  const now = Date.now();
  const daily = store.createSchedule({ ...BASE, nextRunAt: now + 60_000 });

  const first = store.cancelSchedule(daily.id);
  assert.equal(first.cancelled, true);
  assert.equal(first.schedule.state, 'cancelled');
  assert.equal(first.schedule.next_run_at, null);
  assert.deepEqual(store.listSchedules(), [], '默认列表不含已取消任务');
  assert.equal(store.listSchedules({ includeCancelled: true }).length, 1);
  assert.deepEqual(store.dueSchedules(now + 10 * 60_000), [], '取消后不再到点');

  const again = store.cancelSchedule(daily.id);
  assert.equal(again.alreadyCancelled, true);
  assert.equal(again.cancelled, false);

  assert.equal(store.cancelSchedule(999_999).found, false, '不存在的 ID 如实报告');

  const once = store.createSchedule({ ...BASE, frequency: 'once', localDate: '2026-09-13', nextRunAt: now - 1000 });
  store.recordDelivered({ scheduleId: once.id, plannedAt: once.next_run_at, channel: 'local-notification' });
  const fired = store.cancelSchedule(once.id);
  assert.equal(fired.fired, true);
  assert.equal(fired.cancelled, false);
});

test('送达会推进重复任务、结束一次性任务，并如实记运行结果', (t) => {
  const store = createScheduleStore(openScheduleDb(join(makeRoot(t), 's.db')));
  const now = Date.now();
  const plannedAt = new Date(now - 1000).toISOString();

  const daily = store.createSchedule({ ...BASE, nextRunAt: now - 1000 });
  const afterDaily = store.recordDelivered({ scheduleId: daily.id, plannedAt, channel: 'local-notification', detail: 'x', nextRunAt: now + 86_400_000 });
  assert.equal(afterDaily.state, 'scheduled', '每日任务触发后仍在 queued');
  assert.equal(afterDaily.run_count, 1);
  assert.equal(afterDaily.next_run_at, new Date(now + 86_400_000).toISOString());

  const once = store.createSchedule({ ...BASE, frequency: 'once', localDate: '2026-09-13', nextRunAt: now - 1000 });
  const afterOnce = store.recordDelivered({ scheduleId: once.id, plannedAt, channel: 'local-notification' });
  assert.equal(afterOnce.state, 'fired');
  assert.equal(afterOnce.next_run_at, null);
  assert.deepEqual(store.dueSchedules(now + 10 * 60_000).map((row) => row.id), [], '一次性任务不再到点');

  // 同一计划时刻先记为待送达、后改为已送达：只保留一行（不因唯一约束抛错）。
  const retried = store.createSchedule({ ...BASE, title: '待送达重试', nextRunAt: now - 1000 });
  store.recordAttempt({ scheduleId: retried.id, plannedAt, outcome: 'pending', channel: 'session-followup', detail: '没有活着的会话' });
  store.recordDelivered({ scheduleId: retried.id, plannedAt, channel: 'session-followup', detail: '已排入会话' });
  const runs = store.listRuns(retried.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'delivered');
  assert.equal(runs[0].detail, '已排入会话');
  assert.equal(retried.id > 0, true);
});

test('notify 到点会留下真实的通知记录', (t) => {
  const store = createScheduleStore(openScheduleDb(join(makeRoot(t), 's.db')));
  const schedule = store.createSchedule({ ...BASE, title: '整理本周作业', note: '只整理，不发送', nextRunAt: Date.now() - 1000 });
  store.addNotification({ scheduleId: schedule.id, title: schedule.title, note: schedule.note });
  const notes = store.listNotifications(schedule.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, '整理本周作业');
  assert.equal(notes[0].note, '只整理，不发送');
  assert.ok(Number.isFinite(Date.parse(notes[0].created_at)));
});
