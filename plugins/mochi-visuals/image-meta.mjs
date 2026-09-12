// mochi-visuals · 图片头解析（纯 JS，零依赖）。
//
// 这里不解码像素，只读文件头的宽高与格式。这样 image_find 扫描上百张图时
// 不需要把每张图都交给 canvas 解码，也避免在还没有图形运行时的环境里直接失败。
// 每个解析器都只读前若干字节，并且对畸形输入返回 null 而不是抛异常。
import { open, readFile } from 'node:fs/promises';

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];

const READ_LIMIT = 64 * 1024;

const MIME_BY_FORMAT = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export function mimeForFormat(format) {
  return MIME_BY_FORMAT[format] ?? null;
}

function isPng(buffer) {
  return buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a;
}

function parsePng(buffer) {
  // 8 字节签名 + 4 字节长度 + 'IHDR' + width(4) + height(4)
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseJpeg(buffer) {
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    // 无长度字段的标记：TEM(0x01) 与 RSTn(0xD0-0xD7)。
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (offset + 4 > buffer.length) return null;
    const size = buffer.readUInt16BE(offset + 2);
    // SOF0..SOF15，排除 DHT(C4)/JPG(C8)/DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > buffer.length) return null;
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) return null; // 到 SOS 还没遇到 SOF，说明没有可用尺寸
    offset += 2 + size;
  }
  return null;
}

function parseGif(buffer) {
  const signature = buffer.toString('latin1', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function parseBmp(buffer) {
  if (buffer.toString('latin1', 0, 2) !== 'BM') return null;
  return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
}

function parseWebp(buffer) {
  if (buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    // 24..26 / 27..29 是 24 位小端的 (宽-1) / (高-1)
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  if (chunk === 'VP8 ') {
    if (buffer.length < 30) return null;
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buffer.length < 25) return null;
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function parseSvg(buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, READ_LIMIT));
  if (!/<svg[\s>]/i.test(text)) return null;
  const openTag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!openTag) return null;
  const length = (name) => {
    const match = openTag.match(new RegExp(`${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(%|px|pt|mm|cm|in|em|rem)?`, 'i'));
    if (!match) return null;
    // width="100%" 之类的百分比表示「撑满容器」，不是固有像素尺寸；
    // 这时必须回落到 viewBox，否则会把一张 1200×675 的图报成 100×100（本机实测过）。
    if (match[2] === '%') return null;
    return Number(match[1]);
  };
  const width = length('width');
  const height = length('height');
  const viewBox = openTag.match(/viewBox\s*=\s*["']\s*([-0-9.eE\s,]+)["']/i);
  let box = null;
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      box = { width: parts[2], height: parts[3] };
    }
  }
  const finalWidth = width ?? box?.width ?? null;
  const finalHeight = height ?? box?.height ?? null;
  if (!finalWidth || !finalHeight) return null;
  return { width: Math.round(finalWidth), height: Math.round(finalHeight) };
}

const PARSERS = [
  { format: 'svg', detect: (buffer) => /<svg[\s>]/i.test(buffer.toString('utf8', 0, 512)), parse: parseSvg },
  { format: 'png', detect: isPng, parse: parsePng },
  { format: 'jpeg', detect: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff, parse: parseJpeg },
  { format: 'gif', detect: (buffer) => buffer.toString('latin1', 0, 3) === 'GIF', parse: parseGif },
  { format: 'bmp', detect: (buffer) => buffer.toString('latin1', 0, 2) === 'BM', parse: parseBmp },
  { format: 'webp', detect: (buffer) => buffer.toString('latin1', 0, 4) === 'RIFF', parse: parseWebp },
];

/** 从左到右取第一个能解析出尺寸的解析器。识别不出就返回 null，绝不猜。 */
export function probeImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const head = buffer.subarray(0, Math.min(buffer.length, READ_LIMIT));
  for (const candidate of PARSERS) {
    let detected = false;
    try {
      detected = candidate.detect(head);
    } catch {
      detected = false;
    }
    if (!detected) continue;
    const size = candidate.parse(head);
    if (size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0) {
      return { format: candidate.format, mime: mimeForFormat(candidate.format), width: size.width, height: size.height };
    }
  }
  return null;
}

/** 只读文件头，用于扫描期判断；读不到的返回 null（调用方记为“无法识别”）。 */
export async function probeImageFile(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(READ_LIMIT);
    const { bytesRead } = await handle.read(buffer, 0, READ_LIMIT, 0);
    return probeImageBuffer(buffer.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function extensionOf(path) {
  const lower = String(path ?? '').toLowerCase();
  const index = lower.lastIndexOf('.');
  return index < 0 ? '' : lower.slice(index);
}

export function isImageExtension(path) {
  return IMAGE_EXTENSIONS.includes(extensionOf(path));
}

/** 走一次完整读盘，用于 image_edit 的输入（同时拿到 buffer 与元信息）。 */
export async function readImageWithMeta(path) {
  const buffer = await readFile(path);
  const meta = probeImageBuffer(buffer);
  if (!meta) {
    throw Object.assign(new Error(`无法识别该图片格式或文件已损坏：${path}`), { code: 'IMAGE_UNREADABLE' });
  }
  return { buffer, ...meta, byteLength: buffer.length };
}

/** 宽高比的最简整数比，例如 1920x1080 → "16:9"；无法化简时返回小数形式。 */
export function simplifyAspect(width, height, tolerance = 0.01) {
  if (!width || !height) return null;
  const common = [
    [1, 1], [4, 3], [3, 2], [16, 9], [16, 10], [3, 4], [2, 3], [9, 16],
  ];
  const ratio = width / height;
  for (const [w, h] of common) {
    if (Math.abs(ratio - w / h) / (w / h) <= tolerance) return `${w}:${h}`;
  }
  const divisor = greatestCommonDivisor(width, height);
  const simplifiedW = width / divisor;
  const simplifiedH = height / divisor;
  if (simplifiedW <= 100 && simplifiedH <= 100) return `${simplifiedW}:${simplifiedH}`;
  return `${ratio.toFixed(3)}:1`;
}

export function greatestCommonDivisor(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

export function parseAspectRatio(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/i);
  if (match) {
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) return width / height;
    return null;
  }
  const single = Number(text);
  if (Number.isFinite(single) && single > 0) return single;
  return null;
}

export function orientationOf(width, height) {
  if (width === height) return '正方形';
  return width > height ? '横向' : '纵向';
}
