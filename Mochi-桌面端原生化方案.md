# Mochi 桌面端原生化方案（完整版）

> **目标**：两个端，共享同一个 Mochi 内核——
> **老师端**（教师办公电脑，双击即用）+ **教室端**（教室多媒体大屏，课堂现场用）。
> **学生端本期不做**（学生不带手机，没有落点）。
> **状态**：**待批准**。本文只做诊断与方案设计，未改动任何代码，未执行打包。
> **日期**：2026-09-06（2026-09-06 晚增补双端划分，见第 24 章）
> **已拍板决策**：① 免签名 + 一键安装脚本 ② 内置默认密钥 + 设置页可改 ③ Mac 双架构 + Windows ④ 内置公共 SearXNG 端点

---

## 一、现状诊断

### 1.1 桌面壳本身不依赖浏览器，出问题的是"命令入口"

| 环节 | 证据 | 说明 |
|---|---|---|
| 桌面壳已内嵌服务 | `apps/desktop/electron/dsh/web-host.ts:51-52` | 主进程 spawn dsh，硬编码 `--no-open`，拿到地址后 `main.ts:86` `window.loadURL()` 载入**自己的窗口** |
| 但脚本入口会抢跑 | `packages/bundle/web-app/src/startup.ts:52`，`Config.openBrowser` 默认 `true`，`src/index.ts:238/283-287` | 不传 `--no-open` 时，dsh **立刻**用系统浏览器打开地址，此时服务尚未 ready |
| `mochi.sh` 没关掉它 | `mochi.sh:97-111` | 只传 `--profile`，没有 `--no-open`，也没有固定端口（默认 3080，而开发脚本用 3090） |
| 浏览器不会等服务 | `web-host.ts:8` `READY_TIMEOUT_MS = 90_000` | 冷启动最坏可到 90 秒，浏览器不可能等这么久 |

**结论**：老师看到的"弹浏览器 → 无法访问"，是 `openBrowser` 默认开启 + 服务未就绪的组合，不是桌面壳的缺陷。桌面壳路径天然不会弹浏览器。

### 1.2 不需要操心的两件事

- **免登录**：dsh 的 401 是自带设计（`client/connection/src/browser-auth.ts`），全仓无关闭开关。但桌面端抓的是带 `?token=` 的就绪地址（`web-host.ts:15-25`），`BrowserWindow` 载入即视为已认证，**老师不需要登录**。认证不必关，也关不掉。
- **符号链接不会在打包后失效**：`prepare-mochi-resources.cjs` 用 `cpSync(..., { dereference: true })`（L107-118），staging 后 `assertNoSymlinks()`（L138-145）强校验；运行时由 `runtime-profile.cjs:149-171` `ensurePluginLink()` 在 home 目录新建链接。asar 不参与。

### 1.3 必须先修的四个阻断项

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| A | **打包白名单漏 3 个插件** | `prepare-mochi-resources.cjs` 的 `PLUGINS` 只有 9 个（09-06 01:49），`runtime-profile.json` 已声明 12 个（09-06 11:24）；缺 `mochi-web-search`、`mochi-llm-mimo`、`dsh-better-sidebar`；`test-package-resources.mjs:191` 硬断言 `===9` | **打包版起不来**（插件目录不存在 → `requireDirectory` 抛错），测试也会失败 |
| B | **无品牌图标** | `apps/desktop/` 下无 `.icns`、无 `.ico`、无 `build/` 图标目录 | 打包出来是 Electron 默认图标，Dock 里看着就不像正经应用 |
| C | **打包 profile 资源疑似为空** | `.mochi-package-resources-v1.nosync/profile` 当前是空目录；而 `profile.ts:37` 打包后要求 `resources/mochi/profile/runtime-profile.cjs` 存在，否则 `prepareDshHome()` 抛"runtime profile 脚本不存在" | 若属实，打包版**必然**启动失败。阶段 0 第一件事就是验证 |
| D | **联网搜索依赖本机 8888** | `mochi.sh:31` 默认 `MOCHI_SEARXNG_ENDPOINT=http://127.0.0.1:8888/search` | 老师机器上没有本地 SearXNG，搜索直接失效 |

### 1.4 三个体验坑

1. **窗口要等服务才出现**：`main.ts:28` `show: false` + `:37` `ready-to-show` 才显示 → dsh 未就绪时窗口**完全不出现**，老师以为"点了没反应"。
2. **冷启动耗时零实测**：全仓无任何计时记录，只有 90 秒超时上界。不实测就无法承诺"不用等"。
3. **失败信息不可读**：`main.ts:59-63` 的错误页是一段英文技术消息的 data URL，老师看不懂，也没有任何可执行的下一步。

### 1.5 两个环境约束

- **Electron 39.8.10 要求 macOS ≥ 12.0**（`node_modules/electron/dist/Electron.app/Contents/Info.plist` 的 `LSMinimumSystemVersion`）。老师若是 2016 年前的 Mac（最高 macOS 11），**装不上**。需确认老师机型；若要支持更老系统，得降级 Electron（代价大）。
- 打包脚本 `package-desktop.cjs:62-71` `assertNativeTarget()` **硬性拒绝跨平台构建**：arm64 机器只能出 arm64 包。

