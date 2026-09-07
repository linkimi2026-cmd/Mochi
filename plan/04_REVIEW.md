# Mochi · 首席审核官审查报告（04_REVIEW）

> 审查对象：01_TOOLCHAIN.md（699 行）/ 02_DISPATCH_PROTOCOL.md（611 行）/ 03_RUNTIME_AND_PLAN.md（450 行）
> 审查立场：专挑刺、找 26 天后会崩的问题。已对 dsh 源码（`mochi-harness-src.nosync/mochi-harness-master/`，v0.1.2-rc.1）逐条核实。
> 核实方法：直接读 `packages/*/src/*.ts` 与 `README.md`，对照文档断言。所有"已核实/编造"结论均可回溯到具体文件行号。

---

## 0. 判决摘要

**三份文档不能直接照着开工。工具层(01)和运行时层(03)的质量最高、dsh 事实基本属实；协议层(02)设计最完整但依赖一套没人打算建造的服务器基础设施。致命问题不在"吹牛"，而在三份并行产出之间的口径冲突 + 对硬指令2的违反 + 一个会让全部工具被拒绝的 API 写错。**

- **直接可用**：01 的 `defineTool` 契约、38 工具 schema 骨架、license 选型；03 的 persona 红线、记忆/权限思路、SDK 事件与 `HarnessClient` 引用、Electron 选型。
- **必须改（P0）**：A2A 协调服务器无人建造、Skill 层工具名与工具层对不上、Artifact 两套模型不兼容、审批注册 API 写错、违反"砍 Web"硬指令、dsh 未锁版本、工具数量口径冲突。
- **必须砍**：Web 兜底版、真跨网络 A2A、150 条 Eval、10 个 Skill、Episodic 记忆层、多节点视角、动态路由。

**一句话：先出一份"迁移清单 + 统一口径"再写任何代码，否则 01/03 会按两套字典各自实现，最后拼不起来。**

---

## 1. 问题清单（按严重程度）

### 🔴 P0 阻塞（不解决就卡死或现场翻车）

**P0-1 ｜ 02 的"协调服务器"在 01/03 里根本不存在（跨文档 A4）**
- 在哪：02 §1.1/§2.1/§4.2/§10 整套 A2A + Artifact Grant 协议依赖 `Mochi 协调服务器`（`mochi_agents`/`mochi_tasks`/`mochi_artifacts`/`mochi_artifact_grants` 表 + `/api/mochi/v1/*`）。
- 问题：01 和 03 的运行时是**纯本地桌面 dsh app**；03 §9.1 的 26 天路线图（P0-1~7 + P1）里**没有一项是"搭建协调服务器"**。02 §12 自己承认"协调服务器始终可用"是头号风险，并建议"演示用同机/局域网双实例"——但"双实例"由谁起、API 谁实现，全程未排入工时。Golden Demo 1/2/3/4 全部依赖跨主体闭环，没有服务器就全塌。
- 改：见统一口径 R2——v1 改为**单机模拟**，不建独立服务器（详见砍刀清单）。

**P0-2 ｜ Skill 层(03)调用的工具名，工具层(01)根本没定义（跨文档 A2）**
- 在哪：03 §4.2 十个 Skill 写 `doc.write`、`schedule.*`、`campus_query_student`、`user-questions`、`browser.*`；01 §8 实际定义的是 `doc.create`/`doc.edit`/`doc.read`/`doc.export`、`calendar.*`/`task.*`、`jxl.student_query`（且明确"升级版 mochi-campus.campus_query_student"）、**没有任何 `user-questions` 工具**。
- 问题：Skill 是给模型看的方法体，里面写"调 `doc.write`"但工具叫 `doc.create`/`doc.edit` → 模型按 Skill 去调不存在的工具 → 必失败或幻觉。这是并行写作最典型的后果。
- 改：03 §4.2 全部 Skill 的 `Tools:` 字段**逐条重写为 01 的真实工具名**（ppt.*/doc.create|read|edit|export/spreadsheet.*/pdf.*/file.*/calendar.*/task.*/message.draft|send/jxl.*）。这是开工前必须做的对齐，否则 Skill 全部作废。

