// mochi-modes · 「对话界面 / 工作界面」两种模式的宿主侧。
//
// 会话视图始终是官方 chat，两个“界面”的差别只体现在三处：工具面、工作台显隐、
// 顶部模式标识。语义（与老师的需求一一对应）：
//   * 对话界面（默认）：只用来聊天、讨论想法、问问题，工具面被 restrict 收窄到
//     极小 —— 直接省 token，也真的没有任何干活能力。
//   * 工作界面：解除 restriction，全量工具，AI 在这里真的干活、出文件。
//   * 升级主路（对话 → 工作）：对话里出现干活需求 → 模型调 mochi_request_work_mode
//     → 走官方原生审批卡问老师「需要工作模式，继续？」→ 老师点「允许一次」后
//     在同一个会话里解除限制，模型下一回合拿全量工具直接开干。
//   * 手动路径：老师点「工作」→ 客户端经官方 commands 通道执行 /mochi-work →
//     直接切换，不弹窗（一上来就点工作 = 老师已明确选了干活）。
//
// 作用域：Mochi 的工具插件挂在宿主层，拿不到 agent 作用域，因此 restrict 只能在
// `agent/created` 拿到真实 agent.ctx 之后再施加 —— 这是官方给宿主级插件留下的
// 唯一入口（`setup` 只是 AgentRegistry.create/resume 的创建参数，由
// api-session-controller 的 composeAgent 独占，宿主插件没有缝合点可用）。
// 时序上 agent/created 早于首个 prompt assembly，足以在第一次请求前生效。
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  CHAT_COMMAND,
  MODE_CHAT,
  MODE_WORK,
  PROJECTION_KEY,
  REQUEST_TOOL,
  WORK_COMMAND,
  WORK_REQUEST_REASON,
  createModesController,
  createProjectionDefinition,
} from './modes.mjs';

export const name = 'mochi-modes';
export const inject = ['tools'];

