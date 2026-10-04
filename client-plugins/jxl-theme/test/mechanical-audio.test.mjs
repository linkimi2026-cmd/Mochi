import assert from 'node:assert/strict';
import test from 'node:test';
import { createMechanicalAudio } from '../scripts/mechanical-audio.mjs';

function fixture() {
  const contexts = [];
  const events = new Map();
  const document = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name) };
  class AudioContext {
    state = 'running'; sampleRate = 44100; currentTime = 1; destination = {}; voices = []; buffers = [];
    constructor() { contexts.push(this); }
    createBuffer(_channels, length) {
      const data = new Float32Array(length);
      const buffer = { data, getChannelData: () => data };
      this.buffers.push(buffer); return buffer;
    }
    createBufferSource() {
      const voice = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
      this.voices.push(voice); return voice;
    }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  return { contexts, events, document, audio: createMechanicalAudio({ AudioContext }) };
}

test('mechanical audio is gesture-lazy, short, bounded and releases its device on disposal', () => {
  const { audio, contexts, document, events } = fixture();
  audio.bind(document);
  assert.equal(contexts.length, 0, 'mount does not open an audio device');
  assert.equal(audio.play('feed'), false, 'background state cannot unlock audio');
  const target = { disabled: false, classList: { contains: () => false } };
  events.get('pointerdown')({ isTrusted: false, target: { closest: () => target } });
  assert.equal(contexts.length, 0, 'synthetic clicks cannot unlock audio');
  events.get('pointerdown')({ isTrusted: true, button: 0, target: { closest: () => target } });
  const context = contexts[0];
  assert.equal(context.voices.length, 1);
  assert.ok(context.buffers[0].data.length / context.sampleRate < .08);
  assert.ok(context.buffers[0].data.every(Number.isFinite));
  assert.ok(Math.max(...context.buffers[0].data.map(Math.abs)) < .6, 'no clipping before master attenuation');
  events.get('keydown')({ isTrusted: true, repeat: true, key: 'Enter' });
  assert.equal(context.voices.length, 1, 'key repeat does not produce a sound train');
  audio.play('feed'); audio.play('feed'); audio.play('feed');
  assert.equal(audio.play('feed'), false, 'polyphony is bounded');
  audio.setEnabled(false);
  assert.ok(context.voices.every(voice => voice.stopped));
  assert.equal(audio.play('press'), false, 'mute is immediate');
  audio.dispose();
  assert.equal(context.state, 'closed');
  assert.equal(events.size, 0);
});

test('muted and unsupported audio never blocks UI controls', () => {
  const audio = createMechanicalAudio({}, false);
  audio.arm(); assert.equal(audio.play('press'), false);
  audio.setEnabled(true); audio.arm(); assert.equal(audio.play('press'), false);
  audio.dispose();
});


test('keyboard dial navigation sounds once while ordinary typing stays quiet', () => {
  const { audio, contexts, document, events } = fixture();
  audio.bind(document);
  const dial = { disabled: false, classList: { contains: value => value === 'jxl-theme-dial' } };
  events.get('keydown')({ isTrusted: true, key: 'ArrowRight', target: { closest: () => dial } });
  assert.equal(contexts[0].voices.length, 1);
  assert.equal(contexts[0].buffers[0].data.length, Math.ceil(44100 * .046));
  events.get('keydown')({ isTrusted: true, key: 'a', target: { closest: () => null } });
  events.get('keydown')({ isTrusted: true, key: 'Enter', isComposing: true });
  assert.equal(contexts[0].voices.length, 1);
  audio.dispose();
});
