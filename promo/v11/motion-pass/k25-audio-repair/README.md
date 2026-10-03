# K2.5 音轨修订：音乐与原片音效分离

用户反馈“有电影杂音，和画面不连贯”。旧版将 K2.5 宣传片的完整混音当作配乐，原片音效也跟随循环进入 Mochi。此次用 Stem Studio 的 TIGER-DnR 分出音乐、对白、音效，只将音乐层放入新混音；Mochi 点击、打字、接信叮咚单独按原画面时间混入。模型可能残留串音，不能将信号检查等同于完整人工听审。

当前出口：`../output/Mochi_V11_第八版_K2.5音轨修订版_2K120.mp4`。同目录的旧“K2.5参考音轨版”保留追溯，不再作为当前审片入口。第八版同时更新两个配乐版的品牌画面与打字时点，两版共用同一画面码流，299.35 秒、2560×1440、120fps；实际录屏采集帧率与合成输出规格不同。

## 外部工具与重建

不在 Mochi 产品依赖中安装机器学习工具。独立环境：`~/.cache/mochi-audio-tools/venv`，Python 3.12，依赖见 `requirements.lock.txt`。使用 `python3.12 -m venv ~/.cache/mochi-audio-tools/venv` 后，在该环境执行 `pip install -r promo/v11/motion-pass/k25-audio-repair/requirements.lock.txt`。只使用 TIGER，不启用测试引擎或未许可模型。

Stem Studio 固定源码：https://github.com/wassermanproductions/stem-studio/tree/7448d47a942b43ae2fc37ecc8fe0bc731c9e18fc 。下载该提交的 codeload tar.gz，SHA256 为 `536ed4717f9ef4d594acd1779a02bcc1eeb4fa14b36bcd5425b6b5de8e2d9c6a`，校验后解压到 `~/.cache/mochi-audio-tools/stem-studio`。保留源码 LICENSE / NOTICE / MODIFICATIONS.md，署名 Sam Wasserman（wassermanproductions.com · wasserman.ai）。应用 Apache-2.0，vendored TIGER 代码 MIT；权重 Apache-2.0。具体复用评估见 `reuse-audit.md`。

模型 `JusperLee/TIGER-DnR` 固定 `b7a59560bbca10febbcd46fb01600f868e587f57`；现成 worker 下载并校验 config 与 safetensors 的 SHA256。使用本机 MPS，输入先重采样为 44.1kHz 双声道。MPS/CPU 兼容由现成引擎处理，不复制或重写分离网络。

在仓库根目录运行（先按上述准备独立环境）：

```sh
~/.cache/mochi-audio-tools/venv/bin/python promo/v11/motion-pass/k25-audio-repair/separate.py
~/.cache/mochi-audio-tools/venv/bin/python promo/v11/motion-pass/k25-audio-repair/build.py
~/.cache/mochi-audio-tools/venv/bin/python promo/v11/motion-pass/k25-audio-repair/check.py
node promo/v11/motion-pass/music-variants.mjs --track=k25
```

仅验证已生成分轨：`separate.py --check-only`。视频时间轴变更后必须重建音乐；导出入口核对时长和视频码流哈希，不能把旧音轨套到新画面。

## 对齐与细节

- 修复旧 `sync-scores.mjs` 的输入/输出 `-t` 混用：旧音乐底轨实际 296.594 秒，比 299.35 秒画面短 2.756 秒。现在每段与拼接后按采样数核验。
- 新版采用九段较长乐段，最大速度调整约 1.323%，保留音高；取消逐个瞬态移位和额外合成重击。60ms 接缝位于新重音前，避免把重音本身淡掉。
- 点击调低约 1.9dB，打字调低约 3.1dB；115.45 秒叮咚附近音乐轻压低，结尾 2.2 秒淡出。所有产品声音始终使用同一画面时钟。
- `separation-check.json`：真实分轨、模型来源、采样对齐及混合重建检查；不证明分离绝对无残留。
- `edit-report.json`：音乐编排与画面哈希；`audio-check.json`：时长、峰值、静音及主要重音偏移；`../music-variants.json`：最终编码、封面、整片解码与视频码流一致性；`export-check.json`：最终 AAC 与已验混音的相关性、起点、时长与画面一致性核验；具体数值以对应版本报告为准。
- 原片、分离后的音频与中间文件均留在忽略目录 `media/`，不放入源码参赛包。
