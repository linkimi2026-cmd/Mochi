# 06 · Client UI 插件地图（CLIENT_UI_PLUGIN_MAP）

> 目标：保留 Harness 的真实 UI 结构，把嘉行联视觉与教师视角叠上去。
> 事实基础见 `01` §5（slot 名全部 grep 自官方仓库）。

## 1. 官方 UI 能力 → Mochi 处置

| 官方 UI | 处置 | 教师视角 |
|---|---|---|
| 会话视图 + composer | 保留（Chat 页） | 教师口语直接输入；Mochi 人格回复 |
| 审批确认卡（ui-approval） | 保留 | 文案具体化（`19` §4）；由 mochi-approval 决定走 AUTO/CONFIRM/DENY |
| Trajectory | 保留，默认收进 Advanced | 教师默认看 Work 摘要；评委回退看完整轨迹 |
| 插件管理页 | 保留 | "连接嘉行联"入口放这里 + 首页引导 |
| Settings→Models | 保留 | 模型切换一等公民（`10`） |
| Session 历史 / resume | 保留 | — |
| Schedule 目录 | 保留 | 课前提醒等 |
| Plan/Goal/Subagent/Workflow UI | 保留，默认折叠 | Advanced 可达 |
| 附件/上传/缩略图 | 保留 | Artifact 预览的底座 |

## 2. Slot 注入规划（client 插件 `jxl-*`）

| client 插件 | 目标 slot | 内容 |
|---|---|---|
| `jxl-theme` | （无 slot，样式层） | 令牌桥：嘉行联 calm-tokens 值 → `--dsw-*` 语义别名映射（`08` §3） |
| `jxl-brand` | `sidebar.brand.mark`、`sidebar.brand.name` | Mochi/嘉行联标识、中文品牌名 |
| `jxl-workspace` | `conversation.view`（新增 tab）、`conversation.hero.workspace` | **Teacher Workspace / Today**：今日流动、待确认、Artifact 快捷区 |
| `jxl-work-cards` | `conversation.chat.node`（keyed：新增 `mochi.task`、`mochi.artifact`、`mochi.relay` kind） | 任务卡、Artifact 卡、传话卡（6 态） |
| `jxl-settings` | `settings.general.item`、`settings.plugins.tab` | "连接嘉行联"配置、隐私开关 |

> ✅ **机制已收口（2026-09-04 晚，源码实证）**：浏览器插件清单 = loader 树中的 `dsh.client`
> 配置行（web-app bundle patch 以 `insert` 添加官方 ui-* 行），node half 扫描成
> `window.__DSH_BOOT__` 并服务 `/plugins/<id>/client.js`（`packages/bundle/web-app/cordis.patch.yml`
> 注释 + `packages/client/web/README.md`）→ **第三方 client 插件走同样 insert 路线成立**。
> 残余验证（Codex 半天）：client bundle 发现契约字段（见 `client-plugins/jxl-theme/README.md`）。
> 主题桥资产已就绪：`foundation/ui/jxl-theme-bridge.css`（80 个 `--dsw-alias-*` 实测映射，
> 暗色钩子 `body[data-ds-dark-theme]`）+ `client-plugins/jxl-theme/`；Electron `insertCSS`
> 为永远可用的兜底路。**不许在机制不明时自绘整套 UI。**

## 3. 信息架构（教师一级导航）

```
Today/Home（jxl-workspace tab）
Chat（官方会话视图，默认）
Work（任务/步骤/工具调用/审批/Artifacts 聚合 = Trajectory 教师化摘要）
Artifacts（交付物库）
Mochi Network（传话/派发任务卡）
Plugins（官方插件页 + 连接嘉行联）
Settings（官方设置 + jxl-settings）
Advanced（Trajectory / Session 工具 / Plan / Subagent / Schedule / 插件清单）
```

映射原则：Chat/Work 二分（`29` 节规格）；Advanced = 官方已有页面的重组入口，不删能力。

## 4. 视觉红线（用户反复确认过）

- 不许横向滚动条（全项目）；有字的地方都要圆角矩形；颜色跨度不要大（鼠尾草绿体系+暖橙点缀）；不许塑料感。
- 断点：Desktop / iPhone / Android / Tablet × Light / Dark / Reduced Motion 全矩阵验收（`36`）。
- Mochi（Orb）只出现在任务/等待/A2A/交付等状态场景，不进 Medical/Admin/Data/Audit 专业页面。