---

## 二、目标形态与验收标准

### 2.1 老师视角的完整路径

1. 拿到一个 U 盘（或校内共享盘上的 zip）
2. 双击「安装 Mochi」→ 弹出中文对话框向导，一路"继续"
3. 启动台双击 Mochi → **1 秒内出现窗口**（品牌启动页 + 中文进度）
4. 十几秒内窗口原地换成 Mochi 界面，可以直接提问
5. 全程：无浏览器、无终端、无登录框、无输入框

### 2.2 量化验收标准

| 项 | 标准 | 判定方式 |
|---|---|---|
| 首窗出现 | 双击后 ≤ 1.5 秒 | 秒表 |
| 可用总时长 | 冷启动 ≤ 15 秒（实测后回填；做不到则单独立项优化） | 日志埋点 |
| 浏览器出现次数 | **0** | 人工 |
| 老师操作数 | 1（双击安装）+ 1（双击应用） | 人工 |
| 失败可读性 | 中文原因 + 一键复制日志 + 重试 | 人工 |
| 干净机验收 | 从未装过 Mochi 的机器全流程走通 | 人工 |

---

## 三、总体架构与目录布局

### 3.1 架构（保持不变，只补体验与分发）

```
Mochi.app（Electron 主进程）
├── 立即创建窗口 → 载入内置 boot.html（品牌启动页 + 进度）
├── 并行：环境自检（Preflight，≤5s 超时降级）
├── DshWebHost：spawn dsh --profile mochi-web --port 0 --no-open
│     └── 抓 "dsh web: <url>?token=…" → loadURL（免登录）
└── 资源：Contents/Resources/mochi/{profile,plugins,skills,node_modules,campus}
```

### 3.2 目录布局（打包后）

