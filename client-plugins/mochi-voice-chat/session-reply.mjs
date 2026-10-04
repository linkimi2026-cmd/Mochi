/** Correlate one official submission identity with its durable completed turn. */
export function submittedReply(entries, requestId) {
  let currentTurn, targetTurn, reply = '';
  for (const row of entries) {
    if (row.type !== 'event') continue;
    const event = row.event;
    if (event.type === 'turn/start') currentTurn = event.data.turn;
    if (event.type === 'user/message' && event.data.source?.kind === 'user' && event.data.source.rpcId === requestId) targetTurn = currentTurn;
    if (targetTurn !== undefined && event.type === 'assistant/message' && event.data.turn === targetTurn && !event.data.interrupted) {
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
      if (text) reply = text;
    }
    if (targetTurn !== undefined && event.type === 'turn/end' && event.data.turn === targetTurn) {
      if (event.data.reason.kind !== 'completed') return { error: '本轮回答已停止或失败，请查看会话中的状态。' };
      return { text: reply };
    }
  }
  return null;
}

export function waitForReply(binding, requestId, signal, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let dispose = () => {}, timer;
    const cleanup = () => { dispose(); clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal.reason ?? new Error('语音对话已停止')); };
    const check = () => {
      const result = submittedReply(binding.eventSource.getSnapshot().entries, requestId);
      if (!result) return;
      cleanup(); if (result.error) reject(new Error(result.error)); else resolve(result.text);
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    dispose = binding.eventSource.subscribe(check);
    timer = setTimeout(() => { cleanup(); reject(new Error('等待回答超时，语音对话已暂停；请查看当前会话。')); }, timeoutMs);
    check();
  });
}

/** Use the official normal prompt admission and echo; never overwrite the typed draft. */
export async function submitSpeech(binding, text, signal) {
  signal.throwIfAborted();
  if (!text.trim() || text.length > 8000) throw new Error('识别内容为空或过长。');
  const snapshot = binding.session.getSnapshot();
  if (snapshot.removed || snapshot.running) throw new Error('当前会话正在回答，请稍后再开启语音对话。');
  const submission = binding.session.beginSubmission({ mode: 'queue', text, attachments: [] });
  const waiter = new AbortController();
  const abortWaiter = () => waiter.abort(signal.reason);
  signal.addEventListener('abort', abortWaiter, { once: true });
  const reply = waitForReply(binding, submission.requestId, waiter.signal).finally(() => signal.removeEventListener('abort', abortWaiter));
  // Attach immediately: a cancelled/failed admission must not leave an unhandled waiter.
  void reply.catch(() => {});
  try {
    const result = await binding.session.prompt([{ type: 'text', text }], 'queue', signal, submission.requestId);
    if (!result.ok) throw new Error(result.error.message || '当前会话拒绝了语音消息。');
    return { requestId: submission.requestId, reply };
  } catch (error) { waiter.abort(error); submission.abandon(); throw error; }
}

export function spokenReply(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[ \t]*(?:#{1,6}|>|[-*])[ \t]+/gm, '').replace(/[*_`]/g, '').trim();
}
