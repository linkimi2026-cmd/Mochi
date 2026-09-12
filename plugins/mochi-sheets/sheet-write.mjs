// mochi-sheets · 写盘与校验。
//
// 红线：产出必须是**真的 .xlsx**（ZIP 容器 + OOXML 成员），不拿 CSV 改名、不拿 HTML 冒充。
// 本文件的 verifyXlsx 会真的解开 ZIP 中央目录读 xl/workbook.xml，再回读校验每个单元格，
// 校验不过就抛错，绝不"写完就说已生成"。
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';

import { addressOf, cellKey } from './address.mjs';
import { fail } from './paths.mjs';

export const MAX_SHEETS_PER_WORKBOOK = 20;
export const MAX_COLUMNS_PER_SHEET = 200;
export const MAX_ROWS_PER_SHEET = 50_000;
export const MAX_TOTAL_CELLS = 400_000;
export const MAX_TEXT_LENGTH = 32_767; // Excel 单元格文本上限

const HEADER_FILL = 'FF1D4ED8';
const HEADER_FONT = 'FFFFFFFF';
const BODY_FONT = 'FF1F2937';
const STRIPE_FILL = 'FFF3F7FD';
const WORKBOOK_FONT = 'Hiragino Sans GB';

// ── ZIP 容器解析（自实现，用来证明"真的是 zip + OOXML"，不依赖外部命令） ────────
/**
 * 解析 ZIP 中央目录，返回 [{ name, size, content: () => Buffer }]。
 * 只支持经典 ZIP（<4GB、无 ZIP64 扩展字段）；超限时抛错而不是给错结果。
 */
