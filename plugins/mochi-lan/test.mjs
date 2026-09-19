import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const childProgram = join(dirname(fileURLToPath(import.meta.url)), 'test', 'node.mjs');
const TEST_TIMEOUT_MS = 8_000;
const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

function waitFor(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), TEST_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

async function availableUdpPort() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolveBind, rejectBind) => {
    socket.once('error', rejectBind);
    socket.bind(0, '127.0.0.1', () => {
      socket.off('error', rejectBind);
      resolveBind();
    });
  });
  const address = socket.address();
  await new Promise((resolveClose) => socket.close(resolveClose));
  if (!address || typeof address === 'string') throw new Error('test UDP socket did not receive a numeric port');
  return address.port;
}

async function availableTcpPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!address || typeof address === 'string') throw new Error('test TCP server did not receive a numeric port');
  return address.port;
}

async function waitUntil(read, predicate, label) {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  let last;
  do {
    last = await read();
    if (predicate(last)) return last;
    await pause(35);
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out`);
}

class LanChild {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this.nextId = 0;
    this.ready = null;
    this.exited = new Promise((resolveExit) => { this.resolveExit = resolveExit; });
  }

  static async start(options) {
    const child = spawn(process.execPath, [childProgram], {
      cwd: dirname(childProgram),
      env: {
        PATH: process.env.PATH ?? '',
        DSH_HOME: options.dataRoot,
        MOCHI_LAN_TEST_ROOT: options.dataRoot,
        MOCHI_LAN_TEST_ROLE: options.role,
        MOCHI_LAN_TEST_SCHOOL: options.schoolId,
        MOCHI_LAN_TEST_CLASS: options.classId ?? '',
        MOCHI_LAN_TEST_NAME: options.displayName,
        MOCHI_LAN_TEST_ENDPOINT: options.endpointId,
        MOCHI_LAN_TEST_PORT: String(options.port ?? 0),
        ...(options.discovery ? {
          MOCHI_LAN_TEST_DISCOVERY: '1',
          MOCHI_LAN_TEST_DISCOVERY_PORT: String(options.discovery.port),
          MOCHI_LAN_TEST_BEACON_HOST: options.discovery.targetHost ?? '127.0.0.1',
          MOCHI_LAN_TEST_BEACON_PORT: String(options.discovery.targetPort ?? options.discovery.port),
          MOCHI_LAN_TEST_BEACON_INTERVAL_MS: String(options.discovery.intervalMs ?? 50),
          MOCHI_LAN_TEST_BEACON_TTL_MS: String(options.discovery.ttlMs ?? 250),
          ...(options.discovery.multicastPort === undefined ? {} : { MOCHI_LAN_TEST_MULTICAST_PORT: String(options.discovery.multicastPort) }),
          ...(options.discovery.multicastInterface === undefined ? {} : { MOCHI_LAN_TEST_MULTICAST_INTERFACE: options.discovery.multicastInterface }),
        } : {}),
        ...(options.dropDeliveryAckOnce ? { MOCHI_LAN_TEST_DROP_ACK: '1' } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const instance = new LanChild(child);
    let buffer = '';
    let stderr = '';
    instance.ready = new Promise((resolveReady, rejectReady) => {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let message;
          try { message = JSON.parse(line); } catch { rejectReady(new Error('child emitted non-JSON stdout')); return; }
          if (message.type === 'ready') { instance.snapshot = message.snapshot; instance.pid = message.pid; resolveReady(instance); continue; }
          if (message.type === 'fatal') { rejectReady(new Error(`child start failed: ${message.code}`)); continue; }
          const pending = instance.pending.get(message.id);
          if (!pending) continue;
          instance.pending.delete(message.id);
          if (message.ok) pending.resolve(message.result);
          else pending.reject(Object.assign(new Error(message.error?.code ?? 'UNEXPECTED'), { code: message.error?.code ?? 'UNEXPECTED' }));
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', rejectReady);
      child.once('exit', (code, signal) => {
        instance.resolveExit({ code, signal, stderr });
        const error = new Error(`child exited before ready: ${code ?? signal}${stderr ? ` ${stderr}` : ''}`);
        rejectReady(error);
        for (const pending of instance.pending.values()) pending.reject(error);
        instance.pending.clear();
      });
    });
    return waitFor(instance.ready, 'LAN child startup');
  }

  call(method, args = {}) {
    const id = `call-${++this.nextId}`;
    const result = new Promise((resolveCall, rejectCall) => {
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.child.stdin.write(`${JSON.stringify({ id, method, args })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.reject(error);
        }
      });
    });
    return waitFor(result, `LAN child ${method}`);
  }

  async stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await this.call('stop').catch(() => undefined);
    const exited = await waitFor(this.exited, 'LAN child stop').catch(() => null);
    if (exited === null && this.child.exitCode === null) this.child.kill('SIGTERM');
  }
}

