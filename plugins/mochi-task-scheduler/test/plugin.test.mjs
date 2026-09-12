// 插件与工具层单测：工具名合规（网关会 400 拒收整轮对话）、注册数量、
// render 签名、创建/列出/取消端到端，以及 remind 到点真的调用会话 followup。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, createDeliverer, inject, isLiveAgent, name, output } from '../index.mjs';
import { createScheduleHandlers } from '../tools.mjs';

const REQUIRED_TOOL_NAMES = ['mochi_schedule_create', 'mochi_schedule_list', 'mochi_schedule_cancel'];
const SAFE_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

function makeCtx() {
  const tools = [];
  const disposers = [];
  const listeners = new Map();
  return {
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    logger: { info() {}, warn() {}, error() {} },
    // 桩里没有 agents 服务：findAgentForSession 会退回 sessionAgents 索引。
    get: () => undefined,
    effect: (callback) => {
      const disposer = callback();
      if (typeof disposer === 'function') disposers.push(disposer);
    },
    on: (event, listener) => { listeners.set(event, listener); return () => {}; },
    registered: tools,
    emit: (event, payload) => listeners.get(event)?.(payload),
    dispose: () => { for (const disposer of disposers) disposer(); },
  };
}

function withTempHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'mochi-task-scheduler-home-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

function toolNamed(ctx, toolName) {
  const tool = ctx.registered.find((entry) => entry.name === toolName);
  assert.ok(tool, `应注册工具 ${toolName}`);
  return tool;
}

test('插件注册的工具名合法、恰好三个、参数契约抗口语', (t) => {
  withTempHome(t);
  const ctx = makeCtx();
  apply(ctx);
  t.after(() => ctx.dispose());

  assert.equal(name, 'mochi-task-scheduler');
  assert.deepEqual(inject, ['tools']);
  assert.equal(ctx.registered.length, 3, '只应注册三个工具');

  for (const toolName of REQUIRED_TOOL_NAMES) {
    assert.ok(SAFE_TOOL_NAME.test(toolName), `${toolName} 必须匹配 ^[a-zA-Z0-9_-]+$（否则网关会拒收整轮对话）`);
    assert.ok(ctx.registered.some((tool) => tool.name === toolName));
  }

  const create = toolNamed(ctx, 'mochi_schedule_create');
  // defineTool 会把 parameters 规范化成 JSON Schema（校验发生在进入 execute 之前），
  // 所以枚举/必填读的是 properties 与 required。
  const properties = create.parameters.properties;
  assert.deepEqual(properties.frequency.enum, ['once', 'daily', 'weekly', 'weekdays']);
  assert.deepEqual(properties.kind.enum, ['remind', 'notify']);
  assert.deepEqual(properties.weekday.enum, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(create.parameters.required, ['title', 'kind', 'frequency', 'time']);
  assert.match(properties.time.description, /HH:MM/);
  assert.match(properties.frequency.description, /Asia|weekly/);
  assert.match(create.description, /HH:MM/);
  assert.match(create.description, /Asia\/Shanghai/);
  assert.match(create.description, /关机/);
  assert.match(create.description, /暂不支持/);
  assert.deepEqual(toolNamed(ctx, 'mochi_schedule_cancel').parameters.required, ['id']);
  assert.deepEqual(toolNamed(ctx, 'mochi_schedule_cancel').parameters.properties.id.type, 'integer');
});

test('render 签名回归：第二参数才是工具返回值（大坑 17）', () => {
  const rendered = output.render({ some: 'args' }, { real: 'result' });
  assert.ok(rendered[0].text.includes('result'));
  assert.ok(!rendered[0].text.includes('some'));
});

test('端到端：创建会写库并挂定时器，列出能看到，取消后不再出现', async (t) => {
  const home = withTempHome(t);
  const ctx = makeCtx();
  apply(ctx);
  t.after(() => ctx.dispose());

  const create = toolNamed(ctx, 'mochi_schedule_create');
  const list = toolNamed(ctx, 'mochi_schedule_list');
  const cancel = toolNamed(ctx, 'mochi_schedule_cancel');

  // 无会话的运行时：如实说明提醒无法进对话，但不影响写库/挂定时器。
  const created = await create.execute({ title: '每天早自习前把课件打开', kind: 'notify', frequency: 'daily', time: '07:50' }, {});
  assert.equal(created.ok, true);
  assert.equal(created.已写库, true);
  assert.equal(created.已注册定时器, true);
  assert.equal(created.time_zone, 'Asia/Shanghai');
  assert.equal(created.类型说明, '到点通知（本机记录）');
  assert.ok(created.id > 0);
  assert.match(created.下次触发, /（Asia\/Shanghai）/);
  assert.match(created.提醒, /应用退出后不会执行|只在 Mochi 应用运行期间有效/);
  assert.equal(created.数据库.startsWith(home), true, '必须写到 DSH_HOME 下的任务库');

  const listed = await list.execute({}, {});
  assert.equal(listed.数量, 1);
  assert.equal(listed.任务[0].id, created.id);
  assert.equal(listed.任务[0].状态, '待触发');
  assert.equal(listed.任务[0].重复, '每天 07:50（Asia/Shanghai）');
  assert.match(listed.说明, /只在 Mochi 应用运行期间有效/);

  const cancelled = await cancel.execute({ id: created.id }, {});
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.已取消, true);

  const afterCancel = await list.execute({}, {});
  assert.equal(afterCancel.数量, 0);
  const withCancelled = await list.execute({ includeCancelled: true }, {});
  assert.equal(withCancelled.数量, 1);
  assert.equal(withCancelled.任务[0].状态, '已取消');
});

