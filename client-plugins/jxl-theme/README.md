# jxl-theme —— 嘉行联主题桥 client 插件

> **status**: active（2026-09-12 更正：原文标注「（draft）」已过时——该插件已在打包白名单内并随包交付）

单一事实源：`styles/jxl-theme-bridge.css` 与 `styles/jxl-workspace.css`。
改 CSS 后运行：`node scripts/build-client.mjs` 重新生成 `client.js`。

## 它做什么

把嘉行联设计令牌（calm-tokens.css 原值，暗色用 `body[data-ds-dark-theme]` 钩子——
源码实证：`packages/client/ui-layout/src/client/theme-presenter.ts:14`）
映射到官方 Web UI 的 `--dsw-alias-*` 语义层。不改组件结构、不改 DOM、不引组件库。

## 激活契约验证（✅ 2026-09-12 已核实并接入）

> 本节原本是待验证清单。**结论：契约成立**——`jxl-theme` 已进 26 项打包白名单，并在 `apps/desktop/resources/mochi-web/runtime-profile.json` 中注册（多 profile 挂载），随包交付。以下步骤保留为历史记录。

`package.json` 里 `"dsh": {"client": {"entry": "client.js"}}` 是**假设的字段**，未核实。
按以下步骤验证（源码事实：web-app bundle patch 注释——"dsh.client rows are the
browser roster the modules node half scans into window.__DSH_BOOT__"）：

1. 读 `packages/client/modules/`（dsh-client-modules）源码，确认 node half 如何
   发现每个 client 行的浏览器 bundle（找 `client.js` / `dsh.client` / boot graph 相关）。
2. 若契约一致：把 jxl-theme 加进 `profiles/mochi-web/package.json` 的 link 依赖 +
   `cordis.patch.yml` 的 `insert:`（`- id: jxl-theme` / `name: jxl-theme`），
   重跑 `./mochi.sh --profile mochi-web --dump-config` 确认行在树上，
   再起 web 实测浏览器里 `<style id="jxl-theme-bridge">` 出现、暖米白画布生效。
3. 若契约不符（需要 Cordis 模块形态或官方构建管线）：改写 client.js 为对应形态；
   或退回 Electron `insertCSS` 兜底，slot 级 UI 延后。

## 兜底（永远可用）

Electron 主进程对加载官方 SPA 的 WebView 执行
`win.webContents.insertCSS(bridgeCss, { cssOrigin: "author" })`，
CSS 读 `styles/jxl-theme-bridge.css` 与 `styles/jxl-workspace.css`。此路不依赖 client 插件契约。
