// mochi-modeling · Mochi 教学建模工作空间（方案第 15-20 章）
//
// 首样：椭圆切线交互模型。工具 mochi.model_create 在指定目录生成：
//   model.html            自包含交互页（零 http(s) 外链，JSXGraph 走本地 vendor 副本）
//   model.json            模型说明（类型/参数/公式/假设/版本/验证摘要）
//   assets/jsxgraph*.{js,css}  从插件 assets 复制的本地副本
// 计算与画面同一份状态：conic.mjs 是唯一公式来源，页面内嵌其原样副本，
// node 验证脚本直接 import 同一文件——页面里不许另写一套公式。
// ⚠️ render 签名是 (args, value)（2026-09-05 大坑 17）：单参写法会把调用参数当结果给模型。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEllipseParams } from './conic.mjs';
import { runVerification } from './verify.mjs';

const here = resolve(dirname(fileURLToPath(import.meta.url)));
const JSXGRAPH_VERSION = '1.13.3';
const JSXGRAPH_COMMIT = '7c2176d479ae256cb9d38265bce81fa18709d01f';
const CONIC_SOURCE = readFileSync(join(here, 'conic.mjs'), 'utf8');

export const name = 'mochi-modeling';
export const inject = ['tools'];
export const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: value && typeof value.摘要 === 'string' ? value.摘要 : JSON.stringify(value) }],
};