export function apply(ctx) {
  const warn = (message) => {
    if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message);
    else console.warn(message);
  };

  /** 官方审批服务；不存在时返回 undefined（不抛）。 */
  const approvalChannel = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('approval') : undefined;
    } catch {
      return undefined;
    }
  };

  // 防呆：确认通道不存在时绝不收窄工具面。对话模式下唯一可调的工具是
  // mochi_request_work_mode，而它必须靠审批卡才能解禁 —— 没有审批通道却收窄，
  // 会话会被永久锁死在「只有一个工具」的状态。宁可放开全部工具。
  const controller = createModesController({
    tools: ctx.tools,
    warn,
    canRestrict: () => {
      const approval = approvalChannel();
      return !!approval && typeof approval.request === 'function';
    },
  });

  // ── 模型侧：唯一的升级入口 ──────────────────────────────────────────────
  const requestTool = defineTool({
    name: REQUEST_TOOL,
    description: '请求老师批准进入「工作界面」动手干活。'
      + '只在老师**已经明确要求产出东西**（转 PDF、做课件、改文件、生成表格、写文档等）'
      + '而当前还在对话界面时才调用；纯讨论、提问、闲聊、只是聊想法时一律不要调用。'
      + '老师批准后你会立刻拿到全部工具并直接开干；'
      + '老师拒绝后请留在对话界面用文字继续聊，不要再次调用本工具。'
      + '已经在工作界面时本工具直接返回已就绪，不会重复弹窗。',
    parameters: {
      task: { type: 'string', description: '老师要你做的实际任务，一句话说明。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args, exec) => {
      const agent = exec && exec.agent;
      if (!agent) throw new Error('无法确定当前会话，未切换模式。');
      if (controller.modeOf(agent) === MODE_WORK) {
        return { granted: true, mode: MODE_WORK, message: '已经在工作界面，工具全开，直接继续干活就行，不用再请求切换。' };
      }
      const approval = approvalChannel();
      if (!approval || typeof approval.request !== 'function') {
        throw new Error('当前没有可用的确认通道，无法进入工作界面；请老师手动切到「工作」。');
      }
      const task = typeof args?.task === 'string' ? args.task.trim() : '';
      const outcome = await approval.request({
        agent,
        toolName: REQUEST_TOOL,
        ...(exec.callId === undefined ? {} : { callId: exec.callId }),
        reason: task ? `${WORK_REQUEST_REASON}（任务：${task}）` : WORK_REQUEST_REASON,
        ...(exec.signal === undefined ? {} : { signal: exec.signal }),
      });
      if (outcome !== 'allowed-once') {
        // 老师拒绝 = 明确表示“先别动手”。这里必须把话写给模型看：留在对话界面，
        // 用文字接着聊，不许背地里再请求一次（避免反复弹卡骚扰老师）。
        throw new Error(outcome === 'rejected'
          ? '老师没有批准进入工作界面，你仍然在对话界面：请用文字继续沟通；不要再调用本工具请求切换。'
          : `确认未通过（${outcome}），仍在对话界面，请用文字继续沟通；不要再次请求切换。`);
      }
      controller.setMode(agent, MODE_WORK);
      return {
        granted: true,
        mode: MODE_WORK,
        message: task
          ? `老师已批准，已进入工作界面：全部工具已打开，现在直接开始做「${task}」。`
          : '老师已批准，已进入工作界面：全部工具已打开，现在直接开始干活。',
      };
    },
  });
  if (!/^[a-zA-Z0-9_-]+$/.test(requestTool.name)) {
    throw new Error(`工具名不合规（网关会拒收整轮对话）：${requestTool.name}`);
  }
  ctx.tools.register(requestTool);

  // ── 老师侧：手动直接切换（不弹窗）──────────────────────────────────────
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: WORK_COMMAND,
      description: '进入工作界面（全量工具，AI 开始干活）',
      recordInput: false,
      handler: ({ agent }) => {
        const applied = controller.setMode(agent, MODE_WORK);
        if (applied !== MODE_WORK) return { kind: 'error', text: '无法切换：当前会话不可用。' };
        return { kind: 'success', text: '已进入工作界面：工具已全开，可以开始干活了。' };
      },
    });
    commandCtx.commands.register({
      name: CHAT_COMMAND,
      description: '回到对话界面（只保留对话必需工具，省 token）',
      recordInput: false,
      handler: ({ agent }) => {
        const applied = controller.setMode(agent, MODE_CHAT);
        if (applied !== MODE_CHAT) return { kind: 'error', text: '无法切换：当前会话不可用。' };
        return { kind: 'success', text: '已回到对话界面：工具已收窄，只用来聊天。' };
      },
    });
  });

  // ── 客户端显示：官方 session 投影 ─────────────────────────────────────
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(createProjectionDefinition());
  });

  function durableModeOf(agent) {
    const projections = typeof ctx.get === 'function' ? ctx.get('sessionProjections') : undefined;
    if (!projections || typeof projections.stateOf !== 'function') return MODE_CHAT;
    try {
      const state = projections.stateOf(agent.session, PROJECTION_KEY);
      return state && state.mode === MODE_WORK ? MODE_WORK : MODE_CHAT;
    } catch (error) {
      warn(`[mochi-modes] 读取 ${PROJECTION_KEY} 投影失败，按对话模式处理：${error instanceof Error ? error.message : String(error)}`);
      return MODE_CHAT;
    }
  }

  // agent/created 的监听器一旦抛错会冒泡进 announce()，破坏 agent 创建，
  // 所以整段兜底 try/catch：模式没上只能是「没收窄」，绝不能拦死会话。
  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    try {
      controller.attach(agent, durableModeOf(agent));
    } catch (error) {
      warn(`[mochi-modes] agent/created 处理失败，保持全量工具：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
    controller.detach(agent);
  });

  ctx.effect(() => () => {
    stopCreated();
    stopDisposed();
  }, 'mochi-modes: agent listeners');

  ctx.logger?.info?.('[mochi-modes] 对话界面/工作界面已挂载：默认对话界面收窄工具面');
}
