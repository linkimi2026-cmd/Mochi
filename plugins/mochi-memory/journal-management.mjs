/** Registered on the Host's authenticated Connection, never a separate HTTP server. */
export function installJournalManagement(ctx, journal, { generate = day => journal.generateDay(day), configured = () => {}, scheduling = () => null } = {}) {
  const snapshot = () => ({
    settings: journal.settings(),
    entries: journal.list().map(({ body, sources, ...entry }) => ({ ...entry, excerpt: body.slice(0, 180) })),
    history: journal.history(),
    scheduling: scheduling(),
  });
  const read = async request => {
    const raw = await request.text();
    if (raw.length > 30000) throw new Error('正文过长，请缩短后保存。');
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请求无效。');
    return input;
  };
  const register = (path, method, action) => ctx.connection.fetch.register({
    path: '/api/mochi-memory/journal' + path, methods: [method], requestBody: 'buffered',
    fetch: async request => {
      let result, status = 200;
      try { result = await action(request); }
      catch (error) {
        status = error.code === 'JOURNAL_REVISION_CONFLICT' ? 409 : error.code === 'JOURNAL_NOT_FOUND' ? 404 : 400;
        result = { error: String(error.message ?? error), code: error.code };
      }
      return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    },
  });
  return [
    register('/state', 'GET', snapshot),
    register('/entry', 'GET', request => {
      const entry = journal.get(new URL(request.url).searchParams.get('id'));
      if (!entry) throw Object.assign(new Error('这篇日记不存在。'), { code: 'JOURNAL_NOT_FOUND' });
      return entry;
    }),
    register('/versions', 'GET', request => journal.versions(new URL(request.url).searchParams.get('id'))),
    register('/configure', 'POST', async request => { journal.configure(await read(request)); await configured(); return snapshot(); }),
    register('/generate', 'POST', async request => { const generated = await generate((await read(request)).date); return { ...snapshot(), generated }; }),
    register('/edit', 'POST', async request => { journal.edit(await read(request)); return snapshot(); }),
    register('/history', 'POST', async request => { journal.editHistory(await read(request)); return snapshot(); }),
    register('/summarize', 'POST', async request => journal.summarizeRange(await read(request))),
  ];
}
