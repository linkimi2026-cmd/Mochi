// 调度器单测：真实定时器（1 秒级）+ 真实 SQLite，验证"到点真的调用了回调"。
// 不 mock 时间，也不真的等一天。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createScheduler } from '../scheduler.mjs';
import { createScheduleStore, openScheduleDb } from '../store.mjs';

const TIME_ZONE = 'Asia/Shanghai';
const BASE = { title: '提醒我', timeOfDay: '07:50', timeZone: TIME_ZONE, note: '' };

function makeStore(t) {
  const root = mkdtempSync(join(tmpdir(), 'mochi-task-scheduler-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return createScheduleStore(openScheduleDb(join(root, 's.db')));
}

async function waitFor(condition, { timeoutMs = 10_000, stepMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return false;
}

test('真实定时器：1 秒后到点，回调被调用且任务被推进为已完成', async (t) => {
  const store = makeStore(t);
  const schedule = store.createSchedule({ ...BASE, kind: 'notify', frequency: 'once', localDate: '2026-09-13', nextRunAt: Date.now() + 1200 });

  const calls = [];
  const scheduler = createScheduler({
    store,
    timeZone: TIME_ZONE,
    tickMs: 250,
    timerOptions: { unref: false },
    deliver: async (row, meta) => {
      calls.push({ id: row.id, plannedAt: meta.plannedAt });
      return { outcome: 'delivered', channel: 'local-notification', detail: '已写入本机通知记录' };
    },
  });
  t.after(() => scheduler.stop());

  assert.equal(scheduler.pendingTimer, false, '启动前没有定时器');
  scheduler.start();
  assert.equal(scheduler.pendingTimer, true, 'start 之后确实挂上了定时器');

  const fired = await waitFor(() => store.getSchedule(schedule.id)?.state === 'fired');
  assert.equal(fired, true, '到点后任务应变为 fired（等了 10 秒仍未触发）');
  assert.equal(calls.length, 1, '回调恰好被调用一次');
  assert.equal(calls[0].id, schedule.id);
  assert.equal(store.getSchedule(schedule.id).run_count, 1);
  const runs = store.listRuns(schedule.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'delivered');
  assert.equal(runs[0].channel, 'local-notification');
});

test('到点没有会话时停在逾期并重试，恢复后送达（不会假装送达）', async (t) => {
  const store = makeStore(t);
  const schedule = store.createSchedule({ ...BASE, kind: 'remind', frequency: 'once', localDate: '2026-09-13', nextRunAt: Date.now() - 1000 });

  let attempts = 0;
  const scheduler = createScheduler({
    store,
    timeZone: TIME_ZONE,
    tickMs: 120,
    timerOptions: { unref: false },
    deliver: async () => {
      attempts += 1;
      if (attempts <= 2) {
        return { outcome: 'pending', channel: 'session-followup', detail: '到点时没有找到活着的会话' };
      }
      return { outcome: 'delivered', channel: 'session-followup', detail: '已排入会话' };
    },
  });
  t.after(() => scheduler.stop());
  scheduler.start();

  const delivered = await waitFor(() => store.getSchedule(schedule.id)?.state === 'fired');
  assert.equal(delivered, true, '会话恢复后应送达并结束一次性任务');
  assert.ok(attempts >= 3, `应先经历 pending 再送达，实际尝试 ${attempts} 次`);

  const runs = store.listRuns(schedule.id);
  // 同一计划时刻只保留一行：最终结果是 delivered，且能看到中间的重试详情被覆盖。
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'delivered');
  assert.equal(runs[0].channel, 'session-followup');
});

test('投递回调抛错时如实记失败，任务保持逾期而不是被当作已完成', async (t) => {
  const store = makeStore(t);
  const schedule = store.createSchedule({ ...BASE, kind: 'remind', frequency: 'once', localDate: '2026-09-13', nextRunAt: Date.now() - 1000 });

  const scheduler = createScheduler({
    store,
    timeZone: TIME_ZONE,
    tickMs: 120,
    timerOptions: { unref: false },
    deliver: async () => { throw new Error('模拟：会话通道炸了'); },
  });
  t.after(() => scheduler.stop());
  scheduler.start();

  const recorded = await waitFor(() => store.listRuns(schedule.id).length > 0);
  assert.equal(recorded, true);
  const row = store.getSchedule(schedule.id);
  assert.equal(row.state, 'scheduled', '失败不能被算成已完成');
  assert.equal(row.run_count, 0);
  const run = store.listRuns(schedule.id)[0];
  assert.equal(run.outcome, 'failed');
  assert.match(run.detail, /会话通道炸了/);
});

test('重复任务送达后推进到下一次而不是结束；stop() 之后不再触发', async (t) => {
  const store = makeStore(t);
  const start = Date.now();
  const schedule = store.createSchedule({ ...BASE, kind: 'notify', frequency: 'daily', nextRunAt: start - 1000 });

  let calls = 0;
  const scheduler = createScheduler({
    store,
    timeZone: TIME_ZONE,
    tickMs: 60_000,
    timerOptions: { unref: false },
    deliver: async () => {
      calls += 1;
      return { outcome: 'delivered', channel: 'local-notification', detail: '' };
    },
  });
  t.after(() => scheduler.stop());

  await scheduler.tick();
  const row = store.getSchedule(schedule.id);
  assert.equal(row.state, 'scheduled', '每日任务触发后仍应待触发');
  assert.equal(row.run_count, 1);
  const nextRun = Date.parse(row.next_run_at);
  assert.ok(nextRun > Date.now(), '下一次触发必须是将来');
  assert.equal(calls, 1);

  // 下一轮不会再命中（next_run_at 已推到将来）。
  await scheduler.tick();
  assert.equal(calls, 1);
  assert.equal(store.getSchedule(schedule.id).run_count, 1);

  // 取消后即使手工再跑一轮也不会触发。
  store.cancelSchedule(schedule.id);
  await scheduler.tick();
  assert.equal(calls, 1);

  scheduler.stop();
  assert.equal(scheduler.pendingTimer, false, 'stop 之后定时器被清掉');
});
