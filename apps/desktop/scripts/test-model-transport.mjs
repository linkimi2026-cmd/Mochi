import assert from 'node:assert/strict';
import test from 'node:test';
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';

const pixels = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6eKAAAAAASUVORK5CYII=',
  'base64',
);
const ref = {
  attachmentId: 'fixture-image',
  mediaType: 'image/png',
  bytes: pixels.length,
  width: 1,
  height: 1,
  name: 'fixture.png',
};
const messages = [
  { role: 'user', content: [{ type: 'text', text: '检查这页，不要更改任务。' }] },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        id: 'render-1',
        name: 'mochi_ppt_render',
        arguments: JSON.stringify({ mode: 'page', page: 1 }),
      },
    ],
  },
  {
    role: 'user',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'render-1',
        content: [
          { type: 'text', text: '待模型查看，第1页。' },
          { type: 'image', attachment: ref },
        ],
      },
    ],
  },
];

function adapter({ images = true, attachments = true } = {}) {
  const connection = resolveAdapterOptions({
    baseURL: 'https://fixture.invalid/v1',
    apiKeyEnv: 'UNUSED_FIXTURE_KEY',
    models: [{ id: 'fixture', inputModalities: images ? ['text', 'image'] : ['text'] }],
  });
  let uploads = 0;
  return {
    get uploads() {
      return uploads;
    },
    adapter: new DeepSeekAdapter({
      options: () => connection,
      resolveApiKey: async () => 'fixture-not-a-credential',
      resolveUserId: () => 'offline-fixture',
      resolveFiles: () => ({
        ensureUploaded: async () => {
          uploads += 1;
          throw new Error('Fixture endpoint does not support Files API');
        },
      }),
      resolveAttachments: () =>
        attachments
          ? {
              readImageRequest: async (image) => ({
                attachment: image,
                variantId: 'fixture-variant',
                data: pixels,
                mediaType: 'image/png',
                width: 1,
                height: 1,
                bytes: pixels.length,
                hasAlpha: true,
              }),
            }
          : undefined,
      prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
    }),
  };
}

async function consume(adapter, input = messages) {
  const events = [];
  for await (const event of adapter.stream({
    model: 'fixture',
    messages: input,
    system: 'Keep the original task and inspect actual images.',
  }))
    events.push(event);
  return events;
}

test('installed adapter preserves task and tool-result image through inline fallback', async (t) => {
  let request;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://fixture.invalid/v1/chat/completions');
    requests += 1;
    request = JSON.parse(options.body);
    return new Response(
      'data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const item = adapter();
  await consume(item.adapter);
  assert.equal(item.uploads, 1);
  assert.equal(requests, 1);
  assert.ok(request.messages.some((message) => message.content === '检查这页，不要更改任务。'));
  const call = request.messages.find((message) => message.role === 'assistant').tool_calls[0];
  assert.equal(call.id, 'render-1');
  assert.equal(call.function.name, 'mochi_ppt_render');
  assert.deepEqual(JSON.parse(call.function.arguments), { mode: 'page', page: 1 });
  const result = request.messages.find((message) => message.role === 'tool');
  assert.equal(result.tool_call_id, 'render-1');
  assert.match(result.content, /待模型查看/);
  const imageMessage = request.messages.find(
    (message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'),
  );
  assert.equal(imageMessage.role, 'user');
  assert.equal(
    imageMessage.content.find((part) => part.type === 'image_url').image_url.url,
    `data:image/png;base64,${pixels.toString('base64')}`,
  );
});

test('unsupported model or missing attachment service fails before sending a request', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('unsupported image must not reach the network'));
  for (const options of [{ images: false }, { attachments: false }]) {
    await assert.rejects(consume(adapter(options).adapter), (error) => error.code === 'UNSUPPORTED_CONTENT');
  }
});
