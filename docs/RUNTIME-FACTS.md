# Mochi 运行机制实测事实（Runtime Facts）

> **status**: active　**last_verified**: 2026-09-12 21:0x　**verified_by**: 工具线（只读侦察：三路代码级核查 + 实测命令）
> **性质**：本文只记录**实测过**的运行机制事实，用来回答「它现在到底是怎么跑起来的」。
> 它存在的理由：过去多个 Agent 因为把**文档里的描述**当成机制，改错地方、白跑一轮构建
> （典型：以为 `NODE_PATH` 负责插件解析，实际 ESM 根本不看它）。
> **L2 原则**：代码 > 本文 > 其它文档。本文与源码冲突时，以源码为准并回来改这里。

---

## 0. 三行速记

1. **dev 有两条互不相干的入口**：浏览器版 `./mochi-dev-up.sh`（走官方 dsh web GUI，端口 3090）；桌面版 `cd apps/desktop && npm run dev`（Electron 自己再 spawn 一个 dsh，端口随机）。
2. **打包版只有一个入口**：`Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh/lib/bin.js --profile mochi-web`，由 `DshWebHost` 用 `ELECTRON_RUN_AS_NODE=1` 拉起。
3. **谁决定加载哪些插件**：不是 dsh，是 `apps/desktop/resources/mochi-web/runtime-profile.cjs` 的 `provisionMochiProfiles()` —— 它生成 profile 的 `package.json` + `cordis.patch.yml` + `node_modules/<插件名>` 软链，dsh 只按**名字**去 profile 目录里找。

---

## 1. 启动链路（打包态）

| 步骤 | 位置 | 事实 |
|---|---|---|
| 选角色 | `electron/main.ts:158-177` | `--role=` > `MOCHI_RUNTIME_ROLE` > 已记录角色文件 > 首启对话框 |
| 起 sidecar | `main.ts:456-460` → `dsh/web-host.ts:132-152` | spawn dsh bin，参数 `--expose-internals --profile mochi-web --port <MOCHI_DSH_PORT 或 0> --no-open`，`cwd = dshHome` |
| 就绪判据 | `web-host.ts:21-31` | 解析 stdout 的 `dsh web: <url>`，且必须是回环地址；90s 超时 |
| 环境注入 | `web-host.ts:80-120` | 先剔除 `ELECTRON_*` / `PLAYWRIGHT_BROWSERS_PATH` / `NODE_PATH` / `MOCHI_RUNTIME_NODE`，再写 `DSH_HOME`、`DSH_TELEMETRY_DISABLED=1`、`MOCHI_CAMPUS_API_URL`（仅有值且非 null 时）、`MOCHI_SEARXNG_ENDPOINT`、`PLAYWRIGHT_BROWSERS_PATH`、`MOCHI_RUNTIME_NODE`、`NODE_PATH`、`ELECTRON_RUN_AS_NODE=1` |

**校园后端地址的覆盖链（2026-09-12 实测）**：`resolveServiceDefaults()` 的优先级是
`环境变量 MOCHI_CAMPUS_API_URL` > `runtime-profile.json` 的 `serviceDefaults.campusApiUrl`。
实测：不设环境变量且 manifest 为 `null` → 返回 `{}`（**什么都不注入**，插件退回 `127.0.0.1:8787`）；
设成 `https://jyl-campus-health-entry.pages.dev` → 原样生效；带路径的地址或乱写的地址 → **明确拒绝**（只接受不含路径/查询/凭据的 HTTP(S) Origin）。
→ 演示机上要连公网校园后端，就用 `MOCHI_CAMPUS_API_URL=<origin> open -a Mochi`，**不要去改 `runtime-profile.json`**。
| 失败呈现 | `main.ts:272-299` | 只显示诊断码（`WEB_HOST_RUNTIME_MISSING` / `TIMEOUT` / `EXITED` / `START_FAILED`） |

### 1.1 🔴 已实测的更正：`NODE_PATH` 对 ESM 插件解析**无效**

`web-host.ts` 会注入 `NODE_PATH=<runtimeNodeModules>`，但实测：

```
node --input-type=module -e "import('mochi-hello')"   → ERR_MODULE_NOT_FOUND
node -e "require.resolve('mochi-hello')"              → 成功
```

ESM 解析**不看 NODE_PATH**。插件能被加载，靠的是另一套机制（见 §2）。
→ **不要再试图通过调 `NODE_PATH` 去修「插件找不到」的问题**，那条路是死的。

### 1.2 三处「插件来源」的现行状态

