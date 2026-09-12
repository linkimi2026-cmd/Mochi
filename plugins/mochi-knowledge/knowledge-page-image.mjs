// 受管教材单页图像：只从已经导入的 bookId + PDF 页号生成一个有界 PNG，交给既有附件服务保存。
// 不接受模型提供的文件路径或 URL；模型未声明图像输入时只返回同源原页核对入口。
import { readFile, stat } from 'node:fs/promises';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { managedOriginalPageUrl } from './knowledge-host-bridge.mjs';

const MAX_SOURCE_PDF_BYTES = 128 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 1_400;
const MAX_RENDER_PIXELS = 1_500_000;
const MAX_RENDER_BYTES = 2 * 1024 * 1024;
const MAX_RENDER_ATTEMPTS = 3;
const MAX_CACHE_ENTRIES = 4;
const PAGE_IMAGE_MEDIA_TYPE = 'image/png';

let renderTail = Promise.resolve();
const pageImageCache = new Map();

const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: [PAGE_IMAGE_MEDIA_TYPE], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
};

export const knowledgePageImageOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => {
    const text = [
      `受管教材页：${value.书名}`,
      `教材ID：${value.教材ID}`,
      `学科：${value.学科}`,
      `册别：${value.册别}`,
      `PDF页号：${value.PDF页号}`,
      `印刷页号：${value.印刷页号 ?? '未识别'}`,
      `状态：${value.状态}`,
      value.原页核对?.URL ? `同源原页核对：${value.原页核对.URL}` : undefined,
      value.来源?.commit ? `来源commit：${value.来源.commit}` : undefined,
      value.来源?.URL ? `来源URL：${value.来源.URL}` : undefined,
      value.说明,
    ].filter(Boolean).join('\n');
    return value.图像 === undefined
      ? [{ type: 'text', text }]
      : [{ type: 'text', text }, { type: 'image', attachment: value.图像 }];
  },
};

function fixedAbortError() {
  const error = new Error('教材页图像生成已取消。');
  error.name = 'AbortError';
  error.code = 'ABORTED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw fixedAbortError();
}

function service(ctx, name) {
  return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name];
}

function positiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function imagePolicy(attachments) {
  const limits = attachments?.imageLimits;
  if (!limits?.mediaTypes?.includes(PAGE_IMAGE_MEDIA_TYPE)) return null;
  const maxBytes = Math.min(
    MAX_RENDER_BYTES,
    positiveLimit(limits.maxImageBytes, MAX_RENDER_BYTES),
    positiveLimit(limits.maxMessageImageBytes, MAX_RENDER_BYTES),
  );
  const maxDimension = Math.min(MAX_RENDER_DIMENSION, positiveLimit(limits.maxImageDimension, MAX_RENDER_DIMENSION));
  const maxPixels = Math.min(MAX_RENDER_PIXELS, positiveLimit(limits.maxImagePixels, MAX_RENDER_PIXELS));
  if (maxBytes < 1 || maxDimension < 1 || maxPixels < 1) return null;
  return { maxBytes, maxDimension, maxPixels };
}

function originalPageReference(page) {
  return {
    类型: '受管PDF原页',
    URL: managedOriginalPageUrl(page.bookId, page.pdfPage),
    PDF页号: page.pdfPage,
  };
}

function sourceCitation(page) {
  return {
    commit: page.sourceCommit,
    URL: page.sourceUrl,
    GitBlobSHA: page.sourceBlobHashes,
    文件SHA256: page.sourceSha256,
    版次核验状态: page.editionStatus,
  };
}

function unavailablePageImage(page, status, explanation) {
  return {
    状态: status,
    教材ID: page.bookId,
    书名: page.title,
    学科: page.subject,
    册别: page.volume,
    PDF页号: page.pdfPage,
    印刷页号: page.printedPage,
    印刷页号状态: page.printedPageStatus,
    识别状态: page.recognitionStatus,
    原页核对: originalPageReference(page),
    来源: sourceCitation(page),
    说明: explanation,
  };
}

