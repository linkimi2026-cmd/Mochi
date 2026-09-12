// mochi-visuals · 真实像素编辑引擎。
//
// 全部操作用 @napi-rs/canvas 真解码 → 真改像素 → 真编码，没有任何模拟分支。
// canvas 是延迟加载的：导入失败时给出明确的中文错误，而不是假装成功。
//
// 支持的操作（op）：
//   crop      裁剪；给 aspect 时按锚点裁到指定宽高比，给 x/y/width/height 时按盒裁剪
//   resize    缩放；contain 等比缩放到不超过目标框，cover 精确到目标尺寸并居中裁切，stretch 拉伸
//   rotate    旋转；90/180/270 用精确尺寸重绘，其他角度按包围盒重绘
//   rounded   圆角；超出范围的圆角会收敛到短边一半
//   watermark 文字水印；九宫格定位、透明度、字号、颜色、描边、可选倾斜
//   adjust    亮度/对比度/饱和度；逐像素计算（亮度乘性色阶、对比度围绕 128、饱和度按灰度插值）
import { MochiVisualsError, toolFailure } from './paths.mjs';

export const MAX_PIXELS_FOR_ADJUST = 40_000_000;
export const MAX_OUTPUT_PIXELS = 80_000_000;
export const ALLOWED_FORMATS = ['png', 'jpeg'];
export const WATERMARK_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];
export const OP_NAMES = ['crop', 'resize', 'rotate', 'rounded', 'watermark', 'adjust'];

let canvasPromise;

/** 延迟加载 canvas，并且不缓存失败结果（之后仍可重试）。 */
export async function loadCanvas() {
  if (!canvasPromise) {
    canvasPromise = (async () => {
      let module;
      try {
        module = await import('@napi-rs/canvas');
      } catch (error) {
        throw toolFailure(
          'CANVAS_UNAVAILABLE',
          `当前运行包没有可用的图像处理运行时（@napi-rs/canvas 加载失败：${error?.message ?? '未知原因'}）。`
          + '本机未做任何伪装处理：编辑与位图输出已被拒绝，请改用 SVG 输出或检查运行包是否包含原生模块。',
        );
      }
      if (typeof module.createCanvas !== 'function' || typeof module.loadImage !== 'function') {
        throw toolFailure('CANVAS_UNAVAILABLE', '图像处理运行时缺少 createCanvas / loadImage 导出，已拒绝执行。');
      }
      return module;
    })().catch((error) => {
      canvasPromise = undefined;
      throw error;
    });
  }
  return canvasPromise;
}

export async function canvasAvailable() {
  try {
    await loadCanvas();
    return true;
  } catch {
    return false;
  }
}

function toInteger(value, fallback, { minimum, maximum, label }) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw toolFailure('BAD_ARGUMENT', `${label}必须是数字，收到：${String(value)}`);
  const rounded = Math.round(number);
  if (rounded < minimum || rounded > maximum) {
    throw toolFailure('BAD_ARGUMENT', `${label}必须在 ${minimum}–${maximum} 之间，收到：${rounded}`);
  }
  return rounded;
}

function toNumber(value, fallback, { minimum, maximum, label }) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw toolFailure('BAD_ARGUMENT', `${label}必须是数字，收到：${String(value)}`);
  if (number < minimum || number > maximum) {
    throw toolFailure('BAD_ARGUMENT', `${label}必须在 ${minimum}–${maximum} 之间，收到：${number}`);
  }
  return number;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function newCanvas(canvasModule, width, height) {
  const canvas = canvasModule.createCanvas(width, height);
  return { canvas, context: canvas.getContext('2d') };
}

const ANCHOR_X = { left: 0, center: 0.5, right: 1, 左: 0, 中: 0.5, 右: 1 };
const ANCHOR_Y = { top: 0, center: 0.5, bottom: 1, 上: 0, 中: 0.5, 下: 1 };

function anchorOffset(anchor, index, available) {
  const key = String(anchor ?? 'center').toLowerCase().split('-');
  const axis = index === 0 ? ANCHOR_X : ANCHOR_Y;
  const fallback = key.length > 1 ? key[index] : 'center';
  const weight = axis[key[index]] ?? axis[fallback] ?? 0.5;
  return Math.round(available * weight);
}

