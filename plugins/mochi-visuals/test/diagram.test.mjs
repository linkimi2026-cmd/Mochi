// mochi-visuals · diagram_draw 的单元测试与端到端测试。
//
// 重点：
//   * SVG 是唯一几何数据源：SVG 里必须真的有 <svg> 根元素、标题、类目标签、数值、
//     刻度与单位；PNG 必须由同一份几何数据光栅化而来（像素尺寸 = SVG 尺寸 × pngScale）。
//   * 非法输入必须抛错，绝不画出一张「看起来像那么回事」的错图。
//   * 需要光栅化的用例经 requireCanvas() 进入；canvas 不可用时 t.skip()。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildAxisTicks, DIAGRAM_TYPES, escapeXml, layeredLevels, renderDiagramSvg } from '../diagram.mjs';
import { probeImageFile } from '../image-meta.mjs';
import { resolveDiagramFont } from '../fonts.mjs';
import { countInk, expectFailure, makeWorkspace, readPixelSize, requireCanvas, tool } from './helpers.mjs';

test('diagram 单元：buildAxisTicks 取整数刻度、不含浮点垃圾', () => {
  assert.deepEqual(buildAxisTicks(0, 19).ticks, [0, 5, 10, 15, 20]);
  assert.deepEqual(buildAxisTicks(0, 7).ticks, [0, 2, 4, 6, 8]);
  assert.deepEqual(buildAxisTicks(0, 100).ticks, [0, 25, 50, 75, 100]);
  // 负值区间：按 nice-number 扩到 5 的倍数
  assert.deepEqual(buildAxisTicks(-12, 8).ticks, [-15, -10, -5, 0, 5, 10]);
  // 全零不能退化成 [0,0]
  const flat = buildAxisTicks(0, 0);
  assert.ok(flat.max > flat.min && flat.ticks.length >= 2, `全零数据也应得到有效刻度：${JSON.stringify(flat)}`);
  // 刻度值必须是干净的有限数字
  for (const tick of buildAxisTicks(-3.3, 91.7).ticks) {
    assert.equal(Number.isFinite(tick), true);
    assert.equal(tick, Math.round(tick * 1e6) / 1e6);
  }
});

test('diagram 单元：escapeXml 挡住会破坏 SVG 的字符', () => {
  assert.equal(escapeXml('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
  const svg = renderDiagramSvg({ type: 'bar', title: 'A<B & "C"', data: [{ label: '甲', value: 3 }] }).svg;
  assert.ok(svg.startsWith('<svg'), 'SVG 必须以 <svg 开头');
  assert.ok(svg.includes('aria-label="A&lt;B &amp; &quot;C&quot;"'), '标题必须转义后写入 aria-label');
  assert.equal(svg.includes('<B & "C"'), false, '未转义的标题不能出现在 SVG 里');
});

test('diagram 单元：流程图分层忽略回边，环上节点各归其层（回归用例）', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => ({ id, label: id }));
  const edges = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' },
    { from: 'd', to: 'e' }, { from: 'e', to: 'f' }, { from: 'e', to: 'g' },
    { from: 'f', to: 'h' }, { from: 'g', to: 'h' },
    { from: 'h', to: 'c' }, // 回边，构成 c→d→e→f→h→c 的环
  ];
  const { level, cyclic, backEdgeCount } = layeredLevels(nodes, edges);
  assert.deepEqual(
    Object.fromEntries(nodes.map((node) => [node.id, level.get(node.id)])),
    { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 5, h: 6 },
    '环上的节点不能全被压到同一层',
  );
  assert.equal(backEdgeCount, 1);
  assert.deepEqual(cyclic.map((node) => node.id).sort(), ['c', 'h']);

  // 自环被忽略，不影响分层
  const selfLoop = layeredLevels([{ id: 'x' }, { id: 'y' }], [{ from: 'x', to: 'x' }, { from: 'x', to: 'y' }]);
  assert.equal(selfLoop.level.get('y'), 1);
});

