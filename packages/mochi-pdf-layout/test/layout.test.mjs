import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import fontkit from '@pdf-lib/fontkit';

import {
  A4_PAGE_SIZE,
  color,
  createPdfLayoutDocument,
  drawTable,
  drawTextBlock,
  inspectPdfArtifact,
  layoutTable,
  savePdfLayoutDocument,
  wrapText,
} from '../index.mjs';

test('bundles the verified static Regular Noto Sans SC font', async () => {
  const font = fontkit.create(await readFile(new URL('../assets/fonts/NotoSansSC-Regular.ttf', import.meta.url)));
  assert.equal(font.familyName, 'Noto Sans SC');
  assert.equal(font.postscriptName, 'NotoSansSC-Regular');
  assert.equal(font['OS/2'].usWeightClass, 400);
  assert.deepEqual(font.variationAxes, {});
});

test('uses an embedded Unicode font and verifies actual searchable table text without an external process', async () => {
  const { pdfDocument, font } = await createPdfLayoutDocument({ title: '布局验证', subject: '纯 JS PDF' });
  const page = pdfDocument.addPage(A4_PAGE_SIZE);
  const lines = wrapText({ text: '中文文本需要真实嵌入字体。', font, size: 14, maxWidth: 120 });
  assert.ok(lines.length > 1, 'measurement must wrap constrained CJK text');
  drawTextBlock({ page, text: '中文文本需要真实嵌入字体。', x: 48, top: 780, width: 260, font, size: 14 });
  const table = layoutTable({
    table: { headers: ['项目', '说明'], rows: [['表格内容', '不是截图']] },
    width: 360,
    font,
    size: 12,
  });
  drawTable({ page, table, x: 48, top: 700, font, border: color('9BAF9F') });
  const bytes = await savePdfLayoutDocument(pdfDocument);
  const inspection = await inspectPdfArtifact(bytes, {
    expectedPageCount: 1,
    requiredText: ['中文文本需要真实嵌入字体。', '项目', '表格内容', '不是截图'],
  });
  assert.equal(inspection.embeddedFont, true);
  assert.equal(inspection.imageCount, 0);
});
