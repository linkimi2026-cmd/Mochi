#!/usr/bin/env node
// build.mjs —— jxl-brand client bundle 构建器
//
// 把 src/hero.tsx（从 canonical 校园源码复用真实 OrbCompanion + ExpressiveOrb）打包成官方
// ModuleLoader 注册形态的 client.js：
//   window.__ModuleLoader__.load({ id: "jxl-brand", factory: (require) => {...} })
// externals = react / react/jsx-runtime（官方模块表基线，运行时由模块系统供给）。
// motion/react → 本地垫片（matchMedia 实现 useReducedMotion，不打包整个 motion）。
// .css → text loader 内联，运行时由 apply() 注入 <style>。
//
// 用法：node scripts/build.mjs
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkgRoot = dirname(fileURLToPath(new URL(".", import.meta.url)));
const OUT = join(pkgRoot, "client.js");
const workspaceRoot = dirname(dirname(pkgRoot));
const require = createRequire(import.meta.url);
const { resolveCampusSource } = require(join(workspaceRoot, "scripts", "campus-paths.cjs"));
const campusSource = resolveCampusSource({ workspaceRoot });
const campusComponents = join(campusSource.root, "src", "components");

const result = await build({
  entryPoints: [join(pkgRoot, "src/hero.tsx")],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  write: false,
  alias: {
    "@jxl-campus-components": campusComponents,
    "motion/react": join(pkgRoot, "src/shims/motion-react.ts"),
  },
  nodePaths: [join(campusSource.root, "node_modules")],
  loader: { ".css": "text" },
  external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  jsx: "automatic",
  minify: false,
  logLevel: "warning",
});

const bundled = result.outputFiles[0].text;

