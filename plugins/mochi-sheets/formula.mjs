// mochi-sheets · 公式引擎。
//
// 必须说清楚的事情（不装算过）：
//   ExcelJS **不会**计算公式。它只把公式文本连同"缓存结果"写进 xlsx。
//   所以本文件提供两条路：
//     A. 内置引擎（本文件）：递归下降解析 + 自实现的函数子集，能算给出确定值，
//        覆盖范围见 BUILTIN_SUPPORTED_FUNCTIONS；不在名单里的一律报 #NAME?，
//        并列入 unsupportedFunctions，**绝不猜一个数**。
//     B. 外部真算引擎（tools.mjs 里调用）：本机若有 LibreOffice（soffice），
//        把**不带缓存结果**的探测副本喂给它换算，拿回来的就是真引擎结果，
//        再以此作为交付文件的缓存值。这一步是真算，不是我们的复算。
//   两条路的差异会逐格列出来，不一致或没算的一律如实写进返回。
//
// 复算纪律来自 plugins/mochi-grades：统计口径零自算、拿不准就标待核对；
// 这里对应"没实现就报 #NAME? 并列出函数名"，不拿近似值冒充。
import { addressOf, cellKey, columnIndex, columnName, evalKey, parseCell } from './address.mjs';

export class FormulaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FormulaError';
    this.code = code;
  }
}

function formulaError(code, message) {
  return new FormulaError(code, message);
}

// ── 支持的函数（内置引擎真的实现了这些） ──────────────────────────────────────
export const BUILTIN_SUPPORTED_FUNCTIONS = Object.freeze([
  // 数值
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTBLANK', 'PRODUCT',
  'ABS', 'SIGN', 'SQRT', 'POWER', 'EXP', 'LN', 'LOG10', 'LOG', 'INT', 'TRUNC',
  'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'CEILING', 'FLOOR', 'MOD',
  // 统计
  'MEDIAN', 'LARGE', 'SMALL', 'RANK', 'STDEV', 'STDEVP', 'VAR', 'VARP',
  'COUNTIF', 'SUMIF', 'AVERAGEIF', 'SUMPRODUCT',
  // 逻辑
  'IF', 'IFERROR', 'AND', 'OR', 'NOT', 'TRUE', 'FALSE',
  // 文本
  'CONCATENATE', 'CONCAT', 'LEN', 'LEFT', 'RIGHT', 'MID', 'TRIM', 'UPPER',
  'LOWER', 'REPT', 'SUBSTITUTE', 'VALUE',
]);

// ── 认得出但内置引擎没实现的常见函数（命中时报 #NAME? 并点名） ──────────────────
export const KNOWN_UNSUPPORTED_FUNCTIONS = Object.freeze([
  'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'LOOKUP', 'INDEX', 'MATCH', 'OFFSET', 'INDIRECT',
  'SUMIFS', 'COUNTIFS', 'AVERAGEIFS', 'MAXIFS', 'MINIFS',
  'TEXT', 'TEXTJOIN', 'DATE', 'TIME', 'TODAY', 'NOW', 'YEAR', 'MONTH', 'DAY',
  'HOUR', 'MINUTE', 'SECOND', 'DATEDIF', 'EOMONTH', 'EDATE', 'NETWORKDAYS',
  'WEEKDAY', 'DATEVALUE', 'DAYS', 'WORKDAY',
  'PERCENTILE', 'QUARTILE', 'MODE', 'CORREL', 'SLOPE', 'INTERCEPT', 'TREND',
  'PMT', 'FV', 'PV', 'RATE', 'NPV', 'IRR', 'XNPV', 'XIRR',
  'RAND', 'RANDBETWEEN', 'NOW', 'TEXTSPLIT', 'LET', 'LAMBDA', 'SEQUENCE',
  'CHOOSE', 'SWITCH', 'IFS', 'IFNA', 'ARRAYFORMULA', 'TRANSPOSE', 'UNIQUE', 'SORT', 'FILTER',
  'SEARCH', 'FIND', 'EXACT', 'PROPER', 'CLEAN', 'T', 'N', 'TYPE', 'ISNUMBER',
  'ISTEXT', 'ISBLANK', 'ISERROR', 'ISERR', 'ISNA', 'NA', 'ERROR.TYPE',
  'DSUM', 'DCOUNT', 'DAVERAGE', 'SUBTOTAL', 'AGGREGATE', 'CEILING.MATH', 'FLOOR.MATH',
  'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'MODE.SNGL', 'NORM.DIST', 'NORM.INV',
  'DOLLAR', 'FIXED', 'ROMAN', 'BASE', 'DECIMAL', 'CONVERT',
]);

const SUPPORTED = new Set(BUILTIN_SUPPORTED_FUNCTIONS);
const KNOWN_UNSUPPORTED = new Set(KNOWN_UNSUPPORTED_FUNCTIONS);

// ── 词法 ────────────────────────────────────────────────────────────────────
const CELL_RE = /^\$?[A-Za-z]{1,3}\$?\d{1,7}$/;
const COL_RE = /^\$?[A-Za-z]{1,3}$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

