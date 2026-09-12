// 真正的调度执行：进程内定时器（setTimeout 链），到点调用 deliver 回调。
//
// 诚实边界（写在这里，也写进工具回执）：
//   * 定时器活在**当前 Mochi 应用进程**里。应用关闭时不会有任何东西执行——
//     本项目没有开机自启的后台常驻服务，也不做"关机后也会执行"的承诺。
//   * 到点时若目标会话已经不在了，remind 不会被丢弃，也不会假装送达：
//     它停在"待送达"（overdue），每轮回查一次，等会话恢复后再送。
import { nextOccurrence } from './schedule-time.mjs';

/** Node 定时器能表示的最大延时；超过就分段等待。 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * @param {object} options
 * @param {object} options.store createScheduleStore() 的返回值
 * @param {(schedule: object, context: {plannedAt: string, firedAt: number}) => Promise<{outcome: 'delivered'|'pending'|'failed', channel: string, detail?: string}>} options.deliver
 * @param {() => number} [options.now] 取当前时间（毫秒）。测试可注入。
 * @param {string} options.timeZone
 * @param {number} [options.tickMs] 最长空转等待；也是待送达任务的重试间隔。
 * @param {{unref?: boolean}} [options.timerOptions]
 * @param {object} [options.logger]
 */
export function createScheduler({
  store,
  deliver,
  now = () => Date.now(),
  timeZone,
  tickMs = 60_000,
  timerOptions = { unref: true },
  logger,
}) {
  if (typeof deliver !== 'function') throw new TypeError('createScheduler 需要 deliver 回调。');
  let timer = null;
  let running = false;
  let stopped = false;
  let ticking = Promise.resolve();

  function clearTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /** 重新计算下一次唤醒并挂上定时器。 */
  function refresh() {
    if (stopped) return;
    clearTimer();
    const current = now();
    const wakeAt = store.nextWakeAt();
    const target = wakeAt === null ? current + tickMs : Date.parse(wakeAt);
    const delay = Math.min(Math.max(target - current, 0), tickMs, MAX_TIMER_DELAY_MS);
    timer = setTimeout(() => {
      timer = null;
      void runDue();
    }, delay);
    timer?.unref?.();
  }

  /**
   * 处理所有到点/逾期任务。
   * @returns {Promise<Array<{id: number, outcome: string, channel: string, detail: string}>>}
   */
  function processDue() {
    const firedAt = now();
    const plannedAtFor = (row) => row.next_run_at;
    const results = [];
    for (const row of store.dueSchedules(firedAt)) {
      const plannedAt = plannedAtFor(row);
      const spec = {
        frequency: row.frequency,
        time: row.time_of_day,
        weekday: row.weekday ?? undefined,
        date: row.local_date ?? undefined,
      };
      // 首次投递是异步的；这里按顺序 await，避免同一轮里重复投递同一个任务。
      results.push({ row, plannedAt, spec, firedAt });
    }
    return results;
  }

  async function runDue() {
    if (stopped || running) return;
    running = true;
    try {
      for (const entry of processDue()) {
        if (stopped) break;
        const { row, plannedAt, spec, firedAt } = entry;
        let outcome;
        try {
          outcome = await deliver(row, { plannedAt, firedAt });
        } catch (error) {
          outcome = { outcome: 'failed', channel: 'deliver', detail: `投递回调抛错：${error instanceof Error ? error.message : String(error)}` };
        }
        const detail = String(outcome?.detail ?? '');
        const channel = String(outcome?.channel ?? '');
        if (outcome?.outcome === 'delivered') {
          let nextRunAt = null;
          if (row.frequency !== 'once') {
            try {
              nextRunAt = nextOccurrence({ ...spec, frequency: row.frequency }, Date.now(), timeZone).nextRunAt;
            } catch (error) {
              // 库里存着算不出来的重复规则（数据损坏）时，不能让任务永远卡在逾期空转。
              // 停掉它，并把失败原因留在 mochi_schedule_runs 里。
              store.recordAttempt({ scheduleId: row.id, plannedAt, firedAt, outcome: 'failed', channel, detail: `${detail}；下一次触发时间计算失败，已停止该任务：${error instanceof Error ? error.message : String(error)}` });
              store.cancelSchedule(row.id);
              logger?.warn?.(`[Mochi] 定时任务 #${row.id} 的重复规则无法计算下一次触发时间，已停止推进（详见 mochi_schedule_runs）。`);
              continue;
            }
          }
          store.recordDelivered({ scheduleId: row.id, plannedAt, firedAt, channel, detail, nextRunAt });
        } else {
          // pending：到点时目标会话不在，保留逾期，下一轮再试。
          store.recordAttempt({ scheduleId: row.id, plannedAt, firedAt, outcome: outcome?.outcome === 'pending' ? 'pending' : 'failed', channel, detail });
        }
      }
    } finally {
      running = false;
      refresh();
    }
  }

  return {
    /** 启动：立刻挂定时器（不立刻执行到点任务，交给下一轮）。 */
    start() {
      stopped = false;
      refresh();
    },
    /** 手动跑一轮（测试与自检用）。并发调用会串行化。 */
    tick() {
      ticking = ticking.then(() => runDue());
      return ticking;
    },
    /** 创建/取消任务后调用，让定时器立刻对齐新的最近触发时刻。 */
    refresh,
    get pendingTimer() {
      return timer !== null;
    },
    async stop() {
      stopped = true;
      clearTimer();
      await ticking.catch(() => {});
    },
  };
}
