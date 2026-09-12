// ppt_inspect（只读 PPTX 检查）测试。
//
// 覆盖：① 真 .pptx（教师样例 6 页）的结构化检查结果
//      ② 改名的假 pptx（docx / 纯文本）被识别并明确报错，绝不返回“0 张幻灯片”
//      ③ 大小上限 / 页数上限如实拒绝
//      ④ 路径越界（绝对路径、符号链接）被拒；主目录与磁盘根不会被默认放开
//      ⑤ XML 解析器真解实体，不做正则猜结构
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';

import { teacherLessonSample } from '../fixtures/teacher-lesson.mjs';
import {
  MAX_INSPECT_BYTES,
  MochiPresentationsError,
  createInspectPathGuard,
  generatePresentationBundle,
  inspectPresentationFile,
  inspectPptxBuffer,
  parseXmlDocument,
  resolveInspectAllowedRoots,
} from '../index.mjs';
import { apply } from '../plugin.mjs';

async function rootFor(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-ppt-inspect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function rejectCode(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof MochiPresentationsError, true, `期望 MochiPresentationsError，实际 ${error?.name}: ${error?.message}`);
    assert.equal(error.code, code);
    return true;
  });
}

/** 生成一份真 .pptx（教师样例，6 页），返回产物路径。 */
async function realPptx(root) {
  const bundle = await generatePresentationBundle({ presentation: teacherLessonSample(), outputDirectory: join(root, 'deck') });
  return bundle.pptxPath;
}

/** 写一个最小但真实的 .docx 包，再改名成 .pptx —— 用于证明“假 pptx”会被识别。 */
async function renamedDocx(path) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:body><w:p><w:r><w:t>这不是课件，只是一份被改了扩展名的 Word 文档。</w:t></w:r></w:p></w:body>'
    + '</w:document>');
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

