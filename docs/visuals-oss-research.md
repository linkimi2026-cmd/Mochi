# Mochi 视觉/绘图能力 · 开源方案调研

> 调研时间：2026-09-12
> 调研人：Mochi 视觉能力实现方
> 调研范围：图片编辑 / 自动绘图（图表与示意图）/ PPT 与教学材料版式 / 教材配图匹配 四类
>
> **本文严格区分三类信息，请勿混读：**
> - `【事实·API】` 通过 GitHub REST API 在 2026-09-12 实测查得（star 数、许可证、最近推送时间、归档状态）。
> - `【事实·本机】` 在本机（macOS arm64 / Node 22.22.2）实际跑出来的结果，附可复现命令。
> - `【推测】` 基于常识/文档的判断，**本次未实测验证**，落地前必须自己验一遍。

---

## 0. 判定门槛（先立规矩再选型）

Mochi 是**免登录、可离线的桌面教学 Agent**（Electron + DSH 内核），老师常常在断网的教室网络里用它。因此本次调研用一条硬门槛先把候选砍掉一半：

| # | 门槛 | 说明 |
|---|---|---|
| G1 | **必须能离线跑在 Electron 里** | 任何需要云端 API Key、需要联网推理的「AI 生图/生图模板」方案，**直接淘汰**，不进入对比表。 |
| G2 | **不能引入无法打包的系统依赖** | 需要现场 `apt install` / 需要 Cairo、Pango、Chromium、LibreOffice 运行时的方案，视为不可用。 |
| G3 | **优先零新增运行时依赖** | Mochi 桌面端已有一份「依赖闭包白名单」，只能用它里面已有的包；新增依赖要走打包/白名单/体积评审，成本很高。 |
| G4 | **输出要能被老师二次利用** | 矢量（SVG）优于位图：PPT 里能继续放大、改色、改字。 |

**G4 直接决定了图表类的技术路线**：把柱状图画成位图 PNG 交出去，老师在 PPT 里就没法调整，等于交付了一个死文件。因此最终选定「**SVG 是唯一几何数据源，PNG 由同一份 SVG 光栅化**」。

### 桌面端已有依赖闭包（【事实·本机】读 `apps/desktop/node_modules/*/package.json`）

| 包 | 版本 | 许可证 |
|---|---|---|
| `@napi-rs/canvas` | 1.0.8 | MIT |
| `pdfjs-dist` | 6.3.289 | Apache-2.0 |
| `jszip` | 3.10.1 | MIT OR GPL-3.0-or-later（双许可） |
| `pdf-lib` | 1.17.1 | MIT |
| `pptxgenjs` | 4.0.1 | MIT |
| `docx` | 9.7.1 | MIT |
| `exceljs` | 4.4.0 | MIT |
| `@mochi/pdf-layout` | 0.1.0 | 仓库内私有包，package.json 无 license 字段 |

`@napi-rs/canvas` 的平台二进制是**独立平台包**（【事实·本机】`@napi-rs/canvas-darwin-arm64/package.json`：`os:["darwin"] cpu:["arm64"]`，内含 `skia.darwin-arm64.node` 27,107,936 字节）。也就是说：它**不需要系统装 Cairo/Skia，但需要按平台分发对应的平台包**（darwin-arm64 / win32-x64 / linux-x64-gnu…各约 27MB）。打包清单里必须带上下面对应平台的包。

---

## 1. 结论速览

| 类别 | 最终选择 | 一句话理由 |
|---|---|---|
| a) 图片编辑 | **`@napi-rs/canvas`（已在闭包内）** | 真解码、真改像素、真编码，预编译 Skia 二进制，离线零系统依赖。 |
| b) 图表/示意图 | **自研纯 SVG 生成器（零依赖）** | 唯一同时满足 G1/G3/G4 的路线；Vega/Mermaid 都进不了闭包，Chart.js 出不了矢量。 |
| c) PPT 版式 | **沿用闭包内 `pptxgenjs`；版式规则参考 Anthropic skills 的 SKILL.md 结构（只借鉴思路，不搬运代码）** | Anthropic 的 pptx skill 是 **source-available 非开源**，不能 vendor。 |
| d) 教材配图 | **本机教材索引（`mochi-knowledge`）优先；Wikimedia Commons / Openverse 仅作为「未执行的文字建议」** | 教材原图必须可溯源，开放图库≠教材原图，绝不能混用。 |

---