**P0-3 ｜ 工具数量口径冲突，可行性无法估算（跨文档 A1）**
- 在哪：01 §1.2 标题写"约 30 个工具"，明细求和却是 **38**（7+4+5+4+6+5+2+5）；03 §9.1 P0-3 写"工具层产出的 **60+** 工具经 defineTool 注册"。
- 问题：38 vs 60+ 差出 22 个工具，直接决定 26 天够不够。03 的 60+ 大概率把 P1（约 20）也算进了 P0，但 P0-3 标的是 P0 优先级，等于把 P1 偷渡成 P0。
- 改：统一为 **P0 = 38**（以 01 明细为准），03 的"60+"作废（见 R1）。

**P0-4 ｜ 两套 Artifact 模型互不兼容、无桥接（跨文档 A3）**
- 在哪：01 §5 的 `Artifact` 存 `<workspaceRoot>/.artifacts/index.json`，字段含 **`path`（本地绝对路径）**、`parentId`、`derivedFrom`、版本链（本地文件 copy-on-write）；02 §4 的 `mochi_artifacts` 存 SQLite，`source_ref` 明文"**绝不存本地绝对路径(如 /Users/.../卷子.pdf)**"，另加 `checksum_sha256`/`access_scope`/`mochi_artifact_grants`（HMAC token）。
- 问题：两份文档对同一概念给了两套 schema，且 02 明令禁止 01 的核心字段（绝对路径）。前端(03 §7.5)的"ARTIFACT 类"状态不知道消费哪一个。最致命：**01 本地生成的文件如何变成 02 可分享的 Artifact（Demo 1 的授权下载）完全没有桥接定义**——02 的 Grant 链拿不到源数据。
- 改：见 R3——v1 以 01 本地 store 为唯一事实源，02 的跨主体模型降为"未来规范"，不做 HMAC 下载链。

**P0-5 ｜ 审批注册 API 写错 + A2A 机制自相矛盾（C + 跨文档 A5）**
- 在哪①：03 §3.1 伪代码 `ctx.on('approval/request', async (req, next) => {...})`。
- 问题①（已查源码 `interaction/user-approval/src/index.ts:273`）：审批是 **Cordis `ctx.waterfall('approval/request', (req, next) => ...)`**，不是 `ctx.on`。`ctx.on` 注册的是事件监听（返回值被忽略），而审批是 waterfall（返回值决定 `allowed-once`/`rejected`）。写错的结果：**mochi-approval 不会被纳入 waterfall → 所有 `ctx.approval.request` 都落到终态 `unavailable`（fail-closed）→ 连只读 AUTO 工具也被拒**。整个 AUTO/CONFIRM/DENY 三态系统静默失效。
- 在哪②：02 §6 明令"A2A 不包 subagent"；03 §9.1 P1-3 却写"**subagent 派任务给另一个 Mochi**（Golden Demo 3/4）"，与 02 直接打架，也和 03 自己 §9.3"A2A 只做演示级"矛盾。
- 改：① 审批注册改为 `ctx.waterfall`（R4）；② A2A 机制统一为 R2（单机模拟，不包 subagent）。

**P0-6 ｜ 违反硬指令2：规划了 Web 版（B2）**
- 在哪：03 §8.3 第 4 点"若学校机房有管控，准备 **Web 版兜底（dsh --profile web 起 3080）**"；03 §9.3 P2-3"**Web 兜底**"。
- 问题：用户硬指令"做的是桌面 APP，不是网站，任何 Web 版/web-app 要砍掉"。命令 `dsh --profile web` 我**已核实真实存在**（`bundle/web-app/README.md`："Run `dsh --profile web`..."），所以技术断言没吹牛——但**计划本身违反硬指令**。桌面 APP 用 Electron WebView 渲染是合法的（那是桌面程序），但另起一个浏览器部署的 `dsh --profile web` 就是 Web 版，必须砍。
- 改：删 03 §8.3 第 4 点、§9.3 P2-3（见砍刀清单）。

