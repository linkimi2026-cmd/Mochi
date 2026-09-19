# 开源复用审查

> **status**: active
> **last_verified**: 2026-09-13
> **verified_by**: Codex

本文按日期保存每次开发前的 GitHub 检索、许可证、版本和采用决定。旧条目中的数量与版本只代表该次审查时点，不能覆盖 [当前状态](PROJECT-STATUS.md)。当前插件打包定义为 25 项（2026-09-19 实读 `apps/desktop/scripts/prepare-mochi-resources.cjs` 的 `PLUGINS` 反解确认 25 条，与 `test-package-resources.mjs:296` 的 `EXPECTED_BUNDLED_PLUGIN_COUNT = 25` 一致），DSH 依赖为 `0.1.3-alpha.1`。

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


## 2026-09-13 · 120 秒 Mochi 评委与采购演示片

实际搜索词：`site:github.com video editor React Remotion Motion Canvas OpenCut`，随后 `site:github.com hyperframes video gsap license` 与 `site:github.com Greensock GSAP license animation`。先覆盖完整编辑应用、框架与插件目录，再选择动画库。

| 仓库 | 实读提交 | 许可证与维护 | 结论 |
| --- | --- | --- | --- |
| https://github.com/OpenCut-app/OpenCut | 400f097becba5db0fbc305d5a65348cb81c20356 | MIT，未归档，2026-08-10 有推送 | 不接入完整剪辑应用；本次需要可重复离线导出，避免维护额外产品栈。未安装，不声称适配。 |
| https://github.com/remotion-dev/remotion | e4f0d6308c8e7d9ab4787b79fdd805862d692a76 | 自定义 Remotion License，2026-09-12 活跃 | 不采用；需区分主体免费条件与企业授权，现有需求有 Apache 方案可选。未安装。 |
| https://github.com/motion-canvas/motion-canvas | 7b91435c301d530351dcf5ebb91dd139c002e405 | MIT，未归档，2026-07-02 推送 | 不采用；已有真实 UI 图像，更适合 HTML 合成。未安装。 |
| https://github.com/heygen-com/hyperframes | fdf9ffac953d9d18329907d6956faa58c73ad489 | Apache-2.0，2026-09-13 活跃，CLI requires Node >=22 | 采用 HTML 时间轴、现成媒体寻帧与本地 MP4 渲染。已读根清单、CLI 清单、LICENSE、组合与渲染契约。npm 正式包名 hyperframes@0.8.36；尝试 @hyperframes/cli 返回 404，是包名不对，不是 GitHub 检索失败或无权限。 |
| https://github.com/FFmpeg/FFmpeg | ca164c6b98ebf9037434b95a7e942bab9fda7363 | LGPL/GPL 按构建选项；本机 9.0.1 启用 GPL | 使用已安装 CLI 编码、音轨混合和验证，不重新实现编码器，不随工程分发二进制。 |

GSAP 锁定 npm 3.15.0，复用现成 timeline/easing，不移植录屏器代码。渲染工程位于 promo，和桌面产品依赖隔离；原 UI 不重绘，原有素材保留。安装与功能验证状态随成片验收更新。

事实更新：用户在本任务明确确认 Windows 一体机与全部功能已完成实测且正常可用，覆盖旧台账的未实测状态。这是用户确认，非本任务独立硬件复测。原 V5 文档中的 78 段 JSON、原始录屏包并未随 DOCX 出现在当前目录；据可用素材调整镜头，不把占位假设当真实事件。

2026-09-13 宣传片实录补充：本轮实际搜索 `site:github.com heygen-com hyperframes screencast cursor video gsap`，沿用前述已核完整应用/框架选择、HyperFrames0.8.36及GSAP3.15.0。发现 https://github.com/heygen-com/hyperframes-launch-video 完整样片工程，但仅参考目录与功能说明，未核其完整许可证，不复制素材或源代码。继续采用已锁定框架，实际完成14秒1920x1080/60fps无音轨样段渲染与抽帧检查；不称120秒成片完成。鼠标动画放在同一相机坐标系，源素材为真实CDP采集帧，长期维护仅限独立promo目录。

2026-09-13 纯界面成片续作：实际补搜 `site:github.com/heygen-com/hyperframes GSAP video render timeline`，复核官方主仓与 core / troubleshooting / data-attributes 文档。继续使用此前完整生态审计所选 HyperFrames0.8.36（Apache-2.0）和 GSAP3.15.0；不引入新依赖，不复制未经许可的 launch-video 工程。保留根 data-duration=120 与 paused timeline，录制改用 CUA 支持的完整 screenshot，原始 UI 不改写。只在 promo/interface_film.py 及独立合成入口维护字幕、相机、真实控件坐标与鼠标动效。

成片中文字体采用 notofonts/noto-cjk 的 NotoSansCJKsc-Regular.otf（SIL OFL1.1），下载及许可证实读完成。raw.githubusercontent.com 直连超时中止，改用该官方仓库的 jsDelivr 分发成功，非未找到字体。文件 SHA256 2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b，随工程锁定本地文件；字体加载与布局检查通过。无需依赖用户机器上的中文字体或另外购买字体。


2026-09-13 V2 连续录屏与鼠标跟随补充：实际搜索 `screen recorder auto zoom cursor`，先覆盖完整应用。网页检索连接失败，GitHub API 检索成功，不是无权限或没有结果。查看 https://github.com/omacom/omareel 提交 e32ba4e654814b0d2b930aa120c893f7c669e86e（MIT）以及 https://github.com/martian0x80/framepipe 提交 376efe4dda4993877ae9b55496889ca949c77fe2（GPL-3.0）。前者完整录屏、鼠标/键盘事件分轨与自动缩放依赖 Hyprland/gpu-screen-recorder，后者依赖 Linux Wayland/DRM/PipeWire；本机 macOS 不接入，未安装或声称适配。不复制代码，继续采用已验证 CUA screenshot、HyperFrames0.8.36、GSAP3.15.0 与 FFmpeg9.0.1。连续素材保留真实帧；鼠标与相机在同一坐标系合成，维护范围仍限 promo。
音乐换用 Mixkit ID130 Tech House vibes，官方 mp3 下载成功；读取官方 /license/modal/musicFree/ 正文确认商业/非商业网络视频、教育、在线广告允许，TV/广播/CD/DVD/游戏不在许可内。保存许可说明，不把音乐作为独立音乐作品发布。

V2最终验证：HyperFrames现成单worker low-memory流式编码成功导出140秒1080p60 MP4，8400帧完整解码通过。两worker磁盘模式因预计69.7GB临时空间超过可用57GB被框架拒绝，改用已核源码支持的单worker流式路径，不删除用户文件、不降低分辨率。最终lint/runtime/layout/contrast检查无错误或警告，抽查15帧实际输出；不声称源素材全部60fps。

2026-09-13 V3 开工补搜：实际词 `site:github.com video editing framework HyperFrames Motion Canvas OpenCut`、`site:github.com Breakthrough PySceneDetect librosa beat tracking`。检索返回完整应用 OpenCut-app/OpenCut、clawnify/OpenCut 和 HyperFrames 渲染文档；仍沿用前述固定 HyperFrames0.8.36/GSAP3.15.0/FFmpeg9.0.1，不增加编辑平台或依赖。真实仓库 https://github.com/heygen-com/hyperframes、https://github.com/OpenCut-app/OpenCut；提交与许可沿用本日已核记录，当前本地140秒导出证明基础渲染可用，不能据此证明V3镜头已完成。音视频参考分析复用FFmpeg原生fps/ebur128，不手写解码/响度算法；单组件查询本轮没有返回可用PySceneDetect/librosa条目，不称其不存在。独立promo目录维护，保留旧片；本轮只新增研究和演示输入数据，尚未修改产品代码。

