import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSON_LIMITS, classifyLessonCommand, createLesson, appendLesson, deriveLessonNotes, finishLesson } from '../lesson-notes.mjs';

const initial = () => createLesson({ id: 'lesson-1', startedAt: 100000 });
const add = (lesson, text, index) => appendLesson(lesson, { id: `segment-${index}`, text, at: 100000 + index * 15000 });

test('only complete lifecycle commands act; quoted instructions and negations do not', () => {
  for (const text of ['开始上课。', 'Mochi，开始上课！', '上课']) assert.equal(classifyLessonCommand(text), 'begin');
  for (const text of ['下课！', '茉叽，下课。', '结束课堂']) assert.equal(classifyLessonCommand(text), 'finish');
  for (const text of ['下课后把作业交上来。', '不要开始上课。', '今天讲的是开始上课这个词。', '本节课重点是分数。', '作业说完了']) assert.equal(classifyLessonCommand(text), null);
});

test('all classroom paragraphs are retained exactly, independently of teaching cue words', () => {
  const before = initial();
  const raw = '  分数表示把一个整体平均分成若干份后取其中的一份或几份。\n分母表示平均分的份数。 ';
  const after = add(before, raw, 1);
  assert.deepEqual(before.segments, []);
  assert.equal(after.segments[0].text, raw);
  assert.equal(after.segments[0].source, 'local-asr');
  assert.equal(after.characters, raw.length);
  assert.ok(deriveLessonNotes(after).some(note => note.text.includes('分母表示')));
  const restored = JSON.parse(JSON.stringify(after));
  assert.deepEqual(deriveLessonNotes(restored), deriveLessonNotes(after));
  assert.equal(appendLesson(restored, restored.segments[0]), restored);
  assert.throws(() => appendLesson(restored, { ...restored.segments[0], text: '被改写的内容' }), /conflict/);
});

test('repeated excerpts deduplicate with precise source references, including later topics', () => {
  let lesson = initial();
  const texts = ['分母表示平均分的份数。', '分母表示平均分的份数。', '分母表示平均分的份数。', '温度计利用液体热胀冷缩的原理测量温度。'];
  for (const [index, text] of texts.entries()) lesson = add(lesson, text, index + 1);
  const notes = deriveLessonNotes(lesson);
  const repeated = notes.find(note => note.text === texts[0]);
  assert.equal(notes.filter(note => note.text === texts[0]).length, 1);
  assert.equal(repeated.segmentIds.length, 3);
  assert.equal(repeated.from, 115000);
  assert.equal(repeated.to, 145000);
  assert.ok(repeated.reasons.includes('repeated'));
  assert.ok(notes.some(note => note.text === texts[3]));
  for (const note of notes) for (const ref of note.sourceRefs) {
    const segment = lesson.segments.find(segment => segment.id === ref.segmentId);
    assert.equal(segment.text.slice(ref.startOffset, ref.endOffset), note.text);
    assert.equal(ref.at, segment.at);
    assert.equal(ref.source, segment.source);
  }
});

test('scores substantive content without requiring the word 重点 and keeps negation/numbers', () => {
  let lesson = initial();
  for (const [index, text] of ['好。嗯。看黑板。', '两个分数相加时不能把分母直接相加。', '两个分数相加时可以把分母直接相加。',
    '正常人的体温通常为36.5摄氏度。', '正常人的体温通常为38.5摄氏度。'].entries()) lesson = add(lesson, text, index + 1);
  const notes = deriveLessonNotes(lesson);
  assert.ok(notes.every(note => note.text.length >= 8));
  assert.equal(notes.length, 4);
  assert.ok(notes.some(note => note.text.includes('不能')));
  assert.ok(notes.some(note => note.text.includes('可以')));
  assert.ok(notes.some(note => note.text.includes('36.5')));
  assert.ok(notes.some(note => note.text.includes('38.5')));
  // The extractor exposes conflicting original statements; it does not silently correct them.
});

test('end generates an editable excerpt letter; empty and fragment-only lessons state limits', () => {
  const empty = finishLesson(initial(), { endedAt: 101000 });
  assert.equal(empty.empty, true);
  assert.equal(empty.method, 'local-extractive');
  assert.equal(empty.edited, false);
  assert.match(empty.body, /没有录到/);
  const fragment = finishLesson(add(initial(), '好了。嗯。', 1), { endedAt: 120000 });
  assert.equal(fragment.empty, false);
  assert.match(fragment.body, /暂未找到/);
  const letter = finishLesson(add(initial(), '注意，分数相加需要先把分母通分。', 1), { endedAt: 120000 });
  assert.match(letter.body, /\[0:15\]/);
  assert.equal(letter.title, '本节课重点摘录');
  assert.equal(letter.notes.length, 1);
  assert.equal(letter.segments.length, 1);
  assert.throws(() => finishLesson(letter, { endedAt: 110000 }), /end time/);
});

test('bounded transcript refuses overflow without changing saved originals', () => {
  let lesson = initial();
  for (let index = 1; index <= LESSON_LIMITS.segments; index++) lesson = add(lesson, '原文', index);
  const saved = JSON.stringify(lesson);
  assert.throws(() => add(lesson, '额外原文', LESSON_LIMITS.segments + 1), error => error.code === 'LESSON_LIMIT_REACHED');
  assert.equal(JSON.stringify(lesson), saved);
  let full = initial();
  for (let index = 1; index <= LESSON_LIMITS.characters / LESSON_LIMITS.segmentCharacters; index++) full = add(full, '甲'.repeat(LESSON_LIMITS.segmentCharacters), index);
  assert.throws(() => add(full, '超过总字数', 41), error => error.code === 'LESSON_LIMIT_REACHED');
  assert.throws(() => add(initial(), '甲'.repeat(8001), 1), /Invalid/);
  assert.throws(() => appendLesson(initial(), { id: 'bad', text: '实际原文', at: 99999 }), /Invalid/);
});

test('bounded note selection remains deterministic with broader topic coverage', () => {
  let lesson = initial();
  for (let index = 1; index <= 80; index++) lesson = add(lesson, `分数运算的第${index}个例题需要先把分母通分。`, index);
  lesson = add(lesson, '光合作用利用光能将二氧化碳和水转化为有机物。', 81);
  const notes = deriveLessonNotes(lesson);
  assert.equal(notes.length, LESSON_LIMITS.notes);
  assert.ok(notes.some(note => note.text.startsWith('光合作用')));
  assert.deepEqual(notes, deriveLessonNotes(JSON.parse(JSON.stringify(lesson))));
  assert.throws(() => deriveLessonNotes(lesson, { maxNotes: 5000 }), /Invalid/);
});
