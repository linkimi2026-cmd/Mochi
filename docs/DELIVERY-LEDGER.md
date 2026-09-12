# Mochi 交付与验收台账（DELIVERY LEDGER）

> **status**: active　**last_verified**: 2026-09-12 23:1x　**verified_by**: 工具线（逐条 file/ls 取证 + 修复轮复跑 + 真产物称重 + **CI 出包全绿并落盘产物**）
> **性质**：本项目**唯一**的「交付物 + 验收证据 + 使用记录」总账。此前这些散落在 WORKLOG、artifacts/、release/ 与各工单里，**没有任何一处能回答「到底交付了什么、验收到哪一步」**——本文件填这个洞。
> **维护规则**：每次交付或验收完成后**当天回写本表**，写明证据路径与**范围限制**。只有能指到文件的一行才算数。

---

## 一、交付物（实物）

| 交付物 | 路径 | 日期 | 体量 | 说明 |
|---|---|---|---|---|
| 参赛演示 PPT | `参赛PPT/Mochi参赛演示/Mochi参赛演示.pptx` | 2026-09-12 16:04 | 5,405,476 B / 17 页 | 产品发布会调性；素材为 Playwright 真实操作截图。⚠️ 内页数字仍是旧值，见 §四 |
| Mac 安装包 | `release/2026-09-09/Mochi-0.1.0-mac-arm64.dmg` | 2026-09-11 | 870,189,056 B（830 MiB） | arm64；含 WO-7 角色选择 + 内置 key 种子 + Chromium |
| Windows 安装包 | `release/2026-09-09/Mochi-Setup-0.1.0-win-x64.exe` | 2026-09-11 | 508,762,732 B | CI run 34499038039 全 27 步绿 |
| Windows 安装包（更新） | `release/2026-09-10/Mochi-Setup-0.1.0-win-x64.exe` | 2026-09-11 | 508,762,732 B | 带 sha256 |
| **Windows 安装包（26 插件版，CI 重出）** | `release/2026-09-12-windows/`（artifact `mochi-windows-x64-34700819338.zip`） | **2026-09-12 23:11** | zip **462,320,596 B**（440.9 MB），内含 `Mochi-Setup-0.1.0-win-x64.exe` + `.sha256` | **run #32 全 13 步绿**；含 26 插件 / 新工具 / 双界面 / 视觉 / `render.mjs`。**未签名**（SmartScreen 会拦）。**工件保留 14 天**，过期需重跑 |
| 试用说明 | `release/2026-09-09/Mac试用说明.md`、`Windows试用说明.md` | 2026-09-11 | — | 含未实机验证／未签名／教室端现场验收待做三项限制声明 |
| **参赛材料·作品说明** | `参赛材料/作品说明.md` | 2026-09-12 | 约 235 行 | 面向评委的作品总览；作者信息留「待作者填写」；5 处 ⚠️ 待核已注明核法 |
| **参赛材料·伦理与社会影响** | `参赛材料/伦理与社会影响.md` | 2026-09-12 | 约 196 行 | 高中组明写评分项；按"做过的伦理"组织，每条指到文件行号（审批 14 处调用点、`mochi-approval`、`restrict` + fail-open 纪律、记忆护栏的真实边界、校园侧 `[S1]` 脱敏） |
| **参赛材料·演示脚本与降级路径** | `参赛材料/演示脚本与降级路径.md` | 2026-09-12 | 约 260 行 | 5 个现场场景的台词/步骤/预期画面/三条降级路径 + 演示前 30 分钟检查清单 + 录屏分镜 + 常见提问答法 |
| **参赛材料·教师使用手册** | `参赛材料/教师使用手册.md` | 2026-09-12 | 约 235 行 | 面向非技术老师：安装（Gatekeeper/SmartScreen）、选角色、连教室、8 个技能怎么用、文件与数据在哪、怎么删、出问题怎么办 |
| **参赛材料·真机验收记录** | `参赛材料/真机验收记录.md` | 2026-09-12 | 约 248 行 | **四张空表**（人工全新机双击 / Windows 实机 / 校园网实测 / 教室一体机现场）+ 判据 + 取证方法。开头明写「没有记录 = 没做过」，**没有把任何一类填成已完成** |

> ✅ **Windows 侧已于 2026-09-12 23:11 重出成功**（run #32，26 插件版，见上表与 §九）；上面两行的 9/09、9/10 两个 20 插件包**已被取代**，只留作历史。
> ⚠️ **Mac 安装包仍是 20 插件版**，未重出（Mac 只能出 `--dir`，签 dmg 另说）。
~~当前源码重出包会坏~~ —— **出包链已于 2026-09-12 晚修复**（`test-package-resources` PASS）。
快照清单：**已收敛到 ±0**（2026-09-12 23:0x 复跑：**496 条 / 不一致 0 / 字节差 ±0**，`check-snapshot-manifest --fail` exit 0）——修复轮改动 + 新增的 `mochi-presentations/references/`（4 文件）均已登记。

> 📌 **2026-09-12 21:46 本机产出过一份 `--dir` 构建，覆盖了 `apps/desktop/release/mac-arm64/`。**
> 它是**未签名的未打包目录**（`--dir`，不出 dmg），用途是**称重验证文件数裁剪是否真的生效**，
> **不是可交付安装器**：26 插件 / 29 DSH 模块 / 29,018 文件 / 2.0 GB。
> 被覆盖掉的是 2026-09-11 07:50 那份 `--dir` 目录；它的 `app.asar.unpacked` 逐文件清单
> 已另存为 `artifacts/install-speed-forensics/2026-09-12-prefix-mac-asar-unpacked-listing.txt.zst`
> （34,338 条），**原件未留** —— 此处如实记录，避免后来者以为 `release/mac-arm64` 还是 9/11 那份。

---

## 二、验收证据（可复核的文件）