**P0-7 ｜ dsh 是 Developer Preview，三份文档都没锁版本（F）**
- 在哪：01/03 反复"已读源码"但未 pin 任何 commit/version；03 §8.2 说"把 dsh 及依赖打进 resources"。
- 问题：dsh = `0.1.2-rc.1` Developer Preview。26 天内 rc 版可能 breaking change（尤其 `approval/request` waterfall、SDK 事件名这类我们刚踩坑的 API）。若打包时 `npm i @deepseek-ai/dsh@latest` 会漂到未知版本，今天验证过的 API 明天可能变。
- 改：从 `mochi-harness-src.nosync` 锁定**具体 commit/版本号**写入打包脚本；禁止 `@latest`；订阅 dsh release 监控 breaking change（补漏清单）。

### 🟡 P1 必改（影响质量/可行性）

**P1-1 ｜ 03 §7.3 视觉规范属"重建设计语言"，与硬指令1冲突（B1）**
- 03 §7.3 自定"焦糖/琥珀色系、圆角、无横滚"视觉规范。用户硬指令1："UI 不用再设计，球必须原样用上，任何设计前端视觉体系的内容都是多余的。"
- 改：删 §7.3 自建设计，改为"直接复用 `联动计划/design/calm-tokens.css` 与现有 Orb 组件，不新建设计令牌"（R7）。

**P1-2 ｜ 03 §3.1 "headless 用 `never` 适合录屏"是错的（C）**
- 已查 `user-approval/src/index.ts:265`：`if (effectivePolicy==='never') return 'rejected'`——`never` 在 dispatch 前就 deterministic reject，**不是自动通过**。
- 问题：脚本化/录屏 demo 若用 `never`，凡 CONFIRM 工具（`message.send`、Demo 3 换课确认）全部被拒，demo 直接失败。03 把"不出弹窗"误当成"自动通过"。
- 改：桌面现场 demo 用 `ask`（真人点确认卡）；**脚本化/录屏 demo 用一个 `demo-auto-approver` answerer（`ctx.waterfall` 返回 `allowed-once` for CONFIRM）**，绝不用 `never` 跑需要 CONFIRM 的 demo（R4）。

**P1-3 ｜ 03 §8.4/§0 遥测关闭键写错（C）**
- 03 写 `session-telemetry-otel: disabled: true`。已查 `session/session-telemetry-otel/README.md`：正确键是 **`mode: DISABLED`**（且默认就是 `DISABLED`）；不存在 `disabled` 字段。
- 改：打包保证 `mode: DISABLED` 且无 `exporter`（R5）。

**P1-4 ｜ 02 的 11 任务态与 03 前端 4 态未映射（跨文档 A7）**
- 02 `mochi_tasks` 有 11 态；03 §7.1 前端只有 `TASK_QUEUED/RUNNING/COMPLETED/FAILED` 4 态。`DISPATCHING`/`DELIVERED`/`INPUT_REQUIRED`/`APPROVAL_REQUIRED`/`EXPIRED`/`CANCELLED` 在前端无落点。Demo 2/3 必须展示"请选择/请确认"界面，现有 4 态不够。
- 改：前端任务态扩到 6（R6）。

**P1-5 ｜ 150 条 Eval 不现实（D/E）**
- 03 §6 计划 3 天写 150 条 case + 驱动脚本 + 看板。高中生 + 上学，3 天写不出 150 条有质量的 case，且 §6.3 的 headless 驱动依赖未证实的 `tools/llm-probe.mjs`（源码未找到此文件）。
- 改：砍到 ~50 条核心（自然聊天/指代/校园查询/Tool Calling/Permission 各 5–10，A2A/Artifact 少量），其余留 P2（砍刀清单）。

**P1-6 ｜ 10 个 Teacher Skill 过多（D/E）**
- 03 §4.2 列 10 个 Skill。v1 只需覆盖演示叙事的 4–5 个（daily-brief / class-meeting-prep 或 document-preparation / teaching-material-find / teacher-message / student-follow-up）。
- 改：留 4–5 个，其余砍（砍刀清单）。

