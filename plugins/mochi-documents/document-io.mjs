/**
 * Local document input/output for the Mochi teacher tools.
 *
 * This module reads and writes *real* files:
 *   - `.docx` is ZIP + OOXML; the archive is opened with a small, dependency-free
 *     ZIP reader/writer built on `node:zlib` (no `jszip` at runtime).
 *   - DOCX text structure is parsed from `word/document.xml` (+ `word/styles.xml`
 *     for style names), never from an HTML or image stand-in.
 *   - PDF reading uses `pdf-lib` for page structure and the shared
 *     `@mochi/pdf-layout` extractor where it applies; per-page text needs the
 *     page's own ToUnicode CMap, and when that is absent the result is reported
 *     as unavailable instead of being invented.
 *
 * There is no OCR, no network, and no shell-string surface here.
 */
import { access, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { extractPdfText } from '@mochi/pdf-layout';

export const MAX_DOCX_BYTES = 64 * 1024 * 1024;
export const MAX_PDF_BYTES = 128 * 1024 * 1024;
export const MAX_TEXT_PER_PAGE = 20_000;
export const MAX_EDIT_OPS = 50;
export const MAX_EDIT_TEXT_LENGTH = 20_000;
export const PDF_EXPORT_ENGINE_CANDIDATES = Object.freeze([
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  'C:/Program Files/LibreOffice/program/soffice.exe',
]);

export class DocumentIoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentIoError';
    this.code = code;
  }
}

function failure(code, message) {
  return new DocumentIoError(code, message);
}

/* ------------------------------------------------------------------ ZIP ---- */

const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_DOS_DATE_1980 = 0x0021;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const earliest = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * Reads a ZIP/OOXML archive. Entry payloads are kept verbatim (compressed form
 * included) so an edit can republish every untouched part byte-for-byte.
 */
export function readZipArchive(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 22) throw failure('ARCHIVE_UNREADABLE', '文件不是有效的 ZIP/OOXML 归档（长度不足）');
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw failure('ARCHIVE_UNREADABLE', '文件不是有效的 ZIP/OOXML 归档（缺少中央目录）');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw failure('ARCHIVE_ZIP64_UNSUPPORTED', '该 ZIP 归档使用 ZIP64 扩展，超出本机读取范围');
  }
  if (directoryOffset + directorySize > buffer.length) {
    throw failure('ARCHIVE_UNREADABLE', 'ZIP 中央目录越界，文件可能已损坏');
  }

  const entries = [];
  const seen = new Set();
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) {
      throw failure('ARCHIVE_UNREADABLE', 'ZIP 中央目录记录不完整');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const entryCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) throw failure('ARCHIVE_ENCRYPTED', '该归档已加密，本机无法读取');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw failure('ARCHIVE_UNREADABLE', `ZIP 条目 ${name} 的本地记录不完整`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) {
      throw failure('ARCHIVE_UNREADABLE', `ZIP 条目 ${name} 的数据越界`);
    }
    if (seen.has(name)) throw failure('ARCHIVE_UNREADABLE', `ZIP 归档包含重复条目 ${name}`);
    seen.add(name);
    entries.push({
      name,
      method,
      crc32: entryCrc,
      compressedSize,
      uncompressedSize,
      dataDescriptor: (flags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0,
      raw: Buffer.from(buffer.subarray(dataStart, dataStart + compressedSize)),
    });
  }
  return entries;
}

export function zipEntryBuffer(entry) {
  if (entry.method === ZIP_METHOD_STORE) return Buffer.from(entry.raw);
  if (entry.method === ZIP_METHOD_DEFLATE) {
    try {
      return inflateRawSync(entry.raw);
    } catch {
      throw failure('ARCHIVE_UNREADABLE', `ZIP 条目 ${entry.name} 无法解压；文件可能已损坏`);
    }
  }
  throw failure('ARCHIVE_UNSUPPORTED_COMPRESSION', `ZIP 条目 ${entry.name} 使用不支持的压缩方法 ${entry.method}`);
}

export function zipEntryText(entry) {
  return zipEntryBuffer(entry).toString('utf8');
}

function deflatedPart(name, data) {
  const raw = deflateRawSync(data, { level: 9 });
  return { name, method: ZIP_METHOD_DEFLATE, crc32: crc32(data), raw, uncompressedSize: data.length };
}

function verbatimPart(entry) {
  return {
    name: entry.name,
    method: entry.method,
    crc32: entry.crc32,
    raw: Buffer.from(entry.raw),
    uncompressedSize: entry.uncompressedSize,
  };
}

/**
 * Writes a ZIP archive. `parts` entries are either verbatim ZIP parts (kept
 * byte-for-byte) or raw payloads that get deflated here.
 */
