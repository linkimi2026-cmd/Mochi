// Fixed-alpha profile probe. It loads mochi-knowledge through the real dsh
// profile loader with a normal config object, then invokes knowledge_search
// against a fresh managed library. No model, Connection, or user DSH home is used.
// Usage: node verify-alpha-profile-empty-search.mjs --consumer <alpha consumer root>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing ${name}`);
  return value;
}

async function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = '';
    child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-20_000); });
    child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-20_000); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`fixed-alpha profile probe timed out\n${output}`));
    }, 20_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`fixed-alpha profile probe exited code=${String(code)} signal=${String(signal)}\n${output}`));
    });
  });
}

const consumer = argument('--consumer');
const fixture = await mkdtemp(join(tmpdir(), 'mochi-knowledge-alpha-profile-'));
try {
  const dshHome = join(fixture, 'dsh-home');
  const profile = join(dshHome, 'profiles', 'knowledge-probe');
  const nodeModules = join(profile, 'node_modules');
  const knowledgeRoot = join(nodeModules, 'mochi-knowledge');
  const probeRoot = join(nodeModules, 'knowledge-profile-probe');
  await Promise.all([
    mkdir(knowledgeRoot, { recursive: true }),
    mkdir(probeRoot, { recursive: true }),
  ]);
  await Promise.all([
    copyFile(new URL('../index.mjs', import.meta.url), join(knowledgeRoot, 'index.mjs')),
    copyFile(new URL('../knowledge-store.mjs', import.meta.url), join(knowledgeRoot, 'knowledge-store.mjs')),
    copyFile(new URL('../knowledge-host-bridge.mjs', import.meta.url), join(knowledgeRoot, 'knowledge-host-bridge.mjs')),
    copyFile(new URL('../knowledge-page-image.mjs', import.meta.url), join(knowledgeRoot, 'knowledge-page-image.mjs')),
    copyFile(new URL('../package.json', import.meta.url), join(knowledgeRoot, 'package.json')),
    symlink(join(consumer, 'node_modules', '@deepseek-ai'), join(nodeModules, '@deepseek-ai'), 'dir'),
  ]);
  await writeFile(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-mochi-knowledge-probe',
    private: true,
    dependencies: {
      'mochi-knowledge': 'file:./node_modules/mochi-knowledge',
      'knowledge-profile-probe': 'file:./node_modules/knowledge-profile-probe',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'startup' } },
  }, null, 2)}\n`);
  await writeFile(join(profile, 'cordis.patch.yml'), `- insert:\n    - id: mochi-knowledge\n      name: mochi-knowledge\n      config: {}\n    - id: knowledge-profile-probe\n      name: knowledge-profile-probe\n`);
  await writeFile(join(probeRoot, 'package.json'), '{"name":"knowledge-profile-probe","private":true,"type":"module","main":"index.mjs"}\n');
  await writeFile(join(probeRoot, 'index.mjs'), `
export const inject = ['tools'];
export function apply(ctx) {
  setTimeout(() => { void (async () => {
    try {
      const tool = ctx.tools.get('mochi_knowledge_search');
      if (tool === undefined) throw new Error('knowledge_search was not registered');
      const value = await tool.execute({ query: '牛顿' }, { signal: new AbortController().signal });
      if (value?.状态 !== '未导入教材库') throw new Error('knowledge_search did not use the managed empty store');
      console.log('MOCHI_KNOWLEDGE_PROFILE=' + JSON.stringify({ status: 'PASS', tools: ctx.tools.schemas().filter((entry) => entry.name.startsWith('mochi.knowledge_')).map((entry) => entry.name).sort(), emptyStore: value.状态 }));
      process.exit(0);
    } catch (error) {
      console.error('MOCHI_KNOWLEDGE_PROFILE_ERROR=' + String(error));
      process.exit(1);
    }
  })(); }, 200);
}
`);

  const output = await run(process.execPath, [join(consumer, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '--profile', 'knowledge-probe'], {
    cwd: profile,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: join(fixture, 'home'),
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const marker = output.split('\n').find((line) => line.startsWith('MOCHI_KNOWLEDGE_PROFILE='));
  assert.ok(marker, `profile did not emit probe result\n${output}`);
  const result = JSON.parse(marker.slice('MOCHI_KNOWLEDGE_PROFILE='.length));
  assert.deepEqual(result, {
    status: 'PASS',
    tools: ['mochi_knowledge_page', 'mochi_knowledge_page_image', 'mochi_knowledge_search'],
    emptyStore: '未导入教材库',
  });
  console.log(JSON.stringify({ status: 'PASS', runtime: 'fixed-alpha dsh profile loader', ...result }));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
