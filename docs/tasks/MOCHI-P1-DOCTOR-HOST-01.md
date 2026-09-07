# MOCHI-P1-DOCTOR-HOST-01

P1，Halley / terra-max唯一owner plugins/mochi-hello/index.mjs、新doctor.mjs、必要package文件白名单和测试。执行前只读核基线，保留他人变更；不写main/doctor/profile/desktop锁/原node_modules。先外部固定alpha运行树验证，再0冲突提升票内文件。

目标：医生通过已有认证会话调用固定的模型检查，把真实凭据解析留在live DSH宿主。总体方案§22/23；SESSION-PROBE01 root独立真实Electron PASS提供主进程session.fetch机制，尚不是模型调用通过。

主控选定复用边界：固定d347的Connection除了Typert还公开connection.fetch.register。root亲读file-upload/src/index.ts:73复用精确POST路由，connection/index.ts:114–128在shared /api dispatch之前统一requestRejection验证Host/Origin+BrowserAuth。采用此已有精确Fetch注册而非再生成Remote codec或新建HTTP服务器。路径固定 `/api/mochi-doctor/check-model`，POST，无调用者可选provider/model/key/baseURL/prompt，不接任意工具调用。不改上游认证、不在旁路注册webServer免认证路由；现有mochi-hello已挂载，扩展为启动诊断宿主入口，保留原apply行为。

模型范围明确：检查现有内置 `mochi-mimo` route，从live ctx.llm.listModels取得当前该route的第一个可用模型，用ctx.llm.stream真实固定短合成用户消息、maxTokens:1、禁工具、受控reasoning（按实际公共契约）；既有adapter负责live credentials与env fallback。provider未注册/无模型/缺凭据为unavailable；真实401/账户/上游错误按有限固定code映射，不把异常message、生成文本、URL、key或credential ref回传。返回限定schema（版本、scope固定mochi-mimo、两项model-service/credentials的status/code/duration），绝不宣称所有自定义provider都通过。不要直接读.credentials.yaml/另建secret watcher/新HTTP provider。

执行总预算不超过医生5秒（宿主建议4.5秒），请求取消传至stream；同一宿主只允许一个实际检查在途，清理finally，不无限重试。读取输入应拒绝非预期payload，不支持调用方增加字段扩大功能；沿用Connection已有body限制，固定检查不是通用RPC。

验收：用实际alpha Context/LlmRuntime+现有MiMo适配器及synthetic loopback provider，覆盖成功、缺凭据不出网、错误凭据、上游异常、超时/取消、清理、无泄漏。通过真实Connection注册与既有认证边界的POST请求验证，未认证拒绝；不是手写近似router/直接函数返回冒充整链。不调用真实模型/校园/学生资料或读取用户HOME。已有SESSION-PROBE五case不重复全套，验证新POST/真实route和模型链。模块零新运行依赖为优先；若确需依赖先给具体理由。

交付短证据+fixture路径/hash+最小diff，root独立核后才派主进程Doctor接线与tgz更新。无需长报告，不把宿主模块完成称整个医生/P1完成。
