// mochi-visuals · 工具注册、路径守卫、image_find / image_edit 的端到端测试。
//
// 约定：
//   * 不联网。所有数据都是本地临时目录里手写的 PNG/BMP/SVG。
//   * 「需要真实像素解码」的用例（image_edit、PNG 光栅化）通过 requireCanvas()
//     进入；canvas 在本机不可用时会被 t.skip() 明确跳过，绝不假装通过。
//   * 负向对照（越界路径 / 不存在的输入）一律用 expectFailure() 断言「失败了」，
//     而不是断言「返回里有个 error 字段」——静默成功是必须被抓住的 bug。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name as pluginName, output } from '../plugin.mjs';
import { probeImageBuffer } from '../image-meta.mjs';
import {
  countBrightPixels,
  expectFailure,
  makeBmp,
  makeCtx,
  makePng,
  makeSvg,
  makeWorkspace,
  readPixel,
  readPixelSize,
  requireCanvas,
  tool,
  withIsolatedEnv,
} from './helpers.mjs';

const TOOL_NAMES = ['image_find', 'image_edit', 'diagram_draw', 'teaching_image_match'];

/** 造一棵固定的图片树，供 image_find 复用。 */
function plantImages(root) {
  writeFileSync(join(root, 'wide.png'), makePng(1600, 900, [200, 210, 220]));
  writeFileSync(join(root, 'wide2.png'), makePng(1920, 1080, [180, 200, 230]));
  writeFileSync(join(root, 'four3.png'), makePng(800, 600, [220, 200, 180]));
  writeFileSync(join(root, 'portrait.png'), makePng(600, 900, [200, 220, 200]));
  writeFileSync(join(root, 'square.bmp'), makeBmp(500, 500));
  writeFileSync(join(root, 'vector.svg'), makeSvg(640, 480, '示意图'));
  writeFileSync(join(root, 'notes.txt'), '这不是图片');
  writeFileSync(join(root, 'broken.png'), Buffer.from('不是真的 PNG'));
}

test('插件注册：恰好四个工具，工具名只含 [a-zA-Z0-9_-]，且没有点号', () => {
  const ctx = makeCtx();
  apply(ctx, { allowedRoots: [tmpdir()] });
  assert.equal(pluginName, 'mochi-visuals');
  assert.deepEqual(inject, ['tools', 'sandboxPolicy']);

  const names = ctx.registered.map((entry) => entry.name).sort();
  assert.deepEqual(names, [...TOOL_NAMES].sort());

  for (const entry of ctx.registered) {
    assert.match(entry.name, /^[a-zA-Z0-9_-]+$/, `工具名含非法字符：${entry.name}`);
    assert.ok(!entry.name.includes('.'), `工具名绝对不能有点号（网关会 400 拒收整轮对话）：${entry.name}`);
    assert.equal(typeof entry.description, 'string');
    assert.ok(entry.description.length > 30, `description 应为完整中文说明：${entry.name}`);
    assert.equal(entry.parameters?.type, 'object');
    assert.ok(entry.parameters?.properties && Object.keys(entry.parameters.properties).length > 0);
    assert.equal(typeof entry.execute, 'function');
  }

  // 每个工具都必须是「有意义的」schema：核心入参存在、必填项声明正确。
  const props = (toolName) => tool(ctx, toolName).parameters.properties;
  const required = (toolName) => tool(ctx, toolName).parameters.required ?? [];
  assert.ok(props('image_find').query && props('image_find').aspectRatio);
  assert.equal(props('image_find').sort.enum.length, 4);
  assert.ok(required('image_edit').includes('path') && required('image_edit').includes('operations'), 'image_edit 必须要求 path 与 operations');
  assert.equal(props('image_edit').operations.type, 'array');
  assert.equal(props('image_edit').format.enum.join('/'), 'png/jpeg');
  assert.deepEqual(props('diagram_draw').type.enum, ['bar', 'line', 'pie', 'flowchart', 'relationship']);
  assert.ok(required('diagram_draw').includes('type') && required('diagram_draw').includes('title'), 'diagram_draw 必须要求 type 与 title');
  assert.deepEqual(required('teaching_image_match'), ['topic']);
  assert.equal(props('teaching_image_match').allowNetworkSuggestion.type, 'boolean');
});

