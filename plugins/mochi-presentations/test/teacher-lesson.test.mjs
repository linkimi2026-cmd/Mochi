import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { inspectPdfArtifact } from '@mochi/pdf-layout';
import { generatePresentationBundle } from '../index.mjs';
import { teacherLessonSample } from '../fixtures/teacher-lesson.mjs';

test('teacher lesson uses aligned activity rows that render as editable PPTX text and searchable PDF', { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mochi-teacher-lesson-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const presentation = teacherLessonSample();
  assert.equal(presentation.slides.length, 7);
  const observation = presentation.slides[1];
  assert.equal(observation.layout, 'title-compare');
  assert.match(observation.title, /下一页的简化路径/u);
  assert.equal(observation.comparison.rows.length, 2);
  const action = presentation.slides[5];
  assert.equal(action.layout, 'title-compare');
  assert.equal(action.comparison.rows.length, 3);
  assert.deepEqual(action.comparison.rows.map(({ left, right }) => [left, right]), [
    ['选择一个校园用水场景', '说清楚场景和用水行为'],
    ['写出“谁在什么时候做什么”', '行动句包含人物、时机和动作'],
    ['说明这条提示怎样减少浪费', '理由对应所选场景的用水行为'],
  ]);

  const bundle = await generatePresentationBundle({ presentation, outputDirectory: join(root, 'deck') });
  const source = JSON.parse(await readFile(bundle.sourcePath, 'utf8'));
  assert.deepEqual(source.slides.map(({ layout }) => layout), presentation.slides.map(({ layout }) => layout));
  assert.equal(bundle.manifest.quality.teachingCoverage.status, 'mapped');
  assert.equal(bundle.manifest.quality.teachingCoverage.objectiveCount, 2);
  assert.deepEqual(bundle.manifest.quality.teachingCoverage.unmappedSlideIds, ['opening']);

  const pptx = await JSZip.loadAsync(await readFile(bundle.pptxPath));
  for (const [page, terms] of [
    [2, ['观察线索', '记录方式', '地表水受热', '圈出液态水变成水蒸气的位置']],
    [6, ['行动设计', '完成标准', '选择一个校园用水场景', '行动句包含人物、时机和动作']],
  ]) {
    const xml = await pptx.file(`ppt/slides/slide${page}.xml`).async('string');
    assert.ok((xml.match(/<p:sp>/gu) ?? []).length >= 6, `page ${page} has editable PowerPoint text shapes`);
    assert.doesNotMatch(xml, /<p:pic>/u);
    for (const term of terms) assert.ok(xml.includes(term), `page ${page} contains ${term}`);
  }
  await inspectPdfArtifact(await readFile(bundle.pdfPath), {
    expectedPageCount: 7,
    requiredText: ['观察线索', '记录方式', '下一页的简化路径', '行动设计', '完成标准'],
  });
});
