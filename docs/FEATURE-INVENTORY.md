# Mochi 当前功能清单（全量）

> status: **当前有效**（基线：2026-09-19 出货包 + 源码）
> last_verified: 2026-09-19 11:52 CST
> verified_by: 本机取证 —— 包内 `Mochi.app/Contents/Resources/mochi/**` + 仓库源码 + harness 工具 schema 快照
> 口径：**「已实现」= 代码在包内 + 已注册进 runtime-profile + 工具名通过 CI 守卫**。
> 只列真实存在的东西；未接线/未实现的单独放在第 9 节，不混进正文。

---

## 0. 规模总览

| 维度 | 数量 | 说明 |
|---|---|---|
| 运行时插件 | **25** | 教师端 `mochi-web` 组合 24 个；`mochi` profile 额外含 `mochi-approval` |
| Mochi 自有工具 | **约 83 个** | 分布在 14 个插件（见第 2 节） |
| harness 内置工具 | **26 个** | 来自 dsh 工具快照（见第 3 节） |
| 技能（Skills） | **9 个** | `skills/` 整目录在包内 |
| 教师 Agent 预设 | **4 个** | 备课 / 资料试卷 / 成绩分析 / 班级协同 |
| 本机角色 | **2 端** | 教师办公电脑、教室一体机 |

---

## 1. 两端与本机角色

| 角色 | 语义 | 数据目录 | userData |
|---|---|---|---|
| teacher | 教师办公电脑 | `.mochi-home` | `Mochi` |
| classroom | 教室一体机 | `.mochi-classroom-home` | `Mochi-classroom` |

- 角色解析优先级：`--role=` / `MOCHI_RUNTIME_ROLE` > 本机记录文件 > 首启对话框（`launch-role.ts:75-92`）
- 两个角色文件**可并存**，托盘里随时切换，**切换不删任何数据**（`launch-role.ts:42-45`）
- 单实例锁按角色隔离：同角色单实例、异角色各自单实例（`main.ts:939-947`）

---

## 2. Mochi 自有工具面（模型能真正调用的能力）

### 2.1 校园（嘉行联）· `mochi-campus` · 26 个

| 工具 | 能力 |
|---|---|
| `jxl_campus_status` | 校园状态总览：待办计数、超时、在途学生、最近关键事件 |
| `jxl_query` | 按登录账号权限读取与校园网页同源的业务 API（dashboard/students/movements/events/messages/unread-count） |
| `jxl_student_directory_search` | 按姓名/学号/班级查授权范围内的真实学生目录 |
| `jxl_student_card` | 单个学生档案卡（基本信息、班级、当前状态） |
| `jxl_movement_request_list` | 待我审批的放行申请（代录人、来源、学生、目的地、版本） |
| `jxl_movement_request_create` | 登记 PENDING 放行申请，并呈现原生人工确认卡 |
| `jxl_movement_request_decide` | 审批放行申请：approve 生成正式放行单 / reject 拒绝 |
| `jxl_movement_detail` | 单条放行单详情（状态时间线、学生、审批记录） |
| `jxl_movement_transition` | 推进放行单状态：arrive / leave / confirm-return |
| `jxl_dorm_status` | 授权范围内宿舍相关学生流动 |
| `jxl_clinic_status` | 医务室相关学生：合并「目的地=医务室」流动单与医务事件 |
| `jxl_health_events` | 当前账号授权的医务事件 |
| `jxl_medical_event_create` | 校医创建真实医务处置记录（需人工确认卡） |
| `jxl_medical_event_status` | 校医更新医务事件状态（需人工确认卡） |
| `jxl_movement_link_medical_event` | 把医务事件关联到已到达的放行单 |
| `jxl_event_detail` | 单条校园/医务事件详情及协作消息往来 |
| `jxl_message` | 读取本人校内收件箱 / 未读数量（只读） |
| `message_send` | 向校园事件中的允许收件人发 1–240 字消息 |
| `jxl_analytics` | 学生流动事实统计（按班级/年级聚合） |
| `jxl_smart_digest` | 复用网页版智能消息摘要 |
| `jxl_assistant` | 【备用】校园网页版助手通道 |
| `jxl_relay_send` | 给本校同事的 Mochi 带口信（message）或委托寻物（request） |
| `jxl_relay_list` | 我的 Mochi 传话箱（收到的/发出的 + 回音，已分组摘要） |
| `jxl_relay_respond` | 回应收到的传话：accept / decline + 120 字内回话 |
| `jxl_relay_register` | 把自己的东西登记进全校共享登记 |
| `jxl_relay_find` | 【底层】只查共享登记不投递 |

