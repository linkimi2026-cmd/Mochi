# 03 · Mochi 运行时与质量体系设计（Runtime & Quality Architecture）

> 作者角色：运行时 / 质量体系架构师　|　面向：教师办公 AI Work Agent「Mochi」桌面 APP
> 内核事实底座：Mochi Harness `0.1.2-rc.1`（实测运行版）；源码 `mochi-harness-src.nosync/mochi-harness-master/`（已读）
> 本文件所有「dsh 能做什么」均来自实读源码 / README，未读到的标 `TO_BE_RESOLVED_BY_CODEX`。
> 另两个 Agent 并行负责：工具层（ppt.*/doc.*/file.*/browser.* 等）、协议层（Dispatch Protocol / A2A / Artifact）。本文件不重复造。

---

## 0. 约束与已核实事实（先钉死）

- 内核 MIT，`Everything is a Plugin`，Cordis 装配。运行入口：`node node_modules/.bin/dsh --profile <p> "<task>"`（封装见 `mochi.sh`）。
- 模型：**免费档 `glm-4-flash`**（工具调用率 100%）；`glm-4.7-flash` 限流严重（22%）。用户不换付费模型。
- 配置热加载：`$DSH_HOME/settings.yaml` + `$DSH_HOME/profiles/headless/cordis.patch.yml`（`$DSH_HOME=/Users/a1379/Documents/Mochi/.mochi-home.nosync`）。
- 凭据：`$DSH_HOME/.credentials.yaml`(0600)，键名 `ZHIPU_API_KEY`，经 `apiKeyEnv` 引用。
- 遥测 `session-telemetry-otel` **已关**（`cordis.patch.yml` 第 3 节）——校园数据不出校，打包必须复刻此关。
- 插件装配语法：`id:` 改写（config 整行替换，非合并）；`insert:` 新增（id 必须树里没有）。判「已存在」用 `dsh --dump-config`。
- `goal` 家族必须整体关（`goal`+`goal-round-driver`+`command-goal`+`tool-goal`），否则树加载失败。
- `skill-filesystem` 必须 `includeDefaultRoots: false` + `customSkillDirs`，否则扫进 17 个 Cloudflare 技能。
- 工具 schema 严格：嵌套 object 必须显式 `additionalProperties: true|false`（见 `plugins/mochi-campus/index.mjs` 的 `output.schema`）。
- 绝不能改 `/Users/a1379/Documents/联动计划/` 任何文件。ExpressiveOrb 引擎**复制**到 Mochi 再改（见 §7.5）。

---

## 1. Mochi 人格与自然语言（Agent 灵魂）

### 1.1 设计红线（用户反复强调，写进本文件）

> **POLICY MUST GOVERN CAPABILITY, NOT GENERATE CONVERSATION.**

旧实现的致命错误：本地规则匹配 → 直接 `return` 固定话术 → AI 几乎不参与。本设计方案彻底反转：

- 本地规则**可以**：authorize / deny / redact / minimize data / require confirmation / constrain tools。
- 本地规则**不能**：直接回答用户问题、替代 LLM、把自然语言映射成固定回复、结束正常对话。
- **正常路径**：`User → LLM → Tool Choice → Permission → Tool → Tool Result → LLM → Natural Response`。
- 学生端同样不行本地机械隐私话术：权限工具返回**受限结果**，再让 LLM 自然解释。
- **验收红线：`Local Rule Direct Return Rate < 5%`**（评测见 §6）。

### 1.2 完整 System Prompt（部署级 persona 草稿，写入 `cordis.patch.yml` 的 `system-prompt.persona`，英文）

`cordis.patch.yml` 已有一个 `persona`（见现有文件第 1 节），它基本合格。本方案在其基础上**只补强三处**，不动「Mochi 不翻译中文名」「幻觉是最坏失败」「先结论后解释」「确认三档」等已有条款：

1. **反对反问的指令化补丁**（解决 glm-4-flash 偏保守反问，见 §1.4）——加入 persona 末尾：
   > When the user's request clearly maps to a tool you have, CALL THE TOOL
   > immediately. Do not ask "do you want me to look it up?" or restate the
   > request as a question. Asking back when the action is obvious wastes the
   > teacher's time. Only ask when you genuinely cannot tell what they want.
2. **承认不知道的兜底句**已存在（"I don't know is acceptable"），保留。
3. **自称唯一**已存在（"I'm Mochi"），保留。

> 注：现有 `persona` 已是英文、已包含 hallucination 红线与确认三档，本方案判定**可直接复用，不重写**，只在 `cordis.patch.yml` 追加上述第 1 条。重写有回归风险，不值得。

### 1.3 性格 / 语气 / 边界（落到 SKILL.md，已存在 `skills/mochi/SKILL.md`）

- 名字：Mochi。英文小写，不写「麻薯」。介绍用 "I'm Mochi"。
- 性格：灵动乐观的工作伙伴，不是聊天机器人，是「把事办完的同事」。
- 语气：先结论、短句、中文为主保留专有名词、不自称"AI助手"、不道歉成瘾。
- 边界：不是医生、不是教务系统本身、不替人拍板、隐私只在授权时碰。

### 1.4 小模型反问问题的对策（实测 glm-4-flash 偏保守，非幻觉）

首选方案：工具描述写得更**指令化 + 给示范**（prompt 工程，零成本）。
- 在每个工具 `description` 开头加触发句式，例如 `campus_query_student` 现有描述已较好（"当用户问「哪些学生在医务室」…时调用"），保持并推广到全部工具。
- 在 persona 加 §1.2 第 1 条「明显该调工具就立刻调，不要反问」。
- 加 1–2 个 few-shot 到 `agent-instructions`（context 插件，见 §2）展示「用户问实时状态 → 直接调工具 → 不反问」。

