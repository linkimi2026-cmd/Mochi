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
function isVerifiedPreSendFailure(error) {
  return error?.lanDeliveryPhase === 'pre-send';
}

/* ───────────────── 处置名册：喊人 / 过关 / 不过关 ───────────────── */

const VERDICT_ACTIONS = ['call', 'pass', 'fail', 'retry'];
const VERDICT_LABELS = Object.freeze({ call: '喊人', pass: '过关', fail: '不过关', retry: '需补做' });
/** 与服务层 MAX_VERDICTS 对齐：服务层是硬约束，这里是提前给出可读的拒绝理由。 */
const MAX_VERDICTS = 64;
const MAX_VERDICT_NOTE = 200;
const MAX_DIRECTIVE_ITEM = 120;
/** 审批卡上最多列出多少行名册。超过就写「另有 N 位」——卡片不是表格，没人会读 64 行。 */
const ROSTER_PREVIEW_ROWS = 12;

function boundedText(value, maximum, label) {
  if (typeof value !== 'string') throw new Error('【未发送】' + label + '必须是文本。');
  const normalized = value.normalize('NFC').trim();
  if (!normalized) throw new Error('【未发送】' + label + '不能为空。');
  if (normalized.length > maximum) throw new Error('【未发送】' + label + '超过 ' + maximum + ' 字。');
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) throw new Error('【未发送】' + label + '不能含换行或控制字符。');
  return normalized;
}

/**
 * 校验模型给的处置名册。
 *
 * 这里比服务层更严的只有一条：**过关类判决必须带个性化交代**。协议层允许 note 缺省
 * （老师只是喊人时本就没有可交代的），但模型这一侧不允许——过关/不过关如果只发一个
 * 标签，学生看到的就是一个死的结论，那正是我们要避免的东西。缺交代时直接退回，
 * 并在话里指明去调 skill 逐人生成。
 */
function verdictsFor(args) {
  const item = boundedText(args?.item, MAX_DIRECTIVE_ITEM, '登记名目');
  const raw = args?.verdicts;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('【未发送】请给出至少一位学生的处置结果。');
  if (raw.length > MAX_VERDICTS) throw new Error('【未发送】一次登记最多 ' + MAX_VERDICTS + ' 位学生。');
  const seen = new Set();
  const verdicts = raw.map((row, index) => {
    const at = '第 ' + (index + 1) + ' 位学生';
    if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error('【未发送】' + at + '的处置必须是对象。');
    const student = boundedText(row.student, 120, at + '的姓名');
    if (seen.has(student)) throw new Error('【未发送】' + student + '在同一份名册里出现了两次；请合并成一条。');
    seen.add(student);
    if (!VERDICT_ACTIONS.includes(row.action)) {
      throw new Error('【未发送】' + student + '的处置动作无效，只能是 ' + VERDICT_ACTIONS.join(' / ') + '。');
    }
    let seat;
    if (row.seat !== undefined && row.seat !== null && row.seat !== '') {
      seat = Number(row.seat);
      if (!Number.isSafeInteger(seat) || seat < 1 || seat > 999) throw new Error('【未发送】' + student + '的座号必须是 1 到 999 的整数。');
    }
    let note;
    if (row.note !== undefined && row.note !== null && row.note !== '') {
      note = boundedText(row.note, MAX_VERDICT_NOTE, student + '的个性化交代');
    } else if (row.action !== 'call') {
      throw new Error('【未发送】' + student + '的「' + VERDICT_LABELS[row.action] + '」缺少个性化交代。'
        + '请先调 skill 为这一位学生生成「该补什么、错在哪、下一步找谁」，再连同判决一起登记——'
        + '只发一个「不过关」标签，学生看到的会是一个没有出路的结论。');
    }
    return { student, action: row.action, ...(seat === undefined ? {} : { seat }), ...(note === undefined ? {} : { note }) };
  });
  return { item, verdicts };
}

/** 指数字符串：名册整份参与，顺序敏感——换一位学生或改一个字都必须是另一件事。 */
function directiveFingerprint(directive) {
  return directive.item + '\n' + directive.verdicts
    .map((row) => [row.student, row.seat ?? '', row.action, row.note ?? ''].join('\t'))
    .join('\n');
}

/**
 * 名册汇总的显示顺序：要动手的在前，过关的沉底。
 *
 * 与教室板上「待办在前、已过关沉底」的排序同一条道理——老师扫一行字就该先看到
 * 需要他处理的人，而不是先看到已经没问题的人。
 */
const VERDICT_COUNT_ORDER = ['fail', 'retry', 'call', 'pass'];

function rosterCounts(verdicts) {
  const tally = { pass: 0, fail: 0, retry: 0, call: 0 };
  for (const row of verdicts) tally[row.action] += 1;
  return VERDICT_COUNT_ORDER
    .filter((action) => tally[action] > 0)
    .map((action) => tally[action] + ' 位' + VERDICT_LABELS[action])
    .join(' · ');
}

/**
 * 审批卡上的名册正文。
 *
 * 审批卡的全部意义是「主人一眼能核对将要显示到教室屏上的东西」，所以这里把逐人
 * 交代一并列出来——只写「下发 6 位同学的处置」等于让主人盲签。
 */
