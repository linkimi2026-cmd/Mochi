// mochi-presentations · 视觉回看（渲染成图 → 交给声明了图像输入的模型自查）
//
// 2026-09-12 立项。此前 ppt_inspect 只在 OOXML 文本层比对 slide XML，
// 「这一页到底长什么样」从来没有被看过一眼——文字溢出、元素重叠、配色失衡
// 这类问题在 XML 层完全看不出来。本模块补上这一环：
//
//   .pptx ──soffice──▶ .pdf ──pdfjs + @napi-rs/canvas──▶ PNG ──attachments──▶ image block
//
// 渲染依赖刻意选纯 Node 实现（pdfjs-dist + @napi-rs/canvas，与 mochi-knowledge
// 的受管教材页同一套），打包后不需要用户机器上有 Python；唯一的外部程序是
// LibreOffice，只用于 pptx→pdf 这一步（高保真渲染无法用纯 JS 做到）。
//
// 输出形态参考 tencent-pptx 的接触印相（contact sheet）思路：整册预览拼成
// 3×3 宫格，模型一张图看完一册的整体视觉节奏；细节存疑时再用 page 模式取单页。
// 该思路为通用做法，本文件为自研实现。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

// ─────────────────────────────────────────────────────────────────────────────
// 中文渲染（2026-09-12 排查结论，务必保留）
//
// 症状：LibreOffice 把整份中文课件渲染成**空白**——页面留着字的位置，一个字形都画不出来。
// 后果不只是"预览难看"：整个视觉自检回路对中文课件是全盲的。模型会说"这页偏空"，
// 而真相是"这一页的字根本没画出来"。当时的自检之所以能"通过一条中文课件"，
// 恰恰是因为它看不见中文。
//
// 根因（已实证，非猜测）：
//   1. LibreOffice 自带的 128 个字体里**没有任何 CJK 字体**（Noto 家族只带了
//      Arabic/Hebrew/Armenian/Georgian/Lao/Lisu），也没有 Source Han / WenQuanYi / Droid Fallback；
//   2. 这份 macOS 构建**不枚举系统中文字体**——把 Noto Sans SC 装进 ~/Library/Fonts、
//      /Library/Fonts 都没用，连系统自带的 Arial Unicode MS 也选不中；
//      清 ~/.cache/fontconfig 也无济于事。
//   验证方式：convert 一个纯中文 .txt，PDF 的 /BaseFont 只剩 LiberationMono（纯拉丁）。
//
// 解法：显式给 soffice 一份 fontconfig 配置，把**我们自己随包发布的**
// @mochi/pdf-layout/assets/fonts/NotoSansSC-Regular.ttf 所在目录列进去。
// 实测同一份 .txt，/BaseFont 变为 NotoSansSC-Regular，中文正常出字。
// 不修改 LibreOffice 应用包（老师机器上 /Applications 未必可写，且升级会丢），
// 也不要求老师机器预装字体。
// ─────────────────────────────────────────────────────────────────────────────

const CJK_FONT_FILE = 'NotoSansSC-Regular.ttf';

/** 随包发布的中文字体目录；解析不到就返回 null（此时不注入 fontconfig，行为与从前一致）。 */
export function resolveBundledFontDir() {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@mochi/pdf-layout');
    const candidates = [
      join(dirname(entry), 'assets', 'fonts'),
      join(dirname(entry), '..', 'assets', 'fonts'),
    ];
    return candidates.find((dir) => existsSync(join(dir, CJK_FONT_FILE))) ?? null;
  } catch {
    return null;
  }
}

