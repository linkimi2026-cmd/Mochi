# Mochi · Teacher Productivity Toolchain — 工具层规格文档

> 文档定位：工具层是这一轮的重中之重，本文档是**可直接照着实施的规格**，不是概念稿。
> 配套依据：`plugins/mochi-campus/index.mjs`（已跑通参考实现）、`dsh-src`（Mochi Harness 源码）、`.mochi-home.nosync/profiles/headless/cordis.patch.yml`、`skills/mochi/SKILL.md`。
> 写作约定：结论直接定死；有工程方案分歧处按「首选 / 理由 / 备选 / 切换条件」四段；无依据处标 `TO_BE_RESOLVED_BY_CODEX`，绝不编造类名/函数名/路径。

---

## 0. 事实基础（已核实，作为一切设计的前提）

这些事实来自对 dsh 源码与已跑通插件的直接阅读，后续所有结论都建立在它们之上。

### 0.1 `defineTool` 契约（来自 `packages/core/tools/src/schema.ts`）
工具通过 `defineTool` 注册，签名已逐字段核对：

```ts
interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
  name: string;                                  // 工具全名，必须唯一
  description: string;                           // 给模型看的自然语言说明
  parameters: S;                                 // 隐式 open-object 根，逐属性声明
  output: {
    schema: O;                                   // 输出 JSON Schema（强制）
    render(args, value): ContentBlock[];         // 纯函数：把结构化结果渲染成模型可见块
    presentationMeta?(args, value): JsonValue;   // 可选：顶层直调时的可重放展示元数据
  };
  timeoutMs?: number;                            // 可选：正向协作超时预算（ms）
  isConcurrencySafe?(args): boolean;             // 可选：是否可并行
  execute(args, exec: ToolRunContext): Promise<InferValue<O>>;  // 真正实现
  finalizeContent?(exec, result): ContentBlock[] | undefined;    // 可选：所有归一化结果的末段转换
  presentCall?(args): ToolCallView | undefined;  // 可选：调用中展示
  presentResult?(args, result): ToolResultView | undefined;       // 可选：完成后展示
}
```

**关键约束（用户已踩坑并强调）：**
- 嵌套 `object` 必须显式写 `additionalProperties: true | false`，否则加载失败（`schema.ts` 第 367 行硬校验）。
- 属性必填用 `{ type:'string', required: true }`（注意不是对象级的 `required` 数组）。
- `render` 是纯函数，返回 `ContentBlock[]`（实测 `mochi-campus` 用 `{ type:'text', text: JSON.stringify(value, null, 2) }`）。
- `execute` 返回值的类型必须匹配 `output.schema`；dsh 会在执行后做 schema 校验，类型不符会报 `ToolArgsError` 同类失败。
- `ToolRunContext extends ToolExecution`，**不含** `ctx` 本身；但 `apply(ctx)` 注册时可闭包捕获 `ctx`，因此工具内部可调用 `ctx.approval`、`ctx.subagents` 等已挂载服务。

### 0.2 已在 dsh 内建、禁止重复造的能力
| 能力 | dsh 模块 | 本文档的处置 |
|---|---|---|
| Human Approval | `interaction/user-approval`（`ctx.approval.request(req)`） | 工具在写操作前调用，实现"先确认后执行" |
| 权限预设 | `interaction/permission-presets`（workspace-write + ask / danger-full-access + never） | 作为 Mochi 默认权限底座 |
| 子代理 / A2A | `subagent/`、`subagent-acp`、`tool-subagent`、`tool-subagent-control` | `mochi.ask` 直接映射到 `tool-subagent` |
| 任务编排 / 迭代循环 | `workflow/`、`tool-ralph` | Q4 质量循环的备选方案 |
| MCP 集成 | `mcp/` | 嘉行联未来可选 MCP 接入，本期不依赖 |
| 图片附件 | `attachment/`（**仅 raster 图片**） | Q5 Artifact 必须自建，图片走此通道 |
| 自定义 UI 通道 | `sdk/`（JSON-RPC 协议 + client/server）、`bundle/sdk-app` | Artifact 预览/导出的通道底座 |
| 护栏 | `guard/`（含 `timeout-policy`、`repeat-tool-reminder`） | 防失控循环、防重复调工具 |

### 0.3 dsh 的 Approval 机制要点（来自 `user-approval/README.md`）
- 调用形态：`ctx.approval.request({ agent, tool, callId?, reason, signal })` → 返回 `allowed-once` / `rejected` / `cancelled` / `unavailable`。
- **缺省、非属主、或抛错一律 fail-closed 到 `unavailable`**（即不执行）。这是安全底线。
- 会话级策略：`ask`（默认，委托给 answerer）/ `never`（确定性拒绝，无需任何人确认）。
- 只支持**一次性授权**（`allowed-once`），没有 `allow-always`，请求体**不携带工具参数**（answerer 只看到 tool 名 + reason + callId）。
- 含义：写操作工具自己决定是否要先 `request`，并把 reason 写清楚（"我要给张老师发换课请求"而非"确定吗"）。

### 0.4 文件生成库 License 实测（Q3 直接依据）
用 `npm view <pkg> license version` 实测，结论如下（GPL 一律不可用、无 License 不可用）：

| 库 | 版本 | License | 用途 | 结论 |
|---|---|---|---|---|
| `pptxgenjs` | 4.0.1 | MIT | 生成 .pptx | ✅ 用 |
| `docx` | 9.7.1 | MIT | 生成 .docx | ✅ 用 |
| `exceljs` | 4.4.0 | MIT | 生成 .xlsx | ✅ 用 |
| `pdf-lib` | 1.17.1 | MIT | 生成/合并/修改 .pdf | ✅ 用 |
| `pdfjs-dist` | 6.3.289 | Apache-2.0 | 读取/抽取 PDF 文本 | ✅ 用（Apache-2.0 非 GPL） |
| `jszip` | 3.10.1 | MIT OR GPL-3.0-or-later | `docx`/`exceljs` 传递依赖 | ⚠️ 双授权，我们**显式选用 MIT 选项**（合规）；纳入最终 License 审计待办 |
| `image-size` | 2.0.2 | MIT | 图片/Artifact 尺寸探测 | ✅ 用（可选） |
| `pptxgenjs-decode` | — | 无结果/不确定 | 解析已有 pptx | ❌ 弃用，改用自建轻量 OOXML 解析（见 3.4） |

