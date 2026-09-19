import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import dgram from 'node:dgram';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { LAN_HTTP_PATHS, LAN_PROTOCOL_VERSION, LAN_STATE_FILENAME, MochiLanService } from '../lan-service.mjs';

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function projection(identity) {
  return {
    endpointId: identity.endpointId,
    role: identity.role,
    schoolId: identity.schoolId,
    ...(identity.classId === undefined ? {} : { classId: identity.classId }),
    displayName: identity.displayName,
    fingerprint: identity.fingerprint,
  };
}

function signed(identity, privateKey, payload) {
  return { payload, signature: sign(null, Buffer.from(canonical(payload)), createPrivateKey({ key: privateKey, format: 'jwk' })).toString('base64url') };
}

const dataRoot = requireText(process.env.MOCHI_LAN_TEST_ROOT, 'MOCHI_LAN_TEST_ROOT');
const role = requireText(process.env.MOCHI_LAN_TEST_ROLE, 'MOCHI_LAN_TEST_ROLE');
const schoolId = requireText(process.env.MOCHI_LAN_TEST_SCHOOL, 'MOCHI_LAN_TEST_SCHOOL');
const rawClassId = process.env.MOCHI_LAN_TEST_CLASS;
const classId = rawClassId && rawClassId.trim() ? rawClassId.trim() : undefined;
const displayName = requireText(process.env.MOCHI_LAN_TEST_NAME, 'MOCHI_LAN_TEST_NAME');
const endpointId = requireText(process.env.MOCHI_LAN_TEST_ENDPOINT, 'MOCHI_LAN_TEST_ENDPOINT');
const requestedPort = Number(process.env.MOCHI_LAN_TEST_PORT ?? '0');
const discoveryEnabled = process.env.MOCHI_LAN_TEST_DISCOVERY === '1';
const discoveryPort = Number(process.env.MOCHI_LAN_TEST_DISCOVERY_PORT ?? '47832');
const testBeaconHost = process.env.MOCHI_LAN_TEST_BEACON_HOST;
const testBeaconPort = process.env.MOCHI_LAN_TEST_BEACON_PORT === undefined ? undefined : Number(process.env.MOCHI_LAN_TEST_BEACON_PORT);
const testBeaconIntervalMs = process.env.MOCHI_LAN_TEST_BEACON_INTERVAL_MS === undefined ? undefined : Number(process.env.MOCHI_LAN_TEST_BEACON_INTERVAL_MS);
const testBeaconTtlMs = process.env.MOCHI_LAN_TEST_BEACON_TTL_MS === undefined ? undefined : Number(process.env.MOCHI_LAN_TEST_BEACON_TTL_MS);
const testMulticastPort = process.env.MOCHI_LAN_TEST_MULTICAST_PORT === undefined ? undefined : Number(process.env.MOCHI_LAN_TEST_MULTICAST_PORT);
const testMulticastInterface = process.env.MOCHI_LAN_TEST_MULTICAST_INTERFACE;
// [Mochi 2026-09-09] WO-6 自动身份引导测试开关：置位时不注入 identity，
// 让服务自己从 MOCHI_LAN_IDENTITY 环境变量或 identity-seed.json 种子引导。
const autoIdentity = process.env.MOCHI_LAN_TEST_AUTO_IDENTITY === '1';
const lan = new MochiLanService({
  dataRoot,
  bindHost: '127.0.0.1',
  port: requestedPort,
  discoveryEnabled,
  discoveryPort,
  ...(testBeaconHost === undefined ? {} : { testBeaconHost }),
  ...(testBeaconPort === undefined ? {} : { testBeaconPort }),
  ...(testBeaconIntervalMs === undefined ? {} : { testBeaconIntervalMs }),
  ...(testBeaconTtlMs === undefined ? {} : { testBeaconTtlMs }),
  ...(testMulticastPort === undefined ? {} : { testMulticastPort }),
  ...(testMulticastInterface === undefined ? {} : { testMulticastInterface }),
  dropDeliveryAckOnce: process.env.MOCHI_LAN_TEST_DROP_ACK === '1',
  // [Mochi 2026-09-09] WO-6 生产环境由宿主启动配置锁定角色；测试子进程同构注入。
  lockedRole: role,
  ...(autoIdentity ? {} : { identity: { endpointId, role, schoolId, ...(classId === undefined ? {} : { classId }), displayName } }),
});

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function authorization(action, source = 'connection-direct') {
  return lan.authorize(action, source);
}

async function stateIdentity() {
  return JSON.parse(await readFile(join(dataRoot, LAN_STATE_FILENAME), 'utf8')).identity;
}

