# Mo滚入与问候

用户指定：第一幕Mo滚入中央，出现“哈喽，我是 Mochi。”，随后进入正片。复用当前产品ExpressiveOrb、createPainter和原表情采样；滚入只旋转原球体，未将电脑一起滚动或另画吉祥物。

0–1.15秒滚入减速，1.15秒轻弹停稳，1.22秒逐字问候，3.05秒引向真实首页，4–5秒播放既有首页前1秒。接回原首页的1–18秒，得到22秒开场，相对原片净增4秒。原录屏没有提速或删掉功能；没有添加语音配音。

GitHub复用检索覆盖完整项目 `site:github.com/heygen-com/hyperframes-launches k3-promo character animation`，再到组件 `site:github.com/greensock/GSAP timeline rotation bounce`，均成功。真实仓库 https://github.com/heygen-com/hyperframes-launches 、https://github.com/greensock/GSAP 。沿用已经核验的HyperFrames0.8.36/Apache-2.0（d4756f597c0dbb66310c2add699de6767b23f11b）与GSAP3.15.0/Standard no charge（13e2b790546426a1a2e0e9b409f3f8dc6d6611f2）。现成Timeline、rotation、bounce足以完成，不重写动画引擎，不新引入依赖。产品球体内部bloub0.1.1/MIT声明仍在原源码。

维护成本限定影片编舞。构建记录原组件哈希；HTML中媒体有稳定id，fromTo显式设置终点opacity，避免预览正常但冷启动逐帧渲染隐身。检查结果见validation.json，实际导出须另外抽帧确认。

构建顺序：build.mjs → render.mjs → join-opening.mjs。5秒独立文件是完整片开场组件，不是替代长片的短版交付。

本轮已实际导出5秒/600帧，并合成22秒/2640帧开场；2K120。检查运行、布局、对比均零错误，实际1.8秒导出帧确认角色和问候可见，4.5秒已进入真实首页。完整片重新生成音轨而非把旧配乐简单后移。