2026-09-13 V3 90秒工程实施：补搜实际词 `site:github.com heygen-com hyperframes video framework gsap timeline`，返回完整HyperFrames框架及官方时间轴文档。沿用前述完整应用比较与固定提交 fdf9ffac953d9d18329907d6956faa58c73ad489、Apache-2.0、已安装0.8.36及GSAP3.15.0；不升级、不复制launch-video素材。新版线上文档对composition duration有冲突，采用本地0.8.36已成功渲染的data-duration+paused timeline契约并实际验证。继续复用现成媒体寻帧/编码和easing，仅新增独立90秒分镜工程，避免迁移长期维护成本。

2026-09-13 V4 发布会式2K重做：实际检索 `site:github.com video motion graphics framework HyperFrames Motion Canvas GSAP`，先覆盖完整框架/设计应用（heygen-com/hyperframes、ilya-makarov-dev/Reframe），再检索 `site:github.com gsap seamless loop vertical cards`，返回pixelgridui/card-stacking-gsap与GSAP社区循环样例。继续采用已核HyperFrames提交fdf9ffac953d9d18329907d6956faa58c73ad489、Apache-2.0、固定0.8.36和GSAP3.15.0；不接入新完整应用，避免迁移已验证录屏/寻帧管线。不复制未核许可社区组件；用现有GSAP时间轴的transform和SVG属性完成三列反向运动。Mo直接复用本项目OrbCompanion/ExpressiveOrb组件（当前HEAD e3be3d13912832100070973e9d8074151d77790a），不重画吉祥物。源4K截图已核实，关键UI从源PNG重编，非放大V3成片。维护范围独立promo/v4，不改产品代码。音乐检索Kimi K2.5宣传片BGM未找到原曲署名或公开商用授权，不等于确认无授权；用户提供的本地片音轨可用于本次剪辑审片，授权状态另记。

V4 HTML 与字体复核：用户明确授权使用源文件重渲染原界面，覆盖此前“原 UI 不重绘”的拍摄方式约束。复用本地 InputBar、ApprovalPanel、MessageItem 结构/样式与原 Mo SSR，只编辑独立宣传工程；校园查询、审批采用已核实记录的内容节选重演，不声明为新一次实时执行。三角形直接复用实际生成的 triangle-demo.html SVG 与状态，解决可见性穿透并将 CSS 异步切换统一到导出时间轴。
字体补核实际读取 https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE 与 Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf；GitHub API 成功获取 Bold blob ff4c0450e8a5bf0290fbb6013a72dc61a10e8e56（Version2.004）及 Serif SemiBold blob41668d00fa67926d143544ddba2937b7d7f6fcf6（Version2.003），读取 Serif/LICENSE 确认 OFL1.1。jsDelivr 与 raw 下载超时，改用 GitHub API blob 成功，不归因为无权限。采用原生字体字形、GSAP逐字遮罩与统一字距，不生成栅格字形。复用现有 fontkit 检查三套字体覆盖本工程401个汉字，零缺字。

V4 102秒收尾：沿用已核 HyperFrames0.8.36/GSAP3.15.0，不增加依赖。鼠标、虚线揭示和光点共用原生 SVG getTotalLength/getPointAtLength 几何进度；实线引导禁用。插入已核 ASK 回应原记录的12秒源界面重演，后续媒体与鼠标时间同步后移。三套字体覆盖412个本片汉字，无缺字。修复转场脚注重叠与模型说明对比度，最终指定采样的 lint/runtime/layout/contrast 均零错误、零警告；转场离场遮挡仍有信息级提示。完整102秒MP4编码与输出抽检另见 promo/evidence/v4-final-qa。

V5 60秒无引导线精剪：实际补搜 `site:github.com heygen-com hyperframes video gsap timeline`，先复核完整HyperFrames应用框架与插件文档，再沿用本地GSAP时间轴组件。真实仓库https://github.com/heygen-com/hyperframes，继续固定0.8.36/提交fdf9ffac953d9d18329907d6956faa58c73ad489、Apache-2.0及GSAP3.15.0，维护与许可证沿用本日审计，不复制宣传样片代码。使用现成时间轴寻帧和FFmpeg变速，按镜头分配60秒；原工程保留，新版独立promo/v5。用户追加2560×1440、120fps目标，实际编码验收后才认定通过。

V5最终需求更新为80秒、2560×1440、120fps。沿用同一渲染生态；使用GSAP分段寻帧、新增源HTML建模请求/实际三角形源码节选、实际《三角形练习》出题与点击反馈、原AgentPresetSection卡片几何及三条实测预设内容。鼠标不再携带任何引导线。Mo原SVG眼睛ry动画实测7.2→1.076543→7.2，结尾7.2→1→7.2。字体检查、画面检查和最终MP4参数以promo/v5与输出验收为准。
网站依据改为用户指定 /Users/a1379/Documents/联动计划：亲读README、server/node-server.mjs、server/function-entry.mjs对应部署文档；当前文档的国内路线为CloudBase HTTP函数及共享PostgreSQL HTTP适配层，而非旧报告中的CloudRun直连。README国内入口当前只读health探测返回HTTP410，因此不宣称当前公网可用；用户明确授权直接制作现有网站内容，片内不展示问题报告、不做在线状态承诺。
声音沿用已核许可的Mixkit ID130完整原曲连续0–80秒，不循环、不拼接重复乐段；用FFmpeg原生sine/afade/adelay/amix生成轻量点击及重点落点，动作cue写入promo/v5/audio-cues.json。HyperFrames现成beats检测复用，不新增节拍引擎；自动BPM仅作参考，不作为真实音乐拍号断言。

V6补足展示时间：实际搜索`site:github.com heygen-com hyperframes GSAP video timeline`，复核完整框架、插件转场和时间轴文档。继续采用已核Apache-2.0的HyperFrames0.8.36/提交fdf9ffac953d9d18329907d6956faa58c73ad489及GSAP3.15.0；不更换生态。读V5时间轴确认原91–97秒成果汇聚被压到零时长，本次恢复该源动画2秒，同时把其他18秒分配给过短展示，成片100秒。源视频从V4原媒体重编码，HTML源动效重新以120fps求值；不靠给V5成片重复帧假称恢复源动作。维护仅在promo/v6与构建脚本，音乐改为原曲连续100秒并重映射cue。

## 2026-09-13 交接文档整理复用审计

> **status**: active　**last_verified**: 2026-09-13　**verified_by**: Codex

实际检索词：`site:github.com documentation framework mkdocs material diataxis`。先查看完整框架 https://github.com/squidfunk/mkdocs-material 及其 MkDocs 插件生态，再核对现有项目自带的文档分层和检查脚本。GitHub API 查得 master 提交 `9d65447eb4039c153edefbc378029257886737ff`（2026-08-30）、最新 release `9.7.7`（2026-07-17）。仓库标注 MIT；本轮不接入、不复制代码，因此未安装验证其 Python 依赖兼容性，不宣称已经适配。

