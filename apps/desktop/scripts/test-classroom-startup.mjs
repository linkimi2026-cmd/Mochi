import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { createClassroomStartup } = require('../dist-electron/dsh/classroom-startup.js');

test('classroom registers once, checks the exact Windows entry, and respects OS disable', () => {
  const dataPath = mkdtempSync(join(tmpdir(), 'mochi-startup-'));
  try {
    let state = { openAtLogin: false, launchItems: [] };
    const writes = [];
    const app = {
      getLoginItemSettings(query) { assert.deepEqual(query.args, ['--role=classroom', '--mochi-classroom-startup']); return state; },
      setLoginItemSettings(value) {
        writes.push(value);
        state = { openAtLogin: value.openAtLogin, launchItems: [{ ...value }] };
      },
    };
    const manager = createClassroomStartup(app, { platform: 'win32', packaged: true, dataPath, executable: 'C:\\Mochi\\Mochi.exe' });
    assert.equal(manager.initialize().enabled, true);
    assert.equal(writes.length, 1);
    state.launchItems[0].enabled = false;
    assert.equal(manager.initialize().enabled, false);
    assert.equal(writes.length, 1, 'does not undo a system settings choice');
    state.launchItems.push({ name: 'Other', args: [], enabled: true });
    assert.equal(manager.get().enabled, false, 'another entry cannot claim classroom is enabled');
    assert.equal(manager.set(true).enabled, true);
    assert.equal(manager.set(false).enabled, false);
  } finally { rmSync(dataPath, { recursive: true, force: true }); }
});

test('development never changes login items and macOS pending approval stays visible', () => {
  const dataPath = mkdtempSync(join(tmpdir(), 'mochi-startup-'));
  try {
    const app = {
      getLoginItemSettings: () => ({ openAtLogin: false, status: 'requires-approval' }),
      setLoginItemSettings(value) { assert.deepEqual(value, { openAtLogin: true }); },
    };
    const options = { platform: 'darwin', packaged: false, dataPath, executable: '/Applications/Mochi.app' };
    assert.equal(createClassroomStartup({}, options).initialize().supported, false);
    const state = createClassroomStartup(app, { ...options, packaged: true }).initialize();
    assert.deepEqual(state, { supported: true, enabled: false, needsApproval: true });
  } finally { rmSync(dataPath, { recursive: true, force: true }); }
});
