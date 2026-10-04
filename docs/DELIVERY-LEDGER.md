# Mochi 交付与验收台账

> **status**: active
> **last_verified**: 2026-10-04（0.2.0 Mac arm64 镜像与复制安装验收；Windows x64 run 37170653554 完整原生构建及全新安装双角色验收通过）
> **verified_by**: Codex（实际产物哈希、Mac 45 项包内 UI 检查、Windows CI 原生/浏览器/资源/安装后启动；学校物理设备验收未覆盖）

本台账只回答“交付物在哪里、验证到了哪一层”。文件存在、构建成功、用户实测和完整验收必须分别记录。

## 0.2.0 交付物（2026-10-04）

发布页：[Mochi v0.2.0](https://github.com/linkimi2026-cmd/Mochi/releases/tag/v0.2.0)。[v0.1.0](https://github.com/linkimi2026-cmd/Mochi/releases/tag/v0.1.0) 及两个原安装包继续保留。产品内容与现有样式保持不变，本轮只修复打包闭包与验收脚本。

| 平台 | 安装器 | 字节 | SHA-256 |
|---|---|---:|---|
| macOS arm64 | `Mochi-0.2.0-mac-arm64.dmg` | 336647671 | `b5d60275d8909ed80754a74a3de3c4e516c35cc52ad7d68c0be94924f54c51b7` |
| Windows x64 | `Mochi-Setup-0.2.0-win-x64.exe` | 319344437 | `08dc0289f41ec02e1dc57cc0f0b4251dc74345ae52c855f017688fab897c51fd` |

两份安装器均提供 `.sha256` 边车。Mac 镜像校验、挂载内容与受测 App 一致性、复制安装后双角色启动及45项真实包内界面检查通过。Windows [run 37170653554](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/37170653554) 对精确源码快照 `57bc469cbc34e32e7fd7acad94a36bd3792f9e76` 完成原生构建、终端/绘图/语音模块探针、桌宠fixture、LAN发现、中文合成、按需Chromium、NSIS全新安装及教师/教室启动。两平台校园静态资源共享133文件清单，安装包只含非密钥settings-defaults种子。

边界：安装器未签名，Mac未公证；原生模块加载不等于真实ASR/麦克风验收，Windows fixture截图不等于DWM透明合成验收，学校实际网络/音视频设备仍需现场核对。原始构建与传输记录保留在本地 `output/release-20261004/`；可随源码查看的摘要在 [verification-0.2.0.json](evidence/release-20261004/verification-0.2.0.json) 和 [windows-0.2.0-ci.json](evidence/release-20261004/windows-0.2.0-ci.json)。

## 历史交付记录（截至2026-09-25）

| 类型 | 路径 | 文件大小 | 当前证据 |
|---|---|---:|---|
| 参赛源码包 | `release/submission/Mochi-参赛源码包-2026-09-14.zip` | 见同目录 `.summary.json` | 自动排除安装器、PPT、视频、缓存、运行数据和密钥；含逐文件清单；ZIP 完整性、敏感信息和 500 MB 上限由脚本检查 |
| 完整参赛交付包 | `01-Mochi-参赛交付包-2026-09-14/` | 以 `05-校验/delivery-manifest.json` 为准 | 位于项目根目录，作为评委与现场演示的统一入口 |
| Windows x64 归档 | `release/2026-09-13-windows/mochi-windows-x64-34728914066.zip` | 462,320,016 B | 文件存在；归档内含 EXE 和校验文件；用户确认 Windows 一体机全部功能实测正常，但本轮未绑定包哈希与设备记录 |
| Windows x64 当前包 | [私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-0597efba861a9ddbd468) 中的 `Mochi-Setup-0.1.0-win-x64.exe` | 465,483,569 B | 私有 [run 36092244751](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36092244751) 在提交 `9cd4a0c9a5433a78cd7bf5f20ac42b6fad4d50b6` 上全绿；548 项 / 93,113,336 B 精确源码快照。配对码、LAN 自定义 UDP 端口、Windows 原生 Kokoro、桌宠真实 Electron 运行及四张合成截图、NSIS、唯一无密钥设置种子、解包版与**安装到新目录后**的教师/教室启动均通过，四次启动输出 `MOCHI_DESKTOP_SMOKE_OK`。教室板顶部 PNG 为 23,194 B / SHA256 `13ecc8db3d97e281b7b7a7ee2191368c59cd314f830aeba8bf525c7f3eee5758`，底部为 24,911 B / SHA256 `7fa495c6c24bae99ada7a0144ea90ef366b394216aad012a477b26b7b7ff4cc5`，确认两张不同；仍只是合成 fixture 的应用内容截图。Actions artifact 因配额失败，CI 把 EXE、95 B `.sha256` 边车和四张 PNG 转存私有草稿 Release；Release API 核实目标提交匹配。EXE 资产 SHA256 `6d0c80150ec8b02c408aed9d409c6fbf3b00800b413971e47f7be4ea73213e77`。安装器未签名；学校实机网络、真实 Key、扬声器及 Windows DWM 透明合成仍未验收。 |
| Windows x64 前一成功候选（模型页循环修复后、本轮课件升级前） | [私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-36eb17618668122564d4) 中的 `Mochi-Setup-0.1.0-win-x64.exe` | 465,479,330 B | 私有 [run 36062403850](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36062403850) 在提交 `a830c0f52c2e9c631515881a87f2eb475df5e1bf`（tree `eb9cb71014013e486161a4583961dbdfa241cd1a`）上核对 547 项 / 93,084,557 B 精确源码快照；配对码回归、原生 Kokoro（18,044 B WAV）、NSIS、解包版教师/教室启动 7.3 秒 / 6.0 秒，以及**安装到新目录后**唯一无密钥设置种子核对与教师/教室启动 6.4 秒 / 6.1 秒均通过。四次启动都输出 `MOCHI_DESKTOP_SMOKE_OK`。Actions artifact 因配额失败，GitHub Release API 核实 draft=true、目标提交匹配；EXE 资产 SHA256 `df8c48fb3b5409fa617819c390f0a9484f22162f326f43598f080a56a6d45940`，95 B `.sha256` 边车资产 SHA256 `35431c078bbd2ef0dc69de78fa346313d1a260b3ca49af4d83fb35d4c94eb0e5`。安装器未签名；学校实机网络、真实 Key 和扬声器仍未验收。 |
| Windows x64 前一成功候选（配对修复后、模型页循环修复前） | [私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-d512a0983f39671027a8) 中的 `Mochi-Setup-0.1.0-win-x64.exe` | 465,478,276 B | 私有 [run 36052484007](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36052484007) 在提交 `a742c988e1e7b502a45cc3e29ad3dacb73c0cec9` 上通过配对码回归、原生 Kokoro、NSIS、无密钥种子和解包版双角色启动；EXE SHA256 `9da70cccaa9d36878edb1c6aea84aa109562906f5b630ae1ce2b07a96495e1f2`。后续 [run 36059879685](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36059879685) 首次通过实际 NSIS 安装后双角色启动，但仍早于模型页循环修复，保留为测试门禁历史。 |
| Windows x64 前一成功候选（配对修复前） | [私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-742f6e959f9eb8598c2e) 中的 `Mochi-Setup-0.1.0-win-x64.exe` | 465,475,789 B | 私有 [run 36040854416](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36040854416) 在提交 `8cb898724052fab1f610662c4ba15202f9afb969` 上通过原生 Kokoro、NSIS、包内唯一无密钥设置种子核对，以及 packaged teacher/classroom 启动；两者均输出 `MOCHI_DESKTOP_SMOKE_OK`，耗时约 7.5 秒 / 5.1 秒。Actions artifact 因配额上传失败；GitHub Release API 核实为 draft、目标提交 `8cb898724052fab1f610662c4ba15202f9afb969`，EXE SHA256 `4641fb7eb82401129c67aff418dddd05d4abe52ba1353c2511244c23cb0f3a87`，`.sha256` 边车 95 B，均已保存在私有草稿 Release。该候选早于本轮配对修复，不是学校 Windows 实机验收。首个 [run 36038536562](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36038536562) 的构建、原生 Kokoro 与 NSIS 成功，但启动门禁在启动前读取私有快照中不存在的源码设置种子路径而失败，未留下 EXE；保留为失败历史。 |
| Windows x64 上一版成功安装器 | [私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-04f57c067c3bb2e26cab) 中的 `Mochi-Setup-0.1.0-win-x64.exe` | 465,473,456 B | 私有 Windows [run 36030805114](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36030805114) 在提交 `436c4478015a9cc0a99457122dd3cd88e99cdf80` 上成功。精确快照 542 项 / 92,999,792 B 零差异；7za BZip2→TAR、列表、提取、Windows Kokoro 合成和 18,044 B WAV 检查均通过，随后 NSIS 安装器构建成功。Actions 工件上传因存储配额失败，安装器及 `.sha256` 边车转存私有草稿 Release；资源元数据 SHA256 `3061f90c981951af4b2c0e37824dc4341f9a8a113b21b5ac134df9eb972da919`。EXE 未签名；目标机安装、LAN 和扬声器听感未验证。 |
| Windows x64 上一包（历史） | [私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-854ccb9713f986a7decd) 中的 `Mochi-Setup-0.1.0-win-x64.exe` | 465,056,177 B | 原生 Windows [run 36012662277](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36012662277) 成功，草稿目标提交 `0d4f5b5f760efee1145fa914d4627c8b082d054c`；GitHub 资源元数据 SHA256 `3cab42b7aaceb058cd4414e2ee0c7603c8b5019dadc6038044a9b319cc80a9fc`。它早于本轮语音原生校验和预约双实例测试。后续 [run 36022637374](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36022637374) 与 [run 36024973225](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36024973225) 是失败的历史尝试；当前结果见上一行。 |
| macOS arm64 当前包 | `apps/desktop/release/Mochi-0.1.0-mac-arm64.dmg` | 733,932,275 B | **2026-09-25 最终教室板样式包**；SHA256 `b230ffe121c67878e3fe899443d6db40a23cda0bf82fc8d0479584b249a59dbb`，sidecar `shasum -a 256 -c` 与晋升前后两次 `hdiutil verify`（VALID）通过。非 iCloud 临时源码树保留当前 `rail-pages.ts` 原字节，发布输入清单 133 项 / 28,147,475 B 经校验。只读挂载后，`app.asar` 内 rail 编译文件与该树本次编译逐字节相同（30,565 B，SHA256 前缀 `7366b3b7`），包括最终两处样式；除 8 个 AppleDouble 元数据旁路文件（合计 1,304 B）与空目录外，包内 Mochi 资源与构建暂存的运行文件内容一致。种子只有一份非密钥 `settings-defaults.json`；目标 arm64 的 12 个 Darwin 原生模块候选均核对为 arm64。镜像内直接运行教师角色在 90 秒内无成功标记；按正常复制安装路径从 DMG 拷出的 `.app` 教师 11.7 秒、教室 2.0 秒均出现 `MOCHI_DESKTOP_SMOKE_OK`。blockmap 766,157 B / SHA256 `82cbac44640265fe9a02e055d1f20b629953f098eb9e1bebf9c59a4f1d14d1ad`。前包三件套保存在 `apps/desktop/release/archive/2026-09-25-pre-rail-pages-css/`，旧 DMG SHA 仍为 `ce469d96db28ce1f62d14b72e9f5681f168c9ec7b137f16bd143236f29c545ff`。DMG 未签名、未公证；学校实机、网络、扬声器及 Gatekeeper 分发影响仍未验收。 |
| macOS x64 | `apps/desktop/release/Mochi-0.1.0-mac-x64.dmg` | 737,227,186 B | 文件存在，时间戳 2026-09-13 08:41；本轮未重装验证 |
| 当前参赛宣传片 | `promo/output/Mochi_80秒_2K120帧_V5.mp4` | 50,792,708 B | 用户于 2026-09-14 指定；已核对为 2560×1440、120 fps、80 秒；纳入当前交付目录 |
| 宣传片 V6（未入本次交付） | `promo/output/Mochi_100秒_2K120帧_V6.mp4` | 70,406,888 B | 较晚的磁盘导出，规格为 2560×1440、120 fps、100 秒；用户曾反馈约 17 秒处过慢 |
| 参赛 PPT | `参赛PPT/Mochi四分钟答辩/output/Mochi_四分钟答辩_内嵌视频.pptx` | 51,240,326 B | 当前五页四分钟版；结构与修改页渲染通过；媒体和结尾动画已在本机WPS验证 |
| 教师手册 | `参赛材料/教师使用手册.md` | 以当前工作区为准 | 本轮已按当前产品逻辑修订，提交前仍应和最终安装包实走一遍 |
| 作品说明 | `参赛材料/作品说明.md` | 以当前工作区为准 | 本轮已修订关键口径，提交前仍需核对报名表要求 |

## 验收层级

| 层级 | 含义 | 当前使用方式 |
|---|---|---|
| A · 磁盘存在 | 文件路径和大小可以读取 | 上表全部满足 |
| B · 结构/参数检查 | 归档结构、媒体参数、文档格式可以由工具读取 | V6 参数、Windows 归档结构和打包快照已有记录 |
| C · 自动化回归 | 与交付物相关的脚本或测试通过 | 根 `npm run check`、模型卡组件 16/16、真实 Electron 空闲 30 秒零新增设置/凭据请求、教师与教室旧会话换模型回归及自然语言课件聊天回归通过。`test:chat-appointment-live-ui` 现从教师与教室两套未配对的 Electron/DSH 开始，聊天审批双端配对后再签名提交预约、教师确认和教室收回结果；本机脚本化模型调用 12 次，不能证明真实模型理解或审批者是成人。Mac 当前 DMG 的 sidecar、`hdiutil verify`、最终 rail 编译字节、运行资源闭包、唯一无密钥种子、arm64 原生模块及镜像复制后双角色启动均通过；包含当前两处教室板样式。Windows [run 36092244751](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36092244751) 在 548 项精确快照上通过配对码发现、自定义 UDP 端口、原生 Kokoro、桌宠顶部/底部不同 PNG、NSIS、解包版与安装目录双角色启动，四次均输出 `MOCHI_DESKTOP_SMOKE_OK`；当前 EXE、边车和四张截图在私有草稿 Release，Actions artifact 因配额失败。学校实机验收仍待做。 |
| D · 用户现场确认 | 用户在真实设备上确认可用 | 既有 Windows 一体机使用确认不覆盖本轮新加入的自然语音下载与播放；这些仍待目标机验收 |
| E · 证据完整归档 | 包哈希、设备、系统版本、测试步骤、截图/录屏可以复核 | Windows 一体机尚未达到这一层 |

`test:chat-appointment-live-ui` 曾完整通过从未配对到预约回复的本机双实例流程；2026-09-25 的后续多次源码态复测在 DSH Web Host 启动时触发 `WEB_HOST_TIMEOUT`，未进入模型或 LAN 业务调用。因此 C 层记录保留历史通过证据，同时标注当前本机复测不稳定；Mac 复制安装后的双角色启动与 Windows 原生 CI 安装后启动是各自独立的证据，均不替代学校双机实测。

根 `npm run check` 的最新全量执行未通过：核心插件 149 项中 147 项通过、2 项在 30 秒门限处取消；两项课件用例单独执行分别通过（5.75 秒、5.09 秒）。因此上表所写“根 `npm run check` 通过”是此前阶段的证据，不能代表这次全量执行；超时原因仍未定位。

## 不能写成已完成的事项

- V6 尚不能写成“节奏问题已经修复”或“当前参赛批准版”。
- 校园服务器报告和公网服务尚不能写成“已恢复并通过验收”。
- 当前 DMG 已完成镜像、包内容与复制后双角色启动核验，但未签名、未公证；Gatekeeper 对分发安装的影响未在全新 Mac 上验证。
- 当前 Mac 包按无密钥种子方式构建，不能写成“开箱已有可用 API Key”；教师默认设置存在但相应账户仍需配置并验证。从 DMG 复制后的应用已通过双角色启动，仍未用真实供应商 Key 调用。
- 当前 Windows 候选已通过 CI 配对码回归、Kokoro、NSIS、唯一无密钥种子核对、解包版及实际安装目录双角色启动，EXE 和 sidecar 保存在私有草稿 Release。CI 冒烟不能代替学校实机的真实供应商 Key、网络、扬声器或完整安装体验验收。
- 参赛 PPT 的现场 Windows WPS 兼容性尚未实测；当前不把本机验证扩大为所有平台验证。
- 历史源码 ZIP 不代表当前内容；当前 `2026-09-14` 源码 ZIP 已重新生成并登记。
- **不能写“安装包开箱即用的默认模型已可用”**：出厂默认链 `mochi-aiaaa`
  （`https://aiaaa.cc/v1`）2026-09-19 复测为 `403 INSUFFICIENT_BALANCE`。
  该路由的配置本身正确（模型、能力、上下文声明均已按实测事实校准），
  但账户余额未恢复前，该历史链不可宣称可用。2026-09-24 新包未预置 Key，需老师主动配置并连接测试。

## 本轮 macOS 安全出包（2026-09-24）

`MOCHI_PLAYWRIGHT_BROWSER_RESOURCE_ROOT=/tmp/mochi-pw-clean` 与独立的受管 `--release-input-root` 配合 `--without-key-seeds` 重建当时 Mac arm64 DMG；发布输入清单 SHA256 `fee639c97b6fbf2b697688c8d99655df670b4def023a00554b364a02d36da00b`，133 项 / 28,147,475 B，校验通过。该包 734,373,760 B，SHA256 `8c3794412b170f14f31784fafee8993a1a5468c3e7889df38614e957e2015b3d`，边车与 `hdiutil verify` 通过；只读挂载的 asar、三个语音模块和唯一非密钥 `settings-defaults.json` 已核对。从该镜像复制应用后，教师角色（13.2 秒）与教室角色（2.0 秒）分别在隔离用户目录启动，exit 0 且出现 `MOCHI_DESKTOP_SMOKE_OK`；教师还写入非密钥默认设置且凭据引用为零。上一候选已归档。该包未签名、未公证，复制冒烟不等于全新 Mac 人工安装。此后 Windows 专用 tar 路径又修改，该时点 Mac 包未按新源码打包。Windows 快照 541 项 / 92,985,176 B 零差异，私有分支 `codex/mochi-windows-20260924` 的 [run 36022637374](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36022637374) 与后续 [run 36024973225](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36024973225) 最终均在语音归档清单阶段失败；当前成功构建见上表。校园有线双机、真实供应商 Key、扬声器音质及目标机 PPT/WPS 仍待验证。

2026-09-25 的较早 System32-tar 阶段 Mac 候选为 734,122,716 B，SHA256 `b54eff4fc9a26ee532ad53536743f3ea262e8187ad67252a79ee504aa6aa1d78`；同一受管发布输入、无密钥参数和干净浏览器资源根。边车、`hdiutil verify`、只读挂载三个语音模块与非密钥种子检查通过；复制后教师 12.3 秒、教室 1.9 秒均启动通过，镜像已正常卸载。该候选归档于 `apps/desktop/release/archive/2026-09-25-pre-system32-tar/`。此 Mac 启动证据不验证 Windows 系统 tar 或语音发声；当前 Mac 包见上表。

## 打包输入的两个硬约束（2026-09-19 落守卫）

1. **压缩配额只能改 preset，不能改 patch**：`dsh-web-app` 把宿主面的
   `compaction-basic` 置为 `disabled: true`，而 dsh 行补丁只替换 `config`、不碰
   `disabled`。判据：`--dump-config` 里该行是否带 `disabled: true`。
   真实位置 = 各 preset 的 `agent.cordis.yml` 压缩组（守卫：
   `test-compaction.mjs` 断言 `maxTokens >= 16384`）。
2. **浏览器资源根必须干净**：`stageMochiResources` 对它走**无过滤整目录拷贝**，
   多余条目会被原样打进安装包且**不报错**。曾因资源根里嵌了一层 hold 目录
   （1.0 GB）使 dmg 从 733 MB 涨到 1.13 GB；去掉后回到 699 MB。
   守卫：`prepare-mochi-resources.cjs` 的 `assertBrowserResourceLayout`
   （只允许 `LICENSE` / `browsers` / `credits.html` / `credits.txt` / `metadata.json`），
   反向用例在 `test-package-resources.mjs`。
3. 附带提醒：`apps/desktop/release/*.dmg.sha256` **不由打包脚本生成**，
   是手工边车。重打包后必须重算，否则会出现「旧哈希配新包」。

## 本轮打包决定（2026-09-19）

本轮**两个平台都重出**。触发原因不是文档整理，而是桌面端确实进了代码：新增 rail 悬浮窗四件套、`check-native-abi.cjs` 原生 ABI 守卫（09-19 fs-ext 陈旧二进制事故的守门人）、`smoke-packaged.cjs` 出包验收通道。

- **macOS arm64**：本机构建，`dist:mac:arm64` 直接产出 dmg（733,197,188 B）。构建链顺序为 `build` → ABI 守卫 → `electron-builder`。
- **Windows x64**：CI 构建（私有仓 `codex/mochi-windows-20260919` → run `35423708830`）。守卫脚本必须随快照走，所以清单从 504 收敛到 505 条（新增 `apps/desktop/scripts/check-native-abi.cjs`）——否则 CI 会在 `dist:win:x64` 里因为找不到该文件而失败。
- 两次构建的差异可核对：新工件比 run #34 大 340 B，正是 `package.json` 新增的两个 scripts 条目。
- run #34 的包（462,326,955 B）保留在同目录作对比，不作当前交付物。

### 本轮同步到 Git 的两次推送

| 目标 | 结果 |
|---|---|
| 公开仓 `linkimi2026-cmd/Mochi` | 本地 `329245c`（279 文件）→ 远程 commit `fced960b`；新 tree `02b2e608` 与本地 `HEAD^{tree}` 逐条等价（远程多出 0 / 本地独有 0 / hash 不同 0，共 1205 个 blob） |
| 私有仓 `jyl-campus-health` | 快照 commit `8d28eeeef3da` 推入 `codex/mochi-windows-20260919`；四项核对全过（mochi-source 506 blob == 清单 506；逐条 sha1 与本地自算一致；无清单外文件；仓内其他 1215 条与基线逐条相同） |

## 提交前最小清单

1. 确认比赛平台要求的文件名、格式、大小和作者信息。
2. 对最终 Windows 包计算 SHA-256，并把设备型号、Windows build 和实测日期补入 `参赛材料/真机验收记录.md`。
3. 从最终包走一遍：选择工作区 → 全部允许 → 切工作模式 → 课件/文档/建模 → 校园查询 → 授权写操作 → 打开产物。
4. 完整播放当前 80 秒宣传片，复核字幕、乱码、遮挡、音量和结尾文案。
5. 逐页检查参赛 PPT，确认数字、截图、作者信息和二维码均指向当前版本。
6. 需要源码交接时，从当前工作区重新生成快照，不复用旧 ZIP 的“最新”字样。

## 历史交付物

`release/`、`apps/desktop/release/` 和 `promo/output/` 中的旧版本保留用于回退和对比。是否可分发以本台账和目标平台验收为准，不能仅按修改时间或文件名判断。
