# MOCHI-WIN-PACK-01 · Windows 出包 + 零配置 key + 补丁持久化 + Chat×Work 架构（GLM 工单）

> ⚠️ **历史工单（2026-09-12 补加横幅，正文一字未删）**：本文中「快照 451/451 全对」「白名单 12→13」等数字是 **2026-09-09 时点**的事实，现已过时——当前快照为 **491 文件（11 处不一致）**、白名单 **26 插件**。另：文中逐一核实的 `mochi.knowledge_search` / `ppt_create` / `jxl.campus_status` 等**点号工具名**已于 9/12 被网关 400 事故全面禁用，现注册名为下划线形态（`mochi_ppt_create` 等）。以源码为准。

> 起草：root（主框架师，只审不写码）｜ 2026-09-09 晚
> 执行：GLM 5.3 flash（按 §7 既有分工）｜ 审核：root 独立复核
> 用户裁定原文：
> - 「API key 可以直接写进安装包，只要不让用户拿到就行。key 没充多少钱，随便用。」
> - 「Chat×Work 是核心：我们是对话模式和工作模式，不是另外一个模式。Mac 版先不管，先把 Windows 修好。」
> - 「我不写代码（太贵）。我测试、指挥 GLM；root 只做架构审核。」

---

## 0. root 决议总表（GLM 照此执行，不得自行改架构）

| # | 事项 | 决议 | Owner |
|---|---|---|---|
| WO-1 | node_modules 补丁持久化 | **重打包 7 个 vendor tgz**（补丁进 tgz），本地与包同源 | Halley |
| WO-2 | Windows 出包 | **A 主路：GitHub Actions windows-2022**；快照已核 451/451 | Halley |
| WO-3 | 零配置 API key | **构建时注入 + 首启种子**；key 不入 git、教师不可见、受限可轮换 | Halley + Maxwell |
| WO-4 | Chat×Work 架构修正 | **注册原生 work 视图**，去 trajectory 劫持、去侧边栏重复入口 | Lagrange |
| WO-5 | 纪律与孤儿项 | WORKLOG 补账；mochi-office 删或挂载二选一 | Maxwell |

---

## WO-1 · 补丁持久化（最高优先，WO-2/3 的前置）

**实测证据（root 本轮核）：**
- 已安装 `/Applications/Mochi.app` = **20 插件、dsh 0.1.3-alpha.1**——但 `grep 进入或退出计划模式` = 0，**全部 node_modules 补丁丢失**（中文菜单 6 条 + dsh-llm-deepseek 9 处功能修复）。
- 本地 `apps/desktop/node_modules` 仍是 **0.1.2-rc.1 + 7 文件 15 处 `[Mochi patch]`**（dsh-llm-deepseek 9 处含 tool_calls null 修复/推理档位中文化；plan-mode/command-goal/command-compact/command-feedback/permission-presets/session-log-export 各 1 处命令描述中文）。
- CI 快照清单显式排除 node_modules（`snapshotLayout`），只含 vendor tgz（0.1.3-alpha.1）→ **任何 npm ci 出来的包（Mac 包、Windows CI 包）都丢补丁**。Mac 包已实锤中招。

**执行（GLM）：**
1. 把 7 个包的补丁合入各自 `vendor/alpha-family/` tgz，重打包为 `*-0.1.3-alpha.1+mochi.1.tgz`（旧 tgz 保留不删，manifest 指新版）。
2. `apps/desktop/package.json` 依赖指向新 tgz → 本地 `npm install` 把本地 node_modules 对齐到 **0.1.3-alpha.1**（消灭 0.1.2-rc.1/0.1.3-alpha.1 漂移）。
3. 全量回归：`npm run test:installer-config && npm run test:package-resources && npm run test:runtime-profile`，并 grep 验证 `进入或退出计划模式` 在新装 node_modules 中存在。
4. 重生成 Windows 快照 manifest（451 项 SHA256 全变）。

