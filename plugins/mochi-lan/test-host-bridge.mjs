import assert from 'node:assert/strict';
import { LAN_HOST_ROUTES, installLanHostBridge } from './host-bridge.mjs';

const registrations = new Map();
const calls = [];
const lan = {
  snapshot: () => ({ configured: true, lockedRole: 'teacher', identity: { endpointId: 'teacher-1', role: 'teacher', schoolId: 'demo-school', displayName: '王老师', fingerprint: 'sha256:demo' } }),
  listDiscovered: () => [{ endpointId: 'classroom-1', role: 'classroom', schoolId: 'demo-school', classId: 'g7-1', displayName: '七一班', fingerprint: 'sha256:classroom', address: { host: '127.0.0.1', port: 47_832 } }],
  eventsAfter: (cursor) => ({ cursor: 4, events: [{ cursor: 4, type: 'state', after: cursor }] }),
  authorize(action, source) {
    const authorization = Object.freeze({ action, source });
    calls.push(['authorize', action, source, authorization]);
    return authorization;
  },
  async configureIdentity(identity, options) { calls.push(['configureIdentity', identity, options]); return this.snapshot(); },
  async probeCandidate(input) { calls.push(['probeCandidate', input]); return { candidate: input.address }; },
  async requestPairing(input) { calls.push(['requestPairing', input]); return { requestId: 'pair-1', status: 'pending' }; },
  async findByPairingCode(code) { calls.push(['findByPairingCode', code]); return []; },
  async acceptPairing(input) { calls.push(['acceptPairing', input]); return { status: 'paired' }; },
  async rejectPairing(input) { calls.push(['rejectPairing', input]); return { status: 'rejected' }; },
  async unpairPeer(input) { calls.push(['unpairPeer', input]); return { status: 'unpaired' }; },
  async recoverPairedAddress(input) { calls.push(['recoverPairedAddress', input]); return { status: 'updated' }; },
  async blockPeer(input) { calls.push(['blockPeer', input]); return { status: 'blocked' }; },
  async unblockPeer(input) { calls.push(['unblockPeer', input]); return { status: 'unblocked' }; },
  async markSeen(input) { calls.push(['markSeen', input]); return { status: 'ACKNOWLEDGED' }; },
  // 两个外发方向分开记：教师通知（走 dispatch 审批）与学生预约（本机直接动作）。
  async sendMessage(input) { calls.push(['sendMessage', input]); return { messageId: 'notify-1', delivery: 'ACKNOWLEDGED' }; },
  async sendRequest(input) { calls.push(['sendRequest', input]); return { messageId: 'request-1', delivery: 'ACKNOWLEDGED' }; },
  async sendResponse(input) { calls.push(['sendResponse', input]); return { messageId: 'response-1', delivery: 'ACKNOWLEDGED' }; },
};

const dispose = installLanHostBridge({
  connection: {
    fetch: {
      register(route) {
        assert.equal(registrations.has(route.path), false, `duplicate ${route.path}`);
        registrations.set(route.path, route);
        return () => registrations.delete(route.path);
      },
    },
  },
}, lan);

async function request(route, method, value, suffix = '') {
  const target = `http://host.invalid${route}${suffix}`;
  const init = { method, headers: {} };
  if (value !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(value);
  }
  return registrations.get(route).fetch(new Request(target, init));
}

console.log('① 固定路由：状态、发现、事件和受控写操作全部走 Connection fetch.register');
assert.deepEqual([...registrations.keys()].sort(), Object.values(LAN_HOST_ROUTES).sort());
for (const route of registrations.values()) {
  assert.equal(route.requestBody, 'buffered');
  assert.equal(Array.isArray(route.methods), true);
}
// Only these two human-initiated routes can send from the browser. Teacher
// notices and directives must still pass the dispatch approval path.
assert.deepEqual(
  Object.values(LAN_HOST_ROUTES).filter((route) => route.endsWith('/send')).sort(),
  [LAN_HOST_ROUTES.requestSend, LAN_HOST_ROUTES.responseSend].sort(),
  '浏览器仅允许学生预约和教师回复两种人工外发',
);

const state = await request(LAN_HOST_ROUTES.state, 'GET');
assert.equal(state.status, 200);
assert.equal((await state.json()).identity.endpointId, 'teacher-1');
const discovery = await request(LAN_HOST_ROUTES.discovery, 'GET');
assert.equal((await discovery.json()).candidates.length, 1);
const events = await request(LAN_HOST_ROUTES.events, 'GET', undefined, '?cursor=3');
assert.equal((await events.json()).events[0].after, 3);
const malformedCursor = await request(LAN_HOST_ROUTES.events, 'GET', undefined, '?cursor=-1');
assert.deepEqual(await malformedCursor.json(), { code: 'INVALID_REQUEST' });

