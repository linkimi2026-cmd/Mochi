# 35 · Codex 分阶段实施命令（CODEX_IMPLEMENTATION_COMMANDS）

> PHASE_0–12。每条命令含：OBJECTIVE / READ FIRST / PRESERVE / IMPLEMENT / DO NOT / TESTS /
> ACCEPTANCE / STOP。共享事实见 `34`；架构规则见 `03`。一次只执行一个 PHASE，
> 完成后输出 REPORT 再进下一个。任何 STOP 条件命中 → 停止并报告，禁止强行继续。

## 共享 STOP 条件（所有 PHASE 生效）

发现无完整 Harness baseline / 现有实现是 Fake Harness / 迁移将破坏 Relay / 需破坏生产 D1 /
认证无法安全复用 / 官方 API 与本包不一致 / breaking change / 必须暴露密码或 Token 给模型 /
严重安全问题 / 需要修改 `联动计划`。→ 停止，写《STOP_REPORT》。

## CODEX_PHASE_0 · 真实仓库 + Reality Audit 复核
- **OBJECTIVE**：完成 `34` 全部命令，产出《CODEX_AUDIT_REPORT》；闭合 `33` Q1/Q2。
- **READ FIRST**：`34` §0–4；`01`；`docs/architecture.zh.md`。
- **PRESERVE**：只读。**IMPLEMENT**：报告文件 `foundation/CODEX_AUDIT_REPORT.md`。
- **DO NOT**：不写业务代码、不改 patch。**TESTS**：红线自证①②通过。
- **ACCEPTANCE**：`33` Q1/Q2 有结论+证据；`01` 冲突项已回写。
- **STOP**：git 基线不符 / 联动计划出现改动。

## CODEX_PHASE_1 · Full Harness Baseline / Version Pin
- **OBJECTIVE**：从锁定源码建立可运行基线：`pnpm install && pnpm run build`，`pnpm dsh web`
  起 127.0.0.1:3080；建立 `mochi-web` profile（web-app bundle + Mochi 插件 + 遥测 DISABLED +
  workspace-write + glm-4-flash baseURL）。
- **READ FIRST**：`packages/bundle/web-app/cordis.patch.yml`；`packages/boot/app-boot/README.md`；
  现有 `mochi`/`mochi-sdk` profile patch。
- **PRESERVE**：现有 mochi/mochi-sdk profile 不动；`pnpm-lock.yaml` 提交。
- **IMPLEMENT**：`.mochi-home.nosync/profiles/mochi-web/`；`mochi.sh` 增加 `web` 子命令。
- **DO NOT**：改内核包源码；开 0.0.0.0；开遥测。
- **TESTS**：`--dump-config` diff 记录；CLI `--profile mochi` 冒烟"现在哪些学生在医务室"仍通过。
- **ACCEPTANCE**：浏览器打开官方 SPA；审批卡/Trajectory/插件页/设置可见；`33` Q3/Q4 闭合。
- **STOP**：源码构建失败且 24h 内无法解决；官方 SPA 与 07 factcheck Q4 描述不符。

## CODEX_PHASE_2 · JiaXingLian Design Migration（阶段 A 令牌桥）
- **OBJECTIVE**：`jxl-theme` 令牌桥落地（机制按 PHASE_0 Q1 结论：client 插件或 insertCSS 兜底），
  按 `08` §1 映射表把嘉行联令牌写入 `--dsw-*` 别名层；亮/暗两套。
- **READ FIRST**：`07`；`ui-theme/src/styles/` 全变量清单（PHASE_0 Q2 产出）。
- **PRESERVE**：官方组件结构/布局零改动；嘉行联令牌值原样。
- **IMPLEMENT**：映射 CSS 一个文件 + 注入点；`--jxl-fs-*/--jxl-space-*` 补充阶梯。
- **DO NOT**：自绘聊天界面；改组件 DOM；引 Tailwind/组件库；横向滚动条。
- **TESTS**：Light/Dark/Reduced Motion 三态截图（Desktop+iPhone 宽度）。
- **ACCEPTANCE**：`36` §UI-A 初验：像嘉行联的配色与材质，布局仍是官方 Harness。
- **STOP**：发现令牌层不足以承载视觉（需改组件结构）→ 报告并等裁决。

## CODEX_PHASE_3 · Mochi Agent Runtime
- **OBJECTIVE**：`mochi-persona` + 事件→Orb mood 桥 + Work 质量循环骨架（inspect 配对）+ demo fixtures + Eval 断言器雏形。
- **READ FIRST**：`09`；`packages/core/system-prompt` README；现 renderer `api/types.ts` mood 映射。
- **PRESERVE**：renderer 的 Orb 资产与事件映射逻辑复用。
- **IMPLEMENT**：persona 插件、mood 桥（WS/sidecar→IPC）、`foundation/fixtures/`、`eval/run.mjs`。
- **DO NOT**：关键词直返路径；把策略写进 persona。
- **TESTS**：Eval P0 冒烟 20 条（`30` 类别抽样）；Local Rule 直返=0。
- **ACCEPTANCE**：CLI 与 Web 两侧人格一致；Orb 状态随事件正确迁移。
- **STOP**：官方事件流无法驱动 mood（桥不可实现）。

## CODEX_PHASE_4 · Existing Relay Preservation
- **OBJECTIVE**：单机复刻 Relay 语义：`mochi-relay` 插件 + `mochi_relay_messages/mochi_resources`
  本地表 + 六态传话卡（`mochi.relay` keyed node 或 Electron 卡）+ E2E（传话/找卷子两场景）。
