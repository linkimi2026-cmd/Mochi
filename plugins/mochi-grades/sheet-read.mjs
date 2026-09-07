// sheet-read · 把老师给的成绩表文件（.xlsx / .csv）读成结构化输入（MOCHI-P2-TS-01）。
// 本模块只负责"读与判读"，统计口径一律交给 index.mjs 的库内函数；
// 拿不准的单元格标待核对并列出行号，绝不猜。
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

const ABSENT_LITERAL = '缺考';
const EXEMPT_LITERALS = new Set(['免修', '免考']);
const BLANK_LITERALS = new Set(['空白', '缺']);

const ID_HEADER_PATTERN = /学号|学籍号|考号/;
const NAME_HEADER_PATTERN = /姓名|名字/;
const SCORE_HEADER_PATTERN = /成绩|分数|得分|分$/;

export class SheetReadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SheetReadError';
  }
}

function fatal(message) {
  return { level: '致命', message };
}

function pending(message) {
  return { level: '待核对', message };
}

function info(message) {
  return { level: '提示', message };
}

function withLine(line, message) {
  return `第 ${line} 行：${message}`;
}

// 把 ExcelJS 单元格值归一成标量：字符串 / 数字 / 布尔 / Date / ''。
function cellScalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
    if (typeof value.text === 'string' || typeof value.text === 'number') return value.text;
    if (value.result !== undefined && value.result !== null) return cellScalar(value.result);
    if (typeof value.error === 'string') return value.error;
  }
  return '';
}

function textOf(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

// 手写 CSV 解析器：引号转义（"" -> "）、逗号、CRLF/LF；零新依赖。
// 返回 [{ line: 记录起始行号(1 起), cells: string[] }]；空行不产生记录。
function parseCsvRecords(text) {
  const clean = text.replace(/^\uFEFF/, '');
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
  if (inQuotes) throw new SheetReadError('CSV 解析失败：存在未闭合的引号，请检查成绩表的引号转义后重试。');
  if (started || field !== '' || record.length > 0) pushRecord();
  return records;
}

// 表头识别：返回列下标；学号/姓名必须有，分数列优先按关键字匹配，否则取学号与
// 姓名之外第一个非空表头列。找不到必需表头时抛致命错误（可定位到表头行号）。
function identifyColumns(headerCells, headerLine, format) {
  const headers = headerCells.map((cell) => textOf(cellScalar(cell)));
  const findColumn = (pattern) => headers.findIndex((header) => header && pattern.test(header));
  const idIndex = findColumn(ID_HEADER_PATTERN);
  const nameIndex = findColumn(NAME_HEADER_PATTERN);
  const missing = [];
  if (idIndex < 0) missing.push('学号');
  if (nameIndex < 0) missing.push('姓名');
  if (missing.length > 0) {
    throw new SheetReadError(
      `成绩表无法使用：${format} 第 ${headerLine} 行的表头里没有识别到「${missing.join('」「')}」列。`
      + '请在表头补上列名（如「学号」「姓名」），确认文件后重试；表头必须是第一行非空内容。',
    );
  }
  let scoreIndex = findColumn(SCORE_HEADER_PATTERN);
  let scoreHeader = scoreIndex >= 0 ? headers[scoreIndex] : '';
  let scoreColumnSource = '关键字匹配';
  if (scoreIndex < 0 || scoreIndex === idIndex || scoreIndex === nameIndex) {
    scoreIndex = headers.findIndex((header, index) => index !== idIndex && index !== nameIndex && header);
    scoreColumnSource = '按列顺序采纳';
  }
  if (scoreIndex < 0) {
    throw new SheetReadError(
      `成绩表无法使用：${format} 第 ${headerLine} 行的表头里除了学号和姓名，没有找到任何分数列（如「成绩」「分数」）。请在表头补上分数列后重试。`,
    );
  }
  if (!scoreHeader) scoreHeader = headers[scoreIndex];
  return {
    idIndex,
    nameIndex,
    scoreIndex,
    idHeader: headers[idIndex],
    nameHeader: headers[nameIndex],
    scoreHeader,
    scoreColumnSource,
  };
}

// 分数单元格判读：缺考/免修/空白 字面量 -> 对应状态；数字 -> present；
// 其余一律标待核对并列行号，不猜。返回 { row } 或 { notice }。
function interpretScore(rawScore, line) {
  if (typeof rawScore === 'number') {
    if (!Number.isFinite(rawScore) || rawScore < 0) {
      return { notice: pending(withLine(line, `分数「${rawScore}」不是 0 以上的有限数字，无法判读，已整行标待核对，不计入统计。`)) };
    }
    return { row: { status: 'present', score: rawScore } };
  }
  if (typeof rawScore !== 'string') {
    return { notice: pending(withLine(line, '分数单元格不是文本或数字，无法判读，已整行标待核对，不计入统计。')) };
  }
  const text = rawScore.trim();
  if (text === '') return { row: { status: 'blank', score: undefined } };
  if (text === ABSENT_LITERAL) return { row: { status: 'absent', score: undefined } };
  if (EXEMPT_LITERALS.has(text)) return { row: { status: 'exempt', score: undefined } };
  if (BLANK_LITERALS.has(text)) return { row: { status: 'blank', score: undefined } };
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) {
    const score = Number(text);
    if (!Number.isFinite(score) || score < 0) {
      return { notice: pending(withLine(line, `分数「${text}」不是 0 以上的有限数字，无法判读，已整行标待核对，不计入统计。`)) };
    }
    return { row: { status: 'present', score } };
  }
  return {
    notice: pending(withLine(line, `分数「${text}」既不是数字，也不是「${ABSENT_LITERAL}/免修/空白」，无法判读，已整行标待核对，不计入统计；请修正源文件中的这个单元格。`)),
  };
}

