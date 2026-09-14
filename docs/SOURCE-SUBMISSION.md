# Mochi 参赛源码包说明

> **status**: active
> **last_verified**: 2026-09-14
> **verified_by**: Codex

## 目标

源码包面向评委和后续维护者，必须满足三个条件：文件小于比赛平台 500 MB 限制；打开根目录即可理解工程；不夹带安装器、缓存、个人运行数据或密钥。

## 收录内容

- `apps/desktop/`：Electron 桌面宿主源码、配置、构建图标与测试脚本。
- `plugins/`、`client-plugins/`、`packages/`、`skills/`：Mochi 能力、界面和共享模块。
- `vendor/`：`package.json` 实际引用的本地 tgz 与许可闭包，用于复现依赖安装。
- 根 `package.json`、`package-lock.json`、`biome.json`：仓库级质量门禁与五个核心插件的可复现测试闭包。
- `.github/`、`scripts/`、`tools/`：快照清单、原生出包流程、校验和维护工具。
- 当前项目文档和 `参赛材料/`：总体方案、状态、资源地图、联动计划关系、开源复用审计、教师手册与验收记录。

## 明确排除

- `node_modules/`、`dist/`、`dist-electron/`、构建 staging 与所有 `.nosync` 目录。
- `release/`、`apps/desktop/release/`：安装器是独立二进制交付物，不属于源码包。
- `promo/`：原始录屏、渲染缓存和历史视频体积过大；成片单独提交。
- `参赛PPT/`：新版四分钟答辩已完成；为保持源码包职责清晰，在项目根目录的完整交付包 `06-答辩PPT/` 单独提供。
- `artifacts/`、`probe-log.nosync/`、`.mochi-*-home*`：证据、日志和个人运行数据。
- `secrets/`、凭据种子、`.env*`、含演示密码的历史工作日志。
- `docs/history/`、`docs/tasks/`、`docs/research/`、`docs/reference/`：追溯资料留在工作区，不进入评委源码包；现行 `docs/reuse-audit.md` 保留在源码包中。

“排除”不代表删除源工作区内容；它表示不向评委提交不必要、不可复现或可能泄露敏感信息的文件。

少量专项审计文档会保留指向 `artifacts/`、`.nosync` 上游检出或历史目录的证据路径。这些目标只服务原工作区追溯，按上述边界不随源码包分发，也不是构建依赖；可复现输入以 `vendor/`、锁文件和快照清单为准。

## 生成与校验

```bash
node scripts/package-competition-source.mjs
unzip -t release/submission/Mochi-参赛源码包-2026-09-14.zip
shasum -a 256 release/submission/Mochi-参赛源码包-2026-09-14.zip
```

打包脚本执行以下守卫：只读取 Git 已跟踪文件和未忽略的新文件；拒绝符号链接；扫描私钥、API key 与演示密码；生成逐文件 SHA-256 清单；验证 ZIP 结构；强制成品小于 500,000,000 字节。

## 评委阅读顺序

1. `README.md`
2. `Mochi-总体方案.md`
3. `docs/PROJECT-STATUS.md`
4. `docs/PROJECT-HISTORY.md`
5. `docs/RESOURCE-MAP.md`
6. `参赛材料/作品说明.md`

## 构建边界

macOS 安装器必须在目标架构的原生 macOS 环境构建，Windows x64 安装器必须在 Windows x64 runner 构建。源码包只证明代码、依赖和构建输入齐全，不等于评委机器已经完成安装验收。当前二进制交付证据见[交付台账](DELIVERY-LEDGER.md)。

源码包、三个安装包、当前参赛选用的 80 秒宣传片和答辩 PPT 集中到项目根目录 `01-Mochi-参赛交付包-2026-09-14/`。该目录是多文件交付集合，逻辑体积超过 500 MB；500 MB 限制由其中的源码 ZIP 单独满足。
