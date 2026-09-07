# MOCHI-P0-ALPHA-NPM-02

状态：待执行。P0 §6来源基线证据，唯一执行者p0_baseline_inventory / terra-max，root审计。前置只读ALPHA-INSTALL-DIAG01交付后方可启动。本票与现用内核路线决定无关，不切换Mochi。

目标：同一257个已校验tarball/固定官方verify-packed-install脚本，在外部隔离环境用npm11.6.0做一次消费安装对比，验证官方peer空parent修复是否使此检查前进。上一轮npm10.9.7 loadPeerSet edgesOut失败保留，不重新pack/build、不修改任何源依赖或脚本。

复用依据见reuse-audit最新：官方PR8448 merge208c06e、v11.6.0源码精确保护、Artistic-2.0、Node范围兼容22.22.2。采用现成npm发行包，不补其源码。历史版本仅对比实验，不当默认生产升级或安全推荐。

唯一写范围：自身外部隔离树中新npm工具目录、新独立home/cache/tmp，artifacts/architect-audit/alpha-npm02/<新timestamp>/证据。不得改原source/clone/desktop/锁/任何旧成功失败证据，不改全局npm或用户服务；你不是唯一工作者，不覆盖他人编辑。root维护WORKLOG/reuse/任务票。

执行：精确从官方registry下载npm11.6.0 metadata+tarball，核SRI/版本/许可/engines及实际arborist保护源码。薄wrapper仅转发已验证Node22.22.2和该npmCLI，PATH置前且在同env-i白名单验证node/npm/pnpm实际版本。继续同pnpm11.7.0运行官方release:verify-packed-install，参数不加多余--；输入仍原248dsh+9vendor tarball，先核hash/buildrecord。无凭据/env继承，无force/legacy-peer-deps/降低校验/脚本修改。原官方omit optional策略不变。

只运行一次新consumer。普通依赖解析网络允许，记录它不属于源锁可复现消费者；若失败保留真实首次错误并停止，不自动改别的包或工具。长命令立即发session句柄，等待同句柄，按需查隔离debug，不因无增量重启。

交付：实际工具SRI/hash/version、完整命令/exits、CLI是否到达/输出、consumer finally清理；原包/lock/buildrecord/desktop未变。成功仅该工具组合的CLI版本消费路径通过，不证明Mochi下游/profile/UI/Windows。所有旧报告不覆盖。发现任何超票内容返回主控。

## 审定结果：consumer受阻 / BLOCKED

证据artifacts/architect-audit/alpha-npm02/20260906T201450Z-official/RESULT.md。npm11.6.0 SRI及实际工具/parent保护通过；同257tarball官方consumer session72845 exit1，越过原edgesOut异常但在koffi3.2.1 lifecycle失败，CLI未执行。root亲读官方日志/npmdebug与执行者限定缓存源码诊断；确认fs-local等6包普通dep koffi^3.1.0，选3.2.1。它的darwin-arm64平台包在optionalDependencies，官方omit optional在reify排除该包，loader缺预编译文件后cnoke回退源码编译，环境无CMake。此为新的已证实失败链，不称消费安装通过；也不证明正常包含optional的安装必然失败。

root实际复核consumer目录已清理、desktop package/lock/BUNDLE05候选hash不变、git diff --check通过。没有换现用npm或修改项目源锁。此次受控对比不能独立证明仅某一npm补丁是因果，因为npm11还有其他变化且registry动态解析。下游集成路线继续待用户决定，不以安装诊断替代P0现场/remote闸门。