| 用途 | macOS | Windows |
|---|---|---|
| 应用 | `/Applications/Mochi.app` | `%LOCALAPPDATA%\Programs\Mochi\Mochi.exe` |
| 运行时 home（配置/会话/密钥/数据库） | `~/.mochi-home` | `%USERPROFILE%\.mochi-home` |
| App 数据 | `~/Library/Application Support/Mochi` | `%APPDATA%\Mochi` |
| 日志 | `~/Library/Logs/Mochi/` | `%USERPROFILE%\AppData\Roaming\Mochi\logs\` |

> 开发时 home 是工作区 `.mochi-home.nosync`（`profile.ts:30-33`）；打包后走 `~/.mochi-home`，两者互不干扰。

---

## 四、安装引导设计

### 4.1 载体选型

| 载体 | macOS 表现 | 结论 |
|---|---|---|
| **zip + 安装脚本（推荐）** | 脚本用 `osascript` 弹原生对话框，不依赖终端可读性 | 采纳 |
| dmg | 打开 dmg 不触发 Gatekeeper，但里面 app 双击仍需处理隔离属性 | 可作为附加产物 |
| pkg | 未签名 pkg 双击同样被拦，且需 `installer` 命令，摩擦更大 | 不采纳 |
| Electron 写的安装器 | 自身也要过 Gatekeeper，鸡生蛋 | 不采纳 |
| **NSIS（Windows，已配置）** | `package.json` 已配 `nsis.oneClick:false`，天然是一步步向导 | 沿用，补中文与完成页 |

### 4.2 macOS 安装向导（`安装 Mochi.command`）

双击后全程用**原生对话框**（`osascript -e 'display dialog …'`），不要求老师看懂终端：

| 步 | 内容 | 失败处理 |
|---|---|---|
| 1 欢迎 | 「将把 Mochi 安装到「应用程序」，需要约 300 MB。继续？」 | 取消即退出 |
| 2 环境检查 | 系统 ≥ 12.0、磁盘剩余 ≥ 2 GB、`/Applications` 可写、Mochi 未在运行 | 弹中文原因并中止 |
| 3 旧版处理 | 若已存在旧版：提示「将替换旧版，你的数据与设置会保留」 | 取消即退出 |
| 4 安装 | `rm -rf` 旧版 → `cp -R` 新版 → `xattr -cr` 清隔离 → `codesign --force --deep --sign -` ad-hoc 签名 | 显示失败原因 + 日志路径 |
| 5 完成 | 「安装完成。现在打开 Mochi？」→ `open -a Mochi` | — |

同时创建桌面/程序坞快捷方式由老师自行拖拽（避免额外权限请求）。

### 4.3 隔离属性（quarantine）的真相 —— 决定成败的细节

- 从**浏览器 / QQ / 微信 / 网盘**下载的文件会被打上 `com.apple.quarantine`
- 未签名 app + quarantine = 「Mochi 已损坏，无法打开」或「来自身份不明的开发者」
- `xattr -cr` 可解；**但 `.command` 脚本自身也会被隔离**，同样打不开 → 无法自举

**结论：分发渠道决定有没有摩擦。**

| 渠道 | 是否带隔离属性 | 老师体验 |
|---|---|---|
| **U 盘 / 校内 SMB 共享盘拷贝** | **不带** | 双击即用，真正零摩擦 ✅ |
| 微信 / QQ / 浏览器下载 | 带 | 需要一次"右键 → 打开"（或先跑一次修复脚本）⚠️ |

**主推 U 盘与校内共享盘分发**；若必须走网络传输，附一页图文说明（截图 + 三步）与一个"修复.command"。
> 若将来想要"任何渠道都零摩擦"，唯一办法是 Apple Developer ID 签名（¥688/年）。

### 4.4 Windows 安装（NSIS）

- 向导步骤：中文 → 许可 → 安装目录（默认 `%LOCALAPPDATA%\Programs\Mochi`）→ 开始菜单/桌面快捷方式 → 安装 → 完成页（默认勾选"运行 Mochi"）
- **SmartScreen**：未签名 exe 首次运行弹蓝框「Windows 已保护你的电脑」→ 需点「更多信息」→「仍要运行」（一次性）
- **Defender 误报**：Electron 应用偶发被拦，需在说明里提示"允许一次"

---

## 五、首次运行向导（应用内）

应用内首启流程（仅在 `~/.mochi-home` 首次创建时出现，之后不再打扰）：

| 步 | 内容 | 可否跳过 |
|---|---|---|
| 1 欢迎 | Mochi 主视觉 + 「我是 Mochi，专注校园工作的 AI 智能体」 | 否 |
| 2 环境自检 | 自动跑一遍第四节的自检，逐项打勾（全部通过则自动跳到下一步） | 自动跳过 |
| 3 身份设置 | 姓名 / 任课班级 / 角色（班主任、校医、宿管、年级主任…） | 可跳过（默认班主任） |
| 4 校园服务登录 | 供校园面板使用，**只需登录一次**（凭据持久化，服务重启不失效） | 可跳过（之后在设置里补） |
| 5 完成 | 「可以开始问我了」→ 进入主界面 | — |

> Mochi 本体**不需要登录**（token 已随启动地址注入）；第 4 步是校园数据服务自己的登录，两者不要混为一谈。

---

## 六、环境自检（Preflight / Mochi 医生）

### 6.1 时机与原则

- 与 dsh 启动**并行**执行，**总超时 5 秒**，超时项按"警告"处理，绝不拖慢启动
- 结果写日志；只有**阻断项**才打断启动并弹中文提示
- 设置页常驻「重新检测」入口

### 6.2 检查项清单

| 检查项 | 方法 | 通过标准 | 阻断 | 失败文案（老师可见） |
|---|---|---|---|---|
| 系统版本 | `process.getSystemVersion()` | macOS ≥ 12 / Windows ≥ 10 | 是 | 你的系统版本过低，Mochi 需要 macOS 12 以上 |
| 架构 | `process.arch` | 与打包架构一致 | 是 | 这个安装包不适用于这台电脑，请换另一个安装包 |
| 磁盘空间 | `statfs` / `GetDiskFreeSpace` | 剩余 ≥ 2 GB | 是 | 磁盘空间不足，请至少留出 2 GB |
| 家目录可写 | 试写临时文件后删除 | 成功 | 是 | 没有写入权限，请更换用户账户或联系管理员 |
| 回环网络 | 监听随机端口并自连 | 成功 | 是 | 本机网络异常，请检查防火墙或安全软件 |
| 系统时间 | 与内置 NTP 基准比对 | 偏差 < 5 分钟 | 否（警告） | 系统时间不准确，可能导致联网失败，请开启自动同步 |
| 模型服务可达 | `HEAD https://mimo.ezlook.top/v1` | 有响应（含 401） | 是 | 连不上模型服务，请检查网络或代理设置 |
| 密钥有效 | 最小 chat 请求 | 非 401/402 | 是 | 密钥无效或额度已用尽，请在设置里更换 |
| 校园服务可达 | `GET .../api/health` | 200 | 否（降级） | 校园服务暂时连不上，校园面板功能暂不可用 |
| 搜索端点 | 逐个探测内置候选实例 | 至少一个可用 | 否（降级） | 全网搜索暂时不可用，已切换为学术与校园数据 |
| 代理干扰 | 读 `HTTP(S)_PROXY` | 无或可达 | 否（警告） | 检测到系统代理，可能影响联网 |

### 6.3 诊断报告（Mochi 医生）

- 设置页一键「导出诊断报告」→ 保存 `Mochi-诊断报告-<日期>.txt` 到桌面
- 内容：版本号、系统版本、架构、磁盘、网络探测结果（域名 + 状态码 + 耗时）、最近 200 行日志
- **强制脱敏**：密钥、token、Cookie、手机号、身份证一律替换为 `***`

---

## 七、启动时序与状态机

| 时刻 | 动作 | 可见文案 | 超时与降级 |
|---|---|---|---|
| T+0 | 进程启动 | — | — |
| T+0.8s | 窗口出现，载入 `boot.html` | 「Mochi 正在启动」 | 若 2 秒未出现，检查单实例锁 |
| T+0.8s | 并行：自检 + spawn dsh | 「正在检查环境」「正在启动内核」 | 自检 5s 超时转警告 |
| — | 等待就绪地址 | 「正在加载模型与技能」 | 90s 超时进失败页 |
| T+n | `loadURL(tokenUrl)` | 原地换成 Mochi 界面 | 载入失败可重试一次 |

