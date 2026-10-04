# Mochi 决策记录（DECISIONS）

> **status**: active　**last_verified**: 2026-09-24　**verified_by**: Codex（核对当前无密钥安装包与历史决定）
> **性质**：记录**已经拍板、且会影响后续 Agent 判断**的决定。目的是让后来者不要反复"修好"一个其实是有意为之的设计。
> 只记决定、理由和代价；不汇总排期或项目状态。当前状态见 `docs/PROJECT-STATUS.md`，实现见源码与 `docs/RUNTIME-FACTS.md`。

---

## D-001 · 历史决定：模型密钥随安装包分发（不适用于 2026-09-24 当前包）

- **当时的决定**（作者，2026-09-12）：安装包内置模型密钥，老师装完即用、不需要填任何 API key；当时还计划未来更换官方 key 后继续随包分发。
- **当时的实现**：`apps/desktop/resources/mochi-web/seeds/credentials-seed.json`（构建期由 `seed-packaging-keys.cjs` 从 `secrets/packaging-keys.local.yaml` 或 CI Secrets 渲染）→ `build.extraResources` 打进 `Resources/mochi/profile/seeds/` → 首启由 `electron/dsh/seed.ts` 合并进 `<home>/.credentials.yaml`。
- **已知代价（必须公开承认）**：
  1. 拿到安装包的人都能解出这两枚 key，**等同公开**；
  2. 全量老师共用一个额度，一枚泄漏 = 所有人不可用；
  3. 已经发生的现实：`release/2026-09-09/Mochi-0.1.0-mac-arm64.dmg`（9/11 08:44 构建）内已含明文 key。
- **历史治理设想**：换官方 key 时轮换、限额、可撤销；每位老师单独凭据或网关按设备限额当时未做。2026-09-12 的两轮独立审计指出随包 Key 可被提取；作者当时接受该风险。
- **当前边界**：2026-09-24 macOS arm64 包已改为 `--without-key-seeds`，挂载核对只有非密钥设置种子，老师需要自己配置并测试 Key。此项是当前**包的实测事实**，不推断作者对未来所有版本的密钥分发政策已经作出永久决定。当前出包按 [D-009](#d-009--当前发行包不预置模型密钥) 和[交付台账](DELIVERY-LEDGER.md)核对；不得按本条历史描述重新装入凭据。

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

## D-005 · 收件箱满仓时仅回收签名回执已确认的普通通知

- 教师与教室收件都有容量上限（默认 `MAX_MESSAGES` 为 1000）。满仓时只回收最旧的、`seenReceipt === 'ACKNOWLEDGED'` 的普通 `NOTIFY`，且不能带请求、回复、处置名册或附件。仅点了“已看到”而回执投递结果仍是 `UNKNOWN`，以及教师已看但尚未回复的预约，都保留原消息。历史超限时要有足够的安全回收项才能写入新消息。
- 理由：旧实现直接 429 且全库没有任何删除路径，会让已看普通通知长期堵住新通知；但把所有 `seenAt` 收件回收又会删掉可回复请求或待重试回执，破坏 `replyToMessageId` 校验。
- 原则：**宁可明确返回 `MESSAGE_LIMIT`（429），也不静默丢弃仍承担流程校验的收件。** 长期容量需另定保留期与持久归档，现有回收不是无限历史方案。
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
- 默认模型定义收口在 `apps/desktop/scripts/seed-packaging-keys.cjs` 的 `AUTHORITATIVE_PROVIDERS`（唯一权威表）；当前无密钥包仅从该表生成 `settings-defaults.json`，不随包生成凭据种子。教师新对话沿用 aiaaa，教室新对话用 MiMo；模型默认选择不等于该服务已有可用 Key。
- 已知代价：换默认模型 = 换工具面前缀，**首轮缓存全价**（实测 v4.1-flash 稳态 99.22%，2–3 轮恢复）。
- 回归：`test-package-resources`（含注册面工具名断言）、`test-runtime-profile`、快照清单 `check --fail`。

## D-009 · 当前发行包不预置模型密钥

- **适用范围**：2026-09-24 已核的 macOS arm64 包；后续产物需逐包核验。当前 Windows 原生 CI 已按相同 `--without-key-seeds` 参数出包，但只确认构建命令和私有草稿 EXE 元数据，尚未下载解包检查其实际 `profile/seeds`，不能把 Windows 包内容写成已核实。
- **可核事实**：挂载包的 `profile/seeds` 仅有 `settings-defaults.json`；首启能写入教师默认模型设置，凭据引用数为零。使用者在本机模型设置中自行保存 Key，连接测试与新会话模型选择分开；真实供应商 Key 尚未完成现场验收。
- **出包规则**：后续是否恢复集中发放凭据必须形成新的明确决定，记录授权范围、轮换和失效方式，并核对实际安装包。不要从 D-001 的历史文字自动恢复打包明文 Key；也不要删除非密钥默认模型设置种子，否则教师首启会退回基础包默认路由。
- **证据**：[交付台账](DELIVERY-LEDGER.md)、[双端升级记录](product-upgrade-2026-09-24.md)及 `test-package-resources`/`test-runtime-profile`。
