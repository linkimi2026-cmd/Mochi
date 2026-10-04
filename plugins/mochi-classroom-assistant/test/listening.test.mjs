import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HomeworkStore, classifyTranscript } from '../homework-store.mjs';
import { ListeningController } from '../listening.mjs';
import { PcmSegmenter, encodeWave, capturePcm } from '../../../client-plugins/mochi-classroom-assistant/recorder.mjs';
import { installClassroomHostBridge } from '../host-bridge.mjs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../apps/desktop/runtime-modern/package.json', import.meta.url));
const validateWave = (await import(process.env.MOCHI_SPEECH_WAVE_MODULE ?? require.resolve('@deepseek-ai/dsh-experimental-speech-to-text/wave'))).validateWave;
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
test('word anywhere starts, explicit negation does not, only completed command finishes', () => {
  for (const text of ['同学们，今天作业是第3题。', '今天的数学作业完成练习', '作业']) assert.equal(classifyTranscript(text).kind, 'begin');
  for (const text of ['今天没有作业。', '不用做作业', '不要布置作业', '这不是作业']) assert.equal(classifyTranscript(text).kind, 'ignore');
  assert.equal(classifyTranscript('作业写完了吗', true).kind, 'append');
  assert.equal(classifyTranscript('结束作业记录。', true).kind, 'finish');
  assert.equal(classifyTranscript('把猫叫出来。').kind, 'wake');
  assert.equal(classifyTranscript('猫叫出来。').kind, 'wake');
});
test('records exact recognized text, persists active transcript, editing preserves originals', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-homework-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'work.json'), store = new HomeworkStore(path);
  store.begin('今天作业第3题'); store.append('明天交');
  const reopened = new HomeworkStore(path), letter = reopened.finish();
  assert.equal(letter.body, '今天作业第3题\n明天交');
  reopened.edit(letter.id, '今天作业第4题\n明天交'); reopened.configure(false);
  const saved = new HomeworkStore(path); assert.equal(saved.data.letters[0].segments[0].text, '今天作业第3题');
  assert.equal(saved.data.letters[0].body, '今天作业第4题\n明天交'); assert.equal(saved.data.settings.autoStartListening, false);
  assert.equal(readFileSync(path, 'utf8').includes('audioBase64'), false);
});
test('silence emits no audio; gate segments PCM canonically with a hard 15-second bound', () => {
  const audio = [], segmenter = new PcmSegmenter(wave => audio.push(wave));
  for (let i = 0; i < 30; i++) segmenter.push(new Float32Array(1600));
  assert.equal(audio.length, 0);
  for (let i = 0; i < 310; i++) segmenter.push(new Float32Array(1600).fill(.25));
  segmenter.push(new Float32Array(16000));
  assert.equal(audio.length, 3); assert.deepEqual(audio.slice(0, 2).map(bytes => validateWave(bytes, 15)), [15, 15]);
  assert.ok(validateWave(audio[2], 15) <= 2);
});
test('late permission grant is released after pause, without publishing listening', async () => {
  let grant, stopped = 0;
  const signal = new AbortController();
  const promise = capturePcm(() => assert.fail('no stale audio'), signal.signal, { navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
  signal.abort(); grant({ getTracks: () => [{ stop: () => stopped++ }] });
  await assert.rejects(promise, /取消/); assert.equal(stopped, 1);
});
test('cancelled old inference cannot change homework or stop a new capture', async () => {
  let resolveOld, calls = 0, releases = 0, accepted = 0;
  const controller = new ListeningController({ store: { data: { active: null } }, capture: async () => async () => { releases++; }, transcribe: async () => {
    calls++; if (calls === 1) return new Promise(resolve => { resolveOld = resolve; }); return { text: 'new' };
  }, handleResult: () => accepted++ });
  await controller.start(); controller.push(encodeWave(new Float32Array(16000))); await turn();
  await controller.pause(); await controller.resume(); controller.push(encodeWave(new Float32Array(16000)));
  resolveOld({ text: 'old' }); await turn(); await turn();
  assert.equal(accepted, 1); assert.equal(controller.state, 'listening'); assert.equal(releases, 1); await controller.stop();
});
test('queue overflow cancels rather than accumulating audio', async () => {
  const controller = new ListeningController({ store: { data: { active: null } }, capture: async () => async () => {}, transcribe: (_audio, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await controller.start(); for (let i = 0; i < 4; i++) controller.push(new Uint8Array());
  await turn(); assert.equal(controller.state, 'error'); assert.equal(controller.queue.length, 0);
});
test('host uses actual official WAV validator and shared recognizer; never forwards to cloud', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-classroom-api-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const routes = new Map(), store = new HomeworkStore(join(dir, 'work.json'));
  let recognized = '现在布置作业，完成第2题。', location = 'host-local', calls = 0;
  const ctx = { connection: { fetch: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } } }, speechToText: {
    snapshot: () => ({ providers: [{ id: 'sensevoice', location, preparation: { phase: 'ready' } }], selection: { providerId: 'sensevoice', language: 'zh' } }),
    resolve: input => { validateWave(input.audio, 15); return input; }, transcribe: async () => { calls++; return { text: recognized }; },
  } };
  installClassroomHostBridge(ctx, store, { validateWave });
  const invoke = (path, input) => routes.get('/api/mochi-classroom' + path).fetch(new Request('http://localhost/api/mochi-classroom' + path, { method: 'POST', body: input }));
  const wave = encodeWave(new Float32Array(16000).fill(.1));
  assert.equal(routes.get('/api/mochi-classroom/transcribe').requestBody, 'streaming');
  let response = await invoke('/transcribe', wave), result = await response.json(); assert.equal(result.intent.kind, 'begin');
  recognized = '明天上课前交。'; await invoke('/transcribe', wave);
  recognized = '结束作业记录'; result = await (await invoke('/transcribe', wave)).json(); assert.equal(result.letter.body, '现在布置作业，完成第2题。\n明天上课前交。');
  response = await invoke('/transcribe', new Uint8Array(2)); assert.equal(response.status, 400); assert.equal(calls, 3);
  location = 'cloud'; response = await invoke('/transcribe', wave); assert.equal(response.status, 400); assert.equal(calls, 3);
});

test('complete containers keep speech when capture omits preceding silent frames', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let time = 0, energy = 0, offset, audio;
  class Context {
    constructor() { this.state = 'running'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: values => values.fill(energy) }; }
    async resume() {} async close() { this.state = 'closed'; }
    async decodeAudioData() { return { duration: 1.44 }; }
  }
  class Recorder {
    static isTypeSupported() { return true; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(8)]) }); this.onstop?.(); }
  }
  class Offline {
    constructor(channels, length) { this.length = length; this.destination = {}; }
    createBufferSource() { return { connect() {}, start: (_when, at) => { offset = at; } }; }
    async startRendering() { return { getChannelData: () => new Float32Array(this.length).fill(.2) }; }
  }
  const release = await capturePcm(wave => { audio = wave; }, new AbortController().signal,
    { AudioContext: Context, OfflineAudioContext: Offline, MediaRecorder: Recorder, performance: { now: () => time },
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
  time = 2000; energy = .2; t.mock.timers.tick(50);
  time = 2850; energy = 0; t.mock.timers.tick(50);
  await turn();
  assert.equal(offset, 0, 'wall-clock silence must not trim the shorter container');
  assert.equal(validateWave(audio, 15), 1.44);
  await release();
});

