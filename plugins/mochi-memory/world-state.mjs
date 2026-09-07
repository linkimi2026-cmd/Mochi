// Mochi 记忆系统第一步：纯文件层（工单 MOCHI-P5-MEM-01）。
// 载体：world-state.md（工作状态快照，<=200 行）+ events/YYYY-MM-DD.jsonl（append-only 原始事件流）。
// 设计约束：零 npm 依赖，只用 node:fs/node:path；所有写 md 走 tmp+rename 原子写；
// events 只追加，绝不重写或删除已有行；滚动出界的变更先归档进 events 再删行，绝不静默丢历史。
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 三大段落的冻结名称（与工单骨架一致）。
const SECTIONS = ['待办', '近 24h 变更', '已知约定'];
const H1 = '# Mochi 工作状态';
const QUOTE = '> 本文件由 mochi-memory 维护，≤200 行；历史变更滚动到 events/*.jsonl，不丢记录。';
const MAX_LINES = 200;

// 工单冻结的段落键 -> md 段名映射（也直接接受中文段名）。
const SECTION_KEYS = { todos: '待办', changes: '近 24h 变更', conventions: '已知约定' };

function sectionTitle(name) {
  const title = SECTION_KEYS[name] || String(name);
  if (!SECTIONS.includes(title)) throw new Error(`未知段落：${name}`);
  return title;
}

// 数据根解析：与 mochi-dispatch 的 defaultDbPath 同模式（DSH_HOME 未设时 fallback ~/.mochi-home）。
export function defaultMemoryHome(dshHome = process.env.DSH_HOME) {
  const home = dshHome || join(process.env.HOME || '/tmp', '.mochi-home');
  return join(home, 'memory');
}

// 把 md 文本解析为 { head, sections }：head 是第一个 '## ' 之前的行（标题+引言），
// sections 是按出现顺序的 { title, lines } 数组。坏文件也能解析（无标题/缺段落均容忍）。
function parseWorldState(text) {
  const lines = String(text || '').split('\n');
  const head = [];
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      head.push(line);
    }
  }
  return { head, sections };
}

