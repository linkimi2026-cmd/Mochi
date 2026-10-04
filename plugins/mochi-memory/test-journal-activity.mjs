import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFromTurn, activityFromLesson } from './journal-activity.mjs';

const fixture = (text, kind = 'user', reason = 'completed') => {
  const events = [
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    { type: 'user/message', seq: 2, data: { id: 'm1', role: 'user', source: { kind }, content: [{ type: 'text', text }] } },
    { type: 'assistant/message', seq: 3, data: { turn: 1, message: { content: [{ type: 'text', text: '我们可以从植物需要的阳光和水分开始讨论。' }] } } },
    { type: 'turn/end', seq: 4, time: 1790769600000, data: { turn: 1, reason: { kind: reason } } },
  ];
  return { session: { id: 's1', snapshotEvents: () => events }, event: events.at(-1), events };
};
test('仅真实已完成互动入日记，不把闲置、问好、取消或系统任务编成一天', () => {
  for (const args of [['你好'], ['请生成会话标题', 'system'], ['帮我们解释植物生长', 'user', 'cancelled'], ['我的密码是 123456']]) {
    const f = fixture(...args); assert.equal(activityFromTurn(f.session, f.event), null);
  }
  const f = fixture('帮我们讨论植物为什么需要阳光');
  const activity = activityFromTurn(f.session, f.event);
  assert.equal(activity.kind, 'conversation');
  assert.match(activity.summary, /植物为什么/);
  assert.doesNotMatch(activity.summary, /已完成|阳光和水分/);
  assert.equal(activity.id, activityFromTurn(f.session, f.event).id);
  f.events[2].data.interrupted = true;
  assert.equal(activityFromTurn(f.session, f.event), null);
});
test('课堂来源只记录真实非空课堂结束元数据', () => {
  assert.equal(activityFromLesson({ id: 'l', endedAt: Date.now(), segmentCount: 0 }), null);
  const note = activityFromLesson({ id: 'l', endedAt: '2026-09-30T12:00:00Z', segmentCount: 4 });
  assert.equal(note.kind, 'classroom'); assert.match(note.summary, /4 段/);
});
test('课堂日记保留有来源的有界摘录，拒绝敏感或无来源片段', () => {
  const excerpt = { id: 'n1', text: '分母表示平均分的份数。', segmentIds: ['s1'] };
  const note = activityFromLesson({ id:'l', endedAt:Date.now(), segmentCount:4, excerpts:[excerpt,
    { ...excerpt, id:'n2', text:'我的密码是 123456' },
    { ...excerpt, id:'n3', text:'没有来源的课堂印象', segmentIds:[] },
  ] });
  assert.match(note.summary,/分母表示/); assert.match(note.summary,/识别错误/);
  assert.doesNotMatch(note.summary,/123456|没有来源/); assert.equal(note.sourceIds.length,2);
  const bounded = activityFromLesson({ id:'l2', endedAt:Date.now(), segmentCount:10,
    excerpts:Array.from({length:20},(_,i)=>({...excerpt,id:`n${i}`,text:'课堂内容'.repeat(60)})) });
  assert.ok(bounded.summary.length<=2000); assert.equal(bounded.sourceIds.length,7);
});
