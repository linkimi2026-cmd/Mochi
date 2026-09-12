import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Context } from '../../../apps/desktop/node_modules/@deepseek-ai/cordis/lib/index.js';
import { WebRuntime } from '../../../apps/desktop/node_modules/@deepseek-ai/dsh-web/lib/index.js';
import * as plugin from '../index.mjs';

const { FreeWebSearchProvider, PROVIDER_ID, apply, isTrustedHostname, normalizeTrustedDomain, domainAuthority, isEducationQuery, educationFanoutTargets, TEACHER_AUTHORITY_DOMAINS, TEACHER_AUTHORITY_TIERS, TEACHER_AUTHORITY_WEIGHTS } = plugin;

const EMPTY_AGENT_WEBTOOL_RESPONSE = Object.freeze({
  results: [],
  engines: [
    { engine: 'baidu', status: 'no_results', ok: true, count: 0, rawCount: 0 },
    { engine: 'wechat', status: 'no_results', ok: true, count: 0, rawCount: 0 },
    { engine: 'toutiao', status: 'no_results', ok: true, count: 0, rawCount: 0 },
  ],
});

function provider(options = {}) {
  return new FreeWebSearchProvider({
    agentWebSearch: async () => EMPTY_AGENT_WEBTOOL_RESPONSE,
    ...options,
  });
}

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
  const result = await provider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/wiki`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/works`, arxivApi: `${origin}/query` }).search({ query: '普通高中 课程标准', maxResults: 3 });
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
  const result = await provider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/wiki`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/works`, arxivApi: `${origin}/query` }).search({ query: '高中教材', maxResults: 5 });
  const urls = result.sources.map((source) => source.url);
  // 加权后：两个可信域名并列最前（位置序决定次序），未命中域名仍保留（不再被过滤）；带凭据/非标准端口仍被 URL 卫生检查丢弃
  assert.deepEqual(urls.slice(0, 2).sort(), ['https://pep.com.cn/high-school', 'https://www.pep.com.cn/high-school']);
  assert.ok(urls.includes('https://untrusted.example/resource'));
  assert.ok(!urls.some((u) => u.includes('@') || u.includes(':9443')));
  assert.equal(isTrustedHostname('pep.com.cn'), true); assert.equal(isTrustedHostname('www.pep.com.cn'), true);
  assert.equal(isTrustedHostname('pep.com.cn.evil.example'), false); assert.equal(isTrustedHostname('evilpep.com.cn'), false);
  assert.equal(normalizeTrustedDomain(' PEP.COM.CN. '), 'pep.com.cn');
  assert.throws(() => provider({ trustedDomains: [] }), (error) => error.code === 'WEB_PROVIDER_CONFIG_INVALID');
  assert.throws(() => provider({ trustedDomains: ['https://pep.com.cn'] }), (error) => error.code === 'WEB_PROVIDER_CONFIG_INVALID');
});

test('domainAuthority weights trusted, doi, gov/edu hosts and gives zero to others', () => {
  assert.equal(domainAuthority('basic.smartedu.cn'), 0.55);
  assert.equal(domainAuthority('www.pep.com.cn'), 0.55);
  assert.equal(domainAuthority('doi.org'), 0.5);
  assert.equal(domainAuthority('jyt.sc.gov.cn'), 0.45);
  assert.equal(domainAuthority('physics.ox.ac.uk'), 0.35);
  assert.equal(domainAuthority('blog.example.com'), 0);
});

