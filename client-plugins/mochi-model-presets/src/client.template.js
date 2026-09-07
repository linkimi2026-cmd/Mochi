var React = require("react");

const PRESET_CATALOG = Object.freeze(/* __MOCHI_MODEL_PRESET_CATALOG__ */);
const SETTINGS_NAMESPACE = "llm-pi-ai";
const STYLE_ID = "mochi-model-presets-style";
const PRESET_BY_ROUTE = new Map(PRESET_CATALOG.presets.map((preset) => [preset.route, preset]));

function own(object, key) {
  return object !== null && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key);
}

function objectAt(object, key) {
  return own(object, key) && object[key] !== null && typeof object[key] === "object" && !Array.isArray(object[key])
    ? object[key]
    : undefined;
}

function providersOf(value) {
  return objectAt(value, "providers");
}

function profileExists(namespace, route) {
  const providers = providersOf(namespace?.value);
  return providers !== undefined && own(providers, route);
}

function profileFor(namespace, route) {
  const providers = providersOf(namespace?.value);
  return providers === undefined ? undefined : objectAt(providers, route);
}

function credentialRefFor(namespace, preset) {
  const profile = profileFor(namespace, preset.route);
  return typeof profile?.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0
    ? profile.apiKeyEnv
    : preset.credentialRef;
}

function namespaceFrom(describeValue) {
  const namespaces = Array.isArray(describeValue?.namespaces) ? describeValue.namespaces : [];
  return namespaces.find((candidate) => candidate?.ns === SETTINGS_NAMESPACE);
}

function emptySnapshot(kind = "loading") {
  return Object.freeze({
    kind,
    writable: false,
    entries: PRESET_CATALOG.presets.map((preset) => Object.freeze({
      route: preset.route,
      configured: false,
      keyState: "unknown",
    })),
  });
}

function genericFailure(result) {
  const code = result?.error?.code;
  if (code === "settings/conflict") return "设置刚发生变化，请刷新后重试。";
  if (code === "settings/rejected") return "原生设置拒绝了这次修改，请在原生卡片中检查配置。";
  return "暂时无法读取或修改原生设置。";
}

/**
 * Read only redacted settings plus configured booleans. Credential values never
 * enter this contribution, even transiently.
 */
async function readPresetSnapshot(remote) {
  try {
    const answer = await remote?.settings?.describe?.();
    if (answer?.ok !== true) return Object.freeze({ ...emptySnapshot("unavailable"), failure: genericFailure(answer) });
    const namespace = namespaceFrom(answer.value);
    if (namespace === undefined) {
      return Object.freeze({ ...emptySnapshot("unavailable"), failure: "当前运行环境没有可编辑的 pi-ai 模型设置。" });
    }
    const refs = [...new Set(PRESET_CATALOG.presets.map((preset) => credentialRefFor(namespace, preset)))];
    let credentials = Object.create(null);
    let credentialReadable = false;
    try {
      const described = await remote?.credentials?.describe?.(refs);
      if (described?.ok === true && described.value !== null && typeof described.value === "object") {
        credentials = described.value;
        credentialReadable = true;
      }
    } catch (_) {
      // Settings remain useful even if the credential-state enrichment is down.
    }
    return Object.freeze({
      kind: "ready",
      writable: answer.value?.writable === true,
      revision: namespace.revision,
      entries: PRESET_CATALOG.presets.map((preset) => {
        const configured = profileExists(namespace, preset.route);
        const credential = credentials[credentialRefFor(namespace, preset)];
        return Object.freeze({
          route: preset.route,
          configured,
          keyState: credentialReadable ? (credential?.configured === true ? "stored" : "missing") : "unknown",
        });
      }),
    });
  } catch (_) {
    return Object.freeze({ ...emptySnapshot("unavailable"), failure: "暂时无法读取原生设置。" });
  }
}

/**
 * Add a catalog route without credentials, endpoint overrides, model ids, or a
 * model selection. The fresh read and revision fence prevent overwriting a
 * profile that appeared after this card rendered.
 */
