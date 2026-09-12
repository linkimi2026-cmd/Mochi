// mochi-visuals · 图表/示意图绘制（纯 SVG 生成，零依赖）。
//
// 设计原则：
//   * SVG 是唯一的几何数据源。PNG 由 SVG 光栅化而来（见 raster.mjs），
//     所以矢量图和位图的版式完全一致，不会出现“两个渲染器画得不一样”。
//   * 真的画坐标轴、刻度、网格线、图例、数据标签；柱状图不是一坨色块。
//   * 配色跟随 Mochi 的沉稳教学风：正文深灰 #2c2c2c、主色 #3F5B99，
//     其余为辅色，不使用高饱和荧光色。
//   * 文字宽度用码点估算（CJK 计 1 em，拉丁计 0.55 em），用于排版居中与换行，
//     不追求像素级精确，只保证不互相压字。
//
// 支持的 type：bar / line / pie / flowchart / relationship。

export const THEME = {
  background: '#ffffff',
  panel: '#f7f8fa',
  text: '#2c2c2c',
  muted: '#6b7280',
  grid: '#e3e6ec',
  axis: '#a7aeb8',
  border: '#cfd4dc',
  primary: '#3F5B99',
  palette: ['#3F5B99', '#C0705A', '#6D8F6B', '#B08A4F', '#7A6FA0', '#4E8CA8'],
  // 注意：这里刻意不以 -apple-system 打头。本机实测它不含简体汉字字形，
  // 放在首位会让中文变成方框；真正的字族由 fonts.mjs 逐字检测后传入。
  font: '"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
};

export const DIAGRAM_TYPES = ['bar', 'line', 'pie', 'flowchart', 'relationship'];

const DEFAULT_SIZE = {
  bar: { width: 760, height: 460 },
  line: { width: 760, height: 460 },
  pie: { width: 760, height: 440 },
  flowchart: { width: 760, height: 560 },
  relationship: { width: 760, height: 620 },
};

const MAX_CATEGORIES = 60;
const MAX_SERIES = 12;
const MAX_NODES = 400;
const MAX_EDGES = 800;

export class DiagramError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiagramError';
    this.code = code;
  }
}

function fail(code, message) {
  return new DiagramError(code, message);
}

// ── 通用工具 ────────────────────────────────────────────────────────────────

const CJK_PATTERN = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f\u3040-\u30ff]/u;

export function estimateTextWidth(input, fontSize, weight = 'normal') {
  const text = String(input ?? '');
  let units = 0;
  for (const character of text) {
    if (CJK_PATTERN.test(character)) units += 1;
    else if (character === ' ') units += 0.3;
    else units += 0.55;
  }
  return units * fontSize * (weight === 'bold' ? 1.03 : 1);
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 幂等：既可传原始数字，也可传已经过一次 num() 的字符串（调用点与 textEl 内都会调用它）。
function num(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0';
  return String(Math.round(parsed * 100) / 100);
}

function escapeAttribute(value) {
  return escapeXml(value).replace(/\n/g, ' ');
}

function el(tag, attributes, children) {
  const attrs = Object.entries(attributes ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join('');
  if (children === undefined) return `<${tag}${attrs}/>`;
  return `<${tag}${attrs}>${children}</${tag}>`;
}

// 当前渲染使用的中文字族链。由 renderDiagramSvg 在同步渲染前设定，
// 渲染完成后还原。SVG 生成是同步的，因此不存在并发交叉污染。
let activeFontFamily = THEME.font;

function textEl(content, { x, y, size = 13, fill = THEME.text, anchor = 'start', weight = 'normal', opacity, rotate }) {
  const transform = rotate ? ` transform="rotate(${num(rotate)} ${num(x)} ${num(y)})"` : '';
  // 注意：font-family 里带空格的字族名必须转义引号，否则整份 SVG 非法（曾导致光栅化失败）。
  return `<text x="${num(x)}" y="${num(y)}" font-family="${escapeAttribute(activeFontFamily)}" font-size="${num(size)}" fill="${escapeAttribute(fill)}" text-anchor="${escapeAttribute(anchor)}" font-weight="${escapeAttribute(weight)}"${opacity !== undefined ? ` opacity="${num(opacity)}"` : ''}${transform}>${escapeXml(content)}</text>`;
}

/** 视口宽度内的文本截断（按估算宽度，末尾补省略号）。 */
function truncate(input, maxWidth, fontSize, weight = 'normal') {
  const text = String(input ?? '');
  if (estimateTextWidth(text, fontSize, weight) <= maxWidth) return text;
  const ellipsis = '…';
  const ellipsisWidth = estimateTextWidth(ellipsis, fontSize, weight);
  let result = '';
  for (const character of text) {
    if (estimateTextWidth(result + character, fontSize, weight) + ellipsisWidth > maxWidth) break;
    result += character;
  }
  return result ? `${result}${ellipsis}` : ellipsis;
}

/** 在视口宽度内折行（最多 maxLines 行），仍放不下时在末行补省略号。 */
function wrapText(input, maxWidth, fontSize, weight = 'normal', maxLines = 2) {
  const text = String(input ?? '');
  if (estimateTextWidth(text, fontSize, weight) <= maxWidth) return [text];
  const lines = [];
  let current = '';
  for (const character of text) {
    if (current && estimateTextWidth(current + character, fontSize, weight) > maxWidth) {
      lines.push(current);
      current = character;
      if (lines.length === maxLines) break;
    } else {
      current += character;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  const remaining = [...text].slice(lines.join('').length);
  if (remaining.length > 0) {
    let last = lines[Math.min(lines.length, maxLines) - 1] ?? '';
    while (last && estimateTextWidth(`${last}…`, fontSize, weight) > maxWidth) last = last.slice(0, -1);
    lines[Math.min(lines.length, maxLines) - 1] = `${last}…`;
  }
  return lines.slice(0, maxLines);
}

function formatNumber(value, { unit = '', percent = false } = {}) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 1000) / 1000;
  let text;
  if (percent) {
    text = `${Math.round(value * 1000) / 10}%`;
  } else if (Number.isInteger(rounded)) {
    text = Math.abs(rounded) >= 10_000 ? rounded.toLocaleString('en-US') : String(rounded);
  } else {
    text = String(rounded);
  }
  return unit ? `${text}${unit}` : text;
}

/** 圆角矩形路径；只圆化给定角的半径。 */
function roundedRectPath(x, y, width, height, radius, corners = ['tl', 'tr', 'bl', 'br']) {
  const limit = Math.min(radius, width / 2, height / 2);
  if (!limit || limit <= 0) return `M ${num(x)} ${num(y)} h ${num(width)} v ${num(height)} h ${num(-width)} Z`;
  const tl = corners.includes('tl') ? limit : 0;
  const tr = corners.includes('tr') ? limit : 0;
  const br = corners.includes('br') ? limit : 0;
  const bl = corners.includes('bl') ? limit : 0;
  return [
    `M ${num(x + tl)} ${num(y)}`,
    `H ${num(x + width - tr)}`,
    tr ? `A ${num(tr)} ${num(tr)} 0 0 1 ${num(x + width)} ${num(y + tr)}` : '',
    `V ${num(y + height - br)}`,
    br ? `A ${num(br)} ${num(br)} 0 0 1 ${num(x + width - br)} ${num(y + height)}` : '',
    `H ${num(x + bl)}`,
    bl ? `A ${num(bl)} ${num(bl)} 0 0 1 ${num(x)} ${num(y + height - bl)}` : '',
    `V ${num(y + tl)}`,
    tl ? `A ${num(tl)} ${num(tl)} 0 0 1 ${num(x + tl)} ${num(y)}` : '',
    'Z',
  ].filter(Boolean).join(' ');
}

// ── 数值轴刻度 ──────────────────────────────────────────────────────────────

function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  const candidates = [1, 2, 2.5, 5, 10];
  const picked = candidates.find((candidate) => normalized <= candidate * 1.0000001) ?? 10;
  return picked * magnitude;
}

export function buildAxisTicks(min, max, targetCount = 5) {
  let lower = Number.isFinite(min) ? min : 0;
  let upper = Number.isFinite(max) ? max : 1;
  if (lower === upper) {
    if (lower === 0) { lower = 0; upper = 1; } else if (lower > 0) { lower = 0; } else { upper = 0; }
  }
  const step = niceStep((upper - lower) / Math.max(1, targetCount - 1));
  let start = Math.floor(lower / step) * step;
  let end = Math.ceil(upper / step) * step;
  if (end === start) end = start + step;
  const count = Math.round((end - start) / step);
  if (count > 24) {
    // 刻度过密时退化为等分，避免几十条网格线糊成一片。
    const ticks = [];
    for (let index = 0; index <= targetCount; index += 1) ticks.push(start + ((end - start) * index) / targetCount);
    return { min: start, max: end, step: (end - start) / targetCount, ticks };
  }
  const ticks = [];
  for (let value = start; value <= end + step / 1e6; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return { min: start, max: end, step, ticks };
}

// ── 规格校验与归一化 ────────────────────────────────────────────────────────

function toFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw fail('BAD_DATA', `${label}必须是数字，收到：${JSON.stringify(value)}`);
  return number;
}

function normalizeSeriesData(input) {
  const raw = input?.data;
  if (Array.isArray(raw)) {
    if (raw.length === 0) throw fail('BAD_DATA', 'data 不能是空数组。');
    if (raw.length > MAX_CATEGORIES) throw fail('BAD_DATA', `data 最多 ${MAX_CATEGORIES} 个数据点，收到 ${raw.length} 个。`);
    const hasSeriesField = raw.some((item) => item && typeof item === 'object' && item.series !== undefined && item.series !== null && item.series !== '');
    if (!hasSeriesField) {
      const categories = [];
      const values = [];
      for (const [index, item] of raw.entries()) {
        if (!item || typeof item !== 'object') throw fail('BAD_DATA', `data[${index}] 必须是 {label, value} 对象。`);
        categories.push(String(item.label ?? `第${index + 1}项`));
        values.push(toFiniteNumber(item.value, `data[${index}].value`));
      }
      return { categories, series: [{ name: String(input?.seriesName ?? '数值'), values }] };
    }
    // 分组形态：按 series 字段聚合成多条序列，类目取首次出现顺序。
    const categories = [];
    const order = [];
    const buckets = new Map();
    for (const [index, item] of raw.entries()) {
      if (!item || typeof item !== 'object') throw fail('BAD_DATA', `data[${index}] 必须是对象。`);
      const label = String(item.label ?? '');
      const name = String(item.series ?? '数值');
      if (!categories.includes(label)) categories.push(label);
      if (!buckets.has(name)) { buckets.set(name, new Map()); order.push(name); }
      buckets.get(name).set(label, toFiniteNumber(item.value, `data[${index}].value`));
    }
    const series = order.map((name) => ({
      name,
      values: categories.map((category) => buckets.get(name).get(category) ?? 0),
    }));
    if (series.length > MAX_SERIES) throw fail('BAD_DATA', `序列最多 ${MAX_SERIES} 条，收到 ${series.length} 条。`);
    return { categories, series };
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.labels) && Array.isArray(raw.series)) {
    const categories = raw.labels.map((label, index) => String(label ?? `第${index + 1}项`));
    if (categories.length === 0) throw fail('BAD_DATA', 'labels 不能是空数组。');
    if (categories.length > MAX_CATEGORIES) throw fail('BAD_DATA', `labels 最多 ${MAX_CATEGORIES} 项。`);
    if (raw.series.length === 0) throw fail('BAD_DATA', 'series 不能是空数组。');
    if (raw.series.length > MAX_SERIES) throw fail('BAD_DATA', `series 最多 ${MAX_SERIES} 条。`);
    const series = raw.series.map((entry, index) => {
      const name = String(entry?.name ?? `序列${index + 1}`);
      const points = entry?.data;
      if (!Array.isArray(points)) throw fail('BAD_DATA', `series[${index}].data 必须是数组。`);
      const values = categories.map((_, position) => {
        const point = points[position];
        if (point === undefined || point === null || point === '') return 0;
        if (typeof point === 'object') return toFiniteNumber(point.value, `series[${index}].data[${position}].value`);
        return toFiniteNumber(point, `series[${index}].data[${position}]`);
      });
      return { name, values };
    });
    return { categories, series };
  }
  throw fail('BAD_DATA', 'data 必须是 [{label,value}] 数组，或 {labels:[...], series:[{name,data:[...]}]} 结构。');
}

