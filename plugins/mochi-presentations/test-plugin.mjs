// mochi-presentations 插件接线测试（MOCHI-P2-TS-02）
// 运行：node test-plugin.mjs
// 覆盖：① 工具注册 ② create 5 页真 .pptx ③ Golden Demo（revise 第 3 页，
// 其余页 slide XML 与旧版逐字节一致）④ 目录已存在 / 页码越界明确报错 ⑤ render 双参签名回归。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

import { apply, output } from './plugin.mjs';

// jszip 是 pptxgenjs 的传递依赖、也是本插件 devDependency，直接 import 即可
// （已验证可从本插件 node_modules 解析，无需 node:zlib 手动解压回退）。

let root;
try {
  root = await mkdtemp(join(tmpdir(), 'mochi-ppt-plugin-'));
  const registered = new Map();
  apply({ tools: { register(tool) { registered.set(tool.name, tool); } } });

  console.log('① 两工具注册正确 + render 签名回归（双参，大坑 17）');
  assert.equal(registered.has('mochi.ppt_create'), true);
  assert.equal(registered.has('mochi.ppt_revise'), true);
  const rendered = output.render({ some: 'args' }, { real: 'result' });
  assert.ok(rendered[0].text.includes('result'), 'render 第二参数才是工具返回值');
  assert.ok(!rendered[0].text.includes('some'), 'render 不得把第一参数当结果');

  const create = registered.get('mochi.ppt_create').execute;
  const revise = registered.get('mochi.ppt_revise').execute;

  console.log('② create 5 页课件 → 真 .pptx 生成成功');
  const slides = [
    { heading: '班会开场', bullets: ['本学期目标：养成三个好习惯', '说明今天的班会流程'] },
    { heading: '班级公约回顾', bullets: ['按时到校', '值日轮换', '作业按时交'] },
    { heading: '课堂讨论', bullets: ['用自己的话解释云的形成', '举出生活中的一个蒸发现象'] },
    { heading: '活动安排', bullets: ['分组名单见黑板', '每组准备一句话发言'] },
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

  console.log('④ 新输出目录已存在 / 页码越界 → 明确报错，不覆盖');
  await mkdir(join(root, 'reserved'));
  await assert.rejects(
    () => create({ title: '重复目录', slides, outputDirectory: join(root, 'reserved') }, {}),
    (error) => /已存在/.test(error.message),
  );
  await assert.rejects(
    () => revise({ previousSourcePath: v1.sourcePath, page: 6, instruction: '越界页', newBody: ['x'], outputDirectory: join(root, 'v3') }, {}),
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

  console.log('⑤ 全部通过：注册 / create / Golden Demo 逐字节一致 / 报错路径 / render 双参');
  console.log('ALL GREEN');
} finally {
  if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
}