**验收（root 独立复核）：** 新装的 dsh-plan-mode 里中文描述在、dsh-llm-deepseek 9 处补丁在、三个测试全绿、新 manifest 与工作区 sha256 全对。

---

## WO-6 · 教室端×教师端 LAN 自动互联（2026-09-09 用户新增）

**用户原话**：「教室端自动配置网络并和教师端相连（自动发现/配对，尽可能自动化），教师端也这样。」

**边界（对齐既有裁定，不推翻）**：LAN 四层 = 发现/相识（首次人工确认）/传输/融合；不写配对码/HMAC/TLS 重防御。「尽可能自动化」的落点 = **发现全自动、配置全自动、相识只需一键**（不是无人值守信任新设备）。

**现状**：`plugins/mochi-lan/lan-service.mjs` 已有 ed25519 签名信封、指纹绑定、角色/班级校验、去重、DELIVERY_UNKNOWN；`mochi-lan-client` 为对端。缺的是「零配置体验」——现在两边要手工配地址/端口/身份。

**任务：**
1. **自动发现**：mDNS/UDP 广播（该校 LAN 环境可用者为准，优先无依赖的 UDP broadcast）让教室端开机即被教师端看见，反之亦然；两端都不用手填 IP。
2. **自动配置**：发现后自动交换连接参数（地址/端口/指纹），写入各自运行时配置；网络变化（IP 漂移）自动重发现重连。
3. **一键相识**：首次出现新对端 → 对话框内一张确认卡（设备名/角色/指纹短码，中文），老师点「信任」即配对；已信任对端之后全自动重连，不再打扰。
4. **教室端自治**：教室端不登老师账号，开机即以自己的身份上线；教师端列表里能看到「教室端在线/离线」。
5. 角色预设已就位（classroom preset、teacher preset），本单只管互联体验，不动权限模型。

**验收**：两台设备（或本机双 profile 模拟）→ 开机 → 教师端 30 秒内看到教室端 → 一键信任 → 互发一条消息收到回执；断网恢复后自动重连。

---

## WO-2 · Windows 出包（A 主路）

- 工作流 `.github/workflows/windows-native-package.yml` + 快照清单 + Chromium LICENSE 资产**已齐**；快照与工作区当前一致（451/451，root 已核）。
- 步骤：WO-1 完成 → 重生成快照 → 推私有仓 `linkimi2026-cmd/jyl-campus-health` 分支 `codex/mochi-windows-*` → dispatch → 取 artifact → SHA256 + 照 `release/2026-09-09/Mac试用说明.md` 格式写 Windows 说明 → 归档 `release/2026-09-09/`。
- 产物预期落点：runner 上 `apps/desktop/release/Mochi-Setup-0.1.0-win-x64.exe`。
- **验证（真 Windows 必做 7 项）**：双击安装无终端/英文报错；冷启动计时；首次角色选择；五项场景（传话/PPT 二次编辑/成绩分析/教学建模/对话内审批）各一次；SmartScreen「仍要运行」预演；有第二台则 LAN 发现+配对+回执；归档 SHA256+说明。
- Whisky 已判定 = Wine 前端非 VM：**只能做 exe 冒烟（能不能起），不能构建、不能当验收**。

---

## WO-3 · 零配置 API key（用户已授权内嵌）

**根因（root 诊断）：** 打包态 `~/.mochi-home` 与开发态 `.mochi-home.nosync` 是两套运行时根；测试者装完 dmg 后 home 为空/缺 key（当前本机打包态有 ZHIPU + MOCHI_AIAAA_API_KEY，**缺 MIMO_API_KEY**），首启/聊天即报「找不到 API key」。`doctor.ts:598` 首启凭据检查要求 apiKey 非空。