理由：免费档不能换更强模型，唯一可控杠杆是 prompt。实测 glm-4-flash 工具调用率 100%，说明它**能调**，只是有时犹豫——指令化描述能把犹豫压下去。

备选方案：在 dispatch 层加一个**轻量前置分类器**（规则/小正则）判断「是否实时数据类问题」，若是则在 prompt 里追加一句强约束。
切换条件：若 §6 评测里 `Tool Selection Accuracy` 或 `Conversational Naturalness` 不达标（反问率 > 15%），再上前置分类器。前置分类器本身有「本地规则生成对话」的回归风险，必须只输出「约束指令」不输出「答案」。

`TO_BE_RESOLVED_BY_CODEX`：dsh 是否有 per-tool「必调」的强制开关（类似 tool force-call）；当前源码未证实，先用 prompt 方案。

---

## 2. 记忆架构（五层）

### 2.1 五层定义与 dsh 映射

| 层 | 是什么 | 存哪 / 用 dsh 什么 | 生命周期 / 隐私 |
|---|---|---|---|
| **Conversation Memory** | 当前会话的完整对话与工具轨迹 | dsh **Session Log**（durable events，自动持久化）+ `compaction/` 摘要 | 按会话；超长自动 `compaction` 成摘要 |
| **Working Memory** | 本轮任务需要的上下文（指令、引用、当前时间、已加载 Skill 方法体） | dsh `context/` 插件族：`agent-instructions`(AGENTS.md)、`session-reference`、`file-reference`、`time-context`；Skill 加载后的方法体 | 请求级，进入 history 后持久；不跨会话 |
| **User-Teacher Profile** | 老师偏好、常用班级、默认确认档 | 新增插件 `mochi-profile`（存在 `settings/` 命名空间或本地 JSON，scope 隔离） | 长期；仅授权老师本人可见 |
| **Episodic Memory** | 「昨天那个格式」「刚才那个学生」等 episodic 回忆 | `session-query`(SQLite) 或新增 `mochi-episodic` 本地 SQLite，**只存非敏感聚合/引用** | **TTL 30 天**，到期自动清；敏感字段不入库 |
| **Organization Knowledge** | 校园组织/班级/流程知识 | **不存模型记忆**，经工具层实时查询（campus.* 等） | 实时取，不入 Memory |

### 2.2 指代消解（"我们班 / 刚才那个 / 还是昨天那个格式"）

- 「我们班」「刚才那个」：靠 **Conversation Memory + Working Memory**。`session-reference` 让模型引用上一轮；persona 提示「指代不清就问，不要猜」。
- 「昨天那个格式」「还是上次那样」：靠 **Episodic Memory** 的轻量索引。实现：`mochi-episodic` 在每次产出 Artifact/文档后，存一条 `(teacherId, type, refKey, ttl)` 索引（不存全文，存路径/摘要），查询时按 `type+teacherId` 召回最近一条供 LLM 参考。
- 「没回来的那几个」：纯实时，走工具层（`campus_query_student` + `onlyOverdue`），不落 Memory。

### 2.3 隐私边界与 TTL（硬约束：敏感学生数据不无限进模型 Memory）

- **绝不**把可识别学生个体数据写进 Episodic / Profile 的长期存储。Episodic 只存 `(type, refKey, ttl)` 这类索引键与聚合统计。
- Episodic TTL = 30 天（`mochi-episodic` 启动时清过期行）。
- 学生视角（Student Mochi）与老师视角的记忆**用 `scope` 隔离**：dsh `scope/` 是 per-scope 分层（skill registry、tool registry 都按 scope 分层），记忆读取也按 scope 边界，跨角色不可见。
- 实时敏感数据一律「用工具取、用完即走」，不进持久 Memory。

理由：符合用户「不能把敏感学生数据无限永久存进模型 Memory」。dsh 的 scope 分层（`packages/scope`、`packages/core/scope`）提供天然隔离原语。

`TO_BE_RESOLVED_BY_CODEX`：`mochi-profile` 落库用 `settings/` 的哪个 API（settings namespace 写入），需读 `packages/settings` 确认；或退化为本地 JSON 文件（更简单、更可控，首选 JSON）。

---

## 3. 权限与 Human Approval

### 3.1 三态落地到 dsh（关键设计）

协议层把工具分类为 **AUTO / CONFIRM / DENY**。但 dsh 原生 approval 只有**会话级** `ask` / `never` 两态（`packages/interaction/user-approval`，已读 `src/index.ts`），没有 per-tool 三态。落地方式：

**新增插件 `mochi-approval`（Cordis waterfall 监听器）**，注册在 `approval/request` 瀑布事件上。

> 🔴 **修订记录（设计修订官 / P0-5）**：原稿写 `ctx.on('approval/request', ...)`，已去 `dsh-src` 源码核实——审批是 Cordis **瀑布（`@mode waterfall`）**，不是事件监听。源码 `packages/interaction/user-approval/src/index.ts:273` 实际调用 `this.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req, () => 'unavailable')`；监听器契约见 `packages/interaction/user-approval/src/types.ts` 的 `declare module '@deepseek-ai/cordis' { interface Events { 'approval/request'(this, req: ApprovalRequestEvent, next) } }`，标注 `@mode waterfall`。用 `ctx.on` 注册的是普通事件监听（返回值被忽略），**不会**进入审批决策链 → 所有 `ctx.approval.request` 落到终态 `unavailable`（fail-closed）→ 连只读 AUTO 工具也被拒，三态系统整体失效。必须用 `ctx.waterfall` 注册。字段名 `req.toolName` 经源码核实正确（`ApprovalRequestEvent.toolName`）。