/** LibreOffice 自带字体目录：必须一并列进配置，否则它连自己的拉丁字体都看不见。 */
function sofficeFontDir(soffice) {
  const marker = `${join('Contents', 'Resources', 'fonts', 'truetype')}`;
  const bundled = [soffice.split(/MacOS|program/iu)[0] + marker, join(dirname(soffice), '..', 'share', 'fonts', 'truetype')];
  const linux = ['/usr/lib/libreoffice/share/fonts/truetype', '/usr/share/fonts/truetype', '/usr/share/fonts'];
  const windows = ['C:\\Program Files\\LibreOffice\\share\\fonts\\truetype'];
  return [...bundled, ...linux, ...windows].map((dir) => dir.replaceAll('\\', '/')).find((dir) => existsSync(dir)) ?? null;
}

/** 生成一份只属于本次转换的 fontconfig，返回文件路径；无需注入时返回 null。 */
async function ensureSofficeFontConfig(workDir, soffice) {
  const fontDir = resolveBundledFontDir();
  if (!fontDir) return null;
  const dirs = [sofficeFontDir(soffice), fontDir, join(homedir(), 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts', '/System/Library/Fonts/Supplemental'].filter((dir) => dir && existsSync(dir));
  const cacheDir = join(workDir, 'fontconfig-cache');
  await mkdir(cacheDir, { recursive: true });
  const configPath = join(workDir, 'mochi-fonts.conf');
  // 路径要按 XML 规则转义：目录名里带 & 或 < 时，旧写法会生成畸形的 fontconfig 配置。
  const xml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  await writeFile(configPath, [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
    '<fontconfig>',
    ...dirs.map((dir) => `  <dir>${xml(dir)}</dir>`),
    `  <cachedir>${xml(cacheDir)}</cachedir>`,
    '</fontconfig>',
    '',
  ].join('\n'), 'utf8');
  return configPath;
}

const PNG = 'image/png';
const SHEET_COLUMNS = 3;
const SHEET_ROWS = 3;
const SHEET_CAPACITY = SHEET_COLUMNS * SHEET_ROWS;
const MAX_SHEETS = 3;
const SHEET_CELL_WIDTH = 620;
const SHEET_LABEL_HEIGHT = 26;
const SHEET_GAP = 14;
const SHEET_MARGIN = 20;
const MAX_PAGE_DIMENSION = 1_400;
const MAX_PAGE_PIXELS = 1_600_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 120_000;
const MAX_PPTX_BYTES = 256 * 1024 * 1024;

const SOFFICE_CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/opt/libreoffice/program/soffice',
  '/snap/bin/libreoffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];

function abortError() {
  const error = new Error('演示文稿渲染已取消。');
  error.name = 'AbortError';
  error.code = 'ABORTED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

/** LibreOffice 可执行文件：显式配置优先，其次是各平台常见安装位置。 */
export function resolveSoffice(explicit) {
  const ordered = [explicit, process.env.MOCHI_SOFFICE, ...SOFFICE_CANDIDATES].filter(Boolean);
  for (const candidate of ordered) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    return candidate; // 交给 PATH 解析
  }
  return undefined;
}

function run(command, args, signal, timeoutMs = CONVERT_TIMEOUT_MS, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      try { child.kill('SIGKILL'); } catch { /* best effort */ }
      finish(reject, abortError());
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* best effort */ }
      finish(reject, new Error(`渲染子进程超时（${Math.round(timeoutMs / 1000)} 秒）：${command}`));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, { stdout, stderr });
      else finish(reject, new Error(`渲染子进程退出码 ${code}：${command}\n${stderr || stdout}`));
    });
  });
}

async function loadRenderer() {
  try {
    const [pdfjs, canvas] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas'),
    ]);
    if (typeof pdfjs.getDocument !== 'function' || typeof canvas.createCanvas !== 'function') {
      throw new Error('missing renderer exports');
    }
    return { pdfjs, createCanvas: canvas.createCanvas, loadImage: canvas.loadImage };
  } catch (cause) {
    const error = new Error('当前运行包没有可用的演示文稿图像渲染依赖（pdfjs-dist / @napi-rs/canvas）。');
    error.cause = cause;
    throw error;
  }
}

