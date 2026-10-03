# 第八版：校园工作伙伴 · 四色 Mo

这是第七版的后期修订，保留其功能画面、299.35 秒时长与后续动作锚点。输出为 2560×1440、120fps 合成；原始窗口录屏的采样率不因此变成120fps。最终导出清单在上一级 `music-variants.json`。

## 此轮改动

- 0–8秒先问候，再明确“你的 AI 校园工作伙伴”，引出教学创作、校园连接、Agent协作。新8秒开场加原opening的4–18秒，共22秒；6秒后实际操作的全片位置与第七版一致。
- 使用产品 `mochi-palettes.json` 的经典焦糖、奶油米白、鼠尾草绿、雾桃奶茶，改变后期舞台与Mo角色，保持真实UI的颜色及内容。不同章节以纸张、空间移位和色面揭示连续衔接。
- 复用产品BotEngine与createPainter。三点思考、环绕探索、完成散开、彗星投递、提醒、旋转和眨眼按语义编排。三点思考由中心球体收缩和两个侧点组成，并非重新画的加载图标。
- 结尾使用真实品牌SVG，Logo左上、Mo居中，“Mochi 已至”后眨眼回应。品牌封面保留。
- 两个配乐版共用同一视频码流。K2.5继续仅使用已经分离的音乐层，不重新加入参考片的电影音效；产品打字、点击、叮咚沿原操作时钟混音。

## 可重建入口

从仓库根目录运行。前提：第七版源素材、当前产品的bloub动作引擎 / Mochi皮肤 / 四色JSON，以及原有本地HyperFrames0.8.36/GSAP依赖已准备好；私有素材不打入Git，产品输入按manifest中的路径与哈希核对。本轮后期提交不包含其他任务尚未提交的产品源码。`source-manifest.json`记录源镜头及品牌来源，`reuse-audit.md`记录外部源码审查。

```sh
node promo/v11/motion-pass/brand-v8/build.mjs
node promo/v11/motion-pass/brand-v8/render.mjs opening greeting team teaching delivery model mailbox students query collaboration daily ending
node promo/v11/motion-pass/brand-v8/assemble.mjs --sources
node promo/v11/motion-pass/brand-v8/preview.mjs
node promo/v11/motion-pass/brand-v8/preview.mjs bridges
node promo/v11/motion-pass/brand-v8/actor-check.mjs
node promo/v11/motion-pass/brand-v8/render.mjs bridge-0 bridge-1 bridge-2 bridge-3 bridge-4 bridge-5 bridge-6
node promo/v11/motion-pass/brand-v8/assemble.mjs --final
node promo/v11/motion-pass/typing-cover.mjs
~/.cache/mochi-audio-tools/venv/bin/python promo/v11/motion-pass/k25-audio-repair/build.py
~/.cache/mochi-audio-tools/venv/bin/python promo/v11/motion-pass/k25-audio-repair/check.py
node promo/v11/motion-pass/music-variants.mjs
~/.cache/mochi-audio-tools/venv/bin/python promo/v11/motion-pass/brand-v8/verify.py
~/.cache/mochi-audio-tools/venv/bin/python promo/v11/motion-pass/brand-v8/check-export.py
```

`render.mjs greeting`先从新opening提取2–4秒作为开场末尾的真实界面，因此必须先渲染opening。各独立章节可以分批渲染；不要同时重建与渲染同一HTML。build只创建本版素材链接，桥接素材在本版目录生成，不覆盖历史版本。

## 验证边界

`preview-validation.json` / `bridge-preview.json`检查字体、媒体加载、脚本错误和替换乱码字符；`actor-validation.json`检查每0.1秒几何与乱序seek，可见几何比较排除已隐藏的缓存节点。后者不能替代人眼检查遮挡。

上一级`validation.json`记录最终编码帧数、时间戳、黑帧及超过1.5秒的近静止检测。自动通过不能代表所有文字均已人工校对、全部产品功能通过测试或音乐审美已获认可。功能证据与限制沿用上一级README，不将后期Mo动作说成软件运行时的镜头效果。

验证完成：第八版299.35秒、2560×1440/120fps、35922帧；38个章节与28个转场预览无字体/媒体/脚本加载问题，866个角色采样可见几何有限且乱序seek一致。全片编码扫描发现叫人段1.73秒近静止后，补上通知到回执的镜头引导，鼠标随同一相机坐标移动；复扫无超过1.5秒近静止或黑帧。两音轨版本视频码流相同、完整解码通过，K2.5仍仅使用分离的音乐层。人工审美及完整听审未据此标为通过。局部修复同时处理同色角色轮廓与角色与Logo遮挡点。
