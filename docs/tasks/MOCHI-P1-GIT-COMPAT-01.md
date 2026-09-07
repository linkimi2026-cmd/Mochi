# MOCHI-P1-GIT-COMPAT-01

P1，Maxwell / terra-max，仅外部有界兼容验证；用户UI、原sidebar源码/依赖/锁均不改。目标是判断总体方案§24指定isomorphic-git能否在保留当前sidebar后端契约下去除系统git，不以删除功能制造通过。

已核：src/git.ts约20个公开动作，包括repo/worktree发现、status/diff/stage/unstage/commit/checkout/log/show/discard/revert/cherryPick；现有真实spawn('git')。原src/index.ts的session cwd/repoRoot授权边界保持。docs/p1-existing-file-workflows.md给链路。

复用已执行完整GitHub Desktop/dugite/nodegit生态检索，后查isomorphic-git；固定候选发布版1.41.9，gitHead89d641a761b56a492270933608df78edd7c9ee33，MIT/Node>=14.17，与Node22兼容仅版本约束层面。完整来源/SRI/已读API exports见docs/reuse-audit。候选有cherryPick等，无revert/worktree顶层命令，不能据此断言绝对不支持；先读固定公开API及实现。

允许：外部新临时package/标准npm11.6安装固定候选，必要纯JS差分fixture；原已验alpha/原NMs不动。使用合成临时repo/用户身份，测试准备可用系统git造fixture和对照，但被测候选操作时不得回退spawn/system git。不得读取真实全局gitconfig、用户文件/凭据、网络remote或推送。

优先验证三个维护风险：linked worktree共同对象库/独立index与HEAD；revert/cherryPick冲突语义；现有user.name/email来源能否在fake HOME下保持，空配置应受控报错而非虚构身份。给全导出API映射，基本status/stage/commit/checkout/diff可做一条合成正常链，不穷举边角。禁止自行实现整个Git算法/宽泛文件复制/绕repoRoot校验。

交付短结论：现成功能哪些已实测可复用、哪些需薄适配、哪些实测不支持/需架构决策；绑定固定输入和真实命令/结果。若不能保持当前功能，应指出维护成本和可审阅替代（如bundled git）供root/用户决定，不能无声放宽纯JS需求。暂无生产实施授权，不写长报告、不反复安装。
