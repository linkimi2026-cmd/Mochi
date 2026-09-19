import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import {
  delimiter as PATH_DELIMITER,
  basename,
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import JSZip from 'jszip';
import pptxgen from 'pptxgenjs';
import { drawProcessPptx, processScene, validateProcess } from './process-layout.mjs';
import {
  color as pdfColor,
  createPdfLayoutDocument,
  drawTable,
  drawTextBlock,
  drawTextLine,
  inspectPdfArtifact,
  layoutTable,
  measureText,
  savePdfLayoutDocument,
  wrapText,
} from '@mochi/pdf-layout';

// Retained for callers that imported the prior host setting. Ordinary PDF generation no longer reads it.
export const DEFAULT_SOFFICE_PATH = '/opt/homebrew/bin/soffice';
const PPTX_NAME = 'presentation.pptx';
const PDF_NAME = 'presentation.pdf';
const MAX_SLIDES = 40;
const PROJECTION_FONT = 'Noto Sans SC';
const PDF_SLIDE_WIDTH = 960;
const PDF_SLIDE_HEIGHT = 540;
const TABLE_AREA_WIDTH = 11.4;
const CONTENT_BOTTOM = 6.9;
const SLIDE_WIDTH = 13.333;
const STAGE_LEFT = 0.75;
const FOOTER_Y = 6.98;
const FOOTER_HEIGHT = 0.22;

// ═══════════════════════════════════════════════════════════════════════════
// 主题（2026-09-12）
//
// 在此之前，四套配色（底 F7F3E8 / 主 377D6A / 标题 244D3D / 正文 26352E）
// 硬编码在渲染器里，于是每一份课件的长相都完全一样——这正是"丑"和"廉价"
// 的头号来源，也是设计规范再怎么强调都改不动的地方：规范归规范，渲染器说了算。
//
// 现在配色由内容决定：theme 可以给预设名，也可以逐槽位给 hex 覆盖。
// 预设只是被验证过的起点组合，不是必须值。
// ═══════════════════════════════════════════════════════════════════════════
const HEX_COLOR = /^[0-9A-Fa-f]{6}$/u;
const THEME_SLOTS = ['background', 'surface', 'primary', 'accent', 'text', 'muted', 'rule', 'deep', 'onDeep'];

const THEME_PRESETS = Object.freeze({
  // 中性：题材没给出信号时的兜底。刻意避开 AI 紫、万能 Office 蓝、暖米+陶土橘。
  neutral: { background: 'FFFFFF', surface: 'F5F6F7', primary: '16181D', accent: 'B45309', text: '1F2328', muted: '6B7280', rule: 'E4E6EA', deep: '16181D', onDeep: 'F5F6F7' },
  // 书卷：语文 / 文史 / 古诗文
  ink: { background: 'F7F3E8', surface: 'FFFDF7', primary: '26352E', accent: 'A8351A', text: '2A3A32', muted: '6C7C72', rule: 'D6CDB8', deep: '26352E', onDeep: 'F7F3E8' },
  // 自然：生物 / 地理 / 写景散文（《春》一类）
  field: { background: 'F1F5EA', surface: 'FFFFFF', primary: '2F5D3A', accent: 'C08A1E', text: '23301F', muted: '67785F', rule: 'C9D8BE', deep: '2F5D3A', onDeep: 'F1F5EA' },
  // 理化：理科 / 实验 / 精确
  lab: { background: 'F5F7FA', surface: 'FFFFFF', primary: '1B3A5C', accent: 'C2410C', text: '1F2937', muted: '6B7280', rule: 'D6DEE8', deep: '1B3A5C', onDeep: 'F5F7FA' },
  // 档案：历史 / 社会 / 人物
  archive: { background: 'F3EEE2', surface: 'FBF6EA', primary: '5B3A1E', accent: '8C2F1B', text: '3A2A18', muted: '7A6A53', rule: 'D8C9AD', deep: '4A2E17', onDeep: 'F3EEE2' },
  // 现代：信息 / 数据 / 技术
  swiss: { background: 'FFFFFF', surface: 'F4F5F7', primary: '111111', accent: '0057B8', text: '1A1A1A', muted: '6E6E73', rule: 'E2E2E5', deep: '111111', onDeep: 'FFFFFF' },
  // 深色高级：答辩 / 发布会 / 路演
  midnight: { background: '101418', surface: '1A2029', primary: 'F2F5F8', accent: 'D8A02B', text: 'E6EAEF', muted: '98A2AE', rule: '2A323D', deep: '0B0E12', onDeep: 'F2F5F8' },
  // 舞台：艺术 / 音乐 / 戏剧
  stage: { background: '1C1120', surface: '2A1A30', primary: 'FDF6FF', accent: 'E4572E', text: 'EDE3F2', muted: 'A18FAE', rule: '3A2744', deep: '150C18', onDeep: 'FDF6FF' },
  // 活动：班会 / 节日 / 校园活动
  festive: { background: 'FFF7F0', surface: 'FFFFFF', primary: 'B33A20', accent: '0F766E', text: '33211A', muted: '8A6A5C', rule: 'F0D9C9', deep: 'B33A20', onDeep: 'FFF7F0' },
});
export const THEME_NAMES = Object.freeze(Object.keys(THEME_PRESETS));
const DEFAULT_THEME_NAME = 'neutral';

function blendHex(left, right, ratio = 0.5) {
  const channel = (hex, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return [0, 1, 2]
    .map((index) => Math.round(channel(left, index) + (channel(right, index) - channel(left, index)) * ratio).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function normalizeThemeColor(value, label) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) throw failure('INVALID_INPUT', `${label} must be a 6-digit hex color without '#'`);
  return value.trim().toUpperCase();
}

function chartColorsFor(theme) {
  return [theme.accent, theme.primary, blendHex(theme.accent, theme.primary, 0.45), blendHex(theme.accent, theme.text, 0.68)];
}

// ── 对比度下限（2026-09-12）─────────────────────────────────────────────────
//
// 起因是渲染校验里肉眼看到的：深底页（cover / closing）的副题用 accent 画在 deep 上，
// 例如 field 的 C08A1E 金色压 2F5D3A 深绿，对比度只有约 2.8:1。15pt 正文的 WCAG AA
// 下限是 4.5:1，老师投影到教室后排就是"有字但看不清"。
//
// 这不是审美口味问题，是可测量的硬下限。所以 accent 在深底上必须被校正到能读，
// 而不是把"设计感"建立在看不清上面。色调（hue）尽量保住，只推明度。
const CONTRAST_MIN_RATIO = 4.5;

function hexChannels(hex) {
  return [0, 1, 2].map((index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

function relativeLuminance(hex) {
  const [r, g, b] = hexChannels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度：(L_亮 + 0.05) / (L_暗 + 0.05)，范围 1–21。 */
export function contrastRatio(left, right) {
  const a = relativeLuminance(normalizeThemeColor(left, 'contrast color'));
  const b = relativeLuminance(normalizeThemeColor(right, 'contrast background'));
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 把前景色推到与背景达到 `minRatio` 对比度为止，只调明度、不换色调。
 * 向背景的反方向各走 20 档；都达不到（极端配色）才回退到 `fallback`。
 * 回退值由调用方给（深底给 onDeep、浅底给 primary），保证永远不会返回一个不可读的颜色。
 */
export function ensureReadableColor(foreground, background, { minRatio = CONTRAST_MIN_RATIO, fallback } = {}) {
  const fg = normalizeThemeColor(foreground, 'foreground color');
  const bg = normalizeThemeColor(background, 'background color');
  if (contrastRatio(fg, bg) >= minRatio) return fg;
  const target = relativeLuminance(bg) > 0.5 ? '000000' : 'FFFFFF';
  const steps = 20;
  for (let step = 1; step <= steps; step += 1) {
    const candidate = blendHex(fg, target, step / steps);
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
  }
  if (fallback === undefined) throw failure('INVALID_INPUT', `no readable variant of ${fg} on ${bg} reaches ${minRatio}:1`);
  const resolvedFallback = normalizeThemeColor(fallback, 'fallback color');
  if (contrastRatio(resolvedFallback, bg) < minRatio) {
    throw failure('INVALID_INPUT', `fallback ${resolvedFallback} does not reach ${minRatio}:1 on ${bg}; fix the theme rather than shipping unreadable text`);
  }
  return resolvedFallback;
}

function presetTheme(name) {
  const key = String(name).trim();
  if (!Object.hasOwn(THEME_PRESETS, key)) throw failure('INVALID_INPUT', `theme preset must be one of: ${THEME_NAMES.join(', ')}`);
  return { name: key, ...THEME_PRESETS[key], chartColors: chartColorsFor(THEME_PRESETS[key]) };
}

/**
 * 把外部传入的 theme 归一化成渲染器要用的完整色板。
 * 接受：undefined（中性兜底）/ 预设名 / { preset?, 各槽位 hex, chartColors? }。
 * 任何槽位都可以被显式 hex 覆盖——这是"颜色从内容里长出来"的落地口子。
 */
export function resolveTheme(raw) {
  if (raw === undefined || raw === null || raw === '') return presetTheme(DEFAULT_THEME_NAME);
  if (typeof raw === 'string') return presetTheme(raw);
  if (!object(raw)) throw failure('INVALID_INPUT', 'theme must be a preset name or an object of hex color slots');
  const resolved = { ...presetTheme(raw.preset ?? raw.name ?? DEFAULT_THEME_NAME) };
  for (const slot of THEME_SLOTS) {
    if (raw[slot] !== undefined) resolved[slot] = normalizeThemeColor(raw[slot], `theme.${slot}`);
  }
  if (raw.chartColors !== undefined) {
    if (!Array.isArray(raw.chartColors) || raw.chartColors.length < 1 || raw.chartColors.length > 6) {
      throw failure('INVALID_INPUT', 'theme.chartColors must list 1-6 hex colors');
    }
    resolved.chartColors = raw.chartColors.map((value, index) => normalizeThemeColor(value, `theme.chartColors[${index}]`));
  } else {
    resolved.chartColors = chartColorsFor(resolved);
  }
  for (const key of Object.keys(raw)) {
    // name 是 resolveTheme 自己回写的预设名；源码经 validatePresentation 归一化后
    // 会被再次喂回来（revise 路径），必须认它，否则修订永远报 INVALID_INPUT。
    if (key !== 'preset' && key !== 'name' && key !== 'chartColors' && !THEME_SLOTS.includes(key)) throw failure('INVALID_INPUT', `theme.${key} is not a supported slot`);
  }
  return resolved;
}

// ═══════════════════════════════════════════════════════════════════════════
// 版式目录
//
// 内容页沿用原有三种（title-body / title-table / title-chart），几何一字未改，
// 保证既有 manifest 与修订的字节级契约稳定。
// 新增五个「节奏页」——封面/章节/金句/数据锚点/结束页。官方规范要求
// "连续三个版面视觉重量相同必须打破"，没有节奏页就永远做不到。
// 封面与结束页走深底（三明治结构），章节/金句留在浅底做呼吸。
// ═══════════════════════════════════════════════════════════════════════════
const CONTENT_LAYOUTS = ['title-body', 'title-table', 'title-chart', 'title-process'];
const RHYTHM_LAYOUTS = ['cover', 'section', 'statement', 'kpi', 'closing'];
export const SUPPORTED_LAYOUTS = Object.freeze([...CONTENT_LAYOUTS, ...RHYTHM_LAYOUTS]);
const DEEP_LAYOUTS = new Set(['cover', 'closing']);
/** 节奏页正文行数上限：节奏页的 body 是副题/出处，不是要点清单。 */
const RHYTHM_BODY_LIMIT = Object.freeze({ cover: 3, section: 2, statement: 3, kpi: 4, closing: 3 });

export class MochiPresentationsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MochiPresentationsError';
    this.code = code;
    for (const [key, value] of Object.entries(details)) this[key] = value;
  }
}
const failure = (code, message) => new MochiPresentationsError(code, message);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw failure('INVALID_INPUT', `${label} must contain 1-${max} characters`);
  return value.trim();
};
const singleLineText = (value, max, label) => {
  const normalized = text(value, max, label);
  if (/[\r\n]/u.test(normalized)) throw failure('INVALID_INPUT', `${label} must not contain line breaks`);
  return normalized;
};
const singleLineCell = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) throw failure('INVALID_INPUT', `${label} must contain at most ${max} characters`);
  if (/[\r\n]/u.test(value)) throw failure('INVALID_INPUT', `${label} must not contain line breaks`);
  return value.trim();
};

function validateSource(source) {
  if (!object(source)) throw failure('INVALID_INPUT', 'every slide requires an explicit source');
  return { label: singleLineText(source.label, 160, 'source label'), reference: singleLineText(source.reference, 500, 'source reference') };
}

function validateTable(table) {
  if (!object(table) || !Array.isArray(table.headers) || table.headers.length < 2 || table.headers.length > 5) throw failure('INVALID_INPUT', 'table requires 2-5 headers');
  const headers = table.headers.map((value) => singleLineText(value, 60, 'table header'));
  const cellCapacity = Math.floor(72 / headers.length);
  if (headers.some((value) => displayUnits(value) > cellCapacity)) throw failure('INVALID_INPUT', 'table headers exceed the fixed projection column width');
  if (!Array.isArray(table.rows) || table.rows.length < 1 || table.rows.length > 8) throw failure('INVALID_INPUT', 'table requires 1-8 rows');
  const rows = table.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== headers.length) throw failure('INVALID_INPUT', 'table rows must match header count');
    return row.map((value) => {
      const cell = singleLineCell(value, 80, 'table cell');
      if (displayUnits(cell) > cellCapacity) throw failure('INVALID_INPUT', 'table cells exceed the fixed projection column width');
      return cell;
    });
  });
  return { headers, rows };
}

