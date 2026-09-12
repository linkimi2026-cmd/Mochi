export const name = 'mochi-web-search';
export const inject = ['web'];
export const PROVIDER_ID = 'mochi-free-web';

const DEFAULT_WIKIPEDIA_API = 'https://zh.wikipedia.org/w/api.php';
const DEFAULT_OPENALEX_API = 'https://api.openalex.org/works';
const DEFAULT_CROSSREF_API = 'https://api.crossref.org/works';
const DEFAULT_ARXIV_API = 'https://export.arxiv.org/api/query';
const DEFAULT_AGENT_WEBTOOL_ENGINES = Object.freeze(['baidu', 'wechat', 'toutiao']);
const MAX_BYTES = 1_000_000;

// 权威域名加权目录（不再是过滤白名单）：命中的来源在排序中加分，
// 未命中的来源照常保留。加分规则见 domainAuthority()。
//
// 2026-09-12 起按「全国级 / 国际开放教材 / 省级 / 市级 / 商业教辅」分层给不同权重，
// 让国家平台与省市教育局排在商业题库之前。每个域名的核实记录见 README.md。
export const TEACHER_AUTHORITY_TIERS = Object.freeze({
  // 全国级：教育部、国家智慧教育平台、教材出版社
  national: Object.freeze([
    'basic.smartedu.cn',
    'smartedu.cn',
    'moe.gov.cn',
    'pep.com.cn',
    'fltrp.com',
  ]),
  // 国际开放教材（CC 授权，可直接获取）
  international: Object.freeze([
    'openstax.org',
  ]),
  // 省级：四川省教育厅、四川省教育考试院（官方考试/真题公告）
  provincial: Object.freeze([
    'edu.sc.gov.cn',
    'sceea.cn',
  ]),
  // 市级：成都市教育局
  municipal: Object.freeze([
    'edu.chengdu.gov.cn',
  ]),
  // 商业教辅题库：资源丰富，但绝大多数试卷/试题需要登录或付费
  commercial: Object.freeze([
    'zxxk.com',
    'zujuan.xkw.com',
    'jyeoo.com',
  ]),
});

export const TEACHER_AUTHORITY_WEIGHTS = Object.freeze({
  national: 0.55,
  international: 0.55,
  provincial: 0.52,
  municipal: 0.50,
  commercial: 0.48,
});

export const TEACHER_AUTHORITY_DOMAINS = Object.freeze(Object.values(TEACHER_AUTHORITY_TIERS).flat());

// 站点显示名：用于 scopeText 的来源说明与教育站点定向检索提示。
export const EDUCATION_SITE_NAMES = Object.freeze({
  'basic.smartedu.cn': '国家中小学智慧教育平台',
  'smartedu.cn': '国家智慧教育公共服务平台',
  'moe.gov.cn': '教育部',
  'pep.com.cn': '人民教育出版社',
  'fltrp.com': '外研社',
  'openstax.org': 'OpenStax',
  'edu.sc.gov.cn': '四川省教育厅',
  'sceea.cn': '四川省教育考试院',
  'edu.chengdu.gov.cn': '成都市教育局',
  'zxxk.com': '学科网',
  'zujuan.xkw.com': '组卷网',
  'jyeoo.com': '菁优网',
});

// 商业题库/教辅：摘要与链接可引用，但下载普遍需要登录或付费。
// 这里只用于生成诚实的提示文字，不做任何绕过或代下载。
const PAYWALLED_SITES = Object.freeze([
  { domain: 'zxxk.com', name: '学科网' },
  { domain: 'zujuan.xkw.com', name: '组卷网' },
  { domain: 'jyeoo.com', name: '菁优网' },
]);

// 公开可直取的官方来源：公开附件/课程资源一般无需付费。
const OPEN_ACCESS_SITES = Object.freeze([
  { domain: 'basic.smartedu.cn', name: '国家中小学智慧教育平台' },
  { domain: 'smartedu.cn', name: '国家智慧教育公共服务平台' },
  { domain: 'moe.gov.cn', name: '教育部' },
  { domain: 'edu.sc.gov.cn', name: '四川省教育厅' },
  { domain: 'sceea.cn', name: '四川省教育考试院' },
  { domain: 'edu.chengdu.gov.cn', name: '成都市教育局' },
]);

