// mochi-dispatch 单测：状态机 / 存储 / 工具（桩连接 + 桩审批）
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { apply, output } from './index.mjs';
import { openStore, createStore } from './store.mjs';
import { CampusRequestError } from '../mochi-campus/connection.mjs';
import {
  canTransition, assertTransition, relayStatusToTask, deriveCardState,
  expiryFor, isExpired, idempotencyKeyFor, TERMINAL_STATES,
} from './state-machine.mjs';

console.log('① 状态机：合法迁移 / 非法迁移 / 终态不可逆');
assert.equal(canTransition('CREATED', 'DISPATCHING'), true);
assert.equal(canTransition('DISPATCHING', 'DELIVERED'), true);
assert.equal(canTransition('DELIVERED', 'COMPLETED'), true);
assert.equal(canTransition('DELIVERED', 'DECLINED'), true);
assert.equal(canTransition('CREATED', 'COMPLETED'), false);
assert.equal(canTransition('DISPATCHING', 'COMPLETED'), false);
assert.throws(() => assertTransition('CREATED', 'COMPLETED'), /非法迁移/);
for (const t of TERMINAL_STATES) assert.throws(() => assertTransition(t, 'CREATED'), /终态/);
assert.throws(() => assertTransition('NOPE', 'CREATED'), /未知任务状态/);

console.log('② 状态机：Relay 映射 / 六态卡 / 过期 / 幂等键');
assert.equal(relayStatusToTask('pending'), 'DELIVERED');
assert.equal(relayStatusToTask('accepted'), 'COMPLETED');
assert.equal(relayStatusToTask('declined'), 'DECLINED');
assert.equal(deriveCardState('CREATED'), 'PENDING_SEND');
assert.equal(deriveCardState('DISPATCHING'), 'PENDING_SEND');
assert.equal(deriveCardState('DELIVERED'), 'RUNNING');
assert.equal(deriveCardState('COMPLETED'), 'COMPLETED');
assert.equal(deriveCardState('DECLINED'), 'TERMINATED');
assert.equal(deriveCardState('EXPIRED'), 'TERMINATED');
assert.equal(expiryFor('ASK').length > 0, true);
assert.ok(new Date(expiryFor('FIND')) > new Date(expiryFor('ASK'))); // FIND 72h > ASK 24h
const task = { status: 'DELIVERED', expired_at: new Date(Date.now() - 1000).toISOString() };
assert.equal(isExpired(task), true);
assert.equal(isExpired({ status: 'COMPLETED', expired_at: new Date(Date.now() - 9e9).toISOString() }), false);
const k1 = idempotencyKeyFor({ tool: 'ASK', userId: 6, peerName: '张老师', goal: '换课' });
assert.equal(k1, idempotencyKeyFor({ tool: 'ASK', userId: 6, peerName: '张老师', goal: '换课' }));
assert.equal(k1, idempotencyKeyFor({ tool: 'ASK', userId: 6, peerName: '张老师', goal: '换课' }, new Date(Date.now() + 2 * 3600e3)));
assert.notEqual(k1, idempotencyKeyFor({ tool: 'ASK', userId: 6, peerName: '张老师', goal: '换课', context: '另一个背景' }));

console.log('③ render 签名回归：第二参数才是工具返回值（大坑 17）');
const rendered = output.render({ some: 'args' }, { real: 'result' });
assert.ok(rendered[0].text.includes('result'));
assert.ok(!rendered[0].text.includes('some'));

// ── 桩连接：有状态的 relay 模拟 ──
function makeConn() {
  let nextId = 100;
  const rows = [];
  const calls = [];
  return {
    rows, calls,
    binding: async (exec) => ({ token: 't', user: { id: 6, name: '演示测试员', role: 'HEAD_TEACHER' }, session: exec.agent.session }),
    request: async (path, exec, opts = {}) => {
      calls.push([path, opts.body]);
      if (path === '/api/assistant/relay') {
        return { source: 'stub', result: { outgoing: rows.filter((r) => r.direction === 'outgoing'), incoming: rows.filter((r) => r.direction === 'incoming') } };
      }
      if (path === '/api/assistant/relay/send') {
        const b = opts.body; const id = ++nextId;
        rows.push({ id, direction: 'outgoing', peerName: b.peerName, kind: b.kind || 'message', body: `演示测试员的 Mochi 替主人带话：${b.note || b.item || ''}`, item: b.item, status: 'pending', reply: '', createdAt: '2026-09-05 16:00:00' });
        return { source: 'stub', result: { ok: true, relayMessageId: id, peer: { id: 2, name: b.peerName, role: '教师' }, relay: { outgoing: rows.slice(), incoming: [] } } };
      }
      if (path === '/api/assistant/relay/find') return { source: 'stub', result: { item: opts.body.item, hits: [] } };
      if (path === '/api/assistant/relay/respond') {
        const m = rows.find((r) => r.id === opts.body.id);
        if (m) { m.status = opts.body.action === 'accept' ? 'accepted' : 'declined'; m.reply = opts.body.note || ''; }
        return { source: 'stub', result: { ok: true, status: m?.status ?? 'accepted' } };
      }
      throw new Error(`stub: unknown path ${path}`);
    },
  };
}

