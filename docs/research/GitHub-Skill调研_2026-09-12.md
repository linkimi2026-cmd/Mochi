# Mochi 适用 Skill 筛选（2026-09-12）

> 本文回答一个问题：**GitHub 上哪些外部 skill 真的适合 Mochi**。
> 结论先行：**PPT 类 9 个候选里只有 1 个补真缺口；腾讯系 8 个候选里只有 2 个契合。**
> 全部判断基于本仓实际代码与文档取证；**未安装、未运行任何候选 skill**。

---

## 0. 筛选依据

不用通用偏好（star 数、下载量）判断，只用 Mochi 自身的既定约束。

| # | 约束 | 出处（已实读） |
|---|---|---|
| 1 | 原生可编辑优先，禁止用截图或 HTML 冒充课件 | `plugins/mochi-presentations/README.md` |
| 2 | 本地优先、可离线运行 | `mochi-modeling`（JSXGraph 离线零依赖）、`mochi-lan` |
| 3 | 外网检索前必须剥离学生个人数据 | `skills/teaching-material-find/SKILL.md` |
| 4 | 检索不携带站点 Cookie / Authorization / token | `plugins/mochi-web-search/README.md` |
| 5 | 复用需固定 commit + 协议证据 + 维护证据 | `docs/reuse-audit.md` |
| 6 | 不重复造轮子 | 打包白名单已有 presentations / documents / modeling / web-search / knowledge / grades / memory |

**补充部署约束**：目标机是 **Win10 教室一体机**，约 10GB 内存、无还原卡（`docs/classroom-preflight.md`，该文档自述**尚未现场实测**）。

**已有 PPT 能力盘点**（`mochi-presentations`，已在打包白名单内）：

- 注册 `mochi_ppt_create` / `mochi_ppt_revise` / `ppt_inspect`
- 原生可编辑：文本是文本对象、表格走 `a:tbl`、图表走原生 Office chart OOXML + 内嵌可编辑工作表
- **写前**确定性版式预算校验（不依赖 PptxGenJS 动态 `fit`）
- 定页修订，未修改页 XML 字节级保留
- 已有复用决定（2026-09-08）：采用 PptxGenJS v4.0.1；参考 `siril9/presentation-skill`；否决 Presenton、pptx-gen

**结论：Mochi 的 PPT 底座已经相当完整，外部 skill 的价值不在"再做一个生成器"。**

---

## 1. PPT 类：9 个候选，只有 1 个补真缺口

| 候选 | Star | 判断 | 理由 |
|---|---:|---|---|
| `CxyZyr/PPTX-Template-Skills` | 29 | ⭐ **唯一真缺口** | 见 1.1 |
| `sunchaokun/PPT-Design-Skill` | 1,216 | ⚠️ 只取方法论 | 见 1.2 |
| `EveryInc/hands-on-deck` | 213 | ⚠️ 能力重叠 | `ppt_inspect` + `mochi_ppt_revise` 已覆盖；仅"原子 JSON patch + diff"交互模型可参考 |
| `ningzimu/codex-ppt-skill` | 5,804 | ❌ 排除 | 图片式，违反约束 1；且需自备外部生图 API（成本 + 数据出境） |
| `JuneYaooo/gpt-image2-ppt-skills` | 1,270 | ❌ 排除 | 同上 |
| `sunbigfly/ppt-agent-skills` | 893 | ❌ 排除 | HTML 渲染管线；Mochi 走 OOXML 直写 |
| `Hasasasa/html-to-editable-pptx` | 65 | ❌ 排除 | HTML 中转路线，同上 |
| `zouchenzhen/thesis-defense-pptx-skill` | 260 | ❌ 排除 | 学术答辩场景，非教师日常场景 |
| `Gabberflast/academic-pptx-skill` | 869 | ❌ 排除 | 同上 |
| `likaku/Mck-ppt-design-skill` | 274 | ❌ 排除 | 咨询版式体系，与班会/周报场景不匹配；且同样是 Python 栈 |
| `tfriedel/claude-office-skills` | 825 | ❌ 排除 | 作者自述已被 `anthropics/skills` 取代，停更于 2026-04-01 |

### 1.1 唯一真缺口：模板能力

**取证**：`plugins/mochi-presentations` 自有源码中 `template` 命中 **0 次**（仅 `node_modules/` 内有命中，属依赖自带）。
→ `mochi_ppt_create` 是**固定版式**，吃不下学校统一模板、学科模板、教研组模板。

**为什么 `PPTX-Template-Skills` 对得上**：

```
它：   template.pptx ──解析──> spec.json 语义契约 ──按槽位填充──> deck.pptx
Mochi：          （缺）          source.json 契约        mochi_ppt_revise
```

