import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionStore, companionshipDays, shanghaiDate, COMPANION_LIMITS } from './companion.mjs';

const instant = date => Date.parse(date);
function fixture(t, at = instant('2026-10-01T00:00:00+08:00')) {
  const root = mkdtempSync(join(tmpdir(), 'mochi-companion-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let clock = at;
  const path = join(root, 'companion.json');
  return { path, now: () => clock, set: value => clock = value, store: new CompanionStore(path, { now: () => clock }) };
}

test('Shanghai calendar dates cross midnight independently of system timezone and leap years', () => {
  assert.equal(shanghaiDate(instant('2026-09-30T15:59:59Z')), '2026-09-30');
  assert.equal(shanghaiDate(instant('2026-09-30T16:00:00Z')), '2026-10-01');
  assert.equal(companionshipDays('2026-09-30', instant('2026-09-30T15:59:59Z')), 1);
  assert.equal(companionshipDays('2026-09-30', instant('2026-09-30T16:00:00Z')), 2);
  assert.equal(companionshipDays('2024-02-28', instant('2024-03-01T12:00:00+08:00')), 3);
  assert.equal(companionshipDays(null, Date.now()), null);
  assert.throws(() => companionshipDays('2026-02-29', Date.now()), /不存在/);
  assert.throws(() => companionshipDays('2026-2-01', Date.now()), /YYYY-MM-DD/);
});

test('unknown and future starts are explicit; profile survives restart only after confirmation', t => {
  const f = fixture(t), store = f.store;
  assert.equal(store.snapshot().days, null);
  assert.equal(store.snapshot().status, 'missing-start-date');
  assert.deepEqual(store.dueReminders(), []);
  assert.throws(() => store.configureProfile({ className: '三年一班', startDate: '2026-09-01' }), /确认/);
  store.configureProfile({ className: '三年一班', startDate: '2026-11-01', confirmed: true });
  assert.equal(store.snapshot().days, 0);
  assert.equal(store.snapshot().status, 'not-started');
  assert.match(store.snapshot().message, /尚未开始/);
  assert.deepEqual(store.dueReminders(), []);
  store.configureProfile({ startDate: '2026-09-01', confirmed: true });
  const restarted = new CompanionStore(f.path, { now: f.now });
  assert.equal(restarted.snapshot().days, 31);
  assert.equal(restarted.snapshot().profile.className, '三年一班');
  assert.equal(restarted.snapshot().profile.teacherName, null);
  const original = readFileSync(f.path, 'utf8');
  assert.throws(() => store.configureProfile({ startDate: '2026-02-30', confirmed: true }), /不存在/);
  assert.equal(readFileSync(f.path, 'utf8'), original);
  assert.throws(() => store.configureProfile({ startDate: '2026-09-01', inferred: true, confirmed: true }), /确认/);
});

test('only teacher-confirmed traits are saved and edits do not manufacture prior-month facts', t => {
  const f = fixture(t, instant('2026-09-15T12:00:00+08:00')), store = f.store;
  store.configureProfile({ className: '三年一班', startDate: '2026-09-01', confirmed: true });
  assert.throws(() => store.confirmTrait({ text: '喜欢合作', confirmed: false }), /确认/);
  const trait = store.confirmTrait({ text: '喜欢合作', confirmed: true });
  assert.equal(trait.source, 'teacher-confirmed');
  assert.equal(store.confirmTrait({ text: '喜欢合作', confirmed: true }).id, trait.id);
  f.set(instant('2026-10-02T12:00:00+08:00'));
  store.confirmTrait({ id: trait.id, text: '习惯先独立思考', confirmed: true });
  assert.equal(store.monthlyReview('2026-09').traits.length, 0);
  store.replaceTraits({ traits: ['习惯先独立思考', '会主动提问', '会主动提问'], confirmed: true });
  assert.equal(store.snapshot().traits.length, 2);
  store.replaceTraits({ traits: [], confirmed: true });
  assert.equal(store.snapshot().traits.length, 0);
});

test('monthly review quotes only actual period records with sources and no inferred progress', t => {
  const f = fixture(t, instant('2026-09-15T12:00:00+08:00')), store = f.store;
  store.configureProfile({ className: '三年一班', startDate: '2026-09-10', confirmed: true });
  const trait = store.confirmTrait({ text: '喜欢合作', confirmed: true });
  const event = store.recordEvent({ id: 'lesson-1', summary: '完成分数单元课堂摘录。', at: instant('2026-09-12T11:00:00+08:00'), source: 'lesson', refs: ['letter-1'] });
  assert.deepEqual(store.recordEvent({ id: event.id, summary: event.summary, at: event.at, source: event.source, refs: event.refs }), event);
  assert.throws(() => store.recordEvent({ id: event.id, summary: '另一条原文', at: event.at, source: event.source }), /conflict/);
  store.recordEvent({ id: 'before', summary: '陪伴前的活动，不计入陪伴。', at: instant('2026-09-02T10:00:00+08:00'), source: 'teacher' });
  f.set(instant('2026-10-01T12:00:00+08:00'));
  store.recordEvent({ id: 'next-month', summary: '十月活动。', at: instant('2026-10-01T10:00:00+08:00'), source: 'teacher' });
  store.confirmTrait({ text: '十月才确认的特质', confirmed: true });
  const review = store.monthlyReview('2026-09');
  assert.deepEqual(review.events.map(item => item.id), ['lesson-1']);
  assert.deepEqual(review.traits.map(item => item.id), [trait.id]);
  assert.deepEqual(review.sourceIds, ['lesson-1', trait.id]);
  assert.match(review.body, /完成分数单元课堂摘录/);
  assert.doesNotMatch(review.body, /十月活动|陪伴前的活动|十月才确认/);
  assert.throws(() => store.monthlyReview('2026-10'), /尚未结束/);
});

test('due reads are side-effect free; queue receipt deduplicates monthly/milestone after restart', t => {
  const f = fixture(t), store = f.store;
  store.configureProfile({ className: '三年一班', startDate: '2026-09-02', confirmed: true });
  const before = readFileSync(f.path, 'utf8'), due = store.dueReminders();
  assert.equal(readFileSync(f.path, 'utf8'), before);
  assert.equal(due.length, 2);
  assert.ok(due.some(item => item.key === 'month:2026-09'));
  assert.ok(due.some(item => item.key.endsWith(':30')));
  assert.ok(due.every(item => typeof item.title === 'string' && typeof item.body === 'string' && item.createdAt === f.now()));
  assert.match(due.find(item => item.kind === 'month-review').body, /没有保存可回顾/);
  for (const item of due) assert.equal(store.acknowledgeReminder(item.key), true);
  assert.equal(store.acknowledgeReminder(due[0].key), false);
  const restarted = new CompanionStore(f.path, { now: f.now });
  assert.deepEqual(restarted.dueReminders(), []);
  assert.ok(restarted.snapshot().receipts.every(item => item.queuedAt && !Object.hasOwn(item, 'seenAt')));
  assert.throws(() => restarted.acknowledgeReminder('month:2026-10'), /Invalid/);
});

test('offline catch-up has a seven-day window and accepting across its end still saves receipt', t => {
  const f = fixture(t, instant('2026-10-07T23:59:59+08:00')), store = f.store;
  store.configureProfile({ startDate: '2026-09-01', confirmed: true });
  const due = store.dueReminders();
  assert.ok(due.some(item => item.key === 'month:2026-09'));
  f.set(instant('2026-10-08T00:00:01+08:00'));
  assert.deepEqual(store.dueReminders(), []);
  assert.equal(store.acknowledgeReminder('month:2026-09', f.now(), due.find(item => item.key === 'month:2026-09')), true);
  assert.equal(store.snapshot().receipts.length, 1);
});

test('snapshot copies cannot change disk and corrupt data does not reset confirmed facts', t => {
  const f = fixture(t), store = f.store;
  store.configureProfile({ startDate: '2026-09-01', confirmed: true });
  const copied = store.snapshot(); copied.profile.startDate = '2000-01-01'; copied.events.push({ summary: '编造事件' });
  assert.equal(store.snapshot().profile.startDate, '2026-09-01');
  assert.equal(store.snapshot().events.length, 0);
  writeFileSync(f.path, '{broken');
  assert.throws(() => new CompanionStore(f.path), SyntaxError);
});

test('accepted reminder retains its exact full original letter despite subsequent edits', t => {
  const f = fixture(t, instant('2026-09-20T12:00:00+08:00')), store = f.store;
  store.configureProfile({ className: '三年一班', startDate: '2026-09-01', confirmed: true });
  store.confirmTrait({ text: '喜欢合作', confirmed: true });
  store.recordEvent({ id: 'lesson-1', summary: '完成分数课堂摘录。', at: f.now(), source: 'lesson' });
  f.set(instant('2026-10-01T12:00:00+08:00'));
  const reminder = store.dueReminders().find(item => item.kind === 'month-review');
  store.replaceTraits({ traits: ['现在改为独立思考'], confirmed: true });
  store.configureProfile({ className: '修改后的班名', confirmed: true });
  store.acknowledgeReminder(reminder.key, f.now(), reminder);
  const restarted = new CompanionStore(f.path, { now: f.now });
  const letter = restarted.snapshot().receipts.find(item => item.key === reminder.key).letter;
  assert.deepEqual(letter, reminder);
  assert.match(letter.body, /三年一班|喜欢合作/);
  assert.doesNotMatch(letter.body, /现在改为独立思考|修改后的班名/);
  const snapshot = restarted.snapshot(); snapshot.receipts[0].letter.body = '被修改';
  assert.equal(restarted.snapshot().receipts[0].letter.body, reminder.body);
});

test('older queue receipts without full letter remain readable; oversized letters are rejected', t => {
  const f = fixture(t), store = f.store;
  store.configureProfile({ startDate: '2026-09-01', confirmed: true });
  const saved = JSON.parse(readFileSync(f.path, 'utf8'));
  saved.receipts.push({ key: 'milestone:2026-09-01:7', queuedAt: f.now() });
  writeFileSync(f.path, JSON.stringify(saved));
  const restarted = new CompanionStore(f.path, { now: f.now });
  assert.equal(restarted.snapshot().receipts[0].letter, undefined);
  const reminder = restarted.dueReminders().find(item => item.kind === 'month-review');
  const before = readFileSync(f.path, 'utf8');
  assert.throws(() => restarted.acknowledgeReminder(reminder.key, f.now(), { ...reminder, body: '甲'.repeat(10001) }), /letter/);
  assert.equal(readFileSync(f.path, 'utf8'), before);
});

test('record caps refuse new data with old state unchanged', t => {
  const f = fixture(t), store = f.store;
  store.configureProfile({ startDate: '2026-09-01', confirmed: true });
  const persisted = JSON.parse(readFileSync(f.path, 'utf8'));
  persisted.events = Array.from({ length: COMPANION_LIMITS.events }, (_, index) => ({ id: `event-${index}`, summary: '已发生的课堂事件', at: 0, date: shanghaiDate(0), source: 'teacher', refs: [] }));
  writeFileSync(f.path, JSON.stringify(persisted));
  const restored = new CompanionStore(f.path, { now: f.now });
  const before = readFileSync(f.path, 'utf8');
  assert.throws(() => restored.recordEvent({ id: 'extra', summary: '新事件', at: f.now(), source: 'teacher' }), error => error.code === 'COMPANION_LIMIT_REACHED');
  assert.equal(readFileSync(f.path, 'utf8'), before);
});