function displayUnits(value) {
  return Array.from(value).reduce((total, character) => {
    if (/\s/u.test(character)) return total + 0.35;
    return total + (character.codePointAt(0) <= 0x7f ? 0.55 : 1);
  }, 0);
}

function wrappedLines(value, unitsPerLine) {
  return value.replaceAll('\r', '').split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(displayUnits(line) / unitsPerLine)), 0);
}

function validateChart(chart) {
  if (!object(chart) || !['bar', 'line', 'pie'].includes(chart.type)) throw failure('INVALID_INPUT', 'chart type must be bar, line, or pie');
  const labels = Array.isArray(chart.labels) ? chart.labels.map((value) => singleLineText(value, 36, 'chart label')) : null;
  if (!labels || labels.length < 2 || labels.length > 8) throw failure('INVALID_INPUT', 'chart requires 2-8 labels');
  if (labels.some((value) => displayUnits(value) > 14)) throw failure('INVALID_INPUT', 'chart labels exceed the fixed projection axis width');
  if (!Array.isArray(chart.series) || chart.series.length < 1 || chart.series.length > 3) throw failure('INVALID_INPUT', 'chart requires 1-3 series');
  if (chart.type === 'pie' && chart.series.length !== 1) throw failure('INVALID_INPUT', 'pie chart requires exactly one series');
  const series = chart.series.map((item) => {
    if (!object(item)) throw failure('INVALID_INPUT', 'chart series must be objects');
    const name = singleLineText(item.name, 60, 'chart series name');
    if (displayUnits(name) > 24) throw failure('INVALID_INPUT', 'chart series names exceed the fixed projection legend width');
    if (!Array.isArray(item.values) || item.values.length !== labels.length) throw failure('INVALID_INPUT', 'chart series values must match labels');
    const values = item.values.map((value) => {
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) throw failure('INVALID_INPUT', 'chart values must be finite numbers within the supported range');
      if (chart.type === 'pie' && value < 0) throw failure('INVALID_INPUT', 'pie chart values cannot be negative');
      return value;
    });
    return { name, values };
  });
  if (!series.some((item) => item.values.some((value) => value !== 0))) throw failure('INVALID_INPUT', 'chart requires at least one non-zero value');
  return { type: chart.type, ...(chart.title === undefined ? {} : { title: singleLineText(chart.title, 80, 'chart title') }), labels, series };
}

/**
 * 按版式的**真实行宽**估算行数，而不是全篇共用"每行 25 字"的粗估。
 * 这一条是抬字号的前提：字号抬上去而预算没跟着算，长标题就会在 PPTX 里溢出
 * （pptxgenjs 不会自动缩字号，超出文本框就是被切掉）。
 */
function countUnits(value, widthInches, fontSize) {
  const unitsPerLine = widthInches / (fontSize / 72);
  return value.replaceAll('\r', '').split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(displayUnits(line) / unitsPerLine)), 0);
}

/** 依次尝试候选字号：第 i 档能放下就说明最多 i 行；都不行返回 null（调用方报错）。 */
function fitTitle(value, widthInches, sizes) {
  for (const [index, fontSize] of sizes.entries()) {
    const lines = countUnits(value, widthInches, fontSize);
    if (lines <= index + 1) return { titleLines: lines, titleFontSize: fontSize };
  }
  return null;
}

/**
 * 节奏页（封面/章节/金句/数据锚点/结束页）的几何计划。
 * 共同点是"只讲一件事"：标题即主角，body 退成副题或出处，因此不带项目符号、
 * 也不参与内容页那套要点预算。
 */
const RHYTHM_GEOMETRY = Object.freeze({
  cover: { centered: true, titleWidth: 9.2, titleSizes: [44, 36], titleTop: 2.45, bodyWidth: 8.6, bodyFontSize: 18, bodyGap: 0.9, accentTitle: false, accentBody: true },
  kpi: { centered: true, titleWidth: 11, titleSizes: [88, 60], titleTop: 1.75, bodyWidth: 9.6, bodyFontSize: 18, bodyGap: 0.5, accentTitle: true, accentBody: false },
  statement: { centered: false, titleWidth: 10.6, titleSizes: [34, 27], titleTop: 2.75, bodyWidth: 10.6, bodyFontSize: 15, bodyGap: 0.7, accentTitle: true, accentBody: false },
  section: { centered: false, titleWidth: 10.6, titleSizes: [36, 29], titleTop: 2.9, bodyWidth: 10.6, bodyFontSize: 15, bodyGap: 0.7, accentTitle: false, accentBody: true },
  closing: { centered: false, titleWidth: 10.6, titleSizes: [36, 29], titleTop: 2.9, bodyWidth: 10.6, bodyFontSize: 15, bodyGap: 0.7, accentTitle: false, accentBody: true },
});

function rhythmPlan(slide) {
  const { layout } = slide;
  const spec = RHYTHM_GEOMETRY[layout];
  const fitted = fitTitle(slide.title, spec.titleWidth, spec.titleSizes);
  if (!fitted) throw failure('INVALID_INPUT', `${layout} slide title is too long for this layout; shorten it rather than shrinking the type`);
  const { titleLines, titleFontSize } = fitted;
  // 1.3 而不是 1.2：给 PPTX 与 PDF 两个渲染器都留一点行高余量，避免临界裁切。
  const titleHeight = Number(((titleLines * titleFontSize * 1.3) / 72).toFixed(2));
  const bodyTop = Number((spec.titleTop + titleHeight + spec.bodyGap).toFixed(2));
  const bodyLines = countUnits(slide.body.join('\n'), spec.bodyWidth, spec.bodyFontSize);
  const limit = RHYTHM_BODY_LIMIT[layout];
  if (bodyLines > limit) throw failure('INVALID_INPUT', `${layout} slides allow at most ${limit} body lines at this size; shorten the subtitle`);
  return {
    role: layout, centered: spec.centered,
    titleLines, titleFontSize, titleTop: spec.titleTop, titleWidth: spec.titleWidth, titleHeight,
    bodyLines, bodyFontSize: spec.bodyFontSize, bodyTop, bodyWidth: spec.bodyWidth,
    bodyHeight: Math.max(0.5, Number((CONTENT_BOTTOM - bodyTop).toFixed(2))),
    accentTitle: spec.accentTitle, accentBody: spec.accentBody,
  };
}

function projectionPlan(slide) {
  if (!CONTENT_LAYOUTS.includes(slide.layout)) return rhythmPlan(slide);
  if (slide.layout === 'title-process') {
    const fitted = fitTitle(slide.title, 11.8, [34, 28]);
    if (!fitted || slide.body.length > 1 || slide.body.some(line => line.length > 40)) throw failure('INVALID_INPUT', '流程图需要简短标题，bullets至多1条且≤40字；说明写入各步骤detail');
    return { ...fitted, titleHeight: fitted.titleLines === 1 ? 0.65 : 0.98, bodyY: 1.6, bodyHeight: 0.6, bodyFontSize: 18 };
  }
  const fitted = fitTitle(slide.title, 11.8, [34, 28]);
  if (!fitted) throw failure('INVALID_INPUT', 'slide title exceeds the bounded two-line projection layout');
  const { titleLines, titleFontSize } = fitted;
  const titleHeight = titleLines === 1 ? 0.65 : 0.98;
  const bodyLines = slide.body.reduce((total, line) => total + wrappedLines(line, 41), 0);
  const compact = slide.layout === 'title-table' || slide.layout === 'title-chart';
  const maximumBodyLines = compact ? 3 : 14;
  if (bodyLines > maximumBodyLines) throw failure('INVALID_INPUT', compact ? 'table/chart slide body exceeds the fixed projection area' : 'slide body exceeds the fixed projection area');
  const bodyFontSize = bodyLines <= 9 ? 19 : bodyLines <= 12 ? 18 : 17;
  const bodyLineHeight = bodyFontSize * 1.35 / 72;
  const bodyY = 0.55 + titleHeight + 0.25;
  const bodyHeight = compact ? Math.max(0.8, bodyLines * bodyLineHeight + 0.14) : CONTENT_BOTTOM - bodyY;
  const contentY = bodyY + bodyHeight + 0.18;
  const contentHeight = CONTENT_BOTTOM - contentY;
  if (compact && contentHeight < 3.45) throw failure('INVALID_INPUT', 'title and body leave insufficient room for the native table or chart');
  return { titleLines, titleFontSize, titleHeight, bodyLines, bodyFontSize, bodyY, bodyHeight, ...(compact ? { contentY, contentHeight } : {}) };
}

export function validatePresentation(input) {
  if (!object(input) || input.schema !== 'mochi-lesson-presentation-v1') throw failure('INVALID_INPUT', 'structured presentation schema is required');
  if (!['upstream-authorized-structured-content', 'demonstration'].includes(input.sourceKind)) throw failure('INVALID_INPUT', 'sourceKind is invalid');
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw failure('INVALID_INPUT', 'deck version must be a positive integer');
  if (!Array.isArray(input.slides) || input.slides.length < 1 || input.slides.length > MAX_SLIDES) throw failure('INVALID_INPUT', `presentation requires 1-${MAX_SLIDES} slides`);
  const theme = resolveTheme(input.theme);
  const ids = new Set();
  const slides = input.slides.map((slide, index) => {
    if (!object(slide)) throw failure('INVALID_INPUT', `slide ${index + 1} must be an object`);
    const id = text(slide.id, 80, 'slide id');
    if (ids.has(id)) throw failure('INVALID_INPUT', 'slide ids must be unique');
    ids.add(id);
    if (!Number.isSafeInteger(slide.version) || slide.version < 1) throw failure('INVALID_INPUT', 'slide version must be a positive integer');
    if (!SUPPORTED_LAYOUTS.includes(slide.layout)) throw failure('INVALID_INPUT', `slide layout must be one of: ${SUPPORTED_LAYOUTS.join(', ')}`);
    if (!Array.isArray(slide.body)) throw failure('INVALID_INPUT', 'slide body must be an array');
    const body = slide.body.map((value) => text(value, 140, 'body paragraph'));
    if (body.length > 6 || body.reduce((sum, value) => sum + value.length, 0) > 520) throw failure('INVALID_INPUT', 'slide body exceeds the supported projection layout');
    if (RHYTHM_LAYOUTS.includes(slide.layout) && (slide.table !== undefined || slide.chart !== undefined)) {
      throw failure('INVALID_INPUT', `${slide.layout} slides carry no table or chart; use title-table / title-chart for data`);
    }
    if (slide.process !== undefined && slide.layout !== 'title-process') throw failure('INVALID_INPUT', 'process必须使用title-process版式');
    if (slide.layout === 'title-process' && (slide.table !== undefined || slide.chart !== undefined)) throw failure('INVALID_INPUT', '流程图不能同时含table/chart');
    let process;
    if (slide.layout === 'title-process') {
      try { process = validateProcess(slide.process); } catch (error) { throw failure('INVALID_INPUT', error.message); }
    }
    const table = slide.layout === 'title-table' ? validateTable(slide.table) : undefined;
    const chart = slide.layout === 'title-chart' ? validateChart(slide.chart) : undefined;
    if (slide.layout === 'title-body' && body.length < 1) throw failure('INVALID_INPUT', 'title-body slides require body content');
    if ((slide.layout === 'title-table' || slide.layout === 'title-chart') && body.length < 1) throw failure('INVALID_INPUT', 'table/chart slides require body content');
    const validated = { id, version: slide.version, layout: slide.layout, title: text(slide.title, 100, 'slide title'), body, ...(table ? { table } : {}), ...(chart ? { chart } : {}), ...(process ? { process } : {}), source: validateSource(slide.source) };
    projectionPlan(validated);
    return validated;
  });
  return { schema: input.schema, sourceKind: input.sourceKind, deckId: text(input.deckId, 100, 'deck id'), version: input.version, title: text(input.title, 160, 'deck title'), theme, slides };
}

