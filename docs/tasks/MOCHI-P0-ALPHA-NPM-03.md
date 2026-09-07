# MOCHI-P0-ALPHA-NPM-03

状态：待执行。P0 §6既定alpha源码基线，唯一执行者p0_baseline_inventory/terra-max；root审计。方案本已授权alpha目标，原rc+patch候选保留回滚，不需用户再次选择alpha。尚不集成desktop、不进P1。

目标：解决已证实的验证环境问题，检查正常包含平台optional依赖时257个原alpha/vendor tarball可否独立安装并运行CLI。复用固定官方verify-packed-install和npm11.6.0，不写新安装器、不改源包或验证器；用干净子环境显式npm_config_include=optional，按npm标准配置覆盖脚本omit同类型。必须明确命名include-optional变体，原官方无optional验收仍失败，不能覆盖历史。

复用依据reuse-audit最新：Koffi3.2.1用optionalDependencies分发各平台预编译包；原omit策略使其回退编译。include保留正常平台native payload，不降低peer或lifecycle检查。读取固定npm11.6实际config定义确认include行为及现有源landlock平台条件；已有工具SRI可复核，不重新下载/升级。

唯一写范围：自己外部树中新隔离home/cache/tmp以及artifacts/architect-audit/alpha-npm03/<新timestamp>/证据。source/clone/原257tgz/desktop/当前候选/旧证据冻结；不覆盖他人编辑，不写WORKLOG/reuse。若复用前次公开下载cache可用同既有隔离cache以省下载，但清楚记录，仅一个consumer进程，不继承任何用户凭据或全局配置。

执行：env-i+明确PATH Node22.22.2/npm11.6.0/pnpm11.7.0，实际工具预检；原257tgz hash/buildrecord/锁不变；新增npm_config_include=optional。运行同官方pnpm run release:verify-packed-install --family dsh --from <原dsh> --from <原vendor>一次，不加多余--。不使用force/legacy-peer-deps/ignore-scripts/修改锁/加CMake。不启动模型/profile或GUI。长命令启动立即发session，同句柄等至完成或明确错误。

验收：真实退出0，installed CLI0.1.3-alpha.1；日志确认Koffi native生命周期成功而无CMake回退（若官方捕获成功日志不展示，读取同一npm debug）。最终consumer清理、包/源锁/record冻结。失败保存准确错误后停，不机械改配置重试。报告简短说明这是include-optional消费成功/失败，不是原omit检查PASS，也不证明生产第三方锁可复现、Mochi下游/UI/Windows已适配。

## 已验收 PASS（仅include-optional变体）

证据artifacts/architect-audit/alpha-npm03/20260906T202535Z-include-optional/RESULT.md。session85339 exit0；原257tgz/固定官方脚本+Node22.22.2/npm11.6.0/pnpm11.7.0，独立home/tmp，复用此前公开npm下载cache。root亲读success日志，installed dsh CLI0.1.3-alpha.1；亲查同npm debug koffi3.2.1生命周期code0/npm exit0，无CMake回退文字；实际确认consumer目录已清理、desktop输入/ASAR冻结。原omit检查仍失败，不覆盖，不将此次成功外推Mochi插件/GUI/Windows。
