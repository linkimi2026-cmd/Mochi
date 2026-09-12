// 三个定时任务工具的真正逻辑（不依赖 @deepseek-ai/dsh-tools，便于直接单测）。
// index.mjs 只负责把它包成 defineTool。
//
// 零容忍规则：只有真的写进 SQLite、且调度器真的挂上了定时器，才回复"已安排"。
// 任何一步没做到，都必须在这份回执里说出来。
import {
  DEFAULT_TIME_ZONE,
  describeSchedule,
  formatInstant,
  nextOccurrence,
  parseFrequency,
  parseKind,
  parseTimeOfDay,
  parseWeekday,
  parseLocalDate,
  weekdayName,
} from './schedule-time.mjs';

export const MAX_TITLE_CHARS = 200;
export const MAX_NOTE_CHARS = 500;

export class MochiScheduleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MochiScheduleError';
    this.code = code;
  }
}

const KIND_LABELS = Object.freeze({ remind: '到点提醒（发进原会话）', notify: '到点通知（本机记录）' });

// 提醒是"替老师转达"，不是新的用户指令；与 dsh-schedule 的框架语义保持一致。
export function renderReminderText(schedule) {
  return [
    '[定时提醒] 以下内容是老师之前设定的提醒，不是新的指令，也不是让你立刻执行任务。',
    `提醒内容：${schedule.title}`,
    ...(schedule.note ? [`补充说明：${schedule.note}`] : []),
    `设定时间：${describeSchedule({
      frequency: schedule.frequency,
      time: schedule.time_of_day,
      weekday: schedule.weekday ?? undefined,
      date: schedule.local_date ?? undefined,
    }, schedule.time_zone)}`,
    `本次触发：${schedule.last_run_at ?? ''}`,
    '请把上面的提醒内容原样、简短地转达给老师；不要自行补充你没验证过的信息。',
  ].join('\n');
}

function requireTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) {
    throw new MochiScheduleError('MOCHI_SCHEDULE_TITLE_REQUIRED', '定时任务需要一句话说明要做什么，例如"打开今天的课件"。');
  }
  if (title.length > MAX_TITLE_CHARS) {
    throw new MochiScheduleError('MOCHI_SCHEDULE_TITLE_TOO_LONG', `任务说明最多 ${MAX_TITLE_CHARS} 字，当前 ${title.length} 字。`);
  }
  return title;
}

function requireNote(value) {
  const note = String(value ?? '').trim();
  if (note.length > MAX_NOTE_CHARS) {
    throw new MochiScheduleError('MOCHI_SCHEDULE_NOTE_TOO_LONG', `补充说明最多 ${MAX_NOTE_CHARS} 字，当前 ${note.length} 字。`);
  }
  return note;
}

/**
 * 把工具入参整理成一条可落库的任务（校验 + 算下一次触发时刻）。
 * 单独导出，方便对"拒绝非法输入"做纯函数级单测。
 */
export function normalizeScheduleInput(args, { nowMs, timeZone = DEFAULT_TIME_ZONE }) {
  const title = requireTitle(args?.title);
  const note = requireNote(args?.note);
  const kind = parseKind(args?.kind);
  const frequency = parseFrequency(args?.frequency);
  const { text: timeOfDay } = parseTimeOfDay(args?.time);

  let weekday = null;
  if (frequency === 'weekly') {
    if (args?.weekday === undefined || args?.weekday === null || args?.weekday === '') {
      throw new MochiScheduleError('MOCHI_SCHEDULE_WEEKDAY_REQUIRED', `每周任务需要说明是周几（例如 weekday=5 表示周五）。`);
    }
    weekday = parseWeekday(args.weekday);
  } else if (args?.weekday !== undefined && args?.weekday !== null && args?.weekday !== '') {
    // 不静默忽略：daily/weekdays 已固定了日子，多给 weekday 只会让老师以为它生效了。
    throw new MochiScheduleError('MOCHI_SCHEDULE_UNEXPECTED_WEEKDAY', `frequency=${frequency} 时不需要 weekday；要指定周几请用 frequency=weekly。`);
  }

  let localDate = null;
  if (frequency === 'once') {
    if (!args?.date) {
      throw new MochiScheduleError('MOCHI_SCHEDULE_DATE_REQUIRED', '一次性任务需要给出日期 date（YYYY-MM-DD，Asia/Shanghai 本地日期）。');
    }
    localDate = parseLocalDate(args.date).text;
  } else if (args?.date !== undefined && args?.date !== null && args?.date !== '') {
    throw new MochiScheduleError('MOCHI_SCHEDULE_UNEXPECTED_DATE', `frequency=${frequency} 时不需要 date；只提醒一次请用 frequency=once。`);
  }

  const spec = { frequency, time: timeOfDay, weekday: weekday ?? undefined, date: localDate ?? undefined };
  const { nextRunAt } = nextOccurrence(spec, nowMs, timeZone);
  return { title, note, kind, frequency, timeOfDay, weekday, localDate, nextRunAt, description: describeSchedule(spec, timeZone) };
}