### 2.2 跨端任务派发（A2A）· `mochi-dispatch` · 9 个

| 工具 | 能力 |
|---|---|
| `mochi_ask` | 以 Mochi 任务方式替主人**问一句话**（换课/借物/约时间），走审批闸 |
| `mochi_request` | 替主人**提出做事请求**，等对方批准或给结果 |
| `mochi_respond` | 回应别人托付的任务：approve / decline + 回话 |
| `mochi_find` | 找东西：先查全校登记，未命中再派寻物任务（经主人确认） |
| `mochi_tasks` | 我的 Mochi 任务清单（校园 relay + 本机 LAN 教室任务分列） |
| `mochi_list_classrooms` | 本机局域网教室名册（已配对 / 仅发现，分开返回） |
| `mochi_notify_classroom` | 向已配对同校班级教室端发通知（签名投递 + 「已看到」回执） |
| `mochi_send_classroom_file` | 向教室端发 PPTX/DOCX/XLSX/PDF/图片（分块签名 + 哈希校验） |
| `mochi_register_verdicts` | 把一次听写/作业/提问的处置结果作为**逐人交代名册**下发到教室端 |

### 2.3 演示 / PPT · `mochi-presentations` · 4 个

| 工具 | 能力 |
|---|---|
| `mochi_ppt_create` | 生成**真实可编辑 .pptx**；8 套配色预设 + 封面/章节/重点/关键数字/结束页等版式 |
| `mochi_ppt_revise` | 只重写指定页，**其余页逐字节一致**（jszip 复验），写入全新目录不覆盖旧版 |
| `mochi_ppt_render` | 渲染出图（overview 看全册 / page 看密集页），供模型**真的看图复核** |
| `ppt_inspect` | 只读检查 .pptx 真实 OOXML 结构（页数、文字、图表/表格/图片、备注、元数据） |

### 2.4 文档 / Word / PDF · `mochi-documents` · 6 个

| 工具 | 能力 |
|---|---|
| `mochi_document_create` / `doc_create` | 生成 .docx（同一实现的两个名字） |
| `doc_read` | 读 .docx 真实文本结构：段落/标题/表格块 + 样式名 + 内嵌图片/媒体/节数 |
| `doc_edit` | 段落级修改：set_block_text / replace_text / insert_paragraph / delete_block，**另存新版本** |
| `doc_export` | .docx → 真 PDF（调用本机 LibreOffice；没有则**如实报错**，绝不伪造 PDF） |
| `pdf_read` | 读 PDF 页结构与文本（页数/尺寸/旋转/字体/元数据，支持 `"1-3,5"` 页范围） |

### 2.5 表格 / Excel · `mochi-sheets` · 4 个

| 工具 | 能力 |
|---|---|
| `spreadsheet_create` | 生成**真 .xlsx**（ZIP+OOXML）：多工作表、表头、列宽、样式、数字格式 |
| `spreadsheet_read` | 读 .xlsx/.csv：工作表清单 + 区域单元格值/公式文本（含缓存结果） |
| `spreadsheet_formula` | 写入公式并**真实计算**，结果作为缓存值一并写入（另存新文件） |
| `spreadsheet_export` | .xlsx→.xlsx（逐字节另存）/ .xlsx→.csv 等受支持组合 |

### 2.6 文件 · `mochi-files` · 6 个

`file_search`（通配符）· `file_read`（行范围 + 大小上限）· `file_copy` · `file_move` · `file_rename` · `file_create_folder`
—— 全部走**真实 `node:fs`**，目标已存在默认拒绝，需显式 `overwrite: true`。

### 2.7 教材知识库 · `mochi-knowledge` · 3 个

