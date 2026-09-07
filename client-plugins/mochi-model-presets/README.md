# Mochi 模型预填

这个浏览器插件把少量中文常用服务商放在 Harness 原生“设置 → 模型”页面的尾部。它不替代原生 `/model` 选择器、原生 API Key 编辑卡或模型目录。

卡片默认只显示服务商、套餐/区域区别、配置状态和“加入原生设置”。协议、端点、本机目录数量与 pi-ai 版本收在“连接详情”中，避免把教师的选择页面变成技术参数列表。

## 已确认的行为

- 每个“加入原生设置”按钮都先读取官方 `remote.settings.describe()`，确认 `llm-pi-ai.providers.<route>` 不存在，再以该命名空间的当前 revision 调用官方 `remote.settings.mutate()`。
- 写入值严格是 `{}`。这是 `llm-pi-ai` 已支持的 catalog route profile：端点、协议和模型目录仍由 pi-ai 的已安装目录提供，插件不维护第二份模型 ID 清单。
- 按钮不会写入或读取 API Key，不调用 `session.selectModel`，也不会发送模型请求。原生 Models 页面收到 settings invalidation 后自行显示官方编辑卡，用户可在那里填入密钥。
- 已有 profile、只读设置和 revision 冲突都不会被覆盖。状态只读取设置的脱敏视图及 credential 的 `configured` 布尔值。
- “模型目录”只表示本机 pi-ai 目录已存在。`密钥已保存；尚未实测连接` 与“已连接/实测可用”严格不同。

官方 `llm-pi-ai` 的 `discoverModels({ provider })` 对已安装 catalog route 会直接返回本机目录，设计上不会访问云端。因此它不能诚实地充当 API Key 或网络的“测试连接”。当前官方浏览器接口没有一个可读取已保存密钥、又能发出有界真实探针的独立接口；本插件不会伪造该测试，也不会额外要求用户重复输入密钥或发送付费提示词。

## 目录来源与维护

`scripts/build.mjs` 从 desktop runtime 已安装的 `@earendil-works/pi-ai` 读取以下事实并写进 `client.js`：pi-ai 版本、route id、provider 名、协议、端点及目录模型数。构建会拒绝 provider 源文件与 model catalog 的协议或端点不一致。

目前展示的 route：

- `zai`：Z.AI GLM Coding Plan（国际）
- `zai-coding-cn`：智谱 GLM Coding Plan（中国区）
- `moonshotai-cn`：Kimi API（月之暗面）
- `minimax-cn`：MiniMax API
- `deepseek`：DeepSeek 官方 API

智谱普通 API 和 GLM Coding Plan 使用不同 URL。普通 API 的官方快速开始列出 `https://api.z.ai/api/paas/v4`；本机 pi-ai 的 `zai` / `zai-coding-cn` 目录则是 Coding Plan 路线，不能把两者混称或互换密钥。普通 API 没有对应的已安装 catalog route，因而不在这里伪造自定义模型列表；需在原生“自定义提供方”中，在实际账号、模型 ID 与协议确认后配置。

本模块复用的成熟开源实现是 [earendil-works/pi](https://github.com/earendil-works/pi)（MIT）和 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）。厂商链接在每张卡片内，构建时保留为可审计元数据：

- [Z.AI GLM Coding Plan](https://docs.z.ai/devpack/quick-start) 与 [Z.AI 普通 API](https://docs.z.ai/guides/overview/quick-start)
- [智谱 GLM Coding Plan 中国区](https://docs.bigmodel.cn/cn/coding-plan/quick-start)
- [Kimi API](https://platform.kimi.com/docs/get-api-key)
- [MiniMax Anthropic API](https://platform.minimaxi.com/document/Anthropic_API)
- [DeepSeek API](https://api-docs.deepseek.com/)

## 验证

```sh
cd client-plugins/mochi-model-presets
pnpm test
```

测试会重建 bundle，并验证：目录事实来自本机 pi-ai、没有 model ID 副本、只在显式点击后执行 revision-fenced `{}` mutation、已有 profile 不覆盖、只读/失败状态正确、官方 `settings.models.footer` 与 `settings.models.provider-card` 槽为追加注册。
