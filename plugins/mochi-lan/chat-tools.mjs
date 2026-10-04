import { isIP } from 'node:net';
import { defineTool } from '@deepseek-ai/dsh-tools';

const PAIRING_CODE_WAIT_MS = 30_000;

const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

const visibleTools = {
  teacher: new Set([
    'mochi_lan_status', 'mochi_lan_configure_identity', 'mochi_lan_pending_requests',
    'mochi_lan_reply_student_request', 'mochi_lan_probe_classroom', 'mochi_lan_pair_classroom',
  ]),
  classroom: new Set([
    'mochi_lan_status', 'mochi_lan_configure_identity',
    'mochi_lan_send_student_request', 'mochi_lan_decide_pairing',
    'mochi_lan_received_presentations', 'mochi_lan_open_presentation',
  ]),
};

function text(value, label, maximum = 120) {
  if (typeof value !== 'string') throw new Error(`${label} 必须填写。`);
  const clean = value.normalize('NFC').trim();
  if (!clean || clean.length > maximum || /[\u0000-\u001f\u007f]/u.test(clean)) throw new Error(`${label} 无效。`);
  return clean;
}

function optionalText(value, label) {
  return value === undefined ? undefined : text(value, label);
}

function identity(row) {
  if (!row) return null;
  return {
    endpointId: row.endpointId,
    role: row.role,
    schoolId: row.schoolId,
    ...(row.classId === undefined ? {} : { classId: row.classId }),
    displayName: row.displayName,
    fingerprint: row.fingerprint,
  };
}

function sameIdentity(left, right) {
  return JSON.stringify(identity(left)) === JSON.stringify(identity(right));
}

function stateFor(lan, role) {
  const state = lan.snapshot();
  if (!state.started || !state.identity || state.identity.role !== role || (state.lockedRole && state.lockedRole !== role)) {
    throw new Error(role === 'teacher' ? '仅已配置的教师端可使用这项能力。' : '仅已配置的教室端可使用这项能力。');
  }
  return state;
}

function identitySetupState(lan) {
  const state = lan.snapshot();
  if (!state.started || !['teacher', 'classroom'].includes(state.lockedRole)) {
    throw new Error('本机尚未由宿主锁定教师或教室角色，不能从对话中设置角色。');
  }
  if (state.identity && state.identity.role !== state.lockedRole) throw new Error('本机现有身份与启动角色不一致，请先由管理员检查。');
  return state;
}

function identityFields(row) {
  return row ? { schoolId: row.schoolId, ...(row.classId === undefined ? {} : { classId: row.classId }), displayName: row.displayName } : null;
}

function identityDescription(role, fields) {
  return `${role === 'teacher' ? '教师端' : '教室端'}；学校 ${fields.schoolId}${fields.classId ? `；班级 ${fields.classId}` : ''}；设备名 ${fields.displayName}`;
}

function pairedPeer(state, endpointId, role) {
  const id = text(endpointId, '目标设备 ID', 80);
  const peer = state.peers.find((row) => row.endpointId === id && row.role === role
    && row.schoolId === state.identity.schoolId && !row.blocked);
  if (!peer) throw new Error('目标不是当前身份下可用的已配对设备；请先核对配对状态。');
  return peer;
}

function safePeer(row) {
  return { ...identity(row), online: Boolean(row.online), blocked: Boolean(row.blocked) };
}

function approval(ctx) {
  const service = ctx.get?.('approval');
  if (!service || typeof service.request !== 'function') throw new Error('当前对话没有人工确认通道，未执行外发动作。');
  return service;
}

async function approve(ctx, exec, toolName, reason) {
  const decision = await approval(ctx).request({ agent: exec.agent, toolName, callId: exec.callId, signal: exec.signal, reason });
  if (decision !== 'allowed-once') throw new Error('用户未确认，未执行外发动作。');
}

