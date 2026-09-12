# MOCHI-WIN-PICKER-FIX-01 — Windows「无法选择工作区」根因与修复

- 日期：2026-09-11（晚）
- 触发：实机反馈 —— Windows 安装包安装正常，但点「选择工作区」直接报错
- 报错原文：`directory picker failed: directory picker failed: win32 folder dialog worker exited before reporting a result`
- 归属线：工具线（诊断 + 修复 + 测试）；出包由主控线按 §3.2 热修 / §3.1 重出包

---

## 1. 故障点定位（精确到函数）

| 层 | 位置 | 作用 |
|---|---|---|
| 客户端外层前缀 | `@deepseek-ai/dsh-client-ui-workspace/src/client/navigation.ts` | UI 再包一层 "directory picker failed: " |
| 宿主外层前缀 | `packages/api/workspace-controller/src/directory-picker.ts` → `cancellableFailure(..., 'directory picker failed')` | Remote 错误投影 |
| **真正抛点** | `packages/host/directory-picker-native/src/win32-dialog.ts:153-157` | `worker.on('exit')` → `reject(new Error('win32 folder dialog worker exited before reporting a result'))` |

含义：**不是对话框打开失败，而是宿主连对话框都没打开**。win32 交互会 spawn 一个子进程
`@deepseek-ai/dsh-host-directory-picker-native/lib/worker.cjs`，由它在子进程里用 koffi 调
`IFileOpenDialog`；该子进程**没有发出任何 IPC 消息就退出**（既没有 `showing`，也没有 `error`），
宿主只能报这句。

## 2. 已核实的事实（先排除掉的方向）

| 猜测 | 证据 | 结论 |
|---|---|---|
| 安装包漏了 worker.cjs | 7z 解 `release/2026-09-10/Mochi-Setup-0.1.0-win-x64.exe`：`resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/worker.cjs`（9488 B）存在 | 排除 |
| 安装包漏了 koffi 原生二进制 | 同包内 `node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node`（1,036,800 B）存在 | 排除 |
| spawn / IPC / run-as-node 继承机制坏了 | 本机用打包态 `Mochi` 二进制复现两级链（Electron-as-node 宿主 → `spawn(process.execPath,[worker.cjs],{ipc})`）：子进程正常回报（macOS 上回报的是 ole32 加载失败，恰好证明链路通） | 机制通 |
| app.asar 内路径不能被子进程启动 | 实测把 worker 路径换成 `.../app.asar/.../worker.cjs` 也能被 run-as-node 子进程执行 | 排除 |
| 上游这条路径有 Windows 覆盖 | 上游 `packages/host/directory-picker-native/tests/built-worker.e2e.ts` 明确 `skipIf(... process.platform === 'win32')`；注记 `2026-08-04-drop-windows-powershell-picker-fallback.md` 已删除 PowerShell 兜底（"koffi tier 失败就如实暴露"） | **上游从未在真 Windows 验证过，且没有第二档** |

→ win32 原生交互是「单点、不可回退、真机未验证」的路径。今天没有可调试的 Windows 机器，
**不拿演示去赌它**。上游在本行上方留了授权做法：
> Mount -native or -browse directly in an overlay to pin the interaction.

（出处：`@deepseek-ai/dsh-web-app/cordis.patch.yml` `- id: directory-picker` 上方注释）

## 3. 修复

### 3.1 源码修复（已落地；下次 CI 出包生效）

`apps/desktop/resources/mochi-web/runtime-profile.cjs` 新增 `resolveDirectoryPickerPin()`：
在 **win32** 生成受管 patch 时追加「关掉自适应行 + 挂 browse 双面」：

