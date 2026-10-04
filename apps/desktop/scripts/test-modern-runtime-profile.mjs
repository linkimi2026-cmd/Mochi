#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const nodeModules = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the isolated 0.2 candidate node_modules directory');
const repo = resolve(import.meta.dirname, '../../..');
const resources = join(repo, 'apps/desktop/resources/mochi-web');
const require = createRequire(import.meta.url);
const runtime = require(join(resources, 'runtime-profile.cjs'));
const candidateRequire = createRequire(join(nodeModules, '@deepseek-ai/dsh/package.json'));
const yaml = candidateRequire('js-yaml');
const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => value })]);
const root = mkdtempSync(join(tmpdir(), 'mochi-modern-profile-'));
try {
  for (const role of ['teacher', 'classroom']) {
    const homeDir = join(root, role);
    const options = { homeDir, resourceRoot: resources, skillsDir: join(repo, 'skills'), workspaceRoot: repo, runtimeNodeModulesRoot: nodeModules, role };
    runtime.provisionMochiProfiles(options);
    assert.deepEqual(runtime.provisionMochiProfiles(options).updated, [], 'generation is idempotent');
    const patchPath = join(homeDir, 'profiles/mochi-web/cordis.patch.yml');
    writeFileSync(patchPath, readFileSync(patchPath, 'utf8') + '\n- id: jxl-theme\n  name: jxl-theme\n  config: {petPalette: cream}\n');
    runtime.provisionMochiProfiles(options);
    assert.deepEqual(runtime.provisionMochiProfiles(options).updated, [], 'settings patch survives repeated provision');
    const result = spawnSync(process.execPath, [join(nodeModules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'mochi-web', '--dump-config'], { env: { ...process.env, DSH_HOME: homeDir }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const rows = yaml.load(result.stdout, { schema });
    for (const id of ['speech-to-text', 'speech-to-text-sensevoice', 'api-speech-to-text', 'ui-voice-input']) assert.ok(rows.some(row => row.id === id && !row.disabled), id);
    const pi = rows.find(row => row.id === 'llm-pi-ai');
    assert.equal(pi.config.providers['mochi-mimo'].api, 'openai-completions');
    assert.equal(rows.find(row => row.id === 'mochi-llm-mimo').disabled, true);
    assert.ok(rows.some(row => row.id === 'mochi-mimo-empty-reply-guard' && row.name === 'mochi-llm-mimo/empty-reply-guard' && !row.disabled));
    const registry = rows.find(row => row.id === 'agent-preset-registry');
    assert.equal(rows.find(row => row.id === 'ui-settings-models').config.credentialOnboarding, false);
    assert.equal(rows.find(row => row.id === 'jxl-theme').config.petPalette, 'cream');
    assert.equal(rows.find(row => row.id === 'mochi-memory').config.role, role);
    assert.ok(rows.some(row => row.name === '@deepseek-ai/dsh-schedule' && !row.disabled));
    assert.equal(registry.config.default, role === 'teacher' ? 'standard' : 'classroom');
    assert.equal(rows.some(row => row.id === 'agent-presets'), false);
    const active = rows.filter(row => row.name === '@deepseek-ai/dsh-agent-preset' && !row.disabled);
    for (const id of ['mochi-camera', 'mochi-camera-client', 'mochi-user-profile', 'mochi-onboarding', 'mochi-memory', 'mochi-memory-client', 'mochi-voice-chat']) assert.ok(rows.some(row => row.id === id && !row.disabled), id);
    assert.equal(rows.some(row => row.id === 'agent-team' && !row.disabled), role === 'teacher');
    assert.equal(rows.some(row => row.id === 'mochi-classroom-assistant' && !row.disabled), role === 'classroom');
    assert.equal(rows.some(row => row.id === 'mochi-classroom-planner' && !row.disabled), role === 'classroom');
    if (role === 'classroom') assert.equal(rows.find(row => row.id === 'mochi-classroom-planner').config.dataRoot, join(homeDir, 'mochi-classroom-planner'));
    for (const preset of active.filter(row => row.id.startsWith('mochi-preset-'))) {
      const persona = preset.config.plugins.find(row => row.name === '@deepseek-ai/dsh-persona');
      assert.equal(typeof persona.config.prefix, 'string');
      assert.equal(Object.hasOwn(persona.config, 'text'), false);
    }
    const ids = active.map(row => row.config.id).sort();
    if (role === 'classroom') {
      assert.deepEqual(ids, ['classroom']);
      const text = JSON.stringify(active[0].config.plugins);
      assert.doesNotMatch(text, /dsh-tool-bash|dsh-tool-pwsh|dsh-tool-fs"/);
      assert.match(text, /mochi_lan/);
    } else {
      for (const id of ['lesson-planning', 'materials-assessment', 'grade-analysis', 'classroom-coordination', 'standard', 'minimal', 'ptc', 'cordis']) assert.ok(ids.includes(id), id);
      mkdirSync(join(homeDir, '.agent-presets'));
      writeFileSync(join(homeDir, '.agent-presets', 'existing.yml'), 'private preset');
      const patch = join(homeDir, 'profiles/mochi-web/cordis.patch.yml');
      const before = readFileSync(patch, 'utf8');
      assert.throws(() => runtime.provisionMochiProfiles(options), /迁移自定义/);
      assert.equal(readFileSync(patch, 'utf8'), before, 'unsupported custom preset does not partially rewrite profile');
    }
  }
  console.log('PASS: real 0.2 composition; teacher presets and history IDs preserved; classroom only; idempotence; custom-preset guard');
} finally { rmSync(root, { recursive: true, force: true }); }