export function tokenize(input) {
  const text = String(input).replace(/^=/, '');
  const tokens = [];
  let index = 0;
  const readQuotedSheet = () => {
    // 进入时 index 指向 '，读取 Excel 的 '...''...' 引号规则。
    let name = '';
    index += 1;
    while (index < text.length) {
      if (text[index] === "'") {
        if (text[index + 1] === "'") { name += "'"; index += 2; continue; }
        index += 1;
        return name;
      }
      name += text[index];
      index += 1;
    }
    throw formulaError('#NAME?', `公式里的工作表名没有闭合的引号：${text}`);
  };

  while (index < text.length) {
    const ch = text[index];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { index += 1; continue; }

    // 工作表前缀：Sheet1! / 成绩! / 'My Sheet'!
    // 注意：中文工作表名在 Excel 里通常被引号包起来，但老师手写时往往不写引号，
    // 所以这里对 Unicode 字母/数字也做前缀识别（后面必须紧跟单元格或列名）。
    let sheet = null;
    if (ch === "'") {
      const start = index;
      const name = readQuotedSheet();
      if (text[index] !== '!') {
        index = start;
        throw formulaError('#NAME?', `公式里的 '${name}' 后面不是 !，无法理解为工作表名：${text}`);
      }
      sheet = name;
      index += 1;
    } else {
      const sheetMatch = /^([\p{L}\p{N}_][\p{L}\p{N}_.]*)!/u.exec(text.slice(index));
      if (sheetMatch && !CELL_RE.test(sheetMatch[1])) {
        sheet = sheetMatch[1];
        index += sheetMatch[1].length + 1;
      }
    }

    if (sheet !== null) {
      // 前缀后面必须紧跟单元格/区域起始
      const rest = text.slice(index);
      const cellMatch = /^\$?[A-Za-z]{1,3}\$?\d{1,7}/.exec(rest);
      const colMatch = /^\$?[A-Za-z]{1,3}(?=\s*:)/.exec(rest);
      if (cellMatch) {
        tokens.push({ type: 'cell', text: cellMatch[0], sheet, pos: index });
        index += cellMatch[0].length;
        continue;
      }
      if (colMatch) {
        tokens.push({ type: 'ident', text: colMatch[0], sheet, pos: index });
        index += colMatch[0].length;
        continue;
      }
      throw formulaError('#NAME?', `「${sheet}!」后面不是合法的单元格或区域：${text}`);
    }

    if (ch === '"') {
      let value = '';
      index += 1;
      let closed = false;
      while (index < text.length) {
        if (text[index] === '"') {
          if (text[index + 1] === '"') { value += '"'; index += 2; continue; }
          index += 1;
          closed = true;
          break;
        }
        value += text[index];
        index += 1;
      }
      if (!closed) throw formulaError('#VALUE!', `公式里的字符串没有闭合的双引号：${text}`);
      tokens.push({ type: 'string', text: value, pos: index });
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[index + 1] ?? ''))) {
      const match = /^\d*\.?\d+([eE][+-]?\d+)?/.exec(text.slice(index));
      if (!match) throw formulaError('#VALUE!', `公式里的数字不合法：${text}`);
      tokens.push({ type: 'number', text: match[0], pos: index });
      index += match[0].length;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      const match = /^\$?[A-Za-z_][A-Za-z0-9_.$]*/.exec(text.slice(index));
      const word = match[0];
      // 函数名：后面（跳过空格）是 (
      const following = text.slice(index + word.length);
      const isCall = /^\s*\(/.test(following);
      if (CELL_RE.test(word)) tokens.push({ type: 'cell', text: word, sheet: null, pos: index });
      else if (isCall) tokens.push({ type: 'func', text: word.toUpperCase(), pos: index });
      else tokens.push({ type: 'ident', text: word, sheet: null, pos: index });
      index += word.length;
      continue;
    }

    const two = text.slice(index, index + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      tokens.push({ type: 'op', text: two, pos: index });
      index += 2;
      continue;
    }
    if ('+-*/^%&=<>(),;:'.includes(ch)) {
      tokens.push({ type: 'op', text: ch, pos: index });
      index += 1;
      continue;
    }
    throw formulaError('#VALUE!', `公式里有看不懂的字符「${ch}」：${text}`);
  }
  tokens.push({ type: 'eof', text: '', pos: text.length });
  return tokens;
}

