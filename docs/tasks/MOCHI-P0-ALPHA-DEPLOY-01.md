# MOCHI-P0-ALPHA-DEPLOY-01

P0 §6源码alpha运行时分发前置；状态待执行。唯一执行者p0_cold_start/terra-max；root审计。与Lagrange MIMO01独立，所有旧构建源/依赖/257包/desktop候选保持只读。

目标：验证固定pnpm11.7.0已有deploy --legacy --prod能否从d347e7039已构建源码导出可搬移的生产CLI树，避免自写依赖收集器/把全部发布family当生产根依赖。不是网络部署或发布，仅本地目录生成。

复用依据reuse-audit最新：主控亲跑固定工具help并读发行物handler；原workspace无injectWorkspacePackages，采用支持的legacy，不改workspace配置；实现saveLockfile=false但不是frozen运行，须记录该范围并核源锁和output依赖版本，不假称完美可复现。

唯一写范围：自己新建外部隔离目录及artifacts/architect-audit/alpha-deploy/<timestamp>/证据。你不是唯一工作者，不改Lagrange正在读取的原BUILD01源树/node_modules，也不改项目/插件/锁/desktop/旧证据/共享docs。

执行前读取任务相关源AGENTS。源绝对路径含字面XXXXXX：/var/folders/38/0n1yygv5031_w798dhgjscyw0000gn/T/mochi-alpha-build01.XXXXXX.WycQ6P5wej/source。建立自己的外部源码副本，保留已构建产物和manifest/lock、排除node_modules（可用已有正常复制工具）；不能凭空改变文件/依赖，记录源锁和buildrecord。使用原已校验pnpm11.7.0/Node22.22.2/独立env-i HOME/cache/tmp，允许复用公开pnpm store缓存。先实际工具版本和路径预检。

仅向全新空output运行 `pnpm --filter @deepseek-ai/dsh --prod deploy --legacy <output>`（以固定help真实语义为准），保留optional平台包，不force/no-optional/ignore-scripts/修改源码；source副本允许官方工具产生临时元数据，原树冻结。失败保留第一真实原因并停止，不升级工具或反复改参数。

成功后检查output package version0.1.3-alpha.1及lib/bin.js/必要Web产物实际存在。复制完整output到第二个新外部路径（保留symlink），递归核所有symlink realpath不能逃出该副本或悬空；从搬移副本普通Node22执行CLI --version，不借源workspace链接、NODE_PATH或用户home。输出目录大小/包数/源版本分布与例外，核是否混入rc版本或dev根；不把--version等同profile/GUI通过。可额外只读import关键native koffi从其真实owner上下文验证，不启动模型/服务或修改生产。

交付短报告、命令/exits/实际session/文件摘要、可复用output路径、源锁/buildrecord不变；失败无伪PASS。root将据便携性/维护成本决定是否采用，不自动集成desktop。长命令即发句柄；先完成实际验证再完善报告，避免路径手写多timestamp导致重复前置失败。

## DEPLOY02：环境路径一致性单次对照（root 授权）

DEPLOY01 已失败，证据 20260906T205024Z 冻结，partial output 不可交付。主控亲读固定 handler 的 path.relative 与绝对 deployDir 计算、实际 /var 输入及 /private/var/var 错误，规范化不一致是待验证假设。

允许同一执行者在全新外部 root 单次复验：先 realpath 规范化根目录，所有 cwd/source/output/HOME/TMP/XDG/工具绝对路径统一使用规范路径；尚不存在的 output 从已规范根派生。源复制方式和命令语义不变，不修改生产或 pnpm。不得尝试在 /private/var/var 创建目录，不升级、不 force、不删失败证据。store 可保持独立 XDG；若复用缓存，只采用实际 help/config 核实支持的参数，不能再声称被忽略的 npm_config_store_dir 有效。

先记录精确可复跑命令和解析后的路径，保证所有写目标在自己新根内。一次失败即停止；成功后完成原票全部搬移/链接闭包/CLI/来源检查。原 BUILD01 和桌面保持只读。与 MIMO 测试不交叉写入。本次只验证环境路径假设，成功也不把原失败根因自动判定为 pnpm 缺陷。

## DEPLOY03：完整构建工作区前提（root 授权一次）

DEPLOY02 exit1保留：根postinstall在CI分支前静态import开发依赖lefthook。此前排除全部node_modules的副本不满足此官方脚本前提。已核原完整树1.6G/6360相对symlink全部内部、无悬空，6个nlink=2文件另列；根virtualStoreDir=.pnpm。固定pnpm11.7 checkCompatibility以path.relative比较store路径而不realpath，因此缓存flag精确采用原.modules.yaml的raw /var/.../pnpm-store/v11值；固定--store-dir已实测支持。其余所有cwd/source/output/HOME/TMP等仍canonical。

允许Maxwell一次新唯一外部完整source副本：正常rsync -a，包含node_modules及已构建输出，禁-H、--link-dest、源hardlink或元数据补丁。复制后先核所有symlink实际目标在新source内/不悬空、regular files与原对应不同inode，重点六个硬链接候选；源lock/buildrecord/CLI哈希不变。空间已核75Gi可用。

同固定pnpm11.7/Node22.22.2/env-i/CI=true，以真实--store-dir指向已获准复用的公开BUILD01缓存（允许工具缓存正常新增，不宣称纯只读缓存），向新空output执行同prod legacy deploy。不得跳过生命周期、修改pnpm/源码/依赖/锁、安装CMake、升级工具或再次改参数重试。生命周期可能下载Node headers，记录真实行为，不能称离线。根source副本写入允许，原BUILD01源/node_modules/原clone与desktop冻结。

一次失败即止。成功后完成原票搬移、全部输出symlink闭包、普通NodeCLI版本、必要官方Web产物/版本分布/dev根与native可用性检查，输出hash/体积/源不变证据。搬移验证只读可重复核验，不能用CLI版本替代profile/GUI。全程不写其他执行者目录或共享docs。

## 最终主控结论：CHANGES REQUIRED / 本策略不采用

DEPLOY03命令exit0，完成生命周期，但搬移必验项失败。root独立遍历真实moved输出再次确认2264个symlink、111外逃，目标5个：schemastery101、cosmokit7、CLI1、两个Linux optional native各1。来源见20260906T211232Z-deploy03/REPORT.md。不得将此输出用于生产分发，停止本策略，不手工修补链接或第四次deploy。

Web原检查路径假设被纠正：实际dsh-web-frontend/dist/index.html存在，root亲核hash e7df1e2c492b03a707ce909889f48a1f324aedcb7d6ec2bd51601acae01af1af与BUILD01一致；不是资产缺失。未跑借源CLI/native/Electron，失败证据完整保留。后续移到独立ALPHA-RUNTIME01官方tarball消费票，不覆盖本失败或称P0通过。