test('工具输出投影：render(args, value) 返回可解析的 JSON 文本块', () => {
  const blocks = output.render({ type: 'bar' }, { ok: true, 数据点或节点数: 3 });
  assert.ok(Array.isArray(blocks));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'text');
  assert.deepEqual(JSON.parse(blocks[0].text), { ok: true, 数据点或节点数: 3 });
});

test('路径守卫：越界路径被拒绝（相对 ../、绝对路径、符号链接穿越）', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  plantImages(root);
  const find = (args) => tool(ctx, 'image_find').execute(args, {});

  // 1) 相对路径向上跳出允许根
  await expectFailure(find({ directory: '../' }), 'PATH_ESCAPE', 'image_find(directory="../")');
  await expectFailure(find({ directory: '../../etc' }), 'PATH_ESCAPE', 'image_find(directory="../../etc")');
  // 2) 绝对路径在允许根之外
  await expectFailure(find({ directory: '/etc' }), 'PATH_ESCAPE', 'image_find(directory="/etc")');
  // 3) 符号链接穿越：根内的 link 指向根外的真实目录
  const outside = mkdtempSync(join(tmpdir(), 'mochi-visuals-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'secret.png'), makePng(1600, 1600, [255, 0, 0]));
  symlinkSync(outside, join(root, 'sneaky-dir'));
  await expectFailure(find({ directory: 'sneaky-dir' }), 'PATH_ESCAPE', 'image_find(directory="sneaky-dir")');

  // 4) 根内的符号链接文件同样不被跟随（既不报错也不把别处文件当结果）
  symlinkSync(join(outside, 'secret.png'), join(root, 'sneaky-file.png'));
  const listed = await find({});
  assert.equal(
    listed.结果.some((entry) => entry.名称 === 'sneaky-file.png' || entry.路径.includes('secret.png')),
    false,
    'image_find 不应把符号链接指向的文件当成本地结果',
  );
  assert.ok(
    listed.结果.every((entry) => entry.路径.startsWith(root)),
    `所有结果必须落在允许根内，实际：${listed.结果.map((entry) => entry.路径).join('、')}`,
  );
});

test('路径守卫：拒绝文件系统根、拒绝没有允许根时运行', async (t) => {
  // `/` 不能作为允许根
  await expectFailure(
    tool(makeCtxAndApply({ allowedRoots: ['/'] }), 'image_find').execute({}, {}),
    'ROOT_UNAVAILABLE',
    'allowedRoots=["/"]',
  );

  // 既没有允许根、也没有受管工作区 → 拒绝运行（不允许隐式读整块磁盘）
  withIsolatedEnv(t);
  const bare = makeCtx();
  apply(bare, {});
  await expectFailure(
    tool(bare, 'image_find').execute({}, {}),
    'WORKSPACE_UNAVAILABLE',
    '无任何允许根',
  );
});

function makeCtxAndApply(options) {
  const ctx = makeCtx();
  apply(ctx, options);
  return ctx;
}

test('路径守卫：只读会话拒绝写操作，但检索仍然可用', async (t) => {
  const { root, outputRoot } = makeWorkspace(t);
  plantImages(root);
  const readOnlyCtx = makeCtx();
  apply(readOnlyCtx, { allowedRoots: [root], outputRoot });
  const exec = { agent: { session: { header: { cwd: root } } } };
  // sandboxPolicy 返回 read-only 时，写操作必须被拒绝。
  readOnlyCtx.sandboxPolicy = { resolve: () => ({ workspaceRoot: root, mode: 'read-only' }) };

  const found = await tool(readOnlyCtx, 'image_find').execute({}, exec);
  assert.equal(found.ok, true, '只读会话仍然可以检索图片');

  await expectFailure(
    tool(readOnlyCtx, 'image_edit').execute({ path: 'wide.png', operations: [{ op: 'resize', maxLongEdge: 200 }] }, exec),
    'WORKSPACE_READ_ONLY',
    '只读会话的 image_edit',
  );
  await expectFailure(
    tool(readOnlyCtx, 'diagram_draw').execute({ type: 'bar', title: '测试', data: [{ label: '甲', value: 1 }] }, exec),
    'WORKSPACE_READ_ONLY',
    '只读会话的 diagram_draw',
  );
});

test('image_find：能找到全部图片，只读文件头且不把非图片算进来', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  plantImages(root);
  const result = await tool(ctx, 'image_find').execute({}, {});

  assert.equal(result.ok, true);
  assert.equal(result.工具, 'image_find');
  assert.equal(result.排序, 'resolution');

  const names = result.结果.map((entry) => entry.名称).sort();
  // broken.png 文件头不是合法 PNG，必须被排除，而不是猜一个尺寸。
  assert.deepEqual(names, ['four3.png', 'portrait.png', 'square.bmp', 'vector.svg', 'wide.png', 'wide2.png']);
  assert.equal(result.跳过.非图片文件, 1, 'notes.txt 应被计为非图片文件');
  assert.equal(result.跳过.无法识别, 1, 'broken.png 应被计为无法识别');

  const wide2 = result.结果.find((entry) => entry.名称 === 'wide2.png');
  assert.deepEqual(
    { 格式: wide2.格式, 宽: wide2.宽, 高: wide2.高, 宽高比: wide2.宽高比, 方向: wide2.方向 },
    { 格式: 'PNG', 宽: 1920, 高: 1080, 宽高比: '16:9', 方向: '横向' },
  );
  assert.equal(wide2.清晰度档位, '全高清以上（长边≥1920）');
  assert.ok(wide2.大小字节 > 0);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(wide2.修改时间), '修改时间应是 ISO 时间戳');

  // BMP 与 SVG 的尺寸来自各自的头部解析（不经过 canvas）。
  const bmp = result.结果.find((entry) => entry.名称 === 'square.bmp');
  assert.deepEqual({ 格式: bmp.格式, 宽: bmp.宽, 高: bmp.高, 方向: bmp.方向 }, { 格式: 'BMP', 宽: 500, 高: 500, 方向: '正方形' });
  const svg = result.结果.find((entry) => entry.名称 === 'vector.svg');
  assert.deepEqual({ 格式: svg.格式, 宽: svg.宽, 高: svg.高 }, { 格式: 'SVG', 宽: 640, 高: 480 });
});

