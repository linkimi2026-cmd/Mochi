# MOCHI-P0-BUNDLE-01 · 本机打包候选与 profile 实测

状态：返修/CHANGES REQUIRED；真实包外副本启动缺js-yaml物理路径，转MOCHI-P0-ASAR-01修复后以BUNDLE02复验。P0，不代表P1双击/全新机验收。

目标：从当前已审查资源脚本重新生成本机arm64候选.app，并用包内runtime/profile/plugins在全新临时home启动sidecar，证明不依赖工作区模块；旧.app不是本轮证据。

复用：docs/reuse-audit.md，保留electron-builder25.1.8/Electron39.8.10、既有package-desktop.cjs原生构建/发布never与静态输入审查。不换框架、不升级dsh（安装元数据0.1.2-rc.1与规划源码差异仍单列）。Max方式为现有terra-max角色。

允许：既有 `npm run build`、原生 `package-desktop.cjs --target mac --arch arm64 --dir` 构建动作；新生成的 apps/desktop/release、.mochi-release-staging.nosync、.mochi-package-resources-v1.nosync、dist-electron；你自己创建的临时隔离目录；artifacts/architect-audit/packaged-profile/证据。锁文件/源码不得改。构建需要的既有native rebuild属于生成动作，须记录及验证不能覆盖现有DSH JS补丁。

先核查产物路径：release与release-input此前不存在，仍需现场复核；旧staging存在，保留带时间戳的备份后再让既有受管生成器替换；旧dist/mac-arm64/Mochi.app绝不覆盖。不能为保持目录整洁删用户产物。

校园静态输入使用本项目已有 `campus.nosync/mochi-dist/client`（或已审核release-input），显式限定本地Mochi源码/静态路径，记录hash及dirty状态。不得去联动计划里执行构建或修改文件；禁止伪造静态fixture充当真实候选包。若必要输入缺失/有冲突，回传。

启动范围：只测试候选.app内Electron以run-as-Node承载物理unpacked dsh入口的packaged profile；使用包内生成器、skills、pluginRoot和全新DSH_HOME。不得设置指向开发node_modules/MOCHI_DSH_BIN的运行覆盖来伪装打包成功。sidecar限定loopback随机端口、--no-open，出站网络拒绝、无key/会话环境；控制器只做loopback HTTP就绪检查，不调用模型。旧用户服务不得停启，真实home不得读写。

验收：包integrity包含12插件/29runtime模块；完整profile可启动、HTML真实boot标记、退出后PID/端口/临时目录清理可证；保留真实日志脱敏、输入/输出hash、命令/版本/耗时。资源脚本、runtime配置、锁文件与关键已安装DSH JS输入校验构建前后无意外变更。失败不机械重试、不吞错、不改产物假装通过；主控定位再派修。

未测边界必须明确：这是macOS arm64打包sidecar，不是Finder双击完整App、Win10、U盘/全新机/校园网或真实模型交互。不能发布或推送，不办理签名，不创建remote。你不是唯一工作者，不覆盖其他Agent文件。

2026-09-07实际结果：离线构建完成（tsc/node-pty rebuild/builder通过），622MB候选。主控查ASAR无旧dist、main/manifest存在，integrity12/29与profile源hash吻合，独立包内CLI --version=0.1.2-rc.1。执行者将包复制到工作区外，包内Electron22.22.1/39.8.10与三profile生成通过，实际sidecar在ready前因ERR_MODULE_NOT_FOUND(js-yaml)退出1；pid/tmp已清、无强杀，无HTTP成功。失败证据固定于packaged-profile/20260906T164641Z-bundle-valid；后续不得覆盖或把构建成功当启动PASS。主控独立查js-yaml存在ASAR却不在物理unpacked树，修复见ASAR01。