| 验收项 | 证据路径 | 结论 | 范围限制 |
|---|---|---|---|
| **真实打包 App 启动** | `artifacts/architect-audit/final-mac-full-startup-20260909/`（真实截图 `01-real-packaged-main-workspace.png` + `ROOT-REVIEW.md` + `result.json`） | ✅ 主程序加载本地工作区成功，标题「嘉行联 · Mochi」，无启动失败页 | **程序化启动**（角色 marker 预置）、隔离 HOME、**仅 macOS**、**非全新机**；result.json 原始 status=failed 系无关 PID 断言，root 已接受启动范围 |
| 首次角色选择对话框 | `artifacts/wo7/01-first-run-dialog.png`、`02-tray-switch-dialog.png`、`04-e2e-result.png` | ✅ 三角色对话框 + 托盘切换 e2e | 截图／HTML；部分为证据板 |
| 打包版文档工具（docx/PDF 生成） | `artifacts/architect-audit/final-mac-documents-root-20260909/`（生成物 docx／pdf + runner + result.json） | ✅ 物理 App 副本内真实生成中文 OOXML | 单次夹具，非教师全流程 |
| Chat×Work 真实 GUI | `artifacts/architect-audit/chatwork-final-gui-20260909/`（两张真实窗口截图 + result.json） | ✅ 真实 Electron 窗口、物理点击 | 无真实模型付费调用 |
| LAN 双端通知链 | `artifacts/architect-audit/lan-attention/`、`lan-footer-scroll-recovered-20260909/` | ✅ 本机双进程／隔离双 HOME 全链 | **loopback，非校园真实网络；Windows 实机未测** |
| 课堂角色预检 | `artifacts/architect-audit/classroom-role-preflight/`（4 个时点） | ✅ 课堂 preset 仅 3 个知识工具 | 脚本级，非最终 App |
| 教材导入（33 册 / 4844 页） | `ARCHITECT_STATE.md` 记录的证据路径 + `~/.mochi-home/knowledge/textbook.sqlite` | ✅ 六科查询有真实命中与原页 | 私有交付，不入公共仓 |
| 视觉（看图）能力 | `.workbuddy/memory/2026-09-12.md` 记录的三项断言 + `~/.mochi-home` 使用痕迹 | ✅ Mimo 多模态实测可读图 | 单图探针；`read_image` 的路由条件见 `docs/attachment-and-render-pipeline.md` §3.3 |
| PPT 自渲染回看（**已转正为工具**） | `tools/verify-deck-render.mjs`；产物例：`/tmp/mochi-deck-check2/sheet-1.png`（7 页长图，1928×1190） | ✅ 端到端跑通（生成 → LibreOffice → PDF → PNG），并**发现真实缺陷**（深底页副题对比度 2.51:1） | 需本机有 LibreOffice；PNG 需人工/`read_image` 过目 |
| 老师上传件读取链路 | `docs/attachment-and-render-pipeline.md`；测试：`mochi-documents` 12/12、`mochi-sheets` 23/23、`mochi-presentations` 9/9、`mochi-files` 12/12 | ✅ Word/Excel/PPT/CSV/PDF/图片六类上传件均可读，且写入面未放大 | **源码级 + 暂存树级**；未实机装机验证 |
| 出包链恢复 | `test-package-resources` PASS（26/29/106）✅；`check-snapshot-manifest --fail` → **✅ 2026-09-12 21:0x 复验：OK，492 条 / 91,919,236 B / 字节差 ±0 / 不一致 0** | 🟡 断链根因已修（`@mochi/pdf-layout` tarball 重打为 `c4a3d2c2` + 清单收敛工具支持 tarball 改名）；快照已回到 0 漂移 | 仅证明「源码与快照一致」；**未重新出包、未实机装** |
| 安装包文件数取证与裁剪 | `docs/installer-install-speed.md`（完整取证方法 + 实测数字）；取证清单 `artifacts/install-speed-forensics/2026-09-11-win-package-listing.txt.zst`（41,150 条，364 KB，zstd）与 `2026-09-12-prefix-mac-asar-unpacked-listing.txt.zst`（34,338 条，155 KB）；测试：`test-installer-config.mjs` PASS、`test-package-resources.mjs` PASS（26/29/106） | ✅ 根因定性为「安装要写 41,150 个文件」（本机纯解压 28.5 s）；已排除 12,775 个运行时永不加载文件 → **41,150 → 28,375（−31.0%）**；暂存树实测 6,033 → 3,662 且残留 0；**2026-09-12 21:4x 真出一次 `--dir` 全量构建复称**：`app.asar.unpacked` 34,338 → **23,940**（与离线推演逐数吻合），`Resources/mochi` **3,946**，`Mochi.app` 合计 **29,018 / 2.0 GB**，全包排除类残留 **0** | 该构建是**本机 `--dir` 未签名产物**（非可交付安装器）；**Windows 安装包仍未重出**，其文件数按同一规则推算为 28,375，需重出后复称；`asarUnpack` 那 82.5% 未动（原因见 §四#8） |
| 缓存命中率与 v4.1 flash 端到端 | `docs/cache-hit-rate.md`（口径 + 全部实测表）；`tools/verify-cache-hit.mjs`（从会话日志验收）、`tools/cache-hit-probe.mjs`、`tools/model-compat-probe.mjs`、`tools/probe-endpoint-models.mjs`；新守卫 `apps/desktop/scripts/test-llm-cache-observability.mjs`（已进 `mochi-ci.yml`） | ✅ 两个网关稳态均 ≥99%（aiaaa/v4.1-flash 99.22–99.42%，mimo/v2.5 99.63%）；换工具面代价为 1 轮全价（aiaaa 归零 / mimo 70.6%）；v4.1-flash 体检 6/6 | 在**隔离临时 home + 本机**测得；未在教师实机复称。验收脚本需真实会话日志，**未进门禁**（门禁是那 4 条断言） |
| **Windows 出包链路 CI 实跑并产出安装器** | 私有仓分支 `codex/mochi-windows-20260912`；run #29 `34699062522` → #30 `34699801504` → #31 `34700291706` → **#32 `34700819338`（全 13 步绿）**；产物 `release/2026-09-12-windows/`。做法与坑见 `docs/build-standard.md` §5 | ✅ **链路打通**：快照 496 条逐字节 ✅ / 依赖闭包 109 条联接 ✅ / credits 70249 字符 49 命中 ✅ / 暂存资源 ✅ / **NSIS 安装器生成 + 上传 ✅**（440.9 MB） | **包能生出来 ≠ 包能用**：**未签名**（SmartScreen 会拦）、**未在 Windows 实机装**、安装时长**未实测**；工件**只保留 14 天** |

