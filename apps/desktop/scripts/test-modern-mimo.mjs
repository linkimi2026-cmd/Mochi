#!/usr/bin/env node
// Exercise the published adapter against a local HTTP fixture; no real credential or model call.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const nodeModules = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass isolated candidate node_modules');
const require = createRequire(import.meta.url);
const { migrateMimoConfig, migrateMimoPatch } = require('../resources/mochi-web/modern-models.cjs');
const source = require('../resources/mochi-web/runtime-profile.json').plugins['mochi-llm-mimo'].initialConfig;
const { Config, apply } = await import(pathToFileURL(join(nodeModules, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js')));
const requests = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(raw) });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('data: '+JSON.stringify({ id:'fixture', object:'chat.completion.chunk', choices:[{ index:0, delta:{role:'assistant', content:'课堂语音输入测试'}, finish_reason:null }] })+'\n\n' +
    'data: '+JSON.stringify({ id:'fixture', choices:[{index:0, delta:{}, finish_reason:'stop'}], usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7} })+'\n\ndata: [DONE]\n\n');
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
try {
  const migrated = migrateMimoConfig({ ...source, baseURL:`http://127.0.0.1:${server.address().port}/v1` });
  assert.deepEqual(migrated.providers['mochi-mimo'].models[0].input, ['text','image']);
  assert.equal(migrated.providers['mochi-mimo'].models[0].reasoningEfforts.off, null);
  assert.throws(() => migrateMimoConfig({ ...source, unknownField:true }), /尚未迁移/);
  const untouched = '- id: untouched\n  config: { example: keep }\n';
  const patch = untouched + '- insert:\n    - id: mochi-llm-mimo\n      name: mochi-llm-mimo\n      config: '+JSON.stringify(source)+'\n';
  const converted = migrateMimoPatch(patch, nodeModules);
  assert.equal(migrateMimoPatch(converted, nodeModules), converted);
  assert.match(converted, /example: keep/);
  let adapter;
  const registration = () => ({ replace() {} });
  const ctx = {
    fiber: { entry: { options: { id:'llm-pi-ai' } } },
    inject() {}, on() {}, effect() {}, logger: { warn() {}, error() {} },
    get(name) { return name === 'credentials' ? { async resolve(ref) { assert.equal(ref,'MIMO_API_KEY');return {value:'fixture-only-key'}; } } : undefined; },
    llm: { registerConfigurableProviders: registration, registerModelDiscovery() {}, registerAdapter(routes, instance) { assert.deepEqual(routes,['mochi-mimo']);adapter=instance;return registration(); } },
  };
  apply(ctx, Config(migrated));
  const chunks = [];
  for await (const chunk of adapter.stream({ provider:'mochi-mimo', model:'mimo-v2.5', reasoningEffort:'low', messages:[{role:'user',content:[{type:'text',text:'测试课堂语音输入'}]}] })) chunks.push(chunk);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/v1/chat/completions');
  assert.equal(requests[0].authorization,'Bearer fixture-only-key');
  assert.equal(requests[0].body.model,'mimo-v2.5');
  assert.match(JSON.stringify(chunks), /课堂语音输入测试/);
  console.log('PASS: real 0.2 pi-ai adapter uses OpenAI completions, credential reference, model and streamed reply; migration is idempotent');
} finally { server.closeAllConnections();await new Promise(done=>server.close(done)); }
