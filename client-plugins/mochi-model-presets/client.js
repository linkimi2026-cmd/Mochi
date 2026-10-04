window.__ModuleLoader__.load({
	id: "mochi-model-presets",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		const PRESET_CATALOG = Object.freeze({
		  "piAiVersion": "0.87.1",
		  "source": "@earendil-works/pi-ai installed runtime catalog",
		  "presets": [
		    {
		      "route": "zai",
		      "label": "Z.AI GLM Coding Plan（国际）",
		      "summary": "GLM Coding Plan 的国际 OpenAI Chat Completions 端点。",
		      "official": {
		        "title": "Z.AI GLM Coding Plan 快速开始",
		        "url": "https://docs.z.ai/devpack/quick-start"
		      },
		      "providerName": "Z.AI",
		      "protocol": "openai-completions",
		      "protocolLabel": "OpenAI Chat Completions",
		      "endpoint": "https://api.z.ai/api/coding/paas/v4",
		      "modelCount": 7,
		      "credentialRef": "ZAI_API_KEY"
		    },
		    {
		      "route": "zai-coding-cn",
		      "label": "智谱 GLM Coding Plan（中国区）",
		      "summary": "GLM Coding Plan 中国区的 OpenAI Chat Completions 端点。",
		      "official": {
		        "title": "智谱 GLM Coding Plan 快速开始",
		        "url": "https://docs.bigmodel.cn/cn/coding-plan/quick-start"
		      },
		      "providerName": "Z.AI Coding CN",
		      "protocol": "openai-completions",
		      "protocolLabel": "OpenAI Chat Completions",
		      "endpoint": "https://open.bigmodel.cn/api/coding/paas/v4",
		      "modelCount": 4,
		      "credentialRef": "ZAI_CODING_CN_API_KEY"
		    },
		    {
		      "route": "moonshotai-cn",
		      "label": "Kimi API（月之暗面）",
		      "summary": "Kimi 的 OpenAI Chat Completions 目录路线。",
		      "official": {
		        "title": "Kimi API 获取密钥与调用方式",
		        "url": "https://platform.kimi.com/docs/get-api-key"
		      },
		      "providerName": "Moonshot AI CN",
		      "protocol": "openai-completions",
		      "protocolLabel": "OpenAI Chat Completions",
		      "endpoint": "https://api.moonshot.cn/v1",
		      "modelCount": 4,
		      "credentialRef": "MOONSHOT_API_KEY"
		    },
		    {
		      "route": "minimax-cn",
		      "label": "MiniMax API",
		      "summary": "MiniMax 的 Anthropic Messages 目录路线。",
		      "official": {
		        "title": "MiniMax Anthropic API 文档",
		        "url": "https://platform.minimaxi.com/document/Anthropic_API"
		      },
		      "providerName": "MiniMax CN",
		      "protocol": "anthropic-messages",
		      "protocolLabel": "Anthropic Messages",
		      "endpoint": "https://api.minimaxi.com/anthropic",
		      "modelCount": 3,
		      "credentialRef": "MINIMAX_CN_API_KEY"
		    },
		    {
		      "route": "deepseek",
		      "label": "DeepSeek 官方 API",
		      "summary": "DeepSeek 的 OpenAI Chat Completions 目录路线。",
		      "official": {
		        "title": "DeepSeek API 文档",
		        "url": "https://api-docs.deepseek.com/"
		      },
		      "providerName": "DeepSeek",
		      "protocol": "openai-completions",
		      "protocolLabel": "OpenAI Chat Completions",
		      "endpoint": "https://api.deepseek.com",
		      "modelCount": 2,
		      "credentialRef": "DEEPSEEK_API_KEY"
		    }
		  ],
		  "notices": [
		    {
		      "title": "智谱普通 API 与 Coding Plan 分开",
		      "endpoint": "https://api.z.ai/api/paas/v4",
		      "official": {
		        "title": "Z.AI 普通 API 快速开始",
		        "url": "https://docs.z.ai/guides/overview/quick-start"
		      },
		      "body": "普通 API 的地址与上方 GLM Coding Plan 路线不同。当前本机 pi-ai 目录只提供 Coding Plan 的 zai 与 zai-coding-cn 路线；本卡不会把普通 API 密钥改填到 Coding Plan 端点。"
		    }
		  ]
		});
		const SETTINGS_NAMESPACE = "llm-pi-ai";
		const MIMO_SETTINGS_NAMESPACE = "mochi-llm-mimo";
		const DEFAULT_MODEL_NAMESPACE = "agent-default-model";
		const MIMO_DEFAULT_MODEL = Object.freeze({ provider: "mochi-mimo", model: "mimo-v2.5" });
		const MIMO_CREDENTIAL_REF = "MIMO_API_KEY";
		const MIMO_DOCTOR_PATH = "/api/mochi-doctor/check-model";
		const MIMO_DOCTOR_VERSION = "mochi-doctor-model-check/v1";
		const MIMO_DOCTOR_SCOPE = "mochi-mimo";
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
		    .mochi-reasoning{position:relative;font:12px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif;color:var(--dsw-alias-label-primary,inherit)}
		    .mochi-reasoning>summary{list-style:none;cursor:pointer;min-height:32px;display:flex;align-items:center;padding:0 7px;border-radius:8px;white-space:nowrap}.mochi-reasoning>summary::-webkit-details-marker{display:none}
		    .mochi-reasoning>summary:focus-visible{outline:2px solid var(--dsw-alias-link);outline-offset:2px}
		    .mochi-reasoning__menu{position:absolute;bottom:38px;left:0;z-index:90;width:230px;max-width:calc(100vw - 32px);padding:9px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--jxl-paper,var(--dsw-alias-bg-layer-1,#fff));box-shadow:0 8px 30px rgba(60,40,25,.14)}
		    .mochi-reasoning__menu button{display:block;width:100%;min-height:32px;text-align:left;padding:5px 9px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer}.mochi-reasoning__menu button[aria-pressed="true"]{font-weight:600;background:var(--dsw-alias-bg-layer-2)}.mochi-reasoning__menu p{margin:7px 5px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
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
		    .mochi-model-provider-hint__key-field{display:grid;gap:5px;margin:10px 0;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}
		    .mochi-model-provider-hint__key-field input{min-height:38px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,inherit);font:400 13px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif}
		    .mochi-model-provider-hint__actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
		    .mochi-model-provider-hint__button{min-height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,inherit);font:500 12px/1 system-ui,-apple-system,"PingFang SC",sans-serif;cursor:pointer}
		    .mochi-model-provider-hint__button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
		    .mochi-model-provider-hint__button:active:not(:disabled){transform:scale(.98)}.mochi-model-provider-hint__button:disabled{cursor:default;opacity:.58}
		    .mochi-model-provider-hint__button:focus-visible,.mochi-model-provider-hint__key-field input:focus-visible{outline:2px solid var(--dsw-alias-link,#1976d2);outline-offset:2px}
		    .mochi-model-provider-hint__notice{margin:8px 0 0}.mochi-model-provider-hint__status{display:block;margin-top:6px}
		    @media (max-width:600px){.mochi-model-presets{padding:16px}.mochi-model-presets__grid{grid-template-columns:1fr}.mochi-model-preset__button{min-height:40px}}
		    @media (prefers-reduced-motion:reduce){.mochi-model-preset__button:active,.mochi-model-provider-hint__button:active{transform:none}}
		    @media (prefers-reduced-transparency:reduce){.mochi-model-presets{background:var(--dsw-alias-bg-layer-1,#fff)}}
		    @media (prefers-contrast:more){.mochi-model-presets,.mochi-model-preset{border-color:var(--dsw-alias-label-primary,currentColor)}}
		  `;
		  document.head.appendChild(style);
		}

		const EFFORT_LABELS = { off: "关闭", minimal: "轻量", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" };
		async function reasoningRequest(sessionId, policy) {
		  const path = "/api/mochi-reasoning" + (policy ? "" : "?sessionId=" + encodeURIComponent(sessionId));
		  const response = await fetch(path, { method: policy ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
		    ...(policy ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, ...policy }) } : {}) });
		  const value = await response.json();
		  if (!response.ok) throw Error(value.error || "思考设置暂不可用");
		  return value;
		}
		// Present the official picker unchanged apart from its effort caption/menu.
		// Reasoning now has one dedicated seat; the native model directory remains untouched.
		const modelOnlyStores = new WeakMap();
		function modelOnlyDirectory(store) {
		  if (!modelOnlyStores.has(store)) {
		    let source, cached;
		    modelOnlyStores.set(store, {
		      subscribe: listener => store.subscribe(listener),
		      getSnapshot: () => {
		        const next = store.getSnapshot();
		        if (next !== source) {
		          source = next;
		          const { reasoningEffort, ...current } = next.current ?? {};
		          cached = { ...next, current: next.current === null ? null : current, retainedEffort: undefined,
		            groups: next.groups.map(group => ({ ...group, models: group.models.map(model => ({ ...model, reasoning: undefined })) })) };
		        }
		        return cached;
		      },
		    });
		  }
		  return modelOnlyStores.get(store);
		}
		function NativeModelControl({ nativeComponent, ...props }) {
		  return React.createElement(nativeComponent, { ...props, directory: modelOnlyDirectory(props.directory) });
		}
		function ReasoningControl({ ctx, sessionId }) {
		  const [state, setState] = React.useState(undefined), [error, setError] = React.useState(undefined), [busy, setBusy] = React.useState(false);
		  const details = React.useRef(null), generation = React.useRef(0), mutation = React.useRef(0), mutating = React.useRef(false);
		  React.useEffect(() => {
		    let disposed = false;
		    const refresh = () => { const id = ++generation.current; void reasoningRequest(sessionId).then(value => {
		      if (!disposed && id === generation.current) { setState(value); setError(undefined); }
		    }).catch(() => { if (!disposed && id === generation.current) setError("思考设置暂不可用，请重试"); }); };
		    setState(undefined); mutating.current = false; setBusy(false); setError(undefined); refresh();
		    const directory = ctx.modelDirectories.directoryFor(sessionId);
		    const unsubscribe = directory.store.subscribe(refresh);
		    const close = event => { if (details.current && !details.current.contains(event.target)) details.current.open = false; };
		    const key = event => { if (event.key === "Escape" && details.current?.open) { details.current.open = false; details.current.querySelector("summary")?.focus(); } };
		    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
		    return () => { disposed = true; ++generation.current; ++mutation.current; unsubscribe?.(); document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
		  }, [sessionId]);
		  const choose = async policy => {
		    if (mutating.current) return; mutating.current = true; setBusy(true); setError(undefined);
		    const operation = ++mutation.current, id = ++generation.current;
		    try { const value = await reasoningRequest(sessionId, policy); if (id === generation.current) setState(value); if (operation === mutation.current && details.current) details.current.open = false; }
		    catch (e) { if (id === generation.current) setError(e.message); }
		    finally { if (operation === mutation.current) { mutating.current = false; setBusy(false); } }
		  };
		  const auto = state?.mode === "auto", effort = state?.current?.effort;
		  return React.createElement("details", { ref: details, className: "mochi-reasoning", "aria-label": "思考等级" }, [
		    React.createElement("summary", { key: "summary" }, state ? "思考·" + (auto ? "自动" : EFFORT_LABELS[effort] ?? effort ?? "默认") : "思考·…"),
		    React.createElement("div", { className: "mochi-reasoning__menu", key: "menu" }, [
		      React.createElement("button", { type: "button", key: "auto", disabled: busy || !state, "aria-pressed": auto, onClick: () => { void choose({ mode: "auto" }); } }, "自动选择"),
		      ...(state?.efforts ?? []).map(level => React.createElement("button", { type: "button", key: level.id, disabled: busy,
		        "aria-pressed": !auto && effort === level.id, onClick: () => { void choose({ mode: "manual", effort: level.id }); } }, EFFORT_LABELS[level.id] ?? level.name ?? level.id)),
		      React.createElement("p", { key: "explanation" }, auto ? "按当前任务和模型支持范围在本机选择，手动档位会优先使用。" : "手动档位用于后续请求；点击自动选择可恢复。"),
		      auto && state?.last ? React.createElement("p", { key: "last" }, "上次使用：" + (EFFORT_LABELS[state.last.effort] ?? state.last.effort ?? "提供方默认") + "。" + state.last.reason) : null,
		      state?.lookupError ? React.createElement("p", { key: "unavailable", role: "alert" }, state.lookupError.message) : state && !state.efforts.length ? React.createElement("p", { key: "no-capability" }, "当前模型未声明可选档位，使用提供方默认。") : null,
		      error ? React.createElement("p", { key: "error", role: "alert" }, error) : null,
		    ]),
		  ]);
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

		function validateCredentialInput(raw) {
		  if (typeof raw !== "string") return "请输入 API Key。";
		  const value = raw.trim();
		  if (!value) return "请输入 API Key。";
		  if (!/^[\x21-\x7E]+$/.test(value) || /^["'].*["']$/.test(value) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
		    return "API Key 格式无效；请只粘贴密钥本身。";
		  }
		  return undefined;
		}

		function mimoServiceOrigin(describeValue) {
		  try {
		    const namespace = describeValue?.namespaces?.find?.((item) => item?.ns === MIMO_SETTINGS_NAMESPACE);
		    const baseURL = namespace?.value?.baseURL;
		    if (typeof baseURL !== "string" || !baseURL.trim()) return undefined;
		    const parsed = new URL(baseURL);
		    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return undefined;
		    return parsed.origin;
		  } catch (_) {
		    return undefined;
		  }
		}

		async function readMimoServiceOrigin(remote) {
		  try {
		    const described = await remote?.settings?.describe?.();
		    return described?.ok === true ? mimoServiceOrigin(described.value) : undefined;
		  } catch (_) {
		    return undefined;
		  }
		}

		async function readMimoCardState(remote) {
		  try {
		    const described = await remote?.settings?.describe?.();
		    if (described?.ok !== true) return undefined;
		    const namespace = described.value?.namespaces?.find?.((item) => item?.ns === MIMO_SETTINGS_NAMESPACE);
		    const ref = namespace?.value?.apiKeyEnv ?? MIMO_CREDENTIAL_REF;
		    if (typeof ref !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
		      return Object.freeze({ serviceOrigin: mimoServiceOrigin(described.value), configured: false });
		    }
		    const credentials = await remote?.credentials?.describe?.([ref]);
		    if (credentials?.ok !== true || credentials.value?.[ref] === undefined) return undefined;
		    const defaultNamespace = described.value?.namespaces?.find?.((item) => item?.ns === DEFAULT_MODEL_NAMESPACE);
		    const currentDefault = defaultNamespace?.value && typeof defaultNamespace.value === "object"
		      ? Object.freeze({ provider: defaultNamespace.value.provider, model: defaultNamespace.value.model })
		      : undefined;
		    return Object.freeze({
		      serviceOrigin: mimoServiceOrigin(described.value),
		      configured: credentials.value[ref].configured === true,
		      defaultSelection: currentDefault,
		      defaultWritable: described.value.writable === true && typeof defaultNamespace?.revision === "number",
		    });
		  } catch (_) {
		    return undefined;
		  }
		}

		function activeSessionModel(ctx) {
		  try {
		    const sessionId = ctx.sessions?.list?.getSnapshot?.()?.current;
		    if (!sessionId) return Object.freeze({ kind: "none" });
		    const state = ctx.modelDirectories?.directoryFor?.(sessionId)?.store?.getSnapshot?.();
		    if (!state) return Object.freeze({ kind: "unavailable" });
		    if (typeof state.current?.provider !== "string" || typeof state.current?.model !== "string") {
		      return Object.freeze({ kind: "loading" });
		    }
		    return Object.freeze({ kind: "ready", provider: state.current.provider, model: state.current.model, routable: state.routable });
		  } catch (_) {
		    return Object.freeze({ kind: "unavailable" });
		  }
		}

		function activeSessionGuidance(model, mimoConfigured) {
		  if (model.kind === "none") return "当前没有打开的会话；新建会话将使用上方默认模型。";
		  if (model.kind !== "ready") return "当前会话模型暂不可读；请在对话输入框旁的模型菜单核对所选服务。";
		  const label = `${model.provider} / ${model.model}`;
		  if (model.routable === false) return `当前会话模型：${label}。该路由目前不可用，请在对话输入框旁切换到可用模型。`;
		  if (model.provider !== MIMO_DEFAULT_MODEL.provider) {
		    return `当前会话模型：${label}。此处保存的 MiMo Key 不用于该会话；关闭设置后，在对话输入框旁的模型菜单显式切换，或配置当前服务。新对话默认设置不会改变此会话。`;
		  }
		  return `当前会话模型：${label}。${mimoConfigured ? "MiMo Key 已保存；可点击下方按钮测试连接。" : "尚未配置 MiMo Key，请先保存并测试。"}`;
		}

		async function setMimoDefaultModel(remote) {
		  try {
		    const described = await remote?.settings?.describe?.();
		    if (described?.ok !== true) return Object.freeze({ kind: "refused", message: "无法读取新对话默认模型，请刷新后重试。" });
		    if (described.value?.writable !== true) return Object.freeze({ kind: "refused", message: "当前原生设置是只读的。" });
		    const mimo = described.value?.namespaces?.find?.((item) => item?.ns === MIMO_SETTINGS_NAMESPACE);
		    const defaultNamespace = described.value?.namespaces?.find?.((item) => item?.ns === DEFAULT_MODEL_NAMESPACE);
		    if (!mimo?.value || typeof mimo.value !== "object" || !defaultNamespace || typeof defaultNamespace.revision !== "number") {
		      return Object.freeze({ kind: "refused", message: "MiMo 或新对话默认模型设置暂不可用，请刷新后重试。" });
		    }
		    const ref = mimo.value.apiKeyEnv ?? MIMO_CREDENTIAL_REF;
		    if (typeof ref !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return Object.freeze({ kind: "refused", message: "MiMo 凭据引用名无效，请检查模型配置。" });
		    const credentials = await remote?.credentials?.describe?.([ref]);
		    if (credentials?.ok !== true || credentials.value?.[ref]?.configured !== true) return Object.freeze({ kind: "refused", message: "请先保存 MiMo API Key，再设置新对话默认模型。" });
		    if (defaultNamespace.value?.provider === MIMO_DEFAULT_MODEL.provider && defaultNamespace.value?.model === MIMO_DEFAULT_MODEL.model) {
		      return Object.freeze({ kind: "already" });
		    }
		    const ops = [
		      { op: "set", path: ["provider"], value: MIMO_DEFAULT_MODEL.provider },
		      { op: "set", path: ["model"], value: MIMO_DEFAULT_MODEL.model },
		      { op: "unset", path: ["reasoningEffort"] },
		    ];
		    const written = await remote.settings.mutate(DEFAULT_MODEL_NAMESPACE, ops, defaultNamespace.revision);
		    if (written?.ok !== true) return Object.freeze({ kind: "refused", message: genericFailure(written) });
		    return Object.freeze({ kind: "saved" });
		  } catch (_) {
		    return Object.freeze({ kind: "refused", message: "无法设置新对话默认模型，请刷新后重试。" });
		  }
		}

		async function saveMimoCredential(remote, raw) {
		  const validation = validateCredentialInput(raw);
		  if (validation !== undefined) return Object.freeze({ kind: "invalid", message: validation });
		  try {
		    const described = await remote?.settings?.describe?.();
		    if (described?.ok !== true) return Object.freeze({ kind: "refused", message: "无法读取当前 MiMo 模型配置，请刷新后重试。" });
		    const namespace = described.value?.namespaces?.find?.((item) => item?.ns === MIMO_SETTINGS_NAMESPACE);
		    if (!namespace || namespace.value === null || typeof namespace.value !== "object") {
		      return Object.freeze({ kind: "refused", message: "当前没有可用的 MiMo 模型配置。" });
		    }
		    const ref = namespace.value.apiKeyEnv ?? MIMO_CREDENTIAL_REF;
		    if (typeof ref !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
		      return Object.freeze({ kind: "refused", message: "MiMo 凭据引用名无效，请检查模型配置。" });
		    }
		    const credentialState = await remote?.credentials?.describe?.([ref]);
		    if (credentialState?.ok !== true || credentialState.value?.[ref] === undefined) {
		      return Object.freeze({ kind: "refused", message: "无法确认当前 MiMo 凭据来源，请刷新后重试。" });
		    }
		    if (credentialState.value[ref].writable === false || credentialState.value[ref].source === "env") {
		      return Object.freeze({ kind: "refused", message: "当前 MiMo Key 来自启动环境变量，优先于本机凭据库；请在启动环境中更新该 Key。" });
		    }
		    const result = await remote?.credentials?.set?.(ref, raw.trim());
		    if (result?.ok === true) return Object.freeze({ kind: "saved" });
		    return Object.freeze({ kind: "refused", message: "密钥未能保存，请检查教室配置是否可写后重试。" });
		  } catch (_) {
		    return Object.freeze({ kind: "refused", message: "密钥未能保存，请检查教室配置是否可写后重试。" });
		  }
		}

		function doctorResultMessage(response, body) {
		  if (response?.status === 401 || response?.status === 403) return "需要先登录教室后才能测试连接。";
		  if (!response?.ok && response?.status !== 409) return "连接测试暂不可用，请稍后重试。";
		  if (body?.version !== MIMO_DOCTOR_VERSION || body?.scope !== MIMO_DOCTOR_SCOPE) return "连接测试返回了无法识别的结果。";
		  const result = body["model-service"];
		  if (!result || typeof result.code !== "string" || !["ok", "unavailable", "error", "cancelled", "not-checked"].includes(result.status)) {
		    return "连接测试返回了无法识别的结果。";
		  }
		  if (response.status === 409 && result.code !== "CHECK_IN_PROGRESS") return "连接测试暂不可用，请稍后重试。";
		  switch (result.code) {
		    case "OK": return response.ok && result.status === "ok" ? "MiMo 连接测试成功。" : "连接测试返回了无法识别的结果。";
		    case "MISSING_CREDENTIAL": return "尚未配置 MiMo API Key，请先保存密钥。";
		    case "INVALID_CREDENTIAL":
		    case "AUTH_FAILED": return "当前配置的 MiMo 服务未接受此密钥，请核对密钥与服务地址。";
		    case "ACCOUNT_UNAVAILABLE": return "MiMo 账号额度或服务当前不可用，请检查额度与账号状态。";
		    case "UPSTREAM_UNAVAILABLE": return "MiMo 上游服务暂不可用，请稍后重试。";
		    case "PROVIDER_UNAVAILABLE": return "本机 MiMo 模型配置暂不可用，请检查模型设置。";
		    case "NO_MODEL": return "当前没有可检测的 MiMo 模型，请检查模型目录。";
		    case "TIMEOUT": return "MiMo 连接测试超时，请稍后重试。";
		    case "CHECK_IN_PROGRESS": return "已有一个 MiMo 连接测试正在进行，请稍后重试。";
		    default: return "MiMo 连接测试未能完成，请稍后重试。";
		  }
		}

		async function testMimoConnection(fetchImpl = globalThis.fetch) {
		  if (typeof fetchImpl !== "function") return Object.freeze({ kind: "failed", message: "当前环境无法发起连接测试。" });
		  const controller = new AbortController();
		  const timer = setTimeout(() => controller.abort(), 5_000);
		  try {
		    const response = await fetchImpl(MIMO_DOCTOR_PATH, {
		      method: "POST",
		      credentials: "same-origin",
		      redirect: "manual",
		      headers: { "content-type": "application/json" },
		      body: "{}",
		      signal: controller.signal,
		    });
		    let body;
		    try { body = await response.json(); } catch (_) { body = undefined; }
		    const message = doctorResultMessage(response, body);
		    return Object.freeze({ kind: response?.ok && body?.["model-service"]?.code === "OK" && body?.["model-service"]?.status === "ok" && message === "MiMo 连接测试成功。" ? "success" : "failed", message });
		  } catch (error) {
		    return Object.freeze({ kind: "failed", message: error?.name === "AbortError" ? "MiMo 连接测试超时，请稍后重试。" : "网络暂时无法连接教室服务，请检查网络后重试。" });
		  } finally {
		    clearTimeout(timer);
		  }
		}

		function MimoCredentialCard({ ctx, keyConfigured }) {
		  const [draft, setDraft] = React.useState("");
		  const [busy, setBusy] = React.useState(undefined);
		  const [feedback, setFeedback] = React.useState(undefined);
		  const [serviceOrigin, setServiceOrigin] = React.useState(undefined);
		  const [currentConfigured, setCurrentConfigured] = React.useState(undefined);
		  const [stateReadable, setStateReadable] = React.useState(undefined);
		  const [defaultSelection, setDefaultSelection] = React.useState(undefined);
		  const [defaultWritable, setDefaultWritable] = React.useState(false);
		  const [activeModel, setActiveModel] = React.useState(() => activeSessionModel(ctx));
		  const refreshGeneration = React.useRef(0);
		  React.useEffect(() => {
		    let active = true;
		    const remote = ctx.remote;
		    const refresh = () => {
		      const current = ++refreshGeneration.current;
		      void readMimoCardState(remote).then((state) => {
		        if (!active || current !== refreshGeneration.current) return;
		        setStateReadable(state !== undefined);
		        setServiceOrigin(state?.serviceOrigin);
		        setCurrentConfigured(state?.configured);
		        setDefaultSelection(state?.defaultSelection);
		        setDefaultWritable(state?.defaultWritable === true);
		      });
		    };
		    refresh();
		    const disposers = [];
		    try {
		      if (typeof remote?.$on === "function") {
		        disposers.push(remote.$on("settings/document-updated", refresh));
		        disposers.push(remote.$on("credentials/reference-updated", refresh));
		      }
		    } catch (_) {}
		    return () => {
		      active = false;
		      for (const dispose of disposers) { try { dispose?.(); } catch (_) {} }
		    };
		  }, [ctx]);
		  React.useEffect(() => {
		    const sessions = ctx.sessions?.list;
		    const directories = ctx.modelDirectories;
		    if (typeof sessions?.subscribe !== "function" || typeof directories?.directoryFor !== "function") return;
		    let unsubscribeDirectory;
		    let generation = 0;
		    const refreshModel = () => {
		      const next = activeSessionModel(ctx);
		      setActiveModel((previous) => previous.kind === next.kind
		        && previous.provider === next.provider && previous.model === next.model
		        && previous.routable === next.routable ? previous : next);
		    };
		    const bind = () => {
		      unsubscribeDirectory?.();
		      unsubscribeDirectory = undefined;
		      const current = ++generation;
		      const sessionId = sessions.getSnapshot()?.current;
		      if (!sessionId) { refreshModel(); return; }
		      let directory;
		      try { directory = directories.directoryFor(sessionId); } catch (_) { setActiveModel(Object.freeze({ kind: "unavailable" })); return; }
		      const refresh = () => { if (current === generation) refreshModel(); };
		      unsubscribeDirectory = directory.store.subscribe(refresh);
		      refresh();
		      void directory.load().then(refresh, refresh);
		    };
		    const unsubscribeSessions = sessions.subscribe(bind);
		    bind();
		    return () => { ++generation; unsubscribeSessions(); unsubscribeDirectory?.(); };
		  }, []);
		  const submit = async () => {
		    const validation = validateCredentialInput(draft);
		    if (validation !== undefined) { setFeedback(validation); return; }
		    setBusy("saving");
		    setFeedback(undefined);
		    try {
		      const outcome = await saveMimoCredential(ctx.remote, draft);
		      if (outcome.kind === "saved") {
		        setDraft("");
		        setFeedback("MiMo API Key 已保存在本机凭据库中；尚未实测连接。");
		        const generation = ++refreshGeneration.current;
		        const state = await readMimoCardState(ctx.remote);
		        if (generation === refreshGeneration.current) {
		          setStateReadable(state !== undefined);
		          setServiceOrigin(state?.serviceOrigin);
		          setCurrentConfigured(state?.configured);
		          setDefaultSelection(state?.defaultSelection);
		          setDefaultWritable(state?.defaultWritable === true);
		        }
		      } else setFeedback(outcome.message);
		    } finally {
		      setBusy(undefined);
		    }
		  };
		  const runTest = async () => {
		    if (busy !== undefined || draft.trim().length > 0 || !configured) return;
		    setBusy("testing");
		    setFeedback(undefined);
		    const outcome = await testMimoConnection();
		    setBusy(undefined);
		    setFeedback(outcome.message);
		  };
		  const configured = stateReadable === true ? currentConfigured === true : stateReadable === false ? false : keyConfigured === true;
		  const isDefault = defaultSelection?.provider === MIMO_DEFAULT_MODEL.provider && defaultSelection?.model === MIMO_DEFAULT_MODEL.model;
		  const setDefault = async () => {
		    if (!configured || !defaultWritable || busy !== undefined) return;
		    setBusy("defaulting");
		    setFeedback(undefined);
		    const outcome = await setMimoDefaultModel(ctx.remote);
		    if (outcome.kind === "saved") setFeedback("MiMo 已设为新对话默认模型；当前会话模型不变。");
		    else if (outcome.kind === "already") setFeedback("MiMo 已是新对话默认模型；当前会话模型可能不同。");
		    else setFeedback(outcome.message);
		    setBusy(undefined);
		    const state = await readMimoCardState(ctx.remote);
		    setStateReadable(state !== undefined);
		    setServiceOrigin(state?.serviceOrigin);
		    setCurrentConfigured(state?.configured);
		    setDefaultSelection(state?.defaultSelection);
		    setDefaultWritable(state?.defaultWritable === true);
		  };
		  return React.createElement("section", { className: "mochi-model-provider-hint", "aria-label": "MiMo API Key 设置" }, [
		    React.createElement("strong", { key: "title" }, "MiMo API Key"),
		    React.createElement("p", { key: "endpoint", className: "mochi-model-provider-hint__endpoint", "aria-label": "MiMo 有效服务地址" }, serviceOrigin
		      ? `当前有效服务地址（mochi-mimo）：${serviceOrigin}`
		      : "MiMo 服务地址暂不可读，请在原生模型设置卡中检查配置。"),
		    React.createElement("p", { key: "description" }, stateReadable === false
		      ? "MiMo 配置状态暂不可读，请刷新后重试。"
		      : configured ? "当前已有 MiMo 密钥；替换时输入新密钥并保存。" : "填写后仅保存在本机凭据库中，不会写入 settings.yaml。"),
		    React.createElement("p", { key: "default", className: "mochi-model-provider-hint__default" }, stateReadable === false
		      ? "新对话默认模型暂不可读。"
		      : defaultSelection ? `当前新对话默认模型：${defaultSelection.provider} / ${defaultSelection.model}。当前会话模型可能不同。`
		        : "当前新对话默认模型暂不可读；当前会话模型可能不同。"),
		    React.createElement("p", { key: "active-model", className: "mochi-model-provider-hint__default", role: "status" }, activeSessionGuidance(activeModel, configured)),
		    React.createElement("button", {
		      key: "set-default", type: "button", className: "mochi-model-provider-hint__button",
		      disabled: busy !== undefined || !configured || !defaultWritable || isDefault,
		      onClick: () => { void setDefault(); },
		    }, busy === "defaulting" ? "设置中…" : isDefault ? "已是新对话默认模型" : "设为新对话默认模型"),
		    React.createElement("label", { key: "label", className: "mochi-model-provider-hint__key-field" }, [
		      React.createElement("span", { key: "text" }, "API Key"),
		      React.createElement("input", {
		        key: "input", type: "password", autoComplete: "new-password", value: draft,
		        placeholder: configured ? "输入新密钥以替换" : "粘贴 MiMo API Key",
		        "aria-label": "MiMo API Key", onChange: (event) => { setDraft(event.target.value); setFeedback(undefined); },
		      }),
		    ]),
		    React.createElement("div", { key: "actions", className: "mochi-model-provider-hint__actions" }, [
		      React.createElement("button", {
		        key: "save", type: "button", className: "mochi-model-provider-hint__button",
		        disabled: busy !== undefined || draft.trim().length === 0,
		        onClick: () => { void submit(); },
		      }, busy === "saving" ? "保存中…" : "保存 MiMo API Key"),
		      React.createElement("button", {
		        key: "test", type: "button", className: "mochi-model-provider-hint__button",
		        disabled: busy !== undefined || draft.trim().length > 0 || !configured,
		        onClick: () => { void runTest(); },
		      }, busy === "testing" ? "测试中…" : "测试 MiMo 连接"),
		    ]),
		    React.createElement("p", { key: "notice", className: "mochi-model-provider-hint__notice" }, "测试会发送一次最多 1 个 token 的探针，可能产生少量费用；只检查内置 MiMo 路线的首个目录模型，不代表每个已选模型。请先保存密钥再测试。"),
		    React.createElement("span", { key: "status", className: "mochi-model-provider-hint__status", role: "status" }, feedback ?? (stateReadable === false
		      ? "配置状态暂不可读"
		      : configured ? "已配置" : "尚未配置")),
		  ]);
		}

		const inject = ["slots", "remote", "remote.settings", "remote.credentials", "sessions", "modelDirectories"];

		function apply(ctx) {
		  ensureStyles();
		  ctx.slots.inject("conversation.input.model", () => {
		    let current, remove;
		    const reconcile = () => {
		      const native = ctx.slots.entries?.("conversation.input.model").find(entry => entry.locale === "model" && entry.component !== NativeModelControl);
		      if (native === current) return;
		      remove?.(); remove = undefined; current = native;
		      if (native) remove = ctx.slots.register({ name: "conversation.input.model", priority: -20, locale: native.locale,
		        inject: sessionId => ({ ...native.inject(sessionId), nativeComponent: native.component }),
		      }, NativeModelControl);
		    };
		    const unsubscribe = ctx.slots.subscribe?.("conversation.input.model", reconcile);
		    reconcile();
		    return () => { unsubscribe?.(); remove?.(); };
		  });
		  ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
		    name: "conversation.input.right", id: "mochi-reasoning", order: 45,
		    inject: sessionId => ({ ctx, sessionId }),
		  }, ReasoningControl));
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
		  ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
		    name: "settings.models.provider-card",
		    key: MIMO_SETTINGS_NAMESPACE,
		  }, (props) => React.createElement(MimoCredentialCard, { ctx, keyConfigured: props.keyConfigured })));
		}

		module.exports.apply = apply;
		module.exports.inject = inject;
		module.exports.__test = {
		  PRESET_CATALOG,
		  SETTINGS_NAMESPACE,
		  MIMO_SETTINGS_NAMESPACE,
		  MIMO_CREDENTIAL_REF,
		  MIMO_DOCTOR_PATH,
		  addPreset,
		  credentialRefFor,
		  emptySnapshot,
		  profileExists,
		  readPresetSnapshot,
		  PresetFooter,
		  ProviderCardHint,
		  MimoCredentialCard,
		  activeSessionModel,
		  activeSessionGuidance,
		  saveMimoCredential,
		  setMimoDefaultModel,
		  testMimoConnection,
		  doctorResultMessage,
		  validateCredentialInput,
		  mimoServiceOrigin,
		  readMimoServiceOrigin,
		  readMimoCardState,
		  statusText,
		  modelOnlyDirectory,
		  NativeModelControl,
		  ReasoningControl,
		  reasoningRequest,
		};

		return module.exports;
	}
});
