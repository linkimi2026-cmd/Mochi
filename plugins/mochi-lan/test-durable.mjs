import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAN_STATE_FILENAME, MochiLanService } from './lan-service.mjs';

const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

function injectedWriter(control) {
  return async (...argumentsForWrite) => {
    const content = String(argumentsForWrite[1] ?? '');
    if (control.fail) {
      const error = new Error('test-only durable write failure');
      error.code = 'EIO';
      throw error;
    }
    if (control.delayMessageId && content.includes(control.delayMessageId)) await pause(60);
    return writeFile(...argumentsForWrite);
  };
}

function identity(role, endpointId, displayName, extras = {}) {
  return {
    role,
    endpointId,
    schoolId: 'durable-school',
    displayName,
    ...extras,
  };
}

function authorization(lan, action, source = 'connection-direct') {
  return lan.authorize(action, source);
}

async function persisted(root) {
  return JSON.parse(await readFile(join(root, LAN_STATE_FILENAME), 'utf8'));
}

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code);
}

async function occupyUdpPort() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolveBind, rejectBind) => {
    socket.once('error', rejectBind);
    socket.bind(0, '127.0.0.1', () => {
      socket.off('error', rejectBind);
      resolveBind();
    });
  });
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('test UDP socket did not receive a numeric port');
  return { socket, port: address.port };
}

async function availableUdpPort() {
  const occupied = await occupyUdpPort();
  await new Promise((resolveClose) => occupied.socket.close(resolveClose));
  return occupied.port;
}

const temporary = await mkdtemp(join(tmpdir(), 'mochi-lan-durable-'));
const teacherRoot = join(temporary, 'teacher');
const classroomRoot = join(temporary, 'classroom');
const teacherWrites = { fail: false };
const classroomWrites = { fail: false, delayMessageId: null };
const teacher = new MochiLanService({
  dataRoot: teacherRoot,
  bindHost: '127.0.0.1',
  port: 0,
  discoveryEnabled: false,
  identity: identity('teacher', 'teacher-durable', '王老师'),
  writeFileImpl: injectedWriter(teacherWrites),
});
let classroom = new MochiLanService({
  dataRoot: classroomRoot,
  bindHost: '127.0.0.1',
  port: 0,
  discoveryEnabled: false,
  identity: identity('classroom', 'classroom-durable', '高三一班教室', { classId: 'g12-1' }),
  writeFileImpl: injectedWriter(classroomWrites),
});
let replacementTeacher;

