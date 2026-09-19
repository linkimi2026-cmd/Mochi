"use strict";

/**
 * Native desktop installer entry point.
 *
 * This wrapper intentionally refuses a foreign platform/architecture. Mochi
 * ships `sharp` and `node-pty` through the official DSH dependency tree, so a
 * successful cross-package is not evidence that the installer works on the
 * target. CI calls the same script on native macOS and Windows runners.
 */

const { existsSync, readFileSync, statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { dirname, join, resolve } = require("node:path");
const {
  prepareReleaseInput,
  verifyReleaseInput,
} = require("./prepare-release-input.cjs");

const desktopRoot = resolve(__dirname, "..");
const electronBuilderCli = require.resolve("electron-builder/out/cli/cli.js", { paths: [desktopRoot] });
const TARGET_PLATFORM = Object.freeze({ mac: "darwin", win: "win32" });
const SUPPORTED_ARCHITECTURES = new Set(["arm64", "x64"]);

function packageMetadata() {
  return JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
}

function readValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 需要一个值。`);
  return value;
}

function parseArguments(argv = process.argv.slice(2)) {
  const known = new Set(["--target", "--arch", "--dir", "--release-input-root", "--campus-static-root"]);
  for (const argument of argv) {
    if (argument.startsWith("--") && !known.has(argument)) throw new Error(`不支持的桌面打包参数：${argument}`);
  }
  const target = readValue(argv, "--target") ?? "current";
  const arch = readValue(argv, "--arch") ?? process.arch;
  const releaseInputRoot = readValue(argv, "--release-input-root");
  const campusStaticRoot = readValue(argv, "--campus-static-root");
  const directoryOnly = argv.includes("--dir");
  if (!SUPPORTED_ARCHITECTURES.has(arch)) throw new Error(`不支持的桌面架构：${arch}`);
  if (target !== "current" && target !== "mac" && target !== "win") throw new Error(`不支持的桌面目标：${target}`);
  if (releaseInputRoot && campusStaticRoot) throw new Error("--release-input-root 与 --campus-static-root 不能同时使用。");
  return { target, arch, releaseInputRoot, campusStaticRoot, directoryOnly };
}

function resolvedTarget(target) {
  if (target === "current") {
    if (process.platform === "darwin") return "mac";
    if (process.platform === "win32") return "win";
    throw new Error(`当前平台 ${process.platform} 没有配置安装器目标；请在 macOS 或 Windows 原生 runner 上构建。`);
  }
  return target;
}

function assertNativeTarget(target, arch) {
  const expectedPlatform = TARGET_PLATFORM[target];
  if (process.platform !== expectedPlatform) {
    const platformName = target === "mac" ? "macOS" : "Windows";
    throw new Error(`${platformName} 安装器必须在原生 ${platformName} runner 构建；当前是 ${process.platform}/${process.arch}。`);
  }
  if (process.arch !== arch) {
    throw new Error(`${target}/${arch} 安装器必须在同架构原生 runner 构建；当前是 ${process.platform}/${process.arch}。`);
  }
}

function selectReleaseInput(options) {
  if (options.releaseInputRoot) {
    return verifyReleaseInput({ inputRoot: resolve(desktopRoot, options.releaseInputRoot) });
  }
  return prepareReleaseInput({ campusStaticRoot: options.campusStaticRoot });
}

function createElectronBuilderArgs(target, arch, directoryOnly) {
  // An empty target list falls back to build.mac.target's two architectures.
  // Specify the format so the requested architecture remains the only target.
  const format = directoryOnly ? "dir" : target === "mac" ? "dmg" : "nsis";
  return [electronBuilderCli, target === "mac" ? "--mac" : "--win", format, `--${arch}`, "--publish=never"];
}

function run(command, args, env, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    env,
    stdio: "inherit",
    ...extra,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 退出码为 ${result.status ?? "unknown"}。`);
}

// Node >= 18.20 / 20.12 refuses to spawn a `.cmd` shim directly (EINVAL, from
// the CVE-2024-27980 fix). Invoke npm's JavaScript entry with the current Node
// binary instead of the `npm.cmd` wrapper: identical result on every platform,
// no shell involved, and no quoting/注入 surface.
function npmCliPath() {
  const candidate = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(candidate)) return candidate;
  const bundled = join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(bundled)) return bundled;
  return null;
}

function runNpm(args, env) {
  const cli = npmCliPath();
  if (cli) {
    run(process.execPath, [cli, ...args], env);
    return;
  }
  // Fallback for a Node install without a bundled npm CLI: keep the platform
  // shim but go through a shell, which is what makes `.cmd` spawnable.
  run(process.platform === "win32" ? "npm.cmd" : "npm", args, env, {
    shell: process.platform === "win32",
  });
}

function expectedInstallerPath(target, arch) {
  const metadata = packageMetadata();
  const filename = target === "mac"
    ? `${metadata.build.productName}-${metadata.version}-mac-${arch}.dmg`
    : `${metadata.build.productName}-Setup-${metadata.version}-win-${arch}.exe`;
  return join(desktopRoot, metadata.build.directories.output, filename);
}

function runPackagingSeed(env) {
  // WO-3：打包前把首启凭据/模型链种子渲染进 resources/mochi-web/seeds/。
  // 无密钥源时脚本自身 warning 并 0 退出（安装包降级为设置页引导），不让构建崩。
  const result = spawnSync(process.execPath, [join(__dirname, "seed-packaging-keys.cjs")], { encoding: "utf8", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`打包种子脚本失败：${(result.stderr || result.stdout || "").trim()}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function packageDesktop(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const target = resolvedTarget(options.target);
  assertNativeTarget(target, options.arch);
  run(process.execPath, [join(__dirname, "check-dsh-host-peers.cjs")], process.env);
  runPackagingSeed(process.env);
  const releaseInput = selectReleaseInput(options);
  const env = { ...process.env, MOCHI_CAMPUS_STATIC_ROOT: releaseInput.staticRoot };
  runNpm(["run", "build"], env);
  // 原生 ABI 守卫：.forge-meta 声称已重建的模块，其二进制必须真能被 Electron ABI
  // 加载（2026-09-19 fs-ext 事故的守门人：陈旧 meta 会让 electron-builder 跳过重建）。
  run(process.execPath, [join(__dirname, "check-native-abi.cjs"), `--arch=${options.arch}`], env);
  const startedAt = Date.now();
  run(process.execPath, createElectronBuilderArgs(target, options.arch, options.directoryOnly), env);
  const installer = options.directoryOnly ? null : expectedInstallerPath(target, options.arch);
  if (installer) {
    if (!existsSync(installer) || !statSync(installer).isFile()) throw new Error(`打包完成但未找到预期安装器：${installer}`);
    if (statSync(installer).mtimeMs < startedAt) throw new Error(`预期安装器不是本次构建生成：${installer}`);
  }
  return {
    target,
    arch: options.arch,
    installer,
    directoryOnly: options.directoryOnly,
    releaseInputManifestSha256: releaseInput.manifestSha256,
  };
}

if (require.main === module) {
  try {
    const result = packageDesktop();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`[mochi] 桌面打包失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  TARGET_PLATFORM,
  assertNativeTarget,
  createElectronBuilderArgs,
  expectedInstallerPath,
  packageDesktop,
  parseArguments,
  resolvedTarget,
  runPackagingSeed,
  selectReleaseInput,
};
