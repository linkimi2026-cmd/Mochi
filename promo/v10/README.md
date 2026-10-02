# V10 制作工程

目标仍为 4—5 分钟的 Mochi 全功能演示片。**目前交付的是 30 秒原组件动效样片，长片尚未完成。** 用户粘贴的 mdfor.dev 英文提示作为动效参考，不改变产品或完整影片时长。

## 已完成

- 首页祝愿缩短：祝愿上限16字、完整标题28字；旧长缓存回退短句，8项测试通过。源码和隔离演示环境已更新，未重打安装包。
- Meta Muse 官方82秒宣传片：已实际抽看8个时间点的画面，拆解见 [Muse参考拆解](Muse参考拆解.md)。不声称完成音轨试听与逐帧复刻。
- 原代码渲染：直接引用 OrbCompanion、MochiTeam、TeacherRequestRow，以及原主题/纸张样式；不复制一套虚构界面。请求和分工使用注明的示例数据，不是实际任务成功证明。
- 真实模型操作：录像来自隔离 Mochi 中的椭圆切线模型。生成产物初次预览空白，已将它自己的JS/CSS内联后修复；仅修复该产物，未声称修复模型插件。
- 30秒样片：`output/Mochi_V10_原组件动效样片_30s_2K120.mp4`，2560×1440、120fps、AAC立体声。原录屏不是原生120fps；源组件动画逐帧渲染。
- HyperFrames check通过：运行/排版/动效无错误，46项文字对比检查通过。导出元数据在 `evidence/export-metadata.json`。抽帧验证不能替代完整人工审片。

## 制作入口

`node promo/v10/build.mjs` 从当前产品源码打包组件并记录SHA256，`bash promo/v10/render.sh` 验证并渲染。本机使用既有 HyperFrames 0.8.36、GSAP3.15.0、React运行环境，不增加产品依赖。

本地音乐/字体复用v8资产。音乐是 Mixkit《Tech House vibes》，授权副本见 `licenses/`；主要转场参考自动检测的节拍点，检测值可能为双倍拍，不声称音乐实际速度为234 BPM。未使用Meta/Kimi原声。

原片只放 `private.nosync/`；导出文件和二进制素材不进Git。`assets/model-demo-final.mp4`从`private.nosync/model-working.mov`的29—36秒裁切，保留真实切点拖动。重建需要本机原始素材。

## 未完成与禁用素材

[导演方案](导演方案.md)保留280秒功能预算；[源码清单](source-tool-inventory.json)只是候选工具清单，不是全功能验收。V9旧片中有Codex、Clash Verge、Dock、系统通知和浮窗，不可直接用于V10。

全功能长片还需补齐叫人/名册、教师与教室的投递接收、校园查询和放行、同事A2A、课件及文档等可读闭环。不能用本样片或源码工具数量声称全部完成。