test('真 .pptx：读出页数、尺寸、逐页文字/表格/图表/版式/备注与文档元数据', { timeout: 60_000 }, async (t) => {
  const root = await rootFor(t);
  const pptxPath = await realPptx(root);
  const report = await inspectPresentationFile({ path: pptxPath });

  assert.equal(report.tool, 'ppt_inspect');
  assert.equal(report.完成, true);
  assert.equal(report.文件.真pptx, true);
  assert.equal(report.文件.主部件, 'ppt/presentation.xml');
  assert.equal(report.页数, 6);
  assert.equal(report.检查页数, 6);
  assert.equal(report.文件.大小字节 > 0, true);
  assert.match(report.文件.sha256, /^[0-9a-f]{64}$/u);
  assert.match(report.文件.修改时间, /^\d{4}-\d{2}-\d{2}T/u);

  // 幻灯片尺寸来自 ppt/presentation.xml 的 p:sldSz（LAYOUT_WIDE = 12192000×6858000 EMU）
  assert.equal(report.幻灯片尺寸.宽EMU, 12192000);
  assert.equal(report.幻灯片尺寸.高EMU, 6858000);
  assert.equal(report.幻灯片尺寸.宽高比, '16:9');
  assert.equal(report.幻灯片尺寸.宽.厘米, 33.87);

  // 文档元数据来自 docProps/core.xml + app.xml
  assert.equal(report.文档元数据.标题, '七年级科学：水循环与节水行动');
  assert.equal(report.文档元数据.创建者, 'Mochi Presentations');
  assert.equal(report.文档元数据.声明页数, 6);
  assert.equal(report.文档元数据.页数声明一致, true);

  // 每页都有尺寸，且文字被组织成形状（标题/正文/页脚分开）
  for (const slide of report.幻灯片) {
    assert.equal(slide.尺寸EMU.宽, 12192000);
    assert.equal(slide.版式.名称, 'DEFAULT');
    assert.equal(slide.版式.找不到, false);
  }
  const first = report.幻灯片[0];
  const roles = first.文字.map((shape) => shape.角色);
  assert.deepEqual(roles, ['标题', '正文', '页脚或来源']);
  assert.equal(first.文字[0].文字, '水从哪里来，又到哪里去？');
  assert.equal(first.文字[0].字号, 34);
  assert.equal(first.文字[0].加粗, true);
  assert.equal(first.文字[1].段落.length, 3, '正文段落应逐条读出');
  assert.match(first.文字[1].文字, /蒸发、凝结和降水/u);

  // 可读性硬底线（2026-09-12 起进入契约）：标题 ≥28pt、正文 ≥14pt、页脚 ≥11pt。
  // 全篇每一页都要成立，而不只是被抽样的这一页——2 行标题曾经掉到 24pt，
  // 那正是"投影上根本看不清"的来源。
  for (const slide of report.幻灯片) {
    for (const shape of slide.文字) {
      if (shape.字号 === null) continue;
      if (shape.角色 === '标题') assert.ok(shape.字号 >= 28, `标题字号 ${shape.字号}pt 低于 28pt 底线`);
      if (shape.角色 === '正文') assert.ok(shape.字号 >= 14, `正文字号 ${shape.字号}pt 低于 14pt 底线`);
      if (shape.角色 === '页脚或来源') assert.ok(shape.字号 >= 11, `页脚字号 ${shape.字号}pt 低于 11pt 底线`);
    }
  }

  // 备注来自 ppt/notesSlides/**
  assert.match(first.备注, /Slide ID: opening/u);
  assert.match(first.备注页部件, /^ppt\/notesSlides\/notesSlide\d+\.xml$/u);

  // 第 3 页：原生表格（存在与数量 + 行列）
  const tableSlide = report.幻灯片[2];
  assert.equal(tableSlide.表格.数量, 1);
  assert.equal(tableSlide.表格.条目[0].行数, 4);
  assert.equal(tableSlide.表格.条目[0].列数, 3);
  assert.deepEqual(tableSlide.表格.条目[0].首行, ['过程', '条件', '可观察证据']);
  assert.equal(tableSlide.图片.数量, 0);

  // 第 4 页：原生图表（真读 ppt/charts/chart1.xml 得到类型与标题）
  const chartSlide = report.幻灯片[3];
  assert.equal(chartSlide.图表.数量, 1);
  assert.equal(chartSlide.图表.条目[0].类型, 'barChart');
  assert.equal(chartSlide.图表.条目[0].类型名称, '柱状图');
  assert.equal(chartSlide.图表.条目[0].图表标题, '小组投票示例（票）');
  assert.match(chartSlide.图表.条目[0].部件, /^ppt\/charts\/chart\d+\.xml$/u);

  // 本样例没有页面图片：媒体目录为空（如实报告 0，不编造）
  assert.equal(report.媒体文件.数量, 0);
  assert.equal(report.上限.文件大小字节, MAX_INSPECT_BYTES);
  assert.equal(report.上限.页数, 200);

  // 只查一页
  const single = await inspectPresentationFile({ path: pptxPath, slide: 2 });
  assert.equal(single.页数, 6);
  assert.equal(single.检查页数, 1);
  assert.equal(single.仅检查页, 2);
  assert.match(single.幻灯片[0].文字[0].文字, /追踪一滴水/u);
});

test('改名的假 pptx：docx 与纯文本都被识别并明确报错，绝不返回“0 张幻灯片”', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const docxPath = join(root, '讲义.pptx');
  await renamedDocx(docxPath);
  await rejectCode(() => inspectPresentationFile({ path: docxPath }), 'PPTX_NOT_PRESENTATION');
  await assert.rejects(
    () => inspectPresentationFile({ path: docxPath }),
    (error) => /Word 文档/u.test(error.message) && !/0 张幻灯片/u.test(error.message),
  );

  const textPath = join(root, '课堂笔记.pptx');
  await writeFile(textPath, '这不是任何 Office 文件，只是改名成 .pptx 的文本。\n');
  await rejectCode(() => inspectPresentationFile({ path: textPath }), 'PPTX_NOT_ZIP');

  // 空文件同样不是合法 pptx
  const emptyPath = join(root, 'empty.pptx');
  await writeFile(emptyPath, '');
  await rejectCode(() => inspectPresentationFile({ path: emptyPath }), 'PPTX_NOT_ZIP');

  // 缺 ppt/presentation.xml 的 zip（用 Excel 包冒充）也必须是明确报错
  const spreadsheetPath = join(root, '表格.pptx');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook/>');
  await writeFile(spreadsheetPath, await zip.generateAsync({ type: 'nodebuffer' }));
  await assert.rejects(
    () => inspectPresentationFile({ path: spreadsheetPath }),
    (error) => error.code === 'PPTX_NOT_PRESENTATION' && /Excel 工作簿/u.test(error.message),
  );
});