function makeHarness({ decision = 'allowed-once' } = {}) {
  const tools = new Map();
  const conn = makeConn();
  const store = createStore(openStore(':memory:'));
  let approvalCount = 0;
  const approval = { request: async () => {
    approvalCount += 1;
    return typeof decision === 'function' ? decision() : decision;
  } };
  apply({
    tools: { register: (t) => tools.set(t.name, t) },
    get: (key) => (key === 'approval' ? approval : undefined),
    logger: console,
  }, conn, store);
  const exec = { agent: { session: {} }, callId: 'c1' };
  return { tools, conn, exec, store, approvalRequests: () => approvalCount };
}

console.log('④ mochi.ask：审批→建任务→relay 投递→DELIVERED+关联');
{
  const { tools, conn, exec, store } = makeHarness();
  const res = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '周五第三节能不能换课' }, exec);
  assert.equal(res.status, 'DELIVERED');
  assert.equal(res.taskId > 0, true);
  assert.equal(res.relayMessageId, 101);
  assert.deepEqual(conn.calls[0][0], '/api/assistant/relay/send');
  assert.equal(conn.calls[0][1].kind, 'message');
  assert.ok(conn.calls[0][1].note.startsWith('【问询】'));
  const row = store.getTask(res.taskId);
  assert.equal(row.status, 'DELIVERED');
  assert.equal(row.relay_message_id, 101);
  assert.equal(row.task_type, 'ASK');
}

console.log('⑤ mochi.ask：同参数重放→拦截（不重复投递）');
{
  const { tools, conn, exec } = makeHarness();
  const a = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '换课' }, exec);
  const b = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '换课' }, exec);
  assert.equal(b.重复投递已拦截, true);
  assert.equal(b.taskId, a.taskId);
  assert.equal(conn.calls.filter(([p]) => p === '/api/assistant/relay/send').length, 1);
}

console.log('⑥ 审批拒绝→【未派发】如实报错');
{
  const { tools, exec } = makeHarness({ decision: 'rejected' });
  await assert.rejects(() => tools.get('mochi.ask').execute({ peerName: '张老师', goal: '换课' }, exec), /未派发/);
}

console.log('⑦ mochi.find：登记命中→不建任务；未命中→委托+request 投递');
{
  const { tools, conn, exec } = makeHarness();
  conn.request = async (path, exec, opts = {}) => path === '/api/assistant/relay/find'
    ? { source: 'stub', result: { item: opts.body.item, hits: [{ holder: '周宁老师' }] } }
    : makeConn().request(path, exec, opts);
  const hit = await tools.get('mochi.find').execute({ item: '急救包' }, exec);
  assert.equal(hit.登记命中, true);
  const { tools: t2, conn: c2, exec: e2 } = makeHarness();
  const miss = await t2.get('mochi.find').execute({ item: '期中数学卷子', peerName: '周医生' }, e2);
  assert.equal(miss.status, 'DELIVERED');
  assert.equal(miss.taskId > 0, true);
  const sendCall = c2.calls.find(([p, b]) => p === '/api/assistant/relay/send' && b.kind === 'request');
  assert.ok(sendCall, 'request 类投递存在');
  assert.equal(sendCall[1].item, '期中数学卷子');
}

console.log('⑦a relay 关联：只接受本次确定 ID，不从返回列表最大 ID 猜测');
{
  const { tools, conn, exec, store } = makeHarness();
  const request = conn.request;
  conn.request = async (path, callExec, opts = {}) => {
    if (path !== '/api/assistant/relay/send') return request(path, callExec, opts);
    const relayMessageId = opts.body.kind === 'request' ? 302 : 301;
    return {
      source: 'stub',
      result: {
        ok: true,
        relayMessageId,
        peer: { id: 2, name: opts.body.peerName, role: '教师' },
        // 模拟列表在本次写入后混入了更大的无关 ID；不能用它关联本地任务。
        relay: { outgoing: [{ id: 999, direction: 'outgoing' }], incoming: [] },
      },
    };
  };
  const requestTask = await tools.get('mochi.request').execute({ peerName: '张老师', goal: '请留意设备' }, exec);
  assert.equal(requestTask.relayMessageId, 301);
  assert.equal(store.getTask(requestTask.taskId).relay_message_id, 301);
  const findTask = await tools.get('mochi.find').execute({ item: '借书卡', peerName: '周医生' }, exec);
  assert.equal(findTask.relayMessageId, 302);
  assert.equal(store.getTask(findTask.taskId).relay_message_id, 302);
}

