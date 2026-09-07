# 11 · 嘉行联 → Mochi 迁移决策总表（executable migration map）

> 文档定位：**「先列清单再迁移」指令的最终交付物**。本文是唯一给用户的拍板清单，直接照着执行。
> 读者：迁移执行者 + 审核官。
> 红线重申：`/Users/a1379/Documents/联动计划/` **只读**，所有内容仅描述现状 + 给决策；凡下结论处均有**实际读过的源码/迁移文件**支撑，未编造类名/路径/API。
> 上游文档已读并采纳：`05`（UI 盘点）、`08`（桌面架构）、`04_REVIEW`（砍刀清单 + 统一口径 R1–R8）、`07_DSH_FACTCHECK`（dsh 能力核查）、`01_TOOLCHAIN`（38 P0 工具）、`02_DISPATCH_PROTOCOL`（Relay/A2A）、`03_RUNTIME_AND_PLAN`（路线图）。
> 后端资产盘点 `06` 未产出 → 本文已**自读旧项目**补全（见 §2/§3/§4/§5 的实际代码证据）。

---

## 0. 一句话总览与最重要的一条警告

**决策分布（见各节明细，粗略计数）**：MOVE 约 38 项 / ADAPT 约 22 项 / REBUILD 约 26 项 / DROP 约 60+ 项。总计约 146 个决策点，覆盖旧项目 `src/`(88 文件)、`shared/`(17)、`worker/`(50+)、`migrations/`(25)、`apps/`(微信小程序等)。

**⚠️ 开工前必须闭合的一处架构冲突（最高优先，否则 Batch 2 会卡死）：**
`08` 架构假设「Electron 主进程用 `DeepSeekHarness`(SDK stdio JSON-RPC) 自写 UI + 用官方 approval 机制」；但 `07_DSH_FACTCHECK` Q1/Q5/Q6 已核实：**dsh 的 SDK 通道里 `server→client requests are a dead capability`（审批请求暂不下发到 SDK 客户端）**，`HarnessClient` 也「No mid-turn cancel / No per-prompt result」。即——
- 走 `08` 的「自写 UI + SDK」路线，human approval 在周转内**拉不起来**，必须**自建 answerer + 一条自定义 IPC 通道把确认卡推到 renderer**（见 §5/§7 的审批桥）。
- 走 `07` 建议的「`dsh --profile web` + 官方 SPA」路线，能白嫖审批 UI，但**会丢掉用户红线 1 的 ExpressiveOrb**（官方 SPA 是 React-free 的 Cordis client 包）。

**结论（与 04 的 R7 一致）**：坚守「自写 UI + ExpressiveOrb + SDK 路线」，但**把「审批桥」列为独立可交付物**（answerer 插件 `mochi-approval` + 主进程→renderer 确认卡 IPC）。这条在 04 的 P0-5 已点名（`ctx.waterfall('approval/request',...)` 而非 `ctx.on`），本文在 §5 / §7-Batch2 落实为可执行项。**不闭合就别进 Batch 2。**

---

## 1. 迁移决策总表（核心，按模块分组）

> 决策四选一：MOVE 原样复制 / ADAPT 复制后改造 / REBUILD 重写（新架构）/ DROP 不迁。
> 工作量单位「人时」按**高中生放学后 + 周末**估算（日均有效 ~3–4h），仅作相对量级参考；风险 L/M/H。

### 1.1 前端 / UI 模块（依据 `05_MIGRATION_INVENTORY_UI.md` + 实际 `src/`）

