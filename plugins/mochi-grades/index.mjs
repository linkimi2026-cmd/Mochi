/**
 * Host-controlled grade verification from already-authorized structured input.
 * This package deliberately has no file ingestion, model, session, UI, network,
 * shell-command, profile, or database surface.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import ExcelJS from 'exceljs';

export const INTERNAL_WORKBOOK_FILENAME = 'teacher-grade-audit.xlsx';
export const EXTERNAL_WORKBOOK_FILENAME = 'external-grade-summary.xlsx';
export const MANIFEST_FILENAME = 'manifest.json';
export const COMPLETION_FILENAME = '.mochi-grades.complete';

const CLAIM_FILENAME = '.mochi-grades.claim.json';
const REPORT_SCOPES = new Set(['teacher-internal', 'external-anonymized']);
const SOURCE_KINDS = new Set(['demonstration', 'upstream-authorized-structured-grades']);
const ROW_STATUSES = new Set(['present', 'absent', 'exempt', 'blank']);
const MAX_ROWS = 10_000;
const MAX_SCORE = 1_000_000;
const MAX_SOURCE_RECORD_KEYS = 50;
const MAX_SOURCE_RECORD_VALUE_LENGTH = 5_000;
const HEADER_FILL = '1D4ED8';
const TITLE_FILL = '102A43';
const WORKBOOK_FONT = 'Hiragino Sans GB';

export class MochiGradesError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'MochiGradesError';
    this.code = code;
    this.issues = issues;
  }
}

function failure(code, message, issues = []) {
  return new MochiGradesError(code, message, issues);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(issues, path, code, message) {
  issues.push({ path, code, message });
}

function requiredText(value, path, issues, maxLength = 500) {
  if (typeof value !== 'string') {
    issue(issues, path, 'REQUIRED_TEXT', `${path} must be a non-empty string`);
    return '';
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    issue(issues, path, 'REQUIRED_TEXT', `${path} must be a non-empty string within ${maxLength} characters`);
    return '';
  }
  return text;
}

function optionalText(value, path, issues, maxLength = 500) {
  if (value === undefined) return undefined;
  return requiredText(value, path, issues, maxLength);
}

function requiredFiniteNumber(value, path, issues, { minimum = 0, maximum = MAX_SCORE, strictlyPositive = false } = {}) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || (strictlyPositive ? value <= minimum : value < minimum)
    || value > maximum
  ) {
    issue(issues, path, 'REQUIRED_NUMBER', `${path} must be a finite ${strictlyPositive ? 'positive' : `number not below ${minimum}`} no greater than ${maximum}`);
    return null;
  }
  return value;
}

function requiredEnum(value, allowed, path, issues) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    issue(issues, path, 'REQUIRED_ENUM', `${path} must be one of: ${[...allowed].join(', ')}`);
    return '';
  }
  return value;
}

function requiredSourceRow(value, path, issues) {
  if (typeof value === 'string' && value.trim().length > 0 && value.length <= 200) return value;
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  issue(issues, path, 'SOURCE_ROW_REQUIRED', `${path} must be a non-empty string or a positive integer`);
  return '';
}

function requiredStudentId(value, path, issues) {
  if (typeof value !== 'string') {
    issue(issues, path, 'STUDENT_ID_STRING_REQUIRED', `${path} must be a string so leading zeros remain intact`);
    return '';
  }
  if (!value || value.length > 200 || value.trim() !== value) {
    issue(issues, path, 'STUDENT_ID_INVALID', `${path} must be a non-empty, untrimmed string within 200 characters`);
    return '';
  }
  return value;
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function normalizeSourceRecord(value, row, path, issues) {
  const record = value === undefined ? {
    sourceRow: row.sourceRow,
    studentId: row.studentId,
    studentName: row.studentName,
    status: row.status,
    score: row.score ?? null,
  } : value;
  if (!isPlainObject(record)) {
    issue(issues, path, 'SOURCE_RECORD_INVALID', `${path} must be a flat object when provided`);
    return {};
  }
  const normalized = {};
  const keys = Object.keys(record).sort();
  if (keys.length > MAX_SOURCE_RECORD_KEYS) {
    issue(issues, path, 'SOURCE_RECORD_TOO_WIDE', `${path} may contain at most ${MAX_SOURCE_RECORD_KEYS} keys`);
    return {};
  }
  for (const key of keys) {
    if (typeof key !== 'string' || !key || key.length > 200 || !isScalar(record[key])) {
      issue(issues, `${path}.${key}`, 'SOURCE_RECORD_VALUE_INVALID', 'sourceRecord keys and values must be bounded scalar values');
      continue;
    }
    if (typeof record[key] === 'number' && !Number.isFinite(record[key])) {
      issue(issues, `${path}.${key}`, 'SOURCE_RECORD_VALUE_INVALID', 'sourceRecord numbers must be finite');
      continue;
    }
    if (typeof record[key] === 'string' && record[key].length > MAX_SOURCE_RECORD_VALUE_LENGTH) {
      issue(issues, `${path}.${key}`, 'SOURCE_RECORD_VALUE_INVALID', `sourceRecord strings must be no more than ${MAX_SOURCE_RECORD_VALUE_LENGTH} characters`);
      continue;
    }
    normalized[key] = record[key];
  }
  const snapshot = JSON.stringify(normalized);
  if (snapshot.length > 20_000) issue(issues, path, 'SOURCE_RECORD_TOO_LARGE', `${path} serializes to more than 20000 characters`);
  return normalized;
}

function snapshotOf(record) {
  return JSON.stringify(record);
}

/**
 * Returns every missing or ambiguous input condition without generating a file.
 * The generator turns non-empty issues into a VALIDATION_FAILED error.
 */