function collectDuplicates(rows, notices) {
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.studentId)) byId.set(row.studentId, []);
    byId.get(row.studentId).push(row.sourceRow);
  }
  const duplicates = [];
  for (const [studentId, lines] of byId) {
    if (lines.length > 1) {
      duplicates.push({ studentId, lines });
      notices.push(pending(`学号「${studentId}」在第 ${lines.join('、')} 行重复出现；按口径不自动合并，这些行整批标待核对并由统计库排除。`));
    }
  }
  return duplicates;
}

function collectNamesakes(rows) {
  const byName = new Map();
  for (const row of rows) {
    if (!byName.has(row.studentName)) byName.set(row.studentName, new Set());
    byName.get(row.studentName).add(row.studentId);
  }
  const namesakes = [];
  for (const [studentName, ids] of byName) {
    if (ids.size > 1) {
      const lines = rows.filter((row) => row.studentName === studentName).map((row) => row.sourceRow);
      namesakes.push({ studentName, lines });
    }
  }
  return namesakes;
}

async function readXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new SheetReadError('成绩表无法使用：.xlsx 里没有任何工作表。请确认导出的是含数据表的文件后重试。');
  const grid = new Map();
  let lastRow = 0;
  let lastColumn = 0;
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells = [];
    let rowHasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const scalar = cellScalar(cell.value);
      cells[colNumber - 1] = scalar;
      if (scalar !== '' && scalar !== null && scalar !== undefined) rowHasValue = true;
      if (colNumber > lastColumn) lastColumn = colNumber;
    });
    if (rowHasValue) {
      grid.set(rowNumber, cells);
      if (rowNumber > lastRow) lastRow = rowNumber;
    }
  });
  return { format: 'xlsx', cellsAt: (rowNumber, column) => grid.get(rowNumber)?.[column] ?? '', rowNumbers: [...grid.keys()], lastColumn };
}

async function readCsv(filePath) {
  const text = await readFile(filePath, 'utf8');
  const records = parseCsvRecords(text);
  let lastColumn = 0;
  const grid = new Map();
  for (const record of records) {
    grid.set(record.line, record.cells);
    if (record.cells.length > lastColumn) lastColumn = record.cells.length;
  }
  return { format: 'csv', cellsAt: (rowNumber, column) => grid.get(rowNumber)?.[column] ?? '', rowNumbers: [...grid.keys()], lastColumn };
}