不引入文档站：任务是本地项目交接，现成 Markdown 权威分层、台账、相对链接已满足阅读；新站点会增加构建、发布与版本维护成本。实际复用 `docs/DOC-AUTHORITY.md`、`scripts/scan-doc-drift.mjs`、`scripts/check-skill-tools.mjs`、`scripts/check-snapshot-manifest.mjs`，不重写检查框架。整理结果见 `docs/DOCUMENT-INVENTORY.md`。检索成功，无权限错误；不是“未找到成熟方案”。

2026-09-13 内容复核续轮：实际检索 `site:github.com/squidfunk/mkdocs-material documentation links validation`，查看完整框架及官方 creating-your-site 文档；版本/提交沿用本日已核 9.7.7 / 9d65447eb4039c153edefbc378029257886737ff，仍不安装新框架。现有 Markdown 链接检查不能证明业务描述正确，本轮直接读取 modes、campus、memory、sheets、侧边栏与打包源码逐项更正文案，复用已有门禁；未复制外部实现。

## 2026-09-13 · 全量文档重组

实际搜索词：`site:github.com squidfunk mkdocs material documentation versioning archive plugin`、`site:github.com Diataxis documentation framework repository`。先比较完整文档站框架，再看分类方法。

| 仓库 | 本轮核对 | 采用结论 |
|---|---|---|
| https://github.com/evildmp/diataxis-documentation-framework | GitHub 仓库可访问，许可证为 CC-BY-SA-4.0，仓库显示 290 次提交 | **部分采用**：使用 tutorial / how-to / reference / explanation 分责思想，把当前状态、操作、技术事实和历史解释分开；不复制正文或代码 |
| https://github.com/squidfunk/mkdocs-material | 继续沿用本日已核 master `9d65447eb4039c153edefbc378029257886737ff`、release `9.7.7`、MIT | **不接入**：当前交付是本地 Markdown 与比赛材料，引入 Python 站点构建、主题和发布链会增加维护成本；现有 Git、相对链接和检查脚本足够 |

最终采用轻量目录治理：一个根入口、一个现行总体方案、一个项目现状、一个交付台账；`foundation`、工单和时点报告明确归档。检索成功，无权限或网络失败。分类方法可以降低冲突，不能代替业务事实核对，因此本轮同时读取运行配置、打包脚本、交付物元数据和参赛材料逐项修正。
# 2026-09-14 · WPS 四分钟答辩演示复用

- 搜索词：`github reveal.js embedded video presentation`、`github pptxgenjs addMedia video autoPlay`。先检查完整演示框架与导出库，再查看媒体对象实现。
- `https://github.com/hakimel/reveal.js`：检查提交 `75dff6f515d2d08df0c32cf2b7328b89425c6f25`，MIT，最近推送 2026-09-10。支持内嵌媒体、演讲备注、转场。用户明确使用 WPS，故不采用浏览器演示框架，避免增加现场依赖。
- `https://github.com/gitbrent/PptxGenJS`：检查提交 `3c9ec1b687c174952166f6a34b5e87ebf69fa469`，MIT，最近推送 2025-11-28；检查 `src/gen-xml.ts` 中 videoFile、p14:media、媒体点击动作和预览图关系。部分采用其标准 OOXML 媒体结构作为互操作参考，不安装整套依赖。页面使用环境已有 `@oai/artifact-tool` 生成，再封装视频与基础动画。
- 照片与界面来源：联动计划真实历史网站截图、Mochi 真实录屏、现有 Mo 品牌画面，不使用外部图库或生成式场景。
- 验证范围：最终检查内嵌视频哈希、五页结构、讲稿备注、动画 XML、逐页画面并在本机 WPS 打开放映；Windows WPS 的目标机行为仍需现场排练。

## 2026-09-14 · Apple Design 与演示生态补查

用户要求强化结尾层级后，读取本机 apple-design/SKILL.md，采用目的、信息层次、空间一致性与克制动效原则；不把 Web 弹簧动画误称为 WPS 原生能力。

搜索词：`github presentation skill pptx animation powerpoint`、`github slidev pptx export animations`、`github marp powerpoint editable export`。

- https://github.com/slidevjs/slidev：MIT，提交 a8d8ff717c5a72c1b3a9d98f1c849481f2ddcd00，最近推送 2026-08-25。官方导出文档确认 PPTX 为图片页面，文字不可选。未采用：无法满足本轮可编辑结构与 WPS 媒体原生播放。
- https://github.com/marp-team/marp-cli：官方说明可编辑 PPTX 是实验功能，强调外观一致性时不推荐。GitHub 元数据接口本次发生 SSL EOF，未获得提交号；不能写成完成版本审计。未采用：已有原生输出，无需引入转换损耗。
- https://github.com/PoplarPoplar/presentation-skill_-PPTskill：MIT，提交 3a22eed290fa2205b6a1e2de5549b4429c5fffd0，最近推送 2026-07-14。检查 SKILL.md 的源文件、叙事、重建和渲染 QA 工作流；部分采用其工作流原则，不安装新的生成依赖。
- WPS 动画：在本机 WPS 为测试副本添加一次原生“渐变”并另存 .build/wps-animation-reference.pptx，以实际生成的 timing、group、build list 结构作为兼容参考。

## 2026-09-14 · 答辩痛点与技术架构补充
搜索词：`site:github.com slidevjs slidev pptx export`、`site:github.com gitbrent PptxGenJS addMedia`，先复核完整框架和导出生态，再复核媒体组件。真实仓库 https://github.com/slidevjs/slidev 与 https://github.com/gitbrent/PptxGenJS；固定提交、MIT 许可沿用本日上方实读记录，不升级依赖。搜索成功。继续采用现有 artifact-tool + 已验证 OOXML/WPS 媒体封装，避免转换迁移维护成本。此次仅改两页排版与讲稿，不更换动画实现。技术事实依据 apps/desktop/package.json、联动计划/package.json 与 docs/PROJECT-HISTORY.md；不推断生产数据库或线上部署状态。

## 2026-09-14 项目收尾同步
搜索词：`site:github.com squidfunk mkdocs-material documentation`、`site:github.com archiverjs node-archiver zip`。先检索完整文档框架，再检索归档库，检索成功。https://github.com/squidfunk/mkdocs-material 沿用已核提交9d65447eb4039c153edefbc378029257886737ff及MIT记录；https://github.com/archiverjs/node-archiver 本次仅发现ZIP/TAR能力，未做版本及许可证接入审计，因此不接入。继续使用已验证的本地Markdown、现有系统ZIP与校验脚本，仅补交付条目，不新造归档实现，不增加依赖维护成本。

## 2026-09-14 · 根目录交付入口整理

复用上方已完成的文档框架与归档生态检索，不重复安装依赖。采用现有 Markdown 入口、资源地图、交付台账和 `assemble-competition-delivery.mjs`；完整交付目录改为直接生成在 Mochi 根目录。`release/submission/` 继续承担源码归档和历史构建记录，不再作为评委查找最终成品的入口。

## 2026-09-14 · 根目录排布复核

