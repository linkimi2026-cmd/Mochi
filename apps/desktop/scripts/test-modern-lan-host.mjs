#!/usr/bin/env node
// Physical packaged Electron/DSH, two isolated full profiles; fixture identities only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const app = resolve(process.argv[2] || join(repo, 'apps/desktop/release/mac-arm64/Mochi.app'));
const resources = join(app, 'Contents/Resources/mochi');
const modules = join(resources, 'node_modules');
const binary = join(app, 'Contents/MacOS/Mochi');
const evidence = resolve(process.argv[3] || join(repo, 'docs/evidence/harness-upgrade-2026-09-30/lan-host'));
const manual = process.argv.includes('--manual');
const require = createRequire(join(modules, '@deepseek-ai/dsh/package.json'));
const yaml = require('yaml');
const runtime = require(join(resources, 'profile/runtime-profile.cjs'));
const root = mkdtempSync(join(tmpdir(), 'mochi-modern-lan-'));
let pluginRoot = join(resources, 'plugins');
const sourceLan = process.argv.includes('--source-lan');
if (sourceLan) {
  // A clearly identified test stage; never modify a held or shipped App.
  const stage = join(root, 'source-lan-stage'); pluginRoot = join(stage, 'plugins'); mkdirSync(pluginRoot, { recursive: true });
  symlinkSync(modules, join(stage, 'node_modules'));
  symlinkSync(join(resources, 'teacher-agent-presets'), join(stage, 'teacher-agent-presets'));
  for (const entry of readdirSync(join(resources, 'plugins'))) {
    const target = join(pluginRoot, entry);
    if (entry === 'mochi-lan') {
      cpSync(join(resources, 'plugins', entry), target, { recursive: true });
      cpSync(join(repo, 'plugins/mochi-lan/lan-service.mjs'), join(target, 'lan-service.mjs'));
    } else symlinkSync(join(resources, 'plugins', entry), target);
  }
}
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
mkdirSync(evidence, { recursive: true });
assert.equal(require('@deepseek-ai/dsh/package.json').version, '0.2.0-rc.2');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const redact = text => text.replace(/token=[^\s"']+/gu, 'token=[redacted]').replace(/(set-cookie|cookie):[^\n]+/giu, '$1: [redacted]');
async function until(read, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await sleep(100); }
  throw Error('Timeout: ' + label);
}
async function udpPort() {
  const socket = createSocket('udp4');
  await new Promise((done, reject) => { socket.once('error', reject); socket.bind(0, '127.0.0.1', done); });
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  return port;
}
const discoveryPort = await udpPort();
const schoolId = 'modern-lan-fixture-' + Date.now();
const hosts = [];

function setup(role) {
  const home = join(root, role); mkdirSync(home);
  runtime.provisionMochiProfiles({ homeDir: home, resourceRoot: join(resources, 'profile'), skillsDir: join(resources, 'skills'), pluginRoot, runtimeNodeModulesRoot: modules, role });
  const profile = join(home, 'profiles/mochi-web');
  assert.equal(realpathSync(join(profile, 'node_modules/mochi-lan')), realpathSync(join(pluginRoot, 'mochi-lan')));
  const identity = { endpointId: 'fixture-' + role, role, schoolId, displayName: '现代资源验收' + role, ...(role === 'classroom' ? { classId: 'fixture-class' } : {}) };
  // Only this isolated Host registers the helper. It explicitly grants the test's
  // approved send, while all pairing/seen calls use existing production routes.
  const probe = join(root, role + '-probe'); mkdirSync(join(probe, 'node_modules'), { recursive: true });
  symlinkSync(join(modules, '@deepseek-ai'), join(probe, 'node_modules/@deepseek-ai'));
  writeFileSync(join(probe, 'package.json'), JSON.stringify({ name: 'lan-runtime-probe', type: 'module', main: 'index.mjs' }));
  writeFileSync(join(probe, 'index.mjs'), `export const inject=['mochiLan','connection'];
export function apply(ctx){
 console.log('LAN_RUNTIME='+JSON.stringify({electron:process.versions.electron,node:process.versions.node,role:${JSON.stringify(role)}}));
 const register=(path,methods,fetch)=>ctx.connection.fetch.register({path,methods,requestBody:'buffered',fetch});
 const disposers=[register('/api/lan-runtime/versions',['GET'],()=>Response.json({electron:process.versions.electron,node:process.versions.node,role:${JSON.stringify(role)}})),
 register('/api/lan-runtime/approved-send',['POST'],async request=>{try{const input=await request.json();return Response.json(await ctx.mochiLan.sendMessage({...input,authorization:ctx.mochiLan.authorize('send-message','dispatch-approved'),signal:request.signal}));}catch(error){return Response.json({code:error.code,message:error.message},{status:error.status||500});}})];
 return ()=>disposers.reverse().forEach(dispose=>dispose());
}`);
  symlinkSync(probe, join(profile, 'node_modules/lan-runtime-probe'));
  const manifestPath = join(profile, 'package.json'); const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['lan-runtime-probe'] = 'link:' + probe; writeFileSync(manifestPath, JSON.stringify(manifest));
  const patch = join(profile, 'cordis.patch.yml');
  writeFileSync(patch, readFileSync(patch, 'utf8') + '\n' + yaml.stringify([
    { id: 'mochi-lan', config: { dataRoot: join(home, 'mochi-lan'), lockedRole: role, port: 0, discoveryPort, discoveryEnabled: true, identity } },
    { insert: [{ id: 'lan-runtime-probe', name: 'lan-runtime-probe' }] },
  ]));
  const host = { role, home, identity, starts: 0, child: null, log: '', cookie: '', origin: '' }; hosts.push(host); return host;
}

async function start(host) {
  host.starts++; host.log = ''; host.cookie = '';
  host.child = spawn(binary, ['--expose-internals', join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'mochi-web', '--port', '0', '--no-open'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: host.home, DSH_HOME: host.home, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => { host.log += chunk; }; host.child.stdout.on('data', collect); host.child.stderr.on('data', collect);
  host.child.on('error', error => { host.log += '\n' + error; });
  const url = await until(() => { if (host.child.exitCode !== null) throw Error(redact(host.log)); return host.log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/u)?.[0]; }, host.role + ' Host URL');
  host.origin = new URL(url).origin;
  const exchange = await fetch(url, { redirect: 'manual' }); assert.equal(exchange.status, 303);
  host.cookie = exchange.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; '); assert.ok(host.cookie);
  const version = await api(host, '/api/lan-runtime/versions'); assert.equal(version.electron, '44.0.0'); assert.equal(version.role, host.role);
  await until(async () => (await state(host)).http, host.role + ' LAN listener');
  writeFileSync(join(evidence, host.role + '-' + host.starts + '.log'), redact(host.log));
}
async function stop(host) {
  if (!host.child || host.child.exitCode !== null) return;
  const exit = new Promise(done => host.child.once('exit', done)); host.child.kill('SIGTERM');
  let timer; await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => { host.child.kill('SIGKILL'); reject(Error('Host shutdown timeout')); }, 6000); })]).finally(() => clearTimeout(timer));
  writeFileSync(join(evidence, host.role + '-' + host.starts + '.log'), redact(host.log));
}
async function api(host, path, body) {
  const response = await fetch(host.origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: host.cookie, origin: host.origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const text = await response.text(); assert.ok(response.ok, host.role + ' ' + path + ' ' + response.status + ': ' + text); return JSON.parse(text);
}
const state = host => api(host, '/api/mochi-lan/state');
const discovered = host => api(host, '/api/mochi-lan/discovery');
const unseen = (teacher, classroom, id) => {
  const incoming = classroom.inbox.find(row => row.messageId === id); assert.ok(incoming); assert.ok(!incoming.seenAt);
  assert.ok(!teacher.receipts.some(row => row.messageId === id), 'delivery ACK must not become a seen receipt');
};
const send = (teacher, classroom, id, body) => api(teacher, '/api/lan-runtime/approved-send', { targetEndpointId: classroom.identity.endpointId, messageId: id, body, expectedSender: teacher.identity, expectedPeer: classroom.identity });

try {
  const teacher = setup('teacher'), classroom = setup('classroom');
  await start(teacher); await start(classroom);
  const initial = [await state(teacher), await state(classroom)];
  writeFileSync(join(evidence, 'initial-diagnostics.json'), JSON.stringify(initial.map(({ pairingCode, ...snapshot }) => snapshot), null, 2) + '\n');
  console.log('LAN_STAGE: actual Host authentication and role checks');
  for (let i = 0; i < hosts.length; i++) { assert.equal(initial[i].identity.role, hosts[i].role); assert.equal(initial[i].lockedRole, hosts[i].role); assert.equal(initial[i].peers.length, 0); }
  assert.notEqual(initial[0].identity.fingerprint, initial[1].identity.fingerprint);
  for (const host of hosts) {
    assert.equal((await fetch(host.origin + '/api/mochi-lan/state')).status, 401);
    const other = hosts.find(value => value !== host);
    assert.equal((await fetch(host.origin + '/api/mochi-lan/state', { headers: { cookie: other.cookie } })).status, 401);
    assert.equal((await fetch(host.origin + '/api/mochi-lan/state', { headers: { cookie: host.cookie, origin: 'http://example.invalid' } })).status, 403);
    const invalidRole = await fetch(host.origin + '/api/mochi-lan/identity', { method: 'POST', headers: { cookie: host.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ identity: { role: other.role, schoolId, displayName: '不能改角色' } }) });
    assert.equal(invalidRole.status, 400); assert.equal((await state(host)).identity.role, host.role);
  }
  const discoveryStarted = Date.now();
  let match;
  if (manual) {
    match = await api(teacher, '/api/mochi-lan/pair/probe', { address: { host: '127.0.0.1', port: initial[1].http.port }, expectedFingerprint: initial[1].identity.fingerprint });
    assert.equal(match.candidate.endpointId, classroom.identity.endpointId);
  } else {
    const teacherDiscovery = await until(async () => (await discovered(teacher)).candidates.find(row => row.endpointId === classroom.identity.endpointId), 'teacher discovers classroom');
    const classroomDiscovery = await until(async () => (await discovered(classroom)).candidates.find(row => row.endpointId === teacher.identity.endpointId), 'classroom discovers teacher');
    assert.equal(teacherDiscovery.role, 'classroom'); assert.equal(classroomDiscovery.role, 'teacher');
    const matches = (await api(teacher, '/api/mochi-lan/pair/code/search', { code: (await state(classroom)).pairingCode.code })).candidates;
    assert.equal(matches.length, 1); assert.equal(matches[0].endpointId, classroom.identity.endpointId);
    match = { address: matches[0].address, candidate: Object.fromEntries(['endpointId','role','schoolId','classId','displayName','fingerprint','publicKey'].filter(key => key in matches[0]).map(key => [key,matches[0][key]])) };
  }
  const discoveryMs = Date.now() - discoveryStarted;
  console.log('LAN_STAGE: ' + (manual ? 'explicit production fingerprint probe' : 'bidirectional production discovery'));
  const code = (await state(classroom)).pairingCode.code;
  const { address, candidate } = match;
  const pending = await api(teacher, '/api/mochi-lan/pair/request', { candidate, address, pairingCode: code }); assert.equal(pending.status, 'pending');
  assert.equal((await state(teacher)).peers.length, 0, 'request alone never pairs');
  assert.equal((await state(classroom)).pendingPairings.length, 1);
  assert.equal((await api(classroom, '/api/mochi-lan/pair/accept', { requestId: pending.requestId })).status, 'paired');
  const pairedStates = [await state(teacher), await state(classroom)];
  for (let i = 0; i < hosts.length; i++) { assert.equal(pairedStates[i].peers.length, 1); assert.equal(pairedStates[i].peers[0].fingerprint, pairedStates[1 - i].identity.fingerprint); hosts[i].identity = pairedStates[i].identity; }
  const delivery = await send(teacher, classroom, 'modern-paper-1', '现代资源本机测试纸条：请准备班会材料。'); assert.equal(delivery.delivery, 'ACKNOWLEDGED');
  const hiddenStart = Date.now();
  console.log('LAN_STAGE: paired and delivered; observe 30 seconds without seen');
  unseen(await state(teacher), await state(classroom), 'modern-paper-1');
  // No renderer or seen invocation exists during this real wall-clock window.
  for (let i = 0; i < 6; i++) { await sleep(5000); unseen(await state(teacher), await state(classroom), 'modern-paper-1'); }
  const hiddenElapsedMs = Date.now() - hiddenStart; assert.ok(hiddenElapsedMs >= 30000);
  console.log('LAN_STAGE: 30 seconds unseen passed');
  const seen = await api(classroom, '/api/mochi-lan/message-seen', { messageId: 'modern-paper-1' }); assert.equal(seen.status, 'ACKNOWLEDGED');
  assert.equal((await state(teacher)).receipts.filter(row => row.messageId === 'modern-paper-1').length, 1);
  assert.equal((await api(classroom, '/api/mochi-lan/message-seen', { messageId: 'modern-paper-1' })).status, 'ACKNOWLEDGED');
  assert.equal((await state(teacher)).receipts.filter(row => row.messageId === 'modern-paper-1').length, 1);
  const secondDelivery = await send(teacher, classroom, 'modern-paper-unseen', '重启前未查看的本机测试纸条。'); assert.equal(secondDelivery.delivery, 'ACKNOWLEDGED');
  const oldClassroomPort = (await state(classroom)).http.port;
  await stop(classroom); await start(classroom);
  const reopened = await state(classroom); assert.deepEqual(reopened.identity, pairedStates[1].identity); assert.equal(reopened.peers[0].fingerprint, pairedStates[0].identity.fingerprint);
  unseen(await state(teacher), reopened, 'modern-paper-unseen'); assert.ok(reopened.inbox.find(row => row.messageId === 'modern-paper-1').seenAt);
  if (manual) await api(teacher, '/api/mochi-lan/peer/address/recover', { endpointId: classroom.identity.endpointId, address: { host: '127.0.0.1', port: reopened.http.port } });
  const reconnected = await until(async () => { const row = (await state(teacher)).peers[0]; return (manual || row.online) && row.address.port === reopened.http.port && row; }, 'teacher updates classroom address');
  assert.equal((await send(teacher, classroom, 'modern-paper-after-classroom-restart', '教室重启后的本机测试纸条。')).delivery, 'ACKNOWLEDGED');
  await stop(teacher); await start(teacher);
  const teacherReopened = await state(teacher); assert.deepEqual(teacherReopened.identity, pairedStates[0].identity); assert.equal(teacherReopened.peers[0].fingerprint, pairedStates[1].identity.fingerprint);
  assert.equal(teacherReopened.receipts.filter(row => row.messageId === 'modern-paper-1').length, 1);
  unseen(teacherReopened, await state(classroom), 'modern-paper-unseen');
  if (manual) await api(classroom, '/api/mochi-lan/peer/address/recover', { endpointId: teacher.identity.endpointId, address: { host: '127.0.0.1', port: teacherReopened.http.port } });
  else await until(async () => (await state(teacher)).peers[0]?.online && (await state(classroom)).peers[0]?.online, 'both restart discovery');
  assert.equal((await send(teacher, classroom, 'modern-paper-after-both-restart', '双方分别重启后的本机测试纸条。')).delivery, 'ACKNOWLEDGED');
  assert.equal((await api(classroom, '/api/mochi-lan/message-seen', { messageId: 'modern-paper-unseen' })).status, 'ACKNOWLEDGED');
  assert.equal((await state(teacher)).receipts.filter(row => row.messageId === 'modern-paper-unseen').length, 1);
  const result = { passed: true, mode: manual ? 'explicit-probe' : 'automatic-discovery', physicalApp: app, sourceLanTestStage: sourceLan, lanServiceSha256: sha(join(pluginRoot, 'mochi-lan/lan-service.mjs')), appLanServiceSha256: sha(join(resources, 'plugins/mochi-lan/lan-service.mjs')), electron: '44.0.0', harness: '0.2.0-rc.2', fullPackagedProfiles: ['teacher', 'classroom'], discovery: { verified: !manual, port: discoveryPort, initialMs: discoveryMs, initialStates: initial.map(value => value.discovery), productionBroadcastAndMulticast: !manual }, hiddenElapsedMs, noRenderer: true, guiHiddenBehaviorTested: false, explicitSeenOnly: true, deliveryAckSeparate: true, manualPairAcceptance: true, authentication: ['unauthenticated 401', 'other Host cookie 401', 'foreign Origin 403', 'role change rejected 400'], restarts: { teacher: 1, classroom: 1, keysAndPairingsPreserved: true, unseenPreserved: true, seenReceiptPreserved: true, classroomOldPort: oldClassroomPort, classroomNewPort: reopened.http.port, addressUpdate: manual ? 'explicit fingerprint-checked recovery' : 'automatic discovery', newAddress: reconnected.address }, paidModel: false, modelApprovalTested: false, retainedFixtureRoot: root };
  writeFileSync(join(evidence, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const host of hosts) writeFileSync(join(evidence, host.role + '-' + host.starts + '.log'), redact(host.log));
  throw error;
} finally { for (const host of hosts) await stop(host); }
