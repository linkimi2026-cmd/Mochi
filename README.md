# Mochi

> **status**: active
> **last_verified**: 2026-09-14
> **verified_by**: Codex（源码、配置、磁盘交付物与本次会话中的用户确认）

Mochi 是面向教师办公和校园协作的 AI Agent 桌面应用。它把对话、文件处理、课件与文档生成、数据整理、可视化、建模、知识库、联网搜索、校园查询和经授权的校园操作放在同一个工作区中。

## 从这里开始

- [参赛入口](00-参赛入口.md)：评委提交、现场演示和最终校验的统一入口。
- [项目现状](docs/PROJECT-STATUS.md)：当前能确认什么、用户确认了什么、还有什么没有验证。
- [现行总体方案](Mochi-总体方案.md)：产品定位、核心能力、操作逻辑与系统边界。
- [演变过程与“联动计划”关系](docs/PROJECT-HISTORY.md)：两个项目的职责、接入方式和历史节点。
- [资源地图](docs/RESOURCE-MAP.md)：源码、品牌、校园、参赛、安装包和证据分别在哪里。
- [参赛源码包](docs/SOURCE-SUBMISSION.md)：500 MB 提交边界、复现与校验方法。
- [快速开始](docs/QUICK-START.md)：按系统选择安装包并完成首次启动。
- [文档目录](docs/README.md)：按用途查找维护、开发、参赛和历史资料。
- [交付台账](docs/DELIVERY-LEDGER.md)：安装包、视频、PPT 及证据状态。
- [文档治理规则](docs/DOC-AUTHORITY.md)：冲突如何裁定，哪些内容只能作为历史参考。

## 快速启动

仓库根目录没有应用 `package.json`。桌面开发从 `apps/desktop` 开始：

```bash
cd apps/desktop
npm ci
npm run typecheck
npm run dev
```

Web 开发入口：

```bash
./mochi-dev-up.sh
```

`mochi-dev-up.sh cloud` 的默认地址仍是历史 Cloudflare Origin。接入当前校园后端前，应核实“联动计划”的实际部署地址，并通过 `MOCHI_CAMPUS_API_URL` 显式传入。详见[运行事实](docs/RUNTIME-FACTS.md)。

## 主要目录

| 路径 | 用途 |
|---|---|
| `01-Mochi-参赛交付包-2026-09-14/` | 根目录下的当前参赛交付入口；由脚本生成，不纳入 Git |
| `apps/desktop/` | Electron 桌面应用、运行配置和打包入口 |
| `plugins/` | Agent 工具与服务端插件 |
| `client-plugins/` | 品牌、工作台、模式、校园和模型预设界面 |
| `packages/`、`vendor/` | 自研包、锁定依赖与补丁发布物 |
| `skills/` | 教师工作流技能 |
| `docs/` | 现行开发、运行、交付与治理文档 |
| `docs/history/foundation/`、`docs/tasks/` | 设计和实施历史，仅供追溯 |
| `参赛材料/`、`参赛PPT/` | 比赛说明、手册、验收记录和演示 PPT |
| `docs/reference/` | 用户提供的参考资料与提示词存档，不作为当前运行事实 |
| `promo/` | 宣传片工程、脚本、素材、证据与导出 |
| `release/`、`apps/desktop/release/` | 不同时间和平台的安装包 |
| `artifacts/`、`probe-log.nosync/` | 审计与调试证据 |
| `../联动计划/` | 当前本机优先选择的校园后端源码，属于独立项目 |
| `campus.nosync/` | 历史校园副本和兼容回退，不能代表当前线上服务 |

## 维护原则

1. 当前行为以源码和可复现检查为准；文档与源码冲突时修正文档。
2. 产品设计、成功出包、用户现场确认和机器证据是不同层级，不能互相替代。
3. 新结论写入现行文档；工单、旧方案和工作日志只用于解释历史。
4. 修改插件、内核或打包资源后，遵守[构建标准](docs/build-standard.md)，同步实际需要更新的 tarball、lockfile 和快照。
5. 涉及校园写操作时仍执行权限审批；工作模式的限制降级不等于校园写权限放开。

## 当前参赛入口

新版答辩位于 `参赛PPT/Mochi四分钟答辩/output/Mochi_四分钟答辩_内嵌视频.pptx`，讲稿在同级工程目录。完整交付包直接位于项目根目录 `01-Mochi-参赛交付包-2026-09-14/`，其中 `06-答辩PPT/` 汇集当前 PPT 和讲稿。总目标 4 分钟，包含 80 秒宣传片；已补充痛点动机、技术架构和默契收束。
