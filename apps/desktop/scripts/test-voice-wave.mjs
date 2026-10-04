import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(desktopRoot, "package.json"));
const { validateWaveBuffer } = require("./dist-electron/dsh/voice-synthesis.js");

function makeWave(data = Buffer.from([1, 0, 2, 0]), options = {}) {
  const {
    audioFormat = 1,
    channels = 1,
    sampleRate = 24_000,
    bitsPerSample = 16,
    blockAlign = channels * bitsPerSample / 8,
    byteRate = sampleRate * blockAlign,
    formatChunkSize = 16,
    chunks = [],
  } = options;
  const format = Buffer.alloc(Math.max(16, formatChunkSize));
  format.writeUInt16LE(audioFormat, 0);
  format.writeUInt16LE(channels, 2);
  format.writeUInt32LE(sampleRate, 4);
  format.writeUInt32LE(byteRate, 8);
  format.writeUInt16LE(blockAlign, 12);
  format.writeUInt16LE(bitsPerSample, 14);
  const chunk = (name, payload) => {
    const header = Buffer.alloc(8);
    header.write(name, 0, 4, "ascii");
    header.writeUInt32LE(payload.length, 4);
    return payload.length % 2 === 0 ? Buffer.concat([header, payload]) : Buffer.concat([header, payload, Buffer.alloc(1)]);
  };
  const body = Buffer.concat([
    Buffer.from("WAVE", "ascii"),
    ...chunks,
    chunk("fmt ", format.subarray(0, formatChunkSize)),
    chunk("data", data),
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const valid = makeWave(Buffer.from([0, 0, 5, 0]));
assert.doesNotThrow(() => validateWaveBuffer(valid));
assert.doesNotThrow(() => validateWaveBuffer(makeWave(Buffer.from([0, 4]), { chunks: [Buffer.from("JUNK\x00\x00\x00\x00", "binary")] })));

const invalidHeader = Buffer.from(valid);
invalidHeader.write("NOPE", 0, 4, "ascii");
assert.throws(() => validateWaveBuffer(invalidHeader), /有效 WAV/u);

const wrongContainer = Buffer.from(valid);
wrongContainer.write("AVI ", 8, 4, "ascii");
assert.throws(() => validateWaveBuffer(wrongContainer), /有效 WAV/u);

const wrongRiffSize = Buffer.from(valid);
wrongRiffSize.writeUInt32LE(wrongRiffSize.length, 4);
assert.throws(() => validateWaveBuffer(wrongRiffSize), /有效 WAV/u);

assert.throws(() => validateWaveBuffer(makeWave(Buffer.alloc(4))), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.alloc(0))), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0]), { audioFormat: 3 })), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0]), { channels: 2 })), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0]), { sampleRate: 22_050 })), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0]), { sampleRate: 0 })), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0]), { bitsPerSample: 8 })), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0]), { blockAlign: 1 })), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0]), { byteRate: 48_001 })), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0]), { formatChunkSize: 12 })), /有效 WAV/u);
assert.throws(() => validateWaveBuffer(makeWave(Buffer.from([1, 0, 2]))), /有效 WAV/u);

const truncatedChunk = Buffer.from(valid.subarray(0, valid.length - 2));
truncatedChunk.writeUInt32LE(truncatedChunk.length - 8, 4);
assert.throws(() => validateWaveBuffer(truncatedChunk), /有效 WAV/u);

const missingFormat = makeWave(Buffer.from([1, 0]));
const missingFormatBuffer = Buffer.concat([missingFormat.subarray(0, 12), missingFormat.subarray(36)]);
missingFormatBuffer.writeUInt32LE(missingFormatBuffer.length - 8, 4);
assert.throws(() => validateWaveBuffer(missingFormatBuffer), /有效 WAV/u);

console.log("voice WAV validation passed: RIFF/WAVE PCM fields, chunk alignment, and non-silent audio");
