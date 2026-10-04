# 开源复用审查

## 2026-09-24 · 教师喊人的自然语音通报（实施前）

先检索完整应用和生态：`site:github.com open source desktop classroom voice announcement school teacher call student text to speech Windows Electron`、`site:github.com open source school PA announcement app natural voice text to speech Windows`、`site:github.com open source Windows desktop assistant voice notifications natural speech local TTS app`、`site:github.com open source classroom management software broadcast voice announcement student name teacher Windows`；再查单个语音引擎/组件：`site:github.com/k2-fsa/sherpa-onnx Windows Electron Node.js offline Chinese TTS Kokoro license`、`site:github.com/rhasspy/piper Chinese Mandarin voice Windows text to speech license`、`site:github.com/hexgrad/kokoro-82m Chinese voice license TTS`、`site:github.com electron Web Speech API speechSynthesis Windows Chinese voice offline issue`、`site:github.com/k2-fsa/sherpa-onnx kokoro-int8-multi-lang-v1_1 nodejs windows npm package`。GitHub 搜索成功；未找到能直接接入当前 Mochi 签名叫号协议的完整学校应用。重点候选：

| 候选 | 核到的版本、许可、相关功能与维护 | 取舍 |
| --- | --- | --- |
| [MoHan Windows 桌面助手](https://github.com/flameblade-studio/MoHan-PC-Desktop-Assistant/tree/931a0bd9ee3493842b85581efa6ddd43e39602d7) | 本轮 HEAD `931a0bd9ee3493842b85581efa6ddd43e39602d7`、公开正式版 v4.6.0（2026-08-29）；源码 MIT，但角色美术/人设保留权利。已有 Windows 本机女声、OpenAI/Azure 可选语音和权限门。其声音包、依赖闭包和校园场景未实测。 | 参考权限与故障回退设计，不移植整个桌面应用或角色美术。Mochi 已有叫号审批和签名 LAN。 |
| [ASTRA](https://github.com/shravan-kapare/ASTRA) | 公开仓库描述 Windows 本机语音助手、Piper 本地 TTS，仍为早期预览；本轮 `git ls-remote HEAD` 超时，未锁提交、许可证和依赖，不能据 README 宣称可用。 | 不接入。 |
| [sherpa-onnx v1.13.8](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8) | Apache-2.0，2026-09-10/11 发布，Windows x64 构建与 [Node addon 示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/README.md)可查；本轮 npm 核到 `sherpa-onnx-node@1.13.8` 且可选 `sherpa-onnx-win-x64@^1.13.8`。Node addon、模型在 Mochi 的 Electron/Windows 打包和实际教室机器尚未测。 | 优先评估作离线中文 TTS 引擎，避免用浏览器系统默认声音假称“自然”。接入前仍须验证具体模型、打包与真实输出。 |
| [Kokoro v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) / [GitHub 推理实现](https://github.com/hexgrad/kokoro/tree/dfb907a02bba8152ca444717ca5d78747ccb4bec) | 模型及推理库标 Apache-2.0；中文模型权重 SHA256 `b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b`，Hugging Face 模型仓总计约 394 MB；[sherpa 导出流程](https://github.com/k2-fsa/sherpa-onnx/blob/master/.github/workflows/export-kokoro.yaml)有中文多语言 ONNX/量化版。权重授权已核，特定中文音色的听感与 Windows 性能未实测。 | 候选离线自然声音；若纳入安装包需明确体积、校验和与试听验收。不能只因模型卡称高质量就保证不像医院播报。 |
| [Piper](https://github.com/rhasspy/piper/tree/73c04d81d5590ecc46e522de3601ce7fb29fc2be) / [Edge TTS Node](https://github.com/andresayac/edge-tts) | Piper 仓库已于 2025-10-06 归档；Edge TTS Node 是 GPLv3 包，调用 Microsoft 在线服务且无官方服务契约验证。 | 不作为默认：前者维护停止，后者引入网络/许可/服务稳定性问题。 |

本地事实：教师 `mochi_call_student` 已把单人姓名、地点、时间写进经人工批准的 `directive.verdicts[0]`，经签名 LAN 到教室；`newAttentionPayloads` 首次快照刻意不弹历史，但普通通知也会投影成视觉上的 `call`，不能凭这个标签决定语音。拟只在**当前配对教师的全新单人叫号**进入教室端时，按原消息 ID 去重，播报简短、公开的“姓名 + 请到哪里 + 何时”，不读听写成绩、长正文或隐私原因。视觉提醒与人工“已看到”保留；播报开始/完成只表示设备尝试发声，不能冒充学生听见。Windows 教室机的音频设备、自然中文音色及静音策略待实机验证；离线模型还是联网合成的取舍已向用户询问。

后续检索与用户决定（同日）：[Windows 11 讲述人自然中文语音](https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices)可下载后离线用，但微软未文档化第三方 Electron/SAPI 调用；[NaturalVoiceSAPIAdapter v0.2.9 / 提交 7194eca5](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/tree/7194eca5) 虽是 MIT，却要求系统级注册 DLL、提取系统密钥，其[维护说明](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/wiki/Narrator-natural-voice-download-links)称新商店语音不再工作，因此不作为校园默认方案。[sherpa-onnx v1.13.8](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8) 的 Windows x64 TTS CLI 是 Apache-2.0、17,324,649 B、SHA256 `416011eabb9a1e26fd4433b41871d67c7a00b1f0a11b75fe66ff8182b8224f95`；[Kokoro v1.1 中文 int8 模型包](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models)为 147,031,220 B、SHA256 `a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6`。二者大小与 digest 由 GitHub Release API 资产元数据核对，未在本机下载解压。用户批准**安装后自动下载约 164.4 MB 的独立包**；主安装包不携带模型、合成无需付费 Key，第一次下载期间用 Windows 已安装中文语音回退。采用独立 CLI 是对 [Electron Node addon 打包问题](https://github.com/k2-fsa/sherpa-onnx/issues/1945)和本项目原生 ABI 经验的维护成本判断，目标 Windows 尚未验证；CLI 参数仅携带经批准的公开叫号短句，仍可能短暂出现在本机进程命令行，不能把成绩或私密备注交给它。

接入后本机验证：`voice-call.ts` 只从当前未拉黑的配对教师、收件身份一致的全新 `老师叫号` 单人判定提取语音；首次快照静默基线和持久消息 ID 账本防止重启重播，当前 1000 条 Inbox 与 1200 条账本上限的滚动回归通过。发送端有补充交代时不带句号，解析器按真实模板识别，但始终不朗读补充交代与消息正文。语音包安装器在下载后统一校验两份归档的字节数和 SHA-256，再校验路径、临时解包、原子安装与已装 EXE/ONNX 摘要；合成夹具覆盖篡改、穿越路径、陈旧暂存、并发去重和平台门。`npm run test:voice-call`、`test:voice-pack`、桌面 TypeScript、教师/教室真实 Electron 模型页和根 `npm run check` 通过。当前 macOS 网络到 GitHub release-assets 超时，没有取得真实二进制；Windows `tar.exe`、CLI 运行、中文音色听感、扬声器和真实 LAN 新消息仍未现场验收。若多间教室同时首次安装，下载总量按设备数线性增加；可由已校验安装目录预置到同角色用户数据目录，避免重复走外网。

后续同任务审计发现一个本地队列背压边界：合成队列满时已返回 `false`，而投递账本预先写成 `attempted`，同一条新叫号此后不再进入队列。沿用现有签名 LAN、持久账本和队列实现，只把**明确未入队**的 `busy` 结果暂记为 `deferred`；下一次已认证快照仍须重新确认原消息唯一、同一教师有效配对、未屏蔽及同一单人叫号。异常、未知结果和重启后的历史继续禁止重播，已接收但超过 90 秒的播报按时效规则只保留视觉提醒。单次最多尝试 20 条，测试覆盖重试、撤销配对、重启静默和有界处理。`shared-MD` Windows CLI 可能需要额外 VC++ 运行库，这是由资产名称推得的**未验证假设**；本机未取得真实归档，也未在干净 Windows 机检查 DLL 依赖，不能据此宣称语音包必然可运行。

## 2026-09-24 · 双端背景切换与课前应用准备（实施前）

按“完整应用/生态 → 单个插件/组件”的顺序检索。背景完整应用搜索词：`site:github.com open source classroom teaching desktop app changeable background themes teacher presentation`、`site:github.com open source Electron AI desktop assistant customizable wallpapers backgrounds themes`、`site:github.com open source whiteboard classroom app background gallery change background`；组件搜索词：`site:github.com react wallpaper background picker localStorage theme gallery component classroom`、`site:github.com react electron background image themes CSS variable persistence plugin`、`site:github.com chat tool change UI theme natural language assistant background`。课前启动完整应用搜索词：`site:github.com open source classroom management software launch applications scheduled lessons teacher student computers`、`site:github.com Veyon classroom management launch application lesson timetable teacher computers open source`、`site:github.com open source education timetable classroom kiosk schedule launch app desktop`；组件搜索词：`site:github.com electron safe allowlisted external app launcher schedule child_process spawn class timetable`、`site:github.com open source Electron scheduled launch installed applications allowlist desktop app`、`site:github.com node cron scheduler persistent jobs desktop app power wake sleep`。GitHub 网页检索成功。以下是本轮核对范围；没有把仅看到搜索结果的候选当作已适配。

| 候选 | 已核对的版本、许可、相关功能与维护情况 | 结论 |
| --- | --- | --- |
| [pi-desktop](https://github.com/FaqFirebase/pi-desktop/tree/c931cd67f00e725adcfebc16be48505ebb6aec5a) / [drawsplat](https://github.com/mguhlin/drawsplat) | 前者本轮 HEAD `c931cd67f00e725adcfebc16be48505ebb6aec5a`，搜索结果显示主题库；后者是教学白板背景库。两者的许可、依赖闭包及当前维护情况未完成接入核对。 | 只作为完整应用的视觉/工作流候选；不能据 README 或搜索摘要复制代码。Mochi 已有 DSH 聊天壳与一套固定校园背景，整体替换成本高。 |
| [dsh-any-background](https://github.com/Tkingxiao/dsh-any-background/tree/eab8474449dfec2c9c4866869b31a9883adaf239) | 本轮 HEAD `eab8474449dfec2c9c4866869b31a9883adaf239`；[package.json](https://github.com/Tkingxiao/dsh-any-background/blob/main/package.json) 标 v0.3.0、`engines.dsh` 为 `0.1.5-rc.2` 到 `0.1.7-alpha.1`；[LICENSE](https://github.com/Tkingxiao/dsh-any-background/blob/main/LICENSE) 为 MIT；搜索时仓库有 38 次提交。支持图片/视频背景、模糊/透明度及持久配置。 | 部分采用状态与材质思路，不直接安装：Mochi 锁 `@deepseek-ai/dsh-* 0.1.3-alpha.1`，版本范围不兼容，且该插件以设置表单为入口，不符合本次对话切换要求。避免引入另一套背景状态。 |
| [Veyon](https://github.com/veyon/veyon/tree/0c629d9931810a5974038fc1a207d52fbd0e65f6) | 本轮 HEAD `0c629d9931810a5974038fc1a207d52fbd0e65f6`，GPL-2.0，Qt 教室管理软件，含远程启动程序/网页；许可和运行时与 Mochi Electron/DSH、已有签名 LAN 不相容。当前维护的精确活跃度未核对。 | 只参考“教师授权的教学资源在教室端准备”流程，不接入远程执行协议。直接把学生对话映射到任意命令会扩大教室端权限。 |
| [node-schedule](https://github.com/node-schedule/node-schedule/tree/afaefb9b52737955633676ef7c5913146de45eb9) | 本轮 HEAD `afaefb9b52737955633676ef7c5913146de45eb9`、MIT，进程内定时调度；本轮未核对其维护频率及与桌面锁依赖的完整兼容性。 | 不接入第二套调度：进程重启后的任务持久化需要另补，Mochi 已有 SQLite 持久任务调度器。课前准备应复用现有任务/课程状态与受限应用清单。 |

本地已确认：教室端给学生、教师端给老师；教室端可为即将开始的课执行**教师授权**的应用准备。现有背景只有 `client-plugins/jxl-theme/assets/campus/jxl-campus-watercolor-v1.webp` 一张，CSS 写死路径；现有任务调度器已将任务写 SQLite，但它目前只支持提醒/通知，不等于已经有安全的应用启动能力。拟采用当前 DSH 工具与本地持久化基础，给双端提供可对话选择的有限背景集合，并让教师以自然语言登记课程与偏好；教室端仅执行经核对的 APP 标识，不接受学生消息携带的 shell 命令、路径或任意 URL。课表来源与具体 APP 清单仍待用户答复，未验证学校设备安装情况、开机/睡眠后的准点启动和多机同步。维护成本主要是跨端授权、课程变更后的取消/重排、平台应用标识与本机安装状态；这些必须有具体回归测试。

启动 API 另核官方资料：[Node `execFile`](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback) 默认不开 shell；[Apple NSWorkspace](https://developer.apple.com/documentation/appkit/nsworkspace/open%28_%3Awithappbundleidentifier%3Aoptions%3Aadditionaleventparamdescriptor%3Alaunchidentifiers%3A%29)提供按 bundle identifier 启动；[Microsoft App Paths](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration#finding-an-application-executable) 说明每机/每用户应用登记和查找范围；[Electron shell](https://www.electronjs.org/docs/latest/api/shell#shellopenpathpath) 提供 `openPath`。这些证明存在平台启动机制，不证明任一指定教学 APP 已安装或其标识正确。Mochi 当前 Electron 主进程只实现了外开 HTTP(S)/mailto，DSH Web Host 是子进程；不能把浏览器侧 `shell.openPath` 当作已经给了模型可用的启动器。

## 2026-09-24 · 桌宠待办的材质与扫读层级（实施前）

先检索完整桌宠应用：`site:github.com open source electron desktop pet expandable panel animated window spring macos`、`site:github.com open source desktop companion notification expandable mini window electron pet`、`site:github.com Clawd on Desk mini mode expanded window animation`；再查组件与宿主：`site:github.com/electron/electron BrowserWindow setBounds animate macOS documentation`、`site:github.com electron desktop pet spring window bounds animation interruptible`、`site:github.com/motiondivision/motion spring animate from current velocity documentation`。搜索成功。[Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk/tree/90293fc00c591c1a5e976695154646041068f8a3) 的既有审查已锁 v1.1.0/提交 `90293fc`，有 mini idle/alert 映射，代码 AGPL-3.0 且美术另有限制；[OpenPet](https://github.com/dengyie/OpenPet) 是 Electron 宠物及聊天控制中心，当前网页称 release candidate，但本轮未锁提交/许可证/依赖闭包，不接入。[Electron BrowserWindow API](https://github.com/electron/electron/blob/main/docs/api/browser-window.md)证实 macOS `setBounds(..., true)` 是原生动画并在完成时发 `resized`；本机锁 Electron 39.8.10/MIT。现有 rail 已用原生 macOS 窗口动画、其他系统从当前尺寸继续的边界插值、用户减少动态效果开关，整套重写为另一个动画库维护成本高且窗口行为风险大，故本轮复用现有动效，只改材质、字体层级和短时视觉反馈。真实 336px 截图见 `docs/evidence/2026-09-24-teacher-todo.png`：次要信息为 11px 且低对比，这是已确认观察；在不同桌面背景下玻璃质感和对比仍需渲染截图复核。

## 2026-09-24 · 教室提醒的完整内容与签收语义（实施前）

先搜完整通信应用/生态：`site:github.com open source classroom teacher student messaging app read receipts assignment feedback kiosk desktop`、`site:github.com open source school communication app teacher student notifications read receipt verdict attendance`、`site:github.com KDE Connect notifications read receipt message app desktop open source`；再搜具体通知组件：`site:github.com KDE Connect notification actions mark as read full text before read receipt`、`site:github.com matrix nheko read receipt popup notification content event`、`site:github.com open source classroom app student feedback notification read acknowledgment full message dialog`。搜索成功。候选 [KDE Connect](https://github.com/KDE/kdeconnect-kde/tree/f17924772bb788042ac053058be77f481b86b08d) HEAD `f17924772bb788042ac053058be77f481b86b08d`，仓库页面标 GNU GPL v2/v3，Qt 6/KF6 桌面与设备通知同步，GitHub 镜像有近期提交；[协议说明](https://github.com/KDE/kdeconnect-meta/blob/work/protocol-schemas/protocol.md)把通知 title/text/action 分开。候选 [Nheko](https://github.com/Nheko-Reborn/nheko/tree/b15dcd137e5384e0aabfd35583b5a6eba5f71ed9) HEAD `b15dcd137e5384e0aabfd35583b5a6eba5f71ed9`，GPL-3.0、Qt/C++20，公开仓库标支持 Matrix 已读回执且 2026 年有活动。两者都是完整通信栈，不能无迁移成本接入 Mochi 的 Electron/DSH 和签名 LAN，也不能把其已读能力直接当作本项目签收已实现；不复制源码或运行时。

本地确认 `newAttentionPayloads` 对任何单条教室行都写“老师叫你”，只展示 note 或 meta，却给真实消息 ID 直接签收。于是“听写不过关”可能被错称为叫人；普通通知原正文先截到 240 字，同样可能在未看全时签收。拟只在弹窗载明姓名、动作、名目、交代及教师正文且原始字段未被截断、实际排版能完整容纳时提供直接签收；其余只可关闭或打开原消息。复用现有 rail 模型、主进程归一化和几何 fit 校验，维护成本限窄字段与回归夹具；多条名册仍只在完整原消息确认。真实教室屏尺寸需 Electron 渲染复核，不能以数据单测替代。

## 2026-09-24 · 对话即入口：学生请求、教师回复与配对（实施前）

先搜完整应用/生态：`site:github.com open source AI assistant classroom teacher student chat appointment messages natural language actions desktop`、`site:github.com open source school teacher student communication app chat appointment task scheduling`、`site:github.com open source desktop AI chat agent tools natural language automation electron app`；再搜现成组件：`site:github.com/deepseek-ai/deepseek-harness agent tool plugin register tool chat natural language actions`、`site:github.com/learnweb/moodle-mod_scheduler student appointment notes teacher response booking`、`site:github.com open source chatbot intent extraction tool call structured actions confirmation offline school app`。GitHub 搜索成功；GitHub API 直连返回 403，两个候选仓库的 `git ls-remote HEAD` 成功，不能把 API 权限不足写成没有候选。

| 候选 | 核对到的版本、许可、功能与维护 | 取舍 |
| --- | --- | --- |
| [OpenBuddy](https://github.com/louloulin/OpenBuddy/tree/2dd37e9eaa8c35496846883c0c47b60153f9ddfb) | 本轮 HEAD `2dd37e9eaa8c35496846883c0c47b60153f9ddfb`；公开仓库页注明 MIT、Electron + Pi、对话工具与多 Agent，搜索于 2026-09-24 抓到前一日页面。具体发送/配对能力与依赖闭包未逐项验证。 | 完整 AI 桌面应用，但其 Pi/账号/会话状态会与 Mochi 已装 DSH 和签名 LAN 并存两套，不迁入；只参考“对话为主要入口”。 |
| [Chatty-EDU](https://github.com/instance001/chatty-edu/tree/152524c1fbc4bdd2cc807ae7e4800e8020fd4b63) | HEAD `152524c1fbc4bdd2cc807ae7e4800e8020fd4b63`，仓库页面给出 v0.6 下载，AGPLv3、Rust/egui、本地模型、教师/学生边界及可选 LAN；本轮未核当前提交日或协议互通。 | 与学校本地部署最相关，但其自身协议明确仅连 Chatty-EDU，不可直接替换 Mochi 身份/回执。许可与运行时也不适合挪用代码。 |
| [DSH 工具注册表](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md) 和 [人工确认](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/user-approval/README.md) | 本机已锁 `@deepseek-ai/dsh-tools@0.1.3-alpha.1` 与既有审批插件，MIT；文档说明工具 schema 进入模型上下文、调用经 guard/approval，既有 `mochi-dispatch` 已用同一 API 让老师从聊天下发通知/名册。 | 采用当前已安装的工具与确认机制，给既有 LAN 服务增加窄的对话适配；不复制别家应用。维护面是工具定义、角色预设、几条用户路径测试。 |

本地事实：教师端已能从聊天调用 `mochi_call_student`、`mochi_register_verdicts`，学生请求/教师回复则由 `mochi-lan-client` 的输入表单直接调用本机受控路由；教室预设目前禁止发送。用户现要求“给 Mochi 发消息即可完成”。拟让模型从自然语言整理请求或配对码，缺字段时继续对话，实际外发在**同一对话审批卡**展示教师/教室身份、指纹、请求全文后才执行；服务层仍重新检查角色、配对和消息方向，审批期间身份改变则拒绝。读状态/自动发现只读，不自动信任附近设备。学生姓名仍为自述，不冒充认证学籍。UI 将动作表单退为只读状态与历史呈现，主对话承担输入；角色预设同步更新。这里的“同一对话审批卡”与输入窗口不同，但仍需用户点击同意以避免模型误发送。API Key 属长期秘密，不进入可回放聊天记录，继续走系统安全凭据入口；配对码是短时口令，聊天记录会保留，需限定有效期、避免回复复述。未验证：模型在真实学校设备上的意图提取准确率、两台有线设备互通、真实服务 Key。

## 2026-09-24 · 教师 403 额度误报为 API Key 错误（实施前）

先查完整多服务商桌面应用与实际案例，搜索 `site:github.com open source desktop AI chat app 403 insufficient balance API key error provider error classification Cherry Studio CodePilot`；[Cherry Studio 的服务商鉴权问题](https://github.com/CherryHQ/cherry-studio/issues/14344)只证明别的应用也会有 403/Key 混淆，其版本、实现和 Mochi 凭据链不兼容，不接入。再查现用组件，搜索 `site:github.com/deepseek-ai/deepseek-harness "classifyPiAiError" "AUTH" 403`、`site:github.com/badlogic/pi-mono "insufficient_balance" "403" model`。上游 [deepseek-harness 讨论 #5715](https://github.com/deepseek-ai/deepseek-harness/discussions/5715)与 [#1127](https://github.com/deepseek-ai/deepseek-harness/discussions/1127)给出已知的 403 额度误报及“额度语义先于状态码”修法；讨论是问题/补丁说明，不能当成当前发行版本已修复的证明。

本机锁 `@deepseek-ai/dsh-llm-pi-ai@0.1.3-alpha.1`，随仓存档的 tarball 标 MIT；实际安装版 `classifyPiAiError` 先把任意 401/403 归成 `AUTH`，之后才调用现有的 `isQuotaExceededError`。教师默认 `mochi-aiaaa` 曾有 403 `INSUFFICIENT_BALANCE` 的本项目实测记录；官方 Models 卡的 Key 引用与适配器读取引用一致，所以“Key 无法注入”不是这条教师默认链的已证根因。可确认的 bug 是余额不足时可能错误显示“API Key 无效”；用户那次实际错误仍无日志，不能等同。拟部分采用上游已说明的判别顺序，在本地固定依赖包中保留 401/普通 403 的既有行为，只让明确额度不足的消息先归 `QUOTA`。保留原始固定包作可重现基线，以单一窄补丁产出 Mochi 内部 tarball，并以合成 403/401 验证；维护成本是一份受控依赖差异和锁文件更新，待上游正式版本包含修复后移除。不得通过修改运行中的 `node_modules` 假装交付修复。

接入后验证：`scripts/quality/build-pi-ai-quota-fix.mjs` 从原始固定 tarball 复现单处分类补丁，生成 `vendor/local-plugins/deepseek-ai-dsh-llm-pi-ai-0.1.3-alpha.1-mochi-quota-fix.tgz`（SHA-512 `PNLz/bAmA/D7Y7z2Gi8pR4lyl82aIXtWzkB2EldwCkIXBkLmrP28Eju3osvQVwZCEOR2ECnybmacjRUj5AX9nA==`），桌面包和锁文件指向该产物；未改原始档案。已装 `@earendil-works/pi-ai@0.84.4` 的真实 `PiAiAdapter` 流向本机假网关发三次独立请求，`403 Insufficient Balance` 得 `QUOTA`、相同文案的 401 和普通 403 保持 `AUTH`，请求数、路径、测试假 Key 授权头均核对。另在隔离、无预置 Key 的教师实际 Models 页，通过原生 `mochi-aiaaa` 卡保存测试 Key，首轮 `deepseek-v4.1-flash` 请求到本机假网关，授权正确且页面/日志不回显 Key。为避免独立 Doctor 把状态码误导成“更换密钥”，其 401、402、403 现各自给出有限的状态码诊断，403 明示尚不能判定 Key 根因；`test-doctor.mjs` 覆盖三种状态与报告脱敏。真实服务商余额、用户当时的错误日志未取得，不能把模拟成功写成真实账户已恢复。

补充组件检索：`site:github.com/geekjapan/pi custom-provider stream error event`、`site:github.com/earendil-works/pi provider registry stream signature`、`site:github.com/vercel/ai stream error callbacks`，核对 [pi 自定义服务商文档](https://github.com/geekjapan/pi/blob/main/packages/coding-agent/docs/custom-provider.md)、[pi provider registry](https://github.com/earendil-works/pi/blob/main/packages/ai/src/compat.ts)、[Vercel AI SDK 聊天流文档](https://github.com/vercel/ai/blob/main/content/docs/04-ai-sdk-ui/02-chatbot.mdx)。它们提供通用流错误契约，但版本、许可、依赖闭包和 Mochi 当前 Harness 适配器的 403 判别未做接入审查，因此不新增框架；直接验证本机固定适配器的真实流事件。新增测试维护面为一个回环假网关夹具。

## 2026-09-24 · 既有会话模型与有线双向诊断（实施前）

先搜完整模型桌面应用：`site:github.com open source desktop AI app provider key settings current conversation model mismatch guide Cherry Studio CodePilot`、`site:github.com open source chat app show current chat model provider credentials missing change model existing conversation`；再查宿主组件：`site:github.com/deepseek-ai/deepseek-harness model selector session model provider settings current chat UI`、`site:github.com/op7418/CodePilot provider key missing selected model chat error route UI`。候选 [CodePilot](https://github.com/op7418/CodePilot) 是完整多供应商桌面应用，既有审查锁过 `1ae6d76`，许可 API 为 `NOASSERTION`，本轮未重新锁 HEAD 或做依赖适配；[Cherry Studio](https://github.com/CherryHQ/cherry-studio) 是完整应用，本轮仅查公开源码，未锁提交、许可和依赖闭包，均不接入。当前已安装的 DSH 模型选择器与设置插件由本项目固定版本提供；[官方模型选择说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-model-selection/README.md)明确 `session.selectModel` 改当前会话、`agent-default-model` 面向新会话，仓库中实际运行行为需另做本机验证。现有 MiMo 卡保存 Key 与测试、设新对话默认均成功后，旧教室会话仍可沿用其他 provider；这可能解释“API key 错误”，但用户那次错误没有对应日志证据，不能认定已找到原始根因。拟复用原生会话选择器，补当前会话模型/凭据提示与旧会话真实 UI 回归，不静默切换既有会话。维护成本限 MiMo 卡与验收脚本，不引入模型路由框架。

有线配对先搜完整应用/生态：`site:github.com open source LAN pairing desktop app wired ethernet discovery diagnostics LocalSend KDE Connect PairDrop`、`site:github.com open source LAN file sharing app connection troubleshooting local IP firewall port test desktop`；再查组件：`site:github.com/nodejs/node fetch Undici cause ECONNREFUSED ETIMEDOUT AbortSignal timeout documentation`、`site:github.com/localsend/localsend discovery manual ip network diagnostic issue`。此前已锁 [LocalSend v1.18.0](https://github.com/localsend/localsend/releases/tag/v1.18.0)（Apache-2.0，2026-09-24 [仓库快照](https://github.com/localsend/localsend/tree/e768240d1ad95f0f162b852b5ff37bec71cde1ef) 未归档）及 [PairDrop](https://github.com/PairDrop-nearby/PairDrop/tree/eb88698f801f7da3632a81b309f23393106284ed)（GPL-3.0、未归档），没有接入其 Flutter/WebRTC 运行时。LocalSend 的[跨子网讨论](https://github.com/localsend/localsend/discussions/1254)验证手动 IP 与自动发现可能分离；本项目既有签名短码和身份探测，不借用外部协议。Node/Undici 的[fetch 文档](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md)只保证网络失败拒绝，不能把超时武断写成防火墙。当前 `discovery.status=ACTIVE` 仅说明本机 UDP 发送成功，教室端可对教师 IP 做只读探测，却把配对资格错误当作连通错误；教师端未展示自身网卡地址/监听端口。拟复用现有 `/state`、`/discovery`、`/pair/probe` 和对端身份路由，在两端提供本机地址与独立的双向只读连通诊断，区分可证的端口拒绝、超时和身份/协议错误。维护面限当前 LAN 服务、UI 和针对性测试，不增加端口扫描或远端接口；仍需学校两台设备与 VLAN/ACL/防火墙现场证据。

Windows 交付先搜完整应用/框架：`site:github.com open source Electron AI desktop app Windows installer CI release artifact packaging CodePilot Cherry Studio`、`site:github.com open source Electron desktop app GitHub Actions Windows release EXE upload quota release assets`，再查 `site:github.com/electron-userland/electron-builder Windows NSIS publish GitHub Releases documentation`、`site:github.com/actions/upload-artifact storage quota exceeded GitHub Actions artifact alternative release upload`。候选 [Cherry Studio Windows 发布工作流](https://github.com/CherryHQ/cherry-studio/blob/main/.github/workflows/release.yml)使用 Windows runner 构建并上传草稿 Release，当前提交/许可及 Mochi 私仓权限未核，不复制；[electron-builder Windows 目标文档](https://github.com/electron-userland/electron-builder/blob/master/website/docs/targets.md)确认 NSIS 产 EXE，本机继续锁已装 25.1.8，不升级。已用的 [upload-artifact](https://github.com/actions/upload-artifact) 文档明确共享存储超额会拒上传；Mochi 私仓上次原生构建成功但上传失败，当前 `gh` 未登录且远端配额/权限不可查。保持 528 项精确快照与原生 Windows runner 路径；不把 Mac 交叉包或历史 EXE 冒充当前安装器。草稿 Release 可避开 artifact 配额但需要额外写权限和用户明确发布边界，现阶段只是备选。

接入后本机验证：教师和教室端均显示本机非回环 IPv4 及监听端口；教室可对教师地址做只读身份探测，成功只证明对端返回可识别的 Mochi 身份，不自动配对。连接拒绝、5 秒超时、主动取消与无效身份分开提示；原有 `FINGERPRINT_MISMATCH` 和未配置身份 `IDENTITY_REQUIRED` 语义保留。`plugins/mochi-lan` 全套测试通过，包含新增拒绝/超时夹具；测试并未覆盖学校有线两台机器或跨 VLAN。MiMo 设置卡复用 DSH 已安装的 `sessions.list` 与 `modelDirectories`，显示当前会话路由，明确 Key 与新会话默认不会迁移旧会话；当前路由的测试只在明确点击时发起。第一次真实 Electron 回归发现一个新增的重复订阅循环，20 秒内发出七万余次 `/api/settings/describe` 并使凭据请求失败；改为同状态不更新、稳定订阅生命周期后，隔离教室真实页面通过保存 fixture Key、Doctor 假网关探测、当前会话 `mimo-v2.5` 请求及设置页当前会话模型显示。模型卡 15 项单元测试、根 `npm run check`、桌面资源检查均通过；真实供应商 Key 及用户原始错误根因仍未验证。Windows 输入快照已重新核对为 528 项、92,539,747 B，零缺失和哈希差异；`gh` 当前未登录，尚无与本次源码匹配的原生 EXE。

## 2026-09-24 · 联动计划桌宠资源与小螃蟹来源核对

按完整项目/生态优先，实际查 `GitHub Codex desktop pet website Claude crab at computer open source desktop pet`、`GitHub Codex desktop pet ecosystem website Claude crab laptop Clawd`、`Petdex Codex Pets Claude crab laptop sprites github`；再查素材 `claude-crab spritesheet.webp github license`。本机联动计划 `/Users/a1379/Documents/联动计划` HEAD `cd17ff8337e20ed02f632fbf97625e0b668cc3cf`，可定位的视觉实现是 `src/components/OrbCompanion.tsx/.css` 与 `ExpressiveOrb.tsx/.css` 的焦糖表情球和内联小电脑；Mochi 当前品牌组件、桌面副本与常驻条已复用其几何和配色。全树检查 737 张 PNG/WebP/GIF，未找到独立 Claude/Clawd 螃蟹素材或标准 8×9 像素图集；这一结论只覆盖当前本机目录，不能推断用户另存的素材不存在。

候选完整项目 [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk/tree/90293fc00c591c1a5e976695154646041068f8a3) HEAD `90293fc`，v1.1.0（2026-09-19），公开 API 记 2026-09-23 推送、未归档，支持 Codex CLI 等；代码 AGPL-3.0，但其[美术许可](https://github.com/rullerzhou-afk/clawd-on-desk/blob/90293fc00c591c1a5e976695154646041068f8a3/assets/LICENSE)另保留给 Anthropic，禁止超出项目个人使用的复制、修改和分发，不能直接装入 Mochi。它锁 `electron: ^41.10.4`，本机 Mochi 锁 39.8.10，整应用接入还需解决宿主生命周期与状态迁移。候选生态 [Petdex](https://github.com/crafter-station/petdex/tree/a1b229116968cbe9f3a9b2141634a9baa0819864) HEAD `a1b2291`、desktop-v0.9.1，公开 API 记 2026-09-21 推送、未归档；平台 MIT 不覆盖用户投稿的宠物图。[Codex Pet 的 Claude Crab 页面](https://www.codex-pet.com/pets/claude-crab) 确有 WEBP 图集，但其[公开 manifest](https://codex-pet.com/api/manifest)对该图仅列路径/名称/描述，不列作者、授权或版本；页面与用户口述“计算器”是否同一素材也未确认。其 CLI 的 MIT 不能外推到图像，CLI 元数据所指 GitHub 源仓本次返回 404。复用决定：继续使用当前联动计划的本地球形象和小电脑，等待用户指明另一份文件后再审图及权利链；不复制外部小蟹美术，也不新造第二套桌宠实现。这样避免对已有三份 UI 适配副本再加像素图资源、许可和打包维护负担。

## 2026-09-24 · 预约决定、缓存验收与桌宠同步状态（实施前）

按“完整应用/框架先于组件”检索 GitHub。预约实际搜索 `GitHub open source school appointment scheduling app teacher student approve reschedule slots Moodle scheduler`、`GitHub Cal.com open source booking app reschedule confirmation time change workflow`，随后查 `site:github.com/learnweb/moodle-mod_scheduler reschedule appointment confirm student requested time`、`site:github.com/calcom/cal.com reschedule booking confirmation different start time source`。候选 [Moodle Scheduler](https://github.com/learnweb/moodle-mod_scheduler) 是完整教师时段和学生预约 Moodle 模块；本文件前项已锁到提交 `8a05f853df2eeedd38fcf49479d9c13324ec59ad`，网页注明 GPL-3.0-or-later，依赖 Moodle/PHP。候选 [Cal.com](https://github.com/calcom/cal.com) 有确认和改期工作流，但本轮未锁版本、许可或依赖闭包，不接入。Mochi 已有学生期望时间、教师签名回复和重试协议；替换整套账号/日历的维护与数据迁移成本明显高于修正现有 `confirmed`/`rescheduled` 语义。只采用“原时间确认”与“改变时间建议改期”的产品区分，不复制外部代码；校历和空闲档期仍未建模。

缓存实际先搜 `site:github.com open source zstd jsonl log verifier multi frame compressed validation app tool`、`site:github.com open source zstd jsonl log viewer app`，命中完整日志工具 [hl](https://github.com/pamburus/hl)；再搜 `site:github.com/nodejs/node zstdDecompressSync multiple frames zstd CLI decompress concatenated frames`，查到 [Node zlib 文档](https://github.com/nodejs/node/blob/main/doc/api/zlib.md)及[多帧解压问题](https://github.com/nodejs/node/issues/64741)。本机 Node 是 `v24.19.0`，`/opt/homebrew/bin/zstd` 可用；hl 的许可证、版本和本机兼容性本轮未核，故不替换本项目的专用 usage 验收器。GitHub API 查询上述仓库均返回 HTTP 403，`git ls-remote HEAD` 超时后停止；这属于版本核查失败，不是“没有开源方案”。本机合成两帧日志已复现：第一帧以换行结尾时，当前 Node 回退只读第一帧可误报 99% 达标，实际完整稳态 49.5%。拟保留已经使用的 `zstd -dc` 全帧路径；缺命令时明确退出不可判定，不用无法证明完整性的换行启发式。维护成本是验收环境需有 zstd CLI，换来不把假高命中写成产品收益。

桌宠实际先搜 `site:github.com open source desktop messaging app offline inbox stale data indicator Electron teacher notification`、`site:github.com open source desktop notification center offline last updated state app`，命中完整离线收件应用 [ElectronMail](https://github.com/vladimiry/ElectronMail) 与 [OpenMessage](https://github.com/MaxGhenis/openmessage)；再查 `site:github.com/TanStack/query isFetching isError data staleTime previous data UI docs`、`site:github.com/electron/electron ipcMain handle ipcRenderer send security contextIsolation preload`。外部应用的当前提交、许可证及 Electron/本项目 LAN 协议兼容性本轮未锁，不迁移代码。已装 Electron `39.8.10` 和本项目隔离 preload 足以承载窄的同步健康信号；[Electron contextIsolation 文档](https://github.com/electron/electron/blob/main/docs/tutorial/context-isolation.md)明确应暴露特定 IPC 包装而非整个 `ipcRenderer`。现有客户端实跑成功轮询后再失败：主面板报错，而桌宠仍展示旧待办，没有断联或上次成功提示。拟保留可追溯历史行，另传成功心跳/失败及上次成功时间，恢复时撤销旧状态；页面挂起还需主进程超时兜底。不得用空快照冒充断联以清零待办。维护面限现有 LAN 插件、主进程/rail 协议和显示层，不加轮询框架或运行依赖。

接入后验证：预约发送与收件两侧现强制 `confirmed` 使用原请求时间、`rescheduled` 使用不同时间，教师表单将确认时间固定为原值；同一签名消息 ID 的精确重试仍可进行。对旧版本已经签名、但“确认”时间与申请不一致的记录，界面标注历史异常并同时展示两个原值，不篡改签名记录。LAN 插件全套测试通过，客户端 35/35 项通过。缓存验收器移除 Node 首帧回退，缺 `zstd` 时退出 2；两帧且首帧以换行结尾的回归证明不会再把第一帧的 99% 误当完整日志结果，`test:cache-probe` 10/10 项通过。桌宠在真实 Electron 页面上经成功轮询→失败→恢复夹具验证：旧待办保留并出现静态中断提示、上次成功时间及折叠态状态点，恢复后提示撤销；preload 仅接收布尔健康信号，主进程另有 20 秒心跳超时。根 `npm run check` 在历史异常提示增补前退出 0，此后客户端目标回归再次通过。上述验证不包含学校有线双机的长时断线、睡眠唤醒或真实供应商缓存账单。

## 2026-09-24 · 本轮交付复核

复用本文件已审计的 Electron 39.8.10 原生构建流程、PptxGenJS 4.0.1 和现有 LAN 签名服务；本轮未新增运行依赖或第三方美术。首次 Mac 打包因浏览器资源根位于输出目录内被隔离守卫拒绝，随后按既有流程复制到独立临时资源根后重试成功；这属于输入位置修正，不绕过资源校验。`npm run check` 先因课件样例改名后旧 `ppt_inspect` 断言仍匹配原标题而失败；同步断言后根检查重跑退出 0，LAN 完整测试、低容量回归、桌面资源/安装器配置/模型首启检查也通过。

当前 macOS arm64 无密钥 DMG：733,383,147 B，SHA-256 `a1a977f04fcd66b7bcdb5c2c8c6668a9c9fe985a3540dee3ddeefaaac074d293`。边车 `shasum -c`、`hdiutil verify`、挂载检查通过；包内 25 插件、五项浏览器资源及仅含 `settings-defaults.json` 的种子目录符合预期，LAN 客户端/服务及课件插件与源码逐字节一致，六个关键编译 JS 与打包前输出字节一致。从 DMG 复制到可写目录的 `.app` 冒烟 11.5 秒输出 `MOCHI_DESKTOP_SMOKE_OK`、`settings: written`、`refs: 无`。当前 Windows 本地白名单快照 525 项、92,448,183 B、零差异；没有当前源码的可下载原生 Windows 安装器。学校真机、供应商 Key 和 PowerPoint/WPS 仍待现场验证；这些本机结果不等于现场验收。

## 2026-09-24 · 密钥交付决策与当前安装包对齐（文档实施前）

先搜完整桌面应用：`site:github.com open source Electron AI desktop app API key onboarding provider settings Cherry Studio CodePilot`、`site:github.com open source desktop AI app packaging API key seed build secrets credentials user input`；再搜组件：`site:github.com/electron/electron safeStorage credential management packaged app secrets docs`。检索成功。公开 API 核到 [CodePilot](https://github.com/op7418/CodePilot/tree/1ae6d76de6993377dab961eacf04927babd99eb1) `1ae6d76`，2026-09-22 推送、未归档，license `NOASSERTION`，完整多供应商设置应用；[Electron safeStorage 文档](https://github.com/electron/electron/blob/d84782479699094842d6a5f359438d480818539e/docs/api/safe-storage.md) 查到 `d847824` 的主线快照。两者均不接入：前者许可/状态迁移没有适配审查，后者主线 API 随版本变化，不能直接套到本机 Electron 39.8.10；本轮只是修订 Mochi 自己的决策记录。

已确认的本机事实：2026-09-24 macOS arm64 包经挂载检查，`profile/seeds` 只有无密钥的 `settings-defaults.json`，没有 `credentials-seed.json`；打包命令显式带 `--without-key-seeds`，真实教师 Key 需自行配置并测试。`docs/DECISIONS.md` 的 D-001 仍把 2026-09-12“随包放 Key”标为当前不得修改的决定，D-008 又把“种子生成”和“默认模型”写成同一事实，容易让下一位维护者重新把凭据装进包。拟保留原历史决定和已知代价，但明确其只属于当时的交付，不指导当前无密钥包；另记当前发布边界及未来如要改回密钥分发须单独作新决定。D-008 的默认模型保持教师 aiaaa、教室 MiMo，来源是权威提供方表生成的**非密钥设置种子**；不把本机安装成功推断成真实供应商 Key 已通过。无需代码或新依赖，维护成本仅为文档后续与每版实际包同步。

实施后：`docs/DECISIONS.md` 保留 D-001 的作者当时表态并明确其历史适用范围；D-009 只记录当前无密钥包的实测分发边界与后续变更门槛，没有宣称用户对永久政策已重新拍板。D-008 分开描述默认模型和凭据种子。该项是文档一致性修复，未改密钥运行代码；真实 Key 与 Windows 当前包仍待独立核实。

## 2026-09-24 · 教师已看未回复请求的容量保护（实施前）

先查完整应用/框架：`site:github.com open source teacher student messaging appointment app inbox pending request retention archive`、`site:github.com open source offline messaging app message inbox retention pending reply durable state`；再查组件和规则：`site:github.com open source messaging protocol inbox eviction only completed requests pending response sqlite`。GitHub 网页检索成功；对两个候选另查公开仓库 API 快照。没有发现可以无迁移直接替换 Mochi 已签名 LAN 收发与回复绑定的现成库，但不把这表述为“没有开源方案”。

| 候选 | 快照、许可证及适配 |
| --- | --- |
| [Lan-Messenger](https://github.com/Felzy613/Lan-Messenger/tree/fc3fc1ad1644d0a83a5697ac6f90d5be38d64a0b) | `fc3fc1a`，2026-09-24 推送、未归档；本机公开 API 的 license 为 `null`，Swift/Windows 原生双端实现含本地历史、归档和离线队列。许可证与本项目 Electron/Node 依赖不满足接入审查，仅读其产品路径，不复制代码。 |
| [Moodle Scheduler](https://github.com/learnweb/moodle-mod_scheduler/tree/8a05f853df2eeedd38fcf49479d9c13324ec59ad) | `8a05f85`，2026-09-23 推送、未归档；本轮公开 API 的 license 为 `null`，此前审查其仓库网页注明 GPL-3.0-or-later，教师时段和学生预约依赖 Moodle/PHP。Mochi 尚未采用中心时段库，不迁入账号/数据库或源码。 |
| Mochi 现有 `mochi-lan` | 复用当前状态仓、验签、消息 ID 幂等和容量拒绝；无新依赖。已有发件箱只回收已送达且已看见的普通通知，本轮让收件箱遵守同样的**语义安全**边界。 |

本地双实例已复现：教师 `testMaxMessages=1`，`request-1` 被教师人工标已看后，`request-2` 送达会删除原请求，教师对 `request-1` 回复报 `RESPONSE_REQUEST_MISMATCH`。已看只是阅读状态，不是请求终态。还发现 `seenAt` 会先于网络签名回执落盘；若 `seenReceipt` 是 `UNKNOWN`，回收普通通知也会使人工重试失去原消息。拟仅回收已看、`seenReceipt === 'ACKNOWLEDGED'`，且不含 request、response、directive、attachment 的普通通知；无可安全回收行就以明确 `MESSAGE_LIMIT` 拒收新消息并保持旧行，避免无声丢失可回复请求、未送达回执或重复回复约束。代价是长时间积累请求/回复时容量仍会达到上限；完整持久归档需要先决定学校保留期限并设计可验证的墓碑索引，不能把本轮修复宣传成无限容量。回归应复现已看请求受保护、回执失败后受保护、明确拒收和普通通知可回收。

接入后验证：真实 `MochiLanService` 双实例的低容量回归证实已看请求不会再被第二条请求挤掉，容量拒绝后仍能按原 ID 回复；教室端已看的教师回复也受保护，另一条不同 ID 回复仍因历史关联拒绝。普通通知在 `seenReceipt: UNKNOWN` 时保留供重试，在 `ACKNOWLEDGED` 后可回收；历史超限而安全行不足时先拒绝、不删部分历史。`node plugins/mochi-lan/test-limits.mjs`、LAN 插件完整 `npm test` 均退出 0。本机测试不等于长期归档完成或校园设备容量实测。

## 2026-09-24 · 课堂任务卡课件版式（实施前）

先检索完整应用和框架：`site:github.com open source AI presentation generator editable PPTX application 2026 Presenton pptagent AIPPT`、`site:github.com open source slide deck editor generator visual layout classroom tasks PPTX templates`；再检索单独组件：`site:github.com pptxgenjs editable task slide cards diagram components PowerPoint native shapes`。GitHub 网页检索成功；以下仓库提交、许可与维护状态另用公开 GitHub API 查询（`gh api` 因本机未登录失败，改用无需登录的公开 API），没有把 README 声称当作本机适配结果。

| 候选 | 核查快照与复用结论 |
| --- | --- |
| [Presenton](https://github.com/presenton/presenton/tree/768894c4655c6c6fd6ed4cf69501cc502a2c0b41)、[AIPPT](https://github.com/LRriver/AIPPT/tree/e70fbfcde611cc619939d83a19c3226a8a674171) | 沿用本文件上节的完整工作台审查：Apache-2.0、模板/逐页编辑/可编辑导出。它们带自己的服务、状态和模型配置；替换 Mochi 的来源、定页修订和检查链维护成本高。本轮不接入代码。 |
| [PPTAgent](https://github.com/icip-cas/PPTAgent/tree/833cda553b343be0e486a93b0b57cac962cdd566) | 公开 API：`833cda5`，MIT，未归档，2026-09-21 推送。其逐页生成与视觉复核可作为流程参考；Python/模型/视觉服务依赖没有与本机 Electron 资源闭包做兼容测试，不接入。 |
| [CasualOffice Slides](https://github.com/CasualOffice/slides/tree/2762698ebbc2e2986ef2103798bdd21187182de2) | 公开 API：`2762698`，未归档，2026-08-02 推送，许可证返回 `NOASSERTION`；完整浏览器 PPTX 编辑器，原生布局和往返导入链。许可证及依赖兼容未核到接入级别，不复制代码。 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS/tree/3c9ec1b687c174952166f6a34b5e87ebf69fa469) | MIT，上游 `3c9ec1b`；本机锁定并已集成 `4.0.1`，已有原生文本/形状/图表的 OOXML 和预览回归。继续复用，不引入新运行依赖。 |

本地已确认：`title-body` 的三条课堂指令只挤在页面上部，教师样例第 2 页还指向本页没有的图。起初考虑新建 `title-task`，随后复核已有 `title-compare`：其两栏 2–4 对短句、原生可编辑卡片、讲义同源渲染和定页修订均已实现，恰好承载“观察线索／记录方式”“行动设计／完成标准”这种**真实逐行对应**的课堂任务。决定采用已有布局，不另造卡片引擎；将样例第 2 页的下一页图示指向写清，第 6 页引导形成可交付行动句，并更新模型版式提示及针对性回归。只有内容真的两列对应时才建议该布局，不为填满画面强配对。维护范围是样例、提示、文档和测试，无新运行依赖；最终七页重新逐页渲染检查。学校 PowerPoint/WPS 和教材事实仍待现场核对。

接入后验证：最终 7 页教师样例 PPTX SHA-256 `3fde0c6c8ca2fc1d69c5d4de5431852d984219afe77bf10098b05faee986f4d3`，LibreOffice 原样预览 PDF SHA-256 `9197dd90cd8fe72e015ab911a29c369623ad5e71e6a505544886f400e49dda5b`。新增样例回归证明第 2、6 页是原生可编辑文本/形状、没有整页图片，讲义可检索；`node --test plugins/mochi-presentations/test/teacher-lesson.test.mjs` 通过。最终 PDF 全 7 页均已渲染，第 2、4、6 页逐张查看，第 1、3、5、7 页与上一份已看过的渲染 PNG 哈希逐页相同；未见裁切、遮挡或明显对比度不足。第 4 页仍较疏朗，未伪造数据来填空；教材事实、学校 WPS/PowerPoint 与实际投影距离未验证，详见 `docs/evidence/ppt-quality-2026-09-24/visual-review.md`。

## 2026-09-24 · 课件质量回看与版式节奏（实施前）

先搜完整应用/生态：`site:github.com open source AI presentation generator PPTX template slide editing self hosted AIPPT Presenton`、`site:github.com open source PPTX presentation editor generator visual quality review screenshot slide deck`；再搜组件与产物检查：`site:github.com gitbrent PptxGenJS render slides validate output visual`、`site:github.com LibreOffice pptx convert pdf slide rendering quality check`。GitHub 网页搜索与仓库 API 查询成功；版本、许可和维护时间以下列 2026-09-24 快照为准，不把 README 功能当成本项目已适配。

| 候选 | 快照、现成功能与取舍 |
| --- | --- |
| [Presenton](https://github.com/presenton/presenton/tree/768894c4655c6c6fd6ed4cf69501cc502a2c0b41) | `768894c`，Apache-2.0，未归档，2026-09-22 推送；完整自托管/桌面课件应用，支持模板选择、单页预览和可编辑 PPTX。其服务端、编辑器与模型配置会替换 Mochi 现有可追溯定页修订链；此次不安装，依赖闭包及本机兼容性未验证。参考“先选版式、逐页回看”。 |
| [LRriver/AIPPT](https://github.com/LRriver/AIPPT/tree/e70fbfcde611cc619939d83a19c3226a8a674171) | `e70fbfc`，Apache-2.0，未归档，2026-07-08 推送；完整工作台将大纲、单页版本、预览与可编辑导出分开；其 Python/Node 服务和多视觉模型不是本次小范围质量检查所需，不接入代码。其 README 自述可编辑重建有质量门槛；未经本机运行，不宣称适配。 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS/tree/3c9ec1b687c174952166f6a34b5e87ebf69fa469) | `3c9ec1b`，MIT，未归档，最近推送 2025-11-28；本机锁定且已集成 4.0.1，原生可编辑文字、表格、图表和形状经当前测试验证。继续复用，不升级或替换引擎。 |
| [pptx-gen](https://github.com/alfonsograziano/pptx-gen/tree/f403e12fc2467535a15f1b610d4f7b70bba31e75) | `f403e12`，未归档，2026-09-22 推送；说明支持导入既有模板和渲染截图。GitHub API 对许可证返回 `NOASSERTION`，本轮未完成许可证/依赖审计；不接入或复制代码。学校模板也尚未提供，不能宣称已经支持校本版式。 |

本地实证：当前生成器已支持 10 类版式与最终 PPTX→LibreOffice 预览，`previewOfPptxSha256` 对应本版 PPTX；但 2026-09-24 重新生成并查看 6 页教师样例的第 1、3、4 页，第 1 页与表格页上半部文字密集而下半部明显空，样例也没有流程图。既有 `ppt_inspect` 能从真实 OOXML 读文字字号、页数与结构；下一步复用它对**本次最终 PPTX**做客观结构检查，并把未完成的视觉/学科复核明确留在产物报告。改进样例与技能的版式选择，不把空白率当通用硬失败，因为封面和节奏页有意留白。维护范围限现有生成入口、样例、工具提示和针对性测试，不引入新框架或生产依赖。

接入后验证：最终 PPTX 字节经已有 OOXML 检查器读取，`manifest.quality` 与该文件 SHA256、版次、真实页数绑定；定页修订重算，源页数不符和已能证明低于底线的形状字号阻止发布。连续 3 页 `title-body` 仅提醒；预览可用仍保持 `needs-visual-review`，学科事实未自动验真。检查器的形状字号是**最大 run**，当前门槛只可判定“全形状都偏小”，不能证明每一小段都可读；已在报告中明示，不冒称完整字号覆盖。教师样例改为 7 页并复用现成的封面、原生步骤图和结束页，生成的最终 PPTX 预览第 1、3、7 页已实际看图，步骤与循环箭头可读；没有把样例质量外推到所有课题。插件 33/33 项、根 `npm run check`（核心 140 项等）通过；学校校本模板、PowerPoint/WPS 目标机和人工学科审稿仍未验证。

## 2026-09-24 · 学生请求原话与改期语义（实施前）

本轮先搜完整应用/生态：`site:github.com open source school teacher student messaging app notification preview read receipt full message`、`site:github.com open source classroom question request teacher notification read receipt app`、`site:github.com open source school teacher student appointment reschedule confirm time request Moodle Scheduler`、`site:github.com open source classroom meeting appointment teacher reschedule student request app`；再搜组件与规则：`site:github.com open source notification mark as read full message preview truncation expand component`、`site:github.com/learnweb/moodle-mod_scheduler reschedule appointment time validation same slot source`、`site:github.com open source appointment API reject reschedule same start time`。GitHub 网页检索成功；本轮没有锁定外部 HEAD 提交，也没有接入外部代码。

| 候选 | 核到的现成功能、版本/许可和适配结论 |
| --- | --- |
| [Semaphore Chat](https://github.com/semaphore-chat/semaphore-chat) | 当前网页主线展示消息和阅读回执；同日上节已核其 beta、AGPL-3.0、NestJS/PostgreSQL/Redis/LiveKit 依赖。完整通信系统不能替换 Mochi 已签名 LAN 收件与身份，不采用源码。 |
| [Moodle Scheduler](https://github.com/learnweb/moodle-mod_scheduler) | 当前网页主线展示教师时段、学生预约与教师处理；网页声明 GPL-3.0-or-later、Moodle/PHP 插件，README 涵盖 Moodle 4.x。Mochi 当前用学生自由文本期望时间与教师建议，未建日历/时段库；不迁入其账号和数据库，也不复制代码。 |
| [Electron Notification API](https://github.com/electron/electron/blob/main/docs/api/notification.md) | 本机 Electron 39.8.10、MIT，原生通知可展示标题/正文并区分动作与关闭；Mochi 已有可定位消息的独立弹窗，复用现有 BrowserWindow 与 LAN 协议，不加一套通知状态。 |

本地已确认：单条学生请求弹窗当前用类型/题目/时间摘要，却允许直接发签名“我已看到”；原话在待办行内。教师选择“建议改期”时草稿沿用学生希望时间，服务端只校验非空，因而可把原时间以“改期”发回。拟在单条可回执弹窗展示经长度约束的请求原话；原文放不下时不给弹窗快捷签收，保留打开完整请求。改期则在客户端切换时要求填写不同时间，并由 LAN 服务端对原请求时间做归一化差异校验。原时间是自由文本，本轮不假装能判定日历空闲或等价时间表述。维护面限已有投影、表单、服务端校验及针对性回归，不增加依赖。实施后核对长原文、聚合提示、未配对/错身份及相同时间的直连绕过。

接入后验证：单条请求原话完整且长度受控时才给弹窗快捷签名回执；长原话或空原话只给预览和打开完整请求，聚合通知同样不签收。真实 Electron 弹窗验证文案不遮住按钮。改期与原时刻仅有空白差异时表单禁用提交，服务发送/接收都拒绝；相同消息 ID 的既有精确重试继续可用。`test:rail-model` 251 项、真实 Electron rail、LAN 客户端 34 项与服务/持久化/桥接 37 项通过。学校双机签名回执和自由文本时间的语义等价未现场验证。

## 2026-09-24 · 临时弹窗的已看到回执（实施前）

先搜完整应用/生态：`site:github.com open source desktop classroom teacher student notification app acknowledge seen receipt Electron`、`site:github.com open source school office call student notification read receipt app`、`site:github.com open source desktop notification center acknowledge action signed receipt Electron`；再搜组件：`site:github.com/desktop/desktop-notifications click action close event read receipt source`、`site:github.com/electron/electron notification close action distinguish user acknowledgement`、`site:github.com open source Electron chat notification dismiss mark as read separate actions source`。GitHub 网页搜索成功；两个外部仓库的 `git ls-remote HEAD` 分别因 HTTP/2 错误和连接超时失败，因此本轮只有 2026-09-24 网页 `main` 快照，未锁提交。不能把无法直连解释为没有现成方案。

| 候选 | 已核能力、许可与适配 | 取舍和维护影响 |
| --- | --- | --- |
| [Semaphore Chat](https://github.com/semaphore-chat/semaphore-chat) | 完整自托管聊天应用，网页当前说明 Electron 桌面端和 read receipts；标注 beta，默认 AGPL-3.0，并依赖 NestJS、PostgreSQL、Redis、LiveKit 等服务。 | 不迁入整套通信服务或代码。其已有账号/服务端状态不能替代 Mochi 已配对身份签名 LAN 消息；仅参考阅读回执语义。 |
| [foBrain](https://github.com/igweze/fobrain) | Apache-2.0 的完整学校管理系统；网页 `main` 可见 PHP 应用、师生/职员角色和诸多校园流程。本轮未锁版本或维护节奏，也未找到适用于 Mochi 独立桌面弹窗的已确认回执组件。 | 不接入第二套学校账号与 Web 数据库，避免长期双状态。 |
| [desktop-notifications](https://github.com/desktop/desktop-notifications) | MIT，网页 `main` 的 README 标注 preview、零依赖、系统通知及 Windows 原生二进制；本轮未锁 release 与 Electron 39 的 N-API 兼容性。 | Mochi 已有 Electron 独立弹窗；增加原生二进制与另一套通知生命周期没有必要，且无法产生已认证 LAN 回执，故不采用。 |
| [Electron Notification API](https://github.com/electron/electron/blob/main/docs/api/notification.md) 与本机 Electron | 本机 `electron` 39.8.10，MIT；上游文档将 `action` 与 `close` 分开，并说明 Windows 的 `close` 还可由程序或超时触发。 | 仅采用动作语义：明确点击才可确认，关闭/Escape 只撤销显示。不迁移现有 HTML 弹窗。 |

本地已确认：弹窗的“我知道了”和 Escape 都发 `acknowledge`，常驻条随即关闭并出队；主进程未处理该动作，故办公室喊人等消息不会留下老师可见的 `RECEIPT_SEEN`。现有 `mochi-lan/message-seen` 需要受信的本地连接授权，由 LAN 插件 `markSeen` 生成签名回执。拟让弹窗明确点击走已认证主窗口的既有 `markSeen` 路由，并仅在成功时出队；Escape 只关闭当前提醒，且不能写回执。保持配对提示仅可关闭，不伪造消息回执。维护面限现有 rail IPC/页面与 LAN 客户端的窄桥接，不加依赖。实施后须用失败重试、跨角色和真实 Electron 弹窗测试验证；未现场核实教师/教室两台设备间的真实回执可达性。

接入后验证：弹窗载荷仅给单条、可追溯原始 LAN `messageId` 附回执目标；多学生聚合、名单多判定的 `messageId#index`、隐藏溢出和配对提示只显示“关闭提醒”。主进程将明确点击送进同一窗口的**隔离 Electron preload**，由 preload 携带同源浏览器 session 直接调用既有 `message-seen`；服务端复核原收件身份和配对并发送签名回执。仅在返回匹配 ID 的 `ACKNOWLEDGED` 后关闭，Escape 只关闭提醒，失败反馈恢复按钮并可重试。网页主世界不暴露“回报成功”接口，避免插件脚本伪造完成。已签名确认的收件若后来在主面板人工处理，原始 LAN 状态可撤销其旧弹窗，且此复核早于板面快照去重。

本机 `client.test.mjs` 34 项、`test:rail-model` 246 项、`test:rail-logic` 131 项、真实 Electron `test:rail-runtime` 与桌面 TypeScript 均通过；Electron 39.8.10 独立 BrowserWindow 夹具实际验证隔离 preload 的同源 Cookie、固定 POST 内容、错误 ID 拒绝与网页无法调用回报接口。根 `npm run check` 在首次桥接版及最终 preload 收口后均退出 0。该夹具验证了身份会话传输，但不是学校两台真实设备点击弹窗并交叉读取回执的现场验收。

## 2026-09-24 · 无密钥首启模型路由（实施前）

先搜完整应用/生态：`site:github.com open source desktop AI assistant first run provider API key default model onboarding Cherry Studio`、`site:github.com open source AI chat app add provider key set default model first run settings`、`site:github.com open source Electron AI client missing default model provider credential onboarding`；再搜组件：`site:github.com/deepseek-ai/deepseek-harness "agent-default-model" seed settings`、`site:github.com/deepseek-ai/deepseek-harness "agent-default-model" "settings"`、`site:github.com/CherryHQ/cherry-studio default model after provider key verification onboarding implementation`、`site:github.com/Tura-AI/tura provider auth default model config workspace model`。GitHub 网页检索成功。

| 候选 | 版本、许可证及实际能力 | 取舍与维护成本 |
| --- | --- | --- |
| [DSH agent-default-model](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-default-model/README.md) | 本机已安装 `@deepseek-ai/dsh-agent-default-model` `0.1.3-alpha.1`，MIT；核对本机 `lib/index.js`，组合配置提供 `{provider, model}`，用户设置层可覆盖，`currentSelection()` 供新会话读取。 | 采用已依赖的组合补丁覆盖基础包默认路由。保持已有用户设置与会话选择优先，不引入新依赖；维护面限一条配置和首启回归。上游网页主分支只作说明，实际接入以本机安装版为准。 |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio) 与[首次设置讨论](https://github.com/CherryHQ/cherry-studio/issues/13421) | 完整桌面 AI 客户端；本次网页检索到的是用户讨论，不能据此认定该流程已发布。上次核到 HEAD `4fd31aef1cde88a9c830f8ba4ad48ce57d4c3bab`，本次未重核许可证和依赖闭包。 | “凭据验证”和“默认模型选择”分态有参考价值；不迁入第二套桌面设置/会话状态，不复制源码。 |
| [Tura provider 配置说明](https://github.com/Tura-AI/tura/blob/main/docs/start/providers.md) | 文档将提供方认证与当前模型选择分开；本次未锁提交、许可证、依赖或 Mochi 适配。 | 仅作流程参照，不接入代码。 |

本地已确认：`--without-key-seeds` 曾将整个 `profile/seeds` 排除，教师全新 home 因而落到基础包 `deepseek-official/deepseek-v4-flash`；MiMo 卡保存和诊断 Key 不会切换默认模型。教室角色原本不读取教师种子，也继承基础默认。复核 [D-008](DECISIONS.md) 后确认用户此前明确指定**教师**默认 `mochi-aiaaa/deepseek-v4.1-flash`，**教室**仍用 MiMo；不能为了修 Key 问题把教师默认悄悄改为 MiMo。拟用共同 `core.patch.yml` 让教室新会话组合默认指向已注册的 `mochi-mimo/mimo-v2.5`；无密钥包另从本项目权威提供方表重新生成一份**仅有非密钥设置**的 `settings-defaults.json`，教师首启由现有种子代码读取并保留既定 DeepSeek 默认。原有 `credentials-seed.json` 和其他未知源种子一概不复制。MiMo 卡提供显式设为新对话默认的操作，保存 Key 本身不静默切换；已有用户的设置和会话选择不覆盖。长期成本限现有组合补丁、打包阶段安全设置种子与模型卡，不增依赖。未验证：学校真实服务和 Key，需现场验收；实施后须验证两角色 fresh home、用户覆盖优先级和本机假网关路由。

接入后验证：`test-package-resources` 证实无密钥暂存只含由权威表生成的设置种子，测试中陈旧源密钥哨兵没有进入包；隔离教师 `seedRuntimeHome` 首启仅写出 `mochi-aiaaa/deepseek-v4.1-flash` 设置，不生成凭据文件，教室角色不读取该设置。`test-runtime-profile` 的真实 DSH 配置转储显示 MiMo 组合兜底，教室实际 DSH 进程用该选择向本机假网关发出首轮 MiMo 请求并核对 fixture 凭据和模型。MiMo 卡 14 项测试覆盖显式 revision 写入、未配 Key/冲突拒绝及现有选择不被保存 Key 改写；根 `npm run check` 退出 0。既有会话专属模型仍需用户在原生选择器中主动切换；本机测试不等于真实供应商可用。

本机重出 macOS arm64 无密钥 DMG：733,427,167 B，SHA256 `59011aa5781e04c3e55e0828990162075a5ff17eb254a5d02c547fb40b5cf116`。边车校验、`hdiutil verify` 与挂载内容检查通过；包内 `profile/seeds` 只有 `settings-defaults.json`，模型卡与核心补丁 hash 均匹配源码。复制出 DMG 后应用冒烟在 15.2 秒出现 `MOCHI_DESKTOP_SMOKE_OK`，启动日志为 `settings: written`、`refs: 无`。这证实本机包可启动和配置落盘，未证明真实 Key、学校联网、全新 Mac 安装或 Windows 当前源码包。

## 2026-09-24 · 听写结果改判与教室板历史（实施前）

按完整应用/生态先搜 GitHub：`site:github.com open source classroom gradebook teacher student assessment retake latest result web app`、`site:github.com open source school assignment gradebook student resubmission latest status app`、`site:github.com open source teacher classroom behavior gradebook multiple assessments per student app`；再搜组件/事件：`site:github.com moodle gradebook regrade latest attempt grade status source`、`site:github.com open source school gradebook retake latest attempt result event history component`、`site:github.com open source student assessment correction pass fail latest attempt dashboard repository`。网页检索与三个仓库的 `git ls-remote HEAD` 均成功。

| 候选 | 实核版本/许可/维护状态 | 本次复用判断 |
| --- | --- | --- |
| [TPT School](https://github.com/tpt-solutions/tpt-school/tree/3b7abf25ff70c28b97f79701eb13da06ffecf7ee) | HEAD `3b7abf25ff70c28b97f79701eb13da06ffecf7ee`，`package.json` 0.1.0，MIT；2026 年仍有 Electron 客户端提交，依赖 Next 16、Prisma 7、SQLite、账户体系。 | 完整学校成绩/通知应用，但迁入会替换 Mochi 的签名 LAN 消息和身份边界；不接入源码或依赖。参考“当前结果与历史记录分层”。 |
| [CheckMe](https://github.com/law4percent/CheckMe/tree/07fd06f37f8ad4c953b6c40f3bd9f9a9217f7600) | HEAD `07fd06f37f8ad4c953b6c40f3bd9f9a9217f7600`，MIT；仓库仍有 PR/提交，成绩改单可回溯；React Native、Firebase 与扫码硬件是其主链。 | 参考“更正后保留旧尝试供回看”；不移入云数据或设备依赖。 |
| [schoolbridge](https://github.com/Shoberman2/schoolbridge/tree/450ff459a60db76a8c8b3461bf672702ad568b53) | HEAD `450ff459a60db76a8c8b3461bf672702ad568b53`，v0.4.0、MIT；有 `grade_changed` 事件，面向 Canvas 等 LMS 的 watcher/MCP/CLI。 | “成绩变更是新事件”与本项目签名追加消息相符，但其 LMS API、轮询和账号前提不适用于教室离线板；只参考事件语义。 |

本地确认：`readTeacherDirectives` 逐条展开已签名名册，`classroomRailSnapshot` 只按 `fail/retry/call/pass` 排序；后续 `pass` 不会让旧 `fail/retry` 退出待办，旧结果仍排前。现有 `directive` 仅有自由文本 `item`、姓名和可选座号；同名、同名目复用以及 80 字显示裁剪都使“按名字和名目自动覆盖”不可靠。长期维护成本是为更正关系增加窄的签名字段、教师审批/历史选择、两端校验和常驻板投影；旧消息继续按旧格式只读。新判定应作为新消息保留，只有明确关联同教师、同教室的原记录和准确学生条目时，常驻板才把旧结果移出当前待办；独立的喊人通知不参加成绩覆盖。此方案等待用户对更正规则的选择，未在本节声称已经实施。

## 2026-09-24 · 学生请求分型回复与桌宠空闲动效（实施前）

本轮先查完整应用/生态，实际搜索：`GitHub open source student teacher appointment request inbox question office call school management app`、`GitHub Moodle Scheduler teacher student appointment booking plugin`、`site:github.com open source desktop pet Electron notification assistant idle alert animation app`、`site:github.com open source Codex desktop pet Clawd mini mode status notification`；再查组件：`site:github.com/learnweb/moodle-mod_scheduler student booking notes teacher appointment status reply source`、`site:github.com Moodle student question type appointment request teacher reply component`、`site:github.com/alterhq/openpets animation idle notification status thread state source`、`site:github.com/rullerzhou-afk/clawd-on-desk state-mapping idle notification working mini`。GitHub 检索成功；OpenPets 的 `git ls-remote` 直连超时，未核其准确提交、许可或本机适配，不采用。

[Moodle Scheduler](https://github.com/learnweb/moodle-mod_scheduler/blob/8a05f853df2eeedd38fcf49479d9c13324ec59ad/README.md) HEAD `8a05f853df2eeedd38fcf49479d9c13324ec59ad`，README 明示 GPL-3.0-or-later、教师设时段/学生预约/会后记录；它是 Moodle/PHP 插件，无法直接代替 Mochi 的离线签名 LAN 消息和 DSH 页面。只参考“预约与其他学生请求分开呈现”，不复制源码或接入依赖。[Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk/blob/90293fc00c591c1a5e976695154646041068f8a3/docs/guides/state-mapping.md) v1.1.0 / HEAD `90293fc00c591c1a5e976695154646041068f8a3` 有按事件选 idle/notification/typing 的成熟映射；代码 AGPL-3.0-only，[美术单独保留权利](https://github.com/rullerzhou-afk/clawd-on-desk/blob/90293fc00c591c1a5e976695154646041068f8a3/assets/LICENSE)，Electron 41 也不同于 Mochi 39。不复制其代码或美术，复用联动计划现有 `OrbCompanion` 动效规则及 Mochi 已有 rail 内联 SVG。

本地确认：教室表单有 `appointment/question/makeup/other` 四类，教师收件页却一律叫“学生预约”，全部用“确认时间/建议改期”回复；协议当前只接受这两种时间决定，学生的非预约意图可能被误读。拟给非预约请求加入独立的人工文字回复类型，发送/接收端严格核对原请求类别，预约仍只能确认或改期，保持原消息 ID 的幂等和签名回执；页面分别显示类别、回复内容与真实送达阶段。维护成本是协议多一个受限变体及两端 UI/rail 投影，旧版对端不认识新变体，需两端升级。另确认教师桌宠空闲时电脑字符仍无限闪烁，而联动计划源组件只在 typing 状态闪烁；拟让 rail 的 idle 保持静止文字、attention 只用轻摇/角标，继续自包含页面和既有降低动效支持。不引入 React、图集或新的动画依赖。

接入后验证：非预约的文字回复绑定原请求 ID，由现有消息正文签名传送；协议两端按原请求类别拒绝混用“文字回复”和“确认/改期”，相同消息 ID 重试不产生第二份回复。教师与教室页面显示原请求类别、回复文字及送达/人工已看到的不同阶段；教师桌宠不把这类请求误写成预约，也不在非预约行补造预约时间。缺失类别而带时间的旧请求沿预约路径处理；显式 `other` 即使填了可选时间仍按非预约处理。`plugins/mochi-lan` 全套测试、客户端 34 项、桌宠模型 241 项、真实 Electron rail 测试、资源装配及根目录 `npm run check` 均通过；根检查的现有 lint 提示不阻断。实际学校双机、跨版本对端和真实学生“已看到”仍未验收；新版文字回复需教师与教室两端同时升级。空闲和待办态电脑字符在 Chromium 计算样式中均为静止，降低动效媒体查询可停止球体等循环动画。

## 2026-09-24 · 本机安全出包路径（实施前）

先搜完整 Electron 打包生态：`site:github.com electron app packaging framework Electron Forge electron-builder macOS Windows native modules`、`site:github.com electron-userland electron-builder macOS Windows installer extraResources`；再看组件文档：[electron-builder targets](https://github.com/electron-userland/electron-builder/blob/master/website/docs/targets.md)、[CLI](https://github.com/electron-userland/electron-builder/blob/master/website/docs/cli.md)、[multi-platform build](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/multi-platform-build.md) 与 [Electron Forge 教程](https://github.com/electron/electron/blob/main/docs/tutorial/tutorial-5-packaging.md)。GitHub 检索成功。本地已安装 electron-builder `25.1.8`/MIT 与 Electron `39.8.10`/MIT，原生 ABI、资源暂存和启动冒烟守卫已存在；完整迁移 Forge 会重做现有发布闭包，不采用。外部主分支文档仅核打包机制，不当作本机安装版兼容证明。

实施前已确认：本机存在被忽略的 `secrets/packaging-keys.local.yaml`，`package-desktop.cjs` 默认读取它并生成首启凭据种子，`prepare-mochi-resources.cjs` 会整目录复制 profile 到安装包。直接构建新 DMG 可能意外内嵌本机 Key。拟给现有 wrapper 增加显式无密钥种子出包选项，让资源暂存也排除已有种子文件，再用目录包启动冒烟与资源检查验证；不更换打包库，不读取或打印密钥值。维护成本是 wrapper 与 staging 共用一个标志和相应测试；Windows 包需原生 Windows runner，不能用本机 macOS 构建结果代替。

该阶段验证：`--without-key-seeds` 跳过首启凭据种子生成，并排除源目录的整个 `profile/seeds` 子树；默认路径显式关闭此选项。安装器参数和暂存回归（含陈旧种子哨兵）通过。加入学生请求分型回复和桌宠空闲修正后、于 09:10 重出的**前版** DMG 为 733,425,612 B，SHA256 `3643ec4803dbe47e3934dac63c9974e09708bc444228cc9c9e635c2ee46da9ca`；当时 `hdiutil verify`、校验边车、挂载后浏览器五项及无 `profile/seeds` 均通过，包内 LAN 客户端和服务源码 hash 与工作区一致。从该版 DMG 复制出的 Mochi.app 冒烟成功且启动日志显示模型种子 absent。它现归档于 `apps/desktop/release/archive/2026-09-24-pre-model-default/`；现行包重新加入**非密钥**模型设置种子，见上方“无密钥首启模型路由”及 [交付台账](DELIVERY-LEDGER.md)。更早的只读挂载卷内直接启动冒烟在 90 秒超时；复制安装路径和全新机器安装仍是不同验收层级。旧版 2026-09-19 macOS DMG 与本日更早首包分别归档于 `apps/desktop/release/archive/2026-09-19/`、`apps/desktop/release/archive/2026-09-24-pre-typed-reply/`。

## 2026-09-24 · 模型卡刷新、有线地址漂移与桌宠待办状态（实施前）

本轮按“完整应用/生态→具体组件”检索 GitHub，搜索成功，无权限错误。模型方向先搜 `site:github.com open source desktop AI chat app provider settings API key UI reactive configuration change Open WebUI Cherry Studio`、`site:github.com open source model provider settings credential UI change endpoint reactive desktop app`，再搜 `site:github.com/deepseek-ai/deepseek-harness settings/document-updated client settings describe provider card`、`site:github.com/open-webui/open-webui provider base_url API key settings refresh event`。核对 [Cherry Studio](https://github.com/CherryHQ/cherry-studio) 完整客户端（2026-09-24 HEAD `4fd31aef1cde88a9c830f8ba4ad48ce57d4c3bab`）和 [DSH 模型设置页](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-settings-models/README.md)（HEAD `46a7f68b0922371ce7144b668b90e377d8e799f4`）。外部 Cherry Studio 的当期许可证/依赖闭包尚未完成接入审计，不复制；本机已装 DSH `0.1.3-alpha.1`/MIT 的 provider-card、settings/credentials 和页面更新事件可直接复用。已确认本项目 MiMo 卡只在 `ctx.remote` 对象变化时刷新有效地址，临时 `saved` 状态在凭据引用变化时仍可显示“已配置”；拟在已有状态源改变时重读并以当前引用的真实配置为准。维护面仅本项目卡片与现有 DSH 事件契约，无新依赖。

LAN 方向先搜 `site:github.com open source LAN device pairing app discovery address changed reconnect signed identity LocalSend KDE Connect`、`site:github.com syncthing syncthing discovery device address dynamic IP manual reconnect`，再搜 `site:github.com/localsend/localsend refresh device address discovery paired identity source`、`site:github.com/KDE/kdeconnect-kde network device IP changes pairing identity`。核对 [Syncthing](https://github.com/syncthing/syncthing)（HEAD `94c3c1cdef718d568686620cbff268eeaaf2c87d`）的公钥设备 ID 与动态地址发现，以及 [KDE Connect LAN link](https://github.com/KDE/kdeconnect-kde/blob/master/core/backends/lan/lanlinkprovider.cpp)（HEAD `f17924772bb788042ac053058be77f481b86b08d`）的证书身份核对后更新链路；[LocalSend 安全公告](https://github.com/localsend/localsend/security/advisories/GHSA-424h-5f6m-x63f)提示不能只凭发现地址更改信任。三者协议、语言和依赖都与 Mochi 当前 Electron/签名短码服务不同，本轮不接入代码；其许可证与本机兼容性没有完成接入级验证。已确认当前 UI 在同一公钥设备地址变化时仍留旧候选；服务只在 UDP beacon 中安全刷新已配对地址，UDP 禁用时没有等价的签名恢复路径。拟复用本项目现成的 `probeCandidate` 和公钥/指纹/角色核对，只在验证成功后更新地址；短码本身仍不代表身份。维护面是 LAN 状态投影及地址恢复 API/测试，不另建目录服务；学校 VLAN、网卡和防火墙仍未验证。

桌宠方向先搜 `site:github.com open source desktop pet todo sidebar notification app Electron accessible list focus update`、`site:github.com open source macOS floating todo app notification popover electron preserve focus updates`，再搜 `site:github.com/deepseek-ai/deepseek-harness aria-live list replaceChildren focus preserve updated rows`、`site:github.com/electron/electron BrowserWindow accessibility focus DOM updates reduced motion`。核对 [Floatodo](https://github.com/pearfish223/Floatodo) 完整 Electron 悬浮待办（HEAD `d00b428e2a816a6f625557ae4d3a5a234701b136`）、[DSH 会话文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/conversation.md) 与 [Electron BrowserWindow](https://github.com/electron/electron/blob/main/docs/api/browser-window.md)。Floatodo 的许可证、依赖闭包和 Mochi 适配尚未完成接入审计，不复制；本项目已安装 Electron `39.8.10`，自包含 rail 页已可维护。真实浏览器复现：仅有历史行时标题“待办 · 暂无”而角标为 `1`；后台刷新 `replaceChildren()` 会使已聚焦行失焦。拟在现有 rail 里按待处理数显示角标、更新时恢复有效行焦点；增加运行时回归。长期成本限 rail 列表渲染，不引入第二套待办应用或动画运行时。

课件按钮文案沿用本日已审的 DSH better-sidebar `0.18.0`/MIT 及真实 PPT 工具卡验收：当前安装版只内置 PDF viewer，PPTX 按钮会转到下载/获取页。原“打开可编辑 PPTX”暗示应用内可编辑，与已验证行为不符；拟改为“获取可编辑 PPTX”，保留本地 PPTX 产物与 PDF 预览双入口，无依赖变化。

接入后验证：MiMo 卡改为监听 DSH 原生设置与凭据引用更新事件，重读当前服务 origin 和当前 `apiKeyEnv` 的配置状态；读取失败清掉旧状态并禁用连接测试，保存中一直等待对当前引用的回读。客户端构建与 13 项测试通过，实际供应商 Key 未调用。LAN 的匹配候选在同身份/指纹的发现地址变化时更新地址，并使旧地址的验证和配对确认失效；客户端 33/33 项通过。已配对设备的手动新地址恢复和 UDP beacon 自动回写均要求目标对新随机数用原私钥签名，服务再核原公钥、完整身份及配对未变化才写入；固定认证 Host 路由拒绝浏览器自报公钥。两个独立 Node 进程、独立数据根、UDP 关闭、教室换端口测试中，旧端口未响应和错误私钥均不能改写配对，正确私钥通过后地址更新；自动发现换端口回写、消息/回执链继续通过。这验证本机网络行为，不代替学校有线双机；身份挑战要求两端均更新到本版，旧版对端会明确提示不支持。教师桌宠的待办 pill 只计可处理事项，历史行仍可看；真实 Electron 键盘焦点和滚动位置在快照刷新后保持，课堂板仍计可见行。课件工具卡按钮及客户端 5 项测试通过。`npm run check` 退出 0（核心插件 139 项），桌面 `test:rail-runtime`、`test:runtime-profile`、`test:package-resources` 与 LAN 双进程/自动发现/持久化/限额/Host 路由检查均通过；资源暂存 25 个插件、29 个 DSH 模块、106 个附加模块。已有 lint 告警非阻断；新版 macOS DMG 的本机复制启动见上方记录，Windows 安装包和学校现场仍未验收。

## 2026-09-24 · 教师待办桌宠复用 Mochi 既有形象（实施前）

先查完整桌宠应用/生态，实际搜索：`GitHub Codex desktop pet Claude crab mascot open source desktop app visual assets`、`site:github.com open source Codex hatch pet desktop companion assets`、`site:github.com desktop pet Claude crab sprites animation Electron Codex`，找到 [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk)（`90293fc00c591c1a5e976695154646041068f8a3`）、[Petdex](https://github.com/crafter-station/petdex)（`a1b229116968cbe9f3a9b2141634a9baa0819864`）、[ClawdGotchi](https://github.com/stevysmith/clawdgotchi)（`8bdd06734e699739cdd982561d81e8fa71b17b45`）；上述 SHA 为 2026-09-24 `git ls-remote HEAD`。再查素材/组件，实际搜索：`site:github.com/rullerzhou-afk/clawd-on-desk license assets Cloudling sprites`、`site:github.com/crafter-station/petdex pet.json sprites license`、`site:github.com/stevysmith/clawdgotchi animation asset license`。GitHub 检索成功。

许可和兼容性核查：[Clawd on Desk 许可说明](https://github.com/rullerzhou-afk/clawd-on-desk/blob/90293fc00c591c1a5e976695154646041068f8a3/README.md)称代码 AGPL-3.0、`assets/` 与主题美术保留权利；[package.json](https://github.com/rullerzhou-afk/clawd-on-desk/blob/90293fc00c591c1a5e976695154646041068f8a3/package.json)也写 `AGPL-3.0-only`，[素材许可](https://github.com/rullerzhou-afk/clawd-on-desk/blob/90293fc00c591c1a5e976695154646041068f8a3/assets/LICENSE)另行保留美术权利。核到 v1.1.0 / HEAD `90293fc00c591c1a5e976695154646041068f8a3`，其 Electron 41 与 Mochi Electron 39 也不宜整体替换。联动计划与 Mochi 的 `OrbCompanion.tsx` 注释把该仓误记为 MIT；本轮已纠正 Mochi 仓注释，联动计划工作树保持只读。Petdex 代码 MIT，但投稿宠物素材由作者各自授权，其原生 Zig 桌宠/Bun CLI/Next.js 画廊与本机 Electron 39.8.10 rail 不是同一运行结构；ClawdGotchi 为 MIT，但也无须引入另一套桌宠运行时。没有复制上述外部仓库的代码或美术，因此无新增外部许可证或依赖。用户口述的“Cloud 小螃蟹计算器”具体指哪一项尚未证实，不能把口述当作资产授权。

已确认的本地可复用物：只读查看 `../联动计划/src/components/OrbCompanion.tsx` 与 `ExpressiveOrb.tsx`，该目录用 TSX/SVG/CSS 绘制焦糖表情球＋小电脑，而非独立的螃蟹位图；源码自述自绘，但本轮未找到独立权属凭证。再次盘点隐藏路径、构建产物、PNG/GIF/Lottie/视频，没有找到单独的螃蟹素材；`public/assets/characters` 经角色组件引用核对为校园猫，水母图是嘉兴品牌。Mochi 已有同形组件 `apps/desktop/renderer/src/components/OrbCompanion.tsx` 和打包视觉 `client-plugins/jxl-theme/assets/mochi-loading.json`（实施前 SHA-256 `b0f786f7c6da5f7773b59e9fdab718cc9f5abcbd1c2313d5ddfe42dfefe928c1`）。教师 rail 的 `rail-pages.ts` 却另画绿色脸。决定复用本地球体轮廓、眼睛、电脑及 idle/alert 动作规则，缩放进现有 `#toggle`，保留角标、物理点击位置、Esc 与减弱动效；自包含 `data:` 页继续使用内联 SVG/CSS，不放宽 CSP。长期维护成本是独立页里的一份小尺寸静态视觉副本，可用现有启动视觉的关键路径/颜色回归约束漂移；不引入 React、图集解析或第三方动画运行时。

该阶段接入后验证：教师 rail 已按现有启动视觉复用同一球体 SVG 轮廓、焦糖色和小电脑路径；当时待办非零时每 5 秒短暂轻摇，后已由本日“托盘隐藏后的提醒”条目改为仅新待办到达时触发。电脑字符在 idle 和 attention 都静止，仅进入 typing 才应闪动。真实 Electron 页面核到球体 `rgb(160,106,50)`、眼睛位置和电脑形状，并用 Chromium 媒体模拟证实 `prefers-reduced-motion: reduce` 让球、眼、电脑和字符的动画均为 `none`；原物理位置点击展开/收回、快速反向和 64 人教室板回归通过。截图见 [新桌宠](evidence/teacher-pet-mochi-orb.png)。启动视觉与 jxl-brand 客户端从联动计划源码重新打包，发行 CSS 注释已剔除，避免带入上游工作区的错误 MIT 注释；新 JSON SHA-256 为 `2cea3dbb96f7016e0bcd915b359cf04870832fb2d4d52e660b5564ce543202d6`。该阶段 `test:rail-logic` 122 项断言、`test:rail-runtime` 真实 Electron 及桌面资源打包检查通过。真实学校双机与用户口述“小螃蟹”身份仍未验证。

## 2026-09-24 · 课件产物在会话内打开（实施前）

先搜完整应用/生态：`site:github.com open source AI presentation generator desktop app generated PPTX PDF preview tool result clickable file`、`site:github.com open source presentation generation app PPTX editable PDF preview workspace Electron`，命中 [Kova](https://github.com/KovaMD/Kova)、[Presenton](https://github.com/presenton/presenton)、[AIPPT](https://github.com/LRriver/AIPPT)。再搜现有宿主组件：`site:github.com/deepseek-ai/deepseek-harness "tool.call.toolview" "openFile"`、`site:github.com/omdsh-dev/DSH-better-sidebar "interceptOpenPath" "openFile"`。GitHub 网页搜索成功；对 Kova、Presenton 的 `git ls-remote HEAD` 本机直连超时，本轮未锁提交、许可证及依赖闭包，所以不接入或复制其代码。完整应用的编辑/导出路径仅作产品参照。

采用本机已安装的 [DSH ui-tool keyed slot](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-tool/README.md)（`@deepseek-ai/dsh-client-ui-tool` 0.1.3-alpha.1，MIT）的 `tool.call.toolview` 与 `openFile(path)`，配合当前已安装的 `dsh-better-sidebar` 0.18.0/MIT。当前 `mochi_ppt_create/revise` 结果已经返回 PPTX 和可选的最终 PPTX 转换 PDF 路径；原生“生成文件”列表只认内置 write/edit 类工具，添加 `presentationMeta` 不会使 Mochi 工具自动可点。拟只增 Mochi 自己的浏览器工具卡，不改变课件生成器或文件访问边界，也不增第三方运行依赖。先验证其浏览器插件装配与工作区内 PDF 可打开；侧栏默认工作区围栏和 20 MB 上限应保留，工作区外/过大文件只能显示受限结果，不能借入口扩大读取权限。长期维护点是 DSH 该 slot、工具结果字段和侧栏文件回调契约，随宿主版本升级需回归。

接入后验证：`mochi-presentations` 浏览器端现为两个工具名注册 keyed 工具卡；成功结果显示 PPTX 按钮，有转换预览时多显示 PDF 按钮，失败、运行中和坏结果无打开入口。5 项客户端测试与桌面资源暂存检查通过。首次真实教师 fixture 启动暴露 `ctx.slots` 缺注入声明，已按本机 DSH Cordis 契约补上 `inject: ['slots']` 后重测：隔离教师页面加载成功，合成 `mochi_ppt_create/revise` 记录分别呈现 2/1 个按钮，没有浏览器异常。该 fixture 只覆盖工具卡静态装载；实际会话内生成与打开另见下方真实链路补验。没有新运行依赖或绕过工作区围栏。

真实链路补验：Chrome headless 隔离启动本机 teacher `mochi-web` profile，将服务地址指向 `127.0.0.1` 的假 MiMo SSE 网关，只使用 fixture Key。模型先仅看到 `mochi_request_work_mode`，教师通过原生审批后切到工作模式；第二次请求含 `mochi_ppt_create`，DSH 真正执行插件而非注入聊天记录。生成两页 `/workspace/deck-1/presentation.pptx` 与由该 PPTX 转换出的 `/workspace/deck-1/presentation-preview.pdf`，工具结果回到同一会话；卡片显示 PDF、PPTX 两个按钮，点击 PDF 后 DSH 内置查看器实际显示两页，见 [教师端真实工具与预览截图](evidence/ppt-real-tool-preview.png)。fixture 校验了响应带有工具 schema、模型收到工具结果、两个产物存在及 PDF iframe 可见；不涉及真实供应商或学校网络，也不代表 PowerPoint/WPS 的最终显示效果。测试期间发现教师预设默认是聊天工具面，必须完成原生工作模式审批才会开放 PPT 工具，这是既有访问控制。无生产代码变更、无新依赖。

## 2026-09-24 · 名册审批、配对换码与缓存验收口径（实施前）

先搜完整应用/生态：`site:github.com open source school management app teacher approve bulk student assessment results preview all students`、`site:github.com open source desktop LAN pairing app code search stale devices verified peer UI`、`site:github.com open source LLM prompt cache analytics app missing usage data hit rate dashboard`。命中 [Result-portal](https://github.com/aryapatel23/Result-portal)、[LocalSend](https://github.com/localsend/localsend)、[dsh-all-usage](https://github.com/ParticleLight/dsh-all-usage)、[agent-lens](https://github.com/naimjeem/agent-lens) 等。再搜组件与宿主契约：`site:github.com/deepseek-ai/deepseek-harness approval reason text length UI approval dialog`、`site:github.com/aryapatel23/Result-portal bulk results preview before final submission approval all rows`、`site:github.com/localsend/localsend clear selected device when search code changes`、`site:github.com/ParticleLight/dsh-all-usage missing usage cacheReadTokens unknown null`。GitHub 搜索成功；外部仓库本轮未锁提交，也未据 README 宣称其界面能直接用于 Mochi。

本地已装 DSH 审批模块 `0.1.3-alpha.1`，原样传递 `reason`，审批正文可滚动，源码未见字符上限，但换行可能折叠；[上游审批契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md)也把 `reason` 定位为人工判定该次动作的说明。`Result-portal` 的批量结果提交前预览是产品参照，版本、许可、依赖闭包未核，不引入。此前已核 [LocalSend v1.18.0](https://github.com/localsend/localsend/releases/tag/v1.18.0) 为 Apache-2.0；它的扫描更新/清除选择说明可参考，但与本项目签名短码协议不同，不复制代码。`dsh-all-usage` 自述 DSH 兼容范围 `<0.1.2`，低于本机 `0.1.3-alpha.1`，不能直接接入；[Hermes 缓存计数缺失问题](https://github.com/NousResearch/hermes-agent/issues/29553)也提示“无字段”与“零命中”必须区分，但不作为 Mochi 适配证据。

当前源码事实：最多 64 人名册的 `rosterPreview` 只列前 12 位，教师可在未看到剩余 52 位内容时准许发送；换 6 位配对码时旧发现结果与已验证候选仍留在界面；`verify-cache-hit.mjs` 将缺失 `cacheReadTokens` 当 0 计入阈值。采用现有 DSH 审批 `reason`、Mochi LAN 状态和会话日志读取链修复，不新增运行依赖。名册若全量进入审批卡，需验证 64 位末行在实际 UI 可滚动查看；配对换码要同时防止旧异步探测回填；缓存计数缺失应给 n/a/不可判定而非假 0%。维护面分别限已有名册摘要、客户端搜索状态、验收脚本与聚焦回归测试。

接入后验证：名册审批 `reason` 现逐人列出全部 64 位的姓名、座号、动作与交代；13 人拒批不外发，64 人批准后签名载荷与审批逐行一致，`test-lan-transport.mjs` 通过。隔离教师浏览器用**合成** 64 人审批文本走已安装 DSH 原生审批卡，暂时关闭 fixture 中优先级更高的问题卡及无法持久化的首次声明；正文滚动高度 1572px / 可视 336px，滚到底后 DOM Range 确认第 64 位交代可见，见 [截图](evidence/approval-roster-64.png)。这验证原生卡容纳长理由，不能替代真实学校教师逐人核对。配对换码的迟到搜索/probe 有代际隔离；32 项客户端测试通过，隔离教师实际页面先出现合成旧候选，换码后立即清除且迟到响应不回填。缓存缺计数显示 `n/a`；任一稳态轮缺字段时整段阈值验收退出码 2，压缩日志测试已并入 `npm run test:cache-probe`，9 项通过。上述功能均复用已有协议或界面插槽，未新增运行依赖。

## 2026-09-24 · 桌宠展开点击位置连续性（实施前）

先检索完整桌宠应用：`site:github.com open source desktop pet Electron floating assistant window expand collapse animation macOS`、`site:github.com open source animated desktop assistant sidebar notification window macOS Electron Tauri`，命中 [OpenPet](https://github.com/dengyie/OpenPet)、[Petty](https://github.com/Saba-Burduli/Petty)、[desktop-pet](https://github.com/Evanfan007/desktop-pet) 等。再检索组件与窗口几何：`site:github.com electron desktop pet expand panel anchored window right edge toggle button animation source`、`site:github.com electron BrowserWindow setBounds animate right edge collapse popover accessibility reduced motion`、`site:github.com/omdsh-dev/DSH-better-sidebar panel toggle button fixed edge expand animation source`，核到 [Electron BrowserWindow API](https://github.com/electron/electron/blob/main/docs/api/browser-window.md) 的 bounds 能力。GitHub 网页检索成功。外部桌宠仓库本轮未锁版本、许可与完整依赖，故只作完整产品参照，不接入或复制代码。

当前本地 Electron 39.8.10 与已有 rail 窗口/动画链足够修这一个布局不变量，无新运行依赖。实测折叠态 76px 宽时宠物中心约 x=38，右缘固定扩成 336px 后该物理点变为 x≈298；现有展开标题的收起按钮却落在 x=13–47，使同一位置无法再次点击收起。复用现有 `setBounds` 右缘锚定和 Apple Design 的空间连续性原则：让展开后的按钮仍覆盖原物理点击位置，并以真实坐标测试，而非只用 DOM `.click()`。维护面限 rail 页布局和 Electron 运行回归。

接入后验证：展开态收起按钮移到标题栏右端，保留同一屏幕坐标。真实 Electron 输入事件从折叠宠物原位置点开、再在同一物理位置点回；有 2 条待办和无角标两种布局都通过，快速反向点击后右缘仍固定。`npm run test:rail-runtime`、121 项 rail 逻辑断言和 235 项 rail 模型断言通过。外部桌宠仅供设计对照，运行时依赖没有增加。

## 2026-09-24 · MiMo 服务来源提示与课件预览入口（实施前）

先检索完整应用：`site:github.com open source desktop AI chat app multiple OpenAI compatible endpoints API key provider settings test connection`、`site:github.com open source Electron AI presentation app generated PPTX PDF preview sidebar workspace`；命中 [Open WebUI](https://github.com/open-webui/open-webui)、[CoWork-OS](https://github.com/cowork-os/cowork-os)、[AIPPT](https://github.com/LRriver/AIPPT) 等。再检索组件：`site:github.com/open-webui/open-webui provider base_url api key verify connection UI settings source`、`site:github.com/omdsh-dev/DSH-better-sidebar openFile PDF viewer workspace session plugin`、`site:github.com/cowork-os/cowork-os PresentationArtifactViewer PptxPreviewService license package`。GitHub 网页检索成功，本轮外部仓库仍未锁 SHA；未把网页主分支当成本机已安装版本。

完整应用里 Open WebUI 明确把连接 URL 与 Key 分开，[文档](https://github.com/open-webui/docs/blob/main/docs/getting-started/quick-start/connect-a-provider/index.md)可核；CoWork-OS 的 [开发说明](https://github.com/cowork-os/cowork-os/blob/main/docs/development.md)展示了其独立 PPTX 预览服务，但未核其许可证、依赖闭包或与本项目的兼容性，因此不复制或接入。当前本机 `dsh-better-sidebar` 是 0.18.0/MIT，peer 目标为 DSH `0.1.3-alpha.1`，已内置 PDF viewer；上游主分支描述的 0.19+ 原生侧边栏要求更新 DSH，不能当成当前运行契约。继续复用当前本机 viewer 与 `settings.describe()`，只做生成后打开路径的实测；模型卡若显示服务来源，只展示从当前设置读取并脱敏的地址，不改变老师已有代理配置、不把上游拒绝冒称密钥必错。长期维护成本限本项目卡片与已有设置契约，不增加运行依赖。

接入后验证：MiMo 卡从 Host `settings.describe()` 的 `mochi-llm-mimo.value.baseURL` 读取当前生效服务，只显示 HTTP(S) origin 和 `mochi-mimo` 路由；用户信息、路径、查询、片段、原始错误均不渲染。读取失败显示固定提示，原生模型编辑卡继续负责改地址。客户端 11/11 测试通过。教师角色的隔离 DSH 页面实际显示被临时覆写的本机网关 origin，手动测试真实请求命中 `/v1/chat/completions`，成功和 401 拒绝分别呈现固定提示，页面没有回显 fixture Key。真实供应商 Key 和学校代理仍未实测。

同一教师页面创建临时工作区/会话，将最终 PPTX 经 LibreOffice 转出的 `presentation-preview.pdf` 放进工作区，从本机已安装 `dsh-better-sidebar` 0.18.0 的 Files 页点击文件，Chrome PDF viewer 最终显示 3 页实际内容。教室角色的精简插件白名单不含该侧边栏，初次教室页面验收未挂载属选错角色；生成和回看课件属于教师流程，无需向教室增加重型 sidebar 依赖。这里只证明教师工作区中已存在预览文件时能打开；目标机 PowerPoint/WPS 排版仍待实测。

本轮改动完成后 `npm run check`、`npm run test:runtime-profile`、`npm run test:package-resources` 与 `git diff --check` 均退出 0；资源检查实际装配 25 个插件、29 个 DSH 模块及 106 个附加模块。原有 lint 告警不阻断检查。验收图见 [产品升级记录](product-upgrade-2026-09-24.md) 的界面证据。

## 2026-09-24 · 预约时间服务端约束与多班待办辨识

先查完整应用/框架：`site:github.com open source classroom teacher student appointment notification multi class desktop app`、`site:github.com open source school teacher classroom appointment scheduling app student teacher notifications`，找到 [ToLa School Management](https://github.com/ToLa-Web/school-management)、[Moodle Scheduler](https://github.com/learnweb/moodle-mod_scheduler) 等。再查组件/规则：`site:github.com/learnweb/moodle-mod_scheduler appointment booking group time slot validation student`、`site:github.com school notification inbox appointment class group identity validation server JavaScript`，并核其[分组与时段说明](https://github.com/learnweb/moodle-mod_scheduler)。GitHub 网页检索成功；本轮未锁外部提交，也未把 README 所述功能当作 Mochi 适配测试。

Moodle Scheduler 仓库当前可见 GPL-2.0-or-later 声明，涵盖师生预约、时段、分组与教师视图；ToLa 仓库展示一位老师关联多个班级，但版本、许可证和依赖闭包尚未逐项核查。它们的 Moodle/PHP 或独立 Web 应用、账户及数据库状态与本项目签名 LAN 消息不兼容，不接入或复制代码。采用现有 Mochi 请求描述符与桌宠投影：仅对预约类在服务端强制希望时间，教师快览保留签名发件班级；不增加运行依赖。维护影响限请求校验和待办数据投影。学校是否真由一位老师负责多班仍未验证，但当前产品已经支持一位老师配对多教室，显示班级可避免同名学生混淆。

接入后已验证：LAN 发送端拒绝无时间或纯空白时间的 `appointment`；接收端也拒绝绕过页面、已签名但无时间的预约，不落收件箱；普通 `question` 仍可不填时间。`node plugins/mochi-lan/test.mjs` 与 `test-durable.mjs` 通过。教师 rail 对两班同名学生显示来自签名身份的班级，聚合弹窗能分别列出两班；`npm run test:rail-model` 235 项断言通过。时间仍是自由文本，尚未校验日期格式或空闲时段。

## 2026-09-24 · 教室模型连通验证与课件生成后回看

先搜完整应用/工作台：`site:github.com open source desktop AI chat app model provider settings test connection API key verify`、`site:github.com open source Electron AI app provider API key connection test button`、`site:github.com open source AI presentation app editable PPTX preview generated slides desktop`，命中 [Open WebUI](https://github.com/open-webui/open-webui)、[AIPPT](https://github.com/LRriver/AIPPT)、[Presenton](https://github.com/presenton/presenton) 等；再搜组件：`site:github.com/deepseek-ai/deepseek-harness settings.models.provider-card credentials.describe set client plugin`、`site:github.com/open-webui/open-webui verifyOpenAIConnection models endpoint behavior source`、`site:github.com office-kit pptx-preview browser render slides read pptx MIT license`、`site:github.com gitbrent PptxGenJS render existing pptx preview png LibreOffice`。GitHub 网页检索成功；CLI 未登录且匿名 API 返回 403，故未取得本轮外部仓库 HEAD SHA，这不同于“没有搜到”。

| 候选 | 本轮核到的版本/许可/相关功能 | 复用与维护判断 |
| --- | --- | --- |
| [Open WebUI](https://github.com/open-webui/open-webui) | 网页主分支 `package.json` 为 0.11.3；[当前许可证](https://github.com/open-webui/open-webui/blob/main/LICENSE) 有品牌保留条件；[源码](https://github.com/open-webui/open-webui/blob/main/src/lib/apis/openai/index.ts) 的直接连接验证调用 `/models` | 只借鉴“保存”与“验证”分态，不复制 UI/代码。其[文档](https://github.com/open-webui/docs/blob/main/docs/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible.mdx)明确 `/models` 缺失会产生假失败；Mochi 不应用该结果宣称 MiMo Key 错误。整套接入还会更换 DSH 凭据和模型状态层。 |
| [AIPPT](https://github.com/LRriver/AIPPT)、[Presenton](https://github.com/presenton/presenton) | 2026-09-24 网页主分支快照；AIPPT 页面称 Apache-2.0、提供逐页预览/编辑和可编辑 PPTX；未锁 SHA、未核其完整依赖闭包 | 参考生成→逐页回看→定页修订→导出流程。现有 Mochi 已产出可编辑 PPTX 和渲染 PNG，整体迁入 Python/Web 工作台会增加第二套项目/模型/文件状态，不采用或复制代码。 |
| [Office Kit PPTX](https://github.com/office-kit/pptx) | 2026-09-24 网页主分支说明 `@office-kit/pptx-preview` 可 SVG/PNG 渲染；本轮未锁版本/SHA、许可证及 Electron 打包依赖 | 对任意外来 PPTX 的预览可能有价值，但不能凭 README 断言本项目兼容。先核现有生成后 PNG 回看与内置文件入口，若确需完整 PPTX viewer，再做许可证、依赖、资源闭包和教学样稿的独立验收。 |
| 已安装 [DSH 模型设置](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-settings-models/README.md)、Mochi Doctor / PptxGenJS | 本机 DSH `0.1.3-alpha.1`、MIT；PptxGenJS `4.0.1`、MIT。DSH 提供凭据只写与 provider-card 插槽；`mochi-hello/doctor.mjs` 已有固定且认证的 MiMo 实际请求诊断，4.5 秒上限、1 token、无工具、响应不带密钥或供应商正文；课件已有实际 PPTX→LibreOffice PDF/PNG 渲染链 | 复用现有 Doctor 路由和生成/渲染链，无新运行依赖。模型卡只增加用户主动触发及结果分态，提示请求可能计费；诊断的是目录首个 MiMo 模型，不代表每个已选模型。课件回看优先持久化真正由最终 PPTX 转换的 PDF，不能把版式独立生成的讲义 PDF 冒称 PPTX 原样预览。 |

实现前已确认的风险：单看“已保存”无法证明密钥或模型可用；把验证放在浏览器并读取凭据会破坏只写边界；只测 `/models` 可能误判；验证请求可能计费。课件完整预览若引入第二套 OOXML 引擎，会增加字体/图表差异及桌面打包成本。现有 `presentation.pdf` 是独立布局讲义，图表仅文字摘要，不能拿它作真实 PPTX 预览；现有模型附件 PNG 是临时产物，不供教师长期打开。

接入后已验证：教室 Models 页的 MiMo 卡增加手动测试按钮，复用既有认证 Doctor 路由，浏览器只提交 `{}`；保存草稿未提交时禁用测试。结果区分本机配置、未填凭据、当前配置服务拒绝密钥、额度、上游、超时与 409 并发测试，避免把第三方网关拒绝一概说成“MiMo Key 错误”。客户端 10/10 测试通过。隔离教室 DSH + Chrome 页面以临时凭据对本机假网关实测成功和 HTTP 401 两条路径：Doctor 真实发往 `/v1/chat/completions`，Authorization 与临时本机凭据一致，界面没有回显 Key。未使用真实供应商密钥；测试只覆盖内置 MiMo 目录首个模型，每次调用可能计费。

课件生成和定页修订现在从**本版最终** `presentation.pptx` 经已有 LibreOffice 转出独立 `presentation-preview.pdf`，manifest 记录来源 PPTX SHA256、渲染器、预览状态和文件 hash；缺少转换器或转换失败时返回 null，仍保留可编辑 PPTX，讲义 PDF 不充当预览。实际转换测试覆盖页数、修订后 PDF 文字与 hash、不遗留旧版预览及失败降级；课件插件 26/26 和桌面资源打包检查通过。实际 DSH 内置 PDF viewer 的逐步打开操作、目标机 WPS/PowerPoint 版式仍待单独验收。

整合后根仓 `npm run check` 退出 0（依赖边界、lint、格式、插件类型、核心插件 134 项及其余质量/传输/压缩/缓存探针）；`git diff --check` 退出 0。lint 输出的旧告警未阻断检查，本轮未为清理无关告警而扩大改动范围。

## 2026-09-24 · 课件逐页来源与教师待办溢出提醒

开发前先搜完整应用/框架：`site:github.com open source AI presentation generator editable PPTX per slide sources citations`、`site:github.com open source classroom lesson presentation generator source citations PPTX`、`site:github.com open source Electron desktop notification inbox task app overflow badge grouping`、`site:github.com open source teacher student appointment notification desktop app`；再搜组件：`site:github.com/gitbrent/PptxGenJS slide addNotes source citation footer example`、`site:github.com microsoft/presentations ContentUrls per slide notes source citation`、`site:github.com electron notification overflow list badge new item id dedup React TypeScript`、`site:github.com open source notification center grouped overflow unread id Electron`。GitHub 搜索成功。

| 候选 | 版本/许可/维护实证 | 决定与成本 |
| --- | --- | --- |
| [Presenton](https://github.com/dqfront/presenton-presenton)、[AIPPT](https://github.com/LRriver/AIPPT) | 2026-09-24 默认分支检索快照；仓库自述 Apache-2.0，未锁 SHA 或逐项核依赖 | 完整可编辑课件工作台，证明逐页编辑与来源路径有成熟产品形态；没有完成与本项目 DSH、PptxGenJS、离线资源包的兼容验证，不接入第二套生成/编辑链。 |
| [Microsoft presentations](https://github.com/microsoft/presentations) | 2026-09-24 默认分支检索快照，未锁 SHA/核许可证 | `ContentUrls` 按页进入备注的思路可参考；其 Python/Azure 环境与本项目当前本地课件工具不同。不复制源码或迁移运行时。 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 已固定并核验本地 v4.0.1、MIT，既有课件测试/可编辑导出；[上游示例](https://github.com/gitbrent/PptxGenJS/blob/master/demos/modules/demo_text.mjs) 使用 `addNotes` | 继续复用现有引擎、备注和 manifest。新增逐页来源输入及明确“未核验”状态，不把课件名/聊天 ID 伪造成资料来源；无需新依赖。维护面限工具 schema、渲染投影及修订回读。 |
| [Boop](https://github.com/chrisgreg/boop)、[electron-notify](https://github.com/hankbao/electron-notify) | 2026-09-24 检索快照，版本/许可/依赖未锁定 | 前者有按 fingerprint 聚合，后者有通知队列；本轮缺口是 Mochi 自己在 50 行上限后丢失新预约身份，没有必要引入第二份通知中心。沿用现有 Electron/rail 的消息 ID 与持久状态，按新增预约 ID 做一次提醒，避免角标变化造成假提醒。 |

已确认现状：模型侧 `mochi_ppt_create` 没有逐页来源字段，却把标题与会话 ID 写成“来源”页脚；`mochi_ppt_revise` 也不能改来源。教师 rail 达到 50 行后，新预约进入汇总行；现有提醒只观察可见注意行，因此新预约 51→52 不触发提醒。两处都优先修状态语义，而不增加样式或第三方通知库。来源文本由模型/用户提供仍只是**声明**，不得冒充已独立核验；现场课本页码和资料内容需另行核对。

## 2026-09-24 · 有线网卡热插拔与发现恢复

本次修改前先搜完整应用/生态：`site:github.com open source classroom teacher student device pairing LAN Ethernet discovery desktop app`、`site:github.com open source LAN file sharing desktop app Ethernet multi network interface discovery pairing`；再搜组件：`site:github.com electron node UDP broadcast per interface directed broadcast multicast discovery library networkInterface`、`site:github.com/localsend/localsend discovery network interfaces multicast Ethernet restart interface license release`、`site:github.com "dgram" "addMembership" "networkInterfaces" discovery reconnect`。GitHub 搜索成功；没有把未集成当作没有现成项目。

| 候选 | 检查到的版本/状态 | 复用决定与维护影响 |
| --- | --- | --- |
| [LocalSend](https://github.com/localsend/localsend) | [v1.18.0](https://github.com/localsend/localsend/releases/tag/v1.18.0)；[该标签许可证正文](https://github.com/localsend/localsend/blob/v1.18.0/LICENSE) 为 Apache-2.0；仓库仍有近期发布 | 完整跨平台应用，提供多接口发现、手动地址和诊断；[主分支开发说明](https://github.com/localsend/localsend/blob/main/AGENTS.md) 描述每接口组播 socket，但未把主分支说明冒充 v1.18.0 的实测。其 Rust/Flutter 协议、身份和文件链与本项目 Ed25519 签名消息不兼容，不整体接入或复制源码；借鉴网卡变化后重建发现路径的边界。 |
| [MeshDrop](https://github.com/chenqi92/share) | 2026-09-24 默认分支网页快照，README 称 v0.1、MIT，未锁提交 | 原生多平台应用和 mDNS/手动确认链，仍自述早期安全限制；引入它会产生第二套发现、身份和传输栈。不采用，不能仅凭 README 推断 Mochi 适配。 |
| [Synbad](https://github.com/krazyjakee/Synbad)、[LanLink](https://github.com/tapiwamakandigona/lanlink) | 2026-09-24 默认分支检索快照，未锁提交，许可/依赖未完成逐项核验 | 均是完整 LAN 应用，展示自动发现和有线场景；未核到可直接接入的许可与依赖兼容性，不复制代码。 |

本轮仅复用现有 Node `dgram`、`os.networkInterfaces()` 和 Mochi 已签名配对/手动地址链。已确认源码缺口：`mochi-lan` 发现降级后清除信标计时器但没有恢复计时器；原组播只入一个网卡，广播只按目标地址去重，多网卡同网段会漏发一条源路由。修复为降级后定时重建发现 socket、随网卡变化加入/退出每个 IPv4 组播成员、按源 IP 发送广播与组播，单路故障下保留另一条发现路径，并在教室页面显示当前可供手动配对的网卡 IPv4/端口。停止时释放所有 sender socket/计时器；不更换协议或增加运行依赖。完整 LAN 插件测试及故障注入通过，本机实际页面显示网卡地址；校园双物理网卡、VLAN、交换机和防火墙仍待现场验证。

配对治理沿用本文件前述 [PC Link](https://github.com/Parado-xy/pclink) 与 [LocalSend](https://github.com/localsend/localsend) 完整应用检索，再查 `site:github.com open source local network pairing block unblock trusted device UI Electron`、`site:github.com/localsend/localsend block device unblock peer pairing`。检索命中 [ZWormHole](https://github.com/TheHolyOneZ/ZWormHole) 的 blocked-list/unblock 交互（2026-09-24 默认分支快照；版本/许可/依赖兼容未核，不复制代码）和 PC Link 的设备令牌撤销；后者中心服务令牌模型与本项目不兼容。当前 Mochi 拉黑删除配对并持久阻止相识，但没有解除入口。新增本机认证路由和确认弹窗只撤销禁止标志；不会恢复旧配对或自动信任新指纹。复用现有一次性本机授权和完整人工配对，维护范围是 LAN 服务/路由/界面与回归测试，无新增运行依赖。隔离 DSH 教室页面实测：拉黑后原配对消失，解除拉黑后仍无配对；手动地址显示实际 `en0` IPv4 和监听端口，而非 `0.0.0.0`。

## 2026-09-24 · 续查：自定义凭据引用与 Office 预览

沿用上节完整应用/框架优先的检索，补查 `site:github.com open source Electron desktop AI app Office PPTX preview editor`、`site:github.com deepseek harness better sidebar office preview plugin pptx docx xlsx`、`site:github.com open source browser Office document viewer PPTX DOCX XLSX React`；之后检索组件 `site:github.com/HuanLinOTO/dsh-plugin-better-sidebar-plugin-office license version compatibility`、`site:github.com/pagus-kit/Pagus package.json license react PPTX viewer`、`site:github.com/ChristopherVR/pptx-viewer license package version tests`。GitHub 网页检索成功，未把未集成理解成没有现成项目。

| 候选 | 已看版本/状态 | 复用结论及维护成本 |
| --- | --- | --- |
| [GenOffice](https://github.com/genspark-ai/genoffice)、[Zrimo](https://github.com/bnku/zrimo)、[anyview](https://github.com/harshpreet931/anyview) | 2026-09-24 默认分支网页快照；本轮未锁提交、未完成许可/依赖核查 | 完整应用或 Office 框架，可作为后续架构比选，不接入已有 DSH/Electron 的文档状态、用户数据和打包链。未验证与本项目的运行兼容性。 |
| [DSH better-sidebar Office 插件](https://github.com/HuanLinOTO/dsh-plugin-better-sidebar-plugin-office) | `package.json` v0.1.2，仓库默认分支 2026-09-24 网页快照，未锁 SHA；[许可证正文](https://github.com/HuanLinOTO/dsh-plugin-better-sidebar-plugin-office/blob/master/LICENSE) AGPL-3.0 | 有 DOCX/XLSX/PPTX viewer，依赖 Pptx renderer、Univer、docx-preview 等；peer 目标 DSH client `^0.0.1-rc.1` 与 better-sidebar `^0.6.0`，当前 Mochi 是 DSH `0.1.3-alpha.1` 和 sidebar `0.18.0`。版权义务、版本及依赖体积都需单独评审，不作为本轮即插即用方案。 |
| [Pagus](https://github.com/pagus-kit/Pagus)、[pptx-viewer](https://github.com/ChristopherVR/pptx-viewer) | 2026-09-24 默认分支网页快照；Pagus MIT、仓库页约 18 commits；pptx-viewer Apache-2.0，均未锁 SHA | 提供 PPTX 渲染组件，但没有在 Mochi 的 Electron 资源闭包、沙箱和教学样稿上跑兼容性。当前生成器已输出可在内置 PDF viewer 查看但排版独立的 PDF；不能冒称 PDF 是 PPTX 原样预览。PPTX 预览仍是未交付能力，后续以真实渲染/兼容测试决定依赖。 |

自定义 MiMo Key 的本轮修复继续复用已安装 DSH `@deepseek-ai/dsh-client-ui-settings-models` 的 provider-card 插槽、`settings.describe()` 的 `mochi-llm-mimo.apiKeyEnv` 与原生 `credentials.describe()/set()`；未引入库。真实适配器从 `connection.apiKeyEnv` 解析凭据，故保存前重新读取当前引用名并校验，不能以 UI 常量覆盖部署设置。DSH 启动环境变量优先于本机凭据文件：当前引用为环境来源或不可写时，卡片拒绝写文件并提示在启动环境更新，避免出现“保存成功但调用仍用旧 Key”。本机默认、自定义、旧版回退引用名和环境优先级已通过假网关/凭据仓库测试；真实供应商 Key 尚未验证。维护影响限于本项目卡片及 DSH settings/credentials 契约。

缓存前缀实施结论：沿用下节检索到的 [LiteLLM](https://github.com/BerriAI/litellm)、[LangChain](https://github.com/langchain-ai/langchain) 与 [DSH](https://github.com/deepseek-ai/deepseek-harness) 框架生态比较，采用本地已安装 DSH `0.1.3-alpha.1` 的 `system-prompt/assemble` 钩子，未接入额外代理。先前把动态 URL 后移到 runtime context 的实验未能证明缓存收益；本次将该 URL 从模型消息中移除，但保留 DSH 的实时 `DSH_WEB_URL` shell 环境值。维护成本是上游 `app:web-surface` 文字或 URL 格式升级时必须回归；无匹配则保留原文，不猜测新格式。补查实际搜索词 `site:github.com/deepseek-ai/deepseek-harness DSH system prompt assemble cache`、`site:github.com/BerriAI/litellm prompt caching proxy`、`site:github.com/deepseek-ai/deepseek-harness "DSH_WEB_URL"`；[DSH 组装说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/README.md) 与 [Web App 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md)仅作组件核对，未以主分支文档冒充本机版本。两次隔离教师冷启动、不同 Web 端口，真实首轮 `model`、4 条 `messages` 和 89 个 `tools` 逐项相同，脱敏抓包 SHA256 均为 `9dd931fcaf3b3c9e2227e92192cae95f4beb32aba977b0cdea3f372c24d587ca`。这是本机假网关的请求稳定性证据，真实供应商命中率和费用提升仍未验证，见 `docs/cache-hit-rate.md`。

追加本机假网关 A/B：独立工作首轮为 4 条消息/89 工具；同一会话先聊天再切工作时为 3 条消息/1 工具→6 条消息/89 工具。两份工作请求的 system 文本与全部工具 schema 一致；聊天历史导致完整消息列表不同。临时抓包器曾逐块解码 UTF-8，造成一个工具描述标点误记成 `��`；先拼 Buffer 再解码后重抓，差异消失。这是测量工具问题，不改 Mochi 源码或默认模式。真实供应商缓存命中、切换轮费用和账单仍未测，不因请求形态相同而声称性能提升。

## 2026-09-24 · 本轮并行实现前补查

先搜完整应用/框架/插件生态：`site:github.com open source classroom teacher student desktop app offline LAN discovery pairing 2026`、`site:github.com open source AI desktop app model provider API key settings Electron local education`、`site:github.com open source presentation generator editable PPTX classroom design PptxGenJS`；随后搜组件：`site:github.com Electron model API key settings credential plugin open source keytar safeStorage 2026`、`site:github.com electron LAN pairing code challenge discovery Bonjour mDNS UDP library`、`site:github.com Electron transparent desktop pet spring animated window bounds accessible`、`site:github.com PptxGenJS presentation QA render inspect editable slides auto layout 2026`。GitHub 网页检索成功，API 对部分仓库超时；这不是无权限，也不是“没有现成方案”。

| 候选 | 检查到的版本/状态 | 相关功能、许可/依赖与决定 |
| --- | --- | --- |
| [CodePilot](https://github.com/op7418/CodePilot) | 2026-09-24 `main` 网页快照，1,478 commits；API 提交 SHA/许可查询超时 | 完整 Electron + Next.js 多供应商客户端，含 Key 设置和诊断。源码列有 LICENSE，但本轮未核正文和当前依赖锁版本；不接入。它的主循环、Next.js、存储会替换现有 DSH 边界，维护及数据迁移成本过高。可借鉴“未配置凭据”和“连通性诊断”分层文案。 |
| [Exam Monitor](https://github.com/SubaashNair/exam-monitor-app) | 2026-09-24 `main` 网页快照，未取得 SHA；API 显示未归档、2026-05-19 推送 | Go + Gio 教室监控全应用，有 LAN 发现与手动路径；许可证仍未核实，未复制代码。Mochi 的已签名教师/教室消息协议和 Electron 运行时继续保留。 |
| [OpenPet](https://github.com/dengyie/OpenPet)、[DeskCat](https://github.com/coglabss/deskcat) | OpenPet 已核本地审查版本 `1.0.1`，API 显示 MIT、未归档、2026-09-11 推送；DeskCat `main` 网页快照、未取得 SHA，API 许可 `NOASSERTION`、未归档、2026-06-14 推送 | 都提供 Electron 桌宠窗口/状态范例。沿用本项目已经存在的 rail、位置持久化和窗口生命周期；完整替换会引入第二套窗口/状态/依赖。仅借鉴常驻小形态、点击展开和减弱动效，不复制未核许可证代码。 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS)、[office-kit/pptx](https://github.com/office-kit/pptx) | PptxGenJS 沿用已审计 v4.0.1 / `3c9ec1b687c174952166f6a34b5e87ebf69fa469`；office-kit 为 2026-09-24 仓库网页快照，API 提交 SHA 查询失败 | PptxGenJS 已安装、MIT、可编辑形状/文字且有本项目渲染测试；继续采用。office-kit 是另一套 PPTX 读写库，许可、依赖兼容及维护未核到可接入级别；不采用，避免迁移现有生成/修订/回读链。 |

本轮没有新增第三方运行依赖。复用现有 DSH 凭据、Mochi LAN 签名投递、Electron rail 和 PptxGenJS，修补产品路径与状态投影；实际功能以本地运行和产物检查为准，不用候选仓库 README 代替集成验证。

LAN 接入边界：短码查询只枚举本机通过 UDP 广播/组播发现的教室候选，再向候选地址发签名挑战；它不是跨 VLAN 的地址目录。失去 UDP 发现时可输入已知 IP，但仍要求两端 IP 可互访、身份与公钥指纹核对及双方人工接受。此约束沿用 Mochi 现有签名协议，避免为短码另引中心服务或第二套信任状态；代价是学校网络禁止发现且不给可达地址时，需要网络策略或独立中继设计。本机协议测试覆盖发现与签名链，两个实际 DSH 页面 fixture 关闭 UDP，仅验证手动地址配对及预约闭环。追加页面检查展示教师发件箱逐人详情，并用合成第二教师验证目标选择与指纹确认；未向合成教师做真实签名发送，也未在校园双机网线和跨 VLAN 环境验证。

待办投影继续复用 LAN 消息，不复制数据库状态。教师当前身份或教室配对不再匹配时，旧预约与发件保留为只读历史且不计待办；教室换班后旧学生名单不能进入新班公开板。教室端教师预约回复展示确认/改期时间，不混入全班喊人板。听写单条签名消息可含多人处置；教室常驻板超过 50 行时用末行给出剩余数量，并定位原消息中的完整名单，避免静默截断。教师端预约与通知同时超限时分别保留入口。沿用现有主页面名册、LAN 完整身份比对、`#assertExpectedBinding` 与 rail 行协议；受控预约/回复路由强制携带核对时的两端身份，服务另检查原预约归属，避免换密钥或改班后把旧确认发给新身份。无新依赖，维护成本是未来消息方向和身份字段升级时同步检查路由及投影。`test:rail-model` 共 213 项断言、客户端 28 项测试、本机真实 Electron 64 人截图/点击与 LAN 服务回归通过；隔离双 DSH 页面重跑闭环和伪旧指纹拒发提示通过，学校实机验收仍待完成。

模型密钥复核：已安装的 `@deepseek-ai/dsh-client-ui-settings-models` 只给 `llm-deepseek`/`llm-pi-ai` 内建可编辑布局；单独注册 `mochi-llm-mimo` settings section 虽能列出 MiMo，原生编辑卡仍是 `layout=unknown`，不能保存。复用现有 `mochi-model-presets` 的官方 `settings.models.provider-card` 插槽，在 MiMo 卡内增加密码框，经当前 `apiKeyEnv` 指向的原生凭据引用保存，不改 vendor。真实隔离课堂 Models UI 已输入 fixture Key、保存、重启 DSH 后显示已配置；临时 `.credentials.yaml` 权限为 0600，重启后适配器向本机假网关发送的 Authorization 与 fixture 值一致。随后增加自定义引用、不可读/非法引用和环境变量优先级防护，拒绝可能无效的写入；这些分支已做本地测试，未用真实供应商 Key，也未将明文 Key 写入日志或仓库。长期成本仅为维护本项目客户端插槽与 DSH 原生 settings/credentials 契约；若上游新增插件命名空间通用编辑布局，可撤掉这张专用卡。

打包复核：`npm run test:package-resources` 首次失败，证实新增 `comparison-layout.mjs` 未在插件资源白名单。补齐白名单和同测试的必需文件断言后重跑通过：25 个插件、29 个 DSH 模块、106 个附加模块与静态客户端资源均暂存成功。源码测试通过不能代替安装包闭包验证。

缓存复核：从当前教师 `mochi-web`/`lesson-planning` 工作会话用假 Key 向本机假网关白名单捕获首轮 `{model,messages,tools}`，9,542 字符 system 消息和 89 个工具含 `mochi_call_student`。新增探针 `--request-file` 重放该消息/工具前缀，随后合成 5 轮对话；真实网关冷测 MiMo 第 2–6 轮 99.80%，aiaaa 62.61%（第 3 轮 0%，第 5 轮 14.62%），见 `docs/cache-hit-rate.md`。请求其他参数由探针设置，这不能证明真实长会话或升级后成本降低。旧 197 字符宿主 persona + 真实工具面的简化探针结果是 MiMo 99.82%、aiaaa 79.78%，只留作对照。`tools/test-cache-hit-probe.mjs` 的 6 项本机假网关回归通过，并接入根 `check` 与 CI 零依赖门禁。真实 1→89 工具切换、其他角色、升级前后同输入变化和账单成本未测。

跨启动缓存补查：先搜完整代理/框架生态 `site:github.com BerriAI litellm prompt caching proxy open source`、`site:github.com langchain-ai langchain chat model prompt caching messages open source`、`site:github.com deepseek-ai deepseek harness prompt cache system prompt`，再搜 DSH 组件入口 `site:github.com/deepseek-ai/deepseek-harness "includeRuntimeContext" "Date"`、`site:github.com/deepseek-ai/deepseek-harness "runtime context" "current time"`、`site:github.com/deepseek-ai/deepseek-harness "systemPromptUpdate" "in-history"`。检索成功，命中 [LiteLLM](https://github.com/BerriAI/litellm)、[LangChain](https://github.com/langchain-ai/langchain) 和 [DSH](https://github.com/deepseek-ai/deepseek-harness)；前两者是额外代理/框架，未固定其版本、许可证和本项目依赖兼容性，故不接入。实际复用已安装 `@deepseek-ai/dsh-system-prompt` / `dsh-web-app` `0.1.3-alpha.1`（本地 package manifest 均为 MIT）及官方 `system-prompt/assemble`、runtime context、`DSH_WEB_URL` 注入点；无新依赖、无 vendor 补丁。两次隔离教师首轮抓包精确比对显示唯一变化是前段 system 的本机随机端口；临时 waterfall 变体能把整条 system 稳定下来并保留动态 URL，但 4 次有限 MiMo 对照中原始组两次均无可用缓存计数，仅变体第二次有 87.18% 命中。缺少可比基线，无法确认收益，未接入生产；完整哈希、前缀长度和结果见 `docs/cache-hit-rate.md`。固定端口会增加冲突与启动失败风险，不采用。

## 2026-09-23 · 教师模型、教室配对、桌宠待办与课件设计

开发前检索顺序：先搜完整应用与生态，后搜组件。实际搜索词：`open source classroom teacher student desktop app LAN pairing discovery Electron`、`open source AI desktop application provider API key model settings classroom teacher`、`open source desktop pet todo sidebar Electron animation`、`Bonjour mDNS pairing code local network Electron package`、`motiondivision motion spring animate React MIT license`、`open source classroom device pairing code teacher app`。GitHub 网页搜索与仓库页可用；GitHub API 元数据请求分别遇到超时或 SSL EOF，故未把 API 未返回视为无方案，也未虚构未取得的提交 SHA。

| 候选 | 已查看版本/提交 | 许可、依赖和维护核查 | 复用决定 |
| --- | --- | --- | --- |
| [OpenPet](https://github.com/dengyie/OpenPet) | `main` 的 package.json `1.0.1`，2026-09-23 网页快照；未取得 SHA | package 与仓库标 MIT；Node ≥22.12、Electron，仓库页显示 1,394 commits。宠物状态服务、透明窗口、主进程密钥存储是现成功能；未运行其发布包。 | 部分借鉴“宠物状态单一来源、凭据不进入渲染层”，不整体接入另一套 AI/插件/窗口生命周期。Mochi 已有 Electron rail 与原生凭据服务；替换维护成本高。 |
| [Exam Monitor](https://github.com/SubaashNair/exam-monitor-app) | 默认分支网页快照，2026-09-23；未取得版本/SHA | Go + Gio；网页说明手动 IP → mDNS → UDP 的发现路径；许可证本轮未核实，不复制源码；Windows/macOS 实测与 Mochi 协议兼容未验证。 | 只参考“发现失败仍能手动连”的产品逻辑。Mochi 已有 UDP 广播/组播与手动地址，优先修有线网卡选择和诊断，不换传输栈。 |
| [PC Link](https://github.com/Parado-xy/pclink) | `master` 网页快照，2026-09-23；未取得版本/SHA | 仓库页标 MIT；6 位一次性配对码依赖其中心服务与设备 token；未运行它的鉴权/限流测试。 | 只参考短码的过期、限次和人工输入体验。Mochi 是局域网双端签名配对，不能直接引入其服务器或把短码当长期身份。 |
| [Motion](https://github.com/motiondivision/motion) | `main` 网页快照，2026-09-23；未取得 npm/commit 精确版本 | 官方 README 标 MIT，提供 JS/React 弹簧、手势和布局过渡，仓库页面活跃；未对 Mochi 的独立 `data:` 悬浮窗构建链做兼容测试。 | 当前 rail 是自包含 HTML，不增添新的前端运行时。按 Apple Design 的响应、空间一致性、可中断与减弱动效原则在现有窗口上实现；若引入复杂拖拽再单独评估 Motion。 |
| 已采用的 [DSH](https://github.com/deepseek-ai/deepseek-harness)、[pi](https://github.com/earendil-works/pi)、[Yan-Agent](https://github.com/666-gy/Yan-Agent) | 本地 DSH `0.1.3-alpha.1`；pi 由现有 `mochi-model-presets` 构建提取目录；Yan 固定提交 `173d68708821436dddf3f4ed0b3e100ead27b6a2` 的研究见 `docs/yan-agent-research.md` | DSH/pi 的原生设置、凭据与模型目录已在本项目使用并有离线测试。Yan 根 MIT 仅覆盖已核公开源码，Beta3 运行行为未验证。 | 保留原生模型密钥编辑与现有课件生成/渲染/评测链；只修教室角色的入口和运行验证。Yan 的版本化经验与视觉复核做对照依据，不复制 OpenCode sidecar 或自动晋升成功经验。 |

长期影响：短码是引导定位/核对的临时凭证，必须保留学校、班级、角色、公钥指纹人工确认；自动发现不得自动信任。教师待办以 LAN 已签名消息为来源，投递、教师查看、预约确认/改期必须分态，不另造易漂移的界面数据库。缓存优化沿用 `docs/cache-hit-rate.md` 的稳态口径，不承诺每轮 99%；PPT 质量以实际文件、渲染图和独立评测核对，不用模型自评替代。

接入后验证（2026-09-24）：教室角色运行配置、Models UI fixture 密钥保存→重启→本机假网关请求、客户端 30 项测试、桌面 TypeScript 与资源打包检查通过；实际供应商 Key 未用。教师单人叫号和原有名册共用签名审批/幂等链，`test-lan-transport.mjs` 与真实签名已看到回执恢复测试通过。LAN 的本机双进程、自动发现、持久化、浏览器投影和 host 路由测试通过，覆盖有线网卡的定向广播地址计算、短码挑战/过期/限频、双方人工确认、ACK 丢失重试、预约确认/改期回传及冲突拒绝。追加故障注入验证：接受配对的 HTTP 回执丢失、教师重启后同请求重试成功；两名教师并发使用同一个短码只有一条待确认请求；学生预约首次回执丢失后按原消息 ID 重试，教师收件箱只有一条。两个隔离的实际 DSH 页面完成了手动地址＋短码＋双方核对身份配对，以及教室提交预约→教师待办查看→教师确认时间→教室显示决定→教室人工已看到的闭环；该页面 fixture 特意关闭 UDP 自动发现，不能替代学校真实交换机/VLAN/防火墙验收。教师桌宠的 229 项模型、121 项逻辑断言和真实 Electron runtime 测试通过，展开与折叠截图已目视复核。课件新增 `title-compare` 可编辑两栏版式，复用现有 PptxGenJS 4.0.1、pdf-lib 1.17.1 与 LibreOffice 渲染链，无新运行依赖；插件 25/25 测试通过，实际渲染页已目视复核，定页修订仅改变目标页。缓存可观测性和模式切换幂等测试通过；当前教师工作模式完整首轮消息/工具前缀的合成延续冷测见 `docs/cache-hit-rate.md`：MiMo 第 2–6 轮 99.80%，aiaaa 62.61%，后者第 3、5 轮大幅失去缓存。升级带来的提升幅度、真实长会话、其他角色与账单成本仍未验证。目标机 WPS/PowerPoint、真实供应商 Key、学校双机有线环境仍待现场验证。上述外部仓库只完成研究，没有把其源码或二进制接入 Mochi。

> **status**: active
> **last_verified**: 2026-09-24
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
## 2026-09-24 · 桌宠无障碍动效与待办计数收尾（实施前）

先搜完整应用/生态：`site:github.com open source desktop pet app Electron React accessibility reduced motion animated desktop pet`、`site:github.com desktop pet framework Electron open source plugin`，核对 [OpenPet](https://github.com/dengyie/OpenPet)（2026-09-24 HEAD `aec45f537d8056fb9e2c8c309a132f788321566a`，MIT、未归档，Electron/React 桌宠、宠物包与控制台）和 [desktopPet](https://github.com/kokoronoka/desktopPet)（HEAD `9ee7815a7c2e973207d625c21c7a5e4182775ad3`，仓库 API 未给许可证，Windows Electron 桌宠）。再搜组件/平台：`site:github.com motiondivision motion React reducedMotion MotionConfig source`、`site:github.com electron electron BrowserWindow backgroundMaterial vibrancy accessibility reduced motion`，核对 [Motion](https://github.com/motiondivision/motion)（HEAD `50f9558f31e09bdd31908f7d78f16f016e4bb734`，MIT）与 [Electron BrowserWindow](https://github.com/electron/electron/blob/main/docs/api/browser-window.md)。以上是实际 GitHub 搜索和匿名 API 读取；未核 `desktopPet` 的独立许可证，所以不借用其代码或美术。

当前 Mochi 已装 Electron `39.8.10` 并有两份共享形象的 CSS、一个自包含 rail 页面。OpenPet 的完整服务、素材包和插件生命周期无法解决 CSS 漏选内层电脑和 rail 计数口径；整套移植会增加状态、打包及许可维护面。Motion 再引入运行依赖也不能替代现有 CSS 选择器修正。决定在既有动画层覆盖 `prefers-reduced-motion` 与显式静止态，并让 rail 的播报/角标计数取模型中的真实待处理数；高对比与降低透明度按折叠态实测修正。只复用既有视觉路径与平台媒体查询，不复制外部素材。接入前确认的缺口：两份 React CSS 漏掉 `.companion-laptop`、thinking/alert 外层；60 条教师待处理时标题为 60 而播报 49；64 条教室结果时标题为 64、角标却因可见行上限显示 50；高对比样式可被后面的折叠态规则覆盖。后续记录实际验证结果。

接入后验证：教师快照另带裁剪前 `actionRequiredCount`，主进程白名单校验后送至页面；60 条待办/50 行可见的真实 Electron 夹具显示 9+ 视觉角标和“60 条待处理”完整播报，收起后仍为 60。教室快照带裁剪前 `totalRowCount`，64 人/50 行可见时角标与播报均为 64。高对比媒体模拟下折叠/展开桌宠与面板改为实底色、无毛玻璃，禁用材质切换过渡；真实 Electron 计算样式检查通过。行刷新后若原焦点行消失则退到展开按钮；Escape 收起也把焦点交回按钮。两份 React CSS 在显式静止态与系统减弱动效下覆盖全部子元素的动画与 transition；启动视觉生成物使用本仓 CSS，真实 Chromium 用同一生成物验证六种状态都静止，普通 typing 仍有动画。联动计划仍提供 SVG 组件，Mochi 内这份 CSS 是打包时的无障碍覆盖；新增了本仓可追溯的构建输入，不引入依赖。`test:rail-model` 258 项、`test:rail-logic` 137 项、真实 Electron rail、桌面资源装配和根 `npm run check` 均通过。学校 Windows 高对比实机及最终安装包仍需另行验证。

## 2026-09-24 · 学生请求弹窗可读性与桌宠重载状态（实施前）

先搜完整应用：`site:github.com open source desktop school notification app read receipt full message popup Electron`、`site:github.com electron desktop notification inbox read receipt full content modal open source`，核对 [LEOS](https://github.com/HolagundiWorks/leos)（HEAD `62ea418b5bd401446779393efe87ae25b03a6d13`，GitHub 许可 `NOASSERTION`，未归档，Electron/React/SQLite 学校平台）与 [desktop-notifications](https://github.com/desktop/desktop-notifications)（HEAD `41d50b6f85e1689f3edc38549613936ad05e2501`，MIT，已归档，原生通知组件）。再搜平台组件：`site:github.com electron BrowserWindow reload restore renderer state preload snapshot state`，核对 [Electron BrowserWindow](https://github.com/electron/electron/blob/d84782479699094842d6a5f359438d480818539e/docs/api/browser-window.md)（HEAD `d84782479699094842d6a5f359438d480818539e`，MIT）及 Notification API。GitHub 检索和 API 读取成功。LEOS 许可/依赖闭包未核，desktop-notifications 已归档且原生二进制与本机 Electron 39.8.10 未验证；均不接入，也不复制代码。

本地真实 Electron 已复现两处问题：65 字原话加摘要组成 131 字详情时，弹窗 448×248 的详情压到按钮上，仍附有可签“我已看到”；桌宠展开后 webContents 重载，主进程保留 336px 展开窗口，页面却默认收起并隐藏列表。决定继续使用现有签名 LAN 回执和主进程窗口状态，修正弹窗内容/尺寸门槛与主进程向重载页面的状态同步。维护范围限 rail 模型、独立页与现有回归，不增加数据库、桌宠或通知运行依赖。学校目标机的字体缩放和不同分辨率仍需后续实测。

接入后验证：学生请求快捷回执的详情只含完整原话；模型还限 72 字原话、36 字主题和 80 字最终详情。独立页用实际滚动尺寸与标题/正文/按钮矩形判断可见性，布局不够时按钮只能关闭提醒，点击时再次复核。真实 Electron 的 65 字中文请求可完整显示并确认；故意构造的超长异常负载只显示关闭，滚动正文不会压住按钮。主进程通过原有快照通道向独立页同步可信 `expanded` 状态，页面重载后真实 Electron 夹具确认待办仍展开，下一次点击正常收起；快照不存在时发送纯状态。`test:rail-model` 258 项、`test:rail-logic` 137 项与 `test:rail-runtime` 通过。未引入外部代码或运行依赖；字体缩放和学校机器仍需现场验收。

## 2026-09-24 · Windows 脚本输入闭包（实施前）

先搜完整打包生态：`site:github.com open source electron app windows build workflow source snapshot allowlist scripts package json dependencies`、`site:github.com electron-builder monorepo source package scripts artifact exact manifest github actions`；再搜 npm 脚本/组件：`site:github.com npm package scripts dependency closure snapshot manifest detect missing script CI`。核对 [electron-builder](https://github.com/electron-userland/electron-builder) 的仓库脚本与 Electron 官方 [Windows 构建说明](https://github.com/electron/electron/blob/main/docs/development/build-instructions-windows.md)。本项目已经锁定 electron-builder `25.1.8`；本次不升级。网页检索成功，但未重新锁外部 HEAD，不能把主分支示例当成本机完整适配；不复制代码或引入依赖。

已确认上轮私有 Windows run `35954471732` 停在 `test:runtime-profile`：快照漏 `test-classroom-model-credentials.mjs`，而当前 `package.json` 已调用它。已有 manifest 调和器自动扫描 `skills/` 和 `apps/desktop/electron/`，却不扫 `apps/desktop/scripts/`；它只能核现有条目的 hash，不能发觉新脚本入口。对 41 个桌面脚本做只读文件清点，拟将这个源码目录纳入自动登记范围，再收敛精确 manifest 和私有快照。这样以后 package script 新增测试或打包脚本不会再次静默漏档；增加的快照仅为源码脚本，不含凭据、用户数据或构建产物。实际 Windows CI 仍须重跑验证。

接入后验证：调和器纳入 `apps/desktop/scripts/`，自动补齐 17 个原漏源码脚本，排除一个 `.bak` 备份；本地 `--check --fail` 与完整 manifest 闭包检查通过。最终清单 524 条 / 92,417,237 B；私有快照 commit `eddc7ea3a1b3cc237867755be57a68761fba2d93` 包含 525 个 blob（含清单），与本地逐条对象 ID 相同，`mochi-source` 外 1365 个条目和 workflow blob 未改。新 Windows 原生 CI [run 35957828187](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/35957828187) 已通过此前缺失脚本所在的 runtime profile、资源门禁及原生安装器构建；最后 `Retain private Windows installer` 因 GitHub Actions artifact 存储配额已满失败，run 的 artifacts API 返回 0。没有可下载 EXE，因此不能独立核对 PE 结构与安装器 SHA256，也不能声称 Windows 当前包已交付。未删除旧产物或修改 workflow。

本轮冻结源码的 macOS arm64 无密钥包沿用既有 electron-builder `25.1.8`，不改依赖或构建路径。DMG 为 733,862,433 B，SHA256 `e11bab48ab892ea0d4ffe1e4dea8f3418548728aaf934977dd9e2c4ac031fe27`；边车与 `hdiutil verify` 通过。挂载包只有非密钥 `settings-defaults.json` 种子、五项浏览器资源、25 个插件；包内 `main`、双 preload、三份 rail JS 和关键插件逐字节匹配工作区。从镜像复制出的 `.app` 10 秒启动冒烟通过，日志 `settings: written`、`refs: 无`。这证明本机交付完整性与首启，仍不能代替真实 Key、有线双机、目标机显示及安装签名验证。

Windows 上传阻断的恢复调研：GitHub 官方 [Actions 计费文档](https://docs.github.com/en/billing/concepts/product-billing/github-actions)说明私仓 artifact 与 Packages 共用账户存储配额，删除会降低当前存储，用量页面可能 6–12 小时才更新；[移除 artifact 文档](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts)说明远端删除不可恢复。[Releases 文档](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)说明 release asset 与 Actions artifact 是另一种分发机制、单文件上限 2 GiB。按五个已知 run 的 API 查询，本仓至少有五个未过期 Windows artifacts，合计 2,355,368,266 B；这不是全仓分页总量。最早的 `mochi-windows-x64-34499038039` / id `10161661281` 506,073,404 B，将于 2026-09-24 16:11:59 UTC 自动过期；本地 `release/2026-09-10/Mochi-Setup-0.1.0-win-x64.exe` 是对应 508,762,732 B EXE，SHA256 `bb8cf012116e79ae4a94639bbd8777236cc0be800a3a79796250437607953c1c`，另有两个同内容副本。run `34728914066` 和 `35412334064` 有等大小 ZIP 备份；`34700819338` 与 `35423708830` 的本地同名 ZIP 大小不符，不能视作完整备份。不能安全枚举私仓全部 artifacts（本机 `gh` 未登录，连接器仅能按已知 run 查询），单件到期也不能保证足够上传新版。等待配额实际恢复、私有草稿 Release 或经明确同意删除有备份旧 artifact 的选择待定；不把新 Windows EXE 写为可下载。

## 2026-09-24 · 托盘隐藏后的提醒、Mac 关闭主窗与动效因果（实施前）

先搜完整应用与生态：`site:github.com open source Electron desktop app tray hide show notification queue unread restore popup`、`site:github.com Electron app notification center tray show queued alerts desktop open source`，核对 [gitify-app/electron-menubar](https://github.com/gitify-app/electron-menubar)（HEAD `8ad6c739f96371295fcc5ce317ee36c46586f15d`，BSD-2-Clause，未归档，2026-09-21 仍有 push），其 `hideOnClose` 和窗口复用是现成机制。再搜组件/平台：`site:github.com electron electron BrowserWindow showInactive hide show notification pending queue visibility`，核对 [Electron BrowserWindow](https://github.com/electron/electron/blob/main/docs/api/browser-window.md) 的 `showInactive`、`hide` 与可见状态。桌宠完整框架 OpenPet/Motion 的提交、许可和维护情况已在上方本日条目核对。本轮 GitHub 搜索和公开 API 读取成功；`electron-menubar` 的依赖闭包与 Mochi Electron 39.8.10 未安装验证，因此不移植其窗口管理。Mochi 已有自己的 rail 弹窗队列、托盘开关与六态 SVG；替换框架会增加窗口生命周期和打包维护面，决定仅复用当前窗口/队列机制，不复制外部代码或素材。

只读控制流确认：`rail.ts` 隐藏时销毁弹窗但保留队列，重新显示只恢复常驻条；队首不变时后续提醒也不会弹。`main.ts` 的主窗 close 仅在 Windows+托盘时隐藏，macOS 销毁已认证页面却保留桌宠；LAN→rail 快照仅由该页面推送，背景提醒会停止。`rail-pages.ts` 在待办数非零期间每五秒持续摇动，无法表达“刚收到新请求”。拟让隐藏/显示语义保持队列可达、Mac 主窗关闭时保留页面刷新能力，并把警示动效绑定新事件一次性触发；具体交互以真实 Electron 回归确认。维护成本限现有三个模块与回归，不新增框架。学校 Windows 合成/托盘和教师长期使用下的注意力效果仍需现场检验。

接入后已验证：显式隐藏期间弹窗队列保留且 renderer `sync` 不会偷开弹窗，重新显示弹出队首、顺序和回执动作不重复；`test:rail-logic` 150 项通过。桌宠积压待办使用安静的呼吸与角标，新待办 ID 或可见 50 行之外的待处理总数增加时只触发一次 680ms 提醒。真实 Electron 对首帧积压、新到达、超出行上限和降低动效做了计算样式/动作测试，`test:rail-runtime` 通过。Mac 主窗 close 由销毁改为隐藏并保留认证页，`ready-to-show` 避免程序化关闭竞态；主窗的 `backgroundThrottling:false` 使隐藏时 3 秒 LAN 轮询继续，Windows 托盘隐藏同样受益，但隐藏窗持续绘制会增加功耗。真实 Electron 主进程脚本验证 close→同页计时器继续→显式 Quit 退出；无 GUI 的 Dock/第二实例重开暂未实测。Electron 官方 [BrowserWindow 文档](https://www.electronjs.org/docs/latest/api/browser-window)确认后台节流默认打开，关闭后隐藏页可见性与帧处理会改变。

## 2026-09-24 · 短码搜索不得阻塞教学状态刷新（实施前）

先搜完整应用：`site:github.com localsend localsend Flutter discovery timeout concurrent peers`、`site:github.com PairDrop PairDrop local network discovery pairing code browser`，核对 [LocalSend](https://github.com/localsend/localsend) 的 v1.18.0（Apache-2.0、维护情况见本记录前文）和 [PairDrop](https://github.com/PairDrop-nearby/PairDrop)（HEAD `eb88698f801f7da3632a81b309f23393106284ed`，GPL-3.0，未归档，2026-02-09 有 push）。PairDrop 的六位码通过常驻服务器与可选 TURN 跨网搜索，不能把它的“输入码即可跨 VLAN”承诺移植到纯本地 UDP。再搜组件：`site:github.com electron local network discovery pairing code async timeout abort controller`、`site:github.com nodejs undici AbortSignal timeout fetch concurrent connections`，核对 [Undici](https://github.com/nodejs/undici) 的现有 fetch/AbortSignal 行为。搜索成功；未安装 PairDrop/LocalSend，也未检验其依赖与协议兼容，所以不复制代码或改用服务器。现有八路并发和签名探测应保留，修的是页面把长搜索串进三秒状态轮询，以及缺整体搜索时限，避免静默停更。学校真实 UDP/TCP/VLAN 策略仍是部署前提，不能用本机协议测试替代。

接入后已验证：页面将短码查找从状态轮询的 await 链拆出，挂起查码时下一轮 LAN 状态照常完成，且同一查码不并发重复发起；35 项客户端测试通过。服务端查找限制为 12 秒、最多 8 路并行，未查到的候选在下一轮轮转到前面；45ms 故障夹具实测搜索结束与轮转后半候选，签名候选检查仍在原路径。短码只针对 UDP 已发现的候选，校园跨 VLAN 仍需学校网络信息。

## 2026-09-24 · 发件箱容量与待回复预约保留（实施前）

先搜完整消息应用及生态：`site:github.com localsend localsend message delivery queue persistence outbox limit retry`、`site:github.com PairDrop-nearby PairDrop message queue offline delivery outbox`、`site:github.com element-hq element-desktop matrix js sdk local echo pending event outbox retry transaction id`、`site:github.com signalapp Signal-Desktop message outbox retry delivery receipt storage retention`；再搜实现部件：`site:github.com matrix-org matrix-js-sdk pending event queue retry remove sent events transactionId`、`site:github.com electron secure local network messaging durable outbox retention pending delivery`。检索和公开 API 读取成功。核对 [LocalSend](https://github.com/localsend/localsend) `e768240d1ad95f0f162b852b5ff37bec71cde1ef`（Apache-2.0，未归档，2026-09-24 push）和 [Matrix JS SDK](https://github.com/matrix-org/matrix-js-sdk) `b8f2f6d6a24a9b8e71b00892fe82dd52ea24e413`（Apache-2.0，未归档，2026-09-23 push）；前者是局域网文件发送，后者的待发消息、失败重试与事务 ID 依赖完整 Matrix 客户端/服务端协议。`element-hq/element-desktop` 仓库当前 API 显示 AGPL-3.0 且已归档，不能当作活跃集成路径。两套依赖与 Mochi 现有签名收发协议不兼容，未安装、不复制代码；沿用现有持久化与签名信封，收紧容量回收策略和测试。

本地源码已确认：发件每新增一条便用 `trimMap(..., 1000)` 无条件回收旧行，可能回收 `PENDING`/`UNKNOWN`、尚未获答复的教室请求，甚至教师回复；收件答复验证依赖原请求仍在发件箱，教师端防重复回复也遍历发件箱。这比“仅影响历史展示”严重。设计取舍：先保证活跃请求、未确定投递和答复关系不被静默删除；如无法安全回收，应给出明确容量错误，不能伪称发送成功。长期开销是上限后需有可解释的归档/回收路径；学校实际消息量及保留年限未取得，不能假定 1000 条足够。接入后须用低上限夹具验证待发、已送未答复、答复去重和容量错误，不仅看纯通知。

接入后已验证：发件箱仅回收已投递 ACK、同时已有签名已看到回执、且无文件/处置/预约/回复关联的普通通知；请求、回复、非终态行保留。无安全项返回 `MESSAGE_LIMIT`，事务副本不落盘；旧版超限状态按 `createdAt` 和消息 ID 确定顺序回收。低上限双端实收发测试含同 ID 重试、关联回复及防重复回复，`test-limits.mjs` 通过；浏览器将容量错误显示为明确的投递未完成。此策略不解决 1000 条长期关联请求/回复后的容量耗尽，也不提供无限期的幂等历史；归档必须保留足够的请求验证与回复去重索引，不能仅删正文。长期存储期限与学校真实量尚未确认。

## 2026-09-24 · 课件真实字号质量门槛（实施前）

先搜完整可编辑课件应用：`site:github.com open source AI presentation generator editable pptx visual review quality gates Presenton PPTAgent`、`site:github.com pptxgenjs presentation generator editable pptx render inspect fonts shapes`，再搜质量组件：`site:github.com presentation pptx automated render review screenshot image hash quality validation`。核对 [Presenton](https://github.com/presenton/presenton) `768894c4655c6c6fd6ed4cf69501cc502a2c0b41`（Apache-2.0，未归档，2026-09-22 push）和 [PPTAgent](https://github.com/icip-cas/PPTAgent) `833cda553b343be0e486a93b0b57cac962cdd566`（MIT，未归档，2026-09-21 push）。两者均有完整课件流水线及视觉复核能力，但直接迁移会替换当前 PptxGenJS、OOXML 检查、DeepSeek 工具路由并引入额外服务或模型；依赖闭包与目标机 WPS 兼容未验证，因此本次不接入或复制其代码。采用当前已装 PptxGenJS 和自有 OOXML 检查链，增强现有质量门槛，维护面限解析器、质量报告和定向回归。

本地已确认 `textBodySummary` 取所有字号候选的最大值，且 `createQualityReport` 明说最大值达标不代表每个文字 run 达标。拟按段落默认及有实际文字的 run 计算可确定的最小有效字号，继续保留“无法确定”的诚实状态；不能把空段落结束样式当成可见文字。视觉审美和学科事实依然需要看渲染页，不因字号门槛通过而宣称已验收。实施后须用人为混合字号的 PPTX 夹具证明较小文字会被发现，并验证既有课件不会误报。

接入后已验证：检查器按可见 run、段落默认及对应列表级默认解析有效字号，保留原最大字号用于角色推定；不把空 `endParaRPr` 当作可见文字。报告分别列出可确定最小值和因主题/母版继承而未知的 run 数；已知 7pt 混入正常字号时阻止课件发布，现有课件生成、inspect 回归仍通过。`quality.test.mjs` 1 项、`inspect.test.mjs` 9 项及仓库 `npm run check` 均通过。结构合格仍保持视觉复核未进行，目标机 WPS/PowerPoint 未验收。

本轮统一交付复核：桌面 TypeScript 构建、rail 模型 258 项/逻辑 150 项、真实 Electron rail 与隐藏主窗保活、LAN 全套双端及容量回归、资源 25 插件装配和安装器配置通过。macOS arm64 无密钥 DMG 为 733,415,601 B，SHA256 `f93c1509cbe5e118805931b4391dc4d72397104aefd2cf6abd5608f06aad53dc`；边车、镜像、挂载包五项浏览器资源/仅非密钥设置种子/25 插件、八处源码字节匹配与复制应用冒烟通过。Windows 本地快照清单 525 项 / 92,435,967 B 校验零差异；新版未生成可下载 Windows EXE，旧 CI 因 Actions artifact 配额失败且源版本更早。七页水循环样例预览后来已全部逐页查看，观察与文件 hash 见 `docs/evidence/ppt-quality-2026-09-24/visual-review.md`；这份人工记录不替代目标机或学科审稿，也未改变生成器自动报告的 `not-performed` 状态。

## 2026-09-24 · 对话内真实 LAN 配对工具调用回归（实施前）

先查完整应用/生态：`GitHub open source classroom chat app teacher student classroom assistant pairing Electron LAN`、`GitHub open source AI classroom assistant app chat tool calling plugin framework`、`GitHub Electron LAN pairing authentication QR code open source app`；再查工具调用测试：`GitHub model tool call testing framework plugin protocol fake tool server`。网页搜索成功；补查匿名 GitHub API 时若干外部项目返回 HTTP 403，因此未声称锁定那些项目的提交。完整应用：[ClassroomLM](https://github.com/TechAtNYU/ClassroomLM) 为未锁定的 main 网页快照，README 显示 Next.js/RAG 教室聊天，页面未返回许可证和准确 SHA，故不采用；[Rumi](https://github.com/Orenda-Project/rumi-platform) 的 main 网页快照显示 Apache-2.0、316 commits、2026-09-24 检索时仍有近期提交，依赖 WhatsApp/Supabase/模型服务，渠道与 Mochi 桌面 LAN 不同，不迁入；[Crosslink](https://github.com/jacobpowaza/crosslink) 的 main 网页快照显示 Apache-2.0、近两周仍更新，含 Electron Chat 示例、Node/Browser SDK 和独立配对传输，未获得不可变 SHA/包版本；Mochi 已有签名 LAN 协议，另接一套传输会增加身份、会话和打包维护面，不采用。[toolcallcheck](https://github.com/goutamadwant/toolcallcheck) main 网页快照（近一周更新，MIT；未显示 release/SHA）以 Python/pytest Mock MCP server 和 FakeModel 断言离线轨迹；它不执行本机 DSH/Electron 工具及人工确认流程，不增加跨语言测试依赖。实际采用本仓已有 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 组件：本机 `@deepseek-ai/dsh-llm-deepseek`、`@deepseek-ai/dsh-client-ui-approval` 均为 `0.1.3-alpha.1` / MIT；已核安装 adapter 对 OpenAI-compatible SSE `delta.tool_calls`、参数增量和 `finish_reason: tool_calls` 的处理，以及审批 UI 的“允许一次”响应。新增回归只用 Node 内置 HTTP、现有 DSH 与 `mochi-lan` 插件；不增加依赖，测试模型不访问付费供应商。其真实 Electron 流程由合成网关脚本化返回配对工具调用，真实 DSH 运行时请求老师批准，再由第二个真实 `MochiLanService` 验证并持久化签名待配对请求；这证明教师自然语言入口可以完成已批准的“发起配对”，不冒称教室端已另行接受或双端配对完成。

接入后验证：`npm run test:chat-lan-live-ui`（含桌面 TypeScript build）通过。隔离 Electron 中输入自然语言后，真实 DSH 向本地合成 SSE 网关发出配对工具调用，页面显示目标教室与指纹，点击“允许一次”后模型收到 `pending` 工具结果；真实教室 LAN 服务将已签名请求持久化，教师侧认证路由返回同一身份指纹。凭据仅为临时合成值且未回显；测试断言教室仍须接受请求，因此不代表两端已完成配对。`npm run typecheck` 与 `git diff --check` 通过；无新增依赖。

## 2026-09-24 · 私有 Windows 安装包的存储兜底（实施前）

先查完整 Actions 发布生态：`site:github.com actions release workflow toolkit draft release artifact uploader GitHub CLI open source`、`site:github.com actions upload artifact license`；再查具体命令与配额：`site:cli.github.com/manual/gh_release_create --draft --target assets`、`site:docs.github.com actions artifact storage quota exceeded release assets`。核对已用的 [actions/upload-artifact](https://github.com/actions/upload-artifact)（工作流固定提交 `ea165f8d65b6e75b540449e92b4886f43607fa02`，MIT）和 [cli/cli](https://github.com/cli/cli)（MIT，GitHub 托管 Windows runner 预装 `gh`，实际镜像版本随每周更新，不能声称本地锁定）。另查 [GitHub Releases 官方命令](https://cli.github.com/manual/gh_release_create) 与 [Actions step outcome](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)：草稿可指定当前 commit、上传文件；`continue-on-error` 后可按原始 `outcome` 判断失败。未引入第三方 Release action 或新的 npm 依赖，避免另一条供应链和维护面。

已确认旧私有 CI run `35957828187` 通过 Windows 安装器构建，却因 Actions artifact 配额满在上传时失败，run 中无可下载新 EXE。沿用现有固定提交的上传 action；仅在其失败后用预装 `gh` 将 EXE 与 SHA256 边车放入**同一私有仓库的草稿 Release**，标签带 run id/attempt，目标锁定本次源码 commit，并核对两个资源名称。GitHub 官方 [Releases 配额说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)列出每个资源须小于 2 GiB；实际 Windows EXE 大小和草稿上传仍需本轮 CI 核验。工作流因此需要 `contents: write`，令整个 job 的令牌权限增加；前面的 checkout 禁止持久化凭据，只有仓库隐私检查与兜底步骤显式传 `GH_TOKEN`。后续可在 artifact 配额恢复或拆出隔离发布任务时收回写权限。

接入前本地校验：YAML 解析、结构断言和 `git diff --check` 通过；远端候选树中仅 `.github/workflows/windows-native-package.yml` 与精确 `mochi-source` 变化，538 个清单源码加清单自身共 539 个 blob 与本地 `git hash-object` 逐项一致，未出现额外文件。首次私有 Windows [run 36010945444](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36010945444) 在 `npm ci` 失败：我把本地模板覆盖到私仓，遗漏私仓旧工作流中已经过旧 run 验证的 `python -m pip install setuptools`、插件 junction 和发布输入暂存步骤；runner 选中 Python 3.12.10，`node-gyp` 9.4.1 在 `fs-ext` 内导入 `distutils` 时报错。此失误由日志确认，不归因于产品源码。

修复依据：从私仓旧提交 `eddc7ea3a1b3cc237867755be57a68761fba2d93` 逐字节取回工作流（Git blob `ae3d0d8a3adb5e78a4312536e43b8361e1df3818`）；旧 [run 35957828187](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/35957828187) 用同一 `setuptools` 补丁通过 `fs-ext` 安装。上游 [node-gyp issue #2869](https://github.com/nodejs/node-gyp/issues/2869) 与 [setuptools `_distutils_hack`](https://github.com/pypa/setuptools/blob/main/_distutils_hack/__init__.py)解释 Python 3.12 的兼容机制；本轮沿用已验证补丁，不升级 node-gyp 或额外引入 `setup-python`。在旧工作流上仅叠加语音测试、私有草稿兜底及按 [D-009](DECISIONS.md#d-009--当前发行包不预置模型密钥) 的 `--without-key-seeds`；后者移除可选的密钥种子环境注入。`git diff` 已确认其余旧 Windows 专用步骤完整保留。第二次 [run 36012662277](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36012662277) 最终成功：原生依赖、`test:voice-call`、`test:voice-pack`、资源和 NSIS 打包均过；Actions 附件上传仍因存储配额失败，草稿 Release 兜底成功。私有 [草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-854ccb9713f986a7decd) 锁定源码提交 `0d4f5b5f760efee1145fa914d4627c8b082d054c`，资源元数据显示 EXE 为 465,056,177 B、SHA256 `3cab42b7aaceb058cd4414e2ee0c7603c8b5019dadc6038044a9b319cc80a9fc`，另有 `.sha256` 边车。尚未下载 EXE 核对边车文本或在真实 Windows 教室机安装、试听语音，因此只把这次记录为原生 CI 出包与私有存放成功。

## 2026-09-24 · 预约对话实链与可选语音原生验收（实施前）

先查完整应用/生态：`site:github.com open source classroom assistant teacher student appointment messaging Electron local network app`、`site:github.com open source desktop assistant natural language tool calling approval UI end to end tests Electron`、`site:github.com open source Windows offline Chinese text to speech automatic model download desktop app`，查看 [Parrot](https://github.com/rishiskhare/parrot) 的当日 `main` 网页快照（MIT、仓库页面显示 41 commits；Tauri/Rust、Kokoro 首次下载、中文声线和播放叠层）与 [Syllavox](https://github.com/Ruben-Crespo-Blanco/syllavox) v1.0.0 网页快照（MIT、Windows 安装包、可选 Sherpa/Piper 语音目录、模型另有授权）。再查部件：`site:github.com/deepseek-ai/deepseek-harness tool calling approval ui tests streaming SSE`、`site:github.com sherpa-onnx Windows Kokoro zh model download extraction verification security`，读取 [DSH 审批文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md)、[DSH 测试文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/testing.md)与 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 仓库页面（Apache-2.0；本项目资源固定 v1.13.8）。GitHub 网页检索成功；匿名 GitHub API 提交端点与本机 `git ls-remote` 均不可达，未锁这轮外部仓库 SHA，不能把网页所述功能称作已适配。

采用本机已安装的 `@deepseek-ai/dsh-llm-deepseek` 和 `@deepseek-ai/dsh-client-ui-approval` 0.1.3-alpha.1（两者本机包为 MIT），以及 Playwright 1.55.0（Apache-2.0）验证原有 Electron 对话、真实工具审批与已签名 LAN 状态；Windows 语音沿用已固定的 sherpa-onnx v1.13.8 资源与现有校验下载器。Parrot/Syllavox 都是独立应用，接入会带来第二套播放、模型状态与更新路径；本轮不复制源码或素材，亦未完成其依赖闭包兼容性测试。维护成本限于现有运行路径与验收脚本；独立模型网关可验证工具接线，但不能验证真实模型的语义准确率。真实 Windows 语音合成可以在 CI 检查 WAV 结构，扬声器听感仍须现场检查。

接入后验证：`test:chat-appointment-live-ui` 在两份隔离 Electron/DSH 中，经脚本化 SSE 模型、真实人工审批和真实 Mochi LAN 签名服务走通学生预约、投递确认、教师按原请求确认和教室显示决定；真实模型语义与学校双机网络未据此推定。语音下载器新增管理员本地归档导入，离线与在线均沿用固定大小、SHA-256、归档路径和安装后文件校验；合成入口与原生 Windows 静音冒烟共用相同 CLI 参数和 WAV 校验。Mac 上 WAV 结构校验夹具测试、离线导入/损坏回退测试及桌面 TypeScript 检查通过，未在 Mac 执行 Windows CLI；`npm run check` 全仓通过。私有 Windows 原生 [run 36022637374](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36022637374) 已收到精确 541 项源码快照，却在首次 `tar.exe -tjf` 达到 180 秒上限后失败；下载过固定哈希归档，但未生成 WAV 或 EXE。修复与新 run 见下节，学校扬声器听感始终需要人工试听。Mac DMG 从镜像复制后教师/教室双角色启动均通过；这不证明 Windows 语音可用。

## 2026-09-25 · Windows 语音归档解包器路径（实施前）

私有 [run 36022637374](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36022637374) 在下载并通过大小/SHA256 校验后，调用 `tar.exe -tjf C:\Users\...\runtime.tar.bz2` 恰于当前 180 秒超时处失败；CI 没打印实际命中的可执行路径。先查完整 Windows 打包生态与 runner 镜像问题：`site:github.com/actions/runner-images "C:\Program Files\Git\usr\bin" "PATH" Windows2022`、`site:github.com open source Windows desktop app tar.bz2 extraction system tar Git Bash path`；再查组件语义：`site:github.com/actions/runner-images/issues/480 tar Windows PATH`、`GNU tar manual --force-local remote archive colon official`、`site:learn.microsoft.com windows tar.exe bsdtar libarchive bzip2`。GitHub 官方 [runner-images #480](https://github.com/actions/runner-images/issues/480)（2020-02-28）记录了 Git 自带 tar 抢先于系统 tar、将 Windows 盘符误作远程归档的真实故障；[runner-images #8803](https://github.com/actions/runner-images/issues/8803)另记录 Windows-2022 镜像的 Git 目录 PATH 前置问题。[GNU tar 手册](https://www.gnu.org/software/tar/manual/tar.html)说明带冒号的归档名可能被解释成远程设备。[Microsoft Windows tar 文档](https://learn.microsoft.com/en-us/windows/tar/)说明系统自带实现基于 libarchive/bsdtar，[libarchive 源码](https://github.com/libarchive/libarchive/blob/master/tar/bsdtar.c)将 `-j` 对应 bzip2。以上历史来源不能证明本次 runner 也选中了 Git tar。本次 runner 日志已确认 Windows Server 2022 镜像 `20260913.307.1`，但实际 tar 路径**未验证**。

采用 Windows 系统已有的 `System32\tar.exe` 绝对路径，继续复用固定哈希的 sherpa/Kokoro 归档与原校验链；不引入 7-Zip 或第二套二进制依赖。[ruby/ruby-builder 的 windows-2022 工作流](https://github.com/ruby/ruby-builder/blob/master/.github/workflows/build.yml)也采用系统 tar 绝对路径，作为实践旁证，不是本次故障归因证据。维护成本是依赖 Windows 自带 tar（Mochi 已限定现代 Windows/Electron 运行环境），并在原生 CI 明示 PATH 候选与系统 tar 版本。保留 180 秒阈值先验证正确实现；若系统 tar 仍超时，再根据原生日志决定是否调整，不能仅凭当前证据把阈值加大当作根因修复。

接入后阶段结果：生产 `runTar` 改用由 `SystemRoot` 定位的 `System32\tar.exe`，回归验证两个不同 Windows 系统盘和相对路径拒绝；CI 在运行原生合成前列出 PATH 中的 tar 候选、系统 tar 路径及其版本。本机桌面 build、语音包夹具测试、安装器契约与 `git diff --check` 通过，Windows 精确清单 541 项 / 92,985,176 B 零差异。私有修复提交 `819ac8df3e678d3ed16f69e1b8734a2e265b1e2c` 触发 [run 36024973225](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36024973225)；在该阶段记录时仍待 run 结果，后续失败及最终成功结果见下一节。

## 2026-09-25 · Windows BZip2 解包复用再评估（实施前）

私有 [run 36024973225](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36024973225) 已完成并再次失败：PATH 第一项和生产调用均为 `C:\Windows\System32\tar.exe`，版本为 bsdtar/libarchive 3.8.4，`--version` 没列出 `bz2lib`，某次 `.tar.bz2` 列表操作在 180 秒超时。代码并行列出 17 MB 引擎与 147 MB 模型归档，因此**日志不能判定是哪一份超时**；PATH 争抢假设已被证伪，缺少 `bz2lib` 是归因线索而非本机已复现结论。该 run 未生成真实 WAV 或新 EXE。

先查完整应用/发布生态：`site:github.com open source Windows desktop app tar.bz2 extraction system tar Git Bash path`、`site:github.com open source Windows offline Chinese text to speech automatic model download desktop app`，复核 [Parrot](https://github.com/rishiskhare/parrot) 和 [Syllavox](https://github.com/Ruben-Crespo-Blanco/syllavox)（前节列明版本/许可及拒绝整体迁入理由），并逐项检查 [sherpa-onnx v1.13.8 正式发布](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8)：所需 `win-x64-shared-MD-MinSizeRel` 为 17,324,649 B、SHA256 `416011…24f95` 的 `.tar.bz2`，没有同版 Windows ZIP 可直接替换。再查组件：`Windows System32 tar.exe bsdtar 3.8.4 zlib cng libb2 no bz2lib bzip2 -j hang`、`site:github.com/libarchive/libarchive archive_read_support_filter_bzip2 external program bzip2`、`site:7-zip.org 7za.exe bzip2 tar supported formats command line 7za`、`site:github.com/develar/7zip-bin license 7za.exe Windows x64 5.2.0`。[libarchive v3.8.4 BZip2 读入源码](https://github.com/libarchive/libarchive/blob/v3.8.4/libarchive/archive_read_support_filter_bzip2.c)明确：未链接 bzlib 时会调用外部 `bzip2 -d`；[Microsoft tar 文档](https://learn.microsoft.com/en-us/windows/tar/)列举内建支持格式但未承诺本机 BZip2 库。现有桌面依赖闭包已经安装 [develar/7zip-bin](https://github.com/develar/7zip-bin) 5.2.0，内有 Windows x64 `7za.exe` 21.07、1.2 MB；其包装包是 MIT，但**二进制自身按 [7-Zip 许可](https://www.7-zip.org/license.txt)采用 LGPL 且分发时必须随附许可说明**。本机同包 macOS `7za` 已用真实小 `.tar.bz2` 验证 `e -so` 可输出普通 tar；不能代替 Windows 原生验证。

完整归档管理器另查 [PeaZip](https://github.com/peazip/PeaZip) v11.2.0 / `b3778d6`（LGPL-3.0，支持 BZip2/TAR，但 GUI 与后端栈不适合作为单包安装器依赖）；上游 [7-Zip](https://github.com/ip7z/7zip) v26.03 / `0766b73`（2026-09-04，README 确认独立 `7za.exe` 支持 BZip2/TAR）更新较新。比较 [ollm/7zip-bin-full](https://github.com/ollm/7zip-bin-full) npm 26.3.1（MIT 包装、7-Zip 26.03 二进制）：npm 元数据给出解包后约 79,969,265 B、压缩包约 37.4 MiB，Windows x64 路径是 `7z.exe` 加 `7z.dll`；它是等待原项目合并的临时 fork，本机下载超时，没完成具体二进制与依赖兼容验证。因此本轮**不采用** fork；当前固定哈希归档降低旧解压器接触任意输入的面，但 7-Zip 21.07 已过时，是以后需升级的维护风险。

拟部分采用现有 `7zip-bin`：显式锁依赖，只在 Windows 安装器随附经哈希校验的 1,231,360 B 解压器与 7-Zip 许可；先把固定 SHA256 的 BZip2 流解成暂存 tar，再用 Windows 系统 tar 列表校验路径并提取。继续复用当前下载、离线导入、路径检查和原子安装，不带 164 MB 模型进主包。理由：系统 tar 缺少 bzlib 时依赖 PATH 上未知的 `bzip2`，学校电脑不能保证；现有 `7za.exe` 是独立可执行文件，主包增量可控。维护成本是跟踪 7za 版本与许可、补原生 Windows CLI 验收；尚未证明这能在目标 runner 完成或满足真实学校网络与扬声器。

接入后阶段结果：`7zip-bin` 5.2.0 已显式固定为桌面构建依赖，Windows 专用 `extraResources` 仅复制哈希为 `b0cfdeaf429f5cc53f85123dd8f5a5feb92c19d31aa34df257edf9a26be05f95` 的 x64 `7za.exe` 和官方许可；运行时再验可执行文件哈希。两份已校验 BZip2 归档各自转换到最多 1 GiB 的暂存 tar，系统 tar 仅处理未压缩 tar；解包、列清单和提取的并行任务失败时会等另一份结束再清暂存，错误与成功计时均标明归档种类。Mac arm64 上同包 `7za` 的小型真实 BZip2→TAR 字节往返、`test:voice-pack`、`test:installer-config`、根 `npm run check`、快照校验及 `git diff --check` 均通过。Windows 精确快照 542 项 / 92,999,792 B 零差异；候选树 543 个 `mochi-source` blob 与清单完全对应，无额外文件。私有提交 `436c4478015a9cc0a99457122dd3cd88e99cdf80` 的 [run 36030805114](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36030805114) 已验证 Windows 原生解包、Kokoro 合成及 18,044 B WAV，之后 NSIS 安装器构建成功。runtime/model 的 BZip2→TAR 分别耗时 1,755/5,270 ms；tar 列表 44/39 ms、提取 783/999 ms。Actions artifact 上传因存储配额失败，安装器和 sidecar 已保存至[私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-04f57c067c3bb2e26cab)。该 Windows CI 结果验证了 runner 中的解包和合成，不替代学校电脑上的安装、网络和扬声器验收；7-Zip 21.07 的版本与 LGPL 许可维护项仍需跟踪。

## 2026-09-25 · 课件表格投影尺寸（实施前）

先查完整应用/引擎，实际词：`site:github.com open source JavaScript PowerPoint slide generation editable table layout framework PptxGenJS`、`open source pptx generation layout engine tables fit slide native editable`。查看 [Presenton](https://github.com/presenton/presenton) 与 [PPTAgent](https://github.com/icip-cas/PPTAgent) 的网页主分支；本轮未锁两者提交、许可证与依赖闭包，因此不宣称适配，也不迁入新的 PPT 生成系统。再查组件：`PptxGenJS rowH h`、`site:github.com/gitbrent/PptxGenJS rowH array addTable h row height`，查看 [PptxGenJS v4.0.1](https://github.com/gitbrent/PptxGenJS/tree/v4.0.1) 提交 `3c9ec1b687c174952166f6a34b5e87ebf69fa469` 与[官方表格 API](https://gitbrent.github.io/PptxGenJS/docs/api-tables.html)。本机安装并已在课件链使用 `pptxgenjs` 4.0.1 / MIT：`rowH` 可指定每行高度，省略时 `h` 平分各行。已有原生可编辑表格，采用现有库的行高与布局计算；接入新引擎会扩大课件兼容和打包维护面。已确认四行表格在 4.47 英寸内容区只占 1.52 英寸，视觉验收记录指出投影过小；修复后须以 OOXML 尺寸和逐页渲染复核，不能只数行数。

接入后验证：四行样例表格高 3.28 英寸，每行至多 0.82 英寸；左右单元格内边距 0.12 英寸，上下 0.06 英寸。内边距单位与上右下左顺序再以[上游 v4.0.1 类型定义](https://github.com/gitbrent/PptxGenJS/blob/v4.0.1/src/core-interfaces.ts)核对。OOXML 回归核对稀疏表和含较长中文的九行压力表的行高、全部 27 格边距与文本。七页样例重新生成并渲染；本轮人工再次查看第 4 页 PNG，横向留白改善、未见裁切或页脚遮挡，其他六页 PNG 与改前逐字节一致。PowerPoint/WPS 字体替换与真实投影尚未验证。

## 2026-09-25 · 桌宠侧栏弹簧动效（实施前）

先查完整应用，实际词：`open source Electron desktop pet animated panel window spring resize`、`site:github.com electron desktop pet animated panel window spring resize`。核对 [OpenPet](https://github.com/dengyie/OpenPet) HEAD `aec45f537d8056fb9e2c8c309a132f788321566a`（MIT，网页显示未归档且仍在维护；README 明示 Windows 尚非正式验收目标），以及 [DeskCat](https://github.com/xircons/deskcat) HEAD `917a47627d94aec59dc63f24c6f6118eb068ba66`（代码 MIT，图像 CC BY-NC 4.0；Electron 宠物、主进程窗体和自建物理引擎）。再查组件：`Electron BrowserWindow setBounds animate Windows macOS only`、`site:github.com/motiondivision/motion spring animate React`，核对 [Electron BrowserWindow API](https://github.com/electron/electron/blob/main/docs/api/browser-window.md) 与 [Motion](https://github.com/motiondivision/motion) HEAD `33f6e72d17ebd3e23a2bfb53f3d4c36ce7c11343` / MIT。Electron 的 `setBounds` 平台动画参数只适用 macOS；Motion 面向 DOM，不驱动此处 Windows 原生窗体。现有 Mochi 使用 Electron 39.8.10 和独立 rail 窗，保持现有视觉资源与窗口结构，在主进程加入可反向、保留速度的弹簧；不迁入另一套桌宠状态机、非商用素材或新运行依赖。维护成本限现有边界动画和其测试；目标 Windows 的帧率及显示缩放仍须实机检验。

接入后验证：Windows/Linux 双轴临界阻尼边界弹簧以 0.4 秒响应为参数，不使用固定结束时间；反向时承接当前速度，右边缘保持锚定。系统减弱动效立即切换，macOS 保留原生边界动画。纯几何测试与真实 Electron 运行时覆盖快速反向首帧、右缘、降低动效；`test:rail-logic` 171 项、`test:rail-model` 267 项与 `test:rail-runtime` 通过。Windows 目标机调度、DPI 和主观手感尚未验证。

## 2026-09-25 · 安装包双角色启动门禁（实施前）

先查完整打包/验收生态，实际词：`site:github.com electron-builder unpacked directory package Windows nsis smoke test`、`site:github.com/microsoft/vscode test smoke packaged app Windows Electron`，查看 [electron-builder](https://github.com/electron-userland/electron-builder) HEAD `fcbb136d79641152b5c4a291abecabe668f7885c` 与[CLI 文档](https://github.com/electron-userland/electron-builder/blob/master/website/docs/cli.md)，以及 [VS Code smoke 套件](https://github.com/microsoft/vscode/blob/eb1f2bba7cfa39fe356f40c116e7614dcb160b3b/test/smoke/README.md)。本机锁定 electron-builder 25.1.8 / MIT；VS Code 开源烟测仅作为完整应用的实践参考，不移植测试框架或依赖。再查组件级打包输出/启动参数。Mochi 已有 `win-unpacked` 和 `smoke-packaged.cjs`，部分采用已有启动脚本，以退出码、成功标记和角色分开验证，并在私有 Windows CI 中核对仅有无密钥设置种子。维护成本是 CI 需要真正启动两次 Electron，失败时应据 runner 日志诊断；本机 Mac 运行不能代表 Windows 原生运行。

阶段验证：现有 macOS 包通过新版脚本的教师（12.6 秒）和教室（1.9 秒）独立启动，均 exit 0 并输出成功标记；零输出但 exit 0 的 `/usr/bin/true` 被脚本正确拒绝。`test:installer-config`、`test:package-resources` 及 workflow YAML 解析通过。Windows CI 新门禁尚未在原生 runner 执行，不能把 Mac 冒烟视为 Windows 安装成功。

新版 Mac DMG 随同当前源码重建后，SHA256 sidecar、`hdiutil verify`、镜像中 asar 主进程/rail/弹簧模块以及课件/MiMo 插件的字节比对均通过；唯一种子为非密钥设置默认值。从镜像复制出的应用教师 13.1 秒、教室 1.9 秒均 exit 0 且出现成功标记。Windows 候选树只变动 10 个批准源码文件、manifest 和 CI workflow，`mochi-source` 545 个 blob 恰与 544 项清单加清单自身相符；源码提交 `40c43eedbb26d8192e6957765e6e4bd0c2c337dd` 触发[原生 run 36038536562](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36038536562)。该 run 的构建、原生 Kokoro 合成和 NSIS 均成功，但启动门禁在启动前读取了私有快照中不存在的源码设置种子路径，导致失败且未留下 EXE，作为失败历史保留。仅修改 CI workflow 的后继提交 `8cb898724052fab1f610662c4ba15202f9afb969` 的 [run 36040854416](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36040854416) 随后通过原生 Kokoro、NSIS、包内唯一无密钥设置种子核对以及 packaged teacher/classroom 启动；均在约 7.5 秒 / 5.1 秒内输出 `MOCHI_DESKTOP_SMOKE_OK`。Actions artifact 上传受配额阻止，EXE 与 95 B `.sha256` 已保存至[私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-742f6e959f9eb8598c2e)；Release API 核实 draft=true、target_commitish 为 `8cb898724052fab1f610662c4ba15202f9afb969`，EXE 465,475,789 B / SHA256 `4641fb7eb82401129c67aff418dddd05d4abe52ba1353c2511244c23cb0f3a87`。该成功候选早于本轮配对修复，最终候选与学校 Windows 实机验收仍待完成。

## 2026-09-25 · MiMo 403 错误归因（实施前）

先查完整产品/框架，实际词：`OpenAI compatible API gateway client error handling 403 quota 401 provider SDK TypeScript application`、`open-webui/open-webui 403 API key error OpenAI compatible`、`deepseek-ai/deepseek-harness httpErrorCode status 403`。查看 [Open WebUI](https://github.com/open-webui/open-webui) 当前主分支文档对 OpenAI-compatible 连接 400/401/403 的说明；它的多许可证和品牌条款、服务端依赖与 Mochi 不同，仅参考诊断语义，不迁入。查看 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与本机实际安装的 `@deepseek-ai/dsh-llm-deepseek` 0.1.3-alpha.1 / MIT：当前 MiMo 走此适配器的 OpenAI-compatible chat/completions 路由，适配器把所有 403 都映射 `AUTH`，客户端进而显示固定 Key 错误。再查组件，实际词：`openai/openai-node 403 PermissionDeniedError`，核对 [openai-node](https://github.com/openai/openai-node) v7.23.0 / MIT 的 401 认证与 403 权限分级。保持 DSH 接线和现有版本，仅在 MiMo 专属适配器处理可辨的 403，普通 403 不宣称 Key 已错；不增加 SDK。维护成本是跟踪上游适配器错误类型及供应商错误载荷，需以 401/403 实际流错误回归证明，不把模拟响应等同于真实付费 Key 验证。

接入后验证：MiMo 专属适配器保留 401 的 `AUTH`，403 只有供应商载荷明确显示余额/额度或权限时才分级；一般 Forbidden 显示“原因待确认”，不会触发 DSH 客户端固定“API 密钥无效”分支。测试用本地伪网关跑实际流请求，并核对共享 DeepSeek 适配器行为未变；桌面 `test:runtime-profile` 已串起该回归并通过。真实 MiMo Key、供应商各类 403 原文和学校网络尚未验证；在本轮 GitHub 连接中断时未能取得 Open WebUI 与 Harness 的最新 HEAD，复用结论只以已核本机版本及公开页面为界。

## 2026-09-25 · 聊天短码等待稍后上线教室（实施前）

先查完整应用和插件生态，实际搜索：`site:github.com open source LAN classroom device pairing discovery PIN code QR automatic retry app`、`site:github.com open source local network device pairing discovery confirmation code app framework ecosystem`、`site:github.com/deepseek-ai/deepseek-harness plugin tools ecosystem @deepseek-ai/dsh-tools`。查看 [LocalSend](https://github.com/localsend/localsend) HEAD `e768240d1ad95f0f162b852b5ff37bec71cde1ef`（GitHub API 许可 Apache-2.0，未归档，2026-09-24 有更新；独立 LAN 文件传输应用）与 [Syncthing](https://github.com/syncthing/syncthing) HEAD `94c3c1cdef718d568686620cbff268eeaaf2c87d`（MPL-2.0，未归档，2026-09-23 有更新；依靠持久公钥设备身份与发现），也查看 [Magic Wormhole](https://github.com/magic-wormhole/magic-wormhole) HEAD `cc6160670bf7faaab52ba307e3f8ba95e80529fe`（MIT，未归档，2026-09-23 有更新；短码连接依赖 rendezvous/mailbox 服务）。这些完整产品提供邻近发现或短码体验参考，但协议和信任模型均不同；不迁入代码，也不声称短码可跨 VLAN 定位。

再查现成组件：`site:github.com/localsend/localsend pairing device discovery PIN confirmation code`、`site:github.com/syncthing/syncthing device discovery address changes rate limit retry discovery source`、`site:github.com Node.js cancellable discovery polling AbortSignal p-retry interval backoff package MIT`。另检查 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools) HEAD `477b4f420553e8a52c2fbccc464d7561b239c443`（MIT、未归档、2026-09-24 有更新）及其 [工具 API 文档](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/core/tools/README.md)；当前安装的 `@deepseek-ai/dsh-tools` 是 `0.1.3-alpha.1` / MIT，`exec.signal` 支持协作式取消。`p-retry` 只检索为候选，未锁定本次可复用版本及完整依赖许可，不采用，也不增加运行依赖。

部分采用现有 Mochi 发现信标、同校/班级筛选、身份指纹探测与工具 AbortSignal；聊天短码最多等待 30 秒，按发现事件重查，单候选最多有限重试；只有当前所有可发现候选都已核查后才可带单一匹配提前返回。若 deadline 到时仍有候选未核查，返回未核查数；未指定设备 ID 的聊天工具不会把部分结果当唯一目标。同一 HMAC codeTag 同时只允许一个搜索任务，重复调用立即拒绝，并在取消或完成后清除记录。仅在教室用自身身份密钥签名明确错误码并通过 nonce、学校身份和公钥核验后，才把该码/设备组合写入本进程的随机密钥 HMAC 负缓存；缓存最长不超过两分钟，未签名错误、超时和不可达都不缓存。外部服务的固定超时及人工确认机制不由轮询框架替换。维护面限现有 LAN 协议和服务测试；若两端 IP 无路由，配对码、手动地址都不能替代网络路径。

接入后验证：`node plugins/mochi-lan/test/test-pair-code-search.mjs` 8 项通过，覆盖原单次搜索的 8 路并行/候选轮转、稍后发现匹配、并发同码单飞与取消清理、已签名错码限制缓存、未签名错误不得污染缓存、慢速同码候选未核查诊断及不可达候选；`node plugins/mochi-lan/test-chat-tools.mjs` 14 项通过，验证未核查时须指定设备 ID、使用等待结束时的发现状态并保留 IPv4/端口回退。完整 `npm --prefix plugins/mochi-lan test` 通过。上述是本机回环进程测试，不是校园网络或跨 VLAN 现场验收；教室设备是否稍后加入当前可发现网络仍取决于 UDP 广播/组播与路由条件。

## 2026-09-25 · Windows 安装后双角色启动门禁（实施前）

先查完整应用与构建生态，实际词：`site:github.com electron Windows NSIS installer integration test install smoke GitHub Actions app`、`site:github.com electron-builder nsis test installed app Windows workflow smoke`、`site:github.com/microsoft/vscode Windows installer smoke test NSIS application CI`。查看 [VS Code 完整桌面验收](https://github.com/microsoft/vscode/wiki/Sanity-Check)：Windows installer 与 archive 分别安装、启动；仓库 HEAD `4c29d23c72bcd961b2f96a3364685f589a925eda`，MIT、未归档，2026-09-24 仍推送。查看 [electron-builder](https://github.com/electron-userland/electron-builder) HEAD `1266b2b97cf7287f790e2770d05cb57370d3d559`，MIT、未归档、2026-09-24 有推送；本机锁定 `electron-builder` 25.1.8 / MIT，当前 Windows 已使用 NSIS。完整应用只借鉴“安装后再启动”的验收层级，不迁移 VS Code 测试栈或另换 Squirrel/Forge 安装生态。

再查部件，实际词：`site:github.com/electron-userland/electron-builder NSIS silent install /S /D perMachine install tests`、`site:electron.build nsis silent install /S /D installationDirectory electron-builder`、`site:github.com NSIS installer CI PowerShell silent install electron-builder test app`。核对 [electron-builder NSIS 配置](https://www.electron.build/v26/docs/nsis/)与本机 25.1.8 的 `multiUser.nsh`：Mochi 配置 `oneClick:false`、`perMachine:false`，可用 `/currentuser` 指定用户安装；脚本接受 `/D=` 覆写目录。[NSIS 官方命令行说明](https://nsis.sourceforge.io/Docs/Chapter3.html)规定 `/S` 静默与 `/D=` 路径。上游 [#7946](https://github.com/electron-userland/electron-builder/issues/7946) 报告旧版 `/D=` 路径含空格解析风险，因此 CI 使用无空格临时路径并验证生成的 `Mochi.exe`，不能只看安装器退出码。复用项目现有 `smoke-packaged.cjs`，无需新依赖；额外成本是 CI 在 NSIS 构建后再安装一次、启动两个隔离角色，学校机器防火墙、权限和 UI 体验仍要现场验收。

## 2026-09-25 · 旧会话切换模型后取用已存密钥（实施前）

先查完整 AI 聊天应用及宿主框架，实际词：`site:github.com open source AI chat desktop app existing conversation switch model API key UI test`、`site:github.com/deepseek-ai/deepseek-harness session model switch credentials e2e tests`、`site:github.com/open-webui/open-webui switch model existing chat provider credentials tests`。查看 [Open WebUI](https://github.com/open-webui/open-webui) HEAD `8bd8b4fac5e059578ac0c74b3c18d11139f88b7d`，GitHub 许可证元数据为 `NOASSERTION`、未归档、2026-09-24 有更新；其[旧会话模型选择回归报告](https://github.com/open-webui/open-webui/issues/26346)说明只测新会话不能证明旧会话选择持久。该产品和许可条件与 Mochi 不同，不复制代码。查看 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) HEAD `477b4f420553e8a52c2fbccc464d7561b239c443`，MIT、未归档、2026-09-24 有更新；本机 `@deepseek-ai/dsh-credentials-local` 为 `0.1.3-alpha.1` / MIT，[凭据组件文档](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/credentials/README.md)说明同一凭据引用每次请求重新解析、运行环境变量优先于文件。采用现有 DSH 会话模型菜单、凭据解析器和本项目合成网关的真实 Electron 回归；不新增模型 SDK 或测试框架。维护面限测试用例；若回归揭示运行缺陷，再修改最小接线。合成 Bearer 只证明发给所选本机假网关，不能替代真实账户验收。

## 2026-09-25 · 自然语言课件聊天接线回归（实施前）

先查完整应用/框架，实际词：`site:github.com/presenton/presenton open source AI presentation generator natural language pptx templates images`、`site:github.com/icip-cas/PPTAgent natural language PPT generation agent slides evaluation`。查看 [Presenton](https://github.com/presenton/presenton) HEAD `768894c4655c6c6fd6ed4cf69501cc502a2c0b41`（Apache-2.0、未归档、2026-09-24 有推送；从 prompt/文档生成可编辑 PPTX，带模板）与 [PPTAgent](https://github.com/icip-cas/PPTAgent) HEAD `833cda553b343be0e486a93b0b57cac962cdd566`（MIT、未归档、2026-09-21 有推送；参考课件分析、结构规划和迭代编辑）。再查组件，实际词：`site:github.com/gitbrent/PptxGenJS addImage image options examples`；[PptxGenJS](https://github.com/gitbrent/PptxGenJS) HEAD `3c9ec1b687c174952166f6a34b5e87ebf69fa469`（MIT、未归档；本机锁定 4.0.1/MIT）支持可编辑 PPTX 的原生内容与图片。Mochi 当前已有 PptxGenJS 管线、结构门禁与预览，迁入另一个完整生成器会扩大会话、模板和打包维护面；本轮继续部分采用现有管线，先用隔离教师会话的合成模型补“自然语言消息→工具调用→文件/预览”接线证据。现有结构化工具测试不能证明真实模型能稳定构思或保证学科正确，合成模型测试也只能证明该条受控路径；图片与教师模板仍是当前工具契约的已知能力边界。

接入后验证：`test-presentation-chat-live-ui.mjs` 在隔离教师 Electron 页面里从一条未给逐页结构的自然语言请求出发，经过原生工作模式审批，合成 SSE 调用 `mochi_ppt_create`，实际生成 3 页 PPTX 与 PDF；随后真实 `ppt_inspect` 回读 3 页，课件卡打开 PDF iframe。fixture Key 未回显，脚本退出 0。这只证明该受控请求的聊天、审批、工具和预览接线；合成模型预设了工具参数，不能证明真实模型能独立规划优质课件或保证学科事实。生成管线的七页视觉样例与多课题审稿边界仍按上方课件记录。

## 2026-09-25 · 课件回读的系统路径别名（实施前）

完整课件应用与生成器的检索、版本及不迁移理由见紧邻上一节。本项继续检查组件/宿主，实际词：`site:github.com/nodejs/node realpath symlink path containment security allowlist`、`site:github.com/OWASP path traversal symlink realpath allowlist Node.js`。查看 [Node.js 安全边界说明](https://github.com/nodejs/node/blob/main/SECURITY.md)（仓库 HEAD `4eb3908d1f237e9dfdf09111540d2a7ede48f8c9`，GitHub 许可证元数据 `NOASSERTION`，未归档、2026-09-24 有推送；这里只参考 `realpath` 对受允路径别名的语义，不复制代码）及 [OWASP Node.js 安全清单](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Nodejs_Security_Cheat_Sheet.md) 对符号链接越界的提醒。现有 Mochi 课件根白名单和真实路径检查继续保留；仅在字面路径不匹配时，对**已存在的候选文件**取真实路径，再核对它仍在已批准真实根内。这样 `/var/folders` 与 `/private/var/folders` 两种拼法指向同一文件时能回读，向根外逃逸的符号链接仍拒绝。维护面仅一处分支与现有安全测试，无新增依赖；目录被并发替换的通用文件系统竞态不由此变更解决。

接入后验证：安全回归先在旧代码重现 `PATH_ESCAPE`，然后通过；同一测试仍断言根外绝对路径、`..` 与指向根外的符号链接拒绝。真实课件聊天回归后续也完成了同一隔离路径下的 PPTX 回读与 PDF 预览。

## 2026-09-25 · 本轮接入后证据与界面复核

- 旧会话模型：真实隔离 Electron 教师、教室页面分别用 A 模型与 A fixture Key 发请求，保存 MiMo B Key 后，在**同一旧会话**切到 MiMo 发请求；本机网关核对 B Bearer 与模型 ID，重开原会话仍选择 B。两份 `test-*-model-live-ui.mjs` 均通过，复用现有 DSH 凭据/模型菜单，没有运行代码修改。合成网关不能验证真实供应商账号或余额。
- 桌宠与公示板：`test:rail-runtime` 加入真实 Electron 的 Enter/Space 键盘操作并通过；2026-09-25 当轮折叠、展开、名单顶部和溢出位置的截图已保存于 `docs/evidence/`，逐张目视检查静态内容、层级和可读性。弹簧响应、模糊玻璃在 Windows 桌面背景上的实际合成仍须目标机复核。没有为动画引入新的框架或依赖，继续使用项目现有的 Apple 弹簧/降低动效实现。
- Windows 安装测试的工作流已加 NSIS 静默安装、非密钥种子核对以及安装目录内教师/教室启动；原 `win-unpacked` 启动门禁保留，以便区分打包和安装故障。[原生 run 36059879685](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36059879685) 首次验证安装目录双角色启动；当时包含模型页修复的 [run 36062403850](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36062403850) 再次通过，安装目录教师端 6.4 秒、教室端 6.1 秒启动，均输出 `MOCHI_DESKTOP_SMOKE_OK`。私有草稿 Release 的 EXE 资产哈希和提交目标已核对；学校真实网络/权限/扬声器不由 CI 代替。

## 2026-09-25 · 模型页空闲重复请求（实施前）

先查完整应用及框架，实际搜索 `site:github.com/deepseek-ai/deepseek-harness settings models credentials describe refresh loop websocket issue`、`site:github.com/open-webui/open-webui models settings credentials refresh infinite request loop`、`site:github.com electron AI chat app settings models credential polling loop websocket refresh`。Mochi 当前复用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 已锁定 `0.1.3-alpha.1` / MIT，上游检索基线 HEAD `477b4f420553e8a52c2fbccc464d7561b239c443`，当时未归档且近期有更新；[Open WebUI](https://github.com/open-webui/open-webui) 检索基线 HEAD `8bd8b4fac5e059578ac0c74b3c18d11139f88b7d`，许可证元数据 `NOASSERTION`、未归档。两者是完整模型设置产品参考；已有 DSH 运行时和凭据存储，另迁 UI 或后台会增加两套设置状态的维护成本。

再查组件，实际搜索 `site:github.com/deepseek-ai/deepseek-harness "credentials.describe" "settings.describe" loop`、`site:github.com/deepseek-ai/deepseek-harness "settings.models.provider-card" refresh`、`site:github.com/deepseek-ai/deepseek-harness models store load describe credentials`、`site:github.com/facebook/react useEffect infinite render loop unstable dependency issue`。核对 [DSH 模型设置组件说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-settings-models/README.md)、[凭据子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/credentials/README.md)与 [React issue #19991](https://github.com/facebook/react/issues/19991) 的对象依赖导致重复 effect 的已知形态；这些资料用于定位，不能代替本项目的调用栈证据。本机全新隔离 Electron 页面在打开模型设置后不操作 30 秒，CDP 数到 `/api/settings/describe` 8,316 次、`/api/credentials/describe` 8,320 次；同期间仅一条 `/api/remote.mux` WebSocket 且没有重连。实际根因在 Mochi MiMo 卡：Cordis 的 `ctx.remote` getter 每次生成新的代理，卡片 effect 把它作为依赖，又把每轮新建的默认模型对象写进状态，造成重渲染后无限重读。复用现有组件，只把 effect 依赖改为稳定的 `ctx`，effect 内捕获一次 remote；不增加缓存框架。

接入后验证：确定性 hook 回归模拟每次读取 `ctx.remote` 都是新代理，并验证初始只读一对、一次真实更新事件只再读一对，插件测试 16/16 通过。修复后同类隔离 Electron 页面打开 Models 后静置 30 秒，两类描述请求增量均为 **0**（初始累计 settings 6、credentials 10）；DeepSeek/MiMo 输入仍可见。两端旧会话切换 MiMo 并读取新存 Key 的真实 Electron 回归再次通过。此证据只覆盖本机运行路径，不证明学校网络或真实供应商账号。

## 2026-09-25 · 课件教学计划与质量覆盖（实施前）

先查完整应用/框架，实际搜索 `GitHub open source AI teaching lesson slides PowerPoint app natural language editable PPT 2026 Presenton PPTAgent`、`site:github.com open source lesson plan generator learning objectives formative assessment presentation slides structured schema`、`site:github.com educational slide generator lesson objectives student activities assessment open source`。核对 [Presenton](https://github.com/presenton/presenton) HEAD `768894c4655c6c6fd6ed4cf69501cc502a2c0b41` / Apache-2.0（2026-09-24 推送，提示词生成可编辑 PPTX 和大纲）、[PPTAgent](https://github.com/icip-cas/PPTAgent) HEAD `833cda553b343be0e486a93b0b57cac962cdd566` / MIT（2026-09-21 推送，逐页功能类型、内容/设计/连贯性评估）。本项目已采用 PptxGenJS 4.0.1 / MIT，迁入新的整套生成器会增加模板、文件和模型编排的维护面；两项目理念可部分借鉴，但其 README 不等于 Mochi 适配证据。

再查组件/插件，实际搜索 `site:github.com/icip-cas/PPTAgent slide presentation content planning outline evaluation pedagogical learning objectives`、`site:github.com/presenton/presenton presentation outline slide content schema quality validation`、`site:github.com/deepseek-ai/deepseek-harness dsh-k12-lesson-builder`。查看 [dsh-k12-lesson-builder](https://github.com/shyboy/dsh-k12-lesson-builder) HEAD `7fd5963491f2f986385f38cfa4ebda56319c04da` / 0.1.1 / MIT（2026-08-14 推送）：其蓝图把目标、学生活动、评价与幻灯片 ID 关联，并重开输出文件审计。但它只支持初中英语，要求 Windows 10/11、PowerShell 7、桌面 Microsoft Word/PowerPoint 和 Office COM，不支持 macOS 或 WPS；peer 依赖 DSH `^0.1.0-rc.6`，本项目安装 `0.1.3-alpha.1`，不能直接宣称兼容。因此**部分采用蓝图关联和结构审计思路，不接入插件代码或 Office COM**。另看 [Claw-ED 主仓](https://github.com/SirhanMacx/Claw-ED)（2026-09-19 推送、MIT、未归档）与 [Lumen](https://github.com/tihado/lumen) HEAD `d08282095f56b77cb954aa29d16064bbf3c374ec`（2026-05-17 后未推送、GitHub 许可证元数据为空）：两者展示“目标→活动→检查”结构，但一个是 Python 教学套件，一个依赖多外部服务且许可未确认，均不适合整包迁入。搜索结果最初命中的 `epaproditus/claw-ed` 是旧 fork，转而核对了原主仓。

拟在现有 `mochi_ppt_create` 的**内部工具参数**加入可选、可审计的教学计划与逐页目标关联，质量报告区分“有声明并有页映射”“声明缺口”“未提供计划”。教师仍只需自然语言发消息，不增加输入表单。它能检查结构性覆盖，不能由元数据证明实际教学成效或学科事实；修订旧课件需保留计划并重新报告。维护成本是 schema、修订兼容及测试，范围限制在现有课件插件。

接入后验证：`mochi_ppt_create` 可接收可选目标、页面角色、学生行动与理解检查声明，产物 manifest 报告 `not-declared` / `incomplete` / `mapped`；封面与章节未映射只作信息提示。改动已有教学页的可见内容后，旧映射保留并标记待复核，教师在聊天中复核并传入新计划后清除标记。`npm test --prefix plugins/mochi-presentations` 38/38 通过；隔离教师 Electron 的合成 SSE 模型经工作模式审批产出三页 PPTX、回读及预览，报告 `mapped` 且封面未映射。该测试证明工具接线与声明检查，不证明真实模型理解任意课程、事实正确或教学效果。未接入上述第三方插件代码，实际依赖闭包保持原样。

## 2026-09-25 · 对话/工作共享工具声明前缀（实施前）

先查完整宿主/插件生态，实际搜索 `GitHub open source AI coding agent prompt cache stable tools prefix DeepSeek Harness Yan agent`、`site:github.com/deepseek-ai/deepseek-harness tool schema order prefix cache mode`，核对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) HEAD `477b4f420553e8a52c2fbccc464d7561b239c443` / MIT（本机依赖 `0.1.3-alpha.1`）、[Yan-Zero/dsh-progressive-tools](https://github.com/Yan-Zero/dsh-progressive-tools) HEAD `23f4253e81a38fee1e56e9853c93b1ae1fa6a21d` / 0.2.3 / Apache-2.0（2026-08-14 推送）。Yan 插件靠渐进发现工具稳定顶层声明，但 peer 依赖 `^0.1.0-rc.6` 不兼容本机版本，还包装 pi-ai 的 `streamSimple` 内部对象；目前不直接安装或移植。

再查部件，实际搜索 `site:github.com/deepseek-ai/deepseek-harness "system-prompt/assemble" "tools"`、`site:github.com/deepseek-ai/deepseek-harness tool schema order prefix cache mode`、`site:github.com/Yan-Zero/dsh-progressive-tools stable tools prefix cache`，核对 [DSH 官方 system-prompt 包说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/README.md)：`system-prompt/assemble` 提供本次调用**已按作用域过滤**的工具声明，并允许调整模型可见顺序；`toolOrder` 也是原生配置功能。Mochi 教师/教室共用宿主配置，但注册工具集合不同，静态 `toolOrder` 列出另一角色未注册的名字会受上游校验限制。拟部分采用现有 waterfall：只把本次 assembly 里已存在、且属于对话工具集合的声明按固定顺序前置，其余声明按上游原次序跟在后面；不新增、不隐藏、不包装工具，也不改变 `restrict`、审批或执行路径。这样可核对聊天与工作请求的**共享 schema 前缀**，不能保证供应商一定复用缓存；system 消息与各网关缓存策略也须单独测。维护成本是一处公开扩展点、模式测试与真实请求形状回归；若上游工具声明接口变动，必须 fail-safe 保留原列表并重测。

接入后验证：`mochi-modes` 只对 `system-prompt/assemble` 已返回的 schemas 做稳定重排，作用域限制与直接工具调用仍由 DSH 原路径处理；异常时保留原 assembly。模式插件 20/20 测试覆盖同一 agent 的前缀、工作工具后缀原序、审批与限制失败降级。教师端真实 Electron→DSH→本机脚本化模型网关的课件聊天回归进一步比对聊天请求与获批后工作请求：共享工具名及实际发送的完整 tool JSON 哈希逐项一致且在工作请求最前面，课件生成仍仅在获批后出现，三页 PPTX 经回读和预览。开发插件依赖路径后来连续三次遇到 `WEB_HOST_TIMEOUT`；改用本轮已核对的 Mac 包插件/依赖资源路径后 16.6 秒通过，原因尚未隔离。根 `npm run check` 通过（Biome 既有 warning 未作为失败）。此证据不包含真实供应商缓存读数、费用或学校 Key；完整请求仍可能因系统消息或其他工具而不同，不能宣称达成缓存命中率目标。

## 2026-09-25 · LAN 自定义发现端口配置入口（实施前）

先查完整应用/生态，实际搜索 `site:github.com syncthing open source LAN discovery UDP broadcast port configuration application`、`site:github.com local send open source LAN discovery UDP port config desktop`。复核 [Syncthing](https://github.com/syncthing/syncthing) 的已查版本 HEAD `94c3c1cdef718d568686620cbff268eeaaf2c87d` / MPL-2.0 和 [LocalSend v1.18.0](https://github.com/localsend/localsend/releases/tag/v1.18.0) / Apache-2.0，具体维护/不迁入协议理由见本文件前面的 LAN 条目。[Syncthing 网络说明](https://github.com/syncthing/syncthing/blob/main/man/syncthing-networking.7)明确 UDP 发现端口与防火墙/子网广播条件。再查部件，实际搜索 `site:github.com nodejs dgram UDP bind port configuration interface broadcast test`，并核对本项目 `mochi-lan` 插件入口和服务构造器的现有参数接线。当前入口在 `config.discoveryPort` 有值时展开未声明变量 `discoveryPort`，服务启动前即抛 `ReferenceError`；桌面默认配置不设置该值，因此不能把此缺陷扩大描述为默认端口失效。拟只修参数转发并以真实插件 `apply` 回归验证，不引入新协议/依赖；维护影响限非默认端口部署，学校防火墙与 VLAN 仍需现场确认。

接入后验证：插件入口现传入 `config.discoveryPort`；新回归实际启动服务并检查 UDP socket 绑定到指定随机端口，再检查未指定端口时仍取既有默认值、两种情况都能停止。`node plugins/mochi-lan/test/test-plugin-apply.mjs` 与插件全套 `npm test --prefix plugins/mochi-lan` 通过。尝试在本机向 `127.255.255.255` 发送广播虽成功，`0.0.0.0` 监听者未收到；因此没有把依赖具体网卡环境的定向广播用例伪装为稳定回归，也不宣称学校有线网络已验收。现有双进程 loopback 测试仍覆盖候选发现和六位码路径。

原生 Windows CI 首轮在新测试入口报 `ERR_MODULE_NOT_FOUND: @deepseek-ai/dsh-tools`，发生在加载 `mochi-lan/chat-tools.mjs` 时，配对码 8 项测试已过；这不是发现端口断言失败。私有精确快照故意不携带 `node_modules` 链接，Windows 工作流此前为其他插件重建了目录 junction，但漏了 `mochi-lan`。现把该插件的 `@deepseek-ai/dsh-tools` 加入必需链接，重跑后该测试在原生 Windows 上通过。

修复后精确快照重新核对 548 项 / 93,105,866 B，私有树 549 个 Mochi 文件与本地逐个 Git blob 相同，校园仓其他文件未变；[run 36071828792](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36071828792) 成功：配对码 8/8、自定义 UDP 端口、Kokoro 18,044 B WAV、NSIS、解包版及实际安装目录教师/教室启动均通过，四次启动均出现 `MOCHI_DESKTOP_SMOKE_OK`。Actions artifact 配额阻止上传，EXE 转存[私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-688eac561912c6cbbacd)，Release 资产元数据核实 465,483,615 B / SHA256 `2c793b3348cbf9fd87e464e0ca63f482be917ff80185b72fb81c79ea5b7d6a6f`，目标提交 `63eeafe3539a57e95dde80110b652e9a365de2cb`。前一失败 run 不能记作端口功能失败或成功；本轮原生 CI 仍不能代替学校有线/VLAN 现场测试。

## 2026-09-25 · 缓存验收缺失分母防误报（实施前）

先查完整宿主与插件生态，实际搜索 `GitHub open source AI coding agent prompt cache stable tools prefix DeepSeek Harness Yan agent`、`site:github.com/deepseek-ai/deepseek-harness "cacheReadTokens" "inputTokens" usage`，核对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) HEAD `477b4f420553e8a52c2fbccc464d7561b239c443` / MIT（本机锁定 `0.1.3-alpha.1`）和 [Yan-Zero/dsh-progressive-tools](https://github.com/Yan-Zero/dsh-progressive-tools) HEAD `23f4253e81a38fee1e56e9853c93b1ae1fa6a21d` / 0.2.3 / Apache-2.0（2026-08-14 推送）。后者能稳定渐进工具声明，但 peer 依赖 DSH `^0.1.0-rc.6` 不接受本机 alpha，且包装 pi-ai 内部模型接口；不为修计数器接入它。另一搜索命中 `wings1848/dsh-economizer` 的 GitHub 页面和原始文件均返回 404，未能核实版本/许可/依赖，不能称适配。

再查部件，实际搜索 `site:github.com/deepseek-ai/deepseek-harness "prompt_cache_hit_tokens" translate`、`site:github.com/Yan-Zero/dsh-progressive-tools "cache" "usage"`，核对 [DSH 官方 DeepSeek 适配器说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/README.md)：`cacheReadTokens` 是缓存读量，DSH 的 `inputTokens` 与之互斥。Mochi 验收脚本使用 `cacheRead / (input + cacheRead)`；若日志只给出 `cacheReadTokens` 而缺 `inputTokens`，当前代码把后者默认为零，会误报 100%。本项复用现有脚本/测试，不引入依赖；缺失或非法任一分桶应显示 n/a，稳态阈值不得通过。它只提高测量可信度，**不提高供应商缓存命中率**。真实供应商读数与聊天→工作 13→96 工具切换成本仍待实测。

接入后验证：缺失、负数、字符串和小数 `inputTokens` 搭配 80 个缓存读 token 的稳态测试均返回 n/a / 退出码 2，不再出现 100%；已有完整计数和多帧保护行为保持。运行 `node --test tools/test-verify-cache-hit.mjs`，5/5 通过。仍未用当前真实供应商会话做缓存 A/B。

## 2026-09-25 · 教学计划进入 PPTX 演讲者备注（实施前）

先查完整应用，实际搜索 `site:github.com open source AI teaching presentation generator editable pptx classroom app`、`site:github.com open source AI classroom assistant teacher student request notification appointment desktop app`。核对 [Project EDU](https://github.com/SaiAvinashPatoju/project-edu) HEAD `45cca0c9a4c1d7d9b6243668b26c810a00d4a6b1`（MIT、未归档、GitHub 显示 2026-04-05 最近推送）：本地模型、讲课音频转写、页内编辑与可编辑 PPTX，但主要是 Docker/Python/PostgreSQL/Redis 服务，迁入会给现有 Electron+JS 课件链增加运行栈与数据迁移。[AIPPT](https://github.com/LRriver/AIPPT) HEAD `e70fbfcde611cc619939d83a19c3226a8a674171`（Apache-2.0、未归档、2026-07-08 最近推送）支持大纲/逐页设计编辑和可编辑 PPTX，但它的图像重建与多模型工作台不同于 Mochi 已有原生图表、流程和局部修订；当前不迁入。更早核对的 Presenton/PPTAgent 版本、许可和维护情况见上文课件生态条目。

再查部件，实际搜索 `site:github.com/gitbrent/PptxGenJS speaker notes addNotes slide API examples`、`site:github.com PptxGenJS addNotes notes speaker slide editable PowerPoint`。复核 [PptxGenJS](https://github.com/gitbrent/PptxGenJS) HEAD `3c9ec1b687c174952166f6a34b5e87ebf69fa469`（MIT、未归档、GitHub 显示 2025-11-28 最近推送）的 [Slide.addNotes 实现](https://github.com/gitbrent/PptxGenJS/blob/3c9ec1b687c174952166f6a34b5e87ebf69fa469/src/slide.ts)；本机已安装的 `pptxgenjs@4.0.1` 也是 MIT，依赖 `@types/node`、`https`、`image-size` 和 `jszip`，课件生成器已用该版本写入逐页来源备注，且 `ppt_inspect` 已可回读真实 OOXML 备注。因此采用**现有依赖的既有备注 API**，不新增包或复制第三方实现。

现有 `teachingPlan` 只进入 source/quality 报告，老师打开 PPTX 时看不到逐页教学目标、学生行动和理解检查。拟按 slideId 将已声明字段写入对应页备注，并在沿用旧映射但可见内容已修订时明确标“待复核”；无计划的演示课件维持原来源备注。维护面限课件写入及回读回归，不改变投影可见页或把声明完整误称教学质量正确。需验证实际 PPTX 备注、修订后的待复核标记和不带计划时的兼容性；目标 WPS 的备注显示仍要现场验收。

接入后验证：`npm test --prefix plugins/mochi-presentations` 38/38 通过。真实生成的 7 页 [示例课件](evidence/ppt-teaching-notes-2026-09-25/README.md) 经 `inspectPresentationFile` 读取，第 2–7 页各自有目标、页面作用、学生行动、理解检查以及“未经独立核验”，封面仍只有来源备注；修改某页可见内容后，备注和报告都提示“教学映射待复核”，重新声明后清除，普通无计划演示的备注逐字兼容。新旧样例的 7 个 `ppt/slides/slideN.xml` 逐字节相同，说明此次未改投影页。用户目标 WPS 中打开备注仍未验证。

## 2026-09-25 · Windows 桌宠原生渲染证据（实施前）

先查完整桌宠应用，实际搜索 `site:github.com open source desktop pet task reminder electron translucent drawer animation`。核对 [DeskCat](https://github.com/ppxinyue/DeskCat) HEAD `d0462eb1ddddc8de01d36c9b8024289f0775bee9`（未归档、2026-05-27 最近推送）和 [desktopPet](https://github.com/kokoronoka/desktopPet) HEAD `9ee7815a7c2e973207d625c21c7a5e4182775ad3`（未归档、2026-08-04 最近推送）；GitHub 两仓的许可证元数据均为空，无法确认再分发权限，也没有与 Mochi 签名待办状态机兼容的证据，不迁入其代码或美术。Mochi 已有 Electron 39.8.10 的透明无边框 rail 和 `test-rail-runtime.mjs` 的真实窗口、点击、捕图测试，优先复用它。

再查部件，实际搜索 `site:github.com/electron/electron transparent BrowserWindow Windows DWM screenshot screen capture testing`、`site:github.com/electron/electron Windows DPI transparent BrowserWindow testing`。核对 [Electron BrowserWindow 文档](https://github.com/electron/electron/blob/main/docs/api/browser-window.md)及 [Windows 透明窗口黑底问题](https://github.com/electron/electron/issues/40515)：`transparent:true` 与 CSS 模糊不保证所有 GPU/DWM 组合都有预期桌面合成。拟在私有 Windows CI 直接运行现有 rail 测试并保留合成数据的窗口内容截图，不新增运行依赖；这可以验证 Windows Chromium 的结构/字体/窗口交互，但 `webContents.capturePage()` 只截应用内容，不能证明教室目标机桌面背景透出、125%/150% DPI、帧率或透明合成。维护面仅测试脚本和私有工作流；失败须与正式安装构建分开归因，不能把 CI 图当学校现场验收。

本机接线验证：`npm run test:rail-runtime --prefix apps/desktop` 通过；显式 `MOCHI_RAIL_SCREENSHOT_ROOT` 再运行，得到 76×76 折叠宠物、336×332 展开待办、336×472 教室板顶部和 336×472 名册溢出入口四张非空 PNG。脚本使用 Electron 包实际可执行路径，私有 Windows CI 将在构建后运行同一测试、核对四个文件名，并随 installer artifact 或草稿 Release 保存。该 Windows 步骤在新提交运行前仍属待验证；截图是合成 fixture 的窗口内容，实际 DWM 背景、DPI 与触感仍需现场确认。

## 2026-09-25 · 深色教室板滚动槽视觉修正（实施前）

先查完整桌宠应用/生态，实际词：`site:github.com open source Electron desktop pet dark panel todo scrolling app`、`site:github.com open source classroom desktop notification roster dark theme Electron app`。查看 [OpenPet](https://github.com/dengyie/OpenPet) HEAD `aec45f537d8056fb9e2c8c309a132f788321566a`（MIT、未归档、2026-09-11 推送），具有透明宠物窗和控制面板，但引入整套 React 控制中心会改变 Mochi 已有 rail 结构；不迁入。前述 DeskCat/desktopPet 的桌宠兼容性与资产许可结论仍适用。

再查现成部件，实际词：`site:github.com electron dark scroll panel CSS ::-webkit-scrollbar scrollbar-color transparent track`、`site:github.com/ppxinyue/DeskCat scrollbar dark panel css`、`site:github.com/dengyie/OpenPet scrollbar transparent dark css`。核对 [GoogleChrome modern-web-guidance 深色模式说明](https://github.com/GoogleChrome/modern-web-guidance/blob/22ab18dfb50a5d7e3bdcf471c14076a5534eae4e/skills/modern-web-guidance/guides/visual-design/dark-mode.md) HEAD `22ab18dfb50a5d7e3bdcf471c14076a5534eae4e`（Apache-2.0、未归档、2026-09-21 推送）：滚动条轨道、滑块应适配深色表面，macOS 自带叠加滚动条还有平台差异。也复核当前 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md) HEAD `477b4f420553e8a52c2fbccc464d7561b239c443`（MIT、未归档、2026-09-24 推送）记录的透明轨道与主题滑块经验；本机宿主已锁定 DSH alpha，不复制其样式或新增依赖。

人工复看本机 `classroom-board-overflow.png`：深绿板右侧出现约 14 px 的亮白滚动槽，是可见缺陷。拟只给 Mochi 自有 rail 可滚动区域指定深色配色、细滑块和透明轨道，保留键盘、鼠标滚动及内容溢出入口；不引入第三方 CSS。维护成本限单一内嵌样式文件，macOS、Windows 可能仍由系统合成呈现不同，需用真实 Electron 截图及原生 Windows 再验。

接入后验证：`MOCHI_RAIL_SCREENSHOT_ROOT=/tmp/mochi-rail-screenshots-scrollbar-20260925 npm run test:rail-runtime --prefix apps/desktop` 通过，原有 64 人名单滚动、末行入口、点击及窗口动作断言保持；人工看新的 `classroom-board-overflow.png`，右侧轨道与深绿板同色，细滑块仍可见，白色槽已消失。此为本机 Electron 内容截图；原生 Windows 截图及 DWM 合成仍待新快照 CI 和目标机验证。

## 2026-09-25 · Windows 原生侧栏可见性门禁（实施前）

先查完整应用/框架，实际词：`site:github.com/microsoft/vscode BrowserWindow showInactive isVisible electron window visibility`。核对 [VS Code](https://github.com/microsoft/vscode/tree/356cb805d65130fd938dcfec5f8fd0ae1ac12bd1/src/vs/platform/windows/electron-main) HEAD `356cb805d65130fd938dcfec5f8fd0ae1ac12bd1`（MIT、未归档、2026-09-25 推送）：成熟应用会根据窗口就绪状态安排原生窗口显示，但其主窗口生命周期与 Mochi 浮窗不同，不迁入实现。

再查组件/官方实现，实际词：`site:github.com/electron/electron/issues "headless" "BrowserWindow" "Windows"`、`Electron --headless flag BrowserWindow Windows native window headless CI`。核对 [Electron BrowserWindow 文档](https://github.com/electron/electron/blob/eb5095309f3d61fa5647b96baeeb019fcc497a72/docs/api/browser-window.md)、[Windows 原生窗口实现](https://github.com/electron/electron/blob/eb5095309f3d61fa5647b96baeeb019fcc497a72/shell/browser/native_window_views.cc) 和 [headless 测试讨论](https://github.com/electron/electron/issues/228)；Electron HEAD `eb5095309f3d61fa5647b96baeeb019fcc497a72`（MIT、未归档、2026-09-25 推送），本机锁定 39.8.10。Mochi 夹具启动时携带 `--headless`，却在 `setVisible(true)` 后同步断言 `BrowserWindow.isVisible()`；Windows CI 两轮（run 36079583446 与 36080159920）都在同一断言失败，前面的私有边界、快照、依赖闭包已通过。**推测**是无头参数与原生可见性目标冲突或窗口显示存在异步时序；尚无证据说明实际桌面侧栏功能失效，也不能因推测而删除可见性检查。

计划只调整现有测试夹具：原生窗口测试不带 `--headless`，首次显示用有限轮询等待，保留隐藏→不可见、重显→可见、真实 DOM 交互和四张 `capturePage()` 校验。复用本机 Electron 39，不增加依赖、不改 rail 产品实现；维护面仅测试脚本。若第三轮 Windows CI 仍失败，需要看下一处原生日志再判断，不把脚本通过等同 DWM 透明度或学校设备验收。

本机接入后：`MOCHI_RAIL_SCREENSHOT_ROOT=/tmp/mochi-rail-screenshots-window-gate-20260925 npm run test:rail-runtime --prefix apps/desktop` 通过，窗口显隐、截图和原有交互断言仍执行。Mac 通过只能证明改后的夹具没有本机回归；Windows 原生结论须等待新私有快照 run。

## 2026-09-25 · Windows 动效门禁显式媒体条件（实施前）

先查完整桌面应用/框架，实际词：`site:github.com/microsoft/vscode prefers-reduced-motion Electron`。查看 [VS Code](https://github.com/microsoft/vscode) HEAD `e1fd8efce147d9b426c72d91390e494c1d2e7e46`（MIT、未归档、2026-09-25 活跃）；其[减少动效讨论](https://github.com/microsoft/vscode/issues/145641)确认 OS 动效偏好会成为应用输入，也可有软件设置覆盖。只借鉴测试不能假定默认 OS 偏好的结论，不迁入其 UI 或配置体系。

再查框架部件，实际词：`site:github.com/electron/electron "Emulation.setEmulatedMedia"`、`site:github.com "Emulation.setEmulatedMedia" "prefers-reduced-motion" Electron test`、`official Electron webContents debugger CDP Emulation setEmulatedMedia`；随后核对 [Electron Debugger API](https://www.electronjs.org/docs/latest/api/debugger) 与 [Chrome DevTools Emulation.setEmulatedMedia](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/)。Electron HEAD `eb5095309f3d61fa5647b96baeeb019fcc497a72`（MIT、未归档、2026-09-25 活跃），本地锁定 39.8.10。现有 rail 夹具已经通过 `webContents.debugger` 控制媒体偏好，继续使用这个官方接口，不新增依赖、不复制外部代码。

run 36081027844 已越过窗口可见性门禁，但在老请求仍待处理的宠物呼吸断言失败：期望 `pet-breathe`，实际 `none`。源码 `prefers-reduced-motion:reduce` 明确把动画设为 `none!important`；**合理推测**是 runner 的 Chromium 当前媒体偏好为减少动效，失败日志没有 `matchMedia` 值，不能据此确认 Windows OS 的具体设置，也不能判定产品动画代码坏了。拟在首个动效断言前显式模拟 `no-preference` 并验证呼吸/告警动画，再显式模拟 `reduce` 并验证停止动画；最后恢复媒体设置。维护面只限测试夹具，确保 Windows CI 不依赖 runner 默认无障碍设置，同时真测两种产品分支。

接入后本机验证：`MOCHI_RAIL_SCREENSHOT_ROOT=/tmp/mochi-rail-screenshots-motion-20260925 npm run test:rail-runtime --prefix apps/desktop` 通过。夹具先经 CDP 显式切换 `no-preference` 并等待 `matchMedia` 与 `pet-breathe` 生效，再切换 `reduce` 检查四处动效均为 `none`，最后恢复 `no-preference` 并检查新请求只触发一次提醒；退出时清除 CDP 覆盖。四张合成内容截图均重新生成。此结果是 macOS 本机 Electron 验证，仍需 Windows 原生 run 才能判定跨平台门禁。

## 2026-09-25 · 教室板末行留白与未过关标签对比度（实施前）

先查完整桌宠应用，实际词：`site:github.com/dengyie/OpenPet desktop pet Electron dark task panel scroll design`。核对 [OpenPet](https://github.com/dengyie/OpenPet) HEAD `aec45f537d8056fb9e2c8c309a132f788321566a`（MIT、未归档、2026-09-11 推送；详见上文）：它有透明桌宠与控制面板，但迁入整套 React 面板不适合只修 Mochi 内嵌名单的局部留白与标签文字，不采用代码。

再查组件/主题生态，实际词：`site:github.com/microsoft/vscode terminal dark theme badge text color contrast accessibility`、`site:github.com/GoogleChrome/modern-web-guidance dark mode color contrast scrollbar content spacing`。核对 [VS Code 主题颜色表](https://github.com/Microsoft/vscode-docs/blob/main/api/references/theme-color.md)（既有主题为 badge 的前景与背景分别定义颜色）与 [Chrome 深色模式指南](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/visual-design/dark-mode.md)；Chrome 仓前述已查 HEAD `22ab18dfb50a5d7e3bdcf471c14076a5534eae4e`、Apache-2.0、未归档。只使用已有 CSS 变量与内嵌样式，不引依赖或复制第三方资产。

本机 64 人名单内容截图目测：最后一张“查看完整名单”卡片几乎贴住固定页脚；未过关标签的文字 `#f0b3aa` 在实际半透明底色与深绿行底色叠加后，理论对比约 4.28:1（按标准相对亮度公式计算，仍需截图/系统字体复查）。拟给名单滚动区末尾增加明确留白，并把该标签文字提亮到 `#ffd4ce`（相同底色理论约 5.67:1）；不会改变签名消息、滚动协议或卡片内容。维护成本是一处 CSS，风险是小窗口可视行数微减，需要真实 Electron 的 64 人滚动与底部可见性回归，以及 Windows 原生截图。当前 Windows run 36082588755 使用修复前页面，不能把其 UI 截图算作修复后证据。

接入后本机验证：仅增大 `.list` 底部内边距并提亮未过关标签；第一次截图仍紧贴页脚，是测试夹具用 `scrollIntoView({block:'end'})` 强制把卡片贴到视口底边，不是普通滚动的最大位置。夹具改为把滚动区滚到 `scrollHeight` 后，四张内容截图重新生成，最后卡片下方留出约 16 CSS px，标签理论对比约 5.67:1；`test:rail-runtime` 仍通过并验证第 50 行可见、点击可打开完整名单。此结论限本机 Electron 内容截图，Windows 原生截图、DWM 合成和目标机字体仍待复核。

## 2026-09-25 · Windows 无角标展开坐标门禁（实施前）

沿用本轮桌宠原生门禁的 GitHub 检索：完整应用实际词 `site:github.com/microsoft/vscode BrowserWindow showInactive isVisible electron window visibility`，核对 [VS Code](https://github.com/microsoft/vscode/tree/356cb805d65130fd938dcfec5f8fd0ae1ac12bd1/src/vs/platform/windows/electron-main) HEAD `356cb805d65130fd938dcfec5f8fd0ae1ac12bd1` / MIT；再查 Electron `site:github.com/electron/electron/issues "headless" "BrowserWindow" "Windows"`、`Electron --headless flag BrowserWindow Windows native window headless CI`，核对 [Electron BrowserWindow 文档](https://github.com/electron/electron/blob/eb5095309f3d61fa5647b96baeeb019fcc497a72/docs/api/browser-window.md) HEAD `eb5095309f3d61fa5647b96baeeb019fcc497a72` / MIT，本地锁定 39.8.10。原有 Electron 测试和同步入口已覆盖窗口尺寸、点击、DPI 基础路径；不引入 VS Code 窗口管理代码或额外依赖。

私有 Windows [run 36082588755](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36082588755) 已越过正常/减少动效断言，在“无角标时展开按钮仍位于原点击位置”处失败。日志只给断言文本，没有失败时的窗口宽度/按钮坐标。**合理推测**：前一高对比测试只等待页面 `aria-label` 显示“收起”，并未等待原生弹簧把窗口宽度重新扩到 336；随后无角标快照的 DOM 行数可先更新，按钮局部 x 坐标会随仍在移动的视口改变。无足够证据判定产品布局失效。拟保留 298 px 断言与物理点击检查，先等待原生宽度和渲染视口均为 336，再额外检查 `window.x + 按钮中心 x` 与原宠物屏幕位置一致。维护面限测试夹具，若仍失败需把坐标样本写到断言错误中定位真实布局问题。

本机接入后：上述原生/页面宽度等待和绝对坐标断言加入，`MOCHI_RAIL_SCREENSHOT_ROOT=/tmp/mochi-rail-screenshots-final4-20260925 npm run test:rail-runtime --prefix apps/desktop` 通过。私有 Windows [run 36085791656](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36085791656) 也越过此断言，后续另一个窗口位置保存断言失败；因此本项门禁在原生 Windows 已通过，但整个 rail 测试尚未通过。

## 2026-09-25 · Windows 位置记忆门禁等待特定保存事件（实施前）

先查成熟应用，实际词 `site:github.com/microsoft/vscode Electron BrowserWindow move event save window position`，参考 [VS Code](https://github.com/microsoft/vscode) HEAD `e1fd8efce147d9b426c72d91390e494c1d2e7e46`（MIT、活跃）；其窗口持久化体系远大于 Mochi 单个桌宠坐标，不迁入代码。再查组件实际词 `site:github.com/electron/electron BrowserWindow setPosition move event async Windows test`，核对 [Electron BaseWindow 文档](https://github.com/electron/electron/blob/main/docs/api/base-window.md)及 [BrowserWindow 文档](https://github.com/electron/electron/blob/main/docs/api/browser-window.md)，Electron 已查 HEAD `eb5095309f3d61fa5647b96baeeb019fcc497a72`（MIT、未归档），本地 39.8.10：`setPosition()` 改坐标，`move`/`moved` 是独立事件；不能用事件数组“非空”代表本次移动已写入。

Windows run 36085791656 报 `fixture.cjs:587` 的 `664 !== 624`；按夹具起始行回推到 `test-rail-runtime.mjs` 的位置保存断言：旧测试在调用 `setPosition(moved.x - 40, moved.y + 40)` 后只等 `saves.length > 0`，前面展开/收起产生的旧保存已使该条件成立。**已确认测试缺陷**是等待条件无法关联本次动作；**合理推测**是 Windows 的本次 `move`/保存事件尚未到达而读了旧记录，尚不能断言产品不保存。拟记录移动前数组长度，等待原生窗口达到目标坐标以及新保存条目包含这次目标坐标，再断言最后记录。维护成本仅一处测试时序；若限时内没有新目标保存，原生 CI 应明确失败而不是跳过产品承诺。

接入后本机验证：测试先记录保存数组长度，再等待原生 `getBounds()` 到指定坐标，以及新增保存记录中出现同一坐标，最后仍核对最后一条的 surface/x/y。`MOCHI_RAIL_SCREENSHOT_ROOT=/tmp/mochi-rail-screenshots-final5-20260925 npm run test:rail-runtime --prefix apps/desktop` 通过，原有 17 次位置落盘和四张合成截图仍产生。Windows 原生结论等候新 run；不把本机通过记作 Windows 通过。

## 2026-09-25 · Windows 拖动事件与程序定位的测试边界（实施前）

先查完整成熟桌宠应用，实际词 `site:github.com Electron desktop pet save window position move moved open source`、`site:github.com/alvinunreal/openpets "moved" "move" pet-window`，核对 [openpets](https://github.com/alvinunreal/openpets) HEAD `4d5d0dd393e18cbe983d5cfa1b32b7bf3b2b1ce9`（MIT、未归档、2026-09-24 推送）在 [pet-window.ts](https://github.com/alvinunreal/openpets/blob/4d5d0dd393e18cbe983d5cfa1b32b7bf3b2b1ce9/apps/desktop/src/pet-window.ts#L109-L118) 防抖监听 `move` 与 `moved` 来保存位置；其 Electron 依赖为 `^42.0.0`，不能直接移植应用或断言兼容本地 39.8.10。Mochi 只需用户手动拖动后的最终位置，保留现有 `moved` 保存，不为程序内部 `setPosition` 增加每帧写入。

再查组件/框架，实际词 `site:github.com/electron/electron BrowserWindow setPosition moved WM_EXITSIZEMOVE Windows`、`site:github.com/electron/electron "WM_EXITSIZEMOVE" "is_moving_"`。核对本地版本对应的 [Electron v39.8.10 源码提交](https://github.com/electron/electron/tree/d7c42ebd5cd501a0e6d9f009e232369832f92d69) / MIT：[setPosition→SetBounds](https://github.com/electron/electron/blob/d7c42ebd5cd501a0e6d9f009e232369832f92d69/shell/browser/native_window.cc#L275-L280)，Windows 的 `moved` 仅在 `WM_MOVING` 标志后的 `WM_EXITSIZEMOVE` [发出](https://github.com/electron/electron/blob/d7c42ebd5cd501a0e6d9f009e232369832f92d69/shell/browser/native_window_views_win.cc#L383-L417)，而程序定位只触发 `widget()->SetBounds`；[API 文档](https://github.com/electron/electron/blob/d7c42ebd5cd501a0e6d9f009e232369832f92d69/docs/api/browser-window.md#L433-L453)亦把手动移动事件与程序定位区分。未复制第三方代码或增加依赖。

Windows [run 36087830153](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36087830153) 已确认 `setPosition` 后原生坐标到目标，但没有本次 `moved` 记录；这是测试用程序定位模拟人工拖动的错误假设，**不是用户拖动失效的证据**。拟让夹具在检查真实 BrowserWindow 目标坐标后显式触发同一个 `moved` EventEmitter 事件，只验证 Mochi 事件处理器会保存当前坐标；运行结果必须标注“合成事件”，不得宣称原生 Windows 人工拖动已测。真实人工拖动与 DPI/多屏仍待目标机或交互式输入测试。维护成本是一行明确测试触发及其证据表述，不改产品行为。

接入后本机验证：夹具检查真实 `BrowserWindow.getBounds()` 到目标后显式 `emit("moved")`，随后等待本次保存并核对坐标；`MOCHI_RAIL_SCREENSHOT_ROOT=/tmp/mochi-rail-screenshots-final6-20260925 npm run test:rail-runtime --prefix apps/desktop` 通过，18 次位置保存及四张截图产生。该测试只证明事件处理器接线；Windows 原生 CI、真人手动拖动、DPI/多屏仍分别待验。

## 2026-09-25 · Windows 教室板顶部与底部截图去重（实施前）

先覆盖完整应用/生态，实际搜索 `site:github.com Electron desktop pet screenshot scroll panel integration test capturePage`、`site:github.com electron app screenshot scroll content Windows capturePage test`；结果未找到可以直接替换 Mochi 原生 rail 夹具的完整应用。复核已查 [OpenPet](https://github.com/dengyie/OpenPet) HEAD `aec45f537d8056fb9e2c8c309a132f788321566a`（MIT、未归档、2026-09-11 推送），其整套桌宠/控制面板不适合只替换本项目的滚动截图门禁，继续用现有 Electron 39.8.10 夹具。

再查部件，实际搜索 `site:github.com/electron/electron capturePage scrollTo Windows screenshot`。核对 [Electron webContents.capturePage 文档](https://github.com/electron/electron/blob/d7c42ebd5cd501a0e6d9f009e232369832f92d69/docs/api/web-contents.md)（v39.8.10 对应源码提交 `d7c42ebd5cd501a0e6d9f009e232369832f92d69`，MIT）：不传矩形只截当前可见页面；[Electron 截图绘制时序讨论](https://github.com/electron/electron/issues/6426)是早期版本的窗口截图案例，提示截图可能先于绘制，不能把它当作当前版本已确认 bug。本次不引入截图依赖或复制外部实现，维护面仅原有夹具。

原生 Windows [run 36090296374](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36090296374) 的四张 PNG 中，`classroom-board-top.png` 和 `classroom-board-overflow.png` 的资产大小均为 23,194 B、SHA-256 一致，虽然 DOM 断言已证明名单可滚动且末行可见，**两张图片不能作为两个不同滚动位置的视觉证据**。待核对 PNG 内容与滚动时序；拟显式设置顶部 `scrollTop=0`、等待顶部行进入视口，底部滚至最大值并等待末行进入视口，再等绘制机会、截取两张图并断言 PNG 不同。若图仍相同，门禁应失败，不能发布为完整视觉证据；Windows 物理桌面合成仍另需学校设备验收。

接入后本机验证：显式复位顶部、断言首行在视口且溢出行不在视口，双 `requestAnimationFrame` 后截图；底部断言相反，并直接比较两张 PNG 字节。首次运行因生成夹具缺 `readFileSync` 导入而失败，补齐后 `MOCHI_RAIL_SCREENSHOT_ROOT=/tmp/mochi-rail-screenshots-final7-20260925 npm run test:rail-runtime --prefix apps/desktop` 通过，顶部/底部 SHA-256 分别为 `9009a40c0f8f05ac23d924f4452c2858e850c65105b72b40e5fee6df79b30c08` 与 `7fe7b7ebdb8028cee50f4a990c21e2b03ca936923bbd5a1d585137f1ea8fba43`。Windows 原生结果须在新快照运行后判断；这项只改测试证据，不改产品视觉或滚动逻辑。

Windows [run 36092244751](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36092244751) 在提交 `9cd4a0c9a5433a78cd7bf5f20ac42b6fad4d50b6` 上通过新门禁和后续所有安装门禁；私有[草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-0597efba861a9ddbd468) 中教室板顶部 PNG 为 23,194 B / SHA256 `13ecc8db3d97e281b7b7a7ee2191368c59cd314f830aeba8bf525c7f3eee5758`，底部为 24,911 B / SHA256 `7fa495c6c24bae99ada7a0144ea90ef366b394216aad012a477b26b7b7ff4cc5`，明确不同。CI 只验收 fixture 的应用内容截图与滚动状态；学校目标机 DWM 透明合成及人工手感仍未验证。

## 2026-09-25 · 聊天完成双端配对与后续消息闭环（实施前）

先检索完整应用/框架，实际搜索 `site:github.com open source local network classroom teacher student desktop pairing chat app Electron` 和 `site:github.com open source LAN device pairing desktop application teacher student Electron`。查看 [Chatty-EDU](https://github.com/instance001/chatty-edu) README 标示 v0.5.0、发布区提供 Windows v0.6（AGPLv3、Rust/egui，含局域网发现/通信）；[Orbit-beta](https://github.com/D4niel-dev/Orbit-beta) 发布区 v0.6.4-beta（MIT、Electron/Node/SQLite，含组播与 Playwright 端到端测试）；[Agora Flat](https://github.com/netless-io/flat)（完整课堂应用，依赖在线 RTC 服务）；[LEOS](https://github.com/HolagundiWorks/leos)（Electron 校务应用，局域网临时代码，GPLv2 来源）。这些项目说明完整应用已覆盖邻近需求，但身份模型、授权协议和数据流均不能直接替换 Mochi 已有签名配对与预约；本次不迁入其代码。上述版本/功能来自公开仓库页面，具体依赖树和与 Mochi 的兼容性未验证，故不声称可直接适配。

再搜索组件/测试范式，实际词 `site:github.com electron two app instance integration test local network pairing approval`、`site:github.com playwright electron multi window integration test two instances`。查看 [electron-playwright-example](https://github.com/spaceagetv/electron-playwright-example) `main`（MIT，多窗口测试例子；更新活跃度未核实），其示例开启 `nodeIntegration` 且关闭 `contextIsolation`，不适合导入 Mochi 的隔离边界；[Playwright Electron API](https://playwright.dev/docs/api/class-electron) 和 [ElectronApplication](https://playwright.dev/docs/api/class-electronapplication) 提供 Electron 测试能力，但本仓已锁定 Playwright 并有双实例真实 Electron 测试框架。采用现有 `test-chat-appointment-live-ui.mjs` 的双端启动和本项目 LAN 协议，部分借鉴“两个原生应用实例验证端到端状态”的测试方法，不添加依赖或表单。

已确认当前 `test-chat-lan-live-ui.mjs` 仅启动教师应用与教室服务夹具，报告 `classroomAcceptanceStillRequired: true`；另一个预约测试虽启动两个真实应用，却预先由夹具直接批准配对。拟让后者从未配对身份开始，由教师聊天发起、教室聊天查询待确认请求并批准，随后沿用预约消息验证签名交换。长期维护面为单个现有测试脚本和假模型网关；脚本只能证明已声明工具调用在真实 UI/本机 LAN 上可闭环，不能证明真实模型自然语言理解、学校交换机/防火墙、目标设备 Key 或人工指纹核对。若产品代码缺陷暴露，再单独记录与修复。

接入后验证：`npm run test:chat-appointment-live-ui --prefix apps/desktop` 通过。两个隔离 Electron/DSH 角色从零配对开始；教师对话发起请求并点击审批，教室对话先读取待配对状态、用真实请求 ID 调接受工具并点击审批；双方 LAN 服务各有一个匹配 ID/指纹的对端。随后教室在同一会话发预约，教师在同一会话按原时间回复，教室收到签名决定。夹具记录 12 次脚本化模型调用、无 fixture Key 回显。初版测试采用新建会话衔接时曾与输入框的忙碌状态赛跑，改为同一聊天会话继续发消息后通过；本次只改测试脚本，没有改产品配对协议或授予学生成人审批权限。真实模型理解、审批者身份及学校物理网络仍未验证。

后续复测追加记录：本机双端并行与教师先启的重复运行均在进入配对步骤前遭遇产品 `WEB_HOST_TIMEOUT`（90 秒），没有发送模型网关请求；先前一次完整通过的证据仍保留，但不能称当前回归稳定通过。测试改为先等教师 DSH 页面就绪再启教室端，按产品 90 秒上限报错，并将 `data:` 启动页面缩写以免把整个 HTML 打进日志。只读源码核查确认开发态插件和 Node 模块仍从 iCloud 工作区加载，复制安装的 Mac 包则从打包资源加载并已通过双角色启动；这只支持“运行位置可能相关”，未证明 File Provider 是根因。当前 DSH host 仅把子进程 stderr 转发到 Electron 日志，stdout 除就绪标记外被丢弃；不得从缺少错误行推断子进程没有输出。尚未修改产品启动超时，也未引入自动重试掩盖失败。

## 2026-09-25 · WorkBuddy 产物呈现可复用性核对

按“先完整应用再部件”检索：完整应用词 `site:github.com/open-webui/open-webui artifacts file preview chat web app`、`site:github.com/danny-avila/LibreChat artifacts file preview`、`site:github.com/deepseek-ai/deepseek-harness artifacts file card preview chat`、`GitHub open source AI chat app artifacts generated files preview`、`site:github.com/CherryHQ/cherry-studio artifact file preview assistant generated file card chat`；组件词 `site:github.com/open-webui/open-webui artifacts component sandbox iframe file preview`、`site:github.com/LibreChat-AI/LibreChat artifacts canvas iframe preview React code interpreter files`、`site:github.com/deepseek-ai/deepseek-harness client-ui-deliverables produced files multi-file card`、`GitHub React multi-file artifact preview sandbox iframe file cards`，并核 `Inkotake/dsh-rich-artifacts`、`codesandbox/sandpack` 与 Office viewer。GitHub 网页搜索成功；本机 `git ls-remote` 无输出、`curl github.com` 超时，不能把未取得的提交号当作已核实。

核对完整方案：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 当前本机固定 `0.1.3-alpha.1`、MIT，本机上游 checkout `d347e703908d0406b7a7ef80e3a0e594d86b2215`；[LibreChat](https://github.com/LibreChat-AI/LibreChat) v0.8.8-rc4 / `361553f`、MIT，Artifacts 用 Sandpack 承载 HTML/React 等交互预览；[Open WebUI](https://github.com/open-webui/open-webui) v0.11.4 / `8bd8b4f` 有 iframe 预览，但当前自定义许可证带品牌限制，不能直接搬入。Mochi 已复用 DSH `ui-deliverables` 对写文件工具的 `locations` 投影，并由本地 `dsh-better-sidebar` 0.18.0 的同一 turn-tail 槽呈现最多六个通用文件 chip 和侧栏打开；课件另有 PDF 预览。**已确认**无需重建 WorkBuddy 的 `present_files` 主循环，也不需新增业务菜单。当前通用 chip 只携带路径，不承担任意文件内容预览。

核对插件/组件：[dsh-rich-artifacts](https://github.com/Inkotake/dsh-rich-artifacts) package 0.1.0、MIT、仓库页面 10 次提交且无 release/tag/issue/PR，能发布多文件画廊，校验工作区边界、符号链接、图片魔数等；但其自定义 `artifact/published` 会话事件与本机 DSH 的 `ignorable` 未知事件约束冲突，README 自述 `maxTurnBytes` 尚未实现，故只借鉴静态文件安全边界，不安装或复制。维护活跃度和实际兼容尚无证明。[Sandpack](https://github.com/codesandbox/sandpack) Apache-2.0，适合代码沙箱，但引入 iframe bundler、CSP/外部资源维护，超出 Office/PDF/图片静态预览需要；不引入。后续若新增通用预览，优先在已用的 DSH 槽和本地文件权限管道上按格式、按需扩展，避免和默认产物行重复；先验证真实产物呈现及访问边界。

## 2026-09-25 · 当前 Mac 样式包的本地重建（实施前）

先搜索完整应用/框架，实际词 `site:github.com/CherryHQ/cherry-studio electron-builder macOS arm64 dmg release workflow source`、`site:github.com/electron/forge macOS dmgs package native modules`，核对 [Cherry Studio 构建配置](https://github.com/CherryHQ/cherry-studio/blob/main/electron-builder.yml) 的 DMG/arm64 路径；其 `main` 是今日网页快照，未锁具体提交或复核本次依赖兼容，故只作完整应用先例。再搜索组件 `site:github.com/electron-userland/electron-builder macOS dmg build local staging directory files node_modules APFS`，核对 [electron-builder targets](https://github.com/electron-userland/electron-builder/blob/master/website/docs/targets.md)、[CLI](https://github.com/electron-userland/electron-builder/blob/master/website/docs/cli.md) 与[官方仓库](https://github.com/electron-userland/electron-builder)。本项目继续锁已装 `electron-builder` 25.1.8（MIT；先前已核 tag `electron-builder@25.1.8`）和 Electron 39.8.10，沿用原生 ABI、发布输入清单、`beforePack` 与 DMG 验收链，不迁移 Forge、不下载新依赖。网页搜索成功；主分支文档只能说明机制，不能替代本机固定版本构建。

当前 Mac DMG 的校验仍有效，但比最终工作树的 `apps/desktop/electron/dsh/rail-pages.ts` 少两处教室板 CSS。此前从 iCloud 工作区直接重包，在依赖扫描超过一小时后仍未产出镜像。拟在同一 APFS 卷的 `/private/tmp` 建非 iCloud 临时源码树，排除工作区 `release` 的 22 GiB 历史包、`.git` 的 2.6 GiB 和旧资源暂存；复制当前源码及本机锁定依赖，使用已验证的发布输入清单与 Playwright 浏览器资源重新生成暂存，构建完成后先在暂存路径验 DMG/关键资源/双角色，再原子替换正式包。`df` 当前可用约 13 GiB，复制与构建的峰值空间仍属估计；若不足或任何门禁失败，保留已验收旧包。维护成本是一次性临时构建空间和验证，不更改发布脚本或依赖。

接入后验证：非 iCloud 暂存复制了桌面锁定依赖，插件源树排除生成 `node_modules*`，所需 `schemastery@3.18.0`、`cosmokit@1.8.1`、`@standard-schema/spec@1.1.0` 从桌面依赖解析；零悬空链接或指回工作区的链接。发布输入 133 项 / 28,147,475 B 复核通过，暂存 `rail-pages.ts` 与本仓字节一致；DSH host peer 投影 925/925、TypeScript 构建、electron-builder 退出码 0。ABI 预检在此环境无可执行的探测运行时，给出 0 二进制检查的警告；随后安装包中的 12 个 Darwin arm64 原生模块候选经 `lipo` 均为 arm64。新 DMG 晋升前后两次 `hdiutil verify` 为 VALID，`app.asar` 的 rail 编译文件与本次编译逐字节相同，唯一种子是无 Key 的 `settings-defaults.json`。包内资源相较构建暂存仅过滤 8 个 AppleDouble 元数据旁路文件（1,304 B）和空目录；其余运行文件内容一致。从只读挂载镜像直接运行教师进程在 90 秒内未取得成功标记，**该路径未通过**；从镜像复制的应用教师 11.7 秒、教室 2.0 秒均出现 `MOCHI_DESKTOP_SMOKE_OK`。正式 DMG 733,932,275 B / SHA256 `b230ffe121c67878e3fe899443d6db40a23cda0bf82fc8d0479584b249a59dbb`，blockmap 766,157 B / SHA256 `82cbac44640265fe9a02e055d1f20b629953f098eb9e1bebf9c59a4f1d14d1ad`；旧三件套保留于 `apps/desktop/release/archive/2026-09-25-pre-rail-pages-css/`。这验证本机复制安装路径，不代表签名、公证或学校 Mac 设备 Gatekeeper 行为。

## 2026-09-25 · 共用教室电脑的配对批准身份（设计核对，未实施）

先查完整课堂管理应用，实际词 `site:github.com open source classroom management teacher student pairing device approval admin PIN Electron`、`site:github.com Veyon teacher classroom authentication access control student client configuration`、`site:github.com MeshCentral agent invite pairing admin approval device PIN desktop app`、`site:github.com Windows classroom shared computer teacher approval pairing admin authentication local app`。核对 [Veyon](https://github.com/veyon/veyon) v4.11.3（2026-09-18 发布、GPL-2.0、Windows 版本继续维护）把教师控制与认证密钥/访问规则分开；[LEOS](https://github.com/HolagundiWorks/leos) 的完整 Electron 校务应用要求设备临时代码之后仍登录其校内角色账户；[MeshCentral 邀请码讨论](https://github.com/Ylianst/MeshCentral/discussions/4316)也把邀请码置于设备组/管理员上下文。再查组件级 [Veyon 授权用户组讨论](https://github.com/veyon/veyon/issues/265)与[密钥认证用例](https://github.com/vainmari/Veyon-detection)：这些是设计参照，不适配 Mochi 当前签名协议、DSH 和学校账户体系，且 Veyon GPL-2.0 不能无评估地搬入代码；不引入依赖。

本仓已确认 `mochi_lan_decide_pairing` 和 LAN 面板的“核对后接受”分别经 DSH 审批与同源登录页面直达 `acceptPairing`，只复核请求、学校、角色、指纹与本机身份；没有独立的成人身份凭据。**推测风险：** 若学生可操作教室共用 Windows 会话，就可能点击接受新的长期教师配对；设备短码和一次确认不能证明点击者是成年人。已向用户询问谁有批准权，等待产品策略后再选 Windows 账户、校方身份系统或本机受管授权等实现路径；不能只在聊天工具加门禁而放过 LAN 面板和本地路由。维护成本和学校部署条件取决于批准策略，现阶段不假装此项已解决。

进一步只读核对：现有 `plugins/mochi-campus/connection.mjs` 已保存校园账号角色并向 `/api/auth/me` 复验，还能把校园用户绑定到 DSH 对话会话；`plugins/mochi-lan/index.mjs` 当前没有注入该连接，`chat-tools.mjs` 的审批结果只给 `allowed-once`，`host-bridge.mjs` 的一次性内部路由令牌也不携带操作者身份。因此校园角色是可复用的现有能力，**不是**已经落地的配对批准控制。若将其接入，须同时覆盖聊天接受与 LAN 面板直达路由，并定义掉线、注销与角色更新时的失败策略。按源码范围搜索，未发现当前配对路径使用 Windows 用户或受管组来做成人鉴权；这不等于全仓不存在其他账号代码。

## 2026-09-26 · Mochi 动效与桌面常驻界面升级（实施前）

GitHub 检索成功。先查完整应用/生态，实际词：`site:github.com open source macOS AI chat app interface animation`、`site:github.com/CherryHQ/cherry-studio AI desktop animation avatar React electron`、`site:github.com bloub app animation`；看过 [WardenApp](https://github.com/SidhuK/WardenApp/tree/f0c569952a43a0f69b8237948b7923e97c3eb72c) HEAD `f0c5699`（原生 SwiftUI macOS AI 对话、Apache-2.0），以及 [Cherry Studio](https://github.com/CherryHQ/cherry-studio) 的 Electron/React 应用结构（本轮未锁提交，故仅作生态范围核对）。它们已有 AI 对话与桌面界面，但整套应用替换会破坏 Mochi 现有 DSH、校园业务和打包边界，不采用。

再查动效项目/组件，实际词：`site:github.com bloub animation thinking AI app open source`、`site:github.com/jeremy-prt/bloub bot animation states thinking SVG 14`、`site:github.com/motiondivision/motion React animation interrupt spring latest`、`site:github.com/emilkowalski/vaul React drawer spring gesture maintained`。确认用户所指为 [bloub](https://github.com/jeremy-prt/bloub/tree/b4bb3c1b5f93c7b87a2e8d620f667c4093d97749)，提交 `b4bb3c1b5f93c7b87a2e8d620f667c4093d97749`、包版本 0.1.1、MIT、2026-08-17 推送、未归档；源码确有 14 个编排状态和额外 `swirl` 过渡，`BotEngine.setState` 在过渡中把当前合成姿态冻结为下一段起点，`sample(t)` 可按时间重现画面。其组件是 Vue 3，项目开发栈含 Vite 8；Mochi 投产对话界面是 DSH 插件中的 React 18 组件，桌面常驻条是无外部脚本的 Electron `data:` 页面。直接搬 Vue 组件或整套 208 KiB 状态引擎会增加双框架、两份渲染和打包维护，不采用；复用状态语义、即时反馈、从当前画面接续的动效机制，并保留 Mochi 既有焦糖球和小电脑。用户已选择保留 Mochi 形象。bloub README 明确 MIT 仅覆盖仓库代码，其造型是对 x.ai 角色的复刻，不能把设计授权推定为 MIT。

组件候选 [Vaul](https://github.com/emilkowalski/vaul) 虽是 MIT 拖拽面板，但仓库自述不再维护，且 Mochi 常驻条是独立原生窗口，不引入。Mochi 已有 `rail-spring.ts` 负责窗口尺寸弹性过渡和 React 表情球的连续状态追逐，优先在现有边界完善中途反向、思考和完成态，并保留 `prefers-reduced-motion`、键盘与高对比度支持。长期成本主要是状态与视觉资产在 DSH 插件、启动画面和常驻 `data:` 页之间的同步；实施时尽量使投产对话只用一份组件，常驻条仅保留尺寸受限的本地表现，不加入第二个动画框架。待完成后补记录实际构建、交互和截图验证。

### 2026-09-26 · 纸张待办与透明桌宠补充检索（实施前）

GitHub 搜索已执行。先查完整应用，实际词：`site:github.com/Achilng/floral-notepaper license sticky note desktop`、`site:github.com/SolisWare/axion-notes license Electron sticky notes`、`site:github.com/alex-fomin/StickNote macOS sticky notes SwiftUI`；再查组件：`site:github.com/react-latest-ui/react-sticky-notes license`、`site:github.com react tear off paper note animation component CSS`、`site:github.com paper card peel off animation open source React Framer Motion`。看到 [Axion Notes](https://github.com/SolisWare/axion-notes)（Electron/React/TypeScript，仓库页面声明 MIT，提供独立便签窗口与本地存储）、[floral-notepaper](https://github.com/Achilng/floral-notepaper)（Tauri/React 的完整笔记应用）及 [react-sticky-notes](https://github.com/react-latest-ui/react-sticky-notes)（便签组件）。GitHub 页面搜索可用，但本轮 `git ls-remote` / 仓库详情请求连接失败，后两者许可证、当前提交和维护状态未核实，不引入其代码或依赖；Axion 的仓库声明也不能替代本地许可证文件核对，故只作产品形态参考。完整笔记应用会引入存储、编辑器和额外窗口生命周期，超出当前签名待办列表；组件偏向自由拖拽编辑，也不适合由服务端快照驱动的只读待办。采用现有 Electron `data:` 页的 CSS 纸张视觉与浏览器 Web Animations API，仅在已确认的待办数量减少且旧行消失时做揭离反馈。维护成本限于单个页面脚本和样式；风险是列表更新时误把替换/分页当成完成，故以数量减少为门槛，减少动效设置下直接更新。

透明宠物复用结论：本仓 `rail.ts` 已用无边框、无阴影、透明 Electron 窗口与 `#00000000` 背景，继续使用它；当前可见底盘来自折叠态 CSS，不需引入另一套桌宠窗口框架。保持内联 SVG 矢量球体，在原生大小渲染并检查透明像素与边缘，避免位图放大。真正的跨系统原生合成效果仍须在目标系统实测。

### 2026-09-26 · 用户提供图标与侧边栏标识（实施前）

先查完整应用，实际词：`site:github.com open source Electron AI chat app sidebar icon theme design Cherry Studio`、`site:github.com open source desktop AI chat app icon system sidebar electron`；参看 [Cherry Studio 的设计规范](https://github.com/CherryHQ/cherry-studio-pi/blob/main/DESIGN.md)，其侧栏使用独立语义色和一致的图标前景色。再查组件与打包工具，实际词：`site:github.com lucide-icons/lucide icon library MIT SVG React`、`site:github.com electron app icon png icns ico generator open source`、`site:github.com/jankovicsandras/imagetracerjs image tracer SVG license javascript`、`site:github.com svg vectorize png potrace node MIT maintained`；参看 [Lucide](https://github.com/lucide-icons/lucide) SVG 图标生态、[Electron Forge 图标指南](https://github.com/electron-forge/electron-forge-docs/blob/v6/guides/create-and-add-icons.md) 和 [ImageTracerJS](https://github.com/jankovicsandras/imagetracerjs) 1.2.6（Unlicense）。这些仓库只提供设计/格式与矢量化参照，不替换用户指定的图形。当前无法稳定连接 GitHub Git 端点锁定其 HEAD；不把搜索结果误记为已验证提交或运行适配。

本仓已确认侧栏品牌图由 `sidebar.brand.mark` 插槽提供，原来是水母 PNG；桌面打包现用 `apps/desktop/build/icon.png`、`.icns`、`.ico`，分别用于 Mac/Windows。用户附件实际是两张 1254×1254 RGB PNG，不含 SVG 路径；用户确认没有原始矢量文件，同意描摹。第一张图形轮廓转为单色 SVG 用于侧栏品牌标识，功能导航图标保持各自语义并统一线条风格；第二张作为桌面图标唯一母版生成系统尺寸。减少玻璃渐变、顶部高光和深投影，保持暖纸白/深松绿/克制黄铜的语义阶梯。长期成本是桌面图标多尺寸产物和单个 SVG 的同步；风险是自动描摹无法保证与原矢量路径完全一致。

实施及当前核验：第一张附件 SHA-256 `20cd55f3debd68f36661e13e9abf5912f4c0cafbc4e0d33e1de847c2a72f0ede`，描摹为 `client-plugins/jxl-theme/assets/icons/icon.svg` 并用于主侧栏品牌标识与校园工作组标识；第二张附件 SHA-256 `a3bf3baae04b91573fdd2756ed7381468cea258e750baa7aa6fd18a09c771f4c`，描摹为 `apps/desktop/build/icon-source.svg`，生成 1024 PNG、ICNS 和九尺寸 ICO（细节见下文系统导航区复核）。Potrace 2.1.8 为本地一次性转换工具（包声明 GPL-2.0），未复制其代码或作为运行依赖；输出路径来自用户附件。`test-installer-config.mjs` 的前半段图标/打包断言已输出 PASS，其后续 builder 检查挂起；针对 `rail-pages.ts` / `rail.ts` 的严格 TypeScript 检查通过。Chrome 2× 预览确认侧栏标识在浅色和暗色背景下轮廓可辨、桌宠截图四角 alpha=0；纸卡仅在待办总数下降且旧 ID 消失时揭离，减少动效下不生成揭离层。本地 `test-package-resources.mjs` 在抵达新增资产断言前因现有 `exceljs` 安装缺少锁文件中已列出的 `tmp@0.2.7` 而失败；未将该依赖问题归因于本次样式变更。完整 `tsc -p tsconfig.node.json` 和 Electron 原生运行测试在本机无输出挂起，故尚不能声明跨平台原生窗口合成已验证。

材质收敛实做：全局主题中的玻璃令牌改为纸色实底，侧栏激活项去内高光和深投影；校园工作入口组去模糊和内高光；常驻条改为深松绿实底、米白纸卡与浅黄铜按钮。保留功能导航各自的线性 SVG，并统一笔画粗细、端点和连接方式；用户已确认品牌用图一、导航保留独立语义。

对话状态回归：`jxl-brand` 构建通过，`avatar-lifecycle.test.mjs` 用虚拟时钟实际验证了首字等待、流式输出、审批提示、成功结束时 1.6 秒庆祝以及回到闲置的生命周期。测试夹具补齐浏览器本有的 `performance`/计时器接口后为 1/1 通过；此前缺这些接口时扫描被现有容错层吞掉，不能算产品失败。主球仍是 SVG，未引入模糊滤镜或放大位图。

### 2026-09-26 · 系统导航区图标与材质复核（实施前）

新增需求前再次按完整应用、构建生态、平台组件顺序搜索。完整应用词 `site:github.com/CherryHQ/cherry-studio electron-builder icon.icns icon.ico app icon mac windows`、`site:github.com/laurent22/joplin electron icon.ico icon.icns desktop assets`；构建生态词 `site:github.com/electron-userland/electron-builder documentation icons mac icns windows ico`；组件/平台词 `site:github.com/electron/electron app icon Windows taskbar macOS dock icon template ico icns`、`site:github.com/electron/electron/blob/main/docs/api/native-image.md setTemplateImage macOS menu bar dark`、`site:github.com/electron/electron/blob/main/docs/api/tray.md Template@2x macOS tray image 16 32`。核对 [Joplin 打包配置](https://github.com/laurent22/joplin/blob/dev/packages/app-desktop/package.json)、[Cherry Studio 打包配置](https://github.com/CherryHQ/cherry-studio/blob/main/electron-builder.yml)、[Electron Tray 文档](https://github.com/electron/electron/blob/main/docs/api/tray.md) 和 [nativeImage 文档](https://github.com/electron/electron/blob/main/docs/api/native-image.md)。网页分支页未锁定具体提交；本机固定 Electron 39.8.10 / electron-builder 25.1.8，不能从线上 main 推定本机全部行为。

已确认 Mac Dock 使用 ICNS、Windows NSIS/任务栏使用 ICO，本仓配置已指向新图标；上述 Electron 文档建议 Mac 菜单栏用 16/32 像素单色 Template 图，Windows 通知区用 ICO。当前 `main.ts` 对两个平台均从 `process.execPath` 取彩色图，用于 Mac 菜单栏会出现不随明暗背景适配的黑色方块。采用用户图一的透明单色 SVG 生成 Mac Template 图，保留用户图二的方形彩色图用于 Dock、任务栏和 Windows 通知区，避免另起图标库。长期维护成本是增加两张小尺寸衍生图以及打包资源声明；原生平台表现仍须实机核验。

实施后核验：Mac Template 为 16/32 像素透明单色 PNG，四角 alpha=0，在浅色与深色背景的放大检查中轮廓可辨；运行时代码从应用内读取 PNG 字节，构造 1×/2× `NativeImage` 并标记 Template。Electron 39.8.10 的独立原生探针已成功创建并销毁 Tray，返回 `trayCreated:true`、`template:true`、`scales:[1,2]`；这验证原生 API 接受图像，不代表新安装包已显示正确。Windows ICO 从用户图二描摹的同一个 `icon-source.svg` 生成，按 [Electron nativeImage 格式建议](https://github.com/electron/electron/blob/main/docs/api/native-image.md)补足 20 和 40 像素后共有 16/20/24/32/40/48/64/128/256 九档；Pillow 实际解析九档，所有角点透明。Windows 打包后的通知区代码复用可执行文件图标，开发态主窗口及通知区明确取本地 ICO。主进程严格 TypeScript 检查通过；浏览器 2× 侧栏预览确认描摹标识在浅色/深色背景没有裁切。校园面板内的模糊、强阴影与激活项内高光从源样式移除；备用桌面渲染器的玻璃渐变和发送按钮浮影也改为实底和轻阴影。`jxl-brand` 构建及头像生命周期测试 1/1 通过，纸卡揭离浏览器测试通过，`git diff --check` 通过。可复看的小尺寸、菜单栏明暗、纸卡、透明宠物截图位于 `docs/evidence/ui-2026-09-26/`。`test-installer-config.mjs` 在输出中段 PASS 后加载 builder 检查阶段挂起，原因未证实，不能声明完整通过；Windows 实机系统栏与两平台安装包尚未验证。

### 2026-09-26 · 原生透明宠物触摸反馈（实施前）

再次先检索完整应用，实际词 `site:github.com transparent desktop pet Electron pointer gaze hover animation open source app`、`site:github.com Clawd on Desk desktop pet pointer interaction gaze source`，核对 [clawd-buddy](https://github.com/bestxiangest/clawd-buddy) `main` 网页快照（4 次提交，未锁 HEAD；源码 MIT，美术单独保留权利）与 [desktopPet](https://github.com/kokoronoka/desktopPet) `main` 网页快照（6 次提交，许可证文件未取到，故不移用代码）。前者有鼠标跟随眼睛、点击反馈和透明 Electron 双窗口，后者把方向与表情变换分层。两者整套窗口/素材接入会增加第二套桌宠生命周期、跨平台点击穿透和授权成本；保留本仓已验证的透明 `rail` 窗口。再查组件/机制词 `site:github.com jeremy-prt bloub BotEngine pointer gaze spring interrupt`、`site:github.com mouse follow eyes SVG pointermove reduced motion animation`，复核本地 [bloub](https://github.com/jeremy-prt/bloub/tree/b4bb3c1b5f93c7b87a2e8d620f667c4093d97749) 提交 `b4bb3c1` / 0.1.1 / MIT 的 `src/ui/gaze.ts`；它将指针坐标归一化并把视线转为状态输入。用户已决定只复用机制、保留 Mochi 形象。本仓常驻宠物为 76px 原生透明窗口中的内联 SVG，直接在其眼睛分组上做有限视线移动与按压弹性，无需新增依赖或逐帧位图。维护成本局限于 `rail-pages.ts` 的 SVG/CSS/事件，风险是 CSS 动画覆盖指针变换或触摸与窗口拖拽冲突；需在原生 Electron 中验证边缘 alpha、指针移动、点击和减少动效。

实施后验证（macOS / Electron 39.8.10）：用真实透明无边框 `BrowserWindow` 加载当前 `railPageHtml('teacher-rail')`，其 76×76 CSS px 折叠页在 2× 显示下截为 152×152 PNG；按钮矩形 `[0,0,76,76]`，矢量宠物矩形 `[7,2,62,72]`。原生截图四角及四条边 alpha 均为 0，没有底板、模糊放大的位图或被裁掉的角标。指针从左到右使眼睛位移从 `-2.58px` 到 `2.58px`；按下/抬起状态切换通过；系统减少动态效果下视线变换和呼吸动画均为 `none`；点击仍展开。原生截图已更新在 `docs/evidence/ui-2026-09-26/transparent-pet.png` 与 `teacher-rail-expanded.png`。验证时发现旧的字符串替换先命中了 CSS 选择器，导致折叠球偏右；现在直接在 `<body>` 写入 `data-expanded`，并给运行测试补了 76px 布局断言。另发现待办角标被窗口上沿裁切；将角标移入画布并去掉阴影后四边透明。上述事实只覆盖本机原生 Electron 截图及 DOM，不证明 Windows DWM 合成或最终安装包的效果。

### 2026-09-27 · 桌宠与材质验收补记

沿用上述已核的完整应用、插件与 bloub 机制结论，没有增加第三方运行依赖。侧栏“新会话”与激活项曾保留独立的绿色常量和浮影；已改为主题桥中现有的主按钮、悬停、反色文字令牌和零阴影，使明暗主题共用同一色阶。原生常驻条保留不透明松绿壳与米白纸卡。维护成本是主题桥少量令牌引用；若上游改名，应由现有主题插件测试和界面截图复核。

**已确认：** 本机桌面 TypeScript 整体构建退出码 0；`jxl-theme` 构建后 5/5 测试通过，`jxl-brand` 构建后头像生命周期 1/1 通过，浏览器便签揭离检查通过。`test-rail-runtime.mjs` 在调整旧毛玻璃断言、采用实际可滚动的焦点夹具及补偿 Chromium 更新列表后的滚动锚定后，连续三次通过；覆盖真 Electron 窗口、76px 几何、指针视线、减少动态效果、展开/收起、弹窗和 64 人名单入口。最终运行截图为 `docs/evidence/ui-2026-09-26/teacher-pet.png`、`teacher-todo.png`、`classroom-board-top.png`、`classroom-board-overflow.png`。`git diff --check` 通过。

**仍未验证：** 新版安装包尚未重建，因此本机的系统栏探针、ICO 尺寸解析及打包配置检查不等于 Windows 实机任务栏或最终 DMG。`test-installer-config.mjs` 输出其 PASS 行后进程未退出，手动终止；不能把它记为完整通过。Windows 原生外壳合成与图标缩放需在 Windows runner 或设备上验收。当前目录里此前生成的 Mac DMG 日期早于本轮视觉改动，不能当作新版交付物。
### 2026-09-27 · 全界面纸白材质与 PommeToys 反馈专线（实施前）

用户本轮要求覆盖全部 Mochi 运行界面、悬浮窗，并明确整体借鉴反馈专线的材质、控件与动效；新版要求优先于此前保留大面积深绿外壳的决定。保留夜间模式，不强制覆盖用户已有主题偏好。

检索成功，先查完整应用：`github desktop AI chat app electron theme cream assistant floating window`、`site:github.com/CherryHQ/cherry-studio theme license`；再查框架/插件生态：`github radix ui shadcn motion react license`、`site:github.com/radix-ui/themes releases`；另查 `pommetoys app feedback interface`、`site:github.com pommetoys`。未找到可确认的 PommeToys 开源仓库，不等于其不存在。

- [Cherry Studio](https://github.com/CherryHQ/cherry-studio/tree/de2bc0aed0e805f1129e2ae7307a7af226f405c3)：GitHub API 实查提交 `de2bc0aed0e805f1129e2ae7307a7af226f405c3`，2026-09-26 更新；package.json 版本 2.1.3、Electron 44.2.0。仓库声明社区版 AGPL-3.0，有完整 AI 聊天和 CSS 主题生态。仅参考产品覆盖范围，不复制代码；整套迁移不兼容现有 Electron 39 / DSH 业务边界，且不需要引入另一套授权与状态管理。
- [Radix Themes](https://github.com/radix-ui/themes/tree/7300f2a9be4309e04b2c1b4e43b5d7cf4a58eb43)：3.3.0，GitHub API 确认提交 `7300f2a9be4309e04b2c1b4e43b5d7cf4a58eb43`，2026-01-31；查看该提交 LICENSE 页面（MIT）及发布记录，有语义主题、表单与状态控件。package.json 原始端点超时，peer 兼容性未确认，因此不引入依赖。Mochi 已有原生 composer、主题持久化和辅助功能控件，复用这些基础功能。
- [PommeToys 官网](https://pommetoys.app/zh/)：直接检查 `nav.js` / `home.css`，三档偏好 light/auto/dark 与生效主题分离；旋钮 -55/0/55 度，320ms back-out，支持方向键及减少动效。官网当前 `instrument.js` 的反馈入口仅触发按键声音，不能据此证明完整反馈发送动画。网页交互工具连续超时，属于预览失败，不是 GitHub 搜索失败。
- 本机 `/Applications/PommeToys.app` 1.1.5 (13)：通过原生辅助功能与截图确认“反馈专线”，非设置页：米白机身、嵌入式状态屏、进纸槽、打孔纸、分类印章、压下式按钮。已重新打开空白反馈窗；截图未捕获完整逐帧时序，发送全过程未验证，也未向支持台发送测试数据。仅复用设计机制，不复制其图像、声音或私有程序。

实施采用现有 DSH 语义主题与设置服务、原生输入提交状态和 CSS/Web Animations；新增样式集中在主题插件，悬浮窗/启动/诊断同步配色。纸张反馈不接管发送、不清空草稿、不虚构送达；日夜控件调用现有 theme.setTheme，避免第二份偏好存储。长期风险是上游 composer 钩子变动及原生/网页色阶漂移，需用当前投产 bundle 核验钩子、真实窗口截图、明暗/减少动效及发送失败状态检查。

补充层级与实体按键检索：先搜 `site:github.com React95 React95 desktop application components license`（完整 React95 组件生态），再搜 `site:github.com jdan 98.css windows interface buttons MIT`。查看 [React95](https://github.com/React95/React95)、[98.css](https://github.com/jdan/98.css) 搜索页/仓库说明，后者公开 0.1.18（2022-05-22）、MIT、语义 HTML 无 JS；本轮未锁 React95 提交和依赖，未确认持续维护，不能宣称已适配。两者复古 Windows 像素外观不符合本次温润纸白目标，不接入、不复制代码。复用 Mochi 现有导航、ESC 返回、弹层与表单语义，只调整层级、键帽和状态过渡，避免增加第二套路由和组件运行时。

### 2026-09-27 · 机械音效与发送编排（实施前）

用户进一步要求复刻风格、动画、音效和发送反馈。先检索完整应用 `site:github.com typewriter mechanical keyboard sound desktop app Mechvibes license`，后检索框架/组件 `site:github.com goldfire howler.js release license Web Audio`、`site:github.com joshwcomeau use-sound license`。网页检索成功，逐项读取当前 package.json：

- [Mechvibes](https://github.com/hainguyents13/mechvibes)，v2.3.5、MIT、Electron ^12.2.3、iohook ^0.9.3、Howler ^2.2.4；成熟键盘音效应用，但全局键盘钩子和原生模块超出 Mochi 本次控件范围，不接入。音效包许可独立，不能外推为 MIT。
- [Howler](https://github.com/goldfire/howler.js)，2.2.4、MIT、零运行依赖；支持采样播放、音频精灵、音量/静音和 AudioContext 生命周期。适合多媒体播放器；本次仅生成短脉冲和噪声包络，直接用 Electron 39 已具备的 Web Audio 节点，不另加文件解码和跨浏览器降级层。参考其单一音频总线和手势解锁原则，不复制源码。
- [use-sound](https://github.com/joshwcomeau/use-sound)，5.0.0、MIT、React >=16.8 与本机 React18 范围兼容，依赖 Howler ^2.2.4；未实际接入，维护活跃度/最新提交时间本轮未核实。因既有插件既有 React 控件又有原生 HTML 窗口，不新增仅 React 的第二套播放生命周期。

本机 PommeToys 1.1.5(13) 的声音资源已只读核实：fax-send-key 78ms、fax-feed-1 22ms、fax-print-1 11ms、fax-tear 154ms、set2-key-press 64ms，均 44.1kHz 单声道。官网 instrument.js 实查按钮、档位、拨杆走单一音频总线，0 档静音；本机通用设置 AX 明确界面音效覆盖开关、挡位、推子、按键和拨杆。文件名/时长能证实短促分层素材，不能证明完整发送动画时序。反馈专线打开、分类切换可观察；没有向支持台发送数据，完整成功/失败时序仍未验证。

实现采用原创短促机械合成声（按下/回弹、拨杆止动、进纸），不给每次打字配声，不播放未经真实状态确认的成功音。提供可关闭的本机偏好、手势后创建上下文、有限时长和销毁清理；不得复用 PommeToys 私有录音文件。视效只装饰原提交，维护风险是宿主提交阶段钩子变化；用假失败夹具证明不清草稿、不冒充送达，并测静音、按键重复和音频上下文释放。

接入后验证（纸白/层级/音效）：`npm --prefix apps/desktop run build`、主题 10 项测试、LAN 客户端 25 项测试、原生 preload allowlist 测试、doctor Electron 测试通过。`test-paper-ui.mjs` 在真实 Electron 中加载当前 LAN React 客户端、主题样式、日夜旋钮与 Web Audio；网络及 theme 服务为隔离夹具。验证 light/dark/system、偏好重载、减少动效、窄屏无横向溢出、请求先于连接设置、确认前无 POST、失败可重试、静音持久化和真实音源创建。原生 rail 夹具验证明暗纸白、音效偏好同步、桌宠展开收起、弹窗回执失败及 64 人名单滚动。截图和原创音效试听位于 `docs/evidence/ui-paper-2026-09-27/`，不含真实学生记录。

完整教师宿主仍未验收：`test-teacher-model-live-ui.mjs` 的后台在 90 秒内未就绪，多次换 Electron run-as-node/独立 Node 仍失败；隔离文件访问跟踪显示停留在 DSH profile 的依赖回退扫描、尚未抵达 web 页面。这里是已确认的阻塞位置，不足以断言根因是网络或磁盘。没有据组件夹具声称整壳已通过，也未替换用户已安装的 Mochi 应用。本轮保留其它在途修改。

补充验证与修正：2026-09-27 继续核对宿主 `SettingsScopeController` / `settings-contract.d.ts`，确认 `bind/getSnapshot/subscribe/set` 具备宿主持久化、版本栅栏和失败恢复。发现随机启动端口使原 localStorage 音效偏好无法跨启动可靠保存，改复用 `jxl-theme.uiSound` 的布尔 schema 与现有 settingsScope；加载完成前保持静音，写入期间避免重复操作，失败保留已接受状态并允许重试。没有引入新依赖或第二份设置库。主题 13 项测试（含键盘拨杆音效）、TypeScript 构建和真实 Electron 组件测试通过，额外验证更换 origin 后仍恢复宿主静音；教室端请求/教师回复也加入实际 React 测试。

启动排查获得新证据：桌面 node_modules 多个文件带 macOS `dataless` 标记，首次读取触发云端取回。只读取回 DSH 及运行依赖后，独立 profile 回退扫描从约 36.6 秒缩短到约 0.1 秒；但完整宿主仍超时，文件跟踪随后进入校园插件自身的嵌套依赖。故云端占位读取是已证实的耗时因素，不能据此宣称已找出全部根因；继续保留原 90 秒就绪上限，未以加长超时掩盖问题。

### 2026-09-27 · Apple Design 层级复审

用户明确否定上一版主次与插件位置，要求使用 apple-design。重新读取该技能，以 purpose / grouping / wayfinding / simplicity 为准，米白材质不代表为每项内容叠卡片。补充检索先完整应用 `site:github.com/CherryHQ/cherry-studio sidebar settings appearance navigation`，后组件 `site:github.com/radix-ui/primitives popover dialog accessibility`；读取 Cherry Studio DESIGN.md / ui-semantic-contract（仓库与版本沿用上文已核验 2.1.3 / de2bc0a，新的 main 文档仅参考，不声称与该提交完全一致）与 Radix issue #4128，后者暴露非模态弹层键盘焦点约束，不引入新弹层库。许可证与依赖评估沿用上文；没有复制仓库实现。

本地实查当前 DSH settings.general.item 是 list slot，支持相同 id 不同 priority 的正式 shadowing，最小值生效，生命周期销毁会恢复原贡献。采用此接口把外观控件放回已有 appearance 设置行，复用 theme/settingsScope，移除侧栏外观和音效占位；保持原生导航顺序，不继续依赖过期 CSS hash。首页示例改为主动展开的辅助列表，欢迎区去卡片边框；侧栏校园入口维持可展开分组。长期维护只涉及自有插件与正式 slot 合约，风险用真实主窗口截图及键盘/关闭返回检查验证。

复审落地与验收：欢迎区去掉卡片与大面积装饰背景对比，示例消息默认折叠；校园工作默认折叠，外观/音效只占通用设置的 appearance 行，不再占侧栏。教室消息默认只展示请求/消息，连接与帮助为独立可返回内容层；预约时间单独呈现，关闭键缩到 32px，底部次级操作固定且不与正文抢层级。实际检查了新版主窗口、通用设置和预约弹窗截图；LAN 25 项测试、主题 13 项测试、TypeScript 和隔离 Electron 的页面切换/窄屏/失败回执测试通过。

完整宿主进展：从 npm 本地缓存恢复锁文件规定的 tmp@0.2.7，逐字节 SHA-512 与锁文件一致，没有改依赖版本。隔离源码运行目录避开原插件 .pnpm 云端读取死锁，以桌面同版本依赖运行，教师宿主模型/会话回归通过。进一步真实发送检查发现默认消息的短暂 admission phase 可被 React 批处理，旧 DOM-only 钩子不稳定；增加可信发送操作的即时装饰反馈，保留状态钩子去重，不读取消息内容用于声音、不修改草稿或发送接口、不宣称送达。真实主窗口的发送反馈断言与静音宿主持久化均通过。安装包、全部校园已登录页面和目标系统全量验收仍未完成。

### 2026-09-27 · bloub 原始引擎接入（修订复用决策）

用户进一步明确要求应用完整 bloub 动画，不满足于之前的动作参考。先复核上文完整应用/框架范围（Cherry Studio、WardenApp、DSH），补查插件生态，实际搜索词 `site:github.com/jeremy-prt/bloub BotEngine states animation`、`site:github.com bloub animated AI assistant Vue license`。检索成功，找到 [dsh-bloub-mood](https://github.com/Yuuhann1999/dsh-bloub-mood)；读取 main 的 package.json（2.4.4、MIT、无运行依赖、开发 jsdom ^29.1.1）、LICENSE 和 client-template.js 实现，确认使用 GIF 剧本、pending/running/completed 优先级、多会话全局汇总与 DOM 品牌替换。网页显示 46 次提交，当前提交 API 请求未成功，不能把 main 页面快照当作固定提交。该插件不直接安装：会重复桌面入口、改写用户选定品牌，并且预渲染片段不能实时承接当前姿态；仅作状态连接参照。

实际采用 [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub/tree/b4bb3c1b5f93c7b87a2e8d620f667c4093d97749) 0.1.1 原始 BotEngine；GitHub API 确認 main 仍为 b4bb3c1b5f93c7b87a2e8d620f667c4093d97749，2026-08-17。读取 LICENSE、package.json、engine/states/decor/face/eyefit/skins 源文件，确认引擎闭包无 Vue、网络、定时器或第三方运行依赖。原封保留所需 TypeScript 模块、MIT 全文及逐文件 SHA256，另写 Mochi 皮肤与 DOM/React 适配。复用 14 状态和 swirl、sample 时间采样、setState 中断接续、setLook 注视；不另写形变求解器。原“因体积不接入引擎”的结论由本条取代，现通过单源构建供聊天、启动和原生悬浮页使用，减少重复逻辑。

长期维护：固定上游提交、升级比对哈希，不引入 Vue/Vite/导出视频依赖；保留 Mochi 焦糖配色、小电脑与用户指定品牌图。渲染须暂停隐藏窗口/屏外历史头像，减少动效只展示静态状态，动作以真实运行语义驱动，成功与错误不能凭计时器捏造。此前校园页面全量测试在导航 locator 处超时（页面已有菜单文字），不是已通过；继续修正测试后验证，不与本轮引擎接入混为已完成。

bloub 接入后验证：原封 10 个上游模块（含固定提交/逐文件 SHA256 与 MIT），Mochi DOM 适配及 React 外壳共用核心，生成含许可证的原生脚本约 31 KB。全部 14 原始动作和 swirl 均进入启动、思考、回复、等待确认、完成、错误与休息的编排；配色改用焦糖/米白/灰绿，小电脑继续保留。原生教师悬浮窗以真实待办和同步健康驱动提醒/等待/错误，不把待办变化冒充模型思考或任务成功。历史小头像静态、页面隐藏/屏外暂停、减少动效固定状态、DOM 移除/插件卸载销毁 React root 与时钟。

验证通过：上游哈希未改；15 动作共 2,250 次采样有限且确定；短间隔三次切换保持当前身体路径；各编排不截断原始 minDuration；真实 Electron 动作板验证播放、中途切换、减少动效、dispose；原生 rail 回归含展开/收起、提醒、同步异常、键盘、减少动效后的 SVG 停帧和 64 人教室名单；主进程构建、备用 React 渲染器类型检查/Vite 构建通过。实际 DSH 教师宿主使用延迟流式模型夹具，确认首字等待挂载 bloub thinking、流式正文挂载 typing、正常结束挂载 celebrate 并移除 pending，模型 A/B 凭据与会话回归通过。完整宿主的 5 个设置分区和 5 个校园已登录页面也完成渲染/返回检查，校园 API 全部为匹配真实契约的测试响应（零未覆盖路由），不能据此宣称真实校园服务已验收。

检查中修正：原生旧测试依赖已移除的 CSS 表情节点，已改为检查新 SVG 引擎实际绘制与停止；减少动效媒体通知异步送达，测试等待引擎接收后再比较图形；完成动画从 1.6s 延至 4.2s，覆盖粒子回收与眨眼。截图与可交互动作板保存在 docs/evidence/ui-paper-2026-09-27。开发运行树通过；本轮未更新 Mac 安装包、未进行 Windows 实机验证。

### 2026-09-27 · 校园页面返回入口位置复审

先检索完整宿主生态 `site:github.com deepseek-ai deepseek-harness client ui slots toolbar status`，读取 [DSH sidebar-right](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sidebar-right.md)；本地继续固定既有 0.1.3-alpha.1/MIT，不迁移当前页面至新版 docking API，避免与在用组件挂载/认证生命周期冲突。再检索 `site:github.com radix-ui primitives dialog close toolbar accessibility`，读取 [Radix dialog](https://github.com/radix-ui/primitives/blob/main/packages/react/dialog/src/dialog.tsx) 的关闭及焦点恢复机制。网页搜索成功，main 文档本轮未锁提交且未引入代码，不能宣称新版本已适配；许可证、依赖兼容评估沿用前文，不新增依赖。

现有实际校园截图确认右上角返回按钮与宿主窗口控件挤在同一区域。采用既有返回函数和 ESC 路径，仅把返回按钮置于标题左侧，统一可见位置并保留触达尺寸。长期维护只改自有组件样式，无全局控件重新定位；通过完整宿主测按钮在标题前、点击返回和五页面布局，避免只靠静态 CSS 推断。

安装产物复用复核：实际搜索 `site:github.com/CherryHQ/cherry-studio electron-builder directories output mac arm64` 与 `site:github.com/electron-userland/electron-builder directories output config CLI`，核对 Cherry Studio 配置与 electron-builder CLI 文档。继续使用本地实际读取的 electron-builder 25.1.8 / MIT、Electron 39.8.10；main 文档的新版本变动不用于升级依赖。采用现有源码资源准备、ABI 和 peer 校验，仅通过既有 CLI 的 directories.output 覆盖将 Mac arm64 测试包生成到独立目录，不覆盖旧 release；不写入密钥种子、不发布。独立输出增加磁盘占用，但本机当前有约 100 GiB 可用空间。

校园标题栏修正验证：完整教师宿主的五个设置分区、五个已登录校园页面再次通过，五页均断言返回按钮位于标题左侧且标题栏不横向溢出；截图重新生成。旧导航单测仍假定校园分组默认展开，已同步为上轮确认的默认折叠行为，并验证点击展开，测试通过。

补充深色核验：五个校园页面都跟随宿主切换到 dark，纸面背景为 rgb(36,35,32)。截图发现入场透明度阶段会透出背后对话，给活动校园承载区加同色实底，保留页面入场动作，避免文字叠影；截图等待实际动画 finished 后捕获。

打包预检状态：925 个 host peer 包校验通过。默认 ABI 探针选了旧 release/mac-arm64 的运行时，报告 dlopen 失败；直接使用本次 electron 39.8.10 的运行时重新加载与完整守卫检查，三个二进制均 LOADED / ABI 140，通过。因此不能把初次失败认定为依赖编译版本错误，未改原生二进制。资源准备正在执行 `prepareReleaseInput`，截至本条记录仍有已确认存活的 git status 子进程读取校园源码美术文件，路径持续推进；不把观察等待误判成进程失败。

### 2026-09-27 · 登录可见性与今晚安装交付

用户确认隐藏侧栏校园工作整组，并明确班主任登录后才出现。先检索完整应用 `site:github.com/CherryHQ/cherry-studio provider api key storage electron`，再检索宿主/插件生态 `site:github.com/deepseek-ai/deepseek-harness credentials settings plugin authorization`。搜索成功，后者找到官方 credentials/authorization/settings 原理及 dsh-auth-gate 社区插件；完整应用查询没有得到直接可复用结果。沿用本地已核 DSH 0.1.3-alpha.1/MIT，不安装额外登录网关或迁移新版 credentials API。官方 master 文档未锁提交，仅核对职责，不声称适配新版本。实际接入依据是当前联动计划 /api/auth/me、HEAD_TEACHER 与 campus:auth-invalid 契约，现有同源代理和设置 slot；无需新依赖或复制其它仓库源码。后端继续承担每项业务权限，前端只管理入口可见性。检查失败不展示入口；已确认登录后短暂网络失败不误登出，401/明确失效立即收起。维护成本是一个可销毁的身份探测与已有校园登录页复用。

上轮 release-input 已完成，static manifest SHA256 为 2af2942fb49ffdb07a3c931dce4f6ac08fdea06297b9ab851051255577d0d64c。用户本轮明确要求带正常首启密钥注入的双平台正式安装产物，取代上轮无密钥测试包计划。所有密钥验证只报告引用名/是否配置，不输出值。

登录入口本轮实测：同源 /jxl-api/auth/me 驱动校园工作整组；HEAD_TEACHER 且无需强制改密才展示，其他角色或未登录隐藏。通用设置保留校园账号入口，复用原登录页，按官方 settings.close slot 的按钮关闭设置后进入。身份轮询仅前台运行，普通空闲 30s、校园页打开 5s；失效事件有版本栅栏，避免旧请求恢复已退出状态。导航单测及真实教师宿主（设置五区、校园五页明暗、未登录隐藏、登录入口打开/关闭）通过。

完整消息截图重新生成：双 Electron 教师/教室隔离服务，12 次确定性模型工具编排；实际配对、学生预约、教师确认、签名回复投递全部通过，未显示凭据值。按用户要求只收完整窗口，提供 21 张 PNG 和离线索引（实际数量以压缩包清单为准），不裁剪、不后期补画。截图的演示响应不能代替真实校园后端联调。新 Windows/Mac 安装包尚未构建；本机原生打包守卫明确要求 Windows 安装器在 Windows runner 生成，下一步需核对现有 CI 与构建权限。

### 2026-09-27 · 双角色首启密钥修正

开工检索先完整应用 `site:github.com/CherryHQ/cherry-studio apiKey provider electron`，后框架 `site:github.com/deepseek-ai/deepseek-harness credentials-local environment file`；搜索成功，完整应用未获得直接匹配，框架命中官方 credentials-local 文档。继续部分采用现有 DSH 0.1.3-alpha.1/MIT 的文件凭据机制与运行时按请求解析；不迁移主分支新接口，不引入新的密钥库。main 文档未固定提交，实际实现依据已安装源码与本项目 seed.ts。已确认本机密钥源含 MIMO_API_KEY、MOCHI_AIAAA_API_KEY，仅报告引用名。代码当前教室角色提前返回 disabled，Windows workflow 传入 --without-key-seeds，均与最新用户要求不符。改为教室独立 home 只补齐 MiMo 引用，不读取教师 home；教师继续两引用和自己的默认模型。现有用户值保持不动。长期维护沿用同一注入函数与角色最小引用表，测试新装、升级、重复启动、权限与实际 DSH 解析。

双角色修正已验证：新增 test-first-run-seeds.mjs 以真正 LocalCredentialProvider 完成初始化后解析出厂凭据，覆盖 teacher/classroom 的全新 home、0600 权限、教室不写入教师网关引用、重复启动和用户更改保留；通过。教室模型默认/自定义/旧引用及环境优先级的既有适配器测试、主进程 TypeScript 构建通过。正式 package-desktop 使用 --require-complete，缺任一出厂凭据即停止；测试包仍可显式退出种子模式。Windows workflow 已改用 GitHub Secrets 和安装前后 --expect-seeds 冒烟，不再强制排除凭据。该冒烟清除环境密钥，比较实际 fresh home 与安装资源，不打印密钥值；尚待真实产物执行，不能据静态脚本声称已通过。

Windows 源快照重新登记并核对 555 文件、91,255,180 字节、零缺失/漂移，移除只用于本机同步标记且已不存在的 migrations/.nosync 条目。GitHub CLI 未登录，连接器已确认私有校园仓库可读写，但不提供 Secrets 管理；已请求用户恢复 gh 登录，不请求其发送令牌。Mac electron-builder 当前运行 session 66755 / PID 23384，依赖读取路径持续变化，无终止证据，不重复启动。新安装器仍未交付、未安装替换用户应用。

Mac 实包检查继续：首个 builder session 66755 已退出 1，明确缺少 MOCHI_PLAYWRIGHT_BROWSER_RESOURCE_ROOT；并非仅观察超时。旧 release/mac 的浏览器主程序/声明文件 4 项哈希匹配，提取允许的 5 项顶层资源、排除多余 mochi-pw-hold 备份目录后启动第二次构建 session 38195。独立真实 Playwright 启动揭示旧资源缺失 Chromium Framework 的 Helpers/chrome_crashpad_handler，浏览器子进程崩溃。不能用主程序哈希通过替代完整运行验收，主动终止第二次构建（退出143），改下载锁定 Playwright 1.55.0 对应 Chromium 1187 的完整资源。目前下载命令 session 28251 / PID 24532，尚未完成。打包依赖预读已完成（340 packages / 4790 files），不再有该预读进程。

### 2026-09-27 · 安装产物内浏览器运行门禁

补查完整应用 `site:github.com/CherryHQ/cherry-studio playwright browser` 与框架 `site:github.com/microsoft/playwright browsers chromium executablePath`，检索成功，完整应用未给出可直接复用检查，官方 Playwright launch/executablePath 文档和 registry 源码确认可指定实际随包浏览器。采用已安装 Playwright 1.55.0 / Apache-2.0，Chromium 1187 / 140.0.7339.16；固定版本沿用，不追 main，不加依赖。新增很小的实际启动/DOM/截图门禁，避免再次仅凭主二进制哈希通过就漏掉缺失 Helpers。长期维护复用浏览器元数据和项目现有 Playwright API；门禁只用临时本地页面，不访问真实校园或外网业务数据。

完整 Chromium 1187 已由锁定 Playwright 1.55.0 官方下载器取回；主程序哈希与旧件一致，进一步证实旧件问题在辅助资源缺失。干净目录 /tmp/mochi-browser-full-20260927 的哈希、真实启动、DOM、截图门禁全部通过。新增 check-packaged-browser.mjs 并接入 Windows 安装前/后的实际资源路径。第三次 Mac builder session 59328 / PID 24913 正在复制运行资源，路径从 zod 源文件持续推进到 @pdf-lib/upng，未退出。Windows Git 独立传输验证两次明确失败（HTTP2 framing、HTTP1 低速超时），不把传输失败误记为仓库无权限；连接器此前已确认私有仓库权限。当前源快照 556 文件且校验通过。

暂存产物进一步验证：第三次构建的 .mochi-package-resources-staging-CmVDGh 中，品牌、主题、校园入口与教室消息四个 client.js 均与当前源码逐字节哈希一致；随包 Chromium 的真实启动、DOM 和截图门禁通过。出厂种子包含两个预期引用，只记录引用名与存在性，不记录密钥值。线上默认校园后端 https://jyl-campus-health-entry.pages.dev 的 /api/auth/me、/api/messages、/api/movements、/api/movement-requests、/api/students 在无登录状态均返回 401 / UNAUTHENTICATED。该证据仅证明未认证访问被拒绝，不代替已登录角色和真实业务验收。

教师端演示压缩包交付复核：Mochi-教师端完整界面演示-20260927.zip 含 21 张完整窗口 PNG、开始浏览.html 和说明.txt；ZIP CRC 检查无损坏、浏览页本地引用无缺失，实际查看已发送预约窗口，保留侧栏、会话、上下文和输入区。图中是隔离演示数据。当前 Mac 构建进程 24913 / session 59328 仍存活且复制位置已推进至 pdfjs-dist/cmaps；尚不能把暂存检查记为最终 DMG 验收。gh auth status 仍明确未登录，Windows 原生构建尚未触发。

Mac 构建资源准备和原生依赖重建已通过，第三次 builder 59328 / PID 24913 进入应用封装；依赖中的 iCloud dataless 文件持续造成逐文件等待。为避免仅反复等待，在保留原构建的同时，将已审核的 556 文件 / 91,257,137 字节源快照逐项核对 SHA256 后复制到非 iCloud 临时目录 mochi-release-local-20260927-ijs6zgxz，使用同一 package-lock 执行 npm ci（session 92292）。这是临时发布输入副本，不是新源码分支，不修改原依赖或源文件；尚无第二构建产物，原构建仍活跃。预读剩余安装文件的当前 session 为 82994，旧只读预读进程已终止，避免重复占用。

Mac 最终安装器验收：本地副本 npm ci 首次因 Python 3.14 缺 distutils 失败；改现有 Python 3.11 后遇 Electron 下载超时；最终以 ELECTRON_SKIP_BINARY_DOWNLOAD=1 安装锁定依赖成功，并核对/复用原已验证 Electron 39.8.10 dist（无版本替换）。TypeScript 编译、925 包运行依赖检查通过。builder session 11572 退出0，DMG 731,991,819字节，SHA256 99dc6bba20581c9169451568e5ac1c7ba2040a1f4aeb12b596748ac2d3e1ae91，hdiutil 全镜像校验通过。最终应用 Chromium 运行门禁、3 个原生 ABI140 模块、教师和教室 --expect-seeds 均通过；从 DMG 安装到 /Applications/Mochi.app 后，两角色首启注入与 Chromium 门禁再次通过。已打开真实用户主窗口并目视核验米白界面/未登录校园入口隐藏，四个界面插件哈希与源码一致。原云端构建在已获得并验证替代产物后主动结束143，不是因观察超时而重启。旧版清理 session 73613 正在逐项移动至废纸篓，实时记录 deliverables/2026-09-27/旧版清理记录.json；Windows 仍未构建。

### 2026-09-27 · 双平台校园静态界面一致性

实际先检索完整应用 `site:github.com/CherryHQ/cherry-studio electron-builder github workflow build artifacts`，再框架 `site:github.com/electron-userland/electron-builder extraResources prebuilt resources`、插件生态 `site:github.com/actions/download-artifact digest validation`。真实仓库为 https://github.com/CherryHQ/cherry-studio 、https://github.com/electron-userland/electron-builder 、https://github.com/actions/download-artifact 。搜索结果提供 Cherry 的校验后复用产物流程、electron-builder extraResources 与官方 Actions digest 文档；部分打开请求与 v25.1.8 标签地址返回404，download-artifact 网页被 robots 拒绝，不能将这些记为已读固定提交。Cherry main 搜索快照只作流程参照，没有复制其代码或声称适配。实际采用本地已安装 electron-builder / app-builder-lib 25.1.8（package.json 确认 MIT，无 gitHead），以及本项目既有 prepare-release-input.cjs 的 verifyReleaseInput / staticInventory，未加依赖。现成功能已在本次最终 Mac 产物中验证，维护成本限于同一静态输入清单与 Windows 流程门禁。

发现 Mac 发布清单 source.git.dirty=true，校园源 HEAD cd17ff8337e20ed02f632fbf97625e0b668cc3cf；GitHub API 确认远端 main 是 2d04c38df62f643db31e9aaae0f46319000b7718。原 Windows 流程重新编译远端源码不能证明与 Mac UI 一致。改用私有构建分支的独立 mochi-campus-release-input 输入（不进入 Mochi 公开源快照、不包含工厂凭据），固定原已验收 manifest SHA256 2af2942fb49ffdb07a3c931dce4f6ac08fdea06297b9ab851051255577d0d64c；Windows 打包前验证完整输入，打包后及 NSIS 安装后比较全部 133 个静态文件。停止在 CI 重编译校园 main，避免遗漏本地 UI 修改，同时不上传无关校园脏源码。

验证：YAML 解析、提取并实际执行 Windows 流程中的 Node 校验命令、GITHUB_ENV 写入、已安装 Mac 静态资源逐文件一致、错误 manifest digest 拒绝、安装前后两个门禁存在均通过。Mochi 源快照仍为556文件且零漂移。私有 overlay 已在本地临时目录准备，记录在 deliverables/2026-09-27/windows-build-input.json。尝试建立本地待推送分支时发现校园仓库的 origin/main 引用存在但对应对象不可读取（cat-file 明确失败），故未创建提交或推送；需 gh 登录后取得已核验远端基准。Windows runner 未运行，不宣称 Windows 验收通过。

安装后补充验收：原生 CUA 实际操作 /Applications/Mochi.app，外观按白天→跟随系统→夜间→白天切换，已目视检查夜间设置层级，并恢复用户原选项。通用设置校园账号入口正确关闭设置、显示加载状态、进入真实登录表单，返回对话成功。登录页“非官方演示环境”在校园 src/pages/LoginPage.tsx 为固定文案，不将其当作服务端运行模式证据；已向用户询问今晚演示或正式业务及对应后端地址，未输入账号或更改该文案。旧版清理两次进程均正常退出，共89项（含3个旧Mochi.app、旧安装器和3个无应用载荷的历史Electron构建壳）进入废纸篓；原路径均不存在、废纸篓条目均存在、零失败。用户配置与会话保留，新版应用继续运行。

### 2026-09-27 · 红色发送键、简化模式与旧会话兼容

先检索完整应用 `site:github.com CherryHQ cherry-studio icons sidebar agent presets electron packaging`，再框架/插件生态 `site:github.com deepseek-ai deepseek-harness agent-presets standard`，最后组件 `site:github.com lucide-icons lucide stroke width` 与 `site:github.com 6tail lunar-javascript license festivals`。实际查看 https://github.com/CherryHQ/cherry-studio （AGPL-3.0，只参考完整应用组织，不复制代码）、https://github.com/deepseek-ai/deepseek-harness （本地锁定 0.1.3-alpha.1/MIT）、https://github.com/lucide-icons/lucide （ISC，本轮不引入图标依赖）、https://github.com/6tail/lunar-javascript （MIT，农历节日能力候选，尚未接入）。网页 main 未固定提交，不据 README 声称已适配；代码依据已安装 DSH 的实际 composer aria-label、官方命令和 preset.yml。

采用现有原生输入框与模式协议，仅将可发送键改为朱红色，空输入/禁用低对比，停止按钮保留独立语义。恢复已安装 standard/minimal/ptc/cordis 预设，避免历史会话因过滤根目录无法恢复；不迁移或删除历史消息。移除模式解释小字，保留真实后端状态与中文失败摘要。维护成本限于既有插件源文件和针对历史预设恢复的回归检查，不升级框架、不引入整套 UI 依赖。

追加思考指示位置修复：检索完整应用 `site:github.com/CherryHQ/cherry-studio "MessageLoading"` 与框架生态 `site:github.com/deepseek-ai/deepseek-harness "assistant-step" "chat-flow"`；前者未找到可复用结果，后者命中 https://github.com/AwesomeHou/dsh-trace-collapse 等消息流插件（只读搜索结果，未固定版本、未引入）。实际核对已安装 DSH 0.1.3-alpha.1 的 TurnStatus 和 data-chat-flow：等待提示原先被自有插件挂在 sticky composer seat，导致截图所见左下角布局。采用现有 TurnStatus 的真实运行状态和计时器挂载角色，消息流作兜底，移除输入框挂载路径；28px 增大为48px，保持同一动画引擎。继续遵循 apple-design 的空间一致性，不新增悬浮层或劫持滚动。

节日实现复核：GitHub API 锁定 lunar-javascript 1.7.7 / 4c45a59f79b856125516f31aefa8295035c16afd（提交日期2025-11-05），MIT 原文已读，零运行依赖，UMD/CJS 可由现有 esbuild 打入浏览器。实际执行 Solar.fromYmd/getLunar/getFestivals 验证 2026除夕、春节、端午、中秋及2027春节；采用上游原始 lunar.js 并保存许可证和 SHA256，不重写农历算法。不采用年度调休数据：用户要节日本日问候，不是法定休假或外部群发。仅本地日期变化时更新原生 locale 字典，跨午夜和休眠恢复重新计算；节日用白名单祝福，清明用平和文案。上游文件约426KiB，离线可用且不会新增网络请求。Cherry完整应用本轮 API 提交为5846b0e6b71adfd46baf094259823e1519e3afd6，仅作生态参照。

托盘图标实包缺失：新增检索 `site:github.com/electron/electron "setTemplateImage" "Tray"`、`site:github.com/electron-userland/electron-builder "buildResources" "extraResources"`。先前完整应用/框架检索结论继续适用；本次 builder 官方仓库 issue1495/1790 命中资源目录不自动包含的同类问题，不以 issue 当作适配结果。采用现有 electron-builder25.1.8/MIT extraResources 和 Electron39.8.10/MIT nativeImage，不加依赖。实际 @electron/asar.listPackage 检查 /Applications/Mochi.app 的 app.asar 中没有任何 /build/ 条目；main 的图标加载 catch 退回 getFileIcon(process.execPath)，与用户 exec 图一致。改为明确随包 icons 资源，加载失败给出错误，不退回无关可执行文件图标。Mac 模板自动适应菜单栏明暗，Windows 读取随包 ICO。

桌宠拖动：复用 Electron39.8.10 的 BrowserWindow.setPosition 与现有 clampPositionToDisplays/位置记忆，不引入拖拽框架；原 collapsed 按钮占满窗口且标记 no-drag，原生 header drag 区不可触达。增加指针捕获与5px拖动阈值，拖动不触发展开；主进程只接受所属 rail sender 的有限坐标，限制在显示器工作区，取消/失焦结束拖动。网页不获得通用窗口控制能力。

身份切换复核：检索完整应用 `site:github.com/CherryHQ/cherry-studio "partition" "login"`，官方框架 `site:github.com/electron/electron "session.fetch" "onCompleted"`。Cherry 浏览器私有 partition 仅作隔离思路参考，不复制 AGPL 代码；Electron搜索未提供直接组合实现，不记为无成熟能力。实际本地 Electron39.8.10类型与现有校园 worker/routes/auth.ts 确认 POST /api/auth/login、GET /api/auth/me、HEAD_TEACHER/mustChangePassword 契约。采用既有校园登录页面和非持久 Electron session；主进程在真实账号登录响应后重新向后端查身份，不能由 renderer 提交角色布尔值；演示快捷登录不算验证。用户确认教室→教师必须验证，入口保护必须覆盖 tray、second-instance 与已声明教室设备的直接教师启动，不读取教师运行目录后再验证。

按需浏览器用户已明确授权。测量已安装资源：Chromium913MiB、headless182MiB、ffmpeg2.5MiB。完整应用 Cherry 的浏览器架构已查；框架进一步直接查 https://github.com/microsoft/playwright/blob/v1.55.0/packages/playwright-core/src/server/registry/index.ts 与 browserFetcher.ts。采用已锁定1.55.0/Apache-2.0官方CLI安装器，保留它的安装锁、镜像重试和完成标记，不自行实现下载解压。薄适配仅在 Chromium launch/launchPersistentContext/launchServer 首次调用时检查并触发官方安装，普通启动不下载；下载后仍由实际浏览器启动验证。缓存放用户可写目录，失败允许下次重试，不写入只读应用安装目录。完整离线模式保留为显式构建选项；本轮默认按需。

### 2026-09-27 · Yan-Agent 与校园登录入口恢复

实际检索先完整应用 `site:github.com yanAgent`、`site:github.com yan agent sidebar browser`，后框架与插件 `site:github.com/deepseek-ai/deepseek-harness tools schemas system prompt`、`site:github.com/omdsh-dev/DSH-better-sidebar sidebar_open agentOpenTools`。Yan 原地址 https://github.com/666-gy/Yan-Agent 已重定向 https://github.com/ViaTumLab/Yan-Agent 。GitHub 连接器确认提交 98430d3f46433a3a3b70abf670e418b75e3a5684；查看 package.json 1.6.1、MIT LICENSE 和该提交 main.js，确认 OpenCode 工具映射、按 runId/callId 跟踪浏览器调用与动作白名单。直接 curl API 的 SSL 连接失败，随后连接器成功，不是仓库无权限。其 Electron31/OpenCode1.18.11 与本项目 Electron39/DSH0.1.3 内核不同，不整套复制；部分采用交互职责分离思路。现有 DSH-better-sidebar0.18.0/MIT 已含 sidebar_open、会话隔离与 delivered 回执，先复用既有工具，不重写文件打开服务；尚未完成集成验证。

用户反馈校园登录消失：实查登录仍在通用设置的 CampusAccount，校园工作组被正确按 HEAD_TEACHER 隐藏，但导致未登录用户在侧栏找不到入口。复用现有 CampusAccount/openWidget/dashboard 登录路由与官方 sidebar.footer.action，增加独立且始终可见的校园账号按钮；业务组继续只在已登录且完成密码设置的班主任可见。后端 CampusConnection 仍用同一登录 token 调 API、按对话绑定账号并阻止换号后的旧响应，不以隐藏 UI 代替权限。无新依赖，不修改校园后端权限、登录协议或浏览器下载策略。

用户随后明确调整：校园登录保留在设置、提升层级，不要独立侧栏入口。本条取代上段的入口布局决策。重新读取 apple-design，按熟悉性、分组、路径可辨识设计：账号在通用设置第一项（order=-100），头像、名称/登录状态、单个登录操作成组，外观设置在其后；已撤掉刚新增的侧栏账号按钮。查询失败提示同步指向“设置顶部用户账号”。导航与12组会话恢复/换号保护测试通过；真实窗口位置与登录返回路径继续验收。

工具接通补充：实查 mochi-modes 的对话模式 allowlist 漏掉所有 jxl 查询，导致后端虽在、模型日常对话却看不到校园查询。加入已注册校园只读工具与 sidebar_open 的交集；未注册的教室端工具不被凭空添加，写操作仍走工作模式及原审批。mochi-hello 根据本轮实际 tool schemas 注入侧栏交付和校园登录指引，不虚构浏览器读取能力。桌面教师 home 仅在用户未设置时启用既有 agentOpenTools，保留明确 false；复用锁定 yaml2.9.0 的 AST 编辑保留其余设置，不改上游 sidebar 实现。25项模式/提示词测试通过，后续以实际模型请求核对 schema。

### 2026-09-27 · Windows 原生检出换行修正

延续已审阅完整应用 Cherry / Yan-Agent 与现有打包生态，针对真实 runner 失败补查 `site:github.com/actions/checkout Windows core.autocrlf gitattributes -text`，命中 https://github.com/actions/checkout/issues/226 与官方 Git attributes 文档。继续使用锁定 checkout 11bd71901bbe5b1630ceea73d27597364c9af683 / MIT；采用 Git 原生 core.autocrlf=false，在检出前设置，不替换打包框架、不降低 SHA256 门禁、不增加依赖。首跑36329811115确认因 chromium LICENSE 字节数不符停止，源码本地 hash 通过且 text/eol 未指定，符合 Windows 换行转换；修正是否有效以第二次原生 runner 为准。

安装位置回归发现：按需预加载从自身位置解析 playwright-core，在构建目录意外借用了开发 node_modules；/Applications 独立目录失败。补查 `site:github.com/microsoft/playwright playwright-core package.json nested require.resolve createRequire`，继续使用官方1.55.0/Apache-2.0的 package.json 导出与 CLI，无新依赖。改为从实际已加载 Playwright 模块位置创建 require 解析其 core 包，兼容 nested/hoisted 安装；own-property 检查避免读取循环模块代理。以安装后真实 Chromium 启动、DOM、截图重新验收，不能沿用构建目录通过结论。

### 2026-09-27 · 桌宠关闭后唤醒与通知寿命

先完整应用检索 `site:github.com desktop pet electron hide tray persistent settings`，再框架 `site:github.com/electron/electron ready-to-show hide showInactive`。查到 https://github.com/kokoronoka/desktopPet 提交9ee7815a7c2e973207d625c21c7a5e4182775ad3，有托盘显隐/保存状态；GitHub license 返回null，未发现可确认授权，故不复制代码。沿用 Electron39.8.10/MIT 和本项目原子JSON位置存储，不增加桌宠框架。确认现有 ready-to-show 无条件show、main railVisible每次启动为true，修正为用户可见意图优先，位置文件向后兼容增加分角色visibility；原生关闭与页面关闭统一。维护成本仅现有状态机和可选存储方法。通知代码无自动消失定时器，确认回执与关闭区分，inbox最多1000且仅回收已签收普通通知；不承诺永久保存。新增迟到首帧、健康同步、原生关闭、跨重启与角色隔离回归。

Windows run36330156229源码/静态资源校验通过，语音包测试在重命名解包目录时EPERM。补查 https://github.com/jprichardson/node-fs-extra 和 https://github.com/isaacs/node-graceful-fs，搜索 `site:github.com/jprichardson/node-fs-extra Windows rename EPERM graceful-fs retry` / `site:github.com/isaacs/node-graceful-fs rename EACCES EPERM 60000`。本次不引入重试库：实际 sha256File 在read stream end事件立即resolve，而文件close未完成；沿用Node22/Electron39已有stream.pipeline，等待句柄关闭再rename，保留原备份回滚。杀毒占用是可能原因但尚未证实，不用它替代本地代码缺陷。原生runner须重验。

用户追加：应用头像放大、桌宠边角缩放但不要可见手柄、已处理通知退出当前待办。继续复用 Electron39.8.10 窗口尺寸 API、现有 pointer capture 与共享 OrbCompanion/bloub 引擎；不引入完整桌宠项目（上段应用授权不明）、不引入独立拖拽状态库。桌宠默认96px，主进程强制72–160px、正方形、角色独立持久化；透明边角仅有缩放光标及无障碍名称，无文字/可见手柄，身体拖动独立。欢迎72px/消息44px/思考64px；面板收起按钮位置随宠物尺寸调整，维持点击位置连续。教师已送达回复移出当前待办，教室已签收通知退出常驻板；原始消息/回执仍留历史，未确认、投递失败与未知不能自动清理。截图复用现有真实Electron隔离夹具及匹配契约的演示后端，不合成业务结果。

Windows run36331432528中，源码校验、依赖/逻辑门禁、语音包安装测试和原生桌宠窗口交互均通过。后置截图清单仍要求4张，而实际脚本已生成6张（新增teacher-todo-dark与notification），导致清单门禁失败。仅将workflow预期名单更新为实际已声明6张，保留严格匹配和非空检查；无需增加依赖或更换截图工具。

Windows run36331853876在恢复96px窗口后立即读取renderer，读到前一帧100px居中留下的2px偏移。补查 `site:github.com/electron/electron setBounds resize renderer asynchronous`，官方 https://github.com/electron/electron/blob/main/docs/api/browser-window.md 与ipc-renderer文档；延续前述完整桌宠应用和框架评审，使用锁定Electron39.8.10/MIT既有异步等待，不新增依赖。测试等待DOM与原生尺寸一致后保留精确边界断言，不放宽容差。同时补齐artifact和draft release的六张截图名单，避免检查六张却上传四张。用户措辞修正采用现有通知模板，将“有人喊你”改为“学生呼叫”，不改变通知来源、收件范围或回执。

2026-09-28通知用语版Mac DMG：280572850字节，SHA256 723ac9960be97cd3c316bcab6a2e6a7b9f7a75c8ba4bd1c910ef17f4143e00ac，hdiutil CRC D7C41DAF通过。DMG安装后teacher/classroom --expect-seeds及按需Chromium实际启动/DOM/截图再次通过。34张具名截图压缩包已同步学生呼叫正文并通过CRC。Windows当前run36332471926，未宣称完成。

### 2026-09-28 · 教室执行 WPS 课件打开
先检索 `site:github.com classroom management remote open file Veyon license`，再 `site:github.com electron shell openPath WPS presentation open application` 和 `site:github.com sindresorhus open apps windows application path license`。完整应用 https://github.com/veyon/veyon 提交22218d772dba639819938911b47ab80924c6c87f / GPL-2.0，现有分发教材与远程打开功能，但Qt/C++独立客户端与当前DSH/Electron不兼容，不复制代码。https://github.com/sindresorhus/open 提交41511103abd932225b605b8e7f9e565cc180b1b6 / MIT，支持指定应用启动；不加依赖，复用Node既有spawn/execFile和平台启动服务。它的启动返回也不能证明幻灯片已显示，故回执用LAUNCH_REQUESTED而非虚报OPENED。本机实际Info.plist核对WPS bundle ID com.kingsoft.wpsoffice.mac。Windows仅尝试App Paths和标准WPS安装目录，未知安装报错，不退回任意默认程序。服务层继续验证签名、配对身份、接收文件哈希和PPTX类型；无通用系统命令工具。维护增加一个固定WPS启动适配，无新增运行依赖。接入验证尚在进行。

WPS接入后验证：15项聊天工具与批准/角色边界测试、21项模式工具交集测试、既有签名文件传输全套（增加WPS指定动作、纯发送不打开、重复投递不重开、接收字节篡改拒绝、WPS失败独立于送达）及dispatch测试通过。Mac真实WPS显示演示课件《水从哪里来，又到哪里去？》，CUA已目视核验窗口；这不等于Windows实机验证。原生Windows前一run36332471926实际交互后清理测试profile时EBUSY，使用Node既有rmSync maxRetries/retryDelay等待子进程释放文件，保留失败退出，不忽略清理错误。

追加真实端到端验收：在隔离teacher/classroom数据目录进行真实HTTP签名配对、PPTX分块传输、接收校验和WPS启动，返回ACKNOWLEDGED与LAUNCH_REQUESTED；CUA确认接收端文件wps-classroom-deck.pptx的7页演示内容已在WPS显示。证据docs/evidence/ui-paper-2026-09-27/wps-signed-mac.json。另核对锁定DSH attachment-local源码，上传文件保存在DSH_HOME/attachments/v1/files下并保留文件名，属于现有LAN受管根，不需新增任意目录读取权限。主动重新打开由新的现场确认允许；网络重复投递仍不重开。

Windows run36333604460通过WPS签名文件与聊天工具测试，在完整桌宠套件外层20秒总预算超时，未报单项断言失败。该套件现包含多个窗口及六次截图，外层改120秒，内部每项8秒边界与全部断言保持；不是跳过或放宽行为检查。最终以新run结果为准。

最终Mac WPS安装器280259601字节，SHA256 118b3e2d8a4e0ca843b20fe353813a25a8dcd945538fb7e6c17259c9b9f548aa，DMG CRC DB6B37DC通过。/Applications安装后teacher/classroom种子注入和实际按需Chromium门禁通过；6个WPS/LAN/dispatch/modes运行源文件与安装资源逐字节一致。Windows当前dabc70c / run36334190705仍在运行。

run36334190705仍在120秒总预算挂起，证明不能仅靠增加等待解决。实查测试含无超时RAF与capturePage；补查electron/electron issue31016（Windows遮挡/隐藏暂停RAF）并核对本地Electron39.8.10类型支持capturePage(rect, {stayAwake})。这是待验证原因，不作为已确认根因。截图前明确显示/聚焦窗口，官方stayAwake选项仅用于测试截图；RAF与capture均独立8秒超时并输出阶段，保留所有交互断言，不修改生产后台节流。

### 2026-09-28 · 侧边栏模型交付端到端验收
实际检索先完整应用 `site:github.com/ViaTumLab/Yan-Agent browser sidebar`，再插件生态 `site:github.com/omdsh-dev/DSH-better-sidebar sidebar_open`。前者本轮搜索未返回相关结果，沿用前述已审查固定提交；后者命中 https://github.com/omdsh-dev/DSH-better-sidebar 及 agent-open-tools 设计。实际查看本地0.18.0提交a5c52b3f1bc450b04578bd9252f67b7d79c98502的src/agent-opens.ts；MIT、现有依赖沿用，网页当前main依赖更高DSH版本，不据此升级。已有URL打开、会话隔离、队列与delivered回执，继续采用，不重写。补充隔离Electron验收中的真实模型tool_calls、工具回传、iframe内容可见断言，避免仅凭工具schema宣称完成。维护成本限于现有可选测试模式，无生产依赖增加。

2026-09-28：侧边栏真实模型工具调用验收通过。MOCHI_SIDEBAR_LIVE=1 在隔离Electron教师会话中发出sidebar_open tool_calls，收到工具结果后网页iframe的实际标题可见，随后同一会话A/B模型切换、凭据不回显及重开会话验证均通过。此证据覆盖网页成果自动打开，不据此宣称文件编辑、所有侧栏功能已完成全面升级。Windows36334784398现已进入NSIS安装后验收。

同一隔离会话继续验证sidebar_open本地文本文件：工具结果确实回传模型，CodeMirror编辑区实际显示源文件内容；网页与文件全窗口截图已保存到docs/evidence/ui-paper-2026-09-27/live-sidebar-{delivery,file-delivery}.png。目视发现默认文件标签仍显示Files，进一步定位到上游src/client/state.ts:215和1357硬编码标题，非locale服务未启用；此项尚未修改，需在后续侧栏升级修正并覆盖恢复历史布局场景。

2026-09-28 Windows交付：run36334784398成功，私有artifact配额失败后既定private draft release回退成功。安装器已下载deliverables/2026-09-27/windows/Mochi-Setup-0.1.0-win-x64.exe，279858845字节，SHA256 9c240a342a6b7f794c69d04cbe76bcf7a37b6108e74af8975cc8c05797db078b 与构建机一致。NSIS真实安装及安装后双角色首启凭据引用一致性、按需浏览器实际启动和133校园文件一致性均通过。WPS Windows实际应用显示未验，侧边栏全面升级仍在继续。

### 2026-09-28 · 侧边栏标签和控件层级
先检索完整应用 `site:github.com/ViaTumLab/Yan-Agent sidebar browser`，再插件接口 `site:github.com/omdsh-dev/DSH-better-sidebar "skin" "updateTab"`。前者返回 https://github.com/666-gy/Yan-Agent （既有已审查重定向提交98430d3），后者本轮无精确命中，继续读取真实本地 https://github.com/omdsh-dev/DSH-better-sidebar 0.18.0/a5c52b3 的 external-plugin-guide.md 与 service/state/locales源码，MIT。复用公开getSnapshot/subscribeState/updateTab和稳定皮肤锚点，不修改上游，不增加依赖，不复制OpenCode浏览器内核。默认无路径Files标签通过公开接口随中文改为文件，覆盖上下分栏和浮窗、历史恢复，真实文件名和用户自定义标题保留。控件沿用Apple Design的明确选中层级、可见键盘焦点和减弱动效，避免改变面板布局/拖拽几何。兼容性以能力探测和隔离Electron实测为准。

2026-09-28侧栏后续：默认Files通过公开sidebar服务改为文件，涵盖上下分栏/浮窗/语言切换，保留真实文件和自定义标题；标签纸面选中态、24px关闭点击区、键盘焦点已调整。单元验证和MOCHI_SIDEBAR_LIVE隔离Electron完整网页/文件打开、文件编辑保存、关闭回到上一页均通过。新快照610文件92628232字节；私有提交fa88782a0887569984212fd841e26f60581bb3f0，Windows run36336113393正在运行。Mac release-mac-sidebar-final正在构建，新包内主题client.js已与源码SHA256核对一致。上一版双端已验收交付包保留，尚未替换。

侧边栏Mac安装完成：280147933字节、SHA256 f456c50cad4667392d5e639cfb407c6805d8650473dcab64cb1940696e301b23，DMG CRC6394B541，已从镜像安装/Applications/Mochi.app；安装后teacher/classroom --expect-seeds及按需Chromium检查通过，原生CUA实际展开确认文件标签中文。Windows36336113393仍运行，旧已验证包保留。

2026-09-28 Windows36336113393失败在原生弹窗交互（日志到notification.png，外层120秒超时），前一同测试版本曾通过，不能据此归因为生产侧栏修改。沿用先前完整桌宠应用/框架检索，补查 `site:github.com/electron/electron executeJavaScript promise window destroyed unresolved`，实际官方仓库web-contents.ts表明脚本等待加载及renderer IPC回传。关闭窗口的脚本可能在回传前销毁renderer，这是待验推测。测试点击改用已有Electron39.8.10/MIT sendInputEvent真实输入，Escape同样发送原生键；脚本只读取坐标，不等待销毁窗口后的JS返回，所有读取统一8秒上限，逐等待输出阶段。保留全部生产动作/回执/窗口消失断言，不跳过Windows门禁。无生产代码或新依赖变更。

2026-09-28原生菜单中文：先完整应用检索 `site:github.com/CherryHQ/cherry-studio "editMenu" label`（本轮无精确结果），再框架 `site:github.com/electron/electron "role" "editMenu" "label"`，命中官方menus文档及deepseek-harness编辑快捷键讨论。采用已锁定Electron39.8.10/MIT的原生菜单role与label，不引入Cherry完整应用或第三方菜单库。实查doctor-window.ts默认editMenu/help导致英文；为现有原生编辑命令和应用/窗口/帮助项明确中文标签，保留role与平台默认快捷键，维护范围限于菜单模板。未修改网页菜单/用户文件名称。

2026-09-28侧栏全面交互补验：先搜 `site:github.com/ViaTumLab/Yan-Agent terminal git browser`，再 `site:github.com/omdsh-dev/DSH-better-sidebar "float" "terminal"`，命中此前已审查的Yan与DSH完整工作区。继续采用本地0.18.0/a5c52b3 MIT公开菜单与原生PTY/Git能力；最新上游已改变宿主基线和浮窗结构，不升级。新增可选隔离Git仓库/终端落盘/浮窗回靠UI验证，无新生产依赖。


### 2026-09-30 · 桌宠消息、收件箱与模式一致性
- 先搜索完整应用/框架/插件生态：`github desktop pet electron notification bubble`、`github deepseek dsh plugins plan mode`、`github electron notification inbox application`。
- https://github.com/Evanfan007/desktop-pet ：提交 `1a265174e203169a75d0b525d246f1e26cf0b4e4`，package.json 5.2.1 / Electron28；实际读取 renderer/bubble.js，已有气泡、尾角、自动淡出。README声称MIT但根目录未见独立LICENSE，不复制代码。GitHub API首轮TLS失败，随后curl和固定提交raw源码成功；不是无权限或无结果。仅参考交互，本项目已有Electron39桌宠、排队与回执，整套接入增加重复状态和打包维护成本。
- https://github.com/deepseek-ai/deepseek-harness ：GitHub核对master `639ed015397290b3745d163aafe02ffee4aa3f84`，MIT，2026-09-29更新。实际接入沿用本地锁定0.1.3-alpha.1；检查本地commands、session-projection、plan-mode和conversation源码/类型。复用command.execute、session投影、conversation.input.left和每轮prompt assembly，不升级框架。官方空白会话主动隐藏header，模式按钮应移到首条消息前就显示的输入栏。
- https://github.com/HackSing/dsh-plugins ：目录提交 `ce678fbce8d7043844220aad16a7c5d0c2a1635b`，CC-BY-4.0，2026-09-29更新；发现 https://github.com/a903067276-rgb/dsh-plan-switch ，网页可读、API连接中断，未确认提交/依赖，未接入。计划模式与Mochi工具权限模式含义不同，复用已有官方扩展接口。
- 方案：复用Mochi头像标记和既有通知IPC；用户明确选择30秒后收起、鼠标移入暂停，收起不发送已看到回执。收件箱保留正文和必要操作，已处理/身份和回执细节渐进展示。模式从宿主controller注入每轮模型上下文，并识别命令业务错误；不改已稳定的连接协议，不新增运行依赖。接入验证结果待本轮追加。

用户追加两端可爱文案与打字机信箱：回读本文件2026-09-27记录，确认旧参考为PommeToys反馈专线；本次未声称重新验证其私有实现。先完整应用搜索 `github open source typewriter mail inbox paper tear app`，再 `github PommeToys fax tear`、`github react tear off paper animation web animations`。完整应用 https://github.com/tasmon/Typewriter 提交0701e657402baa040b84271dce2df50b85fa10cc / MIT / 2026-09-25维护，为写作PWA，不替换签名消息收件箱；组件 https://github.com/DevCodeSpace/react-swipe-motion 提交a52cd696a6f2a0395fe6f89e9ff1962950816983，1.0.0/MIT/2026-09-11更新，实读LICENSE/package.json/PaperTear.jsx；React18兼容但需新增framer-motion11且为刷卡轮播，不适合通知长文和现有列表。部分参考纸片分离机制，不复制代码，复用项目已有Web Animations和纸白主题。采用apple-design的即时反馈、成功事件驱动和减少动效规则。已读撕下复用人工message-seen动作，只有ACKNOWLEDGED才动画并归历史，异常不消失；不新增删除协议或第二份归档存储。

2026-09-30接入后验证：71项模式/LAN客户端/主题测试通过；桌面和插件TypeScript检查通过。真实Electron rail-model256项、rail-logic188项、原生窗口/头像气泡/回执和30秒实际计时通过（移入暂停、移出继续、超时不发回执）；沙盒preload回执通过。实际DSH宿主+可控模型网关验证首条消息前切工作、工作回对话、聊完再切工作时，系统模式段落与真实请求工具列表一致；未声称真实模型所有语义自动升级均已验证。两端纸条信箱真实React/Electron覆盖失败/UNKNOWN不撕信、ACKNOWLEDGED撕离并归历史、重载与减少动效，截图见docs/evidence/mailbox-2026-09-30。修复原通知CSS首规则因拼接多余分号被丢弃的问题，头像与气泡几何实测无遮挡。没有变更LAN协议、没有安装新依赖、没有替换已安装应用或重打安装包，Windows本轮未实机验收。

## 2026-09-30 全项目按钮与状态规范

- 先检索完整应用与组件生态，再检查按钮源码。实际搜索词：`site:github.com/CherryHQ/cherry-studio button design system semantic colors`、`site:github.com/radix-ui/themes button variants soft solid outline`、`site:github.com/shoelace-style/shoelace button success danger neutral`。
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio/tree/a03c8bb3664e7eefe31a55d401d6bb433e5e6fec)：2.1.3，提交 2026-09-30，AGPL-3.0、未归档。读取 package.json 与 DESIGN.md，已有语义颜色、成对前景/底色、跨主题状态规范。只参考规则，不复制代码，不整体引入不同宿主的应用。
- [Radix Themes](https://github.com/radix-ui/themes/tree/1faff10ac26ae17f09944d418c6949b93fc6b566)：3.3.0，提交 2026-04-11，MIT、未归档。读取 package.json、button.tsx、`_internal/base-button.{tsx,css,props.ts}`，具备 soft/outline/ghost、loading/disabled、焦点和尺寸体系；React peer 包含 18。部分采用语义分层方法，保留已有 DSH Button 和原生 DOM，不为视觉改造增加 Radix、滚动条和主题上下文依赖。首次 base-button.css 路径 404，经 Git tree 找到 `_internal/` 后成功读取，不是未找到方案。
- [Shoelace](https://github.com/shoelace-style/shoelace/tree/25bd8ec776609670a932f21390be59a495df497d)：GitHub API 核实 MIT，2026-05-14 提交，仓库已归档。检索到 button.styles.ts 的语义 variant；未做依赖适配，不采用该库。
- 已确认本地 DSH 0.1.3-alpha.1 Button.module.css 存在 primary/ghost/outline/toolbar、原生 disabled；Electron 39 支持 cascade layer。基础交互复用现有组件，新增 `styles/mochi-controls.css` 为颜色、圆角、边框、焦点、hover、pressed、selected、disabled 的唯一覆盖源；构建同时内联插件和原生窗口，旧 renderer 直接导入。使用 CSS important layer 有意覆盖历史皮肤，避免继续堆选择器权重。
- 语义：主操作浅杏、选中浅灰蓝、完成浅鼠尾草绿、注意浅麦黄、危险浅玫瑰；状态标签不可点击，无按键阴影。颜色以外保留文案、选中底线、焦点环和禁用虚线。桌宠本体、缩放手柄、外观旋钮保留其专门形状；系统原生菜单/对话框由操作系统绘制，嵌入文档不注入样式。
- 长期成本：无新增运行依赖，无消息协议/动作变更；新按钮默认继承中性规则，业务通过 `data-mochi-variant` 指定 primary/danger，通过 `data-mochi-status` 指定状态。现有 DSH CSS-module 类名适配只针对已核查版本，升级宿主后需视觉复验。
- 追加澄清：老师反馈的是 Mochi 本体配色，用户要求先看图选择，尚未批准替换。保持按钮方案；本体配色仅生成 A 焦糖 / B 奶油米白 / C 鼠尾草绿 / D 雾桃奶茶四格概念图，不修改角色资产。小纸条头像和尖角移至左上，复用现有 SVG、bloub 引擎和 CSS 定位，不新增动画库。
- 验证：41 项主题/LAN Node 测试通过；桌面 TypeScript build/typecheck 通过；实际 Electron CSS 检查覆盖主操作、选中、成功、危险（明暗各 4 类，文字对比度均超过 4.5:1）、hover/disabled/focus/reduced-motion；信箱两端与回执回归通过。原生运行回归曾出现位置/计时等待波动，独立完整复跑通过；真实 DSH 聊天/工作切换与签名配对回归通过。校园/设置完整视觉巡检另见本次 evidence 记录。

### 2026-09-30 用户纠正后的最终方案（覆盖上节视觉方案）

- 用户明确要求保留原有软件配色；撤回全局浅杏/灰蓝等色板、统一填充、边框、凸起阴影和选中底色。`mochi-controls.css` 仅统一普通按钮圆角、焦点、禁用与减弱动效；原有页面、发送键、按钮配色及阴影不变。信箱的成功回执恢复原有 LAN 浅绿色语义，提高纸面上的区分度。
- 用户选择由使用者自行选 Mochi 本体颜色：在原有外观设置加入经典焦糖（默认）、奶油米白、鼠尾草绿、雾桃奶茶。通过既有 `jxl-theme` Host settingsScope 保存 `petPalette`，不新增 localStorage。主进程只接受有限枚举且验证发送 frame；启动/重载/新弹窗同步到桌宠和小纸条，未知值忽略。
- 开工前补充 GitHub 检索：`site:github.com desktop pet app skin color settings Shimeji`，`site:github.com radix-ui primitives toggle-group aria pressed`。完整应用 [desktop-pet](https://github.com/renzhenghui0814-pixel/desktop-pet/tree/02abff1254a27d74950692ba81340503fbf1b69f) 3.1.0，提交 2026-05-21，未归档；读取 package.json、settings.js、preload-settings.js，确认设置页主题选择、初始化与 IPC 通信实现。package.json 声明 MIT，但 GitHub 未识别 LICENSE，未确认完整许可；Electron 25 与本项目 39 不同。只参考持久主题选择交互，不复制代码或引入其皮肤系统。Radix 框架已有前述 MIT/版本/React 兼容性检查；四个原生 button 的 aria-pressed 已满足本次有限选择，不新增运行依赖。
- 单一配色源 `assets/mochi-palettes.json` 生成 web/native CSS 与枚举。沿用现有 SVG/bloub 动效，仅覆盖角色主体、眼睛和电脑色，默认颜色逐项保持原值。没有把 AI 概念图当作生产资产。
- 最终验证补充：43 项主题/LAN 单元测试、桌面构建、插件类型检查、真实 DSH 设置保存/刷新恢复/原朱红发送键、原生 rail 完整运行均通过；四种真实 SVG 配色及电脑色实测通过。原生计时与其它 Electron 窗口并行存在焦点干扰，独立串行复跑通过。选色项横排与窄处换行已修正，真实 Host 断言按钮高度小于 60px，避免中文被挤成竖排。

### 2026-09-30 LAN 首用引导、状态标签与课堂语音调研

用户澄清：不喜欢的绿色指“已确认等状态标签”；保留整体原配色和可选宠物色。课堂希望开机后自动监听，取代每节课手动开启的提议。首次系统麦克风授权与识别服务就绪仍是必要前提。

开发前实际检索：`site:github.com Open-LLM-VTuber voice wake word camera`、`site:github.com sherpa-onnx keyword spotting streaming speech recognition electron`；并通过 GitHub API/源码检查完整应用 LocalSend，先完整应用再识别组件。

- https://github.com/localsend/localsend ，提交 `c5bbe3630bb50e0de8253502b41523c4a58825bb`（2026-09-29），Apache-2.0、未归档；检查 LICENSE、app/pubspec.yaml（1.18.2+64、Flutter 3.41/Dart 3.11）与 home_page.dart 的接收/发送/设置结构。部分采用下一步分层提示；不引入另一套 Flutter 应用，不替换现有签名 LAN 配对/收发协议。
- https://github.com/Open-LLM-VTuber/Open-LLM-VTuber ，提交 `992309c0aa19845960228f880013d4685fde93b5`（2026-05-15），未归档；检查 LICENSE 和 pyproject（1.2.1、Python >=3.10,<3.13）。代码 MIT，有 Live2D 素材例外；GitHub API 的 NOASSERTION 不等于没有许可。具备语音/摄像头方向的完整应用生态，但 Python/Torch/FastAPI 栈与当前 Electron 宿主不同；只作架构参考，未接入，未据 README 宣称兼容。
- https://github.com/k2-fsa/sherpa-onnx ，提交 `040afe360a38e25daaa325ce8889abf93ea02609`（2026-09-22），Apache-2.0、未归档；检查 LICENSE 与 nodejs-addon-examples/test_keyword_spotter_transducer.js，存在 16kHz 中文 zipformer-wenetspeech 关键词识别 CPU 示例。项目已使用 sherpa v1.13.8 离线 TTS；拟复用生态，但 ASR 模型分发、Electron ABI、真实音频尚未验证，不能说已支持持续识别。

本轮已实现：空白未配对设备首次打开进入连接引导；按角色、身份、服务状态、申请和配对记录给出下一步；服务不可用优先显示故障，不因保存过配对就声称在线；纸条回执作为收发验收。只新增展示逻辑，不自动发配对或已读。状态标签和原生待办成功状态使用米灰/棕色；不改按钮填充、宠物预设色。无新增依赖，继续复用现有宿主、权限和协议，减少双状态机维护成本。

### 2026-09-30 官方 Harness 内核升级与语音输入（用户追加）

实际检索词：`DeepSeek Harness desktop GitHub speech recognition release`、`site:github.com/deepseek-ai dsh desktop voice`。先区分完整官方桌面应用与社区壳：采用官方 https://github.com/deepseek-ai/deepseek-harness ，不采用搜索结果中 dsh-tauri / agent-earth 的独立版本号。API 核实最新发布 `dsh-v0.2.0-rc.2`，2026-09-29，提交 `639ed015397290b3745d163aafe02ffee4aa3f84`，MIT、未归档、仍为预发布；npm 同版本核心和 voice-input-bundle 已发布。搜索索引仍显示 0.1.7，已用实时 API 纠正。

读取该固定提交的 LICENSE、桌面 package.json、语音输入子系统、VoiceInput.tsx/audio.ts、speech-to-text 类型及 API、SenseVoice Provider recognizer/runtime/inference、模型哈希清单和 bundle 配置。官方现成能力：本地 CPU SenseVoiceSmall + Silero VAD，sherpa-onnx-node 1.13.8，模型下载与校验/离线路径/取消/有界队列/识别偏好；点击录音后转写到原会话草稿，不自动提交。API 默认上限120秒；录音时失焦或页面隐藏会取消。这是可复用语音输入，不是已实现后台持续监听。用户明确要求两个功能都做。

Mochi 当前安装核心与前端实际版本0.1.3-alpha.1，Cordis4.0.2；新语音包 peer 要求Cordis~4.0.4及同版DSH服务，官方桌面依赖Electron^44（当前Mochi39），不能仅添加新语音UI包就宣称兼容。选择先在临时目录安装0.2.0-rc.2核对依赖和启动，再迁移Mochi插件/配置；不改现有用户数据，不直接覆盖已安装软件。目标复用官方识别基础，课堂持续监听另增生命周期与意图层；摄像头、作业信件和语音回复不能由升级自动获得。长期减少自建识别引擎维护，代价是一次完整Host/Client插件契约与原生打包迁移。

隔离接入验证补充：0.2.0-rc.2 CLI和官方Web启动通过；Mochi教室启动暴露installSection接口移除，教师profile缺旧agent-presets目录。依赖清单与脱敏日志记录在docs/evidence/harness-upgrade-2026-09-30。采用官方桌面microphone-permissions.ts的权限处理思路，按Mochi现有认证环回origin重写，并增加系统授权返回后的当前文档复核；保持当前Electron39 API，不依赖新桌面壳。新增macOS用途说明，构建及权限单元测试通过，实际OS录音授权尚未验收。语音bundle尚未接入，不能宣称已完成语音输入。两项临时Host已正常终止，候选依赖保留用于后续迁移。

预设迁移继续：复用固定0.2.0-rc.2官方web-app/presets/*.patch.yml及agent-preset/registry声明格式，直接检查安装包代码与README，不重新造预设注册服务。新增modern-presets.cjs将Mochi已有教学列表嵌入官方声明，保留平台!!js条件供Cordis处理。旧内核继续原目录路径；新内核教师保留四个教学预设及standard/minimal/ptc/cordis历史ID，教室只启用classroom。旧版用户自定义预设的信任语义尚未迁移，检测存在时在写入前明确失败，避免静默丢失或提权。无新增运行依赖，使用目标内核已带js-yaml读取普通元数据。

真实0.2配置组合测试通过：两角色默认值、教室禁用所有官方通用预设、幂等生成、自定义预设拒绝时无部分写入；现有旧版test-runtime-profile也通过。新版教师实际启动又发现dsh-better-sidebar0.18.0 peer不兼容，以及当前源码插件exceljs依赖缺tmp；未跳过兼容检查、未宣称启动成功。详见新增teacher-start.log。下一步需按候选运行时整理插件依赖并迁移模型/设置接口。

模型迁移继续：读取固定0.2.0-rc.2官方llm-pi-ai README、Config/adapter/catalog类型与实际apply实现，采用它已有的OpenAI兼容协议、凭据解析和图片适配。不再让MiMo继承新版DeepSeek Messages适配器。实测两个pi-ai实例会重复注册内置提供方，已改为合并到唯一llm-pi-ai配置；旧MiMo行保留原值并禁用作为迁移标记。模型inputModalities映射input，reasoningEfforts映射档位字典（off为null）。使用候选已安装yaml2.9.1/ISC的AST保留其余节点与注释，未知字段或新旧路由冲突拒绝转换。受管边界外保存迁移后的提供方配置，连续生成保持字节幂等。尚未完成旧settings.yaml里的用户偏好导入迁移，故未切换正式内核。

真实上游适配器+本地HTTP夹具验证通过：/v1/chat/completions、凭据引用、模型和中文流式回复。不是对实际付费模型的调用。官方voice-input-bundle加入新版mochi-web组合，两角色语音服务配置均经真实内核dump验证。教室新版Host无加载警告，但真实Electron页面失败：jxl-brand failed，jxl-theme等待已移除的settingsScope。不能把Host启动或语音条目存在说成语音输入已交付；下一步迁移主题/品牌客户端和Host设置接口。

客户端迁移已实测：主题改为兼容旧settingsScope与新configForms，拒绝的设置写入继续显示失败；品牌待确认状态兼容新版sessionStatus。19项主题测试、2个新旧品牌生命周期测试通过；真实候选Electron窗口已启动且无客户端异常。新建会话仍发现persona.prefix schema变化，继续迁移，不能用页面启动代替会话可用。

开机监听宿主复用检索：先完整应用 `site:github.com microsoft vscode setLoginItemSettings openAtLogin args`，再框架 `site:github.com electron electron setLoginItemSettings wasOpenedAtLogin args macOS windows auto launch`。前者未命中可直接复用的VSCode实现；搜索成功，非无权限。https://github.com/electron/electron 官方app.md及本机Electron39.8.10/MIT的electron.d.ts核实：Windows支持path/args/name并须按相同参数读取；macOS只有登录启动事实，不能假设args可用。采用现有Electron API，不引入node-auto-launch或另一套启动服务；首次教室配置注册一次，以后读取实际OS状态，保留用户在系统禁用的选择。Mac签名与学校Windows登录启动仍需实际产物验收。摄像头沿用同一受信主文档检查，单独camera系统权限，不同时申请音视频。

### 2026-09-30 双端语音输入与原界面兼容验收

继续采用前述官方 DeepSeek Harness 0.2.0-rc.2 / MIT 的完整 Web 应用、voice-input-bundle、SenseVoiceSmall/Silero、团队投影和原生 Electron39，不新增另一套录音或 ASR 生产依赖。教师和教室的点击语音输入都是官方草稿输入；课堂常驻监听另有生命周期，不因语音按钮存在就视为监听完成。按钮局部显示“语音输入”，保留原有纸白/朱红和按钮体系。

真实新客户端暴露 Cordis 严格服务访问：只注入 configForms 的子上下文读取旧 settingsScope 属性就会抛错，Host和外层客户端启动成功并不能证明主题CSS已装载。主题改为显式传入已注入的服务名，兼容两代设置入口；实际 Electron 检查 jxl-theme-bridge 已存在，标题/原发送键和焦糖头像恢复。未重写官方插件管理器或替换 Mochi 界面。

测试补充检索先完整自动化示例 `site:github.com/checkly/playwright-microphone-demo microphone audio`，再框架 `site:github.com/electron/electron use-file-for-fake-audio-capture`。后者搜索成功但未找到可确认本次全零采样根因的官方issue，不能视为生产麦克风故障。https://github.com/checkly/playwright-microphone-demo 固定提交579b85e5526c11bb854dc8e967397f2c9aa2c049（2026-06-05）、1.0.0/MIT；读取LICENSE/package.json/tests/helpers/mockMicrophone.js，Node>=22、Playwright^1.60，而Mochi测试已用1.55。部分采用测试专用WebAudio流的办法，不安装Checkly或复制整个示例；现有Playwright能力足够。标准fake-file flags在本机Electron39测试采到全零，禁用音轨处理也未改变；换用测试专用合成中文WAV→MediaStream，后续真实官方MediaRecorder/WAV编码/本地识别/输入草稿可运行。真实物理麦克风和Windows声音设备仍须设备验收，不把合成源当硬件测试。

持续监听完成信件后复用既有原生桌宠纸条提醒队列，通过有限UUID和长度校验的新IPC打开原作业信；没有新增LAN已读回执或第二份作业存储。语音对话朗读复用既有本地TTS并用请求ID取消，旧回复/旧stop不能误取消新回复；仅受信主frame可调用，导航/退出终止播放。

进一步源码兼容核查：jxl-theme源链接实际解析仓库schemastery3.18.2，而候选Host用3.18.4；前者没有volatile方法。逐行核对后者lib/index.cjs:235确认volatile()仅调用extra('volatile',true)，两版都有extra。主题在旧schema实例上保留相同公开meta，交给新Host处理；旧Host继续原settings section，19项旧主题测试通过。包声明改为这两套已查版本的peer，避免新核心安装时强拉嵌套旧tools/schema。实际导入以真实Host后续结果为准。

### 2026-09-30 课表自动导入与真正的定时任务（继续核查）

实际搜索先覆盖完整应用/插件生态：`site:github.com/ClassIsland/ClassIsland timetable Excel CSES`、`site:github.com/classwidgets/Class-Widgets 课表 导入 图片`、`site:github.com/deepseek-ai/deepseek-harness schedule_create schedule service`，再检查 `site:github.com/exceljs/exceljs read xlsx csv`。

- ClassIsland/ClassIsland，固定235914a2fac1733cc2a169457c7bad4edb2ca2f6（2026-08-27），GPL-3.0；读取LICENSE、ExcelImportWindow.xaml.cs、CsesImportProvider.cs。当前迁移分支的旧Excel窗口被`#if false`包围，不能仅凭README说可直接接入；有效CSES导入是Avalonia/.NET路径。部分参考课表/时间表分离与显式错误处理，不复制GPL代码或引入另一套桌面运行时。
- exceljs/exceljs，v4.4.0标记提交ac96f9a61e9799c7776bd940f05c4a51d7200209，MIT；本项目mochi-grades已经使用同版ExcelJS并验证XLSX解析。课表复用依赖读取工作簿，不用成绩表专用的姓名/分数判读逻辑。照片由当前支持视觉的模型提取，结构化时间校验不通过时不得静默生成提醒。
- 官方deepseek-ai/deepseek-harness继续锁定0.2.0-rc.2 / 639ed015397290b3745d163aafe02ffee4aa3f84 / MIT。实读schedule包types、service、runtime和中文README：持久Host任务、冷会话恢复、daily/weekly/cron、编辑与历史已有；没有pause API，delete会删除该任务的历史；投递实际调用agent.followup，不是本地系统通知。网页搜索仍返回旧session-local文档，采用固定候选包源码核实后的结论，不混用。
- 采用官方bundle承载需要模型的定时工作；课表铃声必须在无API Key时工作，因此复用Mochi既有SQLite调度器、日历计算和原生纸条队列，补可查看/暂停/恢复/编辑的真实交付链路，不再另写Cron引擎。启动补发有界，已过期的上课铃不能一窝蜂弹出；重启持久化与重复投递需要测试。只是存储成功不得宣称用户已看到。此项实现与验证仍在进行。

启动体验：固定新版ui-settings-models源码已提供`credentialOnboarding:false`公开配置，保留手动模型设置和真实缺凭据错误；复用该开关，避免DOM隐藏或伪造API配置。

### 2026-09-30 最新目标：复用原记忆版本并让用户可检查

先检索完整应用/框架与生态：`site:github.com/Open-LLM-VTuber/Open-LLM-VTuber memory long term`、`site:github.com/mem0ai/mem0 memory dashboard update delete`。Open-LLM-VTuber固定版本与MIT/Python兼容性沿用上文；搜索结果中的长期记忆文档与旧README说法不一致，不以搜索片段断言当前能力。mem0ai/mem0固定94c3fe9f238f3dbf29c9ce98643bd71eb13077cd（2026-09-25）、Apache-2.0；实读LICENSE及mem0/memory/main.py的get_all/update/delete及用户scope。它有成熟记忆CRUD，但Python/向量服务与额外推理不适合为管理界面替换Mochi已存在的本地SQLite/FTS。

采用原plugins/mochi-memory的note/listAll/supersede/pin/forget、敏感护栏、来源与历史审计；新增受认证Connection保护的管理入口与纸白弹窗，用户可检查、更正与忘记。不迁移或清空既有记忆，不新增向量库/模型调用。称呼由新的用户资料单一来源管理，记忆中可能过时的偏好不能覆盖当前明确设置。两角色继续使用各自DSH_HOME隔离。接入后必须验证真实工具/页面/重载，而不把按钮存在当作记忆已生效。

用户进一步要求主动形成习惯：继续复用以上固定mem0框架的“观察→提炼→更新”思路和本项目原SQLite/FTS，不引入其Python/向量运行时。直接检查官方0.2.0-rc.2 session/event公开契约，真实user/message有稳定message id，seed历史不会重复发布；拟用它收集有界的真实用户格式/排版选择，跨对话重复后形成可更正的偏好。班级风格等语义提炼交给当前正常模型回合的观察工具，但工具必须用真实用户消息中的原句核对证据，不能用模型自己回复作事实。一次性的选择先是观察，不直接当永久偏好；关主动记忆后停止采集/强化，用户忘记过的候选应防止立刻重新学回。没有调用额外后台模型，不宣称有限本地规则覆盖所有习惯。

通用模式的实际工具面：检索`site:github.com/deepseek-ai/deepseek-harness agent preset standard session projection`，复用官方固定0.2/MIT的standard预设及session-projection；实读candidate agent-preset-registry源码，确认header只是初始值，空白会话改预设会追加agent-preset/selected。Mochi自己的模式投影须随该事件更新，并保留之后的手动chat/work日志；不能只改“通用”标签却继续隐藏文件工具。采用公开header/event/投影版本，不另建模式状态库，原操作审批仍保留。

2026-09-30 主动记忆实际接入结果：继续使用原SQLite/FTS、官方session/event与system-prompt context。5项新增主动学习测试及既有存储/管理/上下文测试通过；实际候选Host的7次正常Session请求经本地pi-ai网关验证：真实用户消息自动观察、跨会话形成暂定格式习惯、后续任务记忆快照自动携带、显式聊天仍能使用记忆工具、忘记后新快照移除且同类候选不立即重学。语义观察工具只接受最近真实用户消息中逐字存在的原句。没有把网关固定回答当作真实大模型语义准确率测试；固定规则只覆盖有限格式/排版/表达线索。记忆面板支持查看原句、关闭新学习、更正/固定/忘记，客户端实际UI另行验收。忘记不删除已有会话文字或原审计快照。

同一真实Host请求验证通用standard初始包含write、教学产物与mochi_call_student工具，手动chat收窄工作工具但保留记忆与课堂沟通。23项模式测试通过。旧通用默认不再只改标签而仍隐藏工作能力；已保存的显式聊天/工作选择由日志投影恢复。

课表/定时接入验收补充：5项planner测试及既有调度器合计30项通过；真实Host/Electron验证CSV自动保存、暂停重载恢复、编辑草稿保留、不确定时间不覆盖旧课表、真实SQLite计时到持久纸条及客户端接收，880px弹窗无横向溢出。提醒桥在该UI夹具中为模拟原生接收，不把入队视为已读。陪伴7天资料/确认特质刷新保留，里程碑交付正文持久历史验证通过。照片上传到当前支持图片的会话和结构化导入工具已接，真实照片识别准确率尚未验证。官方schedule另外通过真实Host重启冷Session恢复与持久投递回执，不等于模型任务完成。

交付闭包补充：prepare-mochi-resources显式白名单现含全部35个声明插件，以及记忆management/proactive/companion、新手指引steps和录音复用NOTICE。真实隔离资源测试通过暂存与入口导入（35插件、29既有DSH模块、106额外模块），保留旧profiles的启用子集与新core按角色启用规则；不将此静态资源验收当成正式0.2依赖锁文件已切换。

### 2026-09-30 Mochi 日记、历史与双端记忆分工

用户新增：以每天可编辑的“Mochi日记”呈现真实活动，再沉淀可改名、可修改长正文、可按日期总结的“Mochi的历史”；无实际活动不生成，不补编空白日。教师工作习惯与教室集体经历分开，不能把个别学生的文档请求当班级默认格式。原信封语言应覆盖主页面与子页面，不照搬附图黑色移动端外观。

先完整应用/框架/插件生态检索：`site:github.com letta ai memory archival sleep-time agent diary`、`site:github.com OpenMemory mem0 episodic memory history`、`site:github.com usememos memos daily journal edit tags`；再查`site:github.com usememos memos MemoView editing display time content`与既有Harness schedule。

- https://github.com/usememos/memos ，固定a80576a6def3c241c7c73e07448c8d2d8cd582bd，2026-09-28，MIT、未归档。实读LICENSE、go.mod（Go1.27）、web/package.json（Node>=24、React19.2.6）、server/api/v1/memo_service.go、memo_service.proto、MemoEditor/Editor/index.tsx。现成按日期内容记录、创作者鉴权、内容编辑与长度限制可参考；Go后端/React19整体替换现Electron/React18/DSH会增加运行和迁移成本，部分采用行为，不复制整套实现。
- https://github.com/letta-ai/letta ，固定5bcdd177d70fa2b31a754cfcd801e77b2e1ab16a，2026-09-10，Apache-2.0、未归档。LICENSE实际可读，但旧搜索结果中的pyproject.toml和letta/services/passage_manager.py在该提交404；再查真实Git tree确认当前根主要为文档/政策，并无所查服务路径。这是当前源码不可用，不是网络检索失败或无权限；不据旧搜索片段宣称可直接适配其后台反思。
- 官方Harness 0.2.0-rc.2 / 639ed015397290b3745d163aafe02ffee4aa3f84 / MIT仍使用此前已验证的持久调度与Session；本机日记基础按既有Mochi SQLite调度器工作，无API时仍保留有出处的本地草稿。生成模型长文必须明确区分生成结果与本地提要；人工修改不得被自动汇总覆盖。日记和历史是现有memory同库新表，不新增向量库/另一套Agent运行时。

实现与新验收正在进行；此前主动格式习惯的双端测试仅为当时版本验证，不代表最终教室端应沿用教师画像。

日记接入阶段验收：沿用已核固定 Harness Session 的 `turn/end` completed 与真实 `user/message` source，新增同库日记来源、受认证 Connection 管理接口及版本冲突保护。实际候选 Host 经本地固定模型网关完成7次正常用户对话，恰好记录7条交流活动，官方会话标题请求未混入；生成本地日记保留7个来源，空日返回null，另一角色不读取这些日记。存储/活动/路由合计14项测试通过，覆盖人工改名与长文、旧版本、晚间追加活动、重启、日期和来源约束。固定回复只用于事件链路验收，不证明模型总结准确率；当前文本明确是本地提要。定时运行、模型长文、历史上下文及最终日记UI尚待接入与验收，不把这些测试当作整个功能已完成。

后续模型与历史接入：实读固定0.2候选 `dsh-llm` 的 GenerateOptions/RequestUserInput/StreamChunk/FinishReason，以及 Session 的模型消息来源；复用公开 `ctx.llm.stream` 单次整理，不复制凭据、不新增Agent。只保存实际已完成模型消息的provider/model路由，取消不写入，完整stop才保存为model，缺路由或失败保存local。教师与教室提示不同；日记和可编辑历史以有界历史资料进入后续请求，不当系统指令。真实候选Host已通过官方llm流生成日记，并在下一次实际模型payload查到历史内容；网关是本地固定文本，所以验证的是接口/来源/上下文链路而非大模型语义准确率。原记忆全套回归及新增29项测试通过。定时接线、最终UI与正式升级仍未完成。

日记定时接线完成：复用原 `mochi-task-scheduler` 的SQLite表、日期计算和计时器，同一memory文件独立连接；role+owner限定查询，未重新实现Cron。start补真实活动日、每日21:30（可修改）、每批最多7日继续推进、失败退避、取消不保存晚回包、重启复用任务ID。9项调度测试通过，包括55个其他到期任务不被消费、人工正文保护、晚间追加、最近30个有记录日的历史来源与实际计时器退避。真实0.2 Host启动已自动补出预置的实际过去活动日，无需手动调用generate；随后真实Session活动、官方模型流和后续请求中的历史链路再次通过。UI与正式发布依赖切换仍待完成。

发布依赖开始落地：继续采用上述已核官方固定版本与完整插件生态，新增 `apps/desktop/runtime-modern` 独立运行清单及npm锁文件。核心0.2.0-rc.2、sidebar0.24.1、既有教学文档依赖精确版本；不将230条旧直接内核依赖机械改号。实读官方CLI package.json确认它声明Web/语音/团队/定时等完整依赖集合，再实际执行npm锁定；所有远程包有integrity，官方DSH包没有混入旧alpha版本。具体数量见modern-runtime-lock.json。此举减少手工维护传递依赖清单，但需要物理安装、资源投影、原生ABI与双端启动验证；锁文件成功本身不等于完成兼容。正式desktop依赖与默认启动尚未改变，独立npm ci进行中。

独立安装现已完成：`npm ci --ignore-scripts`成功，以仓库内新runtime-modern/node_modules实际启动完整教师Host，七轮正常Session、聊天工具限制、跨会话记忆、日记模型流、启动补记与历史进入下次payload均通过，证据modern-release-memory-runtime.json。未执行第三方安装脚本，尚不证明全部原生扩展/摄像头/语音或最终安装包可用；这些检查与物理资源投影继续推进。

新版物理资源投影：`prepare-mochi-resources`新增显式modernRuntimeRoot分支，沿用原受管临时目录/原子替换/白名单/排除声明文件规则。先按npm锁逐项核真实包版本，拒绝旧DSH混装和外链，再复制完整已安装依赖树；新版sidebar采用实际0.24.1目录，避免旧0.18的文件清单。真实暂存35插件/821运行包成功，复制后的plugins与node_modules启动Host七轮通过（modern-staged-memory-runtime.json），不是仅靠开发目录NODE_PATH的导入证明。2项资源保护测试与23项模式测试通过。正式App默认定位及各平台原生ABI仍待接入验收。

App启动定位与当前平台原生验证：profile/web-host/任务Node环境现在共用runtime-paths，正式资源带modernRuntime清单时选择resources/mochi/node_modules；显式override保持一致，标记新版却缺包或版本不符时拒绝启动，不静默混用旧内核。编译与launcher路径测试通过。复制资源中的核心在现有Electron39.8.10/Node22.22.1实际返回0.2.0-rc.2；同一Electron进程成功运行SQLite、canvas生成PNG、加载sherpa模块、PTY启动并退出子进程，证据modern-staged-native-runtime.json。当前仅darwin-arm64；模块加载不等于实际识别/物理麦克风通过，不据此宣称Windows原生兼容或整个安装包已完成。

完整App发现并保留失败证据：第一次现代资源测试App构建成功，但真实teacher启动失败，官方internal loader明确拒绝Electron39.8.10（Node22.22.1/V8指纹），支持列表含43.0.0、44.0.0、45.0.0-alpha.6。因此此前CLI --version和单模块原生检查不能证明完整Host可启动。沿已核官方桌面44版本，现代打包分支固定Electron44.0.0。旧desktop依赖树的node-gyp在重建未使用旧sidebar/node-pty时缺Python distutils；现代分支关闭对旧树的自动重建，改为构建后用实际App二进制校验所选现代资源中的SQLite/canvas/sherpa/PTY，失败必须阻止通过。Electron44测试App下载/构建中，尚未确认成功启动。旧依赖树仍随app复制的体积与最终清理属于后续待办，不隐瞒为已完成正式切换。

旧依赖清理采用现有打包框架而非手写排除整图：实际检索`site.github.com/electron-userland/electron-builder two package json directories app dependencies`、`site:electron.build two package.json directories app`，先完整electron-builder应用发布生态，再查独立App目录配置。真实仓库https://github.com/electron-userland/electron-builder ，本机固定25.1.8/MIT；实读LICENSE和app-builder-lib/out/packager.js第260行附近，确认directories.app会读取独立App package.json，而非仍用开发依赖。采用其two-package结构，新增prepare-modern-app复制编译桌面壳和已核yaml2.9.0/ISC（无传递依赖）；现行main依赖闭包不包含旧自绘db/sidecar，语音7zip走现有extraResources。新内核与业务依赖留在resources/mochi内，避免双份旧Host；不再需要禁用整个native rebuild来躲旧包。受管目录测试、包内依赖清单测试及原installer配置回归通过。新分支最终完整构建和两端启动尚待当前Electron44下载结束后复验。

日记界面验收完成：详细完整应用/组件检索、固定提交和许可证见 [journal-ui-reuse.md](evidence/harness-upgrade-2026-09-30/journal-ui-reuse.md)。沿用原管理路由和原生文本编辑，无新编辑引擎。教师/教室独立真实Host+Electron均通过日期信封、长文改名保存、409草稿保护、人工编辑保护、范围预览显式保存、真实调度状态及窄窗检查。用户再次确认“当天没有Mochi实际活动就不用记”；本轮重跑存储/活动/调度25项全部通过，包含空日不生成、不补造、其他角色隔离。此UI验证不替代Electron44包内启动验收。

现代构建守门补充：新版分支不再拿旧开发Electron39原生探针或旧Host peer图作为先决条件；资源暂存校验新版插件官方peer，构建后使用实际App二进制检查原生模块，并逐一启动teacher/classroom完整Host冒烟，两者任一失败即打包脚本失败。旧发布分支保留既有peer/ABI守门。新增peer版本漂移/缺失/optional用例通过，installer契约回归通过；实际完整App结果仍待当前下载与后续构建。

Electron44下载故障已定位：app-builder缓存ZIP为259487925字节，Python ZipFile CRC检查首目录即失败；原解包进程仍活但取消无退出，明确终止该本次构建子进程，未当观察超时自动重启。改由官方GitHub Release单连接下载129743965字节，逐项核官方SHASUMS256.txt（星号文件名）SHA256及全ZIP CRC通过，证据electron44-download.json；损坏缓存改名保留。一次校验脚本匹配星号失败后过早启动的构建已失败并记录，修复缓存后重新运行独立App构建；尚未以下载成功宣称包内启动通过。

实际新版App阶段通过：独立App目录构建成功，app.asar约819KiB；Electron44.0.0/Node24.18.1内实际SQLite、canvas PNG、sherpa模块、PTY子进程成功，teacher 8.9s和classroom 12.6s完整Host启动均exit0+SMOKE_OK。使用隔离临时home并清除开发路径override，证据modern-packaged-launch.json。尚无实际UI全功能、识别与设备/Windows验收，不宣称发布完成；没有签名/安装覆盖/发布。

旧会话兼容下一步复用核查：先完整官方生态实际搜索`site:github.com/deepseek-ai/deepseek-harness session-persistence-jsonl immutable generation migration`，命中同仓JSONL持久化与格式catalog，再读本机固定rc2/MIT README.zh.md和公开类型。官方已有历史只读还原、写入发布新generation、原日志保留；采用该既有机制验证旧Mochi真实alpha样本，不重写迁移器。搜索亦命中讨论#6493/#5818，属于待核旧问题而非已确认rc2缺陷；必须实测当前固定版本，不凭README或讨论断言安全。专属隔离样本验证已交子Agent。

构建依赖显式化：新版资源peer校验使用当前实际semver6.3.1/ISC，独立壳复制实际yaml2.9.0/ISC（无运行依赖，Node>=14.6）。两者此前仅传递安装，现固定为desktop devDependencies并以npm --package-lock-only --ignore-scripts更新锁，不改变已安装树；构建/资源5项回归通过。npm报告旧agent-webtool下marked-terminal与marked现存peer范围警告，未把该警告伪称新版App故障或静默升级该旧生态。

2026-10-01 发行入口与跨平台输入接线：继续采用已查electron-builder双package结构和同一官方固定内核，不新增构建器。默认package-desktop选择runtime-modern，显式--legacy-runtime只保留回归构建，冲突参数拒绝且清除继承的modern环境变量，缺新依赖不静默回退。原发行npm命令因而默认走已验Electron44；开发入口仍旧，未在真实用户home执行迁移。Windows模板增加锁文件安装/实际版本检查并明确新版参数；快照精确增加4个公开配置迁移文件、runtime manifest/lock及其vendor依赖。清单711文件对当前磁盘hash一致；Windows未执行，不把YAML/清单验证当原生构建通过。installer参数测试通过，最终默认命令完整复跑待其他Agent释放当前App后进行。

课堂日记内容补强：沿既有已审查记忆/课堂提要方案，直接复用课堂信件已生成的带segmentIds重点句，不新增摘要模型或算法。结束事件最多携带6条、每条240字；记忆侧再次限长/核来源字段/敏感过滤，正文明确识别可能有误，不将知识点推断成班级特质。此前只记段数的记录兼容保留。日记活动/模型5项、课堂17项通过；首次课堂测试暴露原fixture默认require多退一级，改为正确已安装runtime-modern路径后通过，不降低WAV实际校验。最终包需重新构建才含此补强。

2026-10-01 开发默认入口统一：先官方Electron完整桌面框架检索`site:github.com/electron/electron v44.0.0 desktop`，再`site:docs.npmjs.com package aliases npm package.json aliases`；Electron仓库https://github.com/electron/electron ，固定44.0.0/MIT沿已验Host支持指纹，npm官方alias规范允许同名版本并存。采用electron-modern:npm:electron@44.0.0作开发别名，保留39供旧代兼容回归，不把第二套Electron放入独立App产物。默认dev/start选新版实际运行树，显式dev:legacy保留旧路径；锁文件已更新但尚未安装alias或实际启动验证。使用模块返回的跨平台二进制路径避免Windows.cmd问题，并清除宿主Electron覆盖变量。不会在真实home执行测试迁移。长期成本是迁移期两代测试工具，待旧兼容退出后可删除alias；不重新实现下载器。

开发资源闭包补验：源码插件仍带旧代node_modules，单换Host目录不保证一致，因此默认开发启动直接复用已验生产stage到独立受管.mo...dev...nosync，不碰安装包或用户home；现实际复制35插件/821依赖成功，新版peer检查通过。marker/边界保护沿用原实现，源码插件依赖未修改。Electron alias实际安装和开发启动验证等待旧样本生成完成，避免并行改其正在读取的旧原生依赖树。

旧Session实际迁移已通过4种隔离样本：真实alpha/Electron39生成v2，实际包内rc2/Electron44读取、发布v4、续写并冷进程重开；none/zstd分别覆盖完整与截断尾部。读不发布，源SHA与逐字节不变，Mochi聊天模式、记忆工具/结果/来源元数据保留，未读取真实用户数据或付费调用。详session-migration/session-migration-results.json。开发electron-modern实际安装完成，官方44 installer/checksums复用；开发物理资源在该44二进制下SQLite/canvas/sherpa模块/PTY探针通过（modern-dev-native-runtime.json）。默认dev完整GUI启动待聚焦测试释放后验证。

默认开发启动实际验证完成：清除开发运行路径override，仅传临时DSH_HOME/userData，node scripts/dev.mjs教师19.276s、教室15.819s均exit0与真实主窗Host SMOKE_OK；证据modern-dev-launch.json。双端实际安装包语音输入也已通过，教室0.1426s推理、草稿可编辑且无自动发送，记录packaged-voice/classroom；输入源为合成音频而非学校硬件。教师身份中文输入初遇旧Playwright CDP insertText不发input事件，改用官方webContents原生输入后真实UI请求及保存刷新已通过，不改产品表单来适应夹具；剩余页面仍在完整验收。

### 2026-10-01 侧栏底部入口宽窄适配

先完整应用/框架生态检索 `site:github.com deepseek-ai deepseek-harness sidebar footer wide uiKit Button`、`site:github.com CherryHQ cherry-studio sidebar collapsed icon button`，再组件 `site:github.com deepseek-ai deepseek-harness dsh-client-ui-primitives Button icon`。检索成功，官方搜索命中完整client生态/组件、Cherry命中其应用侧栏指引与功能讨论，未将讨论当源码适配证明。直接采用 https://github.com/deepseek-ai/deepseek-harness 已核639ed015397290b3745d163aafe02ffee4aa3f84/0.2.0-rc.2/MIT；本轮实读所安装primitives LICENSE/package/types/Button.module.css、sidebar owner slots及其footer渲染源码。其public sidebar.footer.action owner提供wide:boolean，false为56px rail；primitives公开Button ghost、Tooltip和Archive/Clock/Question SVG已可复用。没有uiKit服务，不猜私有字段。React18公开原语与现有loader相同，Cordis当前4.0.4满足其peer~4.0.4；新版本09-29发布且此次实际运行已证明，升级仍应复查这些公开契约。Cherry整套AGPL/独立UI无需移植，官方同栈组件可满足本次需求。

确认缺口：新memory/planner/onboarding入口没有接收wide，裸文字在56px侧栏竖排并继承默认button粗边框。采用官方Button/图标/Tooltip加局部宽窄几何，保留原主题令牌、aria/title/事件/role，不新增图标库或全局配色。一个纯helper由三现有客户端build内联，不新增运行资源文件；primitives external继续使用官方ModuleLoader已提供的同一组件，不能重复bundle另一个React。后续实际构建与宽窄几何结果另记，不把静态声明当完成。


### 2026-10-01 LAN 现代 Host 同机发现修正

完整应用检索 `site:github.com localsend localsend LAN discovery pairing application` 和框架检索 `site:github.com deepseek-ai deepseek-harness plugin connection authentication API`；LocalSend https://github.com/localsend/localsend/tree/v1.18.0 网页抓取失败、raw LICENSE成功确认Apache-2.0，所猜源码路径404，不宣称本轮适配其实现。采用已核DSH Connection https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84 的rc2/MIT认证与既有Mochi协议。再查Node dgram reuseAddr/Windows UDP broadcast和Microsoft SO_REUSEADDR；实读https://github.com/nodejs/node/blob/v24.18.1/doc/api/dgram.md，复用内置reuseAddr:true，仅作用发现接收socket。Microsoft仅明确同组播组共享投递，未推定Windows广播结果。无新增依赖，不改HTTP认证与配对。

旧实际包同机第二完整Host EADDRINUSE已复现；明确探测路径的配对/纸条/30秒无人seen/回执/重启通过，与修正stage约4秒自动发现、广播组播双收、重启地址更新通过分开记录。最终新App尚待重建复跑；学校网络、Windows及GUI隐藏行为不能由macOS headless代替。详 docs/evidence/harness-upgrade-2026-09-30/lan-modern-host-notes.md。

快照闭包补充：继续复用原精确快照机制，补入三个侧栏客户端的build/entry、记忆journal-ui/view及引导navigation/sidebar-action源码。共享helper在既有esbuild内联，生产资源不多复制运行模块；只列精确源文件，不递归收入各插件node_modules。当前仅报告清单差异，最终源稳定后统一重算hash。

侧栏首次包内断言已撤销：公开renderer的slot anchor使用`display:contents`，官方footerActions默认横向flex，width100%入口会并排溢出。先前测试取该零尺寸anchor作sidebar边界并跳过检查，不能证明布局正确；原记录/截图以invalidated保留。补充实读同固定rc2 renderer的ANCHOR_STYLE与sidebar实际footer源码，按公开`data-slot="sidebar.footer.action"`限定其直接父容器为纵向列表，宽栏stretch、窄栏center，不依赖hashed class、不改全局配色。照片课表composer复用同一官方Button ghost/md，原照片草稿处理保持。新的实际包断言要求真实有盒子的sidebar根、全部LAN/监听/记忆/课表/指引边界、中心命中及不重叠；构建与契约已通过，最终重建后的真实布局结果待补。

修正版最终实际App宽窄验收完成：Electron44/Node24实际双端App自行Host启动，临时home且无开发override，先真实完成7步与刷新恢复；12条/errors=[]。全部teacher3/classroom5个footer贡献者均在boxed sidebar根范围内、中心命中、纵向不重叠；wide280px/rail55.5px，classroom整栏分别x12..268和x9.75..45.75，实际宽窄截图已人工核入口全部可见。照片课表Button样式正常，双端相机outer穿孔/折边/阴影通过且video无纹理。6个受测client资源SHA与源生成产物一致，详sidebar-footer-reuse.md与packaged-sidebar-footer/checkpoints.json。首次错误断言和溢出截图保留invalidated，不能将它们重写为通过；真实学校摄像头/校园授权账号不在此软件布局验收范围。


### 2026-10-01 已验App封装预览DMG

完整框架检索 `site:github.com/electron-userland/electron-builder prepackaged macPackager` 成功命中 https://github.com/electron-userland/electron-builder 的完整分发功能、CLI prepackaged文档与MacPackager源码；网上master仅用于发现。实际适配依据本机固定25.1.8/MIT的out/macPackager.js、packager.js、builder.js：非MAS的prepackaged直接packageInDistributableFormat，不再doPack或重建依赖。采用既有框架直接封装已验App，不新增打包器；独立modern-preview输出、publish never，不覆盖历史DMG或安装用户App。后续需要hdiutil校验/只读挂载与文件hash比对。此包不带凭据种子，标记预览，不替代正式双平台交付。首次审计append因cwd在apps/desktop而相对路径不存在，已按绝对路径补记；打包进程正常继续，未当成构建失败重启。

2026-10-01 最终包团队链补验：重新实际GitHub搜索先完整生态 `site:github.com/deepseek-ai/deepseek-harness agent team spawn_teammate desktop`、`site:github.com/CherryHQ/cherry-studio multi agent team collaboration`，再公开投影契约 `site:github.com/deepseek-ai/deepseek-harness agentTeam projection slots`。命中官方完整团队文档 https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/agent-team.md 与tool README；Cherry命中完整应用 https://github.com/CherryHQ/cherry-studio 及仍是需求讨论的多人协作，不据讨论当实现。采用原固定0.2.0-rc.2/639ed015/MIT同栈官方team，主分支仅作搜索线索；实读安装包tool-agent-team/lib/index.js的spawn/create/claim/complete/list公开schema，成员只认领自己的任务、revision CAS更新，沿原团队fixture补实际App/main创建Host验证，不另写调度器。不新增依赖或修改业务，只使用隔离用户本地模型网关。固定Reply证明工具/投影/四配色/导航软件链，不证明智能协作质量；新包结果待实际运行。

最终包通用+团队补验通过：实际Mochi.app/Electron44自己的main/Host，隔离home、官方用户模型配置指向本地固定网关，没有额外Node Host或探针插件。通用初轮124个schemas确认write/mochi_call_student/mochi_ppt_create/spawn_teammate；3次官方spawn，各成员自己的team_task_create→CAS claim→complete，3结果revision3/statuscompleted，Lead再取得team_task_list真实回执。四Mochi配色唯一、真实成员导航/返回Lead、880px按钮在窗口内，官方任务板截图3项已完成，errors=[]。资源内容SHA覆brand/theme/modes/profile；详packaged-team/team-runtime.json及专属test-packaged-team-ui.mjs。固定网关不是教学准确率证明，工具schema可用也不是执行真实呼叫/改文件的证明。测试App已退出。

预览DMG封装已验证：electron-builder prepackaged执行exit0，hdiutil verify通过；只读挂载对比全部25324个普通文件（内容/大小/可执行位）和14个符号链接与受测App完全一致，卷已卸载。SHA256 721ed50a1ba316e422c46e3381a95f3a64e925328f49384025de9205bee280d9，证据modern-preview-dmg.json。未签名、无凭据种子、未安装或发布，不扩大为Windows交付。

### 2026-10-01 启动失败诊断窗口 Apple Design 修复

先完整应用/框架实际搜索 `site:github.com/electron/fiddle diagnostics window error retry electron app`、`site:github.com/microsoft/vscode startup error dialog recovery`，再组件 `site:github.com/electron/electron dialog keyboard accessibility error recovery`；第一次工具连接失败，明确不是无现成方案。重试完整生态 `site:github.com/electron/fiddle startup error`、`site:github.com/microsoft/vscode startup error dialog` 与组件`site:github.com/electron/electron dialog defaultId cancelId`成功。核 https://github.com/microsoft/vscode/tree/1.105.0 的LICENSE.txt和src/vs/code/electron-main/main.ts：MIT，已有针对启动目录/其他实例故障的明确原因与下一步，而非只吐code。只采用其信息层级原则，不复制VSCode服务容器或UI依赖；该固定历史版本仍可读，当前仓库持续维护不代表该版本为最新。

采用 https://github.com/electron/electron/tree/v44.0.0 现有框架：实际读取44 LICENSE/MIT及BrowserWindow文档，沿现有sandbox/contextIsolation/本地data页与公开webContents API，不加组件库或更换窗体。Apple Design完整skill已读，采用即时按钮反馈、状态/错误反馈、明确路径、键盘焦点与减弱动效；保留纸面主题令牌/原结构。实读doctor-window确证：异常无result却显示disabled“正在检测”；复制/保存loadURL丢焦点且保存可重复触发；近启动失败仅页底code、基础检查通过易误读恢复。本轮仅窗口及专属测试修复，不触碰root负责的main/doctor/profile/Host兼容逻辑。重新检测不等于重新启动；新诊断code在generic恢复区显示，不据未知code猜根因。新交互测试待实施验收。

### 2026-10-01 实际旧用户启动失败与恢复交互

本轮先完整应用/框架检索 `site:github.com/deepseek-ai/deepseek-harness desktop profile startup settings migration`、`site:github.com/CherryHQ/cherry-studio startup error recovery electron`，成功命中官方 https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md 的配置保留/启动恢复机制、Cherry https://github.com/CherryHQ/cherry-studio/issues/19579 的启动迁移失败案例。讨论仅作为线索，不当本项目根因。实际适配依据本机固定Harness0.2.0-rc.2（既有639ed015提交审计）app-boot/package.json/LICENSE及公开代码，MIT；不移植Cherry独立应用/依赖。采用既有Electron44与DSH配置加载，部分采用原因明确的恢复交互，不换内核或另建迁移框架。

已确认：用户实际/Applications/Mochi.app启动在Host子进程输出前失败；只读调用同包planLegacySettings对真实教师home得到“旧 DeepSeek 自定义网关需确认 Messages 协议兼容性”，教室无此迁移错误。此前干净home测试未覆盖真实旧网关，不能据其PASS宣称老用户可打开。修复需保留旧网关协议/凭据引用/默认模型，补实际旧设置与幂等/冲突测试；不读取输出凭据值、不删除历史或强制改官方地址。长期维护保持公开provider适配，新增固定配置准备错误码与原有诊断白名单，避免在界面泄露原始日志。

诊断恢复交互已完成：9个无GUI状态/纯页测试与TypeScript通过；真实隔离Electron44窗口验证先异常后重检、11项报告copy/save脱敏、焦点恢复和关闭取消；三个启动UI函数在真实44组件页验证Tab/Enter、copy busy反馈/回焦点、retry status及880无溢出，原paper-accent+深字保留。界面不再出现DSH/受限桥接实现说明；近启动失败明确“重检不重启”、新code提示设置保留。证据doctor-recovery/notes.md，组件页不替代root实际App旧settings重放。记忆/课表已有native modal/Escape/入口焦点、记忆roving tabs与课表草稿保留，未找到需重写/换色的新缺陷；未穷尽200%文字或屏幕阅读器，明确保留验收边界。

本次兼容修复采用固定rc2官方pi-ai的OpenAI Completions adapter，旧alpha实际wire与新版schema均已核。详细完整检索词、固定提交/许可、字段映射、默认选择跨冷启动保护及侧栏false/true策略见 [legacy-gateway-settings-fix.md](evidence/harness-upgrade-2026-09-30/legacy-gateway-settings-fix.md)。实际完整Host冷热两轮4个本地协议请求通过；真实settings副本双角色升级/冷启四次实际App通过。/Applications/Mochi.app现已更新，原App保留deliverables/installed-app-backup-20261001/Mochi.app；实际用户窗口已到Mochi新手指引且原有会话列表可见，旧settings原文备份SHA核对一致。未代填身份或代完成指引。证据startup-recovery-2026-10-01/。


### 2026-10-01 光标跟随、品牌与场景精简

先检索完整生态 `site:github.com/deepseek-ai/deepseek-harness reasoning effort model selector agent preset registry`、`site:github.com desktop pet mouse follow head eye tracking OpenPet`，再检索 `site:github.com dengyie OpenPet desktop pet` 与 `site:github.com/localsend/localsend releases v1.18.0`。真实仓库 https://github.com/deepseek-ai/deepseek-harness 、https://github.com/dengyie/OpenPet 、https://github.com/localsend/localsend 。OpenPet仅完成发现，未核固定提交/许可源码，不宣称适配或引入；整套应用不解决已有引擎坐标映射错误。实际采用已有Harness0.2.0-rc.2/639ed015397290b3745d163aafe02ffee4aa3f84/MIT公开slots与registry，维护成本限于产品适配层。

动效继续采用已核MIT固定 https://github.com/jeremy-prt/bloub/tree/b4bb3c1b5f93c7b87a2e8d620f667c4093d97749 （0.1.1）。再次实读本地固定face.ts、engine.ts与LICENSE：屏幕Y向下，pitch正值向上；当前适配把屏幕正Y直接传正pitch，确认错误。仅修共用适配器，vendored文件及依赖不变；补真实眼睛投影方向测试，生成web/native同源产物。上游发现信息不用于声称最新维护状态，固定版本回归由现有校验覆盖。

场景列表类型没有hidden字段，直接停用旧preset可能破坏历史会话，故采用公开slot优先级替换选择界面，保留后端旧定义。品牌只改产品字标/标题，不改学校数据。Apple Design用于按钮层级、焦点、渐进展开，保留既有配色。

小信箱与发送确认沿上述复用原则完成：LocalSend v1.18.0/82471a523411906d52f410e71503093c563ba44a、Zulip11.0/cb9bb96226ce93be2fc8f46f9b93da1a503ad3ca（Apache2）部分采用信息层级；Radix固定f7ecd5ab16f5e1e820eb5786a1419a98a2d594ae/MIT核交互契约但不加依赖。完整实际检索词、许可证/依赖决策与真实工具测试见 [mailbox-redesign/reuse-notes.md](evidence/harness-upgrade-2026-09-30/mailbox-redesign/reuse-notes.md)。首屏消息/已发分离、称呼与本机设置平级摘要，技术诊断展开；发送确认保留目标与全文/附件动作。client38/38、chat17/17与dispatch测试通过，不能据此宣称最终GUI通过。

场景选择复用固定rc2官方apply/controller的局部facade与公开slot priority，保持真实staging/locked/default设置机制。14项测试包括6项实际官方bundle控制器集成，尚非最终GUI验收。详 [reuse-audit-scenes.md](reuse-audit-scenes.md)，无新生产依赖，仅显式注册已有官方客户端模块。

自动思考继续复用固定rc2公开agent/request、ModelInfo能力目录和原生ModelSelect组件；局部slot仅分开模型与档位显示，不修改共享目录或上游私有缓存。真实Host验证纠正Connection重复路由回滚、Session未知事件不兼容两处问题，最终使用单路由与独立原子策略元数据。24单测、4迁移、教师/教室真实Host包含冷恢复均通过；完整研究与GUI边界见 [automatic-reasoning-notes.md](evidence/harness-upgrade-2026-09-30/automatic-reasoning-notes.md)。


### 2026-10-01 输入栏实际截图回归

按用户反馈先CUA实看安装App：工具左组过宽迫使模型/语音输入/发送掉到第二行，工作对话与语音对话重复占位，拍题实心边框按钮与其它轻量控件尺寸不一。实际GitHub先搜完整生态 `site:github.com/open-webui/open-webui MessageInput.svelte controls input composer`、`site:github.com/deepseek-ai/deepseek-harness conversation input toolbar slots`，命中 https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte 与官方 https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-conversation/src/client/contract/slots.ts 。OpenWebUI仅发现，不引用其当前主分支许可为可接入证明，不安装/复制其Svelte组件。

实际采用本机固定Harness0.2rc2/639ed015/MIT InputBar与ModelSelect，实读row/tools/trailing/standardControls布局与公开conversation.input.left/right/model/activity slots。保留原生编辑器、上传、录音接管、发送生命周期；删除产品重复入口、按公开slot分组，通过data-composer-card/data-slot窄范围样式规范高度与间距，保留官方响应式换行/录音扩展能力。避免复制InputBar或依赖hash类。新局部样式须实际窄宽窗口核对。

用户进一步明确取消工作/对话二分，删除其client入口、slash命令及运行时chat工具限制，仍保留旧v2历史checkpoint/projection读取；原角色、权限与审批链不变，20项针对回归通过。增量检索与固定rc2权限/工具机制核查已补在 [reuse-audit-scenes.md](reuse-audit-scenes.md)。旧限制随新版Host重建作用域消失，不尝试按未知owner释放正在运行的restrictions。

安装后真实GUI又暴露旧home两段pi-ai.providers整字典覆盖：实际44/rc2 Host复现MiMo NO_ADAPTER，并确认原控件catch误报为“未声明档位”。最终在全部迁移规划完成、写入前合并互不冲突的providers；保留YAML节点/URL/凭据引用/显式能力，重复冲突拒绝。空白MiMo会话无凭据也返回4档，两角色、冷恢复、原自定义网关冷热4请求均通过。26插件/5迁移测试，来源与边界继续见automatic-reasoning-notes.md。

回复朗读复用固定 rc2 slots/session 公开事件与已有系统 TTS，完整应用检索覆盖 Harness、Open WebUI、Open-LLM-VTuber，再核 dusbin/voice-plugin；实际固定提交、许可证差异和不引入其它音频栈的理由见 [voice-header-reuse.md](evidence/harness-upgrade-2026-09-30/voice-header-reuse.md)。16 client / 4 native 测试及真实 Host 两轮事件验证通过。当前实际 GUI 开关从“开启回复朗读”到“关闭回复朗读”再恢复，未启动录音或出现麦克风授权；最终 header 保留原右侧栏按钮的修正尚在验收，不把事件测试当物理扬声器播放证明。

实际 GUI 增量修正：原生模型 entry 晚注册时旧 slots.inject 未再触发，现用公开 slots.subscribe 幂等跟随；手动写入与目录 refresh 共用 generation 导致 busy 不释放，现分开生命周期。29 项构建/测试通过，包括固定官方 SlotCore 和 ModelSelect 契约。朗读停止占用原 sidebar corner，改公开 leading 并跟随 sidebarRight.mounted，保留原 ExpandButton/快捷键；16 测试与 20 个真实官方 CSS/代表 DOM 布局用例通过，实际包再验待补。均无新框架依赖、不改共享核心；专属两份 notes 记录了首次误判与修正边界。

第二轮安装 GUI 实测模型名称/自动手动切换/原模型菜单通过，右侧栏打开后约360px输入区自然换行且语音/发送完整可见。又发现原朗读布局夹具漏了实际 SlotOutlet 的 display:contents wrapper，导致安装窗口两个顶栏按钮分行；旧20例不再作为通过证明。夹具加入真实 wrapper 后先复现失败，再修正公开 session.header/corner hook 的真实标题行 grid-area，新增同线断言20例通过。保留 before-fix.json，最终安装截图待最后确认。

最终安装 GUI 已确认两个顶栏图标同线不重叠、输入工具宽布局一排、窄内容区整齐换行、模型/档位分离、自动手动可反复切换。真实中文输入/清空正确控制发送状态，未发测试消息。macOS本机已更新，原App保留备份；证据 [ui-refinement-2026-10-01](evidence/ui-refinement-2026-10-01/README.md) 与 installed-delivery.json/composer-final.png。不扩大声称真实校园、Windows或物理音频验收。

### 2026-10-01 探索品牌、旧模式遗留与身份复查

先完整应用/框架检索 `site:github.com/deepseek-ai/deepseek-harness agent team spawn_teammate`、`site:github.com/CherryHQ/cherry-studio multi agent collaboration`，再组件 `site:github.com/deepseek-ai/deepseek-harness 深度求索 turn status`、`site:github.com/deepseek-ai/deepseek-harness RunningStatus data-chat-running RunningWhaleTail`。官方 https://github.com/deepseek-ai/deepseek-harness 的团队文档/工具目录命中；Cherry https://github.com/CherryHQ/cherry-studio/issues/13301 只是功能请求，不据此宣称已有兼容实现。组件精确搜索没有返回源码，非检索失败；转实读本机固定rc2源码。

继续采用官方0.2.0-rc.2/639ed015397290b3745d163aafe02ffee4aa3f84/MIT（本次重读ui-chat package.json/LICENSE、RunningStatus/RunningWhaleTail和locale注册），不引入完整其它应用、依赖或自写时钟。已确认新增 chat.deepDivingFor 未被品牌字典覆盖，旧 _turnStatus 结构已不适用；沿公开 data-chat-running 更新现有Mochi挂载，并只隐藏该状态组件内的装饰鱼尾。计时、aria-live和停止生命周期继续由原生组件管理。维护成本限固定版本结构适配，补真实组件结构与有/无计时文案回归，升级时需复验。

团队启用的本轮只读源码/已安装资源结论见 [team-enablement-notes.md](evidence/harness-upgrade-2026-09-30/team-enablement-notes.md)。当前明确用户意图才允许spawn、仅teacher profile启用、8队员上限/继承当前模型、Lead+3四色均按固定源码核对；不把历史团队夹具PASS当新模型实际分工质量。没有擅改自动协作授权或给普通问候增加多模型调用。

旧模式提示确认是历史command/run+done记录，当前system/request上下文未再次注入。复用官方公开 keyed conversation.chat.commandview，仅给两个精确旧command name挂null renderer，不改日志/用户消息/其它命令。21项测试含固定SlotCore注册与卸载通过，详 [reuse-audit-mode-history.md](reuse-audit-mode-history.md)。

真实运行后补确证：当前rc2 SessionListState不再有current，旧头像动效因此未取得活动会话。重读官方api-session-controller contract与sidebar-right公开mounted，改用mounted取得主区会话并订阅变化，新增已安装同版本client依赖，不猜私有selection。测试新形状明确删除list.current，防假夹具掩盖该回归。

身份独立system section与10轮双端/场景实际payload证据见 [product-identity-reuse.md](evidence/harness-upgrade-2026-09-30/product-identity-reuse.md)。第一次真实MiMo回应未遵从，不能据payload在场声称行为已修复；目标会话最新system记录确认已带约束，gateway端是否改写尚无证据，正继续最小当前轮上下文验证。

身份最小续修使用官方公开systemPrompt.context和RuntimeContextProjection去重，短正向当前产品身份，不替换模型输出、不重复注入长system。真实MiMo适配器pro/high隔离loopback确认system与当前context序列化保留；双端/四场景10轮再验通过。远端是否遵从需最终GUI实际回答，详product-identity-reuse.md与product-identity-wire.json。

最终真实App复验：原问题会话保留旧MiMo自称，用原mimo-v2.5-pro/high再问同句名字得到“Mochi”，并实看Mochi等待动效、探索文案、无鱼尾、旧mode卡隐藏通过。已更新/Applications，资源SHA一致、旧App备份；证据 [identity-status-2026-10-01/status-notes.md](evidence/identity-status-2026-10-01/status-notes.md)。一次真实回应通过不夸大成全模型全问法保证。

### 2026-10-01 已完成但无正文

先检索完整 Harness/pi-mono，再检索社区 empty-response-guard 插件；实际搜索词、官方固定 rc.2 提交、社区 `00d7ad86ef01cf667f41d805ea69d6f1f172006c` / v0.2.1 / MIT、旧 peer 不兼容及部分采用理由见 [empty-reply-guard-notes.md](evidence/harness-upgrade-2026-09-30/empty-reply-guard-notes.md)。实际目标会话第2轮无任何正文流，只有推理却以 stop/completed 结束；不把持久化流当远端原始数据，不臆断网关责任。

复用官方公开流与 request-error 扩展，在现代实际 llm-pi-ai 路由增加 MiMo 专属一次恢复，而非修改已禁用的兼容适配器。历史显示采用公开 turnTail list 独立贡献，24项测试含实际 rc.2 bundle 重放通过，详 [reuse-audit-empty-reply.md](reuse-audit-empty-reply.md)。无新框架依赖，不改聊天历史或核心 node_modules。真实后台与安装验收记录汇总于 [empty-reply-2026-10-01](evidence/empty-reply-2026-10-01/README.md)，尚未完成的验证不得称通过。

### 2026-10-01 私有教材源恢复与按需skill目录接线

开发前实际先搜索完整Skill Seekers转换生态 `site:github.com/yusufkaraaslan/Skill_Seekers PDF book skills conversion`，再固定ChinaTextbook来源与PDF.js组件；采用既有catalog/import与固定pdfjs-dist6.3.289/Apache-2.0（本机Node24兼容），不下载全仓、不另写PDF解析、不调用模型。GitHub API403确为rate-limit，网页另显示仓库disabled；固定raw仍实际34源全部可下，通过字节/blob/SHA256核验。许可未获得，README叙述不作教材开放授权；全部正文在git-ignore的nosync私有根。33册4844页已实际读取/隔离导入，3982文字层、822待OCR、40无文字层，不把扫描书当全文可搜。详[source-recovery.md](evidence/textbook-skills-2026-10-01/source-recovery.md)及元数据结果，真实home未写入。

接线复用已核官方Harness rc2/MIT skill-filesystem.customSkillDirs，一层发现与按需body契约，已有yaml AST合成。现代profile保留静态及用户自定义roots，再加当前role绝对home/knowledge/book-skills，不扫描全home、不新provider或扩权限；原alpha不变。两role配置dump/幂等/缺库/后置用户参数保留及独立官方最小Host scoped FS实际router加载通过，旧modern profile回归通过；完整workspace Host初试因mochi-grades开发闭包缺tmp失败，未冒称其通过或靠禁业务绕过。root接最终真实双端安装，独立notes已记录维护边界。


### 2026-10-02 新功能宣传片 V9
用户明确要求直接录制并制作新版视频，覆盖节日祝福、待办与当前新功能。先检索完整应用/框架：`site:github.com hyperframes video framework`、`site:github.com remotion remotion video`、`site:github.com screen-studio screen recording open source cap`；再检索组件 `site:github.com/greensock/GSAP timeline license`，补 `site:github.com/remotion-dev/remotion license`。搜索均成功，Remotion 首轮误命中后定域补查成功。
实际 GitHub API 核验：HyperFrames https://github.com/heygen-com/hyperframes @ d4756f597c0dbb66310c2add699de6767b23f11b (2026-10-02)；Cap https://github.com/CapSoftware/Cap @ a2a6bd8b1948c48fe92936c265c8402d7fa8ddb3 (2026-10-01)；Remotion https://github.com/remotion-dev/remotion @ c320056a980972de109ef27a40bede9660a46931 (2026-10-01)；GSAP https://github.com/greensock/GSAP @ 13e2b790546426a1a2e0e9b409f3f8dc6d6611f2 (2026-04-13)。日期只表示所查提交，不能保证长期维护。
采用已安装 HyperFrames 0.8.36（package.json Apache-2.0）及 GSAP 3.15.0（Standard no charge license），保留现有 HTML 时间轴/逐帧渲染，不升级依赖；Node 24.19.0、FFmpeg 已存在，实际渲染结果另记。Remotion 有实体规模相关许可且需迁移 React 工程，不采用；Cap 提供完整录制编辑，但本机现成原生录制+既有渲染链可复用，不为本次增加桌面应用，未做 Cap 接入许可或兼容性验收。维护影响：仅新增 promo/v9 源工程、素材覆盖记录及成片，产品代码和旧成片保留；使用独立演示运行目录，未验证的功能不冒称拍摄完成。

参考指定仓库固定提交 3d54892e2ae5b0e8d337171e6508bba4cec01ab8，已读 MIT LICENSE、六篇条目，部分采用对象驱动转场/真实UI/确定性导出，详 promo/v9/evidence/reference-decisions.md。演示日期仅在隔离 HolidayGreeting 的 now 注入10月1日，系统时钟不改、模型不模拟，片中必须标注演示日期。

#### V9 真实拍摄暴露的表格依赖修复
实际检索完整框架/插件生态 `site:github.com/deepseek-ai/deepseek-harness sandboxPolicy inject plugin tools`、`site:github.com/dream-num/univer spreadsheet plugin`，命中 https://github.com/deepseek-ai/deepseek-harness 与 https://github.com/dream-num/univer-presets 。再核 Harness 官方 services/inject 文档及本机 Cordis reflect.ts 的 without inject 分支。继续采用已安装 Harness0.2.0-rc.2/639ed015/MIT、Cordis4.0.2/MIT 与现有 ExcelJS4.4.0；Univer仅发现，未接入，完整编辑器并不能解决当前依赖声明遗漏。真实主/子会话均已复现 sandboxPolicy without inject，mochi-sheets调用该服务却只声明tools。最小修复只补已有sandboxPolicy依赖，不扩大路径或权限，不升级库。保留原安全检查，新增真实服务挂载验证后再录制；不将单测通过等同GUI成功。

#### 2K120 / 仅 Mochi 窗口采集
用户明确新要求后，先复查完整应用Cap/OpenScreenStudio，再查ScreenCaptureKit窗口组件。实际搜索 `site:github.com ScreenCaptureKit window recording SCRecordingOutput`、`site:github.com/CapSoftware/Cap ScreenCaptureKit window recording minimum_frame_interval`。继续不迁移完整录制编辑应用；部分采用 https://github.com/nonstrict-hq/ScreenCaptureKit-Recording-example @5387e82340d961302cef4550178e211fd7f49d22 (MIT，API读取许可全文存references/sck-LICENSE)。实读main.swift，复用AVAssetWriter时间戳/完整帧/结束帧机制；改为desktopIndependentWindow，仅允许Mochi应用窗口，2560×1440、minimumFrameInterval1/120，不采麦克风与其他窗口。本机macOS27/Swift6.4兼容性待实际编译与采样验证；SCK静态界面按需送帧，源帧率与120fps最终渲染分别记账，不声称设置请求即原生120。

#### V9 改为全代码场景
用户明确允许全片由源码驱动代码场景，继续采用上述已核 HyperFrames0.8.36/GSAP3.15.0，不迁移Remotion。26场景、30功能组使用项目实际功能来源，界面内注明代码演示与示例数据，原始录屏不是成片依赖。生成器、字幕、音乐合成器集中promo/v9，不增加产品运行依赖。安装版渲染器代码核验：多worker默认磁盘路径预计约506GB，因此使用其现成HF_CAPTURE_PARALLEL_STREAM=true并发直接编码路由，保留2560×1440/120fps与286秒；实际成片验收另存结果。

### 2026-10-02 V10 重做：真实界面与 Meta Muse 参考

用户否定 V9 的同质化卡片及改写产品界面，确认复用 v9/private.nosync 今日原片，缺镜允许重录；随后明确参考 Meta Muse。
实际先搜索完整框架 `site:github.com remotion-dev/remotion video framework`、`site:github.com heygen-com/hyperframes`，再检索案例 `site:github.com yihui-dev/awesome-opus5-5-videos`、`site:github.com/yihui-dev/awesome-opus5-5-videos muse`，后者未定位特定 Muse 条目，不等于仓库无此条目。参考仓库 API main 已重新核实为 3d54892e2ae5b0e8d337171e6508bba4cec01ab8；本地固定 MIT LICENSE 与 daniel-haida/brainextends 原文已读。它是案例/提示集合，不是保证可用的剪辑应用，不执行其中嵌入的提示。
框架地址：https://github.com/heygen-com/hyperframes 、https://github.com/remotion-dev/remotion 。暂保留现有 HyperFrames 0.8.36 / GSAP 3.15.0 渲染链，避免迁移成本；没有新增依赖，兼容性仍须新片实渲验证。已有固定版本许可记录沿用 V9，未声称检查所有上游最新版。
Muse 已定位官方：https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/ ，主片 Introducing-Muse_Sizzle-Video.mp4。已读发布页面，不声称看过影片。浏览器连续超时，用户确认已解锁后重试仍超时；因此逐镜视觉研究及新录制待恢复。参考片不直接作为可分发素材，音乐/Logo/界面不移植到 Mochi。
采用范围：研究物件连接、连续镜头、文字编排；不采用自造产品布局、等长11秒分段。V10 当前仅源码候选清单和待核验导演预算，不能标记成片完成。

#### V10 首页短祝愿
追加检索完整 Harness 生态 `site:github.com/deepseek-ai/deepseek-harness greeting home`，只命中路径基础设施，没有可直接解决本项目节日长标题的现成插件；非搜索失败。继续部分复用固定 Harness rc.2 既有主页 locale 接口与本地 HolidayGreeting，不增加依赖。源码已核当前生成上限60字、校验80字、缓存直接返回；最小改为祝愿16字、完整标题28字，长称呼省略而不截断句子，旧长缓存回退现有短节日句。8项真实单测通过，包括旧缓存与长称呼；演示覆盖文件已同步，安装包尚未重建。

#### V10 原组件动效接入与当前验收

后续原生Chrome和Mochi控制恢复；Meta官方82秒主片已实际抽看0.8/10.7/20.6/30.5/40.5/50.4/60.3/70.2秒，详promo/v10/Muse参考拆解.md。此前“未看过、控制不可用”是初期状态，不再作为当前结论。用户最新明确允许本地源码渲染真实组件。
继续部分采用已核HyperFrames0.8.36/GSAP3.15.0，不迁移Remotion；本次直接导入真实OrbCompanion/MochiTeam与原LAN TeacherRequestRow，原主题bridge/paper/controls一并打包。首轮遗漏主题曾产生与实机不同的绿色卡片，已发现并修正，不把仅引用React组件当视觉适配成功。使用React静态渲染保留原DOM，原BotEngine按确定时间采样，外部时间轴只控制舞台变换；不修改产品组件。示例分工和请求不是运行成功证明。
30秒动效样片已实际导出2560×1440/120fps/3600帧/AAC双声道；组件逐帧渲染、模型段为60fps/VFR来源，不能称全片原生120采集。运行、排版、动效检查通过，46项文本对比检查通过；还有完整音画人工审片限制。4—5分钟全功能长片未完成，尤其叫人、A2A、校园放行不能以这段样片替代。维护范围promo/v10，source-manifest.json记录直接依赖源码SHA；素材与导出不进Git。

### 2026-10-02 V11 K3 对象连续转场

#### 暖心节日祝语与采集恢复

实际检索完整框架 `site:github.com/deepseek-ai/deepseek-harness greeting locale home`，命中官方Harness/locale，不存在本次搜索已定位的即用“暖心祝语”插件。采用本项目现有HolidayGreeting、固定Harness0.2.0-rc.2/639ed015/MIT locale及lunar-javascript1.7.7/4c45a59，不新增库。生成提示不再引导职业事项，排除工作型记忆，生成/缓存/前端均拒绝工作提醒；共享无依赖policy供客户端构建与服务端引用。维护影响限祝语规则，日期、配额、取消、隐私控制保持原机制。14项前后端回归通过；只更新隔离拍摄插件副本，安装包未重建。

窗口采集恢复前先检索Electron完整框架/官方开关：`site:github.com/electron/electron macOS blank window disable gpu`、`site:electronjs.org/docs/latest/api/command-line-switches disable-gpu`。官方命令行文档支持相关开关，但旧issue不是本机故障原因证明。仅重启空闲演示实例并加--disable-gpu，不改应用源码、不新增依赖、不关sandbox或鉴权。重启后实际截图完整显示首页，证明此临时运行配置恢复了采集；未断言GPU驱动具体根因或已修复正式包。

#### 学生章节二次剪辑检索

用户新增折纸/纸飞机/多种转场方向后，实际增量搜索完整框架 `site:github.com/heygen-com/hyperframes GSAP animation`、组件 `site:github.com gsap paper plane fold animation`。前者命中官方GSAP确定性时间轴与3D transforms文档，后者结果未定位可直接复用的折纸组件，不等于不存在。仍复用上述固定依赖与原组件clone，新增的仅为内容相关的折纸编舞、两片纸几何和飞机SVG，不另造动画引擎。许可/兼容性沿用已核版本；不复制第三方飞机素材。纸飞机属于后期传递意象，不能作为网络送达证明，必须落到真实接收状态。实际6时点检查折叠、飞行、展开及原字形后再整章导出。

2026-10-02实际先搜完整工程 `site:github.com/heygen-com/hyperframes-launch-video GSAP`，再搜组件 `site:github.com/greensock/GSAP timeline fromTo`。命中 https://github.com/heygen-com/hyperframes-launch-video 与 https://github.com/greensock/GSAP/blob/master/types/timeline.d.ts 。前者为完整发布片示例，仅研究，不复制或接入，未核固定提交与素材许可，不声称可分发。继续部分采用本地已固定HyperFrames0.8.36/Apache-2.0与GSAP3.15.0/Standard no charge及下文记录的上游版本，不升级依赖。原生组件、现有逐帧渲染、fromTo已满足状态交接；不引入新动画框架。维护限学生章节时间轴与独立字幕层，必须实渲核对确定性、按钮定位、文字遮挡。

用户明确否定V10鼠标与动效，技术检查通过不是审美验收。主参考已改为桌面Kimi_K3_智能的新前沿.mp4，实际全片半秒抽帧并加密两处转场，见promo/v11/Kimi-K3-逐镜研究.md。
本轮先检索完整框架 `site:github.com/heygen-com/hyperframes GSAP timeline`，再组件 `site:github.com/greensock/GSAP Flip CustomEase`。前者成功命中官方core、timeline-and-labels和keyframes文档；后者本次返回未定位所需组件结果，不表述为不存在。实际仓库 https://github.com/heygen-com/hyperframes 、https://github.com/greensock/GSAP ；本机重新核验HyperFrames0.8.36/Apache-2.0、GSAP3.15.0/Standard no charge，沿用上述已核固定提交，不宣称最新版已适配。
部分采用现成GSAP时间轴、back/elastic缓动和HyperFrames媒体管理，不实现新动画引擎、不新增依赖。采用单独屏幕坐标鼠标层和同一对象连续位移缩放；没有引入Flip动态DOM测量，因为固定2K舞台可明确起终点，逐帧seek更容易验证。维护影响限promo/v11共享动效与内部审片工程，原产品组件不改。渲染检查必须分别验证鼠标长宽比、乱序seek、转场中间帧和原内容可读性；全功能长片仍未完成。

#### V11 学生章节原组件重放

开工检索完整框架 `site:github.com/heygen-com/hyperframes compositions timeline media`，再组件 `site:github.com/greensock/GSAP stagger fromTo timeline`，成功命中两仓官方时间轴与composition文档。仍用本机上述固定0.8.36/3.15.0及原许可，不引入新框架。原LAN组件已能完整渲染通知/确认/回执，因此直接导入，不另绘假信箱。原tearReadPaper使用实时WAAPI，逐帧导出不可靠；部分复用其锯齿裁切、位移、旋转及420ms时长，改用已有GSAP显式时间轴。只有舞台层新增代码；所有通知/姓名/回复均来自已校验隔离演示两端记录。维护边界为组件导出形状及CSS，构建保存SHA。首轮原主题position:relative覆盖碎片层已实见并修正。历史状态重放与新录屏分别标注，不把现有已读推断成当前网络在线。

#### V11 模型修订章节与 K3 工程对照

先搜完整工程 `site:github.com/heygen-com/hyperframes-launch-video video compositions`，再搜组件 `site:github.com/greensock/GSAP video timeline scale transition`。命中 https://github.com/heygen-com/hyperframes-launches （d7ac35069d74a3a437780579b3b7fe2f3eeace5f，2026-09-26提交）；GitHub网页k3-promo目录本次抓取受限，API及固定commit raw读取成功，不能误报无权限或没有案例。已实读LICENSE为Apache-2.0、k3-promo/index.html及package.json（目标HyperFrames0.7.66）。这是16.47秒其他K3复刻，不是用户桌面的56.7秒影片。只学习分层坐标、字距收拢、相邻场景错开入场，不复制品牌、音乐、媒体或整片；其onUpdate驱动不直接接入本工程确定性seek。继续采用本机HyperFrames0.8.36/GSAP3.15.0现成视频与timeline接口，无新增依赖、不降级。后续实渲检查真实视频帧变化、鼠标固定48×60及生成前后对应关系；未完成模型修订不能被剪成已成功。


#### V11 真实首页与预设开场

本轮先检索完整框架 `site:github.com/heygen-com/hyperframes compositions video input transition`，再检索组件 `site:github.com/greensock/GSAP timeline transformOrigin video zoom`。前者命中官方 core、variables-and-media、composition 文档；后者本轮没有返回对应组件页，不将其表述为没有开源组件。

实际仓库 https://github.com/heygen-com/hyperframes 与 https://github.com/greensock/GSAP 。沿用已核提交 d4756f597c0dbb66310c2add699de6767b23f11b / 13e2b790546426a1a2e0e9b409f3f8dc6d6611f2；本轮重读本机 package.json 为 HyperFrames 0.8.36 / Apache-2.0 与 GSAP 3.15.0 / Standard no charge。未升级或引入依赖，Node 24 及既有渲染链保持不变。

部分采用框架媒体时序和 GSAP 等比变换：视频播放与逐帧定位由 HyperFrames 管理，不在回调中自行 seek；不将 video 放在有 data-start 的普通父层中。鼠标用原有独立屏幕层，避免随镜头缩放变形。没有重写录制或动画引擎。新增代码仅为剪辑入出点、镜头编排和标题，不改变产品布局。输入示例点击仅表示填入草稿，不能剪成发送或成功生成。

实际接入验收另见 README；源码存在与文档支持不代替实渲结果。


#### V11 建模输入与原成果动态演示

先检索完整框架 `site:github.com/heygen-com/hyperframes video compositions GSAP camera transition`，再检索组件 `site:github.com/greensock/GSAP timeline video scale`。实际命中 HyperFrames core、GSAP适配器、媒体时序及 greensock/gsap-skills 时间轴文档。沿用 https://github.com/heygen-com/hyperframes @d4756f597c0dbb66310c2add699de6767b23f11b / 本机0.8.36 Apache-2.0 和 https://github.com/greensock/GSAP @13e2b790546426a1a2e0e9b409f3f8dc6d6611f2 / 本机3.15.0 Standard no charge；未升级。采用现成媒体管理与等比时间轴，不重写引擎。

继续搜 `site:github.com/jsxgraph/jsxgraph v1.13.3 moveTo update board`，成功命中官方CHANGELOG、仓库与工作流。本机vendor文件头确为1.13.3，已读 plugins/mochi-modeling/assets/LICENSE.MIT。原产物metadata记7c2176d479ae256cb9d38265bce81fa18709d01f；官方工作流把1.13.3发布列在99d8c9f，不能将前者误称release tag。只复用本机已生成模型及固定vendor，不取网络最新版。

原始 model-before-inline.html 已包含全部数学函数、参数、推导、原样式。构建仅将原先相对依赖内联到素材副本，追加确定性取样适配；原产品/模型文件不修改。适配调用原P.moveTo、slider事件、setStage及原推导节点，不另写几何公式、不新增自动播放产品能力。iframe保持原CSS作用域，避免把成果排版覆盖成宣传片主题。需要实渲验证字体、参数联动、乱序seek和各浏览器worker初始化，源码存在不表示适配通过。


#### V11 多 Agent 与内置配色

开工实际先搜完整框架 `site:github.com/heygen-com/hyperframes nested compositions video`，再组件 `site:github.com/greensock/GSAP timeline stagger colors`。命中官方html-schema、composition-patterns、variables-and-media和greensock/gsap-skills。采用已有HyperFrames 0.8.36（Apache-2.0，d4756f597c0dbb66310c2add699de6767b23f11b）与GSAP 3.15.0（Standard no charge，13e2b790546426a1a2e0e9b409f3f8dc6d6611f2），仓库https://github.com/heygen-com/hyperframes 和 https://github.com/greensock/GSAP 。没有升级或新增依赖。

继续直接复用本项目OrbCompanion、bloub原引擎和mochi-palettes.json四款配色，不另绘吉祥物。只在影片舞台上改变其位置、等比大小；真实UI用新窗口录屏，不重新设计团队页面。实际核对主Mochi/deck-maker/plan-writer/data-analyst四会话，成员当前均待命，不标成正在执行。任务完成历史与当前运行明确区分。主题设置仅改变Mochi，不声称整套界面主题。长期维护限现有组件接口与源码SHA；逐帧采样使用既有原引擎。实渲结果另见README。


#### V11 第一版联片

2026-10-02。用户明确要求先把现有镜头联合成第一版供检查，优先产出可播放的长片，不再以补录为前置条件。

检索先覆盖完整框架 `site:github.com/heygen-com/hyperframes video timeline`，再查媒体组件 `site:github.com/FFmpeg/FFmpeg concat xfade video filters`、`site:github.com/FFmpeg/FFmpeg vf_xfade.c concat`。成功命中 HyperFrames 官方 core/compositions/media 文档，以及 FFmpeg vf_xfade.c、concat.c 与官方 filters 文档。实际仓库 https://github.com/heygen-com/hyperframes 、https://github.com/FFmpeg/FFmpeg 。没有把检索未返回某项称为不存在。

采用现有 HyperFrames 0.8.36 / Apache-2.0（已核上游 d4756f597c0dbb66310c2add699de6767b23f11b）和 GSAP 3.15.0 / Standard no charge（13e2b790546426a1a2e0e9b409f3f8dc6d6611f2）。本机 FFmpeg 9.0.1，构建启用 GPL 与 version3；通过命令调用现成剪辑、xfade 和跨淡化功能，不链接或重新分发程序。无需新增库、升级依赖或再实现渲染引擎。

原有五个章节直接使用已导出画面；新增补段使用已经录制的真实校园网站、日记、偏好、历史、自动化窗口。仅裁掉窗口系统栏、黑边，镜头等比缩放；没有重绘产品 UI。结尾 Mo 继续使用本项目原组件及现有原引擎。音乐复用 Mixkit Tech House vibes，既有许可记录在 promo/v6/assets/Mixkit-music-license.txt；替换所有章节审片音轨，形成统一配乐。

维护影响限本目录，保留镜头入出点、真实状态说明、可重建脚本。审批原片仅录到待审批，模型自动播放修订未验证，不拼接成成功；当前为第一版联片，未称全部功能验收完成。接入验证包括实际输出解码、分辨率/帧率/时长/音轨核对、章节接缝抽帧与文字检查。

另已通过 GitHub API 验证 n9.0.1 标签对象 501bb49457b9dfb25d6a208832e0a6e6cd53108d，并读取该标签 COPYING.GPLv3。本工程只调用本机工具。首次补段快照发现 HTML 缺少显式 head/body 导致渲染注入后的中文编码错误，已补结构，必须以修正后快照及导出帧验收，不能把原截图当作通过。

实际大渲染发现16GB机器同时4个worker载入13条媒体导致高内存压力。已保留完成的前36秒（4320帧），余下56秒用单worker、standard+CRF17导出，合成帧率与分辨率不变。新增 prepare-render-parts / finish-supplement 只划分现有时间轴，不重新实现媒体管理；可独立重建两段。后续长片避免将所有窗口视频集中在四个浏览器中同时解码。

拼接前实测两种渲染路径的轨道时基分别为1/90000和1/15360，直接复制拼接会造成时间戳异常。已使用FFmpeg无损重封装统一为90000，再强制核验92秒、11040帧、120/1；总片所有段也统一时基。首次异常输出未交付。


#### V11 Mo 贯穿与原生查人修订

2026-10-02。用户纠正：贯穿角色是 Mochi 本尊 Mo，不是猫；泛用飞机擦屏不能代替角色连续性。

实际先搜完整工程 `site:github.com/heygen-com/hyperframes-launches k3-promo`，再查组件 `site:github.com/greensock/GSAP timeline 3d transforms`。成功命中 https://github.com/heygen-com/hyperframes-launches 和 https://github.com/greensock/GSAP 。同时重读桌面参考片的24–26、47–49秒转场分析、既存加密抽帧；确认连续对象与空间缩回机制，不宣称知道其制作软件。

已读本地固定 launches d7ac35069d74a3a437780579b3b7fe2f3eeace5f 的 k3-promo/index.html、meta、Apache-2.0 LICENSE。此仓例子不是用户桌面原片。仅借鉴层级舞台、相邻场景共存，不复制品牌、音乐或媒体。沿用 HyperFrames 0.8.36 / Apache-2.0 / 上游已核 d4756f597c0dbb66310c2add699de6767b23f11b 与 GSAP 3.15.0 / Standard no charge / 13e2b790546426a1a2e0e9b409f3f8dc6d6611f2，不升级或引入依赖；当前仓库仍有近期维护，但本工程只依赖固定版本。

直接使用本仓 OrbCompanion、ExpressiveOrb、createPainter、BotEngine、配色CSS。用原引擎纯时间采样和真实眼神朝向，不另绘吉祥物。GSAP提供透视舞台、运动和时间轴，FFmpeg提供音画拼接。长期维护范围为宣传片编舞、剪辑点与原组件导出接口；产品源码不修改。原生查人使用独立演示账号、虚拟学生和真实校园工具返回，不绘制假对话结果。

已确认：2026-10-02原生Mochi任务完成，查询林小禾返回医务室/留观中；来源为49340隔离演示后台。过程中student_card按权限拒绝，随后clinic_status返回真实演示记录。模型把UTC到访时间描述成凌晨，不能作为正确本地到访时间宣传；镜头聚焦姓名/位置/状态并明确演示数据。未验证：全功能长片验收、真实学校生产数据、模型实时定位。接入后的画面与输出验证记录在本目录README和validation.json，不以代码存在代表完成。


#### V11 第三版：原生通知、成员会话与双音轨

2026-10-02。先检索完整应用/框架：`site:github.com heygen-com hyperframes video gsap`；再检索动画生态：`site:github.com greensock GSAP CustomEase spring`。搜索成功，查阅 https://github.com/heygen-com/hyperframes 、https://github.com/heygen-com/hyperframes-launch-video 和框架官方时序文档。没有把搜索结果当接入验证。

继续采用本仓固定 HyperFrames 0.8.36（Apache-2.0；前轮核对提交d4756f597c0dbb66310c2add699de6767b23f11b）、GSAP 3.15.0（Standard no charge；13e2b790546426a1a2e0e9b409f3f8dc6d6611f2）。已有本地渲染成功证据。未安装新版、未引入新的许可证或依赖。完整示例只用于分析对象接续，不搬运品牌素材；无需迁移现有框架。

原生 rail-pages.popupPageHtml、rail-model.newAttentionPayloads 和 mochi-lan.LanPanel 覆盖通知排版、消息归档和权限状态，无需重写产品UI。只在隔离影片中将已存演示记录传入原组件；HTTP适配只读，拒绝写请求，不触发真实发送。维护成本限定为展示时钟和来源映射；产品接口变化时由构建/渲染检查暴露。

用户已确认群聊式表达只用于宣传片，保留真实软件界面。不得创造不存在的产品群聊页面，也不得编写虚构 Agent 对白、完成回执。原界面按参与者顺序展开，字幕仅说明实际职责。

音轨追加：检索 `site:github.com librosa librosa beat onset librosa` 与 `site:github.com heygen-com hyperframes audio beat sync`，找到既有HyperFrames官方beats命令及源文档（https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/references/beats.md）。本机0.8.36实际运行成功，对两条独立音轨写出time/strength。沿用现有命令，不安装librosa或自写节拍检测器。编舞关键点通过有界、保留音高的FFmpeg atempo接入，再检查实际输出能量起音；测量不冒充听审。

点击声直接执行本仓`client-plugins/jxl-theme/scripts/mechanical-audio.mjs`原始生成器，以离线AudioContext适配取得press/release样本，不复制算法或下载音效。两版同一点击时序，配乐分别来自已用Mixkit与用户指定的本地K3参考片。K3使用原片音轨，未分离纯音乐，可能保留原音效。


#### V11 信封投递接信动作

执行完整框架检索 `site:github.com heygen-com hyperframes gsap video`，再查 `site:github.com greensock GSAP motionPath timeline`。成功找到上述完整框架、launch-video 和官方 timeline adapter。沿用已锁定版本与许可证，使用现有 GSAP Timeline 与原 Mo 组件，不引入外部图标库。信封为后期矢量道具，接收端为真实 LanPanel，最终展开原生 popup。动画时钟可 seek；代码只位于 promo，维护与产品运行隔离。新增双音提示由 FFmpeg 正弦声源合成，属于后期音效，不宣称产品原始提示音。


#### V11 全片鼠标比例与点击落点复核

2026-10-02：先检索完整框架 `site:github.com heygen-com hyperframes video cursor`，再检索组件生态 `site:github.com greensock GSAP timeline transform scale`。搜索成功，复用 https://github.com/heygen-com/hyperframes 官方 cursor-click-ripple 规则与 https://github.com/greensock/GSAP 的既有时间轴。沿用前轮已核 HyperFrames0.8.36/Apache-2.0和GSAP3.15.0/Standard no charge，版本提交与依赖未变，不迁移或新增依赖。现有Puppeteer执行本地章节逐帧几何检查，不新建视频框架。

确认team-dialogue构建脚本的String.replace只替换第一处坐标，造成新鼠标位置与旧光环中心错位；改为replaceAll并重建实际章节。检查范围明确限于独立鼠标覆盖层，不能推断录屏内部光标也已无变形。结果见promo/v11/cursor-audit.json。


#### V11 功能优先：真实双端投递与转场节奏

延续本轮完整HyperFrames框架和GSAP生态检索、固定版本/许可证，不新增依赖。转场由统一6秒改为2.8/3.2/3.0/4.4/3.4/2.6/3.2秒；按各自内容量设时长，原录屏保持正常时间。只重定时后期动画，音轨锚点另算。

双端演示直接复用plugins/mochi-lan/lan-service.mjs和客户端PairingCard/InboxCard/normalizeSnapshot，维护成本局限于离线镜头适配；没有复制业务协议。实际随机回环端口执行配对、传输PPTX、接收ACK、已读回执成功，WPS仅确认启动请求，未验证窗口加载。细节与边界记录于promo/v11/feature-proof和delivery-chapter。


#### V11 功能补齐：学生完整流转与教师A2A

2026-10-02，先检索完整工程 `site:github.com/heygen-com/hyperframes-launches k3-promo`，再检索组件生态 `site:github.com/deepseek-ai/deepseek-harness ui-approval ui-primitives`。成功找到 https://github.com/heygen-com/hyperframes-launches 与 https://github.com/deepseek-ai/deepseek-harness ，采用现有HyperFrames0.8.36/GSAP3.15.0而不另建引擎。沿用前文固定版本与许可核对。原生组件实际读取本地0.2.0-rc.2/MIT包，哈希和具体依赖见promo/v11/collaboration-chapter/source-manifest.json与reuse-audit.md。

直接使用原UserStyleBubble、ApprovalFlow、MarkdownText和设计token，提取边界检查阻止源码变动后静默变形。原基础组件缺少的构建依赖仅补入影片隔离目录：simple-icons16.31.0/CC0-1.0、zustand4.4.7/MIT、immer10.1.1/MIT；符合上游依赖范围，npm许可已核，保留独立lock，不改变桌面软件依赖。

通过当前原工具、真实隔离demo后台完成问询/委托/寻物投递回应，以及DEMO003申请→放行→到达→离开→返班CLOSED。审批由已授权演示脚本确认，不能冒充人工点击实录。寻物应答结束不等于物品找到，委托接办不等于工作完成。影片复用已保存结果，不在重建时再次发送。维护成本限定原组件适配与剪辑，未改产品业务代码。30秒补段的运行、布局和96项文字对比检查通过；一项循环动画静态重叠提示仍需结合时间轴/实际输出检查。全功能验收仍未完成。


#### V11 定稿范围与Mo滚入开场

2026-10-02用户明确从本片排除语音、拍题、课表，冻结新增功能，改为细节打磨；另指定Mo滚入中央说“哈喽，我是Mochi”后进入正片。完整工程检索 `site:github.com/heygen-com/hyperframes-launches k3-promo character animation`、组件检索 `site:github.com/greensock/GSAP timeline rotation bounce` 均成功，继续复用https://github.com/heygen-com/hyperframes-launches 与https://github.com/greensock/GSAP已有固定版本与许可，不新增框架依赖。原ExpressiveOrb球体可独立渲染，无需另造角色；原产品电脑是分离组件，滚入时仅使用球体。

问候净增4秒，逐字文字与物理回弹，随后连接既有真实首页。A2A回应放大、角色标签跟随对应消息，审批卡先退场再出现回应；校园章节接缝以0.65秒连续空间转场代替硬切。维护范围仅promo原组件编舞与剪辑，未修改业务逻辑。冷启动可见性和媒体id由实际渲染检查纠正，接入结果另见本轮验证。

#### V11 第五版：打字声、K2.5音轨与品牌封面

2026-10-02先检索完整框架 `site:github.com/heygen-com/hyperframes audio beats sound effects`，实际找到 https://github.com/heygen-com/hyperframes 和 https://github.com/heygen-com/hyperframes-launch-video ，读取搜索返回的beats功能资料；再检索 `site:github.com/FFmpeg/FFmpeg attached_pic cover mp4`，该次搜索未取得相关结果。直接访问FFmpeg官网文档失败（连接错误），不视为已读。FFmpeg封面支持以本机实际封装和ffprobe attached_pic结果验证。

部分采用既有框架：本机HyperFrames0.8.36/Apache-2.0与GSAP3.15.0/Standard no charge许可证本轮重新读取；固定提交沿用此前核验的d4756f597c0dbb66310c2add699de6767b23f11b、13e2b790546426a1a2e0e9b409f3f8dc6d6611f2。复用现成beats分析、GSAP时间轴及FFmpeg9.0.1，不升级依赖。本轮没有重新核对上游维护活跃度，已有本地兼容运行证据。现有产品createMechanicalAudio供给打字/点击音色，不另写基础音频引擎；仅稀疏音乐段落补柔和重音。维护成本限于剪辑映射、音轨配置和后期混音，不改产品。

新增桌面原K2.5参考音轨（含原片可能的音效/语音，非纯音乐分轨），保留K3和现有配乐版。三个版本画面不变，打字声读取实际GSAP逐字入场时间，处理复合片段偏移与裁剪；不把录屏中的未知按键假定成已验证事件。音乐按独立节拍映射，不能满足12%以内速度约束的留白段维持原速并明确记录addedAccent。RMS起音检测不等于人工听审，保留listenVerified=false。

封面使用apps/desktop/build/icon-source.svg原矢量；来源记录见ICON-SOURCE.md。只做2560×1440背景排版，不重绘品牌。输出独立PNG并尝试MP4 attached_pic；不同播放器的缩略图行为不保证一致。第五版音视频与封面验证结果见promo/v11/motion-pass/music-variants.json、typing-cues.json、cover-source.json、score-sync.json。旧第四版文件保留。

#### V11 第六版：K2.6/K3空间转场复习与落地

2026-10-02先执行完整框架/应用检索 `site:github.com heygen hyperframes launches kimi k3 promo`，再执行组件生态检索 `site:github.com greensock GSAP transition shared element timeline`。成功命中 https://github.com/heygen-com/hyperframes 、https://github.com/heygen-com/hyperframes-launches/blob/main/k3-promo/index.html 、https://github.com/greensock/GSAP 。GitHub API实际确认launches当前提交d7ac35069d74a3a437780579b3b7fe2f3eeace5f、Apache-2.0、最近push2026-09-26；GSAP当前提交13e2b790546426a1a2e0e9b409f3f8dc6d6611f2、最近push2026-04-13，API的license字段为null，许可证依据已有本地3.15.0包的Standard no charge记录，不把null当作无许可证。

部分采用：延续现有HyperFrames0.8.36/Apache-2.0、GSAP3.15.0及本仓paper-transfer机制，不安装新框架，不改变依赖。框架用于确定性120fps渲染、GSAP用于层次空间/遮罩/时间轴，原组件继续提供Mo和真实界面。参考桌面K2.6约32–36秒、K3约23–27秒的实际抽帧，迁移局部→成果群→新主体的镜头逻辑；Github示例与桌面原片分开记录。无需重写基础动画引擎。来源、事实、推测和验证边界见promo/v11/motion-pass/reference-study.md。

六个转场分别采用横移、成果群推进、折纸/圆形视窗、原信箱折为信封、对话视窗聚焦、上下翻页；保持原功能段与时长，保留已有叮咚投递。背景真实课件只用于相关章节，顶部渐隐保障阅读。维护代价为一个独立编舞构建器、原媒体起止点与音轨重新映射；产品源码不变。render/build旧入口仍保留，第六版需在旧build之后运行bridge-scenes.mjs，避免被旧模板覆盖。


#### V11 第七版：完整动画生态与信息停留复核

2026-10-03。先检索完整框架/发布片，后查转场组件；实际搜索、GitHub SHA、源码/许可证/维护/依赖兼容性与采用理由完整记录于 `promo/v11/motion-pass/reuse-comparison-v7.md`。确认 HyperFrames launches、Remotion、transitions-video、Motion Canvas、Motion 五个真实仓库；所有查询成功。Remotion 自有许可，Motion/Motion Canvas 为 MIT，HyperFrames 示例 Apache-2.0 不包含第三方媒体授权。保持现有固定 HyperFrames/GSAP，部分采用连续空间和动态字形编排，不另迁移引擎或修改真实 UI。新编舞隔离在 promo，正常操作不任意倍速；静止阅读焦点上限 1.5 秒，背景缓动不充当内容推进。原片软件来源未验证，艺术验收不得由编码检查代替。











## 2026-10-03 参赛申报文字重写与源码核对

范围：只写申报材料、复用审计和证据对照，不改产品功能或动画，也不重新安装依赖。长期维护成本是材料随源码、安装包和视频的变化更新；避免继续引用 9 月 13/19 日清单作为当前事实。先搜索完整应用/框架与生态，再查办公和文档组件。

实际完整检索词：`site:github.com deepseek-ai deepseek-harness electron agent`、`site:github.com heygen-com hyperframes motion-canvas remotion video`。随后组件检索词：`site:github.com python-openxml python-docx release`、`site:github.com jsxgraph jsxgraph v1.13.3`、`site:github.com exceljs exceljs 4.4.0`。Web 搜索和 GitHub API 都成功；微信 Word 的本地权限拒绝与 GitHub 检索无关。Harness 的猜测路径 `packages/cli/package.json` 返回 404，这只是该路径不存在，不能称仓库不可访问。

| 候选与实际核对版本 | 已检查事项 | 本轮决定 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc) | 当前 GitHub HEAD `5badb15009ae1756c3afe0ae0cef1faafc290ccc`、2026-10-03 push、未归档，读取 LICENSE 确认 MIT；本项目 runtime-modern 锁 `@deepseek-ai/dsh@0.2.0-rc.2`，不能把主分支当本地版本。实际审批适配器、任务板包内记录和本地配置已读。 | 继续复用既有完整内核，不改接入；申报区分底座与校园扩展。审批委托本轮回归通过，团队为历史实际 App + 固定模型证据，不称全部真实教学评估通过。 |
| [HyperFrames](https://github.com/heygen-com/hyperframes/tree/70dde41b5c836c1a5631e3e6073db1cbeb060ad1) | 当前 HEAD `70dde41b5c836c1a5631e3e6073db1cbeb060ad1`、2026-10-03 push、未归档；读 LICENSE 为 Apache-2.0 和实际 package.json、官方 rendering 指南；本地 promo 锁 0.8.36 + GSAP 3.15.0。 | 继续现有逐帧视频工程，不迁移、不重写基础渲染。主分支文档不能代替本地导出验证；视频来源与代码许可分别披露。 |
| [Motion Canvas](https://github.com/motion-canvas/motion-canvas/tree/7b91435c301d530351dcf5ebb91dd139c002e405) | API HEAD `7b91435c301d530351dcf5ebb91dd139c002e405`、2026-07-02 push、未归档、MIT；既有 10-03 pacing 比较已读，Canvas 节点不直接适配产品 React DOM。 | 不引入：本轮材料工作没有改视频需求，迁移会重做时间轴和素材适配。未接入或本轮试渲染它。 |
| [python-docx](https://github.com/python-openxml/python-docx/tree/v1.2.0) | 实际 bundled Python 3.12、python-docx 1.2.0；读 v1.2.0 LICENSE 和 pyproject，MIT、Python >=3.9，依赖 lxml。Release history 支持核版本，不单凭 README 适配。 | 采用现有 bundled 工具生成两份 DOCX，逐页 render + PNG 核读；不添加仓库依赖。正式模板暂不可读，不能冒称已填原表。 |
| [ExcelJS](https://github.com/exceljs/exceljs/releases/tag/v4.4.0) / [JSXGraph](https://github.com/jsxgraph/jsxgraph/tree/v1.13.3) | 实际本地 ExcelJS 4.4.0 与模型 vendored JSXGraph 1.13.3；既有许可记录为 ExcelJS MIT、JSXGraph MIT/LGPL 双许可。本轮查 release/changelog 并读实际成绩、模型实现。 | 只核现有贡献，不升级。成绩初次缺 tmp 的依赖失败保留，使用 existing modern NODE_PATH 后 5 项回归通过；模型数值验证通过。不据此宣称新版 Windows 与学校设备通过。 |

原创贡献：校园任务组织、教学工具与接口接线、双角色和可纠正记忆、审批/签名/回执语义、品牌交互与证据治理。通用 Harness、Office 生成库和渲染库明确为复用，不归为学生全部从零开发。新材料和源码对照在 `参赛材料/2026-10-03申报修订/`。


#### V11 K2.5 音轨连续性修正（2026-10-03）

检索先覆盖完整应用 Audacity，再查分析/处理组件 librosa 与 FFmpeg。实际词：`site:github.com audacity audacity music editing beats crossfade license`、`site:github.com librosa librosa beat_track tempo`、`site:github.com FFmpeg FFmpeg acrossfade acrossfade nb_samples`。搜索与 GitHub API 均成功。

- https://github.com/audacity/audacity ：8de3891657f6348916a466239b01301d16399747，最近 push 2026-10-02；读取 LICENSE.txt 确认 GPLv3，个别源码不同许可。官方支持文档有拍号网格与交叉淡化；完整桌面编辑器适合手工剪辑，本轮不引入桌面操作依赖。
- https://github.com/librosa/librosa ：b02c5ac37c1e453ae4811bfd383b93525589dae8，最近 push 2026-09-29，ISC；读取 beat.py 的 onset/tempo/dynamic-programming 实现说明与 pyproject。当前 Python 环境没有 librosa/scipy，已有 HyperFrames 节拍证据；不为已有功能新增分析依赖。未声称本地接入验证。
- https://github.com/FFmpeg/FFmpeg ：c9c35450343397c0ed6df2579d532f179dd8a2f3（本轮 API），源码 LICENSE.md 为 LGPL2.1+，可选组件使实际构建适用 GPL；本机 9.0.1，已实际查询 acrossfade、sidechaincompress 参数。复用现有命令行滤镜、保音高 atempo 和音轨封装，不复制基础引擎。CLI 与当前48kHz双声道素材兼容，导出后再验证实际拼接与音效时点。

已确认旧版50段独立变速、49次局部移位，最大11.63%；用户反馈听感错乱。合理推测：频繁变速、重音局部相位混合及不按节拍的2秒循环淡化共同破坏连续性。不能把这个推测当完整人工听审。改为长乐段与主要章节锚点，取消局部攻击音挪动；画面时长保持，音效独立。只在promo增加可重建音频修订，不改产品依赖。

复核确认了更直接的时长错误：旧K2.5 aligned.wav仅296.594秒，目标299.35秒，短2.756秒；第10个片段目标6.704秒而实际6.304秒。sync-scores把源时长作为输出端-t传入，速度小于1的片段被提前截断。改为输入端-t，并在每段及拼接后按48000Hz采样数验收。新版九段长乐段最大变速1.323%，无局部相位挪动；当前音乐底轨与混音均严格299.35秒。

用户进一步明确问题是原片电影式杂音与Mochi画面不对应，故不能只校正节拍。追加检索 `site:github.com audio separator sound effects music separation cinematic`、`site:github.com audiosep text music sound effects separation`，完整应用先比较 Stem Studio、ELUATE，后读TIGER与AudioSep。Stem Studio仓库 https://github.com/wassermanproductions/stem-studio 当前API提交7448d47a942b43ae2fc37ecc8fe0bc731c9e18fc、最近push2026-07-20、Apache2；实际读取engine_tiger.py、separate.py、requirements.txt和NOTICE。采用其现成音乐/对白/音效三分轨CLI、MPS兼容层与校验下载；不自行重写分离网络。其vendored TIGER代码MIT，权重JusperLee/TIGER-DnR为Apache2，固定b7a59560bbca10febbcd46fb01600f868e587f57并验证SHA256。只安装到独立用户缓存环境，Mochi项目不增加ML依赖、不打包模型。保留Sam Wasserman署名。ELUATE面向保留对白/音效去音乐，AudioSep通用文本分离需更大模型，本轮不采用。接入能力以实际MPS推理及分轨检查为准，不以README代替成功。

实际接入完成：GitHub API逐文件下载曾连接中断，改从固定提交codeload下载成功，归档SHA256为536ed4717f9ef4d594acd1779a02bcc1eeb4fa14b36bcd5425b6b5de8e2d9c6a。Python3.12独立环境+torch2.8.0在MPS完成TIGER真实推理，模型两个文件校验通过；三层均为44100Hz、2627655采样，重建原混音最大误差7.45e-8。最终仅采用music层，effects/dialogue层不参与混音；模型串音仍可能存在，未标为人工听审通过。重混音轨严格299.35秒，九个主要节点附近低鼓起音偏移0–40ms，峰值0.5224，无半秒以上低于-55dB的静音。复用接口已通过本轮所需功能验证；音乐分离环境不进入产品依赖或参赛源码包。

## 2026-10-03 参赛源码解释附件补充

延续本文件“参赛申报文字重写与源码核对”的真实 GitHub 检索、许可及版本记录，本次只增加源码解释和审阅快照，不改产品代码、依赖、配置或动画。继续采用已有 Harness、办公库及 HyperFrames 工程，不重写基础能力。维护成本主要是代码变化后的引用行号和摘要更新，故每个快照与摘录记录 SHA-256。

附件位于 `参赛材料/2026-10-03申报修订/`：23 个解释专题、30 段原文、46 个源码与测试快照。重新运行 12 个实际验证入口并保留日志；明确夹具、真实本机回环链、数学检查与未验证设备的边界。用户已确认正式 Word 以原模板为准只换文字，原模板权限仍拒绝读取，未另套版式。精选源码包不冒充完整发布源码包。


## 2026-10-04 · V11 第八版：产品定位、品牌配色与 Logo

先检索完整应用/发布片：`site:github.com heygen-com hyperframes launches`、`site:github.com remotion-dev template promotional video`，再查组件 `site:github.com gsap timeline background color transition`。GitHub搜索/API成功；raw下载部分SSL失败，HyperFrames源码重试成功，GSAP LICENSE文件仍失败，不能称无现成方案。

- https://github.com/heygen-com/hyperframes-launches ，HEAD d7ac35069d74a3a437780579b3b7fe2f3eeace5f。读取Apache2 LICENSE和k3-promo/index.html，独立场景、GSAP时间轴、字体层和多尺度品牌入场。部分采用既有完整管线和连续空间方法，不复制第三方品牌媒体。实际渲染仍固定本地HyperFrames0.8.36，未追踪升级。
- https://github.com/remotion-dev/remotion ，HEAD e385a83dbde54179c0457ad90b7d7c3a4b6ab44a。读取实际LICENSE.md与transitions/slide.tsx；自有分级许可，非MIT。现有入退双层用同一进度并补边缘epsilon。参考前后场并存，未引入React视频新管线：迁移会增加组件、媒体时钟和音轨适配维护。
- https://github.com/greensock/GSAP ，HEAD 13e2b790546426a1a2e0e9b409f3f8dc6d6611f2。package.json确认3.15.0及Standard no-charge许可链接，远程LICENSE获取失败；沿用本项目已审计固定版本，未新增包。采用现有timeline绝对时钟、transform与背景层动画；用确定时点和真实导出验证。

桌面K3原片重新按3秒抽帧通览，12–17秒按0.5秒看品牌入场。可确认：成果场景缩回周边纸张空间，中部品牌进入；不是仅更换相同卡片。原片未证明制作软件。GitHub16秒示例与桌面56.704秒原片不是同一视频。

实际四款配色来自client-plugins/jxl-theme/assets/mochi-palettes.json，team-palette与team-conversation-palette确认也用于成员/会话配色。影片仅将这些品牌颜色用作舞台背景，不重绘或改色真实产品UI。logo取apps/desktop/build/icon-source.svg，不另画。开场8秒替代旧5秒问候+前3秒重复首页，随后保留opening从4秒开始的原操作，整个首章仍22秒。后续功能时间轴不变，避免全片音乐重排；新的字形声需按实际入场重建。

长期维护：新增独立brand-v8可重建层，复用第七版源镜头及实际素材；产品源码与依赖不变。只修改后期舞台色彩、定位文案及品牌露出。渲染、字体/边界/解码验证与人工审美验收分开。


用户追加角色要求后，补查 `site:github.com jperret bloub animation thinking orbit`，定位实际上游 https://github.com/jeremy-prt/bloub 。API确认HEAD仍b4bb3c1b5f93c7b87a2e8d620f667c4093d97749；本地SOURCE.json锁0.1.1/MIT并逐文件哈希。实际读取engine、states、createPainter：thinking是球体变成中点、再分出两侧点，notify/comet/orbit/burst/swirl均为已有状态。采用产品已集成引擎与皮肤的确定性采样，不重写三点或形变算法、不改产品。新影片为每个主题使用原主题Mo；转场按思考、完成、探索、投递、查询、记忆分配动作，结尾原Logo左上、Mo居中回应。公开MIT仅覆盖代码，不冒称外部视觉设计原创。

验证完成：第八版299.35秒、2560×1440/120fps、35922帧；38个章节与28个转场预览无字体/媒体/脚本加载问题，866个角色采样可见几何有限且乱序seek一致。全片编码扫描发现叫人段1.73秒近静止后，补上通知到回执的镜头引导，鼠标随同一相机坐标移动；复扫无超过1.5秒近静止或黑帧。两音轨版本视频码流相同、完整解码通过，K2.5仍仅使用分离的音乐层。人工审美及完整听审未据此标为通过。局部修复同时处理同色角色轮廓与角色与Logo遮挡点。

## 2026-10-04 · 本机现代版安装器发布

先检索完整应用和框架生态，实际检索词：`site:github.com deepseek-ai deepseek-harness apps desktop electron package`、`site:github.com electron forge electron-builder release packaging`。检索成功。查看官方完整桌面工程 https://github.com/deepseek-ai/deepseek-harness （master `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，MIT；本项目仍固定 0.2.0-rc.2），以及 https://github.com/electron/forge （main `35ccad9aa0bfa9db07297facd1845ce43e4538b9`，MIT）。随后核对打包工具 https://github.com/electron-userland/electron-builder ：本地安装 25.1.8，包内许可 MIT，仓库 2026-10-03 仍有提交；请求 `v25.1.8` Git 引用返回 404，不能将此引用当成已核实标签。官方完整桌面已经提供内嵌运行时及固定依赖的打包思路；Forge 提供 package/make/publish 生命周期；electron-builder 提供现有项目使用的 DMG、NSIS 和两级 package.json 打包。

采用本项目现有 electron-builder 25.1.8 及原生目标构建流程，不迁移 Forge，不升级到当前主线新大版本。当前壳开发依赖 Electron 39.8.10，现代出包脚本显式指定 Electron 44.0.0，Harness 固定 0.2.0-rc.2；需以最终包内版本与原生探针、双角色启动验证兼容。复用现代资源白名单、校园静态输入清单、原生 ABI 探针、现有私有 Windows 快照 CI。长期成本以稳定锁文件和共享构建输入为主，避免维护第二条打包链。公开包使用 --without-key-seeds，读取运行资源而不复制用户数据。实际构建与测试结果记录到 output/release-20261004；此处不提前宣称验收通过。

## 2026-10-04 · 0.2.0 发布前包装闭包核验

完整生态检索`site:github.com/electron-userland/electron-builder releases GitHub publish`，再`site:github.com/cli/cli gh release create upload latest`；继续采用既有builder25.1.8/MIT和CLI2.98.0/MIT，不另写发布器。已纠正固定标签：electron-builder@25.1.8 annotated对象4e51e4cc…对应commit1d61d6f59061be23d5cd8602a65e8ce10861ccc0；本机publish25.1.7源码同名覆盖会删除旧asset，故用户要求保留旧包时禁止overwrite/clobber，使用新v0.2.0。实际公开仓库仅v0.1.0，0.2.0已由前线程升版但未发布；仓库/latest地址不变。本轮无远端写入。

实际0.2.0包profile导入失败，RUN_AS_NODE精确复现greeting-policy.mjs漏白名单。补唯一文件并强化smoke拒绝failed-to-import；真实生产白名单物理拷贝+Electron44动态import、缺文件复现/修复及原profile祝福合计21 PASS。保留旧0.2.0目录和DMG，先只目录构建；长期Key服务端保护未完成前不公开含Key包。精确研究/故障/验证边界见[package-closure-notes.md](evidence/release-20261004/package-closure-notes.md)。

## 2026-10-04 · 0.2.0 公开发布续办

重新读取本文件及 package-closure-notes 后核对实际远端：公开 Mochi 仅 v0.1.0，含 Mac arm64 与 Windows x64 两个安装器；旧资产 ID 与 digest 已保存在 output/release-20261004/public-release-audit/previous-release.json。实际搜索先完整应用 `site:github.com/CherryHQ/cherry-studio electron-builder release github workflow`，再组件 `site:github.com/electron-userland/electron-builder github releases publish existing releases`，搜索成功；参看 https://github.com/CherryHQ/cherry-studio/blob/main/.github/workflows/release.yml 和 https://github.com/electron-userland/electron-builder/blob/master/website/docs/github-actions.md 。分支网页只作机制参考，固定版本/许可沿用上节已核 electron-builder25.1.8/MIT/1d61d6f59061be23d5cd8602a65e8ce10861ccc0 与 CLI2.98.0/MIT；不移植整套应用工作流。继续采用已有 Mac 原生构建、私有 Windows 精确快照与新 tag release；公开候选启用现有 --without-key-seeds，Windows 构建和安装后均验证只有非密钥设置种子。长期维护保持一条打包链和锁定依赖，旧 release/asset 不覆盖。最终构建、哈希与上传结果另记，当前尚未发布。


## 2026-10-04 · Mochi 十五分钟答辩 PPT

检索先覆盖完整应用与插件生态，再比较 PPTX 生成组件。实际搜索词：`site:github.com slidevjs slidev presentation export powerpoint`、`site:github.com marp-team marp-cli pptx editable`、`site:github.com gitbrent PptxGenJS`。GitHub 搜索与 API 均成功，无权限失败；有成熟方案，未表述为“没有现成方案”。

| 仓库 | 本轮核对 | 功能与取舍 |
|---|---|---|
| https://github.com/slidevjs/slidev | 53.0.0 / 73053ab2b9653ed475960301b56e1ce4439d9c75，2026-10-02，MIT，未归档，Node >=22.12.0 | 主题生态、演讲者模式、PPTX/PDF 导出。核对 package.json、LICENSE 与 cli 文档；本次仅交付离线可编辑 PPTX，不接入新的 Vue/Vite/浏览器工程。 |
| https://github.com/marp-team/marp-cli | 4.5.1 / ffc4128626cbc64965fe1cc805717c6d4438c384，2026-09-08，MIT，未归档，Node >=18 | Markdown、PDF、PPTX 与 Bespoke 演讲者模式。标准 PPTX 为图像，editable 仍实验且依赖 LibreOffice；已核许可证、依赖及官方导出讨论，不采用为主交付。 |
| https://github.com/gitbrent/PptxGenJS | 4.0.1 / 3c9ec1b687c174952166f6a34b5e87ebf69fa469，2025-06-26，MIT，未归档 | 原生文本、表格、图表、备注，项目已有旧答辩工程。复用既有品牌和素材及布局经验，按 presentations 技能使用内置 @oai/artifact-tool 生成本次文件，不混用两套作者模型。 |

维护影响：新增独立答辩目录，不覆盖四分钟版，不修改产品代码或依赖锁。主讲预计15分钟，问答备用页另算。素材优先取现有品牌、隔离演示与真实成果，逐页备注保留来源和证据范围。正式手册与时长冲突待确认，不补造评分权重。导出后核验可编辑文字、备注、包完整性、页数、版面和逐页渲染。

本轮资料补核：《作品附件要求.docx》word/media/image1.png 与 image2.png 已直接检查。高中组权重为思想性20%、实用性与创新性25%、技术应用能力25%、规范性与艺术性10%、展示与答辩表现20%。编程应用类要求可运行文件（网址）、3—5分钟演示视频、说明文档，高中组补核心代码片段及算法说明。该文档是用户保存的要求摘录，完整正式手册尚未找到；不据此确认15分钟为官方时长。最新作品说明采用2026-10-04文字修订版，团队旧学习手册的人名与分工优先服从最新推荐表。

0.2.0 续办实际验证：根 `npm run check` 在已安装的现代依赖闭包 `NODE_PATH=apps/desktop/runtime-modern/node_modules` 下退出 0，合计 173 项通过；本机旧 pnpm ExcelJS 缺 tmp，未以此改变生产依赖。文档测试改用根锁文件安装的 docx/pdf-lib，去掉本机专用 node_modules.nosync 路径；原生安装器测试改为按 package.json 版本校验文件名；主进程 escape 局部名改 escapeHtml 以通过 lint。新版 Mac DMG 336647671 B，SHA256 b5d60275d8909ed80754a74a3de3c4e516c35cc52ad7d68c0be94924f54c51b7；hdiutil VALID、挂载 asar/资源清单与受测 App 相同、只有 settings-defaults 种子，从镜像复制后的双角色 smoke 均 exit0 且无插件导入失败。当前新增包装/祝语回归为 16 项通过（此前记录的21项是不同组合，不能混算）。Windows 首轮37167767671因测试写死0.1.0失败，修复后提交a4d1a3bc7d935746245bd924c1ec4cb78fd2cff2触发37168260190，结果待验。

十五分钟PPT交付补记：独立输出位于`参赛PPT/Mochi十五分钟答辩/output/`。20页主讲计时900秒，4页问答备用；文字、5张表格与24页演讲者备注保留PPTX原生结构。导出后实际检查全24页渲染，修正截图展示区域与断行；最终包结构、几何与重新导入检查通过，PDF预览来自同一最终PPTX。未宣称目标Windows/WPS或PowerPoint实机验收，STHeiti字体替代与播放须在比赛电脑核对。10月3日测试数字作为明确注明日期的历史证据，后续发布测试不自动混算。完整正式手册和现场时长仍未确认，本版本以用户约15分钟要求编排，不将独立完整影片计入主讲。

0.2.0 发布续办：Mac 镜像复制安装后的真实 App 界面自动化45项通过，errors/gaps均为空；包括两角色实际Host子进程、preload桥、称呼保存重载、教师预设、记忆、课堂助手、课表、设置及自动化入口。旧测试里的预设名称和已移除的工作/对话门控按当前产品更新，未改产品样式或内容。Windows 第二轮37168260190停在另一个写死0.1.0的release-input断言；改为读取package.json，新快照810文件/95011221B零漂移，提交96f412157b927bda5a82f97c659890e2425389a6触发37168955975。Git HTTP/1.1配合扩大postBuffer后公开main已同步6df4d7e；旧release未修改。
