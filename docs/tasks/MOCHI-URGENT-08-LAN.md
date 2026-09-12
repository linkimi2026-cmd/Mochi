# URGENT-08 · 教师—教室 LAN 协作

状态：主控已读总体方案§2/3/8/27/31–37和总纲全文；用户本轮明确恢复LAN并指定教室一体机收件。执行者待PPT/切换任务顺序释放，不启动冲突写入。root审核，terra-max实现。基线以当前工作树为准，保留e568c16之后各线改动。

目标：教师端与独立身份/独立数据根的教室端，校园局域网优先，完成发现→人工相识→精确发送→教室弹窗→人工已看到→教师回执。校园云与relay仅为现有跨网备用，不能成为同LAN硬依赖。不是同账号远程控制，不把dsh Web 3090开放到LAN。

## 复用与最小技术校正

root已实际检索完整LocalSend/PairDrop与官方A2A框架，再核消息发现/配对/认证；固定来源写docs/reuse-audit。保留方案Node内置 dgram/http/crypto 与现有dispatch。LocalSend Flutter整应用、PairDrop信令/WebRTC栈不移植；A2A SDK另带服务/任务抽象，不为LAN重建Mochi任务系统，不宣称自有wire是完整标准A2A实现。

1. endpointId不是认证。Node内置Ed25519生成设备密钥，首次在两端人工核对绑定指纹、学校/班级/名称与endpointId，互存公钥；私钥留各自数据根，不进模型/信标/日志。
2. 超时不能证明未投递。沿用dispatch UNKNOWN与固定idempotency key；接收方持久化后ACK，相同消息重复返回同ACK，不再弹第二次。不得UNKNOWN后换新ID或自动切relay造成重发。

## 写入边界与职责

传输实现owner：新的 plugins/mochi-lan（独立服务与自测）、plugins/mochi-dispatch 的最小transport接入及测试。禁止改desktop/main/profile/锁总表、其他插件、用户原NMs与联动计划源码。共享底座需接口协调，root不给实现者逐行算法。

UI owner另票：client-plugins/mochi-lan（若需要独立设置/收件视图），或已持有mochi-workbench的执行者顺序接入。desktop owner只负责身份启动入口/受管root、原生弹窗桥/打包/防火墙，不新造传输服务。

## 服务接口和身份不变量

LAN插件向宿主提供唯一mochiLan服务：状态快照/订阅、配置设备身份、发现/手动地址、申请/接受/拒绝相识、解除/拉黑、发送/收件/确认已看到、文件传输。先冻结具体接口给UI/desktop owner，再同时接入。对本机设置与发件的HTTP入口复用Connection已有认证精确Fetch route；对LAN的HTTP服务独立端口47832，冲突有界顺延并更新信标。

身份至少包含endpointId、role(teacher/classroom)、schoolId、classId(classroom必需)、displayName和公钥指纹。只由明确设置/人工配对绑定，禁止从模型消息文字/机器名推断。发送用已配对稳定endpointId，展示确认学校+班级+设备；同名候选不自动选择。签名覆盖收发endpointId、学校/目标班级、消息ID/幂等键及正文，收件与回执核对所有绑定。更换身份/学校/班级必须使旧配对失效，不能用旧授权静默改班。私密教师数据不会同步到教室；教室使用独立role/data root。

UDP IPv4广播5秒、TTL15秒、组播备选、手动IP入口明显；mDNS不引Bonjour外部依赖。信标只提供有界发现信息，不是信任依据，不广播账号/学生/密钥；陌生请求只能进入有限/限频的相识待确认，不能投递工作或通知。

## 分阶段实现与验收（均属交付，不以A完成冒充全部）

A：身份/发现/人工配对/消息/回执/治理/dispatch融合。消息≤64KiB，签名验证后才落库；目标错endpoint/学校/班级、公钥不符、陌生、已解除/拉黑均拒绝。NOTIFY为现有ASK/REQUEST的通知内容类型，不新造任务状态机。教室提醒显示已验证来源和目标班级，文本安全呈现，不执行HTML/命令；可人工“已看到”，收到ACK只代表投递，不能伪装人已看到。

