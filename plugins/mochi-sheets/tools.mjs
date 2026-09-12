// mochi-sheets · 四个工具的处理器（纯逻辑，可单测；不依赖 cordis）。
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import ExcelJS from 'exceljs';

import { addressOf, cellKey, evalKey, parseCell } from './address.mjs';
import { BUILTIN_SUPPORTED_FUNCTIONS, KNOWN_UNSUPPORTED_FUNCTIONS, evaluateWorkbookCells, isFormulaText } from './formula.mjs';
import { assertNotExists, ensureParentDirectory, existingAttachmentReadRoots, fail, resolveAllowedRoots, resolveInside } from './paths.mjs';
import { recalculateWithLibreOffice } from './recalc.mjs';
import {
  describeSheets,
  loadWorkbookModel,
  pickSheet,
  readRange,
  DEFAULT_MAX_COLUMNS,
  DEFAULT_MAX_ROWS,
  HARD_MAX_COLUMNS,
  HARD_MAX_ROWS,
} from './sheet-read.mjs';
import {
  SUPPORTED_TARGET_FORMATS,
  UNSUPPORTED_TARGET_FORMATS,
  assertSupportedTargetFormat,
  sheetNamesFromOoxml,
  sheetValueMatrix,
  sha256Hex,
  toCsvText,
  verifyXlsx,
  writeXlsx,
} from './sheet-write.mjs';

// Excel 自己的错误码（#CIRC! / #OPS! 是本插件内置引擎的内部码，永远不会写进文件）。
const EXCEL_ERROR_CODES = new Set(['#DIV/0!', '#VALUE!', '#NAME?', '#REF!', '#NUM!', '#N/A', '#NULL!']);

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(args, field, label) {
  const value = textOrNull(args?.[field]);
  if (!value) throw fail('ARGUMENT_REQUIRED', `「${label}」不能为空；请给出明确的值。`);
  return value;
}

/** 每次调用都按当前会话解析允许根（会话可能变），默认根是工作区，不含主目录与磁盘根。 */
async function allowedRootsFor(options, ctx, exec) {
  const session = exec?.agent?.session ?? null;
  const { roots, rejected } = await resolveAllowedRoots({
    options,
    env: process.env,
    ctx: { sandboxPolicy: ctx?.sandboxPolicy, session },
  });
  let policy = null;
  if (ctx?.sandboxPolicy && typeof ctx.sandboxPolicy.resolve === 'function') {
    try {
      policy = ctx.sandboxPolicy.resolve({ session });
    } catch { /* 策略不可用时不做只读判断，路径根校验仍然生效。 */ }
  }
  // 老师上传的表格落在宿主附件盘（只读硬链接副本），不在会话工作区里。
  // 作为**只读**根接进来，resolveInside 只在 mustExist（读既有文件）时采用它。
  const readOnlyRoots = await existingAttachmentReadRoots();
  return { roots, readOnlyRoots, rejected, session, policy };
}

/** 只读会话不允许写盘（与 mochi-documents / mochi-files 的既有口径一致）。 */
function assertWritable(policy, action) {
  if (policy?.mode === 'read-only') {
    throw fail(
      'SANDBOX_READ_ONLY',
      `当前会话是只读模式，不能${action}。请按宿主审批流程切换到可写工作区后重试；本次没有写出任何文件。`,
    );
  }
}

function isErrorCode(value) {
  return typeof value === 'string' && EXCEL_ERROR_CODES.has(value);
}

/**
 * 两个引擎的结果是否一致。数字按相对误差 1e-9 比（85.16666666666667 与 85.1666666666667
 * 是同一个 double，只是字符串化位数不同，不能判成不一致）；其余按字符串比。
 */
function valuesAgree(left, right) {
  if (typeof left === 'number' && typeof right === 'number') {
    if (Number.isNaN(left) && Number.isNaN(right)) return true;
    const scale = Math.max(1, Math.abs(left), Math.abs(right));
    return Math.abs(left - right) <= 1e-9 * scale;
  }
  return String(left) === String(right);
}