```js
// mochi-approval/index.mjs —— 伪代码，API 已对照源码核实（user-approval/src/index.ts:273 + types.ts）
export function apply(ctx) {
  ctx.waterfall('approval/request', (req, next) => {
    const cls = MOCHI_TOOL_CLASS[req.toolName]   // 协议层产出的三态表（按工具名判定）
    if (cls === 'AUTO')  return 'allowed-once'   // 直接放行，不弹窗
    if (cls === 'DENY')  return 'rejected'       // 权限门，模型拿 rejected 结果
    return next()                              // CONFIRM：交给人类 answerer 弹确认卡
  })
}
```

> ⚠️ **审批 payload 不带工具参数（硬限制，来自 07 事实核查）**：`ApprovalRequestEvent` 只含 `agent` / `toolName` / `callId?` / `reason?` / `signal?`，**没有参数**。因此 `MOCHI_TOOL_CLASS` 只能按**工具名**判定 AUTO/CONFIRM/DENY，无法看参数"越权"。DENY 判定逻辑必须写成"按工具名白/黑名单 + reason 文案"，不能依赖入参。这是"自写 `approval/request` answerer 插件"的根本原因——dsh 没有现成按参数的策略。

- 返回值词汇已核实：`allowed-once` / `rejected` / `cancelled` / `unavailable`（fail-closed）。
- `DENY` 工具：模型收到 `rejected` 工具结果，**由 LLM 自然解释**「这个我看不了，需要 XX 权限」——这正是 §1 红线要的「权限不靠本地话术」。
- `AUTO` 工具（只读查询）零打扰；`CONFIRM` 工具（发消息/改记录/删东西）才弹卡。

**`user-approval` 会话策略**（已核实，见 `user-approval/src/index.ts:265`）：

- 桌面现场 demo：默认 `ask`（弹确认卡，真人点）。
- 脚本化 / 录屏 demo：**绝不用 `never`**——`never` 在 dispatch 前就 `return 'rejected'`（确定性拒绝，不是自动通过），凡 CONFIRM 工具（如 `message.send`、Demo 3 换课确认）全会被拒、demo 直接失败。改用自写的 `demo-auto-approver` answerer（`ctx.waterfall('approval/request', ...)` 对 CONFIRM 返回 `'allowed-once'`）跑无人在环 demo。
- `never` 仅可用于"纯只读、无任何 CONFIRM 工具"的评测场景。

### 3.2 permission-presets 预设表（配置形态已读 `permission-presets/README.md`）

在 `cordis.patch.yml` 加：

```yaml
- name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      teacher-safe:            # Mochi 默认
        sandbox: workspace-write
        approval: ask
      teacher-auto:            # 老师想全自动跑只读任务
        sandbox: workspace-write
        approval: never
      danger-full-access:      # 调试用，不出现在默认 UI
        sandbox: danger-full-access
        approval: never
    defaultPreset: teacher-safe
```

- `sandbox: workspace-write` = 只在 workspace 内写，保护老师电脑。
- 注意：`custom` 是派生态、不可命名；`defaultPreset` 必须落在表里，否则 `permission` 设置注册失败。
- 三态（AUTO/CONFIRM/DENY）由 `mochi-approval` 监听器实现，**不在 preset 里**；preset 只管 sandbox+approval 两旋钮。

### 3.3 确认卡 UX（前端消费）

确认需求经 `approval/request` → 监听器对 CONFIRM 调 `next()` → dsh 的 UI answerer 产出确认卡（桌面前端用 SDK 的 `session.event` 流渲染「待确认卡」，见 §7）。卡上必须写明「我要做什么」（persona 已要求，不是只问"确定吗"）。

---

## 4. Skills（第一批 Teacher Skills）

### 4.1 dsh Skill 文件格式（已读 `skill-filesystem/README.md` + `docs/subsystems/skills.md`）

- 一个 Skill = 目录 `<name>/SKILL.md` 或平铺 `<name>.md`，位于 `customSkillDirs`（已配 `/Users/a1379/Documents/Mochi/skills`）。
- frontmatter 字段：必填 `name`(kebab-case) + `description`；可选 `whenToUse` / `metadata` / `disable-model-invocation` / `user-invocable`。
- 已有 `skills/mochi/SKILL.md` 用了 `name/description/whenToUse/user-invocable`，**格式合规，作为模板复用**。
- 正文是**自由 markdown 指令**——这正好符合「Skill 是 Agent 如何完成某类工作的方法，不是关键词→固定回答」。
- 模型通过 `skill` 工具按需加载方法体；目录扫描已沙箱化（不会灌 17 个无关技能）。

### 4.2 第一批 Teacher Skills（v1 仅 5 个，覆盖五场 Golden Demo 叙事）

> 🔴 **修订记录（设计修订官 / P0-2 + P1-6）**：原稿列 10 个 Skill，且 `Tools:` 写了 `doc.write` / `schedule.*` / `campus_query_student` / `user-questions` / `browser.*` 等**工具层(01)根本没定义**的名字——模型按 Skill 去调不存在的工具必失败或幻觉。现按 04_REVIEW 砍刀清单砍到 **5 个**，且 `Tools:` 逐条对齐 **01 §1.2 的唯一权威工具清单（P0 共 38 个）**。工具名以 01 为准，本文件不再重复定义。
> 傻瓜式 / 预置配置 / 校园场景优化 的设计约束见 **`10_TEACHER_UX.md`**（指令 B，本文件不重复造）。

