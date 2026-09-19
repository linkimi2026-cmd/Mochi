# 文档清单与整理记录

> **status**: active
> **last_verified**: 2026-09-14
> **verified_by**: Codex

## 整理后的结构

| 类别 | 入口 | 维护规则 |
|---|---|---|
| 项目入口 | `README.md` | 只保留启动、目录和核心链接 |
| 产品总览 | `Mochi-总体方案.md` | 只写当前定位、能力、交互和边界 |
| 当前状态 | `docs/PROJECT-STATUS.md` | 分开记录机器事实、用户确认与未验证项 |
| 开发运行 | `docs/RUNTIME-FACTS.md`、`docs/build-standard.md` 等 | 与源码同步，冲突时修正文档 |
| 工程质量 | `docs/QUALITY-GATES.md`、根 `package.json` | 记录真实门禁、依赖边界与仍未覆盖的技术债 |
| 交付验收 | `docs/DELIVERY-LEDGER.md`、`参赛材料/真机验收记录.md` | 每个结论标明证据层级 |
| 参赛材料 | `参赛材料/`、`参赛PPT/`、`promo/` | 面向提交和演示；当前 PPT 与历史 PPT 必须分目录保存 |
| 源码提交 | `docs/SOURCE-SUBMISSION.md`、`scripts/package-competition-source.mjs` | 控制 500 MB 上限、排除项、敏感信息和逐文件校验 |
| 快速安装 | `docs/QUICK-START.md`、`scripts/assemble-competition-delivery.mjs` | 按系统选择安装包，汇集校验清单，不重新构建二进制 |
| 历史设计 | `docs/history/foundation/` | 冻结为 2026-09-04 时点的设计参考 |
| 历史工单 | `docs/tasks/` | 记录实施过程，不汇总当前状态 |
| 历史报告 | `docs/history/` | 保留仍有追溯价值的时点报告 |
| 调研 | `docs/research/`、`docs/reuse-audit.md` | 记录来源、版本、许可证、采用理由和验证范围 |
| 代码旁文档 | 各插件、包和脚本目录中的 README / SKILL / LICENSE | 与相邻代码一起维护，不集中搬迁 |

资源的物理位置与主入口见 `docs/RESOURCE-MAP.md`，项目演变和外部校园项目边界见 `docs/PROJECT-HISTORY.md`。

## 本轮删除

以下内容已被现行总览、源码和 Git 历史取代，继续保留在工作树只会制造冲突：

- `ARCHITECT_STATE.md`
- `MIGRATION_AUDIT_REPORT.md`
- `Mochi-方案总纲.md`
- `Mochi-桌面端原生化方案.md`
- `Mochi_系统提示词_V1_完整阅读版.md`
- `Mochi_系统提示词_V1.2_完整阅读版.md`
- `免费搜索工具调研_2026-09-06.md`
- `评审导向系统评估_2026-09-04.md`
- `1.5阶段任务/`
- `第二阶段/`
- `plan/`
- `docs/AUDIT-2026-09-12.md`
- `docs/AUDIT-CODE-2026-09-12.md`

这些文件原本由 Git 跟踪，可从版本历史恢复。删除理由是“被取代或属于过时时点”，不表示其中所有历史信息都错误。

本轮早期生成的 `docs/handoff/` 和 `docs/archive/` 已合并进现行文档后移入系统废纸篓，避免交接页再次成为第二套状态源。未跟踪的创意草稿 `Mochi_夏日回响.md` 也移入同一废纸篓目录，保留可恢复性：

`~/.Trash/Mochi-doc-cleanup-2026-09-13/`

## 本轮移动

| 原路径 | 新路径 | 原因 |
|---|---|---|
| `A2A_RELIABILITY_REPORT.md` | `docs/history/A2A_RELIABILITY-2026-09-05.md` | 时点报告仍有追溯价值，但不是当前状态 |
| `GitHub-Skill调研_2026-09-12.md` | `docs/research/GitHub-Skill调研_2026-09-12.md` | 归入调研 |
| `评审导向再评估_2026-09-12.md` | `docs/history/评审导向再评估_2026-09-12.md` | 旧 PPT 结论已被取代，归入历史报告 |
| 根目录两张调试图片 | `docs/assets/loose/` | 清理根目录，保留证据素材 |
| 根目录两份参考 DOCX | `docs/reference/user-materials/` | 与现行说明分开，保留原始资料 |
| 根目录提示词阅读稿 | `docs/reference/prompt-archives/` | 明确为存档，不冒充运行时配置 |
| 根目录上游 ZIP | `release/source-snapshots/` | 与参赛源码包、当前依赖分开 |
| 旧 PPT 与录屏截图 | `参赛PPT/history/`、`参赛PPT/evidence/` | 当前、历史、证据分层 |
| `foundation/ui/` 两份生效样式 | `client-plugins/jxl-theme/styles/` | 生效资产归运行插件维护，避免从历史目录构建 |
| 答辩 `.build/` 中的制作脚本 | `参赛PPT/Mochi四分钟答辩/scripts/` | 源脚本与中间 PPT、渲染图分开 |
| 外部“测试”目录中的宣传片轻量输入 | `promo/inputs/` | 消除个人绝对路径；大体积媒体仍按 `.gitignore` 留在本机 |

## 本轮保留

- `docs/reference/prompt-archives/Mochi_系统提示词_V1.3_完整阅读版.md`：提示词阅读存档；运行时以 patch 和配置为准。
- `WORKLOG.md`：追加式历史日志，保留稳定路径以免破坏大量旧引用；不再作为当前状态入口。
- `docs/history/foundation/`：包含尚未完全被一份文档替代的设计背景，保留并增加历史声明。
- `docs/tasks/`：实施证据仍有价值，保留并增加索引；完成状态不能覆盖项目现状。
- `docs/reference/user-materials/`：保存用户提供的宣传片制作规范与提示词接入说明，不能当作当前执行状态。
- 插件、包、技能、第三方许可和宣传片工程中的本地说明：与对应实现一起保留。

## 不在本轮整理范围

`node_modules/`、安装包、构建 staging、缓存、`.nosync` 运行副本和独立的“联动计划”项目不属于 Mochi 源文档清理范围。它们内部可能含 README 或许可证，不能按普通项目文档删除。

当前答辩采用 `参赛PPT/Mochi四分钟答辩/output/Mochi_四分钟答辩_内嵌视频.pptx`，包含 80 秒视频与四页重点讲述，总目标 4 分钟。旧 17 页演示已移入 `参赛PPT/history/`，截图与操作脚本已移入 `参赛PPT/evidence/`。参赛源码包仍排除 `参赛PPT/`，新版在完整交付目录单独提供。