function verifyAfterApproval(lan, role, beforeIdentity, beforePeer) {
  const current = stateFor(lan, role);
  if (!sameIdentity(current.identity, beforeIdentity)) throw new Error('确认期间本机身份已变化，请重新核对。');
  if (beforePeer) {
    const currentPeer = pairedPeer(current, beforePeer.endpointId, beforePeer.role);
    if (!sameIdentity(currentPeer, beforePeer)) throw new Error('确认期间配对设备身份已变化，请重新核对。');
  }
  return current;
}

function peerLabel(peer) {
  return `${peer.displayName}（学校 ${peer.schoolId}${peer.classId ? `、班级 ${peer.classId}` : ''}；设备 ${peer.endpointId}；指纹 ${peer.fingerprint}）`;
}

function messageRecipient(peer) {
  return `${peer.displayName} · ${peer.schoolId}${peer.classId ? ` · ${peer.classId}` : ''}\n设备：${peer.endpointId}`;
}

function requestSummary(request) {
  const kind = { appointment: '预约讲题', question: '问问题', makeup: '申请补做', other: '留言' }[request.kind] ?? request.kind;
  return [
    `学生：${request.student}（自述，未核验学籍）${request.seat ? ` · ${request.seat} 号` : ''}`,
    `请求：${kind}`,
    request.slot ? `希望时间：${request.slot}` : '',
    request.material ? `材料：${request.material}` : '',
    request.position ? `题目位置：${request.position}` : '',
    request.topic ? `主题：${request.topic}` : '',
  ].filter(Boolean).join('\n');
}

function pendingRequest(state, requestedId) {
  const id = text(requestedId, '原请求 ID', 120);
  const row = state.inbox.find((item) => item.messageId === id && item.contentType === 'REQUEST');
  if (!row || !row.request || !sameIdentity(row.recipient, state.identity)) throw new Error('未找到当前教师身份下的原请求。');
  const peer = pairedPeer(state, row.from?.endpointId, 'classroom');
  if (!sameIdentity(row.from, peer)) throw new Error('原请求所属教室的配对身份已变化。');
  if (state.outbox.some((item) => item.response?.replyToMessageId === id)) throw new Error('这条请求已有回复，不能重复发送。');
  return { row, peer };
}

function requestFacts(row) {
  return JSON.stringify({ messageId: row.messageId, from: identity(row.from), recipient: identity(row.recipient), request: row.request, body: row.body });
}

function requestFields(args) {
  const kind = text(args.kind, '请求类型', 32);
  if (!['appointment', 'question', 'makeup', 'other'].includes(kind)) throw new Error('请求类型只能是 appointment、question、makeup 或 other。');
  const request = { student: text(args.student, '学生自述姓名'), kind };
  if (args.seat !== undefined) {
    if (!Number.isSafeInteger(args.seat) || args.seat < 1 || args.seat > 999) throw new Error('座号必须是 1 到 999 的整数。');
    request.seat = args.seat;
  }
  for (const [key, label] of [['material', '材料'], ['position', '题目位置'], ['topic', '主题'], ['slot', '希望时间']]) {
    const value = optionalText(args[key], label);
    if (value !== undefined) request[key] = value;
  }
  if (kind === 'appointment' && !request.slot) throw new Error('预约请求需要明确希望时间，请先向学生确认。');
  return request;
}

function responseFields(args, original) {
  const decision = text(args.decision, '回复决定', 32);
  if (original.request.kind === 'appointment') {
    if (!['confirmed', 'rescheduled'].includes(decision)) throw new Error('预约只能确认原希望时间或建议不同时间。');
    const slot = decision === 'confirmed' ? original.request.slot : text(args.slot, '建议时间');
    if (decision === 'confirmed' && args.slot !== undefined && text(args.slot, '确认时间') !== slot) throw new Error('确认预约必须使用学生原希望时间。');
    if (decision === 'rescheduled' && slot.replace(/\s+/gu, ' ') === original.request.slot.replace(/\s+/gu, ' ')) throw new Error('改期建议必须与原时间不同。');
    return { replyToMessageId: original.messageId, decision, slot };
  }
  if (decision !== 'replied' || args.slot !== undefined) throw new Error('非预约请求只能发送不带时间的文字回复。');
  return { replyToMessageId: original.messageId, decision };
}