function cropRect(current, op) {
  const { width, height } = current;
  if (op.aspect !== undefined && op.aspect !== null && op.aspect !== '') {
    const ratio = parseAspect(op.aspect);
    if (!ratio) throw toolFailure('BAD_ARGUMENT', `crop.aspect 无法解析：${String(op.aspect)}（应形如 "16:9" 或 "1.5"）。`);
    let cropWidth = width;
    let cropHeight = Math.round(width / ratio);
    if (cropHeight > height) {
      cropHeight = height;
      cropWidth = Math.round(height * ratio);
    }
    const anchor = op.anchor ?? 'center';
    const x = op.x === undefined ? anchorOffset(anchor, 0, width - cropWidth) : Math.round(Number(op.x));
    const y = op.y === undefined ? anchorOffset(anchor, 1, height - cropHeight) : Math.round(Number(op.y));
    return {
      x: clamp(x, 0, width - cropWidth),
      y: clamp(y, 0, height - cropHeight),
      width: cropWidth,
      height: cropHeight,
      aspect: `${round(ratio, 3)}:1`,
    };
  }
  const cropWidth = toInteger(op.width, null, { minimum: 1, maximum: 100_000, label: 'crop.width' });
  const cropHeight = toInteger(op.height, null, { minimum: 1, maximum: 100_000, label: 'crop.height' });
  if (cropWidth === null || cropHeight === null) {
    throw toolFailure('BAD_ARGUMENT', 'crop 需要 aspect（按比例居中裁切）或同时给出 width 与 height。');
  }
  const x = toInteger(op.x, 0, { minimum: 0, maximum: 100_000, label: 'crop.x' });
  const y = toInteger(op.y, 0, { minimum: 0, maximum: 100_000, label: 'crop.y' });
  if (x + cropWidth > width || y + cropHeight > height) {
    throw toolFailure(
      'BAD_ARGUMENT',
      `crop 区域超出画面：当前 ${width}×${height}，请求 x=${x} y=${y} width=${cropWidth} height=${cropHeight}。`,
    );
  }
  return { x, y, width: cropWidth, height: cropHeight };
}

function parseAspect(input) {
  const text = String(input).trim();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/i);
  if (match) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    return w > 0 && h > 0 ? w / h : null;
  }
  const single = Number(text);
  return Number.isFinite(single) && single > 0 ? single : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function requireCanvasSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw toolFailure('BAD_ARGUMENT', `目标尺寸无效：${width}×${height}`);
  }
  const rounded = { width: Math.round(width), height: Math.round(height) };
  if (rounded.width * rounded.height > MAX_OUTPUT_PIXELS) {
    throw toolFailure('TOO_LARGE', `目标尺寸 ${rounded.width}×${rounded.height} 超过本机上限 ${MAX_OUTPUT_PIXELS} 像素。`);
  }
  return rounded;
}

/** 亮度/对比度/饱和度的逐像素计算。alpha 保持不变。 */
export function adjustPixels(data, { brightness = 0, contrast = 0, saturation = 0 }) {
  const brightnessFactor = 1 + brightness / 100;      // -100 → 0（全黑），+100 → 2
  const contrastFactor = (100 + contrast) / 100;      // -100 → 0（全灰 128），+100 → 2
  const saturationFactor = 1 + saturation / 100;      // -100 → 0（灰度），+100 → 2
  for (let index = 0; index < data.length; index += 4) {
    let red = data[index] * brightnessFactor;
    let green = data[index + 1] * brightnessFactor;
    let blue = data[index + 2] * brightnessFactor;
    red = (red - 128) * contrastFactor + 128;
    green = (green - 128) * contrastFactor + 128;
    blue = (blue - 128) * contrastFactor + 128;
    if (saturationFactor !== 1) {
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
      red = luma + (red - luma) * saturationFactor;
      green = luma + (green - luma) * saturationFactor;
      blue = luma + (blue - luma) * saturationFactor;
    }
    data[index] = clamp(Math.round(red), 0, 255);
    data[index + 1] = clamp(Math.round(green), 0, 255);
    data[index + 2] = clamp(Math.round(blue), 0, 255);
  }
  return data;
}

