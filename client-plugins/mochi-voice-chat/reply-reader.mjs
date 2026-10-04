import { spokenReply } from './session-reply.mjs';

const durable = entries => entries.filter(row => row.type === 'event' && Number.isSafeInteger(row.event.seq));
const latestSeq = entries => durable(entries).reduce((latest, row) => Math.max(latest, row.event.seq), -1);

/** Only completed human turns: tools, reasoning, plans and history never initiate audio. */
export function completedReplies(entries, afterSeq) {
  let currentTurn;
  const human = new Set(), text = new Map(), replies = [];
  for (const {event} of durable(entries)) {
    if (event.type === 'turn/start') currentTurn = event.data.turn;
    if (event.type === 'user/message' && (!event.data.source || event.data.source.kind === 'user')
      && currentTurn !== undefined) human.add(currentTurn);
    if (event.type === 'assistant/message' && !event.data.interrupted) {
      const content = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
      if (content) text.set(event.data.turn, content);
    }
    if (event.type === 'turn/end' && event.seq > afterSeq && human.has(event.data.turn)
      && event.data.reason.kind === 'completed' && text.has(event.data.turn)) replies.push({seq:event.seq,text:spokenReply(text.get(event.data.turn))});
  }
  return replies;
}

/** Output only. No microphone, prompt submission or Session cancellation capability. */
export class ReplyReader {
  constructor(desktop, onError = () => {}) {
    this.desktop = desktop; this.onError = onError; this.enabled = false; this.cursor = -1;
    this.binding = null; this.dispose = null; this.playbackId = null; this.generation = 0;
  }
  bind(binding) {
    if (binding === this.binding) return;
    this.unbind(); this.binding = binding;
    if (!binding) return;
    this.cursor = latestSeq(binding.eventSource.getSnapshot().entries);
    this.dispose = binding.eventSource.subscribe(() => this.changed());
  }
  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.cursor = this.binding ? latestSeq(this.binding.eventSource.getSnapshot().entries) : -1;
    if (!enabled) this.stopPlayback();
  }
  changed() {
    const snapshot = this.binding.eventSource.getSnapshot();
    const previous = this.cursor;
    this.cursor = Math.max(previous, latestSeq(snapshot.entries));
    if (!this.enabled || ['replace','prepend'].includes(snapshot.change.kind)) return;
    const replies = completedReplies(snapshot.entries, previous);
    // A batch can contain several completed turns; speak only the latest visible answer.
    const reply = replies.at(-1);
    if (reply?.text) void this.play(reply.text);
  }
  async play(text) {
    this.stopPlayback();
    const generation = this.generation, id = crypto.randomUUID(); this.playbackId = id;
    try {
      const result = await this.desktop.speak({id,text:text.slice(0,6000)});
      if (generation === this.generation && !result.ok && !result.cancelled && !result.muted) this.onError(result.error || '暂时无法朗读，请查看文字回复。');
    } catch {
      if (generation === this.generation) this.onError('暂时无法朗读，请查看文字回复。');
    } finally {if (this.playbackId === id) this.playbackId = null;}
  }
  stopPlayback() {
    ++this.generation;
    const id = this.playbackId; this.playbackId = null;
    if (id) void Promise.resolve(this.desktop.stop({id})).catch(() => {});
  }
  unbind() {this.dispose?.(); this.dispose = null; this.binding = null; this.stopPlayback();}
  close() {this.enabled = false; this.unbind();}
}
