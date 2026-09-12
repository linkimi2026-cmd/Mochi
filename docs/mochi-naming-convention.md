# Mochi 命名与身份约定（A 档：只冻结增量，不改存量）

**生效日期：2026-09-07 ｜ 状态：生效中 ｜ 适用范围：Mochi 项目全部我方可控文件**

本文只做一件事：**从今天起，Mochi 代码与文档里不再新增 `deepseek` / `DSH` 字样。**
本文**不做**批量替换、不改存量、不改任何技术契约。存量正名属于 B 档，另行排期。

---

## 1. 为什么只冻结增量

- 老师**看不到**内部标识。身份问题已由 persona IDENTITY LOCK + 关闭
  `plugin-package-inventory-deepseek` 解决（禁词不出境），不依赖改名。
- 存量改名会打断依赖解析、peer 校验、已冻结审计证据链（见文末「风险背景」）。
- 冻结增量 = 零风险止损：新代码天然干净，存量等答辩后按 B 档一次性处理。

## 2. 规则（三条）

**R1｜禁止新增。** 我方可控文件的新增/修改行中，不得出现 `deepseek`（含大小写变体）
与 `dsh` 标识，白名单与豁免区除外。

**R2｜白名单内照写。** 下列 6 项是**技术契约**，不是品牌露出，出现即合规，
**不得为了"干净"去改它们**：

| # | 白名单项 | 为何不能改 | 仓库真实例证 |
|---|---|---|---|
| 1 | `@deepseek-ai/*` npm 包名 | 257 个 tarball + 230 family 闭包，依赖解析/lock/peer 校验全绑定 | `plugins/*/package.json`、runtime closure |
| 2 | SDK 类名 `DeepSeekHarness` | 官方 SDK 导出名 | vendor SDK（`*.nosync/`，豁免区） |
| 3 | Python 包 `deepseek_harness`（含 `_runtime`） | 官方 python SDK 包名 | `mochi-harness-src.nosync/.../python/sdk/` |
| 4 | CSS 变量 `--dsw-static-deepseek-*` | **皮肤覆盖依赖**，改名即主题失效 | `foundation/ui/jxl-theme-bridge.css`、`client-plugins/jxl-theme/client.js` |
| 5 | launchd label `com.deepseekharness.*` | 常驻服务标识，改名需重装服务 | Electron 宿主 |
| 6 | 官方 LLM 通道键 `llm-deepseek` / `dsh-llm-deepseek` | 配置键名，指向官方通道 | `plugins/mochi-llm-mimo/` |

**R3｜豁免区不动。** 下列目录是**冻结资产或第三方源码**，既不改、也不要求清理：

```
**/*.nosync/**          vendor 源码树与运行时根（mochi-harness-src / campus / .mochi-home）
apps/desktop/release/** 已打包产物（Mochi.app）
artifacts/**            审计证据（SHA-256 冻结，改动即证据作废）
foundation/**           历史 foundation pack
plan/**                 历史规划
**/node_modules*/**     依赖
**/pnpm-lock.yaml, package-lock.json, *.lock
```

历史文档（`MIGRATION_AUDIT_REPORT.md`、`WORKLOG.md`）保留原文不改——它们是当时的事实记录，
改了反而失真，其中出现的字样不计违规。

## 3. 怎么执行

**不设脚本门禁，靠写的人和 Code Review 自觉。** 写新代码/新文档时，只要想敲
`deepseek` 或 `dsh`，先对照第 2 节的白名单：不在白名单里就换 Mochi 写法。
存量不动，不需要批量扫描，也不需要基线文件。

## 4. 新增内容该怎么命名

| 场景 | 写法 |
|---|---|
| 品牌 / 产品名 | `Mochi` |
| 运行时底座（文档显示层） | `Mochi Harness` |
| 插件目录 / 包名 | `mochi-*`（先例很多，**不写死数字**——数量随迭代变化，写死必然过时） |
| 环境变量（新增） | `MOCHI_*` 前缀；**不得**新造 `DSH_*` |
| 服务 / label（新增） | `com.mochi.*` |
| 内部缩写 | **待定**，B 档统一（候选 `MOCH`，与 `.mochi-home` 同源）。在定死之前**不要引入第三种形态** |

## 5. 工具名硬约束（2026-09-12 新增，与品牌无关但是硬红线）

**模型可见的工具名只能由 `[a-zA-Z0-9_-]` 组成。** 点号、空格、斜杠、中文一律不允许。

- 起因：Mochi 的工具原本写成 `mochi.ppt_create` / `jxl.campus_status` 这种 <!-- allow-dotted-tool-name -->
  `命名空间.动作` 形态，被模型网关以
  `400 invalid_request_error: Invalid 'tools[6].***.name': string does not match pattern '^[a-zA-Z0-9_-]+$'`
  整轮拒收——**一个工具名不合规，整个会话都发不出去**。
- 底座自带的 31 个工具（`bash` / `web_search` / `terminal_create` …）**全部是下划线**，
  我们改成下划线即与底座约定对齐。
- 正确写法：`mochi_ppt_create`、`jxl_campus_status`、`message_send`。
- **不是品牌问题，不要因为"看起来像命名空间"就换回点号。**

### 已有的防回归守卫

`apps/desktop/scripts/test-package-resources.mjs` 里有两道断言（⚠️ 2026-09-12 更正：**公开 CI 跑不了它**——该脚本需要先装 `apps/desktop/node_modules`，CI 不装依赖，见 `docs/build-standard.md` §4.6。目前只能本机跑）：

1. `assertModelFacingToolNames()` —— 对实际注册出来的每个工具名用
   `^[a-zA-Z0-9_-]+$` 校验；
2. `assertNoDottedToolNameLiterals()` —— 源码级扫描 staged 插件，任何
   `'jxl.xxx' / 'mochi.xxx' / 'message.xxx'` 形态的字符串字面量直接判红
   （覆盖静态注册与循环里的别名数组，例如 `for (const n of ['campus_query_student', 'jxl.student_query'])`）。

这两道守卫属于**正确性门禁**，不是第 3 节否掉的"品牌命名门禁"，别一起删掉。

## 6. 违规处理

新写的代码/文档里出现非白名单 `deepseek`：

1. 能换成 Mochi / Mochi Harness 的 → 直接换；
2. 属于技术契约但不在上表 → **先补白名单并注明理由，再写**，不得先写后补；
3. 引用 vendor 路径/包名 → 确认是否落在豁免区，不是的话按 2 处理。

## 7. 风险背景（为什么不做批量替换）

- **依赖链**：`@deepseek-ai/*` 改名 = 257 tarball + 230 family 重新打包，peer 全断，
  P0 已 PASS 的 RUNTIME01/02、PACKLIST、BUNDLE 全票重跑。
- **审计链**：`artifacts/` 下冻结的 cjs/json 带 SHA-256，改一个字符串 → 哈希全变 →
  已 PASS 结论全部作废。
- **数据根**：`DSH_HOME` 深入 vendor 黑盒（`dsh-home-paths` 内部 12 处）与已打包 App，
  单向替换会让老用户数据根失联。
- **基线丢失**：vendor 源码树（`deepseek-harness-master` / `mochi-harness`）是
  "与官方源码一致性核验"的基线，改了就再验不出我们私自改了什么。

以上均属 B 档范围，需单独评估、单独排期、答辩后再动。