| 旧路径 | 新路径 | 决策 | 理由 | 工时 | 风险 | 依赖 |
|---|---|---|---|---|---|---|
| `src/components/ExpressiveOrb.tsx` + `.css` | `apps/desktop/src/orb/` | **MOVE** | 自包含，仅依赖 react+css，用户红线，原样不动 | 2 | L | — |
| `src/components/OrbCompanion.tsx` + `.css` | `apps/desktop/src/orb/` | **MOVE** | 球+小电脑，依赖 `motion`（必迁）；首版可选启用 | 3 | L | motion 包 |
| `src/components/ThinkingOrb.tsx` | `apps/desktop/src/orb/` | **MOVE** | 孤立备用件，无引用，整文件复制 | 1 | L | — |
| `src/design/calm-tokens.css` | `assets/calm-tokens.css` | **MOVE** | 设计令牌（焦糖/鼠尾草绿），R7 要求原样复用 | 1 | L | — |
| `src/design/cozy-companions.css` `cozy-pages.css` `reference-ui.css` | `assets/` | **MOVE** | 页面表面/伴宠样式，被 PainterlyPageFrame 依赖 | 2 | L | — |
| `src/design/MaterialSurface.tsx` | — | **DROP** | `grep` 全项目无引用，死代码 | 0 | — | — |
| `src/components/UI.tsx`（Avatar/Badge/Loading/Error/Empty/PrivacyBanner） | `apps/desktop/src/renderer/components/` | **MOVE** | 基础件被大量页面用，作 Mochi 组件库基座 | 3 | L | — |
| `LiquidGlass*` / `TransitionLink` / `SquircleAnchor` / `Pill` / `NavIcons` / `Logo` / `CursorLight` / `AmbientLeaves` / `LiquidToast` / `LiquidBackLink` / `AssistantAvatar` / `PainterlyPageFrame` / `ReferenceUI` | `apps/desktop/src/renderer/components/` | **MOVE** | 控件语言（liquid-glass/圆角/无横滚），复用为新 UI 原子 | 8 | L | react-router(仅 TransitionLink 需改) |
| `src/components/Layout.tsx` | `apps/desktop/src/main/`(重画) | **ADAPT** | 旧外壳含 `registerServiceWorker`/`syncAppBadge`/`OfflineBanner` pwa 调用，需剥离；Mochi 用自己的窗口外壳 | 6 | M | 去 pwa 调用 |
| `src/components/AssistantDock.tsx` + `.css` | `apps/desktop/src/renderer/` | **ADAPT** | 球即 FAB 的 dock，含 pwa 调用需剥离；逻辑可复用 | 4 | M | Orb + dsh 事件 |
| `src/components/OfflineBanner.tsx` | — | **DROP** | PWA 专属 | 0 | — | — |
| `src/pages/AssistantPage.tsx` + `.css` | `apps/desktop/src/renderer/pages/ChatPage.tsx`(重写) | **REBUILD** | 旧 AI 页强依赖 `shared/assistant`（校园规划器）；Mochi 用 dsh 会话，重写为对话/任务/设置页 | 16 | M | dsh 集成 + Orb |
| `src/pages/LoginPage.tsx` `AuthSupportPainterlyPages.css` | 部分复用 | **ADAPT** | 登录态在桌面端改为「连接嘉行联」按钮 + 本地 key 存储；judge-qr 静态图保留 | 5 | M | auth 改造 |
| `DashboardPage`/`AnalyticsPage`/`EventsPage`/`MessagesPage`/`StudentsPage`/`*DetailPage`/`NotificationSettingsPage`/`OnboardingPage`/`AdminPage`/`Activate*`/`ChangePassword` 等校园业务页 | — | **DROP** | 嘉行联网页业务，非桌面 AI 办公代理产品；作交互参考，不迁代码 | 0 | — | — |
| `MovementStoryCanvas`/`JourneyCatProgress`/`CatCompanion`/`SpritePlayer` 及 `features/movement-visual/*` `visual/movementVisual.ts` | — | **DROP** | 校园猫咪旅程可视化，与 AI 代理无关（05 已判不迁） | 0 | — | — |
| `src/lib/api.ts` | `apps/desktop/src/main/ipc-client.ts` | **REBUILD** | 旧 fetch `/api/*`；桌面改为经主进程 IPC 调 dsh/DB，不公开 HTTP | 6 | M | IPC 通道 |
| `src/lib/auth-context.tsx` | `apps/desktop/src/renderer/auth.tsx` | **ADAPT** | 端点改本地；保留 session 状态机 | 3 | L | api 改造 |
| `src/lib/format.ts` `login-errors.ts` `route-preload.ts` `useMotion.ts` `lib/motion.ts` | 对应 `renderer/lib/` | **MOVE** | 纯工具/动画封装，无后端耦合 | 3 | L | — |
| `src/lib/card-reader.ts` | — | **DROP** | 键盘楔 RFID 读卡，桌面大概率不需要 | 0 | — | — |
| `src/lib/pwa.ts` | — | **DROP** | Service Worker/Web Push/VAPID，桌面移除 | 0 | — | — |
| `src/lib/install-prompt.ts` | — | **DROP** | `beforeinstallprompt`，桌面移除 | 0 | — | — |
| `src/main.tsx` | `apps/desktop/src/renderer/main.tsx` | **ADAPT** | `BrowserRouter`→`MemoryRouter`；去 install-prompt；保留 ExpressiveOrb 挂载 | 3 | L | router 改造 |
| `src/App.tsx` | `apps/desktop/src/renderer/App.tsx` | **ADAPT** | 路由表按 Mochi 功能裁剪（chat/task/settings），去 pwa 守卫 | 4 | L | — |
| `src/styles.css` | `assets/` | **MOVE** | 全局样式；迁后逐处复核横向滚动红线（05 §2.2②） | 2 | M | 横滚复核 |
| `src/types.ts` | `apps/desktop/src/shared/types.ts` | **MOVE** | 跨边界类型，旧 `../shared/types` 引用需改相对路径 | 1 | L | — |
| `public/manifest.webmanifest` `public/sw.js` | — | **DROP** | PWA manifest + Service Worker | 0 | — | — |
| `assets/*.webp`(校园手绘 8) `characters/*`(猫 6) `brand/jellyfish` `judge-login-qr.png` | `assets/`(按需) | **MOVE/DROP** | 手绘/品牌随 Painterly 页面走（页面 DROP 则资产 DROP）；judge-qr 必留 | 2 | L | — |

### 1.2 后端模块（依据实际读 `worker/`）

| 旧路径 | 新路径 | 决策 | 理由 | 工时 | 风险 | 依赖 |
|---|---|---|---|---|---|---|
| `worker/index.ts`（Hono app + `scheduled` cron） | `apps/desktop/src/main/`(Electron 主进程) | **REBUILD** | Hono HTTP 服务在桌面不需要（08 已定 `api/` 不迁）；cron 改 Node `node-cron` | 10 | M | dsh 集成 |
| `worker/lib/auth.ts` | `apps/desktop/src/main/auth.ts` | **ADAPT** | 会话/登录逻辑保留，DB 调用改 better-sqlite3；`c.env.SESSION_SECRET`→主进程密钥 | 8 | M | DB 层 |
| `worker/lib/assistant-composer.ts` | `plugins/*`(dsh skill) 或 DROP | **REBUILD** | 内部 LLM 规划器，用 `env.AI.run`(Workers AI)；Mochi 用 dsh LLM，重写为 skill/工具 | 10 | H | dsh LLM |
| `worker/lib/assistant-session.ts` `assistant-preview.ts` | `apps/desktop/src/main/` 或 DROP | **ADAPT** | 会话上下文/预览卡，与校园规划器强耦合；可抽为通用预览卡逻辑 | 6 | M | — |
| `worker/lib/ai-provider.ts` | — | **DROP** | Workers AI / 智谱适配全走 `env.AI`；Mochi 由 dsh `llm-pi-ai`/`llm-deepseek` 接管 | 0 | — | dsh LLM |
| `worker/lib/ai-usage.ts` | `apps/desktop/src/main/quota.ts` | **ADAPT** | AI 额度计数逻辑保留，DB 改 better-sqlite3；免费档无限额可简化 | 3 | L | DB 层 |
| `worker/lib/permissions.ts` `audit.ts` | `apps/desktop/src/main/` | **ADAPT** | 权限/审计逻辑保留，DB 改 better-sqlite3 | 4 | L | DB 层 |
| `worker/lib/http.ts` `crypto.ts` | `crypto.ts`→`apps/desktop/src/main/crypto.ts`；`http.ts`→DROP | **MOVE**(crypto) / **DROP**(http) | crypto 用 Web Crypto（`crypto.subtle`/`getRandomValues`/`btoa`），Node 22 全局原生可用，近零改动；http 是 CF  fetch 封装 | 2 / 0 | L | — |
| `worker/lib/push.ts` + `messaging/*`(push-jobs/overdue/policy/auto-delete/index/create) | `apps/desktop/src/main/notify.ts` | **REBUILD** | Web Push/VAPID（`@block65/webcrypto-web-push`）→ Electron 原生 `Notification` + IPC；overdue/auto-delete 改本地定时任务 | 10 | M | Electron Notification |
| `worker/lib/messaging/overdue.ts` `worker/domain/*`(movement/dorm service+overdue) | `apps/desktop/src/main/`(domain 服务) | **ADAPT** | 校园业务域逻辑（迟到/到达超时/宿舍事件）保留为本地服务，DB 改 better-sqlite3；仅演示数据集用 | 8 | M | DB 层 + demo 数据 |
| `worker/routes/core/assistant.ts`（含 14/15 工具 dispatch） | `plugins/mochi-jiaxinglian/` + `mochi-approval` | **REBUILD** | 工具分发链重写为 dsh `defineTool`（详见 §4） | 16 | H | dsh 插件 |
| `worker/routes/core/students.ts` `events.ts` `dashboard.ts` `analytics.ts` `dorm.ts` `movements.ts` `messages.ts` | 抽为 `mochi-jiaxinglian` 读类工具 + DROP 其余 | **REBUILD/DROP** | 这些是 HTTP CRUD + 校园业务；Mochi 只保留「只读查询」能力进 `jxl.*`，其余 DROP | 12 | M | jxl 插件 |
| `worker/routes/auth.ts` `push.ts` `admin/*` | — | **DROP** | 登录 HTTP 端点 / Web Push 端点 / 校园管理后台，桌面不需要 | 0 | — | — |
| `worker/types.ts`（Bindings/AppEnv） | `apps/desktop/src/main/env.ts` | **ADAPT** | `c.env.*` 绑定类型 → 主进程 env/配置文件类型 | 2 | L | — |

