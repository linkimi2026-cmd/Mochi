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
assert.equal(Object.values(LAN_HOST_ROUTES).some((route) => /send/u.test(route)), false, '不应存在绕过 dispatch 审批的 HTTP 发送路由');

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

dispose();
assert.equal(registrations.size, 0);
console.log('host bridge tests passed: fixed authenticated routes, strict schemas, no send bypass');