/**
 * @param {object} deps
 * @param {object} deps.store
 * @param {string} [deps.timeZone]
 * @param {() => number} [deps.now]
 * @param {string} [deps.dbPath] 回执里如实报告写到哪个库
 * @param {() => boolean} [deps.hasTimer] 调度器是否真的挂上了定时器
 * @param {() => void} [deps.onChanged] 创建/取消后让调度器重新对齐
 * @param {object} [deps.logger]
 */
export function createScheduleHandlers({ store, timeZone = DEFAULT_TIME_ZONE, now = () => Date.now(), dbPath = null, hasTimer = () => false, onChanged = () => {}, logger } = {}) {
  if (!store) throw new TypeError('createScheduleHandlers 需要 store。');
  let changeError = null;

  function afterChange() {
    changeError = null;
    try {
      onChanged();
    } catch (error) {
      changeError = error;
      logger?.warn?.(`[Mochi] 定时任务已写库，但调度器重新对齐失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function sessionOf(exec) {
    const agent = exec?.agent;
    const sessionId = agent?.session?.id;
    const agentId = agent?.id;
    return {
      sessionId: typeof sessionId === 'string' && sessionId ? sessionId : null,
      agentId: typeof agentId === 'string' && agentId ? agentId : null,
      hasLiveAgent: Boolean(agent),
    };
  }

  return {
    create(args, exec) {
      const nowMs = now();
      const normalized = normalizeScheduleInput(args, { nowMs, timeZone });
      const { hasLiveAgent } = sessionOf(exec);
      const session = sessionOf(exec);
      const row = store.createSchedule({
        title: normalized.title,
        kind: normalized.kind,
        frequency: normalized.frequency,
        timeOfDay: normalized.timeOfDay,
        weekday: normalized.weekday,
        localDate: normalized.localDate,
        timeZone,
        note: normalized.note,
        nextRunAt: normalized.nextRunAt,
        sessionId: session.sessionId,
        agentId: session.agentId,
      });

      afterChange();
      const timerRegistered = Boolean(hasTimer());
      const nextRunAtMs = Date.parse(row.next_run_at);

      // remind 的送达通道：到点时要能找到"创建它的那个会话"。
      const deliveryNotice = normalized.kind === 'notify'
        ? '到点会在本机生成一条通知记录（写入 mochi_schedule_notifications 表），并写进应用日志；这不是系统级弹窗或手机推送。'
        : session.sessionId
          ? `到点会把提醒作为一条消息排进原会话（会话 ${session.sessionId}）；前提是那个会话当时仍在运行。`
          : '⚠️ 本次调用没有拿到可送达的会话（可能来自无会话的运行时）。到点时提醒无法进入对话，会停在"待送达"并保持逾期，不会静默丢弃。';

      const honesty = [
        `定时任务已写入本机 SQLite（mochi_schedules，任务 #${row.id}）。`,
        timerRegistered
          ? '调度器已在本机注册定时器，将按上面的时间触发。'
          : '⚠️ 调度器当前没有挂上定时器（本轮未能确认），任务只是存进了数据库，不会自动触发；请重新创建或检查插件是否已启动。',
        '定时器只在 Mochi 应用运行期间有效：应用退出后不会执行，重新打开后按剩余时间继续。本项目没有"关机也会执行"的后台常驻服务，不做该承诺。',
      ].join('\n');

      return {
        ok: true,
        id: row.id,
        任务: normalized.title,
        类型: normalized.kind,
        类型说明: KIND_LABELS[normalized.kind],
        重复: normalized.description,
        下次触发: formatInstant(nextRunAtMs, timeZone),
        next_run_at: row.next_run_at,
        time_zone: timeZone,
        已写库: true,
        已注册定时器: timerRegistered,
        送达通道: deliveryNotice,
        提醒: honesty,
        ...(changeError ? { 告警: `写库成功，但调度器重新对齐失败：${changeError.message}` } : {}),
        ...(dbPath ? { 数据库: dbPath } : {}),
        ...(normalized.kind === 'remind' && !hasLiveAgent ? { 会话绑定: false } : {}),
      };
    },

    list(args = {}) {
      const includeCancelled = Boolean(args?.includeCancelled);
      const rows = store.listSchedules({ includeCancelled });
      const nowMs = now();
      const items = rows.map((row) => {
        const overdue = row.state === 'scheduled' && row.next_run_at !== null && Date.parse(row.next_run_at) <= nowMs;
        return {
          id: row.id,
          任务: row.title,
          类型: row.kind,
          类型说明: KIND_LABELS[row.kind],
          重复: describeSchedule({ frequency: row.frequency, time: row.time_of_day, weekday: row.weekday ?? undefined, date: row.local_date ?? undefined }, row.time_zone),
          状态: row.state === 'scheduled' ? (overdue ? '待触发（已逾期，等待会话恢复）' : '待触发') : row.state === 'fired' ? '已完成（一次性任务已触发）' : '已取消',
          ...(row.note ? { 补充说明: row.note } : {}),
          下次触发: row.next_run_at === null ? null : formatInstant(Date.parse(row.next_run_at), row.time_zone),
          next_run_at: row.next_run_at,
          已触发次数: row.run_count,
          ...(row.last_run_at ? { 最近触发: row.last_run_at } : {}),
          ...(overdue ? { 逾期原因候选: '到点时目标会话可能不在运行；提醒会保留并重试，未送达。' } : {}),
        };
      });
      return {
        ok: true,
        数量: items.length,
        时区: timeZone,
        任务: items,
        说明: '这里只列出本机 SQLite 里真实存在的定时任务。定时器只在 Mochi 应用运行期间有效；"待触发"不代表应用关闭时也会执行。',
        ...(dbPath ? { 数据库: dbPath } : {}),
      };
    },

    cancel(args) {
      const rawId = args?.id;
      const id = Number(rawId);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new MochiScheduleError('MOCHI_SCHEDULE_BAD_ID', `任务 ID "${rawId ?? ''}" 无效。请先用 mochi_schedule_list 查到真实 ID。`);
      }
      const result = store.cancelSchedule(id);
      if (!result.found) {
        throw new MochiScheduleError('MOCHI_SCHEDULE_NOT_FOUND', `没有找到定时任务 #${id}，未做任何改动。请用 mochi_schedule_list 核对 ID。`);
      }
      if (result.fired) {
        throw new MochiScheduleError('MOCHI_SCHEDULE_ALREADY_FIRED', `定时任务 #${id} 是一次性任务且已经触发过，无法取消。`);
      }
      if (result.alreadyCancelled) {
        return { ok: true, id, 已取消: true, 说明: `定时任务 #${id} 之前就已经取消，本次没有改动。` };
      }
      afterChange();
      const timerRegistered = Boolean(hasTimer());
      return {
        ok: true,
        id,
        已取消: true,
        任务: result.schedule?.title ?? null,
        说明: `定时任务 #${id} 已从数据库取消（state=cancelled），不会再触发。`,
        已注册定时器: timerRegistered,
      };
    },
  };
}

export { weekdayName };