test('agent-webtool uses per-request structured results without leaking its process citation ids', async (t) => {
  const origin = await serverFor(t, (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ results: [], message: { items: [] } }));
  });
  const calls = [];
  const agentWebSearch = async (input, signal) => {
    calls.push({ input, signal });
    await Promise.resolve();
    return {
      results: [{
        id: input.query === '化学平衡 教学' ? 41 : 92,
        title: `${input.query} 搜索标题`,
        url: `https://search.example/${encodeURIComponent(input.query)}`,
        snippet: `${input.query} 搜索摘要`,
        score: 999,
        engines: ['baidu', 'wechat'],
        meta: { account: 'ignored-by-provider' },
        fetched: false,
      }],
      engines: [{ engine: 'baidu', status: 'success', ok: true, count: 1, rawCount: 1 }],
    };
  };
  const searchProvider = provider({
    agentWebSearch,
    wikipediaApi: `${origin}/wiki`,
    openalexApi: `${origin}/works`,
    crossrefApi: `${origin}/crossref`,
    arxivApi: `${origin}/query`,
  });
  const [chemistry, english] = await Promise.all([
    searchProvider.search({ query: '化学平衡 教学', maxResults: 2 }),
    searchProvider.search({ query: '外研版 高中英语 教学设计', maxResults: 2 }),
  ]);
  assert.deepEqual(calls.map(({ input }) => input.engines), [
    ['baidu', 'wechat', 'toutiao'],
    ['baidu', 'wechat', 'toutiao'],
  ]);
  assert.ok(calls.every(({ input }) => input.timeoutMs === 3_000));
  assert.deepEqual(chemistry.sources, [{
    url: 'https://search.example/%E5%8C%96%E5%AD%A6%E5%B9%B3%E8%A1%A1%20%E6%95%99%E5%AD%A6',
    title: '化学平衡 教学 搜索标题',
    snippet: '化学平衡 教学 搜索摘要',
  }]);
  assert.deepEqual(english.sources, [{
    url: 'https://search.example/%E5%A4%96%E7%A0%94%E7%89%88%20%E9%AB%98%E4%B8%AD%E8%8B%B1%E8%AF%AD%20%E6%95%99%E5%AD%A6%E8%AE%BE%E8%AE%A1',
    title: '外研版 高中英语 教学设计 搜索标题',
    snippet: '外研版 高中英语 教学设计 搜索摘要',
  }]);
  assert.equal('id' in chemistry.sources[0], false);
  assert.equal('engines' in chemistry.sources[0], false);
  assert.match(chemistry.content, /中文网页/);
});

test('agent-webtool empty results are reported honestly and calling cancellation reaches the SDK boundary', async (t) => {
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/works') res.end(JSON.stringify({ results: [{ doi: 'https://doi.org/10.2/teacher', display_name: '学术补充' }] }));
    else if (pathname === '/query') res.end('<feed></feed>');
    else res.end(JSON.stringify({ message: { items: [] } }));
  });
  const emptyProvider = provider({
    agentWebSearch: async () => EMPTY_AGENT_WEBTOOL_RESPONSE,
    wikipediaApi: `${origin}/wiki`,
    openalexApi: `${origin}/works`,
    crossrefApi: `${origin}/crossref`,
    arxivApi: `${origin}/query`,
  });
  const emptyResult = await emptyProvider.search({ query: '教材检索', maxResults: 2 });
  assert.equal(emptyResult.sources[0].url, 'https://doi.org/10.2/teacher');
  assert.match(emptyResult.content, /中文网页.*本次未返回可用结果/);

  const controller = new AbortController();
  let forwardedSignal;
  const cancelledProvider = provider({
    agentWebSearch: async (_input, signal) => new Promise((_resolve, reject) => {
      forwardedSignal = signal;
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }),
    wikipediaApi: `${origin}/wiki`,
    openalexApi: `${origin}/works`,
    crossrefApi: `${origin}/crossref`,
    arxivApi: `${origin}/query`,
  });
  const pending = cancelledProvider.search({ query: '取消查询', maxResults: 2 }, controller.signal);
  controller.abort(new Error('caller cancelled'));
  await assert.rejects(pending, (error) => error.code === 'WEB_SEARCH_ABORTED');
  assert.equal(forwardedSignal, controller.signal);
});