function classroomCandidate(local, candidate) {
  if (!candidate || candidate.role !== 'classroom' || candidate.schoolId !== local.schoolId || !candidate.classId) {
    throw new Error('目标不是同校已配置班级的教室端。');
  }
  return candidate;
}

function addressFromArgs(args) {
  if (args.host === undefined && args.port === undefined) return null;
  const host = text(args.host, 'IPv4 地址', 45);
  if (isIP(host) !== 4) throw new Error('手动地址必须是 IPv4。');
  if (!Number.isSafeInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error('端口必须是 1 到 65535 的整数。');
  return { host, port: args.port };
}

async function pairingTarget(lan, state, args, signal) {
  const address = addressFromArgs(args);
  const code = args.code === undefined ? undefined : text(args.code, '六位配对码', 6);
  if (code !== undefined && !/^[0-9]{6}$/u.test(code)) throw new Error('配对码必须是六位数字。');
  const expectedId = args.classroomEndpointId === undefined ? undefined : text(args.classroomEndpointId, '教室设备 ID', 80);
  if (address) {
    const result = await lan.probeCandidate({ address, signal });
    const candidate = classroomCandidate(state.identity, result.candidate);
    if (expectedId && candidate.endpointId !== expectedId) throw new Error('手动地址返回的设备 ID 与指定教室不一致。');
    return { candidate, address: result.address, code, mode: 'manual' };
  }
  if (code !== undefined) {
    const search = await lan.waitForPairingCode(code, { signal, waitMs: PAIRING_CODE_WAIT_MS });
    const matches = search.matches.filter((row) => !expectedId || row.endpointId === expectedId);
    if (!matches.length && expectedId && search.matches.length) {
      throw new Error('短码匹配到了其他教室设备，与指定设备 ID 不一致；请核对设备 ID 或教室屏短码。');
    }
    if (matches.length > 1) throw new Error('配对码匹配多个教室，请提供精确设备 ID。');
    const unverifiedCandidateCount = search.diagnostics.unverifiedCandidateCount ?? 0;
    if (matches.length === 1 && !expectedId && unverifiedCandidateCount > 0) {
      throw new Error(`已找到一台匹配教室，但还有 ${unverifiedCandidateCount} 台同校候选未完成核查；请在聊天里补充目标教室设备 ID 后再配对，避免选错设备。`);
    }
    if (!matches.length) {
      const diagnostics = search.diagnostics;
      const status = lan.snapshot().discovery?.status;
      const discovery = status === 'DISABLED' ? '本机自动发现已关闭。' : status === 'DEGRADED' ? '本机 UDP 自动发现暂不可用。' : '';
      if (diagnostics.rateLimitedCount) throw new Error(`${discovery}部分教室已达到短码搜索限额，请稍后重试；未完成匹配前不会发起配对。`);
      if (!diagnostics.discoveredCount) {
        throw new Error(`自动搜寻后仍未发现同校教室。${discovery}六位码只查询本机已发现候选，不能跨越无路由的 VLAN；可以在聊天里补充教室 IPv4 地址与端口进行手动探测。`);
      }
      const details = [];
      if (diagnostics.codeRejectedCount) details.push(`${diagnostics.codeRejectedCount} 台教室拒绝了当前短码，可能输错或已过期`);
      if (diagnostics.unreachableCount) details.push(`${diagnostics.unreachableCount} 台发现候选暂不可达`);
      if (diagnostics.invalidCandidateCount) details.push(`${diagnostics.invalidCandidateCount} 台候选未通过身份响应核验`);
      if (unverifiedCandidateCount) details.push(`${unverifiedCandidateCount} 台候选尚未完成核查`);
      throw new Error(`${discovery}自动搜寻后仍未找到匹配教室${details.length ? `：${details.join('；')}` : ''}。请核对教室屏短码和网络可达性；短码不能跨越无路由的 VLAN。也可在聊天里补充教室 IPv4 地址与端口。`);
    }
    const found = matches[0];
    return { candidate: classroomCandidate(state.identity, found), address: found.address, code, mode: 'code' };
  }
  if (!expectedId) throw new Error('请提供六位配对码、教室设备 ID，或手动 IPv4 地址与端口。');
  const found = lan.listDiscovered().find((row) => row.endpointId === expectedId);
  if (!found) throw new Error('自动发现列表中没有指定教室；可提供手动 IPv4 地址与端口。');
  const result = await lan.probeCandidate({ address: found.address, expectedFingerprint: found.fingerprint, signal });
  return { candidate: classroomCandidate(state.identity, result.candidate), address: result.address, mode: 'discovery' };
}

function pairedCandidateStillVisible(lan, before) {
  if (before.mode === 'manual') return;
  const found = lan.listDiscovered().find((row) => row.endpointId === before.candidate.endpointId);
  if (!found || found.fingerprint !== before.candidate.fingerprint || JSON.stringify(found.address) !== JSON.stringify(before.address)) {
    throw new Error('确认期间自动发现目标已变化；请重新查找。');
  }
}

export function registerLanChatTools(ctx, lan) {
  if (!ctx?.tools?.register) throw new Error('LAN 对话工具需要 DSH tools 服务。');
  const allowed = visibleTools[lan.lockedRole] ?? new Set(['mochi_lan_status']);
  const register = (name, description, parameters, execute) => {
    if (allowed.has(name)) ctx.tools.register(defineTool({ name, description, parameters, output, execute }));
  };

  register('mochi_lan_received_presentations', '仅教室端列出当前有效配对教师发来的 PPTX 课件名称与消息 ID，不读取学生请求或教师私密文件。', {}, async () => {
    stateFor(lan, 'classroom');
    return { presentations: lan.receivedPresentations() };
  });
  register('mochi_lan_open_presentation', '在本教室电脑用 WPS 打开已接收并校验的 PPTX。messageId 必须来自课件列表，不能传本地路径或系统命令。确认卡批准后才打开。LAUNCH_REQUESTED 只代表已交给 WPS，不能声称窗口已加载。', {
    messageId: { type: 'string', required: true, description: '已接收课件列表中的 messageId。' },
  }, async (args, exec) => {
    const before = stateFor(lan, 'classroom');
    const id = text(args.messageId, '课件消息 ID', 120);
    const file = lan.receivedPresentations().find((item) => item.messageId === id);
    if (!file) throw new Error('没有找到当前教室可打开的课件。');
    await approve(ctx, exec, 'mochi_lan_open_presentation', `在本教室用 WPS 打开「${file.filename}」（来自 ${file.teacher}）。`);
    verifyAfterApproval(lan, 'classroom', before.identity);
    return lan.openReceivedPresentation({ messageId: id, authorization: lan.authorize('open-presentation', 'connection-approved') });
  });

  register('mochi_lan_status', '只读查看本机 LAN 身份、监听地址、已配对设备和自动发现状态。教室共享设备不展示历史请求、收件正文或配对短码；发现不等于信任。', {}, async () => {
    const state = lan.snapshot();
    const configured = state.started && state.identity && (!state.lockedRole || state.lockedRole === state.identity.role);
    return {
      configured: Boolean(configured),
      lockedRole: state.lockedRole,
      identity: configured ? identity(state.identity) : null,
      localAddresses: state.localAddresses,
      listenerPort: state.http?.port ?? null,
      discovery: state.discovery,
      peers: configured ? state.peers.map(safePeer) : [],
      pendingPairings: configured && state.identity.role === 'classroom'
        ? state.pendingPairings.map((row) => ({ requestId: row.requestId, peer: identity(row.peer), receivedAt: row.receivedAt })) : [],
      discovered: configured && state.identity.role === 'teacher'
        ? lan.listDiscovered().filter((row) => row.role === 'classroom' && row.schoolId === state.identity.schoolId)
          .map((row) => ({ ...identity(row), address: row.address, paired: row.paired, blocked: row.blocked, seenAt: row.seenAt })) : [],
    };
  });

  register('mochi_lan_configure_identity', '通过当前对话为本机设置教师或教室 LAN 身份。角色只能取宿主已锁定的角色，不能由聊天改变；请先收齐学校标识、设备名和教室班级标识。写入前必须显示真实确认卡；改变已有身份会清除配对、待配对和拉黑状态。不会更改模型 Key 或启动角色。', {
    schoolId: { type: 'string', required: true, description: '本机真实学校标识；不能猜测。' },
    displayName: { type: 'string', required: true, description: '本机设备显示名称。' },
    classId: { type: 'string', description: '教室端必填的真实班级标识；教师端可选。' },
  }, async (args, exec) => {
    const state = identitySetupState(lan);
    const fields = {
      schoolId: text(args.schoolId, '学校标识'),
      ...(args.classId === undefined ? {} : { classId: text(args.classId, '班级标识') }),
      displayName: text(args.displayName, '设备名称', 80),
    };
    if (state.lockedRole === 'classroom' && !fields.classId) throw new Error('教室端必须填写班级标识，请先向用户确认。');
    const changed = Boolean(state.identity && JSON.stringify(identityFields(state.identity)) !== JSON.stringify(fields));
    const previous = state.identity ? identityDescription(state.lockedRole, identityFields(state.identity)) : '尚未配置';
    await approve(ctx, exec, 'mochi_lan_configure_identity', `本机将设置局域网身份。\n启动角色：${state.lockedRole === 'teacher' ? '教师端' : '教室端'}（由宿主锁定，聊天不能更改）\n原身份：${previous}\n新身份：${identityDescription(state.lockedRole, fields)}\n${changed ? '警告：改变现有身份将清空已配对设备、待配对请求与拉黑状态；原有历史记录不会自动变成新身份的记录。' : '首次配置或现有身份字段不变。'}`);
    const current = identitySetupState(lan);
    if (current.lockedRole !== state.lockedRole || !sameIdentity(current.identity, state.identity)) {
      throw new Error('确认期间本机角色或身份已变化，请重新核对。');
    }
    const result = await lan.configureIdentity(fields, { authorization: lan.authorize('configure-identity', 'dispatch-approved') });
    return { configured: Boolean(result.identity), identity: identity(result.identity), pairingsCleared: changed };
  });

  register('mochi_lan_pending_requests', '仅教师读取当前身份和有效配对下尚未回复的学生请求原文与 ID。学生姓名是教室设备上的自述，不是学籍认证。教室端不能读取历史收件。', {}, async () => {
    const state = stateFor(lan, 'teacher');
    return { requests: state.inbox.filter((row) => row.contentType === 'REQUEST').flatMap((row) => {
      try {
        const active = pendingRequest(state, row.messageId);
        return [{ messageId: row.messageId, classroom: identity(active.peer), body: row.body, request: row.request, receivedAt: row.receivedAt }];
      } catch { return []; }
    }) };
  });

  register('mochi_lan_send_student_request', '教室共享设备上由学生本人向已配对教师发送请求、留言或预约。先收齐学生自述姓名、类型、完整正文；预约还须明确希望时间。发送前显示教师名称、学校、设备标识和全文；指纹在配对时核对，必须由现场用户确认；不得自动发送或认定学生姓名已经学籍认证。', {
    teacherEndpointId: { type: 'string', required: true, description: '已配对教师的精确设备 ID，来自 mochi_lan_status。' },
    student: { type: 'string', required: true, description: '当前学生自述姓名，不是认证学籍。' },
    kind: { type: 'string', required: true, enum: ['appointment', 'question', 'makeup', 'other'], description: '请求类型。' },
    body: { type: 'string', required: true, description: '发送给教师的完整原话；缺失时先向学生询问。' },
    seat: { type: 'integer', description: '可选座号 1 到 999。' },
    material: { type: 'string', description: '可选作业或教材。' },
    position: { type: 'string', description: '可选题目位置。' },
    topic: { type: 'string', description: '可选主题。' },
    slot: { type: 'string', description: '预约希望时间；appointment 必填。' },
  }, async (args, exec) => {
    const state = stateFor(lan, 'classroom');
    const peer = pairedPeer(state, args.teacherEndpointId, 'teacher');
    const request = requestFields(args);
    const body = text(args.body, '请求正文', 2000);
    await approve(ctx, exec, 'mochi_lan_send_student_request', `发给：${messageRecipient(peer)}\n\n信件内容：\n${body}\n\n${requestSummary(request)}\n来自：${state.identity.displayName} · ${state.identity.schoolId} · ${state.identity.classId}\n\n确认后发送这封信；取消不会发送。`);
    verifyAfterApproval(lan, 'classroom', state.identity, peer);
    return lan.sendRequest({ targetEndpointId: peer.endpointId, request, body, expectedSender: identity(state.identity), expectedPeer: identity(peer), authorization: lan.authorize('send-request', 'dispatch-approved'), signal: exec.signal });
  });

  register('mochi_lan_reply_student_request', '仅教师对当前已配对教室发来的指定原请求回复。appointment 用 confirmed 确认原希望时间，或 rescheduled 建议不同时间；其他请求用 replied 文字回复。确认卡展示原请求全文与拟回复全文，批准后重新核对原请求和双方身份，不能自动发送。', {
    replyToMessageId: { type: 'string', required: true, description: '来自 mochi_lan_pending_requests 的原请求 ID。' },
    decision: { type: 'string', required: true, enum: ['confirmed', 'rescheduled', 'replied'], description: '确认原时间、建议改期或文字回复。' },
    slot: { type: 'string', description: '改期的新建议时间；确认原时间时省略。' },
    body: { type: 'string', required: true, description: '给学生的完整回复正文。' },
  }, async (args, exec) => {
    const state = stateFor(lan, 'teacher');
    const { row, peer } = pendingRequest(state, args.replyToMessageId);
    const response = responseFields(args, row);
    const body = text(args.body, '回复正文', 2000);
    const original = requestFacts(row);
    const decision = { confirmed: '确认原时间', rescheduled: '建议改期', replied: '文字回复' }[response.decision];
    await approve(ctx, exec, 'mochi_lan_reply_student_request', `回复给：${messageRecipient(peer)}\n\n回复内容：\n${body}\n\n${decision}${response.slot ? `：${response.slot}` : ''}\n\n原请求：\n${row.body}\n${requestSummary(row.request)}\n\n确认后发送这封回复；取消不会发送。`);
    const current = verifyAfterApproval(lan, 'teacher', state.identity, peer);
    const latest = pendingRequest(current, row.messageId);
    if (requestFacts(latest.row) !== original) throw new Error('确认期间原请求已变化，请重新核对。');
    return lan.sendResponse({ targetEndpointId: peer.endpointId, response, body, expectedSender: identity(state.identity), expectedPeer: identity(peer), authorization: lan.authorize('send-response', 'dispatch-approved'), signal: exec.signal });
  });

  register('mochi_lan_probe_classroom', '仅教师按手动 IPv4 地址和端口只读探测教室身份；核对签名指纹、学校和班级。不发起配对，也不自动信任探测结果。', {
    host: { type: 'string', required: true, description: '教室设备的 IPv4 地址。' },
    port: { type: 'integer', required: true, description: '教室设备的 LAN 监听端口。' },
  }, async (args, exec) => {
    const state = stateFor(lan, 'teacher');
    const address = addressFromArgs(args);
    const result = await lan.probeCandidate({ address, signal: exec.signal });
    return { candidate: identity(classroomCandidate(state.identity, result.candidate)), address: result.address, paired: state.peers.some((row) => sameIdentity(row, result.candidate) && !row.blocked) };
  });

  register('mochi_lan_pair_classroom', '仅教师向同校教室发起双向确认的配对。六位短码会核查本机发现候选，最多等 30 秒并可取消；同一码搜索期间不重复发探测。若仍有候选未核查，须提供精确设备 ID 才继续；也可手动提供 IPv4 地址与端口。先探测身份并在确认卡显示指纹；批准后再次探测，教室端仍须另行接受。短码不写入工具结果或确认卡。', {
    code: { type: 'string', description: '教室端显示的六位短时配对码；不会在结果或确认卡复述。' },
    classroomEndpointId: { type: 'string', description: '可选精确教室设备 ID，用于消除同名设备歧义。' },
    host: { type: 'string', description: '自动发现失败时的教室 IPv4 地址，必须与 port 一起给出。' },
    port: { type: 'integer', description: '手动 IPv4 地址对应的 LAN 监听端口。' },
  }, async (args, exec) => {
    const state = stateFor(lan, 'teacher');
    const target = await pairingTarget(lan, state, args, exec.signal);
    await approve(ctx, exec, 'mochi_lan_pair_classroom', `教师端 ${peerLabel(state.identity)} 将向教室 ${peerLabel(target.candidate)} 发起配对。\n地址：${target.address.host}:${target.address.port}\n这只发出待确认请求；教室端还须核对教师指纹并接受。`);
    verifyAfterApproval(lan, 'teacher', state.identity);
    pairedCandidateStillVisible(lan, target);
    const latest = await lan.probeCandidate({ address: target.address, expectedFingerprint: target.candidate.fingerprint, signal: exec.signal });
    if (!sameIdentity(latest.candidate, target.candidate) || JSON.stringify(latest.address) !== JSON.stringify(target.address)) throw new Error('确认期间目标教室身份或地址已变化，请重新核对。');
    const result = await lan.requestPairing({ candidate: latest.candidate, address: latest.address, ...(target.code === undefined ? {} : { pairingCode: target.code }), authorization: lan.authorize('request-pairing', 'dispatch-approved'), signal: exec.signal });
    return { status: result.status, requestId: result.requestId, peer: identity(result.peer) };
  });

  register('mochi_lan_decide_pairing', '仅教室端对指定教师配对请求接受或拒绝。确认卡展示学校、教师设备与指纹；批准后重新核对本机身份和原请求，绝不因聊天中的角色宣称而自动接受。', {
    requestId: { type: 'string', required: true, description: '来自 mochi_lan_status 的待配对请求 ID。' },
    action: { type: 'string', required: true, enum: ['accept', 'reject'], description: '接受或拒绝。' },
  }, async (args, exec) => {
    const state = stateFor(lan, 'classroom');
    const requestId = text(args.requestId, '配对请求 ID', 120);
    const action = args.action;
    if (!['accept', 'reject'].includes(action)) throw new Error('配对决定只能是 accept 或 reject。');
    const pending = state.pendingPairings.find((row) => row.requestId === requestId);
    if (!pending || pending.peer?.role !== 'teacher' || pending.peer.schoolId !== state.identity.schoolId) throw new Error('没有可由当前教室确认的教师配对请求。');
    await approve(ctx, exec, 'mochi_lan_decide_pairing', `教室端 ${peerLabel(state.identity)} 将${action === 'accept' ? '接受' : '拒绝'}教师 ${peerLabel(pending.peer)} 的配对请求 ${requestId}。`);
    const current = verifyAfterApproval(lan, 'classroom', state.identity);
    const latest = current.pendingPairings.find((row) => row.requestId === requestId);
    if (!latest || !sameIdentity(latest.peer, pending.peer)) throw new Error('确认期间配对请求已变化，请重新核对。');
    return action === 'accept'
      ? lan.acceptPairing({ requestId, authorization: lan.authorize('accept-pairing', 'dispatch-approved'), signal: exec.signal })
      : lan.rejectPairing({ requestId, authorization: lan.authorize('reject-pairing', 'dispatch-approved') });
  });
}
