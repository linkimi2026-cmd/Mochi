import { createHash } from 'node:crypto';
import { expiryFor, localTaskFingerprintFor } from './state-machine.mjs';

function requireToolCallId(exec) {
  const callId = typeof exec?.callId === 'string' ? exec.callId.trim() : '';
  if (!callId) throw new Error('【未发送】当前调用没有稳定 callId，不能安全建立局域网消息幂等键。');
  return callId;
}

export function lanTaskMessageId(task) {
  return 'lan-' + createHash('sha256').update(String(task.idempotency_key)).digest('hex').slice(0, 32);
}

function lanFileId(task) {
  return 'lan-file-' + createHash('sha256').update(String(task.idempotency_key)).digest('hex').slice(0, 32);
}

function parseControls(args) {
  const hasRetry = args?.retryTaskId !== undefined;
  const retryTaskId = hasRetry ? Number(args.retryTaskId) : null;
  if (hasRetry && (!Number.isSafeInteger(retryTaskId) || retryTaskId <= 0)) throw new Error('retryTaskId 必须是任务列表中给出的正整数。');
  if (args?.newTask !== undefined && typeof args.newTask !== 'boolean') throw new Error('newTask 必须是 true 或 false。');
  if (hasRetry && args?.newTask === true) throw new Error('retryTaskId 与 newTask 不能同时使用。');
  return { retryTaskId, newTask: args?.newTask === true };
}

export function localLanOwnerKey(lan) {
  const snapshot = lan?.snapshot?.();
  const identity = snapshot?.identity;
  if (!snapshot?.started || !identity || typeof identity.schoolId !== 'string' || typeof identity.endpointId !== 'string' || typeof identity.fingerprint !== 'string') return null;
  // The values originate in MochiLanService's locked, persisted identity. This
  // opaque local key is never supplied by a model argument or campus account.
  return 'local:' + identity.schoolId + ':' + identity.endpointId + ':' + identity.fingerprint;
}

function currentTeacherPeer(lan, targetEndpointId) {
  const snapshot = lan?.snapshot?.();
  const identity = snapshot?.identity;
  if (!snapshot?.started || !identity) throw new Error('【未发送】教室局域网服务尚未完成身份配置或启动。');
  if (identity.role !== 'teacher') throw new Error('【未发送】只有已配置的教师端可以发送教室通知。');
  const target = String(targetEndpointId || '').trim();
  if (!target) throw new Error('【未发送】请从已配对教室列表选择 endpointId，不能猜测。');
  const peer = Array.isArray(snapshot.peers) ? snapshot.peers.find((row) => row.endpointId === target) : undefined;
  if (!peer || peer.blocked || peer.role !== 'classroom' || peer.schoolId !== identity.schoolId || !peer.classId) {
    throw new Error('【未发送】目标不是同校、未拉黑的已配对教室设备。请先在本机设置中核对学校、班级和设备指纹。');
  }
  return { identity, peer };
}

function approvalBinding(row) {
  return {
    endpointId: row.endpointId,
    role: row.role,
    schoolId: row.schoolId,
    ...(row.classId === undefined ? {} : { classId: row.classId }),
    displayName: row.displayName,
    fingerprint: row.fingerprint,
  };
}

function sameApprovalBinding(left, right) {
  return left?.endpointId === right?.endpointId
    && left?.role === right?.role
    && left?.schoolId === right?.schoolId
    && left?.classId === right?.classId
    && left?.displayName === right?.displayName
    && left?.fingerprint === right?.fingerprint;
}

function confirmApprovalBinding(lan, endpoint, approved) {
  const current = currentTeacherPeer(lan, endpoint);
  const currentOwner = localLanOwnerKey(lan);
  if (currentOwner !== approved.owner
    || !sameApprovalBinding(current.identity, approved.identity)
    || !sameApprovalBinding(current.peer, approved.peer)) {
    throw new Error('【未发送】等待确认期间本机身份或教室配对已变化；请重新核对学校、班级、设备指纹后再次确认。');
  }
  return {
    identity: approvalBinding(current.identity),
    peer: approvalBinding(current.peer),
  };
}

function classroomProjection(row, paired) {
  return {
    endpointId: row.endpointId,
    schoolId: row.schoolId,
    classId: row.classId,
    displayName: row.displayName,
    fingerprint: row.fingerprint,
    online: row.online === true,
    paired,
  };
}

function taskResult(task, extra = {}) {
  return {
    taskId: task.id,
    transport: 'lan',
    taskType: task.task_type,
    status: task.status,
    deliveryOutcome: task.delivery_outcome,
    ...(task.failure_code ? { failureCode: task.failure_code } : {}),
    ...extra,
  };
}

