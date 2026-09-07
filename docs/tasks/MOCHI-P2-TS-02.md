# MOCHI-P2-TS-02 · 课件二次编辑聊天接线：mochi.ppt_create / mochi.ppt_revise（真 .pptx，禁止 HTML）

> 派发对象：GLM 5.3 flash 实现代理 · 监制：WorkBuddy（只审计不编码）
> 依据：总体方案第 11 章 #7（教案/材料→可继续修改的上课 PPT）、任务书 Golden Demo「班会 PPT 二次编辑不重做」。
> 边界：只允许新建两个文件：`plugins/mochi-presentations/plugin.mjs`、`plugins/mochi-presentations/test-plugin.mjs`；允许**改一处**：`package.json` 的 `main` 改为 `plugin.mjs`。**禁止**改 index.mjs / 其他任何文件 / npm install / 重启服务 / git。

## 家底（已盘点，必须复用）

`plugins/mochi-presentations/index.mjs`（255 行，已验收）：
- `generatePresentationBundle({presentation, outputDirectory, signal})` — pptxgenjs 4.0.1 生成真 .pptx（`presentation.pptx`）
- `revisePresentationBundle({previousSourcePath, revision, outputDirectory, signal})` — 已有修订通道
- `validatePresentation(input)`；fixtures/lesson-plan.mjs 是输入样例；test/presentation.test.mjs 是测试风格参考
- **先读 index.mjs 与 fixtures 弄清 presentation 输入结构与 revision 结构，再设计工具参数，不猜。**

## 交付物

1. **plugin.mjs**：dsh 插件入口（模式照抄 `plugins/mochi-dispatch/index.mjs`）。
   - **mochi.ppt_create**：参数 `title`、`slides`（数组：{heading, bullets[]}）、`outputDirectory`。走 generatePresentationBundle；返回产物绝对路径、页数、完成标志。
   - **mochi.ppt_revise**：参数 `previousSourcePath`（上次课件的生成源路径）、`page`（正整数页码，必填）、`instruction`（本页修改说明，必填）、`outputDirectory`（新目录，必填——**不覆盖已确认版本**，方案第 18 章）。
     走 revisePresentationBundle；返回差异摘要：改了第几页、改了什么、其余页未动的验证结论、产物绝对路径。
   - 描述写清楚：老师改课件说"第 X 页改成…"就用 revise，不要从头生成（重生成会丢老师已确认的内容）。
2. **test-plugin.mjs**：mkdtemp 隔离，桩 ctx：
   ① 两工具注册正确
   ② create 5 页 fixture → 真 .pptx 生成成功
   ③ **核心验收（Golden Demo）**：revise 第 3 页 → 用 jszip（pptxgenjs 的传递依赖，直接 import 'jszip'；若解析不到就用 node:zlib+node:fs 手动解，写明原因）重开新 pptx，断言：slide3 XML 含新内容、slide1/2/4/5 的 slide XML 与旧版**逐字节一致**
   ④ 新输出目录已存在→明确报错；page 越界→明确报错
   ⑤ render 签名回归（双参，大坑 17）

## 红线

- 产物只能是真 .pptx（pptxgenjs），**禁止 HTML 幻灯片/网页充数**——这是用户明文禁令。
- 版本纪律：revise 永远写新目录，不覆盖旧版；返回里说明旧版仍在。
- 卡死两轮就汇报现状，不无限重试。

运行：`cd /Users/a1379/Documents/Mochi/plugins/mochi-presentations && /Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node test-plugin.mjs`

## 交付

两文件 + main 改 plugin.mjs + 测试全绿（含 slide 逐字节对比）。汇报：文件清单、测试输出末尾、偏差。200 字内。
