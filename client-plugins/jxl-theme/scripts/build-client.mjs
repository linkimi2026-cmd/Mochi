#!/usr/bin/env node
// build-client.mjs —— 把主题插件自有样式内联为官方 ModuleLoader 注册形态的 client.js
// 单一事实源 = styles/；本脚本只做内联与包装，禁止在生成文件里手工同步。
// bundle 形态对照：@deepseek-ai/dsh-client-ui-brand-official（官方源码实证，2026-09-04）。
import { readFileSync, writeFileSync } from "node:fs";

const BRIDGE_PATH = new URL("../styles/jxl-theme-bridge.css", import.meta.url);
const WORKSPACE_PATH = new URL("../styles/jxl-workspace.css", import.meta.url);
const ICON_PATH = new URL("../assets/icons/icon.svg", import.meta.url);
// 注意：输出到包根（scripts/ 的上一级），不是脚本所在目录。
const OUT_PATH = new URL("../client.js", import.meta.url);

const css = readFileSync(BRIDGE_PATH, "utf8") + "\n" + readFileSync(WORKSPACE_PATH, "utf8");
// favicon = 嘉行联正式图标（联动计划/public/icons/icon.svg 复制件，内联零请求）
const faviconSvg = readFileSync(ICON_PATH, "utf8");
const faviconUri = "data:image/svg+xml," + encodeURIComponent(faviconSvg);

const body = [
  `var css = ${JSON.stringify(css)};`,
  `var FAVICON = ${JSON.stringify(faviconUri)};`,
  `var TITLE = ${JSON.stringify("嘉行联 · Mochi")};`,
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
].join("\n");

const client = `window.__ModuleLoader__.load({
	id: "jxl-theme",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		/** 必需服务：无（纯文档层注入）。 */
		const inject = [];
		/** 注入嘉行联皮肤 + 文档 chrome。 */
		function apply(ctx) {
${body
  .split("\n")
  .map((l) => "\t\t\t" + l)
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
