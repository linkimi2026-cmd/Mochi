import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const autoStart of [true, false]) test(`hidden capture arbitration and persisted autoStart=${autoStart}`, async () => {
  let exports, observer, busy = false, disposed, ready = 0, captures = 0, tracksStopped = 0;
  const callbacks = new Map(), selection = { providerId: 'local' };
  const host = { active: null, letters: [], settings: { autoStartListening: autoStart }, speech: { selection, providers: [{ id: 'local', location: 'host-local', preparation: { phase: 'ready' } }] } };
  class AudioContext {
    constructor() { this.state = 'running'; this.audioWorklet = { addModule: async () => {} }; this.destination = {}; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: values => values.fill(0) }; }
    async resume() {} async close() { this.state = 'closed'; }
  }
  class AudioWorkletNode { constructor() { this.port = {}; } connect() {} disconnect() {} }
  class MediaRecorder { static isTypeSupported() { return true; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; this.onstop?.(); } }
  const context = vm.createContext({
    AbortController, Blob, URL, Uint8Array, Float32Array, DataView, Set, Promise, console,
    AudioContext, AudioWorkletNode, MediaRecorder,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} },
    document: { hidden: true, body: {}, head: { append() {} }, createElement: () => ({ remove() {} }), querySelectorAll: () => busy ? [{ getAttribute: () => 'requesting' }] : [] },
    navigator: { mediaDevices: { getUserMedia: async () => { captures++; return { getTracks: () => [{ stop: () => tracksStopped++ }] }; } } },
    fetch: async () => ({ ok: true, json: async () => structuredClone(host) }),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    addEventListener: (name, fn) => callbacks.set(name, fn), removeEventListener: name => callbacks.delete(name), dispatchEvent() {},
    mochiClassroomDesktop: { getStartup: async () => ({ supported: true, enabled: true }), listeningReady: async () => { ready++; } },
    __ModuleLoader__: { load: contribution => { exports = contribution.factory(() => ({})); } },
  });
  context.window = context;
  vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), context);
  exports.apply({ slots: { inject() {}, register() {} }, effect: callback => { disposed = callback(); } });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  await settle();
  if (!autoStart) {
    assert.equal(captures, 0); busy = true; observer(); await settle(); busy = false; observer(); await settle();
    assert.equal(captures, 0, 'ending official dictation must not override disabled auto-listening');
    await context.mochiClassroomListening.resume('manual');
  }
  assert.equal(context.mochiClassroomListening.snapshot().state, 'listening'); assert.equal(ready, 1);
  busy = true; observer(); await settle(); assert.equal(context.mochiClassroomListening.snapshot().state, 'paused'); assert.equal(tracksStopped, 1);
  await context.mochiClassroomListening.pause('tts'); busy = false; observer(); await settle(); assert.equal(context.mochiClassroomListening.snapshot().state, 'paused'); assert.equal(captures, 1);
  await context.mochiClassroomListening.resume('tts'); assert.equal(context.mochiClassroomListening.snapshot().state, 'listening'); assert.equal(captures, 2);
  await context.mochiClassroomListening.pause('manual'); callbacks.get('mochi-classroom-audio-busy')({ detail: { reason: 'tts', busy: true } }); await settle();
  callbacks.get('mochi-classroom-audio-busy')({ detail: { reason: 'tts', busy: false } }); await settle(); assert.equal(context.mochiClassroomListening.snapshot().state, 'paused');
  await disposed(); assert.equal(context.mochiClassroomListening, undefined); assert.equal(callbacks.size, 0);
});
