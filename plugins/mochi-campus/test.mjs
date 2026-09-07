import assert from 'node:assert/strict';

// mochi-campus 插件单测（2026-09-05 随 live-API 化重写 + 传话网络 PHASE_4）
// 连接全部打桩：不依赖 8787/登录态，断言工具注册面、参数校验、
// 审批闸 fail-closed 与「结果不明确绝不重发」语义。live 路径由 headless E2E 覆盖。

const calls = [];
function makeConnection({ role = 'HEAD_TEACHER', responses = {} } = {}) {
  return {
    origin: 'http://127.0.0.1:8787',
    request: async (path, exec, opts = {}) => {
      calls.push({ path, opts });
      if (responses[path]) return responses[path];
      if (path === '/api/assistant/relay/send') {
        return { source: 'stub', dataMode: 'campus-api', account: { id: 1, name: '林清', role: 'HEAD_TEACHER' }, result: { ok: true, peer: { id: 2, name: '夏一', role: '校医' } } };
      }
      if (path === '/api/assistant/relay') {
        return { source: 'stub', dataMode: 'campus-api', account: { id: 1, name: '林清', role: 'HEAD_TEACHER' }, result: { incoming: [{ id: 9, peerName: '顾言老师', peerRole: '任课教师', body: 'x的 Mochi 替主人带话：帮我占个会议室', kind: 'message', status: 'pending', createdAt: '2026-09-05 08:00:00' }], outgoing: [{ id: 8, peerName: '周宁老师', peerRole: '校医', body: 'x的 Mochi 替主人带话：明早送急救包', kind: 'message', status: 'accepted', reply: '好的', createdAt: '2026-09-05 07:00:00' }], pendingIncoming: 1 } };
      }
      return { source: 'stub', dataMode: 'campus-api', account: { id: 1, name: '林清', role: 'HEAD_TEACHER' }, result: { ok: true, stub: path } };
    },
    binding: (exec) => ({ token: 't'.repeat(48), user: { id: 1, name: '林清', role }, session: exec?.agent?.session ?? {} }),
  };
}

function makeCtx(approvalOutcome) {
  const tools = new Map();
  const approvals = [];
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); } },
    get: (key) => (key === 'approval' && approvalOutcome ? { request: async (request) => { approvals.push(request); return approvalOutcome; } } : undefined),
  };
  return { ctx, tools, approvals };
}

const exec = { agent: { session: {} }, callId: 'call-1' };

// ① 注册面：全部工具在册
{
  const { apply } = await import('./index.mjs');
  const { ctx, tools } = makeCtx('allowed-once');
  apply(ctx, makeConnection());
  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      'campus_query_student',
      'jxl.analytics',
      'jxl.assistant',
      'jxl.campus_status',
      'jxl.clinic_status',
      'jxl.dorm_status',
      'jxl.event_detail',
      'jxl.health_events',
      'jxl.medical_event_create',
      'jxl.medical_event_status',
      'jxl.message',
      'jxl.movement_detail',
      'jxl.movement_link_medical_event',
      'jxl.movement_request_create',
      'jxl.movement_request_decide',
      'jxl.movement_request_list',
      'jxl.movement_transition',
      'jxl.query',
      'jxl.relay_find',
      'jxl.relay_list',
      'jxl.relay_register',
      'jxl.relay_respond',
      'jxl.relay_send',
      'jxl.smart_digest',
      'jxl.student_card',
      'jxl.student_directory_search',
      'jxl.student_query',
      'message.send',
    ],
  );
  console.log(`① 注册面 OK（${tools.size} 个工具，含传话 5 件套）`);
}

// 学生目录与流动单是不同事实域：姓名解析必须查真实 students 路由。
{
  calls.length = 0;
  const { apply } = await import('./index.mjs');
  const { ctx, tools } = makeCtx('allowed-once');
  apply(ctx, makeConnection());
  await tools.get('jxl.student_directory_search').execute({ keyword: '简乐知', limit: 10 }, exec);
  assert.equal(calls[0].path, '/api/students?search=%E7%AE%80%E4%B9%90%E7%9F%A5&limit=10');
}

// ② jxl.relay_list 直连传话箱端点（POST /api/assistant/relay）
{
  calls.length = 0;
  const { apply } = await import('./index.mjs');
  const { ctx, tools } = makeCtx('allowed-once');
  apply(ctx, makeConnection());
  const result = await tools.get('jxl.relay_list').execute({}, exec);
  assert.equal(calls[0].path, '/api/assistant/relay');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(result.需要我回应, 1);
  assert.equal(result.收到的传话[0].对方, '顾言老师');
  assert.equal(result.发出的传话[0].回话, '好的');
  console.log('② jxl.relay_list 直连 + 摘要 OK');
}

