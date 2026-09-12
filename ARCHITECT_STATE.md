# Mochi 主控续接状态 · 2026-09-09

> 🔴 **本文件状态结论已过期（stale）· 2026-09-12 标注**
>
> **status**: stale（正文结论已被现实推翻，未改写正文）　**last_verified**: 2026-09-12　**verified_by**: 工具线
>
> **三条被推翻的结论（`docs/AUDIT-2026-09-12.md` §3.3 取证）**：
>
> | 行 | 本文结论 | 现实（2026-09-12） |
> |---|---|---|
> | 下文第 1 段 | 「目标未完成，**不可宣称安装包已交付**」 | 已交付：`release/2026-09-09/Mochi-0.1.0-mac-arm64.dmg`、`release/2026-09-09/Mochi-Setup-0.1.0-win-x64.exe`、`release/2026-09-10/Mochi-Setup-0.1.0-win-x64.exe` |
> | §「当前唯一负责人」 | 「Mac 与 Windows 最终安装包……**仍未完成**」 | 同上，两个平台均已产出 |
> | §「Windows」 | 「**Windows 未产出**」 | 已产出，用户已下载安装 |
>
> **仍成立的部分**：负责人分工、契约路径、各 agent 的任务边界。
> **现行排期与交付判据**：`docs/tasks/MOCHI-URGENT-REPLAN-2026-09-11.md`（L0-A）。
> **本文件不删除、不重写**，只加本横幅；如需续接状态请另建新文件。

主会话仍为架构师/独立审核；生产代码、测试、配置与打包交 terra-max。契约：`/Users/a1379/.codex/attachments/81da5871-194f-4d11-866c-1c6df6384694/pasted-text-1.txt`。总体方案+用户后续今晚交付要求保持完整。（2026-09-09 时点结论：「目标未完成，不可宣称安装包已交付」——**已被 2026-09-11 实际交付推翻**。）

## 当前唯一负责人
- Halley `/root/p0_packaging_audit`：desktop/profile/vendor/lock/stager/最终安装包；另已授权 mochi-hello 的受管 shellEnv 接线。
- Lagrange `/root/p0_baseline_inventory`：教材/本机视觉模型/离线导入收口；现在构建固定alpha ChatWork conversation client，只交tgz，不改Halley consumer。
- Maxwell `/root/p0_cold_start`：LAN host/client/dispatch；当前修复身份变更后的历史收件绑定，随后独立教师shell审批验证。不要再派其构建official client。

## 已获得的主要证据（非整体完成）
- 可编辑PPTX/原生图表/局部修改、主动记忆、教师4预设已有独立证据，索引见各任务票，避免重复底层测试。
- 中文搜索最终候选 SHA 2bc95d878e32e65d809434573f796ffd9cd929acba60a65ccbf036870b24e8db；root真实反例已通过。
- 教材33册4844页，扫描OCR零pending。私有交付 `/private/tmp/mochi-textbook-import-delivery-20260909.ZQsVJK`；教材不入公共Git/CI/app。导入core root Node22 9/9通过（session71812）；最终app双击仍需验。
- 新知识库connection/config修复tgz `/private/tmp/mochi-knowledge-connection-fix-pack.rWznIU/mochi-knowledge-0.0.1.tgz` SHA 07aeb1f6f59971828c60505a2a1cae31c474993ea2c4731b81ef51b5aee7cb1b；root待复审真实Context证据与集成角色测试。
- LAN正常消息链 root独立真实Electron、隔离双HOME、物理点击、重复抑制PASS（session31508）：`/private/tmp/mochi-lan-root-final-XVaIem/evidence/golden-path-10/result.json`。首屏截图root已视觉查看；限loopback/headless，非学校网络/Windows系统通知。
- workbench必需betterSidebar导致课堂整页启动失败已改为官方延迟inject，root8/8与真实页面mounted通过。
- Playwright1.55/Chromium1187已在受管stage路径root真实DOM通过；这不等于Mochi自身shell已能在任意workspace调用。
- 本机aiaaa视觉适配器真实文本/合成图/取消/错误验证通过；使用官方私有凭据存储，密钥禁止进入本文件、Git与包。旧桌面未加载PiAI时没有强切默认模型。

