// Mochi 表格插件（cordis 风格 ESM）。
//
// 工具：spreadsheet_read / spreadsheet_create / spreadsheet_export / spreadsheet_formula
//   —— 只允许字母数字下划线连字符。带点的工具名会被模型网关 400 拒收整轮对话
//      （2026-09-12 真实事故），这里不冒险。
//
// 能力边界（不吹）：
//   * 产出的 .xlsx 都是真的 ZIP+OOXML，写完全部逐格回读校验；不拿 CSV 改名、不拿 HTML 冒充。
//   * spreadsheet_read 有行列上限，被截断会明说。
//   * spreadsheet_formula 的缓存值优先取 LibreOffice 真算结果；本机没有 soffice 时只有
//     Mochi 内置引擎的复算值，会如实说明，并且**未算出的格不写假结果**。
//   * spreadsheet_export 只支持 .xlsx / .csv，其它格式一律如实报不支持。
//   * 所有路径 resolve 后必须落在允许根内；缺省根是当前工作区，不含主目录与磁盘根。
import { defineTool } from '@deepseek-ai/dsh-tools';

import { SheetsError } from './paths.mjs';
import { createSheetsHandlers } from './tools.mjs';

export const name = 'mochi-sheets';
export const inject = ['tools'];
// ⚠️ render 签名是 (args, value)：第一个参数是调用参数，第二个才是工具返回值。
export const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

const SHARED_NOTES = '返回的路径是真实绝对路径，字节数与 sha256 都取自磁盘上的那个文件。';

function describeError(error) {
  if (error instanceof SheetsError) return `【表格操作失败】${error.message}`;
  return `【表格操作失败】${error?.message ?? String(error)}\n下一步：确认参数（路径、工作表名、区域写法）后重试。`;
}

