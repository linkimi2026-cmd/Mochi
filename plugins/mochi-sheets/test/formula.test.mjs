// 公式引擎与 spreadsheet_formula：内置引擎复算 + LibreOffice 真算（本机有时）+ 公式写入回读。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';

import {
  BUILTIN_SUPPORTED_FUNCTIONS,
  KNOWN_UNSUPPORTED_FUNCTIONS,
  evaluateWorkbookCells,
  parseFormula,
  tokenize,
} from '../formula.mjs';
import { listZipEntries } from '../sheet-write.mjs';
import { findSoffice } from '../recalc.mjs';
import { makeWorkspace, mount, rejectMessage, SAMPLE_SHEET } from './helpers.mjs';

function cell(value, formula = null) {
  return { raw: value, formula, value: formula ? '' : value, result: null, type: formula ? 'formula' : typeof value === 'number' ? 'number' : 'string' };
}

/** 手搭一个最小工作簿模型（键统一是 `行:列`）。 */
function modelOf(sheets) {
  return {
    sheets: sheets.map((sheet, index) => {
      const cells = new Map();
      for (const [key, entry] of Object.entries(sheet.cells)) cells.set(key, entry);
      const rows = Object.keys(sheet.cells).map((key) => Number(key.split(':')[0]));
      const columns = Object.keys(sheet.cells).map((key) => Number(key.split(':')[1]));
      return {
        name: sheet.name,
        index,
        rowCount: Math.max(...rows),
        columnCount: Math.max(...columns),
        usedBounds: { top: Math.min(...rows), left: Math.min(...columns), bottom: Math.max(...rows), right: Math.max(...columns) },
        cells,
        sourceLines: new Map(),
      };
    }),
  };
}

function evaluateOne(formula, sheetIndex = 0) {
  const model = modelOf([{ name: 'S', cells: { '1:1': cell(0, formula) } }]);
  return evaluateWorkbookCells(model, [{ sheetIndex, row: 1, column: 1 }]);
}

test('词法与语法：能解析嵌套函数、区域、工作表前缀、百分号与字符串连接', () => {
  assert.ok(tokenize('=SUM(A1:B2)').length > 3);
  const nested = parseFormula('ROUND(AVERAGE(A1:A3),1)');
  assert.equal(nested.type, 'call');
  assert.equal(nested.name, 'ROUND');
  assert.equal(nested.args[0].type, 'call');
  assert.equal(nested.args[0].name, 'AVERAGE');
  assert.equal(nested.args[0].args[0].type, 'range');
  const prefixed = parseFormula("'我的 表'!B2");
  assert.equal(prefixed.type, 'cell');
  assert.equal(prefixed.sheet, '我的 表');
  const percent = parseFormula('A1%');
  assert.equal(percent.type, 'unary');
});

const NUMERIC_CASES = [
  ['=1+2*3', 7],
  ['=(1+2)*3', 9],
  ['=2^10', 1024],
  ['=10/4', 2.5],
  ['=-3+1', -2],
  ['=50%', 0.5],
  ['=ROUND(2.345,2)', 2.35],
  ['=ROUND(-2.5,0)', -3],
  ['=ROUNDUP(2.1,0)', 3],
  ['=ROUNDDOWN(2.9,0)', 2],
  ['=INT(-1.5)', -2],
  ['=MOD(-3,2)', 1],
  ['=ABS(-4)', 4],
  ['=SQRT(16)', 4],
  ['=POWER(2,8)', 256],
  ['=LEN("Mochi 表格")', 8],
  ['=UPPER("abc")&LOWER("DEF")', 'ABCdef'],
  ['=TRIM("  a   b  ")', 'a b'],
  ['=MID("2024级3班",1,4)', '2024'],
  ['=SUBSTITUTE("a-b-c","-","+")', 'a+b+c'],
  ['=IF(1>2,"是","否")', '否'],
  ['=IFERROR(1/0,"除零")', '除零'],
  ['=AND(TRUE,1>0)', true],
  ['=OR(FALSE,FALSE)', false],
  ['=NOT(FALSE)', true],
  ['=VALUE("12.5%")', 0.125],
];

test('内置引擎：算术与函数的确定值（逐条比对，不一致就是算错了）', () => {
  for (const [formula, expected] of NUMERIC_CASES) {
    const { results } = evaluateOne(formula);
    const result = results.get('0:1:1');
    assert.equal(result.ok, true, `${formula} 求值失败：${result.message}`);
    if (typeof expected === 'number') {
      assert.ok(Math.abs(result.value - expected) < 1e-9, `${formula} 期望 ${expected}，实际 ${result.value}`);
    } else {
      assert.equal(result.value, expected, `${formula} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(result.value)}`);
    }
  }
});

