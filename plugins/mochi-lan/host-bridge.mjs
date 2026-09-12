/**
 * Authenticated local-control routes for mochi-lan.
 *
 * These routes are registered under Connection's existing authenticated
 * gateway. They are intentionally not model tools: the desktop UI shows the
 * exact identity or pairing object before it invokes one of these fixed
 * endpoints. A browser-supplied confirmation flag is neither accepted nor
 * treated as authority.
 */
import { MochiLanError } from './lan-service.mjs';

export const LAN_HOST_API_BASE = '/api/mochi-lan';
export const LAN_HOST_ROUTES = Object.freeze({
  state: `${LAN_HOST_API_BASE}/state`,
  discovery: `${LAN_HOST_API_BASE}/discovery`,
  events: `${LAN_HOST_API_BASE}/events`,
  identity: `${LAN_HOST_API_BASE}/identity`,
  pairProbe: `${LAN_HOST_API_BASE}/pair/probe`,
  pairRequest: `${LAN_HOST_API_BASE}/pair/request`,
  // [Mochi 2026-09-09] WO-6 一键信任路由：教师端一次受控调用完成「指纹复核+发起相识」。
  pairTrust: `${LAN_HOST_API_BASE}/pair/trust`,
  pairAccept: `${LAN_HOST_API_BASE}/pair/accept`,
  pairReject: `${LAN_HOST_API_BASE}/pair/reject`,
  peerUnpair: `${LAN_HOST_API_BASE}/peer/unpair`,
  peerBlock: `${LAN_HOST_API_BASE}/peer/block`,
  messageSeen: `${LAN_HOST_API_BASE}/message-seen`,
});

const MAX_HOST_BODY_BYTES = 16 * 1024;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function invalid(message = '请求无效。') {
  throw new MochiLanError('INVALID_REQUEST', message, 400);
}

function plain(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactObject(value, allowed, required = []) {
  if (!plain(value)) invalid();
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) invalid();
  return value;
}

function copyIdentity(value) {
  // Role belongs to the independently launched host configuration. The
  // authenticated browser may edit the remaining identity labels but cannot
  // turn a classroom process into a teacher process.
  exactObject(value, ['endpointId', 'schoolId', 'classId', 'displayName'], ['schoolId', 'displayName']);
  return {
    ...(value.endpointId === undefined ? {} : { endpointId: value.endpointId }),
    schoolId: value.schoolId,
    ...(value.classId === undefined ? {} : { classId: value.classId }),
    displayName: value.displayName,
  };
}

function copyAddress(value) {
  exactObject(value, ['host', 'port'], ['host', 'port']);
  return { host: value.host, port: value.port };
}

function copyCandidate(value) {
  exactObject(value, ['endpointId', 'role', 'schoolId', 'classId', 'displayName', 'fingerprint', 'publicKey'], ['endpointId', 'role', 'schoolId', 'displayName', 'fingerprint', 'publicKey']);
  return {
    endpointId: value.endpointId,
    role: value.role,
    schoolId: value.schoolId,
    ...(value.classId === undefined ? {} : { classId: value.classId }),
    displayName: value.displayName,
    fingerprint: value.fingerprint,
    publicKey: value.publicKey,
  };
}

async function body(request, allowed, required = []) {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') invalid('请求必须是 JSON。');
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_HOST_BODY_BYTES) invalid('请求过大。');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { invalid('请求 JSON 无效。'); }
  return exactObject(parsed, allowed, required);
}

function routeError(error) {
  if (error instanceof MochiLanError) return json({ code: error.code }, error.httpStatus);
  return json({ code: 'INTERNAL_ERROR' }, 500);
}

async function invoke(operation) {
  try {
    return await operation();
  } catch (error) {
    return routeError(error);
  }
}

function connectionAuthorization(lan, action) {
  // The opaque capability is created on the DSH side only. It is not encoded
  // in the HTTP body and is never returned to the browser.
  return lan.authorize(action, 'connection-direct');
}

/**
 * Register fixed, authenticated Connection routes. Connection owns browser
 * session validation before these handlers run; this module only validates
 * narrow JSON shapes and forwards explicit UI actions to the LAN service.
 */
