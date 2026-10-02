# 模型章节复用

先检索完整框架 `site:github.com/heygen-com/hyperframes video compositions GSAP camera transition`，再检索组件 `site:github.com/greensock/GSAP timeline video scale`。实际命中 HyperFrames core、GSAP适配器、媒体时序及 greensock/gsap-skills 时间轴文档。沿用 https://github.com/heygen-com/hyperframes @d4756f597c0dbb66310c2add699de6767b23f11b / 本机0.8.36 Apache-2.0 和 https://github.com/greensock/GSAP @13e2b790546426a1a2e0e9b409f3f8dc6d6611f2 / 本机3.15.0 Standard no charge；未升级。采用现成媒体管理与等比时间轴，不重写引擎。

继续搜 `site:github.com/jsxgraph/jsxgraph v1.13.3 moveTo update board`，成功命中官方CHANGELOG、仓库与工作流。本机vendor文件头确为1.13.3，已读 plugins/mochi-modeling/assets/LICENSE.MIT。原产物metadata记7c2176d479ae256cb9d38265bce81fa18709d01f；官方工作流把1.13.3发布列在99d8c9f，不能将前者误称release tag。只复用本机已生成模型及固定vendor，不取网络最新版。

原始 model-before-inline.html 已包含全部数学函数、参数、推导、原样式。构建仅将原先相对依赖内联到素材副本，追加确定性取样适配；原产品/模型文件不修改。适配调用原P.moveTo、slider事件、setStage及原推导节点，不另写几何公式、不新增自动播放产品能力。iframe保持原CSS作用域，避免把成果排版覆盖成宣传片主题。需要实渲验证字体、参数联动、乱序seek和各浏览器worker初始化，源码存在不表示适配通过。
