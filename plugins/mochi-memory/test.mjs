// mochi-memory 插件整合测试（工单 MOCHI-P5-MEM-03）。
// 桩 ctx 捕获 register 的工具表；mkdtemp 隔离 DSH_HOME，不碰真实 ~/.mochi-home。
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, output } from './index.mjs';
import { openWorldState } from './world-state.mjs';
import { createStore } from './mem-store.mjs';

const tempRoot = mkdtempSync(join(tmpdir(), 'mochi-memory-test-'));
process.env.DSH_HOME = tempRoot;

const tools = new Map();
apply({
  tools: { register: (tool) => tools.set(tool.name, tool) },
  get: () => undefined,
  logger: console,
});
const call = async (name, args) => tools.get(name).execute(args, { agent: { session: {} }, callId: 't1' });

console.log('① 六工具注册齐全、名字正确');
{
  assert.deepEqual(
    [...tools.keys()].sort(),
    ['mochi.memory_clear', 'mochi.memory_forget', 'mochi.memory_list', 'mochi.memory_note', 'mochi.memory_recall', 'mochi.memory_world'].sort(),
  );
}

console.log('② note -> recall -> forget 全链（中文查询命中、forget 后查不到）');
{
  const noted = await call('mochi.memory_note', {
    kind: 'preference', content: '主人喜欢用绿色粉笔写板书，说看着不刺眼', summary: '板书偏好绿色粉笔', importance: 0.8,
  });
  assert.equal(noted.已记住, true);
  assert.equal(typeof noted.记忆ID, 'number');

  const recalled = await call('mochi.memory_recall', { query: '绿色粉笔' });
  assert.equal(recalled.命中条数, 1);
  assert.equal(recalled.命中[0].记忆ID, noted.记忆ID);
  assert.ok(recalled.命中[0]['为什么Mochi知道这个'].includes('来源'), '召回结果要带可检查的来源说明');
  assert.ok(recalled.命中[0]['为什么Mochi知道这个'].includes('已被召回'), '来源说明要含召回次数');

  const again = await call('mochi.memory_recall', { query: '绿色粉笔' });
  assert.equal(again.命中[0]['为什么Mochi知道这个'].includes('已被召回 2 次'), true, '召回计数要随命中递增');

  const forgotten = await call('mochi.memory_forget', { id: noted.记忆ID });
  assert.equal(forgotten.已忘记, true);
  assert.equal(forgotten.原内容.includes('绿色粉笔'), true, 'forget 要返回被忘快照');

  const after = await call('mochi.memory_recall', { query: '绿色粉笔' });
  assert.equal(after.命中条数, 0);
}

console.log('③ 敏感内容被护栏拒绝，错误话术以【未写入】开头');
{
  await assert.rejects(
    () => call('mochi.memory_note', { kind: 'task_fact', content: '主人的系统密码是 123456' }),
    (error) => error.message.startsWith('【未写入】'),
  );
  await assert.rejects(
    () => call('mochi.memory_note', { kind: 'task_fact', content: '张三的诊断结果是……' }),
    (error) => error.message.startsWith('【未写入】'),
  );
}

console.log('④ convention 同步进 world-state');
{
  const world = openWorldState();
  const noted = await call('mochi.memory_note', {
    kind: 'convention', content: '班级周一是 8 点晨会', summary: '周一 8 点晨会',
  });
  const snapshot = await call('mochi.memory_world', { action: 'read' });
  assert.ok(snapshot.工作状态全文.includes('周一 8 点晨会'), 'convention 要同步进已知约定段');
  assert.ok(world.readWorldState().includes('已知约定'), 'world-state 保持骨架三段落');
  // 清理掉，避免影响后续 world 段落的行数断言。
  await call('mochi.memory_forget', { id: noted.记忆ID });
  const events = world.readEvents();
  assert.ok(events.some((event) => event.kind === 'memory-note'), 'note 要落审计事件');
}

console.log('⑤ render 签名回归：(args, value) 双参，文本含 value 不含 args（大坑 17）');
{
  const rendered = output.render({ some: 'args' }, { real: 'result' });
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].type, 'text');
  assert.ok(rendered[0].text.includes('result'), 'render 输出要含结果');
  assert.ok(!rendered[0].text.includes('args'), 'render 输出绝不能把调用参数当结果');
}

console.log('⑥ world read / append-todo / complete-todo');
{
  const read0 = await call('mochi.memory_world', { action: 'read' });
  assert.ok(read0.工作状态全文.includes('# Mochi 工作状态'), 'read 要返回骨架齐全的全文');

  const added = await call('mochi.memory_world', { action: 'append-todo', text: '明天把教案交给年级组' });
  assert.equal(added.已加入待办, '明天把教案交给年级组');
  let snapshot = await call('mochi.memory_world', { action: 'read' });
  assert.ok(snapshot.工作状态全文.includes('明天把教案交给年级组'));

  const done = await call('mochi.memory_world', { action: 'complete-todo', text: '明天把教案交给年级组' });
  assert.equal(done.已完成, true);
  snapshot = await call('mochi.memory_world', { action: 'read' });
  assert.ok(!snapshot.工作状态全文.includes('明天把教案交给年级组'), '完成后待办要移除');

  const miss = await call('mochi.memory_world', { action: 'complete-todo', text: '不存在的待办' });
  assert.equal(miss.已完成, false);
}

