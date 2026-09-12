import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { demonstrationStructuredNotice } from '../demo.mjs';
import {
  DocumentIoError,
  editDocxDocument,
  probePdfExportEngine,
  readDocxStructure,
  readPdfStructure,
  readZipArchive,
  scanXmlElements,
} from '../document-io.mjs';
import { exportDocxToPdfFile, generateDocumentBundle, MochiDocumentsError } from '../index.mjs';

const UNZIP = '/usr/bin/unzip';

async function createRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-documents-io-test-'));
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

async function structuredBundle(root, document = demonstrationStructuredNotice()) {
  return generateDocumentBundle({ document, outputDirectory: join(root, 'bundle') });
}

function blockWithText(structure, needle) {
  const block = structure.blocks.find((candidate) => typeof candidate.text === 'string' && candidate.text.includes(needle));
  assert.ok(block, `expected a block containing ${needle}`);
  return block;
}

test('a generated DOCX is a real archive that the plugin reader and the system unzip both accept', { timeout: 30_000 }, async (t) => {
  const root = await createRoot(t);
  const bundle = await structuredBundle(root);
  const bytes = await readFile(bundle.docxPath);
  assert.deepEqual(bytes.subarray(0, 2), Buffer.from('PK'), 'DOCX must be a ZIP archive, not HTML or an image');

  const entries = readZipArchive(bytes);
  const names = entries.map((entry) => entry.name);
  assert.ok(names.includes('[Content_Types].xml'), 'a real OOXML package declares content types');
  assert.ok(names.includes('word/document.xml'), 'a real DOCX carries word/document.xml');
  assert.equal(names.some((name) => name.startsWith('word/media/')), false, 'no page-image substitutes are packaged');

  const structure = readDocxStructure(bytes);
  assert.equal(structure.tables, 1);
  assert.equal(
    structure.tables + structure.headings + structure.paragraphs + structure.lists,
    structure.blocks.length,
    'every block is classified exactly once',
  );
  blockWithText(structure, '二 演示安排表');
  const table = structure.blocks.find((block) => block.kind === 'table');
  assert.deepEqual(table.header, ['日期', '事项', '负责角色', '备注']);
  assert.deepEqual(table.rows[1], ['9月8日', '健康提醒发布', '班主任', '演示记录']);
  assert.equal(table.rows[2][3], '', 'a legitimately blank editable cell stays blank');

  if (existsSync(UNZIP)) {
    const listing = execFileSync(UNZIP, ['-t', bundle.docxPath], { encoding: 'utf8' });
    assert.match(listing, /No errors detected/);
    const documentXml = execFileSync(UNZIP, ['-p', bundle.docxPath, 'word/document.xml'], { encoding: 'utf8' });
    assert.match(documentXml, /<w:tbl(?:\s|>)/, 'the table must be a real Word table element');
    assert.match(documentXml, /健康提醒发布/);
    assert.match(documentXml, /<w:t xml:space="preserve">/);
  }
});

test('doc_read returns a structured model with paragraph text, style names, heading levels and tables', { timeout: 30_000 }, async (t) => {
  const root = await createRoot(t);
  const bundle = await structuredBundle(root);
  const structure = readDocxStructure(await readFile(bundle.docxPath));

  assert.equal(structure.title, '演示 校园秋季健康提醒');
  assert.deepEqual(
    structure.blocks.map((block) => block.index),
    structure.blocks.map((_, index) => index + 1),
    'block indices are the stable 1-based sequence doc_edit targets',
  );

  const title = structure.blocks[0];
  assert.equal(title.kind, 'heading');
  assert.equal(title.headingLevel, 'title');
  assert.equal(title.styleId, 'Title');

  const section = blockWithText(structure, '二 演示安排表');
  assert.equal(section.kind, 'heading');
  assert.equal(section.headingLevel, 1);
  assert.equal(section.styleId, 'Heading1');
  assert.equal(section.styleName, 'Heading 1');

  const paragraph = blockWithText(structure, '表格由真实 Word 表格元素生成');
  assert.equal(paragraph.kind, 'paragraph');
  assert.equal(paragraph.headingLevel, undefined);
  assert.equal(paragraph.styleId, 'Normal');
  assert.equal(paragraph.hasLineBreak, false);

  assert.equal(structure.imageCount, 0);
  assert.equal(structure.mediaFileCount, 0);
  assert.ok(structure.styleNameCount > 0, 'style names are read from word/styles.xml');
  assert.ok(structure.sectionCount >= 1);
});