// ── 语法（递归下降） ─────────────────────────────────────────────────────────
export function parseFormula(input) {
  const tokens = tokenize(input);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const next = () => tokens[cursor++];
  const eatOp = (text) => {
    const token = peek();
    if (token.type === 'op' && token.text === text) { cursor += 1; return true; }
    return false;
  };
  const expectOp = (text) => {
    if (!eatOp(text)) throw formulaError('#VALUE!', `公式缺少「${text}」：${String(input)}`);
  };

  function parseExpression() { return parseComparison(); }

  function parseComparison() {
    let left = parseConcat();
    for (;;) {
      const token = peek();
      if (token.type !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(token.text)) return left;
      cursor += 1;
      left = { type: 'binary', op: token.text, left, right: parseConcat() };
    }
  }

  function parseConcat() {
    let left = parseAdditive();
    while (eatOp('&')) left = { type: 'binary', op: '&', left, right: parseAdditive() };
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    for (;;) {
      const token = peek();
      if (token.type !== 'op' || (token.text !== '+' && token.text !== '-')) return left;
      cursor += 1;
      left = { type: 'binary', op: token.text, left, right: parseMultiplicative() };
    }
  }

  function parseMultiplicative() {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (token.type !== 'op' || (token.text !== '*' && token.text !== '/')) return left;
      cursor += 1;
      left = { type: 'binary', op: token.text, left, right: parseUnary() };
    }
  }

  function parseUnary() {
    const token = peek();
    if (token.type === 'op' && (token.text === '-' || token.text === '+')) {
      cursor += 1;
      const operand = parseUnary();
      return token.text === '-' ? { type: 'unary', op: '-', operand } : operand;
    }
    return parsePower();
  }

  function parsePower() {
    const left = parsePostfix();
    if (eatOp('^')) return { type: 'binary', op: '^', left, right: parseUnary() };
    return left;
  }

  function parsePostfix() {
    let node = parsePrimary();
    while (eatOp('%')) node = { type: 'unary', op: '%', operand: node };
    return node;
  }

  function rangeFromSheet(sheetText) {
    if (sheetText === null || sheetText === undefined) return null;
    return String(sheetText);
  }

  function parsePrimary() {
    const token = next();
    if (token.type === 'func') {
      // 嵌套函数调用（如 ROUND(AVERAGE(A1:A3),1)）必须在这里处理，
      // 否则只有最外层那个函数能被解析。
      return { type: 'call', name: token.text, sheet: token.sheet ? String(token.sheet) : null, args: parseArguments() };
    }
    if (token.type === 'number') return { type: 'number', value: Number(token.text) };
    if (token.type === 'string') return { type: 'string', value: token.text };
    if (token.type === 'cell') {
      const start = parseCell(token.text);
      const startSheet = rangeFromSheet(token.sheet);
      if (eatOp(':')) {
        const endToken = next();
        if (endToken.type === 'cell') {
          const end = parseCell(endToken.text);
          const endSheet = endToken.sheet ? String(endToken.sheet) : startSheet;
          return {
            type: 'range',
            sheet: startSheet,
            start,
            end,
            endSheet,
            top: Math.min(start.row, end.row),
            bottom: Math.max(start.row, end.row),
            left: Math.min(start.column, end.column),
            right: Math.max(start.column, end.column),
          };
        }
        if (endToken.type === 'ident' && COL_RE.test(endToken.text)) {
          const right = columnIndex(endToken.text);
          return {
            type: 'range',
            sheet: startSheet,
            start,
            end: { row: 1_048_576, column: right, address: `${columnName(right)}1048576` },
            endSheet: startSheet,
            top: 1,
            bottom: 1_048_576,
            left: Math.min(start.column, right),
            right: Math.max(start.column, right),
          };
        }
        throw formulaError('#VALUE!', `区域写法不完整：${String(input)}`);
      }
      return { type: 'cell', ...start, sheet: startSheet };
    }
    if (token.type === 'ident') {
      const upper = token.text.toUpperCase();
      if (upper === 'TRUE') return { type: 'boolean', value: true };
      if (upper === 'FALSE') return { type: 'boolean', value: false };
      const sheet = token.sheet ? String(token.sheet) : null;
      if (eatOp(':')) {
        const endToken = next();
        if (endToken.type === 'ident' && COL_RE.test(token.text) && COL_RE.test(endToken.text)) {
          const left = columnIndex(token.text);
          const right = columnIndex(endToken.text);
          return {
            type: 'range',
            sheet,
            top: 1,
            bottom: 1_048_576,
            left: Math.min(left, right),
            right: Math.max(left, right),
            columnOnly: true,
          };
        }
        if (endToken.type === 'number') {
          throw formulaError('#VALUE!', '行区域（如 3:7）请写成 3:7 的整行形式，且不要放在函数参数之外。');
        }
        throw formulaError('#VALUE!', `区域写法不完整：${String(input)}`);
      }
      return { type: 'name', name: token.text, sheet };
    }
    if (token.type === 'op' && token.text === '(') {
      const inner = parseExpression();
      expectOp(')');
      return inner;
    }
    if (token.type === 'op' && token.text === '-') {
      return { type: 'unary', op: '-', operand: parseUnary() };
    }
    throw formulaError('#VALUE!', `公式在「${token.text || '(结尾)'}」处不完整：${String(input)}`);
  }

  function parseArguments() {
    const args = [];
    expectOp('(');
    if (eatOp(')')) return args;
    for (;;) {
      if (peek().type === 'op' && (peek().text === ',' || peek().text === ')')) {
        args.push({ type: 'empty' });
      } else {
        args.push(parseExpression());
      }
      if (eatOp(',')) continue;
      if (eatOp(';')) continue;
      expectOp(')');
      return args;
    }
  }

  // 顶层：整行区间写法 3:7（除了它，其余一律走表达式，函数调用由 parsePrimary 处理）。
  const first = peek();
  if (first.type === 'number' && tokens[cursor + 1]?.type === 'op' && tokens[cursor + 1].text === ':') {
    cursor += 2;
    const endToken = next();
    if (endToken.type !== 'number') throw formulaError('#VALUE!', `行区域写法不完整：${String(input)}`);
    const top = Number(first.text);
    const bottom = Number(endToken.text);
    const node = {
      type: 'range',
      sheet: null,
      top: Math.min(top, bottom),
      bottom: Math.max(top, bottom),
      left: 1,
      right: 16_384,
    };
    if (peek().type !== 'eof') throw formulaError('#VALUE!', `公式里有多余内容：${String(input)}`);
    return node;
  }

  const node = parseExpression();
  if (peek().type !== 'eof') {
    throw formulaError('#VALUE!', `公式里有多余内容「${peek().text}」：${String(input)}`);
  }
  return node;
}

// ── 求值 ────────────────────────────────────────────────────────────────────
class RangeRef {
  constructor(sheetIndex, top, left, bottom, right, resolve) {
    this.sheetIndex = sheetIndex;
    this.top = top;
    this.left = left;
    this.bottom = bottom;
    this.right = right;
    this.resolve = resolve;
  }

