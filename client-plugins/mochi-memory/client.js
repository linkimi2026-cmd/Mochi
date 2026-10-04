window.__ModuleLoader__.load({id:"mochi-memory-client",factory:(require)=>{var module={exports:{}};var exports=module.exports;
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
var import_react3 = __toESM(require("react"), 1);

// journal-ui.mjs
var import_react = __toESM(require("react"), 1);

// journal-view.mjs
var UI_JOURNAL_LIMITS = { title: 120, diary: 12e3, history: 24e3 };
function shanghaiDay(at = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function journalMethod(entry) {
  const generated = entry?.generator === "model" ? "\u7531\u6A21\u578B\u4F9D\u636E\u6D3B\u52A8\u6574\u7406" : entry?.generator === "local" ? "\u672C\u673A\u6D3B\u52A8\u6458\u5F55" : "\u6574\u7406\u65B9\u5F0F\u672A\u6CE8\u660E";
  return entry?.edited ? `${generated} \xB7 \u5DF2\u7531\u4F60\u4FEE\u6539` : generated;
}
function schedulingText(snapshot) {
  if (snapshot?.settings?.autoEnabled === false) return "\u81EA\u52A8\u6574\u7406\u5DF2\u5173\u95ED\u3002";
  if (snapshot?.settings?.autoEnabled !== true) return "\u81EA\u52A8\u6574\u7406\u8BBE\u7F6E\u5C1A\u672A\u8BFB\u53D6\u3002";
  const schedule = snapshot.scheduling;
  if (!schedule || !schedule.started || schedule.closed) return "\u81EA\u52A8\u6574\u7406\u72B6\u6001\u5C1A\u672A\u786E\u8BA4\uFF0C\u8BBE\u7F6E\u7684\u65F6\u95F4\u4E0D\u4EE3\u8868\u4EFB\u52A1\u5DF2\u5B89\u6392\u3002";
  const next = schedule.task?.state === "scheduled" ? schedule.task.next_run_at : null;
  const date = next ? new Date(next) : null;
  const parts = [];
  if (date && Number.isFinite(date.getTime())) parts.push("\u4E0B\u6B21\u6574\u7406\uFF1A" + new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date));
  else parts.push("\u4EFB\u52A1\u5C1A\u672A\u62A5\u544A\u4E0B\u6B21\u6574\u7406\u65F6\u95F4");
  if (schedule.pendingDates?.length) parts.push(`${schedule.pendingDates.length} \u4E2A\u6D3B\u52A8\u65E5\u5F85\u8865\u8BB0`);
  if (schedule.failures?.length) parts.push(`${schedule.failures.length} \u9879\u6574\u7406\u5931\u8D25\uFF0C\u53EF\u67E5\u770B\u540E\u91CD\u8BD5`);
  return parts.join(" \xB7 ") + "\u3002";
}
function diarySavePayload(entry, draft) {
  return { id: entry.id, expectedRevision: entry.revision, title: draft.title, body: draft.body };
}
function historyPreviewPayload(preview, title) {
  if (preview.empty || !preview.sourceEntryIds?.length) throw Error("\u8FD9\u6BB5\u65F6\u95F4\u6CA1\u6709\u5DF2\u6709\u65E5\u8BB0\uFF0C\u4E0D\u80FD\u628A\u7A7A\u9884\u89C8\u4FDD\u5B58\u6210\u603B\u7ED3\u3002");
  return { expectedRevision: preview.historyRevision, title, body: preview.body, sourceEntryIds: [...preview.sourceEntryIds] };
}

// journal-ui.mjs
var h = import_react.default.createElement;
var button = (label2, onClick, disabled = false, extra = {}) => h("button", { type: "button", onClick, disabled, ...extra }, label2);
var label = (text, input) => h("label", null, h("span", null, text), input);
function JournalPages({ api, open, page, onPage }) {
  const [state, setState] = import_react.default.useState(null), [error, setError] = import_react.default.useState(""), [notice, setNotice] = import_react.default.useState(""), [busy, setBusy] = import_react.default.useState(false);
  const lock = import_react.default.useRef(false), [letter, setLetter] = import_react.default.useState(null), [draft, setDraft] = import_react.default.useState(null), [historyDraft, setHistoryDraft] = import_react.default.useState(null);
  const [config, setConfig] = import_react.default.useState(null), [versions, setVersions] = import_react.default.useState(null), [preview, setPreview] = import_react.default.useState(null), [count, setCount] = import_react.default.useState(60);
  const [day, setDay] = import_react.default.useState(shanghaiDay), [from, setFrom] = import_react.default.useState(shanghaiDay), [to, setTo] = import_react.default.useState(shanghaiDay);
  const run = async (work) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const request = (path, data) => api("/journal" + path, data);
  import_react.default.useEffect(() => {
    if (!open) return;
    let alive = true;
    request("/state").then((value) => {
      if (alive) setState(value);
    }).catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [open]);
  const reload = () => run(async () => {
    setState(await request("/state"));
    setNotice("\u5DF2\u5237\u65B0\u5DF2\u4FDD\u5B58\u8BB0\u5F55\uFF1B\u6B63\u5728\u7F16\u8F91\u7684\u6587\u5B57\u4ECD\u4FDD\u7559\u3002");
  });
  const readLetter = (id) => run(async () => {
    const value = await request("/entry?id=" + encodeURIComponent(id));
    setLetter(value);
    setDraft(null);
    setVersions(null);
    onPage("diary");
  });
  const saveLetter = () => run(async () => {
    const next = await request("/edit", diarySavePayload(letter, draft)), metadata = next.entries.find((row) => row.id === letter.id);
    setState(next);
    setLetter({ ...letter, ...metadata, body: draft.body });
    setDraft(null);
    setNotice("\u8FD9\u5C01\u65E5\u8BB0\u5DF2\u4FDD\u5B58\u3002");
  });
  const saveHistory = () => run(async () => {
    setState(await request("/history", historyDraft));
    setHistoryDraft(null);
    setNotice("\u8FD9\u672C\u5386\u53F2\u5DF2\u4FDD\u5B58\u3002");
  });
  const makePreview = () => run(async () => {
    const value = await request("/summarize", { from, to });
    setPreview({ ...value, historyRevision: state.history.revision });
    setNotice(value.empty ? "\u8FD9\u6BB5\u65F6\u95F4\u8FD8\u6CA1\u6709\u5DF2\u6709\u65E5\u8BB0\uFF0C\u6CA1\u6709\u7F16\u5199\u603B\u7ED3\u3002" : "\u8FD9\u53EA\u662F\u6309\u65E5\u671F\u5408\u5E76\u7684\u539F\u65E5\u8BB0\u6458\u5F55\u3002\u8BF7\u68C0\u67E5\u6216\u4FEE\u6539\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u4FDD\u5B58\u3002");
  });
  const savePreview = () => run(async () => {
    setState(await request("/history", historyPreviewPayload(preview, state.history.title)));
    setPreview(null);
    setHistoryDraft(null);
    setNotice("\u5DF2\u628A\u68C0\u67E5\u8FC7\u7684\u9884\u89C8\u4FDD\u5B58\u4E3A\u5386\u53F2\uFF1B\u65E7\u7248\u672C\u4ECD\u4FDD\u7559\u3002");
  });
  const generate = () => run(async () => {
    const next = await request("/generate", { date: day });
    setState(next);
    setNotice(next.generated ? "\u8FD9\u4E00\u5929\u7684\u65E5\u8BB0\u5DF2\u6574\u7406\uFF1B\u4EBA\u5DE5\u4FEE\u6539\u7684\u65E5\u8BB0\u4F1A\u4FDD\u7559\u3002" : "\u8FD9\u4E00\u5929\u6CA1\u6709\u5DF2\u4FDD\u5B58\u6D3B\u52A8\uFF0C\u6CA1\u6709\u7F16\u5199\u65E5\u8BB0\u3002");
  });
  const configure = () => run(async () => {
    setState(await request("/configure", config));
    setConfig(null);
    setNotice("\u65E5\u8BB0\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF1B\u5B9E\u9645\u8C03\u5EA6\u72B6\u6001\u89C1\u4E0B\u65B9\u3002");
  });
  const oldVersions = (id) => run(async () => {
    setVersions(await request("/versions?id=" + encodeURIComponent(id)));
  });
  const editor = (value, setValue, kind, save) => h(
    "div",
    { className: "mochi-journal-editor" },
    label(kind === "diary" ? "\u8FD9\u5C01\u4FE1\u7684\u540D\u5B57" : "\u8FD9\u672C\u5386\u53F2\u7684\u540D\u5B57", h("input", { "aria-label": kind === "diary" ? "\u65E5\u8BB0\u6807\u9898" : "\u5386\u53F2\u540D\u79F0", maxLength: 120, value: value.title, onChange: (e) => setValue({ ...value, title: e.target.value }) })),
    label("\u6B63\u6587", h("textarea", { "aria-label": kind === "diary" ? "\u65E5\u8BB0\u957F\u6B63\u6587" : "\u5386\u53F2\u957F\u6B63\u6587", rows: 16, maxLength: kind === "diary" ? 12e3 : 24e3, value: value.body, onChange: (e) => setValue({ ...value, body: e.target.value }) })),
    h("small", null, `${value.body.length} / ${kind === "diary" ? 12e3 : 24e3} \u5B57 \xB7 \u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u53EA\u5728\u672C\u9875`),
    h("div", { className: "mochi-journal-actions" }, button(kind === "diary" ? "\u4FDD\u5B58\u8FD9\u5C01\u65E5\u8BB0" : "\u4FDD\u5B58\u8FD9\u672C\u5386\u53F2", save, busy || !value.title.trim() || kind === "diary" && !value.body.trim()), button("\u653E\u5F03\u8FD9\u6B21\u4FEE\u6539", () => setValue(null), busy))
  );
  const savedSources = letter?.sources ?? [];
  return h(
    import_react.default.Fragment,
    null,
    error && h("p", { role: "alert", className: "mochi-journal-error" }, error, " \u4F60\u7684\u672A\u4FDD\u5B58\u6587\u5B57\u4ECD\u4FDD\u7559\uFF1B\u8BF7\u6838\u5BF9\u5F53\u524D\u4FDD\u5B58\u7248\u672C\u3002"),
    notice && h("p", { role: "status", className: "mochi-memory-muted" }, notice),
    busy && h("p", { role: "status" }, "\u6B63\u5728\u5904\u7406\u8FD9\u5C01\u4FE1\u2026"),
    h(
      "section",
      { id: "mochi-memory-diary", hidden: page !== "diary", role: "tabpanel", "aria-labelledby": "mochi-memory-tab-diary", className: "mochi-journal-page", "data-mochi-envelope": "true" },
      h("header", null, h("div", null, h("h3", null, state?.settings.diaryName ?? "Mochi\u65E5\u8BB0"), h("p", { className: "mochi-memory-muted" }, "\u6709\u771F\u5B9E\u4EA4\u6D41\u6216\u6D3B\u52A8\u7684\u4E00\u5929\uFF0C\u624D\u5199\u4E00\u5C01\u65E5\u8BB0\u3002")), button("\u5237\u65B0\u8BB0\u5F55", reload, busy)),
      state && h(
        "details",
        { className: "mochi-journal-settings" },
        h("summary", null, "\u65E5\u8BB0\u672C\u540D\u79F0\u4E0E\u6BCF\u65E5\u6574\u7406"),
        h("p", null, `\u6BCF\u65E5 ${state.settings.dailyTime}\uFF08\u4E0A\u6D77\u65F6\u95F4\uFF09 \xB7 ${state.settings.autoEnabled ? "\u81EA\u52A8\u6574\u7406\u5DF2\u5F00\u542F" : "\u81EA\u52A8\u6574\u7406\u5DF2\u5173\u95ED"}`),
        h("p", { role: "status" }, schedulingText(state)),
        h("p", { className: "mochi-memory-muted" }, "\u9700 Mochi \u5728\u8FD0\u884C\u4E2D\u3002\u53EA\u4F9D\u636E\u5DF2\u4FDD\u5B58\u6D3B\u52A8\uFF1B\u65E0\u6D3B\u52A8\u4E0D\u7F16\u5199\u3002\u6A21\u578B\u4E0D\u53EF\u7528\u65F6\u4FDD\u7559\u672C\u673A\u6D3B\u52A8\u6458\u5F55\u3002"),
        state.scheduling?.failures?.length > 0 && h("ul", null, ...state.scheduling.failures.map((row) => h("li", { key: row.date }, `${row.date}\uFF1A${row.error}`))),
        !config ? button("\u4FEE\u6539\u65E5\u8BB0\u8BBE\u7F6E", () => setConfig({ expectedRevision: state.settings.revision, diaryName: state.settings.diaryName, dailyTime: state.settings.dailyTime, autoEnabled: state.settings.autoEnabled }), busy) : h(
          "div",
          { className: "mochi-journal-editor" },
          label("\u65E5\u8BB0\u672C\u540D\u79F0", h("input", { "aria-label": "\u65E5\u8BB0\u672C\u540D\u79F0", value: config.diaryName, maxLength: 120, onChange: (e) => setConfig({ ...config, diaryName: e.target.value }) })),
          label("\u6BCF\u65E5\u6574\u7406\u65F6\u95F4", h("input", { type: "time", "aria-label": "\u6BCF\u65E5\u6574\u7406\u65F6\u95F4", value: config.dailyTime, onChange: (e) => setConfig({ ...config, dailyTime: e.target.value }) })),
          label("\u81EA\u52A8\u6574\u7406", h("input", { type: "checkbox", checked: config.autoEnabled, onChange: (e) => setConfig({ ...config, autoEnabled: e.target.checked }) })),
          button("\u4FDD\u5B58\u65E5\u8BB0\u8BBE\u7F6E", configure, busy || !config.diaryName.trim()),
          button("\u53D6\u6D88\u4FEE\u6539\u8BBE\u7F6E", () => setConfig(null), busy)
        )
      ),
      !letter && h(
        import_react.default.Fragment,
        null,
        h("div", { className: "mochi-journal-actions" }, label("\u6574\u7406\u54EA\u4E00\u5929", h("input", { type: "date", "aria-label": "\u6574\u7406\u65E5\u8BB0\u65E5\u671F", value: day, max: shanghaiDay(), onChange: (e) => setDay(e.target.value) })), button("\u6574\u7406\u8FD9\u4E00\u5929", generate, busy || !state || !day)),
        state && !state.entries.length && h("div", { className: "mochi-journal-empty", "data-mochi-envelope": "true" }, h("h3", null, "\u8FD8\u6CA1\u6709\u5199\u597D\u7684\u4FE1"), h("p", null, "\u6B63\u5E38\u4F7F\u7528 Mochi \u540E\uFF0C\u5B83\u4F1A\u4F9D\u636E\u771F\u5B9E\u8BB0\u5F55\u6574\u7406\u65E5\u8BB0\u3002\u8FD9\u91CC\u4E0D\u4F1A\u8865\u5199\u6CA1\u6709\u53D1\u751F\u7684\u4E00\u5929\u3002")),
        h("div", { className: "mochi-journal-grid" }, ...(state?.entries ?? []).slice(0, count).map((entry) => h(
          "button",
          { type: "button", key: entry.id, className: "mochi-journal-envelope", "data-mochi-envelope": "true", "aria-label": `\u6253\u5F00 ${entry.date} \u7684\u65E5\u8BB0\uFF1A${entry.title}`, disabled: busy, onClick: () => readLetter(entry.id) },
          h("time", { dateTime: entry.date }, entry.date),
          h("span", { className: "mochi-journal-stamp", "aria-hidden": true }, "M"),
          h("strong", null, entry.title),
          h("span", { className: "mochi-journal-excerpt" }, entry.excerpt),
          h("small", null, journalMethod(entry))
        ))),
        state?.entries.length > count && button("\u518D\u770B 60 \u5C01", () => setCount(count + 60), busy)
      ),
      letter && h(
        "article",
        { className: "mochi-journal-letter", "data-mochi-envelope": "true" },
        button(draft ? "\u8FD4\u56DE\u4FE1\u5C01\uFF08\u653E\u5F03\u672A\u4FDD\u5B58\u4FEE\u6539\uFF09" : "\u8FD4\u56DE\u65E5\u671F\u4FE1\u5C01", () => {
          setLetter(null);
          setDraft(null);
          setVersions(null);
        }, busy),
        h("header", null, h("div", null, h("time", { dateTime: letter.date }, letter.date), h("h3", null, letter.title)), h("small", null, journalMethod(letter))),
        draft ? editor(draft, setDraft, "diary", saveLetter) : h(import_react.default.Fragment, null, h("div", { className: "mochi-journal-body" }, letter.body), button("\u7F16\u8F91\u8FD9\u5C01\u4FE1", () => setDraft({ title: letter.title, body: letter.body }), busy)),
        h("details", null, h("summary", null, `\u8FD9\u5C01\u4FE1\u7684\u4F9D\u636E \xB7 ${savedSources.length} \u6761`), ...savedSources.map((row) => h("blockquote", { key: row.id }, h("p", null, row.summary), h("small", null, new Date(row.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }))))),
        button("\u67E5\u770B\u8FD9\u5C01\u4FE1\u7684\u65E7\u7248\u672C", () => oldVersions(letter.id), busy),
        versions && h("div", { className: "mochi-journal-versions" }, !versions.length ? h("p", null, "\u8FD8\u6CA1\u6709\u65E7\u7248\u672C\u3002") : versions.map((row) => h("details", { key: row.revision }, h("summary", null, `${row.title} \xB7 \u7248\u672C ${row.revision}`), h("p", { className: "mochi-journal-body" }, row.body))))
      )
    ),
    h(
      "section",
      { id: "mochi-memory-history", hidden: page !== "history", role: "tabpanel", "aria-labelledby": "mochi-memory-tab-history", className: "mochi-journal-page", "data-mochi-envelope": "true" },
      h("header", null, h("div", null, h("h3", null, state?.history.title ?? "Mochi\u7684\u5386\u53F2"), h("p", { className: "mochi-memory-muted" }, "\u4ECE\u5DF2\u6709\u65E5\u8BB0\u4E32\u8D77\u4E00\u6BB5\u771F\u5B9E\u7684\u76F8\u5904\u3002")), button("\u5237\u65B0\u5386\u53F2", reload, busy)),
      state && h(
        "article",
        { className: "mochi-journal-letter", "data-mochi-envelope": "true" },
        historyDraft ? editor(historyDraft, setHistoryDraft, "history", saveHistory) : h(
          import_react.default.Fragment,
          null,
          h("p", { className: "mochi-memory-muted" }, `${state.history.edited ? "\u5DF2\u7531\u4F60\u4FEE\u6539\uFF0C\u81EA\u52A8\u6574\u7406\u4F1A\u4FDD\u7559\u8FD9\u4EFD\u5386\u53F2\u3002" : state.history.generator === "model" ? "\u7531\u6A21\u578B\u4F9D\u636E\u65E5\u8BB0\u6574\u7406\u3002" : "\u6309\u5DF2\u6709\u65E5\u8BB0\u5408\u5E76\u7684\u672C\u673A\u6458\u5F55\u3002"}`),
          h("div", { className: "mochi-journal-body" }, state.history.body || "\u8FD9\u672C\u5386\u53F2\u8FD8\u662F\u7A7A\u767D\u3002\u53EF\u4EE5\u5148\u6309\u65E5\u671F\u9884\u89C8\u5DF2\u6709\u65E5\u8BB0\uFF0C\u518D\u4EB2\u81EA\u4FDD\u5B58\u3002"),
          button("\u7F16\u8F91\u5386\u53F2\u540D\u79F0\u4E0E\u957F\u6B63\u6587", () => setHistoryDraft({ expectedRevision: state.history.revision, title: state.history.title, body: state.history.body }), busy)
        )
      ),
      h(
        "section",
        { className: "mochi-journal-range", "data-mochi-envelope": "true" },
        h("h3", null, "\u6574\u7406\u4E00\u6BB5\u5386\u53F2"),
        h("p", { className: "mochi-memory-muted" }, "\u53EA\u9884\u89C8\u73B0\u6709\u65E5\u8BB0\u7684\u65E5\u671F\u6458\u5F55\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u66FF\u6362\u5386\u53F2\u6B63\u6587\u3002"),
        h("div", { className: "mochi-journal-actions" }, label("\u5F00\u59CB\u65E5\u671F", h("input", { type: "date", "aria-label": "\u5386\u53F2\u5F00\u59CB\u65E5\u671F", value: from, max: shanghaiDay(), onChange: (e) => setFrom(e.target.value) })), label("\u7ED3\u675F\u65E5\u671F", h("input", { type: "date", "aria-label": "\u5386\u53F2\u7ED3\u675F\u65E5\u671F", value: to, max: shanghaiDay(), onChange: (e) => setTo(e.target.value) })), button("\u9884\u89C8\u8FD9\u6BB5\u5386\u53F2", makePreview, busy || !state || !from || !to || from > to)),
        preview && h(
          "div",
          { className: "mochi-journal-preview", "data-mochi-envelope": "true" },
          h("h4", null, `${preview.from} \u81F3 ${preview.to}`),
          preview.empty ? h("p", null, "\u8FD9\u6BB5\u65F6\u95F4\u8FD8\u6CA1\u6709\u5DF2\u6709\u65E5\u8BB0\uFF0C\u6CA1\u6709\u7F16\u5199\u603B\u7ED3\u3002") : h(
            import_react.default.Fragment,
            null,
            h("p", null, "\u8FD9\u662F\u6309\u65E5\u671F\u5408\u5E76\u7684\u672C\u673A\u6458\u5F55\uFF0C\u4E0D\u7B49\u540C\u6A21\u578B\u6982\u62EC\u3002\u68C0\u67E5\u6216\u4FEE\u6539\u540E\u518D\u4FDD\u5B58\u3002"),
            label("\u5386\u53F2\u9884\u89C8\uFF0C\u53EF\u4FEE\u6539", h("textarea", { "aria-label": "\u5386\u53F2\u603B\u7ED3\u9884\u89C8", rows: 16, maxLength: UI_JOURNAL_LIMITS.history, value: preview.body, onChange: (e) => setPreview({ ...preview, body: e.target.value }) })),
            h("details", null, h("summary", null, `\u6765\u6E90\u65E5\u8BB0 \xB7 ${preview.sources.length} \u5C01`), ...preview.sources.map((row) => h("p", { key: row.id }, button(`${row.date} \xB7 ${row.title}`, () => readLetter(row.id), busy), row.truncated && h("small", null, " \u9884\u89C8\u5DF2\u622A\u53D6\uFF0C\u5B8C\u6574\u6B63\u6587\u4FDD\u7559\u5728\u539F\u65E5\u8BB0\u4E2D\u3002")))),
            h("p", { className: "mochi-memory-muted" }, historyDraft ? "\u5148\u4FDD\u5B58\u6216\u653E\u5F03\u6B63\u5728\u7F16\u8F91\u7684\u5386\u53F2\uFF0C\u518D\u4F7F\u7528\u8FD9\u4EFD\u9884\u89C8\u3002" : "\u4FDD\u5B58\u4F1A\u66FF\u6362\u5F53\u524D\u5386\u53F2\u6B63\u6587\uFF0C\u65E7\u4FDD\u5B58\u7248\u672C\u4ECD\u4FDD\u7559\u3002"),
            button("\u7528\u9884\u89C8\u66FF\u6362\u8FD9\u672C\u5386\u53F2", savePreview, busy || !preview.body.trim() || !!historyDraft)
          ),
          button("\u6536\u8D77\u9884\u89C8", () => setPreview(null), busy)
        )
      ),
      state?.history.sourceEntryIds?.length > 0 && h("details", null, h("summary", null, "\u8FD9\u672C\u5386\u53F2\u6765\u81EA\u54EA\u4E9B\u65E5\u8BB0"), ...state.history.sourceEntryIds.map((id) => {
        const row = state.entries.find((entry) => entry.id === id);
        return row ? h("p", { key: id }, button(`${row.date} \xB7 ${row.title}`, () => readLetter(id), busy)) : null;
      }))
    )
  );
}
var journalStyles = `
.mochi-journal-page{margin-top:16px}.mochi-journal-page h3{font-family:var(--dsw-font-serif,serif);font-size:19px;margin:8px 0}.mochi-journal-page label{display:flex;flex-direction:column;gap:5px;font-size:12px}.mochi-journal-actions{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:14px 0}.mochi-journal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px;margin:20px 0}.mochi-memory-panel .mochi-journal-envelope{position:relative;overflow:hidden;text-align:left;min-height:180px;border-radius:10px;padding:18px;background:var(--dsw-alias-bg-layer-1,#fffdf8);box-shadow:0 3px 10px #403b3209;display:flex;flex-direction:column;gap:12px}.mochi-journal-envelope::after{content:"";position:absolute;bottom:0;left:0;right:0;height:32px;background:linear-gradient(14deg,transparent 48%,var(--dsw-alias-border-l2,#d8d3c7) 50%,transparent 52%),linear-gradient(-14deg,transparent 48%,var(--dsw-alias-border-l2,#d8d3c7) 50%,transparent 52%);pointer-events:none}.mochi-journal-envelope time{font-size:12px;color:var(--dsw-alias-label-secondary,#746c60);padding-bottom:8px;border-bottom:1px dashed var(--dsw-alias-border-l2,#d8d3c7);padding-right:38px}.mochi-journal-stamp{position:absolute;right:14px;top:12px;border:1px solid currentColor;border-radius:50%;width:26px;height:26px;text-align:center;line-height:26px;font-family:var(--dsw-font-serif,serif);opacity:.55}.mochi-journal-excerpt{font-size:12px;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.7}.mochi-journal-envelope small{margin-top:auto;padding-bottom:18px;font-size:10px}.mochi-journal-letter,.mochi-journal-empty,.mochi-journal-range,.mochi-journal-settings{position:relative;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fffdf8);padding:20px;margin:16px 0}.mochi-journal-letter::before,.mochi-journal-range::before{content:"";position:absolute;top:0;right:0;width:24px;height:24px;background:linear-gradient(225deg,var(--dsw-alias-bg-layer-2,#fffefa) 47%,var(--dsw-alias-border-l2,#d8d3c7) 50%,transparent 53%);pointer-events:none}.mochi-journal-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.95;font-size:14px;margin:22px 0}.mochi-journal-editor input,.mochi-journal-editor textarea,.mochi-journal-preview textarea{box-sizing:border-box;width:100%}.mochi-journal-editor textarea,.mochi-journal-preview textarea{font-size:14px;line-height:1.85;min-height:240px;resize:vertical}.mochi-journal-error{padding:12px;border-left:3px solid var(--dsw-alias-label-secondary,#746c60)}.mochi-journal-versions{margin-top:12px}.mochi-journal-page blockquote{margin:12px 0;padding-left:12px;border-left:1px dashed var(--dsw-alias-border-l2,#d8d3c7)}.mochi-memory-nav{margin-top:16px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8d3c7);display:flex;gap:8px;flex-wrap:wrap;padding-bottom:10px}.mochi-memory-nav [aria-selected=true]{background:var(--dsw-alias-bg-layer-3,#ece8df);font-weight:600}@media(max-width:560px){.mochi-journal-grid{grid-template-columns:1fr}.mochi-journal-letter,.mochi-journal-range,.mochi-journal-settings{padding:14px}}
`;

// ../mochi-onboarding/sidebar-action.mjs
var import_react2 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var sidebarIcons = { memory: import_dsh_client_ui_primitives.IconArchiveOutlineRegular, planner: import_dsh_client_ui_primitives.IconClockOutlineRegular, guide: import_dsh_client_ui_primitives.IconQuestionOutlineRegular };
function SidebarAction({ wide = true, label: label2, description, icon: Icon, onClick }) {
  const button2 = import_react2.default.createElement(import_dsh_client_ui_primitives.Button, {
    type: "button",
    variant: "ghost",
    size: "md",
    onClick,
    "aria-label": description,
    title: description,
    "data-mochi-sidebar-action": label2,
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
    icon: import_react2.default.createElement(Icon, { size: 18, "aria-hidden": true })
  }, wide ? import_react2.default.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label2) : null);
  return import_react2.default.createElement(import_dsh_client_ui_primitives.Tooltip, { label: description, side: "right", portal: true, disabled: wide }, button2);
}

// client-entry.mjs
var h2 = import_react3.default.createElement;
var kinds = { preference: "\u4E2A\u4EBA\u504F\u597D", task_fact: "\u4EFB\u52A1\u4E8B\u5B9E", org_knowledge: "\u7EC4\u7EC7\u77E5\u8BC6", convention: "\u73ED\u7EA7\u7EA6\u5B9A" };
var sources = { user_statement: "\u4F60\u66FE\u7ECF\u8BF4\u8FC7", repeated: "\u591A\u6B21\u63D0\u5230", explicit_request: "\u4F60\u660E\u786E\u8981\u6C42\u8BB0\u4F4F", observed: "\u65E5\u5E38\u5BF9\u8BDD\u5F62\u6210\u7684\u6682\u5B9A\u4E60\u60EF" };
var inject = ["slots"];
function apply(ctx) {
  let open = false, state = null, error = "", busy = false, edit = null, forget = null;
  const listeners = /* @__PURE__ */ new Set(), notify = () => listeners.forEach((fn) => fn());
  const api = async (path, data) => {
    const response = await fetch("/api/mochi-memory" + path, { credentials: "same-origin", ...data === void 0 ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) } });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || "\u8BB0\u5FC6\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u3002"), { code: value.code, status: response.status });
    if (data !== void 0 && ["/save", "/pin", "/forget", "/learning", "/dismiss-observation"].includes(path)) window.dispatchEvent(new CustomEvent("mochi-memory-updated"));
    return value;
  };
  const act = async (work) => {
    if (busy) return;
    busy = true;
    error = "";
    notify();
    try {
      state = await work();
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      notify();
    }
  };
  const show = (event) => {
    event?.preventDefault?.();
    open = true;
    notify();
    void act(() => api("/state"));
  };
  const useChange = () => {
    const [, force] = import_react3.default.useReducer((n) => n + 1, 0);
    import_react3.default.useEffect(() => {
      listeners.add(force);
      return () => listeners.delete(force);
    }, []);
  };
  function Entry({ wide }) {
    return h2(SidebarAction, { wide, label: "\u8BB0\u5FC6", description: "\u67E5\u770B\u8BB0\u5FC6", icon: sidebarIcons.memory, onClick: show });
  }
  function Panel() {
    useChange();
    const ref = import_react3.default.useRef(null), anchor = import_react3.default.useRef(null), [query, setQuery] = import_react3.default.useState(""), [page, setPage] = import_react3.default.useState("diary");
    import_react3.default.useEffect(() => {
      if (open && !ref.current.open) {
        anchor.current = document.activeElement;
        ref.current.showModal();
      } else if (!open && ref.current.open) {
        ref.current.close();
        anchor.current?.focus?.();
      }
    }, [open]);
    const close = () => {
      open = false;
      forget = null;
      notify();
    };
    const rows = (state?.rows ?? []).filter((row) => !query || `${row.content} ${row.summary}`.includes(query));
    return h2(
      "dialog",
      { ref, className: "mochi-memory-panel", "aria-labelledby": "mochi-memory-title", onCancel: (e) => {
        e.preventDefault();
        close();
      } },
      h2("header", null, h2("h2", { id: "mochi-memory-title" }, "Mochi \u8BB0\u4F4F\u4E86\u4EC0\u4E48"), h2("button", { type: "button", onClick: close }, "\u5173\u95ED")),
      h2("nav", { className: "mochi-memory-nav", role: "tablist", "aria-label": "\u65E5\u8BB0\u3001\u5386\u53F2\u4E0E\u504F\u597D" }, ...Object.entries({ diary: "\u65E5\u8BB0", history: "\u5386\u53F2", memory: "\u504F\u597D\u4E0E\u89C2\u5BDF" }).map(([id, title]) => h2("button", { type: "button", role: "tab", id: "mochi-memory-tab-" + id, "aria-controls": "mochi-memory-" + id, "aria-selected": page === id, tabIndex: page === id ? 0 : -1, key: id, onClick: () => setPage(id), onKeyDown: (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = ["diary", "history", "memory"], index = tabs.indexOf(page), next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowLeft" ? 2 : 1)) % 3;
        setPage(tabs[next]);
        document.getElementById("mochi-memory-tab-" + tabs[next])?.focus();
      } }, title))),
      h2(JournalPages, { api, open, page, onPage: setPage }),
      h2(
        "section",
        { id: "mochi-memory-memory", hidden: page !== "memory", role: "tabpanel", "aria-labelledby": "mochi-memory-tab-memory", "data-mochi-envelope": "true" },
        h2("p", null, "\u8FD9\u91CC\u6CBF\u7528\u539F\u6765\u7684\u672C\u673A\u8BB0\u5FC6\u3002\u4F60\u53EF\u4EE5\u67E5\u770B\u6765\u6E90\u3001\u66F4\u6B63\u5185\u5BB9\uFF0C\u6216\u8005\u8BA9 Mochi \u5FD8\u8BB0\u3002\u79F0\u547C\u8BF7\u5728\u201C\u6211\u7684\u8D44\u6599\u201D\u4E2D\u8BBE\u7F6E\u3002"),
        state?.learning && h2(
          "section",
          null,
          h2("label", null, h2("input", { type: "checkbox", checked: state.learning.enabled, disabled: busy, onChange: (e) => act(() => api("/learning", { enabled: e.target.checked })) }), " \u4ECE\u65E5\u5E38\u5BF9\u8BDD\u4E2D\u4E3B\u52A8\u4E86\u89E3\u6211"),
          h2("p", { className: "mochi-memory-muted" }, "\u4E34\u65F6\u9009\u62E9\u5148\u89C2\u5BDF\uFF0C\u8DE8\u5BF9\u8BDD\u53CD\u590D\u51FA\u73B0\u624D\u5F62\u6210\u6682\u5B9A\u4E60\u60EF\u3002\u5173\u95ED\u540E\u505C\u6B62\u65B0\u5B66\u4E60\uFF0C\u5DF2\u6709\u8BB0\u5FC6\u4ECD\u53EF\u68C0\u67E5\u6216\u5FD8\u8BB0\u3002"),
          state.learning.habits.length > 0 && h2("details", null, h2("summary", null, "Mochi \u6B63\u5728\u4E86\u89E3\u4EC0\u4E48"), ...state.learning.habits.map((habit) => h2(
            "section",
            { key: habit.key, className: "mochi-memory-edit" },
            h2("p", null, habit.evidence[0]?.summary || habit.value),
            h2("small", null, `${{ observing: "\u8FD8\u5728\u89C2\u5BDF", learned: "\u5DF2\u5F62\u6210\u6682\u5B9A\u4E60\u60EF", "needs-review": "\u53D1\u73B0\u4E0D\u540C\u9009\u62E9\uFF0C\u6682\u4E0D\u66FF\u6362" }[habit.state] || habit.state} \xB7 `),
            h2("small", null, `${habit.evidence.length} \u6761\u8FD1\u671F\u4F9D\u636E`),
            h2("ul", null, ...habit.evidence.map((row) => h2("li", { key: row.session_id + row.message_id }, h2("p", null, row.quote), h2("small", null, new Date(row.created_at).toLocaleDateString("zh-CN"))))),
            h2("button", { type: "button", disabled: busy, onClick: () => act(() => api("/dismiss-observation", { key: habit.key })) }, "\u4E0D\u8981\u8FD9\u6837\u8BB0")
          )))
        ),
        h2("div", { className: "mochi-memory-tools" }, h2("input", { "aria-label": "\u641C\u7D22\u8BB0\u5FC6", placeholder: "\u627E\u4E00\u6761\u8BB0\u5FC6", value: query, onChange: (e) => setQuery(e.target.value) }), h2("button", { type: "button", disabled: busy, onClick: () => {
          edit = { kind: "preference", content: "" };
          forget = null;
          notify();
        } }, "\u8BB0\u4F4F\u4E00\u4EF6\u4E8B")),
        error && h2("p", { role: "alert" }, error),
        edit && h2(
          "section",
          { className: "mochi-memory-edit" },
          h2("h3", null, edit.id ? "\u66F4\u6B63\u8FD9\u6761\u8BB0\u5FC6" : "\u544A\u8BC9 Mochi \u4E00\u4EF6\u503C\u5F97\u8BB0\u4F4F\u7684\u4E8B"),
          !edit.id && h2("select", { "aria-label": "\u8BB0\u5FC6\u7C7B\u578B", value: edit.kind, onChange: (e) => {
            edit = { ...edit, kind: e.target.value };
            notify();
          } }, ...Object.entries(kinds).map(([key, label2]) => h2("option", { key, value: key }, label2))),
          h2("textarea", { "aria-label": "\u8BB0\u5FC6\u5185\u5BB9", value: edit.content, rows: 4, maxLength: 2e3, onChange: (e) => {
            edit = { ...edit, content: e.target.value };
            notify();
          } }),
          h2("button", { type: "button", disabled: busy || !edit.content.trim(), onClick: () => act(async () => {
            const result = await api("/save", edit);
            edit = null;
            return result;
          }) }, "\u4FDD\u5B58\u8BB0\u5FC6"),
          h2("button", { type: "button", disabled: busy, onClick: () => {
            edit = null;
            error = "";
            notify();
          } }, "\u653E\u5F03\u4FEE\u6539")
        ),
        forget && h2(
          "section",
          { className: "mochi-memory-edit", role: "alert" },
          h2("p", null, "\u786E\u5B9A\u8BA9 Mochi \u5FD8\u8BB0\u8FD9\u6761\u5417\uFF1F"),
          h2("blockquote", null, forget.content),
          h2("p", null, "\u8FD9\u6761\u5185\u5BB9\u4F1A\u9000\u51FA\u68C0\u7D22\uFF1B\u539F\u6709\u672C\u673A\u5BA1\u8BA1\u8BB0\u5F55\u4ECD\u4FDD\u7559\u5FEB\u7167\u3002"),
          h2("button", { type: "button", "data-mochi-variant": "danger", disabled: busy, onClick: () => act(async () => {
            const result = await api("/forget", { id: forget.id, expected: forget.content, confirmed: true });
            forget = null;
            return result;
          }) }, "\u786E\u8BA4\u5FD8\u8BB0"),
          h2("button", { type: "button", onClick: () => {
            forget = null;
            notify();
          } }, "\u4FDD\u7559")
        ),
        state && h2("p", { className: "mochi-memory-muted" }, `${state.stats.active} \u6761\u6B63\u5728\u4F7F\u7528 \xB7 ${state.stats.pinned} \u6761\u5DF2\u56FA\u5B9A`),
        !rows.length && !busy && h2("p", null, query ? "\u6CA1\u6709\u627E\u5230\u76F8\u7B26\u7684\u8BB0\u5FC6\u3002" : "Mochi \u4F1A\u4ECE\u65E5\u5E38\u5BF9\u8BDD\u91CC\u6162\u6162\u4E86\u89E3\u4F60\u3002\u4F60\u4E5F\u53EF\u4EE5\u76F4\u63A5\u544A\u8BC9\u5B83\u957F\u671F\u504F\u597D\uFF0C\u6216\u70B9\u201C\u8BB0\u4F4F\u4E00\u4EF6\u4E8B\u201D\u3002"),
        h2("ul", null, ...rows.slice(0, 200).map((row) => h2(
          "li",
          { key: row.id },
          h2("p", null, row.content),
          h2("small", null, `${kinds[row.kind] || row.kind} \xB7 ${sources[row.source] || "\u6765\u6E90\u672A\u6CE8\u660E"} \xB7 ${new Date(row.created_at).toLocaleDateString("zh-CN")} \xB7 ${row.expired_at ? "\u5DF2\u5F52\u6863" : row.pinned ? "\u5DF2\u56FA\u5B9A" : "\u53EF\u968F\u65F6\u95F4\u6DE1\u5316"}`),
          h2(
            "div",
            { className: "mochi-memory-row-actions" },
            h2("button", { type: "button", disabled: busy, onClick: () => {
              edit = { id: row.id, kind: row.kind, content: row.content, expected: row.content };
              forget = null;
              notify();
            } }, "\u66F4\u6B63"),
            h2("button", { type: "button", disabled: busy, "aria-pressed": !!row.pinned, onClick: () => act(() => api("/pin", { id: row.id, expected: row.content, pinned: !row.pinned })) }, row.pinned ? "\u53D6\u6D88\u56FA\u5B9A" : "\u56FA\u5B9A"),
            h2("button", { type: "button", disabled: busy, onClick: () => {
              forget = row;
              edit = null;
              notify();
            } }, "\u5FD8\u8BB0")
          )
        ))),
        rows.length > 200 && h2("p", null, "\u663E\u793A\u524D 200 \u6761\uFF0C\u8BF7\u7528\u641C\u7D22\u7F29\u5C0F\u8303\u56F4\u3002")
      )
    );
  }
  const style = document.createElement("style");
  style.textContent = ".mochi-memory-panel{width:min(660px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:16px;padding:22px;background:var(--dsw-alias-bg-base,#fffefa);color:var(--dsw-alias-label-primary,#403b32)}.mochi-memory-panel::backdrop{background:#0005}.mochi-memory-panel header,.mochi-memory-tools,.mochi-memory-row-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mochi-memory-panel header{justify-content:space-between}.mochi-memory-panel h2{font-size:19px;margin:0}.mochi-memory-panel h3{font-size:15px}.mochi-memory-panel p{font-size:13px;line-height:1.6;white-space:pre-wrap}.mochi-memory-panel button,.mochi-memory-panel input,.mochi-memory-panel select,.mochi-memory-panel textarea{color:inherit;font:inherit;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:8px;background:var(--dsw-alias-bg-base,#fffefa);padding:7px 10px}.mochi-memory-panel button:disabled{opacity:.5}.mochi-memory-panel :focus-visible{outline:2px solid currentColor;outline-offset:2px}.mochi-memory-panel textarea{display:block;box-sizing:border-box;width:100%;margin:10px 0}.mochi-memory-panel ul{list-style:none;padding:0}.mochi-memory-panel li{border-top:1px solid var(--dsw-alias-border-l2,#d8d3c7);padding:12px 0}.mochi-memory-panel small,.mochi-memory-muted{color:var(--dsw-alias-label-secondary,#746c60)}.mochi-memory-row-actions{margin-top:8px}.mochi-memory-edit{margin-top:14px;padding:14px;border:1px dashed var(--dsw-alias-border-l2,#d8d3c7);border-radius:10px}.mochi-memory-edit button{margin-right:8px}";
  document.head.append(style);
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "mochi-memory-entry", order: 28 }, Entry));
  style.textContent += journalStyles;
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "mochi-memory-panel", order: 28 }, Panel));
  window.addEventListener("mochi-open-memory", show);
  ctx.on("dispose", () => {
    window.removeEventListener("mochi-open-memory", show);
    style.remove();
    listeners.clear();
  });
}

return module.exports;}});
