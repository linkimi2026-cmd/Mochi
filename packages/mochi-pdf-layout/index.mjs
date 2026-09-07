import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export const PDF_LAYOUT_FONT_FAMILY = 'Noto Sans SC';
export const PDF_LAYOUT_FONT_LICENSE = 'SIL Open Font License 1.1';
export const A4_PAGE_SIZE = Object.freeze([595.28, 841.89]);

const FONT_URL = new URL('./assets/fonts/NotoSansSC-Regular.ttf', import.meta.url);
let cachedFontBytes;

export class MochiPdfLayoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MochiPdfLayoutError';
    this.code = code;
  }
}

function failure(code, message) {
  return new MochiPdfLayoutError(code, message);
}

function finite(value, label, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new TypeError(`${label} must be a finite number no smaller than ${minimum}`);
  }
  return value;
}

function requireFont(font) {
  if (!font || typeof font.widthOfTextAtSize !== 'function') {
    throw new TypeError('font must be an embedded pdf-lib font');
  }
  return font;
}

async function bundledFontBytes() {
  if (!cachedFontBytes) cachedFontBytes = readFile(FONT_URL);
  return cachedFontBytes;
}

export async function createPdfLayoutDocument({ title, subject, creator = 'Mochi PDF Layout' } = {}) {
  const pdfDocument = await PDFDocument.create();
  pdfDocument.registerFontkit(fontkit);
  if (typeof title === 'string' && title) pdfDocument.setTitle(title);
  if (typeof subject === 'string' && subject) pdfDocument.setSubject(subject);
  if (typeof creator === 'string' && creator) pdfDocument.setCreator(creator);
  pdfDocument.setProducer('Mochi PDF Layout');
  const font = await pdfDocument.embedFont(await bundledFontBytes(), {
    // fontkit subsetting of this CJK asset corrupts glyphs in real Poppler rendering.
    // Embed the one static font once per PDF instead of producing unreadable output.
    subset: false,
    customName: 'MochiNotoSansSC',
  });
  return { pdfDocument, font };
}

export async function savePdfLayoutDocument(pdfDocument) {
  if (!pdfDocument || typeof pdfDocument.save !== 'function') {
    throw new TypeError('pdfDocument must be a pdf-lib PDFDocument');
  }
  return pdfDocument.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

export function color(hex) {
  if (typeof hex !== 'string' || !/^#?[0-9a-fA-F]{6}$/.test(hex)) {
    throw new TypeError('color must be a six-digit hexadecimal string');
  }
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  return rgb(
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  );
}

export function wrapText({ text, font, size, maxWidth }) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  requireFont(font);
  finite(size, 'size');
  finite(maxWidth, 'maxWidth');
  if (maxWidth === 0) throw new RangeError('maxWidth must be greater than zero');
  const lines = [];
  for (const paragraph of text.replaceAll('\r', '').split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const character of Array.from(paragraph)) {
      const candidate = `${line}${character}`;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line.trimEnd());
        line = character === ' ' ? '' : character;
      } else {
        line = candidate;
      }
    }
    if (line || lines.length === 0) lines.push(line.trimEnd());
  }
  return lines;
}

export function drawTextBlock({ page, text, x, top, width, font, size, lineHeight = size * 1.42, fill = color('111827') }) {
  if (!page || typeof page.drawText !== 'function') throw new TypeError('page must be a pdf-lib page');
  finite(x, 'x');
  finite(top, 'top');
  finite(width, 'width');
  finite(size, 'size');
  finite(lineHeight, 'lineHeight');
  const lines = wrapText({ text, font, size, maxWidth: width });
  lines.forEach((line, index) => {
    if (line) page.drawText(line, { x, y: top - size - index * lineHeight, size, font, color: fill });
  });
  return { lines, height: lines.length * lineHeight, bottom: top - lines.length * lineHeight };
}

function normalizeTable(table) {
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) {
    throw new TypeError('table must contain headers and rows arrays');
  }
  if (table.headers.length < 1) throw new RangeError('table requires at least one header');
  const headers = table.headers.map((value) => {
    if (typeof value !== 'string') throw new TypeError('table headers must be strings');
    return value;
  });
  const rows = table.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== headers.length) throw new RangeError('table rows must match header count');
    return row.map((value) => {
      if (typeof value !== 'string') throw new TypeError('table cells must be strings');
      return value;
    });
  });
  return { headers, rows };
}

