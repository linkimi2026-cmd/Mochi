import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const COMPANION_LIMITS = Object.freeze({ traits: 50, events: 2000, receipts: 1200, fileBytes: 8 * 1024 * 1024 });
const MILESTONES = [7, 30, 100, 365, 1000];
const formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402185599999;
const string = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function shanghaiDate(at) {
  if (!timestamp(at)) throw new Error('Invalid companion time');
  const parts = Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

function ordinal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期请使用真实的 YYYY-MM-DD。');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('日期不存在，请核对开始日期。');
  return date.getTime() / 86400000;
}

export function companionshipDays(startDate, at) {
  if (startDate === null || startDate === undefined) return null;
  return Math.max(0, ordinal(shanghaiDate(at)) - ordinal(startDate) + 1);
}

function validate(data) {
  if (!data || data.version !== 1 || !data.profile || !Array.isArray(data.traits) || !Array.isArray(data.events) || !Array.isArray(data.receipts)) throw new Error('Unsupported companion store');
  for (const field of ['className', 'teacherName']) if (data.profile[field] !== null && !string(data.profile[field], 80)) throw new Error('Invalid companion profile');
  if (data.profile.startDate !== null) ordinal(data.profile.startDate);
  if (data.profile.confirmedAt !== null && !timestamp(data.profile.confirmedAt)) throw new Error('Invalid profile confirmation');
  if (data.traits.length > COMPANION_LIMITS.traits || data.events.length > COMPANION_LIMITS.events || data.receipts.length > COMPANION_LIMITS.receipts) throw new Error('Companion store limit exceeded');
  const unique = items => new Set(items.map(item => item.id)).size === items.length;
  if (!unique(data.traits) || !unique(data.events) || new Set(data.receipts.map(item => item.key)).size !== data.receipts.length) throw new Error('Duplicate companion records');
  for (const trait of data.traits) if (!string(trait.id, 120) || !string(trait.text, 200) || trait.source !== 'teacher-confirmed' || !timestamp(trait.confirmedAt)) throw new Error('Invalid confirmed trait');
  for (const event of data.events) if (!string(event.id, 120) || !string(event.summary, 400) || !string(event.source, 80) || !timestamp(event.at) ||
    event.date !== shanghaiDate(event.at) || !Array.isArray(event.refs) || event.refs.length > 10 || event.refs.some(ref => !string(ref, 120))) throw new Error('Invalid companion event');
  for (const receipt of data.receipts) if (!string(receipt.key, 100) || !timestamp(receipt.queuedAt) || !/^(?:month:\d{4}-\d{2}|milestone:\d{4}-\d{2}-\d{2}:\d+)$/.test(receipt.key)) throw new Error('Invalid reminder receipt');
  for (const receipt of data.receipts) if (receipt.letter !== undefined && (!receipt.letter || receipt.letter.key !== receipt.key ||
    !string(receipt.letter.title, 120) || !string(receipt.letter.body, 10000) || !timestamp(receipt.letter.createdAt) || receipt.letter.createdAt > receipt.queuedAt ||
    receipt.letter.kind !== (receipt.key.startsWith('month:') ? 'month-review' : 'milestone') || !Array.isArray(receipt.letter.sourceIds) ||
    receipt.letter.sourceIds.length > 50 || receipt.letter.sourceIds.some(id => !string(id, 120)))) throw new Error('Invalid companion letter');
}

