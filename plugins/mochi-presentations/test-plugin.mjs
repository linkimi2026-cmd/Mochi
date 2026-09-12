// mochi-presentations 插件接线测试（MOCHI-P2-TS-02）
// 运行：MOCHI_PRESENTATIONS_PLUGIN_URL=/absolute/staged/plugin.mjs node test-plugin.mjs
// 覆盖：① alpha 根依赖下三工具注册（含 ppt_inspect）② create 5 页真 .pptx（含原生图表）
// ③ Golden Demo（revise 第 3 页，其余页 slide XML 与旧版逐字节一致）
// ④ 定页图表修订 ⑤ 目录已存在 / 页码越界明确报错 ⑥ ppt_inspect 只读检查与报错路径
// ⑦ render 双参签名回归。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const stagedPlugin = String(process.env.MOCHI_PRESENTATIONS_PLUGIN_URL || '').trim();
if (!stagedPlugin) throw new Error('MOCHI_PRESENTATIONS_PLUGIN_URL 必须指向 alpha 资源目录中已打包的 mochi-presentations/plugin.mjs。');
const { apply, output } = await import(pathToFileURL(resolve(stagedPlugin)).href);

// jszip 是 pptxgenjs 的传递依赖、也是本插件 devDependency，直接 import 即可
// （已验证可从本插件 node_modules 解析，无需 node:zlib 手动解压回退）。