function normalizedColumnWidths(columnCount, width, columnWidths) {
  if (columnWidths === undefined) return Array.from({ length: columnCount }, () => width / columnCount);
  if (!Array.isArray(columnWidths) || columnWidths.length !== columnCount) {
    throw new RangeError('columnWidths must match table columns');
  }
  const total = columnWidths.reduce((sum, value) => sum + finite(value, 'column width'), 0);
  if (Math.abs(total - width) > 0.01) throw new RangeError('columnWidths must sum to width');
  return [...columnWidths];
}

function layoutRow(cells, columnWidths, font, size, lineHeight, padding) {
  const lines = cells.map((cell, index) => wrapText({ text: cell, font, size, maxWidth: columnWidths[index] - padding * 2 }));
  const height = Math.max(...lines.map((value) => value.length), 1) * lineHeight + padding * 2;
  return { cells, lines, height };
}

export function layoutTable({ table, width, font, size, lineHeight = size * 1.35, padding = 5, columnWidths }) {
  finite(width, 'width');
  finite(size, 'size');
  finite(lineHeight, 'lineHeight');
  finite(padding, 'padding');
  requireFont(font);
  const normalized = normalizeTable(table);
  const widths = normalizedColumnWidths(normalized.headers.length, width, columnWidths);
  if (widths.some((value) => value <= padding * 2)) throw new RangeError('table columns must leave room for cell text');
  return {
    columnWidths: widths,
    header: layoutRow(normalized.headers, widths, font, size, lineHeight, padding),
    rows: normalized.rows.map((row) => layoutRow(row, widths, font, size, lineHeight, padding)),
    size,
    lineHeight,
    padding,
  };
}

function drawTableRow({ page, row, columnWidths, x, top, font, size, lineHeight, padding, fill, textColor, borderColor }) {
  let cellX = x;
  for (let index = 0; index < row.lines.length; index += 1) {
    const cellWidth = columnWidths[index];
    page.drawRectangle({
      x: cellX,
      y: top - row.height,
      width: cellWidth,
      height: row.height,
      color: fill,
      borderColor,
      borderWidth: 0.7,
    });
    row.lines[index].forEach((line, lineIndex) => {
      if (line) page.drawText(line, {
        x: cellX + padding,
        y: top - padding - size - lineIndex * lineHeight,
        size,
        font,
        color: textColor,
      });
    });
    cellX += cellWidth;
  }
}

export function drawTable({ page, table, x, top, font, headerFill = color('244D3D'), bodyFill = color('FFFDF7'), headerText = color('FFFFFF'), bodyText = color('26352E'), border = color('9BAF9F') }) {
  if (!page || typeof page.drawRectangle !== 'function') throw new TypeError('page must be a pdf-lib page');
  if (!table || !table.header || !Array.isArray(table.rows)) throw new TypeError('table must be a layoutTable result');
  finite(x, 'x');
  finite(top, 'top');
  let currentTop = top;
  drawTableRow({ page, row: table.header, columnWidths: table.columnWidths, x, top: currentTop, font, size: table.size, lineHeight: table.lineHeight, padding: table.padding, fill: headerFill, textColor: headerText, borderColor: border });
  currentTop -= table.header.height;
  for (const row of table.rows) {
    drawTableRow({ page, row, columnWidths: table.columnWidths, x, top: currentTop, font, size: table.size, lineHeight: table.lineHeight, padding: table.padding, fill: bodyFill, textColor: bodyText, borderColor: border });
    currentTop -= row.height;
  }
  return { height: top - currentTop, bottom: currentTop };
}

function decodeUtf16Be(hex) {
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length % 2 !== 0) return '';
  const units = [];
  for (let index = 0; index < bytes.length; index += 2) units.push((bytes[index] << 8) | bytes[index + 1]);
  return String.fromCharCode(...units);
}

function sourceStreams(bytes) {
  const raw = Buffer.from(bytes);
  const source = raw.toString('latin1');
  const streams = [];
  const objectPattern = /\d+\s+\d+\s+obj\b([\s\S]*?)endobj/g;
  for (const object of source.matchAll(objectPattern)) {
    const body = object[1];
    const marker = body.indexOf('stream');
    if (marker < 0) continue;
    const before = body.slice(0, marker);
    let contentStart = marker + 'stream'.length;
    if (body.startsWith('\r\n', contentStart)) contentStart += 2;
    else if (body.startsWith('\n', contentStart)) contentStart += 1;
    else continue;
    let contentEnd = body.lastIndexOf('\nendstream');
    if (contentEnd < contentStart) contentEnd = body.lastIndexOf('\r\nendstream');
    if (contentEnd < contentStart) continue;
    const encoded = Buffer.from(body.slice(contentStart, contentEnd), 'latin1');
    try {
      streams.push(/\/FlateDecode\b/.test(before) ? inflateSync(encoded).toString('latin1') : encoded.toString('latin1'));
    } catch {
      throw failure('PDF_UNREADABLE', 'generated PDF has an unreadable content stream');
    }
  }
  return { raw: source, streams };
}

