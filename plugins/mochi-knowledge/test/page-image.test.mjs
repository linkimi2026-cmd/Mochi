import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function writeModule(root, packageName, files) {
  const packageRoot = join(root, 'node_modules', ...packageName.split('/'));
  await mkdir(packageRoot, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const destination = join(packageRoot, relative);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, content, 'utf8');
  }
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'mochi-knowledge-page-image-'));
  await Promise.all([
    copyFile(new URL('../index.mjs', import.meta.url), join(root, 'index.mjs')),
    copyFile(new URL('../knowledge-store.mjs', import.meta.url), join(root, 'knowledge-store.mjs')),
    copyFile(new URL('../knowledge-host-bridge.mjs', import.meta.url), join(root, 'knowledge-host-bridge.mjs')),
    copyFile(new URL('../knowledge-page-image.mjs', import.meta.url), join(root, 'knowledge-page-image.mjs')),
  ]);
  await writeModule(root, '@deepseek-ai/dsh-tools', {
    'package.json': '{"type":"module","exports":"./index.js"}\n',
    'index.js': 'export const defineTool = (value) => value;\n',
  });
  await writeModule(root, 'pdfjs-dist', {
    'package.json': '{"type":"module","exports":{"./legacy/build/pdf.mjs":"./legacy/build/pdf.mjs"}}\n',
    'legacy/build/pdf.mjs': `
      export function getDocument() {
        return {
          destroy: async () => {},
          promise: Promise.resolve({
            cleanup() {},
            async getPage() {
              return {
                cleanup() {},
                getViewport({ scale }) { return { width: 612 * scale, height: 792 * scale }; },
                render() {
                  globalThis.__mochiKnowledgeRenders = (globalThis.__mochiKnowledgeRenders || 0) + 1;
                  globalThis.__mochiKnowledgeActive = (globalThis.__mochiKnowledgeActive || 0) + 1;
                  globalThis.__mochiKnowledgeMaxActive = Math.max(globalThis.__mochiKnowledgeMaxActive || 0, globalThis.__mochiKnowledgeActive);
                  return { promise: new Promise((resolve) => setTimeout(() => {
                    globalThis.__mochiKnowledgeActive -= 1;
                    resolve();
                  }, 5)), cancel() { globalThis.__mochiKnowledgeActive = Math.max(0, (globalThis.__mochiKnowledgeActive || 0) - 1); } };
                },
              };
            },
          }),
        };
      }
    `,
  });
  await writeModule(root, '@napi-rs/canvas', {
    'package.json': '{"type":"module","exports":"./index.js"}\n',
    'index.js': `
      export function createCanvas(width, height) {
        return {
          getContext() { return {}; },
          toBuffer() { return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, width % 256, height % 256]); },
          dispose() {},
        };
      }
    `,
  });
  const source = join(root, 'trusted.pdf');
  await writeFile(source, Buffer.from('%PDF-fixture', 'utf8'));
  const plugin = await import(`${pathToFileURL(join(root, 'index.mjs')).href}?fixture=${Date.now()}`);
  return { root, source, plugin };
}

function page(source) {
  return {
    bookId: `tb-${'a'.repeat(64)}`,
    title: '物理选择性必修 第二册',
    subject: '物理',
    volume: '物理选择性必修 第二册',
    sourceSha256: 'a'.repeat(64),
    sourceCommit: 'b'.repeat(40),
    sourceUrl: 'https://example.invalid/physics',
    sourceBlobHashes: ['c'.repeat(40)],
    editionStatus: 'source-metadata-unverified',
    pdfPage: 5,
    printedPage: null,
    printedPageStatus: 'unverified',
    recognitionStatus: '离线 OCR（公式/图表须核对原页）',
    requiresOriginalPageCheck: true,
    internalPdfPath: source,
  };
}

