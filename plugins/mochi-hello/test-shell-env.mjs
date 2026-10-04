import assert from 'node:assert/strict';
import test from 'node:test';

const originalRuntimeNode = process.env.MOCHI_RUNTIME_NODE;
const plugin = await import(`./index.mjs?test=${Date.now()}`);

function fixture() {
  const registrations = [];
  const sections = [];
  const routes = [];
  const injections = [];
  const disposals = [];
  const hooks = [];
  let injectedDisposer;
  const ctx = {
    logger: { info() {} },
    on(name, callback, options) {
      hooks.push({ name, callback, options });
      return () => disposals.push('web-prompt');
    },
    inject(dependencies, callback) {
      injections.push(dependencies);
      if (dependencies.length === 1 && dependencies[0] === 'systemPrompt') {
        callback({ systemPrompt: {
          getSectionOrder() { return 0; },
          section() { return () => {}; },
        } });
        return { kind: 'fixture-inject' };
      }
      if (dependencies.includes('connection')) {
        callback({
          connection: {
            fetch: {
              register(route) {
                routes.push(route);
                return () => disposals.push('diagnostic');
              },
            },
          },
          llm: {},
        });
        return { kind: 'fixture-inject' };
      }
      assert.deepEqual(dependencies, ['shellEnv', 'systemPrompt']);
      injectedDisposer = callback({
        shellEnv: {
          register(contributor) {
            registrations.push(contributor);
            return () => disposals.push('environment');
          },
        },
        systemPrompt: {
          getSectionOrder(name) {
            assert.equal(name, 'TOOL_BASH');
            return 1000;
          },
          section(section) {
            sections.push(section);
            return () => disposals.push('prompt');
          },
        },
      });
      return { kind: 'fixture-inject' };
    },
  };
  return {
    ctx,
    registrations,
    sections,
    routes,
    injections,
    disposals,
    hooks,
    disposeInjected() { injectedDisposer?.(); },
  };
}

test.after(() => {
  if (originalRuntimeNode === undefined) delete process.env.MOCHI_RUNTIME_NODE;
  else process.env.MOCHI_RUNTIME_NODE = originalRuntimeNode;
});

test('exports the managed Electron Node through shellEnv and explains the Playwright invocation', () => {
  process.env.MOCHI_RUNTIME_NODE = process.execPath;
  const { ctx, registrations, sections, routes, injections, disposals, hooks, disposeInjected } = fixture();
  plugin.apply(ctx);

  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].name, 'system-prompt/assemble');
  assert.equal(hooks[0].options.global, true);
  assert.deepEqual(injections, [['systemPrompt'], ['connection', 'llm'], ['shellEnv', 'systemPrompt']]);
  assert.equal(routes.length, 1, 'the pre-existing host diagnostic must still register');
  assert.equal(routes[0].path, '/api/mochi-doctor/check-model');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, 'mochi-managed-node');
  assert.deepEqual(Object.keys(registrations[0].variables), ['DSH_MOCHI_NODE']);
  assert.match(registrations[0].variables.DSH_MOCHI_NODE.description, /Playwright/);
  assert.deepEqual(registrations[0].resolve({}), { DSH_MOCHI_NODE: process.execPath });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'mochi:managed-node');
  assert.match(sections[0].text, /DSH_MOCHI_NODE/);
  assert.match(sections[0].text, /require\('playwright'\)/);
  assert.match(sections[0].text, /& \$env:DSH_MOCHI_NODE/);
  assert.match(sections[0].text, /approval/);
  disposeInjected();
  assert.deepEqual(disposals, ['prompt', 'environment']);
});

test('Web prompt keeps GUI guidance but removes startup-specific port before model assembly', async () => {
  process.env.MOCHI_RUNTIME_NODE = '/definitely/not/a/mochi-runtime-node';
  const { ctx, hooks } = fixture();
  plugin.apply(ctx);
  const assembly = (port) => ({
    sections: [
      { name: 'app:web-surface', text: `You are in the GUI at http://127.0.0.1:${port}. Starting another server does not update this GUI.` },
      { name: 'another', text: 'keep me' },
    ], contexts: [], tools: [], variables: {},
  });
  const first = await hooks[0].callback(assembly(50001), {}, async () => assembly(50001));
  const second = await hooks[0].callback(assembly(60002), {}, async () => assembly(60002));
  assert.deepEqual(first, second, 'two cold starts have the same model-visible first section');
  assert.match(first.sections[0].text, /DSH_WEB_URL/);
  assert.match(first.sections[0].text, /Starting another server does not update this GUI/);
  assert.doesNotMatch(first.sections[0].text, /127\.0\.0\.1:\d+/);
  assert.deepEqual(plugin.stableWebSurface({ sections: [{ name: 'app:web-surface', text: 'future source without a local URL' }] }), {
    sections: [{ name: 'app:web-surface', text: 'future source without a local URL' }],
  }, 'unknown future upstream prompt is left intact');
});

test('does not advertise an ambient or non-existent runtime executable', () => {
  process.env.MOCHI_RUNTIME_NODE = '/definitely/not/a/mochi-runtime-node';
  const { ctx, registrations, sections } = fixture();
  plugin.apply(ctx);
  assert.deepEqual(registrations, []);
  assert.deepEqual(sections, []);
});


test('tool guidance reflects only the current role-filtered tool surface', () => {
  const base = {sections:[],tools:[{name:'jxl_query'},{name:'sidebar_open'}]};
  const result = plugin.toolAwareness(base);
  assert.equal(result.tools, base.tools);
  assert.match(result.sections[0].text, /delivered=false/);
  assert.match(result.sections[0].text, /设置顶部/);
  const classroom = plugin.toolAwareness({sections:[],tools:[]});
  assert.doesNotMatch(classroom.sections[0].text, /sidebar_open|jxl_query/);
  assert.equal(plugin.toolAwareness(result).sections.length, 1);
});