async function addPreset(remote, route) {
  const preset = PRESET_BY_ROUTE.get(route);
  if (preset === undefined) return Object.freeze({ kind: "refused", message: "未识别的预填项。" });
  try {
    const described = await remote?.settings?.describe?.();
    if (described?.ok !== true) return Object.freeze({ kind: "refused", message: genericFailure(described) });
    const namespace = namespaceFrom(described.value);
    if (namespace === undefined) return Object.freeze({ kind: "refused", message: "当前运行环境没有可编辑的 pi-ai 模型设置。" });
    if (described.value?.writable !== true) return Object.freeze({ kind: "refused", message: "当前模型设置是只读的。" });
    if (profileExists(namespace, route)) return Object.freeze({ kind: "already" });
    const written = await remote.settings.mutate(
      SETTINGS_NAMESPACE,
      [{ op: "set", path: ["providers", route], value: {} }],
      namespace.revision,
    );
    if (written?.ok !== true) return Object.freeze({ kind: "refused", message: genericFailure(written) });
    return Object.freeze({ kind: "added" });
  } catch (_) {
    return Object.freeze({ kind: "refused", message: "暂时无法加入原生设置。" });
  }
}

function statusText(entry, snapshot) {
  if (snapshot.kind !== "ready") return "状态暂不可读";
  if (!entry.configured) return "未加入原生设置";
  if (entry.keyState === "stored") return "密钥已保存；尚未实测连接";
  if (entry.keyState === "missing") return "已加入；待在原生卡片填写 API Key";
  return "已加入；密钥状态暂不可读";
}

