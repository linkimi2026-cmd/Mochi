# MOCHI-P0-ALPHA-BUILD-01 · 官方锁定源码可构建证据

状态：已验收 PASS。P0来源基线审计；唯一执行者p0_baseline_inventory / terra-max。主控只审计。方案§6要求dsh源码集成锁dsh-v0.1.3-alpha.1/d347e7039；§45要求可回滚基线。本票只验证官方锁定源，提供路线/可复现性证据，不切换现用内核、不移植功能、不进入P1。

源：mochi-harness-src.nosync/mochi-harness，HEAD d347e703908d0406b7a7ef80e3a0e594d86b2215、clean，MIT；pnpm11.7.0，Node^22.19||>=24。主控已完成新GitHub完整框架/desktop生态检索与固定源审阅，见reuse-audit最新ALPHA-BUILD01。采用官方build:official脚本，不编写或修改build系统。

唯一写入范围：你自己在工作区外mkdtemp创建的git archive副本及独立依赖/缓存目录；本项目artifacts/architect-audit/alpha-build/<timestamp>-official/内简短证据/日志/输入产物hash。root维护WORKLOG/task/reuse，不由你修改。不得修改原clone、apps/desktop、锁/patch/生产脚本、已验收候选/旧失败证据、真实home/用户服务、联动计划目录或其他代理编辑；你不是唯一工作者。

执行前读源AGENTS.md和相关scripts规则；不用clone外部当前main。对固定commit做git archive到外部临时目录，先核根路径与关键锁hash。使用标准pnpm精确11.7.0（若无则从官方registry获取并校验dist integrity与包license/version，不用11.8/latest代替），显式工作目录与Node22.22.2常规可执行路径，记录PATH确保pnpm/npm子进程实际Node版本匹配。普通子环境白名单、隔离HOME/DSH_HOME/缓存，CI=true以官方postinstall现有分支跳过Git hook；不继承模型/云凭据，不拷原.env。

采用官方pnpm install --frozen-lockfile及原workspace allowBuilds策略安装到该副本，允许网络获取锁内公开依赖，不触碰当前真实node_modules。执行官方pnpm run build:official。不得通过改锁/改版本/关strict校验/删代码让构建通过。生命周期失败先保留准确原因；暂态下载失败可对同一固定输入恢复，不把网络错误说源码编译错误。

若官方构建成功，核实apps/cli/lib/bin.js及official Web产物/build record真实生成，用常规Node22执行官方CLI --version（不运行模型任务、应用profile或e2e），记录输出/version与锁前后hash。无需全量test/coverage或Windows模拟。成功产物保留本次隔离源路径供主控后续官方pack核验；若清理大依赖树，先把必要产物/日志固化并告知主控，不自删唯一证据。

交付精简：实际目录/源commit、pnpm/Node版本、安装/构建各命令及exit、首个真实失败或成功产物hash、是否改锁、是否有运行进程/工具session ID。持续超过60秒需简报真实阶段；保留可继续查询的句柄，不能因一次观察超时就重启。原clone/桌面候选关键hash不变。构建通过仅说明此固定源码可构建，不能声称当前桌面已升级或Mochi下游兼容。需要代码修复/集成/新依赖时返回主控，不越界。

主控已核官方archive参数：scripts/client-build-environment.ts repositoryCommitHash明确支持DSH_CLIENT_COMMIT_HASH，外部archive无.git时使用实际已验证完整commit d347e703908d0406b7a7ef80e3a0e594d86b2215，官方会截7位。这是官方non-Git构建输入，不是虚构来源或修改源码。构建记录路径.dsh-build/client-build-environment.json。

验收：证据 artifacts/architect-audit/alpha-build/20260906T193723Z-official/RESULT.md。frozen install exit0；首轮 build 因外部 PATH 无 pnpm 命令 exit1，日志保留，薄 wrapper 仅转发同版本工具后官方 aggregate exit0；CLI exit0/version0.1.3-alpha.1。主控亲跑官方 readClientBuildRecord(expected official env)，重算222产物 SHA256 9b93a82b010903f52008f7b49937b3d17cd13ec5bfba1d72278e2df0fc99b90b 通过；独立shasum核lock/CLI/record/Web index吻合交付。原clone clean，desktop package/lock、adapter、BUNDLE05 ASAR hash保持冻结值。此PASS不含消费包安装、下游插件、Windows或模型实测。
