# 33 · 开放问题（OPEN_QUESTIONS）

> 规则：未读到的事实一律标 `TO_BE_RESOLVED_DURING_REPO_AUDIT`，禁止编造路径/API。

| # | 问题 | 阻塞 | 解法/Owner |
|---|---|---|---|
| Q1 | 第三方 client 插件如何进入官方 Web SPA：bundle patch 注入 vs client 树构建时纳入？slot 注册在运行时是否可从树外包发生？ | 阶段 B（slot UI） | **✅ 已收口（2026-09-04 晚）**：浏览器插件清单 = loader 树中 `dsh.client` 配置行，node half 扫描进 `window.__DSH_BOOT__` 并服务 `/plugins/<id>/client.js`（证据：`packages/bundle/web-app/cordis.patch.yml` 注释、`packages/client/web/README.md`）→ **insert 行注入路线成立**。残余（小）：client bundle 发现契约字段（`jxl-theme/package.json` 的 `dsh.client.entry` 为假设），验证步骤见 `client-plugins/jxl-theme/README.md`，Codex 半天任务 |
| Q2 | `--dsw-*` 语义别名的完整清单与官方 light/dark sheet 结构 | 阶段 A 映射表 | **✅ 已收口（2026-09-04 晚）**：80 个 `--dsw-alias-*`（grep 实测）+ `--dsw-font-*` 字号阶梯；暗色钩子 = `body[data-ds-dark-theme]`（`ui-layout/src/client/theme-presenter.ts:14,45`）。映射落地：`foundation/ui/jxl-theme-bridge.css` |
| Q3 | mochi-web profile 的 web-app patch 与 Mochi 插件共存的最终 patch 文本 | PHASE_1 | **✅ 已收口（2026-09-04 晚）**：`profiles/mochi-web/` 已建成，`--dump-config` 148 行装配通过（persona 覆盖生效、遥测 DISABLED、webserver/ui-theme/mochi 三插件在树） |
| Q4 | Electron WebView 加载官方 SPA 的官方暗示路径（`file://` + IPC bridge）在 0.1.3-alpha.1 的具体做法 | 桌面壳 | PHASE_1/PHASE_2 实测（07 factcheck Q4 既有结论复验） |
| Q5 | `ctx.workspace` 是否可被 Mochi 插件安全复用（Artifact 根目录归属） | Artifact store | PHASE_6 读 `packages/workspace` README |
| Q6 | mochi-core 跨插件 import 是否必要（Artifact store 共享） | 插件治理 | 优先走事件/服务共享；确需 import 时登记 |
| Q7 | 正式签名证书 | 发布 | 仅学校出资时做；演示用预案 |
| Q8 | 官方 eval harness 是否可用（plan 03 §6.3 提及待核实） | Eval | PHASE_3 检索 `packages/` testing 相关；否则自建轻量断言器 |
| Q9 | schedule_create ≥300s 限制对"课表提醒"场景的满足度 | calendar 族 | 如不满足：CONFIRM 档 + 说明文案，不 hack 内核 |
| Q10 | glm-4-flash 经 baseURL 的 thinking/多模态字段兼容性回归 | 模型 | PHASE_3 用 llm-probe 复跑 |

> 完成一项就在此表标注结论与证据路径，并同步 `12_REVISION_LOG` 或本包对应文档。
