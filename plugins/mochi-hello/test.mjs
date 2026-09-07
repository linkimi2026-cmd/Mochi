import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import {
  apply as applyConnection,
  inject as connectionInject,
} from '@deepseek-ai/dsh-client-connection'
import { apply as applyMimo, inject as mimoInject } from 'mochi-llm-mimo'
import { apply as applyHello } from './index.mjs'
import {
  DOCTOR_MODEL_CHECK_PATH,
  DOCTOR_MODEL_CHECK_VERSION,
  DOCTOR_MODEL_SCOPE,
  DOCTOR_MODEL_CHECK_TIMEOUT_MS,
} from './doctor.mjs'

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitFor(predicate, label, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await delay(10)
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('loopback server has no TCP address')
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(() => resolve()))
}

function fixedSse(response) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    'data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"synthetic-model-text"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n',
    'data: [DONE]\n\n',
  ].join(''))
}

async function createProvider() {
  const state = {
    mode: 'success',
    requests: [],
    open: 0,
    aborted: 0,
  }
  const server = createServer((request, response) => {
    const body = []
    request.on('data', chunk => body.push(chunk))
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://loopback.invalid')
      if (request.method !== 'POST' || url.pathname !== '/chat/completions') {
        response.writeHead(404).end()
        return
      }
      let parsed
      try {
        parsed = JSON.parse(Buffer.concat(body).toString('utf8'))
      } catch {
        response.writeHead(400).end()
        return
      }
      // Deliberately retain only non-secret request facts for assertions.
      state.requests.push({
        authorizationPresent: typeof request.headers.authorization === 'string',
        body: parsed,
      })
      if (state.mode === 'auth') {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"synthetic credential rejection"}}')
        return
      }
      if (state.mode === 'quota') {
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"synthetic quota exhausted"}}')
        return
      }
      if (state.mode === 'upstream') {
        response.destroy()
        return
      }
      if (state.mode === 'slow') {
        state.open += 1
        response.once('close', () => {
          state.open -= 1
          if (!response.writableEnded) state.aborted += 1
        })
        return
      }
      fixedSse(response)
    })
  })
  return { state, server, url: await listen(server) }
}

class Credentials {
  constructor(value) {
    this.value = value
    this.record = undefined
    this.resolveCalls = 0
  }

  async resolve() {
    this.resolveCalls += 1
    return this.value === undefined ? undefined : { value: this.value }
  }

  async readRecord() { return this.record }

  async modifyRecord(_key, mutate) {
    const next = await mutate(this.record)
    if (next !== undefined) this.record = next
    return this.record
  }

  async deleteRecord() { this.record = undefined }
}

function webServer(routes) {
  return {
    register(route) {
      if (routes.some(candidate => candidate.kind === route.kind && candidate.path === route.path)) {
        throw new Error(`duplicate route ${route.path}`)
      }
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade() { return () => {} },
    tapIndex() { return () => {} },
    port: 0,
  }
}

async function createHost(provider) {
  const credentials = new Credentials('synthetic-credential')
  const ctx = new Context()
  const routes = []
  ctx.provide('credentials', credentials)
  ctx.provide('webServer', webServer(routes))

  const llm = ctx.plugin(LlmRuntime)
  await llm.await()
  const connection = ctx.plugin({ inject: [...connectionInject], apply: applyConnection }, { trustedHosts: [] })
  await connection.await()
  const mimo = ctx.plugin({ inject: [...mimoInject], apply: applyMimo }, {
    apiKeyEnv: 'MIMO_API_KEY',
    baseURL: provider.url,
    reasoningEffort: 'low',
    models: [{
      id: 'mimo-loopback',
      contextWindow: 1024,
      maxTokens: 32,
      reasoningEfforts: ['off', 'low', 'high'],
    }],
  })
  await mimo.await()
  const hello = ctx.plugin({ apply: applyHello })
  await hello.await()

  const apiRoute = routes.find(route => route.kind === 'prefix' && route.path === '/api')
  assert.ok(apiRoute, 'actual Connection did not register its /api route')
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://host.invalid')
    if (url.pathname === '/') {
      if (ctx.connection.authorizeIndex(request, response)) response.writeHead(200).end('index')
      return
    }
    if (url.pathname.startsWith('/api/')) {
      await apiRoute.handler(request, response)
      return
    }
    response.writeHead(404).end()
  })
  const origin = await listen(server)
  const authResponse = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
  assert.equal(authResponse.status, 303, 'actual BrowserAuth token exchange must mint the session cookie')
  const cookie = authResponse.headers.get('set-cookie')
  assert.ok(cookie, 'actual BrowserAuth response did not set a session cookie')

  return {
    connection: ctx.get('connection'),
    credentials,
    origin,
    cookie: cookie.split(';', 1)[0],
    async dispose() {
      await close(server)
      await hello.dispose()
      await mimo.dispose()
      await connection.dispose()
      await llm.dispose()
    },
  }
}