function mount(plugin, source, role, model = 'vision-fixture') {
  const registered = new Map();
  const saved = [];
  const trustedPage = page(source);
  const attachments = {
    imageLimits: {
      maxImageBytes: 1024 * 1024,
      maxMessageImageBytes: 1024 * 1024,
      maxImagePixels: 2_000_000,
      maxImageDimension: 1600,
      mediaTypes: ['image/png'],
    },
    async saveImage(input) {
      assert.deepEqual([...input.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      saved.push(input);
      return { attachmentId: `fixture-${saved.length}`, mediaType: 'image/png', bytes: input.data.byteLength, width: 765, height: 990, name: input.name };
    },
  };
  const ctx = {
    role,
    tools: { register: (tool) => registered.set(tool.name, tool) },
    connection: { fetch: { register: () => () => {} } },
    inject(deps, callback) {
      if (deps.includes('attachments')) callback(ctx);
    },
    get(name) {
      if (name === 'attachments') return attachments;
      if (name === 'llm') return {
        resolveModelInfo: async () => ({ inputModalities: model === 'vision-fixture' ? ['text', 'image'] : ['text'] }),
      };
      return undefined;
    },
  };
  const store = {
    getPageForReview(bookId, pdfPage) {
      if (bookId !== trustedPage.bookId || pdfPage !== trustedPage.pdfPage) throw new Error('not found');
      return trustedPage;
    },
    listBooks: () => [trustedPage],
    search: () => ({ query: '', results: [] }),
  };
  plugin.apply(ctx, store);
  return { registered, saved, trustedPage };
}

function execution(model = 'vision-fixture') {
  return {
    signal: new AbortController().signal,
    agent: {
      session: { requestHeader: () => ({ config: { provider: 'fixture', model } }) },
      options: { provider: 'fixture', model },
    },
  };
}

test('教师和教室上下文均只暴露受管教材页图像工具，视觉路由只得到附件引用', async () => {
  const fixture = await createFixture();
  try {
    globalThis.__mochiKnowledgeRenders = 0;
    globalThis.__mochiKnowledgeActive = 0;
    globalThis.__mochiKnowledgeMaxActive = 0;
    for (const role of ['teacher', 'classroom']) {
      const mounted = mount(fixture.plugin, fixture.source, role);
      assert.deepEqual([...mounted.registered.keys()].sort(), ['mochi_knowledge_page', 'mochi_knowledge_page_image', 'mochi_knowledge_search']);
      const tool = mounted.registered.get('mochi_knowledge_page_image');
      const [first, second] = await Promise.all([
        tool.execute({ bookId: mounted.trustedPage.bookId, pdfPage: 5 }, execution()),
        tool.execute({ bookId: mounted.trustedPage.bookId, pdfPage: 5 }, execution()),
      ]);
      assert.equal(first.状态, '已生成受管教材页图像');
      assert.equal(second.状态, '已生成受管教材页图像');
      assert.equal(mounted.saved.length, 2);
      assert.equal(JSON.stringify(first).includes(fixture.source), false);
      const content = tool.output.render({ bookId: mounted.trustedPage.bookId, pdfPage: 5 }, first);
      assert.equal(content.length, 2);
      assert.equal(content[0].text.includes(mounted.trustedPage.sourceUrl), true);
      assert.equal(content[0].text.includes(first.原页核对.URL), true);
      assert.equal(content[1].type, 'image');
      assert.deepEqual(content[1].attachment, first.图像);
    }
    assert.equal(globalThis.__mochiKnowledgeRenders, 1);
    assert.equal(globalThis.__mochiKnowledgeMaxActive, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('文本路由不读取或保存图像，只给同源受管原页入口', async () => {
  const fixture = await createFixture();
  try {
    const mounted = mount(fixture.plugin, fixture.source, 'teacher', 'text-only-fixture');
    const tool = mounted.registered.get('mochi_knowledge_page_image');
    const value = await tool.execute({ bookId: mounted.trustedPage.bookId, pdfPage: 5 }, execution('text-only-fixture'));
    assert.equal(value.状态, '当前模型未声明图像输入能力');
    assert.equal(Object.hasOwn(value, '图像'), false);
    assert.equal(mounted.saved.length, 0);
    assert.match(value.原页核对.URL, /^\/api\/mochi-knowledge\/page\?bookId=tb-/u);
    const content = tool.output.render({}, value);
    assert.equal(content.length, 1);
    assert.equal(content[0].text.includes(value.原页核对.URL), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('无效教材映射或取消不会渲染或保存图像', async () => {
  const fixture = await createFixture();
  try {
    const mounted = mount(fixture.plugin, fixture.source, 'classroom');
    const tool = mounted.registered.get('mochi_knowledge_page_image');
    await assert.rejects(
      () => tool.execute({ bookId: '../../etc/passwd', pdfPage: 5 }, execution()),
      /not found/u,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => tool.execute({ bookId: mounted.trustedPage.bookId, pdfPage: 5 }, { ...execution(), signal: controller.signal }),
      (error) => error?.name === 'AbortError' && error?.code === 'ABORTED',
    );
    assert.equal(mounted.saved.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
