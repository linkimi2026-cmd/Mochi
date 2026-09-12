// 定时任务的时区与日历计算（纯函数，无外部依赖）。
//
// 约定：所有"几点几分 / 周几 / 哪一天"都是**本地钟表时间**，时区固定
// Asia/Shanghai；只有写进数据库的 next_run_at 才是绝对时刻（ISO/UTC）。
// 取当前时间只走 Node 的 Date.now() 与 Intl 的时区投影，不自己加减时区偏移。

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

export const FREQUENCIES = Object.freeze(['once', 'daily', 'weekly', 'weekdays']);
export const KINDS = Object.freeze(['remind', 'notify']);

export class MochiScheduleTimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MochiScheduleTimeError';
    this.code = code;
  }
}

const formatterCache = new Map();

function formatter(timeZone) {
  let cached = formatterCache.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, cached);
  }
  return cached;
}

/** 校验 IANA 时区名（无效名会抛 RangeError）。 */
export function requireTimeZone(value = DEFAULT_TIME_ZONE) {
  const timeZone = String(value ?? '').trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new MochiScheduleTimeError('MOCHI_SCHEDULE_BAD_TIME_ZONE', `无法识别的时区：${timeZone}。本机默认使用 ${DEFAULT_TIME_ZONE}。`);
  }
  return timeZone;
}

/** 把一个绝对时刻投影成该时区下的钟表字段（ISO 周几：1=周一 … 7=周日）。 */
export function zonedParts(instantMs, timeZone = DEFAULT_TIME_ZONE) {
  const parts = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  // 某些 ICU 版本在 hour12:false 下用 "24" 表示午夜，归一到 0。
  const hour = Number(parts.hour) % 24;
  return {
    year,
    month,
    day,
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: isoWeekdayOf(year, month, day),
  };
}

/** ISO 周几：1=周一 … 7=周日。入参是已经换算好的本地年月日。 */
export function isoWeekdayOf(year, month, day) {
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ((dayOfWeek + 6) % 7) + 1;
}

/**
 * 把该时区下的钟表时间换算成绝对时刻。
 * 中国自 1991 年起无夏令时（固定 +08:00），这里仍写通用的两轮偏移校正，
 * 以免以后换时区时悄悄算错。
 */
export function zonedInstant(year, month, day, hour, minute, timeZone = DEFAULT_TIME_ZONE) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = wallClock;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = zonedParts(guess, timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second, 0);
    guess += wallClock - seenAsUtc;
  }
  return guess;
}