console.log('⑦b relay 关联：缺失或无效 ID 保持结果不明，不自动重发');
{
  const { tools, conn, exec, store } = makeHarness();
  const request = conn.request;
  let sends = 0;
  conn.request = async (path, callExec, opts = {}) => {
    if (path !== '/api/assistant/relay/send') return request(path, callExec, opts);
    sends += 1;
    return {
      source: 'stub',
      result: {
        ok: true,
        peer: { id: 2, name: opts.body.peerName, role: '教师' },
        relay: { outgoing: [{ id: 999, direction: 'outgoing' }], incoming: [] },
      },
    };
  };
  await assert.rejects(() => tools.get('mochi.ask').execute({ peerName: '张老师', goal: '关联缺失' }, exec), /结果不明/);
  const pending = store.getTask(1);
  assert.equal(pending.status, 'DISPATCHING');
  assert.equal(pending.relay_message_id, null);
  assert.equal(pending.delivery_outcome, 'UNKNOWN');
  const duplicate = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '关联缺失' }, exec);
  assert.equal(duplicate.重复投递已拦截, true);
  assert.equal(sends, 1);
  await assert.rejects(() => tools.get('mochi.ask').execute({ peerName: '张老师', goal: '关联缺失', retryTaskId: pending.id }, exec), /没有可确认的未投递失败/);
  const forcedNew = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '关联缺失', newTask: true }, exec);
  assert.equal(forcedNew.重复投递已拦截, true);
  assert.equal(sends, 1, 'UNKNOWN 不能借 newTask 重新投递');

  const { tools: invalidTools, conn: invalidConn, exec: invalidExec, store: invalidStore } = makeHarness();
  const invalidRequest = invalidConn.request;
  invalidConn.request = async (path, callExec, opts = {}) => path === '/api/assistant/relay/send'
    ? { source: 'stub', result: { ok: true, relayMessageId: '303', peer: { id: 2, name: opts.body.peerName, role: '教师' }, relay: { outgoing: [{ id: 999 }], incoming: [] } } }
    : invalidRequest(path, callExec, opts);
  await assert.rejects(() => invalidTools.get('mochi.ask').execute({ peerName: '李老师', goal: '关联无效' }, invalidExec), /结果不明/);
  assert.equal(invalidStore.getTask(1).status, 'DISPATCHING');
}

