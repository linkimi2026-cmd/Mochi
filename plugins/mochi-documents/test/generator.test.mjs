import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectPdfArtifact } from '@mochi/pdf-layout';
import { demonstrationStructuredNotice } from '../demo.mjs';
import { readZipArchive, zipEntryText } from '../document-io.mjs';
import { generateDocumentBundle, MochiDocumentsError, validateStructuredDocument } from '../index.mjs';

async function createTestRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-documents-test-'));
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

async function assertRejectsCode(operation, code) {
  await assert.rejects(operation, (error) => error instanceof MochiDocumentsError && error.code === code);
}

// JSZip stays a devDependency but is not linked in this checkout's production
// install, so the suite opens DOCX with the plugin's own zero-dependency ZIP
// reader instead. `test/document-io.test.mjs` cross-checks that reader against
// the system `unzip` binary.
async function editableDocument(path) {
  const entries = readZipArchive(await readFile(path));
  return {
    documentXml: zipEntryText(entries.find((entry) => entry.name === 'word/document.xml')),
    names: entries.map((entry) => entry.name),
  };
}

test('ordinary structured input creates an editable DOCX and searchable embedded-font PDF without an Office process', { timeout: 30_000 }, async (t) => {
  const root = await createTestRoot(t);
  const bundle = await generateDocumentBundle({
    document: demonstrationStructuredNotice(),
    outputDirectory: join(root, 'demonstration-bundle'),
    converter: { sofficePath: join(root, 'not-present-soffice'), timeoutMs: 100 },
  });

  const [{ documentXml, names }, pdfBytes, questions, checklist, manifest] = await Promise.all([
    editableDocument(bundle.docxPath),
    readFile(bundle.pdfPath),
    readFile(bundle.questionsPath, 'utf8').then(JSON.parse),
    readFile(bundle.checklistPath, 'utf8').then(JSON.parse),
    readFile(bundle.manifestPath, 'utf8').then(JSON.parse),
  ]);
  assert.match(documentXml, /<w:tbl(?:\s|>)/, 'DOCX must contain a real editable Word table');
  assert.match(documentXml, /演示安排表/, 'DOCX body text must remain editable');
  assert.match(documentXml, /待核对事项/, 'every structured source page must remain in the DOCX');
  assert.match(documentXml, /w:eastAsia="Noto Sans SC"/, 'ordinary DOCX must request the bundled cross-platform font family');
  assert.equal(names.some((name) => name.startsWith('word/media/')), false, 'DOCX must not contain page-image substitutes');

  const inspection = await inspectPdfArtifact(pdfBytes, {
    expectedPageCount: 3,
    requiredText: ['演示安排表', '健康提醒发布', '表格由真实 Word 表格元素生成', '待核对事项'],
  });
  assert.equal(inspection.embeddedFont, true);
  assert.equal(inspection.imageCount, 0, 'PDF must carry text and table primitives rather than page screenshots');
  assert.equal(questions.sourceKind, 'demonstration');
  assert.deepEqual(questions.questions.map((question) => question.source.kind), ['normalized-region', 'unknown']);
  assert.equal(checklist.checks.find((check) => check.id === 'editable-docx')?.status, 'passed');
  assert.equal(checklist.checks.find((check) => check.id === 'pdf-from-structured-input')?.status, 'passed');
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.sourcePageCount, 3);
  assert.equal(manifest.pdfPageCount, 3);
  assert.equal(manifest.files.docx.editable, true);
});

