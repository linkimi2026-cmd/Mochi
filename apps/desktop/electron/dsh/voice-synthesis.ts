import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureClassroomVoicePack, type VoicePackPaths } from "./voice-pack";

const MAX_QUEUE = 20;
const MAX_SPEECH_AGE_MS = 90_000;
const SYNTHESIS_TIMEOUT_MS = 45_000;
const PLAYBACK_TIMEOUT_MS = 30_000;
const MAX_WAVE_BYTES = 32 * 1024 * 1024;
const KOKORO_SAMPLE_RATE = 24_000;
const CHINESE_VOICE_SCRIPT = `
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($speech.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' })
if ($voices.Count -eq 0) { [Console]::Error.WriteLine('NO_CHINESE_VOICE'); exit 2 }
$preferred = $voices | Where-Object { $_.VoiceInfo.Name -match 'Xiaoxiao|Yunxi|Natural' } | Select-Object -First 1
if ($null -eq $preferred) { $preferred = $voices[0] }
$speech.SelectVoice($preferred.VoiceInfo.Name)
$speech.Rate = -1
$speech.Volume = 100
$speech.Speak([Console]::In.ReadToEnd())
`;
const PLAY_WAVE_SCRIPT = `
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$wave = [Console]::In.ReadToEnd()
$player = New-Object System.Media.SoundPlayer($wave)
$player.Load()
$player.PlaySync()
`;

interface SpeechJob {
  text: string;
  messageId: string;
  queuedAt: number;
}

let packPromise: Promise<VoicePackPaths> | null = null;
let installedPack: VoicePackPaths | null = null;
let nextPackRetryAt = 0;
let packRetryDelayMs = 15 * 60_000;
const queue: SpeechJob[] = [];
let draining = false;
let speechTail: Promise<void> = Promise.resolve();
const lanSpeechListeners = new Set<(busy: boolean) => void>();

/** Playback activity temporarily pauses classroom capture without changing its preference. */
export function registerLanSpeechActivity(listener: (busy: boolean) => void): () => void {
  lanSpeechListeners.add(listener);
  return () => { lanSpeechListeners.delete(listener); };
}

function lanSpeechActivity(busy: boolean): void {
  for (const listener of lanSpeechListeners) {
    try { listener(busy); } catch { /* A UI observer cannot prevent or repeat a signed announcement. */ }
  }
}