真实双进程、独立临时HOME测试正常、重复/ack丢失、重启后去重、错账号/错班/冒用ID、解除/拉黑、离线再连；UI弹窗与人工回执由非实现者独立验收。模型自主发送仍复用既有审批，学生功能面不允许任意外发/改配对/设置。不会因模型自称老师而放权。

B：方案文件通道：PPTX/DOCX/XLSX/PDF/图片等白名单，默认100MB、接收目录配额、分块/中断续传与最终SHA256，临时文件完成验证后原子入库，不路径穿越/覆盖，不自动执行。消息引用已验fileId且接收者绑定一致。用真实PPTX传输后字节hash验证，取消/断连清理与重复消息语义保持。

设置/弹窗/安装包整合后验证Mac教师→Windows教室路径；本机双进程不是校园真实网络与Windows实机证据。没有设备/网络/远端权限如实标缺口，不改通过定义。阶段性结果简短记录hash/命令/产物，不跑不相关全库。
# 2026-09-09 主控接线决定

真实Electron课堂会话探针进一步确认：仅将preset限制为classroom仍暴露39项全局教师/校园工具，因此该中间候选不通过。root授权desktop owner在同一runtime-profile源按role筛选宿主plugins/links：classroom只保留必要web/问答适配器、LAN收件/客户端、纯品牌客户端与受限classroom preset；排除dispatch/campus/jxl数据工具、grades/memory/modeling/PPT/任意文件与shell。后续知识库可单独加入只读工具。测试必须检查实际schemas，不以菜单隐藏或空preset替代权限控制；教师完整preset与原功能继续回归。当前是已定位并派修，尚无修复后的最终包PASS。

消息/发现阶段 root 独立 Node22 运行 mochi-lan 与 mochi-dispatch 全部当前测试 exit0，含双进程 loopback UDP、接收端本地 TTL、时钟偏差、发现降级保留 HTTP、持久化失败/重试、重复去重、已看到回执及角色锁。并非校园广播、Windows机器或最终Electron包验收；文件通道和mochi_tasks融合仍在后续实现。

角色唯一来源：Electron main 首次启动先用原生选框确定教师办公电脑/教室一体机，保存无密钥的本机启动元数据，随后固定角色启动。main向prepare/provision显式传role，受管runtime-profile生成mochi-lan.lockedRole；浏览器identity JSON不能改变角色。教师保留既有home兼容，教室全新独立home，不复制教师凭据/记忆。课堂工具权限按总体方案白名单，不能只换home仍给学生教师完整shell/preset。桌面owner负责实现与同root角色冲突验证。本段是待实施接线决定，不是完成证明。

## 本轮续审与接线（2026-09-09）

root 已独立复跑真实 Electron ABI140 课堂运行探针，证据 `artifacts/architect-audit/classroom-role-preflight/root-independent-20260909/result.json`。实际 agent 存在、选择 classroom、工具为空、lockedRole=classroom，MiMo 两模型目录保留；权限收敛通过，尚不等于课堂全部功能或安装包通过。后续加入教材只读工具必须重验实际工具集。

Halley 接管冻结的 LAN client 自动提醒增量，Lagrange 继续知识库，避免同文件双写。新增未读消息与配对请求自动打开现成 overlay，启动快照已有未读亦提醒一次，按 ID 去重；不能自动确认配对或代替人点击“已看到”。原生提醒采用专用有限 preload：仅接受 incoming-message / pairing-request，不传正文、角色、URL或命令；main 核当前主窗口、主 frame 与精确 harnessOrigin，只恢复/显示窗口及固定系统通知，并节流。通知点击只聚焦。实现及独立 Electron 实测仍待完成。

root 只读发现文件融合候选尚有两项待修：审批等待期间重新配对可能令旧确认使用新设备绑定；文件恢复目前保存旧 peer 却只按 endpointId 取新配对，必须锁定学校/班级/指纹并验证附件引用。另 FILE_SOURCE_CHANGED 可在传输中抛出、FILE_ID_CONFLICT 可由远端返回，不应仅按错误码称为本机发送前失败。已派 Maxwell 修复和竞态/中断测试；未把正在修改的文件通道计为验收通过。

