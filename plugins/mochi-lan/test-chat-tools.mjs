import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerLanChatTools } from './chat-tools.mjs';

const teacher = { endpointId: 'teacher-1', role: 'teacher', schoolId: 'school-1', displayName: '王老师', fingerprint: 'sha256:teacher' };
const classroom = { endpointId: 'class-1', role: 'classroom', schoolId: 'school-1', classId: 'g7-1', displayName: '七一班', fingerprint: 'sha256:classroom' };
const classroomPeer = { ...classroom, address: { host: '192.0.2.10', port: 43123 }, online: true, blocked: false };
const teacherPeer = { ...teacher, address: { host: '192.0.2.11', port: 43124 }, online: true, blocked: false };
const appointment = {
  messageId: 'request-1', from: classroom, recipient: teacher, contentType: 'REQUEST',
  body: '下课后想讨论第三题。', request: { student: '小明', kind: 'appointment', slot: '周三 16:00' }, receivedAt: '2026-09-24T08:00:00Z',
};
const exec = { agent: {}, callId: 'call-1', signal: new AbortController().signal };

function harness(role = 'teacher') {
  const calls = [];
  const approvals = [];
  const state = {
    started: true, configured: role !== null, lockedRole: role, identity: role === 'teacher' ? teacher : role === 'classroom' ? classroom : null,
    localAddresses: ['192.0.2.11'], http: { port: 43124 }, discovery: { status: 'ACTIVE' }, pairingCode: { code: '123456' },
    peers: role === 'teacher' ? [structuredClone(classroomPeer)] : role === 'classroom' ? [structuredClone(teacherPeer)] : [], pendingPairings: [], inbox: [], outbox: [],
  };
  const discovered = [{ ...classroom, address: { host: '192.0.2.10', port: 43123 }, paired: false, blocked: false, seenAt: 'now' }];
  const lan = {
    lockedRole: role,
    snapshot: () => structuredClone(state),
    listDiscovered: () => structuredClone(discovered),
    waitForPairingCode: async (code, options) => {
      calls.push(['waitForPairingCode', code, options]);
      return { matches: [{ ...classroom, address: discovered[0].address, publicKey: { kty: 'OKP' } }], diagnostics: { discoveredCount: 1, unreachableCount: 0, codeRejectedCount: 0, rateLimitedCount: 0, invalidCandidateCount: 0 } };
    },
    probeCandidate: async ({ address }) => { calls.push(['probeCandidate', address]); return { candidate: { ...classroom, publicKey: { kty: 'OKP' } }, address }; },
    authorize: (action, source) => { calls.push(['authorize', action, source]); return { action, source }; },
    configureIdentity: async (input, options) => {
      calls.push(['configureIdentity', input, options]);
      const changed = state.identity && (state.identity.schoolId !== input.schoolId || state.identity.classId !== input.classId || state.identity.displayName !== input.displayName);
      state.identity = { endpointId: state.identity?.endpointId ?? 'new-device', role: state.lockedRole, fingerprint: state.identity?.fingerprint ?? 'sha256:new', ...input };
      if (changed) state.peers = [];
      return structuredClone(state);
    },
    sendRequest: async (input) => { calls.push(['sendRequest', input]); return { messageId: 'sent-request', delivery: 'ACKNOWLEDGED' }; },
    sendResponse: async (input) => { calls.push(['sendResponse', input]); return { messageId: 'sent-response', delivery: 'ACKNOWLEDGED' }; },
    requestPairing: async (input) => { calls.push(['requestPairing', input]); return { requestId: 'pair-1', status: 'pending', peer: classroom }; },
    acceptPairing: async (input) => { calls.push(['acceptPairing', input]); return { status: 'paired', peer: teacher }; },
    rejectPairing: async (input) => { calls.push(['rejectPairing', input]); return { status: 'rejected' }; },
  };
  let onApprove = async () => 'allowed-once';
  let approvalAvailable = true;
  const tools = new Map();
  registerLanChatTools({
    tools: { register(tool) { tools.set(tool.name, tool); } },
    get(key) { return key === 'approval' && approvalAvailable ? { request: async (request) => { approvals.push(request); return onApprove(request); } } : undefined; },
  }, lan);
  return { state, discovered, lan, calls, approvals, tools, setApproval(callback) { onApprove = callback; }, setApprovalAvailable(value) { approvalAvailable = value; } };
}

