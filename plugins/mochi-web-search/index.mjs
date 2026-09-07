export const name = 'mochi-web-search';
export const inject = ['web'];
export const PROVIDER_ID = 'mochi-free-web';

const DEFAULT_WIKIPEDIA_API = 'https://zh.wikipedia.org/w/api.php';
const DEFAULT_OPENALEX_API = 'https://api.openalex.org/works';
const DEFAULT_CROSSREF_API = 'https://api.crossref.org/works';
const DEFAULT_ARXIV_API = 'https://export.arxiv.org/api/query';
const MAX_BYTES = 1_000_000;

// 权威域名加权目录（不再是过滤白名单）：命中的来源在排序中加分，
// 未命中的来源照常保留。加分规则见 domainAuthority()。
export const TEACHER_AUTHORITY_DOMAINS = Object.freeze([
  'basic.smartedu.cn',
  'fltrp.com',
  'moe.gov.cn',
  'openstax.org',
  'pep.com.cn',
]);

function failure(code, message, cause) { const error = new Error(message, cause ? { cause } : undefined); error.code = code; return error; }
function endpoint(value, label) {
  if (value === undefined) return undefined;
  let url; try { url = new URL(value); } catch { throw failure('WEB_PROVIDER_CONFIG_INVALID', `${label} must be an absolute HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw failure('WEB_PROVIDER_CONFIG_INVALID', `${label} must be an HTTP(S) URL without credentials`);
  return url;
}

export function normalizeTrustedDomain(value) {
  if (typeof value !== 'string') throw failure('WEB_PROVIDER_CONFIG_INVALID', 'trustedDomains entries must be DNS domain names');
  const domain = value.trim().toLowerCase().replace(/\.+$/, '');
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw failure('WEB_PROVIDER_CONFIG_INVALID', 'trustedDomains entries must be DNS domain names');
  }
  return domain;
}

function trustedDomains(value) {
  if (!Array.isArray(value) || value.length === 0) throw failure('WEB_PROVIDER_CONFIG_INVALID', 'trustedDomains must contain at least one DNS domain name');
  return Object.freeze([...new Set(value.map(normalizeTrustedDomain))]);
}

export function isTrustedHostname(hostname, domains = TEACHER_AUTHORITY_DOMAINS) {
  let normalized;
  try { normalized = normalizeTrustedDomain(hostname); } catch { return false; }
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

// 域名权威度权重（0-0.55）：排序加权用，不再用于丢弃结果。
export function domainAuthority(hostname, domains = TEACHER_AUTHORITY_DOMAINS) {
  if (typeof hostname !== 'string' || !hostname) return 0;
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (isTrustedHostname(host, domains)) return 0.55;
  if (host === 'doi.org' || host.endsWith('.doi.org')) return 0.5;
  if (/(^|\.)gov\.cn$/.test(host) || /(^|\.)edu\.cn$/.test(host)) return 0.45;
  if (/(^|\.)gov$/.test(host) || /(^|\.)edu$/.test(host) || /(^|\.)ac\.[a-z]{2,3}$/.test(host)) return 0.35;
  return 0;
}

function validSourceUrl(value) {
  let url; try { url = new URL(value); } catch { return undefined; }
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== defaultPort)) return undefined;
  return url;
}

// 去重键：去掉协议与常见追踪参数后的规范 URL。
// 保留主机名原样：www 与非 www 不合并（二者可能是不同内容），防止误丢来源。
function canonicalUrlKey(url) {
  const u = new URL(url.href);
  const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from', 'ref'];
  for (const key of drop) u.searchParams.delete(key);
  u.hash = '';
  return u.hostname.toLowerCase() + u.pathname.replace(/\/+$/, '') + (u.search || '');
}

function clean(value, max = 800) {
  if (typeof value !== 'string') return undefined;
  const decoded = value.replace(/<[^>]*>/g, ' ').replaceAll('&quot;', '"').replaceAll('&#039;', "'").replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replace(/\s+/g, ' ').trim();
  return decoded ? decoded.slice(0, max) : undefined;
}
function requestShape(request) {
  if (!request || typeof request.query !== 'string' || !request.query.trim() || request.query.length > 500) throw failure('WEB_SEARCH_INVALID_REQUEST', 'query must contain 1-500 characters');
  if (request.maxResults !== undefined && (!Number.isSafeInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > 20)) throw failure('WEB_SEARCH_INVALID_REQUEST', 'maxResults must be an integer from 1 to 20');
  return { query: request.query.trim(), limit: request.maxResults ?? 8 };
}
async function json(url, { signal, timeoutMs, accept = 'application/json' }) {
  const timeout = AbortSignal.timeout(timeoutMs); const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try { response = await fetch(url, { signal: combined, redirect: 'error', headers: { accept, 'user-agent': 'Mochi-Web-Search/0.1.0' } }); }
  catch (error) { if (signal?.aborted) throw failure('WEB_SEARCH_ABORTED', 'web search was cancelled', error); if (timeout.aborted) throw failure('WEB_SEARCH_TIMEOUT', 'web search timed out', error); throw failure('WEB_SEARCH_NETWORK_ERROR', 'web search endpoint was unreachable', error); }
  if (!response.ok) throw failure('WEB_SEARCH_HTTP_ERROR', `web search endpoint returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length')); if (Number.isFinite(declared) && declared > MAX_BYTES) { await response.body?.cancel(); throw failure('WEB_SEARCH_RESPONSE_TOO_LARGE', 'web search response exceeded the size limit'); }
  const reader = response.body?.getReader(); if (!reader) throw failure('WEB_SEARCH_INVALID_RESPONSE', 'web search endpoint returned no body');
  const chunks = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_BYTES) { await reader.cancel(); throw failure('WEB_SEARCH_RESPONSE_TOO_LARGE', 'web search response exceeded the size limit'); } chunks.push(value); } }
  catch (error) { if (error?.code === 'WEB_SEARCH_RESPONSE_TOO_LARGE') throw error; if (signal?.aborted) throw failure('WEB_SEARCH_ABORTED', 'web search was cancelled', error); if (timeout.aborted) throw failure('WEB_SEARCH_TIMEOUT', 'web search timed out', error); throw failure('WEB_SEARCH_NETWORK_ERROR', 'web search response stream failed', error); }
  const text = new TextDecoder().decode(Buffer.concat(chunks.map((part) => Buffer.from(part))));
  if (accept === 'application/atom+xml' || accept === 'application/xml') return text;
  try { return JSON.parse(text); } catch (error) { throw failure('WEB_SEARCH_INVALID_RESPONSE', 'web search endpoint returned invalid JSON', error); }
}

