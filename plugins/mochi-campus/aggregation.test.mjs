import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from './index.mjs';

const exec = { agent: { session: {} }, callId: 'aggregation-test' };

function movement(id, status, destination, studentName = `学生${id}`) {
  return {
    id,
    studentName,
    className: '七年级一班',
    destination,
    status,
    reasonCategory: '测试',
    arrivalOverdueAt: null,
    returnOverdueAt: null,
  };
}

function event(id, status = '检查中') {
  return {
    id,
    studentName: `学生${id}`,
    className: '七年级一班',
    category: '不适',
    urgency: '普通',
    measure: '观察',
    status,
    visitedAt: '2026-09-05T08:00:00.000Z',
  };
}

function response(result, options = {}) {
  const source = options.source ?? 'https://campus.example.test';
  const dataMode = Object.hasOwn(options, 'dataMode') ? options.dataMode : 'campus-api';
  return { source, dataMode, account: { id: 1, name: '测试老师', role: 'HEAD_TEACHER' }, result };
}

function setup(route, origin = 'https://campus.example.test') {
  const calls = [];
  const connection = {
    origin,
    async request(path, receivedExec, options) {
      calls.push({ path, receivedExec, options });
      return route(path);
    },
  };
  const tools = new Map();
  apply({
    tools: { register(tool) { tools.set(tool.name, tool); } },
    get: () => undefined,
  }, connection);
  return { tools, calls };
}

const active = [
  movement(1, 'OUTBOUND', 'INFIRMARY', '前往医务室'),
  movement(2, 'ARRIVED', 'INFIRMARY', '医务室就诊'),
  movement(3, 'RETURNING', 'INFIRMARY', '医务室返班'),
  movement(4, 'OUTBOUND', 'DORMITORY', '前往宿舍'),
  movement(5, 'ARRIVED', 'DORMITORY', '宿舍到达'),
  movement(6, 'RETURNING', 'DORMITORY', '宿舍返班'),
];
const history = [
  movement(7, 'CLOSED', 'INFIRMARY', '已返班'),
  movement(8, 'CANCELLED', 'DORMITORY', '已取消'),
];
const clinicEvents = [
  event(31, '检查中'),
  event(33, '已返班'),
  event(34, '家长接走'),
  event(35, '转诊'),
  event(36, '记录结束'),
];