console.log('⑦c relay 重试：只接受结构化、路径与状态均匹配的未投递失败；新任务独立关联');
{
  const { tools, conn, exec, store, approvalRequests } = makeHarness();
  const request = conn.request;
  let sends = 0;
  conn.request = async (path, callExec, opts = {}) => {
    if (path !== '/api/assistant/relay/send') return request(path, callExec, opts);
    sends += 1;
    if (sends === 1) {
      throw new CampusRequestError('同事名册里没有对上「张老师」。', {
        path: '/api/assistant/relay/send', status: 404, code: 'ASSISTANT_RELAY_PEER_NOT_FOUND',
      });
    }
    return { source: 'stub', result: { ok: true, relayMessageId: 601 + sends, peer: { id: 2, name: opts.body.peerName, role: '教师' } } };
  };
  const args = { peerName: '张老师', goal: '请确认图书室值班' };
  await assert.rejects(() => tools.get('mochi.ask').execute(args, exec), /未投递/);
  const failed = store.getTask(1);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.delivery_outcome, 'NOT_SENT');
  assert.equal(failed.failure_code, 'ASSISTANT_RELAY_PEER_NOT_FOUND');
  assert.equal(approvalRequests(), 1);
  assert.throws(() => store.preflightRetry({
    ownerUserId: 7, taskId: failed.id, taskType: 'ASK', requestFingerprint: failed.request_fingerprint,
  }), /不属于当前校园账号/);
  assert.throws(() => store.preflightRetry({
    ownerUserId: 6, taskId: failed.id, taskType: 'ASK', requestFingerprint: 'dispatch:v1:other-payload',
  }), /内容不一致/);

  const ordinaryReplay = await tools.get('mochi.ask').execute(args, exec);
  assert.equal(ordinaryReplay.需明确重试, true);
  assert.equal(ordinaryReplay.retryTaskId, failed.id);
  assert.equal(sends, 1, '普通重放不能发送 FAILED 行');

  const otherSession = { agent: { session: {} }, callId: 'retry-race-other-session' };
  const [firstRetry, secondRetry] = await Promise.all([
    tools.get('mochi.ask').execute({ ...args, retryTaskId: failed.id }, exec),
    tools.get('mochi.ask').execute({ ...args, retryTaskId: failed.id }, otherSession),
  ]);
  const attempts = store.listAll();
  const retry = attempts.find((task) => task.retry_of_task_id === failed.id);
  assert.equal(sends, 2, '并行明确重试只产生一次实际 relay 投递');
  assert.equal(attempts.length, 2, '并行明确重试只创建一个新 attempt');
  assert.equal(retry.status, 'DELIVERED');
  assert.equal(retry.attempt_no, 2);
  assert.equal(retry.correlation_id, failed.correlation_id);
  assert.equal(store.getTask(failed.id).status, 'FAILED', 'FAILED 终态不可回退');
  assert.ok([firstRetry, secondRetry].some((value) => value.status === 'DELIVERED'));
  assert.ok([firstRetry, secondRetry].some((value) => value.重复投递已拦截 === true));
  assert.equal(approvalRequests(), 3, '两个独立会话都须显式确认，但数据库只允许一个实际 retry attempt');
  assert.throws(() => store.transition(failed.id, 'DISPATCHING'), /终态/);

  store.transition(retry.id, 'COMPLETED', { resultAnswer: '远端已答复' });
  const independentIds = [];
  for (let index = 0; index < 3; index += 1) {
    const newTask = await tools.get('mochi.ask').execute({ ...args, newTask: true }, exec);
    const independent = store.getTask(newTask.taskId);
    assert.equal(newTask.status, 'DELIVERED');
    assert.equal(independent.attempt_no, 1);
    assert.notEqual(independent.correlation_id, failed.correlation_id, 'newTask 另起逻辑任务');
    independentIds.push(independent.id);
    if (index < 2) store.transition(independent.id, 'COMPLETED', { resultAnswer: `第 ${index + 1} 件已完成` });
  }
  assert.equal(new Set(independentIds).size, 3, '同会话连续 newTask 不能复用已完成 promise 的旧结果');
  assert.equal(sends, 5);
  assert.equal(approvalRequests(), 6, '三件显式 newTask 都必须重新确认');
}

console.log('⑦d relay 重试：错误文案、路径或状态任一不匹配仍是 UNKNOWN');
{
  const unsafeFailures = [
    new Error('ASSISTANT_RELAY_PEER_NOT_FOUND'),
    new CampusRequestError('ASSISTANT_RELAY_PEER_NOT_FOUND', {
      path: '/api/assistant/relay/find', status: 404, code: 'ASSISTANT_RELAY_PEER_NOT_FOUND',
    }),
    new CampusRequestError('ASSISTANT_RELAY_PEER_NOT_FOUND', {
      path: '/api/assistant/relay/send', status: 400, code: 'ASSISTANT_RELAY_PEER_NOT_FOUND',
    }),
  ];
  for (const [index, unsafeFailure] of unsafeFailures.entries()) {
    const { tools, conn, exec, store } = makeHarness();
    const request = conn.request;
    conn.request = async (path, callExec, opts = {}) => {
      if (path !== '/api/assistant/relay/send') return request(path, callExec, opts);
      throw unsafeFailure;
    };
    await assert.rejects(() => tools.get('mochi.ask').execute({ peerName: '张老师', goal: `不安全失败 ${index}` }, exec), /结果不明/);
    const unresolved = store.getTask(1);
    assert.equal(unresolved.status, 'DISPATCHING');
    assert.equal(unresolved.delivery_outcome, 'UNKNOWN');
  }
}

console.log('⑦e relay 写入前：DISPATCHING 已持久化为 UNKNOWN，崩溃窗口不留下 PENDING');
{
  const { tools, conn, exec, store } = makeHarness();
  const request = conn.request;
  let beforeSend = null;
  conn.request = async (path, callExec, opts = {}) => {
    if (path === '/api/assistant/relay/send') beforeSend = store.listAll()[0];
    return request(path, callExec, opts);
  };
  const result = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '确认写入前状态' }, exec);
  assert.equal(result.status, 'DELIVERED');
  assert.equal(beforeSend.status, 'DISPATCHING');
  assert.equal(beforeSend.delivery_outcome, 'UNKNOWN');
}