### 1.3 数据模块（`migrations/` 25 个 + `shared/`）

| 旧路径 | 新路径 | 决策 | 理由 | 工时 | 风险 | 依赖 |
|---|---|---|---|---|---|---|
| `migrations/0001_schema.sql` … `0025_mochi_network_tasks.sql` | `apps/desktop/migrations/0001..0025.sql` | **MOVE** | 基线 schema，复制到 Mochi 续编（只读目录不能改，02 §9.1 已定） | 3 | M | 见 §3 |
| `migrations/0002_demo_seed.sql` `0011_demo_seed_messages.sql` `0013_demo_movement_seed.sql` `0016_demo_dorm_structure.sql` | `apps/desktop/migrations/` + `assets/demo-fixtures/` | **ADAPT** | 演示数据改为「演示数据集 fixtures」(04 P1-8)，演示模式注入 | 4 | M | demo 模式 |
| `shared/types.ts` | `apps/desktop/src/shared/types.ts` | **MOVE** | 跨边界类型 | 1 | L | — |
| `shared/assistant.ts`(646 行校园规划器) | — | **DROP** | 旧自然语言规划器（依赖旧 worker + Workers AI）；Mochi 由 dsh 接管推理 | 0 | — | dsh |
| `shared/assistant-privacy.ts` `assistant-project-context.ts` | 抽关键策略→`plugins/mochi-jiaxinglian/privacy.ts` | **ADAPT** | 隐私策略/项目上下文有价值，抽成插件内策略（不迁整文件） | 4 | M | — |
| `shared/analytics-ai.ts` `inbox-ai.ts` `class-triage.ts` `event-intelligence.ts` `dashboard-greeting.ts` | — | **DROP** | 校园 AI 分析，非桌面产品核心 | 0 | — | — |
| `shared/movement.ts` `analytics.ts` `constants.ts` `validation.ts` `time.ts` `dorm.ts` | `apps/desktop/src/shared/` | **MOVE** | 通用类型/常量/时间工具，无后端耦合 | 2 | L | — |

### 1.4 AI 模块（14/15 工具 + dsh 插件体系，详见 §4）

| 旧路径 | 新路径 | 决策 | 理由 | 工时 | 风险 | 依赖 |
|---|---|---|---|---|---|---|
| `worker/routes/core/assistant.ts` 中 15 个工具定义 | `plugins/mochi-jiaxinglian/`(≤5 `jxl.*`) + `mochi.*`(P1) | **REBUILD** | 重写为 dsh `defineTool`；详见 §4 | 16 | H | dsh 插件 |
| `worker/lib/assistant-tools.ts`(DB 查询库) | `plugins/mochi-jiaxinglian/queries.ts` | **ADAPT** | D1 异步查询改 better-sqlite3 同步；纯 SQL 逻辑保留 | 8 | M | DB 层 |
| `worker/lib/assistant-composer.ts` / `ai-provider.ts` | `plugins/mochi-campus`(已存在) + skill | **REBUILD** | 由 dsh `defineTool` + skill 替代 Workers AI 调用 | 10 | H | dsh LLM |
| `plugins/mochi-hello` `mochi-campus` `cordis.yml`（Mochi 侧已存在） | `plugins/` 原样 | **MOVE** | 已跑通参考实现，打包进 `dsh/plugins/` | 1 | L | — |

### 1.5 测试模块（旧项目 374 测试）

| 旧路径 | 新路径 | 决策 | 理由 | 工时 | 风险 | 依赖 |
|---|---|---|---|---|---|---|
| `tests/*assistant*` `tests/*relay*` `tests/*migration*`(SQL/单元) | `apps/desktop/test/`(vitest) | **REBUILD** | 保留「可离线跑」的 SQL + 校园查询 + Relay 逻辑单测，迁到 better-sqlite3 + vitest；HTTP/e2e 集成测试 DROP | 12 | M | DB 层 + vitest |
| `tests/*http*` `tests/*e2e*` `tests/*push*` `coverage/` | — | **DROP** | Cloudflare HTTP/Web Push/e2e 在桌面不适用 | 0 | — | — |

### 1.6 配置 / 构建 / 部署模块

| 旧路径 | 新路径 | 决策 | 理由 | 工时 | 风险 | 依赖 |
|---|---|---|---|---|---|---|
| `wrangler.jsonc` `worker-configuration.d.ts` `.wrangler/` | — | **DROP** | Cloudflare 部署配置 | 0 | — | — |
| `vite.config.ts` `tsconfig*.json` `vitest.config.ts` | `apps/desktop/vite.config.ts` 等 | **ADAPT** | Vite 复用，去掉 `@cloudflare/vite-plugin`；加 Electron 入口 | 4 | L | — |
| `package.json`(旧) | `apps/desktop/package.json` | **ADAPT** | 依赖重选：去 `hono`/`wrangler`/`@block65`，加 `electron`/`better-sqlite3`/`dsh`/`motion` | 4 | M | — |
| `public/`(静态) `index.html` | Electron `index.html` | **ADAPT** | 入口改为 Electron 加载本地文件 | 1 | L | — |
| `apps/wechat-miniprogram*` `work/cloudfunctions/` `cloudbase/` `data-port/` | — | **DROP** | 微信小程序/云函数/数据迁移工具，桌面不需要 | 0 | — | — |
| `DEPLOY_CLOUDFLARE.md` `*.command` 部署脚本 `WECOM_*` `WECHAT_MINIPROGRAM_*` 相关 | — | **DROP** | 云端部署/企业微信，桌面不需要 | 0 | — | — |