function cmapMap(stream) {
  const map = new Map();
  for (const section of stream.matchAll(/(?:\d+\s+)?beginbfchar\s*([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(pair[1].toUpperCase(), decodeUtf16Be(pair[2]));
    }
  }
  for (const section of stream.matchAll(/(?:\d+\s+)?beginbfrange\s*([\s\S]*?)endbfrange/g)) {
    for (const range of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const destination = Number.parseInt(range[3], 16);
      const length = range[1].length;
      for (let code = start; code <= end; code += 1) {
        const sourceCode = code.toString(16).toUpperCase().padStart(length, '0');
        const targetCode = (destination + code - start).toString(16).toUpperCase().padStart(range[3].length, '0');
        map.set(sourceCode, decodeUtf16Be(targetCode));
      }
    }
  }
  return map;
}

function decodePdfText(hex, cmap) {
  const lengths = [...new Set([...cmap.keys()].map((key) => key.length))].sort((left, right) => right - left);
  let offset = 0;
  let text = '';
  while (offset < hex.length) {
    const length = lengths.find((candidate) => cmap.has(hex.slice(offset, offset + candidate).toUpperCase()));
    if (!length) {
      text += '\uFFFD';
      offset += 2;
      continue;
    }
    text += cmap.get(hex.slice(offset, offset + length).toUpperCase());
    offset += length;
  }
  return text;
}

export function extractPdfText(bytes) {
  const { streams } = sourceStreams(bytes);
  const cmap = new Map();
  for (const stream of streams) {
    if (/begincmap/.test(stream)) {
      for (const [source, target] of cmapMap(stream)) cmap.set(source, target);
    }
  }
  if (cmap.size === 0) throw failure('PDF_TEXT_UNVERIFIABLE', 'generated PDF has no ToUnicode text map');
  const fragments = [];
  for (const stream of streams) {
    for (const block of stream.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
      for (const text of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*Tj\b/g)) {
        fragments.push(decodePdfText(text[1], cmap));
      }
      for (const textArray of block[1].matchAll(/\[([\s\S]*?)\]\s*TJ\b/g)) {
        for (const text of textArray[1].matchAll(/<([0-9A-Fa-f]+)>/g)) fragments.push(decodePdfText(text[1], cmap));
      }
    }
  }
  return fragments.join('\n');
}

export async function inspectPdfArtifact(bytes, { expectedPageCount, requiredText = [] } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from('%PDF-'))) {
    throw failure('PDF_UNREADABLE', 'generated output is not a PDF');
  }
  const { raw } = sourceStreams(bytes);
  let document;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw failure('PDF_UNREADABLE', 'generated output is not a parseable PDF');
  }
  const pageCount = document.getPageCount();
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw failure('PDF_PAGE_COUNT', 'generated PDF has no pages');
  if (expectedPageCount !== undefined && pageCount !== expectedPageCount) {
    throw failure('PDF_PAGE_COUNT', `generated PDF has ${pageCount} page(s), expected ${expectedPageCount}`);
  }
  if (!/\/FontFile[23]\b/.test(raw) || !/\/ToUnicode\b/.test(raw)) {
    throw failure('PDF_FONT_UNEMBEDDED', 'generated PDF is missing an embedded Unicode font');
  }
  const searchableText = extractPdfText(bytes);
  for (const fragment of requiredText) {
    if (typeof fragment !== 'string' || !fragment) throw new TypeError('requiredText entries must be non-empty strings');
    const normalizedSearchableText = searchableText.replace(/\s+/gu, '');
    const normalizedFragment = fragment.replace(/\s+/gu, '');
    if (!searchableText.includes(fragment) && !normalizedSearchableText.includes(normalizedFragment)) {
      throw failure('PDF_TEXT_MISSING', `generated PDF is missing searchable text: ${fragment}`);
    }
  }
  return {
    pageCount,
    searchableText,
    embeddedFont: true,
    imageCount: [...raw.matchAll(/\/Subtype\s*\/Image\b/g)].length,
  };
}
