import { classifyTranscript } from './intents.mjs';

/** One bounded, cancellable transcription queue; audio never persists here. */
export class ListeningController {
  constructor({ store, transcribe, prepare = async () => {}, capture, onWake = () => {}, onLetter = () => {}, onState = () => {}, handleResult }) {
    Object.assign(this, { store, transcribe, prepare, capture, onWake, onLetter, onState, handleResult });
    this.state = 'stopped'; this.generation = 0; this.queue = []; this.abort = null; this.release = null; this.draining = false;
  }
  publish(state, error) { this.state = state; this.onState({ state, error, recordingHomework: !!this.store.data.active }); }
  async start() {
    if (!['stopped', 'paused', 'error'].includes(this.state)) return;
    const generation = ++this.generation;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.publish('preparing');
    try {
      await this.prepare(signal);
      if (signal.aborted || generation !== this.generation) return;
      const release = await this.capture(audio => this.push(audio), signal, error => {
        if (!signal.aborted && generation === this.generation) {
          void this.stop('error'); this.onState({ state: 'error', error: String(error.message ?? error), recordingHomework: !!this.store.data.active });
        }
      });
      if (signal.aborted || generation !== this.generation) { await release(); return; }
      this.release = release; this.publish('listening');
    } catch (error) {
      if (!signal.aborted && generation === this.generation) this.publish('error', String(error.message ?? error));
    }
  }
  async pause() { await this.stop('paused'); }
  async resume() { await this.start(); }
  async stop(state = 'stopped') {
    ++this.generation; this.abort?.abort(); this.queue = [];
    const release = this.release; this.release = null;
    this.publish(state);
    await release?.();
  }
  push(audio) {
    if (this.state !== 'listening') return false;
    if (this.queue.length >= 2) { void this.stop('error'); this.onState({ state: 'error', error: '识别处理跟不上录音，已停止监听；作业原文保留。' }); return false; }
    this.queue.push(audio); void this.drain(); return true;
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    const drainingGeneration = this.generation;
    try {
      while (this.queue.length && this.state === 'listening') {
        const generation = this.generation, signal = this.abort.signal;
        const result = await this.transcribe(this.queue.shift(), signal);
        if (signal.aborted || generation !== this.generation) continue;
        if (this.handleResult) this.handleResult(result);
        else this.acceptTranscript(result.text);
      }
    } catch (error) {
      if (drainingGeneration === this.generation && !this.abort?.signal.aborted) { await this.stop('error'); this.onState({ state: 'error', error: String(error.message ?? error) }); }
    } finally {
      this.draining = false;
      if (this.queue.length && this.state === 'listening') void this.drain();
    }
  }
  acceptTranscript(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    const intent = classifyTranscript(text, !!this.store.data.active);
    if (intent.kind === 'wake') this.onWake();
    if (intent.kind === 'begin') this.store.begin(text);
    if (intent.kind === 'append') this.store.append(text);
    if (intent.kind === 'finish') { const letter = this.store.finish(); if (letter) this.onLetter(letter); }
    this.onState({ state: this.state, recordingHomework: !!this.store.data.active });
  }
}
