# MOCHI-P1-DESKTOP-INTEGRATION-02

P1。Halley / terra-max 为打包与 desktop package/lock 唯一 owner。root 审计，其他执行者分别写 main 与 Doctor 模块；不得回退其变更。目标是把已经独立通过的新 Doctor、生命周期、默认服务配置与托盘整合到 alpha 目录 App，不把旧 STARTUP01 包当最新版。方案§22–25/45，保留官方 SPA/用户 UI/profile 架构。

复用同一固定 d347 alpha 230 family + 12 local tarball、Electron39.8.10/builder25.1.8/npm11.6、已有官方资源脚本与 native rebuild。完整生态来源/许可证/兼容实测见 docs/reuse-audit.md、ALPHA-INTEGRATION01 证据，不换构建系统、不重新检索已选同一依赖、不重复解决已验问题。

阶段 A 现在执行：核验现有外部集成树 /private/tmp/mochi-alpha-integration01.pRu0Ap/workspace 的 package/lock/NM/native 与旧证据；禁止重装原仓库 NMs。将已冻结 plugins/mochi-hello 通过标准 npm pack 生成仅 index/doctor/package 三文件的 tgz，用内容 hash 文件名，更新 desktop file 来源并用固定 npm11.6 正常生成锁（不手改 integrity，先在外部进行）。新 import @deepseek-ai/dsh-llm 须核现有依赖闭包可见；不能只因包名在根就声称打包通过。原其他242包来源/版本不可无故变化。

允许原 vendor/local-plugins 新内容寻址 hello tgz、apps/desktop/package.json/package-lock.json 与本票证据，提升前检查这两个文件相对当前基线0冲突。保留原老 tgz/旧 alpha App；不改 profile、main、doctor、生产插件、renderer/preload/sidebar、原 NMs。若标准 npm 安装会改变别的依赖/native，先读取差异定位，不用 force/legacy-peer-deps/删除检查掩盖。

阶段 B 待 root 明确模块全部冻结后执行：同步票内已经通过的最新源码/配置到外部集成树，按已有脚本 stage、build、checker、目录包。校园只读使用已验 release-input .mochi-release-staging.nosync，禁止从 campus其他dist或 联动计划取新源。使用已核 Electron cache，避免无意义重下载；如必需 native rebuild 沿用标准机制。最终 App 先外部输出，不覆盖旧稳定 App。

验收：打包白名单与运行依赖检查不放宽；真实最终 packaged Electron 新HOME/无源码依赖运行 mochi-web，主窗口就绪、Doctor菜单/本地检查、Tray重启和退出实际清理，模型外网不调用，可合成固定fixture辅助但不能冒充真实包挂载。保留无设备的 Win/classroom 待验，用户尚未确认的校园URL/首启/Git路线不写成完成。报告源输入hash、包hash、实际命令、失败与最终结果；root独立关键路径后才批准稳定新App提升。此票不提交/推送/发布。
