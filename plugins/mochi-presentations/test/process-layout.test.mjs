import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { apply } from '../plugin.mjs';

const process = { steps: [
  { label: '蒸发', detail: '水吸收热量，变成看不见的水蒸气。' },
  { label: '凝结', detail: '水蒸气遇冷，形成小水滴。' },
  { label: '降水', detail: '云中水滴长大，落回地面。' },
], loopLabel: '地面的水可以再次蒸发，继续循环' };

test('native process shapes retain text, arrows and scoped revision across PPTX and PDF', { timeout: 60_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'mochi-process-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = new Map();
  apply({ tools: { register(tool) { tools.set(tool.name, tool); } } }, { allowedRoots: [root] });
  const create = tools.get('mochi_ppt_create');
  const first = await create.execute({ title: '水循环示意', theme: 'field', slides: [
    { heading: '水的一条旅行路线', bullets: ['这是常见路径示意，不代表全部水循环路径。'], layout: 'title-process', process },
    { heading: '观察水的变化', bullets: ['观察后记录自己的发现。'], layout: 'closing' },
  ], outputDirectory: join(root, 'first') });
  const source = JSON.parse(await readFile(first.sourcePath, 'utf8'));
  assert.deepEqual(source.slides[0].process, process);
  const zip = await JSZip.loadAsync(await readFile(first.产物.pptx));
  const firstXml = await zip.file('ppt/slides/slide1.xml').async('string');
  for (const step of process.steps) {
    assert.ok(firstXml.includes(step.label));
    assert.ok(firstXml.includes(step.detail));
  }
  assert.match(firstXml, /type="triangle"/);
  assert.match(firstXml, /prst="rect"/);
  assert.doesNotMatch(firstXml, /<p:pic>/);
  const revised = await tools.get('mochi_ppt_revise').execute({ previousSourcePath: first.sourcePath, page: 1, instruction: '改成一次观察操作流程', newBody: [], newProcess: { steps: [
    { label: '准备', detail: '在透明杯中加入少量温水。' },
    { label: '盖上', detail: '把较冷的透明盖放在杯口。' },
    { label: '观察', detail: '观察盖子内侧是否出现小水滴。' },
    { label: '记录', detail: '画出看到的现象，比较前后变化。' },
  ] }, outputDirectory: join(root, 'next') });
  const next = JSON.parse(await readFile(revised.sourcePath, 'utf8'));
  assert.equal(next.slides[0].process.loopLabel, undefined);
  const zip2 = await JSZip.loadAsync(await readFile(revised.产物.pptx));
  assert.equal(await zip2.file('ppt/slides/slide2.xml').async('string'), await zip.file('ppt/slides/slide2.xml').async('string'));
  const exit = await tools.get('mochi_ppt_revise').execute({ previousSourcePath: revised.sourcePath, page: 1, instruction: '只保留观察结论', newLayout: 'statement', newTitle: '遇冷的水蒸气可以凝结成小水滴', newBody: [], outputDirectory: join(root, 'exit') });
  assert.equal(JSON.parse(await readFile(exit.sourcePath, 'utf8')).slides[0].process, undefined);
  for (const bad of [{ ...process, steps: process.steps.slice(0, 2) }, { ...process, steps: [{ label: '太长', detail: '字'.repeat(33) }, ...process.steps.slice(1)] }]) {
    await assert.rejects(create.execute({ title: '非法', slides: [{ heading: '流程', bullets: [], process: bad }], outputDirectory: join(root, 'bad') }), /process.steps|步骤detail/);
  }
  await assert.rejects(create.execute({ title: '错配', slides: [{ heading: '流程', bullets: [], layout: 'cover', process }], outputDirectory: join(root, 'bad') }), /process.*title-process/);
});
