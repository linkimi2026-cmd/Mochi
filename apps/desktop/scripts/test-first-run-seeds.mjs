import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { Context } from '@deepseek-ai/cordis';
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { renderSettingsDefaults } = require('./seed-packaging-keys.cjs');
const source = readFileSync(new URL('../electron/dsh/seed.ts', import.meta.url), 'utf8');
const module = { exports: {} };
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(compiled, {
  module, exports: module.exports, console,
  process: { env: { MOCHI_DESKTOP_SMOKE: '1' }, pid: process.pid },
  require: name => name === 'electron' ? { Notification: { isSupported: () => false } } : require(name),
});
const { seedRuntimeHome } = module.exports;
const root = mkdtempSync(join(tmpdir(), 'mochi-first-run-seeds-'));
const refs = { MIMO_API_KEY: 'fixture-mimo-factory', MOCHI_AIAAA_API_KEY: 'fixture-aiaaa-factory' };
const inherited = Object.fromEntries(Object.keys(refs).map(key => [key, process.env[key]]));
try {
  for (const key of Object.keys(refs)) delete process.env[key];
  const resourceRoot = join(root, 'resources');
  mkdirSync(join(resourceRoot, 'seeds'), { recursive: true });
  writeFileSync(join(resourceRoot, 'seeds/credentials-seed.json'), JSON.stringify({ schemaVersion: 1, refs }));
  writeFileSync(join(resourceRoot, 'seeds/settings-defaults.json'), JSON.stringify(renderSettingsDefaults()));
  for (const role of ['teacher', 'classroom']) {
    const homeDir = join(root, role);
    const first = seedRuntimeHome({ homeDir, resourceRoot, role });
    assert.equal(first.status, 'seeded');
    assert.equal(first.credentialRefsInserted.length, role === 'teacher' ? 2 : 1);
    const file = join(homeDir, '.credentials.yaml');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(existsSync(join(homeDir, 'settings.yaml')), role === 'teacher');
    const provider = new LocalCredentialProvider(new Context(), { dshHome: homeDir, watch: false });
    await provider.loadInitial();
    assert.equal((await provider.resolve('MIMO_API_KEY')).value, refs.MIMO_API_KEY);
    if (role === 'teacher') assert.equal((await provider.resolve('MOCHI_AIAAA_API_KEY')).value, refs.MOCHI_AIAAA_API_KEY);
    else assert.equal(readFileSync(file, 'utf8').includes('MOCHI_AIAAA_API_KEY'), false);
    await provider.set('MIMO_API_KEY', 'fixture-user-updated');
    const before = readFileSync(file, 'utf8');
    const second = seedRuntimeHome({ homeDir, resourceRoot, role });
    assert.equal(second.credentialRefsInserted.length, 0);
    assert.equal(readFileSync(file, 'utf8'), before, 'upgrade must preserve the user credential');
    assert.equal((await provider.resolve('MIMO_API_KEY')).value, 'fixture-user-updated');
    if (role === 'teacher') {
      const profileDir = join(homeDir, 'profiles/mochi-web');
      mkdirSync(profileDir, { recursive: true });
      const imported = join(homeDir, 'settings.yaml.imported');
      writeFileSync(imported, readFileSync(join(homeDir, 'settings.yaml')));
      rmSync(join(homeDir, 'settings.yaml'));
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-experimental-voice-input-bundle'] } } }));
      const patch = '- id: agent-default-model\n  config: {provider: user-route, model: user-model}\n';
      writeFileSync(join(profileDir, 'cordis.patch.yml'), patch);
      assert.equal(seedRuntimeHome({ homeDir, resourceRoot, role }).settingsAction, 'kept');
      assert.equal(existsSync(join(homeDir, 'settings.yaml')), false);
      assert.equal(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'), patch);
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
      assert.equal(seedRuntimeHome({ homeDir, resourceRoot, role }).settingsAction, 'written', 'the old kernel retains its seed behavior');
    }
  }
  console.log('PASS: teacher/classroom fresh-home factory refs, actual DSH resolution, permissions, repeat launch and preserved user keys');
} finally {
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
}
