// mochi-sheets · 外部真算引擎适配器（LibreOffice）。
//
// 为什么需要它：ExcelJS 不计算公式。我们自己写的引擎只能覆盖一部分函数，
// 所以当本机装了 LibreOffice（soffice）时，这里做一次**真算**：
//   1. 把源工作簿复制一份，把所有公式单元格的"缓存结果"清掉；
//   2. 让 soffice 以 headless 方式把这个副本另外换算成 xlsx；
//   3. LibreOffice 在装载时发现公式没有缓存值，就会真的算一遍并写回结果；
//   4. 我们把结果读回来，作为交付文件里公式单元格的缓存值。
// 已验证：清掉缓存后 SUM/AVERAGE/IF 等都会被真算出来（不是把缓存原样抄回来）。
//
// 找不到 soffice、或调用失败时：**不谎称真算过**，返回 { available:false, reason }，
// 由调用方把"只有内置引擎复算"这件事如实写进结果。
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs';

const execFileAsync = promisify(execFile);

const SOFFICE_CANDIDATES = [
  process.env.MOCHI_SOFFICE,
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice',
  '/usr/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter((entry) => typeof entry === 'string' && entry.length > 0);

let cachedSoffice;

/** 找 soffice（结果缓存，避免每次调用都探测）。找不到返回 null。 */
export async function findSoffice() {
  if (cachedSoffice !== undefined) return cachedSoffice;
  for (const candidate of SOFFICE_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      cachedSoffice = candidate;
      return candidate;
    } catch { /* 试下一个候选。 */ }
  }
  cachedSoffice = null;
  return null;
}

function cellSnapshot(worksheet) {
  const formulas = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const formula = typeof cell.formula === 'string' && cell.formula ? cell.formula : null;
      if (formula) formulas.push({ address: cell.address, formula });
    });
  });
  return formulas;
}

function scalarOf(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
    if (value.result !== undefined && value.result !== null) return scalarOf(value.result);
    if (typeof value.error === 'string') return value.error;
    if (typeof value.text === 'string') return value.text;
    return null;
  }
  return value;
}

/**
 * 用 LibreOffice 真算一遍。
 * formulas: 额外写进探测副本的公式 [{ sheetName, address, formula }]（本插件新写入的那些）。
 * 返回：
 *   { available: false, reason }                        —— 没有可用外部引擎，调用方必须如实说明
 *   { available: true, sofficePath, computed: Map<'工作表名!A1', value>, formulaCellCount, durationMs }
 * computed 只包含"公式单元格"的真算值（键是 工作表名!地址）。
 */
export async function recalculateWithLibreOffice(sourcePath, { formulas = [], timeoutMs = 180_000 } = {}) {
  const sofficePath = await findSoffice();
  if (!sofficePath) {
    return {
      available: false,
      reason: '本机没有找到 LibreOffice（soffice），未做外部引擎真算；结果只有 Mochi 内置引擎的复算值。',
    };
  }

  const started = Date.now();
  let workRoot = null;
  try {
    workRoot = await mkdtemp(join(tmpdir(), 'mochi-sheets-recalc-'));
    const profileDir = join(workRoot, 'profile');
    const outDir = join(workRoot, 'out');
    const probePath = join(workRoot, 'probe.xlsx');

    const sourceBytes = await readFile(sourcePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(sourceBytes);

    // 先把本次要写的公式放进去（仍不带缓存结果）。
    const appliedCells = [];
    for (const item of formulas) {
      const worksheet = workbook.getWorksheet(item.sheetName);
      if (!worksheet) continue;
      worksheet.getCell(item.address).value = { formula: String(item.formula).replace(/^=/, '') };
      appliedCells.push(`${item.sheetName}!${item.address}`);
    }

    // 再把所有公式单元格的缓存结果清掉：让 LibreOffice 必须自己算。
    let formulaCellCount = 0;
    for (const worksheet of workbook.worksheets) {
      const snapshot = cellSnapshot(worksheet);
      formulaCellCount += snapshot.length;
      for (const item of snapshot) {
        worksheet.getCell(item.address).value = { formula: item.formula };
      }
    }
    if (formulaCellCount === 0 && appliedCells.length === 0) {
      return { available: true, sofficePath, computed: new Map(), formulaCellCount: 0, durationMs: Date.now() - started };
    }

    await writeFile(probePath, Buffer.from(await workbook.xlsx.writeBuffer()), { mode: 0o600 });

    await execFileAsync(
      sofficePath,
      [
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--headless',
        '--norestore',
        '--nodefault',
        '--nologo',
        '--convert-to',
        'xlsx',
        '--outdir',
        outDir,
        probePath,
      ],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, killSignal: 'SIGKILL' },
    );

    const convertedPath = join(outDir, 'probe.xlsx');
    const converted = new ExcelJS.Workbook();
    await converted.xlsx.load(await readFile(convertedPath));

    const computed = new Map();
    for (const worksheet of converted.worksheets) {
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const formula = typeof cell.formula === 'string' && cell.formula ? cell.formula : null;
          if (!formula) return;
          computed.set(`${worksheet.name}!${cell.address}`, scalarOf(cell.value));
        });
      });
    }
    return { available: true, sofficePath, computed, formulaCellCount, durationMs: Date.now() - started };
  } catch (error) {
    return {
      available: false,
      reason: `调用 LibreOffice 真算失败：${error?.message ?? error}。结果只有 Mochi 内置引擎的复算值，未做外部引擎核对。`,
      sofficePath,
    };
  } finally {
    if (workRoot) await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}
