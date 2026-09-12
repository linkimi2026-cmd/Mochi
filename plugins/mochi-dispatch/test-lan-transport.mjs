import assert from 'node:assert/strict';

import { apply } from './index.mjs';
import { lanTaskMessageId, listLanClassrooms, localLanOwnerKey, sendLanFile, sendLanNotification } from './lan-transport.mjs';
import { createStore, openStore } from './store.mjs';

function teacherSnapshot(endpointId = 'teacher-1', fingerprint = 'sha256:teacher') {
  return {
    started: true,
    configured: true,
    identity: { endpointId, role: 'teacher', schoolId: 'demo-school', displayName: '王老师', fingerprint },
    peers: [{ endpointId: 'classroom-1', role: 'classroom', schoolId: 'demo-school', classId: 'g7-1', displayName: '七一班教室', fingerprint: 'sha256:classroom', blocked: false, online: true }],
    outbox: [],
    receipts: [],
  };
}

function lanHarness(snapshot = teacherSnapshot()) {
  const sent = [];
  const files = [];
  const authorizations = [];
  let sendFailure = null;
  let fileFailure = null;
  let currentSnapshot = snapshot;
  return {
    sent,
    files,
    authorizations,
    get sendFailure() { return sendFailure; },
    set sendFailure(value) { sendFailure = value; },
    get fileFailure() { return fileFailure; },
    set fileFailure(value) { fileFailure = value; },
    snapshot: () => currentSnapshot,
    replaceSnapshot(next) { currentSnapshot = next; },
    listDiscovered: () => [{ endpointId: 'candidate-1', role: 'classroom', schoolId: 'demo-school', classId: 'g7-2', displayName: '七二班教室', fingerprint: 'sha256:candidate', paired: false, blocked: false, address: { host: '192.0.2.1', port: 47_832 } }],
    authorize(action, source) {
      const token = Object.freeze({ action, source });
      authorizations.push(token);
      return token;
    },
    async sendMessage(input) {
      if (sendFailure) throw sendFailure;
      assert.equal(input.authorization.source, 'dispatch-approved');
      sent.push(input);
      return { messageId: input.messageId, delivery: 'ACKNOWLEDGED', ack: { duplicate: false } };
    },
    async sendFile(input) {
      if (fileFailure) throw fileFailure;
      assert.equal(input.authorization.source, 'dispatch-approved');
      files.push(input);
      return {
        file: { fileId: input.fileId, status: 'AVAILABLE', sha256: 'a'.repeat(64) },
        message: { messageId: input.messageId, delivery: 'ACKNOWLEDGED' },
      };
    },
  };
}

function createTools(lan, store, approval, connection = {}) {
  const tools = new Map();
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); } },
    get(key) { return key === 'approval' ? approval : undefined; },
    // The connection argument below intentionally lacks campus binding. LAN
    // tools must still work for a standalone teacher endpoint.
    inject(names, callback) {
      assert.deepEqual(names, ['mochiLan']);
      callback({ get: (key) => key === 'mochiLan' ? lan : undefined });
    },
    logger: console,
  };
  apply(ctx, connection, store);
  return tools;
}

console.log('① 独立 LAN 教师无需校园 Connection 登录：通知经审批后写入同一 mochi_tasks 七态表');
const store = createStore(openStore(':memory:'));
const lan = lanHarness();
let decision = 'allowed-once';
const approvalCalls = [];
const approval = { request: async (input) => { approvalCalls.push(input); return decision; } };
const tools = createTools(lan, store, approval);
const notify = tools.get('mochi_notify_classroom');
const roster = tools.get('mochi_list_classrooms');
const fileTool = tools.get('mochi_send_classroom_file');
const tasksTool = tools.get('mochi_tasks');
assert.ok(notify);
assert.ok(roster);
assert.ok(fileTool);
assert.ok(tasksTool);
assert.match(roster.description, /已配对设备即使当前未发现，也可由已知地址经人工确认发送/);
const listed = await roster.execute({}, { agent: { session: {} } });
assert.equal(listed.pairedClassrooms[0].paired, true);
assert.equal(listed.pairedClassrooms[0].online, true);
assert.equal(listed.nearbyCandidates[0].paired, false);
assert.equal('address' in listed.nearbyCandidates[0], false);
assert.equal(approvalCalls.length, 0);
assert.deepEqual(listLanClassrooms(lan).nearbyCandidates.map((row) => row.endpointId), ['candidate-1']);

