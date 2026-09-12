// spreadsheet_create / spreadsheet_read：真 xlsx 生成 + 解包校验、区域读取、CSV 读取、上限截断。
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { listZipEntries, sheetNamesFromOoxml } from '../sheet-write.mjs';
import { makeWorkspace, mount, rejectMessage, SAMPLE_ROWS, SAMPLE_SHEET } from './helpers.mjs';

test('spreadsheet_create 产出真 .xlsx：ZIP 容器 + OOXML 成员 + 解包读 workbook.xml', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const outputPath = join(root, '成绩表.xlsx');

  const result = await sheets.call('spreadsheet_create', { outputPath, sheets: [SAMPLE_SHEET] });

  assert.equal(result.状态, '已生成并回读校验通过');
  assert.equal(result.工作表[0], '成绩');
  // 真实字节数必须与磁盘一致（不是编的）。
  const bytes = readFileSync(result.路径);
  assert.equal(bytes.length, result.字节数);
  assert.equal(bytes.length, statSync(result.路径).size);
  assert.ok(bytes.length > 2000, `xlsx 体积不合理：${bytes.length}`);

  // 1) ZIP 容器签名（PK\x03\x04）
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);

  // 2) 独立解包：自实现的 ZIP 中央目录解析 + 真解压 xl/workbook.xml
  const entries = listZipEntries(bytes);
  const names = entries.map((entry) => entry.name);
  for (const member of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']) {
    assert.ok(names.includes(member), `ZIP 里缺少 OOXML 成员 ${member}；实际成员：${names.join(', ')}`);
  }
  const ooxml = sheetNamesFromOoxml(bytes);
  assert.deepEqual(ooxml.names, ['成绩']);
  const workbookXml = entries.find((entry) => entry.name === 'xl/workbook.xml').content().toString('utf8');
  assert.match(workbookXml, /<sheet\b/, 'xl/workbook.xml 里没有 <sheet> 声明，不是真的 OOXML');

  // 3) 真工作表 XML 里必须出现真实单元格内容（不是把 CSV 塞进 zip）
  const sheetXml = entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml').content().toString('utf8');
  assert.match(sheetXml, /<row\b/);
  assert.match(sheetXml, /r="A1"/);
  // 汉字经 sharedStrings 存放，确认 sharedStrings 里真的有这三个人名。
  const sharedStrings = entries.find((entry) => entry.name === 'xl/sharedStrings.xml').content().toString('utf8');
  for (const name of ['姓名', '语文', '数学', '张三', '李四', '王五']) {
    assert.ok(sharedStrings.includes(name), `sharedStrings.xml 里没有「${name}」`);
  }

  // 4) 逐格回读校验是全覆盖，不是抽一格
  assert.equal(result.逐格回读校验.比对单元格数, 3 + 3 * 3);
  assert.equal(result.ZIP成员数, entries.length);
  assert.match(result.校验和sha256, /^[0-9a-f]{64}$/);
});

test('spreadsheet_create 拒绝覆盖已有文件、拒绝非 xlsx 输出、拒绝超过 31 字的工作表名', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const outputPath = join(root, 'a.xlsx');
  await sheets.call('spreadsheet_create', { outputPath, sheets: [SAMPLE_SHEET] });

  const exists = await rejectMessage(sheets.call('spreadsheet_create', { outputPath, sheets: [SAMPLE_SHEET] }));
  assert.match(exists, /已存在/);

  const notXlsx = await rejectMessage(sheets.call('spreadsheet_create', { outputPath: join(root, 'b.csv'), sheets: [SAMPLE_SHEET] }));
  assert.match(notXlsx, /必须以 \.xlsx 结尾/);

  const longName = await rejectMessage(sheets.call('spreadsheet_create', {
    outputPath: join(root, 'c.xlsx'),
    sheets: [{ ...SAMPLE_SHEET, name: '这是一个非常长的工作表名字用来测试超过三十一个字符上限的情况确实太长了' }],
  }));
  assert.match(longName, /超过 31 个字符/);
  assert.ok('这是一个非常长的工作表名字用来测试超过三十一个字符上限的情况确实太长了'.length > 31);
});

