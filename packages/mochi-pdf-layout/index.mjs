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

// ═══════════════════════════════════════════════════════════════════════════
// 分段绘制 —— 一个会让整份 PDF 文本层失效、并且直接阻断出片的坑（2026-09-12 排查）
//
// 现象：PDF 画面完全正常，但文字抽取（复制/搜索，以及上游 inspectPdfArtifact 的
// requiredText 校验）拿到乱码。后果不只是"复制不出来"：mochi-presentations 的
// generatePresentationBundle 会因此判定整份课件生成失败——换句话说
// **只要有一句话同时含数字/空格与拉丁字母，整册 PPT 就产不出来**。
// 实测 9 条真实中文课件句子里有 3 条触发，例如「PPT 的制作要 3 步」
// 「42 students 参加 3 次活动」「1  Mochi 校验第 1 页」。
//
// 根因（已实证，非猜测）：pdf-lib 用 fontkit 的 layout() 决定每个字符落哪个 glyph，
// 而 fontkit 会**按脚本同类挑 cmap 子表**。同一段里同时出现数字/空格（Common）
// 与拉丁字母（Latin）时，数字会被换成另一套替换字形，而这套字形**没有 ToUnicode 映射**：
//   '1  Mochi'    -> 0x7760 0x0001 ...   0x7760 在 CMap 里查不到 -> \uFFFD
//   '1  教学样例'  -> 0x0012 ...          0x0012 -> '1'          -> 正常
// 与 OpenType 特性无关：features 传 []、['-pwid']、['-hwid'] 等一律无效；
// 字体本身也没问题（'1' 在 cmap 里就是 glyph 18）。所以只能从"怎么画"这一层解决。
//
// 解法：把一行文本按脚本同类切成 run 分别 drawText。字形分配于是回到 CMap
// 可解释的那一套，画面与文字层对得上；行宽量法也换成同一口径（measureText），
// 保证"量出来的宽度"就是"画出来的宽度"。
// ═══════════════════════════════════════════════════════════════════════════
const LATIN_SCRIPT = 'latin';
const CJK_SCRIPT = 'cjk';
const COMMON_SCRIPT = 'common';

/** 粗略但够用的脚本归类：拉丁字母 / 中日韩（含全角） / 其余（数字、空格、标点、符号）。 */
function scriptClassOf(codePoint) {
  if ((codePoint >= 0x41 && codePoint <= 0x5A) || (codePoint >= 0x61 && codePoint <= 0x7A)) return LATIN_SCRIPT;
  if (codePoint >= 0xC0 && codePoint <= 0x24F && codePoint !== 0xD7 && codePoint !== 0xF7) return LATIN_SCRIPT;
  if (codePoint >= 0x2E80) return CJK_SCRIPT;
  return COMMON_SCRIPT;
}

/** 把一行文本切成脚本同类的 run（相邻同类合并）。 */
export function splitScriptRuns(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const runs = [];
  for (const character of text) {
    const script = scriptClassOf(character.codePointAt(0));
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += character;
    else runs.push({ script, text: character });
  }
  return runs.map((run) => run.text);
}

/** 与 drawTextLine 完全同一口径的行宽：分段宽度之和。 */
export function measureText(text, font, size) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  requireFont(font);
  finite(size, 'size');
  return splitScriptRuns(text).reduce((total, run) => total + font.widthOfTextAtSize(run, size), 0);
}

