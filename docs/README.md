# Mochi 文档目录

> **status**: active
> **last_verified**: 2026-09-18
> **verified_by**: Codex；2026-09-18 由 WorkBuddy AI 追加「不可替代性升级路线图」索引条目；2026-09-19 由 WorkBuddy AI 追加「桌面桌宠模式」索引条目

本目录只让现行文档承担当前结论。历史方案、工单和审计可以解释过程，但不再决定现在怎么运行。

## 先读

1. [项目现状](PROJECT-STATUS.md)
2. [现行总体方案](../Mochi-总体方案.md)
3. [演变过程与“联动计划”关系](PROJECT-HISTORY.md)
4. [资源地图](RESOURCE-MAP.md)
5. [参赛源码包](SOURCE-SUBMISSION.md)
6. [快速开始](QUICK-START.md)
7. [交付台账](DELIVERY-LEDGER.md)
8. [文档治理规则](DOC-AUTHORITY.md)
9. [工程质量门禁](QUALITY-GATES.md)
10. [文档清单与整理记录](DOCUMENT-INVENTORY.md)

## 开发与运行

- [运行事实](RUNTIME-FACTS.md)
- [构建标准](build-standard.md)
- [工程质量门禁](QUALITY-GATES.md)
- [全领域质量标准与提示词加载](agent-quality.md)
- [自动上下文压缩与科学建模复用](context-compaction.md)
- [PPT 质量改进记录](prompt-quality.md)
- [Agent 接入手册](agent-integration-handbook.md)
- [附件与成品渲染链路](attachment-and-render-pipeline.md)
- [现有文件操作](p1-existing-file-workflows.md)
- [不可替代性升级路线图（交接提案，draft）](upgrade-roadmap.md)
- [桌面桌宠模式（提案，draft）](desktop-pet-mode.md)
- [教室端预检](classroom-preflight.md)
- [命名规范](mochi-naming-convention.md)
- [缓存命中率](cache-hit-rate.md)
- [安装速度调查](installer-install-speed.md)
- [开源复用审计](reuse-audit.md)

## 专项实现记录

以下文档描述已经实现或曾经排查过的一个窄问题。结论使用前仍要和当前源码核对：

- [本地插件 API 审计](p0-alpha-local-plugin-api-audit.md)
- [运行配置闭环](p0-alpha-runtime-profile-closure.md)
- [视觉能力开源调研](visuals-oss-research.md)
- [工单索引](tasks/README.md)

## 产品、参赛与宣传

- [作品说明](../参赛材料/作品说明.md)
- [教师使用手册](../参赛材料/教师使用手册.md)
- [伦理与社会影响](../参赛材料/伦理与社会影响.md)
- [演示脚本与降级路径](../参赛材料/演示脚本与降级路径.md)
- [真机验收记录](../参赛材料/真机验收记录.md)
- [评审导向再评估（2026-09-12 历史报告）](history/评审导向再评估_2026-09-12.md)
- [宣传片工程](../promo/README.md)
- [系统提示词 V1.3 阅读存档](reference/prompt-archives/Mochi_系统提示词_V1.3_完整阅读版.md)

## 历史与证据

- [foundation 历史设计包](history/foundation/README.md)
- [历史实施工单](tasks/README.md)
- [追加式工作日志](../WORKLOG.md)
- [A2A 稳定性时点报告](history/A2A_RELIABILITY-2026-09-05.md)
- [GitHub Skill 调研](research/GitHub-Skill调研_2026-09-12.md)
- `artifacts/` 和 `probe-log.nosync/`：时点证据，不作为现行摘要。
- `reference/`：第三方参考材料，不是 Mochi 的执行指令。

如需判断“现在是否可用”，先读[项目现状](PROJECT-STATUS.md)，再用源码、运行检查或现场证据验证；不要从文件名中的“最终”“完整”“已完成”直接推断。

- [Yan Agent研究与能力改造](yan-agent-research.md)：版本核实、源码证据、主题/版式接线、视觉检查记录与验证边界。
