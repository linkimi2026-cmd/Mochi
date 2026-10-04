export const LESSON_LIMITS = Object.freeze({ segments: 1200, characters: 320000, segmentCharacters: 8000, notes: 12 });
const STOPWORDS = new Set('我们 你们 大家 同学 老师 今天 现在 这个 那个 一下 一个 就是 然后 所以 因为 可以 需要 进行 这里 什么 怎么 这样 那样 对于 关于 的 是 了 和 与 在 把 将 有 要 不 等 学习 重点 注意'.split(' '));
const CUE = /重点|关键|记住|注意|总结|结论|定义|是指|称为|叫做|意味着|区别|不同|步骤|首先|最后|因此|可知|必须|满足|等于|公式/;
const FILLER = /^(?:好|好的|嗯|啊|哦|对|是的|明白了吗|听懂了吗|看黑板|安静|坐好|翻到第.{0,8}页)[，。！？!?\s]*$/;
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const key = text => text.toLowerCase().replace(/[\s，,。！？!?；;、：:]/gu, '');
const tokens = text => [...segmenter.segment(text)].filter(item => item.isWordLike)
  .map(item => item.segment.toLowerCase()).filter(word => word.length > 1 && !STOPWORDS.has(word));
const time = value => Number.isSafeInteger(value) && value >= 0;

/** Only a whole short command changes the lesson lifecycle. Spoken examples do not. */
export function classifyLessonCommand(raw) {
  if (typeof raw !== 'string' || raw.length > 100) return null;
  const command = raw.replace(/[\s，,。！？!?、：:]/gu, '');
  if (/^(?:(?:mochi|茉叽))?(?:请)?(?:开始上课|上课|这节课开始)$/i.test(command)) return 'begin';
  if (/^(?:(?:mochi|茉叽))?(?:请)?(?:下课|结束上课|结束课堂|这节课结束)$/i.test(command)) return 'finish';
  return null;
}

export function createLesson({ id, startedAt, source = 'local-asr' }) {
  if (typeof id !== 'string' || !id || id.length > 120 || !time(startedAt) || typeof source !== 'string' || source.length > 120) throw new Error('Invalid lesson');
  return { id, kind: 'lesson', startedAt, source, segments: [], characters: 0 };
}

function validateLesson(lesson) {
  if (!lesson || lesson.kind !== 'lesson' || typeof lesson.id !== 'string' || !lesson.id || lesson.id.length > 120 ||
    typeof lesson.source !== 'string' || lesson.source.length > 120 || !Array.isArray(lesson.segments) || !time(lesson.startedAt)) throw new Error('Invalid lesson');
  if (lesson.segments.length > LESSON_LIMITS.segments) throw new Error('Invalid lesson segment count');
  let characters = 0;
  const ids = new Set();
  for (const segment of lesson.segments) {
    if (!segment || typeof segment.id !== 'string' || !segment.id || segment.id.length > 120 || ids.has(segment.id) ||
      typeof segment.text !== 'string' || segment.text.length > LESSON_LIMITS.segmentCharacters || !time(segment.at) || segment.at < lesson.startedAt ||
      typeof segment.source !== 'string' || segment.source.length > 120 ||
      (segment.startAt !== undefined && (!time(segment.startAt) || segment.startAt < lesson.startedAt || segment.startAt > segment.at)) ||
      (segment.endAt !== undefined && (!time(segment.endAt) || segment.endAt < (segment.startAt ?? segment.at) || segment.endAt > segment.at))) throw new Error('Invalid lesson segment');
    ids.add(segment.id); characters += segment.text.length;
  }
  if (characters > LESSON_LIMITS.characters) throw new Error('Invalid lesson character count');
  return characters;
}

/** JSON state only; the existing store owns atomic persistence and restart recovery. */
export function appendLesson(lesson, segment) {
  const characters = validateLesson(lesson);
  const record = { id: segment.id, text: segment.text, at: segment.at, source: segment.source ?? lesson.source };
  if (segment.startAt !== undefined) record.startAt = segment.startAt;
  if (segment.endAt !== undefined) record.endAt = segment.endAt;
  const previous = lesson.segments.find(item => item.id === record.id);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(record)) throw new Error('Lesson segment id conflict');
    return lesson;
  }
  if (typeof record.text !== 'string' || record.text.length > LESSON_LIMITS.segmentCharacters) throw new Error('Invalid lesson transcript');
  if (lesson.segments.length >= LESSON_LIMITS.segments || characters + record.text.length > LESSON_LIMITS.characters) {
    throw Object.assign(new Error('本节课记录已达到保存上限，请结束本节课；已经录下的原文仍保留。'), { code: 'LESSON_LIMIT_REACHED' });
  }
  const next = { ...lesson, characters: characters + record.text.length, segments: [...lesson.segments, record] };
  validateLesson(next);
  return next;
}

