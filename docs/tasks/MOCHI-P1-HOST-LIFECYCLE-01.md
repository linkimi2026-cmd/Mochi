# MOCHI-P1-HOST-LIFECYCLE-01

状态：待执行；P1，Lagrange / terra-max 唯一实现者。须在当前 UI01 冻结、bridge 最小验证安排清楚后顺序开始，不能与其他人写同一文件。

目标与依据：总体方案§21/23要求Finder双击可运行、sidecar崩溃自动重启与健康检查。当前root亲读web-host.ts:94仍使用process.cwd()；main.ts只await start()，没有消费就绪后的exit事件。现有STARTUP01只证明初始失败重试、URL恢复和单实例，不覆盖这两项。

复用：沿用docs/reuse-audit.md及UI01中已验证Electron39.8.10与既有DshWebHost机制。无需引入进程管理框架；实施前核当前退出/停止/重试语义，已有成熟行为不得重写。长期维护限制为单一宿主生命周期，不新造第二套状态管理或无限重启器。

允许：apps/desktop/electron/main.ts、electron/dsh/web-host.ts及必要生命周期/既有回归测试。配置默认解析归Maxwell，暂不得与其写web-host.ts并行；开工前确认顺序。禁止renderer/preload/sidebar、真实HOME、依赖/锁/profile及已验doctor模块修改。

行为边界：sidecar工作目录使用应用受管可写目录，不继承Finder或任意调用方cwd；只针对当前host就绪后的意外退出进行有界自动恢复，一次自动恢复再失败则中文诊断与手动重试，不能在主动退出/停止时重启。清除失效readyURL，等待旧进程真正结束后才起新host；无主窗口时也保持正确状态，重新打开可恢复。新host须重新通过实际ready/页面健康路径，不能沿用旧URL直接宣布成功。拒绝无限循环、并发host、关闭应用后存活子进程和凭据日志。

验收：真实Electron/可控loopback子进程模拟就绪后退出→恰好一个新host→新URL正常；连续失败停止自动循环并显示诊断；主动退出不重启；任意cwd运行时子进程cwd为受管目录且外部目录不产生DSH状态。保留已验初始retry/单实例/医生功能，仅跑受影响回归。交源码diff、固定hash、测试命令/证据、残留进程/端口清理结果。root独立复核后集成，不据本机模拟声称Windows/现场验证。
