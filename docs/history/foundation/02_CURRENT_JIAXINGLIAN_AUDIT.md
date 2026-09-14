# 02 · 联动计划现状审计（CURRENT_JIAXINGLIAN_AUDIT）

> 审计方式：严格只读（2026-09-04）。联动计划 = `/Users/a1379/Documents/联动计划`，**红线：绝不修改该目录任何文件。**

## 1. 技术栈与部署

- 前端：React 19 + TypeScript + Vite 8 + react-router-dom 7，PWA（`public/manifest.webmanifest`、`public/sw.js`）。
- 后端：Cloudflare Worker + Hono 4，单入口 `worker/index.ts`（含 CSP/CSRF 中间件），路由 `worker/routes/{auth,core,messages,push,admin}`。
- 数据库：D1（`jiaxiang-campus-health-db`），migrations 0001–0025（wrangler.jsonc 声明）。
- 推送：Web Push + VAPID（`worker/lib/push.ts`、`worker/lib/messaging/push-jobs.ts`）。
- 备用通道：腾讯云 CloudBase（`server/` + `Dockerfile.tencent`）。
- **迁移含义**：后端是"状态权威"，KEEP AS SERVICE；不迁移进 Harness，通过 Organization Plugin 经 API 复用（见 `17`）。

## 2. 角色与权限

- `shared/types.ts:9`：`Role = NURSE | DORM_STAFF | HEAD_TEACHER | SUBJECT_TEACHER | GRADE_ADMIN | ADMIN`（六岗位，无学生账号）。
- 数据作用域 SQL：`worker/lib/permissions.ts`（`studentScope`/`canAccessStudent`/`canAccessEvent`）：
  NURSE 全量、ADMIN/DORM_STAFF 空、GRADE_ADMIN 按年级、教师按 `teacher_class_roles`。
- 前端隐藏菜单只是体验优化，**所有真实权限由 Worker API 再查**（PAGES_AND_PERMISSIONS.md）。
- **迁移含义**：org plugin 的 scope 模型直接映射这套角色→数据域（`18_AUTH_AND_PERMISSION.md`）。

## 3. 业务核心：Movement 状态机（PRESERVE）

- `shared/movement.ts`：`OUTBOUND → ARRIVED → RETURNING → CLOSED`（+`CANCELLED`）；
  迁移表 `ARRIVE/LEAVE/CONFIRM_RETURN/CANCEL`。
- `worker/domain/movement/service.ts`：`createMovement` 即教师放行（`approved_by`），
  `transitionMovement` 用乐观锁 `WHERE id=? AND status=? AND version=?`；
  `idempotencyKey` 字段 + `transitionActionKey/EventKey`。
- 超时：`worker/domain/movement/overdue.ts` + Worker cron。
- **迁移含义**：这是 Golden Demo D 的底座，绝不在 Mochi 侧重写第二套状态机。

## 4. Mochi 传话网络（已跑通，PRESERVE FIRST）

- 服务端：`worker/routes/core/assistant.ts` —— 传话箱（678-682）、`MOCHI_RELAY_ASK`（711-728）、
  寻物 `MOCHI_RESOURCE_FIND`（736-803：先查 `mochi_resources` 共享登记，未中投 `kind='request'`）、
  资源登记（809-815）、应答 `POST /assistant/relay/respond`（1389-1415）。
- 表：`migrations/0024_mochi_relay.sql`（`mochi_relay_messages`：from/to/body/status pending→accepted|declined/reply）、
  `0025_mochi_network_tasks.sql`（`kind message|request`、`item` 列、`mochi_resources`）。
- 人决定应答：respond 用 `UPDATE … WHERE id=? AND to_user_id=? AND status='pending'`——只有收件人本人能改。
- **迁移含义**：v1 Dispatch 的语义基准（见 `14`/`15`）；E2E 已验证（传话+找卷子），不许回归。

## 5. 数据库全貌

34 张表（实测迁移后 35，含 `_migrations` 口径差）：账号/会话（users/sessions/login_attempts/…）、
班级学生（classes/teacher_class_roles/students/card_identifiers）、医务（health_events/acknowledgements）、
流动（student_movements/movement_events/dorm_*）、消息推送（messages/message_recipients/notification_jobs/…）、
审计与 AI（audit_logs/ai_usage_daily/assistant_previews/assistant_sessions）、Mochi（mochi_relay_messages/mochi_resources）。
- **迁移含义**：本地 Mochi 已复制 0001–0025 进 `apps/desktop/electron/db/migrations/`（better-sqlite3 跑通，
  唯一方言差 `PRAGMA foreign_keys` 已处理）——本地库只作 demo fixtures 与离线演示，**不新建第二套线上业务库**。

## 6. 设计系统（迁移源，详见 `07`）

- 主令牌 `src/design/calm-tokens.css`（74 行，亮/暗两套齐全）：暖米白画布 `--canvas:#f5f2e9`、
  墨绿灰 `--ink:#2d3833`、品牌鼠尾草绿阶梯 `--sage-*`、暖橙 `--accent:#d9873e`、玻璃控制层、
  圆角 8/12/16/22/28/pill、spring 缓动 `cubic-bezier(.22,.78,.24,1)`。
- 参考 UI 令牌 `src/design/reference-ui.css`：`--rui-brand:#56ae7f` 翠绿、`--rui-deep:#315f50` 深绿、断点与页边距。
- 童话辅助令牌 `src/design/cozy-pages.css`；动效单一真理源 `src/lib/motion.ts`（TS 注入 CSS 变量，真实弹簧解析解）。
- 全局组件：`LiquidGlassButton`/`Pill`/`SquircleAnchor`/`MaterialSurface`/`Layout`/`PainterlyPageFrame`/`LiquidToast`/`AmbientLeaves`。
- 维护基线 `UI_MOTION_AUDIT.md`：实体表面承载内容、玻璃只用于控制层、动画只解释状态变化、
  `prefers-reduced-motion` 降级、多断点无横向溢出。

## 7. ExpressiveOrb 表情球

- 核心：`src/components/ExpressiveOrb.tsx`（413 行）+ `.css`；周边：`ThinkingOrb`/`OrbCompanion`/`AssistantAvatar`。
- 接口 `{ size, mood, active, interactive, label }`；情绪 `idle|thinking|listening|speaking|success|alert`；
  每态调参 `TUNING` + 焦糖色带 `MOOD_COLOR`（色相 19–45°）；Catmull-Rom 有机轮廓 + 阻尼弹簧 + 逐帧 lerp；
  18% 双眨、戳按果冻回弹、`prefers-reduced-motion` 静帧。
- **迁移含义**：整文件拷贝复用，不改渲染逻辑；mood 由 dsh 事件桥映射（`09` §4）。

## 8. 隐私与安全基线（继承为 Mochi 红线）

- `PRIVACY_AND_SECURITY.md`：HttpOnly SameSite Cookie + PBKDF2 + 登录限速；服务端重验权限；
  管理员默认不可读保密医务备注；VAPID/会话密钥不进前端与 Git；锁屏负载脱敏；操作全量审计。
- **迁移含义**：Mochi 侧一切校园数据访问必须不低于此基线（`29_SECURITY_BOUNDARIES.md`）。