test('diagram_draw：SVG 里确实有 <svg>、标题、类目、数值、刻度与单位', async (t) => {
  // 这个用例覆盖 SVG + PNG 两端（默认 formats 是 ["svg","png"]），所以要真的能光栅化。
  const canvas = await requireCanvas(t);
  if (!canvas) return;
  const { root, outputRoot, ctx } = makeWorkspace(t);
  const result = await draw(ctx, {
    type: 'bar',
    title: '各小组实验数据',
    subtitle: '八年级（2）班',
    unit: '℃',
    data: [{ label: '甲组', value: 12 }, { label: '乙组', value: 19 }, { label: '丙组', value: 7 }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.类型, 'bar');
  assert.equal(result.数据点或节点数, 3);
  assert.deepEqual(result.类目, ['甲组', '乙组', '丙组']);
  assert.deepEqual(result.序列, ['数值']);
  assert.deepEqual(Object.keys(result.产物).sort(), ['PNG', 'SVG']);

  const svgPath = result.产物.SVG.路径;
  assert.ok(svgPath.startsWith(outputRoot) || svgPath.includes('Mochi Visuals'), `SVG 应落在受管输出目录：${svgPath}`);
  const svg = readFileSync(svgPath, 'utf8');

  assert.ok(svg.includes('<svg'), 'SVG 必须含 <svg 根元素');
  assert.ok(svg.includes('</svg>'), 'SVG 必须闭合');
  assert.ok(svg.includes('viewBox="0 0 '), 'SVG 必须有 viewBox');
  assert.ok(svg.includes('aria-label="各小组实验数据"'), '标题应写进 aria-label');
  // 标题、副标题、类目、数值、单位、刻度
  for (const needle of ['各小组实验数据', '八年级（2）班', '甲组', '乙组', '丙组', '12℃', '19℃', '7℃']) {
    assert.ok(svg.includes(needle), `SVG 里应出现「${needle}」`);
  }
  // 由同一份 nice-number 算法推出的刻度必须真的画出来（0/5/10/15/20 + 单位）
  for (const tick of buildAxisTicks(0, 19).ticks) {
    assert.ok(svg.includes(`${tick}℃`), `SVG 里应出现刻度「${tick}℃」`);
  }
  // 直角坐标系的网格线 / 坐标轴：至少要有若干条 stroke 线
  assert.ok((svg.match(/<line/g) ?? []).length >= 4, '柱状图应画出坐标轴与网格线');
  assert.equal(result.产物.SVG.回读校验.含svg根元素, true);
  assert.equal(result.产物.SVG.回读校验.含标题文字, true);

  // 单序列不画图例（没有对比对象），多序列必须画图例
  assert.equal(svg.includes('数值'), false, '单序列柱状图不应出现图例项');
  const grouped = await draw(ctx, {
    type: 'bar',
    title: '分组对比',
    data: [
      { label: '甲组', value: 12, series: '实验组' },
      { label: '甲组', value: 9, series: '对照组' },
      { label: '乙组', value: 15, series: '实验组' },
      { label: '乙组', value: 11, series: '对照组' },
    ],
  });
  const groupedSvg = readFileSync(grouped.产物.SVG.路径, 'utf8');
  assert.ok(groupedSvg.includes('实验组') && groupedSvg.includes('对照组'), '多序列柱状图必须有图例');
  assert.equal(grouped.序列.length, 2);
});

test('diagram_draw：PNG 来自同一份几何数据，像素尺寸 = SVG 尺寸 × pngScale', async (t) => {
  const canvas = await requireCanvas(t);
  if (!canvas) return;
  const { ctx } = makeWorkspace(t);

  const one = await draw(ctx, {
    type: 'line',
    title: '温度随时间变化',
    unit: '℃',
    pngScale: 1,
    data: { labels: ['8:00', '10:00', '12:00'], series: [{ name: '实验组', data: [18, 24, 31] }, { name: '对照组', data: [17, 21, 25] }] },
  });
  const three = await draw(ctx, {
    type: 'line',
    title: '温度随时间变化',
    unit: '℃',
    pngScale: 3,
    data: { labels: ['8:00', '10:00', '12:00'], series: [{ name: '实验组', data: [18, 24, 31] }, { name: '对照组', data: [17, 21, 25] }] },
  });

  // SVG 文件本身不受 pngScale 影响（矢量尺寸恒定）
  assert.equal(one.产物.SVG.尺寸, three.产物.SVG.尺寸, 'pngScale 不应影响 SVG 的逻辑尺寸');
  assert.equal(one.产物.PNG.缩放倍数, 1);
  assert.equal(three.产物.PNG.缩放倍数, 3);

  const [svgWidth, svgHeight] = one.产物.SVG.尺寸.split('×').map(Number);
  const [oneWidth, oneHeight] = one.产物.PNG.尺寸.split('×').map(Number);
  const [threeWidth, threeHeight] = three.产物.PNG.尺寸.split('×').map(Number);
  assert.deepEqual([oneWidth, oneHeight], [svgWidth, svgHeight], 'pngScale=1 时 PNG 与 SVG 同尺寸');
  assert.deepEqual([threeWidth, threeHeight], [svgWidth * 3, svgHeight * 3], 'pngScale=3 时 PNG 是 SVG 的 3 倍');

  // 三方交叉校验：canvas 读回的像素尺寸、独立文件头解析、工具自报尺寸必须一致
  assert.deepEqual(await readPixelSize(canvas, one.产物.PNG.路径), { width: svgWidth, height: svgHeight });
  assert.deepEqual(await readPixelSize(canvas, three.产物.PNG.路径), { width: svgWidth * 3, height: svgHeight * 3 });
  const head = await probeImageFile(three.产物.PNG.路径);
  assert.deepEqual({ format: head.format, width: head.width, height: head.height }, { format: 'png', width: svgWidth * 3, height: svgHeight * 3 });

  // PNG 必须真的画了东西，而不是一张白纸
  const ink = await countInk(canvas, three.产物.PNG.路径);
  assert.ok(ink.ink > 500, `PNG 里应画出坐标轴/文字/线条，实际非白像素 ${ink.ink}`);
  assert.ok(ink.ink < ink.total * 0.9, `PNG 不应整片被填满，实际 ${ink.ink}/${ink.total}`);

  // 双序列折线：图例与两条折线都要在 SVG 里
  const svg = readFileSync(one.产物.SVG.路径, 'utf8');
  assert.ok(svg.includes('实验组') && svg.includes('对照组'), '多序列必须有图例');
  assert.ok((svg.match(/<polyline/g) ?? []).length >= 2, '双序列应画两条折线');
});

test('diagram_draw：formats 只出 SVG 时不写 PNG；饼图/流程图/关系图各自成图', async (t) => {
  // 饼图/流程图/关系图都用默认 formats（svg+png），需要能光栅化。
  const canvas = await requireCanvas(t);
  if (!canvas) return;
  const { ctx } = makeWorkspace(t);

  const svgOnly = await draw(ctx, {
    type: 'bar',
    title: '只出矢量',
    formats: ['svg'],
    data: [{ label: '甲', value: 2 }],
  });
  assert.deepEqual(Object.keys(svgOnly.产物), ['SVG']);
  assert.equal(svgOnly.产物.SVG.路径.endsWith('.svg'), true);

  const pie = await draw(ctx, {
    type: 'pie',
    title: '能量来源占比',
    data: [{ label: '光合作用', value: 45 }, { label: '呼吸作用', value: 55 }],
  });
  const pieSvg = readFileSync(pie.产物.SVG.路径, 'utf8');
  assert.ok(pieSvg.includes('<path'), '饼图必须用 <path> 画扇区');
  assert.ok(pieSvg.includes('45%') && pieSvg.includes('55%'), '饼图应标注百分比');
  assert.ok(pieSvg.includes('光合作用') && pieSvg.includes('呼吸作用'), '饼图应有图例');

  const flow = await draw(ctx, {
    type: 'flowchart',
    title: '探究流程',
    direction: 'vertical',
    nodes: [
      { id: 'a', label: '提出问题', shape: 'start' },
      { id: 'b', label: '作出假设' },
      { id: 'c', label: '实验是否成立？', shape: 'decision' },
      { id: 'd', label: '得出结论', shape: 'end' },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd', label: '是' },
      { from: 'c', to: 'b', label: '否' },
    ],
  });
  assert.equal(flow.数据点或节点数, 4);
  const flowSvg = readFileSync(flow.产物.SVG.路径, 'utf8');
  for (const needle of ['提出问题', '作出假设', '实验是否成立？', '得出结论', '是', '否']) {
    assert.ok(flowSvg.includes(needle), `流程图里应出现「${needle}」`);
  }
  assert.ok(flowSvg.includes('<marker'), '流程图连线应有箭头');
  assert.ok(flowSvg.includes('<path'), 'decision 形状应画成 path（菱形）');
  assert.ok(/<rect[^>]*rx="\d\d/.test(flowSvg), 'start/end 形状应是圆角胶囊');

  // 流程图允许自环（画成从右侧绕回顶部的一条回路），不应报错
  const loop = await draw(ctx, {
    type: 'flowchart',
    title: '带自环的流程',
    nodes: [{ id: 'r', label: '重新实验' }, { id: 'n', label: '记录数据' }],
    edges: [{ from: 'r', to: 'n' }, { from: 'r', to: 'r', label: '重做' }],
  });
  const loopSvg = readFileSync(loop.产物.SVG.路径, 'utf8');
  assert.ok(loopSvg.includes('重做'), '自环的边标签也要画出来');
  assert.ok(loopSvg.includes('<path'), '自环应画成一条回路 path');

  const rel = await draw(ctx, {
    type: 'relationship',
    title: '光合作用与呼吸作用',
    center: 'x',
    nodes: [
      { id: 'x', label: '绿色植物' },
      { id: 'y', label: '光合作用', group: '合成' },
      { id: 'z', label: '呼吸作用', group: '分解' },
    ],
    edges: [{ from: 'x', to: 'y', label: '白天' }, { from: 'x', to: 'z', label: '昼夜' }],
  });
  const relSvg = readFileSync(rel.产物.SVG.路径, 'utf8');
  for (const needle of ['绿色植物', '光合作用', '呼吸作用', '白天', '昼夜']) {
    assert.ok(relSvg.includes(needle), `关系图里应出现「${needle}」`);
  }
});

test('diagram_draw：中文字体缺失时的诚实降级（PNG 拒绝、SVG 照常）', async (t) => {
  const { ctx } = makeWorkspace(t);
  const font = await resolveDiagramFont();
  const request = {
    type: 'bar',
    title: '光的折射实验',
    unit: '℃',
    data: [{ label: '甲组', value: 12 }],
  };

  if (font.rasterFamily) {
    const result = await draw(ctx, request);
    assert.equal(Object.keys(result.产物).length, 2);
    assert.equal(result.使用字体.光栅化字族, font.rasterFamily);
  } else {
    // 本机光栅化引擎画不出简体中文：PNG 必须被拒绝，而不是交付一张方框图
    await expectFailure(draw(ctx, request), 'CJK_FONT_UNAVAILABLE', '中文 PNG 应被拒绝');
    const svgOnly = await draw(ctx, { ...request, formats: ['svg'] });
    assert.deepEqual(Object.keys(svgOnly.产物), ['SVG']);
    assert.ok(readFileSync(svgOnly.产物.SVG.路径, 'utf8').includes('光的折射实验'));
    t.diagnostic(`本机 rasterFamily 为 null（${font.notes.join('')}），中文 PNG 用例按「拒绝生成」验证；真机需复验。`);
  }

  // 纯 ASCII 图表不应受中文字体影响
  const ascii = await draw(ctx, { type: 'bar', title: 'ASCII only', formats: ['svg'], data: [{ label: 'A', value: 1 }] });
  assert.deepEqual(Object.keys(ascii.产物), ['SVG']);
});

test('diagram_draw：非法输入直接报错，且不留下任何产物（负向对照）', async (t) => {
  const { outputRoot, ctx } = makeWorkspace(t);

  await expectFailure(draw(ctx, { type: 'scatter', title: 'x' }), ['INVALID_ARGS', 'BAD_ARGUMENT'], '未知 type');
  await expectFailure(draw(ctx, { type: 'bar', title: '' }), 'BAD_ARGUMENT', '空标题');
  await expectFailure(draw(ctx, { type: 'bar', title: 'x', data: [] }), 'BAD_DATA', '空数据');
  await expectFailure(draw(ctx, { type: 'bar', title: 'x', data: [{ label: '甲', value: '不是数字' }] }), 'BAD_DATA', '非数字值');
  await expectFailure(draw(ctx, { type: 'bar', title: 'x', data: 'nonsense' }), 'BAD_DATA', 'data 结构错误');
  await expectFailure(draw(ctx, { type: 'pie', title: 'x', data: [{ label: '甲', value: -5 }, { label: '乙', value: 5 }] }), 'BAD_DATA', '饼图负数');
  await expectFailure(draw(ctx, { type: 'pie', title: 'x', data: [{ label: '甲', value: 0 }, { label: '乙', value: 0 }] }), 'BAD_DATA', '饼图合计为 0');
  await expectFailure(
    draw(ctx, { type: 'flowchart', title: 'x', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: '不存在的节点' }] }),
    'BAD_DATA',
    '边指向不存在的节点',
  );
  await expectFailure(
    draw(ctx, { type: 'flowchart', title: 'x', nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }),
    'BAD_DATA',
    '节点 id 重复',
  );
  await expectFailure(
    draw(ctx, { type: 'relationship', title: 'x', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'a' }] }),
    'BAD_DATA',
    '关系图自环',
  );
  await expectFailure(
    draw(ctx, { type: 'relationship', title: 'x', nodes: [{ id: 'a', label: 'A' }], center: '不存在' }),
    'BAD_ARGUMENT',
    'center 指向不存在节点',
  );
  await expectFailure(draw(ctx, { type: 'bar', title: 'x', pngScale: 9, data: [{ label: '甲', value: 1 }] }), 'BAD_ARGUMENT', 'pngScale 越界');
  await expectFailure(draw(ctx, { type: 'bar', title: 'x', width: 100, data: [{ label: '甲', value: 1 }] }), 'BAD_ARGUMENT', '画布过小');
  await expectFailure(draw(ctx, { type: 'bar', title: 'x', formats: [], data: [{ label: '甲', value: 1 }] }), 'BAD_ARGUMENT', 'formats 空数组');
  await expectFailure(draw(ctx, { type: 'bar', title: 'x', formats: ['gif'], data: [{ label: '甲', value: 1 }] }), 'BAD_ARGUMENT', 'formats 非法');
  await expectFailure(
    draw(ctx, { type: 'bar', title: 'x', outputDirectory: '../逃逸目录', data: [{ label: '甲', value: 1 }] }),
    'PATH_ESCAPE',
    '输出目录越界',
  );

  assert.deepEqual(readdirSync(outputRoot), [], '所有失败的调用都不应该写出任何产物');
});

test('diagram_draw：DIAGRAM_TYPES 与导出的类型集合一致', () => {
  assert.deepEqual(DIAGRAM_TYPES, ['bar', 'line', 'pie', 'flowchart', 'relationship']);
  for (const type of DIAGRAM_TYPES) {
    const spec = type === 'pie'
      ? { type, title: 't', data: [{ label: 'a', value: 1 }] }
      : type === 'flowchart' || type === 'relationship'
        ? { type, title: 't', nodes: [{ id: 'a', label: 'A' }], edges: [] }
        : { type, title: 't', data: [{ label: 'a', value: 1 }] };
    const svg = renderDiagramSvg(spec).svg;
    assert.ok(svg.includes('<svg') && svg.includes('</svg>'), `${type} 应生成合法 SVG`);
  }
});

function draw(ctx, args) {
  return tool(ctx, 'diagram_draw').execute(args, {});
}
