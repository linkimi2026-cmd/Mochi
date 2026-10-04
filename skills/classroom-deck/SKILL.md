---
name: classroom-deck
description: 制作或修改教师课件、答辩 PPT。先确定叙事与真实工具能力，生成后主动查看渲染图，按证据修正并复验。
whenToUse: 做课件、PPT、说课、公开课、班会、家长会、答辩演示，或反馈幻灯片不好看、看不清、需要修改时。
user-invocable: true
---

# 课件制作与视觉复核

## 先确认能力和材料

1. 读用户材料，确认受众、用途、页数或时长、教材版本、必须保留的内容；只问影响结果且仍缺失的信息。
2. 相对本技能目录，直接读取 `../../plugins/mochi-presentations/references/design-principle.md` 和 `../../plugins/mochi-presentations/references/designs/design-principle.classroom.md`；需要整套叙事时再读 `../../plugins/mochi-presentations/references/story-principle.md`。已有精确路径先读，不先遍历项目目录；读取失败再查找实际位置，不猜内容。
3. 看真实工具目录。`mochi_ppt_create` 接收 `{title, theme?, slides, teachingPlan?, outputDirectory}`；逐页是 `{heading, bullets, source?, layout?, table? | chart? | process? | comparison?}`。课堂课件可选声明 `teachingPlan: {objectives:[{id, statement}], slideMappings:[{slideId, objectiveIds, role, studentAction?, understandingCheck?}]}`；从老师在聊天中的自然语言目标和课堂任务归纳即可，不另设业务表单，也不要把问题清单强加给一般演示文稿。每个目标关联教学页并至少有一项理解检查，计划至少声明一项学生行动；已映射页面要写角色。封面、章节等非教学页可不映射。每页使用 create 生成的稳定编号 `slide-1`、`slide-2` 等；角色只描述该页作用，不限定教学顺序。`source` 是真实资料声明 `{label, reference?}`，没有就省略，不能用标题、聊天 ID 或猜测页码代替。支持9套主题及10类版式：title-body、title-table、title-chart、title-process、title-compare、cover、section、statement、kpi、closing，不能通过额外字段控制字体、图片、自由坐标、动画。
4. 用户有样稿时先分析样稿的层次、留白、图文比例和叙事；图像参考需真实查看。没有样稿时读下方案例。参考原则可以复用，未经授权的图片、数据和整页内容不能直接复制。

## 生成与检查

