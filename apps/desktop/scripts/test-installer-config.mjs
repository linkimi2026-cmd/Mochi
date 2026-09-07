#!/usr/bin/env node
/**
 * Contract test for installer configuration and native-only packaging entry.
 * It does not launch Electron or create a release artifact.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const requireFromHere = createRequire(import.meta.url);
const desktopPackage = requireFromHere(join(desktopRoot, "package.json"));
const packager = requireFromHere(join(scriptDir, "package-desktop.cjs"));
const { getFileMatchers, getMainFileMatchers } = requireFromHere("app-builder-lib/out/fileMatcher");

const build = desktopPackage.build;
assert.equal(build.appId, "cn.jiaxinglian.mochi", "appId must remain stable for existing installs/upgrades");
assert.equal(build.directories.output, "release", "installer output must not collide with renderer dist input");
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
assert.equal(build.win.verifyUpdateCodeSignature, false, "no signing certificate is configured in this repository");
assert.deepEqual(
  build.asarUnpack,
  ["node_modules/**/*"],
  "all production dependencies must share the physical app.asar.unpacked node_modules tree with physical DSH importers",
);
assert.doesNotMatch(JSON.stringify(build.extraResources), /credentials|sessions|\.wrangler|\.dev\.vars/i, "installer resource input must not name user state or secrets");
assert.deepEqual(build.files, ["dist-electron/**/*", "package.json"], "installer input must contain only the current main-process build and manifest");

function mainFileFilter(appDir) {
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
  return matcher.createFilter();
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

assert.deepEqual(
  packager.parseArguments(["--target", "mac", "--arch", "arm64", "--dir"]),
  { target: "mac", arch: "arm64", releaseInputRoot: undefined, campusStaticRoot: undefined, directoryOnly: true },
);
assert.throws(() => packager.parseArguments(["--target", "win", "--release-input-root", "input", "--campus-static-root", "client"]), /不能同时使用/);
assert.throws(() => packager.parseArguments(["--unsupported"]), /不支持的桌面打包参数/);
assert.deepEqual(packager.createElectronBuilderArgs("mac", "arm64", false).slice(1), ["--mac", "--arm64", "--publish=never"]);
assert.deepEqual(packager.createElectronBuilderArgs("win", "x64", true).slice(1), ["--win", "--x64", "--publish=never", "--dir"]);
assert.match(packager.expectedInstallerPath("mac", "arm64"), /release\/Mochi-0\.1\.0-mac-arm64\.dmg$/);
assert.match(packager.expectedInstallerPath("win", "x64"), /release\/Mochi-Setup-0\.1\.0-win-x64\.exe$/);

if (process.platform === "darwin" && process.arch === "arm64") {
  assert.doesNotThrow(() => packager.assertNativeTarget("mac", "arm64"));
  assert.throws(() => packager.assertNativeTarget("win", "x64"), /Windows 安装器必须在原生 Windows runner/);
  assert.throws(() => packager.assertNativeTarget("mac", "x64"), /同架构原生 runner/);
}

console.log("[test-installer-config] PASS: native installer contracts, physical production node_modules, isolated resources, and unsigned release boundaries are explicit.");