1. **teacher-daily-brief** — 晨间今日概览（课表/待办/超时未归）。Tools: `jxl.*`（clinic_status/dorm_status/campus_status）、`calendar.search`、`task.*`、`file.read`。Workflow: 拉实时状态→聚合成 3 行简报。Perm: 只读(AUTO)。Fail: 某源失败→先给能拿到的，标注缺失。
2. **class-meeting-prep** — 班会材料准备。Tools: `doc.create`/`doc.edit`、`ppt.*`、`file.*`。Workflow: 收主题→起草大纲→生成 PPT/文档草案。Perm: 写草稿(AUTO，不自动发)。Fail: 主题不清→反问一次。
3. **teaching-material-find** — 找教学资源/试卷（Golden Demo 1）。Tools: `jxl.student_query` / `jxl.*`（查校园在册）、`file.search`（本地）。Workflow: 解析"昨天那份数学卷子"→定位→返回路径。Perm: 只读(AUTO)。Fail: 找不到→换关键词或问人。（跨主体 FIND 在 v1 用单机模拟，见 02 R2 裁决。）
4. **teacher-message** — 起草/发送消息（Golden Demo 3 换课确认）。Tools: `doc.create`（草稿）、`message.send`（CONFIRM）。Workflow: 起草→CONFIRM 才发。Perm: 发消息(CONFIRM)。Fail: 收件人不明→先问。
5. **student-follow-up** — 跟进某学生（流动/请假/表现）。Tools: `jxl.student_query`、`doc.create`。Workflow: 定位学生→汇总状态→起草跟进话术。Perm: 只读+草稿(AUTO)。Fail: 查不到→如实说，提议问相关老师。

每个 Skill 的 `workflow` 段都要写**「什么时候不调工具 / 什么时候直接写」**，呼应 persona，防止小模型过度调工具。

---

## 5. 模型策略（模型切换是一等公民功能）

> 🔴 **修订记录（设计修订官 / 指令 A）**：用户明确——模型可切换是一等功能，不要写死三档路由（原 §5.1）。Mochi Harness 本来就能切模型（像 Codex CLI 的 `/model`），加自定义 provider 要极简。原稿把模型层弱化成"simple/complex/tool-heavy 三档路由"**用户不满意**。现改为：**模型切换是一等公民功能，由 `09_MODEL_SWITCHING.md` 统一定义**（类 Codex CLI `/model`，用户随时切 + 加自定义 provider 极简），本文件只保留与运行时相关的约束，不重复造路由。

### 5.1 默认与可选项（约束，非路由）

- **默认模型**：免费档 `glm-4-flash`（工具调用率 100%）。用户不换付费模型。
- **可选**：`glm-4.7-flash`（限流严重实测 ~22%，仅作为 `/model` 里用户手动选的备选，标注限流风险）。
- 模型选择**不写死、不自动路由**——交给用户在 `/model` 里随时切；默认 flash，保证演示稳定。**稳定 > 功能数量**。

### 5.2 在 dsh 上落地（详见 09 文档）

- dsh 模型在 agent 初始化时由 provider/model route 解析（`llm-deepseek` 把 id 原样透传；`sdk` 的 `initialize` 带 provider/model）。`agent-default-model` 默认 `glm-4-flash`，但**用户可在运行时经 `/model` 覆盖**（机制见 `09_MODEL_SWITCHING.md`）。
- 加自定义 provider：在 09 文档定义极简接入点（用户原话"只要我们加入自定义就可以了"），不在本文件展开。

`TO_BE_RESOLVED_BY_CODEX`（已移交 09）：dsh 是否支持同一会话内 per-turn 换模型；`sdk` `initialize` 是 per-session 的，per-turn 切换未证实。若需真正动态切换，方案退化为「按任务开不同 session、各自 initialize 不同 model」。

### 5.3 免费档最大化效果

- 工具描述指令化（§1.4）。
- Skill 方法体当「少样本工作流」注入，弥补小模型规划弱。
- `compaction` 开（默认开），长会话压摘要，省 token。
- 关遥测、沙箱化技能目录，省无关 token（已做）。

---

## 6. Eval Plan（Teacher Agent Eval v1，~50 条）

> 🔴 **修订记录（设计修订官 / P1-5）**：原稿 150 条不现实（高中生 + 上学，3 天写不出 150 条有质量的 case）。按 04_REVIEW 砍刀清单砍到 **~50 条核心**，其余留 P2。A2A/Artifact 仅少量，且不依赖未证实的 `tools/llm-probe.mjs`（§6.3 驱动改用 `mochi.sh` headless 单次入口，见下方修订）。

### 6.1 测试集分布（共 ~50 条）

| 类 | 条数 | 说明 |
|---|---|---|
| 自然聊天 | 8 | 问候/情绪/随口说——验证不调工具、自然回 |
| 教师口语省略 | 8 | "昨天那份卷子""还是上次那样"——验证指代消解 |
| 校园查询 | 8 | 实时状态问——验证必调工具、不编造 |
| Tool Calling | 8 | 单工具选择准确 |
| Multi-tool | 4 | 多工具编排顺序 |
| A2A Dispatch | 4 | 派任务给另一个 Mochi（单机模拟，见 02 R2） |
| Memory | 3 | 跨轮指代、"我们班" |
| Permission | 3 | AUTO 不弹/DENY 自然解释/CONFIRM 弹卡 |
| Failure Recovery | 3 | 工具失败/限流/查不到——验证不假装成功 |
| Artifact | 3 | 文档/卡片产物正确生成 |
| **合计** | **~50** | |

### 6.2 指标（验收用）

- **Natural Response Rate**：自然语言回复占比（目标 ≥ 95%）
- **Local Rule Direct Return Rate**：本地规则直接 return 占比（**目标 < 5%**，红线）
- **Tool Selection Accuracy**：该调调对（目标 ≥ 90%）
- **Task Completion Rate**：端到端办成（目标 ≥ 80%）
- **Hallucination Rate**：编造校园状态（目标 = 0，一票否决）
- **Permission Compliance**：AUTO/CONFIRM/DENY 正确（目标 100%）
- **A2A Completion Rate**：派出去的闭环（目标 ≥ 75%）
- **Human Approval Accuracy**：该问的问、不该问的不问（目标 ≥ 90%）
- **Conversational Naturalness**：人工/规则打分（目标 ≥ 4/5）

### 6.3 可执行评测脚手架（思路，不依赖未证实 API）

