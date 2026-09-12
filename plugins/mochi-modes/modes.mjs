// mochi-modes · 「对话界面 / 工作界面」两种模式的纯逻辑（可单测，不依赖 cordis 宿主）。
//
// 两个界面共用同一个官方 chat 会话视图，差别只有三处：工具面（restrict 面具）、
// 工作台显隐（客户端读投影决定）、顶部模式标识文案。
//
// 设计事实（全部来自 DSH 官方源码，不猜测）：
//   * 省 token 的正解是 `ctx.tools.restrict(filter)`：官方 README 明确
//     “Restrictions that hide tools remove their entire schema cost for that agent.”
//   * restrict 必须用在 **作用域上下文** 上：`agent.ctx.tools.restrict(...)`，
//     用根 ctx 会抛 “requires a scoped context (agent.ctx)”。
//   * 空 filter（`{}`）会抛；未知工具名会抛；保留名 `run_code` 不能出现在
//     allow/deny 里（PTC 传输保留）。所以 allow 列表必须从**真实可见工具面**
//     取交集，而不是写死猜的名字。
//   * 面具是「只留 allow 里的全局/继承工具」，作用域自己那一层注册的工具
//     不受影响（restrict 文档：restrictions never remove what its OWN layer
//     registers）。Mochi 的工具插件挂在宿主层、预设工具挂在预设「standing」
//     层（是 agent 作用域的父层），两者都属于「可被 restrict 过滤」的集合。

export const MODE_CHAT = 'chat';
export const MODE_WORK = 'work';

/** 模型在对话界面唯一能调用的工具：请求老师批准进入工作界面开始干活。 */
export const REQUEST_TOOL = 'mochi_request_work_mode';
/** 老师手动切换用的斜杠命令（命令名语法：小写字母/数字/_/-）。 */
export const WORK_COMMAND = 'mochi-work';
export const CHAT_COMMAND = 'mochi-chat';
/** 确认卡上显示的文案，作为 approval 请求的 reason。 */
export const WORK_REQUEST_REASON = '需要工作模式，继续？';
/** 客户端读取模式的 session 投影键。 */
export const PROJECTION_KEY = 'mochiModes';

/**
 * chat 模式保留的工具面。极小：只有请求升级的工具本身。
 * 其余全部被 allow 面具挡掉，省下整份 schema 开销。
 */
export const CONVERSATION_TOOLS = Object.freeze([REQUEST_TOOL]);

/** PTC 传输保留名，永远不能出现在 allow/deny 里。 */
const RESERVED_TOOL = 'run_code';

export function isMode(value) {
  return value === MODE_CHAT || value === MODE_WORK;
}

/**
 * 从**真实可见工具名**算 chat 模式的 allow 面具。
 *
 * 只保留 CONVERSATION_TOOLS ∩ 真实注册面，并剔除保留名。若交集为空
 * （例如请求工具还没注册上），返回 null：调用方必须**放弃限制并如实记日志**，
 * 绝不能伪造一个“已收窄”的假象，也不能拿空 filter 去撞 restrict 的抛错。
 *
 * @param {Iterable<string>} visibleNames - ctx.tools.schemas(agent) 的名字集合。
 * @returns {{ allow: string[] } | null} 可直接喂给 restrict 的 filter，或 null。
 */