搜索词：`site:github.com nodejs monorepo apps packages docs project structure`、`site:github.com vercel turborepo apps packages docs repository structure`。检查 https://github.com/vercel/turborepo 当前 HEAD `2167e7410f7c2dde3d2b5df882beb3ac0ea5aaa1`、MIT 许可证及其结构指南：可部署应用归入 `apps/`，共享代码归入 `packages/`，文档归入 `docs/`。本项目已有自己的运行、插件和打包体系，因此只采用目录职责原则，不安装 Turborepo、不引入根 workspace，也不移动 `apps/`、`plugins/`、`packages/`、`vendor/` 等运行路径。完整交付包增加 `01-` 排序前缀，早期 foundation 设计移入 `docs/history/`。

接入核验发现 `foundation/ui/` 的两份 CSS 仍由主题构建脚本实际读取，因此它们不属于历史文档。现已迁入 `client-plugins/jxl-theme/styles/`，构建脚本改用相对 URL 读取样式与图标，并重新生成 `client.js`。这次采用的是目录职责与可移植构建原则，没有接入 Turborepo 代码或新增依赖；生成产物内容哈希是否变化由后续构建检查确认。

同一原则用于媒体工程：宣传片的脚本、时间轴、许可和轻量输入进入 Git，大体积录屏、音视频、导出与 QA 帧留在本机并由交付包分发；答辩制作脚本从 `.build/` 移到 `scripts/`，`.build/` 只保留可再生成的中间产物。未引入媒体资产管理框架或 Git LFS；当前仓库没有现成 LFS 配置，临时引入会增加比赛交接步骤。

## 2026-09-14 · CI、lint 与依赖边界硬化

实际搜索词：`site:github.com nx monorepo lint test typecheck GitHub Actions`、`site:github.com moonrepo moon node monorepo task runner lint test`、`site:github.com biomejs biome JavaScript linter formatter CI`、`site:github.com oxlint oxlint JavaScript linter CI`。检索成功，无权限错误。

| 仓库 | 核对版本与现成功能 | 许可证与维护 | 采用结论 |
|---|---|---|---|
| https://github.com/nrwl/nx | HEAD `e6a5c010b70924e8d4d94709a7b1f2ed7b709751`；任务图、affected lint/typecheck/test 与缓存 | MIT；GitHub API 显示未归档，2026-09-13 有推送 | 不采用。现有 npm 桌面出包与 pnpm 校园/插件边界已经稳定，迁入统一 workspace 会扩大安装包回归面 |
| https://github.com/moonrepo/moon | HEAD `9c9498248132f7a72156eb8dc96efb19c44a1f2a`；跨项目任务与 CI affected 执行 | MIT；未归档，2026-09-13 有推送 | 不采用。与 Nx 同类，当前仓库规模不需要再增加任务图运行时 |
| https://github.com/biomejs/biome | HEAD `f0eeab22bb8aacad10d75cbe84a75da9930843d5`；npm 包 `@biomejs/biome@2.5.6`，单 CLI 提供 JS/TS/MJS/JSON/CSS lint 与 format | npm 包为 MIT OR Apache-2.0；未归档，2026-09-14 有推送；Node 要求 `>=14.21.3` | 部分采用。精确固定 2.5.6，用于核心源码错误门禁和渐进格式治理；接入后对 94 个核心源码文件实跑 |
| https://github.com/oxc-project/oxc | HEAD `aaff7583a616a4e16753ce275b41c9471e7b88e7`；Oxlint 支持 JS/TS 与 JSON 配置 | MIT；未归档，2026-09-14 有推送 | 不采用。Biome 已同时满足 lint 与 format，避免并存两套规则和二进制依赖 |

兼容性与接入验证：仓库 CI 固定 Node 22.22.2，满足 Biome 引擎要求；根 `package-lock.json` 固定质量依赖和五个核心插件测试闭包，`npm run lint`、`npm run format:check`、首批插件 `checkJs` 与依赖边界检查均已本机执行。modes / visuals / sheets / documents / presentations 共 126 个测试使用根锁定依赖实跑通过。没有仅凭 README 宣称适配。

未采用根 workspace：根 `package.json` 只做质量编排。`apps/desktop/package-lock.json` 继续管理 Electron 运行和安装包闭包，相邻 pnpm/npm lockfile 继续管理少数可独立开发的插件；无相邻锁的第一方插件由桌面 lockfile 托管，并由 `scripts/quality/check-dependency-boundaries.mjs` 校验精确依赖存在。详细边界与尚未覆盖的类型、格式及 alpha 风险见 `docs/QUALITY-GATES.md`。


## 2026-09-15 · 提示词、PPT 视觉复核与评测

先检索完整应用/框架及插件生态，再检索提示词与评测组件。实际搜索词：
`site:github.com/openai/codex prompt.md system prompt`、`site:github.com/anthropics skills pptx`、
`site:github.com presentation generation agent framework presenton pptagent promptfoo`（结果偏离，继续定向查询）、
`site:github.com/presenton/presenton`、`site:github.com/icip-cas/PPTAgent`、`site:github.com/promptfoo/promptfoo`、
`site:github.com/anthropics/claude-code system prompt`、`site:github.com/promptfoo/promptfoo llm-rubric file prompts yaml`、
`site:github.com/icip-cas/PPTAgent visual reflection presentation evaluation`。

| 仓库 / 固定提交 | 实读范围与许可、维护 | 结论与维护成本 |
| --- | --- | --- |
| https://github.com/openai/codex / `7f01a84effccef40d4726c3ca12e6c839ec98d7a` | `codex-rs/core/gpt-5.2-codex_prompt.md`，Apache-2.0，未归档，提交日期 2026-09-15 | 部分采用任务复杂度决定规划、证据化检查、简洁交付的原则；独立编写校园指令，不移植 CLI 权限与工具接口 |
| https://github.com/anthropics/claude-code / `f96c3b49c4c8721685206aaab23609b2d399df4e` | `plugins/plugin-dev/skills/agent-development/references/system-prompt-design.md`、`LICENSE.md`；All rights reserved / 商业条款，未归档，2026-09-15 | 仅研究具体流程与可测质量标准，不复制材料；该文件是代理提示词设计指南，不能冒称完整 Claude Code 线上系统提示词 |
| https://github.com/anthropics/skills / `34040c9c568585f6929bedeaad110ad08f079624` | `skills/pptx/SKILL.md`、`skills/pptx/LICENSE.txt`；专门限制性许可，未归档，2026-09-10 | 仅对照渲染检查工作流，不复制、接入或用作训练语料；不能把全仓视作 Apache-2.0 |
| https://github.com/presenton/presenton / `bd4bd5039239b236cd8dd2a25b4906eed1c70899` | README 的模板、可编辑导出、MCP、Electron/FastAPI 路线；Apache-2.0，未归档，2026-09-14 | 不接入。本轮修改指令与评测，迁移需额外 Python/uv、Next.js 服务和桌面打包验证；README 能力尚未在 Mochi 验证 |
| https://github.com/icip-cas/PPTAgent / `2419d30b134a71486523e95ded60b32489fd3c61` | README 的参考页分析、反思和 Content/Design/Coherence 评估；pyproject.toml 要求 Python >=3.11、Playwright、python-pptx 等；MIT，未归档，2026-06-28 | 部分采用以参考页和实物证据评价的思路，不安装框架；保留为未来渲染器对照实验候选，不声称已兼容 |
| https://github.com/promptfoo/promptfoo / `29a15d1edb256c789d0035ce3f36ad7cf91db6bb` | package.json 0.123.0、Node >=22.22.0、MIT，未归档，2026-09-15；官方配置文档的外部测试集和 llm-rubric | 采用其 JSON 测试集格式提供案例；不在产品增加依赖，不自建通用模型评测框架。实际模型 provider/凭证未确认，线上评测不伪造通过 |

