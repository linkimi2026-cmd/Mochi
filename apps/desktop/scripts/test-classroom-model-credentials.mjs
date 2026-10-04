#!/usr/bin/env node
/**
 * Exercises the classroom Models-page credential reference through the actual
 * local DSH credential store and MiMo adapter, using a disposable DSH home and
 * an in-process fake gateway. No user home or real provider key is read.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { apply, PROVIDER } from '../../../plugins/mochi-llm-mimo/index.mjs'

const refs = ['MIMO_API_KEY', 'CLASSROOM_MIMO_KEY', 'MOCHI_MIMO_API_KEY']
const originalEnv = Object.fromEntries(refs.map((ref) => [ref, process.env[ref]]))
const home = mkdtempSync(join(tmpdir(), 'mochi-classroom-model-credentials-'))
const credentialPath = join(home, '.credentials.yaml')
const fixtureKey = 'fixture-classroom-key-never-a-real-secret'
const legacyFixtureKey = 'fixture-legacy-seed-never-a-real-secret'
let credentials

try {
  // Keep both refs empty in the process so the test proves the value came from DSH_HOME.
  for (const ref of refs) process.env[ref] = ''
  credentials = new LocalCredentialProvider(new Context(), { dshHome: home, watch: false })
  await credentials.set('MIMO_API_KEY', legacyFixtureKey)
  // The native Models page resolves this ref from mochi-llm-mimo settings and
  // overwrites the old seed value through credentials.set.
  await credentials.set('MIMO_API_KEY', fixtureKey)
  assert.equal((await credentials.resolve('MIMO_API_KEY'))?.source, 'file')
  assert.match(readFileSync(credentialPath, 'utf8'), /MIMO_API_KEY:/)
  if (process.platform !== 'win32') {
    assert.equal(statSync(credentialPath).mode & 0o777, 0o600)
  }

  const runtimeConfig = {
    apiKeyEnv: 'MIMO_API_KEY',
    baseURL: 'http://127.0.0.1:43129/v1',
    models: [{ id: 'fixture-model', contextWindow: 8192, maxTokens: 256 }],
  }
  let adapter
  let installedSection
  apply({
    get: (key) => key === 'credentials' ? credentials : undefined,
    settings: {
      installSection(owner, namespace, schema, initial, hooks) {
        installedSection = { owner, namespace, schema, initial }
        hooks.setSource(() => initial)
        hooks.onChange()
      },
    },
    llm: {
      registerConfigurableProviders() {},
      registerAdapter(_routes, candidate) { adapter = candidate },
    },
    logger: { info() {} },
  }, runtimeConfig)
  assert.ok(adapter, 'MiMo adapter was not registered')
  assert.equal(installedSection?.namespace, 'mochi-llm-mimo', 'MiMo must be editable in the native Models page')
  assert.equal(installedSection?.initial?.apiKeyEnv, 'MIMO_API_KEY', 'the Models card must write the ref used by the adapter')
  assert.equal(PROVIDER, 'mochi-mimo')

  const authorizations = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:43129/v1/chat/completions')
    authorizations.push(options.headers.authorization)
    return new Response(
      'data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )
  }
  try {
    const sendFixtureRequest = async () => {
      for await (const _chunk of adapter.stream({
        provider: PROVIDER,
        model: 'fixture-model',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture request' }] }],
      })) {}
    }
    await sendFixtureRequest()
    await credentials.set('CLASSROOM_MIMO_KEY', 'fixture-custom-ref-key')
    runtimeConfig.apiKeyEnv = 'CLASSROOM_MIMO_KEY'
    await sendFixtureRequest()
    // An older Models UI may have written the route-derived ref. Keep that
    // fallback for a runtime whose stored canonical ref is not configured.
    await credentials.unset('CLASSROOM_MIMO_KEY')
    await credentials.set('MOCHI_MIMO_API_KEY', legacyFixtureKey)
    await sendFixtureRequest()
    runtimeConfig.apiKeyEnv = 'MIMO_API_KEY'
    process.env.MIMO_API_KEY = 'fixture-inherited-old-key'
    assert.deepEqual(await credentials.describe('MIMO_API_KEY'), { configured: true, source: 'env', writable: false })
    await sendFixtureRequest()
    process.env.MIMO_API_KEY = ''
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(authorizations, [`Bearer ${fixtureKey}`, 'Bearer fixture-custom-ref-key', `Bearer ${legacyFixtureKey}`, 'Bearer fixture-inherited-old-key'])
  console.log('classroom Models-page default/custom/legacy refs and inherited-env priority → MiMo fake-gateway request passed')
} finally {
  for (const ref of refs) {
    if (originalEnv[ref] === undefined) delete process.env[ref]
    else process.env[ref] = originalEnv[ref]
  }
  rmSync(home, { recursive: true, force: true })
}
