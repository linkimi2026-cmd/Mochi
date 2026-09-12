// [Mochi 2026-09-09] WO-6 教室端×教师端 LAN 自动互联验收脚本。
//
// 本机双 profile 模拟（两个独立 Node 进程 + 两个独立数据根，等价于教师端
// 与教室端各自的 DSH_HOME）：跑通「开机自动上线 → 30 秒内自动发现 → 教师端
// 一键信任 → 教室端一键确认 → 互发消息收到回执 → 杀掉一端重启自动重连」。
//
// 复跑：node plugins/mochi-lan/test-autodiscovery.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const childProgram = join(dirname(fileURLToPath(import.meta.url)), 'test', 'node.mjs');
const DISCOVERY_DEADLINE_MS = 30_000;
const TEST_TIMEOUT_MS = 8_000;
const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

function waitFor(promise, label, timeout = TEST_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout); }),
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

async function waitUntil(read, predicate, label, timeout = TEST_TIMEOUT_MS, debug = null) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    last = await read();
    if (predicate(last)) return last;
    await pause(35);
  } while (Date.now() < deadline);
  if (debug) console.error(`[diagnostic] ${debug()}`);
  throw new Error(`${label} timed out`);
}

class LanChild {
  constructor(child) {
    this.child = child;
    this.pending = new Map();
    this.nextId = 0;
    this.ready = null;
    this.label = '';
    this.stderrTail = '';
    this.exited = new Promise((resolveExit) => { this.resolveExit = resolveExit; });
  }

  get debugLabel() { return `${this.label}(discovery=${JSON.stringify(this.snapshot?.discovery ?? null)}) stderr=${this.stderrTail.slice(-300)}`; }

  // [Mochi 2026-09-09] WO-6 每个子进程 = 一台独立设备：独立数据根（≈DSH_HOME）、
  // lockedRole、自动身份种子（env 或种子文件），不注入任何显式 identity。
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
        MOCHI_LAN_TEST_AUTO_IDENTITY: '1',
        ...(options.identitySeedEnv === undefined ? {} : { MOCHI_LAN_IDENTITY: JSON.stringify(options.identitySeedEnv) }),
        MOCHI_LAN_TEST_DISCOVERY: '1',
        MOCHI_LAN_TEST_DISCOVERY_PORT: String(options.discovery.port),
        MOCHI_LAN_TEST_BEACON_HOST: '127.0.0.1',
        MOCHI_LAN_TEST_BEACON_PORT: String(options.discovery.targetPort),
        MOCHI_LAN_TEST_BEACON_INTERVAL_MS: String(options.discovery.intervalMs ?? 100),
        MOCHI_LAN_TEST_BEACON_TTL_MS: String(options.discovery.ttlMs ?? 500),
        MOCHI_LAN_TEST_MULTICAST_PORT: String(options.discovery.multicastPort ?? options.discovery.targetPort),
        MOCHI_LAN_TEST_MULTICAST_INTERFACE: '127.0.0.1',
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
          if (message.type === 'ready') { instance.snapshot = message.snapshot; instance.pid = message.pid; instance.label = options.endpointId; resolveReady(instance); continue; }
          if (message.type === 'fatal') { rejectReady(new Error(`child start failed: ${message.code}`)); continue; }
          const pending = instance.pending.get(message.id);
          if (!pending) continue;
          instance.pending.delete(message.id);
          if (message.ok) pending.resolve(message.result);
          else pending.reject(Object.assign(new Error(`${message.error?.code ?? 'UNEXPECTED'}: ${message.error?.message ?? ''}`), { code: message.error?.code ?? 'UNEXPECTED' }));
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; instance.stderrTail = stderr; });
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

async function persistedIdentity(dataRoot) {
  return JSON.parse(await readFile(join(dataRoot, 'mochi-lan', 'state.json'), 'utf8')).identity;
}

const SCHOOL_ID = '嘉兴一中';
const CLASS_ID = '高一（3）班';
// 注意：自动身份引导下 endpointId 由首启随机生成并持久化，断言一律用
// 快照里捕获的真实 endpointId，而不是固定名。

