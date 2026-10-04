# 教室端语音包离线导入（管理员）

教室电脑无法访问 GitHub 时，可以在另一台联网电脑下载两个**官方固定版本**归档，再复制到教室电脑。Mochi 启动后会先检查本地归档的大小和 SHA-256；不匹配的文件不会解包，会转为尝试在线下载。语音合成仍在教室电脑本机完成。

1. 从 [sherpa-onnx v1.13.8 Windows x64 运行包](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MD-MinSizeRel.tar.bz2) 下载文件，复制到教室电脑并命名为 `runtime.tar.bz2`。应为 **17,324,649 B**，SHA-256 为 `416011eabb9a1e26fd4433b41871d67c7a00b1f0a11b75fe66ff8182b8224f95`。
2. 从 [Kokoro 中文 int8 模型](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2) 下载文件，复制并命名为 `model.tar.bz2`。应为 **147,031,220 B**，SHA-256 为 `a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6`。
3. 完全退出教室端 Mochi（包括托盘），将两个文件放入当前 Windows 用户的 `%APPDATA%\Mochi-classroom\voice-packs\offline-import\`；没有目录就新建。重新打开教室端，Mochi 会按与在线下载相同的完整性、归档路径和安装后文件校验流程安装。默认路径仅适用于正常安装；以自定义 `--user-data-dir` 启动时，改用该目录下的 `voice-packs\offline-import\`。

可在 PowerShell 运行 `Get-FileHash -Algorithm SHA256 <文件路径>` 自行比对。两个压缩包合计约 164.4 MB；安装后占用更多磁盘空间。不要把语音包、学生消息或模型 API Key 放到 Mochi 主安装包里。Mochi 的视觉提醒和人工“已看到”回执仍是通知状态的依据；声音播放成功不等于学生已经听到。

同一组固定哈希资源已在私有 Windows [run 36030805114](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36030805114) 完成原生解包、Kokoro 合成及 WAV 检查。该 CI 验证了 Windows 原生合成链，不等于学校电脑上的离线导入、安装或扬声器听感已经现场验收。