function semanticHash(slide) { return createHash('sha256').update(JSON.stringify(slide)).digest('hex'); }

function chartSummary(chart) {
  const heading = chart.title ? `图表：${chart.title}` : `图表：${chart.type}`;
  const series = chart.series.map((item) => `${item.name}：${chart.labels.map((label, index) => `${label} ${item.values[index]}`).join('；')}`);
  return [heading, ...series];
}

function addNativeChart(slide, chart, plan, pptx, theme) {
  const options = {
    x: 0.9,
    y: plan.contentY,
    w: TABLE_AREA_WIDTH,
    h: plan.contentHeight,
    chartColors: theme.chartColors,
    chartArea: { fill: { color: theme.surface }, border: { color: theme.rule, pt: 1 } },
    plotArea: { border: { color: theme.rule, pt: 0.5 } },
    dataBorder: { color: theme.surface, pt: 0.5 },
    showLegend: chart.series.length > 1,
    legendPos: 'b',
    legendFontFace: PROJECTION_FONT,
    legendFontSize: 11,
    legendColor: theme.text,
    catAxisLabelFontFace: PROJECTION_FONT,
    catAxisLabelFontSize: 11,
    catAxisLabelColor: theme.text,
    valAxisLabelFontFace: PROJECTION_FONT,
    valAxisLabelFontSize: 11,
    valAxisLabelColor: theme.text,
    dataLabelFontFace: PROJECTION_FONT,
    dataLabelFontSize: 11,
    dataLabelColor: theme.text,
    valGridLine: { color: theme.rule, size: 0.5 },
    catGridLine: { style: 'none' },
    showTitle: Boolean(chart.title),
    ...(chart.title ? { title: chart.title, titleFontFace: PROJECTION_FONT, titleFontSize: 16, titleColor: theme.primary, titleBold: true } : {}),
    lang: 'zh-CN',
  };
  if (chart.type === 'pie') {
    Object.assign(options, { showLegend: true, showLabel: true, showPercent: true, dataLabelPosition: 'bestFit' });
  } else if (chart.type === 'bar') {
    Object.assign(options, { showValue: true, dataLabelPosition: 'outEnd', barGrouping: 'clustered', barGapWidthPct: 55 });
  } else {
    Object.assign(options, { lineDataSymbol: 'circle', lineDataSymbolSize: 5, lineSize: 2 });
  }
  slide.addChart(pptx.ChartType[chart.type], chart.series.map((item) => ({ name: item.name, labels: chart.labels, values: item.values })), options);
}

function addSlide(pptx, item, index, theme) {
  const plan = projectionPlan(item);
  const slide = pptx.addSlide();
  const rhythm = !CONTENT_LAYOUTS.includes(item.layout);
  const deep = DEEP_LAYOUTS.has(item.layout);
  const surface = deep ? theme.deep : theme.background;
  slide.background = { color: surface };
  // accent 只保证"与主色搭"，不保证"压在这个底色上看得清"；深底页必须过对比度下限。
  const accentOnSurface = ensureReadableColor(theme.accent, surface, {
    fallback: deep ? theme.onDeep : theme.primary,
  });
  const titleColor = plan.accentTitle ? accentOnSurface : (deep ? theme.onDeep : theme.primary);
  const bodyColor = plan.accentBody ? accentOnSurface : (deep ? theme.onDeep : theme.text);
  const footerColor = deep ? theme.onDeep : theme.muted;
  const align = plan.centered ? 'center' : 'left';

  if (rhythm) {
    // 节奏页：只讲一件事。标题即主角，body 退成副题/出处，因此不带项目符号。
    const titleX = plan.centered ? (SLIDE_WIDTH - plan.titleWidth) / 2 : STAGE_LEFT;
    slide.addText(item.title, {
      x: titleX, y: plan.titleTop, w: plan.titleWidth, h: plan.titleHeight,
      fontFace: PROJECTION_FONT, fontSize: plan.titleFontSize, bold: true, color: titleColor,
      align, margin: 0, breakLine: false, lang: 'zh-CN', valign: 'mid',
      ...(plan.role === 'kpi' ? { charSpacing: -1 } : {}),
    });
    if (item.body.length > 0) {
      const bodyX = plan.centered ? (SLIDE_WIDTH - plan.bodyWidth) / 2 : STAGE_LEFT;
      slide.addText(item.body.map((line) => ({ text: line, options: { breakLine: true, lang: 'zh-CN' } })), {
        x: bodyX, y: plan.bodyTop, w: plan.bodyWidth, h: plan.bodyHeight,
        fontFace: PROJECTION_FONT, fontSize: plan.bodyFontSize, color: bodyColor,
        align, breakLine: true, valign: 'top', margin: 0, lang: 'zh-CN',
        lineSpacing: Math.round(plan.bodyFontSize * 1.4), paraSpaceAfterPt: 2,
      });
    }
  } else {
    slide.addText(item.title, { x: STAGE_LEFT, y: 0.55, w: 11.8, h: plan.titleHeight, fontFace: PROJECTION_FONT, fontSize: plan.titleFontSize, bold: true, color: theme.primary, margin: 0, breakLine: false, lang: 'zh-CN', valign: 'mid' });
    if (item.body.length) slide.addText(item.body.map((line) => ({ text: line, options: { bullet: { indent: 18 }, breakLine: true, lang: 'zh-CN' } })), { x: 0.9, y: plan.bodyY, w: TABLE_AREA_WIDTH, h: plan.bodyHeight, fontFace: PROJECTION_FONT, fontSize: plan.bodyFontSize, color: theme.text, breakLine: true, valign: 'top', margin: 0.08, lang: 'zh-CN', lineSpacing: Math.round(plan.bodyFontSize * 1.4), paraSpaceAfterPt: 6 });
    if (item.table) {
      slide.addTable([item.table.headers, ...item.table.rows], { x: 0.9, y: plan.contentY, w: TABLE_AREA_WIDTH, h: plan.contentHeight, colW: Array(item.table.headers.length).fill(TABLE_AREA_WIDTH / item.table.headers.length), border: { type: 'solid', color: theme.rule, pt: 1 }, fill: theme.surface, color: theme.text, fontFace: PROJECTION_FONT, fontSize: 15, margin: 0.06, bold: false, rowH: 0.38, autoFit: false, lang: 'zh-CN' });
    }
    if (item.chart) addNativeChart(slide, item.chart, plan, pptx, theme);
    if (item.process) drawProcessPptx(slide, item.process, theme, PROJECTION_FONT);
  }

  slide.addText(`${index + 1}  ${item.source.label}`, { x: STAGE_LEFT, y: FOOTER_Y, w: 11.8, h: FOOTER_HEIGHT, fontFace: PROJECTION_FONT, fontSize: 11, color: footerColor, margin: 0, lang: 'zh-CN' });
  slide.addNotes(`Source: ${item.source.label}\nReference: ${item.source.reference}\nSlide ID: ${item.id}\nSlide version: ${item.version}`);
}

async function createPptx(input, path) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'Mochi Presentations'; pptx.subject = input.sourceKind; pptx.title = input.title; pptx.lang = 'zh-CN';
  pptx.theme = { headFontFace: PROJECTION_FONT, bodyFontFace: PROJECTION_FONT, lang: 'zh-CN' };
  input.slides.forEach((slide, index) => {
    addSlide(pptx, slide, index, input.theme);
  });
  await pptx.writeFile({ fileName: path, compression: true });
}

function aborted(signal) { if (signal?.aborted) throw failure('ABORTED', 'presentation generation was cancelled'); }

function slidePdfText(input) {
  const fragments = [];
  for (const slide of input.slides) {
    fragments.push(slide.title, ...slide.body, slide.source.label);
    if (slide.table) fragments.push(...slide.table.headers, ...slide.table.rows.flat());
    if (slide.chart) fragments.push(...chartSummary(slide.chart));
    if (slide.process) fragments.push(...slide.process.steps.flatMap(step => [step.label, step.detail]), slide.process.loopLabel);
  }
  return fragments.filter(Boolean);
}

function fittedText(lines, font, { width, maximumHeight, preferredSize, minimumSize, lineHeightFactor }) {
  for (let size = preferredSize; size >= minimumSize; size -= 1) {
    const lineHeight = size * lineHeightFactor;
    const wrapped = lines.flatMap((line) => wrapText({ text: line, font, size, maxWidth: width }));
    if (wrapped.length * lineHeight <= maximumHeight) return { size, lineHeight, wrapped };
  }
  throw failure('PDF_LAYOUT_OVERFLOW', 'structured slide text cannot fit its bounded PDF layout');
}

// PDF 画布与 PPTX 同为 13.333×7.5 英寸，1 英寸 = 72pt。
const PDF_IN = 72;
const fromTop = (inches) => PDF_SLIDE_HEIGHT - inches * PDF_IN;

/** drawTextBlock 只支持左对齐；封面/KPI 需要居中，这里按真实字宽逐行算 x。 */
function drawAlignedLines({ page, lines, x, centerX, top, font, size, lineHeight, fill }) {
  lines.forEach((line, index) => {
    if (!line) return;
    const drawX = centerX === undefined ? x : centerX - measureText(line, font, size) / 2;
    drawTextLine({ page, text: line, x: drawX, y: top - size - index * lineHeight, size, font, fill });
  });
  return { bottom: top - lines.length * lineHeight };
}

