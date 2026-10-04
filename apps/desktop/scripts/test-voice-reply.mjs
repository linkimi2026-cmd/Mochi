import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { createVoiceReply } = createRequire(import.meta.url)('../dist-electron/dsh/voice-reply.js');
test('invalid speech is rejected and errors never expose content', async () => {
  let calls = 0;
  const reply = createVoiceReply(async () => { calls++; throw Error('private sentence'); });
  reply.setEnabled(true);
  for (const request of [null, {}, { id: 'x', text: 'hello' }, { id: randomUUID(), text: 'a'.repeat(6001) }]) {
    assert.equal((await reply.speak(request)).ok, false);
  }
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(await reply.speak({ id: randomUUID(), text: '你好' })).includes('private'), false);
});
test('new replies cancel prior playback, stale stop cannot cancel current playback', async () => {
  const jobs = [];
  const reply = createVoiceReply((_text, signal) => new Promise((resolve, reject) => {
    jobs.push({ resolve, signal }); signal.addEventListener('abort', () => reject(Error('aborted')));
  }));
  reply.setEnabled(true);
  const firstId = randomUUID(), secondId = randomUUID();
  const first = reply.speak({ id: firstId, text: '一' });
  const second = reply.speak({ id: secondId, text: '二' });
  assert.deepEqual(await first, { ok: false, cancelled: true });
  reply.stop({ id: firstId });
  assert.equal(jobs[1].signal.aborted, false);
  assert.equal((await reply.speak({ id: secondId, text: '二' })).ok, false);
  reply.stopAll();
  assert.deepEqual(await second, { ok: false, cancelled: true });
});

test('default mute never starts output; closing speaker immediately cancels only its reply', async () => {
  let calls = 0, signal;
  const reply = createVoiceReply((_text, value) => new Promise((resolve, reject) => {
    calls++; signal = value; value.addEventListener('abort', () => reject(Error('cancelled')));
  }));
  assert.deepEqual(reply.getState(), { enabled: false });
  assert.deepEqual(await reply.speak({ id: randomUUID(), text: '默认静音' }), { ok: true, muted: true });
  assert.equal(calls, 0);
  assert.deepEqual(reply.setEnabled(true), { enabled: true });
  const playing = reply.speak({ id: randomUUID(), text: '正在朗读' });
  assert.equal(calls, 1); reply.setEnabled(false);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await playing, { ok: false, cancelled: true });
});

test('role preference persists atomically with private permissions and separate defaults', () => {
  const home = mkdtempSync(join(tmpdir(), 'mochi-reply-pref-'));
  try {
    let role = 'teacher';
    const path = () => join(home, `reply-${role}.json`);
    const first = createVoiceReply(async () => {}, path);
    first.setEnabled(true);
    assert.equal(statSync(path()).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(path(), 'utf8')), { enabled: true });
    assert.deepEqual(createVoiceReply(async () => {}, path).getState(), { enabled: true });
    role = 'classroom'; assert.deepEqual(first.getState(), { enabled: false });
    first.setEnabled(false); role = 'teacher'; assert.deepEqual(first.getState(), { enabled: true });
    assert.equal(first.setEnabled('true').enabled, true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
