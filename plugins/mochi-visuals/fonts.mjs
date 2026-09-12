// mochi-visuals · 中文字体挑选（带「字形真存在」检测）。
//
// 为什么需要它（全部为本机实测结论，不是推测）：
//   1. SVG 光栅化走的是 resvg，它**不认逗号分隔的字族链**，也不认带引号的字族名。
//      实测：font-family="Hiragino Sans GB" / "PingFang SC" / 任意不存在的名字，
//      渲染结果与「私用区码位的豆腐块」逐像素完全一致 —— 也就是整段中文变成方框。
//      唯一有效写法是「不带引号、不含逗号的单一字族名」，且该字体必须用
//      GlobalFonts.registerFromPath(path, 别名) 显式注册进 resvg 的字体库。
//   2. canvas 的 fillText 走的是 Skia 字体系统，对字族名的解析规则与 resvg 不同，
//      泛型 sans-serif 在本机对简体汉字同样是豆腐块。
// 所以这里对两个引擎分别做逐字检测，挑出两个引擎都画得出简体汉字的字体。
//
// 检测方法（自校准，不猜）：先渲染私用区码位 U+E123（任何字体都不会有字形），
// 得到该引擎+该字体的「豆腐」指纹；再用同一字体渲染探测字，指纹相同即判定缺字。
import { existsSync } from 'node:fs';
import { loadCanvas } from './image-ops.mjs';

/** 为本进程注册私有用字族名（不带引号、不含逗号，专供 resvg 使用）。 */
export const CJK_FONT_ALIAS = 'MochiCJK';

/** 写入 SVG 文件时用的可移植字族链（交给 PPT/Word/浏览器按系统字体渲染）。 */
export const PORTABLE_CJK_STACK = 'Hiragino Sans GB, PingFang SC, Heiti SC, Microsoft YaHei, Noto Sans CJK SC, Source Han Sans SC, sans-serif';

// 各平台候选简体中文字体文件，按“教学图表更耐看”的顺序：无衬线优先。
const PLATFORM_FONT_CANDIDATES = {
  darwin: [
    { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'Hiragino Sans GB' },
    { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFang SC' },
    { path: '/System/Library/Fonts/STHeiti Medium.ttc', family: 'Heiti SC' },
    { path: '/System/Library/Fonts/Supplemental/Songti.ttc', family: 'Songti SC' },
  ],
  win32: [
    { path: 'C:\\Windows\\Fonts\\msyh.ttc', family: 'Microsoft YaHei' },
    { path: 'C:\\Windows\\Fonts\\simhei.ttf', family: 'SimHei' },
    { path: 'C:\\Windows\\Fonts\\simsun.ttc', family: 'SimSun' },
  ],
  linux: [
    { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK SC' },
    { path: '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf', family: 'Noto Sans CJK SC' },
    { path: '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', family: 'WenQuanYi Micro Hei' },
  ],
};

// 判定“这家字体到底认不认简体”：全部是简体专有字形（繁体字体没有对应码位）。
const PROBE_CHARACTERS = ['组', '测', '温', '实', '验', '课'];
const MISSING_GLYPH_CODE_POINT = '\uE123'; // 私用区，任何字体都不会有字形
const PROBE_SIZE = 48;

let resolvedPromise;

function unquotedAlias() {
  return CJK_FONT_ALIAS;
}

// ── 引擎 A：canvas fillText（Skia），水印文字走这条路 ───────────────────────

function canvasSignature(canvasModule, family, character) {
  const canvas = canvasModule.createCanvas(PROBE_SIZE, PROBE_SIZE);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PROBE_SIZE, PROBE_SIZE);
  context.font = `${Math.round(PROBE_SIZE * 0.78)}px ${family}`;
  context.fillStyle = '#000000';
  context.fillText(character, 2, Math.round(PROBE_SIZE * 0.8));
  const data = context.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data;
  canvas.dispose?.();
  let dark = 0;
  for (let index = 0; index < data.length; index += 4) if (data[index] < 128 && data[index + 3] > 128) dark += 1;
  return dark;
}

function canvasCovers(canvasModule, family) {
  const missing = canvasSignature(canvasModule, family, MISSING_GLYPH_CODE_POINT);
  return PROBE_CHARACTERS.every((character) => {
    const dark = canvasSignature(canvasModule, family, character);
    return dark > 0 && dark !== missing;
  });
}

// ── 引擎 B：SVG 光栅化（resvg），图表 PNG 走这条路 ──────────────────────────

function probeSvg(family, text) {
  // 刻意不带引号、不带逗号：resvg 只认这种写法。
  return '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="80" viewBox="0 0 420 80">'
    + '<rect width="420" height="80" fill="#ffffff"/>'
    + `<text x="4" y="60" font-family="${family}" font-size="44" fill="#000000">${text}</text>`
    + '</svg>';
}

async function rasterSignature(canvasModule, family, character) {
  const image = await canvasModule.loadImage(Buffer.from(probeSvg(family, character), 'utf8'));
  const canvas = canvasModule.createCanvas(420, 80);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, 420, 80).data;
  canvas.dispose?.();
  let dark = 0;
  for (let index = 0; index < data.length; index += 4) if (data[index] < 128 && data[index + 3] > 128) dark += 1;
  return dark;
}