## 当前必须完成的工作
1. LAN历史身份缺陷：configureIdentity保留旧inbox；旧卡按当前班级标旧消息，markSeen未在本地写入前核原收发完整绑定。Maxwell正固定原recipient/原sender，旧通知只读保留、改班/同endpoint换key后不得确认；新通知正常。正常链PASS不能替代该场景。
2. Halley实际dependency install/stage已运行：19插件/29DSH/99附加模块；实际package tests与受管browser通过，尚无最终新Mac安装包。接新KB tgz重验实际课堂3只读工具、空库查询、真实原页。
3. 真实teacher shell→审批→workspace写入/外部拒绝/无系统Node/npm运行Playwright。已批准最小 mochi-hello shellEnv `DSH_MOCHI_NODE` + web-host受管NODE_PATH、Node路径、browser路径；不新造插件，不放宽课堂权限。既有直接Executor探针不替代该验收。
4. Lagrange构建实际official conversation client浏览器bundle：源 `/private/tmp/mochi-chatwork-slot01.t1D7NV/source`；patch `/private/tmp/mochi-chatwork-slot01.t1D7NV/evidence/chatwork-slot-api.patch` SHA1ceef24f909db0c39eb228146306471f71b00e48d63814b7cca428b9f224b8c8。保留固定alpha与MiMo，交Halley集成，真实ChatWork UI仍待最终包验证。
5. Mac与Windows最终安装包、全新启动/图标/教材导入/实际工具与Golden Demo总验收仍未完成。Windows学校实机无证据，勿用Mac或Windows2022CI替代。

## 待用户回答（不要重复询问内部实现细节）
- 私有校园repo仅新建Windows构建分支/私有CI产物的授权仍未收到；不改校园源码/default branch，不公网发布。
- “仅限moi使用”的key范围仍待澄清（Mochi软件所有老师默认，还是本人）；原用户已提供key，绝不能说没给。当前只做本机安全测试，不随安装包分发。

## 环境/保护
- 原始 apps/desktop/node_modules 不动；集成树 `/private/tmp/mochi-alpha-integration01.pRu0Ap/workspace/apps/desktop`。
- Node22 `/Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node`；外部NM native fs-ext为Electron ABI140，普通Node ABI127不可混测native。
- stage `.mochi-package-resources-v1.nosync`；当前release/mac-arm64/Mochi.app为旧候选，不能当新交付。
- WORKLOG.md含本机明文认证信息，不打印/外发/整文件提交。禁止git add -A；保持用户改动与私有教材。
- 复用记录只由root维护docs/reuse-audit.md。恢复时先核真实文件/进程/agent状态，不把本状态当成活进程证据。

## 本轮续接独立复验增量
- root再次运行新KB verify-alpha-optional-connection 与 verify-alpha-profile-empty-search（Node22/clean alpha consumer）均exit0 PASS；允许集成。tgz夹带scripts测试，Lagrange正仅净化files后重打，不是功能返修。
- ChatWork已实际build/pack：`/private/tmp/mochi-chatwork-slot01.t1D7NV/evidence/build-20260909Tchatwork/pack/deepseek-ai-dsh-client-ui-conversation-0.1.3-alpha.1.tgz`，root亲验SHA c3a16aa29630c1439cce5cfb54a8dd35febe974f09b74bf88b77b4960f4d5c90；包内client.js SHA c24234f3dcb0677f19f7639392e582be9be2bb01e2a88980981c76edd7bd42a1。已允许Halley接入，真实最终UI验收仍待。
- hello裁定：保留原树installModelDiagnostic及connection+llm延迟注入，将其dsh-llm依赖精确对齐0.1.3-alpha.1；禁止外部旧简版覆盖该既有功能。此最低metadata变化与既定shellEnv均已授权Halley，无需再询问。
- 自动发现已核源：UDP5秒、15秒本地TTL；模型mochi.list_classrooms明确区分paired与发现候选。学校实际广播/Windows防火墙未测，总纲组播备选仍未实现，不得声称全网发现完成。