function normalizePieData(input) {
  const raw = input?.data;
  if (!Array.isArray(raw) || raw.length === 0) throw fail('BAD_DATA', '饼图需要 data: [{label, value}] 且非空。');
  if (raw.length > MAX_CATEGORIES) throw fail('BAD_DATA', `饼图最多 ${MAX_CATEGORIES} 个扇区。`);
  const slices = raw.map((item, index) => {
    if (!item || typeof item !== 'object') throw fail('BAD_DATA', `data[${index}] 必须是 {label, value} 对象。`);
    const value = toFiniteNumber(item.value, `data[${index}].value`);
    if (value < 0) throw fail('BAD_DATA', `饼图不支持负数：data[${index}].value = ${value}。`);
    return { label: String(item.label ?? `第${index + 1}项`), value, color: item.color };
  });
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) throw fail('BAD_DATA', '饼图所有数值之和必须大于 0。');
  return { slices, total };
}

function normalizeGraph(input, { requireDirectedEdges }) {
  const nodes = input?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) throw fail('BAD_DATA', '需要 nodes: [{id, label}] 且非空。');
  if (nodes.length > MAX_NODES) throw fail('BAD_DATA', `nodes 最多 ${MAX_NODES} 个。`);
  const ids = new Set();
  const normalizedNodes = nodes.map((node, index) => {
    if (!node || typeof node !== 'object') throw fail('BAD_DATA', `nodes[${index}] 必须是对象。`);
    const id = String(node.id ?? '').trim();
    if (!id) throw fail('BAD_DATA', `nodes[${index}].id 不能为空。`);
    if (ids.has(id)) throw fail('BAD_DATA', `nodes 里 id 重复：${id}。`);
    ids.add(id);
    return {
      id,
      label: String(node.label ?? id),
      shape: String(node.shape ?? 'rect').toLowerCase(),
      group: node.group === undefined || node.group === null ? null : String(node.group),
      color: node.color,
    };
  });
  const rawEdges = input?.edges ?? [];
  if (!Array.isArray(rawEdges)) throw fail('BAD_DATA', 'edges 必须是数组。');
  if (rawEdges.length > MAX_EDGES) throw fail('BAD_DATA', `edges 最多 ${MAX_EDGES} 条。`);
  const edges = rawEdges.map((edge, index) => {
    if (!edge || typeof edge !== 'object') throw fail('BAD_DATA', `edges[${index}] 必须是对象。`);
    const from = String(edge.from ?? '').trim();
    const to = String(edge.to ?? '').trim();
    if (!ids.has(from)) throw fail('BAD_DATA', `edges[${index}].from 指向不存在的节点：${from || '(空)'}。`);
    if (!ids.has(to)) throw fail('BAD_DATA', `edges[${index}].to 指向不存在的节点：${to || '(空)'}。`);
    if (from === to && !requireDirectedEdges) {
      // 关系图允许自环但画出来没意义，直接拒绝并说明。
      throw fail('BAD_DATA', `edges[${index}] 是自环（from 与 to 都是 ${from}），无法绘制。`);
    }
    return { from, to, label: edge.label === undefined || edge.label === null ? null : String(edge.label) };
  });
  return { nodes: normalizedNodes, edges };
}