console.log('⑦f relay 中断恢复：UNKNOWN 过期后仍不能借 newTask 二次发送');
{
  const tempRoot = mkdtempSync(join(tmpdir(), 'mochi-dispatch-interrupted-'));
  const dbPath = join(tempRoot, 'tasks.sqlite');
  const fingerprint = idempotencyKeyFor({ tool: 'ASK', userId: 6, peerName: '张老师', goal: '中断后的同一任务', context: '' });
  const firstStore = createStore(openStore(dbPath));
  const interrupted = firstStore.createDispatchAttempt({
    ownerUserId: 6, taskType: 'ASK', fromUserId: 6, fromUserName: '演示测试员', toPeerName: '张老师',
    goal: '中断后的同一任务', context: '', requestFingerprint: fingerprint, expiredAt: '2000-01-01T00:00:00.000Z',
  }).task;
  firstStore.transition(interrupted.id, 'DISPATCHING');
  assert.equal(firstStore.getTask(interrupted.id).delivery_outcome, 'UNKNOWN', '准备实际发送时默认保守标记为 UNKNOWN');
  firstStore.db.close();

  const reopened = createStore(openStore(dbPath));
  assert.deepEqual(reopened.expireScan(), [interrupted.id]);
  const tools = new Map();
  const conn = makeConn();
  let approvalCount = 0;
  apply({
    tools: { register: (tool) => tools.set(tool.name, tool) },
    get: (key) => key === 'approval' ? { request: async () => { approvalCount += 1; return 'allowed-once'; } } : undefined,
    logger: console,
  }, conn, reopened);
  const blocked = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '中断后的同一任务', newTask: true }, { agent: { session: {} }, callId: 'interrupted-new-task' });
  assert.equal(blocked.重复投递已拦截, true);
  assert.equal(blocked.taskId, interrupted.id);
  assert.equal(reopened.getTask(interrupted.id).status, 'EXPIRED');
  assert.equal(reopened.getTask(interrupted.id).delivery_outcome, 'UNKNOWN');
  assert.equal(conn.calls.filter(([path]) => path === '/api/assistant/relay/send').length, 0);
  assert.equal(approvalCount, 0, '结果不明必须在审批与 transport 前拦截');
  reopened.db.close();
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('⑧ mochi.tasks：同步 relay 状态（accepted→COMPLETED 带回话）+ 入站镜像');
{
  const { tools, conn, exec } = makeHarness();
  const res = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '换课' }, exec);
  conn.rows[0].status = 'accepted';
  conn.rows[0].reply = '可以，周五见';
  const list = await tools.get('mochi.tasks').execute({}, exec);
  const sent = list['已派出的任务'].find((t) => t.taskId === res.taskId);
  assert.equal(sent.status, 'COMPLETED');
  assert.equal(sent['回话'], '可以，周五见');
  assert.equal(sent['任务卡'].includes('COMPLETED'), true);
  // 入站镜像：stub 里塞一条 incoming
  conn.rows.push({ id: 201, direction: 'incoming', peerName: '周宁老师', peerRole: '校医', kind: 'message', body: '周宁老师的 Mochi 替主人带话：【问询】明天能借用一次教室吗', status: 'pending', reply: '', createdAt: '2026-09-05 16:10:00' });
  const list2 = await tools.get('mochi.tasks').execute({}, exec);
  assert.equal(list2['等我回应'].length, 1);
  const mirrored = list2['等我回应'][0];
  assert.equal(mirrored['方向'].includes('周宁老师'), true);
  globalThis.__mirrored = mirrored.taskId;
}

console.log('⑨ mochi.respond：入站任务应答 approve→COMPLETED；出站任务拒绝回应');
{
  const { tools, conn, exec } = makeHarness();
  const res = await tools.get('mochi.ask').execute({ peerName: '张老师', goal: '换课' }, exec);
  conn.rows.push({ id: 202, direction: 'incoming', peerName: '周宁老师', peerRole: '校医', kind: 'message', body: '借用教室', status: 'pending', reply: '', createdAt: '2026-09-05 16:10:00' });
  const list = await tools.get('mochi.tasks').execute({}, exec);
  const inboundId = list['等我回应'][0].taskId;
  const done = await tools.get('mochi.respond').execute({ taskId: inboundId, decision: 'approve', note: '可以，明天说' }, exec);
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done['回话'], '可以，明天说');
  const respondCall = conn.calls.find(([p]) => p === '/api/assistant/relay/respond');
  assert.equal(respondCall[1].action, 'accept');
  assert.equal(respondCall[1].id, 202);
  await assert.rejects(() => tools.get('mochi.respond').execute({ taskId: res.taskId, decision: 'approve' }, exec), /不是收到来的任务/);
  // 重复应答 → 终态不可逆
  await assert.rejects(() => tools.get('mochi.respond').execute({ taskId: inboundId, decision: 'decline' }, exec), /终态/);
}