async function imageCapability(ctx, exec) {
  const routed = exec?.agent?.session?.requestHeader?.()?.config;
  const provider = routed?.provider ?? exec?.agent?.options?.provider;
  const model = routed?.model ?? exec?.agent?.options?.model;
  const llm = service(ctx, 'llm');
  if (!provider || !model || !llm?.resolveModelInfo) return false;
  try {
    const info = await llm.resolveModelInfo(provider, model, exec?.signal);
    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image');
  } catch {
    // A route whose image capability is unknown must not receive an attachment.
    return false;
  }
}

function cacheKey(page, policy) {
  return `${page.sourceSha256}:${page.pdfPage}:${policy.maxBytes}:${policy.maxDimension}:${policy.maxPixels}`;
}

function rememberRenderedPage(key, value) {
  pageImageCache.delete(key);
  pageImageCache.set(key, value);
  while (pageImageCache.size > MAX_CACHE_ENTRIES) pageImageCache.delete(pageImageCache.keys().next().value);
}

function serializeRender(signal, action) {
  const previous = renderTail.catch(() => undefined);
  let release;
  renderTail = new Promise((resolve) => { release = resolve; });
  return (async () => {
    await previous;
    try {
      throwIfAborted(signal);
      return await action();
    } finally {
      release();
    }
  })();
}

async function loadRendererDependencies() {
  try {
    const [pdfjs, canvas] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas'),
    ]);
    if (typeof pdfjs.getDocument !== 'function' || typeof canvas.createCanvas !== 'function') throw new Error('missing renderer exports');
    return { pdfjs, createCanvas: canvas.createCanvas };
  } catch {
    throw new Error('当前运行包没有可用的教材页图像渲染依赖；请打开受管 PDF 原页核对。');
  }
}

function scaleFor(baseViewport, policy, attempt) {
  const baseWidth = Math.max(1, Number(baseViewport.width));
  const baseHeight = Math.max(1, Number(baseViewport.height));
  const initial = Math.min(
    1.25,
    policy.maxDimension / Math.max(baseWidth, baseHeight),
    Math.sqrt(policy.maxPixels / (baseWidth * baseHeight)),
  );
  return initial * (0.72 ** attempt);
}

async function renderTrustedPage(page, policy, signal) {
  const key = cacheKey(page, policy);
  const cached = pageImageCache.get(key);
  if (cached) return cached;
  return serializeRender(signal, async () => {
    const afterWait = pageImageCache.get(key);
    if (afterWait) return afterWait;
    const sourceInfo = await stat(page.internalPdfPath);
    if (!sourceInfo.isFile() || sourceInfo.size > MAX_SOURCE_PDF_BYTES) {
      throw new Error('该受管教材原页超过安全图像渲染限制；请打开受管 PDF 原页核对。');
    }
    const { pdfjs, createCanvas } = await loadRendererDependencies();
    throwIfAborted(signal);
    const data = new Uint8Array(await readFile(page.internalPdfPath, { signal }));
    throwIfAborted(signal);
    const loadingTask = pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false, stopAtErrors: true, verbosity: 0 });
    let documentHandle;
    let pdfPage;
    let renderTask;
    const abort = () => {
      try { renderTask?.cancel?.(); } catch { /* cancellation is best-effort */ }
      void loadingTask.destroy?.().catch?.(() => {});
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      documentHandle = await loadingTask.promise;
      throwIfAborted(signal);
      pdfPage = await documentHandle.getPage(page.pdfPage);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      for (let attempt = 0; attempt < MAX_RENDER_ATTEMPTS; attempt += 1) {
        throwIfAborted(signal);
        const scale = scaleFor(baseViewport, policy, attempt);
        if (!Number.isFinite(scale) || scale <= 0) break;
        const viewport = pdfPage.getViewport({ scale });
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        if (width > policy.maxDimension || height > policy.maxDimension || width * height > policy.maxPixels) continue;
        const canvas = createCanvas(width, height);
        try {
          const context = canvas.getContext('2d');
          renderTask = pdfPage.render({ canvasContext: context, viewport });
          await renderTask.promise;
          throwIfAborted(signal);
          const png = canvas.toBuffer(PAGE_IMAGE_MEDIA_TYPE);
          if (png.byteLength <= policy.maxBytes) {
            const rendered = { data: png, width, height };
            rememberRenderedPage(key, rendered);
            return rendered;
          }
        } finally {
          renderTask = undefined;
          canvas.dispose?.();
        }
      }
      throw new Error('受管教材页图像超过当前部署的尺寸或字节限制；请打开受管 PDF 原页核对。');
    } catch (error) {
      if (signal?.aborted) throw fixedAbortError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      try { pdfPage?.cleanup?.(); } catch { /* no-op */ }
      try { documentHandle?.cleanup?.(); } catch { /* no-op */ }
      try { await loadingTask.destroy?.(); } catch { /* no-op */ }
    }
  });
}