/** pptx → pdf：每次转换使用独立的 LibreOffice 用户配置目录，避免并发实例锁冲突。 */
export async function convertToPdf(pptxPath, workDir, soffice, signal) {
  const outDir = join(workDir, 'pdf');
  const profileDir = join(workDir, 'soffice-profile');
  // 注入字体配置：不这么做的话，中文课件会被渲染成整页空白（见文件头排查结论）。
  const fontConfig = await ensureSofficeFontConfig(workDir, soffice);
  await run(soffice, [
    `-env:UserInstallation=file://${profileDir}`,
    '--headless',
    '--norestore',
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    pptxPath,
  ], signal, CONVERT_TIMEOUT_MS, fontConfig ? { ...process.env, FONTCONFIG_FILE: fontConfig } : undefined);
  const expected = join(outDir, `${pptxPath.split('/').pop().replace(/\.pptx$/iu, '')}.pdf`);
  if (existsSync(expected)) return expected;
  // 文件名清洗后可能与预期不一致，退回目录内唯一 PDF。
  const { readdir } = await import('node:fs/promises');
  const entries = (await readdir(outDir)).filter((name) => name.toLowerCase().endsWith('.pdf'));
  if (entries.length === 1) return join(outDir, entries[0]);
  throw new Error('LibreOffice 未能产出 PDF：请确认本机已安装 LibreOffice，且该 .pptx 可正常打开。');
}

function fitScale(baseViewport, maxWidth) {
  const width = Math.max(1, Number(baseViewport.width));
  const height = Math.max(1, Number(baseViewport.height));
  return Math.min(
    2,
    maxWidth / width,
    Math.sqrt(MAX_PAGE_PIXELS / (width * height)),
    MAX_PAGE_DIMENSION / Math.max(width, height),
  );
}

function drawLabel(context, x, y, width, text) {
  context.fillStyle = '#1A1A1A';
  context.fillRect(x, y, width, SHEET_LABEL_HEIGHT);
  context.fillStyle = '#F7F4EC';
  context.font = '15px sans-serif';
  context.fillText(text, x + 8, y + 18);
}

/**
 * 把一册 PDF 渲染成两类图像：
 *  - sheets：每 9 页拼一张 3×3 宫格，用于整体视觉节奏判断
 *  - page  ：单页原尺寸渲染，用于细节核对
 */
