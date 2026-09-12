# 开源复用审查

> ⚠️ **历史记录（historical）· 2026-09-12 标注**
>
> **status**: archived　**last_verified**: 2026-09-12　**verified_by**: 工具线
>
> 本文是 2026-09-06 前后的复用审查留痕，**其中的数字均为该时点数字，不是现行真值**：
> 文中出现的「插件总数 12 / 11」「只限 12 插件、29 运行模块资源闭包」，
> 与「桌面实际 0.1.2-rc.1」等，**均已过时**。
> **现行真值**：插件 **26** 个（`prepare-mochi-resources.cjs` 的 `PLUGINS`）、
> 内核 **`0.1.3-alpha.1`**（同文件 `PLUGIN_RUNTIME_VERSIONS`）。
> 正文原样保留，仅供追溯。参见 `docs/DOC-AUTHORITY.md`。

> 打包/出包的唯一路径、什么会进包、快照清单重算方法，见 [`build-standard.md`](./build-standard.md)。本文仅保留当时的复用审查记录。

## 2026-09-06 · MOCHI-P0-PACKAGE-01

目标：修复已有 Electron 资源 staging 的实际依赖缺失，保持 dsh、官方 SPA、runtime-profile.json 和现有安装链路。

实际检索顺序：先完整应用与框架生态，再已有打包组件。搜索词：`github electron desktop AI application sidecar AnythingLLM Jan`、`github electron-builder electron forge extraResources packaging`。随后用 GitHub API 核验仓库信息、提交，用固定提交的 package.json/LICENSE 与打包类型源码核查实现。部分 API 请求 TLS 超时/EOF；重试与原始文件读取成功。不属于无权限或未找到方案。最初 builder 的 `v25.1.8` tag 返回 404；实际 tag 为 `electron-builder@25.1.8`，已核实。

