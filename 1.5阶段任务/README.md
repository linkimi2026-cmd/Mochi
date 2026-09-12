# 1.5 阶段任务 —— 遗留收尾清单

> 建立时间：2026-09-06 15:0x
> 性质：**把之前做过、但没做完的任务全部收口**，然后才进第二阶段。
> 分发路线（用户 2026-09-06 拍板）：**校内小规模试用** —— dmg + 《首次打开说明》，
> 不办 Developer ID，不做公证。签名与开机自启因此降为可选。

## 🔴 时间已提前（2026-09-08 用户裁定，覆盖本文件原有排期）

**外部把时间提前了。原按 2026-09-30 倒排的排期全部作废，新截止 = 2026-09-11（周五）。**
本文件原有的级别标记仅表示重要性，**不代表当前排期**。
**三天倒排与紧急事件编号见唯一事实源：`docs/tasks/MOCHI-URGENT-REPLAN-2026-09-11.md`。**
下面标注 🔴 的条目即该表的 URGENT 项（URGENT-01 = A1/A8，02 = A3/A4，03 = A8/A9，04 = A15，05 = E3）。

---

## ✅ 现状复核（2026-09-12 21:0x，工具线逐条核过）

> ⚠️ **下面各表格里的「实测现状 / 状态」两列是 2026-09-06 的快照，已经过期。**
> 以本节的复核结论为准；本文件其余部分作为历史记录保留，不改写。
> 现行交付与验收判定看 `docs/DELIVERY-LEDGER.md`；运行机制的实测事实看 `docs/RUNTIME-FACTS.md`。

**A. 桌面端「双击即用」**

| # | 结论（2026-09-12） | 依据 |
|---|---|---|
| A1 白名单 | ✅ 已完成（现 **26** 个插件），守卫 `test-package-resources.mjs` PASS（26 plugins / 29 DSH modules / 106 additional） | 实测 exit 0 |
| A3 web-host cwd | ✅ 已修：`cwd: dshHome` | `electron/dsh/web-host.ts` |
| A4 环境变量注入 | ✅ 已修：注入 `MOCHI_CAMPUS_API_URL` / `MOCHI_SEARXNG_ENDPOINT`（值为 null 时不注入） | `web-host.ts:100-105` |
| A5 启动窗口先显示 | ✅ 已修：启动页就绪即显示，不等 sidecar | `electron/main.ts` |
| A6 冷启动计时 | ❌ **仍无实测记录** | 全仓无计时数据 |
| A7 图标 | ✅ 已有 `build/icon.icns` + `icon.ico`，产物内亦含 | 文件存在 |
| A8 重新打包 dmg | ✅ 已产出，但**是 20 插件旧版**（`release/2026-09-09/`） | 包内插件列表 |
| A9 双击验收 | 🟡 **只有程序化启动**记录（隔离 HOME、仅 macOS、非全新机）；**人工全新机双击仍缺** | `artifacts/architect-audit/final-mac-full-startup-20260909/` |
| A10 开机自启 | ⚪ 未做（有意后置） | 全仓零命中 |
| A11 sidecar 健康与重启 | ❌ **仍无健康检查、无退避重启**（仅 90s ready 超时 + SIGTERM→5s→SIGKILL） | `web-host.ts` |
| A12 端口硬编码审计 | 🟡 仍有 `18100`（workbench）与 `18080`（office）不一致；office 不进包，影响有限 | 全仓 grep |
| A13 首启向导 + 环境自检 | ✅ 角色选择对话框 + 首启模型种子已实现 | `electron/dsh/launch-role.ts`、`seed.ts` |
| A14 《首次打开说明》 | ✅ 已有两份 | `release/2026-09-09/Mac试用说明.md`、`Windows试用说明.md` |
| A15 校园网可达性实测 | ❌ **仍未在校园网实测** | 无记录 |

