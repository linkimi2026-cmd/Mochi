# 已完成但无正文的轮次提示（2026-10-01）

本记录供根任务合入 `docs/reuse-audit.md`。实施前重新读取总审计、场景和旧命令审计。完整应用／框架生态沿用根任务本轮 DeepSeek Harness 与 pi-mono 检索；本子任务实际追加搜索词 `site:github.com/deepseek-ai/deepseek-harness conversation.chat.turnTail`、`site:github.com/badlogic/pi-mono reasoning only stop 5113`。第一项返回官方聊天／产物插件和历史讨论，第二项未得到直接匹配结果，不能视作已核该讨论。

实际仓库为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)；再次打开固定提交 `639ed015397290b3745d163aafe02ffee4aa3f84` 的 [MIT LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/LICENSE)。固定 ui-chat 目录网页本轮读取失败，改核本地实际安装包 `@deepseek-ai/dsh-client-ui-chat@0.2.0-rc.2` 的 package.json、公开 slots／conversation／chat-nodes 类型和生产 `lib/client.js`。包许可 MIT，Cordis `~4.0.4` 与已安装版本一致，沿用 React 18，不新增依赖。

采用官方公开 `conversation.chat.turnTail` **list/session** 插槽，新增独立贡献 ID，不复制聊天渲染器。生产 `TurnTailNodeView` 在没有 closing assistant 时仍渲染该贡献，能处理历史已完成且仅有 reasoning 的轮次。搜索返回的旧讨论把该插槽描述为 chain，不能当作当前 rc.2 契约；本次以固定已安装源码和类型为准。

根任务已确认真实目标轮次 end reason 为 completed，final assistant 未中断、只有 reasoning、无正文。提示只表达“本轮未返回正文，请重试”，不将思考转成答案，也不推断供应商失败原因。保留原有 reasoning 展示逻辑、记录和所有历史事件。保守判定同时要求完整 turn/start、closed/completed、官方 turn-tail 的 closing:null、turn-process 无正文／工具／子代理，以及所有 step 都有已结算且非中断的 final assistant，内容仅 reasoning 或空白 text；未知或不完整数据、图像、其它块、工具轮、失败／中断／max-tokens 均返回 null。

长期维护仅涉及两个公开 Turn data key、assistant-step 和一个公开 list 插槽。无新生产文件、不改权限／后台，升级 rc 版本时复查公开契约并重跑实际 bundle 验证。该客户端提示只让空回复可理解，不解决模型为什么生成空正文；此原因仍未验证。

验证：`node --test plugins/mochi-modes/test/*.test.mjs client-plugins/mochi-modes/test/*.test.mjs` **24 项通过**。新增测试求值**未修改的实际 rc.2 ui-chat 浏览器 bundle**，通过真实 apply 捕获其 assistant-step／turn-process／turn-tail Definitions 和 TurnTailNodeView；按公开 Definition 契约重放固定事件夹具，确认 reasoning-only／空内容／空白正文会显示状态条、原 assistant reasoning node 和事件不改。公开 renderer 实际走 closing:null 分支并调用新增贡献。文本轮、工具轮、子代理、失败／中断／max-tokens／fork、图像／未知块、历史不完整均不提示。真实 SlotCore 验证新 list 贡献与既有产物贡献并存，卸载只删除新增项。既有场景和历史命令测试继续通过。

`node --check client.js` 和本范围 `git diff --check` 通过。生产仍在现有 client.js 打包闭包内，无新生产依赖。本子任务不打包、不运行 GUI、不写用户 home；最终真实历史轮次和安装包排版由根任务验收。
