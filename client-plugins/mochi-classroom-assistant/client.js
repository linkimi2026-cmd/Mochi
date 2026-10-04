window.__ModuleLoader__.load({id:"mochi-classroom-assistant-client",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client-entry.mjs
var client_entry_exports = {};
__export(client_entry_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_entry_exports);
var import_react2 = __toESM(require("react"), 1);

// ../../plugins/mochi-classroom-assistant/intents.mjs
function classifyTranscript(raw, recording = false) {
  const text = raw.trim();
  const command = text.replace(/[，。！？、\s]/g, "");
  if (/^(?:请)?(?:把猫叫出来|猫叫出来|叫猫出来|猫出来|Mochi出来|mochi出来|茉叽出来)$/.test(command)) return { kind: "wake", text };
  if (/^(?:结束作业记录|作业记录结束|停止记录作业|作业说完了)$/.test(command)) return { kind: "finish", text };
  const homework = text.split(/[，。！？；]/).some((part) => part.includes("\u4F5C\u4E1A") && !/(?:没有|没|不(?:要|用|布置)|无需|取消|不是).{0,6}作业|作业.{0,4}(?:不用|不需要|取消)/.test(part));
  if (!recording && homework) return { kind: "begin", text };
  return { kind: recording ? "append" : "ignore", text };
}

// ../../plugins/mochi-classroom-assistant/listening.mjs
var ListeningController = class {
  constructor({ store, transcribe, prepare = async () => {
  }, capture, onWake = () => {
  }, onLetter = () => {
  }, onState = () => {
  }, handleResult }) {
    Object.assign(this, { store, transcribe, prepare, capture, onWake, onLetter, onState, handleResult });
    this.state = "stopped";
    this.generation = 0;
    this.queue = [];
    this.abort = null;
    this.release = null;
    this.draining = false;
  }
  publish(state, error) {
    this.state = state;
    this.onState({ state, error, recordingHomework: !!this.store.data.active });
  }
  async start() {
    if (!["stopped", "paused", "error"].includes(this.state)) return;
    const generation = ++this.generation;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.publish("preparing");
    try {
      await this.prepare(signal);
      if (signal.aborted || generation !== this.generation) return;
      const release = await this.capture((audio) => this.push(audio), signal, (error) => {
        if (!signal.aborted && generation === this.generation) {
          void this.stop("error");
          this.onState({ state: "error", error: String(error.message ?? error), recordingHomework: !!this.store.data.active });
        }
      });
      if (signal.aborted || generation !== this.generation) {
        await release();
        return;
      }
      this.release = release;
      this.publish("listening");
    } catch (error) {
      if (!signal.aborted && generation === this.generation) this.publish("error", String(error.message ?? error));
    }
  }
  async pause() {
    await this.stop("paused");
  }
  async resume() {
    await this.start();
  }
  async stop(state = "stopped") {
    ++this.generation;
    this.abort?.abort();
    this.queue = [];
    const release = this.release;
    this.release = null;
    this.publish(state);
    await release?.();
  }
  push(audio) {
    if (this.state !== "listening") return false;
    if (this.queue.length >= 2) {
      void this.stop("error");
      this.onState({ state: "error", error: "\u8BC6\u522B\u5904\u7406\u8DDF\u4E0D\u4E0A\u5F55\u97F3\uFF0C\u5DF2\u505C\u6B62\u76D1\u542C\uFF1B\u4F5C\u4E1A\u539F\u6587\u4FDD\u7559\u3002" });
      return false;
    }
    this.queue.push(audio);
    void this.drain();
    return true;
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    const drainingGeneration = this.generation;
    try {
      while (this.queue.length && this.state === "listening") {
        const generation = this.generation, signal = this.abort.signal;
        const result = await this.transcribe(this.queue.shift(), signal);
        if (signal.aborted || generation !== this.generation) continue;
        if (this.handleResult) this.handleResult(result);
        else this.acceptTranscript(result.text);
      }
    } catch (error) {
      if (drainingGeneration === this.generation && !this.abort?.signal.aborted) {
        await this.stop("error");
        this.onState({ state: "error", error: String(error.message ?? error) });
      }
    } finally {
      this.draining = false;
      if (this.queue.length && this.state === "listening") void this.drain();
    }
  }
  acceptTranscript(text) {
    if (typeof text !== "string" || !text.trim()) return;
    const intent = classifyTranscript(text, !!this.store.data.active);
    if (intent.kind === "wake") this.onWake();
    if (intent.kind === "begin") this.store.begin(text);
    if (intent.kind === "append") this.store.append(text);
    if (intent.kind === "finish") {
      const letter = this.store.finish();
      if (letter) this.onLetter(letter);
    }
    this.onState({ state: this.state, recordingHomework: !!this.store.data.active });
  }
};

// recorder.mjs
function encodeWave(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (at, value) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16e3, true);
  view.setUint32(28, 32e3, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}
async function capturePcm(onAudio, signal, environment = globalThis, onFailure = () => {
}) {
  let stream, context, source, analyser, recorder, segment, timer, released = false;
  const conversions = /* @__PURE__ */ new Set();
  const now = () => environment.performance?.now() ?? Date.now();
  const audioStep = (operation, label) => new Promise((resolve, reject) => {
    const cancel = () => finish(new Error("\u5F55\u97F3\u5DF2\u53D6\u6D88\u3002"));
    const timeout = setTimeout(() => finish(new Error(`${label}\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u5F00\u542F\u76D1\u542C\u3002`)), 1e4);
    const finish = (error, value) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      error ? reject(error) : resolve(value);
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    else Promise.resolve(operation).then((value) => finish(null, value), finish);
  });
  const onEnded = () => {
    if (!released) {
      onFailure(new Error("\u9EA6\u514B\u98CE\u8FDE\u63A5\u5DF2\u4E2D\u65AD\uFF0C\u8BF7\u68C0\u67E5\u8BBE\u5907\u540E\u91CD\u65B0\u5F00\u542F\u76D1\u542C\u3002"));
      void release();
    }
  };
  const release = async () => {
    if (released) return;
    released = true;
    signal.removeEventListener("abort", onAbort);
    clearInterval(timer);
    if (recorder?.state === "recording") recorder.stop();
    source?.disconnect();
    stream?.getTracks().forEach((track) => {
      track.removeEventListener?.("ended", onEnded);
      track.stop();
    });
    await Promise.allSettled([...conversions]);
    if (context && context.state !== "closed") await context.close();
  };
  const onAbort = () => {
    void release();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const convert = async (recording) => {
    if (released || recording.firstSpeech === null || !recording.chunks.length) return;
    const bytes = await new Blob(recording.chunks).arrayBuffer();
    const decoded = await audioStep(context.decodeAudioData(bytes), "\u5F55\u97F3\u89E3\u7801");
    if (released || signal.aborted) return;
    const seconds = Math.min(15, decoded.duration);
    if (seconds < 0.25) return;
    const offline = new environment.OfflineAudioContext(1, Math.max(1, Math.floor(seconds * 16e3)), 16e3);
    const input = offline.createBufferSource();
    input.buffer = decoded;
    input.connect(offline.destination);
    input.start(0, 0, seconds);
    const rendered = await audioStep(offline.startRendering(), "\u5F55\u97F3\u91CD\u91C7\u6837");
    if (!released && !signal.aborted) onAudio(encodeWave(rendered.getChannelData(0)));
  };
  const startRecording = () => {
    const recording = { started: now(), firstSpeech: null, lastSpeech: null, chunks: [], size: 0 };
    const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((type) => environment.MediaRecorder.isTypeSupported(type));
    const next = new environment.MediaRecorder(stream, mimeType ? { mimeType } : void 0);
    next.ondataavailable = (event) => {
      if (released || !event.data.size) return;
      recording.size += event.data.size;
      if (recording.size > 2 * 1024 * 1024) {
        onFailure(new Error("\u5F55\u97F3\u6570\u636E\u8FC7\u5927\uFF0C\u76D1\u542C\u5DF2\u505C\u6B62\u3002"));
        void release();
        return;
      }
      recording.chunks.push(event.data);
    };
    next.onerror = () => {
      if (!released) {
        onFailure(new Error("\u9EA6\u514B\u98CE\u5F55\u97F3\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5F00\u542F\u76D1\u542C\u3002"));
        void release();
      }
    };
    next.onstop = () => {
      if (released || recording.firstSpeech === null) return;
      if (conversions.size >= 2) {
        onFailure(new Error("\u5F55\u97F3\u8F6C\u6362\u8DDF\u4E0D\u4E0A\u8F93\u5165\uFF0C\u76D1\u542C\u5DF2\u6682\u505C\u3002"));
        void release();
        return;
      }
      const task = convert(recording).catch((error) => {
        if (!released) {
          onFailure(error);
          void release();
        }
      });
      conversions.add(task);
      void task.finally(() => conversions.delete(task));
    };
    recorder = next;
    segment = recording;
    next.start();
  };
  try {
    stream = await environment.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (signal.aborted || released) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("\u5F55\u97F3\u5DF2\u53D6\u6D88\u3002");
    }
    stream.getTracks().forEach((track) => track.addEventListener?.("ended", onEnded));
    context = new environment.AudioContext();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    await audioStep(context.resume(), "\u97F3\u9891\u521D\u59CB\u5316");
    if (signal.aborted || released) {
      if (context.state !== "closed") await context.close();
      throw new Error("\u5F55\u97F3\u5DF2\u53D6\u6D88\u3002");
    }
    startRecording();
    const samples = new Float32Array(analyser.fftSize);
    timer = setInterval(() => {
      if (released || recorder.state !== "recording") return;
      const time = now();
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const value of samples) energy += value * value;
      if (Math.sqrt(energy / samples.length) >= 0.012) {
        segment.firstSpeech ??= time;
        segment.lastSpeech = time;
      }
      if (time - segment.started >= 14500 || segment.lastSpeech !== null && time - segment.lastSpeech >= 800) {
        recorder.stop();
        if (!released) startRecording();
      }
    }, 50);
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}

// ../mochi-voice-chat/entry-controls.mjs
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var h = import_react.default.createElement;
var microphone = () => h(import_dsh_client_ui_primitives.IconMicrophoneOutlineRegular, { size: 16, "aria-hidden": true });
var singleLine = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
function ListeningEntryControl({ wide = true, state, label, description, onClick }) {
  return h(
    import_dsh_client_ui_primitives.Tooltip,
    { label: description, side: "right", portal: true, disabled: wide },
    h(import_dsh_client_ui_primitives.Button, {
      type: "button",
      variant: "ghost",
      size: "md",
      icon: microphone(),
      onClick,
      "aria-label": label,
      title: description,
      "data-mochi-classroom-status": state,
      "data-wide": String(wide),
      style: {
        width: wide ? "100%" : 36,
        minWidth: wide ? 0 : 36,
        height: 36,
        padding: wide ? "0 8px" : 0,
        justifyContent: wide ? "flex-start" : "center",
        flexShrink: 0,
        whiteSpace: "nowrap",
        borderRadius: wide ? 12 : "50%"
      }
    }, wide ? h("span", { style: singleLine }, label) : null)
  );
}

// client-entry.mjs
var BASE = "/api/mochi-classroom";
var inject = ["slots"];
var labels = { stopped: "\u76D1\u542C\u672A\u5F00\u542F", preparing: "\u51C6\u5907\u672C\u5730\u8BC6\u522B", listening: "\u540E\u53F0\u76D1\u542C\u4E2D", paused: "\u540E\u53F0\u76D1\u542C\u5DF2\u6682\u505C", error: "\u76D1\u542C\u9700\u8981\u5904\u7406" };
function apply(ctx) {
  let disposed = false, timer, host = null, status = { state: "stopped" }, open = false, selected = null, startup = null, pendingLetterId = null, manualListening = false;
  const drafts = /* @__PURE__ */ new Map();
  const reasons = /* @__PURE__ */ new Set(), listeners = /* @__PURE__ */ new Set(), proxy = { data: { active: null } };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const update = (next) => {
    host = next;
    proxy.data.active = host.active;
    if (!host.settings.autoStartListening && !manualListening) reasons.add("startup-disabled");
    else reasons.delete("startup-disabled");
    if (pendingLetterId && host.letters.some((letter) => letter.id === pendingLetterId)) {
      selected = pendingLetterId;
      pendingLetterId = null;
      open = true;
    }
    notify();
  };
  const request = async (path, input, signal) => {
    const response = await fetch(BASE + path, { credentials: "same-origin", signal, ...input === void 0 ? {} : { method: "POST", headers: { "content-type": input instanceof Uint8Array ? "audio/wav" : "application/json" }, body: input instanceof Uint8Array ? input : JSON.stringify(input) } });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `\u8BFE\u5802\u52A9\u624B\u8BF7\u6C42\u5931\u8D25 (${response.status})`);
    return value;
  };
  const read = async (signal) => {
    const next = await request("/state", void 0, signal);
    update(next);
    return next;
  };
  const selectedProvider = (next) => next.speech.providers.find((item) => item.id === next.speech.selection.providerId);
  const controller = new ListeningController({
    store: proxy,
    capture: (onAudio, signal, onFailure) => capturePcm(onAudio, signal, globalThis, onFailure),
    prepare: async (signal) => {
      const next = await read(signal), provider = selectedProvider(next);
      if (provider?.location !== "host-local") throw new Error("\u8BF7\u5148\u5728\u8BED\u97F3\u8BBE\u7F6E\u9009\u62E9\u672C\u5730\u8BC6\u522B\u3002");
      if (provider.preparation.phase === "standby") await request("/prepare", {}, signal);
      else if (provider.preparation.phase !== "ready") throw new Error("\u8BF7\u5148\u51C6\u5907\u672C\u5730\u8BC6\u522B\u6A21\u578B\uFF0C\u518D\u5F00\u542F\u76D1\u542C\u3002");
    },
    transcribe: (audio, signal) => request("/transcribe", audio, signal),
    onState: (next) => {
      status = next;
      notify();
      if (next.state === "listening") void window.mochiClassroomDesktop?.listeningReady?.();
      window.dispatchEvent(new CustomEvent("mochi-classroom-listening-state", { detail: { ...status, pauseReasons: [...reasons] } }));
    },
    handleResult: (result) => {
      update(result.state);
      if (result.intent.kind === "wake") {
        void window.mochiClassroomDesktop?.wake?.();
        window.dispatchEvent(new CustomEvent("mochi-classroom-wake"));
      }
      if (result.letter) showLetter(result.letter);
      if (result.lessonLetter) showLetter(result.lessonLetter);
    }
  });
  const showLetter = (letter) => {
    selected = letter.id;
    open = true;
    notify();
    void window.mochiClassroomDesktop?.letterReady?.({ id: letter.id, title: letter.title, body: letter.body, endedAt: letter.endedAt });
    window.dispatchEvent(new CustomEvent("mochi-classroom-letter", { detail: letter }));
  };
  const pause = async (reason = "manual") => {
    if (reason === "manual") manualListening = false;
    reasons.add(reason);
    await controller.pause();
    notify();
  };
  const resume = async (reason = "manual") => {
    if (reason === "manual") {
      manualListening = true;
      reasons.delete("startup-disabled");
    }
    reasons.delete(reason);
    notify();
    if (!disposed && !reasons.size) await controller.resume();
  };
  const busy = (event) => {
    const { reason, busy: busy2 } = event.detail ?? {};
    if (typeof reason !== "string" || reason.length > 80 || typeof busy2 !== "boolean") return;
    void (busy2 ? pause(reason) : resume(reason));
  };
  const api = { pause, resume, snapshot: () => ({ ...status, pauseReasons: [...reasons], recordingHomework: !!host?.active, recordingLesson: !!host?.lessonActive }), open: () => {
    open = true;
    notify();
  } };
  const useSnapshot = () => {
    const [, rerender] = import_react2.default.useReducer((n) => n + 1, 0);
    import_react2.default.useEffect(() => {
      listeners.add(rerender);
      return () => listeners.delete(rerender);
    }, []);
  };
  const h2 = import_react2.default.createElement;
  const run = (operation) => void Promise.resolve().then(operation).catch((error) => {
    status = { ...status, error: error.message };
    notify();
  });
  function Entry({ wide }) {
    useSnapshot();
    if (!host) return null;
    const label = `${host.lessonActive ? "\u4E0A\u8BFE\u8BB0\u5F55\u4E2D \xB7 " : host.active ? "\u6B63\u5728\u8BB0\u5F55\u4F5C\u4E1A \xB7 " : ""}${labels[status.state] || status.state}`;
    return h2(ListeningEntryControl, { wide, state: status.state, label, description: status.error || `\u8BFE\u5802\u52A9\u624B\uFF1A${label}\uFF1B\u672C\u5730\u76D1\u542C\u3001\u4F5C\u4E1A\u8BB0\u5F55\u4E0E\u6682\u505C`, onClick: () => api.open() });
  }
  function LetterEditor({ letter }) {
    const [body, setBody] = import_react2.default.useState(drafts.get(letter.id) ?? letter.body), [saving, setSaving] = import_react2.default.useState(false);
    return h2(
      "section",
      { className: "mochi-classroom-paper" },
      h2("h3", null, letter.title),
      h2("p", null, letter.kind === "lesson" ? "\u672C\u5730\u4ECE\u672C\u8282\u8BFE\u8BC6\u522B\u539F\u6587\u9009\u51FA\u8981\u70B9\uFF0C\u53EF\u7F16\u8F91\u5E76\u5C55\u5F00\u6838\u5BF9\u6765\u6E90\u3002\u4FDD\u5B58\u4EC5\u4FDD\u7559\u5728\u672C\u673A\u3002" : "\u4EE5\u4E0B\u4E3A\u771F\u5B9E\u8BC6\u522B\u539F\u6587\uFF0C\u53EF\u7EA0\u6B63\u9519\u5B57\u3002\u4FDD\u5B58\u4EC5\u4FDD\u7559\u5728\u672C\u673A\u3002"),
      h2("textarea", { value: body, onChange: (event) => {
        const next = event.target.value;
        drafts.set(letter.id, next);
        setBody(next);
      }, "aria-label": letter.kind === "lesson" ? "\u8BFE\u5802\u91CD\u70B9\u4FE1\u4EF6\u6B63\u6587" : "\u4F5C\u4E1A\u4FE1\u4EF6\u6B63\u6587", maxLength: 1e5, rows: 12 }),
      h2("button", { type: "button", disabled: saving, onClick: () => {
        setSaving(true);
        run(async () => {
          try {
            const result = await request("/edit", { id: letter.id, body });
            update(result.state);
            drafts.delete(letter.id);
          } finally {
            setSaving(false);
          }
        });
      } }, saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u4FEE\u6539"),
      letter.kind === "lesson" && h2(
        "details",
        null,
        h2("summary", null, "\u67E5\u770B\u91CD\u70B9\u6765\u6E90\u4E0E\u672C\u8282\u8BFE\u539F\u6587"),
        h2("p", null, "\u65F6\u95F4\u4E3A\u672C\u673A\u6536\u5230\u8BC6\u522B\u6587\u5B57\u7684\u65F6\u95F4\uFF0C\u4E0D\u80FD\u636E\u6B64\u5224\u5B9A\u8BF4\u8BDD\u4EBA\u3002"),
        ...letter.notes.map((note) => h2(
          "details",
          { key: note.id },
          h2("summary", null, note.text),
          ...note.sourceRefs.map((ref, index) => {
            const segment = letter.segments.find((item) => item.id === ref.segmentId);
            return h2("p", { key: index }, `${new Date(ref.at).toLocaleTimeString()} \xB7 ${segment?.text ?? ""}`);
          })
        )),
        h2(
          "details",
          null,
          h2("summary", null, `\u672C\u8282\u8BFE\u5168\u90E8\u8BC6\u522B\u539F\u6587\uFF08${letter.segments.length}\u6BB5\uFF09`),
          ...letter.segments.map((segment) => h2("p", { key: segment.id }, `${new Date(segment.at).toLocaleTimeString()} \xB7 ${segment.text}`))
        )
      )
    );
  }
  function Panel() {
    useSnapshot();
    if (!host || !open) return null;
    const provider = selectedProvider(host), ready = ["ready", "standby"].includes(provider?.preparation.phase);
    const letter = host.letters.find((item) => item.id === selected);
    return h2(
      "div",
      { className: "mochi-classroom-backdrop", onClick: (event) => {
        if (event.target === event.currentTarget) {
          open = false;
          notify();
        }
      } },
      h2(
        "section",
        { className: "mochi-classroom-panel", role: "dialog", "aria-modal": true, "aria-label": "\u8BFE\u5802\u52A9\u624B" },
        h2("header", null, h2("h2", null, "\u8BFE\u5802\u52A9\u624B"), h2("button", { type: "button", onClick: () => {
          open = false;
          notify();
        } }, "\u5173\u95ED")),
        h2("p", { role: "status" }, `${labels[status.state]}${host.lessonActive ? " \xB7 \u6B63\u5728\u8BB0\u5F55\u672C\u8282\u8BFE" : ""}${host.active ? " \xB7 \u6B63\u5728\u8BB0\u5F55\u4F5C\u4E1A\u539F\u6587" : ""}`),
        status.error && h2("p", { role: "alert" }, status.error),
        h2("p", null, "\u8BF4\u201C\u5F00\u59CB\u4E0A\u8BFE\u201D\u8BB0\u5F55\u672C\u8282\u8BFE\uFF0C\u8BF4\u201C\u4E0B\u8BFE\u201D\u751F\u6210\u91CD\u70B9\u6458\u5F55\u4FE1\uFF1B\u8BF4\u201C\u628A\u732B\u53EB\u51FA\u6765\u201D\u5524\u9192 Mochi\uFF1B\u63D0\u5230\u201C\u4F5C\u4E1A\u201D\u5F00\u59CB\u8BB0\u5F55\uFF0C\u8BF4\u201C\u7ED3\u675F\u4F5C\u4E1A\u8BB0\u5F55\u201D\u751F\u6210\u4FE1\u4EF6\u3002\u9EA6\u514B\u98CE\u6301\u7EED\u4F7F\u7528\u65F6\u4FDD\u6301\u53EF\u89C1\u72B6\u6001\uFF0C\u8BC6\u522B\u53EA\u5728\u672C\u673A\u8FDB\u884C\u3002"),
        h2(
          "div",
          { className: "mochi-classroom-actions" },
          h2("button", { type: "button", disabled: !ready || status.state === "preparing", onClick: () => run(() => status.state === "listening" ? pause("manual") : resume("manual")) }, status.state === "listening" ? "\u6682\u505C\u76D1\u542C" : "\u5F00\u542F\u76D1\u542C"),
          !ready && h2("button", { type: "button", onClick: () => run(async () => {
            await request("/prepare", {});
            await read();
          }) }, "\u51C6\u5907\u672C\u5730\u8BC6\u522B\u6A21\u578B"),
          h2("button", { type: "button", onClick: () => run(async () => {
            const result = await request(host.lessonActive ? "/lesson/finish" : "/lesson/begin", {});
            update(result.state ?? result);
            if (result.letter) showLetter(result.letter);
          }) }, host.lessonActive ? "\u4E0B\u8BFE\uFF0C\u6574\u7406\u91CD\u70B9" : "\u5F00\u59CB\u4E0A\u8BFE"),
          host.active && h2("button", { type: "button", onClick: () => run(async () => {
            const result = await request("/finish", {});
            update(result.state);
            if (result.letter) showLetter(result.letter);
          }) }, "\u7ED3\u675F\u8BB0\u5F55\uFF0C\u751F\u6210\u4FE1\u4EF6")
        ),
        h2("label", null, h2("input", { type: "checkbox", checked: !!host.settings.autoStartListening && (!startup?.supported || startup.enabled), disabled: startup?.needsApproval === true, onChange: (event) => {
          const enabled = event.target.checked;
          run(async () => {
            const native = window.mochiClassroomDesktop, before = startup;
            if (native?.setStartup) {
              startup = await native.setStartup(enabled);
              notify();
              if (startup.supported && (startup.enabled !== enabled || startup.needsApproval)) throw new Error("\u7CFB\u7EDF\u5F00\u673A\u542F\u52A8\u5C1A\u672A\u751F\u6548\uFF0C\u8BF7\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u5B8C\u6210\u6388\u6743\u3002");
            }
            try {
              manualListening = false;
              update(await request("/configure", { autoStartListening: enabled }));
            } catch (error) {
              if (before?.supported) startup = await native.setStartup(before.enabled);
              throw error;
            }
            if (enabled) await resume("startup-disabled");
            else await pause("startup-disabled");
          });
        } }), startup?.supported ? "\u5F00\u673A\u540E\u81EA\u52A8\u76D1\u542C" : "\u5E94\u7528\u542F\u52A8\u540E\u81EA\u52A8\u76D1\u542C"),
        startup?.needsApproval && h2("p", null, "\u7CFB\u7EDF\u5F00\u673A\u542F\u52A8\u7B49\u5F85\u6388\u6743\uFF0C\u8BF7\u5230\u7CFB\u7EDF\u767B\u5F55\u9879\u8BBE\u7F6E\u5141\u8BB8 Mochi\u3002"),
        provider && h2("p", null, `\u672C\u5730\u6A21\u578B\u72B6\u6001\uFF1A${{ unprepared: "\u5C1A\u672A\u51C6\u5907", ready: "\u5C31\u7EEA", standby: "\u5F85\u673A", checking: "\u68C0\u67E5\u4E2D", downloading: "\u4E0B\u8F7D\u4E2D", loading: "\u52A0\u8F7D\u4E2D", waking: "\u5524\u9192\u4E2D", cancelling: "\u53D6\u6D88\u4E2D", cancelled: "\u5DF2\u53D6\u6D88", failed: "\u51C6\u5907\u5931\u8D25" }[provider.preparation.phase] || provider.preparation.phase}`),
        reasons.size > 0 && h2("p", null, `\u6682\u505C\u539F\u56E0\uFF1A${[...reasons].map((reason) => ({ manual: "\u624B\u52A8\u6682\u505C", "official-voice-input": "\u8BED\u97F3\u8F93\u5165\u6B63\u5728\u4F7F\u7528\u9EA6\u514B\u98CE", "startup-disabled": "\u81EA\u52A8\u76D1\u542C\u5DF2\u5173\u95ED", tts: "\u6B63\u5728\u6717\u8BFB" })[reason] || reason).join("\u3001")}`),
        h2("h3", null, "\u672C\u673A\u8BFE\u5802\u4FE1\u4EF6"),
        host.letters.length ? h2("div", null, ...host.letters.slice().reverse().map((item) => h2("button", { key: item.id, type: "button", onClick: () => {
          selected = item.id;
          notify();
        } }, `${item.title} \xB7 ${new Date(item.endedAt).toLocaleString()}`))) : h2("p", null, "\u8FD8\u6CA1\u6709\u8BFE\u5802\u4FE1\u4EF6\u3002"),
        letter && h2(LetterEditor, { key: letter.id, letter })
      )
    );
  }
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "mochi-classroom-listening", order: 26 }, Entry));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "mochi-classroom-panel", order: 26 }, Panel));
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = ".mochi-classroom-backdrop{position:fixed;inset:0;z-index:1100;background:#0003;display:grid;place-items:center}.mochi-classroom-panel{background:var(--bg-primary,#fffaf1);color:var(--text-primary,#493c32);width:min(680px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;padding:24px;border-radius:20px;box-shadow:0 12px 50px #0002}.mochi-classroom-panel header,.mochi-classroom-actions{display:flex;gap:12px;align-items:center;justify-content:space-between}.mochi-classroom-paper{margin-top:18px;padding:20px;background:#fffdf8;border:1px solid #d9cbbb;border-radius:12px;color:#493c32}.mochi-classroom-paper textarea{width:100%;resize:vertical;background:transparent;color:inherit;line-height:1.7;border:1px solid #bfae99;border-radius:8px;padding:10px}";
    document.head.append(style);
    window.mochiClassroomListening = api;
    window.addEventListener("mochi-classroom-audio-busy", busy);
    const stopAudioActivity = window.mochiClassroomDesktop?.onAudioActivity?.((detail) => window.dispatchEvent(new CustomEvent("mochi-classroom-audio-busy", { detail })));
    const stopOpenLetter = window.mochiClassroomDesktop?.onOpenLetter?.((id) => {
      if (!host) {
        pendingLetterId = id;
        return;
      }
      if (host.letters.some((letter) => letter.id === id)) {
        selected = id;
        open = true;
        notify();
      }
    });
    let voiceBusy = false;
    const observeVoice = () => {
      const next = [...document.querySelectorAll("[data-voice-activity]")].some((node) => ["requesting", "recording", "transcribing"].includes(node.getAttribute("data-voice-activity")));
      if (next === voiceBusy) return;
      voiceBusy = next;
      void (next ? pause("official-voice-input") : resume("official-voice-input"));
    };
    const observer = new MutationObserver(observeVoice);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-voice-activity"] });
    observeVoice();
    const poll = async () => {
      try {
        await read();
        const provider = selectedProvider(host);
        if (host.settings.autoStartListening && !reasons.size && controller.state === "stopped" && ["ready", "standby"].includes(provider?.preparation.phase) && provider.location === "host-local") await controller.start();
      } catch (error) {
        if (!disposed && host) {
          status = { ...status, error: error.message };
          notify();
        }
      } finally {
        if (!disposed) timer = setTimeout(poll, 3e3);
      }
    };
    void window.mochiClassroomDesktop?.getStartup?.().then((value) => {
      startup = value;
      notify();
    }).catch((error) => {
      status = { ...status, error: error.message };
      notify();
    });
    void poll();
    return async () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      style.remove();
      stopOpenLetter?.();
      stopAudioActivity?.();
      window.removeEventListener("mochi-classroom-audio-busy", busy);
      if (window.mochiClassroomListening === api) delete window.mochiClassroomListening;
      await controller.stop();
    };
  });
}

return module.exports;}});
