// mochi-sheets · 读表（.xlsx / .csv）。
//
// 复用说明（不造第二套）：
//   本文件的手写 CSV 解析器与"单元格值归一成标量"的判读规则，是按
//   plugins/mochi-grades/sheet-read.mjs 的既有实现移植的（同一套引号转义、
//   richText / 超链接 / Date / formula.result 的归一顺序）。之所以不直接
//   `import '../mochi-grades/sheet-read.mjs'`，是因为打包时每个插件是独立的
//   resources/mochi/plugins/<id>/ 目录、依赖闭包各自暂存，跨插件相对 import
//   不在 staging 模型内（mochi-grades 的 sheet-read 也只导出成绩表语义的
//   readGradeSheet，强制要求「学号/姓名」列，不是通用读表器）。
//   mochi-grades 那套的"读表 + 判读 + 行号待核对"口径对本插件没有可复用入口，
//   因此这里复用**规则**而不是**模块**。
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

import { addressOf, cellKey, clampRange, parseRange } from './address.mjs';
import { fail } from './paths.mjs';

/** 单个文件最大字节数：超过就不读，避免把内存吃满。 */
export const MAX_FILE_BYTES = 80 * 1024 * 1024;
/** 建模最多容纳的单元格数（稀疏计数）。 */
export const MAX_MODEL_CELLS = 200_000;
/** spreadsheet_read 默认与硬上限。 */
export const DEFAULT_MAX_ROWS = 200;
export const DEFAULT_MAX_COLUMNS = 50;
export const HARD_MAX_ROWS = 5_000;
export const HARD_MAX_COLUMNS = 500;

// ── 单元格值归一（移植自 mochi-grades/sheet-read.mjs 的 cellScalar 规则） ─────────
export function scalarOf(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
    if (typeof value.text === 'string' || typeof value.text === 'number') return value.text;
    if (value.result !== undefined && value.result !== null) return scalarOf(value.result);
    if (typeof value.error === 'string') return value.error;
  }
  return '';
}

/** 把一个 ExcelJS 单元格读成 { raw, formula, value, result, type }。 */
export function readCell(cell) {
  const raw = cell?.value;
  const formula = typeof cell?.formula === 'string' && cell.formula ? cell.formula : null;
  const result = cell?.result;
  if (formula) {
    // 公式单元格：值就是缓存结果；没有缓存时如实记 null，不拿公式文本冒充数值。
    const cached = result === undefined || result === null ? null : scalarOf(result);
    return { raw: cached, formula, value: cached ?? '', result: cached, type: 'formula' };
  }
  if (raw === null || raw === undefined) return { raw: null, formula: null, value: '', result: null, type: 'empty' };
  const value = scalarOf(raw);
  let type = 'string';
  if (typeof raw === 'number') type = 'number';
  else if (typeof raw === 'boolean') type = 'boolean';
  else if (raw instanceof Date) type = 'date';
  else if (value === '') type = 'empty';
  return { raw: value, formula: null, value, result: null, type };
}

// ── 手写 CSV 解析（移植自 mochi-grades/sheet-read.mjs 的 parseCsvRecords） ────────
export function parseCsvRecords(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let started = false;
  let line = 1;
  let recordStartLine = 1;
  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => {
    pushField();
    records.push({ line: recordStartLine, cells: record });
    record = [];
    started = false;
  };
  for (let index = 0; index < clean.length; index += 1) {
    const ch = clean[index];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[index + 1] === '"') { field += '"'; index += 1; }
        else inQuotes = false;
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (!started) { started = true; recordStartLine = line; }
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      if (!started) { started = true; recordStartLine = line; }
      pushField();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[index + 1] === '\n') index += 1;
      if (started || field !== '' || record.length > 0) pushRecord();
      line += 1;
      continue;
    }
    if (!started) { started = true; recordStartLine = line; }
    field += ch;
  }
  if (inQuotes) {
    throw fail('CSV_UNCLOSED_QUOTE', 'CSV 解析失败：存在未闭合的引号。请检查文件里的引号转义（成对的双引号写成 ""）后重试。');
  }
  if (started || field !== '' || record.length > 0) pushRecord();
  return records;
}

/** CSV 里的一个文本片段：能当数字看就当数字，其余保持字符串。 */
function csvScalar(text) {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  return text;
}

function emptyModel(format) {
  return format === 'csv'
    ? { name: 'CSV', index: 0, rowCount: 0, columnCount: 0, usedBounds: null, cells: new Map(), sourceLines: new Map(), extra: {} }
    : { name: '', index: 0, rowCount: 0, columnCount: 0, usedBounds: null, cells: new Map(), sourceLines: new Map(), extra: {} };
}

/**
 * 把 .xlsx / .csv 读成内存模型。
 * 返回 { path, format, bytes, sheets: [{ name, index, rowCount, columnCount, usedBounds, cells }] }。
 * cells 的键是 `r:c`（row/column 均 1 起），值是 readCell 的结果。
 */
