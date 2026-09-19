# Mochi 项目现状

> **status**: active
> **last_verified**: 2026-09-14
> **verified_by**: Codex（源码、配置、磁盘交付物与本次会话中的用户确认；未重新部署或执行完整现场验收）

## 已确认事实

| 范围 | 当前状态 | 依据 |
|---|---|---|
| 应用版本 | 桌面应用版本为 `0.1.0` | `apps/desktop/package.json` |
| 桌面形态 | Electron 外壳，桌面开发入口在 `apps/desktop` | package scripts 与 Electron 源码 |
| 角色 | 运行配置包含 `teacher` 和 `classroom` 两个角色配置 | `runtime-profile.json` |
| 初始模型 | 新配置默认种子为 `mochi-aiaaa / deepseek-v4.1-flash`，支持文字和图像输入；该路由的 `contextWindow` 声明为 1,000,000、`maxTokens` 为 256,000（实测事实，见 [网关实测事实](gateway-aiaaa-verified-facts.md)），刻意不声明 `reasoningEfforts`（网关忽略该字段） | `settings-defaults.json`、`scripts/seed-packaging-keys.cjs` |
| 辅助调用配额 | aiaaa 网关思考不可关闭且计入 `max_tokens`，任何辅助调用的输出配额都必须显著高于思考预算：会话标题覆盖为 `maxOutputTokens: 2048`（`patches/core.patch.yml`）；压缩摘要覆盖为 `maxTokens: 16384`，落在**各 preset 自己的压缩组**（宿主面同名行被 `dsh-web-app` 置为 `disabled: true`，写 patch 不生效） | `patches/core.patch.yml`、5 处 `agent.cordis.yml`、`apps/desktop/scripts/test-compaction.mjs` |
| 服务默认值 | `campusApiUrl` 已版本化为 `https://jyl-campus-health-entry.pages.dev`（安装包开箱即连）；`searxngEndpoint` 仍为 `null`（无可信的随包搜索端点，保持不配置） | `runtime-profile.json` |
| 校园源码选择 | 显式环境变量优先，其次同级“联动计划”，最后兼容副本 `campus.nosync`；本机当前解析到同级“联动计划” | `scripts/campus-paths.cjs` 及本轮运行结果 |
| 能力插件 | 当前源码包含课件、文档、文件、表格、视觉、建模、知识库、记忆、搜索、成绩、校园、调度、A2A、局域网、模式与预设等能力 | `plugins/`、`client-plugins/`、`skills/` |
| 快照清单 | 504 项、91,992,954 字节，当前检查为 0 缺失、0 不一致（`check-snapshot-manifest.mjs --fail` 退出码 0） | `.github/windows-native-package-inputs.json` 与检查脚本 |
| 工程质量 | 根 lockfile 可冷安装；核心 lint、首批插件 `checkJs`、依赖边界和五个核心插件 131 个测试已进入 CI 硬门禁 | 根 `package.json`、`.github/workflows/mochi-ci.yml`、`docs/QUALITY-GATES.md` |
| 宣传片 | 当前参赛选用 V5，规格为 2560×1440、120 fps、80 秒；另有未选用的 100 秒 V6 导出 | `promo/output/Mochi_80秒_2K120帧_V5.mp4`、`promo/output/Mochi_100秒_2K120帧_V6.mp4` 与媒体探测记录 |
| 桌面包 | Mac arm64、Mac x64 和 2026-09-13 Windows x64 归档均在磁盘 | 见 `docs/DELIVERY-LEDGER.md` |

## 用户确认

用户在本次任务中明确确认：Windows 一体机已经完成实测，所有功能正常，可以直接使用。该结论应作为真实的用户现场验收记录，不再写成“Windows 未实测”。

目前缺少与这次确认一一对应的设备型号、Windows build、安装包 SHA-256、测试日期、逐项截图或录屏。缺少这些材料只表示证据尚未归档，不是否定用户的现场结论。

## 当前产品操作逻辑

1. 首次进入时选择工作区，并按演示要求授予全部工作区访问权限。
2. 普通对话默认处于聊天模式；要执行文件、课件、建模等任务，需要先切换到工作模式。
3. 工作台弹出后应在使用完成时关闭，避免遮挡主界面和后续镜头。
4. 校园账号登录与模型凭据是两套不同的认证。
5. 校园查询可以用于查找学生、位置与协作信息；批准放行等写操作仍要经过授权。
6. 生成结果应是可继续使用的课件、文档、表格、模型或其他文件，不能把纯文字回复当成完成交付。

## 当前已知问题与未验证项

- **校园后端报告**：用户指出服务器报告有问题。当前后端源码位于独立的“联动计划”项目；本轮没有修复报告、重新部署或验证公网服务状态。
- **宣传片版本**：V6 存在用户指出的约 17 秒处播放过慢反馈，不能标记为当前参赛批准版；用户已选择 80 秒 V5 进入本次交付目录。
- **现场证据**：Windows 一体机结果已经用户确认，但详细机器证据仍待补录。
- **参赛 PPT**：当前为五页四分钟答辩版，内嵌80秒视频；已补充痛点动机、技术架构并检查修改页渲染。媒体播放与结尾动画在本机WPS已验证；现场Windows WPS字体与播放仍需排练。
- **源码交付**：当前源码 ZIP 已在本轮文档与 PPT 更新后重新生成，并纳入根目录完整交付包；历史 ZIP 只用于追溯。

## 下一步交接顺序

1. 在“联动计划”项目中核实报告、部署配置、真实 API Origin 和只读健康状态。
2. 把 Windows 一体机的包哈希、设备和逐项结果补入 `参赛材料/真机验收记录.md`。
3. 比赛提交前在目标 Windows WPS 完整播放 PPT 和宣传片，并补齐作者信息；当前文件哈希已登记在交付包清单中。
4. 只有在继续剪辑时才处理 V6 的速度反馈；本次提交按已选定的 80 秒 V5 执行。

## 合理推测

现有矛盾主要来自多个阶段的方案、工单和审计都保留在显眼位置，而摘要没有同步更新。经过本次分层后，后续维护成本会降低，但这不能替代实际运行回归和线上服务检查。