## 当前责任更新
- Lagrange已完成KB最终净包85c733659c02a788a633e0bb348ba0b3a5541fbbe77acd8dc3fbf10529b05ca5（root亲核11文件及hash），现接独立teacher正式工具审批/受管Playwright验证；Maxwell仅LAN历史身份修复，不再承担shell。
- Halley实际节点为固定npm11.6正常安装finalKB+ChatWork+保留诊断的hello，随后stage/实际classroom。未把正在修复的LAN版提前放行。

LAN历史绑定修复已root独立durable/10client tests通过并允许Halley集成，具体hash/场景见URGENT-08-LAN尾。Maxwell现同步冻结新host/client复跑v10真实Electron正常通知链，历史修复不再待实现。

LAN最终身份绑定版正常UI链：Maxwell结果 `/private/tmp/mochi-lan-electron-identitybinding-5jDhQU/evidence/golden-path-10/result.json`，root已亲读result并查看首屏PNG，接受正常通知/物理seen/重复抑制/签名回执复验。Maxwell转独立teacher真实ChatWork UI验收，协调Halley固定consumer；不再改LAN源。hello Windows提示缺&已root发现派修并确认源修正，需进入最终tgz。

当前consumer冻结后的root独立验证：在external desktop用Node22执行scripts/test-classroom-role-runtime.mjs（session37094）exit0，真实DSH课堂preset仅3个knowledge模型工具、LAN lockedRole固定通过。该脚本为source/dev布局（测试专用workspace/node_modules相对链接指向apps/desktop/node_modules），不是最终app验证。Halley已开始release候选构建，Lagrange与Maxwell分别只读该consumer、独立HOME验shell和ChatWork。

打包新阻断/已裁定：builder前host-deps检查拒绝presentations/documents普通依赖file:../../packages/mochi-pdf-layout。root核共享包已固定0.1.0、desktop根已供应内容寻址a3f9ed33 tgz（⚠️ 2026-09-12 更正：该 tgz **不含 `drawTextLine`**，而 `plugins/mochi-presentations/index.mjs` 现在要导入它 → `test-package-resources` FAIL。见 `docs/AUDIT-CODE-2026-09-12.md` 缺陷 1），授权Halley仅两插件metadata改精确0.1.0并重包正常安装，保留共享实现与checker；验证解析同内容。此前consumer冻结需先协调两个验收者，禁止静默并发改NM。builder尚未真正启动，旧release不是本轮产物。

文档交付缺口新发现：external plugins/mochi-documents为旧LibreOffice版（index2756d02f...），原树为纯JS共享PDF版（indexce7b243c...）；两个runtime-profile均无mochi-documents条目，stage对应目录也无。已要求Halley核实际受管文档入口，先解presentations checker，不盲目增白名单。不能将源码documents能力PASS当随包完成。

最新构建准备阻断已定位：prepare-release-input的sourceMetadata查resolveCampusSource.root Git，external校园copy无git；root原campus.nosync git有效，三个必要static资产与external SHA一致。已授权Halley用现有MOCHI_CAMPUS_SOURCE_ROOT指原只读源码，使用对应真实static入口，不改helper/campus或绕provenance。PDF metadata修复tgz53a7d39060761be6f6fdab7cff773b028306212b047a42c1848dde7ef22e93af已root逐文件对比仅package依赖更改，通过checker。Lagrange shell首轮/tmp属于writableRoot导致fixture失败，已保留；正式重跑session14805用自建/Users/Shared边界目录，agent负责poll。

实际新Mac候选已生成：release/mac-arm64/Mochi.app ASAR5366cfe82f9533f1b56f9425b19288cb1f0210ab355ec14a617c519de6baad80。root用该app embedded Node、包内NODE_PATH和browser路径、无系统Node/npm的PATH从独立cwd执行Playwright真实DOM PASS（session37429，Node22.22.1/Chromium140.0.7339.16）。root又用私有交付.command+该真实app+isolated teacher role HOME导入33册4844页PASS（session55599），证据/private/var/folders/38/0n1yygv5031_w798dhgjscyw0000gn/T/mochi-finalapp-import-root-9ha5_dc1/result.json。前次/var别名触发禁止symlink的fixture失败保留，非绕过安全。仍待实际app查询/课堂导入/完整启动与DMG。
Shell Golden曾因尾printf使overall0从而host denied:false停止；root明确校正验收：实际EPERM+外部哨兵不存在已证明拒绝，保留raw标记不宣称host识别成功，不应强求非需求字段阻断后续审批/browser测试。Lagrange继续后半链。

