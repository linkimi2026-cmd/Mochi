// mochi-memory 存储层单测（MOCHI-P5-MEM-02），风格同 mochi-dispatch/test.mjs。
// 衰减用可注入时钟（params.nowProvider）测试，不真的等 30 天。
import assert from 'node:assert/strict';
import { openStore, createStore, defaultDbPath, isSensitiveMemoryText,
  DECAY_AFTER_DAYS, DECAY_FACTOR, MIN_IMPORTANCE, STRENGTH_CAP, DEFAULT_TOP_K, TIGHTENED_TOP_K } from './mem-store.mjs';

const DAY = 86400000;

console.log('⓪ 冻结常量与默认 DB 路径');
assert.equal(DECAY_AFTER_DAYS, 30);
assert.equal(DECAY_FACTOR, 0.05);
assert.equal(MIN_IMPORTANCE, 0.15);
assert.equal(STRENGTH_CAP, 5);
assert.equal(DEFAULT_TOP_K, 8);
assert.equal(TIGHTENED_TOP_K, 5);
assert.equal(defaultDbPath('/tmp/dsh-x'), '/tmp/dsh-x/memory/mochi-memories.sqlite');

console.log('① note/recall 基本链路：中文长查询走 FTS，2 字查询走 LIKE 降级，scope 过滤');
{
  const store = createStore(openStore(':memory:'));
  const a = store.note({ kind: 'preference', content: '张老师偏好周五下午开教研会，不喜欢临时改课', source: 'user_statement' });
  assert.ok(a.id > 0);
  store.note({ kind: 'org_knowledge', content: '图书室每周三闭馆整理', summary: '图书室周三闭馆' });
  // 长查询 → FTS MATCH（含命中 summary 的行）
  const ftsHit = store.recall('周五下午开教研');
  assert.equal(ftsHit.tightened, false);
  assert.equal(ftsHit.topK, DEFAULT_TOP_K);
  assert.ok(ftsHit.memories.some((m) => m.content.includes('张老师偏好')));
  // FTS 同时检索 content 与 summary
  const summaryHit = store.recall('每周三闭馆整理');
  assert.ok(summaryHit.memories.some((m) => m.summary.includes('图书室周三闭馆')));
  // 「为什么Mochi知道这个」：来源中文映射 + 创建时间 + 召回次数
  const why = ftsHit.memories.find((m) => m.id === a.id)['为什么Mochi知道这个'];
  assert.ok(why.includes('用户陈述'));
  assert.ok(why.includes('创建于'));
  assert.ok(why.includes('已被召回'));
  // 2 字查询 → LIKE 降级（trigram 对 <3 字符查询返回空）
  const likeHit = store.recall('周五');
  assert.ok(likeHit.memories.some((m) => m.content.includes('张老师偏好')));
  // 空查询：不返回任何记忆
  assert.deepEqual(store.recall('   ').memories, []);
  // scope 过滤：作用域外的行不可见
  store.note({ kind: 'org_knowledge', content: '一年一班教室在三楼东侧', scopeId: 'class-1' });
  assert.equal(store.recall('一年一班教室', { scopeId: 'class-2' }).memories.length, 0);
  assert.ok(store.recall('一年一班教室').memories.length >= 1);
}

console.log('② 敏感写入护栏：六类关键词全抛错（note 与 supersede 都过闸）');
{
  const store = createStore(openStore(':memory:'));
  const samples = [
    '我的密码是123456', 'password: abc123', 'passwd 123', 'access token 值', 'api_key = sk-xxx',
    'the secret is out', '数据库密钥在抽屉', '身份证号 330106...',
    '期中成绩明细表', '本次成绩排名已公布', '期末成绩单待领',
    '病历摘要', '医疗报销单据', '初步诊断是流感',
  ];
  for (const content of samples) {
    assert.throws(() => store.note({ kind: 'preference', content }), /【未写入】敏感内容不进入长期记忆/);
  }
  // 摘要同样过闸
  assert.throws(() => store.note({ kind: 'preference', content: '正常内容', summary: '含密码的摘要' }), /【未写入】/);
  // supersede 的新内容同样过闸
  const ok = store.note({ kind: 'task_fact', content: '高二(3)班教室在二楼东侧' });
  assert.throws(() => store.supersede(ok.id, { content: '新教室带 api_key 门禁' }), /【未写入】/);
}

