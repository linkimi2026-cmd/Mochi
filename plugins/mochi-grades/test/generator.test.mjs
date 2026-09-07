import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { demonstrationGradeInput } from '../demo.mjs';
import {
  COMPLETION_FILENAME,
  INTERNAL_WORKBOOK_FILENAME,
  MochiGradesError,
  generateGradeWorkbook,
  validateStructuredGrades,
} from '../index.mjs';

async function createTestRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-grades-test-'));
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runText(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', rejectRun);
    child.once('close', (code) => {
      if (code === 0) resolveRun(Buffer.concat(stdout).toString('utf8'));
      else rejectRun(new Error(`utility failed with exit ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
    });
  });
}

async function assertRejectsCode(operation, code) {
  await assert.rejects(operation, (error) => error instanceof MochiGradesError && error.code === code);
}

test('explicit demonstration creates a real teacher-internal XLSX with raw rows, audit evidence, and program statistics', async (t) => {
  const root = await createTestRoot(t);
  const outputDirectory = join(root, 'teacher-internal');
  const bundle = await generateGradeWorkbook({ grades: demonstrationGradeInput(), outputDirectory });

  assert.equal(bundle.status, 'completed');
  assert.equal(bundle.statistics.inputCount, 9);
  assert.equal(bundle.statistics.effectiveCount, 4, 'present zero is a real score while absent, exempt, blank, and duplicate rows are excluded');
  assert.equal(bundle.statistics.excludedCount, 5);
  assert.equal(bundle.statistics.mean, 65);
  assert.equal(bundle.statistics.median, 80);
  assert.equal(bundle.statistics.scoreRate, 0.65);
  assert.deepEqual(bundle.statistics.bands, { '未达及格': 1, '及格': 1, '优秀': 2 });
  assert.equal(await exists(bundle.workbookPath), true);
  assert.equal(await exists(bundle.manifestPath), true);
  assert.equal(await exists(bundle.completionPath), true);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(bundle.workbookPath);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['统计报告', '逐行审计', '原始行']);
  const raw = workbook.getWorksheet('原始行');
  const audit = workbook.getWorksheet('逐行审计');
  const report = workbook.getWorksheet('统计报告');
  assert.equal(report.getCell('A4').value, '考试名称');
  assert.equal(report.getCell('B4').value, '演示语文单元测验');
  assert.equal(report.getCell('B8').value, 100, 'formula references use the explicit maximum-score cell');
  assert.equal(report.getCell('B9').value, 60, 'formula references use the explicit pass-score cell');
  assert.equal(report.getCell('B10').value, 85, 'formula references use the explicit excellent-score cell');
  assert.equal(raw.getCell('C2').value, '0001', 'student IDs stay typed as strings and retain leading zeros');
  assert.equal(raw.getCell('D2').value, '王芳');
  assert.equal(raw.getCell('F2').value, 0, 'a present zero remains a raw score rather than a blank');
  assert.equal(raw.getCell('D3').value, '王芳', 'same names with different student IDs stay separate source rows');
  assert.equal(audit.getCell('J2').value, '是', 'a present zero participates in statistics');
  assert.match(String(audit.getCell('H9').value), /重复学号/u);
  assert.equal(audit.getCell('J9').value, '否', 'duplicate records are not auto-merged into the statistic');
  assert.equal(audit.getCell('J10').value, '否');
  assert.equal(report.getCell('B14').value.result, 4, 'workbook formula cache matches deterministic effective count');
  assert.equal(report.getCell('B16').value.result, 65, 'workbook formula cache matches deterministic mean');
  assert.equal(report.getCell('B17').value.result, 80, 'workbook formula cache matches deterministic median');
  assert.equal(report.getCell('B18').value.result, 0.65, 'workbook formula cache matches deterministic score rate');
  assert.match(report.getCell('B18').value.formula, /B16\/B8/u, 'score-rate formula divides by the explicit maximum score');
  assert.match(report.getCell('B22').value.formula, /\$B\$9/u, 'band formula uses the explicit pass line');
  assert.match(report.getCell('B23').value.formula, /\$B\$10/u, 'band formula uses the explicit excellent line');
  assert.match(report.getCell('B24').value.formula, /\$J\$2:\$J\$10,"是"/u, 'band formulas explicitly require the audit inclusion flag, including when a threshold is zero');
  assert.match(String(report.getCell('A27').value), /未由总分推断知识点、态度或能力/u);

  const [archiveListing, sharedStrings, completion, manifest] = await Promise.all([
    runText('/usr/bin/unzip', ['-Z1', bundle.workbookPath]),
    runText('/usr/bin/unzip', ['-p', bundle.workbookPath, 'xl/sharedStrings.xml']),
    readFile(bundle.completionPath, 'utf8').then(JSON.parse),
    readFile(bundle.manifestPath, 'utf8').then(JSON.parse),
  ]);
  assert.match(archiveListing, /^\[Content_Types\]\.xml$/m, 'the output is an actual OOXML ZIP workbook');
  assert.match(archiveListing, /^xl\/worksheets\/sheet1\.xml$/m);
  assert.match(sharedStrings, /0001/u);
  assert.match(sharedStrings, /原始输入 JSON/u);
  assert.equal(completion.status, 'completed', 'the completion marker is published only after workbook reopening succeeds');
  assert.equal(manifest.status, 'verified-awaiting-completion-marker');
  assert.equal(manifest.files.workbook.name, INTERNAL_WORKBOOK_FILENAME);
});

test('external-anonymized output contains aggregate data only, including workbook metadata', async (t) => {
  const root = await createTestRoot(t);
  const outputDirectory = join(root, 'external-summary');
  const bundle = await generateGradeWorkbook({ grades: demonstrationGradeInput('external-anonymized'), outputDirectory });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(bundle.workbookPath);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['匿名汇总']);
  assert.equal(workbook.creator, 'Mochi Grades');
  assert.equal(workbook.title, '匿名成绩汇总');
  assert.equal(workbook.subject, '匿名成绩汇总');
  const summary = workbook.getWorksheet('匿名汇总');
  assert.equal(summary.getCell('B9').value, 4);
  assert.equal(summary.getCell('B11').value, 65);
  const [strings, manifestText] = await Promise.all([
    runText('/usr/bin/unzip', ['-p', bundle.workbookPath, 'xl/sharedStrings.xml']),
    readFile(bundle.manifestPath, 'utf8'),
  ]);
  for (const privateValue of ['0001', '0012', '王芳', '赵宁', '孙悦', '演示成绩材料']) {
    assert.doesNotMatch(strings, new RegExp(privateValue, 'u'), `external workbook must not contain ${privateValue}`);
    assert.doesNotMatch(manifestText, new RegExp(privateValue, 'u'), `external manifest must not contain ${privateValue}`);
  }
  assert.match(strings, /不包含姓名、学号、原始行、来源标签或其他个人身份信息/u, 'the anonymous report states its privacy boundary without embedding any identity values');
});

test('unknown policy, malformed rows, numeric student IDs, and supported-size limits are returned as validation issues before output creation', async (t) => {
  const root = await createTestRoot(t);
  const invalid = demonstrationGradeInput();
  delete invalid.assessment.maxScore;
  delete invalid.reportScope;
  invalid.rows[0].studentId = 1;
  invalid.rows[1].score = undefined;
  const validation = validateStructuredGrades(invalid);
  assert.equal(validation.value, null);
  assert.deepEqual(
    validation.issues.map((entry) => entry.code).sort(),
    ['REQUIRED_ENUM', 'REQUIRED_NUMBER', 'REQUIRED_NUMBER', 'STUDENT_ID_STRING_REQUIRED'],
  );
  const outputDirectory = join(root, 'invalid-output');
  await assertRejectsCode(() => generateGradeWorkbook({ grades: invalid, outputDirectory }), 'VALIDATION_FAILED');
  assert.equal(await exists(outputDirectory), false);

  const tooMany = demonstrationGradeInput();
  tooMany.rows = Array.from({ length: 10_001 }, () => demonstrationGradeInput().rows[0]);
  assert.ok(validateStructuredGrades(tooMany).issues.some((entry) => entry.code === 'ROWS_TOO_MANY'));
  const tooWide = demonstrationGradeInput();
  tooWide.rows[0].sourceRecord = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`c${index}`, index]));
  assert.ok(validateStructuredGrades(tooWide).issues.some((entry) => entry.code === 'SOURCE_RECORD_TOO_WIDE'));

  const noRows = demonstrationGradeInput();
  noRows.rows = [];
  assert.ok(validateStructuredGrades(noRows).issues.some((entry) => entry.code === 'ROWS_REQUIRED'));

  const missingExternalLabel = demonstrationGradeInput('external-anonymized');
  delete missingExternalLabel.externalReportLabel;
  assert.ok(
    validateStructuredGrades(missingExternalLabel).issues.some((entry) => entry.path === 'externalReportLabel' && entry.code === 'REQUIRED_TEXT'),
    'an external aggregate report requires a host-provided public-safe label',
  );

  const nonFiniteMaximum = demonstrationGradeInput();
  nonFiniteMaximum.assessment.maxScore = Number.POSITIVE_INFINITY;
  assert.ok(validateStructuredGrades(nonFiniteMaximum).issues.some((entry) => entry.path === 'assessment.maxScore' && entry.code === 'REQUIRED_NUMBER'));
});

test('an already-aborted generation removes its exclusive target and never emits a completion marker', async (t) => {
  const root = await createTestRoot(t);
  const outputDirectory = join(root, 'cancelled');
  const controller = new AbortController();
  const pending = generateGradeWorkbook({ grades: demonstrationGradeInput(), outputDirectory, signal: controller.signal });
  queueMicrotask(() => controller.abort());
  await assertRejectsCode(() => pending, 'ABORTED');
  assert.equal(await exists(outputDirectory), false);
  assert.equal(await exists(join(outputDirectory, COMPLETION_FILENAME)), false);
});

test('a repeated target is never overwritten and concurrent claims allow exactly one completed workbook', async (t) => {
  const root = await createTestRoot(t);
  const repeated = join(root, 'repeated');
  const first = await generateGradeWorkbook({ grades: demonstrationGradeInput(), outputDirectory: repeated });
  const original = await readFile(first.workbookPath);
  await assertRejectsCode(() => generateGradeWorkbook({ grades: demonstrationGradeInput(), outputDirectory: repeated }), 'OUTPUT_EXISTS');
  assert.equal(sha256(await readFile(first.workbookPath)), sha256(original));

  const concurrent = join(root, 'concurrent');
  const results = await Promise.allSettled([
    generateGradeWorkbook({ grades: demonstrationGradeInput(), outputDirectory: concurrent }),
    generateGradeWorkbook({ grades: demonstrationGradeInput(), outputDirectory: concurrent }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'one mkdir claim owns the new target');
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'OUTPUT_EXISTS');
  assert.equal(await exists(join(concurrent, COMPLETION_FILENAME)), true, 'the winning claim publishes a completion marker');
});
