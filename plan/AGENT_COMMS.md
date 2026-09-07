# Agent 协作黑板

> 三位 Agent 共同读写这份文件，遇到问题/发现就追加。
> 时间：2026-09-04 ~

---

## 状态

- [x] Batch 0（Electron + 球）—— 已 commit `b647763` tag `batch0`
- [~] Batch 1（数据层）—— Agent A 已完成，待 Agent B 集成 `main.ts`
- [ ] Batch 2（dsh 集成 + 审批桥）—— Agent B
- [ ] Batch 0+UX（输入框 + 球状态映射 + 人格对话）—— **Agent C 已完成**（2026-09-04）

---

## Agent A（数据层）的进展

> 完成于 2026-09-04。DB 模块已就绪，Agent B 可直接 `import { openDb, migrate, closeDb } from './db'`。

**1. 依赖**
- `better-sqlite3` 运行时版本 **11.10.0**（arm64 已编译 native 模块 `build/Release/better_sqlite3.node`）。
- `@types/better-sqlite3` **9.6.0**（devDependency；v11 不再自带 .d.ts，类型层必须装这个，否则 `tsc` 报 TS7016）。
- 安装坑（复现必看）：本机 `rm` 被 WorkBuddy broker 包装，`env -u CODEBUDDY_SESSION_ID` 后 broker 拦截 `rm` 导致 node-gyp `make` 失败；**必须保留 `CODEBUDDY_SESSION_ID`** 再装。另需 Python 3.11 提供 `distutils`（`npm_config_python=/usr/local/bin/python3.11`）。

**2. 迁移文件**
- 从 `联动计划/migrations/` 复制 **25 个** `00xx_*.sql` 到 `electron/db/migrations/`，文件名不变；加 `.nosync` 标记防 iCloud 同步。

**3. D1 方言差异（核心难点结论）**
- 逐文件扫描：`PRAGMA foreign_keys`（0001 唯一，已修）/ `STRICT` 模式（无）/ `json_` 函数（无）/ 真实 `RETURNING` 子句（无，迁移里的 RETURNING 仅是 CHECK 字符串枚举值）/ `AUTOINCREMENT`、`datetime('now')`、`CURRENT_TIMESTAMP`、`ON CONFLICT`、`CHECK`、`REFERENCES ... ON DELETE CASCADE`（均为标准 SQLite，直接跑）。
- **真正差异点只有 1 个：0001 的 `PRAGMA foreign_keys = ON`**。D1 逐文件执行它即可；better-sqlite3 下 `db.exec('PRAGMA ...')` 不跨语句持久，必须在**每个连接**用 `db.pragma('foreign_keys = ON')` 设置。已在 `0001_schema.sql` 顶部加 `-- TODO_D1_DELTA:` 注释保留原行（不静默删），并在 `openDb()` 与 `runMigrations()` 里显式开启。无任何 D1 独占语法被静默改写。

**4. 验证脚本输出（`scripts/test-migrate.mjs`，跑 /tmp/mochi-test.db）**
- `[mochi.db] applied 25 migrations` ✅ 25 个全跑通
- 用户表数（不含 `_migrations`）= **35**（≥30 通过；06 文档记 34 张，实测 35，属文档计数口径差异，无缺表）
- 关键资产表 `mochi_relay_messages`、`mochi_resources` 均存在 ✅
- `mochi_relay_messages` 已带 0025 扩展列 `kind, item` ✅
- **幂等**：对同库二次 `runMigrations` 返回 `applied 0`（靠 `_migrations` 表 filename 主键）✅
- `tsc -p tsconfig.node.json` 通过（TSC_EXIT=0）✅

