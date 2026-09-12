// mochi-visuals · 测试夹具。
//
// 这里手写 PNG/BMP 编码器（node:zlib + 自算 CRC32），这样 image_find 的用例
// 完全不依赖 @napi-rs/canvas 也能跑；只有真正需要解码像素的用例（image_edit、
// SVG 光栅化）才走 requireCanvas()，canvas 不可用时那些用例会被 t.skip 跳过。
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../plugin.mjs';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** 生成一张真实可解码的 RGBA PNG（8 位真彩，无交错）。 */
export function makePng(width, height, [red = 255, green = 255, blue = 255, alpha = 255] = []) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (width * 4 + 1);
    raw[offset] = 0; // filter: none
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * 4;
      raw[pixel] = red;
      raw[pixel + 1] = green;
      raw[pixel + 2] = blue;
      raw[pixel + 3] = alpha;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 生成一张真实可解码的 24 位 BMP。 */
export function makeBmp(width, height, [red = 200, green = 200, blue = 200] = []) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const buffer = Buffer.alloc(54 + pixelBytes);
  buffer.write('BM', 0, 'latin1');
  buffer.writeUInt32LE(54 + pixelBytes, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(pixelBytes, 34);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = 54 + row * rowSize + column * 3;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
    }
  }
  return buffer;
}

export function makeSvg(width, height, label = '示意图') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#3F5B99"/><text x="12" y="30" font-size="16" fill="#ffffff">${label}</text></svg>`,
    'utf8',
  );
}

export function makeCtx() {
  const tools = [];
  return {
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    logger: { info() {}, warn() {}, error() {} },
    get: () => undefined,
    registered: tools,
  };
}

/** 建一个临时工作区，并显式指定允许根与产物输出目录（都落在临时目录里）。 */
export function makeWorkspace(t, prefix = 'mochi-visuals-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const outputRoot = join(root, 'Mochi Visuals');
  mkdirSync(outputRoot, { recursive: true });
  const ctx = makeCtx();
  apply(ctx, { allowedRoots: [root], outputRoot });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, outputRoot, ctx };
}

/** 只注册插件、不指定允许根（用于测路径边界与默认行为）。 */
export function makeBareCtx(options = {}) {
  const ctx = makeCtx();
  apply(ctx, options);
  return ctx;
}

export function tool(ctx, toolName) {
  const found = ctx.registered.find((entry) => entry.name === toolName);
  if (!found) throw new Error(`未注册工具：${toolName}`);
  return found;
}

let canvasModule = null;
let canvasFailure = null;

/**
 * 需要真实像素解码的用例入口。canvas 不可用时用 t.skip 明确跳过，
 * 绝不假装通过。
 */
export async function requireCanvas(t) {
  if (canvasModule) return canvasModule;
  if (canvasFailure) {
    t.skip(`@napi-rs/canvas 在本机不可用（${canvasFailure.message}），已跳过需要真实像素的用例；真机必须复验。`);
    return null;
  }
  try {
    const module = await import('@napi-rs/canvas');
    if (typeof module.createCanvas !== 'function' || typeof module.loadImage !== 'function') {
      throw new Error('缺少 createCanvas/loadImage 导出');
    }
    canvasModule = module;
    return module;
  } catch (error) {
    canvasFailure = error;
    t.skip(`@napi-rs/canvas 在本机不可用（${error?.message}），已跳过需要真实像素的用例；真机必须复验。`);
    return null;
  }
}

/** 用 canvas 读回一张图的真实像素尺寸。 */
export async function readPixelSize(canvas, path) {
  const image = await canvas.loadImage(path);
  return { width: image.width, height: image.height };
}

/**
 * 负向对照专用：断言某个调用「确实失败了」，并校验错误码。
 * expectedCode 可以是单个 code 或 code 数组（例如 schema 层与 handler 层
 * 都可能拒绝同一类非法入参，两层的 code 不同但都算拒绝）。
 * 成功的返回值会被打印出来，方便定位「静默成功」这类 bug。
 */
export async function expectFailure(promise, expectedCode, label = '调用') {
  let error = null;
  let value;
  try {
    value = await promise;
  } catch (caught) {
    error = caught;
  }
  assert.notEqual(
    error,
    null,
    `${label} 本应失败，却成功返回了：${JSON.stringify(value)?.slice(0, 300)}`,
  );
  assert.ok(error instanceof Error, `${label} 抛出的不是 Error：${String(error)}`);
  if (expectedCode !== undefined) {
    const allowed = Array.isArray(expectedCode) ? expectedCode : [expectedCode];
    assert.ok(
      allowed.includes(error.code),
      `${label} 的错误码应为 ${allowed.join(' 或 ')}，实际是 ${error.code}（${error.message}）`,
    );
  }
  return error;
}

/** 用 canvas 读回某点的 RGBA。 */
export async function readPixel(canvas, path, x, y) {
  const image = await canvas.loadImage(path);
  const surface = canvas.createCanvas(image.width, image.height);
  const context = surface.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(x, y, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

/** 用 canvas 统计「非白底像素」数量，用来证明 PNG 里真的画了东西而不是一张白纸。 */
export async function countInk(canvas, path) {
  const image = await canvas.loadImage(path);
  const surface = canvas.createCanvas(image.width, image.height);
  const context = surface.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  let ink = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset] < 240 || data[offset + 1] < 240 || data[offset + 2] < 240) ink += 1;
  }
  return { ink, total: image.width * image.height };
}

/**
 * 统计「明显比背景亮」的像素数。
 * 用来验证白色文字水印真的画上去了（背景是固定的中灰）。
 */
export async function countBrightPixels(canvas, path, minimum = 200) {
  const image = await canvas.loadImage(path);
  const surface = canvas.createCanvas(image.width, image.height);
  const context = surface.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  let bright = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset] >= minimum && data[offset + 1] >= minimum && data[offset + 2] >= minimum) bright += 1;
  }
  return { bright, total: image.width * image.height };
}

export function writeFileAt(root, relative, buffer) {
  const target = join(root, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, buffer);
  return target;
}

export function withIsolatedEnv(t) {
  const home = mkdtempSync(join(tmpdir(), 'mochi-visuals-home-'));
  const saved = {
    MOCHI_HOME: process.env.MOCHI_HOME,
    DSH_HOME: process.env.DSH_HOME,
    MOCHI_VISUALS_ROOTS: process.env.MOCHI_VISUALS_ROOTS,
    MOCHI_FILES_ROOTS: process.env.MOCHI_FILES_ROOTS,
    MOCHI_VISUALS_OUTDIR: process.env.MOCHI_VISUALS_OUTDIR,
  };
  process.env.DSH_HOME = home;
  delete process.env.MOCHI_HOME;
  delete process.env.MOCHI_VISUALS_ROOTS;
  delete process.env.MOCHI_FILES_ROOTS;
  delete process.env.MOCHI_VISUALS_OUTDIR;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}
