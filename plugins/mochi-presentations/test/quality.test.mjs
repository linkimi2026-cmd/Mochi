import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { apply } from '../plugin.mjs';
import { createQualityReport, inspectPptxBuffer } from '../index.mjs';

function toolsFor(root) {
  const tools = new Map();
  apply({ tools: { register(tool) { tools.set(tool.name, tool); } } }, { allowedRoots: [root], converter: { sofficePath: join(root, 'missing-soffice') } });
  return tools;
}

test('quality manifest binds actual PPTX structure, warns on repeated layout, and revise rechecks without claiming visual acceptance', { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mochi-ppt-quality-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = toolsFor(root);
  const repeatedSlides = [
    { layout: 'title-body', heading: '第一张观察水循环', bullets: ['观察水蒸发与凝结。'] },
    { layout: 'title-body', heading: '第二张继续观察', bullets: ['记录温度变化。'] },
    { layout: 'title-body', heading: '第三张继续说明', bullets: ['用证据解释变化。'] },
  ];
  const first = await tools.get('mochi_ppt_create').execute({
    title: '水循环课堂观察',
    slides: repeatedSlides,
    outputDirectory: join(root, 'v1'),
  });
  const firstManifest = JSON.parse(await readFile(first.产物.manifest, 'utf8'));
  const firstBytes = await readFile(first.产物.pptx);
  const firstHash = createHash('sha256').update(firstBytes).digest('hex');
  const inspected = await inspectPptxBuffer(firstBytes);
  assert.equal(firstManifest.quality.pptxSha256, firstHash);
  assert.equal(firstManifest.quality.pptxSha256, firstManifest.files.pptx.sha256);
  assert.equal(firstManifest.quality.deckVersion, 1);
  assert.equal(firstManifest.quality.actualOoxmlSlideCount, inspected.页数);
  assert.equal(firstManifest.quality.checkedSlideCount, inspected.检查页数);
  assert.ok(inspected.幻灯片.flatMap((slide) => slide.文字).some((shape) => shape.最小可见字号 !== null));
  assert.ok(inspected.幻灯片.flatMap((slide) => slide.文字).every((shape) => shape.可见文字未解析字号run数 === 0));
  assert.equal(firstManifest.quality.structuralStatus, 'passed');
  assert.deepEqual(firstManifest.quality.hints, ['第 1-3 页连续使用 title-body 版式，可考虑调整版式节奏']);
  assert.equal(firstManifest.quality.status, 'needs-visual-review');
  assert.equal(firstManifest.quality.visualReview.status, 'not-performed');
  assert.match(firstManifest.quality.visualReview.note, /美学或学科正确性已验收/u);
  assert.equal(first.预览状态, 'unavailable');
  assert.equal(first.质量状态, 'needs-visual-review');
  assert.equal(first.视觉复核, firstManifest.quality.visualReview.note);

  // A plausible maximum must not hide a tiny visible run. Mutate one actual
  // generated run in OOXML, then run the same quality gate over the inspection.
  const tinyZip = await JSZip.loadAsync(firstBytes);
  const slideXml = await tinyZip.file('ppt/slides/slide1.xml').async('string');
  let changedRun = false;
  const tinyXml = slideXml.replace(/(<a:rPr\b[^>]*\bsz=")\d+("[^>]*>)/u, (_match, before, after) => {
    changedRun = true;
    return `${before}700${after}`;
  });
  assert.equal(changedRun, true, 'generated slide should contain a visible run with explicit size');
  tinyZip.file('ppt/slides/slide1.xml', tinyXml);
  const tinyBytes = await tinyZip.generateAsync({ type: 'nodebuffer' });
  const tinyInspection = await inspectPptxBuffer(tinyBytes);
  const tinyShape = tinyInspection.幻灯片[0].文字.find((shape) => shape.已知最小可见字号 === 7);
  assert.ok(tinyShape, 'inspection should report the 7pt visible run');
  assert.ok(tinyShape.字号 >= 28, 'maximum font remains available for role inference');
  const tinyQuality = createQualityReport({
    input: JSON.parse(await readFile(first.sourcePath, 'utf8')),
    inspection: tinyInspection,
    pptxSha256: createHash('sha256').update(tinyBytes).digest('hex'),
  });
  assert.equal(tinyQuality.status, 'blocked');
  assert.ok(tinyQuality.hardErrors.some((message) => /含 7pt 可见文字/u.test(message)));

  const revised = await tools.get('mochi_ppt_revise').execute({
    previousSourcePath: first.sourcePath,
    page: 2,
    instruction: '修改标题',
    newTitle: '修订后的标题',
    outputDirectory: join(root, 'v2'),
  });
  const revisedManifest = JSON.parse(await readFile(revised.产物.manifest, 'utf8'));
  const revisedBytes = await readFile(revised.产物.pptx);
  const revisedHash = createHash('sha256').update(revisedBytes).digest('hex');
  const revisedInspection = await inspectPptxBuffer(revisedBytes);
  assert.notEqual(revisedHash, firstHash);
  assert.equal(revisedManifest.quality.pptxSha256, revisedHash);
  assert.equal(revisedManifest.quality.pptxSha256, revisedManifest.files.pptx.sha256);
  assert.equal(revisedManifest.quality.deckVersion, 2);
  assert.equal(revisedManifest.quality.actualOoxmlSlideCount, revisedInspection.页数);
  assert.equal(revised.质量状态, 'needs-visual-review');
  assert.equal(revised.预览状态, 'unavailable');
  assert.equal(revised.结构检查, 'passed');
});
