# Mochi · 设计修订日志（12_REVISION_LOG）

> 修订官角色：兜底并行 Agent 产出的 7 个 P0 阻塞 + 砍刀清单 + 用户指令 A/B。
> 修订方式：用 Edit 定点修改 01/02/03，每处留 `> 🔴 修订记录（设计修订官 / …）` 痕迹。
> 凡改动的 dsh API 名 / 配置字段 / 路径，均去 `mochi-harness-src.nosync/mochi-harness-master/` 源码核实（见各条"核实"）。
> 未核实、需用户/Codex 决策的，显标 `TO_BE_RESOLVED_BY_CODEX`。

---

## 0. 修订总览

| 问题 | 状态 | 落点 |
|---|---|---|
| P0-1 协调服务器无人建造 | ✅ 已解决（R2 单机模拟） | 02 §1/§4/§10/§12 |
| P0-2 Skill 工具名对不上 | ✅ 已解决（对齐 01） | 03 §4.2 |
| P0-3 工具数量冲突 | ✅ 已解决（定 38） | 01 §1.2 + 03 §9.1 |
| P0-4 两套 Artifact 不兼容 | ✅ 已解决（R3 单一源） | 01 §5.3/§5.5 + 02 §4 |
| P0-5 审批 API 写错（最致命） | ✅ 已解决（`ctx.waterfall`） | 03 §3.1 |
| P0-6 Web 兜底违反硬指令2 | ✅ 已解决（砍） | 03 §8.3/§9.1/§9.3 |
| P0-7 dsh 未锁版本 | ✅ 已解决（锁 0.1.2-rc.1 + 1 项待核实） | 03 §8.2 |
| 指令 A 模型切换一等功能 | ✅ 已解决（改引用 09） | 01 §1.1 + 03 §5 |
| 指令 B 傻瓜式服务老师 | ✅ 已解决（改引用 10） | 01 §1.1 |
| P1-1 UI 自建设计 | ✅ 已解决（复用 calm-tokens） | 03 §7.3 |
| P1-2 `never` 误当自动通过 | ✅ 已解决 | 03 §3.1 |
| P1-3 遥测键（前提部分有误） | ✅ 复核：原 `disabled:true` 合法，保留 | 03 §8.4 |
| P1-4 前端任务态 4→6 | ✅ 已解决（R6） | 03 §7.1 |
| P1-5 150 Eval→50 | ✅ 已解决 | 03 §6.1/§6.3 |
| P1-6 10 Skill→5 | ✅ 已解决 | 03 §4.2/§9.1/§10.1 |
| P1-7 Episodic 记忆 | ✅ 已解决（砍/降级） | 03 §9.1/§10.1 |
| P1-8 演示 fixtures / P1-9 迁移清单 | ⚠️ 未在本轮强改（补漏清单，建议补交付物） | 见尾部 |

---

## 1. P0 逐个修订明细

### P0-1 ｜ 协调服务器无人建造（→ 单机模拟 R2）
- **原状**：02 整份协议依赖 `Mochi 协调服务器`（`mochi_agents`/`mochi_tasks`/`mochi_artifacts`/`mochi_artifact_grants` 表 + `/api/mochi/v1/*`），但 01/03 运行时是纯本地桌面 dsh app，路线图无一项建造该服务器；Golden Demo 1–4 全依赖它 → 全塌。
- **修订后**：裁决 R2 —— v1 **不建独立协调服务器**，改为**单机模拟**："另一个 Mochi / Resource Agent"用本地第二个 dsh profile 或进程内 mock 扮演；human approval 由桌面 APP answerer 渲染确认卡（不走 `subagent-acp`，因其 automation-only 无人在环）。所有 `mochi_*` 表与 `/api/mochi/v1/*` 端点**仅作数据模型规范保留**，v1 由本地 mock 实现闭环。
- **文件位置**：02 §1（加 R2 裁决 banner + §1.1 注"仅作规范"）、§1.2（"服务器侧匹配"→本地 mock）、§10（API Contract 标"v1 仅作规范"）、§12（风险重述）。
- **裁决理由**：符合"26 天现实约束 + 能砍就砍"；真跨网络 A2A 留答辩"下一步"。02 §6 已论证 A2A 不包 subagent，与本裁决一致。