test('classroom status never exposes pair code or historical messages', async () => {
  const h = harness('classroom');
  h.state.inbox = [appointment];
  h.state.outbox = [{ ...appointment, body: '另一位学生的请求' }];
  h.state.pendingPairings = [{ requestId: 'pair-1', peer: teacher, receivedAt: 'now' }];
  assert.deepEqual([...h.tools.keys()].sort(), [
    'mochi_lan_status', 'mochi_lan_configure_identity',
    'mochi_lan_send_student_request', 'mochi_lan_decide_pairing',
    'mochi_lan_received_presentations', 'mochi_lan_open_presentation',
  ].sort());
  const result = await h.tools.get('mochi_lan_status').execute({}, exec);
  assert.equal(result.pendingPairings[0].peer.fingerprint, teacher.fingerprint);
  assert.equal(JSON.stringify(result).includes('123456'), false);
  assert.equal(JSON.stringify(result).includes('小明'), false);
  assert.equal(JSON.stringify(result).includes('另一位学生'), false);
  assert.deepEqual(result.discovered, []);
  assert.equal(result.lockedRole, 'classroom');
  assert.equal(h.tools.get('mochi_lan_pending_requests'), undefined);
});

test('teacher sees only teacher LAN chat tools and unassigned hosts see status only', () => {
  const teacherHost = harness('teacher');
  assert.deepEqual([...teacherHost.tools.keys()].sort(), [
    'mochi_lan_status', 'mochi_lan_configure_identity', 'mochi_lan_pending_requests',
    'mochi_lan_reply_student_request', 'mochi_lan_probe_classroom', 'mochi_lan_pair_classroom',
  ].sort());
  assert.deepEqual([...harness(null).tools.keys()], ['mochi_lan_status']);
});

test('identity setup uses host locked role and never returns pair code or history', async () => {
  const h = harness('classroom');
  h.state.identity = null;
  const result = await h.tools.get('mochi_lan_configure_identity').execute({ schoolId: 'school-1', classId: 'g7-1', displayName: '七一班' }, exec);
  const configured = h.calls.find(([name]) => name === 'configureIdentity');
  assert.deepEqual(configured[1], { schoolId: 'school-1', classId: 'g7-1', displayName: '七一班' });
  assert.equal(configured[2].authorization.source, 'dispatch-approved');
  assert.equal(result.identity.role, 'classroom');
  assert.equal(result.pairingsCleared, false);
  assert.equal(JSON.stringify(result).includes('123456'), false);
  assert.match(h.approvals[0].reason, /宿主锁定/);
  await assert.rejects(() => h.tools.get('mochi_lan_configure_identity').execute({ schoolId: 'school-1', displayName: '七一班' }, exec), /班级标识/);
});

test('teacher identity setup uses teacher role without a class ID', async () => {
  const h = harness('teacher');
  h.state.identity = null;
  const result = await h.tools.get('mochi_lan_configure_identity').execute({ schoolId: 'school-1', displayName: '王老师' }, exec);
  assert.equal(result.identity.role, 'teacher');
  assert.equal(result.identity.classId, undefined);
  assert.deepEqual(h.calls.find(([name]) => name === 'configureIdentity')[1], { schoolId: 'school-1', displayName: '王老师' });
});

test('identity setup rejects missing approval and declined confirmation', async () => {
  const h = harness();
  const args = { schoolId: 'school-1', displayName: '王老师' };
  h.setApprovalAvailable(false);
  await assert.rejects(() => h.tools.get('mochi_lan_configure_identity').execute(args, exec), /没有人工确认通道/);
  h.setApprovalAvailable(true);
  h.setApproval(async () => 'rejected');
  await assert.rejects(() => h.tools.get('mochi_lan_configure_identity').execute(args, exec), /未确认/);
  assert.equal(h.calls.some(([name]) => name === 'configureIdentity'), false);
  await assert.rejects(() => h.tools.get('mochi_lan_configure_identity').execute({ ...args, role: 'classroom' }, exec));
  assert.equal(h.calls.some(([name]) => name === 'configureIdentity'), false);
});