async function doctorPost(host, body = undefined, options = {}) {
  const headers = { cookie: host.cookie, ...options.headers }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return fetch(`${host.origin}${DOCTOR_MODEL_CHECK_PATH}`, {
    method: 'POST',
    headers,
    ...body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) },
    ...options.signal === undefined ? {} : { signal: options.signal },
  })
}

function assertSchema(body) {
  assert.deepEqual(Object.keys(body).sort(), ['credentials', 'model-service', 'scope', 'version'])
  assert.equal(body.version, DOCTOR_MODEL_CHECK_VERSION)
  assert.equal(body.scope, DOCTOR_MODEL_SCOPE)
  for (const name of ['model-service', 'credentials']) {
    assert.deepEqual(Object.keys(body[name]).sort(), ['code', 'durationMs', 'status'])
    assert.equal(typeof body[name].status, 'string')
    assert.equal(typeof body[name].code, 'string')
    assert.equal(typeof body[name].durationMs, 'number')
    assert.ok(body[name].durationMs >= 0 && body[name].durationMs <= DOCTOR_MODEL_CHECK_TIMEOUT_MS)
  }
}

// The profile mounts mochi-hello even without Connection; its original apply must settle.
{
  const headless = new Context()
  const hello = headless.plugin({ apply: applyHello })
  await hello.await()
  assert.equal(headless.get('connection'), undefined)
  await hello.dispose()
}