test('image_find：按 aspectRatio 排序并过滤偏差 >8%，按清晰度排序时长边优先', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  plantImages(root);
  const find = (args) => tool(ctx, 'image_find').execute(args, {});

  const aspect = await find({ aspectRatio: '16:9' });
  assert.equal(aspect.排序, 'aspect', '给了 aspectRatio 时应默认按比例排序');
  assert.deepEqual(aspect.结果.map((entry) => entry.名称), ['wide2.png', 'wide.png']);
  for (const entry of aspect.结果) assert.equal(entry.与目标比例偏差, '0%');
  assert.equal(aspect.跳过.比例不符 >= 4, true, '4:3 / 1:1 / 9:16 都应因偏差 >8% 被过滤');

  // 比例接近程度优先于清晰度：3:2 但更清晰的图应排在 16:9 偏差更大的图前面
  const resolution = await find({ sort: 'resolution' });
  assert.deepEqual(resolution.结果.slice(0, 3).map((entry) => entry.名称), ['wide2.png', 'wide.png', 'portrait.png']);
  assert.equal(resolution.结果.every((entry) => entry.与目标比例偏差 === undefined), true, '未指定 aspectRatio 时不应出现比例偏差字段');

  const recent = await find({ sort: 'recent' });
  assert.equal(recent.结果.length, 6);
  assert.equal(recent.排序, 'recent');
});