**B. 零本机依赖**：B1 `soffice` 🟡 已改多路径探测但**仍不随包分发**（无 LibreOffice 的机器上，PPT 渲染回看与 PDF 导出会如实降级）；B2 无关（该插件不进包）；B3 `git` ❌ 仍在；B4 macOS 专有字体 ❌ 仍在（试卷导出硬要求 Songti SC，Windows 缺字）。

**C. 功能缺陷遗留**：C1「快速放行绕过 PENDING」❌ 仍在（校园站 `MovementsPage`）；C2 折叠 ✅ 已修；C3 窄屏溢出 未复核；C4 待办→对话返回 ✅ 已修；C5 拒绝收尾语义 ✅ 已修（`USER_DECLINED`）。

**D. 能力缺口**：D1 Word/Excel/PPT 生成 ✅ 已实现（docx / exceljs / pptxgenjs / pdf-lib 均进包）；D3 OCR 🟡 半实现（仅教材导入期的离线 OCR），**不是通用 OCR**。

**验收法（唯一判据，未变）**：全新机器（无 Node / Python / Docker / LibreOffice / git / 源码目录 / `MOCHI_*` 环境变量），只靠 U 盘安装包 + 校园网跑通全部功能。**目前尚未达成**（缺 A9/A15 与 B1/B4）。

---

## 状态图例

| 标记 | 含义 |
|---|---|
| 🔴 阻断（= URGENT，9/11 前必须清） | 不做则打包版根本跑不起来，必须最先清 |
| 🟠 必做 | 校内试用前必须到位 |
| 🟡 体验 | 能用但难用，试用前尽量清 |
| ⚪ 后置 | 试用后可推 |

---

## A. 桌面端「双击即用」（主线，方案见 `Mochi-桌面端原生化方案.md` 23 章）

| # | 任务 | 级别 | 实测现状（2026-09-06 15:0x 核） | 状态 |
|---|---|---|---|---|
| A1 | 插件白名单 9 → 12 | 🔴 | `prepare-mochi-resources.cjs:40` PLUGINS 只有 9 个；源 `apps/desktop/resources/mochi-web/runtime-profile.json` 声明 **12** 个。缺 `mochi-web-search` / `mochi-llm-mimo` / `dsh-better-sidebar`。`test-package-resources.mjs:191` 硬断言 `=== 9` | **进行中** |
| A2 | 打包资源 profile 校验 | 🔴 | 记忆里写的"`.mochi-package-resources-v1.nosync/profile` 是空目录"**已证伪**——真实路径是 `apps/desktop/.mochi-package-resources.nosync/profile`，内含 `runtime-profile.cjs` / `.json` / `patches`，非空。**本条降级为观察项** | 已澄清 |
| A3 | `web-host` cwd 修正 | 🔴 | `electron/dsh/web-host.ts:94` 是 `cwd: process.cwd()`。Finder 双击时 cwd = `/`，dsh 会在根目录建文件。应改 `app.getPath('userData')` | 待做 |
| A4 | 环境变量注入 | 🔴 | `web-host.ts` 全文零命中 `MOCHI_CAMPUS_API_URL` / `MOCHI_SEARXNG_ENDPOINT`（`mochi.sh` 有、Electron 没有）→ 打包版校园功能兜到 `127.0.0.1:8787` 直接失效 | 待做 |
| A5 | 启动窗口先显示 | 🟠 | `main.ts` `show:false` + ready-to-show 才显示 → dsh 未就绪时窗口**完全不出现**，老师以为没反应。改：先 show 品牌启动页 | 待做 |
| A6 | 冷启动计时 | 🟠 | **零实测记录**，只有 web-host 90s 超时上界。动手前必须先计时 | 待做 |
| A7 | App 图标 + 托盘图标 | 🟡 | `apps/desktop/build` 目录不存在 → 打包出来是 Electron 默认图标。规范见方案 §23.2（球 #E8B34B、电脑在球前下方宽 78%；禁止纯球体、禁止水母当 App 图标） | 等画师 |
| A8 | 重新打包 dmg | 🟠 | 现产物 `dist/mac-arm64/Mochi.app` 713MB，09-05 22:11，dir 格式、无 dmg、adhoc 签名、不含新插件 | 待做 |
| A9 | **双击验收** | 🔴 | **从未做过**。记忆只有 09-05 16:40 用 `dev.mjs` 首跑成功，`.app` 零验收记录 | 待做 |
| A10 | 开机自启 | ⚪ | 代码零命中 `setLoginItemSettings` / `openAtLogin` / `launchd`。未签名情况下 macOS 13+ 会静默失败 → 校内试用路线下**暂缓** | 后置 |
| A11 | sidecar 健康与重启 | 🟠 | 无健康检查、无退避重启、无 tree-kill。调研结论：**同类项目没一家做好**（AnythingLLM / Jan 都没有）→ 这是差异化机会 | 待做 |
| A12 | 端口硬编码审计 | 🟠 | AnythingLLM #2291 教训：随机端口之后前端硬编码 3001 → 功能静默失效。必须审计全仓静态端口 | 待做 |
| A13 | 首启向导 + 环境自检 | 🟡 | 方案 §5 / §6 已设计（11 项自检 + Mochi 医生），未实现 | 待做 |
| A14 | 《首次打开说明》 | 🟠 | 校内试用必需。U 盘/SMB 拷贝不带 quarantine；浏览器下载才带 → 说明里讲清「右键→打开」 | 待做 |
| A15 | 校园网可达性实测 | 🔴 | 必须在**校园网**实测 mimo / 校园服务可达性，不通则全盘白做 | 待做 |

