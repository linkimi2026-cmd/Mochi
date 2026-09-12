# MOCHI-TEXTBOOK-IMPORT-01 · 离线教材交付

阶段：教师/教室交付收口；负责人Lagrange（terra-max），root独立审核，Halley独占桌面/profile/依赖锁。

需求依据：用户要求高中三个年级、六科指定版本知识库，安装后能用，明天可分发。当前已验33书4844页，私有数据根 `/private/tmp/mochi-textbook-kb-20260909.nR5g7H/dsh/knowledge`。教材来源许可不明确，不入公共Git或CI；公开代码与私有教材交付分开。

允许写入：`plugins/mochi-knowledge/scripts` 和私有外部交付目录。禁止修改desktop/profile、manifest/lock、其他插件、用户数据；不覆盖已有知识库。先核现有导入、角色标记格式及官方Electron运行入口，简短复用记录交root。

目标：Mac/Windows双击离线导入入口，用户不用敲命令、不依赖系统Node/Python，复用已安装Mochi运行时。只导入快照的textbook.sqlite与library，附文件hash与快照清单。明确选择教师或教室目标，读取真实 `.mochi-runtime-role.json` 格式核验；目标固定在对应DSH_HOME/knowledge，不跨根复制用户数据。

原子性：同卷临时写入、逐文件hash和33书4844页一致性校验后提交。已有非空知识库应中文说明并停止，不覆盖；中断不呈现半个有效库。路径、重解析/符号链接与角色不匹配需拒绝。

验收：Mac实际双击或等价运行、干净根成功、错误hash/已有库/角色错拒绝、失败不破坏现有数据；Windows仅静态检查不能冒称实机。输出私有交付路径、体积、hash、精确运行环境和命令、通过/未测项。教师与教室独立导入。Halley提供最终安装运行时路径协议，Lagrange不自行改共享桌面。

首次核心审查CHANGES REQUIRED：现有knowledge插件启动时立即openKnowledgeStore，创建library与textbook.sqlite；因此已产生角色标记的实际首装通常已有0册空索引。导入器不能将这一状态和用户已有数据一律拒绝，否则用户无法按正常顺序导入。必须新增真实openKnowledgeStore生成空库的退出后导入验证；仅允许严格核验的0册0页、无用户内容状态安全保留备份后提交，有数据或未知目录继续拒绝，不能替换仍打开的DB。已派Lagrange在脚本范围修复。

root独立Node22运行test-install-textbook-snapshot.mjs 9/9 PASS（session71812），已审真实空库识别/备份/原子提交与快照逻辑。Windows和最终包尚未实测；启动器仍需复用实际桌面默认home与已安装app位置，不能要求普通老师查找隐藏元数据目录。执行者633MB双角色导入通过仅为隔离Electron资源布局，不是最终安装包。
