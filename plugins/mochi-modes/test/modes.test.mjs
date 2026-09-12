// mochi-modes 服务端测试：模式切换、restrict 收窄/解除、升级确认卡、日志投影。
//
// 不启动真宿主（本机 apps/desktop/node_modules/fs-ext 是 x86_64，arm64 dlopen 失败），
// 用一个实现了 restrict 语义的假 tools 注册面来验证真实行为。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHAT_COMMAND,
  CONVERSATION_TOOLS,
  MODE_CHAT,
  MODE_WORK,
  PROJECTION_KEY,
  REQUEST_TOOL,
  WORK_COMMAND,
  WORK_REQUEST_REASON,
  createModesController,
  createProjectionDefinition,
  foldModeEvent,
  modeProjection,
  modeView,
  planRestriction,
} from '../modes.mjs';
import { apply, inject as pluginInject, name as pluginName } from '../index.mjs';

const WORK_TOOLS = ['write_file', 'mochi_ppt_create', 'bash', 'fs_read', 'run_code'];

function createFakeTools(globalNames) {
  const globals = new Map(globalNames.map((n) => [n, { name: n }]));
  const restrictions = new Map();
  const restrictCalls = [];

  const service = {
    globals,
    restrictCalls,
    register(definition) {
      if (globals.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`);
      globals.set(definition.name, definition);
      return () => globals.delete(definition.name);
    },
    schemas(scope) {
      const visible = new Set(globals.keys());
      const restriction = restrictions.get(scope);
      if (restriction && restriction.allow) {
        for (const key of [...visible]) if (!restriction.allow.has(key)) visible.delete(key);
      }
      return [...visible].map((n) => ({ name: n }));
    },
    // 根 ctx 上的 restrict：官方会直接抛 “requires a scoped context”，
    // 保留这个会抛的实现，用来证明插件只走 agent.ctx.tools.restrict 这条缝。
    restrict() {
      throw new Error('tools.restrict() requires a scoped context (agent.ctx)');
    },
    restrictFor(scope, filter) {
      restrictCalls.push({ scope, filter });
      if (!filter || (filter.allow === undefined && filter.deny === undefined)) {
        throw new Error('tools.restrict({}) is a no-op');
      }
      const names = [...(filter.allow ?? []), ...(filter.deny ?? [])];
      if (names.includes('run_code')) throw new Error('cannot name reserved transport "run_code"');
      const unknown = names.filter((n) => !globals.has(n));
      if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool "${unknown[0]}"`);
      restrictions.set(scope, { allow: filter.allow ? new Set(filter.allow) : null });
      return () => restrictions.delete(scope);
    },
    visibleNames(scope) {
      return service.schemas(scope).map((s) => s.name);
    },
  };
  return service;
}

function makeAgent(fakeTools, session = { id: 'session-a' }) {
  const agent = { session, ctx: null };
  agent.ctx = { tools: { restrict: (filter) => fakeTools.restrictFor(agent, filter) } };
  return agent;
}

function createFakeHost(globalNames) {
  const fakeTools = createFakeTools(globalNames);
  const handlers = new Map();
  const commands = [];
  const projections = [];
  const logs = [];
  const applied = [];

  const scopeCtx = {
    commands: {
      register(definition) {
        commands.push(definition);
        return () => {};
      },
    },
    sessionProjections: {
      register(definition) {
        projections.push(definition);
        return () => {};
      },
    },
  };

  let approvalOutcome = 'allowed-once';
  let approvalAvailable = true;
  const approvalRequests = [];
  const ctx = {
    logger: { info() {}, warn(message) { logs.push(message); }, debug() {} },
    tools: {
      register: (definition) => {
        applied.push(definition);
        return fakeTools.register(definition);
      },
      schemas: (scope) => fakeTools.schemas(scope),
      restrict: () => fakeTools.restrict(),
    },
    on(event, listener) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(listener);
      return () => {
        const list = handlers.get(event);
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      };
    },
    effect(callback) {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    inject(deps, callback) {
      callback(scopeCtx);
    },
    get(serviceName) {
      if (serviceName === 'approval') {
        if (!approvalAvailable) return undefined;
        return {
          request(request) {
            approvalRequests.push(request);
            return Promise.resolve(approvalOutcome);
          },
        };
      }
      if (serviceName === 'sessionProjections') {
        return { stateOf: () => ({ mode: MODE_CHAT, pending: null }) };
      }
      return undefined;
    },
  };

  return {
    ctx,
    fakeTools,
    commands,
    projections,
    logs,
    applied,
    approvalRequests,
    setApprovalOutcome(outcome) { approvalOutcome = outcome; },
    setApprovalAvailable(available) { approvalAvailable = available; },
    emit(event, payload) {
      for (const listener of handlers.get(event) ?? []) listener(payload);
    },
    fireCreated(agent) { this.emit('agent/created', { agent }); },
  };
}

