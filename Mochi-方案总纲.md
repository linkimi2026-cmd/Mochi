# Mochi · 方案总纲

> 赛事：嘉祥教育集团 AI 创意实践大赛（高中组）　截止 2026-09-30　立项 2026-09-04
> 内核：Mochi Harness（dsh）`0.1.2-rc.1`　MIT 协议　Everything is a Plugin
> 源项目：`/Users/a1379/Documents/联动计划`（网页端，357 测试全绿，保留不动）

---

## 〇、名字与重新定义

**Mochi** —— AI 的名字，也是整个项目的名字。

> **嘉行联**负责连接校园中的**状态**。
> **Mochi** 负责连接校园中的**人、Agent 和任务**。

不是"一个校园医务系统 + 一个 AI 助手"，而是**一个跑在校园里的 Agent 协作网络**。

---

## 一、Mochi Dispatch Protocol v1

### 1.1 四类节点（同一 Runtime，不同 Context）

| 节点 | 身份 | 例子 |
|---|---|---|
| **Student Mochi** | 学生 | 每个学生的个人 Agent |
| **Teacher Mochi** | 教职工 | 班主任、任课老师、校医、门卫 |
| **Service Mochi** | 职能服务 | 医务室、教务处、宿舍管理 |
| **Resource Agent** | 资源代理 | 打印机、投影仪、教室、试卷柜 |

**关键设计**：四类节点跑在**同一个 Runtime** 上，只是 `identity` 与 `scope` 不同。
不是四套系统，是**一套系统的四种视角**——这正是 dsh "一个内核 + 配置层组合" 的天然形态。

### 1.2 每个 Mochi 必须回答三个问题

1. **我是谁**：identity + role
2. **我知道什么**：授权范围（scope）内的状态
3. **我能做什么**：注册出去的 Capability

### 1.3 v1 四个核心原语（先做这四个，其他全砍）

| 原语 | 语义 | v1 实现路径 |
|---|---|---|
| **ASK** | 向另一个 Mochi 提问，拿回答案 | Cordis Service 调用 / subagent |
| **REQUEST** | 向人或 Agent 发起请求，需要对方响应 | `user-questions` 服务（原生） |
| **FIND** | 找到某个资源或某个能办事的 Agent | Capability Index 查询 + 校园 SQLite |
| **APPROVE** | 需要人类确认才能继续 | `tools/pre-execute` 策略门 + previewToken |

配套：**Agent Discovery**（能力注册与发现）、**Artifact**（结果物传递）、**Task Lifecycle**。

**明确不做**（v1 砍掉）：RESERVE / SCHEDULE / ASSIGN / COLLABORATE / ESCALATE。
理由：26 天，四个原语跑通比九个半成品有价值得多。

### 1.4 权限模型（重要，避免重蹈覆辙）

> **权限系统只过滤工具结果，最终的话让 AI 自然说。**
> **不再回到 `if (student) return 固定隐私回复` 的老问题。**

落地方式：
- 权限裁决发生在**工具层**（`tools/pre-execute` 瀑布策略门 / `ctx.tools.guard()`）
- 模型拿到的是**过滤后的结果**
- 由模型**自然表达**，不在 composer 层硬编码话术

这样同一个问题，班主任和任课老师问，答案的详略是 AI 自己组织出来的，而不是两套 if-else。

---

## 二、为什么 dsh 是 Mochi 的天然地基（本机实证）

以下**不是推测**，是 2026-09-04 在本机 `dsh --dump-config` 实测的插件装配表。

| Mochi 需要 | dsh 原生提供 | 实测证据 |
|---|---|---|
| 一个 Runtime | Cordis 插件内核 | `dsh --version` → `0.1.2-rc.1` ✅ |
| **Mochi 派任务给 Mochi** | `subagent` + `subagent-spawn-in-process` + `subagent-fork-in-process` | 装配表第 236/238/242 行 ✅ |
| **跨进程 Agent** | `subagent-acp`（ACP JSON-RPC over stdio） | 官方包 ✅ |
| Task 编排 | `workflow-worker-thread`、`goal`、`plan-mode` | 装配表第 262 行 ✅ |
| **Human Approval** | `approval`（默认策略 `ask`）、`permission` presets | 装配表 ✅ |
| AI 主动反问 | `user-questions` | 装配表 ✅ |
| Artifact 传递 | `attachment-local`、`storage-domain` | 装配表 ✅ |
| 后台长任务 | `jobs`（dsh-jobs-local）、`tool-jobs` | 装配表 ✅ |
| **数据库** | `session-query-sqlite`（内核自己就用 SQLite） | 装配表 ✅ |
| 多模型切换 | `llm-pi-ai`（近 40 家 + OpenAI 兼容） | 装配表 ✅ |
| Key 存储 | `credentials`、`settings` | 装配表 ✅ |
| 技能系统 | `skill`、`skill-filesystem`、`tool-skill` | 装配表 ✅ |
| UI 槽位 | `ui-slots` / `ctx.slots` | DeepWiki |
| **插件注册 UI 渲染器** | `ctx.uiConversation`（event definitions + view builders） | DeepWiki |

