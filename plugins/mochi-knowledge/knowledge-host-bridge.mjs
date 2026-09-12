// 经既有 Connection 网关暴露的受管教材原页。路径只由已导入 bookId + PDF 页号映射，绝不接受文件路径。
import { readFile } from 'node:fs/promises';

export const KNOWLEDGE_PAGE_PATH = '/api/mochi-knowledge/page';

function response(status, body = null, headers = {}) {
  return new Response(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

function pageRequest(request) {
  const url = new URL(request.url);
  const allowed = new Set(['bookId', 'pdfPage']);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) return null;
  const bookId = url.searchParams.get('bookId');
  const rawPage = url.searchParams.get('pdfPage');
  if (bookId === null || rawPage === null || !/^\d+$/u.test(rawPage)) return null;
  const pdfPage = Number(rawPage);
  if (!Number.isSafeInteger(pdfPage) || pdfPage < 1 || pdfPage > 20_000) return null;
  return { bookId, pdfPage };
}

/** Build the same-origin URL that opens the matching PDF at its validated page. */
export function managedOriginalPageUrl(bookId, pdfPage) {
  const params = new URLSearchParams({ bookId: String(bookId), pdfPage: String(pdfPage) });
  return `${KNOWLEDGE_PAGE_PATH}?${params.toString()}#page=${pdfPage}`;
}

/**
 * Register one exact, authenticated GET route. Connection applies its Host/Origin
 * fence and browser-session authentication before this handler executes.
 */
export function installKnowledgePageBridge(ctx, store) {
  if (!ctx?.connection?.fetch?.register || !store?.getPageForReview) {
    throw new TypeError('mochi-knowledge requires the authenticated Connection fetch service for original-page viewing.');
  }
  return ctx.connection.fetch.register({
    path: KNOWLEDGE_PAGE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method !== 'GET') return response(405, null, { allow: 'GET' });
      const input = pageRequest(request);
      if (!input) return response(400);
      let page;
      try {
        page = store.getPageForReview(input.bookId, input.pdfPage);
      } catch {
        // Do not distinguish invalid IDs from missing pages or disclose any filesystem detail.
        return response(404);
      }
      let bytes;
      try {
        bytes = await readFile(page.internalPdfPath);
      } catch {
        return response(404);
      }
      const fileName = `mochi-textbook-${page.bookId.slice(-12)}.pdf`;
      return response(200, bytes, {
        'content-type': 'application/pdf',
        'content-length': String(bytes.byteLength),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
        'x-mochi-pdf-page': String(page.pdfPage),
      });
    },
  });
}
