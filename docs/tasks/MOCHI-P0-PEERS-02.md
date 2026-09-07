# MOCHI-P0-PEERS-02 · 打包目标布局的必需 peer 契约

状态：已验收 / PASS（目标布局契约，BUNDLE04另验启动）。P0；唯一实现者 p0_packaging_audit / terra-max。主控负责审计。方案§6保留dsh/Electron，§45要求包内mochi-web能启动。基线HEAD b64776394e94ac5300ed42da64f8d592a1b53cbb，加PEERS01固定差异。目标是消除第三轮启动所揭示的依赖位置错误，避免教师安装后启动失败。

已确认：builder25.1.8将conflictDependency放到parent/node_modules，BUNDLE03根sandbox/shell找不到dsh下llm/subprocess；开发源目录的require.resolve不能证明目标可解析。完整生产图必需DeepSeek peer union84，现有24还需60，现有根lock均唯一且标准semver满足。复用结论见docs/reuse-audit.md的PEERS02：继续标准宿主声明，复用builder实际file sets、Node解析与semver；不升级或重写内核/收集器。

允许修改仅apps/desktop/package.json的新增60项精确dependencies、package-lock.json对应根声明/peer分类，scripts/check-dsh-host-peers.cjs和scripts/test-dsh-host-peers.mjs。现有package-desktop.cjs接线应保留且无需修改。生成临时隔离验证记录可写本票证据目录。其他生产代码、已验收打包配置/staging/profile、安装JS、React和用户UI全部禁止修改。不是唯一工作者，不回滚他人改动。

新增范围：五项@deepseek-ai/cordis4.0.2、cordis-plugin-loader1.0.3、cordis-plugin-include1.0.7、cordis-plugin-timer1.1.4、schemastery3.18.2；其余55项使用只读清单中的dsh0.1.2-rc.1。实现前读取全部60项现有manifest许可，若未审许可/来源或不兼容则先返回。不得新增包路径、变更任何锁版本/resolved/integrity。标准npm锁更新在临时副本，显式cwd并断言；确认diff后集成，禁止真实node_modules安装。

检查目标：使用当前builder实际产出的目标file sets映射，在工作区外临时目录只投影实际被选择的package manifests，逐个目标importer用标准Node require.resolve检查非optional DeepSeek peer与标准semver。实际目标位置不能按source目录去重；相同source被复制多位置仍须检查每个目标。解析结果必须属于本投影所选目标，不能从真实开发树、父级node_modules或全局路径补齐。临时目录清理须覆盖异常。只验证本票DeepSeek范围，不宣称全部第三方peer可用。复用真实builder规则，避免另写大型拷贝/解析框架。

必验：新实际collector目标布局全部通过；受控fixture的开发源可解析而peer仅在兄弟dsh的嵌套目标时必须失败（重现BUNDLE03）；同一manifest根级宿主提供时通过。保留必需缺失、optional缺失允许、标准alpha不满足rc范围等有意义阴性场景。确认采用实际builder映射而非测试重复手写规则。检查错误指出目标importer/peer；现有prepack接线仍在构建前阻断。

Node22运行新检查/测试及受影响installer、package-resources、runtime-profile、release-input回归。原adapter SHA7734256d6e14849f21d7dee2c00dcaee7224597be6bd9b3c7ad462db4d4eb3c2保持；包版本/来源/完整性无漂移。交真实diff、命令结果与冻结hash即可，不新增大型审计脚本。主控独立审定前禁止BUNDLE04或重跑BUNDLE03。若目标file set接入有困难或发现新的边界，返回只读证据，不降低检查要求。

本票不解决用户尚未决定的内核升级路线或remote，也不代替Win10/校园网实测。未来内核升级维护84项宿主契约，由此检查自动发现未提供/版本不兼容，不能沿用本次PASS。

主控独立证据、冻结hash、旧实际ASAR阴性、selected边界测试及Node22回归见artifacts/architect-audit/p0-peers02-independent.md。
