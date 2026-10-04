import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';

import { inspectPdfArtifact } from '@mochi/pdf-layout';
import { PDFDocument } from 'pdf-lib';
import { demonstrationLessonPlan } from '../fixtures/lesson-plan.mjs';
import { teacherLessonSample } from '../fixtures/teacher-lesson.mjs';
import { generatePresentationBundle, MochiPresentationsError, revisePresentationBundle, validatePresentation } from '../index.mjs';
import { resolveSoffice } from '../render.mjs';

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

function tableRowGeometry(xml) {
  const rowHeights = [...xml.matchAll(/<a:tr h="(\d+)"/gu)].map(([, height]) => Number(height));
  const frameHeight = Number(xml.match(/<p:graphicFrame>[\s\S]*?<a:ext cx="\d+" cy="(\d+)"/u)?.[1]);
  return { rowHeights, frameHeight };
}

function tableCellMargins(xml) {
  return [...xml.matchAll(/<a:tcPr marL="(\d+)" marR="(\d+)" marT="(\d+)" marB="(\d+)"/gu)].map(([, left, right, top, bottom]) => [Number(left), Number(right), Number(top), Number(bottom)]);
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
  assert.equal(bundle.previewPdfPath, null);
  assert.equal(manifest.preview.status, 'unavailable');
  assert.equal(manifest.preview.reason, 'SOFFICE_UNAVAILABLE');
  assert.equal(manifest.preview.previewOfPptxSha256, manifest.files.pptx.sha256);
  assert.equal(manifest.files.previewPdf, undefined);
  assert.equal(await exists(join(root, 'v1', 'presentation-preview.pdf')), false);
});

test('final PPTX creates an independent preview PDF, and revision never reuses an older preview', {
  skip: !resolveSoffice() && 'LibreOffice unavailable; real PPTX preview not verified',
  timeout: 120_000,
}, async (t) => {
  const root = await rootFor(t);
  const first = await generatePresentationBundle({ presentation: demonstrationLessonPlan(), outputDirectory: join(root, 'v1') });
  const revised = await revisePresentationBundle({
    previousSourcePath: first.sourcePath,
    revision: { slideId: 'process', title: '三个过程与观察记录' },
    outputDirectory: join(root, 'v2'),
  });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const textOnPage = async (pdfPath, pageNumber) => {
    const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)), isEvalSupported: false });
    try {
      const document = await task.promise;
      const page = await document.getPage(pageNumber);
      return (await page.getTextContent()).items.map((item) => item.str).join('').replace(/\s+/gu, '');
    } finally { await task.destroy(); }
  };
  for (const bundle of [first, revised]) {
    const manifest = JSON.parse(await readFile(bundle.manifestPath, 'utf8'));
    const bytes = await readFile(bundle.previewPdfPath);
    assert.equal(manifest.preview.status, 'available');
    assert.equal(manifest.preview.kind, 'pptx-rendered-pdf');
    assert.equal(manifest.preview.renderer, 'LibreOffice');
    assert.equal(manifest.preview.previewOfPptxSha256, manifest.files.pptx.sha256);
    assert.equal(manifest.files.previewPdf.bytes, bytes.length);
    assert.equal(manifest.files.previewPdf.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3);
    assert.equal(manifest.preview.pageCount, 3);
    assert.ok(bundle.previewPdfPath.startsWith(bundle.outputDirectory));
    assert.notEqual(manifest.files.pdf.sha256, manifest.files.previewPdf.sha256, 'handout is separately laid out');
    assert.deepEqual((await readdir(bundle.outputDirectory)).sort(), ['manifest.json', 'presentation-preview.pdf', 'presentation.pdf', 'presentation.pptx', 'source.json']);
  }
  assert.match(await textOnPage(first.previewPdfPath, 2), /三个过程/u);
  assert.doesNotMatch(await textOnPage(first.previewPdfPath, 2), /观察记录/u);
  assert.match(await textOnPage(revised.previewPdfPath, 2), /三个过程与观察记录/u);
  assert.notEqual(first.manifest.files.pptx.sha256, revised.manifest.files.pptx.sha256);
  assert.notEqual(first.manifest.files.previewPdf.sha256, revised.manifest.files.previewPdf.sha256);

  const unavailable = await revisePresentationBundle({
    previousSourcePath: revised.sourcePath,
    revision: { slideId: 'process', title: '本次未能生成预览' },
    outputDirectory: join(root, 'v3'),
    converter: { sofficePath: join(root, 'missing-soffice') },
  });
  assert.equal(unavailable.previewPdfPath, null);
  assert.equal(unavailable.manifest.preview.status, 'unavailable');
  assert.equal(unavailable.manifest.files.previewPdf, undefined);
  assert.equal(await exists(join(unavailable.outputDirectory, 'presentation-preview.pdf')), false);
  assert.equal(await exists(revised.previewPdfPath), true, 'prior immutable preview remains intact');
});