> License 红线声明：`jszip` 的双授权必须在使用 `docx`/`exceljs` 时以 `MIT OR GPL-3.0-or-later` 中的 **MIT** 选项为准，并在 `THIRD_PARTY_LICENSES` 中明示。最终合规由 `TO_BE_RESOLVED_BY_CODEX`（License 审计步骤）确认。

---

## 1. Q1 — 第一批 P0 工具清单（直接下结论）

### 1.1 取舍基准（两条硬约束）

> 🔴 **修订记录（设计修订官 / 指令 A + 指令 B）**：
> - **指令 B（傻瓜式、服务老师）**：工具设计须接受"老师不太会用 AI 工具"的检验——① **老师不用写 prompt**：工具 + Skill 让 AI 智能判断后直接可用；② **预置配置**：身份/班级/课表/权限/模型开箱即用（默认 `glm-4-flash`）；③ **校园场景优化**：针对教师/学生场景全方面优化，效果要好于同类工具。具体设计约束见 **`10_TEACHER_UX.md`**（本文件不重复造）。凡新增工具，必须回答"老师可见复杂度是否过高、是否需写 prompt"。
> - **指令 A（模型可切换是一等公民）**：模型切换不写死、不自动路由，由 **`09_MODEL_SWITCHING.md`** 定义（类 Codex CLI `/model`，用户随时切 + 加自定义 provider 极简）。本工具层不预设模型路由逻辑。

1. **能演示出彩**：杀手级演示叙事 = "把月考分析做成一份 PPT，且 Mochi 自己检查并改到合格再交付" + "现在医务室有谁" + "给王老师发条换课消息（需确认）"。这条叙事覆盖：办公文档生成、质量循环、嘉行联、通信审批。
2. **26 天内做得完**：每个 P0 工具 = "薄封装一个已验证 MIT 库 + 结构化 schema + 一个 demo 数据路径"。不碰需要数月的能力（全功能浏览器自动化、完整日历后端、多 Mochi 联邦）。

### 1.2 P0（必须做，演示核心，**38 个工具 — 唯一权威清单**）

> 🔴 **修订记录（设计修订官 / P0-3，裁决 R1）**：本 §1.2 明细求和 = **38**，是工具层的**唯一权威清单**。03 原稿写"60+ 工具"已作废（把 P1 ~20 个偷渡进了 P0）。Skill 层(03 §4.2) 所有 `Tools:` 已逐条对齐本清单真实命名（见 03 修订）。任何文档凡引用工具名，一律以本清单为准，不允许出现 `doc.write`/`schedule.*`/`campus_query_student`/`user-questions`/`browser.*` 等本清单之外的名字。

**A. Presentation（7）** — 演示门面，质量循环的主战场
`ppt.create` / `ppt.inspect` / `ppt.edit_slide` / `ppt.add_slide` / `ppt.apply_theme` / `ppt.export`
（理由：`inspect`+`edit_slide` 实现"自检→修改→复检"；`create`+`export` 出真实文件。去掉的 `remove_slide`/`reorder` 留 P1，因为演示不依赖它们。）

**B. Document（4）**
`doc.create` / `doc.read` / `doc.edit` / `doc.export`
（`doc.format` 留 P1；`read` 是 INSPECT 环节，`edit` 是 EDIT 环节。）

**C. Spreadsheet（5）**
`spreadsheet.create` / `spreadsheet.read` / `spreadsheet.write` / `spreadsheet.formula` / `spreadsheet.export`
（`chart`/`analyze` 留 P1。`read` 给 PPT 提供数据源，`formula` 让生成表格有真实计算。）

**D. PDF（4）**
`pdf.read` / `pdf.create` / `pdf.merge` / `pdf.export`
（`extract` 留 P1。`read`/`create` 用 pdf-lib，抽取文本用 pdfjs-dist；`merge` 演示"多份材料合成一份"。）

**E. File（6）** — 薄封装 dsh 已内建 `read/write/edit/glob/grep`
`file.search` / `file.read` / `file.create_folder` / `file.rename` / `file.copy` / `file.move`
（`organize` 留 P1，因其启发式风险高。高影响修改（`rename`/`copy`/`move`）走 Approval。）

**F. Calendar / Task（5）** — 本地 JSON store 抽象，便于将来换真实后端
`calendar.search` / `calendar.create` / `task.create` / `task.update` / `reminder.create`

**G. Communication（2，P0 最小集）**
`message.draft` / `message.send`
（`message.send` 走 Approval。完整的 `mochi.*` 编排留 P1。）

**H. JiaXingLian（5，Organization Plugin）** — 把 `mochi-campus` 升级为完整组织插件
`jxl.student_query` / `jxl.clinic_status` / `jxl.dorm_status` / `jxl.campus_status` / `jxl.message`
（全部先走 demo 数据层，契约固定，将来换真实 API 只改取数。）

> **P0 合计 38 个工具**（7+4+5+4+6+5+2+5）。这个集合能完整跑通"生成→自检→修改→交付"演示与"查状态 / 发消息"两条副线。

### 1.3 降级到 P1（演示前 polish，约 20 个）
`ppt.remove_slide` / `ppt.reorder` / `doc.format` / `spreadsheet.chart` / `spreadsheet.analyze` /
`pdf.extract` / `file.organize` / `browser.search` / `browser.open` / `browser.extract` /
`message.*` 富化 / `mochi.ask` / `mochi.find` / `mochi.request` / `mochi.approve`

### 1.4 砍到 P2 或本期不做（明确不做，避免摊薄）
- `browser.fill` / `browser.download` / `browser.navigate`（交互式浏览器，风险高、演示收益低，需 P2 单独评估）。
- 多 Mochi 联邦编排（`mochi.request`/`approve` 的完整联邦）——依赖 A2A 基础设施，留 P2。
- 本地 Companion 全功能桌面控制——本期**只设计接口与协议**（见 Q6），不开放真实执行。