### P0-2 ｜ Skill 层工具名对不上（→ 唯一权威清单）
- **原状**：03 §4.2 写 `doc.write`/`schedule.*`/`campus_query_student`/`user-questions`/`browser.*`，01 定义的是 `doc.create|read|edit|export`/`calendar.*`/`task.*`/`jxl.*`，且无 `user-questions`/`browser.*` P0。模型按 Skill 调不存在工具必失败/幻觉。
- **修订后**：03 §4.2 砍到 **5 个 Skill**，每个 `Tools:` 逐条改写为 01 §1.2 真实名（`jxl.*`/`doc.create`/`doc.edit`/`ppt.*`/`file.*`/`calendar.search`/`task.*`/`message.send`）；`user-questions` 删除（需问用户由 persona 反问，不靠工具）；`browser.*` 属 P1 桩，v1 不引用。
- **文件位置**：03 §4.2（整段重写）+ §9.1 P1-1 行 + §10.1 模块表。
- **裁决理由**：R1。工具名以 01 为唯一权威源（见 P0-3），消除跨文档字典分裂。

### P0-3 ｜ 工具数量冲突（→ 38）
- **原状**：01 §1.2 标题"约 30"，明细求和 38；03 §9.1 写"60+ 工具"（把 P1 ~20 偷渡成 P0）。
- **修订后**：统一 **P0 = 38**（以 01 §1.2 明细为准）。01 §1.2 标为"唯一权威清单"；03 §9.1 P0-3 行改"38 个工具，60+ 已作废"。
- **文件位置**：01 §1.2（加权威声明）+ 03 §9.1 P0-3 行。
- **裁决理由**：R1。38 决定 26 天可行性；P1 不入 P0。

### P0-4 ｜ 两套 Artifact 不兼容（→ R3 单一源）
- **原状**：01 §5 本地 store 存绝对路径+版本链；02 §4 `mochi_artifacts` 存 SQLite、明令禁绝对路径、加 HMAC Grant 链；01 本地文件如何变 02 可分享 Artifact **无桥接**。
- **修订后**：裁决 R3 —— **01 本地 store（`<workspaceRoot>/.artifacts`+版本链）为 v1 唯一事实源**；02 `mochi_artifacts`/`grants`/HMAC 下载链**降为未来跨主体共享规范，v1 不做**；01 §5.3 砍"共享"、§5.5 砍"像素级预览（soffice）"，仅留 create/read/export+版本+结构化概览。跨主体共享改本地复制+确认卡。
- **文件位置**：01 §5.3（链路操作表重写）、§5.5（像素预览砍）；02 §4（加 R3 裁决 banner）。
- **裁决理由**：v1 仅本机，绝对路径合法；HMAC/跨机共享是未来规范，不阻塞开工。

### P0-5 ｜ 审批注册 API 写错（最致命）
- **原状**：03 §3.1 写 `ctx.on('approval/request', async (req, next) => {...})`。
- **核实（去源码）**：`packages/interaction/user-approval/src/index.ts:273` 实际调用 `this.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req, () => 'unavailable')`；监听器契约在 `types.ts`：`declare module '@deepseek-ai/cordis' { interface Events { 'approval/request'(this, req: ApprovalRequestEvent, next): Promise<ApprovalOutcome> } }`，标注 `@mode waterfall`。`ctx.on` 是普通事件监听（返回值被忽略），**不进审批决策链** → 所有 `ctx.approval.request` 落终态 `unavailable`（fail-closed）→ 连只读 AUTO 工具也被拒，三态系统整体失效。
- **修订后**：改为 `ctx.waterfall('approval/request', (req, next) => {...})`；`req.toolName` 经源码核实**正确**（`ApprovalRequestEvent.toolName`）。新增硬限制说明：审批 payload **不带工具参数**（仅 `agent`/`toolName`/`callId?`/`reason?`/`signal?`），DENY 只能按工具名判定，故须自写 `approval/request` answerer 插件。
- **文件位置**：03 §3.1（代码块 + 注释 + 硬限制告警）。
- **裁决理由**：这是"不动一行业务代码、只在注册处写错一个方法名就崩盘"的坑；已据源码钉死正确 API。

### P0-6 ｜ Web 兜底违反硬指令2
- **原状**：03 §8.3 第 4 点、§9.3 P2-3 写 `dsh --profile web` 起 3080 浏览器版兜底。
- **核实**：`dsh --profile web` 真实存在（`bundle/web-app/README.md`），技术断言没编；但另起浏览器部署版 = 网站，违反"做桌面 APP 不是网站"。
- **修订后**：砍掉 Web 兜底（§8.3 第 4 点删除、§9.1 P2-3 行改"砍"、§9.3 第 4 点改"砍"）。**明确区分**：Electron WebView 嵌官方 Web SPA（08 文档官方推荐路径）是桌面 APP 合法实现，保留；机房管控靠"预装+放行"解决。
- **文件位置**：03 §8.3、§9.1 P2-3、§9.3 第 4 点。
- **裁决理由**：硬指令2 优先；不砍错"Web SPA 嵌 Electron 壳"。

