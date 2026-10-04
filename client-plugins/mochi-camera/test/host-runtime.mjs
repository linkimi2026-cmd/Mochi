#!/usr/bin/env node
// Real candidate Harness + Electron fake camera + local model gateway; no paid endpoint.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const modules = resolve(process.argv[2] || '/tmp/mochi-harness-020-probe/node_modules');
const repo = resolve(import.meta.dirname, '../../..');
const requireDesktop = createRequire(join(repo, 'apps/desktop/package.json'));
const { _electron } = requireDesktop('playwright');
const root = mkdtempSync(join(tmpdir(), 'mochi-camera-host-'));
const home = join(root, 'home');
const profile = join(home, 'profiles/web');
const evidence = process.env.MOCHI_CAMERA_EVIDENCE_DIR;
const requests = [];
let host;
let electron;
let hostLog = '';
let sessionId;
const gateway = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const images = body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'image_url') : []);
  const result = body.messages.find(message => message.role === 'tool' && message.tool_call_id === 'camera-fixture-call');
  const hasCameraTool = body.tools?.some(tool => tool.function?.name === 'mochi_open_camera') || false;
  requests.push({ images: images.map(image => ({ jpeg: image.image_url.url.startsWith('data:image/jpeg;base64,'), bytes: image.image_url.url.length })), hasCameraTool, hasToolResult: Boolean(result) });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = hasCameraTool && !result && images.length === 0
    ? { role: 'assistant', tool_calls: [{ index: 0, id: 'camera-fixture-call', type: 'function', function: { name: 'mochi_open_camera', arguments: '{}' } }] }
    : { role: 'assistant', content: images.length ? '已收到题目图片（本地模型夹具）。' : '请拍照并检查草稿图片。' };
  res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } })}\n\ndata: [DONE]\n\n`);
});
const sleep = (ms) => new Promise(done => setTimeout(done, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await sleep(100); }
  throw Error(`Timeout: ${label}\n${hostLog.replace(/token=\S+/g, 'token=[redacted]').slice(-5000)}`);
}
function inventory(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? inventory(join(dir, entry.name)) : [join(dir, entry.name)]);
}

try {
  await new Promise(done => gateway.listen(0, '127.0.0.1', done));
  mkdirSync(join(profile, 'node_modules'), { recursive: true });
  symlinkSync(join(modules, '@deepseek-ai'), join(profile, 'node_modules/@deepseek-ai'));
  for (const [name, source] of [['mochi-camera', 'plugins/mochi-camera'], ['mochi-camera-client', 'client-plugins/mochi-camera']]) {
    const target = join(root, name);
    cpSync(join(repo, source), target, { recursive: true });
    mkdirSync(join(target, 'node_modules'));
    symlinkSync(join(modules, '@deepseek-ai'), join(target, 'node_modules/@deepseek-ai'));
    symlinkSync(target, join(profile, 'node_modules', name));
  }
  const probe = join(root, 'probe'); mkdirSync(join(probe, 'node_modules'), { recursive: true });
  symlinkSync(join(modules, '@deepseek-ai'), join(probe, 'node_modules/@deepseek-ai'));
  writeFileSync(join(probe, 'package.json'), JSON.stringify({ name: 'camera-fixture-probe', type: 'module', main: 'index.mjs' }));
  writeFileSync(join(probe, 'index.mjs'), `export const inject=['sessionController','workspaceController'];export function apply(ctx){const timer=setTimeout(()=>void(async()=>{try{const created=await ctx.workspaceController.create({path:${JSON.stringify(root)}});const workspace=created.workspace;const session=await ctx.sessionController.create({workspaceId:workspace.workspaceId,agentPreset:'standard'});await ctx.sessionController.rename({sessionId:session.sessionId,title:'摄像头链路验收'});console.log('CAMERA_SESSION='+session.sessionId);}catch(e){console.error('CAMERA_SESSION_ERROR='+String(e))}})(),500);ctx.effect(()=>()=>clearTimeout(timer));}`);
  symlinkSync(probe, join(profile, 'node_modules/camera-fixture-probe'));
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'camera-fixture-profile', private: true, dependencies: { 'mochi-camera': 'link:'+join(root,'mochi-camera'), 'mochi-camera-client': 'link:'+join(root,'mochi-camera-client'), 'camera-fixture-probe': 'link:'+probe }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
  writeFileSync(join(profile, 'cordis.yml'), '[]\n');
  writeFileSync(join(profile, 'cordis.patch.yml'), `- id: agent-default-model\n  config: { provider: camera-fixture, model: camera-model }\n- id: llm-pi-ai\n  config:\n    providers:\n      camera-fixture:\n        api: openai-completions\n        apiKeyEnv: CAMERA_FIXTURE_KEY\n        baseURL: http://127.0.0.1:${gateway.address().port}/v1\n        models:\n          - id: camera-model\n            name: Camera fixture\n            input: [text, image]\n            contextWindow: 262144\n            maxTokens: 4096\n- insert:\n    - id: mochi-camera\n      name: mochi-camera\n    - id: mochi-camera-client\n      name: mochi-camera-client\n    - id: camera-fixture-probe\n      name: camera-fixture-probe\n`);
  host = spawn(process.execPath, [join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--port', '0', '--no-open'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', CAMERA_FIXTURE_KEY: 'camera-fixture-never-real', NODE_PATH: modules, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = chunk => { hostLog = (hostLog + chunk).slice(-30000); const found = hostLog.match(/CAMERA_SESSION=(\S+)/); if (found) sessionId = found[1]; };
  host.stdout.on('data', collect); host.stderr.on('data', collect);
  const url = await until(() => hostLog.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0], 'host URL');
  await until(() => sessionId, 'fixture session');
  const main = join(root, 'main.cjs');
  writeFileSync(main, `const{app,BrowserWindow,session}=require('electron');app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('lang','zh-CN');app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(true));const w=new BrowserWindow({width:1120,height:840,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});w.loadURL(${JSON.stringify(url)})});`);
  electron = await _electron.launch({ executablePath: requireDesktop('electron'), args: [main, `--user-data-dir=${join(root, 'electron-profile')}`] });
  const page = await electron.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState();
  const onboarding = page.getByRole('button', { name: '继续', exact: true });
  await onboarding.click();
  const later = page.getByRole('button', { name: '稍后配置', exact: true });
  if (await later.count()) await later.click();
  const composer = page.locator('[data-composer-input="true"]').filter({ visible: true }).last();
  await composer.click(); await page.keyboard.insertText('请看展台上的题目');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('dialog', { name: '摄像头 / 展台拍题' }).waitFor();
  await page.waitForFunction(() => { const video = document.querySelector('.mochi-camera__video'); return video?.readyState >= 2 && video.videoWidth > 0; });
  assert.ok(requests.some(request => request.hasCameraTool && request.hasToolResult), 'actual model tool schema and result');
  const media = await page.evaluate(() => { const video=document.querySelector('.mochi-camera__video'); window.cameraTrack=video.srcObject.getVideoTracks()[0];return {width:video.videoWidth,height:video.videoHeight,audio:video.srcObject.getAudioTracks().length,devices:document.querySelector('select[aria-label="视频设备"]').options.length}; });
  assert.equal(media.audio, 0); assert.ok(media.devices > 1);
  await page.locator('select[aria-label="视频设备"]').selectOption('');
  await page.waitForFunction(() => window.cameraTrack.readyState === 'ended' && document.querySelector('.mochi-camera__video').srcObject?.getVideoTracks()[0]?.readyState === 'live');
  await page.evaluate(() => { window.cameraTrack = document.querySelector('.mochi-camera__video').srcObject.getVideoTracks()[0]; });
  if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'camera-preview.png') }); }
  await page.getByRole('button', { name: '拍照并加入草稿', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.cameraTrack.readyState === 'ended');
  assert.ok(await page.locator('[data-composer-card] img').count(), 'real official draft thumbnail');
  assert.ok(!requests.some(request => request.images.length), 'capture did not send automatically');
  await composer.click(); await page.keyboard.insertText('请解答图片中的题目'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await until(() => requests.some(request => request.images.some(image => image.jpeg)), 'provider JPEG request');
  await page.getByText('已收到题目图片（本地模型夹具）。', { exact: true }).last().waitFor();
  const stored = inventory(join(home, 'attachments/v1'));
  assert.ok(stored.some(path => readFileSync(path)[0] === 0xff), 'official durable JPEG bytes');
  await page.getByRole('button', { name: '摄像头或展台拍题' }).click();
  await page.waitForFunction(() => document.querySelector('.mochi-camera__video')?.srcObject?.getVideoTracks().length === 1);
  await page.evaluate(() => { window.cameraCancelTrack=document.querySelector('.mochi-camera__video').srcObject.getVideoTracks()[0]; });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.cameraCancelTrack.readyState === 'ended');
  await page.reload();
  await page.getByRole('button', { name: '摄像头或展台拍题' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.mochi-camera__dialog')?.open === false);
  assert.equal(await page.evaluate(() => document.querySelector('.mochi-camera__video').srcObject), null, 'history replay did not reopen a camera');
  await page.getByRole('button', { name: '摄像头或展台拍题' }).click();
  await page.waitForFunction(() => document.querySelector('.mochi-camera__video').srcObject?.getVideoTracks()[0]?.readyState === 'live');
  await page.evaluate(() => { window.cameraSwitchTrack=document.querySelector('.mochi-camera__video').srcObject.getVideoTracks()[0]; });
  await page.keyboard.press('Alt+Meta+n');
  await page.waitForFunction(() => window.cameraSwitchTrack.readyState === 'ended');
  assert.deepEqual(errors, []);
  const result = { officialHarness: '0.2.0-rc.2', fakeCamera: true, media, requests, persistedObjects: stored.length, cameraReleasedAfterDeviceSwitch: true, cameraReleasedAfterCapture: true, cameraReleasedAfterEscape: true, historyDoesNotOpenCamera: true, cameraReleasedAfterSessionSwitch: true, errors };
  if (evidence) writeFileSync(join(evidence, 'camera-runtime.json'), JSON.stringify(result, null, 2)+'\n');
  console.log(JSON.stringify(result));
} catch (error) {
  if (electron) console.error((await (await electron.firstWindow()).locator('body').innerText().catch(() => '')).slice(0, 4000));
  console.error(JSON.stringify({ requests, host: hostLog.replace(/token=\S+/g, 'token=[redacted]').slice(-4000) }));
  throw error;
} finally {
  await electron?.close();
  if (host && host.exitCode === null) { host.kill('SIGTERM'); await Promise.race([new Promise(done => host.once('exit', done)), sleep(5000)]); }
  gateway.closeAllConnections(); await new Promise(done => gateway.close(done));
  rmSync(root, { recursive: true, force: true });
}