/** 打上「已归一化」标记（不可枚举，因此不会出现在工具的 JSON 返回里）。 */
function markNormalized(spec) {
  Object.defineProperty(spec, '__normalized', { value: true, enumerable: false });
  return spec;
}

export function normalizeDiagramSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('BAD_ARGUMENT', 'diagram_draw 需要一个描述对象，至少包含 type 与 title。');
  }
  const type = String(input.type ?? '').trim().toLowerCase();
  if (!DIAGRAM_TYPES.includes(type)) {
    throw fail('BAD_ARGUMENT', `type 只支持 ${DIAGRAM_TYPES.join(' / ')}，收到：${String(input.type ?? '(空)')}`);
  }
  const title = String(input.title ?? '').trim();
  if (!title) throw fail('BAD_ARGUMENT', 'title 不能为空：图表需要一个标题。');
  const subtitle = input.subtitle === undefined || input.subtitle === null ? null : String(input.subtitle);
  const defaults = DEFAULT_SIZE[type];
  const width = input.width === undefined || input.width === null || input.width === ''
    ? defaults.width
    : Math.round(Number(input.width));
  const height = input.height === undefined || input.height === null || input.height === ''
    ? defaults.height
    : Math.round(Number(input.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < 160 || width > 4000 || height > 4000) {
    throw fail('BAD_ARGUMENT', `width/height 必须在 240–4000（宽）与 160–4000（高）之间，收到 ${width}×${height}。`);
  }
  const showValues = input.showValues !== false;
  const showLegend = input.showLegend !== false;
  const unit = input.unit === undefined || input.unit === null ? '' : String(input.unit);
  const colors = Array.isArray(input.colors) && input.colors.length > 0
    ? input.colors.map((color) => String(color))
    : THEME.palette;

  const spec = { type, title, subtitle, width, height, showValues, showLegend, unit, colors };

  if (type === 'bar' || type === 'line') {
    const { categories, series } = normalizeSeriesData(input);
    spec.categories = categories;
    spec.series = series;
    if (input.yMin !== undefined && input.yMin !== null && input.yMin !== '') spec.yMin = toFiniteNumber(input.yMin, 'yMin');
    if (input.yMax !== undefined && input.yMax !== null && input.yMax !== '') spec.yMax = toFiniteNumber(input.yMax, 'yMax');
    return markNormalized(spec);
  }
  if (type === 'pie') {
    const { slices, total } = normalizePieData(input);
    spec.slices = slices;
    spec.total = total;
    return markNormalized(spec);
  }
  if (type === 'flowchart') {
    const { nodes, edges } = normalizeGraph(input, { requireDirectedEdges: true });
    const direction = String(input.direction ?? 'vertical').toLowerCase();
    if (!['vertical', 'horizontal'].includes(direction)) {
      throw fail('BAD_ARGUMENT', `direction 只支持 vertical / horizontal，收到：${direction}`);
    }
    spec.direction = direction;
    spec.nodes = nodes;
    spec.edges = edges;
    return markNormalized(spec);
  }
  const { nodes, edges } = normalizeGraph(input, { requireDirectedEdges: false });
  const center = input.center === undefined || input.center === null ? null : String(input.center);
  if (center && !nodes.some((node) => node.id === center)) {
    throw fail('BAD_ARGUMENT', `center 指向不存在的节点：${center}`);
  }
  spec.nodes = nodes;
  spec.edges = edges;
  spec.center = center;
  spec.directed = input.directed === true;
  return markNormalized(spec);
}

// ── 画布框架（标题 / 图例 / 背景） ───────────────────────────────────────────

function frame({ width, height, title, subtitle }) {
  const parts = [el('rect', { x: 0, y: 0, width, height, fill: THEME.background })];
  let cursor = 34;
  parts.push(textEl(title, { x: 28, y: cursor, size: 19, weight: 'bold', fill: THEME.text }));
  cursor += 6;
  if (subtitle) {
    cursor += 18;
    parts.push(textEl(subtitle, { x: 28, y: cursor, size: 12.5, fill: THEME.muted }));
  }
  return { parts, contentTop: cursor + 14 };
}

function legendRow(series, { right, top, colors }) {
  const parts = [];
  const items = series.map((entry, index) => ({
    name: entry.name,
    color: entry.color ?? colors[index % colors.length],
  }));
  const size = 12;
  const gap = 18;
  const widths = items.map((item) => size + 6 + estimateTextWidth(item.name, 12.5));
  const totalWidth = widths.reduce((sum, value) => sum + value, 0) + gap * (items.length - 1);
  let x = Math.max(28, right - totalWidth);
  for (const [index, item] of items.entries()) {
    parts.push(el('rect', { x: num(x), y: num(top), width: size, height: size, rx: 2.5, fill: item.color }));
    parts.push(textEl(item.name, { x: num(x + size + 6), y: num(top + size - 1.5), size: 12.5, fill: THEME.muted }));
    x += widths[index] + gap;
  }
  return { parts, width: totalWidth };
}

// ── 直角坐标系（柱状 / 折线） ───────────────────────────────────────────────

function cartesianLayout(spec) {
  const values = spec.series.flatMap((series) => series.values);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const lower = spec.yMin ?? (dataMin > 0 ? 0 : dataMin);
  const upper = spec.yMax ?? (dataMax < 0 ? 0 : dataMax);
  const axis = buildAxisTicks(lower, upper, 5);
  const min = spec.yMin ?? axis.min;
  const max = spec.yMax ?? axis.max;
  const ticks = spec.yMin !== undefined || spec.yMax !== undefined
    ? axis.ticks.filter((tick) => tick >= min - 1e-9 && tick <= max + 1e-9)
    : axis.ticks;

  const widestTick = Math.max(...ticks.map((tick) => estimateTextWidth(formatNumber(tick, { unit: spec.unit }), 12)));
  const legendHeight = spec.showLegend && spec.series.length > 1 ? 24 : 0;
  const left = Math.max(58, widestTick + 22);
  const right = 26;
  const bottom = 62;
  const header = frame({ width: spec.width, height: spec.height, title: spec.title, subtitle: spec.subtitle });
  const top = header.contentTop + legendHeight + 14;
  const plotWidth = spec.width - left - right;
  const plotHeight = spec.height - top - bottom;
  if (plotWidth < 80 || plotHeight < 80) {
    throw fail('BAD_ARGUMENT', `画布 ${spec.width}×${spec.height} 太小，标题与图例占满了可用空间；请放大 width/height。`);
  }
  return { header, left, right, top, bottom, plotWidth, plotHeight, min, max, ticks, legendHeight };
}