const exec = { agent: { session: {} }, callId: 'lan-transport-test-call' };
const result = await notify.execute({ classroomEndpointId: 'classroom-1', message: '请在上课前打开第 3 页课件。' }, exec);
assert.equal(result.transport, 'lan');
assert.equal(result.status, 'DELIVERED');
assert.equal(result.deliveryOutcome, 'DELIVERED');
assert.equal(result.delivery, 'ACKNOWLEDGED');
assert.equal(lan.sent.length, 1);
assert.match(lan.sent[0].messageId, /^lan-[a-f0-9]{32}$/u);
assert.equal(lan.sent[0].expectedSender.fingerprint, 'sha256:teacher');
assert.equal(lan.sent[0].expectedPeer.fingerprint, 'sha256:classroom');
assert.equal(approvalCalls.length, 1);
assert.match(approvalCalls[0].reason, /demo-school/);
assert.match(approvalCalls[0].reason, /g7-1/);
assert.match(approvalCalls[0].reason, /sha256:classroom/);
const firstTask = store.getTask(result.taskId);
assert.equal(firstTask.transport, 'lan');
assert.equal(firstTask.owner_user_id, 0);
assert.equal(firstTask.from_user_id, 0);
assert.equal(firstTask.local_owner_key, localLanOwnerKey(lan));
assert.equal(store.listTasksByUser(1).length, 0, 'LAN rows are never claimed by a campus owner query');
assert.deepEqual(store.listTasksByLanOwner(localLanOwnerKey(lan)).map((task) => task.id), [result.taskId]);

console.log('② 同文通知以本机受管身份和精确 endpoint 判重；UNKNOWN 绝不借 newTask 自动重发');
const approvalsAfterFirst = approvalCalls.length;
const duplicate = await notify.execute({ classroomEndpointId: 'classroom-1', message: '请在上课前打开第 3 页课件。' }, { agent: { session: {} }, callId: 'different-call-id' });
assert.equal(duplicate.重复投递已拦截, true);
assert.equal(approvalCalls.length, approvalsAfterFirst);
assert.equal(lan.sent.length, 1);
lan.sendFailure = Object.assign(new Error('network response lost'), { code: 'DELIVERY_UNKNOWN' });
await assert.rejects(
  () => notify.execute({ classroomEndpointId: 'classroom-1', message: '这条结果应未知。' }, { agent: { session: {} }, callId: 'unknown-call-id' }),
  /结果不明/,
);
const unknownTask = store.listTasksByLanOwner(localLanOwnerKey(lan)).find((task) => task.goal === '这条结果应未知。');
assert.equal(unknownTask.status, 'DISPATCHING');
assert.equal(unknownTask.delivery_outcome, 'UNKNOWN');
const beforeBlocked = approvalCalls.length;
const blocked = await notify.execute({ classroomEndpointId: 'classroom-1', message: '这条结果应未知。', newTask: true }, { agent: { session: {} }, callId: 'unknown-new-call-id' });
assert.equal(blocked.重复投递已拦截, true);
assert.equal(blocked.deliveryOutcome, 'UNKNOWN');
assert.equal(approvalCalls.length, beforeBlocked);
assert.equal(lan.sent.length, 1);
lan.sendFailure = null;

