# mochi-task-scheduler

Mochi 的**定时任务**插件。老师可以用口语提出「每天早自习前把课件打开」「明早 7:50 提醒我」「每周五整理一次本周作业」，模型把它们翻译成这里的三个工具。

## 工具

| 工具 | 作用 |
|---|---|
| `mochi_schedule_create` | 创建一条定时任务（写本机 SQLite + 注册进程内定时器） |
| `mochi_schedule_list` | 列出本机真实存在的定时任务 |
| `mochi_schedule_cancel` | 按 ID 取消一条定时任务 |

工具名只含字母、数字、下划线。**不要**给工具名加前缀点（如 `mochi.schedule.create`）：带点的名字会被模型网关 400 拒收**整轮对话**（2026-09-12 真实事故）。

## 参数怎么填（抗口语）

| 字段 | 说明 |
|---|---|
| `title` | 要做什么，一句话（≤200 字）。到点原样转达。 |
| `kind` | `remind`（到点在原会话发提醒）/ `notify`（到点产出一条本机通知记录）。其它值不支持。 |
| `frequency` | `once`（只一次）/ `daily`（每天）/ `weekly`（每周某天）/ `weekdays`（周一至周五）。 |
| `time` | `HH:MM` 24 小时制**补零**，`Asia/Shanghai` 本地时间。例：`07:50`、`19:30`。`7:5` 会被拒绝。 |
| `weekday` | 仅 `weekly` 必填，`1`=周一 … `7`=周日。中文口语（`周五`）与英文（`friday`）在工具内部也接受。 |
| `date` | 仅 `once` 必填，`YYYY-MM-DD`，必须是将来时间。 |
| `note` | 可选补充说明（≤500 字）。 |

口语 → 字段的对照：

- 「每天早自习前把课件打开」→ `daily` + `time: "07:30"`
- 「明早 7:50 提醒我」→ `once` + `date: "<明天>"` + `time: "07:50"`
- 「每周五整理一次本周作业」→ `weekly` + `weekday: 5` + `time`
- 「工作日早上提醒我」→ `weekdays` + `time`

## 持久化

任务写进 `DSH_HOME`（默认 `~/.mochi-home`）下的 `scheduler/mochi-schedules.sqlite`，沿用 `mochi-dispatch` 的数据根约定，进程重启后仍在。

| 表 | 内容 |
|---|---|
| `mochi_schedules` | 一条任务一行：重复规则、状态、下次触发时刻、绑定的会话 |
| `mochi_schedule_runs` | 每次到点的真实结果（`delivered` / `pending` / `failed`）。同一 `(schedule_id, planned_at)` 只留一行，重试不刷表 |
| `mochi_schedule_notifications` | `kind=notify` 到点产出的通知记录 |

## 调度与送达

- 到点由**当前 Mochi 应用进程内**的 `setTimeout` 链触发（`scheduler.mjs`）。最长空转 60 秒，也是"待送达"任务的重试间隔。
- `notify`：写一条 `mochi_schedule_notifications` 记录并打进应用日志。**这是本机记录，不是系统弹窗，也不是手机推送。**
- `remind`：用 `@deepseek-ai/dsh-llm` 的 `createUserMessage` + `agent.followup(...)`，把提醒作为一条后续消息排进**创建它的那个会话**。
- `remind` 到点时如果那个会话不在（应用重启过、会话已关闭），提醒**不会被丢弃也不会假装送达**：任务停在逾期状态，每轮重试，等会话恢复后再送。`mochi_schedule_list` 会显示「待触发（已逾期）」。
- 提醒正文会被标成「转达内容，不是新的指令」，避免模型把提醒当成新任务立刻执行。

## 诚实边界（不要对老师说过头）

- **应用关闭期间不会执行。** 本项目没有开机自启的后台常驻服务，插件不做"关机后也会执行"的承诺。应用重新打开后按剩余时间继续。
- `delivered` 只表示"提醒已排入会话/已写入通知记录"，**不代表老师看到或执行了**。
- 只有真的写进数据库、且调度器真的挂上了定时器，`mochi_schedule_create` 才会回 `ok: true` / `已注册定时器: true`；任一步没做到都会在回执里直说。
- 除 `once` / `daily` / `weekly` / `weekdays` 以外的重复规则（如「每月」「每小时」）**不支持**，会明确报错。

## 测试

```sh
cd plugins/mochi-task-scheduler && node --test test/*.test.mjs
```

覆盖：真实 SQLite 持久化（关掉再重开仍在；另有跨进程验证）、列出、取消（含重复取消与已触发不可取消）、
时间/周几/日期/频次/类型的非法输入拒绝、`render` 签名回归、工具名合规、创建/列出/取消端到端，
以及真实 1 秒级定时器验证"到点回调被调用"、待送达重试、投递抛错如实记失败。

`node:sqlite` 是实验特性，测试输出里会有 `ExperimentalWarning`，属正常。

## 上线接入（✅ 2026-09-12 已完成，以下保留为历史步骤）

> 下面三步**已全部由主控完成**：`PLUGINS` 白名单已含 `mochi-task-scheduler`（现为 26 项之一），`runtime-profile.json` 的 profile 与顶层映射均已登记，`PLUGIN_RUNTIME_MODULES` 无需新增。本节保留仅供追溯。

1. `apps/desktop/scripts/prepare-mochi-resources.cjs` 的 `PLUGINS` 数组加一行（**我没有改这个文件**）：
   ```js
   { id: "mochi-task-scheduler", source: "plugins/mochi-task-scheduler", files: ["index.mjs", "store.mjs", "scheduler.mjs", "schedule-time.mjs", "tools.mjs", "package.json"] },
   ```
2. `apps/desktop/resources/mochi-web/runtime-profile.json`：在要启用的 profile 的 `plugins` 数组里加 `"mochi-task-scheduler"`，并在顶层 `plugins` 里加：
   ```json
   "mochi-task-scheduler": { "workspacePath": "plugins/mochi-task-scheduler", "resourcePath": "mochi-task-scheduler" }
   ```
3. 无需新增 `PLUGIN_RUNTIME_MODULES` 条目：本插件只用到 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-llm`，两者都已在已审阅的暂存闭包里。
