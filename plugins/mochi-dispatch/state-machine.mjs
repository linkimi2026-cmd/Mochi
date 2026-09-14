import { createHash } from 'node:crypto';

// Mochi Dispatch 任务状态机（docs/history/foundation/15_TASK_STATE_MACHINE.md）
// v1 只启用 7 态：CREATED / DISPATCHING / DELIVERED / COMPLETED / DECLINED / FAILED / EXPIRED
// INPUT_REQUIRED / APPROVAL_REQUIRED / CANCELLED 字段与 UI 预留，随 Golden Demo 需要。
//
// 与联动计划 Relay 的兼容映射（15 §2）：
//   DELIVERED ≡ pending · COMPLETED ≡ accepted(+reply) · DECLINED ≡ declined

export const TASK_TYPES = ['ASK', 'REQUEST', 'FIND', 'APPROVE'];

export const TASK_STATES = [
  'CREATED', 'DISPATCHING', 'DELIVERED',
  'COMPLETED', 'DECLINED', 'FAILED', 'EXPIRED',
];

export const TERMINAL_STATES = new Set(['COMPLETED', 'DECLINED', 'FAILED', 'EXPIRED']);

// 合法迁移表：键=当前态，值=允许迁往的态集合。终态没有键（不可逆）。
export const TRANSITIONS = {
  CREATED: new Set(['DISPATCHING', 'EXPIRED', 'FAILED']),
  DISPATCHING: new Set(['DELIVERED', 'EXPIRED', 'FAILED']),
  DELIVERED: new Set(['COMPLETED', 'DECLINED', 'EXPIRED', 'FAILED']),
};

export function canTransition(from, to) {
  if (from === to) return false; // 自迁移视为无操作，不允许（幂等由条件更新保证）
  return TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransition(from, to) {
  if (!TASK_STATES.includes(from)) throw new Error(`未知任务状态：${from}`);
  if (!TASK_STATES.includes(to)) throw new Error(`未知任务状态：${to}`);
  if (TERMINAL_STATES.has(from)) throw new Error(`任务已终态（${from}），不可再迁移到 ${to}。`);
  if (!canTransition(from, to)) throw new Error(`非法迁移：${from} → ${to}。`);
  return true;
}

// 过期默认时长（15 §4）：ASK/REQUEST 24h，FIND 72h（APPROVE 不单独建任务）
export const EXPIRY_TTL_MS = { ASK: 24 * 3600e3, REQUEST: 24 * 3600e3, FIND: 72 * 3600e3 };

export function expiryFor(taskType, createdAt = new Date()) {
  const ttl = EXPIRY_TTL_MS[taskType];
  if (!ttl) return null;
  return new Date(new Date(createdAt).getTime() + ttl).toISOString();
}

// Relay 状态 ↔ 任务状态（兼容映射，PRESERVE 语义）
export function relayStatusToTask(relayStatus) {
  if (relayStatus === 'pending') return 'DELIVERED';
  if (relayStatus === 'accepted') return 'COMPLETED';
  if (relayStatus === 'declined') return 'DECLINED';
  return null;
}

// 前端六态卡派生（15 §3）：PENDING_SEND / RUNNING / INPUT_REQUIRED /
// APPROVAL_REQUIRED / COMPLETED / TERMINATED
export function deriveCardState(status) {
  if (status === 'CREATED' || status === 'DISPATCHING') return 'PENDING_SEND';
  if (status === 'DELIVERED') return 'RUNNING';
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'DECLINED' || status === 'FAILED' || status === 'EXPIRED') return 'TERMINATED';
  return 'RUNNING'; // 预留态（INPUT_REQUIRED/APPROVAL_REQUIRED）落 UI 时再细分
}

// 到期判定：非终态且超过 expiredAt → 应置 EXPIRED
export function isExpired(task, now = new Date()) {
  if (TERMINAL_STATES.has(task.status)) return false;
  if (!task.expired_at && !task.expiredAt) return false;
  const at = task.expired_at || task.expiredAt;
  return new Date(at).getTime() <= now.getTime();
}

function canonicalText(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
}

// 逻辑任务 fingerprint：同一 owner、工具、对端、目标和背景是同一件事，
// 与日历小时无关。用 canonical JSON + hash 避免冒号拼接的歧义，也避免把
// 任务正文直接作为 SQLite 唯一键。真正要再发一件同文案任务，必须走显式
// newTask 语义，而不能借整点跨越绕过去。
export function taskFingerprintFor({ tool, userId, peerName, goal, context = '' }) {
  const ownerUserId = Number(userId);
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw new Error('幂等任务必须绑定有效的校园账号 ID。');
  const canonical = JSON.stringify({
    v: 1,
    tool: canonicalText(tool),
    ownerUserId,
    peerName: canonicalText(peerName),
    goal: canonicalText(goal),
    context: canonicalText(context),
  });
  return `dispatch:v1:${createHash('sha256').update(canonical).digest('hex')}`;
}

// 兼容已有调用方的导出名。第二个参数历史上是小时桶时间；现在有意忽略，
// 因为重放身份不能由时钟边界决定。
export function idempotencyKeyFor(input, _at = undefined) {
  return taskFingerprintFor(input);
}

// LAN-only counterpart: a standalone teacher endpoint has no campus account
// number. The opaque owner key comes from the locked, persisted LAN identity;
// callers must never derive it from model-supplied text. It deliberately has a
// different prefix from relay fingerprints, so the two transports cannot claim
// each other's historical task rows.
export function localTaskFingerprintFor({ tool, localOwnerKey, peerEndpointId, goal, context = '' }) {
  const owner = String(localOwnerKey ?? '').trim();
  const endpoint = String(peerEndpointId ?? '').trim();
  if (!owner.startsWith('local:') || owner.length > 512 || !endpoint || endpoint.length > 120) {
    throw new Error('局域网任务必须绑定受管本机身份和精确教室 endpoint。');
  }
  const canonical = JSON.stringify({
    v: 1,
    transport: 'lan',
    tool: canonicalText(tool),
    localOwnerKey: owner,
    peerEndpointId: endpoint,
    goal: canonicalText(goal),
    context: canonicalText(context),
  });
  return `dispatch:lan:v1:${createHash('sha256').update(canonical).digest('hex')}`;
}

// 一次实际 relay 投递的幂等身份。它与上方逻辑任务 identity 分离：失败重提
// 会创建新的 attempt key，但仍关联同一 correlation_id。
export function attemptKeyFor(correlationId, attemptNo) {
  const correlation = String(correlationId || '').trim();
  const attempt = Number(attemptNo);
  if (!correlation || !Number.isSafeInteger(attempt) || attempt <= 0) throw new Error('投递尝试身份无效。');
  return `dispatch-attempt:${correlation}:${attempt}`;
}
