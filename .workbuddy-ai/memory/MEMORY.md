# Mochi 项目长期笔记

> 只记跨会话有长期价值的事实与约定。日常进展见同目录 `YYYY-MM-DD.md`。

## 打包机制（最关键的项目约定）

Mochi 是 Electron 桌面应用，插件进安装包**不靠"整个目录塞进去"**，而靠白名单**逐文件**暂存：

- 白名单：`apps/desktop/scripts/prepare-mochi-resources.cjs` 的 `const PLUGINS`（约 55-129 行）
- 暂存逻辑：同文件 `:626-633`，**只拷贝 `files` 列出的文件和 `directories` 列出的目录**，没有其他分支
- **新增插件源文件必须同时登记进 `files`**，否则开发机 `node index.mjs` 正常、打包版直接报模块找不到
- **白名单的 `files` ≠ 插件 `package.json` 的 `files`**：前者是精确暂存清单（不含 README.md），后者是 npm 打包清单（含 README.md）。改的时候不能照抄
- 运行时模块闭包由 `PLUGIN_RUNTIME_MODULES` + `PLUGIN_RUNTIME_VERSIONS`（同文件 `:135-208`）提供，会拷到 `resources/mochi/plugins/node_modules/`
- 第三方库（`docx` / `pdf-lib` / `pptxgenjs` / `exceljs` / `jszip`）由 `apps/desktop/package.json` 的 `file:../../vendor/local-plugins/*.tgz` 依赖 + `npm ci` 提供，最终走 asarUnpack + `NODE_PATH`
- **插件运行时从哪加载**：`runtime-profile.json` 的 `resourcePath` + `runtime-profile.cjs:424-433` 的 `resolvePluginTarget` → `resources/mochi/plugins/<resourcePath>`，即**白名单暂存的那份**（不是 node_modules 里那份）
- **改快照内任何文件，必须重算** `.github/windows-native-package-inputs.json` 的 `sha256` + `bytes`，并累加 `verification.expectedFileBytes`，否则 Windows CI 首步即挂

## 内核版本

- **实际使用 `0.1.3-alpha.1`**（代码证据：`prepare-mochi-resources.cjs:177` 起的 `PLUGIN_RUNTIME_VERSIONS`）
- 多份文档仍写 `0.1.2-rc.1`（`Mochi-方案总纲.md:4`、`plan/03_RUNTIME_AND_PLAN.md:4`、`plan/12_REVISION_LOG.md:20`）——过时
- `foundation/03_MIGRATION_PRINCIPLES.md:7` 写的 `0.1.3-alpha.1` 是正确的

## 现行工程规范（三份，互不引用）

| 文件 | 管什么 |
|---|---|
| `docs/build-standard.md` | 唯一出包路径（改源码 → 提交 → GitHub Actions 出包 → 用户安装）。**明确禁止手工热修包** |
| `docs/mochi-naming-convention.md` | 命名与身份（只冻结增量）+ 工具名硬约束（只允许 `[a-zA-Z0-9_-]`） |
| `docs/reuse-audit.md` | 开源复用审查记录 |

## 已知的结构性问题（截至 2026-09-12）

- 「唯一事实源」有 **11 处**互相冲突，其中 `Mochi-总体方案.md:4` 与同文件 `:619` 自相矛盾
- 全仓 Markdown **无「最后更新」字段**
- 规范承诺与执行脱节已出现 3 次：`mochi-naming-convention.md:81`（称 CI 会跑，实际被排除）、`build-standard.md:146-148`（称升级硬门禁，实际 `continue-on-error`）、`URGENT-REPLAN:7`（称作废标注已加，实际只加 1/4）
- 孤立插件（有源码、不进包）：`mochi-files`、`mochi-sheets`、`mochi-office`、`mochi-modes`（两份目录）、`mochi-visuals`

## 用户协作偏好

- **多 Agent 任务必须额外加一路"事实终审"Agent**，独立取证、禁止转述
- 用户并行开发时，审核类任务须**只读**：不跑测试、不写源码，避免冲突
- 文档时间以 iCloud `birthtime` 为准；文档自述日期 ≠ 文件创建日
- 信测试不信汇报：任何「改了但没验证」一律记为未完成