export function validateStructuredGrades(input) {
  const issues = [];
  if (!isPlainObject(input)) {
    return { issues: [{ path: 'input', code: 'INPUT_OBJECT_REQUIRED', message: 'input must be an object' }], value: null };
  }

  const sourceKind = requiredEnum(input.sourceKind, SOURCE_KINDS, 'sourceKind', issues);
  const reportScope = requiredEnum(input.reportScope, REPORT_SCOPES, 'reportScope', issues);
  const sourceLabel = optionalText(input.sourceLabel, 'sourceLabel', issues, 1_000);
  const externalReportLabel = reportScope === 'external-anonymized'
    ? requiredText(input.externalReportLabel, 'externalReportLabel', issues, 500)
    : undefined;

  const assessmentInput = isPlainObject(input.assessment) ? input.assessment : null;
  if (!assessmentInput) issue(issues, 'assessment', 'ASSESSMENT_OBJECT_REQUIRED', 'assessment must be an object');
  const assessment = {
    name: requiredText(assessmentInput?.name, 'assessment.name', issues),
    subject: requiredText(assessmentInput?.subject, 'assessment.subject', issues),
    maxScore: requiredFiniteNumber(assessmentInput?.maxScore, 'assessment.maxScore', issues, { strictlyPositive: true }),
    passScore: requiredFiniteNumber(assessmentInput?.passScore, 'assessment.passScore', issues),
    excellentScore: requiredFiniteNumber(assessmentInput?.excellentScore, 'assessment.excellentScore', issues),
  };
  if (assessment.maxScore !== null && assessment.passScore !== null && assessment.passScore > assessment.maxScore) {
    issue(issues, 'assessment.passScore', 'THRESHOLD_ORDER_INVALID', 'passScore must not exceed maxScore');
  }
  if (assessment.maxScore !== null && assessment.excellentScore !== null && assessment.excellentScore > assessment.maxScore) {
    issue(issues, 'assessment.excellentScore', 'THRESHOLD_ORDER_INVALID', 'excellentScore must not exceed maxScore');
  }
  if (assessment.passScore !== null && assessment.excellentScore !== null && assessment.passScore > assessment.excellentScore) {
    issue(issues, 'assessment', 'THRESHOLD_ORDER_INVALID', 'passScore must not exceed excellentScore');
  }

  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    issue(issues, 'rows', 'ROWS_REQUIRED', 'rows must contain at least one structured grade row');
  }
  if (Array.isArray(input.rows) && input.rows.length > MAX_ROWS) {
    issue(issues, 'rows', 'ROWS_TOO_MANY', `rows may contain at most ${MAX_ROWS} records`);
  }
  const rows = Array.isArray(input.rows) && input.rows.length <= MAX_ROWS ? input.rows.map((row, index) => {
    const rowPath = `rows[${index}]`;
    if (!isPlainObject(row)) {
      issue(issues, rowPath, 'ROW_OBJECT_REQUIRED', `${rowPath} must be an object`);
      return null;
    }
    const sourceRow = requiredSourceRow(row.sourceRow, `${rowPath}.sourceRow`, issues);
    const studentId = requiredStudentId(row.studentId, `${rowPath}.studentId`, issues);
    const studentName = requiredText(row.studentName, `${rowPath}.studentName`, issues, 500);
    const status = requiredEnum(row.status, ROW_STATUSES, `${rowPath}.status`, issues);
    const rawScore = row.score;
    let score = null;
    if (status === 'present') {
      score = requiredFiniteNumber(row.score, `${rowPath}.score`, issues);
      if (score !== null && assessment.maxScore !== null && score > assessment.maxScore) {
        issue(issues, `${rowPath}.score`, 'SCORE_OUT_OF_RANGE', `score must not exceed the explicit maxScore of ${assessment.maxScore}`);
      }
    } else if (row.score !== undefined && row.score !== null && row.score !== '') {
      issue(issues, `${rowPath}.score`, 'STATUS_SCORE_CONFLICT', `${rowPath}.score must be blank when status is ${status}`);
    }
    const sourceRecord = normalizeSourceRecord(row.sourceRecord, row, `${rowPath}.sourceRecord`, issues);
    return { inputIndex: index + 1, sourceRow, studentId, studentName, status, score, rawScore, sourceRecord };
  }).filter(Boolean) : [];

  return {
    issues,
    value: issues.length === 0 ? { sourceKind, sourceLabel, reportScope, externalReportLabel, assessment, rows } : null,
  };
}

