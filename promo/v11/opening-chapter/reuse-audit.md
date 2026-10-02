# 开场与预设镜头复用

本轮先检索完整框架 `site:github.com/heygen-com/hyperframes compositions video input transition`，再检索组件 `site:github.com/greensock/GSAP timeline transformOrigin video zoom`。前者命中官方 core、variables-and-media、composition 文档；后者本轮没有返回对应组件页，不将其表述为没有开源组件。

实际仓库 https://github.com/heygen-com/hyperframes 与 https://github.com/greensock/GSAP 。沿用已核提交 d4756f597c0dbb66310c2add699de6767b23f11b / 13e2b790546426a1a2e0e9b409f3f8dc6d6611f2；本轮重读本机 package.json 为 HyperFrames 0.8.36 / Apache-2.0 与 GSAP 3.15.0 / Standard no charge。未升级或引入依赖，Node 24 及既有渲染链保持不变。

部分采用框架媒体时序和 GSAP 等比变换：视频播放与逐帧定位由 HyperFrames 管理，不在回调中自行 seek；不将 video 放在有 data-start 的普通父层中。鼠标用原有独立屏幕层，避免随镜头缩放变形。没有重写录制或动画引擎。新增代码仅为剪辑入出点、镜头编排和标题，不改变产品布局。输入示例点击仅表示填入草稿，不能剪成发送或成功生成。

实际接入验收另见 README；源码存在与文档支持不代替实渲结果。
