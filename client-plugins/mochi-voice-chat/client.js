window.__ModuleLoader__.load({id:"mochi-voice-chat",factory:(require)=>{var module={exports:{}};var exports=module.exports;
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

// session-reply.mjs
function spokenReply(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^[ \t]*(?:#{1,6}|>|[-*])[ \t]+/gm, "").replace(/[*_`]/g, "").trim();
}

// reply-reader.mjs
var durable = (entries) => entries.filter((row) => row.type === "event" && Number.isSafeInteger(row.event.seq));
var latestSeq = (entries) => durable(entries).reduce((latest, row) => Math.max(latest, row.event.seq), -1);
function completedReplies(entries, afterSeq) {
  let currentTurn;
  const human = /* @__PURE__ */ new Set(), text = /* @__PURE__ */ new Map(), replies = [];
  for (const { event } of durable(entries)) {
    if (event.type === "turn/start") currentTurn = event.data.turn;
    if (event.type === "user/message" && (!event.data.source || event.data.source.kind === "user") && currentTurn !== void 0) human.add(currentTurn);
    if (event.type === "assistant/message" && !event.data.interrupted) {
      const content = event.data.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
      if (content) text.set(event.data.turn, content);
    }
    if (event.type === "turn/end" && event.seq > afterSeq && human.has(event.data.turn) && event.data.reason.kind === "completed" && text.has(event.data.turn)) replies.push({ seq: event.seq, text: spokenReply(text.get(event.data.turn)) });
  }
  return replies;
}
var ReplyReader = class {
  constructor(desktop, onError = () => {
  }) {
    this.desktop = desktop;
    this.onError = onError;
    this.enabled = false;
    this.cursor = -1;
    this.binding = null;
    this.dispose = null;
    this.playbackId = null;
    this.generation = 0;
  }
  bind(binding) {
    if (binding === this.binding) return;
    this.unbind();
    this.binding = binding;
    if (!binding) return;
    this.cursor = latestSeq(binding.eventSource.getSnapshot().entries);
    this.dispose = binding.eventSource.subscribe(() => this.changed());
  }
  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.cursor = this.binding ? latestSeq(this.binding.eventSource.getSnapshot().entries) : -1;
    if (!enabled) this.stopPlayback();
  }
  changed() {
    const snapshot = this.binding.eventSource.getSnapshot();
    const previous = this.cursor;
    this.cursor = Math.max(previous, latestSeq(snapshot.entries));
    if (!this.enabled || ["replace", "prepend"].includes(snapshot.change.kind)) return;
    const replies = completedReplies(snapshot.entries, previous);
    const reply = replies.at(-1);
    if (reply?.text) void this.play(reply.text);
  }
  async play(text) {
    this.stopPlayback();
    const generation = this.generation, id = crypto.randomUUID();
    this.playbackId = id;
    try {
      const result = await this.desktop.speak({ id, text: text.slice(0, 6e3) });
      if (generation === this.generation && !result.ok && !result.cancelled && !result.muted) this.onError(result.error || "\u6682\u65F6\u65E0\u6CD5\u6717\u8BFB\uFF0C\u8BF7\u67E5\u770B\u6587\u5B57\u56DE\u590D\u3002");
    } catch {
      if (generation === this.generation) this.onError("\u6682\u65F6\u65E0\u6CD5\u6717\u8BFB\uFF0C\u8BF7\u67E5\u770B\u6587\u5B57\u56DE\u590D\u3002");
    } finally {
      if (this.playbackId === id) this.playbackId = null;
    }
  }
  stopPlayback() {
    ++this.generation;
    const id = this.playbackId;
    this.playbackId = null;
    if (id) void Promise.resolve(this.desktop.stop({ id })).catch(() => {
    });
  }
  unbind() {
    this.dispose?.();
    this.dispose = null;
    this.binding = null;
    this.stopPlayback();
  }
  close() {
    this.enabled = false;
    this.unbind();
  }
};

// entry-controls.mjs
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var h = import_react.default.createElement;
function ReplyAudioControl({ enabled, busy, error, onClick, root = false }) {
  const label = enabled ? "\u5173\u95ED\u56DE\u590D\u6717\u8BFB" : "\u5F00\u542F\u56DE\u590D\u6717\u8BFB";
  const icon = h(
    "svg",
    { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, "aria-hidden": true },
    h("path", { d: "M11 4 6 8H3v8h3l5 4V4Z" }),
    h("path", { d: enabled ? "M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" : "m16 9 5 6m0-6-5 6" })
  );
  return h(
    import_dsh_client_ui_primitives.Tooltip,
    { label: error || (busy ? "\u6B63\u5728\u66F4\u65B0\u6717\u8BFB\u8BBE\u7F6E\u2026" : label), side: "bottom", portal: true },
    h(import_dsh_client_ui_primitives.Button, {
      type: "button",
      variant: "ghost",
      size: "md",
      icon,
      disabled: busy,
      onClick,
      "aria-label": label,
      "aria-pressed": enabled,
      "aria-busy": busy,
      title: error || label,
      className: "mochi-reply-audio",
      "data-mochi-reply-toggle": root ? "root" : "session",
      style: { width: 36, height: 36, padding: 0, borderRadius: "50%" },
      children: null
    })
  );
}

// client-entry.mjs
var inject = ["slots", "sessions", "sidebarRight"];
var h2 = import_react2.default.createElement;
function apply(ctx) {
  const desktop = window.mochiVoiceChatDesktop;
  const listeners = /* @__PURE__ */ new Set();
  let state = { enabled: false, busy: true, error: "" }, alive = true;
  const publish = (changes) => {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  };
  const reader = new ReplyReader(desktop, (error) => publish({ error }));
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const snapshot = () => state;
  let lock = false;
  async function toggle() {
    if (lock || !desktop?.setEnabled) return;
    lock = true;
    publish({ busy: true, error: "" });
    try {
      const result = await desktop.setEnabled(!state.enabled);
      if (!alive) return;
      reader.setEnabled(result.enabled);
      publish({ enabled: result.enabled, error: result.error || "" });
    } catch {
      if (alive) publish({ error: "\u6717\u8BFB\u8BBE\u7F6E\u6682\u65F6\u65E0\u6CD5\u4FDD\u5B58\uFF0C\u8BF7\u91CD\u8BD5\u3002" });
    } finally {
      lock = false;
      if (alive) publish({ busy: false });
    }
  }
  function Control({ root = false }) {
    const value = import_react2.default.useSyncExternalStore(subscribe, snapshot);
    return h2(ReplyAudioControl, { ...value, onClick: toggle, root });
  }
  function RootControl() {
    const mounted = ctx.sidebarRight.mounted;
    const sessionId = import_react2.default.useSyncExternalStore((listener) => mounted.subscribe(listener), () => mounted.getSnapshot());
    import_react2.default.useLayoutEffect(() => {
      reader.bind(sessionId ? ctx.sessions.binding(sessionId) : null);
      return () => reader.unbind();
    }, [sessionId]);
    return h2(Control, { root: true });
  }
  ctx.slots.inject("conversation.header.leading", () => ctx.slots.register({ name: "conversation.header.leading", id: "mochi-reply-audio-root" }, RootControl));
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = 'header:has(>[data-conversation-header-leading] [data-mochi-reply-toggle="root"]){grid-template-columns:minmax(0,1fr) 36px;column-gap:24px;padding-inline-end:12px}[data-conversation-header-leading]:has([data-mochi-reply-toggle="root"]){grid-area:1/2;justify-self:end;margin:0}[data-conversation-header-leading]:has([data-mochi-reply-toggle="root"])+div:not([data-slot]),[data-conversation-header-leading]:has([data-mochi-reply-toggle="root"])+[data-slot="conversation.session.header"]>div:has(>[data-conversation-header-corner]){grid-area:1/1;min-width:0}.mochi-reply-audio{flex-shrink:0;-webkit-app-region:no-drag}';
    document.head.append(style);
    if (desktop?.getState && desktop?.setEnabled) {
      void desktop.getState().then((value) => {
        if (!alive) return;
        reader.setEnabled(value.enabled);
        publish({ enabled: value.enabled, busy: false });
      }, () => {
        if (alive) publish({ busy: false, error: "\u6717\u8BFB\u8BBE\u7F6E\u6682\u65F6\u4E0D\u53EF\u7528\u3002" });
      });
    } else publish({ busy: true, error: "\u56DE\u7B54\u6717\u8BFB\u9700\u8981 Mochi \u684C\u9762\u7248\u3002" });
    return () => {
      alive = false;
      reader.close();
      style.remove();
      listeners.clear();
    };
  });
}

return module.exports;}});
