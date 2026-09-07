# MOCHI-P0-PACKLIST-01 · 排除旧安装包输入

阶段P0；已验收/PASS（限打包输入过滤）；负责人p0_packaging_audit/terra-max。BUNDLE01恢复执行。

依据总体方案§6官方SPA嵌Electron、§45打包白名单。主控调用实际builder25.1.8的getMainFileMatchers证实：当前build.files的dist/**/*会纳入旧dist/mac-arm64/Mochi.app的Info.plist和app.asar。旧dist713MB；当前npm build只tsc，main.ts只loadURL sidecar。预期新候选不打包旧App及旧renderer，旧磁盘文件保留。

复用：先读docs/reuse-audit.md本票与PACKAGE01。现有builder配置能解决，无需自建过滤器。最小修复移除build.files中的dist/**/*；保留dist-electron/package.json、依赖、extraResources、release输出不变。

唯一允许改apps/desktop/package.json的build.files、apps/desktop/scripts/test-installer-config.mjs的相关回归，以及artifacts/architect-audit/p0-packlist-fix.md。禁止更改依赖/scripts/lock、runtime源文件、原App、校园项目及其他Agent文件。不止你在工作，勿覆盖他人。备份位于.architect-baselines.nosync/packlist-20260906T163128Z/。

验收：真实builder matcher对旧App代表路径=false，dist-electron/main.js/package.json=true；测试应在干净checkout也可运行，用临时fixture及真实matcher而非仅数组等式。既有installer-config/package-resource/release-input回归仍PASS。主控审diff与实际matcher再放回BUNDLE01。交付变更hash/精确命令/结果/未测范围。不得移动旧产物或临时改CLI过滤来掩盖持久配置缺陷。

独立验收2026-09-07：主控确认package.json相较本票备份只移除一个dist glob，测试diff为实际builder matcher临时fixture；亲跑Node22 installer-config PASS，另用真实工作区四条路径独立复核false/false/true/true。实现者Node22/24 package-resource/release-input亦PASS。冻结package SHA8523e1bed4fadf68b5783d4658b73d9580242de303c3c78245c5ae05e170a3ea，test SHA15e15e30f6ba6a0ae7f021b085ebe698025ecd61e1612277e1f4a96982fb0ca5。候选包尚待实际构建，不扩大此PASS。
