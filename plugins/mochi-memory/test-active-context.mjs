// 主动记忆单测：真实 SQLite/world-state 隔离根 + 公开 systemPrompt 注册桩。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from './index.mjs';
import { createActiveMemoryContext, installActiveMemoryPrompt, ACTIVE_CONTEXT_MAX_CHARS, ACTIVE_MEMORY_MAX_ITEMS, ACTIVE_TODO_MAX_ITEMS } from './active-context.mjs';
import { createStore, openStore } from './mem-store.mjs';
import { openWorldState } from './world-state.mjs';

function makeSession(text) {
  return {
    snapshotEvents() {
      return [{
        type: 'user/message',
        data: {
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text }],
        },
      }];
    },
  };
}

function rootServices(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    store: createStore(openStore(join(root, 'memory', 'mochi-memories.sqlite'))),
    world: openWorldState(join(root, 'memory')),
  };
}

console.log('① 两个独立 DSH_HOME 根不串记忆；新会话不调用 recall 也能得到字面相关偏好与待办');
{
  const teacher = rootServices('mochi-active-teacher-');
  const other = rootServices('mochi-active-other-');
  try {
    const preference = teacher.store.note({
      kind: 'preference',
      content: '课件默认使用浅绿色留白模板',
      summary: '课件浅绿色留白模板',
      source: 'explicit_request',
      pinned: true,
    });
    teacher.store.note({ kind: 'task_fact', content: '临时任务：明天只做一次课件封面' });
    teacher.world.appendTodo('完成本周科学课件初稿');
    other.store.note({ kind: 'preference', content: '另一位老师的课件使用黑白模板', pinned: true });
    other.world.appendTodo('另一位老师的课件任务');

    const current = makeSession('请帮我完成本周科学课件');
    const active = createActiveMemoryContext({ store: teacher.store, world: teacher.world, session: current });
    assert.ok(active.text.includes('浅绿色留白模板'), '新会话无需显式 recall 也带入已确认偏好');
    assert.ok(active.text.includes('完成本周科学课件初稿'), '新会话带入字面相关的未完成工作');
    assert.ok(!active.text.includes('黑白模板') && !active.text.includes('另一位老师'), '两个数据根绝不串记忆');
    assert.ok(!active.text.includes('临时任务：明天只做一次'), '临时 task_fact 不会被当作长期主动资料');
    assert.deepEqual(active.memoryIds, [preference.id]);
    assert.ok(active.elapsedMs >= 0);
  } finally {
    rmSync(teacher.root, { recursive: true, force: true });
    rmSync(other.root, { recursive: true, force: true });
  }
}