**机制决议：**
1. **构建时注入**：打包脚本读取本地未提交密钥文件（如 `secrets/packaging-keys.local.yaml`，**gitignore，仓库永远不含 key**），注入受管资源的 settings/credentials **种子**；CI 上改从 GitHub Secrets 注入。仓库里只有机制。
2. **首启种子**：首次启动把种子写入 `~/.mochi-home/.credentials.yaml`（0600）+ 对齐 `settings.yaml` 默认模型链（aiaaa 视觉模型与 MiMo 双默认，§7 裁定）；已有配置不覆盖（教师自填优先）。
3. **doctor 对齐**：`doctor.ts` 的凭据检查改读同一种子/凭据缝，杜绝「有 key 仍报找不到」。
4. **缺失兜底**：无 key 时聊天内中文提示 + 指向设置页，不弹英文、不白屏。
5. key 表面不可见：不出现在 UI 明文、日志、打包说明；受限可轮换（用光即换，用户已知额度小）。

**Provider 实参（2026-09-08 晚 curl /v1/models 实测两把 key 均有效；key 值永远不进本文档/不进 git）：**

| 网关 | baseURL | apiKeyEnv（refs 名） | 可用模型（实测返回） | 默认角色 |
|---|---|---|---|---|
| MiMo 中转 | `https://mimo.ezlook.top/v1` | `MIMO_API_KEY` | `mimo-v2.5`、`mimo-v2.5-pro`、`mimo-v2.5-asr` | 主力对话模型 |
| aiaaa 中转 | `https://aiaaa.cc/v1` | `MOCHI_AIAAA_API_KEY` | `deepseek-v4-flash-0731`、`deepseek-v4-pro-0813`、`deepseek-v4-flash-vision-exp`、`deepseek-v4.1-flash-expires-on-0910` | 多模态视觉模型 = `deepseek-v4-flash-vision-exp`（用户裁定"都选用多模态模型"，有视觉需求的默认走它） |

注意 `deepseek-v4.1-flash-expires-on-0910` 名字自带 9/10 过期提示——别选它当默认。本地两个运行时根（开发 `.mochi-home.nosync`、打包 `~/.mochi-home`）的 `.credentials.yaml` 已补齐两把 key（0600），你现在测试不应再报找不到 key。

**验收：** 全新机（或清空 `~/.mochi-home`）双击 → 不配任何东西直接对话成功；断网/key 失效时是中文可读提示。

---

## WO-4 · Chat×Work 架构修正（用户点名的核心）

**病根（root 审代码实锤，`client-plugins/mochi-workbench/client.js`）：**
- `chatWorkMode()`（:97-98）把官方 **trajectory 视图当 work**；auto-switch 调 `selectView("trajectory")`（:597）；另有 better-sidebar `registerTab`（:1214-1216）**重复入口**——「工作」成了另一个地方，不是同一个会话面上的模式。

**架构决议（官方公共扩展，最小侵入）：**
1. `ctx.uiConversation.views.register({ id: "work", label: "工作" })` + `ctx.slots.register({ name: "conversation.view", id: "work", …工作台组件 })`——官方本就支持自定义视图（trajectory 就是这么注册的，见 dsh-client-ui-trajectory:1523/8194）。
2. 胶囊 = **对话 / 工作** 两个模式：真实执行状态（turn running）自动 `selectView("work")`，结束或手动切回 `selectView("chat")`；会话、输入草稿、产物在切换间全部保持。
3. trajectory 保留为开发视图，**不进教师胶囊**；侧边栏工作台入口下线（单一入口=胶囊）。
4. 视觉沿用 Mochi 风格（jxl-theme 令牌），不自绘第二套 UI。

**验收（URGENT-07 判据）：** 自动从聊天切工作、手动切回、会话/输入/产物保持；agent-browser 实测双模式各一次截图。

---

## WO-5 · 纪律与孤儿项

1. WORKLOG 9/9 全天零条目——GLM 每条 WO 完成当天回写，root 复核引用条目号。
2. `plugins/mochi-office/` 是孤儿（不在 runtime-profile/快照/期望挂载）：删或挂载，二选一，写明理由；不许留着不接线。

---

## WO-7 · 角色选择必须可选、可改、可并存（2026-09-11 用户点名的硬伤）

