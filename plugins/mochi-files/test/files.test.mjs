// 六个文件工具的端到端测试：用临时目录真建/真读写文件。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, inject, name } from '../index.mjs';

const REQUIRED_TOOL_NAMES = ['file_search', 'file_read', 'file_copy', 'file_move', 'file_rename', 'file_create_folder'];
const SAFE_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

function makeCtx() {
  const tools = [];
  return {
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    logger: { info() {}, warn() {}, error() {} },
    get: () => undefined,
    registered: tools,
  };
}

function makeWorkspace(t, prefix = 'mochi-files-e2e-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const ctx = makeCtx();
  apply(ctx, { allowedRoots: [root] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, ctx };
}

// 隔离数据根与环境变量，避免测试读到开发机真实的 allowed-roots.json。
function withIsolatedRootsEnv(t) {
  const home = mkdtempSync(join(tmpdir(), 'mochi-files-home-'));
  const saved = {
    MOCHI_HOME: process.env.MOCHI_HOME,
    DSH_HOME: process.env.DSH_HOME,
    MOCHI_FILES_ROOTS: process.env.MOCHI_FILES_ROOTS,
  };
  process.env.DSH_HOME = home;
  delete process.env.MOCHI_HOME;
  delete process.env.MOCHI_FILES_ROOTS;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
}

function tool(ctx, toolName) {
  const found = ctx.registered.find((entry) => entry.name === toolName);
  assert.ok(found, `应注册工具 ${toolName}`);
  return found;
}

test('注册层：插件名、注入、恰好六个工具、工具名全部合规且无点号', (t) => {
  const { ctx } = makeWorkspace(t);
  assert.equal(name, 'mochi-files');
  assert.deepEqual(inject, ['tools', 'sandboxPolicy']);
  assert.equal(ctx.registered.length, 6, '只应注册六个工具');
  const names = ctx.registered.map((entry) => entry.name);
  assert.deepEqual([...names].sort(), [...REQUIRED_TOOL_NAMES].sort());
  for (const toolName of names) {
    assert.ok(SAFE_TOOL_NAME.test(toolName), `${toolName} 必须匹配 ^[a-zA-Z0-9_-]+$`);
    assert.ok(!toolName.includes('.'), `${toolName} 不能含点号（网关会 400 拒收整轮）`);
  }
  assert.equal(names.includes('file_delete'), false, '本任务不提供删除工具');
  assert.equal(tool(ctx, 'file_search').parameters.required.includes('query'), true);
});

test('file_create_folder：真建文件夹，重复调用返回已存在', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  const created = await tool(ctx, 'file_create_folder').execute({ path: '教案/第三章' }, {});
  assert.equal(created.ok, true);
  assert.equal(created.已创建, true);
  assert.equal(created.路径, join(root, '教案/第三章'));
  assert.equal(existsSync(join(root, '教案/第三章')), true, '文件夹必须真的存在');

  const again = await tool(ctx, 'file_create_folder').execute({ path: '教案/第三章' }, {});
  assert.equal(again.已创建, false);
  assert.match(again.说明, /已经存在/);
});

test('file_copy：真实复制，内容一致；覆盖默认被拒、overwrite:true 才成功', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  writeFileSync(join(root, 'a.txt'), 'hello');
  writeFileSync(join(root, 'b.txt'), 'original-b');

  const copied = await tool(ctx, 'file_copy').execute({ source: 'a.txt', destination: 'copy.txt' }, {});
  assert.equal(copied.ok, true);
  assert.equal(copied.已覆盖, false);
  assert.equal(copied.目标, join(root, 'copy.txt'));
  assert.equal(readFileSync(join(root, 'copy.txt'), 'utf8'), 'hello', '目标内容必须是真实复制来的');

  await assert.rejects(
    () => tool(ctx, 'file_copy').execute({ source: 'a.txt', destination: 'b.txt' }, {}),
    (error) => error.code === 'MOCHI_FILES_TARGET_EXISTS' && /默认不覆盖/.test(error.message),
  );
  assert.equal(readFileSync(join(root, 'b.txt'), 'utf8'), 'original-b', '被拒绝时不能改动目标');

  const overwritten = await tool(ctx, 'file_copy').execute({ source: 'a.txt', destination: 'b.txt', overwrite: true }, {});
  assert.equal(overwritten.已覆盖, true);
  assert.equal(overwritten.覆盖说明.includes('原大小 10 字节'), true, '要说明覆盖了什么：' + overwritten.覆盖说明);
  assert.equal(readFileSync(join(root, 'b.txt'), 'utf8'), 'hello');
});

