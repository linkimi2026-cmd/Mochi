import { defineTool } from '@deepseek-ai/dsh-tools';
import { campusConnection } from './connection.mjs';

export const name = 'mochi-campus';
export const inject = ['tools'];
// ⚠️ render 签名是 (args, value)：第一个参数是调用参数，第二个才是工具返回值。
// 2026-09-05 血泪教训：曾写成单参 value => JSON.stringify(value)，stringify 的
// 实际是 args——模型收到的"工具结果"永远是它自己刚给的参数（抓包才定位到）。
const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
const studentParameters = {
  keyword: { type: 'string', description: '学生姓名、班级或地点。' },
  status: { type: 'string', enum: ['in_clinic', 'in_dorm', 'out', 'returned'] },
  onlyOverdue: { type: 'boolean' },
};
// 与 canonical shared/movement.ts 保持一致：目的地不是状态，RETURNING 仍是活跃流动。
const ACTIVE_MOVEMENT_STATUSES = new Set(['OUTBOUND', 'ARRIVED', 'RETURNING']);
// 与 canonical shared/constants.ts 的 TERMINAL_STATUSES 保持一致。事件接口只
// 返回状态文本，不能沿用旧的英文/已关闭猜测，否则已结束的就诊会被误报为活跃。
const TERMINAL_EVENT_STATUSES = new Set(['已返班', '家长接走', '转诊', '记录结束']);
const MOVEMENT_LIST_SERVER_LIMIT = 100;
const DISPLAY_LIMIT = 20;

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function invalidPayload(resource) {
  const error = new Error(`${resource} 返回格式无效。`);
  error.code = 'CAMPUS_RESPONSE_INVALID';
  return error;
}

function userDeclined(message) {
  const error = new Error(`[USER_DECLINED] ${message} 已取消，本轮不得再次索要确认；只有用户重新发起时才能重试。`);
  error.code = 'USER_DECLINED';
  return error;
}

function responseItems(response, resource) {
  if (!Array.isArray(response?.result?.items)) throw invalidPayload(resource);
  return response.result.items;
}

function safeFailure(resource, error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
    ? error.code
    : 'CAMPUS_REQUEST_FAILED';
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
    ? error.status
    : undefined;
  return { resource, code, ...(status === undefined ? {} : { status }) };
}

async function capture(resource, work) {
  try {
    return { resource, ok: true, value: await work() };
  } catch (error) {
    return { resource, ok: false, error: safeFailure(resource, error) };
  }
}

function sourceNotice(dataMode, hasResult, missingDataMode = false) {
  if (dataMode === 'cloud-demo') return '当前结果来自 cloud-demo 演示数据，未验证为生产数据。';
  if (dataMode === 'campus-api') return '当前结果来自已连接的校园 API；该模式不等同于已验证的生产数据。';
  if (dataMode === 'mixed') {
    return missingDataMode
      ? '当前聚合有成功响应未声明 dataMode；已声明模式不能代表全部结果，未验证为生产数据。'
      : '当前聚合来自多个数据模式；未验证为生产数据。';
  }
  return hasResult
    ? '当前接口有可用结果，但成功响应均未声明 dataMode；无法确认其运行模式或是否为生产数据。'
    : '当前请求均未获得可用结果，无法确认数据模式。';
}

function queryMetadata(connection, reads) {
  const successful = reads.filter((read) => read.ok);
  const failed = reads.filter((read) => !read.ok);
  const responses = successful.map((read) => read.value?.response ?? read.value);
  const sources = [...new Set(responses.map((response) => response?.source).filter((value) => typeof value === 'string'))];
  const responseDataModes = responses.map((response) => {
    const value = response?.dataMode;
    return typeof value === 'string' && value.trim() ? value : null;
  });
  const missingDataMode = responseDataModes.some((value) => value === null);
  const dataModes = [...new Set(responseDataModes.filter(Boolean))];
  const source = sources.length === 1 ? sources[0] : sources.length === 0 ? (typeof connection?.origin === 'string' ? connection.origin : null) : null;
  const dataMode = dataModes.length === 0 ? 'unknown' : dataModes.length === 1 && !missingDataMode ? dataModes[0] : 'mixed';
  return {
    source,
    dataMode,
    ...(sources.length > 1 ? { sources } : {}),
    ...(dataModes.length > 1 || (missingDataMode && dataModes.length > 0) ? { dataModes } : {}),
    ...(missingDataMode ? { missingDataMode: true } : {}),
    productionVerified: false,
    sourceNotice: sourceNotice(dataMode, successful.length > 0, missingDataMode),
    queryStatus: failed.length === 0 ? 'complete' : successful.length > 0 ? 'partial' : 'error',
    ...(failed.length > 0 ? { errors: failed.map((read) => read.error) } : {}),
  };
}

function movementRange(read, matchedCount, shownCount) {
  return {
    activeOnly: read.activeOnly,
    接口返回记录数: read.rawItems.length,
    匹配记录数: matchedCount,
    展示记录数: shownCount,
    服务端上限: MOVEMENT_LIST_SERVER_LIMIT,
    可能截断: read.rawItems.length >= MOVEMENT_LIST_SERVER_LIMIT,
    总数: null,
    说明: 'Worker 不返回总数且服务端最多返回 100 条；计数仅表示本次接口返回的匹配记录，不代表全校总量。',
  };
}

