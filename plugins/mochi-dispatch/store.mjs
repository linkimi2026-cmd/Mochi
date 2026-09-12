// Mochi Dispatch 本地存储（foundation/14 §3：mochi_tasks 建在本地 sqlite）。
// 一个 correlation_id 表示一件逻辑任务；同一任务的每次实际 relay 投递各有一行。
// 未确认投递结果永远不复用或重发，FAILED 也从不回退到非终态。
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertTransition, attemptKeyFor, taskFingerprintFor } from './state-machine.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mochi_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL DEFAULT 'jiaxinglian',
  -- 本地任务归属的校园账号 ID。旧行迁移时保持 NULL，不能由昵称反推归属。
  owner_user_id INTEGER,
  -- 独立 LAN 启动根的受管身份键。它不替代校园账号 ID，也不参与 relay 查询。
  local_owner_key TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN ('ASK','REQUEST','FIND','APPROVE')),
  status TEXT NOT NULL CHECK (status IN ('CREATED','DISPATCHING','DELIVERED','COMPLETED','DECLINED','FAILED','EXPIRED')),
  from_user_id INTEGER NOT NULL,
  from_user_name TEXT NOT NULL,
  to_peer_id INTEGER,
  to_peer_name TEXT NOT NULL,
  to_peer_role TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  result_answer TEXT NOT NULL DEFAULT '',
  requires_approval INTEGER NOT NULL DEFAULT 1,
  transport TEXT NOT NULL DEFAULT 'relay',
  relay_message_id INTEGER,
  idempotency_key TEXT UNIQUE,
  correlation_id TEXT,
  request_fingerprint TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  retry_of_task_id INTEGER,
  delivery_outcome TEXT NOT NULL DEFAULT 'PENDING',
  failure_code TEXT,
  -- 已验证 LAN 教室端“已看到”回执时间。它不是校园账号或文件已执行的证据。
  receipt_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expired_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_relay ON mochi_tasks (relay_message_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON mochi_tasks (from_user_id);
`;

const ACTIVE_STATUSES = new Set(['CREATED', 'DISPATCHING', 'DELIVERED']);
const DELIVERY_OUTCOMES = new Set(['PENDING', 'DELIVERED', 'NOT_SENT', 'UNKNOWN']);

function legacyDeliveryOutcome(task) {
  if (task.delivery_outcome && task.delivery_outcome !== 'PENDING') return task.delivery_outcome;
  return ['DELIVERED', 'COMPLETED', 'DECLINED'].includes(task.status) ? 'DELIVERED' : 'UNKNOWN';
}

function legacyFingerprint(task) {
  const ownerUserId = Number(task.owner_user_id);
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0 || Number(task.from_user_id) !== ownerUserId) return null;
  if (typeof task.idempotency_key === 'string' && task.idempotency_key.startsWith('relay-in:')) return null;
  if (typeof task.to_peer_name !== 'string' || !task.to_peer_name.trim()) return null;
  if (task.task_type === 'ASK' || task.task_type === 'REQUEST') {
    if (typeof task.goal !== 'string' || !task.goal.trim() || typeof task.context !== 'string') return null;
    return taskFingerprintFor({
      tool: task.task_type, userId: ownerUserId, peerName: task.to_peer_name, goal: task.goal, context: task.context,
    });
  }
  if (task.task_type === 'FIND') {
    // 旧版 FIND 只以 `找「<item>」` 保存显示 goal；其它格式没有可靠反解，必须保守阻断。
    if (typeof task.goal !== 'string' || task.context !== '') return null;
    const match = /^找「(.{1,64})」$/su.exec(task.goal);
    if (!match || !match[1].trim() || match[1] !== match[1].trim()) return null;
    return taskFingerprintFor({
      tool: 'FIND', userId: ownerUserId, peerName: task.to_peer_name, goal: match[1], context: '',
    });
  }
  return null;
}

// 与 taskFingerprintFor 使用相同的名字规范化规则。无法反解旧 goal 时，仍可用
// 已保存的对端名称把保守阻断限定在同一位对端，不能冻结该 owner 的全部同类任务。
function canonicalPeerName(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
}

// 只做可加字段迁移：历史行没有可验证的 owner，必须保持不可见而非按姓名认领。
function ensureSchema(db) {
  db.exec(SCHEMA);
  const columns = new Set(db.prepare('PRAGMA table_info(mochi_tasks)').all().map((column) => column.name));
  if (!columns.has('owner_user_id')) db.exec('ALTER TABLE mochi_tasks ADD COLUMN owner_user_id INTEGER');
  if (!columns.has('local_owner_key')) db.exec('ALTER TABLE mochi_tasks ADD COLUMN local_owner_key TEXT');
  if (!columns.has('correlation_id')) db.exec('ALTER TABLE mochi_tasks ADD COLUMN correlation_id TEXT');
  if (!columns.has('request_fingerprint')) db.exec('ALTER TABLE mochi_tasks ADD COLUMN request_fingerprint TEXT');
  if (!columns.has('attempt_no')) db.exec('ALTER TABLE mochi_tasks ADD COLUMN attempt_no INTEGER NOT NULL DEFAULT 1');
  if (!columns.has('retry_of_task_id')) db.exec('ALTER TABLE mochi_tasks ADD COLUMN retry_of_task_id INTEGER');
  if (!columns.has('delivery_outcome')) db.exec("ALTER TABLE mochi_tasks ADD COLUMN delivery_outcome TEXT NOT NULL DEFAULT 'PENDING'");
  if (!columns.has('failure_code')) db.exec('ALTER TABLE mochi_tasks ADD COLUMN failure_code TEXT');
  if (!columns.has('receipt_seen_at')) db.exec('ALTER TABLE mochi_tasks ADD COLUMN receipt_seen_at TEXT');
  // 旧出站任务的 from_user_id 是创建时的稳定校园账号，可安全回填；
  // 旧入站镜像没有收件账号，靠 relay-in 前缀保留为 NULL，绝不能按昵称归属。
  db.prepare(`UPDATE mochi_tasks
    SET owner_user_id = from_user_id
    WHERE owner_user_id IS NULL
      AND from_user_id > 0
      AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'relay-in:%')`).run();
  // 已知旧版 ASK/REQUEST 字段可恢复为现在的 canonical fingerprint；旧 FIND 只接受
  // 已确认的 `找「<item>」` 编码。其余行保留 legacy:<id> fingerprint，并在同 owner/type
  // 的新请求前保守阻断，绝不猜测它原本对应哪件工作。
  const legacyRows = db.prepare(`SELECT * FROM mochi_tasks
    WHERE correlation_id IS NULL OR request_fingerprint IS NULL OR request_fingerprint = 'legacy:' || id`).all();
  const migrateLegacy = db.prepare(`UPDATE mochi_tasks
    SET correlation_id = COALESCE(correlation_id, ?),
        request_fingerprint = ?,
        attempt_no = COALESCE(attempt_no, 1),
        delivery_outcome = ?
    WHERE id = ?`);
  for (const task of legacyRows) {
    const correlationId = `legacy:${task.id}`;
    const fingerprint = legacyFingerprint(task) || correlationId;
    migrateLegacy.run(correlationId, fingerprint, legacyDeliveryOutcome(task), task.id);
  }
  // 早期 dispatch 版本会在真正发送期间留下 DISPATCHING + PENDING；它无法证明
  // 远端没有写入。升级后保守转为 UNKNOWN，避免过期后被 newTask 当成可安全重发。
  db.prepare("UPDATE mochi_tasks SET delivery_outcome = 'UNKNOWN' WHERE delivery_outcome = 'PENDING' AND status IN ('DISPATCHING', 'EXPIRED')").run();
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_owner ON mochi_tasks (owner_user_id, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_dispatch_fingerprint ON mochi_tasks (owner_user_id, request_fingerprint, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_local_owner ON mochi_tasks (local_owner_key, id DESC) WHERE local_owner_key IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_local_fingerprint ON mochi_tasks (local_owner_key, request_fingerprint, id DESC) WHERE local_owner_key IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dispatch_attempt ON mochi_tasks (correlation_id, attempt_no) WHERE correlation_id IS NOT NULL');
}

function requireOwnerUserId(ownerUserId) {
  const id = Number(ownerUserId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('任务必须绑定有效的校园账号 ID。');
  return id;
}

function requireLocalOwnerKey(localOwnerKey) {
  const key = String(localOwnerKey ?? '').trim();
  if (!key.startsWith('local:') || key.length > 512 || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new Error('局域网任务必须绑定受管本机身份。');
  }
  return key;
}

function requireTaskId(taskId, label = '任务 ID') {
  const id = Number(taskId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} 无效。`);
  return id;
}

