#!/usr/bin/env node
// Complete packaged rc.2 Host, source migration code, disposable home, loopback only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repo = resolve(import.meta.dirname, '../../..');
const app = resolve(process.argv[2] || join(repo, 'apps/desktop/release/mac-arm64/Mochi.app'));
const resources = join(app, 'Contents/Resources/mochi');
const modules = join(resources, 'node_modules');
const binary = join(app, 'Contents/MacOS/Mochi');
const require = createRequire(import.meta.url);
const runtime = require(join(repo, 'apps/desktop/resources/mochi-web/runtime-profile.cjs'));
const yaml = createRequire(join(modules, '@deepseek-ai/dsh/package.json'))('yaml');
const root = mkdtempSync(join(tmpdir(), 'mochi-legacy-gateway-'));
const home = join(root, 'home');
const requests = [];
let child;
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push({ path: req.url, authorized: req.headers.authorization === 'Bearer fixture-never-real', body });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const parts = body.tools?.length ? [
    { delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-tool', type: 'function', function: { name: 'lookup', arguments: '{"topic":' } }] } },
    { delta: { tool_calls: [{ index: 0, function: { arguments: '"课堂"}' } }] } },
    { delta: {}, finish_reason: 'tool_calls' },
  ] : [{ delta: { role: 'assistant', content: '本地协议夹具回复' } }, { delta: {}, finish_reason: 'stop' }];
  res.end(parts.map(part => `data: ${JSON.stringify({ choices: [{ index: 0, ...part }] })}\n\n`).join('') + 'data: [DONE]\n\n');
});
const options = { homeDir: home, resourceRoot: join(repo, 'apps/desktop/resources/mochi-web'), skillsDir: join(resources, 'skills'),
  pluginRoot: join(resources, 'plugins'), runtimeNodeModulesRoot: modules, role: 'teacher' };
