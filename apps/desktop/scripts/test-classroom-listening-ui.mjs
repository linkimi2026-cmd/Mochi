#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
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
      source.connect(record.destination); source.start();
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
  assert.equal(await page.evaluate(() => window.__classroomEvents.wakes), 0);
  const sendAudio = name => page.evaluate(base64 => window.__playFixture(base64), readFileSync(join(fixtures, `${name}.wav`)).toString('base64'));
  await sendAudio('wake');
  await page.waitForFunction(() => window.__classroomEvents.wakes === 1, null, { timeout: 20000 });
  await sendAudio('homework');
  await page.waitForFunction(() => window.mochiClassroomListening.snapshot().recordingHomework, null, { timeout: 20000 });
  await sendAudio('finish');
  await page.waitForFunction(() => window.__classroomEvents.letters.length === 1, null, { timeout: 20000 });
  const letter = await page.evaluate(() => window.__classroomEvents.letters[0]);
  assert.match(letter.body, /数学课本第(?:20|二十)页/u);
  await page.getByRole('textbox', { name: '作业信件正文', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'classroom-homework-letter.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
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
  const evidence = { source: 'synthetic Chinese audio, real MediaRecorder + SenseVoice + authenticated classroom endpoints',
    physicalMicrophoneVerified: false, nativeWakeVerified: false, hidden: await page.evaluate(() => document.hidden),
    recognized: results.map(row => ({ text: row.text, intent: row.intent, audioSeconds: row.audioSeconds })),
    letter, autoStarted: true, voiceInputPausesListening: true, ttsPausesListening: true, errors };
  writeFileSync(join(output, 'classroom-listening-checkpoints.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS: background synthetic speech → real ASR wake / homework / editable letter; input and TTS microphone coordination');
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