console.log('③ 文件工具复用同一 attempt/审批/状态机；受管源预检查明确失败才允许显式 retry');
lan.fileFailure = Object.assign(new Error('source outside managed root'), { code: 'FILE_SOURCE_FORBIDDEN', lanDeliveryPhase: 'pre-send' });
await assert.rejects(
  () => fileTool.execute({ classroomEndpointId: 'classroom-1', sourcePath: '/private/tmp/outside.pptx', message: '不应出站。' }, { agent: { session: {} }, callId: 'file-bad-source' }),
  /未投递/,
);
const failedFile = store.listTasksByLanOwner(localLanOwnerKey(lan)).find((task) => task.context === '附件：/private/tmp/outside.pptx');
assert.equal(failedFile.status, 'FAILED');
assert.equal(failedFile.delivery_outcome, 'NOT_SENT');
lan.fileFailure = null;
const retriedFile = await fileTool.execute({
  classroomEndpointId: 'classroom-1',
  sourcePath: '/private/tmp/outside.pptx',
  message: '不应出站。',
  retryTaskId: failedFile.id,
}, { agent: { session: {} }, callId: 'file-explicit-retry' });
assert.equal(retriedFile.status, 'DELIVERED');
assert.equal(lan.files.length, 1);
assert.match(lan.files[0].fileId, /^lan-file-[a-f0-9]{32}$/u);
assert.equal(store.getTask(retriedFile.taskId).retry_of_task_id, failedFile.id);

console.log('④ 文件错误只在服务明确标记为请求前才记 NOT_SENT；中途源变化和远端 fileId 冲突保守为 UNKNOWN');
for (const [callId, sourcePath, message, failureCode] of [
  ['file-source-changed-midstream', '/private/tmp/changing-source.pptx', '中途源变化不能假称未发送。', 'FILE_SOURCE_CHANGED'],
  ['file-remote-conflict', '/private/tmp/remote-conflict.pptx', '远端 fileId 冲突不能假称未发送。', 'FILE_ID_CONFLICT'],
]) {
  lan.fileFailure = Object.assign(new Error(failureCode), { code: failureCode });
  await assert.rejects(
    () => fileTool.execute({ classroomEndpointId: 'classroom-1', sourcePath, message }, { agent: { session: {} }, callId }),
    /结果不明/,
  );
  const uncertain = store.listTasksByLanOwner(localLanOwnerKey(lan)).find((task) => task.context === '附件：' + sourcePath);
  assert.equal(uncertain.status, 'DISPATCHING');
  assert.equal(uncertain.delivery_outcome, 'UNKNOWN');
}
lan.fileFailure = null;

console.log('⑤ 缺少稳定 callId 时，在审批和任务写入之前拒绝；教室角色也不能外发');
const approvalBeforeMissingCallId = approvalCalls.length;
await assert.rejects(
  () => sendLanNotification({ lan, approval, store, args: { classroomEndpointId: 'classroom-1', message: '缺少 callId 的通知。' }, exec: { agent: { session: {} } } }),
  /稳定 callId/,
);
assert.equal(approvalCalls.length, approvalBeforeMissingCallId);
const classroomLan = lanHarness({
  ...teacherSnapshot(),
  identity: { endpointId: 'classroom-1', role: 'classroom', schoolId: 'demo-school', classId: 'g7-1', displayName: '七一班教室', fingerprint: 'sha256:classroom' },
});
await assert.rejects(
  () => sendLanNotification({ lan: classroomLan, approval, store, args: { classroomEndpointId: 'classroom-1', message: '教室端不能主动外发。' }, exec }),
  /只有已配置的教师端/,
);
assert.equal(classroomLan.sent.length, 0);

console.log('⑥ 审批打开期间换配对或换本机身份，确认作废且不会创建任务或外发');
const rePairLan = lanHarness();
const rePairStore = createStore(openStore(':memory:'));
const rePairApproval = {
  request: async () => {
    const changed = teacherSnapshot();
    changed.peers = [{ ...changed.peers[0], classId: 'g7-9', fingerprint: 'sha256:replacement-classroom' }];
    rePairLan.replaceSnapshot(changed);
    return 'allowed-once';
  },
};
await assert.rejects(
  () => sendLanNotification({
    lan: rePairLan, approval: rePairApproval, store: rePairStore,
    args: { classroomEndpointId: 'classroom-1', message: '配对替换期间不能发送。' },
    exec: { agent: { session: {} }, callId: 'approval-repair-race' },
  }),
  /等待确认期间/,
);
assert.equal(rePairLan.sent.length, 0);
assert.equal(rePairStore.listAll().length, 0);

