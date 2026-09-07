// CampusConnection persistence isolation tests.
// All requests are stubs; this file never contacts a campus service or uses a
// user session file. It sets its temporary file path before importing the module.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryRoot = mkdtempSync(join(tmpdir(), 'mochi-campus-connection-test-'));
const sessionFile = join(temporaryRoot, 'campus-session.json');
const previousSessionFile = process.env.MOCHI_CAMPUS_SESSION_FILE;
process.env.MOCHI_CAMPUS_SESSION_FILE = sessionFile;

const moduleUrl = new URL('./connection.mjs', import.meta.url);
moduleUrl.searchParams.set('connection-test', `${process.pid}-${Date.now()}`);
const { CampusConnection, CampusRequestError, campusOrigin } = await import(moduleUrl.href);

const TOKEN_A = 'a'.repeat(40);
const TOKEN_B = 'b'.repeat(40);
const userA = { id: 71, name: '测试甲', role: 'TEACHER' };
const userB = { id: 72, name: '测试乙', role: 'TEACHER' };
const originA = campusOrigin('http://127.0.0.1:8787');
const originB = campusOrigin('http://localhost:8787');

function exec(label) {
  return { agent: { session: { label } }, callId: `connection-test-${label}` };
}

function fakeResponse(value, { ok = true, status = 200 } = {}) {
  return { ok, status, headers: { get: () => null }, json: async () => value };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await new Promise((complete) => setImmediate(complete));
}

function writeRecord(value) {
  writeFileSync(sessionFile, JSON.stringify(value), { mode: 0o600 });
  chmodSync(sessionFile, 0o600);
}

