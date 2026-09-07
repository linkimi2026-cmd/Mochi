# 04 · 目标架构（TARGET_ARCHITECTURE）

## 1. 总览

```
                嘉行联 · Mochi（教师工作环境）
                             │
              Electron 桌面壳（apps/desktop）
      窗口管理 / 安全通道 / 本地 DB(demo) / Orb 悬浮层 / 通知
                             │  spawn（Node ≥22.20）
                             ▼
        Mochi Harness v dsh-v0.1.3-alpha.1（真实运行时）
            profile: mochi-web（bundle: base + web-app + Mochi 扩展）
                             │
   ┌─────────────┬───────────┼─────────────┬──────────────┐
   │             │           │             │              │
 Web SPA      插件树(runtime)   client 插件树    Skills        Jobs/Schedule
 (官方UI骨架)   mochi-persona   (品牌/工作台)   teacher-*     提醒/后台任务
 审批卡/Trajectory  mochi-jiaxinglian(jxl.*)  …
 Sessions/Plugins  mochi-tools-ppt/doc/xlsx/pdf/file
 模型切换          mochi-approval(三档 answerer)
                   mochi-memory / mochi-relay / mochi-dispatch
                             │
              Organization Plugin ──HTTPS──▶ 嘉行联 Worker (D1)
              （Auth 独立；Agent 只拿 Identity/Role/Scope）
                             │
                   Mochi Network（v1 单机模拟：双 profile 互演）
```

## 2. 进程与通道（据 07 factcheck Q1–Q4 实证）

| 通道 | 用途 | 审批 UI |
|---|---|---|
| `dsh --profile mochi-web`（HTTP+WS，127.0.0.1） | Electron WebView 加载官方 Web SPA（`file://` + IPC bridge 为官方暗示路径） | ✅ 内置 `ui-approval` |
| `dsh --profile mochi-sdk`（stdio JSON-RPC sidecar） | 后台/自动化/演示脚本驱动（现 `electron/dsh/harness.ts` 已跑通） | ❌（SDK 通道不下发审批）→ 演示用 `demo-auto-approver` |
| `dsh --profile mochi`（headless） | CLI 单次验证 | ❌ fail-closed |

裁决：**主交互走 web 通道**（审批卡/设置/插件页/Trajectory 全部免费获得）；
SDK sidecar 保留用于脚本化演示与回归测试。两条通道共用同一 profile 家族与插件集。

## 3. 组件归属

| 组件 | 归属 | 说明 |
|---|---|---|
| 官方 Web SPA（会话/审批/Trajectory/设置/插件页） | Harness（保留） | "用起来像真正 Harness"的来源 |
| 嘉行联视觉（calm-tokens → `--dsw-*` 桥、品牌 slot、教师工作台） | client 插件 + 令牌桥 | "看起来像嘉行联"的来源（`08`） |
| ExpressiveOrb | Electron 层悬浮组件 | 情绪由 dsh 事件映射（`09` §4），不侵入专业页面 |
| 嘉行联业务系统 | 独立 Worker + D1（不动） | org plugin 经 HTTP 复用；本地 sqlite 仅 demo fixtures |
| Mochi 传话/派发 | `mochi-relay`/`mochi-dispatch` 插件 | v1 单机模拟双 profile；语义对齐联动计划 Relay |
| 办公产出（ppt/doc/xlsx/pdf） | `mochi-tools-*` 插件 + Artifact store（`.artifacts` 本地，版本链） | 质量循环 PLAN→CREATE→INSPECT→CRITIQUE→EDIT→VERIFY→DELIVER |
| Chat（外部免费厂商） | Harness 内浏览器/受控视图（P3） | Browser Chat Bridge + Handoff Capsule（`24`/`25`） |

## 4. 数据流铁律

- **模型可见即已记录**：任何进入模型的输入必须来自 session 日志可重建的会话事件。
- **CONTEXT BELONGS TO MOCHI**：模型只是 Processor；Transcript/Handoff Capsule/Artifacts/用户上下文
  属于 Mochi 层，换模型不散架（`10`）。
- **工具→事实→模型→自然语言**：所有工具结果经模型转述；工具不说话。
- **认证与数据不在模型侧**：org plugin 持有会话凭据，向 agent 暴露 Identity/Role/Scope/Capabilities。

## 5. 目录规划（Mochi 仓库内；路径为规划，未建者标注）

```
Mochi/
├── mochi-harness-src.nosync/mochi-harness/     # 上游克隆（已存在，锁定 dsh-v0.1.3-alpha.1）
├── .mochi-home.nosync/profiles/           # mochi / mochi-sdk / mochi-web(新)
├── apps/desktop/                        # Electron 壳（已存在；renderer 将按 08 重构）
├── plugins/                             # cordis.yml + mochi-campus / mochi-hello（已存在）
│   ├── mochi-persona/  mochi-jiaxinglian/  mochi-tools-*/  mochi-approval/
│   ├── mochi-memory/   mochi-relay/        mochi-dispatch/
├── client-plugins/                      # jxl-theme（令牌桥）/ jxl-brand / teacher-workspace
├── skills/mochi/                        # teacher skill 包（5 个 P0）
├── tools/                               # llm-probe / model-probe（已存在）
└── foundation/                          # 本包
```

## 6. 与旧架构（自绘 renderer）的关系

- `renderer/src/components/{ChatLog,ChatBubble,InputBar}` = 自绘聊天 UI → **DROP**（UI 骨架改官方 SPA）。
- `renderer/src/components/ExpressiveOrb*`、`hooks/useMochiMood`、`api/types` 事件→mood 映射 → **KEEP/ADAPT**。
- `electron/dsh/*`（harness.ts、protocol.ts、mochi-approval answerer）、`electron/db/*`、
  `electron/shared/*`、`electron/lib/crypto.ts` → **KEEP**（已实测）。