const provider = await createProvider()
const host = await createHost(provider)
try {
  // Authentication remains entirely in Connection's existing gateway.
  const unauthenticated = await fetch(`${host.origin}${DOCTOR_MODEL_CHECK_PATH}`, { method: 'POST' })
  assert.equal(unauthenticated.status, 401)
  assert.equal(provider.state.requests.length, 0)

  const malformed = await doctorPost(host, { provider: 'caller-controlled' })
  assert.equal(malformed.status, 400)
  assertSchema(await malformed.json())
  assert.equal(provider.state.requests.length, 0)

  const preAborted = new AbortController()
  preAborted.abort()
  const beforePreAborted = provider.state.requests.length
  const shared = host.connection.createSharedFetchHandler('/api')
  const preAbortedResponse = await shared.fetch(new Request(`http://host.invalid${DOCTOR_MODEL_CHECK_PATH}`, {
    method: 'POST', signal: preAborted.signal,
  }))
  assert.equal(preAbortedResponse.status, 499)
  const preAbortedBody = await preAbortedResponse.json()
  assertSchema(preAbortedBody)
  assert.equal(preAbortedBody['model-service'].code, 'CANCELLED')
  assert.equal(provider.state.requests.length, beforePreAborted, 'an already aborted request must not start a model call')

  const success = await doctorPost(host, {})
  assert.equal(success.status, 200)
  const successBody = await success.json()
  assertSchema(successBody)
  assert.deepEqual(successBody['model-service'].status, 'ok')
  assert.deepEqual(successBody.credentials.status, 'ok')
  assert.equal(provider.state.requests.length, 1)
  const wire = provider.state.requests[0]
  assert.equal(wire.authorizationPresent, true)
  assert.equal(wire.body.model, 'mimo-loopback')
  assert.equal(wire.body.max_tokens, 1)
  assert.ok(!('tools' in wire.body) || (Array.isArray(wire.body.tools) && wire.body.tools.length === 0))
  assert.deepEqual(wire.body.messages, [{ role: 'user', content: 'Mochi model diagnostic.' }])
  assert.ok(!JSON.stringify(successBody).includes('synthetic-model-text'))
  assert.ok(!JSON.stringify(successBody).includes('synthetic-credential'))
  assert.ok(!JSON.stringify(successBody).includes(provider.url))

  host.credentials.value = undefined
  const beforeMissingCredential = provider.state.requests.length
  const missing = await doctorPost(host, {})
  assert.equal(missing.status, 200)
  const missingBody = await missing.json()
  assertSchema(missingBody)
  assert.deepEqual([missingBody['model-service'].code, missingBody.credentials.code], ['MISSING_CREDENTIAL', 'MISSING_CREDENTIAL'])
  assert.equal(provider.state.requests.length, beforeMissingCredential, 'missing credentials must not reach loopback')

  host.credentials.value = 'bad-synthetic-credential'
  provider.state.mode = 'auth'
  const rejected = await doctorPost(host, {})
  assert.equal(rejected.status, 200)
  const rejectedBody = await rejected.json()
  assertSchema(rejectedBody)
  assert.deepEqual([rejectedBody['model-service'].code, rejectedBody.credentials.code], ['AUTH_FAILED', 'AUTH_FAILED'])
  assert.ok(!JSON.stringify(rejectedBody).includes('bad-synthetic-credential'))
  assert.ok(!JSON.stringify(rejectedBody).includes('synthetic credential rejection'))

  provider.state.mode = 'quota'
  const quota = await doctorPost(host, {})
  assert.equal(quota.status, 200)
  const quotaBody = await quota.json()
  assertSchema(quotaBody)
  assert.deepEqual([quotaBody['model-service'].code, quotaBody.credentials.code], ['ACCOUNT_UNAVAILABLE', 'NOT_CHECKED'])

  provider.state.mode = 'upstream'
  const upstream = await doctorPost(host, {})
  assert.equal(upstream.status, 200)
  const upstreamBody = await upstream.json()
  assertSchema(upstreamBody)
  assert.equal(upstreamBody['model-service'].code, 'UPSTREAM_UNAVAILABLE')
  assert.equal(upstreamBody.credentials.status, 'not-checked')

  provider.state.mode = 'slow'
  const beforeTimeoutAbort = provider.state.aborted
  const timeout = await doctorPost(host, {})
  assert.equal(timeout.status, 200)
  const timeoutBody = await timeout.json()
  assertSchema(timeoutBody)
  assert.equal(timeoutBody['model-service'].code, 'TIMEOUT')
  assert.equal(timeoutBody.credentials.status, 'not-checked')
  await waitFor(() => provider.state.aborted > beforeTimeoutAbort, 'timeout cancellation reaches the loopback stream', 1_500)

  provider.state.mode = 'slow'
  const beforeCancelAbort = provider.state.aborted
  const cancellation = new AbortController()
  const pending = doctorPost(host, {}, { signal: cancellation.signal })
  await waitFor(() => provider.state.open === 1, 'the one in-flight model check')
  const busy = await doctorPost(host, {})
  assert.equal(busy.status, 409)
  const busyBody = await busy.json()
  assertSchema(busyBody)
  assert.equal(busyBody['model-service'].code, 'CHECK_IN_PROGRESS')
  cancellation.abort()
  await pending.catch(() => undefined)
  await waitFor(() => provider.state.aborted > beforeCancelAbort, 'client cancellation reaches the loopback stream', 1_500)

  provider.state.mode = 'success'
  await delay(25)
  const afterCancellation = await doctorPost(host, {})
  assert.equal(afterCancellation.status, 200, 'the in-flight guard must release after cancellation')
  const afterCancellationBody = await afterCancellation.json()
  assertSchema(afterCancellationBody)
  assert.equal(afterCancellationBody['model-service'].code, 'OK')
  assert.equal(provider.state.open, 0)

  console.log(JSON.stringify({
    ok: true,
    route: DOCTOR_MODEL_CHECK_PATH,
    scope: DOCTOR_MODEL_SCOPE,
    cases: ['unauthenticated', 'invalid-payload', 'success', 'missing-credential', 'bad-credential', 'account', 'upstream', 'timeout', 'cancel-and-cleanup'],
    providerRequests: provider.state.requests.length,
    providerOpen: provider.state.open,
    providerAborted: provider.state.aborted,
  }))
} finally {
  await host.dispose()
  await close(provider.server)
}