test('image_find：关键词通配符与尺寸/方向筛选真实生效', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  plantImages(root);
  const find = (args) => tool(ctx, 'image_find').execute(args, {});

  const wild = await find({ query: 'wide*' });
  assert.deepEqual(wild.结果.map((entry) => entry.名称).sort(), ['wide.png', 'wide2.png']);

  const single = await find({ query: 'square.???' });
  assert.deepEqual(single.结果.map((entry) => entry.名称), ['square.bmp']);

  const portrait = await find({ orientation: 'portrait' });
  assert.deepEqual(portrait.结果.map((entry) => entry.名称), ['portrait.png']);

  const square = await find({ orientation: 'square' });
  assert.deepEqual(square.结果.map((entry) => entry.名称), ['square.bmp']);

  const hd = await find({ minLongEdge: 1600 });
  assert.deepEqual(hd.结果.map((entry) => entry.名称).sort(), ['wide.png', 'wide2.png']);

  const wideEnough = await find({ minWidth: 1900 });
  assert.deepEqual(wideEnough.结果.map((entry) => entry.名称), ['wide2.png']);
});

test('image_find：递归子目录与 limit 收敛行为', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  writeFileSync(join(root, 'top.png'), makePng(1000, 1000));
  const nested = join(root, 'chapter', 'deep');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'inner.png'), makePng(1200, 900, [10, 20, 30]));

  const find = (args) => tool(ctx, 'image_find').execute(args, {});
  const recursive = await find({});
  assert.deepEqual(recursive.结果.map((entry) => entry.名称).sort(), ['inner.png', 'top.png']);

  const shallow = await find({ recursive: false });
  assert.deepEqual(shallow.结果.map((entry) => entry.名称), ['top.png']);

  const limited = await find({ limit: 1 });
  assert.equal(limited.结果数, 1);
  assert.equal(limited.是否截断, true);

  const clamped = await find({ limit: 999 });
  assert.equal(clamped.结果数, 2);
  assert.match(clamped.说明, /已收敛到 200/);
});