test('identity setup warns on changed identity and rechecks locked role after approval', async () => {
  const h = harness('classroom');
  const args = { schoolId: 'school-1', classId: 'g7-2', displayName: '七二班' };
  h.setApproval(async () => { h.state.lockedRole = 'teacher'; return 'allowed-once'; });
  await assert.rejects(() => h.tools.get('mochi_lan_configure_identity').execute(args, exec), /现有身份与启动角色不一致|角色或身份已变化/);
  assert.equal(h.calls.some(([name]) => name === 'configureIdentity'), false);
  h.state.lockedRole = 'classroom';
  h.setApproval(async () => { h.state.identity = { ...h.state.identity, displayName: '另一间教室' }; return 'allowed-once'; });
  await assert.rejects(() => h.tools.get('mochi_lan_configure_identity').execute(args, exec), /角色或身份已变化/);
  assert.equal(h.calls.some(([name]) => name === 'configureIdentity'), false);
  h.state.identity = classroom;
  h.setApproval(async () => 'allowed-once');
  const result = await h.tools.get('mochi_lan_configure_identity').execute(args, exec);
  assert.equal(result.pairingsCleared, true);
  assert.deepEqual(h.state.peers, []);
  assert.match(h.approvals.at(-1).reason, /清空已配对设备/);
});

test('teacher request listing exposes only current paired unanswered requests', async () => {
  const h = harness();
  h.state.inbox = [appointment, { ...appointment, messageId: 'stale', recipient: { ...teacher, fingerprint: 'old' } }, { ...appointment, messageId: 'answered' }];
  h.state.outbox = [{ response: { replyToMessageId: 'answered' } }];
  const result = await h.tools.get('mochi_lan_pending_requests').execute({}, exec);
  assert.deepEqual(result.requests.map((row) => row.messageId), ['request-1']);
  h.state.peers[0].blocked = true;
  assert.deepEqual((await h.tools.get('mochi_lan_pending_requests').execute({}, exec)).requests, []);
});

test('student request needs explicit approval and stable identities', async () => {
  const h = harness('classroom');
  const args = { teacherEndpointId: teacher.endpointId, student: '小明', kind: 'appointment', slot: '周三 16:00', body: '想约老师讨论第三题。' };
  const { slot: _slot, ...withoutSlot } = args;
  await assert.rejects(() => h.tools.get('mochi_lan_send_student_request').execute(withoutSlot, exec), /希望时间/);
  assert.equal(h.approvals.length, 0);
  h.setApproval(async () => 'rejected');
  await assert.rejects(() => h.tools.get('mochi_lan_send_student_request').execute(args, exec), /未确认/);
  assert.equal(h.calls.some(([name]) => name === 'sendRequest'), false);
  h.setApproval(async () => { h.state.peers[0].fingerprint = 'sha256:changed'; return 'allowed-once'; });
  await assert.rejects(() => h.tools.get('mochi_lan_send_student_request').execute(args, exec), /身份已变化/);
  assert.equal(h.calls.some(([name]) => name === 'sendRequest'), false);
  h.state.peers[0].fingerprint = teacher.fingerprint;
  h.setApproval(async () => 'allowed-once');
  await h.tools.get('mochi_lan_send_student_request').execute(args, exec);
  const call = h.calls.find(([name]) => name === 'sendRequest')[1];
  assert.equal(call.request.student, '小明');
  assert.equal(call.request.slot, '周三 16:00');
  assert.equal(call.authorization.source, 'dispatch-approved');
  assert.match(h.approvals.at(-1).reason, /自述，未核验学籍/);
  assert.match(h.approvals.at(-1).reason, /想约老师讨论第三题/);
});

test('teacher reply binds approval to the original request and appointment time', async () => {
  const h = harness();
  h.state.inbox = [structuredClone(appointment)];
  const tool = h.tools.get('mochi_lan_reply_student_request');
  await assert.rejects(() => tool.execute({ replyToMessageId: 'request-1', decision: 'confirmed', slot: '周四 16:00', body: '可以。' }, exec), /原希望时间/);
  h.setApproval(async () => { h.state.inbox[0].body = '已改写的请求'; return 'allowed-once'; });
  await assert.rejects(() => tool.execute({ replyToMessageId: 'request-1', decision: 'confirmed', body: '可以。' }, exec), /原请求已变化/);
  assert.equal(h.calls.some(([name]) => name === 'sendResponse'), false);
  h.state.inbox = [structuredClone(appointment)];
  h.setApproval(async () => 'allowed-once');
  await tool.execute({ replyToMessageId: 'request-1', decision: 'confirmed', body: '按原时间见。' }, exec);
  const call = h.calls.find(([name]) => name === 'sendResponse')[1];
  assert.equal(call.response.slot, '周三 16:00');
  assert.equal(call.response.decision, 'confirmed');
  assert.match(h.approvals.at(-1).reason, /下课后想讨论第三题/);
});

