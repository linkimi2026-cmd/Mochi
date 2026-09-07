window.__ModuleLoader__.load({
	id: "jxl-brand",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region esbuild bundle（src/hero.tsx：真实 OrbCompanion + ExpressiveOrb）
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
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
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
		
		// src/hero.tsx
		var hero_exports = {};
		__export(hero_exports, {
		  CHAT_DICT: () => CHAT_DICT,
		  ExpressiveOrb: () => ExpressiveOrb,
		  HERO_DICT: () => HERO_DICT,
		  HeroMochi: () => HeroMochi,
		  JellyfishBrandMark: () => JellyfishBrandMark,
		  JellyfishWordmark: () => JellyfishWordmark,
		  OrbCompanion: () => OrbCompanion,
		  SKILLS: () => SKILLS,
		  SkillsRow: () => SkillsRow,
		  TRAJECTORY_DICT: () => TRAJECTORY_DICT,
		  injectCompanionStyles: () => injectCompanionStyles,
		  mountAvatar: () => mountAvatar,
		  mountCompanion: () => mountCompanion,
		  mountLoading: () => mountLoading,
		  renderAvatar: () => renderAvatar
		});
		module.exports = __toCommonJS(hero_exports);
		
		// ../../../联动计划/src/components/ExpressiveOrb.css
		var ExpressiveOrb_default = '.expressive-orb {\n  /* Caramel ball with cream eyes: warm, picture-book, on-palette. No\n     gradient body, no highlight \u2014 colour lives on the ball itself and is\n     lerped per frame by the component. */\n  --orb-eye: #fff6e6;\n  --orb-rim: rgb(255 246 230 / 14%);\n  --orb-shadow: rgb(69 88 78 / 18%);\n\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  inline-size: var(--orb-size, 48px);\n  block-size: var(--orb-size, 48px);\n  flex: none;\n  line-height: 0;\n}\n\n.expressive-orb__svg {\n  inline-size: 100%;\n  block-size: 100%;\n  overflow: visible;\n}\n\n/* Body fill is driven per frame (mood colour lerp). The hairline rim keeps\n   the dark ball legible on dark surfaces without acting as a highlight. */\n.expressive-orb__body {\n  stroke: var(--orb-rim);\n  stroke-width: 0.9;\n}\n\n/* Bottom inner shade only \u2014 weight, not a highlight. */\n.expressive-orb__depth {\n  opacity: 0.55;\n}\n\n.expressive-orb__shadow {\n  fill: var(--orb-shadow);\n}\n\n.expressive-orb__eye {\n  fill: var(--orb-eye);\n}\n\n/* Success settles warm and still; the reduced-motion path lands here too.\n   Still orbs keep a gentle CSS press so even the quiet ones feel alive. */\n.expressive-orb[data-still="true"] .expressive-orb__svg {\n  transform: none;\n  transition: transform 150ms ease;\n}\n\n.expressive-orb[data-still="true"]:active .expressive-orb__svg {\n  transform: scale(0.93);\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .expressive-orb__svg {\n    transform: none;\n  }\n}\n';
		
		// ../../../联动计划/src/components/OrbCompanion.css
		var OrbCompanion_default = "/* \u8868\u60C5\u7403\u5DE5\u4F5C\u53F0\u6A21\u7EC4\uFF1A\u7403 + \u5C0F\u7535\u8111\u3002\u52A8\u4F5C\u6A21\u7EC4\u501F\u81EA\u5F00\u6E90\u684C\u5BA0 Clawd\uFF08MIT\uFF09\uFF0C\n   \u672C\u4F53\u4E3A\u9879\u76EE\u81EA\u7ED8\u7126\u7CD6\u8272\u7CFB\u3002\u5168\u90E8\u52A8\u753B\u4E3A CSS keyframes\uFF0C\u65E0\u811A\u672C\u5FAA\u73AF\u3002 */\n\n.orb-companion {\n  position: relative;\n  display: inline-grid;\n  place-items: start center;\n}\n\n.orb-companion__orb {\n  position: relative;\n  z-index: 1;\n  display: block;\n  transform-origin: 50% 86%;\n}\n\n.orb-companion__laptop {\n  position: absolute;\n  bottom: 0;\n  left: 50%;\n  z-index: 2;\n  width: 78%;\n  transform: translateX(-50%);\n}\n\n.companion-float {\n  position: absolute;\n  display: none;\n}\n\n/* ---------- idle\uFF1A\u7403\u9759\u6B62\u547C\u5438\uFF08\u5F15\u64CE\u81EA\u5E26\uFF09\uFF0C\u7535\u8111\u9759\u7F6E ---------- */\n.orb-companion--idle .companion-laptop {\n  transform-origin: 50% 100%;\n  animation: companion-laptop-breathe 4.6s ease-in-out infinite;\n}\n\n/* ---------- thinking\uFF1A\u7403\u8868\u60C5\u7531\u5F15\u64CE\u9A71\u52A8\uFF0C\u53F3\u4E0A\u89D2\u5192\u6CE1\u6CE1 ---------- */\n.orb-companion--thinking .companion-float--think {\n  display: block;\n  top: -14%;\n  right: -22%;\n  width: 46%;\n  animation: companion-float-in 0.4s ease-out both;\n}\n.orb-companion--thinking .companion-float--think circle { animation: companion-bubble 1.8s ease-in-out infinite; }\n.orb-companion--thinking .companion-float--think circle:nth-child(2) { animation-delay: 0.3s; }\n.orb-companion--thinking .companion-float--think circle:nth-child(3) { animation-delay: 0.6s; }\n\n/* ---------- typing\uFF1A\u7403\u5DE6\u53F3\u6447\u6446\u6A21\u62DF\u6572\u952E\u76D8\uFF0C\u7535\u8111\u8F7B\u5FAE\u53CD\u5411\u70B9\u5934\uFF0C\u5C4F\u5E55\u5B57\u7B26\u95EA\u52A8 ---------- */\n.orb-companion--typing .orb-companion__orb { animation: companion-rock 0.92s ease-in-out infinite; }\n.orb-companion--typing .orb-companion__laptop { animation: companion-laptop-nudge 0.92s ease-in-out infinite; }\n.orb-companion--typing .companion-glyph { animation: companion-glyph-blink 1.15s steps(2, jump-none) infinite; }\n.orb-companion--typing .companion-glyph:nth-child(2) { animation-delay: 0.14s; }\n.orb-companion--typing .companion-glyph:nth-child(3) { animation-delay: 0.28s; }\n.orb-companion--typing .companion-glyph:nth-child(4) { animation-delay: 0.42s; }\n.orb-companion--typing .companion-glyph:nth-child(5) { animation-delay: 0.57s; }\n\n/* ---------- celebrate\uFF1A\u5F00\u5FC3\u8DF3 ---------- */\n.orb-companion--celebrate .orb-companion__orb { animation: companion-hop 0.72s cubic-bezier(0.22, 1, 0.36, 1) infinite; }\n.orb-companion--celebrate .orb-companion__laptop { animation: companion-laptop-hop 0.72s ease-in-out infinite; }\n\n/* ---------- alert\uFF1A\u60CA\u53F9\u6CE1\u6CE1 ---------- */\n.orb-companion--alert .companion-float--alert {\n  display: block;\n  top: -12%;\n  right: -18%;\n  width: 40%;\n  animation: companion-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;\n}\n.orb-companion--alert .orb-companion__orb { animation: companion-shiver 0.6s ease-in-out infinite; }\n\n/* ---------- sleep\uFF1A\u7403\u9759\u6B62\uFF08\u5F15\u64CE active=false\uFF09\uFF0CZzz \u6D6E\u52A8 ---------- */\n.orb-companion--sleep .orb-companion__orb { transform: scale(0.94); transition: transform 1.2s ease; }\n.orb-companion--sleep .companion-float--zzz {\n  display: block;\n  top: -16%;\n  right: -14%;\n  width: 44%;\n  animation: companion-zzz 2.6s ease-in-out infinite;\n}\n\n/* ---------- keyframes ---------- */\n@keyframes companion-rock {\n  0%, 100% { transform: rotate(5deg); }\n  50% { transform: rotate(-5deg); }\n}\n@keyframes companion-laptop-nudge {\n  0%, 100% { transform: translateX(-50%) rotate(-1.4deg); }\n  50% { transform: translateX(-50%) rotate(1.4deg); }\n}\n@keyframes companion-laptop-breathe {\n  0%, 100% { transform: translateY(0); }\n  50% { transform: translateY(0.8px); }\n}\n/* \u4F5C\u7528\u4E8E svg \u672C\u4F53\uFF08\u81EA\u5E26 translateX(-50%) \u5C45\u4E2D\uFF09\uFF0Ckeyframe \u5FC5\u987B\u4FDD\u7559\u5B83 */\n@keyframes companion-laptop-hop {\n  0%, 100% { transform: translateX(-50%) translateY(0); }\n  50% { transform: translateX(-50%) translateY(1.4px); }\n}\n@keyframes companion-glyph-blink {\n  0%, 100% { opacity: 0.25; }\n  50% { opacity: 1; }\n}\n@keyframes companion-bubble {\n  0%, 100% { opacity: 0.45; transform: translateY(0); }\n  50% { opacity: 1; transform: translateY(-1.5px); }\n}\n@keyframes companion-float-in {\n  from { opacity: 0; transform: translateY(4px) scale(0.9); }\n  to { opacity: 1; transform: translateY(0) scale(1); }\n}\n@keyframes companion-pop {\n  from { opacity: 0; transform: scale(0.4); }\n  to { opacity: 1; transform: scale(1); }\n}\n@keyframes companion-hop {\n  0%, 100% { transform: translateY(0) rotate(0deg); }\n  30% { transform: translateY(-14%) rotate(-4deg); }\n  55% { transform: translateY(0) rotate(0deg); }\n  75% { transform: translateY(-7%) rotate(3deg); }\n}\n@keyframes companion-shiver {\n  0%, 100% { transform: rotate(0deg); }\n  25% { transform: rotate(-2.6deg); }\n  75% { transform: rotate(2.6deg); }\n}\n@keyframes companion-zzz {\n  0% { opacity: 0; transform: translateY(3px); }\n  35% { opacity: 1; }\n  100% { opacity: 0; transform: translateY(-7px); }\n}\n\n/* ---------- \u51CF\u5F31\u52A8\u6001 ---------- */\n.orb-companion--still .orb-companion__orb,\n.orb-companion--still .orb-companion__laptop,\n.orb-companion--still .companion-glyph,\n.orb-companion--still .companion-float--think circle,\n.orb-companion--still .companion-float--zzz {\n  animation: none !important;\n}\n@media (prefers-reduced-motion: reduce) {\n  .orb-companion .orb-companion__orb,\n  .orb-companion .orb-companion__laptop,\n  .orb-companion .companion-glyph,\n  .orb-companion .companion-float--think circle,\n  .orb-companion .companion-float--zzz {\n    animation: none !important;\n  }\n}\n";
		
		// ../../../联动计划/src/components/ExpressiveOrb.tsx
		var import_react = require("react");
		var import_jsx_runtime = require("react/jsx-runtime");
		var MOOD_LABEL = {
		  idle: "\u5F85\u673A",
		  thinking: "\u6B63\u5728\u5904\u7406",
		  listening: "\u6B63\u5728\u8046\u542C",
		  speaking: "\u6B63\u5728\u56DE\u590D",
		  success: "\u5DF2\u5B8C\u6210",
		  alert: "\u9700\u8981\u7559\u610F"
		};
		var TUNING = {
		  idle: { open: 7.2, wide: 5.6, lift: 0, wobble: 0.03, wobbleSpeed: 0.55, breath: 3.8 },
		  thinking: { open: 5.2, wide: 5.6, lift: -2.6, wobble: 0.02, wobbleSpeed: 0.95, breath: 1.9 },
		  listening: { open: 8.6, wide: 6.1, lift: 0.6, wobble: 0.022, wobbleSpeed: 0.62, breath: 2.6 },
		  speaking: { open: 6.4, wide: 5.8, lift: 0, wobble: 0.034, wobbleSpeed: 0.85, breath: 2.1 },
		  success: { open: 4.2, wide: 5.4, lift: 1.6, wobble: 0.016, wobbleSpeed: 0.45, breath: 4.8 },
		  alert: { open: 7.6, wide: 6.8, lift: -1, wobble: 0.012, wobbleSpeed: 1.5, breath: 1.2 }
		};
		var MOOD_COLOR = {
		  idle: [160, 106, 50],
		  // 焦糖（基准色）
		  thinking: [111, 97, 76],
		  // 暗茶褐（沉下来、想事情）
		  listening: [185, 138, 78],
		  // 暖亮砂（睁大眼睛、亮半档）
		  speaking: [201, 145, 60],
		  // 亮琥珀（最亮、开口说话）
		  success: [168, 138, 64],
		  // 蜜金（灰一点、满足地静）
		  alert: [162, 79, 40]
		  // 赭棕（带一点红示警，仍在暖土带）
		};
		var GAZE_BIAS = {
		  idle: [0, 0],
		  thinking: [1.6, -2.4],
		  listening: [0, 0.6],
		  speaking: [0, 0],
		  success: [0, 1],
		  alert: [0, -1.4]
		};
		var BLINK_MIN_S = 2.6;
		var BLINK_MAX_S = 6.4;
		var BLINK_S = 0.16;
		var DOUBLE_BLINK_CHANCE = 0.18;
		function spring(pos, vel, target, k, damping) {
		  const v = (vel + (target - pos) * k) * damping;
		  return [pos + v, v];
		}
		function catmullRomClosed(pts) {
		  const n = pts.length;
		  const at = (i) => pts[(i % n + n) % n];
		  let d = `M ${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
		  for (let i = 0; i < n; i++) {
		    const p0 = at(i - 1);
		    const p1 = at(i);
		    const p2 = at(i + 1);
		    const p3 = at(i + 2);
		    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
		    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
		    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
		    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
		    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
		  }
		  return `${d} Z`;
		}
		function organicBlob(t, base, amp, speed, breath) {
		  const N = 10;
		  const pts = [];
		  for (let i = 0; i < N; i++) {
		    const a = i / N * Math.PI * 2;
		    const r = base * (1 + 0.014 * Math.sin(t * Math.PI * 2 / breath) + amp * Math.sin(t * speed + a * 2 + 0.8) + amp * 0.55 * Math.sin(t * speed * 1.63 + a * 3 + 2.1) + amp * 0.3 * Math.sin(t * speed * 2.31 + a * 5));
		    pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
		  }
		  return catmullRomClosed(pts);
		}
		function ExpressiveOrb({
		  size = 48,
		  mood = "idle",
		  active = true,
		  label,
		  className = "",
		  interactive = true
		}) {
		  const depthGradientId = `eob-${(0, import_react.useId)().replace(/[^a-zA-Z0-9]/g, "")}-depth`;
		  const [reduceMotion, setReduceMotion] = (0, import_react.useState)(false);
		  (0, import_react.useEffect)(() => {
		    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		    const onChange = () => setReduceMotion(mq.matches);
		    onChange();
		    mq.addEventListener("change", onChange);
		    return () => mq.removeEventListener("change", onChange);
		  }, []);
		  const still = !active || reduceMotion;
		  const tune = TUNING[mood];
		  const initialD = (0, import_react.useMemo)(
		    () => organicBlob(0, 42, tune.wobble, tune.wobbleSpeed, tune.breath),
		    // The path is fully driven by the rAF loop afterwards; this only paints
		    // the first frame before effects run (and the whole still pose).
		    // eslint-disable-next-line react-hooks/exhaustive-deps
		    []
		  );
		  const bodyRef = (0, import_react.useRef)(null);
		  const shadowRef = (0, import_react.useRef)(null);
		  const squashRef = (0, import_react.useRef)(null);
		  const faceRef = (0, import_react.useRef)(null);
		  const eyesRef = (0, import_react.useRef)(null);
		  const eyeLRef = (0, import_react.useRef)(null);
		  const eyeRRef = (0, import_react.useRef)(null);
		  const physics = (0, import_react.useRef)({
		    mood,
		    rx: tune.wide,
		    rxV: 0,
		    ry: tune.open,
		    ryV: 0,
		    lift: tune.lift,
		    liftV: 0,
		    gazeX: 0,
		    gazeXV: 0,
		    gazeY: 0,
		    gazeYV: 0,
		    gazeTarget: [0, 0],
		    nextGazeAt: 0,
		    amp: tune.wobble,
		    wobbleSpeed: tune.wobbleSpeed,
		    breath: tune.breath,
		    color: [...MOOD_COLOR[mood]],
		    blinkStart: -1,
		    blinkDouble: false,
		    nextBlinkAt: 1.4,
		    poke: 0,
		    pokeV: 0
		  });
		  (0, import_react.useEffect)(() => {
		    physics.current.mood = mood;
		  }, [mood]);
		  const handlePoke = () => {
		    const s = physics.current;
		    s.poke = 1;
		    s.gazeTarget = [0, 2.2];
		    s.nextGazeAt = performance.now() / 1e3 + 1.4;
		  };
		  const pokeHandlers = interactive && !still ? {
		    onPointerDown: handlePoke,
		    onKeyDown: (event) => {
		      if (event.key === "Enter" || event.key === " ") handlePoke();
		    }
		  } : {};
		  (0, import_react.useEffect)(() => {
		    const s = physics.current;
		    const body = bodyRef.current;
		    const shadow = shadowRef.current;
		    const squash = squashRef.current;
		    const face = faceRef.current;
		    const eyes = eyesRef.current;
		    const eyeL = eyeLRef.current;
		    const eyeR = eyeRRef.current;
		    if (!body || !shadow || !squash || !face || !eyes || !eyeL || !eyeR) return;
		    const writeFrame = (now, animate) => {
		      const t = TUNING[s.mood];
		      let bs = 0;
		      if (animate) {
		        if (s.blinkStart < 0 && now >= s.nextBlinkAt) {
		          s.blinkStart = now;
		          s.blinkDouble = Math.random() < DOUBLE_BLINK_CHANCE;
		        }
		        if (s.blinkStart >= 0) {
		          const p = (now - s.blinkStart) / BLINK_S;
		          if (p >= 1) {
		            s.blinkStart = -1;
		            s.nextBlinkAt = now + (s.blinkDouble ? 0.24 : BLINK_MIN_S + Math.random() * (BLINK_MAX_S - BLINK_MIN_S));
		          } else {
		            bs = Math.sin(Math.PI * p);
		          }
		        }
		      }
		      if (animate && now >= s.nextGazeAt) {
		        const bias = GAZE_BIAS[s.mood];
		        s.gazeTarget = [
		          (Math.random() * 2 - 1) * 4.6 + bias[0],
		          (Math.random() * 2 - 1) * 2.2 + bias[1]
		        ];
		        s.nextGazeAt = now + 2.2 + Math.random() * 2.6;
		      }
		      if (animate) {
		        [s.rx, s.rxV] = spring(s.rx, s.rxV, t.wide, 0.016, 0.86);
		        [s.ry, s.ryV] = spring(s.ry, s.ryV, t.open, 0.016, 0.86);
		        [s.lift, s.liftV] = spring(s.lift, s.liftV, t.lift, 0.016, 0.86);
		        [s.gazeX, s.gazeXV] = spring(s.gazeX, s.gazeXV, s.gazeTarget[0], 0.012, 0.9);
		        [s.gazeY, s.gazeYV] = spring(s.gazeY, s.gazeYV, s.gazeTarget[1], 0.012, 0.9);
		        s.amp += (t.wobble - s.amp) * 0.07;
		        s.wobbleSpeed += (t.wobbleSpeed - s.wobbleSpeed) * 0.07;
		        s.breath += (t.breath - s.breath) * 0.04;
		        const tc = MOOD_COLOR[s.mood];
		        for (let i = 0; i < 3; i++) s.color[i] += (tc[i] - s.color[i]) * 0.065;
		        [s.poke, s.pokeV] = spring(s.poke, s.pokeV, 0, 0.05, 0.82);
		      }
		      const poke = Math.max(-0.5, Math.min(1, s.poke));
		      body.setAttribute("d", organicBlob(now, 42 * (1 - 0.035 * Math.max(0, poke)), s.amp, s.wobbleSpeed, s.breath));
		      const glow = 26 * Math.max(0, poke);
		      const [r0, g0, b0] = s.color;
		      body.setAttribute(
		        "fill",
		        `rgb(${Math.min(255, Math.round(r0 + glow))} ${Math.min(255, Math.round(g0 + glow))} ${Math.min(255, Math.round(b0 + glow))})`
		      );
		      shadow.setAttribute("rx", (25 * (1 + 0.012 * Math.sin(now * Math.PI * 2 / s.breath))).toFixed(2));
		      const tilt = animate ? 1.1 * Math.sin(now * 0.32 + 1.3) : 0;
		      squash.setAttribute(
		        "transform",
		        `translate(50 50) rotate(${tilt.toFixed(2)}) scale(${(1 + 0.055 * poke + 0.03 * bs).toFixed(4)} ${(1 - 0.09 * poke - 0.05 * bs).toFixed(4)}) translate(-50 -50)`
		      );
		      face.setAttribute("transform", `translate(50 ${(52 + s.lift + 2.2 * Math.max(0, poke)).toFixed(2)})`);
		      eyes.setAttribute(
		        "transform",
		        `translate(${s.gazeX.toFixed(2)} ${s.gazeY.toFixed(2)}) scale(1 ${((1 - 0.93 * bs) * (1 - 0.45 * Math.max(0, poke))).toFixed(3)})`
		      );
		      for (const eye of [eyeL, eyeR]) {
		        eye.setAttribute("rx", (s.rx * (1 + 0.15 * Math.max(0, poke))).toFixed(2));
		        eye.setAttribute("ry", s.ry.toFixed(2));
		      }
		    };
		    if (still) {
		      s.blinkStart = -1;
		      writeFrame(0, false);
		      return;
		    }
		    let raf = 0;
		    const loop = (nowMs) => {
		      writeFrame(nowMs / 1e3, true);
		      raf = requestAnimationFrame(loop);
		    };
		    raf = requestAnimationFrame(loop);
		    return () => cancelAnimationFrame(raf);
		  }, [still]);
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		    "span",
		    {
		      className: `expressive-orb expressive-orb--${mood}${className ? ` ${className}` : ""}`,
		      "data-mood": mood,
		      "data-still": still ? "true" : "false",
		      style: { "--orb-size": `${size}px` },
		      role: label ? "img" : void 0,
		      "aria-label": label ? `${label}\uFF08${MOOD_LABEL[mood]}\uFF09` : void 0,
		      "aria-hidden": label ? void 0 : true,
		      ...pokeHandlers,
		      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 100 100", className: "expressive-orb__svg", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("radialGradient", { id: depthGradientId, cx: "50%", cy: "122%", r: "78%", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("stop", { offset: "0%", stopColor: "#000000", stopOpacity: "0.22" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("stop", { offset: "60%", stopColor: "#000000", stopOpacity: "0" })
		        ] }) }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { ref: shadowRef, cx: "50", cy: "93.5", rx: "25", ry: "4.2", className: "expressive-orb__shadow" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { ref: squashRef, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { ref: bodyRef, d: initialD, className: "expressive-orb__body" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: "50", cy: "50", r: "41", fill: `url(#${depthGradientId})`, className: "expressive-orb__depth" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("g", { ref: faceRef, transform: "translate(50 52)", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { ref: eyesRef, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { ref: eyeLRef, cx: -11, cy: 0, rx: 5.6, ry: 7.2, className: "expressive-orb__eye" }),
		            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ellipse", { ref: eyeRRef, cx: 11, cy: 0, rx: 5.6, ry: 7.2, className: "expressive-orb__eye" })
		          ] }) })
		        ] })
		      ] })
		    }
		  );
		}
		
		// src/shims/motion-react.ts
		var import_react2 = require("react");
		var QUERY = "(prefers-reduced-motion: reduce)";
		function useReducedMotion() {
		  const [reduce, setReduce] = (0, import_react2.useState)(
		    () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : false
		  );
		  (0, import_react2.useEffect)(() => {
		    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		    const mq = window.matchMedia(QUERY);
		    const onChange = () => setReduce(mq.matches);
		    mq.addEventListener("change", onChange);
		    return () => mq.removeEventListener("change", onChange);
		  }, []);
		  return reduce;
		}
		
		// ../../../联动计划/src/components/OrbCompanion.tsx
		var import_jsx_runtime2 = require("react/jsx-runtime");
		var MOOD_BY_STATE = {
		  idle: "idle",
		  thinking: "thinking",
		  typing: "idle",
		  celebrate: "success",
		  alert: "alert",
		  sleep: "idle"
		};
		function OrbCompanion({ state = "idle", size = 64, mood, label }) {
		  const reduceMotion = useReducedMotion();
		  const orbMood = mood ?? MOOD_BY_STATE[state];
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
		    "span",
		    {
		      "aria-label": label,
		      className: `orb-companion orb-companion--${state}${reduceMotion ? " orb-companion--still" : ""}`,
		      "data-state": state,
		      role: label ? "img" : "presentation",
		      style: { width: size, height: Math.round(size * 1.22) },
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "orb-companion__orb", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ExpressiveOrb, { active: state !== "sleep" && !reduceMotion, mood: orbMood, size }) }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { "aria-hidden": "true", className: "orb-companion__laptop", viewBox: "24 10 72 54", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ellipse", { className: "companion-shadow", cx: "60", cy: "58", fill: "rgba(46,26,10,0.15)", rx: "36", ry: "3.6" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("g", { className: "companion-laptop", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { className: "companion-laptop__screen", fill: "#4A3826", height: "37", rx: "5", width: "54", x: "33", y: "11" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { fill: "#2E2318", height: "30", rx: "3", width: "48", x: "36", y: "14.5" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("g", { className: "companion-laptop__glyphs", fill: "#FFE7C2", children: [
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { className: "companion-glyph", height: "2.8", rx: "1.4", width: "11", x: "40", y: "20" }),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { className: "companion-glyph", height: "2.8", rx: "1.4", width: "16", x: "40", y: "26.5" }),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { className: "companion-glyph", height: "2.8", rx: "1.4", width: "7", x: "40", y: "33" }),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { className: "companion-glyph", height: "2.8", rx: "1.4", width: "12", x: "60", y: "26.5" }),
		              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { className: "companion-glyph", height: "2.8", rx: "1.4", width: "8", x: "60", y: "33" })
		            ] }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M26 52.5 L94 52.5 L87 49.5 L33 49.5 Z", fill: "#6B4E33" }),
		            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { fill: "#7A5C3E", height: "3.6", rx: "1.8", width: "70", x: "25", y: "51.1" })
		          ] })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { "aria-hidden": "true", className: "companion-float companion-float--think", viewBox: "0 0 60 48", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "14", cy: "40", fill: "var(--surface-strong, #FFF6E8)", opacity: "0.9", r: "4.5" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "27", cy: "28", fill: "var(--surface-strong, #FFF6E8)", opacity: "0.75", r: "6.5" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "43", cy: "12", fill: "var(--surface-strong, #FFF6E8)", opacity: "0.6", r: "9" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { "aria-hidden": "true", className: "companion-float companion-float--alert", viewBox: "0 0 32 32", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "16", cy: "16", fill: "#E8B34B", opacity: "0.95", r: "14" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { fill: "#5B3A14", height: "13", rx: "2.2", width: "4.4", x: "13.8", y: "6" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "16", cy: "23.6", fill: "#5B3A14", r: "2.2" })
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { "aria-hidden": "true", className: "companion-float companion-float--zzz", viewBox: "0 0 48 40", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("text", { fill: "#B98A5C", fontFamily: "system-ui, sans-serif", fontSize: "11", fontWeight: "700", x: "4", y: "34", children: "z" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("text", { fill: "#B98A5C", fontFamily: "system-ui, sans-serif", fontSize: "15", fontWeight: "700", x: "18", y: "22", children: "Z" }),
		          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("text", { fill: "#B98A5C", fontFamily: "system-ui, sans-serif", fontSize: "19", fontWeight: "700", x: "32", y: "10", children: "Z" })
		        ] })
		      ]
		    }
		  );
		}
		
		// ../../../联动计划/src/components/MochiLoading.css
		var MochiLoading_default = '.mochi-loading { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px; color: var(--dsw-alias-label-secondary, var(--muted, #747c76)); font: 400 13px/1.5 "PingFang SC", sans-serif; }\n.mochi-loading__character { display: inline-flex; transform-origin: center bottom; animation: mochi-loading-hop 1.05s cubic-bezier(.22,.78,.24,1) infinite; }\n.mochi-loading--compact { padding: 0; gap: 0; vertical-align: middle; flex: none; }\n.mochi-loading__text { text-align: center; }\n/* \u6587\u5B57\u5C3E\u90E8\u7701\u7565\u53F7\u9010\u70B9\u6D6E\u73B0\uFF1A\u52A0\u8F7D\u4E2D\u4E0D\u53EA\u662F\u8DF3\u52A8\uFF0C\u6587\u5B57\u4E5F\u5728\u300C\u8BF4\u8BDD\u300D\uFF082026-09-05\uFF09\u3002 */\n.mochi-loading__text::after { content: "\u2026"; display: inline-block; overflow: hidden; vertical-align: bottom; width: 0; animation: mochi-loading-dots 1.5s steps(3, start) infinite; }\n@keyframes mochi-loading-dots { to { width: 1.25em; } }\n@keyframes mochi-loading-hop { 0%, 100% { transform: translateY(0) scale(1.025,.98); } 45% { transform: translateY(-6px) scale(.99,1.02); } 75% { transform: translateY(0) scale(1.025,.98); } }\n@media (prefers-reduced-motion: reduce) { .mochi-loading__character { animation: none; } .mochi-loading__text::after { animation: none; width: 1.25em; } }\n';
		
		// ../../../联动计划/src/components/MochiLoading.tsx
		var import_jsx_runtime3 = require("react/jsx-runtime");
		function MochiLoading({ text = "Mochi \u6B63\u5728\u51C6\u5907", compact = false }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: `mochi-loading${compact ? " mochi-loading--compact" : ""}`, role: "status", "aria-label": text, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mochi-loading__character", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(OrbCompanion, { state: "typing", size: compact ? 28 : 48 }) }),
		    !compact && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mochi-loading__text", children: text })
		  ] });
		}
		
		// src/hero.tsx
		var import_client = require("react-dom/client");
		var import_jsx_runtime4 = require("react/jsx-runtime");
		function mountLoading(el, text, compact = false) {
		  injectCompanionStyles();
		  const root = (0, import_client.createRoot)(el);
		  root.render(/* @__PURE__ */ (0, import_jsx_runtime4.jsx)(MochiLoading, { text, compact }));
		  return () => root.unmount();
		}
		function mountCompanion(el, state, text, size = 30) {
		  injectCompanionStyles();
		  const root = (0, import_client.createRoot)(el);
		  root.render(/* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OrbCompanion, { state, size, label: text }));
		  return () => root.unmount();
		}
		function mountAvatar(el) {
		  injectCompanionStyles();
		  const row = document.createElement("div");
		  row.className = "jxl-msg-avatar-row";
		  const mount = document.createElement("span");
		  mount.className = "jxl-msg-avatar-mount";
		  const status = document.createElement("span");
		  status.className = "jxl-msg-avatar-status";
		  row.appendChild(mount);
		  row.appendChild(status);
		  el.insertBefore(row, el.firstChild);
		  const root = (0, import_client.createRoot)(mount);
		  renderAvatar(root, "idle");
		  row.__jxlAvatarRoot = root;
		}
		function renderAvatar(root, state) {
		  root.render(/* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OrbCompanion, { state, size: 26, label: "Mochi" }));
		}
		var SKILLS = [
		  { name: "\u6559\u5E08\u6668\u62A5", desc: "\u8BFE\u95F4 30 \u79D2\u626B\u5B8C\u7684\u6821\u56ED\u6668\u62A5\uFF1A\u533B\u52A1\u5BA4\u3001\u5BBF\u820D\u3001\u901A\u77E5\u4E0E\u672A\u8BFB\u6D88\u606F\u6982\u51B5\u3002" },
		  { name: "\u5B66\u751F\u8DDF\u8FDB", desc: "\u6838\u5BF9\u5B66\u751F\u8FD1\u671F\u72B6\u6001\u3001\u6574\u7406\u8DDF\u8FDB\u91CD\u70B9\u3001\u8D77\u8349\u7ED9\u5BB6\u957F\u6216\u6821\u533B\u7684\u6C9F\u901A\u5185\u5BB9\u3002" },
		  { name: "\u73ED\u7EA7\u5468\u62A5", desc: "\u6C47\u603B\u4E00\u5468\u6D41\u52A8\u3001\u533B\u52A1\u3001\u5BBF\u820D\u4E0E\u6D88\u606F\u5904\u7406\uFF0C\u751F\u6210\u8868\u683C\u4E0E Word \u62A5\u544A\u3002" },
		  { name: "\u73ED\u4F1A\u5907\u8BFE", desc: "\u51C6\u5907\u73ED\u4F1A\u76EE\u6807\u3001\u5927\u7EB2\u3001\u8BB2\u7A3F\u4E0E\u8BFE\u4EF6\uFF0C\u5E76\u505A\u521B\u5EFA\u540E\u81EA\u68C0\u4FEE\u8BA2\u3002" },
		  { name: "\u6559\u5B66\u6750\u6599\u67E5\u627E", desc: "\u4ECE\u5DE5\u4F5C\u533A\u4E0E\u53EF\u7528\u8D44\u6599\u6E90\u5BFB\u627E\u3001\u7B5B\u9009\u5E76\u6574\u7406\u8BFE\u4EF6\u3001\u6559\u6848\u4E0E\u7D20\u6750\u3002" },
		  { name: "Mochi \u884C\u4E8B\u51C6\u5219", desc: "Mochi \u7684\u4EBA\u683C\u4E0E\u5E95\u7EBF\uFF1A\u5982\u5B9E\u62A5\u544A\u5DE5\u5177\u7ED3\u679C\uFF0C\u7EDD\u4E0D\u7F16\u9020\u6821\u56ED\u72B6\u6001\u3002" }
		];
		function SkillsRow() {
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "jxl-skills-row", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "jxl-skills-head", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "jxl-skills-title", children: "\u6280\u80FD" }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "jxl-skills-sub", children: "\u8001\u5E08\u5E38\u7528\u7684\u5DE5\u4F5C\u6280\u80FD \u2014\u2014 \u5BF9\u8BDD\u65F6\u8BF4\u51FA\u9700\u6C42\uFF0CMochi \u4F1A\u81EA\u52A8\u4F7F\u7528" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("ul", { className: "jxl-skills-list", children: SKILLS.map((s) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("li", { className: "jxl-skills-item", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "jxl-skills-name", children: s.name }),
		      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "jxl-skills-desc", children: s.desc })
		    ] }, s.name)) })
		  ] });
		}
		var AVATAR_CSS = `
		.jxl-msg-avatar-row{display:flex;align-items:flex-end;gap:8px;margin:2px 0 4px;}
		.jxl-msg-avatar-row .orb-companion{flex-shrink:0;}
		.jxl-msg-avatar-status{font-size:12px;letter-spacing:.02em;color:#9aa8a0;opacity:0;transition:opacity .25s ease;padding-bottom:8px;}
		.jxl-msg-avatar-row--busy .jxl-msg-avatar-status{opacity:1;}
		.jxl-msg-avatar-row--busy .jxl-msg-avatar-status::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#e8b34b;margin-right:6px;vertical-align:middle;animation:jxl-pulse 1.2s ease-in-out infinite;}
		@keyframes jxl-pulse{0%,100%{opacity:.4}50%{opacity:1}}
		@media (prefers-reduced-motion: reduce){.jxl-msg-avatar-row--busy .jxl-msg-avatar-status::before{animation:none}}
		.jxl-pending-mochi{display:flex;align-items:center;pointer-events:none;}
		.jxl-pending-mochi--flow{position:relative;z-index:1;align-self:center;flex:none;min-height:34px;margin:0 auto 4px;padding:0 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,var(--dsw-alias-border-l3));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-border-l3) 70%,transparent);}
		.jxl-pending-mochi--flow::after{content:"Mochi \u6B63\u5728\u5904\u7406";margin-left:6px;color:var(--dsw-alias-label-secondary,#747c76);font:500 12px/1.2 system-ui,sans-serif;letter-spacing:.01em;white-space:nowrap;}
		.jxl-pending-mochi--approval{justify-content:flex-end;margin:4px 16px 0;min-height:32px;}
		/* ApprovalPanel exposes data-approval-scroll; its first direct div is the native reason headline. */
		[data-approval-key] [data-approval-scroll] > div:first-child{white-space:pre-line;}
		.jxl-skills-row{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);}
		.jxl-skills-head{display:flex;flex-direction:column;gap:2px;}
		.jxl-skills-title{font-size:13px;font-weight:600;color:inherit;}
		.jxl-skills-sub{font-size:11.5px;color:#9aa8a0;}
		.jxl-skills-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;}
		.jxl-skills-item{display:flex;flex-direction:column;gap:1px;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,.03);}
		.jxl-skills-name{font-size:12.5px;font-weight:600;color:inherit;}
		.jxl-skills-desc{font-size:11.5px;line-height:1.5;color:#9aa8a0;}
		`;
		var ALL_CSS = ExpressiveOrb_default + "\n" + OrbCompanion_default + "\n" + MochiLoading_default + "\n" + AVATAR_CSS;
		function injectCompanionStyles() {
		  if (document.getElementById("jxl-companion-css")) return;
		  const el = document.createElement("style");
		  el.id = "jxl-companion-css";
		  el.textContent = ALL_CSS;
		  document.head.appendChild(el);
		}
		function HeroMochi({ size, className }) {
		  const s = Math.max(Number(size) || 34, 48);
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `${className ?? ""} jxl-hero-mark`, style: { display: "inline-flex", alignItems: "flex-end" }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(OrbCompanion, { state: "idle", size: s, label: "Mochi" }) });
		}
		function JellyfishBrandMark({ size, className }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		    "img",
		    {
		      src: "/jxl-assets/brand/jiaxing-jellyfish-v1.png",
		      alt: "",
		      "aria-hidden": true,
		      width: size,
		      height: size,
		      className,
		      style: { objectFit: "contain", flexShrink: 0 }
		    }
		  );
		}
		function JellyfishWordmark() {
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "jxl-brand-name", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
		    "\u5609\u884C\u8054 ",
		    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("i", { className: "jxl-brand-en", children: "JXL" })
		  ] }) });
		}
		var HERO_DICT = {
		  "hero.headline": "\u4F60\u597D\uFF0C\u6211\u662F Mochi",
		  "hero.preview": "\u6821\u56ED\u5DE5\u4F5C\u4F19\u4F34",
		  "hero.chooseWorkspace": "\u9009\u62E9\u5DE5\u4F5C\u533A"
		};
		var TRAJECTORY_DICT = {
		  "view.trajectory": "\u67E5\u770B\u5DE5\u4F5C\u8FC7\u7A0B"
		};
		var CHAT_DICT = {
		  "chat.deepDiving": "mochi\u63A2\u7D22\u4E2D"
		};
		
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
