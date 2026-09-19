// mochi-dispatch · Mochi 任务域（foundation PHASE_5 / 14_MOCHI_DISPATCH_V1 / 15_TASK_STATE_MACHINE）
//
// 四原语：ASK（问一句话等回话）· REQUEST（请求做事等批准）· FIND（找资源）· APPROVE（对入站请求的应答动作，
// 由 mochi_respond 承载）。v1 载体=单机模拟：任务事实落本地 sqlite（$DSH_HOME/dispatch/），
// 到校内同事的投递走既有 Mochi 传话网络（campus relay，服务器只投递一句话、应答永远由人决定）。
// 未知投递结果绝不重发；已确认未写入的失败只能经 retryTaskId 和第二次人工确认后建立新 attempt。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CampusRequestError, campusConnection as connection } from '../mochi-campus/connection.mjs';
import { lanTaskMessageId, listLanClassrooms, localLanOwnerKey, sendLanDirective, sendLanFile, sendLanNotification } from './lan-transport.mjs';
import { TERMINAL_STATES, relayStatusToTask, deriveCardState, expiryFor, idempotencyKeyFor } from './state-machine.mjs';
import { createStore } from './store.mjs';

export const name = 'mochi-dispatch';
export const inject = ['tools'];
// ⚠️ render 签名是 (args, value)（2026-09-05 大坑 17）：单参写法会把调用参数当结果给模型。
export const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

const TYPE_LABEL = { ASK: '问询', REQUEST: '请求', FIND: '寻物', APPROVE: '应答' };
const CARD_LABEL = {
  PENDING_SEND: '待发送', RUNNING: '进行中', INPUT_REQUIRED: '待补输入',
  APPROVAL_REQUIRED: '待批准', COMPLETED: '已完成', TERMINATED: '已终止',
};
const DELIVERY_LABEL = {
  PENDING: '待确认', DELIVERED: '已确认投递', NOT_SENT: '确认未投递', UNKNOWN: '结果不明',
};
// 只有这些响应在 Worker INSERT 之前返回，因而可确认没有创建 relay 行。
// 路径、状态和 code 必须同时吻合；绝不能以 HTTP 404 或错误文案猜测。
const RELAY_PRE_INSERT_FAILURES = new Map([
  ['ASSISTANT_RELAY_INVALID', 400],
  ['ASSISTANT_RELAY_PEER_NOT_FOUND', 404],
  ['ASSISTANT_RELAY_PEER_AMBIGUOUS', 409],
]);
const RELAY_SYNC_BUDGET_MS = 2_000;

const cleanBody = (body) => String(body || '').replace(/^[^：]{1,24}的 Mochi 替主人(带话|找东西)：/, '');

function isVerifiedPreInsertRelayFailure(error) {
  return error instanceof CampusRequestError
    && error.path === '/api/assistant/relay/send'
    && RELAY_PRE_INSERT_FAILURES.get(error.code) === error.status;
}

function transportFailureCode(error) {
  return error instanceof CampusRequestError && typeof error.code === 'string'
    ? error.code
    : 'DELIVERY_UNKNOWN';
}

function parseDispatchControls(args) {
  const hasRetry = args.retryTaskId !== undefined;
  const retryTaskId = hasRetry ? Number(args.retryTaskId) : null;
  if (hasRetry && (!Number.isSafeInteger(retryTaskId) || retryTaskId <= 0)) throw new Error('retryTaskId 必须是任务列表中给出的正整数。');
  if (args.newTask !== undefined && typeof args.newTask !== 'boolean') throw new Error('newTask 必须是 true 或 false。');
  const newTask = args.newTask === true;
  if (hasRetry && newTask) throw new Error('retryTaskId 与 newTask 不能同时使用。');
  return { retryTaskId, newTask };
}

function sameLanIdentity(left, right) {
  return left?.endpointId === right?.endpointId
    && left?.role === right?.role
    && left?.schoolId === right?.schoolId
    && left?.classId === right?.classId
    && left?.displayName === right?.displayName
    && left?.fingerprint === right?.fingerprint;
}