root实际包内教材补验：使用新app embedded Node及Resources/mochi/plugins/mochi-knowledge/knowledge-store.mjs读取teacher导入库，严格assert books33与query.results.length>0，化学平衡hits5 PASS；证据teacher导入根packaged-search-result.json。首个探针误按query.length取值，仅books断言有效，已立即校正，不能将首轮称查询PASS。教室.command+真实新app导入独立classroom HOME也PASS（session73351），证据/private/var/folders/38/0n1yygv5031_w798dhgjscyw0000gn/T/mochi-finalapp-class-import-weclk_zu/result.json。仍为包内函数查询，非课堂真实聊天UI调用。

Mac DMG已生成release/Mochi-0.1.0-mac-arm64.dmg约853MB；root hdiutil verify session68395 exit0 VALID。仍未全功能放行。打包期间consumer fs-ext被重建成x86_64（04:22），二位agent启动ERR_DLOPEN_FAILED；root确认实际release/mac-arm64.app内fs-ext/主程序arm64且dsh/playwright存在。已授权Lagrange/Maxwell各自clone该真实app独立副本继续shell/UI，禁止再等待重复路径确认或使用漂移consumer；Halley查额外x64构建原因。

DMG新证据：894809654bytes，owner SHA a19e8235874fe8e5a463884873d1203053315a75ee2610fd5f3b8f5e24f94e7c。root只读挂载实际DMG，镜像内主程序/fs-ext均arm64，ASAR5366cfe...与release相同，已卸载/dev/disk4。x64消费树漂移不等于此DMG损坏；仍非全功能放行。Halley停止深入builder内部，显式文件promotion准备中；禁止原NM与宽泛Git操作。

重要promotion差异：root亲核原desktop package已有memory7da47a57及buildResources/build+mac.icon.icns/win.icon.ico，external仍memory5ea318c1且缺图标配置。当前DMG并非全部已验功能最终组合，下一构建必须补齐。Halley已获批以原树新配置为基线最小合并ChatWork/LAN/KB/search/workbench/hello/PPT/Playwright，19插件逐一核源/包hash，不能整份外部package覆盖原树或回退记忆；新隔离consumer生成lock，原NM不动。

19项源/vendor审计进一步纠正：memory7da包也未含原树已验active-context，不能仅保留7da即宣称主动记忆入包。Halley获准按当前已验原树memory源正常净pack新hash，不改实现；下一包以该新tgz为准。audit路径/private/tmp/mochi-plugin-vendor-baseline-1788899529508.json。sidebar仅按发布条目比，maps/开发文件排除不是漂移。

纠正memory新旧判断（以前述说5ea旧/缺active的记录为错误）：Halley正常重pack当前源得到相同5ea318c1892ccb1009b7fe70446ee7b3bb665cdeb0984bad5b0234f60cfdd9db；root独立解包10文件逐个与原树比对全部相同且含active-context。5ea是当前active源码，7da才旧，原DMG该memory无需补齐。保留5ea，夹带测试mjs作为非阻断净包事项不再为此重打；图标缺配置仍真实需修。用户已明确更正此前误报。

教师shell真实App Golden通过（Lagrange session10997）：/private/tmp/mochi-teacher-shell-golden.S8lqBb/evidence/result.json；runner27ca65ad28e46e10f00a25b63d2783dac500055827b6f53341a1fee339da0ac1，clone /private/tmp/mochi-teacher-shell-golden-packaged.RQQyJP/Mochi.app ASAR5366。root亲读正式ctx.tools.execute、single-call strict fixtureapproval、真实OS拒绝/外部哨兵不存在/r+前后hash/managedPlaywrightDOM断言与result，接受该范围PASS。真正问题是默认remote approval handler在前等待；fixture global+prepend限定agent/bash/callId一次答复解决；不改生产审批。仍非Windows或真人UI审批证据。Lagrange现执行DOCUMENTS-TOOL-01；不要重跑已过shell链。