test('内置引擎：区域聚合、条件聚合与跨工作表引用', () => {
  const model = modelOf([
    {
      name: '成绩',
      cells: {
        '1:1': cell('分数'),
        '2:1': cell(88.5),
        '3:1': cell(72),
        '4:1': cell(95),
        '1:3': cell(0, 'SUM(A2:A4)'),
        '2:3': cell(0, 'AVERAGE(A2:A4)'),
        '3:3': cell(0, 'COUNT(A2:A4)'),
        '4:3': cell(0, 'MAX(A2:A4)'),
        '5:3': cell(0, 'MEDIAN(A2:A4)'),
        '6:3': cell(0, 'COUNTIF(A2:A4,">=80")'),
        '7:3': cell(0, 'SUMIF(A2:A4,">=80")'),
        '8:3': cell(0, 'STDEV(A2:A4)'),
        '9:3': cell(0, 'LARGE(A2:A4,1)'),
        '10:3': cell(0, 'ROUND(AVERAGE(A2:A4),1)'),
      },
    },
    { name: '汇总', cells: { '1:1': cell(0, '成绩!C1/COUNT(成绩!A2:A4)') } },
  ]);
  const keys = ['1:3', '2:3', '3:3', '4:3', '5:3', '6:3', '7:3', '8:3', '9:3', '10:3'].map((key) => {
    const [row, column] = key.split(':').map(Number);
    return { sheetIndex: 0, row, column };
  });
  const evaluator = evaluateWorkbookCells(model, [...keys, { sheetIndex: 1, row: 1, column: 1 }]);
  const value = (sheetIndex, row, column) => evaluator.results.get(`${sheetIndex}:${row}:${column}`).value;

  assert.equal(value(0, 1, 3), 255.5);
  assert.ok(Math.abs(value(0, 2, 3) - 255.5 / 3) < 1e-9);
  assert.equal(value(0, 3, 3), 3);
  assert.equal(value(0, 4, 3), 95);
  assert.equal(value(0, 5, 3), 88.5);
  assert.equal(value(0, 6, 3), 2);
  assert.equal(value(0, 7, 3), 183.5);
  assert.ok(Math.abs(value(0, 10, 3) - 85.2) < 1e-9);
  assert.ok(Math.abs(value(1, 1, 1) - 255.5 / 3) < 1e-9, '跨工作表引用应能取到成绩!C1');
});

test('内置引擎：未实现的函数报 #NAME? 并点名，绝不给近似值', () => {
  const evaluator = evaluateOne('=VLOOKUP(1,A1:B2,2)');
  const result = evaluator.results.get('0:1:1');
  assert.equal(result.ok, false);
  assert.equal(result.error, '#NAME?');
  assert.match(result.message, /VLOOKUP/);
  assert.deepEqual([...evaluator.unsupportedFunctions], ['VLOOKUP']);
  assert.ok(evaluator.notices.some((note) => /没有实现这些函数/.test(note)));
  // 未实现的函数不能出现在"已实现"名单里
  assert.ok(!BUILTIN_SUPPORTED_FUNCTIONS.includes('VLOOKUP'));
  assert.ok(KNOWN_UNSUPPORTED_FUNCTIONS.includes('VLOOKUP'));
  // 两边的名单不能重叠
  const overlap = BUILTIN_SUPPORTED_FUNCTIONS.filter((name) => KNOWN_UNSUPPORTED_FUNCTIONS.includes(name));
  assert.deepEqual(overlap, []);
});

test('内置引擎：除零、循环引用、区域直接参与运算都给出明确错误码', () => {
  assert.equal(evaluateOne('=1/0').results.get('0:1:1').error, '#DIV/0!');
  assert.equal(evaluateOne('=SQRT(-1)').results.get('0:1:1').error, '#NUM!');
  assert.equal(evaluateOne('=NOSUCHFUNC(1)').results.get('0:1:1').error, '#NAME?');
  assert.equal(evaluateOne('=A1:B2+1').results.get('0:1:1').error, '#VALUE!');

  const cyclic = modelOf([{ name: 'S', cells: { '1:1': cell(0, 'B1'), '1:2': cell(0, 'A1') } }]);
  const result = evaluateWorkbookCells(cyclic, [{ sheetIndex: 0, row: 1, column: 1 }]).results.get('0:1:1');
  assert.equal(result.error, '#CIRC!');
  assert.match(result.message, /循环引用/);
});