GitHub 检索及元数据成功，无权限错误。Codex 旧路径 `codex-rs/core/prompt.md` 返回 404，随后通过固定提交树找到真实文件；这是路径变化，不是没有官方材料。未核验第三方 leaks 内容的真实性，不将其作官方或训练数据。

本地复用：现有 PptxGenJS 4.0.1、`ppt_inspect`、`mochi_ppt_render` 的 PNG attachment 输出与 overview/page 模式、`mochi_ppt_revise` 定页修订、runtime-profile 临时目录集成测试。无依赖升级。新增的主要维护面是短提示词、案例和人工评分规范；无需第二套渲染器或后台自我训练。源码及工具链验证结果见 docs/prompt-quality.md。

验证补记：npm run check全部通过（128测试，0失败/跳过）；真实PPTX→PNG→image block回归通过，受管profile生成与解析通过。额外完整会话技能探针被已有fs-ext x86_64/当前ARM Node不匹配阻断，未进入技能加载；不能将配置解析成功冒称完整会话通过。未运行实际模型评分。


## 2026-09-15 · 全领域质量与 Harness 提示词继承

用户将范围扩展为全部输出与任务正确率。实施前搜索词：`github "Anthropic" "fable-5.1" system prompt`、`github "gpt-5.6-sol" prompt`、`github deepseek harness agent framework skills evaluation reliability`、`site:github.com/deepseek-ai/deepseek-harness`。先覆盖完整Harness、跨Harness框架与插件/SOP生态，再读提示词组装、技能与验证组件。

| 仓库 / 固定提交 | 实读、许可与维护 | 采用结论 |
| --- | --- | --- |
| https://github.com/deepseek-ai/deepseek-harness / `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` | docs/subsystems/{system-prompt,skills}.md、packages/core/system-prompt/README.md；MIT，未归档，2026-09-15提交 | 采用已有section/scoped-layer机制，不升级内核。最新文档提供personaPrefix/Suffix，但本地0.1.3-alpha.1仍是单persona字段，不能照抄最新配置 |
| https://github.com/sandbaseai/deepseek-harness-handbook / `425dd255f9be22c97b2273cd0c38b3951aecddc3` | docs/en/agent-patterns/skills.md；Apache-2.0，未归档，2026-08-31提交 | 社区手册，仅作线索。技能加载不等于执行通过的结论在本地组装和工具回执边界核验，不引入wrapper |
| https://github.com/DataArcTech/Bayesian-Agent / `4b69b4ed02d166c8d1673ea67e2ac836ac377896` | README中的已验证轨迹、独立verifier、SOP证据更新与重复失败晋升；MIT，未归档，2026-08-12提交 | 部分采用“失败证据→窄规则→回归”的流程；不安装自演化框架、不自动改生产提示词。未验证其依赖适配和论文提升可迁移性，不宣称其指标适用于Mochi |
| https://github.com/asgeirtj/system_prompts_leaks / `b55f7e37b71f076eb3228faa836954b6610046fe` | OpenAI/gpt-5.6-sol.md，126855字符，多数为ChatGPT工具/界面协议；仓库CC0-1.0，未归档，2026-09-13提交 | 研究用户指定快照的工具精确性与检索边界，不复制工具接口、隐藏标记或身份；第三方汇编许可不证明原文权利或OpenAI正式发布 |
| https://github.com/simonw/claude-system-prompts / `cd4beb2d9c78786da0d0b77677b56adce56c1981` | 元数据和官方快照追踪入口；GitHub未识别许可，未归档，2026-09-03提交 | 不复制；转读Anthropic官方页面核验Fable 5.1 |

官方实读： https://platform.claude.com/docs/en/release-notes/system-prompts/claude-fable-5-1 （2026-09-01公开版本）及 https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1 。只借鉴明确任务范围、完成已授权工作、变化信息先检索的思想，独立编写本项目规则；不把Claude专有产品/拒绝策略/接口迁入Mochi。

网络状态：搜索与所有仓库元数据成功；Harness与leaks的recursive tree接口发生SSL EOF，原始固定提交文件读取成功，属于网络错误，不是无权限或未找到方案。

关键本地证据：已安装dsh-persona/lib/index.js使用同一个PERSONA_SECTION，预设会覆盖deployment persona。本轮复用所有角色都已挂载的mochi-hello，以独立命名section注入公共行为约束，角色persona保留边界；不新增生产依赖、不重写Harness、不开后台训练。增加真实SystemPrompt组装测试验证覆盖、隔离和卸载，不能用YAML中出现词句替代生效证明。特殊complete persona仍可能替换全prompt，是可信配置边界，不宣称此规则不可绕过。


全领域接入验证：`npm run check`通过（128核心测试及当时5项提示词/环境测试）；随后新增目标Harness技能provider实加载用例，`npm run test:prompt-quality`共6项全通过。五个角色最终组装保留独立质量section且无串扰；卸载/重载无残留；8个技能由真实FileSystemSkillProvider读取。npm pack dry-run确认work-quality.md/mjs进入包，新增模块lint通过。受管profile生成/解析及技能工具名扫描通过。skill-creator通用Python验证器缺PyYAML未运行成功，使用目标Harness解析验证替代；未安装新依赖。40条JSON开发案例完成格式/唯一ID核对，未跑在线模型评分。完整App启动的既有native架构问题仍未处理。


## 2026-09-15 · Yan Agent 版本与 Harness 研究

实际搜索词：`"Yan Agent" "1.6.0"`、`"Yan Agent" "DeepSeek" harness`、`github YanAgent deepseek harness`。先检索完整应用和 DSH 插件生态，再读协议、视觉、经验与设计技能组件。真实仓库 https://github.com/666-gy/Yan-Agent ，审阅提交173d68708821436dddf3f4ed0b3e100ead27b6a2；v1.6.0-Beta1/Beta2/Beta3与v1.5.0均指向它，源码package仍1.5.0、OpenCode1.18.11，不能宣称是Beta3完整源码或官方DSH实现。根MIT、未归档、2026-09-14 push。Beta3仅核发布说明，未运行Windows安装包。另一真实搜索命中地址https://github.com/666-gy/Yan-Agent-DeepSeek-Harness当前页面与API均404，原因未确定；搜索成功与源仓库不可访问分开记录。

部分采用研究思路：可执行视觉通路、协议兼容、经验版本/回滚、按能力注入；不直接接入OpenCode代码或技能，避免与Mochi固定DSH、Cordis和macOS打包体系冲突，第三方技能许可未逐项审计。源码实际能力和缺口见[研究报告](yan-agent-research.md)。8项离线存储/模拟视觉测试通过，3种DSML探针行为通过；无真实模型质量/费用实测，不宣称已适配。本轮只写文档，不修改生产代码。

### 用户提供官网后的实施决策

