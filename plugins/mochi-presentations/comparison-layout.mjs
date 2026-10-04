const STAGE_X = 0.8;
const STAGE_WIDTH = 11.73;
const COLUMN_GAP = 0.28;
const HEADER_HEIGHT = 0.58;
const ROW_GAP = 0.08;
const CELL_FONT_SIZE = 17;
const CELL_LINE_HEIGHT = 1.28;

function displayUnits(value) {
  return Array.from(value).reduce((total, character) => total + (/\s/u.test(character) ? 0.35 : character.codePointAt(0) <= 0x7f ? 0.55 : 1), 0);
}

function boundedText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n]/u.test(value)) {
    throw new Error(`${label}必须为1-${max}字单行文本`);
  }
  return value.trim();
}

function wrappedLines(value, unitsPerLine) {
  return Math.max(1, Math.ceil(displayUnits(value) / unitsPerLine));
}

/** Two aligned columns of short, editable statements; no inferred or decorative data. */
export function validateComparison(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('comparison必须是左右两列对象');
  const leftTitle = boundedText(value.leftTitle, 40, 'comparison.leftTitle');
  const rightTitle = boundedText(value.rightTitle, 40, 'comparison.rightTitle');
  if (displayUnits(leftTitle) > 30 || displayUnits(rightTitle) > 30) throw new Error('comparison列标题超过投影宽度');
  if (!Array.isArray(value.rows) || value.rows.length < 2 || value.rows.length > 4) throw new Error('comparison.rows需要2-4组对应内容');
  const rows = value.rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`comparison.rows[${index}]必须是左右内容对象`);
    const left = boundedText(row.left, 100, `comparison.rows[${index}].left`);
    const right = boundedText(row.right, 100, `comparison.rows[${index}].right`);
    if (wrappedLines(left, 21) > 2 || wrappedLines(right, 21) > 2) throw new Error(`comparison.rows[${index}]超过单元格两行投影预算`);
    return { left, right };
  });
  return { leftTitle, rightTitle, rows };
}

export function comparisonScene(comparison, plan) {
  const columnWidth = (STAGE_WIDTH - COLUMN_GAP) / 2;
  const rowHeight = (plan.contentHeight - HEADER_HEIGHT - ROW_GAP * (comparison.rows.length - 1)) / comparison.rows.length;
  return {
    columns: [
      { x: STAGE_X, width: columnWidth, title: comparison.leftTitle, field: 'left' },
      { x: STAGE_X + columnWidth + COLUMN_GAP, width: columnWidth, title: comparison.rightTitle, field: 'right' },
    ],
    top: plan.contentY,
    headerHeight: HEADER_HEIGHT,
    rowHeight,
    rowGap: ROW_GAP,
    rows: comparison.rows,
  };
}

export function drawComparisonPptx(slide, comparison, plan, theme, fontFace) {
  const scene = comparisonScene(comparison, plan);
  for (const column of scene.columns) {
    slide.addShape('rect', { x: column.x, y: scene.top, w: column.width, h: scene.headerHeight, fill: { color: theme.surface }, line: { color: theme.rule, width: 1 } });
    slide.addShape('rect', { x: column.x, y: scene.top, w: 0.08, h: scene.headerHeight, fill: { color: theme.primary }, line: { color: theme.primary, transparency: 100 } });
    slide.addText(column.title, { x: column.x + 0.22, y: scene.top + 0.08, w: column.width - 0.4, h: scene.headerHeight - 0.16, fontFace, fontSize: 20, bold: true, color: theme.primary, margin: 0, valign: 'mid', lang: 'zh-CN' });
  }
  scene.rows.forEach((row, rowIndex) => {
    const y = scene.top + scene.headerHeight + rowIndex * (scene.rowHeight + scene.rowGap);
    for (const column of scene.columns) {
      slide.addShape('rect', { x: column.x, y, w: column.width, h: scene.rowHeight, fill: { color: theme.surface }, line: { color: theme.rule, width: 0.8 } });
      slide.addText(row[column.field], { x: column.x + 0.18, y: y + 0.1, w: column.width - 0.36, h: scene.rowHeight - 0.2, fontFace, fontSize: CELL_FONT_SIZE, color: theme.text, margin: 0, valign: 'mid', breakLine: false, lang: 'zh-CN' });
    }
  });
}

export function drawComparisonPdf({ page, comparison, plan, theme, font, pdfColor, fromTop, drawAlignedLines, fittedText, pdfIn }) {
  const scene = comparisonScene(comparison, plan);
  for (const column of scene.columns) {
    page.drawRectangle({ x: column.x * pdfIn, y: fromTop(scene.top + scene.headerHeight), width: column.width * pdfIn, height: scene.headerHeight * pdfIn, color: pdfColor(theme.surface), borderColor: pdfColor(theme.rule), borderWidth: 1 });
    page.drawRectangle({ x: column.x * pdfIn, y: fromTop(scene.top + 0.08), width: 0.08 * pdfIn, height: (scene.headerHeight - 0.16) * pdfIn, color: pdfColor(theme.primary) });
    const title = fittedText([column.title], font, { width: (column.width - 0.4) * pdfIn, maximumHeight: (scene.headerHeight - 0.14) * pdfIn, preferredSize: 20, minimumSize: 14, lineHeightFactor: 1.2 });
    drawAlignedLines({ page, lines: title.wrapped, x: (column.x + 0.22) * pdfIn, top: fromTop(scene.top + 0.12), font, size: title.size, lineHeight: title.lineHeight, fill: pdfColor(theme.primary) });
  }
  scene.rows.forEach((row, rowIndex) => {
    const y = scene.top + scene.headerHeight + rowIndex * (scene.rowHeight + scene.rowGap);
    for (const column of scene.columns) {
      page.drawRectangle({ x: column.x * pdfIn, y: fromTop(y + scene.rowHeight), width: column.width * pdfIn, height: scene.rowHeight * pdfIn, color: pdfColor(theme.surface), borderColor: pdfColor(theme.rule), borderWidth: 0.8 });
      const text = fittedText([row[column.field]], font, { width: (column.width - 0.36) * pdfIn, maximumHeight: (scene.rowHeight - 0.2) * pdfIn, preferredSize: CELL_FONT_SIZE, minimumSize: CELL_FONT_SIZE, lineHeightFactor: CELL_LINE_HEIGHT });
      drawAlignedLines({ page, lines: text.wrapped, x: (column.x + 0.18) * pdfIn, top: fromTop(y + 0.1), font, size: text.size, lineHeight: text.lineHeight, fill: pdfColor(theme.text) });
    }
  });
}