export async function loadWorkbookModel(filePath, { signal } = {}) {
  if (signal?.aborted) throw fail('ABORTED', '读取被取消。');
  const lower = filePath.toLowerCase();
  const isXlsx = lower.endsWith('.xlsx');
  const isCsv = lower.endsWith('.csv');
  if (!isXlsx && !isCsv) {
    throw fail(
      'UNSUPPORTED_INPUT_FORMAT',
      `只支持 .xlsx 与 .csv，收到的是「${filePath}」。`
      + '本插件不读 .xls（旧版 BIFF）、.ods、.numbers 或 .pdf；也不接受把 CSV 改名成 .xlsx 的假表格。'
      + '下一步：用 Excel/LibreOffice 另存为 .xlsx 或 .csv 后重试。',
    );
  }
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    throw fail('INPUT_UNREADABLE', `读不到文件：${filePath}（${error?.code ?? '未知原因'}）。请确认路径与权限后重试。`);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw fail(
      'INPUT_TOO_LARGE',
      `文件太大（${bytes.length} 字节，上限 ${MAX_FILE_BYTES} 字节）：${filePath}。请先拆分或另存为 .csv 后重试。`,
    );
  }
  if (bytes.length === 0) throw fail('INPUT_EMPTY', `文件是空的（0 字节）：${filePath}。`);

  if (isXlsx) {
    // 真 .xlsx 必须是 ZIP 容器（PK\x03\x04 或空 ZIP PK\x05\x06）。改名文件在这里就被挡住。
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      throw fail(
        'NOT_A_ZIP',
        `这不是真正的 .xlsx：文件头不是 ZIP 容器签名（改名的 CSV / HTML 会被这一条挡住）。请用 Excel/LibreOffice 另存为 .xlsx 后重试。`,
      );
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(bytes);
    } catch (error) {
      throw fail('XLSX_UNREADABLE', `ExcelJS 打不开这个 .xlsx：${error?.message ?? error}。文件可能已损坏。`);
    }
    const sheets = [];
    let budget = MAX_MODEL_CELLS;
    for (const [index, worksheet] of workbook.worksheets.entries()) {
      const cells = new Map();
      let top = Infinity;
      let left = Infinity;
      let bottom = 0;
      let right = 0;
      let truncatedByBudget = false;
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (truncatedByBudget) return;
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          if (truncatedByBudget) return;
          if (budget <= 0) { truncatedByBudget = true; return; }
          budget -= 1;
          const parsed = readCell(cell);
          if (parsed.type === 'empty') return;
          cells.set(cellKey(rowNumber, colNumber), parsed);
          if (rowNumber < top) top = rowNumber;
          if (colNumber < left) left = colNumber;
          if (rowNumber > bottom) bottom = rowNumber;
          if (colNumber > right) right = colNumber;
        });
      });
      sheets.push({
        name: worksheet.name,
        index,
        rowCount: worksheet.rowCount ?? 0,
        columnCount: worksheet.columnCount ?? 0,
        usedBounds: bottom > 0 ? { top, left, bottom, right } : null,
        cells,
        sourceLines: new Map(),
        extra: truncatedByBudget ? { cellsTruncated: true, cellBudget: MAX_MODEL_CELLS } : {},
      });
      if (budget <= 0) break;
    }
    if (sheets.length === 0) throw fail('XLSX_NO_SHEET', `.xlsx 里没有任何工作表：${filePath}。`);
    return { path: filePath, format: 'xlsx', bytes, sheets };
  }

  const text = bytes.toString('utf8');
  const records = parseCsvRecords(text);
  const model = emptyModel('csv');
  let left = Infinity;
  let right = 0;
  for (const [position, record] of records.entries()) {
    const rowNumber = position + 1;
    model.sourceLines.set(rowNumber, record.line);
    for (const [columnPosition, rawText] of record.cells.entries()) {
      const column = columnPosition + 1;
      const value = csvScalar(rawText);
      if (value === '') continue;
      model.cells.set(cellKey(rowNumber, column), { raw: value, formula: null, value, result: null, type: typeof value === 'number' ? 'number' : 'string' });
      if (column < left) left = column;
      if (column > right) right = column;
    }
  }
  model.rowCount = records.length;
  model.columnCount = right;
  model.usedBounds = records.length > 0 && right > 0 ? { top: 1, left, bottom: records.length, right } : null;
  return { path: filePath, format: 'csv', bytes, sheets: [model] };
}

export function pickSheet(model, sheetName) {
  if (sheetName === undefined || sheetName === null || String(sheetName).trim() === '') return model.sheets[0];
  const wanted = String(sheetName).trim().toLowerCase();
  const found = model.sheets.find((sheet) => sheet.name.toLowerCase() === wanted);
  if (!found) {
    throw fail(
      'SHEET_NOT_FOUND',
      `工作簿里没有名为「${sheetName}」的工作表。现有工作表：${model.sheets.map((sheet) => sheet.name).join('、')}。请从这些名字里选一个，或省略 sheetName 用第一张表。`,
    );
  }
  return found;
}

/**
 * 读一张表的指定区域（含公式文本与缓存结果），套用行列上限并如实报告截断。
 * rangeText 省略时读整张已用区域。
 */
