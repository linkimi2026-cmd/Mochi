import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';

import { inspectPdfArtifact } from '@mochi/pdf-layout';
import { demonstrationLessonPlan } from '../fixtures/lesson-plan.mjs';
import { teacherLessonSample } from '../fixtures/teacher-lesson.mjs';
import { generatePresentationBundle, MochiPresentationsError, revisePresentationBundle, validatePresentation } from '../index.mjs';

async function rootFor(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-presentations-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function rejectCode(operation, code) {
  await assert.rejects(operation, (error) => error instanceof MochiPresentationsError && error.code === code);
}

async function presentationArchive(path) {
  return JSZip.loadAsync(await readFile(path));
}

async function slideXml(path, number) {
  const archive = await presentationArchive(path);
  return archive.file(`ppt/slides/slide${number}.xml`).async('text');
}

test('ordinary lesson-plan input creates editable PPTX and same-input searchable PDF without an Office process', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const bundle = await generatePresentationBundle({
    presentation: demonstrationLessonPlan(),
    outputDirectory: join(root, 'v1'),
    converter: { sofficePath: join(root, 'not-present-soffice'), timeoutMs: 100 },
  });
  const [archive, slide1, slide2, manifest, pdfBytes, projectionFont] = await Promise.all([
    presentationArchive(bundle.pptxPath),
    slideXml(bundle.pptxPath, 1),
    slideXml(bundle.pptxPath, 2),
    readFile(bundle.manifestPath, 'utf8').then(JSON.parse),
    readFile(bundle.pdfPath),
    readFile(new URL('../assets/fonts/NotoSansSC-VF.ttf', import.meta.url)),
  ]);
  assert.match(slide1, /水循环/);
  assert.match(slide1, /Noto Sans SC/, 'editable text must request the bundled projection font');
  assert.equal(projectionFont.subarray(0, 4).toString('hex'), '00010000', 'bundled projection font must be a TrueType file');
  assert.match(slide2, /<a:tbl>/, 'lesson table must be a native editable PowerPoint table');
  assert.match(slide2, /液态水变成水蒸气/);
  assert.equal(Object.entries(archive.files).some(([name, entry]) => name.startsWith('ppt/media/') && !entry.dir), false, 'fixture deck must not substitute page screenshots');
  const inspection = await inspectPdfArtifact(pdfBytes, {
    expectedPageCount: 3,
    requiredText: ['水循环', '三个过程', '液态水变成水蒸气', '课堂回顾'],
  });
  assert.equal(inspection.embeddedFont, true);
  assert.equal(inspection.imageCount, 0);
  assert.equal(manifest.sourceSlideCount, 3);
  assert.equal(manifest.renderedPageCount, 3);
  assert.equal(manifest.files.pptx.editable, true);
});

test('one-slide revision preserves untouched source/version/hash and generated slide XML', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const first = await generatePresentationBundle({ presentation: demonstrationLessonPlan(), outputDirectory: join(root, 'v1') });
  const revised = await revisePresentationBundle({ previousSourcePath: first.sourcePath, revision: { slideId: 'process', title: '三个过程与观察记录', body: ['先描述现象，再解释条件。'] }, outputDirectory: join(root, 'v2') });
  const [before, after, source] = await Promise.all([readFile(first.manifestPath, 'utf8').then(JSON.parse), readFile(revised.manifestPath, 'utf8').then(JSON.parse), readFile(revised.sourcePath, 'utf8').then(JSON.parse)]);
  for (const id of ['opening', 'review']) assert.deepEqual(after.slides.find((slide) => slide.id === id), before.slides.find((slide) => slide.id === id));
  assert.equal(after.slides.find((slide) => slide.id === 'process').version, 2);
  assert.notEqual(after.slides.find((slide) => slide.id === 'process').semanticHash, before.slides.find((slide) => slide.id === 'process').semanticHash);
  assert.equal(source.version, 2);
  assert.equal(await slideXml(first.pptxPath, 1), await slideXml(revised.pptxPath, 1));
  assert.equal(await slideXml(first.pptxPath, 3), await slideXml(revised.pptxPath, 3));
  assert.notEqual(await slideXml(first.pptxPath, 2), await slideXml(revised.pptxPath, 2));
});

