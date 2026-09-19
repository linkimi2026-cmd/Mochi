# 文档治理与冲突处理

> **status**: active
> **last_verified**: 2026-09-14
> **verified_by**: Codex

## 裁定顺序

同一事实出现冲突时，按以下顺序处理：

1. 用户在当前任务中的明确更正与验收结论；
2. 当前源码、配置和可复现的机器检查；
3. [项目现状](PROJECT-STATUS.md)、[交付台账](DELIVERY-LEDGER.md)和[决策记录](DECISIONS.md)各自管辖的内容；
4. 当前操作与开发说明；
5. 工单、旧设计、审计报告和工作日志。

用户确认能说明真实现场结论，但不能自动补出包哈希、设备型号或测试日志。源码能说明能力和默认行为，但不能自动证明某台机器或线上服务已经验收。

## 文档职责

| 文档 | 负责回答 |
|---|---|
| `README.md` | 从哪里开始，项目目录是什么 |
| `Mochi-总体方案.md` | 产品是什么、当前能力和边界是什么 |
| `docs/PROJECT-STATUS.md` | 当前已确认、用户确认、未验证的状态 |
| `docs/DELIVERY-LEDGER.md` | 磁盘上有哪些交付物，验收到什么层级 |
| `docs/DECISIONS.md` | 已经拍板且仍影响实现的决定 |
| `docs/RUNTIME-FACTS.md` | 启动、配置、插件和服务接线的技术事实 |
| `docs/gateway-aiaaa-verified-facts.md` | 出厂默认模型链背后的第三方网关实测能力事实（模型清单、视觉、思考不可控、配额与思考耦合、上下文上限、缓存、错误形状） |
| `docs/build-standard.md` | 如何构建、打包和校验 |
| `docs/QUALITY-GATES.md` | CI、依赖边界、lint、格式和类型检查覆盖 |
| `参赛材料/*` | 对评委和使用者的现行说明 |

`docs/history/foundation/`、`docs/tasks/`、`WORKLOG.md`、`docs/history/` 和 `artifacts/` 都是历史或证据层。它们可以解释为什么形成现在的设计，不能覆盖现行文档和源码。

## 事实标记

- **已确认事实**：当前源码、配置、文件或可复现命令直接支持。
- **用户确认**：用户明确说明已完成或已验收，但当前仓库没有完整机器证据。
- **合理推测**：根据多个事实推导，必须写出依据和不确定性。
- **未验证假设**：缺少必要证据，不写成完成状态。

## 维护要求

新建或大幅修订的现行文档应包含：

```markdown
> **status**: draft | active | superseded | archived
> **last_verified**: YYYY-MM-DD
> **verified_by**: 核对者与证据范围
```

实施新功能前，按项目 `AGENTS.md` 完成 GitHub 检索、许可证和兼容性核对，并把采用结论记录在 `docs/reuse-audit.md`。文档整理也应先检查成熟的组织方案，但不应为简单 Markdown 仓库无故引入站点生成依赖。

现行文档链接检查：`node scripts/check-doc-links.mjs`。历史档案不进入该门禁，避免删除已经被取代的旧入口后被历史文字反向阻塞。

删除历史文件前应先确认是否已被现行文档取代。已跟踪文件可通过 Git 历史恢复；未跟踪的用户资料优先移动或保留，不做不可恢复删除。