function applyAdjust(context, width, height, op) {
  const result = {
    brightness: toInteger(op.brightness, 0, { minimum: -100, maximum: 100, label: 'adjust.brightness' }),
    contrast: toInteger(op.contrast, 0, { minimum: -100, maximum: 100, label: 'adjust.contrast' }),
    saturation: toInteger(op.saturation, 0, { minimum: -100, maximum: 100, label: 'adjust.saturation' }),
  };
  if (result.brightness === 0 && result.contrast === 0 && result.saturation === 0) {
    return { ...result, 说明: '三项都是 0，画面未改变' };
  }
  if (width * height > MAX_PIXELS_FOR_ADJUST) {
    throw toolFailure(
      'TOO_LARGE',
      `adjust 是逐像素计算，当前画面 ${width}×${height} 超过上限 ${MAX_PIXELS_FOR_ADJUST} 像素；请先 resize 再调色。`,
    );
  }
  const image = context.getImageData(0, 0, width, height);
  adjustPixels(image.data, result);
  context.putImageData(image, 0, 0);
  return result;
}

function watermarkLayout(context, width, height, op, defaultFontFamily) {
  const shortEdge = Math.min(width, height);
  const fontSize = toInteger(op.fontSize, Math.max(12, Math.round(shortEdge * 0.045)), {
    minimum: 6, maximum: 4000, label: 'watermark.fontSize',
  });
  const text = String(op.text ?? '').trim();
  if (!text) throw toolFailure('BAD_ARGUMENT', 'watermark 需要 text（水印文字）。');
  const position = String(op.position ?? 'bottom-right').toLowerCase();
  if (!WATERMARK_POSITIONS.includes(position)) {
    throw toolFailure('BAD_ARGUMENT', `watermark.position 只支持 ${WATERMARK_POSITIONS.join(' / ')}，收到：${position}`);
  }
  const opacity = toNumber(op.opacity, 0.6, { minimum: 0.02, maximum: 1, label: 'watermark.opacity' });
  const rotation = toNumber(op.rotateDegrees, 0, { minimum: -90, maximum: 90, label: 'watermark.rotateDegrees' });
  const margin = toInteger(op.margin, Math.round(fontSize * 0.6), { minimum: 0, maximum: 2000, label: 'watermark.margin' });
  const weight = op.bold === false ? 'normal' : 'bold';
  const fontFamily = typeof op.fontFamily === 'string' && op.fontFamily.trim()
    ? op.fontFamily.trim()
    : (defaultFontFamily || 'sans-serif');
  context.save();
  context.font = `${weight} ${fontSize}px ${fontFamily}`;
  const metrics = context.measureText(text);
  context.restore();
  const textWidth = metrics.width;
  const textHeight = fontSize;
  const horizontal = position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center';
  const vertical = position.startsWith('top') ? 'top' : position.startsWith('bottom') ? 'bottom' : 'middle';
  const baseX = horizontal === 'left' ? margin
    : horizontal === 'right' ? width - margin - textWidth
      : (width - textWidth) / 2;
  const topY = vertical === 'top' ? margin
    : vertical === 'bottom' ? height - margin - textHeight
      : (height - textHeight) / 2;
  // 以文字中心为旋转支点。
  const centerX = baseX + textWidth / 2;
  const centerY = topY + textHeight / 2;
  return { text, fontSize, fontFamily, weight, opacity, rotation, centerX, centerY, textWidth, color: op.color ?? '#ffffff', stroke: op.strokeColor ?? 'rgba(0,0,0,0.45)', strokeWidth: weight === 'bold' ? Math.max(1, fontSize * 0.06) : Math.max(1, fontSize * 0.05) };
}

