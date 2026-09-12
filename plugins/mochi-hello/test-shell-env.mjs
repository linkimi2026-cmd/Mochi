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
  let injectedDisposer;
  const ctx = {
    logger: { info() {} },
    inject(dependencies, callback) {
      injections.push(dependencies);
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
    disposeInjected() { injectedDisposer?.(); },
  };
}

test.after(() => {
  if (originalRuntimeNode === undefined) delete process.env.MOCHI_RUNTIME_NODE;
  else process.env.MOCHI_RUNTIME_NODE = originalRuntimeNode;
});

test('exports the managed Electron Node through shellEnv and explains the Playwright invocation', () => {
  process.env.MOCHI_RUNTIME_NODE = process.execPath;
  const { ctx, registrations, sections, routes, injections, disposals, disposeInjected } = fixture();
  plugin.apply(ctx);

  assert.deepEqual(injections, [['connection', 'llm'], ['shellEnv', 'systemPrompt']]);
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

test('does not advertise an ambient or non-existent runtime executable', () => {
  process.env.MOCHI_RUNTIME_NODE = '/definitely/not/a/mochi-runtime-node';
  const { ctx, registrations, sections } = fixture();
  plugin.apply(ctx);
  assert.deepEqual(registrations, []);
  assert.deepEqual(sections, []);
});