test('大文件保护：超过大小上限 / 页数上限时如实拒绝，不假装读完', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const pptxPath = await realPptx(root);

  // 默认大小上限：造一个稀疏文件（不实际占盘）超过 64 MiB
  const hugePath = join(root, 'huge.pptx');
  const handle = await open(hugePath, 'w');
  await handle.truncate(MAX_INSPECT_BYTES + 1);
  await handle.close();
  await rejectCode(() => inspectPresentationFile({ path: hugePath }), 'PPTX_TOO_LARGE');
  await assert.rejects(
    () => inspectPresentationFile({ path: hugePath }),
    (error) => error.message.includes(String(MAX_INSPECT_BYTES + 1)) && /上限/u.test(error.message),
  );

  // 页数上限：真 6 页课件 + maxSlides=3 → 明确拒绝（并说明实际页数）
  const bytes = await readFile(pptxPath);
  await rejectCode(() => inspectPptxBuffer(bytes, { sourceName: '六页课件.pptx', limits: { maxSlides: 3 } }), 'PPTX_TOO_MANY_SLIDES');
  await assert.rejects(
    () => inspectPptxBuffer(bytes, { sourceName: '六页课件.pptx', limits: { maxSlides: 3 } }),
    (error) => /共 6 页/u.test(error.message) && /上限 3 页/u.test(error.message),
  );

  // 单部件上限（zip 炸弹第二道防线）：声明解压后过大时不解析
  await assert.rejects(
    () => inspectPptxBuffer(bytes, { sourceName: '六页课件.pptx', limits: { maxBytes: 1 } }),
    (error) => error.code === 'PPTX_TOO_LARGE',
  );

  // slide 越界
  await rejectCode(() => inspectPresentationFile({ path: pptxPath, slide: 7 }), 'INVALID_INPUT');
  await rejectCode(() => inspectPresentationFile({ path: pptxPath, slide: 0 }), 'INVALID_INPUT');
});

test('路径安全：越出允许根（绝对路径 / 符号链接）被拒，主目录与磁盘根不会被默认放开', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const pptxPath = await realPptx(workspace);
  const outside = join(root, 'outside');
  await mkdir(outside);
  const outsideFile = join(outside, 'sneaky.pptx');
  await writeFile(outsideFile, 'PK-not-really');

  const { entries } = await resolveInspectAllowedRoots({ options: { allowedRoots: [workspace] } });
  const guard = createInspectPathGuard(entries);

  // 允许根内的绝对路径与相对路径都可以
  assert.equal((await guard.resolve(pptxPath)).path, pptxPath);
  assert.equal((await guard.resolve('deck/presentation.pptx')).path, pptxPath);
  // 越界：绝对路径
  await rejectCode(() => guard.resolve(outsideFile), 'PATH_ESCAPE');
  await rejectCode(() => guard.resolve('/etc/hosts'), 'PATH_ESCAPE');
  await rejectCode(() => guard.resolve('../outside/sneaky.pptx'), 'PATH_ESCAPE');

  // 越界：符号链接指向允许根之外（真实磁盘先逃逸，再被 realpath 拦住）
  const linkPath = join(workspace, 'link.pptx');
  await symlink(outsideFile, linkPath);
  await rejectCode(() => guard.resolve(linkPath), 'PATH_ESCAPE');

  // 主目录不会被默认放开
  await rejectCode(() => resolveInspectAllowedRoots({ options: { allowedRoots: [homedir()] }, env: { ...process.env, HOME: homedir() } }), 'ROOT_UNAVAILABLE');
  // 磁盘根不会被放开
  await rejectCode(() => resolveInspectAllowedRoots({ options: { allowedRoots: ['/'] } }), 'ROOT_UNAVAILABLE');
  // 没有任何允许根时拒绝运行（显式注入空 env，避免测试机环境干扰）
  await rejectCode(() => resolveInspectAllowedRoots({ options: {}, env: {} }), 'WORKSPACE_UNAVAILABLE');
});