1. **简短计划**：每页写清“希望读者明白什么 / 用什么证据 / 用哪种可实现的版式”。课堂请求中有明确目标时，整理少量可观察目标，为承担教学任务的页面说明作用；至少设计一项学生行动，并为每个目标安排一次理解检查。封面、章节等非教学页可不映射，不为填报告虚构学生动作。目标或关键活动确实不清楚再在聊天里确认。答辩按问题、方案、证据、结论推进；短演示不强加目录或章节页。
2. **内容**：一页一个中心；标题表达结论、知识点或学习问题。结论应有可追溯资料，缺少时逐页标“未核验”，不能捏造来源；即使填写了 `source`，它仍只是用户或模型的声明，须实际打开资料核对内容后才能对老师说已核验。提问页不要提前揭晓答案。正文通常 3–5 条短句，不设置最低字数和填充率；完整解释另做讲义。工具拒绝超量时删冗余、拆页，不缩字硬塞；固定页数不够要说明取舍。
3. **生成**：主题选一套贯穿全册，文史 ink/archive、自然 field、理科 lab、信息 swiss，其余按真实主题目录选择。按内容使用 cover/section/statement/kpi/closing，不强制凑齐；节奏页 bullets 是短副题，可为空；排版后正文总行数上限：cover/statement/closing 3行、section 2行、kpi 4行，长句换行也计入，不等于要点条数。超过时精简或换title-body，kpi只能突出有依据的数字。过程、顺序、循环关系优先用title-process配process；只有逐项对应的两列事实/特征才用title-compare，填 `comparison: {leftTitle, rightTitle, rows:[{left,right}, ...]}`（2–4组，每格最多两行）；较多属性或需要超过四组时使用title-table。每页只为实际掌握的资料填写 `source: {label, reference?}`；未查到教材页码就省略 reference，连资料名都没有就省略 source。使用真实 `mochi_ppt_create`，保存返回的 PPTX 路径和 `sourcePath`。输出目录必须全新。纯文字内容不为了换版式捏造数据表。
4. **结构检查与教师回看**：读工具返回的 `教学覆盖`、`质量状态`、`结构检查` 与 `质量提示`。`教学覆盖.status` 为 `not-declared` 表示没有教学计划声明，`incomplete` 表示有目标未关联页面或理解检查、没有学生行动、已映射页缺角色，或修订后待复核，`mapped` 表示每个目标有页面和理解检查、至少有一项学生行动且已映射页有角色。未映射页面会列为信息提示，封面/章节页无需因此补造教学目标；这不判断教学法、学科事实或课堂效果。一般演示可不声明。再调用 `ppt_inspect` 核对页数、关键文字、表格/图表、演讲者备注与“未核验”来源状态；已声明的逐页目标、角色、学生行动和理解检查应在对应页备注中，内容修订后沿用的旧映射必须显示“教学映射待复核”。连续三页都用 `title-body` 的提醒需结合教学内容调整版式，不能为消除提示硬塞空页或假数据。`manifest.quality.pptxSha256` 应等于本版 `manifest.files.pptx.sha256`；字号口径是文本形状的最大 run，不能证明每个 run 都可读。来源声明的真假须另查原资料。若工具返回 `产物.previewPdf`，可把它作为教师可打开的 PPTX 渲染预览；`manifest.preview.previewOfPptxSha256` 应等于本版 `manifest.files.pptx.sha256`。若返回 null，按 `预览说明` 告知无法原样预览。manifest 的 `sourceKind: "model-authored-classroom-draft"` 只说明课件结构由模型生成，不代表内容或来源已核验。生成成功只代表文件已生成。
5. **主动视觉检查**：调用 `mochi_ppt_render({filePath: 最新PPTX路径, mode: "overview"})`，记录返回的文件SHA256和覆盖页，状态“待模型查看”不是验收通过。实际查看返回的图像附件。逐页检查整体层级与节奏；宫格截断时补看未覆盖页。对密集页、图表页、疑似缺陷页调用 `mode: "page", page: 页码` 看细节，不能凭宫格宣布小字可读。
6. **按证据修正**：记录“页码 / 看到的问题 / 影响 / 修改 / 复验结果”。例如“第3页图例遮住数值 → 无法比较 → 缩短标签 → 重渲第3页后标签完整”。用 `mochi_ppt_revise` 的 `previousSourcePath`、`page`、`instruction` 和实际 `newTitle/newBody/newLayout/newTable/newChart/newProcess/newComparison` 定页改；来源改用 `newSource`，删除来源用 `clearSource: true`。若改动课堂页的可见内容，旧教学映射会标记为待复核；确认后用 `newTeachingPlan` 更新整份目标/映射声明，否则交付时说明该页覆盖状态仍待复核。仅写 instruction 不会改内容。连续修订用上一步返回的最新 sourcePath，避免后一次覆盖前一次修正。
7. **复验与停止**：修改后用最新 PPTX 路径重渲修改页；全局变动再看 overview。首次通过无需修改，每个问题最多两轮修正；同因失败不重复撞。已无影响使用的缺陷就交付，不为流程捏造问题。仍有事实错误或不可读内容，交待待修页并标为草稿。

## 看不到图或改不了版式时