async function run(round) {
  const output = await new Promise((done, reject) => {
    child = spawn(binary, [join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'mochi-web', '--port', '0', '--no-open'], {
      cwd: root, env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home, NODE_PATH: modules, ELECTRON_RUN_AS_NODE: '1',
        DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', FIXTURE_GATEWAY_REF: 'fixture-never-real' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = ''; const collect = chunk => { log = (log + chunk).slice(-64000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('Host timeout\n' + log.replace(/token=\S+/g, 'token=[redacted]'))); }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); child = undefined;
      if (code === 0) done(log); else reject(Error(log.replace(/token=\S+/g, 'token=[redacted]'))); });
  });
  assert.ok(!output.includes('DUPLICATE_ADAPTER'), 'No route collision');
  const marker = output.split('\n').find(line => line.startsWith('GATEWAY_PROBE=')); assert.ok(marker, output.replace(/token=\S+/g, 'token=[redacted]'));
  const result = JSON.parse(marker.slice('GATEWAY_PROBE='.length));
  assert.equal(result.directory.settingsNs, 'llm-pi-ai');
  assert.equal(result.defaultModel.provider, 'deepseek-official', output.replace(/token=\S+/g, 'token=[redacted]')); assert.equal(result.defaultModel.model, 'custom-pro');
  assert.equal(result.defaultModel.reasoningEffort, 'medium'); assert.deepEqual(result.models, ['custom-fast', 'custom-pro']);
  assert.equal(result.toolEnd, true); assert.equal(result.offEnd, 'stop');
  assert.equal(result.route.apiKeyEnv, 'FIXTURE_GATEWAY_REF'); assert.equal(result.route.models[0].description, 'Original description');
  return { round, ...result };
}
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done)); mkdirSync(home);
  const settings = { 'llm-deepseek': { apiKeyEnv: 'FIXTURE_GATEWAY_REF', baseURL: `http://127.0.0.1:${server.address().port}/v1`, thinking: 'enabled', reasoningEffort: 'medium',
    models: [{ id: 'custom-fast', name: 'Custom fast', description: 'Original description', contextWindow: 1000000, maxTokens: 12345 }, { id: 'custom-pro', name: 'Custom pro', contextWindow: 1000000, maxTokens: 54321 }] },
    'agent-default-model': { provider: 'deepseek-official', model: 'custom-pro', reasoningEffort: 'medium' },
    'llm-pi-ai': { providers: { unrelated: { api: 'openai-completions', baseURL: 'http://127.0.0.1:9/v1', apiKeyEnv: 'UNUSED_FIXTURE_REF', models: [{ id: 'unrelated-model' }] } } } };
  const source = yaml.stringify(settings); writeFileSync(join(home, 'settings.yaml'), source, { mode: 0o600 });
  runtime.provisionMochiProfiles(options);
  const probe = join(root, 'probe'); mkdirSync(join(probe, 'node_modules'), { recursive: true });
  symlinkSync(join(modules, '@deepseek-ai'), join(probe, 'node_modules/@deepseek-ai'));
  writeFileSync(join(probe, 'package.json'), JSON.stringify({ name: 'gateway-migration-probe', type: 'module', main: 'index.mjs' }));
  writeFileSync(join(probe, 'index.mjs'), `export const inject=['llm','settings','agentDefaultModel'];export function apply(ctx){const t=setTimeout(()=>void(async()=>{try{
const directory=ctx.llm.listConfigurableProviders().find(x=>x.provider==='deepseek-official');
const models=(await ctx.llm.listModels('deepseek-official')).map(x=>x.id).sort();const defaultModel=ctx.agentDefaultModel.currentSelection();
const settings=ctx.settings.describe().find(x=>x.ns==='llm-pi-ai').value;const route=settings.providers['deepseek-official'];
const chunks=[];for await(const chunk of ctx.llm.stream({provider:defaultModel.provider,model:defaultModel.model,reasoningEffort:'medium',maxTokens:32,system:'Fixture system prompt',messages:[{role:'user',content:[{type:'text',text:'Loopback migration probe'}]}],tools:[{name:'lookup',description:'Fixture tool',parameters:{type:'object',properties:{topic:{type:'string'}}}}]}))chunks.push(chunk);
const off=[];for await(const chunk of ctx.llm.stream({provider:defaultModel.provider,model:defaultModel.model,reasoningEffort:'off',messages:[{role:'user',content:[{type:'text',text:'Off fixture'}]}]}))off.push(chunk);
console.log('GATEWAY_PROBE='+JSON.stringify({directory,models,defaultModel,route,toolEnd:chunks.some(c=>c.type==='block-end'&&c.block?.type==='tool-call'),offEnd:off.at(-1).reason.kind}));process.exit(0);
}catch(e){console.error('GATEWAY_PROBE_ERROR='+e.stack);process.exit(1)}})(),1000);ctx.effect(()=>()=>clearTimeout(t));}`);
  const profile = join(home, 'profiles/mochi-web'); symlinkSync(probe, join(profile, 'node_modules/gateway-migration-probe'));
  const manifestPath = join(profile, 'package.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['gateway-migration-probe'] = 'link:' + probe; writeFileSync(manifestPath, JSON.stringify(manifest));
  const patchPath = join(profile, 'cordis.patch.yml'); writeFileSync(patchPath, readFileSync(patchPath, 'utf8') + '\n- insert:\n    - id: gateway-migration-probe\n      name: gateway-migration-probe\n');
  const results = [await run('first-import')]; assert.equal(existsSync(join(home, 'settings.yaml')), false);
  assert.ok(existsSync(join(home, 'settings.yaml.imported'))); assert.equal(readFileSync(join(home, '.mochi-settings-legacy.yaml'), 'utf8'), source);
  runtime.provisionMochiProfiles(options); results.push(await run('imported-cold-restart'));
  assert.equal(requests.length, 4); for (const [index, request] of requests.entries()) {
    assert.equal(request.path, '/v1/chat/completions'); assert.equal(request.authorized, true); assert.equal(request.body.model, 'custom-pro');
    assert.equal(request.body.max_completion_tokens, undefined); assert.ok(request.body.messages.every(x => x.role !== 'developer'));
    if (index % 2 === 0) { assert.equal(request.body.reasoning_effort, 'medium'); assert.equal(request.body.thinking.type, 'enabled'); assert.equal(request.body.max_tokens, 32); assert.equal(request.body.messages[0].role, 'system'); }
    else { assert.equal(request.body.thinking.type, 'disabled'); assert.equal(request.body.reasoning_effort, undefined); }
  }
  const evidence = resolve(process.argv[3] || join(repo, 'docs/evidence/harness-upgrade-2026-09-30/settings-gateway-runtime.json'));
  const report = { passed: true, sourceMigrationPackagedRuntime: true, electron: '44.0.0', harness: '0.2.0-rc.2', paidProvider: false, realHomeReadOrWritten: false,
    preservedProviderRoute: true, preservedEndpoint: true, preservedDefaultAndCredentialReferences: true, firstImportAndColdRestart: true, officialRouteDisabled: true, results, requests };
  writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ passed: true, rounds: results.length, requests: requests.length, evidence }));
} finally { child?.kill('SIGTERM'); server.closeAllConnections(); await new Promise(done => server.close(done)); rmSync(root, { recursive: true, force: true }); }