test('插件接线：ppt_inspect 已注册，能检查工作区内文件，并拒绝越界路径', { timeout: 60_000 }, async (t) => {
  const root = await rootFor(t);
  const pptxPath = await realPptx(root);

  const registered = new Map();
  const logs = [];
  const originalLog = console.log;
  console.log = (...values) => { logs.push(values.join(' ')); };
  try {
    apply({ tools: { register: (tool) => registered.set(tool.name, tool) } }, { allowedRoots: [root] });
  } finally {
    console.log = originalLog;
  }
  assert.equal(registered.has('ppt_inspect'), true);
  assert.ok(logs.some((line) => line.includes('ppt_inspect')), '启动日志应列出 ppt_inspect');

  const tool = registered.get('ppt_inspect');
  const report = await tool.execute({ path: pptxPath }, {});
  assert.equal(report.完成, true);
  assert.equal(report.页数, 6);
  assert.equal(report.幻灯片[2].表格.数量, 1);
  assert.match(String(report.提示), /mochi_ppt_revise/u);

  // 越界路径给出可执行的中文指引
  await assert.rejects(
    () => tool.execute({ path: '/etc/hosts' }, {}),
    (error) => /越出允许的根目录/u.test(error.message) && /ppt_inspect|PATH_ESCAPE/u.test(error.message),
  );
  await assert.rejects(() => tool.execute({ path: '' }, {}), (error) => /path/u.test(error.message));
  await assert.rejects(() => tool.execute({ path: pptxPath, slide: 0 }, {}), (error) => /正整数/u.test(error.message));

  // 路径不存在
  await assert.rejects(
    () => tool.execute({ path: join(root, 'nope.pptx') }, {}),
    (error) => /PPTX_NOT_FOUND/u.test(error.message),
  );
});

test('XML 解析器真解 OOXML：自闭合标签、命名空间前缀、实体解码、非法 XML 报错', () => {
  const document = parseXmlDocument('<?xml version="1.0"?>\n<!-- 注释 -->\n'
    + '<p:sld xmlns:p="urn:p" xmlns:r="urn:r" show="0">'
    + '<p:cSld name="第一页 &amp; 第二页"><p:spTree><p:sp><p:txBody>'
    + '<a:p><a:r><a:rPr sz="3000" b="1"/><a:t>项目符号 &#x2022; 与 &lt;尖括号&gt;</a:t></a:r></a:p>'
    + '</p:txBody></p:sp><p:pic/></p:spTree></p:cSld>'
    + '<p:sldId id="256" r:id="rId2"/></p:sld>');
  const pick = (node, ...locals) => locals.reduce((current, local) => {
    assert.ok(current, `解析树缺少 ${local}`);
    return current.children.find((child) => child.local === local);
  }, node);
  const slide = document.children[0];
  assert.equal(slide.name, 'p:sld', '保留命名空间前缀');
  assert.equal(slide.local, 'sld');
  assert.equal(slide.attrs.show, '0');
  assert.equal(pick(slide, 'cSld').attrs.name, '第一页 & 第二页', '属性值必须解实体');
  assert.equal(pick(slide, 'cSld', 'spTree', 'pic').children.length, 0, '自闭合标签不应有子节点');
  assert.equal(pick(slide, 'cSld', 'spTree', 'sp', 'txBody', 'p', 'r', 't').text, '项目符号 • 与 <尖括号>', '文本必须解实体');
  assert.equal(pick(slide, 'cSld', 'spTree', 'sp', 'txBody', 'p', 'r', 'rPr').attrs.sz, '3000', '自闭合标签仍要读属性');
  const sldId = pick(slide, 'sldId');
  assert.equal(sldId.attrs['r:id'], 'rId2', '同元素上的 id 与 r:id 必须区分');
  assert.equal(sldId.attrs.id, '256');
  assert.throws(() => parseXmlDocument('<a><b></a>'), (error) => error.code === 'XML_INVALID');
  assert.throws(() => parseXmlDocument('<a>'), (error) => error.code === 'XML_INVALID');
});

