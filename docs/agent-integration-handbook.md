> **status**: active　**last_verified**: 2026-09-14　**verified_by**: Codex（源码级内容核对，未重新现场操作）

# Mochi 技术手册 · 外部 Agent 对接指南

> **读者**：要把另一个 Agent / 插件 / 外部系统接进 Mochi 的工程师
> **证据等级**：本文工具名、插件清单、常量、状态机**全部摘自源码**，不是设计意图。每张表都标了来源文件。

---

## 目录

1. [Mochi 是什么 / 边界在哪](#1-mochi-是什么--边界在哪)
2. [运行时架构](#2-运行时架构)
3. [版本与兼容矩阵](#3-版本与兼容矩阵)
4. [插件模型：装载三件套](#4-插件模型装载三件套)
5. [工具契约硬约束（先读这一节）](#5-工具契约硬约束先读这一节)
6. [工具全表（26 插件）](#6-工具全表26-插件)
7. [客户端 UI 扩展点（slot 表）](#7-客户端-ui-扩展点slot-表)
8. [审批契约](#8-审批契约)
9. [对话 / 工作双模式与投影](#9-对话--工作双模式与投影)
10. [A2A / 局域网协议](#10-a2a--局域网协议)
11. [数据、存储与路径安全](#11-数据存储与路径安全)
12. [配置与环境变量](#12-配置与环境变量)
13. [打包与发布](#13-打包与发布)
14. [错误语义与失败处理](#14-错误语义与失败处理)
15. [对接 checklist](#15-对接-checklist)
16. [硬约束与禁令](#16-硬约束与禁令)
17. [附录](#17-附录)

---

## 1. Mochi 是什么 / 边界在哪

**Mochi 是专注校园工作的 AI 智能体**——老师的办公助手 + 教室大屏助手。运行时底座是
Mochi Harness（cordis 插件内核），UI 是桌面 APP（Electron 宿主 + 官方 Web SPA）。

### 1.1 三端模型

| 端 | 载体 | 关键性质 |
|---|---|---|
| **教师端** | 老师办公电脑（Mac / Windows） | 主 Agent，全量工具 |
| **教室端** | 多媒体大屏 | **独立 Agent**：自己的模型/身份/数据根，**不登老师账号**，不连教师端也能独立干活 |
| **学生端** | 未来适配，**本期不做但保留** | 「功能受限、知识不受限」 |

> 教师端 ↔ 教室端是 **A2A 协作**（走 mochi-dispatch 的 ASK / REQUEST），**不是同账号两台设备**。

### 1.2 做事边界

**做**：文件读写与整理、Word/Excel/PPT/PDF 真格式产出、图片检索与编辑、教学图表绘制、
教材检索、成绩分析、定时提醒、校园状态查询与流程（放行/医务）发起、传话与寻物委托、
局域网教室通知。

**不做（硬红线，任何 Agent 都不得实现）**：

- ❌ 疾病预警、学生风险评分、心理测评、生物识别、GPS / 定位
- ❌ 硬件对接（无传感器、无刷卡机、无摄像头）
- ❌ 替老师批学生的假 / 放行（**永远路由给老师人工确认**）
- ❌ 用 HTML / 截图 / 改名文件冒充 `.pptx` / `.docx` / `.xlsx` / `.pdf`

**预警只允许一种**：**流程异常**（例如某学生外出超时未返班）。不是健康预警。

---

## 2. 运行时架构

```
┌─────────────────────────────────────────────────────────────┐
│  Electron 宿主（apps/desktop）                                │
│  ├─ 主进程：窗口 / 托盘 / Mochi 医生 / 目录选择器 / 冷启动      │
│  ├─ 启动 Harness sidecar（子进程，通过 HTTP 与宿主通信）        │
│  └─ 内嵌官方 Web SPA（用户可见界面 100% 来自官方 UI）           │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP（本机回环）
┌───────────────────────▼─────────────────────────────────────┐
│  Mochi Harness（cordis 插件内核）                             │
│  ├─ runtime-profile.json  → 决定挂哪些插件（4 个 profile）      │
│  ├─ cordis.patch.yml      → 插件行增删改（官方 patch 语义）      │
│  ├─ 插件总线：ctx.tools / ctx.commands / ctx.systemPrompt      │
│  │            ctx.on('approval/request') / sessionProjections  │
│  └─ Mochi 插件（服务端 18 + 客户端 8，共 26 个在打包白名单）      │
└─────────────────────────────────────────────────────────────┘
```

**数据根**：开发态 `.mochi-home.nosync`；打包态 `~/.mochi-home`（环境变量 `DSH_HOME` 指向它）。

---

## 3. 版本与兼容矩阵

| 项 | 真值 | 来源（唯一） |
|---|---|---|
| 内核（Mochi Harness / dsh） | **`0.1.3-alpha.1`** | `prepare-mochi-resources.cjs` 的 `PLUGIN_RUNTIME_VERSIONS` |
| 打包插件数 | **26** | 同文件 `PLUGINS` 数组 |
| 协议 | MIT | 上游仓库 LICENSE |
| 时区 | **`Asia/Shanghai`**（硬编码） | `mochi-task-scheduler` |

> ⚠️ `0.1.2-rc.1` 是 npm registry 上**更旧**的版本。任何文档里的这个数字都是**过时口径**，
> 唯一例外是 `dsh-better-sidebar` 上游 README 里的自有版本声明（那是第三方插件，不是 Mochi 内核）。

**兼容声明纪律**：新增插件若 `import '@deepseek-ai/dsh-tools'` 之类的官方包，
**必须连同依赖一起提升**（`node_modules.nosync` 相对符号链接 + `package.json` 声明）。
历史事故：漏带 `@deepseek-ai/dsh-llm` 导致任何 profile 重启必崩。

---

## 4. 插件模型：装载三件套

一个插件要被 Mochi 真正挂载，**三件事缺一不可**：

| # | 动作 | 位置 |
|---|---|---|
| 1 | link 依赖 | 插件目录 `node_modules` 指向工作区 |
| 2 | node_modules symlink | 打包暂存时建立 |
| 3 | `cordis.patch.yml` insert 条目 | profile 的 patch 文件 |

**首选方式**：在 `apps/desktop/resources/mochi-*/runtime-profile.json` 的 `plugins` 里注册
→ 打包生成器（`prepare-mochi-resources.cjs`）自动完成三件套。

### 4.1 打包白名单 = 插件身份的唯一真值

`apps/desktop/scripts/prepare-mochi-resources.cjs` 的 `PLUGINS` 数组，**26 项**：

| # | 插件 id | 源目录 | 侧 |
|---|---|---|---|
| 1 | `mochi-hello` | `plugins/mochi-hello` | 服务端（受管 Node 探测） |
| 2 | `mochi-dispatch` | `plugins/mochi-dispatch` | 服务端（任务域 / A2A） |
| 3 | `mochi-campus` | `plugins/mochi-campus` | 服务端（校园业务，26 工具） |
| 4 | `mochi-approval` | `apps/desktop/electron/dsh/mochi-approval` | 宿主（审批兼容适配器） |
| 5 | `jxl-theme` | `client-plugins/jxl-theme` | 客户端（样式令牌桥） |
| 6 | `jxl-brand` | `client-plugins/jxl-brand` | 客户端（品牌位） |
| 7 | `jxl-campus` | `client-plugins/jxl-campus` | 客户端（校园静态资源 + API 代理） |
| 8 | `mochi-workbench` | `client-plugins/mochi-workbench` | 客户端（工作台） |
| 9 | `mochi-model-presets` | `client-plugins/mochi-model-presets` | 客户端（模型选择） |
| 10 | `mochi-lan` | `plugins/mochi-lan` | 服务端（局域网服务） |
| 11 | `mochi-lan-client` | `client-plugins/mochi-lan` | 客户端（局域网 UI） |
| 12 | `mochi-web-search` | `plugins/mochi-web-search` | 服务端（Web provider） |
| 13 | `mochi-knowledge` | `plugins/mochi-knowledge` | 服务端（教材库，3 工具） |
| 14 | `mochi-llm-mimo` | `plugins/mochi-llm-mimo` | 服务端（LLM provider） |
| 15 | `mochi-grades` | `plugins/mochi-grades` | 服务端（成绩分析，1 工具） |
| 16 | `mochi-presentations` | `plugins/mochi-presentations` | 服务端（PPT，3 工具） |
| 17 | `mochi-documents` | `plugins/mochi-documents` | 服务端（Word/PDF，6 工具） |
| 18 | `mochi-files` | `plugins/mochi-files` | 服务端（文件，6 工具） |
| 19 | `mochi-sheets` | `plugins/mochi-sheets` | 服务端（表格，4 工具） |
| 20 | `mochi-visuals` | `plugins/mochi-visuals` | 服务端（图片/图表，4 工具） |
| 21 | `mochi-modes` | `plugins/mochi-modes` | 服务端（双模式，0 工具 + 1 升级工具） |
| 22 | `mochi-modes-client` | `client-plugins/mochi-modes` | 客户端（模式 UI） |
| 23 | `mochi-modeling` | `plugins/mochi-modeling` | 服务端（教学建模，1 工具） |
| 24 | `mochi-memory` | `plugins/mochi-memory` | 服务端（记忆，6 工具） |
| 25 | `mochi-task-scheduler` | `plugins/mochi-task-scheduler` | 服务端（定时任务，3 工具） |
| 26 | `dsh-better-sidebar` | `plugins/dsh-better-sidebar` | 客户端（右侧面板，唯一自带 patch 的插件） |

> **新增一个插件 = 至少改两处**：`PLUGINS`（含 `files` 逐文件列出）+ `runtime-profile.json`。
> 然后必须跑 `node scripts/reconcile-snapshot-manifest.mjs --write` 重算快照清单。
> ⛔ 历史上出现过的插件数（9 / 12 / 16 / 19 / 20 / 21）都是**当时数字**，不是现行真值。

### 4.2 预设（preset）

教师端**只保留「创造模式」（cordis）**。标准 / 极简 / PTC 预设已被过滤，
不对外暴露，**不要基于它们写对接代码**。

---

## 5. 工具契约硬约束（先读这一节）

### 5.1 铁律：工具名正则

```
^[a-zA-Z0-9_-]+$
```

**点号（`.`）会让模型网关整轮 400 拒收**——不是这一个工具失败，是**整轮对话被拒**。

- 2026-09-12 真实事故：`file.search` 形态的工具名导致连续多轮对话不可用。<!-- allow-dotted-tool-name -->
- 源码里已是**硬断言**：`plugins/mochi-files/index.mjs:30`、`plugins/mochi-visuals/plugin.mjs:30`

```js
if (!/^[a-zA-Z0-9_-]+$/.test(toolName)) throw new Error(`工具名不合规（网关会拒收整轮对话）：${toolName}`);
```

- **测试侧双层守卫**（都在 `test-package-resources.mjs`）：
  1. `assertModelFacingToolNames()`（`:150`，正则常量 `MODEL_FACING_TOOL_NAME = /^[a-zA-Z0-9_-]+$/`）
     —— 由 `assertPluginToolRegistration()`（`:161`）对每个插件**重放注册面**后逐个断言工具名。
  2. `assertNoDottedToolNameLiterals(stageRoot/plugins)`（`:195`）—— 遍历**已暂存的插件源码**，
     逐行剥掉行尾注释后匹配 `DOTTED_TOOL_NAME_LITERAL`，命中即失败。
  ⚠️ **两者都不扫 `skills/`**：技能文档里的点号写法不会被拦住
  （2026-09-12 实测漏网：`skills/class-meeting-prep/SKILL.md` 的 `jxl.*`，已修）。

- 保留名：**`run_code`** 不得出现在任何 `allow` / `deny` 列表里（PTC 传输保留）。

### 5.2 工具返回值契约

**TOOLS RETURN FACTS. MOCHI SPEAKS.** 工具只返回结构化事实，不返回聊天话术。
人看的呈现由 UI 与人格层负责。

```jsonc
{
  "status": "ok | error",             // 机器可判
  "data": { ... },                    // 领域事实
  "artifact"?: { "id": "…", "type": "presentation", "path": "…" },
  "metadata"?: { "source": "…", "queriedAt": "…" },
  "warnings"?: ["…"],                 // 非致命（如部分数据缺失）
  "error"?: { "code": "…", "message": "…", "retryable": false }
}
```

### 5.3 `render` 签名大坑

**`render` 的签名必须是 `(args, value)`**：

- 第一个参数 = **调用参数**
- 第二个参数 = **工具返回值**

写成单参数会把**调用参数**当结果交给模型（2026-09-05 大坑 17）。
已在 `mochi-files` / `mochi-dispatch` / `mochi-memory` / `mochi-modeling` 四处源码注释中标注。

### 5.4 「诚实失败」高于「看起来成功」

每个写类工具都必须在**真的做完之后**才说完成，并在返回里自带校验证据：

| 工具 | 校验方式（源码实测） |
|---|---|
| `spreadsheet_create` | 写完**重开文件逐格回读**，全部一致才说「已生成」 |
| `doc_edit` | 逐条改动说明 + **回读校验结果** |
| `mochi_ppt_revise` | 生成后用 jszip 重开核验，**其余页 slide XML 与旧版逐字节一致** |
| `mochi_grade_analyze` | 返回 workbook 的 `sha256` 与字节数 |
| `mochi_schedule_create` | 只有**真写进 SQLite 且调度器真挂上定时器**才说已安排 |

**不支持的格式直接报错说清支持哪些**，不假装成功、不偷偷改名。
（例：`spreadsheet_export` 明确拒绝 pdf/xls/ods/numbers/html/tsv/json/markdown/txt/xml。）

---

## 6. 工具全表（26 插件）

> 工具名**一字不差**，均从源码 `register(...)` 调用提取。
> 「边界」列摘自该工具的**源码 description**，不是转述。

### 6.1 `mochi-campus` — 校园业务（26 个工具）

| 工具 | 用途 | 边界要点 |
|---|---|---|
| `jxl_query` | 读校园业务 API（与网页同源） | 只报告返回的数据；`dataMode=cloud-demo` 表示云端演示库 |
| `jxl_campus_status` | 校园状态总览 | 待办计数、超时、在途学生、最近关键事件 |
| `jxl_clinic_status` | 医务室相关学生 | 流动单（目的地=医务室）+ 医务事件合并 |
| `jxl_dorm_status` | 宿舍相关学生流动 | 直读流动单业务 API |
| `jxl_movement_request_list` | 待处理放行申请 | 返回代录人、来源、学生、目的地、版本 |
| `jxl_movement_request_create` | **登记** PENDING 放行申请 | **必须调本工具**呈现原生确认卡；**禁止回复 Markdown 伪卡**；只创建待审批申请，**不代表放行** |
| `jxl_movement_request_decide` | 审批放行申请 | `approve` 创建正式放行单 / `reject` 拒绝；**必须由教师在确认卡决定** |
| `jxl_movement_transition` | 推进放行单状态 | `arrive` / `leave` / `confirm-return`；服务端按角色复核权限；**每次写入必须显示原生确认卡** |
| `jxl_movement_detail` | 单条流动单详情 | ID 必须来自列表，**不得猜测** |
| `jxl_movement_link_medical_event` | 关联医务事件到放行单 | 校医角色；必须用查询所得编号与版本 |
| `jxl_medical_event_create` | 创建医务处置记录 | 校医角色；服务端二次校验角色与字段枚举 |
| `jxl_medical_event_status` | 更新医务事件状态 | 必须先读事件并显示当前/目标状态确认卡 |
| `jxl_health_events` | 读医务事件 | 当前账号授权范围 |
| `jxl_event_detail` | 单条校园/医务事件详情 | ID 来自列表，不得猜测 |
| `jxl_student_card` | 单个学生档案卡 | 关键字来自学生列表，不得猜测 |
| `jxl_student_directory_search` | 按姓名/学号/班级查学生目录 | 即使无流动单也能返回；唯一命中且用户要求创建时**必须**调 `jxl_movement_request_create` |
| `jxl_analytics` | 学生流动事实统计 | **只报告返回的数字，不得推算额外结论** |
| `jxl_smart_digest` | 智能消息摘要 | 返回云端实际结果；规则降级时明确说明 |
| `jxl_message` | 读本人收件箱 / 未读数 | **不发送、不标已读** |
| `message_send` | 发 1–240 字消息 | 必须先展示正文与事件并经人工确认；**结果不明不得重试** |
| `jxl_relay_send` | 传话 / 委托寻物 | 发送前必须展示接收人与内容并获人工确认 |
| `jxl_relay_list` | 查看传话箱 | 已分组摘要，照着读，不要编造 |
| `jxl_relay_find` | 【底层】只查登记不投递 | 日常「帮我找某物」用 `mochi_find` |
| `jxl_relay_register` | 登记物品进全校共享登记 | 登记前必须确认物名；是否外借仍由主人决定 |
| `jxl_relay_respond` | 回应收到的传话 | `accept` / `decline` + 120 字内回话；**必须先念出内容与拟定回话并获确认** |
| `jxl_assistant` | 【备用】校园网页版助手 | **仅当主人明确要求时才用**；日常优先用具体工具 |

### 6.2 `mochi-dispatch` — 任务域 / A2A（8 个工具）

四原语：**ASK**（问一句等回话）· **REQUEST**（请求做事等批准）· **FIND**（找资源）· **APPROVE**（应答，由 `mochi_respond` 承载）

| 工具 | 用途 |
|---|---|
| `mochi_tasks` | 查任务列表 |
| `mochi_ask` | 问一句能不能…（换课 / 借物 / 约时间） |
| `mochi_request` | 请求做事等批准 |
| `mochi_respond` | 对入站请求应答（APPROVE 原语） |
| `mochi_find` | 找某物：**先查共享登记，未命中再走任务派发** |
| `mochi_list_classrooms` | 列出可见教室端 |
| `mochi_notify_classroom` | 大屏通知 |
| `mochi_send_classroom_file` | 向教室端发文件 |

### 6.3 `mochi-files` — 文件（6 个工具）

默认只开放**当前会话工作区**，不开放整个用户目录或磁盘根。

| 工具 | 参数 | 边界 |
|---|---|---|
| `file_search` | `query`*、`directory`、`recursive`(默认 true)、`maxDepth`(默认 6，0–32)、`type`(file/directory/any)、`limit`(默认 50，1–200) | 支持 `*` `?`；**不跟随符号链接**；截断时明确说明 |
| `file_read` | `path`*、`startLine`、`endLine`、`maxBytes`(默认 256KB，硬上限 4MB) | 二进制（含 NUL 字节）**拒绝**；Word/Excel/PPT/PDF/图片请用对应工具 |
| `file_copy` | `source`*、`destination`*、`overwrite` | 目标已存在**默认拒绝**；只复制文件，不复制目录 |
| `file_move` | `source`*、`destination`*、`overwrite` | 同上；跨文件系统回退为「复制后删除来源」并标注 |
| `file_rename` | `path`*、`newName`*、`overwrite` | `newName` 不得含路径分隔符 |
| `file_create_folder` | `path`*、`recursive` | 已存在返回「已存在」不算错误；同名位置是文件则报错 |

> ⛔ **本插件不提供任何删除工具**（没有 `file_delete`）。这是刻意的安全设计，不要绕过。<!-- allow-dotted-tool-name -->

### 6.4 `mochi-documents` — Word / PDF（6 个工具）

| 工具 | 参数 | 边界 |
|---|---|---|
| `doc_create` / `mochi_document_create` | 见源码 | 同一实现的**两个名字**（`plugin.mjs:573-574`），保留兼容 |
| `doc_read` | `path`* | 按顺序返回段落/标题/表格块，带**块序号**（供 `doc_edit` 用）；只读 |
| `doc_edit` | `path`*、操作数组 | `set_block_text` / `replace_text` / `insert_paragraph` / `delete_block` 四种；**另存新版本，绝不覆盖源文件**；其余 OOXML 部件按原始压缩字节保留；**不支持表格重排** |
| `doc_export` | `path`*、`format`(仅 `pdf`) | 有受管 LibreOffice/soffice 才转；没有则**如实返回「本机没有导出引擎」**，绝不伪造 |
| `pdf_read` | `path`*、`pages`（`"1-3,5"`） | 依赖字体 ToUnicode 映射；无映射则如实返回原因，**不 OCR、不伪造** |

> 🔴 **试卷导出字体硬要求**：`mochi-documents/index.mjs:92,96` 要求系统有 **`Songti SC`**
> （`/System/Library/Fonts/Supplemental/Songti.ttc`），缺失时抛 **`EXAM_FONT_UNAVAILABLE`**，
> **不做静默替换**。Windows 无此字体 → 对接方需先做字体注册。

### 6.5 `mochi-sheets` — 表格（4 个工具）

| 工具 | 参数 | 边界 |
|---|---|---|
| `spreadsheet_read` | `path`*、`sheet`、`range`(`A1`/`A1:C10`/`A:C`/`3:7`)、`maxRows`(默认 200，硬上限 5000)、`maxColumns`(默认 50，硬上限 500)、`includeFormulas` | 只读；**不支持** `.xls`/`.ods`/`.numbers`/`.pdf`；**改名成 `.xlsx` 的 CSV 会被直接拒绝** |
| `spreadsheet_create` | `outputPath`*、`sheets`* | 真 OOXML（ZIP+OOXML，**不是改名 CSV、不是 HTML 冒充**）；工作表名 ≤31 字符且不含 `[ ]`；写完**逐格回读校验** |
| `spreadsheet_export` | `sourcePath`*、`format`*、`outputPath`*、`sheet` | 仅 4 种组合：xlsx→xlsx / xlsx→csv / csv→xlsx / csv→csv。其余格式**直接报错** |
| `spreadsheet_formula` | `path`*、`outputPath`*、`sheet`、`formulas`/`items` | **真算**后把结果当缓存值写回；有 soffice 则外部真算，否则内置引擎**并明确标注「未做外部引擎真算」** |

### 6.6 `mochi-presentations` — PPT（3 个工具）

| 工具 | 参数 | 边界 |
|---|---|---|
| `mochi_ppt_create` | `title`*、`slides`*、`outputDirectory`*（**必须不存在**） | pptxgenjs 本地生成**真 .pptx**；文本/原生表格/原生图表**可在 PowerPoint 中编辑**；生成前按投影版式预算**拒绝文字或轴标签超量**；返回 `sourcePath` |
| `mochi_ppt_revise` | `previousSourcePath`*、`page`*、`instruction`*、`outputDirectory`*、`newTitle`/`newBody`/`newTable`/`newChart`（至少给一个） | **只重写指定页**，其余页 slide XML 与旧版**逐字节一致**（jszip 核验）；写入全新目录，**永不覆盖旧版本** |
| `ppt_inspect` | 见源码 | 无允许根 / 无受管工作区时**拒绝运行**（防越权读盘） |

> 🔴 **对接纪律**：老师要改第 X 页时，**必须**用 `mochi_ppt_revise` 带 `sourcePath`，
> **绝对不要用 `mochi_ppt_create` 重新生成整套**（会丢老师已确认的内容）。

### 6.7 `mochi-visuals` — 图片与图表（4 个工具）

| 工具 | 参数 | 边界 |
|---|---|---|
| `image_find` | `query`、`directory`、`aspectRatio`(如 `16:9`)、`orientation`、`minWidth`/`minHeight`/`minLongEdge`/`minBytes`、`sort`、`recursive`、`maxDepth`、`limit` | 按关键词/尺寸/宽高比检索；指定 `aspectRatio` 时优先最接近并**过滤偏差 >8%**；只读，不跟随符号链接 |
| `image_edit` | `path`*、`operations`*、`format`、`quality`、`outputName`、`outputDirectory` | 6 种操作**按数组顺序执行**：`crop` / `resize`（contain/cover/stretch/maxLongEdge）/ `rotate` / `rounded` / `watermark`（九宫格定位）/ `adjust`；**绝不覆盖原图** |
| `diagram_draw` | `type`*、`title`、`data`/`nodes`/`edges`/`center`、`direction`、`showValues`、`showLegend`、`colors`、`width`、`height`、`pngScale`、`formats`、`outputName`、`outputDirectory` | 5 种 type：`bar` / `line` / `pie` / `flowchart` / `relationship`；输出 **SVG**（可进 PPT 继续编辑）+ **PNG**（可进 Word） |
| `teaching_image_match` | `topic`*、`subject`、`volume`、`bookId`、`limit`、`allowNetworkSuggestion` | 查本机教材索引（`$DSH_HOME/knowledge/textbook.sqlite`）；**本地无匹配时明确返回「本地无匹配」，绝不伪造「已找到教材原图」**；**只读索引、不做 OCR、不联网** |

### 6.8 `mochi-knowledge` — 教材库（3 个工具）

| 工具 | 用途 | 边界 |
|---|---|---|
| `mochi_knowledge_search` | 检索教材内容 | 只读受管本地索引 |
| `mochi_knowledge_page` | 取教材页 | 返回带来源溯源（commit / URL / blob SHA / 文件 SHA256） |
| `mochi_knowledge_page_image` | 取教材页 PNG | 由 `teaching_image_match` 指路 |

### 6.9 `mochi-grades` — 成绩分析（1 个工具）

| 工具 | 边界 |
|---|---|
| `mochi_grade_analyze` | 读 `.xlsx`/`.csv` 成绩表 → 生成**真 .xlsx** 教师内部审计工作簿（**含逐行处理依据**）+ 中文统计摘要。**满分/及格线/优秀线必须由主人明确给出，模块不猜**；缺考/免修/空白**不按零分统计**；学号**保留前导零**；重复学号**整批待核对不合并** |

### 6.10 `mochi-memory` — 记忆（6 个工具）

**本地低风险读写，不走审批闸**（`mochi_memory_clear` 靠描述复述纪律 + `forget` 快照可恢复两层防护）。

| 工具 | 用途 |
|---|---|
| `mochi_memory_note` | 记一条 |
| `mochi_memory_recall` | 回忆 |
| `mochi_memory_list` | 列出 |
| `mochi_memory_forget` | 忘掉一条（快照可恢复） |
| `mochi_memory_clear` | 清空（防误清靠描述复述纪律） |
| `mochi_memory_world` | 世界状态 |

类型：`preference`(个人偏好) / `task_fact`(任务事实) / `org_knowledge`(组织知识) / `convention`(班级约定)。<!-- allow-dotted-tool-name -->
来源：`user_statement`(用户陈述) / `repeated`(多次重复) / `explicit_request`(明确要求)。

### 6.11 `mochi-task-scheduler` — 定时任务（3 个工具）

| 工具 | 参数 | 边界 |
|---|---|---|
| `mochi_schedule_create` | `title`*、`kind`*、`frequency`*、`time`*、`weekday`、`date`、`note` | `frequency`：`once`(需 `date`) / `daily` / `weekly`(需 `weekday`) / `weekdays`；`time` 为 `HH:MM` 补零；**时区固定 `Asia/Shanghai`**；`weekday` 1–7（1=周一）；`kind`：`remind`(发回创建会话) / `notify`(仅本机记一条)；**应用关闭期间不会执行** |
| `mochi_schedule_list` | — | 读本机 SQLite。「待触发（已逾期）」= 到点时会话不在、提醒留着重试，**不代表已送达** |
| `mochi_schedule_cancel` | `id`* | ID **必须来自 `mochi_schedule_list`**；重复取消安全；已触发过的一次性任务无法取消 |

### 6.12 `mochi-modeling` — 教学建模（1 个工具）

| 工具 | 边界 |
|---|---|
| `mochi_model_create` | 在指定目录生成 `model.html`（自包含交互页，**零 http(s) 外链**，JSXGraph 走本地 vendor 副本）+ `model.json`（类型/参数/公式/假设/版本/验证摘要）。**计算与画面同一份状态**：`conic.mjs` 是唯一公式来源，页面内嵌其原样副本，node 验证脚本 import 同一文件。JSXGraph `1.13.3` |

### 6.13 `mochi-modes` — 双模式（1 个升级工具）

| 工具 | 用途 |
|---|---|
| `mochi_request_work_mode` | 对话界面里**唯一**可调用的工具：请求老师批准进入工作界面 |

详见 §9。

### 6.14 无工具的服务端插件

| 插件 | 角色 |
|---|---|
| `mochi-hello` | 受管 Node 探测（`mochi-managed-node`） |
| `mochi-llm-mimo` | LLM provider（模型接入） |
| `mochi-web-search` | Web provider（`ctx.web`）；权威域名**加权**（不是白名单）：全国级 → 国际开放教材 → 省级 → 市级 → 商业教辅 |
| `mochi-lan` | 局域网服务（身份、发现、文件传输） |
| `mochi-approval` | 审批瀑布兼容适配器 |

---

## 7. 客户端 UI 扩展点（slot 表）

> 客户端插件注册的是 **slot**，不是工具。规则：**只挂 `dsh-better-sidebar`**。

| 客户端插件 | 注册的 slot / 能力 |
|---|---|
| `jxl-brand` | `sidebar.brand.mark`、`sidebar.brand.name`、`settings.general.item`、`conversation.hero.brand.mark` |
| `jxl-campus` | `shell.overlay`、`sidebar.footer.action`；HTTP 路由 `/campus`、`/assets/campus`、`/jxl-api` |
| `jxl-theme` | 样式层（无 slot）：calm-tokens → `--dsw-*` 令牌桥 |
| `mochi-workbench` | `conversation.session.header.actions` |
| `mochi-lan-client` | `shell.overlay`、`sidebar.footer.action` |
| `mochi-model-presets` | `settings.models.footer`、`settings.models.provider-card` |
| `mochi-modes-client` | 模式切换 UI + 读 `mochiModes` 投影 |
| `dsh-better-sidebar` | 右侧面板宿主（`ctx.betterSidebar.registerTab`） |

### 7.1 右侧面板规则（硬）

- **右侧面板只有 `dsh-better-sidebar` 一个家**（仅挂 `mochi-web`）。
  新面板一律用 **`ctx.betterSidebar.registerTab`**，**不要用 `shell.overlay`**。
- 教师工作台是侧边栏**首位 tab**（`order 5`，`single`）；开发向 tab（终端 / 浏览器 / Git）保留，老师可在设置页自关。
- `openTab` **内容型 seed（带 `path`）才自动展开**；类型型不展开。

### 7.2 对话/工作两界面

会话**只有一个官方 chat 视图**。两模式的差别只有三处：**工具面（restrict 面具）、工作台显隐、顶部模式标识**。

> ⛔ 不要再新增 `conversation.view` tab（早期设计已作废）。
> 正确的原生扩展点是 `ctx.uiConversation.views.register({id:"work"})` + `conversation.view` slot，
> 且**不得劫持 trajectory**。

---

## 8. 审批契约

### 8.1 官方结果词汇（封闭集合，四个值）

```
allowed-once | rejected | cancelled | unavailable
```

**不是** Mochi 定的，是官方 `@deepseek-ai/dsh-user-approval` 服务定的。

### 8.2 注册方式 —— 🔴 最大的坑

```js
// ✅ 正确：用 ctx.on 注册监听
ctx.on('approval/request', async (_request, next) => {
  // next() 委托给真正拥有决策权的 UI/ACP answerer
  const outcome = await next();
  return OUTCOMES.has(outcome) ? outcome : 'unavailable';
});

// ⛔ 错误：ctx.waterfall 是「派发」不是「注册」
```

**用 `ctx.waterfall` 当注册器 → 全体 fail-closed**（所有请求都拿不到决策）。
这是本项目踩过的最致命的一个坑：plan 期文档写的 `ctx.waterfall` 是错的，源码裁决为 `ctx.on`。

### 8.3 Mochi 的适配器立场

`mochi-approval` **刻意不是 answerer**，只做**安全委托**：

- **绝不自己制造 `allowed-once`**
- 没有 listener 时**不抛错**（抛出会让宿主组装失败；无 listener 时 Harness 自己解析为 `unavailable`）
- `next()` 不是函数、抛异常、或返回词表外的值 → 一律归 **`unavailable`**

```js
if (!ctx || typeof ctx.on !== 'function') {
  console.warn('[mochi-approval] no compatible approval waterfall; requests will fail closed');
  return;
}
```

### 8.4 审批 payload 没有工具参数

审批请求**只带工具名**，不带参数。所以**权限分级只能按工具名判**：

| 档 | 范围 | 行为 |
|---|---|---|
| **AUTO** | 一切只读 | 直接 `allowed-once` |
| **CONFIRM** | 发消息、放行学生、改正式记录、共享文件、导出提交外部 | **不自动决策** → 走 Web 原生审批卡，由老师点 |
| **DENY** | 白名单外工具、明确禁止操作 | `rejected` |

### 8.5 对接方必须遵守

1. **需要人工确认的动作，必须让原生确认卡出现**——不得回复 Markdown 伪卡，不得声称「有个按钮」。
2. **网络结果不明时不得重试**（`message_send` / `jxl_relay_send` 尤其）。
3. **学生的请假/放行永远路由给老师**，绝不代批。

---

## 9. 对话 / 工作双模式与投影

源码常量（`plugins/mochi-modes/modes.mjs`）：

| 常量 | 值 |
|---|---|
| `MODE_CHAT` / `MODE_WORK` | `chat` / `work` |
| `REQUEST_TOOL` | `mochi_request_work_mode` |
| `WORK_COMMAND` / `CHAT_COMMAND` | `mochi-work` / `mochi-chat` |
| `WORK_REQUEST_REASON` | `需要工作模式，继续？` |
| `PROJECTION_KEY` | `mochiModes` |
| `CONVERSATION_TOOLS` | `[mochi_request_work_mode]` |
| 保留名 `RESERVED_TOOL` | `run_code` |

### 9.1 收窄工具面的正确做法

```js
agent.ctx.tools.restrict(filter)   // 必须用「作用域上下文」agent.ctx
```

规则（全部来自官方文档，非猜测）：

- 省 token 的正解就是 `restrict`：「Restrictions that hide tools remove their entire schema cost for that agent.」
- **用根 `ctx` 会抛**「requires a scoped context (agent.ctx)」
- **空 filter（`{}`）会抛**；**未知工具名会抛**
- **`run_code` 不能出现在 allow/deny 里**（PTC 传输保留名）
- **allow 列表必须从「真实可见工具面」取交集**，不能写死猜的名字
- 面具只留 `allow` 里的全局/继承工具；**作用域自己那一层注册的工具不受影响**

### 9.2 两条升级路径

- **主路（对话 → 工作）**：模型调 `mochi_request_work_mode` → 官方原生审批卡问老师
  「需要工作模式，继续？」→ 老师点「允许一次」→ 同一会话解除限制 → 下一回合全量工具开干。
- **手动路径**：老师点「工作」→ 客户端经官方 commands 通道执行 `/mochi-work` →
  直接切换，**不弹窗**（一上来就点工作 = 老师已明确选了干活）。

### 9.3 🔴 fail-open 纪律（2026-09-12 补丁）

**仅工作模式的工具列表过滤：没有可用审批服务时，不施加该层 restrict 限制。校园写入工具自己的人工确认检查仍然存在，缺少确认通道会报错并不执行。**

理由：没有通道就没有老师能点「允许」，此时收窄工具面 = 让老师永远干不了活。
正确行为是**不收窄（工具面保持全量）+ 记日志 + 升级入口仍诚实报错**。

### 9.4 时序

`restrict` 只能在 **`agent/created`** 拿到真实 `agent.ctx` 后施加——
这是官方给宿主级插件留的**唯一入口**（`setup` 由 api-session-controller 的 `composeAgent` 独占，
宿主插件没有缝合点）。
时序上 `agent/created` **早于首个 prompt assembly**，足以在第一次请求前生效。

---

## 10. A2A / 局域网协议

### 10.1 任务状态机（7 态）

```
CREATED ──▶ DISPATCHING ──▶ DELIVERED ──┬──▶ COMPLETED   ┐
   │             │                       ├──▶ DECLINED    │ 终态
   └─────────────┴───────────────────────┴──▶ FAILED      │
                                           └──▶ EXPIRED   ┘
```

合法迁移表（源码 `TRANSITIONS`）：

| 当前态 | 可迁往 |
|---|---|
| `CREATED` | `DISPATCHING` / `EXPIRED` / `FAILED` |
| `DISPATCHING` | `DELIVERED` / `EXPIRED` / `FAILED` |
| `DELIVERED` | `COMPLETED` / `DECLINED` / `EXPIRED` / `FAILED` |

- 终态（`COMPLETED` / `DECLINED` / `FAILED` / `EXPIRED`）**不可逆**
- **自迁移不允许**（幂等由条件更新保证）
- 预留未启用：`INPUT_REQUIRED` / `APPROVAL_REQUIRED` / `CANCELLED`（字段与 UI 已留）

### 10.2 四原语与 TTL

| 原语 | 含义 | 过期 TTL |
|---|---|---|
| `ASK` | 问一句话等回话 | 24h |
| `REQUEST` | 请求做事等批准 | 24h |
| `FIND` | 找资源 | **72h** |
| `APPROVE` | 对入站请求的应答（由 `mochi_respond` 承载，**不单独建任务**） | — |

### 10.3 与联动计划 Relay 的兼容映射

| 任务态 | Relay 态 |
|---|---|
| `DELIVERED` | `pending` |
| `COMPLETED` | `accepted`（+ reply） |
| `DECLINED` | `declined` |

### 10.4 投递可靠性铁律

- **未知投递结果绝不重发。**
- 已确认未写入的失败，**只能**经 `retryTaskId` + **第二次人工确认**后建立新 attempt。
- `retryTaskId` 与 `newTask` **不能同时使用**；`retryTaskId` 必须是正整数且来自任务列表。
- 幂等键由**稳定 `callId`** 派生（无 `callId` 直接拒绝发送）：
  ```
  lanTaskMessageId = 'lan-'      + sha256(idempotency_key)[0:32]
  lanFileId        = 'lan-file-' + sha256(idempotency_key)[0:32]
  ```
- 投递状态词汇：`PENDING`(待确认) / `DELIVERED`(已确认投递) / `NOT_SENT`(确认未投递) / `UNKNOWN`(结果不明)。

### 10.5 局域网身份

`localLanOwnerKey` 由**锁定并持久化的局域网身份**派生，**永远不来自模型参数或校园账号**：

```
'local:' + schoolId + ':' + endpointId + ':' + fingerprint
```

- 未完成身份配置或未启动 → 拒绝发送
- **只有 `role === 'teacher'` 的教师端可以发送教室通知**
- 身份变更后的历史收件绑定需修复（历史坑）

### 10.6 安全治理口径（重要）

安全靠 **A2A 权限模型**（拒收 / 解除相识 / 禁用）+ **数据隔离**，
**不是**配对码 / HMAC / TLS 那套重防御。用户明确裁定：「没有这么严重」。

---

## 11. 数据、存储与路径安全

### 11.1 数据根

| 场景 | 路径 | 环境变量 |
|---|---|---|
| 开发态 | `<工作区>/.mochi-home.nosync` | `DSH_HOME` |
| 打包态 | `~/.mochi-home` | `DSH_HOME` |
| 教室端 | `.mochi-classroom-home.nosync` | 独立数据根 |

主要子路径：

- `$DSH_HOME/knowledge/textbook.sqlite` —— 教材索引（`mochi-knowledge` 导入）
- `$DSH_HOME/dispatch/` —— 任务域 SQLite
- `$DSH_HOME/.credentials.yaml` —— 凭据（权限 `0600`，首启种子写入）
- `<workspaceRoot>/.artifacts/` —— **本地 artifact store（唯一事实源，含版本链）**

### 11.2 路径安全边界（所有文件类工具共用）

所有路径先过安全边界（`plugins/mochi-files/paths.mjs` 等）：

- 只允许在**允许根目录之内**
- **拒绝**：`..` 穿越、绝对路径越界、符号链接穿越
- 默认只开放**当前会话工作区**，不开放整个用户目录或磁盘根
- 搜索/检索类工具**不跟随符号链接**

### 11.3 双环境分离

- **开发环境**与**打包环境**两套运行时根，不可混用。
- 密钥不打包进客户端；构建时从 gitignored 本地密钥注入。
- 测试期 API key 可内嵌安装包：教师不可见、**永不入 git**、受限可轮换。

---

## 12. 配置与环境变量

### 12.1 命名约定（2026-09-07 冻结增量）

| 对象 | 约定 |
|---|---|
| 品牌 | `Mochi` |
| 底座显示名 | `Mochi Harness` |
| 插件 | `mochi-*` |
| 环境变量 | `MOCHI_*` |
| label | `com.mochi.*` |

⛔ **不要再新增** `deepseek` / `dsh` 字样（存量不动）。
详见 `docs/mochi-naming-convention.md`——**这是唯一的约定文件**（不做脚本门禁、不做基线快照、不做批量扫描）。

### 12.2 关键环境变量（源码中出现，非完整清单）

| 变量 | 用途 |
|---|---|
| `DSH_HOME` | 运行时数据根 |
| `MOCHI_CAMPUS_API_URL` / `MOCHI_CAMPUS_DB` / `MOCHI_CAMPUS_SESSION_FILE` | 校园数据接入口 |
| `MOCHI_SEARXNG_ENDPOINT` / `MOCHI_WEB_SEARCH_MAILTO` | 搜索 provider |
| `MOCHI_SOFFICE` / `MOCHI_DOCUMENTS_PDFFONTS` / `MOCHI_DOCUMENTS_PDFTOTEXT` / `MOCHI_DOCUMENTS_PDFINFO` | 文档导出引擎与字体 |
| `MOCHI_PRESENTATIONS_PLUGIN_URL` / `MOCHI_PRESENTATIONS_ROOTS` | PPT 插件 |
| `MOCHI_LAN_DISCOVERY` | 局域网发现 |
| `MOCHI_DIRECTORY_PICKER` | 目录选择器：`auto` \| `browse` \| `native` |
| `MOCHI_RUNTIME_NODE` | 受管 Node |
| `MOCHI_ACTIVE_PROMPT_CONSUMER` | 活动上下文提示消费者 |
| `MOCHI_OFFICE_*` | 办公桥（JWT / 公网域名 / 校验标记） |

### 12.3 🔴 Windows 目录选择器（已裁定）

**win32 一律钉死 `browse` 交互，不用原生 COM 对话框。**

- 病根：win32 原生档 spawn worker 跑 `IFileOpenDialog`，真机上子进程**未回报即退出**
  → 宿主抛 `win32 folder dialog worker exited before reporting a result`。
- 上游 `built-worker.e2e.ts` **显式 skip win32**，且已删 PowerShell 兜底（无第二档）→ 不拿它赌。
- 落地：`apps/desktop/resources/mochi-web/runtime-profile.cjs` 的 `resolveDirectoryPickerPin()`
  （win32 默认钉 browse；**非 win32 保持上游自适应，macOS 系统对话框不变**）。
- 开关：`MOCHI_DIRECTORY_PICKER=auto|browse|native`。

---

## 13. 打包与发布

### 13.1 唯一路径

`docs/build-standard.md` 是打包/出包的**唯一事实源**。原文口径：

> **不存在第二条路径。特别地，不存在「手工热修包」这条路径。**

所有修复**必须进安装包**。⛔ 不要把手工热补丁目录当成交付方式。

### 13.2 CI

- **Mac 包**：本机构建。交付物在**工作区根** `release/`，**不在** `apps/desktop/release`。
- **Windows 包**：**GitHub Actions `windows-2022`**
  （`.github/workflows/windows-native-package.yml` + `.github/windows-native-package-inputs.json`）。
- ⛔ **Mac 上交叉编译 Windows 被 `assertNativeTarget` 明令拒绝**
  （`fs-ext` 需源码编译、`node-pty` 需 Windows SDK）。
- **Whisky = Wine 前端，不是 VM**：不能构建、不能验收，最多跑 exe 冒烟。

### 13.3 快照清单

```bash
node scripts/reconcile-snapshot-manifest.mjs --write   # 收敛：重算全部哈希 + 自动登记新文件
node scripts/check-snapshot-manifest.mjs --fail        # 校验：0 漂移才通过
```

基线（2026-09-12 日间）：**491 条**。
**⚠️ 2026-09-12 19:4x 实测已非 0 漂移**：11 个文件不一致、字节差 +34,614（磁盘实际 91,866,620 B）。改这些插件文件后必须跑 `scripts/reconcile-snapshot-manifest.mjs --write` 再复验。

> 🔴 **铁律**：改动 `.github/windows-native-package-inputs.json` 清单内**任何文件**，
> **必须同步重算 sha256 并累加 `expectedFileBytes`**，否则 Windows CI 快照校验**直接失败**。

### 13.4 🔴 补丁持久化坑

CI 快照排除 `node_modules`，只含 vendor tgz → **任何 `npm ci` 的包会丢全部 `[Mochi patch]`**
（中文菜单 6 条 + `dsh-llm-deepseek` 9 处修复）。
根治 = **重打包受影响的 tgz 合入补丁**。

---

## 14. 错误语义与失败处理

### 14.1 Fail-open vs Fail-closed（必须分清）

| 场景 | 正确行为 | 理由 |
|---|---|---|
| 工作模式审批服务**缺失** | **仅该层 fail-open**（不收窄工具面；不绕过校园写入检查） | 没有通道就没有人能批准；收窄 = 永久瘫痪 |
| 审批结果**词表外 / 异常 / 无 next** | **fail-closed → `unavailable`** | 不能凭空放行 |
| 工具名**不合规** | **抛错，整轮拒收** | 网关行为，无法降级 |
| 路径**越界** | **拒绝执行** | 安全边界不可协商 |
| 投递结果**不明** | **不重发**，标 `UNKNOWN` | 重发会造重复 |
| 导出引擎**缺失** | **如实报错** | 绝不伪造产物 |

### 14.2 典型错误码

| 码 | 含义 |
|---|---|
| `AUTH_REQUIRED` | 未登录嘉行联 → 前端显示「连接嘉行联」 |
| `PERMISSION_DENIED` | 权限不足 |
| `EXAM_FONT_UNAVAILABLE` | 缺 `Songti SC` 系统字体，试卷导出拒绝（**无静默替换**） |
| `NO_ALLOWED_ROOT` | 无可用允许根 → `ppt_inspect` 拒绝运行 |
| `WORKSPACE_UNAVAILABLE` | 无受管工作区 → `ppt_inspect` 拒绝运行 |
| `WEB_PROVIDER_CONFIG_INVALID` | Web provider 配置非法 |
| `ASSISTANT_RELAY_INVALID` (400) | 传话请求非法 |
| `ASSISTANT_RELAY_PEER_NOT_FOUND` (404) | 对方不存在 |
| `retryTaskId 必须是任务列表中给出的正整数` | 猜 ID 会被拒 |

> 完整的「预 INSERT 失败」清单见 `plugins/mochi-dispatch/index.mjs` 的
> `RELAY_PRE_INSERT_FAILURES`——**路径、状态、code 必须同时吻合**，
> 绝不能靠 HTTP 404 或错误文案猜测「确认未创建」。

---

## 15. 对接 checklist

新增一个 Agent / 插件 / 外部系统时，按顺序过：

- [ ] **1. 定侧**：服务端（有工具）还是客户端（挂 slot）？还是纯外部 A2A 对端？
- [ ] **2. 定 id**：`mochi-*`（服务端）/ `jxl-*` 或 `mochi-*-client`（客户端）；不新增 `deepseek`/`dsh` 字样
- [ ] **3. 工具名自检**：全部匹配 `^[a-zA-Z0-9_-]+$`，不含点号，不含 `run_code`
- [ ] **4. `render` 签名**：写成 `(args, value)`，不是单参数
- [ ] **5. 回执诚实**：写类工具必须有**做完之后的校验证据**（回读 / sha256 / 字节级比对）
- [ ] **6. 路径边界**：所有文件路径过允许根校验；拒绝 `..` / 绝对越界 / 符号链接
- [ ] **7. 审批档位**：只读 → AUTO；写/外发 → CONFIRM（不自动决策）
- [ ] **8. 登记三处**：`PLUGINS`（逐文件 `files`）+ `runtime-profile.json` + 快照清单
- [ ] **9. 重算快照**：`node scripts/reconcile-snapshot-manifest.mjs --write`
- [ ] **10. 跑测试**：`test-package-resources` / `test-runtime-profile` / 自己的插件测试
- [ ] **11. 加点号守卫覆盖**：走重放注册面的插件由 `assertPluginToolRegistration` 覆盖；
      不走重放的（`mochi-campus` / `mochi-dispatch`）靠
      `assertNoDottedToolNameLiterals(stageRoot/plugins)` 扫源码兜底。
      ⚠️ 两者**都不扫 `skills/`**——技能文档里的点号工具名需人工自查。
- [ ] **12. 写文档**：带 `status` / `last_verified` / `verified_by` 三字段

### 15.1 ⚠️ CI 覆盖缺口（务必知道）

公开 CI **不装依赖** → 凡 `import '@deepseek-ai/dsh-tools'` 的测试**跑不了**：

- `mochi-modes`、`mochi-visuals`、`mochi-sheets`、`mochi-documents`、`mochi-presentations`
  的绝大多数用例

**对策**：这些测试必须在**装好依赖的本机/带依赖的 job** 上跑，**不能只看公开 CI 绿灯**。

---

## 16. 硬约束与禁令

### ✅ Do

1. 工具只返回**结构化事实**，说话交给 Mochi。
2. 写类工具**做完再报**，自带校验证据。
3. 不支持的能力**明确说清支持什么**，不假装。
4. 需要人决定的动作**让原生确认卡出现**。
5. 新面板走 `ctx.betterSidebar.registerTab`。
6. 改完清单**立刻重算快照**。

### ⛔ Don't

1. ❌ 工具名带点号（会整轮 400 拒收）
2. ❌ 用 `ctx.waterfall` 注册审批 answerer（会全体 fail-closed）
3. ❌ 没有审批通道时收窄工具面（会永久瘫痪）
4. ❌ 用 HTML / 截图 / 改名文件冒充 `.pptx` / `.docx` / `.xlsx` / `.pdf`
5. ❌ 新增 `conversation.view` tab，或劫持 trajectory
6. ❌ 在 `shell.overlay` 里造右侧面板
7. ❌ 猜 ID（`retryTaskId` / 流动单 ID / 事件 ID 一律取自列表）
8. ❌ 投递结果不明时重发
9. ❌ 替老师批放行 / 批假
10. ❌ 疾病预警、风险评分、心理测评、生物识别、GPS、硬件对接
11. ❌ 手工热修包当交付方式
12. ❌ 单个插件漏带依赖就提升（会崩整个 profile）

---

## 17. 附录

### 17.1 文档权威分层（谁说了算）

| 层级 | 文件 | 管辖 |
|---|---|---|
| 层级 | 入口 | 管辖 |
|---|---|---|
| 当前用户结论 | 当前任务中的明确更正 | 现场验收与目标 |
| 当前实现 | **源码、配置与可复现检查** | 运行行为 |
| 当前摘要 | `docs/PROJECT-STATUS.md`、`docs/DELIVERY-LEDGER.md` | 项目与交付状态 |
| 产品设计 | `Mochi-总体方案.md` | 产品定位、能力与边界 |
| 历史 | `docs/history/foundation/`、`docs/tasks/`、`docs/history/`、`artifacts/` | 过程与时点证据，不作为当前摘要 |

完整冲突处理见 `docs/DOC-AUTHORITY.md`。

### 17.2 三条截止日期（勿混）

| 日期 | 含义 | 状态 |
|---|---|---|
| **2026-09-11** | 历史出包节点 | 已被 2026-09-13 的后续安装包取代 |
| **2026-09-30** | 历史文档记录的参赛材料节点 | 是否仍为官方当前截止时间需按比赛通知复核 |

### 17.3 术语表

| 词 | 含义 |
|---|---|
| **Mochi Harness** | 运行时底座（cordis 插件内核）的对外显示名 |
| **profile** | 一组插件 + 配置的组合（`mochi-web` / `headless` / 教室端等） |
| **slot** | 客户端 UI 扩展点（如 `settings.models.footer`） |
| **投影 / projection** | 服务端写到会话上的可读状态（如 `mochiModes`），客户端读取决定 UI |
| **A2A** | Agent-to-Agent：教师端 ↔ 教室端 / 同事 Mochi 的协作 |
| **relay** | 联动计划的传话网络（服务器只投递一句话，应答永远由人决定） |
| **restrict** | 官方工具面收窄 API（省 token 的正解） |
| **artifact** | 生成的产物（`.pptx` / `.docx` / `.xlsx` / `.pdf` / SVG / PNG） |
| **TR/AC** | Trajectory（完整工作轨迹）/ Advanced 区 |

### 17.4 自查工具

```bash
node scripts/scan-doc-drift.mjs            # 文档漂移（11 条规则，带 文件:行号）
node scripts/scan-doc-drift.mjs --json     # 机器可读
node scripts/reconcile-snapshot-manifest.mjs --write
node scripts/check-snapshot-manifest.mjs --fail
```

---

*本手册面向外部 Agent 对接。发现与源码不符的地方，**以源码为准**，并回来改本文。*
