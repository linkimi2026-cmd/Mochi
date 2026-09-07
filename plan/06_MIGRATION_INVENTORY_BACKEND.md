# 06 · 后端与数据资产盘点（嘉行联 → Mochi 桌面端）

> 盘点官：后端与数据资产盘点官（接手）
> 源项目（只读，零改动）：`/Users/a1379/Documents/联动计划/`
> 目标：桌面应用 Mochi（Mochi Harness / dsh，Electron，Node ≥ 22.19）
> 本文件**只做盘点，不写迁移代码**。所有"如何迁"留给后续方案文档。

---

## 0. 红线与口径

| 项 | 说明 |
|---|---|
| 只读约束 | `/Users/a1379/Documents/联动计划/` 全程只读，未做任何修改（含 `find -mmin -60` 自证零改动）。 |
| 三硬指令 | ① UI 不重做（`ExpressiveOrb` 原样用）；② 做的是桌面 App 不是网站；③ 先列清单再迁移。 |
| 数据库栈 | 源 = Cloudflare **D1**（SQLite 变体）；目标桌面端拟用 **better-sqlite3** 或 Node 22 内置 **node:sqlite**。 |
| 关键偏差 | 提示词称 AI 工具"14 个"，但 `shared/assistant.ts` 的 `ASSISTANT_TOOL_NAMES` 实际为 **17 个**（见 §3.1）。以代码为准，标注偏差。 |

---

## 1. 数据库 Schema

### 1.1 迁移文件清单（按编号，共 25 个）

| 编号 | 文件 | 一句话说明 |
|---|---|---|
| 0001 | 0001_schema.sql | 核心基表：users/classes/teacher_class_roles/students/card_identifiers/health_events/acknowledgements/in_app_notifications/push_*/audit_logs/sessions/login_attempts/system_settings |
| 0002 | 0002_demo_seed.sql | 演示种子：4 班 24 生、5 个基础账号、卡片、健康事件、系统设置、审计 |
| 0003 | 0003_messaging_push_jobs.sql | 消息中心 + 推送队列：messages/message_recipients/notification_jobs/notification_attempts/message_events；push_subscriptions 扩 6 列 |
| 0004 | 0004_account_activation.sql | 账号激活：account_invitations + 5 账号独立密码；INSERT/UPDATE 演示账号 |
| 0005 | 0005_tester_account.sql | 演示测试员账号 tester |
| 0006 | 0006_fix_tester_password.sql | 修正 tester 密码摘要 |
| 0007 | 0007_cloudflare_password_hashes.sql | 全部虚拟账号密码摘要迁移到"Cloudflare 兼容参数"（PBKDF2） |
| 0008 | 0008_repair_role_password_hashes.sql | 按当前账号盐修正 5 个角色密码摘要 |
| 0009 | 0009_notification_onboarding.sql | user_notification_onboarding 表 + 初始化 |
| 0010 | 0010_message_cleanup.sql | 消息软删除（deleted_at）+ user_preferences 表 |
| 0011 | 0011_demo_seed_messages.sql | 为新消息表补演示种子（幂等） |
| 0012 | 0012_student_movements.sql | 学生跨区域流转：movement_station_assignments/student_movements/movement_events（含部分唯一索引） |
| 0013 | 0013_demo_movement_seed.sql | 年级负责人绑定宿舍值班站 |
| 0014 | 0014_cross_domain_notifications.sql | messages 扩 context_type/context_reference/navigate_path/context_severity；dorm_incidents 表 |
| 0015 | 0015_dorm_incident_concurrency.sql | dorm_incidents 扩 version/last_action_key（乐观并发） |
| 0016 | 0016_demo_dorm_structure.sql | dorms/student_dorm_assignments 表 + 演示宿舍关系 |
| 0017 | 0017_distinct_dorm_staff_role.sql | user_role_profiles 表 + 独立宿管账号 sushe（解耦年级负责人兼任） |
| 0018 | 0018_dorm_message_context_unique.sql | 阈值改名 + messages(DORM_INCIDENT) 唯一索引去重 |
| 0019 | 0019_ai_usage_daily.sql | ai_usage_daily 表（AI 配额计数器） |
| 0020 | 0020_remove_grade_admin_medical_notifications.sql | 安全边界：年级负责人只收 GRADE_ALERT |
| 0021 | 0021_assistant_previews.sql | assistant_previews 表（流转动作待确认态） |
| 0022 | 0022_movement_message_context_unique.sql | messages(MOVEMENT) 唯一索引去重 |
| 0023 | 0023_assistant_sessions.sql | assistant_sessions 表（多轮会话记忆，仅存规划摘要） |
| 0024 | 0024_mochi_relay.sql | **Mochi Relay 前身**：mochi_relay_messages 表（六端互传话） |
| 0025 | 0025_mochi_network_tasks.sql | **Mochi 网络二期**：mochi_relay_messages 扩 kind/item + mochi_resources 表（任务委托/寻物） |

### 1.2 完整表清单（共 **34** 张表）

> 字段数按最终状态统计（含后续迁移 ALTER ADD COLUMN）。