test('default Chinese-web results rank ahead of DOI metadata fallbacks for the same query', async (t) => {
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/works') res.end(JSON.stringify({ results: [{ doi: 'https://doi.org/10.2/metadata', display_name: '不应压过通用中文结果' }] }));
    else if (pathname === '/query') res.end('<feed></feed>');
    else res.end(JSON.stringify({ message: { items: [] } }));
  });
  const searchProvider = provider({
    agentWebSearch: async () => ({
      results: [{ title: '化学平衡课堂活动', url: 'https://teaching.example/chemistry-equilibrium', snippet: '教学设计线索', engines: ['baidu'], score: 0.01, meta: {}, id: 1, fetched: false }],
      engines: [{ engine: 'baidu', status: 'success', ok: true, count: 1, rawCount: 1 }],
    }),
    wikipediaApi: `${origin}/wiki`,
    openalexApi: `${origin}/works`,
    crossrefApi: `${origin}/crossref`,
    arxivApi: `${origin}/query`,
  });
  const result = await searchProvider.search({ query: '化学平衡 教学', maxResults: 3 });
  assert.deepEqual(result.sources, [{
    url: 'https://teaching.example/chemistry-equilibrium',
    title: '化学平衡课堂活动',
    snippet: '教学设计线索',
  }]);
  assert.match(result.content, /未与本次网页结果混排/);
});

test('academic sources fan out in parallel, dedupe by canonical url, and rank by weight', async (t) => {
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/search') res.end(JSON.stringify({ results: [{ url: 'https://example.com/blog?utm_source=x', title: '博客笔记' }] }));
    else if (pathname === '/works') res.end(JSON.stringify({ results: [
      { doi: 'https://doi.org/10.1234/abc', display_name: 'Attention Is All You Need', abstract_inverted_index: { transformer: [0], model: [1] }, publication_date: '2017-06-12' },
      { primary_location: { landing_page_url: 'https://example.com/blog?utm_source=x' }, display_name: '博客笔记' },
    ] }));
    else if (pathname === '/query') res.end('<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is All You Need</title><summary>We propose the Transformer.</summary><published>2017-06-12T00:00:00Z</published></entry></feed>');
    else res.end(JSON.stringify({ message: { items: [] } }));
  });
  const result = await provider({ wikipediaApi: `${origin}/wiki`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` }).search({ query: 'transformer', maxResults: 4 });
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
  const result = await provider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/w/api.php`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` }).search({ query: '水循环', maxResults: 1 });
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
  const searchProvider = provider({ wikipediaApi: `${origin}/w/api.php`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` });
  const result = await searchProvider.search({ query: 'x', maxResults: 2 });
  assert.equal(result.sources.length, 1); assert.equal(result.sources[0].url, 'https://doi.org/10.1/x');
  await assert.rejects(() => searchProvider.search({ query: '', maxResults: 2 }), (error) => error.code === 'WEB_SEARCH_INVALID_REQUEST');
});

test('timeout, cancellation, and response size are bounded', async (t) => {
  const slow = await serverFor(t, (_req, res) => setTimeout(() => res.end('{"query":{"search":[]}}'), 2_000));
  await assert.rejects(() => provider({ wikipediaApi: `${slow}/api`, openalexApi: `${slow}/oa`, crossrefApi: `${slow}/cr`, arxivApi: `${slow}/ax`, timeoutMs: 250 }).search({ query: 'x' }), (error) => error.code === 'WEB_SEARCH_TIMEOUT' || error.code === 'WEB_SEARCH_ALL_SOURCES_FAILED');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => provider({ wikipediaApi: `${slow}/api`, openalexApi: `${slow}/oa`, crossrefApi: `${slow}/cr`, arxivApi: `${slow}/ax` }).search({ query: 'x' }, controller.signal), (error) => error.code === 'WEB_SEARCH_ABORTED');
  const large = await serverFor(t, (_req, res) => { res.setHeader('content-length', '1000001'); res.end('{}'); });
  await assert.rejects(() => provider({ wikipediaApi: `${large}/api`, openalexApi: `${large}/oa`, crossrefApi: `${large}/cr`, arxivApi: `${large}/ax` }).search({ query: 'x' }), (error) => ['WEB_SEARCH_RESPONSE_TOO_LARGE', 'WEB_SEARCH_ALL_SOURCES_FAILED'].includes(error.code));
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
  const mounted = await ctx.plugin(plugin, {
    searxngEndpoint: `${origin}/search`,
    wikipediaApi: `${origin}/w/api.php`,
    openalexApi: `${origin}/works`,
    crossrefApi: `${origin}/xworks`,
    arxivApi: `${origin}/query`,
    agentWebSearch: async () => EMPTY_AGENT_WEBTOOL_RESPONSE,
  });
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
  const controller = new AbortController(); const pending = provider({ searxngEndpoint: `${origin}/search`, wikipediaApi: `${origin}/w/api.php`, openalexApi: `${origin}/works`, crossrefApi: `${origin}/xworks`, arxivApi: `${origin}/query` }).search({ query: 'cancel stream' }, controller.signal);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, (error) => error.code === 'WEB_SEARCH_ABORTED');
  assert.equal(fallbackRequests, 0);
});

