import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { inspectPdfArtifact } from '@mochi/pdf-layout';
import { apply } from '../plugin.mjs';
import { inspectPresentationFile } from '../index.mjs';

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
  const comparison = {
    leftTitle: '蒸发',
    rightTitle: '凝结',
    rows: [
      { left: '液态水吸收热量，变成水蒸气。', right: '水蒸气遇冷，形成小水滴。' },
      { left: '水由液态变为气态。', right: '水由气态变为液态。' },
    ],
  };
  slides.push({ layout: 'title-compare', heading: '蒸发和凝结的变化方向相反', bullets: [], comparison });
  const first = await tools.get('mochi_ppt_create').execute({ title: '水循环', theme: 'field', slides, outputDirectory: join(root, 'first') });
  const source = JSON.parse(await readFile(first.sourcePath, 'utf8'));
  assert.deepEqual(source.slides.map((slide) => slide.layout), slides.map((slide) => slide.layout));
  assert.equal(source.theme.background, 'F1F5EA');
  const firstZip = await JSZip.loadAsync(await readFile(first.产物.pptx));
  assert.match(await firstZip.file('ppt/slides/slide1.xml').async('string'), /2F5D3A/);
  const compareXml = await firstZip.file('ppt/slides/slide9.xml').async('string');
  assert.match(compareXml, /蒸发/);
  assert.match(compareXml, /凝结/);
  assert.match(compareXml, /吸收热量/);
  assert.match(compareXml, /遇冷/);
  assert.ok((compareXml.match(/<p:sp>/g) ?? []).length >= 6, 'column headings and paired cells are editable PowerPoint shapes');
  assert.doesNotMatch(compareXml, /<p:pic>/, 'comparison remains editable text and shapes, never a slide image');
  assert.equal(source.slides[8].layout, 'title-compare');
  assert.deepEqual(source.slides[8].comparison, comparison);
  const pdf = await inspectPdfArtifact(await readFile(first.产物.pdf), { expectedPageCount: 9, requiredText: ['蒸发', '凝结', '吸收热量', '遇冷'] });
  assert.equal(pdf.imageCount, 0);
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
  const compareRevision = await tools.get('mochi_ppt_revise').execute({ previousSourcePath: revised.sourcePath, page: 9, instruction: '更新两种变化的说明', newComparison: { ...comparison, rows: [{ left: '液态水吸热后成水蒸气。', right: '水蒸气遇冷后成小水滴。' }, comparison.rows[1]] }, outputDirectory: join(root, 'compare-revised') });
  const compareRevisionSource = JSON.parse(await readFile(compareRevision.sourcePath, 'utf8'));
  assert.equal(compareRevisionSource.slides[8].comparison.rows[0].left, '液态水吸热后成水蒸气。');
  const compareRevisionZip = await JSZip.loadAsync(await readFile(compareRevision.产物.pptx));
  for (let number = 1; number <= 9; number += 1) {
    if (number === 9) continue;
    assert.equal(await compareRevisionZip.file(`ppt/slides/slide${number}.xml`).async('string'), await nextZip.file(`ppt/slides/slide${number}.xml`).async('string'));
  }
  assert.notEqual(await compareRevisionZip.file('ppt/slides/slide9.xml').async('string'), compareXml);
  await assert.rejects(tools.get('mochi_ppt_create').execute({ title: '错配', slides: [{ ...slides[6], layout: 'cover' }], outputDirectory: join(root, 'invalid') }), /table 必须使用/);
  await assert.rejects(tools.get('mochi_ppt_create').execute({ title: '对照组数错误', slides: [{ layout: 'title-compare', heading: '对照', bullets: [], comparison: { leftTitle: '左', rightTitle: '右', rows: [{ left: '单组不能成立', right: '单组不能成立' }] } }], outputDirectory: join(root, 'invalid-compare') }), /2-4组/);
  await assert.rejects(tools.get('mochi_ppt_create').execute({ title: '对照文字过长', slides: [{ layout: 'title-compare', heading: '对照', bullets: [], comparison: { leftTitle: '左', rightTitle: '右', rows: [{ left: '很长'.repeat(24), right: '短句' }, { left: '短句', right: '短句' }] } }], outputDirectory: join(root, 'invalid-compare-width') }), /两行投影预算/);
  await assert.rejects(tools.get('mochi_ppt_create').execute({ title: '未知主题', theme: 'invented', slides, outputDirectory: join(root, 'unknown') }), /theme.*must be one of/);
});