**单实例锁**：`app.requestSingleInstanceLock()`，二次启动聚焦已有窗口（避免端口与数据库争用）。
**托盘**：Mac 关闭窗口不退出，托盘图标可取「打开 / 重启内核 / 退出」；Windows 关闭即最小化到托盘。
**退出**：`before-quit` 确保 dsh 子进程回收（`web-host.ts:109-112` 已有）。

---

## 八、失败处理矩阵

| 失败点 | 用户可见文案 | 可执行动作 |
|---|---|---|
| dsh 未就绪（超时） | 内核启动超时，可能是插件或配置问题 | 重试 / 查看日志 |
| 端口或回环异常 | 本机网络端口被占用或被安全软件拦截 | 重试 / 复制日志 |
| 密钥失效 | 模型密钥无效或额度用尽 | 打开设置换 key |
| 网络不通 | 连不上模型服务，请检查是否连接校园网、是否开了代理 | 重试 / 网络诊断 |
| 校园服务不可达 | 校园服务暂时连不上，其他功能不受影响 | 继续使用（非阻断） |
| 资源缺失（打包缺口） | 安装不完整，请重新安装 | 重新安装 |
| 未知错误 | 出错了 + 错误摘要 | 复制日志 / 重启 / 重装 |

错误页统一三个按钮：**重试 / 复制日志 / 重装指引**。

---

## 九、设置页清单

| 分组 | 项 |
|---|---|
| 模型 | 默认模型（mochi-mimo / 智谱）、推理档位（关闭/低/中/高/极高）、密钥（显示 `***`，可改） |
| 搜索 | 搜索端点（自动择优 / 手动指定）、学术源开关 |
| 身份 | 姓名、班级、角色、校园服务登录状态与退出 |
| 常规 | 开机自启、关闭行为（最小化到托盘 / 退出）、语言（仅中文） |
| 数据 | 数据目录（打开文件夹 / 迁移 / 备份导出 / 导入） |
| 诊断 | 环境自检重跑、导出诊断报告、查看日志、日志级别 |
| 关于 | 版本号、dsh 版本、Electron 版本、许可与隐私说明 |
| 更新 | 「检查更新」（本期预留，不做自动更新） |

---

## 十、日志与诊断规范

- 路径：macOS `~/Library/Logs/Mochi/mochi.log`；Windows `%APPDATA%\Mochi\logs\mochi.log`
- 轮转：单文件 5 MB，保留最近 5 份
- 内容：启动各阶段耗时、dsh 子进程 stdout/stderr、自检结果、错误堆栈
- **脱敏规则**：`sk-*`、Bearer token、`?token=`、Cookie、手机号、身份证 → `***`
- **不上传任何数据**（遥测已在 `main.ts:14` 与 `web-host.ts:70` 关闭 `DSH_TELEMETRY_DISABLED`）

---

## 十一、数据与隐私

- 密钥存 `~/.mochi-home/.credentials.yaml`，**打包期注入、不进仓库**，文档与仓库只留占位符
- 校园数据只在本机与校内服务之间流转，不出校
- 会话、审批记录、任务数据全部本地 SQLite
- ⚠️ **现状隐患**：`WORKLOG.md` 与部分日志里明文留有登录 token，动手前应先清理

---

## 十二、升级 / 重装 / 卸载 / 迁移

| 场景 | 行为 |
|---|---|
| 覆盖安装 | 提示先退出运行中的 Mochi；替换 app，`~/.mochi-home` **完整保留**（配置、会话、校园登录态） |
| 版本升级 | 语义化版本；若 home 结构变更，先备份 `~/.mochi-home.bak-<日期>` 再迁移 |
| 卸载 | 卸载脚本：删除 app + 询问是否删除 `~/.mochi-home` 与日志（默认保留数据） |
| 换机迁移 | 设置页「备份导出」打包 `~/.mochi-home` → 新机器「导入」（含校园登录态） |
| 残留清理 | 旧版 `.dsh-home.nosync` / 工作区 `.mochi-home.nosync` 由卸载脚本提示清理 |

---

## 十三、打包与签名清单

| 项 | 现状 | 动作 |
|---|---|---|
| 应用名 / ID | `Mochi` / `cn.jiaxinglian.mochi` | 保持 |
| **图标** | **Mochi 本尊图标不存在**（只有 React 组件，无位图/矢量） | 交专人绘制，规格见**第 23 章**；到位前用占位图标，不阻塞打包 |
| 签名 | `identity: null` | 打包后 `codesign --force --deep --sign -`（ad-hoc） |
| 隔离属性 | — | 打包后 `xattr -cr`，再打 zip |
| 体积 | **713 MB**（arm64 dir 产物） | 裁剪：无用 `*.lproj`、`sharp`/`node-pty` 非目标架构副本、调试符号 |
| 产物 | `dist/mac-arm64/Mochi.app`（无 dmg、无 release） | 产出 `Mochi-<版本>-mac-<arch>.zip` 与 `Mochi-Setup-<版本>-win-x64.exe` |
| 版本 | `0.1.0` | 发布前按语义化版本号递增 |

---

## 十四、多平台构建策略