async function renderPresentationPdf(input, signal) {
  aborted(signal);
  const theme = input.theme;
  const { pdfDocument, font } = await createPdfLayoutDocument({
    title: input.title,
    subject: 'Mochi structured lesson presentation',
    creator: 'Mochi Presentations',
  });
  for (const [index, item] of input.slides.entries()) {
    aborted(signal);
    const plan = projectionPlan(item);
    const rhythm = !CONTENT_LAYOUTS.includes(item.layout);
    const deep = DEEP_LAYOUTS.has(item.layout);
    const page = pdfDocument.addPage([PDF_SLIDE_WIDTH, PDF_SLIDE_HEIGHT]);
    const pdfSurface = deep ? theme.deep : theme.background;
    page.drawRectangle({ x: 0, y: 0, width: PDF_SLIDE_WIDTH, height: PDF_SLIDE_HEIGHT, color: pdfColor(pdfSurface) });
    // 与 PPTX 路径同一口径：深底页的 accent 必须过对比度下限（两条渲染器不许有两种标准）。
    const pdfAccent = ensureReadableColor(theme.accent, pdfSurface, { fallback: deep ? theme.onDeep : theme.primary });
    const titleFill = pdfColor(plan.accentTitle ? pdfAccent : (deep ? theme.onDeep : theme.primary));
    const bodyFill = pdfColor(plan.accentBody ? pdfAccent : (deep ? theme.onDeep : theme.text));
    const footerFill = pdfColor(deep ? theme.onDeep : theme.muted);

    if (item.process) {
      drawTextBlock({ page, text: item.title, x: STAGE_LEFT * PDF_IN, top: fromTop(0.55), width: 11.8 * PDF_IN, font, size: plan.titleFontSize, lineHeight: plan.titleFontSize * 1.3, fill: titleFill });
      if (item.body.length) drawTextBlock({ page, text: item.body[0], x: 0.9 * PDF_IN, top: fromTop(1.6), width: 11.5 * PDF_IN, font, size: 18, lineHeight: 23, fill: bodyFill });
      const scene = processScene(item.process);
      for (const card of scene.cards) {
        page.drawRectangle({ x: card.x * PDF_IN, y: fromTop(card.y + card.h), width: card.w * PDF_IN, height: card.h * PDF_IN, color: pdfColor(theme.surface), borderColor: pdfColor(theme.rule), borderWidth: 1 });
        page.drawRectangle({ x: card.x * PDF_IN, y: fromTop(card.y + 0.08), width: card.w * PDF_IN, height: 0.08 * PDF_IN, color: pdfColor(theme.primary) });
        for (const block of [{ text: card.label, top: card.y + 0.4, height: 0.95, size: 26, factor: 1.3, fill: titleFill }, { text: card.detail, top: card.y + 1.45, height: 1.35, size: 18, factor: 1.25, fill: bodyFill }]) {
          const fitted = fittedText([block.text], font, { width: (card.w - 0.4) * PDF_IN, maximumHeight: block.height * PDF_IN, preferredSize: block.size, minimumSize: block.size, lineHeightFactor: block.factor });
          drawAlignedLines({ page, lines: fitted.wrapped, x: (card.x + 0.2) * PDF_IN, top: fromTop(block.top), font, size: fitted.size, lineHeight: fitted.lineHeight, fill: block.fill });
        }
      }
      for (const a of scene.arrows) {
        const line = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1 * PDF_IN, y: fromTop(y1) }, end: { x: x2 * PDF_IN, y: fromTop(y2) }, thickness: 2, color: pdfColor(theme.primary) });
        line(a.x1, a.y1, a.x2, a.y2);
        if (a.head) {
          const dx = Math.sign(a.x2 - a.x1); const dy = Math.sign(a.y2 - a.y1);
          line(a.x2, a.y2, a.x2 - 0.13 * dx + 0.07 * dy, a.y2 - 0.13 * dy - 0.07 * dx);
          line(a.x2, a.y2, a.x2 - 0.13 * dx - 0.07 * dy, a.y2 - 0.13 * dy + 0.07 * dx);
        }
      }
      if (item.process.loopLabel) drawAlignedLines({ page, lines: [item.process.loopLabel], x: 0.8 * PDF_IN, centerX: PDF_SLIDE_WIDTH / 2, top: fromTop(5.65), font, size: 18, lineHeight: 22.5, fill: titleFill });
    } else if (rhythm) {
      // 节奏页：与 PPTX 同一套几何（英寸 → pt，顶部原点换算成 pdf-lib 的底部原点）。
      const centerX = plan.centered ? PDF_SLIDE_WIDTH / 2 : undefined;
      const title = fittedText([item.title], font, {
        width: plan.titleWidth * PDF_IN,
        maximumHeight: (plan.titleHeight + 0.16) * PDF_IN,
        preferredSize: plan.titleFontSize,
        minimumSize: Math.max(18, plan.titleFontSize - 8),
        lineHeightFactor: 1.3,
      });
      drawAlignedLines({ page, lines: title.wrapped, x: STAGE_LEFT * PDF_IN, centerX, top: fromTop(plan.titleTop), font, size: title.size, lineHeight: title.lineHeight, fill: titleFill });
      if (item.body.length > 0) {
        const body = fittedText(item.body, font, {
          width: plan.bodyWidth * PDF_IN,
          maximumHeight: plan.bodyHeight * PDF_IN,
          preferredSize: plan.bodyFontSize,
          minimumSize: 11,
          lineHeightFactor: 1.4,
        });
        drawAlignedLines({ page, lines: body.wrapped, x: STAGE_LEFT * PDF_IN, centerX, top: fromTop(plan.bodyTop), font, size: body.size, lineHeight: body.lineHeight, fill: bodyFill });
      }
    } else {
      const title = fittedText([item.title], font, {
        width: 840,
        maximumHeight: 82,
        preferredSize: 30,
        minimumSize: 16,
        lineHeightFactor: 1.18,
      });
      drawTextBlock({
        page,
        text: title.wrapped.join('\n'),
        x: 54,
        top: 500,
        width: 840,
        font,
        size: title.size,
        lineHeight: title.lineHeight,
        fill: titleFill,
      });
      const compact = Boolean(item.table || item.chart);
      const body = fittedText(item.body.map((line) => '• ' + line), font, {
        width: 820,
        maximumHeight: compact ? 72 : 300,
        preferredSize: 17,
        minimumSize: 10,
        lineHeightFactor: 1.35,
      });
      drawTextBlock({
        page,
        text: body.wrapped.join('\n'),
        x: 66,
        top: 401,
        width: 820,
        font,
        size: body.size,
        lineHeight: body.lineHeight,
        fill: bodyFill,
      });
      if (item.table) {
        let table;
        for (let size = 13; size >= 6; size -= 1) {
          const candidate = layoutTable({
            table: item.table,
            width: 820,
            font,
            size,
            lineHeight: size * 1.25,
            padding: 4,
          });
          if (candidate.header.height + candidate.rows.reduce((total, row) => total + row.height, 0) <= 242) {
            table = candidate;
            break;
          }
        }
        if (!table) throw failure('PDF_LAYOUT_OVERFLOW', 'structured slide table cannot fit its bounded PDF layout');
        drawTable({
          page,
          table,
          x: 66,
          top: 320,
          font,
          headerFill: pdfColor(theme.primary),
          bodyFill: pdfColor(theme.surface),
          headerText: pdfColor(deep ? theme.deep : theme.background),
          bodyText: pdfColor(theme.text),
          border: pdfColor(theme.rule),
        });
      }
      if (item.chart) {
        // 课件 PDF 是纯 JS 生成的伴生产物，没有原生图表部件；这里输出同源的图表数据摘要，
        // 由 inspectPdfArtifact 校验文本完整（.pptx 才是带原生可编辑图表的交付物）。
        const summary = fittedText(chartSummary(item.chart), font, {
          width: 820,
          maximumHeight: 232,
          preferredSize: 14,
          minimumSize: 8,
          lineHeightFactor: 1.3,
        });
        drawTextBlock({
          page,
          text: summary.wrapped.join('\n'),
          x: 66,
          top: 320,
          width: 820,
          font,
          size: summary.size,
          lineHeight: summary.lineHeight,
          fill: bodyFill,
        });
      }
    }
    drawTextBlock({
      page,
      text: String(index + 1) + '  ' + item.source.label,
      x: STAGE_LEFT * PDF_IN,
      top: fromTop(FOOTER_Y),
      width: 840,
      font,
      size: 11,
      lineHeight: 13,
      fill: footerFill,
    });
  }
  aborted(signal);
  const bytes = await savePdfLayoutDocument(pdfDocument);
  aborted(signal);
  const inspection = await inspectPdfArtifact(bytes, {
    expectedPageCount: input.slides.length,
    requiredText: slidePdfText(input),
  });
  if (inspection.imageCount !== 0) throw failure('PDF_LAYOUT_IMAGE', 'lesson PDF must not contain page-image substitutes');
  return { bytes, inspection };
}

async function assertNewDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw failure('INVALID_OUTPUT_DIRECTORY', 'outputDirectory must be an absolute host-assigned path');
  const target = resolve(path);
  try { await mkdir(dirname(target), { recursive: true }); } catch (error) { throw failure('OUTPUT_UNAVAILABLE', `outputDirectory parent is unavailable: ${error?.code ?? 'filesystem error'}`); }
  try { await mkdir(target); } catch (error) { if (error?.code === 'EEXIST') throw failure('OUTPUT_EXISTS', 'outputDirectory already exists'); throw failure('OUTPUT_UNAVAILABLE', `outputDirectory cannot be reserved: ${error?.code ?? 'filesystem error'}`); }
  return target;
}
async function metadata(path, editable = false) { const bytes = await readFile(path); return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...(editable ? { editable: true } : {}) }; }
async function writeJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }

export async function generatePresentationBundle({ presentation, outputDirectory, signal } = {}) {
  const input = validatePresentation(presentation); aborted(signal); const target = await assertNewDirectory(outputDirectory);
  const stage = await mkdtemp(join(target, '.staging-')); let published = false;
  try {
    const pptxPath = join(stage, PPTX_NAME); await createPptx(input, pptxPath); aborted(signal);
    const generatedPdf = await renderPresentationPdf(input, signal);
    const pdfPath = join(stage, PDF_NAME); await writeFile(pdfPath, generatedPdf.bytes, { flag: 'wx', mode: 0o600 });
    const renderedPageCount = generatedPdf.inspection.pageCount;
    const slideLedger = input.slides.map((slide) => ({ id: slide.id, version: slide.version, layout: slide.layout, projection: projectionPlan(slide), source: slide.source, semanticHash: semanticHash(slide) }));
    await writeJson(join(stage, 'source.json'), input);
    const manifest = { schema: 'mochi-presentation-manifest-v1', status: 'completed', deckId: input.deckId, version: input.version, sourceKind: input.sourceKind, sourceSlideCount: input.slides.length, renderedPageCount, slides: slideLedger, files: { pptx: await metadata(pptxPath, true), pdf: await metadata(pdfPath) } };
    for (const filename of [PPTX_NAME, PDF_NAME, 'source.json']) await rename(join(stage, filename), join(target, filename));
    await writeJson(join(target, 'manifest.json'), manifest); await rm(stage, { recursive: true, force: true }); published = true;
    return { outputDirectory: target, pptxPath: join(target, PPTX_NAME), pdfPath: join(target, PDF_NAME), sourcePath: join(target, 'source.json'), manifestPath: join(target, 'manifest.json'), manifest };
  } catch (error) {
    if (error instanceof MochiPresentationsError) throw error;
    // 曾经这里只抛一句 "failed before publication"，把真实原因整个吞掉：
    // 现象是"生成失败"，但看不见是 pptxgenjs 报了非法颜色、还是渲染器炸了。
    // 排查成本极高，所以现在把底层错误名与消息原样带上（cause 交给调用方链式打印）。
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new MochiPresentationsError('GENERATION_FAILED', `presentation bundle failed before publication — ${reason}`, { cause: reason });
  }
  finally { if (!published) await rm(target, { recursive: true, force: true }); }
}

export async function revisePresentationBundle({ previousSourcePath, revision, outputDirectory, signal } = {}) {
  if (typeof previousSourcePath !== 'string' || !isAbsolute(previousSourcePath) || !object(revision)) throw failure('INVALID_REVISION', 'revision requires an absolute source path and structured patch');
  let prior; try { prior = validatePresentation(JSON.parse(await readFile(previousSourcePath, 'utf8'))); } catch (error) { if (error instanceof MochiPresentationsError) throw error; throw failure('INVALID_REVISION', 'previous source is unavailable or invalid'); }
  const slideIndex = prior.slides.findIndex((slide) => slide.id === revision.slideId); if (slideIndex < 0) throw failure('INVALID_REVISION', 'target slide does not exist');
  const current = prior.slides[slideIndex];
  const updated = { ...current, ...(revision.title !== undefined ? { title: revision.title } : {}), ...(revision.body !== undefined ? { body: revision.body } : {}), ...(revision.layout !== undefined ? { layout: revision.layout } : {}), ...(revision.table !== undefined ? { table: revision.table } : {}), ...(revision.chart !== undefined ? { chart: revision.chart } : {}), ...(revision.process !== undefined ? { process: revision.process } : {}), ...(revision.source !== undefined ? { source: revision.source } : {}), version: current.version + 1 };
  if (updated.layout !== 'title-table') delete updated.table;
  if (updated.layout !== 'title-chart') delete updated.chart;
  if (updated.layout !== 'title-process') delete updated.process;
  const next = validatePresentation({ ...prior, version: prior.version + 1, slides: prior.slides.map((slide, index) => index === slideIndex ? updated : slide) });
  return generatePresentationBundle({ presentation: next, outputDirectory, signal });
}

// ═════════════════════════════════════════════════════════════════════════════
// ppt_inspect · 只读检查一个 .pptx（真 OOXML 解析）
//
// PPTX 就是 zip + OOXML。这里用 JSZip 解包，再用本文件内的 XML 词法/树解析器
// 真读 ppt/presentation.xml、ppt/slides/slideN.xml、ppt/slideLayouts/**、
// ppt/notesSlides/**、docProps/**。没有正则猜结构：所有字段都来自解析树。
//
// 只读，不写盘；不重复实现 mochi_ppt_revise 的写能力（revise 仍走
// revisePresentationBundle）。文件不是合法 pptx（zip 打不开 / 缺
// ppt/presentation.xml / 主部件是 Word 或 Excel）一律明确报错，绝不返回
// “0 张幻灯片”。
// ═════════════════════════════════════════════════════════════════════════════