- **READ FIRST**：`02` §4；联动计划 `worker/routes/core/assistant.ts`（只读参照）；`15`。
- **PRESERVE**：语义逐条对齐（人决定应答、pending 条件更新、200 字正文、kind/item 字段）。
- **IMPLEMENT**：插件 + 状态迁移 + 卡片 UI + 幂等（`28`）。
- **DO NOT**：新建线上服务；改联动计划；给 Mochi 自动应答权。
- **TESTS**：E2E×2（ASK 回话、FIND 登记命中）；重复应答不命中；EXPIRED 扫描。
- **ACCEPTANCE**：Demo A 全流程跑通且与联动计划行为一致。
- **STOP**：发现语义无法在单机模拟保持（需真服务器）→ 报告裁决。

## CODEX_PHASE_5 · Dispatch Task Domain
- **OBJECTIVE**：`mochi-dispatch`：MochiTask 表 + 7 态迁移 + ASK/REQUEST/FIND/APPROVE 原语工具
  （`mochi.ask/request/find/respond`）。
- **READ FIRST**：`14` `15`；`packages/jobs` README。
- **PRESERVE**：Relay 为其底层特例（兼容映射）。
- **TESTS**：状态机单测（非法迁移拒绝、终态不可逆、幂等键）；Demo C。
- **ACCEPTANCE**：工具返回结构化事实；任务卡六态正确。
- **STOP**：需扩服务器才能闭环。

## CODEX_PHASE_6 · Artifact
- **OBJECTIVE**：`mochi-artifacts`：`.artifacts` store + 版本链 + 契约字段（`13`）+
  `mochi.artifact` UI 卡 + Artifact 作为任务输入。
- **READ FIRST**：`33` Q5（workspace 归属）；plan/01 §5 修订后版本。
- **TESTS**：create→version→export；跨任务引用（Excel→doc）。
- **ACCEPTANCE**：Demo G 后半（卷子 PDF → ppt.create）。
- **STOP**：与官方 attachment/store 机制冲突需改内核。

## CODEX_PHASE_7 · Agent Discovery
- **OBJECTIVE**：`mochi-registry` + 匹配流程（`16`）+ 假想 Agent（周老师/信息中心/医务）。
- **TESTS**：匹配命中/未命中/离线三路径；模型语义选择记录进 Trajectory。
- **ACCEPTANCE**：Demo B 的 Discovery 步骤可复现。
- **STOP**：无。

## CODEX_PHASE_8 · JiaXingLian Plugin（只读优先）
- **OBJECTIVE**：`mochi-jiaxinglian` 全套 `jxl.*` 读工具 + AUTH_REQUIRED 流 + 连接 UI + scope 预过滤。
- **READ FIRST**：`17` `18`；联动计划 `permissions.ts`（只读）。
- **PRESERVE**：服务端为权威；本地 demo 数据层先行（fixtures），真连接走 Worker API。
- **TESTS**：六角色 scope 矩阵（对照 PAGES_AND_PERMISSIONS.md）；AUTH_REQUIRED→连接→重试成功。
- **ACCEPTANCE**：Demo A/B/C 在"已连接"态跑通；未连接时通用能力不受影响。
- **STOP**：认证无法在不向模型暴露凭据的前提下复用。

## CODEX_PHASE_9 · Teacher Productivity Tools
- **OBJECTIVE**：38 个 P0 工具按 `12` 分批落地（ppt→doc→xlsx→pdf→file→calendar/task→comm），
  每个带 inspect 配对 + Artifact 登记 + 幂等键。
- **TESTS**：每族 E2E（create→inspect→edit→export）；`message.send` 走 CONFIRM 卡。
- **ACCEPTANCE**：plan/11 Batch 4 验收语（月考分析 PPT 全链）。
- **STOP**：License 问题无法解决（GPL 传染）。

## CODEX_PHASE_10 · Browser Chat Bridge
- **OBJECTIVE**：P3。受控视图 + Selected Text Handoff 先行 → Provider Adapter 1 个 →
  Handoff Compiler + Preview/Confirm（`24` `25`）。
- **TESTS**：选区交接永远可用；长对话摘要；Preview 字段完整。
- **ACCEPTANCE**：Demo F（可降级：选区→Capsule→PPT）。
- **STOP**：任何需要绕登录/碰凭据的实现路线。

## CODEX_PHASE_11 · Student / Service Agents
- **OBJECTIVE**：P3。学生白名单 profile + Demo D/E 演示模拟（`22` `23`）。
- **TESTS**：学生工具白名单外一律 DENY；放行必须教师侧 CONFIRM。
- **ACCEPTANCE**：Demo D 全链（教师代发版）。
- **STOP**：需要真实学生端 UI 而时间不足 → 降级为演示模拟并登记。

## CODEX_PHASE_12 · Final Integration + QA
- **OBJECTIVE**：全量 Eval 50 条跑绿；`36` 截图矩阵全断点；Golden Demo A–G 连排；
  打包（未签名预案）；`33` 清零或登记；冻结版本 tag `mochi-demo-1`。
- **ACCEPTANCE**：`36` 全部打勾；STOP 条件零命中。
- **STOP**：任何验收项未过且无降级预案。

## REPORT FORMAT（每 PHASE）

```
PHASE_x_REPORT
- 产出文件/目录清单（路径）
- 与 Foundation Pack 冲突点及裁决请求
- 测试结果摘要（数字）
- 遗留 TO_BE_RESOLVED
- 联动计划零改动自证输出（粘贴）
```