**用户原话**：「最好在安装的时候，能选择教师端和教室端，不要像 Mac 装出来就直接默认教室端，连选择都没有。」

**根因（root 审代码实锤，`apps/desktop/electron/main.ts`）：**
1. `writeLaunchRole`（:101-127）在角色文件已存在时**直接返回、且不允许改**；`resolveLaunchRole`（:130-149）只在文件缺失时才弹框。`~/Library/Application Support/Mochi/mochi-launch.json` 一旦写了 `"role":"classroom"`，该机**永久进教室端且永不询问**——这就是「装出来直接默认教室端」。
2. `launchRolePath()`（:69-71）用 `app.getPath("userData")`，**全机单例**：同一台机器无法同时存在教师端与教室端（教师办公电脑常常也要装一份教室端做演示/联调）。
3. 首次对话框虽为中文，但**没有「以后可以改」的出口**，选错=重装。

**架构决议（保留安全边界，不放松防线）：**
1. **角色可重选**：设置页（或托盘菜单）提供「切换本机角色」，切换= 更新 `mochi-launch.json` 并重启应用；切换**不删除任何数据**（两套 home 各自独立：`.mochi-home` / `.mochi-classroom-home`），切回来数据仍在。
2. **可并存（用户明确要）**：`launchRolePath()` 支持按角色分文件（如 `mochi-launch-<role>.json`）或支持 `MOCHI_RUNTIME_ROLE` 环境变量/`--role=` 启动参数；这样一台机器可同时保留两个角色入口（如桌面两个快捷方式）。**不引入新进程常驻**，仍遵守单实例锁（同角色单实例即可）。
3. **首启对话框改进**：两个选项 + 「退出」；detail 里写明「本机选择仅影响默认启动角色，之后可在设置页切换，两套数据互不可见」；默认仍高亮「教师办公电脑」（教师是主用户）。
4. **安全不放松**：教室端仍用独立 home、不读教师密钥/记忆/会话；角色切换后必须重启并重新走各自 home 校验；不允许通过网页设置越权改角色（切角色只在桌面壳层做）。
5. **Mac 与 Windows 同修**（同一份 Electron 代码，改一处两端生效）。

**验收（用户可感知）：**
- 全新机首次启动 → 出现中文角色选择框，两个选项都能选中并进入对应端；
- 同一台机器 → 能分别以「教师办公电脑」和「教室一体机」启动各一次（或提供明确切换入口），数据互不串；
- 切换角色 → 重启后进入新角色，且切回时原数据仍在；
- 截图佐证：首启选择框、切换入口、切换成功各一张。

---

## 附录 A · root 本轮已完成的审核（GLM 不必重做）

**LAN（plugins/mochi-lan）✅ 通过**：ed25519 签名信封、指纹绑定 + timingSafeEqual、SCHOOL_MISMATCH/ROLE_FORBIDDEN 一律 403、教室身份必须有 classId、只有教室端可确认「已看到」、消息/文件/回执均有 duplicate 去重、DELIVERY_UNKNOWN 诚实态（不假装已发送）、消息 64KB/文件 100MB/配对 64 等各项上限齐。

**教师四预设 + classroom 预设 ✅ 通过**：引用的工具全部真实存在（mochi.knowledge_search/knowledge_page、ppt_create/ppt_revise、grade_analyze、list_classrooms/notify_classroom、ask/request/find/tasks、jxl.campus_status/relay_list 逐一核实）；条件式引用（工具缺失如实报「当前不可用」，不编造）；跨平台 shell 选择正确（win32 用 pwsh）；preset 不重复注册 host 工具、不因选择预设获得额外权限；classroom 预设符合「功能受限、知识不受限」裁定。

**快照一致性 ✅**：manifest 451/451 与工作区 sha256 全对，且已含 mochi-lan 双插件、教师四预设、classroom-agent-presets。

**已知边界（不修，答辩口径）**：Mac 包（已装 /Applications，20 插件）菜单英文 = WO-1 要修；mochi-office 孤儿；WORKLOG 断账。
