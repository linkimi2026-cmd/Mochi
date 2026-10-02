# 教学成果章节复用记录

先搜完整工程 `site:github.com/heygen-com/hyperframes-launch-video video compositions`，再搜组件 `site:github.com/greensock/GSAP video timeline scale transition`。命中 https://github.com/heygen-com/hyperframes-launches （d7ac35069d74a3a437780579b3b7fe2f3eeace5f，2026-09-26提交）；GitHub网页k3-promo目录本次抓取受限，API及固定commit raw读取成功，不能误报无权限或没有案例。已实读LICENSE为Apache-2.0、k3-promo/index.html及package.json（目标HyperFrames0.7.66）。这是16.47秒其他K3复刻，不是用户桌面的56.7秒影片。只学习分层坐标、字距收拢、相邻场景错开入场，不复制品牌、音乐、媒体或整片；其onUpdate驱动不直接接入本工程确定性seek。继续采用本机HyperFrames0.8.36/GSAP3.15.0现成视频与timeline接口，无新增依赖、不降级。后续实渲检查真实视频帧变化、鼠标固定48×60及生成前后对应关系；未完成模型修订不能被剪成已成功。

课件修订直接调用本仓已有 revisePresentationBundle，没有使用另一个PPT引擎重绘成品。演示图表值由原课例 y=0.5x+2 计算；不是另一次Mochi聊天生成的录屏。ScreenCaptureKit录制器沿用前次已审MIT来源，仅增加MOCHI_RECORD_CURSOR=0的可选开关，默认行为不变。用于避免原生鼠标与后期固定比例鼠标同时出现；当前已编译，但尚未新录验证无鼠标模式。