function eventRange(read, matchedCount, shownCount) {
  return {
    page: Number.isInteger(read.page) && read.page >= 1 ? read.page : null,
    limit: Number.isInteger(read.limit) && read.limit >= 1 ? read.limit : null,
    hasMore: typeof read.hasMore === 'boolean' ? read.hasMore : null,
    本页返回记录数: read.items.length,
    本页匹配记录数: matchedCount,
    展示记录数: shownCount,
    总数: null,
    说明: 'events 接口只返回当前页且不提供总数；count 仅表示本页匹配记录，不代表全部医务事件。',
  };
}

function matchesStudentStatus(movement, requested) {
  const status = normalize(movement.status);
  const destination = normalize(movement.destination);
  if (requested === 'in_clinic') return status === 'ARRIVED' && destination === 'INFIRMARY';
  if (requested === 'in_dorm') return status === 'ARRIVED' && destination === 'DORMITORY';
  if (requested === 'out') return status === 'OUTBOUND' || status === 'RETURNING';
  if (requested === 'returned') return status === 'CLOSED';
  return true;
}

function dashboardCount(dashboard, key) {
  const value = dashboard?.counts?.[key];
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function apply(ctx, connection = campusConnection) {
  // 写操作（message.send / jxl.relay_send）的尝试备忘：同一会话同一参数
  // 只投递一次——结果不明确也绝不静默重发。
  const sends = new WeakMap();
  const register = (name, description, parameters, execute) => ctx.tools.register(defineTool({ name, description, parameters, output, execute }));
  const askCampus = (message, exec) => connection.request('/api/assistant', exec, { method: 'POST', body: { message } });
  register('jxl.assistant', '【备用】仅当主人明确要求"用校园网页版助手"时才用；日常查询与操作一律优先用上面列出的具体工具（查状态用 jxl.campus_status 等，传话用 jxl.relay_send）。它的结果可能只有操作提示而非数据，不代表任何操作已完成。', {
    message: { type: 'string', required: true, description: '800 字以内的校园请求。' },
    selectedStudentId: { type: 'integer' }, selectedClassId: { type: 'integer' },
  }, (args, exec) => connection.request('/api/assistant', exec, { method: 'POST', body: args }));

  register('jxl.query', '读取与校园网页完全相同的业务 API，按当前登录账号权限返回。只报告返回的数据；dataMode=cloud-demo 表示云端演示库。', {
    page: { type: 'string', required: true, enum: ['dashboard', 'students', 'movements', 'events', 'messages', 'unread-count'] },
    keyword: { type: 'string' },
  }, ({ page, keyword }, exec) => {
    const path = page === 'unread-count' ? 'messages/unread-count' : page;
    const query = new URLSearchParams({ limit: '20' });
    if (keyword) query.set('q', keyword);
    return connection.request(`/api/${path}?${query}`, exec);
  });
  register('jxl.smart_digest', '复用网页版智能消息摘要。返回云端实际结果；如果规则降级，明确说明。', {}, (_, exec) => connection.request('/api/messages/smart-digest', exec, { method: 'POST', body: {} }));

  // ── 直读业务 API 的状态工具（2026-09-05）───────────────────────────────
  // 教训：assistant 端点依赖校园云端 AI，provider 不可用时会降级成没有数据的
  // 固定话术（"provider-unavailable"）——Mochi 会如实转述成「查不到」。高频查询
  // 必须直读 /api/movements|events|dashboard 等业务端点（与小组件同源、按当前
  // 连接如实返回），assistant 只留作透传备用。

  // Worker 的 /movements 忽略客户端 limit，并在服务端固定 LIMIT 100；这里显式
  // 传 active 条件并在每个聚合结果中公开这个上限，不能把本次返回数说成总人数。
  const readMovements = async (exec, activeOnly = true) => {
    const response = await connection.request(`/api/movements?active=${activeOnly ? 'true' : 'false'}`, exec);
    const rawItems = responseItems(response, 'movements');
    return {
      response,
      rawItems,
      activeOnly,
      items: activeOnly ? rawItems.filter((movement) => ACTIVE_MOVEMENT_STATUSES.has(normalize(movement.status))) : rawItems,
    };
  };
  const readEvents = async (exec, limit) => {
    const response = await connection.request(`/api/events?limit=${limit}`, exec);
    const result = response?.result;
    return {
      response,
      items: responseItems(response, 'events'),
      page: result?.page,
      limit: result?.limit,
      hasMore: result?.hasMore,
    };
  };
  const readDashboard = async (exec) => {
    const response = await connection.request('/api/dashboard?limit=8', exec);
    const dashboard = response?.result;
    if (!dashboard || typeof dashboard !== 'object' || Array.isArray(dashboard)) throw invalidPayload('dashboard');
    return { response, dashboard };
  };
  const summarizeMovement = (m) => ({
    id: m.id, 学生: m.studentName, 班级: m.className, 目的地: m.destination,
    状态: m.status, 原因: m.reasonCategory, 超时未归: Boolean(m.arrivalOverdueAt || m.returnOverdueAt),
  });
  const summarizeEvent = (e) => ({
    id: e.id, 学生: e.studentName, 班级: e.className, 类别: e.category,
    紧急度: e.urgency, 措施: e.measure, 状态: e.status, 到访时间: e.visitedAt,
  });
  const byKeyword = (m, keyword) => {
    const k = String(keyword || '').trim();
    if (!k) return true;
    return [m.studentName, m.className, m.destination, m.status].some((v) => String(v || '').includes(k));
  };

  for (const toolName of ['campus_query_student', 'jxl.student_query']) {
    register(toolName, '查询已有学生流动单；空结果只代表没有匹配的流动记录，不能据此判断学生不存在。按姓名登记新放行申请时，应先调用 jxl.student_directory_search。', studentParameters, async ({ keyword = '', status, onlyOverdue }, exec) => {
      const requested = String(status || '').trim();
      // 已返班只在 active=false 的历史流动中查 CLOSED；不能先读 active 列表再
      // 报 "returned=0"。其他状态保持当前活跃流动范围。
      const movements = await capture('movements', () => readMovements(exec, requested !== 'returned'));
      const metadata = queryMetadata(connection, [movements]);
      if (!movements.ok) return { ...metadata, count: null, items: null, 范围: null };
      let items = movements.value.items;
      if (requested) items = items.filter((movement) => matchesStudentStatus(movement, requested));
      if (onlyOverdue) items = items.filter((m) => m.arrivalOverdueAt || m.returnOverdueAt);
      items = items.filter((m) => byKeyword(m, keyword));
      const shown = items.slice(0, DISPLAY_LIMIT);
      return {
        ...metadata,
        count: items.length,
        items: shown.map(summarizeMovement),
        范围: movementRange(movements.value, items.length, shown.length),
      };
    });
  }
  register('jxl.student_directory_search', '按姓名、学号或班级查询当前教师授权范围内的真实学生目录。即使学生没有任何流动单也能返回。若用户已要求创建放行申请且结果唯一，下一步必须调用 jxl.movement_request_create；不得先回复Markdown伪卡或让用户点击不存在的按钮。', {
    keyword: { type: 'string', required: true, description: '学生姓名、学号或班级关键词。' },
    limit: { type: 'integer', description: '最多返回数量，默认10，范围1到20。' },
  }, async ({ keyword, limit = 10 }, exec) => {
    const query = new URLSearchParams({
      search: String(keyword).trim(),
      limit: String(Math.max(1, Math.min(20, Math.floor(limit)))),
    });
    const response = await connection.request(`/api/students?${query}`, exec);
    return {
      ...response,
      workflow: {
        fact: '这是学生目录结果，不是放行申请。',
        requiredNextToolWhenCreating: 'jxl.movement_request_create',
        approvalRule: '必须实际调用创建工具才会出现原生确认卡；不得用Markdown或文字按钮替代。',
      },
    };
  });
  register('jxl.clinic_status', '查询授权范围内医务室相关学生：合并流动单（目的地=医务室）与医务事件（就诊/留观中），与医务小组件同源。', { onlyOverdue: { type: 'boolean' } }, async ({ onlyOverdue }, exec) => {
    const [movements, events] = await Promise.all([
      capture('movements', () => readMovements(exec, true)),
      capture('events', () => readEvents(exec, 30)),
    ]);
    const metadata = queryMetadata(connection, [movements, events]);
    let flow = movements.ok ? movements.value.items.filter((m) => normalize(m.destination) === 'INFIRMARY') : null;
    if (onlyOverdue && flow !== null) flow = flow.filter((m) => m.arrivalOverdueAt || m.returnOverdueAt);
    let evs = events.ok
      ? events.value.items.filter((e) => !TERMINAL_EVENT_STATUSES.has(String(e.status || '').trim()))
      : null;
    const shownFlow = flow?.slice(0, DISPLAY_LIMIT) ?? null;
    const shownEvents = evs?.slice(0, DISPLAY_LIMIT) ?? null;
    return {
      ...metadata,
      流动单: movements.ok
        ? { count: flow.length, items: shownFlow.map(summarizeMovement), 范围: movementRange(movements.value, flow.length, shownFlow.length) }
        : { count: null, items: null, error: movements.error },
      医务事件: events.ok
        ? {
          count: evs.length,
          计数说明: 'count 仅表示本页匹配记录；events 接口不提供总数。',
          items: shownEvents.map(summarizeEvent),
          范围: eventRange(events.value, evs.length, shownEvents.length),
          ...(onlyOverdue ? {
            filterStatus: 'unsupported',
            filterNotice: 'events 接口不返回 overdueAt；医务事件未按 onlyOverdue 筛选，不能据此判断没有超时事件。',
          } : {}),
        }
        : { count: null, items: null, error: events.error },
    };
  });
  register('jxl.dorm_status', '查询授权范围内宿舍相关学生流动（直读流动单业务 API，与"学生放行与返班"小组件同源）。', { building: { type: 'string' }, floor: { type: 'integer' } }, async ({ building = '', floor }, exec) => {
    const movements = await capture('movements', () => readMovements(exec, true));
    const metadata = queryMetadata(connection, [movements]);
    if (!movements.ok) return { ...metadata, count: null, items: null, 范围: null };
    let items = movements.value.items.filter((m) => normalize(m.destination) === 'DORMITORY');
    const b = String(building).trim();
    const requestedFloor = Number.isInteger(floor) ? floor : undefined;
    // canonical MovementView 没有楼栋/楼层字段。不能对整段 JSON 模糊匹配后把
    // "无匹配" 报成某层无人；保留授权范围内结果，并显式说明筛选未被执行。
    const unsupportedLocationFilter = b || requestedFloor !== undefined;
    const shown = items.slice(0, DISPLAY_LIMIT);
    return {
      ...metadata,
      count: items.length,
      items: shown.map(summarizeMovement),
      范围: movementRange(movements.value, items.length, shown.length),
      ...(unsupportedLocationFilter ? {
        filterStatus: 'unsupported',
        filter: { building: b || undefined, floor: requestedFloor },
        filterNotice: '当前流动单契约不提供楼栋或楼层字段；结果未按该位置筛选，不能据此判断该楼层无人。',
      } : {}),
    };
  });
  register('jxl.campus_status', '校园状态总览：待办计数、超时、在途学生与最近关键事件（直读 dashboard/movements 业务 API，与"班主任待办"小组件同源）。', { topic: { type: 'string', description: '可选关注点，仅作提示，不影响返回结构。' } }, async (_args, exec) => {
    const [dash, movements, events] = await Promise.all([
      capture('dashboard', () => readDashboard(exec)),
      capture('movements', () => readMovements(exec, true)),
      capture('events', () => readEvents(exec, 8)),
    ]);
    const metadata = queryMetadata(connection, [dash, movements, events]);
    const dashboard = dash.ok ? dash.value.dashboard : null;
    const dashboardCounts = dashboard?.counts && typeof dashboard.counts === 'object' && !Array.isArray(dashboard.counts)
      ? dashboard.counts
      : null;
    const activeItems = movements.ok ? movements.value.items : null;
    const eventItems = events.ok ? events.value.items : null;
    const shownActive = activeItems?.slice(0, DISPLAY_LIMIT) ?? null;
    return {
      ...metadata,
      counts: dashboardCounts,
      超时待办: dashboardCount(dashboard, 'overdue'),
      待跟进事件: dashboardCount(dashboard, 'active'),
      未读消息: dashboardCount(dashboard, 'unread'),
      在途学生: shownActive?.map(summarizeMovement) ?? null,
      在途范围: movements.ok ? movementRange(movements.value, activeItems.length, shownActive.length) : null,
      最近事件: Array.isArray(dashboard?.events) ? dashboard.events.slice(0, 8) : null,
      最近医务记录: eventItems?.slice(0, 8).map(summarizeEvent) ?? null,
    };
  });
  register('jxl.health_events', '读取当前账号授权的医务事件（直读业务 API，与医务相关小组件同源）。', { keyword: { type: 'string' }, urgency: { type: 'string' }, limit: { type: 'number' } }, ({ keyword, urgency, limit = 20 }, exec) => {
    const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(30, Math.floor(limit)))) });
    if (keyword) query.set('q', keyword);
    if (urgency) query.set('urgency', urgency);
    return connection.request(`/api/events?${query}`, exec);
  });
  register('jxl.message', '读取本人校内收件箱或未读数量；不发送、不将消息标为已读。', { box: { type: 'string', enum: ['inbox', 'sent', 'unread'] } }, ({ box = 'inbox' }, exec) => {
    if (box === 'sent') throw new Error('现有云端 API 不提供独立已发送列表，请到事件详情查看已发送消息。');
    return connection.request(box === 'unread' ? '/api/messages/unread-count' : '/api/messages?limit=20', exec);
  });

  // 只读详情四件套（2026-09-05）：让 Mochi 能调动小组件里的全部知识——
  // 放行与返班（详情）、学生档案（卡）、事件与协作消息往来、事实统计。
  register('jxl.movement_detail', '读取单条放行/返班流动单详情（状态时间线、学生、审批记录），与学生放行与返班小组件同源。ID 来自流动单列表，不得猜测。', { movementId: { type: 'string', required: true, description: '流动单编号或 ID（来自放行列表查询）。' } }, ({ movementId }, exec) => connection.request(`/api/movements/${encodeURIComponent(String(movementId).trim())}`, exec));
  register('jxl.student_card', '读取单个学生的档案卡（基本信息、班级、当前状态），与班级学生档案小组件同源。关键字来自学生列表，不得猜测。', { keyword: { type: 'string', required: true, description: '学生姓名或学号。' } }, ({ keyword }, exec) => connection.request(`/api/students/card/${encodeURIComponent(String(keyword).trim())}`, exec));
  register('jxl.event_detail', '读取单条校园/医务事件详情及其协作消息往来，与班级协作消息小组件同源。ID 来自事件或消息列表，不得猜测。', { eventId: { type: 'integer', required: true, description: '事件 ID。' } }, async ({ eventId }, exec) => {
    const id = Math.floor(eventId);
    const detail = await connection.request(`/api/events/${id}`, exec);
    const thread = await connection.request(`/api/events/${id}/messages`, exec).catch(() => null);
    return { ...detail, thread: thread?.result ?? null };
  });
  register('jxl.analytics', '读取学生流动事实统计（按班级/年级聚合），与本班事实统计小组件同源。只报告返回的数字，不得推算额外结论。', { level: { type: 'string', enum: ['CLASS', 'GRADE', 'SCHOOL'], description: '聚合粒度，默认 CLASS。' } }, ({ level = 'CLASS' }, exec) => connection.request(`/api/analytics/movements?level=${encodeURIComponent(level)}`, exec));

  // ── Mochi 传话网络（foundation PHASE_4，2026-09-05）──────────────────
  // 六端各有一个自己的 Mochi；服务器只投递一句有界文本并保存回执。
  // 红线：应答永远由人决定——写操作（带话/登记/替主人回话）一律过审批闸，
  // Mochi 只能"投递"，不能替收件人答应任何事。
  register('jxl.relay_list', '查看主人的 Mochi 传话箱：收到的/发出的传话与寻物委托及其回音。返回值已按「需要我回应 / 收到的传话 / 发出的传话」分组摘要，直接照着读，不要编造。', {}, async (_args, exec) => {
    const response = await connection.request('/api/assistant/relay', exec, { method: 'POST', body: {} });
    const { result } = response;
    const r = result ?? {};
    const incoming = Array.isArray(r.incoming) ? r.incoming : [];
    const outgoing = Array.isArray(r.outgoing) ? r.outgoing : [];
    // glm-4-flash 读长 JSON 会编造（2026-09-05 实测：3 条发出被答成"没有"）——
    // 这里先消化成紧凑中文摘要，模型照抄即可。
    const brief = (m) => ({
      id: m.id,
      对方: m.peerName,
      对方角色: m.peerRole,
      类型: m.kind === 'request' ? `寻物:${m.item || ''}` : '带话',
      内容: String(m.body || '').replace(/^[^：]{1,24}的 Mochi 替主人(带话|找东西)：/, ''),
      状态: m.status === 'pending' ? '待回应' : m.status === 'accepted' ? '已答应' : '已婉拒',
      ...(m.reply ? { 回话: m.reply } : {}),
      时间: m.createdAt,
    });
    const pendingIncoming = incoming.filter((m) => m.status === 'pending');
    const answeredOutgoing = outgoing.filter((m) => m.status !== 'pending');
    const waitingOutgoing = outgoing.filter((m) => m.status === 'pending');
    // 一句话总述：模型可直接照读，避免把"发出的待回音"误读成"等我来回应"。
    const 摘要 = pendingIncoming.length > 0
      ? `有 ${pendingIncoming.length} 条别人托给你的传话等你回应：${pendingIncoming.map((m) => `${m.peerName}的${m.kind === 'request' ? '寻物请求' : '带话'}`).join('、')}。`
      : waitingOutgoing.length > 0
        ? `没有等你回应的传话；你发出 ${waitingOutgoing.length} 条还在等对方回音${answeredOutgoing.length ? `，另有 ${answeredOutgoing.length} 条已有回音` : ''}。`
        : outgoing.length === 0
          ? '传话箱是空的，没有收到也没有发出过传话。'
          : `没有等你回应的传话；发出的 ${outgoing.length} 条都已有回音。`;
    return {
      source: response.source,
      dataMode: response.dataMode,
      productionVerified: false,
      sourceNotice: sourceNotice(response.dataMode, true),
      摘要,
      需要我回应: pendingIncoming.length,
      收到的传话: incoming.map(brief),
      发出的传话: outgoing.map(brief),
    };
  });
  register('jxl.relay_find', '【底层】在全校共享登记里查一个东西名（只查登记不投递）。日常"帮我找某物"请用 mochi.find（它先查登记、未命中再走任务派发）；本工具只在主人明确要求"只查登记"时使用。', {
    item: { type: 'string', required: true, description: '要找的东西名（≤64 字），来自主人原话。' },
  }, ({ item }, exec) => connection.request('/api/assistant/relay/find', exec, { method: 'POST', body: { item: String(item || '').trim().slice(0, 64) } }));
  register('jxl.relay_send', '替主人给本校同事的 Mochi 带一句口信（kind=message）或委托寻物（kind=request，只投递东西名）。日常"带句话/告诉某人"用本工具；"问一句能不能…"（换课/借物/约时间）用 mochi.ask；"找某物"用 mochi.find。发送前必须向主人展示接收人与投递内容并获人工确认；仅在服务器返回 ok=true 后才能报告已送达。', {
    peerName: { type: 'string', required: true, description: '同事姓名或称呼（李老师/李医生均可，服务器负责对名册）。' },
    note: { type: 'string', description: '要带的话（≤120 字）；kind=message 时必填。' },
    kind: { type: 'string', enum: ['message', 'request'], description: '默认 message。' },
    item: { type: 'string', description: 'kind=request 时要找的东西名（≤64 字）。' },
  }, async (args, exec) => {
    const kind = args.kind === 'request' ? 'request' : 'message';
    const note = String(args.note || '').trim();
    const item = String(args.item || '').trim().slice(0, 64);
    const peerName = String(args.peerName || '').trim();
    if (!peerName) throw new Error('请先确认要托给哪位同事。');
    if (kind === 'request' && !item) throw new Error('寻物委托需要说明要找的东西。');
    if (kind === 'message' && (!note || note.length > 120)) throw new Error('传话正文需要 1 至 120 字。');
    const binding = await connection.binding(exec);
    const approval = ctx.get?.('approval');
    if (!approval) throw new Error('【未发送】当前会话没有人工确认通道，传话没有发出去。请如实告知主人，不要说成已发送。');
    const payload = kind === 'request' ? { peerName, kind, item } : { peerName, kind, note };
    const subject = kind === 'request' ? `托TA的 Mochi 找「${item}」` : `带话：\n\n${note}`;
    // Memoize the entire attempt, including uncertain failures. Never resend silently.
    let attempts = sends.get(binding.session);
    if (!attempts) sends.set(binding.session, attempts = new Map());
    const key = JSON.stringify(['relay', payload]);
    if (attempts.has(key)) return attempts.get(key);
    const attempt = (async () => {
      const decision = await approval.request({ agent: exec.agent, toolName: 'jxl.relay_send', callId: exec.callId, signal: exec.signal,
        reason: `以 ${binding.user.name} 的 Mochi 名义，给「${peerName}」的 Mochi ${subject}\n\n（服务器只投递这一句话；是否答应由对方决定。）` });
      if (decision !== 'allowed-once') { attempts.delete(key); throw new Error('【未发送】传话没有发出去：主人未确认。请如实告诉主人这条传话没有发出，不要说成已发送。'); }
      return connection.request('/api/assistant/relay/send', exec, { method: 'POST', body: payload, expectedUserId: binding.user.id });
    })();
    attempts.set(key, attempt);
    return attempt;
  });
  register('jxl.relay_register', '把主人的东西登记进全校共享登记（登记后全校 Mochi 能检索到名字；是否外借仍由主人决定）。登记前必须向主人确认物名。', {
    item: { type: 'string', required: true, description: '东西名（≤64 字）。' },
  }, async (args, exec) => {
    const item = String(args.item || '').trim().slice(0, 64);
    if (!item) throw new Error('登记需要说明要登记的东西名。');
    const binding = await connection.binding(exec);
    const approval = ctx.get?.('approval');
    if (!approval) throw new Error('【未登记】当前会话没有人工确认通道，没有登记。请如实告知主人。');
    const decision = approval.request({ agent: exec.agent, toolName: 'jxl.relay_register', callId: exec.callId, signal: exec.signal,
      reason: `以 ${binding.user.name} 的名义把「${item}」登记进全校共享登记（全校 Mochi 可检索到这个名字；是否外借仍由主人决定）。` });
    return Promise.resolve(decision).then((outcome) => {
      if (outcome !== 'allowed-once') throw new Error('【未登记】东西没有登记：主人未确认。请如实告知，不要谎称已登记。');
      return connection.request('/api/assistant/relay/register', exec, { method: 'POST', body: { item }, expectedUserId: binding.user.id });
    });
  });
  register('jxl.relay_respond', '替主人回应一条收到的传话：accept=答应 / decline=婉拒，可附 120 字内回话。是否答应由主人决定——必须先念出传话内容与拟定回话，获人工确认后才提交；服务器对寻物请求会在主人的登记里实查一次。', {
    id: { type: 'integer', required: true, description: '传话 ID（来自 jxl.relay_list 的 incoming 列表）。' },
    action: { type: 'string', enum: ['accept', 'decline'], required: true },
    note: { type: 'string', description: '附带回话（≤120 字），省略时寻物请求由服务器自动在登记里找。' },
  }, async (args, exec) => {
    const id = Math.floor(args.id);
    const action = args.action === 'accept' ? 'accept' : 'decline';
    const note = String(args.note || '').trim().slice(0, 120);
    if (!id) throw new Error('请从传话箱列表里确认要回应的那条（ID 不得猜测）。');
    const binding = await connection.binding(exec);
    const approval = ctx.get?.('approval');
    if (!approval) throw new Error('【未回应】当前会话没有人工确认通道，没有回应。请如实告知主人。');
    const decision = approval.request({ agent: exec.agent, toolName: 'jxl.relay_respond', callId: exec.callId, signal: exec.signal,
      reason: `以 ${binding.user.name} 的名义${action === 'accept' ? '答应' : '婉拒'}传话 #${id}${note ? `，并回话：\n\n${note}` : ''}\n\n（应答以这条确认卡为准——主人确认即是决定。）` });
    return Promise.resolve(decision).then((outcome) => {
      if (outcome !== 'allowed-once') throw new Error('【未回应】传话没有被回应：主人未确认。请如实告知，不要谎称已回应。');
      return connection.request('/api/assistant/relay/respond', exec, { method: 'POST', body: note ? { id, action, note } : { id, action }, expectedUserId: binding.user.id });
    });
  });

  register('message.send', '向指定校园事件中的允许收件人发送 1 至 240 字消息。必须先展示正文及事件，并由 Harness 人工确认。仅在服务器返回 message 后报告发送成功；网络结果不明不得重试。', {
    eventId: { type: 'integer', required: true, description: '从校园事件查询结果获得的事件 ID，不得猜测。' },
    body: { type: 'string', required: true },
    recipientIds: { type: 'array', items: { type: 'integer' }, description: '已核实的收件人 ID；省略时发送给该事件全部允许收件人。' },
  }, async (args, exec) => {
    if (args.eventId <= 0 || !args.body.trim() || args.body.length > 240) throw new Error('请提供有效事件和 1 至 240 字正文。');
    const binding = await connection.binding(exec);
    const approval = ctx.get?.('approval');
    if (!approval) throw new Error('当前会话没有人工确认通道，消息未发送。');
    // Memoize the entire attempt, including uncertain failures. Never resend silently.
    let attempts = sends.get(binding.session);
    if (!attempts) sends.set(binding.session, attempts = new Map());
    const key = JSON.stringify(args);
    if (attempts.has(key)) return attempts.get(key);
    const attempt = (async () => {
      const decision = await approval.request({ agent: exec.agent, toolName: 'message.send', callId: exec.callId, signal: exec.signal,
        reason: `以 ${binding.user.name} 的校园账号，向事件 #${args.eventId} 的${args.recipientIds?.length ? '指定收件人 ' + args.recipientIds.join('、') : '全部允许收件人'}发送：\n\n${args.body}` });
      if (decision !== 'allowed-once') { attempts.delete(key); throw new Error('消息未发送：本次操作未获确认。'); }
      return connection.request(`/api/events/${args.eventId}/messages`, exec, { method: 'POST', body: { body: args.body, ...(args.recipientIds?.length ? { recipientIds: args.recipientIds } : {}) }, expectedUserId: binding.user.id });
    })();
    attempts.set(key, attempt);
    return attempt;
  });
  register('jxl.movement_request_list','读取当前教师有权审批的待处理放行申请；返回代录人、来源、学生、目的地和版本。',{},(_args,exec)=>connection.request('/api/movement-requests',exec));
  register('jxl.movement_request_create','实际登记PENDING放行申请并呈现唯一真实的原生确认卡。目录查到唯一学生且用户要求创建时必须调用本工具；禁止先回复Markdown伪卡或声称有普通按钮。只创建待审批申请，不代表放行。',{studentId:{type:'integer',required:true},destination:{type:'string',enum:['INFIRMARY','DORMITORY'],required:true},reasonCategory:{type:'string',required:true},expectedArrivalMinutes:{type:'integer',required:true},idempotencyKey:{type:'string',required:true}},async(args,exec)=>{const binding=await connection.binding(exec),approval=ctx.get?.('approval');if(!approval)throw new Error('没有人工确认通道，申请未登记。');const detail=await connection.request(`/api/students/${encodeURIComponent(args.studentId)}`,exec),student=detail?.result?.student??detail?.result;if(!student?.name||!student?.className)throw new Error('无法读取该学生的授权信息，申请未登记。');const destination=args.destination==='INFIRMARY'?'医务室':'宿舍';const decision=await approval.request({agent:exec.agent,toolName:'jxl.movement_request_create',callId:exec.callId,signal:exec.signal,reason:`${binding.user.name} 将代学生登记放行申请：

学生：${student.name}（${student.className}）
申请来源：${binding.user.name} 代录
目的地：${destination}
事由：${args.reasonCategory}
预计到达：${args.expectedArrivalMinutes} 分钟
当前状态：尚未创建

确认后仅进入待审批，不代表已经放行。`});if(decision!=='allowed-once')throw userDeclined('放行申请未登记。');return connection.request('/api/movement-requests',exec,{method:'POST',body:args,expectedUserId:binding.user.id});});
  register('jxl.movement_request_decide','审批一条待处理放行申请。approve 会创建正式放行单，reject 会拒绝；必须先展示申请并由教师在确认卡决定。',{reference:{type:'string',required:true},action:{type:'string',enum:['approve','reject'],required:true},expectedVersion:{type:'integer',required:true},idempotencyKey:{type:'string',required:true},reason:{type:'string'}},async(args,exec)=>{const binding=await connection.binding(exec),approval=ctx.get?.('approval');if(!approval)throw new Error('没有人工确认通道，申请未处理。');const detail=await connection.request(`/api/movement-requests/${encodeURIComponent(args.reference)}`,exec),request=detail?.result?.request??detail?.result;if(!request||request.status!=='PENDING'||request.version!==args.expectedVersion)throw new Error('申请状态或版本已经变化，请重新读取后再审批。');const source=request.requestOrigin==='TEACHER_RECORDED'?`${request.requestedByName} 代学生登记`:request.requestedByName;const decision=await approval.request({agent:exec.agent,toolName:'jxl.movement_request_decide',callId:exec.callId,signal:exec.signal,reason:`${binding.user.name} 将${args.action==='approve'?'批准并正式放行':'拒绝'}这条待审批申请：\n\n学生：${request.studentName}（${request.className}）\n申请来源：${source}\n目的地：${request.destination==='INFIRMARY'?'医务室':'宿舍'}\n事由：${request.reasonCategory}\n预计到达：${request.expectedArrivalMinutes} 分钟\n申请编号：${request.publicReference}\n当前状态：待审批${args.action==='reject'?`\n拒绝原因：${String(args.reason||'').trim()||'未填写'}`:''}`});if(decision!=='allowed-once')throw new Error('申请未处理：教师未确认。');return connection.request(`/api/movement-requests/${encodeURIComponent(args.reference)}/${args.action}`,exec,{method:'POST',body:{expectedVersion:args.expectedVersion,idempotencyKey:args.idempotencyKey,...(args.reason?{reason:args.reason}:{})},expectedUserId:binding.user.id});});
  register('jxl.movement_transition', '推进一条正式放行单的真实状态：arrive=到达、leave=离开目的地返班、confirm-return=教师确认返班。按当前账号角色由校园服务复核权限；每次写入必须显示原生人工确认卡。', {
    reference: { type: 'string', required: true },
    action: { type: 'string', enum: ['arrive', 'leave', 'confirm-return'], required: true },
    expectedVersion: { type: 'integer', required: true },
    idempotencyKey: { type: 'string', required: true },
  }, async (args, exec) => {
    const binding = await connection.binding(exec);
    const arrivalRole = ['NURSE', 'DORM_STAFF'].includes(binding.user.role);
    const returnRole = ['HEAD_TEACHER', 'SUBJECT_TEACHER'].includes(binding.user.role);
    if ((args.action === 'confirm-return' && !returnRole) || (args.action !== 'confirm-return' && !arrivalRole)) throw new Error('当前校园账号角色不能执行该流动步骤。');
    const approval = ctx.get?.('approval');
    if (!approval) throw new Error('没有人工确认通道，流动状态未更新。');
    const detail = await connection.request(`/api/movements/${encodeURIComponent(args.reference)}`, exec);
    const movement = detail?.result?.movement ?? detail?.result;
    if (!movement || movement.version !== args.expectedVersion) throw new Error('流动单状态或版本已经变化，请重新读取。');
    const labels = { arrive: '确认学生已到达', leave: '确认学生已离开目的地并开始返班', 'confirm-return': '确认学生已经返班' };
    const decision = await approval.request({ agent: exec.agent, toolName: 'jxl.movement_transition', callId: exec.callId, signal: exec.signal,
      reason: `${binding.user.name} 将${labels[args.action]}：\n\n学生：${movement.studentName}（${movement.className}）\n流动单：${movement.publicReference}\n当前状态：${movement.status}\n当前版本：${movement.version}` });
    if (decision !== 'allowed-once') throw userDeclined('流动状态未更新。');
    return connection.request(`/api/movements/${encodeURIComponent(args.reference)}/${args.action}`, exec, { method: 'POST', body: { expectedVersion: args.expectedVersion, idempotencyKey: args.idempotencyKey }, expectedUserId: binding.user.id });
  });
  register('jxl.medical_event_create', '校医为已核对身份的学生创建真实医务处置记录。必须先读取学生信息并显示原生人工确认卡；校园服务再次校验校医角色和字段枚举。', {
    studentId: { type: 'integer', required: true }, category: { type: 'string', enum: ['身体不适', '轻微外伤', '运动不适', '情绪关怀', '常规测量', '其他情况'], required: true },
    urgency: { type: 'string', enum: ['普通', '需关注', '紧急'], required: true }, measure: { type: 'string', enum: ['初步检查', '休息观察', '基础处理', '联系教师', '联系家长', '建议就医'], required: true },
    status: { type: 'string', enum: ['检查中', '留观中', '已通知教师', '已通知家长', '准备返班', '已返班', '家长接走', '转诊', '记录结束'], required: true }, note: { type: 'string', required: true }, idempotencyKey: { type: 'string', required: true },
  }, async (args, exec) => {
    const binding = await connection.binding(exec), approval = ctx.get?.('approval');
    if (binding.user.role !== 'NURSE') throw new Error('只有校医账号可以创建医务记录。');
    if (!approval) throw new Error('没有人工确认通道，医务记录未创建。');
    const detail = await connection.request(`/api/students/${encodeURIComponent(args.studentId)}`, exec), student = detail?.result?.student ?? detail?.result;
    if (!student?.name) throw new Error('无法核对学生身份，医务记录未创建。');
    const decision = await approval.request({ agent: exec.agent, toolName: 'jxl.medical_event_create', callId: exec.callId, signal: exec.signal,
      reason: `${binding.user.name} 将创建医务处置记录：\n\n学生：${student.name}（${student.className}）\n本人核验：请校医确认面前学生与上述档案确为同一人\n情况：${args.category}\n紧急度：${args.urgency}\n处置：${args.measure}\n状态：${args.status}\n备注：${args.note}` });
    if (decision !== 'allowed-once') throw userDeclined('医务记录未创建。');
    return connection.request('/api/events', exec, { method: 'POST', body: { ...args, identityVerified: true }, expectedUserId: binding.user.id });
  });
  register('jxl.movement_link_medical_event', '校医把真实医务事件关联到已到达的放行单；必须使用查询所得编号和版本，并经原生人工确认卡。', {
    reference: { type: 'string', required: true }, medicalEventId: { type: 'integer', required: true },
    expectedVersion: { type: 'integer', required: true }, idempotencyKey: { type: 'string', required: true },
  }, async (args, exec) => {
    const binding = await connection.binding(exec), approval = ctx.get?.('approval');
    if (binding.user.role !== 'NURSE') throw new Error('只有校医账号可以关联医务事件。');
    if (!approval) throw new Error('没有人工确认通道，医务事件未关联。');
    const [movementResult, eventResult] = await Promise.all([
      connection.request(`/api/movements/${encodeURIComponent(args.reference)}`, exec),
      connection.request(`/api/events/${args.medicalEventId}`, exec),
    ]);
    const movement = movementResult?.result?.movement ?? movementResult?.result;
    const event = eventResult?.result?.event ?? eventResult?.result;
    if (!movement || !event || movement.version !== args.expectedVersion) throw new Error('流动单或医务事件状态已经变化，请重新读取。');
    if (movement.studentId !== event.studentId) throw new Error('流动单与医务事件属于不同学生，不能关联。');
    const decision = await approval.request({ agent: exec.agent, toolName: 'jxl.movement_link_medical_event', callId: exec.callId, signal: exec.signal,
      reason: `${binding.user.name} 将关联医务处置：\n\n学生：${movement.studentName}（${movement.className}）\n流动单：${movement.publicReference}，状态 ${movement.status}，版本 ${movement.version}\n医务事件：#${args.medicalEventId}，${event.category} / ${event.measure} / ${event.status}` });
    if (decision !== 'allowed-once') throw userDeclined('医务事件未关联。');
    return connection.request(`/api/movements/${encodeURIComponent(args.reference)}/link-medical-event`, exec, { method: 'POST', body: { medicalEventId: args.medicalEventId, expectedVersion: args.expectedVersion, idempotencyKey: args.idempotencyKey }, expectedUserId: binding.user.id });
  });
  register('jxl.medical_event_status', '校医更新真实医务事件状态。必须先读取事件并显示当前状态与目标状态的原生人工确认卡。', {
    eventId: { type: 'integer', required: true }, status: { type: 'string', enum: ['检查中', '留观中', '已通知教师', '已通知家长', '准备返班', '已返班', '家长接走', '转诊', '记录结束'], required: true }, expectedVersion: { type: 'integer', required: true }, idempotencyKey: { type: 'string', required: true },
  }, async (args, exec) => {
    const binding = await connection.binding(exec), approval = ctx.get?.('approval');
    if (binding.user.role !== 'NURSE') throw new Error('只有校医账号可以更新医务状态。');
    if (!approval) throw new Error('没有人工确认通道，医务状态未更新。');
    const detail = await connection.request(`/api/events/${args.eventId}`, exec), event = detail?.result?.event ?? detail?.result;
    if (!event) throw new Error('医务事件不存在或无权查看。');
    const decision = await approval.request({ agent: exec.agent, toolName: 'jxl.medical_event_status', callId: exec.callId, signal: exec.signal,
      reason: `${binding.user.name} 将更新医务事件 #${args.eventId}：\n\n学生：${event.studentName}\n当前状态：${event.status}\n目标状态：${args.status}` });
    if (decision !== 'allowed-once') throw userDeclined('医务状态未更新。');
    return connection.request(`/api/events/${args.eventId}/status`, exec, { method: 'PATCH', body: { status: args.status, expectedVersion: args.expectedVersion, idempotencyKey: args.idempotencyKey }, expectedUserId: binding.user.id });
  });
  ctx.logger?.info?.('[Mochi] 校园工具复用已登录账号的校园 API；无本机数据库或模拟结果兜底。');
}
