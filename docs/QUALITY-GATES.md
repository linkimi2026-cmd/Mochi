# 工程质量门禁与依赖边界

> **status**: active
> **last_verified**: 2026-09-14
> **verified_by**: Codex（根锁文件、CI、源码与本机命令）

## 一条命令复核核心质量

```bash
npm ci --ignore-scripts
npm run check
```

根 `package.json` 只服务仓库级质量检查，不是桌面应用运行入口，也没有声明 npm workspace。它锁定 Biome、TypeScript 和五个核心插件测试所需的最小依赖。桌面开发与打包仍从 `apps/desktop/package.json` 开始。

`npm run check` 依次执行：

1. 核对第一方插件的依赖边界、桌面 lockfile 与 vendored tarball；
2. 对五个核心插件、Electron 主进程与桌面渲染源码执行 Biome lint；
3. 检查质量配置与质量脚本的格式；
4. 对首批三个稳定 `.mjs` 模块执行 TypeScript `checkJs`；
5. 执行 modes / visuals / sheets / documents / presentations 的全部 126 个测试。

CI 中这些步骤都是硬门禁。Windows 快照也固定使用 `node scripts/check-snapshot-manifest.mjs --fail`，不再允许漂移后继续通过。

## 依赖安装边界

| 边界 | 包管理器与锁 | 职责 |
|---|---|---|
| 仓库质量检查 | 根 `package-lock.json`，npm 11 lockfile v3 | lint、格式、首批插件类型检查、五个核心插件测试 |
| Electron 桌面端 | `apps/desktop/package-lock.json`，npm | 桌面运行、原生依赖、安装包与完整 vendored 运行闭包 |
| 独立插件开发 | 相邻 `pnpm-lock.yaml` 或 `package-lock.json` | 只用于声明了独立锁的插件或包 |
| 无相邻锁的第一方插件 | 由桌面 lockfile 托管 | 不单独执行安装；直接依赖必须使用精确版本并能在桌面 lockfile 中找到 |

`scripts/quality/check-dependency-boundaries.mjs` 会阻止无锁插件悄悄引入桌面闭包之外的依赖，也会检查桌面 `file:` 依赖指向的 tarball 是否真实存在。它不能证明上游包没有漏洞，也不能替代原生 Windows / macOS 出包验证。

## 当前覆盖与剩余债务

### 已确认事实

- 本轮实测五个核心插件为 126/126 通过；测试文件并非全部直接导入 `@deepseek-ai/dsh-tools`，真实问题是插件入口和第三方库需要安装依赖。
- `apps/desktop/package-lock.json` 当前含 235 个 `@deepseek-ai/*` 包条目，其中 222 个版本为 `0.1.3-alpha.1`；桌面 `package.json` 有 230 个直接 `@deepseek-ai/*` 依赖，其中 222 个指向该 alpha。原“约 270 个全部是 alpha”不准确。
- `apps/desktop` 的运行依赖使用仓库内 tarball 和 lockfile 固定。固定版本提高可复现性，但不会消除上游 alpha 的 API 与维护风险。
- 当前 Biome lint 扫描 94 个核心源码文件；错误会阻断，既有 warning 先保留为迁移队列。
- 格式硬门禁当前只覆盖根质量配置和 `scripts/quality/`。对全部历史源码一次性重排会制造大 diff，因此按修改范围逐步扩大。
- 插件类型检查当前只覆盖 `mochi-modes/modes.mjs`、`mochi-sheets/address.mjs` 与 `mochi-visuals/image-meta.mjs`，并使用非 strict 的 `checkJs` 作为第一阶段。其余 `.mjs` 仍不能称为已有完整类型保障。

### 已确认但未在本轮消除的供应链风险

根测试闭包执行 `npm audit` 当前报告 4 项：ExcelJS 经旧版 uuid 带来 2 个 moderate 条目，PptxGenJS 经 image-size 带来 2 个 high 条目。npm 给出的自动修复是降级主依赖，可能破坏现有文档和课件能力，本轮未采用。升级或替换必须先跑对应生成、读取和安装包回归。

### 本机大目录

`campus.nosync`、`mochi-harness-src.nosync` 和 `artifacts/architect-audit` 分别用于兼容回退、固定上游追溯和审计证据，均被 Git 与参赛源码包排除。本轮已删除 920 MB 的 `apps/desktop/node_modules.broken` 与约 240 MB 的两个过期打包资源备份；保留仍在使用或承担证据职责的目录。

源码中还删除了未被任何入口、包清单或快照引用的 `plugins/mochi-sheets/formula 2.mjs`；现行公式实现只保留 `formula.mjs`。

## 扩大门禁时的顺序

1. 先让新增目录在本机 lint / format / `checkJs` 零错误，再加入根脚本；
2. 需要第三方依赖的测试先补入根 lockfile，禁止在 CI 用浮动 `npx` 临时下载；
3. 涉及 Electron 原生模块的测试放到对应原生 runner，不能用 Linux Node 测试冒充安装包验证；
4. 升级 `@deepseek-ai/*` 前先重建 vendor 闭包，再执行插件测试、桌面类型检查、快照和双平台安装包回归。
