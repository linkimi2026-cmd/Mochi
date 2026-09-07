# MOCHI-P1-TRAY-01

P1，待顺序派发。实现者terra-max，主进程接线唯一owner待生命周期冻结后指定。

目标：总体方案§25和原生化方案§7要求托盘常驻，菜单“打开 / 重启内核 / 退出”，Windows关闭主窗口隐藏到托盘，macOS关闭主窗口不退出且可恢复。单实例已有，不重复实现。图标专项不阻塞，不重新绘制品牌形象。

复用：沿用STARTUP/UI01完整Electron应用/框架搜索及固定Electron39.8.10/MIT。root核已安装electron.d.ts存在app.getFileIcon、Tray、setContextMenu/setToolTip；这些仅证明API存在，实际托盘功能仍要真实Electron验证。采用内置Tray/Menu/nativeImage与现有bundle图标，禁止引新托盘框架。若暂无品牌托盘资产，使用应用已有可识别图标作为暂用；不得用空图标导致Windows无法找回窗口。只读核实际可用资产后选择。

允许最小新原生tray模块与必要测试。接口用打开/重启/退出回调，不新造host实例或生命周期。主进程接线须在LIFECYCLE01冻结后顺序实施：打开复用现有focusOrRestoreMainWindow，重启经现有stop Promise结束旧host后起新host，退出复用已验quit清理；禁止renderer/preload/sidebar/profile/锁/NMs改动。你不是独自修改仓库，不回退他人变更。

实际行为：托盘强引用维持生命周期，重复初始化不产生多个；菜单打开可恢复隐藏/关闭主窗；重启中防连点并发；应用主动退出能关闭窗口且销毁托盘，不被关闭拦截困住。托盘初始化失败应保留可退出/可见窗口，不能把用户关到没有恢复入口的后台。

验收：真实Electron托盘创建/菜单回调、图像非空、打开恢复/一次受控重启/退出销毁；Windows关闭隐藏语义需可控平台逻辑验证并明确本机未作Win真机测试。保留单实例/生命周期回归，不跑与之无关全包。交固定差异/hash/证据，后续与医生/profile一次整合打包。

## 主进程集成阶段（2026-09-07）

模块已独立验收，主进程阶段执行者 Lagrange / terra-max。main 当前基线 c476bbb4009bbaa03a740c5501133a5fc60bcce5df54cff6f453d962af0a7a02，web-host 5209c22e7068ec3d184428d72658981222414ede3af72ee5961c2411e9808006；保留已验 SERVICE-WIRING01。允许 main.ts 与本票必要主进程测试，确需修改 web-host.ts 时仅限既有生命周期衔接；tray.ts 冻结，模块接口问题先回报。禁止其他共享模块与锁修改。

采用已验内置 Tray 模块和 app.getFileIcon(process.execPath) 非空当前应用图标，异步获取不能阻挡首窗；await 后检查退出状态，不能退出后又创建托盘。打开复用 focusOrRestoreMainWindow。重启复用现有单 host 的 stop Promise，旧子进程真正结束再启动；清除旧 ready URL，明确抑制这次主动停止触发自动恢复，手动重启重置恢复预算。连点、初始启动中重启、重试中重启不能产生双 host。不得以现有 retryStartup 直接替代健康 host 重启（其 webHost 非空时直接返回）。

所有退出入口销毁托盘并沿用 before-quit 等待子进程清理。Windows 关闭仅在托盘确实存在且非退出时隐藏；图标创建失败保留可见/可退出路径。macOS 保留关闭后恢复。真实 Electron 集成验收：菜单打开恢复、健康 host 重启产生新 ready URL 且旧 PID 消失、退出清理，以及受控 Windows 分支语义（明确不是 Win 实机）。适当复用现有生命周期与单实例测试，不重复全量打包；交付差异、哈希、简短证据。