function imageValue(ref) {
  if (!ref || typeof ref.attachmentId !== 'string' || ref.mediaType !== PAGE_IMAGE_MEDIA_TYPE
    || !Number.isSafeInteger(ref.bytes) || !Number.isSafeInteger(ref.width) || !Number.isSafeInteger(ref.height)) {
    throw new Error('教材页图像附件未能保存；请打开受管 PDF 原页核对。');
  }
  return {
    attachmentId: ref.attachmentId,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(typeof ref.name === 'string' ? { name: ref.name } : {}),
    ...(ref.originalDimensions && Number.isSafeInteger(ref.originalDimensions.width) && Number.isSafeInteger(ref.originalDimensions.height)
      ? { originalDimensions: { width: ref.originalDimensions.width, height: ref.originalDimensions.height } }
      : {}),
  };
}

/** Register a model-facing visual original-page tool only while attachments are mounted. */
export function registerKnowledgePageImageTool(ctx, store) {
  ctx.tools.register(defineTool({
    name: 'mochi_knowledge_page_image',
    description: '将已命中教材的一页渲染为受管 PNG 图像，供当前明确声明支持图像输入的模型核对公式、图表和版面。只能使用 mochi_knowledge_search 返回的教材ID和PDF页号；不能传入文件路径或 URL。单页渲染固定限尺寸、限字节并串行执行，最多缓存少量受管页面。当前模型未声明图像能力、附件服务不可用或图像超限时，不生成或保存图像，只返回同源受管 PDF 原页核对入口。',
    parameters: {
      bookId: { type: 'string', required: true, description: '来自 mochi_knowledge_search 的教材ID。' },
      pdfPage: { type: 'integer', required: true, description: '来自 mochi_knowledge_search 的 PDF 页号。' },
    },
    output: knowledgePageImageOutput,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const page = store.getPageForReview(String(args.bookId || ''), Number(args.pdfPage));
      const attachments = service(ctx, 'attachments');
      const policy = imagePolicy(attachments);
      if (!policy) {
        return unavailablePageImage(page, '当前附件服务不接受 PNG 教材页图像', '未读取或保存图像；请打开同源受管 PDF 原页，由人核对公式、图表和精确措辞。');
      }
      if (!await imageCapability(ctx, exec)) {
        return unavailablePageImage(page, '当前模型未声明图像输入能力', '未生成或保存图像；请打开同源受管 PDF 原页，由人核对公式、图表和精确措辞。');
      }
      try {
        const rendered = await renderTrustedPage(page, policy, exec?.signal);
        throwIfAborted(exec?.signal);
        const ref = await attachments.saveImage({
          data: rendered.data,
          mediaType: PAGE_IMAGE_MEDIA_TYPE,
          name: `mochi-textbook-${page.bookId.slice(-12)}-p${page.pdfPage}.png`,
        });
        throwIfAborted(exec?.signal);
        return {
          状态: '已生成受管教材页图像',
          教材ID: page.bookId,
          书名: page.title,
          学科: page.subject,
          册别: page.volume,
          PDF页号: page.pdfPage,
          印刷页号: page.printedPage,
          印刷页号状态: page.printedPageStatus,
          识别状态: page.recognitionStatus,
          原页核对: originalPageReference(page),
          来源: sourceCitation(page),
          图像: imageValue(ref),
          说明: '图像来自受管教材的指定 PDF 页；公式、图表和精确原文仍应与同源原页核对。',
        };
      } catch (error) {
        if (error?.name === 'AbortError' || error?.code === 'ABORTED') throw error;
        return unavailablePageImage(page, '未生成受管教材页图像', '未暴露失败细节或本机路径；请打开同源受管 PDF 原页核对。');
      }
    },
  }));
}
