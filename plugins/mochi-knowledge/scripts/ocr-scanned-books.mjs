#!/usr/bin/env node
// 对受管库中标为 pending-ocr 的页做一次离线 OCR；不读取任意用户路径，不请求网络/模型。
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { openKnowledgeStore } from '../knowledge-store.mjs';

const require = createRequire(import.meta.url);
const THIS_DIR = new URL('.', import.meta.url);

function usage(message = '') {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write('用法: node ocr-scanned-books.mjs --data-root <绝对受管根> --python <python3> --tesseract-module <绝对tesseract.js模块> --lang-path <语言数据目录> --cache-path <缓存目录> [--renderer <render-pdf-page.py>] [--limit <页数>] [--workers <1..3>] [--scale <0.5..4>] [--report <report.json>]\n');
  process.exitCode = 2;
}

function parseArgs(argv) {
  const values = {};
  const names = new Set(['--data-root', '--python', '--tesseract-module', '--lang-path', '--cache-path', '--renderer', '--limit', '--workers', '--scale', '--report']);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!names.has(name)) throw new Error(`不支持的参数：${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${name} 缺少值。`);
    values[name.slice(2)] = value;
    index += 1;
  }
  for (const required of ['data-root', 'python', 'tesseract-module', 'lang-path', 'cache-path']) {
    if (!values[required]) throw new Error(`必须指定 --${required}。`);
  }
  return values;
}

function absolute(value, label) {
  const result = resolve(value);
  if (!isAbsolute(result)) throw new Error(`${label} 必须是绝对路径。`);
  return result;
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20_000) throw new Error(`${label} 无效。`);
  return parsed;
}

function scaleValue(value) {
  if (value === undefined) return 2;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 4) throw new Error('scale 必须在 0.5 到 4 之间。');
  return parsed;
}

function renderPage(python, renderer, source, page, output, scale, signal) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(python, [renderer, '--source', source, '--page', String(page), '--output', output, '--scale', String(scale)], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolvePromise();
    };
    const abort = () => {
      child.kill('SIGTERM');
      finish(Object.assign(new Error('OCR 已取消。'), { name: 'AbortError', code: 'ABORTED' }));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(new Error('PDF 页渲染器无法启动。')));
    child.once('close', (code) => finish(code === 0 ? undefined : new Error('PDF 页渲染失败。')));
  });
}

function emit(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const dataRoot = absolute(args['data-root'], '教材数据根');
  const python = absolute(args.python, 'Python 路径');
  const tesseractModule = absolute(args['tesseract-module'], 'Tesseract 模块路径');
  const langPath = absolute(args['lang-path'], '语言数据路径');
  const cachePath = absolute(args['cache-path'], 'OCR 缓存路径');
  const renderer = absolute(args.renderer || new URL('render-pdf-page.py', THIS_DIR).pathname, 'PDF 渲染器路径');
  const limit = positiveInteger(args.limit, 20_000, 'limit');
  const workers = positiveInteger(args.workers, 1, 'workers');
  if (workers > 3) throw new Error('workers 不能超过 3，避免教室设备内存竞争。');
  const scale = scaleValue(args.scale);
  const { createWorker } = require(tesseractModule);
  if (typeof createWorker !== 'function') throw new Error('指定的 Tesseract 模块不导出 createWorker。');
  const controller = new AbortController();
  let interruptCount = 0;
  process.once('SIGINT', () => {
    interruptCount += 1;
    controller.abort();
    if (interruptCount > 1) process.exit(130);
  });
  const store = openKnowledgeStore({ dataRoot });
  const pages = store.listPendingOcrPages({ limit });
  const report = {
    status: 'ocr-complete',
    totalPendingAtStart: pages.length,
    processed: 0,
    recognized: 0,
    empty: 0,
    failed: 0,
    cancelled: false,
    failures: [],
  };
  const tempRoot = await mkdtemp(join(tmpdir(), 'mochi-textbook-ocr-'));
  const workersPool = [];
  try {
    for (let index = 0; index < workers; index += 1) workersPool.push(await createWorker('chi_sim', 1, { langPath, cachePath }));
    let nextPage = 0;
    let completed = 0;
    const runWorker = async (worker) => {
      while (nextPage < pages.length) {
        if (controller.signal.aborted) throw Object.assign(new Error('OCR 已取消。'), { name: 'AbortError', code: 'ABORTED' });
        const page = pages[nextPage];
        nextPage += 1;
        const png = join(tempRoot, `${page.bookId}-${page.pdfPage}.png`);
        try {
          await renderPage(python, renderer, page.internalPdfPath, page.pdfPage, png, scale, controller.signal);
          const recognized = await worker.recognize(png);
          if (controller.signal.aborted) throw Object.assign(new Error('OCR 已取消。'), { name: 'AbortError', code: 'ABORTED' });
          const outcome = store.applyOcrPage(page.bookId, page.pdfPage, String(recognized?.data?.text || ''), { confidence: recognized?.data?.confidence });
          report.processed += 1;
          if (outcome.status === 'ocr') report.recognized += 1; else report.empty += 1;
        } catch (error) {
          if (error?.name === 'AbortError' || error?.code === 'ABORTED') throw error;
          report.failed += 1;
          report.failures.push({ bookId: page.bookId, pdfPage: page.pdfPage, code: 'OCR_PAGE_FAILED' });
        } finally {
          await rm(png, { force: true });
        }
        completed += 1;
        if (completed % 10 === 0 || completed === pages.length) {
          emit({ event: 'ocr-progress', completed, total: pages.length, recognized: report.recognized, empty: report.empty, failed: report.failed });
        }
      }
    };
    await Promise.all(workersPool.map(runWorker));
    if (report.failed > 0) report.status = 'ocr-partial';
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'ABORTED') {
      report.status = 'ocr-cancelled';
      report.cancelled = true;
    } else {
      throw error;
    }
  } finally {
    await Promise.allSettled(workersPool.map((worker) => worker?.terminate?.()));
    await rm(tempRoot, { recursive: true, force: true });
    store.close();
  }
  if (args.report) await writeFile(resolve(args.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  emit({ event: report.status, processed: report.processed, recognized: report.recognized, empty: report.empty, failed: report.failed, cancelled: report.cancelled });
  if (report.cancelled) process.exitCode = 130;
  else if (report.failed > 0) process.exitCode = 1;
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}
