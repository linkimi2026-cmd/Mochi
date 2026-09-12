#!/usr/bin/env node
// 只从明确目录导入到受管教材库。不会扫描任意目录，也不会输出教材正文或源绝对路径。
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPdfJs, MochiKnowledgeError, openKnowledgeStore } from '../knowledge-store.mjs';

function usage(message = '') {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write('用法: node import-textbooks.mjs --catalog <catalog.json> --data-root <绝对受管根> [--pdfjs-module <绝对pdf.mjs>] [--report <report.json>]\n');
  process.exitCode = 2;
}

function parseArgs(argv) {
  const values = {};
  const names = new Set(['--catalog', '--data-root', '--pdfjs-module', '--report']);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!names.has(name)) throw new Error(`不支持的参数：${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${name} 缺少值。`);
    values[name.slice(2)] = value;
    index += 1;
  }
  if (!values.catalog || !values['data-root']) throw new Error('必须指定 --catalog 和 --data-root。');
  return values;
}

async function loadEngine(modulePath) {
  if (!modulePath) return loadPdfJs();
  const absolute = resolve(modulePath);
  if (!isAbsolute(absolute)) throw new Error('pdfjs 模块路径必须是绝对路径。');
  const module = await import(pathToFileURL(absolute).href);
  if (typeof module.getDocument !== 'function') throw new Error('指定的 pdfjs 模块不导出 getDocument。');
  return module;
}

function publicBookResult(result) {
  const book = result.book;
  return {
    status: result.status,
    bookId: book.bookId,
    title: book.title,
    subject: book.subject,
    pageCount: book.pageCount,
    indexStatus: book.indexStatus,
    textLayerPages: book.textLayerPages,
    pendingOcrPages: book.pendingOcrPages,
    unreadablePages: book.unreadablePages,
    sourceSha256: book.sourceSha256,
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const catalogPath = resolve(args.catalog);
  const dataRoot = resolve(args['data-root']);
  if (!isAbsolute(dataRoot)) throw new Error('教材数据根必须是绝对路径。');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.books) || catalog.books.length === 0) throw new Error('目录不是 schemaVersion=1 的非空教材目录。');
  const controller = new AbortController();
  let interruptCount = 0;
  process.once('SIGINT', () => {
    interruptCount += 1;
    controller.abort();
    if (interruptCount > 1) process.exit(130);
  });
  const pdfjs = await loadEngine(args['pdfjs-module']);
  const store = openKnowledgeStore({ dataRoot });
  const results = [];
  try {
    for (let index = 0; index < catalog.books.length; index += 1) {
      const result = await store.importBook(catalog.books[index], { pdfjs, signal: controller.signal });
      const summary = publicBookResult(result);
      const expectedPages = Number(catalog.books[index].expectedPageCount);
      if (!Number.isSafeInteger(expectedPages) || expectedPages < 1 || summary.pageCount !== expectedPages) {
        throw new Error(`导入页数与目录不一致：第 ${index + 1} 册。`);
      }
      results.push(summary);
      process.stdout.write(`${JSON.stringify({ event: 'book-imported', index: index + 1, total: catalog.books.length, status: summary.status, bookId: summary.bookId, pageCount: summary.pageCount })}\n`);
    }
    const report = {
      status: 'import-complete',
      sourceRepository: catalog.sourceRepository,
      sourceCommit: catalog.sourceCommit,
      books: results,
      totalBooks: results.length,
      totalPages: results.reduce((sum, row) => sum + row.pageCount, 0),
      pendingOcrPages: results.reduce((sum, row) => sum + row.pendingOcrPages, 0),
    };
    if (args.report) await writeFile(resolve(args.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ event: 'import-complete', totalBooks: report.totalBooks, totalPages: report.totalPages, pendingOcrPages: report.pendingOcrPages })}\n`);
  } finally {
    store.close();
  }
} catch (error) {
  if (error?.name === 'AbortError' || error?.code === 'ABORTED') {
    process.stderr.write('教材导入已取消；已完成教材保持可用，当前未完成教材未写入。\n');
    process.exitCode = 130;
  } else if (error instanceof MochiKnowledgeError) {
    process.stderr.write(`教材导入失败：${error.code}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(`教材导入失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
