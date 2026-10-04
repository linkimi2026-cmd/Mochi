import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { MochiLanService, lanBroadcastRoutes, LAN_MULTICAST_HOST } from '../lan-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'mochi-lan-shared-port-'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function until(read, label) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (read()) return; await sleep(30); }
  throw Error('Timeout: ' + label);
}
const reserve = dgram.createSocket('udp4');
await new Promise((done, reject) => { reserve.once('error', reject); reserve.bind(0, '0.0.0.0', done); });
const port = reserve.address().port;
await new Promise(done => reserve.close(done));
let teacher, classroom, sender;
const options = role => ({ dataRoot: join(root, role), port: 0, discoveryPort: port, testBeaconIntervalMs: 100, testBeaconTtlMs: 1000,
  identity: { endpointId: 'shared-port-' + role, role, schoolId: 'shared-port-fixture', displayName: 'UDP端口共享测试', ...(role === 'classroom' ? { classId: 'fixture' } : {}) } });
try {
  teacher = new MochiLanService(options('teacher')); classroom = new MochiLanService(options('classroom'));
  await teacher.start(); await classroom.start();
  for (const service of [teacher, classroom]) {
    assert.equal(service.snapshot().discovery.status, 'ACTIVE');
    assert.equal(service._udp.address().port, port);
  }
  await until(() => teacher.listDiscovered().some(row => row.endpointId === 'shared-port-classroom') && classroom.listDiscovered().some(row => row.endpointId === 'shared-port-teacher'), 'same-port reciprocal production beacons');
  const route = lanBroadcastRoutes(networkInterfaces())[0]; assert.ok(route, 'This network test requires one active IPv4 broadcast interface');
  sender = dgram.createSocket('udp4');
  await new Promise((done, reject) => { sender.once('error', reject); sender.bind(0, route.address, done); });
  sender.setBroadcast(true);
  const received = new Set(), marker = 'mochi-shared-discovery-broadcast-fixture';
  const listeners = [teacher, classroom].map((service, index) => { const listener = bytes => { if (bytes.toString() === marker) received.add(index); }; service._udp.on('message', listener); return listener; });
  await new Promise((done, reject) => sender.send(marker, port, route.broadcast, error => error ? reject(error) : done()));
  // Windows documents multicast fanout, not shared unicast/broadcast fanout.
  // Only platforms actually checked by this assertion claim broadcast delivery.
  if (process.platform !== 'win32') await until(() => received.size === 2, 'broadcast reaches both actual discovery sockets');
  const broadcastFanoutVerified = received.size === 2;
  received.clear(); sender.setMulticastInterface(route.address); sender.setMulticastLoopback(true);
  await new Promise((done, reject) => sender.send(marker, port, LAN_MULTICAST_HOST, error => error ? reject(error) : done()));
  await until(() => received.size === 2, 'multicast reaches both actual discovery sockets');
  for (let i = 0; i < 2; i++) [teacher, classroom][i]._udp.off('message', listeners[i]);
  await classroom.stop(); classroom = new MochiLanService(options('classroom')); await classroom.start();
  assert.equal(classroom.snapshot().discovery.status, 'ACTIVE');
  await until(() => teacher.listDiscovered().some(row => row.endpointId === 'shared-port-classroom' && row.address.port === classroom.snapshot().http.port), 'restart refreshes discovered address');
  assert.equal(teacher.snapshot().peers.length, 0, 'beacon discovery grants no pairing authority');
  console.log(JSON.stringify({ passed: true, platform: process.platform, discoveryPort: port, bothSocketsActive: true, reciprocalBeacons: true, broadcastFanoutVerified, multicastFanoutVerified: true, receiverRestart: true }));
} finally {
  if (sender) await new Promise(done => sender.close(done));
  await classroom?.stop(); await teacher?.stop(); await rm(root, { recursive: true, force: true });
}