## B. 零本机依赖（四项硬改，不是改配置）

| # | 依赖 | 现状 | 替代方案 | 级别 |
|---|---|---|---|---|
| B1 | `soffice` | `mochi-documents`/`presentations` 硬编码 `/opt/homebrew/bin/soffice` | docx 库 + pptxgenjs + pdf-lib 直出 | 🟠 |
| B2 | Docker / OnlyOffice | `mochi-office` 依赖本地 18080 | mammoth / SheetJS 纯 JS 预览 | 🟡 |
| B3 | `git` | `dsh-better-sidebar/src/git.ts:163` spawn('git') | isomorphic-git 或内置 portable git | 🟡 |
| B4 | macOS 专有中文字体 | `mochi-documents/index.mjs:92,96` 硬要求 **`Songti SC`**（试卷导出路径，缺失即抛 `EXAM_FONT_UNAVAILABLE`，**不静默替换**）；`mochi-grades/index.mjs:26` 与 `mochi-sheets/sheet-write.mjs:24` 的 xlsx 版式用 **`Hiragino Sans GB`**（软降级）。Windows 两个都没有 | 内置思源黑体/霞鹜文楷 + 运行时注册；`plugins/mochi-visuals/fonts.mjs` 已有跨平台字体候选链（含 `Microsoft YaHei` / `SimSun` / `Noto Sans CJK SC` / `WenQuanYi Micro Hei`） | 🟠 |

验收法（唯一判据）：**全新机器**（无 Node / Python / Docker / LibreOffice / git / 源码目录 / MOCHI_* 环境变量），只靠 U 盘安装包 + 校园网跑通全部功能。

## C. 功能缺陷遗留（来自 `MIGRATION_AUDIT_REPORT.md`）

| # | 缺陷 | 级别 | 现状 |
|---|---|---|---|
| C1 | **快速放行绕过 PENDING** | 🔴 | `MovementsPage` 默认「快速放行」直调 `createMovement` 绕过 PENDING；`AssistantPage` 旧 AI 确认直放行入口未清。服务器授权来自真实会话用户及班级关系，模型不能自报审批身份 |
| C2 | 隐藏 tab 折叠失效 | 🟡 | `hidden` 属性被 `display:flex` 覆盖，折叠后内容仍占空间 |
| C3 | 窄屏溢出 | 🟡 | 319px 下 `.painterly-page` 继承独立站 `margin: 0 -16px`，在嵌入容器里形成负边距溢出 |
| C4 | 待办 → 顶部对话返回 | 🟡 | 校园 host 在 1100×814 下占满视口覆盖侧栏与 HEADER；失败重试后无 resize 监听 |
| C5 | 拒绝收尾语义 | 🟡 | 模型拒绝后仍重新索取确认，未给 `USER_DECLINED` 结果 + Skill 终止语义 |

