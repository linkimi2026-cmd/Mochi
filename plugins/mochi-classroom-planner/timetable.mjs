import { createHash } from 'node:crypto';

export const TIME_ZONE = 'Asia/Shanghai';
const days = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
export function weekday(value) {
  const text = String(value ?? '').trim();
  if (/^[1-7]$/.test(text)) return Number(text);
  return days[text.replace(/^(星期|周|礼拜)/, '')] ?? null;
}
export function clock(value) {
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
    return minutes < 1440 ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` : null;
  }
  const match = String(value ?? '').trim().match(/^(\d{1,2})[:：](\d{2})(?::00)?$/);
  return match && +match[1] < 24 && +match[2] < 60 ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}
const text = (value, max) => String(value ?? '').trim().slice(0, max);
export function validateTimetable(input) {
  if (!input || !Array.isArray(input.lessons) || input.lessons.length < 1 || input.lessons.length > 140) throw new Error('课表需要 1–140 节课。');
  const issues = [], seen = new Set(), lessons = [];
  for (const [index, item] of input.lessons.entries()) {
    const source = text(item.source || `第 ${index + 1} 项`, 120);
    const day = weekday(item.weekday), start = clock(item.start), end = clock(item.end), subject = text(item.subject, 60);
    if (!day || !start || !end || !subject || end <= start || item.uncertain === true) { issues.push(`${source}：请核对星期、科目与起止时间。`); continue; }
    const key = `${day}|${start}|${end}|${subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (lessons.some(row => row.weekday === day && row.start < end && start < row.end)) issues.push(`${source}：与同一天的另一节课时间重叠。`);
    lessons.push({ id: createHash('sha256').update(key).digest('hex').slice(0, 20), weekday: day, start, end, subject, source });
  }
  if (input.issues?.length) issues.push(...input.issues.map(item => text(item, 180)));
  const leadMinutes = input.leadMinutes === undefined ? 5 : Number(input.leadMinutes);
  if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 30) issues.push('提前提醒时间须为 0–30 分钟。');
  return { className: text(input.className, 60), source: text(input.source, 180), timeZone: TIME_ZONE, leadMinutes, lessons: lessons.sort((a,b) => a.weekday-b.weekday || a.start.localeCompare(b.start)), draftLessons: input.lessons, issues };
}
export function reminderTime(lesson, leadMinutes) {
  const [hour, minute] = lesson.start.split(':').map(Number);
  const total = hour * 60 + minute - leadMinutes;
  return { weekday: total < 0 ? (lesson.weekday + 5) % 7 + 1 : lesson.weekday,
    time: `${String(Math.floor(((total + 1440) % 1440) / 60)).padStart(2, '0')}:${String((total + 1440) % 60).padStart(2, '0')}` };
}

/** Interpret rows or a weekday grid; missing school bell times remain unresolved. */
export function parseRows(rows, source = '') {
  const usable = rows.map((cells, index) => ({ cells: cells.map(cell => typeof cell === 'object' && cell !== null ? cell.result ?? cell.text ?? cell.richText?.map(t => t.text).join('') ?? '' : cell), line: index + 1 }));
  const header = usable.find(row => row.cells.some(cell => /^(星期|周几|weekday)$/i.test(String(cell).trim())) && row.cells.some(cell => /^(科目|课程|subject)$/i.test(String(cell).trim())));
  const lessons = [], issues = [];
  if (header) {
    const find = re => header.cells.findIndex(cell => re.test(String(cell).trim()));
    const d = find(/^(星期|周几|weekday)$/i), s = find(/^(科目|课程|subject)$/i), a = find(/^(开始|开始时间|上课时间|start)$/i), b = find(/^(结束|结束时间|下课时间|end)$/i);
    if (a < 0 || b < 0) issues.push('请补充“开始时间”和“结束时间”列。');
    for (const row of usable.filter(row => row.line > header.line && row.cells.some(cell => String(cell ?? '').trim()))) lessons.push({ weekday: row.cells[d], subject: row.cells[s], start: row.cells[a], end: row.cells[b], source: `第 ${row.line} 行` });
  } else {
    const grid = usable.find(row => row.cells.filter(cell => weekday(cell)).length >= 2);
    if (!grid) throw new Error('未找到课表表头。可使用“星期、科目、开始时间、结束时间”四列，或带星期与起止时间的周课表。');
    const columns = grid.cells.flatMap((cell, index) => weekday(cell) ? [{ index, day: weekday(cell) }] : []);
    for (const row of usable.filter(row => row.line > grid.line)) {
      const range = row.cells.map(cell => String(cell ?? '')).join(' ').match(/(\d{1,2}[:：]\d{2})\s*[-–—~～至]\s*(\d{1,2}[:：]\d{2})/);
      for (const { index, day } of columns) {
        const subject = String(row.cells[index] ?? '').trim();
        if (!subject || /^[-—/]|^(休息|课间|午休|无课)$/.test(subject)) continue;
        lessons.push({ weekday: day, subject, start: range?.[1], end: range?.[2], source: `第 ${row.line} 行，第 ${index + 1} 列` });
      }
    }
  }
  return validateTimetable({ lessons, issues, source });
}
