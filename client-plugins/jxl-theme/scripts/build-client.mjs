#!/usr/bin/env node
// build-client.mjs —— 把主题插件自有样式内联为官方 ModuleLoader 注册形态的 client.js
// 单一事实源 = styles/；本脚本只做内联与包装，禁止在生成文件里手工同步。
// bundle 形态对照：@deepseek-ai/dsh-client-ui-brand-official（官方源码实证，2026-09-04）。
import { bindThemeSettings } from "./settings-bridge.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { petPalettes, petPaletteCss } from './pet-palettes.mjs';
import { createMechanicalAudio } from './mechanical-audio.mjs';
import { installSidebarLabels } from "./sidebar-runtime.mjs";
import { installPaperFeedback } from "./paper-runtime.mjs";

const BRIDGE_PATH = new URL("../styles/jxl-theme-bridge.css", import.meta.url);
const WORKSPACE_PATH = new URL("../styles/jxl-workspace.css", import.meta.url);
const ICON_PATH = new URL("../assets/icons/icon.svg", import.meta.url);
const BACKGROUND_MANIFEST_PATH = new URL("../assets/campus/background-manifest.json", import.meta.url);
// 注意：输出到包根（scripts/ 的上一级），不是脚本所在目录。
const OUT_PATH = new URL("../client.js", import.meta.url);

const css = [BRIDGE_PATH, WORKSPACE_PATH, new URL("../styles/jxl-paper.css", import.meta.url), new URL("../styles/mochi-controls.css", import.meta.url)]
  .map((path) => readFileSync(path, "utf8")).join("\n") + "\n" + petPaletteCss;
const backgroundManifest = JSON.parse(readFileSync(BACKGROUND_MANIFEST_PATH, "utf8"));
const campusBackgrounds = backgroundManifest.backgrounds.map(({ id, asset, position }) => ({
  id,
  url: asset ? `/jxl-assets/campus/${asset}` : null,
  position,
}));
// favicon = 嘉行联正式图标（联动计划/public/icons/icon.svg 复制件，内联零请求）
const faviconSvg = readFileSync(ICON_PATH, "utf8");
const faviconUri = "data:image/svg+xml," + encodeURIComponent(faviconSvg);

const body = [
  `var settings = (${bindThemeSettings.toString()})(ctx, serviceName);`,
  `(${installSidebarLabels.toString()})(ctx);`,
  `(${installPaperFeedback.toString()})(ctx, require("react"), ${createMechanicalAudio.toString()}, ${JSON.stringify(petPalettes)}, settings);`,
  `var css = ${JSON.stringify(css)};`,
  `var FAVICON = ${JSON.stringify(faviconUri)};`,
  `var TITLE = ${JSON.stringify("Mochi")};`,
  `var CAMPUS_BACKGROUNDS = ${JSON.stringify(campusBackgrounds)};`,
  `var CAMPUS_BACKGROUND_DEFAULT = ${JSON.stringify(backgroundManifest.defaultBackground)};`,
  // 1) 主题桥样式（幂等）
  "if (!document.getElementById('jxl-theme-bridge')) {",
  "  var el = document.createElement('style');",
  "  el.id = 'jxl-theme-bridge';",
  "  el.textContent = css;",
  "  document.head.appendChild(el);",
  "}",
  // 2) 文档主权：标题 + favicon（SPA 后续改标题则由 MutationObserver 夺回）
  "try {",
  "  var link = document.querySelector(\"link[rel*='icon']\");",
  "  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }",
  "  link.href = FAVICON;",
  "  var setTitle = function () { if (document.title !== TITLE) document.title = TITLE; };",
  "  setTitle();",
  "  new MutationObserver(setTitle).observe(document.head, { childList: true, subtree: true, characterData: true });",
  "} catch (e) { /* 环境异常不阻断启动 */ }",
  // Host-side tool writes this settings namespace; the browser scope receives
  // commits live and persists separately in each role's DSH_HOME.
  "try {",
  "  var campusScope = settings;",
  "  var applyCampusBackground = function () {",
  "    var value = campusScope.getSnapshot().value;",
  "    var id = CAMPUS_BACKGROUNDS.some(function (item) { return item.id === (value && value.campusBackground); }) ? value.campusBackground : CAMPUS_BACKGROUND_DEFAULT;",
  "    var background = CAMPUS_BACKGROUNDS.find(function (item) { return item.id === id; });",
  "    if (!background) return;",
  "    var root = document.documentElement;",
  "    if (root.dataset.jxlCampusBackground !== id) {",
  "      root.dataset.jxlCampusBackground = id;",
  "    }",
  "    root.style.setProperty('--jxl-campus-background-image', background.url ? 'url(\"' + background.url + '\")' : 'none');",
  "    root.style.setProperty('--jxl-campus-background-position', background.position);",
  "  };",
  "  ctx.effect(function () {",
  "    var unsubscribe = campusScope.subscribe(applyCampusBackground);",
  "    applyCampusBackground();",
  "    return unsubscribe;",
  "  }, 'jxl-theme: live campus background');",
  "} catch (e) { /* settings bridge unavailable: keep the embedded paper default */ }",
].join("\n");

const client = `window.__ModuleLoader__.load({
	id: "jxl-theme",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		/** Required services: Host-backed background settings. */
		const inject = ["remote"];
		/** 注入嘉行联皮肤 + 文档 chrome。 */
		function apply(ctx) {
      let mounted = false;
      const mount = (child, serviceName) => {
        if (mounted) return;
        mounted = true;
        child.effect(() => () => { mounted = false; });
        install(child, serviceName);
      };
      ctx.inject(["settingsScope"], child => mount(child, "settingsScope"));
      ctx.inject(["configForms"], child => mount(child, "configForms"));
    }
    function install(ctx, serviceName) {
${body
  .split("\n")
  .map((l) => l.trim() ? "\t\t\t" + l : "")
  .join("\n")}
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
`;

writeFileSync(OUT_PATH, client);
console.log("client.js written, bytes:", client.length);

// Native HTML windows use the same procedural audio implementation.
writeFileSync(new URL('../../../apps/desktop/electron/dsh/mechanical-audio.generated.ts', import.meta.url),
  '// Generated by jxl-theme/scripts/build-client.mjs. Edit mechanical-audio.mjs.\nexport const MECHANICAL_AUDIO_SOURCE = ' + JSON.stringify(createMechanicalAudio.toString()) + ';\n');

// The same button tokens and states in standalone Electron documents.
writeFileSync(new URL('../../../apps/desktop/electron/dsh/controls.generated.ts', import.meta.url),
  '// Generated by jxl-theme/scripts/build-client.mjs. Edit styles/mochi-controls.css.\nexport const MOCHI_CONTROLS_CSS = ' + JSON.stringify(readFileSync(new URL('../styles/mochi-controls.css', import.meta.url), 'utf8')) + ';\n');

writeFileSync(new URL('../../../apps/desktop/electron/dsh/pet-palettes.generated.ts', import.meta.url),
  '// Generated from jxl-theme/assets/mochi-palettes.json.\nexport const PET_PALETTES = ' + JSON.stringify(petPalettes) + ' as const;\nexport type PetPaletteId = typeof PET_PALETTES[number]["id"];\nexport function isPetPalette(value: unknown): value is PetPaletteId { return PET_PALETTES.some(p => p.id === value); }\nexport const MOCHI_PET_CSS = ' + JSON.stringify(petPaletteCss) + ';\n');
