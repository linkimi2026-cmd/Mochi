# MOCHI-P0-ALPHA-RUNTIME-02

状态待执行，须 root 审阅 profile closure 准备报告并给出启动授权。P0 §6 固定 alpha 源码集成 / §45 profile 打包前提，唯一执行者 Maxwell / p0_cold_start / terra-max，root 架构与独立验收。不是 P1，不改用户 UI。

目标：使用已验收带 reasoning patch 的官方 tarballs，建立包含真实 profile 所需 family 依赖的独立普通 Node consumer；修正 RUNTIME01 只选 CLI 闭包而缺少 sidebar UI peers 的范围缺口。保留 dsh + SPA + Electron + runtime-profile 形态。本票先验证包消费与发布声明，不声称桌面已集成。

输入：ALPHA-PATCHED-BUILD01 已验收的新257包，根 /private/tmp/mochi-alpha-reasoning01.NRLa4C/patched-pack-20260906T221101Z/{dsh,vendor}。来源 commit d347e703908d0406b7a7ef80e3a0e594d86b2215 + patch c3e0b4a96e91c79ad49a13f7ddddcb4c7ab792cf419edca5d6db830612e4015c；root 重算清单 artifacts/architect-audit/alpha-patched-build/20260906T221101Z-official/root-packed-family-hashes.json。llm-deepseek lib/index.js SHA9cc4dce9a411f1f1ae7e7985babf826b3179abcf39b3464c9d13b79b024d5130。当前client record 222/fa941f1fa054715bf2f99a83dabc730a1358761e4d27c9250ff44fd832c6901b。

复用：docs/reuse-audit.md 中官方固定 MIT Harness 的完整框架检索、标准 npm file-tgz 根 dependencies 机制与已验 RUNTIME01 consumer。沿用固定 Node22.22.2/npm11.6.0 与精确工具路径/公开cache，不升级或重造resolver。原 pnpm deploy外逃失败不再试；官方 omit-optional consumer已知失败不重跑。新根集合来自 profile closure 报告，不盲装257，也不硬凑旧228。

边界：只写自己新唯一外部consumer/moved/home/tmp/cache与 artifacts/architect-audit/alpha-runtime02/<timestamp>/证据脚本/日志。原新旧包、源码、RUNTIME01/NATIVE01、desktop、plugins、用户UI、锁、profile、真实HOME、联动计划和共享docs均只读。你不是唯一工作者，Lagrange收尾新pack证据，不覆盖其目录。禁止改本地15条版本边掩盖不兼容；这次只选family供应，真实插件manifest范围仍单列待后续集成。

实施：复用已有 prepare-runtime-consumer.cjs 算法，绑定新257哈希；根为 CLI + 实际三profile bundle + 实际选择插件的family运行/optional/必需peer + 现有profile生成器使用的family模块。递归标准必需运行图，按固定tarball版本与标准semver验所有family边，报告相对228增量与理由。新旧manifest不一致先报告，不能静默扩大选择。标准私有consumer dependencies 指向file tgz，无dev根/overrides/手写运行resolver。

一次普通 npm install --include=optional --omit=dev --no-audit --no-fund，env-i新HOME/DSH_HOME/TMP及固定工具PATH；保留生命周期与peer校验，记录新package-lock。失败保存第一原因停止，不--force/legacy-peer-deps/ignore-scripts、不自行换工具/参数或包版本。成功后普通copy搬移，无hardlink，验证symlink内部无dangling、family无rc、所选257来源hash/版本、实际第三方图和锁。

闭包通过后新env-i HOME普通Node CLI --version应alpha；核搬移llm-deepseek编译JS/声明字节对应新包，Web owner静态资产和新record对应。执行已有 published-alpha-types 预检并使用真实已安装发布 .d.ts 做同一静态Compiler API对照（脚本/原始输出保存），记录5条source-map诊断是否仍存在；无缺项才启动noEmit，不补图、安装dev或改UI。映射静态检查不等于正常插件安装完整typecheck。缺失或诊断本身不通过改cast/配置让绿，返回root限定后续修复。

不要在普通Node副本重建Electron、完整profile/GUI/真实模型/校园网。后续Native目标和profile接线另票，会重新绑定本次新产物。交付真实工具/命令/句柄/退出码、根集合/范围检查、锁/路径/搬移闭包/CLI/真实声明结果与新旧输入冻结证据。第三方npm解析可能与原pnpm锁不同，要如实记录，不能称完全复现原源码依赖图。

### 启动授权 · 2026-09-07

Maxwell 已计算：根覆盖三profile bundles、实际12插件family运行边、packager29模块中的23scoped，closure为230/1328family必需边。相对CLI228仅新增ui-primitives/ui-slots；root已亲读新包manifest，前者20项普通第三方dependencies由npm标准解析，后者仅已有cordis peer。root独立对比旧/新257 manifest全部相同，因此旧输入上的关系可绑定新包hash。不把旧插件15range false算成已经兼容；本票只安装family供应，它们不阻塞此consumer，不改插件manifest。

现授权 Maxwell 在写完该简短closure记录后立即执行本票，无需再等报告格式审查。开始前同样重算新257 SHA并由标准semver核1328边，数量不符返回root，不能硬凑230。新输出与RUNTIME01等全部隔离。成功后提供真实句柄/安装锁/搬移闭包/声明预检；失败按票停止。禁止因optional包正常平台筛选误判其缺失为新错误。

### 搬移锁来源审计口径纠正

初轮普通copy因无效rsync --no-H参数未执行，保留；按已授权-a纠正copy通过。新根层级 /private/tmp/mochi-alpha-runtime02-moved.92OFPB 不同于原consumer子目录，npm lock file:相对路径在moved根不可解析；初轮auditor将历史安装来源按moved根解析，230 source检查失败，证据保留。

不通过重copy同深度来掩盖此限制。正确分列：原安装lock引用按原install根匹配230 tgz及integrity；moved锁字节不变；moved运行树所有普通文件内容不变/无共享inode、所有symlink内部。root已独立28562文件/12links、原230源SHA256/lock SHA512 integrity全PASS，moved新HOME CLIexit0。没有承诺moved目录直接npm ci（外部tgz未被打包）。执行者按此明确范围纠正auditor，保留原失败；本票published .d.ts预检仍待。


## 2026-09-07 root 收口

已验收 / PASS（普通 Node consumer 与发布声明对照范围）。root 已独立核验安装来源、搬移内容、CLI；审阅最终 React 类型映射差异与 0 诊断报告。完整桌面/profile 接入另验。
