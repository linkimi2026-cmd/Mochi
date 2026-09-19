import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { createScope } from '@deepseek-ai/dsh-scope';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { apply as applyPersona } from '@deepseek-ai/dsh-persona';
import { apply as applyHello } from '../../../plugins/mochi-hello/index.mjs';
import { WORK_QUALITY_POLICY, WORK_QUALITY_SECTION } from '../../../plugins/mochi-hello/work-quality.mjs';

const require = createRequire(import.meta.url);
const { parse } = require('yaml');
const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const roles = [
  ...['lesson-planning', 'grade-analysis', 'materials-assessment', 'classroom-coordination']
    .map((name) => `client-plugins/teacher-agent-presets/${name}/agent.cordis.yml`),
  'apps/desktop/resources/mochi-web/classroom-agent-presets/classroom/agent.cordis.yml',
];

// Native platform tags are irrelevant to persona extraction, but are valid in DSH.
function personaFrom(path) {
  const rows = parse(read(path).replace(/!!js[^\n]*/g, 'false'));
  return rows.find((row) => row.id === 'persona')?.config;
}

function contextFor(t) {
  const ctx = new Context();
  new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: true, persona: 'default identity' });
  t.after(() => ctx.fiber.dispose());
  return ctx;
}

async function mountHello(ctx) {
  const fork = ctx.plugin(applyHello);
  return fork;
}

test('shared quality policy survives each real role persona without leaking roles', async (t) => {
  const ctx = contextFor(t);
  await mountHello(ctx);
  for (const path of roles) {
    const config = personaFrom(path);
    assert.ok(config?.text, path);
    assert.notEqual(config.complete, true, 'managed roles must preserve shared sections');
    const key = {};
    const scope = createScope(ctx, key);
    try {
      applyPersona(scope.ctx, config);
      const assembly = await ctx.systemPrompt.assemble({ scope: key });
      const quality = assembly.sections.filter((row) => row.name === WORK_QUALITY_SECTION);
      assert.equal(quality.length, 1, path);
      assert.equal(quality[0].text, WORK_QUALITY_POLICY);
      const text = renderPrompt(assembly);
      assert.ok(text.includes(config.text));
      assert.ok(!text.includes('default identity'), 'role should still shadow the global identity');
      const other = renderPrompt(await ctx.systemPrompt.assemble());
      assert.ok(other.includes('default identity'));
      assert.ok(!other.includes(config.text), 'role must not leak to other sessions');
    } finally {
      await scope.dispose();
    }
  }
});

test('quality contributor unloads and reloads without duplicate or stale sections', async (t) => {
  const ctx = contextFor(t);
  const first = await mountHello(ctx);
  assert.equal((await ctx.systemPrompt.assemble()).sections.filter((row) => row.name === WORK_QUALITY_SECTION).length, 1);
  await first.dispose();
  assert.equal((await ctx.systemPrompt.assemble()).sections.filter((row) => row.name === WORK_QUALITY_SECTION).length, 0);
  await mountHello(ctx);
  assert.equal((await ctx.systemPrompt.assemble()).sections.filter((row) => row.name === WORK_QUALITY_SECTION).length, 1);
});

test('policy resource is included in the plugin publication contract', () => {
  const pkg = JSON.parse(read('plugins/mochi-hello/package.json'));
  for (const file of ['work-quality.md', 'work-quality.mjs']) assert.ok(pkg.files.includes(file));
  assert.ok(WORK_QUALITY_POLICY.length > 0);
});


test('installed Harness provider discovers and loads all Mochi skills and local reference links', async (t) => {
  const ctx = contextFor(t);
  const control = new AbortController();
  const provider = new FileSystemSkillProvider(ctx, { signal: control.signal, invalidate() {} }, {
    includeDefaultRoots: false,
    customSkillDirs: [fileURLToPath(new URL('skills', root))],
    watch: false,
  });
  t.after(() => provider.dispose());
  const observation = await provider.list({ cwd: fileURLToPath(root) });
  assert.ok(Array.isArray(observation), 'skill catalog must be complete');

  // 期望值从磁盘推导，不写死数字：写死过一次 8，新增 classroom-verdict 后整轮 check 变红。
  // 而且「目录存在但没有 SKILL.md」是真正的打包缺陷（文件缺失但被静默跳过），
  // 硬编码长度同样抓不到，所以这里按目录清单双向比对。
  const skillRoot = fileURLToPath(new URL('skills/', root));
  const described = readdirSync(skillRoot, { withFileTypes: true })
    .filter((row) => row.isDirectory())
    .map((row) => row.name)
    .sort();
  const missing = described.filter((name) => !existsSync(new URL(`${name}/SKILL.md`, new URL('skills/', root))));
  assert.deepEqual(missing, [], `skill directory without SKILL.md: ${missing.join(', ')}`);

  const discovered = observation.map((candidate) => candidate.name).sort();
  assert.deepEqual(discovered, described, 'provider must discover exactly the skills present on disk');

  for (const candidate of observation) {
    const skill = await provider.get(candidate, {});
    assert.ok(skill?.content, candidate.name);
    assert.equal(skill.name, candidate.name);
    assert.equal(skill.invocation.modelInvocable, true);
    for (const match of skill.content.matchAll(/\]\((references\/[^)]+)\)/g)) {
      assert.ok(existsSync(new URL(match[1], new URL(`skills/${skill.name}/`, root))), match[1]);
    }
  }
});