function classifyScore(score, assessment) {
  if (score >= assessment.excellentScore) return '优秀';
  if (score >= assessment.passScore) return '及格';
  return '未达及格';
}

function reviewRows(input) {
  const occurrences = new Map();
  for (const row of input.rows) occurrences.set(row.studentId, (occurrences.get(row.studentId) ?? 0) + 1);
  return input.rows.map((row) => {
    const duplicateCount = occurrences.get(row.studentId) ?? 0;
    if (duplicateCount > 1) {
      return {
        ...row,
        duplicateCount,
        included: false,
        effectiveScore: null,
        band: '待核对',
        disposition: '待核对：重复学号',
        basis: `学号在本批输入中出现 ${duplicateCount} 条；未自动合并，暂不纳入统计`,
      };
    }
    if (row.status === 'absent') {
      return { ...row, duplicateCount, included: false, effectiveScore: null, band: '不适用', disposition: '缺考，不计零', basis: '状态为 absent；不把缺考默认成零分' };
    }
    if (row.status === 'exempt') {
      return { ...row, duplicateCount, included: false, effectiveScore: null, band: '不适用', disposition: '免考，不计零', basis: '状态为 exempt；免考不纳入本次有效统计' };
    }
    if (row.status === 'blank') {
      return { ...row, duplicateCount, included: false, effectiveScore: null, band: '不适用', disposition: '空白记录，不计零', basis: '状态为 blank；空白记录不以零分代替' };
    }
    return {
      ...row,
      duplicateCount,
      included: true,
      effectiveScore: row.score,
      band: classifyScore(row.score, input.assessment),
      disposition: '纳入统计',
      basis: '状态为 present，分数在明确满分范围内，且学号未重复',
    };
  });
}