test('spreadsheet_create → spreadsheet_read：区域读取与整表读取都拿到真实值', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const outputPath = join(root, '成绩表.xlsx');
  await sheets.call('spreadsheet_create', { outputPath, sheets: [SAMPLE_SHEET] });

  const all = await sheets.call('spreadsheet_read', { path: outputPath });
  assert.equal(all.格式, 'xlsx');
  assert.deepEqual(all.工作表清单.map((sheet) => sheet.name), ['成绩']);
  assert.equal(all.工作表清单[0].usedRange, 'A1:C4');
  assert.equal(all.区域.实际返回, 'A1:C4');
  assert.deepEqual(
    all.行.map((row) => row.单元格.map((cell) => cell.值)),
    [['姓名', '语文', '数学'], ...SAMPLE_ROWS],
  );
  assert.equal(all.截断.是否截断, false);

  const region = await sheets.call('spreadsheet_read', { path: outputPath, range: 'B2:B4' });
  assert.equal(region.区域.实际返回, 'B2:B4');
  assert.deepEqual(region.行.map((row) => row.单元格.map((cell) => cell.值)), [[88.5], [72], [95]]);

  // 读不存在的区域：不报错，但如实说这里是空的
  const outside = await sheets.call('spreadsheet_read', { path: outputPath, range: 'Z1:Z3' });
  assert.equal(outside.区域.实际返回, null);
  assert.deepEqual(outside.行, []);
});

test('spreadsheet_read 读 CSV：手写解析器处理引号转义，数字认成数字', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const csvPath = join(root, '分数.csv');
  writeFileSync(csvPath, '姓名,备注,分数\r\n"张三, 一班","他说 ""加油""",88.5\r\n李四,,72\r\n', 'utf8');

  const result = await sheets.call('spreadsheet_read', { path: csvPath });
  assert.equal(result.格式, 'csv');
  assert.equal(result.工作表清单[0].name, 'CSV');
  assert.equal(result.区域.实际返回, 'A1:C3');
  const grid = result.行.map((row) => row.单元格.map((cell) => cell.值));
  assert.deepEqual(grid[0], ['姓名', '备注', '分数']);
  assert.equal(grid[1][0], '张三, 一班');
  assert.equal(grid[1][1], '他说 "加油"');
  assert.equal(grid[1][2], 88.5);
  assert.equal(grid[2][1], '');
  // 行号是记录序号，同时给出源文件物理行号
  assert.equal(result.行[1].单元格[0].源文件行号, 2);
});

test('spreadsheet_read 抗大表：超出 maxRows / maxColumns 时截断并如实说明', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const outputPath = join(root, '大表.xlsx');
  const rows = Array.from({ length: 30 }, (_, index) => [`学生${index + 1}`, index, index * 2, index * 3]);
  await sheets.call('spreadsheet_create', {
    outputPath,
    sheets: [{
      name: '大表',
      columns: ['姓名', 'A', 'B', 'C'].map((header) => ({ header })),
      rows,
    }],
  });

  const rowsOnly = await sheets.call('spreadsheet_read', { path: outputPath, maxRows: 5 });
  assert.equal(rowsOnly.截断.是否截断, true);
  assert.deepEqual(rowsOnly.截断.行, { included: 5, total: 31 });
  assert.equal(rowsOnly.行.length, 5);
  assert.ok(rowsOnly.提示.some((note) => /行被截断/.test(note)), rowsOnly.提示.join('|'));

  const columnsOnly = await sheets.call('spreadsheet_read', { path: outputPath, maxColumns: 2 });
  assert.equal(columnsOnly.截断.是否截断, true);
  assert.deepEqual(columnsOnly.截断.列, { included: 2, total: 4 });
  assert.equal(columnsOnly.区域.返回行列数.列, 2);

  // 默认上限（200 行）在 31 行表上不该截断
  const defaulted = await sheets.call('spreadsheet_read', { path: outputPath });
  assert.equal(defaulted.截断.是否截断, false);
  assert.equal(defaulted.上限.行, 200);
  assert.equal(defaulted.行.length, 31);
});

test('spreadsheet_read 挡住改名冒充：CSV 改名成 .xlsx、HTML 都不是真表格', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const csvPath = join(root, '真数据.csv');
  writeFileSync(csvPath, 'a,b\n1,2\n', 'utf8');
  const fake = join(root, '假表格.xlsx');
  copyFileSync(csvPath, fake);

  const message = await rejectMessage(sheets.call('spreadsheet_read', { path: fake }));
  assert.match(message, /不是真正的 \.xlsx/);

  const html = join(root, '假表格2.xlsx');
  writeFileSync(html, '<table><tr><td>1</td></tr></table>', 'utf8');
  const htmlMessage = await rejectMessage(sheets.call('spreadsheet_read', { path: html }));
  assert.match(htmlMessage, /不是真正的 \.xlsx/);

  const unsupported = join(root, 'x.pdf');
  writeFileSync(unsupported, '%PDF-1.4 假装是 PDF\n', 'utf8');
  const badFormat = await rejectMessage(sheets.call('spreadsheet_read', { path: unsupported }));
  assert.match(badFormat, /只支持 \.xlsx 与 \.csv/);
  assert.match(badFormat, /不读 \.xls/);
});
