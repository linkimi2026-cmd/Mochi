import { createHash } from 'node:crypto';
import { isSensitiveMemoryText } from './mem-store.mjs';

const plain = message => (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
const trivial = text => /^(?:你好|您好|早上好|晚上好|早安|晚安|谢谢|好的|好呀|好哒|嗯|哦|收到|再见|hello|hi|thanks)[\s！!。.,，呀啊呢～~]*$/i.test(text);
const identity = (...parts) => createHash('sha256').update(parts.join(':')).digest('hex');

/** Only committed human conversations count; model claims are not proof of task delivery. */
export function activityFromTurn(session, event) {
  if (event?.type !== 'turn/end' || event.data?.reason?.kind !== 'completed') return null;
  const turn = event.data.turn;
  if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(event.time) || !session?.id) return null;
  const events = session.snapshotEvents?.();
  if (!Array.isArray(events)) return null;
  const start = events.findLastIndex(row => row.type === 'turn/start' && row.data?.turn === turn);
  if (start < 0) return null;
  const entered = events.slice(start + 1).filter(row => row.seq <= event.seq);
  const users = entered.filter(row => row.type === 'user/message' && row.data?.source?.kind === 'user' && row.data?.role === 'user');
  const texts = users.map(row => plain(row.data)).filter(text => text && !trivial(text));
  if (!texts.length) return null;
  const source = texts.join('\n');
  if (source.length > 12000 || isSensitiveMemoryText(source)) return null;
  const reply = entered.findLast(row => row.type === 'assistant/message' && row.data?.turn === turn && !row.data.interrupted && plain(row.data.message).length >= 12);
  if (!reply) return null;
  // Retain a bounded user-origin topic, never an unverified assistant success claim or file body.
  const excerpt = source.slice(0, 1200);
  return {
    id: identity(session.id, turn), kind: 'conversation', at: event.time,
    summary: `今天围绕这段请求进行了交流：\n${excerpt}${source.length > excerpt.length ? '\n（请求摘录）' : ''}`,
    sourceIds: users.slice(-10).map(row => identity(session.id, row.data.id ?? row.seq)),
  };
}

export function activityFromLesson(note) {
  const at = typeof note?.endedAt === 'number' ? note.endedAt : Date.parse(note?.endedAt);
  if (typeof note?.id !== 'string' || !note.id || !Number.isSafeInteger(at) || !Number.isSafeInteger(note.segmentCount) || note.segmentCount < 1) return null;
  const excerpts = (Array.isArray(note.excerpts) ? note.excerpts : []).slice(0, 6).filter(row =>
    typeof row?.id === 'string' && row.id.length > 0 && row.id.length <= 200 &&
    typeof row.text === 'string' && row.text.trim() && row.text.length <= 240 && !isSensitiveMemoryText(row.text) &&
    Array.isArray(row.segmentIds) && row.segmentIds.length > 0 && row.segmentIds.length <= 4 &&
    row.segmentIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 120));
  const content = excerpts.length ? '\n课堂信件中的识别摘录（可能有识别错误，不据此推断班级特质）：\n' + excerpts.map(row => row.text).join('\n') : '';
  return { id: identity('lesson', note.id), kind: 'classroom', at,
    summary: `本节课已整理课堂记录，包含 ${note.segmentCount} 段实际转写。完整内容保留在课堂信件中。${content}`,
    sourceIds: [identity('lesson', note.id), ...excerpts.map(row => identity('lesson', note.id, row.id))] };
}