test('image_find：SVG 尺寸解析的边界（viewBox 回落 / 百分比宽高 / 无尺寸即无法识别）', () => {
  const probe = (svg) => probeImageBuffer(Buffer.from(svg, 'utf8'));
  const size = (svg) => {
    const parsed = probe(svg);
    return parsed ? { 格式: parsed.format, 宽: parsed.width, 高: parsed.height } : null;
  };
  const open = (attributes) => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}></svg>`;

  assert.deepEqual(size(open('width="640" height="480"')), { 格式: 'svg', 宽: 640, 高: 480 });
  assert.deepEqual(size(open('width="300px" height="200px"')), { 格式: 'svg', 宽: 300, 高: 200 });
  // 只有 viewBox 时用 viewBox 的宽高
  assert.deepEqual(size(open('viewBox="0 0 800 600"')), { 格式: 'svg', 宽: 800, 高: 600 });
  // 百分比宽高不是固有尺寸 → 回落到 viewBox（曾把 1200×675 误报成 100×100）
  assert.deepEqual(size(open('width="100%" height="100%" viewBox="0 0 1200 675"')), { 格式: 'svg', 宽: 1200, 高: 675 });
  // 既没有像素宽高也没有 viewBox → 无法识别，而不是猜一个 100×100
  assert.equal(size(open('width="100%" height="100%"')), null);
  // 非 SVG 的文本文件不应被误判为图片
  assert.equal(probe('这不是 SVG'), null);
});

test('image_find：非法参数直接报错（负向对照）', async (t) => {
  const { root, ctx } = makeWorkspace(t);
  plantImages(root);
  const find = (args) => tool(ctx, 'image_find').execute(args, {});

  // 注意：orientation / sort 是在 schema 层（defineTool 参数校验）就被拒的，
  // 所以错误码是 INVALID_ARGS；aspectRatio 是字符串、过了 schema，在 handler 里报 BAD_ARGUMENT。
  await expectFailure(find({ aspectRatio: '十六比九' }), 'BAD_ARGUMENT', 'aspectRatio 无法解析');
  await expectFailure(find({ orientation: '斜着' }), ['INVALID_ARGS', 'BAD_ARGUMENT'], 'orientation 非法');
  await expectFailure(find({ sort: 'size' }), ['INVALID_ARGS', 'BAD_ARGUMENT'], 'sort 非法');
  await expectFailure(find({ directory: '压根不存在的目录' }), 'ENOENT', '目录不存在');
  await expectFailure(find({ directory: 'notes.txt' }), 'ENOTDIR', '目录位置传了文件');
});

test('image_edit：真产出新文件、尺寸真的变了，且原图字节完全未变', async (t) => {
  const canvas = await requireCanvas(t);
  if (!canvas) return;
  const { root, outputRoot, ctx } = makeWorkspace(t);
  const source = join(root, 'photo.png');
  writeFileSync(source, makePng(1600, 1200, [120, 120, 120]));
  const before = readFileSync(source);

  const edit = (args) => tool(ctx, 'image_edit').execute(args, {});
  const cropped = await edit({ path: 'photo.png', operations: [{ op: 'crop', aspect: '16:9', anchor: 'center' }] });

  assert.equal(cropped.ok, true);
  assert.equal(cropped.源尺寸, '1600×1200');
  assert.equal(cropped.输出尺寸, '1600×900');
  assert.equal(cropped.输出格式, 'PNG');
  assert.equal(cropped.输出文件.endsWith('.png'), true);
  // 产物目录在 macOS 上 realpath 会带 /private 前缀，比较时先归一化。
  assert.ok(cropped.输出文件.startsWith(realpathSync(outputRoot)), `产物应落在受管输出目录：${cropped.输出文件}`);
  assert.notEqual(cropped.输出文件, source, '产物路径不能等于原图路径');
  assert.ok(existsSync(cropped.输出文件));
  assert.equal(cropped.回读校验.与预期一致, true);

  // 用 canvas 真读回像素尺寸（不是只断言文件存在）
  const size = await readPixelSize(canvas, cropped.输出文件);
  assert.deepEqual(size, { width: 1600, height: 900 }, 'crop 后 canvas 读回的像素尺寸必须是 1600×900');
  assert.ok(size.width !== 1600 || size.height !== 1200, '尺寸必须真的变了');

  // 原图必须一个字节都没动
  assert.equal(readFileSync(source).equals(before), true, '原图内容被改写了');

  // 链式：resize → rotate → 尺寸按预期连锁变化
  const chained = await edit({
    path: 'photo.png',
    operations: [{ op: 'resize', maxLongEdge: 400 }, { op: 'rotate', degrees: 90 }],
  });
  assert.equal(chained.输出尺寸, '300×400');
  assert.deepEqual(await readPixelSize(canvas, chained.输出文件), { width: 300, height: 400 });
});

test('image_edit：圆角 / 水印 / 亮度调整都真的改了像素', async (t) => {
  const canvas = await requireCanvas(t);
  if (!canvas) return;
  const { root, ctx } = makeWorkspace(t);
  const source = join(root, 'flat.png');
  writeFileSync(source, makePng(400, 400, [120, 120, 120]));
  const edit = (args) => tool(ctx, 'image_edit').execute(args, {});

  // 亮度：中灰 120 提亮后必须更亮（逐像素计算，不是换张图）
  const brighter = await edit({
    path: 'flat.png',
    operations: [{ op: 'adjust', brightness: 40 }],
    outputName: 'brighter',
  });
  const pixel = await readPixel(canvas, brighter.输出文件, 200, 200);
  assert.ok(pixel.r > 120, `亮度 +40 后像素应更亮，实际 r=${pixel.r}`);
  assert.equal(brighter.输出尺寸, '400×400');

  // 圆角：四角应被裁成透明，中心仍是原色
  const rounded = await edit({
    path: 'flat.png',
    operations: [{ op: 'rounded', radius: 80 }],
    outputName: 'rounded',
    format: 'png',
  });
  const corner = await readPixel(canvas, rounded.输出文件, 1, 1);
  const center = await readPixel(canvas, rounded.输出文件, 200, 200);
  assert.equal(corner.a, 0, `圆角后左上角应完全透明，实际 alpha=${corner.a}`);
  assert.equal(center.a, 255, '中心区域不应被裁掉');
  assert.equal(center.r, 120);

  // 水印：白色文字画在中灰底上，用「亮像素」计数验证真的画上去了。
  const noWatermark = await edit({ path: 'flat.png', operations: [{ op: 'adjust', brightness: 0 }], outputName: 'basis' });
  const basisBright = await countBrightPixels(canvas, noWatermark.输出文件);
  assert.equal(basisBright.bright, 0, '中灰底图上不应该有亮像素（前提校验）');

  const stamped = await edit({
    path: 'flat.png',
    operations: [{ op: 'watermark', text: 'MOCHI 2026', position: 'bottom-right', opacity: 1 }],
    outputName: 'stamped',
  });
  const asciiBright = await countBrightPixels(canvas, stamped.输出文件);
  assert.ok(asciiBright.bright > 100, `ASCII 水印必须留下明显亮像素，实际 ${asciiBright.bright}`);

  // 中文水印：只有在本机检测到可用中文字体时才验证，否则明确跳过（不伪装）
  const { resolveDiagramFont } = await import('../fonts.mjs');
  const font = await resolveDiagramFont();
  if (!font.watermarkFont) {
    t.diagnostic(`本机未检测到 canvas 可用的简体中文字体（${font.notes.join('')}），中文水印用例跳过，真机必须复验。`);
  } else {
    const cjk = await edit({
      path: 'flat.png',
      operations: [{ op: 'watermark', text: '第二章 光的折射', position: 'bottom-center', opacity: 1 }],
      outputName: 'cjk-watermark',
    });
    const cjkBright = await countBrightPixels(canvas, cjk.输出文件);
    assert.ok(cjkBright.bright > 100, `中文水印必须留下明显亮像素，实际 ${cjkBright.bright}`);
    // 中文水印若真渲染出了字形，亮像素分布必须与 ASCII 水印不同。
    assert.equal(
      readFileSync(cjk.输出文件).equals(readFileSync(stamped.输出文件)),
      false,
      '中文水印产物不应与 ASCII 水印产物字节完全相同',
    );
  }
});

test('image_edit：格式转换、同名自动加序号、绝不覆盖已有产物', async (t) => {
  const canvas = await requireCanvas(t);
  if (!canvas) return;
  const { root, ctx } = makeWorkspace(t);
  writeFileSync(join(root, 'flat.png'), makePng(400, 400, [120, 120, 120]));
  const edit = (args) => tool(ctx, 'image_edit').execute(args, {});

  const asJpeg = await edit({
    path: 'flat.png',
    operations: [{ op: 'resize', width: 200, height: 200, fit: 'cover' }],
    format: 'jpeg',
    quality: 80,
    outputName: 'exported',
  });
  assert.equal(asJpeg.输出格式, 'JPEG');
  assert.equal(asJpeg.输出文件.endsWith('.jpg'), true);
  assert.equal(asJpeg.JPEG质量, 80);
  assert.deepEqual(await readPixelSize(canvas, asJpeg.输出文件), { width: 200, height: 200 });

  // 同 outputName 再来一次：必须自动加序号，两个文件都在，谁都没被覆盖
  const again = await edit({
    path: 'flat.png',
    operations: [{ op: 'resize', width: 200, height: 200, fit: 'cover' }],
    format: 'jpeg',
    quality: 80,
    outputName: 'exported',
  });
  assert.notEqual(again.输出文件, asJpeg.输出文件, '同名产物必须自动加序号');
  assert.match(again.输出文件, /exported-2\.jpg$/);
  assert.ok(existsSync(asJpeg.输出文件) && existsSync(again.输出文件));
  assert.equal(readFileSync(asJpeg.输出文件).equals(readFileSync(again.输出文件)), true);
});

test('image_edit：非法输入直接报错，且不留下任何垃圾产物（负向对照）', async (t) => {
  const { root, outputRoot, ctx } = makeWorkspace(t);
  writeFileSync(join(root, 'photo.png'), makePng(320, 240));
  writeFileSync(join(root, 'note.txt'), '不是图片');
  const edit = (args) => tool(ctx, 'image_edit').execute(args, {});

  // 注意：这一组用例刻意「不依赖 @napi-rs/canvas」——非法入参必须在碰图像运行时
  // 之前就被拒绝，否则在缺原生模块的机器上，越界路径会被误报成「图像运行时不可用」。
  await expectFailure(edit({ path: '不存在.png', operations: [{ op: 'rotate', degrees: 90 }] }), 'ENOENT', '源图不存在');
  await expectFailure(edit({ path: '../外面.png', operations: [{ op: 'rotate', degrees: 90 }] }), 'PATH_ESCAPE', '源图越界');
  await expectFailure(edit({ path: 'note.txt', operations: [{ op: 'rotate', degrees: 90 }] }), 'TYPE_UNSUPPORTED', '非图片扩展名');
  await expectFailure(edit({ path: 'photo.png', operations: [] }), 'BAD_ARGUMENT', 'operations 空数组');
  await expectFailure(edit({ path: 'photo.png', operations: [{ op: '油画' }] }), 'BAD_ARGUMENT', '未知 op');
  await expectFailure(
    edit({ path: 'photo.png', operations: [{ op: 'crop', aspect: '16:9' }], format: 'gif' }),
    ['INVALID_ARGS', 'BAD_ARGUMENT'],
    'format 非法',
  );
  await expectFailure(
    edit({ path: 'photo.png', operations: [{ op: 'rotate', degrees: 90 }], outputDirectory: '../逃逸目录' }),
    'PATH_ESCAPE',
    '输出目录越界',
  );

  assert.deepEqual(readdirSync(outputRoot), [], '所有失败的调用都不应该写出任何产物');
});

test('生产姿态：不显式配置任何根目录时，落点与会话工作区一致（产物进 Mochi Visuals/）', async (t) => {
  // 真实运行时 apply(ctx, {}) 不会带 allowedRoots / outputRoot，
  // 允许根与产物目录都来自会话工作区。这条路径必须单独验证。
  const workspace = mkdtempSync(join(tmpdir(), 'mochi-visuals-session-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const ctx = makeCtx();
  apply(ctx, {});
  const exec = { agent: { session: { header: { cwd: workspace } } } };

  writeFileSync(join(workspace, 'photo.png'), makePng(800, 600, [100, 140, 180]));

  const found = await tool(ctx, 'image_find').execute({ aspectRatio: '4:3' }, exec);
  assert.equal(found.结果数, 1);
  assert.deepEqual(found.允许根目录, [realpathSync(workspace), join(realpathSync(workspace), 'Mochi Visuals')]);
  assert.equal(found.结果[0].宽高比, '4:3');

  // SVG 不需要图像运行时，因此在任何机器上都能验证输出落点。
  const drawn = await tool(ctx, 'diagram_draw').execute(
    { type: 'bar', title: '生产姿态', formats: ['svg'], data: [{ label: '甲', value: 3 }] },
    exec,
  );
  assert.equal(drawn.产物.SVG.路径, join(realpathSync(workspace), 'Mochi Visuals', 'bar-图.svg'));
  assert.deepEqual(readdirSync(join(workspace, 'Mochi Visuals')), ['bar-图.svg']);

  // 需要图像运行时的部分按环境诚实跳过。
  const canvas = await requireCanvas(t);
  if (!canvas) {
    assert.equal(drawn.输出目录, join(realpathSync(workspace), 'Mochi Visuals'));
    return;
  }
  const edited = await tool(ctx, 'image_edit').execute({ path: 'photo.png', operations: [{ op: 'crop', aspect: '1:1' }] }, exec);
  assert.equal(edited.输出尺寸, '600×600');
  assert.equal(edited.输出文件, join(realpathSync(workspace), 'Mochi Visuals', 'photo-edited.png'));
  assert.deepEqual(await readPixelSize(canvas, edited.输出文件), { width: 600, height: 600 });
  assert.deepEqual(readdirSync(join(workspace, 'Mochi Visuals')).sort(), ['bar-图.svg', 'photo-edited.png']);
});
