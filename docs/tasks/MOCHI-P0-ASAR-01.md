# MOCHI-P0-ASAR-01 · 包内物理依赖树

阶段P0；配置与测试窄范围已验收，真实包启动待BUNDLE02；实现负责人p0_packaging_audit/terra-max。BUNDLE01 actual启动CHANGES REQUIRED，失败日志及候选hash保留。对应方案§6 sidecar+官方SPA/Electron、§45打包profile启动。

确认根因：候选的物理app.asar.unpacked/node_modules/.../dsh-app-boot导入js-yaml失败。js-yaml实际上存在app.asar/node_modules（主控header检查unpacked=false），与物理importer不在同一父级搜索树；向extraResources/mochi/plugins/node_modules补js-yaml不是正确查找位置。

先读docs/reuse-audit.md本票。采用builder25.1.8现有asarUnpack完整生产node_modules/**/*，保留其他已验收files/extraResources/profile与lock。这是依赖物理位置配置，不扩选入开发依赖，不修改内核、不新写resolver、不加NODE_PATH指向开发树。

唯一可改apps/desktop/package.json的build.asarUnpack、scripts/test-installer-config.mjs的相关真实unpack matcher回归、packaged-profile审计脚本/报告。禁止改两份资源staging脚本、runtime配置、lock、dsh源码/安装JS、用户状态和旧dist.app。备份.architect-baselines.nosync/asar-20260906T170337Z。不是唯一工作者，不覆盖他人。

验收：现有生产node_modules的js-yaml/argparse、nested dsh模块、native node-pty/sharp/@img代表路径由真实builder unpack matcher纳入；dist-electron主进程仍留ASAR且旧dist不入包；不只检查字符串。原来的node-pty/sharp正则断言可改为真实matcher语义，不能降低native必须物理存在的要求。installer/runtime-profile/package-resources/release-input相关回归通过后冻结交主控。

然后主控授权复建BUNDLE02：保留本轮生成的失败候选（可移到release/failed-bundle-01-时间戳，绝不动更早dist.app），从已核官方zip隔离缓存离线重建同架构，源码/lock/hash变更限本票。真实ASAR header/物理树检查js-yaml和argparse及native必需项；对比包文件数/体积，确认生产依赖集合没有夹带dev包（代表electron-builder/tsc不入包）。新run目录不覆盖BUNDLE01结果；复用已审测量流程，工作区外副本/新home/deny真实用户home、工作区与出站，包内profile→ready→真实HTTP→进程/端口/tmp清理。失败立即给事实，不用开发依赖或吞错救活；主控独立审计后才PASS。

主控复审：首版测试硬依赖当前mac-arm64 native文件及已生成main，已退回改为临时fixture，保留真实builder matcher与native覆盖。最终diff亲审、Node22.22.2 installer测试亲跑PASS；执行者Node24相关回归PASS。冻结package SHA256 4ca5550129d8a670c732b433520e8cfbdf1baadd296f21c653a226dc2739c155，test SHA256 4fce9f639b6a8c358e2d409cc17950200e01f1d7e31839549e1a430b5051238e；lock保持535a52d530097e809220720a92005bd604d00ff1bbf6476fd5a405cdb85c19e8。已授权BUNDLE02离线重建，不能据matcher结果声称实际App已恢复。