try {
  await teacher.start();
  await classroom.start();
  const classroomAddress = { host: '127.0.0.1', port: classroom.snapshot().http.port };
  const classroomCandidate = classroom.pairingCandidate();

  console.log('⓪ 启动角色锁定在宿主配置，设置请求不能把教室端改成教师端');
  await expectCode(
    () => classroom.configureIdentity(
      identity('teacher', 'classroom-durable', '错误角色'),
      { authorization: authorization(classroom, 'configure-identity') },
    ),
    'ROLE_LOCKED',
  );
  assert.equal(classroom.snapshot().lockedRole, 'classroom');
  assert.equal(classroom.snapshot().identity.role, 'classroom');
  const unlocked = new MochiLanService({ dataRoot: join(temporary, 'unlocked'), bindHost: '127.0.0.1', port: 0, discoveryEnabled: false });
  try {
    await unlocked.start();
    await expectCode(
      () => unlocked.configureIdentity(
        identity('teacher', 'unlocked-device', '不应由浏览器选择的角色'),
        { authorization: authorization(unlocked, 'configure-identity') },
      ),
      'ROLE_LOCK_REQUIRED',
    );
  } finally {
    await unlocked.stop();
  }

  console.log('⓪a UDP 发现端口不可用时，HTTP/手动地址路径仍可启动并公开降级状态');
  const occupied = await occupyUdpPort();
  const degraded = new MochiLanService({
    dataRoot: join(temporary, 'discovery-degraded'), bindHost: '127.0.0.1', port: 0,
    discoveryEnabled: true, discoveryPort: occupied.port,
    testBeaconHost: '127.0.0.1', testBeaconPort: occupied.port,
    identity: identity('teacher', 'degraded-teacher', '发现降级教师端'),
  });
  try {
    const degradedState = await degraded.start();
    assert.equal(degradedState.started, true);
    assert.equal(degradedState.discovery.status, 'DEGRADED');
    assert.equal(typeof degradedState.discovery.errorCode, 'string');
    const health = await fetch(`http://127.0.0.1:${degradedState.http.port}/health`);
    assert.equal(health.status, 200);
  } finally {
    await degraded.stop();
    await new Promise((resolveClose) => occupied.socket.close(resolveClose));
  }

  console.log('⓪b 组播加入失败时，广播路径仍保持 ACTIVE；仅两条 UDP 路径都不可用才降级');
  const fallbackPort = await availableUdpPort();
  const multicastFallback = new MochiLanService({
    dataRoot: join(temporary, 'multicast-fallback'), bindHost: '127.0.0.1', port: 0,
    discoveryEnabled: true, discoveryPort: fallbackPort,
    testBeaconHost: '127.0.0.1', testBeaconPort: fallbackPort,
    // TEST-NET has no local interface. Node dgram therefore rejects this
    // membership deterministically, while the loopback broadcast test path is
    // still available.
    testMulticastInterface: '203.0.113.1',
    identity: identity('teacher', 'multicast-fallback-teacher', '组播降级教师端'),
  });
  try {
    const fallbackState = await multicastFallback.start();
    assert.equal(fallbackState.started, true);
    assert.equal(fallbackState.discovery.status, 'ACTIVE');
    assert.equal(fallbackState.discovery.errorCode, null);
  } finally {
    await multicastFallback.stop();
  }

  console.log('① 接收配对请求只有落盘后才返回 pending；写盘失败不留下内存待确认');
  classroomWrites.fail = true;
  await expectCode(
    () => teacher.requestPairing({
      candidate: classroomCandidate,
      address: classroomAddress,
      authorization: authorization(teacher, 'request-pairing'),
    }),
    'INTERNAL_ERROR',
  );
  assert.equal(classroom.snapshot().pendingPairings.length, 0);
  assert.equal(Object.keys((await persisted(classroomRoot)).pendingIncoming).length, 0);
  classroomWrites.fail = false;

  const pairing = await teacher.requestPairing({
    candidate: classroomCandidate,
    address: classroomAddress,
    authorization: authorization(teacher, 'request-pairing'),
  });
  await classroom.acceptPairing({ requestId: pairing.requestId, authorization: authorization(classroom, 'accept-pairing') });
  assert.equal(teacher.snapshot().peers.length, 1);
  assert.equal(classroom.snapshot().peers.length, 1);

  console.log('② 接收消息写盘失败不返回 ACK，重试同一 ID 后才持久化');
  classroomWrites.fail = true;
  await expectCode(
    () => teacher.sendMessage({
      targetEndpointId: 'classroom-durable',
      body: '落盘失败不能假 ACK。',
      messageId: 'durable-write-failure',
      authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
    }),
    'INTERNAL_ERROR',
  );
  assert.equal(classroom.snapshot().inbox.some((row) => row.messageId === 'durable-write-failure'), false);
  assert.equal(Boolean((await persisted(classroomRoot)).inbox['durable-write-failure']), false);
  classroomWrites.fail = false;
  const recovered = await teacher.retryMessage({
    messageId: 'durable-write-failure',
    authorization: authorization(teacher, 'retry-message', 'dispatch-approved'),
  });
  assert.equal(recovered.delivery, 'ACKNOWLEDGED');
  assert.equal(classroom.snapshot().inbox.filter((row) => row.messageId === 'durable-write-failure').length, 1);

  console.log('③ 两个并发同 ID 请求串行提交：一个首次 ACK，一个重复 ACK，收件只一条');
  classroomWrites.delayMessageId = 'durable-concurrent';
  const concurrent = await Promise.all([
    teacher.sendMessage({
      targetEndpointId: 'classroom-durable',
      body: '并发重复不应重复弹窗。',
      messageId: 'durable-concurrent',
      authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
    }),
    teacher.sendMessage({
      targetEndpointId: 'classroom-durable',
      body: '并发重复不应重复弹窗。',
      messageId: 'durable-concurrent',
      authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
    }),
  ]);
  classroomWrites.delayMessageId = null;
  assert.deepEqual(concurrent.map((row) => row.ack.duplicate).sort(), [false, true]);
  assert.equal(classroom.snapshot().inbox.filter((row) => row.messageId === 'durable-concurrent').length, 1);
  assert.equal(Object.keys((await persisted(classroomRoot)).inbox).filter((id) => id === 'durable-concurrent').length, 1);

  console.log('④ 已看到回执同样只在教师端持久化后记录；失败可由人工再次确认恢复');
  await teacher.sendMessage({
    targetEndpointId: 'classroom-durable',
    body: '请人工确认已看到。',
    messageId: 'durable-seen',
    authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
  });
  teacherWrites.fail = true;
  await expectCode(
    () => classroom.markSeen({ messageId: 'durable-seen', authorization: authorization(classroom, 'mark-seen') }),
    'INTERNAL_ERROR',
  );
  assert.equal(teacher.snapshot().receipts.some((row) => row.messageId === 'durable-seen'), false);
  assert.equal(Boolean((await persisted(teacherRoot)).receipts['durable-seen']), false);
  teacherWrites.fail = false;
  const seen = await classroom.markSeen({ messageId: 'durable-seen', authorization: authorization(classroom, 'mark-seen') });
  assert.equal(seen.status, 'ACKNOWLEDGED');
  assert.equal(teacher.snapshot().receipts.filter((row) => row.messageId === 'durable-seen').length, 1);

  console.log('⑤ 改班并重新配对后，旧收件保持原目标且不向新班或新教师确认；新收件正常确认');
  await teacher.sendMessage({
    targetEndpointId: 'classroom-durable',
    body: '原班级通知，改班后只能作为历史保留。',
    messageId: 'recipient-before-class-change',
    authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
  });
  const originalInbox = classroom.snapshot().inbox.find((row) => row.messageId === 'recipient-before-class-change');
  assert.deepEqual(originalInbox?.recipient, {
    endpointId: 'classroom-durable',
    role: 'classroom',
    schoolId: 'durable-school',
    classId: 'g12-1',
    displayName: '高三一班教室',
    fingerprint: classroom.snapshot().identity.fingerprint,
  }, 'a received row stores the verified classroom identity instead of later reading current state');
  await classroom.configureIdentity(
    identity('classroom', 'classroom-durable', '高三二班教室', { classId: 'g12-2' }),
    { authorization: authorization(classroom, 'configure-identity') },
  );
  await teacher.configureIdentity(
    identity('teacher', 'teacher-durable', '新班王老师'),
    { authorization: authorization(teacher, 'configure-identity') },
  );
  const changedClassroomCandidate = classroom.pairingCandidate();
  const changedClassroomAddress = { host: '127.0.0.1', port: classroom.snapshot().http.port };
  const changedPairing = await teacher.requestPairing({
    candidate: changedClassroomCandidate,
    address: changedClassroomAddress,
    authorization: authorization(teacher, 'request-pairing'),
  });
  await classroom.acceptPairing({ requestId: changedPairing.requestId, authorization: authorization(classroom, 'accept-pairing') });
  await expectCode(
    () => classroom.markSeen({ messageId: 'recipient-before-class-change', authorization: authorization(classroom, 'mark-seen') }),
    'RECIPIENT_BINDING_STALE',
  );
  assert.equal(classroom.snapshot().inbox.find((row) => row.messageId === 'recipient-before-class-change')?.seenAt, undefined, 'a stale row is not marked seen before rejection');
  assert.equal(teacher.snapshot().receipts.some((row) => row.messageId === 'recipient-before-class-change'), false);
  await teacher.sendMessage({
    targetEndpointId: 'classroom-durable',
    body: '新班级通知可以正常确认。',
    messageId: 'recipient-after-class-change',
    authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
  });
  const currentInbox = classroom.snapshot().inbox.find((row) => row.messageId === 'recipient-after-class-change');
  assert.equal(currentInbox?.recipient?.classId, 'g12-2');
  assert.equal((await classroom.markSeen({ messageId: 'recipient-after-class-change', authorization: authorization(classroom, 'mark-seen') })).status, 'ACKNOWLEDGED');

  console.log('⑥ 原教师同 endpointId 换公钥重新配对后，旧通知不能向新身份确认');
  await teacher.sendMessage({
    targetEndpointId: 'classroom-durable',
    body: '同端点旧公钥通知。',
    messageId: 'recipient-before-teacher-rekey',
    authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
  });
  const oldTeacherFingerprint = teacher.snapshot().identity.fingerprint;
  replacementTeacher = new MochiLanService({
    dataRoot: join(temporary, 'teacher-rekey'),
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
    identity: identity('teacher', 'teacher-durable', '新密钥王老师'),
  });
  await replacementTeacher.start();
  assert.notEqual(replacementTeacher.snapshot().identity.fingerprint, oldTeacherFingerprint, 'the replacement uses a new key despite sharing endpointId');
  await classroom.unpairPeer({ endpointId: 'teacher-durable', authorization: authorization(classroom, 'unpair-peer') });
  const replacementPairing = await replacementTeacher.requestPairing({
    candidate: classroom.pairingCandidate(),
    address: { host: '127.0.0.1', port: classroom.snapshot().http.port },
    authorization: authorization(replacementTeacher, 'request-pairing'),
  });
  await classroom.acceptPairing({ requestId: replacementPairing.requestId, authorization: authorization(classroom, 'accept-pairing') });
  await expectCode(
    () => classroom.markSeen({ messageId: 'recipient-before-teacher-rekey', authorization: authorization(classroom, 'mark-seen') }),
    'PAIRING_CHANGED',
  );
  assert.equal(classroom.snapshot().inbox.find((row) => row.messageId === 'recipient-before-teacher-rekey')?.seenAt, undefined, 'a new key cannot make an old row appear confirmed');
  assert.equal(teacher.snapshot().receipts.some((row) => row.messageId === 'recipient-before-teacher-rekey'), false);
  await replacementTeacher.sendMessage({
    targetEndpointId: 'classroom-durable',
    body: '新密钥配对后的通知可以正常确认。',
    messageId: 'recipient-after-teacher-rekey',
    authorization: authorization(replacementTeacher, 'send-message', 'dispatch-approved'),
  });
  assert.equal((await classroom.markSeen({ messageId: 'recipient-after-teacher-rekey', authorization: authorization(classroom, 'mark-seen') })).status, 'ACKNOWLEDGED');

  console.log('⑦ 无接收身份的旧状态只读保留，服务层也拒绝发送已看到回执');
  await replacementTeacher.sendMessage({
    targetEndpointId: 'classroom-durable',
    body: '模拟旧版本未记录接收身份的收件。',
    messageId: 'legacy-recipient-binding',
    authorization: authorization(replacementTeacher, 'send-message', 'dispatch-approved'),
  });
  await classroom.stop();
  const legacyState = await persisted(classroomRoot);
  delete legacyState.inbox['legacy-recipient-binding'].recipient;
  await writeFile(join(classroomRoot, LAN_STATE_FILENAME), `${JSON.stringify(legacyState)}\n`, { encoding: 'utf8', mode: 0o600 });
  classroom = new MochiLanService({
    dataRoot: classroomRoot,
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
    identity: identity('classroom', 'classroom-durable', '高三二班教室', { classId: 'g12-2' }),
    writeFileImpl: injectedWriter(classroomWrites),
  });
  await classroom.start();
  await expectCode(
    () => classroom.markSeen({ messageId: 'legacy-recipient-binding', authorization: authorization(classroom, 'mark-seen') }),
    'RECIPIENT_BINDING_REQUIRED',
  );
  assert.equal(classroom.snapshot().inbox.find((row) => row.messageId === 'legacy-recipient-binding')?.seenAt, undefined);
  assert.equal(replacementTeacher.snapshot().receipts.some((row) => row.messageId === 'legacy-recipient-binding'), false);

  console.log('durable LAN tests passed: atomic message commits, identity-bound inbox history, class-change and same-endpoint key-rotation receipt refusal');
} finally {
  await Promise.allSettled([teacher.stop(), classroom.stop(), replacementTeacher?.stop()]);
  await rm(temporary, { recursive: true, force: true });
}
