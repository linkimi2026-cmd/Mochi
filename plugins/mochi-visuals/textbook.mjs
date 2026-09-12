// mochi-visuals · 本地教材配图匹配。
//
// 数据源是 mochi-knowledge 导入的本机教材索引（node:sqlite，只读打开）：
//   <DSH_HOME>/knowledge/textbook.sqlite
//     textbook_books(id,title,subject,publisher,volume,...,library_file,page_count,...)
//     textbook_pages(textbook_id,pdf_page,printed_page,text_status,...,display_text,search_text)
// 结构定义见 plugins/mochi-knowledge/knowledge-store.mjs。
//
// 硬约束：
//   * 只读打开数据库，只做 SELECT，不写任何一行（不冒充导入/OCR）。
//   * 只返回数据库里真实存在的命中页；找不到就明确返回“本地无匹配”。
//   * 不做任何联网请求。联网只作为「建议」文本给出，且明确标注未执行。
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MAX_RESULTS = 8;
export const MAX_QUERY_CHARS = 160;

export class TextbookError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TextbookError';
    this.code = code;
  }
}

function fail(code, message) {
  return new TextbookError(code, message);
}

/** 与 knowledge-store.mjs 的 defaultKnowledgeHome 同一解析顺序。 */
export function defaultKnowledgeHome(env = process.env) {
  const home = env.DSH_HOME || join(env.HOME || '/tmp', '.mochi-home');
  return join(home, 'knowledge');
}

export function textbookDatabasePath({ knowledgeHome, env = process.env } = {}) {
  if (env.MOCHI_KNOWLEDGE_HOME) return join(env.MOCHI_KNOWLEDGE_HOME, 'textbook.sqlite');
  // 注意：knowledgeHome 的默认值必须用「调用方传入的 env」来算，不能用 process.env，
  // 否则宿主用 options.env 指定数据根时会去翻错目录（旧写法就是这个问题）。
  return join(knowledgeHome || defaultKnowledgeHome(env), 'textbook.sqlite');
}

/** 与 knowledge-store.mjs 的 normalizeSearchText 保持同一归一化：NFKC + 小写 + 去空白。 */
export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '');
}

function normalizeDisplayText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

const MAX_SNIPPET_CHARS = 220;

/** 与 knowledge-store.mjs 的 makeSnippet 同语义：围绕命中位置截一段上下文。 */
function makeSnippet(displayText, normalizedQuery) {
  const source = [...String(displayText || '')];
  const normalized = [];
  const sourceOffsets = [];
  for (let offset = 0; offset < source.length; offset += 1) {
    for (const character of source[offset].normalize('NFKC').toLocaleLowerCase()) {
      if (/\s/u.test(character)) continue;
      normalized.push(character);
      sourceOffsets.push(offset);
    }
  }
  const query = [...normalizedQuery];
  let matchAt = -1;
  for (let index = 0; index <= normalized.length - query.length; index += 1) {
    if (query.every((character, queryIndex) => normalized[index + queryIndex] === character)) {
      matchAt = index;
      break;
    }
  }
  if (matchAt < 0) return '';
  const matchStart = sourceOffsets[matchAt];
  const matchEnd = sourceOffsets[matchAt + query.length - 1] + 1;
  const maximumText = Math.max(1, MAX_SNIPPET_CHARS - (matchStart > 0 ? 1 : 0) - (matchEnd < source.length ? 1 : 0));
  let before = Math.max(0, matchStart - Math.floor(maximumText / 2));
  let after = Math.min(source.length, before + maximumText);
  before = Math.max(0, after - maximumText);
  return `${before > 0 ? '…' : ''}${source.slice(before, after).join('')}${after < source.length ? '…' : ''}`;
}