/** 只读检查接受的 .pptx 大小上限（字节）。超过即拒绝，不尝试解包。 */
export const MAX_INSPECT_BYTES = 64 * 1024 * 1024;
/** 只读检查接受的页数上限。超过即拒绝，避免超大课件耗尽内存。 */
export const MAX_INSPECT_SLIDES = 200;
/** 单个 XML 部件解压后的字节上限（zip 炸弹的第二道防线）。 */
export const MAX_INSPECT_PART_BYTES = 16 * 1024 * 1024;
const MAX_INSPECT_MEDIA_LIST = 50;

const XML_ENTITIES = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', '\u00a0']]);

function decodeXmlText(value) {
  if (!value || value.indexOf('&') < 0) return value;
  return value.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/gu, (match, body) => {
    if (body.charCodeAt(0) === 35 /* '#' */) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES.get(body) ?? match;
  });
}

const xmlLocalName = (name) => {
  const index = name.indexOf(':');
  return index < 0 ? name : name.slice(index + 1);
};

/**
 * 一个够用且不猜的 XML 解析器：单遍扫描出树，处理注释 / CDATA / 处理指令 /
 * DOCTYPE / 自闭合标签 / 命名空间前缀 / 实体。非法 XML 直接抛 XML_INVALID。
 * @returns {{name:string, local:string, attrs:Record<string,string>, children:Array, text:string}}
 */
export function parseXmlDocument(source) {
  if (typeof source !== 'string') throw failure('XML_INVALID', 'XML 部件内容必须是字符串');
  const root = { name: '#document', local: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let index = 0;
  const malformed = () => failure('XML_INVALID', 'OOXML 部件不是合法 XML（标签未闭合或嵌套错误）');
  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open < 0) {
      stack[stack.length - 1].text += decodeXmlText(source.slice(index));
      break;
    }
    if (open > index) stack[stack.length - 1].text += decodeXmlText(source.slice(index, open));
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end < 0) throw malformed();
      index = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end < 0) throw malformed();
      stack[stack.length - 1].text += source.slice(open + 9, end);
      index = end + 3;
      continue;
    }
    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open + 2);
      if (end < 0) throw malformed();
      index = end + 2;
      continue;
    }
    if (source.startsWith('<!', open)) {
      const end = source.indexOf('>', open + 2);
      if (end < 0) throw malformed();
      index = end + 1;
      continue;
    }
    const close = source.indexOf('>', open + 1);
    if (close < 0) throw malformed();
    const raw = source.slice(open + 1, close);
    index = close + 1;
    if (raw.startsWith('/')) {
      const closing = raw.slice(1).trim();
      const node = stack.pop();
      if (!node || stack.length === 0 || node.name !== closing) throw malformed();
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([^\s/>]+)/u.exec(body);
    if (!nameMatch) throw malformed();
    const node = { name: nameMatch[1], local: xmlLocalName(nameMatch[1]), attrs: {}, children: [], text: '' };
    const attrPattern = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/gu;
    for (let match = attrPattern.exec(body); match !== null; match = attrPattern.exec(body)) {
      node.attrs[match[1]] = decodeXmlText(match[3] ?? match[4] ?? '');
    }
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw malformed();
  return root;
}

const attrByName = (node, key) => (node && Object.prototype.hasOwnProperty.call(node.attrs, key) ? node.attrs[key] : undefined);
const attrNs = (node, prefix, local) => attrByName(node, `${prefix}:${local}`);
const attrLocal = (node, local) => {
  if (!node) return undefined;
  for (const [key, value] of Object.entries(node.attrs)) if (xmlLocalName(key) === local) return value;
  return undefined;
};
const elements = (node, local) => (node ? node.children.filter((child) => child.local === local) : []);
const firstElement = (node, local) => (node ? node.children.find((child) => child.local === local) ?? null : null);
const childPath = (node, names) => names.reduce((current, name) => firstElement(current, name), node);
const documentRoot = (document, local) => document.children.find((child) => child.local === local) ?? null;

function collectText(node) {
  let out = node.text ?? '';
  for (const child of node.children) out += collectText(child);
  return out;
}

/** 段落文字：a:r / a:fld 里的 a:t 连起来，a:br 换行，a:tab 制表。 */
function paragraphText(paragraph) {
  let out = '';
  for (const child of paragraph.children) {
    if (child.local === 'r' || child.local === 'fld') {
      for (const runText of elements(child, 't')) out += runText.text;
    } else if (child.local === 'br') out += '\n';
    else if (child.local === 'tab') out += '\t';
  }
  return out;
}

const runFontSize = (emphasized) => {
  if (!emphasized) return null;
  const size = attrByName(emphasized, 'sz');
  const value = Number(size);
  return Number.isFinite(value) && value > 0 ? value / 100 : null;
};

/** 一个 txBody 的段落文字 + 最大字号 + 是否加粗。 */
function textBodySummary(txBody) {
  const paragraphs = elements(txBody, 'p').map(paragraphText).map((line) => line.replace(/\r/gu, ''));
  let fontPt = null;
  let bold = false;
  for (const paragraph of elements(txBody, 'p')) {
    const pPr = firstElement(paragraph, 'pPr');
    const endPara = firstElement(paragraph, 'endParaRPr');
    const candidates = [
      pPr ? firstElement(pPr, 'defRPr') : null,
      ...elements(paragraph, 'r').map((run) => firstElement(run, 'rPr')),
      ...elements(paragraph, 'fld').map((field) => firstElement(field, 'rPr')),
      endPara,
    ].filter(Boolean);
    for (const candidate of candidates) {
      const size = runFontSize(candidate);
      if (size !== null && (fontPt === null || size > fontPt)) fontPt = size;
      if (attrByName(candidate, 'b') === '1') bold = true;
    }
  }
  return { paragraphs, text: paragraphs.join('\n').trim(), fontPt, bold };
}

/** 形状的几何（EMU）。graphicFrame 用 p:xfrm，其余用 p:spPr/a:xfrm。 */
function shapeFrame(node) {
  const direct = firstElement(node, 'xfrm');
  const spPr = firstElement(node, 'spPr') ?? firstElement(node, 'grpSpPr');
  const xfrm = direct ?? (spPr ? firstElement(spPr, 'xfrm') : null);
  if (!xfrm) return null;
  const off = firstElement(xfrm, 'off');
  const ext = firstElement(xfrm, 'ext');
  const read = (holder, key) => {
    const value = holder ? Number(attrByName(holder, key)) : Number.NaN;
    return Number.isFinite(value) ? value : null;
  };
  return { x: read(off, 'x'), y: read(off, 'y'), cx: read(ext, 'cx'), cy: read(ext, 'cy') };
}

function placeholderOf(node) {
  const holder = firstElement(node, 'nvSpPr') ?? firstElement(node, 'nvPicPr') ?? firstElement(node, 'nvGraphicFramePr') ?? firstElement(node, 'nvGrpSpPr');
  const nvPr = holder ? firstElement(holder, 'nvPr') : null;
  const ph = nvPr ? firstElement(nvPr, 'ph') : null;
  return ph ? { type: attrByName(ph, 'type') ?? 'body', idx: attrByName(ph, 'idx') ?? null } : null;
}

function shapeName(node) {
  for (const holderName of ['nvSpPr', 'nvPicPr', 'nvGraphicFramePr', 'nvGrpSpPr']) {
    const holder = firstElement(node, holderName);
    const cNvPr = holder ? firstElement(holder, 'cNvPr') : null;
    if (cNvPr) return attrByName(cNvPr, 'name') ?? null;
  }
  return null;
}

/** 递归收集一组形状（含嵌套 p:grpSp 内的），保持文档顺序。 */
function collectShapes(container, out = []) {
  if (!container) return out;
  for (const child of container.children) {
    if (child.local === 'sp' || child.local === 'pic' || child.local === 'graphicFrame' || child.local === 'cxnSp' || child.local === 'contentPart') out.push(child);
    else if (child.local === 'grpSp') collectShapes(firstElement(child, 'spTree'), out);
  }
  return out;
}

function relationshipMap(xmlText) {
  const map = new Map();
  if (!xmlText) return map;
  const document = parseXmlDocument(xmlText);
  const root = documentRoot(document, 'Relationships');
  if (!root) return map;
  for (const relationship of elements(root, 'Relationship')) {
    const id = attrByName(relationship, 'Id');
    if (!id) continue;
    map.set(id, {
      id,
      type: attrByName(relationship, 'Type') ?? null,
      target: attrByName(relationship, 'Target') ?? null,
      external: attrByName(relationship, 'TargetMode') === 'External',
    });
  }
  return map;
}

/** 把 OPC 关系 Target 解析成 zip 内的部件名（相对 rels 所在目录，或包根绝对路径）。 */
function resolvePartPath(baseDirectory, target) {
  const raw = String(target ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('/')) return raw.replace(/^\/+/u, '');
  return posix.normalize(posix.join(baseDirectory, raw));
}

function relationshipParts(map, typeSuffix, baseDirectory) {
  const found = [];
  for (const relationship of map.values()) {
    if (relationship.external || !relationship.type || !relationship.type.endsWith(typeSuffix)) continue;
    const part = resolvePartPath(baseDirectory, relationship.target);
    if (part) found.push(part);
  }
  return found;
}

const EMU_PER_INCH = 914400;
const EMU_PER_CENTIMETER = 360000;

function lengthView(emu) {
  if (!Number.isFinite(emu)) return null;
  return {
    值EMU: emu,
    厘米: Math.round((emu / EMU_PER_CENTIMETER) * 100) / 100,
    英寸: Math.round((emu / EMU_PER_INCH) * 1000) / 1000,
  };
}

const SLIDE_SIZE_DECLARATIONS = new Map([['screen4x3', '4:3'], ['screen16x9', '16:9'], ['screen16x10', '16:10']]);

function slideSizeView(sldSz) {
  const cx = Number(attrByName(sldSz, 'cx'));
  const cy = Number(attrByName(sldSz, 'cy'));
  const declared = attrByName(sldSz, 'type') ?? null;
  const ratio = Number.isFinite(cx) && Number.isFinite(cy) && cx > 0 && cy > 0 ? cx / cy : null;
  let ratioLabel = declared && SLIDE_SIZE_DECLARATIONS.has(declared) ? SLIDE_SIZE_DECLARATIONS.get(declared) : null;
  let ratioSource = ratioLabel ? 'declared' : null;
  if (!ratioLabel && ratio) {
    const nearest = [
      { label: '16:9', value: 16 / 9 }, { label: '4:3', value: 4 / 3 }, { label: '16:10', value: 16 / 10 },
    ].reduce((best, item) => (Math.abs(item.value - ratio) < Math.abs(best.value - ratio) ? item : best));
    if (Math.abs(nearest.value - ratio) < 0.01) { ratioLabel = nearest.label; ratioSource = 'derived-from-cx-cy'; }
  }
  return {
    ...(Number.isFinite(cx) ? { 宽: lengthView(cx) } : {}),
    ...(Number.isFinite(cy) ? { 高: lengthView(cy) } : {}),
    ...(Number.isFinite(cx) ? { 宽EMU: cx } : {}),
    ...(Number.isFinite(cy) ? { 高EMU: cy } : {}),
    宽高比: ratioLabel ?? '未知',
    宽高比来源: ratioSource ?? 'cx/cy 比例不匹配常见版面',
    声明类型: declared,
  };
}

const PLACEHOLDER_ROLES = new Map([
  ['title', '标题'], ['ctrTitle', '标题'], ['subTitle', '副标题'],
  ['body', '正文'], ['obj', '正文'], ['txt', '正文'],
  ['sldNum', '页码'], ['sldImg', '幻灯片图像占位'], ['pic', '图片占位'],
  ['tbl', '表格占位'], ['chart', '图表占位'], ['dgm', 'SmartArt 图示占位'],
  ['media', '媒体占位'], ['clipArt', '剪贴画占位'], ['dt', '日期'], ['ftr', '页脚'], ['hdr', '页眉'],
]);

/**
 * 只读检查时对「标题 / 正文」的判定。pptxgenjs 与多数导出器都不写 p:ph，
 * 所以占位符类型优先；没有占位符时用「位置最靠上 + 字号/加粗更突出」这一条
 * 确定性规则推定，并把判定依据写进 `角色判定`，绝不假装是文件自带的事实。
 */