/** Confirmed class facts and queue receipts, independent of model-inferred memory. */
export class CompanionStore {
  constructor(path, { now = Date.now } = {}) {
    this.path = path; this.now = now;
    this.data = { version: 1, profile: { className: null, teacherName: null, startDate: null, confirmedAt: null }, traits: [], events: [], receipts: [] };
    try {
      if (statSync(path).size > COMPANION_LIMITS.fileBytes) throw new Error('Companion store file too large');
      this.data = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    validate(this.data);
  }
  _time(at = this.now()) { if (!timestamp(at)) throw new Error('Invalid companion time'); return at; }
  _save(next) {
    validate(next);
    const raw = JSON.stringify(next);
    if (Buffer.byteLength(raw) > COMPANION_LIMITS.fileBytes) throw new Error('Companion store file too large');
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, raw, { mode: 0o600 }); renameSync(temporary, this.path); }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    this.data = next;
  }
  configureProfile(input) {
    if (!input || input.confirmed !== true || Object.keys(input).some(field => !['className', 'teacherName', 'startDate', 'confirmed'].includes(field))) throw new Error('班级资料需要老师确认。');
    const next = structuredClone(this.data);
    for (const field of ['className', 'teacherName', 'startDate']) if (Object.hasOwn(input, field)) {
      if (input[field] !== null && typeof input[field] !== 'string') throw new Error('Invalid companion profile');
      next.profile[field] = input[field] === null ? null : input[field].trim();
    }
    next.profile.confirmedAt = this._time(); this._save(next);
    return this.snapshot();
  }
  confirmTrait({ id = randomUUID(), text, confirmed }) {
    if (confirmed !== true || !string(text, 200) || !string(id, 120)) throw new Error('班级特质需要老师确认，且不超过200字。');
    const next = structuredClone(this.data);
    const existing = next.traits.find(trait => trait.id === id || trait.text === text.trim());
    if (existing?.text === text.trim()) return structuredClone(existing);
    if (!existing && next.traits.length >= COMPANION_LIMITS.traits) throw Object.assign(new Error('已达到班级特质保存上限。'), { code: 'COMPANION_LIMIT_REACHED' });
    const trait = { id: existing?.id ?? id, text: text.trim(), source: 'teacher-confirmed', confirmedAt: this._time() };
    if (existing) next.traits[next.traits.indexOf(existing)] = trait; else next.traits.push(trait);
    this._save(next); return structuredClone(trait);
  }
  replaceTraits({ traits, confirmed }) {
    if (confirmed !== true || !Array.isArray(traits) || traits.length > COMPANION_LIMITS.traits || traits.some(text => !string(text, 200))) throw new Error('班级特质需要老师确认。');
    const next = structuredClone(this.data), at = this._time();
    next.traits = [...new Set(traits.map(text => text.trim()))].map(text => next.traits.find(trait => trait.text === text) ??
      { id: randomUUID(), text, source: 'teacher-confirmed', confirmedAt: at });
    this._save(next); return this.snapshot();
  }
  recordEvent({ id, summary, at, source, refs = [] }) {
    const now = this._time();
    if (!timestamp(at) || at > now || !string(id, 120) || !string(summary, 400) || !string(source, 80) || !Array.isArray(refs) || refs.length > 10 || refs.some(ref => !string(ref, 120))) throw new Error('事件需有真实时间、来源和不超过400字的原始摘要。');
    const event = { id, summary: summary.trim(), at, date: shanghaiDate(at), source, refs: [...refs] };
    const existing = this.data.events.find(item => item.id === id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error('Companion event id conflict');
      return structuredClone(existing);
    }
    if (this.data.events.length >= COMPANION_LIMITS.events) throw Object.assign(new Error('陪伴事件已达到保存上限，已保存的记录仍保留。'), { code: 'COMPANION_LIMIT_REACHED' });
    const next = structuredClone(this.data); next.events.push(event); this._save(next);
    return structuredClone(event);
  }
  snapshot(at = this.now()) {
    this._time(at);
    const today = shanghaiDate(at), days = companionshipDays(this.data.profile.startDate, at);
    const status = days === null ? 'missing-start-date' : days === 0 ? 'not-started' : 'active';
    const missing = ['className', 'startDate'].filter(field => this.data.profile[field] === null);
    const label = this.data.profile.className ?? '这个班级';
    const message = days === null ? '尚未确认陪伴开始日期，暂时不能计算陪伴天数。'
      : days === 0 ? `陪伴开始日期是${this.data.profile.startDate}，目前尚未开始。`
        : `Mochi 与${label}已经一起走过${days}天。`;
    return { ...structuredClone(this.data), today, timeZone: 'Asia/Shanghai', days, status, missing, message };
  }
  monthlyReview(month, at = this.now()) {
    if (typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid review month');
    const today = shanghaiDate(this._time(at));
    if (month >= today.slice(0, 7)) throw new Error('月份尚未结束，不能生成整月回顾。');
    const start = `${month}-01`, year = Number(month.slice(0, 4)), number = Number(month.slice(5));
    ordinal(start);
    const end = `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
    const joined = this.data.profile.startDate;
    const events = this.data.events.filter(event => event.date >= start && event.date <= end && joined !== null && event.date >= joined).sort((a, b) => a.at - b.at);
    const traits = this.data.traits.filter(trait => shanghaiDate(trait.confirmedAt) <= end);
    const shownEvents = events.slice(-8), shownTraits = traits.slice(0, 5);
    const gaps = [];
    if (!joined) gaps.push('尚未确认陪伴开始日期，暂不能界定这段陪伴。');
    else if (joined > end) gaps.push('该月早于确认的陪伴开始日期，没有这段陪伴记录。');
    if (!events.length) gaps.push('这个月没有保存可回顾的班级事件，不能据此判断课堂表现。');
    if (!traits.length) gaps.push('截至该月结束，没有老师确认的班级特质。');
    const body = `${month} · ${this.data.profile.className ?? '班名尚未设置'}陪伴回顾\n\n` +
      (shownEvents.length ? `已记录事件${events.length}条${events.length > 8 ? '，以下列出最近8条' : ''}：\n${shownEvents.map(event => `${event.date} · ${event.summary}`).join('\n')}\n\n` : '') +
      (shownTraits.length ? `老师此前确认的班级特质${traits.length > 5 ? '（展示前5条）' : ''}：\n${shownTraits.map(trait => trait.text).join('\n')}\n\n` : '') +
      (gaps.length ? gaps.join('\n') + '\n\n' : '') + '以上只来自保存的事件和老师确认的资料。';
    return { month, body, events: structuredClone(events), traits: structuredClone(traits), sourceIds: [...shownEvents.map(event => event.id), ...shownTraits.map(trait => trait.id)], gaps };
  }
  dueReminders(at = this.now()) {
    const state = this.snapshot(at);
    if (state.status !== 'active') return [];
    const acknowledged = new Set(this.data.receipts.map(receipt => receipt.key)), reminders = [];
    const date = state.today, year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
    if (Number(date.slice(8)) <= 7) {
      const previous = new Date(Date.UTC(year, month - 1, 0));
      const period = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
      const end = `${period}-${previous.getUTCDate()}`;
      if (this.data.profile.startDate <= end && !acknowledged.has(`month:${period}`)) {
        const review = this.monthlyReview(period, at);
        reminders.push({ key: `month:${period}`, kind: 'month-review', title: 'Mochi 的月初陪伴回顾', body: review.body, createdAt: at, sourceIds: review.sourceIds });
      }
    }
    for (const milestone of MILESTONES) {
      const reminderKey = `milestone:${state.profile.startDate}:${milestone}`;
      if (state.days >= milestone && state.days < milestone + 7 && !acknowledged.has(reminderKey)) reminders.push({
        key: reminderKey, kind: 'milestone', title: `一起走过${milestone}天`, createdAt: at, sourceIds: [],
        body: `从老师确认的${state.profile.startDate}算起，Mochi 与${state.profile.className ?? '这个班级'}已经一起走过${state.days}天。${state.profile.className ? '' : '班名还没有填写。'}\n陪伴天数按上海日期计算，开始当天算第1天。`,
      });
    }
    return reminders;
  }
  /** Call after the native queue accepts; this receipt never means read or seen. */
  acknowledgeReminder(key, at = this.now(), reminder) {
    this._time(at);
    if (this.data.receipts.some(receipt => receipt.key === key)) return false;
    const state = this.snapshot(at);
    const month = typeof key === 'string' ? /^month:(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(key)?.[1] : undefined;
    const milestone = typeof key === 'string' ? /^milestone:(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(key) : undefined;
    const eligible = state.status === 'active' && (month ? month < state.today.slice(0, 7) && state.profile.startDate.slice(0, 7) <= month
      : milestone && milestone[1] === state.profile.startDate && MILESTONES.includes(Number(milestone[2])) && state.days >= Number(milestone[2]));
    if (!eligible) throw new Error('Invalid reminder receipt');
    if (this.data.receipts.length >= COMPANION_LIMITS.receipts) throw Object.assign(new Error('陪伴提醒记录已达到保存上限。'), { code: 'COMPANION_LIMIT_REACHED' });
    const delivered = reminder ?? this.dueReminders(at).find(item => item.key === key);
    if (!delivered || delivered.key !== key || !Array.isArray(delivered.sourceIds)) throw new Error('请保存实际投递的完整提醒原信。');
    const letter = { key, kind: delivered.kind, title: delivered.title, body: delivered.body, createdAt: delivered.createdAt, sourceIds: [...(delivered.sourceIds ?? [])] };
    const next = structuredClone(this.data); next.receipts.push({ key, queuedAt: at, letter }); this._save(next); return true;
  }
}
