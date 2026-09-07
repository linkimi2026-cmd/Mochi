import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Context } from '../../../apps/desktop/node_modules/@deepseek-ai/cordis/lib/index.js';
import { WebRuntime } from '../../../apps/desktop/node_modules/@deepseek-ai/dsh-web/lib/index.js';
import * as plugin from '../index.mjs';

const { FreeWebSearchProvider, PROVIDER_ID, apply, isTrustedHostname, normalizeTrustedDomain, domainAuthority } = plugin;

async function serverFor(t, handler) {
  const server = createServer(handler); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

// 测试默认关闭真实学术源：显式把三个学术端点指向本地桩。
function stubAcademic(providerOptions, origin, payloadByPath = {}) {
  const handler = (req, res) => {
    res.setHeader('content-type', 'application/json');
    const payload = payloadByPath[new URL(req.url, origin).pathname] ?? { results: [], message: { items: [] }, query: { search: [] } };
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };
  return {
    options: { openalexApi: `${origin}/works`, crossrefApi: `${origin}/works`, arxivApi: `${origin}/query`, ...providerOptions },
    handler,
  };
}

test('SearXNG results preserve allowed source fields and send no host credentials', async (t) => {
  let observed;
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/search') { observed = { url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie }; res.end(JSON.stringify({ results: [{ url: 'https://www.moe.gov.cn/example', title: '教育部资料', content: '<b>课程</b> 标准', publishedDate: '2026-01-02T00:00:00Z' }, { url: 'javascript:bad', title: 'bad' }] })); }
    else res.end('{"results":[],"message":{"items":[]}}');
  });
  const result = await new FreeWebSearchProvider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/wiki`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/works`, arxivApi: `${origin}/query` }).search({ query: '普通高中 课程标准', maxResults: 3 });
  assert.equal(result.sources.length, 1); assert.deepEqual(result.sources[0], { url: 'https://www.moe.gov.cn/example', title: '教育部资料', snippet: '课程 标准', publishedAt: '2026-01-02T00:00:00Z' });
  assert.match(result.content, /权威域名加权/); assert.match(observed.url, /format=json/); assert.equal(observed.authorization, undefined); assert.equal(observed.cookie, undefined);
});

test('trusted domains now rank first instead of filtering everything else out', async (t) => {
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/search') res.end(JSON.stringify({ results: [
      { url: 'https://pep.com.cn/high-school' },
      { url: 'https://www.pep.com.cn/high-school' },
      { url: 'https://pep.com.cn.evil.example/forged' },
      { url: 'https://evilpep.com.cn/forged' },
      { url: 'https://pep.com.cn@evil.example/forged' },
      { url: 'https://www.fltrp.com:9443/forged' },
      { url: 'https://untrusted.example/resource' },
    ] }));
    else res.end('{"results":[],"message":{"items":[]}}');
  });
  const result = await new FreeWebSearchProvider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/wiki`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/works`, arxivApi: `${origin}/query` }).search({ query: '高中教材', maxResults: 5 });
  const urls = result.sources.map((source) => source.url);
  // 加权后：两个可信域名并列最前（位置序决定次序），未命中域名仍保留（不再被过滤）；带凭据/非标准端口仍被 URL 卫生检查丢弃
  assert.deepEqual(urls.slice(0, 2).sort(), ['https://pep.com.cn/high-school', 'https://www.pep.com.cn/high-school']);
  assert.ok(urls.includes('https://untrusted.example/resource'));
  assert.ok(!urls.some((u) => u.includes('@') || u.includes(':9443')));
  assert.equal(isTrustedHostname('pep.com.cn'), true); assert.equal(isTrustedHostname('www.pep.com.cn'), true);
  assert.equal(isTrustedHostname('pep.com.cn.evil.example'), false); assert.equal(isTrustedHostname('evilpep.com.cn'), false);
  assert.equal(normalizeTrustedDomain(' PEP.COM.CN. '), 'pep.com.cn');
  assert.throws(() => new FreeWebSearchProvider({ trustedDomains: [] }), (error) => error.code === 'WEB_PROVIDER_CONFIG_INVALID');
  assert.throws(() => new FreeWebSearchProvider({ trustedDomains: ['https://pep.com.cn'] }), (error) => error.code === 'WEB_PROVIDER_CONFIG_INVALID');
});

test('domainAuthority weights trusted, doi, gov/edu hosts and gives zero to others', () => {
  assert.equal(domainAuthority('basic.smartedu.cn'), 0.55);
  assert.equal(domainAuthority('www.pep.com.cn'), 0.55);
  assert.equal(domainAuthority('doi.org'), 0.5);
  assert.equal(domainAuthority('jyt.sc.gov.cn'), 0.45);
  assert.equal(domainAuthority('physics.ox.ac.uk'), 0.35);
  assert.equal(domainAuthority('blog.example.com'), 0);
});