export function listZipEntries(buffer) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  const from = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= from; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD) { eocd = index; break; }
  }
  if (eocd < 0) throw fail('NOT_A_ZIP', '这不是一个 ZIP 容器：找不到中央目录结尾记录（.xlsx 必须是 ZIP）。');
  const total = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || total === 0xffff) {
    throw fail('ZIP64_UNSUPPORTED', '这个 ZIP 用了 ZIP64 扩展（>4GB 或 >65535 个成员），本插件的校验器不支持。');
  }
  const entries = [];
  let cursor = cdOffset;
  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw fail('ZIP_CORRUPT', `ZIP 中央目录第 ${index + 1} 条记录签名不对，文件可能已损坏。`);
    }
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.push({
      name,
      size: uncompressedSize,
      compressedSize,
      content() {
        if (compression === 0) return Buffer.from(raw);
        if (compression === 8) return inflateRawSync(raw);
        throw fail('ZIP_COMPRESSION_UNSUPPORTED', `ZIP 成员 ${name} 用了不支持的压缩方式 ${compression}。`);
      },
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 从 xl/workbook.xml 里读出工作表名与顺序（真正解包读 XML，不是猜）。 */
export function sheetNamesFromOoxml(buffer) {
  const entries = listZipEntries(buffer);
  const workbookEntry = entries.find((entry) => entry.name === 'xl/workbook.xml');
  if (!workbookEntry) throw fail('OOXML_MEMBER_MISSING', 'ZIP 里没有 xl/workbook.xml，这不是一个合法的 .xlsx。');
  const xml = workbookEntry.content().toString('utf8');
  const names = [];
  const pattern = /<sheet\b[^>]*\bname="([^"]*)"/g;
  let match = pattern.exec(xml);
  while (match) {
    names.push(match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
    match = pattern.exec(xml);
  }
  if (names.length === 0) throw fail('OOXML_NO_SHEET', 'xl/workbook.xml 里没有 <sheet> 声明，这不是一个合法的 .xlsx。');
  return { names, entries: entries.map((entry) => entry.name) };
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 真·回读校验：ZIP 签名 -> 解包读 workbook.xml -> ExcelJS 重新打开比对工作表与单元格。
 * expected: [{ name, cells: [{ address, value }] }]
 * 返回 { bytes, sha256, sheetNames, zipEntries, checkedCells, mismatches }；
 * 任一项不符抛 SheetsError（OUTPUT_VERIFICATION_FAILED）。
 */
export async function verifyXlsx(filePath, expected) {
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    throw fail('OUTPUT_VERIFICATION_FAILED', `回读校验失败：读不到刚写出的文件 ${filePath}（${error?.code ?? error}）。`);
  }
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw fail('OUTPUT_VERIFICATION_FAILED', `回读校验失败：${filePath} 的文件头不是 ZIP 容器签名，不是真 .xlsx。`);
  }
  let ooxml;
  try {
    ooxml = sheetNamesFromOoxml(bytes);
  } catch (error) {
    throw fail('OUTPUT_VERIFICATION_FAILED', `回读校验失败：解包 .xlsx 时出错——${error.message}`);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch (error) {
    throw fail('OUTPUT_VERIFICATION_FAILED', `回读校验失败：ExcelJS 打不开刚写出的文件——${error?.message ?? error}`);
  }
  const actualNames = workbook.worksheets.map((sheet) => sheet.name);

  if (expected) {
    if (JSON.stringify(ooxml.names) !== JSON.stringify(expected.map((sheet) => sheet.name))) {
      throw fail(
        'OUTPUT_VERIFICATION_FAILED',
        `回读校验失败：xl/workbook.xml 里的工作表是 [${ooxml.names.join('、')}]，期望是 [${expected.map((sheet) => sheet.name).join('、')}]。`,
      );
    }
    if (JSON.stringify(actualNames) !== JSON.stringify(ooxml.names)) {
      throw fail('OUTPUT_VERIFICATION_FAILED', `回读校验失败：ExcelJS 读出的工作表 [${actualNames.join('、')}] 与 workbook.xml [${ooxml.names.join('、')}] 不一致。`);
    }
  }

  const checkedCells = [];
  const mismatches = [];
  for (const sheetSpec of expected ?? []) {
    const worksheet = workbook.getWorksheet(sheetSpec.name);
    if (!worksheet) {
      mismatches.push(`工作表「${sheetSpec.name}」在回读的 .xlsx 里找不到。`);
      continue;
    }
    for (const cellSpec of sheetSpec.cells) {
      const cell = worksheet.getCell(cellSpec.address);
      if (!valuesMatch(cell.value, cellSpec.value)) {
        mismatches.push(`${sheetSpec.name}!${cellSpec.address}：写入值 ${JSON.stringify(cellSpec.value)}，回读值 ${JSON.stringify(cell.value)}。`);
      }
      checkedCells.push({ sheet: sheetSpec.name, address: cellSpec.address, value: cell.value });
    }
  }
  if (mismatches.length > 0) {
    throw fail('OUTPUT_VERIFICATION_FAILED', `回读校验失败，${mismatches.length} 处不一致：\n${mismatches.slice(0, 20).join('\n')}`);
  }

  return {
    bytes,
    byteLength: bytes.length,
    sha256: sha256Hex(bytes),
    sheetNames: ooxml.names,
    zipMembers: ooxml.entries,
    checkedCellCount: checkedCells.length,
  };
}

function normalizeForCompare(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
    if (value.result !== undefined) return normalizeForCompare(value.result);
    if (typeof value.error === 'string') return value.error;
    if (typeof value.text === 'string') return value.text;
    return JSON.stringify(value);
  }
  return value;
}

/** 数字按相对误差比较（同一个 double 的两种字符串化不应被判为不一致）。 */
function valuesMatch(cellValue, expectedValue) {
  const actual = normalizeForCompare(cellValue);
  const expected = normalizeForCompare(expectedValue);
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Number.isNaN(actual) && Number.isNaN(expected)) return true;
    const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
    return Math.abs(actual - expected) <= 1e-9 * scale;
  }
  return String(actual) === String(expected);
}