console.log('②a 主动上下文复用同一敏感护栏，不会读取早期不安全行');
{
  assert.equal(isSensitiveMemoryText('课件密码写在这里'), true);
  assert.equal(isSensitiveMemoryText('绿色模板的课件'), false);
}

console.log('③ supersede 双时态：旧行置位不删除，recall 不返回，includeInvalid 可见');
{
  const store = createStore(openStore(':memory:'));
  const old = store.note({ kind: 'task_fact', content: '高二(3)班教室在二楼东侧', importance: 0.6 });
  const { oldId, newId } = store.supersede(old.id, { content: '高二(3)班教室已搬到三楼西侧' });
  assert.equal(oldId, old.id);
  assert.notEqual(newId, old.id);
  const oldRow = store.db.prepare('SELECT * FROM mochi_memories WHERE id = ?').get(old.id);
  assert.ok(oldRow.invalid_at, '旧行 invalid_at 置位');
  assert.equal(oldRow.superseded_by, newId);
  assert.ok(store.db.prepare('SELECT * FROM mochi_memories WHERE id = ?').get(newId), '新行存在');
  const r = store.recall('高二(3)班教室');
  assert.ok(r.memories.every((m) => m.id !== old.id), 'recall 不返回旧行');
  assert.ok(r.memories.some((m) => m.id === newId));
  assert.ok(store.listAll({ includeInvalid: true }).some((m) => m.id === old.id), 'includeInvalid 可见旧行');
  assert.ok(store.listAll().every((m) => m.id !== old.id), '默认列表隐藏旧行');
  assert.throws(() => store.supersede(old.id, { content: '再次取代被拒绝' }), /已被取代/);
}

console.log('④ 衰减：注入时钟造 60 天未召回的低 importance 记忆 → decaySweep 置 expired；pinned 免疫；幂等');
{
  let clock = Date.parse('2026-09-01T08:00:00.000Z');
  const store = createStore(openStore(':memory:'), { nowProvider: () => clock });
  const freeRow = store.note({ kind: 'preference', content: '喜欢用蓝色粉笔写板书', importance: 0.15 });
  const pinnedRow = store.note({ kind: 'preference', content: '永远用蓝色粉笔写板书', importance: 0.15, pinned: true });
  // 30 天整：尚未超过周期，不衰减
  clock += 30 * DAY;
  assert.deepEqual(store.decaySweep(), []);
  // 60 天：0.15 × 0.95² < 0.15 → 过期；pinned 同行不置
  clock += 30 * DAY;
  assert.deepEqual(store.decaySweep(), [freeRow.id]);
  assert.ok(store.db.prepare('SELECT expired_at FROM mochi_memories WHERE id = ?').get(freeRow.id).expired_at);
  assert.equal(store.db.prepare('SELECT expired_at FROM mochi_memories WHERE id = ?').get(pinnedRow.id).expired_at, null);
  // 幂等：二次扫描不再产出
  assert.deepEqual(store.decaySweep(), []);
  // 过期后 recall 不再返回，pinned 仍返回（2 字查询走 LIKE 降级）
  const r = store.recall('粉笔');
  assert.deepEqual(r.memories.map((m) => m.id), [pinnedRow.id]);
  // decay 事件进了审计
  const ev = store.db.prepare("SELECT COUNT(*) AS c FROM mochi_memory_events WHERE memory_id = ? AND action = 'decay'").get(freeRow.id);
  assert.equal(ev.c, 1);
  const s = store.stats();
  assert.equal(s.total, 2);
  assert.equal(s.active, 1);
  assert.equal(s.pinned, 1);
  assert.equal(s.expired, 1);
  assert.equal(s.invalid, 0);
}