后续候选独立复审：root 在 Node22 分别运行 mochi-lan / mochi-dispatch 的 npm test，session31982/63560 均exit0。真实PPTX分块hash、续传/取消/配额、审批期间身份变更、旧附件/恢复指纹绑定、传输阶段失败分类、无校园账号的local owner隔离及seen回执投影均有对应断言。root已读实际绑定检查和回执投影，同意Halley集成此冻结候选，Maxwell先接中文搜索。

尚未最终放行的已知范围：校园落盘会话首次恢复仍可能在 binding 内等约10秒，2秒预算仅覆盖已激活后的relay同步；ACK丢失后迟到signed seen的UNKNOWN任务尚未恢复（当前回执投影要求ACKNOWLEDGED且任务DELIVERED/COMPLETED）。后者已排Maxwell搜索之后定点补实链测试。教室原生弹窗、最终安装包和学校Win10网络仍待验收。

提醒后续独立验证：root 在外部集成树运行 LAN client 单测8/8通过，classroom `test-startup-runtime.mjs` session31924 exit0，真实Electron隐藏窗口被当前主frame的有限attention桥恢复可见；同时无自动seen/accept。证据只支持窗口恢复，不声称未签名Mac系统通知横幅或Windows实机通过。root另派Halley最小修正发现DEGRADED状态投影，避免UDP失效而footer仍写“正在发现”。最终包验收继续。

ACK迟到回执补验：root读取syncLanSeenReceipts和新增真实链测试后，独立Node22运行 `plugins/mochi-dispatch/test-lan-receipt-recovery.mjs` exit0（node5788）。同消息/完整设备身份的签名seen可将活跃UNKNOWN恢复为DELIVERED，纯通知再转COMPLETED；保留ACK丢失历史字段，不重发。允许集成当前dispatch index eea574ba5bc7e…；最终LAN→Electron真实弹窗整链另由Maxwell隔离验证，学校实机仍待测。

完整课堂UI联调发现实际启动缺陷（CHANGES REQUIRED）：Maxwell隔离Electron诊断证实preload attention存在、LAN client资源已请求，但页面显示mochi-workbench pending waiting for service betterSidebar。root核源码client.js:1241将betterSidebar设必需，而课堂白名单不含provider；因此不能仅归旧staging或conversation补丁。授权Maxwell在workbench client/test使用固定Cordis可选/延迟依赖，保留teacher sidebar功能且不放宽课堂工具。证据 `/private/tmp/mochi-lan-electron-golden-20260909-01/evidence/diagnostic-client-mount-01/result.json`。之前工具权限/窗口桥PASS不等于完整课堂UI可启动。

视觉验收CHANGES REQUIRED：root亲自查看 golden-path-04/01-unread-overlay.png（800x600），真实新消息触发后首屏仅身份/配对设置，通知正文和“已看到”在视口下方。因此“有overlay DOM”不能证明喊人通知可见；不能靠fixture主动滚动掩盖用户体验。授权Maxwell接LAN client/test唯一写入权，在新未读触发时直接显示/定位通知正文及操作，保留手动设置、去重与人工seen；Halley仅同步最终源。验收要求自动弹出后首屏正文/操作可见，并真实指针点击完成回执。

身份变更历史收件复审CHANGES REQUIRED：root读configureIdentity确认改身份仅清配对、不清inbox；新通知卡若用当前identity.classId会错标旧班通知。root此前提出该展示字段不充分，现纠正为原收件recipient绑定。markSeen亦只按旧from.endpointId取当前peer，在写seen前缺少原收发完整身份核对。已授权Maxwell在LAN service/client固定原recipient/原sender语义，保留历史但不猜新班、不让改班或同endpoint换key重新配对后确认旧通知；新增真实双服务回归。当前正常链结果不能证明这个身份切换场景。

历史收件绑定修复root独立复审通过：host SHA b5f129609791aa5d4ccf792e038db76ce104494e900692f8956199a762f1225a / client SHA 0af03c27a89223095fadab677bd96ba23c9c8cccb4d10ddfceec0b95fc2f5fb0。亲读收件原recipient持久化、markSeen写前完整双身份校验与客户端历史过滤；Node22 test-durable.mjs真实双服务正常/改班/重配换钥/legacy等场景exit0，client test10/10通过。授权Halley净包集成；Maxwell复跑真实Electron正常通知物理点击链，不能沿用旧UI PASS。
