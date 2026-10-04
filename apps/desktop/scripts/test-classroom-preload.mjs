import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function fixture() {
  const api = {}, listeners = new Map(), pending = new Map();
  const ipc = {
    invoke: name => new Promise(resolve => pending.set(name, resolve)),
    on: (name, callback) => listeners.set(name, callback),
    removeListener: name => listeners.delete(name), send() {},
  };
  const context = vm.createContext({ exports: {}, require: () => ({ ipcRenderer: ipc,
    contextBridge: { exposeInMainWorld: (name, value) => { api[name] = value; } } }), AbortSignal });
  vm.runInContext(readFileSync(new URL('../dist-electron/lan-attention-preload.js', import.meta.url), 'utf8'), context);
  return { api, listeners, pending };
}

test('native audio state replays on subscription without an older reply undoing live pause', async () => {
  const f = fixture(), received = [];
  const stop = f.api.mochiClassroomDesktop.onAudioActivity(value => received.push(value));
  f.listeners.get('mochi:audio-busy')({}, { revision: 2, busy: true });
  f.pending.get('mochi:audio-status')({ revision: 1, busy: false });
  await Promise.resolve();
  assert.equal(received.length, 1);
  assert.equal(received[0].reason, 'tts'); assert.equal(received[0].busy, true);
  f.listeners.get('mochi:audio-busy')({}, { revision: 3, busy: false });
  assert.equal(received[1].busy, false);
  stop(); assert.equal(f.listeners.has('mochi:audio-busy'), false);
});

test('closing a letter subscription prevents a late native reply reopening its UI', async () => {
  const f = fixture(), received = [];
  const stop = f.api.mochiClassroomDesktop.onOpenLetter(id => received.push(id));
  stop();
  f.pending.get('mochi:classroom:take-letter')('bc4cd102-e3c6-4c57-89e2-ec1373a79c8a');
  await Promise.resolve();
  assert.equal(received.length, 0);
  assert.equal(f.listeners.has('mochi:classroom:open-letter'), false);
});
