# Mochi 模型预填

这个浏览器插件把少量中文常用服务商放在 Harness 原生“设置 → 模型”页面的尾部。它不替代原生 `/model` 选择器、原生 API Key 编辑卡或模型目录。

卡片默认只显示服务商、套餐/区域区别、配置状态和“加入原生设置”。协议、端点、本机目录数量与 pi-ai 版本收在“连接详情”中，避免把教师的选择页面变成技术参数列表。

## 已确认的行为

- 每个“加入原生设置”按钮都先读取官方 `remote.settings.describe()`，确认 `llm-pi-ai.providers.<route>` 不存在，再以该命名空间的当前 revision 调用官方 `remote.settings.mutate()`。
- 写入值严格是 `{}`。这是 `llm-pi-ai` 已支持的 catalog route profile：端点、协议和模型目录仍由 pi-ai 的已安装目录提供，插件不维护第二份模型 ID 清单。
- 按钮不会写入或读取 API Key，不调用 `session.selectModel`，也不会发送模型请求。原生 Models 页面收到 settings invalidation 后自行显示官方编辑卡，用户可在那里填入密钥。
- 已有 profile、只读设置和 revision 冲突都不会被覆盖。状态只读取设置的脱敏视图及 credential 的 `configured` 布尔值。
- “模型目录”只表示本机 pi-ai 目录已存在。`密钥已保存；尚未实测连接` 与“已连接/实测可用”严格不同。

MiMo 卡片从 `mochi-llm-mimo` 的 `baseURL` 显示当前有效服务地址的 origin（scheme、hostname、port），标注路由 `mochi-mimo`。路径、查询、片段和 URL 用户信息不会渲染；配置缺失、无效或读取失败时显示固定不可读提示，不猜测默认地址。服务地址 override 仍由原生模型编辑卡修改；本卡的空白占位不代表实际地址。

MiMo 卡片提供“测试 MiMo 连接”，复用 Host 已认证的 `POST /api/mochi-doctor/check-model`。浏览器只发送固定空 JSON `{}`，请求使用当前教室会话凭据；密钥仍由 Host 从本机凭据库读取，客户端不接触密钥。此端点只对内置 MiMo 路线的首个目录模型发送最多 1 个 token 的探针，不代表每个已选模型。每次手动测试都会发出一次真实请求，可能产生少量费用。请先保存新密钥再测试；输入框有未保存草稿时测试按钮禁用。

MiMo Key 配置后可显式点击“设为新对话默认模型”。卡片展示原生 `agent-default-model` 当前的 provider/model；写入前重新读取并以 revision fence 更新 provider、model，并清除旧的 `reasoningEffort`。保存 Key 或测试连接都不会改变默认模型。DSH `0.1.3-alpha.1` 的该原生服务用于之后新建的 Agent；当前会话的模型选择可能不同，也不会因这里的操作切换。

结果只映射 Host 固定版本/范围和白名单状态码，界面不显示密钥、上游响应正文或服务商原始错误。已保存仅表示凭据落盘；测试成功才表示本次内置 MiMo 探针成功。未登录、缺少密钥、认证失败、账号额度、上游/网络故障、超时和并发检查分别显示固定提示。

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

测试会重建 bundle，并验证：目录事实来自本机 pi-ai、没有 model ID 副本、只在显式点击后执行 revision-fenced mutation、已有 profile 不覆盖、MiMo 默认模型只在显式动作且 Key 已配置后写入、只读/冲突状态正确、官方 `settings.models.footer` 与 `settings.models.provider-card` 槽为追加注册。

## 自动思考档位（现代运行时）

对话输入框的“思考·自动”按当前任务与模型公开支持的档位在本机选取；可显式改为模型支持的手动档位。简短任务倾向低，常规中，推导/排查/多步或长输入高；属于本地规则，不调用额外分类模型。最近实际档位与依据可展开查看。未知能力使用提供方默认，永不发送 `auto`。原生模型选择器继续负责模型选择，档位移到这一独立入口，避免原生 pending 显示与自动实际档位冲突。

策略只保存当前角色的 `DSH_HOME/mochi-reasoning/policy.json`，不写未知 Session 事件，不保留任务原文。旧会话原生手动选择保持；恢复自动后，后续原生手动选择再次优先。教师/教室的数据目录保持独立。

构建默认读取 `apps/desktop/runtime-modern/node_modules` 的 pi-ai0.87.1，可显式以 `MOCHI_RUNTIME_NODE_MODULES_ROOT` 选择其他已安装树。真实 Host、冷恢复、已迁移 MiMo 能力补偿与 UI验证边界见 [automatic-reasoning-notes.md](../../docs/evidence/harness-upgrade-2026-09-30/automatic-reasoning-notes.md)。
