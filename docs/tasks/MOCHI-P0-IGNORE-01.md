# MOCHI-P0-IGNORE-01 · 本地状态的 Git 忽略边界

状态：已验收（PASS，仅本票忽略边界）。

P0，唯一实现者 p0_baseline_inventory（terra-max）；主控独立审计。用户契约 §5保护未提交内容、方案 §4/45数据不入仓与可回滚基线。用户Max方式即现有terra-max角色。

已核实24个SQLite状态文件、三个node_modules符号链接、.workbuddy与mochi-harness-source.zip在全量暂存候选中。复用搜索/版本/许可/理由见 docs/reuse-audit.md本票。原.gitignore与HEAD一致；备份 `.architect-baselines.nosync/20260906T161230Z/.gitignore`。

允许修改仅根 `.gitignore`，以及证据 `artifacts/architect-audit/p0-ignore-fix.md`。你不是唯一工作者，不覆盖他人改动。不得stage/commit/git rm、删文件、动remote、submodule、产品源码、锁文件或其他Agent文件。

最小修改：保留原规则；node_modules规则覆盖目录和同名symlink；新增 .sqlite、.sqlite-wal、.sqlite-shm、.sqlite-journal；忽略根.workbuddy与指定mochi-harness-source.zip。不全局忽略所有zip、md或整个artifacts，不用忽略规则掩盖尚待审阅文件。

验收：对你清单里的实际路径逐项git check-ignore -v；普通src/package.json/方案/docs文件仍未被意外忽略；文件仍在磁盘、index仍空。无需编写测试，不运行不相关应用测试。交付真实diff、命令与结果；只解决此边界，不把它写成整个安全基线已PASS。
