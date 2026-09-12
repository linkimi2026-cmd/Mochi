// mochi-sheets · A1 地址与区域的解析/格式化（纯函数，无 IO）。
export const MAX_COLUMN_INDEX = 16_384; // XFD
export const MAX_ROW_INDEX = 1_048_576;

export class AddressError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AddressError';
  }
}

const COLUMN_PATTERN = /^\$?([A-Za-z]{1,3})$/;
const CELL_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

/** 1 -> A，27 -> AA。 */
export function columnName(index) {
  if (!Number.isInteger(index) || index < 1 || index > MAX_COLUMN_INDEX) {
    throw new AddressError(`列序号必须是 1..${MAX_COLUMN_INDEX} 的整数（收到：${index}）。`);
  }
  let name = '';
  for (let number = index; number > 0; number = Math.floor((number - 1) / 26)) {
    name = String.fromCharCode(65 + ((number - 1) % 26)) + name;
  }
  return name;
}

/** A -> 1，AA -> 27。 */
export function columnIndex(letters) {
  const match = COLUMN_PATTERN.exec(String(letters ?? '').trim());
  if (!match) throw new AddressError(`列名必须是 1-3 个字母（收到：${letters}）。`);
  const name = match[1].toUpperCase();
  const index = [...name].reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0);
  if (index > MAX_COLUMN_INDEX) throw new AddressError(`列名 ${name} 超出行数上限 XFD。`);
  return index;
}

/** (row, column) -> 'B3'。 */
export function addressOf(row, column) {
  return `${columnName(column)}${row}`;
}

/**
 * 工作簿模型里单元格的键。整个插件只用这一种写法（`行:列`），
 * 避免出现两套键导致"公式读不到值"这种最危险的静默错误。
 */
export function cellKey(row, column) {
  return `${row}:${column}`;
}

/** 求值缓存用的全局键（把工作表序号也算进去）。 */
export function evalKey(sheetIndex, row, column) {
  return `${sheetIndex}:${row}:${column}`;
}

/** 'B3' -> { row: 3, column: 2, address: 'B3' }。 */
export function parseCell(input) {
  const text = String(input ?? '').trim();
  const match = CELL_PATTERN.exec(text);
  if (!match) {
    throw new AddressError(`单元格地址不合法：「${text}」。请用 A1 这种写法（如 B3），不要用 R1C1 或整列写法。`);
  }
  const column = columnIndex(match[1]);
  const row = Number(match[2]);
  if (row < 1 || row > MAX_ROW_INDEX) {
    throw new AddressError(`行号必须是 1..${MAX_ROW_INDEX}（收到：${row}）。`);
  }
  return { row, column, address: addressOf(row, column) };
}

/** 'Sheet1' 前缀剥离：'Sheet1!A1' -> { sheet: 'Sheet1', rest: 'A1' }；无前缀时 sheet 为 null。 */
export function splitSheetPrefix(input) {
  const text = String(input ?? '').trim();
  const bang = text.lastIndexOf('!');
  if (bang < 0) return { sheet: null, rest: text };
  let sheet = text.slice(0, bang);
  if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
  return { sheet, rest: text.slice(bang + 1) };
}

function expandColumnRange(start, end) {
  const from = columnIndex(start);
  const to = columnIndex(end);
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

function expandRowRange(start, end) {
  const from = Number(start);
  const to = Number(end);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
    throw new AddressError(`行范围不合法：${start}:${end}。`);
  }
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/**
 * 解析区域文本，支持：`A1`、`A1:C10`、`A:C`、`3:7`、`Sheet1!A1:C10`。
 * 返回 { sheet, top, left, bottom, right, address }；不合法抛 AddressError。
 */
export function parseRange(input) {
  const { sheet, rest } = splitSheetPrefix(input);
  const text = rest.trim();
  if (!text) throw new AddressError(`区域不能为空（收到：${input}）。`);

  if (text.includes(':')) {
    const [rawStart, rawEnd] = text.split(':');
    const start = rawStart.trim();
    const end = rawEnd.trim();
    if (!start || !end) throw new AddressError(`区域「${text}」的冒号两侧必须都有内容（如 A1:C10）。`);
    const bothCells = CELL_PATTERN.test(start) && CELL_PATTERN.test(end);
    const bothColumns = COLUMN_PATTERN.test(start) && COLUMN_PATTERN.test(end);
    const bothRows = /^\$?\d{1,7}$/.test(start) && /^\$?\d{1,7}$/.test(end);
    if (bothCells) {
      const a = parseCell(start);
      const b = parseCell(end);
      const top = Math.min(a.row, b.row);
      const bottom = Math.max(a.row, b.row);
      const left = Math.min(a.column, b.column);
      const right = Math.max(a.column, b.column);
      return { sheet, top, left, bottom, right, address: `${addressOf(top, left)}:${addressOf(bottom, right)}` };
    }
    if (bothColumns) {
      const { from, to } = expandColumnRange(start, end);
      return { sheet, top: 1, left: from, bottom: MAX_ROW_INDEX, right: to, address: `${columnName(from)}:${columnName(to)}` };
    }
    if (bothRows) {
      const { from, to } = expandRowRange(start, end);
      return {
        sheet,
        top: from,
        left: 1,
        bottom: to,
        right: MAX_COLUMN_INDEX,
        address: `${from}:${to}`,
      };
    }
    throw new AddressError(`区域「${text}」不受支持。请用 A1:C10（单元格区域）、A:C（整列）或 3:7（整行）。`);
  }

  const cell = parseCell(text);
  return { sheet, top: cell.row, left: cell.column, bottom: cell.row, right: cell.column, address: cell.address };
}

/**
 * 把区域裁剪到工作表的真实使用范围（只裁下边界与右边界，不把用户写的起始位置往上挪），
 * 再套用行列上限。返回 { top, left, bottom, right, rangeAddress, original, truncated, isEmpty }。
 */
export function clampRange(requested, usedBounds, maxRows, maxColumns) {
  const top = Math.max(requested.top, 1);
  const left = Math.max(requested.left, 1);
  const bottomBound = usedBounds ? Math.min(requested.bottom, usedBounds.bottom) : requested.bottom;
  const rightBound = usedBounds ? Math.min(requested.right, usedBounds.right) : requested.right;
  const isEmpty = bottomBound < top || rightBound < left;
  const bottom = isEmpty ? top - 1 : bottomBound;
  const right = isEmpty ? left - 1 : rightBound;

  const totalRows = isEmpty ? 0 : bottom - top + 1;
  const totalColumns = isEmpty ? 0 : right - left + 1;
  const cappedBottom = isEmpty ? bottom : Math.min(bottom, top + maxRows - 1);
  const cappedRight = isEmpty ? right : Math.min(right, left + maxColumns - 1);

  const truncatedRows = totalRows > maxRows ? { included: maxRows, total: totalRows } : null;
  const truncatedColumns = totalColumns > maxColumns ? { included: maxColumns, total: totalColumns } : null;

  return {
    top,
    left,
    bottom: cappedBottom,
    right: cappedRight,
    isEmpty,
    rangeAddress: isEmpty ? null : `${addressOf(top, left)}:${addressOf(cappedBottom, cappedRight)}`,
    original: {
      top: requested.top,
      left: requested.left,
      bottom,
      right,
      rangeAddress: isEmpty ? null : `${addressOf(top, left)}:${addressOf(bottom, right)}`,
      rows: totalRows,
      columns: totalColumns,
    },
    truncated: {
      rows: truncatedRows,
      columns: truncatedColumns,
      isTruncated: Boolean(truncatedRows || truncatedColumns),
    },
  };
}
