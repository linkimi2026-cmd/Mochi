// Fixed-alpha Cordis lifecycle probe: the Connection route is optional, while
// the three read-only knowledge tools remain usable without that host service.
// Usage: node verify-alpha-optional-connection.mjs --consumer <alpha consumer root>
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing ${name}`);
  return value;
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

const consumer = argument('--consumer');
const fixture = await mkdtemp(join(tmpdir(), 'mochi-knowledge-alpha-connection-'));
const previousDshHome = process.env.DSH_HOME;
let ctx;
try {
  await Promise.all([
    copyFile(new URL('../index.mjs', import.meta.url), join(fixture, 'index.mjs')),
    copyFile(new URL('../knowledge-store.mjs', import.meta.url), join(fixture, 'knowledge-store.mjs')),
    copyFile(new URL('../knowledge-host-bridge.mjs', import.meta.url), join(fixture, 'knowledge-host-bridge.mjs')),
    copyFile(new URL('../knowledge-page-image.mjs', import.meta.url), join(fixture, 'knowledge-page-image.mjs')),
  ]);
  const nodeModules = join(fixture, 'node_modules');
  await mkdir(nodeModules);
  await symlink(join(consumer, 'node_modules', '@deepseek-ai'), join(nodeModules, '@deepseek-ai'), 'dir');

  const packageEntry = (name) => pathToFileURL(join(consumer, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href;
  const [{ Context }, plugin] = await Promise.all([
    import(packageEntry('cordis')),
    import(`${pathToFileURL(join(fixture, 'index.mjs')).href}?alpha=${Date.now()}`),
  ]);

  process.env.DSH_HOME = join(fixture, 'dsh-home');
  const registered = new Map();
  const routes = [];
  ctx = new Context();
  ctx.provide('tools', { register: (tool) => registered.set(tool.name, tool) });

  const fiber = ctx.plugin({ inject: plugin.inject, apply: plugin.apply }, {});
  await fiber.await();
  assert.deepEqual([...registered.keys()].sort(), ['mochi_knowledge_page', 'mochi_knowledge_search'], 'no Connection must not block read-only tools');
  assert.equal(routes.length, 0, 'no Connection means no original-page route');
  const emptyResult = await registered.get('mochi_knowledge_search').execute({ query: '牛顿' });
  assert.equal(emptyResult.状态, '未导入教材库', 'Cordis config object must not be treated as a store override');

  ctx.provide('connection', {
    fetch: {
      register: (route) => {
        routes.push(route);
        return () => routes.splice(routes.indexOf(route), 1);
      },
    },
  });
  await waitFor(() => routes.length === 1, 'Connection injection did not register the original-page route');
  assert.equal(routes[0].path, '/api/mochi-knowledge/page');

  await ctx.fiber.dispose();
  ctx = undefined;
  assert.equal(routes.length, 0, 'Connection route disposer must run when the Cordis context stops');
  console.log(JSON.stringify({
    status: 'PASS',
    runtime: 'fixed-alpha Context',
    withoutConnectionTools: [...registered.keys()].sort(),
    routeAfterConnection: '/api/mochi-knowledge/page',
  }));
} finally {
  try { await ctx?.fiber.dispose(); } catch { /* fixture cleanup */ }
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  await rm(fixture, { recursive: true, force: true });
}
