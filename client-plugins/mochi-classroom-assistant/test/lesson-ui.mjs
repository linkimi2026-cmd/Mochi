#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url)), { _electron } = require('playwright');
const [log, fixtures, outputDir] = process.argv.slice(2);
assert.ok(log && fixtures && outputDir, 'Pass isolated Host log, synthetic wav fixture directory, evidence directory');
const url = readFileSync(log, 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0];
assert.ok(url);
const output = resolve(outputDir), root = mkdtempSync(join(tmpdir(), 'mochi-listening-ui-'));
mkdirSync(output, { recursive: true });
let app, page;
try {
  const entry = join(root, 'main.cjs');
  writeFileSync(entry, `const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:1120,height:840,webPreferences:{backgroundThrottling:false}}).loadURL('about:blank'));`);
  app = await _electron.launch({ executablePath: require('electron'), args: [entry, `--user-data-dir=${root}/profile`] });
  page = await app.firstWindow();
  const errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => { if (new URL(response.url()).pathname === '/api/mochi-classroom/transcribe') results.push(await response.json()); });
  await page.addInitScript(() => {
    window.__microphones = [];
    window.__classroomEvents = { wakes: 0, letters: [], ready: 0 };
    window.mochiClassroomDesktop = {
      getStartup: async () => ({ supported: false, enabled: false }),
      wake: async () => { window.__classroomEvents.wakes++; },
      listeningReady: async () => { window.__classroomEvents.ready++; },
      letterReady: async letter => { window.__classroomEvents.letters.push(letter); },
    };
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
  await page.goto(url);
  await page.waitForTimeout(1600);
  for (const name of ['继续', '稍后配置']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
    await page.waitForTimeout(250);
  }
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
  await page.waitForFunction(() => window.__classroomEvents.letters.length === 1, null, { timeout: 20000 });
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
  const evidence = { source: 'synthetic Chinese audio, real MediaRecorder + SenseVoice + authenticated lesson lifecycle; local extractive notes',
    physicalMicrophoneVerified: false, nativeWakeVerified: false, hidden: await page.evaluate(() => document.hidden),
    recognized: results.map(row => ({ text: row.text, intent: row.intent, audioSeconds: row.audioSeconds })),
    letter, autoStarted: true, voiceInputPausesListening: true, ttsPausesListening: true, errors };
  writeFileSync(join(output, 'classroom-listening-checkpoints.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS: real ASR lesson commands / whole-lesson excerpts / preserved drafts; microphone coordination');
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'classroom-listening-failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(-3000));
    console.error(await page.evaluate(() => ({ listener: window.mochiClassroomListening?.snapshot(), microphones: window.__microphones?.map(m => ({ stopped: m.stopped, state: m.context.state })) })));
  }
  throw error;
} finally {
  await app?.close(); rmSync(root, { recursive: true, force: true });
}