// 序列化为行数组（不含末尾空行，落盘时补一个换行符）。
function serializeWorldState(parsed) {
  const out = [];
  for (const line of parsed.head) out.push(line);
  for (const section of parsed.sections) {
    out.push(`## ${section.title}`);
    for (const line of section.lines) out.push(line);
  }
  // 去掉结尾多余空行，保持稳定形态（保证幂等：同内容多次序列化结果一致）。
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

// 补齐骨架：缺 H1/引言则前置；缺三大段落则在文件尾追加空段落。只补缺，不删原有内容。
function ensureSkeleton(parsed) {
  const headText = parsed.head.join('\n');
  if (!headText.includes(H1)) parsed.head = [H1, QUOTE, ''].concat(parsed.head);
  for (const name of SECTIONS) {
    if (!parsed.sections.some((section) => section.title === name)) {
      parsed.sections.push({ title: name, lines: [] });
    }
  }
}

// 原子写：同目录 `.tmp-` 前缀临时文件 + rename，防半写。
function atomicWrite(filePath, text) {
  mkdirSync(filePath.slice(0, filePath.lastIndexOf('/')), { recursive: true });
  const tmpPath = join(filePath.slice(0, filePath.lastIndexOf('/')), `.tmp-${filePath.slice(filePath.lastIndexOf('/') + 1)}`);
  writeFileSync(tmpPath, text, 'utf8');
  renameSync(tmpPath, filePath);
}

const stripBullet = (line) => line.replace(/^-\s*/, '');
const nowIso = () => new Date().toISOString();
const todayKey = () => new Date().toISOString().slice(0, 10);

export function openWorldState(homeDir = defaultMemoryHome()) {
  const worldStatePath = join(homeDir, 'world-state.md');
  const eventsDir = join(homeDir, 'events');

  // 读取 + 补骨架 + 落盘。文件不存在时先写骨架；缺段落时补段落且原有内容不丢。
  function load() {
    const raw = existsSync(worldStatePath) ? readFileSync(worldStatePath, 'utf8') : '';
    const parsed = parseWorldState(raw);
    ensureSkeleton(parsed);
    const lines = serializeWorldState(parsed);
    atomicWrite(worldStatePath, lines.join('\n') + '\n');
    return { parsed, lines };
  }

  // 在内存里改段落后再整体原子写回。
  function save(parsed) {
    const lines = serializeWorldState(parsed);
    atomicWrite(worldStatePath, lines.join('\n') + '\n');
    return lines;
  }

  function sectionOf(parsed, name) {
    const title = sectionTitle(name);
    const section = parsed.sections.find((s) => s.title === title);
    if (!section) throw new Error(`world-state.md 缺少段落「${title}」。`);
    return section;
  }

  // events 追加：一行一个 JSON 对象，ts 由模块补 ISO 时间；只追加，绝不重写已有行。
  function appendEvent(event) {
    mkdirSync(eventsDir, { recursive: true });
    const record = {
      ts: nowIso(),
      kind: String(event?.kind || 'unknown'),
      summary: String(event?.summary || ''),
      refs: Array.isArray(event?.refs) ? event.refs : [],
      actor: event?.actor === undefined ? '' : String(event.actor),
    };
    appendFileSync(join(eventsDir, `${todayKey()}.jsonl`), JSON.stringify(record) + '\n', 'utf8');
  }

  function readEvents(opts = {}) {
    const date = opts.date || todayKey();
    const limit = opts.limit === undefined ? 100 : Number(opts.limit);
    const filePath = join(eventsDir, `${date}.jsonl`);
    if (!existsSync(filePath)) return [];
    const rows = [];
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* 坏行容忍：跳过不中断读取 */ }
    }
    // 返回最近 limit 条，保持时间正序。
    return limit >= 0 && rows.length > limit ? rows.slice(rows.length - limit) : rows;
  }

  // 200 行硬上限：追加变更后超限时，把「近 24h 变更」段最老条目逐条滚出，
  // 每滚一条先归档进 events（change-archive），再从 md 删行——绝不静默丢历史。
  function appendChangeWithCap(parsed, entry) {
    const changes = sectionOf(parsed, '近 24h 变更');
    changes.lines.push(entry);
    let lines = serializeWorldState(parsed);
    while (lines.length > MAX_LINES) {
      const index = changes.lines.findIndex((line) => line.trim() !== '');
      if (index === -1) break; // 变更段已空：其余段落超限不属于本模块职责，保留不动。
      const oldest = changes.lines.splice(index, 1)[0];
      appendEvent({ kind: 'change-archive', summary: stripBullet(oldest) });
      lines = serializeWorldState(parsed);
    }
    atomicWrite(worldStatePath, lines.join('\n') + '\n');
  }

  return {
    homeDir,
    // 全文；文件不存在时先写骨架再返回。
    readWorldState() {
      load();
      return readFileSync(worldStatePath, 'utf8');
    },
    // 整段替换指定段落内容（lines 为段落条目数组）。
    replaceSection(section, lines) {
      const parsed = load().parsed;
      sectionOf(parsed, section).lines = lines.map(String);
      save(parsed);
    },
    // 待办追加。
    appendTodo(text) {
      const parsed = load().parsed;
      sectionOf(parsed, '待办').lines.push(`- ${String(text)}`);
      save(parsed);
    },
    // 按文本匹配移除待办，返回是否命中（先精确匹配，退化为包含匹配）。
    completeTodo(text) {
      const parsed = load().parsed;
      const todos = sectionOf(parsed, '待办');
      const target = String(text).trim();
      let index = todos.lines.findIndex((line) => stripBullet(line).trim() === target);
      if (index === -1) index = todos.lines.findIndex((line) => line.includes(target));
      if (index === -1) return false;
      todos.lines.splice(index, 1);
      save(parsed);
      return true;
    },
    // 变更追加：自动带 ISO 时间戳前缀；超 200 行滚动归档。
    appendChange(text) {
      const parsed = load().parsed;
      appendChangeWithCap(parsed, `- ${nowIso()} ${String(text)}`);
    },
    // 已知约定：同文本去重。
    setConvention(text) {
      const parsed = load().parsed;
      const conventions = sectionOf(parsed, '已知约定');
      const entry = `- ${String(text)}`;
      if (conventions.lines.some((line) => stripBullet(line).trim() === String(text).trim())) return;
      conventions.lines.push(entry);
      save(parsed);
    },
    appendEvent,
    readEvents,
  };
}