用户明确要求依据 https://666-gy.github.io/Yan-Agent/ 改造Mochi。web工具无法打开该站，直接HTTPS获取200，页面标题仍1.5.0并指向上述同一GitHub仓库；不是另一个DSH源码入口。沿用本轮已完成的完整应用/生态检索及固定提交审计。复用Mochi现有9套主题、8种版式、read-image/附件服务、llm.resolveModelInfo与LibreOffice渲染；不增加视觉供应商、不复制Yan技能、不迁移内核。实际发现PPT工具层未暴露后端theme/layout，render注释承诺模型能力检查但执行仅检查附件服务。将接通现有主题/版式、补模型路由能力检查与文件指纹/覆盖页证据。维护成本限工具schema、渲染记录、提示案例与回归，不新建验收主循环。

接入后验证：npm run check退出0，130核心+6提示词/技能测试通过，0跳过；真实工具调用覆盖8种版式、主题和定页修订，其余页XML字节不变。现有主题name在二次归一化丢失的问题已修正。真实PPTX渲染、当前模型能力拒绝/路由优先、文件哈希和覆盖页、渲染中版本改变拒绝均已测；查看5页真实overview确认中文/主题/版式生效。45条开发案例格式可用，未跑在线模型A/B；安装包/现有App未更新，原生依赖架构问题未处理。没有据此声称审美/正确率达到旗舰水平。

## 2026-09-15 · 经验案例的证据校验

先检索完整评测框架与Yan经验实现，实际词`site:github.com/promptfoo/promptfoo eval output results compare assertions`、`site:github.com/666-gy/Yan-Agent continual harness successfulRuns`。前者命中官方仓库配置/输出文档，后者未得到新的有效源码结果；继续沿用已实读Yan提交173d68708821436dddf3f4ed0b3e100ead27b6a2及Promptfoo提交29a15d1edb256c789d0035ce3f36ad7cf91db6bb（0.123.0、MIT、Node>=22.22.0）。部分采用：保留现有Promptfoo cases格式，模型执行和裁判留给其现成框架，不接入生产依赖。新增只读本地证据校验器补足文件哈希、人工复核、页覆盖与硬失败约束；这是项目产物契约，不是重写通用模型评测引擎。无网络传输、无自动修改生产提示词，维护范围仅案例契约与测试。

证据校验接入：本地review-evidence只核文件哈希/范围、轨迹和最终完整prompt等必备产物、人工记录、硬失败与视觉页覆盖，输出reviewable而非passed；不会联网或晋升规则。5项合成单测覆盖缺证据/自评、旧版本、越界链接、缺页/错版本和可审阅路径；模板保留未执行状态，不作为模型成绩。真实A/B仍缺已执行轨迹与人工评分。

继续复用Yan固定源码的协议/视觉/批量读取/压缩/经验思路，并核对本地DSH base已有llm-retry、token-meter、compaction-basic、结果pruner与subagent，mochi-memory已有有界检索注入；不因研究新增同功能框架。新增2项当前安装DeepSeekAdapter的模拟传输回归，验证完整工具调用与结果图片保留、Files失败后内联以及不支持图像时请求前拒绝；不声称真实端点已测。测试接入npm run check，无生产依赖变化。

## 2026-09-15 · 完整会话加载验证

先复核完整应用/框架（Yan、现有DSH、Electron）再检查原生组件。搜索`site:github.com/electron/electron "v39.8.10"`，搜索结果不作为安装依据；直接GitHub API确认官方v39.8.10 release（2026-05-05），官方SHASUMS256与本机缓存x64 zip SHA256 de5389b3a1a8803fa50e2a2c2a9a8816f1fd5d996ac66a217c04396109d42e6b一致，包内MIT许可。临时目录解压运行Electron Node22.22.1/x64/ABI140，成功加载当前fs-ext；普通Node24/ABI137不能替代。

接着定位Koffi可选原生模块缺失。GitHub定向搜索`site:github.com/Koromix/koffi "3.2.1"`未命中有效官方源码，不称没有现成方案；使用已安装Koffi3.2.1加载代码及npm官方@koromix/koffi-darwin-x64/3.2.1元数据，MIT、darwin/x64、Node-API。下载并校验SHA512 gFCWxNBTZIvxo1p+PURWfsy2Ctj5FGnVVs1f03lTLhBvmxEto70pdIiFztdFLDFkAJ1pmtQmruRKapeK+E8YPA==，仅放入临时Electron的既有resourcesPath搜索位置，实加载版本3.2.1成功。未修改用户node_modules、锁文件、持久配置或App。复用现有test-profile-skills真实profile探针，增加公共规则组装证据，不重写启动器。

接入后结果：匹配Electron/Koffi临时运行时成功运行增强的test-profile-skills：8技能、原生skill工具、真实standard Agent公共质量节1份且内容哈希匹配。原有test-classroom-role-runtime也通过，3个教室工具及锁定本地LAN边界。无凭据/模型API/校园请求，未修改正常开发依赖和App；该隔离路径不能被描述为生产启动修复。

## 2026-09-15 · 真实模型小规模探针

检索`site:github.com/deepseek-ai/deepseek-harness llm adapter stream evaluation`，先确认现有Harness/Promptfoo完整执行与评测生态，再读已安装适配器stream契约。沿用官方DSH固定版本0.1.3-alpha.1及既有GitHub提交审计，不照搬master版本。真实当前开发配置默认mochi-mimo/mimo-v2.5-pro/high，相关凭据已存在（不记录密钥）。复用安装适配器发少量合成策略题，基线取Git HEAD的core persona片段，候选取当前core persona+公共规则；这只测提示片段策略响应，不冒称完整Agent工具执行A/B。原始输入/输出和用量留本地，不发学生材料或仓库文件；不新建模型调度/裁判框架。

### DeepSeek 专用测试修正

用户明确排除MiMo后，沿用已审计的DSH适配器，测试入口改为只允许本地配置的https://api.deepseek.com和DEEPSEEK_API_KEY引用，不改产品默认模型。实查官方/models返回deepseek-flash、deepseek-v4-pro；官方https://api-docs.deepseek.com/guides/vision/确认Flash图像能力，旧V4别名不作为新测试模型ID。13次真实DeepSeek请求均完成：12次策略片段A/B和1次图片读取。结果及未通过事项见evals/work-quality/README.md；MiMo历史排除，未宣称完整Agent/全部45案通过。脚本复用安装适配器、无新依赖；语法与Biome lint通过。

## 2026-09-15 · DeepSeek 完整 Agent 探针接线

实施前检索`site:github.com/deepseek-ai/deepseek-harness sessionController prompt agent tools evaluation`，先复查官方完整Harness与已有Promptfoo生态，再读session-controller与Agent接口。继续采用已审计MIT Harness和本地0.1.3-alpha.1，不升级、不复制最新master接口。实际读取本地prompt(request, signal)、agent.whenIdle、snapshotEvents、agent/request及mochi-presentations入口；测试复用原生工具循环、隔离profile和临时匹配Electron，无新框架。完整会话探针最初遗漏prompt的AbortSignal，错误发生在模型请求前，修正后继续验证，不计为模型失败。