// 新增业务写工具在没有官方 approval 服务时必须在任何上游写请求前失败。
{
  calls.length = 0;
  const { apply } = await import('./index.mjs');
  const { ctx, tools } = makeCtx(undefined);
  apply(ctx, makeConnection());
  await assert.rejects(
    () => tools.get('jxl.movement_transition').execute({ reference: 'mov_demo', action: 'confirm-return', expectedVersion: 4, idempotencyKey: 'test-return-0001' }, exec),
    /没有人工确认通道/,
  );
  assert.equal(calls.length, 0);
}

// 医务写工具：角色、人工拒绝、学生一致性与 CAS 参数都必须在真实写入前守住。
{
  const { apply } = await import('./index.mjs');

  calls.length = 0;
  const wrongRole = makeCtx('allowed-once');
  apply(wrongRole.ctx, makeConnection({ role: 'HEAD_TEACHER' }));
  await assert.rejects(
    () => wrongRole.tools.get('jxl.medical_event_create').execute({ studentId: 15, category: '身体不适', urgency: '普通', measure: '休息观察', status: '留观中', note: '测试', idempotencyKey: 'event-create-0001' }, exec),
    /只有校医/,
  );
  assert.equal(calls.length, 0, '错误角色不得读取或写入医务数据');

  calls.length = 0;
  const rejected = makeCtx('rejected');
  apply(rejected.ctx, makeConnection({ role: 'NURSE', responses: { '/api/students/15': { result: { student: { id: 15, name: '简乐知', className: '七年级1班' } } } } }));
  await assert.rejects(
    () => rejected.tools.get('jxl.medical_event_create').execute({ studentId: 15, category: '身体不适', urgency: '普通', measure: '休息观察', status: '留观中', note: '测试', idempotencyKey: 'event-create-0002' }, exec),
    (error) => error?.code === 'USER_DECLINED' && /USER_DECLINED.*已取消/.test(error.message),
  );
  assert.equal(calls.some((call) => call.path === '/api/events'), false, '拒绝确认后不得创建事件');

  calls.length = 0;
  const mismatch = makeCtx('allowed-once');
  apply(mismatch.ctx, makeConnection({ role: 'NURSE', responses: {
    '/api/movements/mov_demo': { result: { movement: { publicReference: 'mov_demo', studentId: 15, studentName: '简乐知', className: '七年级1班', status: 'AT_DESTINATION', version: 2 } } },
    '/api/events/301': { result: { event: { id: 301, studentId: 16, studentName: '其他学生', category: '身体不适', measure: '休息观察', status: '留观中' } } },
  } }));
  await assert.rejects(
    () => mismatch.tools.get('jxl.movement_link_medical_event').execute({ reference: 'mov_demo', medicalEventId: 301, expectedVersion: 2, idempotencyKey: 'event-link-0001' }, exec),
    /不同学生/,
  );
  assert.equal(mismatch.approvals.length, 0, '学生不一致不得出现确认卡');
  assert.equal(calls.some((call) => call.opts.method === 'POST'), false, '学生不一致不得写入关联');

  calls.length = 0;
  const status = makeCtx('allowed-once');
  apply(status.ctx, makeConnection({ role: 'NURSE', responses: { '/api/events/301': { result: { event: { id: 301, studentId: 15, studentName: '简乐知', status: '留观中', version: 4 } } } } }));
  await status.tools.get('jxl.medical_event_status').execute({ eventId: 301, status: '准备返班', expectedVersion: 4, idempotencyKey: 'event-status-0001' }, exec);
  const write = calls.find((call) => call.path === '/api/events/301/status');
  assert.equal(write.opts.method, 'PATCH');
  assert.deepEqual(write.opts.body, { status: '准备返班', expectedVersion: 4, idempotencyKey: 'event-status-0001' });
  assert.equal(write.opts.expectedUserId, 1);
}

// ③ jxl.relay_send 审批闸：无审批通道 → 拒发；主人拒绝 → 拒发；放行 → 恰好一次投递
{
  {
    const { apply } = await import('./index.mjs');
    const { ctx, tools } = makeCtx(undefined); // 无 approval 服务（fail-closed）
    apply(ctx, makeConnection());
    await assert.rejects(
      () => tools.get('jxl.relay_send').execute({ peerName: '夏医生', note: '明早送急救包' }, exec),
      /没有人工确认通道/,
    );
  }
  {
    calls.length = 0;
    const { apply } = await import('./index.mjs');
    const { ctx, tools } = makeCtx('rejected');
    apply(ctx, makeConnection());
    await assert.rejects(
      () => tools.get('jxl.relay_send').execute({ peerName: '夏医生', note: '明早送急救包' }, exec),
      /未发送|未登记|未回应|未获主人确认/,
    );
    assert.equal(calls.length, 0, '主人拒绝后不得有任何上游请求');
  }
  {
    calls.length = 0;
    const { apply } = await import('./index.mjs');
    const { ctx, tools } = makeCtx('allowed-once');
    apply(ctx, makeConnection());
    const payload = { peerName: '夏医生', kind: 'message', note: '明早把急救包送去医务室' };
    const first = await tools.get('jxl.relay_send').execute(payload, exec);
    const second = await tools.get('jxl.relay_send').execute(payload, exec);
    assert.equal(calls.filter((c) => c.path === '/api/assistant/relay/send').length, 1, '同一参数只投递一次');
    assert.equal(first, second, '重发询问直接返回首次结果');
    assert.equal(calls[0].opts.body.note, payload.note);
  }
  console.log('③ jxl.relay_send 审批闸 + 单次投递语义 OK');
}

