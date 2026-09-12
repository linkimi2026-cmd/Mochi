// mochi-grades · 成绩分析聊天接线（MOCHI-P2-TS-01）。
// 工具 mochi_grade_analyze：读老师给的成绩表（.xlsx/.csv）-> validateStructuredGrades
// -> generateGradeWorkbook（teacher-internal 内部审计工作簿，真 .xlsx）-> 返回预消化中文摘要。
// 统计口径零自算，全部走 index.mjs 的库内函数；拿不准的输入标待核对，不猜。
import { access } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { MochiGradesError, generateGradeWorkbook, validateStructuredGrades } from './index.mjs';
import { SheetReadError, readGradeSheet } from './sheet-read.mjs';

export const name = 'mochi-grades';
export const inject = ['tools'];
// ⚠️ render 签名是 (args, value)（2026-09-05 大坑 17）：单参写法会把调用参数当结果给模型。
export const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

const STATUS_LABEL = { present: '到考', absent: '缺考', exempt: '免修', blank: '空白' };
const FIELD_LABEL = {
  studentId: '学号',
  studentName: '姓名',
  status: '状态',
  score: '分数',
  sourceRow: '来源行',
};

function requireText(args, field, label) {
  const value = typeof args[field] === 'string' ? args[field].trim() : '';
  if (!value) throw new Error(`请先明确「${label}」（当前缺失或不是文本），统计口径不由模块猜测。`);
  return value;
}

function requireNumber(args, field, label) {
  const value = args[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`「${label}」必须是明确的数字，不能省略或用文字代替；统计口径不由模块猜测。`);
  }
  return value;
}

function requireAbsolutePath(args, field, label) {
  const value = typeof args[field] === 'string' ? args[field].trim() : '';
  if (!value || !isAbsolute(value)) throw new Error(`「${label}」必须是绝对路径（收到：${value || '空'}）。`);
  return value;
}

// 把库内校验问题翻译成带行号的中文，路径 rows[N].field 映射回来源行号。
function describeValidationIssues(issues, rows) {
  return issues.map((item) => {
    const match = /^rows\[(\d+)\]\.(\w+)$/.exec(item.path);
    if (match) {
      const row = rows[Number(match[1])];
      const where = row ? `第 ${row.sourceRow} 行（学号 ${row.studentId}）` : `输入第 ${Number(match[1]) + 1} 行`;
      return `${where}的${FIELD_LABEL[match[2]] || match[2]}：${item.message}`;
    }
    return `${item.path}：${item.message}`;
  });
}

function describeGradeError(error, rows) {
  const lines = describeValidationIssues(error.issues ?? [], rows);
  const detail = lines.length > 0 ? `\n${lines.join('\n')}` : '';
  return `【成绩分析失败】${error.code}：${error.message}${detail}\n下一步：按上面的问题修正源文件或参数后，换一个尚不存在的输出目录重新调用；已存在的输出目录不会被覆盖。`;
}