### 1.5 工具不做什么（红线，写进每个插件）
- 工具**绝不生成面向用户的最终话术**。`render()` 只返回事实 JSON（`{type:'text', text: JSON.stringify(value)}`）；是否"已为您生成"这种话由 LLM 在工具返回后生成。验收指标：**Local Rule Direct Return Rate < 5%**。
- 纯聊天 / 写作 / 润色 / 翻译 → 走 LLM，**不调工具**。
- 工具是插件，不是硬编码。嘉行联 = Organization Plugin，未认证用户仍可聊天/写作/文档/文件，只是调不了 `jxl.*`。

---

## 2. Q2 — 插件切分方案（直接下结论）

### 2.1 切分原则：按「域」切，本地 Companion 单独成块（按风险隔离）
理由：
- dsh 哲学是 "Everything is a Plugin"，按域切（mochi-ppt / mochi-doc / …）最贴合 runtime，每个域一个 `apply(ctx)` 注册自己的 `defineTool`，互不污染。
- 按风险切一层：**本地 Companion 类（会碰用户本机）单独一个 `mochi-companion` 插件**，且 P1 才接真实执行；P0 阶段它只存在接口与桩。这样即便 Companion 出问题也不拖垮云侧工具。
- 共享逻辑（Artifact store、workspace 路径解析、approval 封装、schema 片段）抽到 `mochi-core`，避免 9 个插件各自重复。

### 2.2 目录结构与职责边界

```
/Users/a1379/Documents/Mochi/plugins/
├── mochi-core/                # 共享底座（无独立工具，仅被依赖）
│   ├── index.mjs              # 注册共享服务：ArtifactStore、ApprovalGuard、workspacePath()
│   ├── artifact-store.mjs     # Q5 Artifact 模型与版本/索引持久化
│   ├── approval.mjs           # 封装 ctx.approval.request，统一 reason 模板
│   └── schemas.mjs            # 公共 schema 片段（artifactRef、pageRef 等）
│
├── mochi-ppt/                 # Presentation 域（7 工具）
├── mochi-doc/                 # Document 域（4 工具）
├── mochi-spreadsheet/         # Spreadsheet 域（5 工具）
├── mochi-pdf/                 # PDF 域（4 工具）
├── mochi-file/                # 文件薄封装（6 工具，高影响走 Approval）
├── mochi-browser/             # 只读为主的 Web（P1 接入；P0 仅 search/open/extract 桩）
├── mochi-calendar-task/       # 本地 store + 工具（5 工具）
├── mochi-comm/                # message.draft/.send + mochi.* 编排（P0: draft/send）
├── mochi-jiaxinglian/         # Organization Plugin（5 工具，demo 数据层）
└── mochi-companion/           # 本地 Companion 协议客户端（P1 真实执行；P0 仅接口/桩）
```

**每个业务插件的统一骨架**（以 `mochi-ppt` 为例，沿用 `mochi-campus` 的写法）：

```js
import { defineTool } from '@deepseek-ai/dsh-tools';
import { approvalGuard } from 'mochi-core/approval.mjs';   // TO_BE_RESOLVED_BY_CODEX: 跨插件 import 方式
import { artifactRef } from 'mochi-core/schemas.mjs';

export const name = 'mochi-ppt';
export const inject = ['tools', 'approval', 'artifactStore', 'workspacePath']; // 声明依赖的服务

export function apply(ctx) {
  const ws = ctx.workspacePath();                 // 落盘根目录（见 Q5/2.3）
  const store = ctx.artifactStore;

  ctx.tools.register(defineTool({
    name: 'ppt.create',
    description: '根据结构化大纲创建 .pptx 文件……（给模型看，写清何时调）',
    parameters: { /* 见 3.3 */ },
    output: { schema: { type:'object', additionalProperties:false, properties:{ artifact: artifactRef, slideCount:{type:'number'} } },
              render: (_a, v) => [{ type:'text', text: JSON.stringify(v) }] },
    async execute(args, exec) {
      // 1) 用 pptxgenjs 写文件到 ws
      // 2) 在 store 登记 Artifact（见 Q5）
      // 3) 返回结构化事实
    },
  }));
  // ……其余 6 个工具
}
```

### 2.3 落盘与 workspace 路径
- 所有生成文件写入统一的 `workspaceRoot`（建议 `~/.mochi/workspace` 或 dsh 的 workspace 目录）。
- `mochi-core` 暴露 `workspacePath()`：优先读插件配置项 `workspaceRoot`，缺省回退到 `process.env.MOCHI_WORKSPACE`（由 profile 注入）。
- `TO_BE_RESOLVED_BY_CODEX`：dsh 是否已有 `ctx.workspace` / `getWorkspaceDir()` 服务可直接复用？源码 `packages/workspace/src` 在本仓库快照中未直接命中，需在建插件时确认；若 dsh 已提供则用它的，否则用上面的配置回退方案（二选一，不影响工具契约）。

### 2.4 嘉行联作为 Organization Plugin（非硬编码）
- `mochi-jiaxinglian` 通过 `inject` 拿到一个 `jxlClient` 服务（P0 由插件内 `demo` 实现，未来换成真实 HTTP client）。
- 未认证 / 未挂载该插件时，`jxl.*` 工具不存在，Mochi 仍能聊天、写作、用 `mochi-doc`/`mochi-file` 等。这正是 SKILL.md 规定的边界。
- 插件内所有取数先过 `resolveFilters` 式的意图归一化（沿用 `mochi-campus` 踩坑教训：状态/地点/姓名/班级都要能查，不能只匹配姓名）。

---

## 3. Q3 — 文件生成技术选型（库名/版本/License 已实测）

### 3.1 选定栈（全部 MIT / Apache-2.0，红线合规）
- PPT：主用 **`pptxgenjs@4.0.1`（MIT）** 生成；读取已有 pptx 用**自建轻量 OOXML 解析**（不依赖 `pptxgenjs-decode`，因其 License 不确定）。
- Word：**`docx@9.7.1`（MIT）** 生成；读取用 `docx` 的反向 + `pdfjs` 不适用，故 Word 读取走 **`mammoth`**——`TO_BE_RESOLVED_BY_CODEX`：mammoth 的 License 需实测确认（已知为 BSD-3，但须以 `npm view` 复核）；若不可用，`doc.read` 降为"读取明文/简单结构"并标 P1。
- Excel：**`exceljs@4.4.0`（MIT）** 生成 + 读取 + 公式。
- PDF：生成/合并/修改 **`pdf-lib@1.17.1`（MIT）**；文本抽取 **`pdfjs-dist@6.3.289`（Apache-2.0）**。
- 图片尺寸/缩略图：`image-size@2.0.2`（MIT，可选）。

