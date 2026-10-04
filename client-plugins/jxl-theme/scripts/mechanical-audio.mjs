/** Original procedural UI sounds. No sampled recording, network or keyboard logging. */
export function createMechanicalAudio(host, initiallyEnabled = true) {
  let enabled = initiallyEnabled;
  let context;
  let disposed = false;
  let lastPlay = -Infinity;
  const voices = new Set();
  const buffers = new Map();
  const unbind = new Set();
  function stop() {
    for (const voice of voices) { try { voice.stop(); } catch {} voice.disconnect(); }
    voices.clear();
  }
  function arm() {
    if (!enabled || disposed) return;
    try {
      const Audio = host.AudioContext || host.webkitAudioContext;
      if (!context && Audio) context = new Audio();
      if (context?.state === 'suspended') void context.resume().catch(() => {});
    } catch { /* Missing audio devices must never prevent an action. */ }
  }
  function makeBuffer(kind) {
    if (buffers.has(kind)) return buffers.get(kind);
    const duration = { press: .068, release: .032, detent: .046, feed: .34 }[kind];
    if (!duration) return null;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 7319;
    for (let i = 0; i < data.length; i++) {
      const time = i / context.sampleRate;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      const feed = kind === 'feed';
      const pulse = feed ? time % .038 : time;
      const attack = Math.min(1, pulse / .0012);
      const envelope = attack * Math.exp(-pulse * (feed ? 190 : 95));
      const tail = Math.min(1, (duration - time) / .008);
      const body = Math.sin(2 * Math.PI * (kind === 'detent' ? 430 : 230) * pulse);
      data[i] = (noise * .36 + body * .23) * envelope * tail * (feed ? .32 : 1);
    }
    buffers.set(kind, buffer);
    return buffer;
  }
  function play(kind) {
    if (!enabled || disposed || !context || context.state !== 'running') return false;
    const now = context.currentTime;
    if (kind !== 'feed' && now - lastPlay < .025) return false;
    const buffer = makeBuffer(kind);
    if (!buffer) return false;
    if (voices.size >= 4) return false;
    const voice = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = .22;
    voice.buffer = buffer;
    voice.connect(gain); gain.connect(context.destination);
    voices.add(voice);
    voice.onended = () => { voices.delete(voice); voice.disconnect(); gain.disconnect(); };
    voice.start(now); lastPlay = now;
    return true;
  }
  function bind(document) {
    const control = (event) => event.target?.closest?.('button,summary,[role="switch"],[role="tab"]');
    const down = (event) => {
      if (!event.isTrusted || event.button > 0) return;
      arm();
      const target = control(event);
      if (!target || target.disabled || target.classList.contains('jxl-sound-toggle')) return;
      play(target.classList.contains('jxl-theme-dial') ? 'detent' : 'press');
    };
    const key = (event) => {
      if (!event.isTrusted || event.repeat || event.isComposing) return;
      const target = control(event);
      const dial = target?.classList.contains('jxl-theme-dial');
      if (!['Enter', ' '].includes(event.key) && !(dial && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))) return;
      arm();
      if (target && !target.disabled && !target.classList.contains('jxl-sound-toggle')) play(dial ? 'detent' : 'press');
    };
    const up = (event) => {
      const target = control(event);
      if (event.isTrusted && !(event.button > 0) && target && !target.disabled && !target.classList.contains('jxl-sound-toggle')) play('release');
    };
    document.addEventListener?.('pointerdown', down, true);
    document.addEventListener?.('pointerup', up, true);
    document.addEventListener?.('keydown', key, true);
    const cleanup = () => {
      document.removeEventListener?.('pointerdown', down, true);
      document.removeEventListener?.('pointerup', up, true);
      document.removeEventListener?.('keydown', key, true);
      unbind.delete(cleanup);
    };
    unbind.add(cleanup);
    return cleanup;
  }
  return {
    arm, play, bind,
    setEnabled(value) { enabled = value === true; if (!enabled) stop(); },
    dispose() {
      disposed = true; stop();
      for (const cleanup of unbind) cleanup();
      buffers.clear();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    },
  };
}
