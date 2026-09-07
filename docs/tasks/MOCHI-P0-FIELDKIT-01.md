# MOCHI-P0-FIELDKIT-01 · Win10现场取证准备

阶段P0；已验收/PASS（仅取证工具准备与静态审阅，现场仍未执行）；执行者p0_cold_start/terra-max。对应方案§45教室机型/网络前提。用户确认Win10、无还原卡，RAM可能10GB但忘记；必须保留用户确认与机器实测的区别。

目标：提供可在教室手动运行的只读脚本，收集必要硬件和两个既定API端点的无凭据可达性，写本地JSON供审阅。不安装软件、不改系统/代理/证书/防火墙/执行策略，不自动上传，不调用模型推理。无实际Windows时明确未运行。

复用先读docs/reuse-audit.md FIELDKIT01：Win10自带PowerShell5.1/CIM/HTTP，无新依赖。允许新增scripts/collect-classroom-preflight.ps1、docs/classroom-preflight.md及artifacts/architect-audit/fieldkit/证据。禁止改其他源码/配置/lock/用户home/联动计划，不涉及P1自动医生产品功能；不是唯一工作者，勿覆盖他人。

接口：输出明确schemaVersion、时间、实际OS版本/架构、厂家型号、CPU逻辑核、安装内存bytes与OS可见内存KiB区分；无需用户名、电脑名、序列号、IP/MAC、wifi名称、账号或文件扫描。可记录音频设备是否枚举到，不把声卡存在当麦克风已可录音。还原卡状态保持manual-confirmation-needed（用户报告另记文档）。

只对https://mimo.ezlook.top/v1/models与https://jyl-campus-health-entry.pages.dev/api/auth/me做无auth GET，记录状态/耗时/错误类别，正文/响应cookie/headers不写报告；拒绝跟随登录重定向或至少明确重定向为未确认，不把任意200门户算API通过。请求超时有限，单次不自动重试；401/403解释可达但未认证，DNS/TLS/timeout区分可判定部分，不编造原因。失败一项不吞整份硬件结果，脚本最终明确有未确认项。输出路径可指定且拒绝覆盖已有文件或默认时间戳，UTF8可读。

验收：静态审安全边界/PowerShell5.1语法，当前若已有pwsh可做Parser检查但不得为此全局安装；若没有就标记未执行，不用Mac模拟Windows事实。文档给无需管理员的运行步骤及结果解释，不建议永久放宽系统执行策略；提醒在实际教室网络运行，返回脱敏JSON即可（不外发自动发送）。交付真实检查命令与未测范围，主控审后留待现场，不能标现场PASS。

2026-09-07主控源码审计：首版SHA6c594ae…f6b4需修。前置Test-Path后先做网络采集再WriteAllText，同名文件在间隔内出现会被覆盖，不符合约定，最终写需CreateNew。403只能确认HTTP拒绝，不能归因为缺认证。文档应仅复制ps1/说明到教室独立文件夹，不能让用户搬整个开发仓库；去除预设IT审批制度的说明，执行策略若真阻塞则记录事实。输出目标限本地。无PowerShell环境，首版只有静态检查，没有Parser或Win10实测。

返修复审：主控读完整脚本及修改后的目标路径/最终写入/403/文档段落，已使用FileMode.CreateNew，拒绝UNC/Network drive；401/403分类分离，仅复制ps1的步骤正确。主控另亲算SHA16ad69c35c714ca80654777e4c0af61c7e41c560dc4e2a3b9708172143327c6a，文档hash引用一致；固定端点恰为两项，旧WriteAllText不再存在。无PowerShell Parser/Win10/网络实测，不能把本工具准备PASS当作P0现场条件通过。
