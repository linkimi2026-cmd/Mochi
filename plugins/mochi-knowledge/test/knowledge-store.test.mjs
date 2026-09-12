import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_SNIPPET_CHARS, MochiKnowledgeError, openKnowledgeStore } from '../knowledge-store.mjs';

const COMMIT = 'a'.repeat(40);

function blobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function fakePdfJs() {
  return {
    getDocument({ data }) {
      const loadingTask = { destroyCalls: 0 };
      loadingTask.destroy = async () => { loadingTask.destroyCalls += 1; };
      loadingTask.promise = (async () => {
        let documentPayload;
        try {
          documentPayload = JSON.parse(Buffer.from(data).toString('utf8'));
        } catch {
          throw new Error('invalid fake pdf');
        }
        if (!Array.isArray(documentPayload.pages) || documentPayload.pages.length === 0) throw new Error('invalid fake pages');
        return {
          numPages: documentPayload.pages.length,
          cleanupCalls: 0,
          cleanup() { this.cleanupCalls += 1; },
          async getPage(pageNumber) {
            const source = documentPayload.pages[pageNumber - 1];
            if (source && typeof source === 'object' && source.throw) throw new Error('fake page failure');
            const value = typeof source === 'string' ? source : '';
            return {
              cleanupCalls: 0,
              async getTextContent() {
                return { items: value.split('|').map((str, index) => ({ str, hasEOL: index < value.split('|').length - 1 })) };
              },
              cleanup() { this.cleanupCalls += 1; },
            };
          },
        };
      })();
      return loadingTask;
    },
  };
}

async function sourceFile(root, name, pages) {
  const bytes = Buffer.from(JSON.stringify({ pages }), 'utf8');
  const path = join(root, name);
  await writeFile(path, bytes);
  return { path, bytes, sha: blobSha(bytes) };
}

function input(source, overrides = {}) {
  return {
    title: '普通高中教科书·化学必修 第一册',
    subject: '化学',
    publisher: '人教版-人民教育出版社',
    volume: '化学必修 第一册',
    sourceCommit: COMMIT,
    sourceUrl: `https://example.invalid/${source.sha}`,
    sourceParts: [{ path: source.path, sourceBlobSha: source.sha }],
    editionStatus: 'source-metadata-unverified',
    ...overrides,
  };
}

async function withRoot(prefix, run) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('逐页导入、中文子串检索、同字节幂等、同名不同字节和安全页映射', async () => {
  await withRoot('mochi-knowledge-store-', async (root) => {
    const first = await sourceFile(root, 'chemistry.pdf', ['绪论|化学平衡是可逆反应达到的动态状态', '此页不相关']);
    const second = await sourceFile(root, 'chemistry-v2.pdf', ['新版|化学平衡移动与浓度有关']);
    const store = openKnowledgeStore({ dataRoot: join(root, 'dsh', 'knowledge') });
    try {
      const imported = await store.importBook(input(first), { pdfjs: fakePdfJs() });
      assert.equal(imported.status, 'imported');
      assert.equal(imported.book.pageCount, 2);
      assert.equal(imported.book.textLayerPages, 2);
      const found = store.search('化学 平衡', { subject: '化学', limit: 3 });
      assert.equal(found.results.length, 1);
      assert.equal(found.results[0].title, '普通高中教科书·化学必修 第一册');
      assert.equal(found.results[0].pdfPage, 1);
      assert.equal(found.results[0].printedPage, null);
      assert.equal(found.results[0].recognitionStatus, '文字层');
      assert.match(found.results[0].snippet, /化学平衡/u);
      assert.equal(Object.hasOwn(found.results[0], 'internalPdfPath'), false);
      assert.equal(store.search('完全无关', { subject: '化学' }).results.length, 0);
      assert.throws(() => store.search('单'), (error) => error instanceof MochiKnowledgeError && error.code === 'QUERY_TOO_SHORT');

      const unchanged = await store.importBook(input(first), { pdfjs: fakePdfJs() });
      assert.equal(unchanged.status, 'unchanged');
      assert.equal(store.listBooks().length, 1);

      const different = await store.importBook(input(second, { title: '普通高中教科书·化学必修 第一册', volume: '化学必修 第一册（修订）' }), { pdfjs: fakePdfJs() });
      assert.equal(different.status, 'imported');
      assert.notEqual(different.book.bookId, imported.book.bookId);
      assert.equal(store.listBooks().length, 2);

      const review = store.getPageForReview(imported.book.bookId, 1);
      assert.ok(review.internalPdfPath.startsWith(join(root, 'dsh', 'knowledge', 'library')));
      assert.throws(() => store.getPageForReview('../../etc/passwd', 1), (error) => error instanceof MochiKnowledgeError && error.code === 'BOOK_NOT_FOUND');
      assert.throws(() => store.getPageForReview(imported.book.bookId, 99), (error) => error instanceof MochiKnowledgeError && error.code === 'PAGE_NOT_FOUND');
      assert.throws(() => store.applyOcrPage(imported.book.bookId, 1, '不该覆盖文字层'), (error) => error instanceof MochiKnowledgeError && error.code === 'OCR_NOT_REQUIRED');
    } finally {
      store.close();
    }
  });
});