function axisLayer(spec, layout) {
  const { left, top, plotWidth, plotHeight, min, max, ticks } = layout;
  const parts = [];
  const y = (value) => top + plotHeight - ((value - min) / (max - min || 1)) * plotHeight;
  // 水平网格线 + 刻度标签
  for (const tick of ticks) {
    const position = y(tick);
    parts.push(el('line', {
      x1: num(left), y1: num(position), x2: num(left + plotWidth), y2: num(position),
      stroke: Math.abs(tick) < 1e-9 ? THEME.axis : THEME.grid,
      'stroke-width': Math.abs(tick) < 1e-9 ? 1.2 : 1,
    }));
    parts.push(textEl(formatNumber(tick, { unit: spec.unit }), {
      x: num(left - 10), y: num(position + 4), size: 12, fill: THEME.muted, anchor: 'end',
    }));
  }
  // 左轴 + 底轴
  parts.push(el('line', { x1: num(left), y1: num(top), x2: num(left), y2: num(top + plotHeight), stroke: THEME.axis, 'stroke-width': 1.2 }));
  parts.push(el('line', { x1: num(left), y1: num(top + plotHeight), x2: num(left + plotWidth), y2: num(top + plotHeight), stroke: THEME.axis, 'stroke-width': 1.2 }));
  return { parts, y };
}

function categoryLabels(spec, layout, y) {
  const { left, top, plotWidth, plotHeight, bottom } = layout;
  const band = plotWidth / spec.categories.length;
  const fontSize = 12;
  const rotate = spec.categories.some((label) => estimateTextWidth(label, fontSize) > band - 6);
  const parts = [];
  for (const [index, label] of spec.categories.entries()) {
    const center = left + band * (index + 0.5);
    if (rotate) {
      parts.push(textEl(truncate(label, bottom - 12, fontSize), {
        x: num(center + 2), y: num(top + plotHeight + 16), size: fontSize, fill: THEME.muted, anchor: 'end', rotate: -35,
      }));
    } else {
      parts.push(textEl(truncate(label, band - 4, fontSize), {
        x: num(center), y: num(top + plotHeight + 20), size: fontSize, fill: THEME.muted, anchor: 'middle',
      }));
    }
  }
  return parts;
}

function renderBarChart(spec) {
  const layout = cartesianLayout(spec);
  const { parts: headerParts, contentTop } = layout.header;
  const parts = [...headerParts];
  const axis = axisLayer(spec, layout);
  parts.push(...axis.parts);
  const { left, plotWidth, plotHeight, top, max, min } = layout;
  const baseline = axis.y(Math.min(Math.max(0, min), max));
  const band = plotWidth / spec.categories.length;
  const groupGap = Math.min(22, band * 0.24);
  const groupWidth = band - groupGap;
  const barWidth = Math.max(2, groupWidth / spec.series.length);
  const barRadius = Math.min(3.5, barWidth / 2.5);
  const labelSize = 11.5;
  const showLabels = spec.showValues && barWidth >= 20;
  const notes = [];

  for (const [seriesIndex, series] of spec.series.entries()) {
    const color = series.color ?? spec.colors[seriesIndex % spec.colors.length];
    for (const [categoryIndex, value] of series.values.entries()) {
      const x = left + band * categoryIndex + groupGap / 2 + barWidth * seriesIndex;
      const valueY = axis.y(value);
      const topY = Math.min(valueY, baseline);
      const barHeight = Math.max(1, Math.abs(baseline - valueY));
      const corners = value >= 0 ? ['tl', 'tr'] : ['bl', 'br'];
      parts.push(el('path', {
        d: roundedRectPath(x, topY, barWidth, barHeight, barRadius, corners),
        fill: color,
      }));
      if (showLabels) {
        parts.push(textEl(formatNumber(value, { unit: spec.unit }), {
          x: num(x + barWidth / 2),
          y: num(value >= 0 ? topY - 6 : topY + barHeight + 14),
          size: labelSize,
          fill: THEME.text,
          anchor: 'middle',
          weight: 'bold',
        }));
      }
    }
  }
  if (spec.showValues && !showLabels) notes.push('柱体过窄，已省略数据标签；放大画布或减少类目可恢复。');
  parts.push(...categoryLabels(spec, layout, axis.y));

  if (spec.showLegend && spec.series.length > 1) {
    const legend = legendRow(
      spec.series.map((series, index) => ({ name: series.name, color: series.color ?? spec.colors[index % spec.colors.length] })),
      { right: spec.width - layout.right, top: contentTop + 6, colors: spec.colors },
    );
    parts.push(...legend.parts);
  }
  return { parts, notes, layout };
}

function renderLineChart(spec) {
  const layout = cartesianLayout(spec);
  const { parts: headerParts, contentTop } = layout.header;
  const parts = [...headerParts];
  const axis = axisLayer(spec, layout);
  parts.push(...axis.parts);
  const { left, plotWidth, top, min, max } = layout;
  const band = plotWidth / spec.categories.length;
  const notes = [];
  const markerRadius = spec.categories.length > 24 ? 2.6 : 4;

  for (const [seriesIndex, series] of spec.series.entries()) {
    const color = series.color ?? spec.colors[seriesIndex % spec.colors.length];
    const points = series.values.map((value, index) => ({
      x: left + band * (index + 0.5),
      y: axis.y(value),
      value,
    }));
    parts.push(el('polyline', {
      points: points.map((point) => `${num(point.x)},${num(point.y)}`).join(' '),
      fill: 'none',
      stroke: color,
      'stroke-width': 2.4,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }));
    for (const point of points) {
      parts.push(el('circle', { cx: num(point.x), cy: num(point.y), r: markerRadius, fill: '#ffffff', stroke: color, 'stroke-width': 2 }));
      if (spec.showValues && spec.categories.length <= 18) {
        parts.push(textEl(formatNumber(point.value, { unit: spec.unit }), {
          x: num(point.x), y: num(point.y - 9), size: 11.5, fill: THEME.text, anchor: 'middle', weight: 'bold',
        }));
      }
    }
  }
  if (spec.showValues && spec.categories.length > 18) notes.push('数据点较多，已省略数据标签；可在 PPT/Word 里放大查看。');
  parts.push(...categoryLabels(spec, layout, axis.y));

  if (spec.showLegend && spec.series.length > 1) {
    const legend = legendRow(
      spec.series.map((series, index) => ({ name: series.name, color: series.color ?? spec.colors[index % spec.colors.length] })),
      { right: spec.width - layout.right, top: contentTop + 6, colors: spec.colors },
    );
    parts.push(...legend.parts);
  }
  return { parts, notes, layout };
}

// ── 饼图 ────────────────────────────────────────────────────────────────────