// 各源统一产出候选：{ url, title?, snippet?, publishedAt?, rankScore }
function mapSearx(payload, limit) {
  if (!payload || !Array.isArray(payload.results)) throw failure('WEB_SEARCH_INVALID_RESPONSE', 'SearXNG response is missing results');
  const candidates = []; let position = 0;
  for (const item of payload.results) {
    if (typeof item?.url !== 'string') continue;
    const url = validSourceUrl(item.url); if (!url) continue;
    position += 1;
    const engineScore = typeof item.score === 'number' && Number.isFinite(item.score) && item.score > 0 ? Math.min(item.score, 8) / 8 : Math.max(0.01, 0.16 - position * 0.01);
    candidates.push({ url: url.href, ...(clean(item.title, 300) ? { title: clean(item.title, 300) } : {}), ...(clean(item.content) ? { snippet: clean(item.content) } : {}), ...(typeof item.publishedDate === 'string' ? { publishedAt: item.publishedDate } : {}), rankScore: engineScore });
    if (candidates.length >= limit * 3) break;
  }
  return candidates;
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return undefined;
  const positions = [];
  for (const [word, idxs] of Object.entries(invertedIndex)) { if (Array.isArray(idxs)) for (const idx of idxs) positions.push([idx, word]); }
  if (!positions.length) return undefined;
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, word]) => word).join(' ');
}

function mapOpenAlex(payload, limit) {
  const rows = payload?.results; if (!Array.isArray(rows)) throw failure('WEB_SEARCH_INVALID_RESPONSE', 'OpenAlex response is missing results');
  const candidates = [];
  for (const row of rows.slice(0, limit * 2)) {
    const rawUrl = typeof row?.doi === 'string' ? row.doi : row?.primary_location?.landing_page_url;
    if (typeof rawUrl !== 'string') continue;
    const url = validSourceUrl(rawUrl); if (!url) continue;
    const abstract = reconstructAbstract(row.abstract_inverted_index);
    candidates.push({ url: url.href, ...(clean(row.display_name, 300) ? { title: clean(row.display_name, 300) } : {}), ...(clean(abstract) ? { snippet: clean(abstract) } : {}), ...(typeof row.publication_date === 'string' ? { publishedAt: row.publication_date } : {}), rankScore: 0.6, sourceLabel: 'OpenAlex' });
  }
  return candidates;
}