### P0-7 ｜ dsh 未锁版本
- **原状**：01/03 反复"已读源码"但未 pin 任何版本；打包若 `@latest` 会漂到未知 rc，今天验证的 API 明天可能变。
- **修订后**：打包脚本钉 `@deepseek-ai/dsh@0.1.2-rc.1`（用户给定 Developer Preview 版本），依赖锁 `pnpm-lock.yaml` 提交，禁 `@latest`，订阅 release 监控 breaking change。
- **文件位置**：03 §8.2（加版本锁定段）。
- **⚠️ 待核实（TO_BE_RESOLVED_BY_CODEX）**：本地 `mochi-harness-src.nosync` 快照根 `package.json` 版本是 **`0.1.3-alpha.1`**，与用户给定 `0.1.2-rc.1` **不一致**。开工锁版本前需 `npm view @deepseek-ai/dsh versions` 确认 `0.1.2-rc.1` 存在，并在该版本源码复验 `approval/request` 瀑布契约与 `session-telemetry-otel` 的 `mode` 字段；若实际发布为 `0.1.3-alpha.1` 系列，则改锁已验证的对应版本号。**锁定以"API 与本文核实一致"为准，不以版本号字符串为准。**
- **裁决理由**：Developer Preview 必须锁，否则 26 天内 rc breaking change 会废掉已验证 API。

---

## 2. 用户指令 A / B

### 指令 A ｜ 模型切换是一等功能（不写死）
- **原状**：03 §5 把模型层弱化成"simple/complex/tool-heavy 三档路由"，用户不满意。
- **修订后**：03 §5 改为"模型切换是一等公民功能"，三档路由删除；默认 `glm-4-flash`，用户经类 Codex CLI `/model` 随时切 + 加自定义 provider 极简（用户原话"只要我们加入自定义就可以了"）。具体机制改由 **`09_MODEL_SWITCHING.md`** 定义，01/03 只保留约束不重复造。
- **文件位置**：01 §1.1（引 09）、03 §5（整节重写）、§9.1 P2-1（改"砍自研 router，引 09"）。

### 指令 B ｜ 傻瓜式服务老师
- **原状**：01 工具设计未显式按"老师不会用 AI 工具"检验。
- **修订后**：01 §1.1 加指令 B 检验（老师不用写 prompt / 预置配置开箱即用 / 校园场景优化），并改由 **`10_TEACHER_UX.md`** 定义细节；凡新增工具须回答"老师可见复杂度是否过高"。
- **文件位置**：01 §1.1（加指令 B 段，引 10）。

---

## 3. 砍刀清单落实（审核官建议删除/降级）

1. ✅ Web 兜底版 — 砍（P0-6）。
2. ✅ 真跨网络 A2A + 协调服务器 — 改单机模拟（P0-1 R2）；表/端点留规范。
3. ✅ 多节点视角（Student/Service Mochi）— 砍，留答辩"下一步"（03 §9.3 第 1 点）。
4. ✅ 动态模型路由 / per-turn 换模型 — 砍，改引 09（03 §5 / §9.3 第 3 点）。
5. ✅ 150 Eval → ~50 — 砍（03 §6.1/§6.3）。
6. ✅ 10 Skill → 5 — 砍（03 §4.2/§9.1/§10.1）。
7. ✅ Episodic 记忆 — 砍/降级，v1 只 Conversation+Working（03 §9.1 P1-4 / §10.1）。
8. ✅ 像素预览（soffice）+ 共享（Grant 链）— 砍（01 §5.3/§5.5，R3）。
9. ✅ Companion 真实执行 — 保持桩/P1（01 §6 原已如此）。
10. ✅ 25MB 受限分享链接 — v1 不做（02 §4.4 随 R3 整体降级，跨主体共享砍）。

---

## 4. P1 复核结论（已据源码核实）