const identityRaceLan = lanHarness();
const identityRaceStore = createStore(openStore(':memory:'));
const identityRaceApproval = {
  request: async () => {
    identityRaceLan.replaceSnapshot(teacherSnapshot('teacher-1', 'sha256:new-local-identity'));
    return 'allowed-once';
  },
};
await assert.rejects(
  () => sendLanNotification({
    lan: identityRaceLan, approval: identityRaceApproval, store: identityRaceStore,
    args: { classroomEndpointId: 'classroom-1', message: '本机身份替换期间不能发送。' },
    exec: { agent: { session: {} }, callId: 'approval-identity-race' },
  }),
  /等待确认期间/,
);
assert.equal(identityRaceLan.sent.length, 0);
assert.equal(identityRaceStore.listAll().length, 0);

console.log('⑦ 已确认投递 ACK 不等于人已看到；签名 receipt 让纯通知完成，而文件仍只表示通知被看到');
const pairedPeer = teacherSnapshot().peers[0];
const unknownMessageId = lanTaskMessageId(unknownTask);
lan.replaceSnapshot({
  ...teacherSnapshot(),
  outbox: [
    { messageId: lan.sent[0].messageId, delivery: 'ACKNOWLEDGED', peer: { ...pairedPeer } },
    { messageId: lan.files[0].messageId, delivery: 'ACKNOWLEDGED', peer: { ...pairedPeer }, attachment: { fileId: lan.files[0].fileId } },
    { messageId: unknownMessageId, delivery: 'UNKNOWN', peer: { ...pairedPeer } },
  ],
  receipts: [
    { messageId: lan.sent[0].messageId, from: { ...pairedPeer }, seenAt: '2026-09-09T10:00:00.000Z' },
    { messageId: lan.files[0].messageId, from: { ...pairedPeer }, seenAt: '2026-09-09T10:01:00.000Z' },
    // A snapshot row is not enough: it must still name the exact classroom
    // identity bound into the outgoing message.
    { messageId: unknownMessageId, from: { ...pairedPeer, fingerprint: 'sha256:wrong-classroom' }, seenAt: '2026-09-09T10:02:00.000Z' },
  ],
});
const receiptView = await tasksTool.execute({}, { agent: { session: {} }, callId: 'tasks-with-receipts' });
const seenNotification = receiptView.已派出的任务.find((task) => task.taskId === result.taskId);
assert.equal(seenNotification.status, 'COMPLETED');
assert.equal(seenNotification.教室已看到, '2026-09-09T10:00:00.000Z');
assert.match(seenNotification.回话, /已看到通知/);
const seenFileNotice = receiptView.已派出的任务.find((task) => task.taskId === retriedFile.taskId);
assert.equal(seenFileNotice.status, 'DELIVERED');
assert.equal(seenFileNotice.教室已看到, '2026-09-09T10:01:00.000Z');
assert.match(seenFileNotice.回话, /不代表已打开、展示或执行/);
assert.equal(store.getTask(unknownTask.id).status, 'DISPATCHING');
assert.equal(store.getTask(unknownTask.id).delivery_outcome, 'UNKNOWN');