test('spreadsheet_formula：写入公式、真实算值、回读校验，并如实说明用了哪个引擎', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const sourcePath = join(root, '成绩表.xlsx');
  const outputPath = join(root, '成绩表-公式.xlsx');
  await sheets.call('spreadsheet_create', { outputPath: sourcePath, sheets: [SAMPLE_SHEET] });

  const result = await sheets.call('spreadsheet_formula', {
    path: sourcePath,
    outputPath,
    formulas: [
      { cell: 'E1', formula: '=SUM(B2:B4)' },
      { cell: 'E2', formula: '=AVERAGE(B2:B4)' },
      { cell: 'E3', formula: '=IF(E2>80,"良好","需加强")' },
      { cell: 'E4', formula: '=COUNTIF(C2:C4,">=80")' },
      { cell: 'E5', formula: '=ROUND(AVERAGE(C2:C4),1)' },
    ],
  });

  assert.match(result.状态, /已写入公式/);
  // 源文件没被改动
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.load(readFileSync(sourcePath));
  assert.equal(sourceWorkbook.getWorksheet('成绩').getCell('E1').value, null);
  // 输出必须是真 xlsx
  const bytes = readFileSync(outputPath);
  assert.equal(bytes.length, result.输出字节数);
  assert.ok(listZipEntries(bytes).some((entry) => entry.name === 'xl/worksheets/sheet1.xml'));
  // 幂等的一致数（真算/复算两条路都必须对）
  const byCell = new Map(result.计算结果.map((entry) => [entry.单元格, entry]));
  assert.equal(byCell.get('E1').最终缓存值, 255.5);
  assert.ok(Math.abs(byCell.get('E2').最终缓存值 - 85.16666666666667) < 1e-9);
  assert.equal(byCell.get('E3').最终缓存值, '良好');
  assert.equal(byCell.get('E4').最终缓存值, 2);
  assert.equal(byCell.get('E5').最终缓存值, 81); // ROUND(AVERAGE(91,85,67),1) = 81
  assert.deepEqual(result.未算出, []);
  for (const entry of result.计算结果) {
    assert.equal(entry.两个引擎是否一致, true, `${entry.单元格} 两个引擎不一致：${JSON.stringify(entry)}`);
  }
  assert.equal(result.回读校验.不一致数, 0);

  // 回读文件确认公式文本 + 缓存值都真的在里面
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  const sheet = reopened.getWorksheet('成绩');
  assert.equal(sheet.getCell('E1').formula, 'SUM(B2:B4)');
  assert.equal(sheet.getCell('E1').result, 255.5);
  assert.equal(sheet.getCell('E3').formula, 'IF(E2>80,"良好","需加强")');
  assert.equal(sheet.getCell('E3').result, '良好');

  // 引擎说明必须诚实：有 soffice 就说真算过，没有就说只有内置复算
  const sofficePath = await findSoffice();
  if (sofficePath) {
    assert.match(result.计算引擎.外部真算引擎, /LibreOffice/);
    assert.match(result.计算引擎.说明, /真算/);
    assert.ok(result.计算引擎.外部真算耗时毫秒 >= 0);
  } else {
    assert.match(result.计算引擎.外部真算引擎, /没有/);
    assert.match(result.计算引擎.说明, /未做外部引擎真算/);
    assert.equal(result.计算引擎.外部真算覆盖, '未执行');
  }
});