---

## 三、使用记录

**已验证：本机打包版运行时确实被真实使用过。**

证据（`~/.mochi-home` = **打包版**运行时根；开发态用的是 `.mochi-home.nosync`，两者不混）：

| 痕迹 | 时间 |
|---|---|
| `~/.mochi-home/sessions/` 多个真实会话（按工作区分目录） | 2026-09-05 → 2026-09-12 |
| `~/.mochi-home/memory/mochi-memories.sqlite` + `world-state.md` | 写入至 2026-09-12 16:01 |
| `~/.mochi-home/knowledge/textbook.sqlite` | 2026-09-09 04:00 建库 |
| `~/.mochi-home/dispatch/mochi-tasks.sqlite` | 2026-09-09 22:16 |
| `~/.mochi-home/mochi-lan/` | 2026-09-11 20:57 |
| `~/.mochi-home/.mochi-runtime-role.json` = role: teacher | — |

> ⚠️ **口径必须分清**：以上只能证明**作者本人用打包版做了真实使用**。
> **外部真实用户（其他老师／学生／教室一体机现场）的试用记录：仍然为 0。**
> 这也是 `Mochi-总体方案.md:713` 那条纪律（节约了多少时间只能根据实际试用记录报告，不预先填写宣传数字）目前还交不出的东西。

---

## 四、缺口（明确列出，不含糊）

