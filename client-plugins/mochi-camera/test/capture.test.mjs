import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

let api;
vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
  Error, Promise, Date,
  window: { __ModuleLoader__: { load: ({ factory }) => { api = factory(() => ({})).__test; } } },
});
function stream(id) {
  const listeners = new Map();
  const track = { stopped: 0, stop() { this.stopped++; }, addEventListener(name, fn) { listeners.set(name, fn); } };
  return { id, track, listeners, getTracks: () => [track], getVideoTracks: () => [track] };
}

test('video-only capture chooses the exact selected device and stops on cancel', async () => {
  const camera = stream('document-camera');
  let request;
  let displayed;
  const capture = api.createCapture({ async getUserMedia(value) { request = value; return camera; } }, value => { displayed = value; }, () => {});
  assert.equal(await capture.start('device-2'), camera);
  assert.equal(request.audio, false);
  assert.equal(request.video.deviceId.exact, 'device-2');
  assert.equal(displayed, camera);
  capture.stop();
  assert.equal(camera.track.stopped, 1);
  assert.equal(displayed, null);
});

test('cancelled pending system permission cannot leak a late camera stream', async () => {
  let resolve;
  const camera = stream('late');
  const capture = api.createCapture({ getUserMedia: () => new Promise(done => { resolve = done; }) }, () => {}, () => {});
  const pending = capture.start();
  capture.stop();
  resolve(camera);
  assert.equal(await pending, null);
  assert.equal(camera.track.stopped, 1);
});

test('device switch releases old camera and ignores stale concurrent opens', async () => {
  const cameras = [stream('old'), stream('stale'), stream('selected')];
  const waiting = [];
  let calls = 0;
  const capture = api.createCapture({ getUserMedia: () => calls++ === 0 ? Promise.resolve(cameras[0]) : new Promise(resolve => waiting.push(resolve)) }, () => {}, () => {});
  await capture.start('first');
  const stale = capture.start('second');
  assert.equal(cameras[0].track.stopped, 1);
  const selected = capture.start('third');
  waiting[1](cameras[2]);
  assert.equal(await selected, cameras[2]);
  waiting[0](cameras[1]);
  assert.equal(await stale, null);
  assert.equal(cameras[1].track.stopped, 1);
  capture.stop();
  assert.equal(cameras[2].track.stopped, 1);
});

test('device removal releases capture and reports loss exactly once', async () => {
  const camera = stream('removed');
  let ended = 0;
  const capture = api.createCapture({ getUserMedia: async () => camera }, () => {}, () => ended++);
  await capture.start();
  camera.listeners.get('ended')();
  camera.listeners.get('ended')();
  assert.equal(camera.track.stopped, 1);
  assert.equal(ended, 1);
});

test('draft intake uses the official service and never submits the prompt', () => {
  const file = { type: 'image/jpeg' };
  let created;
  let added;
  api.addPhoto({
    createDrafts(sessionId, files) { created = { sessionId, files }; return [{ id: 'photo-1' }]; },
    releaseDraftAttachments() { assert.fail('accepted photo was released'); },
  }, { addAttachments(ids) { added = ids; return true; }, submit() { assert.fail('photo must not auto-submit'); } }, 'session-1', file);
  assert.equal(created.sessionId, 'session-1');
  assert.equal(created.files[0], file);
  assert.equal(added[0], 'photo-1');
});

test('busy or failed draft admission releases browser attachments', () => {
  for (const mode of ['false', 'throw']) {
    let released = 0;
    const drafts = [{ id: 'temporary-photo' }];
    assert.throws(() => api.addPhoto({ createDrafts: () => drafts, releaseDraftAttachments(value) { assert.equal(value, drafts); released++; } }, {
      addAttachments() { if (mode === 'throw') throw Error('unavailable'); return false; },
    }, 'session-1', {}));
    assert.equal(released, 1);
  }
});

test('photo preserves aspect ratio and limits large camera dimensions', async () => {
  let drawn;
  const blob = { size: 1000 };
  const canvas = { getContext: () => ({ drawImage(...args) { drawn = args; } }), toBlob(done, type, quality) { assert.equal(type, 'image/jpeg'); assert.equal(quality, 0.92); done(blob); } };
  const result = await api.photograph({ videoWidth: 4800, videoHeight: 3200, readyState: 4 }, () => canvas);
  assert.equal(result, blob);
  assert.equal(canvas.width, 2400);
  assert.equal(canvas.height, 1600);
  assert.equal(drawn[3], 2400);
});

test('photo refuses empty and undecodable frames', async () => {
  await assert.rejects(api.photograph({ videoWidth: 0, videoHeight: 0, readyState: 0 }), /尚未就绪/);
  await assert.rejects(api.photograph({ videoWidth: 1200, videoHeight: 800, readyState: 4 }, () => ({ getContext: () => ({ drawImage() {} }), toBlob(done) { done(null); } })), /拍照失败/);
});
