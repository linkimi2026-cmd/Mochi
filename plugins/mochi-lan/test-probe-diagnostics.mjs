import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MochiLanService } from './lan-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'mochi-lan-probe-'));
const originalFetch = globalThis.fetch;
const lan = new MochiLanService({ dataRoot: root, bindHost: '127.0.0.1', port: 0, discoveryEnabled: false });
const address = { host: '192.0.2.1', port: 47832 };
try {
  globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }); };
  await assert.rejects(lan.probeCandidate({ address }), { code: 'PROBE_REFUSED' });

  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(options.signal.reason), 5_100);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
  });
  await assert.rejects(lan.probeCandidate({ address }), { code: 'PROBE_TIMEOUT' });
} finally {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
}
console.log('LAN probe diagnostics passed: refused TCP and 5-second timeout are distinct');