**5. 给 Agent B 的集成提示（Batch 2 接 `main.ts`）**
- 模块入口：`electron/db/index.ts` 导出 `openDb(filePath)` / `migrate(db)` / `closeDb(db)`，**不 import electron**（路径由你传）。
- 运行期 DB 路径：任务规定 `path.join(app.getPath('userData'), 'mochi.db')`；注意 11 文档 §3.3 写的是 `DSH_HOME/storages/mochi.db`，两处不一致，请以你的 app 路径策略为准。
- `dev`/`build` 需把 `electron/db/migrations/*.sql` 拷进 `dist-electron/db/migrations/`（migrator 默认读 `__dirname/migrations`）；当前我已手动拷了一份，但**清掉 dist-electron 重新编译会丢**，建议在 `package.json` 的 `build` 与 `dev.mjs` 的 tsc 之后加一行 `node scripts/copy-db-assets.mjs`（可接受我顺手补，或你加）。

**6. 复制的共享代码（纯 TS/标准 Node API，无相对 import 需改）**
- `electron/shared/types.ts`、`electron/shared/constants.ts`、`electron/shared/time.ts`、`electron/lib/crypto.ts`（crypto 用 Web Crypto 全局，Node 22 原生可用）。

---

## Agent B（dsh 集成）的进展

> 完成于 2026-09-04（Batch 2 前半段：mochi profile + 审批 answerer + 通信桥 + sidecar）。
> 边界遵守：只动了 `apps/desktop/electron/dsh/`、` .mochi-home.nosync/profiles/mochi/`、`main.ts`、`preload.ts`；未碰 `db/`、`renderer/`、`skills/mochi/`、插件 `index.mjs`、联动计划。

### 1. mochi profile 跑通（CLI 单次验证）

建了两个 profile（同一套 Mochi 配置，不同底层包）：
- **`mochi`**（bundle `dsh-headless`）：用于 CLI 单次验证，命令 `./mochi.sh --profile mochi "..."`。
- **`mochi-sdk`**（bundle `dsh-sdk-app`，自带 `dsh-sdk-jsonrpc-server`）：给 Electron 主进程 spawn 的 **sidecar 长驻 JSON-RPC** 用。

`dsh --profile mochi "现在哪些学生在医务室？"` 真实输出（模型 + mochi-campus 工具）：
```
[Mochi] hello plugin loaded! 内核已挂载自定义插件
[mochi-approval] 收到审批请求 tool= undefined reason= (无) callId= (无)
[mochi-approval] answerer 已注册（ctx.waterfall approval/request）
[Mochi] campus 插件已加载，工具 campus_query_student 已注册
张明远和高一(3)班的陈子昂目前在医务室。
```
✅ 模型答出 2 名 in_clinic 学生（4 条 demo 中的正确两条）。

### 2. mochi-approval answerer 注册成功

位置：`apps/desktop/electron/dsh/mochi-approval/index.mjs`（dsh 子进程内插件，非主进程模块）。
注册写法（已查源码 `user-approval/src/index.ts:272` + `types.ts:85`，**必须是 waterfall 不是 ctx.on**）：
```js
ctx.waterfall('approval/request', async (req, next) => {
  console.log('[mochi-approval] 收到审批请求', req.toolName, req.reason ?? '(无)');
  return 'allowed-once';   // ⚠️ 必须是 ApprovalOutcome 字符串枚举，不是 { allowed: true }
});
```
实测：跑 CLI 时 answerer 收到审批请求并被调用，未 fail-closed（若用 `ctx.on` 或返回对象会 fail-closed）。

### 3. 通信桥接口签名（protocol.ts 导出）

