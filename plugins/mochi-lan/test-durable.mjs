import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAN_STATE_FILENAME, lanBroadcastAddresses, lanBroadcastRoutes, MochiLanService } from './lan-service.mjs';

assert.deepEqual(lanBroadcastAddresses({
  en0: [
    { family: 'IPv4', address: '192.168.1.23', netmask: '255.255.255.0', internal: false },
    { family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true },
  ],
  en5: [{ family: 'IPv4', address: '10.20.30.44', netmask: '255.255.0.0', internal: false }],
  tunnel: [{ family: 'IPv4', address: '172.16.1.1', netmask: '255.255.255.255', internal: false }],
}), ['192.168.1.255', '10.20.255.255'], 'discovery targets each usable LAN interface, including wired Ethernet');
assert.deepEqual(lanBroadcastRoutes({
  en0: [{ family: 'IPv4', address: '192.168.1.23', netmask: '255.255.255.0', internal: false }],
  en5: [{ family: 'IPv4', address: '192.168.1.44', netmask: '255.255.255.0', internal: false }],
}), [
  { name: 'en0', address: '192.168.1.23', broadcast: '192.168.1.255' },
  { name: 'en5', address: '192.168.1.44', broadcast: '192.168.1.255' },
], 'adapters sharing a subnet retain separate source-bound beacon routes');

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
    // Occupy the same wildcard address as discovery without SO_REUSEADDR.
    // A loopback-only binding can legitimately coexist on macOS.
    socket.bind(0, '0.0.0.0', () => {
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
  assert.deepEqual(classroom.snapshot().localAddresses, [], 'a loopback-only listener does not advertise a different LAN address');
  const classroomAddress = { host: '127.0.0.1', port: classroom.snapshot().http.port };
  const classroomCandidate = classroom.pairingCandidate();

  console.log('⓪c 探测未配置身份的候选时，保留远端 409 错误码供界面说明');
  const unconfiguredClassroom = new MochiLanService({
    dataRoot: join(temporary, 'unconfigured-classroom'), bindHost: '127.0.0.1', port: 0,
    discoveryEnabled: false, lockedRole: 'classroom',
  });
  try {
    const unconfiguredState = await unconfiguredClassroom.start();
    await assert.rejects(
      () => teacher.probeCandidate({ address: { host: '127.0.0.1', port: unconfiguredState.http.port } }),
      (error) => error?.code === 'IDENTITY_REQUIRED' && error?.httpStatus === 409,
    );
  } finally {
    await unconfiguredClassroom.stop();
  }

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

  console.log('⓪a 活动网卡没有可定向广播 IPv4 且组播也不可用时，自动发现降级但保留手动地址服务');
  const noLanInterfaces = new MochiLanService({
    dataRoot: join(temporary, 'no-lan-interfaces'), bindHost: '127.0.0.1', port: 0,
    discoveryEnabled: true, testNetworkInterfaces: () => ({}), testMulticastInterface: '203.0.113.17',
    identity: identity('teacher', 'no-lan-interfaces-teacher', '无可广播网卡教师端'),
  });
  try {
    const state = await noLanInterfaces.start();
    assert.equal(state.started, true);
    assert.equal(state.discovery.status, 'DEGRADED', 'no UDP send path must not be reported as ACTIVE');
    assert.equal(typeof state.discovery.errorCode, 'string');
    const health = await fetch(`http://127.0.0.1:${state.http.port}/health`);
    assert.equal(health.status, 200, 'manual address/HTTP diagnostics remain available while automatic discovery degrades');
  } finally {
    await noLanInterfaces.stop();
  }

  console.log('⓪a 本机地址随网线地址变化重算，且只公开有用的 IPv4、接口名和实际监听端口');
  let simulatedInterfaces = {
    en5: [{ family: 'IPv4', address: '10.20.30.44', netmask: '255.255.255.0', internal: false, mac: 'private-mac' }],
    lo0: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
  };
  const addressProjection = new MochiLanService({
    dataRoot: join(temporary, 'address-projection'), bindHost: '0.0.0.0', port: 0,
    discoveryEnabled: false, testNetworkInterfaces: () => simulatedInterfaces,
  });
  try {
    const started = await addressProjection.start();
    assert.deepEqual(started.localAddresses, [{ name: 'en5', address: '10.20.30.44', port: started.http.port }]);
    assert.equal(JSON.stringify(started.localAddresses).includes('private-mac'), false);
    simulatedInterfaces = { en7: [{ family: 'IPv4', address: '10.99.1.8', netmask: '255.255.255.0', internal: false }] };
    assert.deepEqual(addressProjection.snapshot().localAddresses, [{ name: 'en7', address: '10.99.1.8', port: started.http.port }]);
  } finally {
    await addressProjection.stop();
  }

  console.log('⓪a 网卡上线、拔掉、再上线时自动发现会降级并自行恢复');
  let liveInterfaces = {};
  const hotplugPort = await availableUdpPort();
  const hotplug = new MochiLanService({
    dataRoot: join(temporary, 'hotplug'), bindHost: '127.0.0.1', port: 0,
    discoveryEnabled: true, discoveryPort: hotplugPort, testBeaconIntervalMs: 50,
    testNetworkInterfaces: () => liveInterfaces,
    identity: identity('teacher', 'hotplug-teacher', '有线网卡热插拔教师端'),
  });
  try {
    assert.equal((await hotplug.start()).discovery.status, 'DEGRADED');
    // Loopback is declared as an external adapter only inside this test so
    // membership and source binding are deterministic on a single machine.
    liveInterfaces = { fakeEthernet: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: false }] };
    let deadline = Date.now() + 2_000;
    while (hotplug.snapshot().discovery.status !== 'ACTIVE' && Date.now() < deadline) await pause(25);
    assert.equal(hotplug.snapshot().discovery.status, 'ACTIVE');
    liveInterfaces = {};
    deadline = Date.now() + 2_000;
    while (hotplug.snapshot().discovery.status !== 'DEGRADED' && Date.now() < deadline) await pause(25);
    assert.equal(hotplug.snapshot().discovery.status, 'DEGRADED');
    liveInterfaces = { fakeEthernet: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: false }] };
    deadline = Date.now() + 2_000;
    while (hotplug.snapshot().discovery.status !== 'ACTIVE' && Date.now() < deadline) await pause(25);
    assert.equal(hotplug.snapshot().discovery.status, 'ACTIVE');
  } finally {
    await hotplug.stop();
  }

  console.log('⓪a 双网卡同广播地址仍各自发信标；单通道失败不会锁死另一通道');
  const mock = { sockets: [], sends: [], failBroadcast: true };
  let multiNicInterfaces = {
    en0: [{ family: 'IPv4', address: '192.0.2.10', netmask: '255.255.255.0', internal: false }],
    en5: [{ family: 'IPv4', address: '192.0.2.11', netmask: '255.255.255.0', internal: false }],
  };
  class MockUdpSocket extends EventEmitter {
    constructor() {
      super();
      this.memberships = new Set();
      this.dropped = [];
      this.closed = false;
      mock.sockets.push(this);
    }
    bind(port, host, callback) {
      this.source = host;
      queueMicrotask(() => { this.emit('listening'); callback?.(); });
    }
    addMembership(_group, address) { this.memberships.add(address); }
    dropMembership(_group, address) { this.memberships.delete(address); this.dropped.push(address); }
    setBroadcast() {}
    setTTL() {}
    setMulticastTTL() {}
    setMulticastLoopback() {}
    setMulticastInterface(address) { this.multicastInterface = address; }
    send(_payload, _port, host, callback) {
      const broadcast = host === '192.0.2.255';
      const row = { source: this.source, host, multicastInterface: this.multicastInterface, ok: !broadcast || !mock.failBroadcast };
      mock.sends.push(row);
      queueMicrotask(() => callback(row.ok ? null : Object.assign(new Error('mock broadcast failure'), { code: 'EHOSTUNREACH' })));
    }
    close(callback) { this.closed = true; callback?.(); }
  }
  const createSocket = dgram.createSocket;
  dgram.createSocket = () => new MockUdpSocket();
  let multiNic;
  try {
    multiNic = new MochiLanService({
      dataRoot: join(temporary, 'multi-nic'), bindHost: '127.0.0.1', port: 0,
      discoveryEnabled: true, discoveryPort: 47832, testBeaconIntervalMs: 50,
      testNetworkInterfaces: () => multiNicInterfaces,
      identity: identity('teacher', 'multi-nic-teacher', '双网卡教师端'),
    });
    assert.equal((await multiNic.start()).discovery.status, 'ACTIVE', 'working multicast keeps discovery active while broadcast fails');
    const listener = mock.sockets.find((socket) => socket.source === '0.0.0.0');
    assert.deepEqual([...listener.memberships].sort(), ['192.0.2.10', '192.0.2.11']);
    assert.deepEqual(mock.sends.filter((row) => row.host === '192.0.2.255').map((row) => row.source).sort(), ['192.0.2.10', '192.0.2.11']);
    assert.deepEqual(mock.sends.filter((row) => row.host !== '192.0.2.255').map((row) => row.multicastInterface).sort(), ['192.0.2.10', '192.0.2.11']);
    mock.failBroadcast = false;
    let deadline = Date.now() + 2_000;
    while (!mock.sends.some((row) => row.host === '192.0.2.255' && row.ok) && Date.now() < deadline) await pause(25);
    assert.equal(mock.sends.some((row) => row.host === '192.0.2.255' && row.ok), true, 'broadcast retries after a transient failure');
    multiNicInterfaces = { en5: multiNicInterfaces.en5 };
    deadline = Date.now() + 2_000;
    while (!listener.dropped.includes('192.0.2.10') && Date.now() < deadline) await pause(25);
    assert.deepEqual([...listener.memberships], ['192.0.2.11'], 'removed adapter leaves the multicast group');
    assert.equal(mock.sockets.find((socket) => socket.source === '192.0.2.10')?.closed, true, 'removed adapter releases its source-bound sender');
  } finally {
    if (multiNic) await multiNic.stop();
    dgram.createSocket = createSocket;
  }

  console.log('⓪a UDP 发现端口不可用时，HTTP/手动地址路径仍可启动并公开降级状态');
  const occupied = await occupyUdpPort();
  const degraded = new MochiLanService({
    dataRoot: join(temporary, 'discovery-degraded'), bindHost: '127.0.0.1', port: 0,
    discoveryEnabled: true, discoveryPort: occupied.port,
    testBeaconIntervalMs: 50,
    testBeaconHost: '127.0.0.1', testBeaconPort: occupied.port,
    identity: identity('teacher', 'degraded-teacher', '发现降级教师端'),
  });
  let occupiedClosed = false;
  try {
    const degradedState = await degraded.start();
    assert.equal(degradedState.started, true);
    assert.equal(degradedState.discovery.status, 'DEGRADED');
    assert.equal(typeof degradedState.discovery.errorCode, 'string');
    const health = await fetch(`http://127.0.0.1:${degradedState.http.port}/health`);
    assert.equal(health.status, 200);
    await pause(120);
    assert.equal(degraded.snapshot().discovery.status, 'DEGRADED', 'retry must not falsely report discovery while UDP remains occupied');
    await new Promise((resolveClose) => occupied.socket.close(resolveClose));
    occupiedClosed = true;
    const deadline = Date.now() + 2_000;
    while (degraded.snapshot().discovery.status !== 'ACTIVE' && Date.now() < deadline) await pause(25);
    assert.equal(degraded.snapshot().discovery.status, 'ACTIVE', 'discovery recovers without an app restart once UDP becomes available');
    assert.equal(degraded.snapshot().discovery.errorCode, null);
  } finally {
    await degraded.stop();
    if (!occupiedClosed) await new Promise((resolveClose) => occupied.socket.close(resolveClose));
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
  const initialCode = classroom.snapshot().pairingCode.code;
  assert.match(initialCode, /^\d{6}$/u);
  const wrongCode = initialCode === '000000' ? '000001' : '000000';
  await expectCode(() => teacher.requestPairing({
    candidate: classroomCandidate,
    address: classroomAddress,
    pairingCode: wrongCode,
    authorization: authorization(teacher, 'request-pairing'),
  }), 'PAIRING_CODE_INVALID');
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
    pairingCode: initialCode,
    authorization: authorization(teacher, 'request-pairing'),
  });
  assert.notEqual(classroom.snapshot().pairingCode.code, initialCode, '成功使用后码轮换');
  await classroom.acceptPairing({ requestId: pairing.requestId, authorization: authorization(classroom, 'accept-pairing') });
  assert.equal(teacher.snapshot().peers.length, 1);
  assert.equal(classroom.snapshot().peers.length, 1);

  console.log('①a 同一短码并发提交只允许一个签名教师请求消耗并轮换');
  const raceRoot = join(temporary, 'pairing-code-race-classroom');
  const raceClassroom = new MochiLanService({
    dataRoot: raceRoot, bindHost: '127.0.0.1', port: 0, discoveryEnabled: false,
    identity: identity('classroom', 'race-classroom', '并发测试教室', { classId: 'g12-race' }),
  });
  const raceTeachers = ['race-teacher-a', 'race-teacher-b'].map((id) => new MochiLanService({
    dataRoot: join(temporary, id), bindHost: '127.0.0.1', port: 0, discoveryEnabled: false,
    identity: identity('teacher', id, id),
  }));
  try {
    await raceClassroom.start();
    await Promise.all(raceTeachers.map((service) => service.start()));
    const raceAddress = { host: '127.0.0.1', port: raceClassroom.snapshot().http.port };
    const raceCandidate = raceClassroom.pairingCandidate();
    const raceCode = raceClassroom.snapshot().pairingCode.code;
    const raceResults = await Promise.allSettled(raceTeachers.map((service) => service.requestPairing({
      candidate: raceCandidate, address: raceAddress, pairingCode: raceCode,
      authorization: authorization(service, 'request-pairing'),
    })));
    assert.equal(raceResults.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(raceResults.filter((result) => result.status === 'rejected' && result.reason?.code === 'PAIRING_CODE_INVALID').length, 1);
    assert.equal(raceClassroom.snapshot().pendingPairings.length, 1);
  } finally {
    await Promise.all([raceClassroom.stop(), ...raceTeachers.map((service) => service.stop())]);
  }

  const activeCode = classroom.snapshot().pairingCode.code;
  const invalidCode = activeCode === '000000' ? '000001' : '000000';
  const codeProbeUrl = `http://127.0.0.1:${classroom.snapshot().http.port}/v1/pair/code/probe`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(codeProbeUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: invalidCode, nonce: `bad-${attempt}` }) });
    assert.equal(response.status, 200, '搜索拒绝以签名回执返回，供候选身份验证');
    const { envelope: reply } = await response.json();
    assert.equal(reply.payload.type, 'pairing-code-rejected');
    assert.equal(reply.payload.code, 'PAIRING_CODE_INVALID');
    assert.equal(reply.payload.nonce, `bad-${attempt}`);
  }
  const limited = await fetch(codeProbeUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: invalidCode, nonce: 'bad-six' }) });
  assert.equal(limited.status, 200, '限额结果也必须通过签名回执返回');
  const { envelope: limitedReply } = await limited.json();
  assert.equal(limitedReply.payload.type, 'pairing-code-rate-limited', '搜索挑战应有独立限额，阻止暴力猜码');
  assert.equal(limitedReply.payload.code, 'PAIRING_CODE_RATE_LIMITED');
  const badPairingCode = classroom.snapshot().pairingCode.code === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expectCode(() => teacher.requestPairing({ candidate: classroomCandidate, address: classroomAddress, pairingCode: badPairingCode, authorization: authorization(teacher, 'request-pairing') }), 'PAIRING_CODE_INVALID');
  }
  await expectCode(() => teacher.requestPairing({ candidate: classroomCandidate, address: classroomAddress, pairingCode: badPairingCode, authorization: authorization(teacher, 'request-pairing') }), 'PAIRING_CODE_RATE_LIMITED');

  const expiring = new MochiLanService({
    dataRoot: join(temporary, 'pairing-code-expiry'), bindHost: '127.0.0.1', port: 0,
    discoveryEnabled: false, testPairingCodeTtlMs: 25,
    identity: identity('classroom', 'code-expiry-classroom', '短码过期测试', { classId: 'g12-1' }),
  });
  try {
    const state = await expiring.start();
    await pause(35);
    const expired = await fetch(`http://127.0.0.1:${state.http.port}/v1/pair/code/probe`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: state.pairingCode.code, nonce: 'expired-code' }),
    });
    assert.equal(expired.status, 200, '过期短码通过签名回执拒绝');
    const { envelope: expiredReply } = await expired.json();
    assert.equal(expiredReply.payload.type, 'pairing-code-rejected');
    assert.equal(expiredReply.payload.code, 'PAIRING_CODE_INVALID');
  } finally {
    await expiring.stop();
  }

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
  const originalClassroomIdentity = classroom.snapshot().identity;
  const stableTeacherIdentity = teacher.snapshot().identity;
  await classroom.sendRequest({
    targetEndpointId: 'teacher-durable', body: '改班前预约，请核对原班级。',
    request: { student: '张同学', kind: 'appointment', topic: '函数', slot: '周三课后' },
    messageId: 'request-before-class-change', expectedSender: originalClassroomIdentity,
    expectedPeer: stableTeacherIdentity, authorization: authorization(classroom, 'send-request'),
  });
  await classroom.configureIdentity(
    identity('classroom', 'classroom-durable', '高三二班教室', { classId: 'g12-2' }),
    { authorization: authorization(classroom, 'configure-identity') },
  );
  const changedClassroomCandidate = classroom.pairingCandidate();
  const changedClassroomAddress = { host: '127.0.0.1', port: classroom.snapshot().http.port };
  const peerChangedPairing = await teacher.requestPairing({
    candidate: changedClassroomCandidate, address: changedClassroomAddress,
    authorization: authorization(teacher, 'request-pairing'),
  });
  await classroom.acceptPairing({ requestId: peerChangedPairing.requestId, authorization: authorization(classroom, 'accept-pairing') });
  const oldRequestResponse = { replyToMessageId: 'request-before-class-change', decision: 'confirmed', slot: '周三课后' };
  await assert.rejects(
    () => teacher.sendResponse({
      targetEndpointId: 'classroom-durable', body: '旧班预约不能送到新班。', response: oldRequestResponse,
      messageId: 'response-stale-class-peer', expectedSender: stableTeacherIdentity,
      expectedPeer: originalClassroomIdentity, authorization: authorization(teacher, 'send-response'),
    }),
    (error) => error?.code === 'LAN_APPROVAL_STALE' && error?.lanDeliveryPhase === 'pre-send',
  );
  await assert.rejects(
    () => teacher.sendResponse({
      targetEndpointId: 'classroom-durable', body: '无确认绑定也不能回复旧班预约。', response: oldRequestResponse,
      messageId: 'response-stale-class-request', authorization: authorization(teacher, 'send-response'),
    }),
    (error) => error?.code === 'RESPONSE_REQUEST_MISMATCH' && error?.lanDeliveryPhase === 'pre-send',
  );
  assert.equal(teacher.snapshot().outbox.some((row) => row.messageId.startsWith('response-stale-class-')), false);
  assert.equal(classroom.snapshot().inbox.some((row) => row.response?.replyToMessageId === 'request-before-class-change'), false);
  await teacher.configureIdentity(
    identity('teacher', 'teacher-durable', '新班王老师'),
    { authorization: authorization(teacher, 'configure-identity') },
  );
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
  await assert.rejects(
    () => classroom.sendRequest({
      targetEndpointId: 'teacher-durable', body: '旧教室身份不能继续送预约。',
      request: { student: '李明', kind: 'question', topic: '函数' }, messageId: 'request-stale-sender',
      expectedSender: originalInbox.recipient, expectedPeer: teacher.snapshot().identity,
      authorization: authorization(classroom, 'send-request'),
    }),
    (error) => error?.code === 'LAN_APPROVAL_STALE' && error?.lanDeliveryPhase === 'pre-send',
  );
  assert.equal(classroom.snapshot().outbox.some((row) => row.messageId === 'request-stale-sender'), false);

  console.log('⑥ 原教师同 endpointId 换公钥重新配对后，旧通知不能向新身份确认');
  await teacher.sendMessage({
    targetEndpointId: 'classroom-durable',
    body: '同端点旧公钥通知。',
    messageId: 'recipient-before-teacher-rekey',
    authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
  });
  const oldTeacherIdentity = teacher.snapshot().identity;
  const oldTeacherFingerprint = oldTeacherIdentity.fingerprint;
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
  const replacementInboxBeforeRequest = replacementTeacher.snapshot().inbox.length;
  await assert.rejects(
    () => classroom.sendRequest({
      targetEndpointId: 'teacher-durable', body: '确认后教师同端点换密钥，不能误送新教师。',
      request: { student: '李明', kind: 'appointment', topic: '二次函数', slot: '周五课后' },
      messageId: 'request-before-teacher-rekey', expectedSender: classroom.snapshot().identity,
      expectedPeer: oldTeacherIdentity, authorization: authorization(classroom, 'send-request'),
    }),
    (error) => error?.code === 'LAN_APPROVAL_STALE' && error?.lanDeliveryPhase === 'pre-send',
  );
  assert.equal(classroom.snapshot().outbox.some((row) => row.messageId === 'request-before-teacher-rekey'), false);
  assert.equal(replacementTeacher.snapshot().inbox.length, replacementInboxBeforeRequest);
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

  console.log('⑥a 预约回复与教师已看到状态在进程中断后恢复，并可按原消息 ID 幂等重试');
  await classroom.sendRequest({
    targetEndpointId: 'teacher-durable',
    body: '请讲解二次函数。',
    request: { student: '李明', kind: 'appointment', topic: '二次函数', slot: '周五课后' },
    messageId: 'durable-request-recovery',
    expectedSender: classroom.snapshot().identity, expectedPeer: replacementTeacher.snapshot().identity,
    authorization: authorization(classroom, 'send-request'),
  });
  await replacementTeacher.markSeen({ messageId: 'durable-request-recovery', authorization: authorization(replacementTeacher, 'mark-seen') });
  const durableDecision = { replyToMessageId: 'durable-request-recovery', decision: 'rescheduled', slot: '下周一课后' };
  await replacementTeacher.sendResponse({
    targetEndpointId: 'classroom-durable', body: '建议改期。', response: durableDecision,
    messageId: 'durable-response-recovery', expectedSender: replacementTeacher.snapshot().identity,
    expectedPeer: classroom.snapshot().identity, authorization: authorization(replacementTeacher, 'send-response'),
  });
  await replacementTeacher.stop();
  const interruptedState = await persisted(join(temporary, 'teacher-rekey'));
  interruptedState.outbox['durable-response-recovery'].delivery = 'PENDING';
  delete interruptedState.inbox['durable-request-recovery'].seenReceipt;
  await writeFile(join(temporary, 'teacher-rekey', LAN_STATE_FILENAME), `${JSON.stringify(interruptedState)}\n`, { encoding: 'utf8', mode: 0o600 });
  replacementTeacher = new MochiLanService({
    dataRoot: join(temporary, 'teacher-rekey'), bindHost: '127.0.0.1', port: 0, discoveryEnabled: false,
    identity: identity('teacher', 'teacher-durable', '新密钥王老师'),
  });
  await replacementTeacher.start();
  let recoveredTeacherState = replacementTeacher.snapshot();
  assert.equal(recoveredTeacherState.outbox.find((row) => row.messageId === 'durable-response-recovery')?.delivery, 'UNKNOWN');
  assert.equal(recoveredTeacherState.inbox.find((row) => row.messageId === 'durable-request-recovery')?.seenReceipt, 'UNKNOWN');
  await replacementTeacher.sendResponse({
    targetEndpointId: 'classroom-durable', body: '建议改期。', response: durableDecision,
    messageId: 'durable-response-recovery', expectedSender: replacementTeacher.snapshot().identity,
    expectedPeer: classroom.snapshot().identity, authorization: authorization(replacementTeacher, 'send-response'),
  });
  await replacementTeacher.markSeen({ messageId: 'durable-request-recovery', authorization: authorization(replacementTeacher, 'mark-seen') });
  recoveredTeacherState = replacementTeacher.snapshot();
  assert.equal(recoveredTeacherState.outbox.find((row) => row.messageId === 'durable-response-recovery')?.delivery, 'ACKNOWLEDGED');
  assert.equal(recoveredTeacherState.inbox.find((row) => row.messageId === 'durable-request-recovery')?.seenReceipt, 'ACKNOWLEDGED');
  const recoveredClassroomState = classroom.snapshot();
  assert.equal(recoveredClassroomState.inbox.find((row) => row.messageId === 'durable-response-recovery')?.response.replyToMessageId, 'durable-request-recovery');
  assert.equal(recoveredClassroomState.receipts.find((row) => row.messageId === 'durable-request-recovery')?.from.endpointId, 'teacher-durable');

  console.log('⑥b 教师身份变化并重新配对后，旧身份收到的预约不能由新身份回复');
  // Restart chose a new ephemeral HTTP port; refresh the signed pairing
  // address before sending a fresh classroom request.
  const restartedPairing = await replacementTeacher.requestPairing({
    candidate: classroom.pairingCandidate(),
    address: { host: '127.0.0.1', port: classroom.snapshot().http.port },
    authorization: authorization(replacementTeacher, 'request-pairing'),
  });
  await classroom.acceptPairing({ requestId: restartedPairing.requestId, authorization: authorization(classroom, 'accept-pairing') });
  await classroom.sendRequest({
    targetEndpointId: 'teacher-durable', body: '请安排讲解立体几何。',
    request: { student: '王小明', kind: 'appointment', topic: '立体几何', slot: '周二课后' },
    messageId: 'request-before-teacher-identity-change', expectedSender: classroom.snapshot().identity,
    expectedPeer: replacementTeacher.snapshot().identity, authorization: authorization(classroom, 'send-request'),
  });
  const staleRequest = replacementTeacher.snapshot().inbox.find((row) => row.messageId === 'request-before-teacher-identity-change');
  assert.equal(staleRequest?.recipient?.displayName, '新密钥王老师');
  await replacementTeacher.configureIdentity(
    identity('teacher', 'teacher-durable', '调任王老师'),
    { authorization: authorization(replacementTeacher, 'configure-identity') },
  );
  const identityChangedPairing = await replacementTeacher.requestPairing({
    candidate: classroom.pairingCandidate(),
    address: { host: '127.0.0.1', port: classroom.snapshot().http.port },
    authorization: authorization(replacementTeacher, 'request-pairing'),
  });
  await classroom.acceptPairing({ requestId: identityChangedPairing.requestId, authorization: authorization(classroom, 'accept-pairing') });
  const classroomInboxBeforeStaleReply = classroom.snapshot().inbox.length;
  await assert.rejects(
    () => replacementTeacher.sendResponse({
      targetEndpointId: 'classroom-durable', body: '误回旧教师身份预约。',
      response: { replyToMessageId: 'request-before-teacher-identity-change', decision: 'confirmed', slot: '周二课后' },
      messageId: 'response-after-teacher-identity-change',
      authorization: authorization(replacementTeacher, 'send-response'),
    }),
    (error) => error?.code === 'RESPONSE_REQUEST_MISMATCH' && error?.lanDeliveryPhase === 'pre-send',
  );
  assert.equal(replacementTeacher.snapshot().outbox.some((row) => row.messageId === 'response-after-teacher-identity-change'), false);
  assert.equal(classroom.snapshot().inbox.length, classroomInboxBeforeStaleReply);

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