function entryFor(snapshot, route) {
  return snapshot.entries.find((entry) => entry.route === route)
    ?? Object.freeze({ route, configured: false, keyState: "unknown" });
}

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .mochi-model-presets{margin:20px 0 8px;padding:18px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:18px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.72));color:var(--dsw-alias-label-primary,inherit)}
    .mochi-model-presets__title{margin:0;font:600 16px/1.35 system-ui,-apple-system,"PingFang SC",sans-serif;letter-spacing:-.01em}
    .mochi-model-presets__intro{margin:6px 0 0;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.64));font:400 13px/1.55 system-ui,-apple-system,"PingFang SC",sans-serif}
    .mochi-model-presets__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:14px}
    .mochi-model-preset{display:flex;flex-direction:column;gap:9px;min-width:0;padding:13px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:14px;background:var(--dsw-alias-bg-base,transparent)}
    .mochi-model-preset__name{font:600 14px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif}
    .mochi-model-preset__summary,.mochi-model-preset__status{font:400 12px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.64))}
    .mochi-model-preset__details,.mochi-model-presets__notice details,.mochi-model-provider-hint details{font:400 12px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.64))}
    .mochi-model-preset__details summary,.mochi-model-presets__notice summary,.mochi-model-provider-hint summary{width:max-content;cursor:pointer;color:var(--dsw-alias-label-primary,inherit);font-weight:500}
    .mochi-model-preset__details-body,.mochi-model-presets__notice-details,.mochi-model-provider-hint__details{display:grid;gap:4px;margin-top:7px;overflow-wrap:anywhere}
    .mochi-model-preset__details code,.mochi-model-presets__notice code,.mochi-model-provider-hint code{font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:inherit}
    .mochi-model-preset__status[data-state="ready"]{color:var(--dsw-alias-link,#1976d2)}
    .mochi-model-preset__actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto}
    .mochi-model-preset__button{min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,inherit);font:500 12px/1 system-ui,-apple-system,"PingFang SC",sans-serif;cursor:pointer}
    .mochi-model-preset__button:active{transform:scale(.98)}.mochi-model-preset__button:disabled{cursor:default;opacity:.58}
    .mochi-model-preset__link{color:var(--dsw-alias-link,#1976d2);font:400 12px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif}
    .mochi-model-presets__notice{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));font:400 12px/1.55 system-ui,-apple-system,"PingFang SC",sans-serif;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.64))}
    .mochi-model-presets__notice p{margin:4px 0}.mochi-model-presets__feedback{margin:10px 0 0;font:400 12px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.64))}
    .mochi-model-provider-hint{margin:10px 0 0;padding:9px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.08));font:400 12px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.64))}
    .mochi-model-provider-hint strong{color:var(--dsw-alias-label-primary,inherit);font-weight:600}.mochi-model-provider-hint details{margin-top:7px}
    @media (max-width:600px){.mochi-model-presets{padding:16px}.mochi-model-presets__grid{grid-template-columns:1fr}.mochi-model-preset__button{min-height:40px}}
    @media (prefers-reduced-motion:reduce){.mochi-model-preset__button:active{transform:none}}
    @media (prefers-reduced-transparency:reduce){.mochi-model-presets{background:var(--dsw-alias-bg-layer-1,#fff)}}
    @media (prefers-contrast:more){.mochi-model-presets,.mochi-model-preset{border-color:var(--dsw-alias-label-primary,currentColor)}}
  `;
  document.head.appendChild(style);
}

function usePresetSnapshot(ctx) {
  const [snapshot, setSnapshot] = React.useState(() => emptySnapshot());
  const [refreshToken, setRefreshToken] = React.useState(0);
  React.useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void readPresetSnapshot(ctx.remote).then((next) => {
        if (!disposed) setSnapshot(next);
      });
    };
    refresh();
    const disposers = [];
    try {
      if (typeof ctx.remote?.$on === "function") {
        disposers.push(ctx.remote.$on("settings/document-updated", refresh));
        disposers.push(ctx.remote.$on("credentials/reference-updated", refresh));
      }
    } catch (_) {
      // Event observation is an enhancement; initial/manual reads remain valid.
    }
    return () => {
      disposed = true;
      for (const dispose of disposers) {
        try { dispose?.(); } catch (_) {}
      }
    };
  }, [ctx, refreshToken]);
  return [snapshot, () => setRefreshToken((current) => current + 1)];
}

function PresetFooter({ ctx }) {
  const [snapshot, refresh] = usePresetSnapshot(ctx);
  const [busyRoute, setBusyRoute] = React.useState(undefined);
  const [feedback, setFeedback] = React.useState(undefined);
  const add = async (route) => {
    setBusyRoute(route);
    setFeedback(undefined);
    const outcome = await addPreset(ctx.remote, route);
    if (outcome.kind === "added") setFeedback("已加入原生设置；请在出现的官方卡片中填写 API Key。当前对话模型没有改变。");
    else if (outcome.kind === "already") setFeedback("该服务商已在原生设置中，未改写现有配置。");
    else setFeedback(outcome.message);
    setBusyRoute(undefined);
    refresh();
  };
  return React.createElement("section", { className: "mochi-model-presets", "aria-label": "常用模型服务商" }, [
    React.createElement("h2", { className: "mochi-model-presets__title", key: "title" }, "常用模型服务商"),
    React.createElement("p", { className: "mochi-model-presets__intro", key: "intro" }, "加入后，请在出现的官方卡片填写 API Key；当前对话模型保持不变。"),
    React.createElement("div", { className: "mochi-model-presets__grid", key: "grid" }, PRESET_CATALOG.presets.map((preset) => {
      const entry = entryFor(snapshot, preset.route);
      const configured = entry.configured;
      const disabled = busyRoute !== undefined || snapshot.kind !== "ready" || !snapshot.writable || configured;
      return React.createElement("article", { className: "mochi-model-preset", key: preset.route }, [
        React.createElement("strong", { className: "mochi-model-preset__name", key: "name" }, preset.label),
        React.createElement("span", { className: "mochi-model-preset__summary", key: "summary" }, preset.summary),
        React.createElement("span", { className: "mochi-model-preset__status", "data-state": configured ? "ready" : "idle", key: "status" }, statusText(entry, snapshot)),
        React.createElement("details", { className: "mochi-model-preset__details", key: "details" }, [
          React.createElement("summary", { key: "summary" }, "连接详情"),
          React.createElement("div", { className: "mochi-model-preset__details-body", key: "body" }, [
            React.createElement("span", { key: "catalog" }, `本机模型目录：${preset.modelCount} 项（pi-ai ${PRESET_CATALOG.piAiVersion}）`),
            React.createElement("span", { key: "protocol" }, `协议：${preset.protocolLabel}`),
            React.createElement("code", { key: "endpoint" }, preset.endpoint),
          ]),
        ]),
        React.createElement("div", { className: "mochi-model-preset__actions", key: "actions" }, [
          React.createElement("button", {
            type: "button",
            className: "mochi-model-preset__button",
            disabled,
            onClick: () => { void add(preset.route); },
            key: "add",
          }, busyRoute === preset.route ? "正在加入…" : configured ? "已加入" : "加入原生设置"),
          React.createElement("a", {
            className: "mochi-model-preset__link",
            href: preset.official.url,
            target: "_blank",
            rel: "noreferrer",
            key: "source",
          }, "官方说明"),
        ]),
      ]);
    })),
    feedback === undefined ? null : React.createElement("p", { className: "mochi-model-presets__feedback", role: "status", key: "feedback" }, feedback),
    PRESET_CATALOG.notices.map((notice) => React.createElement("aside", { className: "mochi-model-presets__notice", key: notice.title }, [
      React.createElement("strong", { key: "title" }, notice.title),
      React.createElement("p", { key: "body" }, notice.body),
      React.createElement("details", { key: "details" }, [
        React.createElement("summary", { key: "summary" }, "连接详情"),
        React.createElement("div", { className: "mochi-model-presets__notice-details", key: "body" }, [
          React.createElement("span", { key: "endpoint" }, ["普通 API：", React.createElement("code", { key: "code" }, notice.endpoint)]),
          React.createElement("a", { href: notice.official.url, target: "_blank", rel: "noreferrer", key: "source" }, notice.official.title),
        ]),
      ]),
    ])),
  ]);
}

function ProviderCardHint(props) {
  const preset = PRESET_BY_ROUTE.get(props?.provider?.provider);
  if (preset === undefined) return null;
  const state = props.keyConfigured === true
    ? "密钥已保存；尚未实测连接。"
    : props.configured === true
      ? "已加入；请使用这张官方卡片填写 API Key。"
      : "这是本机目录的预填候选；保存后才会成为可选路线。";
  return React.createElement("aside", { className: "mochi-model-provider-hint" }, [
    React.createElement("strong", { key: "name" }, preset.label),
    React.createElement("span", { key: "text" }, ` · ${state}`),
    React.createElement("details", { key: "details" }, [
      React.createElement("summary", { key: "summary" }, "连接详情"),
      React.createElement("div", { className: "mochi-model-provider-hint__details", key: "body" }, [
        React.createElement("span", { key: "protocol" }, `协议：${preset.protocolLabel}`),
        React.createElement("code", { key: "endpoint" }, preset.endpoint),
      ]),
    ]),
  ]);
}

const inject = ["slots", "remote", "remote.settings", "remote.credentials"];

function apply(ctx) {
  ensureStyles();
  ctx.slots.inject("settings.models.footer", () => ctx.slots.register({
    name: "settings.models.footer",
    id: "mochi-model-presets",
    order: 80,
    label: "Mochi 常用模型服务商",
  }, () => React.createElement(PresetFooter, { ctx })));
  ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
    name: "settings.models.provider-card",
    key: SETTINGS_NAMESPACE,
  }, ProviderCardHint));
}

module.exports.apply = apply;
module.exports.inject = inject;
module.exports.__test = {
  PRESET_CATALOG,
  SETTINGS_NAMESPACE,
  addPreset,
  credentialRefFor,
  emptySnapshot,
  profileExists,
  readPresetSnapshot,
  PresetFooter,
  ProviderCardHint,
  statusText,
};
