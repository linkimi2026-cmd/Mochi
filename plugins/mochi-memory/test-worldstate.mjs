// mochi-memory 单测：world-state.md 骨架/段落/滚动 + events JSONL（工单 MOCHI-P5-MEM-01）。
// 风格照 plugins/mochi-dispatch/test.mjs：console.log 分组 + node:assert/strict + mkdtempSync 隔离。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultMemoryHome, openWorldState } from './world-state.mjs';

// defaultMemoryHome：DSH_HOME 未设时 fallback ~/.mochi-home
{
  const saved = process.env.DSH_HOME;
  delete process.env.DSH_HOME;
  assert.ok(defaultMemoryHome().includes('.mochi-home'));
  assert.equal(defaultMemoryHome('/tmp/dsh-test'), join('/tmp/dsh-test', 'memory'));
  process.env.DSH_HOME = saved;
}

console.log('① 骨架生成与幂等：重复 open 不重复写骨架');
{
  const home = mkdtempSync(join(tmpdir(), 'mochi-memory-'));
  const ws = openWorldState(home);
  const first = ws.readWorldState();
  for (const name of ['## 待办', '## 近 24h 变更', '## 已知约定']) {
    assert.ok(first.includes(name), `骨架应含段落 ${name}`);
  }
  assert.ok(first.includes('# Mochi 工作状态'));
  // 重复 open + read，内容完全一致（不重复写骨架）。
  const ws2 = openWorldState(home);
  const second = ws2.readWorldState();
  assert.equal(second, first);
  assert.equal(second.split('## 待办').length, 2, '段落标题只出现一次');
  rmSync(home, { recursive: true, force: true });
}

console.log('② 段落替换/追加/完成待办/约定去重');
{
  const home = mkdtempSync(join(tmpdir(), 'mochi-memory-'));
  const ws = openWorldState(home);
  ws.replaceSection('todos', ['- 旧任务一', '- 旧任务二']);
  ws.appendTodo('给张老师回电话');
  ws.appendTodo('准备下周课件');
  const doc = ws.readWorldState();
  const todosPart = doc.split('## 待办')[1].split('## ')[0];
  assert.ok(todosPart.includes('- 旧任务一'));
  assert.ok(todosPart.includes('- 给张老师回电话'));
  assert.deepEqual(ws.listTodos({ limit: 1 }), ['准备下周课件'], '主动上下文只读最新的有界待办');
  assert.deepEqual(ws.listTodos({ limit: 2 }), ['准备下周课件', '给张老师回电话']);
  // completeTodo：命中移除，二次未命中返回 false
  assert.equal(ws.completeTodo('给张老师回电话'), true);
  assert.equal(ws.completeTodo('给张老师回电话'), false);
  assert.ok(!ws.readWorldState().includes('给张老师回电话'));
  // appendChange 自动带 ISO 时间戳前缀
  ws.appendChange('把教材搬到图书室');
  const changesPart = ws.readWorldState().split('## 近 24h 变更')[1].split('## ')[0];
  const line = changesPart.split('\n').find((l) => l.includes('把教材搬到图书室'));
  assert.ok(line.startsWith('- 2'), `变更行应带 ISO 时间戳前缀：${line}`);
  assert.ok(line.includes('T') && line.includes('Z'));
  // setConvention：同文本去重
  ws.setConvention('周三下午不排会');
  ws.setConvention('周三下午不排会');
  const convPart = ws.readWorldState().split('## 已知约定')[1];
  assert.equal(convPart.split('周三下午不排会').length - 1, 1, '同文本约定只保留一条');
  rmSync(home, { recursive: true, force: true });
}

