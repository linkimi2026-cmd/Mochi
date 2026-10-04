import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ensureClassroomVoicePack, windowsSystemTar } from "../dist-electron/dsh/voice-pack.js";

const execFile = promisify(execFileCallback);
const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PACK_NAME = "classroom-mandarin-kokoro-zh-v1";
const RUNTIME_ROOT = "sherpa-onnx-v1.13.8-win-x64-shared-MD-MinSizeRel";
const MODEL_ROOT = "kokoro-int8-multi-lang-v1_1";
const executableRelative = `${RUNTIME_ROOT}/bin/sherpa-onnx-offline-tts.exe`;
const modelFiles = [
  "model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "lexicon-zh.txt",
  "date-zh.fst", "phone-zh.fst", "number-zh.fst",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function testWindowsTarSelection() {
  assert.equal(windowsSystemTar("C:\\Windows"), "C:\\Windows\\System32\\tar.exe");
  assert.equal(windowsSystemTar("D:\\WinRoot"), "D:\\WinRoot\\System32\\tar.exe");
  assert.throws(() => windowsSystemTar("tar.exe"), /无法定位 Windows 系统归档程序/u);
}

function writeFile(root, relativePath, contents) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function fixtureAssets() {
  const runtimeBytes = Buffer.from("synthetic sherpa runtime archive");
  const modelBytes = Buffer.from("synthetic kokoro model archive");
  return {
    runtimeBytes,
    modelBytes,
    assets: [
      { kind: "runtime", url: "https://fixture.invalid/runtime.tar.bz2", sizeBytes: runtimeBytes.length, sha256: sha256(runtimeBytes) },
      { kind: "model", url: "https://fixture.invalid/model.tar.bz2", sizeBytes: modelBytes.length, sha256: sha256(modelBytes) },
    ],
  };
}

function fixtureHooks(root, { assets, runtimeBytes, modelBytes, badRuntimeHash = false, unsafeModelEntry = false }) {
  let downloads = 0;
  let decompressions = 0;
  let extractions = 0;
  const hooks = {
    platform: "win32",
    architecture: "x64",
    assets: badRuntimeHash
      ? assets.map((asset) => asset.kind === "runtime" ? { ...asset, sha256: "0".repeat(64) } : asset)
      : assets,
    async downloadAsset(asset, destination) {
      downloads += 1;
      writeFileSync(destination, asset.kind === "runtime" ? runtimeBytes : modelBytes);
    },
    async decompressArchive(_archivePath, tarPath) {
      decompressions += 1;
      writeFileSync(tarPath, Buffer.from("synthetic tar stream"));
    },
    async listArchive(tarPath) {
      if (tarPath.endsWith("runtime.tar")) {
        return [RUNTIME_ROOT, `${RUNTIME_ROOT}/bin`, executableRelative];
      }
      if (unsafeModelEntry) return ["../escape.txt"];
      return [
        MODEL_ROOT,
        ...modelFiles.map((name) => `${MODEL_ROOT}/${name}`),
        `${MODEL_ROOT}/espeak-ng-data`,
        `${MODEL_ROOT}/dict`,
      ];
    },
    async extractArchive(tarPath, destination) {
      extractions += 1;
      if (tarPath.endsWith("runtime.tar")) {
        writeFile(destination, executableRelative, Buffer.from("synthetic executable"));
        return;
      }
      writeFile(destination, `${MODEL_ROOT}/model.int8.onnx`, Buffer.from("synthetic onnx model"));
      for (const name of modelFiles.slice(1)) writeFile(destination, `${MODEL_ROOT}/${name}`, Buffer.from(`fixture:${name}`));
      mkdirSync(join(destination, MODEL_ROOT, "espeak-ng-data"), { recursive: true });
      mkdirSync(join(destination, MODEL_ROOT, "dict"), { recursive: true });
    },
  };
  return { hooks, getDownloads: () => downloads, getDecompressions: () => decompressions, getExtractions: () => extractions, root };
}

async function testMac7zaBzip2Stream(base) {
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  const root = join(base, "7za-bzip2-stream");
  mkdirSync(root, { recursive: true });
  const sourceFile = join(root, "sample.txt");
  const tarPath = join(root, "sample.tar");
  const archivePath = join(root, "sample.tar.bz2");
  const roundTripPath = join(root, "round-trip.tar");
  const sevenZip = join(desktopRoot, "node_modules", "7zip-bin", "mac", "arm64", "7za");
  writeFileSync(sourceFile, "BZip2 stream fixture\n");
  await execFile("/usr/bin/tar", ["-cf", tarPath, "-C", root, "sample.txt"]);
  const compressed = await execFile("/usr/bin/bzip2", ["-c", tarPath], { encoding: "buffer", maxBuffer: 1024 * 1024 });
  writeFileSync(archivePath, compressed.stdout);
  const decompressed = await execFile(sevenZip, ["e", "-so", archivePath], { encoding: "buffer", maxBuffer: 1024 * 1024 });
  writeFileSync(roundTripPath, decompressed.stdout);
  assert.deepEqual(readFileSync(roundTripPath), readFileSync(tarPath), "7za e -so must stream a BZip2-compressed TAR back byte-for-byte");
}

async function testInstallAndDedupe(base) {
  const dataPath = join(base, "install");
  const fixture = fixtureAssets();
  const harness = fixtureHooks(dataPath, fixture);
  const voiceRoot = join(dataPath, "voice-packs");
  const stale = join(voiceRoot, ".stage-abandoned");
  mkdirSync(stale, { recursive: true });
  const old = new Date(Date.now() - 48 * 60 * 60_000);
  utimesSync(stale, old, old);

  const [first, second] = await Promise.all([
    ensureClassroomVoicePack(dataPath, harness.hooks),
    ensureClassroomVoicePack(dataPath, harness.hooks),
  ]);
  assert.deepEqual(first, second);
  assert.equal(harness.getDownloads(), 2, "runtime and model are fetched once per install");
  assert.equal(harness.getDecompressions(), 2, "both verified BZip2 archives are converted to staged TAR files");
  assert.equal(harness.getExtractions(), 2, "the two archives are extracted once");
  assert.equal(readFileSync(first.executable, "utf8"), "synthetic executable");
  assert.equal(readFileSync(join(first.modelDir, "model.int8.onnx"), "utf8"), "synthetic onnx model");
  assert.equal(exists(stale), false, "old staging directories are removed before reinstall");

  const cached = await ensureClassroomVoicePack(dataPath, harness.hooks);
  assert.deepEqual(cached, first);
  assert.equal(harness.getDownloads(), 2, "a verified installation is reused without another download");
}

function exists(path) {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

async function testMarkerAndFileHashes(base) {
  const dataPath = join(base, "tampered");
  const fixture = fixtureAssets();
  const harness = fixtureHooks(dataPath, fixture);
  const installed = await ensureClassroomVoicePack(dataPath, harness.hooks);
  writeFileSync(installed.executable, "changed after install");
  const repaired = await ensureClassroomVoicePack(dataPath, harness.hooks);
  assert.equal(readFileSync(repaired.executable, "utf8"), "synthetic executable");
  assert.equal(harness.getDownloads(), 4, "a changed executable invalidates the installation marker");
}

async function testOfflineImport(base) {
  const dataPath = join(base, "offline-import");
  const fixture = fixtureAssets();
  const harness = fixtureHooks(dataPath, fixture);
  const offline = join(dataPath, "voice-packs", "offline-import");
  mkdirSync(offline, { recursive: true });
  writeFileSync(join(offline, "runtime.tar.bz2"), fixture.runtimeBytes);
  writeFileSync(join(offline, "model.tar.bz2"), fixture.modelBytes);
  const installed = await ensureClassroomVoicePack(dataPath, harness.hooks);
  assert.equal(readFileSync(installed.executable, "utf8"), "synthetic executable");
  assert.equal(harness.getDownloads(), 0, "valid offline archives avoid both network downloads");
  assert.equal(harness.getExtractions(), 2, "offline archives still pass the normal archive gate");
}

async function testBadOfflineArchiveFallsBack(base) {
  const dataPath = join(base, "bad-offline-import");
  const fixture = fixtureAssets();
  const harness = fixtureHooks(dataPath, fixture);
  const offline = join(dataPath, "voice-packs", "offline-import");
  mkdirSync(offline, { recursive: true });
  writeFileSync(join(offline, "runtime.tar.bz2"), "not the pinned runtime archive");
  writeFileSync(join(offline, "model.tar.bz2"), fixture.modelBytes);
  const installed = await ensureClassroomVoicePack(dataPath, harness.hooks);
  assert.equal(readFileSync(installed.executable, "utf8"), "synthetic executable");
  assert.equal(harness.getDownloads(), 1, "only the corrupt archive falls back to download");
  assert.equal(harness.getExtractions(), 2);
}

async function testIntegrityFailure(base) {
  const dataPath = join(base, "bad-integrity");
  const fixture = fixtureAssets();
  const harness = fixtureHooks(dataPath, { ...fixture, badRuntimeHash: true });
  await assert.rejects(
    ensureClassroomVoicePack(dataPath, harness.hooks),
    /SHA-256 校验失败/u,
  );
  assert.equal(harness.getExtractions(), 0, "archives are not extracted before both downloads pass integrity checks");
}

async function testPathTraversal(base) {
  const dataPath = join(base, "bad-path");
  const fixture = fixtureAssets();
  const harness = fixtureHooks(dataPath, { ...fixture, unsafeModelEntry: true });
  await assert.rejects(
    ensureClassroomVoicePack(dataPath, harness.hooks),
    /目录穿越路径/u,
  );
  assert.equal(harness.getExtractions(), 0, "unsafe archive names are rejected before extraction");
}

async function testPreseedAndPlatformGate(base) {
  const dataPath = join(base, "preseed");
  const fixture = fixtureAssets();
  const harness = fixtureHooks(dataPath, fixture);
  const packDir = join(dataPath, "voice-packs", PACK_NAME);
  const executable = writeFile(packDir, executableRelative, Buffer.from("preseed executable"));
  const modelDir = join(packDir, MODEL_ROOT);
  const modelFile = writeFile(packDir, `${MODEL_ROOT}/model.int8.onnx`, Buffer.from("preseed model"));
  for (const name of modelFiles.slice(1)) writeFile(packDir, `${MODEL_ROOT}/${name}`, Buffer.from(`preseed:${name}`));
  mkdirSync(join(modelDir, "espeak-ng-data"), { recursive: true });
  mkdirSync(join(modelDir, "dict"), { recursive: true });
  const marker = {
    version: 1,
    runtimeSha256: fixture.assets[0].sha256,
    modelSha256: fixture.assets[1].sha256,
    executableSha256: sha256(readFileSync(executable)),
    modelSha256File: sha256(readFileSync(modelFile)),
  };
  writeFileSync(join(packDir, ".mochi-voice-pack.json"), JSON.stringify(marker));

  const ready = await ensureClassroomVoicePack(dataPath, harness.hooks);
  assert.equal(ready.executable, executable, "a manually preseeded folder is reused when marker and file hashes pass");
  assert.equal(harness.getDownloads(), 0);

  await assert.rejects(
    ensureClassroomVoicePack(join(base, "unsupported"), { platform: "darwin", architecture: "arm64" }),
    /只支持 Windows x64/u,
  );
}

const base = mkdtempSync(join(tmpdir(), "mochi-voice-pack-test-"));
try {
  testWindowsTarSelection();
  await testInstallAndDedupe(base);
  await testMarkerAndFileHashes(base);
  await testOfflineImport(base);
  await testBadOfflineArchiveFallsBack(base);
  await testIntegrityFailure(base);
  await testPathTraversal(base);
  await testPreseedAndPlatformGate(base);
  await testMac7zaBzip2Stream(base);
  console.log("voice pack installer: synthetic install, offline import, dedupe, integrity, archive paths, marker, stale-stage, preseed, platform, and 7za BZip2 stream checks passed");
} finally {
  rmSync(base, { recursive: true, force: true });
}