`package-desktop.cjs:62-71` 强制原生构建，**arm64 机器打不出 x64 包**。

| 优先级 | 目标 | 方案 | 说明 |
|---|---|---|---|
| **1** | **Windows x64** | GitHub Actions `windows-latest` 或借一台 Windows 机器 | **教室端（教室多媒体大屏）是 Windows，这是主战场**；`runtime-profile.cjs:169` 的 junction 分支、node-pty 都只在 Windows 走到，**从未验证过**，风险必须正面扛 |
| 2 | macOS arm64 | **本机直接打** | 老师端主力（教师办公 Mac），最快出成果 |
| 3 | macOS x64 | GitHub Actions `macos-13`（Intel runner）或借一台 Intel Mac | 老师端补充；`sharp`/`node-pty` 需原生 rebuild |

> 当前仓库**无 remote、无 CI 配置、有 50 个未提交改动**。走 CI 需要先建远端并推送。
> Windows 从未在本项目验证过，且教室端依赖它 → **必须先在一台真实 Windows 机器上跑通一次**，再谈批量部署。

---

## 十五、文件级改动清单

| 文件 | 现状 | 改动 |
|---|---|---|
| `apps/desktop/scripts/prepare-mochi-resources.cjs` | `PLUGINS` 9 个 | 补 3 个插件 + 各自 `files` 清单 |
| `apps/desktop/scripts/test-package-resources.mjs` | 硬断言 `===9` | 改为"profile 声明集 ⊆ 白名单"的集合断言 |
| `apps/desktop/electron/main.ts` | `show:false` 等待服务 | 立即显示启动页；单实例锁；托盘；升级版错误页 |
| `apps/desktop/resources/mochi-web/boot.html`（新增） | 无 | 品牌启动页 + 中文进度 + 错误页 |
| `apps/desktop/electron/dsh/web-host.ts` | 无计时 | 增加启动耗时埋点 |
| `plugins/mochi-web-search/index.mjs` | 依赖本机 8888 | 内置候选端点 + 健康择优 + 轮换 + 学术源兜底 |
| 新增 `ensureDefaultCredentials()` | 无 | 首次启动写入随包默认密钥（值由打包环境变量注入） |
| 新增自检模块（主进程） | 无 | 第四节 11 项检查 + 诊断报告导出 |
| 新增 `apps/desktop/scripts/install-mac.sh` | 无 | 安装向导（osascript 对话框） |
| 新增 `apps/desktop/scripts/uninstall-mac.sh` | 无 | 卸载 |
| `apps/desktop/package.json` | 无图标配置 | 补 `build.icon`、`mac.icon`、`win.icon`、`nsis` 中文与完成页 |
| `apps/desktop/scripts/package-desktop.cjs` | 无签名/清理步骤 | 打包后 ad-hoc 签名 + `xattr -cr` + zip |

---

## 十六、验收测试矩阵（UAT）

| # | 场景 | 前置 | 期望 |
|---|---|---|---|
| 1 | 干净 Mac（arm64）+ U 盘 | 从未装过、无 quarantine | 双击安装 → 双击应用 → 能提问 |
| 2 | 微信/QQ 下载 | 带 quarantine | 记录摩擦步骤，验证修复脚本有效 |
| 3 | 断网启动 | 拔网线 | 自检报「连不上模型服务」，文案可读，不白屏 |
| 4 | 校园网内 | 校内网络 | 模型服务与校园服务均可达（**前提验证**） |
| 5 | 旧版覆盖 | 已装旧版 | 数据、会话、校园登录态保留 |
| 6 | 标准用户账户 | 非管理员 | 能装能用（学校电脑常见） |
| 7 | 磁盘不足 | 剩余 < 2 GB | 安装前拦截并提示 |
| 8 | Intel Mac | x64 包 | 同场景 1 |
| 9 | Windows 10/11 | x64 包 | NSIS 向导可装，SmartScreen 后能运行 |
| 10 | 已装杀软/管控 | Windows | 记录是否被拦，给出放行说明 |

---

## 十七、风险登记表

| 风险 | 影响 | 对策 |
|---|---|---|
| 打包白名单漂移（已发生） | 打包版起不来 | 改集合断言 |
| **打包 profile 资源为空** | 打包版必然启动失败 | 阶段 0 第一件事验证并修复 |
| **无品牌图标** | 不像正经应用 | 生成 icon |
| Electron 39 要求 macOS 12+ | 老 Mac 装不上 | 确认老师机型；必要时降级 Electron |
| 冷启动超 15 秒 | 老师仍觉得卡 | 先实测，超标再立项 |
| Gatekeeper / SmartScreen | 一次性拦截 | ad-hoc 签名 + U 盘分发 + 图文说明 |
| 校园网不通外网 | Mochi 完全不可用 | **校内实测是前置条件** |
| 公共 SearXNG 不稳 | 搜索时好时坏 | 多实例轮换 + 学术源兜底 |
| 密钥随包泄露 | 额度被盗用 | 已接受；设置页可换 |
| 713 MB 体积 | 分发慢 | 裁剪 |
| Windows 从未验证 | 可能跑不起来 | 放最后单独一轮 |
| 无 remote、50 未提交改动 | 无法回滚、无法 CI | **动手前先提交基线快照** |