test('canonical movement status/destination mapping preserves cloud-demo provenance and scope', async () => {
  const { tools, calls } = setup((path) => {
    if (path === '/api/movements?active=true') return response({ items: active }, { source: 'https://demo.example.test', dataMode: 'cloud-demo' });
    if (path === '/api/movements?active=false') return response({ items: history }, { source: 'https://demo.example.test', dataMode: 'cloud-demo' });
    if (path === '/api/events?limit=30' || path === '/api/events?limit=8') {
      const limit = Number(new URL(path, 'https://campus.example.test').searchParams.get('limit'));
      return response({ items: clinicEvents, page: 3, limit, hasMore: false }, { source: 'https://demo.example.test', dataMode: 'cloud-demo' });
    }
    if (path === '/api/dashboard?limit=8') return response({ counts: { overdue: 0, active: 1, unread: 2 }, events: [event(32)] }, { source: 'https://demo.example.test', dataMode: 'cloud-demo' });
    throw new Error(`unexpected path ${path}`);
  });

  const student = tools.get('jxl.student_query');
  const inClinic = await student.execute({ status: 'in_clinic' }, exec);
  assert.deepEqual(inClinic.items.map((item) => item.学生), ['医务室就诊']);
  assert.equal(inClinic.source, 'https://demo.example.test');
  assert.equal(inClinic.dataMode, 'cloud-demo');
  assert.equal(inClinic.productionVerified, false);
  assert.match(inClinic.sourceNotice, /演示数据/);
  assert.equal(inClinic.queryStatus, 'complete');

  const inDorm = await student.execute({ status: 'in_dorm' }, exec);
  assert.deepEqual(inDorm.items.map((item) => item.学生), ['宿舍到达']);

  const out = await student.execute({ status: 'out' }, exec);
  assert.deepEqual(out.items.map((item) => item.学生), ['前往医务室', '医务室返班', '前往宿舍', '宿舍返班']);

  const returned = await student.execute({ status: 'returned' }, exec);
  assert.deepEqual(returned.items.map((item) => item.学生), ['已返班']);
  assert.equal(returned.范围.activeOnly, false);
  assert.ok(calls.some((call) => call.path === '/api/movements?active=false'), 'returned must read history rather than the active list');

  const clinic = await tools.get('jxl.clinic_status').execute({}, exec);
  assert.deepEqual(clinic.流动单.items.map((item) => item.学生), ['前往医务室', '医务室就诊', '医务室返班']);
  assert.equal(clinic.流动单.范围.总数, null);
  assert.deepEqual(clinic.医务事件.items.map((item) => item.状态), ['检查中'], 'canonical terminal event statuses must not be reported as active');
  assert.equal(clinic.医务事件.count, 1);
  assert.equal(clinic.医务事件.范围.page, 3);
  assert.equal(clinic.医务事件.范围.limit, 30);
  assert.equal(clinic.医务事件.范围.hasMore, false);
  assert.equal(clinic.医务事件.范围.本页返回记录数, 5);
  assert.equal(clinic.医务事件.范围.本页匹配记录数, 1);
  assert.equal(clinic.医务事件.范围.总数, null);
  assert.match(clinic.医务事件.计数说明, /本页匹配记录/);
  assert.match(clinic.医务事件.范围.说明, /本页匹配记录/);

  const overdueClinic = await tools.get('jxl.clinic_status').execute({ onlyOverdue: true }, exec);
  assert.equal(overdueClinic.流动单.count, 0, 'onlyOverdue still uses the movement fields that actually exist');
  assert.equal(overdueClinic.医务事件.count, 1, 'events without overdueAt must not be filtered into a fake zero');
  assert.equal(overdueClinic.医务事件.filterStatus, 'unsupported');
  assert.match(overdueClinic.医务事件.filterNotice, /不返回 overdueAt/);

  const dorm = await tools.get('jxl.dorm_status').execute({ building: '东楼', floor: 3 }, exec);
  assert.equal(dorm.count, 3, 'unsupported location filters must not turn available dorm records into zero');
  assert.equal(dorm.filterStatus, 'unsupported');
  assert.match(dorm.filterNotice, /不提供楼栋或楼层字段/);

  const campus = await tools.get('jxl.campus_status').execute({}, exec);
  assert.deepEqual(campus.在途学生.map((item) => item.学生), active.map((item) => item.studentName));
  assert.equal(campus.在途范围.服务端上限, 100);
  assert.equal(campus.在途范围.总数, null);
  assert.equal(campus.超时待办, 0, 'real zero from a valid dashboard remains zero');
});

test('partial and failed aggregation responses remain structured and never become zero results', async () => {
  const transportFailure = () => {
    const error = new Error('campus_session=do-not-leak');
    error.code = 'UPSTREAM_TIMEOUT';
    error.status = 503;
    throw error;
  };
  const partial = setup((path) => {
    if (path === '/api/movements?active=true') return transportFailure();
    if (path === '/api/events?limit=30') return response({ items: [event(41)] });
    throw new Error(`unexpected path ${path}`);
  });
  const clinic = await partial.tools.get('jxl.clinic_status').execute({}, exec);
  assert.equal(clinic.queryStatus, 'partial');
  assert.equal(clinic.流动单.count, null);
  assert.equal(clinic.流动单.items, null);
  assert.equal(clinic.医务事件.count, 1);
  assert.deepEqual(clinic.errors, [{ resource: 'movements', code: 'UPSTREAM_TIMEOUT', status: 503 }]);
  assert.ok(!JSON.stringify(clinic).includes('do-not-leak'), 'internal transport text must not reach a tool result');

  const allFailed = setup(() => transportFailure(), 'https://offline.example.test');
  const campus = await allFailed.tools.get('jxl.campus_status').execute({}, exec);
  assert.equal(campus.queryStatus, 'error');
  assert.equal(campus.dataMode, 'unknown');
  assert.match(campus.sourceNotice, /均未获得可用结果/);
  assert.equal(campus.source, 'https://offline.example.test');
  assert.equal(campus.counts, null);
  assert.equal(campus.超时待办, null);
  assert.equal(campus.待跟进事件, null);
  assert.equal(campus.未读消息, null);
  assert.equal(campus.在途学生, null);
  assert.equal(campus.errors.length, 3);
  assert.ok(!JSON.stringify(campus).includes('do-not-leak'));
});