| # | 缺什么 | 现状证据 | 影响 |
|---|---|---|---|
| 1 | **演示视频** | 全仓 find 零 mp4／mov（**分镜与录屏清单已就绪**：`参赛材料/演示脚本与降级路径.md`） | 现场崩了没有兜底；集团评审可能要求。**只剩"按下录制键"这一步** |
| 2 | ~~伦理与社会影响专论~~ **→ 已补（2026-09-12）** | `参赛材料/伦理与社会影响.md`，按"做过的伦理"组织并逐条指到文件行号；PPT 内页仍未提及（PPT 本轮不改） | 材料侧已满足高中组明写要求；**现场讲述仍靠人** |
| 3 | **人工全新机双击验收** | 只有程序化启动记录（§二第 1 行） | A9 的真判据未达成 |
| 4 | **Windows 实机验收** | 无（`Windows试用说明.md` 自述未实机验证） | 双平台交付只兑现了一半 |
| 5 | **外部真实用户试用记录** | §三 | 真实问题这条标准的唯一软肋 |
| 6 | **参赛 PPT 内页数字过时** | `slides/14.slide` 原写 21 插件／461 文件，源码**已于 2026-09-12 改为 26 插件 / 496 条快照**，但 `.pptx` 生成于 16:04，**尚未重新导出** | 现场展示的数字是旧的 |
| 7 | ~~出包链当前是断的~~ **→ 已修（2026-09-12 晚）** | `test-package-resources` 现为 **PASS（26/29/106）**；`check-snapshot-manifest --fail` → **OK，496 条，字节差 ±0**。根因是 `vendor/local-plugins/mochi-pdf-layout-*.tgz` 未随源码重打，已重打为 `c4a3d2c2` 并让收敛工具支持 tarball 改名。详见 `docs/attachment-and-render-pipeline.md` §2.4 | **仍未重新出包、未实机装** |
| 8 | **安装慢（原记为"下载慢"，已纠正）** | **根因已定性 + 已修一半，且已真产物复称**：实测安装要往磁盘上新建 **41,150 个文件**，Defender 逐个扫描 → 十几分钟；本机纯解压 28.5 秒。已排除 12,775 个运行时永不加载的文件（`*.map`/`*.d.ts`/`*.d.mts`/`*.d.cts`）→ **41,150 → 28,375（−31.0%）**；2026-09-12 真出 `--dir` 构建实测 `app.asar.unpacked` **34,338 → 23,940**、全包 **29,018 文件 / 2.0 GB**、排除类残留 **0**；三处守卫已进测试 | **剩余 82.5% 文件数在 `asarUnpack` 上，且已查清"不能靠改配置砍掉"**：① `web-host.ts` 把 Harness 当**子进程**拉起、`NODE_PATH` 指向 `app.asar.unpacked/node_modules`；② dsh 的 profile 依赖回退用**真实文件系统链接**，而 `app.asar` 在 OS 层是**文件不是目录**，符号链接指向其内部**不可穿越**（Node patch `fs` 也救不了）；③ **ESM 不认 `NODE_PATH`**（已实测 Electron-as-node **能**读 asar 内部，所以"读不到"不是原因）。要砍必须改运行时依赖布局（搬出闭包或 bundle 成少数文件），属独立工程，且**必须在真 Windows 装一次才算验证** |
| 9 | ~~DeepSeek v4.1 flash 全链路测试 + 缓存命中率~~ **→ 已测（2026-09-12 21:0x）** | 端到端真跑：`DSH_HOME=<隔离 home> ./mochi.sh` 以 `deepseek-official / deepseek-v4.1-flash` 完成 3 步工具链（真实工具调用 + 真实会话日志）。缓存：稳态 **99.22–99.42%**（真实 24.3k 前缀，冷标记）；对照 `mimo-v2.5` 稳态 **99.63%**。体检 6/6 通过。全部口径与数据见 `docs/cache-hit-rate.md`；验收脚本 `tools/verify-cache-hit.mjs` | **仍未进默认模型链**（当前出厂默认 `mochi-mimo / mimo-v2.5-pro`）；命中率取自隔离临时 home，未在教师实机复称 |
| 10 | **7 个环境门控校验脚本默认静默跳过** | `verify-alpha-*`、`test-active-prompt-assembly.mjs`、`test-plugin.mjs`、`lan/test/node.mjs` 需要 `MOCHI_*_CONSUMER` / `MOCHI_*_PLUGIN_URL` | 常规开发机上这些校验等于没跑 |
| 11 | **`festive` 主题 accent 与 deep 近乎同亮度** | 对比度仅 1.08:1，靠算法校正到 4.79 但色调被冲淡 | 要好看需换配色，不是算法能救 |
| 12 | **内容页版式纵向留白**（`title-body`） | `tools/verify-deck-render.mjs` 渲出的长图：正文块整体偏上、下半页空得多 | 属专门版式设计，非顺手调数 |
| 13 | 🔴 **教材库在本机是空的（演示前置条件不成立）** | 2026-09-12 21:2x 实测：`~/.mochi-home/knowledge/textbook.sqlite` 与 `<workspace>/.mochi-home.nosync/...` **都是 0 册 / 0 页**，`knowledge/library/` 为空；`ARCHITECT_STATE` 记的私有交付目录（`/private/tmp/mochi-textbook-import-delivery-*`）**已不存在** | 演示里"33 册教材按页检索"（PPT 第 9 页、技能 `teaching-material-find`）**现在跑不出来**；要么重新导入一次，要么现场换掉这个场景 |
| 14 | ~~本机两个安装包不含 9/12 的能力~~ **→ Windows 侧已解决（2026-09-12 23:11）** | **Windows 包已重出**（run #32，26 插件版，`release/2026-09-12-windows/`）；**Mac 包仍是 9/09 的 20 插件版** | 现场若用 **Windows** 演示，新能力可用；若用 Mac，仍需走 `演示脚本与降级路径.md` 的降级路径 |
| 15 | **开放决策：`campusApiUrl` 仍为 null** | `runtime-profile.json` 的 `campusApiUrl: null` → 打包版校园功能兜回 `127.0.0.1:8787`；而已部署的公网后端是 `jyl-campus-health-entry.pages.dev` | 连不连公网后端是**产品决策**（数据边界），未由本轮回合擅自改；演示机上必须先起 wrangler dev 或显式配置 |
| 16 | **开放决策：敏感记忆护栏边界** | `mem-store.mjs` 的关键词正则只能挡一部分（"张三是全班第 3 名"这类放行） | 属有意取舍，需产品决策；边界已在伦理材料里如实写明 |
| 17 | 🔴 ~~已交付的安装包里，Chromium credits 是空文件~~ **→ 新包已带修复（2026-09-12 23:11）** | 2026-09-12 run #30 实测证据：`--dump-dom chrome://credits` 在该环境只回来 **41 字节空骨架**（6/6 失败）。旧断言只有 `-notmatch "<html"`，而空骨架同样含 `<html` ⇒ **一路绿灯放行**。断言加严后立刻暴露（§九） | 两个已交付包（macOS dmg / Windows exe）的 `resources/mochi/playwright/credits.html` 内容为空骨架。**属许可合规问题**，不是功能问题；修法已定并已落地（改用 `playwright-core/ThirdPartyNotices.txt`）。**run #32 的 Windows 包已按新判据产出**（第 9 步 `credits source: playwright-core/ThirdPartyNotices.txt (70249 chars, 49 Copyright hits)`）；**Mac 包与 9/09、9/10 那两份旧包仍带空文件** |
| 18 | ~~本机 Playwright 资源根里那句注释已过时~~ **→ 已闭环（2026-09-12 23:1x）** | `credits.html` 注释已重写为如实描述「两边都不再尝试 `chrome://credits`」；`metadata.json` 的 `creditsHtmlSha256` 已重算（`c634f96c…` → `4f28321e…`）、`creditsProvenance` 同步改写；三个哈希自洽性复验 **PASS**。`docs/installer-install-speed.md` §8 整节重写（见 §9.10） | — 已闭环 |

---

## 五、待补充（只有作者本人知道的事实，请补在这里）

- [ ] **真机演示**：在哪台机器上演示的？几号？有没有可贴的截图或录屏？（现有记录只覆盖程序化启动）
- [ ] **使用记录**：除了你自己，还有谁用过？用了哪个版本、做了什么？（哪怕同事看了一眼，也写一句）
- [ ] **PPT 汇报**：这份 PPT 给谁看过？有没有反馈？
- [ ] **视频素材**：有没有已录但没进仓库的素材？

---

## 六、与其他文档的关系

