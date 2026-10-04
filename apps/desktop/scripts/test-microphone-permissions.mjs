import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { installMicrophonePermissions } = require('../dist-electron/dsh/microphone-permissions.js');
function fixture() {
  let check, request, requests = 0, resolve, requestedKind;
  let url = 'http://127.0.0.1:19873/';
  const contents = { isDestroyed: () => false, getURL: () => url };
  installMicrophonePermissions({ setPermissionCheckHandler(fn) { check = fn; }, setPermissionRequestHandler(fn) { request = fn; } },
    () => contents, value => { try { return new URL(value).origin === 'http://127.0.0.1:19873'; } catch { return false; } },
    { granted: () => false, request: kind => { requestedKind = kind; requests++; return new Promise(done => { resolve = done; }); } });
  const details = { isMainFrame: true, requestingUrl: url, mediaTypes: ['audio'] };
  return { contents, check, request, details, count: () => requests, requestedKind: () => requestedKind, resolve: value => resolve(value), navigate: value => { url = value; } };
}
test('media rejects other windows, frames, origins, and combined requests before OS prompt', () => {
  const f = fixture();
  for (const [contents, details] of [[{}, f.details], [f.contents, { ...f.details, isMainFrame: false }], [f.contents, { ...f.details, requestingUrl: 'https://example.com' }], [f.contents, { ...f.details, mediaTypes: ['audio', 'video'] }]]) {
    let result;
    f.request(contents, 'media', value => { result = value; }, details);
    assert.equal(result, false);
  }
  assert.equal(f.count(), 0);
  assert.equal(f.check(f.contents, 'media', f.details.requestingUrl, { isMainFrame: true, mediaType: 'audio' }), false);
});
test('OS approval is rechecked against the live document before granting access', async () => {
  for (const mediaType of ['audio', 'video']) for (const changed of [false, true]) {
    const f = fixture();
    const result = new Promise(done => f.request(f.contents, 'media', done, { ...f.details, mediaTypes: [mediaType] }));
    if (changed) f.navigate('https://example.com');
    f.resolve(true);
    assert.equal(await result, !changed);
    assert.equal(f.count(), 1);
    assert.equal(f.requestedKind(), mediaType === 'audio' ? 'microphone' : 'camera');
  }
});