```yaml
- id: directory-picker
  disabled: true

- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-surface
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

- 开关：`MOCHI_DIRECTORY_PICKER=auto|browse|native`
  - 未设 / `auto`：**win32 钉 browse**，其余平台保持上游自适应（macOS 仍是系统对话框）
  - `browse`：任何平台强制钉 browse（用于复现/验证）
  - `native`：不钉，完全交回上游
  - 其它值：启动即报错（不静默）
- 只对 `mochi-web` profile 生效（`headless` / `mochi` 不带 web bundle，已断言不生成）。
- 两个 browse 包本来就是 `dsh-web-app` 的既有依赖，Windows 包里都已存在，**不需要新依赖、不需要带原生二进制**。

### 3.2 已装应用热修（今天就能用，不用重出包）

目标文件（装到哪一档看安装位置，二选一）：

```
%LOCALAPPDATA%\Programs\Mochi\resources\mochi\profile\patches\web.patch.yml
%ProgramFiles%\Mochi\resources\mochi\profile\patches\web.patch.yml
```

在该文件**末尾**追加 §3.1 那段 YAML → **完全退出 Mochi（含托盘图标）** → 重新启动 → 再点「选择工作区」。

生效原理：宿主每次启动都会走 `prepareDshHome()`（`apps/desktop/electron/dsh/profile.ts`），
用该模板重算 `~/.mochi-home/profiles/mochi-web/cordis.patch.yml` 的受管区块 —— 改模板即生效，不需要删 home。

一键脚本：`scripts/fix-windows-directory-picker.ps1`（幂等；先备份为 `web.patch.yml.bak-<时间戳>`）。

## 4. 验证证据（本地）

- `apps/desktop/scripts/test-runtime-profile.mjs` 新增断言：默认（非 win32）不钉 / `MOCHI_DIRECTORY_PICKER=browse` 钉死 / `=native` 交回 / 非法值报错 / `headless`·`mochi` 不带该行。
  - 实跑（2026-09-11 当时）：`node scripts/test-runtime-profile.mjs` → **PASS**（⚠️ 2026-09-12 19:4x 复验：该脚本**现为 FAIL**，原因是 mimo 模型清单 `deepStrictEqual` 不符，与本工单改动无关。）
  - **负向对照**：临时把钉死条件改成恒假 → 测试 FAIL（命中新增断言）→ 已还原并复跑 PASS。断言真的在跑。
- `--dump-config` 实际组合树（`DSH_HOME=/tmp/mp-browse`）：`- id: directory-picker` 带 `disabled: true`，且 `directory-picker-browse` / `directory-picker-browse-surface` 两行出现。
- 安装包比对：`Mochi-Setup-0.1.0-win-x64.exe` 内的 `resources/mochi/profile/patches/web.patch.yml` 与工作区模板**逐字节一致**（653 B）→ 热修说明对该包精确适用。
- CI 快照清单已同步：`.github/windows-native-package-inputs.json` 两个被改文件重算 sha256，
  `expectedFileBytes` 91,222,898 → **91,228,625**（**2026-09-11 当时值**；现行清单为 491 文件 / **91,832,006 B**，且已有 11 处漂移，见 `docs/build-standard.md` §2.2）。不改会导致 Windows CI 在快照校验步骤直接失败。

## 5. 未定性 / 后续

- **原生 tier 的真实根因仍未定性**。候选（按可能性）：
  1. worker 子进程没继承 `ELECTRON_RUN_AS_NODE` → 变成 GUI Electron → 撞单实例锁 → 静默退出（现象完全吻合）；
  2. koffi / COM 在子进程里硬崩（`CoInitializeEx` / `CoCreateInstance` 阶段，早于 `showing`）；
  3. Windows 上 IPC 消息与 `exit` 事件的竞态（driver 没有宽限期，`exit` 一到就 reject）。
- 要真修需要在 Windows 上抓到 worker 子进程的 stderr —— 当前 driver 把子进程 stderr 设为 `inherit` 且 Windows GUI 进程无控制台，输出直接丢失。下一版可给 driver 打 `[Mochi patch]`：
  ① 显式传 `ELECTRON_RUN_AS_NODE=1`；② 收集 stderr 并写进错误文本；③ `exit` 后加 ~300ms 宽限期再 reject。
  这三条命中即修，但**没有 Windows 真机验证前不作为演示依赖**（browse 钉死才是保底）。
- 观感变化（需知会用户）：钉 browse 后 Windows 上「选择工作区」是**应用内目录浏览器**（面包屑 + 新建目录），
  不再是系统文件夹对话框。功能等价，这是上游在 Linux / 远程场景下的默认交互。

## 6. 本机环境备注（与本次故障无关，但会挡验证）

`apps/desktop/node_modules/fs-ext/build/Release/fs_ext.node` 当前是 **x86_64**，在 arm64 上
`dlopen` 直接失败（`incompatible architecture`），导致本机 `./mochi.sh`（dev 宿主）起不来。
修法：重装/重建该原生模块（`env -u NODE_OPTIONS <node> <npm-cli.js> rebuild fs-ext`，见 2026-09-11 记忆里的沙箱绕法）。
