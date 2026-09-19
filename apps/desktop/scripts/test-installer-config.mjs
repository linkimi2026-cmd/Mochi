#!/usr/bin/env node
/**
 * Contract test for installer configuration and native-only packaging entry.
 * It does not launch Electron or create a release artifact.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const requireFromHere = createRequire(import.meta.url);
const desktopPackage = requireFromHere(join(desktopRoot, "package.json"));
const packager = requireFromHere(join(scriptDir, "package-desktop.cjs"));
const prepareMochiResources = requireFromHere(join(scriptDir, "prepare-mochi-resources.cjs"));
const { getFileMatchers, getMainFileMatchers } = requireFromHere("app-builder-lib/out/fileMatcher");

const build = desktopPackage.build;
assert.equal(build.appId, "cn.jiaxinglian.mochi", "appId must remain stable for existing installs/upgrades");
assert.equal(build.directories.output, "release", "installer output must not collide with renderer dist input");
assert.equal(build.directories.buildResources, "build", "installer icon resources must have a stable project-local root");
assert.equal(build.beforePack, "./scripts/prepare-mochi-resources.cjs");
assert.deepEqual(build.extraResources, [{ from: ".mochi-package-resources-v1.nosync", to: "mochi" }]);
assert.equal(build.dmg.artifactName, "${productName}-${version}-mac-${arch}.${ext}");
assert.equal(build.nsis.artifactName, "${productName}-Setup-${version}-win-${arch}.${ext}");
assert.equal(build.nsis.oneClick, false, "Windows installer must remain assisted");
assert.equal(build.nsis.perMachine, false, "assisted installer must offer a user-scoped install path");
assert.equal(build.nsis.allowToChangeInstallationDirectory, true);
assert.equal(build.nsis.createDesktopShortcut, true);
assert.equal(build.nsis.createStartMenuShortcut, true);
assert.equal(build.npmRebuild, true, "native DSH dependencies must rebuild for the target Electron ABI");
assert.equal(build.nativeRebuilder, "sequential");
assert.equal(build.mac.identity, null, "unsigned local builds must not assume an unavailable signing identity");
assert.equal(build.mac.icon, "icon.icns", "macOS builds must use the packaged Mochi icon");
assert.equal(build.win.icon, "icon.ico", "Windows builds must use the packaged Mochi icon");
assert.equal(build.win.verifyUpdateCodeSignature, false, "no signing certificate is configured in this repository");
assert.deepEqual(
  build.asarUnpack,
  ["node_modules/**/*"],
  "all production dependencies must share the physical app.asar.unpacked node_modules tree with physical DSH importers",
);
assert.doesNotMatch(JSON.stringify(build.extraResources), /credentials|sessions|\.wrangler|\.dev\.vars/i, "installer resource input must not name user state or secrets");