test('file_move：真实移动，来源消失；覆盖默认被拒', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  writeFileSync(join(root, 'm.txt'), 'm');
  writeFileSync(join(root, 'keep.txt'), 'keep');

  const moved = await tool(ctx, 'file_move').execute({ source: 'm.txt', destination: 'moved.txt' }, {});
  assert.equal(moved.ok, true);
  assert.equal(existsSync(join(root, 'm.txt')), false, '来源必须真的没了');
  assert.equal(readFileSync(join(root, 'moved.txt'), 'utf8'), 'm');

  await assert.rejects(
    () => tool(ctx, 'file_move').execute({ source: 'moved.txt', destination: 'keep.txt' }, {}),
    (error) => error.code === 'MOCHI_FILES_TARGET_EXISTS',
  );
  assert.equal(existsSync(join(root, 'moved.txt')), true, '被拒绝时来源还在');

  const forced = await tool(ctx, 'file_move').execute({ source: 'moved.txt', destination: 'keep.txt', overwrite: true }, {});
  assert.equal(forced.已覆盖, true);
  assert.equal(readFileSync(join(root, 'keep.txt'), 'utf8'), 'm');
  assert.equal(existsSync(join(root, 'moved.txt')), false);
  assert.equal(forced.跨设备回退, false);
});

test('file_rename：同目录改名，新名带路径分隔符被拒', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  writeFileSync(join(root, '旧名.txt'), 'x');
  const renamed = await tool(ctx, 'file_rename').execute({ path: '旧名.txt', newName: '新名.txt' }, {});
  assert.equal(renamed.ok, true);
  assert.equal(renamed.新路径, join(root, '新名.txt'));
  assert.equal(existsSync(join(root, '旧名.txt')), false);
  assert.equal(readFileSync(join(root, '新名.txt'), 'utf8'), 'x');

  await assert.rejects(
    () => tool(ctx, 'file_rename').execute({ path: '新名.txt', newName: '../逃逸.txt' }, {}),
    (error) => error.code === 'MOCHI_FILES_BAD_NAME',
  );
  await assert.rejects(
    () => tool(ctx, 'file_rename').execute({ path: '新名.txt', newName: 'sub/x.txt' }, {}),
    (error) => error.code === 'MOCHI_FILES_BAD_NAME',
  );
});

test('file_read：内容、行范围、大小截断与二进制拒绝', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  writeFileSync(join(root, 'lines.txt'), 'l1\nl2\nl3\nl4\n');
  const full = await tool(ctx, 'file_read').execute({ path: 'lines.txt' }, {});
  assert.equal(full.是否截断, false);
  assert.equal(full.总行数, 5);
  assert.equal(full.正文, 'l1\nl2\nl3\nl4\n');

  const ranged = await tool(ctx, 'file_read').execute({ path: 'lines.txt', startLine: 2, endLine: 3 }, {});
  assert.equal(ranged.正文, 'l2\nl3');
  assert.deepEqual(ranged.行范围, { 起始行: 2, 结束行: 3 });

  writeFileSync(join(root, 'big.txt'), 'x'.repeat(5000));
  const truncated = await tool(ctx, 'file_read').execute({ path: 'big.txt', maxBytes: 100 }, {});
  assert.equal(truncated.是否截断, true);
  assert.equal(truncated.读取字节数, 100);
  assert.equal(truncated.总行数, null);
  assert.match(truncated.说明, /截断/);

  writeFileSync(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  await assert.rejects(
    () => tool(ctx, 'file_read').execute({ path: 'bin.dat' }, {}),
    (error) => error.code === 'MOCHI_FILES_NOT_TEXT',
  );

  mkdirSync(join(root, 'adir'));
  await assert.rejects(
    () => tool(ctx, 'file_read').execute({ path: 'adir' }, {}),
    (error) => error.code === 'EISDIR' && /EISDIR/.test(error.message),
  );
});

