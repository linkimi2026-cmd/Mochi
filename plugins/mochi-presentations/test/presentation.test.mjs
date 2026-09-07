import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';

import { inspectPdfArtifact } from '@mochi/pdf-layout';
import { demonstrationLessonPlan } from '../fixtures/lesson-plan.mjs';
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