  *values() {
    for (let row = this.top; row <= this.bottom; row += 1) {
      for (let column = this.left; column <= this.right; column += 1) {
        yield this.resolve(this.sheetIndex, row, column);
      }
    }
  }
}

const ERROR_CODES = new Set(['#DIV/0!', '#VALUE!', '#NAME?', '#REF!', '#NUM!', '#N/A', '#CIRC!', '#OPS!']);

function toNumber(value, context) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw formulaError('#NUM!', `${context}：结果不是有限数字（${value}）。`);
    return value;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).trim();
  if (text === '') return 0;
  const numeric = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) throw formulaError('#VALUE!', `${context}：文本「${value}」不是数字，无法参与算术运算。`);
  return numeric;
}

function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

function toBoolean(value, context) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toUpperCase();
  if (text === 'TRUE') return true;
  if (text === 'FALSE') return false;
  if (text === '') return false;
  throw formulaError('#VALUE!', `${context}：文本「${value}」不能当逻辑值用。`);
}

function excelRound(value, digits, mode) {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const epsilon = Number.EPSILON * Math.abs(scaled) * 4;
  let rounded;
  if (mode === 'round') rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + epsilon);
  else if (mode === 'up') rounded = Math.sign(scaled) * Math.ceil(Math.abs(scaled) - epsilon);
  else rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled) + epsilon);
  return rounded / factor;
}

function numericList(args, context) {
  const out = [];
  for (const arg of args) {
    if (arg instanceof RangeRef) {
      for (const value of arg.values()) {
        if (value === null || value === undefined || value === '') continue;
        if (typeof value === 'number') out.push(value);
        else if (typeof value === 'boolean') out.push(value ? 1 : 0);
        else {
          const numeric = Number(String(value).replace(/,/g, ''));
          if (Number.isFinite(numeric)) out.push(numeric);
        }
      }
      continue;
    }
    if (arg === null || arg === undefined || arg === '') continue;
    out.push(toNumber(arg, context));
  }
  return out;
}

function flatten(args) {
  const out = [];
  for (const arg of args) {
    if (arg instanceof RangeRef) {
      for (const value of arg.values()) out.push(value);
      continue;
    }
    out.push(arg);
  }
  return out;
}

function escapeRegExpCharacter(ch) {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/** 条件里是否存在未转义的通配符（Excel 的 * 与 ?，~ 是转义前缀）。 */
function hasWildcard(pattern) {
  for (let index = 0; index < pattern.length; index += 1) {
    const ch = pattern[index];
    if (ch === '~') { index += 1; continue; }
    if (ch === '*' || ch === '?') return true;
  }
  return false;
}

/**
 * 把 COUNTIF/SUMIF/AVERAGEIF 的文本条件编译成通配符正则。
 * Excel 语义：* 匹配任意长度、? 匹配单个字符、~ 转义下一个字符（~* 是字面量星号）。
 */
function wildcardToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const ch = pattern[index];
    if (ch === '~' && index + 1 < pattern.length && '~*?'.includes(pattern[index + 1])) {
      source += escapeRegExpCharacter(pattern[index + 1]);
      index += 1;
      continue;
    }
    if (ch === '*') { source += '.*'; continue; }
    if (ch === '?') { source += '.'; continue; }
    source += escapeRegExpCharacter(ch);
  }
  return new RegExp(`^${source}$`, 'i');
}

function matchCriteria(value, criteria) {
  let op = '=';
  let target = criteria;
  if (typeof criteria === 'string') {
    const match = /^(<=|>=|<>|=|<|>)(.*)$/.exec(criteria.trim());
    if (match) { op = match[1]; target = match[2]; }
  }
  // 通配符只参与相等/不等比较：Excel 的 <、> 不认 * 与 ?。
  if (typeof target === 'string' && (op === '=' || op === '<>') && hasWildcard(target)) {
    const matched = wildcardToRegExp(target).test(toText(value));
    return op === '=' ? matched : !matched;
  }
  const numericTarget = typeof target === 'number' ? target : Number(String(target).replace(/,/g, ''));
  const valueIsNumber = typeof value === 'number';
  const targetIsNumber = Number.isFinite(numericTarget) && String(target).trim() !== '';
  if (valueIsNumber && targetIsNumber) {
    if (op === '=') return value === numericTarget;
    if (op === '<>') return value !== numericTarget;
    if (op === '<') return value < numericTarget;
    if (op === '>') return value > numericTarget;
    if (op === '<=') return value <= numericTarget;
    return value >= numericTarget;
  }
  const left = toText(value).toLowerCase();
  const right = toText(target).toLowerCase();
  if (op === '=') return left === right;
  if (op === '<>') return left !== right;
  if (op === '<') return left < right;
  if (op === '>') return left > right;
  if (op === '<=') return left <= right;
  return left >= right;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values, population) {
  if (values.length === 0) return 0;
  if (!population && values.length < 2) throw formulaError('#DIV/0!', 'STDEV/VAR 至少需要两个数字。');
  const average = mean(values);
  const total = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return total / (population ? values.length : values.length - 1);
}