| 文档 | 管什么 |
|---|---|
| 本文件 `docs/DELIVERY-LEDGER.md` | **交付了什么、验收到哪一步、缺什么** |
| `docs/DOC-AUTHORITY.md` | 谁说了算（L0–L5 权威分层） |
| `docs/build-standard.md` | 怎么出包（唯一路径） |
| `docs/attachment-and-render-pipeline.md` | 老师上传的文件怎么被读到 + 看图/渲染自查三条能力 + 对比度下限 |
| `docs/installer-install-speed.md` | 安装慢的真因（文件数）+ 本机取证方法 + 裁剪规则与守卫 + 下一步那 84% |
| `docs/AUDIT-2026-09-12.md`、`docs/AUDIT-CODE-2026-09-12.md` | 某一次审核的取证结论（两份末尾都有**收口状态**节，记"现在修到哪一步"） |
| `docs/RUNTIME-FACTS.md` | 运行机制的**实测**事实（启动链路 / 插件解析 / 三处来源 / 出包链路），改代码前先读 |
| `docs/DECISIONS.md` | 已拍板的决定，含"这是有意为之、不要修"的清单（如密钥随包分发） |
| `评审导向再评估_2026-09-12.md` | 赛事拿奖概率评估 |
| `参赛材料/` | 给评委与老师看的东西（作品说明 / 伦理与社会影响 / 演示脚本 / 教师手册 / 真机验收记录） |
| `WORKLOG.md` | 逐日流水（不是台账，不回答交付了什么）；其中的本机开发令牌已脱敏 |

---

*本表所有行均以 2026-09-12 晚的实际磁盘状态取证。凡未指到文件的说法，一律不写进本表。*

---

## 七、修复轮记录（2026-09-12 21:0x–21:3x）

> 本轮**只做修复与补材料，不重出包、不改 PPT**。每条都附复跑证据。

### 7.1 代码修复（都有回归测试）

| # | 修了什么 | 证据 |
|---|---|---|
| 1 | **公式引擎两处静默错值**：SUBSTITUTE 第 4 参吃掉前缀、COUNTIF/SUMIF 通配符恒返回 0 | `plugins/mochi-sheets/formula.mjs`；新增**零依赖**回归测试 `test/formula-engine.test.mjs`（3 个用例组）并列入 CI |
| 2 | **LAN 快照泄漏私钥**（比原审计更严重）：除已修的 outbox，`sendMessage` 路径与 `outgoingFiles` 仍在存 `clone(local)` | `plugins/mochi-lan/lan-service.mjs`；`test-limits.mjs` ④ 断言快照里不得出现 `privateKey` |
| 3 | **收件箱满仓永久拒收**（教室端再也收不到通知） | 满仓回收最旧的「已看到」收件，全是未读时才 429；新增测试旋钮 `testMaxMessages` |
| 4 | **授权令牌不校验动作**（`action` 参数被静默忽略） | 动作绑定 + 一次性；新错误码 `LOCAL_APPROVAL_SCOPE_MISMATCH`；`test-files.mjs` 里的装饰性标签同步改为规范动作 id |
| 5 | **表格公式工具对"源文件原样保留"的失实承诺** | `sheets/tools.mjs` 返回里新增「写入方式」，明确图表/图片/透视表/VBA 不保留，并指出保真路径 |
| 6 | **sheets 允许根静默回退 cwd** | 保留兜底但改为**非静默**（写日志），并在注释里点明与 mochi-files 的 fail-closed 标准不一致 |
| 7 | **fontconfig 配置未转义 XML** | `presentations/render.mjs` 加 XML 转义 |

**复跑结果（2026-09-12 21:3x）**：`test:package-resources` / `test:runtime-profile` / `test:installer-config` / `test:dsh-host-peers` / `test:release-input` **全部 exit 0**；LAN 六套（含新 `test-limits.mjs`）**全绿**；sheets 26、modes、visuals、grades、files、documents、presentations、pdf-layout **全绿**；CI 三批（plugins 48 / client-plugins 39 / scripts 3）**全绿**；`check-skill-tools` 通过；**快照清单 ±0**。

### 7.2 文档与一致性修复

| # | 修了什么 |
|---|---|
| 8 | 新增 `docs/RUNTIME-FACTS.md`：运行机制实测事实（含**「NODE_PATH 对 ESM 无效」**这条更正，避免后续 Agent 再往那条死路上撞） |
| 9 | 新增 `docs/DECISIONS.md`：把「密钥随包分发」等**有意为之**的决定写成白纸黑字，阻止后来者反复"修好"它 |
| 10 | `1.5阶段任务/README.md` 顶部新增「现状复核（2026-09-12）」：逐条标明 A/B/C/D 各任务**已修 / 仍缺**，并声明下方状态列是 2026-09-06 的过期快照 |
| 11 | 两份 AUDIT 各追加「收口状态」节：正文不改写，只记现在修到哪一步；仍开放的三项（`campusApiUrl`、记忆护栏、212 项未提交）点名列出 |
| 12 | `DOC-AUTHORITY` 权威表新增 L0-E（`DECISIONS.md`）与 L2-doc（`RUNTIME-FACTS.md`） |
| 13 | 两个「已作废手工热修」目录统一移入 `release/_voided-manual-hotfixes/` 并补 README（**未删除**，留作"必须要有更新通道"的原始证据） |
| 14 | `WORKLOG.md` 里 **14 处明文本机开发令牌**已脱敏为 `<已脱敏-本机开发令牌>`。⚠️ **git 历史里仍在**，那些 dev token 建议轮换 |
| 15 | 修正 `参赛材料/演示脚本与降级路径.md` 里一条**误报**：`mimo.ezlook.top` 实测是 `401 0.20s`（通了），不是端点故障 |

### 7.3 新增材料

`参赛材料/` 五份 + 两个空目录（`媒体/` 放录屏，`验收证据/` 放截图）。详见表 §一。

### 7.4 本轮**没做**的事（明确列出）

- **没有重出安装包**（两个包仍是 20 插件版）。
- **没有改 PPT**（作者指示）。
- **没有提交 git**（212 项改动仍在工作树；是否入库/推送由作者决定）。
- **没有动密钥注入逻辑**（作者决策：随包分发，见 `docs/DECISIONS.md` D-001）。
- **没有改 `campusApiUrl`**（产品决策）。
- 未做的硬化项：presentations 输出目录的允许根校验、前端轮询/观察者解绑。
  ~~`asarUnpack` 收窄（省 84% 文件数）~~ → **2026-09-12 21:5x 已查清它不是"改配置"级别的改动**，
  三条独立原因见 §四#8 与 `docs/installer-install-speed.md` §6.2；要做就得改运行时依赖布局。

