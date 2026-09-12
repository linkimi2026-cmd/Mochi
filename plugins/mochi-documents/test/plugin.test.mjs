import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const documentsRoot = new URL('../', import.meta.url);
const repositoryRoot = new URL('../../../', import.meta.url);

function validDocument(overrides = {}) {
  return {
    sourceKind: 'demonstration',
    title: '高一化学课堂安排',
    sourceLabel: '教师已确认示例',
    pages: [{
      blocks: [
        { kind: 'heading', level: 1, text: '本节课安排' },
        { kind: 'paragraph', text: '请先完成课堂讨论，再根据表格分组核对实验器材。' },
        { kind: 'table', columns: ['环节', '安排'], rows: [['讨论', '观察现象并记录'], ['核对', '确认实验器材']] },
      ],
    }],
    doubts: [{ question: '实验器材数量需要教师课前再次核对。', source: { kind: 'unknown' } }],
    ...overrides,
  };
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

async function copyFixture(root) {
  await mkdir(root, { recursive: true });
  await Promise.all([
    copyFile(new URL('index.mjs', documentsRoot), join(root, 'index.mjs')),
    copyFile(new URL('document-io.mjs', documentsRoot), join(root, 'document-io.mjs')),
    copyFile(new URL('plugin.mjs', documentsRoot), join(root, 'plugin.mjs')),
  ]);
  const nodeModules = join(root, 'node_modules');
  const scoped = join(nodeModules, '@mochi');
  const deepseek = join(nodeModules, '@deepseek-ai');
  await Promise.all([mkdir(scoped, { recursive: true }), mkdir(deepseek, { recursive: true })]);
  const sourceRoot = repositoryRoot.pathname;
  await Promise.all([
    symlink(join(sourceRoot, 'plugins', 'mochi-documents', 'node_modules.nosync', 'docx'), join(nodeModules, 'docx'), 'dir'),
    symlink(join(sourceRoot, 'plugins', 'mochi-documents', 'node_modules.nosync', 'pdf-lib'), join(nodeModules, 'pdf-lib'), 'dir'),
    symlink(join(sourceRoot, 'packages', 'mochi-pdf-layout'), join(scoped, 'pdf-layout'), 'dir'),
  ]);
  const toolsRoot = join(deepseek, 'dsh-tools');
  await mkdir(toolsRoot);
  await Promise.all([
    writeFile(join(toolsRoot, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","type":"module","exports":"./index.mjs"}\n'),
    writeFile(join(toolsRoot, 'index.mjs'), 'export function defineTool(options) { return options; }\n'),
  ]);
  return import(`${pathToFileURL(join(root, 'plugin.mjs')).href}?fixture=${Date.now()}-${Math.random()}`);
}

async function createHarness(t, { mode = 'workspace-write', documentTools } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-documents-tool-test-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const module = await copyFixture(join(root, 'module'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const registered = new Map();
  const ctx = {
    tools: { register: (tool) => registered.set(tool.name, tool) },
    sandboxPolicy: {
      resolve: ({ session }) => ({ mode, workspaceRoot: session.header.cwd }),
    },
    ...(documentTools ? { mochiDocuments: documentTools } : {}),
  };
  module.apply(ctx);
  const tool = registered.get('mochi_document_create');
  assert.ok(tool, 'the document tool must register exactly once');
  return {
    module,
    tool,
    tools: registered,
    workspace,
    exec: (signal = new AbortController().signal) => ({
      signal,
      agent: { session: { id: 'test-session', header: { cwd: workspace } } },
    }),
  };
}

async function assertError(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code);
}

test('teacher tool writes one complete generic bundle inside the current session workspace and leaves earlier output unchanged', { timeout: 30_000 }, async (t) => {
  const harness = await createHarness(t);
  const previous = join(harness.workspace, 'Mochi Documents', 'previous');
  await mkdir(previous, { recursive: true });
  const sentinel = join(previous, 'teacher-confirmed.txt');
  await writeFile(sentinel, 'keep this previous version');

  const outsideRequestedByModel = join(tmpdir(), `mochi-documents-outside-${Date.now()}`);
  const result = await harness.tool.execute(validDocument({ outputDirectory: outsideRequestedByModel }), harness.exec());
  const outputParent = join(harness.workspace, 'Mochi Documents');
  assert.equal(relative(await realpath(outputParent), result.输出目录).startsWith('..'), false);
  assert.equal(basename(result.输出目录).startsWith('document-'), true);
  assert.equal(await readFile(sentinel, 'utf8'), 'keep this previous version');
  assert.equal(await exists(outsideRequestedByModel), false, 'model-provided outputDirectory must have no filesystem effect');

  const [docx, pdf, manifest, checklist] = await Promise.all([
    readFile(result.产物.可编辑DOCX),
    readFile(result.产物.嵌字PDF),
    readFile(result.产物.完成标志, 'utf8').then(JSON.parse),
    readFile(result.产物.检查清单, 'utf8').then(JSON.parse),
  ]);
  assert.deepEqual(docx.subarray(0, 2), Buffer.from('PK'));
  assert.deepEqual(pdf.subarray(0, 5), Buffer.from('%PDF-'));
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.files.docx.editable, true);
  assert.equal(checklist.checks.find((check) => check.id === 'editable-docx')?.status, 'passed');
  assert.equal(result.完成标志状态, 'completed');
  assert.deepEqual(harness.module.output.render({ title: 'ignored' }, result), [{ type: 'text', text: JSON.stringify(result) }]);
});

test('invalid input, a pre-cancelled call, and read-only policy never publish a completed bundle', async (t) => {
  const invalid = await createHarness(t);
  await assertError(() => invalid.tool.execute(validDocument({ pages: [] }), invalid.exec()), 'INVALID_INPUT');
  assert.equal(await exists(join(invalid.workspace, 'Mochi Documents')), false);

  const cancelled = await createHarness(t);
  const controller = new AbortController();
  controller.abort();
  await assertError(() => cancelled.tool.execute(validDocument(), cancelled.exec(controller.signal)), 'ABORTED');
  assert.equal(await exists(join(cancelled.workspace, 'Mochi Documents')), false);

  const readonly = await createHarness(t, { mode: 'read-only' });
  await assertError(() => readonly.tool.execute(validDocument(), readonly.exec()), 'SANDBOX_READ_ONLY');
  assert.equal(await exists(join(readonly.workspace, 'Mochi Documents')), false);
});

test('a symbolic-link output parent and an unavailable special template are rejected before publication', async (t) => {
  const symlinkHarness = await createHarness(t);
  const outside = join(tmpdir(), `mochi-documents-outside-parent-${Date.now()}`);
  await mkdir(outside);
  t.after(async () => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(symlinkHarness.workspace, 'Mochi Documents'), 'dir');
  await assertError(() => symlinkHarness.tool.execute(validDocument(), symlinkHarness.exec()), 'WORKSPACE_UNSAFE');
  assert.equal((await lstat(outside)).isDirectory(), true);
  assert.deepEqual(await readdir(outside), []);

  const specialHarness = await createHarness(t);
  const special = validDocument({
    template: 'sichuan-2026-high-school-exam-base',
    pages: undefined,
    exam: {
      subject: '数学',
      sourcePageCount: 1,
      sections: [{
        title: '选择题',
        questions: [{ number: '1', prompt: [{ kind: 'text', text: '请完成示例题。' }] }],
      }],
    },
  });
  await assertError(() => specialHarness.tool.execute(special, specialHarness.exec()), 'SPECIAL_TEMPLATE_UNAVAILABLE');
  assert.equal(await exists(join(specialHarness.workspace, 'Mochi Documents')), false);
});

test('all five teacher document tools register under gateway-safe names', async (t) => {
  const harness = await createHarness(t);
  const names = [...harness.tools.keys()].sort();
  assert.deepEqual(names, ['doc_create', 'doc_edit', 'doc_export', 'doc_read', 'mochi_document_create', 'pdf_read'].sort());
  for (const name of names) {
    assert.match(name, /^[a-zA-Z0-9_-]+$/, `${name} must survive the model gateway without a 400`);
  }
});

test('doc_create and mochi_document_create are one implementation, not two', { timeout: 30_000 }, async (t) => {
  const first = await createHarness(t);
  const second = await createHarness(t);
  const shared = validDocument();
  const created = await first.tools.get('mochi_document_create').execute(shared, first.exec());
  const aliased = await second.tools.get('doc_create').execute(shared, second.exec());

  assert.deepEqual(Object.keys(aliased), Object.keys(created));
  assert.deepEqual(Object.keys(aliased.产物), Object.keys(created.产物));
  assert.equal(aliased.工具, 'doc_create');
  assert.equal(created.工具, 'mochi_document_create');
  assert.deepEqual(Object.keys(aliased.检查), Object.keys(created.检查));
  assert.equal(aliased.完成标志状态, created.完成标志状态);
  assert.equal(aliased.标题, created.标题);

  await assertError(() => first.tools.get('doc_create').execute(validDocument({ pages: [] }), first.exec()), 'INVALID_INPUT');
});

test('doc_read then doc_edit round-trips inside the session workspace and keeps the original file', { timeout: 60_000 }, async (t) => {
  const harness = await createHarness(t);
  const created = await harness.tool.execute(validDocument(), harness.exec());
  const sourcePath = created.产物.可编辑DOCX;
  const sourceBytes = await readFile(sourcePath);

  const read = await harness.tools.get('doc_read').execute({ path: sourcePath }, harness.exec());
  assert.equal(read.工具, 'doc_read');
  assert.equal(read.路径, sourcePath);
  assert.equal(read.字节数, sourceBytes.length);
  assert.equal(read.块数, read.块.length);
  assert.ok(read.块.some((block) => block.类型 === '表格' && block.表头.join('|') === '环节|安排'));
  assert.ok(read.块.some((block) => block.类型 === '标题' && block.标题级别 === 1 && block.样式ID === 'Heading1'));
  const target = read.块.find((block) => block.类型 === '段落' && block.文本.includes('课堂讨论'));

  const edited = await harness.tools.get('doc_edit').execute({
    path: sourcePath,
    ops: [
      { op: 'replace_text', blockIndex: target.序号, oldText: '课堂讨论', newText: '小组讨论' },
      { op: 'insert_paragraph', afterBlockIndex: target.序号, text: '教师补充：先核对器材', headingLevel: 2 },
    ],
    changeNote: '把课堂讨论改为小组讨论并补一条提醒',
  }, harness.exec());

  assert.equal(edited.工具, 'doc_edit');
  assert.equal(edited.状态, '已完成并校验通过');
  assert.equal(edited.回读校验.段落文本与预期一致, true);
  assert.equal(edited.回读校验.其他部件逐字节保留, true);
  assert.equal(edited.回读校验.表格内容未变, true);
  assert.equal(edited.源文件字节数, sourceBytes.length);
  assert.deepEqual(await readFile(sourcePath), sourceBytes, 'the source file must not be rewritten');
  assert.equal(basename(edited.输出文件).endsWith('.docx'), true);
  assert.ok(edited.输出文件.startsWith(await realpath(join(harness.workspace, 'Mochi Documents'))));
  assert.deepEqual(edited.改动.map((change) => change.操作), ['replace_text', 'insert_paragraph']);
  assert.match(edited.改动[0].说明, /匹配范围外的 run/);

  const reread = await harness.tools.get('doc_read').execute({ path: edited.输出文件 }, harness.exec());
  assert.ok(reread.块.some((block) => block.文本 === '请先完成小组讨论，再根据表格分组核对实验器材。'));
  assert.ok(reread.块.some((block) => block.文本 === '教师补充：先核对器材' && block.标题级别 === 2));
  assert.equal(reread.表格数, 1);

  const changes = JSON.parse(await readFile(edited.改动清单, 'utf8'));
  assert.equal(changes.changeNote, '把课堂讨论改为小组讨论并补一条提醒');
  assert.equal(changes.verification.passed, true);

  await assertError(
    () => harness.tools.get('doc_edit').execute({ path: sourcePath, ops: [{ op: 'replace_text', blockIndex: target.序号, oldText: '不存在的文字', newText: 'x' }] }, harness.exec()),
    'EDIT_TEXT_NOT_FOUND',
  );
});

test('document tools refuse paths outside the session workspace and unsupported types', async (t) => {
  const harness = await createHarness(t);
  await assertError(() => harness.tools.get('doc_read').execute({ path: '/etc/hosts' }, harness.exec()), 'INPUT_OUTSIDE_WORKSPACE');
  await assertError(() => harness.tools.get('doc_read').execute({ path: join(harness.workspace, 'missing.docx') }, harness.exec()), 'INPUT_NOT_FOUND');
  await assertError(() => harness.tools.get('doc_read').execute({ path: '' }, harness.exec()), 'INPUT_PATH_REQUIRED');

  const textPath = join(harness.workspace, 'plain.txt');
  await writeFile(textPath, 'not a document');
  await assertError(() => harness.tools.get('doc_read').execute({ path: textPath }, harness.exec()), 'INPUT_TYPE_UNSUPPORTED');
  await assertError(() => harness.tools.get('pdf_read').execute({ path: textPath }, harness.exec()), 'INPUT_TYPE_UNSUPPORTED');
});

test('pdf_read reads the generated PDF through the tool contract, with the honest extraction boundary attached', { timeout: 30_000 }, async (t) => {
  const harness = await createHarness(t);
  const created = await harness.tool.execute(validDocument(), harness.exec());
  const result = await harness.tools.get('pdf_read').execute({ path: created.产物.嵌字PDF, pages: '1' }, harness.exec());

  assert.equal(result.工具, 'pdf_read');
  assert.equal(result.已读取页.length, 1);
  assert.ok(result.页数 >= 1);
  assert.equal(result.文本抽取可用, true);
  assert.match(result.文本抽取方式, /ToUnicode/);
  assert.match(result.页[0].文本, /本节本节课安排|本节课安排|高一化学课堂安排/);
  assert.match(result.页[0].文本, /观察现象并记录/);
  assert.match(result.文本抽取边界, /Form XObject/);
  assert.equal(result.元数据.creator, 'Mochi Documents');

  await assertError(() => harness.tools.get('pdf_read').execute({ path: created.产物.嵌字PDF, pages: '99' }, harness.exec()), 'PDF_PAGE_RANGE_INVALID');
});

test('doc_export reports a missing engine honestly and publishes nothing', { timeout: 30_000 }, async (t) => {
  const harness = await createHarness(t, { documentTools: { pdfExportEngineCandidates: [join(tmpdir(), 'mochi-no-such-soffice')] } });
  const created = await harness.tool.execute(validDocument(), harness.exec());
  const before = await readdir(join(harness.workspace, 'Mochi Documents'));

  await assert.rejects(
    () => harness.tools.get('doc_export').execute({ path: created.产物.可编辑DOCX }, harness.exec()),
    (error) => error?.code === 'EXPORT_ENGINE_UNAVAILABLE' && /不会假装导出/.test(error.message),
  );
  assert.deepEqual(await readdir(join(harness.workspace, 'Mochi Documents')), before, 'no export directory or fake PDF is created');
});

test('doc_export writes a real PDF when a local engine is present', { timeout: 120_000 }, async (t) => {
  const harness = await createHarness(t);
  const created = await harness.tool.execute(validDocument(), harness.exec());
  let exported;
  try {
    exported = await harness.tools.get('doc_export').execute({ path: created.产物.可编辑DOCX }, harness.exec());
  } catch (error) {
    assert.equal(error?.code, 'EXPORT_ENGINE_UNAVAILABLE', `unexpected export failure: ${error?.code} ${error?.message}`);
    t.skip('本机没有 LibreOffice/soffice；上一个用例已覆盖如实报错路径。');
    return;
  }
  assert.equal(exported.工具, 'doc_export');
  assert.ok(exported.页数 >= 1);
  const bytes = await readFile(exported.导出文件);
  assert.equal(bytes.length, exported.字节数);
  assert.deepEqual(bytes.subarray(0, 5), Buffer.from('%PDF-'));
  assert.ok(exported.引擎探测.some((entry) => entry.可用 === true));

  const reread = await harness.tools.get('pdf_read').execute({ path: exported.导出文件 }, harness.exec());
  assert.equal(reread.文本抽取可用, true);
  assert.match(reread.全文文本, /高一化学课堂安排/);
});

test('doc_read and pdf_read stay available in a read-only session while writers refuse', async (t) => {
  const writer = await createHarness(t);
  const created = await writer.tool.execute(validDocument(), writer.exec());

  const readonly = await createHarness(t, { mode: 'read-only' });
  const copied = join(readonly.workspace, 'shared.docx');
  await writeFile(copied, await readFile(created.产物.可编辑DOCX));
  const pdfCopy = join(readonly.workspace, 'shared.pdf');
  await writeFile(pdfCopy, await readFile(created.产物.嵌字PDF));

  const read = await readonly.tools.get('doc_read').execute({ path: copied }, readonly.exec());
  assert.equal(read.块数 > 0, true);
  const pdf = await readonly.tools.get('pdf_read').execute({ path: pdfCopy }, readonly.exec());
  assert.ok(pdf.页数 >= 1);
  await assertError(() => readonly.tools.get('doc_edit').execute({ path: copied, ops: [{ op: 'set_block_text', blockIndex: 1, text: 'x' }] }, readonly.exec()), 'SANDBOX_READ_ONLY');
  await assertError(() => readonly.tools.get('doc_export').execute({ path: copied }, readonly.exec()), 'SANDBOX_READ_ONLY');
  await assertError(() => readonly.tools.get('doc_create').execute(validDocument(), readonly.exec()), 'SANDBOX_READ_ONLY');
});

// 回归：老师**上传**的 Word 必须读得动。
//
// 宿主把上传原件按 verbatim 存到 `<DSH_HOME>/attachments/v1/…`，这个位置**不在会话工作区内**，
// 而本插件的输入路径闸原先只认工作区。于是两条路都堵死：
//   doc_read  -> INPUT_OUTSIDE_WORKSPACE「不在当前会话工作区内，已拒绝读取」
//   file_read -> 「二进制文件会被拒绝，Word/Excel/PPT/PDF 请用对应的文档工具」
// 模型只能回一句"读不到这个 Word"——老师看到的就是「上传的 Word 打不开」。
test('doc_read accepts a Word file from the host attachment store and still refuses everything else', async (t) => {
  const harness = await createHarness(t);
  const created = await harness.tools.get('doc_create').execute(validDocument(), harness.exec());

  const home = join(dirname(harness.workspace), 'home');
  const attachmentDir = join(home, 'attachments', 'v1', 'sha256-6f2a1c9d7e4b');
  await mkdir(attachmentDir, { recursive: true });
  const uploaded = join(attachmentDir, '第三章教案.docx');
  await copyFile(created.产物.可编辑DOCX, uploaded);

  // 附件盘根由宿主 home 决定；测试用临时 home，绝不读写真实用户数据。
  const previous = { DSH_HOME: process.env.DSH_HOME, MOCHI_HOME: process.env.MOCHI_HOME };
  process.env.DSH_HOME = home;
  // 显式清掉 MOCHI_HOME，避免开发者本机残留的环境变量改变候选顺序。
  delete process.env.MOCHI_HOME;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // 纯解析函数：显式喂 env/home，结果与运行环境无关。
  // 顺序 = 显式配置 → MOCHI_HOME → DSH_HOME → ~/.mochi-home → ~/.dsh，
  // 末两项是兜底候选，不是"多余项"——宿主换过 home 也要找得到。
  const fallbackHome = '/definitely-not-a-real-home';
  assert.deepEqual(
    harness.module.resolveAttachmentReadRoots({ env: { DSH_HOME: home }, home: fallbackHome }),
    [
      join(home, 'attachments', 'v1'),
      join(fallbackHome, '.mochi-home', 'attachments', 'v1'),
      join(fallbackHome, '.dsh', 'attachments', 'v1'),
    ],
    '每个候选 home 都要派生 <home>/attachments/v1',
  );
  assert.deepEqual(
    harness.module.resolveAttachmentReadRoots({ env: { MOCHI_HOME: join(home, 'mochi') }, home: fallbackHome }),
    [
      join(home, 'mochi', 'attachments', 'v1'),
      join(fallbackHome, '.mochi-home', 'attachments', 'v1'),
      join(fallbackHome, '.dsh', 'attachments', 'v1'),
    ],
    '只有 MOCHI_HOME 时它就是唯一显式根',
  );
  assert.deepEqual(
    harness.module.resolveAttachmentReadRoots({
      env: { MOCHI_HOME: join(home, 'mochi'), DSH_HOME: home },
      home: fallbackHome,
    }),
    [
      join(home, 'mochi', 'attachments', 'v1'),
      join(home, 'attachments', 'v1'),
      join(fallbackHome, '.mochi-home', 'attachments', 'v1'),
      join(fallbackHome, '.dsh', 'attachments', 'v1'),
    ],
    'MOCHI_HOME 优先，DSH_HOME 仍作为候选保留',
  );
  // 去重：configured 与 env 指向同一处时只留一条。
  assert.deepEqual(
    harness.module.resolveAttachmentReadRoots({ configured: [home], env: { DSH_HOME: home }, home: fallbackHome }),
    [
      join(home, 'attachments', 'v1'),
      join(fallbackHome, '.mochi-home', 'attachments', 'v1'),
      join(fallbackHome, '.dsh', 'attachments', 'v1'),
    ],
    '重复候选必须去重',
  );
  // 当前进程环境下，临时附件盘确实在候选里（后续读取就靠它）。
  assert.ok(
    harness.module.resolveAttachmentReadRoots().includes(join(home, 'attachments', 'v1')),
    'DSH_HOME 指向的临时附件盘必须在候选根里',
  );

  const read = await harness.tools.get('doc_read').execute({ path: uploaded }, harness.exec());
  assert.equal(read.来源, '老师上传的附件（宿主只读副本）');
  assert.equal(read.路径, await realpath(uploaded));
  assert.ok(read.块.some((block) => String(block.文本 ?? '').includes('本节课安排')), '上传的 Word 内容必须真的读出来');

  // 附件盘之外依旧拒绝，放行范围没有被放大。
  await assertError(() => harness.tools.get('doc_read').execute({ path: '/etc/hosts' }, harness.exec()), 'INPUT_OUTSIDE_WORKSPACE');
  // 同名但不在附件盘、也不在工作区的文件同样拒绝。
  const outsideDir = join(dirname(harness.workspace), 'elsewhere');
  await mkdir(outsideDir, { recursive: true });
  const outside = join(outsideDir, '第三章教案.docx');
  await copyFile(created.产物.可编辑DOCX, outside);
  await assertError(() => harness.tools.get('doc_read').execute({ path: outside }, harness.exec()), 'INPUT_OUTSIDE_WORKSPACE');

  // 读得到不等于改得动：doc_edit 的产物仍然只落在会话工作区。
  const edited = await harness.tools.get('doc_edit').execute(
    { path: uploaded, ops: [{ op: 'set_block_text', blockIndex: 1, text: '改过的标题' }] },
    harness.exec(),
  );
  assert.ok(edited.输出文件.startsWith(await realpath(harness.workspace)), '编辑产物必须落在会话工作区内');
  assert.equal(await exists(uploaded), true, '只读副本本身绝不被改写');
});
