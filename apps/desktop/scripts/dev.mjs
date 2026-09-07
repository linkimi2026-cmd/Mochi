#!/usr/bin/env node
/**
 * 开发环境启动器：编译主进程 → 拉起 Electron。
 * Electron 主进程自己启动 `dsh --profile mochi-web --port 0`，不再维护第二套
 * Vite renderer；网页端和桌面端使用同一个 Harness SPA 与同一组插件。
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 本文件在 scripts/ 下，项目根是上一层
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;

const bin = (rel) => join(ROOT, "node_modules", ...rel.split("/"));

const children = [];

function run(cmd, args, opts = {}) {
  // 注意：env 是**整体替换**而不是与 process.env 合并。
  // 用 { ...process.env, ...opts.env } 的话，opts.env 里被 delete 掉的键
  // 会被 process.env 的原值重新填回来（spread 只覆盖"存在"的键）。
  // 清理 ELECTRON_RUN_AS_NODE 这类变量时，这个差别就是能不能启动的分界线。
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: opts.env ?? process.env,
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// 1) 编译主进程 + preload
console.log("[mochi] 编译主进程 …");
const tsc = spawn(NODE, [bin("typescript/bin/tsc"), "-p", "tsconfig.node.json"], {
  cwd: ROOT,
  stdio: "inherit",
});
const tscCode = await new Promise((resolve) => tsc.on("exit", resolve));
if (tscCode !== 0) {
  console.error("[mochi] 主进程编译失败，中止");
  process.exit(tscCode ?? 1);
}

// 2) 拉起 Electron；主进程内部等待 mochi-web Host 就绪后再载入窗口。
//
// MOCHI_NO_SANDBOX=1 是一个**仅用于调试**的逃生开关：在容器/受限终端里，
// Chromium 自己的沙箱会初始化失败并反复重启 GPU/网络服务，导致窗口起不来。
// 日常开发不要开——关掉 Chromium 沙箱会降低渲染进程的安全隔离。
const extraArgs = process.env.MOCHI_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];

// 必须清掉宿主环境泄漏进来的 Electron 控制变量，否则 Electron 会退化成纯 Node
// 运行：require("electron") 返回 Node 内置模块而非 Electron API，
// 表现为主进程里 app 是 undefined。从 IDE 集成终端启动时尤其容易踩到。
const cleanEnv = { ...process.env, DSH_TELEMETRY_DISABLED: "1" };
// DSH_HOME (or MOCHI_RUNTIME_HOME) remains an explicit override. Otherwise the
// Electron host and mochi.sh both use workspace/.mochi-home.nosync in dev.
// 允许通过环境变量覆盖 dsh / node 二进制（打包态走随包路径）。
for (const k of ["MOCHI_DSH_BIN", "MOCHI_DSH_NODE"]) {
  if (process.env[k]) cleanEnv[k] = process.env[k];
}
for (const key of Object.keys(cleanEnv)) {
  if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("ELECTRON_")) {
    delete cleanEnv[key];
  }
}

console.log("[mochi] 拉起 Electron + mochi-web …");
const electron = run(bin(".bin/electron"), [".", ...extraArgs], { env: cleanEnv });

electron.on("exit", (code) => {
  console.log(`[mochi] Electron 退出（code=${code}）`);
  shutdown(code ?? 0);
});