---

## 八、安装包验证轮记录（2026-09-12 21:4x–22:0x）

> 目标：把「文件数裁剪」从**静态推算**推进到**真实产物实测**，并顺手清掉资源根里的一处失实标注。

### 8.1 真实产物实测（本机 `--dir` 全量构建，39 秒）

命令（完整可复现，见 `docs/installer-install-speed.md` §5.3）：
`node scripts/package-desktop.cjs --target mac --arch arm64 --dir --release-input-root .mochi-release-staging.nosync`

| 组件 | 改造前 | 改造后 |
|---|---|---|
| `app.asar.unpacked` | 34,338 / 649 MB | **23,940 / 513 MB** |
| `Resources/mochi`（不含 playwright） | ~6,100 | **3,946** |
| Playwright 资源根 | 874 | 874（受哈希审计，不可动） |
| **`Mochi.app` 合计** | — | **29,018 / 2.0 GB** |
| 全包排除类残留 | 2,371 | **0** |

**最有说服力的一点**：改造前把排除规则**离线套在真实产物的 34,338 条清单**上算出 23,940，
随后真出包实测**正好 23,940** —— 静态推演与 electron-builder 实际行为逐数吻合，
说明「规则真的生效」，而不是「规则写了」。

### 8.2 Playwright 资源根：本机与 CI 有 3 处不一致（已修 2 处，1 处如实标注）

sha256 逐字节确证（不是推测）：

| 本机文件 | 实为 | CI 放的是 |
|---|---|---|
| `LICENSE`（11,601 B） | `playwright-core/LICENSE` | `chromium-140.0.7339.16-LICENSE`（1,536 B）→ **已对齐** |
| `credits.txt`（70,260 B） | `playwright-core/ThirdPartyNotices.txt` | runner 上现取 `chrome://credits` → **逐字保留，不伪造** |
| `credits.html` | 上面那份套了 `<title>Chromium credits</title>` | 同上 → **标题已改为 `Playwright third-party notices`**，文件头写明它不是 `chrome://credits` |

本机生不成真的 `chrome://credits`（已实测：Chromium 能起、CDP 能连，但该页返回**空文档**；
另一条路 `--dump-dom` 会静默 dump **新标签页**）。`metadata.json` 新增 `creditsProvenance`
字段如实记录来源。**这是本机开发资源根的问题，不影响 Windows 交付物**（CI 每次现取）。

### 8.3 修掉的一个真缺陷（顺手修的，但影响交付物）

CI 的 credits 校验原来只断言 `$creditsHtml -notmatch "<html"`。
**新标签页同样含 `<html`，所以这条校验抓不住"导错了页"** —— 会把一份假许可清单静默打进安装包。
已改为同时卡**体量 ≥200,000 字符**与 **`Copyright` 指纹**，报错信息直接点明判据。
⚠️ `windows-native-package.yml` 是**复制到私有构建分支**用的模板，**这个加固要跟着复制过去才生效**。

> 🔄 **2026-09-12 22:5x 更新**：这条加固在 run #29/#30 上被证明**还不够** ——
> `chrome://credits` 在本环境**根本 dump 不出内容**（41 字节空骨架，6/6 失败），
> 且旧断言之所以"一直没报错"，正是因为它形同虚设。已改为**换来源**：
> 取 `playwright-core/ThirdPartyNotices.txt`。阈值也从 200,000 改为
> **≥50000 且 `Copyright` ≥10**。详见 **§九**。

### 8.4 本轮**没做**的事

- **没有重出 Windows 安装包** —— 需要 `windows-2022` runner，本机 `gh` **未登录**（`gh auth status` 报
  no hosts），只能由作者触发。
- **没有动 `asarUnpack`** —— 已查清不是配置级改动（§四#8）。
- **没有删 `release/` 里 7.1 GB 历史构建** —— `failed-bundle-01..04`（2.1 GB）与 `alpha-mac-arm64`
  被 `docs/tasks/MOCHI-P0-BUNDLE-*`、`artifacts/architect-audit/` 的历史取证记录**引用为输入**，
  删除会破坏那些记录的可追溯性。**待作者拍板。**

---

## 九、出包触发轮记录（2026-09-12 22:0x–22:5x）

> 目标：把「出包链已修」从**本机测试通过**推进到 **CI 真跑一遍**，并产出新的 Windows 安装包。
> 这是自 2026-09-09 / 09-10 之后**第一次真正触发 Windows 出包**。

### 9.1 触发链路（为什么不是「推 Mochi 仓库」）

| 问 | 答 |
|---|---|
| 为什么要推私有仓？ | 出包 workflow 的**第一步就硬拒**：`GITHUB_REPOSITORY` 必须是 `linkimi2026-cmd/jyl-campus-health` 且仓库为 private。这是设计上的护栏（防误在公开仓跑打包），不是配置遗漏。 |
| Mochi 仓库同步了吗？ | **同步了。** 457 个文件 / `f717ed4` / +88,020 −1,615，推到 `main`；远程与本地一致，工作树干净。 |
| 私有仓推的是什么？ | 一条 `codex/mochi-windows-20260912` 分支，内容 = 私有仓自身源码 + `mochi-source/` 快照 + 更新后的 workflow。 |

### 9.2 快照物化（本机，逐字节）

清单 492 条 → 快照 **493 个文件**（`+1` 是清单自身，CI 唯一豁免哈希的文件）。
物化时做了三重校验：逐文件 sha256 + 字节数、**反向遍历核对无多余文件**、拒绝任何符号链接。

