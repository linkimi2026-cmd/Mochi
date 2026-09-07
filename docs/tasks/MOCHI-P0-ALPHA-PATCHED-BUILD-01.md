# MOCHI-P0-ALPHA-PATCHED-BUILD-01

状态待执行，前置 ALPHA-REASONING01 经 root 独立源码/测试审计 PASS 后才允许启动。P0，方案 §6 固定 alpha 源码集成 / §45 基线；root 架构与审计，拟由 Lagrange / terra-max 唯一实现执行。不是当前即刻授权。

目标：把经审查的最小 DeepSeek 兼容源码 patch 通过官方构建与家族打包变成完整声明和运行产物，供后续独立 consumer 集成验证。当前 RUNTIME01/NATIVE01 来自未补丁 tarball，不能沿用其成功冒称补丁已集成。

复用：沿用 docs/reuse-audit.md 的固定 MIT 官方 Harness d347e703908d0406b7a7ef80e3a0e594d86b2215 / pnpm11.7.0 / 官方 build:official、release pack。此前官方完整 build 和 248+9 家族 pack 已真实通过。没有新选库/新构建器需求，不重做已完成的完整框架检索。锁定源码加审定 patch，不能把改后源码冒称无改动上游；commit 来源与 patch SHA 分开记录。

只允许执行者已拥有的外部 REASONING01 源副本中新构建输出，以及新唯一 alpha-patched-build/<timestamp> 证据目录和独立 tarball 输出目录。源码冻结为 root 审定 patch，不再改四文件、tests、package、锁、构建脚本；其他 AGENT 只读检查不得受覆盖影响。你不是唯一工作者，不写 desktop/UI/plugins/runtime-profile/原 BUILD01/原 257 tgz/原消费者/共享 docs/真实 HOME。产物声明仅由官方构建生成，不手改 lib。

执行前核固定 patch SHA、源与 clean upstream 四文件基线/差异、lock SHA、包版本、原 client build record，并读取相关已有 AGENTS。已有独立依赖直接复用，禁止重装/升级。使用普通 Node22.22.2、固定 pnpm11.7.0，env-i HOME/DSH_HOME/XDG/cache/TMPDIR 指向独立目录，保持官方 DSH_CLIENT_COMMIT_HASH 为来源全 commit，同时额外证据明确 patched source 身份。此前 wrapper PATH 缺 pnpm 问题已有已验薄转发器，按真实路径复用；不修改项目工具配置。

顺序：官方 build:official exit0 后，亲验 lib/type 声明包含 reasoningEfforts 与 medium 的 model-scoped 公共类型，并执行官方 readClientBuildRecord 验证当前全部 Web 产物。只对新唯一输出运行官方两 family pack，保留 248+9 清单/manifest/每 tgz SHA，不加 pnpm 多余 --。不运行旧 omit-optional verify 重现已知失败；后续标准消费者另票指定。任何失败保留真实命令与退出码，需改源码/锁返回 root，不机械重试。

验收：官方全构建/两 family pack 真实 exit0，CLI 版本仍 0.1.3-alpha.1；完整 build record 校验；已生成 .d.ts 与审定源 API 一致；差异绑定 source commit+patch SHA，锁未变，旧回滚与原证据均冻结。不冒称 profile、Electron、Windows、模型端点或 P0 已通过。交付源/输出路径、命令/句柄/退出码、产物 hash 与范围。root 独立核关键字节与 tar manifest 后才推进新的 consumer，不能只拿执行者报告放行。

### 启动授权

REASONING01 已经 root 独立验收 PASS；本票现授权 Lagrange 执行。唯一源 /private/tmp/mochi-alpha-reasoning01.NRLa4C/source，固定 patch SHA c3e0b4a96e91c79ad49a13f7ddddcb4c7ab792cf419edca5d6db830612e4015c。遵守上述边界，source/tests 从此冻结，只官方生成 build/pack 输出。完整 build 需要重新验证，不能拿原 BUILD01 产物替代本轮。保留执行句柄。

### 自动依赖刷新前提已闭合

root 独立核原 BUILD01 与当前副本：pnpm-lock 字节一致，.pnpm 1071 个目录身份集合完全相同，hoistedDependencies 结构完全相同，七个已审源/tests 哈希未漂移，见 root-dependency-refresh-check.json。复制前 workspace state 含273个原树绝对项目路径，固定 pnpm11.7 _checkDepsStatus 按当前 rootDir 查旧键判断 stale；默认 verify-deps-before-run=install，于是官方 run 自动安装。实际 store 转到新隔离 XDG 路径。接受此环境刷新，明确不再宣称本次“未重装”；不放宽锁/能力策略，不重跑成功 build，解除 pack 暂停。

root 已直接调用固定官方 readClientBuildRecord(expected official)，重算222个产物通过，当前 digest fa941f1fa054715bf2f99a83dabc730a1358761e4d27c9250ff44fd832c6901b，见 root-client-record-check.json。亲读生成的 adapter/index/types .d.ts 已有 reasoningEfforts 与 medium 类型。完整家族 pack 尚待实际完成。

### 主控验收

状态已验收，PASS 限固定 patch 官方 build/pack。root 亲读 build 43432、dsh66240、vendor93186 各终态 exit0，独立遍历257 tarballs（248 dsh alpha、9 vendor、257唯一名称）并重算全部hash：root-packed-family-hashes.json。实际补丁 llm-deepseek 的JS与三 .d.ts 内容与本次build字节一致；record222产物独立通过，普通Node CLI独立输出0.1.3-alpha.1。七源码/tests和锁已在自动刷新后独立复核未漂移。新包根 /private/tmp/mochi-alpha-reasoning01.NRLa4C/patched-pack-20260906T221101Z。

后续完整profile consumer、Electron原生再绑定、插件兼容、Windows等仍独立未验；不得将本票PASS扩大。执行者完成简短最终证据收尾后冻结，无重测/重新构建授权。
