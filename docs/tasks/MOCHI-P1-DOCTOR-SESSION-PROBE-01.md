# MOCHI-P1-DOCTOR-SESSION-PROBE-01

P1，Halley / terra-max；PDF01提升收尾后执行。仅外部独立fixture，无生产修改。目标是核医生主进程能否复用现有Electron session与固定alpha API认证，避免传出raw模型key/cookie/token或修改用户SPA。

已核固定alpha d347：api-request-trust.ts允许无Origin、拒绝Origin:null/跨站、始终检查Host；browser-auth验证会话cookie。主窗口先加载ready URL建立认证，doctor是data页面不可直接调用该API。候选是主进程用同一webContents.session.fetch固定loopback ready origin下固定API；session自动处理cookie，不读取值也不交renderer。官方Electron39.8.10/MIT与完整生态复用见UI01、docs/reuse-audit；先核固定API类型/实现再fixture，不凭latest文档称适配。

允许：外部临时fixture/证据，不改生产main/web-host/profile/插件/锁/NMs，不访问真实HOME/密钥/校园/模型端点。你不是独自工作，Lagrange正在生命周期、Maxwell正在profile默认模块，勿覆盖。

验收：真实Electron39.8.10，同一session通过loopback导航建立synthetic cookie，主进程session.fetch实际到达固定alpha既有Host/Origin/认证边界；优先直接复用固定模块或真实隔离host，不仅手写近似认证。测试无认证拒绝、正常认证成功、opaque/cross-origin拒绝、请求取消和清理；记录Host/Origin/是否带cookie布尔，不输出cookie值。不得将凭据交doctor data页面。若不可行交具体原因，不放宽上游fence或增加免认证旁路。输出简短结论/fixture路径/hash/真实命令即可，无需长报告或完整模型桥实现。
