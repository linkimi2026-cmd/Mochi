import assert from 'node:assert/strict';
import test from 'node:test';
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { apply, PROVIDER } from '../index.mjs';

const scenarios = [
  {
    status: 401,
    body: { error: { message: 'Invalid API key', code: 'invalid_api_key', type: 'authentication_error' } },
    code: 'AUTH',
    message: /Invalid API key/,
  },
  {
    status: 403,
    body: { error: { message: '账户余额不足', code: 'insufficient_balance' } },
    code: 'QUOTA',
    message: /账户余额或调用额度不足/,
  },
  {
    status: 403,
    body: {
      error: { message: 'You are not allowed to use this model', code: 'model_not_allowed', type: 'permission_error' },
    },
    code: 'PERMISSION_DENIED',
    message: /服务权限不足/,
  },
  {
    status: 403,
    body: { error: { message: 'Forbidden', code: 'forbidden' } },
    code: 'PROVIDER_FORBIDDEN',
    message: /HTTP 403，原因待确认/,
  },
];

test('MiMo preserves 401 authentication errors and classifies 403 only from explicit provider details', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MIMO_API_KEY;
  process.env.MIMO_API_KEY = 'fixture-only-mimo-key';

  let adapter;
  apply(
    {
      get: () => undefined,
      llm: {
        registerConfigurableProviders() {},
        registerAdapter(_routes, candidate) {
          adapter = candidate;
        },
      },
      settings: { installSection() {} },
      logger: { info() {} },
    },
    {
      apiKeyEnv: 'MIMO_API_KEY',
      baseURL: 'http://mimo.fixture/v1',
      models: [{ id: 'fixture-model', contextWindow: 4096, maxTokens: 256 }],
    },
  );

  try {
    for (const scenario of scenarios) {
      globalThis.fetch = async (url, options) => {
        assert.equal(typeof url === 'string' ? url : url.url ?? String(url), 'http://mimo.fixture/v1/chat/completions');
        assert.equal(new Headers(options?.headers ?? url.headers).get('authorization'), 'Bearer fixture-only-mimo-key');
        return new Response(JSON.stringify(scenario.body), {
          status: scenario.status,
          headers: { 'content-type': 'application/json' },
        });
      };

      await assert.rejects(
        async () => {
          for await (const _chunk of adapter.stream({
            provider: PROVIDER,
            model: 'fixture-model',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'classification probe' }] }],
          })) {
          }
        },
        (error) => {
          assert.equal(error.failure.status, scenario.status);
          assert.equal(error.code, scenario.code);
          assert.match(error.message, scenario.message);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.MIMO_API_KEY;
    else process.env.MIMO_API_KEY = originalApiKey;
  }
});

test('the 403 correction stays local to MiMo instead of changing the shared DeepSeek adapter', async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    apiKeyEnv: 'MIMO_API_KEY',
    baseURL: 'http://other-provider.fixture/v1',
    models: [{ id: 'fixture-model', contextWindow: 4096, maxTokens: 256 }],
  };
  const adapter = new DeepSeekAdapter({
    options: () => resolveAdapterOptions(config),
    resolveApiKey: async () => 'fixture-only-key',
    // Modern DeepSeek uses Messages and its public auth callback; the shared
    // adapter must still keep its own 403 semantics independently of MiMo.
    resolveAuth: async () => ({ headers: { authorization: 'Bearer fixture-only-key' } }),
    resolveUserId: () => 'fixture-user',
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Forbidden', code: 'forbidden' } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });

  try {
    await assert.rejects(
      async () => {
        for await (const _chunk of adapter.stream({
          provider: 'deepseek-official',
          model: 'fixture-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'scope probe' }] }],
        })) {
        }
      },
      (error) => {
        assert.equal(error.failure.status, 403);
        assert.equal(error.code, 'AUTH');
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