function renderPie(spec) {
  const { parts: headerParts, contentTop } = frame({ width: spec.width, height: spec.height, title: spec.title, subtitle: spec.subtitle });
  const parts = [...headerParts];
  const legendEntries = spec.slices.map((slice, index) => ({
    label: slice.label,
    value: slice.value,
    percent: slice.value / spec.total,
    color: slice.color ?? spec.colors[index % spec.colors.length],
  }));
  const legendWidth = Math.min(
    Math.max(...legendEntries.map((entry) => 90 + estimateTextWidth(entry.label, 12.5))),
    spec.width * 0.42,
  );
  const drawingWidth = spec.width - 56 - legendWidth - 24;
  const centerX = 28 + drawingWidth / 2;
  const centerY = contentTop + (spec.height - contentTop - 28) / 2;
  const radius = Math.max(40, Math.min(drawingWidth / 2 - 26, (spec.height - contentTop - 56) / 2));
  const labelSize = 12;
  const showValueInLabel = spec.showValues;

  let angle = -Math.PI / 2;
  const notes = [];
  for (const entry of legendEntries) {
    const start = angle;
    const sweep = entry.percent * Math.PI * 2;
    angle += sweep;
    if (entry.percent <= 0) continue;
    const end = angle;
    const largeArc = sweep > Math.PI ? 1 : 0;
    const x1 = centerX + radius * Math.cos(start);
    const y1 = centerY + radius * Math.sin(start);
    const x2 = centerX + radius * Math.cos(end);
    const y2 = centerY + radius * Math.sin(end);
    // 单扇区占满整圆时用两个半圆，否则 A 指令画不出 360°。
    const path = entry.percent >= 0.999999
      ? `M ${num(centerX)} ${num(centerY)} m ${num(-radius)} 0 a ${num(radius)} ${num(radius)} 0 1 0 ${num(radius * 2)} 0 a ${num(radius)} ${num(radius)} 0 1 0 ${num(-radius * 2)} 0 Z`
      : `M ${num(centerX)} ${num(centerY)} L ${num(x1)} ${num(y1)} A ${num(radius)} ${num(radius)} 0 ${largeArc} 1 ${num(x2)} ${num(y2)} Z`;
    parts.push(el('path', { d: path, fill: entry.color, stroke: THEME.background, 'stroke-width': 1.5 }));

    // 引导线 + 标签
    const middle = (start + end) / 2;
    const anchorX = centerX + Math.cos(middle) * (radius + 8);
    const anchorY = centerY + Math.sin(middle) * (radius + 8);
    const direction = Math.cos(middle) >= 0 ? 1 : -1;
    const elbowX = centerX + Math.cos(middle) * (radius + 22);
    const endX = elbowX + direction * 14;
    parts.push(el('polyline', {
      points: `${num(anchorX)},${num(anchorY)} ${num(elbowX)},${num(anchorY)} ${num(endX)},${num(anchorY)}`,
      fill: 'none',
      stroke: THEME.border,
      'stroke-width': 1,
    }));
    const percentText = `${Math.round(entry.percent * 1000) / 10}%`;
    // 数据本身就是百分比时不再重复显示一次数值，避免出现 "19%（19%）"。
    const label = showValueInLabel && spec.unit !== '%'
      ? `${percentText}（${formatNumber(entry.value, { unit: spec.unit })}）`
      : percentText;
    parts.push(textEl(label, {
      x: num(endX + direction * 4),
      y: num(anchorY + 4),
      size: labelSize,
      fill: THEME.text,
      anchor: direction > 0 ? 'start' : 'end',
    }));
  }

  // 右侧图例（名称 + 百分比）
  const legendX = spec.width - 28 - legendWidth;
  const rowHeight = 24;
  const legendTop = centerY - (legendEntries.length * rowHeight) / 2 + 4;
  for (const [index, entry] of legendEntries.entries()) {
    const y = legendTop + index * rowHeight;
    parts.push(el('rect', { x: num(legendX), y: num(y), width: 12, height: 12, rx: 2.5, fill: entry.color }));
    parts.push(textEl(truncate(entry.label, legendWidth - 28 - 54, 12.5), {
      x: num(legendX + 18), y: num(y + 11), size: 12.5, fill: THEME.text,
    }));
    parts.push(textEl(`${Math.round(entry.percent * 1000) / 10}%`, {
      x: num(spec.width - 28), y: num(y + 11), size: 12.5, fill: THEME.muted, anchor: 'end',
    }));
  }
  return { parts, notes, layout: { centerX, centerY, radius } };
}

// ── 流程图 ──────────────────────────────────────────────────────────────────

/** DFS 找出所有「回边」（指向当前递归栈上节点的边），这些边构成环，分层时忽略但照常绘制。 */
function findBackEdges(nodes, edges) {
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.from !== edge.to) outgoing.get(edge.from).push(edge);
  }
  const state = new Map(); // 0 未访问 / 1 在栈上 / 2 已完成
  const backEdges = new Set();
  for (const node of nodes) {
    if ((state.get(node.id) ?? 0) !== 0) continue;
    // 显式栈，避免深图递归爆栈。
    const stack = [{ id: node.id, index: 0 }];
    state.set(node.id, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const list = outgoing.get(frame.id) ?? [];
      if (frame.index >= list.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edge = list[frame.index];
      frame.index += 1;
      const next = state.get(edge.to) ?? 0;
      if (next === 1) {
        backEdges.add(edge);
      } else if (next === 0) {
        state.set(edge.to, 1);
        stack.push({ id: edge.to, index: 0 });
      }
    }
  }
  return backEdges;
}

export function layeredLevels(nodes, edges) {
  const backEdges = findBackEdges(nodes, edges);
  // 只用非回边（构成 DAG）做最长路径分层，所以环上的节点也能各归其层。
  const forwardEdges = edges.filter((edge) => edge.from !== edge.to && !backEdges.has(edge));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of forwardEdges) {
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const level = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const processed = new Set();
  let guard = 0;
  while (queue.length > 0 && guard < nodes.length * 4 + 16) {
    guard += 1;
    const id = queue.shift();
    if (processed.has(id)) continue;
    processed.add(id);
    for (const next of outgoing.get(id) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, (level.get(id) ?? 0) + 1));
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if ((indegree.get(next) ?? 0) <= 0) queue.push(next);
    }
  }
  // 极端情况下仍有未被处理的节点（例如整图就是若干互不连通的环）：按声明顺序排在最后。
  const remaining = nodes.filter((node) => !processed.has(node.id));
  const base = Math.max(0, ...level.values());
  remaining.forEach((node, index) => level.set(node.id, base + 1 + index));
  const cyclic = nodes.filter((node) => [...backEdges].some((edge) => edge.from === node.id || edge.to === node.id));
  return { level, cyclic, backEdgeCount: backEdges.size };
}

function nodeSize(node, direction) {
  const labelSize = 13;
  const minimumWidth = node.shape === 'start' || node.shape === 'end' ? 96 : 128;
  const maxWidth = 300;
  // 横向布局时长标签会旋转 -90°，折行会很难读，因此只在纵向布局折行。
  const wrapAllowed = direction !== 'horizontal';
  const contentMax = node.shape === 'decision' ? maxWidth * 0.6 : maxWidth;
  const lines = wrapAllowed ? wrapText(node.label, contentMax, labelSize, 'bold', 2) : [node.label];
  const widest = Math.max(...lines.map((line) => estimateTextWidth(line, labelSize, 'bold')));
  const width = Math.max(minimumWidth, Math.min(maxWidth, Math.ceil((node.shape === 'decision' ? widest / 0.6 : widest) + 40)));
  const baseHeight = node.shape === 'decision' ? 62 : 48;
  const height = baseHeight + (lines.length - 1) * 17;
  const size = { width, height, lines, labelSize };
  return direction === 'horizontal'
    ? { width: height, height: width, labelRotate: -90, lines, labelSize }
    : size;
}