test('academic sources fan out in parallel, dedupe by canonical url, and rank by weight', async (t) => {
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/search') res.end(JSON.stringify({ results: [{ url: 'https://example.com/blog?utm_source=x', title: '博客笔记' }] }));
    else if (pathname === '/works') res.end(JSON.stringify({ results: [{ doi: 'https://doi.org/10.1234/abc', display_name: 'Attention Is All You Need', abstract_inverted_index: { transformer: [0], model: [1] }, publication_date: '2017-06-12' }] }));
    else if (pathname === '/query') res.end('<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is All You Need</title><summary>We propose the Transformer.</summary><published>2017-06-12T00:00:00Z</published></entry></feed>');
    else res.end(JSON.stringify({ message: { items: [] } }));
  });
  const result = await new FreeWebSearchProvider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/wiki`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` }).search({ query: 'transformer', maxResults: 4 });
  const urls = result.sources.map((s) => s.url);
  assert.ok(urls.includes('https://doi.org/10.1234/abc'));
  assert.ok(urls.includes('http://arxiv.org/abs/1706.03762v7'));
  // 来源 URL 保留原始形态（含追踪参数），规范化只用于去重键
  assert.ok(urls.includes('https://example.com/blog?utm_source=x'));
  // doi.org（权威 0.5+0.6）应排在普通博客（0 权重）之前
  assert.ok(urls.indexOf('https://doi.org/10.1234/abc') < urls.indexOf('https://example.com/blog?utm_source=x'));
  assert.match(result.content, /OpenAlex/); assert.match(result.content, /arXiv/);
});

test('all fanout sources failing falls back to wikipedia, then fails loudly', async (t) => {
  const origin = await serverFor(t, (req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/w/api.php') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ query: { search: [{ pageid: 42, title: '水循环', snippet: '水在地球各圈层之间连续<b>运动</b>' }] } })); }
    else { res.writeHead(500); res.end(); }
  });
  const result = await new FreeWebSearchProvider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/w/api.php`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` }).search({ query: '水循环', maxResults: 1 });
  assert.deepEqual(result.sources, [{ url: `${origin}/?curid=42`, title: '水循环', snippet: '水在地球各圈层之间连续 运动' }]);
  assert.match(result.content, /维基百科/);
});

test('without a SearXNG endpoint academic sources still answer', async (t) => {
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/works') res.end(JSON.stringify({ results: [{ doi: 'https://doi.org/10.1/x', display_name: 'paper' }] }));
    else if (pathname === '/query') res.end('<feed></feed>');
    else res.end(JSON.stringify({ message: { items: [] } }));
  });
  const provider = new FreeWebSearchProvider({ wikipediaApi: `${origin}/w/api.php`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` });
  const result = await provider.search({ query: 'x', maxResults: 2 });
  assert.equal(result.sources.length, 1); assert.equal(result.sources[0].url, 'https://doi.org/10.1/x');
  await assert.rejects(() => provider.search({ query: '', maxResults: 2 }), (error) => error.code === 'WEB_SEARCH_INVALID_REQUEST');
});

test('timeout, cancellation, and response size are bounded', async (t) => {
  const slow = await serverFor(t, (_req, res) => setTimeout(() => res.end('{"query":{"search":[]}}'), 2_000));
  await assert.rejects(() => new FreeWebSearchProvider({ wikipediaApi: `${slow}/api`, openalexApi: `${slow}/oa`, crossrefApi: `${slow}/cr`, arxivApi: `${slow}/ax`, timeoutMs: 250 }).search({ query: 'x' }), (error) => error.code === 'WEB_SEARCH_TIMEOUT' || error.code === 'WEB_SEARCH_ALL_SOURCES_FAILED');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => new FreeWebSearchProvider({ wikipediaApi: `${slow}/api`, openalexApi: `${slow}/oa`, crossrefApi: `${slow}/cr`, arxivApi: `${slow}/ax` }).search({ query: 'x' }, controller.signal), (error) => error.code === 'WEB_SEARCH_ABORTED');
  const large = await serverFor(t, (_req, res) => { res.setHeader('content-length', '1000001'); res.end('{}'); });
  await assert.rejects(() => new FreeWebSearchProvider({ wikipediaApi: `${large}/api`, openalexApi: `${large}/oa`, crossrefApi: `${large}/cr`, arxivApi: `${large}/ax` }).search({ query: 'x' }), (error) => ['WEB_SEARCH_RESPONSE_TOO_LARGE', 'WEB_SEARCH_ALL_SOURCES_FAILED'].includes(error.code));
});

test('apply registers the provider under the stable id', () => {
  let provider; apply({ web: { registerSearchProvider(value) { provider = value; } } });
  assert.equal(provider.id, PROVIDER_ID); assert.equal(provider.available(), true);
});

test('native ctx.web.search selects the free provider and retains its scope marker', async (t) => {
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/search') res.end(JSON.stringify({ results: [{ url: 'https://www.pep.com.cn/example', title: '高中数学' }, { url: 'https://spoofed.example/ignore' }] }));
    else res.end('{"results":[],"message":{"items":[]},"query":{"search":[]}}');
  });
  const ctx = new Context();
  const runtime = await ctx.plugin(WebRuntime, { searchProvider: PROVIDER_ID });
  const mounted = await ctx.plugin(plugin, { searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/w/api.php`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` });
  t.after(async () => { await mounted.dispose(); await runtime.dispose(); });
  const result = await ctx.web.search({ query: '高中数学', maxResults: 1 });
  assert.deepEqual(result.sources, [{ url: 'https://www.pep.com.cn/example', title: '高中数学' }]);
  assert.match(result.content, /权威域名加权/);
});

test('cancellation while reading a response body stops the whole fallback chain', async (t) => {
  let fallbackRequests = 0;
  const origin = await serverFor(t, (req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/search') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"results":['); setTimeout(() => res.end(']}'), 2_000); }
    else if (pathname === '/w/api.php') { fallbackRequests += 1; res.end('{"query":{"search":[]}}'); }
    else { res.end('{"results":[],"message":{"items":[]}}'); }
  });
  const controller = new AbortController(); const pending = new FreeWebSearchProvider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/w/api.php`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` }).search({ query: 'cancel stream' }, controller.signal);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, (error) => error.code === 'WEB_SEARCH_ABORTED');
  assert.equal(fallbackRequests, 0);
});