function rosterPreview(directive) {
  const shown = directive.verdicts.slice(0, ROSTER_PREVIEW_ROWS).map((row, index) => {
    const seat = row.seat === undefined ? '' : '（' + row.seat + ' 号）';
    const note = row.note ? ' — ' + row.note : '';
    return (index + 1) + '. ' + row.student + seat + ' · ' + VERDICT_LABELS[row.action] + note;
  });
  const rest = directive.verdicts.length - shown.length;
  return [
    '名目：' + directive.item,
    '合计：' + rosterCounts(directive.verdicts),
    '',
    ...shown,
    ...(rest > 0 ? ['…以及另外 ' + rest + ' 位'] : []),
  ].join('\n');
}

/** 名册缺 message 时自动写一句整批说明：模型不必手写，教室端也总有一行上下文。 */
function directiveMessage(args, directive) {
  const explicit = String(args?.message || '').trim();
  if (explicit) return explicit;
  return '【' + directive.item + '】' + rosterCounts(directive.verdicts) + '，名单见下。';
}

async function dispatchLanDelivery({ lan, approval, args, exec, store, toolName, kind, sourcePath = undefined, directive = undefined }) {
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
    : kind === 'directive'
      // 名册必须整份进指纹：两份内容不同的名册若共用同一句说明文字，会被幂等层
      // 当成同一件事拦下来，第二份名单就永远发不出去。
      ? 'DIRECTIVE\n' + directiveFingerprint(directive) + '\n' + message
      : 'NOTIFY\n' + message;
  const requestFingerprint = localTaskFingerprintFor({
    tool: kind === 'file' ? 'LAN_FILE' : kind === 'directive' ? 'LAN_DIRECTIVE' : 'LAN_NOTIFY',
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
  const kindLabel = kind === 'file' ? '课件文件' : kind === 'directive' ? '处置名册' : '通知';
  // 三种载荷的审批卡正文不同：名册要逐人列出将显示到教室屏上的字，否则主人是在盲签。
  const payloadBlock = kind === 'directive'
    ? rosterPreview(directive)
    : '通知：\n' + preview;
  const decision = await approval.request({
    agent: exec?.agent,
    toolName,
    callId: exec?.callId,
    signal: exec?.signal,
    reason: '以已配置教师端「' + approvedIdentity.displayName + '」向已配对教室发送' + kindLabel + '：\n\n学校：' + approvedPeer.schoolId + '\n班级：' + approvedPeer.classId + '\n设备：' + approvedPeer.displayName + '（' + approvedPeer.endpointId + '，' + approvedPeer.fingerprint + '）' + fileLine + '\n\n' + payloadBlock,
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
    context: kind === 'file' ? '附件：' + String(sourcePath) : kind === 'directive' ? '名册：' + rosterCounts(directive.verdicts) : '',
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
      : kind === 'directive'
        ? await lan.sendDirective({
          targetEndpointId: peer.endpointId,
          directive,
          body: message,
          messageId,
          expectedSender: identity,
          expectedPeer: peer,
          // 动作名独立于 send-message：一个已铸出的通知令牌不能拿来下发名册。
          authorization: lan.authorize('send-directive', 'dispatch-approved'),
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
      ...(kind === 'file'
        ? { file: wire.file, delivery: wire.message?.delivery }
        : { delivery: wire.delivery, ack: wire.ack }),
      ...(kind === 'directive' ? { item: directive.item, 名册: rosterCounts(directive.verdicts), 人数: directive.verdicts.length } : {}),
    };
  } catch (error) {
    const messageText = String(error?.message || error);
    // 文件和名册都会被服务层在发出第一个 HTTP 请求之前拒掉（类型、配额、名册越界）。
    // 这种拒绝能**证明**没投递，所以要如实标成 NOT_SENT；标成 UNKNOWN 会让主人跑去
    // 教室端核对一件从未发出的事。
    if ((kind === 'file' || kind === 'directive') && isVerifiedPreSendFailure(error)) {
      const failed = store.transition(task.id, 'FAILED', {
        deliveryOutcome: 'NOT_SENT',
        failureCode: transportFailureCode(error),
        resultAnswer: messageText.slice(0, 200),
      }).task;
      if (kind === 'directive') {
        // 名册整份进指纹，所以改过内容的名单就是另一件事：它必须作为新的一次登记
        // 重新确认，不能被 retryTaskId 套上旧指纹悄悄发出去。
        throw new Error('【未投递】教室处置名册 #' + failed.id + ' 在本机发送前被拒绝（' + transportFailureCode(error)
          + '）。不会投递到教室；修正后请作为新的一次登记重新确认。');
      }
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

/**
 * 下发一份处置名册到教室端（喊人 / 过关 / 不过关）。
 *
 * 名册里的逐人交代由 Mochi 调 skill 生成后随判决一起走——服务层和派生层都只负责
 * 搬运和显示，谁都不会在缺内容时补一个模板上去。
 */
export async function sendLanDirective({ lan, approval, args, exec, store }) {
  const directive = verdictsFor(args);
  return dispatchLanDelivery({
    lan,
    approval,
    exec,
    store,
    args: { ...args, message: directiveMessage(args, directive) },
    toolName: 'mochi_register_verdicts',
    kind: 'directive',
    directive,
  });
}
