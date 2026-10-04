/** Only segmenting differs from official one-shot recording; WAV encoding matches upstream. */
export function encodeWave(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true); });
  return bytes;
}

/** Energy gate is chunking only; official Silero/SenseVoice decides whether speech exists. */
export class PcmSegmenter {
  constructor(onAudio, { sampleRate = 16000, silenceSeconds = .8, maxSeconds = 15, threshold = .012 } = {}) {
    Object.assign(this, { onAudio, sampleRate, silenceSeconds, maxSeconds, threshold });
    this.blocks = []; this.samples = 0; this.silence = 0; this.preRoll = [];
  }
  push(block) {
    let energy = 0; for (const value of block) energy += value * value;
    const speech = Math.sqrt(energy / block.length) >= this.threshold;
    if (!this.samples && !speech) { this.preRoll.push(block); while (this.preRoll.reduce((n, b) => n + b.length, 0) > this.sampleRate * .2) this.preRoll.shift(); return; }
    if (!this.samples) { this.blocks.push(...this.preRoll); this.samples = this.preRoll.reduce((n, b) => n + b.length, 0); this.preRoll = []; }
    let offset = 0;
    while (offset < block.length) {
      if (!this.samples && !speech) { this.preRoll = [block.slice(offset)]; return; }
      const count = Math.min(block.length - offset, this.sampleRate * this.maxSeconds - this.samples, speech ? Infinity : this.sampleRate * this.silenceSeconds - this.silence);
      this.blocks.push(block.slice(offset, offset + count)); this.samples += count; offset += count;
      this.silence = speech ? 0 : this.silence + count;
      if (this.samples === this.sampleRate * this.maxSeconds || this.silence >= this.sampleRate * this.silenceSeconds) this.flush();
    }
  }
  flush() {
    if (this.samples >= this.sampleRate * .25) {
      const samples = new Float32Array(this.samples); let offset = 0;
      for (const block of this.blocks) { samples.set(block, offset); offset += block.length; }
      this.onAudio(encodeWave(samples));
    }
    this.blocks = []; this.samples = 0; this.silence = 0;
  }
}

/** Browser capture reuses official MediaRecorder + native decode/resample semantics. */
export async function capturePcm(onAudio, signal, environment = globalThis, onFailure = () => {}) {
  let stream, context, source, analyser, recorder, segment, timer, released = false;
  const conversions = new Set();
  const now = () => environment.performance?.now() ?? Date.now();
  const audioStep = (operation, label) => new Promise((resolve, reject) => {
    const cancel = () => finish(new Error('录音已取消。'));
    const timeout = setTimeout(() => finish(new Error(`${label}超时，请重新开启监听。`)), 10000);
    const finish = (error, value) => { clearTimeout(timeout); signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(value); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else Promise.resolve(operation).then(value => finish(null, value), finish);
  });
  const onEnded = () => { if (!released) { onFailure(new Error('麦克风连接已中断，请检查设备后重新开启监听。')); void release(); } };
  const release = async () => {
    if (released) return; released = true;
    signal.removeEventListener('abort', onAbort); clearInterval(timer);
    if (recorder?.state === 'recording') recorder.stop();
    source?.disconnect();
    stream?.getTracks().forEach(track => { track.removeEventListener?.('ended', onEnded); track.stop(); });
    await Promise.allSettled([...conversions]);
    if (context && context.state !== 'closed') await context.close();
  };
  const onAbort = () => { void release(); };
  signal.addEventListener('abort', onAbort, { once: true });
  const convert = async recording => {
    if (released || recording.firstSpeech === null || !recording.chunks.length) return;
    const bytes = await new Blob(recording.chunks).arrayBuffer();
    const decoded = await audioStep(context.decodeAudioData(bytes), '录音解码');
    if (released || signal.aborted) return;
    // Some capture streams omit silent frames: wall-clock offsets do not map to decoded time.
    const seconds = Math.min(15, decoded.duration);
    if (seconds < .25) return;
    const offline = new environment.OfflineAudioContext(1, Math.max(1, Math.floor(seconds * 16000)), 16000);
    const input = offline.createBufferSource(); input.buffer = decoded; input.connect(offline.destination); input.start(0, 0, seconds);
    const rendered = await audioStep(offline.startRendering(), '录音重采样');
    if (!released && !signal.aborted) onAudio(encodeWave(rendered.getChannelData(0)));
  };
  const startRecording = () => {
    const recording = { started: now(), firstSpeech: null, lastSpeech: null, chunks: [], size: 0 };
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => environment.MediaRecorder.isTypeSupported(type));
    const next = new environment.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    next.ondataavailable = event => {
      if (released || !event.data.size) return;
      recording.size += event.data.size;
      if (recording.size > 2 * 1024 * 1024) { onFailure(new Error('录音数据过大，监听已停止。')); void release(); return; }
      recording.chunks.push(event.data);
    };
    next.onerror = () => { if (!released) { onFailure(new Error('麦克风录音失败，请重新开启监听。')); void release(); } };
    next.onstop = () => {
      if (released || recording.firstSpeech === null) return;
      if (conversions.size >= 2) { onFailure(new Error('录音转换跟不上输入，监听已暂停。')); void release(); return; }
      // MediaRecorder owns complete segment containers; never decode incomplete WebM chunks.
      const task = convert(recording).catch(error => { if (!released) { onFailure(error); void release(); } });
      conversions.add(task); void task.finally(() => conversions.delete(task));
    };
    recorder = next; segment = recording; next.start();
  };
  try {
    stream = await environment.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (signal.aborted || released) { stream.getTracks().forEach(track => track.stop()); throw new Error('录音已取消。'); }
    stream.getTracks().forEach(track => track.addEventListener?.('ended', onEnded));
    context = new environment.AudioContext();
    source = context.createMediaStreamSource(stream); analyser = context.createAnalyser(); analyser.fftSize = 2048; source.connect(analyser);
    await audioStep(context.resume(), '音频初始化');
    if (signal.aborted || released) { if (context.state !== 'closed') await context.close(); throw new Error('录音已取消。'); }
    startRecording();
    const samples = new Float32Array(analyser.fftSize);
    timer = setInterval(() => {
      if (released || recorder.state !== 'recording') return;
      const time = now(); analyser.getFloatTimeDomainData(samples);
      let energy = 0; for (const value of samples) energy += value * value;
      if (Math.sqrt(energy / samples.length) >= .012) { segment.firstSpeech ??= time; segment.lastSpeech = time; }
      if (time - segment.started >= 14500 || (segment.lastSpeech !== null && time - segment.lastSpeech >= 800)) {
        recorder.stop(); if (!released) startRecording();
      }
    }, 50);
    return release;
  } catch (error) { await release(); throw error; }
}