test('missing or mixed dataMode is explicit, and malformed dashboard counters stay null', async () => {
  const missingMode = setup((path) => {
    if (path === '/api/movements?active=true') return response({ items: [] }, { dataMode: undefined });
    if (path === '/api/events?limit=8') return response({ items: [] }, { dataMode: undefined });
    if (path === '/api/dashboard?limit=8') return response({ counts: { overdue: null, active: '', unread: false }, events: [] }, { dataMode: undefined });
    throw new Error(`unexpected path ${path}`);
  });
  const missing = await missingMode.tools.get('jxl.campus_status').execute({}, exec);
  assert.equal(missing.queryStatus, 'complete');
  assert.equal(missing.dataMode, 'unknown');
  assert.equal(missing.missingDataMode, true);
  assert.match(missing.sourceNotice, /有可用结果/);
  assert.equal(missing.超时待办, null);
  assert.equal(missing.待跟进事件, null);
  assert.equal(missing.未读消息, null);

  const mixedMode = setup((path) => {
    if (path === '/api/movements?active=true') return response({ items: [] }, { dataMode: 'campus-api' });
    if (path === '/api/events?limit=8') return response({ items: [] }, { dataMode: 'cloud-demo' });
    if (path === '/api/dashboard?limit=8') return response({ counts: { overdue: 1, active: 2, unread: 3 }, events: [] }, { dataMode: 'cloud-demo' });
    throw new Error(`unexpected path ${path}`);
  });
  const mixed = await mixedMode.tools.get('jxl.campus_status').execute({}, exec);
  assert.equal(mixed.dataMode, 'mixed');
  assert.deepEqual(mixed.dataModes.sort(), ['campus-api', 'cloud-demo']);
  assert.match(mixed.sourceNotice, /多个数据模式/);

  const incompleteMode = setup((path) => {
    if (path === '/api/movements?active=true') return response({ items: [] }, { dataMode: undefined });
    if (path === '/api/events?limit=8') return response({ items: [], page: 1, limit: 8, hasMore: false }, { dataMode: undefined });
    if (path === '/api/dashboard?limit=8') return response({ counts: { overdue: 1, active: 2, unread: 3 }, events: [] }, { dataMode: 'campus-api' });
    throw new Error(`unexpected path ${path}`);
  });
  const incomplete = await incompleteMode.tools.get('jxl.campus_status').execute({}, exec);
  assert.equal(incomplete.queryStatus, 'complete');
  assert.equal(incomplete.dataMode, 'mixed', 'a declared mode cannot stand for successful responses that omit dataMode');
  assert.equal(incomplete.missingDataMode, true);
  assert.deepEqual(incomplete.dataModes, ['campus-api']);
  assert.match(incomplete.sourceNotice, /未声明 dataMode/);
});

test('a 100-record movement response is marked as potentially truncated rather than a campus total', async () => {
  const hundred = Array.from({ length: 100 }, (_, index) => movement(index + 100, 'OUTBOUND', 'DORMITORY'));
  const { tools } = setup((path) => {
    if (path === '/api/movements?active=true') return response({ items: hundred });
    throw new Error(`unexpected path ${path}`);
  });
  const result = await tools.get('jxl.student_query').execute({ status: 'out' }, exec);
  assert.equal(result.count, 100);
  assert.equal(result.items.length, 20);
  assert.equal(result.范围.接口返回记录数, 100);
  assert.equal(result.范围.可能截断, true);
  assert.equal(result.范围.总数, null);
  assert.match(result.范围.说明, /不代表全校总量/);
});