test('model-facing slide sources remain unverified, roundtrip, and revise only the selected page', { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mochi-source-tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = toolsFor(root);
  const declared = { label: '教师提供的七年级科学讲义', reference: '第 4 页' };
  const slides = [
    { heading: '水循环的观察', bullets: ['观察水蒸发与凝结。'], source: declared },
    { heading: '课堂讨论', bullets: ['哪些条件可能影响蒸发？'] },
  ];
  const first = await tools.get('mochi_ppt_create').execute({ title: '水循环', slides, outputDirectory: join(root, 'first') });
  const firstSource = JSON.parse(await readFile(first.sourcePath, 'utf8'));
  const firstManifest = JSON.parse(await readFile(first.产物.manifest, 'utf8'));
  assert.equal(firstSource.sourceKind, 'model-authored-classroom-draft');
  assert.equal(firstManifest.sourceKind, 'model-authored-classroom-draft');
  assert.deepEqual(firstSource.slides.map((slide) => slide.source), [declared, null]);
  assert.deepEqual(firstManifest.slides.map((slide) => slide.sourceStatus), ['未核验：仅有来源声明', '未核验：未提供来源']);
  assert.deepEqual(firstManifest.slides.map((slide) => slide.source), [declared, null]);
  const firstReport = await inspectPresentationFile({ path: first.产物.pptx });
  assert.match(firstReport.幻灯片[0].备注, /Source status: 未核验：仅有来源声明/u);
  assert.match(firstReport.幻灯片[0].备注, /Reference: 第 4 页/u);
  assert.match(firstReport.幻灯片[1].备注, /Source status: 未核验：未提供来源/u);
  assert.doesNotMatch(firstReport.幻灯片[1].备注, /chat:mochi_ppt_create/u);
  const firstZip = await JSZip.loadAsync(await readFile(first.产物.pptx));
  const firstSlide1 = await firstZip.file('ppt/slides/slide1.xml').async('string');
  const firstSlide2 = await firstZip.file('ppt/slides/slide2.xml').async('string');
  assert.match(firstSlide1, /未核验 · 来源声明：教师提供的七年级科学讲义/u);
  assert.match(firstSlide2, /未核验 · 未提供来源/u);
  assert.doesNotMatch(firstSlide2, /chat:mochi_ppt_create|水循环 第 2 页/u);
  const firstPdf = await inspectPdfArtifact(await readFile(first.产物.pdf), { expectedPageCount: 2, requiredText: ['未核验', '未提供来源', declared.label] });
  assert.match(firstPdf.searchableText, /来源声明/u);
  assert.doesNotMatch(firstPdf.searchableText, /chat:mochi_ppt_create/u);

  const added = { label: '教师课堂观察记录' };
  const second = await tools.get('mochi_ppt_revise').execute({ previousSourcePath: first.sourcePath, page: 2, instruction: '补充已有资料名', newSource: added, outputDirectory: join(root, 'second') });
  const secondSource = JSON.parse(await readFile(second.sourcePath, 'utf8'));
  const secondManifest = JSON.parse(await readFile(second.产物.manifest, 'utf8'));
  assert.deepEqual(secondSource.slides.map((slide) => slide.source), [declared, added]);
  assert.deepEqual(secondManifest.slides.map((slide) => slide.sourceStatus), ['未核验：仅有来源声明', '未核验：仅有来源声明']);
  assert.equal(second.来源状态, '未核验：仅有来源声明');
  const secondZip = await JSZip.loadAsync(await readFile(second.产物.pptx));
  assert.equal(await secondZip.file('ppt/slides/slide1.xml').async('string'), firstSlide1);
  assert.match(await secondZip.file('ppt/slides/slide2.xml').async('string'), /来源声明：教师课堂观察记录/u);

  const third = await tools.get('mochi_ppt_revise').execute({ previousSourcePath: second.sourcePath, page: 1, instruction: '原来源不适用，移除', clearSource: true, outputDirectory: join(root, 'third') });
  const thirdSource = JSON.parse(await readFile(third.sourcePath, 'utf8'));
  const thirdManifest = JSON.parse(await readFile(third.产物.manifest, 'utf8'));
  assert.deepEqual(thirdSource.slides.map((slide) => slide.source), [null, added]);
  assert.deepEqual(thirdManifest.slides.map((slide) => slide.sourceStatus), ['未核验：未提供来源', '未核验：仅有来源声明']);
  const thirdZip = await JSZip.loadAsync(await readFile(third.产物.pptx));
  assert.equal(await thirdZip.file('ppt/slides/slide2.xml').async('string'), await secondZip.file('ppt/slides/slide2.xml').async('string'));
  assert.match(await thirdZip.file('ppt/slides/slide1.xml').async('string'), /未核验 · 未提供来源/u);
  const thirdReport = await inspectPresentationFile({ path: third.产物.pptx });
  assert.match(thirdReport.幻灯片[0].备注, /Source status: 未核验：未提供来源/u);
  assert.match(thirdReport.幻灯片[1].备注, /Reference: 未提供/u);
  await inspectPdfArtifact(await readFile(third.产物.pdf), { expectedPageCount: 2, requiredText: ['未核验', '未提供来源', added.label] });
  await assert.rejects(tools.get('mochi_ppt_revise').execute({ previousSourcePath: third.sourcePath, page: 2, instruction: '错误的冲突操作', newSource: added, clearSource: true, outputDirectory: join(root, 'rejected') }), /不能同时使用/u);
  await assert.rejects(tools.get('mochi_ppt_create').execute({ title: '空白资料名', slides: [{ ...slides[0], source: { label: '   ' } }], outputDirectory: join(root, 'blank-label') }), /source label must contain/u);
  await assert.rejects(tools.get('mochi_ppt_revise').execute({ previousSourcePath: third.sourcePath, page: 2, instruction: '空白资料定位无效', newSource: { label: '资料', reference: '   ' }, outputDirectory: join(root, 'blank-reference') }), /source reference must contain/u);
});