| # | 表名 | 字段数 | 用途 |
|---|---|---|---|
| 1 | users | 11 | 账号、密码摘要/盐、角色、年级范围、激活/身份核验 |
| 2 | classes | 4 | 班级 |
| 3 | teacher_class_roles | 5 | 教师-班级关系（班主任/任课/备份） |
| 4 | students | 10 | 学生档案（学号、姓名、性别、班级、监护人脱敏） |
| 5 | card_identifiers | 6 | 刷卡标识（键盘楔等适配器） |
| 6 | health_events | 17 | 医务事件（类别/紧急度/处置/状态/时间链） |
| 7 | acknowledgements | 6 | 消息知悉确认记录 |
| 8 | in_app_notifications | 7 | 旧站内通知（仍作回执保留） |
| 9 | push_subscriptions | 17 | Web Push 设备订阅（含 OS/浏览器/状态） |
| 10 | push_logs | 12 | 推送投递日志 |
| 11 | audit_logs | 7 | 审计日志 |
| 12 | sessions | 5 | 服务端会话（token_hash + 过期） |
| 13 | login_attempts | 4 | 登录限流桶（账号/IP 双桶） |
| 14 | system_settings | 4 | 键值系统设置 |
| 15 | messages | 13 | 消息中心主表（含跨域上下文列） |
| 16 | message_recipients | 12 | 消息收件人状态机 + 软删除 |
| 17 | notification_jobs | 12 | 推送调度任务（幂等键/状态机） |
| 18 | notification_attempts | 8 | 单次推送尝试明细 |
| 19 | message_events | 7 | 消息事件流（READ/ACK/OPENED…） |
| 20 | account_invitations | 7 | 一次性激活密钥 |
| 21 | user_notification_onboarding | 4 | 通知开通状态 |
| 22 | user_preferences | 4 | 消息自动清理偏好 |
| 23 | movement_station_assignments | 7 | 流转站点授权（宿舍/医务） |
| 24 | student_movements | 31 | 学生流转主记录（完整状态机 + 并发版本） |
| 25 | movement_events | 11 | 流转事件链 |
| 26 | dorm_incidents | 16 | 宿舍异常（迟到/无申请到达，乐观并发） |
| 27 | dorms | 5 | 宿舍 |
| 28 | student_dorm_assignments | 3 | 学生-宿舍分配 |
| 29 | user_role_profiles | 4 | 附加岗位档案（如 DORM_STAFF） |
| 30 | ai_usage_daily | 5 | 每日 AI 配额（用户/全局双行） |
| 31 | assistant_previews | 9 | 助手流转动作预填（token 摘要） |
| 32 | assistant_sessions | 3 | 助手多轮记忆（仅 context_json） |
| 33 | **mochi_relay_messages** | 10 | **A2A 传话/任务委托（必须保留并向上抽象）** |
| 34 | **mochi_resources** | 5 | **Mochi 共享资源登记（寻物目标库）** |

### 1.3 Mochi Relay 相关表（必须保留，见 §4）

- `mochi_relay_messages`（0024 建，0025 扩 `kind`/`item`）— 六端用户各自 Mochi 互传话/派任务
- `mochi_resources`（0025 建）— 用户"自愿登记"的共享资源，寻物只在此检索

### 1.4 D1 方言兼容性分析（D1 → better-sqlite3 / node:sqlite）

| 语法/特性 | D1 中 | 桌面端（better-sqlite3 / node:sqlite） | 结论 |
|---|---|---|---|
| `PRAGMA foreign_keys = ON` | 写在迁移里 | 必须改为**打开连接时** `db.pragma('foreign_keys=ON')` 一次；不能留在迁移脚本中执行（每连接生效） | **要改**（迁移脚本剥离 PRAGMA） |
| `db.prepare(sql).bind(...).first()/.all()/.run()` | D1 API | better-sqlite3：`db.prepare(sql).get()/.all()/.run()`；node:sqlite 类似 `.get()/.all()/.run()` | **要改**（所有路由集中调用，需写一层 DB 适配） |
| `db.batch([...stmts])` | D1 事务批 | 改为 `db.transaction(() => {...})` 或逐个 `run()` | **要改**（auth/消息批量写用到） |
| `AUTOINCREMENT` | 支持 | SQLite 原生支持 | 直接跑 |
| `datetime('now','-38 minutes')` / `datetime('now')` | 支持 | SQLite 原生支持 | 直接跑 |
| `CURRENT_TIMESTAMP` | 支持 | 支持 | 直接跑 |
| `ON CONFLICT(col) DO UPDATE` / `INSERT OR IGNORE/REPLACE` | 支持 | 支持（SQLite ≥ 3.24/3.35） | 直接跑 |
| `RETURNING` 子句（auth.ts 限流预占） | 支持 | better-sqlite3 v11+ / node:sqlite 支持 | 直接跑（**验证版本**） |
| 部分索引 `CREATE INDEX ... WHERE ...` | 支持 | 支持 | 直接跑 |
| `CHECK(...)` 约束 | 支持 | 支持 | 直接跑 |
| `REFERENCES ... ON DELETE CASCADE/SET NULL` | 支持 | 支持（需 foreign_keys 开） | 直接跑 |

**结论**：Schema SQL 几乎可直接跑；唯一真正的适配成本是 **DB 访问层**（D1 `prepare/bind/first/all/run/batch` → better-sqlite3/node:sqlite 等价 API），这是全项目最大的 Cloudflare 耦合点（见 §2.3）。

### 1.5 种子 / 演示数据