function candidates(lesson) {
  const groups = new Map();
  for (const segment of lesson.segments) {
    for (const match of segment.text.matchAll(/[^。！？!?；;\n]+[。！？!?；;]?/gu)) {
      const text = match[0].trim();
      if (text.length < 8 || text.length > 500 || FILLER.test(text) || classifyLessonCommand(text)) continue;
      const words = [...new Set(tokens(text))];
      if (!words.length) continue;
      const startOffset = match.index + match[0].indexOf(text);
      const ref = { segmentId: segment.id, source: segment.source, at: segment.at, from: segment.startAt ?? segment.at,
        to: segment.endAt ?? segment.at, startOffset, endOffset: startOffset + text.length };
      const normalized = key(text);
      const previous = groups.get(normalized);
      if (previous) previous.sourceRefs.push(ref);
      else groups.set(normalized, { text, words, sourceRefs: [ref], cue: CUE.test(text), order: groups.size });
    }
  }
  return [...groups.values()];
}

const overlap = (left, right) => {
  const a = new Set(left.words), b = new Set(right.words);
  const common = [...a].filter(word => b.has(word)).length;
  return common / Math.max(1, a.size + b.size - common);
};
const qualifier = text => text.match(/不|没有|不能|无需|不是|\d+(?:\.\d+)?/g)?.join('|') ?? '';

/** Deterministic excerpts: topic frequency, teaching cues and repetition, with novelty. */
export function deriveLessonNotes(lesson, { maxNotes = LESSON_LIMITS.notes } = {}) {
  validateLesson(lesson);
  if (!Number.isInteger(maxNotes) || maxNotes < 1 || maxNotes > 30) throw new Error('Invalid note count');
  const rows = candidates(lesson);
  const frequency = new Map();
  for (const row of rows) for (const word of row.words) frequency.set(word, (frequency.get(word) ?? 0) + row.sourceRefs.length);
  const maximum = Math.max(1, ...frequency.values());
  for (const row of rows) {
    const topics = [...row.words].sort((a, b) => (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0) || a.localeCompare(b, 'zh-CN'));
    row.topic = topics[0];
    row.score = 1 + (row.cue ? 2 : 0) + Math.min(2, Math.log2(row.sourceRefs.length)) +
      row.words.reduce((sum, word) => sum + frequency.get(word) / maximum, 0) / row.words.length;
  }
  const selected = [];
  const remaining = [...rows];
  while (selected.length < maxNotes && remaining.length) {
    for (const row of remaining) row.rank = row.score - Math.max(0, ...selected.map(item => overlap(row, item))) * 1.5;
    remaining.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const next = remaining.shift();
    // Preserve differing numbers and negations rather than merging conflicting claims.
    const duplicate = selected.find(row => qualifier(row.text) === qualifier(next.text) && overlap(row, next) >= 0.86);
    if (!duplicate) selected.push(next);
  }
  return selected.sort((a, b) => a.order - b.order).map((row, index) => ({
    id: `${lesson.id}:note:${index + 1}`, text: row.text, topic: row.topic,
    segmentIds: [...new Set(row.sourceRefs.map(ref => ref.segmentId))],
    source: row.sourceRefs[0].source, sources: [...new Set(row.sourceRefs.map(ref => ref.source))],
    from: Math.min(...row.sourceRefs.map(ref => ref.from)), to: Math.max(...row.sourceRefs.map(ref => ref.to)),
    sourceRefs: row.sourceRefs,
    reasons: [...(row.cue ? ['teaching-cue'] : []), ...(row.sourceRefs.length > 1 ? ['repeated'] : []), 'topic-frequency'],
  }));
}

export function finishLesson(lesson, { endedAt }) {
  validateLesson(lesson);
  if (!time(endedAt) || endedAt < Math.max(lesson.startedAt, ...lesson.segments.map(segment => segment.endAt ?? segment.at))) throw new Error('Invalid lesson end time');
  const notes = deriveLessonNotes(lesson);
  const empty = lesson.segments.every(segment => !segment.text.trim());
  const stamp = value => {
    const seconds = Math.floor(Math.max(0, value - lesson.startedAt) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const body = notes.length
    ? `本节课重点摘录（本地从识别原文选句，可编辑；请核对识别文字）\n\n${notes.map(note => `[${stamp(note.from)}] ${note.text}`).join('\n\n')}`
    : empty ? '本节课没有录到可整理的课堂内容。可以补写课堂笔记。'
      : '已保留本节课识别原文，暂未找到足够完整的重点句。请检查原文并补写课堂笔记。';
  return { ...structuredClone(lesson), endedAt, title: '本节课重点摘录', method: 'local-extractive', notes, body, empty, edited: false };
}
