# 桌面桌宠模式（提案）

> **status**: draft
> **last_verified**: 2026-09-19
> **verified_by**: WorkBuddy AI；只读取证（源码 grep + 线上公开文档），未运行构建、未跑任何用例、未改动任何源码

本文回答一件事：**能不能把 Mochi 变成桌面上的桌宠——平时只有它，待办和已批准事项点一下才出现。**
结论是能，且不是从零做。本文给出取证、改动清单、以及三个必须先裁定的未决项。

相关：[开源复用审查](reuse-audit.md) · [构建标准](build-standard.md) · [运行事实](RUNTIME-FACTS.md) · [不可替代性升级路线图](upgrade-roadmap.md)

---

## 1. 结论先行

| 问题 | 结论 | 依据 |
|---|---|---|
| 能不能实现 | **能**。桌面端已有一套等价的悬浮窗基建，桌宠是把它再实例化一次 | 本文 §3 |
| 好不好实现 | **不算重**。新增 3 个文件 + 3 处小改；不需要动打包清单、不需要动插件白名单 | 本文 §4 |
| 有没有更省事的路 | **有**：走「纯主进程窗口 + `data:` URL 页面」，绕开全部资源清单风险 | §4.4 |
| 卡在哪 | **卡在数据**，不卡在窗口。「已批准」在现有数据模型里不是一个状态 | §5 |
| 要不要 fork Petdex | **不要**。它的桌面端是原生 Zig 应用，没有面板概念 | §2.3 |

---

## 2. 来源：Petdex 是什么