// 回归：二进制被拒以后，模型必须能从**错误消息本身**读出该改调哪个工具（2026-09-12）。
//
// 起因：宿主给上传件的句柄文本只写「Read that path with your file tools」，模型于是先试
// file_read；若只回一句含糊的"请用对应的文档工具"，模型不知道工具**叫什么名字**，
// 常见结局是改去 web_search、或者直接告诉老师"读不了这个文件"。
// 所以这里锁死：每个后缀都必须点名一个真实注册过的工具名。
test('file_read 拒二进制时按后缀点名该改调的工具，未知类型如实说不支持', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]);
  const cases = [
    ['第三章教案.docx', /doc_read/],
    ['试卷.pdf', /pdf_read/],
    ['成绩表.xlsx', /spreadsheet_read/],
    ['名单.csv', /spreadsheet_read/],
    ['课件.pptx', /ppt_inspect/],
    ['截图.png', /read_image/],
    ['旧稿.doc', /另存为 \.docx/],
    ['旧表.xls', /另存为 \.xlsx/],
    ['老课件.ppt', /另存为 \.pptx/],
    ['归档.zip', /没有能读取这种二进制格式的工具/],
  ];
  for (const [name, expected] of cases) {
    writeFileSync(join(root, name), binary);
    let message = null;
    try {
      await tool(ctx, 'file_read').execute({ path: name }, {});
    } catch (error) {
      assert.equal(error.code, 'MOCHI_FILES_NOT_TEXT', `${name} 必须以二进制拒绝失败`);
      message = error.message;
    }
    assert.ok(message, `${name} 必须被拒绝，不能"假装读到了"`);
    assert.match(message, expected, `${name} 的拒绝消息必须点名正确工具`);
    // 工具名不得带点：模型网关会因非法工具名把整轮对话 400 掉。
    const withoutExtensions = message.replace(/\.(docx|pdf|xlsx|csv|pptx|png|doc|xls|ppt|zip)\b/g, '');
    assert.equal(/[a-z]+\.[a-z_]+/.test(withoutExtensions), false,
      `${name} 的提示里出现了点号工具名：${message}`);
  }
});

test('file_search：真实递归搜索、通配符、非递归与条数截断', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  mkdirSync(join(root, 'sub/deep'), { recursive: true });
  writeFileSync(join(root, '期中物理.docx'), 'a');
  writeFileSync(join(root, '期中化学.docx'), 'b');
  writeFileSync(join(root, '笔记.txt'), 'c');
  writeFileSync(join(root, 'sub/deep/期中生物.docx'), 'd');

  const wildcard = await tool(ctx, 'file_search').execute({ query: '期中*.docx' }, {});
  assert.equal(wildcard.ok, true);
  assert.deepEqual(
    wildcard.结果.map((item) => item.名称).sort(),
    ['期中化学.docx', '期中生物.docx', '期中物理.docx'].sort(),
  );
  assert.equal(wildcard.结果.every((item) => item.路径.startsWith(root)), true, '返回的必须是允许根内的真实绝对路径');
  assert.equal(wildcard.结果.every((item) => item.类型 === '文件'), true);

  const recursive = await tool(ctx, 'file_search').execute({ query: '期中生物.docx' }, {});
  assert.equal(recursive.结果数, 1);
  assert.equal(recursive.结果[0].路径, join(root, 'sub/deep/期中生物.docx'));

  const shallow = await tool(ctx, 'file_search').execute({ query: '期中生物.docx', recursive: false }, {});
  assert.equal(shallow.结果数, 0);

  const substring = await tool(ctx, 'file_search').execute({ query: '化学' }, {});
  assert.equal(substring.结果数, 1);
  assert.equal(substring.结果[0].名称, '期中化学.docx');

  const limited = await tool(ctx, 'file_search').execute({ query: '期中*', limit: 2 }, {});
  assert.equal(limited.结果数, 2);
  assert.equal(limited.是否截断, true);
  assert.match(limited.说明, /上限/);

  const dirs = await tool(ctx, 'file_search').execute({ query: 'deep', type: 'directory' }, {});
  assert.equal(dirs.结果.length, 1);
  assert.equal(dirs.结果[0].类型, '文件夹');
});