---

## 十八、实施顺序（建议）

- **M1（最小可验收）**：阶段 0 修阻断项 → 补图标 → arm64 打包 → 实测冷启动 → 启动页 → 错误页 → U 盘分发 → 干净机验收
- **M2（零配置）**：内置密钥 → 内置搜索端点 → 环境自检 → 首次运行向导 → 设置页
- **M3（多平台）**：x64（CI）→ 体积裁剪 → 安装/卸载脚本完善
- **M4（Windows）**：NSIS 中文向导 → 真机验证

---

## 十九、需要你确认的事项

1. **内置哪个密钥**？MIMO（当前默认）还是智谱，或两者都内置（建议：内置 MIMO 作默认，智谱作为可选路由配置好但不强制）
2. **x64 与 Windows 走 GitHub Actions 还是借实体机**？走 CI 需你同意新建远端仓库与工作流（当前无 remote）
3. **分发渠道**？U 盘 / 校内共享盘（零摩擦）还是微信群（有一次性摩擦）
4. **老师的 Mac 系统版本**？低于 macOS 12 则装不上，需提前排查
5. **是否需要开机自启**？（教师办公场景常见需求）
6. **是否同意动手前先提交一次 git 基线**？当前 50 个未提交改动、无 remote，出问题无法回滚

---

## 二十、动手前的前置动作（批准后第一步）

1. `git add -A && git commit` 提交基线（或至少打一个本地 tag）
2. 在**校园网**下实测一次：`https://mimo.ezlook.top/v1` 与 `https://jyl-campus-health-entry.pages.dev/api/health` 是否可达 —— 若不通，后面全白做
3. 对当前 mochi-web profile 冷启动做一次计时，拿到真实基线数字

---

## 二十一、功能迁移总清单（开发态 → 打包态）

原则：**不接受"打包版不提供某功能"**。每个模块要么随包可用，要么改造到随包可用。
唯一例外是需要真实外网服务（模型 API、校园数据）与需要老师账号（校园登录）的部分。

### 21.1 服务端插件（`plugins/`，10 个）

| 模块 | 能力 | 迁移动作 | 阻塞 |
|---|---|---|---|
| `mochi-dispatch` | 任务状态机 + SQLite 持久化 | SQLite 落 `~/.mochi-home/dispatch/`，首次自动建库 ✅ | 低 |
| `mochi-campus` | 校园数据只读查询 + 登录态 | **必须改为云端 API**（见 22.2）；删掉 `../..` 扫本地 D1 的兜底 | **高** |
| `mochi-grades` | 成绩核验，导出 XLSX | 纯 JS ✅ | 低 |
| `mochi-documents` | 生成 DOCX + PDF | **去掉 `/opt/homebrew/bin/soffice` 硬依赖**，改纯 JS 直出（见 22.3） | **高** |
| `mochi-presentations` | 教案 PPTX + PDF | 同上 | **高** |
| `mochi-office` | OnlyOffice 集成 | **去掉本地 Docker**，改纯 JS 预览（见 22.4） | **高** |
| `mochi-web-search` | 全网 + 学术检索 | 改为内置公共端点（见 22.5） | 中 |
| `mochi-llm-mimo` | MIMO 模型路由 | 随包 ✅，密钥内置 | 低 |
| `mochi-hello` | 挂载自检 | 随包 ✅ | 低 |
| `dsh-better-sidebar` | 右侧栏（文件树/终端/Git/浏览器） | 随包，但 **git 依赖要处理**（见 22.6）；需先产出 `lib/` | 中 |

### 21.2 客户端插件（`client-plugins/`，5 个）

| 模块 | 能力 | 迁移动作 | 阻塞 |
|---|---|---|---|
| `jxl-brand` | 品牌位 + Orb 动画 | 随包 ✅ | 低 |
| `jxl-campus` | `/campus/*` 静态直出 + `/jxl-api/*` 反代 | 校园静态产物随包；**marker 文件必须落地**，否则插件加载即失败 | 中 |
| `jxl-theme` | 设计令牌、字体、品牌图 | 随包 ✅；**字体需内置**（22.7） | 中 |
| `mochi-model-presets` | 模型预设目录 | 随包 ✅ | 低 |
| `mochi-workbench` | 教师工作台 UI | 随包 ✅ | 低 |

### 21.3 技能（`skills/`，7 个）

`mochi`、`teacher-daily-brief`、`weekly-class-report`、`class-meeting-prep`、`student-follow-up`、`student-movement-request`、`teaching-material-find`
→ 全部随包到 `resources/mochi/skills` ✅（`profile.ts:60` 已指向）。**需验证打包脚本确实搬运了全部 7 个**（现有白名单只覆盖 9 个插件，技能未单独校验）。

### 21.4 桌面端（`apps/desktop/electron/`）

