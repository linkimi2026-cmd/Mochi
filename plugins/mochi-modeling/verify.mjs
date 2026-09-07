// mochi-modeling/verify.mjs · node 数值验证（不开浏览器）
//
// 用 conic.mjs 对多组参数抽 ≥20 个点：
// ① 切线斜率对解析解 -b^2·x0/(a^2·y0) 容差 1e-9；
// ② 切线过切点（A·x0 + B·y0 + C = 0）；
// ③ 焦半径和 = 长轴长；
// ④ 边界（a≤0、b≤0、NaN、Infinity、点不在椭圆上）全拒绝。
// runVerification() 同时被 index.mjs import，把通过摘要写进 model.json。

import { pathToFileURL } from 'node:url';
import {
  pointOnEllipse, tangentLine, foci, focalRadiusSum,
  assertEllipseParams, assertOnEllipse, POINT_TOLERANCE,
} from './conic.mjs';

const SLOPE_TOLERANCE = 1e-9;

function assertClose(actual, expected, tolerance, label) {
  const error = Math.abs(actual - expected);
  if (!Number.isFinite(actual) || error > tolerance) {
    throw new Error(label + ' 超差：实际 ' + actual + '，期望 ' + expected + '，误差 ' + error + '，容差 ' + tolerance);
  }
  return error;
}

function assertThrows(fn, label) {
  let threw = null;
  try { fn(); } catch (error) { threw = error; }
  if (!threw) throw new Error('边界校验失败：' + label + ' 应当被拒绝，但被接受了。');
}

export function runVerification() {
  const cases = [[5, 3], [4, 3], [6, 2], [5, 4], [2.5, 1.5], [7, 3]];
  const pointsPerCase = 24;
  let maxSlopeError = 0;
  let maxPassThroughError = 0;
  let maxFociSumError = 0;
  let slopeChecks = 0;
  let verticalChecks = 0;
  let pointsChecked = 0;

  for (const item of cases) {
    const a = item[0];
    const b = item[1];
    for (let i = 0; i < pointsPerCase; i += 1) {
      const t = (2 * Math.PI * i) / pointsPerCase;
      const p = pointOnEllipse(a, b, t);
      const tan = tangentLine(a, b, p.x, p.y);
      pointsChecked += 1;
      // 切线过切点：A·x0 + B·y0 + C ≈ 0
      maxPassThroughError = Math.max(
        maxPassThroughError,
        assertClose(tan.A * p.x + tan.B * p.y + tan.C, 0, 1e-9, '切线过切点（' + a + ',' + b + ') t=' + t),
      );
      if (!tan.vertical) {
        if (Math.abs(p.y) > 1e-6) {
          const analytic = -(b * b * p.x) / (a * a * p.y);
          maxSlopeError = Math.max(maxSlopeError, assertClose(tan.slope, analytic, SLOPE_TOLERANCE, '切线斜率（' + a + ',' + b + ') t=' + t));
          slopeChecks += 1;
        }
      } else {
        // 垂直切线只应出现在 y0≈0，即 x0≈±a，且方程为 x = a^2/x0
        if (Math.abs(p.y) > 1e-12) throw new Error('误判垂直切线：y0=' + p.y);
        assertClose(tan.xIntercept, (a * a) / p.x, 1e-9, '垂直切线截距');
        assertClose(Math.abs(p.x), a, 1e-9, '垂直切线切点横坐标');
        verticalChecks += 1;
      }
      // 焦半径和 = 长轴长
      const fs = focalRadiusSum(a, b, p.x, p.y);
      maxFociSumError = Math.max(maxFociSumError, assertClose(fs.sum, fs.majorAxis, 1e-9, '焦半径和（' + a + ',' + b + ') t=' + t));
    }
    // 焦点本身应在椭圆关系内：c^2 = |a^2 - b^2|，且焦点沿长轴
    const fs = foci(a, b);
    const c = Math.hypot(fs[0].x, fs[0].y);
    assertClose(c * c, Math.abs(a * a - b * b), 1e-9, '焦点距离 c^2（' + a + ',' + b + ')');
  }

  // 边界：非法参数全拒绝
  const badParams = [[0, 3], [-1, 3], [5, 0], [5, -2], [NaN, 3], [Infinity, 3], [5, NaN], [5, Infinity], ['5', 3], [5, '3']];
  for (const item of badParams) {
    assertThrows(() => assertEllipseParams(item[0], item[1]), '非法参数 (' + item[0] + ', ' + item[1] + ')');
    assertThrows(() => pointOnEllipse(item[0], item[1], 0.3), '非法参数 pointOnEllipse (' + item[0] + ', ' + item[1] + ')');
  }
  // 边界：非法 t
  for (const badT of [NaN, Infinity, -Infinity, '0.5']) {
    assertThrows(() => pointOnEllipse(5, 3, badT), '非法 t ' + String(badT));
  }
  // 边界：点不在椭圆上（含 NaN 坐标）全拒绝
  assertThrows(() => assertOnEllipse(5, 3, 1, 1), '不在椭圆上的点 (1,1)');
  assertThrows(() => assertOnEllipse(5, 3, 0, 3.1), '椭圆外的点 (0,3.1)');
  assertThrows(() => assertOnEllipse(5, 3, NaN, 0), 'NaN 坐标');
  assertThrows(() => tangentLine(5, 3, 1, 1), '不在椭圆上的点求切线');

  return {
    status: '通过',
    cases: cases.length,
    pointsPerCase: pointsPerCase,
    pointsChecked: pointsChecked,
    slopeChecks: slopeChecks,
    verticalChecks: verticalChecks,
    slopeTolerance: SLOPE_TOLERANCE,
    pointTolerance: POINT_TOLERANCE,
    maxSlopeError: maxSlopeError,
    maxPassThroughError: maxPassThroughError,
    maxFociSumError: maxFociSumError,
    boundaryRejections: badParams.length + 6,
    说明: '切线斜率/过切点/焦半径和全部对解析解通过 1e-9 容差；非法参数与椭圆外点全部拒绝。',
  };
}

// 直接 `node verify.mjs` 时独立运行并打印摘要；被 import 时不执行。
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const summary = runVerification();
    console.log('[mochi-modeling] 数值验证通过：'
      + summary.cases + ' 组参数 × ' + summary.pointsPerCase + ' 点，斜率核对 '
      + summary.slopeChecks + ' 次（垂直切线 ' + summary.verticalChecks + ' 次），最大斜率误差 '
      + summary.maxSlopeError.toExponential(3) + '，最大焦半径和误差 '
      + summary.maxFociSumError.toExponential(3) + '，边界拒绝 '
      + summary.boundaryRejections + ' 项。');
  } catch (error) {
    console.error('[mochi-modeling] 数值验证失败：' + (error && error.message ? error.message : String(error)));
    process.exit(1);
  }
}
