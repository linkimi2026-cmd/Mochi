// Isolated fixed-alpha verification: actual defineTool + LocalAttachmentStore + one trusted imported PDF page.
// Usage: node verify-alpha-page-image.mjs --consumer <alpha consumer> --pdfjs-root <isolated pdfjs node_modules root> --data-root <managed knowledge root>
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing ${name}`);
  return value;
}

const consumer = argument('--consumer');
const pdfjsRoot = argument('--pdfjs-root');
const dataRoot = argument('--data-root');
const fixture = await mkdtemp(join(tmpdir(), 'mochi-knowledge-alpha-page-image-'));
let store;
try {
  await Promise.all([
    copyFile(new URL('../index.mjs', import.meta.url), join(fixture, 'index.mjs')),
    copyFile(new URL('../knowledge-store.mjs', import.meta.url), join(fixture, 'knowledge-store.mjs')),
    copyFile(new URL('../knowledge-host-bridge.mjs', import.meta.url), join(fixture, 'knowledge-host-bridge.mjs')),
    copyFile(new URL('../knowledge-page-image.mjs', import.meta.url), join(fixture, 'knowledge-page-image.mjs')),
  ]);
  const nodeModules = join(fixture, 'node_modules');
  await mkdir(nodeModules);
  await symlink(join(consumer, 'node_modules', '@deepseek-ai'), join(nodeModules, '@deepseek-ai'), 'dir');
  await symlink(join(pdfjsRoot, 'node_modules', 'pdfjs-dist'), join(nodeModules, 'pdfjs-dist'), 'dir');
  await symlink(join(pdfjsRoot, 'node_modules', '@napi-rs'), join(nodeModules, '@napi-rs'), 'dir');

  const alphaPackage = (name) => pathToFileURL(join(consumer, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href;
  const [{ openKnowledgeStore }, { Context }, { LocalAttachmentStore }, { validateJsonSchemaValue }] = await Promise.all([
    import(`${pathToFileURL(join(fixture, 'knowledge-store.mjs')).href}?alpha=${Date.now()}`),
    import(alphaPackage('cordis')),
    import(alphaPackage('dsh-attachment-local')),
    import(alphaPackage('dsh-tools')),
  ]);
  const plugin = await import(`${pathToFileURL(join(fixture, 'index.mjs')).href}?alpha=${Date.now()}`);
  const attachmentHome = join(fixture, 'attachment-home');
  const attachments = new LocalAttachmentStore(new Context(), { dshHome: attachmentHome });
  store = openKnowledgeStore({ dataRoot });
  const book = store.listBooks().find((candidate) => candidate.subject === '物理' && candidate.ocrPages > 0);
  assert.ok(book, 'fixture must contain one imported scanned physics textbook');
  const page = store.getPageForReview(book.bookId, 20);
  const registered = new Map();
  const ctx = {
    tools: { register: (tool) => registered.set(tool.name, tool) },
    connection: { fetch: { register: () => () => {} } },
    inject: (deps, callback) => { if (deps.includes('attachments')) callback(ctx); },
    get: (name) => {
      if (name === 'attachments') return attachments;
      if (name === 'llm') return { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) };
      return undefined;
    },
  };
  plugin.apply(ctx, store);
  const tool = registered.get('mochi_knowledge_page_image');
  assert.ok(tool, 'attachment-mounted plugin must register the visual page tool');
  const exec = {
    signal: new AbortController().signal,
    agent: {
      session: { requestHeader: () => ({ config: { provider: 'fixture', model: 'declared-vision' } }) },
      options: { provider: 'fixture', model: 'declared-vision' },
    },
  };
  const value = await tool.execute({ bookId: page.bookId, pdfPage: page.pdfPage }, exec);
  assert.deepEqual(validateJsonSchemaValue(tool.output.schema, value, 'value'), []);
  assert.equal(value.状态, '已生成受管教材页图像');
  assert.equal(Object.hasOwn(value, 'internalPdfPath'), false);
  assert.equal(JSON.stringify(value).includes(dataRoot), false);
  const content = tool.output.render({ bookId: page.bookId, pdfPage: page.pdfPage }, value);
  assert.equal(content.length, 2);
  assert.equal(content[0].text.includes(value.原页核对.URL), true);
  assert.equal(content[0].text.includes(value.来源.URL), true);
  assert.equal(content[1].type, 'image');
  assert.deepEqual(content[1].attachment, value.图像);
  const stored = await attachments.readImage(value.图像);
  assert.equal(stored.data[0], 137);
  assert.equal(stored.data[1], 80);
  assert.equal(stored.data[2], 78);
  assert.equal(stored.data[3], 71);
  console.log(JSON.stringify({ status: 'PASS', tool: tool.name, contentBlocks: content.length, mediaType: value.图像.mediaType, width: value.图像.width, height: value.图像.height }));
} finally {
  try { store?.close(); } catch { /* no-op */ }
  await rm(fixture, { recursive: true, force: true });
}