| 模块 | 迁移动作 | 阻塞 |
|---|---|---|
| `main.ts` | 立即显示启动页、单实例锁、托盘、中文错误页 | 中 |
| `dsh/web-host.ts` | 加计时埋点；**`cwd: process.cwd()` 改为 `userData`**（Finder 双击时 cwd=`/`） | **高** |
| `dsh/harness.ts` | **死代码，建议整段删除**：硬编码开发机 Node/dsh 绝对路径、两套 DSH_HOME | 中 |
| `dsh/profile.ts` | 保留；删掉 `app.getAppPath()/../..` 的非打包分支假设 | 低 |
| `db/` + 25 个迁移 | **当前无人调用**（仅测试引用）。要么纳入主进程并补 `asarUnpack`，要么从包里剔除 | 中 |

### 21.5 迁移顺序

先做"高阻塞"6 项 → 再做"中"5 项 → 低阻塞项随打包一并验证。

---

## 二十二、零本机依赖总清单（硬性要求）

**定义**：App 拷到一台全新机器上（无 Node、无 Python、无 Docker、无 LibreOffice、无 git、无 Homebrew、无本项目源码），只靠包内文件 + 网络就能完整使用。

### 22.1 依赖总表

| 依赖 | 现状 | 打包后 | 处理方式 |
|---|---|---|---|
| Node（dsh 宿主） | 开发机 Node | ✅ 用 Electron 自带（`process.execPath` + `ELECTRON_RUN_AS_NODE`） | 无需改 |
| dsh 内核 | npm 包 | ✅ 随包（`asarUnpack` 已含 `@deepseek-ai/**`） | 无需改 |
| 插件 / 技能 / 校园静态资源 | 工作区目录 | ✅ 随包到 `resources/mochi/` | 补白名单（B0） |
| `better-sqlite3` | 原生模块 | ⚠️ 未列入 `asarUnpack`（当前是死代码） | 启用就补，否则删除 |
| `node-pty` | 原生模块 | ✅ prebuilds 齐全（darwin-arm64/x64、win32-x64） | 无需改 |
| `sharp` / `@img/*` | **架构专属** | ⚠️ 交叉构建会拿错二进制 | 各架构在原生机构建 |
| **`soffice`（LibreOffice）** | 硬编码 `/opt/homebrew/bin/soffice` | ❌ 老师机器没有 | **替换为纯 JS**（22.3） |
| **Docker + OnlyOffice** | `docker-compose.yml` 起本地服务 | ❌ 老师机器没有 | **替换为纯 JS 预览**（22.4） |
| **`git`** | sidebar Git 页 `spawn('git')` | ❌ 老师机器没有 | **替换为 isomorphic-git**（22.6） |
| **Python + SearXNG** | 本机 8888 | ❌ 老师机器没有 | **改为公共端点**（22.5） |
| **wrangler + 本地 D1（8787）** | 校园数据本地模式 | ❌ 老师机器没有 | **默认走云端 API**（22.2） |
| **字体（Hiragino Sans GB）** | 系统字体 | ❌ Windows 没有 | **内置开源中文字体**（22.7） |
| 硬编码绝对路径 | `/Users/a1379/...` | ❌ 路径不存在 | 全部删除 |
| `process.cwd()` | 启动时 cwd 不定 | ⚠️ Finder 双击时 cwd=`/` | 改为 `userData` |
| 环境变量缺省 | Electron 未注入 | ❌ 校园/搜索功能失效 | 主进程显式注入默认值 |
| Windows 符号链接 | `ensurePluginLink` | ⚠️ 需管理员权限 | 降级为目录复制 / junction |
| 凭据 | 开发机 `.credentials.yaml` | ❌ 随包不带 | 首次运行写入内置默认密钥 |
| 应用图标 | 无 | ❌ 默认 Electron 图标 | 见第 23 章 |
| 签名 | 无 | ⚠️ Gatekeeper / SmartScreen | ad-hoc + 安装脚本（已选） |

### 22.2 校园数据：本地 8787 → 云端 API

- `mochi.sh:35-45` 已有云端默认值 `https://jyl-campus-health-entry.pages.dev`，但 **Electron 侧没有注入**
- 动作：`web-host.ts` 的 `buildEnv()` 显式注入 `MOCHI_CAMPUS_API_URL`（云端）与 `MOCHI_CAMPUS_MODE=cloud`
- 同时删掉 `plugins/mochi-campus/db.mjs:19-22` 扫 `../..` 找本地 D1 的兜底（打包后必然扫错目录，静默退化为 demo 数据）

### 22.3 文档导出：LibreOffice → 纯 JS

- 现状：`mochi-documents/index.mjs:42`、`mochi-presentations/index.mjs:11` 写死 `/opt/homebrew/bin/soffice`
- 动作：DOCX 用 `docx` 库直出、PPTX 用 `pptxgenjs` 直出、PDF 用 `pdf-lib` **直接生成**（不再"先生成 Office 文件再转 PDF"）
- 影响：需重写这两个插件的转换层，是本期最大的一块功能改造

### 22.4 Office 预览：Docker → 纯 JS

- 现状：`mochi-office/docker-compose.yml` 起 `onlyoffice/documentserver` 到本地 18080
- 动作：改为前端渲染（docx→`mammoth`、xlsx→`SheetJS`、pptx→预览库），或明确为"用系统已装 Office 打开本地文件"的**可选**功能
- 注意：`MOCHI_OFFICE_JWT_SECRET` 当前直接 throw，需一并处理