| 工具 | 能力 |
|---|---|
| `mochi_knowledge_search` | 检索本机已导入的高中教材库（可按学科/册别过滤） |
| `mochi_knowledge_page` | 查看命中教材某一页的受管索引资料（返回原页核对引用 + 可检索文本） |
| `mochi_knowledge_page_image` | 把命中页渲染成受管 PNG，供**支持图像输入的模型**核对公式/图表/版面 |

### 2.8 图片与图表 · `mochi-visuals` · 4 个

| 工具 | 能力 |
|---|---|
| `diagram_draw` | 按结构化描述出教学图表 → SVG（可进 PPT 编辑）+ PNG（可进 Word） |
| `image_find` | 按关键词/尺寸/宽高比检索图片，返回路径、格式、像素、清晰度档位 |
| `image_edit` | 真实像素编辑，6 种操作按数组顺序执行，**另存新文件** |
| `teaching_image_match` | 按知识点/章节在本机教材索引里找对应教材页与插图 |

### 2.9 数学建模 · `mochi-modeling` · 1 个

`mochi_model_create` —— 生成**交互式教学数学模型页面**（自包含 HTML，可拖动/可核对/离线零依赖）。
本期支持 `type=conic-tangent`（椭圆切线交互模型：拖切点、切线/焦点/辅助线、参数滑块、结论分步揭示、课堂模式）。

### 2.10 成绩分析 · `mochi-grades` · 1 个

`mochi_grade_analyze` —— 读 .xlsx/.csv 成绩表 → 生成教师内部审计工作簿（真 .xlsx，含逐行处理依据）+ 中文统计摘要。
满分/及格线/优秀线**必须由人给出**；缺考/免修/空白不按零分；学号保留前导零；重复学号整批待核对不合并。

### 2.11 长期记忆 · `mochi-memory` · 6 个

| 工具 | 能力 |
|---|---|
| `mochi_memory_note` | 写入长期记忆（只在三种情况写：明确长期偏好 / 多次稳定重复 / 主人主动要求） |
| `mochi_memory_recall` | 检索记忆，每条带「为什么 Mochi 知道这个」（来源+时间+召回次数） |
| `mochi_memory_list` | 列出全部记忆与统计，供主人检查纠正 |
| `mochi_memory_forget` | 彻底忘掉一条（需记忆 ID，执行前复述） |
| `mochi_memory_clear` | 一键清空（须先复述「将删除 N 条（含 X 条 pinned）」并获同意） |
| `mochi_memory_world` | 读写 `world-state.md` 工作状态快照（待办 / 近 24h 变更 / 已知约定） |

### 2.12 定时任务 · `mochi-task-scheduler` · 3 个

`mochi_schedule_create`（把「每天/每周/工作日几点」翻译成重复规则）· `mochi_schedule_list`（读本机 SQLite）· `mochi_schedule_cancel`

### 2.13 模式开关 · `mochi-modes` · 1 个

`mochi_request_work_mode` —— 「对话 / 工作」模式切换，配 `/mochi-work`、`/mochi-chat` 两个命令 + session 投影。

### 2.14 侧边栏与终端 · `dsh-better-sidebar` · 9 个

`sidebar_open` + `terminal_create` / `terminal_send` / `terminal_read` / `terminal_resize` / `terminal_signal` / `terminal_close` / `terminal_list` / `terminal_wait_for`

---

## 3. harness 内置工具面 · 26 个

来自 `mochi-harness-src.nosync/mochi-harness/snapshots/web/fresh-round-trip/tool-schemas.expected.json`

| 域 | 工具 |
|---|---|
| 文件 | `read` · `write` · `edit` · `glob` · `grep` · `read_image` |
| 执行 | `bash` · （另有 `pwsh` 供 Windows） |
| 网络 | `web_search` · `web_fetch` |
| 协作 | `subagent` · `subagent_fork` · `list_agents` · `send_message` · `interrupt_agent` |
| 任务/作业 | `job_list` · `job_output` · `job_kill` |
| 目标 | `create_goal` · `get_goal` · `update_goal` |
| 流程 | `todo_write` · `exit_plan_mode` · `workflow` · `ralph` |
| 交互 | `ask_user_question` · `skill` |

