import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Context, Service } from '@deepseek-ai/cordis';
import { Session, SessionStore } from '@deepseek-ai/dsh-session';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { TokenMeter } from '@deepseek-ai/dsh-token-meter';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

const { parse } = createRequire(import.meta.url)('yaml');
const root = new URL('../../../', import.meta.url);
const roles = [
  ...['lesson-planning', 'grade-analysis', 'materials-assessment', 'classroom-coordination']
    .map(name => `client-plugins/teacher-agent-presets/${name}/agent.cordis.yml`),
  'apps/desktop/resources/mochi-web/classroom-agent-presets/classroom/agent.cordis.yml',
];
function configFor(path) {
  const rows = parse(readFileSync(new URL(path, root), 'utf8').replace(/!!js[^\n]*/g, 'false'));
  const group = rows.find(row => row.id === 'compaction');
  assert.deepEqual(group.isolate, { compaction: true, toolResultPruner: true });
  assert.equal(group.name, 'cordis:group');
  for (const name of ['compaction-basic', 'command-compact', 'tool-result-pruner']) {
    const row = group.config.find(item => item.id === name);
    assert.ok(row && row.disabled !== true, `${path}: ${name}`);
  }
  const basic = group.config.find(row => row.id === 'compaction-basic').config;
  // aiaaa 网关强制思考且不可关闭，思考 token 计入 max_tokens：默认 8192 时
  // 实测思考已占 2831，余量只剩约 2.9×；输出被截空时 summarizer 抛
  // `summarization produced no text summary content`，长会话就此撞上下文墙。
  // 这道下限守卫防止有人把配额改回默认值——注意宿主面的同名行被 dsh-web-app
  // 置为 disabled: true，改那里不生效，只能落在 preset 里。
  assert.ok(
    Number.isInteger(basic.maxTokens) && basic.maxTokens >= 16384,
    `${path}: compaction-basic.maxTokens 必须 >= 16384，实际 ${basic.maxTokens}`,
  );
  return basic;
}

// Offline transport fixture: no model/provider network calls or credentials.
class FixtureLlm extends Service {
  calls = [];
  constructor(ctx, finish = 'stop', capacity = 4000) {
    super(ctx, 'llm'); this.finish = finish; this.capacity = capacity;
  }
  imageRequestPricing() { return undefined; }
  async resolveModelInfo() { return { context: { contextWindow: this.capacity } }; }
  async *stream(options) {
    this.calls.push(options);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Keep original task. Latest file /work/final.pptx; page 2 visually unchecked. Next: inspect page 2. Never resend pending job send-7.' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Keep original task. Latest file /work/final.pptx; page 2 visually unchecked. Next: inspect page 2. Never resend pending job send-7.' } };
    yield { type: 'finish', reason: { kind: this.finish } };
  }
}
function setup(t, config, options = {}) {
  const ctx = new Context();
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  const llm = new FixtureLlm(ctx, options.finish, options.capacity);
  const meter = new TokenMeter(ctx);
  const engine = new BasicCompactionEngine(ctx, config);
  t.after(() => ctx.fiber.dispose());
  const session = ctx.sessions.create();
  session.append('request/header', { reason: 'initial', header: {
    config: { provider: 'deepseek-offline-fixture', model: 'fixture' },
    system: 'Preserve original requirements, file versions and unverified visual evidence.',
  } });
  for (let i = 0; i < 7; i++) session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `Historical material ${i}: ${'source information '.repeat(170)}` }],
    source: { kind: 'plugin', plugin: 'compaction-test' },
  }), { surfaceOp: 'append' });
  session.append('turn/start', { turn: 1 });
  const agent = { session, options: { provider: 'deepseek-offline-fixture', model: 'fixture' } };
  const tick = () => ctx.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, () => 'continued');
  return { ctx, llm, meter, engine, session, tick };
}

for (const role of roles) test(`${role}: pressure automatically compacts with the installed backend`, async t => {
  const state = setup(t, configFor(role));
  const before = state.meter.measure(state.session).totalTokens;
  assert.ok(before >= 3200);
  assert.equal(await state.tick(), 'continued');
  assert.equal(state.llm.calls.length, 1);
  assert.equal(state.llm.calls[0].purpose, 'compaction');
  assert.match(state.llm.calls[0].messages.at(-1).content[0].text, /Primary Request and Intent/);
  assert.equal(state.session.snapshotEvents().filter(e => e.type === 'compaction/summary').length, 1);
  assert.ok(state.meter.measure(state.session).totalTokens < before);
  assert.equal(state.session.snapshotEvents().filter(e => e.type === 'compaction/end').length, 1);
  // Persistent log remains lossless; restored surface retains the checkpoint.
  const restored = Session.create('restored', state.session.snapshotEvents());
  assert.deepEqual(restored.deriveMessages(), state.session.deriveMessages());
  assert.ok(state.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.content[0]?.text?.includes('Historical material 0')));
  await state.tick();
  assert.equal(state.llm.calls.length, 1, 'do not compact again below pressure threshold');
});

test('truncated summary fails without replacing source history', async t => {
  const state = setup(t, configFor(roles[0]), { finish: 'max-tokens' });
  const before = state.session.deriveMessages();
  await state.tick();
  assert.equal(state.llm.calls.length, 1);
  assert.deepEqual(state.session.deriveMessages(), before);
  assert.equal(state.session.snapshotEvents().filter(e => e.type === 'compaction/summary').length, 0);
});

test('below threshold and disabled automation do not call the summarizer', async t => {
  const state = setup(t, { ...configFor(roles[0]), auto: false });
  await state.tick();
  assert.equal(state.llm.calls.length, 0);
  const low = setup(t, configFor(roles[0]), { capacity: 100000 });
  await low.tick();
  assert.equal(low.llm.calls.length, 0);
});