function existingLanResult(task) {
  const result = taskResult(task, { 重复投递已拦截: true });
  if (task.delivery_outcome === 'UNKNOWN') {
    result.说明 = '该教室通知的投递结果不明，不能用 retryTaskId 或 newTask 自动再次发送；请先联系教室端核对。';
  } else if (task.status === 'FAILED' && task.delivery_outcome === 'NOT_SENT') {
    result.需明确重试 = true;
    result.retryTaskId = task.id;
  }
  return result;
}

function transportFailureCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{1,120}$/u.test(error.code) ? error.code : 'DELIVERY_UNKNOWN';
}

// MochiLanService marks only errors it observed before its first LAN HTTP
// request.  Error codes alone are insufficient: the receiver can return
// FILE_ID_CONFLICT after a file offer, and a source can change after chunks
// have already reached the classroom.
function isVerifiedPreSendFileFailure(error) {
  return error?.lanDeliveryPhase === 'pre-send';
}

async function dispatchLanDelivery({ lan, approval, args, exec, store, toolName, kind, sourcePath = undefined }) {
  if (!store?.createLanDispatchAttempt || !store?.getLanDispatchState || !store?.transition || !store?.recordDeliveryOutcome) {
    throw new TypeError('mochi_notify_classroom requires the local dispatch task store.');
  }
  const reviewed = currentTeacherPeer(lan, args?.classroomEndpointId);
  const approvedIdentity = approvalBinding(reviewed.identity);
  const approvedPeer = approvalBinding(reviewed.peer);
  const message = String(args?.message || '').trim();
  if (!message) throw new Error('【未发送】请填写要发送到教室的通知正文。');
  requireToolCallId(exec);
  const owner = localLanOwnerKey(lan);
  if (!owner) throw new Error('【未发送】教师局域网身份尚未受管启动，无法建立任务归属。');
  const controls = parseControls(args);
  const mode = controls.retryTaskId !== null ? 'retry' : controls.newTask ? 'new' : 'default';
  const fingerprintGoal = kind === 'file'
    ? 'FILE\n' + String(sourcePath || '') + '\n' + message
    : 'NOTIFY\n' + message;
  const requestFingerprint = localTaskFingerprintFor({
    tool: kind === 'file' ? 'LAN_FILE' : 'LAN_NOTIFY',
    localOwnerKey: owner,
    peerEndpointId: approvedPeer.endpointId,
    goal: fingerprintGoal,
  });
  store.expireScan?.();
  const state = store.getLanDispatchState({ localOwnerKey: owner, requestFingerprint });
  if (mode === 'retry') {
    const retry = store.preflightLanRetry({ localOwnerKey: owner, taskId: controls.retryTaskId, taskType: 'REQUEST', requestFingerprint });
    if (retry.reused) return existingLanResult(retry.task);
  } else if (state.blocking || (mode === 'default' && state.latest)) {
    return existingLanResult(state.blocking || state.latest);
  }
  if (!approval || typeof approval.request !== 'function') throw new Error('【未发送】当前会话没有人工确认通道，通知没有发出。');
  const preview = message.length <= 1_000 ? message : message.slice(0, 1_000) + '…（其余内容已省略预览）';
  const fileLine = kind === 'file' ? '\n课件文件：' + String(sourcePath) : '';
  const decision = await approval.request({
    agent: exec?.agent,
    toolName,
    callId: exec?.callId,
    signal: exec?.signal,
    reason: '以已配置教师端「' + approvedIdentity.displayName + '」向已配对教室发送' + (kind === 'file' ? '课件文件' : '通知') + '：\n\n学校：' + approvedPeer.schoolId + '\n班级：' + approvedPeer.classId + '\n设备：' + approvedPeer.displayName + '（' + approvedPeer.endpointId + '，' + approvedPeer.fingerprint + '）' + fileLine + '\n\n通知：\n' + preview,
  });
  if (decision !== 'allowed-once') throw new Error('【未发送】教室通知没有获得主人确认。请如实告知，不能说成已发送。');

  // The person approved a specific local teacher identity and classroom
  // fingerprint.  Do not create a task or hand an endpointId to the service
  // if either side changed while the approval card was open.
  const { identity, peer } = confirmApprovalBinding(lan, approvedPeer.endpointId, {
    owner,
    identity: approvedIdentity,
    peer: approvedPeer,
  });

  const created = store.createLanDispatchAttempt({
    mode,
    retryTaskId: controls.retryTaskId,
    localOwnerKey: owner,
    taskType: 'REQUEST',
    fromUserName: identity.displayName,
    toPeerName: peer.displayName,
    toPeerRole: 'classroom',
    goal: message,
    context: kind === 'file' ? '附件：' + String(sourcePath) : '',
    requestFingerprint,
    expiredAt: expiryFor('REQUEST'),
  });
  if (created.reused) return existingLanResult(created.task);
  const task = created.task;
  store.transition(task.id, 'DISPATCHING', { deliveryOutcome: 'UNKNOWN' });
  try {
    const messageId = lanTaskMessageId(task);
    const wire = kind === 'file'
      ? await lan.sendFile({
        targetEndpointId: peer.endpointId,
        sourcePath,
        body: message,
        fileId: lanFileId(task),
        messageId,
        expectedSender: identity,
        expectedPeer: peer,
        authorization: lan.authorize('send-file', 'dispatch-approved'),
        signal: exec?.signal,
      })
      : await lan.sendMessage({
        targetEndpointId: peer.endpointId,
        body: message,
        messageId,
        expectedSender: identity,
        expectedPeer: peer,
        authorization: lan.authorize('send-message', 'dispatch-approved'),
        signal: exec?.signal,
      });
    const delivered = store.transition(task.id, 'DELIVERED', { deliveryOutcome: 'DELIVERED' }).task;
    return {
      ...taskResult(delivered),
      messageId,
      target: { endpointId: peer.endpointId, schoolId: peer.schoolId, classId: peer.classId, displayName: peer.displayName, fingerprint: peer.fingerprint },
      ...(kind === 'file' ? { file: wire.file, delivery: wire.message?.delivery } : { delivery: wire.delivery, ack: wire.ack }),
    };
  } catch (error) {
    const messageText = String(error?.message || error);
    if (kind === 'file' && isVerifiedPreSendFileFailure(error)) {
      const failed = store.transition(task.id, 'FAILED', {
        deliveryOutcome: 'NOT_SENT',
        failureCode: transportFailureCode(error),
        resultAnswer: messageText.slice(0, 200),
      }).task;
      throw new Error('【未投递】教室文件任务 #' + failed.id + ' 在本机发送前被拒绝（' + transportFailureCode(error) + '）。若修正同一文件后仍要重试，请显式传 retryTaskId: ' + failed.id + ' 并再次确认。');
    }
    store.recordDeliveryOutcome(task.id, {
      outcome: 'UNKNOWN',
      failureCode: transportFailureCode(error),
      resultAnswer: messageText.slice(0, 200),
    });
    throw new Error('【结果不明】教室任务 #' + task.id + ' 已创建但投递结果不确定。不会自动重发，也不能用 newTask 绕过；请先联系教室端核对。');
  }
}