console.log('② 忘记/清空在下一次 assembly 立即更新；旧数据库中的敏感条目也不会进入上下文');
{
  const services = rootServices('mochi-active-update-');
  try {
    const remembered = services.store.note({ kind: 'preference', content: '课件标题使用思源黑体', pinned: true });
    services.store.db.prepare(`INSERT INTO mochi_memories
      (scope_id, kind, content, summary, pinned, importance, valid_at, created_at, source, source_task_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('global', 'preference', '课件密码不得外传', '', 0, 0.5, new Date().toISOString(), new Date().toISOString(), '', '');
    const session = makeSession('制作课件标题页');
    const before = createActiveMemoryContext({ store: services.store, world: services.world, session });
    assert.ok(before.text.includes('思源黑体'));
    assert.ok(!before.text.includes('密码不得外传'), '只读防线不泄漏旧库敏感条目');

    services.store.forget(remembered.id);
    const afterForget = createActiveMemoryContext({ store: services.store, world: services.world, session });
    assert.ok(!afterForget.text.includes('思源黑体'), 'forget 后下一 assembly 不残留');
    for (const row of services.store.listAll({ includeInvalid: true })) services.store.forget(row.id);
    const afterClear = createActiveMemoryContext({ store: services.store, world: services.world, session });
    assert.equal(afterClear.text, '', '清空后下一 assembly 不残留历史资料');
  } finally {
    rmSync(services.root, { recursive: true, force: true });
  }
}

console.log('③ 条数、字符数与无 session 容错均为硬边界');
{
  const services = rootServices('mochi-active-bounds-');
  try {
    for (let index = 0; index < 8; index += 1) {
      services.store.note({ kind: 'preference', content: `课件偏好 ${index} ${'长'.repeat(260)}`, summary: `课件偏好 ${index}` });
      services.world.appendTodo(`课件待办 ${index} ${'长'.repeat(260)}`);
    }
    const active = createActiveMemoryContext({ store: services.store, world: services.world, session: makeSession('继续处理课件') });
    assert.ok(active.memoryIds.length <= ACTIVE_MEMORY_MAX_ITEMS);
    assert.ok(active.todoCount <= ACTIVE_TODO_MAX_ITEMS);
    assert.ok(active.text.length <= ACTIVE_CONTEXT_MAX_CHARS);
    assert.deepEqual(createActiveMemoryContext({ store: services.store, world: services.world }).memoryIds, [], '没有 session 时不抛错也不注入');
  } finally {
    rmSync(services.root, { recursive: true, force: true });
  }
}

console.log('④ 插件注册一个静态写入纪律和一个动态历史上下文；审计只记录耗时与数量');
{
  const services = rootServices('mochi-active-plugin-');
  try {
    services.store.note({ kind: 'preference', content: '课件采用分栏结构', pinned: true });
    const sections = [];
    const contexts = [];
    const diagnostics = [];
    const tools = new Map();
    apply({
      tools: { register: (tool) => tools.set(tool.name, tool) },
      systemPrompt: {
        getSectionOrder: () => 500,
        getContextOrder: () => 120,
        section: (entry) => { sections.push(entry); return () => {}; },
        context: (entry) => { contexts.push(entry); return () => {}; },
      },
      logger: { debug: (message) => diagnostics.push(message) },
    }, services.store, services.world);
    assert.equal(tools.size, 6);
    assert.equal(sections.length, 1);
    assert.equal(contexts.length, 1);
    assert.match(sections[0].text, /mochi_memory_note/u);
    // 工具名不许带点：模型网关会因非法工具名把整轮对话 400 掉（2026-09-12 定的硬约束）。
    // 这条负向断言就是为了防止有人「顺手改回」点号写法。
    assert.doesNotMatch(sections[0].text, /mochi\.memory_note/u, '段落里不许出现点号工具名');
    assert.equal(contexts[0].text({}), '', '未配置 agent/session 时动态上下文为空');
    const rendered = contexts[0].text({ agent: { session: makeSession('请继续准备课件') } });
    assert.ok(rendered.includes('分栏结构'));
    assert.ok(diagnostics.some((line) => /localMs=\d+ memories=1/u.test(line)), '记录额外本地处理耗时与计数');
    assert.ok(diagnostics.every((line) => !line.includes('分栏结构')), '诊断不记录记忆正文');
    const audit = services.store.db.prepare("SELECT detail FROM mochi_memory_events WHERE action = 'inject' ORDER BY id DESC LIMIT 1").get();
    assert.ok(audit.detail.includes('automatic-session-context'));
    assert.ok(!audit.detail.includes('继续准备课件'), '数据库审计不保存当前用户原文');
  } finally {
    rmSync(services.root, { recursive: true, force: true });
  }
}

console.log('⑤ 自动召回的审计写失败不阻断已读到的上下文，且诊断不泄漏正文');
{
  const contexts = [];
  const warnings = [];
  const storedText = '课件采用双色标题条';
  installActiveMemoryPrompt({
    systemPrompt: {
      getSectionOrder: () => 500,
      getContextOrder: () => 120,
      section: () => () => {},
      context: (entry) => { contexts.push(entry); return () => {}; },
    },
    logger: { warn: (message) => warnings.push(message) },
  }, {
    listAll: () => [{ id: 7, kind: 'preference', content: storedText, summary: '', pinned: 1, importance: 1 }],
    recordAutomaticContextInjection: () => { throw new Error('simulated sqlite quota failure'); },
  }, {
    listTodos: () => [],
  });
  const rendered = contexts[0].text({ agent: { session: makeSession('继续做课件') } });
  assert.ok(rendered.includes(storedText), '审计写失败不阻断已成功读取的主动上下文');
  assert.deepEqual(warnings, ['mochi-memory active-context audit-write-failed']);
  assert.ok(warnings.every((line) => !line.includes(storedText) && !line.includes('sqlite quota')), '固定错误码不记录正文或底层错误');
}

console.log('mochi active-memory tests passed: 隔离/主动召回/删除更新/敏感防线/上限/公开 prompt hook 全绿');
