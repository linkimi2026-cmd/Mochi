#!/usr/bin/env node
/** Render exactly the production procedural waveforms for review, without playing them. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createMechanicalAudio } from './mechanical-audio.mjs';
const target = resolve(process.argv[2] || 'mechanical-sound-preview.wav');
const samples = [];
let context;
class RenderContext {
  sampleRate = 44100; currentTime = 0; state = 'running'; destination = {};
  constructor() { context = this; }
  createBuffer(_channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
  createBufferSource() {
    return { connect(gain) { this.gain = gain; }, disconnect() {}, stop() {}, start() {
      samples.push(...this.buffer.getChannelData(0).map(value => value * this.gain.gain.value));
      samples.push(...new Float32Array(11025));
      this.onended?.();
    } };
  }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
const audio = createMechanicalAudio({ AudioContext: RenderContext });
audio.arm();
for (const kind of ['press', 'release', 'detent', 'feed']) { context.currentTime += 1; audio.play(kind); }
audio.dispose();
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
samples.forEach((value, index) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2));
mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, wav);
console.log(target);