console.log('⑦ note 带 source 透传，recall 的「为什么Mochi知道这个」显示「多次重复」');
{
  const noted = await call('mochi.memory_note', {
    kind: 'preference', content: '主人批作业喜欢用红蓝双色笔，说区分正误更醒目', summary: '红蓝双色笔', source: 'repeated',
  });
  assert.equal(noted.已记住, true);
  const recalled = await call('mochi.memory_recall', { query: '红蓝双色笔' });
  assert.equal(recalled.命中条数, 1);
  assert.ok(recalled.命中[0]['为什么Mochi知道这个'].includes('多次重复'), 'source 要透传进召回的来源说明');
}

console.log('⑧ memory_list 返回统计与列表；forget 后该条目消失');
{
  const before = await call('mochi.memory_list', {});
  assert.equal(typeof before.统计.总数, 'number');
  assert.ok(Array.isArray(before.记忆列表));
  const row0 = before.记忆列表.find((row) => row.内容.includes('红蓝双色笔'));
  assert.ok(row0, '列表要含 ⑦ 刚写入的条目');
  assert.ok(row0.来源.startsWith('来源：多次重复；'), '列表来源要与 recall 同格式');
  assert.equal(row0.被召回次数, 1, '被召回次数要含 ⑦ 的那次命中');
  assert.equal(row0.pinned, false);

  const noted = await call('mochi.memory_note', { kind: 'task_fact', content: '下周三要交期中试卷分析给年级组', summary: '期中试卷分析' });
  const listed = await call('mochi.memory_list', {});
  assert.equal(listed.统计.总数, before.统计.总数 + 1, '写入后总数要 +1');
  assert.ok(listed.记忆列表.some((row) => row.记忆ID === noted.记忆ID), '列表要含刚写入的条目');

  await call('mochi.memory_forget', { id: noted.记忆ID });
  const after = await call('mochi.memory_list', {});
  assert.equal(after.统计.总数, before.统计.总数, 'forget 后总数要回落');
  assert.ok(!after.记忆列表.some((row) => row.记忆ID === noted.记忆ID), 'forget 后该条目要从列表消失');
}

console.log('⑨ memory_clear 链路：3 条（含 1 pinned）→ clear → 空库 → 审计有 forget 快照');
{
  // 直连同一 sqlite 库（WAL 允许多连接），用于 pin 和查审计事件；不走工具是因为 pinned 只能由存储层开关。
  const direct = createStore();
  await call('mochi.memory_clear', {}); // ⑦ 还留着 1 条「红蓝双色笔」，先归零再写入，保证删除条数=3 的断言精确。
  const ids = [];
  for (const content of ['主人习惯周五下午开班会', '年级组办公室的钥匙在门卫室登记', '主人批改用 A4 横格纸做草稿']) {
    const noted = await call('mochi.memory_note', { kind: 'task_fact', content });
    ids.push(noted.记忆ID);
  }
  direct.pin(ids[2], true); // 1 条 pinned 免疫记忆

  const cleared = await call('mochi.memory_clear', {});
  assert.equal(cleared.已清空, true);
  assert.equal(cleared.删除条数, 3, 'clear 要报告删除 3 条');
  assert.equal(cleared.其中pinned, 1, 'clear 要报告其中 1 条 pinned');

  const listed = await call('mochi.memory_list', {});
  assert.equal(listed.记忆列表.length, 0, 'clear 后列表要空');
  assert.ok(listed.说明.includes('空的'), '空库要带说明');
  assert.deepEqual(
    [listed.统计.总数, listed.统计.已激活, listed.统计.免疫, listed.统计.已归档, listed.统计.已取代],
    [0, 0, 0, 0, 0],
    'clear 后 stats 要全 0',
  );

  const forgets = direct.db.prepare("SELECT memory_id, detail FROM mochi_memory_events WHERE action = 'forget'").all();
  for (const id of ids) {
    const row = forgets.find((event) => event.memory_id === id);
    assert.ok(row, `审计里要有 #${id} 的 forget 快照`);
    assert.ok(row.detail.includes('"content"'), 'forget 审计 detail 要是整条记忆快照');
  }
}

console.log('⑩ 空库 clear：删除条数=0 且带「本来就是空的」说明');
{
  const again = await call('mochi.memory_clear', {});
  assert.equal(again.已清空, true);
  assert.equal(again.删除条数, 0);
  assert.ok(again.说明.includes('本来就是空的'), '空库 clear 要如实说明');
}

rmSync(tempRoot, { recursive: true, force: true });
console.log('\n全部通过：①注册 ②note-recall-forget 全链 ③敏感护栏 ④convention 同步 ⑤render 签名 ⑥world 读写 ⑦source 透传 ⑧memory_list ⑨memory_clear ⑩空库 clear');