---

## 2. Cloudflare → Node/Electron 改造规格（已读 `worker/` 全量核实）

> 方法：对 `worker/` 全仓 `grep` `env.AI|env.KV|env.BUCKET|DurableObject|env.DB|executionCtx.waitUntil|scheduled|crypto.subtle|VAPID`。结论：**未用 KV / R2 / Durable Objects**；耦合集中在下表。

| Cloudflare API | Node/Electron 替代 | 影响范围（实测命中文件） | 改造动作 |
|---|---|---|---|
| `c.env.DB`（D1 异步：`prepare().bind().all()/{results}` / `.first()` / `.run()` / `DB.batch([...])`） | `better-sqlite3` 同步 `Database`：`prepare().all()`(返回数组) / `.get()` / `.run()` / `db.transaction(fn)` | 全 worker（~200 处 `c.env.DB.*`） | **API 形态是大改**：`rows.results`→`rows`；`.first()`→`.get()`；`DB.batch`→`db.transaction`。SQL 文本本身基本不改（见 §3）。抽 `db.ts` 统一封装 |
| `c.env.*`（APP_ENV/SESSION_SECRET/SESSION_TTL_HOURS/ARCHIVE_DAYS/VAPID_*/WECOM_*/WECHAT_MINIPROGRAM_*/AI_PROVIDER/ZHIPU_*/AI_DAILY_*_LIMIT/JUDGE_ACCESS_ENABLED） | 主进程配置（`.credentials.yaml` / `settings.yaml` / `process.env` / dsh profile env） | `worker/types.ts`、`auth.ts`、`admin/security.ts`、`ai-usage.ts`、`movements.ts` 等 | 改为读主进程配置对象；敏感项走 `0600` 文件（08 §6.3） |
| `c.env.AI`（Workers AI：`env.AI.run(model,{...})`） | dsh LLM 适配器（`llm-pi-ai` 指向智谱 / `llm-deepseek`），经 `deepseek-official` provider | `assistant-composer.ts:341/501`、`ai-provider.ts:311/476/604/649`、`analytics.ts:477`、`assistant.ts:1358`(Whisper) | **DROP** Workers AI 调用；能力由 dsh 工具/skill 承载。语音转写(Whisper)首版不做（08 §4.3 `listening` 保留不用） |
| `c.executionCtx.waitUntil(promise)`（fire-and-forget 后台任务） | Node 主进程 `void promise.catch(log)` 或后台任务集合（不阻塞响应；桌面无「响应」概念，直接异步跑） | `messages.ts:294/398`、`dorm.ts:45/108`、`events.ts:120/207`、`movements.ts:108` | 改为 `void processNotificationJobs(...).catch(...)`；Electron 主进程常驻，无实例回收问题 |
| `scheduled(cron)`（`ExportedHandler.scheduled`） | Node `node-cron` 或 `setInterval` 在主进程启动期注册 | `worker/index.ts:109-168`（4 子任务：过期消息/到达超时/推送调度/自动删除/日志清理） | 重写为 `main/scheduler.ts`，注册 4 个周期任务；异常隔离逻辑原样保留 |
| `crypto.subtle` / `crypto.getRandomValues` / `btoa`/`atob` | Node 22 全局 `crypto`(Web Crypto) + 全局 `btoa`/`atob`（均原生可用） | `worker/lib/crypto.ts`（sha256/PBKDF2/randomToken） | **近零改动**，仅确认 `globalThis.crypto` 存在；`crypto.ts` MOVE | 
| VAPID + `@block65/webcrypto-web-push` + `push.ts` 路由 | Electron 主进程 `new Notification(...)` + IPC 到 renderer；订阅/推送逻辑整体废弃 | `worker/lib/push.ts`、`messaging/push-jobs.ts`、`admin/security.ts:20`、`NotificationSettingsPage` | **REBUILD**：通知走原生 Notification；旧 `push_subscriptions` 表可保留但不再写 Web Push endpoint |
| `CF-Ray` header（日志用） | 删除（无 CDN） | `worker/index.ts:81` | 删 |
| Hono `app.fetch` HTTP 服务 + `secureHeaders` + CORS 校验 | 桌面无 HTTP 服务（08 已定 `api/` 不迁）；renderer 经 IPC 通信 | `worker/index.ts` 全文件 | 整文件 REBUILD 为主进程；CSP 仍建议在新 `index.html` 加最小 `default-src 'self'` |
| `WECOM_*` / `WECHAT_MINIPROGRAM_*` bindings + `work/cloudfunctions` | 无（企业微信不在桌面范围） | `admin/security.ts`、`apps/wechat-miniprogram*` | **DROP** |
| KV / R2 / Durable Objects | 未使用 | — | 无需处理 |

---

## 3. D1 → 桌面 SQLite（better-sqlite3）迁移规格

### 3.1 选型决策
**选 `better-sqlite3`**（与 `08` §6.1 一致）。理由：
- 同步 API，调试直观；文档/社区最全；成熟稳定。
- Node 22 原生 `node:sqlite` 仍 `experimental`（08 已标 `TO_BE_RESOLVED_BY_CODEX` 并倾向不赌）；比赛现场不接受「原生模块实验性」风险。
- 旧项目 D1 查询数量大（~200 处），同步 API 改动模式单一、可批量做。