// ── 国内教育站点覆盖（2026-09-12）─────────────────────────────────────────────

test('every catalogued education domain is a legal DNS name listed in exactly one tier', () => {
  const seen = new Set();
  for (const [tier, domains] of Object.entries(TEACHER_AUTHORITY_TIERS)) {
    assert.ok(domains.length > 0, `${tier} tier must not be empty`);
    assert.ok(Number.isFinite(TEACHER_AUTHORITY_WEIGHTS[tier]), `${tier} needs a numeric weight`);
    for (const domain of domains) {
      assert.equal(normalizeTrustedDomain(domain), domain, `${domain} must be a legal DNS name`);
      assert.equal(seen.has(domain), false, `${domain} is listed in more than one tier`);
      seen.add(domain);
    }
  }
  assert.deepEqual([...TEACHER_AUTHORITY_DOMAINS].sort(), [...seen].sort());
  for (const domain of ['basic.smartedu.cn', 'smartedu.cn', 'moe.gov.cn', 'pep.com.cn', 'edu.sc.gov.cn', 'sceea.cn', 'edu.chengdu.gov.cn', 'zxxk.com', 'zujuan.xkw.com', 'jyeoo.com']) {
    assert.ok(TEACHER_AUTHORITY_DOMAINS.includes(domain), `${domain} should be catalogued`);
  }
});

test('tiered authority ranks official education platforms ahead of commercial question banks', () => {
  assert.equal(domainAuthority('basic.smartedu.cn'), TEACHER_AUTHORITY_WEIGHTS.national);
  assert.equal(domainAuthority('www.smartedu.cn'), TEACHER_AUTHORITY_WEIGHTS.national);
  assert.equal(domainAuthority('www.pep.com.cn'), TEACHER_AUTHORITY_WEIGHTS.national);
  assert.equal(domainAuthority('edu.sc.gov.cn'), TEACHER_AUTHORITY_WEIGHTS.provincial);
  assert.equal(domainAuthority('www.sceea.cn'), TEACHER_AUTHORITY_WEIGHTS.provincial);
  assert.equal(domainAuthority('edu.chengdu.gov.cn'), TEACHER_AUTHORITY_WEIGHTS.municipal);
  assert.equal(domainAuthority('www.zxxk.com'), TEACHER_AUTHORITY_WEIGHTS.commercial);
  assert.equal(domainAuthority('zujuan.xkw.com'), TEACHER_AUTHORITY_WEIGHTS.commercial);
  assert.equal(domainAuthority('www.jyeoo.com'), TEACHER_AUTHORITY_WEIGHTS.commercial);
  assert.equal(domainAuthority('www.openstax.org'), TEACHER_AUTHORITY_WEIGHTS.international);
  // 分层单调性：全国级 > 省级 > 市级 > 商业教辅 > 未收录
  assert.ok(domainAuthority('www.smartedu.cn') > domainAuthority('edu.sc.gov.cn'));
  assert.ok(domainAuthority('edu.sc.gov.cn') > domainAuthority('edu.chengdu.gov.cn'));
  assert.ok(domainAuthority('edu.chengdu.gov.cn') > domainAuthority('www.zxxk.com'));
  assert.ok(domainAuthority('www.zxxk.com') > domainAuthority('unknown-blog.example'));
  // 前缀/后缀仿冒不享受加权
  assert.equal(domainAuthority('jyeoo.com.evil.example'), 0);
  assert.equal(isTrustedHostname('www.jyeoo.com'), true);
  assert.equal(isTrustedHostname('notjyeoo.com'), false);
  assert.equal(isTrustedHostname('jyeoo.com.evil.example'), false);
});

