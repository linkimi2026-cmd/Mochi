#### V11 K2.5 音轨连续性修正（2026-10-03）

检索先覆盖完整应用 Audacity，再查分析/处理组件 librosa 与 FFmpeg。实际词：`site:github.com audacity audacity music editing beats crossfade license`、`site:github.com librosa librosa beat_track tempo`、`site:github.com FFmpeg FFmpeg acrossfade acrossfade nb_samples`。搜索与 GitHub API 均成功。

- https://github.com/audacity/audacity ：8de3891657f6348916a466239b01301d16399747，最近 push 2026-10-02；读取 LICENSE.txt 确认 GPLv3，个别源码不同许可。官方支持文档有拍号网格与交叉淡化；完整桌面编辑器适合手工剪辑，本轮不引入桌面操作依赖。
- https://github.com/librosa/librosa ：b02c5ac37c1e453ae4811bfd383b93525589dae8，最近 push 2026-09-29，ISC；读取 beat.py 的 onset/tempo/dynamic-programming 实现说明与 pyproject。当前 Python 环境没有 librosa/scipy，已有 HyperFrames 节拍证据；不为已有功能新增分析依赖。未声称本地接入验证。
- https://github.com/FFmpeg/FFmpeg ：c9c35450343397c0ed6df2579d532f179dd8a2f3（本轮 API），源码 LICENSE.md 为 LGPL2.1+，可选组件使实际构建适用 GPL；本机 9.0.1，已实际查询 acrossfade、sidechaincompress 参数。复用现有命令行滤镜、保音高 atempo 和音轨封装，不复制基础引擎。CLI 与当前48kHz双声道素材兼容，导出后再验证实际拼接与音效时点。

已确认旧版50段独立变速、49次局部移位，最大11.63%；用户反馈听感错乱。合理推测：频繁变速、重音局部相位混合及不按节拍的2秒循环淡化共同破坏连续性。不能把这个推测当完整人工听审。改为长乐段与主要章节锚点，取消局部攻击音挪动；画面时长保持，音效独立。只在promo增加可重建音频修订，不改产品依赖。

复核确认了更直接的时长错误：旧K2.5 aligned.wav仅296.594秒，目标299.35秒，短2.756秒；第10个片段目标6.704秒而实际6.304秒。sync-scores把源时长作为输出端-t传入，速度小于1的片段被提前截断。改为输入端-t，并在每段及拼接后按48000Hz采样数验收。新版九段长乐段最大变速1.323%，无局部相位挪动；当前音乐底轨与混音均严格299.35秒。

用户进一步明确问题是原片电影式杂音与Mochi画面不对应，故不能只校正节拍。追加检索 `site:github.com audio separator sound effects music separation cinematic`、`site:github.com audiosep text music sound effects separation`，完整应用先比较 Stem Studio、ELUATE，后读TIGER与AudioSep。Stem Studio仓库 https://github.com/wassermanproductions/stem-studio 当前API提交7448d47a942b43ae2fc37ecc8fe0bc731c9e18fc、最近push2026-07-20、Apache2；实际读取engine_tiger.py、separate.py、requirements.txt和NOTICE。采用其现成音乐/对白/音效三分轨CLI、MPS兼容层与校验下载；不自行重写分离网络。其vendored TIGER代码MIT，权重JusperLee/TIGER-DnR为Apache2，固定b7a59560bbca10febbcd46fb01600f868e587f57并验证SHA256。只安装到独立用户缓存环境，Mochi项目不增加ML依赖、不打包模型。保留Sam Wasserman署名。ELUATE面向保留对白/音效去音乐，AudioSep通用文本分离需更大模型，本轮不采用。接入能力以实际MPS推理及分轨检查为准，不以README代替成功。

实际接入完成：GitHub API逐文件下载曾连接中断，改从固定提交codeload下载成功，归档SHA256为536ed4717f9ef4d594acd1779a02bcc1eeb4fa14b36bcd5425b6b5de8e2d9c6a。Python3.12独立环境+torch2.8.0在MPS完成TIGER真实推理，模型两个文件校验通过；三层均为44100Hz、2627655采样，重建原混音最大误差7.45e-8。最终仅采用music层，effects/dialogue层不参与混音；模型串音仍可能存在，未标为人工听审通过。重混音轨严格299.35秒，九个主要节点附近低鼓起音偏移0–40ms，峰值0.5224，无半秒以上低于-55dB的静音。复用接口已通过本轮所需功能验证；音乐分离环境不进入产品依赖或参赛源码包。
