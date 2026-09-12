# LOCAL-VISION-01 · 默认视觉模型本机兼容验证

用户确认：端点 https://aiaaa.cc/v1 ，model ID `deepseek-v4-flash-vision-exp`，重视首字与持续输出速度。密钥未设额度上限；其“仅限 moi 使用”可能指 Mochi 软件专用，不能直接当作明确“仅本人”。root已追加作用范围澄清，待回复期间只在本机保密限量验证，不随教师安装包分发。保留 MiMo 可选。凭据不写入本票、Git、vendor、测试日志；使用官方本机凭据存储。若确认其他老师也默认使用，须补共享默认模型接线，不能将本机测试冒充该需求完成。

负责人：2026-09-09由root调度改为Lagrange在教材图片工具冻结后顺序执行；Halley继续独占分发profile与打包，避免同配置双写。root审核。不得改其他Agent的UI、LAN、PPT或固定alpha源码。先核实际本人运行数据根和官方配置层，不猜路径、不覆盖已有模型/会话。其他教师首次启动不能被误配此个人凭据。若现有分发profile缺少适配器，需要Halley统一接线，本票不自行修改共享profile。

复用：本轮实际搜 `site:github.com/deepseek-ai/deepseek-harness llm-pi-ai OpenAI compatible image input` 与 `site:github.com "deepseek-v4-flash-vision-exp"`。命中官方 providers 指南及 llm-pi-ai README；精确模型名称未获公开实现证据。固定 d347e703908d0406b7a7ef80e3a0e594d86b2215 的 `packages/llm/llm-pi-ai/src/config.ts` 已实际确认模型 input、provider defaultInput、apiKeyEnv；沿用此前已核 MIT 的官方完整框架与适配器，不写另一套网关/视觉插件，不为接入升级内核。在线master资料只为线索，实际以固定源码为准。

先验证 OpenAI compatible stream / 图片格式 / 模型可用性，再声明 text,image；不可从 vision 名称或 /models 目录直接推断实测成功。限量无敏感合成输入验证文本、图片、取消、错误；记录首个有效内容延迟、总耗时、token统计存在时才计算tokens/s，区分推理时间和文本输出时间。不得把网络慢等同模型吞吐低，也不伪造基准。

默认低延迟参数须由真实端点接受，不能猜支持的 reasoning 参数。保留用户自填设置优先和 MiMo 切换；现有会话绑定不被静默改写。完成给配置键名/脱敏状态、运行版本、可复核测量证据，禁止输出密钥值。

2026-09-09续审：root亲读隔离probe源和脱敏result/continuation-result（`/private/tmp/mochi-local-vision-20260909.KNDTSx`）。固定alpha PiAI通过官方本机credential ref与attachments发出真实请求：文本首内容2795ms/总2922ms；合成图首内容2487ms/总2695ms且数量识别断言通过；无效模型error、首内容后取消aborted。root未重复付费调用，图像正确性为执行者测试断言证据；不称最终桌面通过。首次1px图本地AttachmentError保留失败证据。usage可能含非可见输出，原165tok/s计算不作为速度结论。旧运行profile未加载PiAI时，只保存provider，不将新会话默认设为不可用route；alpha真正加载后再按无用户override设置默认。教师共享密钥范围仍待澄清。
