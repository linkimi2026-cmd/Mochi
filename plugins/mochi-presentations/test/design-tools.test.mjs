import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { apply } from '../plugin.mjs';

function toolsFor(root) {
  const tools = new Map();
  apply({ tools: { register(tool) { tools.set(tool.name, tool); } } }, { allowedRoots: [root] });
  return tools;
}

test('model-facing create/revise preserve theme and expose existing rhythm layouts in real PPTX', { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mochi-design-tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = toolsFor(root);
  const slides = ['cover', 'section', 'statement', 'kpi', 'closing', 'title-body'].map((layout) => ({
    layout, heading: layout === 'kpi' ? '50%' : '水的旅程', bullets: layout === 'title-body' ? ['蒸发、凝结与降水。'] : [],
  }));
  slides.push({ layout: 'title-table', heading: '状态对比', bullets: ['观察水的不同状态。'], table: { headers: ['状态', '例子'], rows: [['液体', '雨水']] } });
  slides.push({ layout: 'title-chart', heading: '课堂示例', bullets: ['示例数据，并非实际统计。'], chart: { type: 'bar', labels: ['甲', '乙'], series: [{ name: '示例', values: [2, 3] }] } });
  const first = await tools.get('mochi_ppt_create').execute({ title: '水循环', theme: 'field', slides, outputDirectory: join(root, 'first') });
  const source = JSON.parse(await readFile(first.sourcePath, 'utf8'));
  assert.deepEqual(source.slides.map((slide) => slide.layout), slides.map((slide) => slide.layout));
  assert.equal(source.theme.background, 'F1F5EA');
  const firstZip = await JSZip.loadAsync(await readFile(first.产物.pptx));
  assert.match(await firstZip.file('ppt/slides/slide1.xml').async('string'), /2F5D3A/);
  const revised = await tools.get('mochi_ppt_revise').execute({ previousSourcePath: first.sourcePath, page: 6, instruction: '改为简短重点陈述', newLayout: 'statement', newBody: [], outputDirectory: join(root, 'revised') });
  const next = JSON.parse(await readFile(revised.sourcePath, 'utf8'));
  assert.equal(next.slides[5].layout, 'statement');
  assert.deepEqual(next.slides[5].body, []);
  assert.deepEqual(next.theme, source.theme);
  const nextZip = await JSZip.loadAsync(await readFile(revised.产物.pptx));
  for (const number of [1, 2, 3, 4, 5, 7, 8]) {
    assert.equal(await nextZip.file(`ppt/slides/slide${number}.xml`).async('string'), await firstZip.file(`ppt/slides/slide${number}.xml`).async('string'));
  }
  assert.notEqual(await nextZip.file('ppt/slides/slide6.xml').async('string'), await firstZip.file('ppt/slides/slide6.xml').async('string'));
  await assert.rejects(tools.get('mochi_ppt_create').execute({ title: '错配', slides: [{ ...slides[6], layout: 'cover' }], outputDirectory: join(root, 'invalid') }), /table 必须使用/);
  await assert.rejects(tools.get('mochi_ppt_create').execute({ title: '未知主题', theme: 'invented', slides, outputDirectory: join(root, 'unknown') }), /theme.*must be one of/);
});