- 驱动：**复用 `mochi.sh` 的 headless 单次任务入口**（`dsh --profile headless "<task>"`），每条 case 跑一次，捕获最终回复 + 工具调用序列（经 SDK `session.event` 流或 `dsh --dump-config` 落盘；**不依赖源码中未找到的 `tools/llm-probe.mjs`**，见 04_REVIEW P1-5）。
- 判定：脚本比对「是否调了预期工具」「回复是否含编造词（应该/大概/可能/可能在校）」「是否有本地 return 标记」。
- 红线自动告警：若某 case 走了 `mochi-approval` 之外的本地 return（本项目当前没有这类 return，未来加规则时必须打标记），计为 direct-return。
- 人工抽检：Naturalness / Conversational 抽 30 条人工评。
- 产出：`probe-log.nosync/eval-<date>.jsonl` 汇总。

`TO_BE_RESOLVED_BY_CODEX`：是否有 dsh 官方 eval harness（`packages/test-support` 存在，但未读其是否适合端到端对话评测）；若可用则优先接官方，否则用上述 headless 驱动脚本。

---

## 7. 前端状态（16_FRONTEND_STATES）

### 7.1 四类状态（每类 4 个，共 16）

**Agent 类**
1. `AGENT_IDLE` — 空闲待输入
2. `AGENT_REASONING` — 模型思考中（不发工具）
3. `AGENT_TOOL_CALLING` — 正在调工具（含等待工具结果）
4. `AGENT_DEGRADED` — 模型/网络降级（限流回退、连接断）

**Task 类**（v1 扩为 6 态，对齐 02 §3 的 11 态；见 04_REVIEW R6 / P1-4）

> 🔴 **修订记录（设计修订官 / P1-4）**：原稿只有 4 态（QUEUED/RUNNING/COMPLETED/FAILED），但 02 的 `mochi_tasks` 有 11 态，Demo 2/3 必须展示"请选择/请确认"界面——`INPUT_REQUIRED`/`APPROVAL_REQUIRED` 无落点。按 R6 扩为 6 态。

5. `TASK_PENDING_SEND` — 入队/在途未跑（02: CREATED+DISPATCHING）
6. `TASK_RUNNING` — 运行中（02: DELIVERED+WORKING）
7. `TASK_INPUT_REQUIRED` — 需澄清/同名消歧（02: INPUT_REQUIRED）
8. `TASK_APPROVAL_REQUIRED` — 等待人工确认（02: APPROVAL_REQUIRED，渲染确认卡）
9. `TASK_COMPLETED` — 完成
10. `TASK_TERMINATED` — 终态统称（02: DECLINED+FAILED+EXPIRED+CANCELLED，UI 文案区分原因）

**Approval 类**
9. `APPROVAL_PENDING` — 待确认卡已弹
10. `APPROVAL_CONFIRMED` — 老师确认
11. `APPROVAL_REJECTED` — 老师拒绝 / DENY 门
12. `APPROVAL_EXPIRED` — 超时未确认

**Artifact 类**
13. `ARTIFACT_GENERATING` — 文档/卡片生成中
14. `ARTIFACT_READY` — 产物就绪（可下载/预览）
15. `ARTIFACT_PREVIEW` — 预览中
16. `ARTIFACT_FAILED` — 产物生成失败

### 7.2 状态信号来源（dsh 已证实）

前端**不走未证实的 `ctx.uiConversation` UI 插件**（源码 grep 未找到该 surface），改为消费 **SDK JSON-RPC 事件流**（官方、稳定，已读 `sdk/server/README.md`）：
- `session.status` → Agent 类（whole-agent lifecycle：idle / 思考 / 调工具映射）
- `session.event` → Task / Approval / Artifact 类（durable facts：tool call、approval/asked、approval/decided、attachment）
- `approval/asked` → `APPROVAL_PENDING`；`approval/decided`(allowed-once) → CONFIRMED；(rejected) → REJECTED
- attachment 事件 → Artifact 类

### 7.3 视觉规范（直接复用，不新建设计语言）

> 🔴 **修订记录（设计修订官 / P1-1）**：原稿在此自定"焦糖/琥珀色系"色板，违反硬指令1"UI 不用再设计，球必须原样用上，任何设计前端视觉体系的内容都是多余的"。改为**原样复用** `联动计划` 的 `design/calm-tokens.css` 与现有 ExpressiveOrb 组件（见 §7.5），**不新建任何设计令牌/色板**。

- **不新建设计系统**：所有颜色/间距/圆角来自 `calm-tokens.css`；禁止再定义一套焦糖/琥珀变量或自研色板。
- **无塑料感**：由 Orb 组件本身保证，不额外加系统蓝/渐变塑料按钮。
- **不许横向滚动条**：所有容器 `overflow-x: hidden`；对话流单列纵向（沿用 calm-tokens 布局约定）。
- **有字的地方都要圆角矩形**：由 calm-tokens 的 squircle/圆角令牌保证（复用 `联动计划/src/components/SquircleAnchor.tsx` 思路）。

### 7.4 技术栈

- React + TypeScript（与 `联动计划` 同栈，便于复制组件）。
- 状态机：每个会话维护 `{agent, task, approval, artifact}` 四态对象，由 SDK 事件 reducer 驱动。
- 通信：`@deepseek-ai/dsh-sdk-client` 的 `HarnessClient`（已读 README，`subscribeSessionTree` 订阅单会话及 subagent 子树）。

### 7.5 ExpressiveOrb 引擎接入（只读原项目，复制过来改）

