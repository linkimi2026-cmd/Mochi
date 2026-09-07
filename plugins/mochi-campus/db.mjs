// ────────────────────────────────────────────────────────────────────────
// mochi-campus 数据层（2026-09-05）：校园 D1 真库只读读取 + 演示数据兜底
//
// 设计约束（红线）：
//  · 本模块【绝不执行任何写语句】——只 SELECT。写操作必须走校园系统自己的
//    API（wrangler dev @8787）+ 审批闸，不归插件管。
//  · D1 文件由 wrangler dev（8787）持有（WAL 模式），并发只读安全。
//  · 找不到库/打开失败/查询失败 → 返回 null，index.mjs 静默降级 demo，
//    工具输出里的 dataMode 会如实标注 'live' / 'demo'。
//  · DB 定位：MOCHI_CAMPUS_DB 环境变量优先，否则扫 D1 目录里非 metadata
//    的 .sqlite（miniflare 的哈希文件名可能随重建变化，不能写死）。
// ────────────────────────────────────────────────────────────────────────
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D1_DIR = path.resolve(
  HERE,
  '../../campus.nosync/.wrangler/state/v3/d1/miniflare-D1DatabaseObject',
);

let cached = undefined; // undefined=未尝试 · null=打开失败 · DatabaseSync=就绪

function openDb() {
  if (cached !== undefined) return cached;
  try {
    const explicit = process.env.MOCHI_CAMPUS_DB;
    const file = explicit || (() => {
      const files = readdirSync(D1_DIR).filter(
        (f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite',
      );
      if (files.length === 0) throw new Error('D1 目录无库文件: ' + D1_DIR);
      return path.join(D1_DIR, files[0]);
    })();
    // node:sqlite 的 readOnly 选项在部分 22.x 版本不存在 → 逐级降级。
    // 无论哪种打开方式，本模块都只跑 SELECT。
    try {
      cached = new DatabaseSync(file, { readOnly: true });
    } catch {
      cached = new DatabaseSync(file);
    }
  } catch {
    cached = null;
  }
  return cached;
}

/** 数据源模式：'live' = 校园 D1 真库；'demo' = 内置演示数据。 */
export function dataMode() {
  return openDb() ? 'live' : 'demo';
}

/** ISO / "YYYY-MM-DD HH:MM:SS" → "HH:MM" */
function hhmm(ts) {
  if (!ts) return '';
  const s = String(ts);
  const i = s.indexOf('T');
  return (i >= 0 ? s.slice(i + 1) : s.slice(11)).slice(0, 5);
}

/**
 * 在途 + 近 24h 闭环的学生流动 → 与 index.mjs 的 DEMO_ROWS 完全同构的行。
 * status 归一：OUTBOUND/RETURNING→'out' · ARRIVED+INFIRMARY→'in_clinic' ·
 * ARRIVED+DORMITORY→'in_dorm' · CLOSED→'returned'。
 * 查询失败返回 null（调用方降级 demo），绝不吐半截数据。
 */
export function liveMovementRows() {
  const db = openDb();
  if (!db) return null;
  let rows;
  try {
    rows = db
      .prepare(
        `SELECT s.name AS name, c.name AS className, m.status, m.destination,
                m.departed_at, m.arrived_at, m.returned_at, m.left_destination_at,
                m.arrival_overdue_at, m.return_overdue_at
           FROM student_movements m
           JOIN students s ON s.id = m.student_id
           JOIN classes  c ON c.id = s.class_id
          WHERE m.status IN ('OUTBOUND','ARRIVED','RETURNING')
             OR (m.status = 'CLOSED'
                 AND m.created_at >= datetime('now','localtime','-1 day'))
          ORDER BY m.departed_at DESC LIMIT 80`,
      )
      .all();
  } catch {
    return null;
  }
  return rows.map((r) => {
    const overdue = Boolean(r.arrival_overdue_at || r.return_overdue_at);
    let status, place, since;
    if (r.status === 'OUTBOUND') {
      status = 'out';
      place = r.destination === 'INFIRMARY' ? '前往医务室' : '前往宿舍';
      since = hhmm(r.departed_at);
    } else if (r.status === 'RETURNING') {
      status = 'out';
      place = r.destination === 'INFIRMARY' ? '返程途中（自医务室）' : '返程途中（自宿舍）';
      since = hhmm(r.left_destination_at || r.departed_at);
    } else if (r.status === 'ARRIVED' && r.destination === 'INFIRMARY') {
      status = 'in_clinic';
      place = '医务室';
      since = hhmm(r.arrived_at);
    } else if (r.status === 'ARRIVED') {
      status = 'in_dorm';
      place = '宿舍';
      since = hhmm(r.arrived_at);
    } else {
      status = 'returned';
      place = '已返班';
      since = hhmm(r.returned_at);
    }
    return { name: r.name, className: r.className, status, place, since, overdue };
  });
}

/**
 * 健康事件（就诊/留观/不适处理）只读查询。
 * 返回 { student, className, category, urgency, status, measure, note, visitedAt }；
 * 失败返回 null（调用方降级 demo）。
 */
export function liveHealthRows({ keyword, urgency, limit } = {}) {
  const db = openDb();
  if (!db) return null;
  let rows;
  try {
    rows = db
      .prepare(
        `SELECT s.name AS student, c.name AS className, he.category, he.urgency,
                he.status, he.measure, he.note, he.visited_at
           FROM health_events he
           JOIN students s ON s.id = he.student_id
           JOIN classes  c ON c.id = s.class_id
          ORDER BY he.visited_at DESC LIMIT 200`,
      )
      .all();
  } catch {
    return null;
  }
  // 过滤在 JS 侧做：学生量级很小（<100），SQL 端 LIKE 处理中文括号归一化反而绕
  const norm = (t) => String(t ?? '').replace(/[()（）\s]/g, '').toLowerCase();
  const kw = norm(keyword);
  const filtered = rows.filter(
    (r) =>
      (!kw ||
        norm(r.student).includes(kw) ||
        norm(r.className).includes(kw) ||
        norm(r.note).includes(kw) ||
        norm(r.category).includes(kw)) &&
      (!urgency || r.urgency === urgency),
  );
  const lim =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 30;
  return filtered.slice(0, lim).map((r) => ({ ...r, visitedAt: String(r.visited_at ?? '') }));
}