test('doc_edit publishes a new version, preserves every other OOXML part byte-for-byte, and verifies by re-reading', { timeout: 30_000 }, async (t) => {
  const root = await createRoot(t);
  const bundle = await structuredBundle(root);
  const originalBytes = await readFile(bundle.docxPath);
  const before = readDocxStructure(originalBytes);
  const target = blockWithText(before, '表格由真实 Word 表格元素生成');

  const edited = editDocxDocument(originalBytes, {
    ops: [
      { op: 'replace_text', blockIndex: target.index, oldText: '表格由真实 Word 表格元素生成', newText: '表格由真实 Word 表格元素生成（已核对）' },
      { op: 'insert_paragraph', afterBlockIndex: target.index, text: '本节由 doc_edit 追加', headingLevel: 2 },
      { op: 'delete_block', blockIndex: blockWithText(before, '请由上游授权流程确认来源').index },
    ],
  });

  assert.equal(edited.verification.passed, true, JSON.stringify(edited.verification, null, 2));
  assert.equal(edited.verification.partsPreservedByteForByte, true);
  assert.equal(edited.verification.tablesUnchanged, true);
  assert.equal(edited.verification.documentXmlRewritten, true);
  assert.equal(edited.changes.length, 3);

  const outputDirectory = join(root, 'Mochi Documents', 'version-1');
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, 'document-edited.docx');
  await writeFile(outputPath, edited.buffer);

  const sourceBytes = await readFile(bundle.docxPath);
  assert.deepEqual(sourceBytes, originalBytes, 'the source document is never rewritten');
  assert.equal(readDocxStructure(sourceBytes).blocks.some((block) => block.text?.includes('已核对')), false);

  const published = await readFile(outputPath);
  assert.equal(published.length, edited.byteLength);
  const after = readDocxStructure(published);
  assert.ok(after.blocks.some((block) => block.text?.includes('（已核对）')));
  assert.ok(after.blocks.some((block) => block.text === '本节由 doc_edit 追加' && block.headingLevel === 2));
  assert.equal(after.blocks.some((block) => block.text?.includes('请由上游授权流程确认来源')), false);
  assert.deepEqual(
    after.blocks.filter((block) => block.kind === 'table').map((block) => block.rows),
    before.blocks.filter((block) => block.kind === 'table').map((block) => block.rows),
    'tables are not re-laid-out',
  );
  const untouchedBefore = before.blocks
    .filter((block) => block.kind !== 'table' && block.index !== target.index)
    .filter((block) => !block.text.includes('请由上游授权流程确认来源'))
    .map((block) => block.text);
  const untouchedAfter = after.blocks.filter((block) => block.kind !== 'table').map((block) => block.text);
  for (const text of untouchedBefore) {
    assert.ok(untouchedAfter.includes(text), `untouched paragraph must survive verbatim: ${text.slice(0, 30)}`);
  }

  const originalEntries = readZipArchive(originalBytes);
  const publishedEntries = readZipArchive(published);
  for (const entry of originalEntries) {
    if (entry.name === 'word/document.xml') continue;
    const rePublished = publishedEntries.find((candidate) => candidate.name === entry.name);
    assert.ok(rePublished, `${entry.name} must still exist`);
    assert.deepEqual(rePublished.raw, entry.raw, `${entry.name} must keep its original compressed bytes`);
  }

  if (existsSync(UNZIP)) {
    assert.match(execFileSync(UNZIP, ['-t', outputPath], { encoding: 'utf8' }), /No errors detected/);
    const documentXml = execFileSync(UNZIP, ['-p', outputPath, 'word/document.xml'], { encoding: 'utf8' });
    assert.match(documentXml, /（已核对）/);
    assert.doesNotMatch(documentXml, /请由上游授权流程确认来源/);
  }
});

