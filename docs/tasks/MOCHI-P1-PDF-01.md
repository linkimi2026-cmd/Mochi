# MOCHI-P1-PDF-01

执行中；唯一实现者 Halley / terra-max，root架构审计。方案§24要求普通生成路径零本机依赖，保留共用底座与可编辑产物。

已核mochi-documents/presentations从受限结构输入生成docx/pptx后实际spawn soffice。已有docx9.7.1、pptxgenjs4.0.1、pdf-lib1.17.1和NotoSansSC字体/OFL可复用。检索结论见artifacts/architect-audit/p1-zero-deps-preflight/REPORT.md；fontkit接入前补固定版本/license/兼容核验，不能把PDF画布宣称为任意Office转换器。

唯一外部隔离副本写范围：新增packages/mochi-pdf-layout共享PDF/font/度量/校验；documents/presentations普通PDF路径、必要manifest/锁/测试。同源结构直接输出PDF，不再调用soffice；原可编辑OOXML/source/manifest与内容/页数/表格断言保留。语义布局各插件负责，公共原语共用。字体来源与许可随包。

四川考试精确Songti/Times模板及其断言原路径保持，明确单列未完成跨平台项；不为此阻挡普通路径。禁止原插件依赖树、UI/sidebar/desktop/profile/campus/grades/OfficePOC修改。其他代理并行，不能还原其改动。

正常新依赖安装已授权，固定现有Node22/npm11.6，不升级工具。验收无外部程序条件下生成可编辑Office与可搜索嵌入字体PDF，页数及文本/表格内容真实核验，异常失败与清理按原契约。交最小patch、生成产物与真实命令结果；root独立复审后顺序集成。