function recognitionLabel(status) {
  if (status === 'text-layer') return '文字层';
  if (status === 'ocr') return '离线 OCR（公式/图表须核对原页）';
  if (status === 'ocr-empty') return 'OCR 未识别到可检索文本';
  if (status === 'pending-ocr') return '待离线 OCR';
  if (status === 'unreadable') return '该页文字层读取失败';
  return '未识别';
}

/** 把章节标题拆成可能命中的检索片段：整串优先，其次按分隔符拆出的长片段。 */
export function deriveQueryTerms(topic, { subject, volume } = {}) {
  const raw = String(topic ?? '').trim();
  if (!raw) throw fail('BAD_ARGUMENT', 'topic 不能为空：请给出知识点或章节标题。');
  if ([...raw].length > MAX_QUERY_CHARS) throw fail('BAD_ARGUMENT', `topic 不能超过 ${MAX_QUERY_CHARS} 字。`);
  const terms = [];
  const push = (value) => {
    const normalized = normalizeSearchText(value);
    if ([...normalized].length >= 2 && !terms.includes(normalized)) terms.push(normalized);
  };
  push(raw);
  // 章节标题常见形如「第2章 光的折射」「§3.1 牛顿第一定律」，整串去空格后往往仍不连续，
  // 因此按标点/空格/章节号切出长片段作为补充检索词。
  const segments = raw
    .split(/[\s，,。；;：:、|/\\·—\-—()（）[\]【】《》"'“”]+/u)
    .map((segment) => segment.replace(/^第?\s*\d+(?:\.\d+)*\s*[章节讲课时]?/u, '').trim())
    .filter(Boolean);
  for (const segment of segments) push(segment);
  if (subject) push(String(subject));
  if (volume) push(String(volume));
  if (terms.length === 0) throw fail('BAD_ARGUMENT', 'topic 至少需要两个非空白字符（或一个可检索的中文词）才能检索教材索引。');
  return terms;
}

function mapRow(row, term) {
  return {
    教材ID: row.id,
    书名: row.title,
    学科: row.subject,
    出版社: row.publisher,
    册别: row.volume,
    PDF页号: Number(row.pdf_page),
    印刷页号: row.printed_page === null || row.printed_page === undefined ? null : Number(row.printed_page),
    印刷页号状态: row.printed_page === null || row.printed_page === undefined ? '未识别' : '已识别',
    识别状态: recognitionLabel(row.text_status),
    需核对原页: Boolean(row.requires_original_page_check),
    摘录: makeSnippet(row.display_text, term),
    命中方式: `关键词“${term}”`,
  };
}

/**
 * 在本地教材索引里检索与 topic 相关的页。
 * 索引不存在 / 表不存在 / 无命中，都返回 状态: '本地无匹配'，绝不编造教材原图。
 */
export async function matchLocalTextbook({
  topic,
  subject,
  volume,
  bookId,
  limit = 5,
  knowledgeHome,
  env = process.env,
  databasePath,
} = {}) {
  const terms = deriveQueryTerms(topic, { subject, volume });
  const resultLimit = Math.min(MAX_RESULTS, Math.max(1, Number.isFinite(Number(limit)) ? Math.round(Number(limit)) : 5));
  const dbPath = databasePath || textbookDatabasePath({ knowledgeHome: knowledgeHome || defaultKnowledgeHome(env), env });

  const base = {
    查询: String(topic ?? '').trim(),
    检索词: terms,
    教材索引: dbPath,
  };

  let info;
  try {
    info = await stat(dbPath);
  } catch {
    return {
      ...base,
      状态: '本地无匹配',
      索引可用: false,
      原因: '本机没有已导入的教材索引（未找到 textbook.sqlite）。本工具不会联网找图，也不会伪造教材原图。',
      结果数: 0,
      结果: [],
    };
  }
  if (!info.isFile() || info.size === 0) {
    return {
      ...base,
      状态: '本地无匹配',
      索引可用: false,
      原因: '本机教材索引文件为空或不是普通文件；未做任何读取。',
      结果数: 0,
      结果: [],
    };
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    return {
      ...base,
      状态: '本地无匹配',
      索引可用: false,
      原因: `教材索引无法以只读方式打开（${error?.code ?? error?.message ?? '未知原因'}）；未做任何读取，也没有联网找图。`,
      结果数: 0,
      结果: [],
    };
  }

  try {
    const statement = db.prepare(`SELECT b.id, b.title, b.subject, b.publisher, b.volume, b.library_file, b.page_count,
        p.pdf_page, p.printed_page, p.text_status, p.requires_original_page_check, p.display_text, p.search_text
      FROM textbook_pages p JOIN textbook_books b ON b.id = p.textbook_id
      WHERE instr(p.search_text, ?) > 0
        AND (? IS NULL OR b.subject = ?)
        AND (? IS NULL OR b.volume = ?)
        AND (? IS NULL OR b.id = ?)
      ORDER BY length(p.search_text) ASC, p.pdf_page ASC
      LIMIT ?`);

    const hits = [];
    const seen = new Set();
    const usedTerms = [];
    for (const term of terms) {
      const rows = statement.all(
        term,
        subject ?? null, subject ?? null,
        volume ?? null, volume ?? null,
        bookId ?? null, bookId ?? null,
        resultLimit,
      );
      if (rows.length > 0 && !usedTerms.includes(term)) usedTerms.push(term);
      for (const row of rows) {
        const key = `${row.id}#${row.pdf_page}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ ...mapRow(row, term), _score: [...term].length });
        if (hits.length >= resultLimit) break;
      }
      if (hits.length >= resultLimit) break;
    }

    if (hits.length === 0) {
      return {
        ...base,
        状态: '本地无匹配',
        索引可用: true,
        原因: '本机教材索引里没有与该知识点匹配的页。以下是可选的联网检索建议，本工具没有执行任何联网请求。',
        结果数: 0,
        结果: [],
      };
    }

    hits.sort((a, b) => (b._score - a._score) || (a.PDF页号 - b.PDF页号));
    return {
      ...base,
      状态: '本地已匹配',
      索引可用: true,
      命中的检索词: usedTerms,
      结果数: hits.length,
      结果: hits.map(({ _score, ...hit }) => hit),
      取图方式: '对任一命中页调用 mochi_knowledge_page_image（传 教材ID 与 PDF页号）可得到该页的受管 PNG。',
      说明: '结果来自本机已导入教材索引的真实页记录；公式、图表与精确原文仍需与该页原图核对。',
    };
  } catch (error) {
    return {
      ...base,
      状态: '本地无匹配',
      索引可用: false,
      原因: `教材索引读取失败（${error?.code ?? error?.message ?? '未知原因'}）；未做任何写入，也没有联网找图。`,
      结果数: 0,
      结果: [],
    };
  } finally {
    try { db.close(); } catch { /* 关闭失败不影响已取得的结果 */ }
  }
}

/** 联网检索建议：只是文字建议，本模块不发任何网络请求。 */
export function networkSuggestions(topic, subject) {
  const cleaned = String(topic ?? '').trim();
  const keyword = subject ? `${subject} ${cleaned}` : cleaned;
  return {
    已执行联网检索: false,
    说明: '本工具不联网取图。若本地教材库没有匹配，可人工在下列开放图库检索，并自行确认授权与署名要求。',
    建议检索词: [cleaned, keyword].filter(Boolean),
    可选开放图库: [
      { 名称: 'Wikimedia Commons', 接口: 'https://commons.wikimedia.org/w/api.php', 许可提示: '许可混合（CC/公有领域），逐图确认署名' },
      { 名称: 'Openverse', 接口: 'https://api.openverse.org/v1/images/', 许可提示: 'CC 系许可，需按返回的 attribution 署名' },
    ],
    注意: '开放图库图片不一定是教材原图，也不保证与所用教材版本一致；进课件前请人工核对。',
  };
}
