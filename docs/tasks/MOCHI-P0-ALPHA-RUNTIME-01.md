# MOCHI-P0-ALPHA-RUNTIME-01

P0 §6固定alpha源码分发输入；唯一实现者 p0_cold_start / terra-max，root独立审计。状态待执行。DEPLOY01–03证据冻结，本票不重试pnpm deploy。

目标：用已验来源的官方release tarball和标准npm依赖声明，建立可独立搬移的CLI运行树及consumer lock，作为后续profile/桌面集成候选。保留dsh/官方SPA/Electron/runtime-profile入口，不改生产。

复用：reuse-audit中的固定d347e7039官方MIT源码、257个pack与NPM03已实测包含optional消费者、固定npm11.6.0/Node22.22.2；沿用官方verify-packed-install的file tarball根dependencies机制。DEPLOY03 exit0却111链接外逃，不采用手补链接。root实际只读遍历257个tgz manifest：以@deepseek-ai/dsh为根，递归包内dependencies+optionalDependencies+非optional peers，在这257内有228个family包，排除29个；client-test-runtime/session-snapshot均不在闭包。此为包选择图，不替代npm真实依赖解析。第三方46个名字继续由npm解析，安装lock记录确切版本，不假称与源码pnpm-lock完全同一第三方图。

已查npm官方生态overrides相关GitHub源码/问题，file/workspace/peer有适用差异；不引入override替换所有边、不放宽peer、不自写运行resolver。选择标准根dependencies与已成功官方consumer同机制，区别仅按CLI运行图选择family集合并保留输出。

允许写：自己新唯一外部consumer/home/cache/tmp与artifacts/architect-audit/alpha-runtime/<timestamp>/中的生成/检查harness、命令/日志/结果。原257tarballs及BUILD01 source只读；不改项目插件/锁/资源/desktop/共享docs/真实home。你不是唯一工作者，不覆盖其他Agent文件。不安装/升级工具、重新pack/build或读真实凭据。

执行：先核同257已记录sha，精确复用之前NPM03的隔离npm11.6.0工具和Node22；不要猜路径，读既有证据。生成明确的private consumer package.json：dependencies只含CLI运行闭包228个family name→既有file tgz（独立重算并校验所有必需family边的tarball版本满足range，保留标准prerelease语义），没有dev根/overrides/自定义postinstall。遇数量或范围差异先回报，不硬凑228。可复用NPM03公开npm cache，HOME/DSH_HOME/TMP独立env-i。

一次标准npm install，包含optional且omit dev，保留生命周期与peer校验，保留生成package-lock；不要--force/legacy-peer-deps/ignore-scripts。安装失败保存首个原因即停止，不重装换参数。需要网络registry/headers真实记录，不称离线。不能访问模型/校园/其他外部业务服务。

成功后先复制整个consumer到另一新外部路径，普通copy保留symlink、禁止hardlink原树。核所有symlink目标在搬移树内、无悬空；核无rc family、所有已选源包版本/来源；统计实际包数/体积/第三方版本差异，确认Web静态资产真实owner路径及BUILD01对应hash。未通过闭包不能以可访问原source时CLI成功冒充便携。

闭包通过后新env-i HOME普通Node22运行搬移node_modules/@deepseek-ai/dsh/lib/bin.js --version，预期0.1.3-alpha.1；可在真实owner上下文导入koffi/fs-ext作原生加载记录。不要Electron/profile/GUI/Windows或额外完整测试。root后续独立验收实际运行器。

交付短报告、精确可复跑命令/工具hash/exits、closure选择列表及排除理由、原tgz不变、consumer锁hash/实际输出路径/搬移闭包与CLI。CLI不是整体Mochi PASS。长命令即给句柄；先完成验证再报告，遇越界返回root，不自行扩展。

## 主控验收：PASS（普通Node便携CLI范围）

真实install session20408 exit0，37s；搬移到mochi-alpha-runtime01-moved.U93Wow/consumer，root独立扫描11symlink全部内部、220dsh全部alpha。root独立新env-i HOME Node22.22.2 CLI输出alpha且koffi/fs-ext加载成功，证据alpha-runtime/independent-runtime01。执行者228源包身份/lock/sourcehash与Webindex验证通过；生成lock SHA a2ff64b522f80d423a1eb36753de30f211ae2188b4f19a3ba4836fdd250fdb9f。相对源码lock有73第三方名字版本差异，另3名字未在比较索引，详细记录不掩盖，不称同源码完整依赖图。

root额外Electron39.8.10 CLI通过，但fs-ext ABI127/140加载失败；不能据本票放行desktop。后续ALPHA-NATIVE01仅新副本标准rebuild，原Node树保持冻结。source reasoning兼容改动另票，当前源包未包含该未来patch。
