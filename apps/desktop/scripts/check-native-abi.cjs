"use strict";

/**
 * Pre-pack native ABI guard.
 *
 * Why this exists (2026-09-19 incident): @electron/rebuild caches its verdict
 * in build/<type>/.forge-meta as a one-line text "<arch>--<abi>" and trusts
 * that text on the next run (module-rebuilder.js alreadyBuiltByRebuild()).
 * It never re-reads the binary. If anything re-runs a module's own
 * `node-gyp configure build` for the system Node AFTER electron/rebuild
 * (fs-ext's `install` script does exactly that), build/Release/*.node is
 * silently replaced with a Node-ABI binary while .forge-meta still claims
 * the Electron ABI. electron-builder then ships the broken binary because
 * the stale meta makes it skip the rebuild. A fresh CI checkout is immune
 * (no pre-existing meta); a dirty local node_modules is not.
 *
 * Check: for every module whose .forge-meta matches the target arch+ABI
 * (i.e. exactly the modules electron-builder will SKIP rebuilding), the
 * binaries in build/Release must actually load under an Electron-ABI
 * runtime. Load, don't trust text.
 *
 * Probe runtime resolution (first hit wins):
 *   1. --probe-runtime <path> / MOCHI_ABI_PROBE_RUNTIME env
 *      (any Electron binary; it is run with ELECTRON_RUN_AS_NODE=1)
 *   2. <desktop>/release/mac-arm64/Mochi.app/Contents/MacOS/Mochi
 *   3. <desktop>/release/mac/Mochi.app/Contents/MacOS/Mochi
 *   4. <desktop>/release/win-unpacked/Mochi.exe
 * When no probe runtime exists the check warns and passes (fail-open):
 * CI fresh checkouts have freshly-written meta and no packaged app yet.
 */

const { createHash } = require("node:crypto");
const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { dirname, join, resolve } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const nodeModulesRoot = join(desktopRoot, "node_modules");
const PROBE_SOURCE = "try{require(process.argv[1]);console.log('LOADED')}catch(e){var m=(e.message||'').split('\\n')[0];console.log('FAILED: '+m.slice(0,200))}";

function readValue(argv, name) {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 需要一个值。`);
  return value;
}

function parseArguments(argv) {
  const known = new Set(["--arch", "--probe-runtime"]);
  for (const argument of argv) {
    if (argument.startsWith("--") && !known.has(argument.split("=")[0])) throw new Error(`不支持的参数：${argument}`);
  }
  const arch = readValue(argv, "--arch") ?? process.arch;
  const probeRuntime = readValue(argv, "--probe-runtime") ?? process.env.MOCHI_ABI_PROBE_RUNTIME;
  return { arch, probeRuntime };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function* walkForgeMeta(root, depth = 0) {
  if (depth > 6 || !existsSync(root)) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const metaPath = join(dir, "build", "Release", ".forge-meta");
    if (existsSync(metaPath)) yield { moduleDir: dir, metaPath };
    else yield* walkForgeMeta(dir, depth + 1);
  }
}

function defaultProbeRuntime() {
  const candidates = [
    join(desktopRoot, "release", "mac-arm64", "Mochi.app", "Contents", "MacOS", "Mochi"),
    join(desktopRoot, "release", "mac", "Mochi.app", "Contents", "MacOS", "Mochi"),
    join(desktopRoot, "release", "win-unpacked", "Mochi.exe"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

// Electron major version -> NODE_MODULE_VERSION. Only versions Mochi can ship
// matter here; an unknown version disables the probe (fail-open) instead of
// guessing. Electron 39 (apps/desktop devDependency) maps to 140.
const ELECTRON_NODE_MODULE_VERSION = Object.freeze({ 39: 140 });

function loadsWithProbeRuntime(probeRuntime, binaryPath) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ELECTRON_")) delete env[key];
  }
  env.ELECTRON_RUN_AS_NODE = "1";
  delete env.NODE_OPTIONS;
  const result = spawnSync(probeRuntime, ["-e", PROBE_SOURCE, binaryPath], {
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { loaded: output.startsWith("LOADED"), output: output.split("\n")[0] ?? "" };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const metaVersion = ELECTRON_NODE_MODULE_VERSION;
  const electronVersion = require(join(desktopRoot, "node_modules", "electron", "package.json")).version.split(".")[0];
  const expectedAbi = metaVersion[electronVersion];
  const probeRuntime = options.probeRuntime ?? defaultProbeRuntime();

  const modules = [...walkForgeMeta(nodeModulesRoot)];
  if (modules.length === 0) {
    process.stdout.write("[mochi-abi] node_modules 下没有任何 .forge-meta，无事可查。\n");
    return;
  }
  if (expectedAbi === undefined) {
    process.stdout.write(`[mochi-abi] 未知 Electron 主版本 ${electronVersion}，无法确定目标 ABI；跳过（fail-open）。\n`);
    return;
  }

  const failures = [];
  const probed = [];
  for (const { moduleDir, metaPath } of modules) {
    const moduleName = moduleDir.split("node_modules").pop().replace(/^[/\\]/, "");
    const meta = readFileSync(metaPath, "utf8").trim();
    const [metaArch, metaAbi] = meta.split("--");
    const releaseDir = join(moduleDir, "build", "Release");
    const binaries = readdirSync(releaseDir).filter((name) => name.endsWith(".node"));

    if (metaArch !== options.arch || Number(metaAbi) !== expectedAbi) {
      process.stdout.write(`[mochi-abi] ${moduleName}: meta=${meta} 与目标 ${options.arch}--${expectedAbi} 不一致 → 打包时会真实重建，跳过检查。\n`);
      continue;
    }

    // electron-builder will SKIP rebuilding this module (meta matches target).
    // Every build/Release binary must therefore already be Electron-ABI.
    if (!probeRuntime || !existsSync(probeRuntime)) {
      process.stdout.write(`[mochi-abi] ⚠ ${moduleName}: meta=${meta} 声称已是目标 ABI，但找不到探测用 Electron 运行时，无法验证二进制（fail-open）。建议先出一版包再跑本检查。\n`);
      continue;
    }
    for (const binary of binaries) {
      const binaryPath = join(releaseDir, binary);
      const { loaded, output } = loadsWithProbeRuntime(probeRuntime, binaryPath);
      probed.push({ moduleName, binary, loaded, output });
      if (!loaded) {
        failures.push({ moduleName, binary, meta, output, sha: sha256(binaryPath) });
      }
    }
  }

  for (const item of probed) {
    process.stdout.write(`[mochi-abi] ${item.loaded ? "PASS" : "FAIL"} ${item.moduleName}/${item.binary} ${item.loaded ? "" : `→ ${item.output}`}\n`);
  }

  if (failures.length > 0) {
    process.stderr.write("[mochi-abi] 检测到「.forge-meta 声称已重建但二进制不是 Electron ABI」的陈旧缓存：\n");
    for (const failure of failures) {
      process.stderr.write(`[mochi-abi]   ${failure.moduleName}/build/Release/${failure.binary} sha256=${failure.sha.slice(0, 16)}… meta=${failure.meta}\n`);
      process.stderr.write(`[mochi-abi]     探针输出: ${failure.output}\n`);
      process.stderr.write(`[mochi-abi]     修复: rm "${join(failure.moduleName, "build", "Release", ".forge-meta")}" 后重跑打包（强制真实重建），或用 bin/ 下对应 ABI 目录里的二进制回填 build/Release。\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`[mochi-abi] 原生模块 ABI 守卫通过：${probed.length} 个二进制均为 Electron ABI ${expectedAbi}。\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[mochi-abi] 守卫自身失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
