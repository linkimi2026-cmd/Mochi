/**
 * Signed LAN transport for one teacher endpoint and one classroom endpoint.
 *
 * The LAN HTTP listener is intentionally separate from the DSH web host.  It
 * never accepts configuration, does not use a browser token, and only accepts
 * signed pairing/message envelopes from a manually paired peer.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, timingSafeEqual, verify } from 'node:crypto';
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isIP } from 'node:net';
import { hostname as osHostname } from 'node:os';

export const LAN_PROTOCOL_VERSION = 1;
export const DEFAULT_LAN_PORT = 47_832;
export const LAN_MULTICAST_HOST = '239.86.79.67';
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const LAN_STATE_FILENAME = 'mochi-lan/state.json';
// [Mochi 2026-09-09] WO-6 自动身份种子：部署事实的落点（数据根内文件与环境变量）。
export const LAN_IDENTITY_SEED_FILENAME = 'identity-seed.json';
export const LAN_IDENTITY_SEED_ENV = 'MOCHI_LAN_IDENTITY';
export const LAN_HTTP_PATHS = Object.freeze({
  health: '/health',
  identity: '/v1/identity',
  pairRequest: '/v1/pair/request',
  pairAccept: '/v1/pair/accept',
  message: '/v1/messages',
  receipt: '/v1/receipts',
  fileOffer: '/v1/files/offer',
  fileChunk: '/v1/files/chunk',
  fileCancel: '/v1/files/cancel',
});

const MAX_HTTP_BODY_BYTES = 96 * 1024;
const MAX_EVENTS = 128;
const MAX_DISCOVERED = 128;
const MAX_PAIRINGS = 64;
const MAX_PENDING_PAIRINGS = 64;
const MAX_MESSAGES = 1_000;
const MAX_FILES = 256;
const MAX_FILE_NAME_LENGTH = 160;
const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;
const DEFAULT_INBOX_QUOTA_BYTES = 300 * 1024 * 1024;
const FILE_CHUNK_BYTES = 64 * 1024;
const FILE_TRANSFER_TTL_MS = 60 * 60 * 1000;
const BEACON_INTERVAL_MS = 5_000;
const BEACON_TTL_MS = 15_000;
const PORT_ATTEMPTS = 16;
const INTERNAL_AUTHORIZATIONS = new WeakMap();
const FILE_TYPES = Object.freeze({
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
});

export const LAN_FILE_LIMITS = Object.freeze({
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
  inboxQuotaBytes: DEFAULT_INBOX_QUOTA_BYTES,
  chunkBytes: FILE_CHUNK_BYTES,
});

/**
 * [Mochi 2026-09-18] 消息方向表。
 *
 * 教师→教室是「通知」，教室→教师是「学生预约」。两个方向共用同一套签名信封、
 * 配对校验、投递回执与已看到回执，差别只在内容类型、谁有权发起、以及预约描述。
 * 因此这里是一张纯映射表，而不是两套并行代码——并行代码会在某个分支上漏掉
 * 一项签名或角色校验，那种漏洞从外面看不出来。
 *
 * 表按「本机角色视图」写：sends 是本机发得出去的类型，receives 是本机收得下的
 * 类型，peerRole 是唯一合法的对端角色。两行互为镜像，测试里有一条断言专门盯着
 * 这个镜像关系（teacher.sends 必须等于 classroom.receives），所以新增方向时不会
 * 只改一半。
 *
 * 关键点：配对是「一教师 ↔ 一教室设备」。学生不是端点，学生身份是预约描述里的
 * 自填字段，由学生在共用教室设备上输入。它因此**未经认证**，UI 必须按「学生自述」
 * 呈现，不能显示成已核实的在校身份。
 */
const MESSAGE_DIRECTIONS = Object.freeze({
  teacher: Object.freeze({ sends: 'NOTIFY', receives: 'REQUEST', peerRole: 'classroom' }),
  classroom: Object.freeze({ sends: 'REQUEST', receives: 'NOTIFY', peerRole: 'teacher' }),
});

/** 预约描述字段长度上限。教室端是共用设备，超长输入不该把教师端待办条撑坏。 */
const MAX_REQUEST_FIELD_LENGTH = 120;
const REQUEST_KINDS = Object.freeze(['appointment', 'question', 'makeup', 'other']);

/**
 * 每位学生那段「个性化交代」的长度上限。
 *
 * 这段文字由 Mochi 调 skill 逐人生成（该补什么、错在哪、下一步找谁），不是模板里
 * 拼出来的标签——所以它必须能跟着判决一起签名过网，教室端才有字可显示。上限压到
 * 200 是给教室常驻板留的：板上是一人一行，超过一行的长度学生就不看了。
 */
const MAX_VERDICT_NOTE_LENGTH = 200;

/**
 * 教师处置（喊人 / 过关 / 不过关）的动作表。
 *
 * 「过关或不过关是分老师的」：这条记录由**发起登记的那位教师**的身份签名，
 * 名册因此属于他而不是全校共享。同一台设备换一位老师登录，登记的是他自己的名单。
 */
const DIRECTIVE_ACTIONS = Object.freeze(['call', 'pass', 'fail', 'retry']);
/** 一次登记的人数上限。一个班 40 人上下，64 给了余量又挡住了无限负载。 */
const MAX_VERDICTS = 64;

/**
 * 教师处置描述：一次登记 = 一条消息，里面带一批 verdict。
 *
 * 为什么不「一个学生一条消息」：一个班 40 人就是 40 条签名消息 + 40 条回执，
 * 几分钟内就能把收件箱上限（1000 条）吃掉，而它们本该是一条记录。
 */
function directiveDescriptor(input) {
  if (!plain(input)) fail('INVALID_DIRECTIVE', '教师处置描述必须是对象。');
  if (Object.keys(input).some((key) => !['item', 'verdicts'].includes(key))) {
    fail('INVALID_DIRECTIVE', '教师处置描述含未知字段。');
  }
  const item = printable(input.item, '登记名目', MAX_REQUEST_FIELD_LENGTH, { required: false });
  if (!Array.isArray(input.verdicts) || input.verdicts.length === 0) {
    fail('INVALID_DIRECTIVE', '教师处置必须至少包含一位学生。');
  }
  if (input.verdicts.length > MAX_VERDICTS) {
    fail('INVALID_DIRECTIVE', `一次登记最多 ${MAX_VERDICTS} 位学生。`);
  }
  const verdicts = input.verdicts.map((raw) => {
    if (!plain(raw)) fail('INVALID_DIRECTIVE', '学生处置必须是对象。');
    if (Object.keys(raw).some((key) => !['student', 'seat', 'action', 'note'].includes(key))) {
      fail('INVALID_DIRECTIVE', '学生处置含未知字段。');
    }
    if (!DIRECTIVE_ACTIONS.includes(raw.action)) fail('INVALID_DIRECTIVE', '学生处置动作无效。');
    let seat;
    if (raw.seat !== undefined) {
      seat = Number(raw.seat);
      if (!Number.isSafeInteger(seat) || seat < 1 || seat > 999) fail('INVALID_DIRECTIVE', '座号必须是 1 到 999 的整数。');
    }
    // note 是「给这位学生看的那句话」，可以缺省（例如老师只喊人、不评价），但一旦
    // 给了就必须是干净文本：换行会让常驻板一行的布局错位，控制字符会污染日志。
    const note = printable(raw.note, '学生交代', MAX_VERDICT_NOTE_LENGTH, { required: false });
    return {
      student: printable(raw.student, '学生姓名', MAX_REQUEST_FIELD_LENGTH),
      action: raw.action,
      ...(seat === undefined ? {} : { seat }),
      ...(note === undefined ? {} : { note }),
    };
  });
  return { ...(item === undefined ? {} : { item }), verdicts };
}

/**
 * 学生预约描述。它随信封一起签名，所以发送方与接收方必须对同一份规范化结果
 * 做 messageId 冲突判定——否则同一 messageId 重发时会被误判为冲突。
 *
 * material / position 是「哪份作业的哪道题」这两个位置。没有它们的时候，学生只能
 * 把题目位置塞进 topic 或正文，老师那条待办条上就只剩一坨截断的字——老师没法提前
 * 翻到那一页，预约也就没起到预约的作用。两者都可选，所以旧的纯文字预约照旧合法。
 */
function requestDescriptor(input) {
  if (!plain(input)) fail('INVALID_REQUEST', '学生预约描述必须是对象。');
  if (Object.keys(input).some((key) => !['student', 'seat', 'kind', 'material', 'position', 'topic', 'slot'].includes(key))) {
    fail('INVALID_REQUEST', '学生预约描述含未知字段。');
  }
  const student = printable(input.student, '学生姓名', MAX_REQUEST_FIELD_LENGTH);
  const kind = input.kind === undefined ? 'other' : input.kind;
  if (!REQUEST_KINDS.includes(kind)) fail('INVALID_REQUEST', '预约类型无效。');
  const material = printable(input.material, '作业材料', MAX_REQUEST_FIELD_LENGTH, { required: false });
  const position = printable(input.position, '题目位置', MAX_REQUEST_FIELD_LENGTH, { required: false });
  const topic = printable(input.topic, '预约主题', MAX_REQUEST_FIELD_LENGTH, { required: false });
  const slot = printable(input.slot, '预约时间', MAX_REQUEST_FIELD_LENGTH, { required: false });
  let seat;
  if (input.seat !== undefined) {
    seat = Number(input.seat);
    if (!Number.isSafeInteger(seat) || seat < 1 || seat > 999) fail('INVALID_REQUEST', '座号必须是 1 到 999 的整数。');
  }
  return {
    student,
    kind,
    ...(seat === undefined ? {} : { seat }),
    ...(material === undefined ? {} : { material }),
    ...(position === undefined ? {} : { position }),
    ...(topic === undefined ? {} : { topic }),
    ...(slot === undefined ? {} : { slot }),
  };
}

export class MochiLanError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'MochiLanError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function fail(code, message, httpStatus = 400) {
  throw new MochiLanError(code, message, httpStatus);
}

// Dispatch must only mark a file task NOT_SENT when the service can prove that
// no LAN HTTP request has begun.  Remote protocol errors can use the same
// code as a local validation error, so keep the phase evidence on the actual
// error instance rather than asking a caller to infer it from `code`.
function markPreSendFailure(error) {
  if (error && typeof error === 'object') error.lanDeliveryPhase = 'pre-send';
  return error;
}

function plain(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function printable(value, label, maximum, { required = true } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') fail('INVALID_INPUT', `${label} 必须是文本。`);
  const normalized = value.normalize('NFC').trim();
  if ((!normalized && required) || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    fail('INVALID_INPUT', `${label} 无效。`);
  }
  return normalized;
}

function endpointId(value, label = 'endpointId') {
  const normalized = printable(value, label, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(normalized)) fail('INVALID_INPUT', `${label} 格式无效。`);
  return normalized;
}

function messageId(value) {
  const normalized = printable(value, 'messageId', 120);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(normalized)) fail('INVALID_INPUT', 'messageId 格式无效。');
  return normalized;
}

function fileId(value) {
  const normalized = printable(value, 'fileId', 120);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(normalized)) fail('INVALID_INPUT', 'fileId 格式无效。');
  return normalized;
}

function sha256(value, label = 'sha256') {
  const normalized = printable(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) fail('INVALID_INPUT', `${label} 格式无效。`);
  return normalized;
}

function safeHashEqual(left, right) {
  const expected = Buffer.from(sha256(left, 'sha256'), 'hex');
  const actual = Buffer.from(sha256(right, 'sha256'), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function fileTypeForName(value) {
  const filename = printable(value, '文件名', MAX_FILE_NAME_LENGTH);
  if (basename(filename) !== filename || filename === '.' || filename === '..') fail('INVALID_FILE_NAME', '文件名无效。');
  const extension = extname(filename).toLowerCase();
  const contentType = FILE_TYPES[extension];
  if (!contentType) fail('FILE_TYPE_FORBIDDEN', '仅支持 PPTX、DOCX、XLSX、PDF 和常见图片文件。', 415);
  return { filename, extension, contentType };
}

function fileMetadata(input) {
  if (!plain(input)) fail('INVALID_FILE_METADATA', '文件元数据无效。');
  const { filename, extension, contentType } = fileTypeForName(input.filename);
  if (input.contentType !== contentType) fail('FILE_TYPE_MISMATCH', '文件扩展名与内容类型不一致。', 415);
  const byteLength = Number(input.byteLength);
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > DEFAULT_MAX_FILE_BYTES) {
    fail('FILE_TOO_LARGE', '文件大小无效或超过 100MiB 默认上限。', 413);
  }
  const chunkBytes = Number(input.chunkBytes);
  const chunkCount = Number(input.chunkCount);
  if (chunkBytes !== FILE_CHUNK_BYTES || !Number.isSafeInteger(chunkCount)
    || chunkCount !== Math.ceil(byteLength / FILE_CHUNK_BYTES) || chunkCount < 1) {
    fail('INVALID_FILE_METADATA', '文件分块元数据无效。');
  }
  return { filename, extension, contentType, byteLength, sha256: sha256(input.sha256), chunkBytes, chunkCount };
}

function fileMetadataEqual(left, right) {
  return left.filename === right.filename
    && left.contentType === right.contentType
    && left.byteLength === right.byteLength
    && safeHashEqual(left.sha256, right.sha256)
    && left.chunkBytes === right.chunkBytes
    && left.chunkCount === right.chunkCount;
}

function messageAttachment(input) {
  if (!plain(input) || Object.keys(input).some((key) => !['fileId', 'filename', 'contentType', 'byteLength', 'sha256'].includes(key))) {
    fail('INVALID_FILE_REFERENCE', '消息文件引用无效。');
  }
  const { filename, contentType } = fileTypeForName(input.filename);
  if (input.contentType !== contentType) fail('FILE_TYPE_MISMATCH', '消息文件引用类型不一致。', 415);
  const byteLength = Number(input.byteLength);
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > DEFAULT_MAX_FILE_BYTES) fail('INVALID_FILE_REFERENCE', '消息文件引用大小无效。');
  return { fileId: fileId(input.fileId), filename, contentType, byteLength, sha256: sha256(input.sha256) };
}

function attachmentMatchesFile(attachment, row) {
  const metadata = row?.metadata;
  return row?.status === 'COMPLETED' && metadata
    && attachment.fileId === row.fileId
    && attachment.filename === metadata.filename
    && attachment.contentType === metadata.contentType
    && attachment.byteLength === metadata.byteLength
    && safeHashEqual(attachment.sha256, metadata.sha256);
}

function wireFileMetadata(metadata) {
  return {
    filename: metadata.filename,
    contentType: metadata.contentType,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    chunkBytes: metadata.chunkBytes,
    chunkCount: metadata.chunkCount,
  };
}

function pathInside(root, candidate) {
  const offset = relative(root, candidate);
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}

function decodedChunk(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) fail('INVALID_FILE_CHUNK', '文件分块编码无效。');
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.toString('base64url') !== value || bytes.length > FILE_CHUNK_BYTES) fail('INVALID_FILE_CHUNK', '文件分块大小无效。');
  return bytes;
}

