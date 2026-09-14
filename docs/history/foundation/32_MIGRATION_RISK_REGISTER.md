# 32 · 迁移风险登记册（MIGRATION_RISK_REGISTER）

> R1–R13 沿自 plan/11 §8；R-NEW 为本轮新增。状态：OPEN / MITIGATED / ACCEPTED。

| # | 风险 | 影响×概率 | 缓解 | 状态 |
|---|---|---|---|---|
| R1 | dsh Developer Preview 破坏性变更 | 高×中 | 锁 `dsh-v0.1.3-alpha.1`（commit d347e7039）；禁 @latest；比赛前冻结 | MITIGATED（版本已锁定） |
| R2 | SDK 通道无审批 UI | 高×高 | 主交互走 web 通道（官方 ui-approval）；sidecar 仅脚本/演示 | MITIGATED（架构已改） |
| R3 | D1→better-sqlite3 方言回归 | 中×高 | 方言差已清（仅 PRAGMA）；25 迁移全跑通 | MITIGATED |
| R4 | 未签名分发现场摩擦 | 中×高 | 预 `xattr -cr`/SmartScreen 演示预案 | OPEN |
| R5 | 免费模型限流（glm-4-flash 429） | 中×中 | 双模型兜底；演示模式 | OPEN |
| R6 | 遥测未关干净 | 低×低 | mode:DISABLED+env 双保险，抓包验证 | MITIGATED |
| R7 | 横向滚动/塑料感红线回归 | 低×中 | 每 PR 红线自检（`08` §3）+ 截图矩阵 | OPEN |
| R8 | 374 测试盲目全迁浪费 | 中×中 | 只迁离线可跑的单测（plan/11 §1.5） | OPEN |
| R9 | 工作量低估（高中生+上学） | 高×中 | 38 P0 纪律 + Batch 弹性 + 砍刀清单 | OPEN |
| R10 | 审批 payload 无参数 → 按参数越权做不了 | 中×中 | 按工具名分级；参数级风险由服务端 scope 兜底 | ACCEPTED |
| **R-N1** | **第三方 client 插件注入机制未核实** → slot 级 UI 可能需把 client 包纳入官方构建 | 高×中 | **已大幅降级（2026-09-04 晚）**：insert 行注入路线源码实证成立（`33` Q1）；残余仅 bundle 契约字段验证（Codex 半天）；兜底 = insertCSS 令牌桥（资产已备） | OPEN（降级为中低） |
| **R-N2** | 版本策略变更（原锁 npm 0.1.2-rc.1 → 现锁源码 0.1.3-alpha.1）引入打包路径变化 | 中×中 | PHASE_1 用源码 `pnpm install+build` 验证 `pnpm dsh web`；如需 npm 分发再评估 `npm pack` 本地包 | OPEN |
| **R-N3** | 官方 SPA 与嘉行联视觉融合后"不像 harness"或"不像嘉行联" | 高×中 | 阶段 A 只动令牌不动结构；双向截图对比验收（`36`） | OPEN |
| **R-N4** | 上游 master 前进，误升级 | 中×低 | 基线目录 `git remote` 仅 fetch 不 pull；升级=新决策 | MITIGATED |

## 上轮遗留 TO_BE_RESOLVED（并入 `33`）

审批桥 IPC 字段形状；`ctx.workspace` 复用；mochi-core 跨插件 import 取舍；正式签名证书（学校出资才做）。