完整探针暴露临时插件package缺版本字段，与DSH plugin-package-inventory-deepseek的强制name/version契约不符；补0.0.0后原生循环进入16次实际请求。另查完整Canvas项目https://github.com/Brooooooklyn/canvas（搜索`site:github.com/Brooooooklyn/canvas canvas NAPI_RS_NATIVE_LIBRARY_PATH`），先沿用既有渲染库，后补可选架构组件。只下载npm官方@napi-rs/canvas-darwin-x64@1.0.8，MIT、与已安装JS版本一致；SHA512 rRjDMZs9pIRKGxgijwezplKc1RnJsqUokrA9h88bbTkqQ+7ePj0ZN4ZnZDy8Vu0tXs7KRlI2tQLaK4mx9QlxHg==校验通过。使用现有NAPI_RS_NATIVE_LIBRARY_PATH在临时Electron中加载，创建16×16 PNG成功；未改依赖树、锁文件或App。

首轮实际失败：技能参考路径含糊导致多轮目录探查、节奏页行数限制未充分暴露、Canvas缺失后模型误用独立讲义PDF看图并耗尽16次预算。已精确化技能相对路径、工具schema和错误修复建议中的真实行数限制，明确禁止讲义PDF充当PPT验收证据；5项相关回归通过。真实首轮失败记录evals/work-quality/runs/2026-09-15-deepseek-agent-first。

复测补记（2026-09-16）：补齐Canvas后的真实DeepSeek Flash/high standard Agent完成13次主请求，调用create→inspect→render overview/page→revise→render latest→交付。一次layout/table错配、一次密度超限后恢复；产物和附件保留于evals/work-quality/runs/2026-09-16-deepseek-agent-retest。独立看图仍见文本/表格主导、空间和字号问题，未宣称高审美通过。入口整理为probe-agent-live.mjs，仅显式付费运行，语法/lint通过；原型实跑与整理后入口未重跑明确区分。

## 2026-09-16 · 知识关系的可编辑图示

先检索完整应用与生态：`github PPTAgent Presenton editable presentation diagram process PptxGenJS`，再组件：`site:github.com/gitbrent/PptxGenJS addShape chevron process diagram`。Presenton/PPTAgent沿用本报告已有固定提交和许可证审计，未做迁移。采用现有https://github.com/gitbrent/PptxGenJS v4.0.1 / 3c9ec1b687c174952166f6a34b5e87ebf69fa469（GitHub tag API实查），已安装包MIT；本地types验证addShape、line.beginArrowType/endArrowType。搜索成功，无权限错误。只复用native shape/text能力，不引入图编辑器、转HTML框架或新依赖。维护面为一个受约束的process scene、工具字段、现有PPTX/PDF两条路径及定页修订，现有布局不重写。

新title-process支持3–4步骤与可选循环返回说明，原生可编辑；界面工具新增process/newProcess，内容验证与现有版本纪律沿用。DSH 0.1.3-alpha.1 DSL不支持minItems/maxLength，首次接线测试明确拒绝；移除不支持的schema关键字，用字段说明+执行验证，不冒称JSON Schema全功能。初步真实文件测试已通过步骤内容、原生箭头、无整页图替代、四步骤修订、退出流程版式删除旧内容和未改页XML一致性；最终视觉与模型复测继续进行。

PptxGenJS维护补核：GitHub API仓库未归档，pushed_at为2025-11-28；不是近期活跃更新的保证。本次沿用已安装4.0.1、无升级，可控范围只使用长期现有的原生形状/文字能力，并以真实产物回归补兼容性证据。全量npm run check退出0：131核心+6提示词+5证据+2适配器=144项通过，0失败/跳过。

真实接入验证补记：整理后的probe-agent-live入口已实跑DeepSeek Flash/high，8次主请求、无工具错误、自动选用process并对实际PPTX overview和单页查看。原生循环箭头方向/文字已独立看图确认；不是仅凭README或schema宣称接通。工具回归与模型探针分列，保留第3页科学表述和交付说明失实问题。DeepSeek Pro补充审稿第一次max-tokens无文字，调整后提示科学简化但漏检交付问题，不作为自动验收。通用交付一致性短规则及跨领域工作表案例已加入，4次DeepSeek片段回归正确但基线也正确，不宣称统计提升。

## 2026-09-16 · 跨领域Promptfoo评测接入

检索完整框架/生态：`site:github.com/promptfoo/promptfoo deepseek provider thinking apiBaseUrl`；再查配置：`site:promptfoo.dev docs providers deepseek reasoning effort thinking eval no-cache`。采用已审计Promptfoo 0.123.0 / 29a15d1edb256c789d0035ce3f36ad7cf91db6bb，npm元数据MIT、Node>=22.22.0，本机Node24.19.0兼容；包integrity sha512-t2ADh6vU6OVGMu31hdcGZJLCfl4csqg+Ei8uRKzAaA2MZ/r9cTcsko43U8hdG6WfxqG+kqfx4Llplv6N0IfxZg==。先读官方DeepSeek provider、OpenAI兼容provider及prompt文件接口源码，不仅看README。DeepSeek模型ID依本轮官方/models实查，Promptfoo页面里的旧模型名不采用。临时目录安装框架，不改产品依赖。生成/评分均显式DeepSeek、本地结果、关闭共享/遥测，不调用默认其他模型。框架负责执行与评分，项目仅提供快照、案例和配置。46案属于合成策略题，无真实工具/文件，成绩不冒称全任务正确率。


Promptfoo实际接入结果：临时安装0.123.0，常规安装解析可选依赖过慢后明确停止，改用omit optional/legacy peer；CLI实际仍需hono4.13.8和@libsql/darwin-arm64 0.5.29（MIT，平台匹配），显式补齐并成功校准。未改产品依赖或锁文件。46案×2版生成完成，92份输出、0调用错误；使用框架原生echo回放相同输出，加完整原题后仅以DeepSeek重评，未重写评测器。两次各91/92自动通过但唯一失败的版本反转；复核确认rubric冲突及裁判漏检，因此不作为正确率/提升率证据。四条开发rubric已据此澄清，未追改原始成绩，修改后尚未重跑；证据见evals/work-quality/runs/2026-09-16-cross-domain。

## 2026-09-16 · 自动上下文压缩与科学建模检索

用户澄清：缺少自动压缩功能；建模指物理/化学、3D和键能/公式表达。搜索先覆盖完整Harness和Yan：`site:github.com/deepseek-ai/deepseek-harness compaction context summary`、`site:github.com/666-gy/Yan-Agent context compaction checkpoint`，再读官方compaction组件和本地实际源码。官方仓库https://github.com/deepseek-ai/deepseek-harness提交0d1f50007f9bca3f52b06e1c3074fa14d5fb0720，MIT，未归档，2026-09-15 push；安装版本0.1.3-alpha.1。采用官方standard预设的隔离group、compaction-basic、command-compact及tool-result-pruner，不改压缩内核、不新建摘要数据库、不增加依赖。实际发现web-app禁用host backend，Mochi四教师角色和教室角色又未挂载；“base有插件”并不证明自定义角色能自动压缩，纠正前轮过宽判断。新配置显式auto=true、thresholdRatio=.8、retainRatio=.16；保留默认失败恢复、持久日志、配对约束和当前模型路由。

