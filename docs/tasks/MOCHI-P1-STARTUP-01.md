# MOCHI-P1-STARTUP-01

执行中；用户已授权P0/P1并行。唯一实现者 Lagrange / terra-max；root 架构与独立审计。方案§21–23/25/45：双击立即有窗口，真实启动阶段、失败中文动作、单实例；保留官方SPA与用户Chat×Work。

已核main当前窗口show:false等sidecar后load；失败页无恢复动作；mac activate只建空窗；无单实例。web-host已有90秒超时。本票修这些真实缺口，不扩为全部医生/托盘。

复用：执行者已检索完整Chatbox/VSCode/API Demos生态并核版本许可，采用当前Electron39.8.10内置API，无新依赖。精确检索记录在artifacts/architect-audit/p1-startup-preflight，root审阅后合并reuse记录。

允许写main.ts与必要新test-startup-runtime.mjs。先保留当前main基线，不还原用户未提交行为。其他代理只读；alpha运行树另由Maxwell负责，待验收顺序集成。禁止renderer/Chat×Work/依赖/profile/web-host改动。

实现即时本地阶段页→readyURL；activate与second-instance复用就绪URL或当前阶段；单实例锁；失败重试先stop旧host且防并发；复制有限结构的脱敏诊断。私有重试/复制只由可信本地页触发，远程SPA不可借导航调用；不复制token/key/URL查询或原始内容。90秒机制和smoke保留。

验收：typecheck、相关现有web-host回归、新真实Electron启动/失败恢复/单实例关键证据；读取最终diff后root独立核关键路径。不重复已PASSalpha/native家族检查。发现超边界缺陷回报，常规实现选择自主完成。


## root验收

已验收/PASS。root独立现有tsc+真实Electron test-startup-runtime session2667 exit0；main d5178526419a89fedf6bee035d58df4043318dd534d282f46f737f179aad96bc，test d23abadffa74a667816973079bb93c1a6987f7359bab6ecf688ad7093be0c25d。亲读生命周期改动与测试，diffcheck通过。首次root调用因编译产物早于最终source受freshness guard拒绝，重新build后通过，非产品缺陷。已授权Maxwell顺序取用两文件构建alpha包。本票不等同完整医生/自动崩溃恢复/Windows验收。
