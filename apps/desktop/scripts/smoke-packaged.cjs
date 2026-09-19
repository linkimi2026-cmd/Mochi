"use strict";

/**
 * Packaged-app launch smoke (release acceptance gate ⑥).
 *
 * The five static release checks prove the package contains what the
 * manifest says; only launching proves the package actually runs. This
 * driver launches a packaged Mochi app with MOCHI_DESKTOP_SMOKE=1 and
 * succeeds only when the app prints MOCHI_DESKTOP_SMOKE_OK.
 *
 * Environment traps handled here (all three bit us on 2026-09-19):
 *  - ELECTRON_RUN_AS_NODE et al. inherited from an Electron host turns the
 *    app into a Node REPL → strip every ELECTRON_* var.
 *  - Sandbox init fails on hardened hosts → pass --no-sandbox.
 *  - A live SingletonLock of a running Mochi makes app.quit() fire → pass a
 *    throwaway --user-data-dir.
 *
 * Usage:
 *   node scripts/smoke-packaged.cjs <path-to-Mochi.app | Mochi.exe>
 *   npm run smoke:packaged -- <path>
 */

const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const SMOKE_TIMEOUT_MS = 90_000;

function appBinary(appPath) {
  const resolved = resolve(appPath);
  if (!existsSync(resolved)) throw new Error(`应用不存在：${resolved}`);
  if (resolved.endsWith(".app")) {
    const name = "Mochi";
    const binary = join(resolved, "Contents", "MacOS", name);
    if (!existsSync(binary)) throw new Error(`.app 内未找到可执行文件：${binary}`);
    return { binary, extraArgs: [] };
  }
  return { binary: resolved, extraArgs: [] };
}

function smokeEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ELECTRON_")) delete env[key];
  }
  delete env.NODE_OPTIONS;
  const userData = mkdtempSync(join(tmpdir(), "mochi-smoke-ud-"));
  const home = mkdtempSync(join(tmpdir(), "mochi-smoke-home-"));
  Object.assign(env, {
    MOCHI_DESKTOP_SMOKE: "1",
    DSH_TELEMETRY_DISABLED: "1",
    DSH_HOME: home,
    MOCHI_RUNTIME_HOME: home,
  });
  return { env, userData, home };
}

function main(argv = process.argv.slice(2)) {
  const appPath = argv[0];
  if (!appPath) {
    process.stderr.write("用法：node scripts/smoke-packaged.cjs <Mochi.app | Mochi.exe>\n");
    process.exitCode = 1;
    return;
  }
  const { binary, extraArgs } = appBinary(appPath);
  const { env, userData, home } = smokeEnvironment();
  const args = [...extraArgs, "--no-sandbox", "--role=teacher", `--user-data-dir=${userData}`];

  process.stdout.write(`[mochi-smoke] 启动 ${binary}\n`);
  const startedAt = Date.now();
  const child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "pipe"] });

  let output = "";
  const collect = (chunk) => { output += chunk.toString("utf8"); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const timer = setTimeout(() => {
    process.stderr.write("[mochi-smoke] 超时（90s）仍未看到冒烟结论，杀掉进程。\n");
    child.kill("SIGKILL");
  }, SMOKE_TIMEOUT_MS);

  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    const elapsed = Math.round((Date.now() - startedAt) / 100) / 10;
    const ok = output.includes("MOCHI_DESKTOP_SMOKE_OK");
    const tail = output.trim().split("\n").slice(-12).join("\n");
    process.stdout.write(`[mochi-smoke] 耗时 ${elapsed}s exit=${code ?? signal}\n${tail}\n`);
    try {
      rmSync(userData, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    } catch { /* temp cleanup is best-effort */ }
    if (ok) {
      process.stdout.write("[mochi-smoke] 验收通过：MOCHI_DESKTOP_SMOKE_OK\n");
      return;
    }
    process.stderr.write("[mochi-smoke] 验收失败：未见 MOCHI_DESKTOP_SMOKE_OK（上方为输出尾部）。\n");
    process.exitCode = 1;
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[mochi-smoke] 冒烟驱动自身失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
