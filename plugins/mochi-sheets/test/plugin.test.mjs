// 插件层：工具名合规（网关会 400 拒收整轮对话）、注册数量、render 签名、路径安全、导出支持面诚实声明。
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inject, name, output } from '../index.mjs';
import { matchRoot, resolveAllowedRoots, resolveInside } from '../paths.mjs';
import { SUPPORTED_TARGET_FORMATS, UNSUPPORTED_TARGET_FORMATS } from '../sheet-write.mjs';
import { makeWorkspace, mount, rejectMessage, SAMPLE_SHEET } from './helpers.mjs';

const REQUIRED_TOOL_NAMES = ['spreadsheet_read', 'spreadsheet_create', 'spreadsheet_export', 'spreadsheet_formula'];
const SAFE_TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

test('插件注册的工具名合法、恰好四个、参数契约可用、render 签名正确', (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });

  assert.equal(name, 'mochi-sheets');
  assert.deepEqual(inject, ['tools']);
  assert.deepEqual(sheets.tools.map((tool) => tool.name), REQUIRED_TOOL_NAMES);
  for (const tool of sheets.tools) {
    assert.match(tool.name, SAFE_TOOL_NAME, `工具名 ${tool.name} 会被模型网关拒收`);
    assert.ok(!tool.name.includes('.'), `工具名不能带点：${tool.name}`);
    assert.ok(tool.description.length > 40, `${tool.name} 的 description 太短，模型无法判断用法`);
    assert.equal(typeof tool.execute, 'function');
  }
  // 工具名不得带点（网关会 400 拒收整轮对话），且描述必须够长让模型能判断用法；
  // 品牌口径见 package.json 与 index.mjs（统一写 Mochi）。

  // render 签名是 (args, value)：把参数当结果传进去必须是错的
  const rendered = output.render({ path: '/x' }, { 状态: '已读取' });
  assert.equal(rendered[0].type, 'text');
  assert.match(rendered[0].text, /已读取/);
  assert.ok(!rendered[0].text.includes('/x'), 'render 不能把调用参数当返回值');
});

test('路径安全：缺省根是当前工作区，绝不默认放开主目录或磁盘根', async () => {
  const resolved = await resolveAllowedRoots({ options: {}, env: {}, ctx: null });
  assert.deepEqual(resolved.roots, [realpathSync(process.cwd())]);
  assert.ok(!resolved.roots.includes(homedir()), '缺省根不能包含主目录');
  assert.ok(!resolved.roots.includes('/'), '缺省根不能是文件系统根');

  // 显式把磁盘根当允许根也必须被过滤掉（只留下工作区兜底）
  const withDiskRoot = await resolveAllowedRoots({ options: { allowedRoots: ['/'] }, env: {}, ctx: null });
  assert.ok(!withDiskRoot.roots.includes('/'), '磁盘根必须被拒绝');
  assert.ok(withDiskRoot.rejected.some((entry) => /文件系统根目录/.test(entry.reason)));
});

test('路径安全：越界、相对路径、空路径、符号链接逃逸都被拒绝', async (t) => {
  const root = makeWorkspace(t);
  const outside = makeWorkspace(t, 'mochi-sheets-outside-');
  const sheets = mount(t, { allowedRoots: [root] });

  writeFileSync(join(outside, '外面的表.csv'), 'a,b\n1,2\n', 'utf8');

  const escaped = await rejectMessage(sheets.call('spreadsheet_read', { path: join(outside, '外面的表.csv') }));
  assert.match(escaped, /不在允许的根目录内/);
  assert.match(escaped, /允许的根/);

  const relative = await rejectMessage(sheets.call('spreadsheet_read', { path: '外面的表.csv' }));
  assert.match(relative, /必须是绝对路径/);

  const empty = await rejectMessage(sheets.call('spreadsheet_read', { path: '   ' }));
  assert.match(empty, /不能为空/);

  const traversal = await rejectMessage(sheets.call('spreadsheet_read', { path: join(root, '..', '..', 'etc', 'hosts') }));
  assert.match(traversal, /不在允许的根目录内|不存在/);

  // 软链：根内建一个指向根外的软链，必须被 realpath 后识破
  const linkPath = join(root, '逃逸.csv');
  symlinkSync(join(outside, '外面的表.csv'), linkPath);
  const viaLink = await rejectMessage(sheets.call('spreadsheet_read', { path: linkPath }));
  assert.match(viaLink, /不在允许的根目录内|跳出了允许根/);

  // 写盘也不能越界
  const writeEscape = await rejectMessage(sheets.call('spreadsheet_create', {
    outputPath: join(outside, '越界.xlsx'),
    sheets: [SAMPLE_SHEET],
  }));
  assert.match(writeEscape, /不在允许的根目录内/);

  // 输出目录还不存在时，也要按最近的已存在祖先判定
  const deepEscape = await rejectMessage(sheets.call('spreadsheet_create', {
    outputPath: join(outside, '还没建的目录', '越界.xlsx'),
    sheets: [SAMPLE_SHEET],
  }));
  assert.match(deepEscape, /不在允许的根目录内/);
});