### 3.2 运行时前提
- dsh runtime 是 Node ≥22（来自根 `package.json` engines），上述库均为纯 JS、ESM 友好，可在插件 `execute` 内 `import` 并同步/异步写盘。**全部在 Node 进程内真实生成文件**，不是假的。
- 依赖加入各插件目录的 `package.json`（或统一在 Mochi 项目 `package.json`），随 `dsh plugin add` 安装。

### 3.3 生成类工具的统一输出契约（TypeScript interface）
```ts
interface GeneratedArtifact {
  artifactId: string;     // 对应 Q5 Artifact.id
  path: string;           // 落盘绝对路径（workspaceRoot 下）
  mimeType: string;       // 如 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  bytes: number;
  slideCount?: number;    // ppt
  pageCount?: number;    // pdf / doc
  sheetCount?: number;   // spreadsheet
  warnings?: string[];   // 工具算出的客观告警（见 Q4 的 INSPECT 信号）
}
```
`render()` 一律 `JSON.stringify` 该对象；**不写任何"已为您生成"之类话术**。

### 3.4 OOXML 读取（INSPECT 的数据源）
`ppt.inspect` / `doc.read` / `spreadsheet.read` 需要把已有文件解析成结构化数据。方案：
- **首选**：`exceljs` 原生读 xlsx；`docx` 提供有限读取；pptx 用**自建最小 XML 抽取**（解析 `ppt/slides/slideN.xml` 提取文本/形状，逻辑约 150 行，可控、无 License 风险）。
- 理由：避免引入 License 不确定或体量大（如 `pdf-parse` 曾改 License）的解析库。
- **备选**：若评测需要更鲁棒，`doc.read` 接 `mammoth`（待 License 复核）。
- 切换条件：当且仅当 `mammoth` License 复核通过且读取准确率不足时启用。

---

## 4. Q4 — 质量循环 PLAN→CREATE→INSPECT→CRITIQUE→EDIT→VERIFY→DELIVER

### 4.1 首选方案：工具提供"结构化事实"，模型在 skill 引导下自行闭环
**链路映射：**
| 阶段 | 谁做 | 用什么 |
|---|---|---|
| PLAN | LLM | 无需工具，先想清目标与大纲 |
| CREATE | Tool | `ppt.create` / `doc.create` / `spreadsheet.create` |
| INSPECT | Tool | `ppt.inspect` / `doc.read` / `spreadsheet.read` 返回**结构化页面模型** |
| CRITIQUE | LLM | 依据 `inspect` 返回的客观字段（文本长度、溢出标记、空页）判断 |
| EDIT | Tool | `ppt.edit_slide` / `doc.edit` / `spreadsheet.write` / `spreadsheet.formula` |
| VERIFY | Tool | 再次 `inspect`，确认修改生效 |
| DELIVER | Tool | `ppt.export` / `doc.export` / `spreadsheet.export` 产出最终文件 |

**关键设计——`inspect` 返回"可被模型判断"的结构化事实：**
```ts
interface SlideInspection {
  slideIndex: number;
  title: string | null;
  bullets: string[];
  textLength: number;          // 客观指标，模型据此判断"字太多"
  shapeCount: number;
  notes: string | null;
  warnings: string[];          // 工具算出的客观告警，例如 ['text_overflow:slide3','empty_slide:slide5']
}
interface PptInspectResult {
  fileId: string;
  slideCount: number;
  slides: SlideInspection[];
}
```
- 工具只算**客观**指标（字数、空页、形状数），**不替模型下"该不该改"的结论**——判断权在 LLM，符合"工具返回事实、话术由 LLM 生成"。
- 闭环由一个新的 Mochi **skill（非工具、非 workflow）** 引导：该 skill 在"生成类任务"中提示模型"CREATE 后必须 INSPECT，发现 `warnings` 必须 EDIT 再 VERIFY，循环直到无 blocking warning"。

**理由：**
1. 用户明确反对 `generate()→返回文件→END` 的一次性模式；模型自驱循环天然满足"Agent 检查并修改自己产出"。
2. 不把循环写进工具内部——保持"工具返回事实、LLM 编排"，契合原则 2、4。
3. 复用 dsh 已验证的 `defineTool` + skill 机制，26 天内可落地，无需新运行时。

### 4.2 防失控（必须配 `guard/`）
- 启用 `guard/repeat-tool-reminder`：同一工具连续 N 次且参数相似时提醒模型换思路（防止无限 `edit` 循环）。
- 启用 `guard/timeout-policy`：给 `create`/`inspect`/`export` 设 `timeoutMs`（如 30s），避免大文件卡死。
- 模型侧规则（写进引导 skill）：同一 artifact 的 EDIT 循环上限 5 次，超过则向用户说明并交还控制权。

### 4.3 备选方案：`tool-ralph` 长循环
- 适用：用户明确要求"持续改到满意"、或文档体量极大、模型内联循环反复失败时。
- `ralph` 是固定前台 fresh-agent 循环（`objective` + `maxRounds`，返回 `complete`/`blocked`/`budget-limited`）。每轮 fresh agent 只看到上轮 bounded report，靠 workspace 文件作为跨轮记忆。
- **切换条件**：当内联循环 2 次以上仍不满足、或用户显式要"自动多轮迭代"时，调用 `ralph` 把该 artifact 的优化目标交给它，模型退居监控。
- 风险：fresh agent 不继承对话，需把 artifact 路径与优化标准写进 `objective`，且 ralph 默认 `maxRounds=256` 要显式调小（演示设 6~8）。

### 4.4 不采用的方案
- 不在单个工具内写 `while` 自动循环（违反工具只返回事实的原则，且难以中断/审计）。
- 不默认用 `workflow` fan-out（这是多 agent 并行，不是单 artifact 自检，定位不同）。

---

## 5. Q5 — Artifact 层设计（自建，因为 `attachment/` 仅支持图片）