**支撑这些能力的框架包**（在依赖里）：子代理（in-process fork/spawn）、工作流（worker-thread）、作业、目标轮次驱动、压缩（basic + tool-result-pruner）、计划模式、技能框架（filesystem provider + badge）、MCP 客户端、附件、persona、定时。

---

## 4. 技能（9 个，包内整目录加载）

| 技能 | 做什么 |
|---|---|
| `mochi` | 复杂校园工作的执行与验收方法（建模先检索再复用；四类成果的验收清单） |
| `class-meeting-prep` | 班会目标、大纲、讲稿 + 可编辑 PPTX，并执行定页修订 |
| `classroom-deck` | 课件/答辩 PPT 制作与**视觉复核**（生成后主动看图，按证据修正再复验） |
| `classroom-verdict` | 把口述的一次听写/作业/提问处置，逐人写成**能照着做的个性化交代**并下发 |
| `student-movement-request` | 帮授权教师为不舒服学生代录放行申请，走真实人工确认卡 |
| `student-follow-up` | 核对学生在校近期状态、整理跟进重点、起草沟通内容 |
| `teacher-daily-brief` | 生成课间能快速扫完的校园晨报/状态摘要 |
| `weekly-class-report` | 生成每周班级运行报告、数据表与可交付文档 |
| `teaching-material-find` | 从本地工作区、本机教材库、已核验来源找教学材料 |

---

## 5. 教师 Agent 预设（4 个）

`client-plugins/teacher-agent-presets/`（默认 `lesson-planning`）：

| 顺序 | 预设 | 职责 |
|---|---|---|
| 1 | `lesson-planning` | 备课与课件 |
| 2 | `materials-assessment` | 资料与试卷 |
| 3 | `grade-analysis` | 成绩分析 |
| 4 | `classroom-coordination` | 班级与教室 |

教室端另有 `classroom` 预设（`classroom-agent-presets`）。

---

## 6. 桌面壳层能力

| 能力 | 细节 |
|---|---|
| **侧边悬浮条（Rail）** | 两种形态：`teacher-rail`（教师待办横条）/ `classroom-board`（教室常驻屏，置顶）；336×88–472，位置持久化；四动作 `open/hide/acknowledge/sync`；页面每 3s 轮询，主进程按内容指纹去重不重绘；弹窗同 id 15s 冷却；窗口崩溃自动重建（上限 3） |
| **系统托盘** | 打开 / 显示隐藏待办条 / 当前角色（置灰）/ 切换本机角色 / 重启内核 / 退出 |
| **环境诊断（Doctor）** | `Cmd/Ctrl+Shift+D`；**11 项检查**：系统版本、架构、磁盘、home 可写、回环、系统时间、模型服务、凭据、校园服务、搜索端点、代理；可复制/保存**脱敏**报告 |
| **Web Host** | spawn dsh 子进程（`--profile mochi-web`），端口可用 `MOCHI_DSH_PORT` 指定或系统分配；90s 就绪超时；就绪后意外退出**自动恢复一次** |
| **启动冒烟** | `MOCHI_DESKTOP_SMOKE=1` → 成功打印 `MOCHI_DESKTOP_SMOKE_OK <origin>` / 失败 `_FAILED` + exit 1 |
| **局域网通知** | 收到新消息 / 配对申请时：先聚焦主窗口，仅当原本最小化且系统支持时发系统通知；3s 节流 |
| **首启种子** | 仅教师端执行；合并缺失的 `.credentials.yaml` refs（0600 原子写，已有值不动）；`settings.yaml` 写默认模型链 + 视觉 provider |
| **IPC 通道** | 11 条：`mochi:ping`、`prompt:send/cancel`、`event:stream`、`approval:request/respond`、`lan:attention`、`rail:lan-state/apply/popup/action` |

---

## 7. 界面能力（客户端插件 7 个）