- **源（只读，严禁改）**：`/Users/a1379/Documents/联动计划/src/components/ExpressiveOrb.tsx`、`ExpressiveOrb.css`、`ThinkingOrb.tsx`、`OrbCompanion.tsx`、`OrbCompanion.css`、`AssistantDock.tsx` + `design/calm-tokens.css`、`cozy-pages.css`。
- **动作**：复制到 `/Users/a1379/Documents/Mochi/app/src/components/` 与 `app/src/design/`，**在 Mochi 副本里改**，原文件零改动。
- Orb 绑定到 `AGENT_REASONING`/`AGENT_TOOL_CALLING` 表情（焦糖色脉动=思考，琥珀色转圈=调工具），`AGENT_DEGRADED` 变灰。
- 复制时**只取视觉与动画**，不取联动计划的业务数据依赖；若源文件 import 了联动计划特有 lib，在副本里剥离。

---

## 8. 桌面 APP 打包（Mac + Windows）

### 8.1 技术选型

首选方案：**Tauri（Rust 壳 + WebView）** 还是 **Electron**？

| 维度 | Electron | Tauri |
|---|---|---|
| 包体积 | 大（~150MB+，含 Chromium） | 小（~10–20MB，系统 WebView） |
| 启动/内存 | 重 | 轻 |
| 与 dsh 集成 | 主进程 spawn node 子进程跑 dsh | 主进程 spawn dsh 子进程（Rust） |
| 签名复杂度 | 同 | 同 |
| 高中生可维护 | 高（纯 JS） | 中（要碰 Rust 编译链） |

**结论：首选 Electron。**
理由：① dsh 本身是 Node 进程，Electron 主进程就是 Node，spawn dsh 子进程最顺、调试最易；② 高中生已熟 JS/React，Tauri 的 Rust 编译链在 26 天里是额外风险；③ 包体积大但比赛演示机器本地跑，不影响。
备选方案：Tauri（若评委特别看重包体积/原生感）。
切换条件：若演示机器性能差、Electron 卡顿明显，或评委明确要求"原生"，再切 Tauri。

### 8.2 dsh runtime 随包分发

- dsh 是 Node 包（`@deepseek-ai/dsh`，MIT），需 **Node ≥ 22.19**（源码 `package.json` engines 实测 `^22.19.0 || >=24.0.0`）。
- **🔴 版本锁定（P0-7，04_REVIEW）**：dsh 是 **Developer Preview**，26 天内可能 breaking change（尤其我们刚踩坑的 `approval/request` 瀑布、SDK 事件名）。**严禁 `@latest`**。打包脚本必须钉死：`@deepseek-ai/dsh@0.1.2-rc.1`（用户给定的 Developer Preview 版本）；依赖一并锁 `pnpm-lock.yaml` 并提交。同时订阅 dsh release 监控 breaking change。
  - ⚠️ **版本漂移待核实（TO_BE_RESOLVED_BY_CODEX）**：本地 `mochi-harness-src.nosync` 快照根 `package.json` 版本是 `0.1.3-alpha.1`，与用户给定的 `0.1.2-rc.1` 不一致。开工锁版本前，先 `npm view @deepseek-ai/dsh versions` 确认 `0.1.2-rc.1` 存在，并在该版本源码上复验 `approval/request` 瀑布契约与 `session-telemetry-otel` 的 `mode` 字段；若实际发布的是 `0.1.3-alpha.1` 系列，则改锁已验证的对应版本号。锁定目标以"API 与本文核实一致"为准，不以版本号字符串为准。
- 分发方式：把 **Node 运行时 + dsh 及依赖 + `$DSH_HOME`（settings/cordis.patch/插件/skills）** 打进 `resources/`。Electron 主进程用 `child_process.spawn` 起 `node <打包dsh>/bin/dsh --profile sdk`。
- `--profile sdk` 起 JSON-RPC stdio server（已读 `sdk/server/README.md`），前端经 `HarnessClient` 连。
- 复用现有 `cordis.patch.yml`（含关遥测、沙箱化技能、关 goal 家族、Mochi 插件）——**打包时一并拷进 `$DSH_HOME`**，否则演示会扫进 17 个无关技能或泄遥测。
- 注意 `.nosync` 是本项目本地 iCloud 排除约定，**打包时不带 `.nosync` 后缀**，改用普通目录（如 `app/resources/dsh-home`）。

### 8.3 Mac Gatekeeper / Windows SmartScreen 签名（实际障碍，给出降级）

- **现实**：比赛无 Apple Developer / Microsoft 证书预算（也不该花钱）。未签名 app：
  - Mac：双击报「无法验证开发者」→ 用户需右键「打开」或 `xattr -cr` / 系统设置放行。**仍可运行**。
  - Win：SmartScreen 弹「未知发布者」→ 点「仍要运行」可过。**仍可运行**。
- **降级方案（不签名也能演示）**：
  1. 打包脚本输出时 `codesign --force --deep --sign -`（ad-hoc，仅本地标识，不解决 Gatekeeper 警告，但避免破损）。
  2. 随包附 **`README-运行.md`**：Mac 写「右键打开 / 终端 `xattr -dr com.apple.quarantine <app>`」；Win 写「SmartScreen 点仍要运行」。
  3. 演示前在目标机**预装一次**并放行，现场直接开。
- **不建议**：为比赛去买 $99/年 开发者证书（超预算、且 26 天里证书签发+公证周期紧）。`TO_BE_RESOLVED_BY_CODEX`：若学校愿出证书，再走正式 `codesign --options runtime --timestamp` + notarize / Win EV 证书。

> 🔴 **修订记录（设计修订官 / P0-6）**：原第 4 点"Web 版兜底（`dsh --profile web` 起 3080）"已删除——违反用户硬指令2"做的是桌面 APP，不是网站"。`dsh --profile web` 是另起浏览器部署的网站，必须砍。**区分**：Electron 主进程用 WebView 渲染官方 Web SPA（即 `08_DESKTOP_APP_ARCHITECTURE.md` 的官方推荐路径）仍是桌面 APP，合法，不砍。机房管控时靠"预装+放行"解决，不退化成网站。

### 8.4 遥测必须关 + 教师自助填 Key

