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
- **`0.1.3-alpha.1` 已不在公开 npm**（npm 只有 `0.1.3-alpha.2`）⇒ `vendor/alpha-family/` 的 231 个 tgz 是唯一来源
- 上游 npm：`latest` = `0.1.5-rc.2`，`alpha` = `0.1.6-alpha.2`（2026-09-17）。**Computer Use 首现于 `0.1.6-alpha.1`（09-15）**

## 上游 Computer Use 的接入机制（2026-09-19 取证）

- 上游把它做成「**能力组 + 单一 provider 独占注册**」：`packages/computer-use/computer-use` 只提供 `ctx.computerUse`；provider 在 `packages/experimental/`（`computer-use-cua-driver-mcp` 走外部可执行 + MCP；`computer-use-cua-driver-native` 走进程内 `@trycua/cua-driver@0.28.0`）
- 这些包**已上 npm** 但**不在** `@deepseek-ai/dsh` 元包 dependencies 里 ⇒ 必须由 profile 显式挂载，**装了内核 ≠ 有 computer use**
- **Mochi 侧零缺口的关键**：0.1.3 的 `dsh-mcp-client` 已具备「MCP 工具注册成 `mcp__<server>__<tool>`」+「MCP image 块 → attachment → 模型可见 image」（`packages/mcp/mcp-client/src/tools.ts:355-358`）
- 唯一缺口：`packages/bundle/base/cordis.patch.yml` **无任何 mcp 挂载行** ⇒ 加一行 `- id: cua-driver-mcp / name: '@deepseek-ai/dsh-mcp-client' / config{transport,serverName,command,args,failOnStartupError:false}` 即可
- 权限归属是选型分水岭：**mcp 路线权限归 cua-driver 自己**（理论可绕开未签名阻塞）；**native 路线要求 Mochi.app 自己拿权限**
- `mochi-modes` 的 restrict 天然把 computer-use 工具锁在工作界面（对话界面只 allow `mochi_request_work_mode`）

## 现行工程规范（三份，互不引用）

| 文件 | 管什么 |
|---|---|
| `docs/build-standard.md` | 唯一出包路径（改源码 → 提交 → GitHub Actions 出包 → 用户安装）。**明确禁止手工热修包** |
| `docs/mochi-naming-convention.md` | 命名与身份（只冻结增量）+ 工具名硬约束（只允许 `[a-zA-Z0-9_-]`） |
| `docs/reuse-audit.md` | 开源复用审查记录 |

## 已知的结构性问题（截至 2026-09-12）

- 「唯一事实源」有 **11 处**互相冲突，其中 `Mochi-总体方案.md:4` 与同文件 `:619` 自相矛盾
- 全仓 Markdown **无「最后更新」字段**
- 规范承诺与执行脱节已出现 **4 次**：`mochi-naming-convention.md:81`（称 CI 会跑，实际被排除）、`build-standard.md:146-148`（称升级硬门禁，实际 `continue-on-error`）、`URGENT-REPLAN:7`（称作废标注已加，实际只加 1/4）、**2026-09-16 新增**：`package.json:17` 的 `check` 含 4 个新测试入口，但 `mochi-ci.yml` 逐条分步、**不跑 `npm run check`**，故文档宣传的"151 项全通过"CI 从不验证
  - **其中第 2 条已于 2026-09-14 收口**：快照门禁改用 `check-snapshot-manifest.mjs --fail`，实测 0 漂移

## 质量门禁实跑（2026-09-14 实测，`npm run check` 为总入口）

- 根 `package.json`（`mochi-repository-quality`）+ `package-lock.json` + `biome.json` + `tsconfig.plugin-contracts.json` 已存在；根 `node_modules` 已装
- `npm run check`（2026-09-16 已扩至 9 段）= 依赖边界 → Biome lint（94 文件）→ `format:check` → `checkJs` → 5 核心插件 **126** → `test:prompt-quality` → `test:eval-evidence` → `test:model-transport` → `test:compaction`。**后 4 段 CI 不跑**
- 实测全绿：`npm run check` exit 0；CI 零依赖批 **93/93**；快照 **496 项 / 91,963,933 B / 0 漂移**
- 🔴 **跑测试前必须 `unset NODE_OPTIONS` 且 `dangerouslyDisableSandbox=true`**，否则本机注入的 `safe-delete` shim 与沙箱路径白名单会造成 9~16 个**假失败**。完整做法见 skill `mochi-quality-gate-verify`
- ~~孤立插件（有源码、不进包）：`mochi-files`、`mochi-sheets`、`mochi-modes`、`mochi-visuals`~~ → **该结论已作废**。2026-09-14 实测快照 `categories` 含 **26 个 `staged-plugin:*`**，`mochi-files`(4)/`mochi-sheets`(9)/`mochi-visuals`(10)/`mochi-modes`(3) 均已进包；**仅 `mochi-office` 仍未进包**（它在 CI 零依赖批里有 `test/server.test.mjs`、`test/store.test.mjs`）

## 🔴 产品能力的硬边界（2026-09-16 实测，最影响"能不能真用"）

- **PPT 工具不支持图片、自由坐标、字号、字体、动画**（`plugins/mochi-presentations/plugin.mjs:155` 自认）；`index.mjs:717` **硬断言 PDF `imageCount` 必须为 0**。实测两套课件 10/10 页 `imgs=0`
- ⇒ **核心瓶颈是渲染工具表达力，不是提示词**。项目自己的 `yan-agent-research.md:52` 也说"工具表达力不足无法用更严提示词补齐"，但投入仍偏向提示词。评"质量改进"时先看工具边界
- **视觉自检（`mochi_ppt_render`）依赖本机 LibreOffice**：`render.mjs:437-440` 找不到 soffice 即抛错；打包链（`build.files` / `prepare-mochi-resources.cjs`）**不含 LibreOffice**。开发机有 `/Applications/LibreOffice.app` 才跑得通 → **该卖点在用户机默认不成立**。注意口径：`visuals-oss-research.md:21` 的 G2 是**候选库选型门槛**非全局禁令，且 PPTX 由 pptxgenjs 生成不依赖它，说"功能崩溃"过重
- **真实端到端 Agent 测试只有 3 次，`input.txt` 逐字相同**（同一"小学四年级水循环"题）；46 条评测用例断言 **100% 是 `llm-rubric` 模型裁判**
- **`test-profile-skills.mjs`（唯一验证真实 profile 注入的测试）不在 `npm run check`**；`mochi-approval/test.mjs`（审批写操作）不在任何 CI 步骤
- **Windows 安装包停在 2026-09-10**：09-12 主题改造与 09-16 提示词改进都未进包

## 用户协作偏好

- **多 Agent 任务必须额外加一路"事实终审"Agent**，独立取证、禁止转述
- 用户并行开发时，审核类任务须**只读**：不跑测试、不写源码，避免冲突
- 文档时间以 iCloud `birthtime` 为准；文档自述日期 ≠ 文件创建日
- 信测试不信汇报：任何「改了但没验证」一律记为未完成
