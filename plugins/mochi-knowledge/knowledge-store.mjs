// mochi-knowledge · 受管本地教材库。
// PDF 只能由本机导入器显式写入；模型工具只按已导入 bookId/page 查询，绝不接收任意文件路径。
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_SEARCH_RESULTS = 8;
export const MAX_QUERY_CHARS = 160;
export const MAX_SNIPPET_CHARS = 280;
export const TEXTBOOK_SOURCE_REPOSITORY = 'TapXWorld/ChinaTextbook';

const BOOK_ID_PREFIX = 'tb-';
const SAFE_BOOK_ID = /^tb-[a-f0-9]{64}$/;
const SAFE_LIBRARY_FILE = /^tb-[a-f0-9]{64}\.pdf$/;
const GIT_SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_METADATA_CHARS = 1_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS textbook_books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  publisher TEXT NOT NULL,
  volume TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_blob_hashes TEXT NOT NULL,
  source_sha256 TEXT NOT NULL UNIQUE,
  library_file TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  text_layer_pages INTEGER NOT NULL DEFAULT 0,
  ocr_pages INTEGER NOT NULL DEFAULT 0,
  pending_ocr_pages INTEGER NOT NULL DEFAULT 0,
  unreadable_pages INTEGER NOT NULL DEFAULT 0,
  index_status TEXT NOT NULL,
  edition_status TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS textbook_pages (
  textbook_id TEXT NOT NULL REFERENCES textbook_books(id) ON DELETE CASCADE,
  pdf_page INTEGER NOT NULL,
  printed_page INTEGER,
  text_status TEXT NOT NULL,
  ocr_confidence REAL,
  requires_original_page_check INTEGER NOT NULL DEFAULT 0,
  display_text TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (textbook_id, pdf_page)
);
CREATE INDEX IF NOT EXISTS textbook_pages_book_page ON textbook_pages(textbook_id, pdf_page);
CREATE INDEX IF NOT EXISTS textbook_books_subject_volume ON textbook_books(subject, volume);
`;

export class MochiKnowledgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MochiKnowledgeError';
    this.code = code;
  }
}

function fail(code, message) {
  return new MochiKnowledgeError(code, message);
}

function abortError() {
  const error = new Error('教材导入已取消。');
  error.name = 'AbortError';
  error.code = 'ABORTED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function now() {
  return new Date().toISOString();
}

function text(value, label, maximum = MAX_METADATA_CHARS) {
  if (typeof value !== 'string') throw fail('INVALID_METADATA', `${label} 必须是文本。`);
  const result = value.trim();
  if (!result || [...result].length > maximum) throw fail('INVALID_METADATA', `${label} 不能为空且长度不能超过 ${maximum} 字。`);
  return result;
}

function optionalText(value, fallback, label, maximum = MAX_METADATA_CHARS) {
  if (value === undefined || value === null || value === '') return fallback;
  return text(value, label, maximum);
}

function number(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw fail('INVALID_ARGUMENT', `${label} 无效。`);
  return result;
}

function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '');
}

function normalizeDisplayText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function textFromContent(content) {
  if (!Array.isArray(content?.items)) return '';
  return normalizeDisplayText(content.items.map((item) => {
    const value = typeof item?.str === 'string' ? item.str : '';
    return `${value}${item?.hasEOL ? '\n' : ''}`;
  }).join(''));
}

function gitBlobSha1(data) {
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function safeLibraryPath(libraryRoot, libraryFile) {
  if (!SAFE_LIBRARY_FILE.test(String(libraryFile))) throw fail('LIBRARY_PATH_INVALID', '教材库文件标识无效。');
  const result = resolve(libraryRoot, libraryFile);
  if (!isInside(libraryRoot, result)) throw fail('LIBRARY_PATH_INVALID', '教材库文件超出受管目录。');
  return result;
}

function sanitizeStatus(status) {
  const value = String(status || 'source-metadata-unverified').trim();
  if (!value || [...value].length > 120) throw fail('INVALID_METADATA', '版次核验状态无效。');
  return value;
}

function normalizeParts(input) {
  const rawParts = Array.isArray(input?.sourceParts) && input.sourceParts.length > 0
    ? input.sourceParts
    : [{ path: input?.sourcePath, sourceBlobSha: input?.sourceBlobSha }];
  return rawParts.map((part, index) => {
    const sourcePath = text(part?.path, `第 ${index + 1} 个源文件路径`, 8_000);
    if (!isAbsolute(sourcePath)) throw fail('SOURCE_PATH_INVALID', '教材导入源必须是绝对路径。');
    const sourceBlobSha = text(part?.sourceBlobSha, `第 ${index + 1} 个 Git blob SHA`, 80).toLowerCase();
    if (!GIT_SHA1.test(sourceBlobSha)) throw fail('SOURCE_HASH_INVALID', '教材源 Git blob SHA 必须是 40 位十六进制。');
    return { sourcePath, sourceBlobSha };
  });
}

function normalizeImportInput(input) {
  const parts = normalizeParts(input);
  const sourceCommit = text(input?.sourceCommit, '来源 commit', 80).toLowerCase();
  if (!GIT_SHA1.test(sourceCommit)) throw fail('SOURCE_COMMIT_INVALID', '来源 commit 必须是 40 位十六进制。');
  return {
    title: text(input?.title, '书名'),
    subject: text(input?.subject, '学科', 120),
    publisher: text(input?.publisher, '出版社', 300),
    volume: text(input?.volume, '册别', 500),
    sourceCommit,
    sourceUrl: text(input?.sourceUrl, '来源 URL', 4_000),
    editionStatus: sanitizeStatus(input?.editionStatus),
    sourceParts: parts,
    ocrExpected: input?.ocrExpected === true,
  };
}

function resultStatus(book) {
  const pending = Number(book.pending_ocr_pages);
  const unreadable = Number(book.unreadable_pages);
  if (pending > 0) return 'pending-ocr';
  if (unreadable > 0) return 'partial-text-extraction';
  if (Number(book.ocr_pages) > 0) return 'ready-with-ocr';
  return 'ready-text-layer';
}

function recognitionLabel(status) {
  if (status === 'text-layer') return '文字层';
  if (status === 'ocr') return '离线 OCR（公式/图表须核对原页）';
  if (status === 'ocr-empty') return 'OCR 未识别到可检索文本';
  if (status === 'pending-ocr') return '待离线 OCR';
  if (status === 'unreadable') return '该页文字层读取失败';
  return '未识别';
}

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
  // Reserve both truncation markers before selecting the source window, so the
  // public snippet cap includes the ellipses as well as the page text.
  const maximumText = Math.max(1, MAX_SNIPPET_CHARS - (matchStart > 0 ? 1 : 0) - (matchEnd < source.length ? 1 : 0));
  let before = Math.max(0, matchStart - Math.floor(maximumText / 2));
  let after = Math.min(source.length, before + maximumText);
  before = Math.max(0, after - maximumText);
  const prefix = before > 0 ? '…' : '';
  const suffix = after < source.length ? '…' : '';
  return `${prefix}${source.slice(before, after).join('')}${suffix}`;
}

async function sourceBytes(parts, signal) {
  const buffers = [];
  for (const part of parts) {
    throwIfAborted(signal);
    let actual;
    try {
      actual = await realpath(part.sourcePath);
    } catch {
      throw fail('SOURCE_NOT_FOUND', '教材源文件不存在或不可读取。');
    }
    const info = await stat(actual);
    if (!info.isFile() || info.size <= 0) throw fail('SOURCE_INVALID', '教材源不是有效文件。');
    const bytes = await readFile(actual);
    if (gitBlobSha1(bytes) !== part.sourceBlobSha) throw fail('SOURCE_HASH_MISMATCH', '教材源字节与声明的 Git blob SHA 不一致。');
    buffers.push(bytes);
  }
  return Buffer.concat(buffers);
}

async function extractPages(pdfjs, bytes, input, signal) {
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') throw fail('PDF_ENGINE_UNAVAILABLE', '未提供可用的 pdfjs-dist 解析器。');
  throwIfAborted(signal);
  let loadingTask;
  try {
    loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, verbosity: 0 });
    const document = await loadingTask.promise;
    const total = number(document?.numPages, 'PDF 页数', { minimum: 1, maximum: 20_000 });
    const pages = [];
    try {
      for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
        throwIfAborted(signal);
        try {
          const page = await document.getPage(pageNumber);
          try {
            const displayText = textFromContent(await page.getTextContent());
            const searchText = normalizeSearchText(displayText);
            pages.push({
              pdfPage: pageNumber,
              displayText,
              searchText,
              textStatus: searchText ? 'text-layer' : (input.ocrExpected ? 'pending-ocr' : 'no-text-layer'),
              ocrConfidence: null,
              requiresOriginalPageCheck: 0,
            });
          } finally {
            page.cleanup?.();
          }
        } catch (error) {
          if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
          pages.push({
            pdfPage: pageNumber,
            displayText: '',
            searchText: '',
            textStatus: input.ocrExpected ? 'pending-ocr' : 'unreadable',
            ocrConfidence: null,
            requiresOriginalPageCheck: 0,
          });
        }
      }
    } finally {
      document.cleanup?.();
    }
    return pages;
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
    if (error instanceof MochiKnowledgeError) throw error;
    throw fail('PDF_IMPORT_FAILED', '教材 PDF 无法解析，未导入到本机教材库。');
  } finally {
    try { await loadingTask?.destroy?.(); } catch { /* 解析失败后的释放不能覆盖原始错误。 */ }
  }
}

export function defaultKnowledgeHome(dshHome = process.env.DSH_HOME) {
  const home = dshHome || join(process.env.HOME || '/tmp', '.mochi-home');
  return join(home, 'knowledge');
}

export async function loadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

export function openKnowledgeStore({ dataRoot = defaultKnowledgeHome() } = {}) {
  if (!isAbsolute(dataRoot)) throw fail('DATA_ROOT_INVALID', '教材数据根必须是绝对路径。');
  const root = resolve(dataRoot);
  const libraryRoot = join(root, 'library');
  mkdirSync(libraryRoot, { recursive: true });
  const db = new DatabaseSync(join(root, 'textbook.sqlite'));
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);

  const getBook = db.prepare('SELECT * FROM textbook_books WHERE id = ?');
  const getBookBySha = db.prepare('SELECT * FROM textbook_books WHERE source_sha256 = ?');
  const getPage = db.prepare('SELECT * FROM textbook_pages WHERE textbook_id = ? AND pdf_page = ?');

  function bookSummary(book) {
    return {
      bookId: book.id,
      title: book.title,
      subject: book.subject,
      publisher: book.publisher,
      volume: book.volume,
      sourceCommit: book.source_commit,
      sourceUrl: book.source_url,
      sourceBlobHashes: JSON.parse(book.source_blob_hashes),
      sourceSha256: book.source_sha256,
      pageCount: Number(book.page_count),
      textLayerPages: Number(book.text_layer_pages),
      ocrPages: Number(book.ocr_pages),
      pendingOcrPages: Number(book.pending_ocr_pages),
      unreadablePages: Number(book.unreadable_pages),
      indexStatus: book.index_status,
      editionStatus: book.edition_status,
      importedAt: book.imported_at,
    };
  }

  function recomputeBookStatus(bookId) {
    const counts = db.prepare(`SELECT
      SUM(CASE WHEN text_status = 'text-layer' THEN 1 ELSE 0 END) AS text_layer_pages,
      SUM(CASE WHEN text_status = 'ocr' THEN 1 ELSE 0 END) AS ocr_pages,
      SUM(CASE WHEN text_status = 'pending-ocr' THEN 1 ELSE 0 END) AS pending_ocr_pages,
      SUM(CASE WHEN text_status IN ('unreadable', 'ocr-empty', 'no-text-layer') THEN 1 ELSE 0 END) AS unreadable_pages
      FROM textbook_pages WHERE textbook_id = ?`).get(bookId);
    const next = {
      textLayerPages: Number(counts?.text_layer_pages || 0),
      ocrPages: Number(counts?.ocr_pages || 0),
      pendingOcrPages: Number(counts?.pending_ocr_pages || 0),
      unreadablePages: Number(counts?.unreadable_pages || 0),
    };
    const status = resultStatus({
      text_layer_pages: next.textLayerPages,
      ocr_pages: next.ocrPages,
      pending_ocr_pages: next.pendingOcrPages,
      unreadable_pages: next.unreadablePages,
    });
    db.prepare(`UPDATE textbook_books SET text_layer_pages = ?, ocr_pages = ?, pending_ocr_pages = ?, unreadable_pages = ?, index_status = ? WHERE id = ?`)
      .run(next.textLayerPages, next.ocrPages, next.pendingOcrPages, next.unreadablePages, status, bookId);
    return status;
  }

  async function importBook(input, { pdfjs, signal } = {}) {
    const normalized = normalizeImportInput(input);
    const bytes = await sourceBytes(normalized.sourceParts, signal);
    const sourceSha256 = sha256(bytes);
    const id = `${BOOK_ID_PREFIX}${sourceSha256}`;
    const existing = getBookBySha.get(sourceSha256);
    if (existing) {
      const existingPath = safeLibraryPath(libraryRoot, existing.library_file);
      try {
        const info = await stat(existingPath);
        if (info.isFile() && info.size > 0) return { status: 'unchanged', book: bookSummary(existing) };
      } catch { /* 缺少受管文件时重建同一索引记录。 */ }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM textbook_books WHERE id = ?').run(existing.id);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* no-op */ }
        throw error;
      }
    }

    const pages = await extractPages(pdfjs, bytes, normalized, signal);
    throwIfAborted(signal);
    const libraryFile = `${id}.pdf`;
    const destination = safeLibraryPath(libraryRoot, libraryFile);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
    let copied = false;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, destination);
      copied = true;
      throwIfAborted(signal);
      const importedAt = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        const textLayerPages = pages.filter((page) => page.textStatus === 'text-layer').length;
        const pendingOcrPages = pages.filter((page) => page.textStatus === 'pending-ocr').length;
        const unreadablePages = pages.filter((page) => ['unreadable', 'no-text-layer'].includes(page.textStatus)).length;
        const indexStatus = resultStatus({ text_layer_pages: textLayerPages, ocr_pages: 0, pending_ocr_pages: pendingOcrPages, unreadable_pages: unreadablePages });
        db.prepare(`INSERT INTO textbook_books
          (id, title, subject, publisher, volume, source_commit, source_url, source_blob_hashes, source_sha256, library_file, page_count, text_layer_pages, ocr_pages, pending_ocr_pages, unreadable_pages, index_status, edition_status, imported_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, normalized.title, normalized.subject, normalized.publisher, normalized.volume, normalized.sourceCommit, normalized.sourceUrl,
            JSON.stringify(normalized.sourceParts.map((part) => part.sourceBlobSha)), sourceSha256, libraryFile, pages.length, textLayerPages, 0, pendingOcrPages, unreadablePages, indexStatus, normalized.editionStatus, importedAt);
        const insertPage = db.prepare(`INSERT INTO textbook_pages
          (textbook_id, pdf_page, printed_page, text_status, ocr_confidence, requires_original_page_check, display_text, search_text)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const page of pages) {
          insertPage.run(id, page.pdfPage, null, page.textStatus, page.ocrConfidence, page.requiresOriginalPageCheck, page.displayText, page.searchText);
        }
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* no-op */ }
        throw error;
      }
      return { status: 'imported', book: bookSummary(getBook.get(id)) };
    } catch (error) {
      try { await rm(temporary, { force: true }); } catch { /* no-op */ }
      if (copied) {
        try { await rm(destination, { force: true }); } catch { /* no-op */ }
      }
      throw error;
    }
  }

  function listBooks() {
    return db.prepare('SELECT * FROM textbook_books ORDER BY subject, title, id').all().map(bookSummary);
  }

  function search(query, { subject, volume, limit = 5 } = {}) {
    const rawQuery = text(query, '查询词', MAX_QUERY_CHARS);
    const normalizedQuery = normalizeSearchText(rawQuery);
    if ([...normalizedQuery].length < 2) throw fail('QUERY_TOO_SHORT', '查询词至少需要两个非空白字符。');
    const resultLimit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, number(limit, '结果数量', { minimum: 1, maximum: MAX_SEARCH_RESULTS })));
    const clauses = ['instr(p.search_text, ?) > 0'];
    const args = [normalizedQuery];
    if (subject !== undefined) { clauses.push('b.subject = ?'); args.push(text(subject, '学科过滤', 120)); }
    if (volume !== undefined) { clauses.push('b.volume = ?'); args.push(text(volume, '册别过滤', 500)); }
    const rows = db.prepare(`SELECT b.*, p.pdf_page, p.printed_page, p.text_status, p.ocr_confidence, p.requires_original_page_check, p.display_text, p.search_text,
        instr(p.search_text, ?) AS match_at,
        (length(p.search_text) - length(replace(p.search_text, ?, ''))) / ? AS occurrence_count
      FROM textbook_pages p JOIN textbook_books b ON b.id = p.textbook_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY occurrence_count DESC, length(p.search_text) DESC, p.pdf_page ASC
      LIMIT ?`).all(normalizedQuery, normalizedQuery, [...normalizedQuery].length, ...args, resultLimit);
    return {
      query: rawQuery,
      normalizedQuery,
      results: rows.map((row) => ({
        ...bookSummary(row),
        pdfPage: Number(row.pdf_page),
        printedPage: row.printed_page === null ? null : Number(row.printed_page),
        printedPageStatus: row.printed_page === null ? 'unverified' : 'recognized',
        recognitionStatus: recognitionLabel(row.text_status),
        requiresOriginalPageCheck: Boolean(row.requires_original_page_check),
        snippet: makeSnippet(row.display_text, normalizedQuery),
      })),
    };
  }

  function getPageForReview(bookId, pdfPage) {
    const id = text(bookId, '教材 ID', 100).toLowerCase();
    if (!SAFE_BOOK_ID.test(id)) throw fail('BOOK_NOT_FOUND', '教材 ID 不存在。');
    const pageNumber = number(pdfPage, 'PDF 页号', { minimum: 1, maximum: 20_000 });
    const book = getBook.get(id);
    const page = getPage.get(id, pageNumber);
    if (!book || !page) throw fail('PAGE_NOT_FOUND', '教材页不存在。');
    const pdfPath = safeLibraryPath(libraryRoot, book.library_file);
    return {
      ...bookSummary(book),
      pdfPage: pageNumber,
      printedPage: page.printed_page === null ? null : Number(page.printed_page),
      printedPageStatus: page.printed_page === null ? 'unverified' : 'recognized',
      recognitionStatus: recognitionLabel(page.text_status),
      requiresOriginalPageCheck: Boolean(page.requires_original_page_check),
      text: page.display_text,
      // 仅供受信任本地主进程/预处理器打开，DSH 工具不会暴露这个绝对路径。
      internalPdfPath: pdfPath,
    };
  }

  function listPendingOcrPages({ limit = 20_000 } = {}) {
    const maximum = number(limit, 'OCR 页数上限', { minimum: 1, maximum: 20_000 });
    return db.prepare(`SELECT b.id, b.title, b.subject, b.volume, b.library_file, p.pdf_page
      FROM textbook_pages p JOIN textbook_books b ON b.id = p.textbook_id
      WHERE p.text_status = 'pending-ocr'
      ORDER BY b.id, p.pdf_page LIMIT ?`).all(maximum).map((row) => ({
      bookId: row.id,
      title: row.title,
      subject: row.subject,
      volume: row.volume,
      pdfPage: Number(row.pdf_page),
      internalPdfPath: safeLibraryPath(libraryRoot, row.library_file),
    }));
  }

  function applyOcrPage(bookId, pdfPage, recognizedText, { confidence } = {}) {
    const id = text(bookId, '教材 ID', 100).toLowerCase();
    if (!SAFE_BOOK_ID.test(id)) throw fail('BOOK_NOT_FOUND', '教材 ID 不存在。');
    const pageNumber = number(pdfPage, 'PDF 页号', { minimum: 1, maximum: 20_000 });
    const existing = getPage.get(id, pageNumber);
    if (!existing) throw fail('PAGE_NOT_FOUND', '教材页不存在。');
    if (!['pending-ocr', 'ocr', 'ocr-empty'].includes(existing.text_status)) {
      throw fail('OCR_NOT_REQUIRED', '该页已有文字层，不允许离线 OCR 覆盖。');
    }
    const displayText = normalizeDisplayText(recognizedText);
    const searchText = normalizeSearchText(displayText);
    const score = confidence === undefined || confidence === null ? null : Math.max(0, Math.min(100, Number(confidence) || 0));
    const status = searchText ? 'ocr' : 'ocr-empty';
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE textbook_pages SET text_status = ?, ocr_confidence = ?, requires_original_page_check = 1, display_text = ?, search_text = ?
        WHERE textbook_id = ? AND pdf_page = ?`).run(status, score, displayText, searchText, id, pageNumber);
      const indexStatus = recomputeBookStatus(id);
      db.exec('COMMIT');
      return { status, indexStatus };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* no-op */ }
      throw error;
    }
  }

  async function removeBook(bookId) {
    const id = text(bookId, '教材 ID', 100).toLowerCase();
    if (!SAFE_BOOK_ID.test(id)) throw fail('BOOK_NOT_FOUND', '教材 ID 不存在。');
    const book = getBook.get(id);
    if (!book) return false;
    const source = safeLibraryPath(libraryRoot, book.library_file);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM textbook_books WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* no-op */ }
      throw error;
    }
    await rm(source, { force: true });
    return true;
  }

  return {
    dataRoot: root,
    libraryRoot,
    db,
    importBook,
    listBooks,
    search,
    getPageForReview,
    listPendingOcrPages,
    applyOcrPage,
    removeBook,
    close() { db.close(); },
  };
}