console.log('⑩ 存储：条件迁移 / 竞争检测 / 过期扫描');
{
  const store = createStore(openStore(':memory:'));
  const t = store.createTask({ ownerUserId: 6, taskType: 'ASK', fromUserId: 6, fromUserName: '演示', toPeerName: '张老师', goal: 'g', idempotencyKey: 'k1', expiredAt: expiryFor('ASK') });
  assert.equal(t.reused, false);
  const again = store.createTask({ ownerUserId: 6, taskType: 'ASK', fromUserId: 6, fromUserName: '演示', toPeerName: '张老师', goal: 'g', idempotencyKey: 'k1' });
  assert.equal(again.reused, true);
  assert.equal(again.id, t.id);
  store.transition(t.id, 'DISPATCHING');
  assert.throws(() => store.transition(t.id, 'COMPLETED'), /非法迁移/); // DISPATCHING→COMPLETED 不合法
  const { idempotent } = store.transition(t.id, 'DISPATCHING');
  assert.equal(idempotent, true); // 同目标态重放=幂等
  store.transition(t.id, 'DELIVERED');
  // 到期扫描：把 expired_at 改到过去
  store.db.prepare("UPDATE mochi_tasks SET expired_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(t.id);
  const expired = store.expireScan();
  assert.deepEqual(expired, [t.id]);
  assert.equal(store.getTask(t.id).status, 'EXPIRED');
  assert.deepEqual(store.expireScan(), []); // 二次扫描幂等
  const compatibleOutgoing = store.createTask({ taskType: 'ASK', fromUserId: 7, fromUserName: '旧调用方', toPeerName: '张老师', goal: '兼容出站', idempotencyKey: 'k-owner-fallback' });
  assert.equal(compatibleOutgoing.owner_user_id, 7, '出站旧调用以稳定 from_user_id 作为 owner');
  assert.throws(() => store.mirrorInboundTask({ taskType: 'ASK', peerName: '周老师', toPeerName: '同名老师', goal: '不能猜收件人', relayMessageId: 888, idempotencyKey: 'relay-in:888' }), /有效的校园账号 ID/);
}

console.log('⑪ 归属与幂等迁移：旧出站恢复 canonical fingerprint，未知旧字段保守阻断');
{
  const tempRoot = mkdtempSync(join(tmpdir(), 'mochi-dispatch-legacy-'));
  const dbPath = join(tempRoot, 'legacy.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE mochi_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL DEFAULT 'jiaxinglian',
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      from_user_id INTEGER NOT NULL,
      from_user_name TEXT NOT NULL,
      to_peer_id INTEGER,
      to_peer_name TEXT NOT NULL,
      to_peer_role TEXT NOT NULL DEFAULT '',
      goal TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      result_answer TEXT NOT NULL DEFAULT '',
      requires_approval INTEGER NOT NULL DEFAULT 1,
      transport TEXT NOT NULL DEFAULT 'relay',
      relay_message_id INTEGER,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      expired_at TEXT
    );
    INSERT INTO mochi_tasks (task_type, status, from_user_id, from_user_name, to_peer_name, goal, relay_message_id, idempotency_key, created_at, updated_at)
    VALUES ('ASK', 'DELIVERED', 61, '同名老师', '同名老师', '历史任务', 991, 'relay-in:991', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z');
    INSERT INTO mochi_tasks (task_type, status, from_user_id, from_user_name, to_peer_name, goal, relay_message_id, idempotency_key, created_at, updated_at)
    VALUES ('ASK', 'FAILED', 61, '同名老师', '周宁老师', '历史出站任务', 992, 'ask:legacy', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z');
    INSERT INTO mochi_tasks (task_type, status, from_user_id, from_user_name, to_peer_name, goal, relay_message_id, idempotency_key, created_at, updated_at)
    VALUES ('FIND', 'DISPATCHING', 61, '同名老师', '周医生', '找「急救包」', 993, 'find:legacy-canonical', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z');
    INSERT INTO mochi_tasks (task_type, status, from_user_id, from_user_name, to_peer_name, goal, relay_message_id, idempotency_key, created_at, updated_at)
    VALUES ('FIND', 'DISPATCHING', 61, '同名老师', '赵老师', '旧寻物编码不完整', 994, 'find:legacy-unparsed', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z');
    INSERT INTO mochi_tasks (task_type, status, from_user_id, from_user_name, to_peer_name, goal, context, relay_message_id, idempotency_key, created_at, updated_at)
    VALUES ('REQUEST', 'DISPATCHING', 61, '同名老师', '教导主任', '旧版请求任务', '旧背景', 995, 'request:legacy', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z');
  `);
  legacy.close();

  const migrated = createStore(openStore(dbPath));
  const columns = migrated.db.prepare('PRAGMA table_info(mochi_tasks)').all().map((column) => column.name);
  assert.ok(columns.includes('owner_user_id'));
  assert.ok(columns.includes('correlation_id'));
  assert.ok(columns.includes('request_fingerprint'));
  assert.ok(columns.includes('delivery_outcome'));
  assert.equal(migrated.getTask(1).owner_user_id, null);
  assert.equal(migrated.getTask(2).owner_user_id, 61, '旧出站行可由稳定 from_user_id 回填');
  assert.equal(migrated.getTask(1).correlation_id, 'legacy:1');
  assert.equal(migrated.getTask(2).correlation_id, 'legacy:2');
  assert.equal(migrated.getTask(2).delivery_outcome, 'UNKNOWN', '旧 FAILED 行没有可验证的未写入证据，不能重试');
  assert.equal(migrated.getTask(2).request_fingerprint, idempotencyKeyFor({
    tool: 'ASK', userId: 61, peerName: '周宁老师', goal: '历史出站任务', context: '',
  }));
  assert.equal(migrated.getTask(3).request_fingerprint, idempotencyKeyFor({
    tool: 'FIND', userId: 61, peerName: '周医生', goal: '急救包', context: '',
  }));
  assert.equal(migrated.getTask(4).request_fingerprint, 'legacy:4', '未确认的旧 FIND 编码不得猜测 item');
  assert.equal(migrated.getTask(5).request_fingerprint, idempotencyKeyFor({
    tool: 'REQUEST', userId: 61, peerName: '教导主任', goal: '旧版请求任务', context: '旧背景',
  }));
  assert.equal(migrated.listAll().length, 5, '迁移不删除历史任务');
  assert.deepEqual(migrated.listTasksByUser(61).map((task) => task.id), [5, 4, 3, 2], '旧入站行不能只因同名或旧 from_user_id 被认领');

  // 模拟前一版迁移已经写入 legacy:<id> 的现场；本次升级仍要修复成 canonical key。
  migrated.db.prepare("UPDATE mochi_tasks SET request_fingerprint = 'legacy:2' WHERE id = 2").run();
  const repaired = createStore(migrated.db);
  assert.equal(repaired.getTask(2).request_fingerprint, idempotencyKeyFor({
    tool: 'ASK', userId: 61, peerName: '周宁老师', goal: '历史出站任务', context: '',
  }));

  const tools = new Map();
  let approvalCount = 0;
  let sendCount = 0;
  const legacyConnection = {
    binding: async (exec) => ({ token: 'legacy-token', user: { id: 61, name: '同名老师', role: 'HEAD_TEACHER' }, session: exec.agent.session }),
    request: async (path, _exec, opts = {}) => {
      if (path === '/api/assistant/relay/find') return { source: 'stub', result: { hits: [] } };
      if (path === '/api/assistant/relay/send') {
        sendCount += 1;
        return {
          source: 'stub',
          result: {
            ok: true,
            relayMessageId: 996,
            peer: { id: 96, name: opts.body?.peerName, role: '教师' },
          },
        };
      }
      throw new Error(`unexpected legacy stub path: ${path}`);
    },
  };
  apply({
    tools: { register: (tool) => tools.set(tool.name, tool) },
    get: (key) => key === 'approval' ? { request: async () => { approvalCount += 1; return 'allowed-once'; } } : undefined,
    logger: console,
  }, legacyConnection, repaired);
  const legacyExec = { agent: { session: {} }, callId: 'legacy-migration-replay' };
  const sameAsk = await tools.get('mochi.ask').execute({ peerName: '周宁老师', goal: '历史出站任务' }, legacyExec);
  const sameRequest = await tools.get('mochi.request').execute({ peerName: '教导主任', goal: '旧版请求任务', context: '旧背景' }, legacyExec);
  const sameFind = await tools.get('mochi.find').execute({ item: '急救包', peerName: '周医生' }, legacyExec);
  const uncertainFind = await tools.get('mochi.find').execute({ item: '校牌', peerName: ' 赵老师 ' }, legacyExec);
  assert.equal(sameAsk.重复投递已拦截, true);
  assert.equal(sameAsk.taskId, 2, '真实旧 schema 的同 payload ASK 不能二次发送');
  assert.equal(sameRequest.重复投递已拦截, true);
  assert.equal(sameRequest.taskId, 5, '真实旧 schema 的同 payload REQUEST 不能二次发送');
  assert.equal(sameFind.重复投递已拦截, true);
  assert.equal(sameFind.taskId, 3, '确认编码的旧 FIND 恢复同一 fingerprint');
  assert.equal(uncertainFind.重复投递已拦截, true);
  assert.equal(uncertainFind.taskId, 4, '无法反解的旧 FIND 以 legacy blocker 保守阻断');
  assert.equal(sendCount, 0, '迁移后的相同/不确定旧任务不能触发第二次 relay 投递');
  assert.equal(approvalCount, 0, '持久化幂等应在审批前拦截');

  // 旧记录的损坏 goal 只能阻断已知的同一规范化对端。它不能冻结同账号所有 FIND，
  // 因此另一位明确对端仍能走正常审批和新建投递。
  const otherPeerFind = await tools.get('mochi.find').execute({ item: '校牌', peerName: ' 李老师 ' }, legacyExec);
  assert.equal(otherPeerFind.status, 'DELIVERED');
  assert.equal(otherPeerFind.peer.name, '李老师');
  assert.equal(sendCount, 1, '不同已知对端的 FIND 可以正常创建并投递');
  assert.equal(approvalCount, 1, '不同已知对端仍会走一次真实审批');
  migrated.db.close();
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('⑫ 同名账号：按稳定 owner 隔离入站镜像，非 owner 不触发审批或 transport');
{
  const accounts = new Map([
    [61, { id: 61, name: '同名老师', role: 'HEAD_TEACHER' }],
    [62, { id: 62, name: '同名老师', role: 'HEAD_TEACHER' }],
  ]);
  const calls = [];
  const conn = {
    binding: async (exec) => {
      const user = accounts.get(exec.agent.session.accountId);
      return { token: `token-${user.id}`, user, session: exec.agent.session };
    },
    request: async (path, exec, opts = {}) => {
      const accountId = exec.agent.session.accountId;
      calls.push({ path, accountId, body: opts.body, expectedUserId: opts.expectedUserId });
      if (path === '/api/assistant/relay') {
        // 同一个 relay ID 专门验证本地幂等键确实按收件账号分区。
        return {
          source: 'stub',
          result: {
            outgoing: [],
            incoming: [{
              id: 501,
              direction: 'incoming',
              peerName: '周宁老师',
              peerRole: '校医',
              kind: 'message',
              body: `给账号 ${accountId} 的入站任务`,
              status: 'pending',
              reply: '',
              createdAt: '2026-09-05 16:10:00',
            }],
          },
        };
      }
      if (path === '/api/assistant/relay/respond') {
        return { source: 'stub', result: { ok: true, status: opts.body.action === 'accept' ? 'accepted' : 'declined' } };
      }
      throw new Error(`stub: unexpected ${path}`);
    },
  };
  let approvalCount = 0;
  const tools = new Map();
  const store = createStore(openStore(':memory:'));
  apply({
    tools: { register: (tool) => tools.set(tool.name, tool) },
    get: (key) => key === 'approval' ? { request: async () => { approvalCount += 1; return 'allowed-once'; } } : undefined,
    logger: console,
  }, conn, store);
  const execA = { agent: { session: { accountId: 61 } }, callId: 'same-name-a' };
  const execB = { agent: { session: { accountId: 62 } }, callId: 'same-name-b' };

  const listA = await tools.get('mochi.tasks').execute({}, execA);
  const listB = await tools.get('mochi.tasks').execute({}, execB);
  const taskA = listA['等我回应'][0].taskId;
  const taskB = listB['等我回应'][0].taskId;
  assert.notEqual(taskA, taskB);
  assert.equal(store.getTask(taskA).owner_user_id, 61);
  assert.equal(store.getTask(taskB).owner_user_id, 62);
  assert.equal(store.getTask(taskA).idempotency_key, 'relay-in:61:501');
  assert.equal(store.getTask(taskB).idempotency_key, 'relay-in:62:501');
  assert.deepEqual(store.listTasksByUser(61).map((task) => task.id), [taskA]);
  assert.deepEqual(store.listTasksByUser(62).map((task) => task.id), [taskB]);
  assert.equal(listA['收到的任务'].map((task) => task.taskId).includes(taskB), false);
  assert.equal(listB['收到的任务'].map((task) => task.taskId).includes(taskA), false);

  const respondsBefore = calls.filter((call) => call.path === '/api/assistant/relay/respond').length;
  await assert.rejects(() => tools.get('mochi.respond').execute({ taskId: taskA, decision: 'approve' }, execB), /不属于当前校园账号/);
  assert.equal(approvalCount, 0, '非 owner 不得进入人工确认');
  assert.equal(calls.filter((call) => call.path === '/api/assistant/relay/respond').length, respondsBefore, '非 owner 不得触发远端应答');

  const completed = await tools.get('mochi.respond').execute({ taskId: taskA, decision: 'approve', note: '我来处理' }, execA);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(approvalCount, 1);
  const respond = calls.find((call) => call.path === '/api/assistant/relay/respond');
  assert.equal(respond.accountId, 61);
  assert.equal(respond.expectedUserId, 61, '保留连接层 expectedUserId 守卫');
}

console.log('mochi-dispatch tests passed: 状态机/存储/五工具/审批闸/幂等 全绿');