test('remind 在没有会话时如实标注未绑定会话', async (t) => {
  withTempHome(t);
  const ctx = makeCtx();
  apply(ctx);
  t.after(() => ctx.dispose());

  const created = await toolNamed(ctx, 'mochi_schedule_create').execute(
    { title: '明早 7:50 提醒我带教案', kind: 'remind', frequency: 'once', date: '2099-01-05', time: '07:50' },
    {},
  );
  assert.equal(created.会话绑定, false);
  assert.match(created.送达通道, /没有拿到可送达的会话/);
});

test('非法输入被明确拒绝，不会静默建出任务', async (t) => {
  withTempHome(t);
  const ctx = makeCtx();
  apply(ctx);
  t.after(() => ctx.dispose());

  const create = toolNamed(ctx, 'mochi_schedule_create');
  const list = toolNamed(ctx, 'mochi_schedule_list');

  await assert.rejects(
    () => create.execute({ title: 'x', kind: 'notify', frequency: 'daily', time: '7:5' }, {}),
    (error) => error.code === 'MOCHI_SCHEDULE_BAD_TIME',
  );
  await assert.rejects(
    () => create.execute({ title: 'x', kind: 'notify', frequency: 'daily', time: '25:00' }, {}),
    (error) => error.code === 'MOCHI_SCHEDULE_BAD_TIME',
  );
  // kind/frequency 的枚举由 defineTool 生成的 JSON Schema 在进入 execute 前就拦下
  // （比工具内自查更早），所以这里是网关侧的统一 INVALID_ARGS，不是自定义错误码。
  // 工具内的 parseKind/parseFrequency 兜底另见 schedule-time.test.mjs。
  await assert.rejects(
    () => create.execute({ title: 'x', kind: 'open-app', frequency: 'daily', time: '07:50' }, {}),
    (error) => error.code === 'INVALID_ARGS',
  );
  await assert.rejects(
    () => create.execute({ title: 'x', kind: 'notify', frequency: 'monthly', time: '07:50' }, {}),
    (error) => error.code === 'INVALID_ARGS',
  );
  await assert.rejects(
    () => create.execute({ title: 'x', kind: 'notify', frequency: 'daily', time: '07:50', weekday: 9 }, {}),
    (error) => error.code === 'INVALID_ARGS',
  );
  await assert.rejects(
    () => create.execute({ title: 'x', kind: 'notify', frequency: 'weekly', time: '07:50' }, {}),
    (error) => error.code === 'MOCHI_SCHEDULE_WEEKDAY_REQUIRED',
  );
  await assert.rejects(
    () => create.execute({ title: 'x', kind: 'notify', frequency: 'once', time: '07:50', date: '2020-01-01' }, {}),
    (error) => error.code === 'MOCHI_SCHEDULE_PAST_TIME',
  );
  await assert.rejects(
    () => create.execute({ title: '   ', kind: 'notify', frequency: 'daily', time: '07:50' }, {}),
    (error) => error.code === 'MOCHI_SCHEDULE_TITLE_REQUIRED',
  );
  await assert.rejects(
    () => create.execute({ title: 'x', kind: 'notify', frequency: 'daily', time: '07:50', weekday: 5 }, {}),
    (error) => error.code === 'MOCHI_SCHEDULE_UNEXPECTED_WEEKDAY',
  );

  const listed = await list.execute({}, {});
  assert.equal(listed.数量, 0, '被拒绝的请求不能留下任务');

  const cancel = toolNamed(ctx, 'mochi_schedule_cancel');
  await assert.rejects(
    () => cancel.execute({ id: 12345 }, {}),
    (error) => error.code === 'MOCHI_SCHEDULE_NOT_FOUND',
  );
  // 非整数 id 同样在 Schema 层被拦下。
  await assert.rejects(
    () => cancel.execute({ id: 'abc' }, {}),
    (error) => error.code === 'INVALID_ARGS',
  );

  // 工具内的 BAD_ID 兜底（Schema 被绕过时的第二道闸）。
  const bare = createScheduleHandlers({ store: { cancelSchedule: () => ({ found: true }) } });
  assert.throws(() => bare.cancel({ id: 'abc' }), (error) => error.code === 'MOCHI_SCHEDULE_BAD_ID');
  assert.throws(() => bare.cancel({}), (error) => error.code === 'MOCHI_SCHEDULE_BAD_ID');
});