test('spreadsheet_formula：内置引擎没实现的函数在无 soffice 时如实报未算出，不写假缓存', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const sourcePath = join(root, '成绩表.xlsx');
  const outputPath = join(root, '带未实现函数.xlsx');
  await sheets.call('spreadsheet_create', { outputPath: sourcePath, sheets: [SAMPLE_SHEET] });

  const result = await sheets.call('spreadsheet_formula', {
    path: sourcePath,
    outputPath,
    formulas: [
      { cell: 'E1', formula: '=SUM(B2:B4)' },
      { cell: 'E2', formula: '=VLOOKUP(1,A1:C4,2)' },
    ],
  });

  const byCell = new Map(result.计算结果.map((entry) => [entry.单元格, entry]));
  assert.equal(byCell.get('E2').内置引擎错误 !== null, true);
  assert.match(byCell.get('E2').内置引擎错误, /没有实现函数 VLOOKUP/);
  assert.deepEqual(result.计算引擎.本次未实现的函数, ['VLOOKUP']);

  const sofficePath = await findSoffice();
  if (sofficePath) {
    // LibreOffice 真算会把 VLOOKUP 算出来（这里的结果是 #N/A，因为是真引擎的判断，不是我们编的）
    assert.equal(byCell.get('E2').取值来源, 'LibreOffice 真算');
    assert.ok(byCell.get('E2').LibreOffice值 !== null);
  } else {
    // 没有外部引擎：只能如实说"没算出"，并且不能写缓存值
    assert.equal(byCell.get('E2').取值来源, '未算出');
    assert.equal(result.未算出.length, 1);
    const written = new ExcelJS.Workbook();
    await written.xlsx.load(readFileSync(outputPath));
    const cellValue = written.getWorksheet('成绩').getCell('E2').value;
    assert.equal(cellValue.formula, 'VLOOKUP(1,A1:C4,2)');
    assert.equal(cellValue.result, undefined, '未算出的公式不能带缓存结果');
  }

  // 无论走哪条路，参数说明都必须点名未实现的函数
  assert.ok(result.计算引擎.内置引擎已识别但未实现函数.includes('VLOOKUP'));
  assert.ok(result.计算引擎.内置引擎已实现函数.includes('SUM'));
});

test('LibreOffice 真算：故意写错的缓存值会被真引擎推翻（证明不是把缓存抄回来）', async (t) => {
  const sofficePath = await findSoffice();
  if (!sofficePath) {
    t.skip('本机没有 soffice，跳过外部真算通道的验证（该分支在 spreadsheet_formula 的返回里会如实标注"未执行"）');
    return;
  }
  const root = makeWorkspace(t);
  const probeSource = join(root, '故意错的缓存.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('真算');
  sheet.getCell('A1').value = 10;
  sheet.getCell('A2').value = 20;
  sheet.getCell('A3').value = { formula: 'SUM(A1:A2)', result: 999 }; // 故意写错
  await workbook.xlsx.writeFile(probeSource);

  const { recalculateWithLibreOffice } = await import('../recalc.mjs');
  const engine = await recalculateWithLibreOffice(probeSource);
  assert.equal(engine.available, true);
  assert.equal(engine.sofficePath, sofficePath);
  assert.ok(engine.formulaCellCount >= 1);
  assert.equal(engine.computed.get('真算!A3'), 30, '真引擎必须算出 30，而不是沿用文件里写错的 999');
  assert.notEqual(engine.computed.get('真算!A3'), 999);
});

test('spreadsheet_formula：默认输出路径、重复单元格与 CSV 源都按规矩拒绝', async (t) => {
  const root = makeWorkspace(t);
  const sheets = mount(t, { allowedRoots: [root] });
  const sourcePath = join(root, '成绩表.xlsx');
  await sheets.call('spreadsheet_create', { outputPath: sourcePath, sheets: [SAMPLE_SHEET] });

  const duplicated = await rejectMessage(sheets.call('spreadsheet_formula', {
    path: sourcePath,
    outputPath: join(root, 'dup.xlsx'),
    formulas: [{ cell: 'E1', formula: '=1+1' }, { cell: 'E1', formula: '=2+2' }],
  }));
  assert.match(duplicated, /同一个单元格被写了两次公式/);

  const noEquals = await rejectMessage(sheets.call('spreadsheet_formula', {
    path: sourcePath,
    outputPath: join(root, 'bad.xlsx'),
    formulas: [{ cell: 'E1', formula: 'SUM(B2:B4)' }],
  }));
  assert.match(noEquals, /必须以 = 开头/);

  const csvSource = join(root, '数据.csv');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(csvSource, 'a,b\n1,2\n', 'utf8');
  const csvMessage = await rejectMessage(sheets.call('spreadsheet_formula', {
    path: csvSource,
    outputPath: join(root, 'csv公式.xlsx'),
    formulas: [{ cell: 'C1', formula: '=A2+B2' }],
  }));
  assert.match(csvMessage, /公式只能写进 \.xlsx/);

  // 默认输出路径：源文件同目录的 <名字>-公式.xlsx
  const defaulted = await sheets.call('spreadsheet_formula', {
    path: sourcePath,
    formulas: [{ cell: 'E1', formula: '=SUM(B2:B4)' }],
  });
  assert.equal(defaulted.输出文件, join(root, '成绩表-公式.xlsx'));
  assert.equal(defaulted.计算结果[0].最终缓存值, 255.5);
});
