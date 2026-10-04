#!/usr/bin/env node
// Isolated real Harness/Session + local deterministic model gateway; no paid provider.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const [modulesArg, cacheArg, fixtureArg, outputArg] = process.argv.slice(2);
assert.ok(modulesArg && cacheArg && fixtureArg && outputArg, 'Pass candidate node_modules, prepared SenseVoice cache root, 16k WAV, evidence directory');
const modules = resolve(modulesArg), cache = resolve(cacheArg), output = resolve(outputArg), repo = resolve(import.meta.dirname, '../../..');
const desktop = createRequire(join(repo, 'apps/desktop/package.json')), { _electron } = desktop('playwright');
const transcriptAudio = readFileSync(resolve(fixtureArg)).toString('base64');
const requests = [], reply = '已收到你的这句话，这是当前会话的回答。';
const gateway = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw), user = body.messages.findLast(message => message.role === 'user');
  requests.push({ user: user.content, path: req.url });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } })}\n\ndata: [DONE]\n\n`);
});
await new Promise(done => gateway.listen(0, '127.0.0.1', done));
mkdirSync(output, { recursive: true });
const evidence = [];
try {
  for (const role of ['teacher', 'classroom']) {
    const root = mkdtempSync(join(tmpdir(), `mochi-voicechat-${role}-`)), home = join(root, 'home'), profile = join(home, 'profiles/web');
    let host, app, log = '', page, sessionId;
    const errors = []; let before;
    const until = async (predicate, label) => { const end = Date.now() + 60000; while (Date.now() < end) { const value = await predicate(); if (value) return value; await new Promise(done => setTimeout(done, 100)); } throw Error(`${label}\n${log.replace(/token=\S+/g, 'token=[redacted]').slice(-3000)}`); };
    try {
      mkdirSync(join(profile, 'node_modules'), { recursive: true });
      symlinkSync(join(modules, '@deepseek-ai'), join(profile, 'node_modules/@deepseek-ai'));
      const localPlugins = [['mochi-voice-chat', 'client-plugins/mochi-voice-chat'], ['jxl-brand', 'client-plugins/jxl-brand'], ['jxl-theme', 'client-plugins/jxl-theme']];
      if (role === 'classroom') localPlugins.push(['mochi-classroom-assistant', 'plugins/mochi-classroom-assistant'], ['mochi-classroom-assistant-client', 'client-plugins/mochi-classroom-assistant']);
      const dependencies = {};
      for (const [name, source] of localPlugins) {
        const target = join(root, name); cpSync(join(repo, source), target, { recursive: true });
        mkdirSync(join(target, 'node_modules'), { recursive: true }); symlinkSync(join(modules, '@deepseek-ai'), join(target, 'node_modules/@deepseek-ai'));
        symlinkSync(target, join(profile, 'node_modules', name)); dependencies[name] = `link:${target}`;
      }
      const probe = join(root, 'probe'); mkdirSync(join(probe, 'node_modules'), { recursive: true }); symlinkSync(join(modules, '@deepseek-ai'), join(probe, 'node_modules/@deepseek-ai'));
      writeFileSync(join(probe, 'package.json'), JSON.stringify({ name: 'voicechat-probe', type: 'module', main: 'index.mjs' }));
      writeFileSync(join(probe, 'index.mjs'), `export const inject=['sessionController','workspaceController','speechToText'];export function apply(ctx){ctx.speechToText.prepare('sensevoice-local');const timer=setTimeout(()=>void(async()=>{try{const created=await ctx.workspaceController.create({path:${JSON.stringify(root)}});const session=await ctx.sessionController.create({workspaceId:created.workspace.workspaceId,agentPreset:'standard'});await ctx.sessionController.rename({sessionId:session.sessionId,title:'语音对话本地验收'});await ctx.sessionController.prompt({sessionId:session.sessionId,requestId:'voicechat-fixture-seed',mode:'queue',content:[{type:'text',text:'创建本机语音对话验收会话'}]},new AbortController().signal);console.log('VOICECHAT_SESSION='+session.sessionId);}catch(e){console.error('VOICECHAT_ERROR='+String(e))}})(),500);ctx.effect(()=>()=>clearTimeout(timer));}`);
      symlinkSync(probe, join(profile, 'node_modules/voicechat-probe')); dependencies['voicechat-probe'] = `link:${probe}`;
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'voicechat-fixture', private: true, dependencies, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-voice-input-bundle'] } } }));
      writeFileSync(join(profile, 'cordis.yml'), '[]\n');
      writeFileSync(join(profile, 'cordis.patch.yml'), `- id: agent-default-model\n  config: { provider: voicechat-fixture, model: fixture-model }\n- id: llm-pi-ai\n  config:\n    providers:\n      voicechat-fixture:\n        api: openai-completions\n        apiKeyEnv: VOICECHAT_FIXTURE_KEY\n        baseURL: http://127.0.0.1:${gateway.address().port}/v1\n        models:\n          - id: fixture-model\n            name: Local fixture\n            input: [text]\n            contextWindow: 262144\n            maxTokens: 4096\n- id: speech-to-text-sensevoice\n  config:\n    dataRoot: ${JSON.stringify(join(home, 'speech'))}\n    modelDirectory: ${JSON.stringify(join(cache, 'models/sensevoice-onnx'))}\n    vadModelPath: ${JSON.stringify(join(cache, 'models/silero/silero_vad.onnx'))}\n- id: ui-brand-official\n  disabled: true\n- insert:\n${localPlugins.map(([name]) => `    - id: ${name}\n      name: ${name}${name === 'mochi-classroom-assistant' ? `\n      config: { role: classroom, dataRoot: ${JSON.stringify(join(home, 'classroom'))} }` : ''}`).join('\n')}\n    - id: voicechat-probe\n      name: voicechat-probe\n`);
      host = spawn(process.execPath, [join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--port', '0', '--no-open'], { cwd: root,
        env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', VOICECHAT_FIXTURE_KEY: 'not-a-real-key', NODE_PATH: modules, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      const collect = chunk => { log = (log + chunk).slice(-30000); sessionId = log.match(/VOICECHAT_SESSION=(\S+)/)?.[1] ?? sessionId; };
      host.stdout.on('data', collect); host.stderr.on('data', collect);
      const url = await until(() => log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0], 'Host URL'); await until(() => sessionId, 'Session creation');
      const main = join(root, 'main.cjs');
      writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:1120,height:840,webPreferences:{backgroundThrottling:false}}).loadURL('about:blank'));`);
      app = await _electron.launch({ executablePath: desktop('electron'), args: [main, `--user-data-dir=${join(root, 'electron-profile')}`] }); page = await app.firstWindow();
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.__mics = []; window.__spoken = []; window.__stopped = [];
        window.mochiClassroomDesktop = { getStartup: async()=>({supported:false,enabled:false}), listeningReady: async()=>true };
        window.mochiVoiceChatDesktop = { speak: value => { window.__spoken.push(value); return new Promise(resolve => { window.__finishSpeak = resolve; }); }, stop: async value => { window.__stopped.push(value.id); window.__finishSpeak?.({ok:false,cancelled:true}); return {ok:true}; } };
        navigator.mediaDevices.getUserMedia = async () => {
          const context = new AudioContext({sampleRate:16000}); await context.resume(); const destination = context.createMediaStreamDestination();
          const record = {context,destination,stopped:false}; window.__mics.push(record);
          for (const track of destination.stream.getTracks()) { const stop=track.stop.bind(track); track.stop=()=>{stop();record.stopped=true;void context.close();}; }
          return destination.stream;
        };
        window.__play = async audio => { const record=window.__mics.findLast(item=>!item.stopped), source=record.context.createBufferSource(); source.buffer=await record.context.decodeAudioData(Uint8Array.from(atob(audio),c=>c.charCodeAt(0)).buffer);source.connect(record.destination);await new Promise(resolve=>{source.onended=resolve;source.start();}); };
      });
      await page.goto(url); await page.getByRole('button', { name: '继续', exact: true }).click();
      const later = page.getByRole('button', { name: '稍后配置', exact: true }); if (await later.count()) await later.click();
      await page.getByText('语音对话本地验收', { exact: true }).first().click();
      before = requests.length;
      const entry = page.getByRole('button', { name: '开启语音对话', exact: true }); await entry.waitFor(); assert.equal(await entry.getAttribute('aria-pressed'), 'false');
      const composer = page.locator('[data-composer-input="true"]').filter({ visible: true }).last(); await composer.click(); await page.keyboard.insertText('保留未发送的输入草稿');
      await entry.click(); await page.locator('[data-mochi-voice-chat="listening"]').waitFor();
      assert.equal(await page.evaluate(()=>window.__mics.filter(item=>!item.stopped).length),1);
      await page.evaluate(audio=>window.__play(audio), transcriptAudio);
      await page.locator('[data-mochi-voice-chat="speaking"]').waitFor({ timeout:30000 });
      assert.equal(await page.evaluate(()=>window.__mics.filter(item=>!item.stopped).length),0);
      assert.equal(await composer.innerText(), '保留未发送的输入草稿');
      const spoken = await page.evaluate(()=>window.__spoken[0]); assert.equal(spoken.text, reply);
      await page.getByText(reply, {exact:true}).last().waitFor();
      assert.equal(await page.locator('[data-conversation-content]').getAttribute('data-conversation-session'),sessionId);
      assert.equal(requests.length-before,1); assert.match(JSON.stringify(requests.at(-1).user),/数学课本第(?:20|二十)页/);
      await page.getByRole('button',{name:'打断并继续听',exact:true}).click(); await page.locator('[data-mochi-voice-chat="listening"]').waitFor();
      assert.deepEqual(await page.evaluate(()=>window.__stopped),[spoken.id]);
      await page.getByRole('button',{name:'结束语音对话',exact:true}).click(); assert.equal(await entry.getAttribute('aria-pressed'),'false');
      if(role==='classroom') await page.waitForFunction(()=>window.mochiClassroomListening.snapshot().state==='listening');
      assert.deepEqual(errors,[]);
      await page.screenshot({path:join(output,`${role}-voice-chat.png`)});
      evidence.push({role,sessionId,defaultOff:true,realAsr:true,localModelFixture:true,actualNativeSpeaker:false,spokenReply:spoken.text,request:requests.at(-1),draftPreserved:true,currentSession:true,stopOwnedPlayback:true,errors});
      console.log(`PASS: ${role} real ASR → current Session → local gateway reply → cancellable playback bridge; default off`);
    } catch(error) { if(page){await page.screenshot({path:join(output,`${role}-failure.png`)}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3500));console.error({errors});} throw error; }
    finally { await app?.close().catch(()=>{}); if(host?.exitCode === null) await new Promise(done => { const timeout=setTimeout(()=>{host.kill('SIGKILL');done();},5000);host.once('exit',()=>{clearTimeout(timeout);done();});host.kill('SIGTERM'); }); rmSync(root,{recursive:true,force:true}); }
  }
  writeFileSync(join(output,'voice-chat-checkpoints.json'),JSON.stringify(evidence,null,2));
} finally { await new Promise(done=>gateway.close(done)); }
