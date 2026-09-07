import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sichuan2026ExamDemonstration } from '../fixtures/sichuan-2026-exam-demo.mjs';
import { generateDocumentBundle, MochiDocumentsError, validateStructuredDocument } from '../index.mjs';

const PDFINFO = process.env.MOCHI_DOCUMENTS_PDFINFO
  ?? '/Users/a1379/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/bin/pdfinfo';
const PDFTOTEXT = process.env.MOCHI_DOCUMENTS_PDFTOTEXT
  ?? '/Users/a1379/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/pdftotext';
const PDFFONTS = process.env.MOCHI_DOCUMENTS_PDFFONTS
  ?? '/Users/a1379/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/pdffonts';

async function createTestRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-exam-template-test-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
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

function runText(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', rejectRun);
    child.once('close', (code) => {
      if (code === 0) resolveRun(Buffer.concat(stdout).toString('utf8'));
      else rejectRun(new Error(`utility failed with exit ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
    });
  });
}

function assertInvalid(document) {
  assert.throws(
    () => validateStructuredDocument(document),
    (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT',
  );
}

test('Sichuan 2026 target template produces editable A4 Word structures, a wrapped question, and a readable PDF', { timeout: 120_000 }, async (t) => {
  const root = await createTestRoot(t);
  const bundle = await generateDocumentBundle({
    document: sichuan2026ExamDemonstration(),
    outputDirectory: join(root, 'sichuan-2026-target'),
  });

  const [documentXml, footerXml, archiveListing, pdfInfo, pdfText, pdfFonts, questions, checklist, manifest] = await Promise.all([
    runText('/usr/bin/unzip', ['-p', bundle.docxPath, 'word/document.xml']),
    runText('/usr/bin/unzip', ['-p', bundle.docxPath, 'word/footer1.xml']),
    runText('/usr/bin/unzip', ['-l', bundle.docxPath]),
    runText(PDFINFO, [bundle.pdfPath]),
    runText(PDFTOTEXT, [bundle.pdfPath, '-']),
    runText(PDFFONTS, [bundle.pdfPath]),
    readFile(bundle.questionsPath, 'utf8').then(JSON.parse),
    readFile(bundle.checklistPath, 'utf8').then(JSON.parse),
    readFile(bundle.manifestPath, 'utf8').then(JSON.parse),
  ]);

  assert.match(documentXml, /<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/, 'the DOCX must declare A4 page dimensions');
  assert.match(documentXml, /<w:pgMar[^>]*w:gutter="600"/, 'the binding gutter must be a declared product parameter');
  assert.match(documentXml, /w:sz w:val="24"/, 'the body must declare 12 pt Word text');
  assert.match(documentXml, /w:line="410" w:lineRule="atLeast"/, 'question paragraphs must use an explicit minimum 20.5 pt line height');
  assert.match(documentXml, /w:eastAsia="Songti SC"/, 'Chinese text must explicitly request the verified Songti family');
  assert.match(documentXml, /w:ascii="Times New Roman"/, 'Latin text must explicitly request the verified serif family');
  assert.match(documentXml, /<m:f(?:\s|>)/, 'fraction must remain native OMML instead of an image');
  assert.match(documentXml, /<m:rad(?:\s|>)/, 'root must remain native OMML instead of an image');
  assert.match(documentXml, /<m:sSup(?:\s|>)/, 'math superscript must remain native OMML');
  assert.match(documentXml, /<m:sSub(?:\s|>)/, 'math subscript must remain native OMML');
  assert.match(documentXml, /w:vertAlign w:val="subscript"/, 'chemical subscript must remain a Word run property');
  assert.match(documentXml, /w:vertAlign w:val="superscript"/, 'chemical superscript must remain a Word run property');
  assert.match(documentXml, /<m:t>v-t<\/m:t>/, 'physical quantity variables must remain in the native math run');
  const uprightUnitRun = documentXml.match(/<w:r>(?:(?!<\/w:r>).)*<w:t[^>]*>m·s<\/w:t>(?:(?!<\/w:r>).)*<\/w:r>/s);
  assert.ok(uprightUnitRun, 'the SI unit base must remain an ordinary Word run');
  assert.match(uprightUnitRun[0], /<w:i w:val="false"\/>/, 'the SI unit base must be explicitly upright');
  assert.match(documentXml, /<w:tbl(?:\s|>)/, 'answer areas must be real editable Word tables');
  assert.match(footerXml, /PAGE/, 'the footer must contain a dynamic page-number field');
  assert.doesNotMatch(archiveListing, /word\/media\//, 'the module must not substitute page images for editable content');

  assert.match(pdfInfo, /^Pages:\s+1$/m, 'the generated PDF must be a valid one-page A4 preview for the fixture');
  assert.match(pdfInfo, /^Page size:\s+595\./m, 'the PDF must preserve A4 geometry');
  assert.match(pdfText, /H2SO4/, 'chemical text must remain searchable in the PDF');
  assert.match(pdfText, /完整写出定义域/, 'the deliberate multi-line question prompt must remain editable/searchable text');
  assert.match(pdfText, /m·s/, 'the SI unit base must remain searchable in the PDF');
  assert.match(pdfText, /Read the passage and choose the best answer\./, 'English body text must remain searchable in the PDF');
  assert.match(pdfText, /ω/, 'the physics Greek letter must remain present in the PDF');
  assert.match(pdfFonts, /STSongti/, 'the PDF must embed a CJK-capable Songti font');
  assert.match(pdfFonts, /TimesNewRoman/, 'the PDF must embed the required Latin serif font');

  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.template.kind, 'sichuan-2026-high-school-exam-base');
  assert.equal(manifest.template.targetRegion, 'Sichuan');
  assert.equal(manifest.template.targetExamYear, 2026);
  assert.equal(manifest.template.officialSampleStatus, 'pending-review');
  assert.equal(manifest.template.standardStatus, 'electronic-typography-support-only');
  assert.equal(manifest.template.layout.bodyFontSizePt, 12);
  assert.equal(manifest.template.layout.noteFontSizePt, 9);
  assert.equal(manifest.template.layout.minimumLineHeightTwips, 410);
  assert.equal(manifest.template.layout.minimumLineHeightPt, 20.5);
  assert.equal(manifest.template.layout.minimumAdditionalLeadingPt, 8.5);
  assert.equal(manifest.template.layout.lineHeightRule, 'atLeast');
  assert.equal(manifest.template.layout.bindingGutterDxa, 600);
  assert.equal(manifest.sourcePageCount, 1);
  assert.equal(manifest.pdfPageCount, 1);
  assert.equal(manifest.examQuestionCount, 4);
  assert.equal(manifest.fontAvailability.replacementApplied, false);
  assert.deepEqual(manifest.fontAvailability.requiredFonts.map((font) => [font.family, font.available]), [
    ['Songti SC', true],
    ['Times New Roman', true],
  ]);
  assert.equal(questions.template.officialSampleStatus, 'pending-review');
  assert.equal(checklist.checks.find((check) => check.id === 'exam-template-target')?.status, 'attention');
  assert.equal(checklist.checks.find((check) => check.id === 'exam-print-verification')?.status, 'attention');
});

test('exam template rejects raw LaTeX, unsupported formula nodes, image substitutes, and unsupported chemistry arrows', async (t) => {
  const root = await createTestRoot(t);
  const latex = sichuan2026ExamDemonstration();
  latex.exam.sections[0].questions[0].prompt = [{
    kind: 'math',
    expression: [{ kind: 'text', text: String.raw`\frac{1}{2}` }],
  }];
  assertInvalid(latex);

  const unsupportedMath = sichuan2026ExamDemonstration();
  unsupportedMath.exam.sections[0].questions[0].prompt = [{
    kind: 'math',
    expression: [{ kind: 'matrix', rows: [] }],
  }];
  assertInvalid(unsupportedMath);

  const imageSubstitute = sichuan2026ExamDemonstration();
  imageSubstitute.exam.sections[0].questions[0].prompt = [{ kind: 'image', data: 'not-accepted' }];
  assertInvalid(imageSubstitute);

  const unsupportedArrow = sichuan2026ExamDemonstration();
  unsupportedArrow.exam.sections[1].questions[0].prompt = [{
    kind: 'chemistry',
    tokens: [{ kind: 'arrow', direction: 'backward' }],
  }];
  assertInvalid(unsupportedArrow);

  const unsupportedUnit = sichuan2026ExamDemonstration();
  unsupportedUnit.exam.sections[1].questions[1].prompt = [{ kind: 'upright-unit', text: 'm^2' }];
  assertInvalid(unsupportedUnit);

  const outputDirectory = join(root, 'invalid-formula-must-not-publish');
  await assert.rejects(
    () => generateDocumentBundle({ document: latex, outputDirectory }),
    (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT',
  );
  assert.equal(await exists(outputDirectory), false, 'invalid input must not reserve or publish an output directory');
});