**P1-7 ｜ 记忆五层过度（E）**
- 03 §2 五层：v1 实际只需 Conversation（dsh 自动）+ Working（context 插件）。Episodic（`mochi-episodic` SQLite + TTL）、Profile（`mochi-profile`）是加分项，不是演示必需，且 Episodic 索引"昨天那个格式"在 01/02 Artifact 未统一前无处挂。
- 改：Episodic/Profile 降 P1 末或砍（砍刀清单）。

**P1-8 ｜ 缺演示数据 fixtures 与脚本化 demo 路径（F）**
- 五场 Golden Demo 需要 canned 数据（学生/班级/医务室在册/课表/资源/ clinic 状态）。01 §1.2 说 jxl.* 走 demo 数据层，但**没有"演示数据集"这一交付物**。且比赛 demo 不能赌现场 LLM 发挥，需要脚本化/可回放路径（03 §6.3 提到 headless 驱动，但未固化成 demo 脚本）。
- 改：补"demo fixtures + 脚本化 demo runbook"交付物（补漏清单）。

**P1-9 ｜ 缺统一"迁移清单"交付物（B3 / F）**
- 用户硬指令3："先列迁移清单，把该弄的弄清楚再迁移"。三份都是设计稿，但**没有一份枚举**：从 `联动计划` 复制哪些文件（ExpressiveOrb 6 文件 + calm-tokens + 迁移 0001–0025）、改哪些、风险点。02 §9.1、03 §0 零散提到，未汇总。
- 改：补一份 `05_MIGRATION_CHECKLIST.md`（补漏清单）。

**P1-10 ｜ 01 Artifact 全套操作过度（E）**
- 01 §5.3 列 创建/读取/编辑/版本/预览/导出/共享。v1 只需 创建/读取/导出 + 版本链；像素预览（依赖 soffice）、共享（依赖 02 Grant 链）都该砍。
- 改：v1 只做 create/read/export + version（砍刀清单）。

### 🟢 P2 建议（锦上添花）

- **P2-1**：03 §7.2 把 `approval/asked`/`approval/decided` 当独立通知通道；实为 `session.event` 通知内的子事件 topic。前端应解析 `session.event` payload，不是订阅独立通道。
- **P2-2**：02 §6 引文 `packages/acp/README.md` 实际路径是 `packages/acp/acp/README.md`（"automation-only server" 在该文件，已核实）。引文路径错但不影响结论。
- **P2-3**：03 §2.3 `packages/scope` 不存在，只有 `packages/core/scope`（已核实存在）。路径笔误。
- **P2-4**：02 的 11 态可保留（DB enum 便宜），但前端不必为每态单独做交互，按 R6 归并即可。
- **P2-5**：01 §2.3 `ctx.workspace` 待定已标 `TO_BE_RESOLVED_BY_CODEX`，可接受；建议直接用本地 JSON 配置回退，不依赖 dsh 内部服务。

---

## 2. dsh 事实核实结论（C 类，逐条）

**✅ 已查源码、文档写对的（可放心照做）：**
- `defineTool` 契约、`additionalProperties:false` 硬校验（`core/tools/src/schema.ts:367`）、`@deepseek-ai/dsh-tools` 包名、`ctx.tools.register(defineTool(...))`（`fs/tool-str-replace-editor/src/index.ts:428` 实测）、`ToolRunContext`（`@deepseek-ai/dsh-tools` 导出）。
- `ctx.approval.request({agent, tool, callId?, reason, signal})` → `allowed-once`/`rejected`/`cancelled`/`unavailable`（README + `src/index.ts`）。
- `permission-presets` 配置格式（`presets`/`defaultPreset` + `sandbox`+`approval` 两旋钮）。
- `guard/repeat-tool-reminder`、`guard/timeout-policy`、`workflow/tool-ralph` 均存在。
- `subagent/`、`tool-subagent`、`tool-subagent-control`、`subagent-acp` 存在；`subagent-acp` 确为 automation-only、permission 自动应答、无人在环（README 第 12/163 行，支撑 02 §6 不包 subagent 的结论）。
- SDK `session.event`/`session.status` 通知（`sdk/protocol/README.md:43-44`）、`HarnessClient` 类与 `subscribeSessionTree(sessionId)`（`sdk/client/src/client.ts:185/370`）均存在。
- `skill-filesystem` 的 `includeDefaultRoots`/`customSkillDirs` 真实存在（README 第 54/68/71 行）——03 此点写对，之前的"扫进 17 个技能"风险是真风险。
- `session-telemetry-otel` 模块存在（mode FULL/FEEDBACK_ONLY/DISABLED）。
- `dsh --profile web` 真实存在（`bundle/web-app/README.md`）——所以 03 的技术断言没编，只是违反硬指令2。

