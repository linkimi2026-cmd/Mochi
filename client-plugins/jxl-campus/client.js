window.__ModuleLoader__.load({
	id: "jxl-campus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var mochiBrand = require("jxl-brand");
		var disposeLoading = null;

		//#region 小组件注册表（2026-09-04 小组件架构）
		// 每个校园能力 = 一个可独立存在/删除的 Mochi 功能界面（小组件）。
		// 校园协作助手【不存在】——Mochi 本尊就是助手，不重复。
	var WIDGETS = [
		{ id: "dashboard", title: "班主任待办", desc: "今日事项与审批概览", icon: "clipboard-check" },
		{ id: "movements", title: "学生放行与返班", desc: "外出申请 · 放行 · 返班确认", icon: "arrow-left-right" },
		{ id: "messages", title: "班级协作消息", desc: "与校医 · 年级的沟通", icon: "messages-square" },
		{ id: "students", title: "本班学生档案", desc: "健康档案与紧急联系", icon: "contact-round" },
		{ id: "analytics", title: "本班事实统计", desc: "考勤与事件事实", icon: "chart-no-axes-combined" },
	];
	// 传话/任务【不做独立界面】（2026-09-05 用户裁定"对话即界面"）：收发两端
	// 都在各自 Mochi 的对话框里完成（jxl.relay_* / mochi.* 工具），曾试过第 6
	// 个侧栏入口「Mochi 传话箱」，按裁定撤下；widget-relay 产物留在 dist 但不可达。
	var LOGO_URL = "/jxl-assets/brand/jiaxing-jellyfish-v1.png";
	var CAMPUS_WORK_LIST_ID = "jxl-campus-work-links";
	/* Five hand-picked inline SVGs follow Lucide's 24px, currentColor stroke contract.
	 * Keeping the five paths local avoids adding a component library just for the sidebar. */
	var CAMPUS_ICON_SHAPES = {
		"clipboard-check": [
			["rect", { x: 8, y: 2, width: 8, height: 4, rx: 1, ry: 1 }],
			["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
			["path", { d: "m9 14 2 2 4-4" }],
		],
		"arrow-left-right": [
			["path", { d: "M8 3 4 7l4 4" }],
			["path", { d: "M4 7h16" }],
			["path", { d: "m16 21 4-4-4-4" }],
			["path", { d: "M20 17H4" }],
		],
		"messages-square": [
			["path", { d: "M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" }],
			["path", { d: "M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" }],
		],
		"contact-round": [
			["path", { d: "M16 2v2" }],
			["path", { d: "M17.915 21a6 6 0 10-12 0" }],
			["path", { d: "M8 2v2" }],
			["circle", { cx: 12, cy: 11, r: 4 }],
			["rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
		],
		"chart-no-axes-combined": [
			["path", { d: "M12 16v5" }],
			["path", { d: "M16 14.639V21" }],
			["path", { d: "M20 10.656V21" }],
			["path", { d: "m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15" }],
			["path", { d: "M4 18.463V21" }],
			["path", { d: "M8 14.656V21" }],
		],
	};
	//#endregion

		//#region 极简 UI store（供侧栏入口高亮；面板本体走原生 DOM）
		var ui = { active: null, booting: false, failed: false };
		var uiListeners = new Set();
		function uiEmit() {
			uiListeners.forEach(function (fn) {
				try {
					fn();
				} catch (e) {}
			});
		}
		function uiSubscribe(fn) {
			uiListeners.add(fn);
			return function () {
				uiListeners.delete(fn);
			};
		}
		// 复合快照：active / booting / failed 任一变化都要触发重渲染
		function uiSnapshot() {
			if (!ui.active) return "";
			return (ui.booting ? "booting:" : ui.failed ? "failed:" : "live:") + ui.active;
		}
		//#endregion

		//#region 样式（小组件面板 + 侧栏入口；JXL 米白画布 + 鼠尾草点缀）
		function injectStyles() {
			if (document.getElementById("jxl-campus-style")) return;
			var css = [
				/* 群体隔离：campus 样式表进来后保住 Mochi 的暗色与排版 */
				"html,body{background-color:var(--dsw-alias-bg-base,#1b211e) !important;}",
				/* 宿主层：由 shell.overlay 承载，几何由官方 conversation slot 实测后写入。 */
				"#jxl-campus-widgets-host{position:absolute;z-index:1;pointer-events:none;}",
				/* 小组件面板：浮动卡片（JXL 设计语言长在 Mochi 里） */
				".jxl-widget-panel{position:absolute;top:10px;right:10px;bottom:10px;left:10px;display:flex;flex-direction:column;overflow:hidden;",
				"background:var(--canvas,#f7f4ec);color:var(--ink,#2f3a33);border-radius:18px;pointer-events:auto;",
				"box-shadow:0 24px 70px -30px rgba(15,22,18,.75),0 0 0 1px rgba(69,88,78,.18);",
				"animation:jxl-widget-rise .42s cubic-bezier(.32,.72,0,1);}",
				"@keyframes jxl-widget-rise{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}",
				/* Apple：毛玻璃材质头部（vibrancy） */
				".jxl-widget-panel__head{display:flex;align-items:center;gap:10px;padding:12px 16px;flex:none;",
				"background:rgba(250,248,242,.72);backdrop-filter:saturate(160%) blur(20px);-webkit-backdrop-filter:saturate(160%) blur(20px);",
				"border-bottom:1px solid rgba(69,88,78,.14);}",
				".jxl-widget-panel__logo{width:24px;height:24px;border-radius:7px;object-fit:contain;background:#45584e;flex:none;}",
				".jxl-widget-panel__titles{display:flex;flex-direction:column;min-width:0;}",
				".jxl-widget-panel__title{font:600 15px/1.25 'PingFang SC','Noto Sans CJK SC',system-ui,sans-serif;color:#2f3a33;letter-spacing:.02em;white-space:nowrap;}",
				".jxl-widget-panel__desc{font:400 12px/1.4 'PingFang SC',system-ui,sans-serif;color:#5c6f64;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
				".jxl-widget-panel__close{margin-left:auto;display:flex;align-items:center;gap:8px;border:1px solid rgba(69,88,78,.25);",
				"background:rgba(247,244,236,.92);color:#315f50;font:600 12px/1 'PingFang SC',system-ui,sans-serif;letter-spacing:.04em;",
				"padding:8px 14px;border-radius:999px;cursor:pointer;box-shadow:0 6px 18px -10px rgba(47,58,51,.45);flex:none;",
				"transition:transform .18s cubic-bezier(.32,.72,0,1),background .18s ease,box-shadow .18s ease;}",
				".jxl-widget-panel__close:hover{background:#fff;transform:translateY(-1px);}",
				/* Apple：按压即时反馈（pointer-down 生效，不等 release） */
				".jxl-widget-panel__close:active{transform:scale(.95);box-shadow:0 2px 8px -6px rgba(47,58,51,.45);}",
				".jxl-widget-panel__close img{width:16px;height:16px;border-radius:5px;object-fit:contain;background:#45584e;}",
				".jxl-widget-panel__stage{flex:1;position:relative;overflow:auto;}",
				".jxl-widget-panel__stage>div{min-height:100%;}",
				".jxl-widget-panel__booting,.jxl-widget-panel__error{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;",
				"background:var(--canvas,#f7f4ec);color:#5c6f64;font:500 14px/1.6 'PingFang SC',system-ui,sans-serif;letter-spacing:.06em;}",
				".jxl-widget-panel__error{color:#a4552f;}",
				".jxl-widget-panel__ring{width:26px;height:26px;border-radius:50%;border:3px solid rgba(69,88,78,.18);border-top-color:#315f50;animation:jxl-widget-spin .9s linear infinite;}",
				"@keyframes jxl-widget-spin{to{transform:rotate(360deg)}}",
				/* ── WorkBuddy 式侧栏重排（用户 2026-09-04 指定：功能入口左上、任务左下）──
				   dsh-v0.1.3-alpha.1 源码锁定哈希类：hHd-Xa_*（侧栏骨架）。 */
				'[class*="hHd-Xa_root"]{position:relative;}',
				/* 拆开 footArea，让入口与设置独立参与纵向排布 */
				'[class*="hHd-Xa_footArea"]{display:contents;}',
				/* 任务/会话列表：order 2 紧跟新会话（用户 2026-09-05 裁定对调），弹性占据中部 */
				'[class*="hHd-Xa_regionArea"]{order:2;flex:1 1 auto !important;min-height:120px;}',
				/* 小组件入口组沉底：margin-top:auto 钉在设置上方 */
				'[class*="hHd-Xa_footerActions"]{order:4;margin:auto 0 0;}',
				'[class*="hHd-Xa_settingsArea"]{order:5;}',
				/* 官方 footer list slot 自身是 display:contents；让一个校园工作组填满座位。 */
				'[data-slot="sidebar.footer.action"]{display:block !important;inline-size:100% !important;min-inline-size:0;max-height:38vh;overflow-y:auto;}',
				/* Campus Work：一层轻材质归组，主 Mochi 品牌仍由官方 brand slots 承担。 */
				".jxl-campus-group{display:flex;flex-direction:column;gap:3px;inline-size:100%;min-inline-size:0;padding:4px;box-sizing:border-box;",
				"border:1px solid var(--jxl-glass-border,rgba(255,255,255,.4));border-radius:14px;background:var(--jxl-glass-bg,rgba(247,244,236,.78));",
				"box-shadow:inset 0 1px 0 var(--jxl-control-top-rim,rgba(255,255,255,.4)),0 8px 18px -18px rgba(24,34,29,.55);",
				"backdrop-filter:saturate(135%) blur(12px);-webkit-backdrop-filter:saturate(135%) blur(12px);}",
				".jxl-campus-group__toggle{display:flex;align-items:center;gap:7px;min-block-size:28px;padding:2px 6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);",
				"font:650 11px/1 'PingFang SC','Noto Sans CJK SC',system-ui,sans-serif;letter-spacing:.08em;text-align:left;cursor:pointer;border-radius:9px;}",
				".jxl-campus-group__toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
				".jxl-campus-group__toggle:active{transform:scale(.985);}",
				".jxl-campus-group__brand{inline-size:16px;block-size:16px;object-fit:contain;border-radius:5px;background:var(--dsw-alias-brand-primary);flex:none;}",
				".jxl-campus-group__title{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				".jxl-campus-group__chevron{margin-left:auto;inline-size:15px;block-size:15px;transition:transform var(--jxl-dur-control,100ms) var(--jxl-spring,ease);}",
				".jxl-campus-group__toggle[aria-expanded=\"false\"] .jxl-campus-group__chevron{transform:rotate(-90deg);}",
				".jxl-campus-group__links{display:flex;flex-direction:column;gap:2px;min-inline-size:0;}",
				/* The footer slot's flex rule otherwise overrides the browser [hidden] default. */
				".jxl-campus-group__links[hidden]{display:none !important;}",
				/* 五项都占满组宽；图标遵循 Lucide 的 currentColor 线性语言。 */
				".jxl-campus-entry{display:flex;align-items:center;gap:10px;inline-size:100%;min-block-size:40px;box-sizing:border-box;border:0;background:transparent;",
				"color:var(--dsw-alias-label-primary);padding:8px 9px;border-radius:10px;cursor:pointer;font:500 13px/1.25 'PingFang SC','Noto Sans CJK SC',system-ui,sans-serif;text-align:left;",
				"transition:background-color var(--jxl-dur-control,100ms) ease,color var(--jxl-dur-control,100ms) ease,transform 100ms ease;}",
				".jxl-campus-entry:hover{background:var(--dsw-alias-interactive-bg-hover);}",
				".jxl-campus-entry:active{transform:scale(.985);}",
				".jxl-campus-entry.is-active{background:var(--dsw-alias-interactive-bg-hover-accent,rgba(217,135,62,.16)) !important;color:var(--dsw-alias-label-primary) !important;",
				"box-shadow:inset 2px 0 0 #d9873e,inset 0 0 0 1px color-mix(in srgb,#d9873e 34%,transparent);}",
				".jxl-campus-entry__icon{inline-size:18px;block-size:18px;flex:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}",
				".jxl-campus-entry__label{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.01em;}",
				".jxl-campus-entry__state{margin-left:auto;inline-size:6px;block-size:6px;border-radius:99px;background:transparent;transition:background-color var(--jxl-dur-control,100ms) ease;}",
				".jxl-campus-entry.is-active .jxl-campus-entry__state{background:#d9873e;}",
				".jxl-campus-entry.is-failed .jxl-campus-entry__state{background:#bf5f43;}",
				".jxl-campus-group.is-rail{padding:0;border:0;background:transparent;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;}",
				".jxl-campus-group.is-rail .jxl-campus-group__toggle{display:none;}",
				".jxl-campus-group.is-rail .jxl-campus-entry{justify-content:center;inline-size:36px;padding:0;gap:0;}",
				".jxl-campus-group.is-rail .jxl-campus-entry__label{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}",
				".jxl-campus-group.is-rail .jxl-campus-entry__state{position:absolute;inset-inline-end:3px;inset-block-end:5px;}",
				".jxl-campus-group :is(.jxl-campus-group__toggle,.jxl-campus-entry):focus-visible{outline:2px solid rgba(217,135,62,.75);outline-offset:2px;}",
				/* Apple：减弱动态时保留色彩反馈但不缩放；减弱透明时转为实底。 */
				"@media (prefers-reduced-motion:reduce){.jxl-widget-panel{animation:none}.jxl-campus-entry,.jxl-campus-group__toggle,.jxl-campus-group__chevron,.jxl-widget-panel__close{transition:none}.jxl-campus-entry:active,.jxl-campus-group__toggle:active{transform:none}}",
				"@media (prefers-reduced-transparency:reduce){.jxl-campus-group{background:var(--dsw-alias-bg-layer-1);backdrop-filter:none;-webkit-backdrop-filter:none}}",
				"@media (prefers-contrast:more){.jxl-campus-group{border-color:var(--dsw-alias-label-primary)}.jxl-campus-entry.is-active{box-shadow:inset 3px 0 0 #d9873e,inset 0 0 0 1px var(--dsw-alias-label-primary)}}"
			].join("");
			var el = document.createElement("style");
			el.id = "jxl-campus-style";
			el.textContent = css;
			document.head.appendChild(el);
		}

		/** campus style.css 是全局样式，晚于守卫注入 → 加载完成后补一层守卫压住 body 背景篡改。 */
		function ensureCampusCss() {
			if (document.getElementById("jxl-campus-css")) return;
			var css = document.createElement("link");
			css.rel = "stylesheet";
			css.href = "/campus/assets/style.css";
			css.id = "jxl-campus-css";
			css.onload = function () {
				if (document.getElementById("jxl-campus-guard2")) return;
				var g = document.createElement("style");
				g.id = "jxl-campus-guard2";
				g.textContent = "html,body{background-color:var(--dsw-alias-bg-base,#1b211e) !important;}";
				document.head.appendChild(g);
			};
			document.head.appendChild(css);
		}
		//#endregion

		//#region 面板控制器（原生 DOM：打开/关闭小组件）
		var hostEl = null;
		var panelEl = null; // 当前唯一活动面板
		var mountSeq = 0;
		var campusModule = null; // embed.js 模块缓存（mountWidgetById）
		var stopHostGeometry = null;
		var disposeNativeViewReturn = null;
		var hostThemeObserver = null;

		function ensureHost() {
			return hostEl && hostEl.isConnected ? hostEl : null;
		}

		function firstLaidOutChild(slot) {
			if (!slot) return null;
			for (var i = 0; i < slot.children.length; i++) {
				var child = slot.children[i];
				var rect = child.getBoundingClientRect();
				if (rect.width > 0 && rect.height > 0) return child;
			}
			return null;
		}

		/**
		 * The renderer exposes every declared slot through a stable data-slot anchor.
		 * `conversation.session` lives inside the native scroll body, directly below
		 * the header tabs. Its parent is therefore the only region the campus panel
		 * may occupy: it automatically follows sidebar width and header height.
		 */
		function findCampusRegion() {
			var sessionSlot = document.querySelector('[data-slot="conversation.session"]');
			if (sessionSlot && sessionSlot.parentElement) return sessionSlot.parentElement;
			return firstLaidOutChild(document.querySelector('[data-slot="conversation"]'));
		}

		function findConversationRoot() {
			return firstLaidOutChild(document.querySelector('[data-slot="conversation"]'));
		}

		function syncHostTheme() {
			if (!hostEl) return;
			hostEl.dataset.theme = document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light";
		}

		function syncHostGeometry() {
			var host = ensureHost();
			var region = findCampusRegion();
			var overlay = host && host.offsetParent;
			if (!host || !region || !overlay) return false;
			var regionRect = region.getBoundingClientRect();
			var overlayRect = overlay.getBoundingClientRect();
			if (!(regionRect.width > 0 && regionRect.height > 0)) return false;
			host.style.left = Math.round(regionRect.left - overlayRect.left) + "px";
			host.style.top = Math.round(regionRect.top - overlayRect.top) + "px";
			host.style.width = Math.round(regionRect.width) + "px";
			host.style.height = Math.round(regionRect.height) + "px";
			return true;
		}

		function stopGeometrySync() {
			if (stopHostGeometry) {
				stopHostGeometry();
				stopHostGeometry = null;
			}
		}

		function startGeometrySync() {
			stopGeometrySync();
			if (!syncHostGeometry()) return false;
			var observedRegion = findCampusRegion();
			var observedRoot = findConversationRoot();
			var frame = null;
			var observer = new ResizeObserver(function () { schedule(); });
			var mutation = new MutationObserver(function () { schedule(); });
			var schedule = function () {
				if (frame !== null) return;
				frame = window.requestAnimationFrame(function () {
					frame = null;
					var nextRegion = findCampusRegion();
					if (nextRegion !== observedRegion) {
						if (observedRegion) observer.unobserve(observedRegion);
						observedRegion = nextRegion;
						if (observedRegion) observer.observe(observedRegion);
					}
					syncHostGeometry();
				});
			};
			if (observedRegion) observer.observe(observedRegion);
			if (hostEl && hostEl.offsetParent) observer.observe(hostEl.offsetParent);
			if (observedRoot) mutation.observe(observedRoot, { childList: true, subtree: true });
			window.addEventListener("resize", schedule);
			stopHostGeometry = function () {
				window.removeEventListener("resize", schedule);
				observer.disconnect();
				mutation.disconnect();
				if (frame !== null) window.cancelAnimationFrame(frame);
			};
			return true;
		}

		function stopNativeViewReturn() {
			if (disposeNativeViewReturn) {
				disposeNativeViewReturn();
				disposeNativeViewReturn = null;
			}
		}

		/** Close only for a native view tab within the official session-header slot. */
		function installNativeViewReturn() {
			stopNativeViewReturn();
			var root = findConversationRoot();
			if (!root) return;
			var onClick = function (event) {
				if (!ui.active || !event.target || typeof event.target.closest !== "function") return;
				var tab = event.target.closest('[role="tab"]');
				if (!tab || !root.contains(tab)) return;
				var headerSlot = tab.closest('[data-slot="conversation.session.header"]');
				if (headerSlot && root.contains(headerSlot)) closeWidget();
			};
			root.addEventListener("click", onClick, true);
			disposeNativeViewReturn = function () { root.removeEventListener("click", onClick, true); };
		}

		function setOverlayHost(node) {
			if (node === hostEl) return;
			if (hostEl) {
				closeWidget();
				if (hostThemeObserver) hostThemeObserver.disconnect();
				hostThemeObserver = null;
			}
			hostEl = node || null;
			if (!hostEl) return;
			syncHostTheme();
			hostThemeObserver = new MutationObserver(syncHostTheme);
			hostThemeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
		}

		function CampusOverlayHost() {
			return react.createElement("div", { id: "jxl-campus-widgets-host", ref: setOverlayHost });
		}

		function closeWidget() {
			stopNativeViewReturn();
			stopGeometrySync();
			if (disposeLoading) { disposeLoading(); disposeLoading = null; }
			var mounted = panelEl && panelEl.querySelector(".jxl-widget-panel__stage > div[id]");
			if (mounted && campusModule && campusModule.unmountWidget) campusModule.unmountWidget(mounted);
			if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
			panelEl = null;
			// 每次打开都是全新挂载 → AuthProvider 重新拉登录态（登录只在小组件内发生）
			ui.active = null;
			ui.booting = false;
			ui.failed = false;
			uiEmit();
		}

		function openWidget(id) {
			var def = null;
			for (var i = 0; i < WIDGETS.length; i++) if (WIDGETS[i].id === id) def = WIDGETS[i];
			if (!def) return;
			if (ui.active === id && panelEl && panelEl.isConnected) return;
			closeWidget();

			var host = ensureHost();
			if (!host || !startGeometrySync()) {
				console.error("[jxl-campus] 官方校园覆盖层尚未就绪");
				return;
			}
			installNativeViewReturn();
			var stageId = "jxl-widget-" + id + "-" + ++mountSeq;

			panelEl = document.createElement("div");
			panelEl.className = "jxl-widget-panel";
			panelEl.setAttribute("data-widget", id);
			panelEl.innerHTML =
				'<div class="jxl-widget-panel__head">' +
				'<img class="jxl-widget-panel__logo" src="' + LOGO_URL + '" alt=""/>' +
				'<div class="jxl-widget-panel__titles">' +
				'<span class="jxl-widget-panel__title"></span>' +
				'<span class="jxl-widget-panel__desc"></span>' +
				"</div>" +
				'<button class="jxl-widget-panel__close" title="返回 Mochi 对话（ESC）">' +
				'<img src="' + LOGO_URL + '" alt=""/>返回 Mochi</button>' +
				"</div>" +
				'<div class="jxl-widget-panel__stage"><div id="' + stageId + '"></div>' +
				'<div class="jxl-widget-panel__booting"></div>' +
				"</div>";
			panelEl.querySelector(".jxl-widget-panel__title").textContent = def.title;
			panelEl.querySelector(".jxl-widget-panel__desc").textContent = def.desc;
			panelEl.querySelector(".jxl-widget-panel__close").addEventListener("click", closeWidget);
			host.appendChild(panelEl);
			disposeLoading = mochiBrand.mountLoading(panelEl.querySelector(".jxl-widget-panel__booting"), "Mochi 正在打开" + def.title);

			ui.active = id;
			ui.booting = true;
			ui.failed = false;
			uiEmit();

			ensureCampusCss();
			var bootError = function (err) {
				if (!document.getElementById(stageId)) return;
				console.error("[jxl-campus] 小组件加载失败", err);
				ui.booting = false;
				ui.failed = true;
				uiEmit();
				var stage = panelEl && panelEl.querySelector(".jxl-widget-panel__stage");
				if (!stage) return;
				var old = stage.querySelector(".jxl-widget-panel__booting");
				if (disposeLoading) { disposeLoading(); disposeLoading = null; }
				if (old) old.remove();
				var msg = document.createElement("div");
				msg.className = "jxl-widget-panel__error";
				msg.textContent = "「" + def.title + "」加载失败：请确认 campus.nosync 已构建，且 wrangler dev @8787 已启动";
				stage.appendChild(msg);
			};

			var mount = function (m) {
				// 面板在 await 期间可能已被用户关闭
				if (!panelEl || !panelEl.isConnected || ui.active !== id || !document.getElementById(stageId)) return;
				var stage = document.getElementById(stageId);
				if (!stage) return bootError(new Error("stage 容器丢失"));
				var ok = m && typeof m.mountWidgetById === "function" ? m.mountWidgetById(id, stageId) : false;
				if (!ok) return bootError(new Error("mountWidgetById 返回 false"));
				ui.booting = false;
				ui.failed = false;
				uiEmit();
				var booting = panelEl.querySelector(".jxl-widget-panel__booting");
				if (disposeLoading) { disposeLoading(); disposeLoading = null; }
				if (booting) booting.remove();
			};

			if (campusModule) {
				try {
					mount(campusModule);
				} catch (e) {
					bootError(e);
				}
				return;
			}
			import("/campus/assets/embed.js")
				.then(function (m) {
					campusModule = m;
					mount(m);
				})
				.catch(bootError);
		}
		//#endregion

		//#region ESC 关闭（小组件面板打开时）
		function installEsc() {
			var onMochiClose = function () { closeWidget(); };
			var onKeyDown = function (e) {
				if (e.key === "Escape" && ui.active) closeWidget();
			};
			window.addEventListener("mochi:close-campus", onMochiClose);
			document.addEventListener("keydown", onKeyDown);
			return function () {
				window.removeEventListener("mochi:close-campus", onMochiClose);
				document.removeEventListener("keydown", onKeyDown);
				closeWidget();
			};
		}
		//#endregion

		//#region 侧栏入口（官方 sidebar.footer.action list slot 内的一组校园工作）
		function activePhase(snapshot, widgetId) {
			if (!snapshot) return "";
			var separator = snapshot.indexOf(":");
			return separator > 0 && snapshot.slice(separator + 1) === widgetId
				? snapshot.slice(0, separator)
				: "";
		}

		function CampusIcon(props) {
			var shapes = CAMPUS_ICON_SHAPES[props.name] || [];
			return react.createElement(
				"svg",
				{
					className: "jxl-campus-entry__icon",
					viewBox: "0 0 24 24",
					fill: "none",
					"aria-hidden": true,
					focusable: "false",
				},
				shapes.map(function (shape, index) {
					return react.createElement(shape[0], Object.assign({ key: index }, shape[1]));
				})
			);
		}

		function WidgetEntry(props) {
			var snap = react.useSyncExternalStore(uiSubscribe, uiSnapshot);
			var phase = activePhase(snap, props.w.id);
			var active = phase !== "";
			var status = phase === "booting" ? "，正在打开"
				: phase === "failed" ? "，加载失败"
					: phase === "live" ? "，当前已打开" : "";
			return react.createElement(
				"button",
				{
					type: "button",
					className: "jxl-campus-entry" + (active ? " is-active is-" + phase : ""),
					title: props.w.title + " · " + props.w.desc,
					"aria-label": props.w.title + "，" + props.w.desc + status,
					"aria-current": active ? "page" : undefined,
					"data-state": phase || "idle",
					onClick: function () {
						if (active) closeWidget();
						else openWidget(props.w.id);
					},
				},
				react.createElement(CampusIcon, { name: props.w.icon }),
				react.createElement("span", { className: "jxl-campus-entry__label" }, props.w.title),
				react.createElement("span", { className: "jxl-campus-entry__state", "aria-hidden": true })
			);
		}

		function CampusWorkGroup(props) {
			var state = react.useSyncExternalStore(uiSubscribe, uiSnapshot);
			var activeId = state ? state.slice(state.indexOf(":") + 1) : "";
			var statePair = react.useState(true);
			var expanded = statePair[0];
			var setExpanded = statePair[1];
			var wide = props.wide !== false;
			return react.createElement(
				"section",
				{
					className: "jxl-campus-group" + (wide ? "" : " is-rail"),
					"aria-label": "校园工作",
					"data-active-widget": activeId || undefined,
				},
				wide ? react.createElement(
					"button",
					{
						type: "button",
						className: "jxl-campus-group__toggle",
						"aria-label": (expanded ? "收起" : "展开") + "校园工作入口",
						"aria-expanded": expanded,
						"aria-controls": CAMPUS_WORK_LIST_ID,
						onClick: function () { setExpanded(!expanded); },
					},
					react.createElement("img", { className: "jxl-campus-group__brand", src: LOGO_URL, alt: "" }),
					react.createElement("span", { className: "jxl-campus-group__title" }, "校园工作"),
					react.createElement(
						"svg",
						{ className: "jxl-campus-group__chevron", viewBox: "0 0 24 24", fill: "none", "aria-hidden": true, focusable: "false" },
						react.createElement("path", { d: "m6 9 6 6 6-6", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" })
					)
				) : null,
				react.createElement(
					"div",
					{
						id: CAMPUS_WORK_LIST_ID,
						className: "jxl-campus-group__links",
						role: "group",
						"aria-label": "校园工作入口",
						hidden: wide && !expanded ? true : undefined,
					},
					WIDGETS.map(function (widget) {
						return react.createElement(WidgetEntry, { key: widget.id, w: widget });
					})
				)
			);
		}
		//#endregion

		//#region apply（slot 注册）
		function apply(ctx) {
			injectStyles();
			ctx.effect(function () { return installEsc(); }, "jxl-campus: close controls");
			/* Exact official key: ui-workspace owns workspace.section.workspaces.
			 * zh-JXL falls through to zh for every other workspace key. */
			ctx.effect(function () {
				return ctx.locale.register("workspace", "zh-JXL", { "section.workspaces": "任务" });
			}, "jxl-campus: workspace locale");
			ctx.slots.inject("shell.overlay", function* () {
				yield ctx.slots.register(
					{ name: "shell.overlay", id: "jxl-campus-overlay", order: 10 },
					CampusOverlayHost
				);
			});
			ctx.slots.inject("sidebar.footer.action", function* () {
				yield ctx.slots.register(
					{ name: "sidebar.footer.action", id: "jxl-campus-work", order: 10 },
					CampusWorkGroup
				);
			});
		}
		//#endregion

		module.exports.apply = apply;
		module.exports.inject = ["slots", "locale"];
		return module.exports;
	}
});