来源：[petdex.dev](https://petdex.dev/) · [crafter-station/petdex](https://github.com/crafter-station/petdex)（**MIT**；宠物素材版权归投稿者，Petdex 不主张 IP 权利）。检索与许可证核对已记入 [reuse-audit](reuse-audit.md)。

### 2.1 它由三部分组成（已确认事实）

1. **网页画廊**（Next.js 16 + React 19 + Drizzle + Postgres）：社区投稿与展示，当前约 4867 只。
2. **CLI**（Bun + TypeScript，npm 包 `petdex`）：`npx petdex install <slug>` 把宠物落到 `~/.petdex/pets/<slug>/`。
3. **桌面 app**：一只浮在所有窗口之上的桌宠，随 Agent 的工具调用而变化。

### 2.2 宠物包格式（值得照抄的部分）

- 一个宠物 = 一个文件夹，里面两样东西：`pet.json` + `spritesheet.{webp,png}`。
- 精灵图是 **8×9 网格、每帧 192×208**（新版 8×11 网格，多留两行给客户端）。整图推荐 1536×1872。
- **九个状态行是固定的**：`idle` / `running-right` / `running-left` / `waving` / `jumping` / `failed` / `waiting` / `running` / `review`。Agent 的 hook 把活动映射到这九行。
- ChatGPT 导出的宠物是 1536×2288，正好也是九行，**可直接互用**。

### 2.3 为什么**不** fork 它的桌面端（已确认事实 + 判断）

官方 README 写明：桌面端是 **native SDK app with an in-process Zig hook server on `127.0.0.1:7777`**，**当前的发布路径没有 WebView，也没有 Node sidecar**；仓库里的 `packages/petdex-desktop-windows` 是已废弃的 Tauri 旧实现。它在 `~/.petdex/runtime/update-token`（0600）放一个轮换 token，任何能 curl 127.0.0.1:7777 的进程都能改它的显示状态。

判断：**它的桌宠只有一个"活动气泡"，没有业务面板概念**，气泡还是鼠标穿透的（设计上就是为了不挡键盘）。我们要的「点一下弹出待办/已批准」在它那里不存在。改造它等于去写一个原生应用，而我们的目标是给已有 Electron 应用加一块屏。**因此只借鉴形态约定，不复用代码。**

### 2.4 值得借鉴的六条

1. 置顶但**不抢焦点**；
2. 气泡区域**鼠标穿透**——它明确写了理由：消息飘在编辑器上时不能吞掉一次按键（这条对我们同样成立）；
3. 宠物本体可**拖拽**，位置由用户决定；
4. 全局快捷键打开设置 / 收起（`Cmd+,` / `Cmd+W`）；
5. 设置里只有三项：**Pets（换形象）/ Agents（接谁）/ Appearance（缩放、气泡开关）**——克制，值得学；
6. 「装一只宠物」= 一个文件夹，无安装过程。

### 2.5 我们和它的形态差异（本次提案的核心）

它是「Agent 的**活动指示器**」，我们是「一个**入口**」。所以：形状可抄，交互必须自研。

---

## 3. 目标形态（按用户口述定义）

| 时刻 | 屏幕上应该有 | 不应该有 |
|---|---|---|
| 平时 | 只有 Mochi 桌宠（OrbCompanion：球 + 面前一台小电脑） | 待办列表、主窗口 |
| 需要时 | 点一下桌宠 → 弹出面板：待办、已批准等事项 | — |
| 收起时 | 面板消失，只剩桌宠 | — |

配套需要定：面板在桌宠的哪一侧弹出、多屏怎么办、点空白或按 Esc 是否收起、桌宠是否永远置顶（含全屏应用之上）。

---

## 4. 现状取证与改动清单

### 4.1 已确认事实：可直接复用的四处基建

| 能力 | 现状 | 证据 |
|---|---|---|
| 无边框置顶悬浮窗 | **已有**。`frame:false` + `skipTaskbar:true` + `alwaysOnTop:true`，另有一个独立的无边框弹窗实现 | `apps/desktop/electron/dsh/rail.ts:248-251`（常驻条）、`rail.ts:322-325`（弹窗） |
| 窗口层级与跨工作区 | **已有**。按角色分 `screen-saver`（教室一体机）/ `floating`，并 `setVisibleOnAllWorkspaces` | `apps/desktop/electron/dsh/rail.ts`（`applyTopLevel`） |
| 位置记忆 | **已有**。写 `userData/mochi-rail-positions.json` | `main.ts:380`（`createRailPositionStore`） |
| 托盘菜单 | **已有**，且已有「显示 / 隐藏待办条」这一开关范式 | `apps/desktop/electron/dsh/tray.ts:21`、`tray.ts:120` |
| 待办行派生 | **已有**（`rail-model.ts` 把状态派生为可渲染的行） | `apps/desktop/electron/dsh/rail-model.ts` |
| Mochi 本尊的状态机 | **已有**六态 | `campus.nosync/src/components/OrbCompanion.tsx:17`（`idle \| thinking \| typing \| celebrate \| alert \| sleep`） |
| IPC 通道命名规范 | **已有**：`mochi:<area>:<verb>`，常量集中在 `IPC` 表 | `apps/desktop/electron/dsh/protocol.ts:209`（含 `lanAttention:223`、`railApply:227`、`railAction:231`） |

### 4.2 已确认事实：当前形态是「全部常显」

- 待办条**开机常显**：`let railVisible = true;`（`main.ts:93`），启动时 `initializeDesktopRail()`（`main.ts:980`）。
- 主窗口**无条件创建并显示**：`openWindowForCurrentState()`（`main.ts:734`）在 `whenReady` 里被直接调用（`main.ts:979`），窗口 `ready-to-show` 即 `show()`（`main.ts:542`）。
- **全仓没有任何 `transparent:true` 的 BrowserWindow，也没有任何 `setIgnoreMouseEvents` 调用**（grep 只命中 CSS 的 `background:transparent`）。→ 异形 / 穿透是**全新能力**，要自己实现。

### 4.3 新增与修改的最小集合

**新增（3 个文件）**

| 文件 | 作用 | 照抄对象 |
|---|---|---|
| `apps/desktop/electron/dsh/pet-window.ts` | 桌宠窗口控制器：无边框 / 置顶 / 不进任务栏 / 位置记忆 / 显示隐藏 / 承载面板 | `dsh/rail.ts` |
| `apps/desktop/electron/pet-preload.ts` | 桌宠窗 ↔ 主进程桥（沙箱 preload 不能 require 兄弟模块，通道名必须写字面量） | `electron/rail-preload.ts` |
| `apps/desktop/electron/dsh/pet-pages.ts` | 桌宠形象与面板的自包含 `data:` URL 页面 | `dsh/rail-pages.ts` |

**小改（3 处）**

| 文件 | 改什么 |
|---|---|
| `dsh/protocol.ts` | `IPC` 表追加 `mochi:pet:*`，并更新文件头的「通道总览」注释 |
| `main.ts` | 仿 `installRailBridge()`（`main.ts:326`）新增 `installPetBridge()`；**给 `openWindowForCurrentState()`（`main.ts:734`）加"桌宠模式下不自动显示主窗口"的分支**；重审 `quitIfMainWindowWasLastSurface()`（`main.ts:415`）与 `window-all-closed`——否则"收起面板"会把整个进程退掉 |
| `dsh/tray.ts` | 菜单加「显示 / 隐藏桌宠」项，仿 `toggleRail`（`tray.ts:120`） |

### 4.4 路线选择：**不要**做成 dsh 插件

`rail-pages.ts` 的注释已经把这个取舍写明了：走 `data:` URL 就不需要新增 CSP 放行，也不进插件白名单与快照清单。

而做成新插件要多动五处：`prepare-mochi-resources.cjs` 的 `PLUGINS`、`runtime-profile.json` 的三个 profile、`test-package-resources.mjs:296`（`EXPECTED_BUNDLED_PLUGIN_COUNT`，当前 25）、`test-package-resources.mjs:446-448`、`test-runtime-profile.mjs`。

**结论：走纯主进程窗口路线。** 新增 Electron 源码本身不需要动 `build.files` / `extraResources`——`tsconfig.node.json` 的 `include` 加 `dist-electron/**/*` 通配会自动收。

### 4.5 必须同步改的两个测试（否则必挂）

两套测试都把「第一个活窗口」当成主窗口，并假设启动即有可见窗口：

- `apps/desktop/scripts/test-tray-integration-runtime.mjs:240`（`getAllWindows().find((w) => !w.isDestroyed())`）、`:272`（断言启动即有可见窗口）、`:277`（断言关窗后窗口数归零）；
- `apps/desktop/scripts/test-startup-runtime.mjs:283`、`:289`（`getAllWindows()[0]`，并断言它在 LAN 提醒后可见）。

桌宠窗若**先于主窗口创建**、或**在主窗口关闭后仍存活**，这些断言会误判。这是本提案最容易被忽略的破坏面。

---

## 5. 阻塞项：面板到底显示什么（需要裁定）

### 5.1 「已批准」在当前模型里不是一个状态（已确认事实）

- 任务域 `mochi-dispatch` 是七态机：`CREATED / DISPATCHING / DELIVERED / COMPLETED / DECLINED / FAILED / EXPIRED`（`plugins/mochi-dispatch/state-machine.mjs:12`）；任务类型四种：`ASK / REQUEST / FIND / APPROVE`（同文件 `:10`）。
- 「批准」在这个产品里是**两样不同的东西**：
  1. **任务层面**：`decision: approve | decline`，`approve` 落到 `COMPLETED`；
  2. **人工审批闸**：词表是 `allowed-once / rejected / cancelled / unavailable`。
- 前端「传话卡」是派生态（`deriveCardState`，同文件 `:58`），**也不含「已批准」**。

→ **用户说的"已批准"，必须落到上面某一个具体语义上，否则面板做不出来。**

### 5.2 dispatch 今天没有前端读取面（已确认事实）

`mochi-dispatch` 只注册了面向 Agent 的工具 `mochi_tasks`。而现有待办条（rail）的数据**不是**从 dispatch 来的，走的是：

```
harness 页面(client-plugins/mochi-lan/client.js)
  → GET /api/mochi-lan/state        （plugins/mochi-lan/host-bridge.mjs:12 定义 LAN_HOST_API_BASE）
  → window.mochiRailDesktop.pushLanState(...)
  → IPC mochi:rail:lan-state        （main.ts:326 installRailBridge）
  → rail-model 派生行 → IPC mochi:rail:apply → rail 窗
```

### 5.3 三个候选（需选一个）

| 选项 | 面板显示 | 代价 |
|---|---|---|
| **A. 沿用现有 rail 数据** | 校园 / 教室待办（今天待办条上那些） | 最小。桌宠只是换了展示形态 |
| **B. 接 dispatch 任务域** | 传话 / 委托任务及其状态 | 需要**新开一条前端读取面**（今天只有 Agent 能用） |
| **C. A + B 都要** | 两个来源分区展示 | 最大，但最接近"产品设想" |

---

## 6. 风险

| 风险 | 性质 | 说明 |
|---|---|---|
| 点击穿透与拖拽冲突 | **合理推测** | 要做到"只有宠物本体可点、周围空白穿透到下面的应用"，需要 `transparent` + `setIgnoreMouseEvents(ignore, {forward:true})` 再按指针位置动态切换。这是全新技术点，本机尚无先例；未验证在 macOS/Windows 两侧的手感 |
| 关掉面板导致进程退出 | **已确认事实** | `quitIfMainWindowWasLastSurface()`（`main.ts:415`）与 `window-all-closed`（`main.ts:992`）的现有语义是为"主窗口=最后一块屏"设计的，桌宠模式要重新定义 |
| 两套运行时测试误判 | **已确认事实** | 见 §4.5 |
| 桌宠形象怎么渲染 | **未验证假设** | `OrbCompanion` 是 React 组件，不能直接塞进 `data:` URL 页面。要么内联一份精简渲染，要么静态图 + CSS 动画。这是本提案最大的技术选型分叉，**未做验证** |
| 打包清单 | **已确认事实** | 走 §4.4 的纯窗口路线则零风险；走插件路线则要同步五处 |

---

## 7. 分期建议

| 阶段 | 做什么 | 出什么 |
|---|---|---|
| A. 技术验证 | 只验最难的三件事：透明异形窗、鼠标穿透、拖拽 + 位置记忆。独立小窗，**不碰主窗口、不碰现有测试** | `test-pet-logic.mjs` 级别的证据 |
| B. 桌宠常驻 | 桌宠窗上线，主窗口可隐藏；托盘加开关；§4.5 两套测试改完 | 日常能只挂桌宠用 |
| C. 面板 | 接 §5 裁定后的数据源，点一下弹出 / 收起 | 本提案的核心交付 |
| D. 打磨 | 缩放、快捷键、多屏、设置项（克制，学 Petdex 只留三项） | — |

---

## 8. 验收标准（沿用既有闸门）

1. 新增桌宠逻辑必须有**独立测试**，仿 `test-rail-logic.mjs`（fake Electron 断言窗口选项）+ `test-rail-runtime.mjs`（真 Electron 冒烟）。
2. 出包仍须过既有六项检查，**其中第⑥项「能不能启动」必须对打包产物跑包内自带通道**（见 [build-standard](build-standard.md)）；`npm run smoke` 走开发树，不能当闸。
3. 本文所有 `file:line` 引用在实施前需与当时的源码重新核对（源码是事实源，本文只是 2026-09-19 的取证快照）。

---

## 9. 明确不做

- **不 fork Petdex 桌面端**（原生 Zig，无面板概念）。
- **不把桌宠做成 dsh 插件**（会把打包清单风险引进来，收益为零）。
- **不删待办条**：它是已交付并在用的能力，改成「默认隐藏、托盘可开」即可。
- **不动 `联动计划`**（红线仍为逐次授权）。

---

## 10. 待裁定（阻塞实施）

1. **面板的数据源**：§5.3 的 A / B / C。
2. **「已批准」的确切语义**：任务完成（`COMPLETED`）、人工审批放行（`allowed-once`）、还是别的。
3. **桌宠形象渲染方式**：内联精简渲染，还是静态图 + CSS 动画（§6）。
4. **主窗口的启动语义**：桌宠模式下开机完全不显示主窗口，还是先显示一次再收起。
