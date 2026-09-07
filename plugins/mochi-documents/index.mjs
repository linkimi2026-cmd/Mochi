/**
 * Local, host-controlled document production from already-authorized structured
 * content.  This module intentionally has no OCR, model, session, UI, network,
 * or shell-string surface.
 */
import { access, link, mkdir, mkdtemp, readFile, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeightRule,
  HeadingLevel,
  LineRuleType,
  Math as MathEquation,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSuperScript,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { PDFDocument } from 'pdf-lib';
import {
  A4_PAGE_SIZE,
  color as pdfColor,
  createPdfLayoutDocument,
  drawTable,
  drawTextBlock,
  inspectPdfArtifact,
  layoutTable,
  savePdfLayoutDocument,
  wrapText,
} from '@mochi/pdf-layout';

export const DEFAULT_SOFFICE_PATH = '/opt/homebrew/bin/soffice';
export const DEFAULT_CONVERTER_TIMEOUT_MS = 90_000;
const MAX_CONVERTER_TIMEOUT_MS = 300_000;
const FORCE_KILL_DELAY_MS = 1_000;
const MAX_PAGES = 50;
const MAX_BLOCKS_PER_PAGE = 100;
const MAX_TABLE_COLUMNS = 30;
const MAX_TABLE_ROWS = 300;
const MAX_DOUBTS = 500;
const OUTPUT_DOCX_FILENAME = 'document.docx';
const OUTPUT_PDF_FILENAME = 'document.pdf';
const OUTPUT_FILENAMES = [
  OUTPUT_DOCX_FILENAME,
  OUTPUT_PDF_FILENAME,
  'questions.json',
  'checklist.json',
  'manifest.json',
];
const DOCUMENT_FONT = 'Noto Sans SC';
const MACOS_FONT_DIRECTORIES = [
  '/System/Library/Fonts',
  '/Library/Fonts',
];
const GENERIC_TEMPLATE = 'generic';
const SICHUAN_2026_EXAM_TEMPLATE = 'sichuan-2026-high-school-exam-base';
const MAX_EXAM_SECTIONS = 12;
const MAX_EXAM_QUESTIONS_PER_SECTION = 60;
const MAX_EXAM_INLINE_NODES = 80;
const MAX_MATH_CHILDREN = 40;
const MAX_MATH_DEPTH = 8;
const MAX_CHEMISTRY_TOKENS = 120;
const EXAM_BODY_SIZE = 24;
const EXAM_NOTE_SIZE = 18;
const EXAM_MINIMUM_LINE_HEIGHT_TWIPS = 410;
const EXAM_MINIMUM_LINE_HEIGHT_PT = 20.5;
const EXAM_MINIMUM_ADDITIONAL_LEADING_PT = 8.5;
const EXAM_TEXT_FONT = {
  ascii: 'Times New Roman',
  hAnsi: 'Times New Roman',
  eastAsia: 'Songti SC',
  cs: 'Times New Roman',
};
const EXAM_REQUIRED_FONT_FILES = [
  { family: 'Songti SC', path: '/System/Library/Fonts/Supplemental/Songti.ttc' },
  { family: 'Times New Roman', path: '/System/Library/Fonts/Supplemental/Times New Roman.ttf' },
];
const EXAM_LAYOUT = {
  paper: 'A4',
  widthDxa: 11_906,
  heightDxa: 16_838,
  marginsDxa: {
    top: 1_100,
    right: 1_000,
    bottom: 1_000,
    left: 1_000,
    header: 500,
    footer: 500,
    gutter: 600,
  },
  bodyFontSizePt: 12,
  noteFontSizePt: 9,
  minimumLineHeightTwips: EXAM_MINIMUM_LINE_HEIGHT_TWIPS,
  minimumLineHeightPt: EXAM_MINIMUM_LINE_HEIGHT_PT,
  minimumAdditionalLeadingPt: EXAM_MINIMUM_ADDITIONAL_LEADING_PT,
  lineHeightRule: LineRuleType.AT_LEAST,
};

export class MochiDocumentsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MochiDocumentsError';
    this.code = code;
  }
}

function failure(code, message) {
  return new MochiDocumentsError(code, message);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value, label, maxLength = 20_000) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw failure('INVALID_INPUT', `${label} must be a non-empty string within ${maxLength} characters`);
  }
  return value.trim();
}

function optionalText(value, label, maxLength = 2_000) {
  if (value === undefined) return undefined;
  return requiredText(value, label, maxLength);
}

function tableCellText(value, label, maxLength = 10_000) {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw failure('INVALID_INPUT', `${label} must be a string within ${maxLength} characters`);
  }
  return value;
}

function requiredArray(value, label, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw failure('INVALID_INPUT', `${label} must contain ${minimum} to ${maximum} item(s)`);
  }
  return value;
}

function finiteInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw failure('INVALID_INPUT', `${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function finiteUnit(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw failure('INVALID_INPUT', `${label} must be a number from 0 to 1`);
  }
  return value;
}

function formulaText(value, label, maxLength = 2_000) {
  const text = requiredText(value, label, maxLength);
  if (text.includes('\\') || text.includes('$')) {
    throw failure('INVALID_INPUT', `${label} must use the structured formula AST, not a LaTeX source string`);
  }
  return text;
}

function validateMathNodes(value, label, depth = 0) {
  if (depth > MAX_MATH_DEPTH) throw failure('INVALID_INPUT', `${label} exceeds the supported formula nesting depth`);
  return requiredArray(value, label, 1, MAX_MATH_CHILDREN)
    .map((node, index) => validateMathNode(node, `${label}[${index}]`, depth));
}

function validateMathNode(node, label, depth) {
  if (!isObject(node)) throw failure('INVALID_INPUT', `${label} must be a formula node object`);
  if (node.kind === 'text') return { kind: 'text', text: formulaText(node.text, `${label}.text`) };
  if (node.kind === 'sub' || node.kind === 'sup') {
    return {
      kind: node.kind,
      base: validateMathNodes(node.base, `${label}.base`, depth + 1),
      script: validateMathNodes(node.script, `${label}.script`, depth + 1),
    };
  }
  if (node.kind === 'fraction') {
    return {
      kind: 'fraction',
      numerator: validateMathNodes(node.numerator, `${label}.numerator`, depth + 1),
      denominator: validateMathNodes(node.denominator, `${label}.denominator`, depth + 1),
    };
  }
  if (node.kind === 'root') {
    return { kind: 'root', radicand: validateMathNodes(node.radicand, `${label}.radicand`, depth + 1) };
  }
  throw failure('INVALID_INPUT', `${label}.kind must be text, sub, sup, fraction, or root`);
}

function validateChemistryTokens(value, label) {
  return requiredArray(value, label, 1, MAX_CHEMISTRY_TOKENS).map((token, index) => {
    const tokenLabel = `${label}[${index}]`;
    if (!isObject(token)) throw failure('INVALID_INPUT', `${tokenLabel} must be a chemistry token object`);
    if (token.kind === 'text') return { kind: 'text', text: formulaText(token.text, `${tokenLabel}.text`, 500) };
    if (token.kind === 'sub' || token.kind === 'sup') return { kind: token.kind, text: formulaText(token.text, `${tokenLabel}.text`, 100) };
    if (token.kind === 'arrow' && token.direction === 'forward') return { kind: 'arrow', direction: 'forward' };
    throw failure('INVALID_INPUT', `${tokenLabel}.kind must be text, sub, sup, or a forward arrow`);
  });
}

function validateUprightUnit(node, label) {
  const text = formulaText(node.text, `${label}.text`, 60);
  const solidusCount = [...text].filter((character) => character === '/').length;
  if (!/^[A-Za-zµμΩ°′″]+(?:[·/][A-Za-zµμΩ°′″]+)*$/u.test(text) || solidusCount > 1) {
    throw failure('INVALID_INPUT', `${label}.text must use bounded unit-symbol characters and centered dots or a single solidus`);
  }
  const exponent = node.exponent === undefined ? undefined : formulaText(node.exponent, `${label}.exponent`, 8);
  if (exponent !== undefined && !/^[−+-]?\d{1,2}$/u.test(exponent)) {
    throw failure('INVALID_INPUT', `${label}.exponent must be a signed one- or two-digit exponent`);
  }
  return { kind: 'upright-unit', text, exponent };
}

function validateExamInline(node, label) {
  if (!isObject(node)) throw failure('INVALID_INPUT', `${label} must be an inline object`);
  if (node.kind === 'text') return { kind: 'text', text: requiredText(node.text, `${label}.text`, 4_000) };
  if (node.kind === 'math') return { kind: 'math', expression: validateMathNodes(node.expression, `${label}.expression`) };
  if (node.kind === 'chemistry') return { kind: 'chemistry', tokens: validateChemistryTokens(node.tokens, `${label}.tokens`) };
  if (node.kind === 'upright-unit') return validateUprightUnit(node, label);
  throw failure('INVALID_INPUT', `${label}.kind must be text, math, chemistry, or upright-unit`);
}

function validateExamQuestion(question, sectionIndex, questionIndex) {
  const label = `exam.sections[${sectionIndex}].questions[${questionIndex}]`;
  if (!isObject(question)) throw failure('INVALID_INPUT', `${label} must be an object`);
  let answerArea;
  if (question.answerArea !== undefined) {
    if (!isObject(question.answerArea)) throw failure('INVALID_INPUT', `${label}.answerArea must be an object`);
    answerArea = {
      lines: finiteInteger(question.answerArea.lines, `${label}.answerArea.lines`, 1, 20),
      label: optionalText(question.answerArea.label, `${label}.answerArea.label`, 100) ?? '答题区',
    };
  }
  return {
    number: requiredText(question.number, `${label}.number`, 30),
    score: question.score === undefined ? undefined : finiteInteger(question.score, `${label}.score`, 0, 100),
    prompt: requiredArray(question.prompt, `${label}.prompt`, 1, MAX_EXAM_INLINE_NODES)
      .map((node, inlineIndex) => validateExamInline(node, `${label}.prompt[${inlineIndex}]`)),
    answerArea,
  };
}

function validateExam(exam) {
  if (!isObject(exam)) throw failure('INVALID_INPUT', 'exam must be an object when using the Sichuan 2026 exam template');
  return {
    subject: requiredText(exam.subject, 'exam.subject', 100),
    sourcePageCount: finiteInteger(exam.sourcePageCount ?? 1, 'exam.sourcePageCount', 1, MAX_PAGES),
    sections: requiredArray(exam.sections, 'exam.sections', 1, MAX_EXAM_SECTIONS).map((section, sectionIndex) => {
      const label = `exam.sections[${sectionIndex}]`;
      if (!isObject(section)) throw failure('INVALID_INPUT', `${label} must be an object`);
      return {
        title: requiredText(section.title, `${label}.title`, 500),
        questions: requiredArray(section.questions, `${label}.questions`, 1, MAX_EXAM_QUESTIONS_PER_SECTION)
          .map((question, questionIndex) => validateExamQuestion(question, sectionIndex, questionIndex)),
      };
    }),
  };
}

function validateTemplate(value) {
  const kind = value ?? GENERIC_TEMPLATE;
  if (kind === GENERIC_TEMPLATE) return { kind: GENERIC_TEMPLATE };
  if (kind === SICHUAN_2026_EXAM_TEMPLATE) {
    return {
      kind: SICHUAN_2026_EXAM_TEMPLATE,
      targetRegion: 'Sichuan',
      targetExamYear: 2026,
      officialSampleStatus: 'pending-review',
      standardStatus: 'electronic-typography-support-only',
      layout: {
        paper: EXAM_LAYOUT.paper,
        bodyFontSizePt: EXAM_LAYOUT.bodyFontSizePt,
        noteFontSizePt: EXAM_LAYOUT.noteFontSizePt,
        minimumLineHeightTwips: EXAM_LAYOUT.minimumLineHeightTwips,
        minimumLineHeightPt: EXAM_LAYOUT.minimumLineHeightPt,
        minimumAdditionalLeadingPt: EXAM_LAYOUT.minimumAdditionalLeadingPt,
        lineHeightRule: EXAM_LAYOUT.lineHeightRule,
        bindingGutterDxa: EXAM_LAYOUT.marginsDxa.gutter,
      },
    };
  }
  throw failure('INVALID_INPUT', 'template must be generic or sichuan-2026-high-school-exam-base');
}

function validateBlock(block, pageNumber, blockNumber) {
  if (!isObject(block)) throw failure('INVALID_INPUT', `pages[${pageNumber}].blocks[${blockNumber}] must be an object`);
  if (block.kind === 'heading') {
    return {
      kind: 'heading',
      level: finiteInteger(block.level ?? 1, `heading level at page ${pageNumber}`, 1, 2),
      text: requiredText(block.text, `heading at page ${pageNumber}`),
    };
  }
  if (block.kind === 'paragraph') {
    return { kind: 'paragraph', text: requiredText(block.text, `paragraph at page ${pageNumber}`) };
  }
  if (block.kind === 'table') {
    const columns = requiredArray(block.columns, `table columns at page ${pageNumber}`, 1, MAX_TABLE_COLUMNS).map((column, index) => requiredText(column, `table column ${index + 1} at page ${pageNumber}`, 500));
    const rows = requiredArray(block.rows, `table rows at page ${pageNumber}`, 1, MAX_TABLE_ROWS).map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== columns.length) {
        throw failure('INVALID_INPUT', `table row ${rowIndex + 1} at page ${pageNumber} must match the column count`);
      }
      return row.map((cell, cellIndex) => tableCellText(cell, `table cell ${rowIndex + 1}:${cellIndex + 1} at page ${pageNumber}`));
    });
    return { kind: 'table', columns, rows };
  }
  throw failure('INVALID_INPUT', `unsupported block kind at page ${pageNumber}; images and unstructured page renders are not accepted`);
}

function validateDoubt(doubt, index, pageCount) {
  if (!isObject(doubt)) throw failure('INVALID_INPUT', `doubts[${index}] must be an object`);
  const question = requiredText(doubt.question, `doubts[${index}].question`, 10_000);
  if (!isObject(doubt.source)) throw failure('INVALID_INPUT', `doubts[${index}].source must be an object`);
  if (doubt.source.kind === 'unknown') return { id: `question-${index + 1}`, question, source: { kind: 'unknown' } };
  if (doubt.source.kind !== 'normalized-region') {
    throw failure('INVALID_INPUT', `doubts[${index}].source must be normalized-region or unknown`);
  }
  const page = finiteInteger(doubt.source.page, `doubts[${index}].source.page`, 1, pageCount);
  const x = finiteUnit(doubt.source.x, `doubts[${index}].source.x`);
  const y = finiteUnit(doubt.source.y, `doubts[${index}].source.y`);
  const width = finiteUnit(doubt.source.width, `doubts[${index}].source.width`);
  const height = finiteUnit(doubt.source.height, `doubts[${index}].source.height`);
  if (width === 0 || height === 0 || x + width > 1 || y + height > 1) {
    throw failure('INVALID_INPUT', `doubts[${index}].source region must fit within page bounds`);
  }
  return { id: `question-${index + 1}`, question, source: { kind: 'normalized-region', page, x, y, width, height } };
}

/**
 * Validates the only input this package accepts: a host-provided, structured
 * representation after any authorization and recognition work has happened.
 */
export function validateStructuredDocument(input) {
  if (!isObject(input)) throw failure('INVALID_INPUT', 'document input must be an object');
  const sourceKind = input.sourceKind;
  if (sourceKind !== 'upstream-authorized-structured-content' && sourceKind !== 'demonstration') {
    throw failure('INVALID_INPUT', 'sourceKind must declare upstream-authorized-structured-content or demonstration');
  }
  const template = validateTemplate(input.template);
  const common = {
    title: requiredText(input.title, 'title', 500),
    sourceKind,
    sourceLabel: optionalText(input.sourceLabel, 'sourceLabel', 500),
    template,
  };
  if (template.kind === GENERIC_TEMPLATE) {
    if (input.exam !== undefined) throw failure('INVALID_INPUT', 'exam is only accepted by the Sichuan 2026 exam template');
    const pages = requiredArray(input.pages, 'pages', 1, MAX_PAGES).map((page, pageIndex) => {
      if (!isObject(page)) throw failure('INVALID_INPUT', `pages[${pageIndex}] must be an object`);
      return {
        blocks: requiredArray(page.blocks, `pages[${pageIndex}].blocks`, 1, MAX_BLOCKS_PER_PAGE).map((block, blockIndex) => validateBlock(block, pageIndex + 1, blockIndex + 1)),
      };
    });
    return {
      ...common,
      pages,
      sourcePageCount: pages.length,
      doubts: requiredArray(input.doubts ?? [], 'doubts', 0, MAX_DOUBTS)
        .map((doubt, index) => validateDoubt(doubt, index, pages.length)),
    };
  }

  if (input.pages !== undefined) throw failure('INVALID_INPUT', 'pages are not accepted by the Sichuan 2026 exam template; use exam.sections');
  const exam = validateExam(input.exam);
  return {
    ...common,
    pages: [],
    sourcePageCount: exam.sourcePageCount,
    exam,
    doubts: requiredArray(input.doubts ?? [], 'doubts', 0, MAX_DOUBTS)
      .map((doubt, index) => validateDoubt(doubt, index, exam.sourcePageCount)),
  };
}

function textRun(text, options = {}) {
  return new TextRun({
    text,
    font: DOCUMENT_FONT,
    size: options.size ?? 22,
    bold: options.bold ?? false,
    color: options.color ?? '111827',
  });
}

function bodyParagraph(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 150, line: 340 },
    children: [textRun(text)],
  });
}

function tableCell(text, { header = false, width }) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    shading: header ? { type: ShadingType.CLEAR, fill: '1D4ED8', color: 'auto' } : { type: ShadingType.CLEAR, fill: 'FFFFFF', color: 'auto' },
    children: [new Paragraph({
      alignment: header ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { line: 300 },
      children: [textRun(text, { size: 20, bold: header, color: header ? 'FFFFFF' : '111827' })],
    })],
  });
}

function documentTable(block) {
  const totalWidth = 8_900;
  const baseWidth = Math.floor(totalWidth / block.columns.length);
  const columnWidths = block.columns.map((_, index) => index === block.columns.length - 1 ? totalWidth - baseWidth * index : baseWidth);
  const borders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
  };
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: block.columns.map((column, index) => tableCell(column, { header: true, width: columnWidths[index] })) }),
      ...block.rows.map((row) => new TableRow({ children: row.map((cell, index) => tableCell(cell, { width: columnWidths[index] })) })),
    ],
  });
}

function examTextRun(text, options = {}) {
  return new TextRun({
    text,
    font: EXAM_TEXT_FONT,
    size: options.size ?? EXAM_BODY_SIZE,
    bold: options.bold ?? false,
    color: options.color ?? '111111',
    subScript: options.subScript ?? false,
    superScript: options.superScript ?? false,
    italics: options.italics ?? false,
  });
}

function mathComponents(nodes) {
  return nodes.map((node) => {
    if (node.kind === 'text') return new MathRun(node.text);
    if (node.kind === 'sub') {
      return new MathSubScript({ children: mathComponents(node.base), subScript: mathComponents(node.script) });
    }
    if (node.kind === 'sup') {
      return new MathSuperScript({ children: mathComponents(node.base), superScript: mathComponents(node.script) });
    }
    if (node.kind === 'fraction') {
      return new MathFraction({ numerator: mathComponents(node.numerator), denominator: mathComponents(node.denominator) });
    }
    return new MathRadical({ children: mathComponents(node.radicand) });
  });
}

function chemistryRuns(tokens) {
  return tokens.map((token) => {
    if (token.kind === 'text') return examTextRun(token.text);
    if (token.kind === 'sub') return examTextRun(token.text, { subScript: true });
    if (token.kind === 'sup') return examTextRun(token.text, { superScript: true });
    return examTextRun('→');
  });
}

function uprightUnitRuns(unit) {
  const runs = [examTextRun(unit.text, { italics: false })];
  if (unit.exponent !== undefined) runs.push(examTextRun(unit.exponent, { superScript: true, italics: false }));
  return runs;
}

function examInlineChildren(inlines) {
  const children = [];
  for (const inline of inlines) {
    if (inline.kind === 'text') children.push(examTextRun(inline.text));
    else if (inline.kind === 'math') children.push(new MathEquation({ children: mathComponents(inline.expression) }));
    else if (inline.kind === 'chemistry') children.push(...chemistryRuns(inline.tokens));
    else children.push(...uprightUnitRuns(inline));
  }
  return children;
}

function examAnswerArea(answerArea) {
  const answerWidth = EXAM_LAYOUT.widthDxa
    - EXAM_LAYOUT.marginsDxa.left
    - EXAM_LAYOUT.marginsDxa.right
    - EXAM_LAYOUT.marginsDxa.gutter;
  const lineBorder = { style: BorderStyle.SINGLE, size: 2, color: '9CA3AF' };
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return [
    new Paragraph({
      spacing: { before: 40, after: 30 },
      children: [examTextRun(answerArea.label, { size: EXAM_NOTE_SIZE, color: '4B5563' })],
    }),
    new Table({
      width: { size: answerWidth, type: WidthType.DXA },
      columnWidths: [answerWidth],
      layout: TableLayoutType.FIXED,
      borders: {
        top: noBorder,
        bottom: lineBorder,
        left: noBorder,
        right: noBorder,
        insideHorizontal: lineBorder,
        insideVertical: noBorder,
      },
      rows: Array.from({ length: answerArea.lines }, () => new TableRow({
        height: { value: 500, rule: HeightRule.ATLEAST },
        children: [new TableCell({
          width: { size: answerWidth, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 0, right: 0 },
          children: [new Paragraph({ children: [examTextRun(' ')] })],
        })],
      })),
    }),
  ];
}

function examQuestionParagraph(question) {
  const questionChildren = [examTextRun(`${question.number}. `, { bold: true })];
  if (question.score !== undefined) questionChildren.push(examTextRun(`（${question.score}分）`, { size: EXAM_NOTE_SIZE, color: '4B5563' }));
  questionChildren.push(...examInlineChildren(question.prompt));
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: {
      before: 80,
      after: 60,
      line: EXAM_LAYOUT.minimumLineHeightTwips,
      lineRule: EXAM_LAYOUT.lineHeightRule,
    },
    children: questionChildren,
  });
}

function examFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80 },
      children: [
        examTextRun('第 ', { size: EXAM_NOTE_SIZE, color: '4B5563' }),
        new TextRun({ children: [PageNumber.CURRENT], font: EXAM_TEXT_FONT, size: EXAM_NOTE_SIZE, color: '4B5563' }),
        examTextRun(' 页', { size: EXAM_NOTE_SIZE, color: '4B5563' }),
      ],
    })],
  });
}

function createExamDocxBuffer(documentInput) {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [examTextRun(documentInput.title, { size: 34, bold: true, color: '000000' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [examTextRun(documentInput.exam.subject, { size: 28, bold: true, color: '000000' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [examTextRun(documentInput.sourceLabel ?? '结构化试卷内容', { size: EXAM_NOTE_SIZE, color: '4B5563' })],
    }),
  ];
  for (const section of documentInput.exam.sections) {
    children.push(new Paragraph({
      spacing: { before: 100, after: 60 },
      children: [examTextRun(section.title, { size: 26, bold: true, color: '000000' })],
    }));
    for (const question of section.questions) {
      children.push(examQuestionParagraph(question));
      if (question.answerArea) children.push(...examAnswerArea(question.answerArea));
    }
  }
  const document = new Document({
    creator: 'Mochi Documents',
    title: documentInput.title,
    subject: documentInput.exam.subject,
    description: 'Editable Sichuan 2026 target high-school exam base template from structured content.',
    sections: [{
      footers: { default: examFooter() },
      properties: {
        page: {
          size: { width: EXAM_LAYOUT.widthDxa, height: EXAM_LAYOUT.heightDxa },
          margin: EXAM_LAYOUT.marginsDxa,
        },
      },
      children,
    }],
  });
  return Packer.toBuffer(document);
}

function createDocxBuffer(documentInput) {
  if (documentInput.template.kind === SICHUAN_2026_EXAM_TEMPLATE) return createExamDocxBuffer(documentInput);
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [textRun(documentInput.title, { size: 34, bold: true, color: '000000' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [textRun(documentInput.sourceLabel ?? (documentInput.sourceKind === 'demonstration' ? '演示材料 非真实通知' : '上游已授权结构化内容'), { size: 18, color: '4B5563' })],
    }),
  ];
  documentInput.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const block of page.blocks) {
      if (block.kind === 'heading') {
        children.push(new Paragraph({
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          spacing: { before: 100, after: 160 },
          children: [textRun(block.text, { size: block.level === 1 ? 28 : 24, bold: true, color: '000000' })],
        }));
      } else if (block.kind === 'paragraph') {
        children.push(bodyParagraph(block.text));
      } else {
        children.push(documentTable(block));
        children.push(new Paragraph({ spacing: { after: 150 }, children: [] }));
      }
    }
  });
  const document = new Document({
    creator: 'Mochi Documents',
    title: documentInput.title,
    description: 'Editable DOCX generated from upstream-authorized structured content.',
    sections: [{
      properties: { page: { margin: { top: 1_000, right: 1_000, bottom: 1_000, left: 1_000 } } },
      children,
    }],
  });
  return Packer.toBuffer(document);
}


const GENERIC_PDF_MARGIN = Object.freeze({ top: 790, right: 54, bottom: 56, left: 54 });

function genericDocumentSourceLabel(documentInput) {
  return documentInput.sourceLabel ?? (documentInput.sourceKind === 'demonstration'
    ? '演示材料 非真实通知'
    : '上游已授权结构化内容');
}

function genericDocumentPdfText(documentInput) {
  const fragments = [documentInput.title, genericDocumentSourceLabel(documentInput)];
  for (const page of documentInput.pages) {
    for (const block of page.blocks) {
      if (block.kind === 'table') fragments.push(...block.columns, ...block.rows.flat());
      else fragments.push(block.text);
    }
  }
  return fragments.filter(Boolean);
}

function tableRowFragment(row, layout, startLine, lineCount) {
  const lines = row.lines.map((cellLines) => cellLines.slice(startLine, startLine + lineCount));
  return {
    ...row,
    lines,
    height: Math.max(...lines.map((cellLines) => cellLines.length), 1) * layout.lineHeight + layout.padding * 2,
  };
}

async function renderGenericDocumentPdf(documentInput, signal) {
  throwIfAborted(signal);
  const { pdfDocument, font } = await createPdfLayoutDocument({
    title: documentInput.title,
    subject: 'Mochi structured document',
    creator: 'Mochi Documents',
  });
  const contentWidth = A4_PAGE_SIZE[0] - GENERIC_PDF_MARGIN.left - GENERIC_PDF_MARGIN.right;
  let page;
  let top;

  const newPage = (includeDocumentHeading = false) => {
    page = pdfDocument.addPage(A4_PAGE_SIZE);
    top = GENERIC_PDF_MARGIN.top;
    if (includeDocumentHeading) {
      const title = drawTextBlock({
        page,
        text: documentInput.title,
        x: GENERIC_PDF_MARGIN.left,
        top,
        width: contentWidth,
        font,
        size: 20,
        lineHeight: 27,
        fill: pdfColor('111827'),
      });
      top = title.bottom - 8;
      const source = drawTextBlock({
        page,
        text: genericDocumentSourceLabel(documentInput),
        x: GENERIC_PDF_MARGIN.left,
        top,
        width: contentWidth,
        font,
        size: 9.5,
        lineHeight: 13,
        fill: pdfColor('4B5563'),
      });
      top = source.bottom - 14;
    }
  };

  const ensureLines = (lineHeight) => {
    if (top - GENERIC_PDF_MARGIN.bottom >= lineHeight) return;
    newPage(false);
  };

  const writeText = (text, { size, lineHeight, fill, before = 0, after = 0 }) => {
    top -= before;
    const lines = wrapText({ text, font, size, maxWidth: contentWidth });
    let offset = 0;
    while (offset < lines.length) {
      ensureLines(lineHeight);
      const capacity = Math.max(1, Math.floor((top - GENERIC_PDF_MARGIN.bottom) / lineHeight));
      const chunk = lines.slice(offset, offset + capacity);
      const drawn = drawTextBlock({
        page,
        text: chunk.join('\n'),
        x: GENERIC_PDF_MARGIN.left,
        top,
        width: contentWidth,
        font,
        size,
        lineHeight,
        fill,
      });
      top = drawn.bottom;
      offset += chunk.length;
      if (offset < lines.length) newPage(false);
    }
    top -= after;
  };

  const writeTable = (block) => {
    const layout = layoutTable({
      table: { headers: block.columns, rows: block.rows },
      width: contentWidth,
      font,
      size: 10.5,
      lineHeight: 14,
      padding: 5,
    });
    const minimumFragmentHeight = layout.header.height + layout.padding * 2 + layout.lineHeight;
    const fullPageHeight = GENERIC_PDF_MARGIN.top - GENERIC_PDF_MARGIN.bottom;
    if (minimumFragmentHeight > fullPageHeight) {
      throw failure('PDF_LAYOUT_OVERFLOW', 'structured table headers cannot fit on one PDF page');
    }
    let rowIndex = 0;
    let rowLineOffset = 0;
    while (rowIndex < layout.rows.length) {
      throwIfAborted(signal);
      if (top - GENERIC_PDF_MARGIN.bottom < minimumFragmentHeight) newPage(false);
      const fragments = [];
      let used = layout.header.height;
      while (rowIndex < layout.rows.length) {
        const row = layout.rows[rowIndex];
        const remainingLines = Math.max(...row.lines.map((cellLines) => cellLines.length), 1) - rowLineOffset;
        const availableLines = Math.floor((top - GENERIC_PDF_MARGIN.bottom - used - layout.padding * 2) / layout.lineHeight);
        if (availableLines < 1) break;
        const lineCount = Math.min(remainingLines, availableLines);
        const fragment = tableRowFragment(row, layout, rowLineOffset, lineCount);
        fragments.push(fragment);
        used += fragment.height;
        if (lineCount === remainingLines) {
          rowIndex += 1;
          rowLineOffset = 0;
        } else {
          rowLineOffset += lineCount;
          break;
        }
      }
      if (fragments.length === 0) {
        newPage(false);
        continue;
      }
      const rendered = drawTable({
        page,
        table: { ...layout, rows: fragments },
        x: GENERIC_PDF_MARGIN.left,
        top,
        font,
        headerFill: pdfColor('1D4ED8'),
        bodyFill: pdfColor('FFFFFF'),
        headerText: pdfColor('FFFFFF'),
        bodyText: pdfColor('111827'),
        border: pdfColor('D9D9D9'),
      });
      top = rendered.bottom - 12;
    }
  };

  documentInput.pages.forEach((sourcePage, pageIndex) => {
    throwIfAborted(signal);
    if (pageIndex === 0) newPage(true);
    else newPage(false);
    for (const block of sourcePage.blocks) {
      throwIfAborted(signal);
      if (block.kind === 'heading') {
        writeText(block.text, {
          size: block.level === 1 ? 16 : 14,
          lineHeight: block.level === 1 ? 23 : 20,
          fill: pdfColor('111827'),
          before: 4,
          after: 9,
        });
      } else if (block.kind === 'paragraph') {
        writeText(block.text, {
          size: 11,
          lineHeight: 17,
          fill: pdfColor('111827'),
          after: 9,
        });
      } else {
        writeTable(block);
      }
    }
  });

  throwIfAborted(signal);
  const bytes = await savePdfLayoutDocument(pdfDocument);
  throwIfAborted(signal);
  const inspection = await inspectPdfArtifact(bytes, {
    requiredText: genericDocumentPdfText(documentInput),
  });
  if (inspection.imageCount !== 0) throw failure('PDF_LAYOUT_IMAGE', 'generic PDF must not contain page-image substitutes');
  return { bytes, inspection };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw failure('ABORTED', 'document generation was cancelled');
}

function validateConverterOptions(converter = {}) {
  if (!isObject(converter)) throw failure('INVALID_CONVERTER_CONFIG', 'converter must be an object');
  const sofficePath = converter.sofficePath ?? DEFAULT_SOFFICE_PATH;
  if (typeof sofficePath !== 'string' || !isAbsolute(sofficePath)) {
    throw failure('INVALID_CONVERTER_CONFIG', 'sofficePath must be an absolute host-configured path');
  }
  const timeoutMs = converter.timeoutMs ?? DEFAULT_CONVERTER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_CONVERTER_TIMEOUT_MS) {
    throw failure('INVALID_CONVERTER_CONFIG', `timeoutMs must be an integer from 100 to ${MAX_CONVERTER_TIMEOUT_MS}`);
  }
  return { sofficePath, timeoutMs };
}

async function assertConverterAvailable(sofficePath) {
  try {
    await access(sofficePath, fsConstants.X_OK);
    const info = await stat(sofficePath);
    if (!info.isFile()) throw failure('CONVERTER_MISSING', 'configured soffice path is not a file');
  } catch (error) {
    if (error instanceof MochiDocumentsError) throw error;
    throw failure('CONVERTER_MISSING', 'configured soffice executable is unavailable');
  }
}

function runProcess({ command, args, cwd, environment, signal, timeoutMs }) {
  return new Promise((resolveProcess, rejectProcess) => {
    let child;
    let terminalReason;
    let timeoutHandle;
    let forceKillHandle;
    let settled = false;
    let closeReceived = false;
    const childHasOwnProcessGroup = process.platform !== 'win32';
    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const signalChildTree = (signalName) => {
      if (!child?.pid || closeReceived) return;
      try {
        if (childHasOwnProcessGroup) process.kill(-child.pid, signalName);
        else child.kill(signalName);
      } catch (error) {
        if (error?.code === 'ESRCH') return;
        try {
          child.kill(signalName);
        } catch {
          // The child may have exited between the process-group signal and
          // fallback. The close handler determines completion.
        }
      }
    };
    const stop = (reason) => {
      if (terminalReason) return;
      terminalReason = reason;
      if (child && !closeReceived) {
        signalChildTree('SIGTERM');
        forceKillHandle = setTimeout(() => {
          if (!closeReceived) signalChildTree('SIGKILL');
        }, FORCE_KILL_DELAY_MS);
        forceKillHandle.unref?.();
      }
    };
    const onAbort = () => stop('aborted');
    try {
      child = spawn(command, args, {
        cwd,
        env: environment,
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
        detached: childHasOwnProcessGroup,
      });
    } catch (error) {
      settle(() => rejectProcess(error));
      return;
    }
    timeoutHandle = setTimeout(() => stop('timeout'), timeoutMs);
    timeoutHandle.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) stop('aborted');
    child.once('error', (error) => settle(() => rejectProcess(error)));
    child.once('close', (exitCode) => settle(() => {
      closeReceived = true;
      if (terminalReason === 'aborted') return rejectProcess(failure('ABORTED', 'LibreOffice conversion was cancelled'));
      if (terminalReason === 'timeout') return rejectProcess(failure('CONVERTER_TIMEOUT', 'LibreOffice conversion exceeded the configured timeout'));
      if (exitCode !== 0) return rejectProcess(failure('CONVERTER_FAILED', 'LibreOffice conversion failed'));
      resolveProcess();
    }));
  });
}

function xmlEscape(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[character]));
}

async function createMacFontconfigEnvironment() {
  if (process.platform !== 'darwin') return { environment: process.env, cleanup: async () => {} };
  const fontDirectories = (await Promise.all(MACOS_FONT_DIRECTORIES.map(async (directory) => {
    try {
      return (await stat(directory)).isDirectory() ? directory : undefined;
    } catch {
      return undefined;
    }
  }))).filter(Boolean);
  if (fontDirectories.length === 0) return { environment: process.env, cleanup: async () => {} };

  const configurationDirectory = await mkdtemp(join(tmpdir(), 'mochi-documents-fontconfig-'));
  const cacheDirectory = join(configurationDirectory, 'cache');
  const configurationPath = join(configurationDirectory, 'fontconfig.xml');
  await mkdir(cacheDirectory, { mode: 0o700 });
  const fontDirectoryEntries = fontDirectories.map((directory) => `  <dir>${xmlEscape(directory)}</dir>`).join('\n');
  await writeFile(configurationPath, [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
    '<fontconfig>',
    fontDirectoryEntries,
    `  <cachedir>${xmlEscape(cacheDirectory)}</cachedir>`,
    '</fontconfig>',
    '',
  ].join('\n'), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return {
    environment: {
      ...process.env,
      FONTCONFIG_FILE: configurationPath,
      FONTCONFIG_PATH: configurationDirectory,
    },
    cleanup: () => rm(configurationDirectory, { recursive: true, force: true }),
  };
}

async function assertExamFontAvailability(documentInput) {
  if (documentInput.template.kind !== SICHUAN_2026_EXAM_TEMPLATE) return undefined;
  if (process.platform !== 'darwin') {
    throw failure('EXAM_FONT_UNAVAILABLE', 'the Sichuan 2026 exam template is currently verified only with required macOS system fonts');
  }
  const requiredFonts = await Promise.all(EXAM_REQUIRED_FONT_FILES.map(async (font) => {
    try {
      await access(font.path, fsConstants.R_OK);
      return { family: font.family, path: font.path, available: true };
    } catch {
      return { family: font.family, path: font.path, available: false };
    }
  }));
  if (requiredFonts.some((font) => !font.available)) {
    throw failure('EXAM_FONT_UNAVAILABLE', 'required Songti SC or Times New Roman system font is unavailable; no silent replacement will be exported');
  }
  return {
    platform: 'darwin',
    replacementApplied: false,
    requiredFonts,
  };
}

async function convertDocxToPdf({ docxPath, stagingDirectory, converter, signal }) {
  throwIfAborted(signal);
  await assertConverterAvailable(converter.sofficePath);
  const temporaryProfile = await mkdtemp(join(tmpdir(), 'mochi-documents-lo-profile-'));
  let fontconfig;
  try {
    fontconfig = await createMacFontconfigEnvironment();
    const args = [
      '--headless',
      '--nologo',
      '--nodefault',
      '--nolockcheck',
      '--nofirststartwizard',
      `-env:UserInstallation=${pathToFileURL(temporaryProfile).href}`,
      '--convert-to', 'pdf:writer_pdf_Export',
      '--outdir', stagingDirectory,
      docxPath,
    ];
    await runProcess({
      command: converter.sofficePath,
      args,
      cwd: stagingDirectory,
      environment: fontconfig.environment,
      signal,
      timeoutMs: converter.timeoutMs,
    });
    throwIfAborted(signal);
  } finally {
    await Promise.allSettled([
      rm(temporaryProfile, { recursive: true, force: true }),
      fontconfig?.cleanup(),
    ]);
  }
}

async function reserveOutputDirectory(outputDirectory) {
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory)) {
    throw failure('INVALID_OUTPUT_DIRECTORY', 'outputDirectory must be an absolute host-assigned path');
  }
  const resolved = resolve(outputDirectory);
  await mkdir(dirname(resolved), { recursive: true });
  try {
    await mkdir(resolved, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw failure('OUTPUT_EXISTS', 'outputDirectory already exists and will not be overwritten');
    }
    throw error;
  }
  return resolved;
}

async function sha256File(path) {
  const file = await readFile(path);
  return createHash('sha256').update(file).digest('hex');
}

async function fileMetadata(path, filename, editable = false) {
  const info = await stat(path);
  return { filename, bytes: info.size, sha256: await sha256File(path), ...(editable ? { editable: true } : {}) };
}

async function inspectConvertedPdfArtifact(path) {
  const bytes = await readFile(path);
  if (bytes.length < 8 || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw failure('CONVERTER_FAILED', 'LibreOffice did not produce a valid PDF header');
  }
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const pageCount = pdf.getPageCount();
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      throw failure('CONVERTER_FAILED', 'LibreOffice did not produce a PDF with at least one page');
    }
    return { pageCount };
  } catch (error) {
    if (error instanceof MochiDocumentsError) throw error;
    throw failure('CONVERTER_FAILED', 'LibreOffice did not produce a parseable PDF');
  }
}

function questionsPayload(documentInput) {
  return {
    schema: 'mochi-document-questions-v1',
    sourceKind: documentInput.sourceKind,
    template: documentInput.template,
    questions: documentInput.doubts,
  };
}

function checklistPayload(documentInput) {
  const checks = [
    { id: 'structured-input', status: 'passed', detail: 'Accepted titles, paragraphs, tables, and question sources from structured input.' },
    { id: 'editable-docx', status: 'passed', detail: 'DOCX was produced from text and real table elements, not a page image.' },
    documentInput.template.kind === GENERIC_TEMPLATE
      ? { id: 'pdf-from-structured-input', status: 'passed', detail: 'PDF was drawn directly from the same structured input with an embedded Noto font, without an Office converter.' }
      : { id: 'pdf-from-docx', status: 'passed', detail: 'PDF was converted locally from the generated DOCX by LibreOffice.' },
  ];
  if (documentInput.template.kind === SICHUAN_2026_EXAM_TEMPLATE) {
    checks.push(
      { id: 'exam-template-target', status: 'attention', detail: 'Sichuan 2026 is a product target; the official 2026 sample layout remains pending review.' },
      { id: 'exam-print-verification', status: 'attention', detail: 'Electronic font and layout parameters are checked here; paper, printer, and print-quality compliance require separate verification.' },
    );
  }
  return {
    schema: 'mochi-document-checklist-v1',
    sourceKind: documentInput.sourceKind,
    template: documentInput.template,
    checks,
  };
}

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

async function publishStagedArtifacts(stagingDirectory, targetDirectory, publishedFilenames) {
  try {
    for (const filename of OUTPUT_FILENAMES) {
      await link(join(stagingDirectory, filename), join(targetDirectory, filename));
      publishedFilenames.push(filename);
    }
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw failure('OUTPUT_EXISTS', 'outputDirectory received a conflicting artifact and will not be overwritten');
    }
    throw error;
  }
}

async function discardOutputReservation(targetDirectory, stagingDirectory, publishedFilenames) {
  await Promise.allSettled([
    stagingDirectory ? rm(stagingDirectory, { recursive: true, force: true }) : undefined,
    ...publishedFilenames.map((filename) => unlink(join(targetDirectory, filename))),
  ]);
  try {
    await rmdir(targetDirectory);
  } catch {
    // Do not recursively remove a target that unexpectedly gained content.
    // Preserving it is safer than deleting a host-created file.
  }
}

/**
 * Produce a new DOCX/PDF bundle. `outputDirectory` and `converter` are host
 * controls; the structured document has no executable or filesystem field.
 */
export async function generateDocumentBundle({ document, outputDirectory, converter, signal } = {}) {
  const documentInput = validateStructuredDocument(document);
  const usesOfficeConverter = documentInput.template.kind !== GENERIC_TEMPLATE;
  const converterOptions = usesOfficeConverter ? validateConverterOptions(converter) : undefined;
  throwIfAborted(signal);
  const fontAvailability = usesOfficeConverter ? await assertExamFontAvailability(documentInput) : undefined;
  let targetDirectory;
  let stagingDirectory;
  let publishedFilenames = [];
  let published = false;
  try {
    targetDirectory = await reserveOutputDirectory(outputDirectory);
    stagingDirectory = await mkdtemp(join(targetDirectory, '.mochi-documents-staging-'));
    const docxPath = join(stagingDirectory, OUTPUT_DOCX_FILENAME);
    await writeFile(docxPath, await createDocxBuffer(documentInput), { flag: 'wx', mode: 0o600 });
    throwIfAborted(signal);
    const pdfPath = join(stagingDirectory, OUTPUT_PDF_FILENAME);
    let pdf;
    if (usesOfficeConverter) {
      await convertDocxToPdf({ docxPath, stagingDirectory, converter: converterOptions, signal });
      pdf = await inspectConvertedPdfArtifact(pdfPath);
    } else {
      const generatedPdf = await renderGenericDocumentPdf(documentInput, signal);
      await writeFile(pdfPath, generatedPdf.bytes, { flag: 'wx', mode: 0o600 });
      pdf = generatedPdf.inspection;
    }
    throwIfAborted(signal);

    const questionsPath = join(stagingDirectory, 'questions.json');
    const checklistPath = join(stagingDirectory, 'checklist.json');
    await writeJson(questionsPath, questionsPayload(documentInput));
    await writeJson(checklistPath, checklistPayload(documentInput));
    const files = {
      docx: await fileMetadata(docxPath, OUTPUT_DOCX_FILENAME, true),
      pdf: await fileMetadata(pdfPath, OUTPUT_PDF_FILENAME),
      questions: await fileMetadata(questionsPath, 'questions.json'),
      checklist: await fileMetadata(checklistPath, 'checklist.json'),
    };
    const manifest = {
      schema: 'mochi-document-manifest-v1',
      status: 'completed',
      sourceKind: documentInput.sourceKind,
      template: documentInput.template,
      title: documentInput.title,
      sourcePageCount: documentInput.sourcePageCount,
      pdfPageCount: pdf.pageCount,
      questionCount: documentInput.doubts.length,
      ...(documentInput.exam ? {
        subject: documentInput.exam.subject,
        examQuestionCount: documentInput.exam.sections.reduce((count, section) => count + section.questions.length, 0),
        fontAvailability,
      } : {}),
      files,
    };
    // A completed manifest is written only after every output has passed its
    // local check. The target was reserved with mkdir, and each output link is
    // created without replacement; manifest is the final completion sentinel.
    await writeJson(join(stagingDirectory, 'manifest.json'), manifest);
    await publishStagedArtifacts(stagingDirectory, targetDirectory, publishedFilenames);
    published = true;
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    stagingDirectory = undefined;
    return {
      outputDirectory: targetDirectory,
      docxPath: join(targetDirectory, OUTPUT_DOCX_FILENAME),
      pdfPath: join(targetDirectory, OUTPUT_PDF_FILENAME),
      questionsPath: join(targetDirectory, 'questions.json'),
      checklistPath: join(targetDirectory, 'checklist.json'),
      manifestPath: join(targetDirectory, 'manifest.json'),
      manifest,
    };
  } catch (error) {
    if (error instanceof MochiDocumentsError) throw error;
    if (usesOfficeConverter && error?.code === 'ENOENT') throw failure('CONVERTER_MISSING', 'configured soffice executable is unavailable');
    throw failure('GENERATION_FAILED', 'document bundle generation failed before publication');
  } finally {
    if (!published && targetDirectory) {
      await discardOutputReservation(targetDirectory, stagingDirectory, publishedFilenames);
    }
  }
}