它的做法是"先解析成可移植契约、再按 `fill_plan` 槽位填充"，与 Mochi 已有的 `source.json` 机制**同构**；且明确保留模板的几何、对齐、主题色、段落/run 结构——正是约束 1 要求的原生可编辑。
Mochi 侧还有 `jxl-brand` 品牌插件（已在打包白名单内），模板能力有天然落点。

**结论**：**作为设计参考，在 `mochi-presentations` 内重写。** 它是 Python 实现，不能直接装，也不应为此引入 Python 运行时。

### 1.2 只取方法论：视觉验收环

Mochi 现在有"版式预算"——标题 ≤2 行、普通正文页 ≤14 估算行、表格/图表页 ≤3 行——但这是**防溢出的硬约束，不是审美验收**。技术上生成成功 ≠ 看起来专业。

`PPT-Design-Skill` 补的正是这一环：需求确认 → 结构设计 → 视觉方向锁定 → design token 锚定 → 导出 PNG → 第一门（整体视觉完成度）+ 第二门（严重缺陷与可编辑性）→ 返工。
它的核心主张"技术上运行成功不等于设计完成"，值得直接写进 `skills/class-meeting-prep` 的工作法。

**结论**：**只搬流程，不搬 Python 栈**（它依赖 PyPI 包 `pptx-designer`）。

### 1.3 明确排除图片式路线的原因

`codex-ppt-skill`（5,804★）与 `gpt-image2-ppt-skills`（1,270★）本身质量不低，但三条硬冲突：

1. **违反约束 1**。`mochi-presentations/README.md` 明写它 "never substitutes a page screenshot or HTML page for a PowerPoint file"；`class-meeting-prep` skill 也写明"不要用 HTML 或图片冒充课件"。
2. **违反约束 2/3**。需外部生图 API，课件内容会离开本机。
3. **成本**。每页一次生图调用，教室批量场景不经济。

---

## 2. 腾讯系：8 个候选，只有 2 个契合

### 2.1 ⭐⭐ `Tencent/BrowserSkill`（1,946★ · MIT · push 2026-09-12）— 补"已登录外网"缺口

**缺口证据链**：
- `mochi-web-search/README.md` 明确写：**不附带站点 Cookie、Authorization 或 token**
- `teaching-material-find` 的资料边界只到"本地工作区 + 本机教材库 + 已核验的资料来源"
- 教师真实取材料场景（学科网 / 菁优网 / 组卷网 / 国家智慧教育平台 / 学校门户）**几乎都需要登录态**

**契合点**：复用真实登录态 + 独立 Agent Window 不打断老师操作 + 遇验证码/登录请人接管后继续——最后这条与 Mochi 的"原生人工确认卡"哲学一致（见 `skills/student-movement-request`）。
它走 `bsk` CLI，不绑定 agent 框架，README 明列支持 WorkBuddy。

**两个必须先解决的问题**：
1. **隐私门禁叠加**。约束 3 要求外网检索剥离学生个人数据，而"真实登录态浏览器"天然携带身份。**必须先定规则**，否则学生数据会顺浏览器外泄。
2. **教室机可用性未验证**。它支持 Windows x64，但目标机是 10GB 内存、无还原卡的教室一体机，浏览器要求 Chrome/Edge——**现场未实测**。

### 2.2 ⭐ `Tencent/AI-Infra-Guard`（6,238★ · Apache-2.0 · push 2026-09-11）— 补"自动化安全扫描"缺口

Mochi 有 `docs/reuse-audit.md` 这套严格的人工复用审查流程，但 `skills/` 与 `plugins/` 目录**没有自动化的提示词投毒 / 供应链扫描**。它的 Skills Scan 正好补上第二道。

**结论**：作为**工程流程工具**接入，不进产品包、不进打包白名单。

### 2.3 其余腾讯候选

| 候选 | Star | 判断 | 理由 |
|---|---:|---|---|
| `Tencent/SkillHone` | 149 | ⚠️ 只取方法论 | "靠持久化决策历史让 skill 自改进"值得参考（Mochi 有 skill 体系但无自改进闭环）；但它依赖 LiteLLM 统一网关，与 Mochi 的 `runtime-profile.json` 模型配置机制冲突 |
| `TencentCloudBase/skills` + `CloudBase-AI-Toolkit` | 75 / 1,103 | ❌ 排除 | 腾讯云托管后端，与 Mochi「本地优先 + mochi-lan 局域网」架构冲突 |
| `TencentCloud/TencentDB-Agent-Memory` | 26,374 | ❌ 排除 | Mochi 已有 `mochi-memory`，整套替换不必要 |
| `Tencent-RTC/agent-skills` | 13 | ❌ 排除 | 实时音视频，超出当前教师场景 |
| `Tencent/skillhub` | 26 | ❌ 排除 | skill 分发源；Mochi 是终端产品不是技能市场（除非要做"技能广场"） |
| `TencentEdgeOne/awesome-website-prompts-and-skills` | 171 | ❌ 排除 | 建站场景，与 Mochi 无关 |
| `TencentCloudBase/awesome-miniprogram-skills` | 37 | ❌ 排除 | 微信小程序场景，与桌面端教师工具无关 |
| 社区版 `tencent-docs` skill | — | ❌ 排除 | 与本环境已内置的腾讯文档系（在线文档 / Word / PPT / 表格）功能重叠 |