| 候选 | 已查看版本/提交 | 许可与维护证据 | 本任务相关功能及决定 |
|---|---|---|---|
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | eb7df1e81c284236e1759ec7897904dc22a6704d | MIT；API archived=false，pushed_at 2026-09-04 | 完整本地 AI 应用；实际根 package.json 含 server/collector/frontend 与 Prisma 安装链。整套采用会替换既定 Harness/数据体系；不采用。未验证其桌面 sidecar 恢复能力，不沿用旧报告“没有一家做好”的结论。 |
| [Jan](https://github.com/janhq/jan) | e2185dbc7db3a002da35b3688b57910ec6fd87b2 | API license=NOASSERTION；固定提交 LICENSE 正文明确 Apache 2.0；archived=false，pushed_at 2026-09-04 | package.json 实际使用 Tauri 与独立平台构建链。整套采用改变 Electron 边界；不采用。 |
| [Electron Forge](https://github.com/electron/forge) | 6c9b951efe50b70960b5b22e173409831909e6f1 | MIT；archived=false，pushed_at 2026-09-04 | 完整打包发布工具生态。项目已有 builder/NSIS/dmg/staging 测试；本次换链增加迁移维护成本，无必要。不采用新依赖，未声称验证 Forge 与 Mochi 的兼容性。 |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 本地安装 25.1.8；tag electron-builder@25.1.8，Git ref object 4e51e4cc84251698ef9c9a4f3445584637fd4d4b | MIT；archived=false，pushed_at 2026-09-04 | 固定 tag 的 PlatformSpecificBuildOptions.ts 与本地类型均确认 extraResources/asarUnpack。采用已有构建链，不升级版本；修补 Mochi 资源依赖闭包，不另写打包器。 |

兼容性实证：本地 Electron 39.8.10、builder 25.1.8、桌面 dsh 0.1.2-rc.1。规划源码 d347e703908d0406b7a7ef80e3a0e594d86b2215 在 mochi-harness-src.nosync/mochi-harness，不能把“源码存在”当成“安装包已使用”。本任务只补当前运行版本依赖，不借机升级内核或锁文件；规划版本对齐另列 P0 缺口。

已有实现：PLUGINS 与 registry 总数均为 12；mochi-web 实际插件数为 11（approval 属 mochi profile），不按过时的“9→12”重做。实现者实跑 package-resources 失败，缺 @deepseek-ai/dsh-credentials；runtime-profile 与 release-input 通过，主控复核中。

最小复用结论：保留手工审查的闭包与版本校验，补齐当前新增模型插件的传递依赖，并验证资源树内真实 ESM 导入。现有闭包只拷纯 JS；不从开发机随意搬 native 模块。保持临时 staging、禁止外网测试、symlink/敏感文件排除断言。测试结果由独立审计补录，不能以仓库 README 宣称已适配。

来源：[builder 固定版本源码](https://github.com/electron-userland/electron-builder/blob/electron-builder%4025.1.8/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts)、[官方应用内容说明](https://www.electron.build/docs/contents/)。

## 2026-09-07 · MOCHI-P0-COLD-01 复用补充

本次测量复用上述完整应用/框架审查与已有 runtime-profile.cjs、dsh CLI，不引入启动框架或另一份运行配置。测量脚本只放在 artifacts/architect-audit/cold-start，采用临时数据根、随机loopback端口、禁止模型调用；只代表当前开发机源码进程基线。依赖版本同上，不把参数级单测当成桌面就绪时间。新增实际测量与引用由该工作包报告补充，主控负责合并本记录。

## 2026-09-07 · MOCHI-P0-CONFIG-01

延续本轮已覆盖的完整应用与框架生态：AnythingLLM/Jan整套替换不符合既定dsh+Electron边界，Forge不解决运行期插件实例配置。新增实际搜索词 `site:github.com/deepseek-ai/deepseek-harness cordis patch config llm provider`。命中官方仓库 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 bundle/base/cordis.patch.yml、配置与adapter文档。核对本地固定源码 d347e703908d0406b7a7ef80e3a0e594d86b2215 的官方基础patch与LICENSE；实际执行仍是桌面已安装0.1.2-rc.1（本票不升级）。采用已有Cordis完整entry配置、runtime-profile.json声明与现有collectPluginIds/manual-region保留机制；不另建配置系统。GitHub搜索可用；不将master新功能直接假定适配旧runtime；兼容性依真实loader启动验证。

官方基础patch明确 config 为整行替换（非深合并），因此首次初始化与用户手工覆盖需区分。维护成本：新增首次配置字段只服务当前生成器，普通插件原路径保持；保留已有手工区，不在每次启动覆盖用户endpoint/models。默认模型参数从既有运行配置的非秘密字段投影核验，非供应商规格；实际key不复制。验收采用临时无凭据home、真实MIMO apply/loader、幂等和手工override保护，独立冷启动复验。上游维护状态本票未额外复核API，未声称其最新版本稳定；采用的是已有固定版本机制。

### MOCHI-P0-PACKAGE-01 接入后独立验证

主控审阅两文件真实diff，并在Node24亲跑 package-resources/runtime-profile/release-input全部PASS；现有Node22.22.2亲跑package-resources亦PASS。实际Electron39.8.10内置Node22.22.1以ELECTRON_RUN_AS_NODE=1、--expose-internals从临时资源真实导入MIMO与sidebar成功。独立新Node进程阳性导入通过，移走临时dsh-credentials后阴性进程明确ERR_MODULE_NOT_FOUND（阳性0/阴性1），临时树已清理。结论只限12插件、29运行模块资源闭包；完整App还发现新home的MIMO实例config缺失，正按MOCHI-P0-CONFIG-01处理，不能据此放行P0。

## 2026-09-07 · MOCHI-P0-IGNORE-01

先审完整模板生态 [github/gitignore](https://github.com/github/gitignore)，再核查Node模板与Git规则语义。实际搜索词 `site:github.com/github/gitignore Node.gitignore Global Backup gitignore`、`site:git-scm.com/docs/gitignore symbolic links trailing slash directory`；仓库main提交361f1e6afa729dc58ec33bf0849772a03ddf6822（2026-09-04），LICENSE核实CC0 1.0。已有模板用于语言/工具通用忽略，不能识别Mochi本地SQLite状态和特定源码zip；部分采用现有Node惯例，在原.gitignore做少量项目规则补充，不引入工具或依赖。Git官方规则明确尾斜杠只匹配目录，不匹配同名symlink，已与本仓三个node_modules链接的check-ignore结果核对。

采用：保留原规则，加node_modules无尾斜杠以覆盖链接，补.sqlite/-wal/-shm/-journal，本机.workbuddy与指定harness zip。维护成本为常规Git规则，无运行时影响。不整体忽略所有md/zip/artifacts以掩盖待审文件，不删除/移动文件、不改index。用真实文件的git check-ignore验证，并核查普通源文件仍可见；低影响配置不额外写测试实现。来源：https://git-scm.com/docs/gitignore 。

MOCHI-P0-IGNORE-01接入后：执行者逐项24个SQLite与3个链接全部命中；主控独立复核三链接/代表SQLite/.workbuddy/指定zip以及正常源码/docs不误忽略，git diff --check通过，index为空。本票PASS，不等于全仓可提交。

## 2026-09-07 · MOCHI-P0-SIDEBAR-BUILD-01/02

先沿用本轮完整应用/框架生态比较（AnythingLLM、Jan、Forge不替换dsh/Electron），再验证已采用的插件生态：[DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)，本地固定commit a5c52b3f1bc450b04578bd9252f67b7d79c98502、package0.18.0、MIT；其现成注册tab/viewer能力已被workbench消费，保留插件而不重写。实际搜索词 `site:github.com dsh-better-sidebar`、`site:github.com/pnpm/pnpm 11.8.0 packageManager frozen lockfile`。GitHub API核实sidebar与[pnpm](https://github.com/pnpm/pnpm)均archived=false、2026-09-06有push；不把维护活跃等同适配通过。

已审sidebar package/lock/AGENTS与官方build脚本：Node>=20、pnpm11.8.0、dsh相关peer/dev0.1.2-rc.1，实际build为tsc+tsdown。只从固定commit archive导出，无旧lib/node_modules。首轮offline frozen install因本地缺pnpm11.8.0缓存退出，未到编译；明确不是源代码build失败。

BUILD02允许在新的隔离临时树获取准确的包管理器与锁定依赖，以验证可重建性；不改原仓库、全局工具或锁文件。主控读取npm官方registry pnpm/11.8.0元数据：MIT，Node>=22.13（当前Node24满足），tarball https://registry.npmjs.org/pnpm/-/pnpm-11.8.0.tgz，sha512-wfXnxMskHI8XS3Q4UdgvQrgCMkr8iw8Ra5atsVqgZmSUjd42lgo7oQebpbSyndAUATW5S1tfUmNZIknWjlVfJg==。执行者需下载后核完整性再执行，锁文件前后hash不变、实际构建/导入和输出manifest作为证据。维护成本是复用原固定构建链；不得通过换pnpm版本或复制旧lib掩盖失败。新依赖下载仅公共npm包，不外发项目/用户数据；结果仍只限macOS，不改变正式Git子模块关系。

## 2026-09-07 · MOCHI-P0-PACKLIST-01

本票属于BUNDLE01同一打包链，复用本轮完整应用/框架比较与electron-builder25.1.8固定版本审查，不另换工具。主控读真实安装的app-builder-lib/out/fileMatcher.js#getMainFileMatchers并直接执行：当前files=dist/**/*使旧dist/mac-arm64/Mochi.app/Contents/Info.plist及Resources/app.asar均included=true；旧dist713MB。builder只排除当前输出release，不自动排除旧输出dist。不是猜测，也不靠README结论。

采用既有builder files白名单收窄：官方SPA由sidecar提供，当前main.ts只有loadURL，没有loadFile/renderer dist消费；移除已失效的dist/**/*输入，保留dist-electron及package.json与默认runtime依赖/extraResources。长期维护收益是明确打包输入，避免每次手动清除旧产物；不删除旧App、不改框架。回归直接使用该版本真实matcher核排除旧App、纳入当前主进程/manifest，随后重启原BUNDLE01验包。

CONFIG01接入后独立验证：主控diff/Node22测试通过；非实现者COLD02使用冻结cjs/json在真实dsh loader加载，全新home至有效HTTP约1.93秒，真实boot及进程/端口/tmp清理全部PASS。证明本票首次实例配置能用于当前runtime，未证明供应商参数、真实API、Finder或Windows可用。详情见docs/tasks/MOCHI-P0-CONFIG-01.md及cold-start/runs对应证据。

SIDEBAR-BUILD02接入验证：新临时HOME/store/cache、校验后的pnpm11.8.0、固定archive，无旧lib依赖；官方build退出0，166个lib常规文件。锁hash保持f6edb800ed3d90668064903e0a69c5779b1b39676bb3ee512d415489650ce886。主控审build日志并亲自在新产物目录fresh Node导入host/invariant，5/3个导出成功，锁hash复核相同。安装外层zsh记录曾因保留status变量失败，未保存外层退出码；pnpm完成日志与后续真实构建可核，不伪填安装exit0。现有lib与新lib内容一致性另查；不声称Windows、终端功能或UI挂载通过。

PACKLIST01接入验证：主控亲跑Node22测试并再次调用真实matcher：旧Info.plist/app.asar=false，当前main/manifest=true；package.json仅删旧dist glob，现有文件保留。BUNDLE01据此恢复，本票PASS仅限输入过滤。

## 2026-09-07 · MOCHI-P0-FIELDKIT-01

先查完整设备清单生态[osquery](https://github.com/osquery/osquery)，实际搜索词 `site:github.com/osquery/osquery Windows system_info physical_memory`，固定master a1bbec2541a93ddfa373b5f1da8c16f4e4505c7b；非归档、2026-08-25 push。API license=NOASSERTION，但固定commit LICENSE已实读明确Apache-2.0 OR GPL-2.0-only。已看system_info.table字段及Windows安装文档；它能做硬件清单，但此处只有一台设备、无需新安装/驻留服务，因此不整套引入。

再查[PowerShell](https://github.com/PowerShell/PowerShell)平台能力，实际搜索词 `site:github.com/PowerShell/PowerShell Invoke-WebRequest Get-CimInstance Win32_OperatingSystem`、后续Microsoft Learn针对5.1参数的搜索。仓库MIT、非归档、09-05 push，查看release v7.6.5元数据，但目标采用Win10自带Windows PowerShell5.1，不要求安装7。使用既有CIM与HTTP能力，最小封装只做非秘密字段收集与本地JSON，不新增设备Agent或认证流程。

官方依据：[CIM示例](https://learn.microsoft.com/en-us/powershell/scripting/samples/getting-wmi-objects--get-ciminstance-?view=powershell-7.6)、[Win32_OperatingSystem](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-operatingsystem)、[Invoke-WebRequest 5.1](https://learn.microsoft.com/en-us/powershell/module/Microsoft.PowerShell.Utility/Invoke-WebRequest?view=powershell-5.1)。最初小写URL open被工具拒绝，后续search命中正式文档；不得说完全无法检索。TotalVisibleMemorySize是OS可见KiB并不等于安装内存，需分开字段；HTTP使用BasicParsing、无默认凭据/无会话，401仅代表可达但未认证，DNS使短TimeoutSec并非严格总时限。目标Win10未实测，只能交付待现场运行工具与静态检查结果，不能预填环境通过。

## BUNDLE01构建工件来源补充

保持Electron39.8.10。隔离出站拒绝的首个有效build已通过tsc/node-pty rebuild，但因缓存缺Electronzip而失败；直接SHASUMS下载连接超时，没有新版本或权限拒绝。找到现有缓存zip后，主控独立GET https://api.github.com/repos/electron/electron/releases/tags/v39.8.10 核实官方asset412923961（electron-v39.8.10-darwin-arm64.zip，112032304bytes）digest=sha256:f7e3ed2cc34dd2eba3f2a95234b576fe8082d35fb133e482102c08105f298572，与缓存相同。Electron npm自带checksums.json（自身SHA256056222b4e5b327e94ed6102c2a87e77977da2ba20218233bc2019ec7787e75ff）同条目再次一致。复用校验后的缓存进入隔离构建，没有取消完整性校验或静默下载latest。

SIDEBAR五份browserJS差异追加：执行者做CSS region有界解析，差异限绝对构建根、CSS scope前缀和class-map属性顺序；规范化这些确定差异后整bundle hash相同。主控审tsdown配置确有filename:fileId/[hash]_[local]/Object.entries，且独立首次差异probe吻合。接受限于构建产物来源的解释，不要求不同路径字节一致；现有lib未替换，UI挂载仍待验收，理论枚举差异不单独列产品阻断。

## 2026-09-07 · MOCHI-P0-ASAR-01

同一BUNDLE问题沿用本轮完整应用/框架比较及固定builder25.1.8，不更换dsh/Electron。补充实际搜索词 `site:github.com/electron/electron asarUnpack node_modules ERR_MODULE_NOT_FOUND ESM`、`site:electronjs.org asar archives limitations working directory node filesystem`。官方[ASAR文档源码](https://github.com/electron/electron/blob/main/docs/tutorial/asar-archives.md)说明ASAR虚拟目录依赖Electron补丁，部分真实路径必须unpack；历史ESM issue只作参考，不套用旧版本bug结论。主控审当前安装builder平台packager实际调用getFileMatchers(config,'asarUnpack')及其options类型；无新依赖。

真实候选622MB可构建、CLI --version通过，但移到工作区外全新home启动在ready前失败：物理app.asar.unpacked树的dsh-app-boot找不到js-yaml。主控直接查ASAR header确认js-yaml/package.json已被打包，unpacked=false，物理位置不存在。不是npm依赖没选入；往extraResources的29模块列表补包不在该importer的父级查找链，无法解决。采用builder既有asarUnpack将已挑入的完整生产node_modules/**/*放同一物理树，不另写resolver或NODE_PATH逃逸，不复制开发依赖。维护成本比逐个补unpack名单低；需实际复测文件数/体积与包内启动，不能只改一项glob就宣布通过。


## 2026-09-07 · BUNDLE02 必需 peer 依赖遗漏定位

沿用本轮完整应用与框架生态比较，不为同一打包链问题替换dsh/Electron。实际新增搜索词：`site:github.com/electron-userland/electron-builder peerDependencies missing packaged 25 26 npm`、`site:github.com/electron-userland/electron-builder NpmNodeModulesCollector peerDependencies`、`site:github.com/develar/app-builder peerDependencies`、`site:github.com/electron-userland/electron-builder "peer dependencies" "25.1.8"`。检索成功，但历史issues涉及不同版本/不同依赖，不能当作Mochi已复现的根因或新版本修复证明。

已读取固定源码：[app-builder v5.0.0-alpha.10 Collector](https://github.com/develar/app-builder/blob/v5.0.0-alpha.10/pkg/node-modules/nodeModuleCollector.go)，对应本地app-builder-bin 5.0.0-alpha.10，包元数据MIT。其Dependency结构及递归只处理dependencies/optionalDependencies，没有peerDependencies。当前builder25.1.8本地createLazyProductionDeps实际调用node-dep-tree，与本轮遗漏吻合：源/lock存在且必需的cordis-plugin-group未进入候选。

另审[builder26.15.3 npm Collector](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.15.3/packages/app-builder-lib/src/node-module-collector/npmNodeModulesCollector.ts)、同tag的基类、package.json与LICENSE（MIT）。该固定版本npm分支仍以tree._dependencies筛选边。主控亲跑其npm list参数：dsh-app-boot的resolved dependencies中含group，但_dependencies只有js-yaml/resolve.exports/atomic-write。未安装或运行26.15.3构建，不能宣称它已修复此问题；仓库有后续发布/源码维护，维护活跃不等于这条peer路径可用。

选型方向：优先使用宿主显式提供peer的标准package.json dependencies机制，按当前锁定版本补完整必需peer闭包，不逐个修改产物、不写自定义Node resolver、不盲升构建器。具体清单/锁影响正由Max只读核查；未授权实施前不能写已接入。长期成本是显式维护宿主契约，并在打包前检查完整peer闭包；比依赖运行时逐个报错或拷整个开发node_modules可控。现有12插件/29资源模块仅服务插件staging，不能替代dsh物理父级依赖树。


补充标准机制依据：[npm package.json peerDependencies](https://docs.npmjs.com/cli/v7/configuring-npm/package-json/#peerdependencies)说明npm7起默认安装peer；[npm11 install](https://docs.npmjs.com/cli/v11/commands/npm-install/)说明显式dependencies与精确版本保存。当前开发树peer已装而旧builder未收集，正是安装与打包选择层差异。拟用标准宿主dependencies声明，不引入新第三方库；锁更新应在隔离副本进行且禁止重装当前含补丁node_modules。


PEERS01实施边界追加：完整collector图493节点的非optional peer缺25项；24项DeepSeek可在宿主用原锁精确版本声明，主控亲读24个安装manifest，许可证全部MIT、版本仅group1.0.2及dsh0.1.2-rc.1。另有嵌套React18.3.1，不能用宿主React19冒充满足。采用24项标准宿主声明并加明确命名的DeepSeek host-peer检查；React的官方预bundle实际消费链另做只读审查，不能据本票PASS声称全部第三方peer闭合。无库升级、无新resolver，任务明细见MOCHI-P0-PEERS-01。


React边界已取得静态实证：p0-react-peer-runtime.md追踪官方shell staticModules内嵌React18.3.1、renderer shim已bundle、host entry无UI import；主控独立从BUNDLE02 ASAR提取shell/renderer/module-loader三产物逐字吻合源文件。该nested peer元数据不单独成为本P0 Web启动阻断，保留原React版本；未声称UI mount通过。无需为元数据重写或额外拷贝React。


## 2026-09-07 · PEERS02：同一打包问题的目标目录修正

沿用上节实际GitHub检索词、完整应用/框架生态比较及固定builder25.1.8 / app-builder5.0.0-alpha.10源码、MIT许可与维护判断；本次不是新框架选型。主控与Max进一步读取当前appFileCopier.js computeNodeModuleFileSets：顶层node_modules/name，conflictDependency递归到parent/node_modules/name。BUNDLE03实际ASAR证实root sandbox/shell无法访问dsh下的llm/subprocess。源目录选中并不证明打包位置可解析。

部分采用既有PEERS01：标准宿主dependencies和打包前接线保留，扩展为完整84个必需DeepSeek peer契约（新增60个当前根lock版本，无版本冲突）。新增项许可证由实现前逐一读现有manifest确认；不得引入未审许可或新来源。复用builder实际file sets与Node require.resolve/semver，在临时只含manifest的目标布局做验证；不编写生产resolver、拷贝器或新收集器。合理推测完整宿主声明可解决布局，必须由实际目标检查和后续包内启动证实。主控隔离最小复现已验证原布局失败/根级提供同manifest成功；不等于整个App通过。

长期成本：显式宿主契约从24扩为84，版本仍锁定现有内核；升级时需联动审核。选该标准方式的理由是当前固定builder不会收集peer且会重排嵌套位置，未证明新版修复；比修改安装源码、逐个补产物或更换整个框架影响小。


## 2026-09-07 · BUNDLE04后的完整运行依赖核查

同一打包链继续沿用已执行的完整应用/框架检索。主控再次实际打开固定GitHub源码 https://github.com/develar/app-builder/blob/v5.0.0-alpha.10/pkg/node-modules/nodeModuleCollector.go 并读取本地builder25.1.8 packager.js。Maxwell只读核实正常copy固定flatten=true，没有已验证公开配置保留原npm生产树；includeSubNodeModules会在放宽files后连dev一起带入，beforeBuild=false跳过collector需外部staging，asar载体选项不改目标布局。故不采用这些开关或另造全树复制器。

BUNDLE04实际失败是普通dependencies api-gateway→deque，说明完整检查需要覆盖普通边与peer。根显式声明继续是标准npm机制；主控亦读锁定d347e7039官方[verify-packed-install.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/scripts/release/verify-packed-install.ts)，该官方隔离consumer为一组已打包family tarball统一建立根dependencies。这里只作机制参考，未升级rc到alpha，未声称官方已适配Electron。普通/peer完整差异正在清点，未授权新生产改动。

为避免第三方包不导出package.json导致假缺失，主控实测Node22.22.2标准node:module.findPackageJSON可以对bare specifier返回manifest（临时fixture仅manifest、exports不公开package.json且entry不存在也可定位）。[Node官方API文档](https://r2.nodejs.org/docs/v25.8.1/api/module.html#modulefindpackagejsonspecifier-base)说明bare包返回根manifest；固定22.22.1网页读取失败明确记录，不把失败当文档证据。当前运行器API存在/行为已有实测，但Electron22.22.1仍需独立验证。此API可用于manifest-only检查而不写自定义resolver；仍须验证目标realpath与selected集合、版本，不能把manifest存在声称为所有JS入口可执行。


完整只读结论及采用范围：实际Electron22.22.1标准findPackageJSON目标清点，DeepSeek普通434条只有api-gateway→deque失败、peer865全通过；第三方普通仅三个@types目标缺项。主控再读固定Go Collector的processDependencies，明确跳过@types/；亲读三type包manifest均空main并指types，执行者JS扫描无运行时import。主控从真实BUNDLE04 ASAR扫描全部必需普通边，扣除@types/和optional覆盖后1047条，全部标准semver范围。按builder既有类型声明排除语义单列@types，不将它们当运行模块拷入；不删普通JS运行依赖检查。

因此采用最小完整图修复：只增原锁deque0.1.2-rc.1（主控已确认manifest MIT）；不把无缺项的138个剩余DeepSeek模块全升根依赖。理由是已对整个普通+peer目标图取证，只有该一条运行断链，不是再次追第一条报错。检查扩展为全部命名空间的普通dependencies + 原有必需DeepSeek peer，标准NodefindPackageJSON/semver，保留实际builder映射/物理unpack/选中集合；optional与类型声明数量明确报告，不声称非DeepSeek peer/完整浏览器UI通过。


## 2026-09-07 · ALPHA-BUILD01：方案锁定源码的隔离官方构建

实际新增GitHub检索词：`GitHub DeepSeek Harness desktop agent framework build official release pack source`，先覆盖完整官方Harness/社区desktop生态。命中[官方完整框架](https://github.com/deepseek-ai/deepseek-harness)与[cloud-1104社区desktop](https://github.com/cloud-1104/deepseek-harness-desktop)。社区仅检索命中，未核固定版本/许可/兼容，不能称可替换或已适配，本票不采用。沿用早先AnythingLLM/Jan/Forge生态比较，按方案保留官方Harness与现有Electron。

采用已存在且本轮重新确认clean的官方源码commit d347e703908d0406b7a7ef80e3a0e594d86b2215 / 0.1.3-alpha.1，实际读取MIT LICENSE、AGENTS.md、package.json、scripts/build.ts、pnpm-workspace.yaml及postinstall入口。官方公开说明开发者预览、API持续演进，固定commit而不跟main/latest；当前目标只验证此锁定源码能否构建，不宣称下游MIMO/sidebar兼容。官方build:official完成host/client/web并写client build record，明确pnpm11.7.0、Node^22.19||>=24，复用这些现有脚本，不写第二套build系统。

维护影响：使用外部临时git archive、独立依赖存储与干净子环境，原clone/desktop/候选冻结；采用官方CI=true跳过Git hooks安装（已读postinstall该分支），不修改其依赖/锁/源码。允许按现有allowBuilds执行必要native生命周期，失败如实记录，不放宽锁或删校验。此P0只读来源/构建实证可在用户路线决定前开展，不能据此切换当前桌面依赖或改方案。成功后才决定是否有必要做官方pack消费者验证。

ALPHA-PACK01继续复用同一d347e7039官方MIT源码，不另选库。主控实际读scripts/release/pack.ts/families.ts/verify-packed-install.ts：完整family顺序pack且校验payload/buildrecord/version；dsh消费验证同时安装vendor包，在外部tmp通过普通Node执行CLI版本。采用此既有机制而非手工挑包；输出目录会被删除故仅授权新唯一目录。维护成本低于自建打包器，但consumer第三方registry范围解析不等同生产可复现锁，optional省略是官方既有策略，不能推导完整Mochi兼容。

ALPHA-PACK01失败核查实际搜索词：`site:github.com/npm/cli "Cannot read properties of null" "edgesOut" 10.9.7`。命中官方问题 https://github.com/npm/cli/issues/9787 （#loadPeerSet同症状，检索时open/needs triage/cannot reproduce）及 https://github.com/npm/cli/issues/8261 （历史同症状）。实际已确认是本机npm10.9.7/arborist加载peer时空值异常；未确认与任一issue同根因，未验证修复版本。不得据此宣称“升级即可修复”或放宽peer校验。本票不接入新库、不改工具版本，保留源包及失败输入供后续限定诊断。

ALPHA-INSTALL-DIAG01只读续诊：主控实际读取npm/cli #9787、PR #8448和本机npm10.9.7固定arborist实现。#9787案例自述npm10.8.2，不能当10.9.7已复现证明；本机实际异常位置为node.parent.edgesOut，parent为null。源码注释明确optional peer也纳入peerSet冲突计算，故--omit=optional不等同完全不解析optional peer。外部相似症状不能确定本次输入根因。Lagrange只读追257包manifest与缓存日志的vitest引入链，唯一报告p0-alpha-install-diagnosis.md，不重装、不编码。

进一步已核PR https://github.com/npm/cli/pull/8448 于2025-08-28合并208c06e；固定v11.6.0的workspaces/arborist/lib/arborist/build-ideal-tree.js在#loadPeerSet循环访问parent前有if(!node.parent)break，当前10.9.7无此保护。已读v11.6.0 package.json/完整LICENSE：npm应用Artistic-2.0，依赖各自许可，Node^20.17||>=22.9兼容22.22.2。该固定历史版本用于缺陷对比，非推荐当前生产工具或宣称最新；不采用手补npm源码、--force或legacy-peer-deps。下一隔离对比只更换外部npm命令入口，同257tarball与官方脚本，不升级项目/全局工具。尚未验证本次故障能否消除，亦不能隔离npm11其他变化或registry解析变化的影响。

NPM03沿用固定dsh/npm官方生态检索与源码/SRI/许可。新增实际读取npm官方v11 npm-install配置文档 https://docs.npmjs.com/cli/v11/commands/npm-install/ ：include可覆盖同类型omit，optional仍由平台条件筛选。已核Koffi3.2.1实际cache源码/manifest及日志证明omit平台包触发编译回退；采用标准include=optional的隔离变体，不手copy平台二进制，不装CMake，不修改原verifier。原无optional检查失败不被覆盖。源native landlock的linux-arm64 manifest明确os linux/cpu arm64，正常mac安装应按平台跳过，须实测而非宣称通过。此变体验证正常分发消费路径，不能证明缺optional仍可用。

Alpha MiMo接入前新增实际搜索：`site:github.com/deepseek-ai/deepseek-harness "reasoningEfforts" adapter`、`site:github.com "DeepSeek Harness" "medium" provider adapter`，命中官方 https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md 和discussions/843、3566、1861。讨论仅线索，实际以固定d347e7039本地llm-pi-ai源码为准；读到export PiAiAdapter、model reasoningEfforts及compat含thinkingFormat/supportsDeveloperRole/supportsReasoningEffort。采用方向先验证现有官方适配器而非把旧rc产物补丁直接搬入源；尚未接入，未称已适配。沿用固定MIT框架与已安装依赖，后续需精确核Pi依赖许可与本次wire行为。源码patch方案暂不实施，因为已有现成能力值得先验，长期维护可少一个内核fork。

ALPHA-DEPLOY01候选：固定pnpm11.7.0实际help deploy（exit0）提供--legacy/--prod且标Experimental。在线11.x文档被重定向到12.x，故只作总体参考，不冒称固定11文档；猜测的GitHub v11.7.0源码URL返回404，明确是路径检索失败。主控转读已SRI校验pnpm发行物dist/pnpm.mjs 251596起实际handler：目标空目录检查，copyProject按package files，legacy关闭dedupeInjectedDeps/global virtual store，目标内node_modules/.pnpm；saveLockfile=false但内部frozenLockfile=false，因此不声明严格frozen deploy。采用它做隔离可搬移性实证候选，尚不集成生产；保留源锁hash并检查输出版本来源/外逃符号链接。MIT许可已在BUILD01核验。同一官方Harness/pnpm生态内不写全树复制/依赖resolver。

MIMO01 接入前实证更新：固定 alpha/@earendil-works/pi-ai0.84.2（许可证与公开导出见alpha-mimo/20260906T204558Z/dependency-metadata.json），identity-v2公共Context/apply经实现者与root独立新home各一次通过。root读harness实际覆盖缺省/空串/null身份增量、四档wire/正常文本、凭据、abort。采用官方适配器作为下一配置组合验证候选；不新增传输内核。但实际profile旧手工配置不会被initialConfig自动迁移，PiAI档位标题为英文，尚不能宣称整个旧wrapper直接等价替换。

DEPLOY02实证更新：全realpath规范路径后不再出现DEPLOY01系统路径错误，后续源根postinstall顶层import lefthook/package.json失败（生产过滤副本未带dev依赖），所以仍无便携树PASS。root实际读scripts/install-lefthook.mjs:17与main:692，CI跳过分支在静态import之后；不能靠CI=true规避缺包。停止机械重试，先只读核完整BUILD01工作区复制的链接/硬链接隔离风险；不跳过所有生命周期。日志另确认fs-ext node-gyp下载Node headers并编译成功，不能描述本次为离线导出。

ALPHA-RUNTIME01转向标准tarball消费：DEPLOY03实际exit0，但搬移后2264链接中111外逃到source，不能用该策略交付；不手修111链接、不第四次重试。继续采用已通过NPM03的官方tarball根dependencies机制，按真实CLI manifest的运行/optional/必需peer图收敛family选择。root只读实际257包得228闭包，排除29（含test-runtime/session-snapshot），不删运行必需边。

新增实际检索词 `site:github.com/npm/cli overrides file tgz peer dependencies`、`site:docs.npmjs.com package.json overrides file package`，命中官方npm/cli docs及issues/9659、8470、9197。不同file目录/linked/peer场景并非本项目已复现缺陷；不据此宣称override普遍不可用。出于无需引入额外依赖改写机制且已有官方消费实证，本票不采用全图file overrides，采用标准file tgz根dependencies。固定npm11.6.0源码与许可沿用NPM02记录，不将搜索latest文档当固定版本适配证明。第三方npm解析写入consumer lock，尚未运行本票，不能称可复现或桌面通过。

ALPHA-REASONING01选型结论：已执行完整官方Harness/社区框架检索、固定源DeepSeek与PiAI源码/许可证检查、PiAI公开协议独立测试。PiAI并非功能失败，但实际patch顺序/整体config替换、旧手工实例与settings namespace迁移、无中文档位配置seam意味着替换的维护面大于本次单包兼容扩展。因此部分采用现成官方DeepSeekAdapter，限固定源码一个包增加明确模型reasoningEfforts能力，旧wrapper/profile保留；不重写HTTP/流/身份恢复、不新增依赖，不把已实现tool identity重复补。

额外约束来自源码实证：alpha默认拒绝medium，旧rc全局暴露medium并不证明DeepSeek/GLM端点支持。本次只允许明确模型声明开启medium，未声明模型保留alpha原集合；保留该负例及新增MiMo显式正例。中文名称保持现有Mochi目录行为，不编辑用户UI。source/types/schema同步、由官方生成声明，避免旧rc手改lib留下.d.ts不一致。尚未实现或通过测试，不称已集成。

ALPHA-NATIVE01实际检索词 `site:github.com/electron/rebuild electron rebuild only modules which-module`、`site:electronjs.org native modules Electron rebuild ABI`；采用 https://github.com/electron/rebuild 与 https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules 的标准重建机制。已核当前固定@electron/rebuild3.6.1包manifest/LICENSE（MIT，Node>=12.13）及lib/rebuild.d.ts的onlyModules/buildFromSource；实际builder25.1.8 util/yarn.js调用此库，已安装node-abi返回Electron39.8.10的ABI140。搜索main是维护/功能线索，兼容依据来自固定tool与实际ABI，不升级工具。

root真实独立运行RUNTIME01 moved树，Node模块ABI127下fs-ext成功，ElectronABI140下明确ERR_DLOPEN_FAILED；koffi两者成功，其他node-pty/sharp/node-addon-require-builtin public require成功但未做功能验收。采用只在新副本重建已失败fs-ext，后测真实flock排他/释放，不更换runtime、不手改.node或forceABI。生命周期可能下载官方headers，不能称离线；未重建前不称修复。

ALPHA-PATCHED-BUILD01 官方工具行为补核：同一固定 pnpm11.7.0 dist/pnpm.mjs 默认 verify-deps-before-run='install'（145943），run handler（247663）调用 runDepsStatusCheck（246820），状态不同会 runPnpmCli install。实际隔离复制源的 pnpm run build:official 因此刷新 node_modules 后成功构建；不能把调用命令中未写 install 等同没有重装。继续复用标准机制，不新增构建器；先核 stale 原因与锁图一致，避免手工关闭验证掩盖依赖不一致。


## 2026-09-07 · P1-STARTUP01 启动壳复用

root已审阅执行者完整记录 artifacts/architect-audit/p1-startup-preflight/p1-startup-preflight.md。实际先搜完整生态：`Electron desktop application tray single instance startup diagnostics MIT`、`chatboxai chatbox Electron GitHub license startup tray`、`microsoft vscode Electron tray single instance license MIT`，再搜 Electron 单实例/ready-to-show组件API。Chatbox https://github.com/chatboxai/chatbox 固定e97c1dbd4ad02d6e017b6ac4176e103f3175cb64，GPL-3.0/Electron35且活跃；VSCode https://github.com/microsoft/vscode 固定17c5935aa72fa5bfb3ea2c6f07c49280cc276a3c，MIT且活跃；两者完整产品架构超出此次壳修复，不接入。API Demos https://github.com/electron/electron-api-demos 固定26b3d1d57adc0cc1ef505cc84bceadcb51a4987c，MIT但归档/Electron15，不接入。

采用已安装Electron39.8.10内置requestSingleInstanceLock/second-instance/BrowserWindow/loadURL/clipboard，官方 https://github.com/electron/electron v39.8.10 tag ref0929f2ec036330de0425b19ccf11eb23d253ec45，MIT，无新增依赖。root已读实际main确认空窗、无重试、无单实例缺口。维护面限主进程既有边界，保留官方SPA与用户UI；接入后的真实行为仍须本票测试，不凭生态README声称已适配。


ALPHA-INTEGRATION01实际collector投影补核：普通npm图两个包虽在source根，builder将unist-util-visit-parents6.0.2移至unist-util-visit内部、micromark-util-subtokenize2.1.0移至micromark内部，使另两个根owner不可见。root四manifest无JS实验已证明NodefindPackageJSON无须入口文件，否定最初“manifest-only误报”推测，保留原checker。两包实际manifest均MIT，使用现有lock版本提升desktop直接根，不新选库/不手搬/不换resolver。正常npm后实际全checker738目标/1594普通边/892必需DeepSeek peer通过。

## 2026-09-07 · 医生桥接候选与宿主生命周期续接

沿用UI01完整Electron应用/框架生态检索与固定39.8.10/MIT，无新库。root新增实际检索词 `site:electronjs.org session.fetch cookies credentials include`，命中官方 https://www.electronjs.org/docs/latest/api/session 与 https://www.electronjs.org/docs/latest/api/client-request 。官方文档表明session网络API可使用关联会话凭据；仅作候选机制，尚未证明39.8.10主进程请求通过固定alpha的Origin fence。后续隔离验证应复用session自动cookie与已认证同源，不把raw cookie/token交给医生data页面、不重复造secret存储。此次未接入桥接代码。

HOST-LIFECYCLE01复用现有DshWebHost及Electron主进程机制。实际已核ready后child exit仍emit，但main不订阅，旧URL残留；spawn继承cwd影响官方dsh loadLayeredEnv项目层。采用受管cwd与单host有界恢复，避免引入第二个进程管理框架；实现/回归尚待票完成。

## 2026-09-07 · P1-PDF01普通输出落地

root已审阅完整复用记录 artifacts/architect-audit/p1-pdf01/P1-PDF01-REUSE.md：先查ONLYOFFICE/Collabora/Univer/sidebar Office完整生态，后采用既有docx9.7.1、PptxGenJS4.0.1、pdf-lib1.17.1及@pdf-lib/fontkit1.1.1（MIT）。完整替代框架未做固定版本适配实证，不冒称可接入；非UI普通输出复用现有共享JS底座，避免Office进程运行依赖。

FontTools4.64.0仅临时构建使用，MIT；原OFL1.1 NotoVF转静态400 TTF，生成命令/源与输出hash已纳入packages/mochi-pdf-layout/NOTICE.md。不采用实际渲染缺字的fontkit subset；接受每PDF约6.6MB完整字体一次嵌入，保留失败证据，不在运行时安装Python。root独立16测试与视觉字形检查PASS，普通生成保持可编辑Office及搜索PDF；不声称Windows Office字体注册/特殊考试模板/最终桌面包全过。

DOCTOR-SESSION-PROBE01夹具排障：root实际查询 `site.electronjs.org electron ESM top level await app.whenReady deadlock`、`site:github.com/electron/electron "whenReady" "deadlock" "await"`，命中官方 https://www.electronjs.org/docs/latest/tutorial/esm 和 https://github.com/electron/electron/issues/40719 。亲读外部smoke.mjs在模块顶层await app.whenReady，且PID98686约75秒仍无输出；按官方ESM准备时序，怀疑ready与模块加载互等，未当成认证失败。授权仅修fixture为既有非顶层等待模式，保留失败输入并先结束该已知fixture。尚未以本条声明39.8.10认证或session.fetch通过。

## 2026-09-07 · P1系统Git替换前的生态与API核查

root实际搜索 `GitHub complete Git client Electron isomorphic-git dugite nodegit framework`，先覆盖GitHub Desktop/dugite/nodegit完整应用与绑定生态，再查 `site:github.com/isomorphic-git/isomorphic-git worktree cherry pick revert support`。web工具后续API访问连接失败，改GitHub只读API核固定提交：desktop/desktop 57d54221902278602d34579d218fea414229ffde（2026-09-04，实际LICENSE为MIT）；desktop/dugite 417dab855025d8c8b0788f7a7909c044f29ea848（2026-08-14，package3.2.3/MIT/Node>=20）；isomorphic-git/isomorphic-git 89d641a761b56a492270933608df78edd7c9ee33（2026-08-23，package开发版0.0.0-development/MIT/Node>=14.17）。仓库均为 https://github.com/ 加上述owner/name。未把开发版当npm可安装版本。

GitHub Desktop整应用不替换现有架构；dugite调用配套Git可执行文件、nodegit为native绑定，均不直接满足原方案纯JS方向，本轮不采用。isomorphic-git固定src/index.js已读，具有statusMatrix/add/resetIndex/commit/checkout/log/readBlob/cherryPick等，但无顶层revert/worktree命令；这不证明低层组合绝对不可实现。当前sidebar src/git.ts还暴露worktree发现、diff、revert、cherryPick/global identity，不能仅把基础CRUD换库后声称等价。尚未选择发布版本/安装/实测或改用户UI；下一实现票须核完整API语义、worktree/冲突/全局identity和现有边界，不能无声删除功能或fallback系统git伪称零依赖。

Git选型补核：root实际读取npm registry `isomorphic-git/latest`元数据，发布版1.41.9的gitHead正是89d641a761b56a492270933608df78edd7c9ee33，MIT/Node>=14.17；SRI `sha512-WOh4ujm5mznHphzQvwj9bVj+pQpV0oZ8H4lAnh4dSaie+lN/lJ2rb6rNOOcP+2m4z8IOQp186TkEULD28NMBJg==`。这是候选版本身份核验，尚无安装或功能兼容PASS。

DOCTOR-HOST01复用进一步收敛：root亲读固定d347 Connection.rpc-host.ts的public fetch.register/exact route，以及client-connection/index.ts:114–128在shared /api dispatch前执行requestRejection；file-upload/src/index.ts:73已有相同POST注册机制。因此采用现成Connection精确Fetch route，复用统一认证与请求中止，不再生成第二套Remote codec、不添加新服务器。已有mochi-hello作为启动诊断宿主扩展，live LlmRuntime调用现有mochi-mimo适配器，结果白名单，不读/返回raw凭据。尚未实现/验证此POST模型链。


P1字体缺口只读续核：普通 PDF 继续复用此前完整 Office 生态检索及已验 Noto/fontkit 实现。本轮实际追加查询 `site:github.com/exceljs/exceljs embed fonts xlsx font name`、`site:github.com/SheetJS/sheetjs font embedding xlsx`，命中 https://github.com/exceljs/exceljs/blob/master/index.d.ts 与 styles.xml（线上 master 仅线索，未固定校验/接入）。本地 plugins/mochi-grades/package.json 固定 ExcelJS4.4.0，index.mjs:26/314 等只是 XLSX font.name=Hiragino Sans GB，没有字体二进制加载/注册调用；不能把改 family 名称称为 Windows 字体注册已完成。现阶段未修改，也未新增候选依赖，待统一字体部署边界明确后再派实现。


GIT-COMPAT01 固定1.41.9实测补充：正常基础链可复用，但 linked worktree 提交对象写入私有 gitdir/objects，common objects缺失，root独立从主/linked git cat-file均exit128。global identity需显式适配；revert/text diff无现成公开等价API，cherryPick冲突语义需维护。证据 artifacts/architect-audit/p1-git-compat01。暂不采用其作为完整后端替换；不能以基础链PASS掩盖现有功能丢失。随包内置Git方向等待用户裁定，当前没有接入任何候选。


## 2026-09-08 · URGENT-08 LAN生态复用

实际先搜 `site:github.com/localsend/localsend protocol pairing authentication`、`site:github.com/schlagmichdoch/PairDrop pairing peer` 和 `site:github.com/a2aproject/a2a-js agent authentication`，覆盖完整LocalSend/PairDrop应用与官方A2A SDK后核协议/身份概念。只读GitHub API固定：localsend/localsend 6279d3e30d1d1290caee3b81549f8128a8b01d9f (2026-08-30,Apache-2.0)；schlagmichdoch/PairDrop 1b0c9c9d903c3cfc706df1303dc75c3b54d04c77 (2026-04-22,GPL-3.0)；a2aproject/a2a-js 69d88990113cf42f9ac34e3fcde0c5a3c1ceae24 (2026-09-08,Apache-2.0)。实际读取固定LICENSE正文，三者未归档。仓库地址分别 https://github.com/localsend/localsend 、https://github.com/schlagmichdoch/PairDrop 、https://github.com/a2aproject/a2a-js 。localsend/protocol API检索HTTP失败，不写成已核协议仓库。

部分采用发现/持久相识/显式身份授权思路，不复制代码或直接接依赖：LocalSend Flutter整应用、PairDrop WebRTC/信令栈都不等于既有DSH插件；官方A2A SDK提供任务/服务协议，但不为Mochi重建七态任务层，其认证仍依赖应用授权。沿用总体§31–37 Node内置dgram/http/crypto与dispatch；接入仍须真实双进程/双端验收。原文“超时必然未投递”不成立，保留UNKNOWN+幂等；endpointId可被冒用，新增内置签名绑定与人工指纹确认以满足用户防串号班要求，保持四层架构，不宣称完整标准A2A互操作已通过。

## 2026-09-08 · LOCAL-VISION-01 本机中转视觉配置

实际搜索 `site:github.com/deepseek-ai/deepseek-harness llm-pi-ai OpenAI compatible image input` 与 `site:github.com "deepseek-v4-flash-vision-exp"`，先沿用已核完整官方框架/插件生态。命中 https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md 与 https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md 。精确模型无公开实现证据；未认证模型目录返回 API_KEY_REQUIRED。root读取固定 d347e703908d0406b7a7ef80e3a0e594d86b2215 config.ts，确认 input/defaultInput/apiKeyEnv 已有能力，沿用已核MIT与固定依赖，不新增网关或升级。实际视觉wire和性能待测，不把模式声明视为兼容证明。用户已确认仅本人使用未限额key，配置不得随包分发。

## 2026-09-08 · TEACHER-PRESETS-01

实际搜索 `site:github.com/deepseek-ai/deepseek-harness agent-presets custom presets teacher`，复用完整官方框架已有插件生态，命中 https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-presets/README.md 与 https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-agent-preset/README.md 。root实际读取固定d347源码下四个preset.yml和agent-presets/README.md，已核MIT沿用此前记录。采用custom roots/persona/tools/skills现有机制，拒绝把编程四模式仅改名当教师适配；无需新框架/依赖升级。真实作用域、旧会话兼容及打包功能未验收，不能仅据README称完成。

## 2026-09-09 · Mochi shell/Playwright 运行修复预检

实际搜索 `site:github.com/deepseek-ai/deepseek-harness sandbox macos windows shell playwright` 与 `site:github.com/microsoft/playwright browsers install chromium PLAYWRIGHT_BROWSERS_PATH`。先核完整Harness的shell/sandbox插件生态，再核Playwright执行库/浏览器管理。命中 https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.md 与 https://github.com/microsoft/playwright/blob/main/docs/src/browsers.md 。固定alpha d347供应链已有sandbox-local/bash-sandbox/pwsh-sandbox/windows-acl，不另造执行框架；Playwright每版本要求配套browser且支持受管路径。当前只完成选型入口检索，Playwright具体版本、许可、Win10兼容与实际功能待执行者核验，不声称已安装或适配。

## 2026-09-09 · 主动记忆生态预检

实际搜索 `site:github.com letta-ai letta memory agent blocks sleep-time`、`site:github.com mem0ai mem0 memory extraction local sqlite`，先覆盖Letta完整Agent与Mem0记忆框架。GitHub API核 https://github.com/letta-ai/letta-code commit b326eb7cb4e02a63f5a5d1e73deb93ea4b27349e（2026-09-08）与 https://github.com/mem0ai/mem0 commit dae67f74f5cc7bf138c7d7d6f9cec5ce4b4373b3（2026-09-04），仓库许可元数据均Apache-2.0/未归档；尚未审完整依赖或接入。部分采用自动上下文召回思路，不引整套框架/云存储/额外常驻推理。Mochi已有独立身份记忆底座，优先通过固定DSH公开生命周期补主动召回，避免重复数据库与新增模型延迟；具体hook与真实效果仍待实现验收。

## 2026-09-09 · 中文通用搜索候选实测

TEXTBOOK-KB-01执行者实证补充（尚待root复跑）：Lagrange实际搜索 `site:github.com/Mintplex-Labs/anything-llm PDF citations local knowledge base SQLite`、`site:github.com/mozilla/pdf.js getTextContent Node pdfjs-dist example`；隔离消费pdfjs-dist6.3.289 SRI `sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==`，Node22六科真实第20页逐页读取通过。实际cleanup路径为document.cleanup()+loadingTask.destroy()，不照猜测调用document.destroy。npm装入optional@napi-rs/canvas1.0.8 darwin-arm64/MIT，文字读取未调用canvas渲染，不等于Windows渲染能力通过。继续最小PDF库+本地页级索引，不采用AnythingLLM整套服务；5册扫描正文仍需处理，不以pending-OCR称最终完成。

扫描教材识别补核：实际搜索 `site:github.com macOS Vision OCR PDF Chinese swift`、`site:developer.apple.com VNRecognizeTextRequest recognitionLanguages zh-Hans`、`site:github.com/naptha/tesseract.js v6.0.1 license node recognize createWorker chi_sim`、`site:github.com/ocrmypdf/OCRmyPDF license windows`，覆盖OCRmyPDF完整PDF识别工具链与Vision CLI后核现成Tesseract.js。OCRmyPDF Windows仍需Python/Tesseract/Ghostscript，不直接增加桌面安装前置；Apple Vision只适用Mac，不称Windows可用。root实际本机runtime已有tesseract.js/core7.0.0（搜索词v6非最终读取版本），README公开createWorker/recognize/terminate已读。官方 https://github.com/naptha/tesseract.js v7.0.0 release线索42eae66、Apache-2.0；尚未做完整分发许可与供应链核验，不接入生产依赖。

root本地只读OCR样本：教科物理选择性必修二PDF第20页（印刷15页）由现成PDFium渲染，调用已有Node22/Tesseract.js7及本地chi_sim语言文件，exit0、1597ms、943字符、引擎confidence85。主题关键词可读，root对照原图发现公式多处误识别，confidence不能当公式正确性；只作为检索定位+原图核验候选。首次同时加载chi_sim/eng出现乱码language加载stderr但仍返回文本，单chi_sim重测无该stderr，不能遮盖前项异常。未上传教材、无模型付费调用；语料与WASM/语言包跨平台正式集成仍待实现验证。

教材KB生态补核：实际搜索 `site:github.com Mintplex-Labs anything-llm license desktop PDF citations`，再搜 `site:github.com mozilla pdf.js getTextContent Node pdfjs-dist`。完整应用 https://github.com/Mintplex-Labs/anything-llm 固定 effcf539e70c10d0bb37d61e66ca2cd6a3ed8499（2026-09-08），MIT全文已读；其独立桌面/文档/向量库体系不整体替换既有Harness，仅参考按来源引用设计。https://github.com/mozilla/pdf.js 固定66646a60f355a40be5bd0b038a3ad8ec2f7553cb（2026-09-08），Apache-2.0许可文件已取得；实际读取官方examples/node/getinfo.mjs，getDocument/getPage/getTextContent及cleanup/destroy是现成逐页文字读取接口，不自写PDF解析器。npm候选pdfjs-dist6.3.289要求Node>=22.13（本机22.22.2符合），optional canvas^1.0.0；npm gitHead=1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56与上述source HEAD不是同一提交，不混称同版验证。尚未安装或通过6.3.289实际功能/打包测试，执行者须核固定发行物和native依赖；扫描PDF仍需识别流程，文字解析器不自带OCR。

桌面角色选择补核：沿用此前完整Electron应用生态及固定39.8.10/MIT。Halley实际搜索 `site:github.com/electron/electron docs api dialog showMessageBox main process` 并读官方dialog文档，采用已有主进程dialog.showMessageBox有限教师/教室/退出按钮；无新依赖、无需网页IPC传role。线上main文档仅API线索，最终角色持久化、独立home和真实39.8.10调用由桌面集成验证，不把文档阅读等同适配完成。

实际搜索 `site:github.com searxng searxng search API json`、`site:github.com agents web search duckduckgo nodejs search`，先核 SearXNG 完整服务生态，再核多引擎 Agent SDK。官方 https://github.com/searxng/searxng/blob/master/docs/dev/search_api.rst 明确公共实例可能未开放 JSON（403），不能凭一个公共网址承诺默认可用；沿用已有可配置 SearXNG provider，不为桌面新增 Python/Docker 服务。

候选 https://github.com/potato47/agent-webtool 固定 581628f179c0bf407ee1332eefd290b6c4675e50（2026-08-27）；API 未归档，MIT 正文已读，历史仅 12 次提交，维护成熟度有限。npm 0.6.0 gitHead 与该提交相符，发行物 SHA1 `4a9b5332511ffaa62cf1e59808616189fb5cb3c5`。根 SDK 提供结构化 results、逐引擎状态与 AbortSignal。直接依赖最低版本 cheerio1.2.0、marked18.0.4、marked-terminal7.3.0、turndown7.2.4、undici7.25.0、zod4.4.3 的 registry 元数据均 MIT，Node 要求兼容本机22.22.2；完整锁定传递图及许可正文尚待隔离安装核验。源码 HTTP 层与 LICENSE 已读，猜测路径 src/search.ts 的404随后由实际 tree 定位为 src/core/search.ts，不称搜索能力缺失。

root 真实执行发行物 bundled CLI（未安装依赖、未接入项目）：`node22 /private/tmp/mochi-search-audit-20260909/package/dist/cli.mjs search '人教版 高中 化学 化学平衡 教学' --limit 5 --timeout-ms 5000 --raw`，session3607 exit0，得到化学平衡教学、学科网、文库及微信候选，DDG失败有显式状态。对比既有 mochi-free-web 同查询约10秒返回不相关学术论文，候选相关性有改善证据，但文库/自媒体年份、教材版本和教学内容未核，不作为权威事实。采用方向为最小 SDK provider 适配候选，不解析 CLI 文本或复制搜索框架；正式接入前仍须实际 SDK 兼容、取消、空结果、并发隔离及多条中文检索验证。网页抓取依赖站点结构，存在后续维护成本，不宣称永远免费可靠或已经完成生产接入。

root 后续实际 SDK 验证：在 `/private/tmp/mochi-search-sdk-audit-20260909` 正常 npm 安装同一固定发行物，72依赖包lock许可证元数据为54 MIT、11 BSD-2-Clause、6 ISC、1 BSD-3-Clause，无缺项；这是元数据清单，不是逐包许可全文审查。Node22直接调用 webSearch，化学平衡教学和外研英语教学设计两个查询并发各约5.04秒返回各自结构化结果；预先取消的请求0ms抛AbortError，session99875 exit0。DuckDuckGo两次均超时拖尾，后续provider应核短预算/引擎选择。部分文库标题的章节或年份可疑，尚未核正文，不能把搜索匹配当权威教材证据。尚未接入生产provider或最终桌面包。

教材页图沿用上述PDF完整生态与固定pdfjs，采用官方alpha的 tool output image / attachments.saveImage seam，不新造附件协议。执行者提供 @napi-rs/canvas1.0.8 核验：gitHead95db9ae7783b6acb9320e6c36a22abd943d3351c，SRI `sha512-/SaLcvlqGWdm0HSCWMgHu7cjJiQXfP8/mOY+6dUyV9flQz7sPBBZ+ed2zYtoukojPmxOaL7bm+d/G4GeWWoN7g==`，LICENSE全文MIT、Node>=10，manifest列win32 x64/arm64预编译optional包。macOS单页渲染由执行者实测；root尚未复跑，Windows包目标不等于实机PASS。将pdfjs原optional渲染依赖显式固定，维护面限受管单页工具；模型image能力门、有限尺寸/并发及真实alpha输出仍待验收。

搜索正式候选首次复审 CHANGES REQUIRED：root 单测12/12通过，但安装 mochi-web-search tgz SHA256 `9c64bdda2abd84f81a05376bdaab677607a45a58ee45c6c75d3b177dc850aa54` 后，以默认配置真实查询“外研版 高中 英语 必修第一册 教学设计”，约3001ms前三均被无关OpenAlex DOI论文占据（社交媒体焦虑、历史翻译、外国文学出版）。session84252 exit0只证明调用成功，未证明质量通过；物理查询约3023ms网页相关。已派修 general网页与学术元数据的来源优先策略，禁止只靠权威域名压过相关性。此tgz暂不作为最终交付版本。

搜索修复候选通过root复审：新tgz `2bc95d878e32e65d809434573f796ffd9cd929acba60a65ccbf036870b24e8db` 将有效通用网页与学术回退按来源分组，不再混排。13/13单测session24386通过；正常安装后入口hash与源码一致。同一英语反例session33901约1919ms返回三条相关教学网页，无DOI挤占；这是实际单次测量，不是校园性能承诺。允许进入桌面集成。

Playwright候选固定为 microsoft/playwright v1.55.0 commit `f992162f04ae0b0b5a0f4b6114b894215be98995`。root直接读取该commit的docs/src/intro-js.md与packages/playwright-core/browsers.json，确认官方Windows10+支持范围，以及Chromium/Chromium-headless-shell revision1187、140.0.7339.16。沿用先前完整Harness/Playwright生态检索；执行者核包Apache-2.0与受管PLAYWRIGHT_BROWSERS_PATH，不采用不经Win10核验的latest。尚待配套browser实际安装/随包启动/NOTICE闭包，官方系统范围不等于学校20H2实机通过。

Playwright候选root独立复验：亲读 `/private/tmp/mochi-playwright155-probe-20260909/run-playwright-runtime-probe.cjs` 与实际probe，使用Node22运行现成runner exit0。其子进程为Electron39 run-as-node、隔离HOME与显式browser-cache，实际Chromium1187读取本地DOM并输出PNG后退出；仅说明隔离consumer功能通过，最终安装包内浏览器路径/许可资源仍由desktop owner集成。

课堂workbench缺失betterSidebar修复沿用固定官方Harness/Cordis生态。Maxwell实际检索 `site:github.com deepseek-ai dsh Cordis optional inject service ctx.inject optional`，核官方插件指南及本地固定alpha Cordis4.0.2 Context.inject嵌套fiber机制；采用现成ctx.inject延迟注册sidebar，不新增框架或课堂教师工具。root亲读最终修改并独立Node22运行8/8相关测试PASS；执行者真实Electron诊断02显示页面mounted、LAN overlay/footer和桥存在、无console错误，root已审其JSON。与此前硬依赖导致整页boot失败的证据分开保留。完整消息链与最终包仍待测。

离线导入器Windows分发补核：root实际搜索 `site:learn.microsoft.com powershell about character encoding UTF8 BOM Windows PowerShell non ASCII scripts`，读取微软官方 https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.6 ，其Windows PowerShell章节明确含非ASCII脚本需要UTF-8 BOM，缺BOM会按传统ANSI解释。root读当前私有ps1字节确认无BOM且含中文，已派Lagrange在Windows启动器封装修复；不是Windows实机已失败或已通过的替代证据。

受管shell提示语法复审：root实际查询 `site:learn.microsoft.com PowerShell call operator variable executable path ampersand`，微软官方 https://learn.microsoft.com/en-us/powershell/scripting/learn/shell/running-commands?view=powershell-7.6 确认以变量路径执行命令需call operator。hello候选PowerShell示例漏掉&，已派Halley最小修复；不是Windows实际执行PASS。沿用已固定Harness shellEnv/systemPrompt扩展，无新依赖。

## 2026-09-09 · 文档教师工具适配

沿用上列 P1-PDF01 实际完整 Office 应用搜索与已固定 docx9.7.1/shared PDF 底座；不重写引擎或引入 Office 服务。采用 https://github.com/deepseek-ai/deepseek-harness 固定 d347e703908d0406b7a7ef80e3a0e594d86b2215 的 dsh-tools0.1.3-alpha.1（MIT）defineTool 与双参数 output.render。root 读取适配器及真实固定 alpha verifier 并在包内 Electron 独立运行 exit0，验证结构化文档生成与参数拒绝；最终 profile/stager/依赖闭包仍由集成验收确认。净插件 a6661beb 仅新增调用入口，维护范围限正式工具契约与受管输出位置。

## 2026-09-09 · 自动发现组播备用通道

沿用已核完整 LocalSend/PairDrop/A2A 生态及上列固定提交/许可证。本次执行者补搜 `site:github.com/localsend/localsend multicast discovery UDP broadcast protocol`、`site:github.com/schlagmichdoch/PairDrop multicast discovery local network`、`site:github.com/nodejs/node dgram addMembership setBroadcast multicast UDP example`，读取 LocalSend 的组播仅宣告、后续 HTTP 单播说明。部分采用该职责划分，继续 Node22 现成 dgram；不引入完整传输框架、Bonjour 服务或另一个任务域，维护成本限同一信标/TTL/设备表的双通道。执行者已提供 loopback 组播收包预检；root 尚未独立验证生产双进程备用通道，已要求单独屏蔽广播测试目标再验证组播。学校交换机/Windows 防火墙效果未实测。

组播集成前root实证更新：独立Node22运行真实双进程test.mjs与durable测试exit0；主信标投向无监听端口时仍通过组播收到候选，恢复双路径只保留一个endpoint。组播加入失败保留原路径、UDP端口占用保留HTTP/手动连接降级通过。仅本机网络栈和测试进程，不宣称学校网络实测完成。