function requireFingerprint(requestFingerprint) {
  const fingerprint = String(requestFingerprint || '').trim();
  if (!fingerprint) throw new Error('任务缺少可验证的请求身份。');
  return fingerprint;
}

function requireDeliveryOutcome(outcome) {
  if (!DELIVERY_OUTCOMES.has(outcome)) throw new Error(`未知投递结果：${outcome}`);
  return outcome;
}

function isBlocking(task) {
  return ACTIVE_STATUSES.has(task.status)
    || task.delivery_outcome === 'UNKNOWN'
    || (task.status === 'FAILED' && task.delivery_outcome !== 'NOT_SENT');
}

export function defaultDbPath(dshHome = process.env.DSH_HOME) {
  const home = dshHome || join(process.env.HOME || '/tmp', '.mochi-home');
  return join(home, 'dispatch', 'mochi-tasks.sqlite');
}

export function openStore(dbPath = defaultDbPath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 3000;');
  ensureSchema(db);
  return db;
}

const now = () => new Date().toISOString();

export function createStore(db = openStore()) {
  ensureSchema(db);
  const insertAttempt = db.prepare(`INSERT INTO mochi_tasks
    (owner_user_id, task_type, status, from_user_id, from_user_name, to_peer_name, to_peer_role, goal, context,
     transport, idempotency_key, correlation_id, request_fingerprint, attempt_no, retry_of_task_id, delivery_outcome,
     created_at, updated_at, expired_at)
    VALUES (?, ?, 'CREATED', ?, ?, ?, ?, ?, ?, 'relay', ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`);
  // LAN rows deliberately preserve owner_user_id/from_user_id as the
  // non-account sentinel 0. Their ownership is only local_owner_key, and all
  // relay queries remain keyed by a positive campus account ID.
  const insertLanAttempt = db.prepare(`INSERT INTO mochi_tasks
    (local_owner_key, owner_user_id, task_type, status, from_user_id, from_user_name, to_peer_name, to_peer_role, goal, context,
     transport, idempotency_key, correlation_id, request_fingerprint, attempt_no, retry_of_task_id, delivery_outcome,
     created_at, updated_at, expired_at)
    VALUES (?, 0, ?, 'CREATED', 0, ?, ?, ?, ?, ?, 'lan', ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`);
  const insertMirror = db.prepare(`INSERT INTO mochi_tasks
    (owner_user_id, task_type, status, from_user_id, from_user_name, to_peer_name, to_peer_role, goal, context,
     transport, relay_message_id, idempotency_key, correlation_id, request_fingerprint, attempt_no, delivery_outcome,
     created_at, updated_at, expired_at)
    VALUES (?, ?, 'DELIVERED', ?, ?, ?, ?, ?, ?, 'relay', ?, ?, ?, ?, 1, 'DELIVERED', ?, ?, ?)`);
  const get = db.prepare('SELECT * FROM mochi_tasks WHERE id = ?');
  const byKey = db.prepare('SELECT * FROM mochi_tasks WHERE idempotency_key = ?');
  const byRelayForOwner = db.prepare('SELECT * FROM mochi_tasks WHERE relay_message_id = ? AND owner_user_id = ? ORDER BY id DESC');
  const listByOwner = db.prepare('SELECT * FROM mochi_tasks WHERE owner_user_id = ? ORDER BY id DESC LIMIT 100');
  const listByLocalOwner = db.prepare('SELECT * FROM mochi_tasks WHERE local_owner_key = ? AND transport = \'lan\' ORDER BY id DESC LIMIT 100');
  const listAll = db.prepare('SELECT * FROM mochi_tasks ORDER BY id DESC LIMIT 200');
  const byFingerprint = db.prepare('SELECT * FROM mochi_tasks WHERE owner_user_id = ? AND request_fingerprint = ? ORDER BY id DESC');
  const byLocalFingerprint = db.prepare('SELECT * FROM mochi_tasks WHERE local_owner_key = ? AND transport = \'lan\' AND request_fingerprint = ? ORDER BY id DESC');
  const byCorrelation = db.prepare('SELECT * FROM mochi_tasks WHERE correlation_id = ? ORDER BY attempt_no DESC, id DESC');
  const uncertainLegacyByOwnerAndType = db.prepare(`SELECT * FROM mochi_tasks
    WHERE owner_user_id = ? AND task_type = ? AND request_fingerprint = 'legacy:' || id AND delivery_outcome = 'UNKNOWN'
    ORDER BY id DESC`);
  const transitionStmt = db.prepare(`UPDATE mochi_tasks
    SET status = ?, updated_at = ?,
        result_answer = CASE WHEN ? <> '' THEN ? ELSE result_answer END,
        relay_message_id = CASE WHEN ? IS NOT NULL THEN ? ELSE relay_message_id END,
        delivery_outcome = CASE WHEN ? IS NOT NULL THEN ? ELSE delivery_outcome END,
        failure_code = CASE WHEN ? IS NOT NULL THEN ? ELSE failure_code END,
        completed_at = CASE WHEN ? IN ('COMPLETED','DECLINED','FAILED','EXPIRED') THEN ? ELSE completed_at END
    WHERE id = ? AND status = ?`);
  const recordOutcomeStmt = db.prepare(`UPDATE mochi_tasks
    SET delivery_outcome = ?, failure_code = ?,
        result_answer = CASE WHEN ? <> '' THEN ? ELSE result_answer END,
        updated_at = ?
    WHERE id = ? AND status = 'DISPATCHING'`);
  const recordLanReceiptStmt = db.prepare(`UPDATE mochi_tasks
    SET receipt_seen_at = ?,
        result_answer = CASE WHEN ? <> '' THEN ? ELSE result_answer END,
        updated_at = ?
    WHERE id = ?
      AND transport = 'lan'
      AND local_owner_key = ?
      AND status IN ('DELIVERED', 'COMPLETED')`);
  const expireStmt = db.prepare(`UPDATE mochi_tasks
    SET status = 'EXPIRED', updated_at = ?, completed_at = ?
    WHERE status IN ('CREATED','DISPATCHING','DELIVERED') AND expired_at IS NOT NULL AND expired_at <= ?`);

  function dispatchState(ownerUserId, requestFingerprint, taskType = null, peerName = null) {
    const ownerId = requireOwnerUserId(ownerUserId);
    const fingerprint = requireFingerprint(requestFingerprint);
    const rows = byFingerprint.all(ownerId, fingerprint);
    const normalizedPeerName = canonicalPeerName(peerName);
    const legacyBlocking = taskType && normalizedPeerName
      ? uncertainLegacyByOwnerAndType.all(ownerId, taskType)
        .find((task) => canonicalPeerName(task.to_peer_name) === normalizedPeerName) || null
      : null;
    return {
      latest: rows[0] || null,
      active: rows.find((task) => ACTIVE_STATUSES.has(task.status)) || null,
      blocking: rows.find(isBlocking) || legacyBlocking,
      legacyBlocking,
      rows,
    };
  }

  function lanDispatchState(localOwnerKey, requestFingerprint) {
    const owner = requireLocalOwnerKey(localOwnerKey);
    const fingerprint = requireFingerprint(requestFingerprint);
    const rows = byLocalFingerprint.all(owner, fingerprint);
    return {
      latest: rows[0] || null,
      active: rows.find((task) => ACTIVE_STATUSES.has(task.status)) || null,
      blocking: rows.find(isBlocking) || null,
      rows,
    };
  }

  function retryEligibility({ ownerUserId, taskId, taskType, requestFingerprint }) {
    const ownerId = requireOwnerUserId(ownerUserId);
    const retryId = requireTaskId(taskId, '重试任务 ID');
    const fingerprint = requireFingerprint(requestFingerprint);
    const target = get.get(retryId);
    if (!target) throw new Error(`任务 #${retryId} 不存在。`);
    if (target.owner_user_id !== ownerId) throw new Error(`任务 #${retryId} 不属于当前校园账号，不能重试。`);
    if (target.task_type !== taskType || target.request_fingerprint !== fingerprint) {
      throw new Error(`任务 #${retryId} 与本次任务内容不一致，不能重试。`);
    }
    if (target.status !== 'FAILED' || target.delivery_outcome !== 'NOT_SENT') {
      throw new Error(`任务 #${retryId} 没有可确认的未投递失败，不能重试。`);
    }
    const state = dispatchState(ownerId, fingerprint, taskType, target.to_peer_name);
    if (state.blocking) return { task: state.blocking, reused: true, reason: 'blocking' };
    const latestForCorrelation = byCorrelation.all(target.correlation_id)[0] || target;
    if (latestForCorrelation.id !== target.id) return { task: latestForCorrelation, reused: true, reason: 'superseded' };
    return { task: target, reused: false, nextAttemptNo: Number(target.attempt_no) + 1 };
  }

  function lanRetryEligibility({ localOwnerKey, taskId, taskType, requestFingerprint }) {
    const owner = requireLocalOwnerKey(localOwnerKey);
    const retryId = requireTaskId(taskId, '重试任务 ID');
    const fingerprint = requireFingerprint(requestFingerprint);
    const target = get.get(retryId);
    if (!target) throw new Error(`任务 #${retryId} 不存在。`);
    if (target.transport !== 'lan' || target.local_owner_key !== owner) throw new Error(`任务 #${retryId} 不属于当前局域网教师身份，不能重试。`);
    if (target.task_type !== taskType || target.request_fingerprint !== fingerprint) {
      throw new Error(`任务 #${retryId} 与本次教室通知内容不一致，不能重试。`);
    }
    if (target.status !== 'FAILED' || target.delivery_outcome !== 'NOT_SENT') {
      throw new Error(`任务 #${retryId} 没有可确认的未投递失败，不能重试。`);
    }
    const state = lanDispatchState(owner, fingerprint);
    if (state.blocking) return { task: state.blocking, reused: true, reason: 'blocking' };
    const latestForCorrelation = byCorrelation.all(target.correlation_id)[0] || target;
    if (latestForCorrelation.id !== target.id) return { task: latestForCorrelation, reused: true, reason: 'superseded' };
    return { task: target, reused: false, nextAttemptNo: Number(target.attempt_no) + 1 };
  }

  function inImmediateTransaction(run) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* BEGIN 失败时没有事务需要回滚。 */ }
      throw error;
    }
  }

  return {
    db,
    // 兼容早期本地调用方。新的 Relay 发出任务应改用 createDispatchAttempt，
    // 从而持久化逻辑任务与每次实际投递的关系。
    createTask({ taskType, fromUserId, ownerUserId = fromUserId, fromUserName, toPeerName, toPeerRole = '', goal, context = '', idempotencyKey = null, expiredAt = null }) {
      const t = now();
      const ownerId = requireOwnerUserId(ownerUserId);
      const correlationId = `compat:${randomUUID()}`;
      const requestFingerprint = `compat:${idempotencyKey || correlationId}`;
      try {
        const info = insertAttempt.run(ownerId, taskType, fromUserId, fromUserName, toPeerName, toPeerRole, goal, context,
          idempotencyKey, correlationId, requestFingerprint, 1, null, t, t, expiredAt);
        return { ...get.get(Number(info.lastInsertRowid)), reused: false };
      } catch (error) {
        if (String(error?.message || '').includes('UNIQUE') && idempotencyKey) {
          return { ...byKey.get(idempotencyKey), reused: true };
        }
        throw error;
      }
    },
    // 创建一次可实际发送的 relay 投递。事务内再次检查使跨会话同时重试只生成一个 attempt。
    createDispatchAttempt({ mode = 'default', retryTaskId = null, ownerUserId, taskType, fromUserId, fromUserName, toPeerName, toPeerRole = '', goal, context = '', requestFingerprint, expiredAt = null }) {
      const ownerId = requireOwnerUserId(ownerUserId);
      const fingerprint = requireFingerprint(requestFingerprint);
      if (!['default', 'new', 'retry'].includes(mode)) throw new Error(`未知任务创建方式：${mode}`);
      return inImmediateTransaction(() => {
        const state = dispatchState(ownerId, fingerprint, taskType, toPeerName);
        if (state.blocking) return { task: state.blocking, reused: true, reason: 'blocking' };
        if (mode === 'default' && state.latest) return { task: state.latest, reused: true, reason: 'existing' };

        let correlationId;
        let attemptNo;
        let retryOfTaskId = null;
        if (mode === 'retry') {
          const eligibility = retryEligibility({ ownerUserId: ownerId, taskId: retryTaskId, taskType, requestFingerprint: fingerprint });
          if (eligibility.reused) return eligibility;
          correlationId = eligibility.task.correlation_id;
          attemptNo = eligibility.nextAttemptNo;
          retryOfTaskId = eligibility.task.id;
        } else {
          correlationId = randomUUID();
          attemptNo = 1;
        }

        const t = now();
        const idempotencyKey = attemptKeyFor(correlationId, attemptNo);
        const info = insertAttempt.run(ownerId, taskType, fromUserId, fromUserName, toPeerName, toPeerRole, goal, context,
          idempotencyKey, correlationId, fingerprint, attemptNo, retryOfTaskId, t, t, expiredAt);
        return { task: get.get(Number(info.lastInsertRowid)), reused: false, reason: mode };
      });
    },
    // Standalone LAN teacher attempts share mochi_tasks and the same seven
    // states, but never impersonate a positive campus account. `0` is a
    // documented non-account sentinel; local_owner_key is the sole owner
    // selector for these rows, so relay rows cannot be claimed by a LAN root.
    createLanDispatchAttempt({ mode = 'default', retryTaskId = null, localOwnerKey, taskType = 'REQUEST', fromUserName, toPeerName, toPeerRole = 'classroom', goal, context = '', requestFingerprint, expiredAt = null }) {
      const owner = requireLocalOwnerKey(localOwnerKey);
      const fingerprint = requireFingerprint(requestFingerprint);
      if (!['default', 'new', 'retry'].includes(mode)) throw new Error(`未知任务创建方式：${mode}`);
      return inImmediateTransaction(() => {
        const state = lanDispatchState(owner, fingerprint);
        if (state.blocking) return { task: state.blocking, reused: true, reason: 'blocking' };
        if (mode === 'default' && state.latest) return { task: state.latest, reused: true, reason: 'existing' };

        let correlationId;
        let attemptNo;
        let retryOfTaskId = null;
        if (mode === 'retry') {
          const eligibility = lanRetryEligibility({ localOwnerKey: owner, taskId: retryTaskId, taskType, requestFingerprint: fingerprint });
          if (eligibility.reused) return eligibility;
          correlationId = eligibility.task.correlation_id;
          attemptNo = eligibility.nextAttemptNo;
          retryOfTaskId = eligibility.task.id;
        } else {
          correlationId = randomUUID();
          attemptNo = 1;
        }
        const t = now();
        const idempotencyKey = attemptKeyFor(correlationId, attemptNo);
        const info = insertLanAttempt.run(owner, taskType, String(fromUserName || '').trim(), String(toPeerName || '').trim(), String(toPeerRole || '').trim(),
          String(goal || '').trim(), String(context || ''), idempotencyKey, correlationId, fingerprint, attemptNo, retryOfTaskId, t, t, expiredAt);
        return { task: get.get(Number(info.lastInsertRowid)), reused: false, reason: mode };
      });
    },
    // 镜像入站 relay 行为本地任务（幂等键 relay-in:<owner-id>:<id>）；to_peer_* = 收件主人。
    // peer 是对端，owner 是当前认证的收件校园账号，二者不得混用。
    mirrorInboundTask({ ownerUserId, taskType, peerId = 0, peerName, peerRole = '', toPeerName, toPeerRole = '', goal, relayMessageId, idempotencyKey, createdAt, expiredAt }) {
      try {
        const t = now();
        const ownerId = requireOwnerUserId(ownerUserId);
        const correlationId = `relay-in:${ownerId}:${relayMessageId}`;
        insertMirror.run(ownerId, taskType, peerId, peerName, toPeerName, toPeerRole, goal, '', relayMessageId, idempotencyKey,
          correlationId, correlationId, createdAt || t, t, expiredAt);
        return byKey.get(idempotencyKey);
      } catch (error) {
        if (String(error?.message || '').includes('UNIQUE')) return byKey.get(idempotencyKey);
        throw error;
      }
    },
    getTask: (id) => get.get(Number(id)) || null,
    getTaskByRelayMessage: (relayMessageId, ownerUserId) => byRelayForOwner.get(Number(relayMessageId), requireOwnerUserId(ownerUserId)) || null,
    getTaskByIdempotencyKey: (key) => byKey.get(key) || null,
    getDispatchState: (input) => dispatchState(input.ownerUserId, input.requestFingerprint, input.taskType, input.peerName),
    getLanDispatchState: (input) => lanDispatchState(input.localOwnerKey, input.requestFingerprint),
    preflightRetry: (input) => retryEligibility(input),
    preflightLanRetry: (input) => lanRetryEligibility(input),
    listTasksByUser: (ownerUserId) => listByOwner.all(requireOwnerUserId(ownerUserId)),
    listTasksByLanOwner: (localOwnerKey) => listByLocalOwner.all(requireLocalOwnerKey(localOwnerKey)),
    listAll: () => listAll.all(),
    // 条件迁移：状态机断言 + WHERE status=? 双保险。同目标态重放=幂等成功。
    transition(id, to, { resultAnswer = '', relayMessageId = null, deliveryOutcome = undefined, failureCode = undefined } = {}) {
      const current = get.get(Number(id));
      if (!current) throw new Error(`任务 #${id} 不存在。`);
      if (current.status === to) return { task: current, idempotent: true };
      assertTransition(current.status, to);
      const outcome = deliveryOutcome === undefined
        ? to === 'DELIVERED' ? 'DELIVERED' : to === 'DISPATCHING' ? 'UNKNOWN' : undefined
        : deliveryOutcome;
      if (outcome !== undefined) requireDeliveryOutcome(outcome);
      const failure = failureCode === undefined ? null : String(failureCode).slice(0, 120);
      const t = now();
      const info = transitionStmt.run(to, t, resultAnswer, resultAnswer, relayMessageId, relayMessageId,
        outcome ?? null, outcome ?? null, failure, failure, to, t, Number(id), current.status);
      if (info.changes !== 1) throw new Error(`任务 #${id} 状态竞争：期望从 ${current.status} 迁移到 ${to} 失败（并发修改）。`);
      return { task: get.get(Number(id)), idempotent: false };
    },
    // 不确定的写入结果只记录，不改状态也不制造新的投递 attempt。
    recordDeliveryOutcome(id, { outcome, failureCode = 'DELIVERY_UNKNOWN', resultAnswer = '' }) {
      requireDeliveryOutcome(outcome);
      const t = now();
      recordOutcomeStmt.run(outcome, String(failureCode || '').slice(0, 120), resultAnswer, resultAnswer, t, Number(id));
      return get.get(Number(id)) || null;
    },
    // Receipt ingestion is local-only: the LAN service has already verified
    // the signed peer and original outbox binding before dispatch reaches this
    // conditional projection.  It never claims a relay row or another local
    // identity's task.
    recordLanReceipt({ taskId, localOwnerKey, seenAt, resultAnswer = '' }) {
      const current = get.get(Number(taskId));
      if (!current || current.transport !== 'lan' || current.local_owner_key !== requireLocalOwnerKey(localOwnerKey)
        || !['DELIVERED', 'COMPLETED'].includes(current.status)) return null;
      const timestamp = String(seenAt || '').trim();
      if (!timestamp || timestamp.length > 120) throw new Error('教室已看到回执时间无效。');
      const note = String(resultAnswer || '').slice(0, 500);
      recordLanReceiptStmt.run(timestamp, note, note, now(), Number(taskId), current.local_owner_key);
      return get.get(Number(taskId)) || null;
    },
    // 到期扫描：非终态且过期 → EXPIRED（单条条件批量更新，天然幂等）。
    expireScan(nowMs = Date.now()) {
      const at = new Date(nowMs).toISOString();
      const hit = db.prepare(`SELECT id FROM mochi_tasks
        WHERE status IN ('CREATED','DISPATCHING','DELIVERED') AND expired_at IS NOT NULL AND expired_at <= ?`).all(at);
      if (hit.length) expireStmt.run(now(), now(), at);
      return hit.map((row) => row.id);
    },
  };
}