## 2. 类别 a：图片编辑

`【事实·API】2026-09-12 查得`：

| 仓库 | Star | 许可证 | 最近推送 | 归档 | 能否离线 | 能否零依赖复用 |
|---|---|---|---|---|---|---|
| [jimp-dev/jimp](https://github.com/jimp-dev/jimp) | 14,664 | MIT | 2026-04-07 | 否 | 能 | **不能**（新增依赖） |
| [lovell/sharp](https://github.com/lovell/sharp) | 32,656 | Apache-2.0 | 2026-09-07 | 否 | 能（预编译 libvips） | **不能**（新增依赖 + 平台包体积大） |
| [Brooooooklyn/canvas](https://github.com/Brooooooklyn/canvas)（`@napi-rs/canvas`） | 2,319 | MIT | 2026-09-09 | 否 | 能 | **能，已在闭包内** |
| [Automattic/node-canvas](https://github.com/Automattic/node-canvas) | 10,691 | MIT（读 `package.json`；**仓库根目录没有 LICENSE 文件**） | 2026-08-24 | 否 | 需要系统 Cairo/Pango | 不能 |
| [thx/resvg-js](https://github.com/thx/resvg-js) | 1,984 | MPL-2.0 | 2026-06-30 | 否 | 能（Rust 预编译） | 不能（新增依赖；且 MPL-2.0 需逐文件注意） |

**判断依据**

- **ImageMagick / GraphicsMagick / `gm`**：需要外部可执行文件，违反 G2，淘汰，不列入表中。
- **ImageMagick wasm**：`【推测】` 体积大、启动慢、无官方长期维护的 Node 发行版，且 wasm 版对 CJK 字体与 JPEG 质量的支持不明确；不符合 G3，淘汰。
- **libvips（sharp 底层）**：性能最好，但 sharp 是**新增依赖**，且它自带 libvips 二进制（数 MB～数十 MB），打包与 whitelist 成本高于收益。**Mochi 的图片编辑需求只是「裁剪/缩放/旋转/圆角/水印/调色/转格式」这种单张、低频、几十万像素级的操作，用不着 libvips 的吞吐。**
- **`@napi-rs/canvas`【事实·本机】**：本机实测 `typeof createCanvas === 'function' && typeof loadImage === 'function'`，可 `loadImage` 直接吃 SVG buffer、支持 `roundRect` / `clip` / `measureText` / `filter`。**已经是桌面端运行时闭包的一部分**，零新增依赖。

**已实现（`plugins/mochi-visuals/image-ops.mjs`）**：crop（含按比例锚点裁剪）、resize（contain / cover / stretch / maxLongEdge）、rotate（90/180/270 精确重绘，其他角度按包围盒）、rounded（半径自动收敛到短边一半）、watermark（九宫格、透明度、描边、倾斜）、adjust（亮度/对比度/饱和度逐像素计算）、PNG/JPEG 编码（JPEG 质量 1–100）。

---

## 3. 类别 b：自动绘制图表与示意图

`【事实·API】2026-09-12 查得`：

| 仓库 | Star | 许可证 | 最近推送 | 归档 | 输出 | 能否离线 | 能否零依赖复用 |
|---|---|---|---|---|---|---|---|
| [d3/d3](https://github.com/d3/d3) | 113,716 | ISC | 2026-05-28 | 否 | 算路径/比例尺，不画图 | 能 | 需新增依赖（可选拆包） |
| [chartjs/Chart.js](https://github.com/chartjs/Chart.js) | 67,692 | MIT | 2026-09-11 | 否 | **Canvas 位图** | 能（需 canvas 实现） | 不能 |
| [vega/vega-lite](https://github.com/vega/vega-lite) | 5,480 | BSD-3-Clause | 2026-09-10 | 否 | 规格 DSL | 能 | 不能 |
| [vega/vega](https://github.com/vega/vega) | 11,985 | BSD-3-Clause | 2026-09-11 | 否 | Canvas / SVG | 能 | 不能 |
| [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid) | 90,210 | MIT | 2026-09-11 | 否 | SVG（需 DOM） | 勉强（要 jsdom） | 不能 |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | 131,639 | MIT | 2026-09-11 | 否 | 交互式 React 编辑器 | 能 | **不能当库用** |
| [rough-stuff/rough](https://github.com/rough-stuff/rough) | 21,166 | MIT | **2024-07-28** | 否 | SVG / Canvas 手绘风 | 能 | 不能（新增依赖） |
| [jsdom/jsdom](https://github.com/jsdom/jsdom) | 21,678 | MIT | 2026-09-12 | 否 | 纯 JS DOM 实现 | 能 | 不能 |

**逐个判断**

- **Chart.js**：生态最熟，但**输出是 Canvas 位图**。它有一个被广泛使用的做法是「用 Chart.js 画到 canvas 再导出 PNG」——这恰好是用户明确禁止的「用 Canvas 画柱状图糊弄」。而且它本身还要再引一个 canvas 实现才能在主进程跑。淘汰。
- **Vega / Vega-Lite**：声明式 DSL 非常适合 LLM 生成（LLM 写 JSON 比写绘图代码稳），也有 `toSVG()`。但 `【推测】` 其在 Node 里做无头渲染仍需要 DOM 或 canvas 环境（vega 的 View 依赖 DOM 宿主），且是**两个新增依赖**（vega-lite + vega 体量都不小）。`【推测】` 如果编译成 Vega 规范再走自研 SVG 生成器，理论上可行，但等于「用 vega-lite 做编译器 + 自己写渲染器」，复杂度远高于直接自研。淘汰。
- **D3**：数学与比例尺质量极高，`d3-scale` + `d3-array` 确实是「nice 刻度」的教科书实现。但把 d3 的散装模块引入闭包仍需打包评审；而**刻度算法本身只有几十行**（`10^floor(log10(x))` × {1,2,2.5,5,10}，见 `diagram.mjs` 的 `niceStep`）。为了几十行算法引一个依赖不值得。淘汰，但**算法思路参考了 d3 的 nice-number 规则**（这是公开的经典算法，不涉及代码复制）。
- **Mermaid**：流程图/时序图 DSL 很好，但**渲染强依赖 DOM**，Node 侧事实标准是 `mermaid-cli` → **Puppeteer + Chromium**，违反 G2（不可能为了画流程图往 Electron 里塞第二个 Chromium）。淘汰。
- **Excalidraw**：是一个完整的 React 应用/编辑器，不是「给定数据出图」的库。老师要手绘才用它，而我们要的是自动出图。淘汰。
- **rough.js**：可爱的手绘风，但 `【事实·API】` 最近推送停在 **2024-07-28**（约 2 年未更新），且仍需新增依赖。淘汰。
- **node-canvas**：需要系统 Cairo/Pango，Windows 上安装体验是出名的痛点，违反 G2。淘汰。

**最终路线（自研纯 SVG 生成器）**

`【事实·本机】` `plugins/mochi-visuals/diagram.mjs` 是零依赖的纯字符串 SVG 生成器，已实现并实测通过视觉验收：

- 图表类型 5 种：`bar` / `line` / `pie` / `flowchart` / `relationship`
- 直角坐标系：真实坐标轴、`nice-number` 刻度标签（带单位）、水平网格线、数据标签、多序列图例
- 饼图：扇区 `<path>`、百分比标签、引导线、右侧图例
- 流程图：自动分层（BFS 最长路径）、**先 DFS 找回边再分层**（保证环上节点各归其层，而不是被全部压到同一层）、箭头 marker、边标签、`rect`/`round`/`decision`/`start`/`end` 形状、自环画成右侧回路
- 关系图：放射布局、中心节点自动选取、分组着色、边标签避让（避节点 + 避其他标签 + 沿曲线滑动）
- 配色：Mochi 教学色（正文 `#2c2c2c`、主色 `#3F5B99`，调色板 `#3F5B99 #C0705A #6D8F6B #B08A4F #7A6FA0 #4E8CA8`）
- **PNG 由同一份 SVG 光栅化**（`raster.mjs`：只放大 `width/height`，`viewBox` 不变），矢量与位图版式严格一致

### 3.1 中文字体：这一块是本次调研最贵的坑（【事实·本机】）

`@napi-rs/canvas` 内部有**两个不同的渲染引擎**，字体规则完全不同，必须分别验证：

| 引擎 | 用途 | 认什么字族写法 |
|---|---|---|
| Skia（`fillText`） | 水印文字 | 认系统字体名，但泛型 `sans-serif` / `-apple-system` 在本机对简体汉字**画成方框**；`Hiragino Sans GB` / `Heiti TC` / `Songti SC` 有真字形 |
| resvg（`loadImage(svgBuffer)`） | SVG → PNG 光栅化 | **只认不带引号、不含逗号的单一字族名**；逗号链、带引号字族名、`GlobalFonts.setAlias`、`loadSystemFonts()` 全部退化成方框 |

唯一有效写法：

```js
GlobalFonts.registerFromPath('/System/Library/Fonts/Hiragino Sans GB.ttc', 'MochiCJK');
// 然后 SVG 里写 font-family="MochiCJK"（不带引号、不含逗号）
```

两个附带发现：
- `GlobalFonts.has('PingFang SC')` 在本机返回 `false`（惰性加载陷阱），**所以字体检测不能查 `has()`，必须真的渲染一次比对**。
- 检测方法：先渲染私用区码位 `U+E123` 得到「缺字指纹」（暗像素数 + 采样点），再用同字族渲染探测字（`组测温室验课`），指纹相同即判定缺字（豆腐块）。**两个引擎必须分别检测。**
- 结论落到代码：`fonts.mjs` 输出 `rasterFamily`（给 resvg）与 `watermarkFont`（给 Skia）两个字段；PNG 光栅化前若发现图里有中文而 `rasterFamily` 为空，**直接报 `CJK_FONT_UNAVAILABLE` 拒绝出图**，而不是交付一张整片方框的 PNG。

`【推测】` Windows 上预期系统自带 `msyh.ttc`（微软雅黑）可用，`fonts.mjs` 已按平台列出候选路径，但**Windows 真机未复验**。

---

## 4. 类别 c：PPT / 教学材料的审美与版式

`【事实·API】2026-09-12 查得`：

| 仓库 | Star | 许可证 | 最近推送 | 形态 | 结论 |
|---|---|---|---|---|---|
| [anthropics/skills](https://github.com/anthropics/skills) | 175,883 | **仓库根目录无 LICENSE 文件**；README 明示「repo 里多数 skills 是 Apache-2.0，但 `skills/docx`、`skills/pdf`、`skills/pptx`、`skills/xlsx` 是 **source-available, not open source**」 | 2026-09-10 | Agent Skill 集合（SKILL.md + 脚本） | 可借鉴结构，**不可搬运 pptx 实现** |
| [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 6,149 | MIT | 2025-11-28 | 生成 .pptx 的 JS 库 | **已在闭包内（4.0.1）**，直接可用 |
| [marp-team/marp](https://github.com/marp-team/marp) | 12,488 | MIT | 2026-07-29 | Markdown → 幻灯片 | 需新增依赖；产物是 HTML/PDF 为主 |
| [slidevjs/slidev](https://github.com/slidevjs/slidev) | 48,630 | MIT | 2026-08-25 | Vite + Vue 演示框架 | 需要完整构建链与浏览器运行时，违反 G2 |

**判断**

1. **Anthropic 官方 skills 仓库的合规红线（最重要的事实）**：其 README 明确写着文档类 skills（docx/pdf/pptx/xlsx）是 **source-available、不是开源**。因此**不能把这些 SKILL.md 或脚本 vendor 进 Mochi**。可以做的只有两件事：
   - 借鉴它 **`SKILL.md`（frontmatter + 指令正文）这种组织方式**——这是公开的 Agent Skills 规范（仓库里有 `spec/` 目录）；
   - 借鉴它「版式规则要写成可执行的硬约束」这一思路（例如字号阶梯、留白下限、一页一个观点），**用自己的话重新表述**。
   `【推测】` 上面的 `spec/` 目录本身是规范文本；规范属于「可自由实现」，但**引用时仍应标注来源**，落地前建议让主控做一次合规确认。
2. **marp**：`【推测】` 其 PPTX 导出能力与 Marp 主题体系确实做得不错，但要把 markdown→pptx 的链路搬进来需要新增依赖 + 一条与 `pptxgenjs` 重复的渲染管线。**Mochi 已有 `pptxgenjs` 4.0.1**，没有理由再引一套。
3. **slidev**：定位是「给工程师做技术分享」，需要 Node + Vite 构建 + 浏览器运行时，且产物是 Web 页面而非老师要的 `.pptx`。违反 G2 和教学场景的实际交付格式。
4. **本类别的实际结论**：**版式能力不靠引库，靠「规则 + 已有 pptxgenjs」**。Mochi 的 `mochi-presentations` 插件已用 `pptxgenjs` 出片，视觉能力方要做的是把「审美」编码成可检查的硬规则（标题/正文字号阶梯、边长对齐栅格、每页元素数上限、配色只从 Mochi 教学色取），而不是引入第三方主题包。

---

## 5. 类别 d：教材配图自动匹配

| 方案 | 性质 | 许可 | 结论 |
|---|---|---|---|
| **本机教材索引**（`<DSH_HOME>/knowledge/textbook.sqlite`，由 `plugins/mochi-knowledge` 导入） | 本地 SQLite，只读 | Mochi 自有数据 | ✅ **首选，且是唯一能称为「教材原图」的来源** |
| [Wikimedia Commons API](https://commons.wikimedia.org/w/api.php) | 开放图库 HTTP API | 许可混合（CC / 公有领域），**逐图确认署名** | ⚠️ 仅作「未执行的文字建议」 |
| [Openverse API](https://api.openverse.org/v1/images/) | 开放图库 HTTP API（[WordPress/openverse](https://github.com/WordPress/openverse) 377★ MIT） | CC 系，需按返回的 `attribution` 署名 | ⚠️ 同上 |

**红线（已在代码里落实）**

- 本工具**只读本机索引、不做 OCR、不联网、不写任何数据**。
- 本地没有匹配时返回 `状态: '本地无匹配'` + `索引可用: false` + 具体原因，**绝不伪造「已找到教材原图」**。
- 联网建议对象里带 `已执行联网检索: false` 自证字段，并明确写出「开放图库图片不一定是教材原图，也不保证与所用教材版本一致」。
- 检索复用 `mochi-knowledge` 的归一化约定（NFKC + 小写 + 去空白）与 `instr(search_text, ?) > 0` 检索，保证与知识库检索口径一致。

**`【事实·本机】本次实测的接口可用性**：
- GitHub REST API：**可达**（本文所有 star/许可数据即由它取得）。
- `commons.wikimedia.org/w/api.php`：**在本机沙箱内不可达**（`curl --max-time 12` 返回空、HTTP 000）。
- `api.openverse.org/v1/images/`：**在本机沙箱内不可达**（HTTP 000）。
→ 因此这两个接口的**返回结构与字段名本次未验证**，上面表里的接口地址来自官方文档，属于 `【推测】` 可用；真机接网后必须另做一次联调。这也再次说明：**教材配图不能依赖联网**。

---

## 6. 事实 vs 推测 对照（一览）

| 结论 | 类别 | 依据 |
|---|---|---|
| 各仓库 star 数、SPDX 许可证、最近推送时间、归档状态 | 事实·API | 2026-09-12 实测 `api.github.com/repos/<owner>/<repo>` |
| `Automattic/node-canvas` 许可证为 MIT | 事实·API | 读其 `package.json` 的 `license` 字段（仓库根目录**没有** LICENSE 文件） |
| `anthropics/skills` 的 docx/pdf/pptx/xlsx 是 source-available 非开源 | 事实·文档 | 其 README「About This Repository」段落原文 |
| `anthropics/skills` 仓库根目录无 LICENSE 文件 | 事实·API | 实测 `contents/` 列表：仅有 README.md / THIRD_PARTY_NOTICES.md / skills / spec / template |
| 桌面端闭包内 8 个依赖的版本与许可证 | 事实·本机 | 读 `apps/desktop/node_modules/*/package.json` |
| `@napi-rs/canvas` 是预编译 Skia、平台包 27MB、darwin-arm64 | 事实·本机 | 读 `@napi-rs/canvas-darwin-arm64/package.json` 与目录体积 |
| `@napi-rs/canvas` 可用于解码、改像素、编码、光栅化 SVG | 事实·本机 | 本机实测 + 34 个自动化用例通过 |
| resvg 只认「不带引号、不含逗号的单一字族名」 | 事实·本机 | 逐写法渲染后与 U+E123 缺字基准逐像素比对 |
| `GlobalFonts.has()` 对系统字体可能返回 false | 事实·本机 | 本机实测 `has('PingFang SC') === false` 但该字体可用 |
| Vega/Vega-Lite 在 Node 无头渲染需要 DOM/canvas 宿主 | **推测** | 未实测；仅据其架构判断 |
| ImageMagick wasm 不适合本场景 | **推测** | 未实测体积/性能 |
| marp 的 PPTX 导出链路可替代 pptxgenjs | **推测** | 未实测；且与已有能力重复 |
| Windows 上 `msyh.ttc` 能被 resvg 正确加载 | **推测** | 未在 Windows 复验 |
| Openverse / Wikimedia Commons 接口可用性与字段 | **推测（且本机不可达）** | 沙箱内 HTTP 000，未验证 |

---

## 7. 最终选型与「为什么不选 X」

**选型：零新增运行时依赖。** 图片编辑复用闭包内 `@napi-rs/canvas`；图表自研纯 SVG 生成器；PPT 沿用闭包内 `pptxgenjs` 并自建版式规则；教材配图只读本机索引。

| 落选方案 | 落选原因（一句话） |
|---|---|
| sharp / Jimp / resvg-js / rough.js / jsdom | 都是**新增运行时依赖**，且能力上并不比已在闭包里的 `@napi-rs/canvas` + 自研 SVG 更强。 |
| node-canvas / ImageMagick / marp-cli / mermaid-cli | 需要系统级依赖（Cairo / 外部二进制 / Chromium），教室离线环境装不上、打包也过不了评审。 |
| Chart.js | 输出是 Canvas 位图，老师无法在 PPT 里二次编辑，且画柱状图等于「糊弄」。 |
| Vega / Vega-Lite | LLM 友好，但两个大依赖 + 无头渲染仍需 DOM 宿主；`【推测】`复杂度高于自研。 |
| D3 | 刻度算法很棒，但为了几十行数学引一个依赖不划算；**只借鉴算法思路，不引代码**。 |
| Excalidraw | 是给人手绘的编辑器，不是「给数据出图」的库。 |
| Anthropic 官方 pptx skill | **source-available 非开源**，不能 vendor；只借鉴 `SKILL.md` 组织方式。 |
| slidev | 需要 Vite 构建链 + 浏览器运行时，产物不是 `.pptx`。 |
| Wikimedia Commons / Openverse 直连取图 | 开放图库**不等于教材原图**，且本机实测接口不可达；只能作为「明确标注未执行」的文字建议。 |

---

## 8. 本机实测记录（可复现）

```bash
# 1) 依赖闭包版本与许可证
node -e "for (const p of ['@napi-rs/canvas','pdfjs-dist','jszip','pdf-lib','pptxgenjs','docx','exceljs']) { const j=require('./apps/desktop/node_modules/'+p+'/package.json'); console.log(p, j.version, j.license); }"

# 2) 平台二进制
ls -la apps/desktop/node_modules/@napi-rs/canvas-darwin-arm64/

# 3) 视觉插件全量测试（34 个用例）
cd plugins/mochi-visuals && node --test test/*.test.mjs
```

`【事实·本机】测试结果：tests 34 / pass 34 / fail 0 / skipped 0`。

`【事实·本机】降级路径也已实测`：把 `node_modules/@napi-rs` 软链临时摘掉再跑同一命令，结果是 **tests 34 / pass 27 / fail 0 / skipped 7**，7 条需要真实像素的用例全部带明确原因跳过（`@napi-rs/canvas 在本机不可用（Cannot find package …），已跳过需要真实像素的用例；真机必须复验。`），**没有任何一条伪造通过**。这也是「图像运行时缺失时不伪装」这条要求在测试层的自证。

`【事实·本机】` 视觉验收产物（关系图 / 自环流程图 / 柱状图 / 折线图 / 饼图 / 流程图）均已人工看过位图，中文全部正常渲染，无豆腐块、无标签重叠、无穿心连线。

---

## 9. 存疑与未验证项（落地前必须处理）

1. **Windows / Linux 真机未复验**：`fonts.mjs` 的字体候选路径、resvg 对 `msyh.ttc` / Noto CJK 的加载是否同样只认单字族名——必须在 Windows 打包机上跑一遍同样的字体检测。
2. **Openverse / Wikimedia Commons 接口未联调**：本机沙箱不可达，字段名与许可字段（`attribution` / `license`）需真机验证后才能写进自动取图流程。
3. **Anthropic skills 的引用合规**：可以借鉴 `spec/` 里的 Agent Skills 规范与 SKILL.md 写法，但**任何来自 `skills/docx|pdf|pptx|xlsx` 的文本与代码都不得搬运**；建议主控做一次合规复核。
4. **`@napi-rs/canvas` 平台包体积**：约 27MB/平台，需确认打包白名单与安装包体积预算是接受的。
5. **Vega / marp 的「无头渲染到底要不要 DOM」是推测**：如果将来确实要做「LLM 直接写 Vega-Lite 规格」这种能力，需要先做一次真机验证再决策。
