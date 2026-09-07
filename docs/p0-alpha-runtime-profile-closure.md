# MOCHI-P0-ALPHA：runtime-profile family 闭包准备

**结论：RUNTIME02 的 family 选择应为 230 个包。** 相对 RUNTIME01 的 CLI 228 包闭包，只新增两个官方 alpha family 包：`@deepseek-ai/dsh-client-ui-primitives@0.1.3-alpha.1` 与 `@deepseek-ai/dsh-client-ui-slots@0.1.3-alpha.1`。本报告只准备名字和范围；没有安装、生成 consumer/lock、改插件 manifest 或验证 profile 启动。

## 固定输入和算法

| 输入 | SHA-256 / 已确认事实 |
| --- | --- |
| runtime profile | `apps/desktop/resources/mochi-web/runtime-profile.json` — `29dd65aeb1278a9e9ac3dd8ed09be5105e0632b75f72954bc69cc1dbd16ba6e9` |
| 实际资源 packager | `apps/desktop/scripts/prepare-mochi-resources.cjs` — `accafed113e82b5911fdf739aed0fd66af8bb5fdb7ef8281e7fd58e24d3202d2` |
| RUNTIME01 标准生成器 | `artifacts/architect-audit/alpha-runtime/20260906T212551Z-runtime01/prepare-runtime-consumer.cjs` — `d8ffc3dd1318634311cdd8c845399c43d34fdbf6a326833a4b1ef33f130e54a5` |
| RUNTIME01 CLI closure | `closure-preflight.json` — `317d6b42ec5d740bf3aa569a1c928a6d110c3c7423aca6e462056a286df2a9fc`，228 packages / 1,326 family edges |
| 不可变旧包集 | 248 DSH + 9 vendor = 257 `.tgz`；本轮重新按既有两个 SHA-256 清单逐个验证，257/257 一致。 |

本轮用 Node 22.22.2 的一次性内存 heredoc 重用 RUNTIME01 生成器的 manifest 读取和边规则：读取每个 tarball 的 `package/package.json`，沿 `dependencies`、`optionalDependencies` 和非 optional `peerDependencies` 递归；family 目标仍按 RUNTIME01 使用标准 semver prerelease 语义验证。原生成器会创建 consumer，和本票边界冲突，所以没有直接执行它、没有落地新脚本或 consumer。

## 根集合来自实际 profile/packager，不来自字符串扫描

`runtime-profile.json` 实际声明三个 profile：

| Profile | bundles |
| --- | --- |
| `headless` | `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-headless` |
| `mochi` | `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-headless` |
| `mochi-web` | `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` |

这三个 bundle 名称都已在 RUNTIME01 的 CLI 228 闭包中，因此不增加 family 包。

profile 实际选择的 12 个插件为 `mochi-hello`、`mochi-dispatch`、`mochi-campus`、`mochi-web-search`、`mochi-llm-mimo`、`mochi-approval`、`jxl-theme`、`jxl-brand`、`jxl-campus`、`mochi-workbench`、`mochi-model-presets`、`dsh-better-sidebar`。该集合与 packager 的 `PLUGINS` 精确相同。读取这 12 个 manifest 的 `dependencies`、`optionalDependencies` 和非 optional `peerDependencies` 后，共得到 16 条 `@deepseek-ai/*` 边、14 个不同 family 根；没有 `@deepseek-ai/*` optional 边。

packager 实际 `PLUGIN_RUNTIME_MODULES` 为 29 个，其中 23 个名称属于 `@deepseek-ai/*` family；这 23 个都已经包含在 CLI 228 闭包。其余 6 个是普通 npm 名称（`@standard-schema/spec`、`zod`、`ws`、`eventsource-parser`、`schemastery`、`cosmokit`），不被伪装为旧 257 tarball family 根；RUNTIME02 应让标准 npm 按被选 family package manifest 解析并写入 consumer lock。

## 计算结果

| 项目 | CLI 基线 | runtime-profile 扩展结果 |
| --- | ---:| ---:|
| selected family packages | 228 | **230** |
| family dependency / optional dependency / required peer edges | 1,326 | **1,328** |
| 新增 family packages | — | **2** |

新增项都由已选择的 `dsh-better-sidebar` 的非 optional peer manifest 边直接要求：

| 新增包 | alpha version | 选择理由 | family 内后续边 |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-primitives` | `0.1.3-alpha.1` | `dsh-better-sidebar` 的 `peerDependencies` `^0.1.2-rc.1` | 非 optional peer `@deepseek-ai/cordis@^4.0.2`，已在闭包；另外有 20 个普通 npm `dependencies`。 |
| `@deepseek-ai/dsh-client-ui-slots` | `0.1.3-alpha.1` | `dsh-better-sidebar` 的 `peerDependencies` `^0.1.2-rc.1` | 非 optional peer `@deepseek-ai/cordis@^4.0.2`，已在闭包；没有普通 `dependencies`。 |

`dsh-client-ui-primitives` 的真实普通依赖为 `@shikijs/langs`、`@types/mdast`、`anser`、`clsx`、`katex`、`mdast-util-from-markdown`、`mdast-util-gfm`、`mdast-util-math`、`micromark-core-commonmark`、`micromark-extension-gfm`、`micromark-extension-math`、`micromark-factory-space`、`micromark-util-character`、`micromark-util-classify-character`、`micromark-util-sanitize-uri`、`micromark-util-symbol`、`micromark-util-types`、`react`、`react-dom`、`shiki`。这些不是手工显式铺入 family 根的对象；RUNTIME02 的标准 npm 安装必须解析它们并把实际结果记录在 consumer lock。

两个新增包要求的 `@deepseek-ai/cordis@^4.0.2` 与旧 vendor tarball `4.0.2` 满足标准 semver；这两个新 package 没有新增的 family peer 冲突。

## 本地插件版本边单列，不作为 RUNTIME02 family 安装前置

16 条实际本地插件 DeepSeek 边中，只有 sidebar 的 `@deepseek-ai/cordis@^4.0.2` 满足旧 vendor `4.0.2`。另有 15 条均不接受 `0.1.3-alpha.1`：sidebar 的 13 个 RC-range peer（含本报告新增的 primitives/slots），以及 `mochi-campus`、`mochi-dispatch` 对 `dsh-tools@0.1.2-rc.1` 的 exact dependency。

RUNTIME02 只供应 family consumer、**不安装本地插件**，所以这 15 条不是 RUNTIME02 的安装前置，也不得为了本票提前修改生产 manifest、放宽 peer 或使用 override。它们保留为后续真实插件集成时必须解决和验证的独立问题。

## RUNTIME02 可执行输入与限制

- private consumer 根依赖应保留 RUNTIME01 的完整 228 selected family 列表，并加上上述两个包，合计 230；不能只在根上放两个增量包。
- 继续使用标准 npm 的普通依赖/peer 解析和生成 lock；不手工铺第三方根、不绕过 peer 校验。
- 本轮绑定的是旧 257 tarball family。正在产出的 patched family 必须由后续票重新比较 manifest/包 hash 后才能替换此输入；不能从本报告推导新 tarball 内容相同。
- 本报告未验证 API、profile provision、CLI、Electron、模型、Windows 或校园网，也没有把 15 条插件 range mismatch 视作已经兼容。