test('路径安全：允许根内的路径可以解析，MOCHI_SHEETS_ROOTS 环境变量也能指定根', async (t) => {
  const root = makeWorkspace(t);
  const nested = join(root, 'a', 'b');
  mkdirSync(nested, { recursive: true });

  const roots = (await resolveAllowedRoots({ options: { allowedRoots: [root] }, env: {}, ctx: null })).roots;
  assert.equal(matchRoot(roots, root), root);

  const inside = await resolveInside({ roots, candidate: join(nested, '新表.xlsx'), label: '输出', mustExist: false });
  assert.equal(inside.path, join(nested, '新表.xlsx'));
  assert.equal(inside.exists, false);

  const previous = process.env.MOCHI_SHEETS_ROOTS;
  process.env.MOCHI_SHEETS_ROOTS = root;
  t.after(() => {
    if (previous === undefined) delete process.env.MOCHI_SHEETS_ROOTS;
    else process.env.MOCHI_SHEETS_ROOTS = previous;
  });
  const fromEnv = await resolveAllowedRoots({ options: {}, env: process.env, ctx: null });
  assert.equal(fromEnv.roots[0], root, '环境变量指定的根应排在缺省根前面');
});

test('spreadsheet_export 诚实地声明支持面，不支持的目标格式直接报错', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const sourcePath = join(root, '成绩表.xlsx');
  await sheets.call('spreadsheet_create', { outputPath: sourcePath, sheets: [SAMPLE_SHEET] });

  const pdfMessage = await rejectMessage(sheets.call('spreadsheet_export', {
    sourcePath,
    format: 'pdf',
    outputPath: join(root, 'x.pdf'),
  }));
  assert.match(pdfMessage, /只支持导出为 \.xlsx 或 \.csv/);
  assert.match(pdfMessage, /不支持/);
  assert.match(pdfMessage, /pdf/);

  const htmlMessage = await rejectMessage(sheets.call('spreadsheet_export', {
    sourcePath, format: 'html', outputPath: join(root, 'x.html'),
  }));
  assert.match(htmlMessage, /不支持/);

  // 支持的四种组合真的能产出文件，并如实说明丢了什么
  const toCsv = await sheets.call('spreadsheet_export', {
    sourcePath, format: 'csv', outputPath: join(root, '导出.csv'),
  });
  assert.equal(toCsv.目标格式, 'csv');
  assert.deepEqual(toCsv.支持的目标格式, ['.xlsx', '.csv']);
  assert.ok(toCsv.不支持的格式.includes('pdf'));
  assert.match(toCsv.丢失的内容, /公式会变成它的缓存值/);
  assert.deepEqual(readFileSync(toCsv.目标文件, 'utf8').trim().split('\n').map((line) => line.split(',').length), [3, 3, 3, 3]);

  const toXlsx = await sheets.call('spreadsheet_export', {
    sourcePath, format: 'xlsx', outputPath: join(root, '另存.xlsx'),
  });
  assert.equal(toXlsx.状态, '已另存并回读校验通过');
  assert.equal(toXlsx.丢失的内容, '无：.xlsx 另存是逐字节复制，公式、样式、列宽、批注都保留。');
  assert.ok(readFileSync(sourcePath).equals(readFileSync(toXlsx.目标文件)), '另存必须是逐字节相同');

  // 后缀与 format 不一致要拒绝
  const mismatch = await rejectMessage(sheets.call('spreadsheet_export', {
    sourcePath, format: 'csv', outputPath: join(root, '名字不对.xlsx'),
  }));
  assert.match(mismatch, /后缀与 format/);

  // 多工作表导 CSV 时必须指定 sheet，不能悄悄只导一张
  const multi = join(root, '多表.xlsx');
  await sheets.call('spreadsheet_create', {
    outputPath: multi,
    sheets: [SAMPLE_SHEET, { name: '第二张', columns: [{ header: '项目' }], rows: [['值']] }],
  });
  const needSheet = await rejectMessage(sheets.call('spreadsheet_export', {
    sourcePath: multi, format: 'csv', outputPath: join(root, '多表.csv'),
  }));
  assert.match(needSheet, /请用 sheet 指定要导出哪一张/);
  assert.match(needSheet, /成绩.*第二张|第二张.*成绩/);

  const chosen = await sheets.call('spreadsheet_export', {
    sourcePath: multi, format: 'csv', outputPath: join(root, '多表.csv'), sheet: '第二张',
  });
  assert.equal(chosen.导出的工作表, '第二张');

  // 声明表与实现必须一致
  assert.deepEqual([...SUPPORTED_TARGET_FORMATS], ['xlsx', 'csv']);
  assert.ok(UNSUPPORTED_TARGET_FORMATS.includes('pdf'));
  assert.ok(UNSUPPORTED_TARGET_FORMATS.includes('html'));
});