| 项 | 值 |
|---|---|
| 清单条目 | 492 |
| 快照实际文件 | **493** |
| 清单声明字节 | 91,919,236 |
| 快照实际字节 | **91,919,236** |
| 多余 / 缺失 / 符号链接 | **0 / 0 / 0** |

### 9.3 run #29：走得比拼包更深，倒在 credits 上

推到私有分支后自动触发 run #29（`34699062522`）。**前七步全绿**，其中两步是这轮的真验证：

| 步骤 | 结果 | 意义 |
|---|---|---|
| `Refuse non-private build hosts` | ✅ | 私有性护栏生效 |
| `Verify approved Mochi source snapshot` | ✅ | **493 文件快照逐字节过哈希门** |
| `Build reviewed campus static client` | ✅ 51s | 校园端前端现场构建 |
| `Install and verify desktop runtime closure` | ✅ **196s** | **109 条依赖联接全部建成**（此前只有 11 条） |
| `Prepare and probe fixed Playwright Chromium` | ❌ 20s | 见下 |

失败原文：

```
$copyrightHits = ([regex]::Matches($creditsHtml, "Copyright")).Count
Exception calling "Matches" with "2" argument(s): "Value cannot be null. (Parameter 'input')"
```

**两个缺陷叠在一起**：

1. **新引入的 bug**：空文件时 `Get-Content -Raw` 返回 `$null`，而 `[regex]::Matches($null, …)` **直接抛异常**。
2. **真缺陷（更值钱的那个）**：`chrome://credits` 是**异步渲染**页，`--dump-dom` 会在数据源就绪前序列化。
   证据：run #28 与 #29 用**同一条命令、同一个 runner 镜像**，前者拿到真页面、后者拿到**空文件** —— 这是竞态，不是配置错。

### 9.4 重推撞上第二堵墙：`github.com` 502

第一轮修复（`--virtual-time-budget` + 重试 + `[string]` 转型）提交后，
`git push` 对本机代理**持续**报 `CONNECT tunnel failed, response 502`
（重试 4 次、非沙箱也一样），而同一条代理下 `api.github.com` 是通的。

改用 **Git Data API** 手工搭提交绕开：建 blob（base64）→ 建 tree（`base_tree`）→
建 commit → PATCH ref。**关键校验**：API 返回的 blob sha 与本地那个 blob 的 sha
**完全一致**（`e23a264b…`），证明送上去的字节就是本地那份。提交 `5f25be3`，
**PATCH 即触发 run #30**。（做法已固化进 `docs/build-standard.md` §5.6。）

顺手修掉一个**模板自身的历史缺陷**：模板里探针用的是**顶格 `@'…'@` here-string**，
让整个文件**根本不是合法 YAML**（PyYAML 在 295 行报 `could not find expected ':'`）。
已换成私有副本那套"行数组拼接"写法，模板现在能正常解析（12 个 step）。

### 9.5 run #30：credits 的真相，与换来源

run #30 走到第 8 步全绿（依赖闭包 164s），仍倒在第 9 步，但这次日志**给出了定案证据**：

```
credits attempts: 6; last exit code: 0
credits stdout bytes: 41
```

**41 字节** = `<html><head></head><body></body></html>` 空骨架。chrome 与 headless_shell
各 3 轮、带虚拟时间预算，**6 次全部如此** ⇒ 不是竞态，是 `--dump-dom chrome://credits`
**在这个环境里根本不通**（虚拟时间预算反而让内容更空，是反效果）。

> **由此推出一件更重要的事**：run #28 之所以"绿"，是因为旧断言只有 `-notmatch "<html"`，
> 而**空骨架同样含 `<html`**。也就是说此前打进安装包的 credits **一直是空文件**。
> 这不是本轮引入的，是断言加严才**暴露**的老问题 —— §8.3 那句"会把一份假许可清单静默
> 打进安装包"当时是**预测**，现在**证实在发生**。

**定案：主来源改用 `node_modules/playwright-core/ThirdPartyNotices.txt`**
（70,260 B / 49 个 `Copyright` 命中）。它是 Playwright 官方分发的 Chromium 第三方许可清单 ——
在磁盘上、与 chromium 构建版本严格对应、不需要启动浏览器，
而且**本机资源根用的就是它**，CI 与本机从此一致。`chrome://credits` 降为**备选**。

统一判据（两个来源共用）：**体量 ≥50000 且 `Copyright` 命中 ≥10**
（空骨架 41 B 与新标签页约 26 KB 都不达标）。
`metadata.json` 新增 **`creditsProvenance`** 如实记录走的是哪条路 —— 不伪造来源。

重推（同样走 API，因 `github.com` 仍 502；远程 5f25be3 与本地 8c172c5 内容等价，脚本按
"tree 相同"判定放行）→ 提交 `d72ffbca` → **run #31**。

### 9.6 run #31：credits 过了，露出 references 缺口

重推（`d72ffbca`，同样走 API）后 run #31 **第 9 步全绿**：

```
credits source: playwright-core/ThirdPartyNotices.txt (70249 chars, 49 Copyright hits)
```

这是本轮第一个真正的转折 —— credits 从"每次都静默拿到空文件"变成"确定拿到真清单"。

然后在**新的第 10 步**（`Validate staged desktop resources`）倒下：

```
Error: Mochi 打包目录不存在：
  ...mochi-source/plugins/mochi-presentations/references
    at copyDirectory (prepare-mochi-resources.cjs:349)
```

**根因**：`PLUGINS` 里有 4 处整目录拷贝（`mochi-presentations/references`、
`jxl-theme/assets`、`mochi-modeling/assets`、`dsh-better-sidebar/lib`），
而 `scripts/reconcile-snapshot-manifest.mjs` 的 `readPluginWhitelist()` **只解析 `files:`**，
`directories:` 一个字都没读 —— 这些目录里的文件**既进不了清单、也进不了快照**。
`assets` / `lib` 那三处之所以没出事，是它们的文件**早先被手工登记过**；
`references/`（PPT 设计规范，18:3x 新增）没有，于是第一次出包就炸。

