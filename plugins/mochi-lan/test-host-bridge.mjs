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
  async acceptPairing(input) { calls.push(['acceptPairing', input]); return { status: 'paired' }; },
  async rejectPairing(input) { calls.push(['rejectPairing', input]); return { status: 'rejected' }; },
  async unpairPeer(input) { calls.push(['unpairPeer', input]); return { status: 'unpaired' }; },
  async blockPeer(input) { calls.push(['blockPeer', input]); return { status: 'blocked' }; },
  async markSeen(input) { calls.push(['markSeen', input]); return { status: 'ACKNOWLEDGED' }; },
  // 两个外发方向分开记：教师通知（走 dispatch 审批）与学生预约（本机直接动作）。
  async sendMessage(input) { calls.push(['sendMessage', input]); return { messageId: 'notify-1', delivery: 'ACKNOWLEDGED' }; },
  async sendRequest(input) { calls.push(['sendRequest', input]); return { messageId: 'request-1', delivery: 'ACKNOWLEDGED' }; },
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
// [Mochi 2026-09-18] 原断言查的是「路径里有没有 send」。那个判据有两个毛病：
// 改个名字就能绕过，而且它会误伤反方向的学生预约——而学生预约本就不该走 dispatch
// 审批（学生本人就是发起人）。真正要守的不变量是「浏览器不能绕过审批发教师通知」，
// 所以这里改成查行为：下面会在跑完所有路由后断言 lan.sendMessage 一次都没被调用。
assert.deepEqual(
  Object.values(LAN_HOST_ROUTES).filter((route) => route.endsWith('/request/send')),
  [LAN_HOST_ROUTES.requestSend],
  '主动外发只允许学生预约这一条路由',
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
assert.equal((await request(LAN_HOST_ROUTES.pairAccept, 'POST', { requestId: 'pair-1' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.pairReject, 'POST', { requestId: 'pair-1' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.peerUnpair, 'POST', { endpointId: 'classroom-1' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.peerBlock, 'POST', { endpointId: 'classroom-1' })).status, 200);
assert.equal((await request(LAN_HOST_ROUTES.messageSeen, 'POST', { messageId: 'message-1' })).status, 200);
for (const [name, input] of calls.filter(([name]) => ['requestPairing', 'acceptPairing', 'rejectPairing', 'unpairPeer', 'blockPeer', 'markSeen'].includes(name))) {
  assert.equal(input.authorization.source, 'connection-direct', `${name} must receive a DSH-side authorization`);
}

console.log('④ 学生预约是唯一的外发路由，且不接受浏览器自报角色');
const sentRequest = await request(LAN_HOST_ROUTES.requestSend, 'POST', {
  targetEndpointId: 'teacher-1',
  body: '第三题不太懂，想请老师讲一下。',
  request: { student: '李明', seat: 3, kind: 'appointment', topic: '二次函数', slot: '第八节晚自习' },
});
assert.equal(sentRequest.status, 200);
const sendRequestCall = calls.find(([name]) => name === 'sendRequest');
assert.equal(sendRequestCall[1].authorization.source, 'connection-direct');
assert.equal(sendRequestCall[1].request.student, '李明');
assert.equal(sendRequestCall[1].request.seat, 3);
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
console.log('host bridge tests passed: fixed authenticated routes, strict schemas, student requests are the only outbound route, no teacher-notice bypass');
