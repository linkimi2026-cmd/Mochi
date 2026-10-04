import { classifyTranscript } from './intents.mjs';

const BASE = '/api/mochi-classroom';
const MAX_AUDIO_BYTES = 44 + 16000 * 2 * 15;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Official Connection applies authentication and the Host/Origin fence first. */
export function installClassroomHostBridge(ctx, store, { validateWave }) {
  if (!ctx.connection?.fetch?.register || !ctx.speechToText) throw new Error('Classroom listening requires Connection and official speechToText');
  let busy = false;
  const announceLesson = letter => {
    if (!letter) return;
    const excerpts = (letter.notes ?? []).slice(0, 6).map(note => ({
      id: note.id, text: note.text.slice(0, 240), segmentIds: note.segmentIds.slice(0, 4),
    }));
    ctx.emit?.('mochi-classroom/lesson-finished', {
      id: letter.id, endedAt: letter.endedAt, segmentCount: letter.segments.length, excerpts,
    });
  };
  const state = () => ({ ...store.snapshot(), speech: ctx.speechToText.snapshot() });
  const local = () => {
    const snapshot = ctx.speechToText.snapshot();
    const provider = snapshot.providers.find(item => item.id === snapshot.selection.providerId);
    if (provider?.location !== 'host-local') throw new Error('课堂监听仅使用本地语音识别，请先在语音设置选择本地识别。');
    return provider;
  };
  const register = (path, method, action) => ctx.connection.fetch.register({ path: BASE + path, methods: [method], requestBody: path === '/transcribe' ? 'streaming' : 'buffered', fetch: async request => {
    try { return json(await action(request)); }
    catch (error) { return json({ error: String(error.message ?? error) }, error.status ?? 400); }
  } });
  const body = async request => {
    const length = Number(request.headers.get('content-length'));
    if (length > 110000) throw new Error('请求过大。');
    const raw = await request.text();
    if (raw.length > 110000) throw new Error('请求过大。');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效请求。');
    return value;
  };
  const disposers = [
    register('/state', 'GET', () => state()),
    register('/prepare', 'POST', () => { ctx.speechToText.prepare(local().id); return state(); }),
    register('/configure', 'POST', async request => { store.configure((await body(request)).autoStartListening); return state(); }),
    register('/transcribe', 'POST', async request => {
      if (busy) throw Object.assign(new Error('上一段录音仍在识别。'), { status: 409 });
      busy = true;
      try {
        local();
        const reader = request.body?.getReader();
        if (!reader) throw new Error('缺少录音。');
        const chunks = []; let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > MAX_AUDIO_BYTES) { await reader.cancel(); throw new Error('录音超过15秒。'); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
        const audio = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.length; }
        validateWave(audio, 15);
        const result = await ctx.speechToText.transcribe(ctx.speechToText.resolve({ audio }), request.signal);
        if (request.signal.aborted) throw new Error('录音已取消。');
        if (typeof result.text !== 'string' || result.text.length > 8000) throw new Error('无效识别结果。');
        const intent = classifyTranscript(result.text, !!store.data.active);
        let letter = null;
        if (intent.kind === 'begin') store.begin(result.text);
        if (intent.kind === 'append') store.append(result.text);
        if (intent.kind === 'finish') letter = store.finish();
        const lesson = store.acceptLessonTranscript(result.text);
        announceLesson(lesson.letter);
        return { ...result, intent, letter, lessonIntent: { kind: lesson.kind }, lessonLetter: lesson.letter, state: state() };
      } finally { busy = false; }
    }),
    register('/finish', 'POST', () => ({ letter: store.finish(), state: state() })),
    register('/lesson/begin', 'POST', () => store.beginLesson()),
    register('/lesson/finish', 'POST', () => { const letter = store.finishLesson(); announceLesson(letter); return { letter, state: state() }; }),
    register('/edit', 'POST', async request => { const input = await body(request); return { letter: store.edit(input.id, input.body), state: state() }; }),
    register('/discard', 'POST', () => { store.discard(); return state(); }),
  ];
  return () => disposers.reverse().forEach(dispose => dispose?.());
}