**❌ 编造/写错（已在 P0/P1 列出）：**
- `ctx.on('approval/request')` → 应为 `ctx.waterfall`（P0-5）。
- headless `never` = 自动通过 → 实为全部 rejected（P1-2）。
- `session-telemetry-otel: disabled: true` → 应为 `mode: DISABLED`（P1-3）。
- `approval/asked`/`approval/decided` 当独立通道 → 实为 `session.event` 内子事件（P2-1）。
- 引文/路径笔误：`packages/acp/README.md`、`packages/scope`（P2-2/3）。

**未编造、但标了 `TO_BE_RESOLVED_BY_CODEX` 仍悬而未决（需开工前闭合）：**
- 01 §2.3 `ctx.workspace`、`mochi-core` 跨插件 import 机制、`soffice` 像素预览、HMAC 密钥轮换、Cordis 插件注册入口。
- 03 §5.2 per-turn 换模型、§6.3 官方 eval harness。
- 上述多数不影响 P0 开工（已有本地回退方案），但需在编码前各自定死。

---

## 3. 砍刀清单（明确删除/降级）

1. **03 §8.3 第 4 点 + §9.3 P2-3（`dsh --profile web` Web 兜底）** —— 违反硬指令2。删。桌面 APP 用 Electron WebView 合法，但不得另起浏览器部署版。
2. **02 真跨网络 A2A + 独立协调服务器完整搭建** —— v1 改为单机模拟（R2）。`mochi_agents`/`mochi_tasks`/`mochi_artifacts`/`mochi_artifact_grants` 表仅作"数据模型规范"保留，v1 由本地 mock 实现，不接真实后端、不起服务器。
3. **03 P2-2 多节点视角（Student/Service Mochi identity/scope 隔离）** —— 砍，留答辩"下一步"。
4. **03 P2-1 动态模型路由 / per-turn 换模型** —— 砍，免费档只 `glm-4-flash`。
5. **03 §6 的 150 条 Eval → ~50 条** —— 砍 100 条。
6. **03 §4.2 的 10 个 Skill → 4–5 个** —— 砍其余。
7. **03 §2 Episodic Memory + `mochi-episodic` 插件** —— 砍或 P1 末做；v1 只靠 Conversation+Working。
8. **01 §5.3 像素预览（soffice）+ 共享（Grant 链）** —— v1 砍；只留 create/read/export + 版本。
9. **01 §6 Companion 真实执行** —— 保持桩/P1，确认 v1 不开放真实执行（已 P1，列入以防被升级）。
10. **02 §4.4 的 25MB 受限分享链接机制** —— v1 简化为"超限直接失败"，不做受限链接兜底。

---

## 4. 补漏清单（三份都漏的关键坑）

1. **dsh 版本锁**：锁 commit/version 写入打包脚本，禁用 `@latest`（P0-7）。
2. **演示数据集 fixtures**：学生/班级/医务室/课表/资源/ clinic 状态 canned 数据（P1-8）。
3. **脚本化 demo 路径**：headless 录制 + 现场回放，或 `demo-auto-approver` 跑 CONFIRM demo，写进 demo runbook（P1-2/8）。
4. **统一迁移清单 `05_MIGRATION_CHECKLIST.md`**：从 `联动计划` 复制什么、改什么、风险（P1-9 / 硬指令3）。
5. **嘉行联后端可用性决策**：A2A demo 若需其后端，演示机必须预装并跑通；若选 R2 单机模拟则明确不依赖（P0-1）。
6. **桥接脚本工时**：02 §1.3/§2.2 的 `mochi_resources → mochi_agent_capabilities` 桥接、遗产 relay 只读桥，只提了"脚本"没排进任何阶段工时，需补估。
7. **未签名 app 现场放行预案**：03 §8.3 有思路，需固化成 demo runbook 第 0 步（预装+放行）。
8. **dsh breaking-change 监控**：订阅 release，26 天内若 rc 改 API 立即告警（P0-7）。