// ── 生成 ────────────────────────────────────────────────────────────────────
function assertSheetName(name, index) {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text) throw fail('SHEET_NAME_REQUIRED', `第 ${index + 1} 张工作表缺少 name。`);
  if (text.length > 31) throw fail('SHEET_NAME_TOO_LONG', `工作表名「${text}」超过 31 个字符（Excel 上限）。`);
  if (/[[\]:*?/\\]/.test(text)) throw fail('SHEET_NAME_INVALID_CHARS', `工作表名「${text}」含有 Excel 不允许的字符（[ ] : * ? / \\）。`);
  return text;
}

function assertScalar(value, where) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT_LENGTH) {
      throw fail('CELL_TEXT_TOO_LONG', `${where} 的文本长度 ${value.length} 超过 Excel 上限 ${MAX_TEXT_LENGTH} 个字符。`);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw fail('CELL_NUMBER_INVALID', `${where} 的数字不是有限值（${value}）。`);
    return value;
  }
  if (typeof value === 'boolean') return value;
  throw fail(
    'CELL_VALUE_NOT_SCALAR',
    `${where} 的值不是单元格能放的基本类型（字符串/数字/布尔/空），收到 ${Array.isArray(value) ? '数组' : typeof value}。`
    + '请把嵌套结构摊平成一维数组的行。',
  );
}

/**
 * 按结构化数据建一个真的 ExcelJS 工作簿（多工作表、表头、列宽、基本样式）。
 * spec: { sheets: [{ name, columns: [{ header, width, numberFormat, align, wrapText }], rows: [[...]], freezeHeaderRow }] }
 */
