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

// 回归：数字/空格与拉丁字母同处一行时，fontkit 会按脚本挑 cmap 子表，把数字换成
// **没有 ToUnicode 映射**的替换字形（'1' -> glyph 30560，而 CMap 里只有 glyph 18 -> '1'）。
// 结果是画面正常、文字层乱码，并且让 mochi-presentations 的整册完整性校验直接判失败。
// 下面这些句子都是真实课件里会出现的形态，必须逐字抽得回来。
test('mixed Chinese/Latin/digit lines survive text extraction glyph for glyph', async () => {
  const cases = [
    '1  Mochi 校验第 1 页',
    '第 3 单元 Unit 3 Reading',
    '82% 的校园用水浪费发生在洗手环节',
    '42 students 参加 3 次活动',
    'PPT 的制作要 3 步',
    '用 JSXGraph 画圆锥曲线',
    'AI 与 教学',
    '第 1 页',
    '5 个步骤 3 分钟完成',
  ];
  const { pdfDocument, font } = await createPdfLayoutDocument({ title: '混排回归' });
  const page = pdfDocument.addPage(A4_PAGE_SIZE);
  let top = 800;
  for (const line of cases) {
    drawTextBlock({ page, text: line, x: 48, top, width: 480, font, size: 13, lineHeight: 18 });
    top -= 40;
  }
  const bytes = await savePdfLayoutDocument(pdfDocument);
  const inspection = await inspectPdfArtifact(bytes, { expectedPageCount: 1, requiredText: cases });
  assert.equal(inspection.embeddedFont, true);
  // 每一行都要原样落在同一行里：空格不能被拆成换行，也不能多出空格。
  for (const line of cases) assert.ok(inspection.searchableText.includes(line), `应逐字抽回：${line}`);
});