async function rejectCode(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code);
}

const temporary = await mkdtemp(join(tmpdir(), 'mochi-lan-two-process-'));
const teacherRoot = join(temporary, 'teacher');
const classroomRoot = join(temporary, 'classroom');
let teacher;
let classroom;
let discoveryObserver;
let discoverySender;
let clockSkewSender;
try {
  teacher = await LanChild.start({ dataRoot: teacherRoot, endpointId: 'teacher-lan-test', role: 'teacher', schoolId: 'demo-school', displayName: '王老师' });
  classroom = await LanChild.start({ dataRoot: classroomRoot, endpointId: 'classroom-lan-test', role: 'classroom', schoolId: 'demo-school', classId: 'g7-1', displayName: '七一班教室', dropDeliveryAckOnce: true });
  assert.notEqual(teacher.pid, classroom.pid);
  assert.notEqual(teacherRoot, classroomRoot);

  console.log('① 两个独立数据根/Node 进程：手动探测→教师请求→教室人工接受');
  const classroomAddress = { host: '127.0.0.1', port: classroom.snapshot.http.port };
  const classroomCandidate = await classroom.call('candidate');
  const probed = await teacher.call('probe', { address: classroomAddress, expectedFingerprint: classroomCandidate.fingerprint });
  assert.equal(probed.candidate.endpointId, 'classroom-lan-test');
  const requested = await teacher.call('pair-request', { candidate: classroomCandidate, address: classroomAddress });
  const pending = await classroom.call('state');
  assert.equal(pending.pendingPairings.length, 1);
  await classroom.call('pair-accept', { requestId: requested.requestId });
  assert.equal((await teacher.call('state')).peers.length, 1);
  assert.equal((await classroom.call('state')).peers.length, 1);

  console.log('② ACK 丢失后不自动重发；教室持久化、重启后人工已看到可发回签名 receipt');
  await rejectCode(
    () => teacher.call('send', { targetEndpointId: 'classroom-lan-test', body: '请打开第 3 页课件。', messageId: 'notify-ack-lost' }),
    'DELIVERY_UNKNOWN',
  );
  let classroomState = await classroom.call('state');
  assert.equal(classroomState.inbox.filter((item) => item.messageId === 'notify-ack-lost').length, 1);
  const restartPort = classroom.snapshot.http.port;
  await classroom.stop();
  classroom = await LanChild.start({ dataRoot: classroomRoot, endpointId: 'classroom-lan-test', role: 'classroom', schoolId: 'demo-school', classId: 'g7-1', displayName: '七一班教室', port: restartPort });
  const lateSeen = await classroom.call('seen', { messageId: 'notify-ack-lost' });
  assert.equal(lateSeen.status, 'ACKNOWLEDGED');
  const teacherAfterLateSeen = await teacher.call('state');
  assert.equal(teacherAfterLateSeen.outbox.find((item) => item.messageId === 'notify-ack-lost')?.delivery, 'UNKNOWN');
  assert.equal(teacherAfterLateSeen.receipts.filter((item) => item.messageId === 'notify-ack-lost').length, 1);
  console.log('②a 同一 ID 的显式服务重试只取重复 ACK，不产生第二条收件');
  const duplicate = await teacher.call('retry', { messageId: 'notify-ack-lost' });
  assert.equal(duplicate.delivery, 'ACKNOWLEDGED');
  assert.equal(duplicate.ack.duplicate, true);
  classroomState = await classroom.call('state');
  assert.equal(classroomState.inbox.filter((item) => item.messageId === 'notify-ack-lost').length, 1);

  console.log('③ 正常通知→教室人工已看到→教师签名回执');
  const delivered = await teacher.call('send', { targetEndpointId: 'classroom-lan-test', body: '课前请投影今天的班会课件。', messageId: 'notify-seen' });
  assert.equal(delivered.delivery, 'ACKNOWLEDGED');
  classroomState = await classroom.call('state');
  assert.equal(classroomState.inbox.filter((item) => item.messageId === 'notify-seen').length, 1);
  const seen = await classroom.call('seen', { messageId: 'notify-seen' });
  assert.equal(seen.status, 'ACKNOWLEDGED');
  assert.equal((await teacher.call('state')).receipts.filter((item) => item.messageId === 'notify-seen').length, 1);

  console.log('③a 反向通道：教室端发学生预约→教师端收件→教师确认已看到（两端各持一份回执）');
  const studentRequest = await classroom.call('request', {
    targetEndpointId: 'teacher-lan-test',
    body: '第三题不太懂，想请老师讲一下。',
    request: { student: '李明', seat: 3, kind: 'appointment', topic: '二次函数', slot: '第八节晚自习' },
    messageId: 'request-seen',
  });
  assert.equal(studentRequest.delivery, 'ACKNOWLEDGED');
  let teacherState = await teacher.call('state');
  const requestRows = teacherState.inbox.filter((item) => item.messageId === 'request-seen');
  assert.equal(requestRows.length, 1);
  // 学生身份是学生在共用设备上自填的字段，随信封签名只保证「没被中途改过」，
  // 不构成在校身份证明。服务层因此把它当数据带过来，不生成任何身份声明。
  assert.equal(requestRows[0].contentType, 'REQUEST');
  assert.equal(requestRows[0].request.student, '李明');
  assert.equal(requestRows[0].request.seat, 3);
  assert.equal(requestRows[0].from.role, 'classroom');
  assert.equal(requestRows[0].seenAt, undefined);
  const teacherSeen = await teacher.call('seen', { messageId: 'request-seen' });
  assert.equal(teacherSeen.status, 'ACKNOWLEDGED');
  assert.equal((await teacher.call('state')).inbox.find((item) => item.messageId === 'request-seen')?.seenAt !== undefined, true);
  assert.equal((await classroom.call('state')).receipts.filter((item) => item.messageId === 'request-seen').length, 1);
  console.log('③b 方向不可互换：教师端不能发预约，教室端缺预约描述仍被拒');
  await rejectCode(
    () => teacher.call('request', { targetEndpointId: 'classroom-lan-test', body: '教师端不能发学生预约。', request: { student: '李明' }, messageId: 'teacher-as-student' }),
    'INVALID_REQUEST',
  );
  await rejectCode(
    () => classroom.call('request', { targetEndpointId: 'teacher-lan-test', body: '缺预约描述。', messageId: 'request-missing' }),
    'INVALID_REQUEST',
  );
  await rejectCode(
    () => classroom.call('request', {
      targetEndpointId: 'teacher-lan-test',
      body: '越界座号。',
      request: { student: '李明', seat: 10_000 },
      messageId: 'request-bad-seat',
    }),
    'INVALID_REQUEST',
  );

  console.log('③c 教师下发处置名册：一批判决走一条消息，逐人个性化交代随信封过网');
  const directive = await teacher.call('directive', {
    targetEndpointId: 'classroom-lan-test',
    body: '第 5 单元听写已登记，名单见下。',
    directive: {
      item: '第 5 单元听写',
      verdicts: [
        { student: '张三', seat: 1, action: 'pass' },
        { student: '王五', seat: 5, action: 'fail', note: 'th /θ/ 读成了 /s/，课间来重听第 2 段。' },
        { student: '赵六', seat: 6, action: 'fail' },
      ],
    },
    messageId: 'directive-batch',
  });
  assert.equal(directive.delivery, 'ACKNOWLEDGED');
  const boardRows = (await classroom.call('state')).inbox.filter((item) => item.messageId === 'directive-batch');
  // 一批 = 一条消息，不是三条：否则一个班 40 人就是 40 条签名消息 + 40 条回执，
  // 几分钟就能把收件箱上限吃光。
  assert.equal(boardRows.length, 1);
  assert.equal(boardRows[0].contentType, 'NOTIFY');
  assert.equal(boardRows[0].directive.item, '第 5 单元听写');
  assert.equal(boardRows[0].directive.verdicts.length, 3);
  assert.equal(boardRows[0].directive.verdicts[0].action, 'pass');
  assert.equal(boardRows[0].directive.verdicts[1].seat, 5);
  assert.equal(boardRows[0].directive.verdicts[1].note, 'th /θ/ 读成了 /s/，课间来重听第 2 段。');
  // 没给交代就不该凭空长出一句：缺省必须是「没有」，不是「模板补上」。
  assert.equal(boardRows[0].directive.verdicts[2].note, undefined);
  // 「过关或不过关是分老师的」：名册由发起登记的那位教师的身份签名，教室端能看出是谁登记的。
  assert.equal(boardRows[0].from.role, 'teacher');
  assert.equal(boardRows[0].from.endpointId, 'teacher-lan-test');
  const boardSeen = await classroom.call('seen', { messageId: 'directive-batch' });
  assert.equal(boardSeen.status, 'ACKNOWLEDGED');
  assert.equal((await teacher.call('state')).receipts.filter((item) => item.messageId === 'directive-batch').length, 1);

  console.log('③d 名册的方向与输入硬边界：教室端不得下发名册，座号/动作/交代越界即拒');
  // 一台被配对过的教室设备若能下发名册，就等于它能伪造「教师判决」。
  await rejectCode(
    () => classroom.call('directive', {
      targetEndpointId: 'teacher-lan-test',
      body: '教室端伪造名册。',
      directive: { item: '伪造', verdicts: [{ student: '张三', action: 'fail' }] },
      messageId: 'directive-from-classroom',
    }),
    'INVALID_DIRECTIVE',
  );
  await rejectCode(
    () => teacher.call('directive', {
      targetEndpointId: 'classroom-lan-test',
      body: '越界座号。',
      directive: { item: '第 5 单元听写', verdicts: [{ student: '张三', action: 'fail', seat: 10_000 }] },
      messageId: 'directive-bad-seat',
    }),
    'INVALID_DIRECTIVE',
  );
  await rejectCode(
    () => teacher.call('directive', {
      targetEndpointId: 'classroom-lan-test',
      body: '动作不在表内。',
      directive: { item: '第 5 单元听写', verdicts: [{ student: '张三', action: 'expelled' }] },
      messageId: 'directive-bad-action',
    }),
    'INVALID_DIRECTIVE',
  );
  await rejectCode(
    () => teacher.call('directive', {
      targetEndpointId: 'classroom-lan-test',
      body: '空名册。',
      directive: { item: '第 5 单元听写', verdicts: [] },
      messageId: 'directive-empty',
    }),
    'INVALID_DIRECTIVE',
  );
  await rejectCode(
    () => teacher.call('directive', {
      targetEndpointId: 'classroom-lan-test',
      body: '超长交代。',
      directive: { item: '第 5 单元听写', verdicts: [{ student: '张三', action: 'fail', note: '很'.repeat(500) }] },
      messageId: 'directive-long-note',
    }),
    'INVALID_INPUT',
  );
  await rejectCode(
    () => teacher.call('directive', {
      targetEndpointId: 'classroom-lan-test',
      body: '交代里塞换行。',
      directive: { item: '第 5 单元听写', verdicts: [{ student: '张三', action: 'fail', note: '第一行\n第二行' }] },
      messageId: 'directive-newline-note',
    }),
    'INVALID_INPUT',
  );

  console.log('④ 目标错班、冒用教师 endpoint、教室端越权发通知均在服务层拒绝');
  const target = { endpointId: 'classroom-lan-test', schoolId: 'demo-school', classId: 'g7-1', host: '127.0.0.1', port: classroom.snapshot.http.port };
  const wrongClass = await teacher.call('wrong-class', { target, classId: 'g7-2', messageId: 'wrong-class-test' });
  assert.equal(wrongClass.status, 403);
  assert.equal(wrongClass.body.code, 'RECIPIENT_MISMATCH');
  const forged = await teacher.call('forged-endpoint', { target, messageId: 'forged-teacher-test' });
  assert.equal(forged.status, 403);
  assert.equal(forged.body.code, 'SIGNATURE_INVALID');
  const teacherCandidate = await teacher.call('candidate');
  // [Mochi 2026-09-18] 教室端现在能主动外发了，但只能发「学生预约」。它仍然不能
  // 发通知——缺预约描述的信封在服务层就被拒，这条边界比原来那句「教室端不能主动
  // 外发」更窄也更准：拒绝的是冒充教师下发通知，不是学生说话。
  await rejectCode(() => classroom.call('send', { targetEndpointId: 'teacher-lan-test', body: '教室端不能主动外发通知。', messageId: 'classroom-outbound' }), 'INVALID_REQUEST');
  await rejectCode(() => classroom.call('pair-request', { candidate: teacherCandidate, address: { host: '127.0.0.1', port: teacher.snapshot.http.port } }), 'ROLE_FORBIDDEN');

  console.log('⑤ 解除配对与拉黑是两个不同的服务动作');
  const unpaired = await teacher.call('unpair', { endpointId: 'classroom-lan-test' });
  assert.equal(unpaired.status, 'unpaired');
  assert.equal((await teacher.call('state')).peers.length, 0);
  assert.equal((await teacher.call('state')).blockedPeers.some((row) => row.endpointId === 'classroom-lan-test'), false);
  await rejectCode(() => teacher.call('send', { targetEndpointId: 'classroom-lan-test', body: '解除后不得送达。', messageId: 'notify-unpaired' }), 'PAIRING_REQUIRED');
  const rePairCandidate = await classroom.call('candidate');
  const rePair = await teacher.call('pair-request', { candidate: rePairCandidate, address: { host: '127.0.0.1', port: classroom.snapshot.http.port } });
  await classroom.call('pair-accept', { requestId: rePair.requestId });
  await classroom.call('block', { endpointId: 'teacher-lan-test' });
  assert.equal((await classroom.call('state')).peers.length, 0);
  assert.equal((await classroom.call('state')).blockedPeers.some((row) => row.endpointId === 'teacher-lan-test'), true);
  await rejectCode(() => teacher.call('send', { targetEndpointId: 'classroom-lan-test', body: '拉黑后不得送达。', messageId: 'notify-blocked' }), 'PEER_BLOCKED');
  console.log('⑥ 两个独立进程发现：主信标与组播并行、同 endpoint 去重，且本地 TTL 以收包时间到期');
  const observerPort = await availableUdpPort();
  const senderPort = await availableUdpPort();
  const unusedBroadcastPort = await availableUdpPort();
  discoveryObserver = await LanChild.start({
    dataRoot: join(temporary, 'discovery-observer'), endpointId: 'teacher-discovery-test', role: 'teacher', schoolId: 'demo-school', displayName: '发现教师端',
    discovery: { port: observerPort, targetPort: observerPort, multicastPort: observerPort, multicastInterface: '127.0.0.1', intervalMs: 50, ttlMs: 250 },
  });
  discoverySender = await LanChild.start({
    dataRoot: join(temporary, 'discovery-sender'), endpointId: 'classroom-discovery-test', role: 'classroom', schoolId: 'demo-school', classId: 'g7-2', displayName: '发现教室端',
    // No process listens on unusedBroadcastPort. Discovery below can therefore
    // only arrive through the real multicast membership, not the existing
    // loopback primary-beacon test path.
    discovery: { port: senderPort, targetPort: unusedBroadcastPort, multicastPort: observerPort, multicastInterface: '127.0.0.1', intervalMs: 50, ttlMs: 250 },
  });
  const appeared = await waitUntil(
    () => discoveryObserver.call('discovered'),
    (rows) => rows.some((row) => row.endpointId === 'classroom-discovery-test'),
    'multicast-only discovery appearance',
  );
  const found = appeared.find((row) => row.endpointId === 'classroom-discovery-test');
  assert.equal(found.paired, false);
  assert.equal(found.blocked, false);
  const multicastSeenAt = found.seenAt;
  assert.equal((await discoverySender.call('state')).discovery.status, 'ACTIVE');
  await discoverySender.stop();
  discoverySender = await LanChild.start({
    dataRoot: join(temporary, 'discovery-sender'), endpointId: 'classroom-discovery-test', role: 'classroom', schoolId: 'demo-school', classId: 'g7-2', displayName: '发现教室端',
    discovery: { port: senderPort, targetPort: observerPort, multicastPort: observerPort, multicastInterface: '127.0.0.1', intervalMs: 50, ttlMs: 250 },
  });
  const dualPath = await waitUntil(
    () => discoveryObserver.call('discovered'),
    (rows) => rows.filter((row) => row.endpointId === 'classroom-discovery-test').length === 1
      && rows.find((row) => row.endpointId === 'classroom-discovery-test')?.seenAt > multicastSeenAt,
    'dual-path discovery dedupe',
  );
  assert.equal(dualPath.filter((row) => row.endpointId === 'classroom-discovery-test').length, 1, 'primary beacon and multicast must not duplicate one endpoint candidate');
  clockSkewSender = await LanChild.start({
    dataRoot: join(temporary, 'discovery-clock-skew'), endpointId: 'classroom-clock-skew-test', role: 'classroom', schoolId: 'demo-school', classId: 'g7-3', displayName: '时钟偏差教室端',
  });
  await clockSkewSender.call('beacon', {
    address: { host: '127.0.0.1', port: observerPort },
    expiresAt: Date.now() - 60_000,
  });
  const skewAppeared = await waitUntil(
    () => discoveryObserver.call('discovered'),
    (rows) => rows.some((row) => row.endpointId === 'classroom-clock-skew-test'),
    'clock-skewed discovery appearance',
  );
  assert.equal(skewAppeared.find((row) => row.endpointId === 'classroom-clock-skew-test').paired, false);
  await clockSkewSender.stop();
  clockSkewSender = null;
  const discoveryEvents = await discoveryObserver.call('events', { cursor: 0 });
  assert.equal(discoveryEvents.events.some((event) => event.type === 'discovery'), true);
  const discoveryCandidate = await discoverySender.call('candidate');
  const originalSenderPort = discoverySender.snapshot.http.port;
  const discoveryPair = await discoveryObserver.call('pair-request', {
    candidate: discoveryCandidate,
    address: { host: '127.0.0.1', port: originalSenderPort },
  });
  await discoverySender.call('pair-accept', { requestId: discoveryPair.requestId });
  assert.equal((await discoveryObserver.call('state')).peers[0].address.port, originalSenderPort);
  let refreshedSenderPort = await availableTcpPort();
  if (refreshedSenderPort === originalSenderPort) refreshedSenderPort = await availableTcpPort();
  assert.notEqual(refreshedSenderPort, originalSenderPort);
  await discoverySender.stop();
  discoverySender = await LanChild.start({
    dataRoot: join(temporary, 'discovery-sender'), endpointId: 'classroom-discovery-test', role: 'classroom', schoolId: 'demo-school', classId: 'g7-2', displayName: '发现教室端',
    port: refreshedSenderPort,
    discovery: { port: senderPort, targetPort: observerPort, multicastPort: observerPort, multicastInterface: '127.0.0.1', intervalMs: 50, ttlMs: 250 },
  });
  const refreshed = await waitUntil(
    () => discoveryObserver.call('state'),
    (state) => state.peers.some((row) => row.endpointId === 'classroom-discovery-test' && row.address.port === refreshedSenderPort),
    'verified paired address refresh',
  );
  const refreshedPeer = refreshed.peers.find((row) => row.endpointId === 'classroom-discovery-test');
  assert.equal(refreshedPeer.online, true);
  await discoverySender.stop();
  discoverySender = null;
  await waitUntil(
    () => discoveryObserver.call('discovered'),
    (rows) => rows.every((row) => row.endpointId !== 'classroom-discovery-test'),
    'loopback discovery expiry',
  );
  const expirationEvents = await discoveryObserver.call('events', { cursor: 0 });
  assert.equal(expirationEvents.events.some((event) => event.type === 'discovery-expired'), true);
  const expiredPeer = (await discoveryObserver.call('state')).peers.find((row) => row.endpointId === 'classroom-discovery-test');
  assert.equal(expiredPeer.online, false);
  console.log('LAN two-process tests passed: pairing, signed delivery, ACK loss/restart dedupe, seen receipt, student request (classroom→teacher) and teacher directive roster (teacher→classroom), role/class/signature/unpair/block refusal, directive direction+input bounds, dual-path discovery dedupe/TTL and verified paired-address refresh');
} finally {
  await Promise.allSettled([teacher?.stop(), classroom?.stop(), discoveryObserver?.stop(), discoverySender?.stop(), clockSkewSender?.stop()]);
  await rm(temporary, { recursive: true, force: true });
}