// ④ jxl.relay_send 参数校验：寻物缺东西名、传话缺正文都不得进入审批
{
  const { apply } = await import('./index.mjs');
  const { ctx, tools } = makeCtx('allowed-once');
  apply(ctx, makeConnection());
  await assert.rejects(() => tools.get('jxl.relay_send').execute({ peerName: '夏医生', kind: 'request' }, exec), /东西/);
  await assert.rejects(() => tools.get('jxl.relay_send').execute({ peerName: '夏医生', kind: 'message' }, exec), /正文/);
  await assert.rejects(() => tools.get('jxl.relay_send').execute({ kind: 'message', note: 'x'.repeat(121) }, exec), /peerName/); // schema 先拦缺参
  await assert.rejects(() => tools.get('jxl.relay_send').execute({ peerName: '夏医生', kind: 'message', note: 'x'.repeat(121) }, exec), /120/);
  console.log('④ jxl.relay_send 参数校验 OK');
}

// ⑤ jxl.relay_respond：应答必须过审批（人决定应答的执行面）
{
  calls.length = 0;
  const { apply } = await import('./index.mjs');
  const { ctx, tools } = makeCtx('allowed-once');
  apply(ctx, makeConnection());
  await tools.get('jxl.relay_respond').execute({ id: 7, action: 'accept', note: '找到了，这就送去' }, exec);
  assert.equal(calls[0].path, '/api/assistant/relay/respond');
  assert.deepEqual(calls[0].opts.body, { id: 7, action: 'accept', note: '找到了，这就送去' });

  const { ctx: ctxNo, tools: toolsNo } = makeCtx('rejected');
  apply(ctxNo, makeConnection());
  await assert.rejects(() => toolsNo.get('jxl.relay_respond').execute({ id: 7, action: 'accept' }, exec), /未发送|未登记|未回应|未获主人确认/);
  assert.equal(calls.filter((c) => c.path === '/api/assistant/relay/respond').length, 1, '被拒的应答不得触达上游');
  console.log('⑤ jxl.relay_respond 人决定应答 OK');
}

// ⑥ jxl.relay_find / jxl.relay_register 语义
{
  calls.length = 0;
  const { apply } = await import('./index.mjs');
  const { ctx, tools } = makeCtx('allowed-once');
  apply(ctx, makeConnection());
  await tools.get('jxl.relay_find').execute({ item: '期中卷子' }, exec);
  assert.equal(calls[0].path, '/api/assistant/relay/find');
  await assert.rejects(() => tools.get('jxl.relay_find').execute({}, exec), /item/); // schema 层拦缺参
  await tools.get('jxl.relay_register').execute({ item: '备用 basketball' }, exec);
  assert.equal(calls[1].path, '/api/assistant/relay/register');
  console.log('⑥ jxl.relay_find / jxl.relay_register OK');
}

// ⑦ render 管线回归：output.render 必须吃第二个参数（返回值），不得 stringify 调用参数
//（2026-09-05 事故：单参 render 让模型收到的"结果"永远是 args，抓包 016/019 定位）
{
  const { apply } = await import('./index.mjs');
  const { ctx, tools } = makeCtx('allowed-once');
  apply(ctx, makeConnection());
  const list = tools.get('jxl.relay_list');
  const rendered = list.output.render({ some: 'args' }, { 需要我回应: 0, 发出的传话: [{ id: 8, 状态: '已答应' }] });
  const text = rendered.map((block) => block.text).join('');
  assert.ok(text.includes('已答应'), 'render 必须输出工具返回值');
  assert.ok(!text.includes('some'), 'render 不得把调用参数当结果输出');
  const find = tools.get('jxl.relay_find');
  const renderedFind = find.output.render({ item: '卷子' }, { item: '卷子', hits: [{ title: '期中数学卷子' }] });
  const textFind = renderedFind.map((block) => block.text).join('');
  assert.ok(textFind.includes('期中数学卷子'), 'render 必须带上 hits 返回值');
  console.log('⑦ render(args, value) 签名回归 OK');
}

await import('./aggregation.test.mjs');
console.log('mochi-campus tests passed: 20 tools registered, 7 relay/render groups + 4 aggregation groups (stub 连接)');