test('a failing LibreOffice conversion leaves a valid editable deck and explicit unavailable state', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const failingSoffice = join(root, 'failing-soffice');
  await writeFile(failingSoffice, '#!/bin/sh\nexit 2\n');
  await chmod(failingSoffice, 0o700);
  const bundle = await generatePresentationBundle({
    presentation: demonstrationLessonPlan(),
    outputDirectory: join(root, 'failed-preview'),
    converter: { sofficePath: failingSoffice },
  });
  assert.equal(bundle.manifest.preview.status, 'unavailable');
  assert.equal(bundle.manifest.preview.reason, 'CONVERSION_FAILED');
  assert.equal(bundle.previewPdfPath, null);
  assert.equal(await exists(join(bundle.outputDirectory, 'presentation-preview.pdf')), false);
  assert.equal((await readFile(bundle.pptxPath)).subarray(0, 2).toString(), 'PK');
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
    archive.file('ppt/slides/_rels/slide5.xml.rels').async('text'),
    readFile(first.manifestPath, 'utf8').then(JSON.parse),
  ]);
  assert.match(chartXml, /<c:barChart>/, 'chart must be an editable Office bar chart, not a rendered image');
  assert.match(chartXml, /示例票数/);
  assert.match(chartXml, /及时关水/);
  assert.ok(archive.file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'), 'native chart data workbook must be embedded');
  assert.match(slideRelationships, /relationships\/chart/);
  const processXml = await archive.file('ppt/slides/slide3.xml').async('text');
  assert.match(processXml, /地表水受热成为水蒸气/);
  assert.match(processXml, /降到地面的水可以再次蒸发/);
  assert.doesNotMatch(processXml, /<p:pic>/, 'water-cycle process remains editable shapes');
  const tableXml = await archive.file('ppt/slides/slide4.xml').async('text');
  const sparseTable = tableRowGeometry(tableXml);
  const sparseMargins = tableCellMargins(tableXml);
  assert.match(tableXml, /<a:bodyPr[^>]*anchor="ctr"/u, 'enlarged table rows vertically center their text');
  assert.equal(sparseMargins.length, 12);
  assert.ok(sparseMargins.every(([left, right, top, bottom]) => left === Math.round(0.12 * 914400) && right === Math.round(0.12 * 914400) && top === Math.round(0.06 * 914400) && bottom === Math.round(0.06 * 914400)), 'cells use 0.12 in horizontal margins and preserve 0.06 in vertical margins');
  assert.equal(sparseTable.rowHeights.length, 4);
  assert.deepEqual(sparseTable.rowHeights, Array(4).fill(Math.round(0.82 * 914400)), 'sparse table rows grow to the bounded projection height');
  assert.ok(sparseTable.rowHeights.reduce((sum, height) => sum + height, 0) > 4 * 0.38 * 914400, 'sparse table is larger than the former fixed-height geometry');
  assert.ok(sparseTable.rowHeights.reduce((sum, height) => sum + height, 0) <= sparseTable.frameHeight, 'row geometry remains inside its declared content box');
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
  assert.equal(await slideXml(first.pptxPath, 7), await slideXml(revised.pptxPath, 7));
  assert.equal(await slideXml(first.pptxPath, 5), await slideXml(revised.pptxPath, 5), 'a chart data update keeps the slide relationship byte-identical');
  const updatedArchive = await presentationArchive(revised.pptxPath);
  const updatedChartName = Object.keys(updatedArchive.files).find((name) => /^ppt\/charts\/chart\d+\.xml$/u.test(name));
  assert.ok(updatedChartName, 'revised deck must retain one native chart OOXML part');
  const updatedChartXml = await updatedArchive.file(updatedChartName).async('text');
  assert.match(updatedChartXml, /小组投票示例（更新）/);
  assert.notEqual(updatedChartXml, chartXml, 'the target native chart OOXML must change');
});

test('crowded native tables keep all row heights inside their fixed content box', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const presentation = teacherLessonSample();
  presentation.slides[3].table.rows = Array.from({ length: 8 }, () => [
    '蒸发阶段的条件与水面变化观察记录',
    '水面逐渐减少的现象与受热条件',
    '雨滴从云中落下后再次蒸发回到水面',
  ]);
  const bundle = await generatePresentationBundle({ presentation, outputDirectory: join(root, 'crowded-table') });
  const xml = await slideXml(bundle.pptxPath, 4);
  const geometry = tableRowGeometry(xml);
  const margins = tableCellMargins(xml);
  const rowTotal = geometry.rowHeights.reduce((sum, height) => sum + height, 0);
  const contentHeight = bundle.manifest.slides.find((slide) => slide.id === 'process-table').projection.contentHeight;

  assert.equal(geometry.rowHeights.length, 9);
  assert.ok(geometry.rowHeights.every((height) => height > 0));
  assert.equal(margins.length, 27);
  assert.ok(margins.every(([left, right, top, bottom]) => left === Math.round(0.12 * 914400) && right === Math.round(0.12 * 914400) && top === Math.round(0.06 * 914400) && bottom === Math.round(0.06 * 914400)), 'max-density table keeps the wider horizontal cell margins');
  for (const value of presentation.slides[3].table.rows.flat()) assert.ok(xml.includes(value), `dense cell text remains in the editable table: ${value}`);
  assert.ok(rowTotal <= geometry.frameHeight, 'the individual rows must not exceed the native table frame');
  assert.ok(rowTotal <= contentHeight * 914400, 'the total row heights must fit the validated content area');
  assert.ok(rowTotal > 9 * 0.38 * 914400, 'crowded tables still use available projection area instead of the old undersized fixed height');
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
  chartLabels.slides[4].chart.labels[0] = '很长的图表坐标轴标签'.repeat(3);
  assert.throws(() => validatePresentation(chartLabels), (error) => error.code === 'INVALID_INPUT');
  const chartSeries = teacherLessonSample();
  chartSeries.slides[4].chart.series[0].values = [1, 2];
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