### 3.2 25 个迁移文件能否直接跑？
**SQL 文本 95% 可直接跑**，差异在「执行层」与「少量方言」：
- ✅ 兼容：标准 SQLite 方言——`PRAGMA foreign_keys`、`AUTOINCREMENT`、`REFERENCES...ON DELETE CASCADE`、`CHECK(...)`、`CURRENT_TIMESTAMP`、`datetime('now')`/`datetime('now','-1 day')`、`ON CONFLICT(col) DO UPDATE`、`INSERT OR IGNORE`、`UNIQUE(...)`。已在 `0001_schema.sql`/`0024`/`0025` 实测属标准 SQLite。
- ⚠️ 需改造的执行层：
  1. **多语句执行**：D1 `wrangler d1 migrations apply` 逐文件跑；桌面写一个小 migrator——读 `migrations/*.sql`，按文件名排序，`db.exec(sql)` 逐文件执行，并在 `_migrations` 表记已应用（防重复）。
  2. **FK 开关**：`0001` 首行 `PRAGMA foreign_keys = ON;` 在 better-sqlite3 中不会跨语句持久——必须用 `db.pragma('foreign_keys = ON')` 在**每个连接建立时**设置（migrator + 运行期连接都要设）。
  3. **占位符**：全仓用匿名 `?` + `.bind(a,b,c)`（已 grep 确认无 `?1`/`?2` 编号占位）。better-sqlite3 同样支持匿名 `?`，**无需改 SQL**。⚠️ 个别动态列名是用字符串拼接（`assistant-tools.ts` 的 `date(${column},'+8 hours')`）——拼接本身是字符串插值，better-sqlite3 照常接受。
  4. **`DB.batch`**：D1 原子批处理 → better-sqlite3 用 `db.transaction(() => { ... })()` 包多语句。
- ⚠️ 不能跑的：无（25 个迁移里没有 D1 独占函数；`CURRENT_TIMESTAMP`/`datetime` 都是标准 SQLite）。

### 3.3 数据库文件位置
- **运行期**：`DSH_HOME/storages/mochi.db`
  - Mac：`~/Library/Application Support/Mochi/dsh-home/storages/mochi.db`
  - Win：`%APPDATA%/Mochi/dsh-home/storages/mochi.db`
- 不放 `app.asar`（只读/会被更新覆盖）。首次启动主进程创建目录 + 跑 migrator。
- 连接策略：主进程持**单例** `better-sqlite3` 连接（同步、线程安全足够桌面单用户），经 IPC 供 renderer 间接访问；绝不让 renderer 直连 DB（密钥/隔离）。

### 3.4 演示数据怎么搬
- `0002`/`0011`/`0013`/`0016` 的 seed SQL → 复制为 `assets/demo-fixtures/*.sql`，由「演示模式」开关在首次运行时注入一份独立 `mochi.demo.db`（或同库打标 `is_demo`）。
- 与 04 的 P1-8「演示数据集 fixtures」对齐：演示数据 = 学生/班级/医务室在册/课表/资源/ clinic 状态，供 `jxl.*` 读类工具演示。
- 真实模式首启若无数据，跑基线 migration 但**不灌 seed**（用户自带数据或连接嘉行联后写入）。

---

## 4. 14 个 AI 工具的迁移规格（关键资产）

> **位置勘误（重要，避免执行者找错文件）**：用户提到的 `worker/lib/assistant-tools.ts` 实际是 **DB 查询函数库**（如 `loadStudentLateStats`），**不是工具定义**。真正的 15 个工具定义在 `worker/routes/core/assistant.ts` 的 dispatch 链（`if (call.tool === ...)` @ L868–900）+ `CAPABILITY_PHRASES`(@L400–416)。下文按 15 个列（用户说「14」可能是未计 `NAVIGATE` 或 `MOVEMENT_PREVIEW`；本文如实列全 15，由执行者按演示需要裁剪）。

### 4.1 逐个工具 → dsh 映射

| # | 旧工具名 | 功能（实测） | 能否直接映射 `defineTool` | dsh 新名 | 工作量 | 处置（融入 38 工具体系） |
|---|---|---|---|---|---|---|
| 1 | `ATTENTION_ITEMS` | 归拢今日待留意事实 | 是（包成查询工具） | `jxl.campus_status`(topic=attention) 或新 `jxl.today_brief` | 3 | **补充** jxl 域；不在 38 内，属 Organization Plugin |
| 2 | `MOVEMENT_PREVIEW` | 批准学生去医务室/宿舍，先给预览卡 | 是（写操作走 approval） | `jxl.movement_approve`（CONFIRM 档，见 04 R7/§5） | 4 | **补充**；对应 Demo 2 的 APPROVE 原语 |
| 3 | `ACTIVE_MOVEMENTS` | 谁还在外面没回来 | 是 | `jxl.campus_status`(topic=movement) 或 `jxl.movement_status` | 3 | **补充** jxl |
| 4 | `DRAFT_PARENT_MESSAGE` | 起草给家长的情况说明 | 是（本质是文档生成） | `doc.create`（类型=家长说明）+ 校园数据注入 | 2 | **替换**：复用 38 的 `doc.create`，不单独建工具 |
| 5 | `TODAY_LATE` | 今日迟到事实 | 是 | `jxl.campus_status`(topic=late) | 2 | **补充** jxl |
| 6 | `CLASS_STATUS` | 某班整体情况 | 是 | `jxl.campus_status`(scope=class) | 2 | **补充** jxl |
| 7 | `EVENT_OVERVIEW` | 医务事件概览 | 是 | `jxl.clinic_status` | 2 | **替换/合并**进 38 的 `jxl.clinic_status` |
| 8 | `AGGREGATE_OVERVIEW` | 班级/宿舍/全校态势 | 是 | `jxl.campus_status`(level=CLASS/DORM/SCHOOL) | 3 | **补充** jxl |
| 9 | `MOCHI_RELAY_ASK` | 替我问同事的 Mochi | 是（但依赖 A2A） | `mochi.ask`（P1，见 §5 单机模拟） | 4 | **补充**；MDP-v1 ASK 原语，P1 降级 |
| 10 | `LATE_RANKING` | 迟到排行 | 是 | `jxl.campus_status`(ranking) 或新 `jxl.late_ranking` | 3 | **补充** jxl |
| 11 | `STUDENT_STATUS` | 某同学近况卡片 | 是 | `jxl.student_query` | 2 | **替换/合并**进 38 的 `jxl.student_query` |
| 12 | `DRAFT_CLASS_REPORT` | 起草班级日报 | 是（文档生成） | `doc.create`（类型=班级日报） | 2 | **替换**：复用 `doc.create` |
| 13 | `MOCHI_RESOURCE_FIND` | 派寻物任务给同事 Mochi | 是（依赖 A2A） | `mochi.find`（P1） | 4 | **补充**；MDP FIND 原语，P1 |
| 14 | `MOCHI_RESOURCE_REGISTER` | 登记共享资源 | 是 | `mochi.register`（P1） | 3 | **补充**；P1 |
| 15 | `NAVIGATE` | 旧页面导航 | 否（桌面无旧路由） | —（DROP） | 0 | **废弃**：Mochi 自有 UI，无页面跳转语义 |

