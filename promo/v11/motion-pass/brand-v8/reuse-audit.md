# 2026-10-04 · 产品定位与四款品牌配色

先检索完整应用/发布片：`site:github.com heygen-com hyperframes launches`、`site:github.com remotion-dev template promotional video`，再查组件 `site:github.com gsap timeline background color transition`。GitHub搜索/API成功；raw下载部分SSL失败，HyperFrames源码重试成功，GSAP LICENSE文件仍失败，不能称无现成方案。

- https://github.com/heygen-com/hyperframes-launches ，HEAD d7ac35069d74a3a437780579b3b7fe2f3eeace5f。读取Apache2 LICENSE和k3-promo/index.html，独立场景、GSAP时间轴、字体层和多尺度品牌入场。部分采用既有完整管线和连续空间方法，不复制第三方品牌媒体。实际渲染仍固定本地HyperFrames0.8.36，未追踪升级。
- https://github.com/remotion-dev/remotion ，HEAD e385a83dbde54179c0457ad90b7d7c3a4b6ab44a。读取实际LICENSE.md与transitions/slide.tsx；自有分级许可，非MIT。现有入退双层用同一进度并补边缘epsilon。参考前后场并存，未引入React视频新管线：迁移会增加组件、媒体时钟和音轨适配维护。
- https://github.com/greensock/GSAP ，HEAD 13e2b790546426a1a2e0e9b409f3f8dc6d6611f2。package.json确认3.15.0及Standard no-charge许可链接，远程LICENSE获取失败；沿用本项目已审计固定版本，未新增包。采用现有timeline绝对时钟、transform与背景层动画；用确定时点和真实导出验证。

桌面K3原片重新按3秒抽帧通览，12–17秒按0.5秒看品牌入场。可确认：成果场景缩回周边纸张空间，中部品牌进入；不是仅更换相同卡片。原片未证明制作软件。GitHub16秒示例与桌面56.704秒原片不是同一视频。

实际四款配色来自client-plugins/jxl-theme/assets/mochi-palettes.json，team-palette与team-conversation-palette确认也用于成员/会话配色。影片仅将这些品牌颜色用作舞台背景，不重绘或改色真实产品UI。logo取apps/desktop/build/icon-source.svg，不另画。开场8秒替代旧5秒问候+前3秒重复首页，随后保留opening从4秒开始的原操作，整个首章仍22秒。后续功能时间轴不变，避免全片音乐重排；新的字形声需按实际入场重建。

长期维护：新增独立brand-v8可重建层，复用第七版源镜头及实际素材；产品源码与依赖不变。只修改后期舞台色彩、定位文案及品牌露出。渲染、字体/边界/解码验证与人工审美验收分开。


用户追加角色要求后，补查 `site:github.com jperret bloub animation thinking orbit`，定位实际上游 https://github.com/jeremy-prt/bloub 。API确认HEAD仍b4bb3c1b5f93c7b87a2e8d620f667c4093d97749；本地SOURCE.json锁0.1.1/MIT并逐文件哈希。实际读取engine、states、createPainter：thinking是球体变成中点、再分出两侧点，notify/comet/orbit/burst/swirl均为已有状态。采用产品已集成引擎与皮肤的确定性采样，不重写三点或形变算法、不改产品。新影片为每个主题使用原主题Mo；转场按思考、完成、探索、投递、查询、记忆分配动作，结尾原Logo左上、Mo居中回应。公开MIT仅覆盖代码，不冒称外部视觉设计原创。

验证完成：第八版299.35秒、2560×1440/120fps、35922帧；38个章节与28个转场预览无字体/媒体/脚本加载问题，866个角色采样可见几何有限且乱序seek一致。全片编码扫描发现叫人段1.73秒近静止后，补上通知到回执的镜头引导，鼠标随同一相机坐标移动；复扫无超过1.5秒近静止或黑帧。两音轨版本视频码流相同、完整解码通过，K2.5仍仅使用分离的音乐层。人工审美及完整听审未据此标为通过。局部修复同时处理同色角色轮廓与角色与Logo遮挡点。