function renderFlowchart(spec) {
  const { nodes, edges, direction } = spec;
  const { level, cyclic } = layeredLevels(nodes, edges);
  const notes = [];
  if (cyclic.length > 0) {
    notes.push(`流程图中存在环（涉及节点：${cyclic.map((node) => node.label).join('、')}）；分层时已忽略构成环的回边，连线仍按 edges 真实绘制。`);
  }
  const sizes = new Map(nodes.map((node) => [node.id, nodeSize(node, direction)]));

  const bands = new Map();
  for (const node of nodes) {
    const band = level.get(node.id) ?? 0;
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band).push(node);
  }
  const bandKeys = [...bands.keys()].sort((a, b) => a - b);
  const offset = direction === 'vertical' ? 40 : 46;
  const header = frame({ width: spec.width, height: spec.height, title: spec.title, subtitle: spec.subtitle });
  const parts = [...header.parts];
  const margin = 34;
  const gapAcross = 26;
  const gapAlong = direction === 'vertical' ? 56 : 76;

  // 先算每个 band 的沿轴厚度与跨轴宽度，据此决定最终画布尺寸（不裁切）。
  let alongCursor = header.contentTop + (direction === 'vertical' ? offset : 24);
  const positions = new Map();
  let maxAcross = 0;
  for (const band of bandKeys) {
    const items = bands.get(band);
    const alongThickness = Math.max(...items.map((node) => (direction === 'vertical' ? sizes.get(node.id).height : sizes.get(node.id).width)));
    const acrossThickness = items.reduce((sum, node) => sum + (direction === 'vertical' ? sizes.get(node.id).width : sizes.get(node.id).height), 0)
      + gapAcross * (items.length - 1);
    maxAcross = Math.max(maxAcross, acrossThickness);
    let acrossCursor = 0;
    for (const node of items) {
      const size = sizes.get(node.id);
      positions.set(node.id, { along: alongCursor, across: acrossCursor, size, band });
      acrossCursor += (direction === 'vertical' ? size.width : size.height) + gapAcross;
    }
    alongCursor += alongThickness + gapAlong;
  }
  const contentAlong = alongCursor - gapAlong + margin;
  const contentAcross = maxAcross + margin * 2;
  const canvasWidth = direction === 'vertical' ? Math.max(spec.width, Math.ceil(contentAcross)) : Math.max(spec.width, Math.ceil(contentAlong));
  const canvasHeight = direction === 'vertical' ? Math.max(spec.height, Math.ceil(contentAlong)) : Math.max(spec.height, Math.ceil(contentAcross));

  // 把 along/across 映射到画布坐标，并在跨轴方向居中。
  const acrossCanvasSize = direction === 'vertical' ? canvasWidth : canvasHeight;
  const centered = new Map();
  for (const node of nodes) {
    const position = positions.get(node.id);
    const centeredAcross = (acrossCanvasSize - maxAcross) / 2 + position.across;
    centered.set(node.id, direction === 'vertical'
      ? { x: centeredAcross, y: position.along, width: position.size.width, height: position.size.height }
      : { x: position.along, y: centeredAcross, width: position.size.width, height: position.size.height });
  }

  // 背景重画成最终尺寸
  parts[0] = el('rect', { x: 0, y: 0, width: canvasWidth, height: canvasHeight, fill: THEME.background });

  const accent = spec.colors[0];
  const edgeParts = [];
  const nodeParts = [];
  const arrowId = 'mochi-arrow';
  edgeParts.push(`<defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${THEME.axis}"/></marker></defs>`);

  for (const edge of edges) {
    const from = centered.get(edge.from);
    const to = centered.get(edge.to);
    if (!from || !to) continue;
    const start = direction === 'vertical'
      ? { x: from.x + from.width / 2, y: from.y + from.height }
      : { x: from.x + from.width, y: from.y + from.height / 2 };
    const endPoint = direction === 'vertical'
      ? { x: to.x + to.width / 2, y: to.y }
      : { x: to.x, y: to.y + to.height / 2 };
    if (edge.from === edge.to) {
      // 自环：从右侧出发绕一圈回到顶部
      const path = `M ${num(from.x + from.width)} ${num(from.y + from.height / 2)} `
        + `C ${num(from.x + from.width + 34)} ${num(from.y + from.height / 2)}, ${num(from.x + from.width + 34)} ${num(from.y - 26)}, `
        + `${num(from.x + from.width / 2)} ${num(from.y)}`;
      edgeParts.push(el('path', { d: path, fill: 'none', stroke: THEME.axis, 'stroke-width': 1.4, 'marker-end': `url(#${arrowId})` }));
      if (edge.label) {
        // 自环的边标签画在节点上方（回路的顶点处），和普通边一样带底色挡线。
        const labelX = from.x + from.width / 2;
        const labelY = from.y - 14;
        const labelWidth = estimateTextWidth(edge.label, 11.5) + 10;
        edgeParts.push(el('rect', {
          x: num(labelX - labelWidth / 2), y: num(labelY - 10), width: num(labelWidth), height: 18, rx: 4,
          fill: THEME.background, opacity: 0.94,
        }));
        edgeParts.push(textEl(edge.label, { x: num(labelX), y: num(labelY + 3.5), size: 11.5, fill: THEME.muted, anchor: 'middle' }));
      }
      continue;
    }
    const sameBand = level.get(edge.from) === level.get(edge.to);
    let path;
    if (direction === 'vertical') {
      if (sameBand) {
        path = `M ${num(start.x)} ${num(start.y)} C ${num(start.x + 30)} ${num(start.y + 34)}, ${num(endPoint.x + 30)} ${num(endPoint.y - 34)}, ${num(endPoint.x)} ${num(endPoint.y)}`;
      } else {
        const controlY = start.y + (endPoint.y - start.y) / 2;
        path = `M ${num(start.x)} ${num(start.y)} C ${num(start.x)} ${num(controlY)}, ${num(endPoint.x)} ${num(controlY)}, ${num(endPoint.x)} ${num(endPoint.y)}`;
      }
    } else if (sameBand) {
      path = `M ${num(start.x)} ${num(start.y)} C ${num(start.x + 34)} ${num(start.y + 30)}, ${num(endPoint.x - 34)} ${num(endPoint.y + 30)}, ${num(endPoint.x)} ${num(endPoint.y)}`;
    } else {
      const controlX = start.x + (endPoint.x - start.x) / 2;
      path = `M ${num(start.x)} ${num(start.y)} C ${num(controlX)} ${num(start.y)}, ${num(controlX)} ${num(endPoint.y)}, ${num(endPoint.x)} ${num(endPoint.y)}`;
    }
    edgeParts.push(el('path', { d: path, fill: 'none', stroke: THEME.axis, 'stroke-width': 1.6, 'marker-end': `url(#${arrowId})` }));
    if (edge.label) {
      const middleX = (start.x + endPoint.x) / 2;
      const middleY = (start.y + endPoint.y) / 2;
      const width = estimateTextWidth(edge.label, 11.5) + 10;
      edgeParts.push(el('rect', { x: num(middleX - width / 2), y: num(middleY - 10), width: num(width), height: 18, rx: 4, fill: THEME.background, opacity: 0.94 }));
      edgeParts.push(textEl(edge.label, { x: num(middleX), y: num(middleY + 3.5), size: 11.5, fill: THEME.muted, anchor: 'middle' }));
    }
  }

  for (const node of nodes) {
    const box = centered.get(node.id);
    const size = sizes.get(node.id);
    if (node.shape === 'decision') {
      const path = `M ${num(box.x + box.width / 2)} ${num(box.y)} L ${num(box.x + box.width)} ${num(box.y + box.height / 2)} L ${num(box.x + box.width / 2)} ${num(box.y + box.height)} L ${num(box.x)} ${num(box.y + box.height / 2)} Z`;
      nodeParts.push(el('path', { d: path, fill: '#ffffff', stroke: accent, 'stroke-width': 1.8 }));
    } else if (node.shape === 'start' || node.shape === 'end') {
      nodeParts.push(el('rect', {
        x: num(box.x), y: num(box.y), width: num(box.width), height: num(box.height),
        rx: num(box.height / 2), fill: accent, stroke: accent, 'stroke-width': 1.5,
      }));
    } else {
      const radius = node.shape === 'round' ? 18 : 7;
      nodeParts.push(el('rect', {
        x: num(box.x), y: num(box.y), width: num(box.width), height: num(box.height),
        rx: radius, fill: '#ffffff', stroke: THEME.border, 'stroke-width': 1.4,
      }));
    }
    const onAccent = node.shape === 'start' || node.shape === 'end';
    const lines = size.lines ?? [node.label];
    const lineHeight = 17;
    const firstLineY = box.y + box.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 4.5;
    for (const [index, line] of lines.entries()) {
      nodeParts.push(textEl(line, {
        x: num(box.x + box.width / 2),
        y: num(firstLineY + index * lineHeight),
        size: size.labelSize ?? 13,
        fill: onAccent ? '#ffffff' : THEME.text,
        anchor: 'middle',
        weight: 'bold',
        rotate: size.labelRotate,
      }));
    }
  }

  parts.push(...edgeParts, ...nodeParts);
  return { parts, notes, layout: { width: canvasWidth, height: canvasHeight, levels: bandKeys.length } };
}