---

## 5. 修订后的统一口径（冲突项最终裁决，不和稀泥）

- **R1 工具总数**：P0 = **38**（以 01 §1.2 明细为准）。03 的"60+"作废；P1 的约 20 个工具不入 P0。Skill 层(03 §4.2)所有 `Tools:` 字段**逐条改写为 01 真实命名**（doc.create|read|edit|export / calendar.* / task.* / jxl.* / 无 user-questions）。
- **R2 A2A（最核心裁决）**：v1 **不建独立协调服务器**，改为**单机模拟**——"另一个 Mochi / Resource Agent"用本地第二个 dsh profile 或进程内 mock 扮演；human approval 由**桌面 APP 的 answerer 渲染确认卡**（不走 `subagent-acp`，因其 automation-only 无人确认，会破坏 02 的 APPROVAL_REQUIRED）。02 的 `mochi_tasks`/grants 表**仅作数据模型规范保留**，v1 用本地 mock 实现闭环。Golden Demo 1/2/3/4 在单机双 profile 演示。真跨网络 A2A 留答辩"下一步"。
- **R3 Artifact**：**01 本地 store（`<workspaceRoot>/.artifacts`，含版本链）为 v1 唯一事实源**。`path` 存本地绝对路径对 v1 合法（仅本机）。02 的 `mochi_artifacts`/`grants`/HMAC 下载链**降为"未来跨主体共享规范"，v1 不做**。跨主体"共享"在 v1 用桌面 APP 本地复制文件 + 确认卡代替。
- **R4 审批注册**：必须用 **`ctx.waterfall('approval/request', (req, next) => { AUTO→'allowed-once'; DENY→'rejected'; CONFIRM→next() })`**。桌面现场 `ask`（真人确认卡）；脚本/录屏 demo 用 `demo-auto-approver`（`allowed-once` for CONFIRM）；**绝不用 `never` 跑需 CONFIRM 的 demo**。
- **R5 遥测**：`mode: DISABLED`（默认即关），打包确保无 `mode: FULL`、无 `exporter.url`。
- **R6 前端任务态**：02 的 11 态映射为前端 **6 态**——`PENDING_SEND`(CREATED+DISPATCHING)、`RUNNING`(DELIVERED+WORKING)、`INPUT_REQUIRED`、`APPROVAL_REQUIRED`、`COMPLETED`、`TERMINATED`(DECLINED+FAILED+EXPIRED+CANCELLED，UI 文案区分)。
- **R7 UI**：直接复制 `联动计划` 的 ExpressiveOrb + `calm-tokens.css` 原样使用，**不新建设计语言**；删 03 §7.3 自建设计规范。Orb 绑定 AGENT_REASONING/TOOL_CALLING/DEGRADED 三态即可。
- **R8 硬指令2 边界**：Electron + WebView 是桌面 APP（合法）；`dsh --profile web` 浏览器部署版（非法，已砍）。两者不混淆。

---

## 6. 开工前最低动作（给用户的直话）

1. 先写 `05_MIGRATION_CHECKLIST.md`（复制清单 + 风险），满足硬指令3。
2. 锁 dsh 版本 commit（P0-7）。
3. 把 03 §4.2 的 Skill 工具名按 01 重写（P0-2）——这是不动代码就能做、且不做必崩的一步。
4. 把审批注册 `ctx.on` 改成 `ctx.waterfall`（P0-5①）——否则三态系统整体失效。
5. 按 R2 把 A2A 从"建服务器"改成"单机模拟"，从路线图删掉不存在的服务器工时。
6. 砍 Web 兜底、150 Eval、10 Skill、Episodic（砍刀清单）。

**以上 6 步不做，26 天后拼出来的东西会互相不认识。做了，P0 工具链 + 桌面 APP + 单机模拟 demo 在 26 天内可达成。**
