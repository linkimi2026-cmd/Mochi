#!/usr/bin/env node
/**
 * 开发环境启动器：编译主进程 → 起 Vite dev server → 就绪后拉起 Electron。
 *
 * 为什么不用 concurrently：Electron 在 Vite 还没监听完就去 loadURL，会白屏一次。
 * 这里显式探活 5178 后再启动，并且先 tsc 编译 main/preload
 *（package.json 的 main 指向 dist-electron/main.js，没编译会直接报找不到模块）。
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 本文件在 scripts/ 下，项目根是上一层
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;
const DEV_URL = "http://127.0.0.1:5178";

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

async function waitForVite(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(DEV_URL, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // 还没起来，继续等
    }
    await delay(300);
  }
  return false;
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

// 2) 起 Vite
console.log("[mochi] 启动 Vite dev server …");
run(NODE, [bin("vite/bin/vite.js")]);

if (!(await waitForVite())) {
  console.error("[mochi] Vite 未能在 60s 内就绪，放弃启动 Electron");
  shutdown(1);
}

// 3) 拉起 Electron
//
// MOCHI_NO_SANDBOX=1 是一个**仅用于调试**的逃生开关：在容器/受限终端里，
// Chromium 自己的沙箱会初始化失败并反复重启 GPU/网络服务，导致窗口起不来。
// 日常开发不要开——关掉 Chromium 沙箱会降低渲染进程的安全隔离。
const extraArgs = process.env.MOCHI_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];

// 必须清掉宿主环境泄漏进来的 Electron 控制变量，否则 Electron 会退化成纯 Node
// 运行：require("electron") 返回 Node 内置模块而非 Electron API，
// 表现为主进程里 app 是 undefined。从 IDE 集成终端启动时尤其容易踩到。
const cleanEnv = { ...process.env, DSH_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(cleanEnv)) {
  if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("ELECTRON_")) {
    delete cleanEnv[key];
  }
}

console.log("[mochi] Vite 就绪，拉起 Electron …");
const electron = run(bin(".bin/electron"), [".", ...extraArgs], { env: cleanEnv });

electron.on("exit", (code) => {
  console.log(`[mochi] Electron 退出（code=${code}），关闭 Vite`);
  shutdown(code ?? 0);
});