// ── 关系图（放射布局） ──────────────────────────────────────────────────────

function renderRelationship(spec) {
  const { nodes, edges } = spec;
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const centerNode = nodes.find((node) => node.id === spec.center)
    ?? [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0];
  const outer = nodes.filter((node) => node.id !== centerNode.id);

  const groups = [...new Set(nodes.map((node) => node.group).filter((group) => group !== null))];
  const groupColor = new Map(groups.map((group, index) => [group, spec.colors[(index + 1) % spec.colors.length]]));
  const colorOf = (node, index) => node.color ?? (node.group !== null && groupColor.has(node.group) ? groupColor.get(node.group) : spec.colors[index % spec.colors.length]);

  const labelSize = 13;
  const boxOf = (label, minimumWidth) => {
    const lines = wrapText(label, 220, labelSize, 'bold', 2);
    const widest = Math.max(...lines.map((line) => estimateTextWidth(line, labelSize, 'bold')));
    return {
      width: Math.max(minimumWidth, Math.min(240, Math.ceil(widest + 34))),
      height: 44 + (lines.length - 1) * 17,
      lines,
    };
  };
  const sizes = new Map();
  sizes.set(centerNode.id, boxOf(centerNode.label, 150));
  outer.forEach((node, index) => sizes.set(node.id, boxOf(node.label, 130)));

  const widestOuter = Math.max(130, ...[...sizes.entries()].filter(([id]) => id !== centerNode.id).map(([, size]) => size.width));
  const count = Math.max(1, outer.length);
  const radiusFromSpacing = (count * (widestOuter + 34)) / (2 * Math.PI);
  const radius = Math.max(140, radiusFromSpacing);
  // contentTop 只取决于标题/副标题，与画布宽高无关；先用基础尺寸算出它，再据此定最终画布。
  const probe = frame({ width: spec.width, height: spec.height, title: spec.title, subtitle: spec.subtitle });
  const legendHeight = groups.length > 1 ? 26 : 0;
  const contentTop = probe.contentTop + legendHeight + 10;
  const canvasWidth = Math.max(spec.width, Math.ceil((radius + widestOuter / 2 + 46) * 2));
  const canvasHeight = Math.max(spec.height, Math.ceil(radius * 2 + contentTop + 46));

  const parts = [...frame({ width: canvasWidth, height: canvasHeight, title: spec.title, subtitle: spec.subtitle }).parts];

  const resolvedCenterX = canvasWidth / 2;
  const resolvedCenterY = contentTop + (canvasHeight - contentTop - 26) / 2;
  const positions = new Map([[centerNode.id, { x: resolvedCenterX, y: resolvedCenterY }]]);
  outer.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    positions.set(node.id, {
      x: resolvedCenterX + Math.cos(angle) * radius,
      y: resolvedCenterY + Math.sin(angle) * radius,
    });
  });

  const edgeParts = [];
  const nodeParts = [];
  const arrowId = 'mochi-rel-arrow';
  const centerColor = centerNode.color ?? spec.colors[0];
  // 边标签避让：落在任一节点框内（含 8px 外扩）时，沿边找一个不压节点的位置。
  const nodeBoxes = nodes.map((node) => {
    const position = positions.get(node.id);
    const size = sizes.get(node.id);
    return {
      left: position.x - size.width / 2 - 8,
      right: position.x + size.width / 2 + 8,
      top: position.y - size.height / 2 - 8,
      bottom: position.y + size.height / 2 + 8,
    };
  });
  // 已经放下的边标签底板。两条边的标签常常会挤在同一条半径上（实测「场所：叶绿体」
  // 与「场所：线粒体」曾糊成一团），所以标签除了避让节点，还要互相避让。
  const labelBoxes = [];
  // 注意：判定必须用「标签底板矩形」而不是标签中心点，否则中心刚好落在节点外、
  // 半个底板压进方框的标签仍然会糊在节点边上（本机实测过）。
  const hitsNode = (x, y, halfWidth) => nodeBoxes.some((box) => (
    x + halfWidth >= box.left && x - halfWidth <= box.right && y + 9 >= box.top && y - 9 <= box.bottom
  ));
  const hitsLabel = (x, y, halfWidth) => labelBoxes.some((box) => (
    x + halfWidth >= box.left && x - halfWidth <= box.right && y + 9 >= box.top && y - 9 <= box.bottom
  ));
  /**
   * 沿边找一个不压节点、也不压已有标签的位置。
   * sample(ratio) 给出边上的点（直线段或贝塞尔弧），normalAt 给出该点法线方向；
   * 沿边滑动 + 法线方向微移，取第一个完全干净的落点。
   * 全部候选都有冲突时退化为「冲突最少」的落点（宁可轻微压线，也不把标签藏到节点底下）。
   */
  function labelAnchorFor(sample, normalAt, halfWidth) {
    const ratios = [];
    for (let ratio = 0.14; ratio <= 0.87; ratio += 0.055) ratios.push(ratio);
    ratios.push(0.5);
    const offsets = [0, -15, 15, -28, 28];
    let best = null;
    for (const ratio of ratios) {
      const point = sample(ratio);
      const normal = normalAt(ratio);
      for (const offset of offsets) {
        const x = point.x + normal.x * offset;
        const y = point.y + normal.y * offset;
        const nodeHits = nodeBoxes.filter((box) => (
          x + halfWidth >= box.left && x - halfWidth <= box.right && y + 9 >= box.top && y - 9 <= box.bottom
        )).length;
        const labelHits = labelBoxes.filter((box) => (
          x + halfWidth >= box.left && x - halfWidth <= box.right && y + 9 >= box.top && y - 9 <= box.bottom
        )).length;
        if (nodeHits === 0 && labelHits === 0) return { x, y };
        const cost = nodeHits * 3 + labelHits;
        if (!best || cost < best.cost) best = { x, y, cost };
      }
    }
    return best ?? sample(0.5);
  }
  if (spec.directed) {
    edgeParts.push(`<defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${THEME.axis}"/></marker></defs>`);
  }
  const centerPoint = positions.get(centerNode.id);
  /** 把连线端点从节点中心收到节点边界上（按矩形近似），避免线条压进方框。 */
  function trimToBox(point, toward, size) {
    const dx = toward.x - point.x;
    const dy = toward.y - point.y;
    if (dx === 0 && dy === 0) return { x: point.x, y: point.y };
    const tx = dx !== 0 ? (size.width / 2) / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const ty = dy !== 0 ? (size.height / 2) / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const ratio = Math.min(tx, ty, 1);
    return { x: point.x + dx * ratio, y: point.y + dy * ratio };
  }
  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const fromSize = sizes.get(edge.from);
    const toSize = sizes.get(edge.to);
    // 外圈节点之间的「弦」如果直连会穿过中心，改画成向外鼓的弧线，标签放在弧顶。
    const isChord = edge.from !== centerNode.id && edge.to !== centerNode.id;
    let sample = null;
    let normalAt = null;
    if (isChord) {
      const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const away = { x: middle.x - centerPoint.x, y: middle.y - centerPoint.y };
      const distance = Math.hypot(away.x, away.y);
      const bulge = Math.max(26, radius * 0.22);
      let direction;
      if (distance < 1) {
        // 弦正好穿过中心（例如上下两个相对节点）：改沿弦的垂直方向鼓出去，避免仍是一条穿心的直线。
        const chord = { x: to.x - from.x, y: to.y - from.y };
        const length = Math.hypot(chord.x, chord.y) || 1;
        direction = { x: -chord.y / length, y: chord.x / length };
      } else {
        direction = { x: away.x / distance, y: away.y / distance };
      }
      const control = { x: middle.x + direction.x * bulge, y: middle.y + direction.y * bulge };
      const start = trimToBox(from, control, fromSize);
      const end = trimToBox(to, control, toSize);
      edgeParts.push(el('path', {
        d: `M ${num(start.x)} ${num(start.y)} Q ${num(control.x)} ${num(control.y)} ${num(end.x)} ${num(end.y)}`,
        fill: 'none', stroke: THEME.axis, 'stroke-width': 1.4,
        'marker-end': spec.directed ? `url(#${arrowId})` : undefined,
      }));
      // 标签沿同一条二次贝塞尔滑动；发现扰动时略微偏移，不会跑到别的边上去。
      const bezier = (ratio) => {
        const inverse = 1 - ratio;
        return {
          x: inverse * inverse * start.x + 2 * inverse * ratio * control.x + ratio * ratio * end.x,
          y: inverse * inverse * start.y + 2 * inverse * ratio * control.y + ratio * ratio * end.y,
        };
      };
      sample = bezier;
      // 曲线切线 = 2(1-t)(C-P0) + 2t(P2-C)，法线取它的垂线。
      normalAt = (ratio) => {
        const tangentX = 2 * (1 - ratio) * (control.x - start.x) + 2 * ratio * (end.x - control.x);
        const tangentY = 2 * (1 - ratio) * (control.y - start.y) + 2 * ratio * (end.y - control.y);
        const length = Math.hypot(tangentX, tangentY) || 1;
        return { x: -tangentY / length, y: tangentX / length };
      };
    } else {
      const start = trimToBox(from, to, fromSize);
      const end = trimToBox(to, from, toSize);
      edgeParts.push(el('line', {
        x1: num(start.x), y1: num(start.y), x2: num(end.x), y2: num(end.y),
        stroke: THEME.axis, 'stroke-width': 1.4,
        'marker-end': spec.directed ? `url(#${arrowId})` : undefined,
      }));
      sample = (ratio) => ({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
      const segmentX = end.x - start.x;
      const segmentY = end.y - start.y;
      const segmentLength = Math.hypot(segmentX, segmentY) || 1;
      normalAt = () => ({ x: -segmentY / segmentLength, y: segmentX / segmentLength });
    }
    if (edge.label) {
      const width = estimateTextWidth(edge.label, 11.5) + 10;
      const halfWidth = width / 2;
      const middle = sample(0.5);
      const anchorPoint = hitsNode(middle.x, middle.y, halfWidth) || hitsLabel(middle.x, middle.y, halfWidth)
        ? labelAnchorFor(sample, normalAt, halfWidth)
        : middle;
      labelBoxes.push({
        left: anchorPoint.x - halfWidth, right: anchorPoint.x + halfWidth,
        top: anchorPoint.y - 10, bottom: anchorPoint.y + 9,
      });
      edgeParts.push(el('rect', { x: num(anchorPoint.x - width / 2), y: num(anchorPoint.y - 10), width: num(width), height: 18, rx: 4, fill: THEME.background, opacity: 0.94 }));
      edgeParts.push(textEl(edge.label, { x: num(anchorPoint.x), y: num(anchorPoint.y + 3.5), size: 11.5, fill: THEME.muted, anchor: 'middle' }));
    }
  }
  for (const [index, node] of nodes.entries()) {
    const position = positions.get(node.id);
    const size = sizes.get(node.id);
    const isCenter = node.id === centerNode.id;
    nodeParts.push(el('rect', {
      x: num(position.x - size.width / 2), y: num(position.y - size.height / 2),
      width: num(size.width), height: num(size.height), rx: num(size.height / 2),
      fill: isCenter ? centerColor : '#ffffff',
      stroke: isCenter ? centerColor : colorOf(node, index),
      'stroke-width': isCenter ? 1.6 : 1.8,
    }));
    const lines = size.lines ?? [node.label];
    const lineHeight = 17;
    const firstLineY = position.y - ((lines.length - 1) * lineHeight) / 2 + 4.5;
    for (const [lineIndex, line] of lines.entries()) {
      nodeParts.push(textEl(line, {
        x: num(position.x), y: num(firstLineY + lineIndex * lineHeight), size: labelSize,
        fill: isCenter ? '#ffffff' : THEME.text, anchor: 'middle', weight: 'bold',
      }));
    }
  }
  parts.push(...edgeParts, ...nodeParts);

  if (groups.length > 1) {
    const legend = legendRow(
      groups.map((group) => ({ name: group, color: groupColor.get(group) })),
      { right: canvasWidth - 28, top: probe.contentTop + 2, colors: spec.colors },
    );
    parts.push(...legend.parts);
  }
  return { parts, notes: [], layout: { centerX: resolvedCenterX, centerY: resolvedCenterY, radius, center: centerNode.id, width: canvasWidth, height: canvasHeight } };
}