5 个通道，命名空间统一 `mochi:*`。`apps/desktop/electron/dsh/protocol.ts`：
```ts
export const IPC = {
  ping: 'mochi:ping',
  promptSend: 'mochi:prompt:send',        // renderer→main: { text, promptId? }
  promptCancel: 'mochi:prompt:cancel',    // renderer→main: { promptId }
  eventStream: 'mochi:event:stream',      // main→renderer: DshStreamEvent 联合类型
  approvalRequest: 'mochi:approval:request', // main→renderer: ApprovalRequest
  approvalRespond: 'mochi:approval:respond', // renderer→main: { requestId, decision:'allow'|'reject' }
} as const;

export type DshStreamEvent =
  | { kind: 'status'; status: 'idle' | 'running' }
  | { kind: 'thinking'; text?: string }
  | { kind: 'tool'; toolName: string; args?: unknown }
  | { kind: 'text'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; message: string };

export interface ApprovalRequest { requestId: string; toolName: string; reason?: string; callId?: string; actionLabel?: string; target?: string; reversible?: boolean; }
export interface MochiBridge { ping(): Promise<...>; sendPrompt(text): Promise<{promptId}>; cancelPrompt(promptId): Promise<void>; respondApproval(requestId, decision): Promise<void>; onStream(cb): ()=>void; onApprovalRequest(cb): ()=>void; }
```
`harness.ts` 提供 `startDshSidecar/stopDshSidecar/onDshStream` + stdio JSON-RPC 客户端（initialize 首次握手约 11s，已给 60s 超时）+ 崩溃自动重启 ≤3 + SIGTERM→超时 SIGKILL 优雅退出。`index.ts` 汇总并导出 `attachIpcHandlers(ipcMain)`。

### 4. 主进程侧验证（Electron 集成）

`MOCHI_NO_SANDBOX=1 node scripts/dev.mjs` 启动后，主进程日志确认：
```
[mochi] dsh sidecar 启动（profile=mochi-sdk）
[mochi] dsh sidecar 就绪（initialize 完成）
```
✅ sidecar 从 Electron 主进程 spawn 并握手成功，窗口未崩（球仍静态也接受）。`tsc -p tsconfig.node.json` 通过。
（注：dev 日志里 `Port 5178 is already in use` 是环境里残留旧 Vite，与本次改动无关。）

### 5. 关键问题 / dsh API 修正（已同步 12_REVISION_LOG.md）

- **🔴 审批 answerer 返回值**：任务原话写 `return { allowed: true }`，**这是错的**。源码 `user-approval/src/index.ts:279` 把非词汇返回值归一化为 `'unavailable'`（fail-closed）。正确是返回字符串 `'allowed-once'`。已改并实测通过。
- **🔴 遥测关闭键**：patch 里 `session-telemetry-otel: disabled: true` **无效**（实测 dump-config 仍 `mode: FEEDBACK_ONLY`）。正确键是 `mode: DISABLED`（07 Q11），并叠加 `DSH_TELEMETRY_DISABLED=1`。已改，dump-config 现显示 `mode: DISABLED`。
- **sidecar 必须走 sdk 入口**：headless 包挂 `dsh-sdk-jsonrpc-server` 不会开服务（会直接退出）。实测只有 `--profile sdk`（或 bundle `dsh-sdk-app`）下 jsonrpc-server 才激活，故 sidecar 用独立 `mochi-sdk` profile。

### 6. 给 Agent C 的接口对齐点

preload 已暴露 `window.mochi`：`sendPrompt / cancelPrompt / onStream / onApprovalRequest / respondApproval / ping`。
Agent C 的 `renderer/src/api/mochi.ts` stub 可直接覆盖为真实实现（方法名一致；`respondApproval(reqId, allowed:boolean)` 建议改为 `(requestId, decision:'allow'|'reject')` 与协议对齐）。
StreamEvent 的 `kind` 字段对应 Agent C 的 `StreamEvent.type` 映射（thinking/tool→thinking，text→speaking，final/status:idle→success/idle，error→alert）。

---

## Agent C（教师 UX）的进展

> 完成于 2026-09-04。Batch 0 的 6 个 mood 调试 chip 已删除，替换为完整教师输入界面。

### 新建组件列表

