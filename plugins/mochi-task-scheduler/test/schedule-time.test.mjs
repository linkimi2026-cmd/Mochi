// 时区与日历计算单测：不靠手算时间戳，只用固定瞬间 + 时区投影互相印证。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TIME_ZONE,
  MochiScheduleTimeError,
  addCalendarDays,
  describeSchedule,
  formatInstant,
  isoWeekdayOf,
  nextOccurrence,
  parseFrequency,
  parseKind,
  parseLocalDate,
  parseTimeOfDay,
  parseWeekday,
  zonedInstant,
  zonedParts,
} from '../schedule-time.mjs';

const SHANGHAI = DEFAULT_TIME_ZONE;

function rejectsCode(operation, code) {
  assert.throws(operation, (error) => error instanceof MochiScheduleTimeError && error.code === code, `期望 ${code}`);
}

test('时区投影：2026-09-11T23:50Z 在上海就是 2026-09-12 07:50', () => {
  const parts = zonedParts(Date.UTC(2026, 8, 11, 23, 50, 0), SHANGHAI);
  assert.deepEqual(
    { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute },
    { year: 2026, month: 9, day: 12, hour: 7, minute: 50 },
  );
  // 反向：本地钟表时间 → 绝对时刻，必须回到同一个瞬间。
  assert.equal(zonedInstant(2026, 9, 12, 7, 50, SHANGHAI), Date.UTC(2026, 8, 11, 23, 50, 0));
});

test('时间格式：只接受补零的 HH:MM，其余明确拒绝', () => {
  assert.deepEqual(parseTimeOfDay('07:50'), { hour: 7, minute: 50, text: '07:50' });
  assert.deepEqual(parseTimeOfDay(' 19:30 '), { hour: 19, minute: 30, text: '19:30' });
  for (const bad of ['7:5', '7:50', '07:5', '25:00', '24:00', '07:60', '0750', '', '早上七点', null, undefined, 750]) {
    rejectsCode(() => parseTimeOfDay(bad), 'MOCHI_SCHEDULE_BAD_TIME');
  }
});

test('周几：接受 1-7、英文、中文口语写法，拒绝越界', () => {
  for (const [input, expected] of [[5, 5], ['5', 5], ['1', 1], ['7', 7]]) {
    assert.equal(parseWeekday(input), expected);
  }
  assert.equal(parseWeekday('friday'), 5);
  assert.equal(parseWeekday('Fri'), 5);
  assert.equal(parseWeekday('周五'), 5);
  assert.equal(parseWeekday('星期天'), 7);
  for (const bad of [0, 8, '0', '8', '星期八', '', 'funday', null]) {
    rejectsCode(() => parseWeekday(bad), 'MOCHI_SCHEDULE_BAD_WEEKDAY');
  }
});

test('日期与频次/类型：非法值有稳定的错误码', () => {
  assert.equal(parseLocalDate('2026-09-13').text, '2026-09-13');
  rejectsCode(() => parseLocalDate('2026-02-30'), 'MOCHI_SCHEDULE_BAD_DATE');
  rejectsCode(() => parseLocalDate('2026-2-3'), 'MOCHI_SCHEDULE_BAD_DATE');
  rejectsCode(() => parseLocalDate('明天'), 'MOCHI_SCHEDULE_BAD_DATE');
  assert.equal(parseFrequency('weekdays'), 'weekdays');
  rejectsCode(() => parseFrequency('monthly'), 'MOCHI_SCHEDULE_BAD_FREQUENCY');
  rejectsCode(() => parseFrequency('每小时'), 'MOCHI_SCHEDULE_BAD_FREQUENCY');
  assert.equal(parseKind('remind'), 'remind');
  rejectsCode(() => parseKind('open-app'), 'MOCHI_SCHEDULE_UNSUPPORTED_KIND');
});

