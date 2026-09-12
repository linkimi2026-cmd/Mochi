// mochi-modeling 单测：工单 MOCHI-P45-MM-01 六项
// ①工具注册正确 ②全链生成三件套 ③HTML 零 http(s) 外链 ④model.json schema 与验证摘要
// ⑤conic.mjs 解析解抽验 ⑥render 签名回归（双参，大坑 17）
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, output } from './index.mjs';
import { pointOnEllipse, tangentLine, foci, focalRadiusSum } from './conic.mjs';

function makeHarness() {
  const tools = new Map();
  const logs = [];
  apply({
    tools: { register: (tool) => tools.set(tool.name, tool) },
    get: () => undefined,
    logger: { info: (...xs) => logs.push(xs.join(' ')), log: (...xs) => logs.push(xs.join(' ')), error: () => {} },
  });
  const exec = { agent: { session: {} }, callId: 'c1' };
  return { tools, exec, logs };
}

console.log('① 工具注册正确：mochi_model_create 已注册且参数/schema 齐全');
const { tools, exec } = makeHarness();
assert.equal(tools.has('mochi_model_create'), true);
const tool = tools.get('mochi_model_create');
assert.equal(typeof tool.execute, 'function');
assert.equal(typeof output.render, 'function');

console.log('② 全链生成三件套：model.html / model.json / assets/jsxgraphcore.js');
const tempRoot = mkdtempSync(join(tmpdir(), 'mochi-modeling-test-'));
const outDir = join(tempRoot, 'out');
try {
  const res = await tool.execute({ type: 'conic-tangent', a: 5, b: 3, outputDirectory: outDir }, exec);
  assert.equal(res.产物.modelHtml, join(outDir, 'model.html'));
  assert.equal(existsSync(res.产物.modelHtml), true);
  assert.equal(existsSync(res.产物.modelJson), true);
  assert.equal(existsSync(join(outDir, 'assets', 'jsxgraphcore.js')), true);
  assert.equal(existsSync(join(outDir, 'assets', 'jsxgraph.css')), true);
  assert.ok(readdirSync(outDir).includes('model.html'));
  // 非法参数与非法 type 拒绝
  await assert.rejects(() => tool.execute({ type: 'nope', a: 5, b: 3, outputDirectory: outDir }, exec), /conic-tangent/);
  await assert.rejects(() => tool.execute({ type: 'conic-tangent', a: -1, b: 3, outputDirectory: outDir }, exec), /正数/);
  // NaN 在 dsh-tools schema 层即被拒绝（JSON 数值必须是有限数）
  await assert.rejects(() => tool.execute({ type: 'conic-tangent', a: NaN, b: 3, outputDirectory: outDir }, exec), /finite JSON number/);
  await assert.rejects(() => tool.execute({ type: 'conic-tangent', a: 5, b: 3, outputDirectory: ' ' }, exec), /outputDirectory/);

  console.log('③ HTML 零 http(s) 外链（grep 断言）');
  const html = readFileSync(join(outDir, 'model.html'), 'utf8');
  const externalLinks = html.match(/https?:\/\//g);
  assert.equal(externalLinks, null, 'model.html 不应出现任何 http(s) 外链，实际命中：' + JSON.stringify(externalLinks));
  assert.ok(html.includes('assets/jsxgraphcore.js'), 'JSXGraph 以相对路径引用本地 vendor 副本');
  assert.ok(html.includes('assets/jsxgraph.css'));
  assert.ok(html.includes('拖动观察只能支持猜想'), '「观察不是证明」标注在场');
  assert.ok(html.includes('假设'), '假设区在场');
  assert.ok(html.includes('课堂模式'));
  // 计算与画面同一份状态：页面内嵌 conic.mjs 原样源码
  assert.ok(html.includes('export function pointOnEllipse'), '页面内嵌同一份 conic.mjs（pointOnEllipse）');
  assert.ok(html.includes('export function tangentLine'), '页面内嵌同一份 conic.mjs（tangentLine）');
  assert.ok(html.includes('export function foci'), '页面内嵌同一份 conic.mjs（foci）');

  console.log('④ model.json schema 与验证摘要');
  const modelJson = JSON.parse(readFileSync(join(outDir, 'model.json'), 'utf8'));
  assert.equal(modelJson.type, 'conic-tangent');
  assert.equal(modelJson.version, 'v1');
  assert.equal(typeof modelJson.generatedAt, 'string');
  assert.deepEqual(modelJson.params, { a: 5, b: 3 });
  assert.equal(typeof modelJson.formulas.tangent, 'string');
  assert.ok(Array.isArray(modelJson.assumptions) && modelJson.assumptions.length >= 4, '假设显式列出');
  assert.equal(modelJson.verification.status, '通过');
  assert.ok(modelJson.verification.cases >= 5, '≥5 组参数');
  assert.ok(modelJson.verification.pointsPerCase >= 20, '每组 ≥20 点');
  assert.ok(modelJson.verification.slopeTolerance <= 1e-9);
  assert.ok(modelJson.verification.maxSlopeError <= 1e-9);
  assert.ok(modelJson.jsxgraph.version.length > 0);
  assert.ok(modelJson.jsxgraph.license.includes('LGPL') && modelJson.jsxgraph.license.includes('MIT'));
  assert.equal(typeof modelJson.observationDisclaimer, 'string');

  console.log('返回摘要为预消化中文');
  assert.ok(typeof res.摘要 === 'string' && res.摘要.includes('已生成椭圆切线交互模型'));
  assert.ok(res.摘要.includes('a = 5'));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('⑤ conic.mjs 解析解抽验（a=5,b=3 等）');
{
  // t = 0.9：P = (5cos0.9, 3sin0.9)，解析斜率 -b²x0/(a²y0)
  const a = 5; const b = 3; const t = 0.9;
  const p = pointOnEllipse(a, b, t);
  assert.ok(Math.abs(p.x - a * Math.cos(t)) < 1e-15 && Math.abs(p.y - b * Math.sin(t)) < 1e-15);
  const tan = tangentLine(a, b, p.x, p.y);
  const analytic = -(b * b * p.x) / (a * a * p.y);
  assert.ok(Math.abs(tan.slope - analytic) < 1e-12);
  assert.ok(Math.abs(tan.A - p.x / (a * a)) < 1e-15);
  assert.ok(Math.abs(tan.B - p.y / (b * b)) < 1e-15);
  assert.ok(Math.abs(tan.A * p.x + tan.B * p.y + tan.C) < 1e-12, '切线过切点');
  // y0=0 → 垂直切线 x=±a
  const apex = tangentLine(a, b, a, 0);
  assert.equal(apex.vertical, true);
  assert.ok(Math.abs(apex.xIntercept - a) < 1e-12);
  // 焦点与焦半径和
  const fs = foci(5, 3);
  assert.ok(Math.abs(fs[0].x - 4) < 1e-12 && fs[0].y === 0);
  const q = pointOnEllipse(5, 3, 1.2);
  const sum = focalRadiusSum(5, 3, q.x, q.y);
  assert.ok(Math.abs(sum.sum - 10) < 1e-9);
  // 边界拒绝
  assert.throws(() => pointOnEllipse(0, 3, 0.1), /正数/);
  assert.throws(() => tangentLine(5, 3, 1, 1), /不在椭圆/);
  assert.throws(() => foci(NaN, 3), /正数/);
}

console.log('⑥ render 签名回归：双参 (args, value)，第二参数才是工具返回值（大坑 17）');
{
  const rendered = output.render({ some: 'args' }, { 摘要: 'real result here' });
  assert.ok(rendered[0].text.includes('real result here'));
  assert.ok(!rendered[0].text.includes('some'));
  const renderedJson = output.render({ some: 'args' }, { real: 'result' });
  assert.ok(renderedJson[0].text.includes('result'));
  assert.ok(!renderedJson[0].text.includes('some'));
}

console.log('mochi-modeling tests passed: 注册/三件套/零外链/schema/解析解/render 全绿');