### 5.1 Artifact 模型（TypeScript interface，强制字段）
```ts
type ArtifactType = 'presentation' | 'document' | 'spreadsheet' | 'pdf' | 'image' | 'other';
type ArtifactPermission = 'private' | 'shared' | 'public';

interface Artifact {
  id: string;                 // 全局唯一，建议 uuid v7 或 nanoid
  type: ArtifactType;
  name: string;               // 用户可读名，如 "月考分析.pptx"
  mimeType: string;           // RFC 6838 媒体类型
  owner: string;              // 创建者身份（用户 id / 'mochi' / agent id）
  sourceTask: string | null;  // 触发创建的任务/会话 id（可追溯）
  version: number;            // 从 1 起，每次编辑 +1
  permissions: ArtifactPermission;
  availableOperations: string[]; // ['read','edit','export','share','preview'] 等能力声明
  path: string;               // 当前版本落盘路径
  createdAt: string;          // ISO8601
  updatedAt: string;          // ISO8601
  parentId: string | null;    // 上一版本 artifact（版本链）
  derivedFrom: string | null; // 上游 artifact（如 "本 PPT 由 spreadsheet X 的数据生成"）
}

interface ArtifactVersion {
  artifactId: string;
  version: number;
  path: string;
  createdAt: string;
  note: string;               // 本次变更摘要（由调用方/模型填，如 "slide3 缩减文字"）
}
```

### 5.2 存储与版本
- 索引：`mochi-core/artifact-store.mjs` 维护 `<workspaceRoot>/.artifacts/index.json`（artifact 元数据表）+ 版本链。
- 文件落盘：`<workspaceRoot>/.artifacts/<artifactId>/v<n>/<name>`（copy-on-write，每次 `edit` 写新版本，不覆盖旧版——满足"版本更新"要求且可回滚）。
- 所有生成类/编辑类工具在执行后**必须**调用 `store.put(artifact)` 登记或 `store.commitVersion(...)` 推进版本；返回里带 `artifactId` 供后续任务引用。

### 5.3 支持的链路操作（明确 API 形态，不写实现）

> 🔴 **修订记录（设计修订官 / P0-4 + 砍刀清单）**：经裁决 R3，01 本地 store（`<workspaceRoot>/.artifacts` + 版本链）是 v1 **唯一事实源**；跨主体共享（HMAC Grant 链）已降级为未来规范（见 02 §4）。故 v1 只做 **create / read / export + 版本链**，"共享"与"像素预览"砍掉。

| 操作 | 由谁触发 | 机制 |
|---|---|---|
| 创建 | `*.create` | `store.create({type,name,mimeType,owner,sourceTask})` → 返回 `artifactId` |
| 读取 | `*.read` / `*.inspect` | 用 `artifactId` 或 `path` 定位当前版本文件 |
| 编辑/版本更新 | `*.edit` / `*.write` | `store.commitVersion(artifactId, {note})` 写 v+1 |
| 导出 | `*.export` | 复制/转换到用户指定路径，返回导出路径 |
| 预览 | 预览通道 | 见 5.4（**仅结构化概览**，非像素级） |
| 共享 | **v1 砍（R3）** | 跨主体共享改由桌面 APP 本地复制文件 + 确认卡代替，不做 `mochi.artifact_grants` HMAC 下载链 |

### 5.4 "Excel → 总结 → Word"链路如何跑通
1. `spreadsheet.create` 生成 `artifactA`（xlsx），登记。
2. `spreadsheet.read(artifactA.id)` 取结构化数据 → LLM 总结（**纯 LLM，不调工具**）。
3. `doc.create({ derivedFrom: artifactA.id, ... })` 生成 `artifactB`（docx），`derivedFrom` 指回 A，形成可追溯链路。
- 这证明 Artifact 作为"后续任务输入"成立：工具靠 `artifactId` 跨任务引用，而非把整文件塞进上下文。

### 5.5 预览通道（不重新造 UI，复用 dsh SDK）
- 图片类：直接走 dsh 内建 `attachment/`（图片支持）。
- 非图片（pptx/docx/xlsx/pdf）：`mochi-core` 提供一个**预览解析**能力——把 artifact 转成"结构化概览"（本质复用各 `*inspect`/`read`），通过 `bundle/sdk-app` 的 JSON-RPC 通知把概览推给前端。
- **v1 砍像素级预览（R3 / 砍刀清单）**：预览仅提供结构化概览（复用各 `*inspect`/`read`），**不依赖 LibreOffice/`soffice`**，也不做 HMAC 下载链。像素级缩略图留 P2（若目标机预装 soffice 再评估）。

---

## 6. Q6 — 本地 Companion 接口草案（本期只设计，不开放执行）

### 6.1 范围定死
- 第一版**只设计接口、协议、权限、连接流程**；本地 Companion 默认处于"已注册但未授权任何敏感能力"状态。
- 绝不为了炫技把电脑完全开放给 Agent。Companion 只暴露**白名单能力**，且每次敏感执行都过 OS 级用户确认。

### 6.2 架构与数据流
```
Cloud Agent (dsh, 已部署)
   │  JSON-RPC over 安全通道 (WebSocket/stdio tunnel，复用 dsh SDK 协议)
   ▼
Local Companion (用户本机常驻轻量进程)
   │  1. 收到任务 → 2. 匹配能力白名单
   ▼
Permission Gate (Companion 本地)
   │  3. 弹 OS 级确认框（显示"Mochi 想读取 桌面/月考.xlsx"）
   ▼
Execute (仅白名单 + 已授权)
   │  4. 执行，捕获结果/错误/审计
   ▼
Result → 安全通道 → Cloud Agent → 作为工具返回值
```
- 安全通道：复用 `sdk/` 的 JSON-RPC 线协议（`packages/sdk/protocol`），Companion 作为 SDK server 一侧，`mochi-companion` 插件作为 client。
- 认证：Cloud↔Local 首次连接用一次性握手码（用户在本机 Companion 输入 Agent 提供的 code），之后用短期 token。`TO_BE_RESOLVED_BY_CODEX`：具体握手与密钥管理细节在 P1 实现时定。

