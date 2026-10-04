# 旧模式命令卡排查与退役（2026-10-01）

本记录供根任务合入 `docs/reuse-audit.md`，承接 `docs/reuse-audit-scenes.md`。

## 检索与复用

先重新读取总复用审计和场景审计。完整应用、框架及插件生态沿用本轮根任务已经执行的官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 Cherry Studio 检索；本子任务再次打开固定 Harness `639ed015397290b3745d163aafe02ffee4aa3f84` 的 [MIT LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/LICENSE) 和 [commands README](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/interaction/commands/README.md)，随后核实际安装 rc.2 的 ui-chat／ui-slots／commands 源码和公开类型。三包实际安装版本均为 **0.2.0-rc.2 / MIT**。不新增库、不改上游包。

采用官方现成 `conversation.chat.commandview` 命令名 keyed renderer。实际 `CommandNodeView` 将 `node.data` 作为 owner，并以 `command.name` 为 entryKey；没有特化时回退 `GenericCommandCard`。因此无需复制整个聊天列表或筛选 Session 事件。ui-slots 的公开 keyed priority 遮蔽与生命周期清理由现有 SlotCore 提供，继续沿用当前 React 18 / Cordis 4 兼容栈。

## 已确认来源

仅对真实教师 home 的目标标题元数据及匹配旧命令的日志事件做读取；没有输出用户对话正文，没有写入或删除任何 home 文件。标题指向的当前 v4 压缩日志中，seq 3–10 包含四次 `mochi-chat/mochi-work` 的 command/run 和对应 command/done。命令时间范围为 **2026-10-01 03:04:16.402–03:04:19.199 UTC**；截图中的“工具全开／收起”来自这些已持久化 done 文本。该日志的 system/message、request/header、request/context 均未命中两个旧命令名。

已安装 App 的 `mochi-modes/index.mjs` SHA256 与当前取消模式后的源文件完全相同，没有旧命令／工具注册。源码和包内浏览器插件都无旧模式 toggle；后台历史 fold 的两个名称仅用于 v2 projection 兼容读取，不生成新命令。官方 ui-chat 从历史 run/done 重建卡片，不要求命令仍被注册。因此本次现象已确认是旧会话命令卡；没有证据显示当前系统提示继续注入旧切换命令。无需修改 profile 或用户数据。

解码注意：日志为多 Zstandard frame。最初只用 Node one-shot zstdDecompressSync 得到首 frame header，不能据此判断会话为空；改用本机 zstd 多frame只读解码后才得到上述完整事件统计。

## 修改与边界

只在现有客户端闭包中为精确 `mochi-work`、`mochi-chat` 两个 commandview key 注册 `priority: -20` 的空渲染器，隐藏已失效卡片。没有覆盖 user/message 节点，也不按聊天正文字符串做隐藏；用户亲自发送的同名文字、其它命令卡和权限审批保持原渲染。原 Session 文件、事件时间／序号、用户正文、旧 projection 和角色／权限策略都保持不变。官方 ui-chat 包列入客户端依赖图，确保公开 child slot owner 先就绪；无新生产文件。

维护成本为两个公开 keyed slot 注册。上游 rc 升级须复查 CommandRowOwnerProps／commandview 契约；使用公开 slot，不依赖 hashed CSS、DOM 文本扫描或 MutationObserver。

## 验证

`node --test plugins/mochi-modes/test/*.test.mjs client-plugins/mochi-modes/test/*.test.mjs` **21 项通过**。新增实际 rc.2 **SlotCore** 集成验证：低 priority 只遮蔽两个旧命令卡、其它 permission 命令保持可见、用户包含旧命令名的正文保持可见、解除贡献恢复原 renderer。冻结旧 command node 的测试确保无历史数据修改。既有九项官方 preset bundle staging／CAS／locked 集成测试继续通过。

`node --check client.js`、本范围 `git diff --check` 通过。本子任务没有打包或运行 GUI；最终包内历史截图与新会话验收由根任务执行。对未来供应商模型是否提到旧功能不作保证；当前源注册和已保存模型上下文中未发现旧指令注入，新的 capability section 已明确旧切换要求不适用。