function median(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function calculateGradeStatistics(reviewedRows, assessment) {
  if (!isPlainObject(assessment) || typeof assessment.maxScore !== 'number' || !Number.isFinite(assessment.maxScore) || assessment.maxScore <= 0 || assessment.maxScore > MAX_SCORE) {
    throw failure('STATISTICS_OVERFLOW', 'assessment maxScore must remain finite within the supported range');
  }
  const effectiveScores = reviewedRows.filter((row) => row.included).map((row) => row.effectiveScore);
  if (effectiveScores.some((score) => typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > MAX_SCORE)) {
    throw failure('STATISTICS_OVERFLOW', 'effective scores must remain finite within the supported range');
  }
  const effectiveCount = effectiveScores.length;
  const total = effectiveScores.reduce((sum, score) => sum + score, 0);
  if (!Number.isFinite(total)) throw failure('STATISTICS_OVERFLOW', 'effective score total is not finite');
  const mean = effectiveCount === 0 ? null : total / effectiveCount;
  if (mean !== null && !Number.isFinite(mean)) throw failure('STATISTICS_OVERFLOW', 'mean is not finite');
  const result = {
    inputCount: reviewedRows.length,
    effectiveCount,
    excludedCount: reviewedRows.length - effectiveCount,
    mean,
    median: median(effectiveScores),
    scoreRate: mean === null ? null : mean / assessment.maxScore,
    bands: { '未达及格': 0, '及格': 0, '优秀': 0 },
  };
  if (result.scoreRate !== null && !Number.isFinite(result.scoreRate)) throw failure('STATISTICS_OVERFLOW', 'score rate is not finite');
  for (const score of effectiveScores) result.bands[classifyScore(score, assessment)] += 1;
  return result;
}

function columnName(index) {
  let name = '';
  for (let number = index; number > 0; number = Math.floor((number - 1) / 26)) name = String.fromCharCode(65 + ((number - 1) % 26)) + name;
  return name;
}

function styleTitle(sheet, title, subtitle, columnCount) {
  const lastColumn = columnName(columnCount);
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.mergeCells(`A2:${lastColumn}2`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = { name: WORKBOOK_FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${TITLE_FILL}` } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  const subtitleCell = sheet.getCell('A2');
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: WORKBOOK_FONT, size: 10, color: { argb: 'FF44546A' } };
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7FA' } };
  subtitleCell.alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 26;
}

function styleHeader(row) {
  row.font = { name: WORKBOOK_FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_FILL}` } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 28;
}

function styleTable(sheet, headers, values, widths, options = {}) {
  const headerRow = options.headerRow ?? 1;
  const header = sheet.getRow(headerRow);
  header.values = headers;
  styleHeader(header);
  values.forEach((value) => sheet.addRow(value));
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  sheet.autoFilter = { from: `A${headerRow}`, to: `${columnName(headers.length)}${headerRow}` };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let rowNumber = headerRow + 1; rowNumber <= headerRow + values.length; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.font = { name: WORKBOOK_FONT, size: 10, color: { argb: 'FF1F2937' } };
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9E2F0' } } };
    });
    if ((rowNumber - headerRow) % 2 === 0) {
      row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FBFF' } }; });
    }
  }
}

function setFormula(sheet, address, formula, result, numberFormat) {
  const cell = sheet.getCell(address);
  cell.value = { formula, result };
  if (numberFormat) cell.numFmt = numberFormat;
  return cell;
}

function configureWorkbook(workbook, { reportScope, assessment }) {
  workbook.creator = 'Mochi Grades';
  workbook.lastModifiedBy = 'Mochi Grades';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  if (reportScope === 'external-anonymized') {
    workbook.title = '匿名成绩汇总';
    workbook.subject = '匿名成绩汇总';
    workbook.description = 'Anonymized aggregate grade summary without student identity or raw rows.';
  } else {
    workbook.title = assessment.name;
    workbook.subject = assessment.subject;
    workbook.description = 'Teacher-internal grade audit generated from structured input.';
  }
}