test('teacher sample writes a native editable chart and preserves untouched slide XML after a chart-page revision', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const first = await generatePresentationBundle({ presentation: teacherLessonSample(), outputDirectory: join(root, 'teacher-v1') });
  const archive = await presentationArchive(first.pptxPath);
  const [chartXml, slideRelationships, manifest] = await Promise.all([
    archive.file('ppt/charts/chart1.xml').async('text'),
    archive.file('ppt/slides/_rels/slide4.xml.rels').async('text'),
    readFile(first.manifestPath, 'utf8').then(JSON.parse),
  ]);
  assert.match(chartXml, /<c:barChart>/, 'chart must be an editable Office bar chart, not a rendered image');
  assert.match(chartXml, /示例票数/);
  assert.match(chartXml, /及时关水/);
  assert.ok(archive.file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'), 'native chart data workbook must be embedded');
  assert.match(slideRelationships, /relationships\/chart/);
  assert.equal(manifest.slides.find((slide) => slide.id === 'action-chart').layout, 'title-chart');
  assert.ok(manifest.slides.find((slide) => slide.id === 'action-chart').projection.contentHeight >= 3.45);

  const revised = await revisePresentationBundle({
    previousSourcePath: first.sourcePath,
    revision: {
      slideId: 'action-chart',
      layout: 'title-chart',
      chart: { type: 'bar', title: '小组投票示例（更新）', labels: ['及时关水', '一水多用', '修理滴漏', '减少长流水'], series: [{ name: '示例票数', values: [20, 13, 9, 7] }] },
    },
    outputDirectory: join(root, 'teacher-v2'),
  });
  assert.equal(await slideXml(first.pptxPath, 1), await slideXml(revised.pptxPath, 1));
  assert.equal(await slideXml(first.pptxPath, 6), await slideXml(revised.pptxPath, 6));
  assert.equal(await slideXml(first.pptxPath, 4), await slideXml(revised.pptxPath, 4), 'a chart data update keeps the slide relationship byte-identical');
  const updatedArchive = await presentationArchive(revised.pptxPath);
  const updatedChartName = Object.keys(updatedArchive.files).find((name) => /^ppt\/charts\/chart\d+\.xml$/u.test(name));
  assert.ok(updatedChartName, 'revised deck must retain one native chart OOXML part');
  const updatedChartXml = await updatedArchive.file(updatedChartName).async('text');
  assert.match(updatedChartXml, /小组投票示例（更新）/);
  assert.notEqual(updatedChartXml, chartXml, 'the target native chart OOXML must change');
});

test('capacity/type limits reject unsupported layouts while table cells may be blank', () => {
  const valid = demonstrationLessonPlan();
  valid.slides[1].table.rows[0][1] = '';
  assert.equal(validatePresentation(valid).slides[1].table.rows[0][1], '');
  const bodyType = demonstrationLessonPlan();
  bodyType.slides[1].body = 'not an array';
  assert.throws(() => validatePresentation(bodyType), (error) => error.code === 'INVALID_INPUT');
  const overflow = demonstrationLessonPlan();
  overflow.slides[0].body = Array.from({ length: 6 }, () => '很长'.repeat(70));
  assert.throws(() => validatePresentation(overflow), (error) => error.code === 'INVALID_INPUT');
  const chartLabels = teacherLessonSample();
  chartLabels.slides[3].chart.labels[0] = '很长的图表坐标轴标签'.repeat(3);
  assert.throws(() => validatePresentation(chartLabels), (error) => error.code === 'INVALID_INPUT');
  const chartSeries = teacherLessonSample();
  chartSeries.slides[3].chart.series[0].values = [1, 2];
  assert.throws(() => validatePresentation(chartSeries), (error) => error.code === 'INVALID_INPUT');
  const explicitBodyLines = demonstrationLessonPlan();
  explicitBodyLines.slides[0].body = Array.from({ length: 6 }, () => '第一行\n第二行\n第三行');
  assert.throws(() => validatePresentation(explicitBodyLines), (error) => error.code === 'INVALID_INPUT', 'explicit body line breaks must count against the projection budget');
  const explicitTitleLines = demonstrationLessonPlan();
  explicitTitleLines.slides[0].title = '第一行\n第二行\n第三行';
  assert.throws(() => validatePresentation(explicitTitleLines), (error) => error.code === 'INVALID_INPUT', 'titles may use at most two physical or wrapped lines');
  const explicitTableLines = demonstrationLessonPlan();
  explicitTableLines.slides[1].table.rows[0][0] = '蒸发\n受热';
  assert.throws(() => validatePresentation(explicitTableLines), (error) => error.code === 'INVALID_INPUT', 'table cells may not hide extra lines');
});

test('pre-aborted direct generation publishes no output directory', async (t) => {
  const root = await rootFor(t);
  const outputDirectory = join(root, 'abort');
  const controller = new AbortController();
  controller.abort();
  await rejectCode(() => generatePresentationBundle({ presentation: demonstrationLessonPlan(), outputDirectory, signal: controller.signal }), 'ABORTED');
  assert.equal(await exists(outputDirectory), false);
});

