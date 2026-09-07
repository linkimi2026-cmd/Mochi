# MOCHI-P0-DEPS-01 · 普通运行依赖纳入目标检查

状态：已验收 / PASS（目标图契约，BUNDLE05另验真实启动）。P0，唯一实现者p0_packaging_audit / terra-max；root审计不编码。方案§6既有dsh/Electron，§45包内mochi-web能启动。HEAD b64776394e94ac5300ed42da64f8d592a1b53cbb加PEERS02固定差异；保护所有用户编辑。

目标：解决BUNDLE04已证实的api-gateway普通依赖deque不可见，并在构建前检查完整普通运行依赖图。当前生产517目标，DeepSeek普通434条中仅该一条失败，865 peer通过；所有普通边扣除类型/optional后1047条均标准semver。不是仅追第一报错；不用223包全声明根，因为完整图只有该运行缺项。复用最新reuse-audit、builder25.1.8实际file sets和Node22 findPackageJSON，不换内核/构建器/运行解析器。

允许改四文件：apps/desktop/package.json（仅新增@deepseek-ai/dsh-deque精确0.1.2-rc.1）、package-lock.json相应根声明，以及scripts/check-dsh-host-peers.cjs、scripts/test-dsh-host-peers.mjs。保留现有文件/入口以避免无必要重命名，但注释/输出明确已覆盖普通依赖。其他生产脚本、配置、已验收staging/profile、adapter、React和用户UI禁止改。你不是唯一工作者，不回滚他人编辑。标准npm锁更新临时副本显式cwd+断言；无包路径/版本/resolved/integrity漂移，不重装真实node_modules。

检查范围在实施前扩大：所有选中目标包的全部命名空间普通dependencies，加现有非optional DeepSeek peer；普通dependencies被optionalDependencies覆盖时按npm optional处理，optional不要求异平台安装。@types/按当前固定builder明确排除的类型声明语义单列计数/说明；主控已核实际三类型包空main/types，JS无导入证据，不因此排除普通JS依赖。非DeepSeek peer仍保留既有React静态browser链范围，不宣称全部第三方peer/所有JS入口执行通过。

使用标准Node22 node:module.findPackageJSON(bareSpecifier,baseURL)定位manifest，处理不export ./package.json的普通包；realpath规范化，须位于本临时投影且属于实际selected manifest集合。沿用真实builderfileSets/getDestinationPath和asarUnpack，不按source去重；不自造resolver/copy framework。标准semver判断；若未来有非semver spec应明确返回未支持/需审查，不静默略过。

验收：实际517目标全体普通运行依赖+DeepSeek peer检查通过；旧BUNDLE04模式的普通dependency仅在兄弟nested目标时失败、根提供时通过；至少一个非DeepSeek普通依赖缺失也失败；不export package.json的包可由标准API正确查清单。保留旧peer/optional/alpha/selected边界。@types例外按既有builder语义显示，不掩盖普通运行依赖。

Node22新测试与受影响installer/package-resources/runtime-profile/release-input回归通过；checker新增计数与分类真实可读。原adapter7734256d6e14849f21d7dee2c00dcaee7224597be6bd9b3c7ad462db4d4eb3c2和packager55cbb178456ccde00c64726369e0962702f6309ce6d675a4d3b692dec15cda71保持。交差异/命令/结果/冻结hash，不写长报告或额外审计框架；主控再用旧BUNDLE04实际manifest独立阴性复现。未审定前不得BUNDLE05，不重跑BUNDLE04。新问题返回定位，不能降断言、增白名单或越界修码。

维护影响：比PEERS02只增一个锁内宿主项，检查使用Node22.14+标准API（实际22.22.1/22.22.2已可用）；当前内核要求Node22，未来构建器/API升级须审此固定内部fileSets适配。用户内核路线/remote及真实Win10/校园网仍待决定/实测，不宣称P0放行。

完整审计与冻结hash见artifacts/architect-audit/p0-deps01-independent.md。
