import { submitSpeech, spokenReply } from './session-reply.mjs';

/** One explicit conversation owner: microphone, admission, answer, local playback. */
export class VoiceChatController {
  constructor({ binding, capture, speech, desktop, pauseBackground = async () => {}, resumeBackground = async () => {}, onState = () => {} }) {
    Object.assign(this, { binding, capture, speech, desktop, pauseBackground, resumeBackground, onState });
    this.enabled = false; this.state = 'off'; this.generation = 0; this.reasons = new Set(); this.release = null; this.abort = null; this.speechId = null; this.submitted = false;
  }
  publish(state, error) { this.state = state; this.onState({ state, error, enabled: this.enabled, transcript: this.transcript ?? '', pauseReasons: [...this.reasons] }); }
  async start() {
    if (this.enabled && !['paused', 'error'].includes(this.state)) return;
    if (!this.desktop?.speak || !this.desktop?.stop) { this.publish('error', '回答朗读需要 Mochi 桌面版。'); return; }
    this.enabled = true; this.publish('preparing');
    try { await this.pauseBackground(); if (this.reasons.size) this.publish('paused'); else await this.listen(); }
    catch (error) { await this.fail(error); }
  }
  async listen() {
    if (!this.enabled || this.reasons.size) return;
    const generation = ++this.generation;
    this.abort = new AbortController(); this.submitted = false;
    const signal = this.abort.signal;
    this.publish('preparing');
    try {
      const result = await this.speech.catalog();
      if (!result.ok) throw result.error;
      const catalog = result.value, provider = catalog.providers.find(item => item.id === catalog.selection.providerId);
      if (provider?.location !== 'host-local' || !['ready', 'standby'].includes(provider.preparation.phase)) throw new Error('请先在语音设置准备本地识别模型。');
      if (this.binding.session.getSnapshot().running) throw new Error('当前会话正在回答，请稍后继续语音对话。');
      if (signal.aborted || generation !== this.generation) return;
      const release = await this.capture(audio => { if (this.state === 'listening' && generation === this.generation) void this.acceptAudio(audio, generation, catalog.selection); }, signal, error => { if (generation === this.generation) void this.fail(error); });
      if (signal.aborted || generation !== this.generation) { await release(); return; }
      this.release = release; this.publish('listening');
    } catch (error) { if (generation === this.generation && !signal.aborted) await this.fail(error); }
  }
  async acceptAudio(audio, generation, selection) {
    const signal = this.abort.signal;
    this.publish('transcribing');
    const release = this.release; this.release = null;
    try {
      await release?.();
      if (signal.aborted || generation !== this.generation) return;
      const result = await this.speech.transcribe({ audioBase64: toBase64(audio), ...selection }, signal);
      if (!result.ok) throw result.error;
      if (signal.aborted || generation !== this.generation) return;
      const text = result.value.text.trim();
      if (!text) { this.publish('empty'); await this.listen(); return; }
      this.transcript = text; this.publish('answering'); this.submitted = true;
      const admission = await submitSpeech(this.binding, text, signal);
      const reply = await admission.reply;
      if (signal.aborted || generation !== this.generation) return;
      this.submitted = false;
      const spoken = spokenReply(reply);
      if (spoken) {
        this.speechId = crypto.randomUUID(); this.publish('speaking');
        const playback = await this.desktop.speak({ id: this.speechId, text: spoken.slice(0, 6000) });
        if (!playback.ok && !playback.cancelled) throw new Error(playback.error || '本地回答朗读失败。');
        this.speechId = null;
      }
      if (!signal.aborted && generation === this.generation) await this.listen();
    } catch (error) { if (generation === this.generation && !signal.aborted) await this.fail(error); }
  }
  async cancelPipeline(cancelTurn = true) {
    ++this.generation; this.abort?.abort();
    const release = this.release; this.release = null;
    const speechId = this.speechId; this.speechId = null;
    const submitted = this.submitted; this.submitted = false;
    await release?.();
    if (speechId) await this.desktop.stop({ id: speechId });
    if (cancelTurn && submitted && this.binding.session.getSnapshot().running) {
      const result = await this.binding.session.cancel();
      if (!result.ok) throw new Error(result.error.message || '停止当前回答失败。');
    }
  }
  async fail(error) { await this.cancelPipeline(false); this.publish('error', error?.message || String(error)); }
  async stop() { this.enabled = false; try { await this.cancelPipeline(); } finally { this.publish('off'); await this.resumeBackground(); } }
  async interrupt() {
    await this.cancelPipeline();
    if (this.enabled) {
      if (this.binding.session.getSnapshot().running) { this.publish('paused', '回答正在停止，停止完成后点击继续听。'); return; }
      await this.listen();
    }
  }
  async suspend(reason) { if (this.reasons.has(reason)) return; this.reasons.add(reason); if (this.enabled) { await this.cancelPipeline(); this.publish('paused'); } }
  async resume(reason) { this.reasons.delete(reason); if (this.enabled && !this.reasons.size && ['paused', 'error'].includes(this.state)) await this.listen(); }
}

function toBase64(bytes) {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