console.log('② 设置路由只接受窄 JSON；客户端不能提交 role 或 userConfirmed');
const identity = { endpointId: 'teacher-1', schoolId: 'demo-school', displayName: '王老师' };
const configured = await request(LAN_HOST_ROUTES.identity, 'POST', { identity });
assert.equal(configured.status, 200);
const configureCall = calls.find(([name]) => name === 'configureIdentity');
assert.deepEqual(configureCall[1], identity);
assert.equal(configureCall[2].authorization.source, 'connection-direct');
const beforeBad = calls.length;
const badIdentity = await request(LAN_HOST_ROUTES.identity, 'POST', { identity, userConfirmed: true });
assert.equal(badIdentity.status, 400);
assert.deepEqual(await badIdentity.json(), { code: 'INVALID_REQUEST' });
assert.equal(calls.length, beforeBad);
const beforeRole = calls.length;
const badRole = await request(LAN_HOST_ROUTES.identity, 'POST', { ...identity, role: 'classroom' });
assert.equal(badRole.status, 400);
assert.deepEqual(await badRole.json(), { code: 'INVALID_REQUEST' });
assert.equal(calls.length, beforeRole);

console.log('③ 配对、拉黑和已看到使用服务侧一次性授权；不接受浏览器传入授权');
const candidate = { endpointId: 'classroom-1', role: 'classroom', schoolId: 'demo-school', classId: 'g7-1', displayName: '七一班', fingerprint: 'sha256:classroom', publicKey: { kty: 'OKP', crv: 'Ed25519', x: 'example' } };
const address = { host: '127.0.0.1', port: 47_832 };
assert.equal((await request(LAN_HOST_ROUTES.pairProbe, 'POST', { address })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.pairRequest, 'POST', { candidate, address })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.pairCodeSearch, 'POST', { code: '123456' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.pairAccept, 'POST', { requestId: 'pair-1' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.pairReject, 'POST', { requestId: 'pair-1' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.peerUnpair, 'POST', { endpointId: 'classroom-1' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.peerRecoverAddress, 'POST', { endpointId: 'classroom-1', address })).status, 200);
const recoverCall = calls.find(([name]) => name === 'recoverPairedAddress');
assert.deepEqual(recoverCall[1].address, address);
assert.equal(recoverCall[1].authorization.action, 'recover-peer-address');
const beforeBadRecovery = calls.length;
assert.deepEqual(await (await request(LAN_HOST_ROUTES.peerRecoverAddress, 'POST', { endpointId: 'classroom-1', address, publicKey: candidate.publicKey })).json(), { code: 'INVALID_REQUEST' });
assert.equal(calls.length, beforeBadRecovery, 'browser cannot replace the pinned public key');
assert.equal((await request(LAN_HOST_ROUTES.peerBlock, 'POST', { endpointId: 'classroom-1' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.peerUnblock, 'POST', { endpointId: 'classroom-1' })).status, 200);
const invalidUnblock = await request(LAN_HOST_ROUTES.peerUnblock, 'POST', { endpointId: 'classroom-1', userConfirmed: true });
assert.equal(invalidUnblock.status, 400, 'browser confirmation claims cannot bypass the narrow route schema');
assert.equal((await request(LAN_HOST_ROUTES.messageSeen, 'POST', { messageId: 'message-1' })).status, 200);
for (const [name, input] of calls.filter(([name]) => ['requestPairing', 'acceptPairing', 'rejectPairing', 'unpairPeer', 'recoverPairedAddress', 'blockPeer', 'unblockPeer', 'markSeen'].includes(name))) {
  assert.equal(input.authorization.source, 'connection-direct', `${name} must receive a DSH-side authorization`);
}

console.log('④ 学生预约与教师回复绑定确认时的双方身份，不接受浏览器自报角色');
const classroomIdentity = {
  endpointId: 'classroom-1', role: 'classroom', schoolId: 'demo-school', classId: 'g7-1',
  displayName: '七一班', fingerprint: `sha256:${'1'.repeat(32)}`,
};
const teacherIdentity = {
  endpointId: 'teacher-1', role: 'teacher', schoolId: 'demo-school',
  displayName: '王老师', fingerprint: `sha256:${'2'.repeat(32)}`,
};
const sentRequest = await request(LAN_HOST_ROUTES.requestSend, 'POST', {
  targetEndpointId: 'teacher-1',
  body: '第三题不太懂，想请老师讲一下。',
  request: { student: '李明', seat: 3, kind: 'appointment', topic: '二次函数', slot: '第八节晚自习' },
  messageId: 'request-retry-id',
  expectedSender: classroomIdentity,
  expectedPeer: teacherIdentity,
});
assert.equal(sentRequest.status, 200);
const sendRequestCall = calls.find(([name]) => name === 'sendRequest');
assert.equal(sendRequestCall[1].authorization.source, 'connection-direct');
assert.equal(sendRequestCall[1].request.student, '李明');
assert.equal(sendRequestCall[1].request.seat, 3);
assert.equal(sendRequestCall[1].messageId, 'request-retry-id', 'the authenticated classroom route accepts the original id for idempotent retry');
assert.deepEqual(sendRequestCall[1].expectedSender, classroomIdentity);
assert.deepEqual(sendRequestCall[1].expectedPeer, teacherIdentity);
const sentResponse = await request(LAN_HOST_ROUTES.responseSend, 'POST', {
  targetEndpointId: 'classroom-1',
  body: '老师已确认预约时间。',
  response: { replyToMessageId: 'request-1', decision: 'confirmed', slot: '周五课后' },
  messageId: 'teacher-reply-retry-id',
  expectedSender: teacherIdentity,
  expectedPeer: classroomIdentity,
});
assert.equal(sentResponse.status, 200);
const sendResponseCall = calls.find(([name]) => name === 'sendResponse');
assert.equal(sendResponseCall[1].authorization.source, 'connection-direct');
assert.equal(sendResponseCall[1].response.replyToMessageId, 'request-1');
assert.equal(sendResponseCall[1].messageId, 'teacher-reply-retry-id', 'the authenticated response route accepts an existing signed message id for safe retry');
assert.deepEqual(sendResponseCall[1].expectedSender, teacherIdentity);
assert.deepEqual(sendResponseCall[1].expectedPeer, classroomIdentity);
for (const [route, expectedSender, expectedPeer, targetEndpointId, content] of [
  [LAN_HOST_ROUTES.requestSend, classroomIdentity, teacherIdentity, 'teacher-1', { request: { student: '李明' } }],
  [LAN_HOST_ROUTES.responseSend, teacherIdentity, classroomIdentity, 'classroom-1', { response: { replyToMessageId: 'request-1', decision: 'confirmed' } }],
]) {
  const valid = { targetEndpointId, body: 'x', ...content, expectedSender, expectedPeer };
  for (const changed of [
    { ...valid, expectedSender: undefined },
    { ...valid, expectedSender: { ...expectedSender, fingerprint: undefined } },
    { ...valid, expectedSender: { ...expectedSender, role: expectedPeer.role } },
    { ...valid, expectedPeer: undefined },
    { ...valid, expectedPeer: { ...expectedPeer, fingerprint: undefined } },
    { ...valid, expectedPeer: { ...expectedPeer, fingerprint: `sha256:${'g'.repeat(32)}` } },
    { ...valid, expectedPeer: { ...expectedPeer, endpointId: 'another-endpoint' } },
    { ...valid, expectedPeer: { ...expectedPeer, role: expectedSender.role } },
    { ...valid, expectedPeer: { ...expectedPeer, publicKey: {} } },
  ]) {
    const before = calls.length;
    const rejected = await request(route, 'POST', changed);
    assert.equal(rejected.status, 400, `${route} must reject stale/malformed binding`);
    assert.deepEqual(await rejected.json(), { code: 'INVALID_REQUEST' });
    assert.equal(calls.length, before, 'malformed binding must not reach the LAN service');
  }
}
// 本机角色只由独立启动的宿主配置决定：浏览器多塞一个 role 就该被窄 schema 挡下。
const beforeExtra = calls.length;
const extraField = await request(LAN_HOST_ROUTES.requestSend, 'POST', {
  targetEndpointId: 'teacher-1', body: 'x', request: { student: '李明' }, role: 'teacher',
});
assert.equal(extraField.status, 400);
assert.deepEqual(await extraField.json(), { code: 'INVALID_REQUEST' });
assert.equal(calls.length, beforeExtra);
const beforeMissing = calls.length;
const missingRequest = await request(LAN_HOST_ROUTES.requestSend, 'POST', { targetEndpointId: 'teacher-1', body: 'x' });
assert.equal(missingRequest.status, 400);
assert.equal(calls.length, beforeMissing);
// 关键不变量：任何 HTTP 路由都不得直接触发教师通知。
assert.equal(calls.some(([name]) => name === 'sendMessage'), false, 'HTTP 路由不得绕过 dispatch 审批发教师通知');

dispose();
assert.equal(registrations.size, 0);
console.log('host bridge tests passed: fixed authenticated routes, strict schemas, student requests and bound teacher replies only, no teacher-notice bypass');
