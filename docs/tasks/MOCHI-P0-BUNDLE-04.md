# MOCHI-P0-BUNDLE-04 · 目标布局修复后的实际包内启动

状态：返修 / CHANGES REQUIRED，构建成功但真实启动失败。P0；构建唯一执行者p0_packaging_audit / terra-max，非实现者p0_cold_start独立复验。方案§6、§45；保留dsh/Electron/官方SPA与runtime-profile入口。复用结论沿用reuse-audit.md PEERS02及前三轮固定来源审查，无新选型。

目标与验收：在工作区外全新HOME/DSH_HOME/cwd，实际包内Electron Node22/profile启动mochi-web，ready→同源HTTP200与__DSH_BOOT__→SIGTERM正常退出/PID消失/端口关闭/tmp清理，所有必需谓词通过。源码启动不能代替包内验证；本票不覆盖Finder完整窗口、Windows、全新机、校园网或模型调用。

授权后仅允许已有离线构建的生成目录与新run证据，不改生产代码/配置/锁/安装JS/验证器语义。可将第三轮当前release/mac-arm64候选移入新的failed-bundle-03时间戳目录；不动更早failed01/02、dist/mac-arm64、用户服务/真实home。官方Electron缓存digest已核；只用campus.nosync/mochi-dist/client静态输入。每条命令显式cwd/workdir并先核目录。

沿用第三轮冻结verifier（SHA32af7d4efeec6e775d62ef63fd207841dbadaba8b769a2c7c5966ee7f50ce65c），在同深度新run只改任务ID，保留完整隔离/复制hash/symlink/临时归属/HTTP与退出语义。构建一次、验证一次；失败立即保存回报，不重试或改断言。不要新建大型结构检查脚本。

结构核对最小充分项：全部已声明85个DeepSeek根依赖（dsh加84peer）实际目标manifest及版本，关键yaml/argparse/native物理存在；main在ASAR，旧dist与代表dev包排除，profile/12插件/29模块及三官方前端产物原hash。输入包/锁/检查/adapter与冻结一致，构建前后不漂移，旧失败证据和历史dist保持原hash。记录新ASARhash/实际文件数/大小，构建成功不代表启动成功。

实现者冻结候选与一次运行结果交回；主控审阅后才通知非实现者复制同一verifier到独立同深度run、对同一候选运行一次。双方实际产物hash/Node版本/隔离谓词/冷启动计时绑定证据，不预先写PASS。任何生产修复返回新票，root不接管编码。

冻结输入以p0-peers02-independent.md四项完整hash为准；除TASK_ID外verifier不改。


## 实际结果

一次离线构建exit0；ASAR2980e4254418063f7a15015e107a066d056daa9bd9a82dd645ac385b77e1999a；root亲核19334entries、85根DeepSeek manifest exactversion且unpacked物理字节一致，三前端产物hash一致，main/pty/yaml/argparse/排除项通过。一次真实verifier失败：ready前exit1，17228.879ms，dsh-api-gateway找不到普通dependency dsh-deque；包内deque仅在dsh/node_modules。前置/复制/临时清理通过不掩盖HTTP未就绪与未正常SIGTERM。证据packaged-profile/20260906T184511Z-bundle-04。

暂停再次构建，核查所有普通依赖与必需peer的真实目标关系、以及现有builder是否有标准保留布局方式；不得仅补deque单包或把peer检查继续当完整运行图证明。PEERS02原定peer范围通过，整体运行图检查不足，需扩展后续票。
