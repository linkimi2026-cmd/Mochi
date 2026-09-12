// Mochi 定时任务插件（cordis 风格 ESM）。
//
// 工具：mochi_schedule_create / mochi_schedule_list / mochi_schedule_cancel
//   —— 只允许字母数字下划线连字符。带点的工具名会被模型网关 400 拒收整轮对话
//      （2026-09-12 真实事故），这里不冒险。
//
// 能力边界（不吹）：
//   * 任务真的写进本机 SQLite（DSH_HOME/scheduler/mochi-schedules.sqlite），重启后还在。
//   * 到点由**当前进程内**的 setTimeout 链触发；应用退出后不执行，没有后台常驻服务。
//   * remind 到点会尝试把提醒排进"创建它的那个会话"；找不到活着的会话就停在逾期并如实说明，
//     绝不假装送达。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { DEFAULT_TIME_ZONE, formatInstant } from './schedule-time.mjs';
import { createScheduler } from './scheduler.mjs';
import { createScheduleStore, defaultDbPath, openScheduleDb } from './store.mjs';
import { createScheduleHandlers, renderReminderText, MAX_NOTE_CHARS, MAX_TITLE_CHARS } from './tools.mjs';

export const name = 'mochi-task-scheduler';
export const inject = ['tools'];

// ⚠️ render 签名是 (args, value)：第一个参数是调用参数，第二个才是工具返回值。
const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

const TICK_MS = 60_000;

export function isLiveAgent(ctx, agent) {
  if (!agent || typeof agent.followup !== 'function' || !agent.session) return false;
  const agents = ctx?.get?.('agents');
  if (!agents || typeof agents.get !== 'function') return true;
  try {
    return agents.get(agent.id) === agent;
  } catch {
    return false;
  }
}

/**
 * 构造"到点该做什么"。单独导出，便于用桩会话直接验证真实投递路径。
 *
 * 返回值约定：{outcome: 'delivered' | 'pending' | 'failed', channel, detail}
 *   delivered —— 已把提醒排进会话 / 已写入本机通知记录；不表示老师看到或执行了。
 *   pending   —— 目标会话不在，保留逾期等待重试。
 *   failed    —— 通道出错，未送达。
 */