原树promotion进行中root抽核：250个file依赖文件均存在，package/lock根依赖一致，mac.icon.icns/win.icon.ico保留；hello diff保留diagnostic+已验shellEnv，无回退。仍等Halley完整显式索引，原NM未操作。Maxwell真实UI夹具改用既有sidebar E2E的workspace.create→session.create后物理操作，避免仅host create未选workspace导致UI空。

Halley显式promotion完成13源码/配置/锁+10vendor，原NM未动；root git diff --check PASS并读受管web-host路径/KB与LAN role配置。新增classroom-role-runtime/test-shell-env；vendor固定dispatch1a046cbc/hello7ca832d0/KB85c73365/LAN1f9e9578/client52167b50/memory5ea318c1/PPT53a7d390/search2bc95d87/workbench636ee36c/conversationc3a16aa2。root package50df596f/lock2b69c6ad对应正常隔离锁，图标保留。原树hello测试缺既有cordis开发解析，禁止因此补装原NM；正式回归在新外部consumer。Halley等文档tgz再生成完整下一候选，不另造缺文档包。

新P1客户端缺陷：Maxwell实测LAN overlay hidden=true/aria-hidden=true但visible=true；root确认client.js435 display:grid覆盖UA hidden，缺[hidden]规则。授权Maxwell仅client.js/test修隐藏CSS并真实关闭computed display/点击验，再重pack；旧client52167候选尚不可交付。Halley已重新启动接总纲33组播239.86.79.67备用发现最小实现（仅lan-service发现+tests），与Maxwell文件分离；之后回desktop最终集成。Lagrange继续documents入口落地。

LAN关闭CSS修复已落地：client SHA1b8ccdc627bc3c8fdf1ed60fb9a32e68d0b4cd9b34a2e50a2c712163628d7610，root亲读仅组件[hidden]{display:none}并独立client11/11 PASS；Maxwell在独立实际App资源同步此新源，继续computed display/点击与ChatWork链，净tgz待交。该候选已改Resources client，勿以ASAR仍相同声称整个App未变。

文档首版已在plugins/mochi-documents/plugin.mjs落地，root读源发现明确bug：先validateStructuredDocument得到template对象，再传generator内部二次验证仅接受字符串，正常输入必失败。已派Lagrange传原始args给既有generator且保留预验/特殊门，并补真实调用测试；不改engine。pages模型描述还需准确text/columns/rows示例。Halley一UDP socket双路径广播+组播实现准备，真实loopback multicast probe收包成功，完整测试待。

文档适配器root复审通过：真实App Electron+alpha dsh-tools verifier session69723 exit0，输入修复document:args已核，最终tgz /private/tmp/mochi-documents-tool-final.yKrk5n/mochi-documents-0.0.1.tgz SHA a6661bebdcdd60e381bdf8959cfca60e2a5be4b5851e89c7b57452e52515c47d 净4files。仅工具适配器范围，ctx register/policy仍fixture，最终Teacher ToolRuntime/课堂排除/包闭包由Halley集成验。Lagrange转只读P3现有能力差距核查，禁止直接扩大代码实现；Maxwell真实CSS关闭+ChatWork链运行，Halley组播host修复后唯一集成。

组播备用发现root独立复验通过：Node22 test.mjs exit0，亲读sender主信标指无人端口、仅真实组播到observer的断言；双路径恢复同endpoint去重、本地TTL、配对/消息/回执/身份拒绝回归通过。test-durable独立exit0，组播加入失败主路径ACTIVE、UDP绑定不可用HTTP/手动路径DEGRADED及历史身份保护通过。已授权Halley新host pack后衔接唯一desktop最终组合。学校实网/Win10未测。ChatWork headless CLI尺寸无效，已授权Maxwell独立App非headless真实BrowserWindow验证，严禁innerHeight>=外窗height这种错误前置条件。

