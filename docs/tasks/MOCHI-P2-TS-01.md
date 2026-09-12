# MOCHI-P2-TS-01 · 成绩分析聊天接线：mochi.grade_analyze（真 .xlsx，禁止 HTML）

> ⚠️ **工具名与状态口径更正（2026-09-12 补加，正文一字未删）**
> - 本文写作时的工具名为**点号形态**（如 `mochi.xxx`）<!-- allow-dotted-tool-name -->，该形态已于 2026-09-12 因模型网关 400 事故**全面禁用**；现行注册名一律下划线（如 `mochi_memory_note` / `mochi_ppt_create` / `mochi_grade_analyze`）。以源码为准，见 `docs/mochi-naming-convention.md` §5。
> - 本文中的插件计数与 PASS 结论均为**写作时点**成立，可能已被后续改动推翻。现状以 `docs/DELIVERY-LEDGER.md` 与源码为准。

> 派发对象：GLM 5.3 flash 实现代理 · 监制：WorkBuddy（只审计不编码）
> 依据：总体方案第 11 章 #4/#5（成绩表→可复核分析）、第 13 章共用地基、第 14 章三句话验证。
> 边界：只允许新建三个文件：`plugins/mochi-grades/plugin.mjs`（dsh 插件入口）、`plugins/mochi-grades/sheet-read.mjs`（读表）、`plugins/mochi-grades/test-plugin.mjs`；允许**改一处**：`plugins/mochi-grades/package.json` 的 `main` 改为 `plugin.mjs`。**禁止**改 index.mjs（库已验收）/ 其他任何文件 / npm install / 重启服务 / git。

## 家底（已盘点，必须复用，禁止另造统计逻辑）

`plugins/mochi-grades/index.mjs`（719 行独立库，已验收）：
- `validateStructuredGrades(input)`、`calculateGradeStatistics(reviewedRows, assessment)`、`generateGradeWorkbook({grades, outputDirectory, signal})`
- 口径硬规则已在库内：present=0 是有效零分；absent/exempt/blank 不按零分；同名不同学号不合并；重复学号标待核对且排除统计；输出目录必须不存在（mkdir 独占）；完成后写 `.mochi-grades.complete`。
- 依赖 ExcelJS 4.4.0（已在 dependencies）。先读 README.md 和 index.mjs 再动手。

## 交付物

1. **sheet-read.mjs**：读老师给的成绩表文件为结构化输入。
   - 支持 `.xlsx`（ExcelJS 读第一个工作表）与 `.csv`（手写解析器：引号转义、逗号、换行；零新依赖）。
   - 表头识别：学号/姓名/科目分数列；**缺表头、缺学号列、学号被读成数字丢前导零、同名不同学号、重复学号、空白行**——每类给行号级中文报告（方案：出错可定位到行）。
   - absent/exempt/blank 识别：`缺考/免修/空白` 字面量 → 对应状态；数字 → present；非法单元格 → 标待核对并列行号，**不猜**。
2. **plugin.mjs**：dsh 插件入口（模式照抄 `plugins/mochi-dispatch/index.mjs`：defineTool/inject:['tools']/output 双参 render/apply(ctx)）。
   - 工具 **mochi.grade_analyze**：参数 `filePath`（.xlsx/.csv 绝对路径，必填）、`examName`、`subject`、`maxScore`、`passScore`、`excellentScore`、`outputDirectory`（绝对路径，必填）、`scopeLabel?`。
   - 流程：读表 → validateStructuredGrades → calculateGradeStatistics → generateGradeWorkbook（teacher-internal 内部审计工作簿）→ 返回预消化中文摘要。
   - 摘要必须含七件事（方案第 10 章）：输入文件与行数、采用的口径（阈值原样引用不猜）、缺考/免修/空白/零分各几人、同名与重复学号待核对名单（行号）、产物绝对路径、完成标志是否存在、出错时下一步怎么改。
   - 外部匿名版不在本票范围。
3. **test-plugin.mjs**：mkdtemp 造 fixture（xlsx 用 ExcelJS 写、csv 手写），桩 ctx 捕获注册表：
   ① 工具注册正确 ② xlsx 与 csv 双通道各跑通一次全链，产物 xlsx 存在且 `.mochi-grades.complete` 在
   ③ 缺考/免修/空白/零分口径断言（对照 calculateGradeStatistics 结果，不许自己另算）
   ④ 重复学号/同名不同学号→待核对名单含行号 ⑤ 学号前导零保留（"001"）
   ⑥ 输出目录已存在 → 明确报错不覆盖 ⑦ render 签名回归（双参，大坑 17）

## 红线

- 产物只能是真 .xlsx（ExcelJS），**禁止 HTML 报表充数**。
- 统计口径一律走库内函数，plugin 层零自算；拿不准的输入标待核对，不猜。
- 卡死两轮就汇报现状，不无限重试。

运行：`cd /Users/a1379/Documents/Mochi/plugins/mochi-grades && /Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node test-plugin.mjs`

## 交付

三文件 + main 改 plugin.mjs + 测试全绿。汇报：文件清单、测试输出末尾、偏差。200 字内。