function classifyTextShapes(shapes, slideHeightEmu) {
  const candidates = shapes.filter((shape) => shape.role == null && shape.text);
  const positioned = candidates.filter((shape) => Number.isFinite(shape.frame?.y));
  const top = positioned.length ? positioned.reduce((best, shape) => (shape.frame.y < best.frame.y ? shape : best)) : null;
  const fonts = candidates.map((shape) => shape.fontPt).filter((value) => typeof value === 'number').sort((a, b) => b - a);
  const largest = fonts.length ? fonts[0] : null;
  const second = fonts.length > 1 ? fonts[1] : null;
  const sizeOutranks = largest === null ? null : second === null ? true : largest >= second * 1.15;
  const othersBold = top ? candidates.some((shape) => shape !== top && shape.bold) : true;
  const boldOutranks = top?.bold === true && !othersBold;
  const topRegion = top && Number.isFinite(slideHeightEmu) && slideHeightEmu > 0 ? top.frame.y <= slideHeightEmu * 0.55 : true;
  const titleShape = top && topRegion && (sizeOutranks === true || boldOutranks) ? top : null;
  for (const shape of candidates) {
    if (shape === titleShape) {
      shape.role = '标题';
      shape.roleBasis = '推定：无占位符类型，位置最靠上且字号或加粗比其余文字更突出';
      continue;
    }
    const nearBottom = Number.isFinite(slideHeightEmu) && slideHeightEmu > 0 && Number.isFinite(shape.frame?.y) && shape.frame.y >= slideHeightEmu * 0.9;
    // 页脚/来源注脚的字号下限已提到 11pt（对齐投影可读性规范），
    // 所以这里的"小字"阈值跟着放宽到 12pt，否则 11pt 的页脚会被误判成正文。
    const small = shape.fontPt === null || shape.fontPt <= 12;
    if (nearBottom && small) {
      shape.role = '页脚或来源';
      shape.roleBasis = '推定：位于页面底部 10% 且字号不大于 12 磅';
    } else {
      shape.role = '正文';
      shape.roleBasis = '推定：无占位符类型的普通文本框，既非顶部标题也非底部小字';
    }
  }
}

function placeholderRole(placeholder) {
  if (!placeholder) return null;
  const mapped = PLACEHOLDER_ROLES.get(placeholder.type);
  return mapped ? { role: mapped, basis: `占位符类型 ${placeholder.type}` } : { role: `占位符（${placeholder.type}）`, basis: `占位符类型 ${placeholder.type}` };
}

const CHART_TYPE_LABELS = new Map([
  ['barChart', '柱状图'], ['bar3DChart', '三维柱状图'], ['lineChart', '折线图'],
  ['line3DChart', '三维折线图'], ['pieChart', '饼图'], ['pie3DChart', '三维饼图'],
  ['doughnutChart', '圆环图'], ['areaChart', '面积图'], ['area3DChart', '三维面积图'],
  ['scatterChart', '散点图'], ['radarChart', '雷达图'], ['bubbleChart', '气泡图'],
  ['stockChart', '股价图'], ['surfaceChart', '曲面图'], ['surface3DChart', '三维曲面图'],
  ['ofPieChart', '复合饼图'],
]);

function chartSummaryFromXml(chartXmlText) {
  if (!chartXmlText) return { type: null, label: null, title: null };
  let document;
  try {
    document = parseXmlDocument(chartXmlText);
  } catch {
    return { type: null, label: null, title: null };
  }
  const chartSpace = firstElement(document, 'chartSpace') ?? document.children[0] ?? null;
  const chart = chartSpace ? firstElement(chartSpace, 'chart') : null;
  if (!chart) return { type: null, label: null, title: null };
  const plotArea = firstElement(chart, 'plotArea');
  const plot = plotArea ? plotArea.children.find((child) => /Chart$/u.test(child.local)) ?? null : null;
  const titleHolder = firstElement(chart, 'title');
  const title = titleHolder ? collectText(titleHolder).trim() : '';
  return {
    type: plot?.local ?? null,
    label: plot ? CHART_TYPE_LABELS.get(plot.local) ?? plot.local : null,
    title: title || null,
  };
}

function tableSummary(graphicData) {
  const tbl = graphicData ? firstElement(graphicData, 'tbl') : null;
  if (!tbl) return null;
  const rows = elements(tbl, 'tr');
  const grid = firstElement(tbl, 'tblGrid');
  const firstRow = rows.length
    ? elements(rows[0], 'tc').map((cell) => {
      const txBody = firstElement(cell, 'txBody');
      return txBody ? elements(txBody, 'p').map(paragraphText).join('\n').trim() : '';
    })
    : [];
  return {
    行数: rows.length,
    列数: grid ? elements(grid, 'gridCol').length : null,
    首行: firstRow,
  };
}

function graphicFrameSummary(graphicFrame) {
  const graphic = firstElement(graphicFrame, 'graphic');
  const graphicData = graphic ? firstElement(graphic, 'graphicData') : null;
  const uri = attrByName(graphicData, 'uri') ?? '';
  if (uri.endsWith('/table')) {
    const table = tableSummary(graphicData);
    return table ? { kind: 'table', table } : null;
  }
  if (uri.endsWith('/chart')) {
    const chart = graphicData ? firstElement(graphicData, 'chart') : null;
    const relationshipId = chart ? attrNs(chart, 'r', 'id') ?? attrLocal(chart, 'id') : null;
    return { kind: 'chart', relationshipId: relationshipId ?? null };
  }
  return { kind: 'other', uri };
}

async function zipPartText(archive, partName, { required = false } = {}) {
  const entry = archive.file(partName);
  if (!entry || entry.dir) {
    if (required) throw failure('PPTX_DAMAGED', `PPTX 缺少必需部件 ${partName}，无法读取。`);
    return null;
  }
  const declared = Number(entry._data?.uncompressedSize);
  if (Number.isFinite(declared) && declared > MAX_INSPECT_PART_BYTES) {
    throw failure('PPTX_TOO_LARGE', `PPTX 部件 ${partName} 解压后约 ${declared} 字节，超过单部件上限 ${MAX_INSPECT_PART_BYTES} 字节，已拒绝解析。`);
  }
  const content = await entry.async('string');
  if (content.length > MAX_INSPECT_PART_BYTES) {
    throw failure('PPTX_TOO_LARGE', `PPTX 部件 ${partName} 解压后 ${content.length} 字节，超过单部件上限 ${MAX_INSPECT_PART_BYTES} 字节，已拒绝解析。`);
  }
  return content;
}

const DIFFERENT_OFFICE_KINDS = [
  { match: 'wordprocessingml.', label: 'Word 文档（.docx）', marker: 'word/document.xml' },
  { match: 'spreadsheetml.', label: 'Excel 工作簿（.xlsx）', marker: 'xl/workbook.xml' },
  { match: 'presentationml.slideshow.', label: 'PowerPoint 放映（.ppsx）', marker: 'ppt/presentation.xml' },
];

/**
 * 读 [Content_Types].xml 判定真实文档类型；用于把改名文件说清楚。
 * @returns {{presentation: boolean, label: string|null, partName: string|null}}
 */
function detectMainDocumentKind(contentTypesText, archive) {
  let detected = null;
  if (contentTypesText) {
    const document = parseXmlDocument(contentTypesText);
    const root = documentRoot(document, 'Types') ?? document.children[0] ?? null;
    for (const override of elements(root, 'Override')) {
      const contentType = attrByName(override, 'ContentType') ?? '';
      const partName = attrByName(override, 'PartName') ?? '';
      // .pptx 与 .ppsx 是同一套 OOXML 结构，都按 PowerPoint 演示文稿处理。
      if (contentType.includes('presentationml.presentation.main+xml')) return { presentation: true, label: 'PowerPoint 演示文稿（.pptx）', partName };
      if (contentType.includes('presentationml.slideshow.main+xml')) return { presentation: true, label: 'PowerPoint 放映（.ppsx）', partName };
      for (const candidate of DIFFERENT_OFFICE_KINDS) {
        if (contentType.includes(candidate.match) && !detected) detected = { presentation: false, label: candidate.label, partName, marker: candidate.marker };
      }
    }
  }
  if (detected && archive.file(detected.marker)) return detected;
  // 主部件没声明时，用包内特征部件兜底，仍然明确说清楚是什么。
  if (archive.file('word/document.xml')) return { presentation: false, label: 'Word 文档（.docx）', partName: 'word/document.xml', marker: 'word/document.xml' };
  if (archive.file('xl/workbook.xml')) return { presentation: false, label: 'Excel 工作簿（.xlsx）', partName: 'xl/workbook.xml', marker: 'xl/workbook.xml' };
  return { presentation: false, label: null, partName: null, marker: null };
}

/** 从 docProps 的根元素（cp:coreProperties / Properties）里取一个属性文本。 */
function documentPropertyText(document, localName) {
  const root = document.children[0] ?? null;
  if (!root) return null;
  for (const child of root.children) {
    if (child.local === localName) return collectText(child).trim() || null;
  }
  return null;
}

function readCoreProperties(coreText) {
  if (!coreText) return {};
  const document = parseXmlDocument(coreText);
  return {
    标题: documentPropertyText(document, 'title'),
    主题: documentPropertyText(document, 'subject'),
    创建者: documentPropertyText(document, 'creator'),
    最后修改者: documentPropertyText(document, 'lastModifiedBy'),
    创建时间: documentPropertyText(document, 'created'),
    修改时间: documentPropertyText(document, 'modified'),
    修订: documentPropertyText(document, 'revision'),
    关键词: documentPropertyText(document, 'keywords'),
  };
}

function readAppProperties(appText) {
  if (!appText) return {};
  const document = parseXmlDocument(appText);
  const number = (localName) => {
    const raw = documentPropertyText(document, localName);
    return raw === null || raw === '' ? null : Number(raw);
  };
  return {
    生成程序: documentPropertyText(document, 'Application'),
    应用版本: documentPropertyText(document, 'AppVersion'),
    演示文稿格式: documentPropertyText(document, 'PresentationFormat'),
    声明页数: number('Slides'),
    声明备注页数: number('Notes'),
    声明隐藏页数: number('HiddenSlides'),
    公司: documentPropertyText(document, 'Company'),
  };
}

function mediaExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