**结论**：Mochi Dispatch Protocol 不是从零造轮子，是站在 dsh 肩膀上做**校园领域的一层组合**。
这既是速度优势，也是答辩时的分量——"我们用的是 DeepSeek 官方开源 Agent 内核（MIT）"。

---

## 三、架构

```
┌──────────────────────────────────────────────────┐
│  Mochi 界面（React + 焦糖绘本视觉 + ExpressiveOrb）│  100% 自有
│  · 对话流 / 模型切换器 / 插件面板 / 待确认卡片      │
└──────────────────┬───────────────────────────────┘
                   │ 同源 HTTP：REST + SSE 流式
┌──────────────────▼───────────────────────────────┐
│  jxl-gateway 插件（自注册路由 + 静态资源）          │  隔离内核变动
└──────────────────┬───────────────────────────────┘
                   │ ctx.*
┌──────────────────▼───────────────────────────────┐
│  dsh 内核（Cordis）                               │
│  subagent · agent-loop · tools · approval · llm   │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────┐
│  Mochi Dispatch 插件                              │
│  · Capability Index（ASK/REQUEST/FIND/APPROVE）   │
│  · 校园域工具（14 个，从现有 worker 迁移）          │
│  · 本地 SQLite                                    │
└──────────────────────────────────────────────────┘
```

### 不让前端直连 Typert 的三个理由

1. `assertTrustedAuthority` 校验 Host/Origin（防 DNS rebinding），**跨域调用会被拒**
2. Typert 依赖 build-time 代码生成 + `@Remote` 装饰器，与内核耦合深
3. dsh 处于 Preview，内核接口会变——**自写网关可把变动隔离在一层里**，前端契约不动

---

## 四、UI 插件化：分三层

| 层 | 做法 | 价值 |
|---|---|---|
| **L1 架构层** | Mochi 界面由 `jxl-gateway` 插件提供路由与静态资源 | ★★★★★ 事实（评委看不见） |
| **L2 界面层** ★主打 | 插件通过 `ctx.uiConversation` 注册自己的结果卡片；**现场装插件 → 界面多一种卡片** | ★★★★★ **肉眼可见** |
| **L3 装饰层** | ExpressiveOrb 做成客户端插件注入 `shell.overlay` 槽位 | ★★★ 补充证据 |

L2 是官方原生能力（`ctx.uiConversation` 的 event definitions + view builders），我们只需把渲染器换成自己的视觉。

---

## 五、5 个 Golden Demo（验收标准）

Mochi Dispatch v1 做成没做成，就看这五条能不能一次跑通：

1. **找卷子**：老师问"昨天那份数学卷子在哪" → FIND 定位资源 → 由 Resource Agent 应答
2. **放行审批**：学生申请外出 → APPROVE → 弹待确认卡 → 老师确认 → 闭环
3. **跨班协作**：A 班老师问 B 班借教具 → Mochi 派给 Mochi（subagent）→ 对方回应
4. **医务室预约**：校医 Mochi 收到 REQUEST → 安排 → 状态回传
5. **权限差异**：班主任 vs 任课老师问同一个学生 → 工具层过滤 → **AI 自然给出详略不同的回答**

第 5 条最能证明"权限不靠 if-else 硬编码"。

---

