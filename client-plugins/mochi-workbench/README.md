# Mochi Workbench

教师工作台是一个浏览器侧 Harness 插件。2026-09-06 起与 dsh-better-sidebar 合并：面板本体经 `ctx.betterSidebar.registerTab` 注册为侧边栏首位 tab（`mochi-workbench:panel`，single 实例），不再占用 `shell.overlay`；`conversation.session.header.actions` 槽位的「工作台」按钮通过 `openTab`（内容型 seed，面板折叠时自动展开）定向打开/聚焦该 tab。不会替换对话、原生详情栏或工具详情。

Office 入口只请求本机 `127.0.0.1:18100` 的 `mochi-office` 合同。只有健康响应同时确认 `engine.online` 和 `engine.callbackReachable`，且 `editor-config` 完整有效时，面板才加载 ONLYOFFICE 的官方 DocsAPI 脚本。离线或回调桥接未验证时只显示状态，绝不伪造可编辑文本。

老师可主动选择 PNG、JPEG 或 WebP 本地图像。插件在浏览器本地校验 15 MB、8192 像素边长和 2400 万像素上限，计算 SHA-256 后以其绑定素材和版本；框选以实际 `<img>` 渲染矩形为坐标面，不包含容器留白或 letterbox。完成框选后会生成本机 PNG 裁图，记录原图哈希、原始像素、裁剪像素和归一化边界。

老师点击“加入草稿和裁图”后，插件才使用当前会话的官方 `ConversationController.createDraftImages` 与 scoped `input.addImages` 把裁图加入原生草稿附件，并追加可复核上下文。操作不发送消息、不新建会话，也不覆盖已有草稿；会话或素材在注册期间变化时会拒绝并释放刚注册的临时附件。选择清除或面板关闭不会删除已加入原生草稿的附件。

跨域网页和 Office iframe 当前不读取内容或选区。ONLYOFFICE 后续可通过官方插件 SDK 的受控选区方法接入，届时仍复用当前模型与会话，不需要另建 API key。

当前 Office 文档 ID 只来自 `/health` 给出的 allowlist。此插件不启动 Office 服务、不配置密钥，也不直接调用文档内容或回调端点。
