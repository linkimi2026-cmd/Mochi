// mochi-visuals · 四个工具的真实实现。
//
// 每个 handler 的签名都是 (args, exec)，与 ctx.tools.register 的 execute 一致。
// 所有文件路径入参都先过 paths.mjs 的 createPathGuard().resolve()，本文件不自行拼路径。
// 产物一律写到「视觉产物输出根」（默认会话工作区下的 Mochi Visuals/，否则系统临时目录），
// 文件名冲突时自动加序号，任何情况下都不覆盖已有文件，更不会覆盖原图。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createPathGuard, MochiVisualsError, resolveVisualRoots, statOrNull, toolFailure } from './paths.mjs';
import {
  IMAGE_EXTENSIONS,
  isImageExtension,
  orientationOf,
  parseAspectRatio,
  probeImageFile,
  probeImageBuffer,
  simplifyAspect,
  readImageWithMeta,
} from './image-meta.mjs';
import { ALLOWED_FORMATS, editImageBuffer, normalizeOperations, OP_NAMES } from './image-ops.mjs';
import { DIAGRAM_TYPES, escapeXml, normalizeDiagramSpec, renderDiagramSvg, THEME } from './diagram.mjs';
import { normalizePngScale, rasterizeSvgToPng } from './raster.mjs';
import { containsCjk, resolveDiagramFont } from './fonts.mjs';
import { matchLocalTextbook, networkSuggestions, textbookDatabasePath } from './textbook.mjs';

/** 收集一张图里所有会被画出来的文字，用于判断是否需要中文字体。 */
function diagramTexts(spec) {
  const texts = [spec.title, spec.subtitle, spec.unit];
  if (spec.categories) texts.push(...spec.categories);
  if (spec.series) texts.push(...spec.series.map((series) => series.name));
  if (spec.slices) texts.push(...spec.slices.map((slice) => slice.label));
  if (spec.nodes) texts.push(...spec.nodes.map((node) => node.label));
  if (spec.edges) texts.push(...spec.edges.map((edge) => edge.label));
  return texts.filter((text) => typeof text === 'string' && text.length > 0);
}

export const DEFAULT_FIND_LIMIT = 30;
export const MAX_FIND_LIMIT = 200;
export const DEFAULT_MAX_DEPTH = 6;
export const MAX_MAX_DEPTH = 32;
export const MAX_SCAN_ENTRIES = 50_000;

const ERRNO_ZH = {
  ENOENT: '文件或目录不存在',
  EACCES: '没有访问权限',
  EPERM: '操作不被允许',
  EEXIST: '目标已存在',
  ENOTDIR: '路径中有一段不是目录',
  EISDIR: '目标是目录',
  ENOSPC: '磁盘空间不足',
  EROFS: '目标文件系统是只读的',
  EIO: '底层读写错误',
};

function fsFailure(error, action, target) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(error.code) ? error.code : 'EUNKNOWN';
  const zh = ERRNO_ZH[code] || '操作系统返回未知错误';
  return toolFailure(code, `${action}失败：${target}（${code}：${zh}）。`, { target: String(target) });
}

async function withFs(action, target, work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MochiVisualsError) throw error;
    throw fsFailure(error, action, target);
  }
}

function clampInt(value, fallback, minimum, maximum, label, notes) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    notes.push(`${label} 不是有效数字，已改用默认值 ${fallback}。`);
    return fallback;
  }
  const floored = Math.floor(number);
  const bounded = Math.min(Math.max(floored, minimum), maximum);
  if (bounded !== floored) notes.push(`${label} ${floored} 超出范围 ${minimum}–${maximum}，已收敛到 ${bounded}。`);
  return bounded;
}