try {
  // Persist the source origin alongside the token and account identity.
  const seeded = new CampusConnection(originA, async () => { throw new Error('seed must not fetch'); });
  seeded.activate(TOKEN_A, userA);
  const saved = JSON.parse(readFileSync(sessionFile, 'utf8'));
  assert.equal(saved.origin, originA);
  assert.equal(saved.user.id, userA.id);
  assert.equal(statSync(sessionFile).mode & 0o777, 0o600);
  console.log('① 新记录保存来源、账号且权限为 0600');

  // Callers must receive machine-readable route/status/code facts; retry policy
  // belongs to the dispatch plugin and must never parse a localized error string.
  const structuredFailure = new CampusConnection(originA, async () => fakeResponse({
    error: '同事名册里没有对上「测试对象」。', code: 'ASSISTANT_RELAY_PEER_NOT_FOUND',
  }, { ok: false, status: 404 }));
  structuredFailure.activate(TOKEN_A, userA);
  await assert.rejects(
    () => structuredFailure.request('/api/assistant/relay/send', exec('structured-relay-error'), {
      method: 'POST', body: { peerName: '测试对象', kind: 'message', note: 'test' },
    }),
    (error) => {
      assert.ok(error instanceof CampusRequestError);
      assert.equal(error.path, '/api/assistant/relay/send');
      assert.equal(error.status, 404);
      assert.equal(error.code, 'ASSISTANT_RELAY_PEER_NOT_FOUND');
      return true;
    },
  );
  console.log('② 失败响应保留路径、状态和服务端 code');

  // A target-origin change must be rejected before a saved token is ever sent.
  let wrongOriginFetches = 0;
  const wrongOrigin = new CampusConnection(originB, async () => {
    wrongOriginFetches += 1;
    return fakeResponse({ user: userA });
  });
  await assert.rejects(() => wrongOrigin.binding(exec('wrong-origin')), /请先在侧栏任一校园页面登录账号/);
  assert.equal(wrongOriginFetches, 0);
  assert.equal(existsSync(sessionFile), false);
  console.log('③ 切换来源不会发送旧令牌，并要求重新登录');

  // Legacy records have no source binding and are intentionally not trusted.
  writeRecord({ token: TOKEN_A, user: userA, at: new Date().toISOString() });
  let legacyFetches = 0;
  const legacy = new CampusConnection(originA, async () => {
    legacyFetches += 1;
    return fakeResponse({ user: userA });
  });
  await assert.rejects(() => legacy.binding(exec('legacy')), /请先在侧栏任一校园页面登录账号/);
  assert.equal(legacyFetches, 0);
  assert.equal(existsSync(sessionFile), false);
  console.log('④ 无来源的旧记录不会被静默恢复');

  // The verified /auth/me identity must match the identity recorded at login.
  seeded.activate(TOKEN_A, userA);
  let mismatchFetches = 0;
  const mismatch = new CampusConnection(originA, async () => {
    mismatchFetches += 1;
    return fakeResponse({ user: userB });
  });
  await assert.rejects(() => mismatch.binding(exec('identity-mismatch')), /请先在侧栏任一校园页面登录账号/);
  assert.equal(mismatchFetches, 1);
  assert.equal(existsSync(sessionFile), false);
  console.log('⑤ 恢复身份不一致会清除记录并拒绝绑定');

  // A fresh Harness conversation may still use the same verified local login.
  seeded.activate(TOKEN_A, userA);
  const validCalls = [];
  const restored = new CampusConnection(originA, async (url) => {
    const path = new URL(String(url)).pathname;
    validCalls.push(path);
    return path === '/api/auth/me' ? fakeResponse({ user: userA }) : fakeResponse({ ok: true });
  });
  const restoredResult = await restored.request('/api/dashboard', exec('fresh-harness-conversation'));
  assert.equal(restoredResult.account.id, userA.id);
  assert.deepEqual(validCalls, ['/api/auth/me', '/api/dashboard']);
  console.log('⑥ 同一来源、同一账号可供新 Harness 对话继续使用');

  // A delayed restore must not resurrect a session after logout.
  seeded.activate(TOKEN_A, userA);
  const logoutGate = deferred();
  let logoutRestoreFetches = 0;
  const logoutDuringRestore = new CampusConnection(originA, async () => {
    logoutRestoreFetches += 1;
    return logoutGate.promise;
  });
  const pendingLogoutBinding = logoutDuringRestore.binding(exec('logout-during-restore'));
  assert.equal(logoutRestoreFetches, 1);
  logoutDuringRestore.clear(TOKEN_A);
  logoutGate.resolve(fakeResponse({ user: userA }));
  await assert.rejects(() => pendingLogoutBinding, /请先在侧栏任一校园页面登录账号/);
  assert.equal(existsSync(sessionFile), false);
  console.log('⑦ 登出会使晚到的恢复响应失效');

  // A delayed old-account restore must not overwrite a newer browser login.
  seeded.activate(TOKEN_A, userA);
  const switchGate = deferred();
  let switchRestoreFetches = 0;
  const switchDuringRestore = new CampusConnection(originA, async () => {
    switchRestoreFetches += 1;
    return switchGate.promise;
  });
  const pendingSwitchBinding = switchDuringRestore.binding(exec('switch-during-restore'));
  assert.equal(switchRestoreFetches, 1);
  switchDuringRestore.activate(TOKEN_B, userB);
  switchGate.resolve(fakeResponse({ user: userA }));
  const bindingAfterSwitch = await pendingSwitchBinding;
  assert.equal(bindingAfterSwitch.user.id, userB.id);
  assert.equal(JSON.parse(readFileSync(sessionFile, 'utf8')).user.id, userB.id);
  console.log('⑧ 新账号登录会使旧恢复响应失效');

  // Passive browser-cookie detection still supports a real account switch.
  const passiveSwitchGate = deferred();
  let passiveSwitchFetches = 0;
  const passiveSwitch = new CampusConnection(originA, async () => {
    passiveSwitchFetches += 1;
    return passiveSwitchGate.promise;
  });
  const oldPassiveConversation = exec('passive-switch-old-conversation');
  passiveSwitch.activate(TOKEN_A, userA);
  await passiveSwitch.binding(oldPassiveConversation);
  passiveSwitch.ensureActive(TOKEN_B);
  assert.equal(passiveSwitchFetches, 1);
  passiveSwitchGate.resolve(fakeResponse({ user: userB }));
  await flushAsyncWork();
  assert.equal((await passiveSwitch.binding(exec('passive-switch-new-conversation'))).user.id, userB.id);
  await assert.rejects(() => passiveSwitch.binding(oldPassiveConversation), /校园账号已切换/);
  console.log('⑨ 浏览器新 cookie 可切换账号，旧对话仍被阻断');

  // If A and then B are both being probed, B is the latest request and wins even
  // when A resolves afterwards.
  const oldProbeGate = deferred();
  const newProbeGate = deferred();
  const probeTokens = [];
  const concurrentProbes = new CampusConnection(originA, async (_url, options) => {
    const cookie = options.headers.Cookie;
    probeTokens.push(cookie.includes(TOKEN_A) ? 'A' : 'B');
    return cookie.includes(TOKEN_A) ? oldProbeGate.promise : newProbeGate.promise;
  });
  concurrentProbes.ensureActive(TOKEN_A);
  concurrentProbes.ensureActive(TOKEN_B);
  assert.deepEqual(probeTokens, ['A', 'B']);
  newProbeGate.resolve(fakeResponse({ user: userB }));
  await flushAsyncWork();
  const parallelConversation = exec('parallel-probes');
  assert.equal((await concurrentProbes.binding(parallelConversation)).user.id, userB.id);
  oldProbeGate.resolve(fakeResponse({ user: userA }));
  await flushAsyncWork();
  assert.equal((await concurrentProbes.binding(parallelConversation)).user.id, userB.id);
  console.log('⑩ 并发探测以最后发起者为准，晚到旧响应不会覆盖');

  // A passive probe must also become inert after a restart-era logout.
  const clearProbeGate = deferred();
  let clearProbeFetches = 0;
  const clearDuringProbe = new CampusConnection(originA, async () => {
    clearProbeFetches += 1;
    return clearProbeGate.promise;
  });
  clearDuringProbe.ensureActive(TOKEN_A);
  assert.equal(clearProbeFetches, 1);
  clearDuringProbe.clear(TOKEN_A);
  clearProbeGate.resolve(fakeResponse({ user: userA }));
  await flushAsyncWork();
  await assert.rejects(() => clearDuringProbe.binding(exec('clear-during-probe')), /请先在侧栏任一校园页面登录账号/);
  console.log('⑪ 登出后晚到被动探测不会复活账号');

  // Existing per-session protection remains in place after an account switch.
  const inProcess = new CampusConnection(originA, async () => fakeResponse({ user: userA }));
  const originalConversation = exec('original-conversation');
  inProcess.activate(TOKEN_A, userA);
  await inProcess.binding(originalConversation);
  inProcess.activate(TOKEN_B, userB);
  await assert.rejects(() => inProcess.binding(originalConversation), /校园账号已切换/);
  inProcess.clear(TOKEN_B);
  console.log('⑫ 旧对话在进程内账号切换后仍被阻断');

  console.log('connection tests passed: isolated persistence, origin/user restore checks, and session-switch guard');
} finally {
  if (previousSessionFile === undefined) delete process.env.MOCHI_CAMPUS_SESSION_FILE;
  else process.env.MOCHI_CAMPUS_SESSION_FILE = previousSessionFile;
  rmSync(temporaryRoot, { recursive: true, force: true });
}