### 6.3 JSON-RPC 方法草案（接口骨架，参数/返回用 JSON Schema 思路）
```ts
// 握手与能力发现
companion.handshake({ agentId: string, challengeCode: string })
  -> { accepted: boolean; companionId: string; token: string }

companion.listCapabilities()
  -> { capabilities: Capability[] }   // 如 {id:'file.read', scope:'~/Desktop', risk:'low'}

// 权限与执行
companion.requestPermission({ capability: string; resource: string; reason: string })
  -> { decision: 'granted'|'denied'|'cancelled' }   // 弹 OS 确认

companion.execute({ capability: string; params: object; token: string })
  -> { status: 'ok'|'error'; result?: JsonValue; error?: string; auditId: string }

companion.cancel({ taskId: string }) -> { cancelled: boolean }
```

### 6.4 权限与风险分级（写进 Companion）
| 风险级 | 示例能力 | 默认策略 |
|---|---|---|
| low | `file.read`（限白名单目录）、`app.screenshot` | 首次询问一次，会话内可记忆该目录 |
| medium | `file.write`、`browser.open` | 每次执行前确认 |
| high | `file.delete`、`app.launch`、`browser.submit` | 每次确认 + 二次显式确认，且默认禁用 |

- 默认**禁用 high**，low/medium 需用户显式开启并授予目录白名单。
- 所有执行留 `auditId`，本地与云侧双写审计（对接 dsh `approval` 审计语义）。

### 6.5 与 dsh Approval 的关系
- 云侧写操作（如 `message.send`、`file.move`）走 `ctx.approval`（0.3 节）。
- 本地 Companion 的敏感执行走**本地 Permission Gate**（6.4）。两者独立：云侧批准 ≠ 本机批准。本期 `mochi-companion` 只实现 handshake/listCapabilities/requestPermission/execute 的**桩与协议测试**，真实执行留 P1。

---

## 7. 权限模型（本地规则只管权限，绝不答用户）

### 7.1 三层权限
1. **Sandbox / 权限预设**：用 dsh `permission-presets`，Mochi 默认 `workspace-write + ask`。
2. **工具内 Approval**：所有🟡/🔴 操作（见 SKILL.md 分档）在 `execute` 内先 `ctx.approval.request({ agent, tool, reason })`，reason 写清"要做什么"；返回 `allowed-once` 才继续，否则返回 `unavailable` 事实并由 LLM 转告用户。
3. **Companion 本地 Gate**：见 Q6。

### 7.2 Local Rule Direct Return Rate < 5% 的构造性保证
- 护栏（guard / permission / approval）**只产出策略决策与审计事件**，它们运行在工具调用/参数/沙箱层，**不接触**面向用户的最终文本流。
- 工具 `render()` 只返回事实 JSON；任何自然语言回复都来自 LLM 在工具结果之后生成。
- 因此"本地规则直接返回用户话术"在设计上占比为 0；<5% 是冗余安全垫（仅当误把自然语言塞进 guard 时才可能破，代码评审禁止此类写法）。

### 7.3 需要 Approval 的工具清单（P0）
`message.send`、`file.rename`、`file.copy`、`file.move`、`pdf.merge`（涉及多源合并）、所有 `jxl.*` 的写类（本期 `jxl.*` 全为只读查询，不触发；未来写类必接）、Companion 的 medium/high 能力。
只读查询（`*.read`/`*.inspect`/`*.search`/`jxl.*`查询）**不需** Approval。

---

## 8. P0 工具 schema 骨架（关键工具全写）

> 约定：每个工具 `render` 统一 `(_a, v) => [{ type:'text', text: JSON.stringify(v) }]`；下文省略不写。所有 object 均显式 `additionalProperties:false`。

### 8.1 Presentation
```ts
// ppt.create — 由结构化大纲生成 .pptx
parameters: {
  title:      { type:'string', description:'演示文稿标题' },
  slides:     { type:'array', items: { type:'object', additionalProperties:false, properties:{
                  title:    { type:'string' },
                  bullets:  { type:'array', items:{ type:'string' } },
                  notes:    { type:'string' },
                  layout:   { type:'string', enum:['title','bullets','two-column','blank'] },
                } } },
  theme:      { type:'string', description:'主题名，留空用默认' },
  outputName: { type:'string', description:'生成文件名（不含扩展名）' },
}
output.schema: { type:'object', additionalProperties:false, properties:{
  artifactId: { type:'string' },
  path:       { type:'string' },
  slideCount: { type:'number' },
  warnings:   { type:'array', items:{ type:'string' } },
}}

// ppt.inspect — 返回可被模型判断的结构化页面模型（Q4 INSPECT 信号源）
parameters: { artifactId: { type:'string' }, slideIndex: { type:'integer', description:'留空返回全部' } }
output.schema: { type:'object', additionalProperties:false, properties:{
  fileId:     { type:'string' },
  slideCount: { type:'number' },
  slides:     { type:'array', items: { type:'object', additionalProperties:false, properties:{
    slideIndex: { type:'number' },
    title:      { type:'string' },
    bullets:    { type:'array', items:{ type:'string' } },
    textLength: { type:'number' },
    shapeCount: { type:'number' },
    notes:      { type:'string' },
    warnings:   { type:'array', items:{ type:'string' } },
  }}},
}}

// ppt.edit_slide — 修改单页（EDIT 环节）
parameters: { artifactId:{type:'string'}, slideIndex:{type:'integer', required:true},
  title:{type:'string'}, bullets:{type:'array', items:{type:'string'}}, notes:{type:'string'},
  changeNote:{type:'string', description:'本次变更摘要，写入版本链'} }
output.schema: { type:'object', additionalProperties:false, properties:{
  artifactId:{type:'string'}, version:{type:'number'}, updatedWarnings:{type:'array', items:{type:'string'}} }}

// ppt.add_slide
parameters: { artifactId:{type:'string', required:true},
  slide:{ type:'object', additionalProperties:false, properties:{
    title:{type:'string'}, bullets:{type:'array', items:{type:'string'}}, notes:{type:'string'},
    layout:{type:'string', enum:['title','bullets','two-column','blank']} } },
  atIndex:{ type:'integer', description:'插入位置，留空追加末尾' } }
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, slideCount:{type:'number'} }}

// ppt.apply_theme
parameters: { artifactId:{type:'string', required:true}, theme:{type:'string', required:true} }
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, theme:{type:'string'} }}

// ppt.export
parameters: { artifactId:{type:'string', required:true}, format:{type:'string', enum:['pptx','pdf']}, destPath:{type:'string', description:'导出目标路径，留空用 workspace'} }
output.schema: { type:'object', additionalProperties:false, properties:{ exportedPath:{type:'string'}, mimeType:{type:'string'} }}
```

