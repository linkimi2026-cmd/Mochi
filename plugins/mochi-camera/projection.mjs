export const CAMERA_TOOL = 'mochi_open_camera';
export const CAMERA_PROJECTION = 'mochiCamera';

export function foldCameraEvent(state, event) {
  if (event.type === 'tool/call' && event.data?.name === CAMERA_TOOL) {
    return { ...state, pendingCallId: event.data.callId };
  }
  if (event.type !== 'tool/result' || !state.pendingCallId) return state;
  const message = event.data?.message;
  if (message?.toolCallId !== state.pendingCallId) return state;
  if (message.isError) return { ...state, pendingCallId: null };
  try {
    const text = message.content?.find((block) => block.type === 'text')?.text;
    const value = JSON.parse(text);
    if (value.kind !== 'camera-preview-request' || typeof value.requestId !== 'string'
      || !Number.isFinite(value.requestedAt)) return { ...state, pendingCallId: null };
    return {
      pendingCallId: null,
      request: { requestId: value.requestId, requestedAt: value.requestedAt },
    };
  } catch {
    return { ...state, pendingCallId: null };
  }
}

const schema = {
  parse(value) {
    if (!value || typeof value !== 'object') throw new TypeError('Invalid camera projection');
    const request = value.request;
    if (request !== null && (!request || typeof request.requestId !== 'string'
      || !Number.isFinite(request.requestedAt))) throw new TypeError('Invalid camera request');
    return value;
  },
};

export function createCameraProjection() {
  return {
    key: CAMERA_PROJECTION,
    stateVersion: 1,
    stateSchema: schema,
    init: () => ({ pendingCallId: null, request: null }),
    apply: foldCameraEvent,
    wire: { viewSchema: schema, view: (state) => ({ request: state.request }) },
  };
}