const ASSUMPTIONS = [
  '研究对象：椭圆 x^2/a^2 + y^2/b^2 = 1 及其在椭圆上一点 P 处的切线。',
  '坐标系：标准笛卡尔直角坐标系，原点在椭圆中心。',
  '单位：无量纲（坐标单位长度）。',
  '参数范围：a, b ∈ [1, 8]，a > 0 且 b > 0；a = b 时退化为圆。',
  '忽略因素：理想椭圆 / 欧氏平面 / 除数值舍入误差（约 1e-15）外不考虑任何不确定性，不做误差建模。',
];

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>椭圆的切线 · 交互数学模型</title>
<link rel="stylesheet" href="assets/jsxgraph.css">
<style>
  :root { --ink: #1b1b1b; --accent: #c01c28; --blue: #1a5fb4; --paper: #ffffff; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
         color: var(--ink); background: var(--paper); font-size: 17px; line-height: 1.55; }
  header { padding: 12px 20px 4px; }
  h1 { font-size: 1.5rem; margin: 0 0 6px; }
  .banner { background: #fff3cd; border: 2px solid #e0a800; border-radius: 8px;
            padding: 8px 14px; font-weight: 700; font-size: 1.1rem; margin-bottom: 10px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  nav button { font-size: 1rem; padding: 8px 14px; border-radius: 8px; border: 2px solid var(--blue);
               background: #fff; color: var(--blue); cursor: pointer; font-weight: 600; }
  nav button.active { background: var(--blue); color: #fff; }
  #classroomToggle { border-color: #6c757d; color: #495057; margin-left: auto; }
  body.classroom { font-size: 26px; }
  body.classroom .banner { font-size: 1.3rem; }
  body.classroom nav button { font-size: 1.2rem; }
  main { display: flex; flex-wrap: wrap; gap: 16px; padding: 0 20px 24px; align-items: flex-start; }
  #boardPanel { flex: 1 1 620px; min-width: 320px; }
  #board { width: 100%; height: 540px; border: 2px solid #dee2e6; border-radius: 10px; }
  body.classroom #board { height: 72vh; }
  #controls { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 18px; font-size: 1.05rem; font-weight: 600; }
  #controls input[type=range] { width: 200px; vertical-align: middle; margin-left: 8px; }
  aside { flex: 0 1 430px; min-width: 300px; display: flex; flex-direction: column; gap: 14px; }
  section.card { border: 2px solid #dee2e6; border-radius: 10px; padding: 12px 16px; }
  section.card h2 { font-size: 1.1rem; margin: 0 0 8px; color: var(--blue); }
  #assumptions ul { margin: 0; padding-left: 20px; font-size: 0.95rem; }
  #readout table { width: 100%; border-collapse: collapse; }
  #readout td { padding: 3px 4px; border-bottom: 1px dashed #e9ecef; font-size: 1rem; }
  #readout td:first-child { white-space: nowrap; color: #495057; width: 40%; }
  .hidden { display: none; }
  .step { border-left: 4px solid var(--blue); background: #f1f6ff; border-radius: 0 8px 8px 0;
          padding: 8px 12px; margin: 8px 0; }
  .step.conclusion { border-color: #2e7d32; background: #edf7ed; }
  #revealBtn { font-size: 1rem; padding: 8px 16px; border-radius: 8px; border: none;
               background: #2e7d32; color: #fff; cursor: pointer; font-weight: 600; }
  footer { padding: 0 20px 24px; color: #6c757d; font-size: 0.85rem; }
</style>
</head>
<body>
<header>
  <h1>椭圆的切线 · 交互数学模型（首样 v1）</h1>
  <div class="banner">拖动观察只能支持猜想，证明需要推导。</div>
  <nav id="stages">
    <button data-stage="observe" class="active">① 观察</button>
    <button data-stage="ask">② 提问</button>
    <button data-stage="aux">③ 辅助线</button>
    <button data-stage="derive">④ 分步推导</button>
    <button data-stage="conclusion">⑤ 结论</button>
    <button id="classroomToggle">课堂模式</button>
  </nav>
</header>
<main>
  <div id="boardPanel">
    <div id="board" class="jxgbox"></div>
    <div id="controls">
      <label>a = <span id="aValue"></span><input type="range" id="sliderA" min="1" max="8" step="0.1"></label>
      <label>b = <span id="bValue"></span><input type="range" id="sliderB" min="1" max="8" step="0.1"></label>
    </div>
  </div>
  <aside>
    <section class="card" id="assumptions">
      <h2>假设（显式）</h2>
      <ul>
        <li>研究对象：椭圆 x&sup2;/a&sup2; + y&sup2;/b&sup2; = 1 及其在椭圆上一点 P 处的切线。</li>
        <li>坐标系：标准笛卡尔直角坐标系，原点在椭圆中心。</li>
        <li>单位：无量纲（坐标单位长度）。</li>
        <li>参数范围：a, b &isin; [1, 8]，均为正数；a = b 时退化为圆。</li>
        <li>忽略因素：理想椭圆 / 欧氏平面 / 除数值舍入误差（约 1e-15）外不考虑任何不确定性。</li>
      </ul>
    </section>
    <section class="card" id="readout">
      <h2>当前状态（本地实时计算）</h2>
      <table>
        <tr><td>切点 P</td><td id="roP"></td></tr>
        <tr><td>切线方程</td><td id="roTan"></td></tr>
        <tr><td>切线斜率 k</td><td id="roSlope"></td></tr>
        <tr><td>|PF1| + |PF2|</td><td id="roSum"></td></tr>
      </table>
    </section>
    <section class="card hidden" id="question">
      <h2>② 提问 · 观察任务</h2>
      <p>看切线与两条焦半径 PF1、PF2 的<b>夹角</b>：切线把哪个角分成了相等的两半？</p>
      <p>拖动 P 绕椭圆一圈，再用滑块改变 a、b。把你的猜想先写在纸上，再到第④步核对推导。</p>
    </section>
    <section class="card hidden" id="derivation">
      <h2>④ 分步推导（逐条揭示）</h2>
      <div class="step hidden">1. 设 P(x&#8320;, y&#8320;) 在椭圆上：x&#8320;&sup2;/a&sup2; + y&#8320;&sup2;/b&sup2; = 1。</div>
      <div class="step hidden">2. 隐函数求导：对 x&sup2;/a&sup2; + y&sup2;/b&sup2; = 1 两边关于 x 求导，得 2x/a&sup2; + 2y&middot;y&prime;/b&sup2; = 0，即 y&prime; = &minus;b&sup2;x/(a&sup2;y)。</div>
      <div class="step hidden">3. 代入 P：切线斜率 k = &minus;b&sup2;x&#8320;/(a&sup2;y&#8320;)（y&#8320; &ne; 0 时；y&#8320; = 0 时切线垂直于 x 轴，方程 x = &plusmn;a）。</div>
      <div class="step hidden">4. 点斜式 (y &minus; y&#8320;) = k(x &minus; x&#8320;)，整理并利用 x&#8320;&sup2;/a&sup2; + y&#8320;&sup2;/b&sup2; = 1 消去常数，得<b>切线方程 x&middot;x&#8320;/a&sup2; + y&middot;y&#8320;/b&sup2; = 1</b>。</div>
      <div class="step conclusion hidden">5. 结论（光学性质）：由 |PF1| + |PF2| = 2a 与角平分线定理可证<b>切线与两条焦半径成等角</b>（法线平分 &angle;F1PF2 的内角）——从一个焦点发出的光线经椭圆反射后经过另一个焦点。<b>完整证明需要代数推导，本页的拖动观察只支持猜想。</b></div>
      <button id="revealBtn">揭示下一步</button>
    </section>
  </aside>
</main>
<footer>模型 v1 · mochi-modeling / conic.mjs（页面内嵌同一份计算源码，全部本地计算、零网络请求）· 渲染引擎 JSXGraph v${JSXGRAPH_VERSION}（本地 vendor 副本，LGPL / MIT 双许可）</footer>
<script src="assets/jsxgraphcore.js"></script>
<script type="module">
__CONIC_SOURCE__

// ---- 页面逻辑：所有几何都调用上面这一份 conic 函数，不另写公式 ----
const state = { a: __INIT_A__, b: __INIT_B__ };

const board = JXG.JSXGraph.initBoard('board', {
  boundingbox: [-9, 6.5, 9, -6.5], axis: true, keepaspectratio: true,
  pan: { enabled: false }, zoom: { wheel: false }, showNavigation: false, showCopyright: false,
});

const ellipseCurve = board.create('curve', [
  (t) => pointOnEllipse(state.a, state.b, t).x,
  (t) => pointOnEllipse(state.a, state.b, t).y,
  0, 2 * Math.PI,
], { strokeColor: '#1a5fb4', strokeWidth: 3 });

const P = board.create('glider', [state.a, 0, ellipseCurve], {
  name: 'P', size: 4, fillColor: '#c01c28', strokeColor: '#c01c28', label: { fontSize: 15 },
});

// 把 JSXGraph 抓到的浮动坐标投影回精确椭圆（仍用 conic.mjs 的函数）。
function exactPoint() {
  const t = Math.atan2(P.Y() / state.b, P.X() / state.a);
  return pointOnEllipse(state.a, state.b, t);
}
function tangentSecond() {
  const p = exactPoint();
  const tan = tangentLine(state.a, state.b, p.x, p.y);
  if (tan.vertical) return [tan.xIntercept, p.y + 1];
  return [p.x + 1, p.y + tan.slope];
}
function normalSecond() {
  const p = exactPoint();
  const nrm = normalLine(state.a, state.b, p.x, p.y);
  if (nrm.vertical) return [p.x, p.y + 1];
  return [p.x + 1, p.y + nrm.slope];
}

const tangentLineEl = board.create('line', [P, board.create('point',
  [() => tangentSecond()[0], () => tangentSecond()[1]], { visible: false })],
  { strokeColor: '#c01c28', strokeWidth: 2 });

const F1 = board.create('point', [() => foci(state.a, state.b)[0].x, () => foci(state.a, state.b)[0].y],
  { name: 'F1', size: 3, fillColor: '#2e7d32', strokeColor: '#2e7d32', visible: false });
const F2 = board.create('point', [() => foci(state.a, state.b)[1].x, () => foci(state.a, state.b)[1].y],
  { name: 'F2', size: 3, fillColor: '#2e7d32', strokeColor: '#2e7d32', visible: false });
const seg1 = board.create('segment', [P, F1], { strokeColor: '#2e7d32', strokeWidth: 2, visible: false });
const seg2 = board.create('segment', [P, F2], { strokeColor: '#2e7d32', strokeWidth: 2, visible: false });
const normalEl = board.create('line', [P, board.create('point',
  [() => normalSecond()[0], () => normalSecond()[1]], { visible: false })],
  { strokeColor: '#6a4c93', strokeWidth: 2, dash: 2, visible: false });

function el(id) { return document.getElementById(id); }
function show(node, on) { node.classList.toggle('hidden', !on); }
function fmt(value, digits) { return Number(value).toFixed(digits === undefined ? 3 : digits); }

function updateReadout() {
  const p = exactPoint();
  el('roP').textContent = '(' + fmt(p.x) + ', ' + fmt(p.y) + ')';
  try {
    const tan = tangentLine(state.a, state.b, p.x, p.y);
    el('roTan').textContent = tan.vertical
      ? 'x = ' + fmt(tan.xIntercept) + '（垂直于 x 轴）'
      : fmt(tan.A) + '·x + (' + fmt(tan.B) + ')·y = 1';
    el('roSlope').textContent = tan.vertical ? '不存在（垂直）' : fmt(tan.slope);
    const fs = focalRadiusSum(state.a, state.b, p.x, p.y);
    el('roSum').textContent = fmt(fs.sum) + ' = 2·max(a,b) = ' + fmt(fs.majorAxis)
      + '（差 ' + Math.abs(fs.sum - fs.majorAxis).toExponential(1) + '）';
  } catch (error) {
    el('roTan').textContent = '计算错误：' + error.message;
  }
}

const steps = document.querySelectorAll('#derivation .step');
let revealed = 0;
function updateRevealBtn() {
  el('revealBtn').textContent = revealed >= steps.length
    ? '已全部揭示' : '揭示下一步（' + (revealed + 1) + '/' + steps.length + '）';
}
function revealAll() { for (const s of steps) s.classList.remove('hidden'); revealed = steps.length; updateRevealBtn(); }
el('revealBtn').addEventListener('click', () => {
  if (revealed < steps.length) { steps[revealed].classList.remove('hidden'); revealed += 1; }
  updateRevealBtn();
});

const AUX_STAGES = { aux: true, derive: true, conclusion: true };
function setStage(stage) {
  for (const btn of document.querySelectorAll('#stages button[data-stage]')) {
    btn.classList.toggle('active', btn.getAttribute('data-stage') === stage);
  }
  show(el('question'), stage === 'ask' || stage === 'aux');
  show(el('derivation'), stage === 'derive' || stage === 'conclusion');
  if (stage === 'conclusion') revealAll();
  const auxOn = !!AUX_STAGES[stage];
  F1.setAttribute({ visible: auxOn });
  F2.setAttribute({ visible: auxOn });
  seg1.setAttribute({ visible: auxOn });
  seg2.setAttribute({ visible: auxOn });
  normalEl.setAttribute({ visible: auxOn });
  board.update();
  updateReadout();
}
for (const btn of document.querySelectorAll('#stages button[data-stage]')) {
  btn.addEventListener('click', () => setStage(btn.getAttribute('data-stage')));
}
el('classroomToggle').addEventListener('click', () => {
  const on = document.body.classList.toggle('classroom');
  el('classroomToggle').textContent = on ? '退出课堂模式' : '课堂模式';
});

function bindSlider(id, labelId, key) {
  const slider = el(id);
  slider.value = String(state[key]);
  el(labelId).textContent = fmt(state[key], 1);
  slider.addEventListener('input', () => {
    state[key] = parseFloat(slider.value);
    el(labelId).textContent = fmt(state[key], 1);
    board.update();
    updateReadout();
  });
}
bindSlider('sliderA', 'aValue', 'a');
bindSlider('sliderB', 'bValue', 'b');

P.on('drag', updateReadout);
setStage('observe');
</script>
</body>
</html>
`;

function buildModelHtml(a, b) {
  return HTML_TEMPLATE
    .split('__CONIC_SOURCE__').join(CONIC_SOURCE)
    .split('__INIT_A__').join(String(a))
    .split('__INIT_B__').join(String(b));
}

function buildModelJson(a, b) {
  const verification = runVerification();
  return {
    type: 'conic-tangent',
    version: 'v1',
    generatedAt: new Date().toISOString(),
    params: { a: a, b: b },
    formulas: {
      ellipse: 'x^2/a^2 + y^2/b^2 = 1，参数点 P(t) = (a·cos t, b·sin t)',
      tangent: '(x0/a^2)·x + (y0/b^2)·y = 1，即 A·x + B·y + C = 0（A = x0/a^2, B = y0/b^2, C = -1）',
      slope: '-b^2·x0/(a^2·y0)（y0 ≠ 0；y0 = 0 时切线垂直：x = a^2/x0 = ±a）',
      focalProperty: '|PF1| + |PF2| = 2·max(a, b)，切线与两焦半径成等角',
    },
    assumptions: ASSUMPTIONS,
    jsxgraph: {
      version: JSXGRAPH_VERSION,
      license: 'GNU LGPL 与 MIT 双许可（二选一），已随 assets 存档 LICENSE.LGPL / LICENSE.MIT',
      source: 'npm 包 jsxgraph@' + JSXGRAPH_VERSION + '（unpkg.com dist 副本），对应 GitHub jsxgraph/jsxgraph tag v' + JSXGRAPH_VERSION + '，commit ' + JSXGRAPH_COMMIT,
      vendoredAt: 'plugins/mochi-modeling/assets/jsxgraphcore.js',
    },
    teachingModes: ['观察', '提问', '辅助线', '分步推导', '结论（默认隐藏，逐步揭示）', '课堂大字号高对比'],
    observationDisclaimer: '拖动观察只能支持猜想，证明需要推导。',
    computationModel: 'conic.mjs 为唯一公式来源；HTML 内嵌其原样副本，node 验证 import 同一文件。',
    verification: verification,
  };
}

function validateArgs(args) {
  if (args.type !== 'conic-tangent') {
    throw new Error('type 目前仅支持 conic-tangent，收到：' + String(args.type));
  }
  assertEllipseParams(Number(args.a), Number(args.b));
  const outDir = String(args.outputDirectory || '').trim();
  if (!outDir) throw new Error('outputDirectory 不能为空。');
  return { a: Number(args.a), b: Number(args.b), outDir: resolve(outDir) };
}

function fileLen(path) {
  try { return statSync(path).size; } catch { return 0; }
}

async function modelCreate(args) {
  const { a, b, outDir } = validateArgs(args);
  const assetsDir = join(outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  const htmlPath = join(outDir, 'model.html');
  const jsonPath = join(outDir, 'model.json');
  const corePath = join(assetsDir, 'jsxgraphcore.js');
  const cssPath = join(assetsDir, 'jsxgraph.css');

  writeFileSync(htmlPath, buildModelHtml(a, b), 'utf8');
  const modelJson = buildModelJson(a, b);
  writeFileSync(jsonPath, JSON.stringify(modelJson, null, 2) + '\n', 'utf8');
  copyFileSync(join(here, 'assets', 'jsxgraphcore.js'), corePath);
  copyFileSync(join(here, 'assets', 'jsxgraph.css'), cssPath);

  const v = modelJson.verification;
  return {
    source: 'mochi-modeling',
    摘要: [
      '已生成椭圆切线交互模型（conic-tangent）。',
      '产物：' + htmlPath + '（自包含交互页，' + fileLen(htmlPath) + ' 字节）；',
      '说明：' + jsonPath + '；渲染引擎本地副本 ' + corePath + '（JSXGraph ' + JSXGRAPH_VERSION + '，LGPL/MIT 双许可）。',
      '参数：a = ' + a + '，b = ' + b + '。',
      '验证：' + v.status + '——' + v.cases + ' 组参数 × ' + v.pointsPerCase + ' 点，斜率解析解核对 '
        + v.slopeChecks + ' 次容差 1e-9（最大误差 ' + v.maxSlopeError.toExponential(2) + '），边界拒绝 '
        + v.boundaryRejections + ' 项。',
      '教学模式：观察 → 提问 → 辅助线 → 分步推导 → 结论（结论区默认隐藏、按钮逐步揭示），支持课堂大字号高对比模式；页面显著位置标注「拖动观察只能支持猜想，证明需要推导」。',
      '红线自查：页面与 node 验证共用同一份 conic.mjs（HTML 内嵌原样副本）；HTML 零 http(s) 外链；全部交互本地计算、零网络请求。',
    ].join('\n'),
    产物: { modelHtml: htmlPath, modelJson: jsonPath, assets: [corePath, cssPath] },
    参数: { type: 'conic-tangent', a: a, b: b },
    验证: v,
  };
}

export function apply(ctx) {
  const register = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({
    name: toolName, description, parameters, output, execute,
  }));

  register('mochi.model_create', '生成交互教学数学模型页面（自包含 HTML，可拖动/可核对/离线零依赖）。本期支持 type=conic-tangent：椭圆切线交互模型（可拖切点、切线/焦点/辅助线、参数滑块、结论分步揭示、课堂模式）。', {
    type: { type: 'string', required: true, description: '模型类型，本期仅 conic-tangent。' },
    a: { type: 'number', required: true, description: '椭圆半长轴（>0 的有限数）。' },
    b: { type: 'number', required: true, description: '椭圆半短轴（>0 的有限数）。' },
    outputDirectory: { type: 'string', required: true, description: '输出目录（自动创建），生成 model.html / model.json / assets/。' },
  }, (args) => modelCreate(args));

  console.log('[mochi-modeling] 教学建模域就绪：mochi.model_create（conic-tangent 首样，JSXGraph ' + JSXGRAPH_VERSION + ' 本地 vendor）');
}
