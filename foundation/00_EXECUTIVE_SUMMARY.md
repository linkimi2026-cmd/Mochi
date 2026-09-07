# 00 · 执行摘要（MOCHI_HARNESS_FOUNDATION_PACK）

> 项目：嘉行联 · Mochi ｜ 日期：2026-09-04 ｜ 状态：FOUNDATION 完成，待 Codex 落地
> 本包是 Codex 的唯一权威开工依据。`Mochi/plan/01–12` 为历史规划材料，与其冲突时以本包为准。

## 一句话结论

**Mochi = 真实 Mochi Harness 运行时 + 嘉行联视觉语言 + 教师工作 Agent 层。**
不是聊天网站，不是 Harness 仿制品，不是两个网站拼接。

## 本轮已完成的四项研究

1. **官方仓库克隆并锁定基线**：`deepseek-ai/mochi-harness` 完整克隆至
   `/Users/a1379/Documents/Mochi/mochi-harness-src.nosync/mochi-harness`，
   **HARNESS_BASELINE_VERSION = `dsh-v0.1.3-alpha.1`（commit `d347e7039`）**。
   该版本与本地已实测核验 API 的快照完全一致，同时解决了上轮遗留的 P0-7 版本漂移问题。
   注意：npm `latest` 仍是 `0.1.2-rc.1`（更旧），因此**以源码方式集成**，不跟 npm tag。
2. **Harness 真实能力审计**（→ `01_HARNESS_REALITY_AUDIT.md`）：以源码+官方文档为准，
   摸清 Cordis 插件树、profile/bundle/patch、审批 waterfall、client 插件树与 slot、
   工具目录、模型适配器、遥测默认关闭等全部事实。
3. **联动计划只读审计**（→ `02_CURRENT_JIAXINGLIAN_AUDIT.md`）：六岗位权限、Movement 状态机、
   Mochi 传话网络（mochi_relay_messages / mochi_resources）、34 张表、calm-tokens 设计系统、
   ExpressiveOrb。**联动计划零改动（只读），红线维持。**
4. **上一轮实现评估**（→ `32_MIGRATION_RISK_REGISTER.md` §R-NEW）：
   自绘 Chat UI（`apps/desktop/renderer` 的 ChatLog/InputBar/ChatBubble）判 **DROP**；
   Electron 侧车集成（`electron/dsh/*`、审批 answerer、DB 层、Orb 资产）判 **KEEP**。

## 五个最重要的架构决定（本轮新裁决）

| # | 决定 | 依据 |
|---|---|---|
| D1 | UI 骨架 = 官方 Web SPA（`packages/client/*`），嵌入 Electron；**废除自绘聊天界面** | 用户指令"严格按照 Mochi Harness 的界面进行改"；07 factcheck Q4 |
| D2 | 嘉行联视觉通过三层迁入：CSS 令牌桥（calm-tokens → `--dsw-*`）→ client 插件 → Electron 外壳+Orb 悬浮层 | `01` §5、`06`、`08` |
| D3 | 嘉行联以 Organization Plugin 接入（`mochi-jiaxinglian`），认证独立、模型永不见密码 | `17`、`18` |
| D4 | A2A v1 = 单机模拟（R2 裁决维持），复用联动计划 Relay 语义（人决定应答）；真跨网络留答辩 | `14`、`15`、`19` |
| D5 | Policy 管能力、模型管对话：审批 answerer 只按工具名分类 AUTO/CONFIRM/DENY，普通对话全走模型 | `11`、`19`、`30` |

## Codex 接力包

- `34_CODEX_REPO_AUDIT_COMMAND.md`：开工前 30 分钟必须跑的核实命令。
- `35_CODEX_IMPLEMENTATION_COMMANDS.md`：CODEX_PHASE_0–12 分阶段指令（含 STOP 条件）。
- `36_ACCEPTANCE_CRITERIA.md`：实机截图矩阵 + Golden Demo + Eval 验收。

## 阅读顺序

Codex：`00 → 34 → 01 → 04 → 35(PHASE_0)`，其余按 phase 需要。
人类评审：`00 → 04 → 31 → 36`。