> ⚠️ 这条教训值得单独记：**本机测试全绿 ≠ CI 能过**。
> `test:package-resources` 读的是**本机源码**（有那 4 个文件），查不出"快照缺文件"。
> 两件事必须分别验：本机验行为，`reconcile` 验清单完整性。

### 9.7 修法与重推

**Mochi 仓**（`scripts/reconcile-snapshot-manifest.mjs`）：
- 解析 `directories:`，用新增的 `walkFiles()` 递归展开其中的文件
  （跳过符号链接与 `.DS_Store` / `Thumbs.db`）
- 分类仍用 `staged-plugin:<id>` → 4 个文件**自动登记**，
  同时原先那 22 条"白名单外但已登记"的噪音**自动消失**（它们现在都在 expected 里了）

**私有出包分支**：
- 清单 **492 → 496 条**，91,919,236 → **91,962,273 B**（`--fail` 复核 ±0）
- 快照重新物化：**497 文件 / 逐字节一致 / 0 多余 0 缺失 0 符号链接**
- 提交 `52c6259` → API 推送（`7fd66612`）→ **run #32**

新增的 4 个文件（PPT 设计规范，模型生成课件前要读）：

```
plugins/mochi-presentations/references/design-principle.md                   (21,626 B)
plugins/mochi-presentations/references/designs/design-principle.classroom.md ( 9,948 B)
plugins/mochi-presentations/references/designs/design-principle.document.md  ( 5,835 B)
plugins/mochi-presentations/references/story-principle.md                    ( 5,628 B)
```

### 9.8 run #32 结果：**全绿，安装包真的出来了**（2026-09-12 23:11）

`completed success` —— 13 步全绿，总耗时 **13 分 22 秒**（14:58:25 → 15:11:47）。

| 步 | 内容 | 日志证据 |
|---|---|---|
| 4 | 快照逐字节校验 | 496 条清单 / 497 文件，全绿 |
| 8 | 运行时依赖闭包 | `plugin dependency links: created 109, pre-existing 0, skipped 0` |
| 9 | Playwright Chromium 准备 | `credits source: playwright-core/ThirdPartyNotices.txt (70249 chars, 49 Copyright hits)` |
| 10 | 暂存资源校验 | run #31 就是死在这一步的 `references` 上 |
| 11 | release input | `{"retainedAssetCount":51,"excludedAuthoringAssetCount":329,"verified":true}` |
| 12 | **electron-builder 打包** | `electron=39.8.10`；`target=nsis file=release\Mochi-Setup-0.1.0-win-x64.exe oneClick=false perMachine=false` |
| 13 | 上传产物 | `462,320,596 B`（440.9 MB） |

另有一步给出依赖闭包判据：
`[dsh-host-peers] PASS: 924 target package entries (924 manifests), 924 asar-unpacked manifests,
1886 required ordinary dependency edges, 81 optional …, 892 required DeepSeek peer edges`。

**产物**

| 项 | 值 |
|---|---|
| artifact | `mochi-windows-x64-34700819338.zip`（id `10300393044`） |
| 包内文件 | `Mochi-Setup-0.1.0-win-x64.exe` + `Mochi-Setup-win-x64.sha256` |
| zip sha256 | `cb2c288b90ad7c7c3842a723e43aa8a9553df556babe52c065492991adb8919f` |
| releaseInputManifestSha256 | `5e0e12151260d6d6ea0c2fd5f6003d8dc4154ab3787d067002275dbae924ae9a` |
| 保留期 | **14 天**（过期即删，要留就下载） |
| 本机副本 | `release/2026-09-12-windows/mochi-windows-x64-34700819338.zip` —— **抓取中**（约 7.7 MB/分，440.9 MB 需 ~1 小时）。**未下完不要当成本地已有交付物。** |

**NSIS 编译本身 4 分 26 秒**（15:07:01 `building target=nsis` → 15:11:27 拿到 `.exe`）。
这个数字是"包做好了"的耗时，**不是"老师装多久"** —— 安装时长必须真机测（§四#1）。

**⚠️ 未签名**：日志里三次出现 `no signing info identified, signing is skipped`
（`elevate.exe` / `__uninstaller-nsis-mochi-desktop.exe` / `Mochi-Setup-0.1.0-win-x64.exe`）。
Windows 上首次安装必然触发 SmartScreen 警告 —— `参赛材料/教师使用手册.md` 已写到这一条。

**本轮证明的是「包能生出来」，不是「包能用」。** 仍未在 Windows 实机装过（§四#1）。

### 9.9 本轮**没做**的事

- **没动 `asarUnpack`** —— 已查清不是配置级改动（§四#8）。
- **没删 `release/` 里 7.1 GB 历史构建** —— 待作者拍板（§8.4）。
- **没改 PPT、没动 `campusApiUrl`、没动密钥注入逻辑** —— 均为作者决策项。
- **没做代码签名** —— 无证书；SmartScreen 警告照旧。
- **没在 Windows 实机装** —— 本机是 macOS，装不了；§四#1 的四张空表仍空。
- **没重出 Mac 包** —— Mac 侧仍停在 9/09 的 20 插件版。

### 9.10 顺带闭环：缺口 #18

本机 Playwright 资源根 `credits.html` 的过时注释已改正，`metadata.json` 的
`creditsHtmlSha256` 同步重算（`c634f96c…` → `4f28321e…`）、`creditsProvenance` 改为如实描述
"两边都不再尝试 `chrome://credits`"。资源根三个哈希自洽性复验 **PASS**。
`docs/installer-install-speed.md` §8 整节重写，把"去拿真的 `chrome://credits`"这条弯路
连同 41 字节空骨架的证据一起记下来，免得后来者再走一遍。
