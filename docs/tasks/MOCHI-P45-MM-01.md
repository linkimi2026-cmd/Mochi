# MOCHI-P45-MM-01 · 教学建模首样：椭圆切线交互模型（JSXGraph，离线零依赖）

> ⚠️ **工具名与状态口径更正（2026-09-12 补加，正文一字未删）**
> - 本文写作时的工具名为**点号形态**（如 `mochi.xxx`）<!-- allow-dotted-tool-name -->，该形态已于 2026-09-12 因模型网关 400 事故**全面禁用**；现行注册名一律下划线（如 `mochi_memory_note` / `mochi_ppt_create` / `mochi_grade_analyze`）。以源码为准，见 `docs/mochi-naming-convention.md` §5。
> - 本文中的插件计数与 PASS 结论均为**写作时点**成立，可能已被后续改动推翻。现状以 `docs/DELIVERY-LEDGER.md` 与源码为准。

> 派发对象：GLM 5.3 flash 实现代理 · 监制：WorkBuddy（只审计不编码）
> 依据：总体方案第 15–20 章（教学建模工作空间；首批小样之「圆锥曲线与切线」；八步交付流程的验证要求）。
> 边界：只允许新建 `plugins/mochi-modeling/` 整个新目录。**禁止**改其他任何文件 / npm install / 重启服务 / git。可以自己上网查 JSXGraph（GitHub/CDN），但 vendor 下来的文件必须记录来源、版本、许可证。

## 目标

做出第一个「能运行、能拖动、能核对、能保存」的交互教学模型：椭圆 x²/a²+y²/b²=1 的切线。
这是方案五种成果形态里的「交互数学模型」——交付物是自包含交互页面（**这是模型，不是 PPT，禁止做成幻灯片**）。

## 关键设计（红线，方案第 15–18 章，违者返工）

1. **计算与画面同一份模型状态**：几何计算抽成独立 `plugins/mochi-modeling/conic.mjs`（纯 ESM 零依赖，node 可直接跑），HTML 页面与 node 验证脚本**import 同一份计算函数**——不许页面里另写一套公式。
2. **拖动一次参数不调一次大模型**：页面所有交互由本地计算完成，无任何网络请求。
3. **离线零依赖**：JSXGraph 以本地文件 vendor 进 `plugins/mochi-modeling/assets/`（自己去 GitHub jsxgraph/jsxgraph 核对最新稳定版与许可证——方案记录其为 LGPL/MIT 双许可，你要实测确认并记录版本号+commit/tag+许可证文件来源）；生成的 HTML **禁止出现任何 http(s) 外链**（js/css 全相对路径引用 vendor 副本）。
4. **假设显式**：页面固定区域写明研究对象、坐标系、单位、参数范围、忽略因素（"理想椭圆 / 欧氏平面 / 不考虑数值舍入误差以外的不确定性"）。
5. **观察不是证明**：页面显著位置标注「拖动观察只能支持猜想，证明需要推导」；提供教学模式切换：观察 → 提问 → 辅助线 → 分步推导 → 结论（最小实现：结论区默认隐藏，按钮逐步揭示）。
6. **课堂模式**：大字号/高对比切换按钮（3 米外可读）。

## 交付物（plugins/mochi-modeling/ 新目录）

1. `conic.mjs`：椭圆计算核心——`pointOnEllipse(a,b,t)`、`tangentLine(a,b,x0,y0)`（返回切线 xx0/a²+yy0/b²=1 的系数与斜率/截距）、`foci(a,b)`、参数校验（a,b>0 有限，点须在椭圆上容差内）。
2. `index.mjs`：dsh 插件入口（照 dispatch 模式），工具 **mochi.model_create**：参数 `type`（本期仅 'conic-tangent'）、`a`、`b`、`outputDirectory`。生成：
   - `<out>/model.html`（自包含交互页：可拖切点、切线/焦点/辅助线、参数滑块改 a,b、结论分步揭示、课堂模式、假设区）
   - `<out>/model.json`（模型说明：类型/参数/公式/假设/版本 v1/生成时间/**验证结果摘要**）
   - `<out>/assets/jsxgraphcore.js`（从 plugin assets 复制）
   - 返回预消化中文摘要：产物路径、参数、验证结论（通过/失败+数值）、教学模式说明。
3. `verify.mjs`：node 数值验证（不开浏览器）：用 conic.mjs 对 a=5,b=3 等 ≥5 组参数抽 ≥20 个点，断言切线斜率对解析解 -b²x0/(a²y0) 容差 1e-9；边界（a≤0、b≤0、NaN、点不在椭圆上）全拒绝；`mochi.model_create` 生成的 model.json 里写入本验证的通过摘要。
4. `test.mjs`：桩 ctx + mkdtemp：①工具注册正确 ②全链生成三件套 ③HTML 零 http(s) 外链（grep 断言）④model.json schema 与验证摘要 ⑤conic.mjs 解析解抽验 ⑥render 签名回归（双参，大坑 17）
5. `package.json`（照 dispatch + node_modules.nosync 符号链接模式）+ `README.md`（一页：是什么/怎么跑/vendor 来源版本许可证）。

## 卡死处理

JSXGraph vendor 若拿不到（网络问题）：降级为手写 Canvas 实现（conic.mjs 不变，渲染层自绘约 100 行），在汇报里说明降级原因——**不许因此停工**。

## 交付

目录 + 测试全绿。汇报：文件清单、JSXGraph 版本与许可证核实结论、测试输出末尾、偏差。200 字内。
