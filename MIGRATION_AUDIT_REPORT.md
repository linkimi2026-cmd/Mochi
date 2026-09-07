# Mochi 迁移工程审计

审计日期：2026-09-05。范围：附件《Teacher Agent Core / Memory / A2A / Work UX》的 **PHASE 0**。本文以本轮代码、运行进程、配置解析、界面和测试为证据，不将旧 WORKLOG 的完成声明当作验收结论。

## 结论：PARTIAL

**当前确实运行官方 DeepSeek Harness，不是旁置的 Lite/Fake Harness。迁移尚未通过完整工程验收。** 因而不进入 Memory、Artifact 等全面开发；先修复下面的迁移问题，再复验。本文的 PARTIAL 不表示完整产品已实现。

### 当前验收摘要（后续记录优先于初始基线）

下文第1–9节包含初次审计的历史状态；不能把其中旧PID、旧FAIL或旧PASS直接当作现在的结论。当前进展如下，仍未满足Phase 0整体通过条件：

| 项目 | 当前证据 | 尚缺什么 |
|---|---|---|
| Runtime配置 | 官方组合解析通过；canonical切换已完成，原home与D1路径保留，启动父命令退出后服务仍监听 | 全模式与长期运行验收 |
| Skill及过程 | 新会话真实Skill调用；原生过程可查看；GLM-4.7-Flash切换及前台Subagent→Skill返回成功 | 后台子代理曾RATE_LIMIT；其他模式未全部验收 |
| 会话历史 | 新会话可执行；一条旧会话发生内部序号冲突，已备份并保留原件 | 无损恢复尚未证明，原先Session基础PASS不能覆盖该问题 |
| 审批/账号隔离 | M02 fail-closed、M08来源与账号绑定、任务owner隔离的模块检查通过 | 双端真实审批、账号切换端到端 |
| Relay | root独立7隔离探针通过；双进程真实HTTP/登录/Worker-DB链路通过，重复同步无新增 | 双端模型与原生审批、A–O完整矩阵 |
| 校园回归 | canonical 44文件/382测试通过；Worker类型检查退出0 | 全角色业务UI及云端链路 |
| 视觉 | 校园插画正常；切换后920px待办与历史可用，319px统计双列及插画可见 | 319px仍有少量水平溢出；全路由/主题矩阵 |
| 打包 | 已打包app在临时home/随机端口启动并完成根文档loadURL；root核对退出0证据 | 组合包已通过，待切换后全部前端资源与校园登录验收 |
| 可复现性 | 源码与运行服务均已指向《联动计划》；37项源码与51项运行素材hash核对，补丁和清单已保存 | 既有dirty工作树不能仅凭base HEAD重建 |

上一目标轮分类为progress：root独立完成Dispatch/账号连接/7项探针复核，核对已打包app启动成功证据，并从真实校园工具返回发现来源标记丢失。继续完成现有迁移修复，不重新定义整体目标。

### 证据等级

- 已确认：本轮直接读取文件、运行命令或观察界面的结果。
- 合理推测：从现有实现推导的风险，需要针对性探针证明。
- 未验证：没有足够运行证据，不记为 PASS。

## 1. 当前真实 Harness 架构映射

```text
mochi.sh / Electron DshWebHost
  → @deepseek-ai/dsh 0.1.2-rc.1
  → mochi-web profile
      → 官方 dsh-base + dsh-web-app
      → 官方 standard Agent preset
      → Session / Agent Loop / Tools / Skills / Sandbox / Storage
      → 官方 Web client Cordis tree / Slots / Chat / Settings / Approval
      → mochi-campus → 校园 Worker 的已认证业务 API
      → mochi-dispatch → 本机任务 SQLite + 原有校园 Relay API
      → jxl-theme / jxl-brand / jxl-campus → 嘉行联视觉与校园页面
```

实际监听：PID 83990，`127.0.0.1:3090`。可执行入口为本机安装的 `@deepseek-ai/dsh/lib/bin.js`。进程实际 `DSH_HOME=/Users/a1379/Documents/Mochi/.mochi-home.nosync`、校园上游 `http://127.0.0.1:8787`。这里只记录非敏感配置，不记录凭据。

运行包 `dsh`、`dsh-base`、`dsh-web-app`、`dsh-tools`、`dsh-agent-loop`、`dsh-session-persistence-jsonl`、`dsh-sandbox`、`dsh-client-modules` 均现场读出 **0.1.2-rc.1**。`foundation/01_HARNESS_REALITY_AUDIT.md` 引用的 alpha 源码不能直接替代此版本的运行证据。

| 要求 | 结论 | 当前证据与限制 |
|---|---|---|
| 官方 Runtime / Agent loop | PASS（真实性） | 实际进程、已安装包、`--dump-config` 的 agent/agent-loop/llm/tools 节点；不是自写聊天循环 |
| Plugin system / Tool registry | PASS（装配） | 官方 Cordis 装配；校园 20 工具、Dispatch 5 工具注册测试通过 |
| Skills | PARTIAL | 官方 skill 服务与 standard preset 存在；本地 6 份 Skill，UI 清单是硬编码，真实运行探针另记 |
| Session / Storage | PASS（基础） | 官方持久化、session-query-sqlite、storage-domain 等被装配；浏览器恢复了既有真实会话 |
| Model switching | PARTIAL | 官方 llm-pi-ai、模型设置/选择插件被装配，界面显示 GLM-4-Flash；尚未证明每个配置 provider 均可调用 |
| Sandbox | PARTIAL | 官方 sandbox-local、sandbox-policy、permission、fs-sandbox 保留；尚未执行跨边界拒绝验收 |
| Runtime modes / Subagent | PARTIAL | 官方 standard preset、计划/子代理工具定义保留；未把包存在视为所有模式的 E2E 通过 |
| Trajectory | FAIL（可用入口） | 实际 profile 将 ui-trajectory 禁用；应该藏入“查看工作过程”，不能以删除能力达到简洁 |
| Web client plugin architecture | PASS（基本接入） | 官方 ui-renderer/slots，品牌与页脚通过 slot 注入，校园在同一文档嵌入 |
| 其他当前能力 | PARTIAL | goal、附件、文件引用、工作流、工作区、审批等装配存在；goal-round-driver、session-log-download 被禁用。dsh-browser、better-sidebar、ModSearch 未找到可用安装证据 |

注意：`--dump-config` 中部分宿主 tool 行为 disabled 是 **官方 web-app 把能力交给 standard Agent preset** 的实现，不能据此误判所有 Shell/Skills/Subagent 都被删。具体 preset 来自安装包 `dsh-agent-presets/presets/standard/agent.cordis.yml`。

## 2. Mochi 与嘉行联是否正确复用

- **PASS：没有第二套正在运行的独立 Chat App。** `apps/desktop/electron/main.ts` 通过 `DshWebHost` 承载相同官方 SPA。旧 renderer 仍在仓库，但不是此入口实际加载的聊天 UI。
- **PARTIAL：业务 API 已复用，源码仍存在复制分叉。** `mochi-campus` 走 `CampusConnection` 和已有 Worker API；但 `campus.nosync` 是完整实体复制目录，且被根 `.gitignore` 忽略，不是原仓依赖或可复现的版本化适配包。
- 本轮比对原 `联动计划` 与复制件：students/events/movements/messages/auth/permissions/audit 源码相同；assistant 路由不同，新增 Relay REST 存在于复制件。这证明核心模块未被本地改写，但不证明部署与行为全面无回归。
- **云端未切换完成。** 本轮公共 Cloudflare health 曾返回健康；当前真实进程仍使用本地 8787。不能把“云端入口健康”写成“Mochi 已连接云端并端到端验收”。

## 3. 当前 A2A 实现位置与真实性

| 层 | 位置 | 现状 |
|---|---|---|
| 校园 Relay 持久化 | `campus.nosync/migrations/0024_mochi_relay.sql` 及后续迁移 | 数据库传话/共享登记 |
| Relay 业务 | `campus.nosync/worker/routes/core/assistant.ts` 的 relayList、resolvePeer、relay/send、relay/respond、relay/find、relay/register | 已认证账号之间真实落库；不是 Harness 原生跨机 Agent 通信总线 |
| Harness 工具 | `plugins/mochi-campus/index.mjs` 的 jxl.relay_* | 工具调用已有 Relay；显式审批请求 |
| 任务封装 | `plugins/mochi-dispatch/index.mjs`、`store.mjs`、`state-machine.mjs` | ASK/REQUEST/FIND + respond；本地 SQLite、7 态机 |
| 对话呈现 | 官方工具消息 + 任务中文摘要 | 维持“对话即界面”，第 6 传话箱入口已撤下 |

现场只读数据库核对：Relay 6 条 accepted；本机任务 1 条 COMPLETED。已有成功数据是真实存在的，不是界面占位。**本轮尚未重新执行“林清→系统管理员→答复→原 Agent”的完整双端实时流程，历史成功不等同可靠性验收。**