export function apply(ctx, connectionArg = connection, storeArg = null) {
  const store = storeArg || createStore();
  const send = connectionArg;
  // 同一会话内的相同调用共享一次审批和投递；数据库事务仍负责跨会话并发。
  const attempts = new WeakMap();
  const register = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({ name: toolName, description, parameters, output, execute }));
  const memo = (binding, key, run) => {
    let memoized = attempts.get(binding.session);
    if (!memoized) attempts.set(binding.session, (memoized = new Map()));
    if (memoized.has(key)) return memoized.get(key);
    // 只合并尚在执行中的同一次调用。成功结果不能永久缓存：newTask 是主人明确
    // 要创建下一件独立工作，完成后的再次调用必须重新审批并交给持久化层判重。
    const promise = Promise.resolve().then(run);
    memoized.set(key, promise);
    promise.then(
      () => { if (memoized.get(key) === promise) memoized.delete(key); },
      () => { if (memoized.get(key) === promise) memoized.delete(key); },
    );
    return promise;
  };
  const requireApproval = () => {
    const approval = ctx.get?.('approval');
    if (!approval) throw new Error('【未派发】当前会话没有人工确认通道，任务没有派出去。请如实告知主人，不要说成已发送。');
    return approval;
  };
  let lanToolsRegistered = false;
  let lanService = null;
  // `mochiLan` is a trusted in-process service, but the tool itself is only
  // registered when that service exists. There is deliberately no Connection
  // HTTP send route: every model-originated classroom notification must pass
  // this existing approval waterfall first.
  ctx.inject?.(['mochiLan'], (hostCtx) => {
    if (lanToolsRegistered) return;
    const lan = hostCtx.get?.('mochiLan') ?? hostCtx.mochiLan;
    if (!lan) return;
    lanService = lan;
    lanToolsRegistered = true;
    register('mochi_list_classrooms', '查看本机局域网的教室名册：已人工配对教室与仅发现的附近候选分开返回。只有 paired=true 的精确 endpointId 才可用于 mochi_notify_classroom；候选、同名设备和未配对设备都不能自动选择、配对或发送。已配对设备即使当前未发现，也可由已知地址经人工确认发送。online 只是当前发现信标有效，不代表确定在线。此工具只读，不触发配对或外发。', {}, async () => listLanClassrooms(lan));
    register('mochi_notify_classroom', '向已人工配对、同校指定班级的教室端发送一条通知。只能由已配置教师端使用：先展示学校、班级、设备指纹和正文，主人确认后才走签名局域网投递；教室端收到后由人点击“已看到”回执。不能用它改身份、配对或重发结果不明的旧通知。', {
      classroomEndpointId: { type: 'string', required: true, description: '教室端 endpointId，必须来自本机已配对教室列表，不能猜测。' },
      message: { type: 'string', required: true, description: '发送给教室的纯文本通知；投递前会显示精确学校、班级、设备和正文以供主人确认。' },
      retryTaskId: { type: 'integer', description: '仅重试已明确未投递的同内容通知；结果不明通知不能重发。' },
      newTask: { type: 'boolean', description: '主人明确要把同一内容作为独立通知发送；结果不明通知不能绕过。' },
    }, async (args, exec) => sendLanNotification({ lan, approval: requireApproval(), args, exec, store }));
    register('mochi_send_classroom_file', '向已人工配对、同校指定班级的教室端发送已生成的 PPTX、DOCX、XLSX、PDF 或图片。必须给出受管导出目录内的绝对 sourcePath；先展示精确学校、班级、设备指纹、文件路径和正文，主人确认后才分块签名传输。接收端校验文件哈希后才收到引用该 fileId 的通知，不能自动执行文件。', {
      classroomEndpointId: { type: 'string', required: true, description: '教室端 endpointId，必须来自已配对教室列表。' },
      sourcePath: { type: 'string', required: true, description: '已生成课件的绝对路径；仅受管导出目录内的白名单文件可发送。' },
      message: { type: 'string', required: true, description: '教室端显示的纯文本说明。' },
      retryTaskId: { type: 'integer', description: '仅重试已明确未投递的同一文件任务；结果不明任务不能重发。' },
      newTask: { type: 'boolean', description: '主人明确要把同一文件作为独立任务再次发送；结果不明任务不能绕过。' },
    }, async (args, exec) => sendLanFile({ lan, approval: requireApproval(), args, exec, store }));
    // 处置名册（喊人 / 过关 / 不过关）。刻意没有任何 HTTP 路由能到达它：名册是模型
    // 调 skill 生成后发起的对外动作，必须在这个审批闸后面，与学生预约那条直连路由
    // 是两类东西。
    register('mochi_register_verdicts', '把一次听写/作业/提问的处置结果（喊人、过关、不过关、需补做）作为一份名册下发到已人工配对、同校指定班级的教室端；教室屏的常驻板和弹窗会按学生逐行显示。逐人的「个性化交代」必须先调对应 skill 为这一位学生生成（该补什么、错在哪、下一步找谁），再连同判决一起登记——只发一个「不过关」标签等于给学生一个没有出路的结论，本工具会直接拒绝这种调用。一次登记只调用一次本工具（一份名册），不要一位学生一次。先展示学校、班级、设备指纹和完整名册，主人确认后才走签名局域网投递。', {
      classroomEndpointId: { type: 'string', required: true, description: '教室端 endpointId，必须来自本机已配对教室列表，不能猜测。' },
      item: { type: 'string', required: true, description: '这次登记的名目，例如「第 5 单元听写」；会作为教室板上每一行的小标题。' },
      verdicts: {
        type: 'array',
        required: true,
        description: '逐人的处置结果。一次登记一份名册，不要一位学生调用一次；同一人不得出现两次。',
        items: {
          type: 'object',
          properties: {
            student: { type: 'string', required: true, description: '学生姓名。' },
            seat: { type: 'integer', description: '座号，可选（1-999）；有座号时教室板上排序更稳。' },
            action: { type: 'string', required: true, description: 'call=喊人 / pass=过关 / fail=不过关 / retry=需补做，只能取这四个值之一。' },
            note: { type: 'string', description: '这一位学生的个性化交代（≤200 字，不能含换行）。pass/fail/retry 必填，且必须是调 skill 生成、针对这一位学生的内容，不能是通用套话。' },
          },
          additionalProperties: false,
        },
      },
      message: { type: 'string', description: '可选：整批说明。省略时按名目与人数自动生成。' },
      retryTaskId: { type: 'integer', description: '仅重试已明确未投递的同一份名册；结果不明任务不能重发。' },
      newTask: { type: 'boolean', description: '主人明确要把同一份名册作为独立登记再次下发；结果不明任务不能绕过。' },
    }, async (args, exec) => sendLanDirective({ lan, approval: requireApproval(), args, exec, store }));
  });

  // ── 与 Relay 的同步：出站任务按 relay 状态迁移；入站 relay 镜像为本地任务 ──
  async function syncWithRelay(binding, exec) {
    const { result } = await send.request('/api/assistant/relay', exec, { method: 'POST', body: {} });
    const relay = result ?? {};
    const outgoing = Array.isArray(relay.outgoing) ? relay.outgoing : [];
    const incoming = Array.isArray(relay.incoming) ? relay.incoming : [];
    for (const message of outgoing) {
      const task = store.getTaskByRelayMessage(message.id, binding.user.id);
      if (!task || TERMINAL_STATES.has(task.status)) continue;
      const next = relayStatusToTask(message.status);
      if (next && next !== task.status) {
        try { store.transition(task.id, next, { resultAnswer: message.reply || '' }); } catch { /* 下一次同步会再次核对。 */ }
      }
    }
    for (const message of incoming) {
      // Relay 列表不返回收件账号 ID；此行来自当前已认证账号的 incoming 视图，
      // 因而把该稳定账号 ID 写为 owner，并把它纳入镜像幂等键，不能用显示名隔离。
      const key = `relay-in:${binding.user.id}:${message.id}`;
      const existing = store.getTaskByIdempotencyKey(key);
      if (existing) {
        // respond 的远端条件更新与本地 SQLite 迁移无法组成一个事务。若 Relay 已
        // 接受应答、但本地写入失败或进程在两者之间退出，下一次列表同步必须用
        // Relay 的持久化事实修复入站镜像；否则它会永久显示“待回应”，再次点击
        // 只会得到远端 409。终态仍由状态机保护，不会倒退或重复完成。
        if (!TERMINAL_STATES.has(existing.status)) {
          const next = relayStatusToTask(message.status);
          if (next && next !== existing.status) {
            try { store.transition(existing.id, next, { resultAnswer: message.reply || '' }); } catch { /* 下一次同步会再次核对。 */ }
          }
        }
        continue;
      }
      const taskType = message.kind === 'request' ? 'FIND' : 'ASK';
      const mirrored = store.mirrorInboundTask({
        ownerUserId: binding.user.id, taskType, peerId: 0, peerName: message.peerName, peerRole: message.peerRole,
        toPeerName: binding.user.name, toPeerRole: binding.user.role || '',
        goal: cleanBody(message.body).slice(0, 200), relayMessageId: message.id, idempotencyKey: key,
        createdAt: message.createdAt ? new Date(message.createdAt.replace(' ', 'T') + 'Z').toISOString() : undefined,
        expiredAt: expiryFor(taskType, message.createdAt ? new Date(message.createdAt.replace(' ', 'T') + 'Z') : new Date()),
      });
      // 冷启动时第一次看到的 relay 可能早已被其它会话回应。镜像创建后在
      // 同一次同步中采用该持久化事实，不能先向用户暴露一个虚假的待回应状态。
      const next = relayStatusToTask(message.status);
      if (next && next !== mirrored.status) {
        try { store.transition(mirrored.id, next, { resultAnswer: message.reply || '' }); } catch { /* 下一次同步会再次核对。 */ }
      }
    }
    return { outgoing, incoming };
  }

  async function syncWithRelayBudget(binding, exec) {
    const budgetSignal = AbortSignal.timeout(RELAY_SYNC_BUDGET_MS);
    const relayExec = {
      ...(exec || {}),
      signal: exec?.signal ? AbortSignal.any([exec.signal, budgetSignal]) : budgetSignal,
    };
    try {
      await syncWithRelay(binding, relayExec);
      return { status: 'synchronized' };
    } catch (error) {
      const reason = String(error?.message || error).slice(0, 140);
      const status = budgetSignal.aborted ? 'timed-out' : 'failed';
      console.log('[mochi-dispatch] relay 同步未完成（保留本地任务事实）：', reason);
      return { status, reason };
    }
  }

  function syncLanSeenReceipts(lan, localOwnerKey, tasks) {
    if (!lan || !localOwnerKey || !Array.isArray(tasks)) return tasks;
    const snapshot = lan.snapshot?.();
    const outbox = new Map((Array.isArray(snapshot?.outbox) ? snapshot.outbox : [])
      .filter((row) => typeof row?.messageId === 'string')
      .map((row) => [row.messageId, row]));
    const receipts = new Map((Array.isArray(snapshot?.receipts) ? snapshot.receipts : [])
      .filter((row) => typeof row?.messageId === 'string' && typeof row?.seenAt === 'string')
      .map((row) => [row.messageId, row]));
    for (const task of tasks) {
      if (task.transport !== 'lan') continue;
      const messageId = lanTaskMessageId(task);
      const outgoing = outbox.get(messageId);
      const receipt = receipts.get(messageId);
      // `receipts` are created only after MochiLanService verifies the signed
      // classroom receipt.  Still bind it to the signed outbox peer here so a
      // same message ID cannot project a different classroom's receipt.
      const acknowledgedDelivery = ['DELIVERED', 'COMPLETED'].includes(task.status)
        && outgoing?.delivery === 'ACKNOWLEDGED';
      // A delivery ACK can be lost after the classroom has durably received
      // the message.  A later signed human-seen receipt is stronger evidence
      // of delivery than that missing ACK, but it may recover only this exact
      // still-active UNKNOWN attempt.  It never retries or revives a failed,
      // expired, unrelated, or explicitly NOT_SENT task.
      const lateSeenRecovery = task.status === 'DISPATCHING'
        && task.delivery_outcome === 'UNKNOWN'
        && ['UNKNOWN', 'ACKNOWLEDGED'].includes(outgoing?.delivery);
      if ((!acknowledgedDelivery && !lateSeenRecovery) || !outgoing.peer || !receipt?.from
        || !sameLanIdentity(outgoing.peer, receipt.from)) continue;
      const fileNotice = Boolean(outgoing.attachment?.fileId);
      const note = fileNotice
        ? '教室端已看到文件通知（文件已验证可用；不代表已打开、展示或执行）。'
        : '教室端已看到通知。';
      let current = task;
      if (lateSeenRecovery) {
        try {
          current = store.transition(task.id, 'DELIVERED', {
            deliveryOutcome: 'DELIVERED',
            resultAnswer: note,
          }).task;
        } catch {
          current = store.getTask(task.id) || task;
        }
      }
      if (!fileNotice && current.status === 'DELIVERED') {
        try {
          current = store.transition(task.id, 'COMPLETED', {
            deliveryOutcome: 'DELIVERED',
            resultAnswer: note,
          }).task;
        } catch {
          current = store.getTask(task.id) || task;
        }
      }
      if (!['DELIVERED', 'COMPLETED'].includes(current.status)) continue;
      store.recordLanReceipt({
        taskId: current.id,
        localOwnerKey,
        seenAt: receipt.seenAt,
        resultAnswer: note,
      });
    }
    return store.listTasksByLanOwner(localOwnerKey);
  }

  const taskBrief = (task) => ({
    taskId: task.id,
    taskType: task.task_type,
    status: task.status,
    任务类型: TYPE_LABEL[task.task_type] || task.task_type,
    方向: task.transport === 'lan' || task.from_user_id ? `发给「${task.to_peer_name}」` : `来自「${task.from_user_name}」`,
    目标: task.goal,
    状态: task.status,
    ...(task.transport ? { transport: task.transport } : {}),
    任务卡: `${CARD_LABEL[deriveCardState(task.status)]}（${deriveCardState(task.status)}）`,
    ...(task.correlation_id ? { correlationId: task.correlation_id } : {}),
    ...(Number.isSafeInteger(Number(task.attempt_no)) && Number(task.attempt_no) > 0 ? { attemptNo: Number(task.attempt_no) } : {}),
    ...(task.retry_of_task_id ? { retryOfTaskId: task.retry_of_task_id } : {}),
    ...(task.delivery_outcome ? { 投递结果: DELIVERY_LABEL[task.delivery_outcome] || task.delivery_outcome } : {}),
    ...(task.receipt_seen_at ? { 教室已看到: task.receipt_seen_at } : {}),
    ...(task.failure_code ? { failureCode: task.failure_code } : {}),
    ...(task.result_answer ? { 回话: task.result_answer } : {}),
    ...(task.relay_message_id ? { relayMessageId: task.relay_message_id } : {}),
  });

  function existingDispatchResult(task) {
    const result = { taskId: task.id, 重复投递已拦截: true, ...taskBrief(task) };
    if (task.status === 'FAILED' && task.delivery_outcome === 'NOT_SENT') {
      result.需明确重试 = true;
      result.retryTaskId = task.id;
      result.说明 = '校园服务已明确拒绝且未写入。若主人仍要重试，请带 retryTaskId 再次调用，系统会再次请求确认。';
    } else if (task.delivery_outcome === 'UNKNOWN') {
      result.说明 = '这件任务的投递结果不明，不能用重试或 newTask 再次发送；请先到校园页面核对。';
    }
    return result;
  }

  async function dispatchRelayTask({ taskType, binding, exec, peerName, goal, fingerprintGoal = goal, context = '', transportBody, approvalText, controls }) {
    const requestFingerprint = idempotencyKeyFor({
      tool: taskType, userId: binding.user.id, peerName, goal: fingerprintGoal, context,
    });
    const mode = controls.retryTaskId !== null ? 'retry' : controls.newTask ? 'new' : 'default';
    const state = store.getDispatchState({ ownerUserId: binding.user.id, requestFingerprint, taskType, peerName });
    if (mode === 'retry') {
      const retry = store.preflightRetry({
        ownerUserId: binding.user.id, taskId: controls.retryTaskId, taskType, requestFingerprint,
      });
      if (retry.reused) return existingDispatchResult(retry.task);
    } else if (state.blocking || (mode === 'default' && state.latest)) {
      return existingDispatchResult(state.blocking || state.latest);
    }

    const approval = requireApproval();
    const memoKey = `${requestFingerprint}:${mode}:${controls.retryTaskId || ''}`;
    return memo(binding, memoKey, async () => {
      const action = mode === 'retry'
        ? `重新投递任务 #${controls.retryTaskId}（这是新的一次实际投递）`
        : mode === 'new'
          ? '新建一件独立任务（与已有同文案任务分开记录）'
          : `派一个${TYPE_LABEL[taskType]}任务`;
      const decision = await approval.request({
        agent: exec.agent, toolName: `mochi.${taskType.toLowerCase()}`, callId: exec.callId, signal: exec.signal,
        reason: `以 ${binding.user.name} 的 Mochi 名义，给「${peerName}」的 Mochi ${action}：\n\n${approvalText}${context ? `\n\n背景：${context}` : ''}\n\n（服务器只投递这一句话；对方答不答应由对方决定。）`,
      });
      if (decision !== 'allowed-once') throw new Error('【未派发】任务没有发出去：主人未确认。请如实告知，不要说成已发送。');

      // 第二次检查在事务内完成：并行批准只会留下一个 attempt，后来者不会重复发送。
      const created = store.createDispatchAttempt({
        mode, retryTaskId: controls.retryTaskId,
        ownerUserId: binding.user.id, taskType, fromUserId: binding.user.id, fromUserName: binding.user.name,
        toPeerName: peerName, goal, context, requestFingerprint, expiredAt: expiryFor(taskType),
      });
      if (created.reused) return existingDispatchResult(created.task);
      const task = created.task;
      // 在调用远端前先把本地事实标为 UNKNOWN。若进程在写入已发生但回执尚未落盘时中断，
      // 重启、过期扫描和 newTask 都会保守阻断，不能把可能已发送的任务再发一次。
      store.transition(task.id, 'DISPATCHING', { deliveryOutcome: 'UNKNOWN' });
      try {
        const response = await send.request('/api/assistant/relay/send', exec, {
          method: 'POST', body: transportBody, expectedUserId: binding.user.id,
        });
        const relayMessageId = response.result?.relayMessageId;
        if (typeof relayMessageId !== 'number' || !Number.isSafeInteger(relayMessageId) || relayMessageId <= 0) {
          throw new Error('RELAY_CORRELATION_UNKNOWN: send response did not include a verifiable relay message ID');
        }
        const { task: delivered } = store.transition(task.id, 'DELIVERED', { relayMessageId, deliveryOutcome: 'DELIVERED' });
        return {
          taskId: delivered.id, peer: response.result?.peer ?? { name: peerName }, transport: 'relay', relayMessageId,
          ...taskBrief(delivered),
        };
      } catch (error) {
        const message = String(error?.message || error);
        if (isVerifiedPreInsertRelayFailure(error)) {
          let failed = null;
          try {
            failed = store.transition(task.id, 'FAILED', {
              resultAnswer: message.slice(0, 200), deliveryOutcome: 'NOT_SENT', failureCode: error.code,
            }).task;
          } catch { failed = store.getTask(task.id); }
          if (failed?.status === 'FAILED' && failed.delivery_outcome === 'NOT_SENT') {
            throw new Error(`【未投递】任务 #${task.id} 被校园服务明确拒绝（${error.code}），尚未写入。若主人仍要重试，请显式传入 retryTaskId: ${task.id} 并再次确认。`);
          }
        }
        // 路由缺失、网络失败、JSON 解析失败、503 和无关联 ID 都可能发生在远端写入之后。
        // 只留本地 UNKNOWN 事实，绝不基于报错字符串或 HTTP 状态再次发送。
        const unresolved = store.recordDeliveryOutcome(task.id, {
          outcome: 'UNKNOWN', failureCode: transportFailureCode(error), resultAnswer: message.slice(0, 200),
        });
        throw new Error(`【结果不明】任务 #${task.id} 已创建但投递结果不确定（${message.slice(0, 160)}）。不会自动重发；请让主人先到校园页面核对${unresolved?.status === 'DISPATCHING' ? '。' : '后再查看任务状态。'}`);
      }
    });
  }

  // ASK / REQUEST 共用：审批 → 建 attempt → relay 投递 → DELIVERED
  const dispatchTextTask = (taskType, prefix) => async (args, exec) => {
    const goal = String(args.goal || '').trim();
    const peerName = String(args.peerName || '').trim();
    const context = String(args.context || '').trim().slice(0, 200);
    const controls = parseDispatchControls(args);
    if (!peerName) throw new Error('请确认要把这件事托给哪位同事（姓名或称呼）。');
    if (!goal) throw new Error(`请说明${TYPE_LABEL[taskType]}的目标（一句话，≤110 字）。`);
    if (goal.length > 110) throw new Error(`${TYPE_LABEL[taskType]}目标请压缩到 110 字内。`);
    const binding = await send.binding(exec);
    return dispatchRelayTask({
      taskType, binding, exec, peerName, goal, context, controls,
      transportBody: { peerName, kind: 'message', note: `${prefix}${goal}`.slice(0, 120) },
      approvalText: goal,
    });
  };

  register('mochi_ask', '以 Mochi 任务的方式替主人向本校同事问一句话、等对方回话（例如换课、借物、约时间——主人说“帮我问某某能不能…”就用本工具）。走审批闸：先展示目标，主人确认后才投递给对方的 Mochi；对方是否答应由对方决定。', {
    peerName: { type: 'string', required: true, description: '同事姓名或称呼。' },
    goal: { type: 'string', required: true, description: '要问的目标（一句话，≤110 字），来自主人原话。' },
    context: { type: 'string', description: '可选背景说明（≤200 字）。' },
    retryTaskId: { type: 'integer', description: '仅重试这件已明确未投递的同内容任务；会再次请求主人确认。' },
    newTask: { type: 'boolean', description: '主人明确要把相同内容作为一件新任务发送；在途或结果不明的旧任务不能绕过。' },
  }, dispatchTextTask('ASK', '【问询】'));

  register('mochi_request', '替主人向本校同事的 Mochi 提出一个做事请求、等对方批准或给结果（例如“请某某帮忙留意班级设备”）。走审批闸；对方批不批由对方决定。日常“问一句话”用 mochi_ask，找东西用 mochi_find。', {
    peerName: { type: 'string', required: true, description: '同事姓名或称呼。' },
    goal: { type: 'string', required: true, description: '请求的目标（一句话，≤110 字）。' },
    context: { type: 'string', description: '可选背景说明（≤200 字）。' },
    retryTaskId: { type: 'integer', description: '仅重试这件已明确未投递的同内容任务；会再次请求主人确认。' },
    newTask: { type: 'boolean', description: '主人明确要把相同内容作为一件新任务发送；在途或结果不明的旧任务不能绕过。' },
  }, dispatchTextTask('REQUEST', '【请求】'));

  register('mochi_find', '替主人找一件东西：先在全校共享登记里实查；登记里没有时，经主人确认后把寻物任务派给指定同事的 Mochi（对方在其主人授权范围内找，找到也不自动给，由对方主人决定）。主人说“帮我找某物”就用本工具。', {
    item: { type: 'string', required: true, description: '要找的东西名（≤64 字）。' },
    peerName: { type: 'string', description: '登记未命中时要委托的同事；省略且未命中时返回提示。' },
    retryTaskId: { type: 'integer', description: '仅重试这件已明确未投递的同物品委托；会再次请求主人确认。' },
    newTask: { type: 'boolean', description: '主人明确要把同物品作为一件新寻物任务发送；在途或结果不明的旧任务不能绕过。' },
  }, async (args, exec) => {
    const item = String(args.item || '').trim().slice(0, 64);
    const controls = parseDispatchControls(args);
    if (!item) throw new Error('请说明要找的东西名。');
    const binding = await send.binding(exec);
    const lookup = await send.request('/api/assistant/relay/find', exec, { method: 'POST', body: { item } });
    const hits = Array.isArray(lookup.result?.hits) ? lookup.result.hits : [];
    if (hits.length > 0) {
      return { source: 'campus-api', 登记命中: true, item, hits: hits.slice(0, 10), 说明: '在共享登记里找到了；是否取用仍由持有者决定。' };
    }
    const peerName = String(args.peerName || '').trim();
    if (!peerName) return { source: 'campus-api', 登记命中: false, item, 说明: '共享登记里没有。告诉我要委托哪位同事的 Mochi 去找，我会先给你确认。' };
    return dispatchRelayTask({
      taskType: 'FIND', binding, exec, peerName, goal: `找「${item}」`, fingerprintGoal: item, context: '', controls,
      transportBody: { peerName, kind: 'request', item },
      approvalText: `共享登记里没有「${item}」。帮主人的班级找「${item}」`,
    });
  });

  register('mochi_respond', '替主人回应一个收到的 Mochi 任务（别人托给我们的事）：approve=答应 / decline=婉拒，可附 120 字内回话。是否答应由主人决定——必须先念出任务内容与拟定回话，获人工确认后才提交。', {
    taskId: { type: 'integer', required: true, description: '任务 ID（来自 mochi_tasks 的“来自”方向任务，不得猜测）。' },
    decision: { type: 'string', enum: ['approve', 'decline'], required: true },
    note: { type: 'string', description: '附带回话（≤120 字）。' },
  }, async (args, exec) => {
    const taskId = Math.floor(args.taskId);
    const decision = args.decision === 'decline' ? 'decline' : 'approve';
    const note = String(args.note || '').trim().slice(0, 120);
    if (!taskId) throw new Error('请从任务列表里确认要回应的那条（ID 不得猜测）。');
    const task = store.getTask(taskId);
    if (!task) throw new Error(`任务 #${taskId} 不存在。`);
    const binding = await send.binding(exec);
    if (task.owner_user_id !== Number(binding.user.id)) throw new Error(`任务 #${taskId} 不属于当前校园账号，无法回应。`);
    if (!String(task.idempotency_key || '').startsWith('relay-in:')) throw new Error(`任务 #${taskId} 不是收到来的任务，无法由我方回应。`);
    if (TERMINAL_STATES.has(task.status)) throw new Error(`任务 #${taskId} 已终态（${task.status}），不能再回应。`);
    const approval = requireApproval();
    return memo(binding, `respond:${taskId}:${decision}:${note}`, async () => {
      const ok = await approval.request({ agent: exec.agent, toolName: 'mochi_respond', callId: exec.callId, signal: exec.signal,
        reason: `以 ${binding.user.name} 的名义${decision === 'approve' ? '答应' : '婉拒'}任务 #${taskId}（来自「${task.from_user_name}」：${task.goal}）${note ? `，并回话：\n\n${note}` : ''}\n\n（应答以这条确认卡为准——主人确认即是决定。）`,
      });
      if (ok !== 'allowed-once') throw new Error('【未回应】任务没有被回应：主人未确认。请如实告知，不要谎称已回应。');
      const body = note ? { id: task.relay_message_id, action: decision === 'approve' ? 'accept' : 'decline', note } : { id: task.relay_message_id, action: decision === 'approve' ? 'accept' : 'decline' };
      const response = await send.request('/api/assistant/relay/respond', exec, { method: 'POST', body, expectedUserId: binding.user.id });
      const serverStatus = response.result?.status;
      const next = decision === 'approve' ? 'COMPLETED' : 'DECLINED';
      const { task: done } = store.transition(taskId, next, { resultAnswer: note || (serverStatus === 'accepted' ? '已答应' : '已婉拒') });
      return { taskId: done.id, ...taskBrief(done) };
    });
  });

  register('mochi_tasks', '查看主人的 Mochi 任务清单：校园 relay 任务和本机已受管 LAN 教室任务分开显示。没有校园账号时仍可只读查看本机 LAN 任务；未绑定的来源会明确标为不可用，不能据此认领别人的任务。', {}, async (_args, exec) => {
    store.expireScan();
    let binding = null;
    let campusUnavailable = null;
    let campusRelaySync = null;
    try {
      binding = await send.binding(exec);
      campusRelaySync = await syncWithRelayBudget(binding, exec);
    } catch (error) {
      campusUnavailable = String(error?.message || error).slice(0, 140);
    }
    const campusTasks = binding ? store.listTasksByUser(binding.user.id) : [];
    const lanOwner = localLanOwnerKey(lanService);
    const lanTasks = lanOwner ? syncLanSeenReceipts(lanService, lanOwner, store.listTasksByLanOwner(lanOwner)) : [];
    const inboundPending = campusTasks.filter((task) => String(task.idempotency_key || '').startsWith('relay-in:') && task.status === 'DELIVERED');
    const relayOutbound = binding ? campusTasks.filter((task) => task.from_user_id === binding.user.id) : [];
    const inbound = binding ? campusTasks.filter((task) => task.from_user_id !== binding.user.id) : [];
    const outbound = [...lanTasks, ...relayOutbound].sort((left, right) => right.id - left.id);
    const all = [...campusTasks, ...lanTasks];
    const summary = inboundPending.length > 0
      ? '有 ' + inboundPending.length + ' 个别人托给主人的校园任务等你决定。'
      : outbound.some((task) => task.status === 'DELIVERED')
        ? '没有等你决定的任务；已派出的 ' + outbound.filter((task) => task.status === 'DELIVERED').length + ' 个任务还在等对方回音。'
        : all.length === 0 ? '当前可绑定的任务清单是空的。' : '没有等你决定的任务。';
    return {
      source: 'mochi-dispatch',
      摘要: summary,
      campus: binding
        ? { available: true, userId: binding.user.id, relaySync: campusRelaySync || { status: 'not-attempted' } }
        : { available: false, reason: campusUnavailable || '当前没有可用校园账号绑定；本机 LAN 任务仍可只读查看。' },
      lan: lanOwner
        ? { available: true, owner: lanOwner }
        : { available: false, reason: '本机 LAN 身份尚未启动或配置，无法查询局域网任务。' },
      等我回应: inboundPending.map(taskBrief),
      已派出的任务: outbound.map(taskBrief),
      收到的任务: inbound.map(taskBrief),
    };
  });

  console.log(`[mochi-dispatch] 任务域就绪：mochi_tasks @ ${store.db.name ?? 'sqlite'}`);
}
