#!/usr/bin/env node
// 端到端渲染校验：真生成 .pptx → LibreOffice 转 PDF → PDF 转 PNG 长图，把图交给人/模型看。
//
// 为什么要有这个工具（2026-09-12）：
// 「PPT 能不能看」这件事，单元测试断言不出来。测试只能证明 XML 里字号是 24pt、色板是
// 正常的，证明不了**渲出来是空的 / 中文是豆腐块 / 标题被裁掉**。之前正是靠这条真实
// 渲染链路，才发现混合中英数行会被 pdf-lib 换成无 ToUnicode 映射的替代字形
// （测试全绿，肉眼一看整行缺字）。所以视觉校验必须是常规动作，不能是临时脚本。
//
// 用法：
//   node tools/verify-deck-render.mjs                 # 内建样例，产物写到临时目录
//   node tools/verify-deck-render.mjs --out ./out     # 指定产物目录
//   node tools/verify-deck-render.mjs --page 3        # 额外单独导出第 3 页原尺寸 PNG
//
// 产物：
//   <out>/deck/deck.pptx  真 PPTX
//   <out>/deck.pdf        经 LibreOffice 转出的 PDF
//   <out>/sheet-N.png     每页的长图（sips 拼版，便于一次看全）
//   <out>/page-<n>.png    指定页的原尺寸 PNG
//
// 退出码：0 = 链路跑通且产物齐全；非 0 = 任一步失败（不吞错、不产出半成品）。
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const presentationsRoot = join(repositoryRoot, 'plugins', 'mochi-presentations');

const { generatePresentationBundle, validatePresentation } = await import(join(presentationsRoot, 'index.mjs'));
const { convertToPdf, renderPresentationImages, resolveSoffice, resolveBundledFontDir } = await import(join(presentationsRoot, 'render.mjs'));

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const outDir = resolve(readArg('out') ?? join(tmpdir(), 'mochi-deck-render-check'));
const singlePage = Number(readArg('page') ?? 0) || null;

await mkdir(outDir, { recursive: true });

const soffice = resolveSoffice();
const fontDir = resolveBundledFontDir();
console.log('soffice          =', soffice ?? '（未找到，无法转为 PDF/PNG）');
console.log('bundled font dir =', fontDir ?? '（未找到内置中文字体）');
if (!soffice) {
  console.error('缺少 LibreOffice：这条链路要求本机有 soffice 才能把 PPTX 转成可视图像。');
  process.exit(1);
}

// 样例刻意混排中文 / 拉丁字母 / 阿拉伯数字 / 全角标点。
// 这个组合就是为了压住「混合脚本行被换字形」那类只在渲染层暴露的缺陷。
const source = (n) => ({ label: `Mochi 校验第 ${n} 页`, reference: `verify:deck-render:${n}` });

const presentation = {
  schema: 'mochi-lesson-presentation-v1',
  sourceKind: 'demonstration',
  deckId: 'deck-render-verify',
  version: 1,
  title: '渲染链路回归校验',
  theme: { preset: 'field', accent: 'C2410C' },
  slides: [
    { id: 'cover', version: 1, layout: 'cover', title: '水循环与节水行动',
      body: ['七年级科学 · 第 3 单元', '授课教师：张老师'], source: source(1) },
    { id: 'section', version: 1, layout: 'section', title: '第一部分：水从哪里来',
      body: ['把生活观察转成科学过程'], source: source(2) },
    { id: 'opening', version: 1, layout: 'title-body', title: '水从哪里来，又到哪里去？',
      body: ['说出蒸发、凝结和降水三个过程。', '用生活观察解释「云为什么会出现」。', '把科学理解转化为一项可执行的节水行动。'], source: source(3) },
    { id: 'table', version: 1, layout: 'title-table', title: '三个过程与可观察证据',
      body: ['先描述现象，再说明发生变化的条件。'],
      table: { headers: ['过程', '条件', '可观察证据'], rows: [['蒸发', '受热', '水面逐渐减少'], ['凝结', '降温', '杯壁出现小水滴'], ['降水', '水滴聚集', '水滴落向地面']] },
      source: source(4) },
    { id: 'kpi', version: 1, layout: 'kpi', title: '82%',
      body: ['的校园用水浪费发生在洗手与清洁环节'], source: source(5) },
    { id: 'chart', version: 1, layout: 'title-chart', title: '课堂活动：哪项节水行动最容易开始？',
      body: ['以下是课堂讨论用示例数据，不代表本班真实调查结果。'],
      chart: { type: 'bar', title: '小组投票示例（票）', labels: ['及时关水', '一水多用', '修理滴漏', '减少长流水'], series: [{ name: '示例票数', values: [18, 13, 9, 7] }] },
      source: source(6) },
    { id: 'closing', version: 1, layout: 'closing', title: '今天带走一件事：随手关水',
      body: ['离场卡：写下你今天就能做到的一项行动'], source: source(7) },
  ],
};

let bundle;
try {
  bundle = await generatePresentationBundle({ presentation, outputDirectory: join(outDir, 'deck') });
} catch (error) {
  // 生成失败时先把结构校验单独跑一遍，把"是输入不合法"和"是渲染炸了"分开，别混成一句话。
  console.error('--- 生成失败 ---');
  try {
    validatePresentation(presentation);
    console.error('validatePresentation: OK（说明输入合法，问题出在生成链路）');
  } catch (validationError) {
    console.error('validatePresentation:', validationError.code, validationError.message);
  }
  throw error;
}
console.log('pptx  =', bundle.pptxPath);

const pdfPath = await convertToPdf(bundle.pptxPath, join(outDir, 'work'), soffice);
console.log('pdf   =', pdfPath);

const overview = await renderPresentationImages({ pdfPath, pageWidth: 620 });
for (const [index, sheet] of overview.sheets.entries()) {
  const file = join(outDir, `sheet-${index + 1}.png`);
  await writeFile(file, sheet.png);
  console.log('sheet =', file, `${sheet.width}x${sheet.height}`);
}

if (singlePage) {
  const single = await renderPresentationImages({ pdfPath, page: singlePage });
  const file = join(outDir, `page-${singlePage}.png`);
  await writeFile(file, single.pages[0].png);
  console.log('page  =', file);
}

console.log('total pages =', overview.total);
console.log('产物目录 =', outDir);
console.log('下一步：把上面这些 PNG 用 read_image 打开看，别只看测试是否绿。');