### 8.2 Document
```ts
// doc.create
parameters: { title:{type:'string'}, blocks:{type:'array', items:{type:'object', additionalProperties:false, properties:{
  type:{type:'string', enum:['heading','paragraph','bullet','table']},
  text:{type:'string'}, level:{type:'integer'}, rows:{type:'array', items:{type:'array', items:{type:'string'}}} }},
  outputName:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, path:{type:'string'}, warnings:{type:'array', items:{type:'string'}} }}

// doc.read
parameters: { artifactId:{type:'string'}, path:{type:'string', description:'与 artifactId 二选一'} }
output.schema: { type:'object', additionalProperties:false, properties:{ fileId:{type:'string'}, blockCount:{type:'number'},
  blocks:{type:'array', items:{type:'object', additionalProperties:false, properties:{ type:{type:'string'}, text:{type:'string'}, level:{type:'integer'} }}} }}

// doc.edit
parameters: { artifactId:{type:'string', required:true}, ops:{type:'array', items:{type:'object', additionalProperties:false, properties:{
  op:{type:'string', enum:['replace-block','insert-block','delete-block','replace-text']},
  blockIndex:{type:'integer'}, oldText:{type:'string'}, newText:{type:'string'}, newBlock:{type:'json'} }},
  changeNote:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, version:{type:'number'} }}

// doc.export
parameters: { artifactId:{type:'string', required:true}, format:{type:'string', enum:['docx','pdf','txt']}, destPath:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ exportedPath:{type:'string'}, mimeType:{type:'string'} }}
```

### 8.3 Spreadsheet
```ts
// spreadsheet.create
parameters: { sheets:{type:'array', items:{type:'object', additionalProperties:false, properties:{
  name:{type:'string'}, columns:{type:'array', items:{type:'string'}}, rows:{type:'array', items:{type:'array', items:{type:'json'}}} }},
  outputName:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, path:{type:'string'}, sheetCount:{type:'number'} }}

// spreadsheet.read
parameters: { artifactId:{type:'string'}, sheet:{type:'string'}, range:{type:'string', description:'如 A1:D10，留空全表'} }
output.schema: { type:'object', additionalProperties:false, properties:{ fileId:{type:'string'}, sheet:{type:'string'},
  headers:{type:'array', items:{type:'string'}}, rows:{type:'array', items:{type:'array', items:{type:'json'}}} }}

// spreadsheet.write
parameters: { artifactId:{type:'string', required:true}, sheet:{type:'string', required:true},
  cells:{type:'array', items:{type:'object', additionalProperties:false, properties:{ row:{type:'integer'}, col:{type:'integer'}, value:{type:'json'} }}},
  changeNote:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, version:{type:'number'} }}

// spreadsheet.formula
parameters: { artifactId:{type:'string', required:true}, sheet:{type:'string', required:true},
  formulas:{type:'array', items:{type:'object', additionalProperties:false, properties:{ cell:{type:'string'}, formula:{type:'string'} }}} }
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, appliedCount:{type:'number'} }}

// spreadsheet.export
parameters: { artifactId:{type:'string', required:true}, format:{type:'string', enum:['xlsx','csv','pdf']}, destPath:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ exportedPath:{type:'string'}, mimeType:{type:'string'} }}
```

### 8.4 PDF
```ts
// pdf.read
parameters: { artifactId:{type:'string'}, path:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ fileId:{type:'string'}, pageCount:{type:'number'},
  pages:{type:'array', items:{type:'object', additionalProperties:false, properties:{ page:{type:'integer'}, text:{type:'string'} }}} }}

// pdf.create
parameters: { pages:{type:'array', items:{type:'object', additionalProperties:false, properties:{
  title:{type:'string'}, paragraphs:{type:'array', items:{type:'string'}}, fontSize:{type:'integer'} }},
  outputName:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, path:{type:'string'}, pageCount:{type:'number'} }}

// pdf.merge
parameters: { sources:{type:'array', items:{type:'string'}, required:true, description:'源 artifactId 或路径列表'}, outputName:{type:'string'} }
// ⚠ 涉及多源合并，execute 内先 ctx.approval.request
output.schema: { type:'object', additionalProperties:false, properties:{ artifactId:{type:'string'}, path:{type:'string'}, pageCount:{type:'number'} }}

// pdf.export
parameters: { artifactId:{type:'string', required:true}, destPath:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ exportedPath:{type:'string'} }}
```

### 8.5 File
```ts
// file.search
parameters: { pattern:{type:'string', required:true}, root:{type:'string', description:'搜索根，留空用 workspace'}, maxResults:{type:'integer'} }
output.schema: { type:'object', additionalProperties:false, properties:{ total:{type:'number'},
  matches:{type:'array', items:{type:'string'}} }}

// file.read
parameters: { path:{type:'string', required:true} }
output.schema: { type:'object', additionalProperties:false, properties:{ path:{type:'string'}, bytes:{type:'number'}, content:{type:'string'} }}

// file.create_folder
parameters: { path:{type:'string', required:true} }
output.schema: { type:'object', additionalProperties:false, properties:{ created:{type:'boolean'}, path:{type:'string'} }}

// file.rename / copy / move —— execute 内先 ctx.approval.request（高影响）
// rename
parameters: { source:{type:'string', required:true}, target:{type:'string', required:true} }
output.schema: { type:'object', additionalProperties:false, properties:{ ok:{type:'boolean'}, target:{type:'string'} }}

// copy
parameters: { source:{type:'string', required:true}, target:{type:'string', required:true} }
output.schema: { type:'object', additionalProperties:false, properties:{ ok:{type:'boolean'}, target:{type:'string'} }}

// move
parameters: { source:{type:'string', required:true}, target:{type:'string', required:true} }
output.schema: { type:'object', additionalProperties:false, properties:{ ok:{type:'boolean'}, target:{type:'string'} }}
```