// ── 纯逻辑 ────────────────────────────────────────────────────────────────

test('planRestriction 从真实可见面取交集：只留请求工具、剔除 run_code、面缺失时返回 null', () => {
  const full = [REQUEST_TOOL, ...WORK_TOOLS];
  assert.deepEqual(planRestriction(full), { allow: [REQUEST_TOOL] });
  assert.deepEqual(CONVERSATION_TOOLS, [REQUEST_TOOL]);
  // run_code 是 PTC 保留名，永远不能出现在 allow 里。
  assert.deepEqual(planRestriction([REQUEST_TOOL, 'run_code']), { allow: [REQUEST_TOOL] });
  // 请求工具还没注册上 → 诚实放弃限制，而不是拿空 filter 去撞 restrict 的抛错。
  assert.equal(planRestriction(WORK_TOOLS), null);
  assert.equal(planRestriction([]), null);
  assert.equal(planRestriction(undefined), null);
});

test('session 投影：命令 run→done 与 approval asked→decided 都能折出模式', () => {
  let state = { mode: MODE_CHAT, pending: null };
  state = foldModeEvent(state, { type: 'command/run', data: { name: WORK_COMMAND, commandId: 'c1' } });
  assert.deepEqual(modeView(state), { mode: MODE_CHAT, pending: true });
  state = foldModeEvent(state, { type: 'command/done', data: { commandId: 'c1', kind: 'success' } });
  assert.deepEqual(modeView(state), { mode: MODE_WORK, pending: false });

  state = foldModeEvent(state, { type: 'command/run', data: { name: CHAT_COMMAND, commandId: 'c2' } });
  state = foldModeEvent(state, { type: 'command/done', data: { commandId: 'c2', kind: 'error' } });
  assert.equal(modeView(state).mode, MODE_WORK, '失败的切换不改变模式');

  state = foldModeEvent(state, { type: 'approval/asked', data: { id: 'a1', toolName: REQUEST_TOOL } });
  assert.equal(modeView(state).pending, true);
  state = foldModeEvent(state, { type: 'approval/decided', data: { id: 'a1', outcome: 'rejected' } });
  assert.equal(modeView(state).mode, MODE_WORK, '被拒绝的 approval 不改模式');
  assert.equal(modeView(state).pending, false);

  state = { mode: MODE_CHAT, pending: null };
  state = foldModeEvent(state, { type: 'approval/asked', data: { id: 'a2', toolName: REQUEST_TOOL } });
  state = foldModeEvent(state, { type: 'approval/decided', data: { id: 'a2', outcome: 'allowed-once' } });
  assert.deepEqual(modeView(state), { mode: MODE_WORK, pending: false });

  // 无关事件返回同一引用（投影要求：不变即零下游开销）。
  const same = foldModeEvent(state, { type: 'tool/result', data: {} });
  assert.equal(same, state);
  const other = foldModeEvent(state, { type: 'approval/asked', data: { id: 'x', toolName: 'bash' } });
  assert.equal(other, state, '只有本插件的请求工具才影响模式');
});