// ---------------------------------------------------------------------------
// 安装包体积 / 文件数守卫（2026-09-12）
//
// 老师反馈「点了安装向导之后慢得离谱」。实测根因是安装要往磁盘上新建 41,150 个
// 文件，Windows Defender 逐个扫描 → 十几分钟。下面这些排除规则砍掉其中
// 12,775 个（*.map / *.d.ts / *.d.mts / *.d.cts，运行时永远不会被加载），
// 占文件数 31.0%，压缩后省 41.9MB。
//
// 规则在两处各写一份：这里（electron-builder 的 glob，管 app.asar.unpacked）
// 和 prepare-mochi-resources.cjs（JS 正则，管 resources/mochi/node_modules）。
// 少写一处或写歪一处，安装包会**静默**涨回 4 万个文件、装机重新变慢，
// 而且不报任何错 —— 所以必须由测试钉死两边一致。
// ---------------------------------------------------------------------------
const NODE_MODULES_FILE_EXCLUSIONS = [
  "!node_modules/**/*.map",
  "!node_modules/**/*.d.ts",
  "!node_modules/**/*.d.mts",
  "!node_modules/**/*.d.cts",
];
assert.deepEqual(
  build.files,
  ["dist-electron/**/*", "package.json", ...NODE_MODULES_FILE_EXCLUSIONS],
  "安装包的 node_modules 排除规则被改动或删掉了；这会直接让装机的文件数涨回 4 万",
);
for (const glob of NODE_MODULES_FILE_EXCLUSIONS) {
  const extension = glob.slice("!node_modules/**/*".length);
  assert.equal(
    prepareMochiResources.isExcludedFromPackagedRuntimePayload(`node_modules/pkg/index${extension}`),
    true,
    `${glob} 在 apps/desktop/package.json 里排除了 ${extension}，但 prepare-mochi-resources.cjs 的正则没覆盖它 —— 两棵树会不一致`,
  );
}
// 反向对照：运行时真的会被加载的扩展名一个都不许被排除。
for (const keep of [".js", ".mjs", ".cjs", ".json", ".node", ".wasm", ".exe", ".dll", ".bcmap", ".pak"]) {
  assert.equal(
    prepareMochiResources.isExcludedFromPackagedRuntimePayload(`node_modules/pkg/asset${keep}`),
    false,
    `${keep} 是运行时会加载的文件，不许被排除规则命中`,
  );
}
assert.equal(
  prepareMochiResources.isExcludedFromPackagedRuntimePayload("node_modules/pkg/LICENSE"),
  false,
  "LICENSE 是合规文件，不许被排除",
);

const iconRoot = join(desktopRoot, build.directories.buildResources);
const pngIcon = readFileSync(join(iconRoot, "icon.png"));
assert.deepEqual(pngIcon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "Mochi PNG icon must be a real PNG");
assert.equal(pngIcon.readUInt32BE(16), 1024, "Mochi PNG icon must retain a Retina-sized source");
assert.equal(pngIcon.readUInt32BE(20), 1024, "Mochi PNG icon must be square");
assert.equal(readFileSync(join(iconRoot, build.mac.icon)).subarray(0, 4).toString("ascii"), "icns", "macOS icon must be an ICNS asset");
const windowsIcon = readFileSync(join(iconRoot, build.win.icon));
assert.equal(windowsIcon.readUInt16LE(0), 0, "Windows ICO reserved header must be zero");
assert.equal(windowsIcon.readUInt16LE(2), 1, "Windows icon must declare ICO type");
assert.deepEqual(
  [...Array(windowsIcon.readUInt16LE(4)).keys()].map((index) => windowsIcon[6 + index * 16] || 256),
  [16, 24, 32, 48, 64, 128, 256],
  "Windows icon must contain the supported desktop size set",
);
for (let index = 0; index < windowsIcon.readUInt16LE(4); index += 1) {
  const entryOffset = 6 + index * 16;
  const dataOffset = windowsIcon.readUInt32LE(entryOffset + 12);
  const dataLength = windowsIcon.readUInt32LE(entryOffset + 8);
  assert.ok(dataOffset >= 6 + windowsIcon.readUInt16LE(4) * 16 && dataOffset + dataLength <= windowsIcon.length, "Windows ICO entry must stay inside the file");
}
assert.equal(existsSync(join(iconRoot, "ICON-SOURCE.md")), true, "single-icon crop provenance must remain reviewable");

function mainMatcher(appDir) {
  const [matcher] = getMainFileMatchers(
    appDir,
    join(appDir, "app-destination"),
    (value) => value,
    build.mac,
    {
      info: {
        projectDir: appDir,
        buildResourcesDir: "build",
        isPrepackedAppAsar: false,
        config: build,
        debugLogger: { isEnabled: false, add() {} },
      },
    },
    join(appDir, build.directories.output),
    false,
  );
  return matcher;
}

function mainFileFilter(appDir) {
  return mainMatcher(appDir).createFilter();
}

function asarUnpackFilter(appDir) {
  const matchers = getFileMatchers(
    build,
    "asarUnpack",
    join(appDir, "app.asar.unpacked"),
    {
      macroExpander: (value) => value,
      customBuildOptions: build.mac,
      globalOutDir: join(appDir, build.directories.output),
      defaultSrc: appDir,
    },
  );
  assert.equal(matchers?.length, 1, "asarUnpack must resolve to one real builder matcher");
  return matchers[0].createFilter();
}