export function readRange(model, sheet, rangeText, { maxRows = DEFAULT_MAX_ROWS, maxColumns = DEFAULT_MAX_COLUMNS, includeFormulas = true } = {}) {
  const rows = Math.min(Math.max(Math.trunc(maxRows) || DEFAULT_MAX_ROWS, 1), HARD_MAX_ROWS);
  const columns = Math.min(Math.max(Math.trunc(maxColumns) || DEFAULT_MAX_COLUMNS, 1), HARD_MAX_COLUMNS);
  if (!sheet.usedBounds) {
    return {
      sheetName: sheet.name,
      rangeAddress: null,
      requestedRange: rangeText ?? null,
      totalRows: 0,
      totalColumns: 0,
      returnedRows: 0,
      returnedColumns: 0,
      truncated: { rows: null, columns: null, isTruncated: false },
      limits: { maxRows: rows, maxColumns: columns },
      rows: [],
      notices: [`工作表「${sheet.name}」没有任何非空单元格。`],
    };
  }

  let requested;
  if (rangeText === undefined || rangeText === null || String(rangeText).trim() === '') {
    requested = { sheet: null, ...sheet.usedBounds };
  } else {
    const parsed = parseRange(rangeText);
    if (parsed.sheet && parsed.sheet.toLowerCase() !== sheet.name.toLowerCase()) {
      throw fail('RANGE_SHEET_MISMATCH', `区域「${rangeText}」写的是工作表「${parsed.sheet}」，但当前选中的是「${sheet.name}」。请改成一致，或省略 sheetName。`);
    }
    requested = parsed;
  }

  const clamped = clampRange(requested, sheet.usedBounds, rows, columns);
  const out = [];
  if (!clamped.isEmpty) {
    for (let row = clamped.top; row <= clamped.bottom; row += 1) {
      const cells = [];
      for (let column = clamped.left; column <= clamped.right; column += 1) {
        const hit = sheet.cells.get(cellKey(row, column));
        const address = addressOf(row, column);
        if (!hit) {
          cells.push({ address, value: '', type: 'empty' });
          continue;
        }
        const entry = { address, value: hit.value, type: hit.type };
        if (includeFormulas && hit.formula) {
          entry.formula = `=${String(hit.formula).replace(/^=/, '')}`;
          entry.cachedResult = hit.result ?? null;
          if (hit.result === null) entry.formulaNote = '这个公式没有缓存结果（生成它的程序没算过）；本插件不会替它假装算过。';
        }
        const sourceLine = sheet.sourceLines.get(row);
        if (sourceLine !== undefined) entry.sourceLine = sourceLine;
        cells.push(entry);
      }
      out.push({ row, cells });
    }
  }

  const notices = [];
  if (clamped.truncated.rows) {
    notices.push(
      `行被截断：该区域共 ${clamped.truncated.rows.total} 行，本次只返回前 ${clamped.truncated.rows.included} 行`
      + `（上限 ${rows} 行）。想看后面的行，请用 range 指定更小的区域，或把 maxRows 调大（硬上限 ${HARD_MAX_ROWS}）。`,
    );
  }
  if (clamped.truncated.columns) {
    notices.push(
      `列被截断：该区域共 ${clamped.truncated.columns.total} 列，本次只返回前 ${clamped.truncated.columns.included} 列`
      + `（上限 ${columns} 列）。硬上限 ${HARD_MAX_COLUMNS} 列。`,
    );
  }
  if (sheet.extra?.cellsTruncated) {
    notices.push(
      `整簿建模中途触顶：本插件最多建模 ${MAX_MODEL_CELLS} 个非空单元格，后面的工作表与单元格没有载入。请缩小文件或另存为 .csv 后重试。`,
    );
  }
  return {
    sheetName: sheet.name,
    rangeAddress: clamped.rangeAddress,
    requestedRange: rangeText ?? null,
    totalRows: clamped.original.rows,
    totalColumns: clamped.original.columns,
    returnedRows: out.length,
    returnedColumns: out.length > 0 ? out[0].cells.length : 0,
    truncated: clamped.truncated,
    limits: { maxRows: rows, maxColumns: columns },
    rows: out,
    notices,
  };
}

/** 工作表清单（含真实行列数与单元格计数）。 */
export function describeSheets(model) {
  return model.sheets.map((sheet) => ({
    name: sheet.name,
    index: sheet.index,
    rows: sheet.usedBounds ? sheet.usedBounds.bottom - sheet.usedBounds.top + 1 : 0,
    columns: sheet.usedBounds ? sheet.usedBounds.right - sheet.usedBounds.left + 1 : 0,
    sheetDeclaredRows: sheet.rowCount,
    sheetDeclaredColumns: sheet.columnCount,
    usedRange: sheet.usedBounds
      ? `${addressOf(sheet.usedBounds.top, sheet.usedBounds.left)}:${addressOf(sheet.usedBounds.bottom, sheet.usedBounds.right)}`
      : null,
    nonEmptyCells: sheet.cells.size,
  }));
}