## D. 能力缺口（`artifacts/migration-audit/TEACHER_CAPABILITY_INVENTORY.md`）

| # | 能力 | 级别 | 现状 |
|---|---|---|---|
| D1 | Word / Excel / PPT 产出与修改 | ⚪ | 未实现，依赖根无 pptxgenjs / exceljs / docx / mammoth |
| D2 | PDF 基础操作 | ⚪ | shell 可导入 pypdf、PIL，但**不是 Mochi 已挂载能力** |
| D3 | 扫描 / OCR | ⚪ | 未实现，无 OCR 工具注册证据 |
| D4 | 长期可控偏好记忆 | ⚪ | 未实现 → **移入第二阶段**，见 `../第二阶段/` |

## E. 工程与协作

| # | 任务 | 级别 | 现状 |
|---|---|---|---|
| E1 | git 基线提交 | 🟠 | 仓库**无 remote**，`git status --porcelain` = **52 项未提交**。方案要求动手前先 commit 基线 |
| E2 | Archify 落点裁定 | ⚪ | 调研已完成（MIT、49.5k★）。我的判断：装**开发 profile** 画 Mochi 自己的架构图供答辩，不装 mochi-web。**等你拍** |
| E3 | 嘉行联答辩演练 | 🔴 | **URGENT-05**。原写"唯一剩余项，截止 2026-09-30"——**截止已提前至 2026-09-11**，不再是唯一剩余项，与 Mochi 主线挤在同一周，必须排进 §执行顺序 |
| E4 | 双界面 | ➖ | **用户已接手**（自己把 Codex 界面发给 Agent）。我的调研备份在 `/tmp/Mochi_双界面调研_2026-09-06.md.bak` |
| E5 | 免费搜索工具落地 | ⚪ | 调研已产出 `免费搜索工具调研_2026-09-06.md`，落地状态待确认 |

---

## 执行顺序（严格按此推进，前一条不通不做下一条）

> ⚠️ **原 8 步顺序已按 9/11 截止重排，见 `docs/tasks/MOCHI-URGENT-REPLAN-2026-09-11.md` §3。**
> 下表保留为完整清单（含已提前/已砍项），**实际推进以紧急表三天倒排为准**。

```
第 0 步  校园网可达性实测（A15）        ← 不通则全盘白做        [URGENT-04 · 9/9 上午]
第 1 步  git 基线提交（E1）             ← ✅ 已完成 e568c16（9/8），仅 push 待 PAT
第 2 步  修阻断三件套（A1 白名单 / A3 cwd / A4 env）            [URGENT-01/02 · 9/9]
第 3 步  冷启动计时（A6）               ← 9/11 前可降级为观察项
第 4 步  重新打包 dmg（A8）             ← 打不出退 dir+.zip     [URGENT-03 · 9/9 晚]
第 5 步  ★双击验收（A9）★             ← 整个 1.5 阶段的判据    [URGENT-03 · 9/10]
第 6 步  安全缺陷 C1（快速放行绕过审批）← 演示不触及则降级
第 7 步  体验项 A5 / A11 / A12 / A13   ← ⚫ 本轮砍，见紧急表 §4
第 8 步  《首次打开说明》A14 + 校内分发 ← 答辩后
第 9 步  ★嘉行联+Mochi 答辩演练（E3）★                        [URGENT-05 · 9/11]
第 10 步 演示录屏兜底（URGENT-06）      ← 9/10 24:00 前必须出片
```

## 本阶段完成判据

> **一台没有装过任何开发工具的老师电脑，U 盘拷入 dmg，双击安装，双击打开，
> 不出现终端、不出现英文报错，能正常用上校园功能。**

在此之前，桌面端都算没做完。