test('lesson and homework share recognized text but keep independent lifecycle and restart recovery', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-lesson-store-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'work.json'), store = new HomeworkStore(path);
  store.acceptLessonTranscript('开始上课。');
  store.acceptLessonTranscript('分母表示把整体平均分成的份数。');
  store.begin('今天作业第3题。'); store.acceptLessonTranscript('今天作业第3题。');
  const saved = new HomeworkStore(path);
  assert.equal(saved.data.lessonActive.segments.length, 2); assert.ok(saved.data.active);
  assert.equal(saved.data.lessonActive.beginCommand, '开始上课。');
  const lesson = saved.acceptLessonTranscript('下课。').letter;
  assert.equal(lesson.kind, 'lesson'); assert.equal(lesson.segments.length, 2);
  assert.equal(lesson.segments[0].text, '分母表示把整体平均分成的份数。');
  assert.ok(lesson.notes.some(note => note.text.includes('分母')));
  assert.ok(saved.data.active, 'ending a lesson does not discard unfinished homework');
  saved.edit(lesson.id, '用户修订的重点。');
  assert.equal(saved.data.letters[0].segments[0].text, '分母表示把整体平均分成的份数。');
  assert.equal(saved.finish().body, '今天作业第3题。');
});

test('manual and spoken lesson completion emit bounded metadata once per saved lesson', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-lesson-event-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new HomeworkStore(join(dir, 'work.json')), routes = new Map(), events = [];
  let text = '开始上课。';
  installClassroomHostBridge({ emit: (name, value) => events.push({ name, value }),
    connection: { fetch: { register: route => { routes.set(route.path, route); return () => {}; } } },
    speechToText: { snapshot: () => ({ selection: { providerId: 'local' }, providers: [{ id: 'local', location: 'host-local' }] }),
      resolve: value => value, transcribe: async () => ({ text }) } }, store, { validateWave });
  const invoke = path => routes.get('/api/mochi-classroom'+path).fetch(new Request('http://localhost/api/mochi-classroom'+path,
    { method: 'POST', body: path === '/transcribe' ? encodeWave(new Float32Array(16000).fill(.1)) : '{}' }));
  await invoke('/transcribe'); text = '分母表示平均分的份数。'; await invoke('/transcribe');
  text = '下课。'; await invoke('/transcribe'); await invoke('/transcribe');
  await invoke('/lesson/begin'); await invoke('/lesson/finish'); await invoke('/lesson/finish');
  assert.equal(events.length, 2); assert.equal(events[0].name, 'mochi-classroom/lesson-finished');
  assert.deepEqual(Object.keys(events[0].value).sort(), ['endedAt', 'excerpts', 'id', 'segmentCount']);
  assert.equal(events[0].value.excerpts[0].text, '分母表示平均分的份数。');
  assert.ok(events[0].value.excerpts[0].segmentIds.length > 0);
  assert.deepEqual(events[1].value.excerpts, []);
  assert.equal(events[0].value.segmentCount, 1); assert.equal(events[1].value.segmentCount, 0);
  assert.equal(typeof events[0].value.endedAt, 'number'); assert.notEqual(events[0].value.id, events[1].value.id);
});