function mapCrossref(payload, limit) {
  const rows = payload?.message?.items; if (!Array.isArray(rows)) throw failure('WEB_SEARCH_INVALID_RESPONSE', 'Crossref response is missing items');
  const candidates = [];
  for (const row of rows.slice(0, limit * 2)) {
    const rawUrl = typeof row?.URL === 'string' ? row.URL : (typeof row?.DOI === 'string' ? `https://doi.org/${row.DOI}` : undefined);
    if (typeof rawUrl !== 'string') continue;
    const url = validSourceUrl(rawUrl); if (!url) continue;
    const title = Array.isArray(row.title) ? row.title[0] : undefined;
    const venue = Array.isArray(row['container-title']) ? row['container-title'][0] : undefined;
    const snippetParts = [venue, typeof row.type === 'string' ? row.type : undefined].filter(Boolean);
    const published = row.published?.['date-parts']?.[0]?.join('-');
    candidates.push({ url: url.href, ...(clean(title, 300) ? { title: clean(title, 300) } : {}), ...(snippetParts.length ? { snippet: clean(snippetParts.join(' · '), 300) } : {}), ...(published ? { publishedAt: published } : {}), rankScore: 0.5, sourceLabel: 'Crossref' });
  }
  return candidates;
}

function mapArxiv(atomText, limit) {
  if (typeof atomText !== 'string' || !atomText.includes('<entry')) throw failure('WEB_SEARCH_INVALID_RESPONSE', 'arXiv response is missing entries');
  const candidates = [];
  const entries = atomText.split(/<entry[ >]/).slice(1);
  for (const entry of entries.slice(0, limit * 2)) {
    const idMatch = entry.match(/<id>([^<]+)<\/id>/); if (!idMatch) continue;
    const url = validSourceUrl(idMatch[1].trim()); if (!url) continue;
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1];
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    candidates.push({ url: url.href, ...(clean(title, 300) ? { title: clean(title, 300) } : {}), ...(clean(summary) ? { snippet: clean(summary) } : {}), ...(published ? { publishedAt: published.trim().slice(0, 10) } : {}), rankScore: 0.55, sourceLabel: 'arXiv' });
  }
  return candidates;
}

function mapWikipedia(payload, limit, articleOrigin) {
  const rows = payload?.query?.search; if (!Array.isArray(rows)) throw failure('WEB_SEARCH_INVALID_RESPONSE', 'Wikipedia response is missing search results');
  return rows.slice(0, limit).filter((row) => Number.isSafeInteger(row?.pageid)).map((row) => ({ url: new URL(`/?curid=${row.pageid}`, articleOrigin).href, ...(clean(row.title, 300) ? { title: clean(row.title, 300) } : {}), ...(clean(row.snippet) ? { snippet: clean(row.snippet) } : {}) }));
}

// 合并排序：权威域名加权 + 去重。来源精度 = 加权，不是过滤。
function mergeRank(groups, domains, limit) {
  const byKey = new Map();
  for (const candidates of groups) {
    for (const candidate of candidates) {
      let url; try { url = new URL(candidate.url); } catch { continue; }
      const key = canonicalUrlKey(url);
      const authority = domainAuthority(url.hostname, domains);
      const score = candidate.rankScore + authority;
      const existing = byKey.get(key);
      if (!existing || score > existing.score) byKey.set(key, { ...candidate, score });
    }
  }
  const ranked = [...byKey.values()].sort((a, b) => b.score - a.score);
  return { sources: ranked.slice(0, limit).map(({ score, rankScore, ...rest }) => rest), truncated: ranked.length > limit };
}

function scopeText(active, degraded) {
  const labels = { searxng: 'SearXNG 全网', openalex: 'OpenAlex', crossref: 'Crossref', arxiv: 'arXiv', wikipedia: '中文维基百科' };
  const used = active.map((key) => labels[key]).filter(Boolean).join(' + ') || '无可用源';
  const note = degraded.length ? `（${degraded.map((key) => labels[key]).filter(Boolean).join('、')} 本次未返回可用结果）` : '';
  return `检索范围：${used}${note}；权威域名加权排序。仅链接与检索摘要可引用，未取得教材正文或配套资源的复制授权。`;
}

