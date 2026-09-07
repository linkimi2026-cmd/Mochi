// mochi-grades 插件接线测试（MOCHI-P2-TS-01）。
// 运行：node test-plugin.mjs
// 覆盖：工具注册、xlsx/csv 双通道全链、口径对照库内统计、待核对着行号、
// 学号前导零、输出目录已存在报错、render 双参签名（大坑 17）。
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { apply } from './plugin.mjs';
import { calculateGradeStatistics, validateStructuredGrades, COMPLETION_FILENAME } from './index.mjs';

const NODE = 'mochi.grade_analyze';

const ASSESSMENT = { name: '期中数学测验', subject: '数学', maxScore: 100, passScore: 60, excellentScore: 85 };
// 全链 fixture：缺考/免修/空白/零分/重复学号/同名不同学号各占一行；有效分数 95、88。
const FIXTURE_ROWS = [
  ['001', '王芳', 95],   // 行 2：零前导零学号 + 有效高分
  ['002', '李明', 0],    // 行 3：present 零分
  ['003', '王芳', 88],   // 行 4：同名不同学号
  ['004', '赵强', '缺考'], // 行 5
  ['005', '钱进', '免修'], // 行 6
  ['006', '孙丽', ''],   // 行 7：空白
  ['002', '李明', 71],   // 行 8：重复学号
];

async function createTestRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-grades-plugin-test-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function pluginArgs(filePath, outputDirectory) {
  return {
    filePath,
    outputDirectory,
    examName: ASSESSMENT.name,
    subject: ASSESSMENT.subject,
    maxScore: ASSESSMENT.maxScore,
    passScore: ASSESSMENT.passScore,
    excellentScore: ASSESSMENT.excellentScore,
    scopeLabel: '插件测试',
  };
}

function loadTool(t) {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  const tool = registered.find((item) => item.name === NODE);
  assert.ok(tool, 'mochi.grade_analyze must be registered by apply(ctx)');
  t.diagnostic(`registered tools: ${registered.map((item) => item.name).join(', ')}`);
  return tool;
}

async function writeFixtureWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('成绩');
  sheet.addRow(['学号', '姓名', '期末成绩']);
  for (const [studentId, studentName, score] of FIXTURE_ROWS) {
    const row = sheet.addRow([studentId, studentName, score === '' ? null : score]);
    row.getCell(1).numFmt = '@'; // 学号列按文本写入，前导零不丢
  }
  await workbook.xlsx.writeFile(filePath);
}

function fixtureCsv() {
  const lines = ['学号,姓名,期末成绩'];
  for (const [studentId, studentName, score] of FIXTURE_ROWS) lines.push(`${studentId},${studentName},${score}`);
  return `${lines.join('\n')}\n`;
}

test('tool registers with dsh shape: name, parameters, double-arg render', (t) => {
  const tool = loadTool(t);
  assert.equal(tool.name, NODE);
  assert.ok(tool.description.includes('.xlsx'), 'description states supported formats');
  assert.equal(tool.parameters.required?.includes('filePath'), true, 'filePath is required');
  assert.equal(tool.parameters.required?.includes('outputDirectory'), true, 'outputDirectory is required');
  // render 签名回归（大坑 17）：双参 (args, value)，单参写法会把调用参数当结果给模型。
  const rendered = tool.output.render({ filePath: 'args-side-marker' }, { valueSideMarker: 'value-side' });
  const text = rendered.map((part) => part.text).join('');
  assert.match(text, /value-side/u, 'render output must come from the value argument');
  assert.doesNotMatch(text, /args-side-marker/u, 'render output must not leak the args argument');
});