async function rasterCovers(canvasModule, family) {
  const missing = await rasterSignature(canvasModule, family, MISSING_GLYPH_CODE_POINT);
  for (const character of PROBE_CHARACTERS) {
    const dark = await rasterSignature(canvasModule, family, character);
    if (dark === 0 || dark === missing) return false;
  }
  return true;
}

/**
 * 解析本机可用的中文字体。返回两个引擎各自可用的写法与检测证据：
 *   rasterFamily —— resvg 光栅化用的单一字族名（不带引号）；null 表示没找到
 *   watermarkFont —— canvas fillText 用的字族写法；null 表示没找到
 *   stack —— 写入 SVG 文件的可移植字族链
 * 找不到时 ok=false 并给出 notes，绝不假装没问题。
 */
export async function resolveDiagramFont() {
  if (!resolvedPromise) {
    resolvedPromise = (async () => {
      let canvasModule;
      try {
        canvasModule = await loadCanvas();
      } catch (error) {
        return {
          ok: false,
          source: null,
          rasterFamily: null,
          watermarkFont: null,
          stack: PORTABLE_CJK_STACK,
          tested: [],
          notes: [
            `无法加载图像运行时，跳过了中文字体检测（${error?.message ?? '未知原因'}）；`
            + '中文可能显示为方框，请在能加载 @napi-rs/canvas 的机器上复验。',
          ],
        };
      }

      const candidates = (PLATFORM_FONT_CANDIDATES[process.platform] ?? []).filter((entry) => existsSync(entry.path));
      const tested = [];
      for (const candidate of candidates) {
        let registered = false;
        try {
          // 注册到私有用字族名：resvg 认这个名字，且能吃到 resvg 的字体库里。
          registered = Boolean(canvasModule.GlobalFonts?.registerFromPath?.(candidate.path, unquotedAlias()));
        } catch {
          registered = false;
        }
        const entry = { path: candidate.path, family: candidate.family, registered, raster: null, canvas: null };
        if (registered) {
          entry.raster = await rasterCovers(canvasModule, unquotedAlias());
          entry.canvas = canvasCovers(canvasModule, unquotedAlias());
        }
        tested.push(entry);
        if (entry.raster && entry.canvas) {
          return {
            ok: true,
            source: candidate.path,
            rasterFamily: unquotedAlias(),
            watermarkFont: unquotedAlias(),
            stack: `${candidate.family}, ${PORTABLE_CJK_STACK}`,
            tested,
            notes: [
              `中文字体经逐字检测选用 ${candidate.family}（私有用字族名 ${unquotedAlias()}，`
              + `对 SVG 光栅化与 canvas 两个引擎各比对 ${PROBE_CHARACTERS.length} 个简体字 + 1 个缺字基准）。`,
            ],
          };
        }
      }

      // 退一步：至少让 canvas 能写字（水印可用），并明确说明 PNG 光栅化中文不可靠。
      const canvasOnly = tested.find((entry) => entry.canvas);
      return {
        ok: false,
        source: canvasOnly?.path ?? null,
        rasterFamily: null,
        watermarkFont: canvasOnly ? unquotedAlias() : null,
        stack: canvasOnly ? `${canvasOnly.family}, ${PORTABLE_CJK_STACK}` : PORTABLE_CJK_STACK,
        tested,
        notes: [
          `本机没有找到同时通过两个引擎简体汉字检测的字体（探测字：${PROBE_CHARACTERS.join('')}）。`
          + (canvasOnly
            ? 'SVG 光栅化引擎（resvg）画不出简体中文，因此图表 PNG 会被拒绝生成，避免产出整片方框；SVG 仍可正常输出。'
            : 'SVG 光栅化与 canvas 都无法渲染简体中文，图表 PNG 与水印中文都会被拒绝。')
          + '请在报告里如实说明，并在装有简中字体的机器上复验。',
        ],
      };
    })().catch((error) => {
      resolvedPromise = undefined;
      throw error;
    });
  }
  return resolvedPromise;
}

export function resetDiagramFontCache() {
  resolvedPromise = undefined;
}

/** 文本里是否含中日韩字符（用于判断「字体不可用」时是否必须拒绝）。 */
export function containsCjk(text) {
  return /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f\u3040-\u30ff]/u.test(String(text ?? ''));
}

export { PROBE_CHARACTERS, MISSING_GLYPH_CODE_POINT };