export async function renderPresentationImages({
  pdfPath,
  page,
  signal,
  maxSheets = MAX_SHEETS,
  pageWidth = SHEET_CELL_WIDTH,
} = {}) {
  throwIfAborted(signal);
  const { pdfjs, createCanvas, loadImage } = await loadRenderer();
  const data = new Uint8Array(await readFile(pdfPath, { signal }));
  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  let documentHandle;
  try {
    documentHandle = await loadingTask.promise;
    const total = documentHandle.numPages;
    throwIfAborted(signal);

    const renderPageToPng = async (pageNumber, targetWidth) => {
      const pdfPage = await documentHandle.getPage(pageNumber);
      try {
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const scale = fitScale(baseViewport, targetWidth);
        const viewport = pdfPage.getViewport({ scale: Math.max(0.05, scale) });
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        const canvas = createCanvas(width, height);
        try {
          const context = canvas.getContext('2d');
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, width, height);
          await pdfPage.render({ canvasContext: context, viewport }).promise;
          return { png: canvas.toBuffer(PNG), width, height };
        } finally {
          canvas.dispose?.();
        }
      } finally {
        try { pdfPage.cleanup?.(); } catch { /* no-op */ }
      }
    };

    // 单页模式：按部署允许的最大尺寸渲染，细节优先。
    if (Number.isInteger(page)) {
      if (page < 1 || page > total) {
        throw new Error(`页码 ${page} 超出范围：本册共 ${total} 页。`);
      }
      const rendered = await renderPageToPng(page, MAX_PAGE_DIMENSION);
      throwIfAborted(signal);
      return { total, sheets: [], pages: [{ page, ...rendered }] };
    }

    // 宫格模式：整册概览。
    const sheetCount = Math.min(maxSheets, Math.ceil(total / SHEET_CAPACITY));
    if (sheetCount < 1) throw new Error('该 PDF 没有任何可渲染的页面。');
    const renderedPages = [];
    for (let index = 0; index < sheetCount * SHEET_CAPACITY; index += 1) {
      const pageNumber = index + 1;
      if (pageNumber > total) break;
      throwIfAborted(signal);
      renderedPages.push({ page: pageNumber, ...await renderPageToPng(pageNumber, pageWidth) });
    }

    const cellHeight = Math.round((renderedPages[0].height / renderedPages[0].width) * pageWidth);
    const sheets = [];
    for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
      const group = renderedPages.slice(sheetIndex * SHEET_CAPACITY, (sheetIndex + 1) * SHEET_CAPACITY);
      if (group.length === 0) continue;
      const canvasWidth = SHEET_MARGIN * 2 + SHEET_COLUMNS * pageWidth + (SHEET_COLUMNS - 1) * SHEET_GAP;
      const canvasHeight = SHEET_MARGIN * 2
        + SHEET_ROWS * (cellHeight + SHEET_LABEL_HEIGHT)
        + (SHEET_ROWS - 1) * SHEET_GAP;
      const sheet = createCanvas(canvasWidth, canvasHeight);
      const context = sheet.getContext('2d');
      context.fillStyle = '#F4F4F2';
      context.fillRect(0, 0, canvasWidth, canvasHeight);
      for (const [offset, entry] of group.entries()) {
        const row = Math.floor(offset / SHEET_COLUMNS);
        const column = offset % SHEET_COLUMNS;
        const x = SHEET_MARGIN + column * (pageWidth + SHEET_GAP);
        const y = SHEET_MARGIN + row * (cellHeight + SHEET_LABEL_HEIGHT + SHEET_GAP);
        const image = await loadImage(entry.png);
        context.drawImage(image, x, y, pageWidth, cellHeight);
        drawLabel(context, x, y + cellHeight, pageWidth, `P${entry.page} / ${total}`);
      }
      sheets.push({
        png: sheet.toBuffer(PNG),
        width: canvasWidth,
        height: canvasHeight,
        from: group[0].page,
        to: group[group.length - 1].page,
      });
      sheet.dispose?.();
    }
    return { total, sheets, pages: [] };
  } finally {
    try { await loadingTask.destroy?.(); } catch { /* no-op */ }
  }
}

/** 附件服务声明的图像上限，取部署值与本地上限的较小者。 */
export function imagePolicy(attachments) {
  const limits = attachments?.imageLimits;
  if (!limits?.mediaTypes?.includes(PNG)) return null;
  const pick = (value, fallback) => (Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback);
  const maxBytes = pick(limits.maxImageBytes, MAX_IMAGE_BYTES);
  const maxDimension = pick(limits.maxImageDimension, MAX_PAGE_DIMENSION);
  if (maxBytes < 1 || maxDimension < 1) return null;
  return { maxBytes, maxDimension };
}

/** 渲染产物的模型面输出：文本摘要 + 每张图一个 image block。 */
export const presentationRenderOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => {
    const lines = [
      `课件渲染：${value.状态}`,
      `文件：${value.文件}`,
      `文件SHA256：${value.文件SHA256}`,
      `视觉检查：${value.视觉检查}；渲染成功不等于模型已经看图或审美合格。`,
      `覆盖页：${value.覆盖页?.join(', ') ?? ''}；未覆盖页：${value.未覆盖页?.join(', ') || '无'}`,
      `当前模型：${value.模型?.provider}/${value.模型?.model}（目录声明可接收图像，非真实端点验证）`,
      `总页数：${value.总页数}`,
      value.模式 === 'overview'
        ? `概览宫格：${value.宫格数} 张（每张最多 9 页，标注了页号）`
        : `单页渲染：第 ${value.渲染页} 页`,
      value.说明,
    ].filter(Boolean);
    const blocks = [{ type: 'text', text: lines.join('\n') }];
    for (const image of value.图像 ?? []) blocks.push({ type: 'image', attachment: image });
    return blocks;
  },
};

