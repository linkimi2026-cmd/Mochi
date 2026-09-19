# Mochi A2A 可靠性审计

日期：2026-09-05。状态：**PARTIAL**。这是迁移期间形成的现状与验收缺口，不能作为 Phase 1 已通过的证明。

## 已验证的边界

主代理已独立运行 `plugins/mochi-dispatch/test.mjs`、`plugins/mochi-campus/connection.test.mjs` 与 `artifacts/migration-audit/probes.mjs`；Node 24.19.0 下通过，探针为 7 PASS / 0 FAIL / 0 INVALID。校园处理器回归的前次完整验证为 44 文件、378 测试；M07 后续源同步与构建变更尚须最终复验。

Dispatch 使用真实插件和临时 SQLite，transport 为 stub。校园 Relay 处理器测试直接执行处理器与测试数据库。它们证明对应模块行为，不证明两名用户的真实模型、审批界面、网络、数据库和回复完整串联。

## A–O 验收矩阵

| 项目 | 当前证据 | 未完成的验收 |
|---|---|---|
| A 正常询问 | ask 审批后创建任务、精确关联本次 Relay ID | 林清→管理员→回复→原 Agent 的本轮双端实测 |
| B 对方答应 | respond approve、Relay accepted 映射有测试 | 真实对端批准和发起方恢复；答应不能冒充实际工作完成 |
| C 对方拒绝 | declined 状态映射及并发 accept/decline 处理器检查 | 双端拒绝与用户可理解的最终呈现 |
| D 对方离线 | Relay 是持久化消息；现有证据未覆盖离线恢复 | 关闭对端后发送、重新上线、仅处理一次 |
| E 对方一直不答 | 过期扫描与重复扫描幂等通过 | 用户等待体验及真实超时后的两端一致性 |
| F Agent 不存在 | 明确 peer-not-found 结构化失败纳入未投递契约 | 真实目录查询、没有任务/通知误完成 |
| G 多个同名联系人 | peer-ambiguous 结构化失败属于允许的未投递错误 | 真实同名演示联系人及消歧后的唯一目标 |
| H 重复发送 | 同参数、跨小时、legacy 迁移、事务内再检查通过 | 浏览器重复提交与跨进程并发投递 |
| I 网络重试 | 只有确证 NOT_SENT 可重试；UNKNOWN 不静默重发；中断与过期后仍阻断重复 | 真实网络失联、回复丢失与恢复链路 |
| J 两边同时操作 | Relay respond 条件更新保证一次成功，竞争者409；owner 隔离通过 | 两端独立运行时的完整并发矩阵 |
| K 数据库写入失败 | 目前不足以证明所有写入失败窗口 | 建任务失败、投递后本机落盘失败、回复审计失败逐点注入 |
| L 完成后再点击 | 终态拒绝再次 respond；条件迁移不倒退 | 真实旧界面与新会话上的重复操作 |
| M 用户主动取消 | 取消生成与业务任务取消不可等同；当前任务状态无 CANCELLED | 明确任务取消契约、在途边界与双方同步 |
| N 超时 | expireScan 和 UNKNOWN 过期后重复阻断通过 | 定时触发、界面状态与远端晚到回复处理 |
| O 权限不足 | 非 owner 在审批/transport 前拒绝；来源、账号与会话绑定通过 | 双端真实账号切换与服务端角色/范围组合 |

测试来源：`plugins/mochi-dispatch/test.mjs`、`plugins/mochi-campus/connection.test.mjs`、`campus.nosync/tests/assistant-natural-language.test.ts`、`artifacts/migration-audit/probes.mjs`。M07 完成后应将校园源码引用改为最终 canonical 来源。

## 不能从当前状态推导的结论