- 打包的 `$DSH_HOME/cordis.patch.yml` **必须含 `session-telemetry-otel: disabled: true`**（已有，复刻）。

> 🔴 **修订记录（设计修订官 / P1-3 复核）**：04_REVIEW 建议把遥测键改成 `mode: DISABLED`。经核实源码 `packages/session/session-telemetry-otel/README.md` 与**实际生效的 `.mochi-home.nosync/profiles/headless/cordis.patch.yml`**，本计划写的 `disabled: true` 是 Cordis 装载层的"整条插件禁用"指令（patch entry 级 `disabled: true`），**已实测生效、校园数据不出校**——这是合法的、且是本项目正在用的形式，不是错误。`mode: DISABLED` 是插件内的"保留插件但关闭导出"备选（默认即 DISABLED）。两者都能关遥测；保留已验证的 `disabled: true` 不动，避免回归。打包确保无 `mode: FULL`、无 `exporter.url` 即可。

- 教师自助填 Key：APP 首次启动弹设置页 → 写 `$DSH_HOME/.credentials.yaml`（0600）→ 写 `settings.yaml` 的 `apiKeyEnv` 指向该键名。流程不硬编码任何 Key。
- 提供「模型选择」下拉（机制见 `09_MODEL_SWITCHING.md`）：默认 `glm-4-flash`，可选 `glm-4.7-flash`（标注限流风险）。

---

## 9. 实施路线图（最重要，先给计划）

### 9.1 阶段表（约 26 天，高中生 + 上学，现实估算）

> 单位：人日（周末可全天，平日约 1–2h）。稳定 > 功能数量。

| 阶段 | 做什么 | 产出 | 验收标准 | 耗时 | 优先级 |
|---|---|---|---|---|---|
| **P0-1 内核固化** | 锁定 `cordis.patch.yml`：关遥测/沙箱技能/关goal/装Mochi插件；验证 `glm-4-flash` 工具调用稳定 | 稳定的 headless 运行配置 | `mochi.sh` 跑通 5 个 Golden Demo 的底层工具调用 | 2 天 | **P0** |
| **P0-2 人格与红线** | persona+SKILL.md 补反问抑制；写 `mochi-approval` 三态监听器；验证 DENY 走 LLM 解释 | `mochi-approval` 插件 + 改后 persona | Local Rule Direct Return Rate < 5%；DENY 工具模型自然解释 | 3 天 | **P0** |
| **P0-3 工具接入** | 工具层 Agent 产出的 **38 个工具**（以 01 §1.2 明细为准，原稿"60+"口径已作废，见 04_REVIEW R1）经 `defineTool` 注册（`jxl.student_query` 已示范）；描述指令化 | 工具插件（依赖另一 Agent） | Tool Selection Accuracy ≥ 90%；必调场景不反问 | 并行 5 天 | **P0** |
| **P0-4 前端骨架** | Electron + React 壳；SDK `HarnessClient` 连 dsh；对话流 + 16 状态 reducer | 能对话的桌面 APP | 能发消息、收流式回复、看工具调用 | 5 天 | **P0** |
| **P0-5 ExpressiveOrb 接入** | 复制 Orb 引擎（只读原项目）接 4 个 Agent 状态；焦糖视觉规范落地 | 有灵魂的对话界面 | 无塑料感/无横滚/全圆角；Orb 随状态变 | 3 天 | **P0** |
| **P0-6 确认卡** | CONFIRM 工具弹待确认卡（写清"我要做什么"）；APPROVAL 四态 | 权限闭环 UI | 发消息/改记录前弹卡；DENY 不弹 | 2 天 | **P0** |
| **P0-7 打包 Mac** | Electron 打包 + 内置 dsh + 关遥测 + 填 Key 流程 | Mac .app（未签名+README） | 目标 Mac 右键打开能跑通 demo | 3 天 | **P0** |
| **P1-1 Skills 第一批** | **5 个** Teacher Skill（§4.2，原 10 已砍，04_REVIEW P1-6），方法体注入 | skills/ 下 5 个 SKILL.md | 每类任务走对应 Skill 工作流 | 4 天 | **P1** |
| **P1-2 Eval v1** | 150 条 case + headless 驱动脚本 + 指标看板 | eval 脚本 + 报告 | 9 指标达标（Hallucination=0） | 3 天 | **P1** |
| **P1-3 A2A 演示** | **单机模拟**：另一个 Mochi / Resource Agent 用本地第二个 dsh profile（或进程内 mock）扮演，不包 `subagent-acp`（其在 `acp/README` 定位 automation-only、无人在环，会破坏 02 的 APPROVAL_REQUIRED）；Golden Demo 1/2/3/4 在单机双 profile 跑通（见 02 R2 裁决 / 04_REVIEW P0-1） | 跨 Agent 闭环（单机） | A2A Completion ≥ 75% | 3 天 | **P1** |
| **P1-4 记忆轻量** | **砍 `mochi-episodic`**（P1 末或砍，见 04_REVIEW P1-7）：v1 只靠 dsh 自动的 Conversation + `context/` Working 记忆；仅加"指代消解 few-shot"进 `agent-instructions` | 指代"昨天那个"可用 | Memory 类 10 条 case 过 | 2 天 | **P1** |
| **P1-5 打包 Win** | Electron Win 打包 + SmartScreen 降级 README | Win 安装包 | 目标 Win 点"仍要运行"能跑 | 2 天 | **P1** |
| **P2-1 模型路由** | **砍自研 router**：模型切换是一等公民功能，改由 **`09_MODEL_SWITCHING.md`** 定义（类 Codex CLI `/model`，含自定义 provider）；免费档默认 `glm-4-flash`，不写死（指令 A） | 用户随时切模型 | 见 09 文档验收 | 2 天 | **P2** |
| **P2-2 多节点视角** | **砍**（已在 §9.3 第 1 点明确）：Student/Service Mochi 留答辩"下一步" | — | — | — | **砍** |
| **P2-3 Web 兜底** | **砍**（P0-6 违反硬指令2"做桌面 APP 不是网站"）：不另起 `dsh --profile web` 浏览器部署版。Electron + WebView 渲染桌面 APP 合法（见 08_DESKTOP_APP_ARCHITECTURE R8） | — | — | — | **砍** |

