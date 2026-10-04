#!/usr/bin/env node
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const [appPath, fixtures, outputDir] = process.argv.slice(2);
assert.ok(appPath && fixtures && outputDir,'Pass actual Mochi.app, synthetic fixtures, evidence dir');
const binary=join(resolve(appPath),'Contents/MacOS/Mochi'),resources=join(resolve(appPath),'Contents/Resources/mochi');
const output=resolve(outputDir),root=mkdtempSync(join(tmpdir(),'mochi-packaged-listening-')),home=join(root,'home');
mkdirSync(output,{recursive:true});mkdirSync(home,{recursive:true});
// Bind the empty test home through the shipped provisioner before importing cache.
// Classroom correctly rejects a nonempty unbound home to preserve role isolation.
require(join(resources,'profile/runtime-profile.cjs')).provisionMochiProfiles({homeDir:home,role:'classroom',
 resourceRoot:join(resources,'profile'),skillsDir:join(resources,'skills'),pluginRoot:join(resources,'plugins'),runtimeNodeModulesRoot:join(resources,'node_modules')});
cpSync('/tmp/mochi-harness-020-probe/debug-v3/speech-to-text/sensevoice/models',join(home,'speech-to-text/sensevoice/models'),{recursive:true});
const manifestSha256=createHash('sha256').update(readFileSync(join(resources,'package-integrity.json'))).digest('hex');
const resourceSha256=Object.fromEntries(['mochi-classroom-assistant/index.mjs', 'mochi-classroom-assistant/host-bridge.mjs', 'mochi-classroom-assistant/listening.mjs', 'mochi-classroom-assistant/intents.mjs', 'mochi-classroom-assistant/lesson-notes.mjs', 'mochi-classroom-assistant/homework-store.mjs', 'mochi-classroom-assistant-client/client.js'].map(file=>[file,createHash('sha256').update(readFileSync(join(resources,'plugins',file))).digest('hex')]));
let app, page;
try {
  app=await _electron.launch({executablePath:binary,args:['--role=classroom','--no-sandbox',`--user-data-dir=${root}/profile`],env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,MOCHI_RUNTIME_HOME:home,MOCHI_DSH_PORT:'0',DSH_TELEMETRY_DISABLED:'1',LANG:'zh_CN.UTF-8'}});
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){page=app.windows().find(window=>/^https?:/.test(window.url()));if(page)break;await new Promise(done=>setTimeout(done,100));}
  assert.ok(page,'Packaged Host main window');
  const runtime=await app.evaluate(({app})=>({electron:process.versions.electron,node:process.versions.node,packaged:app.isPackaged}));
  assert.equal(runtime.electron,'44.0.0');assert.equal(runtime.packaged,true);
  const errors = [], results = [];
  globalThis.packagedListeningResults=results;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => { if (new URL(response.url()).pathname === '/api/mochi-classroom/transcribe') results.push(await response.json()); });
  await app.context().addInitScript(() => {
    window.__microphones = [];
    window.__classroomEvents = { wakes: 0, letters: [], ready: 0, states:[] };
    window.addEventListener('mochi-classroom-listening-state',event=>window.__classroomEvents.states.push(event.detail));
    window.addEventListener('mochi-classroom-letter',event=>window.__classroomEvents.letters.push(event.detail));
    window.addEventListener('mochi-classroom-wake',()=>window.__classroomEvents.wakes++);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints.audio || constraints.video) throw Error('Synthetic audio only');
      const context = new AudioContext({ sampleRate: 16000 }); await context.resume();
      const destination = context.createMediaStreamDestination();
      const record = { context, destination, stopped: false };
      window.__microphones.push(record);
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); if (!record.stopped) { record.stopped = true; void context.close(); } };
      }
      return destination.stream;
    };
    window.__playFixture = async base64 => {
      const record = window.__microphones.findLast(item => !item.stopped);
      if (!record) throw Error('Listener has not acquired the synthetic microphone');
      const source = record.context.createBufferSource();
      source.buffer = await record.context.decodeAudioData(Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer);
      source.connect(record.destination); await new Promise(resolve => { source.onended = resolve; source.start(); });
    };
  });
  await page.waitForTimeout(5000);
  await page.reload();
  await page.getByRole('button',{name:'继续',exact:true}).waitFor({timeout:60000});
  await page.waitForTimeout(1600);
  for (const name of ['继续', '稍后配置']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
    await page.waitForTimeout(250);
  }
  const deferProfile=page.getByRole('button',{name:'稍后设置',exact:true});
  await deferProfile.waitFor({timeout:15000});await deferProfile.click();
  const closeMailbox=page.getByRole('button',{name:'关闭小信箱',exact:true});
  if(await closeMailbox.isVisible())await closeMailbox.click();else await page.keyboard.press('Escape');
  await page.locator('button[data-mochi-classroom-status]').waitFor();
  await page.locator('button[data-mochi-classroom-status]').click();
  const prepare=page.getByRole('button',{name:'准备本地识别模型',exact:true});
  if(await prepare.isVisible())await prepare.click();
  await page.waitForFunction(()=>window.mochiClassroomListening?.snapshot().state==='listening',null,{timeout:60000,polling:100});
  await page.getByRole('dialog',{name:'课堂助手',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  await page.waitForFunction(() => window.mochiClassroomListening?.snapshot().state === 'listening', null, { timeout: 30000 });
  await page.evaluate(async () => { const state = await (await fetch('/api/mochi-classroom/state')).json(); if (state.lessonActive) await fetch('/api/mochi-classroom/lesson/finish', { method: 'POST' }); });
  await page.waitForFunction(() => !window.mochiClassroomListening.snapshot().recordingLesson);
  assert.equal(await page.evaluate(() => window.__classroomEvents.wakes), 0);
  const sendAudio = name => page.evaluate(base64 => window.__playFixture(base64), readFileSync(join(fixtures, `${name}.wav`)).toString('base64'));
  await sendAudio('lesson-begin');
  await page.waitForFunction(() => window.mochiClassroomListening.snapshot().recordingLesson, null, { timeout: 20000 });
  await sendAudio('lesson-content');
  await page.waitForTimeout(1400);
  await page.waitForFunction(async () => (await (await fetch('/api/mochi-classroom/state')).json()).lessonActive?.segments.length > 0, null, { timeout: 20000 });
  await sendAudio('lesson-finish');
  await page.getByRole('textbox',{name:'课堂重点信件正文',exact:true}).waitFor({timeout:25000});
  const letter = await page.evaluate(async () => (await (await fetch('/api/mochi-classroom/state')).json()).letters.findLast(item => item.kind === 'lesson'));
  assert.equal(letter.kind, 'lesson'); assert.equal(letter.method, 'local-extractive'); assert.ok(letter.notes.length > 0);
  assert.match(letter.segments[0].text, /分母/);
  const editor = page.getByRole('textbox', { name: '课堂重点信件正文', exact: true });
  await editor.fill('未保存的课堂重点草稿。');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.evaluate(() => window.mochiClassroomListening.snapshot().state), 'listening');
  await page.evaluate(() => window.mochiClassroomListening.open());
  assert.equal(await editor.inputValue(), '未保存的课堂重点草稿。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForFunction(async () => (await (await fetch('/api/mochi-classroom/state')).json()).letters.findLast(item => item.kind === 'lesson').edited);
  await page.getByText('查看重点来源与本节课原文', { exact: true }).click();
  await page.screenshot({ path: join(output, 'classroom-homework-letter.png') });
  await page.locator('.mochi-classroom-backdrop').click({ position: { x: 2, y: 2 } });
  assert.equal(await page.evaluate(() => window.mochiClassroomListening.snapshot().state), 'listening');
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>/^http:/.test(w.webContents.getURL()));w.hide()});
  const reallyHidden=await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows().find(w=>/^http:/.test(w.webContents.getURL())).isVisible());assert.equal(reallyHidden,true);
  await sendAudio('wake');
  const wakeDeadline=Date.now()+20000;let nativeWoke=false;
  while(Date.now()<wakeDeadline){nativeWoke=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>/^http:/.test(w.webContents.getURL())).isVisible());if(nativeWoke)break;await new Promise(done=>setTimeout(done,100));}
  assert.equal(nativeWoke,true,'Actual wake IPC must reveal the hidden main window');
  assert.ok(results.some(row=>row.intent.kind==='wake'),'Wake must come from actual ASR');
  await sendAudio('homework');await page.waitForFunction(()=>window.mochiClassroomListening.snapshot().recordingHomework,null,{timeout:20000,polling:100});
  await sendAudio('finish');await page.getByRole('textbox',{name:'作业信件正文',exact:true}).waitFor({timeout:25000});
  const homeworkLetter=await page.evaluate(async()=>(await(await fetch('/api/mochi-classroom/state')).json()).letters.findLast(item=>item.kind!=='lesson'));
  assert.match(homeworkLetter.body,/数学课本第(?:20|二十)页/);
  await page.getByRole('dialog',{name:'课堂助手',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  const start = page.getByRole('button', { name: '开始录音', exact: true });
  await start.click();
  await page.getByRole('button', { name: '停止并识别', exact: true }).waitFor();
  await page.waitForFunction(() => window.mochiClassroomListening.snapshot().pauseReasons.includes('official-voice-input'));
  assert.equal(await page.evaluate(() => window.__microphones.filter(item => !item.stopped).length), 1);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(() => window.mochiClassroomListening.snapshot().state === 'listening');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mochi-classroom-audio-busy', { detail: { reason: 'tts', busy: true } })));
  await page.waitForFunction(() => window.mochiClassroomListening.snapshot().state === 'paused');
  assert.equal(await page.evaluate(() => window.__microphones.filter(item => !item.stopped).length), 0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mochi-classroom-audio-busy', { detail: { reason: 'tts', busy: false } })));
  await page.waitForFunction(() => window.mochiClassroomListening.snapshot().state === 'listening');
  await page.evaluate(() => window.mochiClassroomListening.pause('manual'));
  assert.deepEqual(errors, []);
  const evidence = { runtime,manifestSha256,resourceSha256,testedAt:new Date().toISOString(),actualPackagedAppMain:true,nativeBridgeNotMocked:true,source: 'synthetic Chinese audio, real MediaRecorder + SenseVoice + authenticated lesson lifecycle; local extractive notes',
    physicalMicrophoneVerified: false, nativeWakeVerified: nativeWoke, windowReallyHiddenBeforeWake:reallyHidden, homeworkLetter, hidden: await page.evaluate(() => document.hidden),
    recognized: results.map(row => ({ text: row.text, intent: row.intent, lessonIntent:row.lessonIntent, audioSeconds: row.audioSeconds })),
    states:await page.evaluate(()=>window.__classroomEvents.states), letter, autoStarted: true, voiceInputPausesListening: true, ttsPausesListening: true, errors };
  writeFileSync(join(output, 'classroom-listening-checkpoints.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS: real ASR lesson commands / whole-lesson excerpts / preserved drafts; microphone coordination');
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'classroom-listening-failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(-3000));
    const diagnostics=await page.evaluate(async()=>({listener:window.mochiClassroomListening?.snapshot(),events:window.__classroomEvents,host:await(await fetch('/api/mochi-classroom/state')).json(),microphones:window.__microphones?.map(m=>({stopped:m.stopped,state:m.context.state}))}));
    writeFileSync(join(output,'listening-diagnostics.json'),JSON.stringify({results:globalThis.packagedListeningResults,diagnostics},null,2)+'\n');console.error(JSON.stringify({results:globalThis.packagedListeningResults?.map(r=>({text:r.text,intent:r.intent})),listener:diagnostics.listener}));
  }
  throw error;
} finally {
  await app?.close(); rmSync(root, { recursive: true, force: true });
}
