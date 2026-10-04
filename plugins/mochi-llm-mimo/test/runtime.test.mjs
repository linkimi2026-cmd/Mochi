import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { apply, PROVIDER } from '../index.mjs'

async function fixture(run) {
  const requests = []
  let mode = 'text', aborted = 0
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      requests.push({ path: req.url, authorized: req.headers.authorization === 'Bearer fixture-only-key', body: JSON.parse(body) })
      if (mode === 'slow') { res.on('close', () => aborted++); return }
      if (typeof mode === 'object') {
        res.writeHead(mode.status, { 'content-type': 'application/json' }).end(JSON.stringify(mode.body))
        return
      }
      const parts = mode === 'tools' ? [
        { delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name: 'lookup', arguments: '{"topic":' } }] } },
        { delta: { tool_calls: [{ index: 0, function: { arguments: '"课堂"}' } }] } },
        { delta: {}, finish_reason: 'tool_calls' },
      ] : [{ delta: { content: '本地测试回复' } }, { delta: {}, finish_reason: 'stop' }]
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(parts.map(part => `data: ${JSON.stringify({ choices: [{ index: 0, ...part }] })}\n\n`).join('') + 'data: [DONE]\n\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let adapter, changeSource
  let config = {
    baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKeyEnv: 'FIXTURE_MIMO_KEY',
    models: [{ id: 'fixture-model', name: 'Fixture', contextWindow: 8192, maxTokens: 64, reasoningEfforts: ['off', 'low', 'high'], inputModalities: ['text', 'image'] }],
    reasoningEffort: 'low',
  }
  const ctx = {
    get: name => name === 'credentials' ? { resolve: async ref => ({ value: ref === 'NEXT_FIXTURE_KEY' ? 'fixture-next-key' : 'fixture-only-key' }) } : undefined,
    llm: { registerConfigurableProviders() {}, registerAdapter(_routes, value) { adapter = value } },
    settings: { installSection(_ctx, _ns, _schema, _initial, hooks) { changeSource = hooks.setSource; changeSource(() => config) } },
  }
  apply(ctx, config)
  const request = extra => ({ provider: PROVIDER, model: 'fixture-model', messages: [{ role: 'user', content: [{ type: 'text', text: '真实环回协议测试' }] }], ...extra })
  const read = async extra => { const result = []; for await (const chunk of adapter.stream(request(extra))) result.push(chunk); return result }
  try { await run({ adapter, requests, read, request, mode: value => mode = value, aborted: () => aborted, update: value => { config = { ...config, ...value }; changeSource(() => config) } }) }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}

test('real loopback preserves configured catalog, thinking, current settings, tools and cancellation', () => fixture(async f => {
  const models = await f.adapter.listModels(PROVIDER)
  assert.equal(models.length, 1); assert.equal(models[0].id, 'fixture-model')
  assert.deepEqual(models[0].inputModalities, ['text', 'image'])
  const model = await f.adapter.resolveModel(PROVIDER, 'fixture-model')
  assert.equal(model.context.contextWindow, 8192)
  assert.deepEqual(model.reasoning.efforts.map(x => x.id), ['off', 'low', 'high'])
  const chunks = await f.read({ maxTokens: 32 })
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(f.requests.at(-1).path, '/v1/chat/completions')
  assert.equal(f.requests.at(-1).authorized, true)
  assert.equal(f.requests.at(-1).body.reasoning_effort, 'low')
  assert.equal(f.requests.at(-1).body.thinking.type, 'enabled')
  assert.equal(f.requests.at(-1).body.max_tokens, 32)
  const frozen = await f.adapter.prepareCall(PROVIDER, 'fixture-model')
  await f.read({ reasoningEffort: 'off' })
  assert.equal(f.requests.at(-1).body.thinking.type, 'disabled')
  assert.equal(f.requests.at(-1).body.reasoning_effort, undefined)
  f.mode('tools')
  const tools = [{ name: 'lookup', description: '查课堂主题', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } }]
  const toolChunks = await f.read({ tools })
  assert.equal(toolChunks.at(-1).reason.kind, 'tool-calls')
  assert.equal(f.requests.at(-1).body.tools[0].function.name, 'lookup')
  assert.equal(toolChunks.some(c => c.type === 'block-end' && c.block?.type === 'tool-call'), true)
  f.mode('text'); f.update({ apiKeyEnv: 'NEXT_FIXTURE_KEY', models: [{ id: 'fixture-model', contextWindow: 512, maxTokens: 16, reasoningEfforts: ['off'] }] })
  await f.read()
  assert.equal(f.requests.at(-1).authorized, false)
  assert.equal(f.requests.at(-1).body.thinking.type, 'disabled')
  assert.equal((await f.adapter.resolveModel(PROVIDER, 'fixture-model')).context.contextWindow, 512)
  for await (const _chunk of frozen.stream(f.request({ maxTokens: 32 }))) {}
  assert.equal(f.requests.at(-1).body.reasoning_effort, 'low')
  assert.equal(f.requests.at(-1).body.max_tokens, 32)
  f.mode('slow')
  const signal = new AbortController()
  const reading = f.read({ signal: signal.signal })
  await new Promise(resolve => setTimeout(resolve, 50)); signal.abort()
  try { const cancelled = await reading; assert.equal(cancelled.at(-1).reason.kind, 'aborted') }
  catch (error) { assert.equal(error.code, 'ABORTED') }
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.aborted(), 1)
}))

test('invalid catalogs and credential references reject before any provider request', () => {
  const context = { llm: { registerAdapter() { throw new Error('must not register') } } }
  const config = { baseURL: 'http://127.0.0.1:1/v1', apiKeyEnv: 'FIXTURE_KEY', models: [{ id: 'fixture', contextWindow: 8192, maxTokens: 32 }] }
  assert.throws(() => apply(context, { ...config, models: [config.models[0], config.models[0]] }), /duplicate|unique/i)
  assert.throws(() => apply(context, { ...config, apiKeyEnv: 'not a credential ref' }), /credential/i)
  assert.throws(() => apply(context, { ...config, models: [{ ...config.models[0], contextWindow: 0 }] }))
})

test('real loopback preserves status and classifies only explicit MiMo 403 details', () => fixture(async f => {
  for (const [status, body, code] of [
    [401, { error: { message: 'Invalid API key', code: 'invalid_api_key' } }, 'AUTH'],
    [403, { error: { message: '账户余额不足', code: 'insufficient_balance' } }, 'QUOTA'],
    [403, { error: { message: 'Forbidden', code: 'permission_denied' } }, 'PERMISSION_DENIED'],
    [403, { error: { message: 'Forbidden', code: 'forbidden' } }, 'PROVIDER_FORBIDDEN'],
    [429, { error: { message: 'quota exhausted' } }, 'QUOTA'],
  ]) {
    f.mode({ status, body })
    await assert.rejects(() => f.read(), error => { assert.equal(error.code, code); assert.equal(error.failure.status, status); return true })
  }
}))