/** 在本地日历上加减天数，返回 {year, month, day}。 */
export function addCalendarDays({ year, month, day }, delta) {
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

const WEEKDAY_NAMES = Object.freeze({ 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' });
const WEEKDAY_WORDS = Object.freeze({
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
  '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 7, '周天': 7,
  '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5, '星期六': 6, '星期日': 7, '星期天': 7,
});

export function weekdayName(weekday) {
  return WEEKDAY_NAMES[weekday] || `第${weekday}天`;
}

/** 解析 "HH:MM"（24 小时制）。只接受两位补零的写法，避免 7:5 这类歧义。 */
export function parseTimeOfDay(value) {
  const text = String(value ?? '').trim();
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(text);
  if (!match) {
    throw new MochiScheduleTimeError('MOCHI_SCHEDULE_BAD_TIME', `时间 "${text}" 无法识别。请用 24 小时制的 HH:MM，例如 07:50 或 19:30（补零）。`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]), text };
}

/** 解析周几。接受 1-7、英文名、中文"周五"等口语写法。 */
export function parseWeekday(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7) return value;
  const text = String(value ?? '').trim();
  if (/^[1-7]$/.test(text)) return Number(text);
  const word = WEEKDAY_WORDS[text.toLowerCase()] ?? WEEKDAY_WORDS[text];
  if (word) return word;
  throw new MochiScheduleTimeError('MOCHI_SCHEDULE_BAD_WEEKDAY', `周几 "${text}" 无法识别。请用 1-7（1=周一，7=周日）或"周五"这类写法。`);
}

/** 解析 "YYYY-MM-DD"，并回验真实存在的日期（拒绝 2026-02-30）。 */
export function parseLocalDate(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    throw new MochiScheduleTimeError('MOCHI_SCHEDULE_BAD_DATE', `日期 "${text}" 无法识别。请用 YYYY-MM-DD，例如 2026-09-13。`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new MochiScheduleTimeError('MOCHI_SCHEDULE_BAD_DATE', `日期 "${text}" 不是有效日期。`);
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
    throw new MochiScheduleTimeError('MOCHI_SCHEDULE_BAD_DATE', `日期 "${text}" 不是有效日期。`);
  }
  return { year, month, day, text };
}

export function parseFrequency(value) {
  const text = String(value ?? '').trim();
  if (!FREQUENCIES.includes(text)) {
    throw new MochiScheduleTimeError(
      'MOCHI_SCHEDULE_BAD_FREQUENCY',
      `频次 "${text}" 不支持。目前只支持：once（只提醒一次）、daily（每天）、weekly（每周某天）、weekdays（周一至周五）。`,
    );
  }
  return text;
}

export function parseKind(value) {
  const text = String(value ?? '').trim();
  if (!KINDS.includes(text)) {
    throw new MochiScheduleTimeError(
      'MOCHI_SCHEDULE_UNSUPPORTED_KIND',
      `任务类型 "${text}" 暂不支持。目前只支持：remind（到点在当前会话发一条提醒）、notify（到点产出一条通知）。`,
    );
  }
  return text;
}

/**
 * 计算下一次触发时刻。
 * @returns {{nextRunAt: number}} 绝对毫秒时刻。
 * @throws {MochiScheduleTimeError} 输入非法，或 once 的目标时间已经过去。
 */
export function nextOccurrence(spec, fromMs, timeZone = DEFAULT_TIME_ZONE) {
  const frequency = parseFrequency(spec.frequency);
  const { hour, minute } = parseTimeOfDay(spec.time);
  const zone = requireTimeZone(timeZone);
  const today = zonedParts(fromMs, zone);

  if (frequency === 'once') {
    if (!spec.date) {
      throw new MochiScheduleTimeError('MOCHI_SCHEDULE_DATE_REQUIRED', '一次性任务（frequency=once）必须给出日期 date（YYYY-MM-DD）。');
    }
    const target = parseLocalDate(spec.date);
    const instant = zonedInstant(target.year, target.month, target.day, hour, minute, zone);
    if (instant <= fromMs) {
      throw new MochiScheduleTimeError(
        'MOCHI_SCHEDULE_PAST_TIME',
        `目标时间 ${target.text} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}（${zone}）已经过去，无法安排。请改成将来的时间。`,
      );
    }
    return { nextRunAt: instant };
  }

  if (frequency === 'daily') {
    let candidate = addCalendarDays(today, 0);
    let instant = zonedInstant(candidate.year, candidate.month, candidate.day, hour, minute, zone);
    if (instant <= fromMs) {
      candidate = addCalendarDays(today, 1);
      instant = zonedInstant(candidate.year, candidate.month, candidate.day, hour, minute, zone);
    }
    return { nextRunAt: instant };
  }

  // weekly / weekdays：在本地日历上逐日往后找第一个"星期匹配且时刻未过"的日子。
  // 先查"缺 weekday"，再解析——否则 parseWeekday(undefined) 会先抛 BAD_WEEKDAY，
  // 报错信息就没那么直白了。
  if (frequency === 'weekly' && (spec.weekday === undefined || spec.weekday === null || spec.weekday === '')) {
    throw new MochiScheduleTimeError('MOCHI_SCHEDULE_WEEKDAY_REQUIRED', '每周任务（frequency=weekly）必须给出 weekday（1=周一 … 7=周日）。');
  }
  const wanted = frequency === 'weekly' ? parseWeekday(spec.weekday) : null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addCalendarDays(today, offset);
    const weekday = isoWeekdayOf(candidate.year, candidate.month, candidate.day);
    const matches = frequency === 'weekly' ? weekday === wanted : weekday >= 1 && weekday <= 5;
    if (!matches) continue;
    const instant = zonedInstant(candidate.year, candidate.month, candidate.day, hour, minute, zone);
    if (instant > fromMs) return { nextRunAt: instant };
  }
  // 理论上不可达：7 天内必有匹配的一天且时刻未过。
  throw new MochiScheduleTimeError('MOCHI_SCHEDULE_NO_OCCURRENCE', '无法计算下一次触发时间。');
}

/** 把绝对时刻渲染成该时区的可读本地时间，例如 "2026-09-13 07:50（Asia/Shanghai）"。 */
export function formatInstant(instantMs, timeZone = DEFAULT_TIME_ZONE) {
  const p = zonedParts(instantMs, timeZone);
  const pad = (value) => String(value).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}（${timeZone}）`;
}

/** 人话描述，供老师核对与模型照读。 */
export function describeSchedule(spec, timeZone = DEFAULT_TIME_ZONE) {
  const { text } = parseTimeOfDay(spec.time);
  const zone = requireTimeZone(timeZone);
  if (spec.frequency === 'once') return `${spec.date} ${text}（${zone}，仅一次）`;
  if (spec.frequency === 'daily') return `每天 ${text}（${zone}）`;
  if (spec.frequency === 'weekly') return `每周${weekdayName(parseWeekday(spec.weekday))} ${text}（${zone}）`;
  return `每个工作日（周一至周五）${text}（${zone}）`;
}
