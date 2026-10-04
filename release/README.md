# Mochi 发布资源索引

> **status**: active
> **last_verified**: 2026-09-25

| 目录 | 状态 | 用途 |
|---|---|---|
| `../01-Mochi-参赛交付包-2026-09-14/` | 历史完整交付包 | 项目根目录下的源码、Windows、两种 Mac、80 秒宣传片、答辩 PPT、快速开始和校验清单。**其中安装器仍是 09-13/09-14 版本，不能代表本轮源码。** |
| `submission/Mochi-参赛源码包-2026-09-14.zip` | 历史源码提交 | 小于 500 MB；不含安装器、PPT、视频、缓存和密钥；内容早于 2026-09-24 本轮更新 |
| `2026-09-19-windows/` | 历史 Windows 归档 | CI run `35423708830`（快照 505 条、含原生 ABI 守卫）；同目录保留 run `35412334064` 的包用于对比。 |
| `2026-09-13-windows/`、`2026-09-09/`、`2026-09-10/`、`2026-09-12-windows/` | 历史 | 只作追溯，不从这些目录选当前交付物 |
| `_voided-manual-hotfixes/` | 作废 | 不分发、不运行 |
| `source-snapshots/` | 历史上游快照 | 只作供应链追溯，不作为当前源码或运行依赖 |

当前 macOS arm64 DMG 位于 `../apps/desktop/release/Mochi-0.1.0-mac-arm64.dmg`，大小 733,932,275 B，SHA256 `b230ffe121c67878e3fe899443d6db40a23cda0bf82fc8d0479584b249a59dbb`；正式边车、`hdiutil verify`（VALID）、最终教室板 rail 编译文件的包内字节、唯一无密钥设置种子与 12 个 arm64 原生模块均核对通过。从镜像复制出的 `.app` 教师/教室启动分别为 11.7 秒 / 2.0 秒，均输出 `MOCHI_DESKTOP_SMOKE_OK`。直接在只读挂载镜像里运行教师端曾在 90 秒内未获得成功标记，因此使用时先复制应用到本地。前版 DMG、blockmap、边车在 `../apps/desktop/release/archive/2026-09-25-pre-rail-pages-css/` 备份；新 blockmap SHA256 `82cbac44640265fe9a02e055d1f20b629953f098eb9e1bebf9c59a4f1d14d1ad`。该 DMG 未签名、未公证，学校真实 Key、网络、扬声器和全新 Mac 的 Gatekeeper 影响仍待现场验收。

当前 Windows x64 安装器保存在[私有草稿 Release](https://github.com/linkimi2026-cmd/jyl-campus-health/releases/tag/untagged-0597efba861a9ddbd468)，对应 [CI run 36092244751](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36092244751)、提交 `9cd4a0c9a5433a78cd7bf5f20ac42b6fad4d50b6`。EXE 大小 465,483,569 B，SHA256 `6d0c80150ec8b02c408aed9d409c6fbf3b00800b413971e47f7be4ea73213e77`；548 项 / 93,113,336 B 精确源码快照、配对码、自定义 UDP 端口、原生中文语音合成、桌宠真实 Electron 门禁、NSIS、无密钥种子核对、解包版及**实际安装目录**的双角色启动均通过。教室板顶部和底部两张合成 PNG 的哈希不同；它们不能证明学校 Windows 桌面的透明合成。Actions 工件配额已满，CI 使用私有草稿 Release 保存 EXE、95 B 校验边车及四张截图。安装器未签名，学校 Windows 设备上的真实 Key、有线网络和扬声器仍待现场验收。

本轮包包含课件教学计划、LAN 自定义端口和共享工具 schema 前缀。前一 [run 36070307101](https://github.com/linkimi2026-cmd/jyl-campus-health/actions/runs/36070307101) 在新端口测试加载时缺少 DSH 工具依赖链接，未进入端口断言；工作流补齐链接后，本轮 run 才验证了原生端口路径。

根目录统一交付包的硬链接仍指向历史版本；当前分发状态与未验证事项以 `../docs/DELIVERY-LEDGER.md` 为准。