function fileProjection(row, direction) {
  const metadata = row.metadata;
  if (!metadata) return null;
  return {
    fileId: row.fileId,
    direction,
    status: row.status,
    filename: metadata.filename,
    contentType: metadata.contentType,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    ...(row.peer ? { endpointId: row.peer.endpointId, schoolId: row.peer.schoolId, ...(row.peer.classId === undefined ? {} : { classId: row.peer.classId }) } : {}),
    ...(Number.isSafeInteger(row.receivedBytes) ? { receivedBytes: row.receivedBytes } : {}),
    ...(row.storedName ? { storedName: row.storedName } : {}),
    ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
  };
}

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('INVALID_ENVELOPE', '签名负载含无效数字。');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!plain(value)) fail('INVALID_ENVELOPE', '签名负载必须是普通 JSON 对象。');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function keyFingerprint(publicKey) {
  return `sha256:${createHash('sha256').update(canonical(publicKey)).digest('hex').slice(0, 32)}`;
}

function validateJwk(value, label = 'publicKey') {
  if (!plain(value)) fail('INVALID_ENVELOPE', `${label} 无效。`);
  try {
    const key = createPublicKey({ key: value, format: 'jwk' });
    if (key.asymmetricKeyType !== 'ed25519') fail('INVALID_ENVELOPE', `${label} 必须是 Ed25519。`);
  } catch (error) {
    if (error instanceof MochiLanError) throw error;
    fail('INVALID_ENVELOPE', `${label} 无效。`);
  }
  return clone(value);
}

function validatePrivateJwk(value, label = 'privateKey') {
  if (!plain(value)) fail('STATE_INVALID', `${label} 无效。`);
  try {
    const key = createPrivateKey({ key: value, format: 'jwk' });
    if (key.asymmetricKeyType !== 'ed25519') fail('STATE_INVALID', `${label} 必须是 Ed25519。`);
  } catch (error) {
    if (error instanceof MochiLanError) throw error;
    fail('STATE_INVALID', `${label} 无效。`);
  }
  return clone(value);
}

function matchingKeyPair(publicKey, privateKey) {
  const derived = createPublicKey({ key: privateKey, format: 'jwk' }).export({ format: 'jwk' });
  if (canonical(derived) !== canonical(publicKey)) fail('STATE_INVALID', 'LAN 本地公私钥不匹配。');
}

function identityProjection(identity) {
  if (!identity) return null;
  return {
    endpointId: identity.endpointId,
    role: identity.role,
    schoolId: identity.schoolId,
    ...(identity.classId === undefined ? {} : { classId: identity.classId }),
    displayName: identity.displayName,
    fingerprint: identity.fingerprint,
  };
}

function identityEqual(left, right) {
  return canonical(identityProjection(left)) === canonical(identityProjection(right));
}

/**
 * 签名负载里的「收件人三元组」。
 *
 * classId 对教室端必填、对教师端可选，所以构造时**没有就必须省略**，不能写成
 * `classId: undefined`：canonical() 递归遇到 undefined 会直接抛 INVALID_ENVELOPE
 * （它只认 null/字符串/布尔/数字/数组/普通对象），而不是像 JSON.stringify 那样
 * 悄悄丢掉。教师端之间的反向消息依赖这一点，所以这个约束只在这里集中实现一次。
 */
function recipientTuple(identity) {
  return {
    endpointId: identity.endpointId,
    schoolId: identity.schoolId,
    ...(identity.classId === undefined ? {} : { classId: identity.classId }),
  };
}

function validateIdentity(input, previous = null) {
  if (!plain(input)) fail('INVALID_INPUT', '设备身份必须是对象。');
  const role = input.role;
  if (role !== 'teacher' && role !== 'classroom') fail('INVALID_INPUT', 'role 必须是 teacher 或 classroom。');
  const schoolId = printable(input.schoolId, 'schoolId', 120);
  const classId = printable(input.classId, 'classId', 120, { required: false });
  if (role === 'classroom' && classId === undefined) fail('INVALID_INPUT', 'classroom 身份必须有 classId。');
  const displayName = printable(input.displayName, 'displayName', 80);
  const chosenEndpoint = input.endpointId === undefined
    ? previous?.endpointId ?? randomUUID()
    : endpointId(input.endpointId);
  let publicKey;
  let privateKey;
  if (previous) {
    publicKey = previous.publicKey;
    privateKey = previous.privateKey;
  } else {
    const pair = generateKeyPairSync('ed25519');
    publicKey = pair.publicKey.export({ format: 'jwk' });
    privateKey = pair.privateKey.export({ format: 'jwk' });
  }
  const validPublicKey = validateJwk(publicKey);
  const validPrivateKey = validatePrivateJwk(privateKey);
  matchingKeyPair(validPublicKey, validPrivateKey);
  return {
    endpointId: chosenEndpoint,
    role,
    schoolId,
    ...(classId === undefined ? {} : { classId }),
    displayName,
    publicKey: validPublicKey,
    privateKey: validPrivateKey,
    fingerprint: keyFingerprint(validPublicKey),
  };
}

function validateRemoteIdentity(input, publicKey) {
  if (!plain(input)) fail('INVALID_ENVELOPE', '远端身份无效。', 403);
  const role = input.role;
  if (role !== 'teacher' && role !== 'classroom') fail('INVALID_ENVELOPE', '远端 role 无效。', 403);
  const remote = {
    endpointId: endpointId(input.endpointId),
    role,
    schoolId: printable(input.schoolId, 'schoolId', 120),
    ...(input.classId === undefined ? {} : { classId: printable(input.classId, 'classId', 120) }),
    displayName: printable(input.displayName, 'displayName', 80),
    fingerprint: printable(input.fingerprint, 'fingerprint', 96),
  };
  if (remote.role === 'classroom' && remote.classId === undefined) fail('INVALID_ENVELOPE', '教室身份缺少 classId。', 403);
  if (remote.fingerprint !== keyFingerprint(publicKey)) fail('FINGERPRINT_MISMATCH', '远端公钥指纹不匹配。', 403);
  return remote;
}

function validateAddress(input) {
  if (!plain(input)) fail('INVALID_INPUT', '手动地址无效。');
  const host = printable(input.host, 'host', 128);
  if (isIP(host) === 0) fail('INVALID_INPUT', '手动地址必须是 IP 地址。');
  const port = Number(input.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail('INVALID_INPUT', '端口无效。');
  return { host, port };
}

// [Mochi 2026-09-09] WO-6 自动身份种子解析：只接受 schoolId/classId/displayName
// 三个部署事实；schoolId 是 SCHOOL_MISMATCH 的安全边界，种子缺失即拒绝自动上线。
function parseIdentitySeed(value, source) {
  if (!plain(value)) fail('IDENTITY_SEED_INVALID', `${source} 必须是 JSON 对象。`, 500);
  const unknown = Object.keys(value).filter((key) => !['schoolId', 'classId', 'displayName'].includes(key));
  if (unknown.length) fail('IDENTITY_SEED_INVALID', `${source} 含未知字段：${unknown.join('、')}。`, 500);
  if (value.schoolId === undefined) fail('IDENTITY_SEED_INVALID', `${source} 缺少 schoolId。`, 500);
  return {
    schoolId: printable(value.schoolId, `${source}.schoolId`, 120),
    ...(value.classId === undefined ? {} : { classId: printable(value.classId, `${source}.classId`, 120) }),
    ...(value.displayName === undefined ? {} : { displayName: printable(value.displayName, `${source}.displayName`, 80) }),
  };
}

function endpointUrl(address, pathname) {
  const host = isIP(address.host) === 6 ? `[${address.host}]` : address.host;
  return `http://${host}:${address.port}${pathname}`;
}

function discoveryErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/u.test(error.code)
    ? error.code
    : 'UDP_UNAVAILABLE';
}

function now() {
  return new Date().toISOString();
}

function blankState() {
  return {
    schema: 'mochi-lan-state/v1',
    identity: null,
    pairings: {},
    pendingIncoming: {},
    pendingOutgoing: {},
    blocked: {},
    inbox: {},
    outbox: {},
    receipts: {},
    incomingFiles: {},
    outgoingFiles: {},
  };
}

function boundedRows(values, maximum) {
  return values.sort((left, right) => String(right.updatedAt || right.receivedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.receivedAt || left.createdAt || ''))).slice(0, maximum);
}

function trimMap(map, maximum) {
  const rows = boundedRows(Object.values(map), maximum);
  return Object.fromEntries(rows.map((row) => [row.id || row.requestId || row.messageId || row.fileId || row.endpointId, row]));
}

function envelope(identity, payload) {
  const privateKey = createPrivateKey({ key: identity.privateKey, format: 'jwk' });
  return {
    payload,
    signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64url'),
  };
}

function verifyEnvelope(publicKey, input) {
  if (!plain(input) || !plain(input.payload) || typeof input.signature !== 'string') fail('INVALID_ENVELOPE', '签名信封无效。', 403);
  let signature;
  try {
    signature = Buffer.from(input.signature, 'base64url');
  } catch {
    fail('INVALID_ENVELOPE', '签名编码无效。', 403);
  }
  let key;
  try {
    key = createPublicKey({ key: publicKey, format: 'jwk' });
  } catch {
    fail('INVALID_ENVELOPE', '配对公钥无效。', 403);
  }
  if (!verify(null, Buffer.from(canonical(input.payload)), key, signature)) fail('SIGNATURE_INVALID', '签名验证失败。', 403);
  return input.payload;
}