test('remind 到点真的把提醒排进原会话（stub agent + 真实 createUserMessage）', async (t) => {
  withTempHome(t);
  const ctx = makeCtx();
  apply(ctx);
  t.after(() => ctx.dispose());

  const received = [];
  const agent = { id: 'session-1', session: { id: 'session-1' }, followup: (message) => { received.push(message); } };
  assert.equal(isLiveAgent(ctx, agent), true);

  const sessionAgents = new Map([['session-1', agent]]);
  const store = {
    notifications: [],
    addNotification(entry) { this.notifications.push(entry); },
  };
  const deliver = createDeliverer({ ctx, store, sessionAgents });

  const row = {
    id: 7,
    title: '把今天要讲的课件打开',
    note: '第三章 第二节',
    kind: 'remind',
    frequency: 'daily',
    time_of_day: '07:50',
    weekday: null,
    local_date: null,
    time_zone: 'Asia/Shanghai',
    session_id: 'session-1',
  };
  const outcome = await deliver(row, { firedAt: Date.UTC(2026, 8, 11, 23, 50, 0) });
  assert.equal(outcome.outcome, 'delivered');
  assert.equal(outcome.channel, 'session-followup');
  assert.match(outcome.detail, /排队成功/);
  assert.equal(received.length, 1, 'followup 应被调用一次');

  const text = received[0].content.map((block) => block.text).join('\n');
  assert.match(text, /把今天要讲的课件打开/);
  assert.match(text, /第三章 第二节/);
  assert.match(text, /2026-09-12 07:50（Asia\/Shanghai）/);
  assert.match(text, /不是新的指令/, '提醒要标成转达内容，不能被当成新指令执行');

  // 会话不在了：如实报 pending，而不是假装送达。
  const pending = await deliver({ ...row, session_id: 'session-gone' }, { firedAt: Date.now() });
  assert.equal(pending.outcome, 'pending');
  assert.match(pending.detail, /保持逾期/);

  // notify：真实写一条本机通知记录。
  const notified = await deliver({ ...row, kind: 'notify', session_id: null }, { firedAt: Date.now() });
  assert.equal(notified.outcome, 'delivered');
  assert.equal(notified.channel, 'local-notification');
  assert.equal(store.notifications.length, 1);
  assert.equal(store.notifications[0].title, '把今天要讲的课件打开');
});