async function inspectSlide(archive, { order, partName, slideSize, rels, relsBase, signal }) {
  if (signal?.aborted) throw failure('ABORTED', 'PPTX 只读检查已被取消');
  const slideText = await zipPartText(archive, partName, { required: true });
  let slideDocument;
  try {
    slideDocument = parseXmlDocument(slideText);
  } catch (error) {
    if (error instanceof MochiPresentationsError && error.code === 'XML_INVALID') {
      throw failure('PPTX_DAMAGED', `幻灯片 ${partName} 不是合法 XML，无法读取结构。`);
    }
    throw error;
  }
  const slideRoot = documentRoot(slideDocument, 'sld');
  if (!slideRoot) throw failure('PPTX_DAMAGED', `幻灯片 ${partName} 缺少 p:sld 根节点。`);
  const cSld = firstElement(slideRoot, 'cSld');
  const slideName = attrByName(cSld, 'name') ?? null;
  const hidden = attrByName(slideRoot, 'show') === '0';

  const shapes = collectShapes(cSld ? firstElement(cSld, 'spTree') : null);
  const textShapes = [];
  const pictures = [];
  const charts = [];
  const tables = [];
  const otherGraphics = [];
  const unsupported = [];

  for (const shape of shapes) {
    if (shape.local === 'sp' || shape.local === 'cxnSp' || shape.local === 'contentPart') {
      const txBody = firstElement(shape, 'txBody');
      if (!txBody) continue;
      const summary = textBodySummary(txBody);
      const placeholder = placeholderOf(shape);
      const mapped = placeholderRole(placeholder);
      textShapes.push({
        shapeName: shapeName(shape),
        placeholderType: placeholder?.type ?? null,
        role: mapped?.role ?? null,
        roleBasis: mapped?.basis ?? null,
        text: summary.text,
        paragraphs: summary.paragraphs,
        fontPt: summary.fontPt,
        bold: summary.bold,
        frame: shapeFrame(shape),
      });
      continue;
    }
    if (shape.local === 'pic') {
      const blipFill = firstElement(shape, 'blipFill');
      const blip = blipFill ? childPath(blipFill, ['blip']) : null;
      const embedId = blip ? attrNs(blip, 'r', 'embed') ?? attrLocal(blip, 'embed') : null;
      const relationship = embedId ? rels.get(embedId) : null;
      const target = relationship ? resolvePartPath(relsBase, relationship.target) : null;
      pictures.push({
        shapeName: shapeName(shape),
        placeholderType: placeholderOf(shape)?.type ?? null,
        部件: target,
        扩展名: target ? mediaExtension(target) : null,
        链接: relationship?.external === true,
        frame: shapeFrame(shape),
      });
      continue;
    }
    if (shape.local === 'graphicFrame') {
      const summary = graphicFrameSummary(shape);
      if (!summary) { unsupported.push({ shapeName: shapeName(shape), 原因: '无法识别的 p:graphicFrame' }); continue; }
      if (summary.kind === 'table') {
        tables.push({ shapeName: shapeName(shape), ...summary.table, frame: shapeFrame(shape) });
      } else if (summary.kind === 'chart') {
        const relationship = summary.relationshipId ? rels.get(summary.relationshipId) : null;
        const chartPart = relationship ? resolvePartPath(relsBase, relationship.target) : null;
        const chartXml = chartPart ? await zipPartText(archive, chartPart) : null;
        const chart = chartSummaryFromXml(chartXml);
        charts.push({
          shapeName: shapeName(shape),
          部件: chartPart,
          存在: Boolean(chartXml),
          类型: chart.type,
          类型名称: chart.label,
          图表标题: chart.title,
          frame: shapeFrame(shape),
        });
      } else {
        otherGraphics.push({ shapeName: shapeName(shape), uri: summary.uri });
      }
    }
  }

  classifyTextShapes(textShapes, slideSize.heightEmu);

  let notes = null;
  let notesPart = null;
  const notesParts = relationshipParts(rels, '/notesSlide', relsBase);
  if (notesParts.length) {
    notesPart = notesParts[0];
    const notesXml = await zipPartText(archive, notesPart);
    if (notesXml) {
      try {
        const notesDocument = parseXmlDocument(notesXml);
        const notesRoot = documentRoot(notesDocument, 'notes');
        const notesCld = notesRoot ? firstElement(notesRoot, 'cSld') : null;
        const collected = [];
        for (const shape of collectShapes(notesCld ? firstElement(notesCld, 'spTree') : null)) {
          const placeholder = placeholderOf(shape);
          if (placeholder?.type === 'sldNum' || placeholder?.type === 'sldImg') continue;
          const txBody = firstElement(shape, 'txBody');
          if (!txBody) continue;
          const summary = textBodySummary(txBody);
          if (summary.text) collected.push(summary.text);
        }
        if (collected.length) notes = collected.join('\n\n');
      } catch {
        notes = null;
      }
    }
  }

  const warnings = [];
  if (!slideName) warnings.push('幻灯片没有 p:cSld@name。');
  if (unsupported.length) warnings.push(`存在 ${unsupported.length} 个无法识别的 graphicFrame。`);
  if (textShapes.length === 0) warnings.push('本页没有任何可读文字。');

  const textLength = textShapes.reduce((total, shape) => total + shape.text.length, 0);
  return {
    序号: order,
    部件: partName,
    名称: slideName,
    隐藏: hidden,
    尺寸EMU: { 宽: slideSize.widthEmu ?? null, 高: slideSize.heightEmu ?? null },
    文字总量: textLength,
    文字: textShapes.map((shape) => ({
      形状名: shape.shapeName,
      占位符类型: shape.placeholderType,
      角色: shape.role,
      角色判定: shape.roleBasis,
      字号: shape.fontPt,
      加粗: shape.bold,
      段落: shape.paragraphs,
      文字: shape.text,
      位置EMU: shape.frame ? { x: shape.frame.x, y: shape.frame.y, cx: shape.frame.cx, cy: shape.frame.cy } : null,
    })).filter((shape) => shape.文字),
    图片: { 数量: pictures.length, 条目: pictures.map((item) => ({ 形状名: item.shapeName, 部件: item.部件, 扩展名: item.扩展名, 外部链接: item.链接 })) },
    图表: { 数量: charts.length, 条目: charts.map((item) => ({ 形状名: item.shapeName, 部件: item.部件, 类型: item.类型, 类型名称: item.类型名称, 图表标题: item.图表标题 })) },
    表格: { 数量: tables.length, 条目: tables.map((item) => ({ 形状名: item.shapeName, 行数: item.行数, 列数: item.列数, 首行: item.首行 })) },
    其他图形对象: otherGraphics,
    备注页部件: notesPart,
    备注: notes,
    ...(warnings.length ? { 警告: warnings } : {}),
  };
}

async function readSlideLayoutNames(archive, rels, relsBase) {
  const layoutParts = relationshipParts(rels, '/slideLayout', relsBase);
  if (!layoutParts.length) return { 名称: null, 类型: null, 部件: null, 找不到: false };
  const layoutPart = layoutParts[0];
  const layoutXml = await zipPartText(archive, layoutPart);
  if (!layoutXml) return { 名称: null, 类型: null, 部件: layoutPart, 找不到: true };
  try {
    const document = parseXmlDocument(layoutXml);
    const layout = documentRoot(document, 'sldLayout');
    if (!layout) return { 名称: null, 类型: null, 部件: layoutPart, 找不到: true };
    const cSld = firstElement(layout, 'cSld');
    return {
      名称: attrByName(cSld, 'name') ?? null,
      类型: attrByName(layout, 'type') ?? null,
      部件: layoutPart,
      找不到: false,
    };
  } catch {
    return { 名称: null, 类型: null, 部件: layoutPart, 找不到: true };
  }
}

function normalizeInspectLimits(limits) {
  const positive = (value, fallback) => (Number.isSafeInteger(value) && value > 0 ? value : fallback);
  return {
    maxBytes: positive(limits?.maxBytes, MAX_INSPECT_BYTES),
    maxSlides: positive(limits?.maxSlides, MAX_INSPECT_SLIDES),
  };
}

/**
 * 只读检查一个 pptx 的字节内容（纯函数，不碰磁盘）。
 * @param {Buffer|Uint8Array} bytes
 * @param {{sourceName?:string, fileMeta?:object, limits?:object, slide?:number, signal?:AbortSignal}} options
 */