### 9.2 总耗时与里程碑

- **P0（拿不出手就不叫完成）**：约 23 人日 → 在 26 天内、周末全力 + 平日挤，可达成。是比赛底线。
- **P1（加分）**：约 15 人日 → 在 P0 稳后做，优先级低于"P0 不出 bug"。
- **P2（有余力）**：约 6 人日 → 看 P0/P1 进度，做不到就砍。
- **关键里程碑**：第 7 天出"能对话的桌面 APP"（P0-1~5）；第 14 天出"带确认卡的完整闭环"（P0-6）；第 20 天 Mac 打包（P0-7）；第 26 天前 P1 收尾。

### 9.3 明确建议砍掉（现实约束下）

1. **砍 P2-2 多节点视角**：四类节点是总纲愿景，但 26 天里把 Student/Service Mochi 全做稳不现实。先做 **Teacher Mochi 单视角跑通 Golden Demo 1/2/5**，A2A 只做"派给 Resource Agent"演示级（单机模拟，见 02 R2）。多角色 identity/scope 隔离留作答辩"下一步"。
2. **砍复杂工作流编排**（workflow/goal）：`goal` 家族已关，不要为比赛重开；多步任务靠 Skill 方法体 + subagent 足够。
3. **砍自研动态 router**：模型切换是**一等公民功能**，不写死三档路由——改由 **`09_MODEL_SWITCHING.md`** 定义（类 Codex CLI `/model`，用户随时切 + 加自定义 provider 极简，指令 A）。免费档默认 `glm-4-flash`；`glm-4.7-flash` 仅作为用户可在 `/model` 里手动选的备选（限流风险标注）。
4. **砍 Web 版**（P0-6 / 硬指令2）：绝不另起 `dsh --profile web` 浏览器部署版。机房管控靠"预装+放行"解决。Electron WebView 嵌官方 Web SPA 是桌面 APP 合法实现，保留。
5. **砍任何"本地规则生成话术"的试探**：哪怕能省 token，也违反 §1 红线，评测会挂。

---

## 10. 文件与模块变更图

### 10.1 新增模块（Mochi 侧）

| 路径 | 作用 | 依赖 |
|---|---|---|
| `plugins/mochi-approval/` | 三态 AUTO/CONFIRM/DENY 监听器（§3.1，注册必须用 `ctx.waterfall`，非 `ctx.on`） | user-approval 的 `approval/request` |
| `plugins/mochi-profile/` | 老师偏好存储（§2.3，落本地 JSON） | 本地 JSON |
| `plugins/mochi-episodic/` | **P1 末或砍**（04_REVIEW P1-7）：v1 不建，只靠 Conversation+Working 记忆 | — |
| `skills/<5 个>/SKILL.md` | Teacher Skills（§4.2，原 10 个已砍到 5） | 工具层（01 §1.2 权威清单） |
| `app/`（Electron+React） | 桌面前端 + 状态机 + ExpressiveOrb 副本（§7） | dsh-sdk-client |
| `app/src/design/` | **直接复用**联动计划 `calm-tokens.css` + Orb 组件（§7.3/§7.5，不新建设计语言） | — |
| `plan/eval/` | **~50 条** case + 驱动脚本（§6.3，原 150 已砍到 ~50，04_REVIEW P1-5） | mochi.sh |

### 10.2 必须保留（不要动）

- `$DSH_HOME/settings.yaml`、`profiles/headless/cordis.patch.yml` —— 现有配置已解决 4 个真问题，复刻进打包。
- `plugins/mochi-campus/`（campus_query_student 示范）、`plugins/mochi-hello/` —— 参考实现。
- `skills/mochi/SKILL.md` —— 人格源，格式合规，复用为模板。
- `mochi.sh` —— 运行入口封装。
- `mochi-harness-src.nosync/` —— 内核源码只读参考。

### 10.3 禁止改动

- `/Users/a1379/Documents/联动计划/` **任何文件**（含 ExpressiveOrb 源）——只读，需改的复制到 `app/` 再改。用户已用 `find -mmin -60` 自证零改动，本轮同样零改动。
- 不修改 `mochi-harness-src.nosync/` 内核源码（"没改一行 dsh 源码"是已跑通前提）。

### 10.4 区域不要动（组合装配）

- 不要重开 `goal` 家族（已关且联动性强）。
- 不要开 `session-telemetry-otel`（校园数据）。
- 不要把 `skill-filesystem` 的 `includeDefaultRoots` 改回 true。

---

## 附：本文件未决项汇总（诚实标注）

- `TO_BE_RESOLVED_BY_CODEX`：per-turn 动态换模型是否支持（§5.2）。
- `TO_BE_RESOLVED_BY_CODEX`：`mochi-profile` 落库用 settings API 还是本地 JSON（§2.3，倾向 JSON）。
- `TO_BE_RESOLVED_BY_CODEX`：dsh 官方 eval harness 是否适合端到端对话评测（§6.3）。
- `TO_BE_RESOLVED_BY_CODEX`：是否有 per-tool「强制调用」开关（§1.4）。
- `TO_BE_RESOLVED_BY_CODEX`：正式签名证书路径（仅当学校出资，§8.3）。
- 已读源码确认的点：approval waterfall 注册形态（`approval/request` + `(req,next)`）、SKILL.md 格式、SDK stdio JSON-RPC、permission-presets 配置、compaction/context/identity/scope 职责、dsh Node≥22.19 + MIT。