const client = `window.__ModuleLoader__.load({
	id: "jxl-brand",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region esbuild bundle（src/hero.tsx：真实 OrbCompanion + ExpressiveOrb）
${bundled
  .split("\n")
  .map((l) => "\t\t" + l)
  .join("\n")}
		//#endregion
		//#region apply（slot 注册 + 语言包 + 样式注入）
		// 注意：esbuild 会执行 module.exports = __toCommonJS(hero_exports) 整体替换对象，
		// 因此必须把 apply/inject 挂在 module.exports 上，函数用作用域内原名引用。
			const inject = ["slots", "locale", "sessions", "uiSession"];
		function apply(ctx) {
			injectCompanionStyles();
			ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", function* () {
				yield ctx.slots.register({ name: "sidebar.brand.mark" }, JellyfishBrandMark);
				yield ctx.slots.register({ name: "sidebar.brand.name" }, JellyfishWordmark);
			}));
			ctx.slots.inject("conversation.hero.brand.mark", function* () {
				yield ctx.slots.register({ name: "conversation.hero.brand.mark" }, HeroMochi);
			});
			ctx.slots.inject("settings.general.item", function* () {
				// 设置 · 通用里的「技能」行列：6 个老师常用技能的中文名与简介。
				yield ctx.slots.register({ name: "settings.general.item", id: "jxl-skills", order: 90 }, SkillsRow);
			});
				ctx.effect(
					() => {
						// 每条 assistant 都保留 idle Mochi。只有当前会话官方标记为
						// data-streaming="true" 的消息头像才进入 typing；首 token 等待和
						// 工具执行没有可见 assistant 行时，才在当前 composer 前挂一只紧凑 Mochi。
						// 运行态只取 SessionSnapshot.running，绝不猜测全局停止按钮或历史状态元件。
						const TAG = "data-jxl-mochi-avatar";
						const PENDING_TAG = "data-jxl-mochi-pending";
						let disposed = false;
						let scheduled = false;
						let frameId;
						let subscribedSessionId;
						let disposeCurrentSession;
						let pendingHost;
						let pendingVariant;
						let disposePendingMochi;
						const currentBinding = () => {
							const sessionId = ctx.sessions.list.getSnapshot().current;
							return sessionId === undefined ? undefined : ctx.sessions.binding(sessionId);
						};
						const currentSession = () => currentBinding()?.session;
						const currentPendingInteraction = () => {
							const binding = currentBinding();
							return binding === undefined ? undefined : ctx.uiSession.pendingInteractions.getSnapshot().get(binding.sessionId);
						};
						// ConversationRoot keeps the composer seat sticky and measures it into
						// --dsh-composer-height. A pending Mochi belongs immediately above that
						// seat's native composer, where it remains visible without taking over
						// the reader's scroll position.
						const currentComposerSeat = () => document.querySelector("[data-conversation-scroll] > [data-composer-seat]")
							|| document.querySelector("[data-composer-seat]");
						const activeAssistantStep = () => {
							const session = currentSession();
							if (!session?.getSnapshot().running) return null;
							const steps = [...document.querySelectorAll('div[data-chat-flow-kind="assistant-step"]')];
							return steps.reverse().find((step) => step.querySelector('[data-streaming="true"]')) || null;
						};
						const destroyPendingMochi = () => {
							disposePendingMochi?.();
							disposePendingMochi = undefined;
							if (pendingHost?.parentNode) pendingHost.parentNode.removeChild(pendingHost);
							pendingHost = undefined;
							pendingVariant = undefined;
						};
						const showPendingMochi = (parent, variant) => {
							if (pendingHost?.parentNode === parent && pendingVariant === variant) return;
							destroyPendingMochi();
							const host = document.createElement("div");
							host.setAttribute(PENDING_TAG, variant);
							host.className = "jxl-pending-mochi jxl-pending-mochi--" + variant;
							host.setAttribute("aria-live", "polite");
							const text = variant === "approval" ? "Mochi 正在等待你的确认" : "Mochi 正在处理…";
							host.setAttribute("aria-label", text);
							if (variant === "flow" && parent.hasAttribute("data-composer-seat")) {
								parent.insertBefore(host, parent.firstChild);
							} else parent.appendChild(host);
							pendingHost = host;
							pendingVariant = variant;
							disposePendingMochi = variant === "approval"
								? mountCompanion(host, "alert", text, 30)
								: mountLoading(host, text, true);
						};
						// conversation.approval.detail is a shipped single slot occupied by ApprovalCommand.
						// Appending to the keyed native panel preserves that command detail and also covers
						// approvals that intentionally have no callId, for which the child slot is absent.
						const currentApprovalPanel = (interaction) => [...document.querySelectorAll("[data-approval-key]")]
							.find((panel) => panel.getAttribute("data-approval-key") === interaction.key) || null;
						const syncPendingMochi = (activeStep) => {
							const interaction = currentPendingInteraction();
							if (interaction?.kind === "approval") {
								const panel = currentApprovalPanel(interaction);
								if (panel !== null) showPendingMochi(panel, "approval");
								else destroyPendingMochi();
								return;
							}
							const session = currentSession();
							if (interaction !== undefined || activeStep !== null || !session?.getSnapshot().running) {
								destroyPendingMochi();
								return;
							}
							const seat = currentComposerSeat();
							if (seat !== null) showPendingMochi(seat, "flow");
							else {
								const flows = [...document.querySelectorAll("[data-chat-flow]")];
								const flow = flows.at(-1);
								if (flow !== undefined) showPendingMochi(flow, "flow");
								else destroyPendingMochi();
							}
						};
						const applyRunState = () => {
							const activeStep = activeAssistantStep();
							document.querySelectorAll(".jxl-msg-avatar-row").forEach((row) => {
								const busy = activeStep !== null && activeStep.contains(row);
								const state = busy ? "typing" : "idle";
								const text = busy ? "Mochi 正在生成回复…" : "";
								const st = row.querySelector(".jxl-msg-avatar-status");
								if (st && st.textContent !== text) st.textContent = text;
								row.classList.toggle("jxl-msg-avatar-row--busy", busy);
								if (row.getAttribute("data-jxl-avatar-state") === state) return;
								const root = row.__jxlAvatarRoot;
								row.setAttribute("data-jxl-avatar-state", state);
								if (root) { try { renderAvatar(root, state); } catch (e) { /* 重渲染失败不影响对话 */ } }
							});
							syncPendingMochi(activeStep);
						};
						const requestScan = () => {
							if (disposed || scheduled) return;
							scheduled = true;
							frameId = requestAnimationFrame(() => {
								frameId = undefined;
								if (!disposed) scan();
							});
						};
						const syncCurrentSession = () => {
							const session = currentSession();
							if (session?.sessionId === subscribedSessionId) return;
							disposeCurrentSession?.();
							subscribedSessionId = session?.sessionId;
							disposeCurrentSession = session?.subscribe(requestScan);
						};
						const scan = () => {
							if (disposed) return;
							scheduled = false;
							frameId = undefined;
							try {
								syncCurrentSession();
								document.querySelectorAll('div[data-chat-flow-kind="assistant-step"]').forEach((el) => {
									if (el.hasAttribute(TAG)) return;
									el.setAttribute(TAG, "1");
									mountAvatar(el);
								});
								applyRunState();
							} catch (e) { /* 扫描失败不阻断 */ }
						};
						const disposeSessionList = ctx.sessions.list.subscribe(requestScan);
						const disposePendingInteractions = ctx.uiSession.pendingInteractions.subscribe(requestScan);
						scan();
						const mo = new MutationObserver(requestScan);
						mo.observe(document.body, { attributes: true, attributeFilter: ["data-streaming", "data-approval-key"], childList: true, subtree: true });
						return () => {
							disposed = true;
							if (frameId !== undefined) cancelAnimationFrame(frameId);
							frameId = undefined;
							scheduled = false;
							mo.disconnect();
							disposeSessionList();
							disposeCurrentSession?.();
							disposePendingInteractions();
							destroyPendingMochi();
						};
					},
					"jxl-brand: assistant avatars",
				);
			ctx.effect(
				() => {
					const disposeLang = ctx.locale.addLanguage({ id: "zh-JXL", label: "中文（嘉行联）", fallback: "zh" });
					const disposeDict = ctx.locale.register("conversation", "zh-JXL", HERO_DICT);
					const disposeTrajectoryDict = ctx.locale.register("trajectory", "zh-JXL", TRAJECTORY_DICT);
					const disposeChatDict = ctx.locale.register("chat", "zh-JXL", CHAT_DICT);
					let disposePref;
					try {
						const snap = ctx.locale.getSnapshot ? ctx.locale.getSnapshot() : undefined;
						const active = snap && snap.active;
						if (!active || active === "zh" || active === "zh-JXL") disposePref = ctx.locale.setLocale("zh-JXL");
					} catch (e) { /* 语言激活失败不阻断品牌注册 */ }
					// 语言选择只保留「中文 / English」两项：zh-JXL（中文（嘉行联））仍是
					// 活跃字典载体（hero 文案换装必需），但从选择列表里隐藏该选项。
					const hideJxlOption = () => {
						try {
							document.querySelectorAll('[role="option"],[role="menuitem"],[role="radio"]').forEach((el) => {
								const t = el.textContent || "";
								if (t.includes("嘉行联") && t.includes("中文")) el.style.display = "none";
							});
						} catch (e) { /* 隐藏失败不影响功能 */ }
					};
					let hideScheduled = false;
					const mo = new MutationObserver(() => {
						if (hideScheduled) return;
						hideScheduled = true;
						requestAnimationFrame(() => { hideScheduled = false; hideJxlOption(); });
					});
					mo.observe(document.body, { childList: true, subtree: true });
					hideJxlOption();
					return () => {
						mo.disconnect();
						if (disposePref) disposePref();
						disposeChatDict();
						disposeTrajectoryDict();
						disposeDict();
						disposeLang();
					};
				},
				"jxl-brand: language pack",
			);
		}
		//#endregion
		module.exports.apply = apply;
		module.exports.inject = inject;
		return module.exports;
	}
});
`;

writeFileSync(OUT, client);
console.log(`client.js written from ${campusSource.kind} campus source, bytes:`, client.length);
await import("./build-loading.mjs");