test('doc_edit refuses unmatched, table and unknown edits instead of publishing a silent rewrite', { timeout: 30_000 }, async (t) => {
  const root = await createRoot(t);
  const bundle = await structuredBundle(root);
  const bytes = await readFile(bundle.docxPath);
  const before = readDocxStructure(bytes);
  const table = before.blocks.find((block) => block.kind === 'table');

  assert.throws(
    () => editDocxDocument(bytes, { ops: [{ op: 'replace_text', blockIndex: 2, oldText: '不存在的短语', newText: 'x' }] }),
    (error) => error instanceof DocumentIoError && error.code === 'EDIT_TEXT_NOT_FOUND',
  );
  assert.throws(
    () => editDocxDocument(bytes, { ops: [{ op: 'set_block_text', blockIndex: table.index, text: '想改表格' }] }),
    (error) => error instanceof DocumentIoError && error.code === 'EDIT_TABLE_UNSUPPORTED',
  );
  assert.throws(
    () => editDocxDocument(bytes, { ops: [{ op: 'reflow_document' }] }),
    (error) => error instanceof DocumentIoError && error.code === 'EDIT_OP_INVALID',
  );
  assert.throws(
    () => editDocxDocument(bytes, { ops: [{ op: 'delete_block', blockIndex: 999 }] }),
    (error) => error instanceof DocumentIoError && error.code === 'EDIT_BLOCK_NOT_FOUND',
  );
  assert.throws(() => editDocxDocument(bytes, { ops: [] }), (error) => error.code === 'EDIT_OP_INVALID');
});

test('the ZIP scanner and reader agree on real OOXML nesting', () => {
  const fragment = '<w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>甲</w:t></w:r></w:p>'
    + '<!-- a comment with <w:p> inside --><w:tbl><w:tr><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:sectPr/></w:body>';
  const elements = scanXmlElements(fragment.slice('<w:body>'.length, -'</w:body>'.length));
  assert.deepEqual(elements.map((element) => element.name), ['w:p', 'w:tbl', 'w:sectPr']);
  assert.match(elements[0].xml, /Heading1/);
  assert.match(elements[1].xml, /乙/);
});

test('pdf_read extracts real per-page text from a generated PDF and honours an explicit page range', { timeout: 30_000 }, async (t) => {
  const root = await createRoot(t);
  const bundle = await structuredBundle(root);
  const structure = await readPdfStructure(await readFile(bundle.pdfPath));

  assert.equal(structure.pageCount, 3);
  assert.equal(structure.pages.length, 3);
  assert.equal(structure.textExtraction.available, true);
  assert.match(structure.textExtraction.method, /ToUnicode/);
  for (const page of structure.pages) {
    assert.equal(page.width, 595.28);
    assert.equal(page.height, 841.89);
    assert.equal(page.extraction, 'tounicode');
  }
  assert.match(structure.pages[0].text, /演示安排表|事项说明/);
  assert.match(structure.pages[1].text, /健康提醒发布/);
  assert.match(structure.documentText, /表格由真实 Word 表格元素生成/);
  assert.equal(structure.metadata.creator, 'Mochi Documents');

  const ranged = await readPdfStructure(await readFile(bundle.pdfPath), { pageRange: '2-3' });
  assert.equal(ranged.pageCount, 3, 'the document total is still reported');
  assert.deepEqual(ranged.pages.map((page) => page.page), [2, 3]);
  assert.deepEqual(ranged.pageRange, [2, 3]);
  assert.doesNotMatch(ranged.pages[0].text, /事项说明/);

  const bundleBytes = await readFile(bundle.pdfPath);
  await assert.rejects(
    () => readPdfStructure(bundleBytes, { pageRange: '9' }),
    (error) => error instanceof DocumentIoError && error.code === 'PDF_PAGE_RANGE_INVALID',
  );
  await assert.rejects(
    () => readPdfStructure(Buffer.from('not a pdf at all')),
    (error) => error instanceof DocumentIoError && error.code === 'PDF_UNREADABLE',
  );
});

