import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { VoiceChatController } from '../controller.mjs';
import { submittedReply, submitSpeech, waitForReply, spokenReply } from '../session-reply.mjs';
import { encodeWave } from '../../mochi-classroom-assistant/recorder.mjs';

const runtime = createRequire(process.env.MOCHI_CLASSROOM_TEST_RUNTIME ?? new URL('../../../apps/desktop/package.json', import.meta.url));
const sessionModule = join(dirname(runtime.resolve('@deepseek-ai/dsh-api-session-controller/package.json')), 'lib/types/client/sessions/session.js');
let Session;
try { ({ Session } = await import(pathToFileURL(process.env.MOCHI_VOICE_SESSION_MODULE ?? sessionModule))); }
catch (error) {
  throw new Error('Voice-chat integration tests require the 0.2 candidate runtime. Set MOCHI_CLASSROOM_TEST_RUNTIME and MOCHI_VOICE_SESSION_MODULE as documented in docs/evidence/harness-upgrade-2026-09-30/voice-chat-notes.md.', { cause: error });
}
const row = (type, data, seq = 1) => ({ type: 'event', event: { type, data, seq, time: Date.now() } });
const answerRows = (id, text = '这是当前回答。', turn = 1) => [row('turn/start', { turn }), row('user/message', { source: { kind: 'user', rpcId: id }, content: [{ type: 'text', text: '你好' }] }), row('assistant/message', { turn, step: 1, message: { content: [{ type: 'reasoning', text: '不可朗读的思考' }, { type: 'text', text }] } }), row('turn/end', { turn, reason: { kind: 'completed' } })];
function bindingFor({ respond = true } = {}) {
  let request, session;
  session = new Session('test-current-session', { session: { prompt: async (value, signal) => {
    request = value; assert.ok(signal instanceof AbortSignal);
    if (respond) for (const entry of answerRows(value.requestId)) session.eventSource.append(entry);
    return { ok: true, value: { accepted: true } };
  }, cancel: async () => { session.handleRunning(false); return { ok: true, value: { accepted: true } }; } } });
  return { session, eventSource: session.eventSource, lastRequest: () => request };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const speech = { catalog: async () => ({ ok: true, value: { providers: [{ id: 'local', location: 'host-local', preparation: { phase: 'ready' } }], selection: { providerId: 'local', language: 'zh' } } }), transcribe: async () => ({ ok: true, value: { text: '你好，Mochi。' } }) };

test('only this request completed turn is read; tools/reasoning/interrupted rows stay silent', () => {
  assert.equal(submittedReply(answerRows('other', '其它回答'), 'mine'), null);
  const rows = answerRows('mine'); rows.splice(3, 0, row('assistant/message', { turn: 1, interrupted: true, message: { content: [{ type: 'text', text: '错误中断回答' }] } }));
  assert.deepEqual(submittedReply(rows, 'mine'), { text: '这是当前回答。' });
  rows.at(-1).event.data.reason.kind = 'aborted'; assert.match(submittedReply(rows, 'mine').error, /停止/);
  assert.equal(spokenReply('# 回答\n**你好**，[说明](https://example.invalid)\n```js\nsecret()\n```'), '回答\n你好，说明');
});
test('actual official Session admission carries same UUID as local echo without touching typed draft', async () => {
  const binding = bindingFor(), signal = new AbortController(), typedDraft = '老师未发送的草稿';
  const admission = await submitSpeech(binding, '真实识别原文', signal.signal);
  assert.equal(await admission.reply, '这是当前回答。');
  assert.equal(binding.lastRequest().sessionId, 'test-current-session'); assert.equal(binding.lastRequest().mode, 'queue');
  assert.equal(binding.lastRequest().requestId, admission.requestId); assert.deepEqual(binding.lastRequest().content, [{ type: 'text', text: '真实识别原文' }]);
  assert.equal(binding.session.getSnapshot().pendingSubmissions[0].requestId, admission.requestId); assert.equal(typedDraft, '老师未发送的草稿');
});
test('cancelled reply waiter detaches; failed admission abandons official local echo', async () => {
  const binding = bindingFor({ respond: false }), controller = new AbortController();
  const reply = waitForReply(binding, 'missing', controller.signal); controller.abort(); await assert.rejects(reply);
  const failing = new Session('reject-session', { session: { prompt: async () => ({ ok: false, error: { message: '拒绝测试' } }) } });
  await assert.rejects(submitSpeech({ session: failing, eventSource: failing.eventSource }, '测试', new AbortController().signal), /拒绝测试/);
  assert.equal(failing.getSnapshot().pendingSubmissions.length, 0);
});
test('explicit voice chat closes capture before ASR/submission/playback, resumes after speech finishes', async () => {
  const binding = bindingFor(); let onAudio, captures = 0, releases = 0, paused = 0, resumed = 0, completePlayback, spoken;
  const controller = new VoiceChatController({ binding, speech, capture: async callback => { onAudio = callback; captures++; return async () => { releases++; }; },
    desktop: { speak: async value => { assert.equal(releases, 1); spoken = value; return new Promise(resolve => { completePlayback = resolve; }); }, stop: async () => ({ ok: true }) }, pauseBackground: async () => { paused++; }, resumeBackground: async () => { resumed++; } });
  assert.equal(controller.state, 'off'); assert.equal(captures, 0);
  await controller.start(); assert.equal(controller.state, 'listening');
  onAudio(encodeWave(new Float32Array(16000))); await settle(); assert.equal(controller.state, 'speaking'); assert.equal(captures, 1); assert.equal(spoken.text, '这是当前回答。');
  onAudio(encodeWave(new Float32Array(16000))); await settle(); assert.equal(captures, 1);
  completePlayback({ ok: true }); await settle(); assert.equal(controller.state, 'listening'); assert.equal(captures, 2); assert.equal(paused, 1);
  await controller.stop(); assert.equal(controller.state, 'off'); assert.equal(resumed, 1);
});
test('late ASR after stop cannot submit or speak', async () => {
  const binding = bindingFor(); let onAudio, finishRecognition, spoken = 0;
  const controller = new VoiceChatController({ binding, speech: { ...speech, transcribe: () => new Promise(resolve => { finishRecognition = resolve; }) }, capture: async callback => { onAudio = callback; return async () => {}; }, desktop: { speak: async () => { spoken++; return { ok: true }; }, stop: async () => ({ ok: true }) } });
  await controller.start(); onAudio(encodeWave(new Float32Array(16000))); await settle(); await controller.stop(); finishRecognition({ ok: true, value: { text: '迟到原文' } }); await settle();
  assert.equal(binding.lastRequest(), undefined); assert.equal(spoken, 0); assert.equal(controller.state, 'off');
});
test('interrupt calls only the current speech id and starts a fresh listening generation', async () => {
  const binding = bindingFor(); let onAudio, cancelledId, speakingId;
  const controller = new VoiceChatController({ binding, speech, capture: async callback => { onAudio = callback; return async () => {}; }, desktop: { speak: value => { speakingId = value.id; return new Promise(() => {}); }, stop: async value => { cancelledId = value.id; return { ok: true }; } } });
  await controller.start(); onAudio(encodeWave(new Float32Array(16000))); await settle(); assert.equal(controller.state, 'speaking'); await controller.interrupt();
  assert.equal(cancelledId, speakingId); assert.equal(controller.state, 'listening'); await controller.stop();
});
test('official microphone and external LAN speech reasons pause without losing explicit enabled intent', async () => {
  const controller = new VoiceChatController({ binding: bindingFor(), speech, capture: async () => async () => {}, desktop: { speak: async () => ({ ok: true }), stop: async () => ({ ok: true }) } });
  await controller.start(); await controller.suspend('official-voice-input'); await controller.suspend('tts'); await controller.resume('official-voice-input');
  assert.equal(controller.state, 'paused'); assert.equal(controller.enabled, true); await controller.resume('tts'); assert.equal(controller.state, 'listening'); await controller.stop();
});

test('repeated start while background pause is pending acquires only one microphone', async () => {
  let releasePause, captures = 0;
  const controller = new VoiceChatController({ binding: bindingFor(), speech,
    pauseBackground: () => new Promise(resolve => { releasePause = resolve; }),
    capture: async () => { captures++; return async () => {}; }, desktop: { speak: async () => ({ ok: true }), stop: async () => ({ ok: true }) } });
  const starting = controller.start(); await controller.start();
  assert.equal(controller.state, 'preparing'); releasePause(); await starting;
  assert.equal(captures, 1); await controller.stop();
});
test('stopping playback of a completed voice turn never cancels a later manually submitted turn', async () => {
  const binding = bindingFor(); let onAudio, cancelled = 0;
  binding.session.cancel = async () => { cancelled++; return { ok: true, value: { accepted: true } }; };
  const controller = new VoiceChatController({ binding, speech,
    capture: async callback => { onAudio = callback; return async () => {}; },
    desktop: { speak: () => new Promise(() => {}), stop: async () => ({ ok: true }) } });
  await controller.start(); onAudio(encodeWave(new Float32Array(16000))); await settle();
  assert.equal(controller.state, 'speaking'); binding.session.handleRunning(true);
  await controller.stop(); assert.equal(cancelled, 0);
});
