// Legacy v2 event projection for existing session replay; it no longer controls tools.
export const MODE_CHAT = 'chat';
export const MODE_WORK = 'work';

/** Historical tool identity; no tool is registered under this name anymore. */
export const REQUEST_TOOL = 'mochi_request_work_mode';
/** Historical command identities; no switching command is registered anymore. */
export const WORK_COMMAND = 'mochi-work';
export const CHAT_COMMAND = 'mochi-chat';
/** Historical projection key, retained for session checkpoint compatibility. */
export const PROJECTION_KEY = 'mochiModes';

/** Stable campus-tool ordering only; this list never filters capability or permission. */
export const CONVERSATION_TOOLS = Object.freeze([
  REQUEST_TOOL,
  'mochi_lan_status',
  'mochi_lan_configure_identity',
  'mochi_lan_pending_requests',
  'mochi_lan_reply_student_request',
  'mochi_lan_probe_classroom',
  'mochi_lan_pair_classroom',
  'mochi_lan_send_student_request',
  'mochi_lan_decide_pairing',
  'mochi_lan_received_presentations',
  'mochi_lan_open_presentation',
  'mochi_list_classrooms',
  'mochi_notify_classroom',
  'mochi_call_student',
  'mochi_register_verdicts',
  'mochi_set_campus_background',
  'mochi_open_camera',
  'mochi_tasks',
  'mochi_memory_note',
  'mochi_memory_observe',
  'mochi_memory_recall',
  'mochi_memory_forget',
  'mochi_memory_list',
  'mochi_journal_read',
  'mochi_journal_summarize',
  'mochi_memory_world',
  'mochi_memory_clear',
  // Read-only campus tools still authenticate through CampusConnection and the Worker.
  'jxl_query',
  'jxl_student_query',
  'jxl_student_directory_search',
  'jxl_clinic_status',
  'jxl_dorm_status',
  'jxl_campus_status',
  'jxl_health_events',
  'jxl_message',
  'jxl_movement_detail',
  'jxl_student_card',
  'jxl_event_detail',
  'jxl_analytics',
  'jxl_relay_list',
  'sidebar_open',
]);

const CONVERSATION_TOOL_ORDER = new Map(CONVERSATION_TOOLS.map((name, index) => [name, index]));

/**
 * 前置本次 assembly 已有的对话工具 schema，并保持其他 schema 的原始顺序。
 *
 * 只重排 schema 引用，不复制、创建或删除工具定义。按当前 assembly 的实际可见集
 * 计算，因此角色缺少的工具不会被静态工具顺序误报为未注册。
 *
 * @param {unknown} schemas - PromptAssembly.tools 的本次模型可见列表。
 * @returns {unknown} 非数组原样返回；数组返回按对话工具优先级排序的副本。
 */