const temporary = await mkdtemp(join(tmpdir(), 'mochi-lan-autodiscovery-'));
const teacherRoot = join(temporary, 'teacher-profile');
const classroomRoot = join(temporary, 'classroom-profile');
const teacherUdp = await availableUdpPort();
const classroomUdp = await availableUdpPort();
let teacher;
let classroom;
try {
  // 教室端走「种子文件」路径（生产落点 = 数据根内 identity-seed.json），
  // 教师端走「环境变量」路径，两条自动身份缝都覆盖。
  await mkdir(classroomRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(classroomRoot, 'identity-seed.json'), `${JSON.stringify({
    schoolId: SCHOOL_ID,
    classId: CLASS_ID,
    displayName: '高一（3）班教室大屏',
  }, null, 2)}\n`, { mode: 0o600 });

  console.log('① 两端开机：无任何登录/表单，自动身份引导 + 密钥对首启生成并持久化');
  const bootAt = Date.now();
  teacher = await LanChild.start({
    dataRoot: teacherRoot, endpointId: 'teacher-e2e-boot', role: 'teacher', schoolId: SCHOOL_ID, displayName: '王老师的办公电脑',
    identitySeedEnv: { schoolId: SCHOOL_ID, displayName: '王老师的办公电脑' },
    discovery: { port: teacherUdp, targetPort: classroomUdp, multicastPort: classroomUdp },
  });
  classroom = await LanChild.start({
    dataRoot: classroomRoot, endpointId: 'classroom-e2e-boot', role: 'classroom', schoolId: SCHOOL_ID, classId: CLASS_ID, displayName: '高一（3）班教室大屏',
    discovery: { port: classroomUdp, targetPort: teacherUdp, multicastPort: teacherUdp },
  });
  assert.equal(teacher.snapshot.configured, true, '教师端身份应自动创建');
  assert.equal(classroom.snapshot.configured, true, '教室端身份应自动创建');
  assert.equal(teacher.snapshot.identity.role, 'teacher');
  assert.equal(classroom.snapshot.identity.role, 'classroom');
  const teacherFingerprint = teacher.snapshot.identity.fingerprint;
  const classroomFingerprint = classroom.snapshot.identity.fingerprint;
  const teacherEndpointId = teacher.snapshot.identity.endpointId;
  const classroomEndpointId = classroom.snapshot.identity.endpointId;
  assert.match(teacherFingerprint, /^sha256:[0-9a-f]{32}$/u);
  assert.match(classroomFingerprint, /^sha256:[0-9a-f]{32}$/u);
  const persistedClassroom = await persistedIdentity(classroomRoot);
  assert.equal(persistedClassroom.fingerprint, classroomFingerprint, '教室端密钥对必须持久化');
  assert.ok(persistedClassroom.privateKey, '持久化身份含私钥 JWK（0600 数据根内）');
  assert.equal(persistedClassroom.classId, CLASS_ID, '教室端身份必须带 classId');

  console.log('② 自动发现：教师端 30 秒内看到教室端，反向亦然，全程未手填 IP');
  const teacherSaw = await waitUntil(
    () => teacher.call('discovered'),
    (rows) => rows.some((row) => row.endpointId === classroomEndpointId && row.fingerprint === classroomFingerprint),
    '教师端发现教室端',
    DISCOVERY_DEADLINE_MS,
    () => `teacher ${teacher.debugLabel} | classroom ${classroom.debugLabel}`,
  );
  const discoverySeconds = Math.round((Date.now() - bootAt) / 100) / 10;
  const seen = teacherSaw.find((row) => row.endpointId === classroomEndpointId);
  assert.equal(seen.role, 'classroom');
  assert.equal(seen.schoolId, SCHOOL_ID);
  assert.equal(seen.classId, CLASS_ID);
  assert.equal(seen.paired, false);
  assert.equal(seen.address.port, classroom.snapshot.http.port, '发现结果自带地址，无需手工配置');
  console.log(`   教师端在开机后约 ${discoverySeconds}s 发现教室端（广播周期 100ms / TTL 500ms 为测试档）`);
  await waitUntil(
    () => classroom.call('discovered'),
    (rows) => rows.some((row) => row.endpointId === teacherEndpointId && row.fingerprint === teacherFingerprint),
    '教室端反向发现教师端',
  );

  console.log('③ 教师端一键信任：一次调用完成指纹复核 + 发起相识');
  const trusted = await teacher.call('trust', { endpointId: classroomEndpointId });
  assert.equal(trusted.status, 'pending');
  assert.equal(trusted.peer.fingerprint, classroomFingerprint);
  const pending = await classroom.call('state');
  assert.equal(pending.pendingPairings.length, 1, '教室端出现待确认卡数据（设备名/角色/指纹）');
  assert.equal(pending.pendingPairings[0].peer.displayName, '王老师的办公电脑');
  assert.equal(pending.pendingPairings[0].peer.role, 'teacher');
  assert.equal(pending.pendingPairings[0].peer.fingerprint, teacherFingerprint);

  console.log('④ 教室端人工按那一下：接受相识（首次信任必须有人确认，红线）');
  await classroom.call('pair-accept', { requestId: pending.pendingPairings[0].requestId });
  const teacherPeers = (await teacher.call('state')).peers;
  const classroomPeers = (await classroom.call('state')).peers;
  assert.equal(teacherPeers.length, 1);
  assert.equal(classroomPeers.length, 1);
  assert.equal(teacherPeers[0].fingerprint, classroomFingerprint);

  console.log('⑤ 互发消息收到回执：通知送达 → 教室端「已看到」→ 教师端签名回执');
  const delivered = await teacher.call('send', { targetEndpointId: classroomEndpointId, body: '请投影今天的班会课件。', messageId: 'auto-notify-1' });
  assert.equal(delivered.delivery, 'ACKNOWLEDGED');
  const classroomInbox = (await classroom.call('state')).inbox;
  assert.equal(classroomInbox.some((row) => row.messageId === 'auto-notify-1'), true);
  const seenReceipt = await classroom.call('seen', { messageId: 'auto-notify-1' });
  assert.equal(seenReceipt.status, 'ACKNOWLEDGED');
  assert.equal((await teacher.call('state')).receipts.some((row) => row.messageId === 'auto-notify-1'), true);

  console.log('⑥ 已信任对端重复一键信任不打扰：返回 already-paired，不新增配对请求');
  const again = await teacher.call('trust', { endpointId: classroomEndpointId });
  assert.equal(again.status, 'already-paired');
  assert.equal((await classroom.call('state')).pendingPairings.length, 0);

  console.log('⑦ 杀掉教室端重启（换端口模拟 IP 漂移）：自动重发现 + 地址自动回写 + 无需重新确认');
  const oldPort = classroom.snapshot.http.port;
  await classroom.stop();
  let restartedPort = await availableTcpPort();
  if (restartedPort === oldPort) restartedPort = await availableTcpPort();
  classroom = await LanChild.start({
    dataRoot: classroomRoot, endpointId: 'classroom-e2e-boot', role: 'classroom', schoolId: SCHOOL_ID, classId: CLASS_ID, displayName: '高一（3）班教室大屏',
    port: restartedPort,
    discovery: { port: classroomUdp, targetPort: teacherUdp, multicastPort: teacherUdp },
  });
  const restartedIdentity = await persistedIdentity(classroomRoot);
  assert.equal(restartedIdentity.fingerprint, classroomFingerprint, '重启后指纹不变（同一身份）');
  const refreshed = await waitUntil(
    () => teacher.call('state'),
    (state) => state.peers.some((row) => row.endpointId === classroomEndpointId && row.online === true && row.address.port === restartedPort),
    '教师端自动重发现并刷新已配对地址',
  );
  assert.equal(refreshed.peers.find((row) => row.endpointId === classroomEndpointId).fingerprint, classroomFingerprint);
  assert.equal((await classroom.call('state')).pendingPairings.length, 0, '已信任对端重启后不再要求重新确认');
  const redelivered = await teacher.call('send', { targetEndpointId: classroomEndpointId, body: '重连后第二条通知。', messageId: 'auto-notify-2' });
  assert.equal(redelivered.delivery, 'ACKNOWLEDGED');
  assert.equal((await classroom.call('state')).inbox.some((row) => row.messageId === 'auto-notify-2'), true);

  console.log(`LAN auto-discovery e2e passed: 自动身份引导（env+种子文件）→ ${discoverySeconds}s 自动发现 → 一键信任 → 人工确认 → 消息+已看到回执 → 重启自动重连与地址漂移回写`);
} finally {
  await Promise.allSettled([teacher?.stop(), classroom?.stop()]);
  await rm(temporary, { recursive: true, force: true });
}
