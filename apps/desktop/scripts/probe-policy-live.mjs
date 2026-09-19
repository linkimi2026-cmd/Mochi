import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
if (process.argv.length !== 4 || process.argv[2] !== '--run') {
  console.error(
    'Live provider requests: node apps/desktop/scripts/probe-policy-live.mjs --run /absolute/new-output-directory',
  );
  process.exit(2);
}
const out = resolve(process.argv[3]);
await mkdir(out);
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${root}/apps/desktop/package.json`);
const { parse } = require('yaml');
const { DeepSeekAdapter, resolveAdapterOptions } = await import(
  pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek'))
);
const settings = parse(await readFile(`${root}/.mochi-home.nosync/settings.yaml`, 'utf8'));
const provider = settings['llm-pi-ai']?.providers?.deepseek;
if (provider?.baseURL !== 'https://api.deepseek.com' || provider.apiKeyEnv !== 'DEEPSEEK_API_KEY')
  throw new Error('Expected configured official DeepSeek endpoint and credential reference');
const config = {
  baseURL: provider.baseURL,
  apiKeyEnv: provider.apiKeyEnv,
  models: [
    { id: 'deepseek-flash', inputModalities: ['text', 'image'] },
    { id: 'deepseek-v4-pro', inputModalities: ['text'] },
  ],
};
const credentials = parse(await readFile(`${root}/.mochi-home.nosync/.credentials.yaml`, 'utf8'));
const apiKey = credentials.refs?.[config.apiKeyEnv];
if (!apiKey) throw new Error('Missing configured DeepSeek credential');
const response = await fetch(`${config.baseURL}/models`, {
  headers: { Authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error(`DeepSeek model discovery failed: ${response.status}`);
const catalog = await response.json();
if (config.models.some((model) => !catalog.data?.some((item) => item.id === model.id)))
  throw new Error('Required DeepSeek model unavailable');
await writeFile(`${out}/model-catalog.json`, JSON.stringify(catalog, null, 2));
const persona = (text) => parse(text).find((row) => row.id === 'system-prompt')?.config?.persona;
const baseline = persona(
  execFileSync('git', ['show', 'HEAD:apps/desktop/resources/mochi-web/patches/core.patch.yml'], {
    cwd: root,
    encoding: 'utf8',
  }),
);
const candidate =
  persona(await readFile(`${root}/apps/desktop/resources/mochi-web/patches/core.patch.yml`, 'utf8')) +
  '\n' +
  (await readFile(`${root}/plugins/mochi-hello/work-quality.md`, 'utf8'));
if (!baseline) throw new Error('Missing baseline persona');
const connection = resolveAdapterOptions(config);
const adapter = new DeepSeekAdapter({
  options: () => connection,
  resolveApiKey: async () => apiKey,
  resolveUserId: () => 'mochi-synthetic-policy-evaluation',
  prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
});
const tests = [
  {
    id: 'denominator',
    input:
      '这是合成测试，无工具可用。班级4人，分数分别为80、0、缺考、100。缺考不计入平均分，零分计入。请给出平均分、分母和缺考人数，保留两位小数。',
  },
  {
    id: 'unverified-visual',
    input:
      '这是合成测试，无工具可用。PPT生成器只返回文件路径presentation.pptx，尚未渲染，也没有图片。请用一句话交付，不能遗漏检查状态。',
  },
  {
    id: 'unknown-empty',
    input:
      '这是合成测试，无工具可用。医务室查询返回空数组，但没有查询覆盖范围、更新时间或完整性说明。负责人问“现在是不是没人，可以关门了？”请简短回答。',
  },
];

for (const model of config.models) {
  const selected = { provider: 'deepseek', model: model.id, reasoningEffort: 'high' };
  for (const [variant, system] of [
    ['baseline', baseline],
    ['candidate', candidate],
  ]) {
    await writeFile(`${out}/${variant}-system.txt`, system);
    for (const test of tests) {
      const started = Date.now();
      const outputs = [];
      let usage = null;
      let finish = null;
      let error = null;
      try {
        for await (const event of adapter.stream({
          model: selected.model,
          reasoningEffort: selected.reasoningEffort,
          system,
          messages: [{ role: 'user', content: [{ type: 'text', text: test.input }] }],
          maxTokens: 1800,
          signal: AbortSignal.timeout(60000),
        })) {
          if (event.type === 'block-end' && event.block.type === 'text') outputs.push(event.block.text);
          if (event.type === 'usage') usage = event.usage;
          if (event.type === 'finish') finish = event.reason;
        }
      } catch (e) {
        error = { code: e.code ?? e.name };
      }
      const result = {
        scope: 'system-fragment policy probe; no tools executed',
        variant,
        testId: test.id,
        provider: selected.provider,
        model: selected.model,
        reasoningEffort: selected.reasoningEffort,
        systemSha256: createHash('sha256').update(system).digest('hex'),
        input: test.input,
        output: outputs.join('\n'),
        usage,
        finish,
        error,
        latencyMs: Date.now() - started,
      };
      await writeFile(`${out}/${selected.model}-${variant}-${test.id}.json`, JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      if (error || finish?.kind === 'error') process.exit(1);
    }
  }
}

const selected = { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high' };
const imagePath = `${root}/evals/work-quality/fixtures/water-cycle-overview.png`;
const data = await readFile(imagePath);
const ref = {
  attachmentId: 'synthetic-deck-overview',
  name: 'overview.png',
  mediaType: 'image/png',
  bytes: data.length,
  width: data.readUInt32BE(16),
  height: data.readUInt32BE(20),
};
const visionAdapter = new DeepSeekAdapter({
  options: () => connection,
  resolveApiKey: async () => apiKey,
  resolveUserId: () => 'mochi-synthetic-vision-evaluation',
  resolveFiles: () => ({
    ensureUploaded: async () => {
      throw new Error('Probe uses inline images only');
    },
  }),
  resolveAttachments: () => ({
    readImageRequest: async () => ({
      attachment: ref,
      variantId: 'synthetic-overview',
      data,
      mediaType: 'image/png',
      bytes: data.length,
      width: ref.width,
      height: ref.height,
      hasAlpha: false,
    }),
  }),
  prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
});
const input =
  '仅根据所附幻灯片缩略图，输出第1页标题、第3页的第二条要点、第5页标题。看不清就说看不清，不要猜，不要解释。';
const started = Date.now();
const outputs = [];
let usage = null;
let finish = null;
let error = null;
try {
  for await (const event of visionAdapter.stream({
    model: selected.model,
    reasoningEffort: selected.reasoningEffort,
    system: candidate,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: input },
          { type: 'image', attachment: ref },
        ],
      },
    ],
    maxTokens: 1500,
    signal: AbortSignal.timeout(60000),
  })) {
    if (event.type === 'block-end' && event.block.type === 'text') outputs.push(event.block.text);
    if (event.type === 'usage') usage = event.usage;
    if (event.type === 'finish') finish = event.reason;
  }
} catch (e) {
  error = { code: e.code ?? e.name };
}
const result = {
  scope: 'live endpoint image perception; not full Agent execution',
  provider: selected.provider,
  model: selected.model,
  reasoningEffort: selected.reasoningEffort,
  imageSha256: createHash('sha256').update(data).digest('hex'),
  input,
  output: outputs.join('\n'),
  usage,
  finish,
  error,
  latencyMs: Date.now() - started,
};
await writeFile(`${out}/deepseek-flash-vision-probe.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (error || finish?.kind === 'error') process.exitCode = 1;
