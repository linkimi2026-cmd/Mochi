# V11 第一版联片复用记录

2026-10-02。用户明确要求先把现有镜头联合成第一版供检查，优先产出可播放的长片，不再以补录为前置条件。

检索先覆盖完整框架 `site:github.com/heygen-com/hyperframes video timeline`，再查媒体组件 `site:github.com/FFmpeg/FFmpeg concat xfade video filters`、`site:github.com/FFmpeg/FFmpeg vf_xfade.c concat`。成功命中 HyperFrames 官方 core/compositions/media 文档，以及 FFmpeg vf_xfade.c、concat.c 与官方 filters 文档。实际仓库 https://github.com/heygen-com/hyperframes 、https://github.com/FFmpeg/FFmpeg 。没有把检索未返回某项称为不存在。

采用现有 HyperFrames 0.8.36 / Apache-2.0（已核上游 d4756f597c0dbb66310c2add699de6767b23f11b）和 GSAP 3.15.0 / Standard no charge（13e2b790546426a1a2e0e9b409f3f8dc6d6611f2）。本机 FFmpeg 9.0.1，构建启用 GPL 与 version3；通过命令调用现成剪辑、xfade 和跨淡化功能，不链接或重新分发程序。无需新增库、升级依赖或再实现渲染引擎。

原有五个章节直接使用已导出画面；新增补段使用已经录制的真实校园网站、日记、偏好、历史、自动化窗口。仅裁掉窗口系统栏、黑边，镜头等比缩放；没有重绘产品 UI。结尾 Mo 继续使用本项目原组件及现有原引擎。音乐复用 Mixkit Tech House vibes，既有许可记录在 promo/v6/assets/Mixkit-music-license.txt；替换所有章节审片音轨，形成统一配乐。

维护影响限本目录，保留镜头入出点、真实状态说明、可重建脚本。审批原片仅录到待审批，模型自动播放修订未验证，不拼接成成功；当前为第一版联片，未称全部功能验收完成。接入验证包括实际输出解码、分辨率/帧率/时长/音轨核对、章节接缝抽帧与文字检查。

另已通过 GitHub API 验证 n9.0.1 标签对象 501bb49457b9dfb25d6a208832e0a6e6cd53108d，并读取该标签 COPYING.GPLv3。本工程只调用本机工具。首次补段快照发现 HTML 缺少显式 head/body 导致渲染注入后的中文编码错误，已补结构，必须以修正后快照及导出帧验收，不能把原截图当作通过。

实际大渲染发现16GB机器同时4个worker载入13条媒体导致高内存压力。已保留完成的前36秒（4320帧），余下56秒用单worker、standard+CRF17导出，合成帧率与分辨率不变。新增 prepare-render-parts / finish-supplement 只划分现有时间轴，不重新实现媒体管理；可独立重建两段。后续长片避免将所有窗口视频集中在四个浏览器中同时解码。

拼接前实测两种渲染路径的轨道时基分别为1/90000和1/15360，直接复制拼接会造成时间戳异常。已使用FFmpeg无损重封装统一为90000，再强制核验92秒、11040帧、120/1；总片所有段也统一时基。首次异常输出未交付。