test('投影定义的 schema 真的会校验（不是摆设）', () => {
  const definition = createProjectionDefinition();
  assert.equal(definition.key, PROJECTION_KEY);
  assert.equal(definition.stateVersion, 1);
  assert.doesNotThrow(() => definition.stateSchema.parse(definition.init()));
  assert.doesNotThrow(() => definition.wire.viewSchema.parse(definition.wire.view(definition.init())));
  assert.throws(() => definition.stateSchema.parse({ mode: 'nonsense', pending: null }), /结构不合法/);
  assert.throws(() => definition.stateSchema.parse({ mode: MODE_CHAT, pending: { id: '', wanted: MODE_WORK } }), /结构不合法/);
  assert.throws(() => definition.wire.viewSchema.parse({ mode: MODE_CHAT, pending: 'yes' }), /结构不合法/);
});

// ── 控制器 ────────────────────────────────────────────────────────────────

test('控制器：chat 收窄、work 解除、反复切换幂等且不会叠加两次 restrict', () => {
  const fakeTools = createFakeTools([REQUEST_TOOL, ...WORK_TOOLS]);
  const controller = createModesController({ tools: fakeTools, warn: () => {} });
  const agent = makeAgent(fakeTools);

  controller.attach(agent, MODE_CHAT);
  assert.equal(controller.modeOf(agent), MODE_CHAT);
  assert.equal(controller.isRestricted(agent), true);
  assert.deepEqual(fakeTools.visibleNames(agent), [REQUEST_TOOL], 'chat 模式下干活的工具全部不可见');
  assert.equal(fakeTools.restrictCalls.length, 1);

  // 幂等：再切 chat 不应再建第二个限制。
  controller.setMode(agent, MODE_CHAT);
  assert.equal(fakeTools.restrictCalls.length, 1, '重复进入 chat 不重复 restrict');

  controller.setMode(agent, MODE_WORK);
  assert.equal(controller.isRestricted(agent), false);
  const visible = fakeTools.visibleNames(agent);
  for (const tool of WORK_TOOLS) assert.ok(visible.includes(tool), `work 模式下 ${tool} 可见`);
  assert.equal(controller.modeOf(agent), MODE_WORK);

  controller.setMode(agent, MODE_WORK);
  assert.equal(controller.isRestricted(agent), false, '重复进入 work 仍是无限制且不报错');

  controller.setMode(agent, MODE_CHAT);
  assert.equal(controller.isRestricted(agent), true);
  assert.equal(fakeTools.restrictCalls.length, 2, '来回切换各建一次限制');
  assert.deepEqual(fakeTools.visibleNames(agent), [REQUEST_TOOL]);

  controller.detach(agent);
  assert.equal(controller.modeOf(agent), null);
});

test('控制器：restrict 抛错时诚实降级（记日志、不收窄、不假装成功）', () => {
  const logs = [];
  const tools = {
    schemas: () => [{ name: REQUEST_TOOL }, { name: 'bash' }],
    restrict: () => { throw new Error('boom'); },
  };
  const controller = createModesController({ tools, warn: (m) => logs.push(m) });
  const agent = makeAgent(tools);
  assert.equal(controller.attach(agent, MODE_CHAT), MODE_CHAT);
  assert.equal(controller.isRestricted(agent), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /restrict 失败/);
});

test('控制器：找不到请求工具时返回 null 并如实说明未收窄', () => {
  const logs = [];
  const tools = {
    schemas: () => [{ name: 'bash' }],
    restrict: () => { throw new Error('不该被调用'); },
  };
  const controller = createModesController({ tools, warn: (m) => logs.push(m) });
  const agent = makeAgent(tools);
  controller.attach(agent, MODE_CHAT);
  assert.equal(controller.isRestricted(agent), false);
  assert.match(logs[0], new RegExp(REQUEST_TOOL));
  assert.match(logs[0], /未收窄/);
});