### 4.2 融入 38 工具体系（R1）的结论
- 38 P0 工具（`01` §1.2）= ppt(7)/doc(4)/spreadsheet(5)/pdf(4)/file(6)/calendar-task(5)/comm(2)/jxl(5)。这是**桌面办公工具链**。
- 旧 15 个校园工具**不属于这 38**，它是「Organization Plugin（嘉行联）」的校园能力。融入方式：
  - **合并进 `jxl.*`（5 个 P0）**：`student_query`/`clinic_status`/`dorm_status`/`campus_status`/`message`。上表 #2–3,5–8,10–11 大多坍缩进 `jxl.campus_status` 的 `topic`/`level`/`scope` 参数与 `jxl.student_query`/`jxl.clinic_status`。即 15 个旧工具 → **≤5 个 `jxl.*` P0 工具**（更干净，且契合 01 已定的 `jxl.*` 契约）。
  - **复用 doc.create**：#4/#12 家长说明/班级日报 = `doc.create` 的内容类型，不新建工具。
  - **P1 降级（R2 单机模拟）**：#9/#13/#14 `mochi.*` = MDP-v1 的 ASK/FIND/REGISTER 原语；第一版按 04 R2「单机模拟」实现（第二个本地 profile 扮演对方 Mochi），不建协调服务器。
  - **废弃**：#15 `NAVIGATE`。
- 改名影响：旧名是「全大写下划线」（如 `STUDENT_STATUS`），新名是 `jxl.student_query` 点分。改名只影响 dispatch 字符串与 `allowedAssistantTools(role)` 的权限表（旧按角色过滤），新架构权限由 dsh `permission-presets` + `mochi-approval` answerer 接管（04 R4/R6），**旧角色白名单逻辑不沿用**。

### 4.3 dsh schema 严格性（04 已强调，此处落地）
- `defineTool` 的 `parameters`/`output.schema` 中**每个嵌套 `object` 必须显式写 `additionalProperties: true|false`**，否则加载失败（`core/tools/src/schema.ts:367` 硬校验）。
- 旧工具是「自定义 planner 调用格式」（`call.tool` + `call.args` 自由对象），**没有 JSON Schema**。重写时必须显式声明：
  - `jxl.student_query`：`{ keyword:string, status?:string, onlyOverdue?:boolean }` + `output.schema` 显式列属性 + `additionalProperties:false`。
  - 任何「列表项」数组元素若是 object，也要 `additionalProperties:false`。
- `render()` 统一 `(_a,v)=>[{type:'text',text:JSON.stringify(v)}]`（01 §8 约定），不写话术。
- `execute` 返回值类型必须匹配 `output.schema`（dsh 执行后校验）。

### 4.4 底层 DB 查询库（`assistant-tools.ts`）改造
- `loadStudentLateStats` 等函数签名 `db: D1Database` → `db: Database(better-sqlite3)`。
- `await db.prepare(sql).bind(...).all<Row>()` → `db.prepare(sql).all(...args) as Row[]`（去掉 `await`/`bind`/`{results}`）。
- `await db.prepare(sql).bind(...).first<T>()` → `db.prepare(sql).get(...args) as T | undefined`。
- 这些查询是**纯 SQL 逻辑**（迟到子查询/范围谓词/权限 scope），保留算法，只换调用形态。工作量 ~8 人时（§1.4）。

---

## 5. Mochi Relay 的迁移规格（必须保留的资产）

### 5.1 现状（已读 `0024`/`0025` + `assistant.ts` dispatch）
- **表**：`mochi_relay_messages`(0024：from/to/body/status∈pending|accepted|declined/reply + 0025 加 kind∈message|request/item) + `mochi_resources`(owner/title/note)。状态机 pending→accepted/declined，由收件方主人决定。
- **API**：`relayList`(只读)、`naturalRelayAsk`/`naturalRelayStatus`、`MOCHI_RESOURCE_FIND`/`REGISTER`、respond 端点（`assistant.ts:1400` 接受/拒绝 + 写 reply）。
- **前端卡片**：`TaskCard`/relay 卡（旧 `AssistantPage` 渲染）。
- **测试**：relay 单测在 `tests/*relay*`（属 374 测试一部分）。

### 5.2 怎么迁（不推翻，向上抽象，落实 02 §2.2 + 04 R2）
| 资产 | 决策 | 新位置 | 说明 |
|---|---|---|---|
| `mochi_relay_messages` / `mochi_resources` 表 | **MOVE** | `migrations/0024` `0025` 复制进 Mochi 基线，better-sqlite3 跑通 | 遗产表不删不改（02 §2.2 硬要求） |
| Relay 读写逻辑（relayList/ask/status/respond） | **ADAPT** | `apps/desktop/src/main/relay.ts`（本地 DB 服务） | 旧 `c.env.DB` 调用改 better-sqlite3；HTTP 端点去掉，改主进程函数供 IPC |
| `MOCHI_RESOURCE_FIND/REGISTER` | **REBUILD** | `mochi.find`/`mochi.register`（P1，单机模拟） | 对方 Mochi 用本地第二个 dsh profile 扮演（R2） |
| 前端传话卡 | **ADAPT** | `apps/desktop/src/renderer/task/RelayCard.tsx` | 用 04 R6 的 6 态模型（PENDING_SEND/RUNNING/INPUT_REQUIRED/APPROVAL_REQUIRED/COMPLETED/TERMINATED）归一化渲染 |
| Relay 测试 | **REBUILD** | `apps/desktop/test/relay.test.ts` | SQL + 状态机单测迁 vitest；HTTP 集成测试 DROP |
| `mochi_tasks`(0027)/`mochi_agents`(0026)/`mochi_artifacts`(0028) | **DROP（v1）** | 留待 P2 | 02 的规范存储；按 R2 v1 用本地 mock 跑通 Demo，不建协调服务器，故 0026–0028 第一版**不建表**，避免 over-build。Demo 成功后作为「下一步」 |

### 5.3 与 MDP-v1 的衔接（向上抽象路径）
1. v1：**遗产 `mochi_relay_messages` 全功能工作**（发/收/接受/拒绝/回话）——这就是「已跑通」资产，桌面化后继续可用。
2. 抽象层：`RelayCard` 把 legacy 行**归一化为** MDP 的 `TaskCard` 形状（02 §2.2 映射表：from/to→`user:<id>`、kind=request→`FIND`、status pending→`DELIVERED` 等），前端只认 `TaskCard`。
3. 演进：`mochi.find`/`mochi.ask` 在单机模拟下，调用时**写同一张 `mochi_relay_messages`**（kind=request）给本地第二个 profile，对方 profile 的 answerer 预填回话、主人确认 → 写 reply。即「新原语跑在旧表上」，零翻新存储即获得 A2A 演示闭环。
4. 真跨设备/协调服务器/Artifact Grant（0028/§4）= 答辩「下一步」，不在 26 天窗口。