export function createDeliverer({ ctx, store, sessionAgents = new Map() }) {
  let llmModule = null;
  const loadLlm = () => (llmModule ??= import('@deepseek-ai/dsh-llm'));

  function findAgentForSession(sessionId) {
    if (!sessionId) return null;
    const bound = sessionAgents.get(sessionId);
    if (bound && isLiveAgent(ctx, bound)) return bound;
    const agents = ctx?.get?.('agents');
    if (!agents) return null;
    try {
      const direct = agents.get?.(sessionId);
      if (direct && direct.session?.id === sessionId && isLiveAgent(ctx, direct)) return direct;
    } catch { /* 注册表不可用时走下面的兜底扫描。 */ }
    try {
      for (const agent of agents.roots?.() ?? []) {
        if (agent?.session?.id === sessionId && isLiveAgent(ctx, agent)) return agent;
      }
    } catch { /* 兜底失败即视为"没有活着的会话"。 */ }
    return null;
  }

  return async function deliver(row, { firedAt = Date.now() } = {}) {
    if (row.kind === 'notify') {
      store.addNotification({ scheduleId: row.id, title: row.title, note: row.note, createdAt: firedAt });
      ctx?.logger?.info?.(`[Mochi] 定时通知 #${row.id}：${row.title}`);
      return {
        outcome: 'delivered',
        channel: 'local-notification',
        detail: '已写入本机通知记录表 mochi_schedule_notifications 并打进应用日志；这不是系统弹窗，也不是手机推送。',
      };
    }

    const agent = findAgentForSession(row.session_id);
    if (!agent) {
      return {
        outcome: 'pending',
        channel: 'session-followup',
        detail: `到点时没有找到会话 ${row.session_id ?? '（创建时未绑定会话）'} 对应的活着的 Agent（应用可能重启过，或那个会话已经关闭）。提醒不会丢弃，会保持逾期并在会话恢复后重试。`,
      };
    }
    try {
      const { createUserMessage } = await loadLlm();
      const message = createUserMessage({
        content: [{ type: 'text', text: renderReminderText({ ...row, last_run_at: formatInstant(firedAt, row.time_zone) }) }],
        source: { kind: 'plugin', plugin: name },
      });
      agent.followup(message);
      return {
        outcome: 'delivered',
        channel: 'session-followup',
        detail: '提醒已作为一条后续消息排入原会话（排队成功；这不代表老师已经看到或已经执行）。',
      };
    } catch (error) {
      return {
        outcome: 'failed',
        channel: 'session-followup',
        detail: `投递失败，未声称送达：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

export function apply(ctx) {
  const timeZone = DEFAULT_TIME_ZONE;
  const dbPath = defaultDbPath();
  let store = null;
  let storeError = null;
  try {
    store = createScheduleStore(openScheduleDb(dbPath));
    ctx.logger?.info?.(`[Mochi] 定时任务库：${dbPath}（时区 ${timeZone}）`);
  } catch (error) {
    storeError = error;
    ctx.logger?.error?.(`[Mochi] 定时任务库打不开：${error instanceof Error ? error.message : String(error)}`);
  }

  // 会话 → 活着的 Agent。只用于"到点把提醒送回原会话"，是进程内的易失索引；
  // 任务本身始终以 SQLite 为准。
  const sessionAgents = new Map();

  let scheduler = null;
  if (store) {
    scheduler = createScheduler({
      store,
      deliver: createDeliverer({ ctx, store, sessionAgents }),
      timeZone,
      tickMs: TICK_MS,
      logger: ctx.logger,
    });
    scheduler.start();
  }

  const handlers = createScheduleHandlers({
    store: store ?? {
      // 库打不开时也不静默：任何调用都会得到明确的错误。
      createSchedule() { throw new Error(`本机定时任务库不可用：${storeError?.message ?? '未知原因'}`); },
      listSchedules() { throw new Error(`本机定时任务库不可用：${storeError?.message ?? '未知原因'}`); },
      cancelSchedule() { throw new Error(`本机定时任务库不可用：${storeError?.message ?? '未知原因'}`); },
    },
    timeZone,
    dbPath,
    hasTimer: () => Boolean(scheduler?.pendingTimer),
    onChanged: () => scheduler?.refresh(),
    logger: ctx.logger,
  });

  // 记录会话，供 remind 到点找回归属会话。
  if (typeof ctx.on === 'function') {
    const remember = ({ agent }) => {
      const sessionId = agent?.session?.id;
      if (typeof sessionId === 'string' && sessionId) sessionAgents.set(sessionId, agent);
    };
    const forget = ({ agent }) => {
      const sessionId = agent?.session?.id;
      if (typeof sessionId === 'string' && sessionAgents.get(sessionId) === agent) sessionAgents.delete(sessionId);
    };
    try {
      ctx.on('agent/created', remember);
      ctx.on('agent/disposed', forget);
    } catch { /* 事件词汇不可用时不影响工具本身。 */ }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      sessionAgents.clear();
      void scheduler?.stop();
    }, 'mochi-task-scheduler.lifecycle()');
  }

  const register = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({ name: toolName, description, parameters, output, execute }));

  register(
    'mochi_schedule_create',
    '创建一个定时任务。老师口语里的"每天/每周/工作日几点"要翻译成这里的字段：'
    + 'frequency=once（只一次，必须给 date）| daily（每天）| weekly（每周某天，必须给 weekday）| weekdays（周一至周五）；'
    + 'time 用 24 小时制 HH:MM 补零（如 07:50），时区固定 Asia/Shanghai；weekday 用 1-7（1=周一，7=周日）。'
    + 'kind=remind 到点把提醒发回创建它的那个会话；kind=notify 到点只在本机记一条通知。其它类型暂不支持。'
    + '只有真的写进本机数据库、且调度器真的挂上定时器，回执里才会说已安排；应用关闭期间不会执行（没有后台常驻服务），不要向老师承诺"关机也会执行"。',
    {
      title: { type: 'string', required: true, description: `要做什么，一句话（≤${MAX_TITLE_CHARS} 字），例如"打开今天的课件"。到点会原样转达给老师。` },
      kind: { type: 'string', enum: ['remind', 'notify'], required: true, description: 'remind=到点在原会话发提醒；notify=到点产出一条本机通知记录。' },
      frequency: { type: 'string', enum: ['once', 'daily', 'weekly', 'weekdays'], required: true, description: 'once=只一次；daily=每天；weekly=每周某天（需 weekday）；weekdays=周一至周五。' },
      time: { type: 'string', required: true, description: '触发时刻，24 小时制 HH:MM 补零，Asia/Shanghai 本地时间。例：07:50、19:30。' },
      weekday: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7], description: '仅 frequency=weekly 时必填：1=周一，2=周二，…，7=周日。' },
      date: { type: 'string', description: '仅 frequency=once 时必填：YYYY-MM-DD（Asia/Shanghai 本地日期），必须是将来时间。' },
      note: { type: 'string', description: `可选补充说明（≤${MAX_NOTE_CHARS} 字），会跟在提醒正文后面。` },
    },
    (args, exec) => handlers.create(args, exec),
  );

  register(
    'mochi_schedule_list',
    '列出本机真实存在的定时任务（读本机 SQLite，不是猜的）。返回每条的 ID、重复规则、状态、下次触发时间与已触发次数。'
    + '"待触发（已逾期）"表示到点时目标会话不在、提醒还留着重试，不代表已经送达。',
    { includeCancelled: { type: 'boolean', description: '是否连已取消的任务一起列出，默认 false。' } },
    (args) => handlers.list(args),
  );

  register(
    'mochi_schedule_cancel',
    '按 ID 取消一条定时任务（ID 必须来自 mochi_schedule_list，不得猜测）。取消会写进数据库，之后不会再触发。'
    + '已取消过的 ID 重复取消是安全的；一次性任务已经触发过则无法取消，会明确报错。',
    { id: { type: 'integer', required: true, description: '要取消的任务 ID，来自 mochi_schedule_list。' } },
    (args) => handlers.cancel(args),
  );
}

export { output };
