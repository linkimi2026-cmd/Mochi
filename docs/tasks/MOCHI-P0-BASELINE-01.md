# MOCHI-P0-BASELINE-01：本地 Git 基线清单

状态：**BLOCKED（不得提交）**

本工作票只做可回滚基线审计。未修改生产代码、测试、Git 配置、远端或忽略规则；未读取任何凭据、SQLite、学生资料、文档/PPT/PDF 的正文。

## 已核对的依据

- 用户工作契约：要求主控与实现分离、P0 先建可回滚基线。
- [Mochi-总体方案.md](../../Mochi-总体方案.md) 第 4、6、45 节：本地数据与凭据不得入仓；保留 dsh/Electron 形态；P0 要求可回滚 Git 基线。
- 根 `.gitignore`、`scripts/campus-paths.cjs`、`apps/desktop/scripts/prepare-release-input.cjs`、`apps/desktop/scripts/prepare-mochi-resources.cjs`。

本票没有选择新依赖或实现新功能，因此没有 GitHub 复用选型；复用审计由主控维护的 `docs/reuse-audit.md` 负责。

## 已确认事实

| 项目 | 结果 | 基线含义 |
| --- | --- | --- |
| 外层 HEAD | `b64776394e94ac5300ed42da64f8d592a1b53cbb` | 当前唯一早期提交，不可把它误写成完整产品基线。 |
| 外层远端 | 无 | 本票不创建 remote，也不推送。 |
| 已跟踪文件 | 19 个 | 其中 7 个有未暂存改动，见下表；必须保留并由代码负责人审阅。 |
| 未忽略文件 | 审计时约 1,628 个，且并发 Agent 仍在写入 | 该数字是快照，不是可提交清单。提交前必须重新生成。 |
| `git add -n -A` | 会尝试加入约 1,635 个路径并报告 embedded repository | **不得使用** `git add -A` 建此基线。 |
| `.mochi-home.nosync/.credentials.yaml` | 被 `*.nosync/` 忽略 | 只核对忽略命中，未读取正文。 |
| 本地 SQLite 状态 | `.gitignore` 只匹配 `*.db`，不匹配 `*.sqlite`、`*.sqlite-wal`、`*.sqlite-shm` | 24 个本地状态文件未被忽略，会被全量暂存。 |

当前 7 个已跟踪但修改中的路径：

- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/package-lock.json`
- `apps/desktop/package.json`
- `apps/desktop/renderer/src/App.css`
- `apps/desktop/renderer/src/App.tsx`
- `apps/desktop/scripts/dev.mjs`

这些改动不是本工作票产生，不能覆盖、重置或替用户提交。

## 必须保留在磁盘、不得整体加入 Git 的路径

以下均为**已确认排除项**。保留现有文件，不清理、不移动。

| 路径 | 原因 |
| --- | --- |
| `artifacts/**` | 379 个未忽略路径，含审计快照、构建副本、原始/演示文档、截图和本地运行状态；不能把证据目录当源码目录整体入仓。 |
| `artifacts/migration-audit/demo-d/main-local-upgrade-20260906T0315/wrangler-state/**` | 未忽略的 Miniflare D1/KV/cache/observability SQLite 与 WAL/SHM 状态；内容未读，可能含测试或校园业务数据。 |
| `artifacts/migration-audit/workbench-ui-acceptance/**/dispatch/mochi-tasks.sqlite*` | 未忽略的任务状态数据库；内容未读。 |
| `.workbuddy/memory/**` | 本机 Agent 记忆文件，不属于产品源码。 |
| `mochi-harness-source.zip` | 23,499,424 字节的未忽略源码压缩副本；与可审计的依赖关系不同，不能作为基线源码输入。 |
| `tools/searxng/**` | 997 个第三方源码/本地配置路径；项目文档说明它不进桌面包，但 `mochi.sh` 可引用本地服务。应在单独的来源、许可证、固定版本审阅后处理。 |
| `campus.nosync/**` | 根规则 `*.nosync/` 已忽略；它是独立 Git 工作树（HEAD `462ff99db2a02e4e88f696c6842e7766e6880569`，审计时有 414 个状态条目），不得借外层基线隐式收录。 |
| `mochi-harness-src.nosync/**` | 根规则已忽略；其中 `mochi-harness` 为干净独立 Git 工作树（HEAD `d347e703908d0406b7a7ef80e3a0e594d86b2215`）。 |
| `.dsh-home.nosync/**`、`.mochi-home.nosync/**`、`probe-log.nosync/**`、`.architect-baselines.nosync/**` | 本机状态、日志、凭据或旧审计快照；根规则已忽略。 |
| `**/node_modules/**`、`**/dist/**`、`**/dist-electron/**`、`**/release/**`、`**/out/**` | 根规则已忽略的依赖和构建产物。 |

另外有三个 `node_modules` **符号链接**没有被目录忽略规则覆盖，会成为 `git add -A` 的候选项，必须显式排除：

- `plugins/mochi-campus/node_modules`
- `plugins/mochi-dispatch/node_modules`
- `plugins/mochi-documents/node_modules`

## 外部依赖与可复现性缺口

1. `plugins/dsh-better-sidebar/` 是独立 Git 仓库，HEAD 为 `a5c52b3f1bc450b04578bd9252f67b7d79c98502`，工作树干净；外层仓库没有 `.gitmodules` 和 gitlink。干跑 `git add -n -A` 会产生 embedded-repository 警告，克隆者无法得到内容。

2. 桌面打包脚本将该插件的 `package.json`、`dsh.plugin.json`、`cordis.patch.yml` 和 `lib/` 作为必需输入。当前 `lib/` 存在但在该插件内部被忽略，`git ls-files lib` 返回 0。正式 submodule 只能固定源码和 `pnpm-lock.yaml`；还需在固定提交上重建 `lib/`，并验证构建、锁文件和跨平台原生依赖。此项未验证。

3. `scripts/campus-paths.cjs` 的源码解析顺序是显式 `MOCHI_CAMPUS_SOURCE_ROOT`、同级 `../联动计划`、最后才是 `campus.nosync`；`prepare-release-input.cjs` 和 `prepare-mochi-resources.cjs`只接收已构建的校园静态输入，并明确不打包 Worker、D1、本地凭据或源码依赖。外层基线可记录这项外部依赖，但在校园源码仍有未提交状态时，不能声称可独立复现完整桌面打包。

## 建议的显式白名单（尚未获准暂存）

以下是“可由代码/内容负责人逐项审阅后加入”的**候选范围**，不是立即可运行的 `git add` 命令。每个范围均以审计快照中的 `git ls-files --others --exclude-standard -- <路径>` 为准，避免未来新文件被自动放行。

| 候选范围 | 当前未忽略路径数 | 纳入前条件 |
| --- | ---: | --- |
| `apps/desktop/**` | 74 个新增路径 + 上述 7 个已跟踪改动 | 代码审阅、迁移/种子数据隐私审阅、锁文件一致性检查。 |
| `client-plugins/{jxl-brand,jxl-campus,jxl-theme,mochi-model-presets,mochi-workbench}/**` | 42 | 代码和资源来源审阅。 |
| `plugins/{cordis.yml,mochi-campus,mochi-dispatch,mochi-documents,mochi-grades,mochi-hello,mochi-llm-mimo,mochi-office,mochi-presentations,mochi-web-search}/**` | 55（不含 better-sidebar） | 排除上列 3 个符号链接；对 SQL seed、文档 fixture 和字体许可单独审阅。 |
| `scripts/**`、`skills/**` | 6 + 9 | 对启动脚本、技能资源 JSON 做内容与凭据扫描。 |
| `foundation/**`、`plan/**`、`1.5阶段任务/**`、`第二阶段/**` | 39 + 13 + 2 + 2 | 作为设计/任务文档独立审阅，不与生产代码自动捆绑。 |
| 根目录的 `Mochi-*.md`、`WORKLOG.md`、`A2A_RELIABILITY_REPORT.md`、`MIGRATION_AUDIT_REPORT.md`、`免费搜索工具调研_2026-09-06.md`、`评审导向系统评估_2026-09-04.md`、`mochi.sh`、`mochi-dev-up.sh` | 10 | 确认不含原始用户资料、内部地址或凭据后，再作为文档/启动入口提交。 |

只有以下路径被本票实际阅读并形成了审计结论：`.gitignore`、`scripts/campus-paths.cjs`、`apps/desktop/scripts/prepare-release-input.cjs`、`apps/desktop/scripts/prepare-mochi-resources.cjs`、`apps/desktop/package.json` 和总体方案相关章节。它们不等于整棵候选源码已审阅。

## 放行前步骤

1. 由主控取得根 remote 的用户授权结果，并由实现负责人完成正式 submodule 方案；不得通过删除嵌套仓库的 `.git` 或直接把 `lib/` 加进外层仓库规避缺口。
2. 在隔离、可记录的方式下，对候选源码做凭据和真实学生资料扫描；本审计没有读取这些正文，所以不能给出“无敏感内容”的结论。
3. 生成固定路径清单后，使用显式路径暂存；禁止 `git add -A`。
4. 暂存后复核：`git diff --cached --check`、`git diff --cached --name-only`、`git ls-files -s | awk '$1==160000 {print}'`，并确认没有 `artifacts/`、`*.sqlite*`、`*.zip`、上述符号链接或未审阅第三方树。
5. 只有代码审阅、打包审计和最小可运行验证均通过后，才由被授权的人创建本地基线提交；本工作票不执行提交。

## 本票实际执行的只读验证

| 命令类别 | 结果 |
| --- | --- |
| `git status --short --untracked-files=all`、`git ls-tree -r --name-only HEAD` | 核对 HEAD、19 个已跟踪文件、7 个修改与大量未忽略路径。 |
| `git add -n -A` | 仅 dry-run；发现大规模候选项和 embedded-repository 警告，未改变 index。 |
| `git check-ignore -v -- <关键路径>` | 确认 `.nosync`、依赖、构建产物和凭据路径受规则保护；确认 SQLite、zip、better-sidebar 未被保护。 |
| `git -C <nested> rev-parse/status/ls-files` | 确认三个嵌套仓库状态、better-sidebar 固定提交及其 `lib/` 未跟踪。 |
| `find/stat`（仅路径、类型、大小） | 枚举大文件、压缩包、数据库和符号链接；未读取敏感正文。 |

测试实现：无。此票没有改动实现代码，故未运行应用测试。