## 六、技术决策记录（ADR）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| A1 | 内核 | dsh 锁 `0.1.2-rc.1`，比赛前不升级 | MIT、subagent/approval/多模型原生 |
| A2 | 前端 | 自有 React，搬现有视觉资产 | ExpressiveOrb 可直接复用 |
| A3 | 接入 | 自写网关插件 + REST/SSE | 隔离内核变动；流式自主可控 |
| A4 | 数据库 | 本地 SQLite | 内核已用 SQLite（`session-query-sqlite`），同栈 |
| A5 | Key | 首次启动向导 → `credentials`/`settings` | 老师自填；官方 Web UI 同路径 |
| A6 | 权限 | `workspace-write` + approval=`ask` | AI 只在会话工作区写，危险动作必问 |
| A7 | 打包 | 先跑通 CLI，第三周再包壳 | 打包吞 1–2 天，收益在最后 |
| A8 | **遥测** | **关闭 `session-telemetry-otel`** | 校园健康数据默认上报 `harness-telemetry.deepseeksvc.com`，必须处理 |

---

## 七、风险台账

| 风险 | 等级 | 对策 |
|---|---|---|
| 现场断网 → Agent 全废 | 🔴 高 | **必拍离线录屏兜底** |
| Preview 破坏性变更 | 🔴 高 | 锁版本；网关隔离；**源码要能回退（见下）** |
| 时间不够（26 天且要上课） | 🔴 高 | 只做四原语；演示视频优先 |
| APP 未签名被拦 | 🟠 中 | 提前演练"右键→打开"；备 Web 版 |
| `pnpm install` 被 WorkBuddy shim 卡死 | 🟠 中 | 命令前 `unset CODEBUDDY_SESSION_ID CLAUDE_SESSION_ID` |
| 遥测/隐私 | 🟠 中 | 关闭遥测，材料里说明 |

---

## 八、源码策略（关键）

**发布包不含源码**：npm 的 `@deepseek-ai/dsh` 只有 `lib/` 编译产物
（实测：`*.ts` 0 个、`*.d.ts` 0 个、无 `packages/`）。
→ 写插件没有类型提示，也读不到官方插件实现。**源码是刚需。**

**正确做法：完整克隆，不用浅克隆。**

浅克隆（`--depth 1`）的问题：
- ❌ **无法回退版本**——Preview 项目最致命。若 `0.1.2-rc.1` 有坑，想退 `0.1.1` 做不到
- ❌ 无法 `git log`/`blame` 查接口为什么变
- ❌ 切 tag/branch 困难
- ✅ 唯一优点：源码树完整（能读能学）

**网络实况**：GitHub 走代理可达（本机 `HTTP_PROXY=127.0.0.1:61900`）；
默认分支是 **`master`**（不是 `main`）；git 直连握手慢，用 zipball 或给 git 显式配代理。

```
# 推荐：完整克隆（带历史，可回退）
git -c http.proxy=http://127.0.0.1:61900 clone https://github.com/deepseek-ai/mochi-harness.git

# 保底：zipball 拿源码树（等价浅克隆）
curl -L -o dsh-source.zip https://codeload.github.com/deepseek-ai/mochi-harness/zip/refs/heads/master
```

拿到后立刻 `git rev-parse HEAD > LOCKED_COMMIT` 锁版本。

---

## 九、里程碑（9/4 → 9/30）

| 周次 | 目标 | 止损线 |
|---|---|---|
| 9/4–9/10 验证周 | 源码就位 ✅、CLI 跑通 ✅、**迁移 1 个工具 + 验证 SSE 流式** | 自定义工具跑不通 → 切自研迷你 harness |
| 9/11–9/17 | 14 工具迁移 + 四原语 + 模型切换 | — |
| 9/18–9/24 | 自有前端整合 + 5 个 Golden Demo + **演示视频必须拍完** | 打包不成就演示 Web 版 |
| 9/25–9/30 | APP 打包 / 申报材料 / 答辩演练 | — |

---

## 十、已核实的 dsh 事实清单

- **License** MIT ✅｜**系统** Windows 10+ / macOS 10.15+ / Linux ✅
- **运行时** Node `^22.19 || >=24`（本机 22.22.2 ✅）、pnpm（本机 11.22.0 ✅）
- **版本** `0.1.2-rc.1`（9/3 仍在更新）⚠️ Preview
- **凭据** `$HOME/.dsh/.credentials.yaml`，Web UI write-only
- **多模型** `$DSH_HOME/settings.yaml` → `llm-pi-ai.providers.<id>.{api,baseURL,models}`，改完免重启
- **沙箱** macOS/Linux 用 `bash-sandbox`，Windows 用 `pwsh-sandbox`（平台互斥，原生设计）
- **权限** `workspace-write` 默认，`approval` 默认 `ask`
- **Web 层** Typert RPC（POST）+ WebSocket 多路复用流；`assertTrustedAuthority` 校验 Origin
- **ACP** 官方实现**不流式**（只发 committed message）；社区 `dsh-acp-gateway` 是流式超集
- **客户端插件三约束** 不能自带 React / CSS 必须内联字符串 / 插件 ID 唯一
- **坑** `pnpm add file:` 是复制不是链接，改代码要 remove+add
- **坑** Web UI 偶发假死（端口在监听但请求超时），需看门狗
- **打包** 官方在用 `@yao-pkg/pkg` 做 SEA 单文件可执行
- **混淆项** 另有同名第三方 `HenryZ838978/mochi-harness`（Python），非官方，别装错

