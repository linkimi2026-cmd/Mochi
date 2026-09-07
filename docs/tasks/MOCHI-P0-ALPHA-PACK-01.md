# MOCHI-P0-ALPHA-PACK-01

状态：待执行。P0 §6源码基线/§45可回滚证据，唯一执行者 p0_baseline_inventory / terra-max，root只审计。依赖 ALPHA-BUILD01 已验收；沿用固定d347e703908d0406b7a7ef80e3a0e594d86b2215、Node22.22.2/pnpm11.7.0、未改锁的已建外部archive。

目标：用官方release pack生成完整dsh/vendor家族包，再用官方verify-packed-install在工作区外consumer安装并验证CLI版本，排除仅workspace链接才可运行的假象。不接入Mochi、不升级当前内核，不发布。

复用：沿用reuse-audit ALPHA-BUILD01同一固定MIT官方框架；root已读scripts/release/pack.ts、families.ts、verify-packed-install.ts。官方有payload/buildrecord/version检查与隔离消费脚本，不自写打包/安装系统。pack会删除out，必须每家族使用新建唯一空输出路径，不能指向source、依赖树、现有artifact或旧候选。

写入所有权：只允许自己的既有外部隔离树中新output/cache/consumer及 artifacts/architect-audit/alpha-pack/<新timestamp>/证据。你不是唯一工作者；不改原clone/desktop/任何源码锁配置、用户改动/服务、其他人产物、共享docs或WORKLOG。执行前核build record保持222/9b93a82b…、lock2c903ab8…，读相关AGENTS。任何脚本要求改源码/锁/版本即停止报主控。

环境继续env-i白名单/独立HOME与DSH_HOME/npm cache/TMPDIR/工具PATH、CI=true、明确DSH_CLIENT_COMMIT_HASH实际全commit。先精确检查node、pnpm、npm命令名可用。按官方package script真实参数传递分别pack dsh与vendor，concurrency1。不得release:publish或凭据。成功后官方verify-packed-install --family dsh --from <dsh输出> --from <vendor输出>；它按官方既有策略omit optional并在finally清理consumer，保留这一验证范围，不人为改策略。

验收：两family官方pack检查exit0、清单/每tgz hash、官方隔离consumer exit0且CLI0.1.3-alpha.1，记录完整真实命令/工具版本/退出码与清理状态；原锁、buildrecord、当前desktop/candidate不变。首个失败如实记录，不修码机械重试。无profile/模型任务，不以--version证明完整应用兼容或可复现第三方依赖锁。保留tarballs与原成功构建供审计，不删除唯一证据。持续执行保留session句柄，超过60秒简报真实阶段。

## 本轮审定：受阻 / BLOCKED

官方dsh pack 248包/vendor pack 9包均exit0；首次额外`--`被pnpm传给parseArgs导致exit1，保留原错误，按真实参数语义纠正且使用新out后通过。未改官方脚本。主控用tarfile逐包核257个manifest唯一包名、dsh版本、order完整性，独立重算全部257个tgz SHA256吻合证据清单。

官方consumer session99976 exit1：npm10.9.7在#loadPeerSet解析依赖时抛出Cannot read properties of null (reading 'edgesOut')；CLI --version未执行。主控亲读verify-packed-install.log与原npm debug的真实堆栈，不能判独立安装成功，也未证明Mochi不兼容。主控实查consumer目录已清理，官方readClientBuildRecord重算仍222/9b93a82b…，lock2c903ab8…不变，desktop package/lock和BUNDLE05 ASAR冻结。证据目录artifacts/architect-audit/alpha-pack/20260906T195341Z-official。停止本票重试，不擅自升级工具或修改官方源依赖。