// ── 对外入口 ────────────────────────────────────────────────────────────────

/**
 * 生成 SVG 字符串。
 * @param {object} input 结构化描述
 * @param {number} scale 输出缩放（只改 svg 标签的 width/height，viewBox 不变，因此矢量不损失精度）
 * @param {{ fontFamily?: string }} options fontFamily 传入经 fonts.mjs 检测过的中文字族链
 */
export function renderDiagramSvg(input, scale = 1, { fontFamily } = {}) {
  const spec = input?.__normalized === true ? input : normalizeDiagramSpec(input);
  const renderer = { bar: renderBarChart, line: renderLineChart, pie: renderPie, flowchart: renderFlowchart, relationship: renderRelationship }[spec.type];
  const previousFont = activeFontFamily;
  const usedFont = typeof fontFamily === 'string' && fontFamily.trim() ? fontFamily : THEME.font;
  activeFontFamily = usedFont;
  let result;
  try {
    result = renderer(spec);
  } finally {
    activeFontFamily = previousFont;
  }
  const width = Math.round(result.layout.width ?? spec.width);
  const height = Math.round(result.layout.height ?? spec.height);
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);
  const header = `<svg xmlns="http://www.w3.org/2000/svg" width="${scaledWidth}" height="${scaledHeight}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title)}">`;
  return {
    svg: `${header}\n${result.parts.join('\n')}\n</svg>\n`,
    width,
    height,
    scaledWidth,
    scaledHeight,
    type: spec.type,
    title: spec.title,
    fontFamily: usedFont,
    notes: result.notes ?? [],
  };
}