test('concurrent publication to one host target has exactly one winner and never overwrites', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const outputDirectory = join(root, 'shared');
  const results = await Promise.allSettled([
    generatePresentationBundle({ presentation: demonstrationLessonPlan(), outputDirectory }),
    generatePresentationBundle({ presentation: demonstrationLessonPlan(), outputDirectory }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejection = results.find((result) => result.status === 'rejected');
  assert.equal(rejection.reason.code, 'OUTPUT_EXISTS');
  assert.equal(JSON.parse(await readFile(join(outputDirectory, 'manifest.json'), 'utf8')).status, 'completed');
});

test('invalid inputs publish nothing', async (t) => {
  const root = await rootFor(t);
  await rejectCode(() => generatePresentationBundle({ outputDirectory: join(root, 'missing-input') }), 'INVALID_INPUT');
  assert.equal(await exists(join(root, 'missing-input')), false);
});

test('an existing empty target is never overwritten', async (t) => {
  const root = await rootFor(t);
  const target = join(root, 'reserved');
  await writeFile(join(root, 'sentinel'), 'outside');
  await mkdir(target);
  await rejectCode(() => generatePresentationBundle({ presentation: demonstrationLessonPlan(), outputDirectory: target }), 'OUTPUT_EXISTS');
  assert.deepEqual(await readdir(target), []);
});

test('an unwritable host parent is reported before generation', async (t) => {
  const root = await rootFor(t);
  const locked = join(root, 'locked');
  await mkdir(locked);
  await chmod(locked, 0o500);
  try {
    await rejectCode(() => generatePresentationBundle({ presentation: demonstrationLessonPlan(), outputDirectory: join(locked, 'output') }), 'OUTPUT_UNAVAILABLE');
    assert.equal(await exists(join(locked, 'output')), false);
  } finally {
    await chmod(locked, 0o700);
  }
});

// 渲染校验暴露的硬缺陷（2026-09-12）：深底页的 accent 压不住对比度。
//
// 肉眼看渲染图发现的：field 主题的 cover/closing 用 C08A1E 金色副题压在 2F5D3A 深绿上，
// 对比度约 2.8:1，投影到教室后排就是"有字但看不清"。15pt 正文的 WCAG AA 下限是 4.5:1。
// 对比度是可以算出来的，所以这条不能靠"看起来还行"，必须钉死在测试里。
test('深底节奏页的前景色过 WCAG AA 对比度下限，且修的是明度不是色调', async () => {
  const { contrastRatio, ensureReadableColor } = await import('../index.mjs');
  const presets = {
    neutral: { accent: 'B45309', deep: '16181D', onDeep: 'F5F6F7', primary: '16181D' },
    ink: { accent: 'A8351A', deep: '26352E', onDeep: 'F7F3E8', primary: '26352E' },
    field: { accent: 'C08A1E', deep: '2F5D3A', onDeep: 'F1F5EA', primary: '2F5D3A' },
    lab: { accent: 'C2410C', deep: '1B3A5C', onDeep: 'F5F7FA', primary: '1B3A5C' },
    archive: { accent: '8C2F1B', deep: '4A2E17', onDeep: 'F3EEE2', primary: '5B3A1E' },
    swiss: { accent: '0057B8', deep: '111111', onDeep: 'FFFFFF', primary: '111111' },
    midnight: { accent: 'D8A02B', deep: '0B0E12', onDeep: 'F2F5F8', primary: 'F2F5F8' },
    stage: { accent: 'E4572E', deep: '150C18', onDeep: 'FDF6FF', primary: 'FDF6FF' },
    festive: { accent: '0F766E', deep: 'B33A20', onDeep: 'FFF7F0', primary: 'B33A20' },
  };

  // 先把"确实坏过"钉下来，免得以后有人把这条当噪音删掉。
  assert.ok(contrastRatio('C08A1E', '2F5D3A') < 4.5, 'field 的原始 accent 压 deep 本就低于 4.5:1');

  for (const [name, spec] of Object.entries(presets)) {
    const fixed = ensureReadableColor(spec.accent, spec.deep, { fallback: spec.onDeep });
    assert.ok(contrastRatio(fixed, spec.deep) >= 4.5,
      `${name}：深底页的 accent 校正后仍未达 4.5:1（${fixed} on ${spec.deep}）`);
    // 只准调明度，色调必须留在原色附近，否则主题的"性格"就丢了。
    const channel = (hex, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    const order = (hex) => [0, 1, 2].map((index) => channel(hex, index)).map((value, index, all) => Math.sign(all[index] - all[(index + 1) % 3]));
    assert.deepEqual(order(fixed), order(spec.accent), `${name}：校正不能改变通道的相对大小关系（即不能换色调）`);
  }
});