console.log('③ 200 行滚动：最老条目先进 events 归档，文件不超过 200 行');
{
  const home = mkdtempSync(join(tmpdir(), 'mochi-memory-'));
  const ws = openWorldState(home);
  // 直接预填 198 条变更，再 appendChange 两条触发滚动。
  const prefill = [];
  for (let i = 1; i <= 198; i += 1) prefill.push(`- 预填变更 ${String(i).padStart(3, '0')}`);
  ws.replaceSection('changes', prefill);
  ws.appendChange('触发滚动的新变更一');
  ws.appendChange('触发滚动的新变更二');
  const doc = readFileSync(join(home, 'world-state.md'), 'utf8');
  const lineCount = doc.split('\n').filter((l, i, arr) => !(l === '' && i === arr.length - 1)).length;
  assert.ok(lineCount <= 200, `文件行数应 <=200，实际 ${lineCount}`);
  // 最老的条目已被滚出 md，且逐条归档进 events。
  assert.ok(!doc.includes('预填变更 001'), '最老条目应滚出 md');
  const archived = ws.readEvents();
  const archiveRows = archived.filter((e) => e.kind === 'change-archive');
  assert.ok(archiveRows.length >= 2, `应有 >=2 条归档事件，实际 ${archiveRows.length}`);
  assert.ok(archiveRows.some((e) => e.summary.includes('预填变更 001')));
  assert.ok(archiveRows.every((e) => typeof e.ts === 'string' && e.ts.includes('T')));
  assert.ok(doc.includes('触发滚动的新变更二'), '最新变更保留在 md');
  rmSync(home, { recursive: true, force: true });
}

console.log('④ events 追加 + 按日期读取 + limit');
{
  const home = mkdtempSync(join(tmpdir(), 'mochi-memory-'));
  const ws = openWorldState(home);
  ws.appendEvent({ kind: 'todo-done', summary: '完成备课', refs: ['task:1'], actor: 'mochi' });
  ws.appendEvent({ kind: 'note', summary: '随手记一笔' });
  const rows = ws.readEvents();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'todo-done');
  assert.equal(rows[0].refs[0], 'task:1');
  assert.equal(rows[0].actor, 'mochi');
  assert.equal(rows[1].actor, '', '缺省 actor 补空串');
  assert.ok(rows[0].ts && rows[1].ts);
  // limit：返回最近 N 条，时间正序
  const limited = ws.readEvents({ limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].summary, '随手记一笔');
  // 按日期读取：无数据的旧日期返回空数组
  assert.deepEqual(ws.readEvents({ date: '2000-01-01' }), []);
  rmSync(home, { recursive: true, force: true });
}

console.log('⑤ 坏文件容错：缺段落补齐且原有内容不丢');
{
  const home = mkdtempSync(join(tmpdir(), 'mochi-memory-'));
  const bad = [
    '# Mochi 工作状态',
    '> 本文件由 mochi-memory 维护，≤200 行；历史变更滚动到 events/*.jsonl，不丢记录。',
    '',
    '## 待办',
    '- 修投影仪',
    '',
  ].join('\n');
  writeFileSync(join(home, 'world-state.md'), bad, 'utf8');
  const ws = openWorldState(home);
  const doc = ws.readWorldState();
  assert.ok(doc.includes('- 修投影仪'), '原有内容不丢');
  assert.ok(doc.includes('## 近 24h 变更'), '缺失段落被补齐');
  assert.ok(doc.includes('## 已知约定'), '缺失段落被补齐');
  assert.equal(doc.split('## 待办').length, 2, '已有段落不重复');
  // 补齐后可正常写入
  ws.appendTodo('新待办');
  assert.ok(ws.readWorldState().includes('- 新待办'));
  // 极端坏文件：完全没有标题也能补齐且不丢内容
  const home2 = mkdtempSync(join(tmpdir(), 'mochi-memory-'));
  writeFileSync(join(home2, 'world-state.md'), '乱七八糟的内容\n第二行\n', 'utf8');
  const doc2 = openWorldState(home2).readWorldState();
  assert.ok(doc2.includes('乱七八糟的内容'));
  assert.ok(doc2.includes('## 已知约定'));
  rmSync(home, { recursive: true, force: true });
  rmSync(home2, { recursive: true, force: true });
}

console.log('⑥ 原子写：不留 .tmp- 残留');
{
  const home = mkdtempSync(join(tmpdir(), 'mochi-memory-'));
  const ws = openWorldState(home);
  ws.readWorldState();
  ws.appendTodo('原子写检查');
  ws.replaceSection('changes', ['- 一条']);
  ws.appendChange('再一条');
  ws.setConvention('检查约定');
  ws.appendEvent({ kind: 'check', summary: '原子写检查事件' });
  const files = readdirSync(home);
  assert.ok(files.includes('world-state.md'));
  assert.ok(!files.some((f) => f.startsWith('.tmp-')), `不应有 .tmp- 残留：${files.join(',')}`);
  assert.ok(existsSync(join(home, 'events')), 'events 目录已建');
  rmSync(home, { recursive: true, force: true });
}

console.log('mochi-memory tests passed: 骨架/段落/200行滚动/events/容错/原子写 全绿');