test('education query detection drives the site fanout list and keeps a hard cap', () => {
  assert.equal(isEducationQuery('2026年高考数学真题'), true);
  assert.equal(isEducationQuery('人教版八下 期中 复习'), true);
  assert.equal(isEducationQuery('unit 3 课件'), true);
  assert.equal(isEducationQuery('attention is all you need'), false);
  assert.equal(isEducationQuery('化学平衡 教学'), false);
  assert.deepEqual(educationFanoutTargets('attention is all you need'), []);
  assert.deepEqual(educationFanoutTargets('transformer 论文'), []);
  assert.deepEqual(educationFanoutTargets('2026届成都高三一诊数学试卷'), ['edu.chengdu.gov.cn', 'basic.smartedu.cn', 'zxxk.com', 'jyeoo.com']);
  assert.deepEqual(educationFanoutTargets('2027届 四川省 中考 模拟卷'), ['edu.sc.gov.cn', 'basic.smartedu.cn', 'zxxk.com', 'jyeoo.com']);
  assert.equal(educationFanoutTargets('帮我到菁优网找初二物理试题')[0], 'jyeoo.com');
  // 老师口中的「金优网」核实不到官网，按最接近的真实站点菁优网处理，不虚构域名
  const jinYou = educationFanoutTargets('金优网 联考卷');
  assert.equal(jinYou.includes('jyeoo.com'), true);
  for (const query of ['高考真题', '中考模拟', '期末试卷', '课件下载', '四川省教育厅 通知']) {
    assert.ok(educationFanoutTargets(query).length <= 4, `${query} must stay within the fanout cap`);
  }
});

test('site-limited fanout is issued only for education queries and joins the merge', async (t) => {
  const searxQueries = [];
  const origin = await serverFor(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = new URL(req.url, origin);
    if (url.pathname === '/search') { searxQueries.push(url.searchParams.get('q')); res.end(JSON.stringify({ results: [] })); }
    else res.end(JSON.stringify({ results: [], message: { items: [] }, query: { search: [] } }));
  });
  const calls = [];
  const agentWebSearch = async (input) => {
    calls.push(input);
    if (input.query.startsWith('site:zxxk.com ')) {
      return { results: [{ url: 'https://www.zxxk.com/soft/2026-yizhen.html', title: '2026届成都一诊数学试卷', snippet: '学科网试卷' }], engines: [] };
    }
    if (input.query === 'transformer attention mechanism') {
      return { results: [{ url: 'https://example.com/paper', title: 'Attention Is All You Need' }], engines: [] };
    }
    return EMPTY_AGENT_WEBTOOL_RESPONSE;
  };
  const searchProvider = new FreeWebSearchProvider({
    agentWebSearch,
    searxngEndpoint: `${origin}/search`,
    wikipediaApi: `${origin}/wiki`,
    openalexApi: `${origin}/works`,
    crossrefApi: `${origin}/xworks`,
    arxivApi: `${origin}/query`,
  });

  const education = await searchProvider.search({ query: '成都 2026届 高三 一诊 数学试卷', maxResults: 5 });
  const educationQueries = calls.map(({ query }) => query);
  assert.deepEqual(educationQueries.filter((query) => query.startsWith('site:')), [
    'site:edu.chengdu.gov.cn 成都 2026届 高三 一诊 数学试卷',
    'site:basic.smartedu.cn 成都 2026届 高三 一诊 数学试卷',
    'site:zxxk.com 成都 2026届 高三 一诊 数学试卷',
    'site:jyeoo.com 成都 2026届 高三 一诊 数学试卷',
  ]);
  // SearXNG 侧同样以 site: 限定发问
  assert.ok(searxQueries.includes('site:zxxk.com 成都 2026届 高三 一诊 数学试卷'));
  // 站点限定分组进入 mergeRank：学科网结果被加权保留
  assert.equal(education.sources[0].url, 'https://www.zxxk.com/soft/2026-yizhen.html');
  assert.match(education.content, /教育站点定向检索/);
  assert.match(education.content, /成都市教育局/);
  assert.match(education.content, /学科网（站点限定）/);
  assert.match(education.content, /学科网.*需要登录或付费/);

  calls.length = 0; searxQueries.length = 0;
  const academic = await searchProvider.search({ query: 'transformer attention mechanism', maxResults: 5 });
  assert.deepEqual(calls.map(({ query }) => query), ['transformer attention mechanism']);
  assert.deepEqual(searxQueries, ['transformer attention mechanism']);
  assert.equal(academic.content.includes('教育站点定向检索'), false);
  assert.equal(academic.content.includes('站点限定'), false);
  assert.match(academic.content, /中文网页/);
});