test('只读会话不许写盘：生成 / 导出 / 写公式都拒绝，且不留下任何文件', async (t) => {
  const root = makeWorkspace(t);
  const writer = mount(t, { allowedRoots: [root] });
  const sourcePath = join(root, '只读源.xlsx');
  await writer.call('spreadsheet_create', { outputPath: sourcePath, sheets: [SAMPLE_SHEET] });

  const readonly = mount(t, { allowedRoots: [root], mode: 'read-only' });
  // 读没问题
  const readResult = await readonly.call('spreadsheet_read', { path: sourcePath });
  assert.equal(readResult.状态, '已读取');

  const createMessage = await rejectMessage(readonly.call('spreadsheet_create', {
    outputPath: join(root, '只读不许写.xlsx'),
    sheets: [SAMPLE_SHEET],
  }));
  assert.match(createMessage, /只读模式/);

  const exportMessage = await rejectMessage(readonly.call('spreadsheet_export', {
    sourcePath, format: 'csv', outputPath: join(root, '只读不许导出.csv'),
  }));
  assert.match(exportMessage, /只读模式/);

  const formulaMessage = await rejectMessage(readonly.call('spreadsheet_formula', {
    path: sourcePath, outputPath: join(root, '只读不许公式.xlsx'), formulas: [{ cell: 'E1', formula: '=1+1' }],
  }));
  assert.match(formulaMessage, /只读模式/);

  const { existsSync } = await import('node:fs');
  for (const path of ['只读不许写.xlsx', '只读不许导出.csv', '只读不许公式.xlsx']) {
    assert.equal(existsSync(join(root, path)), false, `只读模式下不该产生 ${path}`);
  }
});