/** 把算出来的结果包成 ExcelJS 能写进单元格缓存的形式。 */
function toCachedResult(value) {
  if (value === null || value === undefined) return undefined;
  if (isErrorCode(value)) return { error: value };
  return value;
}

export function createSheetsHandlers({ logger, options = {} } = {}) {
  const log = (message) => logger?.info?.(message);

  // ── spreadsheet_read ─────────────────────────────────────────────────────
  async function read(ctx, args, exec) {
    const { roots, readOnlyRoots, rejected } = await allowedRootsFor(options, ctx, exec);
    const target = await resolveInside({
      roots,
      readOnlyRoots,
      candidate: requireText(args, 'path', '要读取的表格文件路径'),
      label: '要读取的表格文件',
      mustExist: true,
    });
    const model = await loadWorkbookModel(target.path, { signal: exec?.signal });
    const sheet = pickSheet(model, args?.sheet);
    const detail = readRange(model, sheet, textOrNull(args?.range), {
      maxRows: args?.maxRows ?? DEFAULT_MAX_ROWS,
      maxColumns: args?.maxColumns ?? DEFAULT_MAX_COLUMNS,
      includeFormulas: args?.includeFormulas !== false,
    });

    const notes = [...detail.notices];
    if (rejected.length > 0) {
      notes.push(`以下候选根被忽略：${rejected.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    }
    const width = detail.returnedColumns;
    const rows = detail.rows.map((row) => ({
      行号: row.row,
      单元格: row.cells.map((cell) => {
        if (cell.formula) {
          return {
            地址: cell.address,
            公式: cell.formula,
            缓存结果: cell.cachedResult,
            ...(cell.formulaNote ? { 备注: cell.formulaNote } : {}),
            ...(cell.sourceLine !== undefined ? { 源文件行号: cell.sourceLine } : {}),
          };
        }
        const entry = { 地址: cell.address, 值: cell.value, 类型: cell.type };
        if (cell.sourceLine !== undefined) entry.源文件行号 = cell.sourceLine;
        return entry;
      }),
    }));

    return {
      工具: 'spreadsheet_read',
      状态: '已读取',
      路径: target.path,
      格式: model.format,
      文件字节数: model.bytes.length,
      工作表清单: describeSheets(model),
      选中工作表: detail.sheetName,
      区域: {
        请求: detail.requestedRange,
        实际返回: detail.rangeAddress,
        原始行列数: { 行: detail.totalRows, 列: detail.totalColumns },
        返回行列数: { 行: detail.returnedRows, 列: width },
      },
      上限: {
        行: detail.limits.maxRows,
        列: detail.limits.maxColumns,
        行硬上限: HARD_MAX_ROWS,
        列硬上限: HARD_MAX_COLUMNS,
        说明: '超出上限的部分不会返回；是否被截断见「截断」。',
      },
      截断: {
        是否截断: detail.truncated.isTruncated,
        行: detail.truncated.rows,
        列: detail.truncated.columns,
      },
      行: rows,
      提示: notes,
      说明: '值直接来自文件本身：.xlsx 用 ExcelJS 解析，.csv 用手写解析器；公式返回公式文本与文件的缓存结果，'
        + '本工具不会替公式重算（要重算请用 spreadsheet_formula）。',
    };
  }

  // ── spreadsheet_create ───────────────────────────────────────────────────
  async function create(ctx, args, exec) {
    const { roots, policy } = await allowedRootsFor(options, ctx, exec);
    assertWritable(policy, '生成表格文件');
    const target = await resolveInside({
      roots,
      candidate: requireText(args, 'outputPath', '输出文件路径'),
      label: '输出文件路径',
      mustExist: false,
    });
    if (!target.path.toLowerCase().endsWith('.xlsx')) {
      throw fail(
        'OUTPUT_MUST_BE_XLSX',
        `新表格的输出路径必须以 .xlsx 结尾（收到：${target.path}）。本工具只产出真的 .xlsx；`
        + '要 CSV 请先用 spreadsheet_create 生成 .xlsx，再用 spreadsheet_export 导出 csv。',
      );
    }
    await ensureParentDirectory(target.path);
    await assertNotExists(target.path, '输出文件路径');

    const result = await writeXlsx({ spec: args, outputPath: target.path });
    log(`[mochi-sheets] 生成 ${result.path}（${result.byteLength} 字节，${result.sheetNames.join('、')}）`);
    return {
      工具: 'spreadsheet_create',
      状态: '已生成并回读校验通过',
      路径: result.path,
      字节数: result.byteLength,
      校验和sha256: result.sha256,
      工作表: result.sheetNames,
      ZIP成员数: result.zipMemberCount,
      逐格回读校验: {
        比对单元格数: result.checkedCellCount,
        说明: '写完后重新打开该文件，逐格比对写入值与回读值，全部一致才算通过；同时解包读 xl/workbook.xml 确认工作表名。',
      },
      工作表规模: result.verificationPlan.map((sheet) => ({
        工作表: sheet.name,
        数据行: sheet.declaredRows,
        列: sheet.declaredColumns,
      })),
      说明: '这是真的 .xlsx（ZIP + OOXML），不是改名的 CSV，也不是 HTML 冒充。文件不会被覆盖，路径必须落在允许根内。',
    };
  }

  // ── spreadsheet_export ───────────────────────────────────────────────────
  async function exportSheet(ctx, args, exec) {
    const { roots, readOnlyRoots, policy } = await allowedRootsFor(options, ctx, exec);
    assertWritable(policy, '导出文件');
    const targetFormat = assertSupportedTargetFormat(args?.format);
    const source = await resolveInside({
      roots,
      readOnlyRoots,
      candidate: requireText(args, 'sourcePath', '要导出的源文件路径'),
      label: '要导出的源文件',
      mustExist: true,
    });
    const output = await resolveInside({
      roots,
      candidate: requireText(args, 'outputPath', '导出目标路径'),
      label: '导出目标路径',
      mustExist: false,
    });
    if (extname(output.path).toLowerCase() !== `.${targetFormat}`) {
      throw fail(
        'OUTPUT_EXTENSION_MISMATCH',
        `导出目标文件名后缀与 format「${targetFormat}」不一致：${output.path}。请把文件名改成 .${targetFormat} 结尾。`,
      );
    }
    await ensureParentDirectory(output.path);
    await assertNotExists(output.path, '导出目标路径');

    const sourceModel = await loadWorkbookModel(source.path, { signal: exec?.signal });
    const sourceBytes = sourceModel.bytes;
    const notes = [];

    if (targetFormat === 'xlsx') {
      if (sourceModel.format === 'xlsx') {
        // .xlsx 另存：原样复制字节，再回读校验目标确实是同一个工作簿。
        await writeFileExclusive(output.path, sourceBytes);
        const names = sheetNamesFromOoxml(sourceBytes).names;
        const verification = await verifyXlsx(output.path, names.map((name) => ({ name, cells: [] })));
        return {
          工具: 'spreadsheet_export',
          状态: '已另存并回读校验通过',
          源文件: source.path,
          目标格式: 'xlsx',
          目标文件: output.path,
          字节数: verification.byteLength,
          校验和sha256: verification.sha256,
          工作表: verification.sheetNames,
          支持的目标格式: SUPPORTED_TARGET_FORMATS.map((entry) => `.${entry}`),
          不支持的格式: UNSUPPORTED_TARGET_FORMATS,
          丢失的内容: '无：.xlsx 另存是逐字节复制，公式、样式、列宽、批注都保留。',
          说明: '源文件未被修改；目标文件不存在才能写出，绝不覆盖。',
        };
      }
      // .csv -> .xlsx：用真 CSV 解析结果建一个真的 .xlsx。
      const matrix = sheetValueMatrix(sourceModel.sheets[0], { maxRows: HARD_MAX_ROWS, maxColumns: HARD_MAX_COLUMNS });
      const header = matrix.matrix.length > 0 ? matrix.matrix[0] : [];
      const body = matrix.matrix.slice(1);
      const sheetName = textOrNull(args?.sheet) ?? sanitizeSheetName(basename(source.path, extname(source.path)));
      const spec = {
        sheets: [{
          name: sheetName,
          columns: (header.length > 0 ? header : ['A']).map((title, index) => ({
            header: title === '' ? addressOf(1, index + 1) : String(title),
            width: 16,
          })),
          rows: body,
          freezeHeaderRow: true,
        }],
      };
      const result = await writeXlsx({ spec, outputPath: output.path });
      notes.push(...matrix.notices);
      return {
        工具: 'spreadsheet_export',
        状态: '已生成并回读校验通过',
        源文件: source.path,
        目标格式: 'xlsx',
        目标文件: result.path,
        字节数: result.byteLength,
        校验和sha256: result.sha256,
        工作表: result.sheetNames,
        逐格回读校验: { 比对单元格数: result.checkedCellCount },
        支持的目标格式: SUPPORTED_TARGET_FORMATS.map((entry) => `.${entry}`),
        不支持的格式: UNSUPPORTED_TARGET_FORMATS,
        丢失的内容: 'CSV 里本来就没有样式、列宽、公式与多工作表；这里按第一行当表头建成单张工作表。',
        提示: notes,
      };
    }

    // 目标 csv
    const sheet = pickSheet(sourceModel, args?.sheet);
    if (!textOrNull(args?.sheet) && sourceModel.sheets.length > 1) {
      throw fail(
        'SHEET_REQUIRED_FOR_CSV',
        `源文件有 ${sourceModel.sheets.length} 张工作表（${sourceModel.sheets.map((entry) => entry.name).join('、')}），`
        + '而 CSV 一个文件只能装一张表。请用 sheet 指定要导出哪一张（不会把多张表塞进一个 CSV 假装完整）。',
      );
    }
    const matrix = sheetValueMatrix(sheet, { maxRows: HARD_MAX_ROWS, maxColumns: HARD_MAX_COLUMNS });
    const text = toCsvText(matrix.matrix);
    await writeFileExclusive(output.path, Buffer.from(text, 'utf8'));
    const written = await readBackFile(output.path);
    notes.push(...matrix.notices);
    return {
      工具: 'spreadsheet_export',
      状态: '已导出',
      源文件: source.path,
      目标格式: 'csv',
      目标文件: output.path,
      字节数: written.length,
      校验和sha256: sha256Hex(written),
      导出的工作表: sheet.name,
      导出行列数: { 行: matrix.matrix.length, 列: matrix.matrix.length > 0 ? matrix.matrix[0].length : 0 },
      编码: 'UTF-8（无 BOM；换行 LF）',
      支持的目标格式: SUPPORTED_TARGET_FORMATS.map((entry) => `.${entry}`),
      不支持的格式: UNSUPPORTED_TARGET_FORMATS,
      丢失的内容: 'CSV 是纯文本，公式会变成它的缓存值（没有缓存结果的公式留空），样式、列宽、多工作表、批注全部丢失。',
      提示: notes,
    };
  }

  // ── spreadsheet_formula ──────────────────────────────────────────────────
  async function formula(ctx, args, exec) {
    const { roots, readOnlyRoots, policy } = await allowedRootsFor(options, ctx, exec);
    assertWritable(policy, '写入公式');
    const source = await resolveInside({
      roots,
      readOnlyRoots,
      candidate: requireText(args, 'path', '要写入公式的 .xlsx 路径'),
      label: '要写入公式的 .xlsx',
      mustExist: true,
    });
    if (!source.path.toLowerCase().endsWith('.xlsx')) {
      throw fail(
        'FORMULA_REQUIRES_XLSX',
        `公式只能写进 .xlsx，收到的是「${source.path}」。CSV 是纯文本，装不了公式；`
        + '请先用 spreadsheet_export 或 spreadsheet_create 得到 .xlsx 再调用。',
      );
    }

    const requested = normalizeFormulaRequests(args?.formulas, source.path, args?.outputPath);
    const output = await resolveInside({
      roots,
      candidate: requested.outputCandidate,
      label: '公式输出文件路径',
      mustExist: false,
    });
    const outputPath = output.path;
    if (!outputPath.toLowerCase().endsWith('.xlsx')) {
      throw fail('OUTPUT_MUST_BE_XLSX', `公式输出文件必须以 .xlsx 结尾（收到：${outputPath}）。`);
    }
    await ensureParentDirectory(outputPath);
    await assertNotExists(outputPath, '公式输出文件路径');

    const model = await loadWorkbookModel(source.path, { signal: exec?.signal });
    const sheetNames = model.sheets.map((sheet) => sheet.name);
    const targets = requested.items.map((item) => {
      const sheet = pickSheet(model, item.sheetName ?? args?.sheet);
      return { ...item, sheet, sheetIndex: sheet.index };
    });

    // 1) 内置引擎：先把公式塞进内存模型（这样公式之间可以互相引用），再逐格求值。
    const replaced = [];
    for (const target of targets) {
      const key = cellKey(target.row, target.column);
      const existing = target.sheet.cells.get(key);
      if (existing) {
        if (existing.formula) replaced.push({ 地址: addressOf(target.row, target.column), 工作表: target.sheet.name, 原有: `=${existing.formula}` });
        else replaced.push({ 地址: addressOf(target.row, target.column), 工作表: target.sheet.name, 原有: existing.value });
      }
      target.sheet.cells.set(key, { raw: null, formula: target.formula, value: '', result: null, type: 'formula' });
      if (target.row > (target.sheet.usedBounds?.bottom ?? 0) || target.column > (target.sheet.usedBounds?.right ?? 0)) {
        const bounds = target.sheet.usedBounds ?? { top: target.row, left: target.column, bottom: target.row, right: target.column };
        target.sheet.usedBounds = {
          top: Math.min(bounds.top, target.row),
          left: Math.min(bounds.left, target.column),
          bottom: Math.max(bounds.bottom, target.row),
          right: Math.max(bounds.right, target.column),
        };
      }
    }
    const builtin = evaluateWorkbookCells(
      model,
      targets.map((target) => ({ sheetIndex: target.sheetIndex, row: target.row, column: target.column })),
    );

    // 2) 外部真算引擎（LibreOffice）：把同一批公式写进无缓存的探测副本，让它真算。
    const external = await recalculateWithLibreOffice(source.path, {
      formulas: targets.map((target) => ({ sheetName: target.sheet.name, address: addressOf(target.row, target.column), formula: target.formula })),
    });

    const perCell = targets.map((target) => {
      const address = addressOf(target.row, target.column);
      const key = evalKey(target.sheetIndex, target.row, target.column);
      const builtinResult = builtin.results.get(key);
      const externalKey = `${target.sheet.name}!${address}`;
      const externalValue = external.available && external.computed.has(externalKey) ? external.computed.get(externalKey) : undefined;
      let finalValue;
      let source_ = '未算出';
      if (externalValue !== undefined) {
        finalValue = externalValue;
        source_ = 'LibreOffice 真算';
      } else if (builtinResult?.ok) {
        finalValue = builtinResult.value;
        source_ = external.available ? 'Mochi 内置引擎（LibreOffice 未给出该格结果）' : 'Mochi 内置引擎复算';
      } else {
        finalValue = null;
        source_ = '未算出';
      }
      const agree = externalValue !== undefined && builtinResult?.ok
        ? valuesAgree(externalValue, builtinResult.value)
        : null;
      return {
        工作表: target.sheet.name,
        单元格: address,
        公式: `=${target.formula}`,
        内置引擎值: builtinResult?.ok ? builtinResult.value : null,
        内置引擎错误: builtinResult?.ok ? null : (builtinResult?.message ?? '未求值'),
        LibreOffice值: externalValue === undefined ? null : externalValue,
        最终缓存值: finalValue,
        取值来源: source_,
        两个引擎是否一致: agree,
        _final: finalValue,
      };
    });

    const notComputed = perCell.filter((cell) => cell.取值来源 === '未算出');
    const disagreements = perCell.filter((cell) => cell.两个引擎是否一致 === false);

    // 3) 写交付文件：源文件不改，输出是新文件——但**不是逐字节复制**，
    //    而是用 ExcelJS 重新序列化整簿（只改目标格）。图表/图片/透视表/VBA 这类
    //    ExcelJS 不认识的部件不会保留，必须在返回里如实说明，不能承诺"原样"。
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await readBackFile(source.path));
    for (const cell of perCell) {
      const worksheet = workbook.getWorksheet(cell.工作表);
      worksheet.getCell(cell.单元格).value = {
        formula: cell.公式.replace(/^=/, ''),
        ...(cell._final === null ? {} : { result: toCachedResult(cell._final) }),
      };
    }
    await writeFileExclusive(outputPath, Buffer.from(await workbook.xlsx.writeBuffer()));

    // 4) 回读校验：公式文本与缓存结果都必须在。
    const verification = await verifyXlsx(
      outputPath,
      sheetNames.map((name) => ({
        name,
        cells: perCell.filter((cell) => cell.工作表 === name).map((cell) => ({ address: cell.单元格, value: cell._final })),
      })),
    );
    const reread = await loadWorkbookModel(outputPath);
    const rereadChecks = perCell.map((cell) => {
      const sheet = pickSheet(reread, cell.工作表);
      const parsed = parseCell(cell.单元格);
      const hit = sheet.cells.get(cellKey(parsed.row, parsed.column));
      return {
        单元格: cell.单元格,
        回读公式: hit?.formula ? `=${hit.formula}` : null,
        回读缓存值: hit?.result ?? null,
        公式一致: hit?.formula === cell.公式.replace(/^=/, ''),
        缓存值一致: hit === undefined ? false : valuesAgree(hit.result, cell._final),
      };
    });
    const rereadFailed = rereadChecks.filter((check) => !check.公式一致 || !check.缓存值一致);

    const externalExplanation = external.available
      ? `已用本机 LibreOffice（${external.sofficePath}）对整簿做真算：先清掉所有公式的缓存结果，再让 soffice 换算一遍，`
        + '拿回来的就是真引擎算出来的值，并以此作为交付文件里的缓存值。'
      : `${external.reason} 交付文件里的缓存值是 Mochi 内置引擎算的，不是 Excel/LibreOffice 算的。`;

    return {
      工具: 'spreadsheet_formula',
      状态: rereadFailed.length === 0 && notComputed.length === 0 ? '已写入公式并算出结果（回读校验通过）' : '已写入公式，但有未算出的格或回读校验异常（见下）',
      源文件: source.path,
      输出文件: outputPath,
      输出字节数: verification.byteLength,
      校验和sha256: verification.sha256,
      写入了几个公式: perCell.length,
      计算结果: perCell.map(({ _final, ...rest }) => rest),
      计算引擎: {
        外部真算引擎: external.available ? `LibreOffice soffice（${external.sofficePath}）` : '没有：本机未找到可用的 soffice',
        外部真算覆盖: external.available
          ? `探测副本里有 ${external.formulaCellCount} 个公式单元格，LibreOffice 逐个真算并回写结果。`
          : '未执行',
        外部真算耗时毫秒: external.available ? external.durationMs : null,
        内置引擎: 'Mochi 内置公式引擎（自研递归下降解析 + 自实现函数子集）',
        内置引擎已实现函数: BUILTIN_SUPPORTED_FUNCTIONS,
        内置引擎已识别但未实现函数: KNOWN_UNSUPPORTED_FUNCTIONS,
        本次用到的函数: [...builtin.functionsEvaluated],
        本次未实现的函数: [...builtin.unsupportedFunctions],
        说明: externalExplanation,
      },
      未算出: notComputed.map((cell) => ({ 单元格: cell.单元格, 公式: cell.公式, 原因: cell.内置引擎错误 })),
      两引擎不一致: disagreements.map((cell) => ({ 单元格: cell.单元格, 公式: cell.公式, 内置引擎值: cell.内置引擎值, LibreOffice值: cell.LibreOffice值 })),
      被覆盖的原值: replaced,
      回读校验: {
        解包读workbook_xml成功: true,
        逐格比对: rereadChecks,
        不一致数: rereadFailed.length,
      },
      写入方式: '用 ExcelJS 重新序列化整簿后写出（只改目标格）：公式、样式、列宽、批注保留；'
        + 'ExcelJS 不认识的部件（图表、图片、透视表、VBA 宏）**不会保留**。要 100% 保真请改用 spreadsheet_export 的 xlsx→xlsx 另存（那条路是逐字节复制）。',
      说明: '交付文件是新的 .xlsx（源文件不改）。公式文本与缓存结果都回读过；'
        + '未算出的格只写公式、不写缓存值，不会用假结果冒充。',
    };
  }

  return { read, create, exportSheet, formula };
}

// ── 小工具 ──────────────────────────────────────────────────────────────────
async function writeFileExclusive(path, buffer) {
  try {
    await writeFile(path, buffer, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw fail('OUTPUT_EXISTS', `目标文件已存在，不会被覆盖：${path}。请换一个文件名再调用。`);
    throw fail('OUTPUT_WRITE_FAILED', `写文件失败：${path}（${error?.code ?? error}）。`);
  }
  return buffer.length;
}

async function readBackFile(path) {
  try {
    return await readFile(path);
  } catch (error) {
    throw fail('OUTPUT_READBACK_FAILED', `回读失败：读不到 ${path}（${error?.code ?? error}）。`);
  }
}

function sanitizeSheetName(name) {
  const cleaned = String(name).replace(/[[\]:*?/\\]/g, '_').trim().slice(0, 31);
  return cleaned || 'CSV';
}

/**
 * 归一 formulas 参数（数组形式：[{cell, formula, sheet?}]）。
 * 同时算出默认输出路径（源文件同目录的 <名字>-公式.xlsx）——它仍然要经过路径安全校验，
 * 所以这里只返回候选值，由调用方 resolveInside。
 */
function normalizeFormulaRequests(input, sourcePath, outputPathArg) {
  if (!Array.isArray(input)) {
    throw fail('FORMULAS_REQUIRED', 'formulas 必须是非空数组：[{cell:"B2",formula:"=SUM(B3:B10)"}, ...]。');
  }
  const items = [];
  for (const [index, entry] of input.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw fail('FORMULA_ENTRY_INVALID', `formulas 第 ${index + 1} 项必须是 {cell, formula} 对象。`);
    }
    const cellText = textOrNull(entry.cell);
    if (!cellText) throw fail('FORMULA_CELL_REQUIRED', `formulas 第 ${index + 1} 项缺少 cell（如 "B2"）。`);
    const formulaText = textOrNull(entry.formula);
    if (!formulaText) throw fail('FORMULA_TEXT_REQUIRED', `formulas 第 ${index + 1} 项（${cellText}）缺少 formula。`);
    if (!isFormulaText(formulaText)) {
      throw fail('FORMULA_TEXT_INVALID', `formulas 第 ${index + 1} 项（${cellText}）的 formula 必须以 = 开头（收到：${formulaText}）。`);
    }
    const parsed = parseCell(cellText);
    items.push({
      row: parsed.row,
      column: parsed.column,
      formula: formulaText.replace(/^\s*=/, ''),
      sheetName: textOrNull(entry.sheet),
    });
  }
  if (items.length === 0) throw fail('FORMULAS_EMPTY', 'formulas 不能是空数组：没有要写入的公式。');
  if (items.length > 200) throw fail('TOO_MANY_FORMULAS', `一次最多写 200 个公式（收到 ${items.length} 个）。请分批调用。`);
  const seen = new Set();
  for (const item of items) {
    const key = `${item.sheetName ?? ''}!${item.row}:${item.column}`;
    if (seen.has(key)) throw fail('FORMULA_DUPLICATE_CELL', `同一个单元格被写了两次公式：${item.sheetName ?? '默认工作表'}!${addressOf(item.row, item.column)}。请合并成一条。`);
    seen.add(key);
  }

  const outputCandidate = outputPathArg
    ? requireText({ outputPath: outputPathArg }, 'outputPath', '公式输出文件路径')
    : join(dirname(sourcePath), `${basename(sourcePath, extname(sourcePath))}-公式.xlsx`);
  return { items, outputCandidate };
}