export class FreeWebSearchProvider {
  id = PROVIDER_ID;
  constructor(options = {}) {
    const envSearxngEndpoint = typeof process.env.MOCHI_SEARXNG_ENDPOINT === 'string' && process.env.MOCHI_SEARXNG_ENDPOINT.trim()
      ? process.env.MOCHI_SEARXNG_ENDPOINT
      : undefined;
    this.searxngEndpoint = endpoint(options.searxngEndpoint ?? envSearxngEndpoint, 'searxngEndpoint');
    this.wikipediaApi = endpoint(options.wikipediaApi ?? DEFAULT_WIKIPEDIA_API, 'wikipediaApi');
    this.openalexApi = endpoint(options.openalexApi ?? DEFAULT_OPENALEX_API, 'openalexApi');
    this.crossrefApi = endpoint(options.crossrefApi ?? DEFAULT_CROSSREF_API, 'crossrefApi');
    this.arxivApi = endpoint(options.arxivApi ?? DEFAULT_ARXIV_API, 'arxivApi');
    this.mailto = typeof options.mailto === 'string' && options.mailto.includes('@') ? options.mailto : (typeof process.env.MOCHI_WEB_SEARCH_MAILTO === 'string' && process.env.MOCHI_WEB_SEARCH_MAILTO.includes('@') ? process.env.MOCHI_WEB_SEARCH_MAILTO : undefined);
    this.trustedDomains = trustedDomains(options.trustedDomains ?? TEACHER_AUTHORITY_DOMAINS);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 250 || this.timeoutMs > 30_000) throw failure('WEB_PROVIDER_CONFIG_INVALID', 'timeoutMs must be 250-30000');
  }
  available() { return true; }
  async search(request, signal) {
    const { query, limit } = requestShape(request);
    const tasks = []; const names = [];
    if (this.searxngEndpoint) {
      const url = new URL(this.searxngEndpoint); url.searchParams.set('q', query); url.searchParams.set('format', 'json'); url.searchParams.set('language', 'zh-CN');
      names.push('searxng'); tasks.push(json(url, { signal, timeoutMs: this.timeoutMs }).then((payload) => mapSearx(payload, limit)));
    }
    {
      const url = new URL(this.openalexApi); url.searchParams.set('search', query); url.searchParams.set('per-page', String(Math.min(limit, 25))); if (this.mailto) url.searchParams.set('mailto', this.mailto);
      names.push('openalex'); tasks.push(json(url, { signal, timeoutMs: this.timeoutMs }).then((payload) => mapOpenAlex(payload, limit)));
    }
    {
      const url = new URL(this.crossrefApi); url.searchParams.set('query', query); url.searchParams.set('rows', String(Math.min(limit, 25))); if (this.mailto) url.searchParams.set('mailto', this.mailto);
      names.push('crossref'); tasks.push(json(url, { signal, timeoutMs: this.timeoutMs }).then((payload) => mapCrossref(payload, limit)));
    }
    {
      const url = new URL(this.arxivApi); url.searchParams.set('search_query', `all:${query}`); url.searchParams.set('start', '0'); url.searchParams.set('max_results', String(Math.min(limit, 25)));
      names.push('arxiv'); tasks.push(json(url, { signal, timeoutMs: this.timeoutMs, accept: 'application/atom+xml' }).then((text) => mapArxiv(text, limit)));
    }
    const settled = await Promise.allSettled(tasks);
    const abort = settled.find((entry) => entry.status === 'rejected' && entry.reason?.code === 'WEB_SEARCH_ABORTED');
    if (abort) throw abort.reason;
    const groups = []; const active = []; const degraded = []; const errors = [];
    settled.forEach((entry, index) => {
      if (entry.status === 'fulfilled' && entry.value.length) { groups.push(entry.value); active.push(names[index]); }
      else { degraded.push(names[index]); if (entry.status === 'rejected') errors.push(entry.reason); }
    });
    if (groups.length) {
      const merged = mergeRank(groups, this.trustedDomains, limit);
      return { content: scopeText(active, degraded), ...merged };
    }
    // 所有扇出源都不可用 → 维基百科兜底（保留原有行为）
    const url = new URL(this.wikipediaApi); url.searchParams.set('action', 'query'); url.searchParams.set('list', 'search'); url.searchParams.set('srsearch', query); url.searchParams.set('srlimit', String(limit)); url.searchParams.set('format', 'json'); url.searchParams.set('utf8', '1'); url.searchParams.set('origin', '*');
    try { return { content: `检索范围：中文维基百科（所有检索源本次均不可用，已降级为百科参考，不是教材正文、课程标准或权威教辅）。`, sources: mapWikipedia(await json(url, { signal, timeoutMs: this.timeoutMs }), limit, this.wikipediaApi.origin), truncated: false }; }
    catch (error) {
      if (error.code === 'WEB_SEARCH_ABORTED') throw error;
      throw failure('WEB_SEARCH_ALL_SOURCES_FAILED', 'all search sources failed', new AggregateError([...errors, error]));
    }
  }
}

export function apply(ctx, config = {}) { ctx.web.registerSearchProvider(new FreeWebSearchProvider(config)); }