const matcherFixture = mkdtempSync(join(tmpdir(), "mochi-installer-file-matcher-"));
try {
  const oldAppInfo = join(matcherFixture, "dist", "mac-arm64", "Mochi.app", "Contents", "Info.plist");
  const oldAppAsar = join(matcherFixture, "dist", "mac-arm64", "Mochi.app", "Contents", "Resources", "app.asar");
  const currentMain = join(matcherFixture, "dist-electron", "main.js");
  const manifest = join(matcherFixture, "package.json");
  for (const file of [oldAppInfo, oldAppAsar, currentMain, manifest]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "fixture\n");
  }

  const filter = mainFileFilter(matcherFixture);
  assert.equal(filter(oldAppInfo, statSync(oldAppInfo)), false, "builder matcher must exclude the old macOS app Info.plist");
  assert.equal(filter(oldAppAsar, statSync(oldAppAsar)), false, "builder matcher must exclude the old macOS app asar");
  assert.equal(filter(currentMain, statSync(currentMain)), true, "builder matcher must retain dist-electron/main.js");
  assert.equal(filter(manifest, statSync(manifest)), true, "builder matcher must retain package.json");
} finally {
  rmSync(matcherFixture, { recursive: true, force: true });
}

const unpackFixture = mkdtempSync(join(tmpdir(), "mochi-installer-unpack-matcher-"));
try {
  const unpackedFiles = [
    join(unpackFixture, "node_modules", "js-yaml", "index.js"),
    join(unpackFixture, "node_modules", "argparse", "index.js"),
    join(unpackFixture, "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js"),
    join(unpackFixture, "node_modules", "node-pty", "build", "Release", "pty.node"),
    join(unpackFixture, "node_modules", "sharp", "lib", "sharp.js"),
    join(unpackFixture, "node_modules", "@img", "sharp-platform", "lib", "sharp.node"),
  ];
  const nonNodeModule = join(unpackFixture, "dist-electron", "main.js");
  for (const file of [...unpackedFiles, nonNodeModule]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "fixture\n");
  }
  const unpackFilter = asarUnpackFilter(unpackFixture);
  for (const file of unpackedFiles) {
    assert.equal(unpackFilter(file, statSync(file)), true, "asarUnpack matcher must include " + file.slice(unpackFixture.length + 1));
  }
  assert.equal(unpackFilter(nonNodeModule, statSync(nonNodeModule)), false, "asarUnpack matcher must not unpack non-node_modules files");
} finally {
  rmSync(unpackFixture, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// node_modules 排除规则的**真实生效性**验证
//
// 上面只断言了 `build.files` 里写了那几条负向模式，但「写了」不等于「生效」。
// 实测过两件事（都不能偷懒）：
//   1. `getMainFileMatchers` 的 filter 对 node_modules 里**所有**文件都返回 false
//      —— 主匹配器用的是 `!**/node_modules`，它压根不管 node_modules 内部，测不了。
//   2. 真正决定 node_modules 收哪些文件的是 `platformPackager.js` 里的
//      `getNodeModuleFileMatcher()`：它**只**抽取 `config.files` 中以 `!` 开头的模式，
//      然后自动前置一个 `**/*`。所以在这个 matcher 上问「会不会被复制」才是有效的问法。
// ---------------------------------------------------------------------------
const { getNodeModuleFileMatcher } = requireFromHere("app-builder-lib/out/fileMatcher");
const pruneFixture = mkdtempSync(join(tmpdir(), "mochi-installer-node-modules-prune-"));
try {
  const pruneMatcher = getNodeModuleFileMatcher(
    pruneFixture,
    join(pruneFixture, "app-destination"),
    (value) => value,
    build.win,
    { config: build, debugLogger: { isEnabled: false, add() {} } },
  );
  const pruneFilter = pruneMatcher.createFilter();
  const kept = [
    "node_modules/mermaid/dist/mermaid.js",
    "node_modules/mermaid/dist/mermaid.mjs",
    "node_modules/mermaid/package.json",
    "node_modules/sharp/build/Release/sharp.node",
    "node_modules/@vscode/ripgrep/bin/rg.exe",
    "node_modules/pdfjs-dist/cmaps/Adobe-Japan1.bcmap",
    "node_modules/pkg/LICENSE",
    "node_modules/pkg/NOTICE",
    "node_modules/pkg/index.js",
  ];
  const dropped = [
    "node_modules/mermaid/dist/mermaid.js.map",
    "node_modules/es-toolkit/dist/index.js.map",
    "node_modules/zod/index.d.ts",
    "node_modules/zod/index.d.mts",
    "node_modules/zod/index.d.cts",
  ];
  for (const relative of [...kept, ...dropped]) {
    const absolute = join(pruneFixture, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, "fixture\n");
  }
  for (const relative of kept) {
    const absolute = join(pruneFixture, relative);
    assert.equal(
      pruneFilter(absolute, statSync(absolute)),
      true,
      `运行时会加载 ${relative}，排除规则不许把它踢出安装包`,
    );
  }
  for (const relative of dropped) {
    const absolute = join(pruneFixture, relative);
    assert.equal(
      pruneFilter(absolute, statSync(absolute)),
      false,
      `${relative} 是运行时永远不加载的文件，必须被排除 —— 否则装机文件数会涨回 4 万`,
    );
  }
} finally {
  rmSync(pruneFixture, { recursive: true, force: true });
}

assert.deepEqual(
  packager.parseArguments(["--target", "mac", "--arch", "arm64", "--dir"]),
  { target: "mac", arch: "arm64", releaseInputRoot: undefined, campusStaticRoot: undefined, directoryOnly: true },
);
assert.throws(() => packager.parseArguments(["--target", "win", "--release-input-root", "input", "--campus-static-root", "client"]), /不能同时使用/);
assert.throws(() => packager.parseArguments(["--unsupported"]), /不支持的桌面打包参数/);
assert.deepEqual(packager.createElectronBuilderArgs("mac", "arm64", false).slice(1), ["--mac", "dmg", "--arm64", "--publish=never"]);
assert.deepEqual(packager.createElectronBuilderArgs("win", "x64", true).slice(1), ["--win", "dir", "--x64", "--publish=never"]);
assert.match(packager.expectedInstallerPath("mac", "arm64"), /release[\\/]Mochi-0\.1\.0-mac-arm64\.dmg$/);
assert.match(packager.expectedInstallerPath("win", "x64"), /release[\\/]Mochi-Setup-0\.1\.0-win-x64\.exe$/);

if (process.platform === "darwin" && process.arch === "arm64") {
  assert.doesNotThrow(() => packager.assertNativeTarget("mac", "arm64"));
  assert.throws(() => packager.assertNativeTarget("win", "x64"), /Windows 安装器必须在原生 Windows runner/);
  assert.throws(() => packager.assertNativeTarget("mac", "x64"), /同架构原生 runner/);
}

console.log("[test-installer-config] PASS: native installer contracts, physical production node_modules, isolated resources, and unsigned release boundaries are explicit.");

// Check the installed builder's interpretation, not only the argv spelling.
const { configureBuildCommand, createYargs, normalizeOptions } = requireFromHere("electron-builder/out/builder");
const { Arch } = requireFromHere("builder-util");
for (const [platform, arch, directoryOnly, format] of [["mac", "arm64", false, "dmg"], ["mac", "x64", false, "dmg"], ["win", "x64", false, "nsis"], ["win", "x64", true, "dir"]]) {
  const argv = packager.createElectronBuilderArgs(platform, arch, directoryOnly).slice(1);
  const normalized = normalizeOptions(configureBuildCommand(createYargs()).parse(argv));
  assert.equal(normalized.targets.size, 1);
  assert.deepEqual([...normalized.targets.values()][0], new Map([[Arch[arch], [format]]]), "explicit format prevents multi-architecture config fallback");
}
