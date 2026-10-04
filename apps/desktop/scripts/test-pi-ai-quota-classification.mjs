import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { createMessage, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm';

const scenarios = [
  {
    status: 403,
    body: { error: { message: 'Insufficient Balance', code: 'insufficient_balance' } },
    expectedCode: QUOTA_EXCEEDED_CODE,
  },
  {
    status: 401,
    body: { error: { message: 'Insufficient Balance', code: 'insufficient_balance' } },
    expectedCode: 'AUTH',
  },
  {
    status: 403,
    body: { error: { message: 'Forbidden', code: 'forbidden' } },
    expectedCode: 'AUTH',
  },
];

test('installed pi-ai adapter maps fake-gateway quota 403 while preserving auth failures', async () => {
  let nextScenario = 0;
  const requests = [];
  const server = createServer((request, response) => {
    const scenario = scenarios[nextScenario++];
    request.resume();
    request.once('end', () => {
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
      if (scenario === undefined) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Unexpected extra request' } }));
        return;
      }
      response.writeHead(scenario.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(scenario.body));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const providerId = 'fake-quota-gateway';
    const modelId = 'quota-probe';
    const model = {
      id: modelId,
      name: 'Quota probe',
      api: 'openai-completions',
      provider: providerId,
      baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 512,
    };
    const piProvider = createProvider({
      id: providerId,
      name: 'Fake quota gateway',
      baseUrl,
      auth: {
        apiKey: {
          name: 'test-only key',
          async resolve({ credential }) {
            return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
          },
        },
      },
      models: [model],
      api: openAICompletionsApi(),
    });
    const profile = {
      provider: providerId,
      displayName: 'Fake quota gateway',
      piProvider,
      streamIdleTimeoutMs: 3000,
      maxRequestImageBytes: 1024 * 1024,
      requestImagePixelBudget: 1024 * 1024,
      requestImageMaxBytes: 1024 * 1024,
      configuredMaxTokens: new Map(),
    };
    const adapter = new PiAiAdapter({
      profiles: () => new Map([[providerId, profile]]),
      resolveApiKey: async () => 'test-only-api-key',
      auth: {
        credentials: {
          async read() { return undefined; },
          async list() { return []; },
          async modify() { throw new Error('Credential writes are outside this test'); },
          async delete() {},
        },
        authContext: {
          async env() { return undefined; },
          async fileExists() { return false; },
        },
      },
    });

    for (const scenario of scenarios) {
      const chunks = [];
      for await (const chunk of adapter.stream({
        provider: providerId,
        model: modelId,
        messages: [createMessage({
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'quota classification probe' }],
        })],
        signal: AbortSignal.timeout(5000),
      })) {
        chunks.push(chunk);
      }

      const finishes = chunks.filter((chunk) => chunk.type === 'finish');
      assert.equal(finishes.length, 1, 'each provider response ends with one finish chunk');
      assert.equal(finishes[0].reason.kind, 'error');
      assert.equal(finishes[0].reason.failure.code, scenario.expectedCode);
    }

    assert.equal(nextScenario, scenarios.length, 'the adapter made exactly one request per scenario');
    assert.deepEqual(requests.map(({ method, url }) => [method, url]), scenarios.map(() => ['POST', '/v1/chat/completions']));
    assert.deepEqual(requests.map(({ authorization }) => authorization), scenarios.map(() => 'Bearer test-only-api-key'));
  } finally {
    server.close();
    await once(server, 'close');
  }
});
