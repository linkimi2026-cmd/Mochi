# MOCHI-P0-CONFIG-01 · 全新 profile 的 MIMO 配置

状态：已验收/PASS（限本票源码profile配置）。阶段 P0；实现负责人 p0_packaging_audit（terra-max），独立验证 p0_cold_start + 主控。

价值：新安装不依赖开发机的手工运行配置，MIMO 插件能加载，缺密钥不会在服务启动阶段导致崩溃。

依据：总体方案 §6“runtime-profile.json 声明”“需要 config 的插件走手工区完整 insert+config，不手改受管区”；§9 MIMO 主力；§45 新目录 profile 启动。本次只修启动所需配置，不迁移内核、不新增密钥、不派 P1 界面。

现状证据：`artifacts/architect-audit/cold-start/` 独立测量中 provision 44.565ms 成功，ready 前约8.604s失败；MIMO `apply` 对 undefined config 调用 resolver。已审代码与真实错误堆栈，不是 API 网络问题。源码 dsh npm0.1.2-rc.1保留；两份打包脚本上一票已冻结。

采用的执行方式：用户确认现有 terra-max 角色就是 Max；角色配置 `/Users/a1379/.codex/agents/terra-max.toml`。复用来源及官方配置语义见 `docs/reuse-audit.md` 的本票补充，实施前阅读。

主控确定的最小架构：在现有 runtime-profile.json 插件声明中增加可选的首次配置数据（命名由实现者决定），配置仍以该文件为源；生成器对缺少用户手工 entry 的配置插件只在首次 provision 时种入完整 insert+config 的非受管区，再用既有 collectPluginIds 机制避免无 config 的重复受管 entry。已有手工 entry/config 必须原样保留，重新生成不能覆盖。普通无config插件沿用原机制；不新增第二个配置文件入口，不让代码默认把MIMO请求送到DeepSeek。若实际Cordis语义不支持该方案，先报告，不另创运行体系。

已核查可复用的非秘密运行参数：主控只对白名单字段投影读取现有 mochi-web 的 MIMO entry（未读取凭据仓库）：apiKeyEnv=MIMO_API_KEY，baseURL=https://mimo.ezlook.top/v1；models 两项 mimo-v2.5 / mimo-v2.5-pro，已有部署上下文上限131072、maxTokens8192、reasoningEfforts=[off,low,medium,high]。这些数字仅是当前已验证存在的部署配置，不声明为供应商规格。可复用这些配置，常规默认低或关闭推理；本票不得复制任何实际key/token。缺credential应在真实推理请求时报MISSING_CREDENTIAL，而非插件加载时崩溃。

允许写入：
- apps/desktop/resources/mochi-web/runtime-profile.json
- apps/desktop/resources/mochi-web/runtime-profile.cjs
- apps/desktop/scripts/test-runtime-profile.mjs
- artifacts/architect-audit/p0-config-fix.md

禁止修改：用户实际DSH_HOME及所有credentials/settings、插件源码、锁文件、两份已验收打包脚本、dsh内核、主/渲染进程、其他Agent的测量/文档。你不是唯一工作者，不覆盖他人改动；改前核对主控新快照。不得新安装依赖，不调用模型/网络服务、不启动真实用户服务，不提交推送。

验收：全新临时home所有三profile的MIMO真实最终config完整且仅一实例；第二次provision字节幂等；已有手工endpoint/models/config不被覆盖；普通插件原有生成/用户状态保护不回归。加入真实插件apply或等价实际loader验证，不能只dump-config宣称可运行。保留缺凭据fail-closed，不把key打包；隔离出口拒绝网络。运行 test:runtime-profile、test:package-resources 与相关自测。生产源码修好后交独立冷启动代理做新的不覆盖失败记录的验收，主控审核diff与hash。

交付：修改路径、pre/post hashes、精确命令/环境/结果、异常验证、未测范围和最小回滚方式。越界立即回传，不能吞错误或禁用MIMO来让启动通过。

## 独立验收 · 2026-09-07

主控审阅备份对照三文件真实diff、亲跑Node22.22.2 test-runtime-profile PASS、diff --check PASS。冻结SHA以 artifacts/architect-audit/p0-config-fix.md 三行完整值为准。非实现者p0_cold_start单次COLD02（cold-02-config01-node22-20260907）PASS；主控审阅result.json、脱敏日志、测量脚本。新home至有效HTTP1931.085ms（provision39.756ms、sidecar ready1865.008ms），303换cookie后200且真实__DSH_BOOT__；SIGTERM退出0、PID消失、端口关、临时树删、无SIGKILL全部true。COLD01失败原证据保留且校验不变。

范围：当前macOS arm64源码/无模型交互，不能当作Finder、包内资源、Win10、校园网或真实模型验收。下一依赖为BUNDLE01；P0整体仍未通过。
