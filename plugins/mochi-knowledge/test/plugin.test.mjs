import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openKnowledgeStore } from '../knowledge-store.mjs';

function blobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function fakePdfJs() {
  return { getDocument: ({ data }) => {
    const payload = JSON.parse(Buffer.from(data).toString('utf8'));
    return {
      destroy: async () => {},
      promise: Promise.resolve({
        numPages: payload.pages.length,
        cleanup() {},
        async getPage(number) {
          return { cleanup() {}, async getTextContent() { return { items: [{ str: payload.pages[number - 1], hasEOL: false }] }; } };
        },
      }),
    };
  } };
}

test('只读工具注册后不泄露受管绝对路径，且只能按教材ID和页号读取', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mochi-knowledge-plugin-'));
  const sourceRoot = new URL('..', import.meta.url);
  try {
    await copyFile(new URL('../index.mjs', import.meta.url), join(root, 'index.mjs'));
    await copyFile(new URL('../knowledge-store.mjs', import.meta.url), join(root, 'knowledge-store.mjs'));
    await copyFile(new URL('../knowledge-host-bridge.mjs', import.meta.url), join(root, 'knowledge-host-bridge.mjs'));
    await copyFile(new URL('../knowledge-page-image.mjs', import.meta.url), join(root, 'knowledge-page-image.mjs'));
    const toolsRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools');
    await mkdir(toolsRoot, { recursive: true });
    await writeFile(join(toolsRoot, 'package.json'), '{"type":"module","exports":"./index.js"}\n');
    await writeFile(join(toolsRoot, 'index.js'), 'export const defineTool = (value) => value;\n');
    const plugin = await import(`${pathToFileURL(join(root, 'index.mjs')).href}?run=${Date.now()}`);
    const inputBytes = Buffer.from(JSON.stringify({ pages: ['牛顿第二定律说明合力与加速度的关系'] }));
    const source = join(root, 'physics.pdf');
    await writeFile(source, inputBytes);
    const store = openKnowledgeStore({ dataRoot: join(root, 'dsh', 'knowledge') });
    try {
      const imported = await store.importBook({
        title: '物理必修 第一册', subject: '物理', publisher: '教科版', volume: '物理必修 第一册',
        sourceCommit: 'b'.repeat(40), sourceUrl: 'https://example.invalid/physics',
        sourceParts: [{ path: source, sourceBlobSha: blobSha(inputBytes) }], editionStatus: 'source-metadata-unverified',
      }, { pdfjs: fakePdfJs() });
      const registered = new Map();
      const routes = [];
      const ctx = {
        tools: { register: (tool) => registered.set(tool.name, tool) },
        connection: { fetch: { register: (route) => { routes.push(route); return () => {}; } } },
        inject(deps, callback) {
          if (deps.includes('connection')) return callback(ctx);
          return undefined;
        },
      };
      plugin.apply(ctx, store);
      assert.deepEqual([...registered.keys()].sort(), ['mochi_knowledge_page', 'mochi_knowledge_search']);
      assert.equal(routes.length, 1);
      assert.equal(routes[0].path, '/api/mochi-knowledge/page');
      const hit = await registered.get('mochi_knowledge_search').execute({ query: '牛顿第二定律' });
      assert.equal(hit.状态, '已命中本地教材页');
      const serializedHit = JSON.stringify(hit);
      assert.equal(serializedHit.includes(join(root, 'dsh')), false);
      const page = await registered.get('mochi_knowledge_page').execute({ bookId: imported.book.bookId, pdfPage: 1 });
      const serializedPage = JSON.stringify(page);
      assert.equal(serializedPage.includes(join(root, 'dsh')), false);
      assert.match(page.可检索文本, /牛顿第二定律/u);
      assert.equal(page.原页核对.类型, '受管PDF原页');
      assert.match(page.原页核对.URL, /\/api\/mochi-knowledge\/page\?bookId=tb-/u);
      const served = await routes[0].fetch(new Request(`http://127.0.0.1${page.原页核对.URL}`));
      assert.equal(served.status, 200);
      assert.equal(served.headers.get('content-type'), 'application/pdf');
      assert.equal(Buffer.from(await served.arrayBuffer()).equals(inputBytes), true);
      const traversal = await routes[0].fetch(new Request('http://127.0.0.1/api/mochi-knowledge/page?bookId=../../etc/passwd&pdfPage=1'));
      assert.equal(traversal.status, 404);
      const extraParameter = await routes[0].fetch(new Request(`http://127.0.0.1/api/mochi-knowledge/page?bookId=${encodeURIComponent(imported.book.bookId)}&pdfPage=1&path=/etc/passwd`));
      assert.equal(extraParameter.status, 400);
      await assert.rejects(() => registered.get('mochi_knowledge_page').execute({ bookId: '../../etc/passwd', pdfPage: 1 }), /教材 ID 不存在/u);
    } finally {
      store.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