/** 按脚本分段绘制一行文本，返回实际绘制宽度。 */
export function drawTextLine({ page, text, x, y, size, font, fill }) {
  if (!page || typeof page.drawText !== 'function') throw new TypeError('page must be a pdf-lib page');
  requireFont(font);
  finite(x, 'x');
  finite(y, 'y');
  finite(size, 'size');
  let cursor = x;
  for (const run of splitScriptRuns(text)) {
    if (!run) continue;
    page.drawText(run, { x: cursor, y, size, font, ...(fill === undefined ? {} : { color: fill }) });
    cursor += font.widthOfTextAtSize(run, size);
  }
  return cursor - x;
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
      if (line && measureText(candidate, font, size) > maxWidth) {
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
    if (line) drawTextLine({ page, text: line, x, y: top - size - index * lineHeight, size, font, fill });
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
      if (line) drawTextLine({
        page,
        text: line,
        x: cellX + padding,
        y: top - padding - size - lineIndex * lineHeight,
        size,
        font,
        fill: textColor,
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
  // 按**视觉行**归并，而不是一个 Tj 一行。
  // 分段绘制（见 splitScriptRuns）会把同一行拆成多个 Tj（'表格由真实' + ' ' + 'Word' + …），
  // 如果每个 Tj 之间都插换行，抽出来就变成
  // 「表格由真实\n \nWord\n \n表格元素生成」——空格两侧凭空多出换行，
  // 复制/搜索与上游断言全部走样。这里的口径与 mochi-documents 的逐页抽取一致：
  //   同一个 y（同一条基线）且首尾相接 -> 直接拼接；
  //   同一个 y 但横向留了明显空隙（表格相邻单元格）-> 补一个空格；
  //   y 变了、或换了一条内容流（= 换页）-> 换行。
  const lines = [];
  let currentLine = '';
  for (const stream of streams) {
    let lastY = null;
    let lastX = null;
    let lastText = '';
    let lastSize = 12;
    for (const block of stream.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
      const body = block[1];
      const parts = [];
      for (const text of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj\b/g)) parts.push(decodePdfText(text[1], cmap));
      for (const textArray of body.matchAll(/\[([\s\S]*?)\]\s*TJ\b/g)) {
        for (const text of textArray[1].matchAll(/<([0-9A-Fa-f]+)>/g)) parts.push(decodePdfText(text[1], cmap));
      }
      if (parts.length === 0) continue;
      const text = parts.join('');
      const position = textPosition(body);
      const y = position?.y ?? null;
      const x = position?.x ?? null;
      const size = position?.size ?? 12;
      if (lastY !== null && y !== null && Math.abs(y - lastY) < 0.01) {
        if (x !== null && lastX !== null && !/\s$/u.test(lastText) && !/^\s/u.test(text)
          && x - (lastX + approximateTextWidth(lastText, lastSize)) > Math.max(size, 12) * 0.45) currentLine += ' ';
        currentLine += text;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = text;
      }
      lastY = y;
      lastX = x;
      lastText = text;
      lastSize = size;
    }
    if (currentLine) { lines.push(currentLine); currentLine = ''; }
  }
  return lines.join('\n');
}

/** 粗略估算一段文本的推进宽度（pt）：CJK/全角 ~1em，宽字符 ~0.88em，窄字符 ~0.3em，空格 ~0.28em，其余 ~0.55em。 */
function approximateTextWidth(text, size) {
  const unit = Number.isFinite(size) && size > 0 ? size : 12;
  const WIDE = 'MWmw@%&';
  const NARROW = "ijltfr.,:;!|'`()[]";
  return [...text].reduce((total, character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 0x2E80) return total + unit;
    if (character === ' ') return total + unit * 0.28;
    if (WIDE.includes(character)) return total + unit * 0.88;
    if (NARROW.includes(character)) return total + unit * 0.3;
    return total + unit * 0.55;
  }, 0);
}

/** 取 BT 块内文本矩阵的位置与字号：`a b c d e f Tm` 给出 x=e、y=f；`/Font size Tf` 给出字号。 */
function textPosition(block) {
  const matrix = block.match(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm\b/);
  const font = block.match(/\/([^\s/]+)\s+(-?[\d.]+)\s+Tf\b/);
  const size = font ? Number.parseFloat(font[2]) : 12;
  if (matrix) return { x: Number.parseFloat(matrix[5]), y: Number.parseFloat(matrix[6]), size };
  const offset = block.match(/(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]\b/);
  if (offset) return { x: null, y: Number.parseFloat(offset[2]), size };
  return { x: null, y: null, size };
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