---

## 十一、Agent-to-Agent：dsh 的一等公民（源码实证）

```
packages/subagent/
├── subagent                  核心抽象
├── subagent-acp              跨进程（JSON-RPC over stdio）
├── subagent-spawn-in-process / fork-in-process / in-process-driver
├── subagent-dsh-sdk
├── subagent-claude-code      可驱动 Claude Code 作为子代理
├── subagent-codex            可驱动 Codex 作为子代理
├── tool-subagent             ★ 派任务暴露为"模型可调用的工具"
└── tool-subagent-control     子代理控制
```

另有独立包组：`acp` / `mcp` / `workflow` / `plan` / `goal` / `schedule`

**最关键的是 `tool-subagent`**：派任务给别的 Agent 是一个**注册在工具表里的工具**，
意味着模型可以**自主决定**"这件事该派给谁"——而不是我们写死路由规则。
这就是 Mochi Dispatch 想要的形态，而且是原生支持的。

---

## 十二、整体迁移：换底盘，不是重写

现有网页端（React + Hono Worker + D1）迁到 Mochi（React + dsh 插件 + SQLite）：

| 层 | 现状 | 迁移后 | 工作量 |
|---|---|---|---|
| 前端视觉 | React + 焦糖令牌 + ExpressiveOrb | **原样搬** | 几乎为零 |
| 业务逻辑 | Worker TS（14 工具 + 权限 + 闭环） | dsh 插件 TS | **直接搬**（同语言） |
| 数据库 | D1（SQLite 方言） | 本地 SQLite | 小（SQL 兼容，换驱动） |
| 数据访问 | D1 prepared statement API | better-sqlite3 | 中（要改 DAO 层） |
| 鉴权 | Worker session/JWT | dsh identity + scope | 中（对齐 identity 模型） |
| 路由 | Hono | jxl-gateway 插件自注册 | 中 |
| Mochi 传话网络 | mochi_relay_messages 表 | **直接搬** + 升级为 Dispatch 原语 | 小 |

**结论**：357 个测试和业务逻辑是资产不是包袱。**D1 就是 SQLite**，SQL 基本不用改；
TS 代码可以直接搬。真正要重写的是"底盘接口"（DAO / 鉴权 / 路由），业务规则不动。

**迁移动作**：先迁 14 个工具为 dsh 插件 → 再迁 DAO → 最后接前端。逐步验证，不一次性切换。

---

## 十三、Mochi 界面：工作台，不是欢迎页

**现状问题**：首页是"老师你好"式欢迎页，不解决任何实际问题。

**改造目标**：打开就能干活。首页 = 今日作战台。

```
┌─────────────────────────────────────────────┐
│  Mochi  ·  今日待办          [模型切换 ▾]    │
├──────────────────┬──────────────────────────┤
│ 待我确认 (3)      │  Mochi 对话区             │
│ · 张三→医务室     │  （不再是唯一内容）        │
│ · 李四 超时未归   │                          │
│                  │  ┌────────────────────┐  │
│ 在外未归 (5)      │  │ 焦糖小球 Mochi      │  │
│ 今日异常 (2)      │  └────────────────────┘  │
├──────────────────┴──────────────────────────┤
│ 快捷动作：登记外出 · 查学生 · 发通知 · 装插件  │
└─────────────────────────────────────────────┘
```

设计原则：
- **待办优先**：一进来先看到"要我做什么"，而不是"我是谁"
- **Mochi 是助手不是主角**：对话区退为常驻侧栏，不再是页面全部
- **快捷动作**：高频操作一步直达，不用先问 AI

---

## 十四、消息与匹配（更灵活的录入）

**现有**：只能被动查询（老师问，AI 答）。

**目标**：双向。