console.log('⑤ 召回命中：strength+1 封顶 5、recall_count+1、last_recalled_at 刷新');
{
  const store = createStore(openStore(':memory:'));
  const m = store.note({ kind: 'task_fact', content: '教务处每周五发放下周课表', importance: 0.8 });
  store.recall('每周五发放下周课表');
  let row = store.db.prepare('SELECT * FROM mochi_memories WHERE id = ?').get(m.id);
  assert.equal(row.strength, 2);
  assert.equal(row.recall_count, 1);
  assert.ok(row.last_recalled_at, 'last_recalled_at 刷新（衰减计时归零）');
  // 封顶 5
  store.db.prepare('UPDATE mochi_memories SET strength = 5 WHERE id = ?').run(m.id);
  store.recall('每周五发放下周课表');
  row = store.db.prepare('SELECT * FROM mochi_memories WHERE id = ?').get(m.id);
  assert.equal(row.strength, 5);
  assert.equal(row.recall_count, 2);
}

console.log('⑥ 引用率护栏：连写 20 条 injected_count=0 的 injections → 下一次 recall tightened:true 且 topK=5');
{
  const store = createStore(openStore(':memory:'));
  store.note({ kind: 'org_knowledge', content: '实验楼三楼是化学实验室' });
  const ins = store.db.prepare('INSERT INTO mochi_memory_injections (query, memory_ids, injected_count, top_k, created_at) VALUES (?, ?, ?, ?, ?)');
  const t = new Date().toISOString();
  for (let i = 0; i < 20; i += 1) ins.run(`历史查询${i}`, '[]', 0, 8, t);
  const r = store.recall('实验楼三楼是化学实验室');
  assert.equal(r.tightened, true);
  assert.equal(r.topK, TIGHTENED_TOP_K);
  assert.ok(r.memories.length >= 1);
  // 本次 recall 也写了一条 injections 行，且实际注入数 > 0
  const last = store.db.prepare('SELECT * FROM mochi_memory_injections ORDER BY id DESC').get();
  assert.ok(last.injected_count > 0);
  assert.ok(JSON.parse(last.memory_ids).length >= 1);
}

console.log('⑦ forget：主表+FTS 同步删除、审计行保留快照');
{
  const store = createStore(openStore(':memory:'));
  const m = store.note({ kind: 'convention', content: '晨会固定在周一第一节课前' });
  const { forgotten, snapshot } = store.forget(m.id);
  assert.equal(forgotten, true);
  assert.equal(snapshot.content, '晨会固定在周一第一节课前');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM mochi_memories WHERE id = ?').get(m.id).c, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS c FROM mochi_memories_fts WHERE mochi_memories_fts MATCH '晨会固定'").get().c, 0, 'FTS 同步删除');
  const ev = store.db.prepare("SELECT * FROM mochi_memory_events WHERE memory_id = ? AND action = 'forget'").get(m.id);
  assert.ok(ev, '审计行保留');
  assert.ok(ev.detail.includes('晨会固定'), '审计含快照');
  assert.throws(() => store.forget(m.id), /不存在/);
}

console.log('⑧ FTS 一致性：supersede 后旧内容 MATCH 不到，新内容可命中');
{
  const store = createStore(openStore(':memory:'));
  const old = store.note({ kind: 'preference', content: '偏爱在阅览室备课' });
  const sup = store.supersede(old.id, { content: '偏爱在办公室备课' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM mochi_memories_fts WHERE mochi_memories_fts MATCH ?').get('"阅览室备课"').c, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS c FROM mochi_memories_fts WHERE mochi_memories_fts MATCH ?').get('"办公室备课"').c, 1);
  const r = store.recall('偏爱在办公室备课');
  assert.ok(r.memories.every((m) => m.id !== old.id));
  assert.ok(r.memories.some((m) => m.id === sup.newId));
}

console.log('mochi-memory tests passed: 存储/FTS 降级/敏感护栏/双时态/衰减/免疫区/引用率护栏 全绿');