/**
 * 读取成绩表文件并返回结构化行与行号级中文报告。
 * 返回 { format, headerLine, columns, rows, notices, duplicates, namesakes }。
 * 缺表头/缺学号列等致命问题抛 SheetReadError（含下一步怎么改）。
 */
export async function readGradeSheet(filePath) {
  const isXlsx = filePath.toLowerCase().endsWith('.xlsx');
  const isCsv = filePath.toLowerCase().endsWith('.csv');
  if (!isXlsx && !isCsv) {
    throw new SheetReadError(`成绩表无法使用：只支持 .xlsx 或 .csv，收到的是「${filePath}」。请让主人提供这两种格式之一后重试。`);
  }
  const source = isXlsx ? await readXlsx(filePath) : await readCsv(filePath);
  if (source.rowNumbers.length === 0) {
    throw new SheetReadError(`成绩表无法使用：${source.format} 里没有读到任何非空内容。请确认文件里确实有成绩数据后重试。`);
  }
  const headerLine = source.rowNumbers[0];
  const headerCells = [];
  for (let column = 0; column < source.lastColumn; column += 1) headerCells.push(source.cellsAt(headerLine, column));
  const columns = identifyColumns(headerCells, headerLine, source.format);

  const notices = [];
  const rows = [];
  for (const line of source.rowNumbers) {
    if (line === headerLine) continue;
    const rawId = source.cellsAt(line, columns.idIndex);
    const rawName = source.cellsAt(line, columns.nameIndex);
    const rawScore = source.cellsAt(line, columns.scoreIndex);
    const rowIsEmpty = textOf(rawId) === '' && textOf(rawName) === '' && textOf(rawScore) === '';
    if (rowIsEmpty) {
      notices.push(info(withLine(line, '空白行，已跳过，不计入任何统计。')));
      continue;
    }

    let studentId = '';
    if (typeof rawId === 'number') {
      notices.push(pending(withLine(line, `学号在 ${source.format} 里被存成数字（值 ${rawId}），可能已经丢失前导零，不能替主人补零；请把该列改成文本格式后重试。`)));
      continue;
    }
    studentId = textOf(rawId);
    if (!studentId) {
      notices.push(pending(withLine(line, '学号为空，无法确认是哪位学生，已整行标待核对，不计入统计。')));
      continue;
    }

    const studentName = textOf(rawName);
    if (!studentName) {
      notices.push(pending(withLine(line, `学号「${studentId}」对应的姓名为空，已整行标待核对，不计入统计。`)));
      continue;
    }

    const verdict = interpretScore(rawScore, line);
    if (verdict.notice) {
      notices.push(verdict.notice);
      continue;
    }

    rows.push({
      sourceRow: line,
      studentId,
      studentName,
      status: verdict.row.status,
      score: verdict.row.score,
    });
  }

  if (rows.length === 0) {
    throw new SheetReadError(
      `成绩表无法使用：${source.format} 第 ${headerLine} 行表头之下没有读到任何可判读的数据行。`
      + '请检查学号、姓名、分数三列是否填了内容后重试。',
    );
  }

  const duplicates = collectDuplicates(rows, notices);
  const namesakes = collectNamesakes(rows);
  for (const namesake of namesakes) {
    notices.push(info(withLine(namesake.lines[0], `姓名「${namesake.studentName}」对应多个不同学号（第 ${namesake.lines.join('、')} 行）；按口径保持为不同记录，不合并。`)));
  }

  return {
    format: source.format,
    headerLine,
    columns: {
      studentId: columns.idHeader,
      studentName: columns.nameHeader,
      score: columns.scoreHeader,
      scoreColumnSource: columns.scoreColumnSource,
    },
    rows,
    notices,
    duplicates,
    namesakes,
  };
}