| 方向 | 场景 | 实现 |
|---|---|---|
| **Mochi → 老师**（主动） | "王五返班超时 20 分钟了" | 事件驱动 → Mochi 主动播报，不等提问 |
| **老师 → Mochi**（自然语言录入） | "张三要去医务室" → 直接登记 | intent 解析（已有）+ previewToken 确认 |
| **Mochi → Mochi**（委派） | A 班老师问 B 班借教具 | `tool-subagent` 派发（原生） |
| **同学 → Mochi** | 学生上报不适 | Student Mochi 收 → 按 scope 路由给相关老师 |

关键点：**录入路径不止一条**。既能走表单，也能直接跟 Mochi 说一句话。
后者依赖现有的 intent 解析 + 待确认预览，直接复用。

---

## 十五、验证记录（2026-09-04 晚，全部本机实测）

| # | 验证项 | 结果 |
|---|---|---|
| 1 | dsh CLI 能否运行 | ✅ `dsh --version` → `0.1.2-rc.1` |
| 2 | 插件装配表导出 | ✅ 353 行，55 个包组可见 |
| 3 | **自定义插件能否挂载** | ✅ `[Mochi] hello plugin loaded!` 成功执行 |
| 3b | **校园工具插件（`defineTool`）** | ✅ `campus_query_student` 注册成功，schema 校验通过 |
| 4 | subagent / acp / mcp 是否存在 | ✅ 源码完整，且能驱动 Claude Code / Codex |
| 5 | 内核是否已用 SQLite | ✅ `session-query-sqlite` 在装配表内 |
| 6 | 源码可获取 | ✅ 2920 个 .ts、55 个包组（zipball 通道可用） |
| 7 | Key 未配置时的行为 | ✅ 友好报错并提示配置路径 |

**第一周止损线（自定义工具跑不通就转自研）已通过。**

**待办（下一步）**：

- ✅ 写一个 `defineTool` 校园工具 —— **已完成**（`campus_query_student` 已注册成功）
- ⬜ **配 API Key（唯一阻塞项）**：`export DEEPSEEK_API_KEY=sk-xxx`
  或写入 `$DSH_HOME/.credentials.yaml`
- ⬜ 跑通一次完整对话，验证模型能**自主调用**工具
- ⬜ 验证流式输出

### 本机运行备忘

```bash
# 所有 dsh 命令需要这三项：unset shim 变量 + 项目内 DSH_HOME + 绝对路径 dsh
cd /Users/a1379/.workbuddy/binaries/node/workspace
env -u CODEBUDDY_SESSION_ID -u CLAUDE_SESSION_ID \
    DSH_HOME=/Users/a1379/Documents/Mochi/.mochi-home.nosync \
    /Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node \
    node_modules/.bin/dsh --profile headless "任务"   # 插件已常驻，无需 --patch

# 配 Key（三选一）
export DEEPSEEK_API_KEY=sk-xxx        # 环境变量
# 或写入 $DSH_HOME/.credentials.yaml  # 老师填的路径
# 或 Web UI → Settings → Models      # write-only
```

### 插件安装与挂载（正确姿势，已踩坑验证）

dsh 装插件分两步，**`plugin add` 只装包、不挂载**：

```bash
# 1) 装包（用 link: 不用 file: —— file: 是复制，改代码不生效）
dsh plugin --profile headless add "link:/path/to/plugin"

# 2) 挂载：写进常驻 patch 层
#    文件：$DSH_HOME/profiles/<profile>/cordis.patch.yml
- insert:
    - id: mochi-hello
      name: mochi-hello
```

**两条硬规则**

1. `package.json` 的 `name` 和 `version` **都不能省**
   ——dsh 会把包身份随模型请求上报（`plugin-package-inventory`），缺 version 会报错
2. **不要对已写入 patch 层的 id 再传 `--patch`**
   ——否则报 `insert: id xxx: id already exists in config`（本次实际遇到）

| 方式 | 适用 | 特点 |
|---|---|---|
| 写 `cordis.patch.yml` | **日常开发（推荐）** | 常驻，不用每次传参 |
| `--patch xxx.yml` | 临时试一次 | 与上面**二选一**，别同时用 |

**四条补充（全部实际踩过，2026-09-04）**

3. **插件自己的依赖要在插件目录里 `pnpm install`**
   ——`link:` 安装的插件，其依赖**不会**被 profile 层自动解析，
   会报 `Cannot find package '@deepseek-ai/dsh-tools'`。
   解法：插件 `package.json` 声明依赖后，**cd 进插件目录**跑 `pnpm install`