export function orderConversationSchemas(schemas) {
  if (!Array.isArray(schemas)) return schemas;
  return schemas
    .map((schema, sourceIndex) => ({
      schema,
      sourceIndex,
      order: CONVERSATION_TOOL_ORDER.get(schema?.name) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex)
    .map(({ schema }) => schema);
}

/** Values accepted by the legacy event projection. */
export function isMode(value) {
  return value === MODE_CHAT || value === MODE_WORK;
}

/**
 * session 投影的折叠：把已提交的日志事件折成当前模式。
 *
 * 模式只从两类**已持久化**的事件推导，不做客户端乐观猜测：
 *   1. `/mochi-work` / `/mochi-chat` 命令的 run→done 生命周期；
 *   2. `mochi_request_work_mode` 这个工具触发的 approval/asked→decided。
 * 因此 resume / fork 只要重放日志就能恢复模式。
 *
 * @param {{mode: string, pending: object|null}} state - 上一状态。
 * @param {{type: string, data?: object}} event - 一条已提交会话事件。
 * @returns {object} 新状态（无变化时返回同一引用）。
 */
export function foldModeEvent(state, event) {
  const type = event && event.type;
  const data = event && event.data;
  if (type === 'agent-preset/selected' && typeof data?.agentPreset === 'string') {
    return { mode: initialMode({ agentPreset:data.agentPreset }), pending:null };
  }
  if (type === 'command/run' && data) {
    const wanted = data.name === WORK_COMMAND ? MODE_WORK : data.name === CHAT_COMMAND ? MODE_CHAT : null;
    if (wanted === null) return state;
    return { mode: state.mode, pending: { id: `command:${String(data.commandId)}`, wanted } };
  }
  if (type === 'command/done' && data) {
    const pending = state.pending;
    if (!pending || pending.id !== `command:${String(data.commandId)}`) return state;
    const mode = data.kind === 'success' ? pending.wanted : state.mode;
    return { mode, pending: null };
  }
  if (type === 'approval/asked' && data) {
    if (data.toolName !== REQUEST_TOOL) return state;
    return { mode: state.mode, pending: { id: `approval:${String(data.id)}`, wanted: MODE_WORK } };
  }
  if (type === 'approval/decided' && data) {
    const pending = state.pending;
    if (!pending || pending.id !== `approval:${String(data.id)}`) return state;
    const mode = data.outcome === 'allowed-once' ? MODE_WORK : state.mode;
    return { mode, pending: null };
  }
  return state;
}

/**
 * 投影对客户端暴露的值：当前模式 + 是否有一个尚未生效的切换请求。
 * @param {{mode: string, pending: object|null}} state - 折叠后的状态。
 * @returns {{mode: string, pending: boolean}}
 */
export function modeView(state) {
  return {
    mode: isMode(state.mode) ? state.mode : MODE_CHAT,
    pending: state.pending !== null && state.pending !== undefined,
  };
}

// ---------------------------------------------------------------------------
// 极小的 schema 垫片。
// session-projection 只对 stateSchema / viewSchema 调用 `.parse()`（已在
// dsh-session-projection/lib/index.js:255,259,297,305 核对），不需要 zod 的其余能力。
// 本插件不引入任何新依赖，因此自带一个只做结构校验的 parse。
// ---------------------------------------------------------------------------
function makeSchema(validate, label) {
  return {
    parse(value) {
      if (!validate(value)) throw new TypeError(`${label} 结构不合法：${JSON.stringify(value)}`);
      return value;
    },
  };
}

function isPending(value) {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  return typeof value.id === 'string' && value.id.length > 0
    && (value.wanted === MODE_CHAT || value.wanted === MODE_WORK);
}

const stateSchema = makeSchema(
  (value) => !!value && typeof value === 'object'
    && isMode(value.mode) && isPending(value.pending),
  `session 投影 ${PROJECTION_KEY} 的状态`,
);

const viewSchema = makeSchema(
  (value) => !!value && typeof value === 'object'
    && isMode(value.mode) && typeof value.pending === 'boolean',
  `session 投影 ${PROJECTION_KEY} 的客户端视图`,
);

/** session 投影单元定义，交给 ctx.sessionProjections.register()。 */
export const initialMode = header => header?.agentPreset === 'standard' ? MODE_WORK : MODE_CHAT;
export const modeProjection = Object.freeze({
  key: PROJECTION_KEY,
  stateVersion: 2,
  stateSchema,
  viewSchema,
  init: header => ({ mode: initialMode(header), pending: null }),
  apply: (state, event) => foldModeEvent(state, event),
  view: (state) => modeView(state),
});

/**
 * 组装投影定义成 sessionProjections.register() 需要的形状。
 * @returns {object} register() 的入参。
 */
export function createProjectionDefinition() {
  return {
    key: modeProjection.key,
    stateVersion: modeProjection.stateVersion,
    stateSchema: modeProjection.stateSchema,
    init: modeProjection.init,
    apply: modeProjection.apply,
    wire: { viewSchema: modeProjection.viewSchema, view: modeProjection.view },
  };
}