test('input bounds reject malformed structures while preserving a legitimate blank table cell', async (t) => {
  const root = await createTestRoot(t);
  const missingOutput = join(root, 'missing-input');
  await assertRejectsCode(
    () => generateDocumentBundle({ document: undefined, outputDirectory: missingOutput }),
    'INVALID_INPUT',
  );
  assert.equal(await exists(missingOutput), false);

  const withBlankCell = validateStructuredDocument(demonstrationStructuredNotice());
  assert.equal(withBlankCell.pages[1].blocks[1].rows[1][3], '', 'empty editable table cells must remain empty');

  const malformed = demonstrationStructuredNotice();
  malformed.pages[1].blocks[1].rows[0].push('unexpected extra cell');
  assert.throws(() => validateStructuredDocument(malformed), (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT');

  const invalidDoubt = demonstrationStructuredNotice();
  invalidDoubt.doubts[0].source.width = 0;
  assert.throws(() => validateStructuredDocument(invalidDoubt), (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT');

  const nonArrayDoubts = demonstrationStructuredNotice();
  nonArrayDoubts.doubts = {};
  assert.throws(() => validateStructuredDocument(nonArrayDoubts), (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT');

  const tooManyPages = demonstrationStructuredNotice();
  tooManyPages.pages = Array.from({ length: 51 }, () => ({ blocks: [{ kind: 'paragraph', text: 'bounded' }] }));
  assert.throws(() => validateStructuredDocument(tooManyPages), (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT');

  const tooManyBlocks = demonstrationStructuredNotice();
  tooManyBlocks.pages[0].blocks = Array.from({ length: 101 }, () => ({ kind: 'paragraph', text: 'bounded' }));
  assert.throws(() => validateStructuredDocument(tooManyBlocks), (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT');

  const tooManyColumns = demonstrationStructuredNotice();
  tooManyColumns.pages[1].blocks[1].columns = Array.from({ length: 31 }, (_, index) => `column-${index}`);
  assert.throws(() => validateStructuredDocument(tooManyColumns), (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT');

  const tooManyRows = demonstrationStructuredNotice();
  tooManyRows.pages[1].blocks[1].rows = Array.from({ length: 301 }, () => ['a', 'b', 'c', 'd']);
  assert.throws(() => validateStructuredDocument(tooManyRows), (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT');

  const tooManyDoubts = demonstrationStructuredNotice();
  tooManyDoubts.doubts = Array.from({ length: 501 }, () => ({ question: 'bounded', source: { kind: 'unknown' } }));
  assert.throws(() => validateStructuredDocument(tooManyDoubts), (error) => error instanceof MochiDocumentsError && error.code === 'INVALID_INPUT');
});

test('ordinary PDF cancellation does not reserve or publish an output directory', async (t) => {
  const root = await createTestRoot(t);
  const outputDirectory = join(root, 'cancelled');
  const controller = new AbortController();
  controller.abort();
  await assertRejectsCode(
    () => generateDocumentBundle({ document: demonstrationStructuredNotice(), outputDirectory, signal: controller.signal }),
    'ABORTED',
  );
  assert.equal(await exists(outputDirectory), false);
});

test('manifest distinguishes structured source pages from direct PDF pagination', { timeout: 30_000 }, async (t) => {
  const root = await createTestRoot(t);
  const longDocument = demonstrationStructuredNotice();
  longDocument.pages = [{
    blocks: [{ kind: 'paragraph', text: '教师核对可编辑正文。'.repeat(1_000) }],
  }];
  longDocument.doubts = [];
  const bundle = await generateDocumentBundle({
    document: longDocument,
    outputDirectory: join(root, 'long-document'),
  });
  const manifest = JSON.parse(await readFile(bundle.manifestPath, 'utf8'));
  assert.equal(manifest.sourcePageCount, 1);
  assert.ok(manifest.pdfPageCount > manifest.sourcePageCount, 'PDF pagination must come from actual direct layout, not source blocks');
});

test('a repeated output target is never overwritten', { timeout: 30_000 }, async (t) => {
  const root = await createTestRoot(t);
  const outputDirectory = join(root, 'non-overwrite-target');
  const first = await generateDocumentBundle({ document: demonstrationStructuredNotice(), outputDirectory });
  const originalDocx = await readFile(first.docxPath);

  await assertRejectsCode(
    () => generateDocumentBundle({ document: demonstrationStructuredNotice(), outputDirectory }),
    'OUTPUT_EXISTS',
  );
  assert.deepEqual(await readFile(first.docxPath), originalDocx);
  assert.equal(JSON.parse(await readFile(first.manifestPath, 'utf8')).status, 'completed');
});

test('an existing empty directory and concurrent requests never claim or overwrite the same target', { timeout: 30_000 }, async (t) => {
  const root = await createTestRoot(t);
  const existingTarget = join(root, 'existing-empty-target');
  await mkdir(existingTarget);
  await assertRejectsCode(
    () => generateDocumentBundle({ document: demonstrationStructuredNotice(), outputDirectory: existingTarget }),
    'OUTPUT_EXISTS',
  );
  assert.equal(await exists(existingTarget), true);

  const concurrentTarget = join(root, 'concurrent-target');
  const results = await Promise.allSettled([
    generateDocumentBundle({ document: demonstrationStructuredNotice(), outputDirectory: concurrentTarget }),
    generateDocumentBundle({ document: demonstrationStructuredNotice(), outputDirectory: concurrentTarget }),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof MochiDocumentsError && rejected[0].reason.code === 'OUTPUT_EXISTS');
  assert.equal(await exists(join(concurrentTarget, 'document.docx')), true);
  assert.equal(JSON.parse(await readFile(join(concurrentTarget, 'manifest.json'), 'utf8')).status, 'completed');
});