4. **JSON Schema 严格校验**：`type: 'object'` 必须显式写
   `additionalProperties: true | false`，否则报
   `unsupported JSON schema: schema.additionalProperties must be explicitly true or false`
5. **`$DSH_HOME` 不能挪出项目目录**
   ——pnpm 建的是**相对符号链接**（`../../../../plugins/...`），
   把运行时目录移到项目外会导致链接全断，报 `plugin tree failed to load`
6. **`.nosync` 后缀排除 iCloud 同步**（只在项目需要云同步时才用）

### 目录布局：源码同步、运行时不同步

项目放在 `~/Documents/Mochi`（走 iCloud），但三类大目录要排除：

```
Mochi/
├── Mochi-方案总纲.md        ✅ 同步
├── mochi.sh                 ✅ 同步
├── plugins/                 ✅ 同步（插件源码）
│   └── mochi-campus/
│       ├── index.mjs        ✅ 同步
│       └── node_modules -> node_modules.nosync   ⛔ 跳过
├── mochi-harness-src.nosync/          ⛔ 跳过（82M / 2920 个文件）
├── dsh-source.zip           ✅ 同步（22M 单文件，用于重建源码）
└── .mochi-home.nosync/        ⛔ 跳过（node_modules / sessions / 凭据）
```

iCloud 同步体积从 104M 降到约 **22M**。
（`.nosync` 是 iCloud 的约定后缀：改名后本地照样读，只是不上传。）

---

## 十六、战略对齐（与《一等奖攻坚清单》的关系）

### 16.1 Mochi 不是替代 P0，是 P0-2 的升级版

《攻坚清单》的核心诊断是：

> "你的代码够多了，缺的不是功能，是**让评委在 30 秒内看懂**的方法。"

其中 P0-2 是"让评委亲自走一遍流程"（三张 A4 纸 + 二维码扫码），理由是
**评委从"看你演示"变成"自己参与"，这在中学答辩里极其罕见**。

**Mochi 把这一条推到极致**：评委不只能扫码走流程，还能**直接跟 Agent 说话**——

> 评委："今天哪些班有异常？"
> Mochi：查库 → 汇总 → 给出简报 → 起草通知 → 弹出待确认卡

这比扫码更接近"AI 原生"，而且**桌面 APP 给软件一个物理载体**，部分对冲硬件劣势
（对方有红外测温、自动发药的实体）。

### 16.2 时间账已经变了（重要）

清单制定于 9/1，当时假设视频/材料都没做。但截至 9/4：

| 项 | 状态 |
|---|---|
| 演示视频（脚本/拍摄/剪辑） | ✅ 已完成 |
| 高中组附加三件套 | ✅ 已提交 |
| 参赛材料与提交 | ✅ 今日已完成 |
| 标注系统（数据分析页） | ✅ 已完成 |
| **答辩演练** | ⬜ **唯一剩余任务** |

**结论**：Mochi 是在"保底已完成"的前提上加码，不是与 P0 抢时间。
但有一条硬约束——**Mochi 不能挤掉答辩演练**。

### 16.3 必须继承的红线

| 红线 | 来源 | 在 Mochi 中的落实 |
|---|---|---|
| **预警只能是流程异常，绝不能是疾病预警** | P0-1 红线 | Mochi 主动播报只说"流转/超时/未闭环"，**禁止**"疑似传染病聚集""健康风险高" |
| 消息正文不得含学生姓名/学号/班级名 | P0-1 | 沿用"你负责的班级"表述 |
| 不诊断、不生成标签、不做风险评分 | 现有护栏 | 写进 Mochi 的 system prompt 与工具描述 |
| **不做硬件** | P2 | Mochi 纯软件，桌面 APP 是载体不是硬件 |
| **不做心理测评/情绪识别** | P2 | 明确排除 |
| **不做人脸/虹膜/步态** | P2 | 明确排除 |
| **不做持续 GPS** | P2 | 明确排除，并讲成伦理自觉 |
| 关闭遥测上报 | 本文档 A8 | `session-telemetry-otel` 默认上报外部域名，校园数据必须处理 |

### 16.4 定位一句话

> **嘉行联**回答"异常怎么被看见"（上游）；
> **对方项目**回答"学生生病后怎么处理"（下游，且是硬件诊疗）；
> **Mochi** 回答"看见之后，谁去办、怎么办、怎么办得完"。

三者不是同一问题的三种实现，是**三个层次**。这句话可以直接用在答辩开场。
