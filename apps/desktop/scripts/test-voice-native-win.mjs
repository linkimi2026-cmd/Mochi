import { mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { ensureClassroomVoicePack } = require(join(desktopRoot, "dist-electron", "dsh", "voice-pack.js"));
const { playClassroomWave, synthesizeClassroomWave } = require(join(desktopRoot, "dist-electron", "dsh", "voice-synthesis.js"));

const TEST_PHRASE = "这是一次中文语音合成测试。";

function parseArgs(args) {
  let userDataDir = null;
  let play = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--help" || value === "-h") return { help: true };
    if (value === "--play") {
      play = true;
      continue;
    }
    if (value === "--user-data-dir") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--user-data-dir 后需要目录路径。");
      userDataDir = resolve(next);
      index += 1;
      continue;
    }
    if (value.startsWith("--user-data-dir=")) {
      const next = value.slice("--user-data-dir=".length);
      if (!next) throw new Error("--user-data-dir 后需要目录路径。");
      userDataDir = resolve(next);
      continue;
    }
    throw new Error("参数无效。运行时可用 --help 查看用法。");
  }
  return { help: false, userDataDir, play };
}

function defaultClassroomUserDataDir() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, "Mochi-classroom");
}

function usage() {
  console.log("用法：npm run test:voice-native-win [-- --user-data-dir <目录>] [--play]");
  console.log("Windows x64 上使用固定 sherpa/Kokoro 资源生成并校验一段短中文 WAV。");
  console.log("默认复用教室端 userData；--play 会在 WAV 校验成功后才播放。");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("此原生语音冒烟仅支持 Windows x64；本次没有下载或运行语音程序。");
  }
  if (options.play && process.env.CI) {
    throw new Error("CI 环境禁用扬声器播放；移除 --play 后可只运行静音合成校验。");
  }

  const dataPath = options.userDataDir ?? defaultClassroomUserDataDir();
  const pack = await ensureClassroomVoicePack(dataPath);
  const outputDir = mkdtempSync(join(tmpdir(), "mochi-voice-native-smoke-"));
  const wavePath = join(outputDir, "voice-smoke.wav");
  try {
    await synthesizeClassroomWave(pack, wavePath, TEST_PHRASE);
    const size = statSync(wavePath).size;
    console.log(`Windows 原生 Kokoro 合成与 WAV 校验通过（${size} 字节）。`);
    if (options.play) {
      await playClassroomWave(wavePath);
      console.log("已按 --play 请求播放校验通过的 WAV。");
    } else {
      console.log("未请求播放；扬声器保持静默。");
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  // Do not emit child-process stderr: sherpa can echo the synthesis input there.
  console.error(error instanceof Error ? error.message : "Windows 原生语音冒烟失败。");
  process.exitCode = 1;
});
