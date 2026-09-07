# MOCHI-P1-DOCTOR-CLIENT-01

P1，待宿主接口固定后派发 terra-max 实现。目标对应总体方案§22/23：已有医生窗口两项模型检查通过 live DSH 内置 mochi-mimo 路由验证，凭据不离开宿主。用户 UI 不修改。root 只负责任务与独立验收。

复用来源：docs/reuse-audit.md 已记录完整 Electron/Harness 生态与固定 Electron39.8.10/MIT、Harness d347/MIT。SESSION-PROBE01 实际同一 session 的 session.fetch 已通过认证/取消，HOST01 使用 Connection.fetch.register 和统一 requestRejection。采用现成会话请求，不新造 HTTP 服务、cookie/token 搬运或凭据存储。

模块阶段允许新 electron/dsh/doctor-host-client.ts、doctor.ts、doctor-window.ts 的最小配置薄桥及专用测试；main.ts 当前归托盘任务，暂不修改。desktop/package/lock/profile/renderer/preload/sidebar/host插件/原 NMs 禁止修改。实现者不是独自修改仓库，不回退他人变更。

接口要求：客户端只接主进程已就绪 host 的当前 origin 与承载官方 SPA 的 Electron session；目标固定 POST /api/mochi-doctor/check-model，无 URL query/token、credentials include、固定空 JSON；禁止跟随重定向、返回体有小上限并严格版本/scope/两项 status/code/duration 白名单校验。未就绪/未认证/接口不存在/异常响应必须明确未检测或注意，不拿 HTML/任意2xx当成功。所有异常转固定提示，不转发错误消息或响应文本。最终精确响应 schema 以 HOST01 固定交付为准。

DoctorConfig 可增加内部宿主探测回调，传 AbortSignal，在一次 runDoctor 内只发一个请求并把两个结果映射成既有 model-service 与 credentials；不得为两个 check 发两次收费模型请求，不额外串联5秒预算。调用缓存只在本次诊断内，重跑必须拿当前宿主，避免缓存凭据变更或旧 ready URL。整个诊断仍在现有5秒预算内，关闭/退出取消传至网络与宿主，及时解除监听/计时器。保留既有显式 probe 测试入口兼容，生产不传密钥。

显示和脱敏报告明确写“内置 MiMo”范围，不能声称所有自定义模型密钥有效。只有宿主固定白名单字段进入中文映射，不把远程可控文本写入导出报告。遵循现有11项顺序与总体状态计算。

验收：真实 Electron session 请求新 POST，结合 HOST01 实际 alpha 认证链验证成功、未认证、一次运行仅一次模型请求、重新运行可探测新状态、超时/关闭取消、无密钥/URL/raw error 泄漏；保留现有 Doctor 核心/窗口相关回归，不做全包和真实远程模型调用。主进程接线由 main owner 后续独立顺序阶段完成，并在最终整包时重新更新 mochi-hello 内容哈希 tgz 与标准锁。本票模块完成不等于整个医生或最终 App 已更新。
