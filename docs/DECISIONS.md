# Mochi 决策记录（DECISIONS）

> **status**: active　**last_verified**: 2026-09-12　**verified_by**: 工具线
> **性质**：记录**已经拍板、且会影响后续 Agent 判断**的决定。目的是让后来者不要反复"修好"一个其实是有意为之的设计。
> 只记决定 + 理由 + 代价；不记排期（见 `docs/tasks/MOCHI-URGENT-REPLAN-2026-09-11.md`）、不记实现（见源码与 `docs/RUNTIME-FACTS.md`）。

---

## D-001 · 模型密钥随安装包分发（**有意为之，不要"修复"**）

- **决定**（作者，2026-09-12）：安装包内置模型密钥，老师装完即用、不需要填任何 API key；未来换成官方 API key 后仍随包分发。
- **实现**：`apps/desktop/resources/mochi-web/seeds/credentials-seed.json`（构建期由 `seed-packaging-keys.cjs` 从 `secrets/packaging-keys.local.yaml` 或 CI Secrets 渲染）→ `build.extraResources` 打进 `Resources/mochi/profile/seeds/` → 首启由 `electron/dsh/seed.ts` 合并进 `<home>/.credentials.yaml`。
- **已知代价（必须公开承认）**：
  1. 拿到安装包的人都能解出这两枚 key，**等同公开**；
  2. 全量老师共用一个额度，一枚泄漏 = 所有人不可用；
  3. 已经发生的现实：`release/2026-09-09/Mochi-0.1.0-mac-arm64.dmg`（9/11 08:44 构建）内已含明文 key。
- **因此后续动作是"治理密钥"而不是"删掉注入"**：
  - 换成官方 key 时：**轮换**、单独申请、可限额、可撤销；
  - 每个老师一枚独立 key（或网关侧按设备限额）是理想解，未做；
  - **不要**把 `seeds/` 加进 `.gitignore` 之外的"清理"逻辑里，也不要在打包脚本里删掉种子注入。
- **反面记录**：2026-09-12 的两轮独立审计都把这条列为"下一次出包必泄漏"的 P0。**结论仍然成立，但处置方式已被作者改写为「接受风险 + 治理密钥」**，不是修复代码。

---

## D-002 · 不存在"手工热修包"这条路径

- 出包只有一条路：源码 → 快照 → CI/本机构建（`docs/build-standard.md` §0）。
- 因此 `release/` 下的 `一键修复.cmd` / `run-fix.cmd` 之类**不是交付物**，是绕过门禁的暗路。
- 现值：`release/2026-09-11-win-hotfix/`、`release/2026-09-12-toolname-hotfix/` 已统一移入 `release/_voided-manual-hotfixes/`，并保留各自的 `_已作废-请勿分发.md`。
- 需要修的东西：重新出包，不要在老师机器上打补丁。

---

## D-003 · 公式引擎的语义边界：与 Excel 对齐，且"绝不猜"

- 支持的函数清单是**封闭集合**（`plugins/mochi-sheets/formula.mjs` 的 `BUILTIN_SUPPORTED_FUNCTIONS`）；不在名单里的一律 `#NAME?` 并点名，**不给近似值**。
- 条件聚合（COUNTIF/SUMIF/AVERAGEIF）**支持通配符**：`*` 任意长度、`?` 单字符、`~` 转义（`~*` 是字面量星号）；只参与 `=` / `<>` 比较。
- SUBSTITUTE 第 4 参「第 N 次出现」按 Excel 语义：前 N-1 次命中的原文原样保留；N 超出命中数则原样返回；N < 1 报 `#VALUE!`。
- 这两条 2026-09-12 之前是**错的且静默**（`SUBSTITUTE("a-b-c","-","+",2)` 返回 `b+c`；通配符条件恒返回 0），已修，并由**零依赖测试** `plugins/mochi-sheets/test/formula-engine.test.mjs` 在 CI 里看守。

---

## D-004 · 本机一次性授权必须绑定动作（不是"查一下是个令牌就行"）

- LAN 服务的 `authorize(action, source)` 铸出的令牌是**动作绑定 + 一次性**的：为 `mark-seen` 铸的令牌不能用于 `block-peer`，且无论校验成功与否都会被消费掉。
- 违规时的错误码是 `LOCAL_APPROVAL_SCOPE_MISMATCH`（不是 `LOCAL_APPROVAL_REQUIRED`），便于区分"没批准"和"批准的范围不对"。
- 回归测试：`plugins/mochi-lan/test-limits.mjs`。

---

## D-005 · 收件箱满仓时回收"已确认看到"的旧收件，未读一条不丢

- 教室端收件箱上限 1000 条（`MAX_MESSAGES`）。满仓时**先回收最旧的、老师已点过「已看到」的收件**；若一条已读都没有，则明确返回 `MESSAGE_LIMIT`（429）。
- 理由：旧实现直接 429 且全库没有任何删除路径 → 教室端**永久**收不到新通知，而 dispatch 侧把 429 当 `NOT_SENT` 反复重试。
- 原则：**宁可明确拒绝，也不静默丢弃未读通知。**
- 回归测试：`plugins/mochi-lan/test-limits.mjs`（`testMaxMessages` 是测试旋钮）。

---

## D-006 · 核心纯函数必须配"零依赖测试入口"

- 背景：公开 CI 不装依赖，凡是 `import '@deepseek-ai/dsh-tools'` 或 `exceljs` 的测试都进不了 CI。公式引擎因此长期零门禁，两个静默错值躲过了 23 个绿灯用例。
- 规则：**新写的核心纯函数（解析器/算法/校验器）要拆出只依赖 `node:*` 的模块，并配一个零依赖测试文件**，列入 `mochi-ci.yml` 的「插件测试」批次。
- 已有样例：`plugins/mochi-sheets/test/formula-engine.test.mjs`、`plugins/mochi-lan/test-limits.mjs`。

---

## D-007 · 改到快照清单里的文件，必须重算清单

- 打包白名单内的任何文件一改，`.github/windows-native-package-inputs.json` 的 `sha256/bytes` 就对不上，私有 CI 的第一步会直接拒绝出包。
- 收敛命令：`node scripts/reconcile-snapshot-manifest.mjs --write`；校验：`node scripts/check-snapshot-manifest.mjs --fail`。
- ⚠️ 不带 `--fail` 时**永远 exit 0**，所以"报告模式跑绿了"不等于清单一致。

## D-008 · 出厂默认对话模型 = DeepSeek V4.1 Flash（aiaaa 端点）

- 2026-09-13 用户拍板：`agentDefaultModel` 从 `mochi-mimo/mimo-v2.5` 切到 `mochi-aiaaa/deepseek-v4.1-flash`；MiMo 降为备选（教室端不变）。
- **切之前必须实测图片输入**（已做，两次 1×1 PNG 均被接受且能区分颜色系）：内核对带图消息只校验当前模型的 `inputModalities`（`dsh-api-session-controller.prompt()`），**没有自动切视觉模型的兜底**——默认模型不带 image 就是看图直接坏。禁止凭"应该支持"声明模态。
- 改动收口在 `apps/desktop/scripts/seed-packaging-keys.cjs` 的 `AUTHORITATIVE_PROVIDERS`（唯一权威表）；seeds 构建期生成 + gitignored，本机/CI 各自渲染。
- 已知代价：换默认模型 = 换工具面前缀，**首轮缓存全价**（实测 v4.1-flash 稳态 99.22%，2–3 轮恢复）。
- 回归：`test-package-resources`（含注册面工具名断言）、`test-runtime-profile`、快照清单 `check --fail`。