function authorityTier(host, domains) {
  for (const [tier, list] of Object.entries(TEACHER_AUTHORITY_TIERS)) {
    for (const domain of list) {
      // 只有仍在本次生效目录里的域名才享受分层权重；调用方自定义目录时不误判。
      if (!domains.includes(domain)) continue;
      if (host === domain || host.endsWith(`.${domain}`)) return tier;
    }
  }
  return undefined;
}

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
  const tier = authorityTier(host, domains);
  if (tier !== undefined) return TEACHER_AUTHORITY_WEIGHTS[tier];
  // 调用方通过 trustedDomains 传入的自定义目录仍按同一档 0.55 加分（向后兼容）。
  if (isTrustedHostname(host, domains)) return 0.55;
  if (host === 'doi.org' || host.endsWith('.doi.org')) return 0.5;
  if (/(^|\.)gov\.cn$/.test(host) || /(^|\.)edu\.cn$/.test(host)) return 0.45;
  if (/(^|\.)gov$/.test(host) || /(^|\.)edu$/.test(host) || /(^|\.)ac\.[a-z]{2,3}$/.test(host)) return 0.35;
  return 0;
}

// 教育类查询信号：老师找试卷/试题/课件/备考资料。只在这些查询上启用
// 「教育站点定向扇出」，避免英文/学术查询被国内教辅站点污染。
const EDUCATION_QUERY_PATTERN = /(试卷|试题|题库|卷子|练习|课件|教案|学案|讲义|高考|中考|期中|期末|月考|联考|模拟|真题|一模|二模|三模|组卷|单元测试|阶段测试|会考|学业水平|考点|命题|阅卷|错题)/;

export function isEducationQuery(query) {
  return typeof query === 'string' && EDUCATION_QUERY_PATTERN.test(query);
}

// 用户直接点名某个教育站点时，也视为定向检索诉求（即使没有试卷类关键词）。
const SITE_MENTIONS = Object.freeze([
  { pattern: /学科网/, domain: 'zxxk.com' },
  { pattern: /组卷网/, domain: 'zujuan.xkw.com' },
  // 老师口中的「金优网」核实不到官网；最接近的真实站点是菁优网（jyeoo.com），
  // 这里按菁优网处理，不虚构「金优网」域名。
  { pattern: /菁优网|金优网/, domain: 'jyeoo.com' },
  { pattern: /智慧教育平台|智慧中小学|smartedu/i, domain: 'basic.smartedu.cn' },
  { pattern: /人教社|人民教育出版社/, domain: 'pep.com.cn' },
]);

// 区域信号：命中时优先把对应省市教育局纳入定向检索。
const REGION_FANOUT = Object.freeze([
  { pattern: /四川/, domain: 'edu.sc.gov.cn' },
  { pattern: /成都/, domain: 'edu.chengdu.gov.cn' },
]);

const DEFAULT_EDUCATION_FANOUT = Object.freeze([
  'basic.smartedu.cn',
  'zxxk.com',
  'jyeoo.com',
  'zujuan.xkw.com',
]);
const MAX_EDUCATION_FANOUT = 4;

// 返回本次要发起 site: 限定检索的域名列表（已去重、已截断）。
// 非教育查询返回空数组：扇出只在教育查询上启用。
export function educationFanoutTargets(query) {
  if (typeof query !== 'string' || !query.trim()) return Object.freeze([]);
  const namedSite = SITE_MENTIONS.some((rule) => rule.pattern.test(query));
  if (!isEducationQuery(query) && !namedSite) return Object.freeze([]);
  const ordered = [];
  const push = (domain) => { if (domain && !ordered.includes(domain)) ordered.push(domain); };
  for (const rule of REGION_FANOUT) if (rule.pattern.test(query)) push(rule.domain);
  for (const rule of SITE_MENTIONS) if (rule.pattern.test(query)) push(rule.domain);
  for (const domain of DEFAULT_EDUCATION_FANOUT) push(domain);
  return Object.freeze(ordered.slice(0, MAX_EDUCATION_FANOUT));
}