- 当前任务表状态为 CREATED、DISPATCHING、DELIVERED、COMPLETED、DECLINED、FAILED、EXPIRED；尚不满足后续 Dispatch v1 的 WORKING、APPROVAL_REQUIRED、CANCELLED 全部生命周期要求。
- FIND 的“登记命中”“对方答应”都不是文件交付证据。当前 accepted→COMPLETED 的统一映射需要在 Artifact/任务类型语义中修正，不能直接用于成果交付统计。
- 当前没有证明端到端通知恰好一次；客户端幂等检查不能替代远端持久化幂等。
- 原有成功记录仅证明发生过成功，不用于计算当前可靠性百分比。

## 基础指标定义与实现状态

下面是后续采集应遵循的口径，**当前未实现可靠指标采集，数值均为未验证**。不能将通过的测试个数当作业务成功率。

统计必须使用固定观察窗口、owner 和 task type；以 correlation_id 区分逻辑任务，以 attempt_no 区分投递尝试。尚未到截止时间的任务单列为进行中，不能混入失败分母。

| 指标 | 口径 |
|---|---|
| Task Success Rate | 在截止时间前有符合任务类型的真实成功结果的逻辑任务数 / 已到截止时间的有效逻辑任务数；取消和拒绝单列 |
| Delivery Success Rate | 有远端持久化确认的唯一逻辑任务数 / 发起投递的唯一逻辑任务数；UNKNOWN 单列 |
| Reply Completion Rate | 已收到有效终结回复的 ASK/REQUEST 数 / 已投递且回复观察窗已结束的 ASK/REQUEST 数；答应与拒绝分列 |
| Duplicate Rate | 同一逻辑操作多出的远端持久化任务或通知数 / 对应唯一逻辑操作数；任务与通知分别计算 |
| Timeout Rate | 截止时仍未取得所需结果的任务数 / 已到截止时间的有效逻辑任务数 |
| Average Completion Time | 有真实成功结果的任务，从创建到该结果验证完成的耗时均值；同时报告样本数，失败和拒绝不当作成功耗时 |

目前虽有 created_at、updated_at、completed_at、correlation_id、attempt_no、delivery_outcome，但没有完备的远端投递确认与各类型成果验证事件。因此不能直接查询当前 COMPLETED 行给出上述指标。

下一步应先完成 Phase 0 的组合验收，再由 TerraMax 实现缺失的故障注入与真实双端探针。只用演示账号和测试材料，保留原业务记录。

## 追加：真实 HTTP 双进程集成证据

2026-09-05 20:32，root 以 Harness Node22 独立运行 artifacts/migration-audit/a2a-e2e/vitest.config.mjs，通过1文件/1测试。使用 canonical Worker完整app、真实密码登录和requireAuth、内存D1 adapter，两个独立本地进程与临时数据库。最新结果文件记录 relay1条、send/respond各1次、两端任务各1条、重复同步不重复；未认证请求被拒绝。

该证据提高了现有 ASK 传输、回复与同步链路的可信度，但测试审批是确定性输入，不含模型、原生审批界面或真实Cloudflare运行时；未据此提升全部A–O为通过，亦未生成业务成功率。

## 追加：本地完成写入失败与首次同步终态修复

2026-09-05 23:21，root再次独立使用Node22运行同一真实HTTP双进程集成探针，1文件/1测试通过。现包含三个逻辑任务：正常ASK；远端accepted已提交而本地COMPLETED写入注入失败，后续同步恢复；首次本地镜像前远端已declined，首次同步直接保留终态。共三条relay、send/respond各三次、两端任务各三条，再同步无第四次respond。latest-result.json记录localCompletionWriteFailureRecoveredBySync及firstMirrorUsesExistingTerminalRelayState均为true；root另独立Dispatch测试通过。

因此K中的上述特定窗口已有故障注入证据，首次镜像不会虚报待处理。仍采用canonical Worker app与内存D1 adapter、临时本地SQLite和确定性审批；不是公开Cloudflare/真实workerd/模型审批完整验收，其他数据库失败窗口、全部A–O及业务指标仍未全部验证。当前运行服务及旧桌面包尚未重启/重打包含本次源码。