/**
 * Read-only roster for a model turn. Discovery is deliberately described as a
 * candidate rather than a target: only a manually paired classroom can enter
 * the approval-gated send path.
 */
export function listLanClassrooms(lan) {
  const snapshot = lan?.snapshot?.() ?? {};
  const identity = snapshot.identity ?? null;
  const discovered = lan?.listDiscovered?.();
  const pairedClassrooms = (Array.isArray(snapshot.peers) ? snapshot.peers : [])
    .filter((row) => row?.role === 'classroom' && row.blocked !== true)
    .map((row) => classroomProjection(row, true))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const nearbyCandidates = (Array.isArray(discovered) ? discovered : [])
    .filter((row) => row?.role === 'classroom' && row.paired !== true && row.blocked !== true)
    .map((row) => classroomProjection({ ...row, online: true }, false))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  return {
    transport: 'lan',
    configured: snapshot.configured === true,
    started: snapshot.started === true,
    identity: identity ? {
      endpointId: identity.endpointId,
      role: identity.role,
      schoolId: identity.schoolId,
      ...(identity.classId === undefined ? {} : { classId: identity.classId }),
      displayName: identity.displayName,
    } : null,
    pairedClassrooms,
    nearbyCandidates,
    guidance: '只有 paired=true 的教室才可作为 mochi_notify_classroom 或 mochi_send_classroom_file 的目标；nearbyCandidates 只是未验证发现结果，不能据同名自动选择、配对或发送。online 仅表示当前发现信标有效，不代表确定在线。',
  };
}

export async function sendLanNotification({ lan, approval, args, exec, store }) {
  return dispatchLanDelivery({ lan, approval, args, exec, store, toolName: 'mochi_notify_classroom', kind: 'message' });
}

export async function sendLanFile({ lan, approval, args, exec, store }) {
  const sourcePath = typeof args?.sourcePath === 'string' ? args.sourcePath.trim() : '';
  if (!sourcePath) throw new Error('【未发送】请提供已生成课件的绝对 sourcePath。');
  return dispatchLanDelivery({ lan, approval, args, exec, store, toolName: 'mochi_send_classroom_file', kind: 'file', sourcePath });
}