function run(command: string, args: string[], input: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let missingChineseVoice = false;
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    const abort = () => { child.kill(); };
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // sherpa's CLI echoes the input sentence on stderr. Never retain it.
      if (chunk.includes("NO_CHINESE_VOICE")) missingChineseVoice = true;
    });
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      cleanup();
      if (signal?.aborted) reject(signal.reason ?? new Error("朗读已停止"));
      else if (code === 0) resolve();
      else reject(new Error(missingChineseVoice ? "Windows 尚未安装中文语音" : code === null ? "语音进程超时或被终止" : `语音进程退出码 ${code}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input, "utf8");
  });
}

function powershell(script: string, input: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], input, timeoutMs, signal);
}

/** Shared by the live classroom path and the opt-in Windows native smoke. */
export function buildKokoroSynthesisArgs(pack: VoicePackPaths, wavePath: string, text: string): string[] {
  const model = pack.modelDir;
  return [
    `--kokoro-model=${join(model, "model.int8.onnx")}`,
    `--kokoro-voices=${join(model, "voices.bin")}`,
    `--kokoro-tokens=${join(model, "tokens.txt")}`,
    `--kokoro-data-dir=${join(model, "espeak-ng-data")}`,
    `--kokoro-lexicon=${join(model, "lexicon-us-en.txt")},${join(model, "lexicon-zh.txt")}`,
    `--tts-rule-fsts=${join(model, "date-zh.fst")},${join(model, "phone-zh.fst")},${join(model, "number-zh.fst")}`,
    "--num-threads=2",
    "--sid=3",
    `--output-filename=${wavePath}`,
    text,
  ];
}

/** Checks the pinned Kokoro PCM format, chunk alignment, and non-silent sample data. */
export function validateWaveBuffer(wave: Buffer): void {
  if (wave.length < 44 || wave.length > MAX_WAVE_BYTES
    || wave.toString("ascii", 0, 4) !== "RIFF"
    || wave.toString("ascii", 8, 12) !== "WAVE"
    || wave.readUInt32LE(4) !== wave.length - 8) {
    throw new Error("语音包未生成有效 WAV 音频");
  }

  const riffEnd = wave.length;
  let offset = 12;
  let hasFormat = false;
  let hasData = false;
  let blockAlign = 0;
  let hasNonzeroAudio = false;
  while (offset + 8 <= riffEnd) {
    const chunkId = wave.toString("ascii", offset, offset + 4);
    const chunkSize = wave.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > riffEnd) throw new Error("语音包未生成有效 WAV 音频");

    if (chunkId === "fmt ") {
      if (hasFormat || chunkSize < 16) throw new Error("语音包未生成有效 WAV 音频");
      const audioFormat = wave.readUInt16LE(dataStart);
      const channels = wave.readUInt16LE(dataStart + 2);
      const sampleRate = wave.readUInt32LE(dataStart + 4);
      const byteRate = wave.readUInt32LE(dataStart + 8);
      blockAlign = wave.readUInt16LE(dataStart + 12);
      const bitsPerSample = wave.readUInt16LE(dataStart + 14);
      const expectedBlockAlign = channels * bitsPerSample / 8;
      if (audioFormat !== 1 || channels !== 1 || sampleRate !== KOKORO_SAMPLE_RATE
        || bitsPerSample !== 16 || blockAlign !== expectedBlockAlign
        || byteRate !== sampleRate * blockAlign) {
        throw new Error("语音包未生成有效 WAV 音频");
      }
      hasFormat = true;
    } else if (chunkId === "data") {
      if (!hasFormat || hasData || chunkSize === 0 || chunkSize % blockAlign !== 0) {
        throw new Error("语音包未生成有效 WAV 音频");
      }
      hasData = true;
      for (let index = dataStart; index < dataEnd; index += 1) {
        if (wave[index] !== 0) {
          hasNonzeroAudio = true;
          break;
        }
      }
    }

    offset = dataEnd + (chunkSize % 2);
    if (offset > riffEnd) throw new Error("语音包未生成有效 WAV 音频");
  }

  if (offset !== riffEnd || !hasFormat || !hasData || !hasNonzeroAudio) {
    throw new Error("语音包未生成有效 WAV 音频");
  }
}

/** Runs the pinned sherpa/Kokoro executable and rejects malformed or silent output. */
export async function synthesizeClassroomWave(pack: VoicePackPaths, wavePath: string, text: string, signal?: AbortSignal): Promise<void> {
  await run(pack.executable, buildKokoroSynthesisArgs(pack, wavePath, text), "", SYNTHESIS_TIMEOUT_MS, signal);
  const waveStat = statSync(wavePath);
  if (!waveStat.isFile() || waveStat.size < 44 || waveStat.size > MAX_WAVE_BYTES) {
    throw new Error("语音包未生成有效 WAV 音频");
  }
  validateWaveBuffer(readFileSync(wavePath));
}

/** Playback is separate so CI and the smoke command stay silent unless explicitly requested. */
export async function playClassroomWave(wavePath: string, signal?: AbortSignal): Promise<void> {
  await powershell(PLAY_WAVE_SCRIPT, wavePath, PLAYBACK_TIMEOUT_MS, signal);
}

/** Download runs in the background; no name, message, or other school data is sent. */
export function prepareClassroomVoice(dataPath: string): void {
  if (process.platform !== "win32" || process.arch !== "x64" || packPromise !== null || Date.now() < nextPackRetryAt) return;
  const download = ensureClassroomVoicePack(dataPath);
  packPromise = download;
  void download.then((pack) => {
    installedPack = pack;
    nextPackRetryAt = 0;
    packRetryDelayMs = 15 * 60_000;
    console.info("[mochi] 教室自然语音包已就绪");
  }).catch((error: unknown) => {
    packPromise = null;
    const retryDelay = packRetryDelayMs;
    nextPackRetryAt = Date.now() + retryDelay;
    packRetryDelayMs = Math.min(retryDelay * 2, 6 * 60 * 60_000);
    const retry = setTimeout(() => prepareClassroomVoice(dataPath), retryDelay);
    retry.unref();
    // The current session continues with Windows' installed voice.
    console.warn("[mochi] 教室自然语音包暂不可用：", error instanceof Error ? error.message : "unknown");
  });
}

async function speakWithPack(pack: VoicePackPaths, text: string, signal?: AbortSignal): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `mochi-voice-${randomUUID()}-`));
  const wave = join(dir, "call.wav");
  try {
    await synthesizeClassroomWave(pack, wave, text, signal);
    await playClassroomWave(wave, signal);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function speak(job: SpeechJob): Promise<void> {
  if (installedPack !== null) {
    try {
      await speakWithPack(installedPack, job.text);
      return;
    } catch (error) {
      console.warn("[mochi] 自然语音生成或播放失败，改用本机中文语音：", error instanceof Error ? error.message : "unknown");
    }
  }
  await powershell(CHINESE_VOICE_SCRIPT, job.text, PLAYBACK_TIMEOUT_MS);
}

/** One local playback at a time, shared with signed LAN announcements. */
function serializeSpeech(operation: () => Promise<void>): Promise<void> {
  const result = speechTail.then(operation);
  speechTail = result.catch(() => {});
  return result;
}

/** Explicit current-reply playback; cancels synthesis/playback and joins process cleanup. */
export async function speakVoiceReply(dataPath: string, text: string, signal: AbortSignal): Promise<void> {
  if (typeof text !== "string" || text.trim().length < 1 || text.length > 6000) throw new Error("朗读内容长度无效");
  if (process.platform !== "darwin" && (process.platform !== "win32" || process.arch !== "x64")) throw new Error("此系统暂不支持本地回答朗读");
  signal.throwIfAborted();
  if (process.platform === "win32") prepareClassroomVoice(dataPath);
  await serializeSpeech(async () => {
    signal.throwIfAborted();
    lanSpeechActivity(true);
    try {
    if (process.platform === "darwin") {
      // Verified locally installed Mandarin voice; stdin never enters command syntax.
      await run("/usr/bin/say", ["-v", "Tingting"], text, 10 * 60_000, signal);
      return;
    }
    // Small clauses keep existing synthesis/playback timeouts meaningful for long replies.
    const clauses = text.match(/[^。！？\n]{1,220}[。！？\n]?/gu) ?? [text];
    for (const clause of clauses) {
      signal.throwIfAborted();
      if (installedPack !== null) {
        try { await speakWithPack(installedPack, clause, signal); continue; }
        catch (error) { if (signal.aborted) throw error; }
      }
      await powershell(CHINESE_VOICE_SCRIPT, clause, PLAYBACK_TIMEOUT_MS, signal);
    }
    } finally { lanSpeechActivity(false); }
  });
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job || Date.now() - job.queuedAt > MAX_SPEECH_AGE_MS) continue;
      try {
        await serializeSpeech(async () => {
          lanSpeechActivity(true);
          try { await speak(job); } finally { lanSpeechActivity(false); }
        });
      } catch (error) {
        console.warn("[mochi] 教室语音通报失败：", error instanceof Error ? error.message : "unknown");
      }
    }
  } finally {
    draining = false;
  }
}

/** Only call with the signed, single-student classroom directive extracted in voice-call.ts. */
export function speakClassroomCall(dataPath: string, text: string, messageId: string): boolean | "busy" {
  if (process.platform !== "win32" || process.arch !== "x64") return false;
  if (typeof text !== "string" || text.length < 2 || text.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(messageId)) return false;
  prepareClassroomVoice(dataPath);
  // This is the only result that promises the caller the job was not enqueued.
  if (queue.length >= MAX_QUEUE) return "busy";
  queue.push({ text, messageId, queuedAt: Date.now() });
  // Jobs that age out while waiting remain visual-only. Retrying them would
  // announce stale classroom context after the intended moment has passed.
  void drain();
  return true;
}