test('路径逃逸：`..`、绝对路径越界、符号链接穿越全部被拒绝，且不留下痕迹', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  const outside = mkdtempSync(join(tmpdir(), 'mochi-files-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'secret.txt'), 'SECRET');
  symlinkSync(outside, join(root, 'linkdir'));

  await assert.rejects(
    () => tool(ctx, 'file_read').execute({ path: '../../etc/passwd' }, {}),
    (error) => error.code === 'PATH_ESCAPE' && /越出允许的根目录/.test(error.message),
  );
  await assert.rejects(
    () => tool(ctx, 'file_copy').execute({ source: 'linkdir/secret.txt', destination: 'stolen.txt' }, {}),
    (error) => error.code === 'PATH_ESCAPE',
  );
  await assert.rejects(
    () => tool(ctx, 'file_search').execute({ query: '*', directory: '/etc' }, {}),
    (error) => error.code === 'PATH_ESCAPE',
  );
  await assert.rejects(
    () => tool(ctx, 'file_create_folder').execute({ path: '../escape-folder' }, {}),
    (error) => error.code === 'PATH_ESCAPE',
  );
  assert.equal(existsSync(join(root, 'stolen.txt')), false, '被拒绝的复制不能留下文件');
  assert.equal(existsSync(join(outside, '..', 'escape-folder')), false);
});

test('不存在文件的错误信息真实：保留 ENOENT 并给出中文说明', async (t) => {
  const { ctx } = makeWorkspace(t);
  await assert.rejects(
    () => tool(ctx, 'file_read').execute({ path: '没有这个.txt' }, {}),
    (error) => error.code === 'ENOENT' && /ENOENT/.test(error.message) && /不存在/.test(error.message),
  );
  await assert.rejects(
    () => tool(ctx, 'file_copy').execute({ source: '没有这个.txt', destination: 'x.txt' }, {}),
    (error) => error.code === 'ENOENT' && /不存在/.test(error.message),
  );
  await assert.rejects(
    () => tool(ctx, 'file_move').execute({ source: '没有这个.txt', destination: 'x.txt' }, {}),
    (error) => error.code === 'ENOENT',
  );
  await assert.rejects(
    () => tool(ctx, 'file_rename').execute({ path: '没有这个.txt', newName: 'y.txt' }, {}),
    (error) => error.code === 'ENOENT',
  );
});

test('默认允许根来自会话工作区：只读会话可搜索/读取，写入被拒绝', async (t) => {
  withIsolatedRootsEnv(t);
  const root = mkdtempSync(join(tmpdir(), 'mochi-files-readonly-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'a.txt'), 'hello');
  const ctx = makeCtx();
  ctx.sandboxPolicy = { resolve: () => ({ mode: 'read-only', workspaceRoot: root }) };
  apply(ctx, {});

  const read = await tool(ctx, 'file_read').execute({ path: 'a.txt' }, {});
  assert.equal(read.正文, 'hello');
  const found = await tool(ctx, 'file_search').execute({ query: 'a.txt' }, {});
  assert.equal(found.结果数, 1);
  assert.equal(found.结果[0].路径, join(root, 'a.txt'));

  await assert.rejects(
    () => tool(ctx, 'file_create_folder').execute({ path: '新目录' }, {}),
    (error) => error.code === 'WORKSPACE_READ_ONLY' && /只读/.test(error.message),
  );
  await assert.rejects(
    () => tool(ctx, 'file_copy').execute({ source: 'a.txt', destination: 'b.txt' }, {}),
    (error) => error.code === 'WORKSPACE_READ_ONLY',
  );
  assert.equal(existsSync(join(root, 'b.txt')), false);
});

test('MOCHI_FILES_ROOTS 环境变量可配置允许根', async (t) => {
  withIsolatedRootsEnv(t);
  const root = mkdtempSync(join(tmpdir(), 'mochi-files-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'env-only.txt'), 'e');
  process.env.MOCHI_FILES_ROOTS = root;

  const ctx = makeCtx();
  apply(ctx, {});
  const found = await tool(ctx, 'file_search').execute({ query: 'env-only.txt' }, {});
  assert.equal(found.结果数, 1);
  assert.equal(found.结果[0].路径, join(root, 'env-only.txt'));

  await assert.rejects(
    () => tool(ctx, 'file_read').execute({ path: '/etc/passwd' }, {}),
    (error) => error.code === 'PATH_ESCAPE',
  );
});