test('pdf_read degrades honestly when the PDF fonts carry no ToUnicode text map', async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([300, 200]);
  page.drawText('Caf\u00e9 cr\u00e8me \u00df', { x: 20, y: 150, size: 12, font });
  const bytes = await document.save();

  const structure = await readPdfStructure(bytes);
  assert.equal(structure.pageCount, 1, 'page structure is still reported without a text map');
  assert.deepEqual([structure.pages[0].width, structure.pages[0].height], [300, 200]);
  assert.equal(structure.textExtraction.available, false);
  assert.equal(structure.pages[0].extraction, 'unavailable');
  assert.deepEqual(structure.textExtraction.pagesWithoutText, [1]);
  assert.match(structure.textExtraction.reason, /没有可用的 PDF 文本抽取能力/);
  assert.match(structure.textExtraction.reason, /不做 OCR/);
  assert.equal(structure.documentText, undefined, 'no fabricated or empty-looking text is returned');
  assert.ok(structure.pages[0].text.length > 0 && structure.pages[0].text.includes('\uFFFD'));
});

test('pdf_read decodes plain ASCII text even without a text map, and says which path it used', async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([300, 200]);
  page.drawText('Plain ASCII only', { x: 20, y: 150, size: 12, font });
  const structure = await readPdfStructure(await document.save());
  assert.equal(structure.textExtraction.available, true);
  assert.equal(structure.pages[0].extraction, 'ascii-during-missing-tounicode');
  assert.equal(structure.pages[0].text, 'Plain ASCII only');
  assert.match(structure.textExtraction.boundary, /纯 ASCII/);
});

test('doc_export reports a missing export engine instead of fabricating a PDF', { timeout: 30_000 }, async (t) => {
  const root = await createRoot(t);
  const bundle = await structuredBundle(root);
  const outputDirectory = join(root, 'export-target');
  await mkdir(outputDirectory);

  await assert.rejects(
    () => exportDocxToPdfFile({
      docxPath: bundle.docxPath,
      outputDirectory,
      sofficePath: join(root, 'no-such-soffice'),
      timeoutMs: 1_000,
    }),
    (error) => error instanceof MochiDocumentsError && error.code === 'CONVERTER_MISSING',
  );
  assert.deepEqual(await readdir(outputDirectory), [], 'no placeholder or fake PDF is left behind');

  const probe = await probePdfExportEngine({ candidates: [join(root, 'no-such-soffice')], searchPath: false });
  assert.equal(probe.available, false);
  assert.equal(probe.engine, undefined);
  assert.deepEqual(probe.probed, [{ path: join(root, 'no-such-soffice'), available: false }]);
});

test('doc_export produces a real PDF with the local engine when one is present', { timeout: 120_000 }, async (t) => {
  const root = await createRoot(t);
  const probe = await probePdfExportEngine();
  if (!probe.available) {
    t.skip('本机没有 LibreOffice/soffice 导出引擎；已通过上一个用例验证如实报错路径。');
    return;
  }
  const bundle = await structuredBundle(root);
  const outputDirectory = join(root, 'export-target');
  await mkdir(outputDirectory);
  const exported = await exportDocxToPdfFile({
    docxPath: bundle.docxPath,
    outputDirectory,
    sofficePath: probe.engine,
    timeoutMs: 90_000,
  });

  assert.equal(exported.engine, probe.engine);
  assert.ok(exported.pageCount >= 1);
  const onDisk = await readFile(exported.pdfPath);
  assert.equal(onDisk.length, exported.bytes, 'the reported byte count is the real file size');
  assert.deepEqual(onDisk.subarray(0, 5), Buffer.from('%PDF-'), 'the export is a real PDF, not HTML or an image');

  const structure = await readPdfStructure(onDisk);
  assert.equal(structure.textExtraction.available, true);
  assert.match(structure.documentText, /健康提醒发布/);
});

test('an edited DOCX reopens as a readable structure after a round trip through the archive writer', { timeout: 30_000 }, async (t) => {
  const root = await createRoot(t);
  const bundle = await structuredBundle(root);
  const bytes = await readFile(bundle.docxPath);
  const before = readDocxStructure(bytes);
  const edited = editDocxDocument(bytes, { ops: [{ op: 'set_block_text', blockIndex: 1, text: '替换后的标题' }] });
  const after = readDocxStructure(edited.buffer);
  assert.equal(after.blocks[0].text, '替换后的标题');
  assert.equal(after.blocks[0].styleId, before.blocks[0].styleId, 'paragraph properties are preserved');
  assert.equal(edited.verification.passed, true);
  assert.equal(edited.sha256.length, 64);
  assert.equal(await exists(join(root, 'never-created')), false);
});
