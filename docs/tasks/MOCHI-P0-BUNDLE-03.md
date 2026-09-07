# MOCHI-P0-BUNDLE-03 · 宿主peer修复后的真实启动

状态：返修 / CHANGES REQUIRED，BUNDLE03真实启动失败，详见末尾结果。P0；唯一构建执行者 p0_packaging_audit / terra-max，非实现者独立运行 p0_cold_start。继承BUNDLE02全部隔离、输入保护与不发布边界；不进入P1。

目标：方案§6、§45的包内mochi-web新home启动。采用现有builder/Electron、ASAR01物理布局、PEERS01标准宿主声明及DeepSeek peer检查；GitHub来源/许可/兼容结论见reuse-audit.md，React只读链见p0-react-peer-runtime.md及p0-bundle02-independent.md。不新增runtime版本、依赖、脚本框架或resolver。

允许原生离线构建生成目录、新run证据与BUNDLE03验证器副本；保留原BUNDLE01和BUNDLE02失败证据，以及其各自候选。可将当前release/mac-arm64这份自建失败候选移入release/failed-bundle-02-时间戳；既有failed-bundle-01与更早dist/mac-arm64/Mochi.app均不动。官方Electron缓存已核digest，不重复下载。显式校园静态输入只用本项目campus.nosync/mochi-dist/client。

执行所有命令使用显式cwd/workdir及绝对证据路径，先核目录；不依赖跨调用cd或保留shell变量。对源码/锁/profile/关键dsh adapter做前后hash比较，只有生成目录可变；不在真实依赖树安装、不启动或停止旧用户服务。

复用冻结BUNDLE02 verifier，新目录更改任务标识即可。保留同源HTTP、原/副本关键hash、App内部symlink闭包与本次临时树归属断言，不改原证据/放宽PASS。工作区外副本、新HOME/DSH_HOME/cwd、拒绝工作区/真实HOME与出站，实际包内Electron/DSH/profile→ready→200真实boot→SIGTERM/PID/端口/tmp清理，运行一次；失败立刻保留并回报，不重复猜测。

结构仅做必需检查：24个已声明DeepSeek peer及runtime依赖被选入、yaml/argparse/native物理存在；main在ASAR、旧dist与代表dev包排除；profile源hash、12插件/29模块；包内frontend shell、renderer client、module-loader client与p0-bundle02-independent.md三hash一致。记录实际大小/文件数，不要求路径集合仍与缺包的旧候选相同。

执行者完成一次真实运行后冻结候选/验证器/结果并交回。主控审diff/证据，再由独立者复制同一脚本至独立run实跑一次；最终结论绑定实际hash。只限macOS arm64打包sidecar，未覆盖完整Finder窗口、Windows、全新机、校园网、模型调用。用户内核路线/remote决定仍单列，不将本票PASS作为P0全部放行。


## 结果：返修 / CHANGES REQUIRED

构建exit0，ASAR 2c02c63bdc6fdcf1c4ffe5395e09d1d67d35018753fe114259fa3279771a71a4；真实新home运行ready前失败。目录20260906T180342Z-bundle-03，verifier 32af7d4efeec6e775d62ef63fd207841dbadaba8b769a2c7c5966ee7f50ce65c。第一批报错包括llm/session/subprocess；已确认builder把其部分依赖置于dsh子目录，root新peer模块无法解析。输入hash、symlink、临时根及profile生成通过不掩盖启动失败。停止重建，交PEERS02；不重复独立运行失败候选。