### 8.6 Calendar / Task
```ts
// calendar.search
parameters: { from:{type:'string', description:'ISO8601'}, to:{type:'string'}, keyword:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ total:{type:'number'},
  events:{type:'array', items:{type:'object', additionalProperties:false, properties:{
    id:{type:'string'}, title:{type:'string'}, start:{type:'string'}, end:{type:'string'}, location:{type:'string'} }}} }}

// calendar.create
parameters: { title:{type:'string', required:true}, start:{type:'string', required:true}, end:{type:'string'}, location:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ id:{type:'string'}, created:{type:'boolean'} }}

// task.create
parameters: { title:{type:'string', required:true}, due:{type:'string'}, assignee:{type:'string'}, note:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ id:{type:'string'}, created:{type:'boolean'} }}

// task.update
parameters: { id:{type:'string', required:true}, title:{type:'string'}, status:{type:'string', enum:['todo','doing','done']}, due:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ id:{type:'string'}, updated:{type:'boolean'} }}

// reminder.create
parameters: { at:{type:'string', required:true, description:'ISO8601 触发时间'}, message:{type:'string', required:true} }
output.schema: { type:'object', additionalProperties:false, properties:{ id:{type:'string'}, scheduled:{type:'boolean'} }}
```

### 8.7 Communication
```ts
// message.draft —— 不触发 Approval
parameters: { to:{type:'string', required:true}, subject:{type:'string'}, body:{type:'string', required:true} }
output.schema: { type:'object', additionalProperties:false, properties:{ draftId:{type:'string'}, preview:{type:'string'} }}

// message.send —— execute 内先 ctx.approval.request({tool:'message.send', reason:`发给 ${to}: ${subject}`})
parameters: { draftId:{type:'string'}, to:{type:'string'}, subject:{type:'string'}, body:{type:'string'} }
output.schema: { type:'object', additionalProperties:false, properties:{ sent:{type:'boolean'}, to:{type:'string'}, channel:{type:'string'} }}
```

### 8.8 JiaXingLian（Organization Plugin，P0 全只读 + demo 数据层）
```ts
// jxl.student_query —— 升级版 mochi-campus.campus_query_student
parameters: { keyword:{type:'string', description:'地点/姓名/班级'}, status:{type:'string'}, onlyOverdue:{type:'boolean'} }
output.schema: { type:'object', additionalProperties:false, properties:{ total:{type:'number'},
  rows:{type:'array', items:{type:'object', additionalProperties:false, properties:{
    name:{type:'string'}, className:{type:'string'}, status:{type:'string'}, statusLabel:{type:'string'}, place:{type:'string'}, since:{type:'string'}, overdue:{type:'boolean'} }}} }}

// jxl.clinic_status
parameters: { onlyOverdue:{type:'boolean'} }
output.schema: { type:'object', additionalProperties:false, properties:{ inClinic:{type:'number'}, out:{type:'number'}, rows:{type:'json'} }}

// jxl.dorm_status
parameters: { building:{type:'string'}, floor:{type:'integer'} }
output.schema: { type:'object', additionalProperties:false, properties:{ total:{type:'number'}, rows:{type:'json'} }}

// jxl.campus_status
parameters: { topic:{type:'string', enum:['weather','activity','notice','traffic']} }
output.schema: { type:'object', additionalProperties:false, properties:{ topic:{type:'string'}, items:{type:'json'} }}

// jxl.message —— 校内消息（只读拉取 + 起草；发送走 message.draft/.send）
parameters: { box:{type:'string', enum:['inbox','sent','unread']} }
output.schema: { type:'object', additionalProperties:false, properties:{ total:{type:'number'}, messages:{type:'json'} }}
```

---

## 9. 落地顺序建议（26 天窗口内的执行节奏，非必须但推荐）
1. **第 1 周**：`mochi-core`（Artifact store + approval 封装 + workspace 解析）+ `mochi-ppt`（create/inspect/edit/export 跑通质量循环 demo）。这是"出彩"主线的 MVP。
2. **第 2 周**：`mochi-spreadsheet` + `mochi-doc` + `mochi-pdf`，打通 "Excel→总结→Word" 链路（Q5.4）。
3. **第 3 周**：`mochi-jiaxinglian`（升级 campus）+ `mochi-file` + `mochi-calendar-task` + `mochi-comm`（draft/send+审批）。
4. **第 4 周**：`guard`（repeat-tool-reminder/timeout-policy）接入、质量循环 skill 打磨、`mochi-companion` 协议桩与 `browser` P1 接口。
5. **收尾**：License 审计（`jszip`/`mammoth`）、演示脚本固化、未知项清零（`TO_BE_RESOLVED_BY_CODEX` 全部闭合或降级）。

---

## 10. 风险与未决项（诚实标注，不夸大可行性）

| 项 | 风险 | 处置 |
|---|---|---|
| `doc.read` Word 解析库 License（`mammoth`） | 中 | `TO_BE_RESOLVED_BY_CODEX`：`npm view mammoth license` 复核；不通过则降为明文读取+P1 |
| 像素级 Artifact 预览（需 `soffice`） | 中 | `TO_BE_RESOLVED_BY_CODEX`：目标机是否预装；P0 先用结构化概览 |
| dsh 是否已有 `ctx.workspace` 服务 | 低 | `TO_BE_RESOLVED_BY_CODEX`：建插件时确认，二选一不影响契约 |
| 跨插件 import 方式（`mochi-core` 被其他插件引用） | 低 | `TO_BE_RESOLVED_BY_CODEX`：确认 dsh 插件间依赖注入机制 |
| `jszip` 双授权合规 | 低但红线 | 显式选 MIT，纳入 License 审计待办 |
| 模型在质量循环中"改不好" | 中 | 循环上限 + `ralph` 备选（Q4.3）兜底 |
| 26 天时间 | 中 | P0 已压缩到 38 工具；P1/P2 明确降级，不摊薄 |

---

> 文档完。所有结论均锚定 dsh 实测能力与已跑通参考实现；凡无法当场核实者一律标 `TO_BE_RESOLVED_BY_CODEX`，未编造任何类名/路径/API。
