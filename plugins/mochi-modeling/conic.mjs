// mochi-modeling/conic.mjs · 椭圆计算核心（纯 ESM，零依赖，node 可直接跑）
//
// 红线（方案 15-18 章）：计算与画面同一份模型状态。
// - node 验证脚本（verify.mjs）直接 import 本文件；
// - model.html 由 index.mjs 生成时把本文件**原样内嵌**为页面模块，
//   页面所有几何（切点、切线、法线、焦点、焦半径）都调用这里的函数——
//   不许页面里另写一套公式。
//
// 坐标约定：椭圆 x^2/a^2 + y^2/b^2 = 1，参数点 P = (a·cos t, b·sin t)。
// 本文件刻意不使用反引号模板串与 ${ 插值，以便被安全内嵌进 HTML。

export const POINT_TOLERANCE = 1e-7;
export const VERTICAL_EPSILON = 1e-9;

// 参数校验：a、b 必须是有限的正数（NaN/Infinity/0/负数/字符串全拒绝）。
export function assertEllipseParams(a, b) {
  for (const pair of [['a', a], ['b', b]]) {
    const label = pair[0];
    const value = pair[1];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError('椭圆参数 ' + label + ' 必须是有限的正数，收到：' + String(value));
    }
  }
  return { a: a, b: b };
}

// 点校验：P(x0, y0) 必须落在椭圆上（残差 |x0^2/a^2 + y0^2/b^2 - 1| ≤ tolerance）。
export function assertOnEllipse(a, b, x0, y0, tolerance) {
  const tol = tolerance === undefined ? POINT_TOLERANCE : tolerance;
  assertEllipseParams(a, b);
  if (typeof x0 !== 'number' || !Number.isFinite(x0) || typeof y0 !== 'number' || !Number.isFinite(y0)) {
    throw new RangeError('切点坐标必须是有限实数，收到：(' + String(x0) + ', ' + String(y0) + ')');
  }
  const residual = (x0 * x0) / (a * a) + (y0 * y0) / (b * b) - 1;
  if (Math.abs(residual) > tol) {
    throw new RangeError('点 (' + x0 + ', ' + y0 + ') 不在椭圆 x^2/' + a + '^2 + y^2/' + b + '^2 = 1 上（残差 ' + residual + '，容差 ' + tol + '）。');
  }
  return residual;
}

// 椭圆上的参数点：P(t) = (a·cos t, b·sin t)。
export function pointOnEllipse(a, b, t) {
  assertEllipseParams(a, b);
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    throw new RangeError('参数 t 必须是有限实数，收到：' + String(t));
  }
  return { x: a * Math.cos(t), y: b * Math.sin(t) };
}

// 切线：(x0/a^2)·x + (y0/b^2)·y = 1，即 A·x + B·y + C = 0（A = x0/a^2, B = y0/b^2, C = -1）。
// 斜率 k = -b^2·x0 / (a^2·y0)；|y0| < VERTICAL_EPSILON 时切线垂直：x = a^2/x0（= ±a）。
export function tangentLine(a, b, x0, y0, tolerance) {
  assertOnEllipse(a, b, x0, y0, tolerance);
  const A = x0 / (a * a);
  const B = y0 / (b * b);
  const vertical = Math.abs(y0) < VERTICAL_EPSILON;
  return {
    A: A,
    B: B,
    C: -1,
    vertical: vertical,
    slope: vertical ? null : -(b * b * x0) / (a * a * y0),
    xIntercept: vertical ? (a * a) / x0 : null,
  };
}

// 法线（过 P 且垂直于切线）：斜率 k' = a^2·y0 / (b^2·x0)；|x0| < VERTICAL_EPSILON 时法线垂直：x = 0。
export function normalLine(a, b, x0, y0, tolerance) {
  assertOnEllipse(a, b, x0, y0, tolerance);
  const vertical = Math.abs(x0) < VERTICAL_EPSILON;
  return {
    vertical: vertical,
    slope: vertical ? null : (a * a * y0) / (b * b * x0),
  };
}

// 焦点：a ≥ b 时在 x 轴上 (±c, 0)，c = sqrt(a^2 - b^2)；b > a 时在 y 轴上 (0, ±c)。
// a = b（圆）时 c = 0，两焦点重合于原点。
export function foci(a, b) {
  assertEllipseParams(a, b);
  const c = Math.sqrt(Math.abs(a * a - b * b));
  if (a >= b) {
    return [{ x: c, y: 0 }, { x: -c, y: 0 }];
  }
  return [{ x: 0, y: c }, { x: 0, y: -c }];
}

// 焦半径和：|PF1| + |PF2| = 2a（a ≥ b 时；b > a 时为 2b，即长轴长）。
export function focalRadiusSum(a, b, x0, y0, tolerance) {
  assertOnEllipse(a, b, x0, y0, tolerance);
  const fs = foci(a, b);
  const d1 = Math.hypot(x0 - fs[0].x, y0 - fs[0].y);
  const d2 = Math.hypot(x0 - fs[1].x, y0 - fs[1].y);
  const major = Math.max(a, b);
  return { d1: d1, d2: d2, sum: d1 + d2, majorAxis: 2 * major };
}