export function buildWorkbook(spec) {
  const sheets = spec?.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw fail('SHEETS_REQUIRED', 'sheets 必须是非空数组：至少给一张工作表（每张要 name、columns、rows）。');
  }
  if (sheets.length > MAX_SHEETS_PER_WORKBOOK) {
    throw fail('TOO_MANY_SHEETS', `工作表数量 ${sheets.length} 超过上限 ${MAX_SHEETS_PER_WORKBOOK}。请拆成多个文件。`);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mochi';
  workbook.lastModifiedBy = 'Mochi';
  workbook.created = workbook.created ?? new Date();
  workbook.modified = workbook.modified ?? new Date();

  const usedNames = new Set();
  const verificationPlan = [];
  let totalCells = 0;

  for (const [sheetIndex, sheetSpec] of sheets.entries()) {
    const sheetName = assertSheetName(sheetSpec?.name, sheetIndex);
    const nameKey = sheetName.toLowerCase();
    if (usedNames.has(nameKey)) throw fail('SHEET_NAME_DUPLICATE', `工作表名「${sheetName}」重复了（Excel 不区分大小写，重名会被拒绝）。`);
    usedNames.add(nameKey);

    const columns = sheetSpec.columns;
    if (!Array.isArray(columns) || columns.length === 0) {
      throw fail('COLUMNS_REQUIRED', `工作表「${sheetName}」的 columns 必须是非空数组（每项至少给 header）。`);
    }
    if (columns.length > MAX_COLUMNS_PER_SHEET) {
      throw fail('TOO_MANY_COLUMNS', `工作表「${sheetName}」的列数 ${columns.length} 超过上限 ${MAX_COLUMNS_PER_SHEET}。`);
    }
    const rows = sheetSpec.rows ?? [];
    if (!Array.isArray(rows)) throw fail('ROWS_NOT_ARRAY', `工作表「${sheetName}」的 rows 必须是数组（每个元素是一行的数组）。`);
    if (rows.length > MAX_ROWS_PER_SHEET) {
      throw fail('TOO_MANY_ROWS', `工作表「${sheetName}」的数据行数 ${rows.length} 超过上限 ${MAX_ROWS_PER_SHEET}。请拆表。`);
    }
    totalCells += rows.length * columns.length + columns.length;
    if (totalCells > MAX_TOTAL_CELLS) {
      throw fail('TOO_MANY_CELLS', `整簿单元格数超过上限 ${MAX_TOTAL_CELLS}（当前至少 ${totalCells}）。请拆成多个文件。`);
    }

    const worksheet = workbook.addWorksheet(sheetName);

    const headerRow = worksheet.getRow(1);
    columns.forEach((column, columnIndex) => {
      const header = assertScalar(column?.header ?? '', `${sheetName} 第 ${columnIndex + 1} 列的表头`);
      const cell = headerRow.getCell(columnIndex + 1);
      cell.value = header === null ? '' : header;
      cell.font = { name: WORKBOOK_FONT, size: 11, bold: true, color: { argb: HEADER_FONT } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        left: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        bottom: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        right: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      };
      const width = column?.width;
      if (width !== undefined) {
        if (typeof width !== 'number' || !Number.isFinite(width) || width < 4 || width > 255) {
          throw fail('COLUMN_WIDTH_INVALID', `工作表「${sheetName}」第 ${columnIndex + 1} 列的 width 必须是 4..255 的数字（收到：${width}）。`);
        }
      }
      worksheet.getColumn(columnIndex + 1).width = width ?? 12;
      const numberFormat = column?.numberFormat;
      if (numberFormat !== undefined && typeof numberFormat !== 'string') {
        throw fail('NUMBER_FORMAT_INVALID', `工作表「${sheetName}」第 ${columnIndex + 1} 列的 numberFormat 必须是字符串。`);
      }
    });
    headerRow.height = 22;
    worksheet.views = [{ state: 'frozen', ySplit: sheetSpec.freezeHeaderRow === false ? 0 : 1 }];

    rows.forEach((rowValues, rowOffset) => {
      if (!Array.isArray(rowValues)) {
        throw fail('ROW_NOT_ARRAY', `工作表「${sheetName}」第 ${rowOffset + 1} 行不是数组；每行必须是值的数组（如 ["张三", 88.5]）。`);
      }
      if (rowValues.length > columns.length) {
        throw fail(
          'ROW_TOO_WIDE',
          `工作表「${sheetName}」第 ${rowOffset + 1} 行有 ${rowValues.length} 个值，但只有 ${columns.length} 列。请补 columns 或删多余的值。`,
        );
      }
      const row = worksheet.getRow(rowOffset + 2);
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const value = assertScalar(rowValues[columnIndex], `${sheetName} 第 ${rowOffset + 2} 行第 ${columnIndex + 1} 列`);
        const cell = row.getCell(columnIndex + 1);
        cell.value = value;
        cell.font = { name: WORKBOOK_FONT, size: 11, color: { argb: BODY_FONT } };
        const align = columns[columnIndex]?.align;
        cell.alignment = {
          vertical: 'middle',
          horizontal: align === 'left' || align === 'right' || align === 'center' ? align : undefined,
          wrapText: columns[columnIndex]?.wrapText === true,
        };
        if (typeof columns[columnIndex]?.numberFormat === 'string') cell.numFmt = columns[columnIndex].numberFormat;
        if (rowOffset % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE_FILL } };
        }
      }
    });

    // 校验计划：表头 + 每一行的每个格子，逐个回读比对（不抽样）。
    const cells = columns.map((column, columnIndex) => ({
      address: addressOf(1, columnIndex + 1),
      value: assertScalar(column?.header ?? '', 'header'),
    }));
    rows.forEach((rowValues, rowOffset) => {
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        cells.push({
          address: addressOf(rowOffset + 2, columnIndex + 1),
          value: normalizeForCompare(assertScalar(rowValues[columnIndex], 'cell')),
        });
      }
    });
    verificationPlan.push({ name: sheetName, cells, declaredRows: rows.length, declaredColumns: columns.length });
  }
  return { workbook, verificationPlan };
}