async function execute(args) {
  const filePath = requireAbsolutePath(args, 'filePath', '成绩表文件路径');
  const outputDirectory = requireAbsolutePath(args, 'outputDirectory', '输出目录');
  const examName = requireText(args, 'examName', '考试名称');
  const subject = requireText(args, 'subject', '科目');
  const maxScore = requireNumber(args, 'maxScore', '满分');
  const passScore = requireNumber(args, 'passScore', '及格线');
  const excellentScore = requireNumber(args, 'excellentScore', '优秀线');
  const scopeLabel = typeof args.scopeLabel === 'string' && args.scopeLabel.trim() ? args.scopeLabel.trim() : undefined;

  if (!/\.xlsx$/i.test(filePath) && !/\.csv$/i.test(filePath)) {
    throw new Error('成绩表只支持 .xlsx 或 .csv 文件，请让主人确认格式后重试。');
  }
  try {
    await access(filePath);
  } catch {
    throw new Error(`成绩表文件不存在或不可读：${filePath}。请确认路径后重试。`);
  }

  let sheet;
  try {
    sheet = await readGradeSheet(filePath);
  } catch (error) {
    if (error instanceof SheetReadError) throw new Error(`【成绩分析失败】${error.message}`);
    throw error;
  }
  const fatalNotices = sheet.notices.filter((notice) => notice.level === '致命');
  if (fatalNotices.length > 0) {
    throw new Error(`【成绩分析失败】${fatalNotices.map((notice) => notice.message).join('\n')}\n下一步：修正源文件后重试。`);
  }

  const grades = {
    sourceKind: 'upstream-authorized-structured-grades',
    reportScope: 'teacher-internal',
    ...(scopeLabel ? { sourceLabel: scopeLabel } : {}),
    assessment: { name: examName, subject, maxScore, passScore, excellentScore },
    rows: sheet.rows,
  };
  const validation = validateStructuredGrades(grades);
  if (validation.issues.length > 0) {
    throw new Error(`【成绩分析失败】成绩输入还有未解决的问题：\n${describeValidationIssues(validation.issues, grades.rows).join('\n')}\n下一步：修正后换一个尚不存在的输出目录重新调用。`);
  }

  let bundle;
  try {
    bundle = await generateGradeWorkbook({ grades, outputDirectory });
  } catch (error) {
    if (error instanceof MochiGradesError) throw new Error(describeGradeError(error, grades.rows));
    throw error;
  }

  let completionMarkerWritten = false;
  try {
    await access(bundle.completionPath);
    completionMarkerWritten = true;
  } catch { /* 完成标志不存在时如实报告。 */ }

  const pendingNotices = sheet.notices.filter((notice) => notice.level !== '提示').map((notice) => ({
    行号: [...notice.message.matchAll(/第 (\d+(?:、\d+)*) 行/g)].map((match) => match[1]).join('、'),
    事项: notice.message,
  }));
  const statusTally = { 缺考: 0, 免修: 0, 空白: 0, 零分: 0 };
  for (const row of sheet.rows) {
    if (row.status === 'absent') statusTally.缺考 += 1;
    if (row.status === 'exempt') statusTally.免修 += 1;
    if (row.status === 'blank') statusTally.空白 += 1;
    if (row.status === 'present' && row.score === 0) statusTally.零分 += 1;
  }

  return {
    状态: '完成',
    输入: {
      文件: filePath,
      格式: sheet.format,
      表头行: sheet.headerLine,
      可判读数据行数: sheet.rows.length,
      学号列: sheet.columns.studentId,
      姓名列: sheet.columns.studentName,
      分数列: sheet.columns.score,
      分数列采纳方式: sheet.columns.scoreColumnSource,
    },
    口径: {
      考试名称: examName,
      科目: subject,
      满分: maxScore,
      及格线: passScore,
      优秀线: excellentScore,
      ...(scopeLabel ? { 来源标签: scopeLabel } : {}),
      说明: '以上阈值均为明确输入，原样引用，不由模块猜测。',
    },
    人数口径: {
      ...statusTally,
      纳入统计: bundle.statistics.effectiveCount,
      不纳入统计: bundle.statistics.excludedCount,
      说明: '零分是有效分数；缺考、免修、空白与重复学号一律不以零分代替。',
    },
    统计_来自库内: {
      输入记录数: bundle.statistics.inputCount,
      有效人数: bundle.statistics.effectiveCount,
      均值: bundle.statistics.mean,
      中位数: bundle.statistics.median,
      得分率: bundle.statistics.scoreRate,
      分数段: bundle.statistics.bands,
    },
    待核对: pendingNotices,
    同名不同学号: sheet.namesakes.map((namesake) => ({
      姓名: namesake.studentName,
      行号: namesake.lines,
      处理: '保持为不同记录，不合并（口径如此，不是错误）。',
    })),
    重复学号: sheet.duplicates.map((duplicate) => ({
      学号: duplicate.studentId,
      行号: duplicate.lines,
      处理: '不自动合并，整批待核对，已由统计库排除。',
    })),
    产物: {
      输出目录: bundle.outputDirectory,
      工作簿: bundle.workbookPath,
      完成标志: bundle.completionPath,
      完成标志已写入: completionMarkerWritten,
    },
    下一步: pendingNotices.length > 0
      ? '存在待核对行：请先核对上面列出的行号并修正源文件，再换一个尚不存在的输出目录重新调用。'
      : '全部输入可判读，无需修正。外部匿名版不在本工具范围；如需匿名汇总，请另行走外部版流程。',
  };
}

export function apply(ctx) {
  const register = (toolName, description, parameters, executeFn) => ctx.tools.register(defineTool({
    name: toolName,
    description,
    parameters,
    output,
    execute: executeFn,
  }));

  register('mochi_grade_analyze', '把老师给的成绩表（.xlsx 或 .csv 绝对路径）读成结构化输入，用既有成绩核验库生成教师内部审计工作簿（真 .xlsx，含逐行处理依据），并返回预消化的中文统计摘要。满分、及格线、优秀线必须由主人明确给出，模块不猜；缺考/免修/空白不按零分统计，学号保留前导零，重复学号整批待核对不合并。', {
    filePath: { type: 'string', required: true, description: '成绩表文件绝对路径（.xlsx 或 .csv）。' },
    outputDirectory: { type: 'string', required: true, description: '输出目录绝对路径；调用时必须不存在，不会被覆盖。' },
    examName: { type: 'string', required: true, description: '考试名称，如「期中数学测验」。' },
    subject: { type: 'string', required: true, description: '科目名称。' },
    maxScore: { type: 'number', required: true, description: '满分（明确输入，不猜）。' },
    passScore: { type: 'number', required: true, description: '及格线（明确输入，不猜）。' },
    excellentScore: { type: 'number', required: true, description: '优秀线（明确输入，不猜）。' },
    scopeLabel: { type: 'string', description: '可选来源标签，写入审计工作簿。' },
  }, execute);

  console.log('[mochi-grades] 成绩分析就绪：mochi_grade_analyze @ 内部审计工作簿（teacher-internal）');
}
