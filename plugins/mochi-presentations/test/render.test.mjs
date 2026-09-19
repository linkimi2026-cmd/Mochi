import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { demonstrationLessonPlan } from '../fixtures/lesson-plan.mjs';
import { generatePresentationBundle } from '../index.mjs';
import { registerPresentationRenderTool, resolveSoffice } from '../render.mjs';

const execution = { agent: { options: { provider: 'fixture', model: 'vision' } } };

function toolWith(attachments, info = { inputModalities: ['text', 'image'] }) {
  let tool;
  registerPresentationRenderTool({
    tools: { register(value) { tool = value; } },
    get(name) { return name === 'attachments' ? attachments : name === 'llm' ? { resolveModelInfo: async () => info } : undefined; },
  });
  return tool;
}

async function bundleFor(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-visual-qa-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return generatePresentationBundle({ presentation: demonstrationLessonPlan(), outputDirectory: join(root, 'deck') });
}

test('visual QA fails explicitly when the attachment service cannot accept images', async (t) => {
  const bundle = await bundleFor(t);
  await assert.rejects(toolWith(undefined).execute({ filePath: bundle.pptxPath }, {}), /不接受 PNG 图像/);
});

test('real PPTX overview and page renders are emitted as PNG image blocks', {
  skip: !resolveSoffice() && 'LibreOffice unavailable; real rendering not verified',
  timeout: 60_000,
}, async (t) => {
  const bundle = await bundleFor(t);
  const saved = new Map();
  let mutateSource = false;
  const tool = toolWith({
    imageLimits: { mediaTypes: ['image/png'] },
    async saveImage({ data, mediaType, name }) {
      assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      const attachmentId = `test-${saved.size}`;
      saved.set(attachmentId, data);
      if (mutateSource) await writeFile(bundle.pptxPath, Buffer.from('changed during render'));
      return { attachmentId, mediaType, bytes: data.length, name, width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    },
  });
  for (const args of [{ mode: 'overview' }, { mode: 'page', page: 2 }]) {
    const result = await tool.execute({ filePath: bundle.pptxPath, ...args }, execution);
    assert.equal(result.总页数, 3);
    assert.equal(result.视觉检查, '待模型查看');
    assert.equal(result.文件SHA256, createHash('sha256').update(await readFile(bundle.pptxPath)).digest('hex'));
    assert.deepEqual(result.覆盖页, args.mode === 'page' ? [2] : [1, 2, 3]);
    assert.deepEqual(result.未覆盖页, args.mode === 'page' ? [1, 3] : []);
    assert.match(tool.output.render({}, result)[0].text, /不等于模型已经看图/);
    const images = tool.output.render({}, result).filter((block) => block.type === 'image');
    assert.equal(images.length, 1);
    assert.ok(saved.has(images[0].attachment.attachmentId));
    assert.ok(images[0].attachment.width > 0);
    assert.equal(images[0].attachment.mediaType, 'image/png');
    if (args.mode === 'page') assert.equal(result.渲染页, 2);
  }
  mutateSource = true;
  await assert.rejects(tool.execute({ filePath: bundle.pptxPath, mode: 'page', page: 1 }, execution), /原文件发生变化/);
});


test('visual QA rejects missing and text-only routes before rendering', async (t) => {
  const bundle = await bundleFor(t);
  const attachments = { imageLimits: { mediaTypes: ['image/png'] }, saveImage() { assert.fail('must not render'); } };
  await assert.rejects(toolWith(attachments).execute({ filePath: bundle.pptxPath }, {}), /无法确认当前模型/);
  await assert.rejects(toolWith(attachments, { inputModalities: ['text'] }).execute({ filePath: bundle.pptxPath }, execution), /未声明图像输入/);
  const headersOverride = { agent: { ...execution.agent, session: { requestHeader: () => ({ config: { provider: 'switched', model: 'text' } }) } } };
  let resolved;
  let tool;
  registerPresentationRenderTool({ tools: { register(value) { tool = value; } }, get(name) {
    return name === 'attachments' ? attachments : name === 'llm' ? { resolveModelInfo: async (...args) => { resolved = args; return { inputModalities: ['text'] }; } } : undefined;
  } });
  await assert.rejects(tool.execute({ filePath: bundle.pptxPath }, headersOverride), /switched\/text/);
  assert.deepEqual(resolved.slice(0, 2), ['switched', 'text']);
});