- **P1-1 UI 自建设计**：03 §7.3 原自定"焦糖/琥珀色系"违反硬指令1；改为原样复用 `联动计划` 的 `calm-tokens.css` + Orb 组件，不新建设计令牌。✅
- **P1-2 `never` 误当自动通过**：03 §3.1 原写 headless demo 用 `never`（"自动 rejected 适合录屏"）。核实 `user-approval/src/index.ts:265`：`never` 在 dispatch 前 `return 'rejected'`（确定性拒绝，非自动通过）。改：现场 demo 用 `ask`，脚本/录屏 demo 用 `demo-auto-approver`（`ctx.waterfall` 对 CONFIRM 返 `allowed-once`），绝不用 `never` 跑需 CONFIRM 的 demo。✅
- **P1-3 遥测键（前提部分有误，重要）**：04_REVIEW 建议改 `mode: DISABLED`。但核实 `packages/session/session-telemetry-otel/README.md` 与**实际生效的 `.mochi-home.nosync/profiles/headless/cordis.patch.yml`**，本计划写的 `disabled: true` 是 Cordis 装载层"整条插件禁用"指令，**已实测生效、校园数据不出校**，合法且是本项目正在用的形式。`mode: DISABLED` 是插件内备选（默认即关）。**保留 `disabled: true` 不动，避免回归**；打包确保无 `mode: FULL`/无 `exporter.url`。✅（与 REVIEW 分歧，已据源码裁断）
  - **⚠️ 被 R-B2 推翻**：Agent B 在 Batch 2 实测发现 `disabled: true` 在本项目 patch 中**并未生效**（dump-config 仍 `mode: FEEDBACK_ONLY`），正确键为 `mode: DISABLED` + `DSH_TELEMETRY_DISABLED=1`。请以 §7 R-B2 为准。
- **P1-4 前端任务态 4→6**：03 §7.1 原 4 态缺 `INPUT_REQUIRED`/`APPROVAL_REQUIRED`；按 R6 扩为 6 态（PENDING_SEND/RUNNING/INPUT_REQUIRED/APPROVAL_REQUIRED/COMPLETED/TERMINATED）。✅
- **P1-5 150 Eval→50**：✅（见砍刀第 5 项）；并修正 §6.3 对不存在的 `tools/llm-probe.mjs` 的引用，改经 SDK `session.event`/`--dump-config` 落盘。
- **P1-6 10→5 Skill**：✅（见 P0-2）。
- **P1-7 Episodic**：✅ 砍/降级（见砍刀第 7 项）。
- **P1-8 演示 fixtures / P1-9 迁移清单**：属"补漏清单"，本轮未强改（见下"未解决项"）。
- **P1-10 01 Artifact 过度操作**：✅ 随 P0-4 砍共享/像素预览。

---

## 5. 未解决 / 需用户决策项

1. **⚠️ P0-7 版本号漂移（TO_BE_RESOLVED_BY_CODEX）**：本地源码快照 `0.1.3-alpha.1` 与用户给定 `0.1.2-rc.1` 不一致。锁版本前需 `npm view` 确认发布版本并在该版本复验 API；最终锁定"API 一致"的版本号。方案已给，仅版本号字符串待核实，**不阻塞开工**（先用 `0.1.2-rc.1` 锁，若不符再调）。
2. **⚠️ P1-8 演示 fixtures（建议补，非阻塞）**：五场 Golden Demo 需 canned 数据（学生/班级/医务室/课表/资源/clinic 状态）。建议补一份"demo fixtures + 脚本化 demo runbook"交付物（05 系列或独立文档）。
3. **⚠️ P1-9 统一迁移清单（建议补，非阻塞）**：从 `联动计划` 复制哪些文件（ExpressiveOrb 6 文件 + calm-tokens + 迁移 0001–0025）、改哪些、风险点，建议补 `05_MIGRATION_CHECKLIST.md`（硬指令3）。
4. **保留的 `TO_BE_RESOLVED_BY_CODEX`（来自原稿，非本轮引入）**：`ctx.workspace` 复用、`mochi-core` 跨插件 import、soffice 像素预览（已砍）、HMAC 密钥轮换（已砍）、Cordis 插件注册入口、per-turn 换模型（移交 09）、官方 eval harness、正式签名证书（仅学校出资时）。这些不影响 P0 开工，已有本地回退。

---

## 6. 源码核实清单（本轮改动锚定的 API）

| 断言 | 源码位置 | 结论 |
|---|---|---|
| 审批是 waterfall 非事件监听 | `packages/interaction/user-approval/src/index.ts:273` + `types.ts` `interface Events['approval/request']` `@mode waterfall` | `ctx.waterfall('approval/request', (req, next)=>...)` |
| 审批 payload 字段 | `types.ts` `ApprovalRequestEvent` | `agent`/`toolName`/`callId?`/`reason?`/`signal?`（无参数） |
| `never` 确定性拒绝 | `user-approval/src/index.ts:265` | `never` → `rejected`，非自动通过 |
| 遥测 `disabled:true` 合法 | 实际 `.mochi-home.nosync/.../cordis.patch.yml` + `session-telemetry-otel/README.md` | patch 级禁用已生效；`mode:DISABLED` 为备选 |
| `dsh --profile web` 存在 | `bundle/web-app/README.md` | 存在，但属网站，砍 |
| dsh Node 要求 | 根 `package.json` `engines` | `^22.19.0 \|\| >=24.0.0` |
| dsh 版本 | 根 `package.json` `version` | 本地快照 `0.1.3-alpha.1`（≠ 用户给定 `0.1.2-rc.1`，见 P0-7） |

