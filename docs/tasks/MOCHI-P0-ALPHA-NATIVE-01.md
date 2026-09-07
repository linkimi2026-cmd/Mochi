# MOCHI-P0-ALPHA-NATIVE-01

P0 §6 alpha桌面运行器前置；唯一执行者p0_cold_start/terra-max；root独立验收。状态待执行。RUNTIME01原consumer与moved树冻结，不覆盖普通Node验收。

目标：对新副本的fs-ext应用现有标准Electron native rebuild，验证实际Electron39.8.10/arm64的文件锁功能，为后续Mochi profile启动排除已证实ABI断链。不是更换Electron、Node或分发架构。

依据：root独立新HOME实测CLI在Node22.22.2/Electron39.8.10都输出alpha，koffi均可加载；fs-ext仅普通Node成功，在Electron下ERR_DLOPEN_FAILED，明确ABI127→140。原native证据在alpha-runtime/independent-runtime01。固定源session-persistence-jsonl/src/lease.ts:34顶层导入fs-ext，是真实POSIX session文件锁依赖。另独立require node-pty/sharp/node-addon-require-builtin在Electron成功（不等于功能全验），故本票只修已证实fs-ext。

复用：现有electron-builder25.1.8的util/yarn.js:164-175调用@electron/rebuild；已安装固定@electron/rebuild3.6.1，MIT、Node>=12.13兼容22。root实测其node-abi.getAbi(39.8.10,electron)=140，公开类型含onlyModules/buildFromSource。GitHub electron/rebuild及Electron官方native modules docs支持标准ABI重建；固定工具实际接口为准，不用搜索main当适配证明。

唯一写范围：新外部完整consumer副本、新HOME/cache/TMP及artifacts/architect-audit/alpha-native/<timestamp>/harness/日志。副本来自RUNTIME01已闭包moved consumer，普通copy保留链接，无-H/link-dest或源hardlink；核新树链接内部、关键native文件不同inode。锁/package.json/非目标产物不应改变，记录前后。原RUNTIME树、原source/tarballs、desktop/build/用户home全部冻结；你不是唯一工作者，不写Lagrange新source或共享docs。

先核实际工具版本/ABI/CLI或public API参数，使用普通Node22调用既有@electron/rebuild3.6.1，buildPath仅新consumer，electronVersion39.8.10，platform darwin/arch arm64，onlyModules=['fs-ext']，标准源码重建。允许工具按官方地址下载相应headers及必要缓存，不换镜像、不装新版本/补丁工具/忽略校验；不全量rebuild其他模块，不npm install/更新锁。若默认缓存会写用户home，改独立env-i HOME/XDG/TMP。一次重建失败即停并报告具体错误，不升级/改依赖/强行ABI override。

重建成功后用实际已验桌面候选的Mochi二进制ELECTRON_RUN_AS_NODE=1运行新副本harness：确认versions.electron39.8.10/modules140；从真实session-persistence-jsonl owner解析fs-ext并加载。用自己新临时文件的两个独立fd验证flock独占锁、第二个非阻塞申请被拒绝、释放后第二个成功，最后解锁/关闭/删除，不能只断言require成功。此为本机POSIX锁验证，不代替Windows。

同一Electron运行器CLI --version仍alpha；koffi加载保留；重建后完整symlink闭包/锁hash不变、仅fs-ext相关构建产物允许变化。不要将该副本当普通Node仍兼容的产物，两个ABI目标分开。不给生产替换、P1、全profile/GUI、模型联网授权。原文件锁失败仍保留。

交付：真实command/exits/句柄、重建前后nativehash、全部修改路径摘要、consumer/lockhash、文件锁功能结果与清理、可复跑harness。root会独立复跑后决定下一集成步骤。遇范围外问题返回root，不自行加包或patch。

## 重建产物审查补充授权

唯一rebuild exit0，fs-ext实际ABI140文件生成；root独立新HOME flock已实测通过，但后快照发现构建工具链接外逃，不能据功能PASS豁免闭包。原失败快照保留。

允许将固定rebuild生成的 fs-ext/bin/darwin-arm64-140/fs-ext.node 及目录按固定工具源码依据列为目标构建产物（原“仅build/”检查分类过窄），不能豁免其他非目标改动。另允许仅删除此次新生成 fs-ext/build/node_gyp_bins/python3 链接本身及空的node_gyp_bins目录：先lstat与快照证明其为新生成symlink，核raw target确为记录的CLT Python，不dereference、不修改/删除/复制CLT目标。清理必须写入精确可复跑命令或postbuild脚本，不能依赖手工记忆；不是修补运行依赖链接。

不再次rebuild。清理后复核完整闭包、改动分类、package/lock不变，再做执行者Electron文件锁/CLI验证。其他文件或非预期目标须返回root。后续生产包装仍需显式保留这一步或等效文件选择，当前未集成生产。

### 主控独立验收 · 2026-09-07

状态已验收，PASS 限本机 macOS arm64 / Electron 39.8.10 候选副本。root 亲读精确 helper 清理代码与原失败/清理后/测试后快照；清理只 unlink 新增链接自身和空目录。另独立遍历实际树得到 11 个内部 symlink、0 外逃/悬空，package-lock SHA a2ff64b522f80d423a1eb36753de30f211ae2188b4f19a3ba4836fdd250fdb9f 未变；native SHA bc83a24cfb6c472d9e337d78c2b15b519a4677601ed36f710e7a9e1b2be6631b 与此前 root 独立实际 Electron flock PASS 绑定一致，harness SHA ea007e79a2aeda55f2150934c4161e21e9a8fbc25ec48cce71a98699f92db84b 前后相同，无需为删构建 helper 重复锁测试。

证据：alpha-native/20260906T214431Z-native01/REPORT.md 与 alpha-native/independent-native01/post-cleanup-closure.json、flock-result.json、exit.txt。源码/原 Node consumer/desktop 未集成；不能据此宣称 profile/Windows/P0 完成。