export function buildZipArchive(parts) {
  const localChunks = [];
  const centralChunks = [];
  const records = [];
  let offset = 0;

  for (const input of parts) {
    const part = input.data ? deflatedPart(input.name, Buffer.from(input.data)) : input;
    const nameBuffer = Buffer.from(part.name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(ZIP_LOCAL_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(ZIP_FLAG_UTF8, 6);
    header.writeUInt16LE(part.method, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(ZIP_DOS_DATE_1980, 12);
    header.writeUInt32LE(part.crc32, 14);
    header.writeUInt32LE(part.raw.length, 18);
    header.writeUInt32LE(part.uncompressedSize, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    localChunks.push(header, nameBuffer, part.raw);
    records.push({ part, nameBuffer, localOffset: offset });
    offset += 30 + nameBuffer.length + part.raw.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const record of records) {
    const { part, nameBuffer, localOffset } = record;
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(ZIP_CENTRAL_SIGNATURE, 0);
    entry.writeUInt16LE(0x031e, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(ZIP_FLAG_UTF8, 8);
    entry.writeUInt16LE(part.method, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(ZIP_DOS_DATE_1980, 14);
    entry.writeUInt32LE(part.crc32, 16);
    entry.writeUInt32LE(part.raw.length, 20);
    entry.writeUInt32LE(part.uncompressedSize, 24);
    entry.writeUInt16LE(nameBuffer.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(localOffset, 42);
    centralChunks.push(entry, nameBuffer);
    centralSize += 46 + nameBuffer.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 18);

  return Buffer.concat([...localChunks, ...centralChunks, end]);
}

function archiveEntry(entries, name) {
  return entries.find((entry) => entry.name === name);
}

function requireArchiveEntry(entries, name) {
  const entry = archiveEntry(entries, name);
  if (!entry) throw failure('DOCX_INVALID', `DOCX 缺少必需部件 ${name}`);
  return entry;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/* ------------------------------------------------------------------ XML ---- */

const TAG_PATTERN = /<([!/?]?)([A-Za-z_][\w:.\-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const XML_ENTITY_PATTERN = /&(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g;

function codePointText(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '\uFFFD';
  }
}

export function decodeXmlEntities(text) {
  return text.replace(XML_ENTITY_PATTERN, (match, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) return codePointText(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return codePointText(Number.parseInt(entity.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? match;
  });
}

export function escapeXmlText(value) {
  return value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
}

function withoutComments(fragment) {
  // Keep byte offsets stable by blanking comments instead of removing them.
  return fragment.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length));
}

/**
 * Returns the top-level elements of an XML fragment with their offsets. This is
 * deliberately a scanner, not a full XML parser: OOXML output from `docx` (and
 * Word) is well-formed enough for offset-accurate element slicing.
 */
export function scanXmlElements(fragment) {
  const source = withoutComments(fragment);
  const elements = [];
  let depth = 0;
  let current;
  TAG_PATTERN.lastIndex = 0;
  for (let match = TAG_PATTERN.exec(source); match !== null; match = TAG_PATTERN.exec(source)) {
    const tag = match[0];
    const prefix = match[1];
    const name = match[2];
    const selfClosing = match[4] === '/';
    if (prefix === '!' || prefix === '?') continue;
    if (tag.startsWith('</')) {
      depth -= 1;
      if (depth === 0 && current) {
        elements.push({ name: current.name, start: current.start, end: match.index + tag.length, xml: fragment.slice(current.start, match.index + tag.length) });
        current = undefined;
      }
      continue;
    }
    if (depth === 0) current = { name, start: match.index };
    if (!selfClosing) {
      depth += 1;
      continue;
    }
    if (depth === 0 && current) {
      elements.push({ name, start: current.start, end: match.index + tag.length, xml: fragment.slice(current.start, match.index + tag.length) });
      current = undefined;
    }
  }
  return elements;
}

function innerOf(element) {
  const openEnd = element.xml.indexOf('>') + 1;
  const closeStart = element.xml.lastIndexOf('</');
  return closeStart < openEnd ? '' : element.xml.slice(openEnd, closeStart);
}

function splitDocumentBody(documentXml) {
  const open = documentXml.match(/<w:body(?:\s[^>]*)?>/);
  if (!open) throw failure('DOCX_INVALID', 'word/document.xml 缺少 w:body');
  const contentStart = open.index + open[0].length;
  const closeStart = documentXml.lastIndexOf('</w:body>');
  if (closeStart < contentStart) throw failure('DOCX_INVALID', 'word/document.xml 的 w:body 结构不完整');
  return {
    prefix: documentXml.slice(0, contentStart),
    content: documentXml.slice(contentStart, closeStart),
    suffix: documentXml.slice(closeStart),
  };
}

/* ----------------------------------------------------------------- DOCX ---- */

function readStyleNames(entries) {
  const styleEntry = archiveEntry(entries, 'word/styles.xml');
  if (!styleEntry) return new Map();
  const stylesXml = zipEntryText(styleEntry);
  const stylesRoot = stylesXml.match(/<w:styles(?:\s[^>]*)?>[\s\S]*<\/w:styles>/);
  const names = new Map();
  if (!stylesRoot) return names;
  for (const element of scanXmlElements(innerOf({ xml: stylesRoot[0] }))) {
    if (element.name !== 'w:style') continue;
    const id = element.xml.match(/<w:style[^>]*w:styleId="([^"]*)"/)?.[1];
    const name = element.xml.match(/<w:name[^>]*w:val="([^"]*)"/)?.[1];
    if (id) names.set(id, name ? decodeXmlEntities(name) : id);
  }
  return names;
}

function headingLevelFromStyle(styleId, styleName, outlineLevel) {
  const candidates = [styleId, styleName].filter(Boolean).map((value) => value.replace(/\s+/gu, '').toLowerCase());
  for (const candidate of candidates) {
    if (candidate === 'title' || candidate === '标题') return 'title';
    let match = candidate.match(/^heading(\d)$/u);
    if (match) return Number(match[1]);
    match = candidate.match(/^h([1-9])$/u);
    if (match) return Number(match[1]);
    match = candidate.match(/^(?:标题|heading|標題)\s*?(\d)$/u);
    if (match) return Number(match[1]);
    match = candidate.match(/^([1-9])$/u);
    if (match) return Number(match[1]);
  }
  return outlineLevel;
}

function paragraphTextNodes(paragraphXml) {
  const nodes = [];
  for (const match of paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
    nodes.push({
      start: match.index,
      end: match.index + match[0].length,
      innerStart: match.index + match[0].indexOf('>') + 1,
      innerEnd: match.index + match[0].length - '</w:t>'.length,
      text: decodeXmlEntities(match[1]),
    });
  }
  return nodes;
}

function parseParagraph(paragraphXml, styleNames) {
  const properties = paragraphXml.match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  const styleId = properties.match(/<w:pStyle[^>]*w:val="([^"]*)"/)?.[1];
  const styleName = styleId ? styleNames.get(styleId) : undefined;
  const outlineValue = properties.match(/<w:outlineLvl[^>]*w:val="(\d+)"/)?.[1];
  const outlineLevel = outlineValue === undefined ? undefined : Number(outlineValue) + 1;
  const text = paragraphTextNodes(paragraphXml).map((node) => node.text).join('');
  return {
    styleId: styleId ?? 'Normal',
    styleName: styleName ?? styleId ?? '正文',
    headingLevel: headingLevelFromStyle(styleId, styleName, outlineLevel),
    text,
    numberingId: properties.match(/<w:numId[^>]*w:val="(\d+)"/)?.[1],
    imageCount: (paragraphXml.match(/<w:(?:drawing|pict)(?:\s|>)/g) ?? []).length,
    hasLineBreak: /<w:br(?:\s|>|\/)/.test(paragraphXml),
    tableCount: (paragraphXml.match(/<w:tbl(?:\s|>)/g) ?? []).length,
  };
}

function parseTable(tableXml) {
  const rows = [];
  let mergedCellCount = 0;
  for (const rowElement of scanXmlElements(innerOf({ xml: tableXml }))) {
    if (rowElement.name !== 'w:tr') continue;
    const cells = [];
    for (const cellElement of scanXmlElements(innerOf(rowElement))) {
      if (cellElement.name !== 'w:tc') continue;
      const span = Number(cellElement.xml.match(/<w:gridSpan[^>]*w:val="(\d+)"/)?.[1] ?? '1');
      if (span > 1) mergedCellCount += 1;
      const text = [...cellElement.xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map((match) => decodeXmlEntities(match[1]))
        .join('');
      cells.push({ text, gridSpan: span, verticalMerge: /<w:vMerge(?:\s|>|\/)/.test(cellElement.xml) });
    }
    rows.push(cells);
  }
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return {
    rowCount: rows.length,
    columnCount,
    header: (rows[0] ?? []).map((cell) => cell.text),
    rows: rows.map((row) => row.map((cell) => cell.text)),
    mergedCellCount,
  };
}

/**
 * Reads a real `.docx` into a structured, comparable model: ordered blocks with
 * paragraph text, style id/name, heading level, and real tables.
 */
export function readDocxStructure(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length > MAX_DOCX_BYTES) throw failure('DOCX_TOO_LARGE', `DOCX 超过 ${MAX_DOCX_BYTES} 字节上限`);
  const entries = readZipArchive(buffer);
  const documentEntry = requireArchiveEntry(entries, 'word/document.xml');
  const documentXml = zipEntryText(documentEntry);
  const body = splitDocumentBody(documentXml);
  const styleNames = readStyleNames(entries);
  const elements = scanXmlElements(body.content);

  const blocks = [];
  let imageCount = 0;
  let sectionCount = 0;
  for (const element of elements) {
    if (element.name === 'w:p') {
      const paragraph = parseParagraph(element.xml, styleNames);
      imageCount += paragraph.imageCount;
      const numbered = paragraph.numberingId !== undefined && paragraph.headingLevel === undefined;
      blocks.push({
        index: blocks.length + 1,
        kind: paragraph.headingLevel !== undefined ? 'heading' : numbered ? 'list' : 'paragraph',
        text: paragraph.text,
        styleId: paragraph.styleId,
        styleName: paragraph.styleName,
        headingLevel: paragraph.headingLevel,
        hasLineBreak: paragraph.hasLineBreak,
      });
    } else if (element.name === 'w:tbl') {
      const table = parseTable(element.xml);
      blocks.push({
        index: blocks.length + 1,
        kind: 'table',
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        header: table.header,
        rows: table.rows,
        mergedCellCount: table.mergedCellCount,
      });
    } else if (element.name === 'w:sectPr') {
      sectionCount += 1;
    }
  }

  const coreEntry = archiveEntry(entries, 'docProps/core.xml');
  const coreXml = coreEntry ? zipEntryText(coreEntry) : '';
  const title = coreXml.match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1];
  const mediaNames = entries.filter((entry) => entry.name.startsWith('word/media/')).map((entry) => entry.name);

  return {
    byteLength: buffer.length,
    title: title ? decodeXmlEntities(title) : undefined,
    paragraphs: blocks.filter((block) => block.kind === 'paragraph').length,
    lists: blocks.filter((block) => block.kind === 'list').length,
    headings: blocks.filter((block) => block.kind === 'heading').length,
    tables: blocks.filter((block) => block.kind === 'table').length,
    blocks,
    imageCount,
    mediaFileCount: mediaNames.length,
    mediaFiles: mediaNames,
    sectionCount,
    styleNameCount: styleNames.size,
    partNames: entries.map((entry) => entry.name),
  };
}

/* ------------------------------------------------------------- DOCX edit ---- */

function findOccurrences(text, needle, limit) {
  const positions = [];
  let from = 0;
  while (positions.length < limit) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    positions.push(index);
    from = index + needle.length;
  }
  return positions;
}

function rebuildTextNodes(paragraphXml, nodes, texts) {
  let rebuilt = paragraphXml;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (texts[index] === nodes[index].text) continue;
    const node = nodes[index];
    const replacement = `<w:t xml:space="preserve">${escapeXmlText(texts[index])}</w:t>`;
    rebuilt = `${rebuilt.slice(0, node.start)}${replacement}${rebuilt.slice(node.end)}`;
  }
  return rebuilt;
}

function replaceParagraphText(paragraphXml, oldText, newText, occurrence) {
  const nodes = paragraphTextNodes(paragraphXml);
  const texts = nodes.map((node) => node.text);
  const globalText = texts.join('');
  if (globalText.length === 0) return undefined;
  const limit = occurrence === 'all' ? Number.MAX_SAFE_INTEGER : 1;
  const positions = findOccurrences(globalText, oldText, limit);
  if (positions.length === 0) return undefined;
  const offsets = [];
  let running = 0;
  for (const text of texts) {
    offsets.push(running);
    running += text.length;
  }
  for (let index = positions.length - 1; index >= 0; index -= 1) {
    const start = positions[index];
    const end = start + oldText.length;
    for (let nodeIndex = 0; nodeIndex < texts.length; nodeIndex += 1) {
      const globalStart = offsets[nodeIndex];
      const globalEnd = globalStart + texts[nodeIndex].length;
      if (globalEnd <= start || globalStart >= end) continue;
      const localStart = Math.max(start, globalStart) - globalStart;
      const localEnd = Math.min(end, globalEnd) - globalStart;
      const insertion = start >= globalStart && start < globalEnd ? newText : '';
      texts[nodeIndex] = `${texts[nodeIndex].slice(0, localStart)}${insertion}${texts[nodeIndex].slice(localEnd)}`;
    }
  }
  return {
    xml: rebuildTextNodes(paragraphXml, nodes, texts),
    replacedTextNodes: nodes.filter((node, index) => texts[index] !== node.text).length,
    matchCount: positions.length,
    resultText: texts.join(''),
    beforeText: globalText,
  };
}

function insertParagraphXml(text, headingLevel) {
  const properties = headingLevel === undefined ? '' : `<w:pPr><w:pStyle w:val="Heading${headingLevel}"/></w:pPr>`;
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`;
}

function rebuildParagraphPreservingProperties(paragraphXml, text) {
  const properties = paragraphXml.match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`;
}

function assertPlainText(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > MAX_EDIT_TEXT_LENGTH || (!allowEmpty && value.length === 0)) {
    throw failure('EDIT_OP_INVALID', `${label} 必须是长度 1-${MAX_EDIT_TEXT_LENGTH} 的字符串`);
  }
  return value;
}

function assertBlockIndex(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw failure('EDIT_OP_INVALID', `${label} 必须是大于 0 的整数块序号`);
  return value;
}

function normalizeEditOps(ops) {
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_EDIT_OPS) {
    throw failure('EDIT_OP_INVALID', `ops 必须包含 1-${MAX_EDIT_OPS} 个操作`);
  }
  return ops.map((op, index) => {
    const label = `ops[${index}]`;
    if (typeof op !== 'object' || op === null || Array.isArray(op)) throw failure('EDIT_OP_INVALID', `${label} 必须是对象`);
    if (op.op === 'set_block_text') {
      return { op: 'set_block_text', blockIndex: assertBlockIndex(op.blockIndex, `${label}.blockIndex`), text: assertPlainText(op.text, `${label}.text`, { allowEmpty: true }) };
    }
    if (op.op === 'replace_text') {
      return {
        op: 'replace_text',
        blockIndex: op.blockIndex === undefined ? undefined : assertBlockIndex(op.blockIndex, `${label}.blockIndex`),
        oldText: assertPlainText(op.oldText, `${label}.oldText`),
        newText: assertPlainText(op.newText, `${label}.newText`, { allowEmpty: true }),
        occurrence: op.occurrence === 'all' ? 'all' : 'first',
      };
    }
    if (op.op === 'insert_paragraph') {
      const after = op.afterBlockIndex ?? 0;
      if (!Number.isSafeInteger(after) || after < 0) throw failure('EDIT_OP_INVALID', `${label}.afterBlockIndex 必须是 0 或大于 0 的整数`);
      const headingLevel = op.headingLevel === undefined ? undefined : op.headingLevel;
      if (headingLevel !== undefined && headingLevel !== 1 && headingLevel !== 2) {
        throw failure('EDIT_OP_INVALID', `${label}.headingLevel 只能是 1 或 2`);
      }
      return { op: 'insert_paragraph', afterBlockIndex: after, text: assertPlainText(op.text, `${label}.text`), headingLevel };
    }
    if (op.op === 'delete_block') {
      return { op: 'delete_block', blockIndex: assertBlockIndex(op.blockIndex, `${label}.blockIndex`) };
    }
    throw failure('EDIT_OP_INVALID', `${label}.op 只能是 set_block_text、replace_text、insert_paragraph 或 delete_block`);
  });
}

function assertParagraphTarget(blocks, blockIndex, label) {
  const block = blocks[blockIndex - 1];
  if (!block) throw failure('EDIT_BLOCK_NOT_FOUND', `${label} 指向的块序号 ${blockIndex} 不存在（当前共 ${blocks.length} 块）`);
  if (block.kind === 'table') {
    throw failure('EDIT_TABLE_UNSUPPORTED', `${label} 指向表格块；当前 doc_edit 只改写段落文本，不重排表格`);
  }
  return block;
}

/**
 * Applies a bounded, explicit list of paragraph edits to a real `.docx` and
 * returns a *new* archive. Everything outside the edited `word/document.xml`
 * text nodes is republished from the original compressed bytes, so unchanged
 * parts are preserved byte-for-byte rather than re-laid-out.
 */
export function editDocxDocument(bytes, { ops } = {}) {
  const normalizedOps = normalizeEditOps(ops);
  const buffer = Buffer.from(bytes);
  if (buffer.length > MAX_DOCX_BYTES) throw failure('DOCX_TOO_LARGE', `DOCX 超过 ${MAX_DOCX_BYTES} 字节上限`);
  const entries = readZipArchive(buffer);
  const documentEntry = requireArchiveEntry(entries, 'word/document.xml');
  const documentXml = zipEntryText(documentEntry);
  const styleNames = readStyleNames(entries);
  const body = splitDocumentBody(documentXml);

  const beforeStructure = readDocxStructure(buffer);
  const beforeBlocks = beforeStructure.blocks;
  const simulatedTexts = [];
  const simulatedKinds = [];
  for (const block of beforeBlocks) {
    simulatedTexts.push(block.kind === 'table' ? undefined : block.text);
    simulatedKinds.push(block.kind === 'table' ? 'table' : 'paragraph');
  }

  const working = scanXmlElements(body.content).map((element) => ({ name: element.name, xml: element.xml }));
  const blockPositions = () => working
    .map((entry, position) => (entry.name === 'w:p' || entry.name === 'w:tbl' ? position : -1))
    .filter((position) => position >= 0);
  const blockModel = () => blockPositions().map((position, index) => ({
    kind: working[position].name === 'w:p' ? 'paragraph' : 'table',
    text: simulatedTexts[index],
    index: index + 1,
  }));

  const changes = [];
  for (const op of normalizedOps) {
    if (op.op === 'insert_paragraph') {
      const positions = blockPositions();
      if (op.afterBlockIndex > positions.length) {
        throw failure('EDIT_BLOCK_NOT_FOUND', `insert_paragraph 的 afterBlockIndex ${op.afterBlockIndex} 不存在（当前共 ${positions.length} 块）`);
      }
      const insertAt = op.afterBlockIndex === 0 ? (positions[0] ?? working.length) : positions[op.afterBlockIndex - 1] + 1;
      working.splice(insertAt, 0, { name: 'w:p', xml: insertParagraphXml(op.text, op.headingLevel) });
      const blockIndex = op.afterBlockIndex + 1;
      simulatedTexts.splice(blockIndex - 1, 0, op.text);
      simulatedKinds.splice(blockIndex - 1, 0, 'paragraph');
      changes.push({ op: op.op, blockIndex, before: undefined, after: op.text, detail: `在第 ${op.afterBlockIndex} 块之后插入新段落` });
      continue;
    }

    if (op.op === 'delete_block') {
      const model = blockModel();
      assertParagraphTarget(model, op.blockIndex, 'delete_block');
      const positions = blockPositions();
      const removed = simulatedTexts[op.blockIndex - 1];
      working.splice(positions[op.blockIndex - 1], 1);
      simulatedTexts.splice(op.blockIndex - 1, 1);
      simulatedKinds.splice(op.blockIndex - 1, 1);
      changes.push({ op: op.op, blockIndex: op.blockIndex, before: removed, after: undefined, detail: `删除第 ${op.blockIndex} 块段落` });
      continue;
    }

    const targets = [];
    if (op.blockIndex !== undefined) {
      targets.push(op.blockIndex);
    } else if (op.op === 'replace_text') {
      blockModel().forEach((block) => {
        if (block.kind === 'paragraph') targets.push(block.index);
      });
    } else {
      throw failure('EDIT_OP_INVALID', `${op.op} 必须提供 blockIndex`);
    }

    let applied = 0;
    for (const blockIndex of targets) {
      const model = blockModel();
      const block = assertParagraphTarget(model, blockIndex, op.op);
      const positions = blockPositions();
      const position = positions[blockIndex - 1];
      const paragraphXml = working[position].xml;
      const beforeText = block.text;
      const oldText = op.op === 'set_block_text' ? beforeText : op.oldText;

      if (oldText.length === 0) {
        if (op.op === 'set_block_text') {
          working[position] = { name: 'w:p', xml: rebuildParagraphPreservingProperties(paragraphXml, op.text) };
          simulatedTexts[blockIndex - 1] = op.text;
          applied += 1;
          changes.push({ op: op.op, blockIndex, before: '', after: op.text, replacedTextNodes: 0, detail: '原段落没有可编辑文本节点，已重建为单段落文本；段落级属性保留' });
        }
        continue;
      }

      const result = replaceParagraphText(paragraphXml, oldText, op.op === 'set_block_text' ? op.text : op.newText, op.occurrence ?? 'first');
      if (!result) continue;
      working[position] = { name: 'w:p', xml: result.xml };
      simulatedTexts[blockIndex - 1] = result.resultText;
      applied += 1;
      changes.push({
        op: op.op,
        blockIndex,
        before: op.op === 'set_block_text' ? beforeText : oldText,
        after: op.op === 'set_block_text' ? op.text : op.newText,
        replacedTextNodes: result.replacedTextNodes,
        matchCount: result.matchCount,
        detail: op.op === 'set_block_text'
          ? '整段文本被替换；段落级属性保留，匹配范围外的 run 未改动'
          : `替换 ${result.matchCount} 处文本；匹配范围外的 run 与全部其他部件逐字节保留`,
      });
      if (op.blockIndex === undefined && op.occurrence !== 'all') break;
    }
    if (applied === 0 && op.op === 'replace_text') {
      throw failure('EDIT_TEXT_NOT_FOUND', `找不到要替换的文本：${op.oldText.slice(0, 60)}`);
    }
  }

  const nextDocumentXml = `${body.prefix}${working.map((entry) => entry.xml).join('')}${body.suffix}`;
  const parts = entries.map((entry) => (entry.name === 'word/document.xml' ? { name: entry.name, data: Buffer.from(nextDocumentXml, 'utf8') } : verbatimPart(entry)));
  const nextBuffer = buildZipArchive(parts);

  const verification = verifyEditedDocx(nextBuffer, {
    beforeStructure,
    simulatedTexts,
    simulatedKinds,
    originalEntries: entries,
    originalXml: documentXml,
    nextXml: nextDocumentXml,
  });

  return {
    buffer: nextBuffer,
    byteLength: nextBuffer.length,
    sha256: sha256Hex(nextBuffer),
    changes,
    verification,
    preserved: {
      partCount: entries.length,
      verbatimParts: entries.filter((entry) => entry.name !== 'word/document.xml').map((entry) => entry.name),
    },
  };
}

function verifyEditedDocx(nextBuffer, { beforeStructure, simulatedTexts, simulatedKinds, originalEntries, originalXml, nextXml }) {
  const reread = readDocxStructure(nextBuffer);
  const actualTexts = reread.blocks.map((block) => (block.kind === 'table' ? undefined : block.text));
  const actualKinds = reread.blocks.map((block) => (block.kind === 'table' ? 'table' : 'paragraph'));
  const paragraphTextsMatch = simulatedTexts.length === actualTexts.length
    && simulatedTexts.every((text, index) => text === actualTexts[index]);
  const paragraphKindsMatch = simulatedKinds.length === actualKinds.length
    && simulatedKinds.every((kind, index) => kind === actualKinds[index]);
  const beforeTables = JSON.stringify(beforeStructure.blocks.filter((block) => block.kind === 'table').map((block) => block.rows));
  const afterTables = JSON.stringify(reread.blocks.filter((block) => block.kind === 'table').map((block) => block.rows));
  const nextEntries = readZipArchive(nextBuffer);
  const untouchedParts = originalEntries.filter((entry) => entry.name !== 'word/document.xml');
  const partsPreserved = nextEntries.length === originalEntries.length
    && untouchedParts.every((entry) => {
      const published = nextEntries.find((candidate) => candidate.name === entry.name);
      return Boolean(published) && published.raw.equals(entry.raw);
    });
  const rereadOk = reread.partNames.includes('word/document.xml');
  const styleNameCountUnchanged = reread.styleNameCount === beforeStructure.styleNameCount;
  const mediaFileCountUnchanged = reread.mediaFileCount === beforeStructure.mediaFileCount;
  const tableCountUnchanged = reread.tables === beforeStructure.tables;
  return {
    rereadOk,
    documentXmlRewritten: nextXml !== originalXml,
    paragraphTextsMatch,
    paragraphKindsMatch,
    tablesUnchanged: beforeTables === afterTables,
    partsPreservedByteForByte: partsPreserved,
    styleNameCountUnchanged,
    mediaFileCountUnchanged,
    tableCountUnchanged,
    passed: rereadOk
      && paragraphTextsMatch
      && paragraphKindsMatch
      && beforeTables === afterTables
      && partsPreserved
      && styleNameCountUnchanged
      && mediaFileCountUnchanged
      && tableCountUnchanged,
  };
}

/* ------------------------------------------------------------------ PDF ---- */

function pdfFailure(code, message) {
  return failure(code, message);
}

function decodeUtf16Be(hex) {
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length % 2 !== 0) return '';
  const units = [];
  for (let index = 0; index < bytes.length; index += 2) units.push((bytes[index] << 8) | bytes[index + 1]);
  return String.fromCharCode(...units);
}

function padHex(value, length) {
  return value.toString(16).toUpperCase().padStart(length, '0');
}

export function parseToUnicodeCmap(text) {
  const map = new Map();
  for (const section of text.matchAll(/beginbfchar\s*([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(pair[1].toUpperCase(), decodeUtf16Be(pair[2]));
    }
  }
  for (const section of text.matchAll(/beginbfrange\s*([\s\S]*?)endbfrange/g)) {
    const pattern = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    for (const range of section[1].matchAll(pattern)) {
      const low = Number.parseInt(range[1], 16);
      const high = Number.parseInt(range[2], 16);
      if (range[3] !== undefined) {
        const destination = Number.parseInt(range[3], 16);
        for (let code = low; code <= high; code += 1) {
          map.set(padHex(code, range[1].length), decodeUtf16Be(padHex(destination + code - low, range[3].length)));
        }
      } else {
        const targets = [...range[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((match) => match[1]);
        targets.forEach((target, index) => {
          if (low + index <= high) map.set(padHex(low + index, range[1].length), decodeUtf16Be(target));
        });
      }
    }
  }
  return map;
}

function streamContentBytes(context, stream) {
  const raw = stream instanceof PDFRawStream ? stream.getContents() : stream.getContents();
  try {
    const decoded = decodePDFRawStream({ dict: stream.dict, contents: raw });
    if (typeof decoded.getBytes === 'function') return Buffer.from(decoded.getBytes());
    return Buffer.from(decoded.bytes ?? raw);
  } catch (error) {
    if (/Filter/.test(String(error?.message ?? '')) || error?.name === 'UnsupportedEncodingError') return Buffer.from(raw);
    return Buffer.from(raw);
  }
}

function pageFontCmaps(page, context) {
  const cmaps = new Map();
  const resources = page.node.Resources();
  const fonts = resources?.lookup(PDFName.of('Font'), PDFDict);
  if (!fonts) return cmaps;
  for (const [key, value] of fonts.entries()) {
    const fontDict = context.lookup(value, PDFDict);
    if (!fontDict) continue;
    const toUnicode = fontDict.lookupMaybe(PDFName.of('ToUnicode'), PDFStream);
    const baseFont = fontDict.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText();
    const subtype = fontDict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
    cmaps.set(key.asString(), {
      baseFont,
      subtype,
      cmap: toUnicode ? parseToUnicodeCmap(streamContentBytes(context, toUnicode).toString('latin1')) : undefined,
    });
  }
  return cmaps;
}

function contentStreamText(page, context) {
  const contents = page.node.Contents();
  const streams = [];
  if (contents instanceof PDFArray) {
    for (let index = 0; index < contents.size(); index += 1) {
      const stream = context.lookup(contents.get(index), PDFStream);
      if (stream) streams.push(stream);
    }
  } else if (contents instanceof PDFStream) {
    streams.push(contents);
  }
  return streams.map((stream) => streamContentBytes(context, stream).toString('latin1')).join('\n');
}

const CONTENT_DELIMITERS = new Set([' ', '\n', '\r', '\t', '\f', '\0', '(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function isDelimiter(character) {
  return character === undefined || CONTENT_DELIMITERS.has(character);
}

function decodeLiteralString(source, start) {
  let depth = 0;
  let text = '';
  let index = start;
  for (; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      const next = source[index + 1];
      const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[next];
      if (simple !== undefined) {
        text += simple;
        index += 1;
        continue;
      }
      const octal = source.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];
      if (octal) {
        text += String.fromCharCode(Number.parseInt(octal, 8));
        index += octal.length;
        continue;
      }
      text += next ?? '';
      index += 1;
      continue;
    }
    if (character === '(') {
      depth += 1;
      if (depth === 1) continue;
    }
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return { value: text, end: index + 1 };
    }
    text += character;
  }
  return { value: text, end: index };
}

function tokenizeContentStream(content) {
  const tokens = [];
  let index = 0;
  while (index < content.length) {
    const character = content[index];
    if (character === ' ' || character === '\n' || character === '\r' || character === '\t' || character === '\f' || character === '\0') {
      index += 1;
      continue;
    }
    if (character === '%') {
      while (index < content.length && content[index] !== '\n' && content[index] !== '\r') index += 1;
      continue;
    }
    if (character === '/') {
      let end = index + 1;
      while (end < content.length && !isDelimiter(content[end])) end += 1;
      tokens.push({ type: 'name', value: content.slice(index, end) });
      index = end;
      continue;
    }
    if (character === '(') {
      const literal = decodeLiteralString(content, index);
      tokens.push({ type: 'literal', value: literal.value });
      index = literal.end;
      continue;
    }
    if (character === '<') {
      if (content[index + 1] === '<') {
        tokens.push({ type: 'dictStart' });
        index += 2;
        continue;
      }
      const end = content.indexOf('>', index);
      if (end < 0) break;
      tokens.push({ type: 'hex', value: content.slice(index + 1, end).replace(/\s+/gu, '') });
      index = end + 1;
      continue;
    }
    if (character === '>') {
      tokens.push({ type: 'dictEnd' });
      index += 1;
      continue;
    }
    if (character === '[') {
      tokens.push({ type: 'arrayStart' });
      index += 1;
      continue;
    }
    if (character === ']') {
      tokens.push({ type: 'arrayEnd' });
      index += 1;
      continue;
    }
    if (character === '{' || character === '}') {
      index += 1;
      continue;
    }
    let end = index;
    while (end < content.length && !isDelimiter(content[end])) end += 1;
    const word = content.slice(index, end);
    tokens.push(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word) ? { type: 'number', value: word } : { type: 'operator', value: word });
    index = end;
  }
  return tokens;
}

function decodeBytesWithCmap(bytes, cmap) {
  const lengths = [...new Set([...cmap.keys()].map((key) => key.length))].sort((left, right) => right - left);
  let offset = 0;
  let text = '';
  let unmapped = 0;
  while (offset < bytes.length) {
    let matched = false;
    for (const length of lengths) {
      const byteCount = length / 2;
      if (!Number.isInteger(byteCount) || byteCount < 1 || offset + byteCount > bytes.length) continue;
      const key = bytes.subarray(offset, offset + byteCount).toString('hex').toUpperCase();
      if (!cmap.has(key)) continue;
      text += cmap.get(key);
      offset += byteCount;
      matched = true;
      break;
    }
    if (!matched) {
      unmapped += 1;
      offset += 1;
      text += '\uFFFD';
    }
  }
  return { text, unmapped };
}

function contentFragmentText(token, fontState) {
  const bytes = token.type === 'hex'
    ? Buffer.from(token.value.length % 2 === 1 ? `${token.value}0` : token.value, 'hex')
    : Buffer.from(token.value, 'latin1');
  const font = fontState.current ? fontState.fonts.get(fontState.current) : undefined;
  if (font?.cmap && font.cmap.size > 0) {
    const result = decodeBytesWithCmap(bytes, font.cmap);
    fontState.unmapped += result.unmapped;
    fontState.usedCmap = true;
    return result.text;
  }
  if ([...bytes].every((byte) => byte < 0x80)) {
    fontState.usedAsciiFallback = true;
    return bytes.toString('latin1');
  }
  fontState.unmapped += bytes.length;
  return '\uFFFD'.repeat(bytes.length);
}

/**
 * 粗略估算一段文本的推进宽度（单位：pt），用于判断同一基线上两段文字是"首尾相接"
 * 还是"中间留了空隙"。只求把接续与留白分开，不追求精确排版宽度：
 *   CJK/全角 ~1em，拉丁宽字符 ~0.88em，窄字符 ~0.3em，空格 ~0.28em，其余 ~0.55em。
 */
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

/**
 * 一页内容流的文本抽取。
 *
 * 换行口径（2026-09-12 修）：不能"见到 Td/TD/T* 就换行"。
 * pdf-lib 每画一次文本都会补一个 `T*`，而分段绘制（见 @mochi/pdf-layout 的
 * splitScriptRuns）会把**同一行**拆成多个文本对象——按操作符换行就会把
 * 「表格由真实 Word 表格元素生成」抽成「表格由真实 / / Word / / 表格元素生成」，
 * 空格两侧凭空多出换行，复制、搜索和上游断言全部走样。
 *
 * 现在以**基线 y** 为准：
 *   - y 变了 -> 换行；
 *   - y 不变、横向留了明显空隙（表格相邻单元格）-> 补一个空格；
 *   - y 不变且首尾相接（同一行被拆开的分段）-> 直接拼接。
 * 基线算不出来时（内容流没有 Tm）才退回"见位移算子就换行"的保守行为。
 */
function extractPageText(content, fonts) {
  const fragments = [];
  const state = { fonts, current: undefined, currentSize: undefined, usedCmap: false, usedAsciiFallback: false, unmapped: 0 };
  let operands = [];
  let cursorX = null;
  let baselineY = null;
  let leading = 0;
  let pendingBreak = false;
  let last = null;

  const numericOperands = () => operands.filter((operand) => operand.type === 'number').map((operand) => Number(operand.value));
  const emit = (text, size) => {
    if (!text) return;
    if (pendingBreak) {
      fragments.push('\n');
      pendingBreak = false;
    } else if (last && baselineY !== null && last.y !== null && Math.abs(baselineY - last.y) > 0.01) {
      fragments.push('\n');
    } else if (
      last
      && baselineY !== null
      && last.y !== null
      && cursorX !== null
      && last.x !== null
      // 前后任一侧本身就以空白收/起头时不要再补空格，否则会抽成两个连续空格。
      && !/\s$/u.test(last.text)
      && !/^\s/u.test(text)
      && cursorX - (last.x + approximateTextWidth(last.text, last.size)) > Math.max(size || 12, 12) * 0.45
    ) {
      fragments.push(' ');
    }
    fragments.push(text);
    last = { y: baselineY, x: cursorX, text, size };
  };

  for (const token of tokenizeContentStream(content)) {
    if (token.type !== 'operator') {
      operands.push(token);
      continue;
    }
    const value = token.value;
    if (value === 'BT') {
      cursorX = null;
      baselineY = null;
    } else if (value === 'Tm') {
      const numbers = numericOperands();
      if (numbers.length >= 6) { cursorX = numbers[4]; baselineY = numbers[5]; }
    } else if (value === 'Td' || value === 'TD') {
      const numbers = numericOperands();
      if (numbers.length >= 2 && cursorX !== null && baselineY !== null) { cursorX += numbers[0]; baselineY -= numbers[1]; }
      else pendingBreak = true;
    } else if (value === 'T*') {
      if (baselineY !== null) baselineY -= leading;
      else pendingBreak = true;
    } else if (value === 'TL') {
      const numbers = numericOperands();
      if (numbers.length >= 1) leading = numbers[0];
    } else if (value === 'Tf') {
      const name = operands.filter((operand) => operand.type === 'name').at(-1);
      state.current = name?.value;
      state.currentSize = numericOperands().at(-1);
    } else if (value === 'Tj' || value === "'" || value === '"') {
      const operand = operands.at(-1);
      if (operand && (operand.type === 'hex' || operand.type === 'literal')) emit(contentFragmentText(operand, state), state.currentSize);
    } else if (value === 'TJ') {
      for (const operand of operands) {
        if (operand.type === 'hex' || operand.type === 'literal') emit(contentFragmentText(operand, state), state.currentSize);
      }
    }
    operands = [];
  }
  const text = fragments.join('').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text,
    usedCmap: state.usedCmap,
    usedAsciiFallback: state.usedAsciiFallback,
    unmapped: state.unmapped,
  };
}

export function parsePageRange(range, pageCount) {
  if (range === undefined || range === null || range === '') return undefined;
  const values = Array.isArray(range) ? range : String(range).split(',');
  const selected = new Set();
  for (const raw of values) {
    const value = String(raw).trim();
    if (!value) continue;
    const single = value.match(/^(\d+)$/);
    if (single) {
      const page = Number(single[1]);
      if (page < 1 || page > pageCount) throw pdfFailure('PDF_PAGE_RANGE_INVALID', `页范围 ${value} 超出 1-${pageCount}`);
      selected.add(page);
      continue;
    }
    const span = value.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!span) throw pdfFailure('PDF_PAGE_RANGE_INVALID', `页范围 ${value} 格式无效，请使用 "1-3,5" 形式`);
    const from = Number(span[1]);
    const to = Number(span[2]);
    if (from < 1 || to > pageCount || from > to) throw pdfFailure('PDF_PAGE_RANGE_INVALID', `页范围 ${value} 超出 1-${pageCount}`);
    for (let page = from; page <= to; page += 1) selected.add(page);
  }
  return [...selected].sort((left, right) => left - right);
}