---

## 3. 落地顺序建议

| 优先级 | 动作 | 产品风险 | 前置条件 |
|---|---|---|---|
| 1 | 接入 `AI-Infra-Guard` 扫描 `skills/` 与 `plugins/` | 无（纯工程） | 无 |
| 2 | 评估 `BrowserSkill` | 中 | 先定"登录态 + 隐私门禁"叠加规则；现场验证教室机浏览器 |
| 3 | `mochi-presentations` 补模板能力 | 低（内部重写） | 拿到一份真实校方模板样本 |
| 4 | 班会/周报 skill 层加视觉验收环 | 无（纯文档） | 无 |

---

## 4. 本文未做的事（不得当作已完成）

- **未安装、未运行**任何候选 skill；全部结论来自 README、仓库元数据与本仓源码取证
- **未逐份细读**候选的 `SKILL.md` 正文，**未做安全审计**（若决定安装，须先过安全审计流程）
- `BrowserSkill` 在 Win10 教室一体机上的实际可用性**未验证**
- 教室机硬件事实仍来自用户口头说明，`docs/classroom-preflight.md` 自述尚未现场实测
- `PPTX-Template-Skills` 的 `spec.json` 契约结构未与本仓 `source.json` 逐字段比对

---

## 附录 A：本次实测数据（GitHub API，2026-09-12）

| 仓库 | Star | 最后 push | 协议 |
|---|---:|---|---|
| `anthropics/skills` | 175,882 | 2026-09-10 | source-available（**非开源**，pptx/docx/xlsx/pdf 不可再分发） |
| `TencentCloud/TencentDB-Agent-Memory` | 26,374 | 2026-09-11 | NOASSERTION |
| `Tencent/AI-Infra-Guard` | 6,238 | 2026-09-11 | Apache-2.0 |
| `ningzimu/codex-ppt-skill` | 5,804 | 2026-09-12 | MIT |
| `Tencent/BrowserSkill` | 1,946 | 2026-09-12 | MIT |
| `JuneYaooo/gpt-image2-ppt-skills` | 1,270 | 2026-08-22 | Apache-2.0 |
| `sunchaokun/PPT-Design-Skill` | 1,216 | 2026-09-06 | MIT |
| `TencentCloudBase/CloudBase-AI-Toolkit` | 1,103 | 2026-09-11 | MIT |
| `sunbigfly/ppt-agent-skills` | 893 | 2026-06-08 | NOASSERTION |
| `Gabberflast/academic-pptx-skill` | 869 | 2026-07-14 | MIT |
| `tfriedel/claude-office-skills` | 825 | 2026-04-01 | NONE |
| `likaku/Mck-ppt-design-skill` | 274 | 2026-05-10 | Apache-2.0 |
| `zouchenzhen/thesis-defense-pptx-skill` | 260 | 2026-06-05 | Apache-2.0 |
| `EveryInc/hands-on-deck` | 213 | 2026-08-04 | MIT |
| `TencentEdgeOne/awesome-website-prompts-and-skills` | 171 | 2026-06-04 | MIT |
| `Tencent/SkillHone` | 149 | 2026-08-09 | NOASSERTION |
| `TencentCloudBase/skills` | 75 | 2026-09-11 | NONE |
| `Hasasasa/html-to-editable-pptx` | 65 | 2026-07-07 | MIT |
| `TencentCloudBase/awesome-miniprogram-skills` | 37 | — | — |
| `CxyZyr/PPTX-Template-Skills` | 29 | 2026-06-12 | MIT |
| `Tencent/skillhub` | 26 | 2026-08-28 | NONE |
| `Tencent-RTC/agent-skills` | 13 | 2026-09-09 | — |

## 附录 B：协议提醒

- MIT / Apache-2.0 可放心复用（仍须按约束 5 走复用审查流程）
- `anthropics/skills` 中的 `pptx` / `docx` / `xlsx` / `pdf` 是 **source-available，不是开源**——可读可学，**不可当开源件再分发或商用**
- `TencentCloudBase/skills`、`Tencent/skillhub` 的仓库协议为 NONE，复用前需单独确认