async function resolveVisualRoute(service, exec) {
  const config = exec?.agent?.session?.requestHeader?.()?.config;
  const provider = config?.provider ?? exec?.agent?.options?.provider;
  const model = config?.model ?? exec?.agent?.options?.model;
  const llm = service('llm');
  if (!provider || !model || !llm?.resolveModelInfo) {
    throw new Error('无法确认当前模型的图像输入能力，视觉未核验。请选用已配置且声明支持图像输入的模型。');
  }
  const info = await llm.resolveModelInfo(provider, model, exec?.signal);
  if (!info?.inputModalities?.includes('image')) {
    throw new Error(`当前模型 ${provider}/${model} 未声明图像输入，不能把渲染成功当成看图成功。视觉未核验，请选用已配置的视觉模型。`);
  }
  return { provider, model };
}

/**
 * 注册 mochi_ppt_render。只在附件服务已挂载、且当前模型声明了图像输入时
 * 才有意义；否则工具会被注册但执行时明确拒绝并给出可读原因。
 */
export function registerPresentationRenderTool(ctx, { resolvePath, resolveSofficePath } = {}) {
  const service = (name) => (typeof ctx?.get === 'function' ? ctx.get(name) : undefined);

  ctx.tools.register(defineTool({
    name: 'mochi_ppt_render',
    description: '把已生成的 .pptx 课件渲染成图片交给自己「看一眼」：overview 模式把整册拼成每 9 页一张的宫格图，用于判断整体版式节奏、留白与密度是否失衡；page 模式渲染指定单页的原尺寸图，用于核对文字是否溢出、元素是否重叠、配色是否失衡。生成或修改课件后应当调用它做视觉自检，实际查看返回的图像附件，不等用户提醒。overview 不能替代小字细节检查；未覆盖页须补看，密集页和图表页用 page 查看。只修改观察到的缺陷；首次通过不必修改。有问题用 mochi_ppt_revise 改，使用最新产物路径复验，每个问题最多两轮；仍有硬缺陷标为待修稿。若渲染图与预期不符，以渲染图为准。当本机没有 LibreOffice、或当前模型不支持图像输入时，本工具会明确说明原因而不是假装看过。',
    parameters: {
      filePath: { type: 'string', required: true, description: '要渲染的 .pptx 绝对路径（用 create/revise 返回的产物路径，不要凭记忆拼）。' },
      mode: { type: 'string', description: 'overview = 整册宫格概览（默认）；page = 单页细节。' },
      page: { type: 'integer', description: 'mode=page 时的页码（第 1 页 = 1）。' },
    },
    output: presentationRenderOutput,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const signal = exec?.signal;
      const requested = String(args.filePath || '').trim();
      if (!requested) throw new Error('请给出要渲染的 .pptx 绝对路径（filePath）。');
      const filePath = resolvePath ? await resolvePath(requested, exec) : requested;

      const info = await stat(filePath).catch(() => undefined);
      if (!info?.isFile()) throw new Error(`找不到要渲染的文件：${filePath}`);
      if (!filePath.toLowerCase().endsWith('.pptx')) {
        throw new Error('只能渲染 .pptx 文件；这个路径不是 PowerPoint 演示文稿。');
      }
      if (info.size > MAX_PPTX_BYTES) throw new Error('该 .pptx 超过渲染上限，请确认文件是否正常。');

      // 能力与依赖先于重活检查，避免白跑一次 LibreOffice 才发现模型看不了图。
      const attachments = service('attachments');
      const policy = imagePolicy(attachments);
      if (!policy) throw new Error('当前附件服务不接受 PNG 图像，无法把渲染结果交给模型查看。');

      const route = await resolveVisualRoute(service, exec);
      throwIfAborted(signal);
      const soffice = resolveSoffice(resolveSofficePath);
      if (!soffice) {
        throw new Error('本机没有找到 LibreOffice（soffice），无法把 .pptx 渲染成图。请安装 LibreOffice 后重试；这之前无法对课件做视觉自检。');
      }

      const mode = String(args.mode || 'overview').toLowerCase() === 'page' ? 'page' : 'overview';
      const page = mode === 'page' ? Number(args.page) : undefined;
      if (mode === 'page' && !Number.isInteger(page)) {
        throw new Error('mode=page 时必须给出整数页码 page。');
      }

      const workDir = await mkdtemp(join(tmpdir(), 'mochi-ppt-render-'));
      try {
        throwIfAborted(signal);
        const source = await readFile(filePath, { signal });
        if (source.length > MAX_PPTX_BYTES) throw new Error('该 .pptx 超过渲染上限。');
        const sourceHash = createHash('sha256').update(source).digest('hex');
        const snapshot = join(workDir, 'source.pptx');
        await writeFile(snapshot, source, { signal });
        const pdfPath = await convertToPdf(snapshot, workDir, soffice, signal);
        const rendered = await renderPresentationImages({ pdfPath, page, signal });
        throwIfAborted(signal);

        const images = [];
        const describe = [];
        const save = async (png, name, label) => {
          if (png.byteLength > policy.maxBytes) {
            throw new Error('渲染出的图像超过当前部署的字节上限，请改用 page 模式逐页核对。');
          }
          const ref = await attachments.saveImage({ data: png, mediaType: PNG, name });
          images.push(ref);
          describe.push(label);
        };

        if (mode === 'page') {
          const entry = rendered.pages[0];
          await save(entry.png, `mochi-slide-p${entry.page}.png`, `第 ${entry.page} 页`);
        } else {
          for (const [index, sheet] of rendered.sheets.entries()) {
            await save(
              sheet.png,
              `mochi-deck-overview-${index + 1}-p${sheet.from}-${sheet.to}.png`,
              `第 ${sheet.from}–${sheet.to} 页宫格`,
            );
          }
        }

        const currentHash = createHash('sha256').update(await readFile(filePath, { signal })).digest('hex');
        if (currentHash !== sourceHash) throw new Error('渲染期间原文件发生变化，请对最新文件重新渲染；旧图不能用作最新版验收证据。');
        const covered = mode === 'page' ? [page] : rendered.sheets.flatMap((sheet) => Array.from({ length: sheet.to - sheet.from + 1 }, (_, index) => sheet.from + index));
        const uncovered = Array.from({ length: rendered.total }, (_, index) => index + 1).filter((number) => !covered.includes(number));
        const truncated = mode === 'overview' && rendered.total > rendered.sheets.length * SHEET_CAPACITY;
        return {
          状态: '已渲染',
          视觉检查: '待模型查看',
          文件SHA256: sourceHash,
          模型: route,
          覆盖页: covered,
          未覆盖页: uncovered,
          文件: filePath,
          总页数: rendered.total,
          模式: mode,
          ...(mode === 'page' ? { 渲染页: page } : { 宫格数: rendered.sheets.length }),
          图像: images.map((ref) => ({
            attachmentId: ref.attachmentId,
            mediaType: ref.mediaType,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            ...(ref.name === undefined ? {} : { name: ref.name }),
          })),
          说明: [
            `渲染覆盖：${describe.join('、')}。`,
            truncated ? `仅渲染了前 ${rendered.sheets.length * SHEET_CAPACITY} 页；其余页需要时用 page 模式单独渲染。` : '',
            '请按「版式是否失衡、文字是否溢出、元素是否重叠、配色是否可读」逐项检查；发现问题用 mochi_ppt_revise 修正后再渲染复验。',
          ].filter(Boolean).join(''),
        };
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  }));
}