| 来源 | 内容 | 运行时是否生效 |
|---|---|---|
| `plugins/` + `client-plugins/`（源码） | 最新 | **dev 生效**：`.mochi-home.nosync/profiles/*/node_modules/<name>` 全部软链到源码树 |
| `apps/desktop/.mochi-package-resources-v1.nosync/`（暂存） | 每次打包由 `prepare-mochi-resources.cjs` 重生成 | 否，仅打包输入（`build.extraResources` 把它拷成包内 `Resources/mochi`） |
| `apps/desktop/node_modules/<name>`（vendor tgz 装的副本） | **不是插件来源**：只供依赖闭包与打包取材，且**已与源码分叉** | 否（除作为 `NODE_PATH` 的无效目标） |

⚠️ 因此「改了源码就等于改了包」是**错的**：包里的插件来自暂存目录，而暂存目录来自**白名单里逐文件拷贝**。
白名单在 `prepare-mochi-resources.cjs` 的 `PLUGINS`（当前 26 个）；漏登记的文件不会进包，
且**只有 `test-package-resources.mjs` 会拦**（它跑 import 闭包断言）。

---

## 2. dsh 侧到底怎么找到插件

- 生成器为每个 profile 写 `profiles/<name>/package.json`，其中 `dependencies: { "<插件名>": "link:<绝对路径>" }`（`runtime-profile.cjs:407-437`）。
- 同时建 `profiles/<name>/node_modules/<插件名>` → 软链到插件目录（`ensurePluginLink`，`:363-385`；每次启动幂等重建）。
- `cordis.patch.yml` 里写 `- insert: - id: X / name: X`，dsh 的 plugin-loader 以 **profile 目录为 baseUrl** 去 import 这个名字（`@deepseek-ai/cordis-plugin-loader/lib/index.js:270-283`）。
- 这就是为什么必须传 `--expose-internals`。
- 解包路径：dev 用 `workspacePath`，打包用 `resourcePath`（`resolvePluginTarget`，`:439-448`）。

⚠️ **软链写的是绝对路径**：App 装好后再被移动（例如从 DMG 直接运行、或换目录），软链会断，
表现为只剩一个 `WEB_HOST_START_FAILED` 诊断码。**移动 App 后请重新启动一次让它重建软链**。

---

## 3. 三个 home 与角色契约

| 目录 | 用途 |
|---|---|
| `<workspace>/.mochi-home.nosync` | **开发态** 教师角色 |
| `~/.mochi-home` | **打包态** 教师角色 |
| `<workspace>/.mochi-classroom-home.nosync` | 开发态教室角色（打包态为 `~/.mochi-classroom-home`） |

解析顺序（`electron/dsh/profile.ts:43-56`）：`DSH_HOME` > `MOCHI_RUNTIME_HOME` > 按是否打包选上表之一。
⚠️ **父 shell 里若已有 `DSH_HOME`（例如 DSH 自身的 `~/.dsh`），会劫持 profile 落盘位置**——2026-09-12 的只读侦察就真的把 Mochi 的三个 profile、`presets-visible/` 与角色标记写进了 `~/.dsh`。
**正确姿势**：在可能带 `DSH_HOME` 的终端里启动 Mochi，统一用

```bash
env -u DSH_HOME ./mochi.sh --profile mochi-web --port 3090 --no-open
```

或显式给 `MOCHI_RUNTIME_HOME`。另外 `~/.dsh/profiles/node_modules.lock`（`66154\n`，2026-09-04 的陈旧锁）会让以该 home 启动的 dsh 直接报 `atomic-write: timed out waiting for the writer lock`——**这是环境地雷，不是代码问题**。

角色标记文件（`runtime-profile.cjs:586-601`）**硬绑定**：非空 home 不允许换角色复用；
两个角色的数据完全隔离（教室端读不到教师密钥/记忆/会话）。

| | teacher | classroom |
|---|---|---|
| 默认预设 | `lesson-planning` | `classroom` |
| 预设根 | 打包：`Resources/mochi/teacher-agent-presets` | `classroom-agent-presets`（相对资源根） |
| 官方/用户预设根 | 都挂载 | 都不挂载 |
| 插件白名单 | 全量 | 只 8 项：hello / llm-mimo / knowledge / jxl-theme / jxl-brand / workbench / lan / lan-client |
| 白名单实现 | `profileForRole()`，只能做减法，越界即 throw |

---

## 4. 插件与工具的注册契约

- 插件入口必须 `export const name` + `export function apply(ctx)`；可选 `export const inject`。
- 工具：`import { defineTool } from '@deepseek-ai/dsh-tools'` → `ctx.tools.register(defineTool({...}))`。
- **工具名不得含点号**（网关只接受 `^[a-zA-Z0-9_-]+$`）；带点号会让整轮请求 400。守卫：`test-package-resources.mjs` 的 `assertModelFacingToolNames` + `scripts/check-skill-tools.mjs`。
- 插件之间可以互相 import（如 `@mochi/pdf-layout`），靠各自 `node_modules` 软链；**跨插件硬依赖没有声明机制**，加载顺序也不保证。