export function planRestriction(visibleNames) {
  const visible = new Set();
  for (const name of visibleNames ?? []) {
    if (typeof name === 'string' && name) visible.add(name);
  }
  const allow = CONVERSATION_TOOLS.filter((name) => name !== RESERVED_TOOL && visible.has(name));
  if (allow.length === 0) return null;
  return { allow };
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
export const modeProjection = Object.freeze({
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema,
  viewSchema,
  init: () => ({ mode: MODE_CHAT, pending: null }),
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

/**
 * 模式控制器：持有每个 agent 的当前模式与 restrict disposer。
 *
 * 依赖以「接口对象」注入，方便单测：
 * @param {object} deps
 * @param {{schemas: Function, restrict: Function}} deps.tools - 根 ctx 的 tools 服务。
 * @param {(msg: string) => void} [deps.warn] - 失败/降级时的诚实日志出口。
 * @param {() => boolean} [deps.canRestrict] - 是否允许收窄工具面。默认允许。
 *   **没有确认通道时必须传 false**：对话模式下唯一能调用的工具是
 *   `mochi_request_work_mode`，而它要靠审批卡才能解禁。审批通道不存在时会话会被
 *   永久锁死在「只有一个工具」的状态——宁可放开全部工具，也不能锁死老师。
 * @returns {object} 控制器。
 */
export function createModesController(deps) {
  const tools = deps && deps.tools;
  const warn = (typeof deps?.warn === 'function' ? deps.warn : () => {});
  const canRestrict = (typeof deps?.canRestrict === 'function' ? deps.canRestrict : () => true);
  if (!tools || typeof tools.schemas !== 'function' || typeof tools.restrict !== 'function') {
    throw new TypeError('createModesController 需要 tools.schemas / tools.restrict');
  }
  /** agent -> { mode, restrict } —— restrict 为 null 表示「当前无限制」。 */
  const states = new Map();

  function stateFor(agent) {
    let state = states.get(agent);
    if (!state) {
      state = { mode: MODE_CHAT, restrict: null };
      states.set(agent, state);
    }
    return state;
  }

  function visibleToolNames(agent) {
    const schemas = tools.schemas(agent) || [];
    return schemas.map((schema) => schema && schema.name).filter((name) => typeof name === 'string');
  }

  /** 建限制。失败时返回 null 并如实记日志，绝不假装已收窄。 */
  function buildRestriction(agent) {
    if (!canRestrict()) {
      warn('[mochi-modes] 当前没有可用的确认通道，本轮不收窄工具面（防呆：避免把会话锁死在只有一个工具）');
      return null;
    }
    const filter = planRestriction(visibleToolNames(agent));
    if (filter === null) {
      warn(`[mochi-modes] 可见工具面里找不到 ${REQUEST_TOOL}，本轮不施加限制（未收窄，非假装成功）`);
      return null;
    }
    try {
      return agent.ctx.tools.restrict(filter);
    } catch (error) {
      warn(`[mochi-modes] restrict 失败，本轮保持全量工具：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 幂等地把 agent 切到 mode。
   * @param {object} agent - dsh Agent（需带 .ctx）。
   * @param {'chat'|'work'} mode
   * @returns {'chat'|'work'|null} 生效后的模式；agent 不合法时返回 null。
   */
  function setMode(agent, mode) {
    if (!agent || !agent.ctx || !isMode(mode)) return null;
    const state = stateFor(agent);
    if (mode === MODE_WORK) {
      if (state.mode === MODE_WORK && state.restrict === null) return MODE_WORK;
      if (state.restrict) {
        state.restrict();
        state.restrict = null;
      }
      state.mode = MODE_WORK;
      return MODE_WORK;
    }
    if (state.mode === MODE_CHAT && state.restrict) return MODE_CHAT;
    state.mode = MODE_CHAT;
    if (!state.restrict) state.restrict = buildRestriction(agent);
    return MODE_CHAT;
  }

  /**
   * agent 创建时挂上初始模式（幂等）。
   * @param {object} agent - 新建的 agent。
   * @param {'chat'|'work'} durableMode - 从日志投影恢复出的模式。
   * @returns {'chat'|'work'|null}
   */
  function attach(agent, durableMode) {
    if (!agent || !agent.ctx) return null;
    stateFor(agent);
    return setMode(agent, isMode(durableMode) ? durableMode : MODE_CHAT);
  }

  /** agent 销毁：清掉本地记录；限制本身由 agent.ctx 生命周期自动解除。 */
  function detach(agent) {
    states.delete(agent);
  }

  function modeOf(agent) {
    const state = states.get(agent);
    return state ? state.mode : null;
  }

  function isRestricted(agent) {
    const state = states.get(agent);
    return !!(state && state.restrict);
  }

  return { attach, detach, setMode, modeOf, isRestricted };
}