test('控制器：对话界面批准后，同一个 agent 上 isRestricted 变 false 且 modeOf 变 work', async () => {
  const fakeTools = createFakeTools([REQUEST_TOOL, ...WORK_TOOLS]);
  const controller = createModesController({ tools: fakeTools, warn: () => {} });
  const agent = makeAgent(fakeTools);
  controller.attach(agent, MODE_CHAT);
  assert.equal(controller.modeOf(agent), MODE_CHAT);
  assert.equal(controller.isRestricted(agent), true);
  assert.deepEqual(fakeTools.visibleNames(agent), [REQUEST_TOOL], '对话界面只剩请求工具');

  // 老师批准 → 走的就是工具里那一步 controller.setMode(agent, MODE_WORK)。
  assert.equal(controller.setMode(agent, MODE_WORK), MODE_WORK);
  assert.equal(controller.isRestricted(agent), false, '同一 agent 的 restrict 被解除');
  assert.equal(controller.modeOf(agent), MODE_WORK);
  for (const name of WORK_TOOLS) assert.ok(fakeTools.visibleNames(agent).includes(name), `解禁后 ${name} 可见`);
  // 同一个 agent 对象，没有换会话。
  assert.equal(controller.modeOf(agent), MODE_WORK);
});

test('session 投影：重放（resume / fork）能把界面恢复成当前模式，断在中途也不丢状态', () => {
  const full = [
    { type: 'command/run', data: { name: WORK_COMMAND, commandId: 'c1' } },
    { type: 'command/done', data: { commandId: 'c1', kind: 'success' } },
    { type: 'approval/asked', data: { id: 'a1', toolName: REQUEST_TOOL } },
    { type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } },
    { type: 'tool/result', data: {} },
    { type: 'command/run', data: { name: CHAT_COMMAND, commandId: 'c2' } },
    { type: 'command/done', data: { commandId: 'c2', kind: 'success' } },
  ];
  let replayed = modeProjection.init();
  for (const event of full) replayed = modeProjection.apply(replayed, event);
  assert.deepEqual(modeView(replayed), { mode: MODE_CHAT, pending: false }, '整段重放回到对话界面');

  // resume 断在“已经进入工作界面”之后：模式必须恢复到 work。
  let partial = modeProjection.init();
  for (const event of full.slice(0, 5)) partial = modeProjection.apply(partial, event);
  assert.deepEqual(modeView(partial), { mode: MODE_WORK, pending: false });

  // fork 断在命令 run 之后、done 之前：模式不变，但挂起“切换未生效”供客户端提示。
  let interrupted = modeProjection.init();
  interrupted = modeProjection.apply(interrupted, { type: 'command/run', data: { name: WORK_COMMAND, commandId: 'c9' } });
  assert.deepEqual(modeView(interrupted), { mode: MODE_CHAT, pending: true });
  assert.doesNotThrow(() => modeProjection.stateSchema.parse(interrupted));
  assert.doesNotThrow(() => modeProjection.viewSchema.parse(modeView(interrupted)));
});

// ── apply()：真实插件装配 ─────────────────────────────────────────────────

test('apply 只注册一个合规工具名、两条命令、一个投影，默认对话模式收窄', () => {
  const host = createFakeHost([...WORK_TOOLS]);
  apply(host.ctx);

  assert.equal(pluginName, 'mochi-modes');
  assert.deepEqual(pluginInject, ['tools']);
  assert.equal(host.applied.length, 1);
  assert.equal(host.applied[0].name, REQUEST_TOOL);
  assert.match(host.applied[0].name, /^[a-zA-Z0-9_-]+$/, '工具名必须能过模型网关');
  assert.deepEqual(host.commands.map((c) => c.name).sort(), [CHAT_COMMAND, WORK_COMMAND].sort());
  assert.deepEqual(host.projections.map((p) => p.key), [PROJECTION_KEY]);

  const agent = makeAgent(host.fakeTools);
  host.fireCreated(agent);
  assert.equal(host.fakeTools.restrictCalls.length, 1);
  assert.deepEqual(host.fakeTools.restrictCalls[0].filter, { allow: [REQUEST_TOOL] });
  assert.deepEqual(host.fakeTools.restrictCalls[0].scope, agent, 'restrict 必须落在 agent 作用域上');
  assert.deepEqual(host.fakeTools.visibleNames(agent), [REQUEST_TOOL]);
});

