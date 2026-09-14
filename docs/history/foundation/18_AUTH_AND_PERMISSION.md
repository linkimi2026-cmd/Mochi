# 18 · 认证与权限（AUTH_AND_PERMISSION）

## 1. 三层权限栈（各管各的）

| 层 | 机制 | 权威 |
|---|---|---|
| 校园业务权限 | 联动计划 Worker：会话 Cookie + `permissions.ts` 数据作用域 SQL | 服务端（不可绕过） |
| Harness 运行时 | sandbox mode（`workspace-write`）+ 官方 permission presets + `tools/*` waterfall 把关 | dsh |
| Mochi 策略层 | mochi-approval answerer：AUTO/CONFIRM/DENY 按工具名 | 插件 |

## 2. 认证流（绝不变体）

- 用户名/密码 → 仅在认证视图与插件层流转 → Worker `/auth` 换 HttpOnly 会话 →
  凭据存本地安全存储（Electron safeStorage / dsh credentials 层）。
- 模型上下文中**永不出现**：Password、RefreshToken、SessionSecret、OrganizationSecret、VAPID 私钥。
- Agent 可见身份包：`{userId, role, classScope[], gradeScope[], capabilities[]}`（由插件在
  认证后写入 agent 可见会话事件——这是新增模型可见输入，必须走会话事件，官方不变量）。

## 3. dsh 侧配置基线

- 权限预设：`workspace-write`（沙箱 workspace-write + approval ask）——不给 `danger-full-access`。
- 沙箱：写操作限 workspace；被拒动作升级须用户一次性批准（官方机制）。
- webserver 只绑 `127.0.0.1`；Electron WebView 经 `file://` + IPC bridge（官方暗示路径）。

## 4. 失败与降级

- 会话过期：jxl.* 返回 `TOKEN_EXPIRED` → UI 重连；不自动重试写操作。
- 凭据损坏：清空重连，不缓存重试。
- 服务端 403：如实转述 `PERMISSION_DENIED`，模型不猜测原因、不重试变体绕过。