test('manual IPv4 probe is read only; pairing probes again after approval without echoing code', async () => {
  const h = harness();
  const address = { host: '192.0.2.10', port: 43123 };
  const probed = await h.tools.get('mochi_lan_probe_classroom').execute(address, exec);
  assert.equal(probed.candidate.fingerprint, classroom.fingerprint);
  assert.equal(h.approvals.length, 0);
  await h.tools.get('mochi_lan_pair_classroom').execute({ ...address, code: '123456' }, exec);
  assert.equal(h.calls.filter(([name]) => name === 'probeCandidate').length, 3);
  assert.equal(h.calls.find(([name]) => name === 'requestPairing')[1].pairingCode, '123456');
  assert.equal(JSON.stringify(h.approvals).includes('123456'), false);
  assert.equal(JSON.stringify(h.calls.find(([name]) => name === 'requestPairing')[1].candidate).includes('privateKey'), false);
  const result = await h.tools.get('mochi_lan_pair_classroom').execute({ code: '123456' }, exec);
  assert.equal(JSON.stringify(result).includes('123456'), false);
  const search = h.calls.find(([name]) => name === 'waitForPairingCode');
  assert.equal(search[1], '123456');
  assert.equal(search[2].signal, exec.signal);
  assert.equal(search[2].waitMs, 30_000);
});

test('chat code search reports discovery and reachability state without approving an unmatched target', async () => {
  const h = harness();
  h.lan.waitForPairingCode = async (code, options) => {
    h.calls.push(['waitForPairingCode', code, options]);
    h.state.discovery.status = 'DEGRADED';
    return { matches: [], diagnostics: { discoveredCount: 0, unreachableCount: 0, codeRejectedCount: 0, rateLimitedCount: 0, invalidCandidateCount: 0 } };
  };
  await assert.rejects(
    () => h.tools.get('mochi_lan_pair_classroom').execute({ code: '123456' }, exec),
    /UDP 自动发现暂不可用.*IPv4 地址与端口/u,
  );
  assert.equal(h.approvals.length, 0);
  assert.equal(h.calls.some(([name]) => name === 'requestPairing'), false);
});

test('chat code search includes the latest discovery state when discovered candidates are unreachable', async () => {
  const h = harness();
  h.lan.waitForPairingCode = async (code, options) => {
    h.calls.push(['waitForPairingCode', code, options]);
    h.state.discovery.status = 'DEGRADED';
    return { matches: [], diagnostics: { discoveredCount: 1, unreachableCount: 1, codeRejectedCount: 0, rateLimitedCount: 0, invalidCandidateCount: 0 } };
  };
  await assert.rejects(
    () => h.tools.get('mochi_lan_pair_classroom').execute({ code: '123456' }, exec),
    /UDP 自动发现暂不可用.*1 台发现候选暂不可达.*IPv4 地址与端口/u,
  );
  assert.equal(h.approvals.length, 0);
  assert.equal(h.calls.some(([name]) => name === 'requestPairing'), false);
});

test('chat does not treat one match as unique while another discovered candidate is unverified', async () => {
  const h = harness();
  h.lan.waitForPairingCode = async (code, options) => {
    h.calls.push(['waitForPairingCode', code, options]);
    return {
      matches: [{ ...classroom, address: h.discovered[0].address, publicKey: { kty: 'OKP' } }],
      diagnostics: { discoveredCount: 2, unreachableCount: 1, codeRejectedCount: 0, rateLimitedCount: 0, invalidCandidateCount: 0, unverifiedCandidateCount: 1 },
    };
  };
  await assert.rejects(
    () => h.tools.get('mochi_lan_pair_classroom').execute({ code: '123456' }, exec),
    /已找到一台匹配教室，但还有 1 台同校候选未完成核查.*设备 ID/u,
  );
  assert.equal(h.approvals.length, 0);
  assert.equal(h.calls.some(([name]) => name === 'requestPairing'), false);

  await h.tools.get('mochi_lan_pair_classroom').execute({ code: '123456', classroomEndpointId: classroom.endpointId }, exec);
  assert.equal(h.calls.some(([name]) => name === 'requestPairing'), true, 'an explicit exact device ID may proceed despite unrelated unresolved candidates');
});

