window.__ModuleLoader__.load({id:"mochi-classroom-planner-client",factory:(require)=>{var module={exports:{}};var exports=module.exports;
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
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// ../mochi-onboarding/sidebar-action.mjs
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var sidebarIcons = { memory: import_dsh_client_ui_primitives.IconArchiveOutlineRegular, planner: import_dsh_client_ui_primitives.IconClockOutlineRegular, guide: import_dsh_client_ui_primitives.IconQuestionOutlineRegular };
function SidebarAction({ wide = true, label, description, icon: Icon, onClick }) {
  const button = import_react.default.createElement(import_dsh_client_ui_primitives.Button, {
    type: "button",
    variant: "ghost",
    size: "md",
    onClick,
    "aria-label": description,
    title: description,
    "data-mochi-sidebar-action": label,
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
    },
    icon: import_react.default.createElement(Icon, { size: 18, "aria-hidden": true })
  }, wide ? import_react.default.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label) : null);
  return import_react.default.createElement(import_dsh_client_ui_primitives.Tooltip, { label: description, side: "right", portal: true, disabled: wide }, button);
}

// client-entry.mjs
var h = import_react2.default.createElement;
var BASE = "/api/mochi-planner";
var inject = ["slots", "conversation"];
function apply(ctx) {
  let state = null, opened = false, error = "", draft = null, draftRevision = 0, busy = false, disposed = false, timer;
  const listeners = /* @__PURE__ */ new Set(), delivered = /* @__PURE__ */ new Set();
  const notify = () => listeners.forEach((fn) => fn());
  const api = async (path, data, headers) => {
    const response = await fetch(BASE + path, { credentials: "same-origin", ...data === void 0 ? {} : { method: "POST", headers: headers || { "content-type": "application/json" }, body: headers ? data : JSON.stringify(data) } });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "\u8BFE\u5802\u7BA1\u5BB6\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u3002");
    return value;
  };
  const update = (next) => {
    state = next;
    notify();
  };
  const act = async (work) => {
    if (busy) return;
    busy = true;
    error = "";
    notify();
    try {
      await work();
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      notify();
    }
  };
  const edit = (candidate) => {
    draftRevision = state?.revision ?? 0;
    error = "";
    draft = { ...candidate, lessons: candidate.draftLessons || candidate.lessons };
    delete draft.issues;
    delete draft.draftLessons;
    opened = true;
    notify();
  };
  const result = (value) => {
    if (value.saved) {
      update(value.state);
      draft = null;
    } else {
      edit(value.candidate);
      error = value.candidate.issues.join("\n");
    }
  };
  const refresh = async () => {
    if (disposed) return;
    try {
      const next = await api("/state");
      if (disposed) return;
      update(next);
      for (const paper of next.papers.filter((p) => !p.queued_at && Date.now() - p.created_at < 15 * 6e4)) {
        if (delivered.has(paper.id)) continue;
        const accepted = await window.mochiClassroomDesktop?.reminderReady?.({ id: paper.id, title: paper.title, body: paper.body, at: paper.created_at });
        if (accepted) {
          delivered.add(paper.id);
          await api("/queued", { id: paper.id });
        }
      }
      for (const paper of next.companionReminders ?? []) {
        if (delivered.has(paper.id)) continue;
        const accepted = await window.mochiClassroomDesktop?.reminderReady?.({ id: paper.id, title: paper.title, body: paper.body, at: paper.createdAt });
        if (accepted) {
          delivered.add(paper.id);
          await api("/companion/queued", { key: paper.key });
        }
      }
    } catch (e) {
      error = e.message;
      notify();
    } finally {
      if (!disposed) timer = setTimeout(refresh, 5e3);
    }
  };
  const subscribe = () => {
    const [, force] = import_react2.default.useReducer((n) => n + 1, 0);
    import_react2.default.useEffect(() => {
      listeners.add(force);
      return () => listeners.delete(force);
    }, []);
  };
  function Entry({ wide }) {
    subscribe();
    return h(SidebarAction, { wide, label: "\u8BFE\u8868", description: "\u8BFE\u5802\u7BA1\u5BB6", icon: sidebarIcons.planner, onClick: () => {
      opened = true;
      notify();
    } });
  }
  function Companion() {
    const c = state.companion;
    const [className, setClassName] = import_react2.default.useState(c.profile.className || ""), [startDate, setStartDate] = import_react2.default.useState(c.profile.startDate || ""), [traits, setTraits] = import_react2.default.useState(c.traits.map((t) => t.text).join("\n"));
    return h(
      "details",
      null,
      h("summary", null, "\u4E00\u8D77\u8D70\u8FC7\u7684\u65E5\u5B50"),
      h("p", null, c.message),
      h("label", null, "\u73ED\u7EA7\u540D\u5B57 ", h("input", { value: className, maxLength: 80, onChange: (e) => setClassName(e.target.value) })),
      h("label", null, "\u786E\u8BA4\u7684\u966A\u4F34\u5F00\u59CB\u65E5\u671F ", h("input", { type: "date", value: startDate, onChange: (e) => setStartDate(e.target.value) })),
      h("button", { type: "button", disabled: busy, onClick: () => act(async () => update(await api("/companion/profile", { className: className.trim() || null, startDate: startDate || null, confirmed: true }))) }, "\u4FDD\u5B58\u966A\u4F34\u8D44\u6599"),
      h("label", null, "\u6211\u786E\u8BA4\u7684\u73ED\u7EA7\u5C0F\u7279\u8D28\uFF08\u6BCF\u884C\u4E00\u6761\uFF09", h("textarea", { "aria-label": "\u6211\u786E\u8BA4\u7684\u73ED\u7EA7\u5C0F\u7279\u8D28\uFF08\u6BCF\u884C\u4E00\u6761\uFF09", value: traits, rows: 3, maxLength: 1e4, onChange: (e) => setTraits(e.target.value), placeholder: "\u4F8B\u5982\uFF1A\u5927\u5BB6\u559C\u6B22\u4E92\u76F8\u5206\u4EAB\u8BFB\u8FC7\u7684\u4E66" })),
      h("button", { type: "button", disabled: busy, onClick: () => act(async () => update(await api("/companion/traits", { traits: traits.split("\n").map((t) => t.trim()).filter(Boolean), confirmed: true }))) }, "\u4FDD\u5B58\u786E\u8BA4\u7684\u7279\u8D28"),
      h("p", { className: "mochi-planner-muted" }, "\u6708\u521D\u56DE\u987E\u53EA\u4F7F\u7528\u5DF2\u4FDD\u5B58\u7684\u8BFE\u5802\u4E8B\u4EF6\u548C\u4F60\u786E\u8BA4\u7684\u8D44\u6599\u3002\u5F00\u59CB\u65E5\u671F\u672A\u786E\u8BA4\u65F6\uFF0C\u4E0D\u731C\u6D4B\u966A\u4F34\u5929\u6570\u3002"),
      ...c.receipts.filter((r) => r.letter).slice(-6).reverse().map((r) => h("details", { key: r.key }, h("summary", null, r.letter.title), h("p", { style: { whiteSpace: "pre-wrap" } }, r.letter.body)))
    );
  }
  function Panel() {
    subscribe();
    const ref = import_react2.default.useRef(null), file = import_react2.default.useRef(null), anchor = import_react2.default.useRef(null);
    import_react2.default.useEffect(() => {
      if (opened && !ref.current.open) {
        anchor.current = document.activeElement;
        ref.current.showModal();
      } else if (!opened && ref.current.open) {
        ref.current.close();
        anchor.current?.focus?.();
      }
    }, [opened]);
    const close = () => {
      opened = false;
      notify();
    };
    const rows = draft?.lessons ?? [];
    const field = (index, key, value) => {
      draft = { ...draft, lessons: rows.map((row, i) => i === index ? { ...row, [key]: value, uncertain: false } : row) };
      notify();
    };
    return h(
      "dialog",
      { ref, className: "mochi-planner", "aria-labelledby": "mochi-planner-title", onCancel: (e) => {
        e.preventDefault();
        close();
      } },
      h("header", null, h("h2", { id: "mochi-planner-title" }, "Mochi \u7684\u8BFE\u5802\u65E5\u5386"), h("button", { type: "button", onClick: close, "aria-label": "\u5173\u95ED\u8BFE\u5802\u65E5\u5386" }, "\u5173\u95ED")),
      h("p", null, "\u5BFC\u5165\u672C\u73ED\u8BFE\u8868\uFF0CMochi \u5C31\u4F1A\u5728\u8BFE\u524D\u9012\u6765\u5C0F\u63D0\u9192\u3002\u9ED8\u8BA4\u63D0\u524D 5 \u5206\u949F\uFF0C\u4F7F\u7528\u5317\u4EAC\u65F6\u95F4\u3002"),
      h(
        "div",
        { className: "mochi-planner-actions" },
        h("button", { type: "button", disabled: busy, onClick: () => file.current.click() }, busy ? "\u6B63\u5728\u6574\u7406\u2026" : "\u5BFC\u5165 Excel / CSV"),
        state?.plan && h("button", { type: "button", disabled: busy, onClick: () => edit(state.plan) }, "\u8C03\u6574\u8BFE\u8868"),
        state?.plan && h("button", { type: "button", disabled: busy, onClick: () => act(async () => update(await api("/pause", { paused: !state.paused, revision: state.revision }))) }, state.paused ? "\u6062\u590D\u63D0\u9192" : "\u6682\u505C\u63D0\u9192")
      ),
      h("input", { ref: file, type: "file", accept: ".xlsx,.csv", hidden: true, onChange: (e) => {
        const selected = e.target.files?.[0];
        e.target.value = "";
        if (selected) void act(async () => result(await api("/import", selected, { "x-mochi-filename": encodeURIComponent(selected.name), "x-mochi-revision": String(state?.revision ?? 0) })));
      } }),
      h("p", { className: "mochi-planner-muted" }, "\u7167\u7247\u6216\u622A\u56FE\uFF1A\u4F7F\u7528\u804A\u5929\u8F93\u5165\u6846\u65C1\u7684\u201C\u7167\u7247\u8BFE\u8868\u201D\uFF0C\u53D1\u9001\u540E\u7531\u5F53\u524D\u6A21\u578B\u8BC6\u522B\u5E76\u5BFC\u5165\uFF1B\u770B\u4E0D\u6E05\u7684\u5730\u65B9\u4F1A\u8BF7\u4F60\u6838\u5BF9\u3002"),
      error && h("p", { role: "alert", style: { whiteSpace: "pre-wrap" } }, error),
      draft ? h(
        "section",
        null,
        h("label", null, "\u73ED\u7EA7 ", h("input", { value: draft.className || "", maxLength: 60, onChange: (e) => {
          draft = { ...draft, className: e.target.value };
          notify();
        } })),
        h("label", null, "\u63D0\u524D\u63D0\u9192\uFF08\u5206\u949F\uFF09 ", h("input", { type: "number", min: 0, max: 30, value: draft.leadMinutes ?? 5, onChange: (e) => {
          draft = { ...draft, leadMinutes: Number(e.target.value) };
          notify();
        } })),
        h("div", { className: "mochi-planner-table" }, h("table", null, h("thead", null, h("tr", null, ...["\u661F\u671F", "\u79D1\u76EE", "\u5F00\u59CB", "\u7ED3\u675F", ""].map((label, i) => h("th", { key: i }, label)))), h("tbody", null, ...rows.map((row, i) => h(
          "tr",
          { key: i },
          h("td", null, h("select", { "aria-label": `\u7B2C${i + 1}\u8282\u661F\u671F`, value: row.weekday || "", onChange: (e) => field(i, "weekday", Number(e.target.value)) }, h("option", { value: "" }, "\u6838\u5BF9"), ...[1, 2, 3, 4, 5, 6, 7].map((day) => h("option", { key: day, value: day }, `\u5468${"\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u65E5"[day - 1]}`)))),
          ...["subject", "start", "end"].map((key) => h("td", { key }, h("input", { "aria-label": `\u7B2C${i + 1}\u8282${key}`, type: key === "subject" ? "text" : "time", value: row[key] || "", onChange: (e) => field(i, key, e.target.value) }))),
          h("td", null, h("button", { type: "button", onClick: () => {
            draft = { ...draft, lessons: rows.filter((_, j) => j !== i) };
            notify();
          }, "aria-label": `\u79FB\u9664\u7B2C${i + 1}\u8282` }, "\u79FB\u9664"))
        ))))),
        h(
          "div",
          { className: "mochi-planner-actions" },
          h("button", { type: "button", onClick: () => {
            draft = { ...draft, lessons: [...rows, { weekday: 1, subject: "", start: "", end: "" }] };
            notify();
          } }, "\u6DFB\u52A0\u4E00\u8282"),
          h("button", { type: "button", disabled: busy, onClick: () => act(async () => result(await api("/save", { plan: draft, revision: draftRevision }))) }, "\u4FDD\u5B58\u5E76\u5F00\u59CB\u63D0\u9192"),
          h("button", { type: "button", onClick: () => {
            draft = null;
            error = "";
            notify();
          } }, "\u653E\u5F03\u4FEE\u6539")
        )
      ) : state?.plan ? h(
        "section",
        null,
        h("p", null, `${state.plan.className || "\u672C\u73ED"} \xB7 ${state.plan.lessons.length} \u8282\u8BFE \xB7 ${state.paused ? "\u63D0\u9192\u5DF2\u6682\u505C" : "\u63D0\u9192\u5DF2\u5F00\u542F"}`),
        h("ul", null, ...state.plan.lessons.map((row) => h("li", { key: row.id }, `\u5468${"\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u65E5"[row.weekday - 1]} ${row.start}\u2013${row.end} ${row.subject}`))),
        !state.paused && h("p", null, "\u4E0B\u4E00\u6B21\u63D0\u9192\uFF1A", state.rows.filter((row) => row.next_run_at).sort((a, b) => a.next_run_at.localeCompare(b.next_run_at))[0]?.next_run_at ? new Date(state.rows.filter((row) => row.next_run_at).sort((a, b) => a.next_run_at.localeCompare(b.next_run_at))[0].next_run_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "\u6682\u65E0")
      ) : h("p", null, "\u8FD8\u6CA1\u6709\u8BFE\u8868\u3002\u53EF\u5BFC\u5165\u5E26\u201C\u661F\u671F\u3001\u79D1\u76EE\u3001\u5F00\u59CB\u65F6\u95F4\u3001\u7ED3\u675F\u65F6\u95F4\u201D\u7684\u8868\u683C\u3002"),
      h("p", { className: "mochi-planner-muted" }, "Mochi \u5728\u540E\u53F0\u8FD0\u884C\u65F6\u4F1A\u63D0\u9192\uFF1B\u5173\u95ED\u8F6F\u4EF6\u6216\u5173\u673A\u671F\u95F4\u4E0D\u4F1A\u6267\u884C\u3002\u5047\u671F\u53EF\u6682\u505C\uFF0C\u8FD4\u6821\u540E\u518D\u6062\u590D\u3002"),
      state?.companion && h(Companion),
      state?.papers?.length > 0 && h("details", null, h("summary", null, "\u6700\u8FD1\u7684\u5C0F\u63D0\u9192"), ...state.papers.slice(0, 10).map((p) => h("p", { key: p.id, style: { whiteSpace: "pre-wrap" } }, p.body)))
    );
  }
  function Photo({ sessionId, inputActions, useInput }) {
    const input = useInput((s) => s), file = import_react2.default.useRef(null), [message, setMessage] = import_react2.default.useState("");
    return h(
      "span",
      null,
      h(import_dsh_client_ui_primitives2.Button, { type: "button", variant: "ghost", size: "md", disabled: input.phase !== "plain", title: "\u5C06\u8BFE\u8868\u622A\u56FE\u6216\u7167\u7247\u653E\u5165\u5F53\u524D\u8349\u7A3F", "aria-label": "\u7167\u7247\u8BFE\u8868", onClick: () => file.current.click() }, "\u7167\u7247\u8BFE\u8868"),
      h("input", { ref: file, type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, onChange: (e) => {
        const selected = e.target.files?.[0];
        e.target.value = "";
        if (!selected) return;
        if (selected.size > 8 * 1024 * 1024) {
          setMessage("\u56FE\u7247\u8BF7\u63A7\u5236\u5728 8 MB \u4EE5\u5185\u3002");
          return;
        }
        const span = inputActions.captureInsertion(), drafts = ctx.conversation.createDrafts(sessionId, [selected]);
        if (!inputActions.addAttachments(drafts.map((row) => row.id))) {
          ctx.conversation.releaseDraftAttachments(drafts);
          setMessage("\u5F53\u524D\u8349\u7A3F\u6B63\u5728\u63D0\u4EA4\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
          return;
        }
        const inserted = inputActions.insertText("\n\u8BF7\u8BFB\u53D6\u8FD9\u5F20\u672C\u73ED\u8BFE\u8868\uFF0C\u5148\u67E5 mochi_timetable_status\uFF0C\u518D\u8C03\u7528 mochi_timetable_import \u5BFC\u5165\u5E76\u5F00\u542F\u8BFE\u524D\u63D0\u9192\u3002\u53EA\u4F7F\u7528\u660E\u786E\u53EF\u8BFB\u7684\u661F\u671F\u548C\u8D77\u6B62\u65F6\u95F4\uFF0C\u770B\u4E0D\u6E05\u8BF7\u8BE2\u95EE\uFF0C\u4E0D\u8981\u731C\u6D4B\u4F5C\u606F\u3002\n", span);
        setMessage(inserted ? "\u5DF2\u653E\u5165\u8349\u7A3F\uFF0C\u53D1\u9001\u540E\u5F00\u59CB\u8BC6\u522B\u3002" : "\u56FE\u7247\u5DF2\u653E\u5165\u8349\u7A3F\uFF0C\u8BF7\u8865\u5145\u201C\u5BFC\u5165\u8BFE\u8868\u201D\u540E\u53D1\u9001\u3002");
      } }),
      message && h("span", { role: "status", className: "mochi-planner-photo-note" }, message)
    );
  }
  const style = document.createElement("style");
  style.textContent = ".mochi-planner{width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 40px);box-sizing:border-box;overflow:auto;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:16px;background:var(--dsw-alias-bg-base,#fffefa);color:var(--dsw-alias-label-primary,#403b32);padding:22px}.mochi-planner::backdrop{background:#0005}.mochi-planner header,.mochi-planner-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.mochi-planner h2{font-size:19px;margin:0}.mochi-planner p{font-size:13px;line-height:1.6}.mochi-planner button,.mochi-planner input,.mochi-planner select,.mochi-planner textarea{font:inherit;color:inherit;background:var(--dsw-alias-bg-base,#fffefa);border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:8px;padding:7px 9px}.mochi-planner textarea{display:block;width:100%;box-sizing:border-box;margin-top:8px}.mochi-planner summary{cursor:pointer;margin-top:14px}.mochi-planner button:disabled{opacity:.5}.mochi-planner button:active{transform:translateY(1px)}.mochi-planner :focus-visible{outline:2px solid currentColor;outline-offset:2px}.mochi-planner label{display:block;margin:12px 0}.mochi-planner-table{overflow:auto}.mochi-planner table{width:100%;font-size:13px;border-collapse:collapse}.mochi-planner td,.mochi-planner th{padding:5px;text-align:left}.mochi-planner td input{width:100%;min-width:88px;box-sizing:border-box}.mochi-planner-muted,.mochi-planner-photo-note{color:var(--dsw-alias-label-secondary,#746c60)}.mochi-planner-photo-note{font-size:11px;margin-inline:6px}@media(prefers-reduced-motion:reduce){.mochi-planner button:active{transform:none}}";
  document.head.append(style);
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "mochi-planner-entry", order: 27 }, Entry));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "mochi-planner-panel", order: 27 }, Panel));
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({ name: "conversation.input.left", id: "mochi-timetable-photo", order: 32 }, Photo));
  const remove = window.mochiClassroomDesktop?.onOpenReminder?.(() => {
    opened = true;
    notify();
  });
  void refresh();
  ctx.on("dispose", () => {
    disposed = true;
    clearTimeout(timer);
    remove?.();
    style.remove();
    listeners.clear();
  });
}

return module.exports;}});
