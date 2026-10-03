# 第七版：动态字形、阅读镜头与连续空间

最新范围：保留真实功能演示，排除语音/拍题/课表。只导出原版配乐与 K2.5 音轨；K3 只作为画面研究，不再制作音轨版。

`../reuse-comparison-v7.md` 是开工检索与许可/兼容性结论。`chapters.json` 列出 34 处信息焦点与镜头窗口，`pacing-audit.json` 给出全片位置。窗口内定点停留 <=1.2 秒；不改变素材播放速度。七段记忆场景和结尾单独重编排。此上限是编舞设计口径，不应冒充完整语义自动验收。

## 构建

在 Mochi 根目录运行，依赖现有 promo 固定的 HyperFrames/GSAP 和原章节 assets：

```sh
node promo/v11/motion-pass/pacing-v7/build.mjs
node promo/v11/motion-pass/pacing-v7/build-daily.mjs
node promo/v11/motion-pass/pacing-v7/render.mjs opening team teaching delivery model mailbox students query collaboration daily ending
node promo/v11/motion-pass/pacing-v7/assemble.mjs --sources
node promo/v11/motion-pass/render.mjs 0 1 2 3 4 5 6
node promo/v11/motion-pass/pacing-v7/assemble.mjs --final
node promo/v11/motion-pass/sync-scores.mjs --plan=pacing-v7/plan.json
```

现有配乐的后续流程依次执行 `measure-sync.py`、`finish-score-attacks.py`、`measure-sync.py`、`mail-delivery-audio.mjs`、`typing-cover.mjs`。当前 K2.5 另按 [音轨修订入口](../k25-audio-repair/README.md) 分离音乐并重建、检查，再运行 `music-variants.mjs`；不能使用旧全混音覆盖分离音乐版。Python 需 numpy，可使用 Codex 提供的依赖环境。不要重复叠加 attack edit；每次从 sync-scores 重建。不要运行旧 build.mjs 覆盖第六版空间转场 HTML。

## 连续性与边界

- 镜头在隔离容器中移动原生 UI；进入近景时后期标题让位，避免挡字段。模型由原 iframe 与原交互时钟渲染；相机先更新，鼠标再由真实控件坐标定位。随机 seek 也不依赖 onUpdate 回调。
- 课件保留原 25 秒纸张飞行，与教室端前三秒空间接续，合成仍为 38 秒。原 22 秒硬切会截断飞行，已取消。
- 查人仅使用前 30.65 秒，未使用的 pending 尾段不参与渲染。保留框架媒体完整性门禁，不禁用检查来掩盖空帧。
- 日常 48 秒与结尾 8 秒接续重叠 0.6 秒，完整片目标 299.35 秒。无全片加速。两个版本画面码流相同。
- 抽帧/字体/运行异常检查、编码时间戳/长定帧检查与艺术审片分开。节拍检测是局部能量证据，不是人工听审。
- assets 使用相对软链接，原章节和素材不复制。无声母版及中间媒体位于 `media/`，成品进入上级 `output/`。不把中间文件当第三个配乐版本。

## 局部修正

`assemble.mjs --sources --refresh=0,1,6` 仅重建受影响的复合源和相邻转场素材；随后重渲染 0、1、5、6 四个转场，再执行 `assemble.mjs --final --refresh=0,1,6`。仅在其余章节已完整生成且未改动时使用。时长不变时保留已对齐的音轨，最后重新运行 music-variants 和完整 verify。完整重建仍使用无 refresh 参数的入口。

首次成片扫描检出 5.00–6.73、35.80–38.00、186.07–188.07 秒三处长定帧。新增首页入口、课件成员操作、查人发送三处镜头；鼠标覆盖层和 UI 同处相机容器，防止放大后点错。保留初次发现记录，不放宽检测阈值。