| 插件 | 给界面加了什么 | 注册位置 |
|---|---|---|
| `jxl-brand` | 嘉行联品牌位：水母 logo + 字标、对话 hero 品牌、**AI 头像/表情球（ExpressiveOrb、OrbCompanion）** | `sidebar.brand.*`、`conversation.hero.brand.mark`、`settings.general.item` |
| `jxl-campus` | 校园系统入口：侧栏底部打开完整校园 app（`shell.overlay` 同文档原生层挂载）；node 侧直出 `/campus` 并反代 `/jxl-api` | `shell.overlay`、`sidebar.footer.action` |
| `jxl-theme` | 嘉行联设计令牌映射到 `--dsw-alias-*`、字体、标题/favicon 主权 | 无 slot，纯文档层注入 |
| `mochi-lan` | 同源局域网面板：身份、发现、配对、收件箱与回执 | `sidebar.footer.action`、`shell.overlay` |
| `mochi-model-presets` | 「设置→模型」页尾的中文服务商预填卡 | `settings.models.footer`、`settings.models.provider-card` |
| `mochi-modes` | 对话/工作模式切换器（接命令 `/mochi-work`、`/mochi-chat`） | `conversation.session.header.actions` |
| `teacher-agent-presets` | 上述 4 个教师 Agent 预设 | 受管资源目录 |

---

## 8. 模型与搜索接入

| 项 | 现状 |
|---|---|
| 默认模型 | `mochi-aiaaa / deepseek-v4.1-flash`（带图像输入能力） |
| 备用模型链 | `mimo-v2.5` / `mimo-v2.5-pro`（131072 上下文，支持 reasoningEffort 四档） |
| 搜索 | `mochi-web-search` 注册**免密钥**搜索 provider（baidu/wechat/toutiao + arXiv），并内置教育域名白名单（学科网、组卷网、菁优网、国家中小学智慧教育平台、教育部、四川省教育厅/考试院、成都市教育局等） |
| 模型预填 | `mochi-model-presets` 在设置页提供中文服务商预填卡 |

---

## 9. 明确**没有**或**不可达**的（诚实标注）

1. **PPT 不支持图片、自由坐标、字体、动画参数** —— 工具描述里明确写了「不得声称已实现」。
2. **数学建模本期只有 `conic-tangent` 一种类型**（椭圆切线）。
3. **`doc_export` 依赖本机 LibreOffice**；没有就如实报错，不伪造 PDF。
4. **`pdf_read` 依赖 PDF 自带 ToUnicode 映射**；没有映射时如实返回「不可用」，不 OCR。
5. **`doctor-host-client.ts` 目前全仓无调用点**（未接线）。
6. **`harness.ts` 里的 sidecar 链路（prompt/approval IPC）当前不可达** —— `main.ts` 未 import `dsh/index.ts`。
7. **教室端不读取教师密钥、记忆、会话**（设计如此，不是缺陷）。
8. **不做**：硬件、疾病预警/风险评分、心理测评、生物识别、GPS（红线）。

---

## 10. 治理与安全约束（已落地为机制，不是口号）

| 约束 | 落地方式 |
|---|---|
| 对外动作必须人工确认 | 审批卡；`jxl_movement_*` / `jxl_medical_*` / `message_send` / `mochi_*` 全部要求原生确认卡 |
| 学生请假/放行永远路由给老师 | 学生端只能创建 PENDING，`decide` 权限在教师端 |
| 身份口径 | 四 profile `includeHarnessIdentity: false` + persona 身份锁 |
| 工具名合规 | 模型可见名只许 `[a-zA-Z0-9_-]`（点号会 400），CI 守卫 + 打包树重扫 |
| 遥测不出校 | `DSH_TELEMETRY_DISABLED=1` |
| 数据隔离 | 两端各自 home，教室端不读教师机密 |
| 记忆写入纪律 | 只写长期偏好，不写成绩明细/医疗健康/密码令牌/私人文件全文 |

---

## 取证来源

- 包内：`apps/desktop/release/mac-arm64/Mochi.app/Contents/Resources/mochi/{plugins,skills,profile}/`
- 源码：`plugins/*/`、`client-plugins/*/`、`skills/*/SKILL.md`、`apps/desktop/electron/**`
- 内置工具：`mochi-harness-src.nosync/mochi-harness/snapshots/web/fresh-round-trip/tool-schemas.expected.json`
- 依赖面：`apps/desktop/package.json`