async function readJson(request) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    fail('INVALID_CONTENT_TYPE', '请求必须是 JSON。', 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_HTTP_BODY_BYTES) fail('PAYLOAD_TOO_LARGE', '请求超过协议上限。', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!plain(value)) fail('INVALID_REQUEST', '请求 JSON 必须是对象。');
    return value;
  } catch (error) {
    if (error instanceof MochiLanError) throw error;
    fail('INVALID_REQUEST', '请求 JSON 无效。');
  }
}

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function postJson(address, pathname, body, signal) {
  const timeout = AbortSignal.timeout(5_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(endpointUrl(address, pathname), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (error) {
    throw new MochiLanError('DELIVERY_UNKNOWN', '局域网请求未得到可验证回执。', 503);
  }
  let payload = null;
  try { payload = await response.json(); } catch { /* protocol result stays invalid below */ }
  if (!response.ok) {
    const code = typeof payload?.code === 'string' ? payload.code : 'REMOTE_REJECTED';
    throw new MochiLanError(code, '远端拒绝该局域网请求。', response.status);
  }
  if (!plain(payload)) throw new MochiLanError('REMOTE_INVALID', '远端回执格式无效。', 502);
  return payload;
}

async function getJson(address, pathname, signal) {
  const timeout = AbortSignal.timeout(5_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(endpointUrl(address, pathname), { method: 'GET', signal: combined });
  } catch {
    throw new MochiLanError('DISCOVERY_UNAVAILABLE', '局域网候选未响应。', 503);
  }
  let payload = null;
  try { payload = await response.json(); } catch { /* invalid payload handled below */ }
  if (!response.ok || !plain(payload)) throw new MochiLanError('DISCOVERY_INVALID', '局域网候选响应无效。', 502);
  return payload;
}

/**
 * 校验「动作绑定」的一次性本机授权。
 *
 * action 是机器可读的动作 id（kebab-case，与 authorize() 铸令牌时用的一致），
 * label 才是给老师看的中文名。旧实现只查 WeakSet 成员、**完全忽略 action 参数**，
 * 于是为「确认已看到」铸的令牌可以拿去「拉黑设备」——一个被静默忽略的参数
 * 正是未来会坑人的那种缺陷，所以这里必须真的比对。
 */
function ensureAuthorization(value, action, label = action) {
  const token = value !== null && typeof value === 'object' ? value : null;
  if (!token || !INTERNAL_AUTHORIZATIONS.has(token)) fail('LOCAL_APPROVAL_REQUIRED', `${label} 需要本机受控批准。`, 403);
  const granted = INTERNAL_AUTHORIZATIONS.get(token);
  INTERNAL_AUTHORIZATIONS.delete(token); // 一次性：无论是否匹配都立即作废，不允许重试复用
  if (granted !== action) fail('LOCAL_APPROVAL_SCOPE_MISMATCH', `本机批准的范围是「${granted}」，不能用于「${action}」。`, 403);
}

/**
 * Durable, signed teacher-classroom LAN service. It exposes no model tools and
 * its state intentionally omits private keys.
 */
export class MochiLanService extends EventEmitter {
  constructor(options = {}) {
    super();
    const root = options.dataRoot ?? process.env.DSH_HOME;
    if (typeof root !== 'string' || !isAbsolute(root)) throw new TypeError('MochiLanService requires an absolute dataRoot or DSH_HOME.');
    this.dataRoot = resolve(root);
    this.statePath = join(this.dataRoot, LAN_STATE_FILENAME);
    const configuredSourceRoots = options.allowedSourceRoots ?? [this.dataRoot];
    if (!Array.isArray(configuredSourceRoots) || configuredSourceRoots.length === 0
      || configuredSourceRoots.some((entry) => typeof entry !== 'string' || !isAbsolute(entry))) {
      throw new TypeError('allowedSourceRoots must be a non-empty array of absolute directories.');
    }
    // Callers must opt in to any presentation/export directory outside this
    // controlled root. `realpath` is resolved at start and again for each
    // source file, so a symlink cannot escape the approved root later.
    this._allowedSourceRootInputs = configuredSourceRoots.map((entry) => resolve(entry));
    this._allowedSourceRoots = [];
    this.inboxRoot = join(this.dataRoot, 'mochi-lan', 'inbox');
    this.incomingRoot = join(this.inboxRoot, '.incoming');
    this.bindHost = options.bindHost ?? '0.0.0.0';
    this.initialPort = options.port ?? DEFAULT_LAN_PORT;
    this.discoveryEnabled = options.discoveryEnabled !== false;
    this.discoveryPort = options.discoveryPort ?? DEFAULT_LAN_PORT;
    this.initialIdentity = options.identity;
    const configuredRole = options.lockedRole ?? options.identity?.role;
    if (configuredRole !== undefined && configuredRole !== 'teacher' && configuredRole !== 'classroom') {
      throw new TypeError('lockedRole must be teacher or classroom.');
    }
    // This value is supplied by the independently launched teacher/classroom
    // host. It is never accepted from the authenticated browser route.
    this.lockedRole = configuredRole ?? null;
    this._dropDeliveryAckOnce = options.dropDeliveryAckOnce === true;
    // 收件箱上限：生产固定 1000；测试可注入更小的值来验证「满仓回收」路径。
    this._maxMessages = options.testMaxMessages ?? MAX_MESSAGES;
    if (!Number.isSafeInteger(this._maxMessages) || this._maxMessages < 1) {
      throw new TypeError('testMaxMessages must be a positive integer.');
    }
    // Test-only injection keeps the persistence failure path verifiable without
    // weakening the production atomic write primitive.
    this._writeFile = options.writeFileImpl ?? writeFile;
    this._rename = options.renameImpl ?? rename;
    // These two knobs are deliberately test-only. Production callers use the
    // fixed five-second beacon / fifteen-second expiry contract above.
    this._beaconIntervalMs = options.testBeaconIntervalMs ?? BEACON_INTERVAL_MS;
    this._beaconTtlMs = options.testBeaconTtlMs ?? BEACON_TTL_MS;
    this._fileTransferTtlMs = options.testFileTransferTtlMs ?? FILE_TRANSFER_TTL_MS;
    this._beaconHost = options.testBeaconHost ?? '255.255.255.255';
    this._beaconPort = options.testBeaconPort ?? this.discoveryPort;
    this._multicastPort = options.testMulticastPort ?? this.discoveryPort;
    this._multicastInterface = options.testMulticastInterface;
    if (!Number.isSafeInteger(this._beaconIntervalMs) || this._beaconIntervalMs < 25
      || !Number.isSafeInteger(this._beaconTtlMs) || this._beaconTtlMs < this._beaconIntervalMs
      || !Number.isSafeInteger(this._fileTransferTtlMs) || this._fileTransferTtlMs < 25
      || typeof this._beaconHost !== 'string' || isIP(this._beaconHost) === 0
      || !Number.isSafeInteger(this._beaconPort) || this._beaconPort < 1 || this._beaconPort > 65_535
      || !Number.isSafeInteger(this._multicastPort) || this._multicastPort < 1 || this._multicastPort > 65_535
      || (this._multicastInterface !== undefined && (typeof this._multicastInterface !== 'string' || isIP(this._multicastInterface) !== 4))) {
      throw new TypeError('test LAN timings must be positive integers with beacon ttl >= interval.');
    }
    this._state = blankState();
    this._events = [];
    this._cursor = 0;
    this._mutationTail = Promise.resolve();
    this._fileTail = Promise.resolve();
    this._server = null;
    this._udp = null;
    this._broadcastAvailable = false;
    this._multicastAvailable = false;
    this._beaconTimer = null;
    this._fileCleanupTimer = null;
    this._started = false;
    this._http = null;
    this._discovered = new Map();
    this._discovery = {
      enabled: this.discoveryEnabled,
      status: this.discoveryEnabled ? 'STARTING' : 'DISABLED',
      errorCode: null,
    };
  }

  async start() {
    if (this._started) return this.snapshot();
    await mkdir(join(this.dataRoot, 'mochi-lan'), { recursive: true, mode: 0o700 });
    await this.#initializeFileStorage();
    await this.#load();
    await this.#cleanupExpiredFiles();
    // [Mochi 2026-09-09] WO-6 自动身份引导：优先级为显式宿主配置 > 部署环境变量
    // > 数据根内种子文件。密钥对永远在本机首启生成并随 state.json 持久化；种子
    // 只提供 schoolId/classId/displayName 事实，角色仍由宿主 lockedRole 锁定。
    // 显式宿主配置直通（保留 endpointId 等全部字段），种子补缺省仅用于自动路径。
    if (!this._state.identity) {
      const fromHost = this.initialIdentity !== undefined;
      const seed = fromHost
        ? this.initialIdentity
        : this.#readIdentitySeedEnv() ?? await this.#readIdentitySeedFile();
      if (seed !== undefined) {
        const input = fromHost ? seed : this.#completeIdentitySeed(seed);
        await this.#commit((state) => { state.identity = validateIdentity(this.#identityInput(input), state.identity); });
        if (!fromHost) this.#event('identity-auto-created');
      }
    }
    const listener = createServer((request, response) => { void this.#handleHttp(request, response); });
    this._server = listener;
    const selected = await this.#listen(listener, this.initialPort);
    this._http = { host: this.bindHost, port: selected };
    if (this.discoveryEnabled) {
      try {
        await this.#startDiscovery();
        this._discovery = { enabled: true, status: 'ACTIVE', errorCode: null };
      } catch (error) {
        this.#degradeDiscovery(error, false);
      }
    }
    this._started = true;
    this._fileCleanupTimer = setInterval(() => { void this.#cleanupExpiredFiles(); }, Math.min(Math.max(Math.floor(this._fileTransferTtlMs / 2), 25), 60_000));
    this._fileCleanupTimer.unref?.();
    this.#event('state');
    return this.snapshot();
  }

  async stop() {
    if (!this._started && !this._server) return;
    if (this._fileCleanupTimer) clearInterval(this._fileCleanupTimer);
    this._fileCleanupTimer = null;
    if (this._beaconTimer) clearInterval(this._beaconTimer);
    this._beaconTimer = null;
    const udp = this._udp;
    this._udp = null;
    if (udp) await new Promise((resolveClose) => udp.close(resolveClose));
    const server = this._server;
    this._server = null;
    if (server) await new Promise((resolveClose) => server.close(resolveClose));
    this._started = false;
    this._http = null;
    this._discovery = {
      enabled: this.discoveryEnabled,
      status: this.discoveryEnabled ? 'STOPPED' : 'DISABLED',
      errorCode: null,
    };
    this.#event('state');
  }

  snapshot() {
    const identity = identityProjection(this._state.identity);
    const activeDiscovered = new Map(this.#currentDiscovered().map((row) => [row.endpointId, row]));
    const peers = Object.values(this._state.pairings).map((row) => ({
      endpointId: row.peer.endpointId,
      role: row.peer.role,
      schoolId: row.peer.schoolId,
      ...(row.peer.classId === undefined ? {} : { classId: row.peer.classId }),
      displayName: row.peer.displayName,
      fingerprint: row.peer.fingerprint,
      address: row.address,
      pairedAt: row.pairedAt,
      blocked: Boolean(this._state.blocked[row.peer.endpointId]),
      // `online` is only a fresh, matching LAN beacon. It is intentionally
      // not a promise that the remote listener or classroom is usable.
      online: activeDiscovered.get(row.peer.endpointId)?.fingerprint === row.peer.fingerprint,
      ...(activeDiscovered.get(row.peer.endpointId)?.fingerprint === row.peer.fingerprint
        ? { lastDiscoveredAt: activeDiscovered.get(row.peer.endpointId).seenAt }
        : {}),
    })).sort((left, right) => left.displayName.localeCompare(right.displayName));
    const pendingPairings = Object.values(this._state.pendingIncoming).map((row) => ({ requestId: row.requestId, peer: row.peer, receivedAt: row.receivedAt })).sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
    const blockedPeers = Object.values(this._state.blocked)
      .map((row) => ({ endpointId: row.endpointId, updatedAt: row.updatedAt }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      configured: identity !== null,
      started: this._started,
      http: this._http ? { ...this._http } : null,
      discovery: { ...this._discovery },
      identity,
      lockedRole: this.lockedRole,
      peers,
      blockedPeers,
      pendingPairings,
      inbox: boundedRows(Object.values(this._state.inbox), MAX_MESSAGES),
      outbox: boundedRows(Object.values(this._state.outbox), MAX_MESSAGES),
      receipts: boundedRows(Object.values(this._state.receipts), MAX_MESSAGES),
      files: {
        incoming: boundedRows(Object.values(this._state.incomingFiles), MAX_FILES).map((row) => fileProjection(row, 'incoming')).filter(Boolean),
        outgoing: boundedRows(Object.values(this._state.outgoingFiles), MAX_FILES).map((row) => fileProjection(row, 'outgoing')).filter(Boolean),
      },
    };
  }

  listDiscovered() {
    this.#pruneDiscovered();
    return this.#currentDiscovered().map((row) => {
      const pairing = this._state.pairings[row.endpointId];
      return {
        ...row,
        address: { ...row.address },
        paired: pairing?.peer.fingerprint === row.fingerprint,
        blocked: Boolean(this._state.blocked[row.endpointId]),
      };
    }).sort((left, right) => right.seenAt.localeCompare(left.seenAt));
  }

  pairingCandidate() {
    const identity = this.#identity();
    return { ...identityProjection(identity), publicKey: clone(identity.publicKey) };
  }

  async probeCandidate({ address, expectedFingerprint, signal } = {}) {
    const destination = validateAddress(address);
    const result = await getJson(destination, LAN_HTTP_PATHS.identity, signal);
    const publicKey = validateJwk(result.publicKey, 'candidate.publicKey');
    const candidate = validateRemoteIdentity(result.identity, publicKey);
    if (expectedFingerprint !== undefined && printable(expectedFingerprint, 'expectedFingerprint', 96) !== candidate.fingerprint) {
      fail('FINGERPRINT_MISMATCH', '候选公钥指纹与发现结果不一致。', 409);
    }
    return { candidate: { ...candidate, publicKey }, address: destination };
  }

  // [Mochi 2026-09-09] WO-6 一键信任：把「按指纹复核候选」与「发起相识」合并为
  // 本机一次受控授权。目标只取自动发现表中的地址，全程无需手填 IP；角色、学校、
  // 指纹与签名校验全部复用既有链路，未削弱任何一道检查。
  async trustDiscovered({ endpointId: targetEndpointId, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'trust-discovered', '一键信任附近设备');
    const id = endpointId(targetEndpointId);
    this.#pruneDiscovered();
    const row = this._discovered.get(id);
    if (!row) fail('DISCOVERY_NOT_FOUND', '附近设备列表中没有该设备，请等待下一次自动发现。', 404);
    if (this._state.blocked[id]) fail('PEER_BLOCKED', '该设备已被本机拉黑。', 403);
    const paired = this._state.pairings[id];
    if (paired && paired.peer.fingerprint === row.fingerprint) {
      // 已信任对端不再重复打扰，也不重复发起配对。
      return { status: 'already-paired', peer: clone(paired.peer) };
    }
    const probed = await this.probeCandidate({ address: row.address, expectedFingerprint: row.fingerprint, signal });
    // 内部派生授权只覆盖本次配对请求；浏览器的一次点击只消耗上面那一个令牌。
    const derived = this.authorize('request-pairing', 'connection-approved');
    const result = await this.requestPairing({ candidate: probed.candidate, address: probed.address, authorization: derived, signal });
    return { ...result, trustedFrom: row.seenAt };
  }

  eventsAfter(cursor = 0) {
    const numeric = Number(cursor);
    const after = Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
    return { cursor: this._cursor, events: this._events.filter((event) => event.cursor > after).map(clone) };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.on('event', listener);
    return () => this.off('event', listener);
  }

  /** Internal-only one-shot authorization after Connection or dispatch approval. */
  authorize(action, source) {
    if (!['connection-approved', 'connection-direct', 'dispatch-approved'].includes(source)) fail('LOCAL_APPROVAL_REQUIRED', '本机授权来源无效。', 403);
    const token = Object.freeze({ action, source });
    INTERNAL_AUTHORIZATIONS.set(token, action);
    return token;
  }

  async configureIdentity(input, { authorization } = {}) {
    ensureAuthorization(authorization, 'configure-identity', '配置设备身份');
    const { changed } = await this.#commit((state) => {
      const next = validateIdentity(this.#identityInput(input), state.identity);
      const changed = state.identity !== null && !identityEqual(next, state.identity);
      state.identity = next;
      if (changed) {
        state.pairings = {};
        state.pendingIncoming = {};
        state.pendingOutgoing = {};
        state.blocked = {};
      }
      return { changed };
    });
    this.#event(changed ? 'identity-changed' : 'state');
    return this.snapshot();
  }

  async requestPairing({ candidate, address, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'request-pairing', '发起配对');
    const targetPublicKey = validateJwk(candidate?.publicKey, 'candidate.publicKey');
    const target = validateRemoteIdentity(candidate, targetPublicKey);
    const destination = validateAddress(address);
    const prepared = await this.#commit((state) => {
      const local = this.#identity(state);
      if (local.role !== 'teacher') fail('ROLE_FORBIDDEN', '教室端不能自主发起配对。', 403);
      if (target.role !== 'classroom') fail('ROLE_FORBIDDEN', '教师端只能配对教室端。', 403);
      if (target.schoolId !== local.schoolId) fail('SCHOOL_MISMATCH', '学校标识不一致，拒绝配对。', 403);
      if (state.blocked[target.endpointId]) fail('PEER_BLOCKED', '该设备已被本机拉黑。', 403);
      if (Object.keys(state.pairings).length >= MAX_PAIRINGS) fail('PAIRING_LIMIT', '配对数量已达上限。', 409);
      const requestId = randomUUID();
      const payload = {
        v: LAN_PROTOCOL_VERSION,
        type: 'pair-request',
        requestId,
        createdAt: now(),
        sender: identityProjection(local),
        senderPublicKey: local.publicKey,
        senderHttpPort: this._http?.port,
        recipient: { endpointId: target.endpointId, schoolId: target.schoolId, classId: target.classId },
      };
      state.pendingOutgoing[requestId] = { requestId, peer: target, publicKey: targetPublicKey, address: destination, createdAt: payload.createdAt, updatedAt: payload.createdAt };
      state.pendingOutgoing = trimMap(state.pendingOutgoing, MAX_PENDING_PAIRINGS);
      return { requestId, signed: envelope(local, payload) };
    });
    try {
      const result = await postJson(destination, LAN_HTTP_PATHS.pairRequest, prepared.signed, signal);
      if (result.status !== 'pending') fail('REMOTE_INVALID', '远端配对响应无效。', 502);
      this.#event('pairing-request');
      return { requestId: prepared.requestId, status: 'pending', peer: target };
    } catch (error) {
      await this.#commit((state) => {
        const pending = state.pendingOutgoing[prepared.requestId];
        if (pending) pending.updatedAt = now();
      });
      throw error;
    }
  }

  async acceptPairing({ requestId, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'accept-pairing', '接受配对');
    const local = this.#identity();
    const id = printable(requestId, 'requestId', 120);
    const pending = this._state.pendingIncoming[id];
    if (!pending) fail('PAIR_REQUEST_NOT_FOUND', '未找到待确认的配对请求。', 404);
    if (this._state.blocked[pending.peer.endpointId]) fail('PEER_BLOCKED', '该设备已被本机拉黑。', 403);
    if (local.schoolId !== pending.peer.schoolId) fail('SCHOOL_MISMATCH', '学校标识不一致，拒绝配对。', 403);
    if (local.role !== 'classroom') fail('ROLE_FORBIDDEN', '只有教室端可以接受教师配对。', 403);
    if (pending.peer.role !== 'teacher') fail('ROLE_FORBIDDEN', '教室端只能接受教师端配对。', 403);
    const payload = {
      v: LAN_PROTOCOL_VERSION,
      type: 'pair-accept',
      requestId: id,
      createdAt: now(),
      sender: identityProjection(local),
      senderPublicKey: local.publicKey,
      recipient: { endpointId: pending.peer.endpointId, schoolId: pending.peer.schoolId, classId: local.classId },
    };
    const result = await postJson(pending.address, LAN_HTTP_PATHS.pairAccept, envelope(local, payload), signal);
    if (result.status !== 'paired') fail('REMOTE_INVALID', '远端接受配对响应无效。', 502);
    const committed = await this.#commit((state) => {
      const current = state.pendingIncoming[id];
      const currentIdentity = this.#identity(state);
      if (!current) fail('PAIR_REQUEST_NOT_FOUND', '待确认配对已被移除。', 404);
      if (state.blocked[current.peer.endpointId]) fail('PEER_BLOCKED', '该设备已被本机拉黑。', 403);
      if (currentIdentity.role !== 'classroom' || current.peer.role !== 'teacher' || currentIdentity.schoolId !== current.peer.schoolId) fail('ROLE_FORBIDDEN', '当前身份不能接受此配对。', 403);
      this.#storePairing(state, current.peer, current.publicKey, current.address);
      delete state.pendingIncoming[id];
      return { peer: current.peer };
    });
    this.#event('pairing-updated');
    return { status: 'paired', peer: committed.peer };
  }

  async rejectPairing({ requestId, authorization } = {}) {
    ensureAuthorization(authorization, 'reject-pairing', '拒绝配对');
    const id = printable(requestId, 'requestId', 120);
    const result = await this.#commit((state) => {
      if (!state.pendingIncoming[id]) return { status: 'absent' };
      delete state.pendingIncoming[id];
      return { status: 'rejected' };
    });
    if (result.status === 'rejected') this.#event('pairing-updated');
    return result;
  }

  async blockPeer({ endpointId: targetEndpointId, authorization } = {}) {
    ensureAuthorization(authorization, 'block-peer', '拉黑设备');
    const id = endpointId(targetEndpointId);
    await this.#commit((state) => {
      state.blocked[id] = { endpointId: id, updatedAt: now() };
      delete state.pairings[id];
      for (const [requestId, pending] of Object.entries(state.pendingIncoming)) if (pending.peer.endpointId === id) delete state.pendingIncoming[requestId];
      for (const [requestId, pending] of Object.entries(state.pendingOutgoing)) if (pending.peer.endpointId === id) delete state.pendingOutgoing[requestId];
    });
    this.#event('pairing-updated');
    return { status: 'blocked', endpointId: id };
  }

  async unpairPeer({ endpointId: targetEndpointId, authorization } = {}) {
    ensureAuthorization(authorization, 'unpair-peer', '解除配对');
    const id = endpointId(targetEndpointId);
    const result = await this.#commit((state) => {
      const existed = Boolean(state.pairings[id]);
      delete state.pairings[id];
      for (const [requestId, pending] of Object.entries(state.pendingIncoming)) if (pending.peer.endpointId === id) delete state.pendingIncoming[requestId];
      for (const [requestId, pending] of Object.entries(state.pendingOutgoing)) if (pending.peer.endpointId === id) delete state.pendingOutgoing[requestId];
      return { status: existed ? 'unpaired' : 'absent', endpointId: id };
    });
    if (result.status === 'unpaired') this.#event('pairing-updated');
    return result;
  }

  async sendMessage({ targetEndpointId, body, messageId: requestedMessageId, attachment = undefined, expectedSender = undefined, expectedPeer = undefined, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'send-message', '发送教室通知');
    return this.#sendMessageInternal({ targetEndpointId, body, requestedMessageId, attachment, expectedSender, expectedPeer, signal });
  }

  /**
   * [Mochi 2026-09-18] 教室端 → 教师端的学生预约。
   *
   * 与 sendMessage 的差别不只是方向：sendMessage 是「教师端替老师执行的外发动作」，
   * 走 dispatch 审批链，模型是发起者；学生预约是**学生本人在教室设备上的直接动作**，
   * 没有模型介入，所以它更像 markSeen——一条已认证的受控路由，令牌只由
   * host-bridge 以 connection-direct 铸出（动作名与 send-message 不同，
   * 两个方向的令牌因此不能互相复用）。
   */
  async sendRequest({ targetEndpointId, request, body, messageId: requestedMessageId, expectedSender = undefined, expectedPeer = undefined, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'send-request', '发送学生预约');
    return this.#sendMessageInternal({ targetEndpointId, body, requestedMessageId, request, expectedSender, expectedPeer, signal });
  }

  /**
   * [Mochi 2026-09-18] 教师端 → 教室端的处置登记（喊人 / 过关 / 不过关）。
   *
   * 与 sendRequest 的关键差别在**谁发起**：学生预约是人（学生）在共用设备上按的，
   * 没有模型介入，所以 host-bridge 给了它一条 connection-direct 路由；处置登记是
   * 模型（Mochi 调 skill 生成个性化文案后）发起的对外动作，因此**故意没有 HTTP 路由**，
   * 令牌只能由 dispatch 在审批通过后铸出。动作名独立（send-directive），所以
   * send-message 的令牌不能拿来下发名册。
   *
   * body 是这一批的整体说明（例如「第 5 单元听写已登记」），逐人的个性化文字在
   * directive.verdicts[].note 里。
   */
  async sendDirective({ targetEndpointId, directive, body, messageId: requestedMessageId, expectedSender = undefined, expectedPeer = undefined, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'send-directive', '下发教师处置');
    return this.#sendMessageInternal({ targetEndpointId, body, requestedMessageId, directive, expectedSender, expectedPeer, signal });
  }

  /**
   * Transfers one approved, whitelisted file before it emits the notification
   * that references it. The receiver only accepts that message after the same
   * fileId has been durably verified in its controlled inbox.
   */
  async sendFile({ targetEndpointId, sourcePath, body, messageId: requestedMessageId, fileId: requestedFileId, expectedSender = undefined, expectedPeer = undefined, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'send-file', '发送教室文件');
    let targetId;
    let text;
    let prepared;
    try {
      targetId = endpointId(targetEndpointId);
      text = printable(body, '文件通知正文', MAX_MESSAGE_BYTES);
      if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) fail('PAYLOAD_TOO_LARGE', '文件通知正文超过 64KiB。');
      prepared = await this.#prepareOutgoingFile({ targetId, sourcePath, requestedFileId, expectedSender, expectedPeer });
    } catch (error) {
      throw markPreSendFailure(error);
    }
    const transferred = await this.#transferOutgoingFile(prepared.fileId, signal);
    const message = await this.#sendMessageInternal({
      targetEndpointId: targetId,
      body: text,
      requestedMessageId,
      attachment: { fileId: transferred.fileId },
      expectedSender,
      expectedPeer,
      signal,
    });
    return { file: transferred, message };
  }

  /** Explicit human-approved continuation; it never creates a new file ID. */
  async resumeFile({ fileId: requestedFileId, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'resume-file', '继续发送教室文件');
    return this.#transferOutgoingFile(fileId(requestedFileId), signal);
  }

  /** Explicit cancellation removes only the bounded temporary chunks. */
  async cancelFile({ fileId: requestedFileId, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'cancel-file', '取消教室文件发送');
    const id = fileId(requestedFileId);
    const outgoing = this._state.outgoingFiles[id];
    if (!outgoing) fail('FILE_NOT_FOUND', '未找到本机文件传输。', 404);
    if (outgoing.status === 'AVAILABLE') fail('FILE_ALREADY_AVAILABLE', '文件已验证完成，不能撤销教室端受管副本。', 409);
    const peer = this._state.pairings[outgoing.targetEndpointId];
    if (!peer || this._state.blocked[outgoing.targetEndpointId]) fail('PAIRING_REQUIRED', '目标配对已不可用。', 403);
    const local = this.#identity();
    this.#assertStoredBinding(local, peer.peer, outgoing);
    const payload = {
      v: LAN_PROTOCOL_VERSION,
      type: 'file-cancel',
      fileId: id,
      createdAt: now(),
      sender: identityProjection(local),
      recipient: { endpointId: peer.peer.endpointId, schoolId: peer.peer.schoolId, classId: peer.peer.classId },
    };
    try {
      const result = await postJson(peer.address, LAN_HTTP_PATHS.fileCancel, envelope(local, payload), signal);
      this.#verifyFileAck(result.ack, outgoing, peer, 'cancel');
    } catch (error) {
      await this.#commit((state) => {
        const current = state.outgoingFiles[id];
        if (!current) return;
        current.status = 'UNKNOWN';
        current.failureCode = error instanceof MochiLanError ? error.code : 'DELIVERY_UNKNOWN';
        current.updatedAt = now();
      });
      this.#event('file-state');
      throw error;
    }
    await this.#commit((state) => {
      const current = state.outgoingFiles[id];
      if (!current) return;
      current.status = 'CANCELLED';
      current.updatedAt = now();
    });
    this.#event('file-cancelled');
    return { fileId: id, status: 'CANCELLED' };
  }

  async retryMessage({ messageId: requestedMessageId, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'retry-message', '重新请求同一消息回执');
    const id = messageId(requestedMessageId);
    const outgoing = this._state.outbox[id];
    if (!outgoing) fail('MESSAGE_NOT_FOUND', '未找到本机消息。', 404);
    const peer = this._state.pairings[outgoing.targetEndpointId];
    if (!peer || this._state.blocked[outgoing.targetEndpointId]) fail('PAIRING_REQUIRED', '目标配对已不可用。', 403);
    return this.#deliverOutgoing(id, signal);
  }

  async markSeen({ messageId: requestedMessageId, authorization, signal } = {}) {
    ensureAuthorization(authorization, 'mark-seen', '确认已看到');
    const id = messageId(requestedMessageId);
    const prepared = await this.#commit((state) => {
      const currentIdentity = this.#identity(state);
      // 两个方向都要能确认已看到：教室端确认老师布置的事，教师端确认学生的预约。
      // 否则教师的待办条永远清不掉——「已处理」这个状态没有落点。
      const direction = MESSAGE_DIRECTIONS[currentIdentity.role];
      if (!direction) fail('ROLE_FORBIDDEN', '本机角色不能确认已看到。', 403);
      const incoming = state.inbox[id];
      if (!incoming) fail('MESSAGE_NOT_FOUND', '未找到收件。', 404);
      // Older rows deliberately remain readable after an identity change, but
      // they did not record the receiving identity that accepted them. Never
      // reinterpret such a row as belonging to the current owner.
      if (!incoming.recipient) {
        fail('RECIPIENT_BINDING_REQUIRED', '此历史收件未记录接收身份，不能发送已看到回执。', 409);
      }
      if (!identityEqual(currentIdentity, incoming.recipient)) {
        fail('RECIPIENT_BINDING_STALE', '本机身份不再对应此收件，不能发送已看到回执。', 409);
      }
      const sourceEndpointId = typeof incoming.from?.endpointId === 'string' ? incoming.from.endpointId : '';
      const peer = sourceEndpointId ? state.pairings[sourceEndpointId] : null;
      if (!peer || peer.peer.role !== direction.peerRole) fail('PAIRING_REQUIRED', '原配对已不可用。', 403);
      if (!identityEqual(peer.peer, incoming.from)) {
        fail('PAIRING_CHANGED', '原配对身份已变化，不能向同 endpointId 的新身份发送已看到回执。', 409);
      }
      const seenAt = incoming.seenAt ?? now();
      incoming.seenAt = seenAt;
      incoming.updatedAt = now();
      return {
        seenAt,
        identity: clone(currentIdentity),
        recipient: clone(incoming.recipient),
        sender: clone(incoming.from),
        peer: clone(peer),
      };
    });
    const payload = {
      v: LAN_PROTOCOL_VERSION,
      type: 'seen-receipt',
      messageId: id,
      createdAt: now(),
      seenAt: prepared.seenAt,
      sender: identityProjection(prepared.identity),
      // 回执的收件人 = 「原发件人的 endpoint/school」+「原收件人的 class」。
      // class 是消息绑定的班级，不是发件人的班级：教师端没有 class，所以那个位置
      // 必须省略而不是写 undefined（canonical 会拒绝含 undefined 的签名负载）。
      recipient: {
        endpointId: prepared.sender.endpointId,
        schoolId: prepared.sender.schoolId,
        ...(prepared.recipient.classId === undefined ? {} : { classId: prepared.recipient.classId }),
      },
    };
    try {
      const result = await postJson(prepared.peer.address, LAN_HTTP_PATHS.receipt, envelope(prepared.identity, payload), signal);
      if (result.status !== 'recorded' && result.status !== 'duplicate') fail('REMOTE_INVALID', '远端已看到回执响应无效。', 502);
      await this.#commit((state) => {
        const incoming = state.inbox[id];
        if (!incoming) fail('MESSAGE_NOT_FOUND', '收件已被移除。', 404);
        incoming.seenReceipt = 'ACKNOWLEDGED';
        incoming.updatedAt = now();
      });
      this.#event('seen-receipt');
      return { messageId: id, seenAt: prepared.seenAt, status: 'ACKNOWLEDGED' };
    } catch (error) {
      await this.#commit((state) => {
        const incoming = state.inbox[id];
        if (!incoming) return;
        incoming.seenReceipt = 'UNKNOWN';
        incoming.updatedAt = now();
      });
      this.#event('state');
      throw error;
    }
  }

  async #sendMessageInternal({ targetEndpointId, body, requestedMessageId, attachment = undefined, request = undefined, directive = undefined, expectedSender = undefined, expectedPeer = undefined, signal }) {
    let chosenMessageId;
    try {
      const targetId = endpointId(targetEndpointId);
      const text = printable(body, '通知正文', MAX_MESSAGE_BYTES);
      if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) fail('PAYLOAD_TOO_LARGE', '通知正文超过 64KiB。');
      chosenMessageId = requestedMessageId === undefined ? randomUUID() : messageId(requestedMessageId);
      await this.#commit((state) => {
        const local = this.#identity(state);
        // 方向由本机角色决定：教师只能发通知，教室只能发学生预约。用一张表而不是
        // 两处 if，是因为「新增一个方向」时最容易漏的就是另一侧的校验。
        const direction = MESSAGE_DIRECTIONS[local.role];
        if (!direction) fail('ROLE_FORBIDDEN', '本机角色不能发起消息。', 403);
        // 先判「方向根本不接受处置名册」，再判「这个方向缺了它必需的东西」。反过来的话，
        // 教室端伪造一份名册会得到一句误导性的「缺少预约描述」，而真正的问题是越权。
        if (direction.sends === 'REQUEST' && directive !== undefined) {
          fail('INVALID_DIRECTIVE', '学生预约不接受教师处置登记。', 400);
        }
        if (direction.sends === 'REQUEST' && request === undefined) {
          fail('INVALID_REQUEST', '学生预约必须带预约描述（谁、预约什么）。', 400);
        }
        if (direction.sends === 'NOTIFY' && request !== undefined) {
          fail('INVALID_REQUEST', '通知方向不接受学生预约描述。', 400);
        }
        // 教室→教师的文件传输还没实现。显式拒绝而不是让它走到 #outgoingAttachment，
        // 否则会得到一句误导性的「文件未向同一教室验证」。
        if (direction.sends === 'REQUEST' && attachment !== undefined) {
          fail('INVALID_FILE_REFERENCE', '学生预约暂不支持附件。', 400);
        }
        const verifiedRequest = request === undefined ? undefined : requestDescriptor(request);
        const verifiedDirective = directive === undefined ? undefined : directiveDescriptor(directive);
        const peer = state.pairings[targetId];
        if (!peer || state.blocked[targetId]) fail('PAIRING_REQUIRED', '目标不是可用的已配对设备。', 403);
        if (peer.peer.role !== direction.peerRole) {
          fail('ROLE_FORBIDDEN', local.role === 'teacher'
            ? '教师端只能向教室端发送通知。'
            : '教室端只能向教师端发送学生预约。', 403);
        }
        this.#assertExpectedBinding(local, peer.peer, expectedSender, expectedPeer);
        const verifiedAttachment = this.#outgoingAttachment(state, attachment, targetId);
        const outgoing = state.outbox[chosenMessageId];
        if (outgoing) {
          if (outgoing.targetEndpointId !== targetId || outgoing.body !== text
            || canonical(outgoing.attachment ?? null) !== canonical(verifiedAttachment ?? null)
            || canonical(outgoing.request ?? null) !== canonical(verifiedRequest ?? null)
            || canonical(outgoing.directive ?? null) !== canonical(verifiedDirective ?? null)) {
            fail('MESSAGE_ID_CONFLICT', 'messageId 已绑定不同的目标、正文、文件、预约或处置名册。', 409);
          }
          this.#assertStoredBinding(local, peer.peer, outgoing);
          return;
        }
        const payload = {
          v: LAN_PROTOCOL_VERSION,
          type: 'message',
          messageId: chosenMessageId,
          contentType: direction.sends,
          createdAt: now(),
          sender: identityProjection(local),
          recipient: recipientTuple(peer.peer),
          body: text,
          ...(verifiedRequest === undefined ? {} : { request: verifiedRequest }),
          ...(verifiedDirective === undefined ? {} : { directive: verifiedDirective }),
          ...(verifiedAttachment === undefined ? {} : { attachment: verifiedAttachment }),
        };
        state.outbox[chosenMessageId] = {
          messageId: chosenMessageId,
          targetEndpointId: targetId,
          contentType: direction.sends,
          // 快照会直出浏览器：这里只能存公开投影，绝不能存含 privateKey 的完整身份。
          sender: identityProjection(local),
          peer: clone(peer.peer),
          body: text,
          ...(verifiedRequest === undefined ? {} : { request: verifiedRequest }),
          ...(verifiedDirective === undefined ? {} : { directive: verifiedDirective }),
          ...(verifiedAttachment === undefined ? {} : { attachment: verifiedAttachment }),
          envelope: envelope(local, payload),
          delivery: 'PENDING',
          createdAt: payload.createdAt,
          updatedAt: payload.createdAt,
        };
        state.outbox = trimMap(state.outbox, MAX_MESSAGES);
      });
    } catch (error) {
      throw markPreSendFailure(error);
    }
    return this.#deliverOutgoing(chosenMessageId, signal);
  }

  #assertExpectedBinding(local, peer, expectedSender, expectedPeer) {
    if (expectedSender !== undefined && !identityEqual(local, expectedSender)) {
      fail('LAN_APPROVAL_STALE', '审批期间本机身份已变化；请重新核对并确认。', 409);
    }
    if (expectedPeer !== undefined && !identityEqual(peer, expectedPeer)) {
      fail('LAN_APPROVAL_STALE', '审批期间教室配对身份已变化；请重新核对并确认。', 409);
    }
  }

  #assertStoredBinding(local, peer, row) {
    if (!row?.sender || !row?.peer || !identityEqual(local, row.sender) || !identityEqual(peer, row.peer)) {
      fail('PAIRING_CHANGED', '文件或消息建立后本机身份或教室配对已变化；拒绝向同 endpointId 的新身份继续投递。', 409);
    }
  }

  #outgoingAttachment(state, attachment, targetId) {
    if (attachment === undefined) return undefined;
    if (!plain(attachment) || Object.keys(attachment).some((key) => key !== 'fileId')) fail('INVALID_FILE_REFERENCE', '文件引用必须是已验证 fileId。');
    const id = fileId(attachment.fileId);
    const outgoing = state.outgoingFiles[id];
    if (!outgoing || outgoing.targetEndpointId !== targetId || outgoing.status !== 'AVAILABLE') {
      fail('FILE_REFERENCE_UNVERIFIED', '消息只能引用已向同一教室验证完成的文件。', 409);
    }
    const local = this.#identity(state);
    const peer = state.pairings[targetId];
    if (!peer || state.blocked[targetId]) fail('PAIRING_REQUIRED', '目标配对已不可用。', 403);
    this.#assertStoredBinding(local, peer.peer, outgoing);
    const metadata = outgoing.metadata;
    return { fileId: id, filename: metadata.filename, contentType: metadata.contentType, byteLength: metadata.byteLength, sha256: metadata.sha256 };
  }

  async #deliverOutgoing(messageId, signal) {
    const outgoing = this._state.outbox[messageId];
    if (!outgoing) fail('MESSAGE_NOT_FOUND', '未找到本机消息。', 404);
    const peer = this._state.pairings[outgoing.targetEndpointId];
    if (!peer || this._state.blocked[outgoing.targetEndpointId]) fail('PAIRING_REQUIRED', '目标配对已不可用。', 403);
    this.#assertStoredBinding(this.#identity(), peer.peer, outgoing);
    try {
      const result = await postJson(peer.address, LAN_HTTP_PATHS.message, outgoing.envelope, signal);
      const ack = this.#verifyDeliveryAck(result.ack, outgoing, peer);
      await this.#commit((state) => {
        const current = state.outbox[messageId];
        if (!current) fail('MESSAGE_NOT_FOUND', '消息已被移除。', 404);
        current.delivery = 'ACKNOWLEDGED';
        current.deliveryAck = ack;
        current.updatedAt = now();
      });
      this.#event('delivery-ack');
      return { messageId: outgoing.messageId, delivery: 'ACKNOWLEDGED', ack };
    } catch (error) {
      await this.#commit((state) => {
        const current = state.outbox[messageId];
        if (!current) return;
        current.delivery = error instanceof MochiLanError && error.code !== 'DELIVERY_UNKNOWN' && error.httpStatus < 500 ? 'NOT_SENT' : 'UNKNOWN';
        current.failureCode = error instanceof MochiLanError ? error.code : 'DELIVERY_UNKNOWN';
        current.updatedAt = now();
      });
      this.#event('state');
      throw error;
    }
  }

  #verifyDeliveryAck(input, outgoing, peer) {
    const payload = verifyEnvelope(peer.publicKey, input);
    if (payload.v !== LAN_PROTOCOL_VERSION || payload.type !== 'delivery-ack' || payload.messageId !== outgoing.messageId
      || payload.sender?.endpointId !== peer.peer.endpointId || payload.recipient?.endpointId !== this.#identity().endpointId
      || payload.schoolId !== this.#identity().schoolId || payload.classId !== peer.peer.classId) {
      fail('ACK_INVALID', '远端投递回执不匹配。', 502);
    }
    return { receivedAt: printable(payload.receivedAt, 'receivedAt', 80), duplicate: payload.duplicate === true };
  }

  async #prepareOutgoingFile({ targetId, sourcePath, requestedFileId, expectedSender = undefined, expectedPeer = undefined }) {
    const source = await this.#inspectSourceFile(sourcePath);
    const id = requestedFileId === undefined ? randomUUID() : fileId(requestedFileId);
    let created = false;
    await this.#commit((state) => {
      const local = this.#identity(state);
      if (local.role !== 'teacher') fail('ROLE_FORBIDDEN', '教室端不能自主发起外发文件。', 403);
      const peer = state.pairings[targetId];
      if (!peer || state.blocked[targetId] || peer.peer.role !== 'classroom') fail('PAIRING_REQUIRED', '目标不是可用的已配对教室设备。', 403);
      this.#assertExpectedBinding(local, peer.peer, expectedSender, expectedPeer);
      const existing = state.outgoingFiles[id];
      if (existing) {
        if (existing.targetEndpointId !== targetId || existing.sourcePath !== source.sourcePath || !fileMetadataEqual(existing.metadata, source.metadata)) {
          fail('FILE_ID_CONFLICT', 'fileId 已绑定不同的目标或文件。', 409);
        }
        this.#assertStoredBinding(local, peer.peer, existing);
        return;
      }
      if (Object.keys(state.outgoingFiles).length >= MAX_FILES) fail('FILE_LIMIT', '本机文件传输记录已达上限。', 429);
      const createdAt = now();
      state.outgoingFiles[id] = {
        fileId: id,
        targetEndpointId: targetId,
        // 同上：outgoingFiles 也会进 snapshot()，只允许公开投影。
        sender: identityProjection(local),
        peer: clone(peer.peer),
        sourcePath: source.sourcePath,
        metadata: source.metadata,
        status: 'PENDING',
        nextChunk: 0,
        createdAt,
        updatedAt: createdAt,
      };
      created = true;
    });
    if (created) this.#event('file-pending');
    return { fileId: id };
  }

  async #inspectSourceFile(sourcePath) {
    if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) fail('FILE_SOURCE_FORBIDDEN', '文件必须来自已授权的绝对路径。', 403);
    let actual;
    try {
      actual = await realpath(resolve(sourcePath));
    } catch {
      fail('FILE_SOURCE_NOT_FOUND', '文件源不存在或不可读取。', 404);
    }
    if (!this._allowedSourceRoots.some((root) => pathInside(root, actual))) {
      fail('FILE_SOURCE_FORBIDDEN', '文件不在本机受管导出目录内。', 403);
    }
    let details;
    try {
      details = await stat(actual);
    } catch {
      fail('FILE_SOURCE_NOT_FOUND', '文件源不存在或不可读取。', 404);
    }
    if (!details.isFile()) fail('FILE_SOURCE_FORBIDDEN', '只能发送普通文件。', 403);
    if (details.size <= 0 || details.size > DEFAULT_MAX_FILE_BYTES) fail('FILE_TOO_LARGE', '文件大小无效或超过 100MiB 默认上限。', 413);
    const type = fileTypeForName(basename(actual));
    await this.#verifyFileContent(actual, type.contentType);
    const digest = await this.#digestFile(actual);
    return {
      sourcePath: actual,
      metadata: {
        filename: type.filename,
        extension: type.extension,
        contentType: type.contentType,
        byteLength: details.size,
        sha256: digest,
        chunkBytes: FILE_CHUNK_BYTES,
        chunkCount: Math.ceil(details.size / FILE_CHUNK_BYTES),
      },
    };
  }

  async #transferOutgoingFile(requestedFileId, signal) {
    const id = fileId(requestedFileId);
    let outgoing = null;
    let networkStarted = false;
    try {
      const initial = this._state.outgoingFiles[id];
      if (!initial) fail('FILE_NOT_FOUND', '未找到本机文件传输。', 404);
      if (initial.status === 'CANCELLED') fail('FILE_CANCELLED', '文件传输已取消，不能自动恢复。', 409);
      const source = await this.#inspectSourceFile(initial.sourcePath);
      if (!fileMetadataEqual(source.metadata, initial.metadata)) fail('FILE_SOURCE_CHANGED', '源文件在传输开始前已改变，不能继续使用原 fileId。', 409);
      const prepared = await this.#commit((state) => {
        const current = state.outgoingFiles[id];
        if (!current) fail('FILE_NOT_FOUND', '本机文件传输已被移除。', 404);
        if (current.status === 'CANCELLED') fail('FILE_CANCELLED', '文件传输已取消，不能自动恢复。', 409);
        const local = this.#identity(state);
        const peer = state.pairings[current.targetEndpointId];
        if (!peer || state.blocked[current.targetEndpointId] || peer.peer.role !== 'classroom') fail('PAIRING_REQUIRED', '目标配对已不可用。', 403);
        this.#assertStoredBinding(local, peer.peer, current);
        if (!fileMetadataEqual(source.metadata, current.metadata)) fail('FILE_SOURCE_CHANGED', '源文件在传输开始前已改变，不能继续使用原 fileId。', 409);
        current.status = 'OFFERING';
        current.updatedAt = now();
        return { local: clone(local), peer: clone(peer), outgoing: clone(current) };
      });
      const local = prepared.local;
      const peer = prepared.peer;
      outgoing = prepared.outgoing;
      const offerPayload = {
        v: LAN_PROTOCOL_VERSION,
        type: 'file-offer',
        fileId: id,
        createdAt: now(),
        sender: identityProjection(local),
        recipient: { endpointId: peer.peer.endpointId, schoolId: peer.peer.schoolId, classId: peer.peer.classId },
        file: wireFileMetadata(outgoing.metadata),
      };
      networkStarted = true;
      const offered = await postJson(peer.address, LAN_HTTP_PATHS.fileOffer, envelope(local, offerPayload), signal);
      let acknowledgement = this.#verifyFileAck(offered.ack, outgoing, peer, 'offer');
      let nextChunk = acknowledgement.nextChunk;
      if (!acknowledgement.complete) {
        const handle = await open(source.sourcePath, 'r');
        try {
          while (nextChunk < outgoing.metadata.chunkCount) {
            const expectedLength = nextChunk + 1 === outgoing.metadata.chunkCount
              ? outgoing.metadata.byteLength - (outgoing.metadata.chunkBytes * nextChunk)
              : outgoing.metadata.chunkBytes;
            const buffer = Buffer.allocUnsafe(expectedLength);
            const { bytesRead } = await handle.read(buffer, 0, expectedLength, nextChunk * outgoing.metadata.chunkBytes);
            if (bytesRead !== expectedLength) fail('FILE_SOURCE_CHANGED', '源文件读取长度变化，已停止传输。', 409);
            const chunk = buffer.subarray(0, bytesRead);
            const payload = {
              v: LAN_PROTOCOL_VERSION,
              type: 'file-chunk',
              fileId: id,
              index: nextChunk,
              sha256: createHash('sha256').update(chunk).digest('hex'),
              data: chunk.toString('base64url'),
              sender: identityProjection(local),
              recipient: { endpointId: peer.peer.endpointId, schoolId: peer.peer.schoolId, classId: peer.peer.classId },
            };
            const response = await postJson(peer.address, LAN_HTTP_PATHS.fileChunk, envelope(local, payload), signal);
            acknowledgement = this.#verifyFileAck(response.ack, outgoing, peer, 'chunk', nextChunk);
            if (acknowledgement.nextChunk <= nextChunk && !acknowledgement.complete) fail('FILE_ACK_INVALID', '远端文件分块回执没有推进。', 502);
            nextChunk = acknowledgement.nextChunk;
            await this.#commit((state) => {
              const current = state.outgoingFiles[id];
              if (!current) fail('FILE_NOT_FOUND', '本机文件传输已被移除。', 404);
              current.status = acknowledgement.complete ? 'AVAILABLE' : 'TRANSFERRING';
              current.nextChunk = nextChunk;
              current.updatedAt = now();
            });
            if (acknowledgement.complete) break;
          }
        } finally {
          await handle.close();
        }
      }
      if (!acknowledgement.complete) fail('FILE_INCOMPLETE', '远端未确认文件完整性。', 502);
      await this.#commit((state) => {
        const current = state.outgoingFiles[id];
        if (!current) fail('FILE_NOT_FOUND', '本机文件传输已被移除。', 404);
        current.status = 'AVAILABLE';
        current.nextChunk = current.metadata.chunkCount;
        current.failureCode = undefined;
        current.completedAt = current.completedAt ?? now();
        current.updatedAt = now();
      });
      this.#event('file-available');
      return fileProjection(this._state.outgoingFiles[id], 'outgoing');
    } catch (error) {
      if (!networkStarted) markPreSendFailure(error);
      await this.#commit((state) => {
        const current = state.outgoingFiles[id];
        if (!current) return;
        current.status = 'UNKNOWN';
        current.failureCode = error instanceof MochiLanError ? error.code : 'DELIVERY_UNKNOWN';
        current.updatedAt = now();
      });
      this.#event('file-state');
      throw error;
    }
  }

  #verifyFileAck(input, outgoing, peer, stage, index = undefined) {
    const payload = verifyEnvelope(peer.publicKey, input);
    const nextChunk = Number(payload.nextChunk);
    if (payload.v !== LAN_PROTOCOL_VERSION || payload.type !== 'file-ack' || payload.fileId !== outgoing.fileId
      || payload.stage !== stage || payload.sender?.endpointId !== peer.peer.endpointId
      || payload.recipient?.endpointId !== this.#identity().endpointId
      || payload.schoolId !== this.#identity().schoolId || payload.classId !== peer.peer.classId
      || !Number.isSafeInteger(nextChunk) || nextChunk < 0 || nextChunk > outgoing.metadata.chunkCount
      || typeof payload.complete !== 'boolean'
      || (index !== undefined && payload.index !== index)) {
      fail('FILE_ACK_INVALID', '远端文件回执不匹配。', 502);
    }
    if (payload.complete && nextChunk !== outgoing.metadata.chunkCount) fail('FILE_ACK_INVALID', '远端文件完成回执不完整。', 502);
    return { nextChunk, complete: payload.complete, duplicate: payload.duplicate === true };
  }

  async #digestFile(target) {
    const hash = createHash('sha256');
    const handle = await open(target, 'r');
    try {
      const buffer = Buffer.allocUnsafe(FILE_CHUNK_BYTES);
      let position = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
    } finally {
      await handle.close();
    }
    return hash.digest('hex');
  }

  async #verifyFileContent(target, contentType) {
    const handle = await open(target, 'r');
    let header;
    try {
      const buffer = Buffer.alloc(12);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      header = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const starts = (bytes) => header.length >= bytes.length && header.subarray(0, bytes.length).equals(Buffer.from(bytes));
    const office = contentType.startsWith('application/vnd.openxmlformats-officedocument.');
    const valid = office ? starts('PK')
      : contentType === 'application/pdf' ? starts('%PDF-')
        : contentType === 'image/png' ? starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          : contentType === 'image/jpeg' ? starts([0xff, 0xd8, 0xff])
            : contentType === 'image/gif' ? (starts('GIF87a') || starts('GIF89a'))
              : contentType === 'image/webp' ? starts('RIFF') && header.subarray(8, 12).equals(Buffer.from('WEBP'))
                : false;
    if (!valid) fail('FILE_CONTENT_MISMATCH', '文件内容与白名单类型不匹配。', 415);
  }

  async #initializeFileStorage() {
    await mkdir(this.inboxRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.incomingRoot, { recursive: true, mode: 0o700 });
    const roots = [];
    for (const configured of this._allowedSourceRootInputs) {
      let actual;
      let details;
      try {
        actual = await realpath(configured);
        details = await stat(actual);
      } catch {
        fail('FILE_SOURCE_ROOT_INVALID', '受管文件导出目录不可用。', 500);
      }
      if (!details.isDirectory()) fail('FILE_SOURCE_ROOT_INVALID', '受管文件导出目录必须是目录。', 500);
      roots.push(actual);
    }
    this._allowedSourceRoots = [...new Set(roots)];
  }

  async #withFileLock(operation) {
    const next = this._fileTail.then(operation);
    this._fileTail = next.catch(() => {});
    return next;
  }

  #incomingTemporaryDirectory(id) {
    return join(this.incomingRoot, fileId(id));
  }

  #incomingChunkPath(id, index) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 1_000_000) fail('INVALID_FILE_CHUNK', '文件分块索引无效。');
    return join(this.#incomingTemporaryDirectory(id), `${String(index).padStart(7, '0')}.chunk`);
  }

  #completedFilePath(id, metadata) {
    return join(this.inboxRoot, `${fileId(id)}${metadata.extension}`);
  }

  #nextMissingChunk(row) {
    for (let index = 0; index < row.metadata.chunkCount; index += 1) {
      if (!row.chunks?.[String(index)]) return index;
    }
    return row.metadata.chunkCount;
  }

  #inboxReservation(state) {
    return Object.values(state.incomingFiles).reduce((total, row) => total + (row?.status === 'CANCELLED' ? 0 : Number(row?.metadata?.byteLength || 0)), 0);
  }

  #fileAck(local, recipient, row, stage, { index = undefined, duplicate = false } = {}) {
    const nextChunk = row.status === 'COMPLETED' ? row.metadata.chunkCount : this.#nextMissingChunk(row);
    const payload = {
      v: LAN_PROTOCOL_VERSION,
      type: 'file-ack',
      fileId: row.fileId,
      stage,
      nextChunk,
      complete: row.status === 'COMPLETED',
      duplicate,
      sender: identityProjection(local),
      recipient: {
        endpointId: recipient.endpointId,
        schoolId: recipient.schoolId,
        ...(recipient.classId === undefined ? {} : { classId: recipient.classId }),
      },
      schoolId: local.schoolId,
      classId: local.classId,
      ...(index === undefined ? {} : { index }),
    };
    return { status: row.status === 'COMPLETED' ? 'complete' : 'accepted', ack: envelope(local, payload) };
  }

  #validateIncomingFileEnvelope(state, input, expectedType) {
    const payload = input?.payload;
    if (!plain(payload) || payload.type !== expectedType || payload.v !== LAN_PROTOCOL_VERSION) fail('INVALID_ENVELOPE', '文件信封无效。', 403);
    const senderId = endpointId(payload.sender?.endpointId, 'sender.endpointId');
    const local = this.#identity(state);
    if (state.blocked[senderId]) fail('PEER_BLOCKED', '该设备已被拉黑。', 403);
    const paired = state.pairings[senderId];
    if (!paired) fail('PAIRING_REQUIRED', '发件设备未配对。', 403);
    const sender = validateRemoteIdentity(payload.sender, paired.publicKey);
    verifyEnvelope(paired.publicKey, input);
    if (!identityEqual(sender, paired.peer) || local.role !== 'classroom' || sender.role !== 'teacher'
      || payload.recipient?.endpointId !== local.endpointId || payload.recipient?.schoolId !== local.schoolId || payload.recipient?.classId !== local.classId) {
      fail('RECIPIENT_MISMATCH', '文件收发身份或班级不匹配。', 403);
    }
    return { payload, local, sender, paired };
  }

  async #cleanupExpiredFiles() {
    return this.#withFileLock(async () => {
      const cutoff = Date.now() - this._fileTransferTtlMs;
      const stale = Object.values(this._state.incomingFiles)
        .filter((row) => row?.status !== 'COMPLETED' && row?.updatedAt && Date.parse(row.updatedAt) <= cutoff)
        .map((row) => row.fileId);
      if (stale.length) {
        await this.#commit((state) => {
          for (const id of stale) {
            const row = state.incomingFiles[id];
            if (row?.status !== 'COMPLETED' && row?.updatedAt && Date.parse(row.updatedAt) <= cutoff) delete state.incomingFiles[id];
          }
        });
        await Promise.allSettled(stale.map((id) => rm(this.#incomingTemporaryDirectory(id), { recursive: true, force: true })));
        this.#event('file-expired');
      }
      const active = new Set(Object.keys(this._state.incomingFiles));
      const entries = await readdir(this.incomingRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || active.has(entry.name)) continue;
        const temporary = join(this.incomingRoot, entry.name);
        try {
          const details = await stat(temporary);
          if (details.mtimeMs <= cutoff) await rm(temporary, { recursive: true, force: true });
        } catch { /* a concurrent cancellation can remove the directory first */ }
      }
    });
  }

  async #receiveFileOffer(input) {
    const payload = input?.payload;
    if (!plain(payload) || payload.type !== 'file-offer' || payload.v !== LAN_PROTOCOL_VERSION) fail('INVALID_ENVELOPE', '文件邀请无效。', 403);
    const id = fileId(payload.fileId);
    const metadata = fileMetadata(payload.file);
    return this.#withFileLock(async () => {
      const prepared = await this.#commit((state) => {
        const { local, sender } = this.#validateIncomingFileEnvelope(state, input, 'file-offer');
        const existing = state.incomingFiles[id];
        if (existing) {
          if (!identityEqual(existing.from, sender) || !fileMetadataEqual(existing.metadata, metadata)) {
            fail('FILE_ID_CONFLICT', 'fileId 已绑定不同的来源或文件。', 409);
          }
          return { local, sender, duplicate: true };
        }
        if (Object.keys(state.incomingFiles).length >= MAX_FILES) fail('FILE_LIMIT', '收件文件记录已达上限。', 429);
        if (this.#inboxReservation(state) + metadata.byteLength > DEFAULT_INBOX_QUOTA_BYTES) {
          fail('INBOX_QUOTA_EXCEEDED', '教室受管收件目录配额不足。', 413);
        }
        const createdAt = now();
        state.incomingFiles[id] = {
          fileId: id,
          from: clone(sender),
          metadata,
          status: 'RECEIVING',
          chunks: {},
          receivedBytes: 0,
          createdAt,
          updatedAt: createdAt,
        };
        return { local, sender, duplicate: false };
      });
      const current = this._state.incomingFiles[id];
      if (current?.status !== 'COMPLETED') await mkdir(this.#incomingTemporaryDirectory(id), { recursive: true, mode: 0o700 });
      if (!prepared.duplicate) this.#event('file-offer');
      return this.#fileAck(prepared.local, prepared.sender, this._state.incomingFiles[id], 'offer', { duplicate: prepared.duplicate });
    });
  }

  async #receiveFileChunk(input) {
    const payload = input?.payload;
    if (!plain(payload) || payload.type !== 'file-chunk' || payload.v !== LAN_PROTOCOL_VERSION) fail('INVALID_ENVELOPE', '文件分块无效。', 403);
    const id = fileId(payload.fileId);
    const index = Number(payload.index);
    if (!Number.isSafeInteger(index) || index < 0 || index > 1_000_000) fail('INVALID_FILE_CHUNK', '文件分块索引无效。');
    const bytes = decodedChunk(payload.data);
    const chunkHash = sha256(payload.sha256, 'chunk.sha256');
    if (!safeHashEqual(chunkHash, createHash('sha256').update(bytes).digest('hex'))) fail('FILE_CHUNK_HASH_MISMATCH', '文件分块哈希不匹配。', 409);
    return this.#withFileLock(async () => {
      const verified = this.#validateIncomingFileEnvelope(this._state, input, 'file-chunk');
      const incoming = this._state.incomingFiles[id];
      if (!incoming || !identityEqual(incoming.from, verified.sender)) fail('FILE_NOT_FOUND', '未找到对应的文件邀请。', 404);
      if (index >= incoming.metadata.chunkCount) fail('INVALID_FILE_CHUNK', '文件分块索引超出范围。');
      const expectedLength = index + 1 === incoming.metadata.chunkCount
        ? incoming.metadata.byteLength - (incoming.metadata.chunkBytes * index)
        : incoming.metadata.chunkBytes;
      if (bytes.length !== expectedLength) fail('INVALID_FILE_CHUNK', '文件分块长度不匹配。');
      let duplicate = false;
      const known = incoming.chunks?.[String(index)];
      if (known) {
        if (known.byteLength !== bytes.length || !safeHashEqual(known.sha256, chunkHash)) fail('FILE_CHUNK_CONFLICT', '同一文件分块已绑定不同内容。', 409);
        duplicate = true;
      } else if (incoming.status !== 'COMPLETED') {
        await this.#writeIncomingChunk(id, index, bytes, chunkHash);
        await this.#commit((state) => {
          const current = state.incomingFiles[id];
          const currentVerified = this.#validateIncomingFileEnvelope(state, input, 'file-chunk');
          if (!current || !identityEqual(current.from, currentVerified.sender)) fail('FILE_NOT_FOUND', '文件邀请已不可用。', 404);
          const existing = current.chunks?.[String(index)];
          if (existing) {
            if (existing.byteLength !== bytes.length || !safeHashEqual(existing.sha256, chunkHash)) fail('FILE_CHUNK_CONFLICT', '同一文件分块已绑定不同内容。', 409);
            duplicate = true;
            return;
          }
          if (current.status === 'COMPLETED') return;
          current.chunks[String(index)] = { byteLength: bytes.length, sha256: chunkHash, receivedAt: now() };
          current.receivedBytes += bytes.length;
          current.updatedAt = now();
        });
      } else {
        duplicate = true;
      }
      let current = this._state.incomingFiles[id];
      if (current.status !== 'COMPLETED' && this.#nextMissingChunk(current) === current.metadata.chunkCount) {
        await this.#finalizeIncomingFile(id);
        current = this._state.incomingFiles[id];
      }
      if (!duplicate) this.#event(current.status === 'COMPLETED' ? 'file-complete' : 'file-chunk');
      return this.#fileAck(verified.local, verified.sender, current, 'chunk', { index, duplicate });
    });
  }

  async #receiveFileCancel(input) {
    const payload = input?.payload;
    if (!plain(payload) || payload.type !== 'file-cancel' || payload.v !== LAN_PROTOCOL_VERSION) fail('INVALID_ENVELOPE', '文件取消请求无效。', 403);
    const id = fileId(payload.fileId);
    return this.#withFileLock(async () => {
      const verified = this.#validateIncomingFileEnvelope(this._state, input, 'file-cancel');
      const current = this._state.incomingFiles[id];
      if (current && !identityEqual(current.from, verified.sender)) fail('FILE_ID_CONFLICT', 'fileId 不属于该发件设备。', 409);
      if (current?.status === 'COMPLETED') return this.#fileAck(verified.local, verified.sender, current, 'cancel', { duplicate: true });
      const duplicate = !current;
      if (current) {
        await this.#commit((state) => {
          const row = state.incomingFiles[id];
          if (row && identityEqual(row.from, verified.sender) && row.status !== 'COMPLETED') delete state.incomingFiles[id];
        });
        await rm(this.#incomingTemporaryDirectory(id), { recursive: true, force: true });
        this.#event('file-cancelled');
      }
      return this.#cancelAck(verified.local, verified.sender, id, duplicate);
    });
  }

  #cancelAck(local, recipient, id, duplicate) {
    const payload = {
      v: LAN_PROTOCOL_VERSION,
      type: 'file-ack',
      fileId: id,
      stage: 'cancel',
      nextChunk: 0,
      complete: false,
      duplicate,
      sender: identityProjection(local),
      recipient: {
        endpointId: recipient.endpointId,
        schoolId: recipient.schoolId,
        ...(recipient.classId === undefined ? {} : { classId: recipient.classId }),
      },
      schoolId: local.schoolId,
      classId: local.classId,
    };
    return { status: duplicate ? 'absent' : 'cancelled', ack: envelope(local, payload) };
  }

  async #writeIncomingChunk(id, index, bytes, expectedHash) {
    const destination = this.#incomingChunkPath(id, index);
    await mkdir(this.#incomingTemporaryDirectory(id), { recursive: true, mode: 0o700 });
    try {
      const existing = await readFile(destination);
      if (existing.length !== bytes.length || !safeHashEqual(createHash('sha256').update(existing).digest('hex'), expectedHash)) {
        fail('FILE_CHUNK_CONFLICT', '同一文件分块已绑定不同内容。', 409);
      }
      return;
    } catch (error) {
      if (error instanceof MochiLanError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async #finalizeIncomingFile(id) {
    const current = this._state.incomingFiles[id];
    if (!current || current.status === 'COMPLETED') return;
    if (this.#nextMissingChunk(current) !== current.metadata.chunkCount) return;
    const temporary = join(this.incomingRoot, `${id}.${process.pid}.${randomUUID()}.assembled`);
    const destination = this.#completedFilePath(id, current.metadata);
    let handle;
    try {
      const hash = createHash('sha256');
      let byteLength = 0;
      handle = await open(temporary, 'wx', 0o600);
      for (let index = 0; index < current.metadata.chunkCount; index += 1) {
        const descriptor = current.chunks?.[String(index)];
        const bytes = await readFile(this.#incomingChunkPath(id, index));
        if (!descriptor || bytes.length !== descriptor.byteLength
          || !safeHashEqual(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256)) {
          fail('FILE_CHUNK_MISSING', '文件临时分块缺失或已改变。', 409);
        }
        await handle.write(bytes);
        hash.update(bytes);
        byteLength += bytes.length;
      }
      await handle.close();
      handle = null;
      if (byteLength !== current.metadata.byteLength || !safeHashEqual(hash.digest('hex'), current.metadata.sha256)) {
        fail('FILE_HASH_MISMATCH', '文件整体哈希不匹配。', 409);
      }
      await this.#verifyFileContent(temporary, current.metadata.contentType);
      let destinationExists = false;
      try {
        const existing = await stat(destination);
        if (!existing.isFile() || existing.size !== current.metadata.byteLength
          || !safeHashEqual(await this.#digestFile(destination), current.metadata.sha256)) {
          fail('FILE_DESTINATION_CONFLICT', '受管收件目录已有不同文件。', 409);
        }
        await this.#verifyFileContent(destination, current.metadata.contentType);
        destinationExists = true;
      } catch (error) {
        if (error instanceof MochiLanError) throw error;
        if (error?.code !== 'ENOENT') throw error;
      }
      if (!destinationExists) await rename(temporary, destination);
      await this.#commit((state) => {
        const row = state.incomingFiles[id];
        if (!row || row.status === 'COMPLETED') return;
        if (!fileMetadataEqual(row.metadata, current.metadata) || this.#nextMissingChunk(row) !== row.metadata.chunkCount) {
          fail('FILE_STATE_CHANGED', '文件临时状态已改变。', 409);
        }
        row.status = 'COMPLETED';
        row.receivedBytes = row.metadata.byteLength;
        row.storedName = basename(destination);
        row.completedAt = now();
        row.updatedAt = now();
        delete row.chunks;
      });
      await rm(this.#incomingTemporaryDirectory(id), { recursive: true, force: true });
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  #identity(state = this._state) {
    if (!state.identity) fail('IDENTITY_REQUIRED', '设备身份尚未配置。', 409);
    return state.identity;
  }

  #identityInput(input) {
    if (!plain(input)) fail('INVALID_INPUT', '设备身份必须是对象。');
    const role = this.lockedRole;
    if (!role) fail('ROLE_LOCK_REQUIRED', '该启动根未锁定 teacher 或 classroom 角色，拒绝配置身份。', 409);
    if (input.role !== undefined && input.role !== role) fail('ROLE_LOCKED', '本机启动角色已锁定，不能由设置请求改为另一角色。', 403);
    return { ...input, role };
  }

  // [Mochi 2026-09-09] WO-6 教室端/教师端自治：部署环境变量中的身份种子。
  #readIdentitySeedEnv() {
    const raw = process.env[LAN_IDENTITY_SEED_ENV];
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    try {
      return parseIdentitySeed(JSON.parse(raw), `环境变量 ${LAN_IDENTITY_SEED_ENV}`);
    } catch (error) {
      if (error instanceof MochiLanError) throw error;
      fail('IDENTITY_SEED_INVALID', `环境变量 ${LAN_IDENTITY_SEED_ENV} 不是有效 JSON。`, 500);
    }
  }

  // [Mochi 2026-09-09] WO-6 数据根内的部署种子文件；缺文件不算错误。
  async #readIdentitySeedFile() {
    const path = join(this.dataRoot, LAN_IDENTITY_SEED_FILENAME);
    let raw;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      return parseIdentitySeed(JSON.parse(raw), LAN_IDENTITY_SEED_FILENAME);
    } catch (error) {
      if (error instanceof MochiLanError) throw error;
      fail('IDENTITY_SEED_INVALID', `${LAN_IDENTITY_SEED_FILENAME} 不是有效 JSON。`, 500);
    }
  }

  // [Mochi 2026-09-09] WO-6 补齐种子缺省项：displayName 兜底为主机名；
  // 教室端缺 classId 直接失败，绝不静默编造班级（会破坏收件绑定）。
  #completeIdentitySeed(seed) {
    const machineName = osHostname() || 'Mochi 设备';
    if (this.lockedRole === 'classroom' && seed.classId === undefined) {
      fail('IDENTITY_SEED_INVALID', '教室端自动身份种子必须包含 classId。', 500);
    }
    return {
      schoolId: seed.schoolId,
      ...(seed.classId === undefined ? {} : { classId: seed.classId }),
      displayName: seed.displayName ?? machineName,
    };
  }

  #storePairing(state, peer, publicKey, address) {
    if (Object.keys(state.pairings).length >= MAX_PAIRINGS && !state.pairings[peer.endpointId]) fail('PAIRING_LIMIT', '配对数量已达上限。', 409);
    state.pairings[peer.endpointId] = { peer, publicKey, address, pairedAt: now(), updatedAt: now() };
  }

  async #load() {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8'));
      if (!plain(parsed) || parsed.schema !== 'mochi-lan-state/v1') fail('STATE_INVALID', 'LAN 本地状态格式不受支持。');
      const state = blankState();
      for (const key of Object.keys(state)) if (parsed[key] !== undefined) state[key] = parsed[key];
      if (state.identity !== null) {
        state.identity = validateIdentity(state.identity, state.identity);
        if (this.lockedRole && state.identity.role !== this.lockedRole) fail('STATE_INVALID', 'LAN 状态角色与本机启动角色不一致。');
        if (!this.lockedRole) this.lockedRole = state.identity.role;
      }
      this._state = state;
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      if (error instanceof MochiLanError) throw error;
      throw new MochiLanError('STATE_INVALID', 'LAN 本地状态无法读取。');
    }
  }

  async #commit(mutate) {
    const next = this._mutationTail.then(async () => {
      // Mutate an isolated snapshot. Nothing observing `this._state` can see
      // a record until its atomic replacement has completed successfully.
      const candidate = clone(this._state);
      const result = await mutate(candidate);
      await this.#persist(candidate);
      this._state = candidate;
      return result;
    });
    this._mutationTail = next.catch(() => {});
    return next;
  }

  async #persist(state) {
    // Capture bytes synchronously before I/O so a later mutation cannot cause
    // this commit to write an unrelated state snapshot.
    const content = `${JSON.stringify(state)}\n`;
    const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await this._writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await this._rename(temporary, this.statePath);
  }

  async #listen(server, basePort) {
    const requested = Number(basePort);
    if (!Number.isSafeInteger(requested) || requested < 0 || requested > 65_535) throw new TypeError('LAN port must be 0-65535.');
    for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
      const candidate = requested === 0 ? 0 : requested + offset;
      if (candidate > 65_535) break;
      try {
        await new Promise((resolveListen, rejectListen) => {
          const onError = (error) => { server.off('listening', onListening); rejectListen(error); };
          const onListening = () => { server.off('error', onError); resolveListen(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen({ host: this.bindHost, port: candidate });
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('LAN HTTP server has no numeric port.');
        return address.port;
      } catch (error) {
        if (error?.code !== 'EADDRINUSE' || requested === 0 || offset + 1 >= PORT_ATTEMPTS) throw error;
      }
    }
    throw new Error('LAN HTTP port allocation exhausted.');
  }

  async #startDiscovery() {
    const socket = dgram.createSocket('udp4');
    this._udp = socket;
    this._broadcastAvailable = false;
    this._multicastAvailable = false;
    socket.on('message', (message, remote) => { this.#handleBeacon(message, remote); });
    try {
      await new Promise((resolveBind, rejectBind) => {
        socket.once('error', rejectBind);
        socket.bind(this.discoveryPort, '0.0.0.0', () => {
          socket.off('error', rejectBind);
          resolveBind();
        });
      });
    } catch (error) {
      if (this._udp === socket) this._udp = null;
      try { socket.close(); } catch { /* bind failed before a closeable socket state */ }
      throw error;
    }

    let unavailable;
    try {
      if (this._beaconHost === '255.255.255.255') socket.setBroadcast(true);
      socket.setTTL(1);
      this._broadcastAvailable = true;
    } catch (error) {
      unavailable = error;
    }
    try {
      if (this._multicastInterface !== undefined) socket.setMulticastInterface(this._multicastInterface);
      if (this._multicastInterface === undefined) socket.addMembership(LAN_MULTICAST_HOST);
      else socket.addMembership(LAN_MULTICAST_HOST, this._multicastInterface);
      socket.setMulticastTTL(1);
      socket.setMulticastLoopback(true);
      this._multicastAvailable = true;
    } catch (error) {
      unavailable ??= error;
    }
    if (!this.#hasDiscoveryPath()) throw unavailable ?? new Error('LAN discovery has no usable UDP path.');

    socket.on('error', (error) => this.#degradeDiscovery(error));
    await this.#broadcastBeacon();
    if (this._udp !== socket || !this.#hasDiscoveryPath()) throw new Error('LAN discovery has no usable UDP path.');
    const beacon = () => {
      this.#pruneDiscovered();
      void this.#broadcastBeacon();
    };
    this._beaconTimer = setInterval(beacon, this._beaconIntervalMs);
    this._beaconTimer.unref?.();
  }

  async #broadcastBeacon() {
    const identity = this._state.identity;
    const socket = this._udp;
    if (!identity || !socket || !this._http) return;
    const payload = Buffer.from(JSON.stringify({
      v: LAN_PROTOCOL_VERSION,
      type: 'beacon',
      endpointId: identity.endpointId,
      role: identity.role,
      schoolId: identity.schoolId,
      ...(identity.classId === undefined ? {} : { classId: identity.classId }),
      displayName: identity.displayName,
      fingerprint: identity.fingerprint,
      httpPort: this._http.port,
      expiresAt: Date.now() + this._beaconTtlMs,
    }));
    const paths = [];
    if (this._broadcastAvailable) paths.push({ name: 'broadcast', host: this._beaconHost, port: this._beaconPort });
    if (this._multicastAvailable) paths.push({ name: 'multicast', host: LAN_MULTICAST_HOST, port: this._multicastPort });
    const outcomes = await Promise.allSettled(paths.map((path) => new Promise((resolveSend, rejectSend) => {
      socket.send(payload, path.port, path.host, (error) => error ? rejectSend(error) : resolveSend());
    })));
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'rejected') this.#disableDiscoveryPath(paths[index].name, outcome.reason);
    }
  }

  #hasDiscoveryPath() {
    return this._broadcastAvailable || this._multicastAvailable;
  }

  #disableDiscoveryPath(path, error) {
    if (path === 'broadcast') this._broadcastAvailable = false;
    else if (path === 'multicast') this._multicastAvailable = false;
    if (!this.#hasDiscoveryPath()) this.#degradeDiscovery(error);
  }

  #handleBeacon(buffer, remote) {
    let incoming;
    try { incoming = JSON.parse(buffer.toString('utf8')); } catch { return; }
    if (!plain(incoming) || incoming.v !== LAN_PROTOCOL_VERSION || incoming.type !== 'beacon') return;
    try {
      const peer = {
        endpointId: endpointId(incoming.endpointId),
        role: incoming.role,
        schoolId: printable(incoming.schoolId, 'schoolId', 120),
        ...(incoming.classId === undefined ? {} : { classId: printable(incoming.classId, 'classId', 120) }),
        displayName: printable(incoming.displayName, 'displayName', 80),
        fingerprint: printable(incoming.fingerprint, 'fingerprint', 96),
      };
      if (!['teacher', 'classroom'].includes(peer.role) || (peer.role === 'classroom' && peer.classId === undefined)) return;
      const port = Number(incoming.httpPort);
      const advertisedExpiresAt = Number(incoming.expiresAt);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || !Number.isFinite(advertisedExpiresAt)) return;
      if (peer.endpointId === this._state.identity?.endpointId) return;
      const address = validateAddress({ host: remote.address, port });
      // The beacon timestamp is an untrusted remote clock. It remains part of
      // the wire format, but fresh/offline status is bounded by local receipt
      // time so school devices with skewed clocks still discover each other.
      this._discovered.set(peer.endpointId, { ...peer, address, seenAt: now(), expiresAt: Date.now() + this._beaconTtlMs });
      if (this._discovered.size > MAX_DISCOVERED) {
        const oldest = [...this._discovered.values()].sort((left, right) => left.seenAt.localeCompare(right.seenAt))[0];
        if (oldest) this._discovered.delete(oldest.endpointId);
      }
      this.#event('discovery');
      const pairing = this._state.pairings[peer.endpointId];
      if (pairing?.peer.fingerprint === peer.fingerprint
        && (pairing.address.host !== address.host || pairing.address.port !== address.port)) {
        void this.#refreshPairedAddress(peer.endpointId, peer.fingerprint, address);
      }
    } catch { /* untrusted beacon is ignored */ }
  }

  #currentDiscovered(cutoff = Date.now()) {
    return [...this._discovered.values()]
      .filter((row) => row.expiresAt > cutoff)
      .map((row) => ({ ...row, address: { ...row.address } }));
  }

  #pruneDiscovered() {
    const cutoff = Date.now();
    let changed = false;
    for (const [key, value] of this._discovered) {
      if (value.expiresAt <= cutoff) {
        this._discovered.delete(key);
        changed = true;
      }
    }
    if (changed) this.#event('discovery-expired');
    return changed;
  }

  #degradeDiscovery(error, emit = true) {
    if (this._discovery.status === 'DEGRADED' && this._udp === null) return;
    if (this._beaconTimer) clearInterval(this._beaconTimer);
    this._beaconTimer = null;
    const socket = this._udp;
    this._udp = null;
    if (socket) {
      try { socket.close(); } catch { /* an errored UDP socket may already be closed */ }
    }
    this._discovery = { enabled: true, status: 'DEGRADED', errorCode: discoveryErrorCode(error) };
    if (emit && this._started) this.#event('discovery-degraded');
  }

  async #refreshPairedAddress(targetEndpointId, expectedFingerprint, address) {
    const current = this._state.pairings[targetEndpointId];
    if (!current || current.peer.fingerprint !== expectedFingerprint
      || (current.address.host === address.host && current.address.port === address.port)) return;
    let probed;
    try {
      probed = await this.probeCandidate({ address, expectedFingerprint });
    } catch {
      return;
    }
    if (!identityEqual(probed.candidate, current.peer) || canonical(probed.candidate.publicKey) !== canonical(current.publicKey)) return;
    let changed = false;
    await this.#commit((state) => {
      const pairing = state.pairings[targetEndpointId];
      if (!pairing || pairing.peer.fingerprint !== expectedFingerprint
        || !identityEqual(probed.candidate, pairing.peer) || canonical(probed.candidate.publicKey) !== canonical(pairing.publicKey)) return;
      if (pairing.address.host === address.host && pairing.address.port === address.port) return;
      pairing.address = { ...address };
      pairing.updatedAt = now();
      changed = true;
    });
    if (changed) this.#event('peer-address-updated');
  }

  async #handleHttp(request, response) {
    try {
      const url = new URL(request.url || '/', 'http://lan.invalid');
      if (request.method === 'GET' && url.pathname === LAN_HTTP_PATHS.health) {
        respond(response, 200, { status: 'ok', configured: this._state.identity !== null, protocol: LAN_PROTOCOL_VERSION });
        return;
      }
      if (request.method === 'GET' && url.pathname === LAN_HTTP_PATHS.identity) {
        const identity = this.#identity();
        respond(response, 200, { identity: identityProjection(identity), publicKey: identity.publicKey });
        return;
      }
      if (request.method !== 'POST') { respond(response, 404, { code: 'NOT_FOUND' }); return; }
      const input = await readJson(request);
      if (url.pathname === LAN_HTTP_PATHS.pairRequest) { respond(response, 200, await this.#receivePairRequest(input, request)); return; }
      if (url.pathname === LAN_HTTP_PATHS.pairAccept) { respond(response, 200, await this.#receivePairAccept(input)); return; }
      if (url.pathname === LAN_HTTP_PATHS.message) {
        const result = await this.#receiveMessage(input);
        if (this._dropDeliveryAckOnce) {
          this._dropDeliveryAckOnce = false;
          request.socket.destroy();
          return;
        }
        respond(response, 200, result);
        return;
      }
      if (url.pathname === LAN_HTTP_PATHS.receipt) { respond(response, 200, await this.#receiveReceipt(input)); return; }
      if (url.pathname === LAN_HTTP_PATHS.fileOffer) { respond(response, 200, await this.#receiveFileOffer(input)); return; }
      if (url.pathname === LAN_HTTP_PATHS.fileChunk) { respond(response, 200, await this.#receiveFileChunk(input)); return; }
      if (url.pathname === LAN_HTTP_PATHS.fileCancel) { respond(response, 200, await this.#receiveFileCancel(input)); return; }
      respond(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      const known = error instanceof MochiLanError ? error : new MochiLanError('INTERNAL_ERROR', 'LAN 服务内部错误。', 500);
      if (!response.headersSent && !response.destroyed) respond(response, known.httpStatus, { code: known.code });
    }
  }

  async #receivePairRequest(input, request) {
    const payload = input?.payload;
    if (!plain(payload) || payload.type !== 'pair-request' || payload.v !== LAN_PROTOCOL_VERSION) fail('INVALID_ENVELOPE', '配对请求无效。', 403);
    const publicKey = validateJwk(payload.senderPublicKey, 'senderPublicKey');
    const sender = validateRemoteIdentity(payload.sender, publicKey);
    verifyEnvelope(publicKey, input);
    const requestId = printable(payload.requestId, 'requestId', 120);
    // The HTTP source port is ephemeral. The signed request therefore carries
    // its own listener port; the source IP is only the IP half of that address.
    const learnedAddress = validateAddress({
      host: request.socket.remoteAddress?.replace(/^::ffff:/u, '') || '',
      port: Number(payload.senderHttpPort),
    });
    const result = await this.#commit((state) => {
      const local = this.#identity(state);
      if (local.role !== 'classroom' || sender.role !== 'teacher') fail('ROLE_FORBIDDEN', '该角色不能建立此配对。', 403);
      if (payload.recipient?.endpointId !== local.endpointId || payload.recipient?.schoolId !== local.schoolId || payload.recipient?.classId !== local.classId) {
        fail('RECIPIENT_MISMATCH', '配对目标身份不匹配。', 403);
      }
      if (sender.schoolId !== local.schoolId) fail('SCHOOL_MISMATCH', '学校标识不一致。', 403);
      if (state.blocked[sender.endpointId]) fail('PEER_BLOCKED', '该设备已被拉黑。', 403);
      const existing = state.pendingIncoming[requestId];
      if (existing) return { duplicate: true };
      if (Object.keys(state.pendingIncoming).length >= MAX_PENDING_PAIRINGS) fail('PAIRING_LIMIT', '待确认配对数量已达上限。', 429);
      state.pendingIncoming[requestId] = { requestId, peer: sender, publicKey, address: learnedAddress, receivedAt: now(), updatedAt: now() };
      return { duplicate: false };
    });
    if (!result.duplicate) this.#event('pairing-request');
    return { status: 'pending', ...(result.duplicate ? { duplicate: true } : {}) };
  }

  async #receivePairAccept(input) {
    const payload = input?.payload;
    if (!plain(payload) || payload.type !== 'pair-accept' || payload.v !== LAN_PROTOCOL_VERSION) fail('INVALID_ENVELOPE', '配对接受无效。', 403);
    const publicKey = validateJwk(payload.senderPublicKey, 'senderPublicKey');
    const sender = validateRemoteIdentity(payload.sender, publicKey);
    verifyEnvelope(publicKey, input);
    const requestId = printable(payload.requestId, 'requestId', 120);
    await this.#commit((state) => {
      const local = this.#identity(state);
      const pending = state.pendingOutgoing[requestId];
      if (!pending) fail('PAIR_REQUEST_NOT_FOUND', '未找到本机发起的配对请求。', 404);
      if (!identityEqual(sender, pending.peer) || canonical(publicKey) !== canonical(pending.publicKey)) {
        fail('PAIRING_IDENTITY_MISMATCH', '接受者身份与请求目标不一致。', 403);
      }
      if (local.role !== 'teacher' || sender.role !== 'classroom' || sender.schoolId !== local.schoolId || payload.recipient?.endpointId !== local.endpointId || payload.recipient?.schoolId !== local.schoolId || payload.recipient?.classId !== sender.classId) {
        fail('RECIPIENT_MISMATCH', '配对接受目标不匹配。', 403);
      }
      this.#storePairing(state, sender, publicKey, pending.address);
      delete state.pendingOutgoing[requestId];
    });
    this.#event('pairing-updated');
    return { status: 'paired' };
  }

  async #receiveMessage(input) {
    const payload = input?.payload;
    // 这里只做「信封形状」检查，不判断方向合法性：此刻角色还没验签，拿未认证的
    // sender.role 去决定该接受什么类型，等于让发件人自己挑规则。方向在 #commit 里、
    // 验签之后用**本机**角色判定。
    if (!plain(payload) || payload.type !== 'message' || payload.v !== LAN_PROTOCOL_VERSION
      || (payload.contentType !== 'NOTIFY' && payload.contentType !== 'REQUEST')) {
      fail('INVALID_ENVELOPE', '消息信封无效。', 403);
    }
    const senderId = endpointId(payload.sender?.endpointId, 'sender.endpointId');
    const id = messageId(payload.messageId);
    const body = printable(payload.body, '通知正文', MAX_MESSAGE_BYTES);
    if (Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_BYTES) fail('PAYLOAD_TOO_LARGE', '通知正文超过 64KiB。', 413);
    const attachment = payload.attachment === undefined ? undefined : messageAttachment(payload.attachment);
    const request = payload.request === undefined ? undefined : requestDescriptor(payload.request);
    // 与 request 同理：这里只做形状校验，方向合法性放到验签之后的 #commit 里用
    // **本机**角色判定。教室端因此不能靠自称是教师来塞一份判决名册进来。
    const directive = payload.directive === undefined ? undefined : directiveDescriptor(payload.directive);
    const canonicalPayload = canonical(payload);
    const recorded = await this.#commit((state) => {
      const local = this.#identity(state);
      if (state.blocked[senderId]) fail('PEER_BLOCKED', '该设备已被拉黑。', 403);
      const paired = state.pairings[senderId];
      if (!paired) fail('PAIRING_REQUIRED', '发件设备未配对。', 403);
      const sender = validateRemoteIdentity(payload.sender, paired.publicKey);
      verifyEnvelope(paired.publicKey, input);
      if (!identityEqual(sender, paired.peer)) fail('ROLE_FORBIDDEN', '消息发件身份与配对不一致。', 403);
      const direction = MESSAGE_DIRECTIONS[local.role];
      // 对端角色与内容类型都由本机角色推导，而不是由发件人自称：教室端只收教师
      // 通知，教师端只收学生预约。手工构造一个「教师发来 REQUEST」的信封会被挡下。
      if (!direction || sender.role !== direction.peerRole || payload.contentType !== direction.receives) {
        fail('ROLE_FORBIDDEN', '消息角色不被允许。', 403);
      }
      // 与发送端对称：预约必须带描述，通知不得带。这一条挡的是手工构造的信封。
      if (direction.receives === 'REQUEST' && request === undefined) fail('INVALID_ENVELOPE', '学生预约缺少预约描述。', 403);
      if (direction.receives === 'NOTIFY' && request !== undefined) fail('INVALID_ENVELOPE', '通知不应带学生预约描述。', 403);
      // 处置名册只允许教师端下发。教师端收到一份带 directive 的收件，说明对面在
      // 冒充教师下发判决——退回去，而不是把它当普通通知记下来。
      if (direction.receives === 'REQUEST' && directive !== undefined) fail('INVALID_ENVELOPE', '学生预约不应带教师处置名册。', 403);
      if (payload.recipient?.endpointId !== local.endpointId || payload.recipient?.schoolId !== local.schoolId || payload.recipient?.classId !== local.classId) fail('RECIPIENT_MISMATCH', '消息目标班级或设备不匹配。', 403);
      if (attachment) {
        const receivedFile = state.incomingFiles[attachment.fileId];
        if (!receivedFile || !identityEqual(receivedFile.from, sender) || !attachmentMatchesFile(attachment, receivedFile)) {
          fail('FILE_REFERENCE_UNVERIFIED', '消息引用的文件尚未由本机完整验证。', 409);
        }
      }
      const existing = state.inbox[id];
      if (existing && existing.payload !== canonicalPayload) fail('MESSAGE_ID_CONFLICT', 'messageId 已绑定不同消息。', 409);
      if (existing) return { duplicate: true, local: clone(local), sender, receivedAt: existing.receivedAt };
      if (Object.keys(state.inbox).length >= this._maxMessages) {
        // 满仓时优先回收「老师已确认看到」的最旧收件，而不是直接 429：
        // 旧实现一旦满仓就永久拒收，且 dispatch 侧会把 429 当成 NOT_SENT 反复重试。
        // 未读收件一条都不丢——没有可回收的已读收件时仍然明确拒绝。
        const evictable = Object.values(state.inbox)
          .filter((row) => typeof row.seenAt === 'string')
          .sort((left, right) => String(left.seenAt).localeCompare(String(right.seenAt)));
        if (evictable.length === 0) {
          fail('MESSAGE_LIMIT', `收件箱已达上限（${this._maxMessages}）且没有已确认看到的历史收件可回收。`, 429);
        }
        const overflow = Object.keys(state.inbox).length - this._maxMessages + 1;
        for (const row of evictable.slice(0, overflow)) delete state.inbox[row.messageId];
      }
      const receivedAt = now();
      // This is a durable, public projection of the exact classroom identity
      // that passed signature, pairing, school, class and endpoint checks
      // above. It is intentionally not rewritten by later identity changes.
      state.inbox[id] = {
        messageId: id,
        from: sender,
        recipient: clone(identityProjection(local)),
        contentType: payload.contentType,
        body,
        ...(request === undefined ? {} : { request }),
        ...(directive === undefined ? {} : { directive }),
        ...(attachment === undefined ? {} : { attachment }),
        receivedAt,
        updatedAt: receivedAt,
        payload: canonicalPayload,
      };
      return { duplicate: false, local: clone(local), sender, receivedAt };
    });
    if (!recorded.duplicate) this.#event('incoming-message');
    const ackPayload = {
      v: LAN_PROTOCOL_VERSION,
      type: 'delivery-ack',
      messageId: id,
      receivedAt: recorded.receivedAt,
      duplicate: recorded.duplicate,
      sender: identityProjection(recorded.local),
      // 教师端没有 classId，这两个位置都必须省略而不是写 undefined：canonical()
      // 只接受 JSON 能表达的值，显式 undefined 会让回执直接签不出来。
      recipient: {
        endpointId: recorded.sender.endpointId,
        schoolId: recorded.sender.schoolId,
        ...(recorded.local.classId === undefined ? {} : { classId: recorded.local.classId }),
      },
      schoolId: recorded.local.schoolId,
      ...(recorded.local.classId === undefined ? {} : { classId: recorded.local.classId }),
    };
    return { status: recorded.duplicate ? 'duplicate' : 'recorded', ack: envelope(recorded.local, ackPayload) };
  }

  async #receiveReceipt(input) {
    const payload = input?.payload;
    if (!plain(payload) || payload.type !== 'seen-receipt' || payload.v !== LAN_PROTOCOL_VERSION) fail('INVALID_ENVELOPE', '已看到回执无效。', 403);
    const senderId = endpointId(payload.sender?.endpointId, 'sender.endpointId');
    const id = messageId(payload.messageId);
    const seenAt = printable(payload.seenAt, 'seenAt', 80);
    const recorded = await this.#commit((state) => {
      const local = this.#identity(state);
      const paired = state.pairings[senderId];
      if (!paired || state.blocked[senderId]) fail('PAIRING_REQUIRED', '回执设备未配对。', 403);
      const sender = validateRemoteIdentity(payload.sender, paired.publicKey);
      verifyEnvelope(paired.publicKey, input);
      const outgoing = state.outbox[id];
      // 回执只能来自「本机消息的对端」：教师端的消息对端是教室端，教室端的
      // 预约对端是教师端。方向由本机角色推导，而不是由回执自称。
      const direction = MESSAGE_DIRECTIONS[local.role];
      if (!outgoing || outgoing.targetEndpointId !== senderId || !direction || sender.role !== direction.peerRole
        || payload.recipient?.endpointId !== local.endpointId || payload.recipient?.schoolId !== local.schoolId || payload.recipient?.classId !== sender.classId) {
        fail('RECIPIENT_MISMATCH', '已看到回执与原消息不匹配。', 403);
      }
      this.#assertStoredBinding(local, sender, outgoing);
      const duplicate = Boolean(state.receipts[id]);
      state.receipts[id] = { messageId: id, from: sender, seenAt, receivedAt: now(), updatedAt: now() };
      return { duplicate };
    });
    if (!recorded.duplicate) this.#event('seen-receipt');
    return { status: recorded.duplicate ? 'duplicate' : 'recorded' };
  }

  #event(type) {
    const event = { cursor: ++this._cursor, type, at: now(), snapshot: this.snapshot() };
    this._events.push(event);
    if (this._events.length > MAX_EVENTS) this._events.splice(0, this._events.length - MAX_EVENTS);
    this.emit('event', clone(event));
  }
}