test('扫描页只在受管 pending 状态写入 OCR，且删除后重开不会继续命中', async () => {
  await withRoot('mochi-knowledge-ocr-', async (root) => {
    const source = await sourceFile(root, 'scan.pdf', ['', '封面文字']);
    const dataRoot = join(root, 'dsh', 'knowledge');
    const store = openKnowledgeStore({ dataRoot });
    let bookId;
    try {
      const imported = await store.importBook(input(source, { subject: '数学', title: '数学扫描册', volume: '数学扫描册', ocrExpected: true }), { pdfjs: fakePdfJs() });
      bookId = imported.book.bookId;
      assert.equal(imported.book.pendingOcrPages, 1);
      assert.equal(store.listPendingOcrPages().length, 1);
      const result = store.applyOcrPage(bookId, 1, '函数的定义域', { confidence: 85 });
      assert.equal(result.status, 'ocr');
      const found = store.search('定义域', { subject: '数学' });
      assert.equal(found.results.length, 1);
      assert.equal(found.results[0].recognitionStatus, '离线 OCR（公式/图表须核对原页）');
      assert.equal(found.results[0].requiresOriginalPageCheck, true);
      await store.removeBook(bookId);
      assert.equal(store.search('定义域', { subject: '数学' }).results.length, 0);
    } finally {
      store.close();
    }
    const reopened = openKnowledgeStore({ dataRoot });
    try {
      assert.equal(reopened.listBooks().length, 0);
      assert.equal(reopened.search('定义域').results.length, 0);
    } finally {
      reopened.close();
    }
  });
});

test('检索片段包含截断标记时仍严格受公开长度上限约束', async () => {
  await withRoot('mochi-knowledge-snippet-', async (root) => {
    const source = await sourceFile(root, 'long.pdf', [`${'甲'.repeat(400)}化学平衡${'乙'.repeat(400)}`]);
    const store = openKnowledgeStore({ dataRoot: join(root, 'dsh', 'knowledge') });
    try {
      await store.importBook(input(source), { pdfjs: fakePdfJs() });
      const [hit] = store.search('化学平衡').results;
      assert.ok(hit.snippet.startsWith('…'));
      assert.ok(hit.snippet.endsWith('…'));
      assert.ok([...hit.snippet].length <= MAX_SNIPPET_CHARS);
    } finally {
      store.close();
    }
  });
});

test('损坏解析和取消均不会留下半本教材', async () => {
  await withRoot('mochi-knowledge-failure-', async (root) => {
    const source = await sourceFile(root, 'corrupt.pdf', ['本应不会导入']);
    const dataRoot = join(root, 'dsh', 'knowledge');
    const store = openKnowledgeStore({ dataRoot });
    try {
      await assert.rejects(
        () => store.importBook(input(source), { pdfjs: { getDocument: () => ({ promise: Promise.reject(new Error('bad PDF')), destroy: async () => {} }) } }),
        (error) => error instanceof MochiKnowledgeError && error.code === 'PDF_IMPORT_FAILED',
      );
      assert.equal(store.listBooks().length, 0);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        () => store.importBook(input(source), { pdfjs: fakePdfJs(), signal: controller.signal }),
        (error) => error?.name === 'AbortError' && error?.code === 'ABORTED',
      );
      assert.equal(store.listBooks().length, 0);
    } finally {
      store.close();
    }
  });
});