科学建模先查完整生态：`site:github.com physics simulation educational modeling PhET`，再查组件：`site:github.com chemical molecule 3Dmol smiles rdkit`。实际仓库/快照：https://github.com/phetsims/states-of-matter / 9380195ad45c4b2cd5c2a09a220c4a2b011b4c8c（GPL-3.0，2026-09-13 push）；https://github.com/3dmol/3Dmol.js / cf6b68429dd9f435ba004d172c0616a8fe124206（GitHub许可证识别NOASSERTION，不能视为已完成许可审计，2026-09-12 push）；https://github.com/rdkit/rdkit / 20331b5101183089580840759c3ddf11a73efe31（BSD-3-Clause，2026-09-15 push）；均未归档，检索/API成功。PhET官方构建说明显示多仓库依赖，不适合为单个模型默认安装。此次只将其作为任务检索方向，不接入代码，不声称任何候选已适配。建模具体任务再核许可证、文件/方程、依赖及资产兼容；适用则复用，未找到则自行生成，无网络/访问失败与未命中分别记录。维护面为共享规则、mochi技能的一个参考文件和既有工具说明。

实际接入验证：7项自动压缩测试全部通过（五角色配置触发、摘要缩小及日志恢复、截断保留原历史、低压/关闭时不调用）；全量check为151项、0失败/跳过。真实完整profile在临时匹配Electron中启动，standard和五个自定义角色逐个自动压缩后继续回答，全部通过；多角色同时已挂载，未出现重复压缩。运行时探针首次暴露离线fixture元数据字段不符，修正id/name；六角色串行测试超过原30秒限时，增加到180秒并等待子进程退出再清理，避免超时与临时目录清理竞争。均为离线模拟适配器，无供应商调用，不能证明真实DeepSeek摘要内容无遗漏。受管profile生成/组合解析及原建模工具测试通过，git diff --check通过。没有重启用户App、修改用户会话或升级依赖。


## 2026-09-16 · 答辩 PPT 增加教师端与教室端互联

- 检索顺序：先完整框架及插件生态，搜索 `site:github.com reveal.js presentation framework plugins`；再生成组件，搜索 `site:github.com gitbrent PptxGenJS presentation`。搜索与 GitHub API 成功，不属于检索失败、无权限或未执行搜索。
- https://github.com/hakimel/reveal.js ：提交 `75dff6f515d2d08df0c32cf2b7328b89425c6f25`，MIT，未归档，最近 push 2026-09-10；网页演示、讲稿和动画。
- https://github.com/rajgoel/reveal.js-plugins ：提交 `5e5375a830eb8101836c10c1f3b56c71066c458e`，MIT，未归档，最近 push 2025-06-23；音频、注释等演示插件。
- https://github.com/gitbrent/PptxGenJS ：提交 `3c9ec1b687c174952166f6a34b5e87ebf69fa469`，MIT，未归档，最近 push 2025-11-28；JavaScript 生成可编辑 PPTX。
- 不接入以上候选：此次仅在现有 PPTX 增页，网页框架不直接匹配交付格式，更换 PPTX 生成库会扩大内嵌视频、字体、原生动画回归范围。候选依赖未安装，兼容性未测试，不宣称已适配。复用已有 Artifact Tool 构建脚本与 media.py 动画/视频封装，不增加依赖，不重写基础能力。
- 已确认：项目区分教师端与独立教室端；计划文本要求课前准备依据课表、教师偏好及有效授权计划。用户本轮补充学生查错题、AI 解题和答疑预约。合理设计推测：预约请求发往教师端，老师确认时间后回传。未验证：上述学生功能和课前管家已完成端到端落地；因此整页明确标为未来规划。
- 维护影响：五页增为六页，必须同步讲稿、媒体封装页数、末页动画时点及校验页数；保持四分钟排练目标，实际语速和现场播放另行确认。
- 接入后验证：六页 PPTX 完整性、几何/字体策略和 Artifact Tool 重导入通过；新增页渲染人工检查通过。最终包内 MP4 与原视频 SHA-256 一致；第六页品牌进入 35000 ms、旧文字退出 34350 ms 已核查。未进行新版 WPS/PowerPoint 原生放映验证。

## 安装包更新 · 2026-09-16

先检索完整打包框架 `site:github.com electron-userland electron-builder electron native dependencies mac arm64 x64`，再核对其原生依赖重建及现有资源暂存机制。采用 https://github.com/electron-userland/electron-builder 的已安装25.1.8（tag object 4e51e4cc84251698ef9c9a4f3445584637fd4d4b）、MIT、未归档，API显示2026-09-16 push。沿用Electron39.8.10、现有package-desktop和beforePack，不升级到当前27系列；其配置迁移会增加无关兼容成本。本机darwin/arm64，构建同架构DMG，不宣称Windows或Intel安装包已验证。已发现暂存白名单漏work-quality.md/mjs及process-layout.mjs，补齐并增加包内内容与源码一致性验证。构建、资源检查和启动实测结果随后记录。

## 2026-09-19 · 桌面桌宠模式（Petdex）

- 任务：评估把 Mochi 改成桌面桌宠（平时只有桌宠，点击才弹出待办/已批准面板）。**本票只做取证与方案，未采用任何新依赖、未改动任何源码**；结论落 [desktop-pet-mode.md](desktop-pet-mode.md)。
- 检索顺序：先完整应用形态，搜索 `github desktop pet app electron`、`site:github.com petdex`；再官方事实，读 petdex.dev 首页、`/docs` 与仓库 README。网页与 GitHub 均可访问，不属于检索失败或未执行搜索。
- [crafter-station/petdex](https://github.com/crafter-station/petdex)：**MIT**，未归档；官方文档 2026-09 仍活跃（最近提交 Sep 11, 2026）。自述为三部分：Next.js 网页画廊、Bun CLI（npm 包 `petdex`）、以及**原生 SDK 桌面端**。
- 关键兼容性事实（读官方 README 与 /docs 得）：其桌面端是 **native SDK app + 进程内 Zig hook server（127.0.0.1:7777）**，官方明示当前发布路径**没有 WebView、也没有 Node sidecar**；`packages/petdex-desktop-windows` 是已废弃的 Tauri 旧实现。宠物包格式为 `pet.json` + 8×9（或 8×11）网格精灵图、每帧 192×208，九行状态固定为 `idle/running-right/running-left/waving/jumping/failed/waiting/running/review`。
- **采用结论：不接入、不 fork、不引入依赖。** 理由：它的桌宠只提供"活动气泡"，且气泡设计上鼠标穿透，**不存在业务面板概念**；改造它等于写一个原生应用，而本任务形态是给已有 Electron 应用加一块屏。本仓已有等价基建（`rail.ts:248-251` 无边框置顶窗、`tray.ts:120` 托盘开关、`OrbCompanion.tsx:17` 六态机、`rail-model.ts` 行派生），**复用本仓既有机制即可，零新依赖**。仅借鉴其形态约定（置顶不抢焦点、气泡穿透、可拖拽、快捷键、设置项克制）。
- 未验证项（不写成已完成）：未安装其桌面端、未测试 127.0.0.1:7777 协议、未核对 `pet.json` 字段全貌；本仓侧"透明异形窗 + 鼠标穿透 + 拖拽"**亦未做任何验证**（全仓无 `transparent:true` 窗口、无 `setIgnoreMouseEvents` 调用）。
- 维护影响：若后续实施，走"纯主进程窗口 + `data:` URL 页面"路线则不动打包插件白名单与快照清单；走新插件路线则需同步 `PLUGINS`、`runtime-profile.json`、`EXPECTED_BUNDLED_PLUGIN_COUNT`（当前 25，已实读 `prepare-mochi-resources.cjs` 反解确认 25 条）与 `test-runtime-profile.mjs` 五处。