test('once：将来的时间通过，过去的时间明确拒绝', () => {
  // 上海 2026-09-12 08:00。
  const from = Date.UTC(2026, 8, 12, 0, 0, 0);
  const ok = nextOccurrence({ frequency: 'once', time: '07:50', date: '2026-09-13' }, from, SHANGHAI);
  assert.equal(ok.nextRunAt, Date.UTC(2026, 8, 12, 23, 50, 0));
  rejectsCode(
    () => nextOccurrence({ frequency: 'once', time: '07:00', date: '2026-09-12' }, from, SHANGHAI),
    'MOCHI_SCHEDULE_PAST_TIME',
  );
  rejectsCode(
    () => nextOccurrence({ frequency: 'once', time: '07:50' }, from, SHANGHAI),
    'MOCHI_SCHEDULE_DATE_REQUIRED',
  );
});

test('daily：当天未到就今天，已过就明天，且永远落在 07:50', () => {
  const beforeEight = Date.UTC(2026, 8, 12, 0, 0, 0); // 上海 08:00，已过 07:50
  const sameDay = nextOccurrence({ frequency: 'daily', time: '07:50' }, beforeEight, SHANGHAI);
  const parts = zonedParts(sameDay.nextRunAt, SHANGHAI);
  assert.equal(parts.hour, 7);
  assert.equal(parts.minute, 50);
  assert.ok(sameDay.nextRunAt > beforeEight, '必须是将来的时刻');
  assert.ok(sameDay.nextRunAt - beforeEight <= 25 * 3600 * 1000, '不会超过一天');
  assert.deepEqual({ year: parts.year, month: parts.month, day: parts.day }, { year: 2026, month: 9, day: 13 });
});

test('weekly：落点星期就是要求的那天；weekdays：只落在周一至周五', () => {
  const from = Date.UTC(2026, 8, 12, 0, 0, 0); // 上海 2026-09-12（周六）
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    const { nextRunAt } = nextOccurrence({ frequency: 'weekly', time: '07:50', weekday }, from, SHANGHAI);
    assert.ok(nextRunAt > from);
    const parts = zonedParts(nextRunAt, SHANGHAI);
    assert.equal(parts.weekday, weekday, `weekday=${weekday} 的落点应是同一天`);
    assert.equal(parts.hour, 7);
  }
  // 周六当天 07:50 已过 → 下一工作日是周一（用 iso weekday 自证，不手算日期）。
  const weekdayRun = nextOccurrence({ frequency: 'weekdays', time: '07:50' }, from, SHANGHAI);
  const weekdayParts = zonedParts(weekdayRun.nextRunAt, SHANGHAI);
  assert.ok(weekdayParts.weekday >= 1 && weekdayParts.weekday <= 5);
  assert.ok(weekdayRun.nextRunAt > from);
  assert.equal(isoWeekdayOf(2026, 9, 12), 6, '2026-09-12 应该是周六');

  rejectsCode(
    () => nextOccurrence({ frequency: 'weekly', time: '07:50' }, from, SHANGHAI),
    'MOCHI_SCHEDULE_WEEKDAY_REQUIRED',
  );
});

test('日历与展示：加天数跨月正确，人话描述固定时区', () => {
  assert.deepEqual(addCalendarDays({ year: 2026, month: 9, day: 30 }, 1), { year: 2026, month: 10, day: 1 });
  assert.equal(describeSchedule({ frequency: 'daily', time: '07:50' }, SHANGHAI), '每天 07:50（Asia/Shanghai）');
  assert.equal(describeSchedule({ frequency: 'weekly', time: '19:30', weekday: 5 }, SHANGHAI), '每周周五 19:30（Asia/Shanghai）');
  assert.equal(describeSchedule({ frequency: 'weekdays', time: '08:00' }, SHANGHAI), '每个工作日（周一至周五）08:00（Asia/Shanghai）');
  assert.equal(describeSchedule({ frequency: 'once', time: '07:50', date: '2026-09-13' }, SHANGHAI), '2026-09-13 07:50（Asia/Shanghai，仅一次）');
  assert.equal(formatInstant(Date.UTC(2026, 8, 11, 23, 50, 0), SHANGHAI), '2026-09-12 07:50（Asia/Shanghai）');
});