| 文件 | 作用 |
|------|------|
| `renderer/src/components/OrbCompanion.tsx` | 从 联动计划 复制，**去掉了 `motion/react` 依赖**（改用局部 `useReducedMotion`），作为 Mochi 32px 聊天头像 |
| `renderer/src/components/OrbCompanion.css` | OrbCompanion 动画 CSS（原样保留） |
| `renderer/src/hooks/useMochiMood.ts` | Mood 状态 hook：`{ mood, trigger({mood}), setRaw }`；success 自动 1.5s 回 idle |
| `renderer/src/api/types.ts` | `StreamEvent`（7 种事件联合类型）、`ApprovalRequest`、`moodForEvent()` 映射函数 |
| `renderer/src/api/mochi.ts` | **MochiBridge stub**：5 个方法均为 no-op，Agent B 直接覆盖即可 |
| `renderer/src/components/InputBar.tsx` + `.css` | 底部圆角输入栏：Enter 发送 / Shift+Enter 换行 / 焦糖发送按钮 spring 反馈 |
| `renderer/src/components/ChatBubble.tsx` + `.css` | 对话气泡：老师右侧（字母头像）+ Mochi 左侧（OrbCompanion 32px） |
| `renderer/src/components/ChatLog.tsx` + `.css` | 历史滚动区：max-height 60vh，overflow-x: hidden |

### 修改文件

| 文件 | 变更 |
|------|------|
| `renderer/src/App.tsx` | **重写**：删 moodbar → 接入 useMochiMood + InputBar + ChatLog + bridge 调用点 + Cmd+Shift+D 隐藏调试 |
| `renderer/src/App.css` | **重写**：适配新布局（球→状态→对话→输入栏→footer），保留 calm-tokens 设计语言 |

### mochi.ts 占位接口签名

```ts
export interface MochiBridge {
  sendPrompt(text: string): Promise<void>;
  onStream(cb: (event: StreamEvent) => void): () => void;
  onApprovalRequest(cb: (req: ApprovalRequest) => void): () => void;
  respondApproval(reqId: string, allowed: boolean): Promise<void>;
  cancelPrompt(promptId: string): Promise<void>;
}
```

### 截图视觉自检结果（逐条 ✓/✗）

1. ✅ 球是焦糖色、两只眼睛 —— ExpressiveOrb 渲染正确
2. ✅ 深绿画布 —— --sage-800 (#45584e)
3. ✅ 输入框是圆角矩形 —— 大圆角纸面底色 + 焦糖发送按钮
4. ✅ 无横向滚动条 —— 10 条消息无横滚（ChatLog overflow-x: hidden）
5. ✅ 文字有底色+圆角 —— status pill / 气泡 / 头像 / 输入栏 / 按钮 全部合规
6. ✅ 颜色跨度小 —— 仅深绿 + 奶油纸 + 焦糖三档

### 与 Agent B 的接口对齐点

**UI 侧已预留的调用点（等 Agent B 接真实实现）：**

| UI 行为 | 调用的 bridge 方法 | Agent B 需提供的 StreamEvent.type |
|---------|-------------------|----------------------------------|
| 用户点发送 | `bridge.sendPrompt(text)` | — |
| 收到 thinking/tool_call 事件 | `trigger({ mood: 'thinking' })` | `"thinking"`, `"tool_call"` |
| 收到 speaking/token 事件 | `trigger({ mood: 'speaking' })` + 累积文字进气泡 | `"speaking"`, `"token"` |
| 收到 success 事件 | `trigger({ mood: 'success' })`（自动回 idle） | `"success"` |
| 收到 alert/error 事件 | `trigger({ mood: 'alert' })` | `"alert"`, `"error"` |
| 收到确认请求 | `console.log(req)`（Batch 2 弹确认卡） | — |

**Agent B 接入方式：** 直接覆盖 `renderer/src/api/mochi.ts` 的 `mochi` 导出对象。UI 不需要改任何 import 或调用方式。

### 已知待清理项

- `SEED_MESSAGES` 占位对话（10 条示例对话）—— Agent B 接通真实 dsh 后应移除或替换为空数组
- `electron/db/` 的 `better-sqlite3` 类型缺失导致 `tsc -p tsconfig.node.json` 失败（Agent A 的代码，不归我改），阻塞 `npm run dev` 的 tsc 步骤；绕过方式是直接起 vite + 用已有 dist-electron/main.js 启动 electron

---

## 跨 Agent 协调事项

> 需要对方配合时在这里喊一声