---

## 5. 出包链路（唯一路径）

```
npm run dist:mac:arm64  (apps/desktop)
  └ package-desktop.cjs
      ① 参数/交叉编译校验 assertNativeTarget
      ② check-dsh-host-peers.cjs（dsh peer 契约）
      ③ seed-packaging-keys.cjs → resources/mochi-web/seeds/*.json（0600；无密钥源则 warn 退 0）
      ④ prepare-release-input.cjs → .mochi-release-staging.nosync/（记录源 git HEAD + dirty + 每文件 sha256）
      ⑤ npm run build → dist-electron/
      ⑥ electron-builder
           beforePack → prepare-mochi-resources.cjs（生成 .mochi-package-resources-v1.nosync/）
           files: dist-electron + package.json；asarUnpack: node_modules/**
           extraResources: .mochi-package-resources-v1.nosync → Resources/mochi
      ⑦ 断言安装器存在且 mtime ≥ 开建时间
```

快照清单：`.github/windows-native-package-inputs.json`（492 条）由 `scripts/reconcile-snapshot-manifest.mjs --write` 收敛，
`scripts/check-snapshot-manifest.mjs [--fail]` 校验（**不带 `--fail` 永远 exit 0**，CI 里目前是报告模式）。

⚠️ **密钥是设计上随包分发的**（作者 2026-09-12 决策，见 `docs/DECISIONS.md`）：`seeds/credentials-seed.json`
会被打进安装包，任何拿到安装包的人都能解出这两枚 key。**不要**把它当缺陷去"修"掉注入逻辑；
要改的是密钥本身的发放策略（用官方 key、可轮换、限额）。

---

## 6. 已知的机制性风险（2026-09-12 实测，未修）

| # | 风险 | 证据 |
|---|---|---|
| 1 | 包内 `runtime-profile.cjs` 与源码有代差：9/11 包内无 `presets-visible`（源码 3 处命中）→ 教师包把 standard/ptc/minimal 预设也暴露出去 | 包内文件 vs 源码 grep |
| 2 | 9/11 包只含 20 个插件，缺 `mochi-files/sheets/visuals/modes/modes-client/task-scheduler` | 包内 `Resources/mochi/plugins` 列表 |
| 3 | `apps/desktop/node_modules` 里的插件副本是 9/8 的，注册的是**带点**旧工具名（43 处） | 该目录 vs 源码 diff |
| 4 | profile 软链是绝对路径，移动 App 后需重启重建 | `ensurePluginLink` |
| 5 | 干净克隆装不上：`package.json` 引用的 `vendor/local-plugins/*.tgz` 有 14 个未入 git | `git cat-file -e origin/main:<path>` 逐条 ABSENT |
| 6 | 🔴 **本机打包态教师的 home 依赖构建树，且已经是断链状态**：`~/.mochi-home/profiles/*/node_modules/*` 全部指向 `apps/desktop/release/mac-arm64/Mochi.app/Contents/Resources/mochi/plugins/*`；实测 `mochi-hello` 存在、**`mochi-sheets` 已是断链**（9/11 包里没有它） | `ls -l ~/.mochi-home/profiles/*/node_modules/` + `[ -e ]` 探测 |

> ⚠️ **由此得到的两条操作纪律**：
> 1. **不要为了省磁盘删掉 `apps/desktop/release/mac-arm64/`** —— 那份 `Mochi.app` 既是台账里的证据，也是本机打包态 home 的软链目标；删了会把 home 打成全断链，再启动只会看到一个 `WEB_HOST_START_FAILED` 诊断码。（`failed-bundle-*` 与它无关，可以删。）
> 2. 当前生产 home 处于**混合状态**（profile 声明 26 个插件、包内只有 20 个）——若直接用 `release/.../Mochi.app` 启动，某些插件解析不到。**要干净复现请用 DMG 装到 `/Applications` 后再跑**，别在这个混合 home 上做演示验收。

---

## 7. 怎么用本文

- 改代码前：先读本文 §1/§2，确认你要改的是「真正生效的那一份」。
- 发现本文与源码不符：**改本文**，并在提交说明里写清哪一条被推翻。
- 本文不记录产品设计、排期、交付状态——那些分别看 `Mochi-总体方案.md`、`docs/tasks/MOCHI-URGENT-REPLAN-2026-09-11.md`、`docs/DELIVERY-LEDGER.md`。
