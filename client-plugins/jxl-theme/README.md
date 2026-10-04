# jxl-theme —— 嘉行联主题桥 client 插件

> **status**: active（2026-09-12 更正：原文标注「（draft）」已过时——该插件已在打包白名单内并随包交付）

单一事实源：`styles/jxl-theme-bridge.css`、`styles/jxl-workspace.css` 与 `styles/jxl-paper.css`。
改 CSS 后运行：`node scripts/build-client.mjs` 重新生成 `client.js`。

## 它做什么

把嘉行联设计令牌（calm-tokens.css 原值，暗色用 `body[data-ds-dark-theme]` 钩子——
源码实证：`packages/client/ui-layout/src/client/theme-presenter.ts:14`）
映射到官方 Web UI 的 `--dsw-alias-*` 语义层。不改宿主组件结构、不引组件库；背景切换只更新
`<html>` 的 Mochi data 属性和两个 CSS 自定义属性。

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
CSS 读 `styles/jxl-theme-bridge.css`、`styles/jxl-workspace.css` 与 `styles/jxl-paper.css`。此路不依赖 client 插件契约。

## Mochi 背景：直接对话切换

背景选择由同一条对话完成，不提供背景选择表单或子菜单。教师端和教室端都注册
`mochi_set_campus_background`，模型把自然语言映射到三个固定插画之一；工具不接受图片
网址、文件路径或任意 CSS。可对 Mochi 说：

- “换成校园漫游背景。”
- “我想看银杏林荫道。”
- “把背景恢复默认的水彩校园。”

当前值存在 `jxl-theme` 设置命名空间，浏览器端通过 DSH `settingsScope` 接收实时更新。
桌面教师端与教室端使用各自的 `DSH_HOME`，所以一端的选择不会覆盖另一端；在多人共用的
同一个教室端上，背景是这台设备的共享外观。

默认的嘉行联水彩校园保持不变；新增的“校园漫游”“银杏林荫道”从相邻的“联动计划”运行
插画复制，见 [`assets/campus/background-manifest.json`](assets/campus/background-manifest.json)。
该清单是选项、默认项和浏览器映射的唯一资源目录，也记录 SHA-256、源资源 ID 和“概念校园、非真实校景”的授权说明。新增图片都是 941×1672
竖图，背景用 `cover` 裁切并叠加浅色遮罩以保持对话内容可读；没有重新压缩或改绘资源。

修改 CSS 后运行 `node scripts/build-client.mjs` 生成 `client.js`；插件本地验证：
`npm test --prefix client-plugins/jxl-theme`。

## 2026-09-27 纸白工作台

`jxl-paper.css` 统一输入区、校园页面层级、原生对话框和 LAN 请求/确认区；`scripts/paper-runtime.mjs` 仅装饰原生提交状态和可信发送操作，并通过 DSH theme 服务保存三档外观。旋钮不创建第二套主题存储，原生窗口通过受限 appearance IPC 同步。发送反馈不清草稿、不标记送达、不触发请求。

悬浮列表使用纸质清单层级，正文不套多层圆角卡片；实体键帽只用于主要操作。无新增运行依赖。修改后运行 `npm run build --prefix client-plugins/jxl-theme`。

验证：`npm test --prefix client-plugins/jxl-theme`；`node apps/desktop/scripts/test-paper-ui.mjs` 在真实 Electron 中加载 LAN React 插件，但主题服务/网络是隔离夹具，不能代替完整宿主联调。`MOCHI_PAPER_EVIDENCE_DIR` 可保存截图。完整教师宿主已在隔离工作目录与锁定运行依赖中通过明暗切换、偏好重载、真实发送动效及模型会话回归；原工作目录的旧嵌套依赖仍有云端读取异常，不能据此宣称安装包验收完成。

音效：`scripts/mechanical-audio.mjs` 是主页面和原生窗口的唯一声源实现，构建时同时生成 `apps/desktop/electron/dsh/mechanical-audio.generated.ts`。仅在可信操作后打开 Web Audio；不监听文字内容、不逐字发声。设置中的音效按钮将本机开关保存到宿主 `jxl-theme.uiSound` 设置（不会随随机端口变化丢失），以布尔 IPC 同步原生窗口；静音立即停止在播声音。`scripts/render-sound-preview.mjs <path.wav>` 可离线生成同一声源的试听。

新增自动检查覆盖真实 Web Audio 节点、静音重载、窄屏、回执失败后可重试，以及延迟提交失败不重放进纸声。当前没有独立的“发送成功”音，提交状态不等于送达。

层级复审：外观和音效通过正式 settings.general.item / appearance shadowing 放回设置；侧栏不再放偏好旋钮。校园导航默认折叠，首页欢迎区去卡片、示例按需展开。教室消息的设备与帮助为独立次级内容层，带返回消息入口。
