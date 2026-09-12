# Mochi Workbench

教师工作台是一个浏览器侧 Harness 插件。它占用两个官方槽位：`conversation.session.header.actions` 里的模式胶囊（`对话 / 工作`）与工作台面板本体作为 `chat` 视图上的覆盖层。面板不再注册成侧边栏 tab，也不再注册独立会话视图。不会替换对话、原生详情栏或工具详情。

**对话模式与工作模式都是聊天界面。** 教师端只保留官方 `chat` 会话视图（`ui-trajectory` 已在补丁中整体关闭）：官方 `conversation.view` 槽按 `only: active.id` 一次只渲染一个 view，且 `renderSlot` 授权被 `children` 声明锁死（`ui-renderer`：`slot '<key>' is not declared by this entry's children`），所以自定义视图**无法**内嵌官方 chat 渲染。因此本插件不注册第二个视图——两种模式的差别只是工作台面板是否展开，对话始终可见、可输入。面板是 `position:fixed` 覆盖层（会话头只有 ~44px 高，`position:absolute` 会锚到 header 上），`z-index:30` 高于官方 `.composerSeat` 的 7。

模式切换走**官方缝**：`ui-conversation` 渲染会话头时把 `{ selectedView, selectView }` 作为 owner props 展开进 `conversation.session.header.actions` 的每个条目（renderer 按 `{...kit, ...injected, ...ownerProps}` 组装），插件用它把会话钉回 `chat`。旧的 DOM relay（`querySelectorAll` 找官方 tablist 再 `click`）已整体删除，不存在第二套机制。回合打开时自动展开面板（agent 开始干活），回合结束在教师未接管时自动收起。

Office 入口只请求本机 `127.0.0.1:18100` 的 `mochi-office` 合同。只有健康响应同时确认 `engine.online` 和 `engine.callbackReachable`，且 `editor-config` 完整有效时，面板才加载 ONLYOFFICE 的官方 DocsAPI 脚本。离线或回调桥接未验证时只显示状态，绝不伪造可编辑文本。

老师可主动选择 PNG、JPEG 或 WebP 本地图像。插件在浏览器本地校验 15 MB、8192 像素边长和 2400 万像素上限，计算 SHA-256 后以其绑定素材和版本；框选以实际 `<img>` 渲染矩形为坐标面，不包含容器留白或 letterbox。完成框选后会生成本机 PNG 裁图，记录原图哈希、原始像素、裁剪像素和归一化边界。

老师点击“加入草稿和裁图”后，插件才使用当前会话的官方 `ConversationController.createDraftImages` 与 scoped `input.addImages` 把裁图加入原生草稿附件，并追加可复核上下文。操作不发送消息、不新建会话，也不覆盖已有草稿；会话或素材在注册期间变化时会拒绝并释放刚注册的临时附件。选择清除或面板关闭不会删除已加入原生草稿的附件。

跨域网页和 Office iframe 当前不读取内容或选区。ONLYOFFICE 后续可通过官方插件 SDK 的受控选区方法接入，届时仍复用当前模型与会话，不需要另建 API key。

当前 Office 文档 ID 只来自 `/health` 给出的 allowlist。此插件不启动 Office 服务、不配置密钥，也不直接调用文档内容或回调端点。
