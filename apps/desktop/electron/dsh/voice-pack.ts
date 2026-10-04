import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { createRequire } from "node:module";
import { Transform, Writable } from "node:stream";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";

const execFile = promisify(execFileCallback);

const PACK_NAME = "classroom-mandarin-kokoro-zh-v1";
const RUNTIME_ROOT = "sherpa-onnx-v1.13.8-win-x64-shared-MD-MinSizeRel";
const MODEL_ROOT = "kokoro-int8-multi-lang-v1_1";
const EXECUTABLE_RELATIVE = `${RUNTIME_ROOT}/bin/sherpa-onnx-offline-tts.exe`;
const MODEL_REQUIRED_FILES = [
  "model.int8.onnx",
  "voices.bin",
  "tokens.txt",
  "lexicon-us-en.txt",
  "lexicon-zh.txt",
  "date-zh.fst",
  "phone-zh.fst",
  "number-zh.fst",
] as const;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const REQUEST_IDLE_TIMEOUT_MS = 45_000;
const MAX_REDIRECTS = 5;
const TAR_TIMEOUT_MS = 3 * 60_000;
const BZIP2_TIMEOUT_MS = 5 * 60_000;
const TAR_MAX_BUFFER = 64 * 1024 * 1024;
const MAX_DECOMPRESSED_TAR_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100_000;
const STALE_STAGE_AGE_MS = 24 * 60 * 60_000;
const SEVEN_ZIP_SHA256 = "b0cfdeaf429f5cc53f85123dd8f5a5feb92c19d31aa34df257edf9a26be05f95";
const DOWNLOAD_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

export interface VoicePackPaths {
  executable: string;
  modelDir: string;
}

export interface VoicePackAsset {
  kind: "runtime" | "model";
  url: string;
  sizeBytes: number;
  sha256: string;
}

/** Dependency seams for hermetic installer tests. Production callers use the one-argument API. */
export interface VoicePackInstallerTestHooks {
  platform?: NodeJS.Platform;
  architecture?: string;
  assets?: readonly VoicePackAsset[];
  downloadAsset?: (asset: VoicePackAsset, destination: string, signal: AbortSignal) => Promise<void>;
  decompressArchive?: (archivePath: string, tarPath: string, kind: VoicePackAsset["kind"]) => Promise<void>;
  listArchive?: (archivePath: string, kind?: VoicePackAsset["kind"]) => Promise<readonly string[]>;
  extractArchive?: (archivePath: string, destination: string, kind?: VoicePackAsset["kind"]) => Promise<void>;
}

const RELEASE_ASSETS: readonly VoicePackAsset[] = [
  {
    kind: "runtime",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MD-MinSizeRel.tar.bz2",
    sizeBytes: 17_324_649,
    sha256: "416011eabb9a1e26fd4433b41871d67c7a00b1f0a11b75fe66ff8182b8224f95",
  },
  {
    kind: "model",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2",
    sizeBytes: 147_031_220,
    sha256: "a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6",
  },
];

const inFlightInstalls = new Map<string, Promise<VoicePackPaths>>();

function isFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function installationPaths(packDirectory: string, assets: readonly VoicePackAsset[]): Promise<VoicePackPaths | null> {
  const executable = join(packDirectory, ...EXECUTABLE_RELATIVE.split("/"));
  const modelDir = join(packDirectory, MODEL_ROOT);
  if (!isFile(executable)) return null;
  if (!MODEL_REQUIRED_FILES.every((name) => isFile(join(modelDir, name)))) return null;
  if (!isDirectory(join(modelDir, "espeak-ng-data")) || !isDirectory(join(modelDir, "dict"))) return null;
  let marker: unknown;
  try {
    const markerPath = join(packDirectory, ".mochi-voice-pack.json");
    if (!isFile(markerPath) || statSync(markerPath).size > 8_192) return null;
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    return null;
  }
  if (marker === null || typeof marker !== "object" || Array.isArray(marker)) return null;
  const data = marker as Record<string, unknown>;
  const runtimeSha256 = assets.find((asset) => asset.kind === "runtime")?.sha256;
  const modelSha256 = assets.find((asset) => asset.kind === "model")?.sha256;
  if (data.version !== 1 || data.runtimeSha256 !== runtimeSha256 || data.modelSha256 !== modelSha256
    || typeof data.executableSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(data.executableSha256)
    || typeof data.modelSha256File !== "string" || !/^[a-f0-9]{64}$/u.test(data.modelSha256File)) return null;
  const [actualExecutableSha, actualModelSha] = await Promise.all([
    sha256File(executable),
    sha256File(join(modelDir, "model.int8.onnx")),
  ]);
  if (actualExecutableSha !== data.executableSha256 || actualModelSha !== data.modelSha256File) return null;
  return { executable, modelDir };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  // pipeline waits for file closure; 'end' alone leaves Windows rename locked.
  await pipeline(createReadStream(filePath), new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      callback();
    },
  }));
  return hash.digest("hex");
}

function isAllowedDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && DOWNLOAD_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function downloadAsset(asset: VoicePackAsset, destination: string, signal: AbortSignal): Promise<void> {
  if (!isAllowedDownloadUrl(asset.url)) throw new Error("语音资源下载地址不在 GitHub 白名单内。");
  await new Promise<void>((resolveDownload, rejectDownload) => {
    const requestUrl = (urlValue: string, redirectCount: number): void => {
      if (signal.aborted) {
        rejectDownload(signal.reason ?? new Error("语音资源下载已取消。"));
        return;
      }
      const request = httpsRequest(urlValue, { signal }, (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          if (redirectCount >= MAX_REDIRECTS) {
            rejectDownload(new Error("语音资源下载重定向次数过多。"));
            return;
          }
          const nextUrl = new URL(location, urlValue).toString();
          if (!isAllowedDownloadUrl(nextUrl)) {
            rejectDownload(new Error("语音资源下载跳转到了不受信任的地址。"));
            return;
          }
          requestUrl(nextUrl, redirectCount + 1);
          return;
        }
        if (status !== 200) {
          response.destroy();
          rejectDownload(new Error(`语音资源下载失败（HTTP ${status}）。`));
          return;
        }
        const contentLength = Number(response.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength !== asset.sizeBytes) {
          response.destroy();
          rejectDownload(new Error("语音资源大小与发布清单不符。"));
          return;
        }
        let bytesReceived = 0;
        const sizeGuard = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytesReceived += chunk.length;
            if (bytesReceived > asset.sizeBytes) {
              callback(new Error("语音资源下载超出发布清单大小。"));
              return;
            }
            callback(null, chunk);
          },
        });
        void pipeline(response, sizeGuard, createWriteStream(destination, { flags: "wx" }), { signal })
          .then(() => resolveDownload(), rejectDownload);
      });
      request.setTimeout(REQUEST_IDLE_TIMEOUT_MS, () => request.destroy(new Error("语音资源下载超时。")));
      request.on("error", rejectDownload);
      request.end();
    };
    requestUrl(asset.url, 0);
  });
}

async function verifyDownloadedAsset(asset: VoicePackAsset, filePath: string): Promise<void> {
  if (statSync(filePath).size !== asset.sizeBytes) throw new Error("语音资源下载不完整，文件大小校验失败。");
  if (await sha256File(filePath) !== asset.sha256) throw new Error("语音资源 SHA-256 校验失败。");
}

async function copyVerifiedOfflineAsset(asset: VoicePackAsset, voiceRoot: string, destination: string, signal: AbortSignal): Promise<boolean> {
  const source = join(voiceRoot, "offline-import", `${asset.kind}.tar.bz2`);
  if (!existsSync(source)) return false;
  try {
    if (!lstatSync(source).isFile()) throw new Error("not a regular file");
    await verifyDownloadedAsset(asset, source);
  } catch {
    console.warn(`[mochi] 本地${asset.kind === "runtime" ? "语音引擎" : "中文模型"}归档校验失败，尝试在线下载。`);
    return false;
  }
  await pipeline(createReadStream(source), createWriteStream(destination, { flags: "wx" }), { signal });
  return true;
}

/** Resolve Windows' built-in tar directly; PATH may resolve Git's GNU tar first. */
export function windowsSystemTar(systemRoot: string): string {
  if (!win32.isAbsolute(systemRoot) || !/^[a-zA-Z]:[\\/]/u.test(systemRoot)) {
    throw new Error("无法定位 Windows 系统归档程序。");
  }
  return win32.join(systemRoot, "System32", "tar.exe");
}

function archiveLabel(kind: VoicePackAsset["kind"]): string {
  return kind === "runtime" ? "语音引擎" : "中文模型";
}

