import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply } from './index.mjs';
import { localLanOwnerKey } from './lan-transport.mjs';
import { createStore, openStore } from './store.mjs';
import { MochiLanService } from '../mochi-lan/lan-service.mjs';

function authorization(lan, action, source = 'connection-direct') {
  return lan.authorize(action, source);
}

function createTools(lan, store) {
  const tools = new Map();
  const approval = { request: async () => 'allowed-once' };
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); } },
    get(key) { return key === 'approval' ? approval : undefined; },
    inject(names, callback) {
      assert.deepEqual(names, ['mochiLan']);
      callback({ get: (key) => key === 'mochiLan' ? lan : undefined });
    },
  };
  // A standalone LAN teacher intentionally has no campus Connection.  The
  // task reader must still project the local signed receipt.
  apply(ctx, {}, store);
  return tools;
}

async function pair(teacher, classroom) {
  const candidate = classroom.pairingCandidate();
  const request = await teacher.requestPairing({
    candidate,
    address: { host: '127.0.0.1', port: classroom.snapshot().http.port },
    authorization: authorization(teacher, 'request-pairing'),
  });
  await classroom.acceptPairing({
    requestId: request.requestId,
    authorization: authorization(classroom, 'accept-pairing'),
  });
}

const temporary = await mkdtemp(join(tmpdir(), 'mochi-dispatch-lan-seen-recovery-'));
let teacher;
let classroom;
try {
  teacher = new MochiLanService({
    dataRoot: join(temporary, 'teacher'),
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
    identity: { role: 'teacher', endpointId: 'teacher-seen-recovery', schoolId: 'receipt-school', displayName: '王老师' },
  });
  classroom = new MochiLanService({
    dataRoot: join(temporary, 'classroom'),
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
    dropDeliveryAckOnce: true,
    identity: { role: 'classroom', endpointId: 'classroom-seen-recovery', schoolId: 'receipt-school', classId: 'g12-1', displayName: '高三一班教室' },
  });
  await teacher.start();
  await classroom.start();
  await pair(teacher, classroom);

  const store = createStore(openStore(':memory:'));
  const tools = createTools(teacher, store);
  const notify = tools.get('mochi_notify_classroom');
  const tasks = tools.get('mochi_tasks');
  assert.ok(notify);
  assert.ok(tasks);

  console.log('真实签名链：教室已持久化消息但 delivery ACK 丢失时，dispatch 只保留 UNKNOWN');
  await assert.rejects(
    () => notify.execute(
      { classroomEndpointId: 'classroom-seen-recovery', message: '请查看明天高三化学复习课件。' },
      { agent: { session: {} }, callId: 'late-seen-recovery-call' },
    ),
    /结果不明/,
  );
  const owner = localLanOwnerKey(teacher);
  const unknownTask = store.listTasksByLanOwner(owner)[0];
  assert.equal(unknownTask.status, 'DISPATCHING');
  assert.equal(unknownTask.delivery_outcome, 'UNKNOWN');
  const unknownMessageId = teacher.snapshot().outbox[0]?.messageId;
  assert.ok(unknownMessageId);
  assert.equal(teacher.snapshot().outbox[0].delivery, 'UNKNOWN');
  assert.equal(classroom.snapshot().inbox.filter((row) => row.messageId === unknownMessageId).length, 1);

  const beforeReceipt = await tasks.execute({}, { agent: { session: {} }, callId: 'late-seen-before-receipt' });
  assert.equal(beforeReceipt.已派出的任务.find((task) => task.taskId === unknownTask.id)?.status, 'DISPATCHING');

  console.log('教室人工已看到后，真实 HTTP 签名 receipt 到达；无需、也不会重发消息');
  const seen = await classroom.markSeen({
    messageId: unknownMessageId,
    authorization: authorization(classroom, 'mark-seen'),
  });
  assert.equal(seen.status, 'ACKNOWLEDGED');
  assert.equal(teacher.snapshot().receipts.filter((row) => row.messageId === unknownMessageId).length, 1);
  assert.equal(teacher.snapshot().outbox[0].delivery, 'UNKNOWN', 'late seen receipt must not masquerade as a delivery ACK');

  const recovered = await tasks.execute({}, { agent: { session: {} }, callId: 'late-seen-after-receipt' });
  const recoveredView = recovered.已派出的任务.find((task) => task.taskId === unknownTask.id);
  assert.equal(recoveredView?.status, 'COMPLETED');
  assert.match(recoveredView?.回话 || '', /已看到通知/);
  const recoveredTask = store.getTask(unknownTask.id);
  assert.equal(recoveredTask.status, 'COMPLETED');
  assert.equal(recoveredTask.delivery_outcome, 'DELIVERED');
  assert.equal(recoveredTask.receipt_seen_at, teacher.snapshot().receipts.find((row) => row.messageId === unknownMessageId)?.seenAt);
  assert.equal(teacher.snapshot().outbox.length, 1, 'receipt projection must not create a retry attempt');
  assert.equal(teacher.snapshot().outbox[0].delivery, 'UNKNOWN');

  console.log('dispatch LAN late seen receipt recovery passed: actual paired signed receipt recovers only the existing UNKNOWN task.');
} finally {
  await Promise.allSettled([
    teacher ? teacher.stop() : Promise.resolve(),
    classroom ? classroom.stop() : Promise.resolve(),
  ]);
  await rm(temporary, { recursive: true, force: true });
}