/** 生成 -> 原子落盘 -> 回读校验。返回写入结果与校验证据。 */
export async function writeXlsx({ spec, outputPath }) {
  const { workbook, verificationPlan } = buildWorkbook(spec);
  let buffer;
  try {
    buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  } catch (error) {
    throw fail('XLSX_WRITE_FAILED', `生成 .xlsx 内容失败：${error?.message ?? error}`);
  }
  try {
    await writeFile(outputPath, buffer, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw fail('OUTPUT_EXISTS', `输出文件已存在，不会被覆盖：${outputPath}。请换一个文件名再调用。`);
    }
    throw fail('OUTPUT_WRITE_FAILED', `写文件失败：${outputPath}（${error?.code ?? error}）。`);
  }
  const verification = await verifyXlsx(outputPath, verificationPlan);
  return {
    path: outputPath,
    byteLength: verification.byteLength,
    sha256: verification.sha256,
    sheetNames: verification.sheetNames,
    checkedCellCount: verification.checkedCellCount,
    zipMemberCount: verification.zipMembers.length,
    verificationPlan,
  };
}

// ── 导出 ────────────────────────────────────────────────────────────────────
export const SUPPORTED_TARGET_FORMATS = Object.freeze(['xlsx', 'csv']);
export const UNSUPPORTED_TARGET_FORMATS = Object.freeze([
  'pdf', 'xls（旧版 BIFF）', 'ods', 'numbers', 'html', 'tsv', 'json', 'markdown', 'txt', 'xml',
]);

export function assertSupportedTargetFormat(format) {
  const text = typeof format === 'string' ? format.trim().toLowerCase().replace(/^\./, '') : '';
  if (!SUPPORTED_TARGET_FORMATS.includes(text)) {
    throw fail(
      'UNSUPPORTED_TARGET_FORMAT',
      `本插件只支持导出为 .xlsx 或 .csv，不支持「${format || '空'}」。`
      + `明确列一下：支持 ${SUPPORTED_TARGET_FORMATS.map((entry) => `.${entry}`).join(' / ')}；`
      + `不支持 ${UNSUPPORTED_TARGET_FORMATS.join('、')}——不会假装导出成功，也不会偷偷换成 CSV 改名。`
      + '下一步：把 format 改成 xlsx 或 csv；要 PDF 请用 Excel/LibreOffice 打开后另存。',
    );
  }
  return text;
}

function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 取一张工作表的值矩阵（公式取缓存值；无缓存则留空并记一条告警）。 */
export function sheetValueMatrix(sheet, { maxRows = MAX_ROWS_PER_SHEET, maxColumns = MAX_COLUMNS_PER_SHEET } = {}) {
  const notices = [];
  const bounds = sheet.usedBounds;
  if (!bounds) return { matrix: [], truncated: false, notices: [`工作表「${sheet.name}」是空的。`] };
  const bottom = Math.min(bounds.bottom, bounds.top + maxRows - 1);
  const right = Math.min(bounds.right, bounds.left + maxColumns - 1);
  const truncated = bottom !== bounds.bottom || right !== bounds.right;
  let missingCache = 0;
  const matrix = [];
  for (let row = bounds.top; row <= bottom; row += 1) {
    const line = [];
    for (let column = bounds.left; column <= right; column += 1) {
      const hit = sheet.cells.get(cellKey(row, column));
      if (!hit) { line.push(''); continue; }
      if (hit.formula && hit.result === null) { missingCache += 1; line.push(''); continue; }
      line.push(hit.value);
    }
    matrix.push(line);
  }
  if (truncated) notices.push(`工作表「${sheet.name}」超过上限，导出只包含 ${bottom - bounds.top + 1} 行 × ${right - bounds.left + 1} 列。`);
  if (missingCache > 0) notices.push(`工作表「${sheet.name}」有 ${missingCache} 个公式没有缓存结果，导出时留空（不会替它们假装算过）。`);
  return { matrix, truncated, notices };
}

export function toCsvText(matrix) {
  return `${matrix.map((line) => line.map(csvField).join(',')).join('\n')}\n`;
}