async function measureArchiveStage<T>(kind: VoicePackAsset["kind"], stage: string, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const result = await run();
  console.info(`[mochi] voice pack ${kind} ${stage}: ${Date.now() - startedAt} ms`);
  return result;
}

async function waitForArchiveTasks<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

function sevenZipExecutable(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packagedPath = resourcesPath ? join(resourcesPath, "tools", "7za.exe") : "";
  if (packagedPath && existsSync(packagedPath)) return packagedPath;

  try {
    const packageJson = createRequire(__filename).resolve("7zip-bin/package.json");
    return join(dirname(packageJson), "win", "x64", "7za.exe");
  } catch {
    throw new Error("找不到受信任的 7-Zip 解压程序。");
  }
}

async function verifySevenZipExecutable(executable: string): Promise<void> {
  if (!isFile(executable)) throw new Error("找不到受信任的 7-Zip 解压程序。");
  try {
    if (await sha256File(executable) !== SEVEN_ZIP_SHA256) throw new Error("hash mismatch");
  } catch {
    throw new Error("7-Zip 解压程序校验失败。");
  }
}

async function decompressBzip2ToTar(
  archivePath: string,
  tarPath: string,
  kind: VoicePackAsset["kind"],
): Promise<void> {
  const label = archiveLabel(kind);
  const executable = sevenZipExecutable();
  await verifySevenZipExecutable(executable);

  let timedOut = false;
  let exceededOutputLimit = false;
  const child = spawn(executable, ["e", "-so", archivePath], {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const childClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let outputBytes = 0;
  const sizeGuard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (outputBytes + chunk.length > MAX_DECOMPRESSED_TAR_BYTES) {
        exceededOutputLimit = true;
        callback(new Error("output limit"));
        return;
      }
      outputBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const outputWritten = pipeline(child.stdout!, sizeGuard, createWriteStream(tarPath, { flags: "wx" }))
    .catch((error: unknown) => {
      child.kill();
      throw error;
    });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, BZIP2_TIMEOUT_MS);
  const [closed, written] = await Promise.allSettled([childClosed, outputWritten]);
  clearTimeout(timeout);

  if (timedOut) throw new Error(`7-Zip 解压${label}归档超时。`);
  if (exceededOutputLimit) throw new Error(`解压后的${label}归档超过 1 GiB 安全上限。`);
  if (closed.status === "rejected" || written.status === "rejected") {
    throw new Error(`7-Zip 解压${label}归档失败。`);
  }
  const { code, signal } = closed.value;
  if (code !== 0) {
    throw new Error(`7-Zip 解压${label}归档失败（${String(code ?? signal ?? "unknown")}）。`);
  }
}

function runTar(args: string[], kind: VoicePackAsset["kind"], stage: "列出" | "提取"): Promise<string> {
  const tar = windowsSystemTar(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows");
  return execFile(tar, args, {
    windowsHide: true,
    timeout: TAR_TIMEOUT_MS,
    maxBuffer: TAR_MAX_BUFFER,
  }).then(({ stdout }) => stdout).catch((error: unknown) => {
    const failure = error as { killed?: boolean; signal?: string; code?: string | number; stderr?: string };
    const label = archiveLabel(kind);
    if (failure.killed || failure.signal === "SIGTERM") throw new Error(`Windows 系统归档程序${stage}${label}归档超时。`);
    throw new Error(`Windows 系统归档程序${stage}${label}归档失败（${String(failure.code ?? "unknown")}）。`);
  });
}

async function listArchive(archivePath: string, kind: VoicePackAsset["kind"]): Promise<readonly string[]> {
  const output = await runTar(["-tf", archivePath], kind, "列出");
  const entries = output.split(/\r?\n/u).filter((value) => value.length > 0);
  if (entries.length === 0 || entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("语音资源归档文件清单异常。");
  }
  return entries;
}

async function extractArchive(archivePath: string, destination: string, kind: VoicePackAsset["kind"]): Promise<void> {
  mkdirSync(destination, { recursive: true });
  await runTar(["-xf", archivePath, "-C", destination], kind, "提取");
}

function safeArchiveEntries(rawEntries: readonly string[]): string[] {
  if (rawEntries.length === 0 || rawEntries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("语音资源归档条目数量异常。");
  }
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawEntries) {
    if (raw.includes("\0") || raw.includes("\\") || raw.length > 1_024) {
      throw new Error("语音资源归档包含不安全路径。");
    }
    const value = raw.replace(/^\.\//u, "");
    if (value.startsWith("/") || /^[a-zA-Z]:/u.test(value) || value.includes(":")) {
      throw new Error("语音资源归档包含绝对路径。");
    }
    const segments = value.split("/").filter((segment) => segment.length > 0);
    if (segments.some((segment) => segment === ".." || segment === ".")) {
      throw new Error("语音资源归档包含目录穿越路径。");
    }
    const normalized = segments.join("/");
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) throw new Error("语音资源归档包含重复路径。");
    seen.add(normalized);
    entries.push(normalized);
  }
  return entries;
}

function validateArchiveEntries(runtimeEntries: readonly string[], modelEntries: readonly string[]): void {
  const runtime = safeArchiveEntries(runtimeEntries);
  const model = safeArchiveEntries(modelEntries);
  if (!runtime.includes(EXECUTABLE_RELATIVE)) {
    throw new Error("语音引擎归档缺少预期的 Windows TTS 程序。");
  }
  if (runtime.some((entry) => entry !== RUNTIME_ROOT && !entry.startsWith(`${RUNTIME_ROOT}/`))) {
    throw new Error("语音引擎归档包含意外目录。");
  }
  const modelExpected = [
    ...MODEL_REQUIRED_FILES.map((name) => `${MODEL_ROOT}/${name}`),
    `${MODEL_ROOT}/espeak-ng-data`,
    `${MODEL_ROOT}/dict`,
  ];
  for (const required of modelExpected) {
    if (!model.some((entry) => entry === required || entry.startsWith(`${required}/`))) {
      throw new Error(`中文语音模型归档缺少预期资源：${basename(required)}。`);
    }
  }
  if (model.some((entry) => entry !== MODEL_ROOT && !entry.startsWith(`${MODEL_ROOT}/`))) {
    throw new Error("中文语音模型归档包含意外目录。");
  }
}

function validAssets(assets: readonly VoicePackAsset[]): asserts assets is readonly [VoicePackAsset, VoicePackAsset] {
  if (assets.length !== 2 || assets.filter((asset) => asset.kind === "runtime").length !== 1
    || assets.filter((asset) => asset.kind === "model").length !== 1
    || assets.some((asset) => !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0
      || !/^[a-f0-9]{64}$/u.test(asset.sha256) || typeof asset.url !== "string")) {
    throw new Error("语音资源安装清单无效。");
  }
}

function removeStaleStages(voiceRoot: string): void {
  let names: string[];
  try {
    names = readdirSync(voiceRoot);
  } catch {
    return;
  }
  const staleBefore = Date.now() - STALE_STAGE_AGE_MS;
  for (const name of names) {
    if (!name.startsWith(".stage-")) continue;
    const path = join(voiceRoot, name);
    try {
      const stat = lstatSync(path);
      if (stat.isDirectory() && stat.mtimeMs < staleBefore) rmSync(path, { recursive: true, force: true });
    } catch {
      // Another local cleanup or installer may already have removed the stage.
    }
  }
}

async function installPack(dataPath: string, hooks: VoicePackInstallerTestHooks, assets: readonly VoicePackAsset[]): Promise<VoicePackPaths> {
  if ((hooks.platform ?? process.platform) !== "win32" || (hooks.architecture ?? process.arch) !== "x64") {
    throw new Error("自然中文语音包目前只支持 Windows x64；当前设备会使用系统语音回退。");
  }
  validAssets(assets);
  if (hooks.assets && !hooks.downloadAsset) {
    throw new Error("测试资源清单必须提供对应的测试下载器。");
  }

  const voiceRoot = join(resolve(dataPath), "voice-packs");
  const destination = join(voiceRoot, PACK_NAME);
  const ready = await installationPaths(destination, assets);
  if (ready) return ready;

  mkdirSync(voiceRoot, { recursive: true });
  removeStaleStages(voiceRoot);
  const staging = join(voiceRoot, `.stage-${randomUUID()}`);
  const unpacked = join(staging, "unpacked");
  const downloadController = new AbortController();
  const timeout = AbortSignal.any([downloadController.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]);
  mkdirSync(staging, { recursive: true });
  try {
    const runtimeAsset = assets.find((asset) => asset.kind === "runtime")!;
    const modelAsset = assets.find((asset) => asset.kind === "model")!;
    const runtimeArchive = join(staging, "runtime.tar.bz2");
    const modelArchive = join(staging, "model.tar.bz2");
    const fetchAsset = async (asset: VoicePackAsset, destination: string): Promise<void> => {
      if (await copyVerifiedOfflineAsset(asset, voiceRoot, destination, timeout)) return;
      await (hooks.downloadAsset ?? downloadAsset)(asset, destination, timeout);
    };
    const downloads = [
      fetchAsset(runtimeAsset, runtimeArchive),
      fetchAsset(modelAsset, modelArchive),
    ];
    try {
      await Promise.all(downloads);
    } catch (error) {
      downloadController.abort(error);
      await Promise.allSettled(downloads);
      throw error;
    }
    await Promise.all([
      verifyDownloadedAsset(runtimeAsset, runtimeArchive),
      verifyDownloadedAsset(modelAsset, modelArchive),
    ]);

    const tarArchives: Readonly<Record<VoicePackAsset["kind"], string>> = {
      runtime: join(staging, "runtime.tar"),
      model: join(staging, "model.tar"),
    };
    const decompress = hooks.decompressArchive ?? decompressBzip2ToTar;
    await waitForArchiveTasks([runtimeAsset, modelAsset].map((asset) => measureArchiveStage(
      asset.kind,
      "bzip2-to-tar",
      () => decompress(
        asset.kind === "runtime" ? runtimeArchive : modelArchive,
        tarArchives[asset.kind],
        asset.kind,
      ),
    )));

    const list = hooks.listArchive ?? listArchive;
    const [runtimeEntries, modelEntries] = await waitForArchiveTasks([runtimeAsset, modelAsset].map((asset) => measureArchiveStage(
      asset.kind,
      "tar-list",
      () => list(tarArchives[asset.kind], asset.kind),
    )));
    validateArchiveEntries(runtimeEntries, modelEntries);

    const extract = hooks.extractArchive ?? extractArchive;
    mkdirSync(unpacked, { recursive: true });
    await waitForArchiveTasks([runtimeAsset, modelAsset].map((asset) => measureArchiveStage(
      asset.kind,
      "tar-extract",
      () => extract(tarArchives[asset.kind], unpacked, asset.kind),
    )));

    const stagedPaths = {
      executable: join(unpacked, ...EXECUTABLE_RELATIVE.split("/")),
      modelDir: join(unpacked, MODEL_ROOT),
    };
    const [executableSha256, modelSha256File] = await Promise.all([
      sha256File(stagedPaths.executable),
      sha256File(join(stagedPaths.modelDir, "model.int8.onnx")),
    ]);
    const marker = {
      version: 1,
      runtimeSha256: runtimeAsset.sha256,
      modelSha256: modelAsset.sha256,
      executableSha256,
      modelSha256File,
      installedAt: new Date().toISOString(),
    };
    writeFileSync(join(unpacked, ".mochi-voice-pack.json"), JSON.stringify(marker, null, 2), { flag: "wx" });
    if (!await installationPaths(unpacked, assets)) throw new Error("语音资源解包后缺少可用的程序或中文模型文件。");

    const backup = `${destination}.previous-${randomUUID()}`;
    let movedExisting = false;
    try {
      if (existsSync(destination)) {
        renameSync(destination, backup);
        movedExisting = true;
      }
      renameSync(unpacked, destination);
    } catch (error) {
      if (movedExisting && !existsSync(destination)) renameSync(backup, destination);
      throw error;
    }
    if (movedExisting) rmSync(backup, { recursive: true, force: true });

    const installed = await installationPaths(destination, assets);
    if (!installed) throw new Error("语音包安装后校验失败。");
    return installed;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Ensures the optional Mandarin TTS pack is present under Electron userData.
 * Network downloads happen only on Windows x64; the package contains no student text.
 */
export function ensureClassroomVoicePack(
  dataPath: string,
  hooks: VoicePackInstallerTestHooks = {},
): Promise<VoicePackPaths> {
  const key = join(resolve(dataPath), "voice-packs", PACK_NAME);
  const existing = inFlightInstalls.get(key);
  if (existing) return existing;
  const assets = hooks.assets ?? RELEASE_ASSETS;
  validAssets(assets);
  const installation = (async () => {
    const ready = await installationPaths(key, assets);
    if (ready) return ready;
    return installPack(dataPath, hooks, assets);
  })();
  inFlightInstalls.set(key, installation);
  const clear = (): void => {
    if (inFlightInstalls.get(key) === installation) inFlightInstalls.delete(key);
  };
  void installation.then(clear, clear);
  return installation;
}
