import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.mjs';
import { DEFAULT_LAN_PORT } from '../lan-service.mjs';

async function availableUdpPort() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => {
      socket.off('error', reject);
      resolve();
    });
  });
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

function pluginContext() {
  let service;
  return {
    get service() { return service; },
    provide(key, value) {
      assert.equal(key, 'mochiLan');
      service = value;
    },
    inject() {},
  };
}

const root = await mkdtemp(join(tmpdir(), 'mochi-lan-plugin-apply-'));
let disposeCustom;
let disposeDefault;
try {
  const customPort = await availableUdpPort();
  const customContext = pluginContext();
  disposeCustom = await apply(customContext, {
    dataRoot: join(root, 'custom'),
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: true,
    discoveryPort: customPort,
  });

  assert.equal(customContext.service.discoveryPort, customPort, 'apply must forward the configured discovery port');
  assert.equal(customContext.service.snapshot().started, true, 'plugin startup must complete');
  assert.equal(customContext.service._udp?.address().port, customPort, 'discovery socket must bind to the configured port');
  await disposeCustom();
  disposeCustom = null;
  assert.equal(customContext.service.snapshot().started, false, 'the plugin disposer must stop the LAN service');

  // With discoveryPort omitted, the service constructor keeps its established
  // default. Disable UDP for this half so the test does not contend with a
  // developer or another test process already using the production port.
  const defaultContext = pluginContext();
  disposeDefault = await apply(defaultContext, {
    dataRoot: join(root, 'default'),
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
  });
  assert.equal(defaultContext.service.discoveryPort, DEFAULT_LAN_PORT, 'omitted discoveryPort must retain the service default');
  assert.equal(defaultContext.service.snapshot().started, true, 'default configuration must still start');
  await disposeDefault();
  disposeDefault = null;
  assert.equal(defaultContext.service.snapshot().started, false, 'default plugin disposer must stop the LAN service');
} finally {
  await disposeCustom?.();
  await disposeDefault?.();
  await rm(root, { recursive: true, force: true });
}

console.log('mochi-lan apply forwards a custom discovery port and preserves the default');
