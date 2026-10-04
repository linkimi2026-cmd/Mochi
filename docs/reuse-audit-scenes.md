# 教师场景选择复用核查（2026-10-01）

本记录供根任务合入 `docs/reuse-audit.md`。

## 检索与采用结论

实际搜索词：`github deepseek dsh harness agent preset client ui agent presets`。先覆盖完整应用与框架生态：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，再核对其 [client 插件生态](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client) 与 [ui-agent-preset](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-agent-preset)。检索成功，有明确可复用方案。

查看版本：`@deepseek-ai/dsh-client-ui-agent-preset` **0.2.0-rc.2**；固定提交 `639ed015397290b3745d163aafe02ffee4aa3f84`。GitHub commit API 确认提交时间为 `2026-09-29T09:21:31Z`，该提交合并 rc.2 发布。许可证 [MIT](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/LICENSE)。本地实际安装包同版本，peer Cordis `~4.0.4` 与 runtime lock 的 `4.0.4` 一致；本地 React `18.3.1` 满足官方 React 18 约束。无需新增 npm 库。

**部分采用**官方完整浏览器插件 `apply`：继续使用官方 roster store、空白会话 staging、select、default settings write、blank session 同步、连接刷新和拒绝处理。官方原始 roster 包含历史高级 preset，且显示受 developerTools 控制，不满足教师产品入口；因此在 `mochi-modes-client` 内建立私有 facade，仅过滤呈现、使用独立 locale、通过公开 slot `priority: -20` 覆盖 picker/header/settings。没有复制或重写官方会话选择控制器，没有修改全局 remote、configForms 或宿主 roster。

## 已确认事实与边界

- 本地检查文件：`apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js` 及对应 package.json；实现不是仅凭 README 推断。
- 官方 `agentPresets.list/select` 和 `remote.settings.update("agent-preset-registry", { selectedDefault })` 可复用。
- 官方 hero 单槽、header 中 `id: agent-preset`、settings 中 `id: agent-presets` 支持低 priority 遮蔽。
- 教师 roster 必须同时具有 `standard` 和四个专注场景，才安装产品覆盖；教室 roster 不安装教师覆盖。
- 通用与四专注依次为 `standard`、`lesson-planning`、`materials-assessment`、`grade-analysis`、`classroom-coordination`。
- 历史会话 header 按投影真实 ID 只读显示；不会调用 select 更改已经开始的会话。
- 仅旧三项 saved selectedDefault 通过 settings.describe 读取 namespace revision，再 settings.update 携带 expectedRevision 迁移为 standard；验证 effective roster 后挂载。CAS冲突、只读或迁移拒绝显示明确错误与重试入口，既有支持的默认场景不写，session旧投影不改。
- 初次 roster 不可用后 connection/reset 重试；generation 防止旧响应注册，installed 防重复挂载；dispose 后异步响应不可安装。

## 接入验证

`node --test client-plugins/mochi-modes/test/*.test.mjs`：**17 项全部通过**。其中 9 项直接在 VM 中求值未改动的实际安装官方 `lib/client.js`，以 React、host services 和 observable transport fixture 驱动生产控制器，覆盖：

- developerTools 为 false 仍可显示教师五场景；原全局 roster 仍有八项。
- 未绑定新会话的选择暂存，随后只对主界面 retain 的 blank session select 一次，真实 projection 更新。
- 已存在 blank session 立即持久选择；宿主拒绝恢复实际场景并返回拒绝原因；started 历史会话不发 select。
- 设置默认写入官方 namespace，同步仍当前的 blank session。
- 教室不注册产品覆盖；dispose 清理所有覆盖；迟到响应不重新安装；连接恢复重试且无重复覆盖。
- 旧三个默认场景逐项测试带版本迁移与原session保留；CAS拒绝显示错误、不伪称通用，重试恢复；既有五个默认场景逐项测试不写设置。

另外 `node --check client.js`、`git diff --check` 均通过。真实窗口、最终资源重建及 App 打包由根任务统一验证，本子任务未运行 GUI 或打包 App。

## 长期维护成本与未验证假设

实现位于现有 `client.js` 闭包，资源复制无需新生产文件。主要维护点是官方公开 apply/inject 契约和三处 slot；升级官方版本须重跑真实 bundle 测试。不会依赖官方组件的 CSS hash。合理推测：继续复用官方 staging 可降低升级时会话生命周期漂移风险；这一点不等同于保证未来版本兼容。尚未验证：实际 Electron 窗口中的最终排版及打包后 ModuleLoader 依赖图，由根任务统一完成。

## 最新增量：取消工作／对话二分（2026-10-01）

用户明确取消 work/chat 功能，保留五场景。修改前实际 GitHub 搜索词为 `site:github.com/deepseek-ai/deepseek-harness packages tools restrict permissions commands recordInput`，先延用已核完整 Harness 应用与 client 生态，再核固定 rc.2 提交的 [interaction 生态](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/interaction/README.md)、[core/tools 源码](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/tools/src/index.ts)、commands 和 permission-presets 契约。额外尝试 `packages/product/permission/README.md` 返回 404，已纠正到实际 interaction 路径；这不是整体检索失败。

复用结论：继续采用已有官方工具注册、角色／preset 工具范围、审批和权限策略；不另建权限实现。原 mochi-modes 的 `restrict` 遮罩属于本产品自行添加的额外能力限制，并不是官方操作授权。删除产品遮罩、模式升级工具和两个 slash 命令注册后，真实权限与逐工具审批仍由原策略执行。官方 commands 类型没有隐藏注册字段，因此不保留可发现的旧切换命令，避免命令菜单残留模式入口。旧 command/run→done 与 mode approval asked→decided 的事件读取不依赖命令／工具继续注册。

已确认实现：客户端彻底移除输入栏 toggle、CSS 与 commands 依赖；官方五场景 facade、staging、CAS默认迁移仍完整保留。后端不再注册 `mochi_request_work_mode`、commands 或 agent lifecycle，不创建或释放任何工具／权限遮罩；只保留稳定 schema 排序、统一能力提示，以及**原语义和 stateVersion 2** 的历史 projection 读取。新提示明确按角色／场景实际工具执行、旧切换要求已不适用、所有操作继续走原权限审批，取消模式不表示批准具体操作。其他运行源、user profile 与 persona 未检出继续自称旧模式的绑定。

最新验证：`node --test plugins/mochi-modes/test/*.test.mjs client-plugins/mochi-modes/test/*.test.mjs` **20 项通过**，其中五场景的 9 项实际官方 bundle VM integration 继续通过。后端覆盖历史 chat 缓存不再限制新建／resume／fork 的已注册工具、教室缺席能力不被凭空新增、权限对象与危险操作 guard 不变、实际旧command与approval事件重放及fork前缀恢复（冻结旧event确保不改写），以及schema排序失败降级。

同步修订 `test-package-resources.mjs` 的模式工具注册期望为空；旧 `test-presentation-chat-live-ui.mjs` 改为首次即可调用真实PPT工具、切换工具缺席、直接PPT→inspect两次工具链，不再等待已删除的模式审批。两个脚本 `node --check` 和本范围 `git diff --check` 通过；未运行GUI。测试中的危险操作 guard 是 fixture，不能代替真实危险操作审批验收，最终装包运行验证仍由根任务统一执行。

维护成本下降：删除模式限制控制器与模式升级审批状态，不引入新库或新生产文件。历史projection仅作为兼容读取保留，不再作为权限输入。实施依赖最终重启新版宿主以重建agent作用域；不尝试释放旧进程中无法归属的限制，避免影响其他权限策略。