- 渲染工具返回的 image attachment 就是视觉输入。确有图像时直接审；仅有路径不等于已看到图片。其他图片仅在当前目录存在 `read_image` 时读取。
- 工具不存在、模型/附件服务不接受图像或 LibreOffice 缺失：明确“视觉未核验”及原因，不声称检查通过、不反复调同一失败工具。已有真文件可以交付为待视觉确认稿。
- 想调整图片、字号、自定义配色或自由布局，但当前生成器没有参数：不要反复改 bullets 假装解决。说明限制；只有已确认可用且已授权的其他制作能力才可接手。提示词无法扩展工具 schema。
- 生成器附带的 `presentation.pdf` 是单独排版的讲义，不是 PPT 渲染证据。`presentation-preview.pdf` 只有在 LibreOffice 从本版最终 PPTX 转换成功时才存在，可供教师在 PDF 查看器回看；其存在也不等于模型已经实际看图。PPT渲染失败时，不得把讲义转图当PPT检查；只有从实际PPTX经演示软件转换的图像才可复核PPT。无法取得时交付“视觉未检”的PPT，不为了完成检查自行写图像解码器或做无关像素分析。LibreOffice回看也不等于目标机PowerPoint/WPS实机验收。

## 小案例（自编方法示例，不代表工具新增能力）

| 请求或缺陷 | 不合格做法 | 可执行选择 |
| --- | --- | --- |
| 4分钟、5页答辩 | 先塞目录和3张过渡页；每页180字 | 5页分别承担问题、做法、证据、价值、下一步；已有数据再选图表 |
| 课堂提问“哪些条件会影响摩擦力？” | 标题直接泄露答案；硬添大数字 | 保留问题标题与必要条件，留讨论空间；不能用假数字制造焦点 |
| 给定比例50% | 改成47.2%以显得真实 | 原值不变，说明分母、口径与来源；无来源就标待核验 |
| 第3页标签拥挤 | 回答“已优化”，未看图 | 渲染第3页、缩短标签、定页修订、看最新页；其他页保留 |
| 学校要求同一蓝色模板 | 为“反AI味”改成墨绿 | 遵守模板；用内容层次和证据改善表达 |

## 交付

返回真实 PPTX、页数、sourcePath；有 `previewPdf` 时一并提供教师可打开的预览路径，没有则说明预览不可用。用一句话说明检查范围、实际修正和仍影响使用的限制。没有缺陷就不写虚构的修正报告。
公式、教材页码和数据必须可考，示例标注“示例”；不公开学生隐私。不要用 HTML 或整页截图冒充可编辑 PPTX。

## 版式选择案例

- 自然科学5页短课：`theme: "field"`，依次 cover（问题）、title-body（概念）、title-chart（有来源的数据）、statement（关键关系）、closing（迁移问题）。无数据则换为内容页。
- 字太多：删重复、拆知识点，标题和来源保留；不能将6条长句直接塞入statement。
- 定页换布局：`newLayout: "statement"` 配短标题/短正文；`newBody: []` 可清除节奏页副题。内容页不能清空正文，表格/图表页必须有对应数据。


## 步骤与循环图（原生可编辑）

`layout: "title-process"` 配 `process: {steps: [{label, detail}, ...], loopLabel?}`：3–4步，label≤10字、detail≤32字；bullets可为空或最多1条40字说明。每步只表达一个动作/状态，箭头表示真实先后关系；只在末步确实回到首步时填loopLabel。无需人为编号，不编数据。

- 水循环的一条常见路径：蒸发（水吸热成为水蒸气）→凝结（水蒸气遇冷形成小水滴）→降水（云中水滴长大落回地面），返回说明“地面的水可以再次蒸发”。标为简化路径，不暗示所有水都必须依次经历三态，不把“循环”另列成第四种物态。
- 操作实验：准备→操作→观察→记录，普通流程省略loopLabel。安全条件写清楚，观察提示与答案分开。
- 缺陷修复先判断原因：字号偏小不能靠增加表格行列解决；流程难理解可用newProcess改成原生步骤图，配newBody精简重复说明。新布局生成后重渲，确认箭头方向、顺序和文字可读；不要把装饰增多当质量提升。