async function rawMessage({ target, classOverride, forged = false, messageId }) {
  const identity = await stateIdentity();
  const payload = {
    v: LAN_PROTOCOL_VERSION,
    type: 'message',
    messageId: requireText(messageId, 'messageId'),
    contentType: 'NOTIFY',
    createdAt: new Date().toISOString(),
    sender: projection(identity),
    recipient: { endpointId: target.endpointId, schoolId: target.schoolId, classId: classOverride ?? target.classId },
    body: 'test-only forged or wrong-class packet',
  };
  const privateKey = forged ? generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }) : identity.privateKey;
  const response = await fetch(`http://${target.host}:${target.port}${LAN_HTTP_PATHS.message}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signed(identity, privateKey, payload)),
  });
  let body = null;
  try { body = await response.json(); } catch { /* test reports a protocol error below */ }
  return { status: response.status, body };
}

async function sendBeacon({ address, expiresAt } = {}) {
  const target = address && typeof address === 'object' ? address : {};
  const host = requireText(target.host, 'address.host');
  const port = Number(target.port);
  if (host !== '127.0.0.1' || !Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('test beacon target must be loopback UDP');
  const { publicKey: _ignoredPublicKey, ...candidate } = lan.pairingCandidate();
  const httpPort = lan.snapshot().http?.port;
  if (!Number.isSafeInteger(httpPort)) throw new Error('LAN HTTP port is unavailable');
  const packet = Buffer.from(JSON.stringify({
    v: LAN_PROTOCOL_VERSION,
    type: 'beacon',
    ...candidate,
    httpPort,
    expiresAt: expiresAt ?? Date.now() + 5_000,
  }));
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolveSend, rejectSend) => socket.send(packet, port, host, (error) => error ? rejectSend(error) : resolveSend()));
  } finally {
    await new Promise((resolveClose) => socket.close(resolveClose));
  }
  return { sent: true };
}

async function execute(method, args = {}) {
  switch (method) {
    case 'state': return lan.snapshot();
    case 'discovered': return lan.listDiscovered();
    case 'events': return lan.eventsAfter(args.cursor);
    case 'beacon': return sendBeacon(args);
    case 'candidate': return lan.pairingCandidate();
    case 'probe': return lan.probeCandidate(args);
    // [Mochi 2026-09-09] WO-6 一键信任：教师端对发现表中设备一次调用完成信任+发起相识。
    case 'trust': return lan.trustDiscovered({ ...args, authorization: authorization('trust-discovered') });
    case 'pair-request': return lan.requestPairing({ ...args, authorization: authorization('request-pairing') });
    case 'pair-accept': return lan.acceptPairing({ ...args, authorization: authorization('accept-pairing') });
    case 'pair-reject': return lan.rejectPairing({ ...args, authorization: authorization('reject-pairing') });
    case 'block': return lan.blockPeer({ ...args, authorization: authorization('block-peer') });
    case 'unpair': return lan.unpairPeer({ ...args, authorization: authorization('unpair-peer') });
    case 'send': return lan.sendMessage({ ...args, authorization: authorization('send-message', 'dispatch-approved') });
    // [Mochi 2026-09-18] 反向通道：教室端的学生预约。与 send 的差别不只是方向——
    // 学生预约是学生本人在设备上的直接动作，所以令牌来源是 connection-direct，
    // 而 send 走的是模型审批链 dispatch-approved。
    case 'request': return lan.sendRequest({ ...args, authorization: authorization('send-request', 'connection-direct') });
    // [Mochi 2026-09-18] 教师下发处置名册。令牌来源刻意是 dispatch-approved 而不是
    // connection-direct：名册是模型调 skill 生成后发起的对外动作，必须过审批闸，
    // 所以生产环境里根本没有一条 HTTP 路由能铸出这个令牌。
    case 'directive': return lan.sendDirective({ ...args, authorization: authorization('send-directive', 'dispatch-approved') });
    case 'retry': return lan.retryMessage({ ...args, authorization: authorization('retry-message', 'dispatch-approved') });
    case 'seen': return lan.markSeen({ ...args, authorization: authorization('mark-seen') });
    case 'wrong-class': return rawMessage({ ...args, classOverride: args.classId });
    case 'forged-endpoint': return rawMessage({ ...args, forged: true });
    case 'stop': await lan.stop(); return { stopped: true };
    default: throw new Error(`unknown method ${method}`);
  }
}

try {
  await lan.start();
  write({ type: 'ready', pid: process.pid, snapshot: lan.snapshot() });
} catch (error) {
  write({ type: 'fatal', code: error?.code ?? 'START_FAILED' });
  setImmediate(() => process.exit(1));
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  void (async () => {
    let input;
    try {
      input = JSON.parse(line);
      const id = requireText(input.id, 'id');
      const result = await execute(requireText(input.method, 'method'), input.args ?? {});
      write({ id, ok: true, result });
      if (input.method === 'stop') setImmediate(() => process.exit(0));
    } catch (error) {
      write({ id: typeof input?.id === 'string' ? input.id : null, ok: false, error: { code: error?.code ?? 'UNEXPECTED', message: String(error?.message ?? error).slice(0, 300) } });
    }
  })();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void lan.stop().finally(() => process.exit(0)); });
}