test('工作簿内容不实：工作表名重复、行比列宽、值不是标量都会被拒绝', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });

  const duplicate = await rejectMessage(sheets.call('spreadsheet_create', {
    outputPath: join(root, 'a.xlsx'),
    sheets: [SAMPLE_SHEET, { name: '成绩', columns: [{ header: 'x' }], rows: [['1']] }],
  }));
  assert.match(duplicate, /重复/);

  const tooWide = await rejectMessage(sheets.call('spreadsheet_create', {
    outputPath: join(root, 'b.xlsx'),
    sheets: [{ name: '宽行', columns: [{ header: '一' }], rows: [['a', 'b']] }],
  }));
  assert.match(tooWide, /只有 1 列/);

  const notScalar = await rejectMessage(sheets.call('spreadsheet_create', {
    outputPath: join(root, 'c.xlsx'),
    sheets: [{ name: '嵌套', columns: [{ header: '一' }], rows: [[{ nested: true }]] }],
  }));
  assert.match(notScalar, /不是单元格能放的基本类型/);

  const badSheetName = await rejectMessage(sheets.call('spreadsheet_create', {
    outputPath: join(root, 'd.xlsx'),
    sheets: [{ name: '非法/名字', columns: [{ header: '一' }], rows: [] }],
  }));
  assert.match(badSheetName, /不允许的字符/);
});

// 回归：老师**上传**的 Excel/CSV 必须读得动（2026-09-12「上传的 Word 打不开」同类缺陷）。
//
// 宿主把上传原件按 verbatim 存到 `<DSH_HOME>/attachments/v1/files/<digest 前缀>/<digest>/<name>`，
// 这个位置**不在会话工作区内**，而本插件的允许根原先只认工作区 → spreadsheet_read 直接
// PATH_OUTSIDE_ALLOWED_ROOT，老师看到的就是「上传的表格读不了」。
// 修法：把附件盘接成**只读**根——读既有文件时可用，写输出时一律不认。
test('spreadsheet_read 能读宿主附件盘里的上传表格，但写入绝不落进附件盘', async (t) => {
  const root = makeWorkspace(t);
  // 附件盘必须落在允许根**之外**，否则这条测试什么都没测到。
  const home = makeWorkspace(t, 'mochi-sheets-attach-home-');
  // 宿主真实布局：attachments/v1/files/<digest 前缀>/<digest>/<原文件名>
  const referenceDir = join(home, 'attachments', 'v1', 'files', 'ab', 'abcdef0123456789');
  mkdirSync(referenceDir, { recursive: true });
  const uploaded = join(referenceDir, '期中成绩.xlsx');

  const previous = { DSH_HOME: process.env.DSH_HOME, MOCHI_HOME: process.env.MOCHI_HOME };
  process.env.DSH_HOME = home;
  delete process.env.MOCHI_HOME;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const sheets = mount(t, { allowedRoots: [root] });
  // 先在允许根里生成一份真 .xlsx，再"当作上传件"放进附件盘。
  const created = await sheets.call('spreadsheet_create', {
    outputPath: join(root, '工作区成绩.xlsx'),
    sheets: [SAMPLE_SHEET],
  });
  writeFileSync(uploaded, readFileSync(created.路径));

  // 修好之前这一步会抛 PATH_OUTSIDE_ALLOWED_ROOT（老师看到的就是"上传的表格读不了"）。
  const read = await sheets.call('spreadsheet_read', { path: uploaded });
  assert.equal(read.状态, '已读取');
  assert.equal(read.路径, realpathSync(uploaded));
  assert.equal(read.工作表清单.length, 1);
  assert.equal(read.工作表清单[0].name, '成绩');

  // 只读根不放大写入面：输出仍必须落在工作区，附件盘目录不许被写。
  const writeOutside = await rejectMessage(sheets.call('spreadsheet_create', {
    outputPath: join(referenceDir, '偷写.xlsx'),
    sheets: [SAMPLE_SHEET],
  }));
  assert.match(writeOutside, /不在允许的根目录内/);
  assert.ok(!existsSync(join(referenceDir, '偷写.xlsx')), '附件盘里不许留下任何输出文件');

  // 附件盘之外依旧拒绝（另起一个临时目录，同样不属于任何允许根）。
  const other = makeWorkspace(t, 'mochi-sheets-outside-');
  const outside = join(other, '也在外面.xlsx');
  writeFileSync(outside, readFileSync(created.路径));
  const readOutside = await rejectMessage(sheets.call('spreadsheet_read', { path: outside }));
  assert.match(readOutside, /不在允许的根目录内/);
});