function writeInternalReport(sheet, input, reviewedRows, stats) {
  styleTitle(sheet, '成绩统计报告', '教师内部版本：含可复核逐行审计。统计由程序计算；复算公式只引用本工作簿的有效分数列。', 4);
  sheet.columns = [{ width: 25 }, { width: 19 }, { width: 20 }, { width: 48 }];
  const rows = [
    ['考试名称', input.assessment.name, '', ''],
    ['科目', input.assessment.subject, '', ''],
    ['来源标签', input.sourceLabel ?? '未提供', '', ''],
    ['报告范围', '教师内部', '', ''],
    ['满分', input.assessment.maxScore, '', '明确输入，不由模块猜测'],
    ['及格线', input.assessment.passScore, '', '明确输入，不由模块猜测'],
    ['优秀线', input.assessment.excellentScore, '', '明确输入，不由模块猜测'],
  ];
  const policyHeader = sheet.getRow(3);
  policyHeader.values = ['项目', '值', '口径', '说明'];
  styleHeader(policyHeader);
  rows.forEach((values) => sheet.addRow(values));
  for (let index = 4; index <= 10; index += 1) {
    const row = sheet.getRow(index);
    row.font = { name: WORKBOOK_FONT, size: 10, color: { argb: 'FF1F2937' } };
    row.alignment = { vertical: 'middle', wrapText: true };
    if (index % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FBFF' } };
  }
  sheet.getCell('B8').numFmt = '0.00';
  sheet.getCell('B9').numFmt = '0.00';
  sheet.getCell('B10').numFmt = '0.00';

  const auditLastRow = reviewedRows.length + 1;
  const effectiveRange = `'逐行审计'!$K$2:$K$${auditLastRow}`;
  const includedRange = `'逐行审计'!$J$2:$J$${auditLastRow}`;
  sheet.getRow(12).values = ['统计指标', '复算值（公式）', '程序计算值', '口径'];
  styleHeader(sheet.getRow(12));
  const summaryRows = [
    ['输入记录数', `=COUNTA('逐行审计'!$A$2:$A$${auditLastRow})`, stats.inputCount, '所有结构化输入行'],
    ['有效人数', `=COUNT(${effectiveRange})`, stats.effectiveCount, '仅状态为 present、学号未重复的有效分数'],
    ['不纳入统计', '=B13-B14', stats.excludedCount, '缺考、免考、空白与重复学号均不以零分代替'],
    ['均值', `=IF(B14=0,"",AVERAGE(${effectiveRange}))`, stats.mean, '有效分数算术平均'],
    ['中位数', `=IF(B14=0,"",MEDIAN(${effectiveRange}))`, stats.median, '有效分数排序后的中位位置'],
    ['得分率', '=IF(B14=0,"",B16/B8)', stats.scoreRate, '均值除以明确满分'],
  ];
  for (let index = 0; index < summaryRows.length; index += 1) {
    const rowIndex = 13 + index;
    const [label, formula, result, basis] = summaryRows[index];
    sheet.getCell(`A${rowIndex}`).value = label;
    setFormula(sheet, `B${rowIndex}`, formula, result, label === '得分率' ? '0.0%' : '0.00');
    sheet.getCell(`C${rowIndex}`).value = result;
    sheet.getCell(`C${rowIndex}`).numFmt = label === '得分率' ? '0.0%' : '0.00';
    sheet.getCell(`D${rowIndex}`).value = basis;
  }
  sheet.getRow(21).values = ['分数段', '复算值（公式）', '程序计算值', '范围'];
  styleHeader(sheet.getRow(21));
  const bands = [
    ['未达及格', `=COUNTIFS(${includedRange},"是",${effectiveRange},">=0",${effectiveRange},"<"&$B$9)`, stats.bands['未达及格'], `[0, ${input.assessment.passScore})`],
    ['及格', `=COUNTIFS(${includedRange},"是",${effectiveRange},">="&$B$9,${effectiveRange},"<"&$B$10)`, stats.bands['及格'], `[${input.assessment.passScore}, ${input.assessment.excellentScore})`],
    ['优秀', `=COUNTIFS(${includedRange},"是",${effectiveRange},">="&$B$10)`, stats.bands['优秀'], `[${input.assessment.excellentScore}, ${input.assessment.maxScore}]`],
  ];
  for (let index = 0; index < bands.length; index += 1) {
    const rowIndex = 22 + index;
    const [label, formula, result, range] = bands[index];
    sheet.getCell(`A${rowIndex}`).value = label;
    setFormula(sheet, `B${rowIndex}`, formula, result, '#,##0');
    sheet.getCell(`C${rowIndex}`).value = result;
    sheet.getCell(`C${rowIndex}`).numFmt = '#,##0';
    sheet.getCell(`D${rowIndex}`).value = range;
  }
  sheet.mergeCells('A27:D27');
  sheet.getCell('A27').value = '本报告只呈现总分统计，未由总分推断知识点、态度或能力。需要题目或知识点分析时，必须另有题目满分和已确认的知识点资料。';
  sheet.getCell('A27').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7E6' } };
  sheet.getCell('A27').font = { name: WORKBOOK_FONT, size: 10, color: { argb: 'FF1F2937' } };
  sheet.getCell('A27').alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(27).height = 36;
  for (let rowIndex = 13; rowIndex <= 24; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.font = { name: WORKBOOK_FONT, size: 10, color: { argb: 'FF1F2937' } };
    row.alignment = { vertical: 'middle', wrapText: true };
    if (rowIndex % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FBFF' } };
  }
  sheet.views = [{ state: 'frozen', ySplit: 3 }];
}

function writeAuditSheet(sheet, reviewedRows) {
  const headers = ['输入序号', '来源行标识', '学号', '姓名', '状态', '原始分数', '重复学号记录数', '统计处理', '处理依据', '纳入统计', '有效分数', '分数段', '原始输入 JSON'];
  const values = reviewedRows.map((row) => [
    row.inputIndex,
    row.sourceRow,
    row.studentId,
    row.studentName,
    row.status,
    row.rawScore === undefined ? null : row.rawScore,
    row.duplicateCount,
    row.disposition,
    row.basis,
    row.included ? '是' : '否',
    row.effectiveScore,
    row.band,
    snapshotOf(row.sourceRecord),
  ]);
  styleTable(sheet, headers, values, [11, 16, 18, 16, 12, 13, 17, 20, 49, 12, 13, 13, 60]);
  sheet.getColumn(3).numFmt = '@';
  sheet.getColumn(6).numFmt = '0.00';
  sheet.getColumn(11).numFmt = '0.00';
  sheet.getColumn(13).alignment = { vertical: 'top', wrapText: true };
}

function writeRawSheet(sheet, reviewedRows) {
  const headers = ['输入序号', '来源行标识', '学号', '姓名', '状态', '原始分数', '原始输入 JSON'];
  const values = reviewedRows.map((row) => [
    row.inputIndex,
    row.sourceRow,
    row.studentId,
    row.studentName,
    row.status,
    row.rawScore === undefined ? null : row.rawScore,
    snapshotOf(row.sourceRecord),
  ]);
  styleTable(sheet, headers, values, [11, 16, 18, 16, 12, 13, 70]);
  sheet.getColumn(3).numFmt = '@';
  sheet.getColumn(6).numFmt = '0.00';
  sheet.getColumn(7).alignment = { vertical: 'top', wrapText: true };
}

function writeExternalReport(sheet, input, stats) {
  styleTitle(sheet, '匿名成绩汇总', input.externalReportLabel, 3);
  sheet.columns = [{ width: 27 }, { width: 20 }, { width: 48 }];
  sheet.getRow(4).values = ['项目', '值', '说明'];
  styleHeader(sheet.getRow(4));
  const rows = [
    ['满分', input.assessment.maxScore, '明确输入'],
    ['及格线', input.assessment.passScore, '明确输入'],
    ['优秀线', input.assessment.excellentScore, '明确输入'],
    ['输入记录数', stats.inputCount, '不含任何个人身份字段'],
    ['有效人数', stats.effectiveCount, '仅状态为 present、学号未重复的有效分数'],
    ['不纳入统计', stats.excludedCount, '缺考、免考、空白与重复学号均不以零分代替'],
    ['均值', stats.mean, '由程序计算'],
    ['中位数', stats.median, '由程序计算'],
    ['得分率', stats.scoreRate, '均值除以明确满分'],
    ['未达及格', stats.bands['未达及格'], `[0, ${input.assessment.passScore})`],
    ['及格', stats.bands['及格'], `[${input.assessment.passScore}, ${input.assessment.excellentScore})`],
    ['优秀', stats.bands['优秀'], `[${input.assessment.excellentScore}, ${input.assessment.maxScore}]`],
  ];
  rows.forEach((row) => sheet.addRow(row));
  for (let rowIndex = 5; rowIndex < 5 + rows.length; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.font = { name: WORKBOOK_FONT, size: 10, color: { argb: 'FF1F2937' } };
    row.alignment = { vertical: 'middle', wrapText: true };
    if (rowIndex % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FBFF' } };
  }
  for (const address of ['B5', 'B6', 'B7', 'B11', 'B12']) sheet.getCell(address).numFmt = '0.00';
  sheet.getCell('B13').numFmt = '0.0%';
  sheet.mergeCells('A19:C19');
  sheet.getCell('A19').value = '此版本不包含姓名、学号、原始行、来源标签或其他个人身份信息；它也不从总分推断知识点、态度或能力。';
  sheet.getCell('A19').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7E6' } };
  sheet.getCell('A19').font = { name: WORKBOOK_FONT, size: 10, color: { argb: 'FF1F2937' } };
  sheet.getCell('A19').alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(19).height = 34;
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
}

function createWorkbook(input, reviewedRows, stats) {
  const workbook = new ExcelJS.Workbook();
  configureWorkbook(workbook, input);
  if (input.reportScope === 'teacher-internal') {
    const report = workbook.addWorksheet('统计报告', { properties: { tabColor: { argb: 'FF1D4ED8' } } });
    const audit = workbook.addWorksheet('逐行审计', { properties: { tabColor: { argb: 'FF0F766E' } } });
    const raw = workbook.addWorksheet('原始行', { properties: { tabColor: { argb: 'FF64748B' } } });
    writeAuditSheet(audit, reviewedRows);
    writeRawSheet(raw, reviewedRows);
    writeInternalReport(report, input, reviewedRows, stats);
  } else {
    const report = workbook.addWorksheet('匿名汇总', { properties: { tabColor: { argb: 'FF1D4ED8' } } });
    writeExternalReport(report, input, stats);
  }
  return workbook;
}

function expectedSheetNames(reportScope) {
  return reportScope === 'teacher-internal' ? ['统计报告', '逐行审计', '原始行'] : ['匿名汇总'];
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw failure('ABORTED', 'grade workbook generation was cancelled');
}

async function checkpoint(signal) {
  throwIfAborted(signal);
  await Promise.resolve();
  throwIfAborted(signal);
}

function resolveOutputDirectory(outputDirectory) {
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory)) {
    throw failure('INVALID_OUTPUT_DIRECTORY', 'outputDirectory must be an absolute host-authorized path');
  }
  const target = resolve(outputDirectory);
  if (target === dirname(target)) throw failure('INVALID_OUTPUT_DIRECTORY', 'outputDirectory must not be a filesystem root');
  return target;
}

async function claimOutputDirectory(target) {
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await mkdir(target, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw failure('OUTPUT_EXISTS', 'outputDirectory already exists and will not be overwritten');
    throw failure('OUTPUT_UNAVAILABLE', 'outputDirectory could not be created exclusively');
  }
  const claimId = randomUUID();
  const claimPath = join(target, CLAIM_FILENAME);
  try {
    await writeFile(claimPath, JSON.stringify({ claimId, status: 'in-progress' }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rmdir(target).catch(() => {});
    throw failure('OUTPUT_UNAVAILABLE', 'outputDirectory could not be claimed');
  }
  return { target, claimPath, claimId, ownedPaths: new Set([claimPath]) };
}

async function cleanupClaim(claim) {
  if (!claim) return;
  let owned = claim.claimReleased === true;
  if (!owned) {
    try {
      const current = JSON.parse(await readFile(claim.claimPath, 'utf8'));
      owned = current?.claimId === claim.claimId;
    } catch {
      owned = false;
    }
  }
  if (!owned) return;
  for (const path of [...claim.ownedPaths].reverse()) await rm(path, { force: true }).catch(() => {});
  await rm(claim.claimPath, { force: true }).catch(() => {});
  await rmdir(claim.target).catch(() => {});
}

async function verifyWorkbook(path, sheetNames) {
  const bytes = await readFile(path);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw failure('OUTPUT_VERIFICATION_FAILED', 'generated XLSX does not have a ZIP container signature');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    throw failure('OUTPUT_VERIFICATION_FAILED', 'generated XLSX could not be reopened by ExcelJS');
  }
  const actualNames = workbook.worksheets.map((sheet) => sheet.name);
  if (JSON.stringify(actualNames) !== JSON.stringify(sheetNames)) {
    throw failure('OUTPUT_VERIFICATION_FAILED', 'generated XLSX does not contain the expected sheets');
  }
  return { bytes, sha256: sha256(bytes) };
}

function createManifest(input, stats, workbookFile, verification) {
  const base = {
    schemaVersion: 1,
    status: 'verified-awaiting-completion-marker',
    reportScope: input.reportScope,
    sourceKind: input.sourceKind,
    inputRows: stats.inputCount,
    effectiveRows: stats.effectiveCount,
    excludedRows: stats.excludedCount,
    statistics: stats,
    files: {
      workbook: { name: workbookFile, bytes: verification.bytes.length, sha256: verification.sha256 },
    },
  };
  if (input.reportScope === 'teacher-internal') {
    base.assessment = { ...input.assessment };
    if (input.sourceLabel) base.sourceLabel = input.sourceLabel;
  } else {
    base.externalReportLabel = input.externalReportLabel;
  }
  return base;
}

/**
 * Generates exactly one scope-safe workbook. The target directory must not exist;
 * a caller that needs internal and external versions invokes this function twice.
 */
export async function generateGradeWorkbook({ grades, outputDirectory, signal } = {}) {
  throwIfAborted(signal);
  const validation = validateStructuredGrades(grades);
  if (validation.issues.length > 0) {
    throw failure('VALIDATION_FAILED', 'grade input has unresolved validation issues', validation.issues);
  }
  const input = validation.value;
  const target = resolveOutputDirectory(outputDirectory);
  let claim;
  try {
    claim = await claimOutputDirectory(target);
    await checkpoint(signal);
    const reviewedRows = reviewRows(input);
    const stats = calculateGradeStatistics(reviewedRows, input.assessment);
    const workbook = createWorkbook(input, reviewedRows, stats);
    const workbookFilename = input.reportScope === 'teacher-internal' ? INTERNAL_WORKBOOK_FILENAME : EXTERNAL_WORKBOOK_FILENAME;
    const temporaryWorkbookPath = join(target, `.${workbookFilename}.${claim.claimId}.partial`);
    const workbookPath = join(target, workbookFilename);
    const workbookBytes = Buffer.from(await workbook.xlsx.writeBuffer());
    await checkpoint(signal);
    await writeFile(temporaryWorkbookPath, workbookBytes, { flag: 'wx', mode: 0o600 });
    claim.ownedPaths.add(temporaryWorkbookPath);
    await verifyWorkbook(temporaryWorkbookPath, expectedSheetNames(input.reportScope));
    await checkpoint(signal);
    await rename(temporaryWorkbookPath, workbookPath);
    claim.ownedPaths.add(workbookPath);
    const verification = await verifyWorkbook(workbookPath, expectedSheetNames(input.reportScope));
    await checkpoint(signal);

    const manifestPath = join(target, MANIFEST_FILENAME);
    const temporaryManifestPath = join(target, `.${MANIFEST_FILENAME}.${claim.claimId}.partial`);
    const manifest = createManifest(input, stats, workbookFilename, verification);
    await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    claim.ownedPaths.add(temporaryManifestPath);
    await rename(temporaryManifestPath, manifestPath);
    claim.ownedPaths.add(manifestPath);
    await checkpoint(signal);

    const completionPath = join(target, COMPLETION_FILENAME);
    await rm(claim.claimPath, { force: true });
    claim.claimReleased = true;
    claim.ownedPaths.delete(claim.claimPath);
    await writeFile(completionPath, `${JSON.stringify({ status: 'completed', reportScope: input.reportScope, workbook: workbookFilename, sha256: verification.sha256 })}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    claim.ownedPaths.add(completionPath);
    return {
      status: 'completed',
      reportScope: input.reportScope,
      outputDirectory: target,
      workbookPath,
      manifestPath,
      completionPath,
      statistics: stats,
    };
  } catch (error) {
    await cleanupClaim(claim);
    if (error instanceof MochiGradesError) throw error;
    throw failure('OUTPUT_WRITE_FAILED', 'grade workbook generation failed before completion');
  }
}
