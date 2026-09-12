# ACTIVE-MEMORY-01 · 更主动的教师记忆

用户新目标，复用 plugins/mochi-memory 的长期 SQLite 与工作记忆，不另起存储/替换框架。root审核，待LAN UI交齐后Lagrange顺序实现本插件及其测试，其他主流程不断。

实际现状：现有6个工具可由模型调用，没有看到自动召回的生命周期接线。目标：新会话/新任务主动带入少量相关、已确认偏好和未完成工作上下文，教师不必先问“你记得吗”；当前任务中主动提炼明确长期偏好/重复稳定习惯并调用既有记忆工具，不把临时任务/学生明细/凭据自动固化。不要为此每个token调用后台模型或增加常驻反思Agent，避免首字延迟和不可控费用。

先核固定DSH公开systemPrompt/turn生命周期接口，采用现成可用hook。召回内容明确作为可纠正的历史资料，不把记忆文本当系统指令；严格每身份/DSH_HOME隔离、长度/条数上限，删除后后续会话不再召回，关闭/清空功能可验证。不因“更主动”绕过现有敏感信息护栏。

验收：两个独立数据根不串记忆；新会话无显式recall请求仍能获得既有教学偏好；修改/遗忘/清空后更新；临时事项不变长期事实；无凭据/学生成绩明细流入长期记忆；记录额外本地处理耗时，不虚称真实模型效果已通过。不要仅修改工具描述就把主动召回标完成。

2026-09-09 候选审核：root已读取active-context及store/world变更，独立Node22完整npm test通过；随后独立执行 `MOCHI_ACTIVE_PROMPT_CONSUMER=/private/tmp/mochi-alpha-runtime02.suLW9w/consumer node22 plugins/mochi-memory/test-active-prompt-assembly.mjs` exit0，真实固定alpha SystemPrompt.assemble()/renderContextSnapshot含已确认偏好，forget后新snapshot为空。新增审计写失败隔离的test-active-context亦独立通过。（⚠️ 2026-09-12 19:4x 更正：该测试**现已真红**——它仍断言点号工具名 `mochi.memory_note`，而实现已按 9/12 的工具名禁令改为 `mochi_memory_note`。测试需同步改名。）采用当前桌面一身份一DSH_HOME前提；不声称同home多校园账号隔离、真实模型自动提炼效果或最终安装包已通过。允许Halley集成冻结候选，实际包仍须受管资源验证。
