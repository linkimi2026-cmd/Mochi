import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { campusBrowserCookieName } from '../../plugins/mochi-campus/connection.mjs';
import { createApiProxyHandler } from './index.mjs';

const TOKEN_A = 'a'.repeat(40);
const TOKEN_B = 'b'.repeat(40);

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server has no TCP port');
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function upstream(label, token) {
  const calls = [];
  return {
    calls,
    handler(req, res) {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        calls.push({ path: req.url, cookie: req.headers.cookie || '', authorization: req.headers.authorization, origin: req.headers.origin });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/auth/login') {
          res.setHeader('set-cookie', `campus_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`);
          res.end(JSON.stringify({ user: { id: label === 'A' ? 1 : 2, name: label, role: 'TEACHER' } }));
          return;
        }
        if (req.url === '/api/auth/logout') {
          res.setHeader('set-cookie', 'campus_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.headers.cookie === `campus_session=${token}`) res.end(JSON.stringify({ user: { id: label === 'A' ? 1 : 2 } }));
        else { res.statusCode = 401; res.end(JSON.stringify({ error: 'unauthorized' })); }
      });
    },
  };
}

const resources = [];
try {
  const upstreamA = upstream('A', TOKEN_A);
  const upstreamB = upstream('B', TOKEN_B);
  const serverA = await listen(upstreamA.handler); resources.push(serverA);
  const serverB = await listen(upstreamB.handler); resources.push(serverB);

  const connectionA = { ensureActive() {}, activate() {}, clear() {} };
  const connectionB = { ensureActive() {}, activate() {}, clear() {} };
  const proxyA = await listen(createApiProxyHandler({ upstream: new URL(serverA.origin), connection: connectionA })); resources.push(proxyA);
  const proxyB = await listen(createApiProxyHandler({ upstream: new URL(serverB.origin), connection: connectionB })); resources.push(proxyB);

  const login = async (proxy) => fetch(`${proxy.origin}/jxl-api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', Origin: proxy.origin }, body: '{}',
  });
  const loginA = await login(proxyA);
  assert.equal(loginA.status, 200);
  const cookieA = loginA.headers.get('set-cookie') || '';
  const nameA = campusBrowserCookieName(serverA.origin);
  const nameB = campusBrowserCookieName(serverB.origin);
  assert.notEqual(nameA, nameB);
  assert.match(cookieA, new RegExp(`^${nameA}=${TOKEN_A};`));
  assert.doesNotMatch(cookieA, /^campus_session=/);
  assert.doesNotMatch(cookieA, /;\s*Secure\b/i);

  // A legacy unbound cookie and A's origin-scoped cookie must both be ignored
  // by the B proxy; host authorization must never reach either campus origin.
  const rejectedAtB = await fetch(`${proxyB.origin}/jxl-api/auth/me`, {
    headers: { Cookie: `campus_session=${TOKEN_A}; ${nameA}=${TOKEN_A}`, Authorization: 'Bearer host-secret' },
  });
  assert.equal(rejectedAtB.status, 401);
  assert.equal(upstreamB.calls.at(-1).cookie, '');
  assert.equal(upstreamB.calls.at(-1).authorization, undefined);

  const loginB = await login(proxyB);
  assert.equal(loginB.status, 200);
  const cookieB = loginB.headers.get('set-cookie') || '';
  assert.match(cookieB, new RegExp(`^${nameB}=${TOKEN_B};`));

  const bothCookies = `${nameA}=${TOKEN_A}; ${nameB}=${TOKEN_B}; campus_session=${TOKEN_A}`;
  assert.equal((await fetch(`${proxyA.origin}/jxl-api/auth/me`, { headers: { Cookie: bothCookies } })).status, 200);
  assert.equal(upstreamA.calls.at(-1).cookie, `campus_session=${TOKEN_A}`);
  assert.equal((await fetch(`${proxyB.origin}/jxl-api/auth/me`, { headers: { Cookie: bothCookies } })).status, 200);
  assert.equal(upstreamB.calls.at(-1).cookie, `campus_session=${TOKEN_B}`);

  const logoutB = await fetch(`${proxyB.origin}/jxl-api/auth/logout`, {
    method: 'POST', headers: { Cookie: `${nameB}=${TOKEN_B}`, Origin: proxyB.origin },
  });
  assert.equal(logoutB.status, 200);
  assert.match(logoutB.headers.get('set-cookie') || '', new RegExp(`^${nameB}=;`));
  assert.match(logoutB.headers.get('set-cookie') || '', /Max-Age=0/);

  console.log('origin-scoped proxy cookie test passed: two HTTP upstreams remain isolated');
} finally {
  for (const resource of resources.reverse()) await resource.close();
}