console.log('⑧ ACK 丢失后的 UNKNOWN 只有精确签名 seen receipt 才恢复；不重发同一消息');
lan.replaceSnapshot({
  ...teacherSnapshot(),
  outbox: [
    { messageId: lan.sent[0].messageId, delivery: 'ACKNOWLEDGED', peer: { ...pairedPeer } },
    { messageId: lan.files[0].messageId, delivery: 'ACKNOWLEDGED', peer: { ...pairedPeer }, attachment: { fileId: lan.files[0].fileId } },
    { messageId: unknownMessageId, delivery: 'UNKNOWN', peer: { ...pairedPeer } },
  ],
  receipts: [
    { messageId: lan.sent[0].messageId, from: { ...pairedPeer }, seenAt: '2026-09-09T10:00:00.000Z' },
    { messageId: lan.files[0].messageId, from: { ...pairedPeer }, seenAt: '2026-09-09T10:01:00.000Z' },
    { messageId: unknownMessageId, from: { ...pairedPeer }, seenAt: '2026-09-09T10:02:00.000Z' },
  ],
});
const recoveredView = await tasksTool.execute({}, { agent: { session: {} }, callId: 'tasks-late-seen-recovery' });
const recoveredNotification = recoveredView.已派出的任务.find((task) => task.taskId === unknownTask.id);
assert.equal(recoveredNotification.status, 'COMPLETED');
assert.equal(recoveredNotification.教室已看到, '2026-09-09T10:02:00.000Z');
assert.match(recoveredNotification.回话, /已看到通知/);
const recoveredTask = store.getTask(unknownTask.id);
assert.equal(recoveredTask.status, 'COMPLETED');
assert.equal(recoveredTask.delivery_outcome, 'DELIVERED');
assert.equal(recoveredTask.receipt_seen_at, '2026-09-09T10:02:00.000Z');
assert.equal(lan.sent.length, 1, 'receipt recovery never sends or retries the UNKNOWN message');

console.log('⑨ mochi_tasks 在无校园账号时仍显示当前 LAN owner 的任务，且不同本机身份互不可见');
const taskView = await tasksTool.execute({}, { agent: { session: {} }, callId: 'tasks-without-campus' });
assert.equal(taskView.campus.available, false);
assert.equal(taskView.lan.available, true);
assert.ok(taskView.已派出的任务.some((task) => task.taskId === result.taskId && task.transport === 'lan'));
const otherLan = lanHarness(teacherSnapshot('teacher-2', 'sha256:teacher-2'));
const otherOwner = localLanOwnerKey(otherLan);
const otherTask = store.createLanDispatchAttempt({
  localOwnerKey: otherOwner,
  fromUserName: '另一位老师',
  toPeerName: '另一间教室',
  goal: '隔离任务',
  requestFingerprint: 'dispatch:lan:v1:other-owner',
});
assert.equal(store.listTasksByLanOwner(otherOwner)[0].id, otherTask.task.id);
assert.equal(store.listTasksByLanOwner(localLanOwnerKey(lan)).some((task) => task.id === otherTask.task.id), false);

console.log('⑩ 已登录校园但 relay 挂起时，短预算取消同步并仍返回本机 LAN 清单');
const hangingRelay = {
  binding: async (callExec) => ({ token: 'stub-token', user: { id: 77, name: '断网教师', role: 'teacher' }, session: callExec.agent.session }),
  request: async (_pathname, callExec) => new Promise((_resolve, reject) => {
    assert.ok(callExec.signal, 'relay sync must receive a cancellable short budget');
    // Keep the fixture alive until the real budget signal fires; unlike a
    // fetch socket, AbortSignal.timeout's timer alone is intentionally unrefed.
    const fallback = setTimeout(() => reject(new Error('fixture relay never observed cancellation')), 3_000);
    callExec.signal.addEventListener('abort', () => {
      clearTimeout(fallback);
      reject(new Error('relay sync budget aborted'));
    }, { once: true });
  }),
};
const boundedTools = createTools(lan, store, approval, hangingRelay);
const boundedStartedAt = Date.now();
const boundedView = await boundedTools.get('mochi_tasks').execute({}, { agent: { session: {} }, callId: 'tasks-relay-hang' });
const boundedElapsedMs = Date.now() - boundedStartedAt;
assert.ok(boundedElapsedMs < 3_500, 'local LAN list must not inherit the relay 45 second timeout');
assert.equal(boundedView.campus.available, true);
assert.equal(boundedView.campus.relaySync.status, 'timed-out');
assert.ok(boundedView.已派出的任务.some((task) => task.taskId === result.taskId && task.transport === 'lan'));

console.log('dispatch LAN transport tests passed: standalone local owner, same mochi_tasks seven states, approval binding, receipt projection, conservative file outcomes, and bounded relay sync');