export function installLanHostBridge(ctx, lan) {
  if (!ctx?.connection?.fetch?.register || !lan) throw new TypeError('mochi-lan requires the authenticated Connection fetch service.');
  const register = (path, methods, fetch) => ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch });
  const disposers = [
    register(LAN_HOST_ROUTES.state, ['GET'], (request) => invoke(async () => {
      if (request.method !== 'GET') return json({ code: 'NOT_FOUND' }, 404);
      return json(lan.snapshot());
    })),
    register(LAN_HOST_ROUTES.discovery, ['GET'], (request) => invoke(async () => {
      if (request.method !== 'GET') return json({ code: 'NOT_FOUND' }, 404);
      return json({ candidates: lan.listDiscovered() });
    })),
    register(LAN_HOST_ROUTES.events, ['GET'], (request) => invoke(async () => {
      if (request.method !== 'GET') return json({ code: 'NOT_FOUND' }, 404);
      const url = new URL(request.url, 'http://mochi-lan.local');
      const rawCursor = url.searchParams.get('cursor');
      if (rawCursor !== null && !/^\d+$/u.test(rawCursor)) invalid('cursor 必须是非负整数。');
      return json(lan.eventsAfter(rawCursor === null ? 0 : Number(rawCursor)));
    })),
    register(LAN_HOST_ROUTES.identity, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['identity'], ['identity']);
      return json(await lan.configureIdentity(copyIdentity(input.identity), { authorization: connectionAuthorization(lan, 'configure-identity') }));
    })),
    register(LAN_HOST_ROUTES.pairProbe, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['address', 'expectedFingerprint'], ['address']);
      if (input.expectedFingerprint !== undefined && typeof input.expectedFingerprint !== 'string') invalid('expectedFingerprint 必须是文本。');
      return json(await lan.probeCandidate({ address: copyAddress(input.address), ...(input.expectedFingerprint === undefined ? {} : { expectedFingerprint: input.expectedFingerprint }), signal: request.signal }));
    })),
    register(LAN_HOST_ROUTES.pairRequest, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['candidate', 'address'], ['candidate', 'address']);
      return json(await lan.requestPairing({ candidate: copyCandidate(input.candidate), address: copyAddress(input.address), authorization: connectionAuthorization(lan, 'request-pairing'), signal: request.signal }));
    })),
    // [Mochi 2026-09-09] WO-6 一键信任：目标只取自动发现表中的 endpointId，
    // 地址与指纹由服务端从发现结果取得，浏览器无法指定任意 IP 或指纹。
    register(LAN_HOST_ROUTES.pairTrust, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['endpointId'], ['endpointId']);
      if (typeof input.endpointId !== 'string') invalid('endpointId 必须是文本。');
      return json(await lan.trustDiscovered({ endpointId: input.endpointId, authorization: connectionAuthorization(lan, 'trust-discovered'), signal: request.signal }));
    })),
    register(LAN_HOST_ROUTES.pairAccept, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['requestId'], ['requestId']);
      if (typeof input.requestId !== 'string') invalid('requestId 必须是文本。');
      return json(await lan.acceptPairing({ requestId: input.requestId, authorization: connectionAuthorization(lan, 'accept-pairing'), signal: request.signal }));
    })),
    register(LAN_HOST_ROUTES.pairReject, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['requestId'], ['requestId']);
      if (typeof input.requestId !== 'string') invalid('requestId 必须是文本。');
      return json(await lan.rejectPairing({ requestId: input.requestId, authorization: connectionAuthorization(lan, 'reject-pairing') }));
    })),
    register(LAN_HOST_ROUTES.peerBlock, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['endpointId'], ['endpointId']);
      if (typeof input.endpointId !== 'string') invalid('endpointId 必须是文本。');
      return json(await lan.blockPeer({ endpointId: input.endpointId, authorization: connectionAuthorization(lan, 'block-peer') }));
    })),
    register(LAN_HOST_ROUTES.peerUnpair, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['endpointId'], ['endpointId']);
      if (typeof input.endpointId !== 'string') invalid('endpointId 必须是文本。');
      return json(await lan.unpairPeer({ endpointId: input.endpointId, authorization: connectionAuthorization(lan, 'unpair-peer') }));
    })),
    // Connection's register API has exact paths. A fixed body field keeps
    // `messageId` out of a client-built dynamic route while preserving the
    // explicit classroom "已看到" action.
    register(LAN_HOST_ROUTES.messageSeen, ['POST'], (request) => invoke(async () => {
      if (request.method !== 'POST') return json({ code: 'NOT_FOUND' }, 404);
      const input = await body(request, ['messageId'], ['messageId']);
      if (typeof input.messageId !== 'string') invalid('messageId 必须是文本。');
      return json(await lan.markSeen({ messageId: input.messageId, authorization: connectionAuthorization(lan, 'mark-seen'), signal: request.signal }));
    })),
  ];
  return () => {
    for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose();
  };
}