test('真 .pptx 里的图片：按 p:pic 计数并列出媒体部件（不提取图像二进制）', { timeout: 60_000 }, async (t) => {
  const root = await rootFor(t);
  const { default: pptxgen } = await import('pptxgenjs');
  const pptx = new pptxgen();
  const slide = pptx.addSlide();
  slide.addText('带图的一页', { x: 0.5, y: 0.4, w: 6, h: 0.8 });
  slide.addImage({
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    x: 1, y: 1.6, w: 2, h: 2,
  });
  const imagePath = join(root, 'with-image.pptx');
  await pptx.writeFile({ fileName: imagePath, compression: true });

  const report = await inspectPresentationFile({ path: imagePath });
  assert.equal(report.页数, 1);
  assert.equal(report.幻灯片[0].图片.数量, 1);
  assert.match(report.幻灯片[0].图片.条目[0].部件, /^ppt\/media\/.+\.png$/u);
  assert.equal(report.幻灯片[0].图片.条目[0].扩展名, 'png');
  assert.equal(report.幻灯片[0].图片.条目[0].外部链接, false);
  assert.equal(report.媒体文件.数量 >= 1, true);
  assert.equal(report.媒体文件.条目.some((entry) => entry.扩展名 === 'png'), true);
  // 只报告存在与数量，不提取二进制
  assert.equal(Object.prototype.hasOwnProperty.call(report.幻灯片[0].图片.条目[0], '数据'), false);
});

test('只读检查不修改文件：检查前后字节与 sha256 完全一致', { timeout: 30_000 }, async (t) => {
  const root = await rootFor(t);
  const pptxPath = await realPptx(root);
  const before = await readFile(pptxPath);
  const beforeStat = await lstat(pptxPath);
  await inspectPresentationFile({ path: pptxPath });
  const after = await readFile(pptxPath);
  const afterStat = await lstat(pptxPath);
  assert.equal(before.equals(after), true);
  assert.equal(afterStat.size, beforeStat.size);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
});

// 回归：老师**上传**的课件必须检查得动（2026-09-12「上传的 Word 打不开」同类缺陷）。
//
// 宿主把上传原件按 verbatim 存到 `<DSH_HOME>/attachments/v1/files/<digest 前缀>/<digest>/<name>`，
// 该位置不在会话工作区里。修法是把附件盘作为**追加**只读根接进来——
// 刻意不做成"兜底"：没有任何主根时仍然照旧抛 WORKSPACE_UNAVAILABLE，
// 不会因为恰好存在一个附件盘就凭空获得读取能力。
test('ppt_inspect 的允许根会追加宿主附件盘，且不会在无主根时凭空放行', { timeout: 60_000 }, async (t) => {
  const root = await rootFor(t);
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const home = join(root, 'home');
  const referenceDir = join(home, 'attachments', 'v1', 'files', 'cd', 'cdef01234567890');
  await mkdir(referenceDir, { recursive: true });
  const uploaded = join(referenceDir, '上传的课件.pptx');
  await writeFile(uploaded, await readFile(await realPptx(workspace)));

  const previous = { DSH_HOME: process.env.DSH_HOME, MOCHI_HOME: process.env.MOCHI_HOME };
  process.env.DSH_HOME = home;
  delete process.env.MOCHI_HOME;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const resolved = await resolveInspectAllowedRoots({
    options: { allowedRoots: [workspace] },
    env: { ...process.env, HOME: home },
  });
  const guard = createInspectPathGuard(resolved.entries);
  // 修好之前这一步会抛 PATH_ESCAPE（老师看到的就是"上传的课件打不开"）。
  assert.equal((await guard.resolve(uploaded)).path, uploaded);

  // 附件盘之外依旧拒绝。
  const outside = join(root, 'outside');
  await mkdir(outside);
  const stranger = join(outside, 'sneaky.pptx');
  await writeFile(stranger, 'PK-not-really');
  await rejectCode(() => guard.resolve(stranger), 'PATH_ESCAPE');
  await rejectCode(() => guard.resolve('/etc/hosts'), 'PATH_ESCAPE');

  // 没有任何主根时，附件盘的存在不会把 WORKSPACE_UNAVAILABLE 变成"能跑"。
  await rejectCode(() => resolveInspectAllowedRoots({ options: {}, env: {} }), 'WORKSPACE_UNAVAILABLE');
});