---

## 7. Batch 2 实测补充修订（Agent B / 2026-09-04）

> 在 `apps/desktop/electron/dsh/` + `.mochi-home.nosync/profiles/mochi*/` 落地时发现 3 处与文档/任务描述不符的 dsh API 事实，均经源码 + 实测核实。

### R-B1 ｜ 审批 answerer 返回值必须是字符串枚举，不是对象（🔴 致命）
- **原状（任务 #2 原话）**：`return { allowed: true }` —— "自动放行（Batch 2 的 IPC 确认卡桥替换这一行）"。
- **核实（源码）**：`packages/interaction/user-approval/src/index.ts:279` 在 waterfall 收尾做 `OUTCOMES.includes(outcome) ? outcome : 'unavailable'`。`ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`（`types.ts:32`）。返回 `{ allowed: true }` 这样的非词汇值 → 被归一化为 `'unavailable'` → **fail-closed**（所有 CONFIRM/DENY 工具被拒）。
- **修订后**：answerer 返回 `'allowed-once'`（字符串）。实测 `dsh --profile mochi "..."` 跑通，审批请求被自动放行、未 fail-closed。
- **落点**：`apps/desktop/electron/dsh/mochi-approval/index.mjs`。与 P0-5 一致（注册用 `ctx.waterfall`），但补充了**返回值形状**这一坑。

### R-B2 ｜ 遥测关闭键 `disabled: true` 在 patch 中无效（🔴 推翻 P1-3 结论）
- **原状（12_REVISION_LOG P1-3）**：称 `session-telemetry-otel: disabled: true` 是 Cordis 装载层禁用指令、已实测生效、保留不动。
- **核实（实测）**：在 mochi profile patch 写 `disabled: true` 后跑 `--dump-config`，该条目仍活跃且 `config.mode: !!js process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'` —— `disabled` 键被 Cordis 忽略，遥测处于 **FEEDBACK_ONLY（会出网）**，并非关闭。**原 P1-3 结论不成立**。
- **修订后（正确做法，07 Q11 + 08 §6.4）**：patch 写 `session-telemetry-otel: { config: { mode: DISABLED } }`；并双保险注入 `DSH_TELEMETRY_DISABLED=1`（源码 `profile-boot.ts:78-104`：任意非空值强制关闭）。实测 dump-config 现显示 `mode: DISABLED`。
- **落点**：`.mochi-home.nosync/profiles/mochi/cordis.patch.yml` 与 `mochi-sdk/cordis.patch.yml`；`mochi.sh` + `harness.ts` + `main.ts` 均注入 `DSH_TELEMETRY_DISABLED=1`。
- **⚠️ 请修订官注意**：P1-3 的"保留 disabled:true 不动"建议撤回，改为 `mode: DISABLED`，否则校园数据会出网。

### R-B3 ｜ sidecar 必须走 sdk 入口，headless 包挂 jsonrpc-server 不生效
- **原状（任务 #4）**：`startDshSidecar()` 配 "mochi profile + stdio pipe" 即可常驻 JSON-RPC。
- **核实（实测）**：`dsh --profile mochi --patch <挂 jsonrpc-server 的 patch>` 启动后**直接退出**（headless 包要一次性 job，jsonrpc-server 不在 headless 下激活）。`dsh --profile sdk`（bundle `dsh-sdk-app`）下 `dsh-sdk-jsonrpc-server` 才常驻 stdio 服务；`initialize` 返回 `serverInfo: mochi-harness-sdk-runtime`，`session/prompt`/`shutdown` 正常。
- **修订后**：CLI 验证用 `mochi` profile（headless 包）；sidecar 用独立 `mochi-sdk` profile（bundle `dsh-sdk-app` + mochi 三插件 + persona/技能沙箱/遥测/工具裁剪），`harness.ts`  spawn `dsh --profile mochi-sdk`。08 §2.5 要求 mochi profile 保留 jsonrpc-server，落点为"mochi-sdk profile = mochi 配置经 sdk 入口跑"，口径一致。
- **落点**：`.mochi-home.nosync/profiles/mochi-sdk/`；`apps/desktop/electron/dsh/sdk-sidecar.patch.yml`（保留作参考，实际已并入 mochi-sdk profile，无需 --patch）。

---
