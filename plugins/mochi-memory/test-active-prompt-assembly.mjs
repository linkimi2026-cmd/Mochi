// 固定 alpha 公共 SystemPrompt 的无模型 assembly 探针。
// 运行时显式传 MOCHI_ACTIVE_PROMPT_CONSUMER=<已验 consumer 根>；不下载、不请求模型。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installActiveMemoryPrompt } from './active-context.mjs';
import { createStore, openStore } from './mem-store.mjs';
import { openWorldState } from './world-state.mjs';

const consumerRoot = process.env.MOCHI_ACTIVE_PROMPT_CONSUMER;
if (!consumerRoot) {
  throw new Error('需要 MOCHI_ACTIVE_PROMPT_CONSUMER 指向已验证的 alpha consumer 根目录。');
}

const packageEntry = (packagePath) => pathToFileURL(join(consumerRoot, 'node_modules', packagePath)).href;
const { Context } = await import(packageEntry('@deepseek-ai/cordis/lib/index.js'));
const { SystemPrompt, renderContextSnapshot } = await import(packageEntry('@deepseek-ai/dsh-system-prompt/lib/index.js'));

function makeSession(text) {
  return {
    snapshotEvents() {
      return [{
        type: 'user/message',
        data: {
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text }],
        },
      }];
    },
  };
}

const root = mkdtempSync(join(tmpdir(), 'mochi-active-prompt-assembly-'));
const ctx = new Context();
try {
  const store = createStore(openStore(join(root, 'memory', 'mochi-memories.sqlite')));
  const world = openWorldState(join(root, 'memory'));
  const preference = store.note({
    kind: 'preference',
    content: '课件默认采用分栏结构',
    summary: '课件分栏结构',
    pinned: true,
    source: 'explicit_request',
  });

  new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: true, persona: '' });
  installActiveMemoryPrompt(ctx, store, world);
  const session = makeSession('请继续制作课件');

  const beforeForget = await ctx.systemPrompt.assemble({ agent: { session } });
  const beforeSnapshot = renderContextSnapshot(beforeForget);
  assert.ok(beforeForget.contexts.some((entry) => entry.name === 'mochi:active-memory'), '真实 assembly 注册动态上下文');
  assert.match(beforeSnapshot, /课件分栏结构/u, '真实 user-role snapshot 含已确认偏好');
  assert.match(beforeSnapshot, /Current runtime context\./u, '固定 alpha 将 context 渲染为运行时快照');

  store.forget(preference.id);
  const afterForget = await ctx.systemPrompt.assemble({ agent: { session } });
  const afterSnapshot = renderContextSnapshot(afterForget);
  assert.doesNotMatch(afterSnapshot, /课件分栏结构/u, 'forget 后新 assembly 不再携带旧偏好');
  assert.equal(afterSnapshot, '', '没有其他动态资料时最终快照为空');

  console.log('active prompt assembly probe passed: fixed alpha SystemPrompt renders and removes the dynamic user-role snapshot.');
} finally {
  await ctx.fiber.dispose();
  rmSync(root, { recursive: true, force: true });
}