for (const format of ['xlsx', 'csv']) {
  test(`${format} channel runs the full chain and keeps every documented caliber`, async (t) => {
    const tool = loadTool(t);
    const root = await createTestRoot(t);
    const filePath = join(root, `grades.${format}`);
    if (format === 'xlsx') await writeFixtureWorkbook(filePath);
    else await writeFile(filePath, fixtureCsv(), 'utf8');
    const outputDirectory = join(root, `out-${format}`);

    const result = await tool.execute(pluginArgs(filePath, outputDirectory), {});

    // ② 全链：真 .xlsx 产物存在，完成标志存在。
    assert.equal(result.状态, '完成');
    assert.equal(await exists(result.产物.工作簿), true);
    assert.equal(await exists(join(outputDirectory, COMPLETION_FILENAME)), true);
    assert.equal(result.产物.完成标志已写入, true);
    const workbookBytes = await readFile(result.产物.工作簿);
    assert.equal(workbookBytes[0] === 0x50 && workbookBytes[1] === 0x4b, true, 'workbook is a real OOXML ZIP container');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.产物.工作簿);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['统计报告', '逐行审计', '原始行']);

    // ⑤ 学号前导零保留（"001"）。
    const raw = workbook.getWorksheet('原始行');
    assert.equal(raw.getCell('C2').value, '001', 'leading zeros survive the whole chain');

    // ③ 口径断言：缺考/免修/空白/零分各几人。
    assert.deepEqual(result.人数口径, {
      缺考: 1, 免修: 1, 空白: 1, 零分: 1,
      纳入统计: 2, 不纳入统计: 5,
      说明: result.人数口径.说明,
    });

    // ③ 对照库内统计：用 validateStructuredGrades 的归一化行按文档口径标 included，
    // 交给 calculateGradeStatistics 复算，再与工具返回的库内统计对照（不自己另算）。
    const grades = {
      sourceKind: 'upstream-authorized-structured-grades',
      reportScope: 'teacher-internal',
      assessment: ASSESSMENT,
      rows: FIXTURE_ROWS.map(([studentId, studentName, score], index) => ({
        sourceRow: index + 2,
        studentId,
        studentName,
        status: score === '缺考' ? 'absent' : score === '免修' ? 'exempt' : score === '' ? 'blank' : 'present',
        score: typeof score === 'number' ? score : undefined,
      })),
    };
    const validation = validateStructuredGrades(grades);
    assert.equal(validation.issues.length, 0, 'fixture must pass library validation');
    const duplicateIds = new Set(
      validation.value.rows
        .filter((row, _index, all) => all.filter((other) => other.studentId === row.studentId).length > 1)
        .map((row) => row.studentId),
    );
    const reviewedRows = validation.value.rows.map((row) => {
      const included = row.status === 'present' && !duplicateIds.has(row.studentId);
      return { included, effectiveScore: included ? row.score : null };
    });
    const reference = calculateGradeStatistics(reviewedRows, ASSESSMENT);
    assert.deepEqual(result.统计_来自库内.有效人数, reference.effectiveCount);
    assert.deepEqual(result.统计_来自库内.均值, reference.mean);
    assert.deepEqual(result.统计_来自库内.中位数, reference.median);
    assert.deepEqual(result.统计_来自库内.得分率, reference.scoreRate);
    assert.deepEqual(result.统计_来自库内.分数段, reference.bands);
    assert.equal(result.统计_来自库内.均值, 91.5);

    // ④ 重复学号/同名不同学号 -> 待核对名单含行号。
    const pendingText = JSON.stringify(result.待核对);
    assert.match(pendingText, /学号「002」在第 3、8 行重复/u, 'duplicate student id is reported with both line numbers');
    assert.equal(result.重复学号.length, 1);
    assert.deepEqual(result.重复学号[0].行号, [3, 8]);
    assert.equal(result.同名不同学号.length, 1);
    assert.equal(result.同名不同学号[0].姓名, '王芳');
    assert.deepEqual(result.同名不同学号[0].行号, [2, 4]);

    // ①/② 口径原样引用：摘要里的阈值与输入完全一致。
    assert.deepEqual(
      { 满分: result.口径.满分, 及格线: result.口径.及格线, 优秀线: result.口径.优秀线 },
      { 满分: 100, 及格线: 60, 优秀线: 85 },
    );
    assert.equal(result.输入.可判读数据行数, FIXTURE_ROWS.length);
    assert.equal(result.输入.文件, filePath);
  });
}

test('unreadable cell is flagged as pending with its line number instead of being guessed', async (t) => {
  const tool = loadTool(t);
  const root = await createTestRoot(t);
  const filePath = join(root, 'messy.csv');
  await writeFile(filePath, [
    '学号,姓名,期末成绩',
    '010,陈一,九十',
    '011,刘二,77',
  ].join('\n'), 'utf8');
  const result = await tool.execute(pluginArgs(filePath, join(root, 'out-messy')), {});
  const pendingText = JSON.stringify(result.待核对);
  assert.match(pendingText, /第 2 行/u, 'unreadable score is reported with its line number');
  assert.match(pendingText, /九十/u, 'the unreadable value is quoted verbatim');
  assert.equal(result.输入.可判读数据行数, 1, 'only the decidable row enters statistics');
  assert.equal(result.统计_来自库内.有效人数, 1);
});

test('existing output directory is refused, never overwritten', async (t) => {
  const tool = loadTool(t);
  const root = await createTestRoot(t);
  const filePath = join(root, 'grades.csv');
  await writeFile(filePath, fixtureCsv(), 'utf8');
  const outputDirectory = join(root, 'already-there');
  await mkdir(outputDirectory);
  await writeFile(join(outputDirectory, 'keepme.txt'), 'do not touch', 'utf8');
  await assert.rejects(
    () => tool.execute(pluginArgs(filePath, outputDirectory), {}),
    (error) => /已存在|OUTPUT_EXISTS|不覆盖/u.test(String(error?.message ?? error)),
  );
  assert.equal(await exists(join(outputDirectory, 'keepme.txt')), true, 'existing content stays untouched');
  assert.equal(await exists(join(outputDirectory, COMPLETION_FILENAME)), false);
});

test('missing student-id header fails with an actionable Chinese error', async (t) => {
  const tool = loadTool(t);
  const root = await createTestRoot(t);
  const filePath = join(root, 'no-header.csv');
  await writeFile(filePath, '编号,姓名,期末成绩\n001,王芳,95\n', 'utf8');
  await assert.rejects(
    () => tool.execute(pluginArgs(filePath, join(root, 'out-header')), {}),
    (error) => /学号/u.test(String(error?.message ?? error)),
  );
});