test('scope text states paywalled vs openly accessible education sources truthfully', async (t) => {
  const origin = await serverFor(t, (_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ results: [], message: { items: [] }, query: { search: [] } }));
  });
  const searchProvider = new FreeWebSearchProvider({
    agentWebSearch: async () => ({
      results: [
        { url: 'https://www.zxxk.com/soft/paywalled.html', title: '高三数学模拟卷（学科网）' },
        { url: 'https://basic.smartedu.cn/resource/free', title: '国家平台精品课' },
      ],
      engines: [],
    }),
    wikipediaApi: `${origin}/wiki`,
    openalexApi: `${origin}/works`,
    crossrefApi: `${origin}/xworks`,
    arxivApi: `${origin}/query`,
  });
  const result = await searchProvider.search({ query: '高三 数学 模拟试卷', maxResults: 5 });
  assert.match(result.content, /不下载文件、不绕过登录或付费墙/);
  assert.match(result.content, /学科网的试卷\/试题多数需要登录或付费后才能下载/);
  assert.match(result.content, /国家中小学智慧教育平台的公开资源通常可直接获取/);
  // 不声称已下载，也不给出伪造的下载产物
  assert.equal(/已下载|下载完成|已保存|\.zip|\.rar/.test(result.content), false);
});

test('fabricated or malformed hostnames never throw from the authority helpers', () => {
  for (const host of ['not a domain', '', '...', 'x', 'localhost', 'a_b.com', '例え.jp', 'zxxk.com.evil.example', 'made-up-nonexistent-domain-xyz.invalid', undefined, null, 42, {}]) {
    assert.doesNotThrow(() => domainAuthority(host));
    assert.doesNotThrow(() => isTrustedHostname(host));
  }
  assert.equal(domainAuthority('zxxk.com.evil.example'), 0);
  assert.equal(domainAuthority('made-up-nonexistent-domain-xyz.invalid'), 0);
  assert.equal(isTrustedHostname('evilzxxk.com'), false);
  assert.equal(isTrustedHostname('zxxk.com.evil.example'), false);
  // 调用方自定义目录里放一个编造域名：按 0.55 处理，且不抛未捕获异常
  const searchProvider = provider({ trustedDomains: ['made-up-nonexistent-domain-xyz.invalid', 'pep.com.cn'] });
  assert.equal(domainAuthority('made-up-nonexistent-domain-xyz.invalid', searchProvider.trustedDomains), 0.55);
  assert.equal(domainAuthority('www.made-up-nonexistent-domain-xyz.invalid', searchProvider.trustedDomains), 0.55);
  assert.equal(domainAuthority('pep.com.cn', searchProvider.trustedDomains), 0.55);
  // 不在自定义目录里的真实站点不再享受教辅加权
  assert.equal(domainAuthority('zxxk.com', searchProvider.trustedDomains), 0);
});