test('classroom pairing decision checks pending fingerprint again after approval', async () => {
  const h = harness('classroom');
  h.state.pendingPairings = [{ requestId: 'pair-1', peer: teacher, receivedAt: 'now' }];
  h.setApproval(async () => { h.state.pendingPairings[0].peer.fingerprint = 'sha256:changed'; return 'allowed-once'; });
  await assert.rejects(() => h.tools.get('mochi_lan_decide_pairing').execute({ requestId: 'pair-1', action: 'accept' }, exec), /请求已变化/);
  assert.equal(h.calls.some(([name]) => name === 'acceptPairing'), false);
  h.state.pendingPairings[0].peer.fingerprint = teacher.fingerprint;
  h.setApproval(async () => 'allowed-once');
  await h.tools.get('mochi_lan_decide_pairing').execute({ requestId: 'pair-1', action: 'reject' }, exec);
  assert.equal(h.calls.find(([name]) => name === 'rejectPairing')[1].authorization.source, 'dispatch-approved');
});


test('classroom WPS tool requires a received file and approval without granting paths', async () => {
  const h = harness('classroom');
  h.lan.receivedPresentations = () => [{ messageId: 'deck-1', filename: '课件.pptx', teacher: '王老师' }];
  h.lan.openReceivedPresentation = async (input) => { h.calls.push(['open', input]); return { status: 'LAUNCH_REQUESTED' }; };
  const tool = h.tools.get('mochi_lan_open_presentation');
  await assert.rejects(() => tool.execute({ messageId: '/etc/passwd' }, exec), /没有找到/);
  h.setApproval(() => 'denied');
  await assert.rejects(() => tool.execute({ messageId: 'deck-1' }, exec), /未确认/);
  assert.equal(h.calls.some(([kind]) => kind === 'open'), false);
  h.setApproval(() => 'allowed-once');
  assert.equal((await tool.execute({ messageId: 'deck-1' }, exec)).status, 'LAUNCH_REQUESTED');
  assert.equal(h.calls.find(([kind]) => kind === 'open')[1].messageId, 'deck-1');
});

test('student send review prioritizes exact recipient and full content, with all supplied request details', async () => {
  const h = harness('classroom');
  const expectedFingerprint = h.state.peers[0].fingerprint;
  const body = '这是一封需要完整核对的长信。'.repeat(85) + '【最后一句仍须可见】';
  const args = { teacherEndpointId: teacher.endpointId, student: '小明', kind: 'appointment', seat: 7, slot: '周三 16:00', material: '数学作业', position: '第三题', topic: '几何', body };
  h.setApproval(async review => {
    assert.ok(review.reason.startsWith('发给：王老师 · school-1\n设备：teacher-1\n\n信件内容：\n' + body));
    for (const detail of ['小明（自述，未核验学籍） · 7 号', '请求：预约讲题', '希望时间：周三 16:00', '材料：数学作业', '题目位置：第三题', '主题：几何', '来自：七一班 · school-1 · g7-1', '确认后发送这封信；取消不会发送。']) assert.ok(review.reason.includes(detail), detail);
    assert.doesNotMatch(review.reason, /sha256:|指纹|省略/u);
    assert.equal(h.calls.some(([name]) => name === 'sendRequest'), false, 'review occurs before transport');
    return 'allowed-once';
  });
  await h.tools.get('mochi_lan_send_student_request').execute(args, exec);
  const sent = h.calls.find(([name]) => name === 'sendRequest')[1];
  assert.equal(sent.body, body);
  assert.equal(sent.expectedPeer.fingerprint, expectedFingerprint);
});

test('teacher reply review retains original request, both times and exact target without fingerprint clutter', async () => {
  const h = harness('teacher');
  h.state.inbox = [structuredClone(appointment)];
  await h.tools.get('mochi_lan_reply_student_request').execute({ replyToMessageId: appointment.messageId, decision: 'rescheduled', slot: '周四 17:00', body: '我们改在周四讨论。' }, exec);
  assert.equal(h.approvals[0].reason, '回复给：七一班 · school-1 · g7-1\n设备：class-1\n\n回复内容：\n我们改在周四讨论。\n\n建议改期：周四 17:00\n\n原请求：\n下课后想讨论第三题。\n学生：小明（自述，未核验学籍）\n请求：预约讲题\n希望时间：周三 16:00\n\n确认后发送这封回复；取消不会发送。');
  assert.equal(h.calls.find(([name]) => name === 'sendResponse')[1].expectedPeer.fingerprint, classroom.fingerprint);
});