const FUNCTIONS = {
  SUM: (args) => numericList(args, 'SUM').reduce((sum, value) => sum + value, 0),
  AVERAGE: (args) => {
    const values = numericList(args, 'AVERAGE');
    if (values.length === 0) throw formulaError('#DIV/0!', 'AVERAGE 的参数里没有任何数字。');
    return mean(values);
  },
  MIN: (args) => {
    const values = numericList(args, 'MIN');
    return values.length === 0 ? 0 : Math.min(...values);
  },
  MAX: (args) => {
    const values = numericList(args, 'MAX');
    return values.length === 0 ? 0 : Math.max(...values);
  },
  COUNT: (args) => numericList(args, 'COUNT').length,
  COUNTA: (args) => flatten(args).filter((value) => value !== null && value !== undefined && value !== '').length,
  COUNTBLANK: (args) => flatten(args).filter((value) => value === null || value === undefined || value === '').length,
  PRODUCT: (args) => {
    const values = numericList(args, 'PRODUCT');
    return values.length === 0 ? 0 : values.reduce((total, value) => total * value, 1);
  },
  ABS: (args) => Math.abs(toNumber(args[0], 'ABS')),
  SIGN: (args) => Math.sign(toNumber(args[0], 'SIGN')),
  SQRT: (args) => {
    const value = toNumber(args[0], 'SQRT');
    if (value < 0) throw formulaError('#NUM!', 'SQRT 的参数不能是负数。');
    return Math.sqrt(value);
  },
  POWER: (args) => {
    const result = toNumber(args[0], 'POWER') ** toNumber(args[1], 'POWER');
    if (!Number.isFinite(result)) throw formulaError('#NUM!', 'POWER 的结果不是有限数字。');
    return result;
  },
  EXP: (args) => Math.exp(toNumber(args[0], 'EXP')),
  LN: (args) => {
    const value = toNumber(args[0], 'LN');
    if (value <= 0) throw formulaError('#NUM!', 'LN 的参数必须大于 0。');
    return Math.log(value);
  },
  LOG10: (args) => {
    const value = toNumber(args[0], 'LOG10');
    if (value <= 0) throw formulaError('#NUM!', 'LOG10 的参数必须大于 0。');
    return Math.log10(value);
  },
  LOG: (args) => {
    const value = toNumber(args[0], 'LOG');
    const base = args.length > 1 ? toNumber(args[1], 'LOG') : 10;
    if (value <= 0) throw formulaError('#NUM!', 'LOG 的参数必须大于 0。');
    if (base <= 0 || base === 1) throw formulaError('#NUM!', 'LOG 的底数必须大于 0 且不等于 1。');
    return Math.log(value) / Math.log(base);
  },
  INT: (args) => Math.floor(toNumber(args[0], 'INT')),
  TRUNC: (args) => {
    const value = toNumber(args[0], 'TRUNC');
    const digits = args.length > 1 ? toNumber(args[1], 'TRUNC') : 0;
    return excelRound(value, digits, 'down');
  },
  ROUND: (args) => excelRound(toNumber(args[0], 'ROUND'), toNumber(args[1] ?? 0, 'ROUND'), 'round'),
  ROUNDUP: (args) => excelRound(toNumber(args[0], 'ROUNDUP'), toNumber(args[1] ?? 0, 'ROUNDUP'), 'up'),
  ROUNDDOWN: (args) => excelRound(toNumber(args[0], 'ROUNDDOWN'), toNumber(args[1] ?? 0, 'ROUNDDOWN'), 'down'),
  CEILING: (args) => {
    const value = toNumber(args[0], 'CEILING');
    const significance = args.length > 1 ? toNumber(args[1], 'CEILING') : 1;
    if (significance === 0) return 0;
    return Math.ceil(value / significance) * significance;
  },
  FLOOR: (args) => {
    const value = toNumber(args[0], 'FLOOR');
    const significance = args.length > 1 ? toNumber(args[1], 'FLOOR') : 1;
    if (significance === 0) throw formulaError('#DIV/0!', 'FLOOR 的步长不能是 0。');
    return Math.floor(value / significance) * significance;
  },
  MOD: (args) => {
    const dividend = toNumber(args[0], 'MOD');
    const divisor = toNumber(args[1], 'MOD');
    if (divisor === 0) throw formulaError('#DIV/0!', 'MOD 的除数不能是 0。');
    const remainder = dividend - divisor * Math.floor(dividend / divisor);
    return remainder;
  },
  MEDIAN: (args) => {
    const values = numericList(args, 'MEDIAN').slice().sort((left, right) => left - right);
    if (values.length === 0) throw formulaError('#NUM!', 'MEDIAN 的参数里没有任何数字。');
    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  },
  LARGE: (args) => {
    const values = numericList([args[0]], 'LARGE').slice().sort((left, right) => right - left);
    const rank = Math.trunc(toNumber(args[1], 'LARGE'));
    if (rank < 1 || rank > values.length) throw formulaError('#NUM!', `LARGE 的第 ${rank} 大超出数据范围（共 ${values.length} 个数字）。`);
    return values[rank - 1];
  },
  SMALL: (args) => {
    const values = numericList([args[0]], 'SMALL').slice().sort((left, right) => left - right);
    const rank = Math.trunc(toNumber(args[1], 'SMALL'));
    if (rank < 1 || rank > values.length) throw formulaError('#NUM!', `SMALL 的第 ${rank} 小超出数据范围（共 ${values.length} 个数字）。`);
    return values[rank - 1];
  },
  RANK: (args) => {
    const value = toNumber(args[0], 'RANK');
    const values = numericList([args[1]], 'RANK');
    const ascending = args.length > 2 ? toNumber(args[2], 'RANK') !== 0 : false;
    const ordered = values.slice().sort((left, right) => (ascending ? left - right : right - left));
    const index = ordered.findIndex((entry) => entry === value);
    if (index < 0) throw formulaError('#N/A', `RANK 的值 ${value} 不在数据里。`);
    return index + 1;
  },
  STDEV: (args) => Math.sqrt(variance(numericList(args, 'STDEV'), false)),
  STDEVP: (args) => Math.sqrt(variance(numericList(args, 'STDEVP'), true)),
  VAR: (args) => variance(numericList(args, 'VAR'), false),
  VARP: (args) => variance(numericList(args, 'VARP'), true),
  SUMPRODUCT: (args) => {
    const lists = args.map((arg) => numericList([arg], 'SUMPRODUCT'));
    const length = Math.min(...lists.map((list) => list.length));
    let total = 0;
    for (let index = 0; index < length; index += 1) {
      total += lists.reduce((product, list) => product * list[index], 1);
    }
    return total;
  },
  COUNTIF: (args) => {
    const values = args[0] instanceof RangeRef ? [...args[0].values()] : [args[0]];
    const criteria = args[1];
    return values.filter((value) => value !== null && value !== undefined && matchCriteria(value, criteria)).length;
  },
  SUMIF: (args) => {
    const values = args[0] instanceof RangeRef ? [...args[0].values()] : [args[0]];
    const criteria = args[1];
    const sumRange = args[2] instanceof RangeRef ? [...args[2].values()] : values;
    let total = 0;
    for (const [index, value] of values.entries()) {
      if (value === null || value === undefined) continue;
      if (!matchCriteria(value, criteria)) continue;
      const addend = sumRange[index];
      if (typeof addend === 'number') total += addend;
      else if (typeof addend === 'string' && addend.trim() !== '' && Number.isFinite(Number(addend))) total += Number(addend);
    }
    return total;
  },
  AVERAGEIF: (args) => {
    const values = args[0] instanceof RangeRef ? [...args[0].values()] : [args[0]];
    const criteria = args[1];
    const averageRange = args[2] instanceof RangeRef ? [...args[2].values()] : values;
    const picked = [];
    for (const [index, value] of values.entries()) {
      if (value === null || value === undefined) continue;
      if (!matchCriteria(value, criteria)) continue;
      const entry = averageRange[index];
      if (typeof entry === 'number') picked.push(entry);
      else if (typeof entry === 'string' && entry.trim() !== '' && Number.isFinite(Number(entry))) picked.push(Number(entry));
    }
    if (picked.length === 0) throw formulaError('#DIV/0!', 'AVERAGEIF 没有匹配到任何数字。');
    return mean(picked);
  },
  AND: (args) => flatten(args).every((value) => {
    if (value === null || value === undefined || value === '') return true;
    return toBoolean(value, 'AND');
  }),
  OR: (args) => flatten(args).some((value) => {
    if (value === null || value === undefined || value === '') return false;
    return toBoolean(value, 'OR');
  }),
  NOT: (args) => !toBoolean(args[0], 'NOT'),
  TRUE: () => true,
  FALSE: () => false,
  CONCATENATE: (args) => flatten(args).map(toText).join(''),
  CONCAT: (args) => flatten(args).map(toText).join(''),
  LEN: (args) => toText(args[0]).length,
  LEFT: (args) => toText(args[0]).slice(0, Math.max(0, Math.trunc(toNumber(args[1] ?? 1, 'LEFT')))),
  RIGHT: (args) => {
    const count = Math.max(0, Math.trunc(toNumber(args[1] ?? 1, 'RIGHT')));
    const text = toText(args[0]);
    return count === 0 ? '' : text.slice(Math.max(0, text.length - count));
  },
  MID: (args) => {
    const text = toText(args[0]);
    const start = Math.trunc(toNumber(args[1], 'MID'));
    const count = Math.trunc(toNumber(args[2], 'MID'));
    if (start < 1) throw formulaError('#VALUE!', 'MID 的起始位置从 1 开始。');
    if (count < 0) throw formulaError('#VALUE!', 'MID 的长度不能是负数。');
    return text.slice(start - 1, start - 1 + count);
  },
  TRIM: (args) => toText(args[0]).trim().replace(/\s+/g, ' '),
  UPPER: (args) => toText(args[0]).toUpperCase(),
  LOWER: (args) => toText(args[0]).toLowerCase(),
  REPT: (args) => {
    const count = Math.max(0, Math.trunc(toNumber(args[1], 'REPT')));
    if (count > 10_000) throw formulaError('#NUM!', 'REPT 的重复次数过大。');
    return toText(args[0]).repeat(count);
  },
  SUBSTITUTE: (args) => {
    const text = toText(args[0]);
    const search = toText(args[1]);
    const replacement = toText(args[2]);
    if (search === '') return text;
    if (args.length > 3) {
      const occurrence = Math.trunc(toNumber(args[3], 'SUBSTITUTE'));
      if (!Number.isFinite(occurrence) || occurrence < 1) {
        throw formulaError('#VALUE!', `SUBSTITUTE 的第 4 参必须是 ≥1 的出现次数，实际是「${args[3]}」。`);
      }
      let count = 0;
      let index = 0;
      let output = '';
      while (index < text.length) {
        const found = text.indexOf(search, index);
        if (found < 0) break;
        count += 1;
        if (count === occurrence) {
          // 前 N-1 次命中的原文段必须先原样写回，否则前缀会被吃掉。
          return output + text.slice(index, found) + replacement + text.slice(found + search.length);
        }
        output += text.slice(index, found + search.length);
        index = found + search.length;
      }
      return text;
    }
    return text.split(search).join(replacement);
  },
  VALUE: (args) => {
    const text = toText(args[0]).trim().replace(/,/g, '').replace(/%$/, '');
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) throw formulaError('#VALUE!', `VALUE 看不懂「${args[0]}」。`);
    return String(args[0]).trim().endsWith('%') ? numeric / 100 : numeric;
  },
};