### 22.5 搜索：本地 SearXNG → 内置公共端点

- 内置候选实例列表 → 启动健康择优 → 失败自动轮换 → 兜底学术源（OpenAlex / Crossref / arXiv）与校园数据
- `tools/searxng/`（Python 源码 + settings）**不进包**

### 22.6 Git：外部 git → isomorphic-git

- 现状：`dsh-better-sidebar/src/git.ts:163` `spawn('git')`
- 动作：改用 `isomorphic-git`（纯 JS，无外部二进制），或内置 portable git 二进制（Windows 约 50 MB）

### 22.7 字体：内置开源中文字体

- 现状：`DOCUMENT_FONT = 'Hiragino Sans GB'`，Windows 无此字体
- 动作：内置思源黑体 / 霞鹜文楷到 `extraResources`，运行时注册

### 22.8 验收方法（这才是判据）

找一台**全新机器**（或虚拟机），确认以下条件全部成立后完整跑一遍功能：

- [ ] 系统里没有 Node.js、Python、Docker、LibreOffice、Homebrew、git
- [ ] 没有 `/Users/a1379/Documents/Mochi` 这个目录
- [ ] 环境变量里没有任何 `MOCHI_*` / `DSH_*`
- [ ] 只靠 U 盘拷来的安装包 + 校园网

通过标准：文档生成、PPT 生成、成绩导出、校园查询、全网搜索、右侧栏终端与 Git、技能调用——全部可用。

---

## 二十三、图像资产清单与图标交付规范

### 23.1 现状盘点：到底缺什么

| 资产 | 用途 | 现状 |
|---|---|---|
| **App 图标（.icns / .ico）** | Dock、启动台、安装向导、Windows | ❌ **完全不存在**，打包出来是 Electron 默认图标 |
| **托盘图标** | 菜单栏 | ❌ 不存在 |
| Mochi 本尊界面形象 | 启动页、助手在场指示 | ✅ **已有**：`联动计划/src/components/OrbCompanion.tsx/.css` + `ExpressiveOrb.tsx/.css`（代码组件，非位图） |
| 水母 logo | 侧栏品牌位、文档标识 | ✅ 已有（`jiaxing-jellyfish-v1.png`） |
| 校园图标 | Web favicon | ✅ 已有（`client-plugins/jxl-theme/assets/icons/icon.svg`） |
| 校园水彩/手绘场景 | 校园界面背景 | ✅ 已有（webps） |
| DMG 背景 / NSIS 横幅 | 安装素材 | ❌ 可选 |

**结论**：Mochi 本尊只以 React 组件形式存在，**从未导出过位图或矢量文件**。
真正需要新建的只有 **App 图标**与**托盘图标**两项——界面内的形象可以直接复用现有组件代码，不必重画。

### 23.2 图标交付规范（可直接转交画师）

**主题**：Mochi 本尊 = 一个球 + 面前一台小电脑（OrbCompanion 造型），手绘感、圆润、有温度。

**配色**（取自 `OrbCompanion.tsx` 源码，务必沿用）

| 部位 | 色值 |
|---|---|
| 球主体 | `#E8B34B`（焦糖金） |
| 球描边 | `#B98A5C` |
| 高光 | `#FFF6E8` / `#FFE7C2` |
| 电脑机身 | `#6B4E33` / `#4A3826` |
| 电脑屏幕 | `#FFF6E8` |
| 五官与深描边 | `#2E2318` |
| 图标底（可选） | `#45584e`（品牌深绿，与启动页背景一致） |

**构图**
- 球居中偏上；小电脑在球**前下方**，宽度约为球直径的 78%，底部与球下部重叠（电脑在球前面）
- 主体占画布约 80%，四周留 10% 安全边距，不要顶边
- 手绘感：线条圆头、允许轻微不对称、有笔触温度；不要机械的完美圆形

**禁止**
- 只画一个球（没有电脑）——那是被明确否掉的形象
- 用水母当 App 图标——水母是 logo，不是 Mochi 本尊

**交付物**

| 文件 | 规格 |
|---|---|
| 源文件 | SVG，1024×1024 画布，路径尽量合并 |
| macOS | 1024 PNG + `.iconset`（16/32/64/128/256/512 及 @2x 共 10 张）→ 我方转 `icon.icns` |
| Windows | `icon.ico`，内嵌 16/24/32/48/64/128/256 |
| 托盘（macOS） | 模板图标：单色黑 + 透明度，22px @1x/@2x |
| 托盘（Windows） | 彩色 16/32 |
| 背景 | 透明版与深绿底版各一套 |

**小尺寸规则**
- ≤ 64px：去掉屏幕字符与高光，保留球 + 电脑轮廓 + 眼睛
- ≤ 32px：轮廓加粗，眼睛保留
- ≤ 16px：只留球色块 + 屏幕亮块 + 底色对比

### 23.3 图标未到位前怎么办

- 用现有校园 `icon.svg`（深绿底 + 线框）作**临时占位图标**，保证打包链路与安装流程不被阻塞
- 图标是唯一可以并行的事项：阶段 0/1 的代码改造与打包验证**不等它**
- 正式图标到位后，只需替换 `build/icon.*` 并重新打包，不影响其他改动
