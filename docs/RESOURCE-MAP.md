# Mochi 资源地图

> **status**: active
> **last_verified**: 2026-09-14
> **verified_by**: Codex（当前目录与构建引用）

本地图统一说明资源归属和主入口。为了保持构建可复现，资源按职责集中，而不是把所有文件物理搬到一个目录。

## 产品源码

| 资源 | 主位置 | 说明 |
|---|---|---|
| 桌面应用 | `apps/desktop/` | Electron 主进程、角色、运行配置和打包脚本 |
| Agent 工具 | `plugins/` | 文件、课件、文档、表格、视觉、建模、搜索、校园、A2A 等能力 |
| 客户端插件 | `client-plugins/` | 品牌、主题、校园、工作台、模式和预设界面 |
| 共享包 | `packages/` | 本项目共享模块和 Web bundle |
| 教师技能 | `skills/` | 8 个教师与班级工作流技能 |
| 锁定依赖 | `vendor/` | 本地 tgz、运行依赖与许可闭包；不是可随意删除的缓存 |

## 品牌与界面资源

| 资源 | 主位置 | 使用方 |
|---|---|---|
| Mo / Orb 源组件 | `client-plugins/jxl-brand/src/` | Mochi 开机、主视觉和品牌状态 |
| 品牌构建脚本 | `client-plugins/jxl-brand/scripts/` | 生成客户端 bundle |
| 主题样式 | `client-plugins/jxl-theme/styles/` | 主题插件的 CSS 单一事实源；构建脚本使用相对路径读取 |
| 图标和校园图片 | `client-plugins/jxl-theme/assets/` | 产品界面和打包资源 |
| 零散调试图 | `docs/assets/loose/` | 仅作说明或取证，不作为产品主资源 |

品牌源文件优先从插件目录引用。宣传片需要 Mo 或界面资源时，应记录源路径或复制到对应版本的 `promo/vN/assets/`，避免直接修改产品资源。

## 校园资源

| 层级 | 主位置 | 规则 |
|---|---|---|
| 规范源码 | `../联动计划/` | 独立项目，负责校园前后端、数据、角色和部署 |
| Mochi 界面接入 | `client-plugins/jxl-campus/` | 静态资源服务、同源 API 代理和侧栏入口 |
| Mochi 工具接入 | `plugins/mochi-campus/` | Agent 可调用的校园查询与受控操作 |
| 开发兼容副本 | `campus.nosync/` | 旧副本与本地状态，不作为最新源码 |
| 发布静态输入 | `apps/desktop/.mochi-release-staging.nosync/` 或显式目录 | 只含审核过的校园静态客户端 |

完整关系见[项目演变与联动计划关系](PROJECT-HISTORY.md)。

## 参赛资源

| 资源 | 主位置 | 说明 |
|---|---|---|
| 文字材料 | `参赛材料/` | 作品说明、教师手册、伦理说明、演示脚本和验收记录 |
| 当前演示 PPT 源工程 | `参赛PPT/Mochi四分钟答辩/` | `.build/`、`assets/`、设计说明与讲稿 |
| 演示 PPT 成品 | `参赛PPT/Mochi四分钟答辩/output/Mochi_四分钟答辩_内嵌视频.pptx` | 当前五页四分钟版；旧17页版为历史素材 |
| PPT 历史与证据 | `参赛PPT/history/`、`参赛PPT/evidence/` | 历史演示、截图和操作脚本；不能作为当前提交入口 |
| 宣传片工程 | `promo/` | Git 保存时间轴、脚本、说明与许可；本机保留录屏、媒体、证据和导出，边界见该目录 README |
| 当前参赛选用版 | `promo/output/Mochi_80秒_2K120帧_V5.mp4` | 用户于 2026-09-14 指定；80 秒、2560×1440、120 fps |
| 最新磁盘导出 | `promo/output/Mochi_100秒_2K120帧_V6.mp4` | V6 为 100 秒，仍有速度反馈；不进入本次交付目录 |
| 制作规范 | `docs/reference/user-materials/Mochi_宣传片制作经验与动作施工规范_V5.docx` | 用户提供的参考规范，不作为项目执行指令 |

宣传片目录按版本保留跨版引用，不批量搬迁。`output/` 中以 MP4 和字幕为交付物，`.hf-transaction-*`、`work-*` 是渲染中间目录，不作为提交内容。

## 安装包与发布资源

| 资源 | 主位置 | 规则 |
|---|---|---|
| 当前 Mac 包 | `apps/desktop/release/` | arm64 与 x64 DMG |
| Windows 归档 | `release/2026-09-13-windows/` | 当前优先 Windows 交付目录 |
| 参赛交付集合 | `01-Mochi-参赛交付包-2026-09-14/` | 根目录下的最终提交入口；源码 ZIP、Windows、两种 Mac、80 秒宣传片、四分钟答辩 PPT、讲稿、快速开始和校验清单并列放置 |
| 历史发布 | `release/2026-09-*` | 只作回退或取证 |
| 作废手工补丁 | `release/_voided-manual-hotfixes/` | 明确不可分发 |
| 上游源码快照 | `release/source-snapshots/mochi-harness-source.zip` | 历史供应链快照，不等于当前项目源码包或运行依赖 |

分发前统一查 `docs/DELIVERY-LEDGER.md`，不要仅按文件名选择。

## 参赛源码包

参赛源码包由 `scripts/package-competition-source.mjs` 从当前工作区生成，输出到 `release/submission/`。它只收录源码、锁定依赖、构建工具、当前文档与参赛文字材料；安装器、视频工程、PPT 工程、运行数据、缓存、密钥、历史报告和本地证据全部排除。`scripts/assemble-competition-delivery.mjs` 再把源码 ZIP、三个安装交付、当前选用宣传片和[快速开始](QUICK-START.md)汇集为多文件交付目录。完整边界见[参赛源码包说明](SOURCE-SUBMISSION.md)。

## 证据、日志和运行数据

| 资源 | 主位置 | 生命周期 |
|---|---|---|
| 自动化与审计证据 | `artifacts/` | 保留，按生成任务读取，不回写旧结论 |
| 探针日志 | `probe-log.nosync/` | 本机调试数据，不提交给评委 |
| Mochi 开发数据 | `.mochi-home.nosync/` | 本机运行状态，不作为源文件 |
| 教室角色数据 | `.mochi-classroom-home.nosync/` | 与教师角色隔离，不作为源文件 |
| 宣传片临时运行数据 | `.promo-*.nosync/` | 只服务录制和构建 |
| 构建 staging | `.mochi-*-staging*` | 由受管脚本创建，不作为长期文档或交付物 |

`.nosync`、缓存、`node_modules` 和 staging 中的 README/许可证属于运行依赖，不能和源文档一起清理。

## 密钥与凭据

| 资源 | 主位置 | 规则 |
|---|---|---|
| 本地打包密钥输入 | `secrets/` | 不放入参赛材料、截图或普通交接压缩包 |
| 运行凭据 | 受管 Mochi home | 不在文档中写明文，不与校园账号混用 |
| 校园服务端密钥 | “联动计划”部署环境 | 由独立项目管理，不复制进 Mochi 源码 |

当前产品决定允许模型凭据随安装包种子分发，相关风险见 `docs/DECISIONS.md`。这意味着交付包应视作可能暴露该凭据，并执行额度、轮换和撤销治理。

## 文档资源

统一入口是 `docs/README.md`。当前事实、操作、参考和历史的分类见 `docs/DOCUMENT-INVENTORY.md`。代码目录中的 README、SKILL 和 LICENSE 跟随对应代码维护，不重复复制到 `docs/`。