已确认问题：Relay send 没有服务端幂等键；respond 的条件 UPDATE 未检查 affected rows；寻物 accept 在未命中资源时仍可能返回“找到了，这就给主人送去”。Dispatch 用 outgoing 最大 ID 推断当前投递 ID，小时桶幂等键存在边界风险。针对性探针正在隔离环境验证，详情将补到证据文件。

## 4. 当前 Memory 能力现状

| 层 | 已有实现 | 结论 |
|---|---|---|
| Conversation | 官方 Session 日志、上下文、compaction；校园 assistant-session 保留 600 秒结构化前次对象 | 已有基础，两个上下文来源并未统一 |
| Working | Dispatch 活跃任务 + TTL；校园短期 session | PARTIAL，不是完整可检索工作记忆 |
| User Profile | 未找到 mochi-memory 插件、偏好 CRUD 或关闭记忆 UI | 未实现 |
| Episodic | 旧 foundation 文档写 v1 不做，与新附件需求不同 | 未实现，后续以新附件为准 |
| Organization Knowledge | 本地 Skills/设计文档与业务 API | PARTIAL，尚无统一组织知识接口 |

未见五层统一 write/retrieve/update/forget/expire/inspect、Confidence、来源解释及用户可控 UI。保存全部会话和校园登录 token **不算**长期个人 Memory。

## 5. 当前 UI 结构与设计审计

- 官方 Sidebar（会话/工作区）+ 官方 Conversation/Composer + 官方 Settings/Models/Approval。
- 五个校园功能：班主任待办、学生放行与返班、班级协作消息、本班学生档案、本班事实统计；MemoryRouter 内部跳转，复用校园页面，无第二套侧栏。
- `jxl-theme` CSS token 桥、原校园插画/水母品牌；`jxl-brand` 真实 Mochi 球体与电脑；loading 共用 `MochiLoading`。
- **PARTIAL：** 已有品牌与设计资源，不能称 generic 空白聊天；但部分改造依赖 hash class/MutationObserver，缺少可靠 slot 状态绑定。首页与窄屏校园页面仍需完整视觉矩阵；不能只凭一张截图认定排版完成。
- “简洁”不应删除 Trajectory；应通过渐进披露进入原生工作过程。继续遵守最近用户裁定：传话/任务在对话中呈现，不新增企业 IM 或独立传话面板。

## 6. 本轮验证结果

| 验证 | 结果 | 覆盖边界 |
|---|---|---|
| `node plugins/mochi-campus/test.mjs` | PASS：20 工具、7 组 | stub 连接；不证明网络、认证或真实 D1 事务 |
| `node plugins/mochi-dispatch/test.mjs` | PASS：10 组 | 内存 SQLite/模拟 Relay；未覆盖完整 A–O Reliability 矩阵 |
| 校园 `vitest run` | FAIL：39 文件通过、5 文件失败；366 测试通过、8 失败 | 日志 `/tmp/mochi-phase0-campus-tests.log` |
| 校园 app 类型检查 | PASS | `tsc -p tsconfig.app.json --noEmit` |
| 校园 Worker 类型检查 | FAIL | `assistant.ts:1458` 未使用 user，TS6133 |
| Desktop 类型检查 | PASS | `tsc -p tsconfig.node.json --noEmit`；不证明安装包包含全部资源 |
| 原业务源码对比 | 7 个关键模块 SAME，assistant DIFF | 静态比对，不是角色/权限 E2E |

失败测试：build-asset-boundary 1、design-system 1、movement-journey-route 2、movements-page-reference 3、route-transition-and-network 1。部分 journey 断言可能落后于用户移除行程展示的裁定；应核对需求后更新测试，不能为了绿色测试恢复已取消功能，也不能无条件删除失败断言。

## 7. 需要先修复的问题

| 编号 | 严重性 | 已确认事实 | 验收要求 |
|---|---|---|---|
| M01 | P0 | `mochi.sh` 默认 `~/.mochi-home` 与当前运行 `.mochi-home.nosync` 不同，前者缺 Dispatch | 唯一可复现配置源；重启不能换成旧能力集；保留既有凭据/会话 |
| M02 | P0 | mochi profile 挂 `mochi-approval`，其 answerer 无条件 allowed-once | 删除自动放行行为；无 UI 时 fail-closed，Web 复用官方审批 |
| M03 | P0 | Electron 打包只列 4 个插件，缺 jxl-campus/dispatch，校园插件 filter 缺 connection.mjs；静态构建也未完整打包 | 安装包资源契约和解析验证通过，不依赖开发者绝对路径 |
| M04 | P1 | ui-trajectory 被禁用；旧文档的运行版本与安装版本不符 | 保留过程能力并渐进展示；按实际运行版本更新审计映射 |
| M05 | P0/P1 | A2A 当前只有 happy path 证据；幂等/并发/未命中真实资源等缺陷 | 定点修复 + 故障探针；保留原 Relay，不大重写 |
| M06 | P1 | 校园类型检查、8 个测试未通过 | 区分真实回归/过时契约，修复后重新跑相关检查 |
| M07 | P1 | 业务复制件与运行配置被忽略，修改无法从仓库复现 | 有明确上游版本/补丁/构建路径，不能再复制第二套业务事实 |
| M08 | P1 | 登录态与任务会话绑定仍需审计；未登录任务只报错，无法登录后续做 | 先保证账号隔离；自动继续作为后续明确 Change Map，不假称已有 |

## 8. 下一阶段具体 Change Map

1. **迁移修复（Phase 0 PARTIAL 路径）**：TerraMax 定点修 M01–M04/M06；主代理审计；M05/M08 先由隔离探针证明问题后交由 TerraMax 修复。保持用户原有数据，不重新造 Harness。
2. **Phase 0 复验**：运行版本/配置/官方工具/UI入口/安装包契约、原业务测试、现有 A2A 闭环逐条留证。任何未验证项不标 PASS。
3. **只有 Phase 0 PASS 才进入 Phase 1**：补齐附件 A–O，输出 `A2A_RELIABILITY_REPORT.md` 与成功/送达/回复/重复/超时/耗时指标；不要将现有 stub 10 组等同该矩阵。
4. 后续 P0：自然模型对话、五层 Memory、Task Runtime。复用官方 Session/Tools/Skills/Sandbox；不写关键词脚本代替最终自然回答。
5. 后续 P1：扩展现有 Dispatch 生命周期、Artifact Grant、结构化 Capability Discovery、具体审批；不得跨 Agent 共享绝对路径。
6. 后续 P2/P3：办公真实产物、十页班会 PPT 局部编辑 Golden Flow、克制 Work UX、十份教师 Skills、登录后原任务继续、用户主动 Browser Chat Bridge 与 Handoff Capsule。
7. 学生大规模 UI 不在当前阶段。附件全部 Golden Demo 仍是后续验收目标，不能用 Phase 0 审计通过代替产品完成。

## 直接可复用的能力

官方 Runtime、Cordis、工具执行流水线、Session/Fork/Resume/文件引用、Sandbox/Approval、原生模型设置与客户端 Slots；现有嘉行联角色权限/学生/流动/医务/消息/审计；现有 Relay 数据与 API；原插画、字体与 Mochi 组件。Office/Browser/长期 Memory/跨 Agent Artifact Grant 未验证可用前，不得在产品中宣称已完成。

## 9. 本轮追加实证与执行中断（17:05 历史记录）

### 真实会话与视觉复核

在 3090 的官方 standard 模式新建只读验收会话“AI技能使用说明”。模型实际选择并执行 `skill`，说明真实模型→工具→结果→回答循环工作；但 `teacher-daily-brief` 返回 `Skill Error: skill "teacher-daily-brief" is unknown or no longer available`。因此 **Skills 的内容接入从 PARTIAL 修正为 FAIL**，不能用设置里的硬编码技能列表证明真实可用。修复应将自定义 Skill 根接入真实 standard preset 的 catalog，不再造一套加载器。

473px 视口下，班主任待办实际打开，校园楼宇和银杏插画图片均加载成功。但主容器 `.painterly-page` 继承原独立站 `margin: 0 -16px`，在无外部页面 padding 的嵌入容器里形成 `x=-16,width=497`，子容器宽 465。这解释了内容贴边和被裁切：documentWidth 未超过 viewport 不能证明没有内部溢出。应在嵌入边界消除独立站负边距，随后复核桌面/移动/亮暗主题，保留所有既定视觉资源。

### TerraMax 隔离探针验收

源文件：`artifacts/migration-audit/probes.mjs`；主代理复跑：`node artifacts/migration-audit/probes.mjs`。结果：`artifacts/migration-audit/probes-results.json`。全部使用内存 SQLite、临时登录文件和 stub fetch，不访问真实数据库、不发送任何真实消息。