test('apply：/mochi-work 直接扩工具面，/mochi-chat 收回，均幂等', () => {
  const host = createFakeHost([...WORK_TOOLS]);
  apply(host.ctx);
  const agent = makeAgent(host.fakeTools);
  host.fireCreated(agent);

  const work = host.commands.find((c) => c.name === WORK_COMMAND);
  const chat = host.commands.find((c) => c.name === CHAT_COMMAND);

  assert.equal(work.handler({ agent }).kind, 'success');
  assert.equal(host.fakeTools.visibleNames(agent).length, 1 + WORK_TOOLS.length, 'work 模式全量工具');
  assert.equal(work.handler({ agent }).kind, 'success');
  assert.equal(host.fakeTools.restrictCalls.length, 1, '重复 /mochi-work 不重复切换');

  assert.equal(chat.handler({ agent }).kind, 'success');
  assert.deepEqual(host.fakeTools.visibleNames(agent), [REQUEST_TOOL]);
  assert.equal(host.fakeTools.restrictCalls.length, 2);
  assert.equal(chat.handler({ agent }).kind, 'success');
  assert.equal(host.fakeTools.restrictCalls.length, 2);
});

test('apply：模型调用请求工具 → 原生审批卡 → 批准后解除限制', async () => {
  const host = createFakeHost([...WORK_TOOLS]);
  apply(host.ctx);
  const agent = makeAgent(host.fakeTools);
  host.fireCreated(agent);
  assert.deepEqual(host.fakeTools.visibleNames(agent), [REQUEST_TOOL]);

  const tool = host.applied[0];
  const signal = new AbortController().signal;
  const result = await tool.execute({ task: '把这份教案转成 PDF' }, { agent, callId: 'call-1', signal });

  assert.equal(result.granted, true);
  assert.equal(result.mode, MODE_WORK);
  assert.equal(host.approvalRequests.length, 1);
  assert.equal(host.approvalRequests[0].toolName, REQUEST_TOOL);
  assert.equal(host.approvalRequests[0].agent, agent);
  assert.match(host.approvalRequests[0].reason, new RegExp(WORK_REQUEST_REASON));
  assert.match(host.approvalRequests[0].reason, /转成 PDF/);
  assert.ok(host.fakeTools.visibleNames(agent).includes('write_file'), '批准后干活工具可见');

  // 已在工作模式：不再重复弹卡。
  const again = await tool.execute({}, { agent, callId: 'call-2', signal });
  assert.equal(again.granted, true);
  assert.equal(host.approvalRequests.length, 1);
});

test('apply：对话界面里「帮我转成 PDF」→ 原生卡批准 → 同一会话工具面全开', async () => {
  const host = createFakeHost([...WORK_TOOLS]);
  apply(host.ctx);
  const agent = makeAgent(host.fakeTools);
  host.fireCreated(agent);
  assert.deepEqual(host.fakeTools.visibleNames(agent), [REQUEST_TOOL], '对话界面只有请求工具');

  const result = await host.applied[0].execute(
    { task: '把这份教案转成 PDF' },
    { agent, callId: 'call-1', signal: new AbortController().signal },
  );

  // 确认卡走官方原生审批通道，reason 保持「需要工作模式，继续？」并带上具体任务。
  assert.equal(host.approvalRequests.length, 1);
  assert.match(host.approvalRequests[0].reason, /^需要工作模式，继续？/);
  assert.match(host.approvalRequests[0].reason, /把这份教案转成 PDF/);
  // 返回文本必须让模型看见：已进入工作界面、工具全开、现在开始做 X。
  assert.match(result.message, /已进入工作界面/);
  assert.match(result.message, /全部工具已打开/);
  assert.match(result.message, /把这份教案转成 PDF/);
  // 同一个会话（同一个 agent），干活工具立刻可见，无需换会话。
  const visible = host.fakeTools.visibleNames(agent);
  assert.ok(visible.includes('write_file'));
  assert.ok(visible.includes('mochi_ppt_create'));
  assert.equal(agent.session.id, 'session-a');
});

