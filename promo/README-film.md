# Mochi · 120 秒纯界面产品介绍

主文件：output/Mochi_120秒_纯界面版.mp4。配套字幕：output/Mochi_120秒_字幕.srt。

全片使用 Mochi 实际界面截图与真实操作采集帧，字幕与指针为后期图层。无 AI 人物、办公室、教室场景或设备外壳。1920×1080，60 fps，120 秒，立体声配乐及轻量点击声，无配音。

镜头覆盖工作区、完全权限、工作模式、简单三角形预览与点击、自然语言修改和保存结果、校园待办、学生事实查询、人工审批及命令入口。修改案例真实用时31秒，片内明确注明执行过程省略；不将片内节奏当实时性能。

## 素材真实性
- triangle-demo.html 先进入工作模式再发送任务，UI 显示生成用时1分05秒；产品内实际点击三种形态通过。
- 后续修改标题的任务真实执行完成，刷新预览后显示新标题，切换按钮仍可用。
- 校园与审批补充镜头来自已有产品截图，并未剪成一次跨角色消息已完成的假流程。
- 学生相关界面使用演示数据。
- Windows 全功能实测正常是用户确认，本片没有 Windows 实机录屏，不做对应画面冒充。
- 教师工作台遮挡帧与失败的长任务不纳入最终素材。另有文件预览侧栏按实际需要显示。

## 可维护的工程
生成器 interface_film.py，时间轴 timeline.json，配乐 score.py，合成入口 index.html。
重建：python3 interface_film.py；渲染：./node_modules/.bin/hyperframes render . --quality high --fps 60 --workers 2 --output output/Mochi_120秒_纯界面版.mp4。
Node依赖锁定 HyperFrames0.8.36、GSAP3.15.0。Noto Sans CJK SC字体来自notofonts/noto-cjk，许可证随assets保存。配乐由本工程合成，不使用竞品音视频。

原环境试稿封存在 evidence/rejected-environment-draft.html，不属于交付内容。recordings/simple存在被裁切的旧采集帧，正式工程只引用recordings/clean副本和已核产品截图。

最终音频后处理：FFmpeg loudnorm=I=-20:TP=-1.5:LRA=8，视频流复制，AAC192k/48kHz，faststart。验收详见 evidence/final-audit.json。