**机器汇总“5 FAIL”不能直接解读为 5 个已证明产品缺陷。实际是 4 个有效失败证据 + 1 个探针自身错误。脚本退出码为 0 也不表示通过。**

| 探针 | 有效结论 | 证据边界 |
|---|---|---|
| Relay ID 关联 | FAIL：期待 910，实际任务关联到不相干的 9999 | 真实插件+模拟合法响应形状；服务端 INSERT 后再读全量 outgoing，允许并发混入；未执行公网并发压测 |
| 跨小时重试 | FAIL：相隔 1ms 的同一请求因小时桶改变创建任务 1 和 2 | 真实 key/store，证明本地任务去重缺口，不宣称已经造成真实重复通知 |
| 确定失败后重试 | FAIL：终态不回退有效，但 UNIQUE key 使再次请求只返回旧 FAILED，transportAttempts=1 | 需要显式失败恢复语义，不能让用户永久卡在旧失败任务 |
| 登录态恢复 | FAIL：保存记录没有 origin，恢复时会把令牌发给当前新地址，且不比较原 user ID | 不证明令牌能跨服务器登录；证明客户端错误发送与账户绑定缺口。新会话继承当前已验证账号本身可以是产品设计，不能单凭这一点断言越权 |
| 同名账号/回应隔离 | INVALID：`sameDisplayNameLeak` 未定义（实际变量是 sameNameLeak） | 此项必须由 TerraMax 修正探针后重测，不能计入有效 FAIL |

源码另已确认：tasks 以 `to_peer_name === binding.user.name` 过滤、respond 缺任务 owner 检查。后端仍有 `to_user_id=?` 防线，因此只能报告客户端隔离/确认语义风险，不能称已证明可替另一真实账号回应。

### 当前修复状态

已将 M01/M02/M03/M04/真实 Skill catalog 的定点修复派给 TerraMax；另一个 TerraMax 任务负责探针。三个实际子代理（含探针子任务）均被服务返回的 usage limit 终止，工具提示可于 21:37 重试。主代理随后查询额度失败，无法进一步确认具体配额窗口。

**生产修复没有交付证据，不计完成。** 运行脚本、桌面打包配置、审批占位实现的文件时间仍早于本轮委派。主代理遵照“只审计、由 TerraMax 编程”的用户要求，没有接替编程，也没有改用其他模型。

下次恢复时按顺序：修正探针变量并补退出码；移除自动批准；修复 Skill catalog 与唯一配置源；定点修正 A2A 的 ownership/origin/idempotency/correlation/未命中提示；修复打包资源；再处理过时测试和嵌入边距。当前报告仍为 **PARTIAL**，Phase 1 和后续功能没有获工程验收通过。

## 10. 目标更新与恢复验收（2026-09-05）

最新目标以 `eda17ff3-e312-4eac-b7b5-abcde34d6649/goal-objective.md` 为准：阶段 0 增补办公能力/依赖/运行位置盘点；迁移修复后首批聚焦可编辑 Word、可复核成绩 Excel、可指定页修改的 PPT。教务排课纳入独立范围；保留原生模型切换，强模型调用由用户随后提供 API key 再验证。详细证据见 `artifacts/migration-audit/TEACHER_CAPABILITY_INVENTORY.md`。本节更新优先于第 8 节历史推进顺序。

TerraMax 已修复探针变量并区分 INVALID；主代理再次运行，语法检查通过，runner 退出 1，结果为 **5 个有效 FAIL、0 INVALID**。第 9 节的 4 FAIL + 1 INVALID 已是历史状态。同名账号模块证实任务列表泄漏和本地 respond 缺 owner 检查，仍不证明远端 API 允许越权回应。来源/账号绑定探针同样不能把全新会话继承当前合法登录一概判为越权。

用户允许多 Agent 协作，代码继续仅由 TerraMax 编写。当前并行修复范围：真实 Skill catalog、无 UI 审批自动放行、登录来源和账号绑定。产物未审计前不计为修复完成。全局结论仍为 **PARTIAL**。

### M02 局部修复验收

TerraMax 将 `apps/desktop/electron/dsh/mochi-approval/index.mjs` 改为委托官方 waterfall 的兼容 adapter；本身不生成允许决定，下游缺失、异常或返回无效值时为 unavailable。主代理已读实现，并用实际 Harness Node 22.22.2 复跑该目录 test.mjs，通过无 answerer、拒绝、显式下游允许、异常和真实 Cordis waterfall 测试。对应源码缺陷局部修复通过；不以此代替桌面完整人工审批 UI 验收，也未重启当前服务。

### M08 来源/账号绑定局部修复验收

TerraMax 在 connection.mjs 保存 origin，恢复前校验来源、保存账号与 auth/me 账号；旧无来源记录要求重新认证，零次向新来源发送旧令牌。加入登录代次和探测序号，阻止登出后的晚响应复活旧登录、旧恢复覆盖新账号，以及并发探测乱序。主代理曾退回一个会阻止正常 A→B cookie 换号的初稿，修订后已读代码并以实际 Node 22.22.2 复跑 11 组 connection 隔离检查与现有 7 组 campus stub 回归，全部通过。

兼容影响：首次恢复旧格式持久化记录时需要重新验证校园登录；新对话仍可使用本机同来源已验证账号。未改/读取真实凭据文件，未重启正在运行的 Harness；生产激活和浏览器跨账号端到端仍待复验。总探针 JSON 保留修复前基线，当前以新增 connection.test.mjs 的复验为准，不把旧基线的 FAIL 当成修复后状态。

### Skills 目录局部修复验收

版本化 mochi-web 模板与两份现有非凭据 profile 已显式启用 host skill-filesystem。主代理已读 test-profile-skills.mjs，并用实际 Harness Node 22.22.2 独立复跑通过：临时无凭据 DSH_HOME 启动官方 base/web，创建 standard 会话，真实 sessionSkillCatalog 列出 6 个 Mochi 技能，skills.get 能读取 teacher-daily-brief，原生 skill 工具仍存在。该证据高于纯文件存在检查，但不包含现有3090重启后的真实模型加载；当前运行复验仍保留待办。

### 嵌入布局局部复验

TerraMax 在真实源码 `foundation/ui/jxl-workspace.css` 的校园嵌入根选择器设置 inline-size/max-inline-size 为100%、margin-inline为0，并通过现有 jxl-theme 构建生成 client.js。主代理新开真实页面后，1280px视口的 main 与 mochi-widget-content 均 x=289、width=974、margin=0；楼宇和银杏图片均实际加载，截图保留内容留白。窄屏319px旧标签页尚未整页载入新样式，窄屏和亮暗全路由不计通过。

### Dispatch 账号归属局部复验

TerraMax 增加 owner_user_id，授权 incoming 视图以当前已验证账号 ID 写入镜像，镜像键包含 owner；列表按 owner 查询，respond 在人工确认前拒绝非 owner，确认后保留 expectedUserId。迁移保留历史行，旧出站以稳定 from_user_id 回填，无法证明归属的旧入站不按显示名认领。主代理已读实现，实际 Node22 复跑 12 组测试通过，含同名不同账号隔离和非 owner 零审批/零应答请求。远端 to_user_id 最终防线未修改。

审计探针运行记录更新：子代理为兼容检查重跑旧 runner，probes-results.json 已被覆盖为3 FAIL+2 INVALID；INVALID来自已修复契约下的旧夹具，不证明新产品缺陷。已要求 TerraMax 只更新对应探针来验证修复，并保留其余未修复失败。此前5 FAIL基线保留于本文历史章节，不再宣称当前 JSON 仍是旧基线。

### 当前总探针复跑

owner/origin 探针已按新契约更新，主代理以实际 Node22 复跑：**2 PASS / 3 FAIL / 0 INVALID，退出1**。账号列表/回应归属和来源/账号恢复已通过模块探针；Relay关联、小时边界幂等和失败恢复仍未通过。这仍是隔离模块证据，不是完整A2A端到端验收。

主代理另复跑 `campus.nosync/node_modules/.bin/tsc -p tsconfig.worker.json --noEmit`，退出0。TS6133已局部解决。

## 11. 续轮复验（2026-09-05）

上一目标轮有代码修复与独立验收证据，分类为 progress。本轮依据当前工作树继续，不以旧报告当作当前通过证明。

校园回归：主代理已审计5个测试的契约更新并以实际Harness Node22复跑全套，44文件/374测试通过；日志为 `artifacts/migration-audit/campus-regression-current.log`。旧journey入口断言改为不可达与当前详情路由守卫，视觉资产保留与.dev.vars排除仍有断言。此为既有测试覆盖范围，不能等同所有角色UI/业务端到端。

