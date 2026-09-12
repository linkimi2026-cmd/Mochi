// mochi-visuals · SVG → PNG 光栅化。
//
// 用 @napi-rs/canvas 的 loadImage 直接吃 SVG buffer（该运行时内置 SVG 光栅化）。
// PNG 与 SVG 共用 diagram.mjs 生成的同一份几何数据，只有 svg 标签的
// width/height 被放大、viewBox 不变，所以位图不会比矢量图“另画一套”。
//
// canvas 不可用时如实报错，绝不返回一张假的 PNG。
import { toolFailure } from './paths.mjs';
import { loadCanvas } from './image-ops.mjs';

export const DEFAULT_PNG_SCALE = 2;
export const MAX_PNG_SCALE = 4;
export const MAX_PNG_PIXELS = 24_000_000;

/**
 * @param {string} svg 由 renderDiagramSvg 生成、width/height 已按 scale 放大的 SVG
 * @param {{ width:number, height:number, scale:number }} options 目标像素尺寸
 * @returns {Promise<Buffer>} 真实 PNG 字节
 */
export async function rasterizeSvgToPng(svg, { width, height }) {
  if (typeof svg !== 'string' || !svg.includes('<svg')) {
    throw toolFailure('BAD_ARGUMENT', 'rasterizeSvgToPng 需要一个 SVG 字符串。');
  }
  const targetWidth = Math.round(width);
  const targetHeight = Math.round(height);
  if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth < 1 || targetHeight < 1) {
    throw toolFailure('BAD_ARGUMENT', `PNG 目标尺寸无效：${width}×${height}`);
  }
  if (targetWidth * targetHeight > MAX_PNG_PIXELS) {
    throw toolFailure('TOO_LARGE', `PNG 目标尺寸 ${targetWidth}×${targetHeight} 超过本机上限 ${MAX_PNG_PIXELS} 像素；请降低 pngScale。`);
  }
  const canvasModule = await loadCanvas();
  let image;
  try {
    image = await canvasModule.loadImage(Buffer.from(svg, 'utf8'));
  } catch (error) {
    throw toolFailure('RASTERIZE_FAILED', `SVG 光栅化失败（${error?.message ?? '未知原因'}）；SVG 本身仍可正常使用。`);
  }
  const canvas = canvasModule.createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext('2d');
  // 白底：Word/PPT 里透明背景常常显示成黑色或难读。
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const buffer = canvas.toBuffer('image/png');
  canvas.dispose?.();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw toolFailure('RASTERIZE_FAILED', 'SVG 光栅化没有得到有效 PNG 字节，已拒绝写出空文件。');
  }
  return buffer;
}

export function normalizePngScale(input) {
  if (input === undefined || input === null || input === '') return DEFAULT_PNG_SCALE;
  const value = Number(input);
  if (!Number.isFinite(value)) throw toolFailure('BAD_ARGUMENT', `pngScale 必须是数字，收到：${String(input)}`);
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > MAX_PNG_SCALE) {
    throw toolFailure('BAD_ARGUMENT', `pngScale 必须在 1–${MAX_PNG_SCALE} 之间（越大越清晰、文件越大），收到：${rounded}`);
  }
  return rounded;
}
