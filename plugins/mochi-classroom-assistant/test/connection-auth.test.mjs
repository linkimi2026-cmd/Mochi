import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HomeworkStore } from '../homework-store.mjs';
import { installClassroomHostBridge } from '../host-bridge.mjs';
import { encodeWave } from '../../../client-plugins/mochi-classroom-assistant/recorder.mjs';

const runtime = createRequire(process.env.MOCHI_CLASSROOM_TEST_RUNTIME ?? new URL('../../../../apps/desktop/package.json', import.meta.url));
const { Context } = await import(runtime.resolve('@deepseek-ai/cordis'));
const connectionModule = await import(runtime.resolve('@deepseek-ai/dsh-client-connection'));
const { validateWave } = await import(runtime.resolve('@deepseek-ai/dsh-experimental-speech-to-text/wave'));
test('real 0.2 Connection authenticates transcript/state/edit, rejects foreign Origin before recognition', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-classroom-auth-')), ctx = new Context(), routes = [];
  let record, calls = 0;
  ctx.provide('credentials', { modifyRecord: async (_key, mutate) => { const next = await mutate(record); if (next !== undefined) record = next; return record; } });
  ctx.provide('webServer', { register: route => { routes.push(route); return () => {}; } });
  const connection = ctx.plugin({ inject: connectionModule.inject, apply: connectionModule.apply }, { trustedHosts: [] });
  await connection.await();
  ctx.provide('speechToText', { snapshot: () => ({ providers: [{ id: 'local', location: 'host-local', preparation: { phase: 'ready' } }], selection: { providerId: 'local', language: 'zh' } }), resolve: input => input, transcribe: async () => { calls++; return { text: '今天作业第3题。' }; } });
  const store = new HomeworkStore(join(dir, 'work.json'));
  const plugin = ctx.plugin({ apply: host => installClassroomHostBridge(host, store, { validateWave }), inject: ['connection', 'speechToText'] }); await plugin.await();
  const api = routes.find(route => route.path === '/api'); assert.ok(api);
  const server = createServer(async (request, response) => {
    if (request.url.startsWith('/api/')) await api.handler(request, response);
    else if (ctx.connection.authorizeIndex(request, response)) response.writeHead(200).end('index');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/state', '/edit', '/transcribe']) {
      const response = await fetch(origin + '/api/mochi-classroom' + path, path === '/state' ? {} : { method: 'POST', body: '{}' }); assert.equal(response.status, 401);
    }
    const auth = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' }); assert.equal(auth.status, 303);
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(origin + '/api/mochi-classroom/state', { headers: { cookie } })).status, 200);
    const wave = encodeWave(new Float32Array(16000).fill(.1));
    assert.equal((await fetch(origin + '/api/mochi-classroom/transcribe', { method: 'POST', headers: { cookie, origin: 'https://foreign.invalid' }, body: wave })).status, 403); assert.equal(calls, 0);
    const response = await fetch(origin + '/api/mochi-classroom/transcribe', { method: 'POST', headers: { cookie, origin }, body: wave });
    assert.equal(response.status, 200); assert.equal((await response.json()).intent.kind, 'begin'); assert.equal(calls, 1);
  } finally {
    await new Promise(resolve => server.close(resolve)); await plugin.dispose(); await connection.dispose(); rmSync(dir, { recursive: true, force: true });
  }
});