| 数据源 | 位置 | 说明 |
|---|---|---|
| 结构种子 | 0001_schema.sql（表定义）+ 0002/0005/0011/0013/0016/0017 | 班级、账号、学生、卡片、健康事件、宿舍、激活密钥 |
| 演示账号 | banzhuren / `Bzr#2026Demo!`、admin / `Admin#2026Demo!`（另 xiaoyi/renke/nianji/tester/sushe） | 密码为 PBKDF2 摘要，存于 users 表 |
| 生成脚本 | `scripts/reset-local.mjs`（db:reset）、`scripts/setup-local.mjs` | 本地重建 + 生成真实格式 VAPID/SESSION 密钥到 `.dev.vars` |
| 迁移混入数据 | 0002/0004/0007/0008/0011/0013/0016/0017 含 INSERT/UPDATE | **建议拆分**：将"数据种子"从"结构迁移"分离，桌面端用独立 seed 脚本，避免把演示密码写进迁移历史 |

---

## 2. Worker 后端

### 2.1 路由清单

入口 `worker/index.ts`：`/api/auth`、`/api/push`（公开+受保护）、`/api/*`（受 `requireAuth` 保护）、`/api/admin`。Cron `scheduled()` 每 1 分钟触发 4 个清理/调度任务。

| 路由文件 | 方法 + 路径 | 用途 | 权限 |
|---|---|---|---|
| auth.ts | POST /api/auth/login | 登录（cookie/bearer） | 公开 |
| auth.ts | POST /api/auth/judge-login | 评审扫码进入（仅 demo） | 公开 |
| auth.ts | GET /api/auth/me | 当前用户 | 登录 |
| auth.ts | POST /api/auth/logout | 登出（删会话） | 登录 |
| auth.ts | POST /api/auth/activate | 一次性激活密钥设密 | 公开 |
| auth.ts | POST /api/auth/change-password | 改密 + 撤销会话 | 登录 |
| messages.ts | GET /api/events/:id/messages | 事件消息线程 | 登录+事件权限 |
| messages.ts | POST /api/events/:id/messages | 发受限消息 | 登录+事件权限 |
| messages.ts | POST /api/messages/grade-alert | 班主任→年级紧急预警 | HEAD_TEACHER |
| messages.ts | GET /api/messages | 消息列表 | 登录 |
| messages.ts | GET /api/messages/unread-count | 角标计数 | 登录 |
| messages.ts | GET /api/messages/focus | 确定性置顶评分 | 登录 |
| messages.ts | POST /api/messages/smart-digest | 智能摘要（调模型） | 登录 |
| messages.ts | GET /api/messages/:reference | 单条消息详情 | 登录 |
| messages.ts | POST /api/messages/mark-read | 标记已读（批量/全量） | 登录 |
| messages.ts | POST /api/messages/:reference/acknowledge | 知悉确认（幂等） | 登录 |
| messages.ts | PATCH /api/messages/:reference | 2 分钟内编辑 | 登录+所有权 |
| messages.ts | POST /api/messages/:reference/withdraw | 5 分钟内撤回 | 登录+所有权 |
| messages.ts | GET/PATCH /api/preferences | 自动清理偏好 | 登录 |
| push.ts | GET /api/push/public-key | VAPID 公钥 | 公开 |
| push.ts | GET /api/push/devices | 我的设备 | 登录 |
| push.ts | POST /api/push/subscriptions | 绑定设备（防跨用户改绑） | 登录(教师角色) |
| push.ts | POST /api/push/subscriptions/change | 浏览器订阅变更 | 登录 |
| push.ts | POST /api/push/test | 真实推送测试 | 登录 |
| push.ts | POST /api/push/devices/:id/verify | 设备确认 | 登录 |
| push.ts | POST /api/push/onboarding/skip | 跳过开通 | 登录(非 ADMIN) |
| push.ts | PATCH /api/push/devices/:id | 改名 | 登录 |
| push.ts | DELETE /api/push/devices/:id | 注销设备 | 登录 |
| push.ts | POST /api/push/events | 推送事件回写 | 登录 |
| push.ts | GET /api/push/diagnostics | 推送诊断 | 登录 |
| core/dashboard.ts | GET /api/dashboard | 待办首页聚合 | 登录 |
| core/dashboard.ts | POST /api/dashboard/greeting-ai | 首页问候文案（调模型） | 登录 |
| core/students.ts | GET /api/students | 学生列表 | 登录 |
| core/students.ts | GET /api/students/card/:identifier | 刷卡查学生 | 登录 |
| core/students.ts | GET /api/students/:id/recipients | 事件允许收件人 | 登录 |
| core/students.ts | GET /api/students/:id | 学生详情 | 登录 |
| core/events.ts | GET/POST /api/events | 事件列表/登记 | 登录 |
| core/events.ts | GET /api/events/:id | 事件详情 | 登录+权限 |
| core/events.ts | PATCH /api/events/:id/status | 改状态 | 登录+NURSE/班主任 |
| core/events.ts | POST /api/events/:id/acknowledge | 事件确认 | 登录 |
| core/movements.ts | GET /api/movements | 流转列表 | 登录 |
| core/movements.ts | GET /api/movements/capabilities | 流转能力 | 登录 |
| core/movements.ts | POST /api/movements | 新建流转 | 登录+教师 |
| core/movements.ts | GET /api/movements/:reference | 流转详情 | 登录 |
| core/movements.ts | POST .../arrive\|leave\|confirm-return\|cancel | 流转状态机推进 | 登录+站点授权 |
| core/movements.ts | POST .../link-medical-event | 关联医务事件 | 登录 |
| core/movements.ts | POST .../demo/force-overdue | 演示强制超时 | 登录 |
| core/dorm.ts | GET/POST /api/dorm/incidents | 宿舍异常列表/登记 | 登录 |
| core/dorm.ts | POST /api/dorm/incidents/:reference/resolve | 解决异常 | 登录 |
| core/analytics.ts | GET /api/analytics/movements | 流转事实统计 | 登录 |
| core/analytics.ts | POST /api/analytics/ai | 统计文案（调模型） | 登录 |
| core/assistant.ts | POST /api/assistant | 自然语言助手主入口（planner→tool→composer） | 登录 |
| core/assistant.ts | POST /api/assistant/transcribe | 语音转写 | 登录 |
| core/assistant.ts | POST /api/assistant/relay | **Mochi 传话列表** | 登录 |
| core/assistant.ts | POST /api/assistant/relay/respond | **Mochi 传话回应（accept/decline）** | 登录 |
| admin/* | 多路由 | 账号/组织/日志/系统/安全/数据导出导入 | ADMIN |

### 2.2 lib 模块清单（含 Cloudflare 依赖标注）

| 模块 | 行数 | 用途 | 强依赖 CF API？ |
|---|---|---|---|
| lib/auth.ts | 349 | 登录/会话/限流/权限中间件 | `c.env.DB`（D1）、`CF-Connecting-IP`、`c.env.SESSION_SECRET` |
| lib/crypto.ts | 48 | PBKDF2/SHA-256/随机令牌 | **Web Crypto**（`crypto.subtle`/`getRandomValues`/`btoa`）— Node 全局可用，**可直接跑** |
| lib/ai-provider.ts | 672 | planner/composer/digest 调模型 + provider 切换 | `env.AI`（Workers AI，CF 专用）、`fetch`（zhipu，可移植） |
| lib/assistant-tools.ts | 304 | 17 工具的纯数据加载函数（SQL 拼装） | `D1Database` 类型与 `db.prepare` 调用 |
| lib/assistant-composer.ts | 545 | 输出合成 + 四道安全闸（含数字一致性） | 调用 ai-provider；纯逻辑为主 |
| lib/assistant-preview.ts | 105 | 流转动作预填读写 | D1 |
| lib/assistant-session.ts | 115 | 多轮会话记忆读写 | D1 |
| lib/ai-usage.ts | 49 | 每日配额预留（reserveAiUsage） | D1 |
| lib/audit.ts | 9 | 审计写入封装 | D1 |
| lib/http.ts | 41 | JSON body / 分页解析 | 无 |
| lib/permissions.ts | 41 | 事件访问权限判定 | D1 |
| lib/push.ts | 61 | VAPID/Web Push 投递 | `@block65/webcrypto-web-push`、`fetch` |
| lib/messaging/* | — | create/auto-delete/overdue/policy/push-jobs/index | D1、`c.executionCtx.waitUntil`、`fetch`（推送） |

### 2.3 Cloudflare 耦合度专项分析（三分类）

#### A. 能直接跑（几乎零改）
| 项 | 理由 |
|---|---|
| `crypto.ts`（PBKDF2/SHA-256/令牌） | 用 Web Crypto 全局 `crypto.subtle`/`getRandomValues`，Node ≥ 20 原生提供；`btoa/atob` 也是 Node 全局。无需改动。 |
| 大部分业务 SQL 文本 | `datetime('now')`/`CURRENT_TIMESTAMP`/`CHECK`/`ON CONFLICT`/`RETURNING` 均为标准 SQLite，better-sqlite3/node:sqlite 直接支持。 |
| 纯逻辑模块 | `assistant-composer.ts`、`assistant-privacy.ts`、`shared/assistant*.ts` 的脱敏/解析/权限映射为纯 TS，无 CF 依赖。 |
| `ai-provider.ts` 的 zhipu 分支 | 走 `fetch` 直连智谱 HTTP API，与 CF 无关，可直接搬。 |

#### B. 要改（集中适配，成本可控）
| 项 | 改动 |
|---|---|
| **D1 数据访问层** | 全项目 `c.env.DB.prepare().bind().first()/.all()/.run()` 与 `db.batch()` → 封装一层 `DB` 适配（better-sqlite3/node:sqlite 的 `prepare/get/all/run` + `transaction`）。**这是最大、最集中的改动点**，但落在单一适配层。 |
| `env` 绑定取参 | `c.env.SESSION_SECRET`/`APP_ENV`/`AI_PROVIDER` 等 → 改为 Node 环境变量 / dsh 配置注入。 |
| 请求 IP 来源 | `clientIp()` 读 `CF-Connecting-IP` → 桌面端从 Electron/net 请求取真实地址（限流桶用，可不精确）。 |
| `scheduled()` Cron | `wrangler.jsonc` 的 `* * * * *` → Electron 主进程 `setInterval` 或 dsh 定时器执行同样的 4 个清理任务。 |
| `c.executionCtx.waitUntil` | 消息推送/调度改为直接 `await` 或丢进后台任务队列。 |
| PRAGMA | 迁移脚本里的 `PRAGMA foreign_keys=ON` 剥离，改为打开连接时设置一次。 |
| Web Push（VAPID） | `@block65/webcrypto-web-push` 依赖 Web Crypto 仍可用，但**桌面端推送应改为 OS 原生通知**，此模块大概率整体下线/替换。 |

#### C. 要重写（CF 专有，必须替换）
| 项 | 替换方案 |
|---|---|
| **`env.AI`（Workers AI 绑定）** | CF 专有，无 Node 等价物。默认 `AI_PROVIDER=workers-ai` 路径**必须重写**为 dsh/DeepSeek/OpenAI 兼容 HTTP 调用（可复用 zhipu 分支的 `fetch` 骨架）。这是 AI 层迁移的关键阻塞点。 |
| wrangler 部署体系 | `wrangler.jsonc`/`@cloudflare/*` devDeps/`pages-entry/` 全部不适用，由 Electron 打包 + dsh 运行时替代。 |
| `@cloudflare/vitest-pool-workers` 测试池 | 后端测试改为 Node + better-sqlite3 harness（见 §6）。 |

### 2.4 认证与会话机制

| 维度 | 实现 |
|---|---|
| 密码哈希 | **PBKDF2-SHA256，100,000 迭代，256-bit**，Web Crypto 实现（`crypto.ts`）。可移植到 Node。 |
| 盐 | 每账号 `newPasswordSalt()`（16 字节 base64url 随机）。 |
| 会话 | 服务端 `sessions` 表；token 以 `sha256(token|SESSION_SECRET)` 存 `token_hash`；cookie（httpOnly/secure/Lax）或 bearer。TTL 1–24h（`SESSION_TTL_HOURS`）。 |
| 鉴权中间件 | `requireAuth` **每次请求直查 D1**（`sessions JOIN users`，校验 `expires_at` 与 `active`），无正向缓存——注销/改密/激活即时生效。 |
| 防时序侧信道 | 用户不存在时也跑一次完整 PBKDF2（虚拟凭据）；登录限流用账号桶 + 精确 IP 喷洒桶双 `INSERT ... RETURNING` 原子预占（依赖 `RETURNING`）。 |
| 角色边界 | `role` 受 CHECK 约束；扩展岗位用 `user_role_profiles.effective_role`（如 DORM_STAFF），鉴权统一读 `COALESCE(effective_role, role)`。 |
| 演示密钥 | `SESSION_SECRET` 缺失且 `APP_ENV!=='demo'` 时拒绝登录/激活；demo 用固定 `local-demo`。 |

---

## 3. AI 层（Mochi 核心参考）

### 3.1 工具清单（实际 **17** 个，非提示词所说 14 个）

> `shared/assistant.ts:29` `ASSISTANT_TOOL_NAMES` 数组：**17 项**。提示词"14"与代码不符，以代码为准。**TO_BE_VERIFIED**：是否曾删减过？当前 HEAD 确认为 17。

| # | 工具名 | 中文标签 | 输入参数 | 返回结构 / 行为 |
|---|---|---|---|---|
| 1 | STUDENT_LATE_STATS | 学生迟到统计 | studentName, range(TODAY/7D/30D/ALL), selectedStudentId | `lateStats`：各迟到类型计数 + scopeNote |
| 2 | LATE_RANKING | 迟到趋势排行 | range, top(≤10) | `lateRanking`：学生/班级排行 items |
| 3 | ACTIVE_MOVEMENTS | 在途流转查询 | className?, status? | `activeMovements`：未闭环流转列表 |
| 4 | STUDENT_STATUS | 学生最近情况 | studentName, selectedStudentId | `studentCard`：流转+医务事件卡 |
| 5 | CLASS_STATUS | 班级整体情况 | className(必填), selectedClassId | `classStatus` |
| 6 | TODAY_LATE | 今日迟到事实 | 无 | 今日迟到事实聚合 |
| 7 | AGGREGATE_OVERVIEW | 整体情况 | scope(CLASS/DORM/SCHOOL/MEDICAL) | `facts` 聚合指标 |
| 8 | EVENT_OVERVIEW | 医务事件概览 | 无（限 NURSE/班主任） | 医务事件事实 |
| 9 | MOVEMENT_PREVIEW | 流转动作预览 | studentName, destination(必填) | `movementDraft`（写 assistant_previews，待确认） |
| 10 | NAVIGATE | 打开页面 | target(页面 key) | `navigate`：path/label（无数据访问） |
| 11 | ATTENTION_ITEMS | 今天要留意的事 | 无 | 确定性置顶评分 |
| 12 | DRAFT_PARENT_MESSAGE | 家长说明草稿 | 由上下文推断 | 生成文本（composer，人工复核，不发送） |
| 13 | DRAFT_CLASS_REPORT | 班级日报草稿 | 由上下文推断 | 生成文本（composer，人工复核，不发送） |
| 14 | MOCHI_RELAY_ASK | Mochi 传话 | peerName, note? | 写 mochi_relay_messages（to 对方主人） |
| 15 | MOCHI_RELAY_STATUS | Mochi 传话进展 | 无 | 待回应/历史传话列表 |
| 16 | MOCHI_RESOURCE_FIND | Mochi 寻物 | item, peerName? | 查 mochi_resources（对方登记） |
| 17 | MOCHI_RESOURCE_REGISTER | Mochi 登记 | item | 写 mochi_resources |

### 3.2 调用流程（核实：`worker/routes/core/assistant.ts`）

```
用户消息
  → 脱敏闸（shared/assistant-privacy.ts：分词→剥离班级/标识符/临床文本→匿名化→出境断言）
  → runAssistantPlanner（第 1 次模型调用：从角色目录选 1–5 个工具 + 参数）
  → executeNaturalPlan → 逐个 executeNaturalTool（服务端校验 assistantToolAllowed + 参数，再查库）
  → runAssistantComposer（第 2 次模型调用：基于已校验结果写句子）
  → 四道安全闸复检 → 返回（含操作 trace，绝不暴露思维链）
```

**四道安全闸（经代码核实）**：
1. **输入脱敏 + 出境断言闸**：`shared/assistant-privacy.ts`——模型只见 `[S1]/[C1]/[ID:1]` 等令牌，绝不见姓名/学号/手机号/临床文本；断言发现残留即阻断。
2. **工具权限闸**：`assistantToolAllowed(role, tool)` + `executeNaturalTool` 内拒绝越权（FORBIDDEN）。
3. **输出数字一致性闸**：`assistant-composer.ts` 的 `modelTextMatchesMetrics`——模型句子中的数字必须与工具返回事实一致。
4. **隐私残留复检闸**：令牌还原（server-side）后再次扫描隐私残留，残留则退回模板。

> **TO_BE_VERIFIED**：四闸的命名/顺序是否与此完全一致（代码用"redaction / permission / metric-match / residue"四层，命名以实现为准）。

### 3.3 `shared/assistant*.ts` 职责（前端硬依赖）

| 文件 | 行数 | 职责 | 是否前端硬依赖 |
|---|---|---|---|
| assistant.ts | 34243 B | 工具名/标签/参数类型、角色目录 `allowedAssistantTools`、意图解析、导航目标、隐私类型 | **是**（核心协议，前端取标签/导航/类型） |
| assistant-privacy.ts | 22146 B | 脱敏-出境断言隐私层（§3.2 闸 1/4） | 是（前端用于本地预校验？需核实调用点） |
| assistant-project-context.ts | 1188 B | 项目上下文注入 | 是 |
| inbox-ai.ts | 6187 B | 收件箱智能摘要的确定性 facts + 模型输出映射 | 是（messages.ts 引用） |
| analytics-ai.ts | 16288 B | 统计页 AI 文案 | 是 |
| analytics.ts / class-triage.ts / dashboard-greeting.ts / event-intelligence.ts / movement.ts / time.ts / validation.ts / constants.ts / types.ts | — | 各域辅助逻辑/常量/类型 | 部分 |

> 提示词提示 `shared/assistant*.ts` 约 1.1k 行前端硬依赖——实际 `assistant.ts` 单文件即 34KB，体量更大；迁移时这些 shared 模块应整体搬入 Mochi 共享层（dsh plugin 的 `shared/` 或 `src/shared/`），前端与后端共用。

### 3.4 `ai-provider.ts` Provider 切换

| Provider | 触发条件（`plannerProvider`/`assistantProviderName`） | 配置字段 | 可移植性 |
|---|---|---|---|
| `workers-ai`（默认） | `AI_PROVIDER` 未设或 =workers-ai，且存在 `env.AI` 绑定 | `env.AI`（CF 专有） | **不可移植，须重写** |
| `zhipu`（智谱直连） | `AI_PROVIDER=zhipu` + `ZHIPU_SCENARIO_AUTHORIZED==='true'` + `ZHIPU_API_KEY` | `ZHIPU_API_KEY`, `ZHIPU_SCENARIO_AUTHORIZED` | **可移植**（HTTP `fetch`） |
| `none` | 上述均不满足 | — | 降级到确定性模板，无需模型 |

- 超时：`AI_PROVIDER_TIMEOUT_MS = 20_000`，`withTimeout`/`withAiTimeout` 包裹。
- 配额：`AI_DAILY_USER_LIMIT=50`、`AI_DAILY_GLOBAL_LIMIT=500`（存 `ai_usage_daily`，`reserveAiUsage` 预留）。
- 切换机制：纯 `env` 判断，无代码分支切换成本；Mochi 端直接以 dsh/DeepSeek/OpenAI 兼容 HTTP 替换 `workers-ai` 分支即可复用 zhipu 的 `fetch` 骨架。

### 3.5 17 个工具迁移到 dsh `defineTool` 评估

> 核心结论：**每个工具的"逻辑"都是薄封装，真正的工作量集中在两处共享改造——(a) D1→sqlite 数据适配层（§2.3-B），(b) `workers-ai`→dsh/HTTP provider 替换（§3.4）。这两处各算一次，改造后 17 个工具几乎均属"小改"。**

| # | 工具 | 评估 | 理由 |
|---|---|---|---|
| 1 | STUDENT_LATE_STATS | 小改 | 调 `loadStudentLateStats`（assistant-tools.ts），仅 D1 访问需适配 |
| 2 | LATE_RANKING | 小改 | 调 `loadLateRanking`，同上 |
| 3 | ACTIVE_MOVEMENTS | 小改 | 调 `loadActiveMovements` |
| 4 | STUDENT_STATUS | 小改 | 调 `loadStudentCard` |
| 5 | CLASS_STATUS | 小改 | `classStatusResult`（路由内），SQL 适配 |
| 6 | TODAY_LATE | 小改 | `todayLateResult`（路由内） |
| 7 | AGGREGATE_OVERVIEW | 小改 | `loadAggregateFacts` |
| 8 | EVENT_OVERVIEW | 小改 | `loadMedicalFacts` |
| 9 | MOVEMENT_PREVIEW | 小改 | 写 `assistant_previews` 表 + 状态机，需适配写路径 |
| 10 | NAVIGATE | 小改 | 无 DB；但页面 key→path 映射需改为桌面端路由表 |
| 11 | ATTENTION_ITEMS | 小改 | `naturalAttention`，纯聚合 |
| 12 | DRAFT_PARENT_MESSAGE | 小改(依赖 composer/provider 层) | 依赖 §3.4 provider 替换 + composer 四闸；逻辑可搬 |
| 13 | DRAFT_CLASS_REPORT | 小改(依赖 composer/provider 层) | 同 12 |
| 14 | MOCHI_RELAY_ASK | 小改 | 写 `mochi_relay_messages` |
| 15 | MOCHI_RELAY_STATUS | 小改 | 读 relay 列表 |
| 16 | MOCHI_RESOURCE_FIND | 小改 | `searchRegistry` 查 `mochi_resources` |
| 17 | MOCHI_RESOURCE_REGISTER | 小改 | 写 `mochi_resources` |

**分布**：直接搬 0 / 小改 17 / 重写 0（重写成本已计入上述共享改造，不重复计到单工具）。
**TO_BE_VERIFIED**：dsh `defineTool` 入参/出参契约是否与现有 `AssistantToolArgs`/`AssistantResult` 完全兼容，需读 dsh 文档确认（参考 Mochi/plan/07_DSH_FACTCHECK.md）。

---

## 4. Mochi Relay（已跑通的 A2A 实现，必须保留）

### 4.1 表结构 SQL（贴出）

```sql
-- 0024_mochi_relay.sql
CREATE TABLE IF NOT EXISTS mochi_relay_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body  TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
         CHECK(status IN ('pending','accepted','declined')),
  reply TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mochi_relay_to   ON mochi_relay_messages(to_user_id, status, id);
CREATE INDEX IF NOT EXISTS idx_mochi_relay_from ON mochi_relay_messages(from_user_id, status, id);

-- 0025_mochi_network_tasks.sql（在 0024 基础上扩展）
ALTER TABLE mochi_relay_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message'
       CHECK(kind IN ('message','request'));
ALTER TABLE mochi_relay_messages ADD COLUMN item TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS mochi_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mochi_resources_owner ON mochi_resources(owner_user_id, id);
```

- 状态机：`pending → accepted / declined`，**由收件方主人决定**，Mochi 只预填不能代答。
- A2A 边界：只交换有界文本（body ≤ 200 / item ≤ 64 字），不触碰学生数据；agent 互不读内部状态。
- 设计灵感：A2A 协议（github.com/a2aproject/A2A，Apache-2.0）的校园最小实现。

### 4.2 相关 API 路由（均在 `core/assistant.ts`）

| 路由 | 行为 |
|---|---|
| POST /api/assistant/relay | `relayList(db, userId)` 列出待回应/历史传话 |
| POST /api/assistant/relay/respond | 校验 `id/action(accept\|decline)/note(≤120)`；仅 pending 可回应；request 类型 accept 时服务器 `searchRegistry` 实查对方登记并预填 reply；写状态+审计 |
| （工具入口）MOCHI_RELAY_ASK / MOCHI_RELAY_STATUS / MOCHI_RESOURCE_FIND / MOCHI_RESOURCE_REGISTER | 见 §3.1 第 14–17 项 |

### 4.3 前端卡片组件

- 文件：`src/pages/AssistantPage.tsx`（助手页，含 Relay 卡片 UI）
- 组件：`.assistant-relay-card`（"Mochi 传话"卡片），`refreshRelay`/`respondRelay` 调 `/api/assistant/relay` 与 `/api/assistant/relay/respond`
- 类型：`shared/assistant.ts` 的 `AssistantRelay`
- 说明：UI 由另一 Agent 盘点；此处仅标注"资产所在"，桌面端需把该卡片迁到 dsh/Electron 渲染层。

### 4.4 测试与完整性

- Relay 相关测试散布在 `tests/assistant-natural-language.test.ts`、`tests/assistant-session.test.ts`、`tests/assistant-privacy.test.ts` 等（具体 Relay 用例数 **TO_BE_VERIFIED**，需逐文件 grep `relay`）。
- 全项目 **374 个测试通过**（前 Agent 自报）；Relay 作为近期实现，测试随 0024/0025 落地。
- **全貌结论**：Relay 资产完整——表（2 张）、API（2 路由 + 4 工具）、前端卡片（AssistantPage）、测试齐备；是 A2A 能力的"前身/最小实现"，迁移时**必须保留并向上抽象为 dsh 的 agent-to-agent 能力**。

---

## 5. 依赖与配置

### 5.1 后端侧依赖与 License（逐个标注）

| 依赖 | 版本 | License | 是否可用 | 备注 |
|---|---|---|---|---|
| hono | ^4.13.0 | **MIT** | ✅ | Web 框架，桌面端是否沿用取决于 dsh（**TO_BE_VERIFIED**：dsh 是否自带 HTTP 层） |
| @block65/webcrypto-web-push | ^1.0.2 | **MIT** | ✅ | VAPID 签名；桌面端推送将改为 OS 通知，大概率下线 |
| pg | ^8.23.0 | **MIT** | ✅ | 仅 cloudbase/腾讯云路径用，D1 不用；Mochi 不用 |
| react / react-dom | ^19.2.0 | MIT | ✅ | 前端 |
| react-router-dom | ^7.18.2 | MIT | ✅ | 前端路由（桌面端路由表需改） |
| lucide-react | ^0.468.0 | ISC | ✅ | 图标 |
| motion | ^13.0.0 | MIT | ✅ | 动画 |
| **合计** | — | 无 GPL / 无未知 License | — | 后端运行时依赖未踩 GPL 红线 |

> **TO_BE_VERIFIED**：`@block65/webcrypto-web-push` 确认 MIT（已在 node_modules/package.json 核对）；其余 MIT/ISC 均合规。无 GPL、无"无 License"依赖。

### 5.2 wrangler.jsonc 配置全貌（源 = `wrangler.jsonc`，非 .toml）

| 配置项 | 值 | 迁移含义 |
|---|---|---|
| name | jyl-campus-health | 项目名（弃用） |
| main | ./worker/index.ts | 入口（Hono app） |
| compatibility_flags | nodejs_compat | Node 全局可用（利好迁移） |
| assets.not_found_handling | single-page-application | SPA 回退（桌面端由 Electron 处理） |
| ai.binding | AI（remote） | **CF 专有**，删 |
| d1_databases | DB → jiaxiang-campus-health-db | 替换为 better-sqlite3/node:sqlite 文件 |
| vars | APP_ENV=demo, SESSION_TTL_HOURS=10, ARCHIVE_DAYS=180, AI_PROVIDER=workers-ai, AI_DAILY_USER_LIMIT=50, AI_DAILY_GLOBAL_LIMIT=500, JUDGE_ACCESS_ENABLED=true | 移入 dsh/Electron 环境变量 |
| secrets | SESSION_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT | 移入安全配置（**勿入仓库**） |
| triggers.crons | `* * * * *` | 改为 Electron 定时器 |
| observability | enabled | 可选 |

### 5.3 环境变量与 Secrets 清单

| 名称 | 类型 | 来源 | 说明 |
|---|---|---|---|
| APP_ENV | var | wrangler vars | demo / production |
| SESSION_TTL_HOURS | var | vars | 会话时长 |
| ARCHIVE_DAYS | var | vars | 留存期（审计不自动清） |
| AI_PROVIDER | var | vars | workers-ai / zhipu |
| AI_DAILY_USER_LIMIT / AI_DAILY_GLOBAL_LIMIT | var | vars | AI 配额 |
| JUDGE_ACCESS_ENABLED | var | vars | 评审扫码入口 |
| SESSION_SECRET | secret | .dev.vars | 会话签名密钥 |
| VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT | secret | .dev.vars | Web Push（桌面端可弃） |
| ZHIPU_API_KEY | secret | 代码引用（**TO_BE_VERIFIED**：未在 wrangler 显式列，应在 secrets） | 智谱直连 |
| ZHIPU_SCENARIO_AUTHORIZED | secret/var | 代码引用 | 智谱场景授权开关 |
| WECOM_* / WECHAT_MINIPROGRAM_* | var | .dev.vars.example | 企业微信/小程序（Mochi 桌面端大概率不需要） |

---

## 6. 测试资产

### 6.1 清单 / 框架 / 总数

| 项 | 值 |
|---|---|
| 框架 | **vitest ^4.1.0**（`vitest.config.ts`，`environment: "node"`，`include: tests/**/*.test.ts`） |
| CF 测试池 | `@cloudflare/vitest-pool-workers ^0.20.1`（miniflare，跑真实 Worker 运行时 + D1） |
| 测试文件数 | **44** 个 `*.test.ts` |
| 断言总数 | **374**（前 Agent 自报通过） |

代表性后端/逻辑相关测试文件：`assistant-privacy.test.ts`、`assistant-session.test.ts`、`assistant-natural-language.test.ts`、`auth-activation.test.ts`、`security.test.ts`、`security-hardening-contracts.test.ts`、`messages-privacy.test.ts`、`cloudbase-pg-http-adapter.test.ts`、`contracts.test.ts`、`request-url.test.ts`、`time.test.ts`。
前端/UI 测试（`*.test.ts` 中涉及页面/设计系统/精灵动画者，如 `design-system.test.ts`、`sprite-player.test.ts`、`painterly-*.test.ts` 等）不属本盘点范围。

### 6.2 可复用性

| 类别 | 复用性 | 说明 |
|---|---|---|
| 纯逻辑测试（脱敏/权限/解析/聚合） | **高** | `shared/assistant*.ts`、`lib/assistant-*` 的断言可直接复用到 dsh 插件单测 |
| 数据库行为测试 | **中** | SQL 语义断言可复用，但**测试 harness 必须换**：`@cloudflare/vitest-pool-workers` → Node + better-sqlite3 内存库 |
| 路由集成测试 | **低-中** | 依赖 Hono + D1 适配层；适配层就位后大部分可跑，需替换 `env` mock |
| Web Push / Workers AI 测试 | **低** | CF 专有，需重写或删除 |

---

## 7. 待确认清单（TO_BE_VERIFIED）

1. AI 工具数：提示词说 14，代码为 **17**——是否曾删减？
2. dsh `defineTool` 入参/出参契约是否与 `AssistantToolArgs`/`AssistantResult` 兼容（见 07_DSH_FACTCHECK.md）。
3. `@cloudflare/vitest-pool-workers` 测试如何映射到 Node 测试（逐文件 relay 用例数未精确统计）。
4. `ZHIPU_API_KEY`/`ZHIPU_SCENARIO_AUTHORIZED` 是否在 wrangler secrets 显式声明。
5. `shared/assistant-privacy.ts` 在前端是否有独立调用点（影响是否全量搬入 shared）。
6. Mochi 桌面端是否仍需要 Web Push（决定 `@block65` 与 VAPID 密钥去留）。

---
*本文件为盘点交付物，不含任何迁移实现代码。所有"如何迁"交由后续方案文档。*
