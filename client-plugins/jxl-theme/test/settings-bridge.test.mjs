import assert from 'node:assert/strict';
import test from 'node:test';
import { bindThemeSettings } from '../scripts/settings-bridge.mjs';

test('old Harness keeps its namespace settings scope', () => {
  const scope = {};
  const ctx = { settingsScope: { bind(options) {
    assert.deepEqual(options, { namespace: 'jxl-theme' });
    return scope;
  } } };
  assert.equal(bindThemeSettings(ctx), scope);
});

test('new Harness shares accepted values and propagates declined writes', async () => {
  let snapshot = { status: 'ready', value: { petPalette: 'caramel' }, writable: true };
  const listeners = new Set();
  let accepted = true;
  const form = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async set(field, value) {
      if (!accepted) return false;
      snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } };
      for (const listener of listeners) listener();
      return true;
    },
  };
  const scope = bindThemeSettings(new Proxy({ configForms: { get(id) {
    assert.equal(id, 'jxl-theme');
    return form;
  } } }, { get(target, key) { if (!(key in target)) throw new Error('undeclared service'); return target[key]; } }), 'configForms');
  let changes = 0;
  const unsubscribe = scope.subscribe(() => changes++);
  await scope.set('petPalette', 'cream');
  assert.equal(scope.getSnapshot().value.petPalette, 'cream');
  assert.equal(changes, 1);
  accepted = false;
  await assert.rejects(scope.set('petPalette', 'peach'), /not saved/);
  assert.equal(scope.getSnapshot().value.petPalette, 'cream');
  unsubscribe();
  assert.equal(listeners.size, 0);
});

test('missing settings provider cannot pretend a save succeeded', () => {
  assert.throws(() => bindThemeSettings({ configForms: { get: () => undefined } }, 'configForms'), /unavailable/);
});