let root;
try {
  root = await mkdtemp(join(tmpdir(), 'mochi-ppt-plugin-'));
  const registered = new Map();
  apply({ tools: { register(tool) { registered.set(tool.name, tool); } } }, { allowedRoots: [root] });

  console.log('① 三工具注册正确 + render 签名回归（双参，大坑 17）');
  assert.equal(registered.has('mochi_ppt_create'), true);
  assert.equal(registered.has('mochi_ppt_revise'), true);
  assert.equal(registered.has('ppt_inspect'), true);
  const rendered = output.render({ some: 'args' }, { real: 'result' });
  assert.ok(rendered[0].text.includes('result'), 'render 第二参数才是工具返回值');
  assert.ok(!rendered[0].text.includes('some'), 'render 不得把第一参数当结果');

  const create = registered.get('mochi_ppt_create').execute;
  const revise = registered.get('mochi_ppt_revise').execute;
  const inspect = registered.get('ppt_inspect').execute;

  console.log('② alpha 根依赖下 create 5 页课件（含原生图表）→ 真 .pptx 生成成功');
  const slides = [
    { heading: '班会开场', bullets: ['本学期目标：养成三个好习惯', '说明今天的班会流程'] },
    { heading: '班级公约回顾', bullets: ['按时到校', '值日轮换', '作业按时交'] },
    { heading: '课堂讨论', bullets: ['用自己的话解释云的形成', '举出生活中的一个蒸发现象'] },
    { heading: '活动安排', bullets: ['以下为课堂讨论示例数据，不代表本班真实调查。', '每组根据图表选择一项行动。'], chart: { type: 'bar', title: '行动选择示例', labels: ['关水', '一水多用', '修漏'], series: [{ name: '示例票数', values: [12, 9, 6] }] } },
    { heading: '总结与作业', bullets: ['完成观察记录表', '明天课前上交'] },
  ];
  const v1 = await create({ title: '九一班班会课件', slides, outputDirectory: join(root, 'v1') }, {});
  assert.equal(v1.完成, true);
  assert.equal(v1.页数, 5);
  const pptxBytes = await readFile(v1.产物.pptx);
  assert.equal(pptxBytes.subarray(0, 2).toString('latin1'), 'PK', '产物必须是真 .pptx（ZIP 容器）');
  await readFile(v1.产物.pdf); // 同源 PDF 随包生成
  await readFile(v1.产物.manifest);

  async function slideXmls(pptxPath, count) {
    const archive = await JSZip.loadAsync(await readFile(pptxPath));
    const buffers = [];
    for (let number = 1; number <= count; number += 1) {
      buffers.push(await archive.file(`ppt/slides/slide${number}.xml`).async('nodebuffer'));
    }
    return buffers;
  }
  const oldXmls = await slideXmls(v1.产物.pptx, 5);
  const firstArchive = await JSZip.loadAsync(pptxBytes);
  assert.ok(firstArchive.file('ppt/charts/chart1.xml'), '第 4 页必须生成原生 Office 图表 OOXML');
  assert.ok(firstArchive.file('ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx'), '原生图表必须携带可编辑数据工作簿');

  console.log('③ Golden Demo：revise 第 3 页 → 新内容生效，其余页 slide XML 逐字节一致');
  const v2 = await revise({
    previousSourcePath: v1.sourcePath,
    page: 3,
    instruction: '把课堂讨论改成小组任务并加一条展示要求',
    newBody: ['小组任务：每组认领一个水循环环节', '画出环节示意图', '两分钟后上台展示'],
    outputDirectory: join(root, 'v2'),
  }, {});
  assert.equal(v2.完成, true);
  assert.equal(v2.修改页, 3);
  const newXmls = await slideXmls(v2.产物.pptx, 5);
  const slide3 = newXmls[2].toString('utf8');
  assert.match(slide3, /小组任务/, 'slide3 XML 必须包含新内容');
  for (const number of [1, 2, 4, 5]) {
    assert.ok(
      newXmls[number - 1].equals(oldXmls[number - 1]),
      `slide${number} XML 必须与旧版逐字节一致`,
    );
  }
  assert.ok(!newXmls[2].equals(oldXmls[2]), 'slide3 XML 必须发生变化');
  assert.match(String(v2.核验结论), /逐字节一致/);
  assert.deepEqual(v2.未改动页, [1, 2, 4, 5]);
  const v2Pptx = await readFile(v2.产物.pptx);
  assert.equal(v2Pptx.subarray(0, 2).toString('latin1'), 'PK', '修订产物同样必须是真 .pptx');

  console.log('④ revise 第 4 页原生图表 → 图表 OOXML 更新，其他页 slide XML 逐字节一致');
  const v3 = await revise({
    previousSourcePath: v2.sourcePath,
    page: 4,
    instruction: '将示例投票更新为第二轮讨论结果',
    newChart: { type: 'bar', title: '第二轮行动选择示例', labels: ['关水', '一水多用', '修漏'], series: [{ name: '示例票数', values: [14, 10, 8] }] },
    outputDirectory: join(root, 'v3'),
  }, {});
  assert.equal(v3.完成, true);
  assert.match(String(v3.核验结论), /原生图表 OOXML/);
  const v2Xmls = await slideXmls(v2.产物.pptx, 5);
  const v3Xmls = await slideXmls(v3.产物.pptx, 5);
  for (const number of [1, 2, 3, 5]) assert.ok(v3Xmls[number - 1].equals(v2Xmls[number - 1]), `slide${number} 必须与 v2 逐字节一致`);
  const [v2Zip, v3Zip] = await Promise.all([JSZip.loadAsync(await readFile(v2.产物.pptx)), JSZip.loadAsync(await readFile(v3.产物.pptx))]);
  const v2ChartName = Object.keys(v2Zip.files).find((name) => /^ppt\/charts\/chart\d+\.xml$/u.test(name));
  const v3ChartName = Object.keys(v3Zip.files).find((name) => /^ppt\/charts\/chart\d+\.xml$/u.test(name));
  assert.ok(v2ChartName);
  assert.ok(v3ChartName);
  const [v2ChartXml, v3ChartXml] = await Promise.all([
    v2Zip.file(v2ChartName).async('text'),
    v3Zip.file(v3ChartName).async('text'),
  ]);
  assert.match(v3ChartXml, /第二轮行动选择示例/);
  assert.notEqual(v2ChartXml, v3ChartXml);

  console.log('⑤ 新输出目录已存在 / 页码越界 → 明确报错，不覆盖');
  await mkdir(join(root, 'reserved'));
  await assert.rejects(
    () => create({ title: '重复目录', slides, outputDirectory: join(root, 'reserved') }, {}),
    (error) => /已存在/.test(error.message),
  );
  await assert.rejects(
    () => revise({ previousSourcePath: v1.sourcePath, page: 6, instruction: '越界页', newBody: ['x'], outputDirectory: join(root, 'out-of-range') }, {}),
    (error) => /共 5 页/.test(error.message) && /1-5/.test(error.message),
  );
  await assert.rejects(
    () => revise({ previousSourcePath: v1.sourcePath, page: 0, instruction: '非法页码', newBody: ['x'], outputDirectory: join(root, 'v4') }, {}),
    (error) => /正整数/.test(error.message),
  );
  await assert.rejects(
    () => revise({ previousSourcePath: join(root, 'no-such', 'source.json'), page: 1, instruction: '坏路径', newBody: ['x'], outputDirectory: join(root, 'v5') }, {}),
    (error) => /previousSourcePath/.test(error.message),
  );

  console.log('⑥ ppt_inspect 只读检查：真 .pptx 读出 5 页结构；越界路径与改名假 pptx 明确报错');
  const inspected = await inspect({ path: v1.产物.pptx }, {});
  assert.equal(inspected.tool, 'ppt_inspect');
  assert.equal(inspected.文件.真pptx, true);
  assert.equal(inspected.页数, 5);
  assert.equal(inspected.幻灯片[3].图表.数量, 1, '第 4 页图表必须被读到');
  assert.equal(inspected.幻灯片[3].图表.条目[0].类型, 'barChart');
  assert.equal(inspected.幻灯片[0].版式.名称, 'DEFAULT');
  await assert.rejects(
    () => inspect({ path: '/etc/hosts' }, {}),
    (error) => /越出允许的根目录/.test(error.message),
  );
  await assert.rejects(
    () => inspect({ path: join(root, 'no-such-deck.pptx') }, {}),
    (error) => /PPTX_NOT_FOUND/.test(error.message),
  );
  const fakePptx = join(root, 'fake.pptx');
  await writeFile(fakePptx, Buffer.from('PK\u0003\u0004 这不是 zip，只是改名'));
  await assert.rejects(
    () => inspect({ path: fakePptx }, {}),
    (error) => /PPTX_NOT_ZIP/.test(error.message) && !/0 张幻灯片/.test(error.message),
  );

  console.log('⑦ 全部通过：alpha 根解析 / 原生图表 / Golden Demo 定页修订 / ppt_inspect / 报错路径 / render 双参');
  console.log('ALL GREEN');
} finally {
  if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
}
