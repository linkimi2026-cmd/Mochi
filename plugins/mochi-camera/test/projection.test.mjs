import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMERA_TOOL, createCameraProjection, foldCameraEvent } from '../projection.mjs';

test('only a successfully settled camera tool produces a session preview request', () => {
  const initial = createCameraProjection().init();
  const called = foldCameraEvent(initial, { type: 'tool/call', data: { name: CAMERA_TOOL, callId: 'camera-call' } });
  const result = { type: 'tool/result', data: { message: {
    toolCallId: 'camera-call', role: 'tool', content: [{ type: 'text', text: JSON.stringify({ kind: 'camera-preview-request', requestId: 'camera-call', requestedAt: 100 }) }],
  } } };
  assert.deepEqual(foldCameraEvent(called, result), { pendingCallId: null, request: { requestId: 'camera-call', requestedAt: 100 } });
  assert.equal(foldCameraEvent(initial, result), initial);
  assert.equal(foldCameraEvent(called, { ...result, data: { message: { ...result.data.message, toolCallId: 'another-call' } } }), called);
});

test('failed tool, unrelated messages and malformed result cannot open hardware', () => {
  const initial = createCameraProjection().init();
  assert.equal(foldCameraEvent(initial, { type: 'user/message', data: { text: 'camera' } }), initial);
  assert.equal(foldCameraEvent(initial, { type: 'tool/call', data: { name: 'other', callId: 'other' } }), initial);
  const called = foldCameraEvent(initial, { type: 'tool/call', data: { name: CAMERA_TOOL, callId: 'c' } });
  for (const message of [
    { toolCallId: 'c', isError: true },
    { toolCallId: 'c', content: [{ type: 'text', text: 'unparseable' }] },
    { toolCallId: 'c', content: [{ type: 'text', text: '{"kind":"other"}' }] },
  ]) assert.deepEqual(foldCameraEvent(called, { type: 'tool/result', data: { message } }), initial);
});

test('projection wire carries finite requests and rejects invalid data', () => {
  const projection = createCameraProjection();
  assert.deepEqual(projection.wire.view(projection.init()), { request: null });
  assert.throws(() => projection.stateSchema.parse({ request: { requestId: 'c', requestedAt: NaN } }));
  assert.throws(() => projection.wire.viewSchema.parse({ request: { requestId: 3, requestedAt: 100 } }));
});