/**
 * Reads a real PDF: page count, per-page size/rotation/text, and metadata.
 *
 * Text extraction needs each page font's ToUnicode CMap (see the README for the
 * exact boundary). PDFs without one are reported as `available: false` with the
 * probed reason; nothing is guessed or OCR-ed.
 */
export async function readPdfStructure(bytes, { pageRange } = {}) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 8 || buffer.toString('latin1', 0, 5) !== '%PDF-') {
    throw pdfFailure('PDF_UNREADABLE', '文件不是有效 PDF（缺少 %PDF- 头）');
  }
  if (buffer.length > MAX_PDF_BYTES) throw pdfFailure('PDF_TOO_LARGE', `PDF 超过 ${MAX_PDF_BYTES} 字节上限`);
  let document;
  try {
    document = await PDFDocument.load(buffer, { updateMetadata: false });
  } catch {
    throw pdfFailure('PDF_UNREADABLE', 'PDF 无法解析（可能已加密或使用不支持的交叉引用结构）');
  }
  const pageCount = document.getPageCount();
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw pdfFailure('PDF_UNREADABLE', 'PDF 没有可读页面');
  const selected = parsePageRange(pageRange, pageCount) ?? Array.from({ length: pageCount }, (_, index) => index + 1);

  const context = document.context;
  const pages = [];
  let anyCmap = false;
  for (const pageNumber of selected) {
    const page = document.getPage(pageNumber - 1);
    const fonts = pageFontCmaps(page, context);
    const hasCmap = [...fonts.values()].some((font) => font.cmap && font.cmap.size > 0);
    if (hasCmap) anyCmap = true;
    const extraction = extractPageText(contentStreamText(page, context), fonts);
    const truncated = extraction.text.length > MAX_TEXT_PER_PAGE;
    pages.push({
      page: pageNumber,
      width: Number(page.getWidth().toFixed(2)),
      height: Number(page.getHeight().toFixed(2)),
      rotation: page.getRotation().angle,
      fontCount: fonts.size,
      text: truncated ? extraction.text.slice(0, MAX_TEXT_PER_PAGE) : extraction.text,
      textTruncated: truncated,
      textCharCount: extraction.text.length,
      unresolvedCodeCount: extraction.unmapped,
      extraction: !hasCmap && extraction.usedAsciiFallback
        ? 'ascii-during-missing-tounicode'
        : extraction.unmapped > 0 && !extraction.usedCmap
          ? 'unavailable'
          : hasCmap
            ? 'tounicode'
            : 'unavailable',
    });
  }

  const available = anyCmap || pages.some((page) => page.extraction !== 'unavailable');
  let documentText;
  let documentTextSource = 'per-page';
  if (available) {
    documentText = pages.map((page) => page.text).filter(Boolean).join('\n');
  } else {
    try {
      documentText = extractPdfText(buffer);
      documentTextSource = 'mochi-pdf-layout:extractPdfText';
    } catch {
      documentText = undefined;
      documentTextSource = undefined;
    }
  }

  return {
    byteLength: buffer.length,
    pageCount,
    pageRange: pageRange === undefined ? undefined : selected,
    pages,
    metadata: {
      title: document.getTitle(),
      author: document.getAuthor(),
      subject: document.getSubject(),
      creator: document.getCreator(),
      producer: document.getProducer(),
      creationDate: document.getCreationDate()?.toISOString(),
      modificationDate: document.getModificationDate()?.toISOString(),
    },
    textExtraction: {
      available,
      method: available ? '每个页面字体资源的 ToUnicode CMap（pdf-lib 内容流 + 逐字体 CMap 解码）' : undefined,
      documentTextSource,
      pagesWithoutText: pages.filter((page) => page.extraction === 'unavailable').map((page) => page.page),
      reason: available
        ? undefined
        : '本机没有可用的 PDF 文本抽取能力：该 PDF 的字体未提供 ToUnicode 映射，内容流文本又不是纯 ASCII，无法在不猜测编码的前提下解码。不做 OCR，也不伪造抽取结果。',
      boundary: '当前实现解压每页内容流并解码 Tj/TJ 文本操作；未展开 Form XObject 内的文本，也不处理未提供 ToUnicode 的 CID 字体；无 ToUnicode 时只接受可安全判定的纯 ASCII 单字节文本。',
    },
    documentText,
  };
}

/* --------------------------------------------------------------- EXPORT ---- */

/**
 * Probes fixed, host-owned locations for a local PDF export engine. A missing
 * engine is reported as unavailable; nothing is faked when it is absent.
 *
 * When a host pins explicit `candidates`, `searchPath` is skipped so the pinned
 * list is authoritative rather than silently widened by the ambient PATH.
 */
export async function probePdfExportEngine({ candidates = PDF_EXPORT_ENGINE_CANDIDATES, searchPath = true } = {}) {
  const probed = [];
  const names = process.platform === 'win32' ? ['soffice.exe', 'soffice'] : ['soffice'];
  const searchList = [...candidates];
  if (searchPath) {
    for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const name of names) searchList.push(join(directory, name));
    }
  }

  for (const candidate of searchList) {
    if (probed.some((entry) => entry.path === candidate)) continue;
    let available = false;
    try {
      await access(candidate, fsConstants.X_OK);
      available = (await stat(candidate)).isFile();
    } catch {
      available = false;
    }
    probed.push({ path: candidate, available });
    if (available) {
      return { available: true, engine: candidate, probed };
    }
  }
  return { available: false, engine: undefined, probed };
}