// IF / IFERROR 需要短路，单独处理。
const LAZY_FUNCTIONS = new Set(['IF', 'IFERROR']);

/**
 * 在一个已加载的工作簿模型上求值指定的单元格。
 * targets: [{ sheetIndex, row, column }]
 * 返回 { results: Map<'si:r:c', { ok, value, error, functions }>, functionsEvaluated, unsupportedFunctions, notices }
 */
export function evaluateWorkbookCells(model, targets, { maxOps = 200_000 } = {}) {
  const cache = new Map();
  const visiting = new Set();
  const functionsEvaluated = new Set();
  const unsupportedFunctions = new Set();
  const notices = [];
  let ops = 0;
  let rangeClamped = false;

  const sheetIndexByName = new Map();
  model.sheets.forEach((sheet, index) => {
    sheetIndexByName.set(sheet.name.toLowerCase(), index);
  });

  function resolveSheetIndex(name, fallback) {
    if (!name) return fallback;
    const found = sheetIndexByName.get(String(name).toLowerCase());
    if (found === undefined) throw formulaError('#REF!', `公式引用了不存在的工作表「${name}」。现有工作表：${model.sheets.map((sheet) => sheet.name).join('、')}。`);
    return found;
  }

  function resolveCell(sheetIndex, row, column) {
    const key = evalKey(sheetIndex, row, column);
    if (cache.has(key)) return cache.get(key);
    const formulaCell = model.sheets[sheetIndex]?.cells.get(cellKey(row, column));
    if (!formulaCell) return null;
    if (!formulaCell.formula) return formulaCell.value === '' ? null : formulaCell.value;

    if (visiting.has(key)) {
      throw formulaError('#CIRC!', `公式循环引用：${model.sheets[sheetIndex].name}!${addressOf(row, column)} 间接引用了自己。`);
    }
    ops += 1;
    if (ops > maxOps) throw formulaError('#OPS!', `公式求值超过 ${maxOps} 步，已停止（可能存在超大区域引用）。`);
    visiting.add(key);
    try {
      const value = evaluateNode(parseFormula(formulaCell.formula), sheetIndex);
      const finalValue = value instanceof RangeRef ? firstOf(value) : value;
      cache.set(key, finalValue);
      return finalValue;
    } finally {
      visiting.delete(key);
    }
  }

  function firstOf(range) {
    for (const value of range.values()) return value;
    return null;
  }

  function evaluateNode(node, sheetIndex) {
    switch (node.type) {
      case 'number': return node.value;
      case 'string': return node.value;
      case 'boolean': return node.value;
      case 'empty': return null;
      case 'cell': {
        const target = resolveSheetIndex(node.sheet, sheetIndex);
        return resolveCell(target, node.row, node.column);
      }
      case 'range': {
        const target = resolveSheetIndex(node.sheet, sheetIndex);
        if (node.endSheet && node.sheet && node.endSheet.toLowerCase() !== node.sheet.toLowerCase()) {
          throw formulaError('#REF!', '暂不支持跨工作表的三维区域引用（如 Sheet1!A1:Sheet2!B2）。');
        }
        // 整列/整行（A:C、3:7）会写成 100 万行的巨型区域。这里一律裁剪到工作表
        // 的真实使用范围：对 SUM/AVERAGE/COUNT 这类聚合结果等价，且避免把内存和
        // 步数打爆。COUNTBLANK 会因此少算区域外的空白格，这一条写进 notices。
        const bounds = model.sheets[target]?.usedBounds;
        if (!bounds) return new RangeRef(target, 1, 1, 0, 0, resolveCell);
        const top = Math.max(node.top, bounds.top);
        const left = Math.max(node.left, bounds.left);
        const bottom = Math.min(node.bottom, bounds.bottom);
        const right = Math.min(node.right, bounds.right);
        if (top !== node.top || left !== node.left || bottom !== node.bottom || right !== node.right) rangeClamped = true;
        if (bottom < top || right < left) return new RangeRef(target, 1, 1, 0, 0, resolveCell);
        return new RangeRef(target, top, left, bottom, right, resolveCell);
      }
      case 'name':
        throw formulaError('#NAME?', `不认识的名称「${node.name}」：内置引擎不支持命名区域，请改用 A1:C10 这样的区域写法。`);
      case 'unary': {
        const value = evaluateNode(node.operand, sheetIndex);
        const scalar = value instanceof RangeRef ? firstOf(value) : value;
        if (node.op === '-') return -toNumber(scalar, '负号');
        if (node.op === '%') return toNumber(scalar, '百分号') / 100;
        return toNumber(scalar, '正号');
      }
      case 'binary': return evaluateBinary(node, sheetIndex);
      case 'call': return evaluateCall(node, sheetIndex);
      default: throw formulaError('#VALUE!', `不认识的语法节点：${node.type}`);
    }
  }

  function evaluateBinary(node, sheetIndex) {
    if (node.op === '&') {
      const left = evaluateNode(node.left, sheetIndex);
      const right = evaluateNode(node.right, sheetIndex);
      return toText(scalarize(left)) + toText(scalarize(right));
    }
    const left = scalarize(evaluateNode(node.left, sheetIndex));
    const right = scalarize(evaluateNode(node.right, sheetIndex));
    if (node.op === '=' || node.op === '<>' || node.op === '<' || node.op === '>' || node.op === '<=' || node.op === '>=') {
      const boolean = compare(node.op, left, right);
      return boolean;
    }
    const a = toNumber(left, `「${node.op}」的左边`);
    const b = toNumber(right, `「${node.op}」的右边`);
    let result;
    if (node.op === '+') result = a + b;
    else if (node.op === '-') result = a - b;
    else if (node.op === '*') result = a * b;
    else if (node.op === '/') {
      if (b === 0) throw formulaError('#DIV/0!', '分母是 0。');
      result = a / b;
    } else if (node.op === '^') result = a ** b;
    else throw formulaError('#VALUE!', `不支持的运算符「${node.op}」。`);
    if (!Number.isFinite(result)) throw formulaError('#NUM!', `运算结果不是有限数字（${node.op}）。`);
    return result;
  }

  function scalarize(value) {
    if (value instanceof RangeRef) {
      throw formulaError('#VALUE!', '区域（如 A1:B2）不能直接参与算术或比较，必须放在函数参数里（如 SUM(A1:B2)）。');
    }
    return value;
  }

  function compare(op, left, right) {
    const leftNumber = typeof left === 'number';
    const rightNumber = typeof right === 'number';
    const leftBlank = left === null || left === undefined || left === '';
    const rightBlank = right === null || right === undefined || right === '';
    if ((leftNumber || leftBlank) && (rightNumber || rightBlank)) {
      const a = leftBlank ? 0 : left;
      const b = rightBlank ? 0 : right;
      if (op === '=') return a === b;
      if (op === '<>') return a !== b;
      if (op === '<') return a < b;
      if (op === '>') return a > b;
      if (op === '<=') return a <= b;
      return a >= b;
    }
    const a = toText(left).toLowerCase();
    const b = toText(right).toLowerCase();
    if (op === '=') return a === b;
    if (op === '<>') return a !== b;
    if (op === '<') return a < b;
    if (op === '>') return a > b;
    if (op === '<=') return a <= b;
    return a >= b;
  }

  function evaluateCall(node, sheetIndex) {
    const upper = node.name.toUpperCase();
    if (LAZY_FUNCTIONS.has(upper)) {
      if (upper === 'IF') {
        const condition = toBoolean(scalarizeLoose(evaluateNode(node.args[0], sheetIndex)), 'IF 的条件');
        if (condition) return node.args.length > 1 ? evaluateNode(node.args[1], sheetIndex) : true;
        return node.args.length > 2 ? evaluateNode(node.args[2], sheetIndex) : false;
      }
      try {
        return evaluateNode(node.args[0], sheetIndex);
      } catch (error) {
        if (error instanceof FormulaError && ERROR_CODES.has(error.code)) {
          return node.args.length > 1 ? evaluateNode(node.args[1], sheetIndex) : error.code;
        }
        throw error;
      }
    }

    if (!SUPPORTED.has(upper)) {
      unsupportedFunctions.add(upper);
      if (KNOWN_UNSUPPORTED.has(upper)) {
        throw formulaError('#NAME?', `内置引擎没有实现函数 ${upper}（这是已知但未实现的 Excel 函数）。`);
      }
      throw formulaError('#NAME?', `内置引擎不认识函数 ${upper}。`);
    }
    functionsEvaluated.add(upper);
    const args = node.args.map((arg) => (arg.type === 'empty' ? null : evaluateNode(arg, sheetIndex)));
    const implementation = FUNCTIONS[upper];
    const value = implementation(args);
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw formulaError('#NUM!', `${upper} 的结果不是有限数字。`);
    }
    return value;
  }

  function scalarizeLoose(value) {
    if (value instanceof RangeRef) return firstOf(value);
    return value;
  }

  const results = new Map();
  for (const target of targets) {
    const key = evalKey(target.sheetIndex, target.row, target.column);
    try {
      const value = resolveCell(target.sheetIndex, target.row, target.column);
      results.set(key, { ok: true, value: value === undefined ? null : value, error: null });
    } catch (error) {
      if (error instanceof FormulaError) {
        results.set(key, { ok: false, value: null, error: error.code, message: error.message });
      } else {
        results.set(key, { ok: false, value: null, error: '#VALUE!', message: error?.message ?? String(error) });
      }
    }
  }

  if (unsupportedFunctions.size > 0) {
    notices.push(
      `内置引擎没有实现这些函数：${[...unsupportedFunctions].join('、')}；涉及它们的单元格没有算出结果（标记为 #NAME?），`
      + '没有用近似值代替。若本机装了 LibreOffice，本插件会改用它真算；否则请用 Excel/LibreOffice 打开该文件后另行确认。',
    );
  }
  if (rangeClamped) {
    notices.push(
      '有区域引用超出了工作表的真实使用范围，已裁剪到使用范围后求值。'
      + '对 SUM/AVERAGE/COUNT/MIN/MAX 这类聚合结果等价（区域外的空格本来就不贡献），'
      + '但 COUNTBLANK 会因此少算区域外的空白格。',
    );
  }
  return { results, functionsEvaluated, unsupportedFunctions, notices };
}

/** 判断公式文本是不是"一个公式"（以 = 开头）。 */
export function isFormulaText(text) {
  return typeof text === 'string' && /^\s*=/.test(text);
}