Relay关联：服务端send返回本次INSERT的last_row_id为relayMessageId，客户端只接受正安全整数；列表最大ID不再参与关联。主代理已读实现、复跑Dispatch测试通过，并核对Hono+内存SQLite D1契约测试在插入本次ID1后混入ID2，仍返回ID1。缺失或畸形ID保持结果不明、不自动重发。新响应为添加字段，保留原relay列表。公网/当前服务尚未激活复验。

启动生成器仍在修订审计：要求开发CLI和desktop保留当前workspace/.mochi-home.nosync，显式环境覆盖优先；保留用户patch与额外bundle，并在所有资源完整校验后写入。尚不计M01完成。

## 12. 启动与处理器复验（2026-09-05）

主代理已审计M01生成器修订并以实际Node22运行test-runtime-profile，通过临时home的三profile配置解析、重复生成、用户字段/额外bundle/空数组与引号ID兼容、缺资源预校验。证据是官方 `--dump-config` 配置解析，不等同实际服务完整启动；测试结尾的booted措辞不得扩大解释。

更新总探针由主代理复跑：3 PASS / 2 FAIL / 0 INVALID。关联探针包含910准确ID优先于9999列表最大值，以及缺失/字符串/零ID的单次投递保护；跨小时幂等与FAILED恢复仍失败。

回应处理器局部复验：主代理读代码并运行assistant-natural-language目标19项测试通过。空登记命中不再说找到或送达；登记命中也只确认登记存在；并发条件更新必须changes=1，否则409且不重复成功审计。当前仍是Relay确认语义，不代表FIND Artifact生命周期或真实文件交付完成。

真实服务状态变化：主代理与TerraMax各自确认3090/8787无监听、旧PID83990不存在、curl3090连接拒绝。已经明确授权runtime_fix备份非凭据profile配置，在同一工作区数据目录受控接入并恢复既有服务入口。不得把这次确认停止当作普通观测超时。M03打包完整性与M04原生过程入口由其余TerraMax并行处理；全局仍PARTIAL。

### 恢复服务后的实际历史错误

runtime_fix已恢复3090/8787并报告PID13384/13403、同一workspace/.mochi-home.nosync，配置备份位于用户home下权限700的mochi-runtime-config-backups/20260905-180806-m01。主代理通过浏览器确认页面可打开，原生“查看工作过程”标签已出现。

但旧验收会话 `session-dee14347-cf33-487b-8e2e-7b90963f639e` 报 `corrupt session log: seq gap in committed region at line 26 (expected 61, got 3)`。这是新的P0历史可用性问题，不能计Session恢复PASS；已要求TerraMax只做备份和非破坏诊断，不能删除、截断或重编号来掩盖错误。尚未确认成因，不归因于本轮配置或官方版本。主代理保留旧输入草稿，新建独立只读验收会话继续检查技能，以区分历史读取问题与新会话工具能力。

### 新会话与原生过程实测

主代理在恢复后的3090创建只读会话 Read-Only Migration Verification，要求只加载 teacher-daily-brief、不查询校园数据、不发送或改文件。GLM-4-Flash 实际调用 skill，展开工具返回可见对应本地 Skill 正文；官方“查看工作过程”显示用户输入、两次模型请求和 skill 参数/结果。此处确认真实模型→Skill及原生过程的当前链路，不能扩展为所有工具、子代理、沙箱事件均已验收。该轮UI报告输入31.3K tokens、输出50、LLM约7.9秒；费用未核算。

过程中的 runtime context 将新会话 workspace 指向 WorkBuddy 的 node/workspace，已要求只读核查默认目录来源，尚未改动用户工作区。

同一新载入标签页打开班主任待办，567px视口中容器与main均x=0、width=559、margin-inline=0；四张图片均加载成功，包括银杏校园道路插画。已补充窄窗口边距证据，319px及所有路由/主题仍未覆盖。加载期间可见“Mochi 正在打开页面”状态。

旧日志初步诊断（TerraMax报告，尚待root复核元数据）：21个完整Zstd帧，58行/128事件；首个序号冲突出现在第26个存储行，expected61/got3，agent/inbox/spliced。不是尾部截断的已知自动恢复情形。备份路径为 ~/.mochi-runtime-config-backups/20260905102550-session-forensics；原日志未修改。

最新校园全套回归由主代理以实际Node22再运行：44文件/378测试通过，进程退出0；current日志已更新。新增回应处理器测试纳入此轮。M03 staging初稿清理目录范围过宽已退回TerraMax收紧，尚不验收打包完成。

旧日志framing/logical元数据已由主代理只读复核：21完整帧、0尾部片段、连续前缀61事件、line26期望61实际3。TerraMax进一步报告两段分别seq0–60与seq3–69，重叠事件内容均不同；仍不能确定写者。已要求恢复方案同时考虑两段，禁止只截取前段并宣称完整恢复。

## 13. 当前运行版本与恢复候选复核

主代理通过 ps 的 comm 字段确认恢复后PID13384实际为 ~/.nvm/versions/node/v24.19.0/bin/node。先前“实际Harness Node22”的描述仅适用于恢复前及指定Node22运行的测试，不能继续当作当前服务版本。已按Node24独立复跑审批/账号绑定测试及校园全套44文件378测试，全部通过；完整日志为 artifacts/migration-audit/campus-regression-node24.log。未据此推断Node变化与历史损坏存在因果关系。

恢复候选元数据已审计：A保留物理seq0–60；B用原始seq0–2接物理后段seq3–69。官方Session.fromRestore在内存接受两者且无需interrupted closer，但这只能证明候选结构可恢复，不能证明完整语义或用户应保留哪条分支。已授权TerraMax仅在两个独立受限recovery home中构建和inspect，原home/原会话不改。

M07只读补充：原联动计划仓库HEAD为462ff99db2a02e4e88f696c6842e7766e6880569，同时存在大量已修改与未跟踪的业务/视觉材料；不能直接checkout该HEAD冒充当前上游，也不能重置其工作树来简化复现。后续需要保留这些已存在修改的来源与适配边界。

### 原生文件权限与模型切换实际验收

主代理CUA在workspace为WorkBuddy node/workspace的验收会话中，请求原生write创建Mochi仓库audit目录下的permission-probe.txt。普通写入被[sandbox: file access denied under workspace-write mode]阻断。中间一次主代理提示误用了Codex的require_escalated枚举，属于验收输入错误，不计产品缺陷；另两次模型漏传justification，体现当前模型参数组织局限，不证明审批服务不可用。核对已安装dsh-tool-fs schema后，用danger-full-access及非空justification触发真实官方审批卡；主代理选择拒绝，模型返回用户拒绝，shell独立确认文件始终不存在。覆盖普通越界拒绝和Web人工拒绝，不覆盖所有工具/允许一次/平台边界。

同一会话通过原生选择器切换到GLM-4.7-Flash，发送纯文本验收，不调用工具，实际返回“模型调用成功。”，UI报告约35秒。确认当前已配置模型的选择与一次真实推理链路；复杂教师任务质量、用户未来提供的新provider/key均未验收。

新标签页重新载入此前验收会话，原生过程视图仍可读取teacher-daily-brief工具参数与真实返回，无历史加载失败；仅该新会话的恢复获实测，旧冲突日志仍未完整恢复。

UI补充缺陷：运行/等待审批期间，多个既往助手消息同时显示“Mochi正在调用工具”，源码build.mjs以会话全局运行态扫描所有消息头；应限定到当前活动消息，保留统一Mochi素材。尚未修复。

恢复候选A/B的offline-session-persistence-inspect.json已由root读元数据：A61事件、B70事件，均accepted，inspect前后hash不变。它们为独立受限工件，没有写入原home，也不意味着原损坏会话已修复。

### 原生Subagent实际探针与当前限制

GLM-4.7-Flash通过原生subagent创建后台子任务 f9f57ae0-22a3-4bd9-b4b0-e29fb546daa2，官方面包屑出现子会话，子会话可打开。主代理进入该子会话确认实际失败为模型服务RATE_LIMIT，五次内置重试后结束（0 tokens/约15秒）；不能把启动成功算任务完成。父模型另将subagent ID用于job工具，报unknown job；在子代理settled之前还曾无依据声称子代理已读Skill，随后在失败通知后更正。这是当前模型工具使用/结果依据方面的实际不足，未证明Runtime本身丢失子代理。主对话仍可用，未发生整体崩溃；成功Subagent结果交付仍待复验。

打包进展（TerraMax报告，root待查app）：Python3.11解决distutils，但better-sqlite3@11.10对Electron39编译失败。root核对main→DshWebHost实际导入链与agent的npm依赖树，确认该组件仅用于历史db模块/迁移测试，移至devDependencies更符合当前云端业务复用边界。源码与测试保留，未迁移/修改真实DB。定点调整后完整native rebuild的electron-builder dir通过，不再携带该历史组件。lock补齐manifest已有dsh0.1.2-rc.1闭包，无本机file:/link锁项。