function drawWatermark(context, width, height, op, defaultFontFamily) {
  const layout = watermarkLayout(context, width, height, op, defaultFontFamily);
  context.save();
  context.translate(layout.centerX, layout.centerY);
  if (layout.rotation) context.rotate((layout.rotation * Math.PI) / 180);
  context.globalAlpha = layout.opacity;
  context.font = `${layout.weight} ${layout.fontSize}px ${layout.fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  // 先描边后填充，保证浅色背景上也读得出来。
  context.lineJoin = 'round';
  context.lineWidth = layout.strokeWidth;
  context.strokeStyle = layout.stroke;
  context.strokeText(layout.text, 0, 0);
  context.fillStyle = layout.color;
  context.fillText(layout.text, 0, 0);
  context.restore();
  return {
    文字: layout.text,
    位置: String(op.position ?? 'bottom-right').toLowerCase(),
    字号: layout.fontSize,
    透明度: layout.opacity,
    倾斜角度: layout.rotation,
  };
}

function normalizeRotation(op) {
  const degrees = toNumber(op.degrees, null, { minimum: -360, maximum: 360, label: 'rotate.degrees' });
  if (degrees === null) throw toolFailure('BAD_ARGUMENT', 'rotate 需要 degrees（旋转角度，逆时针为正）。');
  return degrees;
}

function applyRotate(canvasModule, surface, op) {
  const degrees = normalizeRotation(op);
  const normalized = ((degrees % 360) + 360) % 360;
  const { canvas, context } = surface;
  if (normalized === 0) return { surface, 变换: '旋转 0°（未改变）' };
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    const swap = normalized === 90 || normalized === 270;
    const target = requireCanvasSize(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height);
    const next = newCanvas(canvasModule, target.width, target.height);
    next.context.save();
    next.context.translate(target.width / 2, target.height / 2);
    next.context.rotate((normalized * Math.PI) / 180);
    next.context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    next.context.restore();
    return { surface: next, 变换: `旋转 ${normalized}°（精确重绘，无插值）` };
  }
  const radians = (normalized * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const target = requireCanvasSize(
    canvas.width * cos + canvas.height * sin,
    canvas.width * sin + canvas.height * cos,
  );
  const next = newCanvas(canvasModule, target.width, target.height);
  if (typeof op.background === 'string' && op.background) {
    next.context.fillStyle = op.background;
    next.context.fillRect(0, 0, target.width, target.height);
  }
  next.context.save();
  next.context.translate(target.width / 2, target.height / 2);
  next.context.rotate((normalized * Math.PI) / 180);
  next.context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  next.context.restore();
  return { surface: next, 变换: `旋转 ${normalized}°（包围盒扩大为 ${target.width}×${target.height}）` };
}

function applyCrop(canvasModule, surface, op) {
  const { canvas } = surface;
  const rect = cropRect({ width: canvas.width, height: canvas.height }, op);
  const next = newCanvas(canvasModule, rect.width, rect.height);
  next.context.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return {
    surface: next,
    变换: `裁剪 ${rect.width}×${rect.height}（起点 x=${rect.x} y=${rect.y}${rect.aspect ? `，比例 ${rect.aspect}` : ''}）`,
  };
}

function applyResize(canvasModule, surface, op) {
  const { canvas } = surface;
  const fit = ['contain', 'cover', 'stretch'].includes(String(op.fit ?? 'contain')) ? String(op.fit ?? 'contain') : 'contain';
  const maxLongEdge = op.maxLongEdge === undefined || op.maxLongEdge === null || op.maxLongEdge === ''
    ? null
    : toInteger(op.maxLongEdge, null, { minimum: 8, maximum: 100_000, label: 'resize.maxLongEdge' });
  const targetWidth = op.width === undefined || op.width === null || op.width === ''
    ? null
    : toInteger(op.width, null, { minimum: 1, maximum: 100_000, label: 'resize.width' });
  const targetHeight = op.height === undefined || op.height === null || op.height === ''
    ? null
    : toInteger(op.height, null, { minimum: 1, maximum: 100_000, label: 'resize.height' });

  if (maxLongEdge !== null) {
    const longEdge = Math.max(canvas.width, canvas.height);
    const scale = maxLongEdge / longEdge;
    const size = requireCanvasSize(canvas.width * scale, canvas.height * scale);
    const next = newCanvas(canvasModule, size.width, size.height);
    next.context.drawImage(canvas, 0, 0, size.width, size.height);
    return { surface: next, 变换: `等比缩放到长边 ${maxLongEdge}（${size.width}×${size.height}）` };
  }
  if (targetWidth === null && targetHeight === null) {
    throw toolFailure('BAD_ARGUMENT', 'resize 需要 width / height（至少一个）或 maxLongEdge。');
  }
  if (fit === 'stretch' && targetWidth !== null && targetHeight !== null) {
    const size = requireCanvasSize(targetWidth, targetHeight);
    const next = newCanvas(canvasModule, size.width, size.height);
    next.context.drawImage(canvas, 0, 0, size.width, size.height);
    return { surface: next, 变换: `拉伸到 ${size.width}×${size.height}（忽略原始比例）` };
  }
  if (fit === 'cover' && targetWidth !== null && targetHeight !== null) {
    // cover：先按覆盖比例放大，再居中裁切。
    const size = requireCanvasSize(targetWidth, targetHeight);
    const next = newCanvas(canvasModule, size.width, size.height);
    const scale = Math.max(size.width / canvas.width, size.height / canvas.height);
    const scaledWidth = canvas.width * scale;
    const scaledHeight = canvas.height * scale;
    next.context.drawImage(canvas, (size.width - scaledWidth) / 2, (size.height - scaledHeight) / 2, scaledWidth, scaledHeight);
    return { surface: next, 变换: `等比缩放（cover）并居中裁切到 ${size.width}×${size.height}` };
  }
  // contain（默认）：等比缩放到不超过目标框；只给一个边时按该边等比缩放。
  const scale = targetWidth !== null && targetHeight !== null
    ? Math.min(targetWidth / canvas.width, targetHeight / canvas.height)
    : targetWidth !== null ? targetWidth / canvas.width : targetHeight / canvas.height;
  const size = requireCanvasSize(canvas.width * scale, canvas.height * scale);
  const next = newCanvas(canvasModule, size.width, size.height);
  next.context.drawImage(canvas, 0, 0, size.width, size.height);
  const note = fit === 'cover' ? '（cover 需要同时给 width 和 height，已按等比缩放处理）' : '';
  return { surface: next, 变换: `等比缩放（contain）到 ${size.width}×${size.height}${note}` };
}

function applyRounded(canvasModule, surface, op) {
  const { canvas } = surface;
  const limit = Math.floor(Math.min(canvas.width, canvas.height) / 2);
  const requested = toInteger(op.radius, null, { minimum: 0, maximum: 100_000, label: 'rounded.radius' });
  if (requested === null) throw toolFailure('BAD_ARGUMENT', 'rounded 需要 radius（像素半径）。');
  const radius = clamp(requested, 0, limit);
  if (radius === 0) return { surface, 变换: '圆角 0（未改变）' };
  const next = newCanvas(canvasModule, canvas.width, canvas.height);
  next.context.save();
  next.context.beginPath();
  next.context.roundRect(0, 0, canvas.width, canvas.height, radius);
  next.context.clip();
  next.context.drawImage(canvas, 0, 0);
  next.context.restore();
  return { surface: next, 变换: `圆角半径 ${radius}${radius < requested ? `（收敛到短边一半，请求 ${requested}）` : ''}` };
}

function normalizeOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw toolFailure('BAD_ARGUMENT', 'operations 必须是非空数组；每项形如 {op:"crop", aspect:"16:9"}。');
  }
  if (operations.length > 20) {
    throw toolFailure('BAD_ARGUMENT', `operations 最多 20 步，收到 ${operations.length} 步。`);
  }
  return operations.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw toolFailure('BAD_ARGUMENT', `operations[${index}] 必须是对象，形如 {op:"rotate", degrees:90}。`);
    }
    const op = String(entry.op ?? '').trim();
    if (!OP_NAMES.includes(op)) {
      throw toolFailure('BAD_ARGUMENT', `operations[${index}].op 不支持“${op}”，只支持 ${OP_NAMES.join(' / ')}。`);
    }
    return { ...entry, op };
  });
}

export function resolveOutputFormat({ requested, sourceFormat }) {
  if (requested === undefined || requested === null || requested === '') {
    if (sourceFormat === 'jpeg') return 'jpeg';
    // gif / webp / bmp / svg 的默认输出是 png（本机不做这些格式的编码）。
    return 'png';
  }
  const normalized = String(requested).toLowerCase().replace('jpg', 'jpeg');
  if (!ALLOWED_FORMATS.includes(normalized)) {
    throw toolFailure('BAD_ARGUMENT', `format 只支持 ${ALLOWED_FORMATS.join(' / ')}，收到：${String(requested)}`);
  }
  return normalized;
}

function extensionFor(format) {
  return format === 'jpeg' ? '.jpg' : '.png';
}

export { extensionFor, normalizeOperations };

/**
 * 按顺序执行操作，返回编码后的 Buffer 与真实尺寸。
 * 不写盘、不碰路径；写盘由 tools.mjs 在路径守卫之后完成。
 */
export async function editImageBuffer({ buffer, sourceFormat, operations, format, quality, fontFamily }) {
  const options = normalizeOperations(operations);
  const outputFormat = resolveOutputFormat({ requested: format, sourceFormat });
  const jpegQuality = toInteger(quality, 90, { minimum: 1, maximum: 100, label: 'quality' });
  const watermarkFont = typeof fontFamily === 'string' && fontFamily.trim() ? fontFamily : 'sans-serif';
  const canvasModule = await loadCanvas();

  const source = await canvasModule.loadImage(buffer);
  if (!Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width < 1 || source.height < 1) {
    throw toolFailure('IMAGE_UNREADABLE', '图片解码后没有得到有效尺寸，已拒绝编辑。');
  }
  let surface = newCanvas(canvasModule, source.width, source.height);
  surface.context.drawImage(source, 0, 0);

  const applied = [];
  for (const op of options) {
    const before = { width: surface.canvas.width, height: surface.canvas.height };
    let detail;
    switch (op.op) {
      case 'crop': ({ surface, 变换: detail } = applyCrop(canvasModule, surface, op)); break;
      case 'resize': ({ surface, 变换: detail } = applyResize(canvasModule, surface, op)); break;
      case 'rotate': ({ surface, 变换: detail } = applyRotate(canvasModule, surface, op)); break;
      case 'rounded': ({ surface, 变换: detail } = applyRounded(canvasModule, surface, op)); break;
      case 'watermark': detail = drawWatermark(surface.context, before.width, before.height, op, watermarkFont); break;
      case 'adjust': detail = applyAdjust(surface.context, before.width, before.height, op); break;
      default: throw toolFailure('BAD_ARGUMENT', `未实现的操作：${op.op}`);
    }
    applied.push({
      操作: op.op,
      输入尺寸: `${before.width}×${before.height}`,
      输出尺寸: `${surface.canvas.width}×${surface.canvas.height}`,
      详情: detail,
    });
  }

  let encoded;
  const finalWidth = Math.round(surface.canvas.width);
  const finalHeight = Math.round(surface.canvas.height);
  try {
    encoded = outputFormat === 'jpeg'
      ? surface.canvas.toBuffer('image/jpeg', jpegQuality)
      : surface.canvas.toBuffer('image/png');
  } catch (error) {
    throw toolFailure('ENCODE_FAILED', `编码为 ${outputFormat.toUpperCase()} 失败：${error?.message ?? '未知原因'}。`);
  }
  if (!Buffer.isBuffer(encoded) || encoded.length === 0) {
    throw toolFailure('ENCODE_FAILED', `编码为 ${outputFormat.toUpperCase()} 没有得到有效字节，已拒绝写出空文件。`);
  }
  surface.canvas.dispose?.();

  return {
    buffer: encoded,
    format: outputFormat,
    extension: extensionFor(outputFormat),
    width: finalWidth,
    height: finalHeight,
    sourceWidth: Math.round(source.width),
    sourceHeight: Math.round(source.height),
    applied,
    quality: outputFormat === 'jpeg' ? jpegQuality : null,
  };
}

export { MochiVisualsError };
