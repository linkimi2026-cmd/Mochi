# 08 · UI 迁移计划（UI_MIGRATION_PLAN）

> 原则（硬指令）：**Harness 功能骨架 + 嘉行联产品皮肤与交互语言**。
> 不把旧网站整个复制进 Harness；不重绘 generic AI 界面；不删 Harness 结构。

## 1. 三阶段路线

### 阶段 A：令牌桥换肤（P0，不动结构）
- 建 `client-plugins/jxl-theme`（或 Electron `insertCSS` 兜底），只做一件事：
  **把嘉行联令牌值映射到 `--dsw-*` 语义别名**，不改任何组件结构。
- 映射表（初版，PHASE_2 实测校准）：

| 嘉行联 | → `--dsw-*` 语义层 | 说明 |
|---|---|---|
| `--canvas` / `--rui-canvas` | 应用背景/画布别名 | 暖米白 #f5f2e9（暗 #1b211e） |
| `--surface` / `--surface-strong` | 面板/表面别名（`--dsw-elevation-*` 配套） | 暖白 #fcfaf4 |
| `--ink` / `--ink-strong` / `--muted` | 正文/标题/次要文字别名 | 墨绿灰体系 |
| `--sage-600` / `--sage-800` / `--rui-brand` | 主色/链接/焦点（`--dsw-alias-link`、focus） | 鼠尾草绿 #45584e / 翠绿 #56ae7f |
| `--accent` #d9873e | 强调/active | 暖橙，仅点缀 |
| `--danger` / `--success` | 语义红/绿 | 红涨绿跌仅用于行情类，业务红绿按嘉行联语义 |
| `--radius-*` 8–28/pill | 圆角别名（对齐官方 superellipse corner-shape） | |
| `--shadow-card/float` | `--dsw-elevation-panel/prominent/soft` | |
| `--font-sans/serif/title` | 字体别名 | 标题可用宋体衬线 |
| `--spring` / `--dur-*` | 官方动效别名 | 官方 0.5px hairline 保留 |

- 规则：嘉行联值原样入境（用户已确认 `--sage-800`/`--accent` 不许调）；不在组件 CSS 写字面色
  （遵守官方 web-styling 组件规则）；dark mode 用嘉行联暗色整套，不发明新暗色。

### 阶段 B：品牌与教师视角 slot（P1，机制核实后）
- `jxl-brand`（sidebar 品牌位）、`jxl-workspace`（Today/Teacher Workspace tab）、
  `jxl-work-cards`（任务卡/Artifact 卡/传话卡 keyed node）、`jxl-settings`（连接嘉行联）。
- 前置：PHASE_0 核实第三方 client 插件注入机制（`06` §2 ⚠️）。机制不可行时降级为
  Electron 层 chrome + DOM 注入最小集，slot 功能延后。

### 阶段 C：Electron 外壳融合（P1）
- 无边框窗口 + 嘉行联材质标题区；ExpressiveOrb 悬浮层（任务/等待/A2A/交付状态，可戳）；
  桌面通知替代 Web Push；MemoryRouter/localStorage 桌面化按 plan/11 §6 执行。
- 专业页面（Trajectory/Settings/Plugins）不加 Orb，不加装饰动画。

## 2. 保留清单（不许丢的 Harness UI）

Session 列表与 resume、审批卡、Trajectory（Advanced 内完整可达）、插件管理页、Settings→Models、
附件/预览、Schedule、Plan/Goal/Subagent UI。教师默认视图可折叠它们，但**删掉底层能力=验收不通过**。

## 3. 红线自检（每个 PR 必查）

1. 全项目无横向滚动条（逐断点验）。
2. 有字的地方都在圆角矩形里。
3. 颜色跨度不大：鼠尾草绿阶 + 暖白画布 + 暖橙点缀；禁大面积高饱和渐变。
4. 无塑料感：禁 AI 卡片墙、禁无意义玻璃（玻璃只上控制层）、禁无意义英文文案。
5. 动画只解释状态变化；`prefers-reduced-motion` 全降级。

## 4. 验收（细则见 `36`）

实机截图矩阵：Desktop/iPhone/Android/Tablet × Light/Dark/Reduced Motion；
与现有嘉行联网站、真实 dsh Web UI 双向对比；结论必须能写成：
**看起来像嘉行联的产品，用起来像真正的 Harness。**