研究依据：[上游GetIsolate问题](https://github.com/WiseLibs/better-sqlite3/issues/1416)。GitHub有12.12.0发布标签，但当前registry实际ETARGET，未据搜索结果盲目升级；最终采用移出未使用生产依赖的路径。

### Subagent前台成功复验

在确认先前后台子会话已因RATE_LIMIT终止后，主代理做一次明确限定的前台subagent（run_in_background:false）验收。官方工具返回Skill限制正文，主模型据此转述；root进入“一次性”子会话，展开记录确认其中真实调用了skill teacher-daily-brief，UI报告26.9K tokens/约4秒，父轮约13秒。据此确认原生前台Subagent→Skill→结果返回链路当前可用。后台并发限流和错误job等待仍保留为前次真实失败，不能扩展为所有子代理模式/模型均可靠。

M03实际app smoke补充：资源和native dir构建虽通过，隔离启动仍报mochi-hello ESM解析失败；profile-local link已存在。已授权TerraMax审查官方loader的asar/基准URL，不能删除插件换取启动。M03保持未通过直到同一真实app smoke通过。

M05新代码审计退回三项：legacy fingerprint未关联可验证旧任务、newTask成功promise永久缓存、DISPATCHING中断后PENDING过期可绕过未知投递。Agent正在定点修正，当前5PASS的隔离探针不能代替这些缺口验收。

### 本轮追加复核：M05 与校园只读调用

主代理在 Node24.19.0 独立执行当前 mochi-dispatch/test.mjs、mochi-campus/connection.test.mjs 和 migration-audit/probes.mjs，全部通过；探针为 7 PASS / 0 FAIL / 0 INVALID。覆盖 legacy 按 owner/type/规范化对端限定、可恢复未投递重试及 UNKNOWN 崩溃/过期阻断；仅临时 SQLite 与 stub transport，不代表真实跨账号端到端投递完成。

当前验收会话的第8轮通过真实原生工具调用 jxl.campus_status(topic=notice) 返回成功，约2分08秒。模型回答“没有 dataMode: demo 因此不是演示数据”不成立。root 展开工具详情并核对源码：聚合工具将 source 写死为 campus-api，没有透传 connection 提供的 dataMode；topic 本身只作提示并不限制结果。只能确认接口调用成功，不能从缺失标记证明真实生产数据。已交付 TerraMax 审查来源透传与部分请求失败被当作空数据的问题；报告不记录业务个人明细。

M03 TerraMax 报告最新真实隔离 app smoke 已通过：使用 Builder 既有 app.asar.unpacked 中的实体 DSH 入口，使官方 profile fallback 文件链接不再指入虚拟 asar；Electron run-as-Node 使用官方 loader 所需 --expose-internals。root 已读 web-host 源码，正在核对实际 smoke 证据；最终需与 M07 分离构建产物组合复验，不以打包脚本测试代替安装包启动。

M03证据更新：root读取 `/tmp/mochi-m03-packaged-smoke-latest.log` 的脱敏结果，exitCode=0、smokeReady=true、无 missing module。源码确认成功标记在 BrowserWindow.loadURL 完成之后；此次证明隔离 HOME/DSH_HOME/随机端口的已打包 Harness 启动及根文档加载，不覆盖全部前端资源、校园登录或模型推理。root另独立运行 test-web-host-runtime.mjs 通过。与M07新产物路径的最终组合验证仍待完成。

## 14. 持续验收：官方能力保留与双模式构建

本轮重新读取完整目标及附文，上一轮分类为progress。root只负责审计，三名既有TerraMax继续各自编程所有权。

官方能力保留：源码确认web.patch曾禁用goal-round-driver、session-stats、session-log-download，均是官方0.1.2-rc.1原有节点。TerraMax已移除这三项本地覆盖，保持官方driver的显式arm、轮数上限及取消语义；root独立运行test-runtime-profile.mjs通过。证据仅为隔离home下官方dump-config装配，不是自动goal模型执行；未额外启动真实目标或导出用户历史。

视觉复核：新建隐藏浏览器tab9重新打开当前3090，深色1280px校园待办页面的楼宇插画正常，四列统计与容器边界可见。当前静态widget-dashboard.js和8787 health均HTTP200。此为当前服务旧产物的可用性证据，不冒充M07新构建的组合验收。

头像修复：root读生成器并独立运行avatar-lifecycle.test.mjs通过，验证文字streaming阶段唯一活动头像、历史idle等隔离行为。但首token等待、工具运行和审批阶段的统一Mochi指示尚未证明，已退回补齐；未把这项窄测试记为全部加载状态完成。

M07双模式已采用默认HTML网页与显式Mochi静态输出，Mochi模式不加载Cloudflare Worker插件，避免写部署重定向。正式默认构建的资产校验拒绝7个创作/QA目录：要求先以引用和runtime等价物核对，禁止按目录名盲删图片。已授权仅精准排除确认无运行消费者的7个目录，保留源码原件及全部运行视觉资源，并要求最终引用资源校验。统一来源resolver及新产物组合仍在执行。

M07共享路径解析器初审：默认校园源码已选择canonical sibling，D1状态独立保留legacy `.wrangler/state`，启动器显式传--persist-to；未据此重启服务。root发现初稿resolveCampusPaths无条件要求源码目录，若安装包静态服务直接使用会在只有产物、无src的环境失败。已退回增加独立静态资源解析边界，并要求M03最终真实app验证覆盖无源码环境。此问题来自当前源码审查，不是已观察到当前3090故障。

## 15. A2A验收范围与校园工具契约补充

已新增 A2A_RELIABILITY_REPORT.md：覆盖用户要求的A–O逐项证据/缺口及六项指标定义；当前均不提供未经采集证明的业务成功率，也不把7个隔离探针当作端到端通过。

校园状态契约的新增确认：shared/movement.ts定义OUTBOUND、ARRIVED、RETURNING、CLOSED、CANCELLED，INFIRMARY与DORMITORY为目的地。现插件将目的地混入OPEN_STATUSES、漏RETURNING，用户侧in_clinic等枚举又直接与业务status大写比对，确有误返回空数组风险。另真实movements接口只接受active/destination，服务层LIMIT100，没有总数/分页；插件limit=50并不限制该接口。已交TerraMax按真实契约定点修复，结果数量应标明返回范围，不能宣称精确全量。

root独立复跑共享校园路径测试与启动器zsh语法检查通过。独立static解析分支支持显式静态目录/打包资源，无源码环境用例已在测试中覆盖；后续还需确认开发机同时有legacy产物时不会误走packaged优先级，以及真正打包运行的组合结果。

M07 canonical构建的root追加证据：实际 `联动计划/mochi-dist/client/assets` 已存在embed及六个widget入口。root依据DashboardPage.tsx的真实引用，逐一比较教学楼与银杏步道两张runtime WebP的public源文件和新构建文件SHA-256，均完全一致（c210cc63…a555b、535a3bdc…c5872）。这证明两项实际页面背景未被剥离或替换，不扩大为全资产矩阵通过。中文源码路径还暴露new URL().pathname百分号编码问题，TerraMax已改fileURLToPath并报告canonical构建通过。

## 16. Canonical源码与组合前复核

主代理在原联动计划仓库独立执行完整Vitest：44文件/382测试通过；Worker tsc退出0。另通过pnpm exec node核对实际测试Node为v24.19.0（/usr/local/bin/node），日志为artifacts/migration-audit/canonical-regression-node24.log。TerraMax确认之后不再改业务/测试源。

root独立读取并核对M07_FINAL_MANIFEST：37个列入本轮清单的源码文件与canonical/copy现场hash均一致，无漂移；两个构建目录内全部51个保留public/assets文件与public原件逐一SHA-256比较，均一致。base HEAD仅表示基准，既有未提交/未跟踪用户改动仍保留，不宣称checkout该commit即重建完整工作树。

root独立通过static-root与campus-paths测试，当前开发解析实际返回联动计划/mochi-dist/client。带受管marker的安装包分支不读取canonical源码；无marker的legacy dist不会覆盖canonical。build-loading与brand主bundle均通过共享source resolver读取canonical组件，未再复制一套Mochi组件。

新版头像bundle语法检查及完整pending生命周期隔离测试由root独立通过。覆盖首token/tool、streaming独占、审批附加及清理；原生approval.detail为已占用single slot，故通过官方pending interaction key匹配DOM追加，未替换原生详情/按钮。仍需组合重启后的真实UI验收，不把DOM替身测试视为浏览器结果。

A2A后续已限定为两个独立进程/home、真实HTTP和真实Worker/DB的集成探针；要求尽可能复用真实auth。确定性审批输入不等于原生人工审批UI，因此不会将其命名为完整Harness双端模型E2E。

## 17. 双进程传话与切换前基线

root 独立使用 Harness Node22 执行 a2a-e2e/vitest.config.mjs：1文件/1测试通过（2026-09-05 20:32）。已读探针源码，使用 canonical Worker 完整 app、真实 auth/login 与 requireAuth、内存 SQLite D1 adapter，以及两个独立 Dispatch/CampusConnection 子进程和临时 home。结果为两次登录恢复、未认证拒绝、一条 relay、send/respond 各一次、两端本地任务各一条，重复同步无新增。这是插件→HTTP→Worker/DB 集成证据；确定性审批输入不代表原生审批 UI 或模型端到端成功，也不是 Cloudflare workerd 运行时验收。

运行切换前 D1 元数据已由 TerraMax 只读采集：仅真实 D1 数据库，user_version=0、应用表36、迁移25、users9、students24；未读取业务字段。3090仍为原 home，8787仍为legacy cwd，无服务重启。root 新建浏览器验收页看到当前 Read-Only Migration Verification 已完成，输入框空闲、发送按钮因无输入禁用，未见运行停止按钮；此为选中会话可见状态，不替代执行切换前全局状态核对。

校园插件原有7组与新增4组聚合测试已由root独立通过。但继续对照实际events契约发现终态列表仍不符（实际为已返班、家长接走、转诊、记录结束），且分页与不支持的overdue筛选需明确。已退回定点修复；最终组合打包冻结暂缓至该缺口关闭。

## 18. 最终组合包冻结

root 独立通过最终校园聚合测试，并读断言确认覆盖真实医务终态、分页、unsupported超时筛选及部分缺dataMode。此前退回问题已关闭，且未改变写入与鉴权路径。

TerraMax完成源冻结后的唯一最终dir构建及隔离smoke。root随后逐一比较实际Mochi.app/Contents/Resources/mochi中的campus index、brand client、static-root与源文件SHA，三项一致；受管marker内容正确。root读取受限 /tmp/mochi-m03-final-packaged-smoke.log，包含MOCHI_DESKTOP_SMOKE_OK及随机loopback端口，无模块错误。此结果证明该实际包的官方Harness启动和根文档loadURL，尚不证明全部前端请求或模型调用。

官方profile解析和web-host运行参数测试再次通过；前者输出已准确改为parsed composition，未声称执行模型。root已下达受控切换指令，保留既有home和D1持久化路径；本节写入时切换尚未完成，不预记新PID或UI结果。

### 受控切换首次失败（未记通过）

TerraMax报告本次启动等待40轮后校园8787仍无listener（HTTP000）；新Harness3090 PID39147启动且返回认证401。root已要求仅停止本次新进程并恢复原启动输入，再定位真实错误，不因超时直接循环重启。最终包smoke通过并未覆盖本机canonical Worker启动，本次结果进一步确认该证据边界。

root读取mochi-dev-up.sh发现其等待结束后无失败分支，任意非000会被判就绪（含500），40轮耗尽仍输出入口并退出0；已交原责任TerraMax修复明确health判定与非零失败退出。此为当前源码确认的问题，具体8787失败根因仍待受限日志核对。

## 19. 原服务恢复与真实pending可见性缺口

原输入恢复最初nohup方式未保持存活，root实测两份rollback pid文件均ProcessLookupError、两端口无listener。TerraMax改用保留live exec句柄恢复：校园session84702、workerd40062；Harness session74051、Node40134。root独立lsof确认两端口监听，并GET /api/health得到200。未将原输入恢复等同canonical切换完成。

root新建隐藏tab12打开3090，原Read-Only Migration Verification八轮历史恢复可见，输入可用。发一次只读Skill加载验收；DOM观察到唯一flow pending、streaming0，但1280×720截图没有可见Mochi，新用户消息下方即composer。模型随后RATE_LIMIT五次重试/约9秒结束，pending清理；未实际执行Skill，不能据此声称工具/streaming/审批全链路通过。真实可见性问题已交brand责任TerraMax定点检查；静态DOM隔离测试不能覆盖该问题。

## 20. 跨轮运行状态与启动证据复核

新一轮root现场lsof未找到3090/8787 listener；write_stdin旧84702与74051均返回Unknown process id。此前恢复成功只证明当时可用，不能表示服务持续存活。已通知并恢复原责任TerraMax继续处理，不因pid文件或旧报告推断进程存在。

root读取canonical-campus-failure.json：首次失败日志bytes=0，却把缺assets.directory记为errorCategory；配置确实缺字段、生成配置有该字段是已确认事实，但不足以证明首次进程退出原因。已退回要求隔离复现或降级为合理推测。

root另读test-mochi-dev-up.mjs发现fixture mock nohup之后重定向仍指向真实/tmp服务日志，测试可截断这些日志；故未运行该测试，要求日志路径注入并使用fixture目录。

已核对《联动计划》的package scripts、README与环境文件键名；现有前后端配置存在，原README本地入口是pnpm dev，未重做setup或重置数据。root调用现有Wrangler dev --help确认支持--config、--env-file与--persist-to，并检索Cloudflare官方文档/GitHub环境文件实现。官方默认从config同目录读取环境文件，因此改为生成config时需要显式核对原.dev.vars加载，不能以健康200代替该项配置正确性。来源：https://developers.cloudflare.com/workers/local-development/environment-variables/ 和 https://github.com/cloudflare/workers-sdk/discussions/9394 。

先前brand责任agent不再存在于live树，root已新建TerraMax loading_visibility_fix继承原文件所有权与实际UI缺陷，避免放弃待修问题；root仍只审计。

临时恢复追加：TerraMax以live session8419/60390恢复，root独立lsof确认workerd54434@8787与Node54598@3090；agent健康探针报告200/401与embed200。此次仅记当前监听，持久脱离工具会话的运行方式仍待测试，不再把live句柄本身当跨轮稳定证据。

## 21. 加载组件真实界面通过的范围

本轮开始root lsof确认54434/54598仍监听，已跨上一轮存活；不因此声称长期稳定。

root对当前source profile重新发只读Skill请求，实际工具行出现并回答读取成功，用时4秒。首token等待DOM实测pending挂在data-composer-seat，矩形x705.25/y558/w141.49/h34。随后发原生write审批探针并在同次浏览器调用立即截图，清楚可见输入框上方Mochi正在处理及orb+laptop。此前20:58截图对应旧flow-tail实现，21:06既有seat修复已有效；新TerraMax审查后未再叠加猜测代码。

真实审批卡出现时，唯一pending variant=approval，矩形x761/y671/w30/h37；截图可见Mochi等待确认，原拒绝/允许一次按钮完整。root点击拒绝，原生工具返回拒绝升级错误；模型随后如实回复用户拒绝，共43秒。root独立文件检查permission-probe.txt不存在，结束DOM pending=0/streaming=0。此证明等待可见、原生审批拒绝和结束清理；本轮未捕获逐token流式瞬间或主动取消，不能扩大为全部状态完成。

当前brand bundle SHA256=ca34f93cb4cd512a1f1b3cdb229c84b8fe7628aaa949e34cdee2b04dd797ac39；已打包旧M03仍为141c…430c，需最终更新包内bundle后再核对。两版Node生命周期测试由TerraMax通过。root独立执行已隔离日志的test-mochi-dev-up.mjs退出0，日志覆盖问题的测试路径修复已通过；canonical真实启动探针仍在进行。

取消验证补充：首次sleep15任务在root下一次观察前已正常结束，只证明工具调用成功，未记取消通过。第二次在同一CUA调用中发送→等待原生停止按钮可见→点击停止；随后pending0、streaming0、停止按钮0、输入恢复。这证明模型等待阶段可取消和组件清理，不证明运行中的长工具进程已被杀。

canonical启动根因后续实证（TerraMax报告）：独立临时persist/随机端口raw config探针退出1，日志明确匹配assets.directory缺失；generated config加显式原.dev.vars探针启动且health200，结束后随机端口清理，原两服务仍在。此前推测已得到隔离运行支持；root待读取证据工件。detached进程短探针也报告父命令结束后存活，随后清理；尚未将现服务切到新helper。

## 22. 启动器定点修复复核

root已读取run-detached.cjs：以detached子进程、stdin ignore、受限日志文件、unref启动，不安装系统自启。root独立test-run-detached.cjs通过，覆盖启动父命令退出后子进程仍存在以及显式停止清理；test-mochi-dev-up.mjs也退出0，覆盖明确API200/Harness200或401、500拒绝、缺构建配置及隔离测试日志。

root读取canonical-startup-probe.json：raw输入config探针exit1，日志1822字节，记录明确assets.directory错误；generated config+原.dev.vars隔离probe监听成功、health200并已清理。当前launcher显式--config、--env-file、--persist-to，保持原业务state。原服务54434/54598仍监听，尚未替换为此新启动方式。

## 23. canonical 实际切换与组合包复核

root已读取canonical-switch-result.json及相关启动证据。校园workerd60647的cwd为《联动计划》，父链最终到1；Mochi60633的父进程为1。启动器父命令退出后，root独立确认两端口仍监听、校园health200、Mochi匿名根入口401、embed200且与canonical静态文件hash一致。显式使用生成Worker配置和原.dev.vars，未输出凭据。既有DSH_HOME和D1 persist路径保留；切换前后只读元数据user_version0、迁移25、users9、students24一致。此项切换完成；不代表已连接Cloudflare云端。

最新组合包已包含ca34f93c…97ac39品牌bundle。root独立比较包内brand、campus index、static-root三项与源码SHA一致，并读取隔离smoke-ca34日志的MOCHI_DESKTOP_SMOKE_OK。该证据证明实际包启动官方Harness并加载根文档；不扩大为全部前端、认证或模型端到端验收。后续源文件变化将另记，不能沿用此hash代表新版本。

切换后root浏览器复验Read-Only Migration Verification历史与输入，并打开班主任待办：920×814下校园建筑插画和四项统计可见。319×740下主内容宽303，统计双列及插画完整；document clientWidth311、scrollWidth320，仍有小幅水平溢出。已恢复920×814，窄屏不记全部通过。

后续教师能力只读清单确认：附件与权限服务已装配，但自定义ToolRunContext不含会话附件授权引用，新的文档工具也不会自动进入现有交付UI。LibreOffice可执行，部分系统Python文档库存在，均未成为产品锁定依赖。不能把可用宿主库写成三图转Word已实现。原规范的强制STOP条件为Lite/Fake Harness；当前已排除此条件，可以在保留本报告PARTIAL及具体缺口的同时准备三个限定教师验证，不能声称全面能力完成。

## 24. 用户指定运行文案

TerraMax通过现有品牌zh-JXL语言包注册chat namespace的准确键chat.deepDiving，将“深度求索中...”改为“mochi探索中”；仅修改hero.tsx、构建器及生成client.js。root审查注册/卸载路径，独立刷新网页后在验收会话发送无工具的简短回复请求，同次DOM快照实际出现`status: mochi探索中`，原生停止生成按钮与Mochi处理组件仍在。此为真实网页显示证据，不仅是源码字符串检查。当前源码bundle已更新；第23节ca34包证据对应更新前的桌面包，本次未重新打包。

## 25. 新目标与阶段门槛复核

用户已更新目标至附件56664208-5068-4f4e-97d4-3897581ef1f7，完整教师能力目录保留，并新增视觉、动效与侧边栏升级。root重读原规范末尾执行方式，明确存在“如果PARTIAL：先修复迁移”。第23节仅以Lite/Fake STOP判断可进入教师验证的表述不完整，不能用作越过迁移门槛的授权。新文档生成器实现指令已撤回；TerraMax确认未创建目录、安装依赖或修改生产代码。附件契约调查保留为只读能力盘点。

用户新报告“班主任待办→顶部对话无法返回”。root真实复现：同一验收会话从对话打开待办，再点击原生对话tab，校园main仍在。进一步1100×814实测校园host左0/上0占满视口，覆盖底层侧栏与顶部HEADER（x280/y0/w820/h76）。旧sidebar测量要求宽度小于45vw，窄屏可能使280px侧栏无法命中，且失败重试结束后没有resize监听；这是源码支持的缺陷机制，完整因果和修复需复验。已交TerraMax定点修复导航联动与内容边界，优先保持原生会话/草稿。

## 26. 待办返回对话修复验收

TerraMax在jxl-campus将宿主挂入官方shell.overlay，按conversation.session所在原生内容区实测定位；仅捕获conversation.session.header内的原生role=tab点击收起校园层，不阻止官方selectView。原有顶部已选中“对话”的重复点击因此同样生效。host关闭/卸载时清理tab监听、ResizeObserver、MutationObserver、rAF及Escape/custom-event监听。root读官方ConversationRoot和selectView实现，独立语法与navigation测试通过。

真实浏览器1100×814实测host和region均x280/y76/w820/h738，顶部两个tab的elementFromPoint均命中自身。点“对话”后panel数0、原会话标题不变、验收草稿保留；再次打开、加载中立即返回均可用。校园内部“账号登录”tab点击保留panel1；原生“查看工作过程”关闭panel并切到过程视图。此次后半段校园显示登录入口，未执行登录，不能扩张为登录恢复验收。

窄屏首次复验发现旧主题@max600的left:0!important压过新几何，实际host x0而region x56。已退回精确修复foundation/ui/jxl-workspace.css，并由既有构建器同步jxl-theme/client.js。最终新页面确认oldOverride=false，567×814下host与region均x56/y76/w511/h738；面板打开时放大到1100后均恢复x280/y76/w820/h738。返回对话仍成功、草稿保留。root已清空仅由本次验收创建的草稿，并reset临时viewport。没有发送校园消息、改业务记录或重启服务。

本次为运行网页源码修复；此前冻结桌面包尚未包含本轮导航和最新文案/主题变化，后续组合分发前需同步，不沿用旧包hash冒充新版。

## 27. 并行实现与本轮审核进度（2026-09-05）

用户再次明确授权功能开发和验证并行。保持 Phase 0 PARTIAL，三个执行 Agent 分别实现隔离的文档、成绩表、课件模块；尚未接入 profile、附件授权或对话成果交付，不将结构化演示输入冒称图片识别或完整教师能力验收。

侧栏使用官方 footer slot 单组五入口与 workspace locale，manifest 显式声明 locale 依赖。root 浏览器测得1100×814下五行均246×40、字号13px；567×814为窄栏语义图标，无水平溢出。两个宽度下打开待办后顶部对话/过程tab仍可点击，返回后aria-current清除。root独立navigation测试通过。另实际点击发现hidden属性被display:flex覆盖，折叠后内容仍占空间，已退回定点修复，暂不把折叠记为通过。

隔离会话恢复结果 phase0-official-open-node24-20260905b 已读取并审查验证器。官方 persistence 的 list/inspect/prepare 与 SessionStore.enter/announce 均打开两个候选，A事件61→62、B70→71，新增恢复事件仅写隔离副本；原备份与两候选源hash不变。只证明两候选结构可打开，未裁定语义分支，未替换原历史。

已检查现成Cloudflare Pages入口。早前公开health返回demo/database available；本轮root再次curl连接8秒超时，当前3090仍使用本地8787，未切云。启动脚本已准备cloud/local选择，未把配置准备等同运行切换。切云审核发现浏览器旧campus_session原先会无条件转发到新origin，已修为上游origin派生的独立cookie名，代理仅恢复当前origin对应cookie。root独立运行真实HTTP双origin测试通过：旧无来源cookie及A到B的cookie不转发，Authorization不转发，登录/登出按origin隔离。源码尚未随服务重启生效；切换后需用户本人重新登录。公开health只能证明服务健康，不能证明账号认证、业务正确或真实校园数据。

侧栏折叠补验：定点增加局部[hidden] display:none规则后，root刷新同一浏览器并实际点击，computed display=none，五行布局高度全部为0；重新展开成功，已reset视口。折叠缺陷已关闭。

## 28. 结构化教师文件模块实证

root独立运行mochi-documents测试8/8通过，包括真DOCX/PDF、空白单元格、伪PDF拒绝、TERM-resistant超时/取消、输入与实际PDF分页差异、重复和并发不覆盖。已逐页查看演示成品20260905T160420935Z-demonstration-structured-docx-pdf三页PNG，中文、表格、空白单元格清晰；仍非三照片OCR，且尚未接官方附件/工具/成果交付UI。

root独立运行mochi-presentations初次5/5通过，已看run-20260906-0005-noto初版与指定页修订共六页联系图；中文与原生表格可读，未修改页实际slide XML相同。Agent后续补齐失败/损坏PDF/只读目录/TERM-resistant强杀，报告最终9/9通过；root未再次重复该整套，仅保留证据级别区分。两模块的成品均为明确演示，文件生成层通过不表示用户聊天中的完整教师Skill或内置Office编辑已实现。

最新用户扩展免费检索、教材知识库、四川2026新高考试卷字体符号、右侧Office式可编辑工作台与自由框选，详见artifacts/migration-audit/TEACHER_WORKBENCH_REQUIREMENTS.md。继续并行推进，不将整体goal记完成。

## 29. 成绩、Office 与新增硬性验收（2026-09-06）

root 独立运行 mochi-grades 五项测试全部通过；结构化输入、缺考不计零、重复学号排除、匿名工作簿无身份与隐藏原始表、独占目录和并发不覆盖均有实际 XLSX 检查。Agent 用 LibreOffice 重算常规和零阈值演示，均与程序统计相符；零阈值未复现空白误计，仍将分段公式加上明确纳入统计条件以减少引擎差异。尚未接真实成绩导入或对话交付。

Office 适配初始四项测试 root 独立通过。继续代码审查发现签名字段混入、父目录符号链接越界、版本发布与重复保存竞争等问题；已交 Sol 修复并扩展 HTTP 接口。当前独立服务18100可报真实离线状态，官方镜像仍未拉取成功，不能宣称浏览器编辑和保存闭环已验收。真实config/version/callback合同继续审核。

最新用户明确模型多选、服务商预填与 Demo D 学生医务放行闭环均为必须完成。现安装官方模型插件支持会话级下次请求切换，与旧设计文档限制不同；优先复用官方扩展。root 实际打开3090模型菜单，只看到两款智谱模型且被归到 DeepSeek，未执行模型切换或发送新请求。本轮没有修改正式学生记录、云端凭据或重启原校园服务。

模型设置进一步实测：原生“添加提供方”已有约40家目录和凭据/自定义设置表单；本轮只展开后取消，没有输入或保存。增量应复用这些目录和官方设置，不再制造第二套模型注册表。

Office 后续 root 独立五项测试通过，覆盖真实 editor-config key 用于签名回调、不可变版本读取、来源和父目录链接检查。还有已保存回调重试应在下载前查幂等收据的问题已退回。公开网络根因有新证据：宿主和 mochi-office VM 使用现有7897代理，均在1秒内从官方 registry /v2/ 获得401认证挑战；直连才超时。未改变系统代理或默认Colima配置，可据此继续官方镜像下载，不应宣称持续外部阻塞。

四川考试符号演示163814Z成品 root 已渲染并视觉查看一页，中文、英文、分式、根号、上下标可读。发现单位被OMML默认排为斜体，以及360行距值默认auto但manifest误称twips的问题，已退回修正并增加多行题干验证；未将初版电子排版认作国标实物合规或2026官方同款。

考试基础模板补验：164729Z修订成品 root 已渲染检查一页，多行题干、高公式无裁切，物理单位正体而变量斜体，中文、英文、化学上下标清晰。XML行高改为至少410 twips（20.5pt），元数据解释12pt正文之外8.5pt附加leading，不冒称实物行空测量。root独立全量10/10通过，用时20.96秒；包含原generic八项回归。基础结构化模板通过，仍不代表三照片OCR、任意公式/物理图形、2026各科官方样卷精确复刻已完成。

## 30. Demo D 隔离业务闭环独立通过，卡片仍在验收

canonical 新增持久 movement_requests、教师代录申请与批准/拒绝路由；没有学生登录角色，代录身份明确显示。批准以D1原子batch创建正式movement并绑定申请，原有直接放行入口保持。Agent报告45文件383测试及TypeScript通过，root不将既有测试数量等同新增行为覆盖。

root独立执行canonical scripts/accept-demo-d.mjs成功，10.567秒：临时D1应用migrations→PENDING申请→人工动作等价HTTP批准→医务室到达→创建并关联医务事件→护士准备返班→离室→教师确认返班→护士医务记录已返班。最终movement=CLOSED、medicalState=已返班、学生activeMovement=null。八个边界覆盖精确重放、同key反向动作、拒绝及重放、过期版本、跨班失权、同key并发创建、两个审批者竞争、已有在途阻止新申请。端口已关闭且临时DB已删除。此为真实Worker/D1/HTTP证明，不是模型理解或对话卡点击证明。

另起隔离校园8798与Harness3092供UI验收，未动原3090/8787。root实际进入后遇到首启API Key配置提示与未选择工作区，已退回执行Agent检查官方凭据readiness；未向表单填密钥、未发送医疗请求。对话卡真实点击仍不能标为通过。


## 31. 对话审批实证、自然语言缺口与分平台安装要求

隔离3092真实UI第一张创建确认卡，root点击前Agent只读确认request=0、movement=0；点击后仅产生PENDING v1。第二张教师批准原生卡，root点击前仍PENDING且无movement；点击后只读核查request=APPROVED v2，关联movement=OUTBOUND，正式放行记录和APPROVED事件均恰好一条。卡片机制通过；不是完整对话医务闭环。到达、处置和返班写工具仍待加载和验收。所有记录属于隔离演示D1，当前主服务3090/8787及云端尚未部署此迁移。

自然语言第一次因只查在途记录而误判学生不存在。增加真实学生目录检索后，第二次唐南乔新会话在37秒内正确查到学生，但仍回复Markdown伪按钮“[确认登记申请]”，没有调用创建工具或显示原生确认卡。故自然语言端到端仍FAIL，已退回核查Skill实际发现与工具描述；不能用指定工具名和ID的机制探针代替自然语言成功。

独立审计发现网页MovementsPage默认“快速放行”仍直调createMovement绕过PENDING，已委派前端改为申请列表及显式批准/拒绝；AssistantPage的旧AI确认直放行入口也须核查和改清默认申请语义。服务器授权来自真实会话用户及班级关系，模型不能自报审批身份；当前教师代录后可自己明确批准，不宣称强制双人审批。

模型预填root独立5/5测试通过，并在无密钥隔离3094真实点击Kimi：官方原生卡新增moonshotai-cn，仍提示待填密钥，当前对话保持DeepSeek-V4-Flash；未输入密钥或发送模型请求。现有目录/API endpoint与Coding Plan区别有来源；界面技术信息过多，已退回收起连接详情。配置加入不代表API连接已实测。

用户新增Windows和Mac分别提供安装程序的硬要求。已委派桌面打包owner检查现有electron-builder DMG/NSIS及原生运行时资源；要求分别记录实际安装包、构建环境和安装验证，不将仅配置或跨编译宣称平台实测。尚未新增可交付的Windows安装验证证据。


补验：root独立再次执行扩展Demo D HTTP探针，12.377秒完成，新增网页版助手预览→PENDING/消费后同key重放/异key拒绝均符合结果。旧八项及完整医务返班终态仍通过，临时DB清理、端口关闭。审核发现INSERT与consume双重过期时间判断可能跨语句失效，Sol已改为INSERT唯一时效门控、consume依赖本事务创建引用；不再声称batch后JavaScript异常可回滚。

root独立运行前端两个定点测试文件31项通过，明确其中页面检查为源码合同，尚非真实点击。AssistantPage响应未知时新生成key并清除预览的重试缺口已退回，要求复用该预览稳定key并保留未知结果状态。

Office重复保存收据已在下载前读取，root五项再次通过；测试实际让源URL第二次返回404且确认没有第二次下载。Windows路径边界后来由Sol修为relative/sep并报告六项通过，root尚未复跑这一新增项。内置编辑引擎仍未在线。

主服务8787公开health于2026-09-05T17:37:46Z返回demo/database available，3090/8787原PID仍在。打包启动路径显示主Wrangler可能读取并watch canonical dist；已要求隔离前端构建不得覆盖该路径，以免数据库迁移前热加载新服务。health仍不等同账号或业务数据准确性验收。


## 32. 自然语言真实卡与网页PENDING点击验收通过（隔离）

Sol升级隔离8798到0026/0027/0028并使用130文件独立前端产物，manifest hash为88d51b738894a6033c544b8db6cdc010d5c12d7158ff1931328ab8da6186e8ff；没有覆盖主服务watch路径。root用新3092会话仅描述唐南乔姓名/班级/身体不适/10分钟需求，模型查真实目录后调用movement_request_create，约2分30秒出现原生确认卡。root视觉检查多行reason清晰、Mochi等待标记、当前尚未创建和确认后仅PENDING。root点击拒绝后Sol只读确认student11请求0、movement0。模型收尾仍重新索取确认而非明确已取消，已退回USER_DECLINED结果与Skill终止语义；卡片机制与无写入成立，不把拒绝收尾标为通过。

root通过隔离校园真实登录页面进入班主任演示账号，在新学生流动页面选择林小禾、医务室、身体不适、10分钟，点击登记。生成mreq_04183621f7874590a06c069354898281，网页明确待审批、尚未放行，待审批1；当前在途仍仅旧简乐知1。随后点击明确“批准并放行”，待审批0，在途变2，新增mov_fa9c2e7d0eb04beaae0b760cb2da1dc0。此为真实网页登录/API/列表联动，不是源码字符串测试。仍只发生在隔离D1；主3090/8787尚未升级。

Boole实际官方catalog probe已新增student-movement-request并调用ctx.skills.get加载正文，报告7个技能通过。Sol另读3092实际会话seq12 skill-catalog已列该Skill，而失败轮只调用目录工具，确认此前伪卡并非Skill缺文件。root独立Office六项通过，新增Windows路径语义检查使用win32路径函数，不等同真实Windows安装验证。

免费检索复核来源：https://docs.searxng.org/dev/search_api.html 和 https://github.com/searxng/searxng 。官方明确JSON需实例启用、许多公共实例禁用；site:支持依赖底层引擎，需对返回URL额外校验权威域名。已交资料检索owner据此实现，不将随机公共实例或百科备用宣称稳定全网服务。