### 5.4 审批桥（§0 冲突的落点，必修）
- `MOVEMENT_PREVIEW`(#2) 与 `mochi.*` 的 CONFIRM 动作，需 human approval。
- 实现：`plugins/mochi-approval` 注册 `ctx.waterfall('approval/request', (req,next)=>{ AUTO→allowed-once; DENY→rejected; CONFIRM→next() })`（04 P0-5，必须 `waterfall` 非 `ctx.on`）。
- CONFIRM 时：answerer 把 `req`（tool 名+reason）写入主进程的一个**本地审批队列**（SQLite/JSON），主进程经 IPC 推 `{actionLabel,target,rationale,reversible,side_effects}` 到 renderer 渲染确认卡（04 §7.2 `approval_preview` 铁律：必须展示"准备做什么"，不能只弹"是否确认"）。
- 用户点确认 → renderer 经 IPC 回主进程 → answerer `next()` resolve `allowed-once` → 工具继续。
- **为什么必须自建**：07 已证实 SDK 通道不下发审批请求，官方 `ui-approval` 只在 `dsh --profile web` 可用（而 web 路线会丢掉 Orb）。故自写 answerer+IPC 桥是唯一同时满足「红线1 + 审批可用」的路。

---

## 6. UI 迁移规格（依据 `05`）

| 项 | 决策 | 具体动作 |
|---|---|---|
| ExpressiveOrb 完整迁移 | **MOVE** | `ExpressiveOrb.tsx`+`.css` 整文件拷入 `apps/desktop/src/orb/`；依赖闭包仅 react+css（05 §1.2 已核实），import 即用，不改渲染逻辑。dsh 事件→mood 映射按 08 §4.3 表（thinking/speaking/success/alert/idle）在主进程事件桥转 `{mood,text}` 经 IPC 推 renderer，`setMood()` 即可 |
| 设计令牌 | **MOVE** | `calm-tokens.css` + `cozy-*` + `reference-ui.css` 拷 `assets/`；`--sage-800`/`--accent` 原样保留（用户确认） |
| PWA 三件套剥离 | **DROP** | `public/manifest.webmanifest`/`sw.js`/`src/lib/pwa.ts`/`install-prompt.ts`/`OfflineBanner.tsx` 全部不迁；`Layout.tsx`/`main.tsx` 中 `registerServiceWorker`/`syncAppBadge`/`OfflineBanner`/`install-prompt` 调用点移除 |
| `BrowserRouter`→桌面化 | **ADAPT** | `main.tsx` 改 `MemoryRouter`（Electron 无 `file://` 路径问题，05 §7.1）；`useSearchParams`/`window.location` 调用统一处理 |
| `localStorage` 桌面化 | **ADAPT** | theme 等偏好改主进程持久化（写 `DSH_HOME/settings.yaml` 或本地 JSON）；renderer 经 IPC 读写。工作量低 |
| Web Push/VAPID→原生 | **REBUILD** | `Notification` API（renderer 可用）用于展示；订阅/推送逻辑整体废弃，发送统一走主进程 `new Notification`。`NotificationSettingsPage` 的 Web Push 流程改为「桌面通知开关」 |
| 横向滚动红线 | **MOVE + 复核** | `styles.css` 迁后逐处复核 `overflow-x:auto`/`100vw`（05 §2.2②），移除页面级 `100vw` 计算宽度，确保无整页横滚 |
| 圆角矩形红线 | **MOVE + 复核** | 令牌层已满足；逐页确认文字容器落圆角（05 §2.2③） |
| 组件库复用 | **MOVE** | `UI`/`LiquidGlass*`/`Pill`/`NavIcons` 等作 Mochi renderer 原子组件，新聊天/任务/设置页基于它们搭建 |

---

## 7. 迁移执行顺序（阶梯计划，先看到球，再叠功能）

> 原则（用户原话 + 08）：**先让「能跑起来看到球」，再逐步加功能。不要一上来就迁数据库。**
> 但数据库是后续所有功能的前提，故 Batch 1 紧接 Batch 0。每批给验收标准 + 回退方案。

### Batch 0 · 骨架与球（第 1–3 天）
- 迁：`Electron 39` + `Vite` + `React 19` 工程；拷贝 `ExpressiveOrb.tsx/.css` + `calm-tokens.css`；renderer 挂载球（idle）。
- 验收：双击/命令启动窗口，球以焦糖色静态渲染（idle），无报错。
- 回退：`git tag batch0`；失败则 `git checkout` 回到空壳，不影响旧项目。

### Batch 1 · 数据层（第 3–6 天）
- 迁：`better-sqlite3` + migrator（§3.2）；复制 `migrations/0001–0025`；`crypto.ts` MOVE；`shared/types`/`constants`/`time` MOVE。
- 验收：主进程启动建 `DSH_HOME/storages/mochi.db`，migrator 跑完 25 个文件，FK 开启；单测能 `SELECT` 出基线表。
- 回退：删 `mochi.db` 重跑；migrator 幂等（记 `_migrations`）。

### Batch 2 · dsh 集成 + 球动起来 + 审批桥（第 6–11 天）⚠️ 含 §0 冲突闭合
- 迁：主进程 spawn `dsh --profile mochi`（随包 Node 22.20 + `dshBin` launcher，08 §2.4）；`DeepSeekHarness` 驱动；`DemoHarnessClient` 演示模式；`DSH_TELEMETRY_DISABLED=1`；**`mochi-approval` answerer + IPC 确认卡桥**（§5.4）。
- 验收：真实/演示模式 `run("你好")` 返回事件流，球 `thinking→speaking→success`；断网切演示模式零翻车；CONFIRM 工具弹出确认卡且用户可放行/拒绝。
- 回退：注释掉 dsh wiring，球回到 idle 静态；演示模式独立可跑，不阻塞前序批次。
- **卡点**：审批桥未通前，任何 CONFIRM 工具（message.send / movement_approve）会 fail-closed（04 P0-5），必须本批闭合。

### Batch 3 · 嘉行联只读能力（jxl 5 工具，演示数据）（第 11–16 天）
- 迁：`assistant-tools.ts` 查询库 ADAPT 为 better-sqlite3；`mochi-jiaxinglian` 插件注册 ≤5 个 `jxl.*`（demo 数据层，01 §2.4）。
- 验收：「现在医务室有谁」「查某同学近况」返回结构化事实（demo fixtures）；`render` 只返 JSON。
- 回退：插件不挂载则 jxl.* 工具不存在，Mochi 仍能聊天/写文档（01 §1.5 边界）。

### Batch 4 · 办公工具链 P0（第 16–24 天）
- 迁：`mochi-core`(Artifact store/approval 封装/workspace) + `mochi-ppt`/`doc`/`spreadsheet`/`pdf`/`file`/`calendar-task`/`comm`(draft/send)。质量循环 skill（01 §4）。
- 验收：「生成月考分析 PPT → 自检 → 改 → 导出」跑通；`message.send` 走 CONFIRM 卡。
- 回退：单个插件故障不影响其他；`guard`(repeat-tool-reminder/timeout-policy) 兜底失控循环。

### Batch 5 · Relay + 任务卡（第 24–28 天，视余量）
- 迁：`mochi_relay_messages`/`mochi_resources` 本地服务（§5）；`RelayCard` 6 态 UI；`mochi.find`/`mochi.ask` 单机模拟（本地双 profile）。
- 验收：两个本地 profile 间发传话/寻物，卡正常流转（pending→accepted/declined/reply）。
- 回退：Relay 服务独立模块，失败不影响办公工具链。

### Batch 6 · 打磨 / License / 演示脚本（收尾，第 28–32 天弹性）
- 迁：4–5 个 Teacher Skill（04 P1-6）、License 审计（`jszip` MIT 选项 / `mammoth` 复核）、演示 runbook（脚本化 demo + 未签名放行预案 08 §5.5）、`TO_BE_RESOLVED_BY_CODEX` 清零。
- 验收：5 个 Golden Demo 在演示机跑通；离线演示模式一键切。
- 回退：演示脚本独立，不影响产品代码。

> 总窗口 ~26 天（Batch 0–4 为硬核，Batch 5–6 弹性）。**建议演示前冻结 dsh 版本**（04 P0-7 / 07 Q9）。

---

## 8. 风险登记册

| # | 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|---|
| R1 | dsh Developer Preview 破坏性变更（07 Q9，rc.1 多条 breaking change） | 高（工具/approval 契约变 → 重写 | 中 | 锁 `0.1.2-cc.1` 或本地 `0.1.3-alpha.1` 某 commit；`pnpm-lock` 哈希钉死；禁 `@latest`；订阅 release |
| R2 | **SDK 通道无审批 UI**（07 Q1/Q5）→ 自写 answerer+IPC 桥工作量被低估 | 高（CONFIRM 工具失效） | 高 | §5.4 审批桥列为独立可交付；Batch 2 闭合；演示用 `demo-auto-approver`(04 R4) 跑 CONFIRM demo |
| R3 | D1→better-sqlite3 API 形态大改（`.results`/`.first()`/`batch`）引入回归 | 中 | 高 | 抽 `db.ts` 统一封装；SQL 文本不改；vitest 迁旧查询单测 |
| R4 | 未签名分发现场摩擦（Mac Gatekeeper / Win SmartScreen，08 §5） | 中（演示多一步） | 高 | 演示机预 `xattr -cr`/点过 SmartScreen；30s 口播转限制为亮点 |
| R5 | 嘉行联后端依赖（A2A 演示需其数据/服务） | 中 | 中 | R2 单机模拟，不依赖真后端；demo 数据层（Batch 3） |
| R6 | 免费档限流（glm-4-flash 429，08 §7.2） | 中 | 中 | 双模型兜底（4-flash→4.7-flash）；默认演示模式 |
| R7 | 遥测未关干净（DSH_TELEMETRY_DISABLED，08 §6.4） | 低（隐私/出网） | 低 | 打包保证 `mode: DISABLED`；Wireshark 抓包验证无外联 |
| R8 | 横向滚动/塑料感红线回归（05 §2.2） | 低 | 中 | 迁后逐页复核；CSS 令牌原样 |
| R9 | 14 工具定位错（用户以为在 assistant-tools.ts）导致执行者找错 | 中 | 中 | 本文 §4.1 已勘误：真定义在 `assistant.ts` dispatch 链 |
| R10 | 374 测试大部分是 HTTP/e2e，盲目全迁浪费 | 中 | 中 | 只迁可离线 SQL/查询/Relay 单测（§1.5） |
| R11 | 工作量大（高中生+上学）低估 | 高 | 中 | 严格按 38 P0 + 砍刀清单（04）；Batch 5–6 弹性；P1/P2 明确降级 |
| R12 | `node:sqlite` 实验性误用 | 低 | 低 | 坚持 better-sqlite3（§3.1） |
| R13 | 审批只给 allow-once、程序侧无参数（07 Q5）→ 「按参数越权」做不了 | 中 | 中 | answerer 按工具名分类（AUTO/CONFIRM/DENY）；越权只按名 |

---

## 9. 待用户/Codex 闭合项（`TO_BE_RESOLVED_BY_CODEX` 汇总，不编造）

1. **审批桥具体 IPC 协议**：answerer→主进程→renderer 确认卡的字段形状与超时处理（§5.4）。需开工时按 dsh `ctx.waterfall` 实测确定。
2. **dsh 锁定版本号**：npm `0.1.2-rc.1` vs 本地 `0.1.3-alpha.1` 择一（07 Q0）；写进打包脚本。
3. **`mammoth` License 复核**：`doc.read` Word 解析（01 §3.1）；不通过则降明文读取。
4. **像素级 Artifact 预览**：目标机是否预装 `soffice`；P0 先用结构化概览（01 §5.5）。
5. **跨插件 import 机制**：`mochi-core` 被其他插件引用（01 §2.3）；按 dsh Cordis 插件依赖注入实测。
6. **`ctx.workspace` 是否已有**：workspace 路径解析（01 §2.3）；二选一不影响契约。
7. **演示数据集最后清单**：学生/班级/医务室/课表/资源/clinic 具体 fixtures 内容（04 P1-8）。

---

*本文为「先列清单再迁移」指令的最终交付物，覆盖前端/后端/数据/AI/测试/配置六大模块，决策均基于实际读过的旧项目源码与迁移文件，凡无法当场核实者已标 `TO_BE_RESOLVED_BY_CODEX`，未编造任何类名/路径/API。旧项目目录零改动。*