test('apply：老师拒绝审批 → 抛错、保持对话界面工具面，并明确叫模型别再请求', async () => {
  const host = createFakeHost([...WORK_TOOLS]);
  apply(host.ctx);
  const agent = makeAgent(host.fakeTools);
  host.fireCreated(agent);
  host.setApprovalOutcome('rejected');

  const tool = host.applied[0];
  await assert.rejects(
    () => tool.execute({}, { agent, callId: 'call-1', signal: new AbortController().signal }),
    (error) => {
      assert.match(error.message, /没有批准进入工作界面/);
      assert.match(error.message, /不要/, '必须明确告诉模型不要再偷偷请求一次');
      return true;
    },
  );
  assert.deepEqual(host.fakeTools.visibleNames(agent), [REQUEST_TOOL], '被拒绝后仍然是对话界面');
  assert.equal(host.approvalRequests.length, 1, '拒绝后不会自动再弹一次卡');
});

test('apply：没有审批通道时——不收窄工具面（防呆），且工具诚实报错绝不自动升级', async () => {
  const host = createFakeHost([...WORK_TOOLS]);
  host.setApprovalAvailable(false);
  apply(host.ctx);
  const agent = makeAgent(host.fakeTools);
  host.fireCreated(agent);

  // 防呆：对话模式下唯一可调的工具是要靠审批卡才能解禁的那个。没有审批通道
  // 却收窄，会话会被永久锁死在「只有一个工具」——所以这里必须保持全量。
  assert.equal(host.fakeTools.restrictCalls.length, 0, '没有审批通道时 restrict 根本不该被调用');
  const visible = new Set(host.fakeTools.visibleNames(agent));
  for (const name of [...WORK_TOOLS, REQUEST_TOOL]) {
    assert.ok(visible.has(name), `${name} 必须保持可见，否则老师被锁死在对话界面出不来`);
  }
  assert.match(host.logs.join('\n'), /没有可用的确认通道/);

  // 但升级入口本身仍然诚实报错，绝不自作主张切到工作界面。
  await assert.rejects(
    () => host.applied[0].execute({}, { agent, callId: 'c', signal: new AbortController().signal }),
    /没有可用的确认通道/,
  );
});

test('apply：agent/created 处理器内部抛错不会冒泡（不能拦死会话）', () => {
  const host = createFakeHost([...WORK_TOOLS]);
  apply(host.ctx);
  // (a) restrict 自身抛错：降级为「未收窄」，记日志，不冒泡。
  const first = makeAgent(host.fakeTools);
  first.ctx.tools.restrict = () => { throw new Error('registry exploded'); };
  assert.doesNotThrow(() => host.fireCreated(first));
  assert.ok(host.logs.some((line) => /restrict 失败/.test(line)), host.logs.join(' | '));
  // (b) 更外层完全意外的抛错：仍然不冒泡。
  const second = {};
  Object.defineProperty(second, 'ctx', { get() { throw new Error('unexpected'); } });
  assert.doesNotThrow(() => host.fireCreated(second));
  assert.ok(host.logs.some((line) => /agent\/created 处理失败/.test(line)), host.logs.join(' | '));
});

test('apply：重复 created 幂等；disposed 后重新 created 仍是收窄态', () => {
  const host = createFakeHost([...WORK_TOOLS]);
  apply(host.ctx);
  const agent = makeAgent(host.fakeTools);

  host.fireCreated(agent);
  assert.equal(host.fakeTools.restrictCalls.length, 1);
  host.fireCreated(agent);
  assert.equal(host.fakeTools.restrictCalls.length, 1, '同一 agent 重复 created 不叠加限制');
  assert.deepEqual(host.fakeTools.visibleNames(agent), [REQUEST_TOOL]);

  host.emit('agent/disposed', { agent });
  host.fireCreated(agent);
  assert.equal(host.fakeTools.restrictCalls.length, 2, '重新挂载会重新施加一次限制');
  assert.deepEqual(host.fakeTools.visibleNames(agent), [REQUEST_TOOL]);
});