function wildcardMatcher(query) {
  if (/[*?]/.test(query)) {
    const escaped = query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    const pattern = new RegExp(`^${escaped}$`, 'iu');
    return (name) => pattern.test(name);
  }
  const needle = query.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

function resolutionTier(width, height) {
  const long = Math.max(width, height);
  if (long >= 2560) return '超清（长边≥2560）';
  if (long >= 1920) return '全高清以上（长边≥1920）';
  if (long >= 1280) return '高清（长边≥1280）';
  if (long >= 800) return '中等（长边≥800）';
  return '低清（长边<800）';
}

/** 清理模型给的文件名：去掉路径分隔符与控制字符，限制长度，不允许为空。 */
export function sanitizeBaseName(input, fallback) {
  const raw = String(input ?? '').trim();
  const cleaned = (raw || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const limited = [...cleaned].slice(0, 60).join('').trim();
  return limited || fallback;
}

async function uniqueOutputPath(directory, baseName, extension) {
  const safe = sanitizeBaseName(baseName, 'visual');
  for (let index = 0; index < 100; index += 1) {
    const name = index === 0 ? `${safe}${extension}` : `${safe}-${index + 1}${extension}`;
    const candidate = join(directory, name);
    const info = await statOrNull(candidate);
    if (!info) return candidate;
    if (info.isDirectory()) continue;
  }
  throw toolFailure('OUTPUT_NAME_EXHAUSTED', `输出目录里已有 100 个同名文件，请换一个 outputName：${directory}`);
}

export function createVisualTools({ ctx, options = {} } = {}) {
  const cache = new Map();

  async function contextFor(exec) {
    const resolved = await resolveVisualRoots({ ctx, exec, options });
    const key = [
      resolved.source,
      resolved.readOnly ? 'ro' : 'rw',
      resolved.entries.map((entry) => entry.real).join('|'),
      resolved.outputRoot,
    ].join('::');
    let cached = cache.get(key);
    if (!cached) {
      cached = { ...resolved, guard: createPathGuard(resolved.entries) };
      cache.set(key, cached);
    }
    return cached;
  }

  function requireWritable(context, action) {
    if (context.readOnly) {
      throw toolFailure('WORKSPACE_READ_ONLY', `当前会话是只读模式，${action}已被拒绝；只读会话只能检索与查看图片。`);
    }
  }

  /** 产物目录：默认输出根；显式给了 outputDirectory 时，必须是允许根之内的真实目录。 */
  async function resolveOutputDirectory(context, requested, exec) {
    let directory = context.outputRoot;
    let source = context.outputSource;
    if (requested !== undefined && requested !== null && String(requested).trim() !== '') {
      const { path } = await context.guard.resolve(requested, { field: '输出目录' });
      await withFs('创建输出目录', path, async () => {
        await mkdir(path, { recursive: true, mode: 0o700 });
      });
      directory = path;
      source = 'explicit';
    } else {
      await withFs('创建输出目录', directory, async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
      });
    }
    // 写出前再复检一次：确保目录本身仍在允许根内（挡住并发替换成符号链接的情况）。
    await context.guard.resolve(directory, { field: '输出目录' });
    return { directory, source };
  }

  async function publishBuffer(context, { requestedDirectory, preparedDirectory, baseName, extension, buffer, exec }) {
    const { directory, source } = preparedDirectory ?? await resolveOutputDirectory(context, requestedDirectory, exec);
    const target = await uniqueOutputPath(directory, baseName, extension);
    await withFs('写出产物', target, async () => {
      await writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
    });
    // 写后复检 + 真实回读，确认落盘字节与内存字节一致。
    const verified = await context.guard.resolveExistingFile(target, { field: '产物' });
    const onDisk = await withFs('回读产物', target, async () => readFile(target));
    if (onDisk.length !== buffer.length) {
      throw toolFailure('WRITE_VERIFY_FAILED', `产物回读字节数不一致（期望 ${buffer.length}，实际 ${onDisk.length}）：${target}`);
    }
    return { target, byteLength: onDisk.length, directory, directorySource: source, realPath: verified.path };
  }

  // ── image_find ────────────────────────────────────────────────────────────
  async function find(args = {}, exec) {
    const notes = [];
    const context = await contextFor(exec);
    const query = String(args.query ?? '').trim();
    const limit = clampInt(args.limit, DEFAULT_FIND_LIMIT, 1, MAX_FIND_LIMIT, 'limit', notes);
    const maxDepth = clampInt(args.maxDepth, DEFAULT_MAX_DEPTH, 0, MAX_MAX_DEPTH, 'maxDepth', notes);
    const recursive = args.recursive !== false;
    const minWidth = clampInt(args.minWidth, null, 1, 200_000, 'minWidth', notes);
    const minHeight = clampInt(args.minHeight, null, 1, 200_000, 'minHeight', notes);
    const minLongEdge = clampInt(args.minLongEdge, null, 1, 200_000, 'minLongEdge', notes);
    const minBytes = clampInt(args.minBytes, null, 1, 2_000_000_000, 'minBytes', notes);
    const targetAspect = args.aspectRatio === undefined || args.aspectRatio === null || args.aspectRatio === ''
      ? null
      : parseAspectRatio(args.aspectRatio);
    if (args.aspectRatio !== undefined && args.aspectRatio !== null && args.aspectRatio !== '' && !targetAspect) {
      throw toolFailure('BAD_ARGUMENT', `aspectRatio 无法解析：${String(args.aspectRatio)}（应形如 "16:9" 或 "1.78"）。`);
    }
    const orientation = String(args.orientation ?? 'any').toLowerCase();
    if (!['any', 'landscape', 'portrait', 'square', '横向', '纵向', '正方形'].includes(orientation)) {
      throw toolFailure('BAD_ARGUMENT', `orientation 只支持 any / landscape(横向) / portrait(纵向) / square(正方形)，收到：${orientation}`);
    }
    const sort = String(args.sort ?? (targetAspect ? 'aspect' : 'resolution')).toLowerCase();
    if (!['aspect', 'resolution', 'recent', 'name'].includes(sort)) {
      throw toolFailure('BAD_ARGUMENT', `sort 只支持 aspect / resolution / recent / name，收到：${sort}`);
    }

    const { path: searchRoot } = await context.guard.resolve(args.directory || '.', { field: '搜索目录' });
    const rootInfo = await statOrNull(searchRoot);
    if (!rootInfo) throw fsFailure({ code: 'ENOENT' }, '搜索', `目录不存在：${searchRoot}`);
    if (!rootInfo.isDirectory()) throw fsFailure({ code: 'ENOTDIR' }, '搜索', searchRoot);

    const matcher = query ? wildcardMatcher(query) : () => true;
    const stack = [{ directory: searchRoot, depth: 0 }];
    const candidates = [];
    let scannedEntries = 0;
    let skippedNotImage = 0;
    let unreadable = 0;
    let truncatedScan = false;

    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = await readdir(current.directory, { withFileTypes: true });
      } catch {
        unreadable += 1;
        continue;
      }
      for (const entry of entries) {
        if (scannedEntries >= MAX_SCAN_ENTRIES) { truncatedScan = true; break; }
        scannedEntries += 1;
        const full = join(current.directory, entry.name);
        // 不跟随符号链接，避免越出允许根去看别处的文件。
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (recursive && current.depth < maxDepth) stack.push({ directory: full, depth: current.depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        if (!isImageExtension(entry.name)) { skippedNotImage += 1; continue; }
        if (!matcher(entry.name)) continue;
        candidates.push(full);
      }
      if (truncatedScan) break;
    }

    const results = [];
    const rejected = { 尺寸不足: 0, 比例不符: 0, 方向不符: 0, 太小字节: 0, 无法识别: 0 };
    for (const candidate of candidates) {
      const info = await statOrNull(candidate);
      if (!info) { rejected.无法识别 += 1; continue; }
      const meta = await probeImageFile(candidate);
      if (!meta) { rejected.无法识别 += 1; continue; }
      const ratio = meta.width / meta.height;
      if (minWidth !== null && meta.width < minWidth) { rejected.尺寸不足 += 1; continue; }
      if (minHeight !== null && meta.height < minHeight) { rejected.尺寸不足 += 1; continue; }
      if (minLongEdge !== null && Math.max(meta.width, meta.height) < minLongEdge) { rejected.尺寸不足 += 1; continue; }
      if (minBytes !== null && info.size < minBytes) { rejected.太小字节 += 1; continue; }
      if (targetAspect) {
        const deviation = Math.abs(ratio - targetAspect) / targetAspect;
        if (deviation > 0.08) { rejected.比例不符 += 1; continue; }
      }
      if (orientation !== 'any') {
        const actual = meta.width === meta.height ? 'square' : meta.width > meta.height ? 'landscape' : 'portrait';
        const wanted = { 横向: 'landscape', 纵向: 'portrait', 正方形: 'square' }[orientation] ?? orientation;
        if (actual !== wanted) { rejected.方向不符 += 1; continue; }
      }
      results.push({
        名称: entryName(candidate),
        路径: candidate,
        格式: meta.format.toUpperCase(),
        宽: meta.width,
        高: meta.height,
        方向: orientationOf(meta.width, meta.height),
        宽高比: simplifyAspect(meta.width, meta.height),
        宽高比数值: Math.round(ratio * 1000) / 1000,
        像素: meta.width * meta.height,
        清晰度档位: resolutionTier(meta.width, meta.height),
        大小字节: info.size,
        修改时间: info.mtime.toISOString(),
        _deviation: targetAspect ? Math.abs(ratio - targetAspect) / targetAspect : 0,
        _long: Math.max(meta.width, meta.height),
        _mtime: info.mtime.getTime(),
      });
    }

    const comparators = {
      aspect: (a, b) => (a._deviation - b._deviation) || (b._long - a._long) || (b._mtime - a._mtime),
      resolution: (a, b) => (b._long - a._long) || (b.像素 - a.像素) || (b._mtime - a._mtime),
      recent: (a, b) => (b._mtime - a._mtime) || (b._long - a._long),
      name: (a, b) => a.名称.localeCompare(b.名称, 'zh-Hans-CN'),
    };
    results.sort(comparators[sort]);
    const ranked = results.slice(0, limit).map(({ _deviation, _long, _mtime, ...rest }, index) => ({
      序号: index + 1,
      ...rest,
      ...(targetAspect ? { 与目标比例偏差: `${Math.round(_deviation * 1000) / 10}%` } : {}),
    }));

    return {
      ok: true,
      工具: 'image_find',
      查询: query || '（未指定，匹配全部图片）',
      搜索根目录: searchRoot,
      允许根目录: context.guard.roots,
      排序: sort,
      候选数: candidates.length,
      结果数: ranked.length,
      是否截断: results.length > limit || truncatedScan,
      扫描条目数: scannedEntries,
      跳过: {
        ...rejected,
        非图片文件: skippedNotImage,
        不可读目录: unreadable,
      },
      结果: ranked,
      说明: [
        ...notes,
        '只读取文件头判断格式与尺寸，不解码像素、不修改任何文件。',
        '不跟随符号链接，结果全部位于允许根目录之内。',
        targetAspect ? `已按“与 ${args.aspectRatio} 的比例接近程度”优先排序，并过滤掉偏差超过 8% 的图片。` : '未指定 aspectRatio，因此按清晰度（长边像素）排序。',
        results.length > limit ? `命中 ${results.length} 张，仅返回前 ${limit} 张；可提高 limit 或加筛选条件。` : '',
        truncatedScan ? `目录条目超过 ${MAX_SCAN_ENTRIES} 上限，扫描提前结束。` : '',
      ].filter(Boolean).join(''),
    };
  }

  // ── image_edit ────────────────────────────────────────────────────────────
  async function edit(args = {}, exec) {
    const context = await contextFor(exec);
    requireWritable(context, '图片编辑');
    const source = await context.guard.resolveExistingFile(args.path, { field: '要编辑的图片', extensions: IMAGE_EXTENSIONS });
    // 先把「操作清单」和「输出目录」校验干净，再去做昂贵的解码与逐像素处理：
    // 非法入参必须在碰图像运行时之前就失败（否则在缺原生模块的机器上，
    // 一个越界路径会被报成「图像运行时不可用」，既误导模型也浪费一次大图解码）。
    normalizeOperations(args.operations);
    const preparedDirectory = await resolveOutputDirectory(context, args.outputDirectory, exec);
    const loaded = await withFs('读取图片', source.path, async () => readImageWithMeta(source.path));

    // 水印文字要走中文字族检测：本机实测泛型 sans-serif 对简体汉字会画成方框。
    const font = await resolveDiagramFont();
    const watermarkTexts = (Array.isArray(args.operations) ? args.operations : [])
      .filter((entry) => entry && entry.op === 'watermark' && typeof entry.text === 'string')
      .map((entry) => entry.text);
    if (watermarkTexts.some((text) => containsCjk(text)) && !font.watermarkFont) {
      throw toolFailure(
        'CJK_FONT_UNAVAILABLE',
        '本机没有检测到可用于 canvas 的简体中文字体，水印中文会被画成方框，已拒绝执行（不做任何伪装）。'
        + `检测结论：${font.notes.join('')}`,
      );
    }

    let edited;
    try {
      edited = await editImageBuffer({
        buffer: loaded.buffer,
        sourceFormat: loaded.format,
        operations: args.operations,
        format: args.format,
        quality: args.quality,
        fontFamily: font.watermarkFont ?? 'sans-serif',
      });
    } catch (error) {
      if (error instanceof MochiVisualsError) throw error;
      throw toolFailure('EDIT_FAILED', `图片编辑失败：${error?.message ?? '未知原因'}。`, { source: source.path });
    }

    const stem = basename(source.path, extname(source.path));
    const baseName = sanitizeBaseName(args.outputName, `${stem}-edited`);
    const published = await publishBuffer(context, {
      requestedDirectory: args.outputDirectory,
      preparedDirectory,
      baseName,
      extension: edited.extension,
      buffer: edited.buffer,
      exec,
    });
    if (published.realPath === source.path) {
      throw toolFailure('OUTPUT_OVERWRITES_SOURCE', `产物路径与源图相同，已拒绝覆盖原图：${source.path}`);
    }

    // 独立回读校验：用文件头解析器（不经过 canvas）确认落盘文件的真实尺寸。
    const verify = await probeImageFile(published.target);
    if (!verify || verify.width !== edited.width || verify.height !== edited.height) {
      throw toolFailure(
        'WRITE_VERIFY_FAILED',
        `产物回读尺寸与预期不一致：期望 ${edited.width}×${edited.height}，实际 ${verify ? `${verify.width}×${verify.height}` : '无法识别'}。`,
      );
    }

    return {
      ok: true,
      工具: 'image_edit',
      状态: '已完成',
      源文件: source.path,
      源文件字节数: source.byteLength,
      源格式: loaded.format.toUpperCase(),
      源尺寸: `${loaded.width}×${loaded.height}`,
      输出文件: published.target,
      输出目录: published.directory,
      输出尺寸: `${verify.width}×${verify.height}`,
      输出格式: edited.format.toUpperCase(),
      输出字节数: published.byteLength,
      ...(edited.quality ? { JPEG质量: edited.quality } : {}),
      应用的操作: edited.applied,
      回读校验: { 解析方式: '独立文件头解析（不经过 canvas）', 宽: verify.width, 高: verify.height, 与预期一致: true },
      说明: [
        '这是新文件，原图没有被改写。',
        '输出目录内同名文件会自动加序号，不会覆盖任何已有文件。',
        edited.applied.length === 0 ? '' : `共执行 ${edited.applied.length} 步像素操作，全部在本机完成。`,
      ].filter(Boolean).join(''),
    };
  }

  // ── diagram_draw ──────────────────────────────────────────────────────────
  async function draw(args = {}, exec) {
    const context = await contextFor(exec);
    requireWritable(context, '图表绘制');
    let spec;
    try {
      spec = normalizeDiagramSpec(args);
    } catch (error) {
      if (error?.name === 'DiagramError') throw toolFailure(error.code, error.message);
      throw error;
    }
    const pngScale = normalizePngScale(args.pngScale);
    const font = await resolveDiagramFont();
    const requestedFormats = args.formats === undefined || args.formats === null
      ? ['svg', 'png']
      : (Array.isArray(args.formats) ? args.formats : [args.formats]).map((item) => String(item).toLowerCase());
    const formats = [...new Set(requestedFormats)];
    if (formats.length === 0) throw toolFailure('BAD_ARGUMENT', 'formats 不能是空数组。');
    for (const format of formats) {
      if (!['svg', 'png'].includes(format)) throw toolFailure('BAD_ARGUMENT', `formats 只支持 svg / png，收到：${format}`);
    }

    const vector = renderDiagramSvg(spec, 1, { fontFamily: font.stack });
    const baseName = sanitizeBaseName(args.outputName, `${spec.type}-图`);
    const outputs = {};
    const notes = [...font.notes, ...vector.notes];

    if (formats.includes('svg')) {
      const buffer = Buffer.from(vector.svg, 'utf8');
      const published = await publishBuffer(context, {
        requestedDirectory: args.outputDirectory, baseName, extension: '.svg', buffer, exec,
      });
      const back = await withFs('回读 SVG', published.target, async () => readFile(published.target, 'utf8'));
      const escapedTitle = escapeXml(spec.title);
      if (!back.includes('<svg') || (!back.includes(escapedTitle) && !back.includes(spec.title))) {
        throw toolFailure('WRITE_VERIFY_FAILED', `SVG 回读校验失败（缺少 <svg> 或标题）：${published.target}`);
      }
      outputs.SVG = {
        路径: published.target,
        字节数: published.byteLength,
        尺寸: `${vector.width}×${vector.height}`,
        回读校验: { 含svg根元素: true, 含标题文字: true, 字符数: [...back].length },
      };
    }

    if (formats.includes('png')) {
      // resvg 只认不带引号的单一字族名；没有通过检测的中文字体就拒绝出 PNG，
      // 否则会交付一张整片中文方框的图（本机实测过，绝不这么干）。
      const needsCjk = diagramTexts(spec).some((text) => containsCjk(text));
      if (needsCjk && !font.rasterFamily) {
        throw toolFailure(
          'CJK_FONT_UNAVAILABLE',
          '本机没有检测到 SVG 光栅化引擎可用的简体中文字体，这会让 PNG 里的中文全部变成方框，因此拒绝生成 PNG（SVG 仍可正常输出，可只传 formats:["svg"]）。'
          + `检测结论：${font.notes.join('')}`,
        );
      }
      const raster = renderDiagramSvg(spec, pngScale, { fontFamily: font.rasterFamily ?? THEME.font });
      const png = await rasterizeSvgToPng(raster.svg, { width: raster.scaledWidth, height: raster.scaledHeight });
      const published = await publishBuffer(context, {
        requestedDirectory: args.outputDirectory, baseName, extension: '.png', buffer: png, exec,
      });
      const verify = await probeImageFile(published.target);
      if (!verify || verify.width !== raster.scaledWidth || verify.height !== raster.scaledHeight) {
        throw toolFailure(
          'WRITE_VERIFY_FAILED',
          `PNG 回读尺寸与预期不一致：期望 ${raster.scaledWidth}×${raster.scaledHeight}，实际 ${verify ? `${verify.width}×${verify.height}` : '无法识别'}。`,
        );
      }
      outputs.PNG = {
        路径: published.target,
        字节数: published.byteLength,
        尺寸: `${verify.width}×${verify.height}`,
        缩放倍数: pngScale,
        回读校验: { 格式: verify.format.toUpperCase(), 宽: verify.width, 高: verify.height, 与预期一致: true },
      };
    }

    const dataPoints = spec.type === 'bar' || spec.type === 'line'
      ? spec.categories.length * spec.series.length
      : spec.type === 'pie' ? spec.slices.length
        : spec.nodes.length;

    return {
      ok: true,
      工具: 'diagram_draw',
      状态: '已完成',
      类型: spec.type,
      标题: spec.title,
      输出目录: (outputs.SVG ?? outputs.PNG) ? dirname((outputs.SVG ?? outputs.PNG).路径) : context.outputRoot,
      产物: outputs,
      数据点或节点数: dataPoints,
      ...(spec.type === 'bar' || spec.type === 'line'
        ? { 类目: spec.categories, 序列: spec.series.map((series) => series.name) }
        : {}),
      使用字体: font.ok
        ? { 渲染字体: font.source, 光栅化字族: font.rasterFamily, SVG字族链: font.stack }
        : { 说明: '未找到通过简体中文检测的字体', 详情: font.notes.join('') },
      图例与刻度: '已绘制坐标轴、刻度标签、网格线、数据标签与多序列图例；配色为 Mochi 教学色（主色 #3F5B99，正文 #2c2c2c）。',
      说明: [
        'SVG 是矢量，适合放进 PPT 后继续放大编辑；PNG 是位图，适合放进 Word。',
        '两端产物来自同一份几何数据，版式一致。',
        ...notes,
      ].join(''),
    };
  }

  // ── teaching_image_match ──────────────────────────────────────────────────
  async function match(args = {}) {
    const topic = String(args.topic ?? '').trim();
    const knowledgeHome = options.knowledgeHome;
    const env = options.env ?? process.env;
    const matched = await matchLocalTextbook({
      topic,
      subject: args.subject,
      volume: args.volume,
      bookId: args.bookId,
      limit: args.limit,
      knowledgeHome,
      env,
      databasePath: options.textbookDatabasePath
        ?? (args.dataRoot ? join(String(args.dataRoot), 'textbook.sqlite') : textbookDatabasePath({ knowledgeHome, env })),
    });
    return {
      ok: true,
      工具: 'teaching_image_match',
      找到教材原图: matched.状态 === '本地已匹配',
      ...matched,
      ...(matched.状态 === '本地无匹配' && args.allowNetworkSuggestion !== false
        ? { 联网检索建议: networkSuggestions(topic, args.subject) }
        : {}),
    };
  }

  return { find, edit, draw, match };
}

function entryName(path) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index < 0 ? path : path.slice(index + 1);
}

export { IMAGE_EXTENSIONS, ALLOWED_FORMATS, DIAGRAM_TYPES, OP_NAMES, probeImageBuffer };