ChatWork真实独立App GUI Golden PASS：/private/tmp/mochi-chatwork-electron-golden-20260909-01/run-uHSb7f/evidence/result.json。root亲读result并看01-auto-work-running/04-manual-chat-complete-turn截图；正式窗口outer1080x720/content1080x688，physical workspace/session/Chat点击，真实LlmAdapter+ToolRuntime两个fixture工具，自动Work与同turn手动Chat保持到completion通过。ASAR5366/c3a16conversation，LAN client为hidden修复1b8ccdc；无真实模型付费调用，不等于Windows/全品牌验收。Maxwell正常净pack新client交Halley。LAN footer中心被父overflow:auto裁剪：未证明用户滚动不可达，Lagrange只读核查，不能先认生产bug。root核总纲5及jxl-brand hero明确嘉行联/水母作为校园品牌，顶左JXL是约定，勿误改为所谓品牌修复。

LAN footer裁剪非阻断已实证关闭：Lagrange只读实际App物理wheel+pointer /private/tmp/mochi-lan-footer-scroll-20260909.rSCJab/run-FMmxfq/result.json，root亲读clientHeight261/scrollHeight285/scrollTop23.5后hit自身、点击grid打开关闭none。无需为fixture未滚动改共享sidebar。source tgz host841d1deb63326a45c401d584b453d89b31c5d8ac15e4a7ef1cd0d0cde5aa3fba在原vendor（含tests，非阻断）；client cce72b50f0cce82743890ce94bfbeeecc49ee4e0da258b86d4de92e0fcac9c4c净3files已root核。Halley外部最终映射已出现docs及新host/client；root再次发现external缺原icon配置，已派补，未构建放行。

证据保留更新：root复制ChatWork result/commands/两关键截图至 artifacts/architect-audit/chatwork-final-gui-20260909，避免临时目录丢失。Lagrange清理footer fixture时误删原result与runner，root先前确已亲读完整result（本轮工具输出仍有），当前链接不再有效；已要求只从真实原记录恢复或明确不可恢复，不重复跑并冒称旧证据。图标external buildResources/icon.icns/icon.ico现已root确认补齐。

最终Mac候选新增：ASAR a73cabf793d6d72b18776145f98ba489e8e0d1b21a62cb5082ffb544ae612eda，20plugins106additional。root核4个最新LAN/doc入口hash与已审源一致、icon58c4、main/fs-extarm64。最终DMG899441303bytes SHA d3a83f0e856543f6f58cddf3e995169e5ca2b5791e13ed59ad652e908e73b1de，root session55437 hdiutil VALID且readonly挂载实际内容一致、已卸载。已复制到 /Users/a1379/Documents/Mochi/release/2026-09-09/Mochi-0.1.0-mac-arm64.dmg；仍候选，等Lagrange实际包documents与Maxwell实际完整main启动。两个agent已followup真实启动，不是闲置：Lagrange只外部docs fixture；Maxwell仅实际App main启动与干净HOME/userData、不是另造BrowserWindow。Halley最小promotion已完成，root package/lock/filedeps一致图标保留。footer result已从真实旧记录恢复并有RECOVERY声明，root复制到artifacts/architect-audit/lan-footer-scroll-recovered-20260909。

P3只读缺口（未授权扩大当前冻结候选）：课堂当前仅3知识工具+受验证通知/文件接收；尚无受控原生打开课件、课表/偏好提前启动、显示器/投屏控制链。LAN传输不自动执行，不能把通知PASS等同打开软件PASS。后续最小方向为受验证fileId+本机确认+路径/hash/扩展名复核的默认程序打开；课表来源仍未决，真机WPS/希沃/C30/投屏行为无证据。Lagrange读现有Harness/PowerToys只是参考，未新增依赖或代码。

root最终实际包documents独立复验PASS：session30652 exit0，/private/tmp/mochi-documents-root-final-2sv6cllh，使用完整物理App副本a73、实际Teacher ToolRuntime/lesson-planning/包内docx/PDF依赖，中文OOXML段落表格与完成标记通过。前两次rootfixture前置错误（App软链被physical断言拒绝、未提供复制hash记录）保留，不是生产失败；第三次真实复制前/后/运行输入完整。root复制result/input/runner与真实文档至artifacts/architect-audit/final-mac-documents-root-20260909。最终Mac DMG本机运行范围通过，但总goal仍active，Windows未产出/授权未答、真实校园未测/P3缺口保留。Windows本地准备由Halley继续：移除公开push前置，私有分支mochi-source完整白名单快照方案，未远程写。