// 每个主机只归属到最具体的那个站点，避免 basic.smartedu.cn 同时被
// smartedu.cn 父域重复计数。
function matchedSiteNames(sites, hosts) {
  const names = [];
  for (const host of new Set(hosts)) {
    const best = sites
      .filter((site) => host === site.domain || host.endsWith(`.${site.domain}`))
      .sort((a, b) => b.domain.length - a.domain.length)[0];
    if (best && !names.includes(best.name)) names.push(best.name);
  }
  return names;
}

// 按本次实际返回的来源，如实说明获取边界。绝不声称已下载，也不给伪造路径。
function accessNote(sources) {
  const hosts = (Array.isArray(sources) ? sources : [])
    .map((source) => { try { return new URL(source?.url).hostname.toLowerCase(); } catch { return undefined; } })
    .filter(Boolean);
  const paywalled = matchedSiteNames(PAYWALLED_SITES, hosts);
  const open = matchedSiteNames(OPEN_ACCESS_SITES, hosts);
  const parts = ['本插件不下载文件、不绕过登录或付费墙，只返回链接与检索摘要'];
  if (paywalled.length) parts.push(`${paywalled.join('、')}的试卷/试题多数需要登录或付费后才能下载，本次只能给到链接`);
  if (open.length) parts.push(`${open.join('、')}的公开资源通常可直接获取，实际仍以站点要求为准`);
  if (!paywalled.length && !open.length) parts.push('能否下载取决于来源站点自身的登录与授权要求');
  return parts.join('；');
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

// Keep the SDK load behind this small boundary. It lets the source-tree tests
// exercise provider behavior without placing a temporary node_modules link in
// a plugin that is later packed, while production still resolves the normal
// package declared in package.json.
async function defaultAgentWebSearch(input, signal) {
  const { webSearch } = await import('agent-webtool');
  return webSearch(input, { signal });
}

function mapAgentWebtool(payload, limit) {
  if (!payload || !Array.isArray(payload.results)) {
    throw failure('WEB_SEARCH_INVALID_RESPONSE', 'agent-webtool response is missing results');
  }
  const candidates = [];
  let position = 0;
  for (const item of payload.results) {
    const url = validSourceUrl(item?.url);
    if (!url) continue;
    position += 1;
    // The SDK already merges its selected engines by reciprocal rank. Preserve
    // that per-request order within the general-web source group; the provider
    // decides separately whether academic metadata is a fallback for this call.
    const rankScore = Math.max(0.55, 1.15 - position * 0.06);
    candidates.push({
      url: url.href,
      ...(clean(item.title, 300) ? { title: clean(item.title, 300) } : {}),
      ...(clean(item.snippet) ? { snippet: clean(item.snippet) } : {}),
      rankScore,
    });
    if (candidates.length >= limit * 3) break;
  }
  return candidates;
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

function scopeText({ active, degraded, deferred = [], educationSites = [], sources = [] }) {
  const labels = {
    agentWebtool: '中文网页（百度、微信、头条）',
    searxng: 'SearXNG 全网',
    openalex: 'OpenAlex',
    crossref: 'Crossref',
    arxiv: 'arXiv',
    wikipedia: '中文维基百科',
  };
  const labelFor = (key) => {
    if (labels[key]) return labels[key];
    if (typeof key === 'string' && key.startsWith('site:')) {
      const domain = key.slice(5);
      return `${EDUCATION_SITE_NAMES[domain] ?? domain}（站点限定）`;
    }
    return undefined;
  };
  const uniq = (keys) => [...new Set(keys)];
  const used = uniq(active).map(labelFor).filter(Boolean).join(' + ') || '无可用源';
  const note = degraded.length ? `（${uniq(degraded).map(labelFor).filter(Boolean).join('、')} 本次未返回可用结果）` : '';
  const deferredNote = deferred.length ? `；${uniq(deferred).map(labelFor).filter(Boolean).join('、')} 仅在中文网页无结果时作为回退，未与本次网页结果混排` : '';
  const educationNote = educationSites.length
    ? `本次启用了教育站点定向检索（${uniq(educationSites).map((domain) => EDUCATION_SITE_NAMES[domain] ?? domain).join('、')}），各站点结果独立成组后与通用网页一并加权排序。`
    : '';
  return `检索范围：${used}${note}${deferredNote}；权威域名加权排序。仅链接与检索摘要可引用，未取得教材正文或配套资源的复制授权。${educationNote}${accessNote(sources)}。`;
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
    this.timeoutMs = options.timeoutMs ?? 3_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 250 || this.timeoutMs > 30_000) throw failure('WEB_PROVIDER_CONFIG_INVALID', 'timeoutMs must be 250-30000');
    this.agentWebSearch = typeof options.agentWebSearch === 'function' ? options.agentWebSearch : defaultAgentWebSearch;
  }
  available() { return true; }
  async search(request, signal) {
    const { query, limit } = requestShape(request);
    const tasks = []; const names = [];
    // Use only this call's structured results. agent-webtool also exposes a
    // process-wide citation collector, which would let separate teacher turns
    // influence each other; this provider deliberately neither reads nor
    // clears it.
    names.push('agentWebtool');
    tasks.push(this.agentWebSearch({
      query,
      engines: DEFAULT_AGENT_WEBTOOL_ENGINES,
      limit: Math.min(limit * 2, 20),
      timeoutMs: this.timeoutMs,
    }, signal).then((payload) => mapAgentWebtool(payload, limit)));
    if (this.searxngEndpoint) {
      const url = new URL(this.searxngEndpoint); url.searchParams.set('q', query); url.searchParams.set('format', 'json'); url.searchParams.set('language', 'zh-CN');
      names.push('searxng'); tasks.push(json(url, { signal, timeoutMs: this.timeoutMs }).then((payload) => mapSearx(payload, limit)));
    }
    // 教育站点定向扇出：站点限定结果各自成组，与通用网页一起进入 mergeRank。
    // 只在判定为教育查询（或用户点名教育站点）时启用，避免污染英文/学术查询。
    const educationSites = educationFanoutTargets(query);
    for (const domain of educationSites) {
      const siteQuery = `site:${domain} ${query}`;
      names.push(`site:${domain}`);
      tasks.push(this.agentWebSearch({
        query: siteQuery,
        engines: DEFAULT_AGENT_WEBTOOL_ENGINES,
        limit: Math.min(limit, 10),
        timeoutMs: this.timeoutMs,
      }, signal).then((payload) => mapAgentWebtool(payload, limit)));
      if (this.searxngEndpoint) {
        const url = new URL(this.searxngEndpoint); url.searchParams.set('q', siteQuery); url.searchParams.set('format', 'json'); url.searchParams.set('language', 'zh-CN');
        names.push(`site:${domain}`);
        tasks.push(json(url, { signal, timeoutMs: this.timeoutMs }).then((payload) => mapSearx(payload, limit)));
      }
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
    if (signal?.aborted) throw failure('WEB_SEARCH_ABORTED', 'web search was cancelled', signal.reason);
    const abort = settled.find((entry) => entry.status === 'rejected' && entry.reason?.code === 'WEB_SEARCH_ABORTED');
    if (abort) throw abort.reason;
    const generalGroups = []; const academicGroups = [];
    const generalActive = []; const academicActive = [];
    const degraded = []; const errors = [];
    settled.forEach((entry, index) => {
      const name = names[index];
      const general = name === 'agentWebtool' || name === 'searxng' || name.startsWith('site:');
      if (entry.status === 'fulfilled' && entry.value.length) {
        if (general) {
          generalGroups.push(entry.value);
          generalActive.push(name);
        } else {
          academicGroups.push(entry.value);
          academicActive.push(name);
        }
      } else {
        degraded.push(name);
        if (entry.status === 'rejected') errors.push(entry.reason);
      }
    });
    // A response to a general Chinese query must not be displaced by a DOI or
    // paper title that merely gains authority weight. Academic APIs remain
    // available as a truthful fallback when no usable general-web result was
    // returned for this request.
    const groups = generalGroups.length ? generalGroups : academicGroups;
    if (groups.length) {
      const merged = mergeRank(groups, this.trustedDomains, limit);
      return {
        content: scopeText({
          active: generalGroups.length ? generalActive : academicActive,
          degraded,
          deferred: generalGroups.length ? academicActive : [],
          educationSites,
          sources: merged.sources,
        }),
        ...merged,
      };
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
