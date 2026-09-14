// 公式引擎的**零依赖**回归测试（只 import ../formula.mjs 与 ../address.mjs）。
//
// 为什么单独有这个文件：formula.test.mjs 需要 exceljs / @deepseek-ai/dsh-tools，
// 在公开 CI runner 上装不上，于是公式引擎长期没有任何自动化门禁——
// 2026-09-12 就是这样漏掉了两个静默错值（SUBSTITUTE 第 4 参吃掉前缀、
// COUNTIF/SUMIF 通配符恒不命中）。本文件不引入任何第三方包，
// 因此可以进 .github/workflows/mochi-ci.yml 的「插件测试」批次。
import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILTIN_SUPPORTED_FUNCTIONS, KNOWN_UNSUPPORTED_FUNCTIONS, evaluateWorkbookCells } from '../formula.mjs';

function cell(value, formula = null) {
  return {
    raw: value,
    formula,
    value: formula ? '' : value,
    result: null,
    type: formula ? 'formula' : typeof value === 'number' ? 'number' : 'string',
  };
}

/** 手搭一个最小工作簿模型（键统一是 `行:列`）。 */
function modelOf(sheets) {
  return {
    sheets: sheets.map((sheet, index) => {
      const cells = new Map(Object.entries(sheet.cells));
      const rows = Object.keys(sheet.cells).map((key) => Number(key.split(':')[0]));
      const columns = Object.keys(sheet.cells).map((key) => Number(key.split(':')[1]));
      return {
        name: sheet.name,
        index,
        rowCount: Math.max(...rows),
        columnCount: Math.max(...columns),
        usedBounds: {
          top: Math.min(...rows),
          left: Math.min(...columns),
          bottom: Math.max(...rows),
          right: Math.max(...columns),
        },
        cells,
        sourceLines: new Map(),
      };
    }),
  };
}

function evaluate(formula, extraCells = {}) {
  const cells = { '1:1': cell(0, formula), ...extraCells };
  const model = modelOf([{ name: 'S', cells }]);
  return evaluateWorkbookCells(model, [{ sheetIndex: 0, row: 1, column: 1 }]).results.get('0:1:1');
}

function evaluateValue(formula, extraCells) {
  const result = evaluate(formula, extraCells);
  assert.equal(result.ok, true, `${formula} 求值失败：${result.message}`);
  return result.value;
}

test('引擎：算术、文本函数与错误码的确定值', () => {
  assert.equal(evaluateValue('=1+2*3'), 7);
  assert.equal(evaluateValue('=2^10'), 1024);
  assert.equal(evaluateValue('=ROUND(2.345,2)'), 2.35);
  assert.equal(evaluateValue('=LEN("Mochi 表格")'), 8);
  assert.equal(evaluateValue('=MID("2024级3班",1,4)'), '2024');
  assert.equal(evaluate('=1/0').error, '#DIV/0!');
  assert.equal(evaluate('=SQRT(-1)').error, '#NUM!');
  const unsupported = evaluate('=VLOOKUP(1,A1:B2,2)');
  assert.equal(unsupported.error, '#NAME?');
  assert.match(unsupported.message, /VLOOKUP/);
  assert.ok(!BUILTIN_SUPPORTED_FUNCTIONS.includes('VLOOKUP'));
  assert.deepEqual(
    BUILTIN_SUPPORTED_FUNCTIONS.filter((name) => KNOWN_UNSUPPORTED_FUNCTIONS.includes(name)),
    [],
    '已实现与未实现名单不得重叠',
  );
});

test('SUBSTITUTE 第 4 参：前 N-1 次命中的原文必须原样保留（回归：曾返回 "b+c"）', () => {
  assert.equal(evaluateValue('=SUBSTITUTE("a-b-c","-","+",1)'), 'a+b-c');
  assert.equal(evaluateValue('=SUBSTITUTE("a-b-c","-","+",2)'), 'a-b+c');
  assert.equal(evaluateValue('=SUBSTITUTE("abcabc","b","X",2)'), 'abcaXc');
  // 出现次数超过实际命中数 → 原样返回（Excel 语义，不是错误）
  assert.equal(evaluateValue('=SUBSTITUTE("a-b-c","-","+",9)'), 'a-b-c');
  // 第 4 参 < 1 → #VALUE!，不得静默当成第 1 次或原样返回
  assert.equal(evaluate('=SUBSTITUTE("a-b-c","-","+",0)').error, '#VALUE!');
  // 三参形态不受影响
  assert.equal(evaluateValue('=SUBSTITUTE("a-b-c","-","+")'), 'a+b+c');
});

test('COUNTIF/SUMIF/AVERAGEIF 的通配符：* ? 与 ~ 转义（回归：曾恒返回 0）', () => {
  const data = {
    '2:1': cell('张三'),
    '3:1': cell('张四'),
    '4:1': cell('李五'),
    '5:1': cell('王晓张'),
    '2:2': cell(10),
    '3:2': cell(20),
    '4:2': cell(30),
    '5:2': cell(40),
  };
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"张*")', data), 2);
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"*张*")', data), 3);
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"?三")', data), 1);
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"张三")', data), 1);
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"<>张三")', data), 3);
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"王*")', data), 1);
  assert.equal(evaluateValue('=SUMIF(A2:A5,"张*",B2:B5)', data), 30);
  assert.equal(evaluateValue('=AVERAGEIF(A2:A5,"张*",B2:B5)', data), 15);
  // 数值条件不受本次改动影响
  assert.equal(evaluateValue('=COUNTIF(B2:B5,">15")', data), 3);
  assert.equal(evaluateValue('=COUNTIF(B2:B5,20)', data), 1);
  // ~ 转义：~* 是字面量星号，~? 是字面量问号，本表里都不存在
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"~*")', data), 0);
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"~?")', data), 0);
  assert.equal(evaluateValue('=COUNTIF(A2:A5,"*")', data), 4);
});
