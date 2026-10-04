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
 *   node scripts/smoke-packaged.cjs <path-to-Mochi.app | Mochi.exe> [--role=teacher|classroom]
 *   npm run smoke:packaged -- <path> --role=classroom
 */

const { existsSync, mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { join, resolve, dirname } = require("node:path");
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
  for (const key of ["MOCHI_DSH_BIN","MOCHI_DSH_NODE","MOCHI_RUNTIME_NODE_MODULES","MOCHI_RUNTIME_RESOURCES","MOCHI_PLUGIN_ROOT","MOCHI_WORKSPACE_ROOT","MOCHI_SKILLS_DIR","NODE_PATH"]) delete env[key];
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

function smokeResultAccepted(code, output, spawnError = null) {
  return spawnError === null && code === 0
    && output.includes("MOCHI_DESKTOP_SMOKE_OK")
    && !output.includes("MOCHI_DESKTOP_SMOKE_FAILED")
    && !/failed to import/iu.test(output);
}

function main(argv = process.argv.slice(2)) {
  const [appPath, ...options] = argv;
  if (!appPath) {
    process.stderr.write("用法：node scripts/smoke-packaged.cjs <Mochi.app | Mochi.exe> [--role=teacher|classroom]\n");
    process.exitCode = 1;
    return;
  }
  let role = "teacher";
  let expectSeeds = false;
  for (const option of options) {
    if (option === "--role=teacher" || option === "--role=classroom") {
      role = option.slice("--role=".length);
    } else if (option === "--expect-seeds") {
      expectSeeds = true;
    } else {
      throw new Error(`不支持的冒烟参数：${option}`);
    }
  }
  const { binary, extraArgs } = appBinary(appPath);
  const { env, userData, home } = smokeEnvironment();
  if (expectSeeds) {
    delete env.MIMO_API_KEY; delete env.MOCHI_AIAAA_API_KEY;
  }
  const args = [...extraArgs, "--no-sandbox", `--role=${role}`, `--user-data-dir=${userData}`];

  process.stdout.write(`[mochi-smoke] 启动 ${role} ${binary}\n`);
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

  let finished = false;
  const finish = (code, signal, spawnError = null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const elapsed = Math.round((Date.now() - startedAt) / 100) / 10;
    let ok = smokeResultAccepted(code, output, spawnError);
    if (ok && expectSeeds) {
      try {
        const resources = appPath.endsWith(".app") ? join(resolve(appPath), "Contents", "Resources") : join(dirname(binary), "resources");
        const seed = JSON.parse(readFileSync(join(resources, "mochi", "profile", "seeds", "credentials-seed.json"), "utf8"));
        const stored = require("yaml").parse(readFileSync(join(home, ".credentials.yaml"), "utf8"));
        const refs = role === "teacher" ? ["MIMO_API_KEY", "MOCHI_AIAAA_API_KEY"] : ["MIMO_API_KEY"];
        ok = refs.every(ref => typeof seed.refs?.[ref] === "string" && seed.refs[ref].length > 0 && stored.refs?.[ref] === seed.refs[ref]);
        if (role === "classroom" && stored.refs?.MOCHI_AIAAA_API_KEY) ok = false;
        process.stdout.write(`[mochi-smoke] ${role} 首启凭据注入：${ok ? "通过" : "失败"}（仅检查引用与一致性）\n`);
      } catch {
        ok = false;
        process.stderr.write("[mochi-smoke] 安装包首启凭据缺失或无法读取。\n");
      }
    }
    const tail = output.trim().split("\n").slice(-12).join("\n");
    process.stdout.write(`[mochi-smoke] 耗时 ${elapsed}s exit=${code ?? signal}\n${tail}\n`);
    try {
      rmSync(userData, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    } catch { /* temp cleanup is best-effort */ }
    if (ok) {
      process.stdout.write(`[mochi-smoke] ${role} 验收通过：MOCHI_DESKTOP_SMOKE_OK\n`);
      return;
    }
    process.stderr.write(`[mochi-smoke] ${role} 验收失败：进程未正常退出或未见 MOCHI_DESKTOP_SMOKE_OK${spawnError ? `（${spawnError.message}）` : ""}。\n`);
    process.exitCode = 1;
  };
  child.once("close", (code, signal) => finish(code, signal));
  child.once("error", (error) => finish(null, null, error));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[mochi-smoke] 冒烟驱动自身失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, smokeResultAccepted };
