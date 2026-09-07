# MOCHI-P0-PEERS-01 · 宿主必需 peer 声明

状态：返修 / CHANGES REQUIRED（历史源码检查通过，但BUNDLE03揭示目标布局盲区；PEERS02接续）。P0；唯一实现者 p0_packaging_audit / terra-max。方案§6保留dsh/Electron、§45打包profile真实启动。HEAD b64776394e94ac5300ed42da64f8d592a1b53cbb + ASAR01冻结差异；已有用户修改不得覆盖。

已确认：BUNDLE02的js-yaml物理路径通过，但dsh-app-boot必需peer cordis-plugin-group不在builder选中图里，ready前exit1。当前collector只走普通/可选依赖。完整分析发现一类peer遗漏，不能只补首个报错包。复用docs/reuse-audit.md最新peer章节：使用标准宿主dependencies，维持builder25.1.8/Electron39.8.10/dsh0.1.2-rc.1；新版builder并无本次已验证修复，故不盲升、不重写依赖收集器。

允许修改：apps/desktop/package.json中明确提供必需peer的dependencies及相应测试命令；apps/desktop/package-lock.json对应根声明/peer或optional分类元数据；scripts/package-desktop.cjs中的最小打包前检查接线；scripts/check-dsh-host-peers.cjs、scripts/test-dsh-host-peers.mjs（或在现有installer测试中实现同等有意义检查）；本票审计证据目录。已验收files/asarUnpack/extraResources、runtime-profile、staging脚本、dsh安装JS和其他用户源码禁止修改。不是唯一工作者，不回滚他人编辑。

依赖清单以主控随后确认的只读结果为准，均须来自现有锁的确切版本/来源/完整性；不更改任何已有包版本、resolved或integrity。锁更新先在独立临时manifest/lock副本使用标准npm且ignore-scripts，不触碰当前node_modules；如缓存不足、需要拉取新版本或出现无关锁差异，返回定位，不降级peer校验或整体重装。核对完整diff再集成锁。

打包前检查：复用当前实际builder依赖图与标准package manifest，确认生产可达图中的DeepSeek命名空间必需peer在所选图可解析且版本满足；本票检查明确命名为dsh-host-peers，不宣称所有第三方peer已闭合；仅检查生产可达图，不把开发包的peer误加入运行包。普通/可选平台依赖按原语义处理，不要求安装其他平台native包。出错给出具体importer/peer并使打包在构建前失败。此处是契约检查，不新增Node resolver、复制器或第二份手工白名单。

验收：正常宿主DeepSeek必需peer闭包检查通过；受控fixture删必需peer时明确失败，缺非当前平台optional native不误报；构建器真实选中group及其余必需peer，代表dev包仍排除。Node22下新检查及受影响installer/package/runtime-profile/release-input回归通过；原adapter SHA7734256d6e14849f21d7dee2c00dcaee7224597be6bd9b3c7ad462db4d4eb3c2不变。交付真实diff、版本/命令/清单/阴性证据与固定hash，由主控独立审计后才授权BUNDLE03。

长期维护：宿主明确承担现用内核peer契约，未来内核升级须同步审核这些版本并通过闭包检查。本票不裁定用户尚未回复的rc固化/alpha迁移路线，不等于干净安装完整基线或P0放行。


## 审定清单与非本票风险

只读实测builder493个复制节点缺25个非optional peer；其中本票处理24个DeepSeek包。精确新增 `@deepseek-ai/cordis-plugin-group: 1.0.2`；以下均 `@deepseek-ai/` 前缀、精确版本 `0.1.2-rc.1`：

dsh-anonymous-user-id, dsh-attachment, dsh-authorization, dsh-bash-local, dsh-code-runtime, dsh-compaction, dsh-fs, dsh-hook-protocol, dsh-jobs, dsh-output-retention, dsh-sandbox, dsh-sdk-protocol, dsh-session-persistence, dsh-session-query, dsh-session-telemetry, dsh-session-title-llm, dsh-settings, dsh-shell, dsh-spill, dsh-subagent-in-process-driver, dsh-util-time, dsh-util-workspace-path, dsh-workflow。

另一个缺项是dsh-client-ui-renderer的use-sync-external-store1.2.0所需嵌套React18.3.1；宿主根React19不能直接满足其范围。主控与p0_baseline_inventory正在只读核对官方预构建client是否实际消费该物理包，未声明无风险，也没有已观察UI失败。本票不改React、UI或静默把它计为已闭合。DeepSeek命名空间检查的PASS只覆盖本票范围；总体打包可用结论仍取决于真实BUNDLE03和该风险的后续审查。此范围在实现前明确，不能在测试失败后通过删断言扩大PASS。


主控最终审计与冻结hash见artifacts/architect-audit/p0-peers-independent.md。亲跑Node22新测试/installer通过；执行者Node22 package-resources/runtime-profile/release-input回归通过，冻结source/profile/adapter保持原hash。已授权BUNDLE03。test当前实际hash340523df67ce1c660be6feeafce767bce5174f5b7dab0cc78d957f9610a9ae41经主控两次读取与复跑核实；执行者消息曾报不同hash，要求以绝对路径实际磁盘再核，不采信未对应当前文件的值。


## BUNDLE03后续审计：返修 / CHANGES REQUIRED

历史源码测试PASS不撤写，但检查遗漏builder目标目录重排，集成未通过。BUNDLE03 root sandbox/shell无法解析dsh子目录内llm/subprocess。后续MOCHI-P0-PEERS-02修正完整宿主声明与目标布局检查；不得把原source-membership检查继续作为打包可解析证明。
