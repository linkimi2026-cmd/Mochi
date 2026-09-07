# MOCHI-P0-ALPHA-MIMO-01 · 官方适配器兼容实证

阶段P0 §6固定alpha源码集成的前置兼容验证；状态待执行。唯一执行者p0_baseline_inventory/terra-max；root负责选择架构与独立审计。既定目标alpha d347e7039，rc候选保持回滚，用户UI不动。

目标：验证已构建固定alpha官方llm-pi-ai能否承接现有mochi-mimo route的必要行为，避免为已有能力另补内核。此票只创建隔离验收harness，不修改实际MiMo插件/内核/配置。读取p0-alpha-mimo-source-gap.md、reuse-audit最新，以及原plugins/mochi-llm-mimo/index.mjs，确认旧行为依据。

复用已核固定MIT官方Harness及其llm-pi-ai源码/现成tests（官方模拟HTTP/SSE fixtures）。已发现它支持per-model reasoningEfforts、medium、compat.thinkingFormat/supportsReasoningEffort/supportsDeveloperRole。实施前核当前锁实际@earendil-works/pi-ai版本/许可证与包导出，不能用main/latest或README代替已安装版本。优先公共发布API；resolveProfiles未由index公开export，不能通过仅源码可访问的私有seam做出“可接入插件”的假结论。可以使用公开plugin apply+Config/实际Context，或公开可构造接口；若必须内部导入，明确标内部单元能力，不能判生产接入PASS。

唯一写入范围：自己外部新临时验证目录，以及artifacts/architect-audit/alpha-mimo/<timestamp>/中的测试harness/结果/脱敏loopback请求证据。可复用之前外部构建树的只读node_modules/lib，但不能改变原source/lock/buildrecord或旧证据。你不是唯一工作者，不修改desktop/plugins/真实home/用户服务/共享docs。root继续审计版本接入面。

测试必须真实调用固定已构建PiAiAdapter/公开plugin，使用本地127.0.0.1端口0模拟OpenAI SSE，不请求外部模型，无真实凭据，仅fixture key。env-i/独立HOME与DSH_HOME；不要继承模型/云token。不要重新install/build/pack或完整test suite。

必要case：
- 自定义route mochi-mimo，配置只声明off/low/medium/high；目录只暴露这些，max请求在任何HTTP前拒绝。路由、模型ID/展示名可保持。
- low/medium/high线上的reasoning_effort原值，以及DeepSeek格式thinking enabled；off线上thinking disabled且不发非法reasoning_effort=off。system角色按现有DeepSeek请求，不被擅改developer。
- 真实SSE正常文本与tool-call增量（首包非空id/name，后续空/null身份+参数续传），最终身份与参数完整，记录实际结果。
- AbortSignal中断慢流，应终止请求/iterator，server sockets/process清理；不能靠强杀当取消通过。
- 凭据从注入resolver提供，缺凭据在发请求前报错（若官方apply需CredentialsService，使用官方测试服务/本地fixture，不落真实密钥）。

仅验证所述场景，不用这些mock证明真实MiMo端点或模型质量。遇到官方行为不等价记录最小复现，不改测试预期或源码迎合。输出具体可复用的公共入口、精确输入、请求/输出断言、运行命令/exit和失败边界，保留harness让root同版本独立运行。超过60秒报告真实阶段；长命令发session，若探索超过数分钟先交最关键API/阻塞，不写泛化报告。

## 主控验收：PASS（仅隔离协议范围）

首版 20260906T204558Z 漏显式空/null及部分wire/text断言，保留原证据；identity-v2补齐。root 亲读首版全部harness与v2差异，独立新HOME/DSH_HOME/TMPDIR、env-i、Node22.22.2复跑相同公共包harness，session39555 exit0。harness SHA256 2ca1dccbf196966230f1060e8932b8cb03a204323f00c372ea4ed80d05b3412f，前后相同。独立证据 artifacts/architect-audit/alpha-mimo/independent-v2：6组全部PASS，missing/empty/null工具流identity与参数完整，4档正常文本、exact synthetic credential/model/path/stream、max/缺凭据HTTP前拒绝、system保持、abort关闭/计时器清理，活跃socket0、无剩余fixture。

不等于真实MiMo/实际credentials-local/全profile/桌面UI/Windows通过。生产未改。既有PiAI实例接线、旧手工配置迁移、default low与中文档位仍需下一独立票；不得直接在旧wrapper第二次apply。
