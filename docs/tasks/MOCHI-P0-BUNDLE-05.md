# MOCHI-P0-BUNDLE-05 · 完整依赖目标修复后的包内启动

状态：已验收 / PASS，实现者一次与非实现者独立一次均通过，主控核验完成。P0；唯一构建执行者p0_packaging_audit / terra-max，成功后p0_cold_start独立复验。方案§6/§45；沿用现有builder/Electron/DSH与runtime-profile、官方SPA。reuse-audit最新及p0-deps01-independent.md是固定复用/输入证据。

目标：工作区外App副本、新HOME/DSH_HOME/cwd、拒绝工作区/真实HOME与outbound，实际包内Electron Node22/profile启动mochi-web，ready→同源HTTP200及__DSH_BOOT__→SIGTERM/正常exit/PIDgone/portclosed/tmp清理全部通过。保留之前完整失败判据；非Finder窗口/Windows/校园网/模型验收。

仅允许既有离线构建生成目录、新run证据、verifier同深度副本。可移动当前第四轮release/mac-arm64到新failed-bundle-04时间戳目录；前三failed与原dist不动。原官方Electron缓存digest已核，不重新下载；仅用campus.nosync/mochi-dist/client静态输入。显式cwd/workdir和绝对路径；不安装真实node_modules、不修改生产代码/配置/锁/测试/adapter、不触碰用户服务与真实home。

复用第四轮verifier（fde2d92de0279e176ecfe88264157402a846c81a78641ded9aa8868c24fc766f），新run同深度只改TASK_ID，不改语义/路径断言，不新建大型检查脚本。输入以DEPS01四完整hash为准；packager55cbb178…、adapter7734256d…保持。前后确认原源码/静态/staging输入、失败01-04和历史dist关键hash不变。

最小结构：86根DeepSeek（dsh+84peer+deque）manifest exactversion且physical unpacked；关键yaml/argparse/pty物理、main在ASAR、旧dist/代表dev排除；profile12插件/29模块、三官方前端hash沿用前三轮固定值。记录ASARhash/文件数/大小。不把构建exit0当启动通过。

构建一次后回报候选hash；verifier一次真实运行，失败即保留报告并返回，不擅自补码/重试。成功冻结候选/脚本/结果交主控审阅，再通知非实现者在独立同深度run用同脚本同候选复验一次。候选与两个运行证据均绑定hash。审计放行不等于发布或P0全部通过；内核路线/remote与真实现场仍待用户。

最终证据见artifacts/architect-audit/p0-bundle05-independent.md及两份冻结run。候选ASAR61c5203b3a7668d991cc628fe9eb2b1187477a97079b034af36f3284ddd9dcc5；verifier f9545a79b9101beb67bfd5fc76510736e8ea857f70b00c6f6ade3e9192267a75。