export function apply(ctx, options = {}) {
  const handlers = createSheetsHandlers({ logger: ctx.logger, options });

  const register = (toolName, description, parameters, handler) => {
    ctx.tools.register(defineTool({
      name: toolName,
      description,
      parameters,
      output,
      execute: async (args, exec) => {
        try {
          return await handler(ctx, args ?? {}, exec);
        } catch (error) {
          throw new Error(describeError(error));
        }
      },
    }));
  };

  register(
    'spreadsheet_read',
    '读取本机的 .xlsx 或 .csv 表格：先给出工作表清单，再按区域返回单元格的值与公式文本（公式附带文件里的缓存结果）。'
    + 'range 支持 A1、A1:C10、A:C（整列）、3:7（整行），省略则读整张已用区域；sheet 省略则用第一张表。'
    + '有行列上限（默认 200 行 × 50 列，硬上限 5000 × 500），被截断时会在「截断」里明说，不会假装读全了。'
    + '只读不写。不支持 .xls/.ods/.numbers/.pdf；改名成 .xlsx 的 CSV 会被直接拒绝。'
    + '路径必须落在允许的工作区内；老师上传的附件（宿主句柄文本里那个只读副本路径）也可直接读，但写入永远只落在工作区。',
    {
      path: { type: 'string', required: true, description: '要读取的表格文件绝对路径（.xlsx 或 .csv）。' },
      sheet: { type: 'string', description: '工作表名；省略时用第一张表。名称不存在会报错并列出所有可选名称。' },
      range: { type: 'string', description: '区域，如 A1:C10 / A:C / 3:7 / 单格 B3；省略时读整张已用区域。' },
      maxRows: { type: 'integer', description: `最多返回多少行（默认 ${200}，硬上限 5000）。` },
      maxColumns: { type: 'integer', description: `最多返回多少列（默认 ${50}，硬上限 500）。` },
      includeFormulas: { type: 'boolean', description: '是否返回公式文本与缓存结果，默认 true。' },
    },
    handlers.read,
  );

  register(
    'spreadsheet_create',
    '按结构化数据生成一个**真的** .xlsx（ZIP + OOXML，不是改名的 CSV、不是 HTML 冒充）：支持多工作表、表头、列宽与基本样式（表头加粗填色、隔行浅底纹、数字格式、对齐）。'
    + 'sheets 的每一项是 {name, columns:[{header,width,numberFormat,align,wrapText}], rows:[[值,...],...], freezeHeaderRow}；'
    + '单元格值只能是字符串/数字/布尔/空。写完后会重新打开文件逐格回读校验，全部一致才说"已生成"，并返回真实绝对路径、字节数与 sha256。'
    + `工作表名不得超过 31 字符且不能含 [ ] : * ? / \\，行数上限 50000、列数上限 200、整簿上限 400000 格。目标文件已存在时拒绝覆盖。`,
    {
      outputPath: { type: 'string', required: true, description: '输出 .xlsx 的绝对路径，必须在允许的工作区内，且文件不能已存在。' },
      sheets: {
        type: 'array',
        required: true,
        items: { type: 'json' },
        description: '工作表数组。示例：[{name:"成绩",columns:[{header:"姓名",width:12},{header:"分数",width:10,numberFormat:"0.00",align:"center"}],rows:[["张三",88.5],["李四",91]],freezeHeaderRow:true}]',
      },
    },
    handlers.create,
  );

  register(
    'spreadsheet_export',
    '导出表格。**支持的组合只有这几种**：.xlsx→.xlsx（原样逐字节另存，样式/公式/列宽都保留）、.xlsx→.csv（导出其中一张表，多工作表时必须用 sheet 指定）、'
    + '.csv→.xlsx（按第一行当表头建成真 .xlsx）、.csv→.csv（规范化重写）。'
    + '**不支持** pdf、xls（旧版 BIFF）、ods、numbers、html、tsv、json、markdown、txt、xml——会直接报错说清支持哪些，不会假装成功，也不会偷偷改成 CSV 改名。'
    + 'CSV 是纯文本：公式会变成缓存值（没有缓存的留空），样式、列宽、多工作表、批注都会丢失。源文件不会被修改，目标文件已存在时拒绝覆盖。',
    {
      sourcePath: { type: 'string', required: true, description: '要导出的源文件绝对路径（.xlsx 或 .csv）。' },
      format: {
        type: 'string',
        required: true,
        description: '目标格式，只支持 "xlsx" 或 "csv"。写别的（pdf/xls/ods/html/tsv/json/markdown/txt/xml 等）会被明确拒绝并回来说明支持哪些，不会假装成功。',
      },
      outputPath: { type: 'string', required: true, description: '导出目标的绝对路径，后缀必须与 format 一致，且文件不能已存在。' },
      sheet: { type: 'string', description: '导出 csv 时要导出哪一张工作表（源文件有多张表时必填）；csv→xlsx 时作为新工作表名。' },
    },
    handlers.exportSheet,
  );

  register(
    'spreadsheet_formula',
    '在已有的 .xlsx 里写入公式，并**真实计算**结果后把结果作为缓存值一起写进文件（源文件不改，另存为新文件）。'
    + '计算路径有两条：本机若有 LibreOffice（soffice），会把不带缓存结果的副本交给它真算一遍，用它算出的值（外部真算引擎）；'
    + '否则只有 Mochi 内置公式引擎的复算值，返回里会明确写清"未做外部引擎真算"。'
    + '内置引擎实现了 SUM/AVERAGE/MIN/MAX/COUNT/COUNTA/COUNTBLANK/PRODUCT/MEDIAN/LARGE/SMALL/RANK/STDEV/VAR/'
    + 'COUNTIF/SUMIF/AVERAGEIF/SUMPRODUCT/IF/IFERROR/AND/OR/NOT/ROUND/ROUNDUP/ROUNDDOWN/ABS/MOD/INT/TRUNC/POWER/SQRT/'
    + 'CONCATENATE/LEN/LEFT/RIGHT/MID/TRIM/UPPER/LOWER/REPT/SUBSTITUTE/VALUE 等；'
    + '**没有实现的函数**（VLOOKUP/INDEX/MATCH/SUMIFS/TEXT/DATE/NOW/PMT 等）一律报 #NAME? 并逐个点名，绝不用近似值冒充；'
    + '没有算出结果的格只写公式、不写缓存值。返回里逐格给出内置引擎值与 LibreOffice 值、是否一致、最终缓存值来源，并回读校验。',
    {
      path: { type: 'string', required: true, description: '要写入公式的 .xlsx 绝对路径（必须已存在；CSV 不支持）。' },
      outputPath: { type: 'string', description: '输出 .xlsx 的绝对路径，不能已存在；省略时用源文件同目录的「<名字>-公式.xlsx」。' },
      sheet: { type: 'string', description: '默认工作表名；公式项自己带 sheet 时以它为准。' },
      formulas: {
        type: 'array',
        required: true,
        items: { type: 'json' },
        description: '公式数组（最多 200 条）：[{cell:"B2",formula:"=SUM(B3:B10)"},{cell:"C2",formula:"=B2/COUNT(B3:B10)",sheet:"成绩"}]。cell 用 A1 写法，formula 必须以 = 开头。',
      },
    },
    handlers.formula,
  );

  console.log(`[mochi-sheets] 表格工具就绪：spreadsheet_read / spreadsheet_create / spreadsheet_export / spreadsheet_formula。${SHARED_NOTES}`);
}