export async function inspectPptxBuffer(bytes, { sourceName = 'presentation.pptx', fileMeta = {}, limits, slide, signal } = {}) {
  if (signal?.aborted) throw failure('ABORTED', 'PPTX 只读检查已被取消');
  if (!bytes || typeof bytes.length !== 'number') throw failure('INVALID_INPUT', 'inspectPptxBuffer 需要一个字节缓冲区');
  const bound = normalizeInspectLimits(limits);
  const totalBytes = bytes.length;
  if (totalBytes === 0) throw failure('PPTX_NOT_ZIP', `${sourceName} 是 0 字节空文件，不是 PowerPoint 文件。`);
  if (totalBytes > bound.maxBytes) {
    throw failure('PPTX_TOO_LARGE', `${sourceName} 共 ${totalBytes} 字节，超过只读检查上限 ${bound.maxBytes} 字节；已拒绝解包。请先在 PowerPoint 中精简图片后重试，或改用 mochi_ppt_revise 的 source.json 通道。`);
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const signature = buffer.subarray(0, 2).toString('latin1');
  if (signature !== 'PK') {
    throw failure('PPTX_NOT_ZIP', `${sourceName} 的开头不是 ZIP 签名（PK），只是扩展名是 .pptx，实际不是 PowerPoint 文件。`);
  }

  let archive;
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: false });
  } catch (error) {
    throw failure('PPTX_NOT_ZIP', `${sourceName} 无法作为 ZIP 容器打开（${error?.message ?? 'ZIP 结构损坏'}），不是合法的 .pptx。`);
  }

  const contentTypesText = await zipPartText(archive, '[Content_Types].xml');
  const kind = detectMainDocumentKind(contentTypesText, archive);
  if (kind.label && !kind.presentation) {
    throw failure('PPTX_NOT_PRESENTATION', `${sourceName} 不是 PowerPoint 演示文稿，而是${kind.label}（主部件 ${kind.partName}）。改名成 .pptx 不会改变文件类型，请用对应文档工具打开。`);
  }
  const presentationText = await zipPartText(archive, 'ppt/presentation.xml');
  if (!presentationText) {
    throw failure('PPTX_NOT_PRESENTATION', `${sourceName} 内没有 ppt/presentation.xml，不是合法的 PowerPoint 演示文稿（不是“0 张幻灯片”，而是根本读不到演示文稿部件）。`);
  }

  let presentation;
  try {
    presentation = parseXmlDocument(presentationText);
  } catch {
    throw failure('PPTX_DAMAGED', `${sourceName} 的 ppt/presentation.xml 不是合法 XML，无法读取。`);
  }
  const presentationRoot = documentRoot(presentation, 'presentation');
  if (!presentationRoot) throw failure('PPTX_DAMAGED', `${sourceName} 的 ppt/presentation.xml 缺少 p:presentation 根节点。`);

  const sldSz = firstElement(presentationRoot, 'sldSz');
  const sizeView = slideSizeView(sldSz);
  const slideSize = { widthEmu: sizeView.宽EMU ?? null, heightEmu: sizeView.高EMU ?? null };

  const presentationRels = relationshipMap(await zipPartText(archive, 'ppt/_rels/presentation.xml.rels'));
  const sldIdLst = firstElement(presentationRoot, 'sldIdLst');
  const declaredOrder = [];
  for (const sldId of elements(sldIdLst, 'sldId')) {
    const relationshipId = attrNs(sldId, 'r', 'id') ?? attrLocal(sldId, 'id');
    const relationship = relationshipId ? presentationRels.get(relationshipId) : null;
    const part = relationship ? resolvePartPath('ppt', relationship.target) : null;
    if (part) declaredOrder.push(part);
  }

  const warnings = [];
  if (!sldSz) warnings.push('演示文稿没有声明 p:sldSz，幻灯片尺寸未知。');
  let order = declaredOrder;
  if (!order.length) {
    const scanned = Object.keys(archive.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
      .sort((left, right) => Number(left.match(/(\d+)\.xml$/u)[1]) - Number(right.match(/(\d+)\.xml$/u)[1]));
    if (scanned.length) {
      warnings.push('演示文稿的 p:sldIdLst 没有声明任何幻灯片，已按 ppt/slides/slideN.xml 文件序号兜底排序。');
      order = scanned;
    }
  }

  if (order.length === 0) {
    if (!archive.file('ppt/slides/slide1.xml')) {
      throw failure('PPTX_NOT_PRESENTATION', `${sourceName} 内没有任何幻灯片部件，也不是 PowerPoint 演示文稿结构。这不是“0 张幻灯片”的课件。`);
    }
    throw failure('PPTX_DAMAGED', `${sourceName} 有幻灯片部件但无法通过关系解析出顺序。`);
  }
  if (order.length > bound.maxSlides) {
    throw failure('PPTX_TOO_MANY_SLIDES', `${sourceName} 共 ${order.length} 页，超过只读检查上限 ${bound.maxSlides} 页；已拒绝逐页解析。请先用 PowerPoint 拆分课件后重试。`);
  }

  const requestedSlide = slide === undefined || slide === null ? null : Number(slide);
  if (requestedSlide !== null && (!Number.isSafeInteger(requestedSlide) || requestedSlide < 1 || requestedSlide > order.length)) {
    throw failure('INVALID_INPUT', `slide 必须是 1-${order.length} 之间的整数页码。`);
  }

  const slides = [];
  for (const [index, partName] of order.entries()) {
    if (signal?.aborted) throw failure('ABORTED', 'PPTX 只读检查已被取消');
    if (requestedSlide !== null && index + 1 !== requestedSlide) continue;
    const relsBase = posix.dirname(partName);
    const relsPart = posix.join(relsBase, '_rels', posix.basename(partName) + '.rels');
    const rels = relationshipMap(await zipPartText(archive, relsPart));
    const inspected = await inspectSlide(archive, { order: index + 1, partName, slideSize, rels, relsBase, signal });
    inspected.版式 = await readSlideLayoutNames(archive, rels, relsBase);
    slides.push(inspected);
  }

  const mediaEntries = Object.entries(archive.files)
    .filter(([name, entry]) => name.startsWith('ppt/media/') && !entry.dir)
    .map(([name, entry]) => {
      const declared = Number(entry._data?.uncompressedSize);
      return { 名称: name, 扩展名: mediaExtension(name), 解压字节: Number.isFinite(declared) ? declared : null };
    });

  const coreProperties = readCoreProperties(await zipPartText(archive, 'docProps/core.xml'));
  const appProperties = readAppProperties(await zipPartText(archive, 'docProps/app.xml'));
  const report = {
    tool: 'ppt_inspect',
    完成: true,
    文件: {
      名称: basename(sourceName),
      格式: 'pptx',
      真pptx: true,
      主部件: 'ppt/presentation.xml',
      内容类型: kind.label ?? 'PowerPoint 演示文稿（.pptx）',
      大小字节: totalBytes,
      大小说明: `${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
      ...(fileMeta.modifiedAt ? { 修改时间: fileMeta.modifiedAt } : {}),
      ...(fileMeta.createdAt ? { 创建时间: fileMeta.createdAt } : {}),
      ...(fileMeta.sha256 ? { sha256: fileMeta.sha256 } : {}),
    },
    页数: order.length,
    检查页数: slides.length,
    幻灯片尺寸: sizeView,
    文档元数据: {
      ...coreProperties,
      ...appProperties,
      页数声明一致: appProperties.声明页数 === null ? null : appProperties.声明页数 === order.length,
    },
    总文字量: slides.reduce((total, item) => total + item.文字总量, 0),
    媒体文件: {
      数量: mediaEntries.length,
      条目: mediaEntries.slice(0, MAX_INSPECT_MEDIA_LIST),
      ...(mediaEntries.length > MAX_INSPECT_MEDIA_LIST ? { 已截断: true, 未列出: mediaEntries.length - MAX_INSPECT_MEDIA_LIST } : {}),
    },
    幻灯片: slides,
    上限: { 文件大小字节: bound.maxBytes, 页数: bound.maxSlides, 是否超限: false },
    ...(warnings.length ? { 警告: warnings } : {}),
    说明: '以上结构全部来自 ppt/slides/*.xml 等真实 OOXML 部件解析。pptxgenjs 与多数导出器不写 p:ph 占位符类型，因此「角色」在没有占位符时是按位置与字号推定的，判定依据见「角色判定」；请以「占位符类型」为准。',
  };
  if (requestedSlide !== null) report.仅检查页 = requestedSlide;
  return report;
}

async function statOrNullInspect(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

/**
 * 从磁盘只读加载并检查一个 .pptx。调用方必须已经做过路径允许根校验。
 * @param {{path:string, limits?:object, slide?:number, signal?:AbortSignal}} options
 */
export async function inspectPresentationFile({ path, limits, slide, signal } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw failure('INVALID_INPUT', 'inspectPresentationFile 需要绝对路径');
  if (signal?.aborted) throw failure('ABORTED', 'PPTX 只读检查已被取消');
  const info = await statOrNullInspect(path);
  if (!info) throw failure('PPTX_NOT_FOUND', `找不到文件：${path}`);
  if (info.isDirectory()) throw failure('INVALID_INPUT', `${path} 是目录，不是 .pptx 文件。`);
  if (info.isSymbolicLink()) throw failure('PATH_UNSAFE', `${path} 是符号链接，只读检查拒绝跟随。`);
  if (!info.isFile()) throw failure('INVALID_INPUT', `${path} 不是普通文件。`);
  const bound = normalizeInspectLimits(limits);
  if (info.size > bound.maxBytes) {
    throw failure('PPTX_TOO_LARGE', `${basename(path)} 共 ${info.size} 字节，超过只读检查上限 ${bound.maxBytes} 字节；已拒绝读取。请先精简课件或提高上限。`);
  }
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw failure('PPTX_UNREADABLE', `读取失败：${path}（${error?.code ?? '未知错误'}）`);
  }
  const report = await inspectPptxBuffer(bytes, {
    sourceName: path,
    fileMeta: {
      modifiedAt: info.mtime?.toISOString?.() ?? null,
      createdAt: info.birthtime?.toISOString?.() ?? null,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    limits,
    slide,
    signal,
  });
  report.文件.路径 = path;
  return report;
}

// ── 允许根与路径守卫（照 mochi-files/paths.mjs 的口径，只读分支） ─────────────
// 允许根来源优先级：apply 的 options.allowedRoots → MOCHI_PRESENTATIONS_ROOTS →
// 当前会话工作区。绝不默认放开主目录，也永远拒绝把文件系统根设为允许根。

export function isDescendantPath(parent, candidate) {
  const difference = relative(parent, candidate);
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference));
}

export function parseRootList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text.split(PATH_DELIMITER).map((entry) => entry.trim()).filter(Boolean);
}

async function realpathOrNull(target) {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}

async function ordinaryDirectory(target, label) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw failure('ROOT_UNAVAILABLE', `${label}不存在：${target}`);
    throw failure('ROOT_UNAVAILABLE', `${label}不可访问（${error?.code ?? '未知错误'}）：${target}`);
  }
  if (info.isSymbolicLink()) throw failure('ROOT_UNSAFE', `${label}是符号链接，不是普通目录：${target}`);
  if (!info.isDirectory()) throw failure('ROOT_UNSAFE', `${label}不是目录：${target}`);
}

async function canonicalInspectRoots(candidates, { label, env = process.env } = {}) {
  const entries = [];
  const skipped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const logical = resolve(candidate);
    if (parsePath(logical).root === logical) {
      skipped.push({ path: logical, reason: '拒绝把文件系统根目录设为允许根' });
      continue;
    }
    if (env.HOME) {
      const home = await realpathOrNull(env.HOME);
      const realCandidate = await realpathOrNull(logical);
      if (home && realCandidate === home) {
        skipped.push({ path: logical, reason: '默认不开放整个用户主目录，请指定主目录下的具体文件夹' });
        continue;
      }
    }
    try {
      await ordinaryDirectory(logical, label);
    } catch (error) {
      skipped.push({ path: logical, reason: error?.message ?? '不可用' });
      continue;
    }
    const real = await realpathOrNull(logical);
    if (!real || seen.has(real)) {
      if (!real) skipped.push({ path: logical, reason: '无法解析真实路径' });
      continue;
    }
    seen.add(real);
    entries.push({ logical, real });
  }
  return { entries, skipped };
}

function sessionWorkspace(ctx, exec) {
  const session = exec?.agent?.session;
  let policy = null;
  try {
    policy = ctx?.sandboxPolicy?.resolve?.({ session });
  } catch { /* 策略不可用时仍可做路径根校验。 */ }
  const fromPolicy = typeof policy?.workspaceRoot === 'string' && isAbsolute(policy.workspaceRoot) ? policy.workspaceRoot : null;
  const fromSession = typeof session?.header?.cwd === 'string' && isAbsolute(session.header.cwd) ? session.header.cwd : null;
  const root = fromPolicy || fromSession;
  return root ? { root, readOnly: policy?.mode === 'read-only' } : null;
}

/**
 * 老师**上传**的课件落在哪里？（与 mochi-documents / mochi-sheets 同一口径，2026-09-12）
 *
 * 宿主把上传原件按 verbatim 原样存到 `<DSH_HOME>/attachments/v1/files/<digest 前缀>/<digest>/<name>`，
 * 然后只给模型一句句柄文本要它"用自己的文件工具读那个路径"。这个位置**不在会话工作区里**，
 * 而 ppt_inspect 的允许根只认工作区，于是上传的 .pptx 打不开。
 *
 * 所以把附件盘作为**追加**根接进来（ppt_inspect 本身只读，不涉及输出落点）。
 * 刻意做成"追加"而不是"兜底"：没有任何主根时仍然照旧抛 WORKSPACE_UNAVAILABLE，
 * 不会因为恰好存在一个附件盘就凭空获得读取能力。
 */
async function attachmentInspectRoots(env = process.env) {
  const home = typeof env?.HOME === 'string' && isAbsolute(env.HOME) ? env.HOME : homedir();
  const candidates = [];
  for (const key of ['MOCHI_HOME', 'DSH_HOME']) {
    const value = env?.[key];
    if (typeof value === 'string' && value.trim().length > 0) candidates.push(value.trim());
  }
  candidates.push(join(home, '.mochi-home'), join(home, '.dsh'));
  const { entries, skipped } = await canonicalInspectRoots(
    candidates.map((candidate) => resolve(candidate, 'attachments', 'v1')),
    { label: '宿主附件盘', env },
  );
  return { entries, skipped };
}

/** 主根 + 附件盘根，按 real 去重。附件盘不可用不算错误，静默跳过。 */
async function withAttachmentRoots(primary, env) {
  const extra = await attachmentInspectRoots(env);
  const seen = new Set(primary.entries.map((entry) => entry.real));
  const entries = [...primary.entries];
  for (const entry of extra.entries) {
    if (seen.has(entry.real)) continue;
    seen.add(entry.real);
    entries.push(entry);
  }
  return { ...primary, entries, rejected: [...primary.rejected, ...extra.skipped] };
}

/**
 * 决定本次 ppt_inspect 可读的根目录。
 * @returns {Promise<{entries:Array<{logical:string,real:string}>, source:string, rejected:Array}>}
 */
export async function resolveInspectAllowedRoots({ ctx = null, exec = null, options = {}, env = process.env } = {}) {
  const configured = parseRootList(options.allowedRoots);
  if (configured.length) {
    const { entries, skipped } = await canonicalInspectRoots(configured, { label: '允许根目录', env });
    if (!entries.length) throw failure('ROOT_UNAVAILABLE', `配置的允许根目录都不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    return withAttachmentRoots({ entries, source: 'configured', rejected: skipped }, env);
  }
  const fromEnv = parseRootList(env.MOCHI_PRESENTATIONS_ROOTS);
  if (fromEnv.length) {
    const { entries, skipped } = await canonicalInspectRoots(fromEnv, { label: 'MOCHI_PRESENTATIONS_ROOTS 允许根', env });
    if (!entries.length) throw failure('ROOT_UNAVAILABLE', `MOCHI_PRESENTATIONS_ROOTS 配置的目录都不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    return withAttachmentRoots({ entries, source: 'env:MOCHI_PRESENTATIONS_ROOTS', rejected: skipped }, env);
  }
  const session = sessionWorkspace(ctx, exec);
  if (session) {
    const { entries, skipped } = await canonicalInspectRoots([session.root], { label: '会话工作区', env });
    if (entries.length) return withAttachmentRoots({ entries, source: 'session-workspace', rejected: skipped }, env);
    throw failure('ROOT_UNAVAILABLE', `会话工作区不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
  }
  throw failure('WORKSPACE_UNAVAILABLE', '当前会话没有受管工作区，也没有配置允许根目录。为避免越权读取磁盘，ppt_inspect 拒绝在没有允许根时运行。');
}

export function createInspectPathGuard(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw failure('NO_ALLOWED_ROOT', '没有可用的允许根目录，ppt_inspect 拒绝运行。');
  const roots = entries.map((entry) => entry.real);
  const matchEntry = (candidate) => entries.find((entry) => isDescendantPath(entry.logical, candidate) || isDescendantPath(entry.real, candidate)) ?? null;
  return {
    roots,
    async resolve(input, { field = '路径' } = {}) {
      const raw = String(input ?? '').trim();
      if (!raw) throw failure('BAD_PATH', `${field}不能为空。`);
      if (raw.includes('\0')) throw failure('BAD_PATH', `${field}包含非法字符（NUL）。`);
      const primary = entries[0];
      const candidate = isAbsolute(raw) ? resolve(raw) : resolve(primary.logical, raw);
      const entry = matchEntry(candidate);
      if (!entry) throw failure('PATH_ESCAPE', `${field}“${raw}”越出允许的根目录（${roots.join('、')}），已拒绝。`, { attempted: candidate });
      let ancestor = candidate;
      let realAncestor = null;
      for (;;) {
        realAncestor = await realpathOrNull(ancestor);
        if (realAncestor) break;
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      if (!realAncestor) throw failure('PATH_UNAVAILABLE', `${field}所在目录不存在：${candidate}`, { attempted: candidate });
      if (!isDescendantPath(entry.real, realAncestor)) {
        throw failure('PATH_ESCAPE', `${field}“${candidate}”通过符号链接指向允许根之外（${realAncestor}），已拒绝。`, { attempted: candidate, resolvedTo: realAncestor });
      }
      return { path: candidate, realAncestor, entry };
    },
  };
}
